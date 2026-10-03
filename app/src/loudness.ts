import { clamp, conform, dbToGain, finiteOr, frames, samplePeak, sampleRateOr, truePeakOf } from './audiocore';
import type { Biquad } from './audiocore';

/**
 * Loudness as broadcasters and streaming services measure it: ITU-R
 * BS.1770-4 integrated loudness in LUFS, its true peak in dBTP, and the
 * loudness range of EBU Tech 3342. Written here (it is about two hundred
 * lines) so the app needs neither FFmpeg's `ebur128` nor a library to know
 * how loud a sound is, and so a mix can be brought to a delivery level the
 * same way on every machine.
 *
 * ## How BS.1770 measures
 *
 * 1. **K-weighting.** Each channel goes through two biquads: a high shelf of
 *    about +4 dB above 1.5 kHz (the head's acoustic effect) and a high-pass
 *    near 38 Hz (the ear's insensitivity to the very low). The standard only
 *    prints the coefficients for 48 kHz; `kWeighting` derives them for any
 *    rate from the analogue prototype (f0, gain, Q) by the bilinear
 *    transform, with the prototype values that reproduce the printed 48 kHz
 *    coefficients to nine digits (the derivation libebur128 uses).
 * 2. **Blocks.** Mean squares over 400 ms blocks that start every 100 ms
 *    (75% overlap), summed over channels with weights 1.0 for left, right
 *    and centre, 1.41 for the surrounds and 0 for the LFE.
 * 3. **Gating.** A block's loudness is -0.691 + 10 log10(power). Blocks at or
 *    under -70 LUFS are dropped (the absolute gate: silence must not pull a
 *    programme down); then blocks more than 10 LU under the loudness of what
 *    is left are dropped (the relative gate: the quiet passages of a film do
 *    not make its dialogue level read low). The integrated loudness is the
 *    loudness of the mean power of the blocks that pass both.
 * 4. **True peak.** The waveform is 4x oversampled (a Kaiser-windowed sinc,
 *    `truePeakOf` in audiocore.ts) and the largest magnitude is the peak: a
 *    high tone can crest up to 3 dB above its own samples, and an encoder
 *    clips at the crest, not at the sample.
 *
 * **Loudness range** (EBU Tech 3342) is the spread of the short-term
 * loudness: 3 s windows every 100 ms, gated at -70 LUFS and at 20 LU under
 * their mean, and the distance from the 10th to the 95th percentile in LU.
 *
 * Two places where the standard has no answer and this code chooses one:
 * a sound shorter than one block (a 0.2 s whoosh) is measured as one block of
 * its own length, because it still needs a level and the standard would
 * report none; and a mono sound is measured as one channel, as the standard
 * says, so the same tone reads 3 dB lower in mono than on both sides of a
 * stereo pair.
 *
 * The validations (EBU Tech 3341 and 3342 signals synthesised in
 * `test/pro-audio.test.mjs`): a 1 kHz stereo sine at -23 dBFS reads
 * -23.0 LUFS; steps of 10 dB read 10 LU apart; the gated programmes of 3341
 * read the level of their loud part; silence reads -Infinity; the 3342
 * programmes read their range to within 1 LU.
 */

// ── the contract (docs/PRO.md: package 04 already calls these) ─────────────

/**
 * The two numbers the Phase 0 contract named, and all that `gainToTarget` and
 * `loudnessPlan` need. Kept exactly this shape so that code written against
 * the placeholder (a literal `{ lufs, peakDb }`, a variable typed `Loudness`)
 * still compiles; `measureLoudness` returns the fuller `LoudnessReport`.
 */
export interface Loudness {
  /** Integrated loudness, LUFS. -Infinity for silence (nothing passes the absolute gate). */
  lufs: number;
  /**
   * The true peak in dBTP (4x oversampled), the number a ceiling is checked
   * against. The Phase 0 placeholder reported the sample peak here; this is
   * the field's final meaning. -Infinity for silence.
   */
  peakDb: number;
}

