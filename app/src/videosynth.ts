/**
 * Music composed in the app, for one video: a score written here and played
 * by instruments synthesised here. Nothing is downloaded, no model writes a
 * note and no licence is involved, so the piece belongs to the video, needs
 * no credit and is made the same way offline, in WebKit and in WebView2.
 *
 * (Why not a Python script: every person would need Python installed, and
 * SAFETY.md's rule is that nothing runs on the computer without the person
 * approving it. This is the same idea with neither.)
 *
 * ## Two layers
 *
 * - `arrange(spec, seconds, cues)` writes the **score** — a pure function of
 *   its arguments, with its own seeded random numbers, so the same spec always
 *   composes the same piece and a new `seed` a new one in the same mood. It
 *   picks a tempo, a key and a scale for the mood; chooses chord progressions,
 *   a bass line, drum patterns, and a theme (two four-bar phrases built from
 *   rhythmic motifs, repeated, sequenced and varied); lays out an intro, a
 *   build, the main part (with a break and a drop when there is room) and a
 *   cadence; and ends on the final chord so that it rings to exactly the
 *   video's length. The tempo is nudged, by a few per cent at most, so that
 *   the final chord leaves a good tail and the scene cuts fall close to beats.
 *   Each cut (a `cue`) is quantised to its nearest beat and marked there with
 *   a crash or an impact, a fill in the beat or two before it, and — when it
 *   falls near where a section would change — the change itself, moved onto
 *   the cut. It runs in Node with no Web Audio, which is what the tests use.
 *
 * - `render(score, sampleRate)` plays the score in an **OfflineAudioContext**.
 *   Percussion and plucked, struck and short tones are computed here in plain
 *   JavaScript into AudioBuffers, once per sound and pitch: a kick is a sine
 *   swept down in pitch, a snare and a clap noise over a tone, hats high-passed
 *   noise, the darbuka's dum, tek and ka a tuned membrane with noise, the oud,
 *   qanun, harp and plucks Karplus–Strong strings (a noise burst circulating in
 *   a tuned delay line), the piano a sum of slightly stretched partials. Held
 *   sounds — pads, strings, choir, brass, the ney, the risers — are the
 *   context's own oscillators and filters. All of it goes through a reverb
 *   with a generated impulse response and a compressor; the result is brought
 *   to one loudness, limited to −1 dBFS and faded at both ends.
 *
 * `composeMusic` does both and hands back a `Track`: a 44.1 kHz stereo WAV
 * as a data: URL (`encodeWav`, `toDataUrl` — the same bytes the mix reads),
 * with the spec in `generated`, so the piece can be composed again, longer or
 * calmer, and `musicCredit` knows not to credit it.
 *
 * ## The maqamat
 *
 * `oriental` is written for an Arabic and Kurdish audience: Hijaz, Bayati,
 * Nahawand or Kurd (by seed), in twelve equal steps. Hijaz's augmented second
 * is exact; Bayati's second degree is a quarter-tone that twelve steps cannot
 * write, so it takes Kurd's flat second, and the two are told apart the way a
 * player would — by the chords under them and the rhythm. The melody moves by
 * step within the maqam's lower jins, rests on the ghammaz, and closes with a
 * descending qafla to the tonic; the oud plays it with grace notes and rīsha
 * tremolo, the qanun answers in runs, the strings double it in unison, a ney
 * opens it. Under it a darbuka plays maqsum, baladi or saidi with dum, tek and
 * ka, a riq's zills and, in the fullest parts, a daf.
 */

import type { MusicSpec, Style, Track, Video } from './videotypes';
import { FPS } from './videotypes';
import { TRANSITION_FRAMES } from './video';
import { encodeWav, sceneStarts, toDataUrl } from './videomix';

export type Mood = MusicSpec['mood'];

/** The moods, in the order the panel offers them; `label` goes through t(). */
export const MUSIC_MOODS: readonly { id: Mood; label: string }[] = [
  { id: 'uplifting', label: 'Uplifting' },
  { id: 'calm', label: 'Calm' },
  { id: 'cinematic', label: 'Cinematic' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'electronic', label: 'Electronic' },
  { id: 'lofi', label: 'Lo-fi' },
  { id: 'epic', label: 'Epic' },
  { id: 'oriental', label: 'Oriental' },
];

/** Key names by pitch class, as the key picker shows them. */
export const KEY_NAMES: readonly string[] = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** The sample rate of a composed track. */
const RATE = 44100;
/** Energy when the spec does not say. */
const ENERGY = 0.6;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const mtof = (p: number) => 440 * Math.pow(2, (p - 69) / 12);
const pcOf = (p: number) => ((p % 12) + 12) % 12;
const TAU = Math.PI * 2;

// ── randomness ────────────────────────────────────────────────────────────

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32, seeded by the spec's seed and a name, so each part has its own stream. */
class Rand {
  private s: number;
  constructor(seed: number, salt: string) {
    this.s = (seed ^ hashOf(salt)) >>> 0;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(a: readonly T[]): T { return a[this.int(a.length)]; }
  chance(p: number): boolean { return this.next() < p; }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    let sum = 0;
    for (const [, w] of items) sum += w;
    let x = this.next() * sum;
    for (const [v, w] of items) {
      x -= w;
      if (x <= 0) return v;
    }
    return items[items.length - 1][0];
  }
}

// ── scales, chords, moods ─────────────────────────────────────────────────

export type ScaleName = 'major' | 'minor' | 'dorian' | 'hijaz' | 'bayati' | 'nahawand' | 'kurd';

const SCALES: Readonly<Record<ScaleName, readonly number[]>> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  // D E♭ F♯ G A B♭ C: the augmented second between the second and third degrees.
  hijaz: [0, 1, 4, 5, 7, 8, 10],
  // D E𝄳 F G A B♭ C, the half-flat second written as the flat one.
  bayati: [0, 1, 3, 5, 7, 8, 10],
  // D E F G A B♭ C♯: a minor jins with Hijaz on the fifth.
  nahawand: [0, 2, 3, 5, 7, 8, 11],
  kurd: [0, 1, 3, 5, 7, 8, 10],
};

/** A chord: its root in semitones above the key, and its tones above the root. */
interface Chord { root: number; tones: readonly number[] }

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/**
 * A chord from a Roman numeral read against the scale's own degrees — so
 * `VI` in minor is the flat sixth and `II` in Hijaz is E♭ on D. Upper case is
 * a major third, lower case a minor one; `7`, `maj7`, `9`, `maj9`, `add9`,
 * `sus2`, `sus4` and `dim` add or change tones.
 */
function chordOf(sym: string, steps: readonly number[]): Chord {
  const m = /^([b#]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(.*)$/.exec(sym.trim());
  if (!m) return { root: 0, tones: [0, 4, 7] };
  const deg = ROMAN.indexOf(m[2].toUpperCase());
  const root = pcOf((steps[deg] ?? 0) + (m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0));
  const major = m[2] === m[2].toUpperCase();
  const q = m[3];
  let third = major ? 4 : 3;
  let fifth = 7;
  const more: number[] = [];
  if (q === 'dim') { third = 3; fifth = 6; }
  if (q === 'sus2') third = 2;
  if (q === 'sus4') third = 5;
  if (q === '7') more.push(10);
  if (q === 'maj7') more.push(11);
  if (q === '9') more.push(10, 14);
  if (q === 'maj9') more.push(11, 14);
  if (q === 'add9') more.push(14);
  return { root, tones: [0, third, fifth, ...more] };
}

const chordPcs = (key: number, c: Chord) => c.tones.map((t) => pcOf(key + c.root + t));

interface Harmony {
  progressions: readonly string[];
  /** The chords of the last bars before the final one. */
  cadence: string;
  final: string;
  keys: readonly number[];
  /** The degree (0-based) the melody rests on halfway — the ghammaz, for a maqam. */
  rest: number;
}

/** A rhythm: [beat, beats] pairs within one bar of four. */
type Motif = readonly (readonly [number, number])[];

interface MoodDef {
  /** Lowest, highest and usual beats per minute. */
  tempo: readonly [number, number, number];
  harmony: Partial<Record<ScaleName, Harmony>>;
  /** Off sixteenths are late by this share of a sixteenth. */
  swing: number;
  /** Seconds a played note may drift from the grid. */
  loose: number;
  /** Reverb time (RT60, seconds) and how much of it is heard. */
  reverb: number;
  wet: number;
  /** The pad's filter, in Hz. */
  warmth: number;
  rhythms: readonly Motif[];
  cadences: readonly Motif[];
}

const MAJOR_KEYS = [0, 2, 4, 5, 7, 9];
const MINOR_KEYS = [2, 0, 9, 4, 5, 7];

const MOODS: Readonly<Record<Mood, MoodDef>> = {
  uplifting: {
    tempo: [112, 132, 122],
    harmony: { major: { progressions: ['I V vi IV', 'vi IV I V', 'IV I V vi', 'I iii IV V'], cadence: 'IV V', final: 'I', keys: MAJOR_KEYS, rest: 4 } },
    swing: 0, loose: 0.004, reverb: 2.2, wet: 0.2, warmth: 2600,
    rhythms: [
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]],
      [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
      [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
    ],
    cadences: [[[0, 1], [1, 1], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]], [[0, 2], [2, 2]]],
  },
  calm: {
    tempo: [64, 84, 72],
    harmony: { major: { progressions: ['Imaj7 IVmaj7 vi7 IVmaj7', 'Iadd9 vi7 IVmaj7 Vsus4', 'IVmaj7 Iadd9 vi7 V', 'vi7 IVmaj7 Iadd9 Vsus4'], cadence: 'IVmaj7 Vsus4', final: 'Iadd9', keys: [0, 2, 3, 5, 7, 8], rest: 4 } },
    swing: 0, loose: 0.012, reverb: 3.4, wet: 0.34, warmth: 1500,
    rhythms: [
      [[0, 2], [2, 1], [3, 1]],
      [[0, 3], [3, 1]],
      [[0, 1.5], [1.5, 0.5], [2, 2]],
      [[1, 1], [2, 2]],
    ],
    cadences: [[[0, 2], [2, 2]], [[0, 4]], [[0, 1], [1, 3]]],
  },
  cinematic: {
    tempo: [76, 96, 84],
    harmony: { minor: { progressions: ['i VI III VII', 'i VI iv V', 'VI VII i i', 'i iv VI V', 'i III VII iv'], cadence: 'iv V', final: 'i', keys: MINOR_KEYS, rest: 4 } },
    swing: 0, loose: 0.006, reverb: 3.6, wet: 0.3, warmth: 1200,
    rhythms: [
      [[0, 2], [2, 2]],
      [[0, 1], [1, 1], [2, 2]],
      [[0, 3], [3, 0.5], [3.5, 0.5]],
      [[0, 1.5], [1.5, 0.5], [2, 2]],
    ],
    cadences: [[[0, 2], [2, 2]], [[0, 4]], [[0, 1], [1, 1], [2, 2]]],
  },
  corporate: {
    tempo: [100, 118, 108],
    harmony: { major: { progressions: ['Iadd9 V vi7 IV', 'IV I V vi', 'I vi IV V', 'vi7 IVmaj7 Iadd9 V'], cadence: 'IV V', final: 'Iadd9', keys: [0, 2, 5, 7, 9, 10], rest: 4 } },
    swing: 0, loose: 0.003, reverb: 1.6, wet: 0.16, warmth: 2400,
    rhythms: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1]],
      [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
      [[0, 0.5], [0.5, 1], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]],
    ],
    cadences: [[[0, 1], [1, 1], [2, 2]], [[0, 0.5], [0.5, 0.5], [1, 1], [2, 2]]],
  },
  electronic: {
    tempo: [118, 130, 124],
    harmony: { minor: { progressions: ['i VI III VII', 'i VII VI VII', 'VI VII i i', 'i III VII VI'], cadence: 'VI VII', final: 'i', keys: [9, 2, 7, 0, 5, 4], rest: 4 } },
    swing: 0, loose: 0, reverb: 2.0, wet: 0.2, warmth: 2200,
    rhythms: [
      [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 0.75], [2.75, 0.75], [3.5, 0.5]],
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
      [[0, 0.75], [0.75, 0.75], [1.5, 2.5]],
      [[0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.75], [2.75, 1.25]],
    ],
    cadences: [[[0, 0.75], [0.75, 0.75], [1.5, 2.5]], [[0, 1], [1, 1], [2, 2]]],
  },
  lofi: {
    tempo: [70, 90, 80],
    harmony: {
      major: { progressions: ['ii7 V7 Imaj7 vi7', 'Imaj7 vi7 ii7 V7', 'IVmaj7 iii7 ii7 Imaj7', 'Imaj9 IVmaj9 iii7 vi7'], cadence: 'ii7 V7', final: 'Imaj9', keys: [0, 2, 3, 5, 7, 8, 10], rest: 4 },
      dorian: { progressions: ['i7 IV7 i7 IV7', 'i9 IIImaj7 VIImaj7 IV7', 'i7 v7 IIImaj7 IV7', 'IIImaj7 VIImaj7 i7 IV9'], cadence: 'v7 IV7', final: 'i9', keys: [9, 2, 4, 7, 0, 5], rest: 4 },
    },
    swing: 0.28, loose: 0.01, reverb: 1.3, wet: 0.18, warmth: 1200,
    rhythms: [
      [[0.5, 0.5], [1, 0.75], [2.5, 0.5], [3, 1]],
      [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.75, 1.25]],
      [[0.75, 0.25], [1, 1], [2.5, 1.5]],
      [[0, 0.5], [0.5, 0.5], [1, 2], [3.5, 0.5]],
    ],
    cadences: [[[0, 1], [1, 3]], [[0.5, 0.5], [1, 1], [2, 2]]],
  },
  epic: {
    tempo: [84, 104, 92],
    harmony: { minor: { progressions: ['i VI III VII', 'i VII VI VII', 'i iv VI V', 'VI VII i i', 'i VI VII i'], cadence: 'VI VII', final: 'i', keys: MINOR_KEYS, rest: 4 } },
    swing: 0, loose: 0.005, reverb: 3.8, wet: 0.3, warmth: 1500,
    rhythms: [
      [[0, 1.5], [1.5, 0.5], [2, 2]],
      [[0, 1], [1, 1], [2, 1], [3, 1]],
      [[0, 0.75], [0.75, 0.25], [1, 1], [2, 2]],
      [[0, 2], [2, 1], [3, 1]],
    ],
    cadences: [[[0, 2], [2, 2]], [[0, 1], [1, 1], [2, 2]]],
  },
  oriental: {
    tempo: [88, 116, 100],
    harmony: {
      hijaz: { progressions: ['I I II I', 'I iv vii I', 'I II vii I', 'I vii iv I'], cadence: 'vii II', final: 'I', keys: [2, 7, 9], rest: 3 },
      bayati: { progressions: ['i i vii i', 'i iv vii i', 'i III vii i', 'i iv III i'], cadence: 'iv vii', final: 'i', keys: [2, 9, 7], rest: 3 },
      nahawand: { progressions: ['i iv V i', 'i VI V i', 'i iv VI V', 'i i iv V'], cadence: 'iv V', final: 'i', keys: [0, 2, 7], rest: 4 },
      kurd: { progressions: ['i II i vii', 'i iv II i', 'i vii II i', 'i III vii i'], cadence: 'vii II', final: 'i', keys: [2, 9], rest: 3 },
    },
    swing: 0.04, loose: 0.008, reverb: 2.4, wet: 0.24, warmth: 1700,
    rhythms: [
      [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
      [[0, 1], [1, 0.25], [1.25, 0.25], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1]],
      [[0, 0.75], [0.75, 0.25], [1, 0.5], [1.5, 0.5], [2, 2]],
      [[0, 0.5], [0.5, 0.25], [0.75, 0.25], [1, 1], [2, 0.5], [2.5, 0.5], [3, 0.5], [3.5, 0.5]],
    ],
    cadences: [[[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]], [[0, 0.25], [0.25, 0.25], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2]]],
  },
};

/** The beats per minute a mood usually takes: what the tempo slider shows before it is moved. */
export function moodTempo(mood: Mood): number {
  return (MOODS[mood] ?? MOODS.uplifting).tempo[2];
}

/** The mood a video's style suggests, before the person picks one. */
export function moodForStyle(style: Style | undefined): Mood {
  const map: Partial<Record<Style, Mood>> = { modern: 'corporate', bold: 'electronic', elegant: 'calm', neon: 'electronic', minimal: 'calm', warm: 'uplifting' };
  return (style && map[style]) || 'uplifting';
}

// ── the score ─────────────────────────────────────────────────────────────

export type Instrument =
  | 'kick' | 'snare' | 'clap' | 'snap' | 'rim' | 'hat' | 'openhat' | 'shaker' | 'crash' | 'revcrash'
  | 'tom' | 'taiko' | 'timpani' | 'impact' | 'riser'
  | 'dum' | 'tek' | 'ka' | 'riq' | 'daf'
  | 'bass' | 'pad' | 'strings' | 'choir' | 'brass' | 'lead' | 'ney'
  | 'piano' | 'epiano' | 'bell' | 'pluck' | 'harp' | 'oud' | 'qanun' | 'arp'
  | 'vinyl';

/** One sound: what plays, from `t` for `d` seconds, at MIDI pitch `p` (tuned drums use it too), velocity `v`. */
export interface Note { i: Instrument; t: number; d: number; p: number; v: number }

export type SectionKind = 'intro' | 'build' | 'main' | 'break' | 'drop' | 'outro';

/** An Arabic rhythm the darbuka plays. */
export type Iqa = 'maqsum' | 'baladi' | 'saidi';

