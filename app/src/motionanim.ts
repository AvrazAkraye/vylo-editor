import type { Anim, CounterLayer, Effect, Layer, Loop, LoopAnim, Pose } from './motiontypes';
import { clamp, clamp01, easeOf, finite, frac, lerp } from './motionmath';

/**
 * What a layer looks like at one moment: `poseAt` turns a layer's entrance,
 * exit, loop and own transform into a `Pose`, and `motiondraw.ts` draws the
 * pose. This file is where the feel of the engine lives — how far a `rise`
 * travels, how a `pop` overshoots, how an exit retraces its entrance — so the
 * numbers are all here, in one place, rather than spread across the drawing
 * code where nobody would think to look when a title felt too slow.
 *
 * ## Pure, and total
 *
 * A pose is a function of the layer, the time and the reading direction, and
 * of nothing else: no clock, no memory of the last frame, no randomness. That
 * is what lets a still, a thumbnail, the preview and every frame of the MP4
 * agree, and lets a test ask for any moment. It is also *total*: whatever
 * numbers a hand-edited document holds, every field of the pose is finite.
 *
 * ## An exit is the entrance played backwards
 *
 * The exit's progress runs from 1 to 0 through the same curve, fed the time
 * *reversed*. A curve that eases out on the way in therefore eases in on the
 * way out, without anybody choosing it: the graphic leaves slowly and then
 * quickly, and a `back-out` that overshoots on arrival winds up before it
 * goes. One list of effects serves both, and an exit is never a second thing
 * to design.
 *
 * ## Overshoot
 *
 * A curve such as `back-out` or `spring` passes 1 before it settles. The raw
 * progress `p` keeps that excursion — `pop` really does grow past its size and
 * come back — while everything that must stay in range (opacity, a reveal's
 * extent) is fed `clamp01(p)`.
 *
 * ## Distances
 *
 * In u, the frame's short-side percent. They are fixed rather than relative to
 * the layer, on purpose: a caption and a headline both `rise` the same
 * distance, which is what makes a composition read as one hand. `amount`
 * scales all of them.
 *
 * ## Order of the transform
 *
 * The drawing code applies, from the pin: translate by the layer's offset
 * plus `dx, dy`; rotate by `rot`; scale by `sx, sy`; then draws the layer
 * centred on that origin. The pose's `dx` is physical — direction is resolved
 * here — so the drawing code never asks which way the language reads.
 */

const TAU = Math.PI * 2;

/** Seconds between units of a split text when the animation names no gap. */
export const DEFAULT_GAP = 0.04;

/** The shortest an effect may take. Zero would divide by it. */
const MIN_D = 0.001;

/** One piece of a split layer: the `i`-th of `n`. */
export interface UnitRef {
  i: number;
  n: number;
}

/**
 * Seconds between one unit starting and the next. A chart's data grow one
 * after another by the chart's own `gap`; text by the animation's `gap`.
 */
export function gapOf(layer: Layer, a?: Anim): number {
  if (layer.kind === 'chart') return finite(layer.gap, 0);
  return finite(a?.gap, DEFAULT_GAP);
}

/**
 * How far along an effect is: 0 hidden, 1 at rest, and past either for a
 * curve that overshoots. `t0` is when it starts.
 */
function progress(t: number, t0: number, a: Anim): number {
  const d = Math.max(MIN_D, finite(a.d, 0.6));
  return easeOf(a.ease)(clamp01((t - t0) / d));
}

/** The pose of a layer that is not there. */
function idle(layer: Layer): Pose {
  return {
    on: false, presence: 0, opacity: 0, dx: 0, dy: 0, sx: finite(layer.scale, 1), sy: finite(layer.scale, 1), rot: finite(layer.rot, 0),
    reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1,
  };
}

/**
 * Add one effect's contribution to a pose. `p` is its raw progress (0 hidden,
 * 1 at rest, possibly past either); the same function serves entrances and,
 * fed the reversed progress, exits.
 */
