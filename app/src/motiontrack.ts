import type { Layer } from './motiontypes';
import { inDone, outStart, unitsOf } from './motionanim';
import { clamp, finite } from './motionmath';

/**
 * The timeline's arithmetic: where a moment is drawn, which seconds the ruler
 * labels, where a dragged bar lands, and how much of a bar is its entrance and
 * its exit. MotionTimeline.tsx draws with it; nothing here touches the DOM or
 * React, so `test/motiontimeline.test.mjs` can pin every number. (It is not
 * called `motiontimeline.ts`: on the Mac's case-insensitive disk, the path
 * the panel imports the component by would find that file before it.)
 *
 * ## Pixels and seconds
 *
 * The track is as wide as its column and the whole graphic fits in it — a
 * motion graphic is 30 seconds at most, so there is nothing to scroll
 * sideways. `PAD` pixels are kept clear at each end, so a bar that starts at
 * 0 or ends at the last second still has room for its handle, and the ruler's
 * last label is not cut off. Time runs left to right in every language, as it
 * does in the Video timeline.
 *
 * ## Dragging
 *
 * A drag is computed from where the bar was when the pointer went down and
 * how far the pointer has moved since, never by adding up the moves, so the
 * bar cannot drift out from under the pointer however many moves arrive.
 * Edges snap to the twentieth of a second, and, within `SNAP_PX`, to the
 * playhead, to the ends of the graphic and to the other layers' edges —
 * whichever is nearest. Holding Alt turns all of it off.
 */

/** Pixels kept clear at each end of the track. */
export const PAD = 12;
/** The grid a dragged edge snaps to, in seconds. */
export const GRID = 0.05;
/** The shortest a layer can be dragged to, in seconds: `motionread.ts`'s own floor. */
export const MIN_LEN = 0.05;
/** How close, in pixels, an edge must come to a target to snap to it. */
export const SNAP_PX = 8;
/** What a free drag (Alt held) is rounded to, so a layer does not end at 1.2345678 s. */
export const FINE = 0.01;
/** Pixels a press must travel before it is a drag rather than a click. */
export const DRAG_SLOP = 3;
/** The narrowest a ruler label may be given, in pixels, before labels are spaced further apart. */
const LABEL_PX = 26;

const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Pixels per second for a track `width` pixels wide showing `seconds`. */
export function scaleOf(width: number, seconds: number): number {
  const s = finite(seconds, 0);
  const w = finite(width, 0) - PAD * 2;
  return s > 0 && w > 0 ? w / s : 0;
}

/** Where a moment is drawn, in pixels from the track's left edge. */
export function xOf(t: number, pps: number): number {
  return PAD + t * pps;
}

/** The moment under a point `x` pixels from the track's left edge, inside the graphic. */
export function timeAt(x: number, pps: number, seconds: number): number {
  if (!(pps > 0)) return 0;
  return clamp((x - PAD) / pps, 0, Math.max(0, seconds));
}

/** How many seconds apart the ruler's labels are: 1, 2 or 5, and 10 when even 5 would crowd. */
export function labelStep(pps: number): number {
  for (const s of [1, 2, 5]) if (s * pps >= LABEL_PX) return s;
  return 10;
}

export interface Tick {
  /** Seconds. */
  at: number;
  /** Carries a number. */
  label: boolean;
  /** A half second, drawn only when there is room for it. */
  half: boolean;
}

/**
 * The ruler's marks: one each second (while they are at least 4 px apart),
 * numbered every `labelStep`, and a half-second mark between them once a
 * second is 60 px wide.
 */
export function ticksOf(seconds: number, pps: number): Tick[] {
  const out: Tick[] = [];
  if (!(pps > 0) || !(seconds > 0)) return out;
  const step = labelStep(pps);
  const each = pps >= 4;
  const halves = pps >= 60;
  const last = Math.floor(seconds + 1e-9);
  for (let s = 0; s <= last; s += 1) {
    const label = s % step === 0;
    if (label || each) out.push({ at: s, label, half: false });
    if (halves && s + 0.5 <= seconds + 1e-9) out.push({ at: s + 0.5, label: false, half: true });
  }
  return out;
}

/** The nearest of `targets` within `radius` of `v`, or null. */
function nearest(v: number, targets: readonly number[], radius: number): { t: number; d: number } | null {
  let best: { t: number; d: number } | null = null;
  for (const t of targets) {
    const d = Math.abs(t - v);
    if (d <= radius && (!best || d < best.d)) best = { t, d };
  }
  return best;
}

/**
 * The moments an edge snaps to while a layer is dragged: the two ends of the
 * graphic, the playhead, and every other layer's start and end.
 */
export function snapTargets(layers: readonly Layer[], id: string, playhead: number, seconds: number): number[] {
  const set = new Set<number>([0, r3(seconds)]);
  if (Number.isFinite(playhead)) set.add(r3(playhead));
  for (const l of layers) {
    if (l.id === id) continue;
    set.add(r3(l.start));
    set.add(r3(l.end));
  }
  return [...set].sort((a, b) => a - b);
}

/** A time snapped to the grid, or rounded finely when snapping is off. */
function onGrid(t: number, snap: boolean): number {
  const step = snap ? GRID : FINE;
  return r3(Math.round(t / step) * step);
}

/** Which part of a bar is being dragged. */
export type DragMode = 'move' | 'start' | 'end';

export interface Span {
  start: number;
  end: number;
}

export interface DragOptions {
  /** The graphic's length. */
  seconds: number;
  /** Pixels per second: how far `SNAP_PX` reaches. */
  pps: number;
  /** What an edge snaps to (`snapTargets`). */
  targets: readonly number[];
  /** False while Alt is held: no grid, no targets. */
  snap: boolean;
}

