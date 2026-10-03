import {
  BACKDROPS, BLENDS, CHARTS, DIRS, EASES, EFFECTS, FORMAT_IDS, FORMATS, FPS_CHOICES, ICON_IDS, LANGUAGES, LAYER_KINDS,
  LIMITS, LOOPS, PARTICLES, PINS, RECIPE_IDS, SHAPES, SOURCES_MAX, SPLITS, TONES, VOICES,
  type Anim, type BackdropLayer, type ChartLayer, type CounterLayer, type EaseName, type Format, type Fps,
  type Gradient, type IconLayer, type ImageLayer, type Layer, type LayerBase, type LayerKind, type LoopAnim,
  type Motion, type Paint, type Palette, type ParticlesLayer, type Pin, type RecipeRef, type Shadow,
  type ShapeLayer, type Source, type Stroke, type TextLayer,
} from './motiontypes';
import { readSound } from './motionsound';
import { readScenes } from './motionscene';
import type { Lang } from './i18n';
import {
  arcPath, arrowPath, blobPath, burstPath, ellipsePath, fitPath, parsePath, pathLength, polygonPath, rectPath, starPath, wavePath,
  type Seg,
} from './motionmath';

/**
 * Reading a motion graphic. Whatever arrives — the model's answer, a record
 * an older build stored, a file somebody edited by hand — is input, and this
 * file turns it into a `Motion` the renderer, the timeline and the exporter
 * can use without checking anything again.
 *
 * ## Repaired, never trusted, never thrown
 *
 * Every number is clamped to its range (a numeric string such as "7" is read
 * as the number the model meant), every word must be on its list in
 * motiontypes.ts or it becomes the kind's default, every colour is checked
 * and written one way, every list has its ceiling from `LIMITS`, and what
 * cannot be repaired is dropped: a layer of a kind nothing draws, a datum with
 * no number, a highlight that is not in the words it highlights. Nothing here
 * throws, whatever it is handed — a cycle, a getter that throws, ten megabytes
 * of text, `__proto__` as a key — because the panel reads every stored graphic
 * at start-up, and one bad record must cost that record, not the studio.
 *
 * ## A fixed point
 *
 * `readMotion(readMotion(x))` is `readMotion(x)`, field for field. A graphic is
 * read again every time it is opened, and a reader that moved anything the
 * second time would drift a saved graphic a little further on every launch.
 *
 * ## Nothing reaches the network, nothing is run
 *
 * A picture is kept only as a `data:image/` URL: a remote address would make
 * the renderer fetch it, and Motion makes no request of its own. A colour is a
 * token, hex, `rgb()` or `hsl()` — never `url(…)` — and a shape's path holds
 * only path letters and numbers. The model writes data; nothing it wrote is
 * code, and nothing it wrote survives unless it is one of these.
 */

// ── reading safely ────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

/** The layer type of one kind, so a template that made a text layer can set its words without a cast. */
export type LayerOf<K extends LayerKind> = Extract<Layer, { kind: K }>;

/** Entries of any list that are looked at: past every ceiling in `LIMITS`, short of what a list of a million could cost. */
const SCAN = 1000;
/** Seconds: the shortest a layer may last and the quickest an effect may run. Zero would divide by it. */
const MIN_SPAN = 0.05;
/** How large a counter's or a chart's value may be: past this, a sum of twelve of them could overflow to Infinity in the drawing code. */
const BIG = 1e12;
/** The latest moment a `Date` can hold. A larger `updated` makes formatting the date throw. */
const MAX_TIME = 8.64e15;
/** Seeds feed a 32-bit generator. */
const MAX_SEED = 2147483647;
/** What an `error` may say: a sentence or two, as the panel shows it. */
const ERROR_CHARS = 400;
/** How long a blank layer lasts: it is made before it knows the graphic it goes into, and a graphic is six seconds unless it says otherwise. */
const BLANK_SECONDS = 6;

/**
 * `x` as an object to read fields from; null for arrays, null and anything
 * else. A revoked Proxy throws even from `Array.isArray`, so the question is
 * asked inside a try.
 */
function rec(x: unknown): Rec | null {
  try {
    return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null;
  } catch {
    return null;
  }
}

/**
 * A field that is `o`'s own. Inherited names — `constructor`, `toString`,
 * `__proto__` — are on every object, and reading one as a field would hand a
 * function or a prototype to code that expects a word. A getter that throws is
 * a field that is not there.
 */
function own(o: Rec, k: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  } catch {
    return undefined;
  }
}

/** Whether a field holds anything at all. */
const present = (v: unknown): boolean => v !== undefined && v !== null;

/**
 * The first `cap` entries of `x` when it is an array, null when it is not.
 * Read one at a time, so a sparse array of length 2^32 or a Proxy that throws
 * on one index costs only what was looked at.
 */