function applyFx(pose: Pose, fx: Effect, p: number, a: Anim, rtl: boolean): void {
  const pc = clamp01(p);
  const h = 1 - p;
  const amt = clamp(finite(a.amount, 1), 0, 3);
  switch (fx) {
    case 'fade':
      pose.opacity *= pc;
      break;
    case 'rise':
      pose.dy += 6 * amt * h;
      pose.opacity *= pc;
      break;
    case 'drop':
      pose.dy -= 6 * amt * h;
      pose.opacity *= pc;
      break;
    case 'slide': {
      const dir = a.dir ?? 'start';
      if (dir === 'up') pose.dy += 12 * amt * h;
      else if (dir === 'down') pose.dy -= 12 * amt * h;
      else pose.dx += (dir === 'start' ? -1 : 1) * (rtl ? -1 : 1) * 12 * amt * h;
      // The fade is quicker than the move, so the layer is solid before it lands.
      pose.opacity *= clamp01(pc * 2);
      break;
    }
    case 'pop': {
      const s = lerp(1 - 0.45 * Math.min(amt, 2), 1, p);
      pose.sx *= s;
      pose.sy *= s;
      pose.opacity *= clamp01(p * 2.5);
      break;
    }
    case 'zoom': {
      const s = lerp(1 + 0.35 * amt, 1, p);
      pose.sx *= s;
      pose.sy *= s;
      pose.opacity *= pc;
      break;
    }
    case 'wipe': {
      // Only the wipe that is under way sets the edge: an exit that has not begun
      // (progress 1) must not turn an entrance that comes from the other side.
      if (pc < pose.reveal) {
        const dir = a.dir ?? 'start';
        pose.reveal = pc;
        pose.from = dir === 'up' ? 'bottom' : dir === 'down' ? 'top' : (dir === 'start') !== rtl ? 'left' : 'right';
      }
      break;
    }
    case 'mask':
      pose.mask = Math.min(pose.mask, pc);
      break;
    case 'type':
      pose.type = Math.min(pose.type, pc);
      break;
    case 'blur':
      pose.blur = Math.max(pose.blur, 6 * amt * (1 - pc));
      pose.opacity *= clamp01(pc * 2);
      break;
    case 'spin': {
      const s = lerp(1 - 0.4 * Math.min(amt, 2), 1, p);
      pose.rot += -90 * amt * h;
      pose.sx *= s;
      pose.sy *= s;
      pose.opacity *= pc;
      break;
    }
    case 'flip':
      pose.sy *= Math.max(0, p);
      pose.opacity *= clamp01(p * 3);
      break;
    case 'grow':
      pose.grow = Math.min(pose.grow, clamp(p, 0, 1.25));
      break;
    case 'draw':
      pose.draw = Math.min(pose.draw, pc);
      break;
    case 'none':
      break;
  }
}

/**
 * A loop's contribution. `w` is how present the layer is, so a loop fades in
 * with the layer and never pops; a spin is the exception, because it
 * accumulates and weighting it would jump.
 */
function applyLoop(pose: Pose, loop: LoopAnim, t: number, start: number, w: number): void {
  const fx: Loop = loop.fx;
  if (fx === 'none') return;
  const period = Math.max(MIN_D, finite(loop.d, 2));
  const phase = (t - start) / period;
  const a = clamp(finite(loop.amount, 1), 0, 3);
  const wave = Math.sin(phase * TAU);
  switch (fx) {
    case 'float':
      pose.dy += wave * 1 * a * w;
      break;
    case 'pulse': {
      const s = 1 + 0.045 * a * w * (0.5 - 0.5 * Math.cos(phase * TAU));
      pose.sx *= s;
      pose.sy *= s;
      break;
    }
    case 'spin':
      pose.rot += 360 * a * phase;
      break;
    case 'sway':
      pose.rot += wave * 4 * a * w;
      break;
    case 'breathe':
      pose.opacity *= 1 - 0.25 * a * w * (0.5 - 0.5 * Math.cos(phase * TAU));
      break;
    case 'shimmer':
      pose.glint = frac(phase);
      break;
  }
}

/**
 * The pose of `layer` at `t` seconds. `rtl` resolves the logical directions
 * (a slide from the start side, a wipe toward the end) into physical ones.
 * `unit` is one piece of a split layer: it starts `gap` seconds after the one
 * before it, and leaves in the same order, so the last piece ends exactly at
 * the layer's `end`.
 */
export function poseAt(layer: Layer, t: number, rtl: boolean, unit?: UnitRef): Pose {
  const now = finite(t, 0);
  if (layer.hidden || !(now >= layer.start) || !(now < layer.end)) return idle(layer);

  const pose: Pose = {
    on: true, presence: 1, opacity: clamp01(finite(layer.opacity, 1)), dx: 0, dy: 0,
    sx: finite(layer.scale, 1), sy: finite(layer.scale, 1), rot: finite(layer.rot, 0),
    reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1,
  };

  let presence = 1;
  const enter = layer.in;
  if (enter && enter.fx !== 'none') {
    const shift = unit ? unit.i * gapOf(layer, enter) : 0;
    const p = progress(now, layer.start + finite(enter.delay, 0) + shift, enter);
    applyFx(pose, enter.fx, p, enter, rtl);
    presence = Math.min(presence, clamp01(p));
  }
  const leave = layer.out;
  if (leave && leave.fx !== 'none') {
    const after = unit ? (unit.n - 1 - unit.i) * gapOf(layer, leave) : 0;
    const finish = layer.end - finite(leave.delay, 0) - after;
    // Time runs backwards through the curve: 1 when the exit begins, 0 when it ends.
    const d = Math.max(MIN_D, finite(leave.d, 0.4));
    const q = easeOf(leave.ease)(clamp01((finish - now) / d));
    applyFx(pose, leave.fx, q, leave, rtl);
    presence = Math.min(presence, clamp01(q));
  }
  pose.presence = presence;
  if (layer.loop) applyLoop(pose, layer.loop, now, layer.start, presence);

  pose.opacity = clamp01(finite(pose.opacity, 0));
  pose.dx = finite(pose.dx, 0);
  pose.dy = finite(pose.dy, 0);
  pose.sx = finite(pose.sx, 1);
  pose.sy = finite(pose.sy, 1);
  pose.rot = finite(pose.rot, 0);
  pose.on = pose.opacity > 0.001 && Math.abs(pose.sx) > 1e-4 && Math.abs(pose.sy) > 1e-4;
  return pose;
}

