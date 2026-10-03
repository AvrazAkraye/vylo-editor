/**
 * The numbers under every sound the app makes: decibels, a seeded random
 * stream, channel layouts, resampling, mixing, fades, soft clipping, the
 * biquad section, an FFT with convolution, and the 4x interpolation a true
 * peak is read from. Written here rather than taken from a library, for the
 * same reason Motion draws with no library (docs/MOTION.md, docs/PRO.md).
 *
 * Pure on purpose: no DOM, no Web Audio, no clock, nothing kept between calls,
 * and nothing random that is not seeded. The offline renderer (`audiofx.ts`),
 * the loudness meter (`loudness.ts`), automation (`audioauto.ts`) and ducking
 * (`audioduck.ts`) are built on these, and the export writes what they
 * return, so the same input is the same bytes on every run.
 *
 * Total, too. Sound reaches these functions from decoders, from a model's
 * numbers and from a person's slider, and a NaN in an audio buffer is not an
 * error anyone sees: it silences the rest of a Web Audio node's life, or it
 * turns a whole exported track into noise. So nothing here throws, a
 * non-finite sample is read as silence, a non-finite parameter as the nearest
 * sensible value (each function says which), and finite input gives finite
 * output.
 *
 * **Channels are planar**: one `Float32Array` per channel, all the same length
 * (`conform` makes them so). Functions return new arrays and never write to
 * their arguments.
 */

// ── numbers ───────────────────────────────────────────────────────────────

/** The quietest level a dB reading reports: far under anything audible, and finite. */
export const DB_FLOOR = -200;

/** The loudest gain `dbToGain` hands out (+120 dB): anything past it is a broken number, not a level. */
const DB_CEILING = 120;