/** Everything `measureLoudness` reads. */
export interface LoudnessReport extends Loudness {
  /** The same number as `peakDb`, under the name the brief gives it. */
  truePeakDb: number;
  /** The largest sample, dBFS: at most `peakDb`. -Infinity for silence. */
  samplePeakDb: number;
  /** Loudness range (EBU Tech 3342), LU. 0 when the sound is too short or too steady to have one. */
  range: number;
}

export interface LoudnessOptions {
  /**
   * A weight per channel. By default every channel weighs 1, except five
   * channels (read as L R C Ls Rs) and six (L R C LFE Ls Rs), which take the
   * BS.1770 weights: 1.41 for the surrounds, 0 for the LFE.
   */
  weights?: readonly number[];
  /** `false` skips the oversampling and reports the sample peak as the peak. */
  truePeak?: boolean;
}

/** The streaming delivery level Motion and Video aim at (RESEARCH.md): -16 LUFS. */
export const DELIVERY_LUFS = -16;
/** The true-peak ceiling under it: -1.5 dBTP leaves room for an AAC encoder's overshoot. */
export const DELIVERY_CEILING_DB = -1.5;

/** The absolute gate, LUFS. */
const ABSOLUTE_GATE = -70;
/** The integrated measure's relative gate, LU under the absolute-gated loudness. */
const RELATIVE_GATE = -10;
/** The loudness range's relative gate, LU. */
const RANGE_GATE = -20;

/** Power to loudness, by the BS.1770 formula. */
const lk = (power: number): number => -0.691 + 10 * Math.log10(power);
/** The power a block must exceed to pass the absolute gate (the same comparison, without a logarithm per block). */
const ABSOLUTE_POWER = Math.pow(10, (ABSOLUTE_GATE + 0.691) / 10);

/**
 * The two K-weighting sections for `sampleRate`: the shelf, then the
 * high-pass. At 48 kHz they are the coefficients printed in BS.1770-4
 * (b0 1.53512485958697, a1 -1.69065929318241, ...); at any other rate they
 * are what the same analogue filter becomes there. The high-pass keeps the
 * standard's unnormalised numerator 1, -2, 1: its gain of a few hundredths of
 * a dB in the passband is part of what the -0.691 constant was calibrated
 * against, so normalising it would move every reading.
 */
export function kWeighting(sampleRate: number): { shelf: Biquad; highpass: Biquad } {
  const sr = sampleRateOr(sampleRate);
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / sr);
  const d = 1 + K1 / Q1 + K1 * K1;
  const highpass: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (K1 * K1 - 1)) / d, a2: (1 - K1 / Q1 + K1 * K1) / d };
  return { shelf, highpass };
}

/** The weight of each of `count` channels (see `LoudnessOptions.weights`). */
function channelWeights(count: number, given: readonly number[] | undefined): number[] {
  const out: number[] = [];
  for (let c = 0; c < count; c++) {
    const def = count === 6 ? [1, 1, 1, 0, 1.41, 1.41][c] : count === 5 ? [1, 1, 1, 1.41, 1.41][c] : 1;
    out.push(clamp(finiteOr(given?.[c], def), 0, 10));
  }
  return out;
}

/** Linear magnitude to dB with silence as -Infinity, as the contract reports it. */
const peakDbOf = (p: number): number => (p > 0 ? 20 * Math.log10(p) : -Infinity);

/**
 * How loud `channels` are (planar, at `sampleRate`): integrated loudness,
 * true and sample peaks, loudness range. Any input gives an answer: no
 * channels, an empty array and silence read -Infinity; a non-finite sample is
 * read as silence.
 *
 * About 45 ms for 30 s of stereo at 48 kHz on music-like material; white
 * noise or a steady full-level tone, where the true-peak search can skip
 * nothing, about 70 to 90 ms (all three are timed in the test; the brief's
 * budget is 150 ms).
 */
