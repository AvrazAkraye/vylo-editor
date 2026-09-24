/**
 * The six looks a video can have — palette, type and motion — and the small
 * measuring tools the scenes use to lay words out.
 *
 * ## Fonts
 *
 * Every face comes through `@remotion/google-fonts`, one module per family,
 * loaded with only the weights and subsets the style uses. That is the only
 * way the web renderer (which draws text onto a canvas itself) sees a font:
 * a CSS @font-face would show in the Player and silently fall back in the
 * exported file. Each style has a Latin pair and an Arabic-script pair; the
 * Arabic ones were chosen because their `arabic` subset actually carries the
 * Kurdish letters ڕ ڵ ێ ۆ ە ڤ (checked against the fonts' cmaps — Cairo,
 * Tajawal, Almarai, Readex Pro, Changa, El Messiri, Lalezar and Markazi Text
 * do not, and would drop to a fallback face in the middle of a Sorani word).
 *
 * ## Text fitting
 *
 * Headlines are broken into lines here, not by the browser: the scenes render
 * one text node per line with `white-space: nowrap`, so the Player (DOM) and
 * the web renderer (canvas, which draws each word at the position the DOM gave
 * it) always agree on where a line ends, and a long Arabic or Kurdish headline
 * shrinks until it fits its box instead of running out of the frame. Widths
 * are measured with a canvas in the loaded face; before the face is ready an
 * estimate is used and nothing is cached, so the next frame corrects it.
 */

import { Easing } from 'remotion';
import type { Brand, Format, Style, Video, VideoLang } from './videotypes';
import { loadFont as loadAmiri } from '@remotion/google-fonts/Amiri';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadArchivo } from '@remotion/google-fonts/Archivo';
import { loadFont as loadDMSans } from '@remotion/google-fonts/DMSans';
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadIBMPlexSansArabic } from '@remotion/google-fonts/IBMPlexSansArabic';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMada } from '@remotion/google-fonts/Mada';
import { loadFont as loadMarhey } from '@remotion/google-fonts/Marhey';
import { loadFont as loadNotoKufiArabic } from '@remotion/google-fonts/NotoKufiArabic';
import { loadFont as loadNotoNaskhArabic } from '@remotion/google-fonts/NotoNaskhArabic';
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadReemKufi } from '@remotion/google-fonts/ReemKufi';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { loadFont as loadUnbounded } from '@remotion/google-fonts/Unbounded';
import { loadFont as loadVazirmatn } from '@remotion/google-fonts/Vazirmatn';

// ---------------------------------------------------------------------------
// Fonts

type Loader = (
  style: 'normal',
  o: { weights: string[]; subsets: string[]; ignoreTooManyRequestsWarning?: boolean },
) => { fontFamily: string; waitUntilDone: () => Promise<void> };

interface Family { family: string; load: Loader }

const fam = (family: string, load: unknown): Family => ({ family, load: load as Loader });

const FAMILIES = {
  amiri: fam('Amiri', loadAmiri),
  anton: fam('Anton', loadAnton),
  archivo: fam('Archivo', loadArchivo),
  dmSans: fam('DM Sans', loadDMSans),
  fraunces: fam('Fraunces', loadFraunces),
  plexArabic: fam('IBM Plex Sans Arabic', loadIBMPlexSansArabic),
  inter: fam('Inter', loadInter),
  mada: fam('Mada', loadMada),
  marhey: fam('Marhey', loadMarhey),
  notoKufi: fam('Noto Kufi Arabic', loadNotoKufiArabic),
  notoNaskh: fam('Noto Naskh Arabic', loadNotoNaskhArabic),
  playfair: fam('Playfair Display', loadPlayfairDisplay),
  reemKufi: fam('Reem Kufi', loadReemKufi),
  spaceGrotesk: fam('Space Grotesk', loadSpaceGrotesk),
  unbounded: fam('Unbounded', loadUnbounded),
  vazirmatn: fam('Vazirmatn', loadVazirmatn),
} as const;

