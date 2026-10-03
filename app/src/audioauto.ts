/*
 * Portions derived from HyperFrames (heygen-com/hyperframes, Apache-2.0),
 * packages/core/src/audioAutomation.ts and packages/core/src/audio/audioFxAutomation.ts.
 * Changed: the segment shape is a word (linear, hold, exp, bezier) rather than
 * a numeric exponent; `hold` and a geometric `exp` were added; the via-point
 * arc (viaConic, shapeVia, conicParam) is kept as `bezier` and a bezier with
 * no via point is a smoothstep; the reader clamps and never throws; the
 * schedule is a pure plan (`planLane`) and an emitter that degrades a refused
 * value curve to the same curve as ramps; `render` bakes a lane into samples;
 * the preset, rate-integration and chain-binding machinery is not ported.
 * Licensed under the Apache License, Version 2.0; a copy is at
 * http://www.apache.org/licenses/LICENSE-2.0
 */
import { clamp, finiteOr, sampleRateOr } from './audiocore';

/**
 * Automation: a value that moves over time (a track's volume, the music
 * ducking under a voice, a fade, an effect's knob), drawn as breakpoints.
 *
 * ## The lane
 *
 *   { target: 'volume' | 'rate' | 'fx.<effect id>.<knob>',
 *     points: [{ t, v, curve?, viaX?, viaY? }, ...] }
 *
 * `t` is seconds from the start of the sound the lane belongs to, `v` is in
 * the knob's own unit (a linear gain for volume, Hz for a cutoff). `curve`
 * shapes the segment *leaving* a point:
 *
 * - `linear` (the default): a straight line.
 * - `hold`: the value stays until the next point, then steps to it.
 * - `exp`: geometric, so equal times are equal ratios: a fade that is even in
 *   dB, a sweep that is even in octaves. Between two positive values it is
 *   exactly Web Audio's `exponentialRampToValueAtTime`. A fade to or from 0,
 *   which has no geometric path, runs to or from -80 dB (`EXP_FLOOR`) and
 *   lands on 0 at the point itself; any segment touching a negative value is
 *   drawn straight.
 * - `bezier`: one smooth arc. With a via point (`viaX`, `viaY`: where the arc
 *   passes, as progress through the segment in time and in value, each
 *   0..1) it is the rational quadratic Bézier through that point, ported from
 *   HyperFrames: monotone, no inflection, its widest departure from the
 *   straight line at the via point itself. With none it is a smoothstep, the
 *   ease in and out a person means by "smooth".
 *
 * Before the first point the lane holds the first value, after the last the
 * last, so a lane never snaps to zero at its edges.
 *
 * ## One curve, three consumers
 *
 * `valueAt` is the curve. `render` samples it into a Float32Array for the
 * offline mix (the export), and `planLane` / `compile` hand it to a Web Audio
 * AudioParam for the preview: straight, held and geometric segments as the
 * AudioParam's own ramps, which Web Audio computes per sample by the same
 * formulas; `bezier` and the zero-ended `exp` as a value curve sampled from
 * `valueAt` (at least 200 times a second, denser where the curve bends),
 * which Web Audio joins with straight lines. So the preview and the export
 * agree exactly (to float32) on everything but those two, and there within
 * 1/2000 of the segment's span: `test/pro-audio.test.mjs` replays the plan
 * through a model of the AudioParam timeline, and the app's WebKit, run once,
 * measured 3.7e-4 on a steep via-point arc (docs/pro/audio.md).
 *
 * The reader takes anything (a stored project, a model's answer, a hand
 * edit) and returns a lane that can be played: numbers clamped, times sorted,
 * duplicate times collapsed (the later point wins), at most 4096 points and
 * 32 lanes, nothing that is not on a list. `render`, `planLane` and `compile`
 * read the lane they are given through it again, so a lane built by hand is
 * safe to play; `valueAt` trusts its lane (it runs per sample) and is only
 * kept finite.
 */

export const AUTOMATION_VERSION = 1;

/** The segment shapes. */
export const CURVES = ['linear', 'hold', 'exp', 'bezier'] as const;
export type Curve = (typeof CURVES)[number];

