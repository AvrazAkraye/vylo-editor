import type { Lang } from './i18n';
import type { Backdrop, Layer, Particles, RecipeId, ShapeLayer, TextLayer } from './motiontypes';
import { BACKDROPS } from './motiontypes';
import { E, T, type Kit, type Recipe } from './motionrecipe';
import { contrast } from './motionmath';

/**
 * The title recipes: a big title, kinetic type, a split reveal, a quote card,
 * a list of steps and a looping background.
 *
 * ## Words are set here, not only wrapped by the renderer
 *
 * A recipe has no canvas, yet its layout depends on how many lines a headline
 * takes: the label above it and the rule below it must sit clear of it, and a
 * line-by-line reveal must know how many lines it staggers. So each recipe
 * breaks its words itself (`setWords`): it knows how wide each voice's letters
 * are (`emsOf`, measured in the app's WebKit — Arabic script by the joined
 * form each letter takes), picks the largest size at which the words fit the
 * lines, the width and the height the design allows, and breaks them into
 * lines of even length, as a typesetter balances a headline. The line breaks
 * are written into the text, so `by: 'line'` staggers exactly those lines and
 * every block's height is known before anything is drawn. Each text layer
 * also has `max` and `fit`: if an estimate is ever short, the renderer shrinks
 * the words to the width rather than letting them run off the frame.
 *
 * ## Time is written for the natural length and pressed together when short
 *
 * Every entrance is written as the recipe's natural sequence, from the start,
 * and every exit ends exactly at `seconds`, so a longer graphic is a longer
 * hold. A graphic shorter than its entrance needs (`clockOf`) plays the same
 * sequence faster rather than cutting into it.
 */

// ── setting words ─────────────────────────────────────────────────────────

/** Arabic script — Arabic, Sorani and Badini: never split inside a word, never tracked, never in capitals. */
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFE]/;

/**
 * How wide words will be drawn, known without a canvas: measured once in the
 * app's WebKit and written down, because a recipe also runs where there is no
 * canvas to ask (a test, a rebuild for another shape) and must lay out the
 * same everywhere.
 *
 * - A Latin voice is its advance widths in hundredths of an em, for the
 *   characters from the space to `~`: Avenir Next Heavy for `bold` at 800,
 *   Impact for `condensed`, SF Pro for `sans` at 400, 500 and 700, New York for
 *   `serif`. Summed a character at a time they come within 2% of the whole
 *   string, kerning and all. SF Pro and New York are optical-size faces, wider
 *   the smaller they are drawn (New York by a quarter from 1000 px to 12 px),
 *   so theirs were measured at 56 px, where body text falls in a 1080p export.
 * - Arabic script is the bundled Noto Sans Arabic in every voice, and there a
 *   letter's width is its joined form's: `ب` standing alone is three times as
 *   wide as `ب` inside a word. So each letter has its four forms, and a word is
 *   the sum of the forms its letters take by the joining rules (`emsOf`).
 */
interface Face {
  latin: readonly number[];
  /** The weight Arabic script is drawn at in this voice: the bundled face has 400 to 700, and is 9% narrower at 400. */
  weight: number;
}

const face = (widths: string, weight: number): Face => ({ latin: widths.split(' ').map((n) => Number(n) / 100), weight });

const HEAVY = face('25 45 56 62 70 94 84 33 36 36 53 67 36 34 36 46 70 70 70 70 70 70 70 70 70 70 38 38 67 67 67 59 80 78 69 70 79 60 58 76 80 37 57 76 55 101 79 86 68 86 71 62 60 78 74 108 80 74 67 36 46 36 71 50 36 59 69 53 69 63 42 70 67 34 35 67 34 98 67 66 69 69 45 51 42 66 64 97 68 64 56 36 27 36 67', 700);
const IMPACT = face('18 27 37 63 55 69 58 19 31 31 28 53 17 29 18 40 54 38 50 53 50 54 54 39 53 54 20 20 53 53 53 52 77 51 55 55 55 42 40 55 56 29 33 54 38 72 54 55 50 55 54 52 46 55 52 81 48 47 40 28 40 28 48 55 33 50 52 49 52 51 29 52 52 27 28 48 27 77 52 51 52 52 36 47 30 52 44 67 43 45 35 37 27 37 52', 700);
const SANS_LIGHT = face('21 27 41 61 61 81 67 26 33 33 41 61 22 43 22 28 61 45 57 60 61 59 62 55 60 62 22 22 61 61 61 49 88 64 61 69 68 56 53 71 70 23 50 61 53 84 70 74 58 74 60 60 59 70 64 93 64 62 62 33 28 33 61 53 51 51 56 51 56 52 31 55 54 21 21 49 21 81 53 54 55 55 31 47 31 53 49 72 47 49 47 33 22 33 61', 400);
const SANS = face('21 29 43 62 62 84 69 26 35 35 42 62 23 44 23 29 63 46 58 61 62 60 63 56 62 63 23 23 62 62 62 51 88 66 62 70 69 56 54 72 71 24 52 62 54 85 71 74 60 74 62 61 59 71 65 94 66 64 63 35 29 35 62 55 51 52 57 52 57 53 33 57 56 22 22 51 22 83 55 55 57 57 33 49 32 55 50 75 49 51 49 35 23 35 62', 500);
const SANS_BOLD = face('20 32 46 64 65 90 71 28 39 39 45 65 25 45 25 31 66 49 61 64 65 63 66 58 65 66 25 25 65 65 65 54 89 70 65 72 71 58 55 73 73 27 56 66 55 87 72 76 62 76 65 64 61 71 68 97 69 67 64 39 31 39 65 58 51 55 60 55 60 56 36 60 59 25 25 54 25 87 58 58 60 60 37 52 36 58 53 80 53 54 51 39 25 39 65', 700);
const SERIF = face('21 27 41 56 51 86 75 24 30 30 34 54 23 33 23 30 60 36 46 53 55 50 56 45 57 56 23 23 54 54 54 34 94 66 63 68 73 59 54 73 76 31 29 64 54 87 72 79 59 79 63 55 63 71 66 102 65 63 58 30 30 30 54 49 49 50 56 47 57 50 31 51 58 26 25 51 26 88 58 56 57 56 38 43 32 56 49 76 49 49 43 30 30 30 54', 400);

/**
 * Each Arabic-script letter's width in ems at 700 — alone, first, middle and
 * last in a word — for every letter Arabic, Sorani and Badini write. Letters
 * that differ only in their dots share a row.
 */
