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
 * The same pairs, and four more, are what `look.font` switches between
 * (`FONT_CHOICES`, videolook.ts, which says how each was checked).
 *
 * ## The look
 *
 * `themeOf` also applies the video's and the scene's look (videolook.ts):
 * a background in place of the style's, words in a colour kept legible on
 * it, another typeface pair, a set alignment. With no look it is the style
 * exactly as it always was.
 *
 * ## A designed look
 *
 * A video whose look the model designed (`video.ai` with a `video.design`)
 * is drawn from that design instead of one of the six styles: its five
 * colours (repaired by videodesign.ts `readDesign`, contrast included), its
 * typeface, its background motif and its pace. The motif also says whose
 * manner the scenes are drawn in — a 'frame' design lays its lists and
 * montages out as elegant does, a 'slab' one as bold does — because each
 * style's markers, montage and story bar were drawn for its own motif.
 * `video.style` stays what it always was for the words' tone. The brand's
 * colours and the person's look still win over the design, as they win over
 * a style.
 *
 * ## Art direction
 *
 * A scene's `art` (videotypes.ts) feeds the theme in two places: its ground
 * — the accent as a solid ground, an accent gradient, a dark or light ground,
 * or the scene's picture — replaces the scene's colours here, with words and
 * accents re-checked for contrast; and its alignment sits between the style's
 * and the person's. `sceneArtOf` reads a stored `art` into the fixed
 * vocabularies again, so nothing unchecked reaches the renderer. The rest of
 * the art (how words arrive, the camera, the shape) is drawn by
 * videoscenebits.tsx.
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
import type { Brand, Format, Ground, Scene, SceneArt, SceneKind, SceneLook, Style, Video, VideoDesign, VideoLang } from './videotypes';
import { CAMERAS, GROUNDS, SHAPES, TEXT_EFFECTS } from './videotypes';
import { FONT_CHOICES, LEGIBLE, contrast, legible, lookFor, luminance, mix, normalSceneLook, rgbOf } from './videolook';
import type { Align } from './videolook';
import { readDesign } from './videodesign';
import { phraseOf } from './videoemphasis';
import { loadFont as loadAmiri } from '@remotion/google-fonts/Amiri';
import { loadFont as loadAnton } from '@remotion/google-fonts/Anton';
import { loadFont as loadArchivo } from '@remotion/google-fonts/Archivo';
import { loadFont as loadArefRuqaa } from '@remotion/google-fonts/ArefRuqaa';
import { loadFont as loadBeiruti } from '@remotion/google-fonts/Beiruti';
import { loadFont as loadBricolageGrotesque } from '@remotion/google-fonts/BricolageGrotesque';
import { loadFont as loadCormorantGaramond } from '@remotion/google-fonts/CormorantGaramond';
import { loadFont as loadDMSans } from '@remotion/google-fonts/DMSans';
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces';
import { loadFont as loadIBMPlexSansArabic } from '@remotion/google-fonts/IBMPlexSansArabic';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadLora } from '@remotion/google-fonts/Lora';
import { loadFont as loadMada } from '@remotion/google-fonts/Mada';
import { loadFont as loadMarhey } from '@remotion/google-fonts/Marhey';
import { loadFont as loadNotoKufiArabic } from '@remotion/google-fonts/NotoKufiArabic';
import { loadFont as loadNotoNaskhArabic } from '@remotion/google-fonts/NotoNaskhArabic';
import { loadFont as loadNunito } from '@remotion/google-fonts/Nunito';
import { loadFont as loadPlayfairDisplay } from '@remotion/google-fonts/PlayfairDisplay';
import { loadFont as loadPlaypenSansArabic } from '@remotion/google-fonts/PlaypenSansArabic';
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
  arefRuqaa: fam('Aref Ruqaa', loadArefRuqaa),
  beiruti: fam('Beiruti', loadBeiruti),
  bricolage: fam('Bricolage Grotesque', loadBricolageGrotesque),
  cormorant: fam('Cormorant Garamond', loadCormorantGaramond),
  dmSans: fam('DM Sans', loadDMSans),
  fraunces: fam('Fraunces', loadFraunces),
  plexArabic: fam('IBM Plex Sans Arabic', loadIBMPlexSansArabic),
  inter: fam('Inter', loadInter),
  lora: fam('Lora', loadLora),
  mada: fam('Mada', loadMada),
  marhey: fam('Marhey', loadMarhey),
  notoKufi: fam('Noto Kufi Arabic', loadNotoKufiArabic),
  notoNaskh: fam('Noto Naskh Arabic', loadNotoNaskhArabic),
  nunito: fam('Nunito', loadNunito),
  playfair: fam('Playfair Display', loadPlayfairDisplay),
  playpenArabic: fam('Playpen Sans Arabic', loadPlaypenSansArabic),
  reemKufi: fam('Reem Kufi', loadReemKufi),
  spaceGrotesk: fam('Space Grotesk', loadSpaceGrotesk),
  unbounded: fam('Unbounded', loadUnbounded),
  vazirmatn: fam('Vazirmatn', loadVazirmatn),
} as const;

