import {
  biquadResponseDb, clamp, conform, convolve, dbToGain, finiteOr, frames, intervalPeaks, mulberry32,
  runBiquads, sampleRateOr, seedFrom,
} from './audiocore';
import type { Biquad } from './audiocore';
import type { AutoRange, RangeResolver } from './audioauto';

/**
 * Six effects, each three things: a **descriptor** (its knobs, their units
 * and ranges) with a reader that clamps whatever it is given; a **pure
 * offline path** (`renderChain`) that the export and the tests use; and a
 * **Web Audio graph builder** (`buildFx`, `buildChain`) for a realtime
 * preview. The effects: a three-band **EQ** (low shelf, peaking, high shelf),
 * a **filter** (high-pass or low-pass, 12 or 24 dB an octave), a
 * **compressor**, a look-ahead **limiter**, a **delay** with feedback, and a
 * **reverb** that convolves with a seeded synthetic room. Five presets name
 * chains of them: Warm, Clear, Room, Radio, Wide.
 *
 * ## Why the preview cannot disagree with the export
 *
 * The export runs `renderChain`, plain JavaScript over Float32Arrays. The
 * preview must not be a second implementation that merely resembles it, so
 * each builder is made of nodes that compute *the same arithmetic*:
 *
 * - **EQ and filter** are `IIRFilterNode`s given the coefficients this file
 *   computes, one per biquad section, not `BiquadFilterNode`s. The browser's
 *   biquad is its own implementation, and its low- and high-pass read Q in
 *   decibels (measured in the app's WebKit: Q 0.707 puts +0.71 dB at the
 *   corner, not the -3 dB a Butterworth has; HyperFrames passes a linear
 *   0.707 into it), so it would only resemble the export.
 * - **Delay** is a cascade of `DelayNode`s, one per echo, each tapped through
 *   a `GainNode`: the same finite series of echoes the offline path sums
 *   (`echoCount`). Not a feedback loop, which engines play differently (see
 *   `echoCount`). Both round the time to whole samples.
 * - **Reverb** is a `ConvolverNode` with `normalize = false` and the same
 *   impulse response (`reverbImpulse`, seeded, so every build of the same
 *   room is the same noise), plus the same dry and wet gains.
 * - **Compressor and limiter** have no Web Audio node that runs this gain
 *   computer, and an AudioWorklet is not allowed in the webview. But every
 *   sound this app previews is known in advance (a rendered bed, a clip), so
 *   `chainEnvelopes` runs the offline chain once and returns each dynamics
 *   stage's gain, sample by sample; the builder plays that gain on a
 *   `GainNode` (`setValueCurveAtTime`, aligned with `startAt`). That is the
 *   export's own gain. Given no envelope (a live input), the builder falls
 *   back to the browser's `DynamicsCompressorNode`, which compresses
 *   differently (and adds its own make-up gain), and says so: `exact: false`.
 *
 * `test/pro-audio.test.mjs` runs every exact builder through a model of these
 * nodes (`test/audiofake.mjs`) and compares it with `renderChain` sample by
 * sample. The same comparison was run once in the app's own engine (macOS
 * 26.2 WKWebView, an OfflineAudioContext; docs/pro/audio.md): EQ, filters,
 * compressor and limiter came out bit for bit, the reverb within 2e-7, the
 * delay within 1.1e-4 on white noise (an AudioParam holds the delay time as
 * float32, so `delayTime x rate` is a hair off a whole sample and WebKit
 * interpolates), a whole six-effect chain within 1e-5. That run is also what
 * found the feedback-loop difference the delay now avoids.
 *
 * A chain's output is as long as its input: a delay's or a reverb's tail past
 * the end is cut, because a bed is exactly as long as its picture. Pad the
 * input with silence to keep a tail.
 *
 * Units are the ones a person thinks in: Hz, dB, milliseconds, a 0..1 mix.
 * No automation of effect knobs is rendered offline yet, so the builders
 * expose no AudioParams for it; automate volume (audioauto.ts) instead.
 */

// ── descriptors ───────────────────────────────────────────────────────────

/** One numeric knob: its range, its resting value, its unit, and whether it is swept on a log scale. */
export interface NumSpec {
  min: number;
  max: number;
  def: number;
  unit: 'Hz' | 'dB' | 'ms' | 'ratio' | 'q' | 'mix' | 'size' | 'seed';
  log?: boolean;
}

const EQ_SPEC = {
  lowFreq: { min: 20, max: 1000, def: 120, unit: 'Hz', log: true },
  lowGain: { min: -24, max: 24, def: 0, unit: 'dB' },
  midFreq: { min: 100, max: 10000, def: 1000, unit: 'Hz', log: true },
  midGain: { min: -24, max: 24, def: 0, unit: 'dB' },
  midQ: { min: 0.1, max: 10, def: 1, unit: 'q', log: true },
  highFreq: { min: 1000, max: 20000, def: 8000, unit: 'Hz', log: true },
  highGain: { min: -24, max: 24, def: 0, unit: 'dB' },
} as const satisfies Record<string, NumSpec>;

const FILTER_SPEC = {
  freq: { min: 20, max: 20000, def: 100, unit: 'Hz', log: true },
  /** Linear Q of a 12 dB/oct section; 0.7071 is Butterworth (maximally flat). Unused at 24 dB/oct, which is Butterworth. */
  q: { min: 0.1, max: 10, def: Math.SQRT1_2, unit: 'q', log: true },
} as const satisfies Record<string, NumSpec>;