const FORMS: readonly (readonly [string, readonly number[]])[] = [
  ['\u0627\u0623\u0625\u0622', [0.273, 0.273, 0.318, 0.318]],
  ['\u0621', [0.47, 0.47, 0.47, 0.47]],
  ['\u0628', [1.024, 0.317, 0.384, 1.142]],
  ['\u062A\u062B\u067E', [1.024, 0.359, 0.409, 1.142]],
  ['\u0646', [0.741, 0.317, 0.384, 0.805]],
  ['\u064A\u06CC\u06CE', [0.821, 0.359, 0.409, 0.8]],
  ['\u0626', [0.821, 0.317, 0.384, 0.8]],
  ['\u062C\u062D\u062E', [0.687, 0.629, 0.654, 0.739]],
  ['\u0686', [0.687, 0.629, 0.654, 0.759]],
  ['\u062F\u0630\u068E', [0.517, 0.517, 0.571, 0.571]],
  ['\u0631\u0632\u0698\u0695', [0.409, 0.409, 0.45, 0.45]],
  ['\u0633\u0634', [1.37, 0.95, 1.019, 1.439]],
  ['\u0635\u0636', [1.422, 0.974, 1.004, 1.442]],
  ['\u0637\u0638', [0.844, 0.737, 0.762, 0.861]],
  ['\u0639\u063A', [0.57, 0.557, 0.552, 0.57]],
  ['\u0641\u06A4', [1.024, 0.505, 0.529, 1.115]],
  ['\u0642', [0.832, 0.505, 0.529, 0.855]],
  ['\u0643', [0.931, 0.454, 0.508, 0.974]],
  ['\u06A9\u06AF', [0.909, 0.454, 0.508, 0.952]],
  ['\u0644\u06B5', [0.741, 0.297, 0.344, 0.791]],
  ['\u0645', [0.548, 0.582, 0.624, 0.661]],
  ['\u0647', [0.771, 0.641, 0.571, 0.556]],
  ['\u06BE', [0.771, 0.641, 0.571, 0.685]],
  ['\u0648\u06C6\u0624\u06CA\u06CB', [0.498, 0.498, 0.524, 0.524]],
  ['\u0649', [0.821, 0.821, 0.8, 0.8]],
  ['\u0629\u06D5', [0.471, 0.471, 0.556, 0.556]],
  ['\u0640', [0.289, 0.289, 0.289, 0.289]],
];
const FORM = new Map<string, readonly number[]>(FORMS.flatMap(([letters, w]) => Array.from(letters, (l): [string, readonly number[]] => [l, w])));
/** Letters that join only to the letter before them, so the next letter starts afresh; hamza joins to neither side. */
const RIGHT_ONLY = new Set(Array.from('\u0627\u0623\u0625\u0622\u062F\u0630\u068E\u0631\u0632\u0698\u0695\u0648\u06C6\u0624\u06CA\u06CB\u0649\u0629\u06D5\u0621'));
/** Vowel marks: no width of their own, and the letters either side join through them. */
const MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/;
/** The space, punctuation and digits drawn in an Arabic-script line, in ems. */
const ARABIC_OTHER: Readonly<Record<string, number>> = { ' ': 0.312, '\u060C': 0.323, '\u061B': 0.34, '\u061F': 0.512, '.': 0.292, '!': 0.343, ':': 0.363 };
const ARABIC_DIGIT = 0.572;

/** Whether a character reaches forward to join the one after it. */
const joinsOn = (ch: string | undefined) => !!ch && FORM.has(ch) && !RIGHT_ONLY.has(ch);
/** Whether a character can be joined to from the one before it. */
const joinable = (ch: string | undefined) => !!ch && FORM.has(ch) && ch !== '\u0621';

/** A Latin character's width in a voice: its own, its base letter's for an accented one, a near relative's for typographic marks. */
function latinEms(ch: string, f: Face): number {
  const at = (c: string) => {
    const code = c.charCodeAt(0);
    return code >= 32 && code <= 126 ? f.latin[code - 32] : undefined;
  };
  const own = at(ch) ?? at(ch.normalize('NFD'));
  if (own !== undefined) return own;
  if (ch === '\u2018' || ch === '\u2019') return f.latin[7];
  if (ch === '\u201C' || ch === '\u201D') return f.latin[2];
  if (ch === '\u2013') return f.latin[13] * 1.2;
  if (ch === '\u2014') return f.latin[45];
  if (ch === '\u2026') return f.latin[14] * 3;
  if (ch === '\u00A0') return f.latin[0];
  return f.latin[79];
}

/**
 * The width of `s` in ems, as the renderer will draw it in `f`. A line with any
 * Arabic-script letter is set in the Arabic face whole, its Latin letters in
 * the fallback beside it, and takes no tracking; every other line is the
 * voice's own widths plus `track` after each character.
 */
function emsOf(s: string, f: Face, track = 0): number {
  const arabic = ARABIC.test(s);
  const chars = Array.from(s).filter((ch) => !MARKS.test(ch));
  const scale = 0.91 + 0.09 * clamp((f.weight - 400) / 300, 0, 1);
  let w = 0;
  chars.forEach((ch, i) => {
    const forms = FORM.get(ch);
    if (forms) {
      const before = joinsOn(chars[i - 1]) && joinable(ch);
      const after = joinsOn(ch) && joinable(chars[i + 1]);
      w += forms[before ? (after ? 2 : 3) : after ? 1 : 0] * scale;
    } else if (arabic) {
      w += ARABIC_OTHER[ch] ?? (/[\u0660-\u0669\u06F0-\u06F9]/.test(ch) ? ARABIC_DIGIT : latinEms(ch, SANS_LIGHT));
    } else {
      w += latinEms(ch, f) + track;
    }
  });
  return w;
}

interface Setting {
  /** The words, a line break wherever a line ends. */
  text: string;
  /** u: the size the words fit at. */
  size: number;
  lines: number;
  /** u: the widest line, as estimated. */
  width: number;
}