function listOf(x: unknown, cap = SCAN): unknown[] | null {
  let n = 0;
  try {
    if (!Array.isArray(x)) return null;
    n = Math.min(x.length, cap);
  } catch {
    return null;
  }
  const list = x as unknown[];
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    try {
      out.push(list[i]);
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * `x` as a finite number, or `fallback`. A numeric string counts — a model
 * writes `"7"` as often as `7` — but only a plain decimal one: "7px", "0x10",
 * "Infinity" and "" are not numbers here.
 */
function finite(x: unknown, fallback: number): number {
  if (typeof x === 'number') return Number.isFinite(x) ? x : fallback;
  if (typeof x === 'string' && x.length <= 40) {
    const s = x.trim();
    if (NUMERIC.test(s)) {
      const n = Number(s);
      if (Number.isFinite(n)) return n;
    }
  }
  return fallback;
}

/** `x` as a number, or null when it is not one: for fields where absent and zero mean different things. */
function maybe(x: unknown): number | null {
  const n = finite(x, NaN);
  return Number.isNaN(n) ? null : n;
}

/** `x` held inside lo..hi, `fallback` (held there too) when it is not a number. -0 comes back as 0, so no field ever shows "-0". */
function num(x: unknown, lo: number, hi: number, fallback: number): number {
  return Math.min(hi, Math.max(lo, finite(x, fallback))) || 0;
}

/** A whole number inside lo..hi. */
function int(x: unknown, lo: number, hi: number, fallback: number): number {
  return Math.round(num(x, lo, hi, fallback)) || 0;
}

/** A yes or a no. Only a real boolean counts: "false" is a word, and reading a word as a no is a guess. */
function flag(x: unknown, fallback: boolean): boolean {
  return typeof x === 'boolean' ? x : fallback;
}

/**
 * One of `list`, whatever its case or surrounding space, or one of its
 * `aliases`; undefined for anything else. Long strings are not looked at: no
 * word in the vocabulary is longer than a few letters.
 */
function pick<T extends string>(x: unknown, list: readonly T[], aliases?: ReadonlyMap<string, T>): T | undefined {
  if (typeof x !== 'string' || x.length > 40) return undefined;
  const s = x.trim().toLowerCase();
  if ((list as readonly string[]).includes(s)) return s as T;
  return aliases?.get(s);
}

// ── words ─────────────────────────────────────────────────────────────────

const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
const ANY_CONTROL = /[\u0000-\u001F\u007F-\u009F]/;
const BREAKS = /\r\n?|[\u2028\u2029]/g;
/** A whole surrogate pair (kept) or half of one (dropped): a regex with no lookbehind, which older WebKit cannot parse. */
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;
const TRAILING = /[^\S\n]+$/gm;

/**
 * What every kind of words goes through: a string (or a finite number,
 * written out), cut to `room` code units before any other work so ten
 * megabytes cost nothing, every line break as `\n`, tabs as spaces, control
 * characters and half surrogate pairs gone, and composed (NFC) so the same
 * letter typed two ways is the same letter.
 */
function scrub(x: unknown, room: number): string {
  let s = typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '';
  if (s.length > room) s = s.slice(0, room);
  return s
    .replace(BREAKS, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROLS, '')
    .replace(SURROGATES, (p) => (p.length === 2 ? p : ''))
    .normalize('NFC');
}

/** At most `max` characters as a reader counts them: a surrogate pair (an emoji, a rare letter) is one, and is never cut in half. */
function capped(s: string, max: number): string {
  if (s.length <= max) return s;
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max).join('');
}

/** Room for `max` characters before scrubbing: two code units each at most, and some to spare for what scrubbing removes. */
const roomFor = (max: number) => max * 4 + 64;

/**
 * Words as they may be drawn: strings only (a finite number is written out),
 * control characters removed except the line break, a tab as a space, `\r\n`
 * and the other line breaks as `\n`, no space at the end of a line, composed
 * (NFC), and at most `max` characters — counted so an emoji is never cut in
 * half. Reading the result again changes nothing.
 */
export function cleanText(x: unknown, max: number): string {
  const cap = max === Infinity ? Number.MAX_SAFE_INTEGER : Math.max(0, Math.floor(finite(max, 0)));
  return capped(scrub(x, roomFor(cap)), cap).replace(TRAILING, '');
}

/** One line — a title, a name, a label: every run of white space one space, none at either end. */
function lineText(x: unknown, max: number): string {
  return capped(scrub(x, roomFor(max)).replace(/\s+/g, ' ').trim(), max).trim();
}

/**
 * A graphic's title as it is kept: one line, trimmed, at most `LIMITS.title`
 * characters, and "Untitled" when nothing is left. The document and the title
 * box read it the same way, so what is typed is what comes back on reopening.
 */
export function readTitle(x: unknown): string {
  return lineText(x, LIMITS.title) || 'Untitled';
}

/**
 * Words written beside a number — a prefix, a suffix, a unit — where a space
 * is part of the design ("US$ ", " km"), so spaces stay as written; a line
 * break, which a counter cannot draw, becomes one.
 */
function affixText(x: unknown, max: number): string {
  return capped(scrub(x, roomFor(max)).replace(/\n/g, ' '), max);
}

// ── colour ────────────────────────────────────────────────────────────────

/** The three names a model reaches for that are not a guess. Any other name ("red", "navy") is not a colour here. */
const NAMED: ReadonlyMap<string, string> = new Map([
  ['transparent', '#00000000'], ['white', '#ffffff'], ['black', '#000000'],
]);

const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');

/** A colour's one spelling, `#rrggbb` — or `#rrggbbaa` when it is not opaque — so two ways of writing a colour compare equal. */
function hexOf(r: number, g: number, b: number, a: number): string {
  const alpha = byte(a * 255);
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha === 'ff' ? '' : alpha}`;
}

/** A number, or a percentage of `whole`, as a CSS colour function writes its parts. */
function part(p: string, whole: number): number | null {
  const pc = p.endsWith('%');
  const n = maybe(pc ? p.slice(0, -1) : p);
  return n === null ? null : pc ? (n / 100) * whole : n;
}

/** A hue in degrees, from degrees, turns, radians or gradians. */
function hueOf(p: string): number | null {
  const m = /^(.*?)(deg|grad|rad|turn)?$/.exec(p);
  const n = m ? maybe(m[1]) : null;
  if (!m || n === null) return null;
  const deg = m[2] === 'turn' ? n * 360 : m[2] === 'rad' ? (n * 180) / Math.PI : m[2] === 'grad' ? n * 0.9 : n;
  // 1e308turn overflows to Infinity, and Infinity % 360 is NaN: a colour of #NaNNaNNaN is not a colour.
  return Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : null;
}

/** `hsl()` as red, green and blue, 0 to 255. */
function rgbOfHsl(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

/**
 * A colour, as `#rrggbb` or `#rrggbbaa`, or undefined. Takes `#rgb`, `#rgba`,
 * `#rrggbb` (the `#` may be left off, as a model often does), `#rrggbbaa`,
 * `rgb()`/`rgba()` and `hsl()`/`hsla()` in the comma or the space syntax, and
 * `transparent`, `white` and `black`. Not a token: a palette's own colours
 * must be colours.
 */
function hexColour(x: unknown): string | undefined {
  if (typeof x !== 'string' || x.length > 64) return undefined;
  const s = x.trim().toLowerCase();
  const named = NAMED.get(s);
  if (named) return named;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s) ?? /^([0-9a-f]{6})$/.exec(s);
  if (hex) {
    const d = hex[1].length <= 4 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return `#${d.length === 8 && d.endsWith('ff') ? d.slice(0, 6) : d}`;
  }
  const fn = /^(rgba?|hsla?)\(([^()]*)\)$/.exec(s);
  if (!fn) return undefined;
  const parts = fn[2].trim().split(/[\s,/]+/);
  if (parts.length !== 3 && parts.length !== 4) return undefined;
  const a = parts.length === 4 ? part(parts[3], 1) : 1;
  if (a === null) return undefined;
  const alpha = Math.min(1, Math.max(0, a));
  if (fn[1].startsWith('rgb')) {
    const [r, g, b] = parts.slice(0, 3).map((p) => part(p, 255));
    return r === null || g === null || b === null ? undefined : hexOf(r, g, b, alpha);
  }
  const h = hueOf(parts[0]);
  const sat = part(parts[1].endsWith('%') ? parts[1] : `${parts[1]}%`, 1);
  const light = part(parts[2].endsWith('%') ? parts[2] : `${parts[2]}%`, 1);
  if (h === null || sat === null || light === null) return undefined;
  const [r, g, b] = rgbOfHsl(h, Math.min(1, Math.max(0, sat)), Math.min(1, Math.max(0, light)));
  return hexOf(r, g, b, alpha);
}

/** What a layer's colour may be: a palette token (so a new palette re-colours it) or a colour. */
function colourOf(x: unknown): string | undefined {
  return pick(x, TONES) ?? hexColour(x);
}

const GRADIENTS = ['linear', 'radial', 'conic'] as const;

/**
 * A gradient from its stops: each a colour (a stop that is not one is
 * dropped), at 0..1 — or spread evenly by its place when it gives none — at
 * most `LIMITS.stops`, sorted. One colour left is that colour; none is no
 * paint.
 */
function gradientOf(kind: Gradient['kind'], angle: number, raw: unknown[]): Paint | undefined {
  const stops: Gradient['stops'] = [];
  const last = Math.max(1, raw.length - 1);
  for (let i = 0; i < raw.length && stops.length < LIMITS.stops; i++) {
    const r = rec(raw[i]);
    const color = colourOf(r ? own(r, 'color') : raw[i]);
    if (color) stops.push({ at: num(r ? own(r, 'at') : undefined, 0, 1, i / last), color });
  }
  if (!stops.length) return undefined;
  if (stops.length === 1) return stops[0].color;
  // A stable sort: stops at the same place keep the order they were written in, the first time and every time after.
  stops.sort((p, q) => p.at - q.at);
  return { kind, angle, stops };
}