const COMPRESSOR_SPEC = {
  threshold: { min: -60, max: 0, def: -18, unit: 'dB' },
  ratio: { min: 1, max: 20, def: 3, unit: 'ratio' },
  /** The width of the soft knee in dB, centred on the threshold; 0 is a hard corner. */
  knee: { min: 0, max: 24, def: 6, unit: 'dB' },
  attack: { min: 0.1, max: 200, def: 10, unit: 'ms', log: true },
  release: { min: 5, max: 2000, def: 150, unit: 'ms', log: true },
  makeup: { min: 0, max: 24, def: 0, unit: 'dB' },
} as const satisfies Record<string, NumSpec>;

const LIMITER_SPEC = {
  ceiling: { min: -24, max: 0, def: -1, unit: 'dB' },
  lookahead: { min: 0.5, max: 20, def: 5, unit: 'ms' },
  release: { min: 10, max: 2000, def: 100, unit: 'ms', log: true },
} as const satisfies Record<string, NumSpec>;

const DELAY_SPEC = {
  time: { min: 10, max: 2000, def: 250, unit: 'ms', log: true },
  feedback: { min: 0, max: 0.9, def: 0.35, unit: 'mix' },
  mix: { min: 0, max: 1, def: 0.3, unit: 'mix' },
} as const satisfies Record<string, NumSpec>;

const REVERB_SPEC = {
  /** 0..1 → a decay (RT60) of 0.3 s to 3 s. */
  size: { min: 0, max: 1, def: 0.5, unit: 'size' },
  /** How much faster the highs die than the lows: 0 is a bright tail, 1 a dark one. */
  damping: { min: 0, max: 1, def: 0.5, unit: 'mix' },
  predelay: { min: 0, max: 100, def: 10, unit: 'ms' },
  mix: { min: 0, max: 1, def: 0.25, unit: 'mix' },
  /** Which room of this size: the noise the impulse is made of. */
  seed: { min: 0, max: 2147483647, def: 1, unit: 'seed' },
} as const satisfies Record<string, NumSpec>;

export const FX_TYPES = ['eq', 'filter', 'compressor', 'limiter', 'delay', 'reverb'] as const;
export type FxType = (typeof FX_TYPES)[number];

/** Every effect's numeric knobs, for a panel to draw and for automation ranges. */
export const FX_SPECS: Readonly<Record<FxType, Readonly<Record<string, NumSpec>>>> = {
  eq: EQ_SPEC,
  filter: FILTER_SPEC,
  compressor: COMPRESSOR_SPEC,
  limiter: LIMITER_SPEC,
  delay: DELAY_SPEC,
  reverb: REVERB_SPEC,
};

type Nums<S> = { -readonly [K in keyof S]: number };

interface FxBase {
  /** A handle automation lanes use (`fx.<id>.<knob>`); letters, digits, `_` and `-`, up to 32. */
  id?: string;
  /** `false` bypasses the effect; absent means on. */
  on?: boolean;
}

export interface EqFx extends FxBase, Nums<typeof EQ_SPEC> { type: 'eq' }
export interface FilterFx extends FxBase, Nums<typeof FILTER_SPEC> { type: 'filter'; mode: 'highpass' | 'lowpass'; slope: 12 | 24 }
export interface CompressorFx extends FxBase, Nums<typeof COMPRESSOR_SPEC> { type: 'compressor' }
/** `truePeak` (default true) holds the 4x-oversampled peak under the ceiling, not only the samples. */
export interface LimiterFx extends FxBase, Nums<typeof LIMITER_SPEC> { type: 'limiter'; truePeak: boolean }
export interface DelayFx extends FxBase, Nums<typeof DELAY_SPEC> { type: 'delay' }
export interface ReverbFx extends FxBase, Nums<typeof REVERB_SPEC> { type: 'reverb' }
export type Fx = EqFx | FilterFx | CompressorFx | LimiterFx | DelayFx | ReverbFx;

/** At most this many effects in a chain. */
export const MAX_CHAIN = 16;

const ID = /^[A-Za-z0-9_-]{1,32}$/;

function record(x: unknown): Record<string, unknown> | null {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
}

/** Each knob of `spec` from `raw`, clamped; missing, null, empty or non-numeric is the default (never 0 by accident). */
function readNums<S extends Record<string, NumSpec>>(spec: S, raw: Record<string, unknown>): Nums<S> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(spec)) {
    const s = spec[key];
    out[key] = clamp(finiteOr(raw[key], s.def), s.min, s.max);
  }
  return out as Nums<S>;
}

/**
 * One effect from anything (a stored chain, a model's answer, a slider), or
 * undefined when it names no effect. Every knob is clamped to its range; an
 * unknown word takes the default; nothing it does not know survives.
 */
export function readFx(x: unknown): Fx | undefined {
  const r = record(x);
  if (!r) return undefined;
  const base: FxBase = {};
  if (typeof r.id === 'string' && ID.test(r.id)) base.id = r.id;
  if (r.on === false) base.on = false;
  switch (r.type) {
    case 'eq': return { type: 'eq', ...base, ...readNums(EQ_SPEC, r) };
    case 'filter': return {
      type: 'filter', ...base, ...readNums(FILTER_SPEC, r),
      mode: r.mode === 'lowpass' ? 'lowpass' : 'highpass',
      slope: finiteOr(r.slope, 12) === 24 ? 24 : 12,
    };
    case 'compressor': return { type: 'compressor', ...base, ...readNums(COMPRESSOR_SPEC, r) };
    case 'limiter': return { type: 'limiter', ...base, ...readNums(LIMITER_SPEC, r), truePeak: r.truePeak !== false };
    case 'delay': return { type: 'delay', ...base, ...readNums(DELAY_SPEC, r) };
    case 'reverb': {
      const fx: ReverbFx = { type: 'reverb', ...base, ...readNums(REVERB_SPEC, r) };
      fx.seed = Math.round(fx.seed);
      return fx;
    }
    default: return undefined;
  }
}