interface SetOptions {
  /** u: the size the design wants. */
  size: number;
  /** u: the smallest it may shrink to before lines are added instead. */
  min: number;
  /** u: the widest a line may be. */
  room: number;
  /** The most lines before the size shrinks. */
  lines: number;
  face: Face;
  /** Ems of tracking after every Latin character. */
  track?: number;
  /** Set in capitals (Latin only, as the renderer does). */
  caps?: boolean;
  /** A phrase that must stay on one line: a highlight is found whole or not at all. */
  keep?: string;
  /** u: the tallest the block may be, its lines `lead` times the size apart. */
  height?: number;
  lead?: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A paragraph's words, with the words of `keep` held together as one. */
function tokensOf(p: string, keep?: string): string[] {
  const words = p.split(/\s+/).filter(Boolean);
  if (!keep || !/\s/.test(keep)) return words;
  const flat = words.join(' ');
  const a = flat.indexOf(keep);
  if (a < 0) return words;
  const b = a + keep.length;
  const out: string[] = [];
  let held: string[] = [];
  let pos = 0;
  for (const w of words) {
    const s = pos;
    pos += w.length + 1;
    if (s + w.length > a && s < b) {
      held.push(w);
      continue;
    }
    if (held.length) out.push(held.join(' '));
    held = [];
    out.push(w);
  }
  if (held.length) out.push(held.join(' '));
  return out;
}

/**
 * Latin words wider than a whole line, cut into pieces that fit — what the
 * renderer does to a word that cannot wrap. Arabic script is never cut: a
 * letter drawn apart from its word loses its joins.
 */
function chopped(words: string[], ems: (s: string) => number, room: number, arabic: boolean): string[] {
  if (arabic) return words;
  const out: string[] = [];
  for (const w of words) {
    if (ems(w) <= room || /\s/.test(w)) {
      out.push(w);
      continue;
    }
    let piece = '';
    for (const ch of Array.from(w)) {
      if (piece && ems(piece + ch) > room) {
        out.push(piece);
        piece = '';
      }
      piece += ch;
    }
    if (piece) out.push(piece);
  }
  return out;
}

/**
 * Words broken into as few lines as fit `room` ems, and those lines made as
 * even as they can be: the partition whose widest line is narrowest. A
 * headline set greedily ends on a stray word; balanced, it reads as a shape.
 */
function balanced(words: string[], ems: (s: string) => number, space: number, room: number): string[][] {
  const n = words.length;
  if (n <= 1) return n ? [words] : [];
  const w = words.map(ems);
  let count = 1;
  let run = w[0];
  for (let i = 1; i < n; i++) {
    if (run + space + w[i] > room) {
      count += 1;
      run = w[i];
    } else run += space + w[i];
  }
  if (count === 1) return [words];
  const pre = [0];
  for (let i = 0; i < n; i++) pre.push(pre[i] + w[i]);
  const width = (i: number, j: number) => pre[j] - pre[i] + (j - i - 1) * space;
  const best: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from: number[][] = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let k = 1; k <= count; k++) {
    for (let j = k; j <= n; j++) {
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
  const lines: string[][] = [];
  let j = n;
  for (let k = count; k >= 1; k--) {
    const i = from[k][j];
    lines.unshift(words.slice(i, j));
    j = i;
  }
  return lines;
}

/**
 * Words set for a block: the largest size from `o.size` down to `o.min` at
 * which they take no more than `o.lines` lines of `o.room`, no line wider than
 * the room and the block no taller than `o.height`, broken evenly. A line
 * break the person wrote is kept. Past the smallest size the words take more
 * lines rather than shrinking further.
 */
function setWords(raw: string, o: SetOptions): Setting {
  const arabic = ARABIC.test(raw);
  const track = arabic ? 0 : o.track ?? 0;
  const ems = (s: string) => emsOf(o.caps && !arabic ? s.toUpperCase() : s, o.face, track);
  const space = arabic ? ARABIC_OTHER[' '] : o.face.latin[0] + track;
  const paras = raw.split('\n').map((p) => tokensOf(p, o.keep)).filter((p) => p.length > 0);
  if (!paras.length) return { text: '', size: o.size, lines: 0, width: 0 };
  // Lines are broken a little short of the room, so that where an estimate is
  // a few per cent under, `fit` still has nothing to do.
  const usable = o.room * 0.975;
  const layout = (size: number) => {
    const room = usable / size;
    return paras.flatMap((p) => balanced(chopped(p, ems, room, arabic), ems, space, room));
  };
  const widestOf = (lines: string[][]) => Math.max(...lines.map((l) => ems(l.join(' '))));
  // Too many lines, or one word (an Arabic one, which is never cut) wider than a line: smaller.
  let size = round2(o.size);
  let lines = layout(size);
  const tall = (n: number, px: number) => o.height !== undefined && n * px * (o.lead ?? 1.2) > o.height;
  while ((lines.length > o.lines || widestOf(lines) * size > usable * 1.001 || tall(lines.length, size)) && size > o.min) {
    size = round2(Math.max(o.min, size * 0.95));
    lines = layout(size);
  }
  const widest = widestOf(lines);
  return { text: lines.map((l) => l.join(' ')).join('\n'), size, lines: lines.length, width: Math.min(o.room, widest * size) };
}

/** Line height for a block: Arabic script's tall letters and dots need more room between lines than Latin capitals do. */
const leadOf = (text: string, latin: number, arabic: number) => (ARABIC.test(text) ? arabic : latin);

/**
 * Small type a little larger in Arabic script: at the same size its body sits
 * lower and smaller than Latin capitals, and a label that is legible in
 * English is a squint in Sorani. A seventh larger at 4u and under, tapering
 * to nothing at 6u, where the difference no longer costs legibility.
 */
const smallSize = (text: string, size: number) => round2(ARABIC.test(text) ? size * (1 + 0.14 * clamp((6 - size) / 2, 0, 1)) : size);

/** Centres, in u from the middle of the frame, of blocks stacked top to bottom, `gaps[i]` after block `i`, the stack centred on `shift`. */
function stack(heights: number[], gaps: number[], shift = 0): number[] {
  const total = heights.reduce((s, h) => s + h, 0) + gaps.slice(0, heights.length - 1).reduce((s, g) => s + g, 0);
  let y = shift - total / 2;
  return heights.map((h, i) => {
    const mid = y + h / 2;
    y += h + (gaps[i] ?? 0);
    return r3(mid);
  });
}

// ── colour ────────────────────────────────────────────────────────────────

/** The palette's ink that reads best on a ground: `fg` or `bg`, whichever stands further from it. */
function inkOn(c: Kit, ground: string): 'fg' | 'bg' {
  return contrast(c.palette.fg, ground) >= contrast(c.palette.bg, ground) ? 'fg' : 'bg';
}

// ── time ──────────────────────────────────────────────────────────────────

/** The shortest hold worth having between the last entrance landing and the exit starting. */
const HOLD = 0.35;

interface Clock {
  /** How much the entrance is pressed together: 1 at its natural length. */
  k: number;
  /** A moment of the entrance, written for the natural length. */
  at(t: number): number;
  /** A duration of the entrance. */
  d(s: number): number;
}

/**
 * The entrance's clock. `entrance` is when the natural sequence has landed;
 * a graphic too short to hold it and a beat before the exit plays it faster,
 * down to a third of its pace, rather than cutting into it.
 */
function clockOf(c: Kit, entrance: number): Clock {
  const k = clamp((c.seconds - T.exit - HOLD) / entrance, 0.3, 1);
  return { k, at: (t) => r3(t * k), d: (s) => r3(Math.max(0.15, s * k)) };
}

/** A start and end inside the graphic, the one before the other: a layer's own time, safe at any length. */
function within(c: Kit, start: number, end: number): { start: number; end: number } {
  const s = r3(clamp(start, 0, c.seconds - 0.1));
  return { start: s, end: r3(clamp(end, s + 0.1, c.seconds)) };
}

// ── big title ─────────────────────────────────────────────────────────────

/**
 * Big title. The aurora blooms up out of the ground; a small tracked label
 * rises in; the headline comes up line by line from behind its own baseline,
 * the classic mask reveal; a thin rule grows out from the centre beneath it,
 * and the subtitle rises last. Each starts as the one before is half landed,
 * so the eye is led down the stack rather than handed it all at once. The
 * lights keep drifting through the hold, and in the last half second
 * everything leaves the way it came, ending on the bare ground for a cut.
 */
function bigTitle(c: Kit): Layer[] {
  const f = c.fields;
  const land = c.landscape;
  const room = land ? 132 : c.u.w - 20;
  const headLead = leadOf(f.title ?? '', 1.04, 1.3);
  // A word or two stands a little larger; a sentence takes the design's size.
  const short = clamp((20 - Array.from(f.title ?? '').length) / 8, 0, 1);
  const head = setWords(f.title ?? '', {
    size: (land ? 13.5 : 11) + short * 1.5, min: 6, room, lines: land ? 3 : c.portrait ? 5 : 4, face: HEAVY,
    height: c.u.h - 42, lead: headLead,
  });
  const kick = setWords(f.kicker ?? '', {
    size: smallSize(f.kicker ?? '', land ? 2.6 : 2.5), min: 1.8, room, lines: 2, face: SANS_BOLD, track: 0.18, caps: true,
  });
  const subRoom = land ? 112 : room;
  const sub = setWords(f.subtitle ?? '', {
    size: smallSize(f.subtitle ?? '', land ? 3.9 : 3.6), min: 2.6, room: subRoom, lines: land ? 2 : 3, face: SANS,
  });
  const kickLead = leadOf(kick.text, 1.3, 1.5);
  const subLead = leadOf(sub.text, 1.35, 1.55);
  const ruleW = land ? 12 : 10;
  const ruleH = 0.45;

  const blocks: { key: string; h: number; gap: number }[] = [];
  if (kick.lines) blocks.push({ key: 'kicker', h: kick.lines * kick.size * kickLead, gap: 0.14 * head.size });
  blocks.push({ key: 'title', h: head.lines * head.size * headLead, gap: 0.1 * head.size + 1.2 });
  blocks.push({ key: 'rule', h: ruleH, gap: 3.2 });
  if (sub.lines) blocks.push({ key: 'subtitle', h: sub.lines * sub.size * subLead, gap: 0 });
  const ys = stack(blocks.map((b) => b.h), blocks.map((b) => b.gap), -1.5);
  const y = (key: string) => ys[blocks.findIndex((b) => b.key === key)] ?? 0;

  const headIn = kick.lines ? 0.3 : 0.15;
  const ruleIn = headIn + 0.45 + Math.max(0, head.lines - 1) * 0.1;
  const subIn = ruleIn + 0.25;
  const clock = clockOf(c, (sub.lines ? subIn + 0.8 : ruleIn + 0.7));

  const layers: Layer[] = [
    c.backdrop('aurora', {
      name: 'Aurora', style: 'aurora', colors: ['accent', 'accent2'], density: 0.5, speed: 1, opacity: 0.75,
      in: c.enter('fade', { d: clock.d(1.2), ease: E.soft }), out: c.leave('fade', { d: 0.6, ease: E.soft }),
    }),
  ];
  if (kick.lines) {
    layers.push(c.text('kicker', {
      name: 'Small label', text: kick.text, voice: 'sans', weight: 700, size: kick.size, lead: kickLead, color: 'accent',
      caps: true, track: 0.18, align: 'center', max: room, fit: true, y: y('kicker'),
      in: c.enter('rise', { d: clock.d(0.7), delay: clock.at(0.1) }), out: c.leave('rise'),
    }));
  }
  if (head.lines) {
    layers.push(c.text('title', {
      name: 'Title', text: head.text, voice: 'bold', weight: 800, size: head.size, lead: headLead, color: 'fg',
      align: 'center', max: room, fit: true, y: y('title'),
      in: c.enter('mask', { by: 'line', d: clock.d(0.9), delay: clock.at(headIn), gap: r3(0.1 * clock.k) }),
      out: c.leave('mask', { by: 'line', gap: 0 }),
    }));
  }
  // Two halves that grow apart from the middle: `grow` extends from an edge, and a rule under a centred title opens from its centre.
  for (const side of ['start', 'end'] as const) {
    const from = side === 'start' ? 'end' : 'start';
    layers.push(c.shape(`rule-${side}`, {
      name: side === 'start' ? 'Rule (start half)' : 'Rule (end half)', shape: 'rect', w: ruleW / 2, h: ruleH, radius: 0,
      fill: 'accent', x: side === 'start' ? -ruleW / 4 : ruleW / 4, y: y('rule'),
      in: c.enter('grow', { dir: from, d: clock.d(0.7), delay: clock.at(ruleIn) }), out: c.leave('grow', { dir: from, d: 0.4 }),
    }));
  }
  if (sub.lines) {
    layers.push(c.text('subtitle', {
      name: 'Subtitle', text: sub.text, voice: 'sans', weight: 500, size: sub.size, lead: subLead, color: 'fg', opacity: 0.82,
      align: 'center', max: subRoom, fit: true, y: y('subtitle'),
      in: c.enter('rise', { d: clock.d(0.8), delay: clock.at(subIn) }), out: c.leave('rise'),
    }));
  }
  return layers;
}

// ── kinetic type ──────────────────────────────────────────────────────────

/** The phrase to light up as it is written in the title — exactly, else ignoring case — or nothing when the title does not hold it. */
function phraseIn(text: string, want: string): string {
  const w = want.replace(/\s+/g, ' ').trim();
  if (!w) return '';
  const flat = text.replace(/\s+/g, ' ');
  if (flat.includes(w)) return w;
  const at = flat.toLowerCase().indexOf(w.toLowerCase());
  const found = at >= 0 ? flat.slice(at, at + w.length) : '';
  return found && flat.includes(found) ? found : '';
}

/**
 * Kinetic type. The words slam in one after another, each popping past its
 * size and settling, the block set at a slight tilt so it leans forward.
 * When the last word lands, a highlighter box wipes in behind the key word
 * and the word turns to the ink that reads on it, and small accent shapes —
 * a ring, dots, dashes, a spark — pop in around the block and keep pulsing.
 * The block then pushes in slowly through the hold so it never sits dead, a
 * faint sunburst turning behind it, and leaves in one quick punch toward the
 * viewer.
 *
 * The words arrive on one layer, split by word, and are handed to a second,
 * whole layer the moment they land: the whole layer carries the highlight and
 * the push-in, which a split layer cannot (its pieces would each scale about
 * their own centres and leave the box behind). The two are the same words in
 * the same place, and the first ends a few frames after the second is fully
 * there, before its box has begun to grow, so the handover cannot be seen.
 */
function kinetic(c: Kit): Layer[] {
  const title = c.fields.title ?? '';
  const phrase = phraseIn(title, c.fields.highlight ?? '');
  const arabic = ARABIC.test(title);
  const land = c.landscape;
  const room = land ? 132 : c.u.w - 16;
  const lead = arabic ? 1.28 : 0.98;
  // The block leaves room above and below it for the shapes around it.
  const set = setWords(title, {
    size: land ? 21 : 17, min: 6, room, lines: land ? 3 : c.portrait ? 6 : c.feed ? 5 : 4, face: arabic ? HEAVY : IMPACT,
    caps: true, keep: phrase, height: c.u.h - 32, lead,
  });
  const glow = (fadeIn: number) => c.backdrop('glow', {
    name: 'Background', style: 'rays', colors: ['accent', 'accent2'], density: 0.35, speed: 1, opacity: 0.55,
    in: c.enter('fade', { d: fadeIn, ease: E.soft }), out: c.leave('fade', { d: 0.35 }),
  });
  if (!set.lines) return [glow(0.8)];
  const words = set.text.split(/\s+/).filter(Boolean).length;
  const gap = clamp(1.1 / Math.max(1, words - 1), 0.1, 0.17);
  const popD = 0.5;
  const landsAt = 0.2 + (words - 1) * gap + popD;
  /** The highlight box: the renderer draws it over this long once the words are in. */
  const MARK = 0.45;
  const clock = clockOf(c, landsAt + 0.05 + MARK + 0.2);
  const t0 = clock.at(0.2);
  const g = r3(gap * clock.k);
  const handover = r3(t0 + (words - 1) * g + clock.d(popD));
  const tilt = 3.5;
  const look: Partial<TextLayer> = {
    text: set.text, voice: arabic ? 'sans' : 'condensed', weight: arabic ? 700 : 400, size: set.size, lead, color: 'fg',
    caps: !arabic, align: 'center', max: room, fit: true, rot: c.rtl ? tilt : -tilt,
  };
  const first = within(c, 0, handover + 0.08);
  const settled = within(c, handover, c.seconds);

  const layers: Layer[] = [
    glow(clock.d(0.8)),
    c.text('title', {
      ...look, name: 'Title', start: settled.start, end: settled.end,
      hi: phrase || undefined, hiStyle: 'box', hiColor: 'accent',
      in: c.enter('fade', { d: 0.05, ease: 'linear' }),
      out: c.leave('zoom', { d: 0.35 }),
      loop: c.loop('pulse', { d: r3(clamp(2 * (c.seconds - handover), 0.4, 60)), amount: 1 }),
    }),
    c.text('words', {
      ...look, name: 'Words arriving', start: first.start, end: first.end,
      in: c.enter('pop', { by: 'word', d: clock.d(popD), delay: t0, gap: g, ease: E.pop, amount: 1.25 }),
    }),
  ];

  // The shapes sit at the block's corners, above its top line and below its
  // last, so a line wider than estimated can never run into one; they keep
  // clear of the highlight box, which reaches past the words by about a third
  // of their size, and inside the frame.
  const bw = Math.max(set.width, 16);
  const bh = set.lines * set.size * lead;
  const clear = 0.35 * set.size;
  const top = -bh / 2 - clear;
  const bottom = bh / 2 + clear;
  const a = (-tilt * Math.PI) / 180;
  const xMost = c.u.w / 2 - 4;
  const yMost = c.u.h / 2 - 4;
  const at = (x: number, y: number) => ({
    x: r3(clamp(x * Math.cos(a) - y * Math.sin(a), -xMost, xMost)),
    y: r3(clamp(x * Math.sin(a) + y * Math.cos(a), -yMost, yMost)),
  });
  const s = land ? 1 : 0.8;
  // Rotation is physical, so a slant that leans with the reading direction is mirrored for right to left.
  const slant = c.rtl ? 35 : -35;
  const dash = (w: number): Partial<ShapeLayer> => ({ shape: 'line', w, h: 0.6, fill: null, stroke: { color: 'accent2', width: 0.6, cap: 'round' }, rot: slant });
  const dot: Partial<ShapeLayer> = { shape: 'ellipse', w: 1.5 * s, h: 1.5 * s, fill: 'accent2' };
  const decor: { key: string; name: string; o: Partial<ShapeLayer> }[] = [
    {
      key: 'ring', name: 'Ring',
      o: { shape: 'ellipse', w: 6.5 * s, h: 6.5 * s, fill: null, stroke: { color: 'accent2', width: 0.6, cap: 'round' }, ...at(bw / 2 + 1, top - 4 * s) },
    },
    { key: 'spark', name: 'Spark', o: { shape: 'star', sides: 4, inner: 0.3, w: 4.2 * s, h: 4.2 * s, fill: 'accent2', ...at(bw / 2 + 2, bottom + 2.5 * s) } },
    { key: 'dash-1', name: 'Dash', o: { ...dash(5 * s), ...at(-bw / 2 - 2, top - 2 * s) } },
    { key: 'dash-2', name: 'Dash', o: { ...dash(3.2 * s), ...at(-bw / 2 + 2.2 * s, top - 3.4 * s) } },
    { key: 'dot-1', name: 'Dot', o: { ...dot, ...at(-bw / 2 + 1, bottom + 2 * s) } },
    { key: 'dot-2', name: 'Dot', o: { ...dot, ...at(-bw / 2 + 1 + 3 * s, bottom + 2 * s) } },
    { key: 'dot-3', name: 'Dot', o: { ...dot, ...at(-bw / 2 + 1 + 6 * s, bottom + 2 * s) } },
  ];
  decor.forEach((d, i) => {
    layers.push(c.shape(d.key, {
      ...d.o, name: d.name,
      in: c.enter('pop', { d: clock.d(0.45), delay: r3(handover + clock.at(0.06 * i)), ease: E.pop, amount: 1.4 }),
      out: c.leave('pop', { d: 0.35 }),
      loop: c.loop('pulse', { d: r3(1.1 + 0.17 * i), amount: 2.2 }),
    }));
  });
  return layers;
}

// ── split reveal ──────────────────────────────────────────────────────────

/**
 * Split reveal. Two colour panels sweep in from opposite sides — the accent
 * across the top, a deeper tone of it across the bottom — and meet at a seam
 * across the middle, the upper one casting a soft shadow on the lower. Then
 * the seam opens: a band of the ground parts the panels like doors, and the
 * title rises up inside it with the subtitle after, so the panels end as two
 * bold bars framing the words, and the title pushes in slowly through the
 * hold. At the end the words sink and the bars pull back to the sides they
 * came from, leaving the bare ground.
 *
 * The opening is two ground-coloured halves growing apart from the seam over
 * the panels rather than the panels moving: a layer has one entrance, and the
 * panels have spent theirs sweeping in. On flat colour the two look the same.
 * The halves stay to the end: they are the ground's own colour, and a fade
 * would show the panels through them.
 */
function splitTitle(c: Kit): Layer[] {
  const f = c.fields;
  const land = c.landscape;
  const tall = c.portrait;
  const W = c.u.w;
  const H = c.u.h;
  const room = land ? 136 : W - 16;
  const headLead = leadOf(f.title ?? '', 1.04, 1.3);
  const head = setWords(f.title ?? '', {
    size: land ? 13 : 11.5, min: 6, room, lines: land ? 3 : tall ? 5 : 4, face: HEAVY, height: H * 0.55, lead: headLead,
  });
  const subRoom = land ? 116 : room;
  const sub = setWords(f.subtitle ?? '', {
    size: smallSize(f.subtitle ?? '', land ? 3.9 : 3.6), min: 2.6, room: subRoom, lines: land ? 2 : 3, face: SANS,
  });
  const subLead = leadOf(sub.text, 1.35, 1.55);
  const headH = head.lines * head.size * headLead;
  const subH = sub.lines * sub.size * subLead;
  const gap = sub.lines && head.lines ? 3 : 0;
  const seam = -1;
  const [headY, subY] = stack([headH, subH], [gap], seam);
  // Half the opening: the words and a margin of ground above and below them.
  const half = r3((headH + gap + subH) / 2 + (land ? 7 : 6.5));
  const clock = clockOf(c, 1.95);
  const bleed = 3;
  const wide = r3(W + 2 * bleed);

  const layers: Layer[] = [
    c.shape('panel-bottom', {
      name: 'Lower panel', shape: 'rect', pin: 'bc', w: wide, h: r3(H / 2 - seam + bleed), y: bleed, radius: 0,
      fill: 'accent', opacity: 0.55,
      in: c.enter('wipe', { dir: 'end', d: clock.d(0.8), delay: clock.at(0.08) }),
      out: c.leave('wipe', { dir: 'end', d: 0.45, ease: 'inout' }),
    }),
    c.shape('panel-top', {
      name: 'Upper panel', shape: 'rect', pin: 'tc', w: wide, h: r3(H / 2 + seam + bleed + 0.3), y: -bleed, radius: 0,
      fill: 'accent', shadow: { color: 'rgba(0,0,0,.35)', blur: 3, x: 0, y: 1 },
      in: c.enter('wipe', { dir: 'start', d: clock.d(0.8) }),
      out: c.leave('wipe', { dir: 'start', d: 0.45, ease: 'inout' }),
    }),
  ];
  // The two halves of the opening overlap across the seam, so no line of panel
  // shows between them even in a thumbnail, where a unit is a pixel or two.
  const lap = 0.6;
  for (const side of ['top', 'bottom'] as const) {
    layers.push(c.shape(`opening-${side}`, {
      name: side === 'top' ? 'Opening (upper half)' : 'Opening (lower half)', shape: 'rect', w: wide, h: r3(half + lap), radius: 0,
      fill: 'bg', y: r3(side === 'top' ? seam - (half - lap) / 2 : seam + (half - lap) / 2),
      in: c.enter('grow', { dir: side === 'top' ? 'up' : 'down', d: clock.d(0.8), delay: clock.at(0.62) }),
    }));
  }
  if (head.lines) {
    layers.push(c.text('title', {
      name: 'Title', text: head.text, voice: 'bold', weight: 800, size: head.size, lead: headLead, color: 'fg',
      align: 'center', max: room, fit: true, y: headY,
      in: c.enter('mask', { by: 'line', d: clock.d(0.85), delay: clock.at(0.82), gap: r3(0.1 * clock.k) }),
      out: c.leave('mask', { by: 'line', gap: 0, d: 0.38, delay: 0.07 }),
      loop: c.loop('pulse', { d: r3(clamp(2 * c.seconds, 0.4, 60)), amount: 0.6 }),
    }));
  }
  if (sub.lines) {
    layers.push(c.text('subtitle', {
      name: 'Subtitle', text: sub.text, voice: 'sans', weight: 500, size: sub.size, lead: subLead, color: 'fg', opacity: 0.8,
      align: 'center', max: subRoom, fit: true, y: subY,
      in: c.enter('rise', { d: clock.d(0.75), delay: clock.at(1.2) }),
      out: c.leave('rise', { d: 0.38, delay: 0.07 }),
    }));
  }
  return layers;
}

// ── quote card ────────────────────────────────────────────────────────────

/**
 * Quote card. Soft out-of-focus lights drift behind; a giant quotation mark
 * pops in; the quotation reveals line by line at a reading pace; a thin rule
 * opens from the centre under it; and the author, then their role, slide in
 * from the start side. The size of the quotation follows its length — a short
 * line is set large, a long one smaller over more lines — so thirty
 * characters and a hundred and sixty both fill the card like a design.
 */
function quote(c: Kit): Layer[] {
  const f = c.fields;
  const land = c.landscape;
  const tall = c.portrait;
  const words = f.quote ?? '';
  const n = Math.max(1, Array.from(words.replace(/\s+/g, ' ').trim()).length);
  const room = land ? 124 : c.u.w - 20;
  // The area the quotation should cover, so its size follows its length: a
  // short line large, a long passage smaller over more lines.
  const area = land ? 4400 : tall ? 4600 : c.feed ? 3600 : 3000;
  const want = clamp(Math.sqrt(area / n), 4.2, land ? 8 : tall ? 8.5 : c.feed ? 8 : 7.6);
  const bodyLead = leadOf(words, 1.3, 1.55);
  const body = setWords(words, {
    size: round2(want), min: 3.6, room, lines: land ? 4 : tall ? 8 : c.feed ? 6 : 5, face: SERIF,
    height: c.u.h - (land ? 50 : 52), lead: bodyLead,
  });
  const author = setWords(f.author ?? '', { size: smallSize(f.author ?? '', land ? 3.4 : 3.1), min: 2.4, room, lines: 1, face: SANS_BOLD });
  const role = setWords(f.role ?? '', { size: smallSize(f.role ?? '', land ? 2.8 : 2.6), min: 2.2, room, lines: 2, face: SANS });
  const roleLead = leadOf(role.text, 1.3, 1.5);
  const markSize = land ? 36 : 30;
  // The mark is a glyph high in its line box: in New York its ink runs from
  // 0.14 to 0.40 of the size down from the top (measured in WebKit), so the
  // stack places the ink and the layer's box is set from it.
  const markInk = 0.26 * markSize;
  const ruleW = land ? 9 : 7;
  const ruleH = 0.4;

  const blocks: { key: string; h: number; gap: number }[] = [
    { key: 'mark', h: markInk, gap: 2.6 },
    { key: 'quote', h: body.lines * body.size * bodyLead, gap: 3.8 },
    { key: 'rule', h: ruleH, gap: 3.4 },
  ];
  if (author.lines) blocks.push({ key: 'author', h: author.size * 1.3, gap: 0.6 });
  if (role.lines) blocks.push({ key: 'role', h: role.lines * role.size * roleLead, gap: 0 });
  const ys = stack(blocks.map((b) => b.h), blocks.map((b) => b.gap), -1);
  const y = (key: string) => ys[blocks.findIndex((b) => b.key === key)] ?? 0;
  const markY = r3(y('mark') + 0.23 * markSize);

  const lineGap = 0.14;
  const bodyIn = 0.45;
  const ruleIn = bodyIn + Math.max(0, body.lines - 1) * lineGap + 0.5;
  const authorIn = ruleIn + 0.2;
  const roleIn = authorIn + 0.12;
  const clock = clockOf(c, roleIn + 0.7);

  const layers: Layer[] = [
    c.backdrop('lights', {
      name: 'Lights', style: 'bokeh', colors: ['accent', 'accent2'], density: 0.35, speed: 1, opacity: 0.6,
      in: c.enter('fade', { d: clock.d(1.2), ease: E.soft }), out: c.leave('fade', { d: 0.6, ease: E.soft }),
    }),
    c.text('mark', {
      name: 'Quotation mark', text: '\u201C', voice: 'serif', weight: 700, size: markSize, lead: 1, color: 'accent',
      align: 'center', max: markSize, y: markY,
      in: c.enter('pop', { d: clock.d(0.6), delay: clock.at(0.15), ease: E.pop, amount: 1.2 }), out: c.leave('pop'),
      loop: c.loop('float', { d: 4, amount: 0.5 }),
    }),
  ];
  if (body.lines) {
    layers.push(c.text('quote', {
      name: 'Quote', text: body.text, voice: 'serif', weight: 400, size: body.size, lead: bodyLead, color: 'fg',
      align: 'center', max: room, fit: true, y: y('quote'),
      in: c.enter('mask', { by: 'line', d: clock.d(0.9), delay: clock.at(bodyIn), gap: r3(lineGap * clock.k) }),
      out: c.leave('mask', { by: 'line', gap: 0 }),
    }));
  }
  for (const side of ['start', 'end'] as const) {
    const from = side === 'start' ? 'end' : 'start';
    layers.push(c.shape(`rule-${side}`, {
      name: side === 'start' ? 'Rule (start half)' : 'Rule (end half)', shape: 'rect', w: ruleW / 2, h: ruleH, radius: 0,
      fill: 'accent', x: side === 'start' ? -ruleW / 4 : ruleW / 4, y: y('rule'),
      in: c.enter('grow', { dir: from, d: clock.d(0.6), delay: clock.at(ruleIn) }), out: c.leave('grow', { dir: from, d: 0.4 }),
    }));
  }
  if (author.lines) {
    layers.push(c.text('author', {
      name: 'Author', text: author.text, voice: 'sans', weight: 700, size: author.size, lead: 1.3, color: 'fg',
      align: 'center', max: room, fit: true, y: y('author'),
      in: c.enter('slide', { dir: 'start', amount: 0.5, d: clock.d(0.7), delay: clock.at(authorIn) }),
      out: c.leave('slide', { dir: 'start', amount: 0.5 }),
    }));
  }
  if (role.lines) {
    layers.push(c.text('role', {
      name: 'Role', text: role.text, voice: 'sans', weight: 400, size: role.size, lead: roleLead, color: 'muted',
      align: 'center', max: room, fit: true, y: y('role'),
      in: c.enter('slide', { dir: 'start', amount: 0.5, d: clock.d(0.7), delay: clock.at(roleIn) }),
      out: c.leave('slide', { dir: 'start', amount: 0.5 }),
    }));
  }
  return layers;
}

// ── steps ─────────────────────────────────────────────────────────────────

/** The steps of a list field: one a line, any numbering or bullet the person typed taken off (the recipe numbers them), at most five. */
function stepsOf(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*\u2022\u00B7\u2013\u2014]+\s*|[0-9\u0660-\u0669\u06F0-\u06F9]{1,2}\s*[.)\-:]\s*)/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 5);
}