export interface Score {
  mood: Mood;
  seed: number;
  energy: number;
  /** The length, exactly the video's. */
  seconds: number;
  bpm: number;
  /** Seconds per beat. */
  beat: number;
  /** The key's root, 0 = C. */
  key: number;
  scale: ScaleName;
  /** The scale's steps in semitones above the key. */
  steps: readonly number[];
  iqa?: Iqa;
  /** Seconds; they cover 0 to `end`, in order. */
  sections: { kind: SectionKind; start: number; end: number }[];
  /** The scene cuts, each moved to its nearest beat, in seconds. */
  cues: number[];
  /** When the final chord is struck; it rings to `seconds`. */
  end: number;
  notes: Note[];
  /** The music bus dips on each beat here, as if the kick pushed it. */
  pump: { from: number; to: number; depth: number }[];
  reverb: { seconds: number; wet: number };
}

// ── time and form ─────────────────────────────────────────────────────────

/**
 * The tempo, and how many beats come before the final chord. Searched
 * within a few per cent of the wanted tempo (and inside the mood's range when
 * the tempo is the mood's own): the final chord should leave a tail of about
 * two seconds, and the cuts should sit close to beats.
 */
function fitTime(seconds: number, want: number, lo: number, hi: number, cues: readonly number[]): { bpm: number; nb: number } {
  const tailMin = clamp(seconds * 0.12, 1.2, 2.4);
  const tailMax = tailMin + 2;
  const ideal = tailMin + 0.3;
  const from = Math.max(lo, want * 0.96);
  const to = Math.max(from, Math.min(hi, want * 1.04));
  let best = { cost: Infinity, bpm: want, nb: 1 };
  const n = Math.round((to - from) / 0.05);
  for (let k = 0; k <= n; k++) {
    const bpm = Math.round((from + k * 0.05) * 100) / 100;
    const spb = 60 / bpm;
    const room = (seconds - tailMin) / spb;
    const unit = room >= 16 ? 4 : room >= 4 ? 2 : 1;
    let nb = Math.floor(room / unit) * unit;
    if (nb < 1) nb = Math.max(1, Math.floor((seconds - 0.25) / spb));
    const tail = seconds - nb * spb;
    let cost = (Math.abs(bpm - want) / want) * 25 + Math.abs(tail - ideal) * 1.2 + (tail > tailMax ? 50 : 0) + (tail < 0.25 ? 100 : 0);
    for (const c of cues) {
      const e = c / spb - Math.round(c / spb);
      cost += (e * e * 4) / Math.max(1, cues.length);
    }
    if (cost < best.cost - 1e-9) best = { cost, bpm, nb };
  }
  return { bpm: best.bpm, nb: best.nb };
}

interface Section { kind: SectionKind; start: number; end: number }

/** How full each kind of section is, before the energy scales it. */
const LEVEL: Readonly<Record<SectionKind, number>> = { intro: 0.3, build: 0.55, main: 0.78, break: 0.42, drop: 1, outro: 0.62 };

/**
 * The sections, in beats. Where each change would fall is worked out from
 * the length; a cut near it (within a couple of bars) takes it, so the music
 * changes when the picture does. A section is four-beat bars from its own
 * start, so one that begins on a cut keeps the bars on that cut; its last bar
 * may be short.
 */