type FamilyKey = keyof typeof FAMILIES;

/** One face of a pair: which family, the weight headlines (or body) use, and the weights to load. */
interface Face { key: FamilyKey; weight: number; strong: number }

interface Pair { display: Face; body: Face }

const face = (key: FamilyKey, weight: number, strong = weight): Face => ({ key, weight, strong });

/** A typeface choice: its Latin and Arabic-script pairs, and how its Latin headlines are set. */
interface FontDef {
  latin: Pair;
  arabic: Pair;
  /** Latin display tracking, in em. Arabic is never tracked: it breaks the joins. */
  tracking: number;
  /** Latin display line height (Arabic always gets more room for its ascenders and dots). */
  leading: number;
  /** Arabic display line height, when the face needs more than the usual room. */
  arabicLeading?: number;
  /** The Arabic display face is for headlines only (Reem Kufi runs words together): quotations and names take the body face. */
  displayOnly?: boolean;
}

/**
 * The typefaces by `FONT_CHOICES` id. The first six are the six styles'
 * own, with the tracking and leading those styles always had; the rest are
 * the extra choices. Every Arabic family is one whose `arabic` subset has
 * the Kurdish letters (videolook.ts says how that was checked).
 */
const FONTS: Readonly<Record<string, FontDef>> = {
  geometric: {
    latin: { display: face('spaceGrotesk', 700), body: face('inter', 400, 600) },
    arabic: { display: face('vazirmatn', 800), body: face('vazirmatn', 400, 600) },
    tracking: -0.025, leading: 1.02,
  },
  condensed: {
    latin: { display: face('anton', 400), body: face('archivo', 500, 800) },
    arabic: { display: face('notoKufi', 900), body: face('notoKufi', 500, 700) },
    tracking: 0.005, leading: 0.98,
  },
  classic: {
    latin: { display: face('playfair', 600), body: face('dmSans', 400, 500) },
    arabic: { display: face('amiri', 700), body: face('notoNaskh', 400, 600) },
    tracking: -0.005, leading: 1.08,
  },
  wide: {
    latin: { display: face('unbounded', 700), body: face('spaceGrotesk', 400, 600) },
    arabic: { display: face('reemKufi', 700), body: face('mada', 400, 600) },
    tracking: 0, leading: 1.08, displayOnly: true,
  },
  swiss: {
    latin: { display: face('inter', 700), body: face('inter', 400, 500) },
    arabic: { display: face('plexArabic', 600), body: face('plexArabic', 400, 600) },
    tracking: -0.035, leading: 1.04,
  },
  soft: {
    latin: { display: face('fraunces', 700), body: face('dmSans', 400, 600) },
    arabic: { display: face('marhey', 600), body: face('vazirmatn', 400, 600) },
    tracking: -0.015, leading: 1.06,
  },
  book: {
    latin: { display: face('lora', 700), body: face('lora', 400, 600) },
    arabic: { display: face('notoNaskh', 700), body: face('notoNaskh', 400, 600) },
    tracking: -0.01, leading: 1.1,
  },
  poster: {
    latin: { display: face('bricolage', 800), body: face('bricolage', 400, 600) },
    arabic: { display: face('beiruti', 900), body: face('beiruti', 400, 700) },
    tracking: -0.03, leading: 1.0,
  },
  calligraphy: {
    latin: { display: face('cormorant', 700), body: face('lora', 400, 600) },
    arabic: { display: face('arefRuqaa', 700), body: face('notoNaskh', 400, 600) },
    tracking: 0, leading: 1.04, arabicLeading: 1.5,
  },
  rounded: {
    latin: { display: face('nunito', 800), body: face('nunito', 400, 700) },
    arabic: { display: face('playpenArabic', 700), body: face('playpenArabic', 400, 600) },
    tracking: -0.01, leading: 1.06,
  },
};

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
  /** The style's own typeface pair, a `FONTS` id. */
  font: string;
  upper: boolean;
  motion: Motion;
  align: 'start' | 'center';
  radius: number;
  grain: number;
  deco: Deco;
}

