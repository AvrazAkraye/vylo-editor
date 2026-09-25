/**
 * A video's look beyond its style — the logo's size, the words' size and
 * side, the colours, the typeface, the pace, the background and the corner
 * mark — made safe to draw: every value checked, clamped and merged here.
 *
 * Pure on purpose: no React, no Remotion, no fonts. The chat (which reads a
 * value the model wrote, like "logoScale": 7 or "background": "blak") and the
 * Look tab validate with the same functions the renderer draws with, and the
 * tests run them in Node.
 *
 * - `normalLook` / `normalSceneLook` — whatever was stored or asked for, as a
 *   `LookSettings` / `SceneLook` with only valid fields: numbers clamped to
 *   their ranges, colours as `#RRGGBB`, a font only when it is one of
 *   `FONT_CHOICES`. Anything else is dropped, never guessed.
 * - `lookFor(video, scene)` — the look a scene is drawn with: the scene's own
 *   fields over the video's, the video's over the defaults.
 * - `hexOf`, `contrast`, `legible` — colour checks the renderer uses to keep
 *   words readable (4.5:1 against their background, the WCAG AA line).
 */

import type { LookSettings, SceneLook, Video } from './videotypes';

// ---------------------------------------------------------------------------
// Ranges and choices

/** The numbers' ranges; 1 is always the style's own. Values outside are clamped to the nearest end. */
export const LOOK_LIMITS = {
  logoScale: { min: 0.5, max: 3 },
  textScale: { min: 0.7, max: 1.5 },
  motion: { min: 0.5, max: 2 },
  watermarkScale: { min: 0.5, max: 2 },
} as const;

export type Align = NonNullable<LookSettings['align']>;
export type BackdropMode = NonNullable<LookSettings['backdrop']>;
export type Corner = NonNullable<LookSettings['watermarkCorner']>;
export type PictureFit = NonNullable<SceneLook['fit']>;

export const ALIGNS: readonly Align[] = ['start', 'center', 'end'];
export const BACKDROPS: readonly BackdropMode[] = ['moving', 'still', 'plain'];
export const CORNERS: readonly Corner[] = ['top-start', 'top-end', 'bottom-start', 'bottom-end'];
export const FITS: readonly PictureFit[] = ['cover', 'contain'];

/** One typeface pair a video can be set in: `latin` and `arabic` name the headline families, as Google Fonts does. */
export interface FontChoice { id: string; label: string; latin: string; arabic: string }

/**
 * The typefaces a video can switch to (videotheme.ts loads and draws them).
 * The first six are the six styles' own pairs; a style with no `look.font`
 * draws in its own. Every Arabic-script family here was checked against the
 * cmap of the very file `@remotion/google-fonts` loads for its `arabic`
 * subset, in every weight: each has ڕ ڵ ێ ۆ ە ڤ (and ھ پ چ ژ گ ک ی, the
 * Arabic-Indic digits and ٪). Cairo, Tajawal, Almarai, Readex Pro, Changa,
 * El Messiri, Lalezar, Markazi Text, Rubik, Alexandria, Lemonada, Rakkas,
 * Blaka, Oi, Handjet, Baloo Bhaijaan 2, Qahiri and Gulzar do not — a Sorani
 * word in one of them drops to a fallback face mid-word. Having the letters
 * is not all: Kufam has them but draws a joined ە as an Urdu hook, so each
 * face was also looked at setting Sorani words before it was chosen.
 */
export const FONT_CHOICES: readonly FontChoice[] = [
  { id: 'geometric', label: 'Geometric', latin: 'Space Grotesk', arabic: 'Vazirmatn' },
  { id: 'condensed', label: 'Condensed', latin: 'Anton', arabic: 'Noto Kufi Arabic' },
  { id: 'classic', label: 'Classic serif', latin: 'Playfair Display', arabic: 'Amiri' },
  { id: 'wide', label: 'Wide', latin: 'Unbounded', arabic: 'Reem Kufi' },
  { id: 'swiss', label: 'Swiss', latin: 'Inter', arabic: 'IBM Plex Sans Arabic' },
  { id: 'soft', label: 'Soft serif', latin: 'Fraunces', arabic: 'Marhey' },
  { id: 'book', label: 'Book serif', latin: 'Lora', arabic: 'Noto Naskh Arabic' },
  { id: 'poster', label: 'Poster', latin: 'Bricolage Grotesque', arabic: 'Beiruti' },
  { id: 'calligraphy', label: 'Calligraphy', latin: 'Cormorant Garamond', arabic: 'Aref Ruqaa' },
  { id: 'rounded', label: 'Rounded', latin: 'Nunito', arabic: 'Playpen Sans Arabic' },
];

