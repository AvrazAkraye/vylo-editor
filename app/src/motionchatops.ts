/**
 * Changing a motion graphic by asking: the only road from what the model says
 * to a graphic that already exists, when the person says "faster", "put it in
 * Arabic", "make the title red" or "turn it into a lower third".
 *
 * The same design as the Video and Slides chats (videochatops.ts,
 * slideschatops.ts). The model answers with a sentence for the person and a
 * list of operations; this file checks every one and applies those that are
 * valid, in order, to one draft — so a whole answer is one graphic, one step
 * that one undo takes back. motionai.ts asks and reads the answer; everything
 * here is pure and tested without a model (test/motionchatops.test.mjs).
 *
 * ## The model writes operations, never code
 *
 * Every op is one of `OPS`, with plain fields: a word from a list, a number, a
 * few words. Each goes through the same door as the person's own edits
 * (motionedit.ts), and so through `readLayer` and `readMotion`: every number
 * clamped, every word on its list, a picture only ever a `data:image/` URL. An
 * op that is not one of `OPS`, names a layer or a field that is not there, or
 * holds nothing that reads, is skipped with a reason the panel can say, never
 * guessed at. Nothing here writes anywhere: the result is a value.
 *
 * ## A template stays a template while it can
 *
 * A graphic made from a template is rebuilt from its recipe when its words,
 * shape, language or length change (motiontemplates.ts), so `fields`,
 * `format`, `lang` and `seconds` keep the designer's layout for every shape.
 * `layer`, `add`, `remove` and `speed` edit the layers themselves, and that
 * ends the template (motionedit.ts `detach`): the person is told (`detached`),
 * and the model is told to reach for them only for what fields cannot say. An
 * answer's ops on the template are applied before its hand edits, whatever
 * order it wrote them in (`inOrder`), so "faster, and a new title" gets both.
 *
 * ## No figure the person did not give
 *
 * A figure the graphic draws as a number — a template's number field and the
 * items of a data template's list (a big number, a chart, three stats), each
 * read as the template itself reads it, a counter's or a chart layer's values,
 * and any digits in the prefix, suffix or unit drawn against them — must be
 * one the person gave: in their first request, in this message, or already in
 * the graphic. `numbersIn` reads numbers in any of the digits and groupings
 * people write them in. A number from nowhere is not written: the field keeps
 * what it had (`unsourced`), and where it had nothing it gets the template's
 * example (`sample`), which the panel asks the person to replace. The same
 * rule, with no graphic to keep numbers from, reads a planned graphic
 * (motionai.ts `parsePlan`).
 *
 * A bar chart race draws a number for every period, so every number of its
 * line is a figure (`Rome: 12, 18, 25`, read as the template reads it), and so
 * is every earlier value a chart keeps in a datum's label (`Rome|12 18 25`,
 * motioncharts.ts `raceSeries`) — whatever the chart's kind, so a number cannot
 * be hidden in a bar chart's label and shown by turning it into a race. A price
 * card's price is a figure too: the number it counts up to, and any other
 * digits written in the field.
 *
 * That is the whole of the check. Where a countdown starts is a choice about
 * the graphic, not a claim, and is not held to it; and words are not read for
 * numbers at all — a figure written into a headline, a label or a text layer
 * is kept out only by the prompt, which forbids it.
 *
 * ## One language at a time
 *
 * A `lang` op changes the reading direction, the digits and the fonts — not
 * the words. It is applied only when the words, after the same answer's other
 * ops, are written in the new language's script: a graphic whose English
 * words run right to left is worse than either language.
 *
 * ## Scenes, sound, the brand kit, the check
 *
 * Whatever a person can do to these by hand they can ask for (`PRO_OPS`), and
 * each op goes through the pure edit the buttons use: `motionscene.ts` for
 * scenes, `withSound` for sound, `applyBrand` for the brand kit, `autofix` for
 * the quality check. Their words come from closed lists — a transition's kind
 * and direction, a sound's mode and mood — and an op with one word that is not
 * on its list changes nothing: "jazz" is not a mood, and music in some other
 * mood is not what was asked for. A number that cannot mean anything there —
 * a time outside the graphic, a transition longer than any graphic, 1e308 —
 * is refused the same way; one that can is held to the edits' own limits
 * (twelve scenes, half a second each, transitions of 0.15 to 1.5 s, a level of
 * 0 to 1). A scene is named by its id or its number, counted from 1, as the
 * graphic is shown to the model. The brand kit is the person's own, saved on
 * this machine and handed in by the caller (`ApplyOptions.brand`): the op
 * carries nothing of it, so a model cannot make one up, and with none saved it
 * is refused and says so. The check repairs only what it can prove better.
 */

import { fill, type Lang } from './i18n';
import type { Dir4, Format, Layer, LayerBase, LayerKind, Motion, Palette, RecipeId, Tone } from './motiontypes';
import { DIRS, FORMAT_IDS, FORMATS, LANGUAGES, LAYER_KINDS, LIMITS, TONES } from './motiontypes';
import { META, PALETTES, type Field, type PaletteId, type PaletteInfo, type RecipeMeta } from './motionrecipe';
import { blankLayer, readLayer, readMotion, readPalette } from './motionread';
import { buildMotion, lookOf, sampleFields } from './motiontemplates';
import { itemOf, numberOf, type Item } from './motionrecipes-data';
import { addLayer, detach, removeLayer, setFields, setFormat, setLang, setPalette, setSeconds, setTitle } from './motionedit';
import { raceSeries } from './motioncharts';
import {
  NEW_SCENE, addScene, canAddScene, canSplitAt, moveScene, readScenes, removeScene, renameScene, sceneList, sceneName, setTransition, splitSceneAt,
  type SceneSpec, type TransitionChange,
} from './motionscene';
import { TRANSITIONS, TRANSITION_EASES, transitionKindOf, type TransitionEase, type TransitionKind } from './motiontransition';
import { SOUND_MODES, SOUND_MOODS, defaultSound, readSound, withSound, type SoundMode, type SoundSpec } from './motionsound';
import type { Mood } from './videosynth';
import { applyBrand, readBrand, type BrandKit } from './motionbrand';
import { autofix, checkMotion, type CheckOptions } from './motioncheck';

// ── limits ────────────────────────────────────────────────────────────────

/**
 * Ops read from one answer. A change that needs more is a new graphic, and a
 * thirteenth op is likelier a model going round in circles than a wish.
 */
export const MAX_OPS = 12;

/** Characters of one item of a list field; motiontemplates.ts cuts there too. */
const ITEM_CHARS = 80;

/** How far one `speed` op may go: four times as fast, or a quarter. */
const SPEED = { min: 0.25, max: 4 } as const;

/**
 * Values a figure takes when nobody gave one and the template has no example
 * for it: round, and plainly not anybody's result.
 */
const PLACEHOLDER: readonly number[] = [40, 70, 55, 85, 30, 65, 50, 75, 45, 60, 35, 80];

/** Two palettes nothing is written in: what a colour op falls back to where it gave no colour that reads. */
const ALL_BLACK: Palette = { bg: '#000000', fg: '#000000', accent: '#000000', accent2: '#000000', muted: '#000000' };
const ALL_WHITE: Palette = { bg: '#ffffff', fg: '#ffffff', accent: '#ffffff', accent2: '#ffffff', muted: '#ffffff' };

// ── the ops ───────────────────────────────────────────────────────────────

/** The operations the model may ask for on a graphic's template, settings and layers. */
export const OPS = ['fields', 'palette', 'seconds', 'format', 'lang', 'title', 'layer', 'add', 'remove', 'recipe', 'speed'] as const;

/**
 * The operations on what the pro pass gave a graphic (docs/PRO.md, "Words work
 * as well as buttons"): its scenes and how each arrives, its sound, the
 * person's brand kit, and the quality check's repairs. A list of their own so
 * the eleven above stay as they were; `ALL_OPS` is both, and is what the
 * prompt teaches and the reader takes. Anything else is skipped.
 */
export const PRO_OPS = [
  'scene.add', 'scene.split', 'scene.remove', 'scene.move', 'scene.transition', 'scene.rename', 'sound.set', 'brand.apply', 'check.fix',
] as const;
export const ALL_OPS = [...OPS, ...PRO_OPS] as const;
export type OpName = (typeof ALL_OPS)[number];

/** The moods music can be in, as the model is taught them. */
const MOOD_IDS: readonly Mood[] = SOUND_MOODS.map((m) => m.id);

/**
 * Each op as the model is shown it: its shape, and what it does. A record over
 * `OpName`, so an op cannot be added here without its line, and the prompt
 * (motionai.ts) is written from it rather than from a copy. The words each
 * lists are read from the tables the op is checked against.
 */
export const OP_GUIDE: Readonly<Record<OpName, string>> = {
  fields: '{"op":"fields","set":{"title":"…"}} — the template\'s words, by its field keys; fields left out stay as they are. Only while the graphic is a template.',
  palette: `{"op":"palette","id":"sunset"} — another palette; or {"op":"palette","colors":{"accent":"#FF7A45"}} to change some of its five colours (${TONES.join(' ')}).`,
  seconds: `{"op":"seconds","value":8} — the length, ${LIMITS.minSeconds} to ${LIMITS.seconds} seconds.`,
  format: `{"op":"format","value":"portrait"} — the frame: ${FORMAT_IDS.join(', ')}.`,
  lang: `{"op":"lang","value":"ar"} — the language (${LANGUAGES.join(', ')}), which sets the reading direction, the digits and the fonts. Only together with every word rewritten in it.`,
  title: '{"op":"title","value":"…"} — the graphic\'s name in the list of graphics; it is not on screen.',
  layer: '{"op":"layer","id":"<layer id>","set":{"size":12,"color":"accent","in":{"fx":"pop"}}} — change some fields of one layer. "in", "out" and "loop" merge with what they were; null removes one.',
  add: '{"op":"add","kind":"text","set":{"text":"…","pin":"bc","y":-8}} — a new layer on top (a backdrop goes to the back). Any kind but image.',
  remove: '{"op":"remove","id":"<layer id>"}',
  recipe: '{"op":"recipe","id":"lower-third","fields":{…}} — start again from another template, keeping the palette, format, length and language. Write all its fields.',
  speed: `{"op":"speed","value":1.5} — every movement 1.5 times as fast; below 1 is slower (0.7). ${SPEED.min} to ${SPEED.max}.`,
  'scene.add': `{"op":"scene.add","at":2,"name":"Offer","transition":"push"} — an empty ${NEW_SCENE} s scene after the one at "at" s (else last).`,
  'scene.split': '{"op":"scene.split","at":4.5} — cut the scene at 4.5 s in two.',
  'scene.remove': '{"op":"scene.remove","scene":"s2"} — join it to the one before.',
  'scene.move': '{"op":"scene.move","scene":"s3","to":1} — make it the first.',
  'scene.transition': `{"op":"scene.transition","scene":2,"kind":"push","d":0.5,"dir":"start"} — how it arrives: ${TRANSITIONS.join(' ')}; dir: ${DIRS.join(' ')}; d ${LIMITS.transitionMin}-${LIMITS.transitionMax}.`,
  'scene.rename': '{"op":"scene.rename","scene":"s2","name":"Offer"}',
  'sound.set': `{"op":"sound.set","mode":"music","mood":"calm","level":0.6} — mode: ${SOUND_MODES.join(' ')}; mood: ${MOOD_IDS.join(' ')}; level 0-1.`,
  'brand.apply': '{"op":"brand.apply"} — the person\'s saved brand kit.',
  'check.fix': '{"op":"check.fix"} — the quality check fixes what it can.',
};

