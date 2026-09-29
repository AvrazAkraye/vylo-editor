import type { Lang } from './i18n';
import type { Motion, Voice } from './motiontypes';

/**
 * Which typeface a line of a graphic is set in, and how its numbers are
 * written.
 *
 * ## A voice is a feel; Arabic script has one face
 *
 * A voice (`VOICES`) is a feel — plain, heavy, bookish, friendly, typed, tall
 * — and for Latin words it is a stack of the system faces that have that feel
 * on macOS and Windows. Nothing is bundled or fetched for Latin, so a graphic
 * renders offline on any machine. Arabic-script words (Arabic, Sorani,
 * Badini) are set in the bundled Noto Sans Arabic whatever the voice: it is
 * the face this app ships because it has ڕ ڵ ێ ۆ ە, which many Arabic faces
 * lack, and a Kurdish word in a face without them falls back letter by letter
 * into two typefaces mid-word. The system's Arabic faces follow it only for
 * the moment before it loads.
 *
 * ## Digits are written here, not by Intl
 *
 * In Arabic and Kurdish a counter's number is written in Arabic-Indic digits
 * (٠١٢٣…) with the Arabic separators. `Intl.NumberFormat` can do that, but
 * what it writes comes from the locale data each engine ships — a Node built
 * with small ICU has English only — and a frame must be the same picture in
 * the preview, the export and a test. So the digits, the grouping and the
 * separators are written by hand.
 *
 * Pure: only `ensureFonts` touches the document, and only when there is one,
 * so the renderer's tests import this file in Node.
 */

/** A line's writing system, as far as choosing a typeface goes: the one choice the words make is whether the bundled Arabic face must set them. */
export type Script = 'arabic' | 'latin';

/**
 * Arabic-script characters: Arabic, Arabic Supplement, Arabic Extended-A and
 * both presentation-form blocks. U+FEFF, the byte-order mark at the end of the
 * last block, is not a letter: a title pasted from a file with one in front
 * must stay in its Latin face.
 */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;

/**
 * `arabic` when any character of `text` is Arabic script, `latin` otherwise.
 * Any, not most: one Kurdish word in an English line still needs the face
 * that has its letters, and Arabic-Indic digits are drawn by it too.
 */
export function scriptOf(text: string): Script {
  return typeof text === 'string' && ARABIC.test(text) ? 'arabic' : 'latin';
}

/**
 * The bundled Noto Sans Arabic, weights 400 to 700, declared with
 * `@font-face` in styles.css. Its `unicode-range` is Arabic script only, so
 * a stack that leads with it never changes how a Latin letter looks.
 */
export const ARABIC_FACE = 'Vylo Arabic';

/**
 * Each voice's Latin faces: the platform's own first, then the named ones, then
 * the generic family every engine has.
 *
 * Measured in the app's real engine (macOS 26 WKWebView), not assumed: `Inter`,
 * `SF Pro`, `New York`, `SF Mono` and `SF Pro Rounded` do NOT resolve by name
 * there — a stack that led with them fell through to Helvetica Neue and Times
 * without a word. What does resolve is the generic `system-ui`, `ui-serif`,
 * `ui-rounded` and `ui-monospace`, which WebKit maps to SF Pro, New York, SF
 * Rounded and SF Mono. So those lead their stacks; the names stay after them
 * for engines that do find a face by name.
 *
 * `Inter` and `Nunito` are deliberately not in any stack. They are not installed
 * on a Mac or a PC, but Video loads them from Google Fonts when it draws a
 * style that uses them, and a family the page has registered wins over the
 * system's: a stack that named them would draw differently depending on
 * whether Video had been opened first, and a frame must not depend on that.
 */
const LATIN: Readonly<Record<Voice, string>> = {
  sans: 'system-ui,"Helvetica Neue","Segoe UI",sans-serif',
  bold: '"Avenir Next","Avenir Next Condensed","Helvetica Neue","Segoe UI Black","Arial Black",sans-serif',
  serif: 'ui-serif,"New York","Iowan Old Style","Georgia","Times New Roman",serif',
  round: 'ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold","Segoe UI",system-ui,sans-serif',
  mono: 'ui-monospace,"SF Mono","Menlo","Consolas","Courier New",monospace',
  condensed: '"Impact","Haettenschweiler","Arial Narrow Bold","Avenir Next Condensed","Arial Narrow",sans-serif',
};

