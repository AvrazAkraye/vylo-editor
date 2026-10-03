import { useSyncExternalStore } from 'react';

/**
 * Playback: one clock for the graphic that is open.
 *
 * The stage draws the frame at `t`, the timeline draws the playhead at `t`, and
 * the transport bar shows it and moves it. Three components, one number — so it
 * lives here, outside React, and each subscribes. Kept in component state it
 * would be lifted into the panel, and the panel would then re-render its whole
 * tree, forms and all, sixty times a second to move a playhead.
 *
 * ## The clock
 *
 * While playing, a `requestAnimationFrame` loop adds the real time since the
 * last frame (times `speed`) to `t`. It never counts frames itself: a display
 * that drops a frame must not make the graphic run slow, so time is measured
 * and the frame to draw is derived from it. A gap of more than a quarter of a
 * second — the window was hidden, or the machine slept — is treated as no time
 * at all, so coming back to the window does not jump the graphic to the end.
 *
 * `t` is in seconds and always inside `[0, last]`, where `last` is the final
 * frame's time, `seconds − 1/fps`. Not `seconds`: a layer that runs to the end
 * ends *at* `seconds`, is not drawn at it, and a playhead parked there would
 * show an empty frame.
 *
 * The clock starts the moment `play()` (or `seek()`) is called, not at the
 * first frame after it: the stamp is the time of the call, so the first frame
 * counts the time since the press like every frame after it. It used to count
 * none, which left the picture one frame behind the sound — which starts at
 * the press — for the whole play: 17 ms at 60 Hz, 33 ms at 30 Hz (review R2,
 * `docs/pro/requests/R2.md` item 3).
 *
 * ## Looping
 *
 * A loop lasts `seconds`, like the film: the last frame is shown for its own
 * `1/fps`, as it is in the MP4 and the GIF, and the sound's bed is `seconds`
 * long too, so picture and sound go round together. While the clock is in
 * that last stretch, `[last, seconds)`, the playhead shows `last` and the time
 * past it is kept (`held`), so the next round starts exactly where the time
 * says. It used to wrap with `t %= seconds` alone, which leaves a `t` in that
 * stretch as it is — a playhead past the last frame, at a time the film does
 * not have.
 *
 * ## Only one graphic
 *
 * There is one clock because one graphic is open at a time. The gallery's
 * animated cards do not use it — each runs its own small loop
 * (MotionThumb.tsx), so a card in view never moves the playhead of the
 * graphic being edited.
 */

export interface Play {
  /** Seconds into the graphic. */
  t: number;
  playing: boolean;
  loop: boolean;
  /** 0.25 to 2. */
  speed: number;
  /** Motion blur in the preview. Off by default: it costs several paints a frame. */
  blur: boolean;
  seconds: number;
  fps: number;
}

export const SPEEDS: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

/** The longest gap between two animation frames that still counts as time passing. */
const MAX_GAP = 0.25;

let state: Play = { t: 0, playing: false, loop: true, speed: 1, blur: false, seconds: 6, fps: 30 };
const subs = new Set<() => void>();
let frame = 0;
/**
 * When the clock last counted, as a `performance.now()` time, or `null` when there is nothing to count from: the
 * next frame only stamps. Not 0 for that: 0 is a time like any other.
 */
let stamp: number | null = null;
/** How far into the last frame's own stretch the looping clock is, while the playhead shows the last frame. */
let held = 0;

/**
 * Now, in the clock `requestAnimationFrame` hands its callbacks: `performance.now()`'s. Without it (no page),
 * `null`, which means the next frame only stamps, as it always did.
 */
function now(): number | null {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : null;
}

function emit() {
  for (const s of subs) s();
}

function set(next: Partial<Play>) {
  state = { ...state, ...next };
  emit();
}

/** The time of the final frame. */
export function lastFrame(p: Pick<Play, 'seconds' | 'fps'>): number {
  return Math.max(0, p.seconds - 1 / p.fps);
}

