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
let stamp = 0;

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

function ticker(now: number) {
  frame = 0;
  if (!state.playing) return;
  const gap = stamp ? Math.min(MAX_GAP, (now - stamp) / 1000) : 0;
  stamp = now;
  const end = lastFrame(state);
  let t = state.t + gap * state.speed;
  if (t >= end) {
    if (state.loop && end > 0) {
      t %= state.seconds;
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
  stamp = 0;
  frame = requestAnimationFrame(ticker);
}

function halt() {
  if (frame && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(frame);
  frame = 0;
  stamp = 0;
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
  set({ seconds: s, fps: f, t: Math.min(state.t, end) });
}

/** Move the playhead. Snaps to a frame, so what is shown is a frame that could be exported. */
export function seek(t: number) {
  const end = lastFrame(state);
  const raw = Number.isFinite(t) ? t : 0;
  const snapped = Math.round(raw * state.fps) / state.fps;
  set({ t: Math.min(end, Math.max(0, snapped)) });
  stamp = 0;
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