/** `x` when it is a finite number (or a string that spells one), else `fallback`. */
export function finiteOr(x: unknown, fallback: number): number {
  if (typeof x === 'number') return Number.isFinite(x) ? x : fallback;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * `x` held to `lo`..`hi`. A NaN reads as `lo`, the safe edge, as in
 * motionmath's `clamp`; when the bounds cross, `lo` wins.
 */
export function clamp(x: number, lo: number, hi: number): number {
  if (x !== x) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi < lo ? lo : hi;
  return x;
}

/**
 * Decibels to a linear gain. `-Infinity` is silence (0); NaN reads as 0 dB
 * (unity), because a broken number should leave a level alone rather than
 * mute it or blow it up; anything over +120 dB is held there.
 */
export function dbToGain(db: number): number {
  if (db !== db) return 1;
  if (db === -Infinity) return 0;
  return Math.pow(10, Math.min(db, DB_CEILING) / 20);
}

/**
 * A linear gain (or a sample's magnitude) to decibels. Silence and anything
 * under 10⁻¹⁰ read as `DB_FLOOR` (-200 dB) rather than -Infinity, so the
 * answer can always be added to, compared and drawn; a NaN reads as silence.
 */
export function gainToDb(g: number): number {
  const a = Math.abs(g);
  if (!(a > 1e-10)) return DB_FLOOR;
  return 20 * Math.log10(a);
}

// ── seeded randomness ─────────────────────────────────────────────────────

/**
 * mulberry32: a fast 32-bit generator with a full 2³² period, returning
 * numbers in [0, 1). The only randomness sound may use: a reverb's room is
 * noise, and if it were `Math.random` noise, the preview and the export (and
 * two exports) would be different rooms. The seed is taken as an unsigned
 * 32-bit integer (`>>> 0`), so any finite number works; a non-finite one is 0.
 *
 * This is the textbook mulberry32 with no seed scrambling, so its output can
 * be checked against any other copy of it. A caller that needs unrelated
 * streams from neighbouring seeds runs them through `seedFrom` first.
 */
export function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? seed : 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One 32-bit seed from several numbers (a parameter set, a channel index), so
 * the same room always gets the same noise and a neighbouring one different
 * noise. Each number is folded in through murmur3's finaliser, which spreads
 * a one-bit difference over all 32 bits; fractions count to 1/1000.
 */
export function seedFrom(...values: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    const n = Number.isFinite(v) ? Math.round(v * 1000) : 0;
    h = Math.imul(h ^ (n | 0), 0x85ebca6b);
    h = Math.imul(h ^ Math.floor(n / 4294967296), 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

// ── channels ──────────────────────────────────────────────────────────────

/** The length every channel is read at: the longest one. */
export function frames(channels: readonly Float32Array[]): number {
  let n = 0;
  for (const c of channels) if (c && c.length > n) n = c.length;
  return n;
}

/**
 * The channels as arrays of one length with only finite samples: a shorter
 * channel is padded with silence, and a NaN or an infinity is read as
 * silence. A channel that is already fine is returned as it is (not copied),
 * so this costs one pass of reading when there is nothing to repair; the
 * caller must not write to what it returns.
 *
 * This is the door every public function that takes samples goes through.
 */
export function conform(channels: readonly Float32Array[]): Float32Array[] {
  const list = Array.isArray(channels) ? channels.filter((c) => c instanceof Float32Array) : [];
  const n = frames(list);
  return list.map((c) => {
    let clean = c.length === n;
    if (clean) {
      for (let i = 0; i < n; i++) {
        const v = c[i];
        if (v - v !== 0) { clean = false; break; }
      }
    }
    if (clean) return c;
    const out = new Float32Array(n);
    for (let i = 0; i < c.length; i++) {
      const v = c[i];
      out[i] = v - v === 0 ? v : 0;
    }
    return out;
  });
}

/** Planar channels to one interleaved array (L R L R ...), as a WAV or an encoder wants them. */
export function interleave(channels: readonly Float32Array[]): Float32Array {
  const ch = conform(channels);
  const k = ch.length;
  const n = frames(ch);
  const out = new Float32Array(n * k);
  for (let c = 0; c < k; c++) {
    const x = ch[c];
    for (let i = 0; i < n; i++) out[i * k + c] = x[i];
  }
  return out;
}

/**
 * Interleaved samples back to planar channels. A count below 1 is read as 1;
 * a trailing partial frame is dropped; a non-finite sample becomes silence.
 */
export function deinterleave(data: Float32Array, channelCount: number): Float32Array[] {
  const k = Math.max(1, Math.floor(finiteOr(channelCount, 1)));
  const n = data instanceof Float32Array ? Math.floor(data.length / k) : 0;
  const out: Float32Array[] = [];
  for (let c = 0; c < k; c++) {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = data[i * k + c];
      x[i] = v - v === 0 ? v : 0;
    }
    out.push(x);
  }
  return out;
}

/**
 * The channels averaged into one. An average, not a sum, so a stereo track
 * whose two sides are the same comes out at the level it had; no channels is
 * an empty array.
 */
export function mixdown(channels: readonly Float32Array[]): Float32Array {
  const ch = conform(channels);
  const n = frames(ch);
  const out = new Float32Array(n);
  if (!ch.length) return out;
  const w = 1 / ch.length;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const x of ch) s += x[i];
    out[i] = s * w;
  }
  return out;
}

/**
 * `source` added into a copy of `target`, times `gain`, starting at sample
 * `at` (which may be negative: the part before the start is dropped). The
 * result is as long as `target`; what would fall past its end is dropped.
 */
export function mixInto(target: Float32Array, source: Float32Array, gain = 1, at = 0): Float32Array {
  const [t] = conform([target]);
  const [s] = conform([source]);
  const out = Float32Array.from(t ?? []);
  const g = finiteOr(gain, 1);
  const o = Math.round(finiteOr(at, 0));
  const from = Math.max(0, -o);
  const to = Math.min(s?.length ?? 0, out.length - o);
  for (let i = from; i < to; i++) out[i + o] += s[i] * g;
  return out;
}