/**
 * Where the clock is after `t` seconds of film, looping: inside `[0, end]`, with whatever the playhead cannot show
 * kept in `held`. Past the film's length it goes round again (`%`, so a gap longer than a short graphic is right
 * too); in the last frame's own stretch, `[end, seconds)`, it shows `end`.
 */
function wrap(t: number, end: number, seconds: number): { t: number; held: number } {
  const u = t % seconds;
  return u >= end ? { t: end, held: u - end } : { t: u, held: 0 };
}

function ticker(at: number) {
  frame = 0;
  if (!state.playing) return;
  // A frame's time can come before the stamp — a press handled in the same frame as its callbacks, whose time is the
  // frame's start — and that is no time, not time backwards. The stamp stays at the press, then: the next frame
  // counts from it, as the sound does, not from the earlier start of this one.
  const gap = stamp === null ? 0 : Math.min(MAX_GAP, Math.max(0, (at - stamp) / 1000));
  stamp = stamp === null ? at : Math.max(stamp, at);
  const end = lastFrame(state);
  let t = state.t + held + gap * state.speed;
  held = 0;
  if (t >= end) {
    if (state.loop && end > 0) {
      ({ t, held } = wrap(t, end, state.seconds));
    } else {
      set({ t: end, playing: false });
      return;
    }
  }
  set({ t });
  frame = requestAnimationFrame(ticker);
}

function run() {
  if (frame || typeof requestAnimationFrame === 'undefined') return;
  stamp = now();
  frame = requestAnimationFrame(ticker);
}

function halt() {
  if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
  frame = 0;
  stamp = null;
  held = 0;
}

/**
 * Tell the clock how long the open graphic is. Called when one is opened and
 * whenever its length or rate changes; a playhead left past a shortened end is
 * brought back to it.
 */
export function bind(seconds: number, fps: number) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 1;
  const f = Number.isFinite(fps) && fps > 0 ? fps : 30;
  if (s === state.seconds && f === state.fps) return;
  const end = Math.max(0, s - 1 / f);
  held = 0;
  set({ seconds: s, fps: f, t: Math.min(state.t, end) });
}

/**
 * Move the playhead. Snaps to a frame, so what is shown is a frame that could be exported. While playing, the clock
 * counts on from the moment of the seek, as the sound does from where it is sent.
 */
export function seek(t: number) {
  const end = lastFrame(state);
  const raw = Number.isFinite(t) ? t : 0;
  const snapped = Math.round(raw * state.fps) / state.fps;
  held = 0;
  set({ t: Math.min(end, Math.max(0, snapped)) });
  stamp = state.playing ? now() : null;
}

/** Move by whole frames, pausing: stepping is for looking closely. */
export function step(frames: number) {
  halt();
  const at = Math.round(state.t * state.fps) + Math.round(frames);
  const total = Math.max(1, Math.round(state.seconds * state.fps));
  const wrapped = ((at % total) + total) % total;
  set({ t: wrapped / state.fps, playing: false });
}

export function play() {
  if (state.playing) return;
  // Play from the top when it is parked on the last frame.
  const start = state.t >= lastFrame(state) - 1e-6 ? 0 : state.t;
  set({ playing: true, t: start });
  run();
}

export function pause() {
  if (!state.playing) return;
  halt();
  set({ playing: false });
}

export function toggle() {
  if (state.playing) pause();
  else play();
}

export function setLoop(loop: boolean) {
  set({ loop });
}

export function setSpeed(speed: number) {
  set({ speed: SPEEDS.includes(speed) ? speed : 1 });
}

export function setBlur(blur: boolean) {
  set({ blur });
}

/** A graphic was closed: stop, and go back to the start. */
export function reset() {
  halt();
  set({ playing: false, t: 0 });
}

export function read(): Play {
  return state;
}

function subscribe(cb: () => void) {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

/** The clock, as a hook: the component re-renders when it moves. */
export function usePlay(): Play {
  return useSyncExternalStore(subscribe, read, read);
}