/**
 * Steps. The heading rises in, then the steps build one every seven tenths
 * of a second: a line draws down from the step before, the numbered circle
 * pops at its end and sends out a ripple, the words slide in from the start
 * side, and a soft band marks the step that has just arrived, handing on to
 * the next and fading when the list is whole. Row spacing, circle and type
 * all come from the number of steps, so one step and five both fill the
 * frame, in every shape. A wide frame sets the heading beside the list, as a
 * slide would; the taller shapes stack it above.
 */
function steps(c: Kit): Layer[] {
  const f = c.fields;
  const land = c.landscape;
  const tall = c.portrait;
  const W = c.u.w;
  const H = c.u.h;
  const given = stepsOf(f.items ?? '');
  const items = given.length ? given : stepsOf(STEP_SAMPLES[c.lang] ?? STEP_SAMPLES.en);
  const n = Math.max(1, items.length);
  const margin = land ? 10 : 8;
  const beside = land;
  const gutter = 9;
  const headLead = leadOf(f.title ?? '', 1.06, 1.32);
  const head = setWords(f.title ?? '', {
    size: beside ? 8.5 : tall ? 8.2 : c.feed ? 7 : 6.6, min: 3.6, room: beside ? 58 : W - 2 * margin, lines: 3, face: HEAVY,
  });
  const headH = head.lines * head.size * headLead;
  const headGap = head.lines && !beside ? (tall ? 8 : 6) : 0;
  const listRoom = beside ? W - 2 * margin - (head.lines ? head.width + gutter : 0) : W - 2 * margin;
  // The rows share what height is left, up to a comfortable pitch; the circle and the words follow the pitch.
  const avail = H - 2 * (land ? 12 : 12) - (beside ? 0 : headH + headGap);
  const pitch = r3(Math.min(land ? 16 : tall ? 20 : c.feed ? 16 : 14.5, avail / n));
  const dot = r3(clamp(pitch * 0.56, 4.2, land ? 9 : tall ? 10.5 : c.feed ? 8.8 : 8));
  const gapX = r3(dot * 0.6);
  const textRoom = listRoom - dot - gapX;
  const want = clamp(dot * 0.62, 3, land ? 5.4 : tall ? 6 : c.feed ? 5.2 : 4.8);
  const arabic = items.some((s) => ARABIC.test(s));
  const textLead = arabic ? 1.45 : 1.25;
  // A step may take two lines (three in portrait) as long as they fit its row;
  // every step is then set at the size the longest needed, so the list reads as one.
  const lines = tall ? 3 : 2;
  const fitRow = { room: textRoom, lines, face: SANS, height: pitch - 1.2, lead: textLead };
  const first = items.map((s) => setWords(s, { ...fitRow, size: smallSize(s, want), min: 2.8 }));
  const size = Math.min(...first.map((s) => s.size));
  const sets = items.map((s) => setWords(s, { ...fitRow, size, min: size }));
  const listW = dot + gapX + Math.max(...sets.map((s) => s.width));
  // The whole group, heading and list, centred across the frame.
  const groupW = beside ? (head.lines ? head.width + gutter : 0) + listW : Math.max(head.width, listW);
  const x0 = (W - Math.min(groupW, W - 2 * margin)) / 2;
  const listX = beside && head.lines ? x0 + head.width + gutter : x0;
  const textMax = r3(W - margin - (listX + dot + gapX));
  // Boxes as wide as the room they were set for, and never past the frame's margin.
  const headMax = r3(beside ? 58 : W - margin - x0);
  const [headY, listY] = beside ? [-1, -1] : stack([headH, n * pitch], [headGap], -1);
  const rowY = (i: number) => r3(listY - (n * pitch) / 2 + pitch * (i + 0.5));
  const dotX = r3(listX + dot / 2 - W / 2);
  const ink = inkOn(c, c.palette.accent);

  const step = 0.7;
  const t = (i: number) => 0.65 + i * step;
  const clock = clockOf(c, t(n - 1) + 0.85);

  const bands: Layer[] = [];
  const links: Layer[] = [];
  const dots: Layer[] = [];
  const pings: Layer[] = [];
  const numbers: Layer[] = [];
  const texts: Layer[] = [];
  for (let i = 0; i < n; i++) {
    const at = clock.at(t(i));
    const yy = rowY(i);
    const band = within(c, at - 0.02, i < n - 1 ? clock.at(t(i + 1)) + clock.d(0.35) : at + clock.d(1.25));
    bands.push(c.shape(`band-${i + 1}`, {
      name: `Step ${i + 1} highlight`, shape: 'rect', w: r3(listW + 5), h: r3(pitch * 0.86), radius: 1.6, fill: 'accent', opacity: 0.13,
      x: r3(listX + listW / 2 - W / 2), y: yy, ...band,
      in: c.enter('wipe', { dir: 'start', d: clock.d(0.5) }), out: c.leave('fade', { d: clock.d(0.4), ease: E.soft }),
    }));
    if (i > 0) {
      links.push(c.shape(`line-${i}`, {
        name: `Line to step ${i + 1}`, shape: 'rect', w: 0.4, h: r3(Math.max(0.4, pitch - dot - 1.8)), radius: 0.2, fill: 'accent',
        opacity: 0.55, x: dotX, y: r3(yy - pitch / 2),
        in: c.enter('grow', { dir: 'down', d: clock.d(0.32), delay: r3(Math.max(0, at - clock.d(0.3))), ease: E.soft }),
        out: c.leave('grow', { dir: 'down', d: 0.35 }),
      }));
    }
    dots.push(c.shape(`circle-${i + 1}`, {
      name: `Step ${i + 1} circle`, shape: 'ellipse', w: dot, h: dot, fill: 'accent', x: dotX, y: yy,
      shadow: { color: 'rgba(0,0,0,.3)', blur: 2, x: 0, y: 0.6 },
      in: c.enter('pop', { d: clock.d(0.5), delay: at, ease: E.pop }), out: c.leave('pop', { d: 0.4 }),
    }));
    const ping = within(c, at + clock.d(0.12), at + clock.d(0.12) + 0.7);
    pings.push(c.shape(`ripple-${i + 1}`, {
      name: `Step ${i + 1} ripple`, shape: 'ellipse', w: dot, h: dot, fill: null, stroke: { color: 'accent', width: 0.35, cap: 'round' },
      x: dotX, y: yy, ...ping,
      in: c.enter('fade', { d: 0.05, ease: 'linear' }), out: c.leave('zoom', { d: 0.62, amount: 1.6, ease: 'in' }),
    }));
    numbers.push(c.counter(`number-${i + 1}`, {
      name: `Step ${i + 1} number`, from: i + 1, to: i + 1, decimals: 0, group: false, voice: 'sans', size: r3(dot * 0.48), weight: 700,
      color: ink, align: 'center', x: dotX, y: yy, count: { d: 0.05, delay: 0, ease: 'linear' },
      in: c.enter('pop', { d: clock.d(0.5), delay: r3(at + clock.at(0.05)), ease: E.pop }), out: c.leave('pop', { d: 0.4 }),
    }));
    texts.push(c.text(`step-${i + 1}`, {
      name: `Step ${i + 1}`, text: sets[i].text, voice: 'sans', weight: 500, size: sets[i].size, lead: textLead, color: 'fg',
      align: 'start', max: textMax, fit: true, x: r3(listX + dot + gapX + textMax / 2 - W / 2), y: yy,
      in: c.enter('slide', { dir: 'start', amount: 0.55, d: clock.d(0.75), delay: r3(at + clock.at(0.1)) }),
      out: c.leave('slide', { dir: 'start', amount: 0.55 }),
    }));
  }
  const layers: Layer[] = [...bands, ...links, ...dots, ...pings, ...numbers, ...texts];
  if (head.lines) {
    layers.push(c.text('title', {
      name: 'Title', text: head.text, voice: 'bold', weight: 800, size: head.size, lead: headLead, color: 'fg',
      align: 'start', max: headMax, fit: true, x: r3(x0 + headMax / 2 - W / 2), y: r3(headY),
      in: c.enter('rise', { d: clock.d(0.7), delay: clock.at(0.1) }), out: c.leave('rise'),
    }));
  }
  return layers;
}