const FONT_IDS = new Set(FONT_CHOICES.map((f) => f.id));

// ---------------------------------------------------------------------------
// Colour

const HEX6 = /^#?([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f]{3})$/i;

/**
 * A colour as `#RRGGBB`, or undefined when it is not one. Takes `#rrggbb`,
 * `rrggbb` and the short `#rgb`; case does not matter. Names ("black") are
 * not colours here — the chat turns words into hex before it asks.
 */
export function hexOf(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim();
  const six = HEX6.exec(s);
  if (six) return `#${six[1].toUpperCase()}`;
  const three = HEX3.exec(s);
  if (three) return `#${three[1].split('').map((c) => c + c).join('').toUpperCase()}`;
  return undefined;
}

/** A `#rrggbb` colour's channels; grey for anything else. */
export function rgbOf(hex: string): [number, number, number] {
  const m = HEX6.exec(String(hex).trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

/** Between two colours: 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Relative luminance, 0 (black) to 1 (white), as WCAG defines it. */
export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgbOf(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** The contrast words need against their background: WCAG AA for text. */
export const LEGIBLE = 4.5;

/** A colour's hue (0–360), saturation and lightness (0–1). */
function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hexOfHsl(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return toHex([f(0), f(8), f(4)].map((v) => v * 255));
}

/**
 * `color`, or the nearest variant of it that reads on `bg` at `min`:1: the
 * same hue and saturation, made darker or lighter — towards black or white,
 * whichever `bg` is further from — until it reads. A pale yellow asked for on
 * white becomes a deep gold, navy on black a clear blue. Always reaches `min`
 * up to 4.5: the last step is pure black or white, and every colour is at
 * least 4.58:1 from one of them (near-black is not enough — a ground around
 * #777 is under 4.5 from both it and white). A higher `min` may return the
 * ink itself.
 */
export function legible(color: string, bg: string, min = LEGIBLE): string {
  const c = hexOf(color) ?? '#808080';
  const g = hexOf(bg) ?? '#808080';
  if (contrast(c, g) >= min) return c;
  const darker = contrast(g, '#000000') >= contrast(g, '#FFFFFF');
  const [h, s, l] = hslOf(c);
  for (let i = 1; i <= 50; i++) {
    const m = hexOfHsl(h, s, darker ? l * (1 - i / 50) : l + (1 - l) * (i / 50));
    if (contrast(m, g) >= min) return m;
  }
  return darker ? '#000000' : '#FFFFFF';
}

// ---------------------------------------------------------------------------
// Normalising

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** A number (or a numeric string) clamped to a range and rounded to hundredths; undefined when it is not a number. */
function numberIn(x: unknown, r: { min: number; max: number }): number | undefined {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x.trim()) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.round(Math.max(r.min, Math.min(r.max, n)) * 100) / 100;
}

function oneOf<T extends string>(x: unknown, list: readonly T[], aliases: Readonly<Record<string, T>> = {}): T | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? s as T : aliases[s];
}

const ALIGN_ALIASES: Readonly<Record<string, Align>> = { centre: 'center', middle: 'center' };

/** A font id when it names one of `FONT_CHOICES` (by id, or by its label in any case). */
export function fontIdOf(x: unknown): string | undefined {
  if (typeof x !== 'string') return undefined;
  const s = x.trim().toLowerCase();
  if (FONT_IDS.has(s)) return s;
  return FONT_CHOICES.find((f) => f.label.toLowerCase() === s)?.id;
}

/**
 * A video's look with only valid fields: numbers clamped to `LOOK_LIMITS`,
 * colours as `#RRGGBB`, `align`/`backdrop`/`watermarkCorner` one of their
 * words, `font` an id from `FONT_CHOICES`. Invalid fields are left out (so
 * they fall back to the style's own); anything that is not an object is `{}`.
 */
export function normalLook(x: unknown): LookSettings {
  if (!isObject(x)) return {};
  const out: LookSettings = {};
  const logoScale = numberIn(x.logoScale, LOOK_LIMITS.logoScale);
  if (logoScale !== undefined) out.logoScale = logoScale;
  const textScale = numberIn(x.textScale, LOOK_LIMITS.textScale);
  if (textScale !== undefined) out.textScale = textScale;
  const align = oneOf(x.align, ALIGNS, ALIGN_ALIASES);
  if (align) out.align = align;
  const background = hexOf(x.background);
  if (background) out.background = background;
  const text = hexOf(x.text);
  if (text) out.text = text;
  const font = fontIdOf(x.font);
  if (font) out.font = font;
  const motion = numberIn(x.motion, LOOK_LIMITS.motion);
  if (motion !== undefined) out.motion = motion;
  const backdrop = oneOf(x.backdrop, BACKDROPS);
  if (backdrop) out.backdrop = backdrop;
  const watermarkCorner = oneOf(x.watermarkCorner, CORNERS);
  if (watermarkCorner) out.watermarkCorner = watermarkCorner;
  const watermarkScale = numberIn(x.watermarkScale, LOOK_LIMITS.watermarkScale);
  if (watermarkScale !== undefined) out.watermarkScale = watermarkScale;
  return out;
}

/** A scene's look with only valid fields, as `normalLook` does for a video's; `logo` only as a boolean. */
export function normalSceneLook(x: unknown): SceneLook {
  if (!isObject(x)) return {};
  const out: SceneLook = {};
  const textScale = numberIn(x.textScale, LOOK_LIMITS.textScale);
  if (textScale !== undefined) out.textScale = textScale;
  const align = oneOf(x.align, ALIGNS, ALIGN_ALIASES);
  if (align) out.align = align;
  const background = hexOf(x.background);
  if (background) out.background = background;
  const text = hexOf(x.text);
  if (text) out.text = text;
  if (typeof x.logo === 'boolean') out.logo = x.logo;
  const logoScale = numberIn(x.logoScale, LOOK_LIMITS.logoScale);
  if (logoScale !== undefined) out.logoScale = logoScale;
  const fit = oneOf(x.fit, FITS);
  if (fit) out.fit = fit;
  return out;
}

// ---------------------------------------------------------------------------
// The look a scene is drawn with

/**
 * Every field resolved for one scene. Numbers, the backdrop, the corner and
 * the fit always have a value (the style's own is 1, 'moving', 'top-end',
 * 'cover'); `align`, `background`, `text`, `font` and `logo` are undefined
 * when neither the scene nor the video sets them, meaning "as the style and
 * the scene's kind draw it".
 */
export interface EffectiveLook {
  logoScale: number;
  textScale: number;
  align?: Align;
  background?: string;
  text?: string;
  font?: string;
  motion: number;
  backdrop: BackdropMode;
  watermarkCorner: Corner;
  watermarkScale: number;
  /** true: show the brand on this scene; false: hide it, even on the title and the close. */
  logo?: boolean;
  fit: PictureFit;
}

/**
 * The look `scene` is drawn with in `video`: the scene's own fields over the
 * video's, the video's over the defaults. Both are normalised first, so a
 * stored value from an older build or a hand-edited file cannot reach the
 * renderer unchecked. `scene` may be omitted for the video's own look.
 */
export function lookFor(video: Pick<Video, 'look'> | null | undefined, scene?: { look?: SceneLook } | null): EffectiveLook {
  const v = normalLook(video?.look);
  const s = normalSceneLook(scene?.look);
  return {
    logoScale: s.logoScale ?? v.logoScale ?? 1,
    textScale: s.textScale ?? v.textScale ?? 1,
    align: s.align ?? v.align,
    background: s.background ?? v.background,
    text: s.text ?? v.text,
    font: v.font,
    motion: v.motion ?? 1,
    backdrop: v.backdrop ?? 'moving',
    watermarkCorner: v.watermarkCorner ?? 'top-end',
    watermarkScale: v.watermarkScale ?? 1,
    logo: s.logo,
    fit: s.fit ?? 'cover',
  };
}