function planForm(nb: number, cues: readonly number[]): Section[] {
  const bars = nb / 4;
  const outro = bars >= 12 ? 8 : bars >= 5 ? 4 : 0;
  const body = nb - outro;
  const plan: [SectionKind, number][] =
    bars < 3 ? [['main', 0]]
      : bars < 6 ? [['intro', 0], ['main', 0.35]]
        : bars < 12 ? [['intro', 0], ['build', 0.22], ['main', 0.45]]
          : bars < 24 ? [['intro', 0], ['build', 0.16], ['main', 0.32], ['break', 0.64], ['drop', 0.76]]
            : bars < 48 ? [['intro', 0], ['build', 0.1], ['main', 0.2], ['break', 0.55], ['drop', 0.65]]
              : bars < 80 ? [['intro', 0], ['build', 0.07], ['main', 0.14], ['break', 0.4], ['drop', 0.48], ['break', 0.72], ['drop', 0.78]]
                : [['intro', 0], ['build', 0.05], ['main', 0.1], ['break', 0.3], ['drop', 0.36], ['break', 0.56], ['main', 0.62], ['break', 0.8], ['drop', 0.84]];
  const min = bars < 6 ? 2 : 4;
  const window = Math.max(4, nb * 0.08);
  const out: Section[] = [];
  let prev = 0;
  for (const [kind, frac] of plan) {
    let at = 0;
    if (out.length) {
      const want = frac * body;
      let best = -1;
      let bestCost = Infinity;
      for (const c of cues) {
        if (c < prev + min || c > body - min || Math.abs(c - want) > window) continue;
        const cost = Math.abs(c - want) + ((c - prev) % 4 ? 1.5 : 0);
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      at = best >= 0 ? best : prev + Math.max(min, Math.round((want - prev) / 4) * 4);
      if (at > body - min) continue;
    }
    if (out.length) out[out.length - 1].end = at;
    out.push({ kind, start: at, end: body });
    prev = at;
  }
  if (outro) out.push({ kind: 'outro', start: body, end: nb });
  return out.filter((s) => s.end > s.start);
}

// ── arranging ─────────────────────────────────────────────────────────────

/** A note while arranging: in beats. `x` keeps it exactly on its beat (no swing, no looseness). */
interface Ev { i: Instrument; b: number; d: number; p: number; v: number; x: boolean }

interface Bar {
  start: number;
  len: number;
  sec: Section;
  /** Which bar of its section. */
  k: number;
  /** Bars in its section. */
  of: number;
  chord: Chord;
  /** How full: the section's level, scaled by the energy. */
  lv: number;
}

interface Ctx {
  mood: Mood;
  key: number;
  steps: readonly number[];
  scale: ScaleName;
  energy: number;
  /** The melody's tonic: the key in the octave from middle C. */
  tonic: number;
  rest: number;
  final: Chord;
  iqa?: Iqa;
  r: Rand;
}

/** The score being written. */
class Arr {
  readonly ev: Ev[] = [];
  private held = new Map<string, Ev>();
  private voiced = new Map<string, number[]>();
  constructor(readonly c: Ctx) {}

  add(i: Instrument, b: number, d: number, p: number, v: number, x = false) {
    if (!(d > 0) || !(v > 0) || !(b >= 0)) return;
    this.ev.push({ i, b, d, p, v: clamp(v, 0, 1), x });
  }

  /** A held note, joined to the same note if it has just ended: a common tone carries over. */
  hold(i: Instrument, b: number, d: number, p: number, v: number) {
    const k = `${i}:${p}`;
    const h = this.held.get(k);
    if (h && Math.abs(h.b + h.d - b) < 1e-6) {
      h.d += d;
      return;
    }
    const e: Ev = { i, b, d, p, v: clamp(v, 0, 1), x: false };
    this.ev.push(e);
    this.held.set(k, e);
  }

  /**
   * A 16-step pattern over one bar: `X` loud, `x` normal, `o` a ghost, `.`
   * nothing. Steps past a short bar's end are left out.
   */
  pat(bar: Bar, i: Instrument, pattern: string, v: number, p = 0, d = 0.25) {
    for (let s = 0; s < 16 && s < bar.len * 4 - 1e-6; s++) {
      const ch = pattern[s];
      if (!ch || ch === '.') continue;
      const vel = ch === 'X' ? 1 : ch === 'x' ? 0.78 : 0.5;
      this.add(i, bar.start + s / 4, d, p, v * vel);
    }
  }

  /** A chord voiced between lo and hi, near the last one this part played. */
  voice(part: string, chord: Chord, lo: number, hi: number, max: number): number[] {
    const got = voicing(this.c.key, chord, lo, hi, max, this.voiced.get(part));
    this.voiced.set(part, got);
    return got;
  }

  /** The bar's chord, held through the bar. */
  chordHold(bar: Bar, i: Instrument, lo: number, hi: number, max: number, v: number) {
    for (const p of this.voice(i, bar.chord, lo, hi, max)) this.hold(i, bar.start, bar.len, p, v);
  }

  /** The bar's chord struck on a rhythm. */
  comp(bar: Bar, i: Instrument, hits: Motif, lo: number, hi: number, v: number, max = 4) {
    const ps = this.voice(i, bar.chord, lo, hi, max);
    for (const [at, d] of hits) {
      if (at >= bar.len - 1e-6) continue;
      for (const p of ps) this.add(i, bar.start + at, Math.min(d, bar.len - at), p, v * (at === 0 ? 1 : 0.85));
    }
  }

  /** The bar's chord broken into notes, `rate` beats apart. */
  arp(bar: Bar, i: Instrument, rate: number, shape: 'up' | 'updown' | 'pedal' | 'broken', lo: number, hi: number, v: number, d = rate * 0.9) {
    const base = this.voice(`${i}:arp`, bar.chord, lo, lo + 13, 4);
    const tones = [...base, ...base.map((p) => p + 12), ...base.map((p) => p + 24)].filter((p) => p <= hi);
    if (!tones.length) return;
    const n = Math.round(bar.len / rate);
    const m = tones.length;
    for (let k = 0; k < n; k++) {
      let idx: number;
      if (shape === 'up') idx = k % m;
      else if (shape === 'updown') { const per = Math.max(1, 2 * m - 2); const q = k % per; idx = q < m ? q : per - q; }
      else if (shape === 'pedal') idx = k % 2 === 0 ? 0 : 1 + ((k >> 1) % Math.max(1, m - 1));
      else idx = [0, 2, 1, 3, 2, 1, 3, 2][k % 8] % m;
      this.add(i, bar.start + k * rate, d, tones[Math.min(idx, m - 1)], v * (k % 4 === 0 ? 1 : 0.8));
    }
  }

  /** The lowest pitch at or above `lo` with this pitch class. */
  low(pc: number, lo: number): number {
    return lo + pcOf(pc - lo);
  }

  root(bar: Bar): number {
    return pcOf(this.c.key + bar.chord.root);
  }
}

/**
 * A voicing of a chord between lo and hi: every inversion that fits is
 * tried, and the one that moves least from the last voicing wins (or the one
 * nearest the middle of the range, the first time). A chord with more tones
 * than the part plays loses its fifth first, then its root.
 */
function voicing(key: number, c: Chord, lo: number, hi: number, max: number, prev?: readonly number[]): number[] {
  let tones = c.tones.slice();
  if (tones.length > max) tones = tones.filter((t) => t !== 7);
  if (tones.length > max) tones = tones.filter((t) => t !== 0);
  tones = tones.slice(0, Math.max(1, max));
  const pcs = tones.map((t) => pcOf(key + c.root + t));
  const cands: number[][] = [];
  for (let rot = 0; rot < pcs.length; rot++) {
    const order = [...pcs.slice(rot), ...pcs.slice(0, rot)];
    for (let base = lo; base <= hi; base++) {
      if (pcOf(base) !== order[0]) continue;
      const v = [base];
      for (let k = 1; k < order.length; k++) {
        let p = v[k - 1] + 1;
        while (pcOf(p) !== order[k]) p++;
        v.push(p);
      }
      if (v[v.length - 1] <= hi) cands.push(v);
    }
  }
  if (!cands.length) {
    const v = [lo + pcOf(pcs[0] - lo)];
    for (let k = 1; k < pcs.length; k++) {
      let p = v[k - 1] + 1;
      while (pcOf(p) !== pcs[k]) p++;
      v.push(p);
    }
    return v;
  }
  const mid = (lo + hi) / 2;
  const mean = (a: readonly number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  let best = cands[0];
  let bestCost = Infinity;
  for (const v of cands) {
    let cost: number;
    if (prev && prev.length === v.length) cost = v.reduce((s, p, k) => s + Math.abs(p - prev[k]), 0);
    else if (prev && prev.length) cost = Math.abs(mean(v) - mean(prev)) * v.length;
    else cost = Math.abs(mean(v) - mid);
    if (cost < bestCost - 1e-9) { bestCost = cost; best = v; }
  }
  return best;
}

// ── the theme ─────────────────────────────────────────────────────────────

/** A theme note: its beat in a four-bar phrase, its length, its scale degree (0 = tonic, 7 = the octave). */
interface TNote { at: number; d: number; deg: number }

const STEPS: readonly (readonly [number, number])[] = [[-1, 0.3], [1, 0.3], [-2, 0.1], [2, 0.1], [0, 0.08], [3, 0.05], [-3, 0.04], [4, 0.03]];
const STEPS_MAQAM: readonly (readonly [number, number])[] = [[-1, 0.38], [1, 0.36], [0, 0.1], [-2, 0.07], [2, 0.07], [3, 0.02]];

/** Degrees from `start`, mostly by step; after a leap, a step back the other way. */
function walk(r: Rand, n: number, start: number, lo: number, hi: number, up: number, steps: typeof STEPS): number[] {
  const out = [clamp(start, lo, hi)];
  let last = 0;
  for (let k = 1; k < n; k++) {
    let step: number;
    if (Math.abs(last) >= 3) step = -Math.sign(last) * r.pick([1, 1, 2]);
    else step = r.weighted(steps) + (r.chance(Math.abs(up)) ? Math.sign(up) : 0);
    let d = out[k - 1] + step;
    if (d < lo || d > hi) d = out[k - 1] - step;
    d = clamp(d, lo, hi);
    last = d - out[k - 1];
    out.push(d);
  }
  return out;
}

/** `n` degrees that arrive at `to` by step, from the side `from` is on. */
function arrive(n: number, from: number, to: number, lo: number, hi: number): number[] {
  const dir = from >= to ? 1 : -1;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(clamp(to + dir * (n - 1 - k), lo, hi));
  return out;
}

/**
 * Two four-bar phrases. A: a motif, the motif a step or two higher, a second
 * motif, and a cadence that stops halfway (on the fifth, or the ghammaz). B:
 * the second motif and its sequence a step lower, the first motif again, and
 * a cadence home to the tonic.
 */
function makeTheme(r: Rand, def: MoodDef, maqam: boolean, rest: number): [TNote[], TNote[]] {
  const bank = def.rhythms;
  const m1 = r.pick(bank);
  let m2 = r.pick(bank);
  if (m2 === m1 && bank.length > 1) m2 = bank[(bank.indexOf(m1) + 1 + r.int(bank.length - 1)) % bank.length];
  const lo = maqam ? -2 : -3;
  const hi = maqam ? 8 : 9;
  const steps = maqam ? STEPS_MAQAM : STEPS;
  const place = (bar: number, motif: Motif, degs: readonly number[]): TNote[] => motif.map(([at, d], k) => ({ at: bar * 4 + at, d, deg: degs[k] }));

  const s0 = maqam ? r.pick([0, 0, 1, 2]) : r.pick([0, 2, 4, 4, 2]);
  const c1 = walk(r, m1.length, s0, lo, hi, 0.15, steps);
  const shift = maqam ? r.pick([1, 1, 2, -1]) : r.pick([1, 2, -1, 2]);
  const c1b = c1.map((d) => clamp(d + shift, lo, hi));
  const c2 = walk(r, m2.length, c1b[c1b.length - 1] + (maqam ? 1 : r.pick([1, -1])), lo, hi, 0.25, steps);
  const cadA = r.pick(def.cadences);
  const aEnd = maqam ? rest : r.pick([rest, 1, rest]);
  const A = [...place(0, m1, c1), ...place(1, m1, c1b), ...place(2, m2, c2), ...place(3, cadA, arrive(cadA.length, c2[c2.length - 1], aEnd, lo, hi))];

  const bStart = maqam ? clamp(rest + r.pick([0, 1, 2]), lo, hi) : clamp(s0 + r.pick([2, 3, 4]), lo, hi);
  const d1 = walk(r, m2.length, bStart, lo, hi, 0.1, steps);
  const d1b = d1.map((d) => clamp(d - 1, lo, hi));
  const c3 = c1.map((d) => clamp(d + (maqam ? 0 : r.pick([0, 2])), lo, hi));
  const cadB = r.pick(def.cadences);
  const B = [...place(0, m2, d1), ...place(1, m2, d1b), ...place(2, m1, c3), ...place(3, cadB, arrive(Math.max(cadB.length, maqam ? 4 : 1), c3[c3.length - 1], 0, lo, hi).slice(-cadB.length))];
  return [A, B];
}

function degPitch(deg: number, tonic: number, steps: readonly number[]): number {
  const o = Math.floor(deg / 7);
  return tonic + 12 * o + steps[deg - 7 * o];
}

/** The scale note `n` steps from pitch p (p itself on the scale, or taken to the one below it). */
function stepFrom(p: number, n: number, key: number, steps: readonly number[]): number {
  const rel = p - key;
  const o = Math.floor(rel / 12);
  const pc = rel - 12 * o;
  let k = 0;
  for (let j = 0; j < steps.length; j++) if (steps[j] <= pc) k = j;
  const deg = 7 * o + k + n;
  const oo = Math.floor(deg / 7);
  return key + 12 * oo + steps[deg - 7 * oo];
}

/**
 * A melody note made to agree with the chord under it: on a strong beat the
 * nearest chord tone; otherwise the scale note, unless the chord brings a
 * note from outside the scale a semitone away (the leading note of a major V
 * in minor), which then replaces it.
 */
function agree(p: number, key: number, chord: Chord, steps: readonly number[], strong: boolean): number {
  const pcs = chordPcs(key, chord);
  if (strong) {
    let best = p;
    let bd = Infinity;
    for (let q = p - 4; q <= p + 4; q++) {
      if (!pcs.includes(pcOf(q))) continue;
      const d = Math.abs(q - p) + (q > p ? 0.1 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }
  for (const pc of pcs) {
    if (steps.includes(pcOf(pc - key))) continue;
    for (const q of [p - 1, p + 1]) if (pcOf(q) === pc) return q;
  }
  return p;
}

/** Which instruments carry the theme in each kind of section, how high (semitones over the tonic) and how loud. */
interface Line { i: Instrument; oct: number; v: number; frag?: boolean; slow?: boolean; riff?: boolean }

const MELODY: Readonly<Record<Mood, Partial<Record<SectionKind, readonly Line[]>>>> = {
  uplifting: {
    intro: [{ i: 'bell', oct: 12, v: 0.4, frag: true }],
    main: [{ i: 'bell', oct: 12, v: 0.62 }, { i: 'piano', oct: 12, v: 0.4 }],
    break: [{ i: 'bell', oct: 12, v: 0.5, frag: true }],
    drop: [{ i: 'pluck', oct: 12, v: 0.72 }, { i: 'bell', oct: 24, v: 0.38 }],
    outro: [{ i: 'bell', oct: 12, v: 0.55 }],
  },
  corporate: {
    build: [{ i: 'bell', oct: 12, v: 0.45, frag: true }],
    main: [{ i: 'bell', oct: 12, v: 0.58 }],
    break: [{ i: 'piano', oct: 12, v: 0.5, frag: true }],
    drop: [{ i: 'bell', oct: 12, v: 0.62 }, { i: 'piano', oct: 0, v: 0.42 }],
    outro: [{ i: 'bell', oct: 12, v: 0.5 }],
  },
  calm: {
    intro: [{ i: 'piano', oct: 12, v: 0.38, frag: true }],
    build: [{ i: 'piano', oct: 12, v: 0.42 }],
    main: [{ i: 'piano', oct: 12, v: 0.48 }],
    drop: [{ i: 'piano', oct: 12, v: 0.52 }, { i: 'strings', oct: 12, v: 0.28, slow: true }],
    outro: [{ i: 'piano', oct: 12, v: 0.42 }],
  },
  cinematic: {
    intro: [{ i: 'piano', oct: 12, v: 0.42, frag: true }],
    build: [{ i: 'piano', oct: 12, v: 0.46 }],
    main: [{ i: 'strings', oct: 12, v: 0.5 }],
    break: [{ i: 'piano', oct: 12, v: 0.48 }],
    drop: [{ i: 'strings', oct: 12, v: 0.58 }, { i: 'piano', oct: 24, v: 0.36 }],
    outro: [{ i: 'piano', oct: 12, v: 0.44 }],
  },
  epic: {
    intro: [{ i: 'strings', oct: 12, v: 0.42, frag: true, slow: true }],
    main: [{ i: 'strings', oct: 12, v: 0.56 }],
    break: [{ i: 'piano', oct: 12, v: 0.44 }],
    drop: [{ i: 'brass', oct: 0, v: 0.62 }, { i: 'strings', oct: 12, v: 0.5 }],
    outro: [{ i: 'brass', oct: 0, v: 0.52 }],
  },
  electronic: {
    main: [{ i: 'pluck', oct: 12, v: 0.55 }],
    break: [{ i: 'pluck', oct: 12, v: 0.45, frag: true }],
    drop: [{ i: 'lead', oct: 12, v: 0.55 }, { i: 'pluck', oct: 24, v: 0.32 }],
    outro: [{ i: 'lead', oct: 12, v: 0.45 }],
  },
  lofi: {
    intro: [{ i: 'epiano', oct: 12, v: 0.38, frag: true }],
    main: [{ i: 'epiano', oct: 12, v: 0.48 }],
    break: [{ i: 'pluck', oct: 0, v: 0.42, frag: true }],
    drop: [{ i: 'epiano', oct: 12, v: 0.52 }, { i: 'bell', oct: 24, v: 0.2 }],
    outro: [{ i: 'epiano', oct: 12, v: 0.42 }],
  },
  oriental: {
    intro: [{ i: 'ney', oct: 12, v: 0.55, slow: true }],
    build: [{ i: 'oud', oct: 0, v: 0.62, riff: true }],
    main: [{ i: 'oud', oct: 0, v: 0.72 }],
    break: [{ i: 'ney', oct: 12, v: 0.5 }, { i: 'qanun', oct: 12, v: 0.4, frag: true }],
    drop: [{ i: 'oud', oct: 0, v: 0.76 }, { i: 'strings', oct: 12, v: 0.46 }],
    outro: [{ i: 'oud', oct: 0, v: 0.7 }, { i: 'strings', oct: 12, v: 0.42 }],
  },
};

/** An oud note as it is played: a grace note from above on some strong beats, and rīsha tremolo on long notes. */
function oudNote(a: Arr, b: number, d: number, p: number, v: number, lv: number, r: Rand) {
  const { key, steps } = a.c;
  if (d >= 1 && lv >= 0.45 && r.chance(0.6)) {
    const rate = 0.25;
    let k = 0;
    for (let x = 0; x < d - 0.01; x += rate, k++) a.add('oud', b + x, rate, p, v * (k === 0 ? 1 : k % 2 ? 0.52 : 0.66));
    return;
  }
  if (Math.abs(b - Math.round(b)) < 1e-6 && r.chance(0.3)) a.add('oud', b - 0.125, 0.14, stepFrom(p, 1, key, steps), v * 0.55);
  a.add('oud', b, d, p, v);
}

/** The theme through one section, on each instrument the mood gives it there. */
function melodySection(a: Arr, sec: Section, bars: readonly Bar[], theme: readonly [TNote[], TNote[]], lines: readonly Line[], secIndex: number) {
  const c = a.c;
  const maqam = c.mood === 'oriental';
  for (const line of lines) {
    const r = new Rand(c.r.int(1 << 30), `melody:${secIndex}:${line.i}`);
    const stretch = line.slow ? 2 : 1;
    const span = sec.end - sec.start;
    const played: Ev[] = [];
    const emit = (b: number, d: number, deg: number, bar: Bar) => {
      let p = degPitch(deg, c.tonic + line.oct, c.steps);
      const into = b - bar.start;
      if (!maqam) p = agree(p, c.key, bar.chord, c.steps, Math.abs(into - Math.round(into / 2) * 2) < 1e-6 || d >= 1);
      if (line.i === 'oud') oudNote(a, b, d, p, line.v, bar.lv, r);
      else a.add(line.i, b, d * (line.i === 'piano' || line.i === 'epiano' ? 1.05 : 0.94), p, line.v * (Math.abs(b - Math.round(b)) < 1e-6 ? 1 : 0.86));
      played.push({ i: line.i, b, d, p, v: line.v, x: false });
    };
    const barAt = (b: number) => bars.find((x) => b >= x.start - 1e-9 && b < x.start + x.len - 1e-9) ?? bars[bars.length - 1];

    if (line.riff) {
      const motif = theme[0].filter((n) => n.at < 4);
      for (const bar of bars) for (const n of motif) {
        if (n.at >= bar.len - 1e-6) continue;
        emit(bar.start + n.at, Math.min(n.d, bar.len - n.at), n.deg, bar);
      }
    } else {
      const phraseLen = 16 * stretch;
      for (let ph = 0; ph * phraseLen < span - 1e-9; ph++) {
        let notes = theme[ph % 2];
        if (ph >= 2) notes = notes.map((n) => (n.at < 12 && n.at % 1 !== 0 && r.chance(0.3) ? { ...n, deg: n.deg + r.pick([-1, 1]) } : n));
        for (const n of notes) {
          if (line.frag && n.at >= 4) continue;
          const b = sec.start + ph * phraseLen + n.at * stretch;
          if (b >= sec.end - 1e-9) continue;
          emit(b, Math.min(n.d * stretch, sec.end - b), n.deg, barAt(b));
        }
      }
    }

    // The strings play a line legato: each note held into the next.
    if (line.i === 'strings') {
      const mine = a.ev.filter((e) => e.i === 'strings' && e.b >= sec.start && e.b < sec.end && played.some((q) => q.b === e.b && q.p === e.p));
      for (let k = 0; k < mine.length - 1; k++) mine[k].d = Math.max(mine[k].d, Math.min(3, mine[k + 1].b - mine[k].b));
    }
    // The qanun answers the oud's long notes with a run down to them, an octave up.
    if (maqam && line.i === 'oud') {
      for (const e of played) {
        const bar = barAt(e.b);
        if (e.d < 1.5 || bar.lv < 0.6) continue;
        const at = e.b + e.d - 1;
        for (let k = 0; k < 4; k++) a.add('qanun', at + k * 0.25, 0.3, stepFrom(e.p + 12, 4 - k, c.key, c.steps), 0.34 + 0.05 * k);
      }
    }
  }
}

// ── the moods, bar by bar ─────────────────────────────────────────────────

interface Iqat { dum: string; tek: string; ka: string }

const IQAT: Readonly<Record<Iqa, Iqat>> = {
  // D T - T D - T -
  maqsum: { dum: 'X.......X.......', tek: '..x...x.....x...', ka: '....o.....o...o.' },
  // D D - T D - T -
  baladi: { dum: 'X.x.....X.......', tek: '......x.....x...', ka: '....o.....o...o.' },
  // D T - D D - T -
  saidi: { dum: 'X.....x.X.......', tek: '..x.........x...', ka: '....o.....o...o.' },
};

/** Where the kick, the snare and the like of each mood go, bar by bar. */
interface Arranger {
  bar(a: Arr, bar: Bar): void;
  /** At a cut: a crash or an impact, exactly on its beat. */
  accent(a: Arr, beat: number, lv: number): void;
  /** In the `len` beats before a cut. */
  fill(a: Arr, beat: number, len: number, lv: number): void;
  /** The parts a fill takes the place of. */
  clears: readonly Instrument[];
  /** At the start of a section that is not the first. */
  enter(a: Arr, sec: Section, lv: number): void;
  /** The last chord, struck at `beat` and held `tail` beats. */
  finale(a: Arr, beat: number, tail: number): void;
  /** How deep the pump is, in the sections that have one. */
  pump?: Partial<Record<SectionKind, number>>;
}

function snareRoll(a: Arr, i: Instrument, from: number, to: number, rate: number, v0: number, v1: number) {
  const n = Math.max(1, Math.round((to - from) / rate));
  for (let k = 0; k < n; k++) a.add(i, from + k * rate, rate, 0, v0 + ((v1 - v0) * k) / Math.max(1, n - 1));
}

function scaleRun(a: Arr, i: Instrument, from: number, to: number, startPitch: number, n: number, v: number, dir = 1) {
  const { key, steps } = a.c;
  const rate = (to - from) / n;
  for (let k = 0; k < n; k++) a.add(i, from + k * rate, rate * 1.6, stepFrom(startPitch, dir * k, key, steps), v * (0.7 + (0.3 * k) / n));
}

function bassLine(a: Arr, bar: Bar, style: 'whole' | 'halves' | 'drive' | 'syncop' | 'offbeat' | 'rolling' | 'lofi', v: number, lo = 33) {
  const root = a.low(a.root(bar), lo);
  const fifth = root + 7 <= lo + 16 ? root + 7 : root - 5;
  const L = bar.len;
  const at = (b: number, d: number, p: number, vv = 1) => { if (b < L - 1e-6) a.add('bass', bar.start + b, Math.min(d, L - b), p, v * vv); };
  switch (style) {
    case 'whole': at(0, L * 0.98, root); break;
    case 'halves': at(0, 1.9, root); at(2, 1.9, root, 0.9); break;
    case 'drive': for (let k = 0; k < 8; k++) at(k * 0.5, 0.42, k === 7 ? fifth : root, k % 2 ? 0.8 : 1); break;
    case 'syncop': at(0, 1.4, root); at(1.5, 0.4, root, 0.8); at(2, 1.4, root, 0.9); at(3.5, 0.45, fifth, 0.8); break;
    case 'offbeat': for (let k = 0; k < 4; k++) at(k + 0.5, 0.4, root, k % 2 ? 0.85 : 1); break;
    case 'rolling': for (let s = 0; s < 16; s++) if (s % 4) at(s / 4, 0.22, s === 14 ? root + 12 : root, s % 4 === 2 ? 0.95 : 0.75); break;
    case 'lofi': at(0, 1.3, root); at(1.75, 0.5, root, 0.7); at(2.5, 0.9, fifth, 0.85); at(3.5, 0.45, root + (a.c.r.chance(0.5) ? 2 : -1), 0.7); break;
  }
}

const STYLES: Readonly<Record<Mood, Arranger>> = {
  uplifting: {
    bar(a, bar) {
      const lv = bar.lv;
      a.chordHold(bar, 'pad', 55, 72, 4, 0.5 + 0.2 * lv);
      const lh = a.low(a.root(bar), 36);
      if (lv < 0.5) {
        a.comp(bar, 'piano', [[0, bar.len]], 60, 76, 0.4 + 0.2 * lv);
        a.add('piano', bar.start, bar.len, lh, 0.38);
      } else if (lv < 0.85) {
        a.comp(bar, 'piano', [[0, 1.4], [1.5, 1], [2.5, 0.45], [3, 1]], 60, 77, 0.5);
        a.add('piano', bar.start, Math.min(2, bar.len), lh, 0.46);
        a.add('piano', bar.start + 2, Math.min(2, bar.len - 2), lh + 12, 0.4);
      } else {
        a.comp(bar, 'piano', [[0, 0.45], [0.5, 0.45], [1, 0.45], [1.5, 0.45], [2, 0.45], [2.5, 0.45], [3, 0.45], [3.5, 0.45]], 60, 77, 0.44);
        a.add('piano', bar.start, bar.len, lh, 0.5);
      }
      if (lv >= 0.45) a.arp(bar, 'arp', lv >= 0.85 ? 0.25 : 0.5, 'up', 64, 88, 0.42, 0.22);
      if (lv >= 0.4) bassLine(a, bar, lv >= 0.7 ? 'drive' : 'halves', 0.8);
      if (lv >= 0.5) a.pat(bar, 'kick', lv >= 0.62 ? 'X...x...X...x...' : 'X.......X.......', 0.95);
      if (lv >= 0.6) a.pat(bar, 'clap', '....X.......X...', 0.8);
      if (lv >= 0.85) { a.pat(bar, 'hat', 'xoxoxoxoxoxoxoxo', 0.55); a.pat(bar, 'openhat', '..x...x...x...x.', 0.55); }
      else if (lv >= 0.45) a.pat(bar, 'hat', '..x...x...x...x.', 0.7);
      else if (lv >= 0.25) a.pat(bar, 'shaker', 'o.x.o.x.o.x.o.x.', 0.7);
      if (lv >= 0.88) a.chordHold(bar, 'strings', 48, 67, 4, 0.5);
    },
    accent(a, b, lv) {
      a.add('crash', b, 2.5, 0, 0.5 + 0.4 * Math.min(1, lv), true);
      if (lv >= 0.4) a.add('kick', b, 0.5, 0, 1, true);
    },
    fill(a, b, len, lv) {
      if (lv >= 0.8 && len >= 2) { a.add('tom', b - 2, 0.5, 55, 0.7); a.add('tom', b - 1.5, 0.5, 52, 0.75); snareRoll(a, 'snare', b - 1, b, 0.25, 0.5, 0.95); }
      else if (lv >= 0.5) snareRoll(a, 'snare', b - 1, b, 0.25, 0.35, 0.8);
      a.add('revcrash', b - Math.min(2, len), Math.min(2, len), 0, 0.5);
    },
    clears: ['clap', 'hat', 'openhat', 'shaker', 'snare'],
    enter(a, sec) {
      if (sec.kind === 'main' || sec.kind === 'drop') a.add('riser', Math.max(0, sec.start - 4), Math.min(4, sec.start), 0, 0.5);
    },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 55, 72, 4)) a.add('pad', b, tail, p, 0.6, true);
      for (const p of voicing(a.c.key, f, 60, 77, 4)) a.add('piano', b, tail, p, 0.62, true);
      a.add('piano', b, tail, a.low(a.c.key, 36), 0.6, true);
      a.add('strings', b, tail, a.low(a.c.key, 48), 0.5, true);
      a.add('bell', b, tail, a.c.tonic + 24, 0.4, true);
      a.add('bass', b, tail, a.low(a.c.key, 33), 0.8, true);
      a.add('kick', b, 0.5, 0, 1, true);
      a.add('crash', b, tail, 0, 0.8, true);
    },
    pump: { drop: 0.22 },
  },

  corporate: {
    bar(a, bar) {
      const lv = bar.lv;
      a.chordHold(bar, 'pad', 57, 74, 3, 0.35 + 0.15 * lv);
      if (lv >= 0.25) a.arp(bar, 'pluck', lv >= 0.8 ? 0.25 : 0.5, 'broken', 55, 79, 0.6, lv >= 0.8 ? 0.2 : 0.35);
      if (lv >= 0.55) a.comp(bar, 'piano', [[0.5, 0.35], [1.5, 0.35], [2.5, 0.35], [3.5, 0.35]], 62, 77, 0.42);
      else if (lv >= 0.15) a.comp(bar, 'piano', [[0, bar.len]], 60, 76, 0.34);
      if (lv >= 0.45) bassLine(a, bar, lv >= 0.8 ? 'drive' : 'syncop', 0.75);
      if (lv >= 0.55) a.pat(bar, 'kick', lv >= 0.8 ? 'X.....x.X..x....' : 'X.....x.X.......', 0.9);
      if (lv >= 0.7) a.pat(bar, 'clap', '....X.......X...', 0.72);
      else if (lv >= 0.38) a.pat(bar, 'snap', '....X.......X...', 0.8);
      if (lv >= 0.8) a.pat(bar, 'hat', 'xoxoxoxoxoxoxoxo', 0.5);
      else if (lv >= 0.5) a.pat(bar, 'hat', '..x...x...x...x.', 0.65);
      if (lv >= 0.35) a.pat(bar, 'shaker', 'oxoxoxoxoxoxoxox', 0.45);
      if (lv >= 0.9) a.chordHold(bar, 'strings', 50, 69, 4, 0.42);
    },
    accent(a, b, lv) {
      a.add('crash', b, 2, 0, 0.45 + 0.35 * Math.min(1, lv), true);
      if (lv >= 0.45) a.add('kick', b, 0.5, 0, 0.95, true);
    },
    fill(a, b, len, lv) {
      if (lv >= 0.55) snareRoll(a, 'snare', b - 1, b, 0.25, 0.3, 0.7);
      a.add('revcrash', b - Math.min(2, len), Math.min(2, len), 0, 0.4);
    },
    clears: ['clap', 'snap', 'hat', 'shaker'],
    enter(a, sec) {
      if (sec.kind === 'drop') a.add('riser', Math.max(0, sec.start - 4), Math.min(4, sec.start), 0, 0.35);
    },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 57, 74, 3)) a.add('pad', b, tail, p, 0.5, true);
      for (const p of voicing(a.c.key, f, 60, 77, 4)) a.add('piano', b, tail, p, 0.55, true);
      for (const p of voicing(a.c.key, f, 55, 79, 4)) a.add('pluck', b, tail, p, 0.5, true);
      a.add('bell', b, tail, a.c.tonic + 12, 0.5, true);
      a.add('bass', b, tail, a.low(a.c.key, 33), 0.75, true);
      a.add('kick', b, 0.5, 0, 0.95, true);
      a.add('crash', b, tail, 0, 0.7, true);
    },
  },

  calm: {
    bar(a, bar) {
      const lv = bar.lv;
      a.chordHold(bar, 'pad', 52, 71, 4, 0.45 + 0.2 * lv);
      const rate = lv >= 0.5 ? 0.5 : 1;
      a.add('piano', bar.start, bar.len, a.low(a.root(bar), 36), 0.36);
      a.arp(bar, 'piano', rate, 'updown', 52, 79, 0.36 + 0.14 * lv, rate * 1.8);
      if (lv >= 0.3) bassLine(a, bar, 'whole', 0.55, 36);
      if (lv >= 0.55) a.chordHold(bar, 'strings', 55, 74, 3, 0.3 + 0.2 * lv);
      if (lv >= 0.6) a.pat(bar, 'shaker', 'o.x.o.x.o.x.o.x.', 0.45);
      if (lv >= 0.78) a.pat(bar, 'kick', 'x.......x.......', 0.5);
      if (lv >= 0.85) a.pat(bar, 'rim', '........x.......', 0.45);
      if (lv >= 0.8 && bar.k % 2 === 1) a.arp(bar, 'harp', 0.25, 'up', 64, 91, 0.3, 0.6);
    },
    accent(a, b, lv) {
      a.add('crash', b, 3, 0, 0.22 + 0.12 * Math.min(1, lv), true);
      a.add('bell', b, 2.5, a.c.tonic + 24, 0.32, true);
      a.add('bell', b, 2.5, a.c.tonic + 31, 0.22, true);
    },
    fill(a, b, len) {
      scaleRun(a, 'harp', b - Math.min(1, len), b, a.c.tonic + 12, 8, 0.36);
    },
    clears: ['shaker', 'rim'],
    enter() { /* calm moves on without announcing it */ },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 52, 71, 4)) a.add('pad', b, tail, p, 0.55, true);
      voicing(a.c.key, f, 48, 79, 5).forEach((p, k) => a.add('piano', b + k * 0.12, tail - k * 0.12, p, 0.46 - k * 0.03));
      a.add('piano', b, tail, a.low(a.c.key, 36), 0.45, true);
      for (const p of voicing(a.c.key, f, 55, 74, 3)) a.add('strings', b, tail, p, 0.36, true);
      a.add('bass', b, tail, a.low(a.c.key, 36), 0.5, true);
      a.add('bell', b, tail, a.c.tonic + 24, 0.3, true);
    },
  },

  cinematic: {
    bar(a, bar) {
      const lv = bar.lv;
      a.chordHold(bar, 'pad', 50, 67, 3, 0.45 + 0.2 * lv);
      if (lv >= 0.3) a.chordHold(bar, 'strings', 43, 64, 4, 0.3 + 0.35 * lv);
      if (lv >= 0.5) a.arp(bar, 'arp', lv >= 0.8 ? 0.25 : 0.5, 'pedal', 50, 69, 0.45 + 0.2 * lv, lv >= 0.8 ? 0.2 : 0.35);
      if (lv >= 0.3) bassLine(a, bar, 'whole', 0.6, 31);
      if (lv < 0.5) a.add('piano', bar.start, bar.len, a.low(a.root(bar), 36), 0.4);
      if (lv >= 0.45) a.pat(bar, 'taiko', lv >= 0.8 ? 'X..x..x.X.......' : 'X...............', 0.78);
      if (lv >= 0.65) a.pat(bar, 'tom', lv >= 0.9 ? '....x.....x.x.x.' : '..........x.....', 0.55, 50);
      if (lv >= 0.9) a.pat(bar, 'snare', '........X.......', 0.6);
      if (lv >= 0.85) a.chordHold(bar, 'strings', 62, 79, 3, 0.35);
    },
    accent(a, b, lv) {
      a.add('impact', b, 3, 0, 0.5 + 0.4 * Math.min(1, lv), true);
      if (lv >= 0.5) a.add('crash', b, 3, 0, 0.5, true);
      a.add('timpani', b, 2, a.low(a.c.key, 38), 0.7, true);
    },
    fill(a, b, len, lv) {
      if (lv >= 0.5) snareRoll(a, 'timpani', b - 1, b, 0.125, 0.2, 0.6);
      a.add('revcrash', b - Math.min(2, len), Math.min(2, len), 0, 0.45);
    },
    clears: ['taiko', 'tom', 'snare'],
    enter(a, sec) {
      if (sec.kind === 'main' || sec.kind === 'drop') a.add('riser', Math.max(0, sec.start - 8), Math.min(8, sec.start), 0, 0.4);
    },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 50, 67, 3)) a.add('pad', b, tail, p, 0.6, true);
      for (const p of voicing(a.c.key, f, 43, 67, 4)) a.add('strings', b, tail, p, 0.6, true);
      a.add('piano', b, tail, a.low(a.c.key, 36), 0.55, true);
      a.add('piano', b, tail, a.low(a.c.key, 48), 0.45, true);
      a.add('bass', b, tail, a.low(a.c.key, 31), 0.7, true);
      a.add('impact', b, tail, 0, 0.85, true);
      a.add('timpani', b, tail, a.low(a.c.key, 38), 0.8, true);
      a.add('crash', b, tail, 0, 0.5, true);
    },
  },

  epic: {
    bar(a, bar) {
      const lv = bar.lv;
      a.chordHold(bar, 'pad', 50, 69, 3, 0.4);
      if (lv >= 0.3) a.chordHold(bar, 'strings', 43, 67, 4, 0.35 + 0.3 * lv);
      if (lv >= 0.45) a.arp(bar, 'arp', lv >= 0.7 ? 0.25 : 0.5, 'pedal', 45, 64, 0.5 + 0.2 * lv, lv >= 0.7 ? 0.2 : 0.35);
      bassLine(a, bar, 'whole', 0.65, 31);
      if (lv >= 0.3) a.pat(bar, 'taiko', lv >= 0.85 ? 'X..xX.x.X..xX.xx' : lv >= 0.6 ? 'X..x..x.X...x...' : 'X.......x.......', 0.82);
      if (lv >= 0.7) a.pat(bar, 'tom', '...x......x...x.', 0.5, 52);
      if (lv >= 0.75) a.pat(bar, 'snare', '....X.......X...', 0.62);
      if (lv >= 0.75) a.chordHold(bar, 'choir', 55, 72, 3, 0.42);
      if (lv >= 0.85) a.comp(bar, 'brass', [[0, 1.5], [2.5, 1.4]], 46, 62, 0.48, 3);
      if (bar.sec.kind === 'drop' && bar.k > 0 && bar.k % 4 === 0) a.add('crash', bar.start, 2.5, 0, 0.5);
    },
    accent(a, b, lv) {
      a.add('impact', b, 3, 0, 0.6 + 0.35 * Math.min(1, lv), true);
      a.add('crash', b, 3, 0, 0.6, true);
      a.add('taiko', b, 1.5, 0, 1, true);
    },
    fill(a, b, len, lv) {
      if (lv >= 0.5) {
        if (len >= 2) snareRoll(a, 'tom', b - 2, b - 1, 0.25, 0.45, 0.65);
        snareRoll(a, 'snare', b - 1, b, 0.125, 0.4, 0.95);
      }
      a.add('revcrash', b - Math.min(2, len), Math.min(2, len), 0, 0.5);
    },
    clears: ['taiko', 'tom', 'snare'],
    enter(a, sec) {
      if (sec.kind === 'main' || sec.kind === 'drop') a.add('riser', Math.max(0, sec.start - 8), Math.min(8, sec.start), 0, 0.45);
      if (sec.kind === 'drop') for (const p of voicing(a.c.key, { root: 0, tones: [0, 7, 12] }, 36, 52, 3)) a.add('brass', sec.start, 6, p, 0.6, true);
    },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 43, 67, 4)) a.add('strings', b, tail, p, 0.65, true);
      for (const p of voicing(a.c.key, f, 55, 72, 3)) a.add('choir', b, tail, p, 0.55, true);
      for (const p of voicing(a.c.key, { root: 0, tones: [0, 7, 12] }, 38, 55, 3)) a.add('brass', b, tail, p, 0.6, true);
      a.add('bass', b, tail, a.low(a.c.key, 31), 0.75, true);
      a.add('impact', b, tail, 0, 0.95, true);
      a.add('taiko', b, tail, 0, 1, true);
      a.add('timpani', b, tail, a.low(a.c.key, 38), 0.8, true);
      a.add('crash', b, tail, 0, 0.7, true);
    },
  },

  electronic: {
    bar(a, bar) {
      const lv = bar.lv;
      const brk = bar.sec.kind === 'break' || bar.sec.kind === 'intro';
      a.chordHold(bar, 'pad', 55, 72, 4, 0.45 + 0.2 * lv);
      if (lv >= 0.28) a.arp(bar, 'arp', 0.25, bar.k % 2 ? 'updown' : 'up', 57, 84, 0.42 + 0.25 * lv, 0.2);
      if (lv >= 0.45 && !brk) a.pat(bar, 'kick', 'X...X...X...X...', 1);
      if (lv >= 0.55 && !brk) a.pat(bar, 'clap', '....X.......X...', 0.8);
      if (lv >= 0.5 && !brk) a.pat(bar, 'openhat', '..x...x...x...x.', 0.6);
      if (lv >= 0.75 && !brk) a.pat(bar, 'hat', 'x.o.x.o.x.o.x.o.', 0.5);
      if (lv >= 0.45 && !brk) bassLine(a, bar, lv >= 0.85 ? 'rolling' : 'offbeat', 0.85);
      else if (lv >= 0.3) bassLine(a, bar, 'whole', 0.55);
      if (bar.sec.kind === 'build' && bar.k >= bar.of - 2) {
        const dense = bar.k === bar.of - 1;
        snareRoll(a, 'snare', bar.start, bar.start + bar.len, dense ? 0.125 : 0.25, dense ? 0.5 : 0.3, dense ? 0.95 : 0.5);
      }
    },
    accent(a, b, lv) {
      a.add('crash', b, 2.5, 0, 0.55 + 0.35 * Math.min(1, lv), true);
      a.add('kick', b, 0.5, 0, 1, true);
      if (lv >= 0.7) a.add('impact', b, 2.5, 0, 0.55, true);
    },
    fill(a, b, len, lv) {
      if (lv >= 0.45) snareRoll(a, 'snare', b - 1, b, 0.25, 0.35, 0.85);
      a.add('revcrash', b - Math.min(2, len), Math.min(2, len), 0, 0.5);
    },
    clears: ['clap', 'hat', 'openhat', 'snare'],
    enter(a, sec) {
      if (sec.kind === 'main' || sec.kind === 'drop') {
        a.add('riser', Math.max(0, sec.start - 8), Math.min(8, sec.start), 0, 0.55);
        if (sec.kind === 'drop') a.add('impact', sec.start, 3, 0, 0.7, true);
      }
    },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 55, 72, 4)) a.add('pad', b, tail, p, 0.65, true);
      a.add('lead', b, Math.min(tail, 2), a.c.tonic + 12, 0.45, true);
      a.add('bass', b, tail, a.low(a.c.key, 33), 0.8, true);
      a.add('kick', b, 0.5, 0, 1, true);
      a.add('impact', b, tail, 0, 0.8, true);
      a.add('crash', b, tail, 0, 0.7, true);
    },
    pump: { main: 0.4, drop: 0.45, build: 0.2 },
  },

  lofi: {
    bar(a, bar) {
      const lv = bar.lv;
      if (lv < 0.4) a.comp(bar, 'epiano', [[0, bar.len]], 55, 72, 0.44);
      else a.comp(bar, 'epiano', [[0, 1.4], [1.5, 0.9], [2.75, 1.2]], 55, 72, 0.46);
      if (lv >= 0.55) a.chordHold(bar, 'pad', 52, 67, 3, 0.3);
      if (lv >= 0.35) a.pat(bar, 'kick', bar.k % 2 ? 'X.........X..x..' : 'X......x..X.....', 0.85);
      if (lv >= 0.4) a.pat(bar, 'snare', '....X.......X..o', 0.72);
      if (lv >= 0.3) a.pat(bar, 'hat', lv >= 0.75 ? 'xoxoxoxoxoxoxoxo' : 'x.o.x.o.x.o.x.o.', 0.5);
      if (lv >= 0.4) bassLine(a, bar, 'lofi', 0.8, 36);
      else if (lv >= 0.2) bassLine(a, bar, 'whole', 0.6, 36);
    },
    accent(a, b, lv) {
      a.add('crash', b, 2, 0, 0.28 + 0.2 * Math.min(1, lv), true);
      if (lv >= 0.35) a.add('kick', b, 0.5, 0, 0.85, true);
    },
    fill(a, b, _len, lv) {
      if (lv >= 0.4) { a.add('snare', b - 0.5, 0.25, 0, 0.35); a.add('snare', b - 0.25, 0.25, 0, 0.5); }
    },
    clears: ['snare', 'hat'],
    enter() { /* a lo-fi loop only changes layers */ },
    finale(a, b, tail) {
      const f = a.c.final;
      for (const p of voicing(a.c.key, f, 55, 74, 5)) a.add('epiano', b, tail, p, 0.46, true);
      a.add('bass', b, tail, a.low(a.c.key, 36), 0.7, true);
      a.add('kick', b, 0.5, 0, 0.7, true);
    },
  },

  oriental: {
    bar(a, bar) {
      const lv = bar.lv;
      const iq = IQAT[a.c.iqa ?? 'maqsum'];
      const dumP = [a.low(a.c.key, 40), a.low(a.c.key + 7, 40)].find((p) => p <= 47) ?? a.low(a.c.key, 40);
      if (lv >= 0.6) a.chordHold(bar, 'pad', 50, 69, 3, 0.42);
      else for (const p of [a.low(a.c.key, 50), a.low(a.c.key, 50) + 7]) a.hold('pad', bar.start, bar.len, p, 0.4 + 0.15 * lv);
      if (lv >= 0.6) a.chordHold(bar, 'strings', 45, 64, 3, 0.3);
      if (lv >= 0.25 && lv < 0.45) { a.pat(bar, 'dum', 'X.......X.......', 0.8, dumP); a.pat(bar, 'tek', '............x...', 0.55); }
      if (lv >= 0.45) {
        const turn = lv >= 0.6 && bar.k % 4 === 3 && bar.k < bar.of - 1;
        a.pat(bar, 'dum', iq.dum, 0.92, dumP);
        a.pat(bar, 'tek', turn ? `${iq.tek.slice(0, 12)}x.x.` : iq.tek, 0.8);
        if (turn) a.pat(bar, 'ka', '.............o.o', 0.7);
      }
      if (lv >= 0.7) a.pat(bar, 'ka', iq.ka, 0.62);
      if (lv >= 0.9) a.pat(bar, 'ka', '...o.o.......o..', 0.45);
      if (lv >= 0.55) a.pat(bar, 'riq', lv >= 0.85 ? 'XoxoxoXoxoxoXoxo' : 'x.X.o.X.x.o.X.o.', 0.6);
      if (lv >= 0.7) a.pat(bar, 'daf', lv >= 0.9 ? 'X.....x.X...x...' : 'X.......X.......', 0.72);
      if (lv >= 0.95) a.pat(bar, 'clap', '....x.......x...', 0.55);
      if (lv >= 0.4) {
        const root = a.low(a.root(bar), 36);
        for (let s = 0; s < 16 && s < bar.len * 4; s++) {
          if (iq.dum[s] === '.') continue;
          let next = 16;
          for (let q = s + 1; q < 16; q++) if (iq.dum[q] !== '.') { next = q; break; }
          a.add('bass', bar.start + s / 4, Math.min((next - s) / 4, 1.5, bar.len - s / 4), s === 8 && bar.k % 2 ? root + 7 : root, s === 0 ? 0.85 : 0.72);
        }
      }
    },
    accent(a, b, lv) {
      const dumP = [a.low(a.c.key, 40), a.low(a.c.key + 7, 40)].find((p) => p <= 47) ?? a.low(a.c.key, 40);
      a.add('dum', b, 0.5, dumP, 1, true);
      a.add('crash', b, 2.5, 0, 0.35 + 0.25 * Math.min(1, lv), true);
      a.add('daf', b, 0.5, 0, 0.8, true);
      a.add('riq', b, 0.5, 0, 0.9, true);
      if (lv >= 0.7) a.add('impact', b, 2, 0, 0.4, true);
    },
    fill(a, b, len, lv) {
      const roll = Math.min(1, len);
      const rate = lv >= 0.8 ? 0.125 : 0.25;
      const n = Math.round(roll / rate);
      for (let k = 0; k < n; k++) a.add(k % 2 ? 'ka' : 'tek', b - roll + k * rate, rate, 0, 0.45 + (0.5 * k) / n);
      a.add('riq', b - 0.5, 0.25, 0, 0.6);
      a.add('riq', b - 0.25, 0.25, 0, 0.75);
      if (lv >= 0.5) scaleRun(a, 'qanun', b - roll, b, a.c.tonic, 8, 0.42);
    },
    clears: ['tek', 'ka', 'riq', 'clap'],
    enter(a, sec) {
      if (sec.kind === 'drop' || sec.kind === 'main') a.add('revcrash', Math.max(0, sec.start - 2), Math.min(2, sec.start), 0, 0.4);
    },
    finale(a, b, tail) {
      const f = a.c.final;
      const dumP = [a.low(a.c.key, 40), a.low(a.c.key + 7, 40)].find((p) => p <= 47) ?? a.low(a.c.key, 40);
      for (const p of voicing(a.c.key, f, 50, 69, 3)) a.add('pad', b, tail, p, 0.55, true);
      for (const p of voicing(a.c.key, f, 45, 64, 3)) a.add('strings', b, tail, p, 0.45, true);
      a.add('strings', b, tail, a.c.tonic + 12, 0.5, true);
      const trem = Math.min(tail, 2);
      for (let x = 0, k = 0; x < trem - 0.01; x += 0.25, k++) a.add('oud', b + x, x + 0.25 >= trem ? tail - x : 0.25, a.c.tonic, (k % 2 ? 0.5 : 0.66) * (1 - x / (trem * 1.6)), k === 0);
      a.add('qanun', b, tail, a.c.tonic + 12, 0.45, true);
      a.add('ney', b, tail, a.c.tonic + 12, 0.4, true);
      a.add('bass', b, tail, a.low(a.c.key, 36), 0.8, true);
      a.add('dum', b, 0.6, dumP, 1, true);
      a.add('daf', b, 0.6, 0, 0.85, true);
      a.add('riq', b, 0.5, 0, 0.9, true);
      a.add('crash', b, tail, 0, 0.55, true);
    },
  },
};