const STYLES: Readonly<Record<Style, StyleDef>> = {
  modern: {
    dark: true,
    bg: '#0B1020', bg2: '#1B1446', fg: '#F4F6FF', muted: '#A9B0D6',
    accent: '#7C5CFF', accent2: '#22D3EE', surface: '#161C38',
    font: 'geometric', upper: false,
    motion: { spring: { damping: 18, stiffness: 120, mass: 0.8 }, duration: 22, easing: Easing.bezier(0.2, 0.9, 0.2, 1), stagger: 4, travel: 60 },
    align: 'start', radius: 28, grain: 0.07, deco: 'mesh',
  },
  bold: {
    dark: true,
    bg: '#0C0C0E', bg2: '#17171B', fg: '#FFFFFF', muted: '#B8B8C0',
    accent: '#FFD60A', accent2: '#FF3D2E', surface: '#1E1E24',
    font: 'condensed', upper: true,
    motion: { spring: { damping: 12, stiffness: 220, mass: 0.55 }, duration: 12, easing: Easing.bezier(0.3, 1.4, 0.4, 1), stagger: 3, travel: 110 },
    align: 'start', radius: 6, grain: 0, deco: 'slab',
  },
  elegant: {
    dark: true,
    bg: '#12100D', bg2: '#231D16', fg: '#F5EFE4', muted: '#BDB2A0',
    accent: '#C9A86A', accent2: '#8E7A55', surface: '#1E1914',
    font: 'classic', upper: false,
    motion: { spring: null, duration: 34, easing: Easing.bezier(0.16, 1, 0.3, 1), stagger: 8, travel: 36 },
    align: 'center', radius: 2, grain: 0.06, deco: 'frame',
  },
  neon: {
    dark: true,
    bg: '#07060F', bg2: '#140A2A', fg: '#F7F3FF', muted: '#A99FCF',
    accent: '#FF2E97', accent2: '#1FF2FF', surface: '#130F26',
    font: 'wide', upper: false,
    motion: { spring: { damping: 11, stiffness: 200, mass: 0.6 }, duration: 12, easing: Easing.bezier(0.3, 1.3, 0.4, 1), stagger: 3, travel: 80 },
    align: 'center', radius: 18, grain: 0.05, deco: 'glow',
  },
  minimal: {
    dark: false,
    bg: '#F6F5F1', bg2: '#ECEAE3', fg: '#111111', muted: '#6B6A66',
    accent: '#2E5BFF', accent2: '#111111', surface: '#FFFFFF',
    font: 'swiss', upper: false,
    motion: { spring: null, duration: 24, easing: Easing.bezier(0.22, 1, 0.36, 1), stagger: 5, travel: 40 },
    align: 'start', radius: 0, grain: 0, deco: 'rule',
  },
  warm: {
    dark: false,
    bg: '#FFF4E6', bg2: '#FFD9BF', fg: '#2B1A12', muted: '#7A5A48',
    accent: '#E0573A', accent2: '#F2A541', surface: '#FFFBF5',
    font: 'soft', upper: false,
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

// ---------------------------------------------------------------------------
// A designed look

/**
 * The style whose manner each background motif is drawn in: a designed look
 * takes its motif's markers, montage, reveal and story bar, in its own
 * colours, typeface and pace.
 */
const DECO_STYLE: Readonly<Record<Deco, Style>> = { mesh: 'modern', slab: 'bold', frame: 'elegant', glow: 'neon', rule: 'minimal', sun: 'warm' };

/** How a designed look moves, by its energy: eased and slow as elegant, springy as modern, quick as bold. */
const ENERGY_MOTION: Readonly<Record<VideoDesign['energy'], Motion>> = {
  calm: STYLES.elegant.motion,
  lively: STYLES.modern.motion,
  punchy: STYLES.bold.motion,
};

const designs = new WeakMap<object, VideoDesign | null>();

/**
 * The look the model designed, as it is drawn: `video.design` read and
 * repaired by `readDesign` (colours legible, a known typeface and motif),
 * while `video.ai` is on; null for a video drawn in one of the six styles.
 * Read once per stored design — themes are built every frame.
 */
export function designOf(v: Pick<Video, 'ai' | 'design'>): VideoDesign | null {
  if (!v.ai || !v.design || typeof v.design !== 'object') return null;
  const hit = designs.get(v.design);
  if (hit !== undefined) return hit;
  let d: VideoDesign | null = null;
  try {
    d = readDesign(v.design);
  } catch {
    d = null;
  }
  designs.set(v.design, d);
  return d;
}

/**
 * A designed look as a style: its colours, a quieter shade of its words for
 * secondary lines (still 4.5:1), a surface for cards between its two
 * grounds, its typeface, its motif with that motif's corners and grain, and
 * its pace — capitals for Latin headlines when it is punchy, words centred
 * for the two motifs that frame the middle (frame, sun).
 */
function designDef(d: VideoDesign): StyleDef {
  const base = styleOf(DECO_STYLE[d.deco] ?? 'modern');
  const dark = inkOn(d.bg) === '#FFFFFF';
  const surface = dark
    ? mix(mix(d.bg, d.bg2, 0.5), '#FFFFFF', 0.06)
    : luminance(d.bg) > 0.9 ? mix(d.bg, d.bg2, 0.7) : mix(d.bg, '#FFFFFF', 0.65);
  return {
    dark,
    bg: d.bg,
    bg2: d.bg2,
    fg: d.fg,
    muted: legible(mix(d.fg, d.bg, 0.3), d.bg),
    accent: d.accent,
    accent2: d.accent2,
    surface,
    font: FONTS[d.font] ? d.font : 'geometric',
    upper: d.energy === 'punchy',
    motion: ENERGY_MOTION[d.energy] ?? ENERGY_MOTION.lively,
    align: d.deco === 'frame' || d.deco === 'sun' ? 'center' : 'start',
    radius: base.radius,
    grain: base.grain,
    deco: VIDEO_DECO_SET.has(d.deco) ? d.deco : 'mesh',
  };
}

const VIDEO_DECO_SET = new Set<string>(Object.keys(DECO_STYLE));

/** The style a video is drawn in the manner of: its own, or its designed look's motif's. */
export function drawStyleOf(v: Pick<Video, 'style' | 'ai' | 'design'>): Style {
  const d = designOf(v);
  return d ? DECO_STYLE[d.deco] ?? 'modern' : v.style;
}

/** Re-exported for the Look tab and the chat: the typefaces `look.font` names, each with every Kurdish letter. */
export { FONT_CHOICES };

/** What the fonts of a video depend on: its script, its style, its look and its design. */
type FontSource = Pick<Video, 'lang' | 'style' | 'look' | 'ai' | 'design'>;

/**
 * The typeface a video is set in: its `look.font` when that is a known
 * choice (the person's word wins), else its designed look's, else its
 * style's own.
 */
function fontIdOf(v: Pick<Video, 'style' | 'look' | 'ai' | 'design'>): string {
  const chosen = lookFor(v).font;
  if (chosen && FONTS[chosen]) return chosen;
  const d = designOf(v);
  if (d && FONTS[d.font]) return d.font;
  return styleOf(v.style).font;
}

const fontDefOf = (v: Pick<Video, 'style' | 'look' | 'ai' | 'design'>): FontDef => FONTS[fontIdOf(v)] ?? FONTS.geometric;

/** The two families a video uses, per its language, style and chosen typeface. */
export function fontPair(lang: VideoLang, style: Style, font?: string): Pair {
  const d = fontDefOf({ style, look: font ? { font } : undefined });
  return rtlLang(lang) ? d.arabic : d.latin;
}

const loaded = new Set<string>();
const loading = new Map<string, Promise<void>>();

/** What a video's fonts are cached under: the typeface and the script, so two styles that share a pair share a load. */
export const fontKeyOf = (v: FontSource) => `${fontIdOf(v)}:${rtlLang(v.lang) ? 'arabic' : 'latin'}`;

/** Whether the fonts for this language, style and typeface have finished loading. */
export const fontsReady = (v: FontSource) => loaded.has(fontKeyOf(v));

/**
 * Loads the video's pair for its script — the style's own, the designed
 * look's, or the one `look.font` chose: only the two or three weights used,
 * only the subsets needed (Arabic-script videos also take the Latin subset of
 * the same families, for a brand name or a web address). Every family in
 * `FONTS` has those subsets in those weights; a missing one would make the
 * loader throw.
 */
export function loadFonts(v: FontSource): Promise<void> {
  const key = fontKeyOf(v);
  const done = loading.get(key);
  if (done) return done;
  const pair = fontPair(v.lang, v.style, fontIdOf(v));
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
// Colour (the arithmetic is videolook.ts's, which the chat shares)

export { contrast, luminance, mix, rgbOf };

/** A colour at an opacity, as rgba(). */
export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** Near-black or white, whichever reads on this colour. */
export const inkOn = (bg: string, dark = '#0C0C0E', light = '#FFFFFF') =>
  contrast(bg, dark) >= contrast(bg, light) ? dark : light;

const validHex = (s: string | undefined): s is string => typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s.trim());

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
  /** Where words sit: the look's alignment when one is set, else the style's own. */
  align: Align;
  /** The look set `align` — kinds that centre by habit follow it then. */
  alignSet: boolean;
  radius: number;
  grain: number;
  deco: Deco;
  /** A scene that swaps to the accent as its background (the bold style alternates). */
  inverted: boolean;
  /** The Arabic display face is for headlines only (Reem Kufi): quotations and names are set in the body face. */
  displayOnly: boolean;
  /** Drawn in the style's own typeface pair (no `look.font`, or the style's own). */
  ownFont: boolean;
  /** The words' colour the look asked for, before it was made legible — words over a picture use it when it reads there. */
  textSet?: string;
  /** The look replaced the style's background. */
  groundSet: boolean;
  /**
   * The scene's art ground in effect ('style' when it has none, when the
   * person's background replaced it, or when the scene's kind shows its
   * picture itself): what videoscenebits.tsx `Backdrop` draws instead of the
   * style's moving background.
   */
  ground: Ground;
  /** Drawn from the model's designed look rather than one of the six styles. */
  designed: boolean;
  /** A loud look — bold, or a design with punchy energy — where a poster may outline alternate lines. */
  punchy: boolean;
}

const FALLBACK_LATIN = "'Helvetica Neue', Arial, sans-serif";
const FALLBACK_ARABIC = "'Geeza Pro', 'Noto Sans Arabic', Tahoma, sans-serif";

/**
 * The theme for a video, with the brand's colours in place of the style's:
 * the brand's primary becomes the accent, its accent the second accent. A
 * scene index lets the bold style alternate between dark and accent grounds.
 *
 * The look (videolook.ts) comes last: the video's, with `sceneLook` over it
 * when given. A background replaces the style's (with a quiet gradient of
 * its own for the moving backdrop, and no accent-coloured alternation in
 * bold); words take the look's colour, moved towards white or black until
 * they read at 4.5:1 on that background — and when only the background is
 * set, the style's words stay as they are if they still read, else turn
 * near-black or white. An accent that would vanish into the new background
 * gives way to the second accent for shapes. `look.font` swaps the families
 * and their Latin tracking and leading; capitals stay the style's.
 *
 * A designed look (`designOf`) stands in for the style: its colours and
 * typeface, its motif's manner (`theme.style` is that style), its pace; bold's
 * alternating accent scenes are the style's habit, not a design's — a
 * designed film puts an accent ground where its art says so.
 *
 * `art` is the scene's direction, from `sceneTheme`: its ground (already
 * resolved by `groundOf`) and its alignment. A colour ground gives way to a
 * background the person chose; alignment goes style < art < the person's.
 */
export function themeOf(v: ThemeSource, sceneIndex = 0, allowInvert = true, sceneLook?: SceneLook, art?: SceneDirection): Theme {
  const design = designOf(v);
  const d = design ? designDef(design) : styleOf(v.style);
  const style: Style = design ? DECO_STYLE[design.deco] ?? 'modern' : v.style;
  const rtl = rtlLang(v.lang);
  const look = lookFor(v, sceneLook ? { look: sceneLook } : undefined);
  const fontId = fontIdOf(v);
  const fd = FONTS[fontId] ?? FONTS.geometric;
  const pair = rtl ? fd.arabic : fd.latin;
  const brand: Brand = v.brand ?? {};
  let accent = validHex(brand.primary) ? brand.primary.trim() : d.accent;
  let accent2 = validHex(brand.accent) ? brand.accent.trim() : validHex(brand.primary) ? mix(accent, d.dark ? '#FFFFFF' : '#000000', 0.35) : d.accent2;
  let bg = d.bg;
  let bg2 = d.bg2;
  let fg = d.fg;
  let muted = d.muted;
  let surface = d.surface;
  const ground = look.background;
  if (ground) {
    // The asked-for colour, and for the moving backdrop a gradient to a slightly lifted (or deepened) shade touched by the accent.
    const darkGround = luminance(ground) < 0.4;
    bg = ground;
    bg2 = mix(mix(ground, darkGround ? '#FFFFFF' : '#000000', 0.08), accent, 0.08);
    surface = darkGround ? mix(ground, '#FFFFFF', 0.07) : mix(ground, '#FFFFFF', 0.6);
  } else if (!design && validHex(brand.primary) && d.dark && v.style !== 'bold') {
    // A brand colour tints the dark grounds a little, so the film feels like the brand's. (A design was made with the brand's colours in mind.)
    bg = mix(d.bg, accent, 0.06);
    bg2 = mix(d.bg2, accent, 0.18);
  }
  // The scene's art ground: a photograph is the scene's own picture and stays (groundOf let a scene's own
  // background win already); a colour ground gives way to a background the person chose.
  const artGround: Ground = art?.ground === 'photo' ? 'photo' : !ground && art?.ground && GROUND_SET.has(art.ground) ? art.ground : 'style';
  // A background the person chose is kept on every scene: bold does not swap it for its accent — nor where the art chose a ground.
  const inverted = allowInvert && !design && v.style === 'bold' && sceneIndex % 2 === 1 && !ground && artGround === 'style';
  if (inverted) {
    const ink = inkOn(accent);
    bg = accent;
    bg2 = mix(accent, ink, 0.08);
    fg = ink;
    muted = alpha(ink, 0.72);
    surface = mix(accent, ink, 0.1);
    accent2 = ink === '#FFFFFF' ? '#0C0C0E' : '#FFFFFF';
    accent = ink;
  }
  const coloured = artGround === 'accent' || artGround === 'gradient' || artGround === 'dark' || artGround === 'light';
  if (coloured) ({ bg, bg2, fg, muted, surface, accent, accent2 } = groundColours(artGround, { fg, accent, accent2 }));
  if (ground || look.text || coloured) {
    fg = look.text ? legible(look.text, bg) : contrast(fg, bg) >= LEGIBLE ? fg : legible(inkOn(bg), bg);
    muted = !look.text && validHex(muted) && contrast(muted, bg) >= 3 ? muted : legible(mix(fg, bg, 0.3), bg, 3);
  }
  if ((ground || design) && contrast(accent, bg) < 1.5) accent = contrast(accent2, bg) >= 1.5 ? accent2 : fg;
  const fam = (f: Face) => `'${FAMILIES[f.key].family}', ${rtl ? FALLBACK_ARABIC : FALLBACK_LATIN}`;
  const accentText = contrast(accent, bg) >= 2.6 ? accent : fg;
  const artAlign = art?.align && ALIGN_SET.has(art.align) ? art.align : undefined;
  const theme: Theme = {
    style,
    lang: v.lang,
    rtl,
    dark: ground || inverted || design || coloured ? luminance(bg) < 0.4 : d.dark,
    bg, bg2, fg, muted, accent, accent2, accentText,
    onAccent: inkOn(accent),
    surface,
    display: {
      family: fam(pair.display),
      weight: pair.display.weight,
      strong: pair.display.strong,
      tracking: rtl ? 0 : fd.tracking,
      upper: !rtl && d.upper,
      leading: rtl ? fd.arabicLeading ?? Math.max(1.3, fd.leading + 0.3) : fd.leading,
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
    align: look.align ?? artAlign ?? d.align,
    alignSet: !!(look.align ?? artAlign),
    radius: d.radius,
    grain: d.grain,
    deco: d.deco,
    inverted,
    displayOnly: rtl && !!fd.displayOnly,
    ownFont: fontId === styleOf(style).font,
    textSet: look.text,
    groundSet: !!ground,
    ground: artGround,
    designed: !!design,
    punchy: design ? design.energy === 'punchy' : v.style === 'bold',
  };
  return artGround === 'photo' ? onPhotoTheme(theme) : theme;
}

/** What a theme is built from: the video's script, style, brand, look and designed look. */
export type ThemeSource = Pick<Video, 'lang' | 'style' | 'brand' | 'look' | 'ai' | 'design'>;

/** A scene's art as the theme takes it: its ground (resolved by `groundOf`) and its alignment. */
export interface SceneDirection { ground?: Ground; align?: Align }

const GROUND_SET = new Set<string>(GROUNDS);
const ALIGN_SET = new Set<string>(['start', 'center', 'end']);

/** The theme scene `index` of a video is drawn in: the video's look with that scene's art and look over it. */
export function sceneTheme(v: Pick<Video, 'lang' | 'style' | 'brand' | 'look' | 'scenes' | 'ai' | 'design'>, index: number, allowInvert = true): Theme {
  const scene = v.scenes?.[index];
  if (!scene) return themeOf(v, index, allowInvert);
  return themeOf(v, index, allowInvert, scene.look, { ground: groundOf(scene), align: sceneArtOf(scene).align });
}

/**
 * Near-black and white, the two inks words take on a coloured ground.
 * `inkOn` picks between them by contrast.
 */
const INK_DARK = '#0C0C0E';
const INK_LIGHT = '#FFFFFF';

/**
 * A scene's colours on a colour ground its art chose, from the colours it
 * would otherwise have (`c`, after the brand's and any inversion):
 *
 * - accent: the accent itself, deepened or lightened just enough for its ink
 *   (near-black or white) to read at 4.5:1; shapes take the second accent
 *   when it shows on it, else the ink.
 * - gradient: the two accents from one corner to the other, each moved until
 *   the one ink that suits both reads on both at 4.5:1 (two accents too alike
 *   to show a gradient get a deeper second stop); shapes are the ink.
 * - dark / light: a near-black or near-white ground touched by the accents;
 *   the words keep their colour when it reads at 7:1, else take the ink, and
 *   accents that would vanish are moved until they show at 3:1.
 *
 * Secondary words (`muted`) stay at 4.5:1 on every one.
 */
function groundColours(g: 'accent' | 'gradient' | 'dark' | 'light', c: { fg: string; accent: string; accent2: string }): {
  bg: string; bg2: string; fg: string; muted: string; surface: string; accent: string; accent2: string;
} {
  switch (g) {
    case 'accent': {
      const ink = inkOn(c.accent, INK_DARK, INK_LIGHT);
      const bg = legible(c.accent, ink);
      const shape = contrast(c.accent2, bg) >= 2.5 ? c.accent2 : ink;
      return {
        bg,
        bg2: mix(bg, ink, 0.1),
        fg: ink,
        muted: legible(mix(ink, bg, 0.25), bg),
        surface: mix(bg, ink, 0.1),
        accent: shape,
        accent2: shape === ink ? mix(bg, ink, 0.35) : ink,
      };
    }
    case 'gradient': {
      const score = (ink: string) => Math.min(contrast(c.accent, ink), contrast(c.accent2, ink));
      const ink = score(INK_LIGHT) >= score(INK_DARK) ? INK_LIGHT : INK_DARK;
      const a = legible(c.accent, ink);
      let b = legible(c.accent2, ink);
      if (contrast(a, b) < 1.15) b = legible(mix(a, ink === INK_LIGHT ? '#000000' : '#FFFFFF', 0.3), ink);
      const mid = mix(a, b, 0.5);
      const soft = mix(ink, mid, 0.2);
      return {
        bg: a,
        bg2: b,
        fg: ink,
        muted: Math.min(contrast(soft, a), contrast(soft, b)) >= LEGIBLE ? soft : ink,
        surface: mix(mid, ink, 0.12),
        accent: ink,
        accent2: mix(ink, mid, 0.45),
      };
    }
    case 'dark': {
      const bg = mix('#0B0B10', c.accent, 0.08);
      const fg = contrast(c.fg, bg) >= 7 ? c.fg : '#F4F4F6';
      const lift = (x: string) => (contrast(x, bg) >= 3 ? x : legible(x, bg, 3));
      return {
        bg,
        bg2: mix('#16151D', c.accent2, 0.14),
        fg,
        muted: legible(mix(fg, bg, 0.32), bg),
        surface: mix(bg, '#FFFFFF', 0.07),
        accent: lift(c.accent),
        accent2: lift(c.accent2),
      };
    }
    case 'light': {
      const bg = mix('#FAF9F6', c.accent, 0.05);
      const fg = contrast(c.fg, bg) >= 7 ? c.fg : '#111114';
      const lift = (x: string) => (contrast(x, bg) >= 3 ? x : legible(x, bg, 3));
      return {
        bg,
        bg2: mix('#ECEBE6', c.accent2, 0.1),
        fg,
        muted: legible(mix(fg, bg, 0.35), bg),
        surface: '#FFFFFF',
        accent: lift(c.accent),
        accent2: lift(c.accent2),
      };
    }
  }
}

/**
 * A theme for words over a picture: always light words on a darkened
 * picture, whatever the style — a light scrim over a photograph looks
 * washed out. The look's words colour stays when it reads on a darkened
 * picture; the accent stays for words when it reads there too.
 */
export function onPhotoTheme(theme: Theme): Theme {
  const dark = '#0B0B0E';
  const set = theme.textSet && contrast(theme.textSet, dark) >= 4.5 ? theme.textSet : null;
  const ink = set ?? '#FFFFFF';
  return {
    ...theme,
    fg: ink,
    muted: set ? alpha(set, 0.82) : 'rgba(255, 255, 255, 0.82)',
    accentText: contrast(theme.accent, dark) >= 3 ? theme.accent : ink,
    dark: true,
  };
}

// ---------------------------------------------------------------------------
// Art direction

const NO_ART: SceneArt = Object.freeze({}) as SceneArt;
const arts = new WeakMap<object, SceneArt>();

const pick = <T extends string>(x: unknown, list: readonly T[]): T | undefined =>
  typeof x === 'string' && (list as readonly string[]).includes(x) ? (x as T) : undefined;

/**
 * A scene's art as the renderer draws it: every field one of its words again
 * (a stored scene from a hand-edited file or an older build cannot reach the
 * renderer unchecked), the emphasis as at most three short strings. Absent
 * fields are the style's. Read once per stored `art` object.
 */
export function sceneArtOf(scene: { art?: SceneArt } | null | undefined): SceneArt {
  const a = scene?.art as unknown;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return NO_ART;
  const hit = arts.get(a);
  if (hit) return hit;
  const x = a as Record<string, unknown>;
  const out: SceneArt = {};
  const effect = pick(x.effect, TEXT_EFFECTS);
  if (effect) out.effect = effect;
  const ground = pick(x.ground, GROUNDS);
  if (ground) out.ground = ground;
  const camera = pick(x.camera, CAMERAS);
  if (camera) out.camera = camera;
  const shape = pick(x.shape, SHAPES);
  if (shape) out.shape = shape;
  const align = pick(x.align, ['start', 'center', 'end'] as const);
  if (align) out.align = align;
  const size = pick(x.size, ['quiet', 'normal', 'hero'] as const);
  if (size) out.size = size;
  if (Array.isArray(x.emphasis)) {
    const words = x.emphasis
      .filter((w): w is string => typeof w === 'string')
      .map((w) => w.replace(/\s+/g, ' ').trim())
      .filter((w) => w && w.length <= 30)
      .slice(0, 3);
    if (words.length) out.emphasis = words;
  }
  arts.set(a, out);
  return out;
}

/** Kinds that place their picture themselves, where a photo ground would only repeat it. */
const OWN_PICTURE = new Set<SceneKind>(['image', 'title', 'split', 'device', 'gallery', 'clip']);

/**
 * The art ground a scene is drawn on. 'photo' needs the scene's own picture,
 * on a kind whose words sit on the ground (a picture scene, a split, a
 * device and a montage show their pictures their own way), and gives way to
 * a background the person set on the scene. A colour ground is not drawn
 * under a picture that fills the frame already (a picture scene, a title
 * with one); `themeOf` also lets a background the person chose win over it.
 */
export function groundOf(scene: Scene | null | undefined): Ground {
  const g = sceneArtOf(scene).ground;
  if (!scene || !g || g === 'style') return 'style';
  const pictured = !!scene.picture?.src;
  if (g === 'photo') return pictured && !OWN_PICTURE.has(scene.kind) && !normalSceneLook(scene.look).background ? 'photo' : 'style';
  if (pictured && (scene.kind === 'image' || scene.kind === 'title')) return 'style';
  return g;
}

/** A scene's emphasis as phrases, each its folded words in order (videoemphasis.ts `phraseOf`). */
export type Emphasis = readonly (readonly string[])[];

const emphasisLists = new WeakMap<object, Emphasis>();
const NO_PHRASES: Emphasis = Object.freeze([]) as Emphasis;

/** The phrases a scene's art sets in the accent, each lit only where its words stand together (`markPhrases`). */
export function emphasisOf(art: SceneArt): Emphasis {
  if (!art.emphasis?.length) return NO_PHRASES;
  const hit = emphasisLists.get(art);
  if (hit) return hit;
  const out = art.emphasis.map(phraseOf).filter((p) => p.length);
  emphasisLists.set(art, out);
  return out;
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
 * phone apps draw their own buttons and captions: no words in the top 12% or
 * the bottom 18% of a vertical frame (Reels, TikTok, Shorts and Stories all
 * put their names, captions and buttons there).
 */
export const PORTRAIT_SAFE = { top: 0.12, bottom: 0.18 } as const;

export function boxOf(width: number, height: number): Box {
  const format: Format = width > height * 1.15 ? 'landscape' : height > width * 1.15 ? 'portrait' : 'square';
  const u = Math.min(width, height) / 1080;
  const m = format === 'landscape'
    ? { x: 150, top: 110, bottom: 120 }
    : format === 'portrait'
      ? { x: 90, top: Math.ceil((height * PORTRAIT_SAFE.top) / u) + 2, bottom: Math.ceil((height * PORTRAIT_SAFE.bottom) / u) + 2 }
      : { x: 100, top: 110, bottom: 120 };
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
  /** The width the lines were fitted into — how wide a line may grow as it arrives (the 'scale' effect). */
  room?: number;
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
  const fit: Fit = { size, lines: best.lines, width: best.widest || Math.max(...best.lines.map((l) => widthAt100(l, o.face, !!o.bold, o.ready) * k)), room: o.maxWidth };
  if (o.ready) fitCache.set(key, fit);
  return fit;
}

/** The width of a short string at a size, for things like counters that must not jump. */
export function textWidth(text: string, f: TypeFace, size: number, bold: boolean, ready: boolean): number {
  return (widthAt100(text, f, bold, ready) * size) / 100;
}

// ---------------------------------------------------------------------------
// Numbers

/**
 * The digits a video's numbers are drawn in. English is always Western. An
 * Arabic, Sorani or Badini video draws them in Arabic-Indic digits (١٢٣) —
 * the digits Iraqi and Kurdish print uses — unless its own words are written
 * with Western ones (a request and a storyboard that say "2024", "30%"),
 * because a counter in one set of digits under a line in the other reads as
 * two different videos. Decided once per video, from all of its words.
 */
export type Numerals = 'latn' | 'arab';

const numeralsCache = new WeakMap<object, Numerals>();

export function numeralsOf(v: Pick<Video, 'lang' | 'scenes' | 'title'>): Numerals {
  if (!rtlLang(v.lang)) return 'latn';
  const hit = numeralsCache.get(v);
  if (hit) return hit;
  // Only the words the film shows — never ids, searches, pictures or web addresses, which are Latin on purpose.
  const words: string[] = [v.title ?? ''];
  for (const s of v.scenes ?? []) {
    switch (s.kind) {
      case 'title': words.push(s.title, s.subtitle ?? ''); break;
      case 'kinetic': words.push(s.text); break;
      case 'bullets': words.push(s.heading, ...s.points); break;
      case 'stat': words.push(s.label, s.prefix ?? '', s.suffix ?? ''); break;
      case 'chart': words.push(s.heading, ...s.bars.map((x) => x.label), s.unit ?? ''); break;
      case 'quote': words.push(s.quote, s.author ?? ''); break;
      case 'image': words.push(s.caption ?? ''); break;
      case 'split': words.push(s.heading, s.text); break;
      case 'steps': words.push(s.heading, ...s.steps); break;
      case 'outro': words.push(s.headline, s.cta ?? ''); break;
      case 'gallery': words.push(s.heading ?? ''); break;
      case 'timeline': words.push(s.heading, ...s.events.flatMap((e) => [e.when, e.text])); break;
      case 'compare': words.push(s.heading, s.left.title, ...s.left.points, s.right.title, ...s.right.points); break;
      case 'people': words.push(s.heading, ...s.people.flatMap((x) => [x.name, x.role ?? ''])); break;
      case 'logo': words.push(s.tagline ?? ''); break;
      case 'qr': words.push(s.heading); break;
      case 'bigtype': words.push(...(s.lines ?? [])); break;
      case 'features': words.push(s.heading ?? '', ...(s.items ?? []).map((x) => x?.label ?? '')); break;
      case 'device': words.push(s.heading, s.text ?? ''); break;
      case 'marquee': words.push(s.text, s.sub ?? ''); break;
    }
  }
  const text = words.filter((w) => typeof w === 'string').join(' ');
  const western = (text.match(/[0-9]/g) ?? []).length;
  const eastern = (text.match(/[\u0660-\u0669\u06F0-\u06F9]/g) ?? []).length;
  const out: Numerals = western > eastern ? 'latn' : 'arab';
  numeralsCache.set(v, out);
  return out;
}

/**
 * A string of Western digits in the video's digits: 0-9 become ٠-٩, and the
 * separators between digits their Arabic forms (٬ for thousands, ٫ for the
 * decimal point), % the Arabic ٪. Left as it is for 'latn', and whenever it
 * holds Latin letters — "4G" or "COVID-19" is a name, not a number.
 */
export function localDigits(s: string, n: Numerals): string {
  if (n !== 'arab' || !s || /[A-Za-z]/.test(s)) return s;
  return s
    .replace(/(\d),(?=\d)/g, '$1\u066C')
    .replace(/(\d)\.(?=\d)/g, '$1\u066B')
    .replace(/%/g, '\u066A')
    .replace(/[0-9]/g, (d) => String.fromCharCode(0x660 + Number(d)));
}

/** A number with thousands separators and `decimals` places, in the video's digits. */
export function formatNum(v: number, decimals: number, n: Numerals): string {
  const s = (Number.isFinite(v) ? v : 0).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return localDigits(s, n);
}