export interface AutoPoint {
  /** Seconds from the start of the sound, 0..3600. */
  t: number;
  /** The value, in the target's unit. */
  v: number;
  /** The shape of the segment leaving this point; absent is `linear`. */
  curve?: Curve;
  /** For `bezier`: where the arc passes, as progress in time (0..1, exclusive). */
  viaX?: number;
  /** For `bezier`: where the arc passes, as progress in value (0..1, exclusive). */
  viaY?: number;
}

export interface Lane {
  /** `volume`, `rate`, or `fx.<effect id>.<knob>`. */
  target: string;
  points: AutoPoint[];
}

export interface Automation {
  version: typeof AUTOMATION_VERSION;
  lanes: Lane[];
}

/** The span a lane's values are held to, and the value an empty lane stands at. */
export interface AutoRange {
  min: number;
  max: number;
  def: number;
}

/** Volume is a linear gain, silence to +12 dB, matching the faders it drives. */
export const VOLUME_RANGE: AutoRange = { min: 0, max: 4, def: 1 };
/** Playback rate, a quarter to four times. */
export const RATE_RANGE: AutoRange = { min: 0.25, max: 4, def: 1 };
/** An effect lane read without its chain: only made finite. */
const OPEN_RANGE: AutoRange = { min: -1e9, max: 1e9, def: 0 };

export const MAX_LANES = 32;
/**
 * Far past any hand-drawn envelope, and room for a generated one (a duck
 * under an hour of speech is about a thousand points); a pathological
 * document still cannot make the scheduler expand without bound.
 */
export const MAX_POINTS = 4096;
export const MAX_SECONDS = 3600;
/** Where a geometric fade to or from silence turns into the step to 0: -80 dB. */
export const EXP_FLOOR = 1e-4;

/**
 * A value curve starts at 200 points a second (at least 16) and is doubled
 * until the straight lines Web Audio draws between its points stay within
 * 1/2000 of the segment's span of the curve at every midpoint, up to 16384
 * points. A steep via-point arc needs the density; a gentle smoothstep does
 * not pay for it.
 */
const CURVE_RATE = 200;
const CURVE_MIN_POINTS = 16;
const CURVE_MAX_POINTS = 16384;
const CURVE_TOLERANCE = 5e-4;

// ── targets ───────────────────────────────────────────────────────────────

export type AutoTarget = { kind: 'volume' } | { kind: 'rate' } | { kind: 'fx'; id: string; param: string };

const FX_TARGET = /^fx\.([A-Za-z0-9_-]{1,32})\.([A-Za-z][A-Za-z0-9]{0,31})$/;

/** What a target string names, or null for anything that is not one. */
export function parseTarget(target: unknown): AutoTarget | null {
  if (target === 'volume') return { kind: 'volume' };
  if (target === 'rate') return { kind: 'rate' };
  if (typeof target !== 'string') return null;
  const m = FX_TARGET.exec(target);
  return m ? { kind: 'fx', id: m[1], param: m[2] } : null;
}

/** Looks up an effect knob's range; audiofx.ts's `fxRangeResolver(chain)` makes one. */
export type RangeResolver = (id: string, param: string) => AutoRange | undefined;

/**
 * The range a target's values are held to. Volume and rate have their own.
 * An effect knob's comes from `resolve` (undefined when the chain has no such
 * effect or knob); with no resolver it is merely finite.
 */
export function rangeOf(target: string, resolve?: RangeResolver): AutoRange | undefined {
  const p = parseTarget(target);
  if (!p) return undefined;
  if (p.kind === 'volume') return VOLUME_RANGE;
  if (p.kind === 'rate') return RATE_RANGE;
  return resolve ? resolve(p.id, p.param) : OPEN_RANGE;
}

// ── reading ───────────────────────────────────────────────────────────────

