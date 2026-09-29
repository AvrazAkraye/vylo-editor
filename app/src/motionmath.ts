import type { EaseName } from './motiontypes';

/**
 * The numbers under every Motion frame: easing curves and springs, colour,
 * seeded noise, and SVG path geometry. Written here rather than taken from a
 * library, which is the point of Motion (docs/MOTION.md).
 *
 * Pure on purpose: no DOM, no clock, no state kept between calls, and nothing
 * random that is not seeded. A frame is `paint(ctx, doc, t)` and nothing else,
 * so the preview, a PNG and every frame of an MP4 are the same picture; that
 * holds only if everything it calls is a function of its arguments.
 *
 * Total, too. The renderer calls these for every layer of every frame, often
 * with numbers a model chose, and a NaN that reaches the canvas is not an
 * error anyone sees: the call is silently dropped and the layer vanishes, or
 * the whole frame comes out blank. So nothing here throws, a malformed input
 * reads as the nearest sensible thing (each function says which), and a finite
 * input gives a finite output.
 */

// ── numbers ───────────────────────────────────────────────────────────────

/**
 * `x` when it is a finite number, else `fallback`. The gate for any number
 * that may have come from a model, a stored document or a division by zero:
 * the canvas ignores a NaN without a word, and the layer it placed vanishes.
 */