export function measureLoudness(channels: readonly Float32Array[], sampleRate: number, options: LoudnessOptions = {}): LoudnessReport {
  const ch = conform(channels);
  const sr = sampleRateOr(sampleRate);
  const n = frames(ch);
  const weights = channelWeights(ch.length, options?.weights);

  // Sums of K-weighted squares over 100 ms hops, all channels weighted into
  // one. Hop j covers [edge(j), edge(j+1)); edges are rounded so a rate that
  // is not a multiple of 10 Hz still tiles the signal exactly. The sample
  // peak is taken in the same pass, so the signal is read once.
  const hopLen = sr / 10;
  const edge = (j: number): number => Math.min(n, Math.round(j * hopLen));
  const hops = Math.floor(n / hopLen + 1e-9);
  const seg = new Float64Array(hops + 1);
  const { shelf, highpass } = kWeighting(sr);
  const { b0, b1, b2, a1, a2 } = shelf;
  const h1 = highpass.a1;
  const h2 = highpass.a2;
  let sp = 0;
  for (let c = 0; c < ch.length; c++) {
    const w = weights[c];
    const x = ch[c];
    if (!(w > 0)) {
      sp = Math.max(sp, samplePeak([x]));
      continue;
    }
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
    for (let j = 0; j <= hops; j++) {
      const end = edge(j + 1);
      let acc = 0;
      for (let i = edge(j); i < end; i++) {
        const v = x[i];
        if (v > sp) sp = v;
        else if (-v > sp) sp = -v;
        const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = v; y2 = y1; y1 = y;
        const z = y - 2 * u1 + u2 - h1 * z1 - h2 * z2;
        u2 = u1; u1 = y; z2 = z1; z1 = z;
        acc += z * z;
      }
      seg[j] += w * acc;
    }
  }
  const tp = options?.truePeak === false || sp === 0 ? sp : Math.max(sp, truePeakOf(ch));
  const peaks = { peakDb: peakDbOf(tp), truePeakDb: peakDbOf(tp), samplePeakDb: peakDbOf(sp) };
  if (!n || sp === 0) return { lufs: -Infinity, ...peaks, range: 0 };

  // 400 ms blocks every 100 ms. A sound shorter than one block is one block.
  const blocks: number[] = [];
  if (hops >= 4) {
    for (let j = 0; j + 4 <= hops; j++) {
      blocks.push((seg[j] + seg[j + 1] + seg[j + 2] + seg[j + 3]) / (edge(j + 4) - edge(j)));
    }
  } else {
    let all = 0;
    for (let j = 0; j <= hops; j++) all += seg[j];
    blocks.push(all / n);
  }
  return { lufs: gatedLoudness(blocks), ...peaks, range: loudnessRange(seg, hops, edge) };
}

/** BS.1770's two-stage gate over block powers; -Infinity when nothing passes. */
function gatedLoudness(blocks: readonly number[]): number {
  let sum = 0;
  let count = 0;
  for (const p of blocks) if (p > ABSOLUTE_POWER) { sum += p; count++; }
  if (!count) return -Infinity;
  const relPower = Math.pow(10, (lk(sum / count) + RELATIVE_GATE + 0.691) / 10);
  let gs = 0;
  let gc = 0;
  for (const p of blocks) if (p > ABSOLUTE_POWER && p > relPower) { gs += p; gc++; }
  // gc >= 1: the loudest block always sits above a gate 10 LU under the mean.
  return lk(gs / gc);
}

/** EBU Tech 3342 loudness range from the hop sums; 0 when there are not two short-term windows to compare. */
function loudnessRange(seg: Float64Array, hops: number, edge: (j: number) => number): number {
  const W = 30; // 3 s of 100 ms hops
  if (hops < W) return 0;
  const powers: number[] = [];
  let run = 0;
  for (let j = 0; j < W; j++) run += seg[j];
  for (let j = 0; j + W <= hops; j++) {
    if (j > 0) run += seg[j + W - 1] - seg[j - 1];
    powers.push(Math.max(0, run) / (edge(j + W) - edge(j)));
  }
  const abs = powers.filter((p) => p > ABSOLUTE_POWER);
  if (abs.length < 2) return 0;
  const gate = lk(abs.reduce((a, p) => a + p, 0) / abs.length) + RANGE_GATE;
  const kept = abs.map(lk).filter((l) => l > gate).sort((a, b) => a - b);
  if (kept.length < 2) return 0;
  const at = (q: number) => kept[Math.round((kept.length - 1) * q)];
  return Math.max(0, at(0.95) - at(0.1));
}