// ── arrange ───────────────────────────────────────────────────────────────

/** Keeps, in place, the events that pass. */
function keep(ev: Ev[], ok: (e: Ev) => boolean) {
  let w = 0;
  for (const e of ev) if (ok(e)) ev[w++] = e;
  ev.length = w;
}

/** The spec with every field in range, or its default left out. */
export function normalSpec(spec: MusicSpec): MusicSpec {
  const mood: Mood = MOODS[spec?.mood as Mood] ? spec.mood : 'uplifting';
  const seed = Number.isFinite(Number(spec?.seed)) ? Math.abs(Math.trunc(Number(spec.seed))) % 2147483647 : 0;
  const out: MusicSpec = { mood, seed };
  if (Number.isFinite(Number(spec?.tempo)) && spec.tempo !== undefined) out.tempo = clamp(Math.round(Number(spec.tempo)), 60, 170);
  if (Number.isFinite(Number(spec?.energy)) && spec.energy !== undefined) out.energy = clamp(Number(spec.energy), 0, 1);
  if (Number.isFinite(Number(spec?.key)) && spec.key !== undefined) out.key = pcOf(Math.round(Number(spec.key)));
  return out;
}

/**
 * The score of a piece for a video `seconds` long, marking each cut in
 * `cues` (seconds). Pure: the same arguments always give the same score.
 */