/**
 * A chain from anything: what reads is kept in order, at most 16; an id
 * already used earlier in the chain is dropped from the later effect, so a
 * lane addresses exactly one.
 */
export function readChain(x: unknown): Fx[] {
  const raw = Array.isArray(x) ? x : [];
  const out: Fx[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_CHAIN) break;
    const fx = readFx(item);
    if (!fx) continue;
    if (fx.id !== undefined) {
      if (ids.has(fx.id)) delete fx.id;
      else ids.add(fx.id);
    }
    out.push(fx);
  }
  return out;
}

/** An effect of `type` with every knob at rest. */
export function defaultFx(type: FxType): Fx {
  return readFx({ type }) as Fx;
}

/**
 * The range of knob `param` on the effect with id `id` in `chain`, for
 * audioauto's `readAutomation`: undefined when there is no such effect or no
 * such numeric knob (an enum like a filter's mode has no envelope).
 */
export function fxRangeResolver(chain: readonly Fx[]): RangeResolver {
  return (id: string, param: string): AutoRange | undefined => {
    const fx = chain.find((f) => f.id === id);
    const spec = fx ? FX_SPECS[fx.type][param] : undefined;
    return spec ? { min: spec.min, max: spec.max, def: spec.def } : undefined;
  };
}

// ── filter coefficients ───────────────────────────────────────────────────

/**
 * The frequency a section is designed at: at least 10 Hz, under 49% of the
 * rate, so a 20 kHz shelf at 32 kHz does not fold past Nyquist into nonsense.
 */
const designFreq = (f: number, rate: number): number => clamp(f, 10, 0.49 * rate);

/** Normalise by a0. */
function section(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/**
 * The shelves and the peak are the formulas of the Web Audio specification
 * (the Audio EQ Cookbook with shelf slope S = 1), so a shelf here is the
 * shelf a browser's BiquadFilterNode would be, even though the builder does
 * not use one.
 */
function shelf(kind: 'low' | 'high', f: number, gainDb: number, rate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * designFreq(f, rate)) / rate;
  const c = Math.cos(w);
  const alpha = (Math.sin(w) / 2) * Math.SQRT2;
  const k = 2 * alpha * Math.sqrt(A);
  if (kind === 'low') {
    return section(
      A * (A + 1 - (A - 1) * c + k), 2 * A * (A - 1 - (A + 1) * c), A * (A + 1 - (A - 1) * c - k),
      A + 1 + (A - 1) * c + k, -2 * (A - 1 + (A + 1) * c), A + 1 + (A - 1) * c - k,
    );
  }
  return section(
    A * (A + 1 + (A - 1) * c + k), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - k),
    A + 1 - (A - 1) * c + k, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - k,
  );
}

function peaking(f: number, gainDb: number, q: number, rate: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w = (2 * Math.PI * designFreq(f, rate)) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const c = Math.cos(w);
  return section(1 + alpha * A, -2 * c, 1 - alpha * A, 1 + alpha / A, -2 * c, 1 - alpha / A);
}

/** A second-order low- or high-pass with a LINEAR Q (the cookbook's; the gain at the corner is Q). */
function pass(mode: 'highpass' | 'lowpass', f: number, q: number, rate: number): Biquad {
  const w = (2 * Math.PI * designFreq(f, rate)) / rate;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const b = mode === 'lowpass' ? (1 - c) / 2 : (1 + c) / 2;
  const b1 = mode === 'lowpass' ? 1 - c : -(1 + c);
  return section(b, b1, b, 1 + alpha, -2 * c, 1 - alpha);
}

/** The EQ's three sections at `rate`: low shelf, peak, high shelf. A band at 0 dB is an exact pass-through. */
export function eqSections(fx: EqFx, rate: number): Biquad[] {
  const sr = sampleRateOr(rate);
  return [shelf('low', fx.lowFreq, fx.lowGain, sr), peaking(fx.midFreq, fx.midGain, fx.midQ, sr), shelf('high', fx.highFreq, fx.highGain, sr)];
}

/**
 * The filter's sections: one with the given Q at 12 dB/oct; at 24 dB/oct a
 * fourth-order Butterworth, two sections with Q 1/(2 cos π/8) and
 * 1/(2 cos 3π/8), which is -3 dB at the corner and flat below it.
 */
export function filterSections(fx: FilterFx, rate: number): Biquad[] {
  const sr = sampleRateOr(rate);
  if (fx.slope === 24) {
    return [pass(fx.mode, fx.freq, 1 / (2 * Math.cos(Math.PI / 8)), sr), pass(fx.mode, fx.freq, 1 / (2 * Math.cos((3 * Math.PI) / 8)), sr)];
  }
  return [pass(fx.mode, fx.freq, fx.q, sr)];
}

/** The magnitude response of an EQ or a filter at `freq` Hz, in dB. */
export function fxResponseDb(fx: EqFx | FilterFx, rate: number, freq: number): number {
  return biquadResponseDb(fx.type === 'eq' ? eqSections(fx, rate) : filterSections(fx, rate), freq, rate);
}

// ── dynamics ──────────────────────────────────────────────────────────────