/** A paint, or undefined when `x` is none. A list of colours is read as the gradient it plainly means. */
function paintOf(x: unknown): Paint | undefined {
  if (typeof x === 'string') return colourOf(x);
  const list = listOf(x, 64);
  if (list) return gradientOf('linear', 90, list);
  const o = rec(x);
  if (!o) return undefined;
  const stops = listOf(own(o, 'stops'), 64) ?? listOf(own(o, 'colors'), 64);
  if (!stops) return undefined;
  const kind = pick(own(o, 'kind') ?? own(o, 'type'), GRADIENTS) ?? 'linear';
  return gradientOf(kind, num(own(o, 'angle'), -360, 360, 90), stops);
}

/**
 * A paint, or `fallback`: a palette token, a colour in its one spelling
 * (`#rrggbb` / `#rrggbbaa`), or a gradient — linear, radial or conic, its
 * angle in -360..360 and 2 to 6 stops of valid colours sorted by where they
 * sit in 0..1.
 */
export function readPaint(x: unknown, fallback: Paint): Paint {
  return paintOf(x) ?? fallback;
}

/** A list of colours (a chart's, a backdrop's): valid ones only, at most `LIMITS.colors`, and the kind's own when none is left. */
function coloursOf(x: unknown, fallback: readonly string[]): string[] {
  const list = typeof x === 'string' ? [x] : listOf(x, 64) ?? [];
  const out: string[] = [];
  for (const c of list) {
    const v = colourOf(c);
    if (v) out.push(v);
    if (out.length >= LIMITS.colors) break;
  }
  return out.length ? out : [...fallback];
}

/**
 * The palette a graphic has when it names none, or a colour of it does not
 * read: a deep night blue, near-white words, a clear blue and a warm pink.
 * Written the way `readPalette` writes colours, so reading it changes nothing.
 */
export const DEFAULT_PALETTE: Palette = Object.freeze({
  bg: '#0b1020', fg: '#f5f7ff', accent: '#4c8dff', accent2: '#ff6aa2', muted: '#8a93b2',
});

/** Other names a model gives the five colours. */
const PALETTE_ALIASES: Readonly<Record<keyof Palette, readonly string[]>> = {
  bg: ['background'], fg: ['foreground', 'text'], accent: [], accent2: ['secondary'], muted: [],
};

/**
 * A palette, repaired colour by colour: each of the five a real colour (never
 * a token — the palette is what tokens mean), and `fallback`'s own where it is
 * missing or unreadable, so one bad colour costs that colour, not the palette.
 */
export function readPalette(x: unknown, fallback: Palette = DEFAULT_PALETTE): Palette {
  const o = rec(x);
  const fb = rec(fallback);
  const out = {} as Palette;
  for (const t of TONES) {
    const given = o ? [t, ...PALETTE_ALIASES[t]].map((k) => hexColour(own(o, k))).find(Boolean) : undefined;
    out[t] = given ?? (fb ? hexColour(own(fb, t)) : undefined) ?? DEFAULT_PALETTE[t];
  }
  return out;
}

// ── motion ────────────────────────────────────────────────────────────────

const EASE_ALIASES: ReadonlyMap<string, EaseName> = new Map<string, EaseName>([
  ['ease', 'soft'], ['ease-in', 'in'], ['ease-out', 'out'], ['ease-in-out', 'inout'], ['in-out', 'inout'],
]);

/**
 * A timing curve: one of `EASES` (or a CSS name for one), or a cubic Bézier as
 * `bezier(x1,y1,x2,y2)` — `cubic-bezier(…)` too — written back one way. The x
 * values are held in 0..1, where the curve is a function of time at all, and
 * the y values in -5..5, far past any designed overshoot.
 */
function easeOf(x: unknown): string | undefined {
  const named = pick(x, EASES, EASE_ALIASES);
  if (named || typeof x !== 'string' || x.length > 80) return named;
  const m = /^(?:cubic-)?bezier\(([^()]*)\)$/.exec(x.trim().toLowerCase());
  const n = m ? m[1].split(',').map((p) => maybe(p)) : [];
  if (n.length !== 4 || n.some((v) => v === null)) return undefined;
  const r = (v: number | null, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v ?? 0)) * 1e4) / 1e4 || 0;
  return `bezier(${r(n[0], 0, 1)},${r(n[1], -5, 5)},${r(n[2], 0, 1)},${r(n[3], -5, 5)})`;
}

/**
 * An entrance or an exit, or undefined when there is none. `fx` must be one
 * of `EFFECTS` and not `none`; a bare word ("fade") is that effect as
 * designed. `d` is 0.05 s up to the layer's length (0.6 s when not given),
 * `delay` 0 up to it, `ease` a curve (`out` when not one), `amount` 0..3;
 * `dir`, `by` and `gap` are kept only when they are one of their words or a
 * number, `gap` held in 0..1.
 */
export function readAnim(x: unknown, layerSeconds: number): Anim | undefined {
  const o = typeof x === 'string' ? { fx: x } : rec(x);
  const fx = o ? pick(own(o, 'fx'), EFFECTS) : undefined;
  if (!o || !fx || fx === 'none') return undefined;
  const span = Math.max(MIN_SPAN, finite(layerSeconds, LIMITS.seconds));
  // `dir` here is the way an effect travels, not the document's direction — but
  // rtl.test.mjs greps every source file for an assignment to a `dir` property,
  // to keep the attribute written in one place, so it is set through the
  // object literal, which says what it means anyway.
  const dir = pick(own(o, 'dir'), DIRS);
  const a: Anim = {
    fx,
    d: num(own(o, 'd'), MIN_SPAN, span, 0.6),
    delay: num(own(o, 'delay'), 0, span, 0),
    ease: easeOf(own(o, 'ease')) ?? 'out',
    amount: num(own(o, 'amount'), 0, 3, 1),
    ...(dir ? { dir } : {}),
  };
  const by = pick(own(o, 'by'), SPLITS);
  if (by) a.by = by;
  const gap = maybe(own(o, 'gap'));
  if (gap !== null) a.gap = Math.min(1, Math.max(0, gap)) || 0;
  return a;
}

/**
 * A loop, or undefined when there is none: `fx` one of `LOOPS` and not
 * `none`, `amount` 0..3, and one cycle 0.4 to 60 seconds (2 when not given).
 * Never quicker than 0.4 s: a pulse or a breathe at three cycles a second or
 * more flickers, the rate WCAG warns can trigger seizures.
 */
export function readLoop(x: unknown): LoopAnim | undefined {
  const o = typeof x === 'string' ? { fx: x } : rec(x);
  const fx = o ? pick(own(o, 'fx'), LOOPS) : undefined;
  if (!o || !fx || fx === 'none') return undefined;
  return { fx, d: num(own(o, 'd'), 0.4, 60, 2), amount: num(own(o, 'amount'), 0, 3, 1) };
}

/** A soft shadow, or none: its colour a token or a colour, its blur and offsets in u. */
function shadowOf(x: unknown): Shadow | undefined {
  const o = rec(x);
  if (!o) return undefined;
  return {
    color: colourOf(own(o, 'color')) ?? '#00000080',
    blur: num(own(o, 'blur'), 0, 100, 2),
    x: num(own(o, 'x'), -100, 100, 0),
    y: num(own(o, 'y'), -100, 100, 0.6),
  };
}

// ── layers ────────────────────────────────────────────────────────────────

/** A layer id: short, and made of characters that are safe in a history key (`layer:<id>:text`) and a React key alike. */
const LAYER_ID = /^[A-Za-z0-9_-]{1,40}$/;

