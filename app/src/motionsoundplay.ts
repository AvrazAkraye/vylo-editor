import type { Motion } from './motiontypes';
import { renderSoundBed, soundKey, type SoundBed } from './motionsound';

/**
 * Hearing a graphic's sound while it plays in the studio.
 *
 * The bed is the one the film gets (`renderSoundBed`), rendered once at the
 * speaker's own rate and kept; playing it is starting that buffer at the
 * playhead's second. Nothing is synthesised while it plays, so a busy graphic
 * costs the preview nothing but one buffer source.
 *
 * ## Web Audio, never `<audio>`
 *
 * In the app's webview an `HTMLMediaElement` plays through AVFoundation in
 * WebKit's GPU process, which can deadlock while the page asks it to start —
 * the whole window then stops answering (videospeaker.ts tells that story).
 * Everything here goes through an `AudioContext` and an
 * `AudioBufferSourceNode`; no media element is ever made.
 *
 * ## Following the clock
 *
 * `motionplay.ts` owns the playhead: a `requestAnimationFrame` loop that adds
 * real time. Sound has its own clock, the context's, and the two are not
 * asked to agree by force on every frame — restarting a buffer is audible.
 * `follow` is told where the playhead is each time it moves; it starts the
 * sound when play starts, stops it on pause, and starts it again at the
 * playhead only when they have drifted apart by more than `DRIFT` — which is
 * also how a seek, a loop back to the start and a window that was hidden
 * (the playhead waits, the speaker does not) are noticed. A change of speed
 * restarts it at that speed: the sound goes up or down in pitch with it, which
 * is what keeps it in step.
 *
 * ## Started by a person
 *
 * WebKit lets a context make sound only once a person has done something on
 * the page; until then it is `suspended` and its clock stands still. The
 * context is made only when a graphic actually has sound, and from then on
 * the first click or key press anywhere (listened for in the capture phase,
 * so it counts even when a button handles the click) resumes it. A play that
 * arrives while it is suspended is remembered and starts, at the playhead,
 * the moment it runs.
 *
 * ## Harmless without sound
 *
 * Where there is no `AudioContext` — Node, a locked-down window — every call
 * is a no-op and `prepare` resolves `false`. Nothing here throws.
 */

/** Seconds the sound may be ahead of or behind the playhead before it is started again at it. */
const DRIFT = 0.12;
/** Seconds a start or a stop is faded over, so it is not a click. */
const RAMP = 0.008;
/** Seconds before the end of the sound that a start is not worth making: the last frame or two. */
const TAIL = 0.05;

let factory: (() => AudioContext | null) | null = null;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let level = 1;
let buffer: AudioBuffer | null = null;
let bufferKey = '';
let wantKey = '';
let pending: Promise<boolean> | null = null;
let ctl: AbortController | null = null;
let voice: { src: AudioBufferSourceNode; gain: GainNode; from: number; at: number; rate: number } | null = null;
let playing = false;
let rate = 1;
/** Where the sound is, or will start from, when nothing is sounding. */
let pos = 0;
/** The playhead's last second, for a start that has to wait for the context. */
let clock = 0;
let armed = false;

/** The window's own context, or null where it has none. */
function windowContext(): AudioContext | null {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContext; webkitAudioContext?: new () => AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

/**
 * Make contexts with `f` instead of the window's constructor, or with the
 * window's again when `f` is null. For tests, which hand in a recording
 * stand-in; anything open is closed first.
 */
export function setAudioFactory(f: (() => AudioContext | null) | null): void {
  dispose();
  factory = f;
}

function onGesture(): void {
  wake();
}

function arm(): void {
  if (armed || typeof document === 'undefined') return;
  document.addEventListener('pointerdown', onGesture, true);
  document.addEventListener('keydown', onGesture, true);
  armed = true;
}

function disarm(): void {
  if (!armed || typeof document === 'undefined') return;
  document.removeEventListener('pointerdown', onGesture, true);
  document.removeEventListener('keydown', onGesture, true);
  armed = false;
}

/** The context, made the first time a graphic with sound needs it. */
function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = factory ? factory() : windowContext();
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  try {
    master = ctx.createGain();
    master.gain.value = level;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
    return null;
  }
  const mine = ctx;
  mine.onstatechange = () => {
    if (ctx !== mine) return;
    if (mine.state === 'running') {
      disarm();
      if (playing && !voice) start(clock);
    }
  };
  if (mine.state !== 'running') arm();
  return mine;
}

/** Let the context run. Call it from a click or a key press, where WebKit allows sound to start. */
export function wake(): void {
  const c = ctx;
  if (!c || c.state === 'running' || c.state === 'closed') return;
  try {
    void c.resume().catch(() => undefined);
  } catch {
    /* a context that will not resume stays silent */
  }
}

function toBuffer(c: AudioContext, bed: SoundBed): AudioBuffer | null {
  const len = bed.channels[0]?.length ?? 0;
  if (!len) return null;
  try {
    const b = c.createBuffer(2, len, bed.sampleRate);
    for (let i = 0; i < 2; i++) b.copyToChannel(bed.channels[Math.min(i, bed.channels.length - 1)] as Float32Array<ArrayBuffer>, i);
    return b;
  } catch {
    return null;
  }
}