/**
 * The compressor's static curve: the gain change in dB (0 or less) for a
 * level of `levelDb`. Below the knee nothing; above it the excess over the
 * threshold is divided by the ratio; inside the knee a quadratic joins the
 * two with no corner (Giannoulis, Massberg and Reiss, "Digital Dynamic Range
 * Compressor Design", JAES 2012).
 */
export function compressorCurveDb(fx: CompressorFx, levelDb: number): number {
  const over = levelDb - fx.threshold;
  const W = fx.knee;
  const slope = 1 / fx.ratio - 1;
  if (2 * over < -W) return 0;
  if (W > 0 && 2 * Math.abs(over) <= W) return (slope * (over + W / 2) ** 2) / (2 * W);
  return slope * over;
}

/** One-pole smoothing coefficient for a time constant of `ms` at `rate`. */
const pole = (ms: number, rate: number): number => Math.exp(-1 / Math.max(1e-9, (ms / 1000) * rate));

/**
 * The compressor's gain for every sample, make-up included. The level is the
 * largest magnitude across the channels (so stereo is compressed as one and
 * the image does not wander); the static curve turns it into a wanted gain
 * change; that is smoothed in dB, falling at the attack time constant and
 * recovering at the release one. A square wave of steady level therefore
 * settles exactly on the static curve, which is how the test reads the
 * curve off the output.
 */
function compressorGain(ch: readonly Float32Array[], rate: number, fx: CompressorFx): Float32Array {
  const n = frames(ch);
  const out = new Float32Array(n);
  const aA = pole(fx.attack, rate);
  const aR = pole(fx.release, rate);
  const makeup = dbToGain(fx.makeup);
  // Below this level the curve is exactly 0 dB, and no logarithm is needed.
  const quiet = dbToGain(fx.threshold - fx.knee / 2);
  let gs = 0;
  for (let i = 0; i < n; i++) {
    let level = 0;
    for (const x of ch) {
      const a = x[i] < 0 ? -x[i] : x[i];
      if (a > level) level = a;
    }
    const gc = level <= quiet ? 0 : compressorCurveDb(fx, 20 * Math.log10(level));
    gs = gc < gs ? aA * gs + (1 - aA) * gc : aR * gs + (1 - aR) * gc;
    if (gs > -1e-9) gs = 0;
    out[i] = gs === 0 ? makeup : makeup * Math.pow(10, gs / 20);
  }
  return out;
}

/**
 * The limiter's gain for every sample. Offline, look-ahead costs nothing: the
 * gain can read the future directly, so the limiter adds no delay.
 *
 * 1. `need[i]`: the gain sample i needs to sit at the ceiling (1 if it is
 *    under). With `truePeak`, the level is the 4x-oversampled peak of the
 *    intervals either side of the sample (`intervalPeaks`), so a high crest
 *    between samples is caught too.
 * 2. The least `need` from here to `lookahead` ahead (a sliding minimum).
 * 3. That averaged over the last `lookahead` samples: the gain ramps down
 *    over the look-ahead and is fully down when the peak arrives. Every
 *    sample in the average looks at least as far as the peak, so the average
 *    is never more than the peak needs.
 * 4. Recovery: the gain rises toward 1 with the release time constant, and
 *    never above step 3's value.
 *
 * The gain never exceeds 1 (a limiter only attenuates) and never exceeds a
 * sample's own need, so no sample leaves above the ceiling (to the float32 the
 * gain is stored in, a part in ten million). That is the construction, not a
 * clip: no sample is clipped.
 */
function limiterGain(ch: readonly Float32Array[], rate: number, fx: LimiterFx): Float32Array {
  const n = frames(ch);
  const out = new Float32Array(n);
  if (!n) return out;
  const c = dbToGain(fx.ceiling);
  const W = Math.max(1, Math.round((fx.lookahead / 1000) * rate));
  const need = new Float64Array(n);
  const peaks = fx.truePeak ? ch.map((x) => intervalPeaks(x)) : null;
  for (let i = 0; i < n; i++) {
    let level = 0;
    for (let k = 0; k < ch.length; k++) {
      const x = ch[k];
      let a = x[i] < 0 ? -x[i] : x[i];
      if (peaks) {
        const p = peaks[k];
        if (p[i] > a) a = p[i];
        if (i > 0 && p[i - 1] > a) a = p[i - 1];
      }
      if (a > level) level = a;
    }
    need[i] = level > c ? c / level : 1;
  }
  // Sliding minimum over [i, i + W] with a monotonic deque, walked backwards.
  const ahead = new Float64Array(n);
  const dq = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && need[dq[tail - 1]] >= need[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + W) head++;
    ahead[i] = need[dq[head]];
  }
  const r = pole(fx.release, rate);
  let sum = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    sum += ahead[i];
    if (i > W) sum -= ahead[i - W - 1];
    const s = sum / Math.min(i + 1, W + 1);
    g = Math.min(s, g + (1 - g) * (1 - r), need[i]);
    out[i] = g;
  }
  return out;
}

// ── time ──────────────────────────────────────────────────────────────────

/** The delay in whole samples, as both paths use it. */
export function delaySamples(fx: DelayFx, rate: number): number {
  return Math.max(1, Math.round((fx.time / 1000) * sampleRateOr(rate)));
}

/** The echoes stop before the first that would be more than 80 dB under the first. */
const ECHO_FLOOR = 1e-4;
/** At most this many echoes (the most feedback, 0.9, makes 88). */
const MAX_ECHOES = 96;