/** The Arabic faces macOS and Windows have, for the moment before the bundled one loads. */
const ARABIC_SYSTEM = '"Geeza Pro","Segoe UI","Tahoma"';

/**
 * A CSS `font-family` list for words in `voice` and `script`. An unknown
 * voice (a stored document from a later build) is set as `sans` rather than
 * in the browser's default serif.
 */
export function fontStack(voice: Voice, script: Script): string {
  const v: Voice = Object.prototype.hasOwnProperty.call(LATIN, voice) ? voice : 'sans';
  if (script !== 'arabic') return LATIN[v];
  const generic = v === 'serif' ? 'serif' : v === 'mono' ? 'monospace' : 'sans-serif';
  return `"${ARABIC_FACE}",${ARABIC_SYSTEM},${generic}`;
}

/**
 * The largest size written, in pixels: far past any frame, and short of sizes
 * an engine refuses — a `ctx.font` it cannot parse is ignored without a word,
 * and the canvas goes on drawing in whatever font it had before.
 */
const MAX_PX = 100_000;

/**
 * A canvas `ctx.font` value: `${weight} ${px}px ${stack}`. The size is rounded
 * to hundredths of a pixel; the weight is a whole number held in 400..700 for
 * Arabic script — the bundled face has only those, and asking for 900 would
 * have the engine fake a bold over it — and in 100..900 otherwise. Anything
 * that is not a number becomes one, for the same reason as `MAX_PX`.
 */
export function fontString(voice: Voice, weight: number, px: number, script: Script): string {
  const [lo, hi] = script === 'arabic' ? [400, 700] : [100, 900];
  const w = Number.isFinite(weight) ? Math.min(hi, Math.max(lo, Math.round(weight))) : Math.max(lo, 400);
  const size = Number.isFinite(px) && px > 0 ? Math.min(MAX_PX, Math.round(px * 100) / 100) : 0;
  return `${w} ${size}px ${fontStack(voice, script)}`;
}

/** Which digits a graphic's numbers are written in: Arabic-Indic for Arabic and both Kurdish languages, as their readers write them. */
export function digitsFor(lang: Lang): 'latn' | 'arab' {
  return lang === 'ar' || lang === 'ckb' || lang === 'kmr' ? 'arab' : 'latn';
}

/** 0-9 as ٠-٩ (U+0660 to U+0669), everything else as it is — the separators included, which `formatNumber` chooses itself. */
export function toArabicDigits(s: string): string {
  return String(s).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + d.charCodeAt(0) - 48));
}

/** The Arabic decimal separator and thousands separator. They look like a comma and a stop, and are neither. */
const ARABIC_DECIMAL = '\u066B';
const ARABIC_GROUP = '\u066C';

/** Digits in threes from the right, joined by commas. */
function grouped(int: string): string {
  let out = '';
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += ',';
    out += int[i];
  }
  return out;
}

/**
 * A number as a counter shows it, the same on every engine: `decimals` places
 * (0 to 3), commas every three digits when `group` is on, a minus sign kept —
 * but never on a number that shows as zero ("-0.00") — and a value that is
 * not finite shown as 0. For Arabic and Kurdish, Arabic-Indic digits with the
 * Arabic separators (٫ for the decimal point, ٬ between thousands). Past
 * 10^21, where `toFixed` would switch to exponent notation, the digits are
 * written out in full.
 */
