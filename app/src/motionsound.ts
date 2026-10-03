import type { Layer, Motion } from './motiontypes';
import { FORMATS, PINS, isRtlLang } from './motiontypes';
import { countAt, gapOf, inDone, outStart, unitsOf } from './motionanim';
import { clamp, easeOf, finite, hash01 } from './motionmath';
import { gainToTarget, measureLoudness, type Loudness } from './loudness';
import { intervalPeaks } from './audiocore';
import { SFX_KINDS, synth, type Sfx, type SfxKind } from './motionsfx';
import type { Mood, Score } from './videosynth';

/**
 * Sound for a graphic: one choice — Off, Effects, Music or Both — and the
 * bed of sound it makes, rendered on this computer from the document alone.
 *
 * ## What a person chooses, and what is chosen for them
 *
 * `SoundSpec` is the whole of it: a mode, a level, and (for music) a mood.
 * Everything else is derived. **Effects** are read off the animation itself
 * (`soundCues`): a layer that slides in gets a whoosh, a counter ticks as it
 * rolls, a big title lands with an impact, a chart grows over a riser, a burst
 * of particles sparkles. Nothing is placed by hand, so a graphic that is
 * retimed, or rebuilt in another shape or language, keeps sounds that fit it.
 * **Music** is composed for the graphic by `videosynth.ts` in the chosen mood,
 * its accents moved onto the scene starts and the big entrances. Both are
 * then brought to one loudness, −16 LUFS with peaks held under −1.5 dB, so
 * a graphic is neither whispering nor shouting next to anything else.
 *
 * Sound is **off** until chosen: a graphic with no `sound` field is silent,
 * exactly as every graphic was before this file existed.
 *
 * ## Level
 *
 * One slider, 0 to 1 (0.6 when untouched), and it does two things, because to
 * a person they are one: how *many* effects play — at a low level only what
 * matters (impacts, the big whooshes) is kept, the ticks and soft pops drop
 * out first — and how *loud* the whole is. At 0.6 the bed is at the delivery
 * loudness, −16 LUFS; below it the target falls as the level's decibels
 * (0.3 is 6 dB quieter); above it the target climbs to −14 LUFS at 1, the
 * loudest the platforms play without turning it down.
 *
 * ## Exact caches
 *
 * `soundKey` hashes only what reaches the sound: the mode and level, and then
 * the cues themselves (for effects) and the mood, seed, length and accents
 * (for music). The cues are derived exactly, so two documents with the same
 * cues sound the same however different their JSON, and a change that alters
 * no cue — a colour, the title, a word swapped for one as long — renders
 * nothing again.
 *
 * ## What this file may import
 *
 * `motionread.ts` imports this file (to read `sound`), so this file never
 * imports it or `motiondraw.ts` at run time: it reads its own field with its
 * own small reader. `videosynth.ts` is imported only when music is rendered
 * (`import()`), so opening Motion does not load the Video studio's composer and
 * everything it brings.
 */

// ── the document's field ──────────────────────────────────────────────────

export const SOUND_MODES = ['off', 'fx', 'music', 'both'] as const;
export type SoundMode = (typeof SOUND_MODES)[number];

export interface SoundSpec {
  mode: SoundMode;
  /** 0..1: how many effects and how loud the whole. 0.6 when not set. */
  level: number;
  /** The music's mood; when absent, the template's own (`moodOf`). */
  mood?: Mood;
  /** Varies the music and the effects' grain; when absent, from the graphic's id. */
  seed?: number;
}

/** A finished bed of sound: planar PCM, one array per channel. */
export interface SoundBed {
  channels: Float32Array[];
  sampleRate: number;
}

/** The level a graphic has until somebody moves the slider. */
const DEFAULT_LEVEL = 0.6;

/** What a graphic starts with: off, at the default level. */
export function defaultSound(): SoundSpec {
  return { mode: 'off', level: DEFAULT_LEVEL };
}

/**
 * The moods, in the order the music panel offers them, with the same English
 * labels as `MUSIC_MOODS` in videosynth.ts (so the catalogue's translations of
 * them serve here too). Written out rather than imported so that reading a
 * graphic never loads the composer; the `Record` makes the compiler refuse a
 * mood videosynth has and this list lacks, and the tests compare the two.
 */
const MOOD_LABEL: Readonly<Record<Mood, string>> = {
  uplifting: 'Uplifting',
  calm: 'Calm',
  cinematic: 'Cinematic',
  corporate: 'Corporate',
  electronic: 'Electronic',
  lofi: 'Lo-fi',
  epic: 'Epic',
  oriental: 'Oriental',
};
export const SOUND_MOODS: readonly { id: Mood; label: string }[] = (Object.keys(MOOD_LABEL) as Mood[]).map((id) => ({ id, label: MOOD_LABEL[id] }));

/** The words a model or a hand edit might use for a mode. */
const MODE_WORDS: Readonly<Record<string, SoundMode>> = {
  off: 'off', none: 'off', silent: 'off', silence: 'off', mute: 'off',
  fx: 'fx', sfx: 'fx', effects: 'fx', effect: 'fx',
  music: 'music',
  both: 'both', all: 'both', 'fx+music': 'both', 'music+fx': 'both',
};
const MOOD_WORDS: Readonly<Record<string, Mood>> = { 'lo-fi': 'lofi', chill: 'lofi', arabic: 'oriental', kurdish: 'oriental' };

type Rec = Record<string, unknown>;

/** `x` as an object to read fields from; null for anything else (a revoked Proxy included). */
function rec(x: unknown): Rec | null {
  try {
    return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null;
  } catch {
    return null;
  }
}

/** A field that is `o`'s own; an inherited name or a throwing getter is no field. */
function own(o: Rec, k: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  } catch {
    return undefined;
  }
}

/** A number, or a numeric string such as "0.5" as the number it spells. */
function numberOf(x: unknown): number | undefined {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function modeOf(x: unknown): SoundMode | undefined {
  if (typeof x !== 'string') return undefined;
  const w = x.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(MODE_WORDS, w) ? MODE_WORDS[w] : undefined;
}

function moodWord(x: unknown): Mood | undefined {
  if (typeof x !== 'string') return undefined;
  const w = x.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOOD_LABEL, w)) return w as Mood;
  return Object.prototype.hasOwnProperty.call(MOOD_WORDS, w) ? MOOD_WORDS[w] : undefined;
}

/** 0..1 in hundredths. A number above 1 and up to 100 is read as a percentage, as a model often writes it. */
function levelOf(x: unknown): number {
  let n = numberOf(x);
  if (n === undefined) return DEFAULT_LEVEL;
  if (n > 1 && n <= 100) n /= 100;
  // `|| 0`: a level of -0 (or "-0", or -0.004) would otherwise be kept as -0, which reads back the same but is a
  // number no slider writes and motionread.ts promises no field ever holds.
  return Math.round(clamp(n, 0, 1) * 100) / 100 || 0;
}

/** A seed the composer takes: a whole number 0..2^31-2, as `normalSpec` in videosynth.ts keeps it. */
function seedWord(x: unknown): number | undefined {
  const n = numberOf(x);
  return n === undefined ? undefined : Math.abs(Math.trunc(n)) % 2147483647;
}