/**
 * How many echoes the delay makes: one with no feedback, else every echo k
 * whose level feedback^(k-1) is at or above -80 dB (14 at 0.5, 88 at 0.9).
 *
 * A finite number, on purpose. A delay with feedback is naturally a loop
 * (the echo fed back into the line), but a loop cannot be played the same way
 * in every engine: measured in the app's WebKit, every trip round a feedback
 * loop through a DelayNode adds one 128-sample render quantum (an echo asked
 * for at 48 samples comes back at 48, then 224), while Chromium clamps the
 * delay in a loop to 128 samples instead. Either way the preview's echoes
 * would drift from the export's. So both paths make the same finite series of
 * echoes with no loop at all, and agree in any engine; the echoes cut at -80
 * dB are inaudible.
 */
export function echoCount(fx: DelayFx): number {
  if (!(fx.feedback > 0)) return 1;
  return clamp(1 + Math.floor(Math.log(ECHO_FLOOR) / Math.log(fx.feedback) + 1e-9), 1, MAX_ECHOES);
}

/**
 * One channel through the delay: (1 - mix)·x plus mix times the echoes
 * Σ feedback^(k-1)·x[n - kD] for k = 1..K. Computed in one pass by the
 * recursion y[n] = x[n-D] + fb·y[n-D] - fb^K·x[n-(K+1)D], which is that
 * finite sum exactly (the last term takes the echo past the K-th back out).
 */
function delayChannel(x: Float32Array, D: number, fx: DelayFx): Float32Array {
  const n = x.length;
  const K = echoCount(fx);
  const fb = fx.feedback;
  const fbK = Math.pow(fb, K);
  const y = new Float64Array(n);
  const out = new Float32Array(n);
  const dry = 1 - fx.mix;
  const far = (K + 1) * D;
  for (let i = 0; i < n; i++) {
    let v = 0;
    if (i >= D) v = x[i - D] + fb * y[i - D];
    if (i >= far) v -= fbK * x[i - far];
    y[i] = v;
    out[i] = dry * x[i] + fx.mix * v;
  }
  return out;
}

/** The reverb's decay to -60 dB, seconds, for a `size` of 0..1. */
export const reverbSeconds = (size: number): number => 0.3 + 2.7 * clamp(size, 0, 1);

/**
 * The room the reverb convolves with, one impulse per channel (1 or 2): the
 * pre-delay as silence, then noise decaying exponentially to -60 dB over
 * `reverbSeconds(size)`, through a one-pole low-pass that closes along the
 * tail (`damping`), so the highs die first as they do in a real room.
 * Each channel's noise is seeded apart, so a stereo room is wide (the two
 * sides are uncorrelated), and each impulse is scaled to unit energy, so the
 * wet signal is as loud as the dry and `mix` means what it says.
 *
 * Seeded (mulberry32 from the seed, the size, the damping and the channel),
 * so the same room is the same samples every time it is built: the preview's
 * ConvolverNode and the export's convolution hear one room.
 */
export function reverbImpulse(rate: number, fx: ReverbFx, channels = 2): Float32Array[] {
  const sr = sampleRateOr(rate);
  const rt = reverbSeconds(fx.size);
  const len = Math.max(1, Math.ceil(rt * sr));
  const pre = Math.round((clamp(fx.predelay, 0, 100) / 1000) * sr);
  const count = clamp(Math.round(finiteOr(channels, 2)), 1, 2);
  const decay = -6.907755278982137 / (rt * sr); // ln(10⁻³) per sample: -60 dB at rt
  const out: Float32Array[] = [];
  for (let c = 0; c < count; c++) {
    const rand = mulberry32(seedFrom(fx.seed, c, fx.size, fx.damping));
    const ir = new Float32Array(pre + len);
    let y = 0;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const k = 1 - clamp(fx.damping, 0, 1) * (0.15 + (0.8 * i) / len);
      y += k * (rand() * 2 - 1 - y);
      const v = y * Math.exp(decay * i);
      ir[pre + i] = v;
      energy += v * v;
    }
    const s = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = pre; i < ir.length; i++) ir[i] *= s;
    out.push(ir);
  }
  return out;
}

// ── the offline path ──────────────────────────────────────────────────────

/** `x` times a gain per sample. */
function applyGain(x: Float32Array, g: Float32Array): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * g[i];
  return out;
}

/** One effect over conformed channels, reporting a dynamics stage's gain to `onGain`. */
function process(ch: Float32Array[], sr: number, fx: Fx, onGain: (g: Float32Array) => void): Float32Array[] {
  switch (fx.type) {
    case 'eq': {
      const s = eqSections(fx, sr);
      return ch.map((x) => runBiquads(x, s));
    }
    case 'filter': {
      const s = filterSections(fx, sr);
      return ch.map((x) => runBiquads(x, s));
    }
    case 'compressor': {
      const g = compressorGain(ch, sr, fx);
      onGain(g);
      return ch.map((x) => applyGain(x, g));
    }
    case 'limiter': {
      const g = limiterGain(ch, sr, fx);
      onGain(g);
      return ch.map((x) => applyGain(x, g));
    }
    case 'delay': {
      const D = delaySamples(fx, sr);
      return ch.map((x) => delayChannel(x, D, fx));
    }
    case 'reverb': {
      const irs = reverbImpulse(sr, fx, Math.min(2, ch.length));
      const dry = 1 - fx.mix;
      return ch.map((x, c) => {
        const wet = convolve(x, irs[c % irs.length], x.length);
        const out = new Float32Array(x.length);
        for (let i = 0; i < x.length; i++) out[i] = dry * x[i] + fx.mix * wet[i];
        return out;
      });
    }
  }
}