export function arrange(spec: MusicSpec, seconds: number, cues: readonly number[] = []): Score {
  const s = normalSpec(spec);
  const def = MOODS[s.mood];
  const len = clamp(Number.isFinite(seconds) ? seconds : 30, 1, 600);
  const energy = s.energy ?? ENERGY;
  const pick = new Rand(s.seed, `${s.mood}:choices`);

  // Scale, key, tempo.
  const scales = Object.keys(def.harmony) as ScaleName[];
  const scale = pick.pick(scales);
  const h = def.harmony[scale] as Harmony;
  const key = s.key ?? pick.pick(h.keys);
  const steps = SCALES[scale];
  const [tLo, tHi, tUsual] = def.tempo;
  const own = s.tempo === undefined;
  const want = own ? clamp(tUsual + Math.round((pick.next() - 0.5) * (tHi - tLo) * 0.4), tLo, tHi) : s.tempo!;
  const inCues = cues.filter((c) => Number.isFinite(c) && c > 0 && c < len).map(Number);
  const { bpm, nb } = fitTime(len, want, own ? tLo : 56, own ? tHi : 176, inCues);
  const spb = 60 / bpm;
  const iqa: Iqa | undefined = s.mood === 'oriental' ? pick.pick(['maqsum', 'maqsum', 'baladi', 'saidi'] as const) : undefined;

  const cueBeats = [...new Set(inCues.map((c) => Math.round(c / spb)))].filter((b) => b >= 1 && b <= nb).sort((x, y) => x - y);
  const sections = planForm(nb, cueBeats);

  const tonic = 60 + key;
  const ctx: Ctx = {
    mood: s.mood, key, steps, scale, energy, tonic, rest: h.rest, final: chordOf(h.final, steps), iqa, r: new Rand(s.seed, `${s.mood}:play`),
  };
  const a = new Arr(ctx);
  const style = STYLES[s.mood];
  const theme = makeTheme(new Rand(s.seed, `${s.mood}:theme`), def, s.mood === 'oriental', h.rest);
  const scaleE = 0.55 + 0.6 * energy;

  // Progressions: one for the main parts, another for the quiet ones.
  const mainSym = pick.pick(h.progressions);
  const others = h.progressions.filter((p) => p !== mainSym);
  const mainProg = mainSym.split(/\s+/).map((x) => chordOf(x, steps));
  const quietProg = pick.pick(others.length ? others : h.progressions).split(/\s+/).map((x) => chordOf(x, steps));
  const cadence = h.cadence.split(/\s+/).map((x) => chordOf(x, steps));

  const allBars: Bar[] = [];
  sections.forEach((sec, si) => {
    const n = Math.ceil((sec.end - sec.start) / 4 - 1e-9);
    const prog = sec.kind === 'main' || sec.kind === 'drop' ? mainProg : quietProg;
    const bars: Bar[] = [];
    for (let k = 0; k < n; k++) {
      const start = sec.start + 4 * k;
      const blen = Math.min(4, sec.end - start);
      let lvBase = LEVEL[sec.kind];
      if (sec.kind === 'build') lvBase += 0.22 * (n > 1 ? k / (n - 1) : 1);
      if (sec.kind === 'outro') lvBase -= 0.12 * (n > 1 ? k / (n - 1) : 1);
      let chord = prog[k % prog.length];
      if (sec.kind === 'outro') chord = cadence[Math.max(0, cadence.length - (n - k))] ?? chord;
      bars.push({ start, len: blen, sec, k, of: n, chord, lv: lvBase * scaleE });
    }
    for (const bar of bars) style.bar(a, bar);
    const lines = MELODY[s.mood][sec.kind];
    if (lines) melodySection(a, sec, bars, theme, lines, si);
    if (si > 0) style.enter(a, sec, bars[0]?.lv ?? 0.5);
    allBars.push(...bars);
  });

  // Cuts: a fill before, an accent on the beat.
  const lvAt = (b: number) => (allBars.find((x) => b >= x.start && b < x.start + x.len) ?? allBars[allBars.length - 1])?.lv ?? 0.5;
  const fills: [number, number][] = [];
  cueBeats.forEach((cb, k) => {
    const gap = k ? cb - cueBeats[k - 1] : cb;
    const lv = lvAt(Math.max(0, cb - 1));
    const flen = Math.min(lv >= 0.6 ? 2 : 1, gap - 1, cb);
    if (flen >= 1 && cb < nb) fills.push([cb - flen, cb]);
  });
  // The last beat before the final chord is a fill too.
  if (nb >= 4) fills.push([nb - 1, nb]);
  const cleared = new Set(style.clears);
  const inFill = (e: Ev) => cleared.has(e.i) && fills.some(([f, t]) => e.b >= f - 1e-9 && e.b < t - 1e-9);
  keep(a.ev, (e) => !inFill(e));
  for (const [f, t] of fills) style.fill(a, t, t - f, lvAt(f));
  for (const cb of cueBeats) if (cb < nb) style.accent(a, cb, lvAt(cb));

  // Electronic's drop: a breath before it.
  if (s.mood === 'electronic') {
    for (const sec of sections) {
      if (sec.kind !== 'drop' || sec.start < 1) continue;
      keep(a.ev, (e) => !(e.b >= sec.start - 0.5 && e.b < sec.start && !e.x && (e.i === 'kick' || e.i === 'bass' || e.i === 'openhat' || e.i === 'hat' || e.i === 'clap')));
    }
  }

  // The end: everything stops at the final beat, and the last chord rings to the end.
  const end = nb * spb;
  const tailBeats = (len - end) / spb;
  style.finale(a, nb, tailBeats);
  if (s.mood === 'lofi') a.add('vinyl', 0, len / spb, 0, 0.8, true);

  // Beats to seconds: swing on the off sixteenths, a little looseness, nothing past the end.
  const loose = new Rand(s.seed, `${s.mood}:loose`);
  const notes: Note[] = [];
  for (const e of a.ev) {
    const final = e.b >= nb - 1e-9;
    if (!final && e.b + e.d > nb + 1e-9 && e.i !== 'vinyl' && e.i !== 'crash' && e.i !== 'impact' && e.i !== 'revcrash') e.d = nb - e.b;
    let t = e.b * spb;
    if (!e.x) {
      const s16 = e.b * 4;
      if (def.swing && Math.abs(s16 - Math.round(s16)) < 1e-6 && Math.round(s16) % 2 === 1) t += def.swing * (spb / 4);
      if (def.loose) t += (loose.next() * 2 - 1) * def.loose;
    }
    t = Math.max(0, t);
    if (t >= len - 0.02) continue;
    const d = Math.min(e.d * spb, len - t);
    if (d <= 0.001) continue;
    notes.push({ i: e.i, t: Math.round(t * 1e6) / 1e6, d: Math.round(d * 1e6) / 1e6, p: e.p, v: Math.round(e.v * 1000) / 1000 });
  }
  for (const n of notes) if (n.t + n.d > len) n.d = Math.max(0.001, len - n.t);
  notes.sort((x, y) => x.t - y.t || (x.i < y.i ? -1 : x.i > y.i ? 1 : x.p - y.p));

  const pump: Score['pump'] = [];
  for (const sec of sections) {
    const depth = style.pump?.[sec.kind];
    if (depth) pump.push({ from: sec.start * spb, to: sec.end * spb, depth: depth * clamp(0.6 + 0.5 * energy, 0, 1) });
  }

  return {
    mood: s.mood,
    seed: s.seed,
    energy,
    seconds: len,
    bpm,
    beat: spb,
    key,
    scale,
    steps,
    ...(iqa ? { iqa } : {}),
    sections: sections.map((x) => ({ kind: x.kind, start: x.start * spb, end: x.end * spb })),
    cues: cueBeats.map((b) => b * spb),
    end,
    notes,
    pump,
    reverb: { seconds: def.reverb, wet: def.wet },
  };
}

// ── sounds, computed ──────────────────────────────────────────────────────

/** An RBJ biquad, run over a buffer in place. */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  constructor(type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q: number, sr: number, gainDb = 0) {
    const w = (TAU * Math.min(f, sr * 0.45)) / sr;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    const A = Math.pow(10, gainDb / 40);
    let b0: number; let b1: number; let b2: number; let a0: number;
    const a1 = -2 * cs;
    let a2: number;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x: Float32Array): Float32Array {
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    const { b0, b1, b2, a1, a2 } = this;
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      const y = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      x[i] = y;
    }
    return x;
  }
}

function noise(n: number, r: Rand): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r.next() * 2 - 1;
  return out;
}

function normalize(x: Float32Array, peak = 1): Float32Array {
  let m = 0;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  if (m > 0) { const g = peak / m; for (let i = 0; i < x.length; i++) x[i] *= g; }
  return x;
}

function drive(x: Float32Array, k: number): Float32Array {
  const n = Math.tanh(k);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * k) / n;
  return x;
}

/** A short fade at the end, so a sound never stops with a click. */
function tailFade(x: Float32Array, sr: number, secs = 0.01): Float32Array {
  const n = Math.min(x.length, Math.round(secs * sr));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
  return x;
}

/** A membrane: partials at `ratios` with their own amplitudes and decays, the pitch falling from `bend` times to itself. */
function membrane(sr: number, secs: number, f0: number, ratios: readonly number[], amps: readonly number[], decays: readonly number[], bend: number, bendTime: number): Float32Array {
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  for (let k = 0; k < ratios.length; k++) {
    let ph = 0;
    const dec = Math.exp(-1 / (decays[k] * sr));
    let env = amps[k];
    for (let i = 0; i < n && env > 1e-5; i++) {
      const t = i / sr;
      const f = f0 * ratios[k] * (1 + (bend - 1) * Math.exp(-t / bendTime));
      ph += (TAU * f) / sr;
      out[i] += Math.sin(ph) * env * Math.min(1, i / (0.0008 * sr));
      env *= dec;
    }
  }
  return out;
}

/** Noise, filtered, under an exponential decay from `from` seconds. */
function burst(sr: number, secs: number, r: Rand, filters: readonly Biquad[], decay: number, from = 0, attack = 0.0005): Float32Array {
  const n = Math.round(secs * sr);
  const x = noise(n, r);
  for (const f of filters) f.run(x);
  const s0 = Math.round(from * sr);
  for (let i = 0; i < n; i++) {
    const t = (i - s0) / sr;
    x[i] *= i < s0 ? 0 : Math.min(1, t / attack) * Math.exp(-t / decay);
  }
  return x;
}

function mix(into: Float32Array, add: Float32Array, g: number): Float32Array {
  for (let i = 0; i < Math.min(into.length, add.length); i++) into[i] += add[i] * g;
  return into;
}

type Flavour = 'pop' | 'club' | 'soft' | 'big';

function kick(sr: number, r: Rand, fl: Flavour): Float32Array {
  const secs = fl === 'club' ? 0.8 : fl === 'soft' ? 0.45 : 0.55;
  const f0 = fl === 'club' ? 140 : fl === 'soft' ? 115 : 165;
  const f1 = fl === 'club' ? 46 : fl === 'soft' ? 52 : 50;
  const tp = fl === 'club' ? 0.045 : 0.032;
  const ta = fl === 'club' ? 0.32 : fl === 'soft' ? 0.17 : 0.21;
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * (f1 + (f0 - f1) * Math.exp(-t / tp))) / sr;
    out[i] = Math.sin(ph) * Math.min(1, t / 0.0015) * Math.exp(-t / ta);
  }
  if (fl !== 'soft') mix(out, burst(sr, 0.02, r, [new Biquad('hp', 1500, 0.7, sr)], 0.0025), fl === 'club' ? 0.35 : 0.3);
  drive(out, fl === 'club' ? 1.9 : 1.4);
  if (fl === 'soft') new Biquad('lp', 1600, 0.7, sr).run(out);
  return tailFade(normalize(out), sr);
}

function snare(sr: number, r: Rand, fl: Flavour): Float32Array {
  const secs = fl === 'big' ? 0.8 : 0.4;
  const tone = membrane(sr, secs, fl === 'big' ? 165 : 190, [1, 1.78], [0.9, 0.5], [fl === 'big' ? 0.1 : 0.065, 0.045], 1.35, 0.012);
  const nz = burst(sr, secs, r, [new Biquad('hp', 1100, 0.7, sr), new Biquad('lp', fl === 'soft' ? 5200 : 9500, 0.7, sr)], fl === 'big' ? 0.24 : fl === 'soft' ? 0.13 : 0.12);
  const out = mix(tone, nz, fl === 'soft' ? 0.8 : 1.1);
  return tailFade(normalize(drive(out, 1.3)), sr);
}

function clap(sr: number, r: Rand): Float32Array {
  const n = Math.round(0.4 * sr);
  const x = noise(n, r);
  new Biquad('hp', 750, 0.8, sr).run(x);
  new Biquad('lp', 4200, 0.8, sr).run(x);
  const hits = [0, 0.011, 0.023];
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let env = 0;
    for (const h of hits) if (t >= h) env = Math.max(env, Math.exp(-(t - h) / 0.0045));
    if (t >= 0.033) env = Math.max(env, 0.7 * Math.exp(-(t - 0.033) / 0.14));
    x[i] *= env;
  }
  mix(x, membrane(sr, 0.1, 880, [1], [0.25], [0.012], 1, 1), 1);
  return tailFade(normalize(x), sr);
}

function snap(sr: number, r: Rand): Float32Array {
  const x = burst(sr, 0.15, r, [new Biquad('hp', 2200, 0.7, sr)], 0.018);
  mix(x, membrane(sr, 0.15, 1750, [1], [0.6], [0.007], 1, 1), 1);
  return tailFade(normalize(x), sr);
}

function rim(sr: number, r: Rand): Float32Array {
  const x = membrane(sr, 0.12, 830, [1, 1.62], [1, 0.4], [0.014, 0.008], 1, 1);
  mix(x, burst(sr, 0.12, r, [new Biquad('hp', 3000, 0.7, sr)], 0.004), 0.5);
  return tailFade(normalize(x), sr);
}

function hat(sr: number, r: Rand, open: boolean): Float32Array {
  const secs = open ? 0.6 : 0.13;
  const x = burst(sr, secs, r, [new Biquad('hp', 7200, 0.7, sr), new Biquad('hp', 7200, 0.7, sr)], open ? 0.2 : 0.028);
  const metal = membrane(sr, secs, 1, [5170, 6390, 7310, 8200, 9540, 10870], [0.1, 0.08, 0.1, 0.07, 0.06, 0.05], [open ? 0.18 : 0.03, 0.03, open ? 0.15 : 0.025, 0.03, 0.02, 0.02], 1, 1);
  return tailFade(normalize(mix(x, metal, 0.6)), sr);
}

function shaker(sr: number, r: Rand): Float32Array {
  const x = burst(sr, 0.14, r, [new Biquad('hp', 4200, 0.7, sr), new Biquad('lp', 10000, 0.7, sr)], 0.045, 0, 0.009);
  return tailFade(normalize(x), sr);
}