/**
 * Fades at both ends, so a sound starts and stops without a click: a raised
 * cosine (0.5 - 0.5 cos), which has no corner where it meets silence or full
 * level, over `fadeIn` and `fadeOut` seconds. When the two would overlap in a
 * short sound, each is shortened to half of it.
 */
export function fadeEdges(channels: readonly Float32Array[], rate: number, fadeIn: number, fadeOut: number): Float32Array[] {
  const ch = conform(channels);
  const n = frames(ch);
  const sr = sampleRateOr(rate);
  const half = Math.floor(n / 2);
  const fi = Math.min(half, Math.round(clamp(finiteOr(fadeIn, 0), 0, 3600) * sr));
  const fo = Math.min(half, Math.round(clamp(finiteOr(fadeOut, 0), 0, 3600) * sr));
  return ch.map((x) => {
    const out = Float32Array.from(x);
    for (let i = 0; i < fi; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fi);
    for (let i = 0; i < fo; i++) out[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fo);
    return out;
  });
}

/**
 * One sample through the soft clipper: unchanged up to `knee`, then bent
 * along a tanh so it approaches 1 and never passes it (in floating point a
 * very loud sample lands on 1.0 exactly). Value and slope are continuous at
 * the knee (the curve leaves it at slope 1), so a peak that crosses it bends
 * rather than breaks. `knee` is held to 0..0.99.
 */
export function softClipSample(x: number, knee = 0.8): number {
  if (x - x !== 0) return x === Infinity ? 1 : x === -Infinity ? -1 : 0;
  const k = clamp(knee, 0, 0.99);
  const a = Math.abs(x);
  if (a <= k) return x;
  const room = 1 - k;
  const y = k + room * Math.tanh((a - k) / room);
  return x < 0 ? -y : y;
}

/** Every sample through `softClipSample`: a ceiling of 1 that rounds a peak off instead of squaring it. */
export function softClip(channels: readonly Float32Array[], knee = 0.8): Float32Array[] {
  return conform(channels).map((x) => {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = softClipSample(x[i], knee);
    return out;
  });
}

/** The largest sample magnitude across the channels (linear; 0 for silence or nothing). */
export function samplePeak(channels: readonly Float32Array[]): number {
  let p = 0;
  for (const x of conform(channels)) {
    for (let i = 0; i < x.length; i++) {
      const a = x[i] < 0 ? -x[i] : x[i];
      if (a > p) p = a;
    }
  }
  return p;
}

/**
 * A sample rate to work at: a finite rate held to 1 kHz..768 kHz, anything
 * else 48 kHz. Every module reads a rate through this, so a rate of 0 or NaN
 * can never become a division by zero.
 */
export function sampleRateOr(rate: number): number {
  return Number.isFinite(rate) && rate > 0 ? clamp(rate, 1000, 768000) : 48000;
}

// ── biquads ───────────────────────────────────────────────────────────────

/**
 * One second-order section, normalised so a0 = 1:
 *   y[n] = b0 x[n] + b1 x[n-1] + b2 x[n-2] - a1 y[n-1] - a2 y[n-2]
 * The shape both the K-weighting filter and the EQ are made of.
 */
export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/**
 * `x` through `sections` in series (direct form I, state in doubles, so a
 * long low shelf does not drift). A section with a non-finite coefficient is
 * skipped rather than allowed to fill the output with NaN.
 */
export function runBiquads(x: Float32Array, sections: readonly Biquad[]): Float32Array {
  const [src] = conform([x]);
  const out = Float32Array.from(src ?? []);
  for (const s of sections) {
    const { b0, b1, b2, a1, a2 } = s;
    if (!(Number.isFinite(b0) && Number.isFinite(b1) && Number.isFinite(b2) && Number.isFinite(a1) && Number.isFinite(a2))) continue;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const v = out[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = v;
      y2 = y1;
      y1 = y;
      out[i] = y;
    }
  }
  return out;
}