export interface Dragged extends Span {
  /** The target an edge snapped to, for the guide line; null when it snapped to the grid or nothing. */
  guide: number | null;
}

/**
 * Where a bar lands when the pointer has moved `dt` seconds since it went down
 * on `from`. `move` keeps the length and stays inside the graphic; `start` and
 * `end` move one edge and keep at least `MIN_LEN` between them.
 */
export function dragTo(mode: DragMode, from: Span, dt: number, o: DragOptions): Dragged {
  const seconds = Math.max(MIN_LEN, finite(o.seconds, MIN_LEN));
  const radius = o.snap && o.pps > 0 ? SNAP_PX / o.pps : -1;
  const shift = finite(dt, 0);
  const pick = (v: number): { t: number; guide: number | null } => {
    const hit = radius >= 0 ? nearest(v, o.targets, radius) : null;
    return hit ? { t: hit.t, guide: hit.t } : { t: onGrid(v, o.snap), guide: null };
  };

  if (mode === 'start') {
    const hi = Math.max(0, from.end - MIN_LEN);
    const p = pick(from.start + shift);
    const start = r3(clamp(p.t, 0, hi));
    return { start, end: from.end, guide: p.guide !== null && start === r3(p.guide) ? p.guide : null };
  }
  if (mode === 'end') {
    const lo = Math.min(seconds, from.start + MIN_LEN);
    const p = pick(from.end + shift);
    const end = r3(clamp(p.t, lo, seconds));
    return { start: from.start, end, guide: p.guide !== null && end === r3(p.guide) ? p.guide : null };
  }

  const len = Math.min(seconds, Math.max(MIN_LEN, from.end - from.start));
  const want = from.start + shift;
  let start: number;
  let guide: number | null = null;
  const a = radius >= 0 ? nearest(want, o.targets, radius) : null;
  const b = radius >= 0 ? nearest(want + len, o.targets, radius) : null;
  if (a && (!b || a.d <= b.d)) {
    start = a.t;
    guide = a.t;
  } else if (b) {
    start = b.t - len;
    guide = b.t;
  } else {
    start = onGrid(want, o.snap);
  }
  start = r3(clamp(start, 0, Math.max(0, seconds - len)));
  const end = r3(Math.min(seconds, start + len));
  if (guide !== null && r3(guide) !== start && r3(guide) !== end) guide = null;
  return { start, end, guide };
}

/** A bar moved by `by` seconds, its length kept, inside the graphic: the arrow keys. */
export function nudge(from: Span, by: number, seconds: number): Span {
  const len = Math.max(0, from.end - from.start);
  const start = r3(clamp(from.start + finite(by, 0), 0, Math.max(0, seconds - len)));
  return { start, end: r3(Math.min(seconds, start + len)) };
}

/** A bar whose start is moved to `at` (the playhead), its end kept: the `[` key. */
export function trimStart(from: Span, at: number): Span {
  return { start: r3(clamp(finite(at, from.start), 0, Math.max(0, from.end - MIN_LEN))), end: from.end };
}

/** A bar whose end is moved to `at` (the playhead), its start kept: the `]` key. */
export function trimEnd(from: Span, at: number, seconds: number): Span {
  const lo = Math.min(seconds, from.start + MIN_LEN);
  return { start: from.start, end: r3(clamp(finite(at, from.end), lo, seconds)) };
}

/**
 * The parts of a layer the reader fits to the layer's length. A drag that
 * passes through a short length on its way to a long one must not leave the
 * entrance cut to the short one, so these are taken when the pointer goes
 * down and written back with every move: only the final length is fitted.
 */
export function timingOf(layer: Layer): Partial<Layer> {
  return layer.kind === 'counter'
    ? { in: layer.in, out: layer.out, count: layer.count }
    : { in: layer.in, out: layer.out };
}

export interface Parts {
  /** The entrance: from when it begins (after its delay) to when the last piece is at rest. Null when there is none. */
  in: Span | null;
  /** The exit: from when the first piece starts to leave to when it has gone. Null when there is none. */
  out: Span | null;
}

/**
 * When a layer's entrance and exit run, in seconds, inside its own start and
 * end. A layer split into words or a chart's bars arrive one after another,
 * so the entrance lasts until the last of them lands (`inDone`), and the exit
 * begins when the first leaves (`outStart`).
 */
export function partsOf(layer: Layer): Parts {
  const { start, end } = layer;
  const n = unitsOf(layer);
  let enter: Span | null = null;
  let leave: Span | null = null;
  if (layer.in && layer.in.fx !== 'none') {
    const a = clamp(start + finite(layer.in.delay, 0), start, end);
    const b = clamp(inDone(layer, n), start, end);
    if (b > a) enter = { start: r3(a), end: r3(b) };
  }
  if (layer.out && layer.out.fx !== 'none') {
    const a = clamp(outStart(layer, n), start, end);
    const b = clamp(end - finite(layer.out.delay, 0), start, end);
    if (b > a) leave = { start: r3(a), end: r3(b) };
  }
  return { in: enter, out: leave };
}

/** The layers as the timeline lists them: the front one first, as design tools do. */
export function rowsOf(layers: readonly Layer[]): Layer[] {
  return layers.slice().reverse();
}

/** The row `by` places from `id`, held at the ends; the first row when `id` is not one. */
export function stepRow(ids: readonly string[], id: string | null, by: number): string | null {
  if (!ids.length) return null;
  const i = id ? ids.indexOf(id) : -1;
  if (i < 0) return ids[0];
  return ids[clamp(i + Math.round(by), 0, ids.length - 1)];
}

/** Seconds as a person reads them: at most two decimals, none when whole. */
export function secs(t: number): string {
  return String(Math.round(finite(t, 0) * 100) / 100);
}