/**
 * Read a stored or model-written sound spec; `undefined` is silence.
 *
 * Everything is repaired, nothing trusted, nothing thrown: an unknown mode is
 * off, the level is held to 0..1 in hundredths (60 is read as 60%), an unknown
 * mood is dropped (the template's own is used), a seed is a whole number. A
 * bare word is a mode ("music"). A spec that is off and remembers nothing a
 * person chose is no spec — `undefined` — so a graphic that was never given
 * sound and one whose sound was turned off and left at the defaults read the
 * same. One that is off but carries a mood or a level keeps them, so turning
 * sound on again brings back what was chosen. A fixed point: reading what
 * this returns returns it again.
 */
export function readSound(x: unknown): SoundSpec | undefined {
  try {
    if (typeof x === 'string') {
      const mode = modeOf(x);
      return mode && mode !== 'off' ? { mode, level: DEFAULT_LEVEL } : undefined;
    }
    const o = rec(x);
    if (!o) return undefined;
    const mode = modeOf(own(o, 'mode')) ?? 'off';
    const spec: SoundSpec = { mode, level: levelOf(own(o, 'level')) };
    const mood = moodWord(own(o, 'mood'));
    if (mood) spec.mood = mood;
    const seed = seedWord(own(o, 'seed'));
    if (seed !== undefined) spec.seed = seed;
    if (mode === 'off' && !mood && seed === undefined && spec.level === DEFAULT_LEVEL) return undefined;
    return spec;
  } catch {
    return undefined;
  }
}

/** The graphic with its sound set to `spec` (read first), or `doc` itself when nothing changes. */
export function withSound(doc: Motion, spec: SoundSpec | undefined, now = Date.now()): Motion {
  const next = readSound(spec);
  if (JSON.stringify(next) === JSON.stringify(readSound(doc.sound))) return doc;
  const out: Motion = { ...doc, updated: now };
  if (next) out.sound = next;
  else delete out.sound;
  return out;
}

/**
 * The mood a template's music takes before anybody picks one: a data graphic
 * is businesslike, a logo sting cinematic, a countdown epic, a background
 * calm. A template not listed here (and a graphic made by hand) is uplifting.
 */
const RECIPE_MOOD: Readonly<Record<string, Mood>> = {
  'big-title': 'cinematic', kinetic: 'electronic', 'split-title': 'cinematic', quote: 'calm',
  'lower-third': 'corporate', subscribe: 'uplifting', callout: 'corporate', handle: 'lofi',
  'big-number': 'corporate', 'bar-chart': 'corporate', donut: 'corporate', 'line-chart': 'corporate', stats: 'corporate',
  'logo-reveal': 'cinematic', countdown: 'epic', intro: 'uplifting', steps: 'corporate', 'loop-bg': 'calm',
};

/** The mood the music is composed in: the one chosen, else the template's. */
export function moodOf(doc: Motion): Mood {
  const chosen = readSound(doc?.sound)?.mood;
  if (chosen) return chosen;
  const id = doc?.recipe?.id;
  return (id && Object.prototype.hasOwnProperty.call(RECIPE_MOOD, id) ? RECIPE_MOOD[id] : undefined) ?? 'uplifting';
}