/**
 * When a layer's entrance is over, given how many units it is split into: the
 * moment the last unit comes to rest. Templates use it to start the next thing
 * as this one lands; the timeline uses it to draw the entrance.
 */
export function inDone(layer: Layer, units = 1): number {
  const a = layer.in;
  if (!a || a.fx === 'none') return layer.start;
  const stagger = Math.max(0, units - 1) * gapOf(layer, a);
  return layer.start + finite(a.delay, 0) + stagger + Math.max(MIN_D, finite(a.d, 0.6));
}

/** When a layer's exit begins, for the same reason: the first unit starts to leave. */
export function outStart(layer: Layer, units = 1): number {
  const a = layer.out;
  if (!a || a.fx === 'none') return layer.end;
  const stagger = Math.max(0, units - 1) * gapOf(layer, a);
  return layer.end - finite(a.delay, 0) - stagger - Math.max(MIN_D, finite(a.d, 0.4));
}

/** The value a counter shows at `t`: `from` until its roll starts, `to` once it ends. */
export function countAt(layer: CounterLayer, t: number): number {
  const c = layer.count;
  const d = Math.max(MIN_D, finite(c.d, 1.6));
  const p = easeOf(c.ease)(clamp01((finite(t, 0) - layer.start - finite(c.delay, 0)) / d));
  // An overshooting curve would roll past the number and come back; a counter
  // that shows 104 on its way to 100 is a wrong number, so it stays in range.
  const between = lerp(layer.from, layer.to, clamp01(p));
  return finite(between, layer.to);
}

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * How many pieces a layer splits into for its entrance and exit: the lines,
 * words or characters of a text layer, the data of a chart, otherwise one.
 * Lines are counted at the line breaks written in the text; the renderer also
 * breaks at the wrap width, so this can be a few short of what is drawn, which
 * is why it is used only to time things, never to draw them.
 */
export function unitsOf(layer: Layer): number {
  if (layer.kind === 'chart') return Math.max(1, layer.data.length);
  if (layer.kind !== 'text') return 1;
  const by = layer.in?.by ?? layer.out?.by ?? 'all';
  if (by === 'all') return 1;
  const words = layer.text.split(/\s+/).filter(Boolean).length;
  if (by === 'line') return Math.max(1, layer.text.split('\n').length);
  // A letter drawn alone loses its joins, so Arabic script splits into words.
  if (by === 'word' || ARABIC_SCRIPT.test(layer.text)) return Math.max(1, words);
  return Math.max(1, Array.from(layer.text.replace(/\s/g, '')).length);
}

/**
 * The moment that best stands for a graphic as a still: after the last
 * entrance has settled and before the first exit begins, a little way into the
 * hold. The gallery's cards and a graphic's cover are drawn at it, because
 * frame zero is the emptiest frame there is.
 *
 * Backdrops never settle — they move for as long as they are there — so they
 * are left out; a graphic of nothing but a backdrop is drawn at its middle.
 */
export function stillTime(layers: readonly Layer[], seconds: number): number {
  let settled = 0;
  let leaving = seconds;
  let any = false;
  for (const l of layers) {
    if (l.hidden || l.kind === 'backdrop' || l.kind === 'particles') continue;
    any = true;
    const n = unitsOf(l);
    settled = Math.max(settled, inDone(l, n));
    if (l.kind === 'counter') settled = Math.max(settled, l.start + finite(l.count.delay, 0) + finite(l.count.d, 0));
    if (l.out && l.out.fx !== 'none') leaving = Math.min(leaving, outStart(l, n));
  }
  if (!any) return clamp(seconds / 2, 0, seconds);
  const hold = leaving - settled;
  const at = hold >= 0.7 ? settled + 0.35 : hold > 0 ? settled + hold / 2 : Math.min(settled, seconds * 0.9);
  return clamp(at, 0, Math.max(0, seconds - 0.05));
}
