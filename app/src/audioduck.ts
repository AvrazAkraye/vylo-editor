import { clamp, conform, finiteOr, frames, sampleRateOr } from './audiocore';
import { MAX_POINTS, render } from './audioauto';
import type { AutoPoint, Lane } from './audioauto';

/**
 * Ducking: music that steps back while somebody speaks. Given the voice,
 * `duckLane` returns a volume lane (audioauto.ts) for the music: down to x0.25
 * (-12 dB) when speech starts, back up to x1 when it stops. As a lane, the
 * same envelope plays in the preview (`compile` onto a GainNode) and in the
 * export (`applyLane`), and a person or the chat can see and edit it.
 *
 * ## The envelope
 *
 * The defaults are the ones RESEARCH.md settled on: the music ducks to x0.25
 * with a 0.15 s attack and a 0.4 s release. Offline we know when the voice
 * starts, so the attack *leads* it: the music is already down when the first
 * word lands (`lead`, by default the attack time), as Video's mix does. After
 * the voice stops the music waits `hold` (0.3 s) before it rises, so it does
 * not swell into every gap between two words; and two stretches of speech
 * closer than the time it takes to come back up are treated as one, so the
 * music stays down rather than bobbing. Both ramps are geometric (`exp`):
 * even in dB, which is how a fade sounds even. A voice that starts within
 * `lead` of the beginning starts with the music already down.
 *
 * ## Finding the speech
 *
 * The voice's level in 20 ms windows every 5 ms (all channels, the mean
 * square), against a floor: whichever is higher of `threshold` (-45 dBFS) and
 * `range` (30 dB) under the voice's loudest window, so a room tone or a breath
 * far under the voice's own level does not hold the music down. Stretches
 * shorter than `minSpeech` (50 ms) are a click, not a word. A boundary is
 * placed at the middle of the first and last window over the floor, so it is
 * good to about one window (20 ms), plenty for a 150 ms ramp.
 *
 * (HyperFrames' carve finds speech the same way, 30 dB under the voice's
 * peak; the frequency-band "carve" itself is not here, and is the open item
 * in docs/pro/audio.md.)
 */

export interface DuckOptions {
  /** The music's gain while the voice speaks, 0..1. */
  depth?: number;
  /** Seconds to go down, 0.01..5. */
  attack?: number;
  /** Seconds to come back up, 0.01..10. */
  release?: number;
  /** Seconds the music stays down after speech before it rises, 0..5. */
  hold?: number;
  /** Seconds before speech that the attack begins, 0..5; by default the attack time. */
  lead?: number;
  /** The level a window must pass to count as speech, dBFS, -90..0. */
  threshold?: number;
  /** ...and how far under the loudest window it may be, dB, 6..80. */
  range?: number;
  /** Speech shorter than this, seconds, is ignored, 0..1. */
  minSpeech?: number;
}

/** A stretch of speech, in seconds. */
export interface SpeechSpan {
  start: number;
  end: number;
}

interface DuckSettings {
  depth: number;
  attack: number;
  release: number;
  hold: number;
  lead: number;
  threshold: number;
  range: number;
  minSpeech: number;
}

/** The defaults: x0.25, 0.15 s down, 0.4 s up (RESEARCH.md). */
export const DUCK_DEFAULTS: Readonly<DuckSettings> = {
  depth: 0.25, attack: 0.15, release: 0.4, hold: 0.3, lead: 0.15, threshold: -45, range: 30, minSpeech: 0.05,
};

/** The options, clamped; `lead` follows `attack` unless it is given. */
export function readDuck(o: DuckOptions = {}): DuckSettings {
  const r = typeof o === 'object' && o !== null ? o : {};
  const attack = clamp(finiteOr(r.attack, DUCK_DEFAULTS.attack), 0.01, 5);
  return {
    depth: clamp(finiteOr(r.depth, DUCK_DEFAULTS.depth), 0, 1),
    attack,
    release: clamp(finiteOr(r.release, DUCK_DEFAULTS.release), 0.01, 10),
    hold: clamp(finiteOr(r.hold, DUCK_DEFAULTS.hold), 0, 5),
    lead: clamp(finiteOr(r.lead, attack), 0, 5),
    threshold: clamp(finiteOr(r.threshold, DUCK_DEFAULTS.threshold), -90, 0),
    range: clamp(finiteOr(r.range, DUCK_DEFAULTS.range), 6, 80),
    minSpeech: clamp(finiteOr(r.minSpeech, DUCK_DEFAULTS.minSpeech), 0, 1),
  };
}

const WINDOW = 0.02;
const HOP = 0.005;

/**
 * The most stretches of speech one lane can duck for: four points each and
 * one to start, within the lane's point limit. Past it (an hour of
 * talk), the shortest pauses are bridged first, so the lane stays whole
 * rather than being cut off by the reader and left ducked for the rest.
 */
const MAX_DUCKS = Math.floor((MAX_POINTS - 1) / 4);