/** FNV-1a over a string's UTF-16 units, from `basis`: a cheap, stable 32-bit hash. */
function fnv(s: string, basis = 0x811c9dc5): number {
  let h = basis >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The seed the sound is made from: the one chosen, else one from the graphic's id, so each graphic has its own tune. */
function seedOf(doc: Motion): number {
  const chosen = readSound(doc?.sound)?.seed;
  return chosen ?? fnv(String(doc?.id ?? '')) % 2147483647;
}

const secondsOf = (doc: Motion) => clamp(finite(doc?.seconds, 6), 1, 30);

// ── cues: the effects the animation asks for ──────────────────────────────

/** One sound effect at one moment. */
export interface Cue {
  kind: SfxKind;
  /** Seconds into the graphic the sound starts. */
  t: number;
  /** Seconds its shape spans (a whoosh's sweep, a riser's climb); see `Sfx.d`. */
  d: number;
  /** -1 left to 1 right: physical, already mirrored for a right-to-left graphic. */
  pan: number;
  /** 0..1, before the level. */
  gain: number;
  pitch: number;
  /** Shaped backwards: an exit's whoosh, which builds to the moment the layer is gone. */
  rev: boolean;
  seed: number;
  /** The layer that asked for it. */
  layer: string;
}

/**
 * The fewest seconds between two cues of a kind. Two whooshes closer than
 * this are one blur of noise, two impacts closer than half a second one dull
 * thud; and ninety milliseconds is about where ticks stop being heard as
 * separate. When cues collide, the more important one is kept.
 */
const MIN_GAP: Readonly<Record<SfxKind, number>> = {
  whoosh: 0.15, pop: 0.09, tick: 0.09, key: 0.09, impact: 0.5, sparkle: 0.35, riser: 0.8, swell: 1, click: 0.09,
};

/** How much a kind matters when there is not room for everything: an impact over a tick. */
const WEIGHT: Readonly<Record<SfxKind, number>> = {
  impact: 1, whoosh: 0.8, riser: 0.8, pop: 0.7, swell: 0.6, sparkle: 0.6, click: 0.5, key: 0.45, tick: 0.45,
};

/** Most cues a graphic has; thirty seconds at the busiest a second may be. */
const MAX_CUES = 240;
/** Most cues one layer may offer: a hundred-character typing line is a hundred keys, thinned anyway. */
const PER_LAYER = 64;
/** How far to either side a sound is placed: never hard into one ear. */
const PAN_WIDTH = 0.7;
/** How much of the way an entrance is before it reads as landed. */
const LANDED = 0.95;

/** Most cues in any one second at `level`: four at the quietest, ten at the loudest, eight by default. */
function perSecond(level: number): number {
  return Math.round(4 + 6 * clamp(level, 0, 1));
}

/** The least importance (gain times weight) a cue needs at `level`: nothing is dropped at the default and above. */
function floorOf(level: number): number {
  return 0.5 * Math.pow(1 - clamp(level, 0, 1), 1.5);
}

/**
 * How big a layer is, 1 being headline size: what decides how loud its
 * sounds are and whether its arrival is an impact. Text and numbers by their
 * type size, the rest by their area's side, each against what a template
 * uses for the main thing in the frame.
 */
function bigness(l: Layer): number {
  const s = clamp(finite(l.scale, 1), 0, 4);
  switch (l.kind) {
    case 'text': return (finite(l.size, 6) * s) / 10;
    case 'counter': return (finite(l.size, 6) * s) / 12;
    case 'shape': return (Math.sqrt(Math.max(0, finite(l.w, 0) * finite(l.h, 0))) * s) / 28;
    case 'icon': return ((finite(l.size, 8) + 2 * finite(l.badge?.pad, 0)) * s) / 14;
    case 'image': return (Math.sqrt(Math.max(0, finite(l.w, 0) * finite(l.h, 0))) * s) / 40;
    case 'chart': return (Math.sqrt(Math.max(0, finite(l.w, 0) * finite(l.h, 0))) * s) / 45;
    default: return 1;
  }
}

/** A cue's gain from its layer's size: small things are heard, quietly; the main thing is heard fully. */
const gainOf = (b: number) => clamp(0.3 + 0.55 * Math.min(b, 1.3), 0.3, 1);

/** How wide a layer's box is, in u, near enough to say where it sits left to right. */
function widthOf(l: Layer, frame: number): number {
  const s = clamp(finite(l.scale, 1), 0, 4);
  switch (l.kind) {
    case 'text': {
      const longest = Math.max(0, ...String(l.text ?? '').split('\n').map((x) => Array.from(x).length));
      const max = finite(l.max, 0);
      return (max > 0 ? max : Math.min(frame, longest * finite(l.size, 6) * 0.55)) * s;
    }
    case 'counter': {
      const digits = String(Math.round(Math.max(Math.abs(finite(l.from, 0)), Math.abs(finite(l.to, 0))))).length;
      return (digits + String(l.prefix ?? '').length + String(l.suffix ?? '').length) * finite(l.size, 6) * 0.6 * s;
    }
    case 'shape': case 'image': case 'chart': return Math.max(0, finite(l.w, 0)) * s;
    case 'icon': return (finite(l.size, 8) + 2 * finite(l.badge?.pad, 0)) * s;
    default: return 0;
  }
}

const PIN_SET: ReadonlySet<string> = new Set(PINS);

/**
 * Where a layer sits from left (-1) to right (1), scaled to `PAN_WIDTH`. The
 * pin's column and `x` are logical — `s` is the left in English and the right
 * in Arabic — so the same lower third is heard on the side it is seen on in
 * every language, with no case for either.
 */
function panOf(l: Layer, frame: number, rtl: boolean): number {
  if (l.kind === 'backdrop') return 0;
  const col = PIN_SET.has(l.pin) ? l.pin[1] : 'c';
  const w = widthOf(l, frame);
  const at = (col === 's' ? 0 : col === 'c' ? frame / 2 : frame) + clamp(finite(l.x, 0), -400, 400);
  const centre = col === 's' ? at + w / 2 : col === 'c' ? at : at - w / 2;
  const seen = rtl ? frame - centre : centre;
  return clamp((seen / frame) * 2 - 1, -1, 1) * PAN_WIDTH;
}

/** The first moment from `t0` an effect of `d` seconds on `ease` is `share` of the way: when it reads as there. */
function reach(t0: number, d: number, ease: string, share: number): number {
  const f = easeOf(ease);
  const steps = 200;
  for (let k = 0; k <= steps; k++) if (f(k / steps) >= share) return t0 + (d * k) / steps;
  return t0 + d;
}

/** The sound an entrance makes, by its effect and what kind of thing arrives. */
interface Voice {
  kind: SfxKind;
  gain: number;
  /** Times the effect's own length, for the kinds that follow it. */
  stretch: number;
}

/** Things that arrive as objects (a shape, an icon, a picture) rather than as words. */
const OBJECT_KINDS: ReadonlySet<string> = new Set(['shape', 'icon', 'image']);

function entranceVoice(l: Layer, fx: string, b: number): Voice | null {
  const object = OBJECT_KINDS.has(l.kind);
  const tap = (gain: number): Voice => ({ kind: b < 0.3 ? 'click' : 'pop', gain, stretch: 1 });
  switch (fx) {
    case 'slide': case 'wipe': case 'mask': case 'spin': case 'flip':
      return { kind: 'whoosh', gain: 1, stretch: 1 };
    case 'pop': case 'zoom':
      return tap(1);
    case 'rise': case 'drop':
      return object ? tap(0.75) : { kind: 'whoosh', gain: 0.55, stretch: 0.8 };
    case 'fade': case 'blur':
      // A panel the size of the frame fading in is a change of light, not a thing arriving.
      if (object) return b > 2 ? null : tap(0.6);
      return b >= 0.9 ? { kind: 'swell', gain: 0.5, stretch: 1.5 } : null;
    case 'grow':
      return { kind: 'whoosh', gain: 0.45, stretch: 1 };
    case 'draw':
      return { kind: 'whoosh', gain: 0.35, stretch: 1 };
    default:
      return null;
  }
}

/** The exit's sound: the same rush, played backwards and quieter. Fades, blurs and un-typing leave in silence. */
function exitVoice(fx: string): Voice | null {
  switch (fx) {
    case 'slide': case 'wipe': case 'mask': case 'spin': case 'flip': case 'zoom': case 'pop':
      return { kind: 'whoosh', gain: 0.55, stretch: 1 };
    case 'rise': case 'drop': case 'grow': case 'draw':
      return { kind: 'whoosh', gain: 0.35, stretch: 0.8 };
    default:
      return null;
  }
}

/** Entrances that land: a big title arriving this way gets an impact the moment it is in place. */
const LANDINGS: ReadonlySet<string> = new Set(['pop', 'zoom', 'drop', 'slide', 'spin', 'flip', 'rise', 'mask']);

/** How the particles' styles ring: snow is faint and high, confetti a little lower. */
const PARTICLE_PITCH: Readonly<Record<string, number>> = { confetti: 0.9, sparks: 1.1, bubbles: 0.8, stars: 1.2, snow: 1.3 };

interface Frame {
  seconds: number;
  /** The frame's width in u. */
  width: number;
  rtl: boolean;
  seed: number;
}

/** `x` to `places` decimals, by dividing (multiplying by 0.001 would leave 0.7000000000000001 in a key). */
const round = (x: number, places: number) => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

/** Every cue one layer asks for, before any is thinned out. */
function layerCues(l: Layer, f: Frame, out: Cue[]): void {
  if (!l || l.hidden || finite(l.opacity, 1) < 0.05) return;
  const start = finite(l.start, 0);
  const end = Math.min(finite(l.end, f.seconds), f.seconds);
  if (!(end > start) || start >= f.seconds) return;
  const id = String(l.id ?? '');
  const b = bigness(l);
  const g = gainOf(b);
  const pan = round(panOf(l, f.width, f.rtl), 3);
  let made = 0;
  const push = (kind: SfxKind, t: number, o: { d?: number; gain: number; pitch?: number; rev?: boolean }, salt: number) => {
    // A sound is the layer's only while the layer is there, and nothing starts in the last instant of the graphic.
    if (made >= PER_LAYER || !(t >= start - 1e-9) || !(t < end) || t >= f.seconds - 0.02) return;
    const seed = (fnv(`${id}|${kind}|${salt}`) ^ f.seed) >>> 0;
    const pitch = clamp((o.pitch ?? 1) * (1 + 0.06 * (hash01(seed) - 0.5)), 0.5, 2);
    out.push({
      kind, t: round(Math.max(0, t), 4), d: round(clamp(o.d ?? 0, 0, 4), 3), pan, gain: round(clamp(o.gain, 0, 1), 3),
      pitch: Math.round(pitch * 200) / 200, rev: o.rev === true, seed, layer: id,
    });
    made += 1;
  };

  if (l.kind === 'backdrop') {
    // The ground arriving: a soft swell, as long as its entrance, or a short one when it is simply there.
    const a = l.in && l.in.fx !== 'none' ? l.in : undefined;
    push('swell', start + finite(a?.delay, 0), { d: clamp(finite(a?.d, 1.2) * 1.4, 0.8, 2.5), gain: a || start > 0 ? 0.4 : 0.3 }, 0);
    return;
  }
  if (l.kind === 'particles') {
    const t = start + (l.in && l.in.fx !== 'none' ? finite(l.in.delay, 0) : 0);
    const pitch = PARTICLE_PITCH[l.style] ?? 1;
    if (l.burst) push('sparkle', t, { d: 0.7, gain: 0.6, pitch }, 0);
    else push('sparkle', t, { d: 1.2, gain: 0.35, pitch }, 0);
    return;
  }

  const n = unitsOf(l);
  const a = l.in;
  if (a && a.fx !== 'none') {
    const t0 = start + finite(a.delay, 0);
    const d = Math.max(0.05, finite(a.d, 0.6));
    const gap = gapOf(l, a);
    const by = l.kind === 'text' ? a.by ?? 'all' : 'all';
    if (a.fx === 'type' && l.kind === 'text') {
      // A key per character as it appears: along the curve when the whole line types, one per piece when it is split.
      const chars = Math.min(PER_LAYER, Array.from(String(l.text ?? '').replace(/\s/g, '')).length);
      if (by === 'all') {
        for (let k = 0; k < chars; k++) push('key', reach(t0, d, a.ease, (k + 0.5) / chars), { gain: g * 0.6 }, k);
      } else {
        for (let i = 0; i < Math.min(n, PER_LAYER); i++) push('key', t0 + i * gap, { gain: g * 0.6 }, i);
      }
    } else if (l.kind === 'chart') {
      // A chart grows over a riser that lasts as long as its data take to come in.
      const span = inDone(l, n) - t0;
      push('riser', t0, { d: clamp(span, 0.3, 4), gain: g * 0.8 }, 0);
    } else {
      const v = entranceVoice(l, a.fx, b);
      if (v) {
        // Words and lines that arrive one after another are each heard; characters are one gesture.
        const each = (by === 'word' || by === 'line') && n > 1;
        const span = each ? d : d + (n - 1) * gap;
        const units = each ? Math.min(n, 24) : 1;
        for (let i = 0; i < units; i++) {
          push(v.kind, t0 + i * gap, { d: clamp(span * v.stretch, 0.15, 1.6), gain: g * v.gain * (i ? 0.7 : 1) }, i);
        }
      }
    }
    // A big title, landing.
    if (l.kind === 'text' && b >= 1.1 && LANDINGS.has(a.fx)) {
      const last = t0 + (n - 1) * gap;
      push('impact', reach(last, d, a.ease, LANDED), { gain: clamp(0.6 + 0.3 * (b - 1.1), 0.6, 1) }, 0);
    }
  }

  if (l.kind === 'counter') {
    // Ticks as the number rolls, quick then slower as its curve eases, rising a little in pitch; a big number lands.
    const c = l.count;
    const t0 = start + finite(c?.delay, 0);
    const d = finite(c?.d, 0);
    const from = finite(l.from, 0);
    const to = finite(l.to, 0);
    if (d >= 0.15 && from !== to) {
      const steps = clamp(Math.round(d * 16), 4, 48);
      const samples = 240;
      let next = 1;
      let landed = -1;
      for (let k = 0; k <= samples && next < steps; k++) {
        const t = t0 + (d * k) / samples;
        const p = (countAt(l, t) - from) / (to - from);
        while (next < steps && p >= next / steps) {
          push('tick', t, { gain: g * 0.55, pitch: 0.9 + (0.35 * next) / steps }, next);
          next += 1;
        }
      }
      for (let k = 0; k <= samples; k++) {
        const t = t0 + (d * k) / samples;
        if ((countAt(l, t) - from) / (to - from) >= 0.98) {
          landed = t;
          break;
        }
      }
      if (b >= 0.9 && landed >= 0) push('impact', landed, { gain: clamp(0.6 + 0.3 * (b - 0.9), 0.6, 1) }, 1);
    }
  }

  if (l.loop?.fx === 'shimmer') {
    // The glint crossing a logo: a small sparkle each pass, once it has arrived and before it leaves, three at most.
    const period = Math.max(0.2, finite(l.loop.d, 2));
    const from = inDone(l, n);
    const until = l.out && l.out.fx !== 'none' ? outStart(l, n) : end;
    let k = 0;
    for (let t = start + 0.35 * period; t < until && k < 3; t += period) {
      if (t < from) continue;
      push('sparkle', t, { d: 0.5, gain: 0.3, pitch: 1.3 }, 100 + k);
      k += 1;
    }
  }

  const z = l.out;
  if (z && z.fx !== 'none' && finite(l.end, f.seconds) <= f.seconds + 1e-9) {
    const v = exitVoice(z.fx);
    if (v) {
      const span = Math.max(0.05, finite(z.d, 0.4)) + (n - 1) * gapOf(l, z);
      push(v.kind, outStart(l, n), { d: clamp(span * v.stretch, 0.15, 1.6), gain: g * v.gain, rev: true }, 200);
    }
  }
}

const KIND_ORDER: Readonly<Record<string, number>> = Object.fromEntries(SFX_KINDS.map((k, i) => [k, i]));

/** Earlier first; at the same moment, in a fixed order, so the list is the same however it was built. */
function byTime(a: Cue, b: Cue): number {
  return a.t - b.t || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0) || a.seed - b.seed;
}