/** A cymbal, one channel of it: noise and a cluster of inharmonic partials, long. */
function cymbal(sr: number, r: Rand, secs: number, soft: boolean): Float32Array {
  const x = burst(sr, secs, r, [new Biquad('hp', soft ? 2000 : 2600, 0.7, sr), new Biquad('lp', soft ? 7000 : 13000, 0.7, sr)], soft ? 0.7 : 0.9, 0, 0.002);
  const ratios: number[] = [];
  const amps: number[] = [];
  const decs: number[] = [];
  for (let k = 0; k < 14; k++) { ratios.push(r.range(2400, 9000)); amps.push(r.range(0.02, 0.06)); decs.push(r.range(0.4, 1.2)); }
  mix(x, membrane(sr, secs, 1, ratios, amps, decs, 1, 1), 1);
  return tailFade(normalize(x), sr, 0.05);
}

function tom(sr: number, r: Rand, p: number): Float32Array {
  const x = membrane(sr, 0.8, mtof(p), [1, 1.5], [1, 0.25], [0.26, 0.1], 1.5, 0.02);
  mix(x, burst(sr, 0.05, r, [new Biquad('hp', 800, 0.7, sr)], 0.008), 0.3);
  return tailFade(normalize(drive(x, 1.3)), sr);
}

function taiko(sr: number, r: Rand): Float32Array {
  const x = membrane(sr, 1.8, 62, [1, 2.3, 3.1], [1, 0.35, 0.12], [0.55, 0.12, 0.06], 1.6, 0.03);
  mix(x, burst(sr, 0.1, r, [new Biquad('hp', 400, 0.7, sr), new Biquad('lp', 2500, 0.7, sr)], 0.015), 0.5);
  return tailFade(normalize(drive(x, 1.6)), sr);
}

function timpani(sr: number, r: Rand, p: number): Float32Array {
  const x = membrane(sr, 2.6, mtof(p), [1, 1.504, 1.742, 2.0, 2.245, 2.494], [1, 0.6, 0.3, 0.35, 0.2, 0.12], [1.6, 1.0, 0.7, 0.8, 0.5, 0.4], 1.02, 0.06);
  mix(x, burst(sr, 0.1, r, [new Biquad('lp', 600, 0.7, sr)], 0.02), 0.4);
  return tailFade(normalize(x), sr, 0.05);
}

function impact(sr: number, r: Rand): Float32Array {
  const secs = 3.2;
  const n = Math.round(secs * sr);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * (28 + 70 * Math.exp(-t / 0.35))) / sr;
    x[i] = Math.sin(ph) * Math.exp(-t / 1.1) * Math.min(1, t / 0.002);
  }
  mix(x, burst(sr, 1.2, r, [new Biquad('lp', 320, 0.7, sr)], 0.25), 0.7);
  mix(x, burst(sr, 0.3, r, [new Biquad('hp', 1500, 0.7, sr)], 0.025), 0.35);
  mix(x, membrane(sr, 0.5, 110, [1], [0.5], [0.08], 1.4, 0.02), 1);
  return tailFade(normalize(drive(x, 1.5)), sr, 0.05);
}

/** The darbuka's dum: the goblet's low resonance, the pitch settling as the skin relaxes. */
function dum(sr: number, r: Rand, p: number): Float32Array {
  const x = membrane(sr, 0.9, mtof(p) * r.range(0.985, 1.015), [1, 1.52, 2.0], [1, 0.28, 0.12], [0.3, 0.12, 0.08], 1.25, 0.02);
  mix(x, burst(sr, 0.08, r, [new Biquad('lp', 700, 0.7, sr)], 0.012), 0.35);
  return tailFade(normalize(drive(x, 1.3)), sr);
}

/** The tek (strong hand on the rim) and the ka (the other hand, softer). */
function tek(sr: number, r: Rand, soft: boolean): Float32Array {
  const f = (soft ? 380 : 440) * r.range(0.97, 1.03);
  const x = membrane(sr, 0.3, f, [1, 1.593, 2.135, 2.653, 3.155], [0.55, 0.45, 0.38, 0.28, 0.2].map((a) => a * (soft ? 0.8 : 1)), [0.06, 0.045, 0.035, 0.03, 0.025].map((d) => d * (soft ? 0.8 : 1)), 1.08, 0.004);
  mix(x, burst(sr, 0.1, r, [new Biquad('hp', soft ? 1500 : 1800, 0.7, sr), new Biquad('lp', soft ? 5000 : 7500, 0.7, sr)], soft ? 0.009 : 0.012), soft ? 0.5 : 0.65);
  return tailFade(normalize(x), sr);
}

/** The riq's zills: pairs of small cymbals clashing, a few milliseconds apart. */
function riq(sr: number, r: Rand): Float32Array {
  const secs = 0.35;
  const ratios: number[] = [];
  const amps: number[] = [];
  const decs: number[] = [];
  for (let k = 0; k < 8; k++) { ratios.push(r.range(3800, 9800)); amps.push(r.range(0.3, 1)); decs.push(r.range(0.06, 0.16)); }
  const one = membrane(sr, secs, 1, ratios, amps, decs, 1, 1);
  const x = new Float32Array(one.length);
  for (const [at, g] of [[0, 1], [0.006, 0.6], [0.013, 0.35]] as const) {
    const s = Math.round(at * sr);
    for (let i = s; i < x.length; i++) x[i] += one[i - s] * g;
  }
  mix(x, burst(sr, secs, r, [new Biquad('hp', 6000, 0.7, sr)], 0.03), 0.4);
  return tailFade(normalize(x), sr);
}

/** The daf: a large frame drum's boom, and the rings inside it rattling after. */
function daf(sr: number, r: Rand): Float32Array {
  const secs = 0.9;
  const x = membrane(sr, secs, 68, [1, 1.6], [1, 0.3], [0.35, 0.12], 1.3, 0.02);
  mix(x, burst(sr, 0.1, r, [new Biquad('lp', 900, 0.7, sr)], 0.01), 0.4);
  const rings = burst(sr, secs, r, [new Biquad('hp', 5000, 0.7, sr), new Biquad('lp', 11000, 0.7, sr)], 0.16, 0.004, 0.01);
  for (let i = 0; i < rings.length; i++) rings[i] *= 0.65 + 0.35 * Math.sin((TAU * 38 * i) / sr);
  mix(x, rings, 0.35);
  return tailFade(normalize(x), sr);
}

/** How each plucked string is made: decay (T60 at `ref` Hz), brightness of the pluck, where it is plucked, courses. */
const PLUCKED = {
  oud: { t60: 2.2, ref: 220, min: 0.6, max: 3, bright: 0.7, pick: 0.13, courses: 2, detune: 3.5 },
  qanun: { t60: 2.4, ref: 330, min: 0.5, max: 3, bright: 0.9, pick: 0.08, courses: 3, detune: 2.5 },
  harp: { t60: 3.5, ref: 262, min: 1, max: 5, bright: 0.35, pick: 0.5, courses: 1, detune: 0 },
  pluck: { t60: 0.9, ref: 262, min: 0.3, max: 1.2, bright: 0.8, pick: 0.12, courses: 2, detune: 5 },
} as const;
type Plucked = keyof typeof PLUCKED;

/**
 * One string by Karplus–Strong: a burst of noise, darker for a softer
 * pluck and combed for where it is plucked, circulating in a delay line one
 * period long through an averaging filter (the string's losses) and an
 * all-pass that tunes the fraction of a sample the line cannot.
 */
function ksString(sr: number, r: Rand, f: number, t60: number, bright: number, pick: number, out: Float32Array, gain: number) {
  const N = sr / f;
  const L = Math.max(2, Math.floor(N - 0.6));
  const frac = N - L - 0.5;
  const c = (1 - frac) / (1 + frac);
  const g = Math.pow(10, -3 / (t60 * f));
  const buf = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += bright * (r.next() * 2 - 1 - lp); buf[i] = lp; }
  const back = Math.max(1, Math.round(pick * L));
  for (let i = L - 1; i >= back; i--) buf[i] -= buf[i - back];
  let mean = 0;
  for (let i = 0; i < L; i++) mean += buf[i];
  mean /= L;
  let peak = 0;
  for (let i = 0; i < L; i++) { buf[i] -= mean; peak = Math.max(peak, Math.abs(buf[i])); }
  if (peak > 0) for (let i = 0; i < L; i++) buf[i] /= peak;
  let idx = 0;
  let prev = 0;
  let apx = 0;
  let apy = 0;
  for (let n = 0; n < out.length; n++) {
    const y = buf[idx];
    out[n] += y * gain;
    const avg = 0.5 * (y + prev);
    prev = y;
    const ap = c * avg + apx - c * apy;
    apx = avg;
    apy = ap;
    buf[idx] = ap * g;
    idx = idx + 1 === L ? 0 : idx + 1;
  }
}

function plucked(sr: number, r: Rand, kind: Plucked, p: number): Float32Array {
  const P = PLUCKED[kind];
  const f = mtof(p);
  const t60 = clamp(P.t60 * Math.sqrt(P.ref / f), P.min, P.max);
  const out = new Float32Array(Math.round(Math.min(t60 * 0.8, 4) * sr));
  for (let k = 0; k < P.courses; k++) {
    const cents = P.courses === 1 ? 0 : (k - (P.courses - 1) / 2) * P.detune;
    ksString(sr, r, f * Math.pow(2, cents / 1200), t60, P.bright, P.pick, out, 1 / P.courses);
  }
  if (kind === 'oud') {
    new Biquad('hp', 80, 0.7, sr).run(out);
    new Biquad('peak', 260, 1, sr, 5).run(out);
    new Biquad('peak', 1300, 1.2, sr, -2).run(out);
    new Biquad('lp', 5200, 0.7, sr).run(out);
  } else if (kind === 'qanun') {
    new Biquad('hp', 140, 0.7, sr).run(out);
    new Biquad('peak', 2600, 1, sr, 3).run(out);
  } else if (kind === 'harp') {
    new Biquad('lp', 6500, 0.7, sr).run(out);
  } else {
    new Biquad('hp', 90, 0.7, sr).run(out);
    new Biquad('peak', 200, 1, sr, 3).run(out);
    new Biquad('lp', 6000, 0.7, sr).run(out);
  }
  return tailFade(normalize(out), sr, 0.03);
}

/**
 * A piano note: partials a little sharper than harmonic (the string's
 * stiffness), weaker above where the hammer strikes, each dying away faster
 * the higher it is — quickly at first, then slowly — with the lower ones
 * beating against a second string tuned a hair apart.
 */
function piano(sr: number, r: Rand, p: number): Float32Array {
  const f0 = mtof(p);
  const T = clamp(7 * Math.pow(2, -(p - 40) / 18), 0.9, 8);
  const secs = clamp(T * 1.5, 1.2, 5);
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  const B = 0.00008 * Math.pow(2, Math.abs(p - 60) / 14);
  const top = Math.max(3, Math.min(14, Math.floor(8000 / f0)));
  for (let k = 1; k <= top; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.45) break;
    let amp = Math.pow(k, -1.15) * (0.25 + Math.abs(Math.sin(Math.PI * k * 0.13)));
    amp *= Math.exp(-(k - 1) * (0.12 + Math.max(0, p - 60) * 0.006));
    const tau = T / (1 + 0.45 * (k - 1));
    const d1 = Math.exp(-1 / (tau * 0.16 * sr));
    const d2 = Math.exp(-1 / (tau * sr));
    const strings = k <= 4 ? 2 : 1;
    for (let s = 0; s < strings; s++) {
      const f = fk * (s ? 1 + 0.0007 * (1 + r.next()) : 1);
      const w = (TAU * f) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      let x = 0;
      let y = 1;
      let e1 = 0.6 * amp / strings;
      let e2 = 0.4 * amp / strings;
      for (let i = 0; i < n; i++) {
        const nx = x * cw - y * sw;
        y = x * sw + y * cw;
        x = nx;
        out[i] += x * (e1 + e2);
        e1 *= d1;
        e2 *= d2;
        if (e1 + e2 < 1e-5) break;
      }
    }
  }
  const atk = Math.round(0.002 * sr);
  for (let i = 0; i < atk; i++) out[i] *= i / atk;
  mix(out, burst(sr, 0.05, r, [new Biquad('lp', clamp(f0 * 3, 800, 4000), 0.7, sr)], 0.006), 0.06);
  return tailFade(normalize(out), sr, 0.05);
}

/** An electric piano: a round fundamental, a little of the second and third, and the tine's bell at the start. */
function epiano(sr: number, _r: Rand, p: number): Float32Array {
  const f0 = mtof(p);
  const secs = 3.2;
  const out = membrane(sr, secs, f0, [1, 2, 3, 7.1], [1, 0.22, 0.06, 0.16], [1.4, 0.5, 0.3, 0.1], 1, 1);
  const slow = membrane(sr, secs, f0 * 1.0015, [1], [0.35], [2.6], 1, 1);
  mix(out, slow, 1);
  return tailFade(normalize(drive(out, 1.4)), sr, 0.05);
}

/** A glockenspiel-like bell: a few inharmonic partials, the high ones short. */
function bell(sr: number, _r: Rand, p: number): Float32Array {
  const out = membrane(sr, 2.2, mtof(p), [1, 2.76, 5.4, 8.93], [1, 0.45, 0.2, 0.08], [1.3, 0.5, 0.25, 0.12], 1, 1);
  return tailFade(normalize(out), sr, 0.05);
}

/** A band-limited sawtooth sample (PolyBLEP). */
function saw(ph: number, dt: number): number {
  let v = 2 * ph - 1;
  if (ph < dt) { const t = ph / dt; v -= t + t - t * t - 1; }
  else if (ph > 1 - dt) { const t = (ph - 1) / dt; v -= t * t + t + t + 1; }
  return v;
}

/**
 * Detuned saws through a low-pass whose cutoff falls from `open` to `rest`
 * Hz in `fall` seconds, with an amplitude that decays by `decay` (or holds,
 * for a bass). The arp's pluck, the orchestra's spiccato, the synth bass.
 */
function sawTone(sr: number, p: number, secs: number, o: { voices: number; cents: number; open: number; rest: number; fall: number; decay: number; sustain: number; sub?: number; q?: number }): Float32Array {
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  const f0 = mtof(p);
  for (let v = 0; v < o.voices; v++) {
    const f = f0 * Math.pow(2, ((v - (o.voices - 1) / 2) * o.cents) / 1200);
    const dt = f / sr;
    let ph = (v * 0.37) % 1;
    for (let i = 0; i < n; i++) {
      out[i] += saw(ph, dt) / o.voices;
      ph += dt;
      if (ph >= 1) ph -= 1;
    }
  }
  if (o.sub) {
    let ph = 0;
    for (let i = 0; i < n; i++) { ph += (TAU * f0) / sr; out[i] += Math.sin(ph) * o.sub; }
  }
  // A state-variable low-pass, its cutoff moved every 16 samples.
  const k = 1 / (o.q ?? 0.8);
  let ic1 = 0;
  let ic2 = 0;
  let a1 = 0; let a2 = 0; let a3 = 0;
  const dec = Math.exp(-1 / (Math.max(0.01, o.decay) * sr));
  let env = 1;
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0) {
      const t = i / sr;
      const fc = Math.min(sr * 0.45, o.rest + (o.open - o.rest) * Math.exp(-t / o.fall));
      const g = Math.tan((Math.PI * fc) / sr);
      a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    const v3 = out[i] - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    const amp = o.sustain + (1 - o.sustain) * env;
    env *= dec;
    out[i] = v2 * amp * Math.min(1, i / (0.003 * sr));
  }
  return tailFade(normalize(out), sr, 0.02);
}

/** A bass that holds: a sine with a touch of its octave, or saws with a sine under them. */
function bassTone(sr: number, mood: Mood, p: number, secs: number): Float32Array {
  if (mood === 'electronic' || mood === 'uplifting' || mood === 'corporate') {
    return sawTone(sr, p, secs, { voices: 2, cents: 6, open: mood === 'electronic' ? 1400 : 1000, rest: mood === 'electronic' ? 420 : 520, fall: 0.09, decay: 0.4, sustain: 0.75, sub: 0.9, q: mood === 'electronic' ? 1.3 : 0.8 });
  }
  const n = Math.round(secs * sr);
  const out = new Float32Array(n);
  const f = mtof(p);
  const pluck = mood === 'lofi' || mood === 'oriental';
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (TAU * f) / sr;
    const env = pluck ? 0.35 * Math.exp(-t / 0.09) + 0.65 * Math.exp(-t / 3) : 1;
    out[i] = (Math.sin(ph) + 0.22 * Math.sin(2 * ph) + (pluck ? 0.1 * Math.sin(3 * ph) : 0)) * env * Math.min(1, t / 0.004);
  }
  if (pluck) new Biquad('lp', 900, 0.7, sr).run(out);
  return tailFade(normalize(drive(out, 1.2)), sr, 0.02);
}

/** A record's surface: hiss, crackle, a little rumble — looped under a lo-fi piece. */
function vinyl(sr: number, r: Rand): Float32Array {
  const secs = 7;
  const n = Math.round(secs * sr);
  const hiss = noise(n, r);
  new Biquad('hp', 1200, 0.7, sr).run(hiss);
  new Biquad('lp', 6500, 0.7, sr).run(hiss);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = hiss[i] * 0.05;
  const rumble = noise(n, r);
  new Biquad('lp', 70, 0.7, sr).run(rumble);
  mix(out, rumble, 0.4);
  const pops = Math.round(secs * 14);
  for (let k = 0; k < pops; k++) {
    const at = r.int(n - 200);
    const g = r.range(0.1, r.chance(0.1) ? 0.9 : 0.35) * (r.chance(0.5) ? 1 : -1);
    const len = 20 + r.int(60);
    for (let i = 0; i < len; i++) out[at + i] += g * Math.exp(-i / (len / 5)) * (i % 2 ? -0.6 : 1);
  }
  // The loop's join, crossfaded.
  const x = Math.round(0.05 * sr);
  for (let i = 0; i < x; i++) { const w = i / x; out[i] = out[i] * w + out[n - x + i] * (1 - w); }
  return normalize(out.subarray(0, n - x).slice(), 0.5);
}

