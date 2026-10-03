import { clamp, finite, rng } from './motionmath';

/**
 * Sound effects for Motion, made here from nothing: no recording, no sample
 * file, no library, no licence. Each effect is a short piece of arithmetic —
 * noise through a moving filter, a sine whose pitch slides, a few decaying
 * partials — computed sample by sample into a `Float32Array`, so the same
 * effect is the same numbers in the Node tests, in the preview and in the
 * exported film. `motionsound.ts` decides *which* effect plays *when* (a slide
 * gets a whoosh, a counter ticks, a big title lands with an impact); this file
 * only knows how each one sounds.
 *
 * ## Why plain JavaScript and not Web Audio
 *
 * An `OfflineAudioContext` would draw these with fewer lines, but its filters
 * and oscillators are the engine's, not ours: WebKit and Chrome differ in the
 * last bits, Node has none at all, and a test could then only say "something
 * came out". Here every number is ours, and a test can hold a whoosh to the
 * shape it was designed with. The cost is small: the longest effect is a few
 * seconds of one filter per sample, and a ten-second graphic's effects render
 * in tens of milliseconds.
 *
 * ## Seeded, never random
 *
 * Noise comes from `rng(seed)` (motionmath.ts, mulberry32), never
 * `Math.random`: the same cue always makes the same sound, so a cache keyed by
 * the cue is exact and the film's sound does not change between two exports.
 * The seed also varies what a person would hear as the same effect twice —
 * two pops a moment apart differ a little in pitch and grain, as two real ones
 * would.
 *
 * ## One loudness for all
 *
 * Every effect leaves this file at the same short-term level, `SFX_REF_DB`:
 * the loudest 50 ms of it has that RMS. A tick and an impact at the same cue
 * gain therefore sound about as loud as each other, and how loud each one
 * should be is decided in one place, by its cue's gain in `motionsound.ts`,
 * rather than by whatever level a formula here happened to leave it at.
 *
 * ## Nothing clicks
 *
 * A sound that starts or stops at a sample that is not zero is heard as a
 * click on top of it. Every effect is faded in over 2 ms and out over 8 ms
 * with a raised cosine, so its first and last samples are exactly zero.
 */

/** The effects, in the order the docs describe them. */
export const SFX_KINDS = ['whoosh', 'pop', 'tick', 'key', 'impact', 'sparkle', 'riser', 'swell', 'click'] as const;
export type SfxKind = (typeof SFX_KINDS)[number];

/** One effect to make. */
export interface Sfx {
  kind: SfxKind;
  /**
   * Seconds its shape spans, for the kinds that follow a motion: a whoosh's
   * sweep, a riser's climb, a swell's rise, a sparkle's scatter. The others
   * (pop, tick, key, click, impact) have their own length and ignore it.
   */
  d: number;
  /** A pitch factor: 1 as designed, 2 an octave up. Held to 0.5..2. */
  pitch: number;
  /**
   * The shape reversed in time: a whoosh that builds to its loudest near the
   * end instead of near the start. An exit is an entrance played backwards
   * (motionanim.ts), and its sound is too.
   */
  rev: boolean;
  seed: number;
}

/** The short-term RMS, in dBFS, every effect is brought to: the loudest 50 ms of it. */
export const SFX_REF_DB = -18;

/** Seconds an effect's shape may span, and the tail it rings on after. A kind with `fixed` has one length. */
const SPAN: Readonly<Record<SfxKind, { min: number; max: number; tail: number; fixed?: number }>> = {
  whoosh: { min: 0.15, max: 1.6, tail: 0.06 },
  pop: { min: 0, max: 0, tail: 0, fixed: 0.16 },
  tick: { min: 0, max: 0, tail: 0, fixed: 0.045 },
  key: { min: 0, max: 0, tail: 0, fixed: 0.08 },
  impact: { min: 0, max: 0, tail: 0, fixed: 1.5 },
  sparkle: { min: 0.25, max: 1.6, tail: 0.3 },
  riser: { min: 0.3, max: 4, tail: 0.1 },
  swell: { min: 0.5, max: 3, tail: 0.35 },
  click: { min: 0, max: 0, tail: 0, fixed: 0.03 },
};

/** The fades at the two ends, in seconds. */
const FADE_IN = 0.002;
const FADE_OUT = 0.008;
/** The window the short-term level is measured over, and its hop. */
const RMS_WINDOW = 0.05;
const RMS_HOP = 0.005;

const TAU = Math.PI * 2;
const KINDS: ReadonlySet<string> = new Set(SFX_KINDS);

// ── building blocks ───────────────────────────────────────────────────────