/** Whether `t` can join `kept` with no one-second window holding more than `cap`. */
function roomAt(kept: readonly Cue[], t: number, cap: number): boolean {
  const near = kept.filter((c) => c.t > t - 1 && c.t < t + 1).map((c) => c.t);
  near.push(t);
  near.sort((x, y) => x - y);
  for (let i = 0, j = 0; i < near.length; i++) {
    while (j < near.length && near[j] < near[i] + 1 - 1e-9) j++;
    if (j - i > cap) return false;
  }
  return true;
}

/**
 * The cues that are kept: those that matter enough at this level, taken most
 * important first, each only if it is far enough from a kept cue of its kind
 * and leaves no second over its cap. Then put back in time order.
 */
function thin(all: Cue[], level: number): Cue[] {
  const floor = floorOf(level);
  const cap = perSecond(level);
  const ranked = all
    .filter((c) => c.gain * WEIGHT[c.kind] >= floor - 1e-9)
    .sort((a, b) => b.gain * WEIGHT[b.kind] - a.gain * WEIGHT[a.kind] || byTime(a, b));
  const kept: Cue[] = [];
  for (const c of ranked) {
    if (kept.length >= MAX_CUES) break;
    if (kept.some((k) => k.kind === c.kind && Math.abs(k.t - c.t) < MIN_GAP[c.kind] - 1e-9)) continue;
    if (!roomAt(kept, c.t, cap)) continue;
    kept.push(c);
  }
  return kept.sort(byTime);
}

function frameOf(doc: Motion): Frame {
  const f = FORMATS[doc?.format] ?? FORMATS.landscape;
  return {
    seconds: secondsOf(doc),
    width: (f.width / Math.min(f.width, f.height)) * 100,
    rtl: isRtlLang(doc?.lang),
    seed: seedOf(doc),
  };
}

/** Every cue the layers ask for, unthinned. */
function allCues(doc: Motion): Cue[] {
  const f = frameOf(doc);
  const out: Cue[] = [];
  for (const l of Array.isArray(doc?.layers) ? doc.layers.slice(0, 200) : []) layerCues(l, f, out);
  return out;
}