const idOf = (x: unknown) => (typeof x === 'string' && x.length <= 40 && LAYER_ID.test(x) ? x : undefined);

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

/** `n` random base-36 characters, from the platform's generator — or `Math.random` where there is none: an id need not be secret, only unlikely to repeat. */
function randomChars(n: number): string {
  const b = new Uint32Array(n);
  try {
    crypto.getRandomValues(b);
  } catch {
    for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 4294967296);
  }
  let s = '';
  for (let i = 0; i < n; i++) s += B36[b[i] % 36];
  return s;
}

/**
 * A new layer id — `l` and six random base-36 letters — that none of `taken`
 * has. Random rather than counted, so layers made in two places (a template
 * and the model's answer, a copy pasted in) do not collide when they meet.
 */
export function newLayerId(taken: ReadonlySet<string>): string {
  for (let length = 6; ; length++) {
    for (let i = 0; i < 20; i++) {
      const id = `l${randomChars(length)}`;
      if (!taken?.has(id)) return id;
    }
  }
}

const PIN_ROWS: ReadonlyMap<string, string> = new Map([['top', 't'], ['middle', 'm'], ['center', 'm'], ['centre', 'm'], ['bottom', 'b']]);
const PIN_COLS: ReadonlyMap<string, string> = new Map([['start', 's'], ['center', 'c'], ['centre', 'c'], ['middle', 'c'], ['end', 'e']]);

/**
 * A pin: its two letters, or the words a model writes for them —
 * "bottom-start", "top", "center". A lower third written "bottom-start" must
 * not land in the middle of the frame. `left` and `right` are not words here:
 * they swap sides in Arabic, and a pin must not.
 */
function pinOf(x: unknown): Pin | undefined {
  const exact = pick(x, PINS);
  if (exact || typeof x !== 'string' || x.length > 40) return exact;
  const words = x.trim().toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (words.length === 1) {
    const row = PIN_ROWS.get(words[0]);
    const col = PIN_COLS.get(words[0]);
    if (row && col) return 'mc';
    if (row) return `${row}c` as Pin;
    if (col) return `m${col}` as Pin;
  }
  if (words.length === 2) {
    const row = PIN_ROWS.get(words[0]);
    const col = PIN_COLS.get(words[1]);
    if (row && col) return `${row}${col}` as Pin;
  }
  return undefined;
}

const ALIGNS = ['start', 'center', 'end'] as const;
const ALIGN_ALIASES: ReadonlyMap<string, (typeof ALIGNS)[number]> = new Map([['centre', 'center'], ['middle', 'center']] as const);
const HI_STYLES = ['color', 'box', 'underline'] as const;
const CAPS = ['round', 'butt', 'square'] as const;
const FITS = ['cover', 'contain'] as const;
const BADGES = ['circle', 'squircle'] as const;

const align = (x: unknown) => pick(x, ALIGNS, ALIGN_ALIASES) ?? 'center';
const voice = (x: unknown) => pick(x, VOICES) ?? 'sans';

const WEIGHT_WORDS: ReadonlyMap<string, number> = new Map([
  ['thin', 100], ['hairline', 100], ['extralight', 200], ['ultralight', 200], ['light', 300], ['normal', 400],
  ['regular', 400], ['book', 400], ['medium', 500], ['semibold', 600], ['demibold', 600], ['bold', 700],
  ['extrabold', 800], ['ultrabold', 800], ['heavy', 800], ['black', 900],
]);

/** A font weight on the hundred, 100 to 900 — the steps every face has — from a number or the name of one ("semibold"). */
function weightOf(x: unknown, fallback: number): number {
  const word = typeof x === 'string' && x.length <= 20 ? WEIGHT_WORDS.get(x.trim().toLowerCase().replace(/[\s_-]/g, '')) : undefined;
  return Math.round(num(word ?? x, 100, 900, fallback) / 100) * 100;
}

/** A width or a height in u, under either name a model gives it. */
function extent(o: Rec, short: 'w' | 'h', fallback: number): number {
  return num(own(o, short) ?? own(o, short === 'w' ? 'width' : 'height'), 0, LIMITS.size, fallback);
}

/**
 * The fields every layer has. `start` and `end` are put in order when they
 * were written the wrong way round, `start` is somewhere a layer can still be
 * seen (up to 0.05 s before the end of the graphic), and `end` is at least
 * 0.05 s after it and no later than the graphic's end; a layer that gives no
 * end (nor a `duration`) runs to the end of the graphic.
 */
function baseOf(o: Rec, seconds: number): { base: LayerBase; span: number } {
  let s = maybe(own(o, 'start'));
  let e = maybe(own(o, 'end'));
  if (e === null) {
    const d = maybe(own(o, 'duration'));
    if (d !== null) e = (s ?? 0) + d;
  }
  if (s !== null && e !== null && e < s) [s, e] = [e, s];
  const start = Math.min(seconds - MIN_SPAN, Math.max(0, s ?? 0)) || 0;
  const end = e === null ? seconds : Math.min(seconds, Math.max(start + MIN_SPAN, e));
  const base: LayerBase = {
    id: idOf(own(o, 'id')) ?? newLayerId(new Set()),
    name: lineText(own(o, 'name'), LIMITS.name),
    start,
    end,
    pin: pinOf(own(o, 'pin')) ?? 'mc',
    x: num(own(o, 'x'), -LIMITS.reach, LIMITS.reach, 0),
    y: num(own(o, 'y'), -LIMITS.reach, LIMITS.reach, 0),
    scale: num(own(o, 'scale'), 0, LIMITS.scale, 1),
    rot: num(own(o, 'rot'), -3600, 3600, 0),
    opacity: num(own(o, 'opacity'), 0, 1, 1),
  };
  const span = end - start;
  const enter = readAnim(own(o, 'in'), span);
  if (enter) base.in = enter;
  const leave = readAnim(own(o, 'out'), span);
  if (leave) base.out = leave;
  const loop = readLoop(own(o, 'loop'));
  if (loop) base.loop = loop;
  const shadow = shadowOf(own(o, 'shadow'));
  if (shadow) base.shadow = shadow;
  const blend = pick(own(o, 'blend'), BLENDS);
  if (blend) base.blend = blend;
  if (own(o, 'hidden') === true) base.hidden = true;
  if (own(o, 'locked') === true) base.locked = true;
  return { base, span };
}

/**
 * Text. Words that are not a string (or a number) are the placeholder a
 * person can see is one; words that are empty stay empty — a person clearing
 * a box must not get the placeholder back on the next launch. `hi` is kept
 * only when it occurs exactly in the words, and its colour and style only
 * with it: a highlight of words that are not there would draw a box around
 * nothing.
 */