type FamilyKey = keyof typeof FAMILIES;

/** One face of a pair: which family, the weight headlines (or body) use, and the weights to load. */
interface Face { key: FamilyKey; weight: number; strong: number }

interface Pair { display: Face; body: Face }

// ---------------------------------------------------------------------------
// Styles

/** How things move in a style. Springs overshoot a little; eased curves do not. */
export interface Motion {
  /** A spring for entrances, or null for an eased curve over `duration` frames. */
  spring: { damping: number; stiffness: number; mass: number } | null;
  duration: number;
  easing: (t: number) => number;
  /** Frames between one element and the next in a staggered reveal. */
  stagger: number;
  /** How far things travel as they arrive, in units of 1/1080 of the short side. */
  travel: number;
}

/** The background's character. */
export type Deco = 'mesh' | 'slab' | 'frame' | 'glow' | 'rule' | 'sun';

interface StyleDef {
  dark: boolean;
  bg: string;
  bg2: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  surface: string;
  latin: Pair;
  arabic: Pair;
  /** Latin display tracking, in em. Arabic is never tracked: it breaks the joins. */
  tracking: number;
  upper: boolean;
  motion: Motion;
  align: 'start' | 'center';
  radius: number;
  grain: number;
  deco: Deco;
  /** Latin display line height (Arabic always gets more room for its ascenders and dots). */
  leading: number;
}

const face = (key: FamilyKey, weight: number, strong = weight): Face => ({ key, weight, strong });

const STYLES: Readonly<Record<Style, StyleDef>> = {
  modern: {
    dark: true,
    bg: '#0B1020', bg2: '#1B1446', fg: '#F4F6FF', muted: '#A9B0D6',
    accent: '#7C5CFF', accent2: '#22D3EE', surface: '#161C38',
    latin: { display: face('spaceGrotesk', 700), body: face('inter', 400, 600) },
    arabic: { display: face('vazirmatn', 800), body: face('vazirmatn', 400, 600) },
    tracking: -0.025, upper: false, leading: 1.02,
    motion: { spring: { damping: 18, stiffness: 120, mass: 0.8 }, duration: 22, easing: Easing.bezier(0.2, 0.9, 0.2, 1), stagger: 4, travel: 60 },
    align: 'start', radius: 28, grain: 0.07, deco: 'mesh',
  },
  bold: {
    dark: true,
    bg: '#0C0C0E', bg2: '#17171B', fg: '#FFFFFF', muted: '#B8B8C0',
    accent: '#FFD60A', accent2: '#FF3D2E', surface: '#1E1E24',
    latin: { display: face('anton', 400), body: face('archivo', 500, 800) },
    arabic: { display: face('notoKufi', 900), body: face('notoKufi', 500, 700) },
    tracking: 0.005, upper: true, leading: 0.98,
    motion: { spring: { damping: 12, stiffness: 220, mass: 0.55 }, duration: 12, easing: Easing.bezier(0.3, 1.4, 0.4, 1), stagger: 3, travel: 110 },
    align: 'start', radius: 6, grain: 0, deco: 'slab',
  },
  elegant: {
    dark: true,
    bg: '#12100D', bg2: '#231D16', fg: '#F5EFE4', muted: '#BDB2A0',
    accent: '#C9A86A', accent2: '#8E7A55', surface: '#1E1914',
    latin: { display: face('playfair', 600), body: face('dmSans', 400, 500) },
    arabic: { display: face('amiri', 700), body: face('notoNaskh', 400, 600) },
    tracking: -0.005, upper: false, leading: 1.08,
    motion: { spring: null, duration: 34, easing: Easing.bezier(0.16, 1, 0.3, 1), stagger: 8, travel: 36 },
    align: 'center', radius: 2, grain: 0.06, deco: 'frame',
  },
  neon: {
    dark: true,
    bg: '#07060F', bg2: '#140A2A', fg: '#F7F3FF', muted: '#A99FCF',
    accent: '#FF2E97', accent2: '#1FF2FF', surface: '#130F26',
    latin: { display: face('unbounded', 700), body: face('spaceGrotesk', 400, 600) },
    arabic: { display: face('reemKufi', 700), body: face('mada', 400, 600) },
    tracking: 0, upper: false, leading: 1.08,
    motion: { spring: { damping: 11, stiffness: 200, mass: 0.6 }, duration: 12, easing: Easing.bezier(0.3, 1.3, 0.4, 1), stagger: 3, travel: 80 },
    align: 'center', radius: 18, grain: 0.05, deco: 'glow',
  },
  minimal: {
    dark: false,
    bg: '#F6F5F1', bg2: '#ECEAE3', fg: '#111111', muted: '#6B6A66',
    accent: '#2E5BFF', accent2: '#111111', surface: '#FFFFFF',
    latin: { display: face('inter', 700), body: face('inter', 400, 500) },
    arabic: { display: face('plexArabic', 600), body: face('plexArabic', 400, 600) },
    tracking: -0.035, upper: false, leading: 1.04,
    motion: { spring: null, duration: 24, easing: Easing.bezier(0.22, 1, 0.36, 1), stagger: 5, travel: 40 },
    align: 'start', radius: 0, grain: 0, deco: 'rule',
  },
  warm: {
    dark: false,
    bg: '#FFF4E6', bg2: '#FFD9BF', fg: '#2B1A12', muted: '#7A5A48',
    accent: '#E0573A', accent2: '#F2A541', surface: '#FFFBF5',
    latin: { display: face('fraunces', 700), body: face('dmSans', 400, 600) },
    arabic: { display: face('marhey', 600), body: face('vazirmatn', 400, 600) },
    tracking: -0.015, upper: false, leading: 1.06,
    motion: { spring: { damping: 15, stiffness: 110, mass: 0.9 }, duration: 24, easing: Easing.bezier(0.25, 1.2, 0.4, 1), stagger: 5, travel: 50 },
    align: 'center', radius: 36, grain: 0.08, deco: 'sun',
  },
};