/**
 * The magnitude of `sections` in series at `freq` Hz, in dB: H(z) evaluated
 * on the unit circle. What a filter is designed against and what the tests
 * check a filter's actual output against.
 */
export function biquadResponseDb(sections: readonly Biquad[], freq: number, rate: number): number {
  const w = (2 * Math.PI * finiteOr(freq, 0)) / sampleRateOr(rate);
  const c1 = Math.cos(w);
  const s1 = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  let db = 0;
  for (const { b0, b1, b2, a1, a2 } of sections) {
    const nr = b0 + b1 * c1 + b2 * c2;
    const ni = -(b1 * s1 + b2 * s2);
    const dr = 1 + a1 * c1 + a2 * c2;
    const di = -(a1 * s1 + a2 * s2);
    db += 10 * Math.log10((nr * nr + ni * ni) / Math.max(1e-300, dr * dr + di * di));
  }
  return Number.isFinite(db) ? db : DB_FLOOR;
}

// ── windowed sinc ─────────────────────────────────────────────────────────

/** sin(πx)/(πx), 1 at 0. */
function sinc(x: number): number {
  if (Math.abs(x) < 1e-12) return 1;
  const p = Math.PI * x;
  return Math.sin(p) / p;
}

/** The modified Bessel function I₀, by its power series (converges fast for the β used here). */
function besselI0(x: number): number {
  let sum = 1;
  let term = 1;
  const q = (x * x) / 4;
  for (let k = 1; k < 60; k++) {
    term *= q / (k * k);
    sum += term;
    if (term < sum * 1e-17) break;
  }
  return sum;
}

/** A Kaiser window at `u` in -1..1 (0 outside): β trades a wider transition for deeper stopband. */
function kaiser(u: number, beta: number, i0beta: number): number {
  if (u <= -1 || u >= 1) return 0;
  return besselI0(beta * Math.sqrt(1 - u * u)) / i0beta;
}

// ── true peak ─────────────────────────────────────────────────────────────

/**
 * Samples either side of the point being interpolated for the true-peak
 * oversampler (16 per phase), and the Kaiser β. Chosen by measuring each
 * phase's error against the ideal interpolator: within 0.006 dB up to 16 kHz
 * and 0.03 dB up to 18 kHz at 48 kHz, which is well inside the +0.2/-0.4 dB
 * EBU Tech 3341 allows a true-peak meter. (BS.1770-4's example filter has 12
 * per phase and reads a loud 18 kHz tone a few tenths low.)
 */
const TP_HALF = 8;
const TP_BETA = 7;

/**
 * The 4x interpolator for the points a quarter, a half and three quarters of
 * the way from sample i to i+1, as weights on samples i-7..i+8: a
 * Kaiser-windowed sinc cut at the original Nyquist, each phase scaled to sum
 * to 1 so a constant reads exactly its own level. (The sample itself is the
 * fourth phase and needs no weights.)
 *
 * Folded for speed, because this runs on every sample of everything measured.
 * The three-quarter phase is the quarter phase reversed and the half phase is
 * its own reverse, so with u = x[i-7+k] + x[i+8-k] and v = their difference,
 *   half          = Σ HALF[k]·u
 *   quarter       = Σ EVEN[k]·u + ODD[k]·v
 *   three-quarter = Σ EVEN[k]·u - ODD[k]·v
 * over k < 8: 24 multiplications per sample where the plain form takes 48.
 */