/** A plain object, or null. */
function record(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** A number that is really there: a missing, null or empty value is not 0. */
function numberOrNull(x: unknown): number | null {
  const n = finiteOr(x, NaN);
  return n === n ? n : null;
}

/** One point, cleaned, or null when its time or value is not a number. */
function readPoint(x: unknown, range: AutoRange): AutoPoint | null {
  const r = record(x);
  if (!r) return null;
  const t = numberOrNull(r.t);
  const v = numberOrNull(r.v);
  if (t === null || v === null) return null;
  const p: AutoPoint = { t: clamp(t, 0, MAX_SECONDS), v: clamp(v, range.min, range.max) };
  const curve = (CURVES as readonly unknown[]).includes(r.curve) ? (r.curve as Curve) : 'linear';
  if (curve !== 'linear') p.curve = curve;
  if (curve === 'bezier') {
    const vx = numberOrNull(r.viaX);
    const vy = numberOrNull(r.viaY);
    // Kept or dropped together: half a via point says nothing.
    if (vx !== null && vy !== null) {
      p.viaX = clamp(vx, 0.001, 0.999);
      p.viaY = clamp(vy, 0.001, 0.999);
    }
  }
  return p;
}

/**
 * One lane, as clean as `readAutomation` makes them, or undefined when the
 * target is not one. `range` overrides the target's own (see `rangeOf`).
 */
export function readLane(x: unknown, range?: AutoRange): Lane | undefined {
  const r = record(x);
  if (!r || typeof r.target !== 'string') return undefined;
  const span = range ?? rangeOf(r.target);
  if (!span || !parseTarget(r.target)) return undefined;
  const raw = Array.isArray(r.points) ? r.points.slice(0, MAX_POINTS * 4) : [];
  const clean = raw
    .map((p) => readPoint(p, span))
    .filter((p): p is AutoPoint => p !== null)
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.t - b.p.t || a.i - b.i)
    .map(({ p }) => p);
  const points: AutoPoint[] = [];
  for (const p of clean) {
    // The later point at the same time wins, so dropping a point onto another replaces it.
    if (points.length && points[points.length - 1].t === p.t) points[points.length - 1] = p;
    else points.push(p);
  }
  return { target: r.target, points: points.slice(0, MAX_POINTS) };
}

/**
 * A whole automation set from anything. Never throws: what cannot be read is
 * left out. Lanes with no points are dropped; two lanes on one target keep
 * the later; at most 32. With `resolve` (audiofx's `fxRangeResolver(chain)`),
 * an effect lane is clamped to its knob's range and a lane on an effect or
 * knob the chain does not have is dropped, so it cannot quietly reattach to
 * an effect that later takes the same id.
 */
export function readAutomation(x: unknown, resolve?: RangeResolver): Automation {
  const r = record(x);
  const raw = r && Array.isArray(r.lanes) ? r.lanes.slice(0, MAX_LANES * 4) : [];
  const byTarget = new Map<string, Lane>();
  for (const item of raw) {
    const target = record(item)?.target;
    if (typeof target !== 'string') continue;
    const range = rangeOf(target, resolve);
    if (!range) continue;
    const lane = readLane(item, range);
    if (!lane || !lane.points.length) continue;
    byTarget.delete(lane.target);
    byTarget.set(lane.target, lane);
  }
  return { version: AUTOMATION_VERSION, lanes: [...byTarget.values()].slice(-MAX_LANES) };
}

// ── the curve ─────────────────────────────────────────────────────────────

/** What an empty lane stands at: unity for volume and rate, 0 for a knob. */
function laneDefault(target: string): number {
  const p = parseTarget(target);
  return p && p.kind !== 'fx' ? 1 : 0;
}

/** 3x² - 2x³: flat at both ends, the bezier with no via point. */
const smoothstep = (x: number): number => x * x * (3 - 2 * x);

/**
 * The conic that carries a segment through its via point: control point and
 * weight of a rational quadratic Bézier from (0,0) to (1,1).
 *
 * A rational quadratic at its own midparameter is (P0 + 2wC + P1) / (2 + 2w),
 * so demanding that equal the via point Q fixes the control point for any
 * weight: C = Q + (Q - M) / w, with M the straight midpoint. The curve
 * therefore passes exactly through Q whatever the weight, and its furthest
 * departure from the straight line is at Q too. The weight buys reach: a
 * plain quadratic (w = 1) cannot pass through a deep or off-centre point
 * without its control point leaving the segment, so take the smallest weight
 * that keeps C inside it (inside is what keeps progress monotone).
 * (HyperFrames, audioAutomation.ts, `viaConic`.)
 */