/** The colours the style picker shows. */
export const SWATCHES: Readonly<Record<Style, { bg: string; fg: string; accent: string }>> = Object.fromEntries(
  (Object.keys(STYLES) as Style[]).map((s) => [s, { bg: STYLES[s].bg, fg: STYLES[s].fg, accent: STYLES[s].accent }]),
) as Record<Style, { bg: string; fg: string; accent: string }>;

const styleOf = (s: Style): StyleDef => STYLES[s] ?? STYLES.modern;
const rtlLang = (l: VideoLang) => l !== 'en';

/** The two families a video uses, per its language and style. */
export function fontPair(lang: VideoLang, style: Style): Pair {
  const d = styleOf(style);
  return rtlLang(lang) ? d.arabic : d.latin;
}

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

export const fontKeyOf = (v: Pick<Video, 'lang' | 'style'>) => `${v.style}:${rtlLang(v.lang) ? 'arabic' : 'latin'}`;

/** Whether the fonts for this language and style have finished loading. */
export const fontsReady = (v: Pick<Video, 'lang' | 'style'>) => loaded.has(fontKeyOf(v));

/**
 * Loads the style's pair for the video's script: only the two or three
 * weights used, only the subsets needed (Arabic-script videos also take the
 * Latin subset of the same families, for a brand name or a web address).
 */