// ── loop background ───────────────────────────────────────────────────────

interface LoopLook {
  colors: string[];
  density: number;
  /** The particles that suit the style, and how many and how bright. */
  particles: Particles;
  count: number;
  size: number;
  speed: number;
  opacity: number;
}

/**
 * Each style with the particles that belong in it: stars over the aurora's
 * night sky, bubbles rising through the waves, embers in the rays, glints
 * over the grid, the halftone and the bokeh, dust drifting across the
 * stripes — few and faint, so the ground stays calm enough to put words on.
 */
const LOOKS: Record<Backdrop, LoopLook> = {
  aurora: { colors: ['accent', 'accent2', 'muted'], density: 0.6, particles: 'stars', count: 30, size: 0.9, speed: 1, opacity: 0.7 },
  grid: { colors: ['fg', 'accent'], density: 0.45, particles: 'stars', count: 16, size: 0.8, speed: 1, opacity: 0.55 },
  dots: { colors: ['fg', 'accent'], density: 0.5, particles: 'stars', count: 16, size: 0.8, speed: 1, opacity: 0.65 },
  rays: { colors: ['accent', 'fg'], density: 0.5, particles: 'sparks', count: 26, size: 0.8, speed: 0.5, opacity: 0.6 },
  waves: { colors: ['accent', 'accent2', 'muted'], density: 0.6, particles: 'bubbles', count: 18, size: 1.3, speed: 0.6, opacity: 0.5 },
  bokeh: { colors: ['accent', 'accent2', 'fg'], density: 0.55, particles: 'stars', count: 22, size: 0.7, speed: 1, opacity: 0.6 },
  stripes: { colors: ['fg', 'accent'], density: 0.5, particles: 'snow', count: 28, size: 1.1, speed: 0.6, opacity: 0.6 },
};

