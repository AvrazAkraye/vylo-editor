import type { Lang } from './i18n';
import type { IconId, Layer, Paint, Shadow, Stroke, Voice } from './motiontypes';
import { E, META, type Kit, type Recipe } from './motionrecipe';
import { clamp, contrast, luminance } from './motionmath';
import { safeArea } from './motiondirection';
import type { PRO_A_IDS } from './motionids';

/**
 * Work package 07's templates: four lower thirds, a notification stack, a
 * hand-drawn circle, a chat conversation and a device frame. Every one is
 * built from the layer kinds the engine already has — text, shapes, icons,
 * backdrops — so nothing here changes how a frame is drawn.
 *
 * ## Four lower thirds, four habits
 *
 * They are not one design recoloured. The news bar is revealed by a block of
 * colour that sweeps across and pulls away, with the role on a strip of the
 * opposite tone; the soft pill springs in round, with an icon that draws
 * itself; the kicker puts a small tag over the corner of a plate and draws an
 * underline under a big name; the neon one traces its outline before the
 * plate fills and the glow flickers on. All four are pinned bottom-start, so
 * they sit on the correct side in Arabic and Kurdish with no special case.
 *
 * ## Words on glass
 *
 * As in `motionrecipes-overlays.ts`: an overlay cannot know what is under it,
 * so its words stand on a plate of the palette's own ground (`glassOf`), and
 * the palette guarantees its ink reads there. The hand-drawn circle is the one
 * exception by design — a marker note has no plate — and its words carry an
 * outline in the ground colour instead, the sticker trick, which reads over a
 * white wall and a night street alike.
 *
 * ## Words are measured before anything is drawn
 *
 * A bubble is as wide as its words, a card's height follows its lines, a
 * plate ends where its name ends. A recipe has no canvas, so it measures with
 * the advance widths `motionrecipes-overlays.ts` took in the app's own WebKit
 * (`LATIN`, `ARABIC_FORMS`; copied below, because that file keeps them to
 * itself — `docs/pro/requests/07.md` asks for them to be shared). Lines are
 * broken here and written into the text, so the renderer draws exactly those
 * lines; a line too long for its place is cut with an ellipsis (`clip`,
 * `wrap`); Arabic script is never cut inside a word, since a letter drawn
 * alone loses its joins, and `fit` shrinks such a word instead.
 *
 * ## Timing
 *
 * Each recipe is written at its natural length (`META[id].seconds`) with the
 * exit anchored to the end, so a longer graphic only holds longer, and a
 * shorter one is the same choreography pressed together (`clockOf`). The
 * numbers follow docs/pro/RESEARCH.md: entrances of 0.35 to 0.6 s, exits about
 * sixty per cent of them, staggers of a tenth of a second, the first move a
 * tenth to a third of a second in. The chat is the exception: its pace is the
 * reading pace of its messages, pressed together when they do not fit.
 */

// ── measuring words ───────────────────────────────────────────────────────

/**
 * Advance widths, in hundredths of an em, of printable ASCII (space to `~`),
 * measured at 100 px in WKWebView on macOS 26: `sans` is SF Pro (`system-ui`)
 * at 400 and 700, `bold` is Avenir Next at 500 and 800. The same table as
 * `motionrecipes-overlays.ts`; other weights are interpolated.
 */
const LATIN: Readonly<Record<'sans' | 'bold', readonly (readonly [number, readonly number[]])[]>> = {
  sans: [
    [400, [
      21, 27, 40, 60, 60, 81, 67, 25, 32, 32, 40, 60, 21, 43, 21, 28, 61, 44, 57, 59, 60, 58, 62, 55, 60, 62, 21, 21,
      60, 60, 60, 49, 87, 64, 60, 69, 68, 55, 53, 71, 70, 22, 50, 60, 52, 83, 70, 73, 58, 73, 60, 59, 58, 70, 63, 92,
      63, 61, 62, 32, 28, 32, 60, 53, 50, 50, 55, 50, 55, 51, 30, 55, 54, 21, 21, 49, 20, 80, 53, 53, 55, 55, 31, 47,
      30, 53, 48, 72, 47, 49, 47, 32, 22, 32, 60,
    ]],
    [700, [
      20, 32, 46, 64, 65, 89, 70, 27, 38, 38, 45, 65, 24, 44, 24, 30, 66, 48, 60, 63, 65, 63, 65, 57, 65, 65, 24, 24,
      65, 65, 65, 53, 89, 69, 64, 71, 70, 57, 55, 73, 73, 26, 56, 65, 54, 86, 71, 75, 62, 75, 64, 63, 60, 71, 68, 97,
      69, 67, 63, 38, 30, 38, 65, 58, 50, 55, 60, 54, 60, 55, 36, 59, 58, 24, 24, 54, 24, 86, 58, 57, 59, 59, 36, 51,
      36, 58, 53, 79, 53, 54, 51, 38, 24, 38, 65,
    ]],
  ],
  bold: [
    [500, [
      25, 33, 42, 57, 60, 87, 72, 26, 32, 32, 45, 67, 26, 32, 26, 38, 60, 60, 60, 60, 60, 60, 60, 60, 60, 60, 30, 30,
      67, 67, 67, 50, 80, 71, 64, 71, 76, 60, 57, 78, 73, 27, 50, 66, 51, 90, 77, 85, 60, 85, 61, 57, 57, 71, 64, 99,
      67, 62, 59, 32, 38, 32, 67, 50, 25, 54, 64, 49, 64, 57, 31, 63, 58, 26, 26, 53, 26, 89, 58, 61, 63, 63, 36, 44,
      33, 58, 50, 77, 51, 50, 46, 32, 22, 32, 67,
    ]],
    [800, [
      25, 45, 56, 62, 70, 94, 84, 33, 36, 36, 53, 67, 36, 34, 36, 46, 70, 70, 70, 70, 70, 70, 70, 70, 70, 70, 38, 38,
      67, 67, 67, 59, 80, 78, 69, 70, 79, 60, 58, 76, 80, 37, 57, 76, 55, 101, 79, 86, 68, 86, 71, 62, 60, 78, 74, 108,
      80, 74, 67, 36, 46, 36, 71, 50, 36, 59, 69, 53, 69, 63, 42, 70, 67, 34, 35, 67, 34, 98, 67, 66, 69, 69, 45, 51,
      42, 66, 64, 97, 68, 64, 56, 36, 27, 36, 67,
    ]],
  ],
};

/**
 * Noto Sans Arabic, which every voice sets Arabic script in: each letter's
 * isolated, initial, medial and final width in ems at 400, grouped by the
 * skeleton the letters share. Summed by the form each letter takes in its word
 * it lands within 2% of the engine; counting letters is 40% out.
 */
const ARABIC_FORMS: readonly (readonly [string, number, number, number, number])[] = [
  ['ء', 0.41, 0.41, 0.41, 0.41],
  ['آأإاٱ', 0.24, 0.24, 0.29, 0.29],
  ['بتثپ', 0.99, 0.28, 0.36, 1.09],
  ['ن', 0.69, 0.27, 0.34, 0.73],
  ['ئىيیێ', 0.76, 0.29, 0.36, 0.74],
  ['جحخ', 0.64, 0.59, 0.64, 0.65],
  ['چ', 0.66, 0.59, 0.64, 0.72],
  ['دذ', 0.48, 0.48, 0.53, 0.53],
  ['رزژڕ', 0.37, 0.37, 0.4, 0.4],
  ['سش', 1.21, 0.78, 0.85, 1.27],
  ['صض', 1.31, 0.9, 0.95, 1.35],
  ['طظ', 0.79, 0.68, 0.71, 0.83],
  ['عغ', 0.51, 0.5, 0.52, 0.53],
  ['فڤ', 0.98, 0.45, 0.5, 1.1],
  ['ق', 0.77, 0.45, 0.5, 0.81],
  ['كکگ', 0.88, 0.41, 0.51, 0.95],
  ['لڵ', 0.7, 0.26, 0.3, 0.73],
  ['م', 0.48, 0.53, 0.58, 0.56],
  ['هھ', 0.67, 0.57, 0.51, 0.55],
  ['وۆؤ', 0.45, 0.45, 0.47, 0.47],
  ['ةە', 0.41, 0.41, 0.49, 0.49],
];

const FORMS = new Map<string, readonly [number, number, number, number]>();
for (const [letters, iso, ini, med, fin] of ARABIC_FORMS) for (const ch of letters) FORMS.set(ch, [iso, ini, med, fin]);

/** Letters that never join the letter after them, and the hamza, which joins neither side. */
const NO_JOIN_AFTER = new Set(Array.from('ءآأإاٱؤوۆدذرزژڕةە'));

const ARABIC_CHAR = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;
const ARABIC_MARK = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
const ARABIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;

const ELLIPSIS = '\u2026';

/** Ems of one word of Arabic script at weight 400: each letter in the form its neighbours give it. */
function arabicEm(word: string): number {
  const chars = Array.from(word).filter((ch) => !ARABIC_MARK.test(ch));
  let em = 0;
  chars.forEach((ch, i) => {
    const forms = FORMS.get(ch);
    if (!forms) {
      em += ARABIC_DIGIT.test(ch) ? 0.55 : ch === '\u200C' || ch === '\u200D' ? 0 : 0.42;
      return;
    }
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i < chars.length - 1 ? chars[i + 1] : '';
    const joinsPrev = FORMS.has(prev) && !NO_JOIN_AFTER.has(prev) && ch !== 'ء';
    const joinsNext = FORMS.has(next) && !NO_JOIN_AFTER.has(ch) && next !== 'ء';
    em += forms[joinsPrev ? (joinsNext ? 2 : 3) : joinsNext ? 1 : 0];
  });
  return em;
}

/** How much wider SF Pro sets at a 1080p export's word sizes than at the 100 px it was measured at. */
const SF_AT_1080 = 1.02;

/** The em width of one character that is not Arabic script, in a voice and weight. */
function latinEm(ch: string, voice: Voice, weight: number): number {
  if (voice === 'mono') return 0.6;
  if (ch === ELLIPSIS) return 0.92;
  const base = ch.normalize('NFD').charAt(0);
  const code = base.charCodeAt(0);
  if (code >= 0x2e80) return 1;
  const rows = LATIN[voice === 'bold' || voice === 'condensed' ? 'bold' : 'sans'];
  const [w0, r0] = rows[0];
  const [w1, r1] = rows[1];
  const at = code - 32;
  const a = at >= 0 && at < r0.length ? r0[at] : 60;
  const b = at >= 0 && at < r1.length ? r1[at] : 64;
  const t = clamp((weight - w0) / (w1 - w0), -0.4, 1.7);
  const em = (a + (b - a) * t) / 100;
  // SF Rounded sets a hair wider than SF Pro.
  return voice === 'condensed' ? em * 0.8 : voice === 'bold' ? em : em * SF_AT_1080 * (voice === 'round' ? 1.03 : 1);
}

interface Measure {
  voice: Voice;
  weight: number;
  caps?: boolean;
  /** Letter spacing in ems, as the text layer's `track`. */
  track?: number;
}

/**
 * The width in u of one line set at `size` u, as the renderer will draw it:
 * Arabic script word by word in its joined forms (never tracked, never in
 * capitals), everything else a character at a time.
 */
function lineWidth(text: string, size: number, m: Measure): number {
  const arabic = ARABIC_CHAR.test(text);
  const caps = !!m.caps && !arabic;
  const track = arabic ? 0 : m.track ?? 0;
  const shown = caps ? text.toUpperCase() : text;
  const weightScale = 1 + 0.1 * clamp((m.weight - 400) / 300, 0, 1);
  let em = 0;
  const words = shown.split(/\s+/).filter(Boolean);
  words.forEach((word, i) => {
    if (i) em += (arabic ? 0.312 : latinEm(' ', m.voice, m.weight)) + track;
    let run = '';
    const flush = () => {
      if (run) em += arabicEm(run) * weightScale;
      run = '';
    };
    for (const ch of Array.from(word)) {
      if (ARABIC_CHAR.test(ch)) {
        run += ch;
        continue;
      }
      flush();
      em += latinEm(ch, m.voice, m.weight) + track;
    }
    flush();
    if (!arabic && track && word) em -= track;
  });
  return em * size;
}

/** The widest line of `text` (lines at its line breaks), in u. */
function widthOf(text: string, size: number, m: Measure): number {
  return Math.max(0, ...text.split('\n').map((l) => lineWidth(l, size, m)));
}