/** Where `voice` (planar, at `rate`) is speaking, as sorted, non-overlapping spans in seconds. */
export function findSpeech(voice: readonly Float32Array[], rate: number, o: DuckOptions = {}): SpeechSpan[] {
  const s = readDuck(o);
  const ch = conform(voice);
  const sr = sampleRateOr(rate);
  const n = frames(ch);
  if (!n || !ch.length) return [];
  const win = Math.max(1, Math.round(WINDOW * sr));
  const hop = Math.max(1, Math.round(HOP * sr));
  // Squares summed across channels, then a running window sum.
  const sq = new Float64Array(n);
  for (const x of ch) for (let i = 0; i < n; i++) sq[i] += x[i] * x[i];
  const levels: number[] = [];
  const centres: number[] = [];
  for (let start = 0; start < n; start += hop) {
    const end = Math.min(n, start + win);
    let sum = 0;
    for (let i = start; i < end; i++) sum += sq[i];
    const ms = sum / ((end - start) * ch.length);
    levels.push(ms > 1e-20 ? 10 * Math.log10(ms) : -200);
    centres.push((start + end) / 2 / sr);
  }
  const loudest = Math.max(...levels);
  const floor = Math.max(s.threshold, loudest - s.range);
  const spans: SpeechSpan[] = [];
  let open = -1;
  for (let k = 0; k <= levels.length; k++) {
    const on = k < levels.length && levels[k] > floor;
    if (on && open < 0) open = k;
    if (!on && open >= 0) {
      const span = { start: centres[open] - WINDOW / 2 + HOP / 2, end: centres[k - 1] + WINDOW / 2 - HOP / 2 };
      span.start = clamp(span.start, 0, n / sr);
      span.end = clamp(span.end, span.start, n / sr);
      if (span.end - span.start >= s.minSpeech) spans.push(span);
      open = -1;
    }
  }
  return spans;
}

/**
 * The music's volume lane for speech at `spans` (seconds): what `duckLane`
 * builds once it has found the speech, and what a caller that already knows
 * where the voice lines sit (Video's storyboard) can call directly. Spans
 * are sorted and merged first; an empty list is a lane that stays at 1.
 */
export function duckLaneFor(spans: readonly SpeechSpan[], o: DuckOptions = {}): Lane {
  const s = readDuck(o);
  const list = (Array.isArray(spans) ? spans : [])
    .map((p) => ({ start: clamp(finiteOr(p?.start, 0), 0, 3600), end: clamp(finiteOr(p?.end, 0), 0, 3600) }))
    .filter((p) => p.end > p.start)
    .sort((a, b) => a.start - b.start);
  // Merge speech the music could not get back up between.
  let merged: SpeechSpan[] = [];
  for (const p of list) {
    const last = merged[merged.length - 1];
    if (last && p.start - s.lead - (last.end + s.hold) < s.release) last.end = Math.max(last.end, p.end);
    else merged.push({ ...p });
  }
  if (merged.length > MAX_DUCKS) {
    // Bridging every pause up to this one removes at least the surplus.
    const gaps = merged.slice(1).map((p, i) => p.start - merged[i].end).sort((a, b) => a - b);
    const limit = gaps[merged.length - 1 - MAX_DUCKS];
    const fewer: SpeechSpan[] = [];
    for (const p of merged) {
      const last = fewer[fewer.length - 1];
      if (last && p.start - last.end <= limit) last.end = Math.max(last.end, p.end);
      else fewer.push({ ...p });
    }
    merged = fewer;
  }
  // A point with no curve is linear: the duck holds at depth until the release.
  const points: AutoPoint[] = [{ t: 0, v: 1, curve: 'exp' }];
  for (const p of merged) {
    const down = p.start - s.lead;
    if (down <= 0) {
      points.length = 0;
      points.push({ t: 0, v: s.depth });
    } else {
      points.push({ t: down, v: 1, curve: 'exp' });
      points.push({ t: down + s.attack, v: s.depth });
    }
    points.push({ t: p.end + s.hold, v: s.depth, curve: 'exp' });
    points.push({ t: p.end + s.hold + s.release, v: 1, curve: 'exp' });
  }
  // Points at one time collapse to the later, as the reader would.
  const clean: AutoPoint[] = [];
  for (const pt of points) {
    if (clean.length && clean[clean.length - 1].t >= pt.t) clean[clean.length - 1] = { ...pt, t: clean[clean.length - 1].t };
    else clean.push(pt);
  }
  return { target: 'volume', points: clean };
}

/** A volume lane that ducks music under `voice` (planar, at `rate`); see the file comment. */
export function duckLane(voice: readonly Float32Array[], rate: number, o: DuckOptions = {}): Lane {
  return duckLaneFor(findSpeech(voice, rate, o), o);
}

/**
 * `channels` times `lane`, sample i at `start + i/rate` seconds (`start` is
 * where the track sits on the lane's clock): how the export plays a volume
 * lane. New arrays; the input is untouched.
 */
export function applyLane(channels: readonly Float32Array[], lane: Lane, rate: number, start = 0): Float32Array[] {
  const ch = conform(channels);
  const g = render(lane, rate, frames(ch), start);
  return ch.map((x) => {
    const out = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = x[i] * g[i];
    return out;
  });
}

/** `bed` ducked under `voice`, both planar at `rate`: `applyLane(bed, duckLane(voice, rate, o), rate)`. */
export function duckBed(bed: readonly Float32Array[], voice: readonly Float32Array[], rate: number, o: DuckOptions = {}): Float32Array[] {
  return applyLane(bed, duckLane(voice, rate, o), rate);
}