const TP = (() => {
  const i0 = besselI0(TP_BETA);
  const W = 2 * TP_HALF;
  const row = (p: number): Float64Array => {
    const r = new Float64Array(W);
    let sum = 0;
    for (let k = 0; k < W; k++) {
      // Tap k weighs sample i + (k - TP_HALF + 1); the point is at i + p/4.
      const d = p / 4 - (k - TP_HALF + 1);
      r[k] = sinc(d) * kaiser(d / (TP_HALF + 0.25), TP_BETA, i0);
      sum += r[k];
    }
    for (let k = 0; k < W; k++) r[k] /= sum;
    return r;
  };
  const q = row(1);
  const h = row(2);
  const even = new Float64Array(TP_HALF);
  const odd = new Float64Array(TP_HALF);
  const half = new Float64Array(TP_HALF);
  for (let k = 0; k < TP_HALF; k++) {
    even[k] = (q[k] + q[W - 1 - k]) / 2;
    odd[k] = (q[k] - q[W - 1 - k]) / 2;
    half[k] = h[k];
  }
  // The largest an interpolated point can be relative to the loudest sample
  // it is made from (the sum of a phase's absolute weights): `truePeakOf`
  // skips any stretch whose samples times this cannot beat the peak so far.
  const gain = Math.max(q.reduce((s, v) => s + Math.abs(v), 0), h.reduce((s, v) => s + Math.abs(v), 0));
  return { even, odd, half, gain };
})();

/**
 * The largest magnitude among the three points interpolated between sample i
 * and i+1. Samples outside the array are silence.
 */
function interpPeak(x: Float32Array, i: number): number {
  const n = x.length;
  const lo = i - TP_HALF + 1;
  const hi = i + TP_HALF;
  const { even, odd, half } = TP;
  let S = 0;
  let D = 0;
  let T = 0;
  if (lo >= 0 && hi < n) {
    for (let k = 0; k < TP_HALF; k++) {
      const a = x[lo + k];
      const c = x[hi - k];
      const u = a + c;
      S += even[k] * u;
      D += odd[k] * (a - c);
      T += half[k] * u;
    }
  } else {
    for (let k = 0; k < TP_HALF; k++) {
      const ia = lo + k;
      const ic = hi - k;
      const a = ia >= 0 && ia < n ? x[ia] : 0;
      const c = ic >= 0 && ic < n ? x[ic] : 0;
      const u = a + c;
      S += even[k] * u;
      D += odd[k] * (a - c);
      T += half[k] * u;
    }
  }
  const p1 = Math.abs(S + D);
  const p3 = Math.abs(S - D);
  const p2 = Math.abs(T);
  return p1 > p2 ? (p1 > p3 ? p1 : p3) : p2 > p3 ? p2 : p3;
}

/**
 * For each sample i, the largest magnitude among the sample and the three
 * points interpolated after it (i + 1/4, 1/2, 3/4): the waveform's peak over
 * the interval [i, i+1) as a 4x-oversampled meter sees it. The limiter reads
 * this so it can hold the true peak, not only the samples, under a ceiling.
 */
export function intervalPeaks(x: Float32Array): Float32Array {
  const [s] = conform([x]);
  const src = s ?? new Float32Array(0);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const a = src[i] < 0 ? -src[i] : src[i];
    const m = interpPeak(src, i);
    out[i] = a > m ? a : m;
  }
  return out;
}

/** Samples per stretch `truePeakOf` ranks and skips by. */
const TP_BLOCK = 256;

/**
 * The true peak of the channels (linear): the largest magnitude of the
 * waveform 4x oversampled, as ITU-R BS.1770-4 Annex 2 measures it. At least
 * the sample peak, and up to about 3 dB over it for a high tone whose samples
 * straddle its crests.
 *
 * Exact, and quick on real material. An interpolated point can never exceed
 * the loudest sample within reach of it times `TP.gain`, so the signal is
 * cut into stretches, the stretches are visited loudest first, and the search
 * stops as soon as no remaining stretch could beat the peak already found.
 * Music spends most of its time well under its peak, so most of it is never
 * interpolated; a steady full-level tone or white noise is the worst case and
 * is simply read in full.
 */