/**
 * What an answer did, one record per change, and what it did not do and why —
 * a code and its details, so the panel says each in the interface's language.
 *
 * Applied (`Applied.notes`):
 * - `fields` — the template's words changed; `keys` are its field keys, named
 *   on screen by `META[recipe].fields[].label` (an i18n key).
 * - `palette` — re-coloured with a palette; `name` is its English name, an i18n key.
 * - `colors` — some of the five colours set one by one; `tones` says which.
 * - `seconds` — the graphic is now `value` seconds long.
 * - `format` — the frame is now `value` (landscape, portrait, square, feed).
 * - `lang` — the graphic is now in `value`.
 * - `title` — renamed to `value`.
 * - `layer` — one layer changed; `name` is the layer's own name.
 * - `add` — a layer was added.
 * - `remove` — a layer was removed.
 * - `recipe` — started again from another template; `name` is its English name, an i18n key.
 * - `speed` — every movement is `value` times as fast (below 1, slower).
 * - `detached` — the graphic is no longer a template: its layers were edited,
 *   so from now on its words are changed layer by layer, not in the fields.
 * - `sample` — a number nobody gave, or a figure that is no number at all,
 *   was replaced by an example: the person should put in the real one.
 * - `scene-add` — a new scene, the `n`th (counted from 1), called `name` ('' shows as "Scene n").
 * - `scene-split` — the scene playing at `at` seconds was cut in two; the second piece is the `n`th.
 * - `scene-remove` — the `n`th scene, `name`, was joined to its neighbour.
 * - `scene-move` — the `n`th scene, `name`, is now the `to`th.
 * - `scene-transition` — the `n`th scene now arrives with `kind` (`cut`: none).
 * - `scene-rename` — the `n`th scene is now called `name` ('': its number again).
 * - `sound` — the sound is now `mode`, at `level` (0..1), in `mood` when one was chosen.
 * - `brand` — the saved brand kit, called `name` ('' when it has none), was applied.
 * - `check` — the quality check's repairs were made, `fixes` their labels
 *   (motioncheck.ts `Fix.label`, i18n keys), and `left` tips remain for a hand.
 *
 * Skipped (`Applied.skipped`):
 * - `unknown` — `op` is not something the app can do.
 * - `invalid` — the op, or its `field`, held nothing that could be read.
 * - `no-layer` — the op names a layer, `id`, that the graphic does not have.
 * - `no-field` — `field` is not a setting of that layer or template.
 * - `not-template` — `fields` asked of a graphic that is no longer a template.
 * - `unsourced` — `field` was given a number nobody gave (a prefix, a suffix
 *   or a unit with one too): it kept its own, or, where it had none, was left
 *   out.
 * - `untranslated` — the language was not changed to `value`, because the
 *   words were not rewritten in it.
 * - `refused` — `field` held something the app never takes from a model: a
 *   picture's source, or a picture layer. A picture is only what the person
 *   brings, through the importer.
 * - `no-data` — a chart with no numbers, which would draw an empty frame.
 * - `full` — the graphic already has as many layers as it may (`LIMITS.layers`).
 * - `too-many` — `count` ops past the twelfth were not read.
 * - `no-scene` — `op` names a scene, `scene`, that the graphic does not have
 *   (a graphic that was never cut has one scene and nothing to join, move or name).
 * - `scene-limit` — `op` would pass a limit: `full`, twelve scenes or thirty
 *   seconds already; `short`, a piece shorter than half a second; `first`,
 *   the first scene, which starts the graphic and arrives with nothing.
 * - `no-brand` — no brand kit is saved, so there is none to apply.
 * - `check-clean` — the quality check found nothing at all.
 * - `check-by-hand` — it found `count` tips, and none it can repair by itself.
 */
export type Note =
  | { code: 'fields'; keys: string[] }
  | { code: 'palette'; id: PaletteId; name: string }
  | { code: 'colors'; tones: Tone[] }
  | { code: 'seconds'; value: number }
  | { code: 'format'; value: Format }
  | { code: 'lang'; value: Lang }
  | { code: 'title'; value: string }
  | { code: 'layer'; id: string; name: string }
  | { code: 'add'; id: string; name: string; kind: LayerKind }
  | { code: 'remove'; id: string; name: string }
  | { code: 'recipe'; id: RecipeId; name: string }
  | { code: 'speed'; value: number }
  | { code: 'detached' }
  | { code: 'sample' }
  | { code: 'unknown'; op: string }
  | { code: 'invalid'; op: string; field?: string }
  | { code: 'no-layer'; op: string; id: string }
  | { code: 'no-field'; op: string; field: string }
  | { code: 'not-template'; op: string }
  | { code: 'unsourced'; field: string }
  | { code: 'untranslated'; value: Lang }
  | { code: 'refused'; op: string; field: string }
  | { code: 'no-data'; op: string }
  | { code: 'full'; op: string }
  | { code: 'too-many'; count: number }
  | { code: 'scene-add'; n: number; name: string }
  | { code: 'scene-split'; at: number; n: number }
  | { code: 'scene-remove'; n: number; name: string }
  | { code: 'scene-move'; n: number; to: number; name: string }
  | { code: 'scene-transition'; n: number; name: string; kind: TransitionKind }
  | { code: 'scene-rename'; n: number; name: string }
  | { code: 'sound'; mode: SoundMode; level: number; mood?: Mood }
  | { code: 'brand'; name: string }
  | { code: 'check'; fixes: string[]; left: number }
  | { code: 'no-scene'; op: string; scene: string }
  | { code: 'scene-limit'; op: string; why: 'full' | 'short' | 'first' }
  | { code: 'no-brand' }
  | { code: 'check-clean' }
  | { code: 'check-by-hand'; count: number };

export interface Applied {
  /** The graphic after every valid op, read once more: one value, so the panel records one undo step. `m` itself when nothing changed. */
  motion: Motion;
  /** What changed, in the order it was done. */
  notes: Note[];
  /** What was not done, and why. */
  skipped: Note[];
}

/** What the ops need from the app rather than from the model. */
export interface ApplyOptions {
  /**
   * The person's saved brand kit (motionstore.ts `currentBrand`), for
   * `brand.apply`; read again here (`readBrand`). None, and the op is refused
   * and says so.
   */
  brand?: BrandKit | null;
  /** How the quality check measures words, for `check.fix`. The app passes none, so it measures as the stage draws (motioncheck.ts); a test passes its own canvas. */
  check?: CheckOptions;
}

// ── reading what the model wrote ──────────────────────────────────────────

type Rec = Record<string, unknown>;
type Entries = readonly (readonly [string, unknown])[];

const isObj = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

/** A field that is `o`'s own: never `constructor` or `__proto__` from the prototype. */
function own(o: Rec, k: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
}