function viaConic(viaX: number, viaY: number): { cx: number; cy: number; w: number } {
  const dx = viaX - 0.5;
  const dy = viaY - 0.5;
  const edge = 0.999;
  // A via point at the edge leaves no room and would divide to Infinity; past
  // this weight the arc already reads as touching the point.
  const MAX_WEIGHT = 1e6;
  const needX = dx > 0 ? dx / (edge - viaX) : dx < 0 ? -dx / (viaX - (1 - edge)) : 0;
  const needY = dy > 0 ? dy / (edge - viaY) : dy < 0 ? -dy / (viaY - (1 - edge)) : 0;
  const w = Math.min(MAX_WEIGHT, Math.max(1, needX, needY));
  return { cx: viaX + dx / w, cy: viaY + dy / w, w };
}

/** The root of a·t² + b·t + c that lies on the arc (0..1). (HyperFrames, `conicParam`.) */
function conicParam(a: number, b: number, c: number): number {
  if (Math.abs(a) < 1e-12) return Math.abs(b) < 1e-12 ? c : -c / b;
  const root = Math.sqrt(Math.max(0, b * b - 4 * a * c));
  const first = (-b + root) / (2 * a);
  const second = (-b - root) / (2 * a);
  const onArc = (t: number): boolean => t >= -1e-9 && t <= 1 + 1e-9;
  if (onArc(first)) return clamp(first, 0, 1);
  if (onArc(second)) return clamp(second, 0, 1);
  return c;
}

/**
 * Progress through a segment at time-progress `x` along the arc through the
 * via point. Both coordinates are quadratics over one shared denominator, so
 * x(t) = x rearranges into an ordinary quadratic in t: closed form, the same
 * on every machine. (HyperFrames, `shapeVia`.)
 */
function shapeVia(x: number, viaX: number, viaY: number): number {
  const { cx, cy, w } = viaConic(viaX, viaY);
  const spread = 2 - 2 * w;
  const a = x * spread - 1 + 2 * w * cx;
  const b = -x * spread - 2 * w * cx;
  const t = conicParam(a, b, x);
  const rest = 1 - t;
  const den = rest * rest + 2 * w * t * rest + t * t;
  if (!(den > 0)) return x;
  return (2 * w * cy * t * rest + t * t) / den;
}

/** The bezier's progress at `x`: smoothstep, the via arc, or straight when the via point is on the diagonal. */
function bezierProgress(x: number, p: AutoPoint): number {
  if (p.viaX === undefined || p.viaY === undefined) return smoothstep(x);
  if (Math.abs(p.viaX - p.viaY) < 1e-6) return x;
  return clamp(shapeVia(x, p.viaX, p.viaY), 0, 1);
}

/**
 * How a segment from `a` to `b` is drawn and scheduled, once its numbers are
 * known: `exp` between two positive values is geometric (`exp`); with one end
 * at 0 and the other above, geometric through the floor (`floor`); with any
 * negative end, straight.
 */
function shapeOf(a: AutoPoint, b: AutoPoint): 'linear' | 'hold' | 'exp' | 'floor' | 'bezier' {
  const c = a.curve ?? 'linear';
  if (c !== 'exp') return c;
  if (a.v > 0 && b.v > 0) return 'exp';
  if (a.v >= 0 && b.v >= 0 && a.v !== b.v) return 'floor';
  return 'linear';
}

/** The value inside a segment at progress x (0 < x < 1). */
function between(a: AutoPoint, b: AutoPoint, x: number): number {
  switch (shapeOf(a, b)) {
    case 'hold':
      return a.v;
    case 'exp':
      return a.v * Math.pow(b.v / a.v, x);
    case 'floor': {
      const lo = Math.max(a.v, EXP_FLOOR);
      const hi = Math.max(b.v, EXP_FLOOR);
      return lo * Math.pow(hi / lo, x);
    }
    case 'bezier':
      return a.v + (b.v - a.v) * bezierProgress(x, a);
    default:
      return a.v + (b.v - a.v) * x;
  }
}