/**
 * The sound effects a graphic's animation asks for, in time order: the cues
 * its entrances, exits, counters, charts, particles, shimmers and backdrops
 * make, thinned to its level. They are worked out whatever the mode, so the
 * timeline could show them; only Effects and Both play them.
 */
export function soundCues(doc: Motion): Cue[] {
  const level = (readSound(doc?.sound) ?? defaultSound()).level;
  return thin(allCues(doc), level);
}

/**
 * The moments the music marks: each scene's start after the first, and each
 * big entrance (where an impact would land), in time order, a half second
 * apart at least, twelve at most. `arrange` moves each to its nearest beat
 * and puts a crash or a section change on it.
 */
export function musicCuesOf(doc: Motion): number[] {
  const seconds = secondsOf(doc);
  const at: number[] = [];
  const scenes = Array.isArray(doc?.scenes) ? doc.scenes.slice(1, 40) : [];
  for (const s of scenes) {
    const r = rec(s);
    const t = r ? finite(own(r, 'start'), NaN) : NaN;
    if (t > 0.25 && t < seconds - 0.5) at.push(t);
  }
  for (const c of allCues(doc)) if (c.kind === 'impact' && c.t > 0.25 && c.t < seconds - 0.5) at.push(c.t);
  at.sort((x, y) => x - y);
  const out: number[] = [];
  for (const t of at) if (!out.length || t - out[out.length - 1] >= 0.5) out.push(Math.round(t * 1000) / 1000);
  return out.slice(0, 12);
}

// ── the key ───────────────────────────────────────────────────────────────

/** Bumped when the sound a document makes changes for the same cues, so a kept bed is not reused. */
const SOUND_VERSION = 'sound1';

/** Whether a spec makes any sound at all. */
const audible = (s: SoundSpec | undefined): s is SoundSpec => !!s && s.mode !== 'off' && s.level > 0;

/**
 * A hash of only what affects the sound, for caches: `'silent'` when there is
 * none. Two documents with the same key sound the same, sample for sample.
 */
export function soundKey(doc: Motion): string {
  const spec = readSound(doc?.sound);
  if (!audible(spec)) return 'silent';
  const parts: (string | number)[] = [SOUND_VERSION, spec.mode, spec.level, secondsOf(doc)];
  if (spec.mode !== 'music') {
    for (const c of soundCues(doc)) parts.push(`${c.kind}@${c.t}/${c.d}/${c.pan}/${c.gain}/${c.pitch}/${c.rev ? 1 : 0}/${c.seed}`);
  }
  if (spec.mode !== 'fx') parts.push(moodOf(doc), seedOf(doc), musicCuesOf(doc).join(','));
  const s = parts.join('|');
  const hex = (h: number) => h.toString(16).padStart(8, '0');
  return hex(fnv(s)) + hex(fnv(s, 0x9e3779b9));
}

// ── rendering ─────────────────────────────────────────────────────────────

/** How the score is played: videosynth.ts's `render` unless a caller (a test, with no Web Audio) hands in another. */
export type MusicRenderer = (score: Score, sampleRate: number, o: { signal?: AbortSignal }) => Promise<Float32Array[]>;

export interface RenderSoundOptions {
  signal?: AbortSignal;
  /** Samples a second; 48000 when not given, what an MP4's AAC track is written at. */
  sampleRate?: number;
  /** Plays the music's score. Leave it out: it exists so Node, which has no Web Audio, can test the mix. */
  music?: MusicRenderer;
}

const DEFAULT_RATE = 48000;
/** The delivery loudness at the default level, and the loudest the level may ask for. */
const TARGET_LUFS = -16;
const LOUDEST_LUFS = -14;
/** The ceiling the contract holds the peaks to (`gainToTarget`). */
const CEILING_DB = -1.5;
/**
 * Where the limiter holds the wave (between the samples too, see `peakNear`):
 * a decibel under the contract's ceiling, the room a twelve-tap estimate of
 * the wave needs to stay under −1.5 dBTP by any finer meter's reading.
 */
const PEAK_CEILING_DB = -2.5;
/** Where the music sits before the mix is brought to its loudness: a few dB under the effects, so they read over it. */
const MUSIC_REF_LUFS = -23;
/** The most the finishing pass may raise sparse effects: past this a meter that counts silence would have them squashed. */
const BOOST_FX_DB = 10;
const BOOST_MUSIC_DB = 20;
/** The music's fade in, and its fade out (the shorter of 1.2 s and 15% of the graphic). */
const MUSIC_FADE_IN = 0.3;
/**
 * How far the music dips under a big effect, and how it moves: down over the
 * 0.15 s before it (the cue's time is known, so the dip can arrive with it),
 * held, back over 0.4 s — the attack and release HyperFrames uses for music
 * under a voice. The depth is lighter than its x0.25: an effect is a moment,
 * not a sentence that has to be understood.
 */
const DUCK = 0.6;
const DUCK_ATTACK = 0.15;
const DUCK_HOLD = 0.15;
const DUCK_RELEASE = 0.4;

/** The loudness, in LUFS, a bed at `level` is brought to: −16 at 0.6, −14 at 1, the level's decibels below. */
export function loudnessFor(level: number): number {
  const l = clamp(finite(level, DEFAULT_LEVEL), 0, 1);
  if (l <= 0) return -Infinity;
  if (l <= DEFAULT_LEVEL) return TARGET_LUFS + 20 * Math.log10(l / DEFAULT_LEVEL);
  return TARGET_LUFS + ((LOUDEST_LUFS - TARGET_LUFS) * (l - DEFAULT_LEVEL)) / (1 - DEFAULT_LEVEL);
}

function abortError(): Error {
  const e = new Error('Stopped.');
  e.name = 'AbortError';
  return e;
}

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

// ── sharing the thread ────────────────────────────────────────────────────
//
// The bed is rendered on the page's own thread, beside the stage: the preview
// asks for one 250 ms after the sound settles, while the graphic may be
// playing. In one piece, a ten-second bed held the thread for 0.1 to 0.35 s at
// a time in WebKit (review R4), and the picture stopped for as long. So every
// long pass here works a block at a time and gives the thread back whenever
// it has held it for `SLICE_MS`: a frame, a key press and the clock run in
// between, and a stopped render (a newer change, Cancel) stops at the next
// break. Nothing about the arithmetic changes — the same operations on the
// same samples in the same order — so the bed is the same, byte for byte.

/** How long the render holds the thread before it gives it back: half a frame at 60 Hz. */
const SLICE_MS = 8;
/** Samples a per-sample pass works through between two looks at the clock (a third of a second at 48 kHz). */
const BLOCK = 1 << 14;

const clockNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * A new task: what was waiting (a frame, a key, a timer) runs before the
 * render goes on. In the page, a timer: a chain of them is held to 4 ms each
 * by the browser, and that is time the thread is idle — WebKit runs a
 * frame's work (animation callbacks, layout, the paint's commit) when its run
 * loop is about to wait, which a message posted back to back would never let
 * it do. In Node (the tests), `setImmediate`, which has no clamp and no frames.
 */
function nextTask(): Promise<void> {
  return new Promise<void>((resolve) => {
    const g = globalThis as { setImmediate?: (f: () => void) => unknown; document?: unknown };
    if (typeof g.setImmediate === 'function' && typeof g.document === 'undefined') g.setImmediate(resolve);
    else setTimeout(resolve, 0);
  });
}