/** The first of `keys` that `o` has. */
function first(o: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = own(o, k);
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * An object's own fields as a list of pairs, at most `cap`. Pairs rather than
 * an object, so a key such as `__proto__` stays a word and never becomes a
 * prototype on the way through.
 */
function entriesOf(x: unknown, cap = 64): Entries {
  if (!isObj(x)) return [];
  return Object.keys(x).slice(0, cap).map((k) => [k, own(x, k)] as const);
}

/** The pairs of an op that are not the op's own keys: a model that flattens `set` into the op. */
function restOf(o: Rec, skip: ReadonlySet<string>): Entries {
  return entriesOf(o).filter(([k]) => !skip.has(k));
}

const valueIn = (e: Entries, key: string): unknown => e.find(([k]) => k === key)?.[1];

/** A number from a field: a JSON number, or a string that is one ("8", "8s", "٨"). NaN otherwise. */
function toNumber(x: unknown): number {
  if (typeof x === 'number') return x;
  if (typeof x !== 'string' || x.length > 40) return NaN;
  const m = /^([-+]?\d+(?:[.,]\d+)?)\s*(?:x|×|s|sec|secs|seconds|%)?$/i.exec(plainDigits(x).trim());
  return m ? Number(m[1].replace(',', '.')) : NaN;
}

/**
 * Letters that are invisible or rewrite the order text is shown in: bidi
 * marks and isolates, zero-width spaces, the byte-order mark. In a graphic they
 * can only hide or scramble words. The zero-width non-joiner (U+200C) is not
 * among them: Kurdish spelling uses it.
 */
const INVISIBLE = /[\u{200B}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{FEFF}]/gu;
/** Control characters but the tab and the line break. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}]/gu;

/**
 * Letters a model writes in Kurdish that are Arabic's — ي and ى for ی, ك for
 * ک — and Kurdish's in Arabic, which a reader of either sees as foreign. The
 * same word either way; this only puts it in its language's own spelling
 * (video.ts does the same).
 */
export function inScript(s: string, lang: Lang): string {
  if (lang === 'ckb' || lang === 'kmr') return s.replace(/[\u{64A}\u{649}]/gu, '\u{6CC}').replace(/\u{643}/gu, '\u{6A9}');
  if (lang === 'ar') return s.replace(/\u{6CC}/gu, '\u{64A}').replace(/\u{6A9}/gu, '\u{643}');
  return s;
}

/**
 * Words as a graphic shows them: markup and markdown emphasis gone, invisible
 * letters gone, spaces collapsed — line breaks kept where `lines` — and in the
 * language's own spelling. Drawn on a canvas, never parsed as HTML; stripped
 * because `<b>` drawn as letters is a broken title.
 */
export function cleanWords(s: string, lines: boolean, lang: Lang): string {
  const t = s
    .slice(0, 8000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?[a-z!][^>]*>/gi, '')
    .replace(/\*\*|`/g, '')
    .replace(INVISIBLE, '')
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL, ' ');
  const out = lines
    ? t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
    : t.replace(/\s+/g, ' ').trim();
  return inScript(out, lang);
}

/** At most `max` characters, cut at a word's end when one is near: a headline cut mid-word reads as broken. */
function clip(s: string, max: number): string {
  const chars = Array.from(s);
  if (chars.length <= max) return s;
  const cut = chars.slice(0, max).join('');
  const at = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\n'));
  return (at > cut.length * 0.6 ? cut.slice(0, at) : cut).trim();
}

/** One item of a list, however the model wrote it: a line, a number, or `{ "label": …, "value": … }`. */
function itemText(x: unknown): string {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' && Number.isFinite(x)) return String(x);
  if (!isObj(x)) return '';
  const label = first(x, 'label', 'name', 'title', 'text', 'step');
  const value = first(x, 'value', 'amount', 'count', 'number');
  const l = typeof label === 'string' ? label : '';
  const v = typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' ? value : '';
  return l && v ? `${l}: ${v}` : l || v;
}

/**
 * A template field's value from whatever the model wrote for it, as the
 * document keeps it — one string — or null when nothing in it reads: a list
 * given as an array or as `{ "Q1": 40 }` becomes one item a line, a number is
 * written out, a choice must be one of its options, and every value is cleaned
 * and cut to the field's limit (characters; items for a list).
 */
function fieldText(v: unknown, f: Field, lang: Lang): string | null {
  let s: string | null = null;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number' && Number.isFinite(v)) s = String(v);
  else if (Array.isArray(v)) s = v.slice(0, 64).map(itemText).filter(Boolean).join('\n');
  else if (f.kind === 'list' && isObj(v)) s = entriesOf(v).map(([k, x]) => itemText({ label: k, value: x })).filter(Boolean).join('\n');
  if (s === null) return null;
  if (f.kind === 'choice') {
    const c = s.trim().toLowerCase();
    return f.options?.find((o) => o.toLowerCase() === c) ?? null;
  }
  if (f.kind === 'list') {
    return s.split(/\n|[;\u{61B}]/u).map((l) => clip(cleanWords(l, false, lang), ITEM_CHARS)).filter(Boolean).slice(0, f.max).join('\n');
  }
  return clip(cleanWords(s, f.kind === 'text', lang), f.max);
}

/** A template's field by its key, or by its label, whatever the case. */
function fieldNamed(fields: readonly Field[], k: string): Field | undefined {
  const s = k.trim().toLowerCase();
  return fields.find((f) => f.key === s) ?? fields.find((f) => f.label.toLowerCase() === s);
}

/**
 * A template's fields from the pairs the model wrote: only the template's own
 * keys, each read by `fieldText`. `unknown` lists the keys that are not the
 * template's, `unreadable` those whose value did not read.
 */
export function fieldsFrom(recipe: RecipeId, given: Entries, lang: Lang): { fields: Record<string, string>; unknown: string[]; unreadable: string[] } {
  const meta = META[recipe];
  const fields: Record<string, string> = {};
  const unknown: string[] = [];
  const unreadable: string[] = [];
  if (!meta) return { fields, unknown, unreadable };
  for (const [k, v] of given.slice(0, LIMITS.fields * 2)) {
    const f = fieldNamed(meta.fields, k);
    if (!f) {
      unknown.push(k.slice(0, 40));
      continue;
    }
    const s = fieldText(v, f, lang);
    if (s === null) unreadable.push(f.key);
    else fields[f.key] = s;
  }
  return { fields, unknown, unreadable };
}

const slug = (s: string) => s.trim().toLowerCase().replace(/[\s_]+/g, '-');

/** A template by its id or its English name ("Lower third", "big_title"). Read from `META`, so a new template is known here the day it is added. */
export function recipeWord(x: unknown): RecipeId | null {
  if (typeof x !== 'string' || x.length > 60) return null;
  const s = slug(x);
  const all = Object.values(META) as RecipeMeta[];
  return all.find((m) => m.id === s)?.id ?? all.find((m) => slug(m.name) === s)?.id ?? null;
}

/** A palette by its id or its English name, whatever the case. */
export function paletteWord(x: unknown): PaletteInfo | null {
  if (typeof x !== 'string' || x.length > 40) return null;
  const s = x.trim().toLowerCase();
  return PALETTES.find((p) => p.id === s || p.name.toLowerCase() === s) ?? null;
}

/** Words for a language besides its code. "Kurdish" alone is Sorani, as the rest of the app reads it. */
const LANG_WORDS: ReadonlyMap<string, Lang> = new Map<string, Lang>([
  ...LANGUAGES.map((l) => [l, l] as const),
  ['english', 'en'], ['arabic', 'ar'], ['sorani', 'ckb'], ['central kurdish', 'ckb'], ['kurdish', 'ckb'], ['kurdish sorani', 'ckb'], ['ku', 'ckb'],
  ['badini', 'kmr'], ['bahdini', 'kmr'], ['behdini', 'kmr'], ['kurmanji', 'kmr'], ['northern kurdish', 'kmr'], ['kurdish badini', 'kmr'],
]);

/** A language by its code ("ar", "ar-IQ") or its name ("Arabic", "Kurdish (Sorani)"), or null. */
export function langWord(x: unknown): Lang | null {
  if (typeof x !== 'string' || x.length > 40) return null;
  const s = x.trim().toLowerCase().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  return LANG_WORDS.get(s) ?? LANG_WORDS.get(s.split(/[-_]/)[0]) ?? null;
}

const FORMAT_WORDS: ReadonlyMap<string, Format> = new Map<string, Format>([
  ['horizontal', 'landscape'], ['wide', 'landscape'], ['widescreen', 'landscape'], ['youtube', 'landscape'],
  ['vertical', 'portrait'], ['story', 'portrait'], ['stories', 'portrait'], ['reel', 'portrait'], ['reels', 'portrait'], ['tiktok', 'portrait'], ['shorts', 'portrait'],
]);

/** A frame by its name, its ratio ("9:16") or a word people use for it ("vertical"), or null. */
export function formatWord(x: unknown): Format | null {
  if (typeof x !== 'string' || x.length > 40) return null;
  const s = x.trim().toLowerCase();
  if ((FORMAT_IDS as readonly string[]).includes(s)) return s as Format;
  return FORMAT_IDS.find((f) => FORMATS[f].ratio === s.replace(/\s/g, '')) ?? FORMAT_WORDS.get(s) ?? null;
}

const KIND_WORDS: ReadonlyMap<string, LayerKind> = new Map<string, LayerKind>([
  ['words', 'text'], ['title', 'text'], ['label', 'text'], ['number', 'counter'], ['count', 'counter'], ['background', 'backdrop'],
  ['bg', 'backdrop'], ['confetti', 'particles'], ['particle', 'particles'], ['picture', 'image'], ['photo', 'image'], ['graph', 'chart'],
]);

/** A layer kind by its name, or a word a model uses for one ("background", "number"). */
export function kindWord(x: unknown): LayerKind | null {
  if (typeof x !== 'string' || x.length > 20) return null;
  const s = x.trim().toLowerCase();
  return (LAYER_KINDS as readonly string[]).includes(s) ? s as LayerKind : KIND_WORDS.get(s) ?? null;
}

// ── numbers nobody gave ───────────────────────────────────────────────────

/**
 * Digits as 0-9 whatever script they were typed in — Arabic-Indic (٠-٩),
 * Persian (۰-۹), full-width (０-９) — and the Arabic and full-width decimal
 * and thousands signs as `.` and `,`: numbers as the data templates read them
 * (motionrecipes-data.ts `numberOf`), which is what the rule has to see.
 */
function latinDigits(s: string): string {
  return s
    .replace(/[\u{660}-\u{669}\u{6F0}-\u{6F9}\u{FF10}-\u{FF19}]/gu, (d) => {
      const c = d.charCodeAt(0);
      return String(c - (c >= 0xff10 ? 0xff10 : c >= 0x6f0 ? 0x6f0 : 0x660));
    })
    .replace(/[\u{66B}\u{FF0E}]/gu, '.')
    .replace(/[\u{66C}\u{FF0C}]/gu, ',');
}

/** A zero-width non-joiner or joiner between two digits, which a Kurdish keyboard can leave inside a number. */
const JOINER = /(\d)[\u{200C}\u{200D}]+(?=\d)/gu;
/** A space that groups a number — before exactly three digits, a plain, no-break, narrow or thin one: `1 200` — as the templates read it. */
const GROUP_SPACE = /(\d)[ \u{A0}\u{202F}\u{2009}](?=\d{3}(?!\d))/gu;

/** `latinDigits`, with a joiner inside a number taken out: one number, as the templates read it. */
const plainDigits = (s: string) => latinDigits(s).replace(JOINER, '$1');

const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * The ways one written number can be meant, each as `String(Number(…))`:
 * "1,200" is 1200 (or 1.2, where a comma is the decimal point), "1.5" is 1.5,
 * "1,234.5" is 1234.5, and "29.09.2026", which is no one number, is its parts.
 * Kept in a set, so a pasted row of forty thousand numbers joined by commas
 * costs one pass, not one pass for every number.
 */
function readingsOf(raw: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) out.add(String(n));
  };
  const seps = raw.replace(/\d/g, '');
  const groups = raw.split(/[.,]/);
  if (!seps) add(raw);
  else if (new Set(seps).size === 1) {
    if (groups.slice(1).every((g) => g.length === 3)) add(groups.join(''));
    if (seps.length === 1) add(raw.replace(',', '.'));
  } else {
    const at = raw.lastIndexOf(seps[seps.length - 1]);
    add(`${raw.slice(0, at).replace(/[.,]/g, '')}.${raw.slice(at + 1)}`);
  }
  if (!out.size) groups.forEach(add);
  return [...out];
}

/**
 * Every number written in `text`, every way it can be read: in any of the
 * digits above, grouped with `,` `٬` `.` or spaces, with `.` `,` or `٫` for
 * the decimal point. A number grouped by spaces, or with a joiner inside, is
 * both the number the templates read ("1 200" is 1200) and the numbers a
 * sentence may mean by it (1 and 200): being lenient here only spares the
 * person a false alarm. "3k" is 3, not 3000: a number is the digits the
 * person wrote, never a sum made from them.
 */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const read = (s: string) => {
    for (const m of s.matchAll(NUMBER)) for (const r of readingsOf(m[0])) out.add(r);
  };
  const plain = latinDigits(typeof text === 'string' ? text : '');
  read(plain);
  const joined = plain.replace(JOINER, '$1').replace(GROUP_SPACE, '$1');
  if (joined !== plain) read(joined);
  return out;
}

const hasNumber = (n: number, known: ReadonlySet<string>) => known.has(String(Math.abs(n)));

/**
 * A number field's value in one spelling — ASCII digits, a point for the
 * decimal, no grouping — when it is only a number: "١٬٢٠٠" and "1,200" are
 * both "1200". The reading the person gave wins where there are two.
 */
function plainNumber(v: string, known: ReadonlySet<string>): string | null {
  const m = /^([-+]?)\s*(\d+(?:[.,]\d+)*)$/.exec(plainDigits(v).trim());
  if (!m) return null;
  const rs = readingsOf(m[2]);
  const r = rs.find((x) => known.has(x)) ?? rs[0];
  return r === undefined ? null : `${m[1] === '-' ? '-' : ''}${r}`;
}

/** The fields and layer fields drawn right against a number, and the side of it each is on. */
const AFFIX_SIDE: ReadonlyMap<string, 'before' | 'after'> = new Map([['prefix', 'before'], ['suffix', 'after'], ['unit', 'after']]);

/**
 * Whether a prefix, a suffix or a unit — drawn right against a number — adds
 * no number nobody gave. Digits against the number would be read as more of
 * it ("5" with the suffix "000" is 5000; the prefix "1 " before 200 reads as
 * 1 200), so none may touch it; any other number in it must be one somebody
 * gave.
 */
function affixSourced(affix: string, side: 'before' | 'after', known: ReadonlySet<string>): boolean {
  const s = plainDigits(affix).trim();
  if (!/\d/.test(s)) return true;
  if (side === 'before' ? /\d[.,]?$/.test(s) : /^[.,]?\d/.test(s)) return false;
  for (const m of s.matchAll(NUMBER)) if (!readingsOf(m[0]).some((r) => known.has(r))) return false;
  return true;
}

/** A line of a list with its number replaced by `n`: the label as the template reads it, then `n` with the marks the number was written with. */
function lineWith(item: Item, n: number): string {
  const after = item.suffix ? (/^\p{L}/u.test(item.suffix) ? ` ${item.suffix}` : item.suffix) : '';
  const figure = `${item.prefix}${n}${item.percent ? '%' : ''}${after}`;
  return item.label ? `${item.label}: ${figure}` : figure;
}

/**
 * Fields whose figures the generic rules below would not see, by template:
 * a race's line holds a value for every period, not one; a price card's price
 * is a `line` (so the currency and the period can be typed) that it draws as a
 * number counting up.
 */
const FIGURE_FIELDS: Readonly<Record<string, Readonly<Record<string, 'race' | 'price'>>>> = {
  'bar-race': { items: 'race' },
  'price-card': { price: 'price' },
};

/** Which of a template's fields hold figures: a `number` field, a list in a data template ("Label: value" a line), a race's lines, a price. */
function figuresIn(recipe: RecipeId, f: Field): 'one' | 'list' | 'race' | 'price' | null {
  // Where a countdown starts is a choice about the graphic, not a claim about the world:
  // "a countdown" with no number is still 3, 2, 1, and needs no notice that its number is an example.
  if (recipe === 'countdown' && f.key === 'from') return null;
  const special = Object.prototype.hasOwnProperty.call(FIGURE_FIELDS, recipe) ? FIGURE_FIELDS[recipe] : undefined;
  if (special && Object.prototype.hasOwnProperty.call(special, f.key)) return special[f.key];
  if (f.kind === 'number') return 'one';
  return f.kind === 'list' && META[recipe]?.group === 'data' ? 'list' : null;
}

/** Whether every number written in `s`, in some reading of it, is one somebody gave (a number grouped by spaces read whole, as the templates read it). */
function allKnown(s: string, known: ReadonlySet<string>): boolean {
  for (const m of plainDigits(s).replace(GROUP_SPACE, '$1').matchAll(NUMBER)) if (!readingsOf(m[0]).some((r) => known.has(r))) return false;
  return true;
}

/**
 * Whether a price card's price shows only figures somebody gave: the number
 * it counts up to — read as the card reads it, `numberOf` of what comes before
 * the first slash, so `1e3` is a thousand — and every other number written in
 * the field, such as a period's ("/3 months") or one the card cannot read as a
 * figure and so draws as words ("from 19"). A price with no digits ("Free") is
 * words.
 */
function priceSourced(v: string, known: ReadonlySet<string>): boolean {
  const raw = v.trim();
  const slash = raw.indexOf('/');
  const figure = numberOf((slash >= 0 ? raw.slice(0, slash) : raw).trim());
  return (!figure || hasNumber(figure.value, known)) && allKnown(raw, known);
}

/** Where one of a racer's values ends and the next begins, as the race template splits them (motionrecipes-pro-b.ts `VALUE_SEP`). */
const VALUE_SEP = /\s*[;\u061B\u060C|]\s*|,\s+|\s+/;
/** A bullet in front of a list's line, which the templates take off before reading it. */
const BULLET = /^\s*(?:[\u2022\u00B7\u25AA\u25E6*]+|[-\u2013\u2014](?=\s))\s*/;

/**
 * A bar chart race's line as its template reads it (motionrecipes-pro-b.ts
 * `racerOf`, which is private there): the name before the first colon, or
 * before the first number, and every value after it, each read by `numberOf`
 * — `12,18,25` with no spaces is three, `1e3` is a thousand. Repeated here
 * because the rule must see every number a race draws, not only the first an
 * item has; test/pro-chatops.test.mjs builds the template and holds the two
 * readings to each other.
 */
function racerOf(line: string): { name: string; values: number[] } | null {
  const s = line.replace(BULLET, '').trim();
  const colon = s.search(/[:=\uFF1A]/);
  let name = '';
  let rest = s;
  if (colon >= 0) {
    name = s.slice(0, colon);
    rest = s.slice(colon + 1);
  } else {
    const at = s.search(/[-+]?[\d\u0660-\u0669\u06F0-\u06F9]/);
    if (at < 0) return null;
    name = s.slice(0, at);
    rest = s.slice(at);
  }
  const values: number[] = [];
  for (const word of rest.split(VALUE_SEP)) {
    if (!word) continue;
    const one = numberOf(word);
    if (one) values.push(one.value);
    else for (const part of word.split(',')) {
      const v = numberOf(part);
      if (v) values.push(v.value);
    }
  }
  const clean = name.replace(/[\s,\u060C:-]+$/, '').replace(/\s+/g, ' ').trim();
  return values.length ? { name: clean, values } : null;
}

/** A racer's line as the template reads it back: its name, a colon, its values; the name gives way first when it would be longer than a line. */
function racerLine(name: string, values: readonly number[]): string {
  const nums = values.slice(0, LIMITS.dataPoints).join(', ');
  let n = Array.from(name);
  while (n.length && n.length + 2 + nums.length > ITEM_CHARS) n = n.slice(0, -1);
  const who = n.join('').trim();
  return who ? `${who}: ${nums}` : nums;
}

/** A number as short as it can be written and still read back as exactly it (motioncharts.ts writes a race's labels so). */
function shortest(v: number): string {
  const plain = String(v);
  const exp = v.toExponential().replace('e+', 'e');
  return exp.length < plain.length && Number(exp) === v ? exp : plain;
}

/**
 * A chart datum's label with the earlier values of its race (after its last
 * bar, motioncharts.ts `raceSeries`) held to the rule: each one nobody gave
 * takes the value the datum had for that period (`was`), or a round
 * placeholder. Written back as `raceSeries` reads it, within the reader's
 * `LIMITS.label`: the name gives way first, and when even the numbers alone
 * would not fit, they are left out — a datum with no earlier values holds its
 * value from the first period, and shows no number nobody gave.
 */
function seriesSourced(
  label: string, was: { label: string; value: number } | undefined, i: number, known: ReadonlySet<string>,
): { label: string; kept: boolean; sampled: boolean } {
  const s = raceSeries(label, 0);
  const earlier = s.series.slice(0, -1);
  if (earlier.every((x) => hasNumber(x, known))) return { label, kept: false, sampled: false };
  const before = was ? raceSeries(was.label, was.value).series.slice(0, -1) : [];
  let kept = false;
  let sampled = false;
  const fixed = earlier.map((x, j) => {
    if (hasNumber(x, known)) return x;
    if (j < before.length) {
      kept = true;
      return before[j];
    }
    sampled = true;
    return PLACEHOLDER[(i + j) % PLACEHOLDER.length];
  });
  const nums = fixed.map(shortest).join(' ');
  // A bar inside the name would be read as the start of the values: written as a slash, as motioncharts.ts `raceData` writes it.
  const whole = s.name.replace(/\|/g, '/');
  let name = Array.from(whole);
  while (name.length && name.length + 1 + nums.length > LIMITS.label) name = name.slice(0, -1);
  const out = name.length + 1 + nums.length <= LIMITS.label ? `${name.join('').trimEnd()}|${nums}` : whole;
  return { label: out, kept, sampled };
}

export interface Sourcing {
  /** The fields with every number nobody gave taken out, or replaced. */
  fields: Record<string, string>;
  /** Fields not written as the answer wrote them, for showing a number nobody gave: they keep what they had, or — a prefix, a suffix, a unit — are left out. */
  kept: string[];
  /** Whether a template's example (or a round placeholder) stands in for a number nobody gave. */
  sampled: boolean;
}

/**
 * A template's fields, with the rule that a figure must be one somebody gave —
 * checked on the figure the template will draw, read by the template's own
 * reader (motionrecipes-data.ts `numberOf`, `itemOf`), so no way of writing a
 * line can show a number the check did not see.
 *
 * `known` holds the numbers the person gave (`numbersIn`). A `number` field
 * whose number is not among them — or that is no number, which would show the
 * example — is left out: merged over a graphic's fields (`before`), the field
 * keeps what it had; building a new graphic, the template's example fills it
 * (motiontemplates.ts `resolveFields`) and `sampled` says so. A list's items
 * are checked one by one: an item with a number nobody gave keeps its label
 * and takes the number the same item had before, or the example's for that
 * place, or a round placeholder. A race's line is checked number by number
 * (`racerOf`): one with any number nobody gave takes the values the same line
 * had (the whole line, when its name is the same), or round placeholders. A
 * price card's price is held as a number field is (`priceSourced`). A prefix,
 * suffix or unit with digits nobody gave, or digits against the number, is
 * left out. A field the answer wrote as it already was is not checked again.
 * Numbers that pass are written in one spelling (`plainNumber`) when the field
 * is only a number.
 */
export function sourcedFields(
  recipe: RecipeId, given: Readonly<Record<string, string>>, before: Readonly<Record<string, string>> | null, known: ReadonlySet<string>, lang: Lang,
): Sourcing {
  const meta = META[recipe];
  const fields: Record<string, string> = { ...given };
  const kept: string[] = [];
  let sampled = false;
  if (!meta) return { fields, kept, sampled };
  const example = sampleFields(recipe, lang);
  const had = (key: string) => (before && typeof before[key] === 'string' ? before[key] : undefined);
  for (const f of meta.fields) {
    const v = fields[f.key];
    if (typeof v !== 'string' || v === had(f.key)) continue;
    const side = meta.group === 'data' ? AFFIX_SIDE.get(f.key) : undefined;
    if (side) {
      if (!affixSourced(v, side, known)) {
        delete fields[f.key];
        kept.push(f.key);
      }
      continue;
    }
    const figures = figuresIn(recipe, f);
    if (figures === 'one') {
      const plain = plainNumber(v, known) ?? v;
      const figure = numberOf(plain);
      if (figure && hasNumber(figure.value, known)) {
        fields[f.key] = plain;
        continue;
      }
      delete fields[f.key];
      if (had(f.key) !== undefined) kept.push(f.key);
      else sampled = true;
    } else if (figures === 'price') {
      if (priceSourced(v, known)) continue;
      delete fields[f.key];
      if (had(f.key) !== undefined) kept.push(f.key);
      else sampled = true;
    } else if (figures === 'race') {
      const was = (had(f.key) ?? '').split('\n');
      let keptOne = false;
      fields[f.key] = v.split('\n').map((whole, i) => {
        const line = Array.from(whole).slice(0, ITEM_CHARS).join('');
        const racer = racerOf(line);
        if (!racer || racer.values.every((x) => hasNumber(x, known))) return line;
        const prev = i < was.length ? racerOf(was[i]) : null;
        if (prev) {
          keptOne = true;
          const renamed = racerLine(racer.name, prev.values);
          return prev.name === racer.name || racerOf(renamed)?.values.length !== prev.values.length ? was[i] : renamed;
        }
        sampled = true;
        return racerLine(racer.name, racer.values.slice(0, LIMITS.dataPoints).map((_, j) => PLACEHOLDER[(i + j) % PLACEHOLDER.length]));
      }).join('\n');
      if (keptOne) kept.push(f.key);
    } else if (figures === 'list') {
      const was = (had(f.key) ?? '').split('\n');
      const samples = (example[f.key] ?? '').split('\n').map(itemOf).filter((x): x is Item => x !== null);
      let keptOne = false;
      fields[f.key] = v.split('\n').map((whole, i) => {
        // What the template reads of a line: its first ITEM_CHARS characters (motiontemplates.ts `fitted`).
        const line = Array.from(whole).slice(0, ITEM_CHARS).join('');
        const item = itemOf(line);
        if (!item || hasNumber(item.value, known)) return line;
        const prev = i < was.length ? itemOf(was[i]) : null;
        if (prev) {
          keptOne = true;
          return prev.label === item.label ? was[i] : lineWith(item, prev.value);
        }
        sampled = true;
        return lineWith(item, samples.length ? samples[i % samples.length].value : PLACEHOLDER[i % PLACEHOLDER.length]);
      }).join('\n');
      if (keptOne) kept.push(f.key);
    }
  }
  return { fields, kept, sampled };
}

/**
 * A counter's or a chart's numbers, with the same rule: a counter rolls up to
 * a number somebody gave, and a chart shows values somebody gave — its values
 * and the earlier values of a race (`seriesSourced`). A number
 * from nowhere is put back to what the layer had (`was`), or, on a new layer,
 * a round placeholder — 100 for a counter — so `sampled` says the person has
 * numbers to put in. A counter that starts from anything but 0 is held to the
 * rule too; 0 is where counting starts, not a claim. A counter's prefix and
 * suffix and a chart's unit are drawn against the number and held to it as a
 * template's are (`affixSourced`): with a number nobody gave, the layer keeps
 * its own, or has none.
 */
export function sourcedLayer(l: Layer, was: Layer | null, known: ReadonlySet<string>): { layer: Layer; kept: string[]; sampled: boolean } {
  const kept: string[] = [];
  let sampled = false;
  const affix = (key: 'prefix' | 'suffix' | 'unit', now: string, had: string | undefined): string => {
    if (now === had || affixSourced(now, AFFIX_SIDE.get(key) ?? 'after', known)) return now;
    kept.push(key);
    return had ?? '';
  };
  if (l.kind === 'counter') {
    let { from, to } = l;
    if (!hasNumber(to, known)) {
      if (was?.kind === 'counter') {
        to = was.to;
        kept.push('to');
      } else {
        to = 100;
        sampled = true;
      }
    }
    if (from !== 0 && !hasNumber(from, known)) {
      if (was?.kind === 'counter') {
        from = was.from;
        kept.push('from');
      } else from = 0;
    }
    const prev = was?.kind === 'counter' ? was : null;
    const prefix = affix('prefix', l.prefix, prev?.prefix);
    const suffix = affix('suffix', l.suffix, prev?.suffix);
    const same = from === l.from && to === l.to && prefix === l.prefix && suffix === l.suffix;
    return { layer: same ? l : { ...l, from, to, prefix, suffix }, kept, sampled };
  }
  if (l.kind === 'chart') {
    let touched = false;
    const data = l.data.map((d, i) => {
      const old = was?.kind === 'chart' ? was.data[i] : undefined;
      // A race's earlier values, kept in the label after its bar, are figures whatever the chart's kind is now.
      const series = seriesSourced(d.label, old, i, known);
      if (series.kept && !kept.includes('data')) kept.push('data');
      if (series.sampled) sampled = true;
      const next = series.label === d.label ? d : { ...d, label: series.label };
      if (hasNumber(d.value, known)) {
        if (next !== d) touched = true;
        return next;
      }
      touched = true;
      if (old) {
        if (!kept.includes('data')) kept.push('data');
        return { ...next, value: old.value };
      }
      sampled = true;
      return { ...next, value: PLACEHOLDER[i % PLACEHOLDER.length] };
    });
    const unit = affix('unit', l.unit, was?.kind === 'chart' ? was.unit : undefined);
    return { layer: touched || unit !== l.unit ? { ...l, data, unit } : l, kept, sampled };
  }
  return { layer: l, kept, sampled };
}

/** Every word and number a graphic shows: where a number the model repeats may have come from. */
function textOf(m: Motion): string {
  const parts: string[] = [m.title];
  if (m.recipe) for (const k of Object.keys(m.recipe.fields)) parts.push(m.recipe.fields[k]);
  for (const l of m.layers) {
    if (l.kind === 'text') parts.push(l.text);
    else if (l.kind === 'counter') parts.push(l.prefix, String(l.from), String(l.to), l.suffix);
    else if (l.kind === 'chart') parts.push(l.unit, ...l.data.map((d) => `${d.label} ${d.value}`));
  }
  return parts.join('\n');
}

// ── layers ────────────────────────────────────────────────────────────────

type KindOf<K extends LayerKind> = Extract<Layer, { kind: K }>;

/** Fields a layer may have that a blank one leaves out: motiontypes.ts's optional ones, typed so a renamed field fails to compile. */
const BASE_OPTIONAL: readonly (keyof LayerBase)[] = ['in', 'out', 'loop', 'shadow', 'blend', 'hidden', 'locked'];
const KIND_OPTIONAL: { readonly [K in LayerKind]: readonly (keyof KindOf<K>)[] } = {
  text: ['hi', 'hiColor', 'hiStyle', 'outline'], shape: ['stroke', 'd'], icon: ['badge'], image: [], counter: [], chart: [], backdrop: [], particles: [],
};

/** Fields that are objects of their own, merged with what the layer had rather than replacing it. */
const MERGED: ReadonlySet<string> = new Set(['in', 'out', 'loop', 'count', 'shadow', 'badge', 'stroke', 'outline']);

/** Other names a model gives a layer's fields. */
const LAYER_ALIASES: ReadonlyMap<string, string> = new Map([
  ['width', 'w'], ['height', 'h'], ['colour', 'color'], ['rotation', 'rot'], ['font', 'voice'], ['entrance', 'in'], ['exit', 'out'],
]);

const settable = new Map<LayerKind, ReadonlySet<string>>();

/** The fields an op may set on a layer of `kind`: a blank layer's, and the optional ones. Not its id or its kind. */
function settableOf(kind: LayerKind): ReadonlySet<string> {
  let s = settable.get(kind);
  if (!s) {
    const keys = [...Object.keys(blankLayer(kind)), ...BASE_OPTIONAL, ...(KIND_OPTIONAL[kind] as readonly string[])];
    s = new Set(keys.filter((k) => k !== 'id' && k !== 'kind'));
    settable.set(kind, s);
  }
  return s;
}

/**
 * The fields an op sets on `target`, checked one by one: only the kind's own
 * (anything else skipped, `no-field`), never a picture's source (`refused`:
 * a model draws no pictures), an entrance, exit or loop given as a bare word read as that
 * effect, the object fields merged with what the layer had, and words in the
 * graphic's spelling. The reader clamps the rest.
 */
function layerPatch(target: Layer, given: Entries, lang: Lang, op: string, skip: (n: Note) => void): Rec {
  const ok = settableOf(target.kind);
  const patch: Rec = {};
  let duration: number | null = null;
  for (const [k0, v0] of given) {
    const k = LAYER_ALIASES.get(k0) ?? k0;
    if (k === 'id' || k === 'kind') {
      if (v0 !== (k === 'id' ? target.id : target.kind)) skip({ code: 'no-field', op, field: k });
      continue;
    }
    if (k === 'duration' && Number.isFinite(toNumber(v0))) {
      duration = toNumber(v0);
      continue;
    }
    if (!ok.has(k)) {
      skip({ code: 'no-field', op, field: k0.slice(0, 40) });
      continue;
    }
    if (k === 'src') {
      skip({ code: 'refused', op, field: 'src' });
      continue;
    }
    let v = v0;
    if ((k === 'in' || k === 'out' || k === 'loop') && typeof v === 'string') v = { fx: v };
    const had = (target as unknown as Rec)[k];
    if (MERGED.has(k) && isObj(v) && isObj(had)) v = { ...had, ...v };
    if (typeof v === 'string' && (k === 'text' || k === 'hi')) v = cleanWords(v, k === 'text', lang);
    else if (typeof v === 'string' && (k === 'prefix' || k === 'suffix' || k === 'unit' || k === 'name')) v = inScript(v, lang);
    patch[k] = v;
  }
  // A duration runs from where the layer starts once the op is applied, whether the op wrote `start` before it or after.
  if (duration !== null) {
    const start = toNumber(first(patch, 'start') ?? target.start);
    patch.end = (Number.isFinite(start) ? start : target.start) + duration;
  }
  return patch;
}

/** A layer by its id, or by its name when exactly one layer has it: a model that names "Title" means that one. */
function layerIn(m: Motion, x: unknown): Layer | undefined {
  if (typeof x !== 'string' || !x.trim() || x.length > 80) return undefined;
  const s = x.trim();
  const byId = m.layers.find((l) => l.id === s);
  if (byId) return byId;
  const named = m.layers.filter((l) => l.name.trim().toLowerCase() === s.toLowerCase());
  return named.length === 1 ? named[0] : undefined;
}

/** The layer an op names, and the op's keys that named it. */
function targetOf(o: Rec): { key: string; value: unknown } {
  for (const key of ['id', 'layer', 'target']) {
    const v = own(o, key);
    if (typeof v === 'string') return { key, value: v };
  }
  return { key: 'name', value: own(o, 'name') };
}

const OP_KEYS: ReadonlySet<string> = new Set(['op', 'type', 'action', 'do']);

/** The fields an op sets: its `set` (or another name for it), or the op's other keys when the model wrote them flat. */
function setOf(o: Rec, also: readonly string[]): Entries {
  const inner = first(o, 'set', 'fields', 'changes', 'patch', 'props', 'properties', 'values');
  if (isObj(inner)) return entriesOf(inner);
  return restOf(o, new Set([...OP_KEYS, ...also]));
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Every timing inside a layer `f` times as fast: its entrance, exit and loop,
 * the stagger of its words and a chart's bars, a counter's roll, a
 * background's drift. Not when layers start and end: that is the
 * choreography, and the graphic's length is the person's.
 */
function faster(l: Layer, f: number): Rec {
  const k = 1 / f;
  const out: Rec = { ...l };
  for (const key of ['in', 'out'] as const) {
    const a = l[key];
    if (a) out[key] = { ...a, d: a.d * k, delay: a.delay * k, ...(a.gap !== undefined ? { gap: a.gap * k } : {}) };
  }
  if (l.loop) out.loop = { ...l.loop, d: l.loop.d * k };
  if (l.kind === 'counter') out.count = { ...l.count, d: l.count.d * k, delay: l.count.delay * k };
  if (l.kind === 'chart') out.gap = l.gap * k;
  if (l.kind === 'backdrop' || l.kind === 'particles') out.speed = l.speed * f;
  return out;
}

// ── the language ──────────────────────────────────────────────────────────

/** How many letters of `s` are in the Arabic script, and how many in the Latin. */
function scriptCount(s: string): { arabic: number; latin: number } {
  let arabic = 0;
  let latin = 0;
  for (const ch of s.match(/\p{L}/gu) ?? []) {
    if (/\p{Script=Arabic}/u.test(ch)) arabic += 1;
    else if (/\p{Script=Latin}/u.test(ch)) latin += 1;
  }
  return { arabic, latin };
}

/** Whether words are mostly written in the script of `lang`. Names and brands in the other script do not change that; no letters at all is ready for any. */
export function readsAs(lang: Lang, words: string): boolean {
  const c = scriptCount(words);
  if (!c.arabic && !c.latin) return true;
  return lang === 'en' ? c.latin >= c.arabic : c.arabic >= c.latin;
}

// ── scenes, sound ─────────────────────────────────────────────────────────

/**
 * Whether `n` is a number in `lo`..`hi`: what a scene op's number must be to
 * mean anything. A number inside is then held to the edit's own limits; one
 * outside — a time past the graphic, a transition longer than any graphic,
 * 1e308 — is refused, never stretched to fit.
 */
const within = (n: number, lo: number, hi: number): boolean => Number.isFinite(n) && n >= lo - 1e-9 && n <= hi + 1e-9;

/** A graphic that was never cut, as one scene: what "after the first scene" and "split" mean on it. */
const wholeOf = (m: Motion): SceneSpec => ({ id: 's1', name: '', start: 0, end: m.seconds });

/** The scene `t` seconds falls in: the last that starts at or before it. */
function sceneIndexAt(list: readonly SceneSpec[], t: number): number {
  let i = 0;
  while (i + 1 < list.length && t >= list[i + 1].start - 1e-6) i += 1;
  return i;
}

/**
 * The scene an op names, as its index in `list`: its id ("s2"), its number
 * counted from 1 (2, "2", "٢", "Scene 2"), or its name when exactly one scene
 * has it, whatever the case. -1 when it names none.
 */
function sceneIndex(list: readonly SceneSpec[], x: unknown): number {
  if (typeof x === 'number') return Number.isInteger(x) && x >= 1 && x <= list.length ? x - 1 : -1;
  if (typeof x !== 'string' || !x.trim() || x.length > 80) return -1;
  const s = x.trim();
  const byId = list.findIndex((sc) => sc.id === s);
  if (byId >= 0) return byId;
  const n = /^(?:scene\s*)?(\d{1,3})$/i.exec(plainDigits(s));
  if (n) return Number(n[1]) >= 1 && Number(n[1]) <= list.length ? Number(n[1]) - 1 : -1;
  const named = list.flatMap((sc, i) => (sc.name && sc.name.toLowerCase() === s.toLowerCase() ? [i] : []));
  return named.length === 1 ? named[0] : -1;
}

/** How a scene an op named is said back when it named none: its own words, one short line. */
function sceneWord(x: unknown): string {
  return typeof x === 'string' || typeof x === 'number' ? String(x).slice(0, 40) : '';
}

/**
 * A transition as an op gives it — its kind (a word from `TRANSITIONS`, or
 * one of the names models use for one, `crossfade`, `whip-pan`), its length,
 * its direction (`DIRS`: never left or right, which swap in Arabic) and its
 * curve — as the change `setTransition` takes; or, when a part was given that
 * is not on its list, or is no length a graphic could hold, the name of that
 * part. A length is then held to the limits, and `setTransition` holds it to
 * the two scenes beside it.
 */
function transitionChange(kind: unknown, d: unknown, dir: unknown, ease: unknown): TransitionChange | string {
  let k: TransitionKind | undefined;
  if (kind !== undefined) {
    k = transitionKindOf(kind);
    if (!k) return 'kind';
  }
  let secs: number | undefined;
  if (d !== undefined) {
    const n = toNumber(d);
    if (!within(n, 0, LIMITS.seconds)) return 'd';
    secs = Math.min(LIMITS.transitionMax, Math.max(LIMITS.transitionMin, n));
  }
  let way: Dir4 | undefined;
  if (dir !== undefined) {
    const w = str(dir).toLowerCase();
    way = (DIRS as readonly string[]).includes(w) ? w as Dir4 : undefined;
    if (!way) return 'dir';
  }
  let curve: TransitionEase | undefined;
  if (ease !== undefined) {
    const w = str(ease).toLowerCase();
    curve = (TRANSITION_EASES as readonly string[]).includes(w) ? w as TransitionEase : undefined;
    if (!curve) return 'ease';
  }
  // Written as one literal: rtl.test.mjs keeps every assignment to a `dir` property in rtl.ts.
  return { ...(k ? { kind: k } : {}), ...(secs !== undefined ? { d: secs } : {}), ...(way ? { dir: way } : {}), ...(curve ? { ease: curve } : {}) };
}

/** A transition written as a word, or as `{ kind, d, dir, ease }`: what `scene.add` takes as its `transition`. */
function transitionGiven(x: unknown): TransitionChange | string {
  if (isObj(x)) return transitionChange(first(x, 'kind', 'fx', 'type'), first(x, 'd', 'duration'), own(x, 'dir'), own(x, 'ease'));
  return transitionChange(x, undefined, undefined, undefined);
}

/** Words for a sound's mode besides its own. */
const SOUND_MODE_WORDS: ReadonlyMap<string, SoundMode> = new Map<string, SoundMode>([
  ...SOUND_MODES.map((m) => [m, m] as const),
  ['none', 'off'], ['silent', 'off'], ['silence', 'off'], ['mute', 'off'], ['no sound', 'off'],
  ['sfx', 'fx'], ['effects', 'fx'], ['effect', 'fx'], ['sound effects', 'fx'],
  ['all', 'both'], ['music and effects', 'both'], ['effects and music', 'both'], ['fx+music', 'both'], ['music+fx', 'both'],
]);

/** Words for a mood that name one of the moods (motionsound.ts reads a few more: lo-fi, chill, arabic, kurdish). */
const MOOD_WORDS: ReadonlyMap<string, Mood> = new Map<string, Mood>([
  ['upbeat', 'uplifting'], ['happy', 'uplifting'], ['cheerful', 'uplifting'], ['bright', 'uplifting'], ['positive', 'uplifting'],
  ['relaxed', 'calm'], ['relaxing', 'calm'], ['peaceful', 'calm'], ['gentle', 'calm'], ['soft', 'calm'],
  ['dramatic', 'cinematic'], ['film', 'cinematic'], ['business', 'corporate'], ['professional', 'corporate'],
  ['energetic', 'electronic'], ['techno', 'electronic'], ['edm', 'electronic'], ['lo fi', 'lofi'], ['middle eastern', 'oriental'],
]);

/** A mood from its id, its label or a word for it; undefined when it names none. */
function moodWord(x: unknown): Mood | undefined {
  if (typeof x !== 'string' || x.length > 40) return undefined;
  const s = x.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  return readSound({ mode: 'music', mood: s })?.mood ?? MOOD_WORDS.get(s) ?? SOUND_MOODS.find((m) => m.label.toLowerCase() === s)?.id;
}

/** A mood an op takes back to the template's own. */
const MOOD_RESET = /^(?:auto|default|none|template)$/i;

// ── applying ──────────────────────────────────────────────────────────────

/** Names models reach for, and the op each means. */
const OP_ALIASES: ReadonlyMap<string, OpName> = new Map<string, OpName>([
  ['set_fields', 'fields'], ['edit_fields', 'fields'], ['update_fields', 'fields'], ['words', 'fields'], ['set_words', 'fields'], ['set_text', 'fields'],
  ['set_palette', 'palette'], ['colors', 'palette'], ['colours', 'palette'], ['set_colors', 'palette'], ['set_colours', 'palette'], ['recolor', 'palette'], ['recolour', 'palette'],
  ['set_seconds', 'seconds'], ['length', 'seconds'], ['set_length', 'seconds'], ['duration', 'seconds'], ['set_duration', 'seconds'],
  ['set_format', 'format'], ['aspect', 'format'], ['ratio', 'format'],
  ['language', 'lang'], ['set_lang', 'lang'], ['set_language', 'lang'], ['translate', 'lang'],
  ['set_title', 'title'], ['rename', 'title'],
  ['edit_layer', 'layer'], ['set_layer', 'layer'], ['update_layer', 'layer'], ['change_layer', 'layer'], ['edit', 'layer'], ['update', 'layer'],
  ['add_layer', 'add'], ['new_layer', 'add'], ['insert', 'add'], ['insert_layer', 'add'], ['create', 'add'],
  ['remove_layer', 'remove'], ['delete', 'remove'], ['delete_layer', 'remove'], ['drop', 'remove'],
  ['template', 'recipe'], ['set_recipe', 'recipe'], ['set_template', 'recipe'], ['use_template', 'recipe'], ['use_recipe', 'recipe'],
  ['set_speed', 'speed'], ['pace', 'speed'], ['tempo', 'speed'],
  ['scene_add', 'scene.add'], ['add_scene', 'scene.add'], ['new_scene', 'scene.add'], ['insert_scene', 'scene.add'],
  ['scene_split', 'scene.split'], ['split_scene', 'scene.split'], ['split', 'scene.split'], ['cut_scene', 'scene.split'],
  ['scene_remove', 'scene.remove'], ['remove_scene', 'scene.remove'], ['delete_scene', 'scene.remove'], ['join_scene', 'scene.remove'], ['join_scenes', 'scene.remove'], ['merge_scenes', 'scene.remove'],
  ['scene_move', 'scene.move'], ['move_scene', 'scene.move'], ['reorder_scene', 'scene.move'],
  ['scene_transition', 'scene.transition'], ['transition', 'scene.transition'], ['set_transition', 'scene.transition'],
  ['scene_rename', 'scene.rename'], ['rename_scene', 'scene.rename'],
  ['sound_set', 'sound.set'], ['sound', 'sound.set'], ['set_sound', 'sound.set'], ['music', 'sound.set'], ['set_music', 'sound.set'], ['audio', 'sound.set'],
  ['brand_apply', 'brand.apply'], ['brand', 'brand.apply'], ['apply_brand', 'brand.apply'], ['use_brand', 'brand.apply'],
  ['check_fix', 'check.fix'], ['check', 'check.fix'], ['fix', 'check.fix'], ['tidy', 'check.fix'], ['tidy_up', 'check.fix'], ['autofix', 'check.fix'], ['fix_all', 'check.fix'],
]);

const OP_SET: ReadonlySet<string> = new Set(ALL_OPS);

interface ReadOp {
  raw: Rec;
  /** The op's name as written, lower case with underscores. */
  name: string;
  op: OpName | null;
}

function readOp(x: unknown): ReadOp {
  if (!isObj(x)) return { raw: {}, name: '', op: null };
  const n = first(x, 'op', 'type', 'action', 'do');
  const name = typeof n === 'string' ? n.trim().toLowerCase().replace(/[\s-]+/g, '_').slice(0, 40) : '';
  return { raw: x, name, op: OP_SET.has(name) ? name as OpName : OP_ALIASES.get(name) ?? null };
}

/** The ops in whatever was handed over: a list, a whole answer with a list in it, or one op. */
function opList(x: unknown): unknown[] {
  if (Array.isArray(x)) return x;
  if (!isObj(x)) return [];
  const inner = first(x, 'ops', 'operations', 'actions', 'edits', 'changes');
  if (Array.isArray(inner)) return inner;
  return first(x, 'op', 'type', 'action') !== undefined ? [x] : [];
}

/** What one op is handed besides the draft. */
interface Run {
  now: number;
  /** Numbers somebody gave: the request, this message, the graphic. */
  known: ReadonlySet<string>;
  /** The whole answer, for a `lang` op that must see the words the others write. */
  read: readonly ReadOp[];
  /** The graphic the answer was written for. */
  start: Motion;
  /** The person's saved brand kit, read; null when none is saved. */
  brand: BrandKit | null;
  /** How the quality check measures (motioncheck.ts); empty in the app. */
  check: CheckOptions;
  note(n: Note): void;
  skip(n: Note): void;
  sampled(): void;
}

type Step = (d: Motion, o: Rec, run: Run) => Motion;

/**
 * Whether the words the graphic will show once the answer's ops have run are
 * in `lang`'s script — what a `lang` op is checked against. A new template's
 * words are its fields as the answer writes them. A template's words are its
 * fields as the answer rewrites them — or, when the answer rewrites its text
 * layers instead (which ends the template), those. A composition's words are
 * its text layers as the answer rewrites, adds and removes them.
 */
function wordsReady(m: Motion, read: readonly ReadOp[], lang: Lang): boolean {
  const lastRecipe = [...read].reverse().find((r) => r.op === 'recipe');
  if (lastRecipe) {
    const id = recipeWord(first(lastRecipe.raw, 'id', 'recipe', 'template', 'value', 'name'));
    return readsAs(lang, id ? Object.values(fieldsFrom(id, entriesOf(first(lastRecipe.raw, 'fields', 'set', 'values')), m.lang).fields).join('\n') : '');
  }
  const texts = new Map<string, string>();
  for (const l of m.layers) if (l.kind === 'text') texts.set(l.id, l.text);
  let rewritten = false;
  read.forEach((r, i) => {
    if (r.op === 'remove' || r.op === 'layer') {
      const t = layerIn(m, targetOf(r.raw).value);
      if (!t) return;
      const text = valueIn(setOf(r.raw, ['id', 'layer', 'target']), 'text');
      if (r.op === 'remove') texts.delete(t.id);
      else if (t.kind === 'text' && typeof text === 'string') texts.set(t.id, text);
      else return;
      rewritten = true;
    } else if (r.op === 'add') {
      const text = valueIn(setOf(r.raw, ['kind', 'layer']), 'text');
      if (typeof text === 'string') texts.set(`+${i}`, text);
    }
  });
  const layers = [...texts.values()].join('\n');
  if (!m.recipe) return readsAs(lang, layers);
  if (rewritten && readsAs(lang, layers)) return true;
  const id = m.recipe.id;
  const meta = META[id];
  const words = new Map<string, string>(Object.entries(m.recipe.fields));
  for (const r of read) {
    if (r.op !== 'fields') continue;
    for (const [k, v] of Object.entries(fieldsFrom(id, setOf(r.raw, []), m.lang).fields)) words.set(k, v);
  }
  const wordy = [...words.entries()].filter(([k]) => {
    const f = meta?.fields.find((x) => x.key === k);
    return !f || (f.kind !== 'number' && f.kind !== 'choice');
  });
  return readsAs(lang, wordy.map(([, v]) => v).join('\n'));
}

/**
 * A draft built again from a template, keeping what the person chose that a
 * template does not decide: the name, the frame rate, the sound. Built again
 * from the same template, it keeps the brand's face and logo (`lookOf`) and
 * its scenes too, since the layout is the same; another template is another
 * layout, whose time the old cuts would split at random, so it starts as one
 * scene.
 */
function rebuilt(d: Motion, recipe: RecipeId, fields: Record<string, string>, now: number): Motion {
  const same = d.recipe?.id === recipe;
  const fresh = buildMotion({
    id: d.id, recipe, fields, lang: d.lang, format: d.format, palette: d.palette, seconds: d.seconds, now: d.created, request: d.request, ai: true,
    look: same ? lookOf(d) : null,
  });
  const out: Motion = { ...fresh, title: d.title, fps: d.fps, stage: 'ready', created: d.created, updated: now };
  const sound = readSound(d.sound);
  if (sound) out.sound = sound;
  const scenes = same ? readScenes(d.scenes, fresh.layers, fresh.seconds) : undefined;
  if (scenes) out.scenes = scenes;
  return out;
}

/**
 * Only the ops about them change a graphic's sound and scenes. A template
 * rebuilt for new words, a new shape or language (motionedit.ts `rebuild`)
 * did not carry them when this was written (docs/pro/requests/04.md, 05.md);
 * so a change that left the length as it was and dropped them has them back,
 * read for the graphic it made. Where `rebuild` carries them this changes
 * nothing; a change of length is left to motionedit.ts, which owns the rule.
 */
function carried(was: Motion, next: Motion, op: OpName): Motion {
  if (next === was || op === 'recipe' || op === 'sound.set' || op.startsWith('scene.')) return next;
  let out = next;
  const sound = readSound(was.sound);
  if (sound && next.sound === undefined) out = { ...out, sound };
  if (was.scenes && !next.scenes && next.seconds === was.seconds) {
    const scenes = readScenes(was.scenes, next.layers, next.seconds);
    if (scenes) out = { ...out, scenes };
  }
  return out;
}

/** Replace one layer of a draft, keeping its place. */
const withLayer = (d: Motion, l: Layer): Motion => ({ ...d, layers: d.layers.map((x) => (x.id === l.id ? l : x)) });

const STEPS: Readonly<Record<OpName, Step>> = {
  fields(d, o, run) {
    if (!d.recipe) {
      run.skip({ code: 'not-template', op: 'fields' });
      return d;
    }
    const r = fieldsFrom(d.recipe.id, setOf(o, []), d.lang);
    for (const k of r.unknown) run.skip({ code: 'no-field', op: 'fields', field: k });
    for (const k of r.unreadable) run.skip({ code: 'invalid', op: 'fields', field: k });
    const s = sourcedFields(d.recipe.id, r.fields, d.recipe.fields, run.known, d.lang);
    for (const k of s.kept) run.skip({ code: 'unsourced', field: k });
    if (s.sampled) run.sampled();
    const was = d.recipe.fields;
    const changed = Object.keys(s.fields).filter((k) => s.fields[k] !== was[k]);
    if (!changed.length) {
      if (!r.unknown.length && !r.unreadable.length && !s.kept.length && !Object.keys(r.fields).length) run.skip({ code: 'invalid', op: 'fields' });
      return d;
    }
    const next: Record<string, string> = {};
    for (const k of changed) next[k] = s.fields[k];
    run.note({ code: 'fields', keys: changed });
    return setFields(d, next, run.now);
  },

  palette(d, o, run) {
    const word = first(o, 'id', 'palette', 'name', 'value');
    const colours = first(o, 'colors', 'colours', 'set');
    // Compared in the reader's spelling, so '#4C8DFF' and '#4c8dff' are one colour.
    const now = readPalette(d.palette, d.palette);
    if (typeof word === 'string' && word.trim()) {
      const p = paletteWord(word);
      if (!p) {
        run.skip({ code: 'invalid', op: 'palette' });
        return d;
      }
      const next = readPalette(p.colors, d.palette);
      if (same(next, now)) return d;
      run.note({ code: 'palette', id: p.id, name: p.name });
      return setPalette(d, next, run.now);
    }
    const given = isObj(colours) ? colours : isObj(word) ? word : null;
    // A tone the op gave in a colour that reads comes out the same whatever it falls back to.
    const readable = given ? TONES.filter((t) => readPalette(given, ALL_BLACK)[t] === readPalette(given, ALL_WHITE)[t]) : [];
    if (!given || !readable.length) {
      run.skip({ code: 'invalid', op: 'palette' });
      return d;
    }
    const next = readPalette(given, d.palette);
    const tones = TONES.filter((t) => next[t] !== now[t]);
    if (!tones.length) return d;
    run.note({ code: 'colors', tones });
    return setPalette(d, next, run.now);
  },

  seconds(d, o, run) {
    const v = toNumber(first(o, 'value', 'seconds', 'length', 'duration'));
    if (!Number.isFinite(v) || v <= 0) {
      run.skip({ code: 'invalid', op: 'seconds' });
      return d;
    }
    const next = setSeconds(d, v, run.now);
    if (next.seconds === d.seconds) return d;
    run.note({ code: 'seconds', value: next.seconds });
    return next;
  },

  format(d, o, run) {
    const f = formatWord(first(o, 'value', 'format'));
    if (!f) {
      run.skip({ code: 'invalid', op: 'format' });
      return d;
    }
    if (f === d.format) return d;
    run.note({ code: 'format', value: f });
    return setFormat(d, f, run.now);
  },

  lang(d, o, run) {
    const l = langWord(first(o, 'value', 'lang', 'language'));
    if (!l) {
      run.skip({ code: 'invalid', op: 'lang' });
      return d;
    }
    if (l === d.lang) return d;
    if (!wordsReady(run.start, run.read, l)) {
      run.skip({ code: 'untranslated', value: l });
      return d;
    }
    run.note({ code: 'lang', value: l });
    return setLang(d, l, run.now);
  },

  title(d, o, run) {
    const t = first(o, 'value', 'title', 'name');
    const clean = typeof t === 'string' ? cleanWords(t, false, d.lang) : '';
    if (!clean) {
      run.skip({ code: 'invalid', op: 'title' });
      return d;
    }
    const next = setTitle(d, clean, run.now);
    if (next.title === d.title) return d;
    run.note({ code: 'title', value: next.title });
    return next;
  },

  layer(d, o, run) {
    const which = targetOf(o);
    const target = layerIn(d, which.value);
    if (!target) {
      run.skip({ code: 'no-layer', op: 'layer', id: str(which.value).slice(0, 40) });
      return d;
    }
    const patch = layerPatch(target, setOf(o, [which.key]), d.lang, 'layer', run.skip);
    if (!Object.keys(patch).length) return d;
    let next = readLayer({ ...target, ...patch, id: target.id }, { seconds: d.seconds });
    if (!next) {
      run.skip({ code: 'invalid', op: 'layer' });
      return d;
    }
    if (next.kind === 'chart' && !next.data.length) {
      run.skip({ code: 'no-data', op: 'layer' });
      return d;
    }
    const s = sourcedLayer(next, target, run.known);
    for (const k of s.kept) run.skip({ code: 'unsourced', field: k });
    if (s.sampled) run.sampled();
    next = s.layer === next ? next : readLayer(s.layer, { seconds: d.seconds }) ?? next;
    if (same(next, target)) return d;
    run.note({ code: 'layer', id: target.id, name: next.name || target.name });
    // setLayer's rule — read again, the template link dropped, stamped — with
    // the layer already read: handing it to setLayer would merge it over the
    // old one, and an entrance the op removed ("in": null) would come back.
    return { ...detach(withLayer(d, next)), updated: run.now };
  },

  add(d, o, run) {
    const inner = first(o, 'set', 'fields', 'props', 'properties', 'layer');
    const given = isObj(inner) ? entriesOf(inner) : restOf(o, new Set([...OP_KEYS, 'kind', 'layer']));
    const typed = own(o, 'op') !== undefined ? own(o, 'type') : undefined;
    const kind = kindWord(first(o, 'kind') ?? valueIn(given, 'kind') ?? (typeof inner === 'string' ? inner : undefined) ?? typed);
    if (!kind) {
      run.skip({ code: 'invalid', op: 'add' });
      return d;
    }
    if (kind === 'image') {
      run.skip({ code: 'refused', op: 'add', field: 'image' });
      return d;
    }
    if (d.layers.length >= LIMITS.layers) {
      run.skip({ code: 'full', op: 'add' });
      return d;
    }
    const patch = layerPatch(blankLayer(kind), given, d.lang, 'add', run.skip);
    const made = addLayer(d, kind, patch as Partial<Layer>, run.now);
    const layer = made.motion.layers.find((l) => l.id === made.id);
    if (!made.id || !layer) {
      run.skip({ code: 'full', op: 'add' });
      return d;
    }
    if (layer.kind === 'chart' && !layer.data.length) {
      run.skip({ code: 'no-data', op: 'add' });
      return d;
    }
    const s = sourcedLayer(layer, null, run.known);
    for (const k of s.kept) run.skip({ code: 'unsourced', field: k });
    if (s.sampled) run.sampled();
    run.note({ code: 'add', id: made.id, name: layer.name, kind });
    return s.layer === layer ? made.motion : withLayer(made.motion, readLayer(s.layer, { seconds: d.seconds }) ?? layer);
  },

  remove(d, o, run) {
    const which = targetOf(o);
    const target = layerIn(d, which.value);
    if (!target) {
      run.skip({ code: 'no-layer', op: 'remove', id: str(which.value).slice(0, 40) });
      return d;
    }
    run.note({ code: 'remove', id: target.id, name: target.name });
    return removeLayer(d, target.id, run.now);
  },

  recipe(d, o, run) {
    const id = recipeWord(first(o, 'id', 'recipe', 'template', 'value', 'name'));
    if (!id) {
      run.skip({ code: 'invalid', op: 'recipe' });
      return d;
    }
    const r = fieldsFrom(id, entriesOf(first(o, 'fields', 'set', 'values')), d.lang);
    for (const k of r.unknown) run.skip({ code: 'no-field', op: 'recipe', field: k });
    for (const k of r.unreadable) run.skip({ code: 'invalid', op: 'recipe', field: k });
    const s = sourcedFields(id, r.fields, d.recipe?.id === id ? d.recipe.fields : null, run.known, d.lang);
    for (const k of s.kept) run.skip({ code: 'unsourced', field: k });
    if (s.sampled) run.sampled();
    run.note({ code: 'recipe', id, name: META[id]?.name ?? id });
    return rebuilt(d, id, s.fields, run.now);
  },

  speed(d, o, run) {
    const v = toNumber(first(o, 'value', 'speed', 'factor', 'by', 'times'));
    if (!Number.isFinite(v) || v <= 0) {
      run.skip({ code: 'invalid', op: 'speed' });
      return d;
    }
    const f = Math.min(SPEED.max, Math.max(SPEED.min, v));
    if (Math.abs(f - 1) < 0.01) return d;
    const layers = d.layers.map((l) => readLayer(faster(l, f), { seconds: d.seconds }) ?? l);
    if (layers.every((l, i) => same(l, d.layers[i]))) return d;
    run.note({ code: 'speed', value: Math.round(f * 100) / 100 });
    return { ...detach(d), layers, updated: run.now };
  },

  // A new empty scene after the one playing at `at` seconds — or the one `after` (or `scene`) names — else after the last;
  // with a name and the way it arrives when the op gives them. Every part is read before anything changes.
  'scene.add'(d, o, run) {
    const list = sceneList(d);
    const scenes = list.length ? list : [wholeOf(d)];
    let i = scenes.length - 1;
    const ref = first(o, 'after', 'scene');
    const at = own(o, 'at');
    if (ref !== undefined) {
      i = sceneIndex(scenes, ref);
      if (i < 0) {
        run.skip({ code: 'no-scene', op: 'scene.add', scene: sceneWord(ref) });
        return d;
      }
    } else if (at !== undefined && at !== null) {
      const byId = typeof at === 'string' ? scenes.findIndex((s) => s.id === at.trim()) : -1;
      const t = toNumber(at);
      if (byId < 0 && !within(t, 0, d.seconds)) {
        run.skip({ code: 'invalid', op: 'scene.add', field: 'at' });
        return d;
      }
      i = byId >= 0 ? byId : sceneIndexAt(scenes, t);
    }
    const named = own(o, 'name') ?? own(o, 'title');
    if (named !== undefined && typeof named !== 'string') {
      run.skip({ code: 'invalid', op: 'scene.add', field: 'name' });
      return d;
    }
    const name = typeof named === 'string' ? sceneName(cleanWords(named, false, d.lang)) : '';
    const way = own(o, 'transition');
    const change = way === undefined || way === null ? null : transitionGiven(way);
    if (typeof change === 'string' || (change && !Object.keys(change).length)) {
      run.skip({ code: 'invalid', op: 'scene.add', field: typeof change === 'string' ? `transition.${change}` : 'transition' });
      return d;
    }
    if (!canAddScene(d)) {
      run.skip({ code: 'scene-limit', op: 'scene.add', why: 'full' });
      return d;
    }
    let next = addScene(d, scenes[i].start, run.now);
    const added = sceneList(next)[i + 1];
    if (next === d || !added) {
      run.skip({ code: 'scene-limit', op: 'scene.add', why: 'full' });
      return d;
    }
    if (name) next = renameScene(next, added.id, name, run.now);
    if (change) next = setTransition(next, added.id, change, run.now);
    run.note({ code: 'scene-add', n: i + 2, name });
    return next;
  },

  'scene.split'(d, o, run) {
    const t = toNumber(first(o, 'at', 'time', 't', 'seconds', 'value'));
    if (!within(t, 0, d.seconds)) {
      run.skip({ code: 'invalid', op: 'scene.split', field: 'at' });
      return d;
    }
    const at = Math.round(t * 1000) / 1000;
    const next = canSplitAt(d, at) ? splitSceneAt(d, at, run.now) : d;
    if (next === d) {
      run.skip({ code: 'scene-limit', op: 'scene.split', why: sceneList(d).length >= LIMITS.scenes ? 'full' : 'short' });
      return d;
    }
    run.note({ code: 'scene-split', at, n: sceneIndexAt(sceneList(next), at) + 1 });
    return next;
  },

  'scene.remove'(d, o, run) {
    const list = sceneList(d);
    const ref = first(o, 'scene', 'id', 'target', 'value');
    const i = sceneIndex(list, ref);
    if (i < 0) {
      run.skip({ code: 'no-scene', op: 'scene.remove', scene: sceneWord(ref) });
      return d;
    }
    const next = removeScene(d, list[i].id, run.now);
    if (next === d) return d;
    run.note({ code: 'scene-remove', n: i + 1, name: list[i].name });
    return next;
  },

  // To a place counted from 1 (`to`, or first/last), or just before or after another scene.
  'scene.move'(d, o, run) {
    const list = sceneList(d);
    const ref = first(o, 'scene', 'id', 'target');
    const i = sceneIndex(list, ref);
    if (i < 0) {
      run.skip({ code: 'no-scene', op: 'scene.move', scene: sceneWord(ref) });
      return d;
    }
    let to = -1;
    const before = own(o, 'before');
    const after = own(o, 'after');
    const place = first(o, 'to', 'place', 'position');
    if (before !== undefined || after !== undefined) {
      const r = sceneIndex(list, before ?? after);
      if (r < 0) {
        run.skip({ code: 'no-scene', op: 'scene.move', scene: sceneWord(before ?? after) });
        return d;
      }
      to = before !== undefined ? (i < r ? r - 1 : r) : (i < r ? r : r + 1);
    } else {
      const w = str(place).toLowerCase();
      const byId = typeof place === 'string' ? list.findIndex((s) => s.id === place.trim()) : -1;
      const n = toNumber(place);
      if (w === 'first' || w === 'start') to = 0;
      else if (w === 'last' || w === 'end') to = list.length - 1;
      else if (byId >= 0) to = byId;
      else if (within(n, 1, LIMITS.scenes)) to = Math.min(list.length, Math.round(n)) - 1;
      else {
        run.skip({ code: 'invalid', op: 'scene.move', field: 'to' });
        return d;
      }
    }
    to = Math.min(list.length - 1, Math.max(0, to));
    const next = to === i ? d : moveScene(d, list[i].id, to, run.now);
    if (next === d) return d;
    run.note({ code: 'scene-move', n: i + 1, to: to + 1, name: list[i].name });
    return next;
  },

  // Its kind, length, direction and curve, written flat on the op or as its `transition`; any part not on its list changes nothing.
  'scene.transition'(d, o, run) {
    const list = sceneList(d);
    const ref = first(o, 'scene', 'id', 'target');
    const i = sceneIndex(list, ref);
    if (i < 0) {
      run.skip({ code: 'no-scene', op: 'scene.transition', scene: sceneWord(ref) });
      return d;
    }
    const way = own(o, 'transition');
    const change = isObj(way)
      ? transitionGiven(way)
      : transitionChange(way ?? first(o, 'kind', 'value'), first(o, 'd', 'duration'), own(o, 'dir'), own(o, 'ease'));
    if (typeof change === 'string' || !Object.keys(change).length) {
      run.skip({ code: 'invalid', op: 'scene.transition', ...(typeof change === 'string' ? { field: change } : {}) });
      return d;
    }
    if (i === 0) {
      run.skip({ code: 'scene-limit', op: 'scene.transition', why: 'first' });
      return d;
    }
    const next = setTransition(d, list[i].id, change, run.now);
    if (next === d) return d;
    run.note({ code: 'scene-transition', n: i + 1, name: list[i].name, kind: sceneList(next)[i]?.transition?.kind ?? 'cut' });
    return next;
  },

  'scene.rename'(d, o, run) {
    const list = sceneList(d);
    const ref = first(o, 'scene', 'id', 'target');
    const i = sceneIndex(list, ref);
    if (i < 0) {
      run.skip({ code: 'no-scene', op: 'scene.rename', scene: sceneWord(ref) });
      return d;
    }
    const named = first(o, 'name', 'value', 'title');
    if (typeof named !== 'string') {
      run.skip({ code: 'invalid', op: 'scene.rename', field: 'name' });
      return d;
    }
    const name = sceneName(cleanWords(named, false, d.lang));
    const next = renameScene(d, list[i].id, name, run.now);
    if (next === d) return d;
    run.note({ code: 'scene-rename', n: i + 1, name });
    return next;
  },

  // Some of mode, mood and level over what the graphic has; a mood alone turns music on, since a mood is music's.
  'sound.set'(d, o, run) {
    const modeGiven = first(o, 'mode', 'value');
    const moodGiven = own(o, 'mood');
    const levelGiven = first(o, 'level', 'volume');
    const bad = (field: string) => {
      run.skip({ code: 'invalid', op: 'sound.set', field });
      return d;
    };
    if (modeGiven === undefined && moodGiven === undefined && levelGiven === undefined) return bad('mode');
    const mode = modeGiven === undefined ? undefined : typeof modeGiven === 'string' ? SOUND_MODE_WORDS.get(modeGiven.trim().toLowerCase()) : undefined;
    if (modeGiven !== undefined && !mode) return bad('mode');
    const reset = moodGiven === null || (typeof moodGiven === 'string' && MOOD_RESET.test(moodGiven.trim()));
    const mood = moodGiven === undefined || reset ? undefined : moodWord(moodGiven);
    if (moodGiven !== undefined && !reset && !mood) return bad('mood');
    // 0 to 1, or a percentage up to 100 (motionsound.ts reads 60 as 60%).
    const level = levelGiven === undefined ? undefined : toNumber(levelGiven);
    if (level !== undefined && !within(level, 0, 100)) return bad('level');
    const now = readSound(d.sound) ?? defaultSound();
    const on: SoundMode = mode ?? (mood && now.mode === 'off' ? 'music' : mood && now.mode === 'fx' ? 'both' : now.mode);
    const chosen = reset ? undefined : mood ?? now.mood;
    const spec: SoundSpec = {
      mode: on, level: level ?? now.level, ...(chosen ? { mood: chosen } : {}), ...(now.seed !== undefined ? { seed: now.seed } : {}),
    };
    const next = withSound(d, spec, run.now);
    if (next === d) return d;
    const s = readSound(next.sound) ?? defaultSound();
    run.note({ code: 'sound', mode: s.mode, level: s.level, ...(s.mood ? { mood: s.mood } : {}) });
    return next;
  },

  // The kit is the caller's, never the op's: whatever else the op holds is not read.
  'brand.apply'(d, _o, run) {
    if (!run.brand) {
      run.skip({ code: 'no-brand' });
      return d;
    }
    const next = applyBrand(d, run.brand, run.now);
    if (next === d) return d;
    run.note({ code: 'brand', name: run.brand.name });
    return next;
  },

  // Every repair the check can prove better (motioncheck.ts `autofix`); what it repaired is said by the repairs' own labels.
  'check.fix'(d, _o, run) {
    const found = checkMotion(d, run.check);
    if (!found.length) {
      run.skip({ code: 'check-clean' });
      return d;
    }
    const next = found.some((f) => f.fix) ? autofix(d, found, undefined, run.check) : d;
    if (next === d) {
      run.skip({ code: 'check-by-hand', count: found.length });
      return d;
    }
    const left = checkMotion(next, run.check);
    const still = new Set(left.map((f) => f.id));
    const labels = (gone: boolean) => [...new Set(found.filter((f) => f.fix && (!gone || !still.has(f.id))).map((f) => f.fix?.label ?? ''))].filter(Boolean);
    // A repair that made a tip smaller without making it go is still a repair: said by what was tried.
    const fixes = labels(true).length ? labels(true) : labels(false);
    run.note({ code: 'check', fixes, left: left.length });
    return { ...next, updated: run.now };
  },
};

/**
 * When each op is applied, in five turns: 0, the ops on the template (its
 * words, shape, length, language, palette, name, a new template); 1, the brand
 * kit, which builds the template again with the brand in it, so after its words
 * are set; 2, the sound, which nothing after it can drop; 3, the ops that edit
 * the layers by hand (which end the template) and the scenes, which cut the
 * graphic as it now is; 4, the quality check, which repairs what all of that
 * made.
 */
const TURN: Readonly<Record<OpName, number>> = {
  fields: 0, palette: 0, seconds: 0, format: 0, lang: 0, title: 0, recipe: 0,
  'brand.apply': 1,
  'sound.set': 2,
  layer: 3, add: 3, remove: 3, speed: 3,
  'scene.add': 3, 'scene.split': 3, 'scene.remove': 3, 'scene.move': 3, 'scene.transition': 3, 'scene.rename': 3,
  'check.fix': 4,
};

/**
 * The ops in the order they are applied: by `TURN`, and within a turn in the
 * order the answer wrote them (an op that is none is skipped with the first).
 * The other way round, "faster, and change the title" would end the template
 * with the first and have nothing left for the second to change; done this way
 * the words are rebuilt into the template's layout and the hand edits go on top
 * of it (layers keep their ids through a rebuild). Scenes share the hand edits'
 * turn and keep their written order with them: "add a scene, then a title in
 * it" names times in the graphic the first op made.
 */
function inOrder(read: readonly ReadOp[]): ReadOp[] {
  const turn = (r: ReadOp) => (r.op ? TURN[r.op] : 0);
  return read.map((r, i) => ({ r, i })).sort((a, b) => turn(a.r) - turn(b.r) || a.i - b.i).map((x) => x.r);
}

/** The same note twice is said once. */
function unique(list: Note[]): Note[] {
  const seen = new Set<string>();
  return list.filter((n) => {
    const k = JSON.stringify(n);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * The ops of one answer, applied to one draft of the graphic: those that work
 * on the template first, then those that edit its layers by hand (`inOrder`).
 *
 * Pure and total: whatever `ops` holds — a list, a whole answer, one op,
 * nonsense — nothing throws and nothing passed in is changed. Each op is
 * checked on its own and applied through motionedit.ts, so the model's edits
 * behave exactly as the person's do; one that cannot be applied is skipped
 * with a reason. At most `MAX_OPS` are read. `said` is the person's message,
 * one more place a number may come from; `o` what the ops on the brand kit and
 * the check need from the app (`ApplyOptions`). The result is read once more by
 * `readMotion`, so it is a graphic the rest of the studio can trust without
 * checking, and `m` itself when nothing changed.
 */
export function applyOps(m: Motion, ops: unknown, now: number = Date.now(), said = '', o: ApplyOptions = {}): Applied {
  const notes: Note[] = [];
  const skipped: Note[] = [];
  let brand: BrandKit | null = null;
  let check: CheckOptions = {};
  try {
    if (isObj(o)) {
      brand = readBrand(own(o, 'brand'));
      if (isObj(own(o, 'check'))) check = own(o, 'check') as CheckOptions;
    }
  } catch {
    /* no kit, the check's own measure */
  }
  // The list is read one entry at a time, each in its own try, into a plain array: what came back may be a
  // Proxy whose length or entries throw, or a sparse array whose holes `map` and `sort` would carry through as
  // nothing at all (a hole read as an op threw here: docs/pro/review-safety.md, R1-1).
  let count = 0;
  const firstOps: unknown[] = [];
  try {
    const list = opList(ops);
    count = Math.max(0, Math.floor(Number(list.length)) || 0);
    for (let i = 0; i < Math.min(count, MAX_OPS); i++) {
      try {
        firstOps.push(list[i]);
      } catch {
        firstOps.push(undefined);
      }
    }
  } catch {
    count = firstOps.length;
  }
  if (count > MAX_OPS) skipped.push({ code: 'too-many', count: count - MAX_OPS });
  const read = firstOps.map((x) => {
    try {
      return readOp(x);
    } catch {
      return { raw: {}, name: '', op: null } as ReadOp;
    }
  });
  const at = Number.isFinite(now) ? now : Date.now();
  let known: ReadonlySet<string> = new Set<string>();
  try {
    known = numbersIn([str(m.request), typeof said === 'string' ? said : '', textOf(m)].join('\n'));
  } catch {
    /* no number is known */
  }
  let sampled = false;
  const run: Run = {
    now: at, known, read, start: m, brand, check,
    note: (n) => { notes.push(n); },
    skip: (n) => { skipped.push(n); },
    sampled: () => { sampled = true; },
  };

  let draft = m;
  for (const r of inOrder(read)) {
    const was = draft;
    if (!r.op) {
      skipped.push(r.name ? { code: 'unknown', op: r.name } : { code: 'invalid', op: '?' });
      continue;
    }
    const kept = notes.length;
    try {
      draft = carried(was, STEPS[r.op](was, r.raw, run), r.op);
    } catch {
      // An op that trips over something is that op skipped, never the answer.
      draft = was;
      notes.length = kept;
      skipped.push({ code: 'invalid', op: r.op });
    }
    if (was.recipe && !draft.recipe) notes.push({ code: 'detached' });
  }

  if (draft === m) return { motion: m, notes: [], skipped: unique(skipped) };
  let out: Motion | null = null;
  try {
    out = readMotion({ ...draft, updated: at }, at);
  } catch {
    out = null;
  }
  if (!out) return { motion: m, notes: [], skipped: unique([...skipped, { code: 'invalid', op: '?' }]) };
  if (sampled) notes.push({ code: 'sample' });
  // A later op that started a template again undoes the detaching said earlier.
  const told = out.recipe ? notes.filter((n) => n.code !== 'detached') : notes;
  return { motion: out, notes: unique(told), skipped: unique(skipped) };
}

// ── saying what the new ops did ───────────────────────────────────────────

type T = (s: string) => string;

/**
 * Words the model or the person wrote, as a sentence carries them: one line,
 * no letter that turns text around, isolated between U+2068 and U+2069 so
 * they cannot reorder the sentence round them, at most `max` characters.
 * motionstate.ts `quoted`'s rule, repeated because that file imports this one.
 */
function isolated(s: unknown, max = 40): string {
  const one = String(s ?? '')
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim();
  const chars = Array.from(one);
  const cut = chars.length > max ? `${chars.slice(0, Math.max(1, max - 1)).join('')}…` : one;
  return `\u2068${cut}\u2069`;
}

/** A transition's name, in the words the scene strip uses (MotionScenes.tsx). */
function transitionName(k: TransitionKind, t: T): string {
  switch (k) {
    case 'fade': return t('Fade');
    case 'push': return t('Push across');
    case 'slide': return t('Slide');
    case 'iris': return t('Iris');
    case 'clock': return t('Clock wipe');
    case 'blinds': return t('Blinds');
    case 'pixelate': return t('Pixelate');
    case 'zoom': return t('Zoom');
    case 'whip': return t('Whip pan');
    case 'flash': return t('Flash');
    case 'light-leak': return t('Light leak');
    case 'glitch': return t('Glitch');
    default: return t('Cut');
  }
}

/** A sound's mode as the Sound row names it (MotionSoundPanel.tsx). */
const MODE_LABEL: Readonly<Record<SoundMode, string>> = { off: 'Off', fx: 'Effects', music: 'Music', both: 'Both' };

/** A scene as a note names it: its own name, or "Scene n" as the strip shows a scene without one. */
function sceneCalled(n: unknown, name: unknown, t: T): string {
  return typeof name === 'string' && name ? isolated(name) : fill(t('Scene {n}'), { n: Number(n) || 1 });
}

/** Seconds as a note says them: at most two decimals. */
const secs = (x: unknown) => String(Math.round((Number(x) || 0) * 100) / 100);

/**
 * The notes of the ops in `PRO_OPS`, said in the interface's language through
 * `t`; null for every other note, which motionstate.ts `noteText` says. Kept
 * beside the notes so the panel needs one line to say them all:
 * `default: return chatNoteText(n, t) ?? t('Skipped a change that could not be read');`
 * Every word that came from the model or the person is `isolated`.
 */
export function chatNoteText(n: Note, t: T): string | null {
  switch (n.code) {
    case 'scene-add': return fill(t('Added a scene: {name}'), { name: sceneCalled(n.n, n.name, t) });
    case 'scene-split': return fill(t('Cut the scene in two at {s} s'), { s: secs(n.at) });
    case 'scene-remove': return fill(t('Joined {name} with the scene beside it'), { name: sceneCalled(n.n, n.name, t) });
    case 'scene-move': return fill(t('Moved {name} to place {n}'), { name: sceneCalled(n.n, n.name, t), n: Number(n.to) || 1 });
    case 'scene-transition': return fill(t('{name} now arrives with: {kind}'), { name: sceneCalled(n.n, n.name, t), kind: transitionName(n.kind, t) });
    case 'scene-rename':
      return n.name
        ? fill(t('Scene {n} is now called {name}'), { n: Number(n.n) || 1, name: isolated(n.name) })
        : fill(t('Scene {n} has no name of its own now'), { n: Number(n.n) || 1 });
    case 'sound': {
      if (n.mode === 'off') return t('Sound off');
      const mode = Object.prototype.hasOwnProperty.call(MODE_LABEL, n.mode) ? t(MODE_LABEL[n.mode]) : t('Music');
      const mood = n.mode !== 'fx' && n.mood ? SOUND_MOODS.find((m) => m.id === n.mood)?.label : undefined;
      const level = `${Math.round(Math.min(1, Math.max(0, Number(n.level) || 0)) * 100)}%`;
      return fill(t('Sound: {how}'), { how: [mode, ...(mood ? [t(mood)] : []), level].join(' · ') });
    }
    case 'brand': return n.name ? fill(t('Applied the brand kit: {name}'), { name: isolated(n.name) }) : t('Applied the brand kit');
    case 'check': {
      const fixes = (Array.isArray(n.fixes) ? n.fixes : []).slice(0, 8).map((f) => t(String(f))).join(' · ');
      const left = Number(n.left) || 0;
      return left > 0 ? fill(t('Tidied: {fixes}. {n} tips are left for a change by hand'), { fixes, n: left }) : fill(t('Tidied: {fixes}'), { fixes });
    }
    case 'no-scene': return fill(t('Skipped: there is no scene “{scene}”'), { scene: isolated(n.scene) });
    case 'scene-limit':
      if (n.why === 'first') return t('Skipped: the first scene starts the graphic, so it arrives from nothing');
      return n.why === 'short'
        ? fill(t('A scene is cut at least {s} s from its ends, and a graphic has at most {n} scenes'), { s: LIMITS.sceneMin, n: LIMITS.scenes })
        : fill(t('No room for another scene: a graphic is at most {s} s long and has at most {n} scenes'), { s: LIMITS.seconds, n: LIMITS.scenes });
    case 'no-brand': return t('No brand kit is saved yet: set one up with the Brand kit button');
    case 'check-clean': return t('The quality check found nothing to fix');
    case 'check-by-hand': return fill(t('The quality check found {n} tips, and none it can fix by itself'), { n: Number(n.count) || 0 });
    default: return null;
  }
}