/** A new bed is ready: swap it in, at the same second if it is playing. */
function install(bed: SoundBed | null, key: string): void {
  const at = voice ? position() : clock;
  stopVoice();
  buffer = bed && ctx ? toBuffer(ctx, bed) : null;
  bufferKey = buffer ? key : '';
  if (playing && buffer) start(at);
}

/**
 * Get the sound of `doc` ready to play: rendered in the background (and kept
 * by `soundKey`, so the same sound is never rendered twice), then swapped in.
 * Call it whenever the graphic changes; a newer call stops an older render.
 * Resolves `true` when there is sound to play.
 */
export function prepare(doc: Motion): Promise<boolean> {
  const key = soundKey(doc);
  if (key === 'silent') {
    ctl?.abort();
    ctl = null;
    pending = null;
    wantKey = '';
    install(null, '');
    return Promise.resolve(false);
  }
  if (key === bufferKey && buffer) return Promise.resolve(true);
  if (key === wantKey && pending) return pending;
  const c = context();
  if (!c) return Promise.resolve(false);
  ctl?.abort();
  const mine = new AbortController();
  ctl = mine;
  wantKey = key;
  const job = renderSoundBed(doc, { signal: mine.signal, sampleRate: c.sampleRate }).then(
    (bed) => {
      if (ctl !== mine) return false;
      ctl = null;
      pending = null;
      install(bed, key);
      return !!buffer;
    },
    () => {
      // Superseded, stopped, or no way to make it here (music without Web Audio): silence, not an error.
      if (ctl !== mine) return false;
      ctl = null;
      pending = null;
      wantKey = '';
      install(null, '');
      return false;
    },
  );
  pending = job;
  return job;
}

function start(at: number): void {
  const c = ctx;
  if (!c || !buffer || !master || !playing) return;
  if (c.state !== 'running') {
    wake();
    return;
  }
  if (!(at >= 0) || at >= buffer.duration - TAIL) return;
  try {
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = c.createGain();
    const now = c.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + RAMP);
    src.connect(g);
    g.connect(master);
    src.start(now, at);
    const v = { src, gain: g, from: at, at: now, rate };
    src.onended = () => {
      if (voice === v) voice = null;
    };
    voice = v;
  } catch {
    voice = null;
  }
}

function stopVoice(): void {
  const v = voice;
  voice = null;
  if (!v || !ctx) return;
  const now = ctx.currentTime;
  v.src.onended = () => {
    try {
      v.src.disconnect();
      v.gain.disconnect();
    } catch {
      /* already gone */
    }
  };
  try {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(v.gain.gain.value, now);
    v.gain.gain.linearRampToValueAtTime(0, now + RAMP);
    v.src.stop(now + RAMP + 0.002);
  } catch {
    try {
      v.src.stop();
    } catch {
      /* never started */
    }
  }
}

/** The second of the graphic the sound is at. */
export function position(): number {
  const v = voice;
  const c = ctx;
  if (!v || !c) return pos;
  return v.from + (c.currentTime - v.at) * v.rate;
}

const second = (t: number) => (Number.isFinite(t) && t > 0 ? t : 0);
const speedOf = (s: number) => (Number.isFinite(s) && s > 0 ? Math.min(4, Math.max(0.25, s)) : 1);

/** Play from `from` seconds, at `speed`. */
export function play(from: number, speed = 1): void {
  stopVoice();
  playing = true;
  rate = speedOf(speed);
  pos = second(from);
  clock = pos;
  start(pos);
}

export function pause(): void {
  if (voice) pos = position();
  playing = false;
  stopVoice();
}

/** Move to `t` seconds; playing on from there if it was playing. */
export function seek(t: number): void {
  pos = second(t);
  clock = pos;
  if (!playing) return;
  stopVoice();
  start(pos);
}

/** How loud the preview is, 0..1 (a monitor level: the film's own level is the graphic's `sound.level`). */
export function setLevel(v: number): void {
  level = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  const c = ctx;
  if (!master || !c) return;
  try {
    master.gain.setTargetAtTime(level, c.currentTime, 0.015);
  } catch {
    master.gain.value = level;
  }
}

/**
 * Keep the sound with the playhead (motionplay.ts's `Play`): call it every time
 * the clock moves. Cheap when nothing needs doing, which is nearly always.
 */
export function follow(p: { t: number; playing: boolean; speed: number }): void {
  clock = second(p.t);
  if (!p.playing) {
    if (playing) pause();
    pos = clock;
    return;
  }
  if (!playing || speedOf(p.speed) !== rate) {
    play(clock, p.speed);
    return;
  }
  const c = ctx;
  if (!c || !buffer || c.state !== 'running') return;
  if (!voice) {
    start(clock);
    return;
  }
  if (Math.abs(position() - clock) > DRIFT) seek(clock);
}

/** Stop, let go of the bed and close the context: the graphic was closed. Safe to call at any time. */
export function dispose(): void {
  playing = false;
  stopVoice();
  ctl?.abort();
  ctl = null;
  pending = null;
  buffer = null;
  bufferKey = '';
  wantKey = '';
  pos = 0;
  clock = 0;
  disarm();
  const c = ctx;
  ctx = null;
  master = null;
  if (c) {
    c.onstatechange = null;
    try {
      void c.close().catch(() => undefined);
    } catch {
      /* already closed */
    }
  }
}