/** The chain run offline, with each entry's dynamics gain (or null) collected by position. */
function run(channels: readonly Float32Array[], rate: number, chain: readonly unknown[]): { out: Float32Array[]; gains: (Float32Array | null)[] } {
  const sr = sampleRateOr(rate);
  let ch = conform(channels);
  const list = Array.isArray(chain) ? chain.slice(0, MAX_CHAIN) : [];
  const gains: (Float32Array | null)[] = list.map(() => null);
  list.forEach((item, i) => {
    const fx = readFx(item);
    if (!fx || fx.on === false || !ch.length) return;
    ch = process(ch, sr, fx, (g) => { gains[i] = g; });
  });
  // conform hands back an input array that needed no repair as it is; never return one of the caller's own arrays.
  const given = Array.isArray(channels) ? channels : [];
  return { out: ch.map((x) => (given.includes(x) ? Float32Array.from(x) : x)), gains };
}

/**
 * `channels` through `chain` at `rate`, offline: what the export writes.
 * Pure (new arrays, the input untouched) and deterministic (the same input is
 * the same bytes). Each entry is read through `readFx`, so a chain straight
 * from a model is safe; an entry that does not read, or is off, is skipped.
 * The output has the input's channel count and length.
 */
export function renderChain(channels: readonly Float32Array[], rate: number, chain: readonly Fx[]): Float32Array[] {
  return run(channels, rate, chain).out;
}

/** One effect: `renderChain` with a chain of one. */
export function renderFx(channels: readonly Float32Array[], rate: number, fx: Fx): Float32Array[] {
  return run(channels, rate, [fx]).out;
}

/**
 * For each entry of `chain`, the gain its compressor or limiter applied to
 * `channels` (null for the other effects and for entries skipped): what
 * `buildChain` needs to make the preview's dynamics the export's own.
 */
export function chainEnvelopes(channels: readonly Float32Array[], rate: number, chain: readonly Fx[]): (Float32Array | null)[] {
  return run(channels, rate, chain).gains;
}

// ── presets ───────────────────────────────────────────────────────────────

export const FX_PRESETS = ['warm', 'clear', 'room', 'radio', 'wide'] as const;
export type FxPreset = (typeof FX_PRESETS)[number];

/** The presets' names in English; a panel shows them through t(). */
export const PRESET_LABELS: Readonly<Record<FxPreset, string>> = { warm: 'Warm', clear: 'Clear', room: 'Room', radio: 'Radio', wide: 'Wide' };

/**
 * What each preset is, as plain data read through `readFx`, so a preset is
 * an ordinary chain anyone can edit afterwards.
 *
 * - Warm: a little more low end and a little less top, gently compressed.
 * - Clear: rumble cut, low-mids thinned, presence and air lifted, compressed
 *   and limited (a voice that has to be understood).
 * - Room: a small, slightly damped room, low in the mix.
 * - Radio: the band a small speaker carries (300 Hz to 3.4 kHz, steep),
 *   a forward midrange, heavy compression and a limiter.
 * - Wide: a large, decorrelated stereo room under a lifted top: spacious
 *   rather than wet. (There is no stereo-width effect among the six; on a
 *   mono sound this is simply a bigger room.)
 */
const PRESETS: Readonly<Record<FxPreset, readonly Record<string, unknown>[]>> = {
  warm: [
    { type: 'eq', lowFreq: 180, lowGain: 3, midFreq: 2500, midGain: -1.5, midQ: 0.8, highFreq: 9000, highGain: -2.5 },
    { type: 'compressor', threshold: -20, ratio: 2, knee: 8, attack: 20, release: 200, makeup: 1.5 },
  ],
  clear: [
    { type: 'filter', mode: 'highpass', freq: 90, slope: 12, q: Math.SQRT1_2 },
    { type: 'eq', lowFreq: 250, lowGain: -2, midFreq: 3200, midGain: 3, midQ: 1, highFreq: 10000, highGain: 2 },
    { type: 'compressor', threshold: -22, ratio: 3, knee: 6, attack: 8, release: 150, makeup: 2 },
    { type: 'limiter', ceiling: -1, lookahead: 5, release: 100, truePeak: true },
  ],
  room: [{ type: 'reverb', size: 0.35, damping: 0.5, predelay: 12, mix: 0.18, seed: 7 }],
  radio: [
    { type: 'filter', mode: 'highpass', freq: 320, slope: 24 },
    { type: 'filter', mode: 'lowpass', freq: 3400, slope: 24 },
    { type: 'eq', lowFreq: 120, lowGain: 0, midFreq: 1500, midGain: 5, midQ: 1.2, highFreq: 8000, highGain: 0 },
    { type: 'compressor', threshold: -28, ratio: 6, knee: 4, attack: 3, release: 80, makeup: 6 },
    { type: 'limiter', ceiling: -1, lookahead: 3, release: 60, truePeak: true },
  ],
  wide: [
    { type: 'eq', lowFreq: 120, lowGain: 0, midFreq: 1000, midGain: 0, midQ: 1, highFreq: 11000, highGain: 2.5 },
    { type: 'reverb', size: 0.75, damping: 0.35, predelay: 28, mix: 0.22, seed: 11 },
  ],
};

/** A fresh copy of a preset's chain, ids `<preset>-1`, `<preset>-2`, ...; an unknown name is an empty chain. */
export function presetChain(id: FxPreset): Fx[] {
  const list = (FX_PRESETS as readonly string[]).includes(id) ? PRESETS[id] : [];
  return readChain(list.map((fx, i) => ({ ...fx, id: `${id}-${i + 1}` })));
}