/**
 * The lane's value at `t` seconds. Exactly a point's value at its own time;
 * the first value before the lane starts and the last after it ends; the
 * target's resting value (unity, or 0 for a knob) when it has no points.
 */
export function valueAt(lane: Lane, t: number): number {
  const pts = lane.points;
  if (!pts.length) return laneDefault(lane.target);
  const time = finiteOr(t, 0);
  if (time <= pts[0].t) return pts[0].v;
  const last = pts[pts.length - 1];
  if (time >= last.t) return last.v;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= time) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[hi];
  if (time === a.t) return a.v;
  const v = between(a, b, (time - a.t) / (b.t - a.t));
  return Number.isFinite(v) ? v : laneDefault(lane.target);
}

/** `lane` as the reader leaves it, so a hand-built lane plays as safely as a read one. */
function reread(lane: Lane): Lane {
  return readLane(lane) ?? { target: 'volume', points: [] };
}

/**
 * The lane baked into `n` samples at `rate`, sample i at `start + i/rate`
 * seconds: what the export multiplies a track by. One walk through the
 * segments, not a search per sample.
 */
export function render(lane: Lane, rate: number, n: number, start = 0): Float32Array {
  const sr = sampleRateOr(rate);
  const len = Math.max(0, Math.min(Math.floor(finiteOr(n, 0)), 2 ** 31 - 1));
  const out = new Float32Array(len);
  const read = reread(lane);
  const pts = read.points;
  const t0 = finiteOr(start, 0);
  if (!pts.length) return out.fill(laneDefault(read.target));
  let seg = 0;
  for (let i = 0; i < len; i++) {
    const t = t0 + i / sr;
    if (t <= pts[0].t) { out[i] = pts[0].v; continue; }
    if (t >= pts[pts.length - 1].t) { out[i] = pts[pts.length - 1].v; continue; }
    while (seg + 1 < pts.length && pts[seg + 1].t <= t) seg++;
    const a = pts[seg];
    const b = pts[seg + 1];
    out[i] = t === a.t ? a.v : between(a, b, (t - a.t) / (b.t - a.t));
  }
  return out;
}

// ── Web Audio ─────────────────────────────────────────────────────────────

/** The part of an AudioParam a lane is scheduled onto. */
export type ParamLike = Pick<AudioParam, 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime' | 'setValueCurveAtTime' | 'cancelScheduledValues'>;

/** One scheduling call; `time` is in the AudioContext's seconds. */
export type ParamOp =
  | { kind: 'set'; value: number; time: number }
  | { kind: 'ramp'; value: number; time: number }
  | { kind: 'exp'; value: number; time: number }
  | { kind: 'curve'; values: Float32Array; time: number; duration: number };

/**
 * The calls that play `lane` on an AudioParam whose context time `t0` is the
 * lane's time 0, scheduling from context time `from` (by default `t0`, or 0 if
 * `t0` is in the past): for a preview that starts three seconds in, `t0` is
 * three seconds before now and `from` is now.
 *
 * It begins with the lane's value at `from`, so the parameter is right before
 * the first point, mid-segment, or after the last. A segment the playhead is
 * inside continues from that value: the rest of a straight or geometric line
 * is the same line, and a curve is sampled from there. A Web Audio ramp runs
 * from the event before it, so a ramp whose segment starts later than the
 * last event is anchored first (`set` at the segment's start); a value curve
 * needs no anchor, and one starting exactly at `from` replaces the opening
 * value (a value curve may not overlap another event at its start in every
 * engine).
 */