// ── bringing a sound to a level ───────────────────────────────────────────

/** What stopped a gain short of the target, if anything. */
export type LoudnessLimit = 'none' | 'ceiling' | 'max-gain' | 'silence';

export interface LoudnessPlan {
  /** The linear gain to apply. */
  gain: number;
  gainDb: number;
  /** What the gain was held by: the target itself ('none'), the peak ceiling, the gain cap, or nothing to measure. */
  limitedBy: LoudnessLimit;
  /** The loudness after the gain (-Infinity for silence). */
  projectedLufs: number;
  /** The true peak after the gain. */
  projectedPeakDb: number;
}

/**
 * The static gain that brings a measured sound to `target` LUFS, held so the
 * true peak stays at or under `ceiling` dBTP and the gain itself at or under
 * `maxGainDb` (a quiet recording raised 40 dB raises its hiss 40 dB too).
 * One gain for the whole sound: loudness normalisation, not compression.
 * Which limit decided is reported, so a caller can say why a quiet track did
 * not reach the target (HyperFrames' plan reports the same; the idea is from
 * there).
 *
 * Silence is left alone (gain 1, `limitedBy: 'silence'`). Every number that
 * comes back is finite except the projections of silence.
 */
export function loudnessPlan(
  measured: Loudness,
  o: { target?: number; ceiling?: number; maxGainDb?: number } = {},
): LoudnessPlan {
  const target = clamp(finiteOr(o?.target, DELIVERY_LUFS), -70, 0);
  const ceiling = clamp(finiteOr(o?.ceiling, DELIVERY_CEILING_DB), -60, 0);
  const maxGain = clamp(finiteOr(o?.maxGainDb, 120), 0, 120);
  const lufs = measured?.lufs;
  const peak = measured?.peakDb;
  if (typeof lufs !== 'number' || !Number.isFinite(lufs)) {
    return { gain: 1, gainDb: 0, limitedBy: 'silence', projectedLufs: -Infinity, projectedPeakDb: typeof peak === 'number' && Number.isFinite(peak) ? peak : -Infinity };
  }
  let db = target - lufs;
  let limitedBy: LoudnessLimit = 'none';
  if (typeof peak === 'number' && Number.isFinite(peak) && ceiling - peak < db) {
    db = ceiling - peak;
    limitedBy = 'ceiling';
  }
  if (db > maxGain) {
    db = maxGain;
    limitedBy = 'max-gain';
  }
  db = clamp(db, -120, 120);
  return {
    gain: dbToGain(db),
    gainDb: db,
    limitedBy,
    projectedLufs: lufs + db,
    projectedPeakDb: typeof peak === 'number' && Number.isFinite(peak) ? peak + db : -Infinity,
  };
}

/**
 * The linear gain that brings `measured` to `targetLufs` without the peak
 * passing `ceilingDb`. Silence (a loudness that is not finite) is 1. The
 * contract from Phase 0, now on the true peak; `loudnessPlan` says more.
 */
export function gainToTarget(measured: Loudness, targetLufs = DELIVERY_LUFS, ceilingDb = DELIVERY_CEILING_DB): number {
  return loudnessPlan(measured, { target: targetLufs, ceiling: ceilingDb }).gain;
}

/**
 * `channels` measured and brought to the target by one static gain
 * (`loudnessPlan` with the same options): the new channels, the measurement
 * before, and the plan that was applied.
 */
export function normalizeLoudness(
  channels: readonly Float32Array[],
  sampleRate: number,
  o: { target?: number; ceiling?: number; maxGainDb?: number } = {},
): { channels: Float32Array[]; measured: LoudnessReport; plan: LoudnessPlan } {
  const ch = conform(channels);
  const measured = measureLoudness(ch, sampleRate);
  const plan = loudnessPlan(measured, o);
  const g = plan.gain;
  return { channels: ch.map((x) => { const y = new Float32Array(x.length); for (let i = 0; i < x.length; i++) y[i] = x[i] * g; return y; }), measured, plan };
}