// ── Web Audio builders ────────────────────────────────────────────────────

/** A built effect: splice `input` and `output` into any graph. */
export interface FxNode {
  input: AudioNode;
  output: AudioNode;
  /** True when the preview computes what `renderChain` computes (see the file comment). */
  exact: boolean;
  /**
   * Re-parameterise in place; false when that is not possible (another type,
   * or an exact compressor or limiter, whose gain was computed for the old
   * settings) and the caller should build again.
   */
  update(next: Fx): boolean;
  dispose(): void;
}

export interface BuildOptions {
  /** The channel count of what will flow through (1 or 2; default 2). A reverb's room has this many sides. */
  channels?: number;
  /** For a compressor or limiter: its gain from `chainEnvelopes`, which makes it exact. */
  envelope?: Float32Array | null;
  /** The rate the envelope was computed at (default the context's). */
  rate?: number;
  /** The context time at which the envelope's first sample plays (default 0). */
  startAt?: number;
}

/** A Web Audio value curve longer than this is decimated (a gain envelope is smooth; memory is not free). */
const MAX_ENVELOPE_POINTS = 1 << 20;

/** Disconnect without throwing (a node already disconnected throws in some engines). */
function unplug(...nodes: AudioNode[]): void {
  for (const n of nodes) {
    try { n.disconnect(); } catch { /* already */ }
  }
}

/** `sections` as a series of IIRFilterNodes between two fixed gains, rebuilt in place on update. */
function iirChain(ctx: BaseAudioContext, sections: Biquad[]): { input: GainNode; output: GainNode; set(s: Biquad[]): void; dispose(): void } {
  const input = ctx.createGain();
  const output = ctx.createGain();
  let inner: AudioNode[] = [];
  const set = (s: Biquad[]): void => {
    unplug(input, ...inner);
    inner = s.map((b) => ctx.createIIRFilter([b.b0, b.b1, b.b2], [1, b.a1, b.a2]));
    let tail: AudioNode = input;
    for (const node of inner) {
      tail.connect(node);
      tail = node;
    }
    tail.connect(output);
  };
  set(sections);
  return { input, output, set, dispose: () => unplug(input, output, ...inner) };
}

/** A dry/wet pair joined at one output. */
function mixer(ctx: BaseAudioContext, mix: number): { input: GainNode; dry: GainNode; wet: GainNode; output: GainNode } {
  const input = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const output = ctx.createGain();
  dry.gain.value = 1 - mix;
  wet.gain.value = mix;
  input.connect(dry);
  dry.connect(output);
  wet.connect(output);
  return { input, dry, wet, output };
}

/** The envelope on a GainNode, from `startAt`: the export's gain, sample for sample. */
function envelopeGain(ctx: BaseAudioContext, env: Float32Array, rate: number, startAt: number): GainNode {
  const g = ctx.createGain();
  const n = env.length;
  g.gain.value = n ? env[0] : 1;
  if (n === 1) g.gain.setValueAtTime(env[0], startAt);
  if (n >= 2) {
    const step = Math.max(1, Math.ceil((n - 1) / (MAX_ENVELOPE_POINTS - 1)));
    const count = Math.floor((n - 1) / step) + 1;
    const curve = new Float32Array(count);
    for (let k = 0; k < count; k++) curve[k] = env[k * step];
    g.gain.setValueCurveAtTime(curve, startAt, ((count - 1) * step) / rate);
  }
  return g;
}

/**
 * The Web Audio graph for one effect (see the file comment for what makes
 * each exact). The effect is read through `readFx` first; one that does not
 * read, or is off, is a pass-through.
 */