/** One render's share of the thread: when it last gave it back, and the signal that stops it. */
class Pace {
  private since = clockNow();
  constructor(private readonly signal?: AbortSignal) {}

  /** Whether the render has held the thread for a slice. */
  due(): boolean {
    return clockNow() - this.since >= SLICE_MS;
  }

  /** Give the thread back for a task; then stop here if the render was stopped meanwhile. */
  async breathe(): Promise<void> {
    await nextTask();
    this.since = clockNow();
    if (this.signal?.aborted) throw abortError();
  }
}

/** `body(from, to)` over `0..n`, a block at a time, the thread given back between blocks whenever a slice has gone by. */
async function inBlocks(n: number, pace: Pace, body: (from: number, to: number) => void): Promise<void> {
  for (let from = 0; from < n; from += BLOCK) {
    body(from, Math.min(n, from + BLOCK));
    if (pace.due()) await pace.breathe();
  }
}

/**
 * Effects already made, by what they are and the rate, so a render that
 * asks for the same cue again (the level moved, a colour changed the key but
 * not the cues) adds it in rather than synthesising it again. `synth` is pure
 * and a made effect is only ever read, so keeping one changes no sample.
 * Bounded by size, the least recently used let go first.
 */
const effects = new Map<string, Float32Array>();
const EFFECT_BYTES = 8 * 1024 * 1024;
let effectBytes = 0;

function effectOf(spec: Sfx, rate: number): Float32Array {
  const key = `${spec.kind}/${spec.d}/${spec.pitch}/${spec.rev}/${spec.seed}@${rate}`;
  const hit = effects.get(key);
  if (hit) {
    effects.delete(key);
    effects.set(key, hit);
    return hit;
  }
  const buf = synth(spec, rate);
  effects.set(key, buf);
  effectBytes += buf.byteLength;
  for (const [k, v] of effects) {
    if (effectBytes <= EFFECT_BYTES || effects.size <= 1) break;
    effects.delete(k);
    effectBytes -= v.byteLength;
  }
  return buf;
}

/**
 * The cues, made and placed: each effect synthesised once (`effectOf`), panned by an equal-power law, added in;
 * the thread given back between cues. One effect is made in one piece: the longest, a four-second riser, takes
 * about 8 ms in WebKit.
 */
async function mixCues(cues: readonly Cue[], ch: Float32Array[], rate: number, pace: Pace): Promise<void> {
  const n = ch[0].length;
  for (const c of cues) {
    const buf = effectOf({ kind: c.kind, d: c.d, pitch: c.pitch, rev: c.rev, seed: c.seed }, rate);
    const angle = ((clamp(c.pan, -1, 1) + 1) * Math.PI) / 4;
    const gl = Math.cos(angle) * c.gain;
    const gr = Math.sin(angle) * c.gain;
    const at = Math.round(c.t * rate);
    const len = Math.min(buf.length, n - at);
    for (let i = 0; i < len; i++) {
      ch[0][at + i] += buf[i] * gl;
      ch[1][at + i] += buf[i] * gr;
    }
    if (pace.due()) await pace.breathe();
  }
}

/**
 * The music last played, as the composer gave it, before it is levelled and
 * dipped: by everything the score is made from (mood, seed, length, accents)
 * and the rate, and by who played it. Moving the level re-renders the bed but
 * not the music, so the composer — which holds the thread for a good part of
 * its own work — is not asked again for the same piece. One piece is kept (at
 * most 11.5 MB, thirty seconds of stereo at 48 kHz); it is only ever read.
 */
let lastMusic: { key: string; by: MusicRenderer | null; channels: Float32Array[] } | null = null;

/** The music bed for `doc`, at the mix's place: composed, played, levelled, faded and dipped under the big effects. */
async function musicOf(doc: Motion, rate: number, n: number, cues: readonly Cue[], o: RenderSoundOptions, pace: Pace): Promise<Float32Array[] | null> {
  const seconds = secondsOf(doc);
  const mood = moodOf(doc);
  const seed = seedOf(doc);
  const accents = musicCuesOf(doc);
  const key = `${mood}|${seed}|${seconds}|${accents.join(',')}@${rate}`;
  const by = o.music ?? null;
  let got: Float32Array[];
  if (lastMusic && lastMusic.key === key && lastMusic.by === by) {
    got = lastMusic.channels;
  } else {
    const synthMod = await import('./videosynth');
    if (o.signal?.aborted) throw abortError();
    const score = synthMod.arrange({ mood, seed }, seconds, accents);
    const play: MusicRenderer = o.music ?? ((s, r, x) => synthMod.render(s, r, x));
    got = await play(score, rate, { signal: o.signal });
    if (o.signal?.aborted) throw abortError();
    if (!Array.isArray(got) || !got.length) return null;
    lastMusic = { key, by, channels: got };
  }
  await pace.breathe();
  const out: Float32Array[] = [];
  for (const c of [0, 1]) {
    const src = got[Math.min(c, got.length - 1)];
    const a = new Float32Array(n);
    if (src instanceof Float32Array) a.set(src.subarray(0, Math.min(n, src.length)));
    await inBlocks(n, pace, (from, to) => {
      for (let i = from; i < to; i++) if (!Number.isFinite(a[i])) a[i] = 0;
    });
    out.push(a);
  }
  // Only the loudness is wanted here: the true peak, which costs ten times the rest in WebKit, is not measured.
  await pace.breathe();
  const m = measureLoudness(out, rate, { truePeak: false });
  if (!Number.isFinite(m.lufs)) return null;
  if (pace.due()) await pace.breathe();
  const level = clamp(Math.pow(10, (MUSIC_REF_LUFS - m.lufs) / 20), 0.001, 30);
  // One gain curve: the level, the two fades and the dips, applied in one pass.
  const g = new Float32Array(n).fill(level);
  const fin = Math.min(n, Math.round(MUSIC_FADE_IN * rate));
  for (let i = 0; i < fin; i++) g[i] *= Math.pow(Math.sin((Math.PI / 2) * (i / fin)), 2);
  const fout = Math.min(n, Math.round(Math.min(1.2, 0.15 * seconds) * rate));
  for (let i = 0; i < fout; i++) g[n - 1 - i] *= Math.pow(Math.sin((Math.PI / 2) * (i / fout)), 2);
  const dip = new Float32Array(n).fill(1);
  for (const c of cues) {
    if (c.gain < 0.6 || (c.kind !== 'impact' && c.kind !== 'whoosh' && c.kind !== 'riser')) continue;
    const hold = c.kind === 'riser' ? c.d : DUCK_HOLD;
    const a = c.t - DUCK_ATTACK;
    const from = Math.max(0, Math.floor(a * rate));
    const to = Math.min(n, Math.ceil((c.t + hold + DUCK_RELEASE) * rate));
    for (let i = from; i < to; i++) {
      const t = i / rate;
      const depth = t < c.t ? (t - a) / DUCK_ATTACK : t < c.t + hold ? 1 : 1 - (t - c.t - hold) / DUCK_RELEASE;
      const v = 1 - (1 - DUCK) * clamp(depth, 0, 1);
      if (v < dip[i]) dip[i] = v;
    }
    if (pace.due()) await pace.breathe();
  }
  for (const a of out) {
    await inBlocks(n, pace, (from, to) => {
      for (let i = from; i < to; i++) a[i] *= g[i] * dip[i];
    });
  }
  return out;
}