/** A plate's text width with headroom reaching into its end padding, so a word drawn a few per cent wider uses padding before `fit` shrinks it. */
const roomy = (inner: number, pad: number) => inner + Math.min(pad * 0.7, inner * 0.08);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Words, one space apart. */
const wordsOf = (text: string) => text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

/** Punctuation that should not be left hanging before an ellipsis. */
const TRAILING = /[\s,.;:!?\u060C\u061B\u061F\u2013\u2014-]+$/;

/**
 * `line` ended with an ellipsis and no wider than `room`: whole words dropped
 * from its end first; a Latin word that is alone and still too wide is cut by
 * letters; an Arabic one stays whole, with the ellipsis after it, and `fit`
 * shrinks it.
 */
function ellipsised(line: string, size: number, m: Measure, room: number): string {
  const words = wordsOf(line);
  for (let n = words.length; n >= 1; n--) {
    const s = `${words.slice(0, n).join(' ').replace(TRAILING, '')}${ELLIPSIS}`;
    if (lineWidth(s, size, m) <= room) return s;
  }
  const first = words[0] ?? '';
  if (!first || ARABIC_CHAR.test(first)) return `${first}${ELLIPSIS}`;
  const chars = Array.from(first);
  for (let n = chars.length - 1; n >= 1; n--) {
    const s = `${chars.slice(0, n).join('')}${ELLIPSIS}`;
    if (lineWidth(s, size, m) <= room) return s;
  }
  return `${chars[0] ?? ''}${ELLIPSIS}`;
}

/** One line of words no wider than `room`: as it is when it fits, else cut with an ellipsis. */
function clip(text: string, size: number, m: Measure, room: number): string {
  const flat = wordsOf(text).join(' ');
  return !flat || lineWidth(flat, size, m) <= room ? flat : ellipsised(flat, size, m, room);
}

/** Latin words wider than a whole line, cut into pieces that fit (what a message app does to a long link). Arabic script is never cut. */
function chopped(words: string[], size: number, m: Measure, room: number): string[] {
  const out: string[] = [];
  for (const w of words) {
    if (ARABIC_CHAR.test(w) || lineWidth(w, size, m) <= room) {
      out.push(w);
      continue;
    }
    let piece = '';
    for (const ch of Array.from(w)) {
      if (piece && lineWidth(piece + ch, size, m) > room) {
        out.push(piece);
        piece = '';
      }
      piece += ch;
    }
    if (piece) out.push(piece);
  }
  return out;
}

/** Words filled into lines greedily, each no wider than `room` unless one word alone is. */
function greedy(words: string[], size: number, m: Measure, room: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && lineWidth(next, size, m) > room) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Words broken into lines the way a message app breaks them — as many words
 * on a line as fit — at most `most` lines, the last cut with an ellipsis when
 * the words run on.
 */
function wrap(text: string, size: number, m: Measure, room: number, most: number): string[] {
  const lines = greedy(chopped(wordsOf(text), size, m, room), size, m, room);
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, Math.max(1, most));
  kept[kept.length - 1] = ellipsised(kept[kept.length - 1], size, m, room);
  return kept;
}