/**
 * A state-variable filter in its trapezoidal form (Zavalishin's "TPT" SVF):
 * one sample in, the low-, band- and high-passed signal out at once, stable
 * while its cutoff moves every sample — which is the whole point here, since a
 * whoosh *is* a moving filter. `band` is scaled to unity gain at the cutoff.
 */
class Svf {
  low = 0;
  band = 0;
  high = 0;
  private s1 = 0;
  private s2 = 0;
  constructor(private readonly rate: number) {}

  step(x: number, cutoff: number, q: number): void {
    const g = Math.tan((Math.PI * clamp(cutoff, 20, this.rate * 0.45)) / this.rate);
    const k = 1 / Math.max(0.1, q);
    const a1 = 1 / (1 + g * (g + k));
    const v1 = a1 * this.s1 + g * a1 * (x - this.s2);
    const v2 = this.s2 + g * v1;
    this.s1 = 2 * v1 - this.s1;
    this.s2 = 2 * v2 - this.s2;
    this.low = v2;
    this.band = k * v1;
    this.high = x - k * v1 - v2;
  }
}

/**
 * 1 for a partial the rate can carry, 0 for one at or past 45% of it: a sine
 * above half the sample rate does not vanish, it folds back down as a wrong,
 * unrelated pitch (and rings between the samples). At 48 kHz nothing here is
 * near it; at a low preview rate a sparkle's top partials would be.
 */
const carried = (hz: number, rate: number) => (hz < 0.45 * rate ? 1 : 0);

/** Rises from 0 to 1 over `0..1` without a corner at either end. */
const rise = (u: number) => {
  const s = Math.sin((Math.PI / 2) * clamp(u, 0, 1));
  return s * s;
};

/**
 * A hump from 0 up to 1 at `peak` and back to 0 at 1, smooth at all three
 * points: the loudness of something passing by.
 */
function hump(u: number, peak: number): number {
  if (u <= 0 || u >= 1) return 0;
  return u < peak ? rise(u / peak) : 1 - rise((u - peak) / (1 - peak));
}

/** `buf` faded in over `inS` and out over `outS` seconds, a raised cosine each, so it starts and ends on zero. */
function fadeEdges(buf: Float32Array, rate: number, inS: number, outS: number): void {
  const n = buf.length;
  if (!n) return;
  const a = Math.min(n, Math.max(1, Math.round(inS * rate)));
  for (let i = 0; i < a; i++) buf[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / a);
  const b = Math.min(n, Math.max(1, Math.round(outS * rate)));
  for (let i = 0; i < b; i++) buf[n - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / b);
}

/** The RMS of the loudest `RMS_WINDOW` of `buf`: how loud it is where it is loudest. */
function shortTermRms(buf: Float32Array, rate: number): number {
  const w = Math.max(1, Math.round(RMS_WINDOW * rate));
  const hop = Math.max(1, Math.round(RMS_HOP * rate));
  // Running sums of squares, so each window costs two lookups however long it is.
  const sq = new Float64Array(buf.length + 1);
  for (let i = 0; i < buf.length; i++) sq[i + 1] = sq[i] + buf[i] * buf[i];
  let best = 0;
  // A sound shorter than the window is measured over the window, silence and all: the ear integrates a click
  // over about that long too, which is why a 2 ms click sounds quieter than its peak suggests.
  for (let s = 0; s === 0 || s + w <= buf.length; s += hop) {
    const e = Math.min(buf.length, s + w);
    best = Math.max(best, (sq[e] - sq[s]) / w);
  }
  return Math.sqrt(best);
}

// ── the effects ───────────────────────────────────────────────────────────

/** Air rushing past: noise through two band filters whose centre follows the loudness up and back down. */
function whoosh(o: Sfx, rate: number, noise: () => number): Float32Array {
  const d = o.d;
  const out = new Float32Array(Math.round((d + SPAN.whoosh.tail) * rate));
  // An entrance is fastest at its start (its curve eases out), so the rush peaks early; an exit eases in and peaks late.
  const peak = o.rev ? 0.72 : 0.3;
  const air = new Svf(rate);
  const body = new Svf(rate);
  for (let i = 0; i < out.length; i++) {
    const e = hump(i / rate / d, peak);
    const x = noise();
    const centre = (320 + 2600 * e) * o.pitch;
    air.step(x, centre, 1.3);
    body.step(x, centre * 0.32 + 70, 0.75);
    out[i] = (air.band + 0.6 * body.band) * e;
  }
  return out;
}