export function planLane(given: Lane, t0: number, from?: number): ParamOp[] {
  const lane = reread(given);
  const base = finiteOr(t0, 0);
  const start = Math.max(0, finiteOr(from, Math.max(0, base)));
  const pts = lane.points;
  const local = start - base;
  const ops: ParamOp[] = [];
  const seed: ParamOp = { kind: 'set', value: valueAt(lane, local), time: start };
  // Where the last booked event leaves the parameter, in context time.
  let booked = start;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const Tb = base + b.t;
    if (Tb <= start) continue;
    const Ta = Math.max(start, base + a.t);
    const shape = shapeOf(a, b);
    if ((shape === 'linear' || shape === 'exp') && booked < Ta) ops.push({ kind: 'set', value: a.v, time: Ta });
    if (shape === 'hold') ops.push({ kind: 'set', value: b.v, time: Tb });
    else if (shape === 'linear') ops.push({ kind: 'ramp', value: b.v, time: Tb });
    else if (shape === 'exp') ops.push({ kind: 'exp', value: b.v, time: Tb });
    else ops.push(curveOp(lane, b, Ta - base, Tb - Ta, Ta));
    booked = Tb;
  }
  const first = ops[0];
  if (!(first && first.kind === 'curve' && first.time <= start)) ops.unshift(seed);
  return ops;
}

/**
 * The segment ending at `b`, from lane time `from` for `duration` seconds, as
 * a value curve starting at context time `at`: dense enough that Web Audio's
 * straight lines between its points stay on the curve (see CURVE_TOLERANCE).
 */
function curveOp(lane: Lane, b: AutoPoint, from: number, duration: number, at: number): ParamOp {
  let span = 0;
  let count = clamp(Math.ceil(duration * CURVE_RATE) + 1, CURVE_MIN_POINTS, CURVE_MAX_POINTS);
  let values = new Float32Array(0);
  for (;;) {
    values = new Float32Array(count);
    for (let k = 0; k < count - 1; k++) values[k] = valueAt(lane, from + (k * duration) / (count - 1));
    values[count - 1] = b.v;
    if (!span) for (const v of values) span = Math.max(span, Math.abs(v - values[0]));
    const tol = Math.max(1e-6, CURVE_TOLERANCE * span);
    let worst = 0;
    for (let k = 0; k + 1 < count; k++) {
      const mid = valueAt(lane, from + ((k + 0.5) * duration) / (count - 1));
      worst = Math.max(worst, Math.abs(mid - (values[k] + values[k + 1]) / 2));
    }
    if (worst <= tol || count >= CURVE_MAX_POINTS) break;
    count = Math.min(CURVE_MAX_POINTS, 2 * count - 1);
  }
  return { kind: 'curve', values, time: at, duration };
}

/**
 * Schedule `lane` onto `param` (see `planLane` for `t0` and `from`), first
 * clearing everything booked on it: a reschedule replaces the envelope rather
 * than layering on it, and a value curve still running from an earlier pass
 * would refuse the new events. Clearing from 0 is safe because the plan
 * re-seeds the value at `from`.
 *
 * If the engine refuses a value curve, the same curve is booked as straight
 * ramps through the same points, which is exactly how Web Audio draws a value
 * curve anyway; the envelope never loses its tail to one refused call.
 * Returns the calls that were made.
 */
export function compile(lane: Lane, param: ParamLike, t0: number, from?: number): ParamOp[] {
  const done: ParamOp[] = [];
  try { param.cancelScheduledValues(0); } catch { /* nothing booked */ }
  for (const op of planLane(lane, t0, from)) {
    try {
      if (op.kind === 'set') param.setValueAtTime(op.value, op.time);
      else if (op.kind === 'ramp') param.linearRampToValueAtTime(op.value, op.time);
      else if (op.kind === 'exp') param.exponentialRampToValueAtTime(op.value, op.time);
      else param.setValueCurveAtTime(op.values, op.time, op.duration);
      done.push(op);
    } catch {
      if (op.kind !== 'curve') continue;
      // The curve's first value at its start, then a ramp to each later one.
      const step = op.duration / (op.values.length - 1);
      try {
        param.setValueAtTime(op.values[0], op.time);
        done.push({ kind: 'set', value: op.values[0], time: op.time });
      } catch { /* the previous event already holds this value */ }
      for (let k = 1; k < op.values.length; k++) {
        const r: ParamOp = { kind: 'ramp', value: op.values[k], time: op.time + k * step };
        try { param.linearRampToValueAtTime(r.value, r.time); done.push(r); } catch { /* keep going */ }
      }
    }
  }
  return done;
}