function textLayer(o: Rec, base: LayerBase): TextLayer {
  const raw = own(o, 'text');
  const text = typeof raw === 'string' || typeof raw === 'number' ? cleanText(raw, LIMITS.text) : 'Your words';
  const layer: TextLayer = {
    kind: 'text',
    ...base,
    text,
    voice: voice(own(o, 'voice')),
    size: num(own(o, 'size'), 0, LIMITS.fontSize, 8),
    weight: weightOf(own(o, 'weight'), 700),
    color: readPaint(own(o, 'color'), 'fg'),
    align: align(own(o, 'align')),
    lead: num(own(o, 'lead'), 0.7, 2.5, 1.15),
    track: num(own(o, 'track'), -0.2, 1, 0),
    caps: flag(own(o, 'caps'), false),
    max: num(own(o, 'max'), 0, LIMITS.size, 0),
    fit: flag(own(o, 'fit'), false),
  };
  const hi = cleanText(own(o, 'hi'), LIMITS.text);
  if (hi && text.includes(hi)) {
    layer.hi = hi;
    const hiColor = paintOf(own(o, 'hiColor'));
    if (hiColor) layer.hiColor = hiColor;
    const hiStyle = pick(own(o, 'hiStyle'), HI_STYLES);
    if (hiStyle) layer.hiStyle = hiStyle;
  }
  const outline = rec(own(o, 'outline'));
  if (outline) layer.outline = { color: readPaint(own(outline, 'color'), 'bg'), width: num(own(outline, 'width'), 0, textOutlineMax(layer.size), 0.3) };
  if (layer.shadow) layer.shadow = { ...layer.shadow, blur: Math.min(layer.shadow.blur, textShadowMax(layer.size)) };
  return layer;
}

/**
 * The widest outline and the softest shadow words may have, in u, for their
 * type size. Every letter of a text is stroked and blurred on its own, so their
 * cost is per letter and grows with the width and the blur; past these an
 * outline has eaten the letters it surrounds and a shadow is a haze nobody can
 * place, and neither is a design. In the app's WebKit, sixty layers of 500
 * letters at 3u with a 20u outline and a 100u shadow took 2.2 s a frame at
 * 1080p and 7.2 s at 4K; held here, 0.33 s and 0.57 s (docs/pro/review-safety.md,
 * R1-6). Every template, in every shape and language, stays far inside: its
 * words' shadows use under a fifth of this and their outlines a seventh, and
 * not one of them builds differently for it. A small floor keeps a label's own.
 * Exported so the layer panel's fields can offer no more than the reader keeps.
 */
export const textOutlineMax = (size: number): number => Math.min(20, Math.max(2, size / 2));
export const textShadowMax = (size: number): number => Math.min(100, Math.max(4, size * 2));

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/;

/**
 * A shape's SVG path data, kept only when it is short enough and made of
 * nothing but path commands and numbers — so it can never be markup, a URL or
 * anything but a path.
 */
function pathOf(x: unknown): string | undefined {
  if (typeof x !== 'string' || x.length > LIMITS.path) return undefined;
  const d = x.trim();
  // Made of path characters is not the same as a path: `M 1 2 L` passes the
  // character test and draws nothing. Parsed, it is a path or it is dropped.
  return d && PATH.test(d) && parsePath(d, LIMITS.path) !== null ? d : undefined;
}

/** An outline, or none. A dash of two lengths in u is kept when it has any length at all. */
function strokeOf(x: unknown): Stroke | undefined {
  const o = rec(x);
  if (!o) return undefined;
  const stroke: Stroke = {
    color: readPaint(own(o, 'color'), 'fg'),
    width: num(own(o, 'width'), 0, 100, 0.5),
    cap: pick(own(o, 'cap'), CAPS) ?? 'round',
  };
  const dash = listOf(own(o, 'dash'), 2);
  if (dash && dash.length === 2 && dash.every((v) => maybe(v) !== null)) {
    const on = num(dash[0], 0, LIMITS.size, 0);
    const off = num(dash[1], 0, LIMITS.size, 0);
    if (on + off > 0) stroke.dash = [on, off];
  }
  return stroke;
}

/**
 * The most dashes one stroke may be cut into. A canvas draws every dash of a
 * pattern, and it costs per dash: in the app's WebKit, a path of four hundred
 * long segments dashed every 0.05u took 290 ms a frame on its own, and sixty
 * such layers fifteen seconds to paint their first frame
 * (docs/pro/review-safety.md, R1-4) — while a pattern only has to be a hair longer than half a pixel for
 * the drawing code to draw it. A few thousand is far past any dotted or dashed
 * line a design uses (the template's dotted rule has a few dozen; a 600u
 * circle dashed every 0.5u, under four thousand), and costs a few hundred
 * microseconds.
 */
export const MAX_DASHES = 4000;
/** The share of `MAX_DASHES` a pattern that is too fine is widened to: under the ceiling by a margin, so reading it again finds it under and leaves it. */
const DASH_FIT = 0.98;

/**
 * About how long a shape's stroke is, in u, at its own size: its outline as
 * motiondraw.ts's `buildOutline` makes it, from the same motionmath.ts
 * generators, measured. An upper bound is all that is needed — an arc's radius
 * is held to 1u where the drawing holds it to a pixel — and `grow` may stretch
 * it a quarter further, which `MAX_DASHES` leaves room for.
 */