/** A bubble appearing: a sine that slides up fast and dies away, with a breath of noise on its front. */
function pop(o: Sfx, rate: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round(SPAN.pop.fixed! * rate));
  const r = rng(o.seed + 17);
  const from = 380 * o.pitch * (0.94 + 0.12 * r());
  const to = 1150 * o.pitch * (0.94 + 0.12 * r());
  const air = new Svf(rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = to + (from - to) * Math.exp(-t / 0.018);
    phase += (TAU * f) / rate;
    const tone = Math.sin(phase) * Math.min(1, t / 0.0015) * Math.exp(-t / 0.038);
    air.step(noise(), 3000, 0.7);
    out[i] = tone + 0.3 * air.band * Math.exp(-t / 0.002);
  }
  return out;
}

/** A counter's click: two bright partials a few milliseconds long and a pinch of noise. */
function tick(o: Sfx, rate: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round(SPAN.tick.fixed! * rate));
  const bp = new Svf(rate);
  const f1 = 2900 * o.pitch;
  const f2 = 4650 * o.pitch;
  const a1 = carried(f1, rate);
  const a2 = 0.5 * carried(f2, rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    bp.step(noise(), 3600 * o.pitch, 1.5);
    out[i] = a1 * Math.sin(TAU * f1 * t) * Math.exp(-t / 0.006) + a2 * Math.sin(TAU * f2 * t) * Math.exp(-t / 0.004)
      + 0.6 * bp.band * Math.exp(-t / 0.0015);
  }
  return out;
}

/** A key on a keyboard: the press, a low thock under it, and the quieter release a moment later. */
function key(o: Sfx, rate: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round(SPAN.key.fixed! * rate));
  const r = rng(o.seed + 29);
  const press = 2000 * o.pitch * (0.85 + 0.3 * r());
  const lift = 1500 * o.pitch * (0.85 + 0.3 * r());
  const thock = 190 * (0.9 + 0.2 * r());
  const back = 0.022 + 0.012 * r();
  const a = new Svf(rate);
  const b = new Svf(rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const x = noise();
    a.step(x, press, 2);
    b.step(x, lift, 2);
    const up = t >= back ? 0.45 * b.band * Math.exp(-(t - back) / 0.005) : 0;
    out[i] = a.band * Math.exp(-t / 0.004) + up + 0.5 * Math.sin(TAU * thock * t) * Math.exp(-t / 0.012);
  }
  return out;
}

/**
 * The lightest tap: a spark of bright noise and a short tone. The noise is a
 * wide band around 4.5 kHz rather than everything above 3 kHz: noise reaching
 * up to the top of the band is harsh, and it is what rises highest between
 * samples, where the ceiling has to hold too.
 */
function click(o: Sfx, rate: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round(SPAN.click.fixed! * rate));
  const air = new Svf(rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    air.step(noise(), 4500, 0.6);
    out[i] = air.band * Math.exp(-t / 0.0012) + 0.5 * carried(1900 * o.pitch, rate) * Math.sin(TAU * 1900 * o.pitch * t) * Math.exp(-t / 0.003);
  }
  return out;
}

/**
 * Something heavy landing: a sub-bass sine falling in pitch, a body tone, and
 * a burst of noise whose brightness closes fast, gently saturated together so
 * the three read as one hit.
 */
function impact(o: Sfx, rate: number, noise: () => number): Float32Array {
  const out = new Float32Array(Math.round(SPAN.impact.fixed! * rate));
  const lp = new Svf(rate);
  let phase = 0;
  const drive = 1.6;
  const norm = 1 / Math.tanh(drive);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const f = (42 + 34 * Math.exp(-t / 0.09)) * o.pitch;
    phase += (TAU * f) / rate;
    const sub = Math.sin(phase) * Math.min(1, t / 0.004) * Math.exp(-t / 0.38);
    const bodyTone = 0.5 * Math.sin(TAU * 125 * o.pitch * t) * Math.exp(-t / 0.07);
    lp.step(noise(), 300 + 2500 * Math.exp(-t / 0.05), 0.8);
    const burst = 0.8 * lp.low * Math.exp(-t / 0.11);
    out[i] = Math.tanh(drive * (sub + bodyTone + burst)) * norm;
  }
  return out;
}

/** Bright pentatonic notes, C7 upward: a sparkle's grains are tuned so that several at once still sound like one thing. */
const SPARKLE_NOTES = [2093, 2349, 2637, 3136, 3520, 4186] as const;