// ── rendering ─────────────────────────────────────────────────────────────

type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

function offlineCtor(): OfflineCtor | null {
  const g = globalThis as unknown as { OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor };
  return g.OfflineAudioContext ?? g.webkitOfflineAudioContext ?? null;
}

function abortError(): Error {
  const e = new Error('Stopped.');
  e.name = 'AbortError';
  return e;
}

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function renderOffline(ctx: OfflineAudioContext): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    ctx.oncomplete = (e) => resolve(e.renderedBuffer);
    try {
      const p = ctx.startRendering() as unknown as Promise<AudioBuffer> | undefined;
      if (p && typeof p.then === 'function') p.then(resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

/** How loud each part sits, where it sits, how much of it goes to the reverb and the echo, and which bus. */
interface Strip { gain: number; pan: number; rev: number; echo?: number; drums?: boolean }

const STRIPS: Readonly<Record<Instrument, Strip>> = {
  kick: { gain: 0.318, pan: 0, rev: 0.03, drums: true },
  snare: { gain: 0.358, pan: 0.04, rev: 0.16, drums: true },
  clap: { gain: 0.607, pan: -0.04, rev: 0.2, drums: true },
  snap: { gain: 1.04, pan: 0.18, rev: 0.2, drums: true },
  rim: { gain: 0.26, pan: -0.14, rev: 0.2, drums: true },
  hat: { gain: 0.604, pan: 0.28, rev: 0.05, drums: true },
  openhat: { gain: 0.295, pan: 0.28, rev: 0.08, drums: true },
  shaker: { gain: 0.231, pan: -0.32, rev: 0.12, drums: true },
  crash: { gain: 0.191, pan: 0, rev: 0.22, drums: true },
  revcrash: { gain: 0.224, pan: 0, rev: 0.3, drums: true },
  tom: { gain: 0.548, pan: -0.2, rev: 0.2, drums: true },
  taiko: { gain: 0.345, pan: 0, rev: 0.28, drums: true },
  timpani: { gain: 0.49, pan: -0.1, rev: 0.3, drums: true },
  impact: { gain: 0.363, pan: 0, rev: 0.3, drums: true },
  riser: { gain: 0.843, pan: 0, rev: 0.32 },
  dum: { gain: 0.206, pan: 0, rev: 0.12, drums: true },
  tek: { gain: 0.973, pan: 0.12, rev: 0.13, drums: true },
  ka: { gain: 0.855, pan: -0.12, rev: 0.13, drums: true },
  riq: { gain: 0.195, pan: 0.32, rev: 0.12, drums: true },
  daf: { gain: 0.29, pan: -0.24, rev: 0.2, drums: true },
  bass: { gain: 0.164, pan: 0, rev: 0 },
  pad: { gain: 0.033, pan: 0.6, rev: 0.35 },
  strings: { gain: 0.076, pan: 0.45, rev: 0.4 },
  choir: { gain: 0.195, pan: 0.4, rev: 0.45 },
  brass: { gain: 0.224, pan: 0.2, rev: 0.3 },
  lead: { gain: 0.127, pan: 0.3, rev: 0.25, echo: 0.25 },
  ney: { gain: 0.182, pan: 0.1, rev: 0.4, echo: 0.1 },
  piano: { gain: 0.259, pan: 0, rev: 0.28 },
  epiano: { gain: 0.14, pan: 0, rev: 0.16 },
  bell: { gain: 0.283, pan: 0.22, rev: 0.34, echo: 0.2 },
  pluck: { gain: 0.578, pan: -0.2, rev: 0.2, echo: 0.2 },
  harp: { gain: 0.498, pan: 0.26, rev: 0.4 },
  oud: { gain: 0.561, pan: -0.1, rev: 0.22, echo: 0.06 },
  qanun: { gain: 1.208, pan: 0.3, rev: 0.26, echo: 0.08 },
  arp: { gain: 0.243, pan: 0.16, rev: 0.22, echo: 0.22 },
  vinyl: { gain: 0.297, pan: 0, rev: 0 },
};

/**
 * Each mood's own balance, in dB against the strips above — measured, not
 * guessed: every part rendered alone and weighed K-weighted (as loudness is)
 * against the whole, then moved to where that kind of music puts it.
 */
const MIX: Readonly<Partial<Record<Mood, Partial<Record<Instrument, number>>>>> = {
  uplifting: { bass: 2, piano: -2.5, pad: -2.4, crash: -2.5, revcrash: -2, hat: -4 },
  corporate: { piano: -3, crash: -2.5, pluck: -5, shaker: -2.7, hat: -3.3 },
  calm: { bass: -3.7, piano: 3, strings: -2.6, crash: 3.6, shaker: 5 },
  cinematic: { taiko: 2.2, timpani: -2.2, piano: 7.7, crash: 3.3, arp: 3.5, tom: 2.3 },
  epic: { taiko: -2.2, snare: -3.9, tom: -2.4, pad: 2.9, timpani: 2.2 },
  electronic: { kick: -2.5, bass: 4.3, snare: -2.7, arp: -2.7, crash: -2.2, pluck: 4.9, riser: -4, hat: 3.2 },
  lofi: { pad: 5.5, hat: 8 },
  oriental: { impact: 4.1, revcrash: 2.3 },
};

/** The pitched sounds computed here that hold until their note ends. */
const TONES: ReadonlySet<Instrument> = new Set<Instrument>(['bass', 'piano', 'epiano', 'bell', 'pluck', 'harp', 'oud', 'qanun', 'arp']);

/** Attack and release of the held voices the context's oscillators play, in seconds. */
function adsrOf(i: Instrument, mood: Mood): [number, number] {
  switch (i) {
    case 'pad': return [mood === 'electronic' ? 0.4 : 1.1, 1.2];
    case 'strings': return [mood === 'oriental' ? 0.09 : 0.35, 0.5];
    case 'choir': return [0.7, 1];
    case 'brass': return [0.08, 0.35];
    case 'lead': return [0.01, 0.18];
    case 'ney': return [0.12, 0.25];
    default: return [0.01, 0.1];
  }
}

/** The sounds computed in JavaScript, each once per render, shared by every slice. */
class Bank {
  private buffers = new Map<string, AudioBuffer>();
  private longest = new Map<number, number>();
  private noiseBuf: AudioBuffer | null = null;
  private readonly kickFl: Flavour;
  private readonly snareFl: Flavour;
  private readonly soft: boolean;
  constructor(readonly sr: number, readonly score: Score, readonly make: (chans: readonly Float32Array[]) => AudioBuffer) {
    const m = score.mood;
    this.kickFl = m === 'electronic' ? 'club' : m === 'lofi' || m === 'calm' ? 'soft' : 'pop';
    this.snareFl = m === 'lofi' ? 'soft' : m === 'epic' || m === 'cinematic' ? 'big' : 'pop';
    this.soft = m === 'lofi' || m === 'calm';
    for (const n of score.notes) if (n.i === 'bass') this.longest.set(n.p, Math.max(this.longest.get(n.p) ?? 0, n.d));
  }

  noise(): AudioBuffer {
    if (!this.noiseBuf) this.noiseBuf = this.make([noise(this.sr * 2, new Rand(this.score.seed, 'noise'))]);
    return this.noiseBuf;
  }

  sound(n: Note, variant: number): AudioBuffer | null {
    const { sr } = this;
    const tuned = n.i === 'tom' || n.i === 'timpani' || n.i === 'dum' || TONES.has(n.i);
    const k = `${n.i}:${tuned ? n.p : 0}:${TONES.has(n.i) ? 0 : variant}${n.i === 'revcrash' ? `:${Math.round(n.d * 20)}` : ''}`;
    const hit = this.buffers.get(k);
    if (hit) return hit;
    const r = new Rand(this.score.seed, k);
    const mood = this.score.mood;
    let data: Float32Array | Float32Array[] | null = null;
    switch (n.i) {
      case 'kick': data = kick(sr, r, this.kickFl); break;
      case 'snare': data = snare(sr, r, this.snareFl); break;
      case 'clap': data = clap(sr, r); break;
      case 'snap': data = snap(sr, r); break;
      case 'rim': data = rim(sr, r); break;
      case 'hat': data = hat(sr, r, false); break;
      case 'openhat': data = hat(sr, r, true); break;
      case 'shaker': data = shaker(sr, r); break;
      case 'crash': data = [cymbal(sr, r, 2.8, this.soft), cymbal(sr, r, 2.8, this.soft)]; break;
      case 'revcrash': {
        const secs = Math.max(0.3, n.d);
        data = [cymbal(sr, r, secs + 0.2, true), cymbal(sr, r, secs + 0.2, true)].map((c) => {
          const out = c.slice(0, Math.round(secs * sr)).reverse();
          const f = Math.round(0.05 * sr);
          for (let i = 0; i < Math.min(f, out.length); i++) out[out.length - 1 - i] *= i / f;
          return out;
        });
        break;
      }
      case 'tom': data = tom(sr, r, n.p); break;
      case 'taiko': data = taiko(sr, r); break;
      case 'timpani': data = timpani(sr, r, n.p); break;
      case 'impact': data = impact(sr, r); break;
      case 'dum': data = dum(sr, r, n.p); break;
      case 'tek': data = tek(sr, r, false); break;
      case 'ka': data = tek(sr, r, true); break;
      case 'riq': data = riq(sr, r); break;
      case 'daf': data = daf(sr, r); break;
      case 'bass': data = bassTone(sr, mood, n.p, Math.min(12, (this.longest.get(n.p) ?? 1) + 0.2)); break;
      case 'piano': data = piano(sr, r, n.p); break;
      case 'epiano': data = epiano(sr, r, n.p); break;
      case 'bell': data = bell(sr, r, n.p); break;
      case 'pluck': case 'harp': case 'oud': case 'qanun': data = plucked(sr, r, n.i, n.p); break;
      case 'arp': data = mood === 'cinematic' || mood === 'epic'
        ? sawTone(sr, n.p, 1, { voices: 3, cents: 9, open: 3200, rest: 1100, fall: 0.07, decay: 0.12, sustain: 0.05 })
        : sawTone(sr, n.p, 1.2, { voices: 2, cents: 8, open: 4200, rest: 500, fall: 0.11, decay: 0.3, sustain: 0.08, q: 1.1 });
        break;
      case 'vinyl': data = vinyl(sr, r); break;
      default: data = null;
    }
    if (!data) return null;
    const b = this.make(Array.isArray(data) ? data : [data]);
    this.buffers.set(k, b);
    return b;
  }
}

/**
 * One slice of the piece in its own OfflineAudioContext: the notes that
 * start in it, through their strips, into four channels — the dry mix (two)
 * and what goes to the reverb and to the echo (one each). The effects are
 * added once, over the whole piece, afterwards.
 */
class Slice {
  private strips = new Map<string, AudioNode>();
  private readonly drums: GainNode;
  private readonly music: GainNode;
  private readonly rev: GainNode;
  private readonly echo: GainNode;
  private readonly vib: AudioNode;
  private readonly neyVib: AudioNode;

  constructor(readonly ctx: OfflineAudioContext, readonly score: Score, readonly bank: Bank, readonly from: number, readonly end: number) {
    const merger = ctx.createChannelMerger(4);
    try { ctx.destination.channelInterpretation = 'discrete'; } catch { /* fixed in this engine */ }
    const dry = ctx.createGain();
    const split = ctx.createChannelSplitter(2);
    dry.connect(split);
    split.connect(merger, 0, 0);
    split.connect(merger, 1, 1);
    const mono = () => {
      const g = ctx.createGain();
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
      g.channelInterpretation = 'speakers';
      return g;
    };
    this.rev = mono();
    this.rev.connect(merger, 0, 2);
    this.echo = mono();
    this.echo.connect(merger, 0, 3);
    merger.connect(ctx.destination);
    this.drums = ctx.createGain();
    this.drums.connect(dry);
    this.music = ctx.createGain();
    this.music.connect(dry);
    // The pump: a dip on every beat, as if the kick pushed the rest aside.
    for (const p of score.pump) {
      const curve = new Float32Array(32);
      for (let k = 0; k < 32; k++) {
        const x = k / 31;
        curve[k] = 1 - p.depth * (x < 0.04 ? x / 0.04 : Math.exp(-(x - 0.04) / 0.22));
      }
      for (let t = p.from; t < p.to - score.beat * 0.5; t += score.beat) {
        const at = t - from;
        if (at >= 0 && at < end - score.beat) this.music.gain.setValueCurveAtTime(curve, at, score.beat * 0.96);
      }
    }
    this.vib = this.lfo(5.2, 7);
    this.neyVib = this.lfo(5, 12);
  }

  private lfo(f: number, depth: number): AudioNode {
    const osc = this.ctx.createOscillator();
    osc.frequency.value = f;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    osc.connect(g);
    osc.start(0);
    osc.stop(this.end);
    return g;
  }

  private strip(i: Instrument, side = 0): AudioNode {
    const name = `${i}:${side}`;
    const hit = this.strips.get(name);
    if (hit) return hit;
    const { ctx } = this;
    const def = STRIPS[i];
    const warmth = MOODS[this.score.mood].warmth;
    const input = ctx.createGain();
    let last: AudioNode = input;
    const chain = (n: AudioNode) => { last.connect(n); last = n; };
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    if (i === 'pad') {
      const lp = filter('lowpass', warmth, 0.9);
      this.lfo(0.13 + 0.04 * side, warmth * 0.35).connect(lp.frequency);
      chain(lp);
    } else if (i === 'strings' || i === 'brass') {
      chain(filter('highpass', i === 'strings' ? 140 : 90));
      chain(filter('lowpass', i === 'strings' ? 4200 : 3600));
    } else if (i === 'choir') {
      const sum = ctx.createGain();
      for (const [f, q, g] of [[730, 6, 1], [1090, 7, 0.55], [2440, 8, 0.35]] as const) {
        const bp = filter('bandpass', f, q);
        const gg = ctx.createGain();
        gg.gain.value = g * 3;
        input.connect(bp);
        bp.connect(gg);
        gg.connect(sum);
      }
      last = sum;
    } else if (i === 'lead') {
      chain(filter('lowpass', 5200));
    } else if (i === 'epiano') {
      const trem = ctx.createGain();
      trem.gain.value = 0.85;
      this.lfo(4.6, 0.15).connect(trem.gain);
      chain(trem);
    }
    const g = ctx.createGain();
    g.gain.value = def.gain * Math.pow(10, (MIX[this.score.mood]?.[i] ?? 0) / 20);
    chain(g);
    const pan = ctx.createStereoPanner();
    pan.pan.value = side ? side * Math.abs(def.pan || 0.5) : def.pan;
    chain(pan);
    last.connect(def.drums ? this.drums : this.music);
    if (def.rev) { const s = ctx.createGain(); s.gain.value = def.rev; last.connect(s); s.connect(this.rev); }
    if (def.echo) { const s = ctx.createGain(); s.gain.value = def.echo; last.connect(s); s.connect(this.echo); }
    this.strips.set(name, input);
    return input;
  }

  /** Rise to `peak` in `a`, hold, fall to nothing in `rel` — never past the end. */
  private envelope(g: AudioParam, t: number, d: number, peak: number, a: number, rel: number): number {
    const end = this.end;
    let off = Math.min(t + d, end - 0.005);
    const r = Math.max(0.01, Math.min(rel, end - off));
    off = Math.max(t + 0.001, Math.min(off, end - r));
    const aEnd = Math.min(t + a, off);
    const top = peak * Math.min(1, (aEnd - t) / Math.max(1e-4, a));
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(top, aEnd);
    if (off > aEnd + 1e-4) g.setValueAtTime(top, off);
    g.linearRampToValueAtTime(0, off + r);
    return off + r;
  }

  private osc(type: OscillatorType, f: number, cents: number, t: number, stop: number, to: AudioNode, vib?: AudioNode): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = cents;
    if (vib) vib.connect(o.detune);
    o.connect(to);
    o.start(t);
    o.stop(Math.min(this.end, stop + 0.02));
    return o;
  }

  play(n: Note, idx: number) {
    const { ctx } = this;
    const t = n.t - this.from;
    const v = n.v;
    const f = mtof(n.p);
    const mood = this.score.mood;
    if (n.i === 'pad' || n.i === 'strings' || n.i === 'choir' || n.i === 'lead') {
      const [a, rel] = adsrOf(n.i, mood);
      const per = n.i === 'lead' ? [-14, 14] : n.i === 'choir' ? [-6, 6] : [-9, 9];
      per.forEach((cents, k) => {
        const g = ctx.createGain();
        const stop = this.envelope(g.gain, t, n.d, v, a, rel);
        g.connect(this.strip(n.i, k ? 1 : -1));
        this.osc('sawtooth', f, cents, t, stop, g, n.i === 'strings' || n.i === 'choir' ? this.vib : undefined);
        if (n.i === 'lead') this.osc('sawtooth', f, 0, t, stop, g);
        if (n.i === 'pad' && k === 0) this.osc('triangle', f / 2, 0, t, stop, g);
      });
      return;
    }
    if (n.i === 'brass') {
      const [a, rel] = adsrOf('brass', mood);
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.2;
      const swell = n.d >= 3;
      lp.frequency.setValueAtTime(swell ? 250 : 350, t);
      lp.frequency.linearRampToValueAtTime(swell ? 1400 : 2400, t + (swell ? n.d * 0.6 : 0.09));
      if (!swell) lp.frequency.exponentialRampToValueAtTime(1500, t + 0.45);
      const stop = this.envelope(g.gain, t, n.d, v, swell ? n.d * 0.5 : a, rel);
      lp.connect(g);
      g.connect(this.strip('brass'));
      for (const cents of [-5, 5]) this.osc('sawtooth', f, cents, t, stop, lp);
      return;
    }
    if (n.i === 'ney') {
      const [a, rel] = adsrOf('ney', mood);
      const g = ctx.createGain();
      const stop = this.envelope(g.gain, t, n.d, v, a, rel);
      g.connect(this.strip('ney'));
      const tone = this.osc('sine', f, -35, t, stop, g, this.neyVib);
      tone.detune.setValueAtTime(-35, t);
      tone.detune.linearRampToValueAtTime(0, t + 0.12);
      const tri = ctx.createGain();
      tri.gain.value = 0.28;
      tri.connect(g);
      this.osc('triangle', f, 0, t, stop, tri, this.neyVib);
      // The breath: noise around the note, strongest as it starts.
      const src = ctx.createBufferSource();
      src.buffer = this.bank.noise();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 2;
      bp.Q.value = 1.6;
      const bg = ctx.createGain();
      this.envelope(bg.gain, t, n.d, v * 0.5, 0.04, rel);
      bg.gain.setValueAtTime(v * 0.5, t + 0.04);
      bg.gain.linearRampToValueAtTime(v * 0.16, t + Math.min(0.3, Math.max(0.05, n.d * 0.5)));
      src.connect(bp);
      bp.connect(bg);
      bg.connect(this.strip('ney'));
      src.start(t);
      src.stop(Math.min(this.end, stop + 0.02));
      return;
    }
    if (n.i === 'riser') {
      const stop = Math.min(this.end, t + n.d + 0.05);
      const src = ctx.createBufferSource();
      src.buffer = this.bank.noise();
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(7000, t + n.d);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.001, v), t + n.d);
      g.gain.linearRampToValueAtTime(0, stop);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.strip('riser'));
      src.start(t);
      src.stop(stop);
      const sweep = ctx.createOscillator();
      sweep.type = 'sawtooth';
      sweep.frequency.setValueAtTime(110, t);
      sweep.frequency.exponentialRampToValueAtTime(880, t + n.d);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.0001, t);
      sg.gain.exponentialRampToValueAtTime(Math.max(0.001, v * 0.18), t + n.d);
      sg.gain.linearRampToValueAtTime(0, stop);
      sweep.connect(lp);
      lp.connect(sg);
      sg.connect(this.strip('riser'));
      sweep.start(t);
      sweep.stop(stop);
      return;
    }
    const buf = this.bank.sound(n, (Math.imul(idx + 1, 2654435761) >>> 0) % 3);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (n.i === 'vinyl') src.loop = true;
    const g = ctx.createGain();
    src.connect(g);
    g.connect(this.strip(n.i));
    if (TONES.has(n.i) || n.i === 'vinyl') {
      // A held tone stops when its note ends, dampered rather than cut.
      const rel = n.i === 'piano' ? 0.18 : n.i === 'bass' ? 0.06 : n.i === 'harp' ? 0.4 : 0.1;
      const stop = Math.min(this.end, t + (n.i === 'vinyl' ? n.d : Math.min(n.d, buf.duration)) + rel);
      g.gain.setValueAtTime(v, t);
      if (n.d < buf.duration || n.i === 'vinyl') {
        const off = Math.max(t, Math.min(t + n.d, this.end - rel));
        g.gain.setValueAtTime(v, off);
        g.gain.linearRampToValueAtTime(0, Math.min(this.end, off + rel));
      }
      src.start(t);
      src.stop(stop);
    } else {
      g.gain.value = v;
      src.start(t);
    }
  }
}