export function formatNumber(n: number, o: { decimals: number; group: boolean; lang: Lang }): string {
  const arab = digitsFor(o?.lang) === 'arab';
  if (!Number.isFinite(n)) return arab ? toArabicDigits('0') : '0';
  const places = Number.isFinite(o?.decimals) ? Math.min(3, Math.max(0, Math.round(o.decimals))) : 0;
  const abs = Math.abs(n);
  const fixed = abs < 1e21 ? abs.toFixed(places) : `${BigInt(abs).toString()}${places ? `.${'0'.repeat(places)}` : ''}`;
  const [int, frac = ''] = fixed.split('.');
  const zero = /^[0.]*$/.test(fixed);
  const latn = `${n < 0 && !zero ? '-' : ''}${o?.group ? grouped(int) : int}${frac ? `.${frac}` : ''}`;
  if (!arab) return latn;
  return toArabicDigits(latn).replace('.', ARABIC_DECIMAL).replace(/,/g, ARABIC_GROUP);
}

/**
 * The weight a chart's words are loaded at. A chart names no weight of its
 * own, and the bundled face is one file for every weight from 400 to 700, so
 * one weight is enough to have it ready.
 */
const CHART_WEIGHT = 600;

/**
 * What `document.fonts.load` is given to set: it fetches only the faces whose
 * `unicode-range` meets this text, so the Arabic sample has Arabic and Kurdish
 * letters and the Arabic-Indic digits.
 */
const SAMPLE: Readonly<Record<Script, string>> = {
  arabic: '\u0627\u0628\u062C \u0695\u06B5\u06CE\u06C6\u06D5 \u0660\u0661\u0662',
  latin: 'Aa0',
};

interface Need { font: string; script: Script }

/** Each distinct font a document draws words in, with the script it is for, in the order the layers use them. */
function needsOf(m: Motion): Need[] {
  const out: Need[] = [];
  const seen = new Set<string>();
  const add = (voice: Voice, weight: number, script: Script) => {
    const font = fontString(voice, weight, 32, script);
    if (!seen.has(font)) {
      seen.add(font);
      out.push({ font, script });
    }
  };
  const arabDigits = digitsFor(m.lang) === 'arab';
  for (const l of Array.isArray(m.layers) ? m.layers : []) {
    if (l.kind === 'text') add(l.voice, l.weight, scriptOf(l.text));
    else if (l.kind === 'counter') add(l.voice, l.weight, arabDigits ? 'arabic' : scriptOf(l.prefix + l.suffix));
    else if (l.kind === 'chart') {
      const words = l.unit + l.data.map((d) => d.label).join(' ');
      add(l.voice, CHART_WEIGHT, arabDigits ? 'arabic' : scriptOf(words));
    }
  }
  return out;
}

/**
 * The `ctx.font` strings a document's words are drawn in — one for each
 * voice, weight and script its text, counter and chart layers use, at a fixed
 * 32px — so they can be loaded before the first frame. A counter or a chart
 * in Arabic or Kurdish needs the Arabic face for its digits alone.
 */
export function fontsNeeded(m: Motion): string[] {
  return needsOf(m).map((n) => n.font);
}

/**
 * Every font the document uses loaded, or two seconds gone, whichever is
 * first — a face that never arrives must not hold up the first frame, and a
 * frame drawn a moment early is drawn in a fallback face and then again.
 * Always resolves: with no document (in Node), no `document.fonts`, or a load
 * that fails, there is nothing to wait for. `capMs` is for tests.
 */
export function ensureFonts(m: Motion, capMs = 2000): Promise<void> {
  let fonts: FontFaceSet | undefined;
  try {
    fonts = typeof document === 'undefined' ? undefined : document.fonts;
  } catch {
    fonts = undefined;
  }
  if (!fonts || typeof fonts.load !== 'function') return Promise.resolve();
  const set = fonts;
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, capMs);
    const finish = () => {
      clearTimeout(timer);
      resolve();
    };
    let needs: Need[] = [];
    try {
      needs = needsOf(m);
    } catch {
      needs = [];
    }
    let left = needs.length;
    if (!left) return finish();
    const one = () => {
      left -= 1;
      if (left === 0) finish();
    };
    for (const n of needs) {
      try {
        set.load(n.font, SAMPLE[n.script]).then(one, one);
      } catch {
        one();
      }
    }
  });
}