export function truePeakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const x of conform(channels)) {
    const n = x.length;
    if (!n) continue;
    const blocks = Math.ceil(n / TP_BLOCK);
    // The loudest sample within reach of each stretch: its own samples and the
    // TP_HALF on either side that its interpolated points also weigh.
    const reach = new Float64Array(blocks);
    const own = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let m = 0;
      const end = Math.min(n, (b + 1) * TP_BLOCK);
      for (let i = b * TP_BLOCK; i < end; i++) {
        const a = x[i] < 0 ? -x[i] : x[i];
        if (a > m) m = a;
      }
      own[b] = m;
      if (m > peak) peak = m;
    }
    for (let b = 0; b < blocks; b++) {
      // TP_HALF < TP_BLOCK, so the neighbours' own maxima cover the reach.
      reach[b] = Math.max(own[b], b > 0 ? own[b - 1] : 0, b + 1 < blocks ? own[b + 1] : 0);
    }
    const order = Array.from({ length: blocks }, (_, b) => b).sort((p, q) => reach[q] - reach[p] || p - q);
    const { even, odd, half } = TP;
    for (const b of order) {
      if (reach[b] * TP.gain <= peak) break;
      const end = Math.min(n, (b + 1) * TP_BLOCK);
      // The interior is `interpPeak` written out, so the loop the whole
      // signal may run through makes no call per sample; the edges, where
      // the kernel reaches past the array, go through it.
      const safeFrom = Math.max(b * TP_BLOCK, TP_HALF - 1);
      const safeTo = Math.min(end, n - TP_HALF);
      for (let i = b * TP_BLOCK; i < Math.min(end, safeFrom); i++) peak = Math.max(peak, interpPeak(x, i));
      for (let i = safeFrom; i < safeTo; i++) {
        const lo = i - TP_HALF + 1;
        const hi = i + TP_HALF;
        let S = 0;
        let D = 0;
        let T = 0;
        for (let k = 0; k < TP_HALF; k++) {
          const a = x[lo + k];
          const c = x[hi - k];
          const u = a + c;
          S += even[k] * u;
          D += odd[k] * (a - c);
          T += half[k] * u;
        }
        const p1 = S + D;
        const p3 = S - D;
        if (p1 > peak || -p1 > peak || p3 > peak || -p3 > peak || T > peak || -T > peak) {
          peak = Math.max(peak, Math.abs(p1), Math.abs(p3), Math.abs(T));
        }
      }
      for (let i = Math.max(safeTo, b * TP_BLOCK); i < end; i++) peak = Math.max(peak, interpPeak(x, i));
    }
  }
  return peak;
}

// ── resampling ────────────────────────────────────────────────────────────

/** Zero crossings of the resampling kernel on each side, at the narrower of the two rates. */
const RS_ZERO_CROSSINGS = 32;
/** Kaiser β of the resampling kernel: about 85 dB of stopband. */
const RS_BETA = 8.6;
/** Where the cut sits, as a share of the narrower Nyquist: flat to ~19 kHz between 44.1 and 48 kHz. */
const RS_ROLLOFF = 0.94;
/** Above this many phases the kernel table is interpolated instead of exact. */
const RS_MAX_PHASES = 4096;

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Linear interpolation from `from` Hz to `to` Hz: cheap, and fine for a
 * control signal or a draft; a tone near the top of the band comes out with
 * images (use `resampleSinc` for anything heard). The edge sample is held past
 * the end. The output has round(length x to/from) samples.
 */
export function resampleLinear(x: Float32Array, from: number, to: number): Float32Array {
  const [s] = conform([x]);
  const src = s ?? new Float32Array(0);
  const fr = sampleRateOr(from);
  const tr = sampleRateOr(to);
  if (fr === tr) return Float32Array.from(src);
  const n = src.length;
  const m = Math.round((n * tr) / fr);
  const out = new Float32Array(m);
  if (!n) return out;
  for (let j = 0; j < m; j++) {
    const pos = (j * fr) / tr;
    const i = Math.floor(pos);
    const f = pos - i;
    const a = src[Math.min(i, n - 1)];
    const b = src[Math.min(i + 1, n - 1)];
    out[j] = a + (b - a) * f;
  }
  return out;
}