/** A generated room: a pre-delay, a few early reflections, and a noise tail whose highs die sooner than its lows. */
function impulse(ctx: BaseAudioContext, secs: number, r: Rand): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.round(0.018 * sr);
  const n = Math.round(secs * sr);
  const buf = ctx.createBuffer(2, n + pre, sr);
  for (let c = 0; c < 2; c++) {
    const d = new Float32Array(n + pre);
    const bright = noise(n, r);
    const dark = noise(n, r);
    new Biquad('lp', 2400, 0.7, sr).run(dark);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const fadeIn = Math.min(1, t / 0.006);
      d[pre + i] = (bright[i] * 0.5 * Math.exp((-t * 6.9) / (secs * 0.45)) + dark[i] * 1.2 * Math.exp((-t * 6.9) / secs)) * fadeIn;
    }
    for (let k = 0; k < 8; k++) {
      const at = Math.round(r.range(0.004, 0.045) * sr);
      d[at] += r.range(-0.7, 0.7) * Math.exp(-at / sr / 0.05);
    }
    buf.getChannelData(c).set(d);
  }
  return buf;
}

/** How long a slice is, in seconds: a context holding only the notes that start in it stays cheap to render. */
const SLICE = 4;
/** Notes longer than this are rendered together, apart from the slices. */
const LONG = 10;
/** Slices rendered at once; each context renders on its own thread. */
const AT_ONCE = 3;

/**
 * The score played: two channels at `sampleRate`, exactly `score.seconds`
 * long, brought to one loudness, limited and faded.
 *
 * An OfflineAudioContext walks every node it has been given on every block
 * it renders, started or not, so one context holding a whole piece takes
 * time in proportion to its length times its notes — 20 s for 90 s of
 * music. So the notes are rendered in slices of a few seconds, each context
 * holding only the notes that start in it, into a dry mix and the sends; a
 * last context adds the reverb, the echo and the compressor over the whole.
 * Up to the sends everything is linear, so the slices add up exactly.
 */
export async function render(score: Score, sampleRate = RATE, o: { signal?: AbortSignal; onProgress?: (fraction: number) => void; finish?: boolean } = {}): Promise<Float32Array[]> {
  const Ctor = offlineCtor();
  if (!Ctor) throw new Error('This window cannot make sound.');
  const { signal, onProgress } = o;
  const sr = sampleRate;
  const end = score.seconds;
  const total = Math.max(1, Math.round(end * sr));
  const mood = score.mood;

  const last = new Ctor(2, total, sr);
  const dryBuf = last.createBuffer(2, total, sr);
  const sendBuf = last.createBuffer(2, total, sr);
  const dry = [dryBuf.getChannelData(0), dryBuf.getChannelData(1)];
  const sends = [sendBuf.getChannelData(0), sendBuf.getChannelData(1)];
  const bank = new Bank(sr, score, (chans) => {
    const b = last.createBuffer(chans.length, chans[0].length, sr);
    chans.forEach((c, k) => b.getChannelData(k).set(c));
    return b;
  });

  // The slices: short notes by where they start, long ones together.
  const groups = new Map<number, number[]>();
  const long: number[] = [];
  score.notes.forEach((n, idx) => {
    if (n.d > LONG) { long.push(idx); return; }
    const k = Math.floor(n.t / SLICE);
    const g = groups.get(k);
    if (g) g.push(idx); else groups.set(k, [idx]);
  });
  const jobs: { from: number; notes: number[] }[] = [...groups.entries()].sort((x, y) => x[0] - y[0]).map(([k, notes]) => ({ from: k * SLICE, notes }));
  if (long.length) jobs.push({ from: Math.min(...long.map((i) => score.notes[i].t)), notes: long });

  let done = 0;
  const run = async (job: { from: number; notes: number[] }) => {
    if (signal?.aborted) throw abortError();
    const from = Math.floor(job.from * sr) / sr;
    let until = from;
    for (const i of job.notes) until = Math.max(until, score.notes[i].t + score.notes[i].d + 1.6);
    until = Math.min(end, until);
    const len = Math.max(1, Math.round((until - from) * sr));
    const ctx = new Ctor(4, len, sr);
    const slice = new Slice(ctx, score, bank, from, len / sr);
    for (const i of job.notes) slice.play(score.notes[i], i);
    const got = await renderOffline(ctx);
    const at = Math.round(from * sr);
    const chans = [0, 1, 2, 3].map((c) => got.getChannelData(Math.min(c, got.numberOfChannels - 1)));
    const n = Math.min(len, total - at, got.length);
    for (let i = 0; i < n; i++) {
      dry[0][at + i] += chans[0][i];
      dry[1][at + i] += chans[1][i];
      sends[0][at + i] += chans[2][i];
      sends[1][at + i] += chans[3][i];
    }
    done++;
    onProgress?.(0.02 + 0.78 * (done / jobs.length));
    await breathe();
  };
  const queue = jobs.slice();
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
    while (queue.length) await run(queue.shift()!);
  }));
  if (signal?.aborted) throw abortError();

  // The whole piece once more: the reverb, the echo, the compressor.
  const master = last.createGain();
  master.gain.value = 1.3;
  const dsrc = last.createBufferSource();
  dsrc.buffer = dryBuf;
  dsrc.connect(master);
  const ssrc = last.createBufferSource();
  ssrc.buffer = sendBuf;
  const split = last.createChannelSplitter(2);
  ssrc.connect(split);
  const reverb = last.createConvolver();
  reverb.buffer = impulse(last, score.reverb.seconds, new Rand(score.seed, 'room'));
  const revOut = last.createGain();
  revOut.gain.value = score.reverb.wet * 2.2;
  split.connect(reverb, 0);
  reverb.connect(revOut);
  revOut.connect(master);
  // A ping-pong echo, a dotted eighth each way.
  const dl = last.createDelay(2);
  const dr = last.createDelay(2);
  dl.delayTime.value = Math.min(1.9, score.beat * 0.75);
  dr.delayTime.value = Math.min(1.9, score.beat * 0.75);
  const fb = last.createGain();
  fb.gain.value = 0.34;
  const darker = last.createBiquadFilter();
  darker.type = 'lowpass';
  darker.frequency.value = 3800;
  const pl = last.createStereoPanner();
  const pr = last.createStereoPanner();
  pl.pan.value = -0.7;
  pr.pan.value = 0.7;
  split.connect(dl, 1);
  dl.connect(pl);
  pl.connect(master);
  dl.connect(darker);
  darker.connect(dr);
  dr.connect(pr);
  pr.connect(master);
  dr.connect(fb);
  fb.connect(dl);
  const comp = last.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.015;
  comp.release.value = 0.25;
  if (mood === 'lofi') {
    const warm = last.createBiquadFilter();
    warm.type = 'lowpass';
    warm.frequency.value = 7200;
    warm.Q.value = 0.5;
    master.connect(warm);
    warm.connect(comp);
  } else {
    master.connect(comp);
  }
  comp.connect(last.destination);
  dsrc.start(0);
  ssrc.start(0);
  const rendered = await renderOffline(last);
  if (signal?.aborted) throw abortError();
  onProgress?.(0.9);
  const out = [rendered.getChannelData(0).slice(), rendered.getChannelData(Math.min(1, rendered.numberOfChannels - 1)).slice()];
  // `finish: false` leaves the level as the instruments make it, for weighing one part against the rest.
  const target = -15 + 1.5 * (score.energy - 0.5) - (mood === 'calm' ? 1 : mood === 'lofi' ? 0.5 : 0);
  if (o.finish !== false) finish(out, sr, target, clamp((score.seconds - score.end) * 0.75, 0.3, 2));
  onProgress?.(1);
  return out;
}

// ── finishing ─────────────────────────────────────────────────────────────

/**
 * Integrated loudness in LUFS (ITU-R BS.1770): K-weighted, in 400 ms blocks
 * a quarter apart, gated at −70 LUFS and then 10 LU under the mean.
 */
function loudness(ch: readonly Float32Array[], sr: number): number {
  const k1f = 1681.974450955533; const G = 3.999843853973347; const Q1 = 0.7071752369554196;
  const K = Math.tan((Math.PI * k1f) / sr);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0 = 1 + K / Q1 + K * K;
  const s1 = [(Vh + (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q1 + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q1 + K * K) / a0];
  const k2f = 38.13547087602444; const Q2 = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * k2f) / sr);
  const d2 = 1 + K2 / Q2 + K2 * K2;
  const s2 = [1, -2, 1, (2 * (K2 * K2 - 1)) / d2, (1 - K2 / Q2 + K2 * K2) / d2];
  const n = ch[0].length;
  const block = Math.round(0.4 * sr);
  const hop = Math.round(0.1 * sr);
  const hops = Math.max(0, Math.floor((n - block) / hop) + 1);
  const hopSum = new Float64Array(Math.ceil(n / hop) + 1);
  for (const x of ch) {
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    let u1 = 0; let u2 = 0; let z1 = 0; let z2 = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      const y = s1[0] * v + s1[1] * x1 + s1[2] * x2 - s1[3] * y1 - s1[4] * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = y;
      const z = y - 2 * u1 + u2 - s2[3] * z1 - s2[4] * z2;
      u2 = u1; u1 = y; z2 = z1; z1 = z;
      hopSum[Math.floor(i / hop)] += z * z;
    }
  }
  if (!hops) return -Infinity;
  const per = block / hop;
  const z: number[] = [];
  for (let b = 0; b < hops; b++) {
    let s = 0;
    for (let k = 0; k < per; k++) s += hopSum[b + k];
    z.push(s / block);
  }
  const lk = (m: number) => -0.691 + 10 * Math.log10(m);
  const abs = z.filter((m) => m > 0 && lk(m) > -70);
  if (!abs.length) return -Infinity;
  const rel = lk(abs.reduce((s, m) => s + m, 0) / abs.length) - 10;
  const gated = abs.filter((m) => lk(m) > rel);
  return lk(gated.reduce((s, m) => s + m, 0) / gated.length);
}

/**
 * One loudness for every piece, peaks held under −1 dBFS by a limiter that
 * looks a few milliseconds ahead, and fades: a breath at the start, the
 * final chord taken down to silence at the end.
 */
function finish(ch: Float32Array[], sr: number, target: number, fadeOut: number) {
  const n = ch[0].length;
  const I = loudness(ch, sr);
  const gain = Number.isFinite(I) ? clamp(Math.pow(10, (target - I) / 20), 0.05, 30) : 1;
  for (const x of ch) for (let i = 0; i < n; i++) x[i] *= gain;

  const ceiling = 0.891;
  const W = Math.max(1, Math.round(0.004 * sr));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const x of ch) m = Math.max(m, Math.abs(x[i]));
    need[i] = m > ceiling ? ceiling / m : 1;
  }
  // The least gain any sample within the next W needs, then smoothed over W: the gain is down before the peak arrives.
  const ahead = new Float32Array(n);
  const dq = new Int32Array(n);
  let h = 0;
  let q = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (q > h && need[dq[q - 1]] >= need[i]) q--;
    dq[q++] = i;
    while (dq[h] > i + W) h++;
    ahead[i] = need[dq[h]];
  }
  const release = Math.exp(-1 / (0.08 * sr));
  let acc = 0;
  let g = 1;
  for (let i = 0; i < n; i++) {
    acc += ahead[i];
    if (i > W) acc -= ahead[i - W - 1];
    const s = acc / Math.min(i + 1, W + 1);
    g = Math.min(s, g + (1 - g) * (1 - release));
    for (const x of ch) {
      const v = x[i] * g;
      x[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
    }
  }

  const fin = Math.min(n, Math.round(0.012 * sr));
  for (let i = 0; i < fin; i++) for (const x of ch) x[i] *= i / fin;
  const fo = Math.min(n, Math.round(fadeOut * sr));
  for (let i = 0; i < fo; i++) {
    const w = Math.cos(((i + 1) / fo) * (Math.PI / 2));
    for (const x of ch) x[n - fo + i] *= w * w;
  }
}

// ── composing a track ─────────────────────────────────────────────────────

const TITLE: Readonly<Record<Mood, string>> = {
  uplifting: 'Uplifting', calm: 'Calm', cinematic: 'Cinematic', corporate: 'Corporate',
  electronic: 'Electronic', lofi: 'Lo-fi', epic: 'Epic', oriental: 'Oriental',
};

/** What a composed track says about itself — the panel shows its own words for these. */
export const COMPOSED = {
  credit: 'Original music composed in Vylo Editor',
  source: 'Vylo Editor',
  license: 'Yours to use',
} as const;

/**
 * A piece of music for a video `seconds` long: composed from `spec`,
 * marking the cuts in `cues` (seconds), rendered, and kept as a WAV data:
 * URL. `generated` holds the spec, so it can be composed again.
 */
export async function composeMusic(spec: MusicSpec, seconds: number, o: { cues?: number[]; signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}): Promise<Track> {
  if (o.signal?.aborted) throw abortError();
  const s = normalSpec(spec);
  const score = arrange(s, seconds, o.cues ?? []);
  o.onProgress?.(0.03);
  const mixed = await render(score, RATE, { signal: o.signal, onProgress: (f) => o.onProgress?.(0.03 + f * 0.87) });
  if (o.signal?.aborted) throw abortError();
  const wav = encodeWav(mixed, RATE);
  await breathe();
  if (o.signal?.aborted) throw abortError();
  const src = toDataUrl(wav, 'audio/wav');
  o.onProgress?.(1);
  return {
    src,
    generated: s,
    title: `${TITLE[s.mood]} — composed for this video`,
    credit: COMPOSED.credit,
    source: COMPOSED.source,
    license: COMPOSED.license,
    seconds: Math.round(score.seconds * 10) / 10,
  };
}

/**
 * Where a video's scenes arrive, in seconds: halfway through the transition
 * into each (the moment `lineWindows` also calls a scene "in"), or its first
 * frame after a cut. The first scene's start is not a cut.
 */
export function musicCues(v: Pick<Video, 'scenes'>): number[] {
  const scenes = v.scenes ?? [];
  const starts = sceneStarts(scenes);
  return scenes.slice(1).map((_, k) => {
    const i = k + 1;
    const half = scenes[i - 1].transition !== 'none' ? TRANSITION_FRAMES / 2 : 0;
    return Math.round(((starts[i] + half) / FPS) * 1000) / 1000;
  });
}