export function buildFx(ctx: BaseAudioContext, effect: Fx, o: BuildOptions = {}): FxNode {
  const fx = readFx(effect);
  const sr = ctx.sampleRate;
  const channels = clamp(Math.round(finiteOr(o?.channels, 2)), 1, 2);
  if (!fx || fx.on === false) {
    const through = ctx.createGain();
    return { input: through, output: through, exact: true, update: () => false, dispose: () => unplug(through) };
  }
  switch (fx.type) {
    case 'eq':
    case 'filter': {
      const sections = (f: EqFx | FilterFx) => (f.type === 'eq' ? eqSections(f, sr) : filterSections(f, sr));
      // An IIRFilterNode's coefficients are fixed, so a new setting is new nodes (their state starts
      // from silence: a loud signal can tick once as a knob moves; the export never moves a knob).
      const chain = iirChain(ctx, sections(fx));
      return {
        input: chain.input, output: chain.output, exact: true,
        update: (next) => {
          const r = readFx(next);
          if (!r || r.type !== fx.type || r.on === false) return false;
          chain.set(sections(r as EqFx | FilterFx));
          return true;
        },
        dispose: chain.dispose,
      };
    }
    case 'delay': {
      // One delay line per echo, in a cascade, each tapped through its own
      // gain into the wet side: the echoes of `echoCount` with no feedback
      // loop, so they land where the export's do in any engine. `feed` stays
      // put so the cascade can be replaced without touching the dry side.
      const m = mixer(ctx, fx.mix);
      const feed = ctx.createGain();
      m.input.connect(feed);
      let lines: DelayNode[] = [];
      let taps: GainNode[] = [];
      let shape = '';
      const shapeOf = (f: DelayFx) => `${echoCount(f)}:${delaySamples(f, sr)}`;
      const cascade = (f: DelayFx) => {
        unplug(feed, ...lines, ...taps);
        const seconds = delaySamples(f, sr) / sr;
        lines = [];
        taps = [];
        let tail: AudioNode = feed;
        for (let k = 0; k < echoCount(f); k++) {
          const line = ctx.createDelay(seconds + 0.01);
          line.delayTime.value = seconds;
          const tap = ctx.createGain();
          tap.gain.value = Math.pow(f.feedback, k);
          tail.connect(line);
          line.connect(tap);
          tap.connect(m.wet);
          lines.push(line);
          taps.push(tap);
          tail = line;
        }
        shape = shapeOf(f);
      };
      cascade(fx);
      return {
        input: m.input, output: m.output, exact: true,
        update: (next) => {
          const r = readFx(next);
          if (!r || r.type !== 'delay' || r.on === false) return false;
          if (shapeOf(r) !== shape) cascade(r);
          else taps.forEach((tap, k) => { tap.gain.value = Math.pow(r.feedback, k); });
          m.dry.gain.value = 1 - r.mix;
          m.wet.gain.value = r.mix;
          return true;
        },
        dispose: () => unplug(m.input, m.dry, m.wet, m.output, feed, ...lines, ...taps),
      };
    }
    case 'reverb': {
      const m = mixer(ctx, fx.mix);
      let room = fx;
      const convolver = (f: ReverbFx): ConvolverNode => {
        const irs = reverbImpulse(sr, f, channels);
        const buf = ctx.createBuffer(irs.length, irs[0].length, sr);
        irs.forEach((ir, c) => buf.getChannelData(c).set(ir));
        const conv = ctx.createConvolver();
        // Before the buffer: normalize applies when the buffer is set.
        conv.normalize = false;
        conv.buffer = buf;
        return conv;
      };
      let conv = convolver(fx);
      m.input.connect(conv);
      conv.connect(m.wet);
      return {
        input: m.input, output: m.output, exact: true,
        update: (next) => {
          const r = readFx(next);
          if (!r || r.type !== 'reverb' || r.on === false) return false;
          if (r.size !== room.size || r.damping !== room.damping || r.predelay !== room.predelay || r.seed !== room.seed) {
            // A new node rather than a new buffer: setting a convolver's buffer twice is refused by older engines.
            const fresh = convolver(r);
            m.input.connect(fresh);
            fresh.connect(m.wet);
            unplug(conv);
            conv = fresh;
          }
          m.dry.gain.value = 1 - r.mix;
          m.wet.gain.value = r.mix;
          room = r;
          return true;
        },
        dispose: () => unplug(m.input, m.dry, m.wet, m.output, conv),
      };
    }
    case 'compressor':
    case 'limiter': {
      if (o?.envelope instanceof Float32Array) {
        const g = envelopeGain(ctx, o.envelope, sampleRateOr(finiteOr(o.rate, sr)), Math.max(0, finiteOr(o.startAt, 0)));
        return { input: g, output: g, exact: true, update: () => false, dispose: () => unplug(g) };
      }
      // No envelope: the browser's compressor, close but not the same.
      const dc = ctx.createDynamicsCompressor();
      const makeup = ctx.createGain();
      const apply = (f: CompressorFx | LimiterFx) => {
        if (f.type === 'compressor') {
          dc.threshold.value = f.threshold;
          dc.knee.value = clamp(f.knee, 0, 40);
          dc.ratio.value = f.ratio;
          dc.attack.value = clamp(f.attack / 1000, 0, 1);
          dc.release.value = clamp(f.release / 1000, 0, 1);
          makeup.gain.value = dbToGain(f.makeup);
        } else {
          dc.threshold.value = f.ceiling;
          dc.knee.value = 0;
          dc.ratio.value = 20;
          dc.attack.value = 0.001;
          dc.release.value = clamp(f.release / 1000, 0, 1);
          makeup.gain.value = 1;
        }
      };
      apply(fx);
      dc.connect(makeup);
      return {
        input: dc, output: makeup, exact: false,
        update: (next) => {
          const r = readFx(next);
          if (!r || r.type !== fx.type || r.on === false) return false;
          apply(r as CompressorFx | LimiterFx);
          return true;
        },
        dispose: () => unplug(dc, makeup),
      };
    }
  }
}

/** A built chain: the effects in series between `input` and `output`. */
export interface FxChainNode {
  input: AudioNode;
  output: AudioNode;
  /** The built effects, one per entry that reads and is on, in order. */
  nodes: FxNode[];
  /** True when every effect in it is exact. */
  exact: boolean;
  dispose(): void;
}

/**
 * The Web Audio graph for `chain`, in series. `envelopes` is
 * `chainEnvelopes(...)` for the same chain and sound, by position: with it,
 * the compressors and limiters play the export's own gain from `startAt`.
 */
export function buildChain(
  ctx: BaseAudioContext,
  chain: readonly Fx[],
  o: { channels?: number; envelopes?: readonly (Float32Array | null)[]; rate?: number; startAt?: number } = {},
): FxChainNode {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const nodes: FxNode[] = [];
  let tail: AudioNode = input;
  const list = Array.isArray(chain) ? chain.slice(0, MAX_CHAIN) : [];
  list.forEach((item, i) => {
    const fx = readFx(item);
    if (!fx || fx.on === false) return;
    const node = buildFx(ctx, fx, { channels: o?.channels, envelope: o?.envelopes?.[i] ?? null, rate: o?.rate, startAt: o?.startAt });
    tail.connect(node.input);
    tail = node.output;
    nodes.push(node);
  });
  tail.connect(output);
  return {
    input, output, nodes,
    exact: nodes.every((n) => n.exact),
    dispose: () => {
      for (const n of nodes) n.dispose();
      unplug(input, output);
    },
  };
}