export function loadFonts(v: Pick<Video, 'lang' | 'style'>): Promise<void> {
  const key = fontKeyOf(v);
  const done = loading.get(key);
  if (done) return done;
  const pair = fontPair(v.lang, v.style);
  const subsets = rtlLang(v.lang) ? ['arabic', 'latin'] : ['latin', 'latin-ext'];
  const weights = new Map<FamilyKey, Set<string>>();
  for (const f of [pair.display, pair.body]) {
    const set = weights.get(f.key) ?? new Set<string>();
    set.add(String(f.weight));
    set.add(String(f.strong));
    weights.set(f.key, set);
  }
  const jobs: Promise<void>[] = [];
  for (const [k, set] of weights) {
    const f = FAMILIES[k];
    jobs.push(f.load('normal', { weights: [...set], subsets, ignoreTooManyRequestsWarning: true }).waitUntilDone());
  }
  const p = Promise.all(jobs).then(() => {
    loaded.add(key);
    measured.clear();
  });
  p.catch(() => loading.delete(key));
  loading.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// Colour

const HEX = /^#([0-9a-f]{6})$/i;

export function rgbOf(hex: string): [number, number, number] {
  const m = HEX.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (c: number[]) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');

/** A colour at an opacity, as rgba(). */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Between two colours: 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

export function luminance(hex: string): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = rgbOf(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Near-black or white, whichever reads on this colour. */
export const inkOn = (bg: string, dark = '#0C0C0E', light = '#FFFFFF') =>
  contrast(bg, dark) >= contrast(bg, light) ? dark : light;

const validHex = (s: string | undefined): s is string => typeof s === 'string' && HEX.test(s.trim());

// ---------------------------------------------------------------------------
// Theme

export interface TypeFace {
  family: string;
  weight: number;
  strong: number;
  /** In em; always 0 for Arabic script. */
  tracking: number;
  upper: boolean;
  leading: number;
}

/** Everything a scene needs to draw itself in a style. */
export interface Theme {
  style: Style;
  lang: VideoLang;
  rtl: boolean;
  dark: boolean;
  bg: string;
  bg2: string;
  fg: string;
  muted: string;
  /** For shapes, bars, lines. */
  accent: string;
  accent2: string;
  /** The accent when it is used for words: falls back to `fg` when the accent does not read on the background. */
  accentText: string;
  /** Words drawn on an accent-coloured shape. */
  onAccent: string;
  surface: string;
  display: TypeFace;
  body: TypeFace;
  motion: Motion;
  align: 'start' | 'center';
  radius: number;
  grain: number;
  deco: Deco;
  /** A scene that swaps to the accent as its background (the bold style alternates). */
  inverted: boolean;
}

const FALLBACK_LATIN = "'Helvetica Neue', Arial, sans-serif";
const FALLBACK_ARABIC = "'Geeza Pro', 'Noto Sans Arabic', Tahoma, sans-serif";

/**
 * The theme for a video, with the brand's colours in place of the style's:
 * the brand's primary becomes the accent, its accent the second accent. A
 * scene index lets the bold style alternate between dark and accent grounds.
 */
export function themeOf(v: Pick<Video, 'lang' | 'style' | 'brand'>, sceneIndex = 0, allowInvert = true): Theme {
  const d = styleOf(v.style);
  const rtl = rtlLang(v.lang);
  const pair = rtl ? d.arabic : d.latin;
  const brand: Brand = v.brand ?? {};
  let accent = validHex(brand.primary) ? brand.primary.trim() : d.accent;
  let accent2 = validHex(brand.accent) ? brand.accent.trim() : validHex(brand.primary) ? mix(accent, d.dark ? '#FFFFFF' : '#000000', 0.35) : d.accent2;
  let bg = d.bg;
  let bg2 = d.bg2;
  let fg = d.fg;
  let muted = d.muted;
  let surface = d.surface;
  // A brand colour tints the dark grounds a little, so the film feels like the brand's.
  if (validHex(brand.primary) && d.dark && v.style !== 'bold') {
    bg = mix(d.bg, accent, 0.06);
    bg2 = mix(d.bg2, accent, 0.18);
  }
  const inverted = allowInvert && v.style === 'bold' && sceneIndex % 2 === 1;
  if (inverted) {
    const ground = accent;
    const ink = inkOn(ground);
    bg = ground;
    bg2 = mix(ground, ink, 0.08);
    fg = ink;
    muted = alpha(ink, 0.72);
    surface = mix(ground, ink, 0.1);
    accent = ink;
    accent2 = ink === '#FFFFFF' ? '#0C0C0E' : '#FFFFFF';
  }
  const fam = (f: Face) => `'${FAMILIES[f.key].family}', ${rtl ? FALLBACK_ARABIC : FALLBACK_LATIN}`;
  const accentText = contrast(accent, bg) >= 2.6 ? accent : fg;
  return {
    style: v.style,
    lang: v.lang,
    rtl,
    dark: inverted ? luminance(bg) < 0.4 : d.dark,
    bg, bg2, fg, muted, accent, accent2, accentText,
    onAccent: inkOn(accent),
    surface,
    display: {
      family: fam(pair.display),
      weight: pair.display.weight,
      strong: pair.display.strong,
      tracking: rtl ? 0 : d.tracking,
      upper: !rtl && d.upper,
      leading: rtl ? Math.max(1.3, d.leading + 0.3) : d.leading,
    },
    body: {
      family: fam(pair.body),
      weight: pair.body.weight,
      strong: pair.body.strong,
      tracking: 0,
      upper: false,
      leading: rtl ? 1.6 : 1.38,
    },
    motion: d.motion,
    align: d.align,
    radius: d.radius,
    grain: d.grain,
    deco: d.deco,
    inverted,
  };
}

// ---------------------------------------------------------------------------
// Layout

/** The frame, its unit and the safe area inside it. */
export interface Box {
  format: Format;
  width: number;
  height: number;
  /** One unit is 1/1080 of the short side — every size below is in pixels already. */
  u: number;
  /** Inline (left/right) margin. */
  x: number;
  top: number;
  bottom: number;
  /** The safe area's size. */
  w: number;
  h: number;
}

/**
 * Safe margins per format. Portrait leaves room at the top and bottom where
 * phone apps draw their own buttons and captions.
 */
export function boxOf(width: number, height: number): Box {
  const format: Format = width > height * 1.15 ? 'landscape' : height > width * 1.15 ? 'portrait' : 'square';
  const u = Math.min(width, height) / 1080;
  const m = format === 'landscape' ? { x: 150, top: 110, bottom: 120 } : format === 'portrait' ? { x: 90, top: 230, bottom: 330 } : { x: 100, top: 110, bottom: 120 };
  const x = m.x * u;
  const top = m.top * u;
  const bottom = m.bottom * u;
  return { format, width, height, u, x, top, bottom, w: width - 2 * x, h: height - top - bottom };
}

// ---------------------------------------------------------------------------
// Measuring and fitting text

let ctx: CanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();

function context(): CanvasRenderingContext2D | null {
  if (ctx !== undefined) return ctx;
  try {
    ctx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  } catch {
    ctx = null;
  }
  return ctx;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** Text width at 100px, in pixels. */
function widthAt100(text: string, f: TypeFace, bold: boolean, ready: boolean): number {
  const weight = bold ? f.strong : f.weight;
  const key = `${f.family}|${weight}|${f.tracking}|${f.upper ? 1 : 0}|${text}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;
  const s = f.upper ? text.toUpperCase() : text;
  const c = context();
  let w: number;
  if (c) {
    c.font = `${weight} 100px ${f.family}`;
    try {
      (c as unknown as { letterSpacing: string }).letterSpacing = `${f.tracking * 100}px`;
    } catch {
      /* older engines: no tracking in the measure */
    }
    w = c.measureText(s).width;
    if (f.tracking && !('letterSpacing' in c)) w += f.tracking * 100 * s.length;
  } else {
    w = [...s].reduce((sum, ch) => sum + (ch === ' ' ? 28 : ARABIC.test(ch) ? 48 : /[A-Z0-9]/.test(ch) ? 64 : 54), 0);
  }
  if (ready) measured.set(key, w);
  return w;
}

export interface Fit {
  size: number;
  lines: string[];
  /** The widest line, in pixels, at `size`. */
  width: number;
}

export interface FitOptions {
  face: TypeFace;
  bold?: boolean;
  maxSize: number;
  minSize: number;
  maxWidth: number;
  maxHeight: number;
  maxLines?: number;
  /** Line height used to check the height; the face's own when absent. */
  leading?: number;
  /** Make lines of similar length (on by default). */
  balance?: boolean;
  ready: boolean;
}

function wrap(words: string[], widths: number[], space: number, limit: number): { lines: string[]; widest: number } | null {
  const lines: string[] = [];
  let cur: string[] = [];
  let curW = 0;
  let widest = 0;
  for (let i = 0; i < words.length; i++) {
    const w = widths[i];
    if (w > limit) return null;
    const next = cur.length ? curW + space + w : w;
    if (next <= limit || !cur.length) {
      cur.push(words[i]);
      curW = next;
    } else {
      lines.push(cur.join(' '));
      widest = Math.max(widest, curW);
      cur = [words[i]];
      curW = w;
    }
  }
  if (cur.length) {
    lines.push(cur.join(' '));
    widest = Math.max(widest, curW);
  }
  return { lines, widest };
}

const fitCache = new Map<string, Fit>();

/**
 * The largest size (between min and max) at which the text wraps into the
 * box, with its lines. Lines are balanced so a two-line headline is not one
 * long line and a lonely word. Below the minimum it still wraps at the
 * minimum size — and a word wider than the box shrinks the size further, so
 * nothing ever runs out of the frame.
 */
export function fitText(text: string, o: FitOptions): Fit {
  const clean = text.replace(/\s+/g, ' ').trim();
  const leading = o.leading ?? o.face.leading;
  const maxLines = o.maxLines ?? 99;
  const key = `${clean}|${o.face.family}|${o.bold ? 1 : 0}|${o.face.tracking}|${o.face.upper}|${o.maxSize}|${o.minSize}|${Math.round(o.maxWidth)}|${Math.round(o.maxHeight)}|${maxLines}|${leading}|${o.balance !== false}`;
  if (o.ready) {
    const hit = fitCache.get(key);
    if (hit) return hit;
  }
  const words = clean ? clean.split(' ') : [''];
  const base = words.map((w) => widthAt100(w, o.face, !!o.bold, o.ready));
  const space100 = widthAt100(' ', o.face, !!o.bold, o.ready) || 25;
  // A small safety margin: kerning across spaces and sub-pixel rounding.
  const limit = o.maxWidth * 0.97;
  let size = o.maxSize;
  let best: { lines: string[]; widest: number } | null = null;
  for (let step = 0; step < 60; step++) {
    const k = size / 100;
    const r = wrap(words, base.map((w) => w * k), space100 * k, limit);
    if (r && r.lines.length <= maxLines && r.lines.length * size * leading <= o.maxHeight) {
      best = r;
      break;
    }
    if (size <= o.minSize) {
      // At the floor: take the wrap as it is, shrinking further only if one word is wider than the box.
      const widestWord = Math.max(...base) * k;
      if (widestWord > limit) {
        size = Math.max(8, (size * limit) / widestWord);
        continue;
      }
      best = r ?? wrap(words, base.map((w) => w * k), space100 * k, Infinity);
      break;
    }
    size = Math.max(o.minSize, size * 0.94);
  }
  if (!best) best = { lines: [clean], widest: 0 };
  const k = size / 100;
  if (o.balance !== false && best.lines.length > 1) {
    // The narrowest width that still gives the same number of lines.
    let lo = limit * 0.4;
    let hi = limit;
    let chosen = best;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      const r = wrap(words, base.map((w) => w * k), space100 * k, mid);
      if (r && r.lines.length <= best.lines.length) {
        chosen = r;
        hi = mid;
      } else lo = mid;
    }
    best = chosen;
  }
  const fit: Fit = { size, lines: best.lines, width: best.widest || Math.max(...best.lines.map((l) => widthAt100(l, o.face, !!o.bold, o.ready) * k)) };
  if (o.ready) fitCache.set(key, fit);
  return fit;
}

/** The width of a short string at a size, for things like counters that must not jump. */
export function textWidth(text: string, f: TypeFace, size: number, bold: boolean, ready: boolean): number {
  return (widthAt100(text, f, bold, ready) * size) / 100;
}