function strokeSpan(l: ShapeLayer): number {
  const W = l.w;
  const H = l.h;
  const S = Math.min(W, H);
  const lineW = l.stroke?.width ?? 0;
  if (!(W > 0) || (!(H > 0) && l.shape !== 'line')) return 0;
  let segs: Seg[] | null = null;
  switch (l.shape) {
    case 'rect': segs = rectPath(W, H, Math.min(l.radius, S / 2)); break;
    case 'ellipse': segs = ellipsePath(W, H); break;
    case 'arc': {
      const r = Math.max(1, S - lineW);
      segs = arcPath(r, r, l.from, l.sweep);
      break;
    }
    case 'polygon': segs = polygonPath(l.sides, S, S); break;
    case 'star': segs = starPath(l.sides, W, H, l.inner); break;
    case 'line': return W;
    case 'arrow': segs = arrowPath(W, H); break;
    case 'burst': segs = burstPath(l.sides, W, H, l.inner); break;
    case 'wave': segs = wavePath(Math.max(1, W - lineW), Math.max(1, H - lineW), l.sides, l.seed * 0.6180339887); break;
    case 'blob': segs = blobPath(W, H, l.seed); break;
    case 'path': {
      const p = l.d ? parsePath(l.d, LIMITS.path) : null;
      segs = p && p.length ? fitPath(p, W, H) : null;
      break;
    }
  }
  const n = segs ? pathLength(segs) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A stroke's dash held to `MAX_DASHES` along the shape it outlines: a pattern
 * finer than that is widened, its dash and its gap in proportion, so it reads
 * as the same rhythm, only coarser — never dropped, so a dotted outline stays
 * dotted. One that would have to be wider than a dash may be is no dash.
 */
function dashFitted(l: ShapeLayer, dash: [number, number]): [number, number] | undefined {
  const period = dash[0] + dash[1];
  const span = strokeSpan(l);
  if (!(period > 0) || span / period <= MAX_DASHES) return dash;
  const f = span / (period * MAX_DASHES * DASH_FIT);
  const on = dash[0] * f;
  const off = dash[1] * f;
  return Number.isFinite(on) && Number.isFinite(off) && on <= LIMITS.size && off <= LIMITS.size ? [on, off] : undefined;
}

/** A shape. `fill: null` is kept — an outline with nothing inside is a design — while a fill that is not a paint becomes the accent. */
function shapeLayer(o: Rec, base: LayerBase): ShapeLayer {
  const fill = own(o, 'fill');
  const layer: ShapeLayer = {
    kind: 'shape',
    ...base,
    shape: pick(own(o, 'shape'), SHAPES) ?? 'rect',
    w: extent(o, 'w', 30),
    h: extent(o, 'h', 16),
    radius: num(own(o, 'radius'), 0, LIMITS.size, 2),
    sides: int(own(o, 'sides'), 3, 24, 5),
    inner: num(own(o, 'inner'), 0.05, 0.95, 0.5),
    from: num(own(o, 'from'), -360, 360, 0),
    sweep: num(own(o, 'sweep'), -360, 360, 270),
    fill: fill === null ? null : readPaint(fill, 'accent'),
    seed: int(own(o, 'seed'), 0, MAX_SEED, 1),
  };
  const stroke = strokeOf(own(o, 'stroke'));
  if (stroke) layer.stroke = stroke;
  const d = pathOf(own(o, 'd'));
  if (d) layer.d = d;
  if (stroke?.dash) {
    const fitted = dashFitted(layer, stroke.dash);
    if (fitted) stroke.dash = fitted;
    else delete stroke.dash;
  }
  return layer;
}

/** An icon from the app's own set: a name it does not have is the sparkle, never a picture fetched by that name. */
function iconLayer(o: Rec, base: LayerBase): IconLayer {
  const layer: IconLayer = {
    kind: 'icon',
    ...base,
    icon: pick(own(o, 'icon'), ICON_IDS) ?? 'sparkle',
    size: num(own(o, 'size'), 0, LIMITS.size, 10),
    color: readPaint(own(o, 'color'), 'fg'),
    weight: num(own(o, 'weight'), 0.25, 6, 1.75),
  };
  const badge = rec(own(o, 'badge'));
  if (badge) {
    layer.badge = {
      shape: pick(own(badge, 'shape'), BADGES) ?? 'circle',
      fill: readPaint(own(badge, 'fill'), 'accent'),
      pad: num(own(badge, 'pad'), 0, 100, 2),
    };
  }
  return layer;
}

/** The two formats the picture importer writes (motionpicture.ts turns SVG, GIF and WebP into PNG, and photographs into JPEG). */
const IMAGE = /^data:image\/(?:png|jpeg);base64,/i;

/**
 * A picture's source: a base64 PNG or JPEG `data:` URL no longer than
 * `LIMITS.image` — anything else is the empty frame. Never an address of any
 * kind (http, file, blob, asset): the renderer would fetch it, and Motion makes
 * no request of its own. And never an SVG or another type: those are the
 * formats a model could write by hand, and a picture is something only the
 * person brings, through the importer, which rasterises whatever they choose
 * into one of these two.
 */
function srcOf(x: unknown): string {
  return typeof x === 'string' && x.length <= LIMITS.image && IMAGE.test(x.slice(0, 32)) ? x : '';
}

function imageLayer(o: Rec, base: LayerBase): ImageLayer {
  return {
    kind: 'image',
    ...base,
    src: srcOf(own(o, 'src')),
    w: extent(o, 'w', 30),
    h: extent(o, 'h', 20),
    fit: pick(own(o, 'fit'), FITS) ?? 'cover',
    radius: num(own(o, 'radius'), 0, LIMITS.size, 1.5),
  };
}

/** A counter. The roll takes 0.05 s up to the layer's length, and starts no later than the layer ends. */
function counterLayer(o: Rec, base: LayerBase, span: number): CounterLayer {
  const c = rec(own(o, 'count'));
  return {
    kind: 'counter',
    ...base,
    from: num(own(o, 'from'), -BIG, BIG, 0),
    to: num(own(o, 'to'), -BIG, BIG, 100),
    decimals: int(own(o, 'decimals'), 0, 3, 0),
    prefix: affixText(own(o, 'prefix'), LIMITS.suffix),
    suffix: affixText(own(o, 'suffix'), LIMITS.suffix),
    group: flag(own(o, 'group'), true),
    voice: voice(own(o, 'voice')),
    size: num(own(o, 'size'), 0, LIMITS.fontSize, 14),
    weight: weightOf(own(o, 'weight'), 800),
    color: readPaint(own(o, 'color'), 'fg'),
    align: align(own(o, 'align')),
    track: num(own(o, 'track'), -0.2, 1, 0),
    count: {
      d: num(c && own(c, 'd'), MIN_SPAN, span, 1.6),
      delay: num(c && own(c, 'delay'), 0, span, 0.2),
      ease: easeOf(c && own(c, 'ease')) ?? 'expo-out',
    },
  };
}

/**
 * A chart's data: a label and a finite value each (a bare number is a datum
 * with no label), at most `LIMITS.dataPoints`. A datum with no number is
 * dropped, and a chart with none keeps none: numbers invented to fill a chart
 * would look like facts.
 */
function dataOf(x: unknown): ChartLayer['data'] {
  const out: ChartLayer['data'] = [];
  for (const d of listOf(x) ?? []) {
    const r = rec(d);
    const value = maybe(r ? own(r, 'value') : d);
    if (value === null) continue;
    out.push({ label: r ? lineText(own(r, 'label') ?? own(r, 'name'), LIMITS.label) : '', value: Math.min(BIG, Math.max(-BIG, value)) || 0 });
    if (out.length >= LIMITS.dataPoints) break;
  }
  return out;
}

function chartLayer(o: Rec, base: LayerBase): ChartLayer {
  return {
    kind: 'chart',
    ...base,
    chart: pick(own(o, 'chart'), CHARTS) ?? 'bars',
    w: extent(o, 'w', 60),
    h: extent(o, 'h', 32),
    data: dataOf(own(o, 'data')),
    colors: coloursOf(own(o, 'colors'), ['accent', 'accent2']),
    max: num(own(o, 'max'), 0, BIG, 0),
    unit: affixText(own(o, 'unit'), LIMITS.suffix),
    labels: flag(own(o, 'labels'), true),
    values: flag(own(o, 'values'), true),
    voice: voice(own(o, 'voice')),
    size: num(own(o, 'size'), 0, LIMITS.fontSize, 2.6),
    color: readPaint(own(o, 'color'), 'fg'),
    thick: num(own(o, 'thick'), 0, 100, 1.4),
    gap: num(own(o, 'gap'), 0, 1, 0.12),
  };
}

function backdropLayer(o: Rec, base: LayerBase): BackdropLayer {
  return {
    kind: 'backdrop',
    ...base,
    style: pick(own(o, 'style'), BACKDROPS) ?? 'aurora',
    colors: coloursOf(own(o, 'colors'), ['accent', 'accent2']),
    speed: num(own(o, 'speed'), 0, 3, 1),
    density: num(own(o, 'density'), 0, 1, 0.5),
    seed: int(own(o, 'seed'), 0, MAX_SEED, 1),
  };
}

/** Particles: at most `LIMITS.particles` of them, whatever was asked — every one is drawn every frame. */
function particlesLayer(o: Rec, base: LayerBase): ParticlesLayer {
  return {
    kind: 'particles',
    ...base,
    style: pick(own(o, 'style'), PARTICLES) ?? 'confetti',
    colors: coloursOf(own(o, 'colors'), ['accent', 'accent2', 'fg']),
    count: int(own(o, 'count'), 0, LIMITS.particles, 60),
    size: num(own(o, 'size'), 0, LIMITS.particleSize, 1.4),
    speed: num(own(o, 'speed'), 0, 3, 1),
    spread: num(own(o, 'spread'), 0, LIMITS.reach, 0),
    burst: flag(own(o, 'burst'), true),
    seed: int(own(o, 'seed'), 0, MAX_SEED, 1),
  };
}

const READERS: { [K in LayerKind]: (o: Rec, base: LayerBase, span: number) => LayerOf<K> } = {
  text: textLayer,
  shape: shapeLayer,
  icon: iconLayer,
  image: imageLayer,
  counter: counterLayer,
  chart: chartLayer,
  backdrop: backdropLayer,
  particles: particlesLayer,
};

/**
 * One layer, read for a graphic `ctx.seconds` long, or null when its kind is
 * not one of `LAYER_KINDS` — a layer nothing can draw is dropped, not guessed
 * into another kind. Everything else is repaired: a missing or malformed id is
 * a fresh one (`readMotion` also makes ids unique across the document), and
 * every field the layer leaves out is the kind's design default.
 */
export function readLayer(x: unknown, ctx: { seconds: number }): Layer | null {
  const o = rec(x);
  const kind = o ? pick(own(o, 'kind'), LAYER_KINDS) : undefined;
  if (!o || !kind) return null;
  let seconds = 6;
  try {
    seconds = num(ctx.seconds, LIMITS.minSeconds, LIMITS.seconds, 6);
  } catch {
    /* a graphic of the default length */
  }
  const { base, span } = baseOf(o, seconds);
  return READERS[kind](o, base, span);
}

/** What a sample chart shows until its numbers are written: plainly placeholders, and never filled into a chart that arrives without data. */
const SAMPLE_DATA: ChartLayer['data'] = [{ label: 'Q1', value: 40 }, { label: 'Q2', value: 65 }, { label: 'Q3', value: 90 }];

/**
 * A new layer of `kind` with the design defaults templates and the "Add
 * layer" menu start from, `o` written over them, and the whole read again —
 * so what comes back is always a valid layer, whatever `o` held. It has a
 * fresh id unless `o` gives one. It lasts from 0 to 6 s unless `o` says
 * otherwise; one that starts at 6 s or later and names no end runs to the end
 * of the graphic it is put in.
 */
export function blankLayer<K extends LayerKind>(kind: K, o?: Partial<LayerOf<K>>): LayerOf<K>;
export function blankLayer(kind: LayerKind, o?: Partial<Layer>): Layer;
export function blankLayer(kind: LayerKind, o?: Partial<Layer>): Layer {
  const k = pick(kind, LAYER_KINDS) ?? 'text';
  let over: Record<string, unknown> = {};
  try {
    over = { ...rec(o) };
  } catch {
    /* an object that will not be read is no object: the design defaults */
  }
  const start = finite(own(over, 'start'), 0);
  const end = maybe(own(over, 'end')) ?? (start < BLANK_SECONDS - MIN_SPAN ? BLANK_SECONDS : LIMITS.seconds);
  const blank = {
    ...(k === 'chart' ? { data: SAMPLE_DATA } : {}),
    ...over,
    kind: k,
    end,
    id: idOf(own(over, 'id')) ?? newLayerId(new Set()),
  };
  // Never null: the kind is one of LAYER_KINDS.
  return readLayer(blank, { seconds: LIMITS.seconds }) as Layer;
}

/**
 * A layer held to the particle budget: a particle layer draws at most what the
 * document's budget (`LIMITS.particleBudget`) leaves after the particles of
 * `others`, the layers that already have theirs. Any other layer is returned as
 * it is. One layer is bounded by `LIMITS.particles`; sixty of them are not.
 */
export function fitParticles(layer: Layer, others: ReadonlyArray<Layer>): Layer {
  if (layer.kind !== 'particles') return layer;
  let used = 0;
  for (const other of others) if (other.kind === 'particles') used += other.count;
  const room = Math.max(0, LIMITS.particleBudget - used);
  return layer.count > room ? { ...layer, count: room } : layer;
}

/**
 * Every layer that reads, in order, at most `LIMITS.layers`, with ids unique
 * across the document: a second layer with an id already taken gets a new
 * one, because the timeline, the history and a selection all find a layer by
 * its id.
 */
function layersOf(x: unknown, seconds: number): Layer[] {
  const out: Layer[] = [];
  const taken = new Set<string>();
  for (const item of listOf(x) ?? []) {
    if (out.length >= LIMITS.layers) break;
    let layer: Layer | null = null;
    try {
      layer = readLayer(item, { seconds });
    } catch {
      layer = null;
    }
    if (!layer) continue;
    if (taken.has(layer.id)) layer = { ...layer, id: newLayerId(taken) };
    // The document's particle budget is spent in order: earlier layers keep their count.
    layer = fitParticles(layer, out);
    taken.add(layer.id);
    out.push(layer);
  }
  return out;
}

// ── the document ──────────────────────────────────────────────────────────

/** A template field's name: lower case, a letter first, short. */
const FIELD_KEY = /^[a-z][a-z0-9-]{0,23}$/;

/**
 * A template's fields: at most `LIMITS.fields` of them, named as `FIELD_KEY`
 * says (lower-cased first, so "Title" is `title`), each value words of at
 * most `LIMITS.fieldChars` — a number is written out, and anything else (an
 * object, a list, a yes or no) is dropped.
 */
export function readFields(x: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const o = rec(x);
  if (!o) return out;
  let keys: string[] = [];
  try {
    keys = Object.keys(o);
  } catch {
    return out;
  }
  let n = 0;
  for (let i = 0; i < keys.length && i < SCAN && n < LIMITS.fields; i++) {
    const raw = keys[i];
    if (raw.length > 64) continue;
    const k = raw.trim().toLowerCase();
    if (!FIELD_KEY.test(k) || Object.prototype.hasOwnProperty.call(out, k)) continue;
    const v = own(o, raw);
    if (typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) continue;
    out[k] = cleanText(v, LIMITS.fieldChars);
    n++;
  }
  return out;
}

/**
 * Where a template's part of a graphic `seconds` long ends (`RecipeRef.until`),
 * or undefined for the whole graphic. A number (or a plain decimal string),
 * kept to the millisecond as scene cuts are, at least `LIMITS.minSeconds` (no
 * template is built shorter); one that reaches the graphic's end, or is not a
 * number at all, is the whole graphic — which is what every graphic stored
 * before there was a span means, so they read exactly as they did.
 */
function untilOf(x: unknown, seconds: number): number | undefined {
  const n = maybe(x);
  if (n === null) return undefined;
  const at = Math.max(LIMITS.minSeconds, Math.round(n * 1000) / 1000) || 0;
  return at < seconds - 1e-6 ? at : undefined;
}

function recipeOf(x: unknown, seconds: number): RecipeRef | undefined {
  const o = rec(x);
  const id = o ? pick(own(o, 'id'), RECIPE_IDS) : undefined;
  if (!o || !id) return undefined;
  const ref: RecipeRef = { id, fields: readFields(own(o, 'fields')) };
  const until = untilOf(own(o, 'until'), seconds);
  if (until !== undefined) ref.until = until;
  return ref;
}

/**
 * A document id, kept exactly as stored — it is the record's key, and a
 * repaired id would leave the stored record behind, undeletable. Only an
 * empty, overlong or control-character id is replaced.
 */
function motionIdOf(x: unknown): string | undefined {
  return typeof x === 'string' && x.length <= 128 && x.trim() !== '' && !ANY_CONTROL.test(x) ? x : undefined;
}

/** A language this app ships, from its code or a regional form of it (`ar-IQ`, `ckb_IQ`); English otherwise. */
function langOf(x: unknown): Lang {
  if (typeof x !== 'string' || x.length > 40) return 'en';
  return pick(x.trim().split(/[-_]/)[0], LANGUAGES) ?? 'en';
}

/** A frame shape, by name or by its ratio ("9:16"); landscape otherwise. */
function formatOf(x: unknown): Format {
  const f = pick(x, FORMAT_IDS);
  if (f) return f;
  const s = typeof x === 'string' && x.length <= 40 ? x.replace(/\s/g, '') : '';
  return FORMAT_IDS.find((k) => FORMATS[k].ratio === s) ?? 'landscape';
}

/** 24, 30 or 60 frames a second; anything else is 30, not the nearest — 25 is not a rate the encoder is tuned for. */
function fpsOf(x: unknown): Fps {
  const n = finite(x, 30);
  return (FPS_CHOICES as readonly number[]).includes(n) ? (n as Fps) : 30;
}

/** A moment in ms since 1970 that a `Date` can hold, or `fallback`. */
function timeOf(x: unknown, fallback: number): number {
  const n = maybe(x);
  return n !== null && n >= 0 && n <= MAX_TIME ? n || 0 : fallback;
}

// ── sources ───────────────────────────────────────────────────────────────

/**
 * The longest address a source may have. The app's one way to open a link,
 * the `open_url` command, refuses anything longer, so a longer one would be a
 * link shown and then refused.
 */
export const SOURCE_URL_MAX = 2048;
/** A source's title as it is shown under an answer: one line. */
export const SOURCE_TITLE_MAX = 80;

/**
 * Letters that turn text around or hide in it — the bidirectional overrides,
 * isolates and marks, the zero-width space, the byte-order mark —
 * which the reader's control-character rule does not reach. In a link's title
 * they could make "moc.elpmaxe" read as another site's name. The zero-width
 * joiner and non-joiner stay: Sorani and Persian spell words with them.
 */
const INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const HAS_INVISIBLE = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/;

/** A host no public page lives on: this machine, a private name, a bare IP address. */
function privateHost(host: string): boolean {
  return !host.includes('.') || host.endsWith('.') || host.startsWith('[') || /^[\d.]+$/.test(host)
    || host === 'localhost' || /\.(?:localhost|local|internal|lan|home|arpa)$/.test(host);
}

/**
 * A source's address as it is kept, or null: a public `https:` page, written
 * the way the platform writes it (`URL.href`, so reading it again changes
 * nothing). Refused: any other scheme (`http:`, `javascript:`, `file:`,
 * `data:`), a user name or password in it (`https://user:pass@host` is how a
 * link pretends to be another site), white space, control or invisible
 * letters, an address past `SOURCE_URL_MAX`, and a host that is this machine,
 * a private name or a bare IP address — a page the web search read is on the
 * public web. The same rule as the Rust `open_url`, and a little stricter.
 */
export function sourceUrl(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > SOURCE_URL_MAX + 64) return null;
  const s = x.trim();
  if (!s || s.length > SOURCE_URL_MAX || /[\s\u0000-\u001F\u007F-\u009F]/.test(s) || HAS_INVISIBLE.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.username || u.password || privateHost(u.hostname.toLowerCase())) return null;
  return u.href.length <= SOURCE_URL_MAX ? u.href : null;
}