/**
 * Band-limited resampling from `from` Hz to `to` Hz: each output sample is
 * the input under a Kaiser-windowed sinc, cut at 94% of the narrower Nyquist
 * so that going down (48 to 44.1 kHz) removes what would fold back as
 * aliases and going up removes the images. The kernel is tabulated once per
 * call for every phase the ratio visits; between 44.1 and 48 kHz that is 160
 * (or 147) exact phases, and for a ratio with more than 4096 phases the table
 * is 4096 rows and a point between rows is interpolated.
 *
 * Each phase is scaled to sum to 1, so a constant stays exactly that constant.
 * Past either end the input is silence, so a sound that starts or stops
 * abruptly rings for a few samples, as any band-limited resampler does.
 */
export function resampleSinc(x: Float32Array, from: number, to: number): Float32Array {
  const [s] = conform([x]);
  const src = s ?? new Float32Array(0);
  const fr = Math.round(sampleRateOr(from));
  const tr = Math.round(sampleRateOr(to));
  if (fr === tr) return Float32Array.from(src);
  const n = src.length;
  const m = Math.round((n * tr) / fr);
  const out = new Float32Array(m);
  if (!n) return out;

  // The cut as a share of the INPUT's Nyquist, and the kernel's half-width in
  // input samples: RS_ZERO_CROSSINGS zero crossings of the narrower band.
  const fc = Math.min(1, tr / fr) * RS_ROLLOFF;
  const half = Math.ceil(RS_ZERO_CROSSINGS / fc);
  const width = 2 * half;
  const g = gcd(fr, tr);
  const phases = tr / g; // output samples per input-position cycle
  const step = fr / g; // input advance per output sample, in 1/phases units
  const rows = Math.min(phases, RS_MAX_PHASES);
  const exact = rows === phases;
  const i0 = besselI0(RS_BETA);
  // Row r holds the weights for a point r/rows of the way past input sample i,
  // on samples i - half + 1 .. i + half. One extra row closes the interpolation.
  const table = new Float64Array((rows + 1) * width);
  for (let r = 0; r <= rows; r++) {
    const frac = r / rows;
    let sum = 0;
    for (let k = 0; k < width; k++) {
      const d = frac - (k - half + 1);
      const v = fc * sinc(fc * d) * kaiser(d / (half + 1), RS_BETA, i0);
      table[r * width + k] = v;
      sum += v;
    }
    if (sum !== 0) for (let k = 0; k < width; k++) table[r * width + k] /= sum;
  }

  for (let j = 0; j < m; j++) {
    // Exact position j·from/to as a whole sample and a phase, in integers.
    const num = j * step;
    const i = Math.floor(num / phases);
    const ph = num - i * phases;
    let r0: number;
    let w: number;
    if (exact) {
      r0 = ph;
      w = 0;
    } else {
      const at = (ph / phases) * rows;
      r0 = Math.min(rows - 1, Math.floor(at));
      w = at - r0;
    }
    const base = i - half + 1;
    const o0 = r0 * width;
    const o1 = o0 + width;
    let acc = 0;
    for (let k = 0; k < width; k++) {
      const idx = base + k;
      if (idx < 0 || idx >= n) continue;
      const c = w === 0 ? table[o0 + k] : table[o0 + k] * (1 - w) + table[o1 + k] * w;
      acc += c * src[idx];
    }
    out[j] = acc;
  }
  return out;
}

/** Every channel from `from` Hz to `to` Hz, band-limited (`'sinc'`, the default) or linear. */
export function resample(channels: readonly Float32Array[], from: number, to: number, quality: 'sinc' | 'linear' = 'sinc'): Float32Array[] {
  const one = quality === 'linear' ? resampleLinear : resampleSinc;
  return conform(channels).map((x) => one(x, from, to));
}