/**
 * Loop background. One moving backdrop, full frame, and a faint layer of
 * particles that suits it — no words. Both repeat a whole number of times in
 * the graphic's length (motionbackdrop.ts), and neither fades in or out, so
 * the last frame runs into the first and the export loops without a seam.
 */
function loopBg(c: Kit): Layer[] {
  const raw = c.fields.style ?? '';
  const style: Backdrop = (BACKDROPS as readonly string[]).includes(raw) ? (raw as Backdrop) : 'aurora';
  const look = LOOKS[style];
  return [
    c.backdrop('background', { name: 'Background', style, colors: look.colors, density: look.density, speed: 1 }),
    c.particles('particles', {
      name: 'Particles', style: look.particles, count: look.count, size: look.size, speed: look.speed, spread: 0, burst: false,
      opacity: look.opacity,
    }),
  ];
}

// ── the words each starts with ────────────────────────────────────────────

/** The steps a list starts from in each language; also what a list with no step left in it falls back to. */
const STEP_SAMPLES: Record<Lang, string> = {
  en: 'Create your account\nPick a template\nAdd your words\nExport and share',
  ar: 'أنشئ حسابك\nاختر قالباً\nأضف كلماتك\nصدّر وشارك',
  ckb: 'هەژمارەکەت دروست بکە\nقاڵبێک هەڵبژێرە\nوشەکانت زیاد بکە\nهەناردە بکە و بڵاوی بکەرەوە',
  kmr: 'هەژمارا خۆ چێبکە\nقالبەکێ هەلبژێرە\nپەیڤێن خۆ زێدە بکە\nهەناردە بکە و بەلاڤ بکە',
};