export function finite(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/**
 * `x` held to `lo`..`hi`. A NaN `x` reads as `lo`, the edge an effect starts
 * from, so a broken number shows a layer at rest rather than nowhere. When
 * the bounds cross (a corner radius limited to half a negative width), `lo`
 * wins: the floor is the safe side. A NaN bound is no bound.
 */
export function clamp(x: number, lo: number, hi: number): number {
  if (x !== x) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi < lo ? lo : hi;
  return x;
}

/** `clamp(x, 0, 1)` for progress, opacity and mixes, where NaN must read as 0 (nothing yet) rather than spread. */
export function clamp01(x: number): number {
  return x > 0 ? (x < 1 ? x : 1) : 0;
}

/**
 * From `a` (t = 0) to `b` (t = 1), unclamped so an overshooting curve can
 * carry a layer past its mark. Exactly `b` at 1 (the textbook `a + (b-a)t`
 * can miss it by a rounding, and a finished effect must rest precisely), and
 * written so opposite huge ends do not overflow. A NaN `t` stays at `a`.
 */
export function lerp(a: number, b: number, t: number): number {
  if (t !== t || a === b) return a;
  return a * (1 - t) + b * t;
}

/**
 * Where `x` sits from `a` (0) to `b` (1), unclamped so a caller can see
 * overshoot. 0 when `a === b`, where the answer would be 0/0, and 0 for a NaN
 * `x` or a span too wide for a double: the start, never NaN.
 */
export function invLerp(a: number, b: number, x: number): number {
  const r = (x - a) / (b - a);
  return Number.isFinite(r) ? r : 0;
}

/** `x` carried from the span `a`..`b` to `c`..`d`, unclamped; `c` when `a === b` (see `invLerp`). */
export function remap(x: number, a: number, b: number, c: number, d: number): number {
  return lerp(c, d, invLerp(a, b, x));
}

/**
 * 0 up to `a`, 1 from `b`, and a curve without corners between, for fades
 * that must not visibly start or stop. When `a === b` it is a hard step at `a`
 * instead of the formula's 0/0. A NaN `x` is 0.
 */
export function smoothstep(a: number, b: number, x: number): number {
  if (x !== x) return 0;
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * The part of `x` above its floor, in [0, 1) for negatives too (-0.25 is
 * 0.75), so a looping phase never runs backwards through zero. For a tiny
 * negative `x`, `x - floor(x)` rounds to exactly 1; that is folded to 0, the
 * same point of the cycle. A non-finite `x` is 0.
 */
export function frac(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = x - Math.floor(x);
  return f < 1 ? f : 0;
}

/**
 * `x` modulo `n`, never negative: -30 wrapped by 360 is 330, where `%` gives
 * -30 and a lookup by angle would miss. `n` is taken as its size; a zero or
 * non-finite `n`, or a non-finite `x`, gives 0.
 */
export function wrap(x: number, n: number): number {
  const m = Math.abs(n);
  if (!(m > 0) || !Number.isFinite(m) || !Number.isFinite(x)) return 0;
  return ((x % m) + m) % m;
}

const TAU = Math.PI * 2;

// ── easing ────────────────────────────────────────────────────────────────

/** A timing curve: progress 0..1 in, eased progress out (which may overshoot 1 or dip under 0 on the way). */
export type EaseFn = (x: number) => number;

/**
 * Every curve goes through this. The frame an effect ends on must be exactly
 * its resting state, or a title that has "finished" rising sits a hair off its
 * line and shimmers against the next layer; and the evaluator may hand in a
 * progress a rounding past either end. So the input is held to 0..1 (NaN is
 * 0), and 0 and 1 map to exactly 0 and 1 whatever the formula rounds to.
 */
function ends(f: EaseFn): EaseFn {
  return (x) => (x > 0 ? (x < 1 ? f(x) : 1) : 0);
}

const E10 = Math.pow(2, -10);

/**
 * 2^(10(x-1)) lowered and stretched to pass exactly through 0 and 1. The
 * textbook exponential never reaches either end and is patched with a jump
 * of 0.1% on the first and last frame; this has no jump.
 */
const expoIn = (x: number): number => (Math.pow(2, 10 * (x - 1)) - E10) / (1 - E10);

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C3 = C1 + 1;

function bounceOut(x: number): number {
  const n = 7.5625;
  const d = 2.75;
  let y: number;
  if (x < 1 / d) {
    y = n * x * x;
  } else if (x < 2 / d) {
    const u = x - 1.5 / d;
    y = n * u * u + 0.75;
  } else if (x < 2.5 / d) {
    const u = x - 2.25 / d;
    y = n * u * u + 0.9375;
  } else {
    const u = x - 2.625 / d;
    y = n * u * u + 0.984375;
  }
  // Each bounce touches 1 exactly on paper; in doubles it can land a hair above.
  return y < 1 ? y : 1;
}

/**
 * A CSS `cubic-bezier(x1, y1, x2, y2)` timing curve, so a curve designed in a
 * browser's devtools moves the same here. `x1` and `x2` are held to 0..1 (as
 * CSS requires: outside it the curve would go back in time and have two
 * answers for one moment); `y1` and `y2` may overshoot but are held to ±10,
 * past which a layer would only be flung off the frame. A non-finite control
 * value falls back to the linear curve's.
 *
 * Solving for the curve's parameter is Newton's method, used only where the
 * curve is steep enough for it to be trusted, and bisection everywhere else,
 * so a flat stretch (x1 = 1, x2 = 0) cannot throw it off: the parameter is
 * found to 1e-9 wherever time moves at all, and even where it stops dead the
 * result is within 2e-6, which is what doubles can resolve there.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const ax = clamp(finite(x1, 0), 0, 1);
  const bx = clamp(finite(x2, 1), 0, 1);
  const ay = clamp(finite(y1, 0), -10, 10);
  const by = clamp(finite(y2, 1), -10, 10);
  const cx = 3 * ax;
  const bxc = 3 * (bx - ax) - cx;
  const axc = 1 - cx - bxc;
  const cy = 3 * ay;
  const byc = 3 * (by - ay) - cy;
  const ayc = 1 - cy - byc;
  const X = (t: number) => ((axc * t + bxc) * t + cx) * t;
  const Y = (t: number) => ((ayc * t + byc) * t + cy) * t;
  const dX = (t: number) => (3 * axc * t + 2 * bxc) * t + cx;
  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = dX(t);
      if (!(Math.abs(d) >= 1e-3)) break;
      const e = X(t) - x;
      if (Math.abs(e) < 1e-12) return t;
      t -= e / d;
      if (!(t >= 0 && t <= 1)) break;
    }
    // X is non-decreasing on 0..1 when x1 and x2 are, so halving always closes in.
    let lo = 0;
    let hi = 1;
    while (hi - lo > 1e-10) {
      const m = (lo + hi) / 2;
      if (X(m) < x) lo = m;
      else hi = m;
    }
    // Where X is flat, a whole band of t evaluates to exactly x. Its first
    // edge is 3e-6 off at the flattest curve CSS allows (1, 0, 0, 1); its
    // middle is less than half that, so the last edge is found too.
    const first = (lo + hi) / 2;
    hi = 1;
    while (hi - lo > 1e-10) {
      const m = (lo + hi) / 2;
      if (X(m) <= x) lo = m;
      else hi = m;
    }
    return (first + (lo + hi) / 2) / 2;
  };
  return ends((x) => Y(solve(x)));
}

/** Where a spring is blended onto its rest; see `spring`. */
const SETTLE = 0.94;

/**
 * The motion of a weight on a spring let go from rest: it overshoots, comes
 * back, and settles, which reads as physical in a way no polynomial does.
 * `damping` is the damping ratio, held to 0.05..0.95 (0.55 overshoots about
 * 12%; at 1 a spring no longer overshoots, and `out` is that curve).
 * `cycles` is how many of its damped swings fit in the curve, held to
 * 0.25..20: more is stiffer and settles sooner.
 *
 * A real spring never arrives. Left alone the last frame would stop short of
 * 1 (by 4e-6 at the defaults, visibly for a loose spring) and the layer would
 * jump as the effect hands over to the resting pose, so the last 6% is eased
 * onto exactly 1.
 */
export function spring(damping = 0.55, cycles = 3): EaseFn {
  const z = clamp(finite(damping, 0.55), 0.05, 0.95);
  const wd = TAU * clamp(finite(cycles, 3), 0.25, 20);
  const rt = Math.sqrt(1 - z * z);
  const decay = (z * wd) / rt;
  const k = z / rt;
  return ends((x) => {
    const y = 1 - Math.exp(-decay * x) * (Math.cos(wd * x) + k * Math.sin(wd * x));
    return x < SETTLE ? y : y + (1 - y) * smoothstep(SETTLE, 1, x);
  });
}

/**
 * The words of `EASES`, each a curve. Typed against `EaseName` so that a word
 * added to the list the model chooses from fails the build here until it has
 * a curve, rather than quietly easing as `out`.
 */
const NAMED: Record<EaseName, EaseFn> = {
  linear: ends((x) => x),
  in: ends((x) => x * x * x),
  out: ends((x) => 1 - (1 - x) ** 3),
  inout: ends((x) => (x < 0.5 ? 4 * x * x * x : 1 - (2 - 2 * x) ** 3 / 2)),
  soft: ends((x) => (1 - Math.cos(Math.PI * x)) / 2),
  'cubic-out': ends((x) => 1 - (1 - x) ** 3),
  'quart-out': ends((x) => 1 - (1 - x) ** 4),
  'expo-out': ends((x) => 1 - expoIn(1 - x)),
  'expo-inout': ends((x) => (x < 0.5 ? expoIn(2 * x) / 2 : 1 - expoIn(2 - 2 * x) / 2)),
  'circ-out': ends((x) => Math.sqrt(Math.max(0, 1 - (x - 1) ** 2))),
  'back-out': ends((x) => 1 + C3 * (x - 1) ** 3 + C1 * (x - 1) ** 2),
  'back-inout': ends((x) => (x < 0.5
    ? ((2 * x) ** 2 * ((C2 + 1) * 2 * x - C2)) / 2
    : ((2 * x - 2) ** 2 * ((C2 + 1) * (2 * x - 2) + C2) + 2) / 2)),
  'elastic-out': ends((x) => Math.pow(2, -10 * x) * Math.sin((10 * x - 0.75) * (TAU / 3)) + 1),
  'bounce-out': ends(bounceOut),
  spring: spring(),
  snappy: bezier(0.16, 1, 0.3, 1),
};

const EASE_NUM = '([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)';
const BEZIER = new RegExp(`^(?:cubic-)?bezier\\(\\s*${EASE_NUM}\\s*,\\s*${EASE_NUM}\\s*,\\s*${EASE_NUM}\\s*,\\s*${EASE_NUM}\\s*\\)$`);

function knownEase(name: unknown): EaseFn | null {
  if (typeof name !== 'string') return null;
  const s = name.trim().toLowerCase();
  // An own-property check, so `constructor` or `__proto__` is not a curve.
  if (Object.prototype.hasOwnProperty.call(NAMED, s)) return NAMED[s as EaseName];
  const m = BEZIER.exec(s);
  if (!m) return null;
  const v = [m[1], m[2], m[3], m[4]].map(Number);
  return v.every(Number.isFinite) ? bezier(v[0], v[1], v[2], v[3]) : null;
}

/**
 * The curve a word names: any of `EASES`, or `bezier(x1,y1,x2,y2)` (also as
 * CSS spells it, `cubic-bezier(…)`), case and spacing aside. Anything else is
 * `out`, the default an effect is designed with, so a misspelt ease still
 * arrives and settles instead of failing the frame.
 */
export function easeOf(name: string): EaseFn {
  return knownEase(name) ?? NAMED.out;
}

/**
 * Whether `easeOf` knows a word rather than falling back to `out`. The reader
 * repairs an unknown ease with this, so the words it keeps and the words the
 * maths understands can never disagree.
 */
export function isEase(name: string): boolean {
  return knownEase(name) !== null;
}

// ── colour ────────────────────────────────────────────────────────────────

/** A colour's channels: `r`, `g`, `b` from 0 to 255 (not rounded, so a mix of mixes does not drift), `a` from 0 to 1. */
export interface RGBA { r: number; g: number; b: number; a: number }

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
const FN = /^(rgba?|hsla?)\(([^()]*)\)$/;
const CNUM = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/;

/** A number token, or a percentage of `full`; null when it is neither. */
function amount(tok: string, full: number): number | null {
  const pct = tok.endsWith('%');
  const body = pct ? tok.slice(0, -1) : tok;
  if (!CNUM.test(body)) return null;
  const v = Number(body);
  if (!Number.isFinite(v)) return null;
  return pct ? (v / 100) * full : v;
}

/** A hue token in degrees: bare, or with a CSS angle unit. */
function hueOf(tok: string): number | null {
  const m = /^(.*?)(deg|grad|rad|turn)?$/.exec(tok);
  if (!m || !CNUM.test(m[1])) return null;
  const v = Number(m[1]);
  if (!Number.isFinite(v)) return null;
  if (m[2] === 'rad') return (v * 180) / Math.PI;
  if (m[2] === 'grad') return v * 0.9;
  if (m[2] === 'turn') return v * 360;
  return v;
}

/**
 * The inside of `rgb(…)` or `hsl(…)` as three channel tokens and an optional
 * alpha: either the comma form (`1, 2, 3, 0.5`) or the space form with a slash
 * (`1 2 3 / 50%`). Mixing the two, or any count but three, is not a colour.
 */
function colourArgs(inner: string): { ch: string[]; alpha: string | null } | null {
  if (inner.includes(',')) {
    const parts = inner.split(',').map((p) => p.trim());
    if (parts.length < 3 || parts.length > 4 || parts.some((p) => !p || /\s|\//.test(p))) return null;
    return { ch: parts.slice(0, 3), alpha: parts.length === 4 ? parts[3] : null };
  }
  const halves = inner.split('/');
  if (halves.length > 2) return null;
  const ch = halves[0].trim().split(/\s+/);
  if (ch.length !== 3 || ch.some((p) => !p)) return null;
  if (halves.length === 1) return { ch, alpha: null };
  const alpha = halves[1].trim();
  return alpha && !/\s/.test(alpha) ? { ch, alpha } : null;
}

/** HSL (hue in degrees, saturation and lightness 0..1) as sRGB channels 0..255. */
function rgbOfHsl(h: number, s: number, l: number): [number, number, number] {
  const hh = wrap(h, 360);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    return (l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return [f(0), f(8), f(4)];
}

/**
 * A CSS colour as channels, or null when it is not one: `#rgb`, `#rgba`,
 * `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` and `hsl()`/`hsla()` (commas or
 * spaces, percentages, a slash before alpha), and the words `white`, `black`
 * and `transparent`, case and spacing aside. Only these: the other colour
 * words would be one more list for the reader and the model to disagree
 * about, and a palette is hex. Channels out of range are clamped, as CSS does.
 * Never throws, whatever it is handed, so a document can be checked with it;
 * nothing over 200 characters is a colour, which keeps the checking cheap.
 */
export function parseColor(s: string): RGBA | null {
  if (typeof s !== 'string' || s.length > 200) return null;
  const c = s.trim().toLowerCase();
  if (c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
  if (c === 'white') return { r: 255, g: 255, b: 255, a: 1 };
  if (c === 'black') return { r: 0, g: 0, b: 0, a: 1 };
  const hex = HEX.exec(c);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = h.split('').map((d) => d + d).join('');
    const byte = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: byte(0), g: byte(2), b: byte(4), a: h.length === 8 ? byte(6) / 255 : 1 };
  }
  const fn = FN.exec(c);
  if (!fn) return null;
  const args = colourArgs(fn[2]);
  if (!args) return null;
  let a = 1;
  if (args.alpha !== null) {
    const v = amount(args.alpha, 1);
    if (v === null) return null;
    a = clamp01(v);
  }
  if (fn[1].startsWith('rgb')) {
    const ch = args.ch.map((t) => amount(t, 255));
    if (ch.some((v) => v === null)) return null;
    const [r, g, b] = ch.map((v) => clamp(v as number, 0, 255));
    return { r, g, b, a };
  }
  const h = hueOf(args.ch[0]);
  const sat = amount(args.ch[1], 100);
  const lig = amount(args.ch[2], 100);
  if (h === null || sat === null || lig === null) return null;
  const [r, g, b] = rgbOfHsl(h, clamp(sat, 0, 100) / 100, clamp(lig, 0, 100) / 100);
  return { r, g, b, a };
}

const byteHex = (v: number) => v.toString(16).padStart(2, '0');

/**
 * Channels as the shortest CSS a canvas takes: `#rrggbb` when opaque,
 * `rgba(r,g,b,a)` otherwise (alpha to three places). Every field is made safe
 * first, NaN channels as 0 and a NaN alpha as opaque, because this string goes
 * straight to `fillStyle`, and a colour the canvas cannot read is not an
 * error: it keeps the previous colour and paints the wrong thing.
 */
export function cssOf(c: RGBA): string {
  const ch = (v: unknown) => Math.round(clamp(finite(v, 0), 0, 255));
  const r = ch(c?.r);
  const g = ch(c?.g);
  const b = ch(c?.b);
  const a = Math.round(clamp01(finite(c?.a, 1)) * 1000) / 1000;
  if (a >= 1) return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`;
  return `rgba(${r},${g},${b},${a})`;
}

/** Any colour `parseColor` reads, as `#RRGGBB` for a colour field (alpha dropped); null when it is not a colour. */
export function hexOf(s: string): string | null {
  const c = parseColor(s);
  return c ? cssOf({ ...c, a: 1 }).toUpperCase() : null;
}

/**
 * Between two colours: 0 is `a`, 1 is `b`, `t` held to 0..1. Linear in sRGB
 * with alpha, the channels weighted by it (premultiplied, as CSS gradients
 * are), so fading a colour toward `transparent` keeps its hue instead of
 * passing through a grey fringe. An unreadable colour gives the other one;
 * two give black, rather than a string the canvas would ignore.
 */
export function mixColors(a: string, b: string, t: number): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return x ? cssOf(x) : y ? cssOf(y) : '#000000';
  const u = clamp01(t);
  const al = lerp(x.a, y.a, u);
  if (!(al > 0)) return cssOf({ r: lerp(x.r, y.r, u), g: lerp(x.g, y.g, u), b: lerp(x.b, y.b, u), a: 0 });
  const ch = (p: number, q: number) => lerp(p * x.a, q * y.a, u) / al;
  return cssOf({ r: ch(x.r, y.r), g: ch(x.g, y.g), b: ch(x.b, y.b), a: al });
}

/**
 * The same colour at another opacity: `alpha` replaces the colour's own,
 * which is what a fade or a shadow tint means. A NaN `alpha` keeps the
 * colour's own; an unreadable colour is black at that alpha, as `mixColors`
 * falls back to black.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 };
  return cssOf({ ...c, a: clamp01(finite(alpha, c.a)) });
}

/** An sRGB channel (0–255) as linear light, with WCAG's threshold. */
const toLinear = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/**
 * WCAG relative luminance, 0 (black) to 1 (white). Alpha is ignored: what a
 * translucent colour looks like depends on what is under it, which this cannot
 * know. An unreadable colour counts as black, the conservative guess for text.
 */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** WCAG contrast ratio, 1 to 21, symmetric; 4.5 is the line words must clear on their ground. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Whichever of `light` and `dark` reads better on `bg`, returned as given: how
 * a label on a bar or a number in a badge stays legible whatever colour the
 * palette gave the ground. A tie goes to `light`.
 */
export function readableOn(bg: string, light: string, dark: string): string {
  return contrast(bg, light) >= contrast(bg, dark) ? light : dark;
}

// ── randomness and noise ──────────────────────────────────────────────────

/** murmur3's finaliser: every input bit reaches every output bit. */
function avalanche(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/**
 * A number as 32 bits that depend on all of it. `x >>> 0` alone would make
 * seeds 1.2 and 1.7 one stream, and -1 the same as 2^32 - 1, so the fraction
 * and the part above 32 bits are each scrambled and folded in (plain XOR of
 * the parts made -1 and 2^32 + 1 collide). A whole number from 0 to 2^32 is
 * itself. Not finite is 0.
 */
function bits(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const whole = Math.floor(x);
  const part = x - whole;
  const high = Math.floor(whole / 4294967296);
  let h = whole | 0;
  if (high !== 0) h ^= avalanche((high | 0) ^ 0x632be5ab);
  if (part !== 0) h ^= avalanche(Math.floor(part * 4294967296) ^ 0x2545f491);
  return h;
}

/**
 * A seeded stream of numbers in [0, 1) (mulberry32): the only randomness a
 * frame may use, since `Math.random` would make every render of the same
 * moment a different picture. Any finite seed works, negatives and fractions
 * included and each its own stream; a non-finite seed is 0.
 *
 * The seed is scrambled (murmur3's finaliser, which is one-to-one) before it
 * becomes the state. Seeded directly, mulberry32's first value repeats across
 * neighbouring seeds (a fifth of seeds 0 to 400000 share it with another), and
 * a stream per particle, `rng(seed + i)`, would clump the particles.
 */
export function rng(seed: number): () => number {
  let a = avalanche(bits(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A number in [0, 1) that is a pure function of up to three numbers: the
 * random value a particle or a lattice point has without a stream to draw
 * from, so particle 212 at frame 90 needs nothing computed for the 211 before
 * it. Order matters (`hash01(1, 2)` is not `hash01(2, 1)`), and fractions and
 * negatives count, as they do for `rng`.
 */
export function hash01(a: number, b = 0, c = 0): number {
  let h = avalanche((bits(a) + 0x9e3779b9) | 0);
  h = avalanche(((h ^ bits(b)) + 0x7f4a7c15) | 0);
  h = avalanche(((h ^ bits(c)) + 0x165667b1) | 0);
  return (h >>> 0) / 4294967296;
}

/** 6t⁵ - 15t⁴ + 10t³: flat at both ends in slope and curvature, so noise has no creases along its lattice. */
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Smooth value noise along a line, in [-1, 1]: a drift or a flicker that is
 * the same on every render of a frame. Continuous with continuous slope, and
 * a new value about once per unit of `x`. A non-finite `x` reads as 0.
 */
export function noise1(x: number, seed = 0): number {
  const X = finite(x, 0);
  const i = Math.floor(X);
  const a = hash01(i, seed, 0x51ed);
  const b = hash01(i + 1, seed, 0x51ed);
  return (a + (b - a) * fade(X - i)) * 2 - 1;
}

/** `noise1` over a plane, in [-1, 1]: an aurora's folds, a field of drifting dots. A non-finite coordinate reads as 0. */
export function noise2(x: number, y: number, seed = 0): number {
  const X = finite(x, 0);
  const Y = finite(y, 0);
  const i = Math.floor(X);
  const j = Math.floor(Y);
  const u = fade(X - i);
  const v = fade(Y - j);
  const c00 = hash01(i, j, seed);
  const c10 = hash01(i + 1, j, seed);
  const c01 = hash01(i, j + 1, seed);
  const c11 = hash01(i + 1, j + 1, seed);
  const top = c00 + (c10 - c00) * u;
  const bottom = c01 + (c11 - c01) * u;
  return (top + (bottom - top) * v) * 2 - 1;
}

/**
 * `noise2` in octaves, each twice as fine and half as strong (1 to 8, from
 * `octaves`), divided by their total strength so the result stays within
 * [-1, 1] however many are asked for: large soft shapes with detail on them.
 * Each octave is shifted and seeded apart, so their lattices do not line up
 * into a visible grid at the origin.
 */
export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  const n = Math.round(clamp(finite(octaves, 4), 1, 8));
  const X = finite(x, 0);
  const Y = finite(y, 0);
  const s = finite(seed, 0);
  let sum = 0;
  let total = 0;
  let amp = 1;
  let f = 1;
  for (let o = 0; o < n; o++) {
    sum += amp * noise2(X * f + o * 17.31, Y * f - o * 9.73, s + o * 1013);
    total += amp;
    amp /= 2;
    f *= 2;
  }
  return sum / total;
}

// ── paths: reading ────────────────────────────────────────────────────────

/**
 * One step of a path, in absolute coordinates: `M` and `L` carry [x, y], `C`
 * [x1, y1, x2, y2, x, y], `Z` nothing. Every SVG command, arcs included,
 * becomes one of these four, so the length, trim and drawing code has four
 * cases instead of twenty, and every piece stays exact under any affine
 * transform (an elliptical arc stretched unevenly is no longer an arc; a cubic
 * is still a cubic).
 */
export type Seg = { t: 'M' | 'L' | 'C' | 'Z'; p: number[] };

/**
 * No coordinate this module reads or hands back is farther out than this:
 * `parsePath` refuses a path that goes past it, and every other function
 * holds a hand-built or transformed path to it. It is no drawing's size, and
 * it keeps every square the arc and length maths takes far from overflow (a
 * coordinate of 1e300 squared is Infinity, and the next step makes it NaN).
 */
const MAX_COORD = 1e9;

/** A coordinate as every path function here keeps it: finite (NaN as 0) and inside ±`MAX_COORD`. */
const coordOf = (v: unknown) => clamp(finite(v, 0), -MAX_COORD, MAX_COORD);

const COMMANDS = 'MmZzLlHhVvCcSsQqTtAa';

/**
 * An SVG arc, given as its endpoints (the path syntax), as cubic Béziers of
 * at most 90° each, `[x1, y1, x2, y2, x, y]` per piece: the SVG spec's own
 * conversion from endpoints to a centre and angles (its arc implementation
 * notes), including scaling the radii up when they are too small to reach
 * from one end to the other.
 * The last piece ends exactly on the given endpoint, so relative commands
 * after it do not inherit a rounding. `[]` when the ends coincide (the spec
 * draws nothing); null when it is a straight line (a zero radius) or the
 * numbers overflow, which the caller draws as a line.
 */
function arcToCubics(
  x1: number, y1: number, rx0: number, ry0: number, deg: number,
  large: boolean, sweep: boolean, x2: number, y2: number,
): number[][] | null {
  if (x1 === x2 && y1 === y2) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (!(rx > 0 && ry > 0)) return null;
  const phi = (wrap(deg, 360) * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const hx = (x1 - x2) / 2;
  const hy = (y1 - y2) / 2;
  const px = cos * hx + sin * hy;
  const py = -sin * hx + cos * hy;
  const lam = (px * px) / (rx * rx) + (py * py) / (ry * ry);
  if (!Number.isFinite(lam)) return null;
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const rxx = rx * rx;
  const ryy = ry * ry;
  const den = rxx * py * py + ryy * px * px;
  let co = den > 0 ? Math.sqrt(Math.max(0, (rxx * ryy - den) / den)) : 0;
  if (large === sweep) co = -co;
  const cxp = (co * rx * py) / ry;
  const cyp = (-co * ry * px) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ux = (px - cxp) / rx;
  const uy = (py - cyp) / ry;
  const vx = (-px - cxp) / rx;
  const vy = (-py - cyp) / ry;
  const start = Math.atan2(uy, ux);
  let span = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweep && span > 0) span -= TAU;
  else if (sweep && span < 0) span += TAU;
  const n = Math.max(1, Math.ceil(Math.abs(span) / (Math.PI / 2) - 1e-9));
  const step = span / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const at = (X: number, Y: number): [number, number] =>
    [cx + rx * cos * X - ry * sin * Y, cy + rx * sin * X + ry * cos * Y];
  const out: number[][] = [];
  for (let j = 0; j < n; j++) {
    const a = start + step * j;
    const b = j === n - 1 ? start + span : a + step;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    const [ax, ay] = at(ca - k * sa, sa + k * ca);
    const [bx, by] = at(cb + k * sb, sb - k * cb);
    const [ex, ey] = j === n - 1 ? [x2, y2] : at(cb, sb);
    out.push([ax, ay, bx, by, ex, ey]);
  }
  return out.every((p) => p.every(Number.isFinite)) ? out : null;
}

/**
 * SVG path data (`d`) as absolute segments, or null when it is not a path.
 *
 * The whole grammar, because a model writing `d` writes whatever a designer
 * would: all of `M L H V C S Q T A Z` in both cases; a command repeated by
 * listing more numbers (after `M`, those are lines); numbers run together
 * (`.5.5` is two, `-.5-.5` is two, `1e-3` is one) and arc flags with no
 * separator (`a1 1 0 00.5.5`). `H`/`V` become lines, `S`/`T` reflect the
 * previous control point as the spec says (only after their own kind), a
 * quadratic is raised to the cubic that draws exactly the same curve, and an
 * arc becomes cubics. A drawing command after `Z` starts its new subpath
 * with an explicit `M`, so every subpath here begins with one.
 *
 * Null, never a throw and never half a path, for anything malformed: not a
 * string, empty, not starting with `M`/`m`, an unknown letter, a missing or
 * non-finite number, a flag that is not 0 or 1, a number or a point past a
 * billion, or more than `maxSegs` segments (the model's output is input, and
 * a path of a million segments would stall every frame it is in).
 */
export function parsePath(d: string, maxSegs = 2000): Seg[] | null {
  if (typeof d !== 'string') return null;
  const cap = Math.floor(clamp(finite(maxSegs, 2000), 0, 1e6));
  const n = d.length;
  const out: Seg[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let kx = 0;
  let ky = 0;
  let qx = 0;
  let qy = 0;
  let prev = '';
  let reopen = false;

  const skip = () => {
    while (i < n) {
      const c = d.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 44) i++;
      else break;
    }
  };
  const digit = (c: number) => c >= 48 && c <= 57;
  const num = (): number | null => {
    skip();
    const from = i;
    let c = d.charCodeAt(i);
    if (c === 43 || c === 45) c = d.charCodeAt(++i);
    let digits = 0;
    while (digit(c)) { digits++; c = d.charCodeAt(++i); }
    if (c === 46) {
      c = d.charCodeAt(++i);
      while (digit(c)) { digits++; c = d.charCodeAt(++i); }
    }
    if (!digits) return null;
    if (c === 101 || c === 69) {
      let j = i + 1;
      let e = d.charCodeAt(j);
      if (e === 43 || e === 45) e = d.charCodeAt(++j);
      if (!digit(e)) return null;
      while (digit(e)) e = d.charCodeAt(++j);
      i = j;
    }
    const v = Number(d.slice(from, i));
    return Number.isFinite(v) && Math.abs(v) <= MAX_COORD ? v : null;
  };
  const flag = (): boolean | null => {
    skip();
    const c = d.charCodeAt(i);
    if (c !== 48 && c !== 49) return null;
    i++;
    return c === 49;
  };
  const more = (): boolean => {
    skip();
    const c = d.charCodeAt(i);
    return digit(c) || c === 46 || c === 43 || c === 45;
  };
  const draw = (seg: Seg, x: number, y: number) => {
    if (reopen) {
      out.push({ t: 'M', p: [cx, cy] });
      reopen = false;
    }
    out.push(seg);
    cx = x;
    cy = y;
  };
  const cubic = (x1: number, y1: number, x2: number, y2: number, x: number, y: number) =>
    draw({ t: 'C', p: [x1, y1, x2, y2, x, y] }, x, y);
  const quad = (x1: number, y1: number, x: number, y: number) =>
    cubic(cx + (2 / 3) * (x1 - cx), cy + (2 / 3) * (y1 - cy), x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y), x, y);

  for (;;) {
    skip();
    if (i >= n) break;
    const ch = d[i];
    if (!COMMANDS.includes(ch)) return null;
    const cmd = ch.toUpperCase();
    if (!out.length && cmd !== 'M') return null;
    i++;
    if (cmd === 'Z') {
      if (out[out.length - 1].t !== 'Z') out.push({ t: 'Z', p: [] });
      cx = sx;
      cy = sy;
      prev = 'Z';
      reopen = true;
      continue;
    }
    const rel = ch !== cmd;
    let first = true;
    do {
      // One back, since a move replacing a move reuses its slot.
      const mark = Math.max(0, out.length - 1);
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      let kind = cmd;
      if (cmd === 'M' || cmd === 'L') {
        const x = num();
        const y = num();
        if (x === null || y === null) return null;
        if (cmd === 'M' && first) {
          // A move straight after a move draws nothing; only the last one counts.
          if (out.length && out[out.length - 1].t === 'M') out.pop();
          out.push({ t: 'M', p: [x + ox, y + oy] });
          cx = sx = x + ox;
          cy = sy = y + oy;
          reopen = false;
        } else {
          draw({ t: 'L', p: [x + ox, y + oy] }, x + ox, y + oy);
          kind = 'L';
        }
      } else if (cmd === 'H' || cmd === 'V') {
        const v = num();
        if (v === null) return null;
        if (cmd === 'H') draw({ t: 'L', p: [v + ox, cy] }, v + ox, cy);
        else draw({ t: 'L', p: [cx, v + oy] }, cx, v + oy);
      } else if (cmd === 'C' || cmd === 'S') {
        const v: number[] = [];
        for (let k = cmd === 'C' ? 6 : 4; k > 0; k--) {
          const x = num();
          if (x === null) return null;
          v.push(x + (v.length % 2 ? oy : ox));
        }
        if (cmd === 'S') {
          const smooth = prev === 'C' || prev === 'S';
          v.unshift(smooth ? 2 * cx - kx : cx, smooth ? 2 * cy - ky : cy);
        }
        cubic(v[0], v[1], v[2], v[3], v[4], v[5]);
        kx = v[2];
        ky = v[3];
      } else if (cmd === 'Q' || cmd === 'T') {
        let x1: number;
        let y1: number;
        if (cmd === 'Q') {
          const a = num();
          const b = num();
          if (a === null || b === null) return null;
          x1 = a + ox;
          y1 = b + oy;
        } else {
          const smooth = prev === 'Q' || prev === 'T';
          x1 = smooth ? 2 * cx - qx : cx;
          y1 = smooth ? 2 * cy - qy : cy;
        }
        const x = num();
        const y = num();
        if (x === null || y === null) return null;
        quad(x1, y1, x + ox, y + oy);
        qx = x1;
        qy = y1;
      } else {
        // Read in order; once one fails the rest read nonsense, but the path is refused anyway.
        const rx = num();
        const ry = num();
        const rot = num();
        const large = flag();
        const sweep = flag();
        const x = num();
        const y = num();
        if (rx === null || ry === null || rot === null || large === null || sweep === null || x === null || y === null) return null;
        const ex = x + ox;
        const ey = y + oy;
        const pieces = arcToCubics(cx, cy, rx, ry, rot, large, sweep, ex, ey);
        if (pieces === null) draw({ t: 'L', p: [ex, ey] }, ex, ey);
        else for (const p of pieces) cubic(p[0], p[1], p[2], p[3], p[4], p[5]);
      }
      prev = kind;
      first = false;
      if (out.length > cap) return null;
      // Relative steps can walk past the limit even when every number is inside it.
      for (let k = mark; k < out.length; k++) {
        if (!out[k].p.every((v) => Math.abs(v) <= MAX_COORD)) return null;
      }
    } while (more());
  }
  return out.length ? out : null;
}

// ── paths: measuring and cutting ──────────────────────────────────────────

/**
 * The segments that are segments, each with exactly the numbers its kind
 * needs, every one finite and inside ±`MAX_COORD`, starting with an `M` (a
 * path that does not is read as starting at the origin, and says so
 * explicitly). Everything below reads paths through this, so a hand-built
 * path with a missing or absurd number cannot put a NaN into a result, and
 * every function agrees on what a malformed path means.
 */
function clean(segs: readonly Seg[]): Seg[] {
  const out: Seg[] = [];
  if (!Array.isArray(segs)) return out;
  for (const s of segs) {
    if (!s || typeof s !== 'object') continue;
    const count = s.t === 'M' || s.t === 'L' ? 2 : s.t === 'C' ? 6 : s.t === 'Z' ? 0 : -1;
    if (count < 0) continue;
    const p = Array.isArray(s.p) ? s.p : [];
    const q: number[] = [];
    for (let k = 0; k < count; k++) q.push(coordOf(p[k]));
    if (!out.length && s.t !== 'M') out.push({ t: 'M', p: [0, 0] });
    out.push({ t: s.t, p: q });
  }
  return out;
}

/**
 * A drawn stretch of a path, from its own start point: a line
 * `[x0, y0, x1, y1]` or a cubic `[x0, y0, x1, y1, x2, y2, x3, y3]`. `sub`
 * tells subpaths apart, `z` marks the edge a `Z` draws back to the start, and
 * `len` is filled in only when asked for, since measuring a cubic is the one
 * costly step.
 */
interface Piece { cubic: boolean; p: number[]; sub: number; z: boolean; len: number }

function piecesOf(segs: readonly Seg[], measure: boolean): Piece[] {
  const out: Piece[] = [];
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let sub = 0;
  let closed = false;
  for (const s of clean(segs)) {
    const p = s.p;
    if (s.t === 'M') {
      cx = sx = p[0];
      cy = sy = p[1];
      sub++;
      closed = false;
      continue;
    }
    if (s.t === 'Z') {
      if (closed) continue;
      out.push({ cubic: false, p: [cx, cy, sx, sy], sub, z: true, len: 0 });
      cx = sx;
      cy = sy;
      closed = true;
      continue;
    }
    // Drawing on after a Z starts a new subpath at the closed one's start.
    if (closed) {
      sub++;
      closed = false;
    }
    if (s.t === 'L') {
      out.push({ cubic: false, p: [cx, cy, p[0], p[1]], sub, z: false, len: 0 });
      cx = p[0];
      cy = p[1];
    } else {
      out.push({ cubic: true, p: [cx, cy, p[0], p[1], p[2], p[3], p[4], p[5]], sub, z: false, len: 0 });
      cx = p[4];
      cy = p[5];
    }
  }
  if (measure) {
    for (const pc of out) {
      const p = pc.p;
      pc.len = pc.cubic ? cubicLength(p, 0, 1) : Math.hypot(p[2] - p[0], p[3] - p[1]);
    }
  }
  return out;
}

// Gauss–Legendre, five points: exact for polynomials to degree 9.
const GX = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GW = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];

/** A cubic's velocity at `t`. */
function velocity(p: readonly number[], t: number): [number, number] {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return [
    a * (p[2] - p[0]) + b * (p[4] - p[2]) + c * (p[6] - p[4]),
    a * (p[3] - p[1]) + b * (p[5] - p[3]) + c * (p[7] - p[5]),
  ];
}

/** `|velocity|`, without the array: the length integrals call it most. */
function speed(p: readonly number[], t: number): number {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  const dx = a * (p[2] - p[0]) + b * (p[4] - p[2]) + c * (p[6] - p[4]);
  const dy = a * (p[3] - p[1]) + b * (p[5] - p[3]) + c * (p[7] - p[5]);
  return Math.sqrt(dx * dx + dy * dy);
}

function gauss(p: readonly number[], a: number, b: number): number {
  const m = (a + b) / 2;
  const r = (b - a) / 2;
  let s = 0;
  for (let k = 0; k < 5; k++) s += GW[k] * speed(p, m + r * GX[k]);
  return s * r;
}

/**
 * A cubic's arc length from parameter `a` to `b`: Gauss–Legendre, halved
 * where the halves disagree with the whole. Integrating the speed keeps it
 * scale-free: summing a flattened polyline would measure a unit circle with a
 * tolerance meant for pixels, and short.
 */
function cubicLength(p: readonly number[], a: number, b: number, whole = gauss(p, a, b), depth = 0): number {
  const m = (a + b) / 2;
  const l = gauss(p, a, m);
  const r = gauss(p, m, b);
  if (depth >= 10 || Math.abs(l + r - whole) <= 1e-7 * (l + r)) return l + r;
  return cubicLength(p, a, m, l, depth + 1) + cubicLength(p, m, b, r, depth + 1);
}

/**
 * The parameter at which a cubic of length `len` has covered `s`: Newton's
 * method inside a bracket that halves whenever a step would leave it, so a
 * cusp (speed 0) cannot send it astray.
 */
function paramAt(p: readonly number[], s: number, len: number): number {
  if (!(s > 0)) return 0;
  if (!(s < len)) return 1;
  let lo = 0;
  let hi = 1;
  let t = s / len;
  for (let k = 0; k < 60; k++) {
    const e = cubicLength(p, 0, t) - s;
    if (Math.abs(e) <= 1e-10 * len) break;
    if (e < 0) lo = t;
    else hi = t;
    const next = t - e / speed(p, t);
    t = next > lo && next < hi ? next : (lo + hi) / 2;
    if (hi - lo < 1e-13) break;
  }
  return t;
}

function pointOn(p: readonly number[], t: number): [number, number] {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

/** A cubic cut in two at `t` (de Casteljau): both halves are exact pieces of the same curve. */
function split(p: readonly number[], t: number): [number[], number[]] {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = p;
  const ax = x0 + (x1 - x0) * t;
  const ay = y0 + (y1 - y0) * t;
  const bx = x1 + (x2 - x1) * t;
  const by = y1 + (y2 - y1) * t;
  const cx = x2 + (x3 - x2) * t;
  const cy = y2 + (y3 - y2) * t;
  const dx = ax + (bx - ax) * t;
  const dy = ay + (by - ay) * t;
  const ex = bx + (cx - bx) * t;
  const ey = by + (cy - by) * t;
  const fx = dx + (ex - dx) * t;
  const fy = dy + (ey - dy) * t;
  return [[x0, y0, ax, ay, dx, dy, fx, fy], [fx, fy, ex, ey, cx, cy, x3, y3]];
}

/**
 * The piece of a cubic between parameters `t0` and `t1`, as a cubic of its
 * own. Two cuts a rounding apart can arrive with `t0` a hair past `t1`; the
 * piece is then a point rather than a sliver extrapolated off the curve.
 */
function cut(p: readonly number[], t0: number, t1: number): number[] {
  let q = t1 < 1 ? split(p, t1)[0] : p.slice();
  if (t0 > 0 && t1 > 0) q = split(q, Math.min(1, t0 / t1))[1];
  return q;
}

/** The angle of a cubic's direction at `t`, which a zero velocity (a control point on its end point) does not have: the nearby direction, then the chord, stands in. */
function heading(p: readonly number[], t: number): number {
  let [dx, dy] = velocity(p, t);
  const size = Math.abs(p[2] - p[0]) + Math.abs(p[3] - p[1]) + Math.abs(p[4] - p[2])
    + Math.abs(p[5] - p[3]) + Math.abs(p[6] - p[4]) + Math.abs(p[7] - p[5]);
  if (Math.hypot(dx, dy) <= 1e-9 * size) [dx, dy] = velocity(p, t < 0.5 ? t + 1e-4 : t - 1e-4);
  if (dx === 0 && dy === 0) {
    dx = p[6] - p[0];
    dy = p[7] - p[1];
  }
  return Math.atan2(dy, dx);
}

/**
 * A path's length, arcs and curves measured along the curve rather than a
 * flattened copy of it, so it is right at any scale (a path in u and the same
 * path in pixels differ only by the factor). A closing `Z` edge counts; a
 * move does not.
 */
export function pathLength(segs: readonly Seg[]): number {
  let total = 0;
  for (const pc of piecesOf(segs, true)) total += pc.len;
  return total;
}

/** `pathLength` under the name the drawing code reaches for when it sets a dash to the stroke's length. */
export const strokeLength: (segs: readonly Seg[]) => number = pathLength;

/**
 * The part of a path from `from` to `to`, both fractions of its length (held
 * to 0..1): what a `draw` effect strokes as it goes. The result is new
 * segments, curves cut exactly (de Casteljau at the parameter where the
 * length falls), so a half-drawn circle is still a round circle, not a
 * polygon. A cut crosses subpaths as the length does, each piece starting
 * with its own `M`; a closed subpath is cut open, its closing edge becoming a
 * line. All of it (0 to 1) is the path as it was, `Z` and all, so the
 * finished stroke joins at its corners exactly as designed. Empty when
 * `from >= to` or the path has no length.
 */
export function trimPath(segs: readonly Seg[], from: number, to: number): Seg[] {
  const a = clamp01(from);
  const b = clamp01(to);
  if (!(a < b)) return [];
  if (a === 0 && b === 1) return clean(segs);
  const pieces = piecesOf(segs, true);
  let total = 0;
  for (const pc of pieces) total += pc.len;
  if (!(total > 0)) return [];
  const s0 = a * total;
  const s1 = b * total;
  const out: Seg[] = [];
  let at = 0;
  let sub = NaN;
  for (const pc of pieces) {
    const start = at;
    at += pc.len;
    if (!(pc.len > 0) || at <= s0 || start >= s1) continue;
    const u0 = Math.max(0, s0 - start);
    const u1 = Math.min(pc.len, s1 - start);
    if (!(u1 > u0)) continue;
    const p = pc.p;
    let q: number[];
    if (pc.cubic) {
      q = cut(p, paramAt(p, u0, pc.len), paramAt(p, u1, pc.len));
    } else {
      const f0 = u0 / pc.len;
      const f1 = u1 / pc.len;
      q = [lerp(p[0], p[2], f0), lerp(p[1], p[3], f0), lerp(p[0], p[2], f1), lerp(p[1], p[3], f1)];
    }
    if (pc.sub !== sub) {
      out.push({ t: 'M', p: [q[0], q[1]] });
      sub = pc.sub;
    }
    out.push(pc.cubic ? { t: 'C', p: q.slice(2) } : { t: 'L', p: [q[2], q[3]] });
  }
  return out;
}

/**
 * Where a path is at a fraction of its length (held to 0..1), and which way
 * it is heading there, in radians from +x (clockwise on screen, since y runs
 * down): a dot riding a line chart, an arrowhead on a drawn stroke. A path
 * with no length is its first point, heading 0.
 */
export function pointAt(segs: readonly Seg[], f: number): { x: number; y: number; angle: number } {
  const pieces = piecesOf(segs, true);
  if (!pieces.length) {
    const m = clean(segs)[0];
    return m ? { x: m.p[0], y: m.p[1], angle: 0 } : { x: 0, y: 0, angle: 0 };
  }
  let total = 0;
  for (const pc of pieces) total += pc.len;
  if (!(total > 0)) return { x: pieces[0].p[0], y: pieces[0].p[1], angle: 0 };
  const s = clamp01(f) * total;
  let at = 0;
  let pick = pieces[0];
  let local = 0;
  for (const pc of pieces) {
    if (!(pc.len > 0)) continue;
    pick = pc;
    local = s - at;
    if (s <= at + pc.len) break;
    at += pc.len;
  }
  const p = pick.p;
  local = clamp(local, 0, pick.len);
  if (!pick.cubic) {
    const g = local / pick.len;
    return { x: lerp(p[0], p[2], g), y: lerp(p[1], p[3], g), angle: Math.atan2(p[3] - p[1], p[2] - p[0]) };
  }
  const t = paramAt(p, local, pick.len);
  const [x, y] = pointOn(p, t);
  return { x, y, angle: heading(p, t) };
}

/** Parameters in (0, 1) where one coordinate of a cubic turns back, with the stable form of the quadratic formula. */
function turns(a: number, b: number, c: number, d: number): number[] {
  const A = -a + 3 * b - 3 * c + d;
  const B = 2 * (a - 2 * b + c);
  const C = b - a;
  const out: number[] = [];
  const keep = (t: number) => {
    if (t > 0 && t < 1) out.push(t);
  };
  if (A === 0) {
    if (B !== 0) keep(-C / B);
    return out;
  }
  const disc = B * B - 4 * A * C;
  if (disc < 0) return out;
  const q = -0.5 * (B + (B < 0 ? -1 : 1) * Math.sqrt(disc));
  keep(q / A);
  if (q !== 0) keep(C / q);
  return out;
}

/**
 * The box a path's ink occupies: curves by their true extremes, not their
 * control points, which can lie far outside a gentle curve and would make a
 * path fitted to its box look shrunk. A move that draws nothing does not
 * count unless nothing is drawn at all. An empty path is a zero box at 0,0.
 */
export function pathBounds(segs: readonly Seg[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  const pieces = piecesOf(segs, false);
  for (const pc of pieces) {
    const p = pc.p;
    add(p[0], p[1]);
    if (!pc.cubic) {
      add(p[2], p[3]);
      continue;
    }
    add(p[6], p[7]);
    for (const t of turns(p[0], p[2], p[4], p[6]).concat(turns(p[1], p[3], p[5], p[7]))) {
      const [x, y] = pointOn(p, t);
      add(x, y);
    }
  }
  if (!pieces.length) for (const s of clean(segs)) if (s.t === 'M') add(s.p[0], s.p[1]);
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Points a flattening may make in all, and halvings per curve (1024 pieces,
 * where a 4000 px curve held to a hundredth of a pixel needs about 220):
 * whatever the tolerance, a tiny one on a huge path must not stall a frame.
 */
const FLAT_BUDGET = 100000;
const FLAT_DEPTH = 10;

/**
 * Whether a cubic is within `tol` of its chord everywhere (the bound from
 * Willcocks' note on flattening Béziers, compared squared as `16·tol²`). It
 * measures the curve against the chord traversed at even speed, so a loop
 * whose ends meet is not flat, where "are the handles near the chord line"
 * would say it is (its chord is a point).
 */
function flatEnough(p: readonly number[], limit: number): boolean {
  const ux = 3 * p[2] - 2 * p[0] - p[6];
  const uy = 3 * p[3] - 2 * p[1] - p[7];
  const vx = 3 * p[4] - p[0] - 2 * p[6];
  const vy = 3 * p[5] - p[1] - 2 * p[7];
  return Math.max(ux * ux, vx * vx) + Math.max(uy * uy, vy * vy) <= limit;
}

function subdivide(p: readonly number[], limit: number, pts: number[], depth: number, budget: { n: number }): void {
  if (depth >= FLAT_DEPTH || budget.n <= 0 || flatEnough(p, limit)) {
    pts.push(p[6], p[7]);
    budget.n--;
    return;
  }
  const [l, r] = split(p, 0.5);
  subdivide(l, limit, pts, depth + 1, budget);
  subdivide(r, limit, pts, depth + 1, budget);
}

/**
 * A path as polylines, one per subpath, each a flat `[x, y, x, y, …]` list:
 * for anything that needs points rather than curves (particles along a
 * stroke, a hit test). Curves are halved until each piece is within `tol` of
 * a straight line, in the path's own units, so the count follows the
 * curvature. A closed polyline does not repeat its first point; `closed`
 * says the last edge runs back to it.
 */
export function flatten(segs: readonly Seg[], tol = 0.2): { pts: number[]; closed: boolean }[] {
  const t = finite(tol, 0.2);
  const limit = t > 0 ? 16 * t * t : 0;
  const out: { pts: number[]; closed: boolean }[] = [];
  const budget = { n: FLAT_BUDGET };
  let line: { pts: number[]; closed: boolean } | null = null;
  let sub = NaN;
  for (const pc of piecesOf(segs, false)) {
    if (!line || pc.sub !== sub) {
      line = { pts: [pc.p[0], pc.p[1]], closed: false };
      out.push(line);
      sub = pc.sub;
    }
    if (pc.z) {
      line.closed = true;
    } else if (pc.cubic) {
      subdivide(pc.p, limit, line.pts, 0, budget);
    } else {
      line.pts.push(pc.p[2], pc.p[3]);
      budget.n--;
    }
  }
  for (const l of out) {
    const k = l.pts.length;
    if (l.closed && k >= 4 && l.pts[k - 2] === l.pts[0] && l.pts[k - 1] === l.pts[1]) l.pts.length = k - 2;
  }
  return out;
}

// ── paths: placing and writing ────────────────────────────────────────────

/**
 * Every point of a path through the affine map `canvas.transform(a, b, c, d,
 * e, f)` applies: x' = a·x + c·y + e, y' = b·x + d·y + f. Exact for every
 * segment, since all of them are lines and cubics. A non-finite entry is the
 * identity's (1 on the diagonal, 0 elsewhere), so a bad scale leaves the path
 * where it was rather than at NaN; a result past ±1e9 is held there.
 */
export function transformPath(segs: readonly Seg[], a: number, b: number, c: number, d: number, e: number, f: number): Seg[] {
  const A = finite(a, 1);
  const B = finite(b, 0);
  const C = finite(c, 0);
  const D = finite(d, 1);
  const E = finite(e, 0);
  const F = finite(f, 0);
  return clean(segs).map((s) => {
    const q: number[] = [];
    for (let k = 0; k < s.p.length; k += 2) {
      q.push(coordOf(A * s.p[k] + C * s.p[k + 1] + E), coordOf(B * s.p[k] + D * s.p[k + 1] + F));
    }
    return { t: s.t, p: q };
  });
}

/**
 * A path drawn in the 100 × 100 box a `path` shape's `d` is written in, mapped
 * onto a `w` × `h` box centred on the origin, where the drawing code has
 * already moved to the layer's centre. Stretched to the box, not fitted by
 * aspect: the shape's `w` and `h` are what the person set. A negative size
 * mirrors; a non-finite one is 0 and collapses the path rather than NaN it.
 */
export function fitPath(segs: readonly Seg[], w: number, h: number): Seg[] {
  const sx = clamp(finite(w, 0), -1e6, 1e6) / 100;
  const sy = clamp(finite(h, 0), -1e6, 1e6) / 100;
  return transformPath(segs, sx, 0, 0, sy, -50 * sx, -50 * sy);
}

/**
 * A coordinate to a millionth, which no canvas can show, so path text stays
 * short without moving a pixel. Exact: inside ±1e9, v·1e6 is an integer a
 * double holds, and the text never needs an exponent.
 */
const coord = (v: number) => String(Math.round(v * 1e6) / 1e6);

/**
 * Segments as SVG path text, for `new Path2D(…)`: the canvas draws exactly
 * what this module measured and cut. `parsePath` reads it back to the same
 * segments, to the millionth.
 */
export function pathToString(segs: readonly Seg[]): string {
  return clean(segs).map((s) => s.t + s.p.map(coord).join(' ')).join(' ');
}

// ── outlines ──────────────────────────────────────────────────────────────
//
// Each shape a `shape` layer can be, as segments centred on 0,0 (the drawing
// code has moved to the layer's centre), in whatever unit the caller passes.
// Closed outlines start at the top, or the top-left corner, and run clockwise
// on screen, so a `draw` effect traces every shape the same way round.

/** 4(√2 − 1)/3: the handle length that makes a cubic a quarter circle to within 0.03%. */
const KAPPA = 0.5522847498307936;

/**
 * A size as an outline reads it: its magnitude (mirroring is the drawing
 * code's transform, not a shape's), a non-finite size as 0, and no more than
 * a million, so no corner's sum can overflow.
 */
function dim(v: number): number {
  return Math.min(1e6, Math.abs(finite(v, 0)));
}

/**
 * Segments with a pen position, which drops any line to where the pen already
 * is: a pill's straight sides have no length, and a zero-length segment has
 * no direction to give `pointAt` or a line join.
 */
function pen(x: number, y: number) {
  const out: Seg[] = [{ t: 'M', p: [x, y] }];
  let cx = x;
  let cy = y;
  return {
    out,
    line(x: number, y: number) {
      if (x === cx && y === cy) return;
      out.push({ t: 'L', p: [x, y] });
      cx = x;
      cy = y;
    },
    curve(x1: number, y1: number, x2: number, y2: number, x: number, y: number) {
      out.push({ t: 'C', p: [x1, y1, x2, y2, x, y] });
      cx = x;
      cy = y;
    },
    close(): Seg[] {
      out.push({ t: 'Z', p: [] });
      return out;
    },
  };
}

/**
 * A `w` × `h` rectangle with corners of radius `r`, held to half the shorter
 * side (so a large radius makes a pill, never corners that overlap); 0 or less
 * is square. The corners are quarter-circle cubics, which `trimPath` can cut
 * exactly where a canvas `roundRect` could not be cut at all.
 */
export function rectPath(w: number, h: number, r: number): Seg[] {
  const W = dim(w) / 2;
  const H = dim(h) / 2;
  const R = clamp(finite(r, 0), 0, Math.min(W, H));
  const k = R * (1 - KAPPA);
  const g = pen(-W + R, -H);
  g.line(W - R, -H);
  if (R > 0) g.curve(W - k, -H, W, -H + k, W, -H + R);
  g.line(W, H - R);
  if (R > 0) g.curve(W, H - k, W - k, H, W - R, H);
  g.line(-W + R, H);
  if (R > 0) g.curve(-W + k, H, -W, H - k, -W, H - R);
  g.line(-W, -H + R);
  if (R > 0) g.curve(-W, -H + k, -W + k, -H, -W + R, -H);
  return g.close();
}

/** An ellipse filling the `w` × `h` box, as four quarter cubics from the top, clockwise. */
export function ellipsePath(w: number, h: number): Seg[] {
  const W = dim(w) / 2;
  const H = dim(h) / 2;
  const kx = W * KAPPA;
  const ky = H * KAPPA;
  const g = pen(0, -H);
  g.curve(kx, -H, W, -ky, W, 0);
  g.curve(W, ky, kx, H, 0, H);
  g.curve(-kx, H, -W, ky, -W, 0);
  g.curve(-W, -ky, -kx, -H, 0, -H);
  return g.close();
}

/**
 * A regular polygon of `sides` (3 to 24, rounded) with a vertex at the top.
 * Regular, not stretched to the box: its circumscribed circle has the
 * diameter of the box's shorter side (as the contract says a polygon fits the
 * smaller side), so it fits the box at every rotation, and it is centred on
 * that circle's centre, so a spinning polygon turns in place instead of
 * wobbling about its bounding box. A non-finite count is 6.
 */
export function polygonPath(sides: number, w: number, h: number): Seg[] {
  const n = Math.round(clamp(finite(sides, 6), 3, 24));
  const R = Math.min(dim(w), dim(h)) / 2;
  const g = pen(0, -R);
  for (let i = 1; i < n; i++) {
    const a = (i * TAU) / n;
    g.line(R * Math.sin(a), -R * Math.cos(a));
  }
  return g.close();
}

/** Points alternating between the box's ellipse and `inner` of it, starting at the top: a star and a burst are the same outline at different counts. */
function spikes(n: number, W: number, H: number, inner: number): Seg[] {
  const g = pen(0, -H);
  for (let i = 1; i < 2 * n; i++) {
    const a = (i * Math.PI) / n;
    const r = i % 2 ? inner : 1;
    g.line(W * r * Math.sin(a), -H * r * Math.cos(a));
  }
  return g.close();
}

/**
 * A star of `points` (3 to 24, rounded; 5 when not a number) with a point at
 * the top, its tips on the ellipse that fills the box and its inner corners at
 * `inner` (0.1 to 0.95; 0.5 when not a number) of it. It fills the box rather
 * than staying regular, as a burst behind a word must.
 */
export function starPath(points: number, w: number, h: number, inner: number): Seg[] {
  const n = Math.round(clamp(finite(points, 5), 3, 24));
  return spikes(n, dim(w) / 2, dim(h) / 2, clamp(finite(inner, 0.5), 0.1, 0.95));
}

/**
 * A sunburst seal: a star with many short rays (3 to 48, rounded; 16 when not
 * a number) whose depth is `inner` (0.1 to 0.95; 0.75 when not a number) —
 * the badge behind "NEW" or a price.
 */
export function burstPath(rays: number, w: number, h: number, inner: number): Seg[] {
  const n = Math.round(clamp(finite(rays, 16), 3, 48));
  return spikes(n, dim(w) / 2, dim(h) / 2, clamp(finite(inner, 0.75), 0.1, 0.95));
}

/**
 * A block arrow pointing right, filling the box: the head is the full height
 * and as long as 0.9 of it (at most half the width, so a short arrow keeps a
 * shaft), the shaft 0.4 of the height, centred. Right only: the drawing code
 * mirrors it for right-to-left, the same way it mirrors every other layer.
 * Starts at the tail, so a `draw` effect runs toward the point.
 */
export function arrowPath(w: number, h: number): Seg[] {
  const W = dim(w) / 2;
  const H = dim(h) / 2;
  const head = Math.min(W, 1.8 * H);
  const t = 0.4 * H;
  const x = W - head;
  const g = pen(-W, -t);
  g.line(x, -t);
  g.line(x, -H);
  g.line(W, 0);
  g.line(x, H);
  g.line(x, t);
  g.line(-W, t);
  return g.close();
}

/**
 * An organic closed outline: `points` (3 to 24; 7 when not a number) radii
 * around the box's ellipse, each moved in or out by the seeded stream, joined
 * by a closed Catmull-Rom spline as cubics, so it has no corners. The same
 * seed is always the same blob, since a frame must not reshuffle it.
 *
 * Every point of the outline stays within ±`wobble` (0 to 0.6; 0.22 when not
 * a number) of the ellipse, so a blob can be laid out by its box: the radii
 * are drawn from 0.8 of that range because the spline between two of them
 * can bulge a quarter of their spread further. The spline's handles are
 * scaled to the angle between radii (4·tan(Δ/4)/sin Δ), which makes it the
 * ellipse itself at no wobble; plain Catmull-Rom cuts inside between widely
 * spaced radii, and a three-point blob would come out a rounded triangle.
 */
export function blobPath(w: number, h: number, seed: number, wobble = 0.22, points = 7): Seg[] {
  const W = dim(w) / 2;
  const H = dim(h) / 2;
  const n = Math.round(clamp(finite(points, 7), 3, 24));
  const spread = 0.8 * clamp(finite(wobble, 0.22), 0, 0.6);
  const next = rng(seed);
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i * TAU) / n;
    const r = 1 + spread * (2 * next() - 1);
    pts.push([W * r * Math.sin(a), -H * r * Math.cos(a)]);
  }
  const step = TAU / n;
  const s = (4 * Math.tan(step / 4)) / Math.sin(step) / 6;
  const g = pen(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    g.curve(
      p1[0] + (p2[0] - p0[0]) * s, p1[1] + (p2[1] - p0[1]) * s,
      p2[0] - (p3[0] - p1[0]) * s, p2[1] - (p3[1] - p1[1]) * s,
      p2[0], p2[1],
    );
  }
  return g.close();
}

/**
 * An open sine wave across the width, `h / 2` high each way: `periods` (0.5
 * to 12; 2 when not a number) whole waves, shifted by `phase` in periods (0.25
 * is a quarter wave; a phase that grows with time makes it travel). It rises
 * first, from the left edge at mid-height. Eight cubics a period, each
 * matching the sine's height and slope at both ends, which keeps it within a
 * thousandth of its amplitude of a true sine.
 */
export function wavePath(w: number, h: number, periods: number, phase = 0): Seg[] {
  const W = dim(w);
  const A = dim(h) / 2;
  const per = clamp(finite(periods, 2), 0.5, 12);
  const ph = frac(finite(phase, 0));
  const n = Math.ceil(per * 8);
  const y = (u: number) => -A * Math.sin(TAU * (per * u + ph));
  const slope = (u: number) => -A * TAU * per * Math.cos(TAU * (per * u + ph));
  const g = pen(-W / 2, y(0));
  for (let i = 0; i < n; i++) {
    const u0 = i / n;
    const u1 = (i + 1) / n;
    const x0 = -W / 2 + W * u0;
    const x1 = -W / 2 + W * u1;
    const third = 1 / (3 * n);
    g.curve(x0 + W * third, y(u0) + slope(u0) * third, x1 - W * third, y(u1) - slope(u1) * third, x1, y(u1));
  }
  return g.out;
}

/**
 * An open arc of the ellipse filling the box, for a progress ring or a gauge:
 * it starts `fromDeg` clockwise from the top (12 o'clock) and runs `sweepDeg`
 * (held to −360..360; negative runs anticlockwise), as cubics of at most 90°.
 * The angles are the ellipse's own parameter, which on a circle are simply
 * degrees. A whole turn ends exactly where it began and is closed with `Z`,
 * so a full ring's stroke has no seam where its caps would meet; no sweep is
 * the start point alone.
 */
export function arcPath(w: number, h: number, fromDeg: number, sweepDeg: number): Seg[] {
  const a = dim(w) / 2;
  const b = dim(h) / 2;
  const sweep = clamp(finite(sweepDeg, 0), -360, 360);
  const from = (wrap(finite(fromDeg, 0), 360) * Math.PI) / 180;
  const span = (sweep * Math.PI) / 180;
  const at = (t: number): [number, number] => [a * Math.sin(t), -b * Math.cos(t)];
  const [sx, sy] = at(from);
  const g = pen(sx, sy);
  if (sweep === 0) return g.out;
  const full = Math.abs(sweep) === 360;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / 90 - 1e-9));
  const step = span / n;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < n; i++) {
    const t0 = from + step * i;
    const t1 = i === n - 1 ? from + span : t0 + step;
    const [x0, y0] = at(t0);
    const [x1, y1] = full && i === n - 1 ? [sx, sy] : at(t1);
    g.curve(x0 + k * a * Math.cos(t0), y0 + k * b * Math.sin(t0), x1 - k * a * Math.cos(t1), y1 - k * b * Math.sin(t1), x1, y1);
  }
  return full ? g.close() : g.out;
}