// ── FFT and convolution ───────────────────────────────────────────────────

/** Twiddles per FFT size, made once: cos and sin of -2πk/N for k < N/2. */
const TWIDDLES = new Map<number, { cos: Float64Array; sin: Float64Array }>();

function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  let t = TWIDDLES.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((-2 * Math.PI * k) / n);
      sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
    t = { cos, sin };
    TWIDDLES.set(n, t);
  }
  return t;
}

/**
 * In-place iterative radix-2 FFT of `re` + i·`im` (length a power of two).
 * `inverse` runs the inverse transform, scaled by 1/N so a round trip returns
 * the input. Twiddles come from a table, not from a rotating product, so the
 * result does not drift with N.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) return;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const { cos, sin } = twiddles(n);
  const sign = inverse ? -1 : 1;
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < halfLen; k++) {
        const wr = cos[k * stride];
        const wi = sign * sin[k * stride];
        const a = i + k;
        const b = a + halfLen;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}

/**
 * `x` convolved with `h`, the first `length` samples of it (by default as
 * long as `x`: a reverb's tail past the end of the sound is cut, because a
 * bed is exactly as long as its picture).
 *
 * Overlap-add with one FFT size, N = the power of two at least twice `h`, so
 * each block of x is N - |h| + 1 samples. Two blocks travel in one complex
 * transform, one as the real part and one as the imaginary part: `h` is real,
 * so multiplying by its spectrum keeps them apart, and the inverse hands back
 * both blocks' results at once for the cost of one. Direct convolution of a
 * three-second room over thirty seconds would be 10¹¹ multiplications; this
 * is a few hundred milliseconds.
 */
export function convolve(x: Float32Array, h: Float32Array, length?: number): Float32Array {
  const [xs] = conform([x]);
  const [hs] = conform([h]);
  const sig = xs ?? new Float32Array(0);
  const ir = hs ?? new Float32Array(0);
  const outLen = Math.max(0, Math.floor(finiteOr(length, sig.length)));
  const out = new Float32Array(outLen);
  const L = ir.length;
  if (!L || !sig.length || !outLen) return out;
  // Short responses are cheaper done directly than transformed.
  if (L <= 32) {
    for (let i = 0; i < outLen; i++) {
      let acc = 0;
      const kMax = Math.min(L - 1, i);
      for (let k = 0; k <= kMax; k++) {
        const j = i - k;
        if (j < sig.length) acc += ir[k] * sig[j];
      }
      out[i] = acc;
    }
    return out;
  }
  let N = 1;
  while (N < 2 * L) N <<= 1;
  N = Math.max(N, 1024);
  const B = N - L + 1;
  const Hr = new Float64Array(N);
  const Hi = new Float64Array(N);
  for (let i = 0; i < L; i++) Hr[i] = ir[i];
  fft(Hr, Hi);
  const acc = new Float64Array(outLen + N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const usable = Math.min(sig.length, outLen);
  for (let start = 0; start < usable; start += 2 * B) {
    re.fill(0);
    im.fill(0);
    const s2 = start + B;
    for (let i = 0; i < B && start + i < usable; i++) re[i] = sig[start + i];
    for (let i = 0; i < B && s2 + i < usable; i++) im[i] = sig[s2 + i];
    fft(re, im);
    for (let k = 0; k < N; k++) {
      const r = re[k] * Hr[k] - im[k] * Hi[k];
      im[k] = re[k] * Hi[k] + im[k] * Hr[k];
      re[k] = r;
    }
    fft(re, im, true);
    for (let i = 0; i < N && start + i < acc.length; i++) acc[start + i] += re[i];
    if (s2 < usable) for (let i = 0; i < N && s2 + i < acc.length; i++) acc[s2 + i] += im[i];
  }
  for (let i = 0; i < outLen; i++) out[i] = acc[i];
  return out;
}