export const TITLE_RECIPES: Partial<Record<RecipeId, Recipe>> = {
  'big-title': {
    build: bigTitle,
    sample: {
      en: { kicker: 'New season', title: 'Ideas that move people forward', subtitle: 'The stories, tools and people shaping what comes next' },
      ar: { kicker: 'موسم جديد', title: 'أفكار تدفع الناس إلى الأمام', subtitle: 'القصص والأدوات والأشخاص الذين يصنعون ما هو قادم' },
      ckb: { kicker: 'وەرزی نوێ', title: 'بیرۆکەگەلێک کە خەڵک بەرەو پێش دەبەن', subtitle: 'ئەو چیرۆک و ئامراز و کەسانەی داهاتوو دروست دەکەن' },
      kmr: { kicker: 'وەرزێ نوو', title: 'ئەندێشەیێن خەلکی دبەنە پێشڤە', subtitle: 'ئەو چیرۆک و ئامراز و کەسێن پاشەڕۆژێ چێدکەن' },
    },
  },
  kinetic: {
    build: kinetic,
    sample: {
      en: { title: 'Start small, dream big', highlight: 'big' },
      ar: { title: 'ابدأ صغيراً واحلم كبيراً', highlight: 'كبيراً' },
      ckb: { title: 'بچووک دەست پێبکە، گەورە خەون ببینە', highlight: 'گەورە' },
      kmr: { title: 'ب بچویکی دەست پێبکە، خەونێن مەزن ببینە', highlight: 'مەزن' },
    },
  },
  'split-title': {
    build: splitTitle,
    sample: {
      en: { title: 'The future starts here', subtitle: 'Small teams, big ideas, real change' },
      ar: { title: 'المستقبل يبدأ هنا', subtitle: 'فرق صغيرة وأفكار كبيرة وتغيير حقيقي' },
      ckb: { title: 'داهاتوو لێرەوە دەست پێدەکات', subtitle: 'تیمی بچووک، بیرۆکەی گەورە، گۆڕانی ڕاستەقینە' },
      kmr: { title: 'پاشەڕۆژ ژ ڤێرە دەست پێدکەت', subtitle: 'تیمێن بچویک، ئەندێشەیێن مەزن، گوهۆڕینا ڕاستەقینە' },
    },
  },
  quote: {
    build: quote,
    sample: {
      en: { quote: 'The best tools disappear. What remains is the work you made with them.', author: 'Maya Collins', role: 'Head of Product' },
      ar: { quote: 'أفضل الأدوات تختفي، ويبقى العمل الذي صنعته بها.', author: 'ليلى حسن', role: 'مديرة المنتج' },
      ckb: { quote: 'باشترین ئامرازەکان ون دەبن، و ئەو کارەی پێیان کردووتە دەمێنێتەوە.', author: 'ژیلا ئەحمەد', role: 'بەڕێوەبەری بەرهەم' },
      kmr: { quote: 'باشترین ئامراز بەرزە دبن، و ئەو کارێ تە پێ کری دمینیت.', author: 'ژیلا ئەحمەد', role: 'بڕێڤەبەرا بەرهەمی' },
    },
  },
  steps: {
    build: steps,
    sample: {
      en: { title: 'Get started in four steps', items: STEP_SAMPLES.en },
      ar: { title: 'ابدأ في أربع خطوات', items: STEP_SAMPLES.ar },
      ckb: { title: 'بە چوار هەنگاو دەست پێبکە', items: STEP_SAMPLES.ckb },
      kmr: { title: 'ب چار پێنگاڤان دەست پێبکە', items: STEP_SAMPLES.kmr },
    },
  },
  'loop-bg': {
    build: loopBg,
    sample: {
      en: { style: 'aurora' },
      ar: { style: 'aurora' },
      ckb: { style: 'aurora' },
      kmr: { style: 'aurora' },
    },
  },
};