/** `words` broken into exactly `n` lines whose widest is as narrow as it can be: a headline set as a shape, not a full line and a straggler. */
function balancedInto(words: string[], n: number, w: (s: string) => number): string[] {
  const N = words.length;
  if (n <= 1 || N <= 1) return [words.join(' ')];
  const width = (i: number, j: number) => w(words.slice(i, j).join(' '));
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(N + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(N + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= n; k++) {
    for (let j = k; j <= N; j++) {
      for (let i = k - 1; i < j; i++) {
        if (best[k - 1][i] === Infinity) continue;
        const cost = Math.max(best[k - 1][i], width(i, j));
        if (cost < best[k][j] - 1e-9) {
          best[k][j] = cost;
          from[k][j] = i;
        }
      }
    }
  }
  const lines: string[] = [];
  let j = N;
  for (let k = n; k >= 1; k--) {
    const i = from[k][j];
    lines.unshift(words.slice(i, j).join(' '));
    j = i;
  }
  return lines;
}

interface Setting {
  /** The words, a line break wherever a line ends. */
  text: string;
  size: number;
  lines: number;
  /** u: the widest line, as estimated, at most the room. */
  width: number;
}

/**
 * A headline set for a block: the largest size from `size` down to `min` at
 * which it takes no more than `lines` lines of `room`, the lines made even.
 * At the smallest size it takes the lines it needs.
 */
function setBlock(raw: string, o: { size: number; min: number; room: number; lines: number; m: Measure }): Setting {
  const words0 = wordsOf(raw);
  if (!words0.length) return { text: '', size: o.size, lines: 0, width: 0 };
  let size = r2(o.size);
  for (let tries = 0; ; tries++) {
    // A word too wide for a line makes the size smaller first; only at the smallest is it cut.
    const last = size <= o.min || tries >= 40;
    const words = last ? chopped(words0, size, o.m, o.room) : words0;
    const w = (s: string) => lineWidth(s, size, o.m);
    const count = greedy(words, size, o.m, o.room).length;
    const lines = count <= 1 ? [words.join(' ')] : balancedInto(words, count, w);
    const widest = Math.max(...lines.map(w));
    if ((count <= o.lines && widest <= o.room * 1.001) || last) {
      return { text: lines.join('\n'), size, lines: lines.length, width: Math.min(o.room, widest) };
    }
    size = Math.max(o.min, r2(size * 0.94));
  }
}

/**
 * `text` in at most two lines no wider than `room`: as it is when it fits,
 * else broken where the longer line is shortest.
 */
function twoLines(text: string, size: number, m: Measure, room: number): string {
  const words = wordsOf(text);
  const one = words.join(' ');
  if (words.length < 2 || lineWidth(one, size, m) <= room) return one;
  return balancedInto(words, 2, (s) => lineWidth(s, size, m)).join('\n');
}

// ── shared looks ──────────────────────────────────────────────────────────

type Ink = 'fg' | 'bg';

/** A token as the colour the palette gives it; a colour as itself. */
function colourOf(c: Kit, x: string): string {
  const p = c.palette as unknown as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(p, x) ? p[x] : x;
}

/**
 * Which of the palette's ink and ground reads on `on` (every stop of a
 * gradient): the lighter when it clears `need` on all of it, else whichever
 * reads better. Bold labels are large text, so 3:1 is the line.
 */
function inkOn(c: Kit, on: Paint, need = 3): Ink {
  const colours = typeof on === 'string' ? [on] : on.stops.map((s) => s.color);
  const worst = (t: Ink) => Math.min(...colours.map((x) => contrast(colourOf(c, t), colourOf(c, x))));
  const light: Ink = luminance(c.palette.fg) >= luminance(c.palette.bg) ? 'fg' : 'bg';
  const dark: Ink = light === 'fg' ? 'bg' : 'fg';
  if (worst(light) >= need) return light;
  return worst(dark) > worst(light) ? dark : light;
}

interface Glass {
  fill: Paint;
  opacity: number;
  stroke: Stroke;
  shadow: Shadow;
}

/** The plate an overlay's words stand on: the palette's ground, a hairline edge, a soft shadow (see `motionrecipes-overlays.ts`). */
function glassOf(c: Kit): Glass {
  const dark = luminance(c.palette.bg) < 0.4;
  return {
    fill: 'bg',
    opacity: 1,
    stroke: { color: dark ? 'rgba(255,255,255,.16)' : 'rgba(0,0,0,.12)', width: 0.14, cap: 'round' },
    shadow: { color: 'rgba(0,0,0,.35)', blur: 3, x: 0, y: 1 },
  };
}

/** The soft light across the top of a glass plate. */
const SHEEN: Paint = {
  kind: 'linear', angle: 90,
  stops: [{ at: 0, color: 'rgba(255,255,255,.10)' }, { at: 0.55, color: 'rgba(255,255,255,0)' }],
};

/** The family's gradient: the second accent into the first. */
const ACCENTS = (angle: number): Paint => ({ kind: 'linear', angle, stops: [{ at: 0, color: 'accent2' }, { at: 1, color: 'accent' }] });

/** The frame's safe margin: content keeps this far in from every edge. */
const marginOf = (c: Kit) => (c.landscape ? 8 : 6);

/** How high a lower third sits: clear of a phone's captions and buttons in portrait, the broadcast line elsewhere. */
const bottomOf = (c: Kit) => (c.portrait ? 30 : c.landscape ? 12 : c.feed ? 14 : 11);

interface Clock {
  /** How much of its natural timing the recipe keeps: 1 at its own length or longer. */
  f: number;
  /** A moment of the entrance, written for the natural length. */
  at(s: number): number;
  /** A moment `s` natural seconds before the end. */
  until(s: number): number;
  /** A duration, never under the reader's shortest. */
  d(s: number): number;
}

/** The recipe's clock: the natural choreography, pressed together when the graphic is shorter than it was designed for. */
function clockOf(c: Kit): Clock {
  const f = clamp(c.seconds / META[c.recipe].seconds, 0.05, 1);
  return { f, at: (s) => r3(s * f), until: (s) => r3(c.seconds - s * f), d: (s) => r3(Math.max(0.05, s * f)) };
}

/**
 * One sweep of light across a shape, on for exactly one cycle of `shimmer` so
 * the band crosses once and is gone; another every `every` seconds of a long hold.
 */
function shines(c: Kit, box: Record<string, unknown>, o: { at: number; d: number; until: number; opacity: number; every?: number; most?: number; id?: string }): Layer[] {
  const d = Math.max(0.4, o.d);
  const id = o.id ?? 'shine';
  const out: Layer[] = [];
  for (let i = 0, at = o.at; i < (o.most ?? 3) && at + d <= o.until; i++, at += o.every ?? 5) {
    out.push(c.shape(i ? `${id}-${i + 1}` : id, {
      ...box, name: i ? `Shine ${i + 1}` : 'Shine', fill: '#ffffff00', opacity: o.opacity,
      start: r3(at), end: r3(at + d), loop: c.loop('shimmer', { d }),
    }));
  }
  return out;
}

/** A small stable hash of some text (FNV-1a), for a hand-drawn line that is the same every time the same words are drawn. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A seeded generator of numbers in [0, 1): the same seed, the same wobble. */
function wobble(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── news bar ──────────────────────────────────────────────────────────────

/**
 * News bar. An accent tab grows up at the bottom-start corner; a block of
 * accent sweeps out of it across the width of the name, holds for a beat and
 * pulls away toward the end, and the name plate is underneath, its name
 * masking up as the colour leaves. Below it a strip in the opposite tone —
 * the ink as a ground — wipes out with the role in small capitals. It leaves
 * in reverse: the role, the name, the strip and the plate wipe back into the
 * tab, which sinks on the last frame.
 *
 * The sweep is two layers: one grows from the start edge, and the one that
 * replaces it collapses toward the end (`grow` out toward the end), which a
 * single layer cannot do — its exit would retract to where it came from.
 */
function newsBar(c: Kit): Layer[] {
  const k = clockOf(c);
  const g = glassOf(c);
  const m = marginOf(c);
  const z = c.portrait ? { name: 5.8, role: 2.6 } : c.landscape ? { name: 5.4, role: 2.4 } : { name: 5.6, role: 2.5 };
  const bottom = bottomOf(c);
  const name = c.fields.name ?? '';
  const role = c.fields.role ?? '';
  const roleAr = ARABIC_CHAR.test(role);
  const nameM: Measure = { voice: 'bold', weight: 800 };
  // Capitals carry a small size in Latin; Arabic script has none, so its role is set larger and untracked.
  const roleSize = r3(roleAr ? z.role * 1.3 : z.role);
  const track = roleAr ? 0 : 0.12;
  const roleM: Measure = { voice: 'sans', weight: 700, caps: true, track };
  const tabW = 1;
  const plateX = m + tabW;
  const most = Math.min(c.landscape ? 100 : 88, c.u.w - m - plateX);
  const padS = z.name * 0.55;
  const padE = z.name * 0.75;
  const padV = z.name * 0.3;
  const nameLead = ARABIC_CHAR.test(name) ? 1.3 : 1.1;
  const H1 = r3(z.name * nameLead + 2 * padV);
  const rPadV = roleSize * 0.55;
  const rPadE = roleSize * 1.5;
  const roleLead = roleAr ? 1.35 : 1.2;
  const roleText = twoLines(role, roleSize, roleM, most - padS - rPadE);
  const roleLines = roleText ? roleText.split('\n').length : 0;
  const H2 = r3(roleLines ? roleLines * roleSize * roleLead + 2 * rPadV : 0);
  const seam = H2 ? 0.3 : 0;
  const W1 = r3(clamp(widthOf(name, z.name, nameM) + padS + padE, z.name * 4.5, most));
  const W2 = r3(roleLines ? clamp(widthOf(roleText, roleSize, roleM) + padS + rPadE, roleSize * 6, most) : 0);
  const plate = { pin: 'bs' as const, x: plateX, y: -r3(bottom + H2 + seam), w: W1, h: H1, radius: 0.3 };
  const strip = { pin: 'bs' as const, x: plateX, y: -bottom, w: W2, h: H2, radius: 0.3 };
  const tIn = k.at(0.15);
  const tSwept = r3(tIn + k.d(0.32));
  const tGone = r3(tSwept + k.d(0.4));
  const plateOut = c.leave('wipe', { dir: 'start', d: k.d(0.36) });

  const layers: Layer[] = [
    c.shape('tab', {
      name: 'Accent bar', pin: 'bs', x: m, y: -bottom, w: tabW, h: r3(H1 + seam + H2), radius: 0, fill: ACCENTS(90),
      in: c.enter('grow', { dir: 'up', d: k.d(0.36) }), out: c.leave('grow', { dir: 'up', d: k.d(0.3) }),
    }),
    c.shape('plate', {
      name: 'Name plate', ...plate, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow,
      start: tSwept, end: k.until(0.1), out: plateOut,
    }),
    c.shape('sheen', { name: 'Glass', ...plate, fill: SHEEN, start: tSwept, end: k.until(0.1), out: plateOut }),
  ];
  if (name) {
    layers.push(c.text('name', {
      name: 'Name', text: name, pin: 'bs', x: plateX + padS, y: -r3(bottom + H2 + seam + padV), size: z.name, weight: 800, voice: 'bold',
      color: 'fg', align: 'start', lead: nameLead, max: r3(roomy(W1 - padS - padE, padE)), fit: true, start: tSwept, end: k.until(0.26),
      in: c.enter('mask', { by: 'line', d: k.d(0.55) }), out: c.leave('mask', { by: 'line', d: k.d(0.3) }),
    }));
  }
  layers.push(
    c.shape('sweep', {
      name: 'Colour sweep', ...plate, fill: 'accent', start: tIn, end: tSwept, in: c.enter('grow', { dir: 'start', d: r3(tSwept - tIn) }),
    }),
    c.shape('sweep-out', {
      name: 'Colour sweep leaving', ...plate, fill: 'accent', start: tSwept, end: tGone,
      out: c.leave('grow', { dir: 'end', d: r3(tGone - tSwept), ease: 'inout' }),
    }),
  );
  if (roleLines) {
    layers.push(
      c.shape('strip', {
        name: 'Role strip', ...strip, fill: 'fg', shadow: g.shadow, start: k.at(0.6), end: k.until(0.16),
        in: c.enter('wipe', { dir: 'start', d: k.d(0.45) }), out: c.leave('wipe', { dir: 'start', d: k.d(0.3) }),
      }),
      c.text('role', {
        name: 'Role', text: roleText, pin: 'bs', x: plateX + padS, y: -r3(bottom + rPadV), size: roleSize, weight: 700, voice: 'sans',
        color: inkOn(c, 'fg'), caps: !roleAr, track, align: 'start', lead: roleLead, max: r3(roomy(W2 - padS - rPadE, rPadE)), fit: true,
        start: k.at(0.76), end: k.until(0.3), in: c.enter('rise', { amount: 0.25, d: k.d(0.45) }), out: c.leave('fade', { d: k.d(0.2) }),
      }),
    );
  }
  return layers;
}

// ── soft pill ─────────────────────────────────────────────────────────────

/**
 * Soft pill. A fully round plate springs up from three quarters of its size,
 * overshooting a hair; a round accent badge pops at its start and a person
 * icon draws itself on it; the name and then the role rise in beside it. At
 * the end the words go first and the pill shrinks away. Made for a light palette — a white pill over footage — and
 * as good on a dark one, since the pill is the palette's own ground.
 */
function softPill(c: Kit): Layer[] {
  const k = clockOf(c);
  const g = glassOf(c);
  const m = marginOf(c);
  const z = c.portrait ? { name: 4.4, role: 2.9 } : c.landscape ? { name: 3.9, role: 2.6 } : { name: 4.1, role: 2.75 };
  const bottom = bottomOf(c);
  const name = c.fields.name ?? '';
  const role = c.fields.role ?? '';
  const nameM: Measure = { voice: 'sans', weight: 700 };
  const roleM: Measure = { voice: 'sans', weight: 500 };
  const nameAr = ARABIC_CHAR.test(name);
  const roleAr = ARABIC_CHAR.test(role);
  const nameLead = nameAr ? 1.3 : 1.12;
  const roleLead = roleAr ? 1.35 : 1.2;
  const roleSize = r3(roleAr ? z.role * 1.1 : z.role);
  const nameH = name || !role ? z.name * nameLead : 0;
  const roleH = role ? roleSize * roleLead : 0;
  const gapV = nameH && roleH ? z.role * 0.16 : 0;
  const block = nameH + gapV + roleH;
  const H = r3(block + z.name * 1.1);
  const inset = H * 0.12;
  const D = r3(H - 2 * inset);
  const wordsAt = inset + D + H * 0.24;
  const padE = H * 0.5;
  const most = Math.min(c.landscape ? 90 : 88, c.u.w - 2 * m);
  const W = r3(clamp(wordsAt + Math.max(widthOf(name, z.name, nameM), widthOf(role, roleSize, roleM)) + padE, H * 2.8, most));
  const inner = W - wordsAt - padE;
  const cy = r3(c.u.h / 2 - bottom - H / 2);
  const pill = { pin: 'ms' as const, x: m, y: cy, w: W, h: H, radius: r3(H / 2) };
  const popIn = c.enter('pop', { ease: E.pop, amount: 0.55, d: k.d(0.6) });
  const popOut = c.leave('pop', { amount: 0.55, d: k.d(0.36) });
  // A solid accent, not the two-accent gradient: on the light palette it is made for, amber into blue reads as mud.
  const badge: Paint = 'accent';
  const glyph = r3(D * 0.5);

  const layers: Layer[] = [
    c.shape('pill', { name: 'Pill', ...pill, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow, in: popIn, out: popOut }),
    c.shape('sheen', { name: 'Glass', ...pill, fill: SHEEN, in: popIn, out: popOut }),
    c.shape('badge', {
      name: 'Badge', shape: 'ellipse', pin: 'ms', x: r3(m + inset), y: cy, w: D, h: D, fill: badge, start: k.at(0.16), end: k.until(0.06),
      in: c.enter('pop', { ease: E.pop, amount: 1.4, d: k.d(0.5) }), out: c.leave('pop', { amount: 1.4, d: k.d(0.28) }),
    }),
    c.icon('icon', {
      name: 'Icon', icon: 'user', pin: 'ms', x: r3(m + inset + (D - glyph) / 2), y: cy, size: glyph, weight: 2, color: inkOn(c, badge),
      start: k.at(0.32), end: k.until(0.06), in: c.enter('draw', { d: k.d(0.55), ease: 'cubic-out' }), out: c.leave('pop', { amount: 1.4, d: k.d(0.28) }),
    }),
  ];
  if (name) {
    layers.push(c.text('name', {
      name: 'Name', text: name, pin: 'ms', x: r3(m + wordsAt), y: r3(cy - block / 2 + nameH / 2), size: z.name, weight: 700, voice: 'sans',
      color: 'fg', align: 'start', lead: nameLead, max: r3(roomy(inner, padE)), fit: true, start: k.at(0.34), end: k.until(0.14),
      in: c.enter('rise', { amount: 0.4, d: k.d(0.5) }), out: c.leave('fade', { d: k.d(0.22) }),
    }));
  }
  if (role) {
    layers.push(c.text('role', {
      name: 'Role', text: role, pin: 'ms', x: r3(m + wordsAt), y: r3(cy + block / 2 - roleH / 2), size: roleSize, weight: 500, voice: 'sans',
      color: 'muted', align: 'start', lead: roleLead, max: r3(roomy(inner, padE)), fit: true, start: k.at(0.44), end: k.until(0.12),
      in: c.enter('rise', { amount: 0.4, d: k.d(0.5) }), out: c.leave('fade', { d: k.d(0.22) }),
    }));
  }
  return layers;
}

// ── kicker and name ───────────────────────────────────────────────────────

/**
 * Kicker and name. A plate wipes open from the start side; a small accent tag
 * pops onto its top corner with the kicker in capitals; the name masks up,
 * large and heavy; an accent underline draws itself under the name, exactly
 * as long as the name; and the role rises in under the line. It leaves the
 * way it came. The tag straddles the plate's top edge, so the plate leaves
 * room above the name for its lower half; with no kicker the plate is
 * shorter and has no tag.
 */
function kickerName(c: Kit): Layer[] {
  const k = clockOf(c);
  const g = glassOf(c);
  const m = marginOf(c);
  const z = c.portrait ? { name: 6.4, role: 3.1, kick: 2.3 } : c.landscape ? { name: 6, role: 2.9, kick: 2.1 } : { name: 6.2, role: 3, kick: 2.2 };
  const bottom = bottomOf(c);
  const name = c.fields.name ?? '';
  const role = c.fields.role ?? '';
  const kicker = c.fields.kicker ?? '';
  const kickAr = ARABIC_CHAR.test(kicker);
  const kickSize = r3(kickAr ? z.kick * 1.3 : z.kick);
  const kickTrack = kickAr ? 0 : 0.16;
  const nameM: Measure = { voice: 'bold', weight: 800 };
  const roleM: Measure = { voice: 'sans', weight: 500 };
  const kickM: Measure = { voice: 'sans', weight: 700, caps: true, track: kickTrack };
  const padS = z.name * 0.5;
  const padE = z.name * 0.7;
  const most = Math.min(c.landscape ? 100 : 88, c.u.w - 2 * m);
  const nameLead = ARABIC_CHAR.test(name) ? 1.28 : 1.06;
  const roleLead = ARABIC_CHAR.test(role) ? 1.4 : 1.25;
  const roleText = twoLines(role, z.role, roleM, most - padS - padE);
  const roleLines = roleText ? roleText.split('\n').length : 0;
  const nameH = z.name * nameLead;
  const lineH = 0.55;
  const gap1 = z.name * 0.16;
  const gap2 = roleLines ? z.role * 0.5 : 0;
  const roleH = roleLines * z.role * roleLead;
  const tagPadH = kickSize * 0.75;
  const tagH = r3(kicker ? kickSize * 1.25 + kickSize * 0.7 : 0);
  const padTop = kicker ? tagH / 2 + z.name * 0.3 : z.name * 0.42;
  const padBottom = z.name * 0.42;
  const H = r3(padTop + nameH + gap1 + lineH + gap2 + roleH + padBottom);
  const nameW = widthOf(name, z.name, nameM);
  const tagInner = Math.min(widthOf(kicker, kickSize, kickM), most - padS - 2 * tagPadH);
  const tagW = r3(kicker ? tagInner + 2 * tagPadH : 0);
  const W = r3(clamp(Math.max(nameW, widthOf(roleText, z.role, roleM), tagW) + padS + padE, z.name * 5, most));
  const inner = W - padS - padE;
  const plate = { pin: 'bs' as const, x: m, y: -bottom, w: W, h: H, radius: 0.5 };
  const plateIn = c.enter('wipe', { dir: 'start', d: k.d(0.55) });
  const plateOut = c.leave('wipe', { dir: 'start', d: k.d(0.36) });
  // Heights up from the frame's bottom edge, for layers pinned at their bottom.
  const roleBottom = bottom + padBottom;
  const lineBottom = roleBottom + roleH + gap2;
  const nameBottom = lineBottom + lineH + gap1;
  const tagBottom = bottom + H - tagH / 2;
  const tagIn = c.enter('pop', { ease: E.pop, amount: 1, d: k.d(0.45) });
  const tagOut = c.leave('pop', { amount: 1, d: k.d(0.28) });

  const layers: Layer[] = [
    c.shape('plate', {
      name: 'Plate', ...plate, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow, in: plateIn, out: plateOut,
    }),
    c.shape('sheen', { name: 'Glass', ...plate, fill: SHEEN, in: plateIn, out: plateOut }),
  ];
  if (name) {
    layers.push(c.text('name', {
      name: 'Name', text: name, pin: 'bs', x: m + padS, y: -r3(nameBottom), size: z.name, weight: 800, voice: 'bold', color: 'fg', align: 'start',
      lead: nameLead, max: r3(roomy(inner, padE)), fit: true, start: k.at(0.24), end: k.until(0.2),
      in: c.enter('mask', { by: 'line', d: k.d(0.6) }), out: c.leave('mask', { by: 'line', d: k.d(0.3) }),
    }));
  }
  layers.push(c.shape('underline', {
    name: 'Underline', pin: 'bs', x: m + padS, y: -r3(lineBottom), w: r3(clamp(nameW, z.name * 1.5, inner)), h: lineH, radius: 0, fill: 'accent',
    start: k.at(0.55), end: k.until(0.16), in: c.enter('grow', { dir: 'start', d: k.d(0.55), ease: 'cubic-out' }), out: c.leave('grow', { dir: 'start', d: k.d(0.26) }),
  }));
  if (roleLines) {
    layers.push(c.text('role', {
      name: 'Role', text: roleText, pin: 'bs', x: m + padS, y: -r3(roleBottom), size: z.role, weight: 500, voice: 'sans', color: 'muted',
      align: 'start', lead: roleLead, max: r3(roomy(inner, padE)), fit: true, start: k.at(0.72), end: k.until(0.24),
      in: c.enter('rise', { amount: 0.35, d: k.d(0.5) }), out: c.leave('fade', { d: k.d(0.22) }),
    }));
  }
  if (kicker) {
    const ink = inkOn(c, 'accent');
    layers.push(
      c.shape('tag', {
        name: 'Kicker tag', pin: 'bs', x: m + padS, y: -r3(tagBottom), w: tagW, h: tagH, radius: 0.3, fill: 'accent',
        start: k.at(0.4), end: k.until(0.12), in: tagIn, out: tagOut,
      }),
      c.text('kicker', {
        name: 'Small label', text: kicker, pin: 'bs', x: r3(m + padS + tagPadH), y: -r3(tagBottom + kickSize * 0.35), size: kickSize, weight: 700,
        voice: 'sans', color: ink, caps: !kickAr, track: kickTrack, align: 'center', lead: 1.25, max: r3(tagInner), fit: true,
        start: k.at(0.4), end: k.until(0.12), in: tagIn, out: tagOut,
      }),
    );
  }
  return layers;
}

// ── neon name ─────────────────────────────────────────────────────────────

/**
 * Neon name. An accent line traces the outline of a rounded plate, corner by
 * corner; as it closes, the dark plate fills in behind it and the glow around
 * the tube flickers once and comes on, humming faintly through the hold. The
 * name comes into focus with a glow of its own and the role follows in the
 * second accent. While it holds, a light runs along the tube. At the end the
 * words fade and the tube draws itself back out.
 *
 * One flicker, once: a strobe at three flashes a second or more is the rate
 * WCAG warns about, and this stays far under it.
 */
function neonName(c: Kit): Layer[] {
  const k = clockOf(c);
  const S = c.seconds;
  const m = marginOf(c);
  const z = c.portrait ? { name: 5, role: 2.5 } : c.landscape ? { name: 4.6, role: 2.3 } : { name: 4.8, role: 2.4 };
  const bottom = bottomOf(c);
  const name = c.fields.name ?? '';
  const role = c.fields.role ?? '';
  const roleAr = ARABIC_CHAR.test(role);
  const roleSize = r3(roleAr ? z.role * 1.3 : z.role);
  const track = roleAr ? 0 : 0.2;
  const nameM: Measure = { voice: 'sans', weight: 700 };
  const roleM: Measure = { voice: 'sans', weight: 600, caps: true, track };
  const nameLead = ARABIC_CHAR.test(name) ? 1.3 : 1.12;
  const roleLead = roleAr ? 1.35 : 1.2;
  const pad = z.name * 0.75;
  const padV = z.name * 0.55;
  const most = Math.min(c.landscape ? 96 : 88, c.u.w - 2 * m - 1);
  const nameH = name || !role ? z.name * nameLead : 0;
  const roleH = role ? roleSize * roleLead : 0;
  const gapV = nameH && roleH ? z.role * 0.35 : 0;
  const H = r3(nameH + gapV + roleH + 2 * padV);
  const W = r3(clamp(Math.max(widthOf(name, z.name, nameM), widthOf(role, roleSize, roleM)) + 2 * pad, z.name * 5, most));
  const inner = W - 2 * pad;
  const x0 = m + 0.5;
  const box = { pin: 'bs' as const, x: x0, y: -bottom, w: W, h: H, radius: r3(Math.min(1.8, H / 3)) };
  const lit = k.at(0.82);
  const tube: Stroke = { color: 'accent', width: 0.32, cap: 'round' };

  const layers: Layer[] = [
    c.shape('plate', {
      name: 'Plate', ...box, fill: 'bg', opacity: 0.94, start: k.at(0.5), end: S,
      in: c.enter('fade', { d: k.d(0.35) }), out: c.leave('fade', { d: k.d(0.4) }),
    }),
    c.shape('glow-flicker', {
      name: 'Glow flicker', ...box, fill: null, stroke: { color: 'accent', width: 1.3, cap: 'round' }, opacity: 0.3,
      shadow: { color: 'accent', blur: 2.4, x: 0, y: 0 }, start: lit, end: r3(Math.min(S - 0.2, lit + 0.06)),
    }),
    c.shape('glow', {
      name: 'Glow', ...box, fill: null, stroke: { color: 'accent', width: 1.3, cap: 'round' }, opacity: 0.34,
      shadow: { color: 'accent', blur: 2.4, x: 0, y: 0 }, start: r3(Math.min(S - 0.15, lit + 0.13)), end: S,
      in: c.enter('fade', { d: k.d(0.14) }), out: c.leave('fade', { d: k.d(0.4) }), loop: c.loop('breathe', { d: 2.6, amount: 0.5 }),
    }),
    c.shape('tube', {
      name: 'Neon tube', ...box, fill: null, stroke: tube, start: 0, end: S,
      in: c.enter('draw', { d: k.d(0.85), ease: 'inout' }), out: c.leave('draw', { d: k.d(0.45) }),
    }),
  ];
  // A light that runs along the tube while it holds: a stroke with nothing in it but the shimmer's band.
  const runFrom = k.at(2.2);
  const runTo = k.until(0.7);
  if (runTo - runFrom >= 0.8) {
    layers.push(c.shape('light', {
      name: 'Travelling light', ...box, fill: null, stroke: { color: '#ffffff00', width: 0.45, cap: 'round' }, start: runFrom, end: runTo,
      loop: c.loop('shimmer', { d: 2.4, amount: 1.4 }),
    }));
  }
  if (nameH && name) {
    layers.push(c.text('name', {
      name: 'Name', text: name, pin: 'bs', x: x0 + pad, y: -r3(bottom + padV + roleH + gapV), size: z.name, weight: 700, voice: 'sans',
      color: 'fg', align: 'start', lead: nameLead, max: r3(roomy(inner, pad)), fit: true, shadow: { color: 'accent', blur: 1.1, x: 0, y: 0 },
      start: k.at(0.78), end: k.until(0.3), in: c.enter('blur', { d: k.d(0.5) }), out: c.leave('fade', { d: k.d(0.25) }),
    }));
  }
  if (role) {
    layers.push(c.text('role', {
      name: 'Role', text: role, pin: 'bs', x: x0 + pad, y: -r3(bottom + padV), size: roleSize, weight: 600, voice: 'sans',
      color: 'accent2', caps: !roleAr, track, align: 'start', lead: roleLead, max: r3(roomy(inner, pad)), fit: true,
      start: k.at(0.95), end: k.until(0.28), in: c.enter('blur', { d: k.d(0.5) }), out: c.leave('fade', { d: k.d(0.25) }),
    }));
  }
  return layers;
}

// ── notifications ─────────────────────────────────────────────────────────

/** The characters of one list item a template is given (`motiontemplates.ts` cuts every line to it). */
const ITEM_CHARS = 80;

/**
 * A list item as it should be shown: one cut at the field's 80 characters
 * mid-word ends on a broken word ("…Remarkable S"), so such a line loses its
 * last, partial word and ends in an ellipsis instead.
 */
function itemText(line: string): string {
  const s = line.replace(/\s+/g, ' ').trim();
  if (Array.from(line.trim()).length < ITEM_CHARS || /[\s.!?\u061F\u06D4]$/.test(line) || !s.includes(' ')) return s;
  return `${s.slice(0, s.lastIndexOf(' ')).replace(TRAILING, '')}${ELLIPSIS}`;
}

/** One notification: its title and its line. */
export interface Note {
  title: string;
  body: string;
}

/**
 * The notifications a list field holds: one a line, `Title: line`, three at
 * most. The title is what comes before the first colon (Latin or full-width),
 * if that is a short label — not when the colon sits between two digits, as
 * in a time, and not when nothing comes after it. A line with no title is all
 * title.
 */
export function notesOf(raw: unknown): Note[] {
  if (typeof raw !== 'string') return [];
  const out: Note[] = [];
  for (const line of raw.split('\n')) {
    const s = itemText(line);
    if (!s) continue;
    const m = /^([^:\uFF1A]{1,40})[:\uFF1A](.*)$/.exec(s);
    const before = m ? m[1].trim() : '';
    const after = m ? m[2].trim() : '';
    if (m && before && after && !(/\d$/.test(before) && /^\d/.test(after))) out.push({ title: before, body: after });
    else out.push({ title: s.replace(/[:\uFF1A]+$/, '').trim() || s, body: '' });
    if (out.length === 3) break;
  }
  return out;
}

/**
 * A card's icon, from words in its title (then its line), in the four
 * languages: a message is a speech bubble, a delivery a truck, a reminder a
 * clock. Order matters — "order shipped" is a delivery before it is an order.
 * Anything else takes a quiet default by position.
 */
const ICON_WORDS: readonly (readonly [IconId, RegExp])[] = [
  ['truck', /\bship(ped|ping|s)?\b|\bdeliver|\bpackage|\bparcel|\bcourier|شحن|توصيل|طرد|گەیاندن|نێردرا|پاکەت|پاکێت|هنارتن/i],
  ['chat', /\bmessage|\bchat|\brepl(y|ied|ies)\b|\bdm\b|\btext(s|ed)?\b|رسال|محادث|نامە|پەیام/i],
  ['mail', /\be-?mail|\binbox|بريد|ئیمەیل/i],
  ['money', /\bpa(y|id|yment|yments)\b|\bmoney|\btransfer|\binvoice|\brefund|[$€£]|دفع|مبلغ|حوالة|پارە/i],
  ['cart', /\border|\bcart\b|\bbought\b|\bpurchase|\bsale\b|طلب|شراء|داواکاری|داخوازی|کڕین/i],
  ['calendar', /\bmeet|\bevent|\bcalendar|\btomorrow|\bappointment|\bbooking|اجتماع|موعد|حجز|کۆبوونەوە|ژڤان/i],
  ['clock', /\bremind|\bminutes?\b|\bhours?\b|\bsoon\b|\blater\b|\btimer\b|تذكير|دقيق|ساعة|بیرخستنەوە|بیرئینان|خولەک/i],
  ['heart', /\blike[sd]?\b|\blove[sd]?\b|إعجاب|أحب|لایک|خۆشەویست/i],
  ['users', /\bfollow|\bfriend|\bjoined\b|\binvite|متابع|انضم|دعوة|فۆڵۆ|هاوڕێ|هەڤاڵ/i],
  ['star', /\breview|\brating|\bstars?\b|تقييم|مراجعة|هەڵسەنگاندن/i],
  ['trophy', /\bw(in|ins|on)\b|\baward|\bwinner|فوز|جائزة|براوە|خەڵات/i],
  ['gift', /\bgift|\breward|هدية|مكافأة|دیاری/i],
  ['phone', /\bcall(s|ed|ing)?\b|\bmissed\b|مكالمة|اتصال|پەیوەندی|تەلەفۆن/i],
  ['check', /\bdone\b|\bcomplete|\bapproved\b|\bsuccess|\bconfirmed\b|\bverified\b|اكتمل|تمت الموافقة|تەواو|پەسەند/i],
];
const ICON_DEFAULT: readonly IconId[] = ['bolt', 'sparkle', 'star'];

function iconFor(note: Note, i: number): IconId {
  for (const text of [note.title, note.body]) {
    for (const [icon, words] of ICON_WORDS) if (words.test(text)) return icon;
  }
  return ICON_DEFAULT[i % ICON_DEFAULT.length];
}

/**
 * What the timeline calls each card's layers. Ordinals rather than numbers:
 * a numbered name needs its pattern in `motionui.ts` to be shown in Arabic or
 * Kurdish, and there are only ever three cards. Written out whole, so the
 * catalogue's check finds every one.
 */
const CARD_NAMES = [
  { card: 'First notification', glass: 'First notification glass', icon: 'First notification icon', title: 'First notification title', time: 'First notification time', text: 'First notification text' },
  { card: 'Second notification', glass: 'Second notification glass', icon: 'Second notification icon', title: 'Second notification title', time: 'Second notification time', text: 'Second notification text' },
  { card: 'Third notification', glass: 'Third notification glass', icon: 'Third notification icon', title: 'Third notification title', time: 'Third notification time', text: 'Third notification text' },
] as const;

/** The word a card shows for when it arrived, in the graphic's language. */
const NOW_WORD: Record<Lang, string> = { en: 'now', ar: 'الآن', ckb: 'ئێستا', kmr: 'نوکە' };

/**
 * Notification stack. Up to three cards arrive one after another, eight
 * tenths of a second apart: in a wide frame they slide in from the end side at
 * the top corner, as a desktop shows them; in the taller shapes they drop in
 * at the top centre, as a phone does. Each overshoots a little and settles.
 * A card is a glass plate with an accent icon badge, its title in bold, the
 * word for "now" at its end, and its line under it, two lines at most and cut
 * with an ellipsis. Everything on a card moves with it, so nothing slips. At
 * the end they leave the way they came, the first one first.
 */
function notifications(c: Kit): Layer[] {
  const k = clockOf(c);
  const g = glassOf(c);
  const given = notesOf(c.fields.items ?? '');
  const notes = given.length ? given : notesOf(NOTE_SAMPLES[c.lang] ?? NOTE_SAMPLES.en);
  const n = notes.length;
  const z = c.landscape ? { W: 66, top: 8, title: 3, body: 2.65, time: 2.2, icon: 7.2, pad: 2.1, gap: 1.8, r: 2.4 }
    : c.portrait ? { W: r3(c.u.w - 14), top: 14, title: 3.6, body: 3.15, time: 2.6, icon: 8.6, pad: 2.6, gap: 2.1, r: 3 }
      : { W: r3(c.u.w - 16), top: c.feed ? 10 : 8, title: 3.3, body: 2.9, time: 2.4, icon: 8, pad: 2.4, gap: 1.9, r: 2.8 };
  const cardX = r3(c.landscape ? c.u.w - marginOf(c) - z.W : (c.u.w - z.W) / 2);
  const titleM: Measure = { voice: 'sans', weight: 700 };
  const bodyM: Measure = { voice: 'sans', weight: 400 };
  const timeM: Measure = { voice: 'sans', weight: 500 };
  const now = NOW_WORD[c.lang] ?? NOW_WORD.en;
  // As wide as the widest language's word, so the card is laid out the same in all four and right to left mirrors it exactly.
  const timeW = r3(Math.max(...Object.values(NOW_WORD).map((w) => widthOf(w, z.time, timeM))) * 1.12 + 0.4);
  const textX = z.pad + z.icon + z.pad * 0.85;
  const textW = r3(z.W - textX - z.pad);
  const titleRoom = r3(textW - timeW - z.pad * 0.6);
  const badge: Paint = ACCENTS(45);
  const ink = inkOn(c, badge);
  const layers: Layer[] = [];
  let top = z.top;
  notes.forEach((note, i) => {
    const arabic = ARABIC_CHAR.test(note.title + note.body);
    const tLead = arabic ? 1.32 : 1.2;
    const bLead = arabic ? 1.45 : 1.3;
    const title = clip(note.title, z.title, titleM, titleRoom * 0.97);
    const body = note.body ? wrap(note.body, z.body, bodyM, textW * 0.97, 2) : [];
    const titleH = z.title * tLead;
    const gapV = body.length ? z.body * 0.22 : 0;
    const bodyH = body.length * z.body * bLead;
    const contentH = titleH + gapV + bodyH;
    const H = r3(Math.max(z.icon, contentH) + 2 * z.pad);
    const textTop = top + (H - contentH) / 2;
    const id = `card-${i + 1}`;
    const names = CARD_NAMES[Math.min(i, CARD_NAMES.length - 1)];
    const moving = {
      start: k.at(0.3 + 0.8 * i), end: k.until(0.08 * (n - 1 - i)),
      in: c.landscape ? c.enter('slide', { dir: 'end', amount: 1.1, d: k.d(0.6), ease: E.pop }) : c.enter('drop', { amount: 1, d: k.d(0.55), ease: E.pop }),
      out: c.landscape ? c.leave('slide', { dir: 'end', amount: 1.1, d: k.d(0.38) }) : c.leave('drop', { amount: 1, d: k.d(0.36) }),
    };
    const box = { pin: 'ts' as const, x: cardX, y: r3(top), w: z.W, h: H, radius: z.r };
    layers.push(
      c.shape(id, { name: names.card, ...box, ...moving, fill: g.fill, opacity: g.opacity, stroke: g.stroke, shadow: g.shadow }),
      c.shape(`${id}-glass`, { name: names.glass, ...box, ...moving, fill: SHEEN }),
      c.icon(`${id}-icon`, {
        name: names.icon, icon: iconFor(note, i), pin: 'ts', x: r3(cardX + z.pad), y: r3(top + (H - z.icon) / 2), size: r3(z.icon * 0.5),
        weight: 2, color: ink, badge: { shape: 'squircle', fill: badge, pad: r3(z.icon * 0.25) }, ...moving,
      }),
      c.text(`${id}-title`, {
        name: names.title, text: title, pin: 'ts', x: r3(cardX + textX), y: r3(textTop), size: z.title, weight: 700, voice: 'sans',
        color: 'fg', align: 'start', lead: tLead, max: titleRoom, fit: true, ...moving,
      }),
      c.text(`${id}-time`, {
        name: names.time, text: now, pin: 'ts', x: r3(cardX + z.W - z.pad - timeW), y: r3(textTop + (titleH - z.time * tLead) / 2),
        size: z.time, weight: 500, voice: 'sans', color: 'muted', align: 'end', lead: tLead, max: timeW, fit: true, ...moving,
      }),
    );
    if (body.length) {
      layers.push(c.text(`${id}-text`, {
        name: names.text, text: body.join('\n'), pin: 'ts', x: r3(cardX + textX), y: r3(textTop + titleH + gapV), size: z.body,
        weight: 400, voice: 'sans', color: 'fg', opacity: 0.8, align: 'start', lead: bLead, max: textW, fit: true, ...moving,
      }));
    }
    top += H + z.gap;
  });
  return layers;
}

// ── hand-drawn circle ─────────────────────────────────────────────────────

/** A point in u. */
interface Pt {
  x: number;
  y: number;
}

/** Numbers of a path in its 100 × 100 box, two decimals: finer than any frame can show. */
const P = (v: number) => String(r2(clamp(v, -50, 150)));

/**
 * A marker loop in a 100 × 100 box: a slightly uneven ellipse drawn
 * anticlockwise from the upper start, going round once and an eighth so its
 * end overshoots its start a little outside it — the way a hand circles a
 * word. The wobble is seeded, so the same words give the same loop. Right to
 * left mirrors it, so it starts on the other side and turns the other way.
 */
function loopPath(seed: number, rtl: boolean, turns: number, from: number): string {
  const rnd = wobble(seed);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const squash = 0.96 + rnd() * 0.06;
  const N = 30;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    const a = from - (turns * Math.PI * 2 * i) / N;
    const grow = 0.95 + (0.08 * i) / N;
    const r = 45 * grow * (1 + 0.03 * Math.sin(2 * a + p1) + 0.02 * Math.sin(3 * a + p2));
    const x = 50 + r * Math.cos(a);
    pts.push({ x: rtl ? 100 - x : x, y: 50 + r * Math.sin(a) * squash });
  }
  return smooth(pts);
}

/** Points joined by a smooth curve (Catmull-Rom as cubic Béziers), in path data. */
function smooth(pts: readonly Pt[]): string {
  let d = `M${P(pts[0].x)} ${P(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[i];
    const e = pts[i + 1];
    const f = pts[Math.min(pts.length - 1, i + 2)];
    d += `C${P(b.x + (e.x - a.x) / 6)} ${P(b.y + (e.y - a.y) / 6)} ${P(e.x - (f.x - b.x) / 6)} ${P(e.y - (f.y - b.y) / 6)} ${P(e.x)} ${P(e.y)}`;
  }
  return d;
}

/** A shape for points given in u from the frame's centre (logical x): its box, and the points in that box's 100 × 100, mirrored right to left. */
function boxFor(pts: readonly Pt[], pad: number, rtl: boolean) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const w = Math.max(1, Math.max(...xs) + pad - x0);
  const h = Math.max(1, Math.max(...ys) + pad - y0);
  const at = (p: Pt) => {
    const x = ((p.x - x0) / w) * 100;
    return { x: rtl ? 100 - x : x, y: ((p.y - y0) / h) * 100 };
  };
  return { box: { pin: 'mc' as const, x: r3(x0 + w / 2), y: r3(y0 + h / 2), w: r3(w), h: r3(h) }, at };
}

/**
 * Hand-drawn circle. A marker loop draws itself round a word (or round
 * whatever is under it, when the word is empty) and a second, fainter pass
 * follows it, as a hand goes round twice; an arrow swoops in from a note
 * below it and its head flicks on; the note writes itself out, tilted a
 * little as handwriting is, and a wavy underline draws under it. At the end
 * the note fades and the marks draw themselves back out.
 *
 * The marks are paths, and a path is not mirrored, so right to left gets each
 * one's mirror image; the tilt turns the other way too. The words carry an
 * outline in the ground's colour rather than a plate (see the header).
 */
function scribble(c: Kit): Layer[] {
  const k = clockOf(c);
  const S = c.seconds;
  const m = marginOf(c);
  const word = c.fields.word ?? '';
  const label = c.fields.label ?? '';
  const z = c.landscape ? { word: 9, label: 4.6, stroke: 0.8, at: { x: 22, y: -9 }, empty: { w: 38, h: 25 }, labelRoom: 52 }
    : c.portrait ? { word: 10, label: 5.2, stroke: 0.9, at: { x: 0, y: -18 }, empty: { w: 46, h: 30 }, labelRoom: 64 }
      : { word: 9, label: 4.8, stroke: 0.85, at: { x: 10, y: c.feed ? -14 : -10 }, empty: { w: 40, h: 27 }, labelRoom: 54 };
  const wordM: Measure = { voice: 'bold', weight: 800 };
  const labelM: Measure = { voice: 'round', weight: 700 };
  const halfW = c.u.w / 2 - m;
  const halfH = c.u.h / 2 - m;
  const set = setBlock(word, { size: z.word, min: z.word * 0.55, room: Math.min(70, 2 * halfW - 2 * z.word * 0.9 - 4), lines: 2, m: wordM });
  const wordLead = ARABIC_CHAR.test(word) ? 1.3 : 1.08;
  const wordH = set.lines * set.size * wordLead;
  const cw = r3(set.lines ? Math.max(set.width + set.size * 1.8, z.empty.w * 0.6) : z.empty.w);
  const ch = r3(set.lines ? Math.max(wordH + set.size * 1.5, z.empty.h * 0.6) : z.empty.h);
  const note = setBlock(label, { size: z.label, min: z.label * 0.7, room: z.labelRoom, lines: 2, m: labelM });
  const noteLead = ARABIC_CHAR.test(label) ? 1.35 : 1.15;
  const noteH = note.lines * note.size * noteLead;
  const noteW = Math.max(note.width, 4);
  // The target: kept inside the frame whatever the circle's size.
  const T: Pt = {
    // The second pass is a little wider than the first and set off from it.
    x: clamp(z.at.x, -halfW + cw * 0.515 + 1.5, halfW - cw * 0.515 - 1.5),
    y: clamp(z.at.y, -halfH + ch / 2 + 1, halfH - ch / 2 - 18 - noteH),
  };
  // The note sits below the circle, toward the start, its tilted box inside the margin.
  const tilt = c.rtl ? 4 : -4;
  const sin = Math.sin((4 * Math.PI) / 180);
  const cos = Math.cos((4 * Math.PI) / 180);
  const noteBox = noteW * 1.06;
  const reachX = (noteBox * cos + noteH * sin) / 2 + 0.6;
  const reachY = (noteBox * sin + noteH * cos) / 2 + 2.6;
  const L: Pt = {
    x: clamp(T.x - cw * 0.45 - noteW * 0.25, -halfW + reachX, halfW - reachX),
    y: Math.min(T.y + ch / 2 + 10 + noteH / 2, halfH - reachY),
  };
  // The arrow leaves the top of the note toward its end and lands just outside the circle's lower start.
  const a = (128 * Math.PI) / 180;
  const tip: Pt = { x: T.x + Math.cos(a) * (cw / 2) * 1.1, y: T.y + Math.sin(a) * (ch / 2) * 1.1 + 0.6 };
  const tail: Pt = { x: L.x + noteW * 0.22, y: L.y - noteH / 2 - 1.6 };
  const dx = tip.x - tail.x;
  const dy = tip.y - tail.y;
  const len = Math.max(4, Math.hypot(dx, dy));
  const out = { x: tip.x - T.x, y: tip.y - T.y };
  const outLen = Math.max(1e-6, Math.hypot(out.x, out.y));
  const u = { x: out.x / outLen, y: out.y / outLen };
  const c1: Pt = { x: tail.x + dx * 0.08, y: tail.y - len * 0.42 };
  const c2: Pt = { x: tip.x + u.x * len * 0.42, y: tip.y + u.y * len * 0.42 };
  const shaft = boxFor([tail, c1, c2, tip], 1, c.rtl);
  const shaftD = `M${P(shaft.at(tail).x)} ${P(shaft.at(tail).y)}C${P(shaft.at(c1).x)} ${P(shaft.at(c1).y)} ${P(shaft.at(c2).x)} ${P(shaft.at(c2).y)} ${P(shaft.at(tip).x)} ${P(shaft.at(tip).y)}`;
  // The head: two strokes back from the tip, either side of the way the shaft arrives.
  const dir = { x: -u.x, y: -u.y };
  const hl = z.label * 0.62;
  const turn = (v: Pt, deg: number) => {
    const r = (deg * Math.PI) / 180;
    return { x: v.x * Math.cos(r) - v.y * Math.sin(r), y: v.x * Math.sin(r) + v.y * Math.cos(r) };
  };
  const h1 = turn(dir, 30);
  const h2 = turn(dir, -30);
  const e1: Pt = { x: tip.x - h1.x * hl, y: tip.y - h1.y * hl };
  const e2: Pt = { x: tip.x - h2.x * hl, y: tip.y - h2.y * hl };
  const head = boxFor([e1, tip, e2], 0.8, c.rtl);
  const headD = `M${P(head.at(e1).x)} ${P(head.at(e1).y)}L${P(head.at(tip).x)} ${P(head.at(tip).y)}L${P(head.at(e2).x)} ${P(head.at(e2).y)}`;
  const seed = hashOf(`${word}|${label}`);
  const ink: Stroke = { color: 'accent', width: z.stroke, cap: 'round' };
  const outline = { color: 'bg', width: 0.32 };
  // The underline hangs under the note, turned with it about the note's centre.
  const drop = noteH / 2 + 1.5;
  const lineW = r3(Math.max(6, noteW * 0.92));
  const wave = c.rtl ? 'M100 55C80 15 70 15 50 50C30 85 20 85 0 40' : 'M0 55C20 15 30 15 50 50C70 85 80 85 100 40';

  const layers: Layer[] = [];
  if (set.lines) {
    layers.push(c.text('word', {
      name: 'Circled word', text: set.text, pin: 'mc', x: r3(T.x), y: r3(T.y), size: set.size, weight: 800, voice: 'bold', color: 'fg',
      align: 'center', lead: wordLead, max: r3(Math.max(set.width, 4) * 1.06), fit: true, outline,
      start: k.at(0.05), end: S, in: c.enter('pop', { ease: E.pop, amount: 0.8, d: k.d(0.45) }), out: c.leave('pop', { amount: 0.8, d: k.d(0.3) }),
    }));
  }
  layers.push(
    c.shape('circle', {
      name: 'Circle', shape: 'path', d: loopPath(seed, c.rtl, 1.13, (-125 * Math.PI) / 180), pin: 'mc', x: r3(T.x), y: r3(T.y), w: cw, h: ch,
      fill: null, stroke: ink, start: k.at(0.4), end: S,
      in: c.enter('draw', { d: k.d(0.65), ease: 'inout' }), out: c.leave('draw', { d: k.d(0.4) }),
    }),
    c.shape('circle-2', {
      name: 'Second stroke', shape: 'path', d: loopPath(seed + 7, c.rtl, 1.02, (-110 * Math.PI) / 180), pin: 'mc', x: r3(T.x + 0.4), y: r3(T.y + 0.3),
      w: r3(cw * 1.03), h: r3(ch * 0.97), fill: null, stroke: { ...ink, width: r3(z.stroke * 0.55) }, opacity: 0.55, start: k.at(0.74), end: k.until(0.04),
      in: c.enter('draw', { d: k.d(0.5), ease: 'inout' }), out: c.leave('draw', { d: k.d(0.3) }),
    }),
    c.shape('arrow', {
      name: 'Arrow', shape: 'path', d: shaftD, ...shaft.box, fill: null, stroke: { ...ink, width: r3(z.stroke * 0.85) },
      start: k.at(1.02), end: k.until(0.12), in: c.enter('draw', { d: k.d(0.42), ease: 'cubic-out' }), out: c.leave('draw', { d: k.d(0.28) }),
    }),
    c.shape('arrowhead', {
      name: 'Arrowhead', shape: 'path', d: headD, ...head.box, fill: null, stroke: { ...ink, width: r3(z.stroke * 0.85) },
      start: k.at(1.4), end: k.until(0.1), in: c.enter('draw', { d: k.d(0.16), ease: 'out' }), out: c.leave('draw', { d: k.d(0.14) }),
    }),
  );
  if (note.lines) {
    layers.push(
      c.text('label', {
        name: 'Note', text: note.text, pin: 'mc', x: r3(L.x), y: r3(L.y), rot: tilt, size: note.size, weight: 700, voice: 'round', color: 'fg',
        align: 'center', lead: noteLead, max: r3(noteW * 1.06), fit: true, outline,
        start: k.at(1.22), end: k.until(0.2), in: c.enter('type', { d: k.d(0.55), ease: 'linear' }), out: c.leave('fade', { d: k.d(0.25) }),
      }),
      c.shape('underline', {
        name: 'Underline', shape: 'path', d: wave, pin: 'mc', x: r3(L.x + drop * sin), y: r3(L.y + drop * Math.cos((4 * Math.PI) / 180)), rot: tilt,
        w: lineW, h: 2, fill: null, stroke: { ...ink, width: r3(z.stroke * 0.7) }, start: k.at(1.78), end: k.until(0.18),
        in: c.enter('draw', { d: k.d(0.35), ease: 'cubic-out' }), out: c.leave('draw', { d: k.d(0.22) }),
      }),
    );
  }
  return layers;
}

// ── chat conversation ─────────────────────────────────────────────────────

/** One message: whose side it is on, and its words. */
export interface ChatLine {
  me: boolean;
  text: string;
}

/** The words a person writes for their own side, in the four languages. */
const ME_WORDS: ReadonlySet<string> = new Set(['me', 'i', 'myself', 'أنا', 'انا', 'من', 'ئەز', 'ez', 'min']);

/**
 * The messages a list field holds, one a line, six at most. `Me: …` (or the
 * word for "me" in Arabic or Kurdish) is the person's own side; any other
 * short label before a colon — `Them:`, a name — is the other side. A line
 * with no label takes the other side from the line before it, so a pasted
 * conversation alternates. A colon between digits (a time) is not a label.
 */
export function messagesOf(raw: unknown): ChatLine[] {
  if (typeof raw !== 'string') return [];
  const out: ChatLine[] = [];
  for (const line of raw.split('\n')) {
    const s = itemText(line);
    if (!s) continue;
    const m = /^([^:\uFF1A]{1,24})[:\uFF1A](.*)$/.exec(s);
    const who = m ? m[1].trim() : '';
    const said = m ? m[2].trim() : '';
    const labelled = !!m && !!who && who.split(' ').length <= 3 && !/\d/.test(who);
    if (labelled && !said) continue;
    const me = labelled ? ME_WORDS.has(who.toLowerCase()) : out.length ? !out[out.length - 1].me : false;
    out.push({ me, text: labelled ? said : s });
    if (out.length === 6) break;
  }
  return out;
}

/**
 * How fast words are read, as the app's quality check reckons it (`CHECK` in
 * motioncheck.ts, which a template cannot import: the check imports the
 * editor, which builds templates): 2.5 words a second, 2.2 in Arabic script; a
 * text's load is the smaller of its words and its letters over five, since
 * Kurdish writes particles as words of their own and joins others long; and a
 * glance — three words and sixteen letters at most — is taken in at once. The
 * template test holds these equal to the check's.
 */
export const READING = { wps: 2.5, wpsArabic: 2.2, letters: 5, glanceWords: 3, glanceLetters: 16 } as const;

/** Seconds a message's words take to read, by `READING`: none for a glance. */
function readNeed(text: string): number {
  const s = text.trim();
  const letters = (s.match(/[\p{L}\p{N}]/gu) ?? []).length;
  const words = letters ? s.split(/\s+/).length : 0;
  if (words <= READING.glanceWords && letters <= READING.glanceLetters) return 0;
  return Math.min(words, letters / READING.letters) / (ARABIC_CHAR.test(s) ? READING.wpsArabic : READING.wps);
}

/**
 * A message bubble in a 100 × 100 box stretched to `w` × `h` u: round corners
 * but the sender's lower one, which is nearly square — the bubble's tail.
 * The radii are written per axis, so they are round again once stretched.
 */
function bubblePath(w: number, h: number, r: number, tail: 'left' | 'right'): string {
  const R = Math.min(r, h / 2, w / 2);
  const t = Math.min(R, r * 0.22);
  const tl = R;
  const tr = R;
  const br = tail === 'right' ? t : R;
  const bl = tail === 'left' ? t : R;
  const X = (v: number) => P((v / w) * 100);
  const Y = (v: number) => P((v / h) * 100);
  return `M${X(tl)} 0L${X(w - tr)} 0A${X(tr)} ${Y(tr)} 0 0 1 100 ${Y(tr)}L100 ${Y(h - br)}A${X(br)} ${Y(br)} 0 0 1 ${X(w - br)} 100`
    + `L${X(bl)} 100A${X(bl)} ${Y(bl)} 0 0 1 0 ${Y(h - bl)}L0 ${Y(tl)}A${X(tl)} ${Y(tl)} 0 0 1 ${X(tl)} 0Z`;
}

interface Bubble {
  lines: string[];
  w: number;
  h: number;
  gap: number;
  lead: number;
}

/**
 * Chat conversation. A header with the other person's initial in a round
 * badge of the second accent and their name, a hairline under it; then the
 * messages arrive in turn at a reading pace: before each of theirs a bubble
 * of three bobbing dots says they are typing, and the message replaces it;
 * the person's own pop in from their side. Their bubbles are a tint of the
 * ink on the start side, the person's are the accent on the end side, each
 * with its sender's lower corner square. At the end the whole conversation
 * lifts away.
 *
 * Bubbles are as wide as their words; a message wraps as a phone wraps it and
 * a fifth line is cut with an ellipsis. Everything is sized so the whole
 * conversation fits the frame: smaller type first, then fewer lines a bubble.
 */
function chat(c: Kit): Layer[] {
  const S = c.seconds;
  const given = messagesOf(c.fields.items ?? '');
  const msgs = given.length ? given : messagesOf(CHAT_SAMPLES[c.lang] ?? CHAT_SAMPLES.en);
  const contact = wordsOf(c.fields.name ?? '').join(' ');
  // In portrait the conversation keeps out of the bottom 30.3u (`safeArea`), where a phone app lays its own buttons and
  // caption over the video: six long messages used to reach 18u from the bottom.
  const z = c.landscape ? { col: 104, top: 9, bottom: 9, size: 4.1 }
    : c.portrait ? { col: 88, top: 16, bottom: safeArea(c.format).bottom, size: 4.9 }
      : { col: 88, top: c.feed ? 9 : 7, bottom: c.feed ? 9 : 7, size: c.feed ? 4.3 : 3.9 };
  const colX = r3((c.u.w - z.col) / 2);
  const avail = c.u.h - z.top - z.bottom;
  const textM: Measure = { voice: 'sans', weight: 500 };
  const layout = (s: number, most: number) => {
    const size = r3(z.size * s);
    const padH = size * 0.85;
    const padV = size * 0.5;
    const room = z.col * 0.72 - 2 * padH;
    const head = contact ? size * 2.1 + size * 1.7 : 0;
    let total = head;
    const items: Bubble[] = msgs.map((msg, i) => {
      const lead = ARABIC_CHAR.test(msg.text) ? 1.42 : 1.28;
      const lines = wrap(msg.text, size, textM, room, most);
      const textW = Math.max(0, ...lines.map((l) => lineWidth(l, size, textM)));
      // The text gets 6% more room than the estimate says it needs: the estimate and the face the app draws in can differ by a few
      // per cent, and a line that is a hair too long for its box wraps its last word onto a second line, below the bubble.
      const w = r3(Math.max(textW * 1.06 + 2 * padH, size * 2.6));
      const h = r3(Math.max(1, lines.length) * size * lead + 2 * padV);
      const gap = i === 0 ? 0 : msg.me === msgs[i - 1].me ? size * 0.4 : size * 1;
      total += gap + h;
      return { lines, w, h, gap, lead };
    });
    return { size, padH, padV, head, items, total };
  };
  // Smaller first, down to a size still read on a phone; then fewer lines a bubble.
  const tries: readonly (readonly [number, number])[] = [[1, 4], [0.92, 4], [0.85, 4], [0.85, 3], [0.78, 3], [0.78, 2], [0.72, 2], [0.72, 1], [0.6, 1]];
  let plan = layout(1, 4);
  for (const [s, most] of tries) {
    plan = layout(s, most);
    if (plan.total <= avail) break;
  }
  const { size, padH, padV } = plan;
  const blockTop = z.top + Math.max(0, (avail - plan.total) / 2);

  // When each message arrives, at the pace it is read; pressed together when they do not fit before the exit.
  const TYPING = 0.8;
  const POP = 0.42;
  const EXIT = Math.min(0.45, S * 0.2);
  let t = contact ? 0.55 : 0.2;
  const natural = msgs.map((msg) => {
    const arrive = t + (msg.me ? 0 : TYPING);
    t = arrive + clamp(0.45 + 0.028 * Array.from(msg.text).length, 0.7, 1.3);
    return arrive;
  });
  const lastIn = natural[natural.length - 1] + POP;
  // A message stays to the end, so it can be read from half-way through its pop to half-way through the exit, as the
  // app's check reads it; the last ones have the least of that. "All in 0.8 s before the exit" left a long one near the
  // end short (a Sorani reply 0.2 s, a Badini one 0.3 s, at 8 s), so the conversation is also pressed together until
  // every message has the time its words take (`readNeed`; the pop taken at its longest, so this errs toward time) —
  // but only down to 0.35 of its pace, below which the typing dots go and the messages stop arriving in turn. A
  // conversation too long for its graphic is pressed as it was, and the check's tip then says so.
  const fits = (S - EXIT - 0.8) / lastIn;
  const readBy = S - EXIT / 2 - POP / 2 - 0.05;
  const reads = Math.min(...natural.map((when, i) => (readBy - readNeed(msgs[i].text)) / Math.max(1e-3, when)));
  const kc = clamp(Math.min(fits, Math.max(reads, Math.min(fits, 0.35))), 0.02, 1);
  const T = (x: number) => r3(x * kc);
  const D = (x: number) => r3(Math.max(0.05, x * kc));
  const typing = kc >= 0.35;
  const leave = c.leave('drop', { amount: 0.5, d: r3(EXIT) });

  const layers: Layer[] = [
    c.backdrop('backdrop', {
      name: 'Background', style: 'aurora', colors: ['accent', 'accent2'], speed: 0.6, density: 0.35, opacity: 0.35,
      in: c.enter('fade', { d: D(0.8), ease: E.soft }),
    }),
  ];
  if (contact) {
    const av = r3(size * 2.1);
    const initial = Array.from(contact)[0] ?? '';
    // The second accent, solid: the person's own bubbles are the first, so the colour says whose side is whose.
    const ring: Paint = 'accent2';
    layers.push(
      c.shape('avatar', {
        name: 'Avatar', shape: 'ellipse', pin: 'ts', x: colX, y: r3(blockTop), w: av, h: av, fill: ring, end: S,
        in: c.enter('pop', { ease: E.pop, d: D(0.45) }), out: leave,
      }),
      c.text('initial', {
        name: 'Avatar letter', text: ARABIC_CHAR.test(initial) ? initial : initial.toUpperCase(), pin: 'ts', x: colX, y: r3(blockTop + av * 0.2),
        size: r3(av * 0.5), weight: 700, voice: 'sans', color: inkOn(c, ring), align: 'center', lead: 1.2, max: av, fit: true, end: S,
        in: c.enter('pop', { ease: E.pop, d: D(0.45) }), out: leave,
      }),
      c.text('contact', {
        name: 'Contact name', text: contact, pin: 'ts', x: r3(colX + av + size * 0.7), y: r3(blockTop + av / 2 - size * 1.1 * 0.62), size: r3(size * 1.1),
        weight: 700, voice: 'sans', color: 'fg', align: 'start', lead: 1.24, max: r3(z.col - av - size * 0.7), fit: true, start: T(0.12), end: S,
        in: c.enter('rise', { amount: 0.3, d: D(0.5) }), out: leave,
      }),
      c.shape('divider', {
        name: 'Divider', pin: 'ts', x: colX, y: r3(blockTop + av + size * 0.85), w: z.col, h: 0.16, radius: 0, fill: 'fg', opacity: 0.16,
        start: T(0.2), end: S, in: c.enter('grow', { dir: 'start', d: D(0.6), ease: 'cubic-out' }), out: leave,
      }),
    );
  }
  const theirs = 'fg';
  const mine = 'accent';
  const mineInk = inkOn(c, mine);
  const dot = r3(size * 0.38);
  const dotGap = r3(size * 0.34);
  let y = blockTop + plan.head;
  msgs.forEach((msg, i) => {
    const b = plan.items[i];
    y += b.gap;
    const x = r3(msg.me ? colX + z.col - b.w : colX);
    const at = T(natural[i]);
    const n = i + 1;
    const tail = msg.me !== c.rtl ? 'right' : 'left';
    if (!msg.me && typing) {
      const tw = r3(2 * padH + 3 * dot + 2 * dotGap);
      const th = r3(size * 1.28 + 2 * padV);
      const t0 = T(natural[i] - TYPING);
      layers.push(c.shape(`typing-${n}`, {
        name: 'Typing bubble', shape: 'path', d: bubblePath(tw, th, size * 0.95, tail), pin: 'ts', x, y: r3(y), w: tw, h: th, fill: theirs, opacity: 0.12,
        start: t0, end: at, in: c.enter('pop', { ease: E.pop, amount: 0.6, d: D(0.3) }),
      }));
      for (let j = 0; j < 3; j++) {
        layers.push(c.shape(`typing-${n}-dot-${j + 1}`, {
          name: 'Typing dot', shape: 'ellipse', pin: 'ts', x: r3(x + padH + j * (dot + dotGap)), y: r3(y + th / 2 - dot / 2), w: dot, h: dot,
          fill: 'fg', opacity: 0.6, start: r3(t0 + D(0.1 + 0.1 * j)), end: at, in: c.enter('pop', { ease: E.pop, d: D(0.2) }),
          loop: c.loop('float', { d: 0.9, amount: 0.3 }),
        }));
      }
    }
    const pop = c.enter('pop', { ease: E.pop, amount: 0.5, d: D(POP) });
    layers.push(
      c.shape(`message-${n}`, {
        name: msg.me ? 'Your message' : 'Their message', shape: 'path', d: bubblePath(b.w, b.h, size * 0.95, tail), pin: 'ts', x, y: r3(y), w: b.w, h: b.h,
        fill: msg.me ? mine : theirs, opacity: msg.me ? 1 : 0.12, start: at, end: S, in: pop, out: leave,
      }),
      c.text(`message-${n}-text`, {
        name: msg.me ? 'Your message text' : 'Their message text', text: b.lines.join('\n'), pin: 'ts', x: r3(x + padH), y: r3(y + padV), size, weight: 500, voice: 'sans',
        color: msg.me ? mineInk : 'fg', align: 'start', lead: b.lead, max: r3(roomy(b.w - 2 * padH, padH)), fit: true, start: at, end: S, in: pop, out: leave,
      }),
    );
    y += b.h;
  });
  return layers;
}

// ── device frame ──────────────────────────────────────────────────────────

/**
 * Device frame. A soft glow blooms, and a device rises into it and settles —
 * a phone in the taller shapes, a browser window in a wide frame — drawn with
 * shapes: a body with a rim, a dark screen, and a phone's island and buttons
 * or a window's three dots and address bar. Once it has landed, the screen
 * lights up from the bottom in the accent gradient and the word on it pops
 * in, a gleam crossing the glass as it lights. The headline masks in line by line
 * beside it (above it in portrait), and the supporting line rises after.
 * At the end the words go and the device sinks away.
 *
 * The screen is left clean on purpose: a template cannot carry a picture, and
 * a person who places a screenshot over it gets a device showing their app.
 * Every part of the device moves with one entrance and one exit, so nothing
 * slips as it rises.
 */
function device(c: Kit): Layer[] {
  const k = clockOf(c);
  const S = c.seconds;
  const m = marginOf(c);
  const phone = !c.landscape;
  const W = c.landscape ? 96 : c.portrait ? 50 : c.feed ? 42 : 38;
  const H = c.landscape ? 62 : r3(W * 2.05);
  const cx = r3(c.landscape ? c.u.w / 2 - 8 - W / 2 : c.portrait ? 0 : c.u.w / 2 - m - 1 - W / 2);
  const cy = r3(c.portrait ? c.u.h / 2 - 14 - H / 2 : c.landscape ? 1 : 0);
  const beside = !c.portrait;
  const titleM: Measure = { voice: 'bold', weight: 800 };
  const subM: Measure = { voice: 'sans', weight: 500 };
  // Inside the title-safe side the model is told about (`safeArea`: 8.9u on the wide frame), with half a u for a capital
  // that overhangs its own start ("Your" set at 9u reached 8.8u in WebKit).
  const textStart = -c.u.w / 2 + Math.max(m + 1, safeArea(c.format).side + 0.5);
  const room = beside ? r3(cx - W / 2 - 6 - textStart) : r3(c.u.w - 2 * m - 4);
  const zt = c.landscape ? { size: 8.2, sub: 3.6, lines: 3 } : c.portrait ? { size: 8.4, sub: 3.7, lines: 3 } : { size: c.feed ? 5.8 : 6, sub: 3, lines: 4 };
  const title = setBlock(c.fields.title ?? '', { size: zt.size, min: zt.size * 0.6, room, lines: zt.lines, m: titleM });
  const sub = setBlock(c.fields.subtitle ?? '', { size: zt.sub, min: zt.sub * 0.8, room, lines: 3, m: subM });
  const titleLead = ARABIC_CHAR.test(title.text) ? 1.28 : 1.05;
  const subLead = ARABIC_CHAR.test(sub.text) ? 1.5 : 1.35;
  const titleH = title.lines * title.size * titleLead;
  const subH = sub.lines * sub.size * subLead;
  const gap = title.lines && sub.lines ? zt.sub * 1.1 : 0;
  const block = titleH + gap + subH;
  const blockMid = beside ? cy : r3(-c.u.h / 2 + 14 + (cy - H / 2 - 6 - (-c.u.h / 2 + 14)) / 2);
  const titleY = r3(blockMid - block / 2 + titleH / 2);
  const subY = r3(blockMid + block / 2 - subH / 2);
  const align = beside ? 'start' as const : 'center' as const;
  const textX = beside ? r3(textStart + room / 2) : 0;

  const dark = luminance(c.palette.bg) < 0.4;
  const rise = { in: c.enter('rise', { amount: 2.4, d: k.d(0.9), ease: E.enter }), out: c.leave('rise', { amount: 2.4, d: k.d(0.5) }) };
  const body = { pin: 'mc' as const, x: cx, y: cy, w: W, h: H };
  const radius = phone ? r3(W * 0.17) : 2.2;
  const bezel = phone ? r3(W * 0.04) : 1.2;
  const bar = phone ? 0 : 6.6;
  const screen = {
    pin: 'mc' as const, x: cx, y: r3(cy + bar / 2), w: r3(W - 2 * bezel), h: r3(H - 2 * bezel - bar), radius: phone ? r3(radius - bezel) : 1.2,
  };
  const glass: Paint = { kind: 'linear', angle: c.rtl ? 60 : 120, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] };
  const word = c.fields.screen ?? '';
  const wordM: Measure = { voice: 'bold', weight: 800 };
  const wordSize = r3(Math.min(screen.w * (phone ? 0.2 : 0.13), screen.h * 0.3));
  const wordFit = clip(word, wordSize, wordM, screen.w * 0.8 / 0.7);
  const deviceIn = k.at(0.1);
  const lit = k.at(0.8);

  const layers: Layer[] = [
    c.shape('glow', {
      name: 'Glow', shape: 'ellipse', pin: 'mc', x: cx, y: cy, w: r3(W * (phone ? 2.4 : 1.6)), h: r3(H * (phone ? 1.3 : 1.6)), blend: 'screen', opacity: 0.55,
      fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'accent' }, { at: 0.68, color: '#00000000' }] },
      in: c.enter('fade', { d: k.d(1) }), out: c.leave('fade', { d: k.d(0.5) }),
    }),
  ];
  if (phone) {
    // Buttons on the rim: power on the end side, volume on the start side.
    layers.push(
      c.shape('button-power', {
        name: 'Side button', pin: 'mc', x: r3(cx + W / 2 + 0.15), y: r3(cy - H * 0.22), w: 0.7, h: r3(H * 0.1), radius: 0.3, fill: 'muted', start: deviceIn, end: S, ...rise,
      }),
      c.shape('button-volume', {
        name: 'Side button', pin: 'mc', x: r3(cx - W / 2 - 0.15), y: r3(cy - H * 0.26), w: 0.7, h: r3(H * 0.07), radius: 0.3, fill: 'muted', start: deviceIn, end: S, ...rise,
      }),
    );
  }
  layers.push(
    c.shape('body', {
      name: phone ? 'Phone' : 'Browser window', ...body, radius, fill: 'bg', stroke: { color: phone ? 'muted' : dark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.14)', width: phone ? 0.45 : 0.16, cap: 'round' },
      shadow: { color: 'rgba(0,0,0,.45)', blur: 6, x: 0, y: 2.5 }, start: deviceIn, end: S, ...rise,
    }),
    c.shape('screen', {
      name: 'Screen', ...screen, fill: 'fg', opacity: 0.06, start: deviceIn, end: S, ...rise,
    }),
    c.shape('screen-light', {
      name: 'Screen light', ...screen, fill: glass, start: lit, end: S, in: c.enter('wipe', { dir: 'up', d: k.d(0.6), ease: 'cubic-out' }), out: rise.out,
    }),
    // The gleam crosses the glass as it lights and is gone by the gallery's still (`stillTime`: a layer that starts
    // after the last entrance would become the last arrival, and the still would catch the band half-way across).
    ...shines(c, screen, { at: k.at(1), d: 1 * k.f, until: k.until(1), opacity: 0.3, most: 1, id: 'screen-shine' }),
  );
  if (phone) {
    const iw = r3(W * 0.3);
    const ih = r3(W * 0.075);
    layers.push(c.shape('island', {
      name: 'Camera', pin: 'mc', x: cx, y: r3(cy - H / 2 + bezel + W * 0.05 + ih / 2), w: iw, h: ih, radius: r3(ih / 2), fill: '#000000',
      start: deviceIn, end: S, ...rise,
    }));
  } else {
    const top = r3(cy - H / 2 + bar / 2);
    const left = cx - W / 2;
    const pillW = r3(W * 0.42);
    const pillH = r3(bar * 0.52);
    for (let i = 0; i < 3; i++) {
      layers.push(c.shape(`dot-${i + 1}`, {
        name: 'Window button', shape: 'ellipse', pin: 'mc', x: r3(left + 3 + i * 2.4), y: top, w: 1.3, h: 1.3, fill: 'muted', opacity: 0.7,
        start: deviceIn, end: S, ...rise,
      }));
    }
    layers.push(
      c.shape('address', {
        name: 'Address bar', pin: 'mc', x: cx, y: top, w: pillW, h: pillH, radius: r3(pillH / 2), fill: 'fg', opacity: 0.08, start: deviceIn, end: S, ...rise,
      }),
      c.icon('lock', {
        name: 'Lock', icon: 'lock', pin: 'mc', x: r3(cx - pillW / 2 + pillH * 0.75), y: top, size: r3(pillH * 0.5), weight: 2, color: 'muted',
        start: deviceIn, end: S, ...rise,
      }),
      c.shape('address-text', {
        name: 'Address', pin: 'mc', x: r3(cx - pillW / 2 + pillH * 1.35 + pillW * 0.2), y: top, w: r3(pillW * 0.4), h: 0.55, radius: 0.27,
        fill: 'muted', opacity: 0.6, start: deviceIn, end: S, ...rise,
      }),
    );
  }
  if (wordFit) {
    layers.push(c.text('screen-word', {
      name: 'Word on the screen', text: wordFit, pin: 'mc', x: cx, y: r3(screen.y), size: wordSize, weight: 800, voice: 'bold', color: inkOn(c, glass),
      align: 'center', lead: 1.2, max: r3(screen.w * 0.8), fit: true, start: k.at(1.1), end: S,
      in: c.enter('pop', { ease: E.pop, d: k.d(0.55) }), out: rise.out,
    }));
  }
  if (title.lines) {
    layers.push(c.text('title', {
      name: 'Title', text: title.text, pin: 'mc', x: textX, y: titleY, size: title.size, weight: 800, voice: 'bold', color: 'fg', align,
      lead: titleLead, max: room, fit: true, start: k.at(0.35), end: k.until(0.34),
      in: c.enter('mask', { by: 'line', gap: 0.1, d: k.d(0.75) }), out: c.leave('mask', { by: 'line', gap: 0.05, d: k.d(0.35) }),
    }));
  }
  if (sub.lines) {
    layers.push(c.text('subtitle', {
      name: 'Subtitle', text: sub.text, pin: 'mc', x: textX, y: subY, size: sub.size, weight: 500, voice: 'sans', color: 'fg', opacity: 0.8, align,
      lead: subLead, max: room, fit: true, start: k.at(0.8), end: k.until(0.4),
      in: c.enter('rise', { amount: 0.5, d: k.d(0.6) }), out: c.leave('fade', { d: k.d(0.3) }),
    }));
  }
  return layers;
}

// ── the words each starts with ────────────────────────────────────────────

/** The notifications in each language; also what a list with nothing in it falls back to. */
const NOTE_SAMPLES: Record<Lang, string> = {
  en: 'New message: Are we still on for tonight?\nOrder shipped: Your package is on its way\nReminder: Team call in 10 minutes',
  ar: 'رسالة جديدة: هل ما زال موعدنا الليلة قائماً؟\nتم شحن الطلب: طردك في الطريق إليك\nتذكير: مكالمة الفريق بعد 10 دقائق',
  ckb: 'نامەی نوێ: ئەمشەو هێشتا بەرنامەکەمان ماوە؟\nداواکارییەکەت نێردرا: پاکەتەکەت لە ڕێگادایە\nبیرخستنەوە: پەیوەندیی تیم دوای 10 خولەک',
  kmr: 'نامەیەکا نوو: ئەڤشەڤ هێشتا ژڤانا مە یا هەی؟\nداخوازیا تە هاتە هنارتن: پاکێتا تە د ڕێکێ دایە\nبیرئینان: پەیوەندیا تیمێ پشتی 10 خولەکان',
};

/** The conversation in each language; also what a list with nothing in it falls back to. */
const CHAT_SAMPLES: Record<Lang, string> = {
  en: 'Lana: Are you coming to the launch tonight?\nMe: Wouldn\'t miss it! What time?\nLana: Doors at 7, the show at 8\nMe: Perfect, see you there',
  ar: 'لانا: هل ستأتي إلى حفل الإطلاق الليلة؟\nأنا: لن أفوّته! متى يبدأ؟\nلانا: الأبواب في السابعة والعرض في الثامنة\nأنا: رائع، أراك هناك',
  ckb: 'لانا: ئەمشەو دێیت بۆ ئاهەنگی ناساندنەکە؟\nمن: بە هیچ شێوەیەک لەدەستی نادەم! کەی دەست پێدەکات؟\nلانا: دەرگاکان کاتژمێر 7 و نمایشەکە کاتژمێر 8\nمن: نایابە، لەوێ دەتبینم',
  kmr: 'لانا: ئەڤشەڤ دێ هێیە ئاهەنگا ناساندنێ؟\nئەز: ب چ ڕەنگان ژ دەست نادەم! کەنگی دەست پێدکەت؟\nلانا: دەرگەه دەمژمێر 7 و نمایش دەمژمێر 8\nئەز: زۆر باشە، ل وێرێ دێ تە بینم',
};

/** Work package 07's templates: how each is built, and the words each starts with in every language. */
export const PRO_A_RECIPES: Readonly<Record<(typeof PRO_A_IDS)[number], Recipe>> = {
  'lt-bar': {
    build: newsBar,
    sample: {
      en: { name: 'Dara Hassan', role: 'Field Producer, Sulaymaniyah' },
      ar: { name: 'دارا حسن', role: 'منتج ميداني، السليمانية' },
      ckb: { name: 'دارا حەسەن', role: 'بەرهەمهێنەری مەیدانی، سلێمانی' },
      kmr: { name: 'دارا حەسەن', role: 'بەرهەمهێنەرێ مەیدانی، زاخۆ' },
    },
  },
  'lt-pill': {
    build: softPill,
    sample: {
      en: { name: 'Shilan Omar', role: 'Host, The Morning Table' },
      ar: { name: 'شيلان عمر', role: 'مقدّمة برنامج طاولة الصباح' },
      ckb: { name: 'شیلان عومەر', role: 'پێشکەشکاری مێزی بەیانی' },
      kmr: { name: 'شیلان عومەر', role: 'پێشکێشکارا مێزا سپێدێ' },
    },
  },
  'lt-kicker': {
    build: kickerName,
    sample: {
      en: { kicker: 'Guest', name: 'Dr. Aram Karim', role: 'Climate scientist, University of Duhok' },
      ar: { kicker: 'ضيف الحلقة', name: 'د. آرام كريم', role: 'عالم مناخ، جامعة دهوك' },
      ckb: { kicker: 'میوان', name: 'د. ئارام کەریم', role: 'زانای کەشوهەوا، زانکۆی دهۆک' },
      kmr: { kicker: 'مێڤان', name: 'د. ئارام کەریم', role: 'زانایێ کەش و هەوایێ، زانکۆیا دهۆکێ' },
    },
  },
  'lt-neon': {
    build: neonName,
    sample: {
      en: { name: 'Rezan Ali', role: 'DJ and producer' },
      ar: { name: 'ريزان علي', role: 'دي جي ومنتج موسيقي' },
      ckb: { name: 'ڕێزان عەلی', role: 'دیجەی و بەرهەمهێنەری مۆسیقا' },
      kmr: { name: 'ڕێزان عەلی', role: 'دیجەی و بەرهەمهێنەرێ مۆزیکێ' },
    },
  },
  'ui-notify': {
    build: notifications,
    sample: {
      en: { items: NOTE_SAMPLES.en },
      ar: { items: NOTE_SAMPLES.ar },
      ckb: { items: NOTE_SAMPLES.ckb },
      kmr: { items: NOTE_SAMPLES.kmr },
    },
  },
  'ui-scribble': {
    build: scribble,
    sample: {
      en: { word: 'New', label: 'Just landed!' },
      ar: { word: 'جديد', label: 'وصل للتو!' },
      ckb: { word: 'نوێ', label: 'تازە گەیشت!' },
      kmr: { word: 'نوو', label: 'نوکە گەهشت!' },
    },
  },
  'ui-chat': {
    build: chat,
    sample: {
      en: { name: 'Lana', items: CHAT_SAMPLES.en },
      ar: { name: 'لانا', items: CHAT_SAMPLES.ar },
      ckb: { name: 'لانا', items: CHAT_SAMPLES.ckb },
      kmr: { name: 'لانا', items: CHAT_SAMPLES.kmr },
    },
  },
  'ui-device': {
    build: device,
    sample: {
      en: { title: 'Your studio, in your pocket', subtitle: 'Edit, export and share from anywhere', screen: 'Noor' },
      ar: { title: 'استوديوك في جيبك', subtitle: 'حرّر وصدّر وشارك من أي مكان', screen: 'نور' },
      ckb: { title: 'ستۆدیۆکەت لە گیرفانتدایە', subtitle: 'دەستکاری بکە، هەناردە بکە و لە هەر شوێنێک بڵاوی بکەرەوە', screen: 'نوور' },
      kmr: { title: 'ستۆدیۆیا تە د بەریکا تە دایە', subtitle: 'دەستکاری بکە، هەناردە بکە و ژ هەر جهەکی بەلاڤ بکە', screen: 'نوور' },
    },
  },
};