/** Taps on each side of the gap a point between two samples is estimated from. */
const HALF_TAPS = 6;

/**
 * Twelve-tap windowed-sinc kernels for the wave a quarter, a half and three
 * quarters of the way from one sample to the next (taps at -5..6 around the
 * first). A true-peak meter oversamples four times for the same reason: the
 * wave a player reconstructs can rise above every sample, by more than a
 * decibel near the top of the band, and the ceiling is about that wave.
 */
const BETWEEN: readonly Float64Array[] = [0.25, 0.5, 0.75].map((f) => {
  const k = new Float64Array(2 * HALF_TAPS);
  let sum = 0;
  for (let j = 1 - HALF_TAPS; j <= HALF_TAPS; j++) {
    const x = f - j;
    const sinc = Math.sin(Math.PI * x) / (Math.PI * x);
    const hann = 0.5 + 0.5 * Math.cos((Math.PI * x) / (HALF_TAPS + 0.5));
    k[j + HALF_TAPS - 1] = sinc * hann;
    sum += k[j + HALF_TAPS - 1];
  }
  for (let j = 0; j < k.length; j++) k[j] /= sum;
  return k;
});

/** The highest the reconstructed wave reaches from sample `i` up to the next, in absolute value. */
function peakNear(c: Float32Array, i: number): number {
  let m = Math.abs(c[i]);
  if (i < HALF_TAPS - 1 || i + HALF_TAPS >= c.length) return m;
  const at = i - HALF_TAPS + 1;
  for (const k of BETWEEN) {
    let v = 0;
    for (let j = 0; j < k.length; j++) v += k[j] * c[at + j];
    if (Math.abs(v) > m) m = Math.abs(v);
  }
  return m;
}

/**
 * The limiter's working arrays, one sample each: made once per bed and used by both of its passes, every
 * element written before it is read, so a bed's passes do not each leave three more arrays to be collected.
 */
interface LimitWork {
  need: Float32Array;
  ahead: Float32Array;
  q: Int32Array;
}

/**
 * Peaks held under `ceiling` (linear) without distorting them: the gain each
 * sample needs is known in advance — from the wave between the samples as
 * well as the samples (`peakNear`) — so the gain comes down smoothly over the
 * 5 ms *before* a peak instead of clipping it, and recovers over 80 ms after.
 * The look-ahead is a running minimum over the next 5 ms; averaging that over
 * the last 5 ms gives a ramp that is at the needed gain exactly when the peak
 * arrives and never above what any sample needs.
 */
async function limit(ch: Float32Array[], rate: number, ceiling: number, pace: Pace, work: LimitWork): Promise<void> {
  const n = ch[0].length;
  const w = Math.max(1, Math.round(0.005 * rate));
  const { need, ahead, q } = work;
  await inBlocks(n, pace, (from, to) => {
    for (let i = from; i < to; i++) {
      let m = 0;
      for (const c of ch) {
        // Only a sample already near the ceiling can have a wave over it beside it: the rest skip the sums.
        const a = Math.abs(c[i]);
        m = Math.max(m, a > ceiling * 0.5 || Math.abs(c[i + 1] ?? 0) > ceiling * 0.5 ? peakNear(c, i) : a);
      }
      need[i] = m > ceiling ? ceiling / m : 1;
    }
  });
  // The wave just before sample i belongs to sample i - 1's span: what that needs, i needs too. (From the end, a
  // block at a time, as one loop from n - 1 down to 1 would.)
  for (let to = n; to > 1; to -= BLOCK) {
    for (let i = to - 1, end = Math.max(1, to - BLOCK); i >= end; i--) if (need[i - 1] < need[i]) need[i] = need[i - 1];
    if (pace.due()) await pace.breathe();
  }
  // The least gain needed anywhere in [i, i + w], by a monotonic queue from the end.
  let head = 0;
  let tail = 0;
  for (let to = n; to > 0; to -= BLOCK) {
    for (let i = to - 1, end = Math.max(0, to - BLOCK); i >= end; i--) {
      while (tail > head && need[q[tail - 1]] >= need[i]) tail--;
      q[tail++] = i;
      while (q[head] > i + w) head++;
      ahead[i] = need[q[head]];
    }
    if (pace.due()) await pace.breathe();
  }
  const recover = 1 - Math.exp(-1 / (0.08 * rate));
  let sum = 0;
  let g = 1;
  await inBlocks(n, pace, (from, to) => {
    for (let i = from; i < to; i++) {
      sum += ahead[i];
      if (i > w) sum -= ahead[i - w - 1];
      const smooth = sum / Math.min(i + 1, w + 1);
      g = Math.min(smooth, g + (1 - g) * recover);
      for (const c of ch) {
        const v = c[i] * g;
        c[i] = v > ceiling ? ceiling : v < -ceiling ? -ceiling : v;
      }
    }
  });
}

async function scale(ch: Float32Array[], g: number, pace: Pace): Promise<void> {
  for (const c of ch) {
    await inBlocks(c.length, pace, (from, to) => {
      for (let i = from; i < to; i++) c[i] *= g;
    });
  }
}

/**
 * Samples read on either side of a block when its true peak is measured: more than the 4x interpolator's reach
 * (`intervalPeaks` in audiocore.ts weighs samples i-7..i+8), so every point of the block is the point the whole
 * channel gives. `test/pro-perf.test.mjs` holds the interpolator to it.
 */
const PEAK_HALO = 16;

/**
 * The true peak of `ch` (linear, 4x oversampled), a block at a time: the
 * largest of `intervalPeaks` over each block, read with `PEAK_HALO` samples
 * of its neighbours so the points near its edges are the whole channel's.
 * The same points `truePeakOf` reads, each rounded to a 32-bit float (its
 * output array's type), so the answer is within a part in 2^24 of
 * `measureLoudness`'s; `finalGain` allows for that. (`truePeakOf` itself
 * takes up to ten times as long in WebKit, 160 ms for ten loud seconds, in one piece.)
 */
async function truePeakInBlocks(ch: readonly Float32Array[], pace: Pace): Promise<number> {
  let peak = 0;
  for (const x of ch) {
    const n = x.length;
    for (let from = 0; from < n; from += BLOCK) {
      const to = Math.min(n, from + BLOCK);
      const a = Math.max(0, from - PEAK_HALO);
      const p = intervalPeaks(x.subarray(a, Math.min(n, to + PEAK_HALO)));
      for (let i = from - a, end = to - a; i < end; i++) if (p[i] > peak) peak = p[i];
      if (pace.due()) await pace.breathe();
    }
  }
  return peak;
}

/** How far, in dB, the peak `truePeakInBlocks` reads may be from `measureLoudness`'s: a 32-bit rounding is 5e-7 dB. */
const PEAK_BRACKET_DB = 1e-5;

/**
 * `gainToTarget(measureLoudness(ch, rate), target, CEILING_DB)`, exactly,
 * without the meter's true-peak pass in one piece. The loudness `m` is the
 * meter's own (its true peak is not needed for it). The peak decides the gain
 * only when the ceiling binds; the gain can only fall as the peak rises, so it
 * is read at either end of the bracket around the peak measured a block at a
 * time: when the two agree (or neither lowers the bed), that is the gain the
 * meter's own peak gives. Only when the ceiling binds within a hair of this
 * peak — the limiter holds the peak a decibel under it, so in practice never —
 * is the meter run whole, as it always was.
 */