/** The site of an address as a person reads it: `en.wikipedia.org`, without `www.`; '' when it is no address. */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * One source as it is kept, or null when its address is not one
 * (`sourceUrl`). The title is one line of at most `SOURCE_TITLE_MAX`
 * characters with no invisible letters; the site's name when it has none.
 */
export function readSource(x: unknown): Source | null {
  const o = rec(x);
  if (!o) return null;
  const url = sourceUrl(own(o, 'url'));
  if (!url) return null;
  const title = capped(scrub(own(o, 'title'), roomFor(SOURCE_TITLE_MAX)).replace(INVISIBLE, '').replace(/\s+/g, ' ').trim(), SOURCE_TITLE_MAX).trim();
  return { title: title || sourceHost(url), url };
}

/** A graphic's sources: each read by `readSource`, each address once, at most `SOURCES_MAX`; none from anything that is not a list. */
export function readSources(x: unknown): Source[] {
  const out: Source[] = [];
  for (const item of listOf(x, 64) ?? []) {
    const s = readSource(item);
    if (s && !out.some((o) => o.url === s.url)) out.push(s);
    if (out.length === SOURCES_MAX) break;
  }
  return out;
}

const STAGES = ['new', 'planning', 'ready'] as const;
const MOTION_KEYS = [
  'id', 'title', 'request', 'lang', 'format', 'fps', 'seconds', 'palette', 'backdrop', 'layers', 'recipe', 'ai',
  'stage', 'error', 'created', 'updated',
];