/** Glitter: a scatter of small bell tones, more of them early, each a sine with an inharmonic partial. */
function sparkle(o: Sfx, rate: number): Float32Array {
  const d = o.d;
  const out = new Float32Array(Math.round((d + SPAN.sparkle.tail) * rate));
  const r = rng(o.seed + 41);
  const grains = Math.round(5 + 7 * d + 3 * r());
  for (let g = 0; g < grains; g++) {
    const at = d * Math.pow(r(), 1.3);
    const f = SPARKLE_NOTES[Math.floor(r() * SPARKLE_NOTES.length)] * o.pitch * (0.995 + 0.01 * r());
    const amp = (0.5 + 0.5 * r()) * (1 - 0.6 * (at / d));
    const tau = 0.05 + 0.08 * r();
    const from = Math.round(at * rate);
    const len = Math.min(out.length - from, Math.round(tau * 6 * rate));
    const low = carried(f, rate);
    const high = 0.35 * carried(f * 2.76, rate);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.001);
      out[from + i] += amp * env * (low * Math.sin(TAU * f * t) * Math.exp(-t / tau) + high * Math.sin(TAU * f * 2.76 * t) * Math.exp(-t / (tau * 0.6)));
    }
  }
  return out;
}

/** Tension building: noise and a buzzy tone climbing two octaves together, getting louder, then let go. */
function riser(o: Sfx, rate: number, noise: () => number): Float32Array {
  const d = o.d;
  const out = new Float32Array(Math.round((d + SPAN.riser.tail) * rate));
  const bp = new Svf(rate);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const u = Math.min(1, t / d);
    const e = Math.pow(u, 1.8) * (t <= d ? 1 : Math.exp(-(t - d) / 0.025));
    bp.step(noise(), 250 * o.pitch * Math.pow(16, u), 2.5);
    const f = 110 * o.pitch * Math.pow(4, u);
    phase += (TAU * f) / rate;
    // The first four harmonics of a sawtooth: buzzy, and none past what the rate can carry.
    const buzz = Math.sin(phase) + 0.5 * carried(2 * f, rate) * Math.sin(2 * phase) + 0.33 * carried(3 * f, rate) * Math.sin(3 * phase)
      + 0.25 * carried(4 * f, rate) * Math.sin(4 * phase);
    out[i] = e * (bp.band + 0.3 * buzz);
  }
  return out;
}

/** An open fifth on D, slightly chorused, rising and fading: it agrees with most keys a piece could be in. */
const SWELL_NOTES = [146.83, 220, 293.66, 440] as const;

/** A soft rise of sound under something arriving: a pad of detuned sines with a little dark air. */
function swell(o: Sfx, rate: number, noise: () => number): Float32Array {
  const d = o.d;
  const out = new Float32Array(Math.round((d + SPAN.swell.tail) * rate));
  const peak = (0.7 * d) / (d + SPAN.swell.tail);
  const lp = new Svf(rate);
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    const e = hump(i / out.length, peak);
    let s = 0;
    for (const f of SWELL_NOTES) {
      const hz = f * o.pitch;
      s += Math.sin(TAU * hz * 1.0025 * t) + Math.sin(TAU * hz * 0.9975 * t);
    }
    lp.step(noise(), 700, 0.7);
    out[i] = e * (0.12 * s + 0.6 * lp.low);
  }
  return out;
}

// ── the door ──────────────────────────────────────────────────────────────

/** `x` as an effect to make: an unknown kind is a click, every number held to its kind's range. */
function readSfx(x: Sfx): Sfx {
  const kind: SfxKind = KINDS.has(x?.kind) ? x.kind : 'click';
  const span = SPAN[kind];
  return {
    kind,
    d: span.fixed ?? clamp(finite(x?.d, span.min), span.min, span.max),
    pitch: clamp(finite(x?.pitch, 1), 0.5, 2),
    rev: x?.rev === true,
    seed: Math.trunc(finite(x?.seed, 0)) | 0,
  };
}

/**
 * One effect as mono samples at `rate`: faded at both ends and brought to
 * `SFX_REF_DB`. Pure — the same `Sfx` and rate always give the same numbers.
 */
export function synth(spec: Sfx, rate: number): Float32Array {
  const o = readSfx(spec);
  const sr = clamp(Math.round(finite(rate, 48000)), 8000, 192000);
  const r = rng(o.seed);
  const noise = () => r() * 2 - 1;
  const out = o.kind === 'whoosh' ? whoosh(o, sr, noise)
    : o.kind === 'pop' ? pop(o, sr, noise)
      : o.kind === 'tick' ? tick(o, sr, noise)
        : o.kind === 'key' ? key(o, sr, noise)
          : o.kind === 'impact' ? impact(o, sr, noise)
            : o.kind === 'sparkle' ? sparkle(o, sr)
              : o.kind === 'riser' ? riser(o, sr, noise)
                : o.kind === 'swell' ? swell(o, sr, noise)
                  : click(o, sr, noise);
  fadeEdges(out, sr, FADE_IN, FADE_OUT);
  const level = shortTermRms(out, sr);
  if (level > 0) {
    const g = Math.pow(10, SFX_REF_DB / 20) / level;
    for (let i = 0; i < out.length; i++) out[i] *= g;
  }
  return out;
}