async function finalGain(ch: Float32Array[], rate: number, m: Loudness, target: number, pace: Pace): Promise<number> {
  const tp = await truePeakInBlocks(ch, pace);
  if (tp > 0) {
    const db = 20 * Math.log10(tp);
    const lo = gainToTarget({ lufs: m.lufs, peakDb: db - PEAK_BRACKET_DB }, target, CEILING_DB);
    const hi = gainToTarget({ lufs: m.lufs, peakDb: db + PEAK_BRACKET_DB }, target, CEILING_DB);
    if (lo === hi || (lo >= 1 && hi >= 1)) return lo;
  }
  return gainToTarget(measureLoudness(ch, rate), target, CEILING_DB);
}

/**
 * Brought to `target` LUFS with the peaks held: raised (by no more than
 * `boostDb`) to the target, limited, measured again and raised once more by
 * what the limiter took, limited again; then `gainToTarget`, the contract's own
 * rule, has the last word and may only lower it (`finalGain`). Faded over the
 * first 3 ms and the last 20, so the film starts and ends on silence. False
 * when there is nothing to hear. The measurements in between want only the
 * loudness, so they skip the true peak.
 */
async function finish(ch: Float32Array[], rate: number, target: number, boostDb: number, pace: Pace): Promise<boolean> {
  await pace.breathe();
  let m: Loudness = measureLoudness(ch, rate, { truePeak: false });
  if (!Number.isFinite(m.lufs) || !Number.isFinite(target)) return false;
  const ceiling = Math.pow(10, PEAK_CEILING_DB / 20);
  const n0 = ch[0].length;
  const work: LimitWork = { need: new Float32Array(n0), ahead: new Float32Array(n0), q: new Int32Array(n0) };
  for (let pass = 0; pass < 2; pass++) {
    if (pace.due()) await pace.breathe();
    const db = clamp(target - m.lufs, -80, pass === 0 ? boostDb : 3);
    await scale(ch, Math.pow(10, db / 20), pace);
    await limit(ch, rate, ceiling, pace, work);
    // The meter runs in one piece (about 5 ms for ten seconds in WebKit), so it starts a slice of its own, here
    // and before each measurement.
    await pace.breathe();
    m = measureLoudness(ch, rate, { truePeak: false });
    if (!Number.isFinite(m.lufs)) return false;
    if (target - m.lufs < 0.2) break;
  }
  if (pace.due()) await pace.breathe();
  const g = await finalGain(ch, rate, m, target, pace);
  if (Number.isFinite(g) && g < 1) await scale(ch, Math.max(0, g), pace);
  const n = ch[0].length;
  const a = Math.min(n, Math.round(0.003 * rate));
  const b = Math.min(n, Math.round(0.02 * rate));
  for (const c of ch) {
    for (let i = 0; i < a; i++) c[i] *= i / a;
    for (let i = 0; i < b; i++) c[n - 1 - i] *= i / b;
    await inBlocks(n, pace, (from, to) => {
      for (let i = from; i < to; i++) if (!Number.isFinite(c[i])) c[i] = 0;
    });
  }
  return true;
}

/** Beds already made, by key and rate: the preview asks for the same one again on every play. Bounded by size. */
const kept = new Map<string, SoundBed | null>();
const KEPT_BYTES = 32 * 1024 * 1024;

function keep(key: string, bed: SoundBed | null): void {
  kept.delete(key);
  kept.set(key, bed);
  const bytes = () => [...kept.values()].reduce((s, b) => s + (b ? b.channels.reduce((x, c) => x + c.byteLength, 0) : 0), 0);
  while (kept.size > 1 && bytes() > KEPT_BYTES) kept.delete(kept.keys().next().value as string);
}

/** A bed the caller may change: the kept one stays as it was made. */
const copyOf = (b: SoundBed): SoundBed => ({ channels: b.channels.map((c) => c.slice()), sampleRate: b.sampleRate });

/**
 * Render the whole sound of `doc` to PCM, or `null` when it has none: the
 * mode is off, the level is 0, or (Effects) the animation asks for no sound.
 *
 * Two channels at `sampleRate` (48 kHz by default), exactly
 * `round(doc.seconds × sampleRate)` samples long, so it lines up with the
 * film frame for frame. Effects and music are mixed, the music dipped under
 * the big effects, and the whole brought to `loudnessFor(level)` (−16 LUFS by
 * default) with the peaks under −1.5 dB, through `loudness.ts`.
 *
 * Abortable at every stage (an `AbortError` is thrown). Music needs Web
 * Audio: where there is none, asking for it throws rather than quietly
 * leaving it out. A bed is kept by `soundKey` and rate, so asking again is
 * immediate; each caller gets its own copy.
 *
 * It shares the thread (see "sharing the thread" above): no pass holds it for
 * much more than `SLICE_MS`, except what is done in one piece elsewhere — the
 * composer's own work in videosynth.ts, the loudness meter's K-weighted pass
 * (about 5 ms for ten seconds), and one effect's synthesis.
 */
export async function renderSoundBed(doc: Motion, o: RenderSoundOptions = {}): Promise<SoundBed | null> {
  if (o.signal?.aborted) throw abortError();
  const spec = readSound(doc?.sound);
  if (!audible(spec)) return null;
  const rate = clamp(Math.round(finite(o.sampleRate, DEFAULT_RATE)), 8000, 192000);
  const n = Math.max(1, Math.round(secondsOf(doc) * rate));
  // A bed played by another renderer is not the app's bed, and is not kept as one.
  const key = o.music ? '' : `${soundKey(doc)}@${rate}`;
  if (key && kept.has(key)) {
    const hit = kept.get(key) ?? null;
    return hit ? copyOf(hit) : null;
  }
  const pace = new Pace(o.signal);
  const cues = spec.mode === 'music' ? [] : soundCues(doc);
  const ch = [new Float32Array(n), new Float32Array(n)];
  if (cues.length) await mixCues(cues, ch, rate, pace);
  if (o.signal?.aborted) throw abortError();
  let music = false;
  if (spec.mode === 'music' || spec.mode === 'both') {
    let bed: Float32Array[] | null = null;
    try {
      bed = await musicOf(doc, rate, n, cues, o, pace);
    } catch (e) {
      if (isAbort(e) || o.signal?.aborted) throw abortError();
      throw e;
    }
    if (bed) {
      for (let c = 0; c < 2; c++) {
        const into = ch[c];
        const from = bed[c];
        await inBlocks(n, pace, (a, b) => {
          for (let i = a; i < b; i++) into[i] += from[i];
        });
      }
      music = true;
    }
  }
  if (!cues.length && !music) {
    if (key) keep(key, null);
    return null;
  }
  if (!(await finish(ch, rate, loudnessFor(spec.level), music ? BOOST_MUSIC_DB : BOOST_FX_DB, pace))) {
    if (key) keep(key, null);
    return null;
  }
  const bed: SoundBed = { channels: ch, sampleRate: rate };
  if (key) keep(key, bed);
  return copyOf(bed);
}