/**
 * A motion graphic from anything, or null when `x` is not an object with any
 * field of one. Otherwise always a valid `Motion`: a missing id is generated,
 * a missing title is "Untitled", `seconds` is 1..30 (6 when not given), `fps`
 * 24, 30 or 60 (30), `format` and `lang` from their lists (landscape,
 * English), the palette repaired colour by colour, the backdrop a paint or
 * `null` (transparent) — the palette's ground when not given — and the layers
 * read one by one, the unreadable dropped. A stored `planning` never survives
 * a reading: the run it waited for is gone, so the graphic is `ready` when it
 * has layers and `new` when it has none. `now` stamps a graphic that has no
 * times of its own.
 */
export function readMotion(x: unknown, now: number = Date.now()): Motion | null {
  try {
    const o = rec(x);
    if (!o || !MOTION_KEYS.some((k) => present(own(o, k)))) return null;
    const seconds = num(own(o, 'seconds') ?? own(o, 'duration'), LIMITS.minSeconds, LIMITS.seconds, 6);
    const layers = layersOf(own(o, 'layers'), seconds);
    const stage = pick(own(o, 'stage'), STAGES);
    const created = timeOf(own(o, 'created'), timeOf(now, Date.now()));
    const backdrop = own(o, 'backdrop');
    const ground = backdrop === null ? null : readPaint(backdrop, 'bg');
    const m: Motion = {
      id: motionIdOf(own(o, 'id')) ?? `m${randomChars(10)}`,
      title: readTitle(own(o, 'title')),
      request: cleanText(own(o, 'request'), LIMITS.request),
      lang: langOf(own(o, 'lang')),
      format: formatOf(own(o, 'format')),
      fps: fpsOf(own(o, 'fps')),
      seconds,
      palette: readPalette(own(o, 'palette')),
      // A colour with no opacity ("transparent", #0000) is `null`, the one spelling of a see-through frame, so the
      // stage's checkerboard, the export's transparency option and the film itself all agree on it.
      backdrop: typeof ground === 'string' && /^#[0-9a-f]{6}00$/.test(ground) ? null : ground,
      layers,
      stage: stage === 'new' || (stage === 'planning' && !layers.length) ? 'new' : 'ready',
      created,
      updated: timeOf(own(o, 'updated'), created),
    };
    const recipe = recipeOf(own(o, 'recipe'), seconds);
    if (recipe) m.recipe = recipe;
    if (own(o, 'ai') === true) m.ai = true;
    const sound = readSound(own(o, 'sound'));
    if (sound) m.sound = sound;
    const scenes = readScenes(own(o, 'scenes'), layers, seconds);
    if (scenes) m.scenes = scenes;
    const sources = readSources(own(o, 'sources'));
    if (sources.length) m.sources = sources;
    const error = cleanText(own(o, 'error'), ERROR_CHARS);
    if (error) m.error = error;
    return m;
  } catch {
    // Only something no document could be — a Proxy that throws from every
    // trap at once — reaches here; it is not a graphic.
    return null;
  }
}
