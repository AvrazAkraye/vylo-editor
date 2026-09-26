/**
 * Originality: how much of a text is somebody else's words, and whether the
 * text is honest about where its words and claims come from.
 *
 * A thesis committee in Erbil or Baghdad runs every submission through a
 * plagiarism checker, and a researcher who used the app wants to know what
 * that checker will say before it says it. Two things can go wrong. A part
 * written from a source's abstract can lean on its wording more than anyone
 * intended; and parts written at the same time by parallel writers can repeat
 * each other, which a committee reads as padding at best. This file finds
 * both, and it finds them the same way every time, on this machine, with no
 * model in the loop — a score that changed between two runs over the same
 * text would be a score nobody could defend.
 *
 * ## What is compared with what
 *
 * The panel hands over the checked text as pieces (the written parts of a
 * document, or one pasted text) and the texts to compare it with as refs: the
 * document's sources, the researcher's data files, other documents, papers of
 * researchers they saved, texts they pasted, and whatever the panel found
 * online. Fetching is the panel's business; this file only reads what it is
 * given.
 *
 * ## How: shingles, and runs grown from them
 *
 * Every text is cut into words, each word folded (`normalise`) so that the
 * spellings Arabic and Kurdish keyboards disagree about — ی and ي, ک and ك,
 * ە and ه, أ and ا, harakat or none — are one word. Words become integers,
 * and every five consecutive words (a shingle) become one hashed number. A
 * shingle a piece shares with a ref is the seed of a match; the match is
 * grown word by word in both directions for as long as the two texts agree,
 * and runs separated by a word or three that were changed are joined again,
 * because changing one word in twenty is not writing it yourself.
 *
 * Integers and typed arrays rather than strings, because the check has to
 * be fast on a real thesis — 150,000 words against the few million words of
 * everything it cites — and a string per shingle would be tens of millions of
 * strings. The refs are read once, and only the shingles the pieces also
 * contain are kept at all.
 *
 * ## Quoted and cited words
 *
 * A passage in quotation marks with its source cited is not plagiarism; it is
 * scholarship. Every match says whether it is quoted and whether its source is
 * cited in the same paragraph, and the options decide whether those count
 * toward the score. They are always listed — the researcher decides, not the
 * score.
 *
 * ## Integrity
 *
 * `integrity` reads a document for the other half of honesty: claims and
 * figures with no citation, long quotations with none, sources listed and
 * never cited, a reference list leaning on one work, a retracted work cited,
 * long parts that cite nothing, and the gaps left for the researcher.
 *
 * Pure: no DOM, no React, nothing written anywhere.
 */

import type { Doc, Section } from './research';
import { citable, kindOf } from './research';
import { blocksOf, markersIn, wordCount, type Run } from './prose';

// ── the shapes ────────────────────────────────────────────────────────────

/** A text the checked text is compared with. */
export interface Ref {
  id: string;
  kind: 'source' | 'data' | 'sample' | 'document' | 'pasted' | 'online';
  /** Shown to the researcher: a source's title, a file's name, another document's title. */
  label: string;
  text: string;
  /** For a source of the document: its marker key ("s3"), so a match can say whether it is cited there. */
  key?: string;
}

/** A piece of the checked text — a part of a document, its abstract, or one pasted text. */
export interface Piece { id: string; heading: string; text: string }

export interface Match {
  /** Piece id. */
  piece: string;
  /** UTF-16 offsets into that piece's ORIGINAL text (not normalised). */
  start: number;
  end: number;
  /** Words in the matched run. */
  words: number;
  /** Ref id. */
  ref: string;
  /** Offsets into the ref's original text. */
  refStart: number;
  refEnd: number;
  /** A source match whose key is cited in the same paragraph of the piece. False for non-source refs. */
  cited: boolean;
  /** The matched run lies inside quotation marks: « » “ ” " " ‹ › „ (either whole or mostly — ≥ 80% of its words). */
  quoted: boolean;
}

/** A passage that appears twice inside the checked text itself (parallel writers repeat each other). */
export interface Repeat {
  a: { piece: string; start: number; end: number };
  b: { piece: string; start: number; end: number };
  words: number;
}

export interface Options {
  /** Words per shingle. Default 5. */
  shingle?: number;
  /** Shortest match reported, in words. Default 8. */
  minWords?: number;
  /** Quoted matches do not count toward the score (they are still listed). Default true. */
  skipQuoted?: boolean;
  /** Matches to a source cited in the same paragraph do not count toward the score. Default false. */
  skipCited?: boolean;
  /** Shortest repeat reported, in words. Default 12. */
  repeatWords?: number;
}

export interface Report {
  /** Words checked (all pieces). */
  words: number;
  /** Words covered by COUNTED matches, each word once however many refs match it. */
  matchedWords: number;
  /** matchedWords / words * 100, rounded to 1 decimal; 0 when words is 0. */
  score: number;
  /** Counted words per ref, most first, refs with none left out. */
  byRef: { ref: string; words: number; score: number }[];
  /** Every piece, in piece order. */
  byPiece: { piece: string; words: number; matchedWords: number; score: number }[];
  /** ALL matches, counted or not, in piece order and then by start. */
  matches: Match[];
  repeats: Repeat[];
}

export const DEFAULTS: Required<Options> = {
  shingle: 5,
  minWords: 8,
  skipQuoted: true,
  skipCited: false,
  repeatWords: 12,
};

/**
 * The most places one shingle is remembered in the refs. A ref that repeats a
 * stock phrase — "وفي هذا الصدد تجدر الإشارة إلى" in every chapter of a long
 * thesis — would otherwise make every occurrence of it in the piece try every
 * occurrence in the ref. The first ones are kept: a match is a match wherever
 * in the ref it is, and growing a run from any of them finds it.
 */
const CANDIDATES = 64;

/**
 * Runs of the same piece and ref this close together on both sides are one
 * match: a changed word, an inserted و, a synonym swapped in. Light
 * paraphrase is still the other writer's sentence.
 */
const JOIN_GAP = 3;

/** The longest bracket read as a citation marker, as prose.ts reads them. */
const MARKER_MAX = 200;

// ── normalising ───────────────────────────────────────────────────────────

/**
 * What disappears before comparing: tatweel, the harakat and the dagger alef,
 * Quranic annotation marks, the soft hyphen, and every zero-width or
 * direction mark. None of them changes which word it is, and a copied text
 * with its harakat stripped (or added) is still copied.
 */
const STRIP = /[\u00AD\u061C\u0640\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Letters written differently for the same word, and the one each becomes.
 *
 * One spelling per family, whichever keyboard typed it: the alef forms are
 * bare alef; Kurdish ی, alef maqsura and Arabic ي are ي; Kurdish ک and ڪ are
 * Arabic ك; Kurdish ە, teh marbuta, heh doachashmee ھ and the heh-with-yeh
 * forms are ه. Eastern Arabic and Persian digits are ASCII digits, and the
 * Arabic decimal and thousands separators and per-cent sign their ASCII ones,
 * so ٣٫٥ and 3.5 are the same number.
 *
 * The letters only Kurdish has — ڕ ڵ ێ ۆ ڤ — are left alone: they are
 * different letters, not different spellings.
 *
 * Escapes rather than the letters, because two of each family are one pixel
 * apart in most fonts.
 */
const SAME = new Map<string, string>([
  ['\u0622', '\u0627'], ['\u0623', '\u0627'], ['\u0625', '\u0627'], ['\u0671', '\u0627'], ['\u0672', '\u0627'], ['\u0673', '\u0627'],
  ['\u0649', '\u064A'], ['\u06CC', '\u064A'],
  ['\u06A9', '\u0643'], ['\u06AA', '\u0643'],
  ['\u0629', '\u0647'], ['\u06D5', '\u0647'], ['\u06BE', '\u0647'], ['\u06C0', '\u0647'], ['\u06C1', '\u0647'], ['\u06C2', '\u0647'], ['\u06C3', '\u0647'],
  ['\u066B', '.'], ['\u066C', ','], ['\u066A', '%'],
  ...Array.from({ length: 10 }, (_, d) => [String.fromCharCode(0x0660 + d), String(d)] as [string, string]),
  ...Array.from({ length: 10 }, (_, d) => [String.fromCharCode(0x06F0 + d), String(d)] as [string, string]),
]);

const SAME_RE = new RegExp(`[${[...SAME.keys()].join('')}]`, 'g');

/**
 * Text as it is compared: NFKC (which also turns Arabic presentation forms
 * and ligatures back into letters), marks and invisible characters gone, each
 * family of look-alike letters one letter, digits ASCII, lower-case.
 */
export function normalise(text: string): string {
  if (typeof text !== 'string' || !text) return '';
  return text.normalize('NFKC').replace(STRIP, '').replace(SAME_RE, (c) => SAME.get(c) ?? c).toLowerCase();
}

// ── words ─────────────────────────────────────────────────────────────────

/** A letter, a mark, a digit, or a zero-width joiner or non-joiner inside a Kurdish or Persian word. */
const WORD_CHAR = /[\p{L}\p{M}\p{N}\u200C\u200D]/u;

/** A normalised word has to have a letter or a digit left in it: tatweel alone is not a word. */
const HAS_WORD = /[\p{L}\p{N}]/u;

/**
 * Which UTF-16 units are word characters, worked out the first time each is
 * seen: 0 not yet known, 1 a word character, 2 not. A Unicode property test
 * per character over three million words is the slowest thing the check
 * could do; a table lookup is the fastest. Surrogates are never word
 * characters, which makes emoji punctuation — the scripts a thesis here is
 * written in are all in the first plane.
 */
const CLASS = new Uint8Array(65536);

function wordUnit(c: number): boolean {
  let k = CLASS[c];
  if (k === 0) {
    k = c >= 0xD800 && c <= 0xDFFF ? 2 : WORD_CHAR.test(String.fromCharCode(c)) ? 1 : 2;
    CLASS[c] = k;
  }
  return k === 1;
}

function isDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 0x0660 && c <= 0x0669) || (c >= 0x06F0 && c <= 0x06F9);
}

/** An ordered list's number at the start of a line — "1. ", "٣) " — which is layout, not a word. */
const ORDERED = /[ \t]*[0-9\u0660-\u0669\u06F0-\u06F9]{1,3}[.)][ \t]/y;

/**
 * Where a citation marker starting at `i` (a `[`) ends, or -1 when it is not
 * one. `[@s3]`, `[ @s3; @s7]`, `[@s2, المادة ١٣/ثانياً]`: the locator is
 * words, but they are the app's words, not the writer's, and a match through
 * them would be the app matching itself.
 */
function markerEnd(text: string, i: number): number {
  let j = i + 1;
  while (j < text.length && text.charCodeAt(j) === 32) j++;
  if (text.charCodeAt(j) !== 64) return -1;
  const stop = Math.min(text.length, i + MARKER_MAX);
  for (let k = j + 1; k < stop; k++) {
    const c = text.charCodeAt(k);
    if (c === 93) return k + 1;
    if (c === 91 || c === 10) return -1;
  }
  return -1;
}

/** Word ids: a token dropped because nothing of it is left once normalised, and a ref's word the pieces never use. */
const DROP = -1;
const UNKNOWN = -2;

/**
 * Words as integers. Every raw spelling is normalised once — a thesis says
 * "الدراسة" a thousand times and it is folded the first time — and every
 * normalised word gets one number.
 *
 * Once the pieces are read the vocabulary is `closed`: a ref's word the
 * pieces never use cannot be part of a match, so it is UNKNOWN rather than a
 * new number, and the vocabulary does not grow with three million words of
 * sources. UNKNOWN still takes its place in the ref, so two words either side
 * of it are not mistaken for neighbours.
 */
interface Vocab {
  raw: Map<string, number>;
  norm: Map<string, number>;
  list: string[];
  closed: boolean;
}

function newVocab(): Vocab {
  return { raw: new Map(), norm: new Map(), list: [], closed: false };
}

function idOf(v: Vocab, raw: string): number {
  let id = v.raw.get(raw);
  if (id !== undefined) return id;
  const norm = normalise(raw);
  if (!HAS_WORD.test(norm)) id = DROP;
  else {
    id = v.norm.get(norm);
    if (id === undefined) {
      if (v.closed) id = UNKNOWN;
      else {
        id = v.list.length;
        v.list.push(norm);
        v.norm.set(norm, id);
      }
    }
  }
  v.raw.set(raw, id);
  return id;
}

/** A text's words: ids and original offsets, `n` of them. */
interface Toks {
  ids: Int32Array;
  starts: Int32Array;
  ends: Int32Array;
  n: number;
}

/**
 * The words of a text, in one pass over its characters.
 *
 * A word is a run of letters, marks and digits (and the zero-width joiners
 * Kurdish writes inside words), with an apostrophe inside it ("master's") or
 * a decimal point or thousands separator between digits (3.5, ٣٫٥, 1,000)
 * kept in it. Citation markers are skipped whole, and so is an ordered list's
 * number at the start of a line; everything else that is not a word
 * character — heading hashes, bullets, table pipes, the brackets of a gap,
 * punctuation — simply is not part of any word. A gap's words are words: the
 * researcher will replace them, but until then they are in the text.
 */
function scan(text: string, v: Vocab): Toks {
  const len = text.length;
  let cap = Math.max(16, len >> 3);
  let ids = new Int32Array(cap);
  let starts = new Int32Array(cap);
  let ends = new Int32Array(cap);
  let n = 0;
  let i = 0;
  ORDERED.lastIndex = 0;
  if (ORDERED.test(text)) i = ORDERED.lastIndex;
  while (i < len) {
    const c = text.charCodeAt(i);
    if (c === 10) {
      i++;
      ORDERED.lastIndex = i;
      if (ORDERED.test(text)) i = ORDERED.lastIndex;
      continue;
    }
    if (c === 91) {
      const e = markerEnd(text, i);
      i = e > 0 ? e : i + 1;
      continue;
    }
    if (!wordUnit(c)) {
      i++;
      continue;
    }
    const s = i++;
    while (i < len) {
      const d = text.charCodeAt(i);
      if (wordUnit(d)) {
        i++;
        continue;
      }
      if (i + 1 < len) {
        const e = text.charCodeAt(i + 1);
        if ((d === 39 || d === 0x2019) && wordUnit(e) && !isDigit(e)) {
          i += 2;
          continue;
        }
        if ((d === 46 || d === 44 || d === 0x066B || d === 0x066C) && isDigit(text.charCodeAt(i - 1)) && isDigit(e)) {
          i += 2;
          continue;
        }
      }
      break;
    }
    const id = idOf(v, text.slice(s, i));
    if (id === DROP) continue;
    if (n === cap) {
      cap *= 2;
      const grow = (a: Int32Array) => {
        const b = new Int32Array(cap);
        b.set(a);
        return b;
      };
      ids = grow(ids);
      starts = grow(starts);
      ends = grow(ends);
    }
    ids[n] = id;
    starts[n] = s;
    ends[n] = i;
    n++;
  }
  return { ids, starts, ends, n };
}

/**
 * The words of a text with their ORIGINAL offsets, each normalised; citation
 * markers, gap brackets, heading hashes, list markers and punctuation are not
 * words, and a word must contain a letter or a digit.
 */
export function tokens(text: string): { word: string; start: number; end: number }[] {
  const v = newVocab();
  const t = scan(typeof text === 'string' ? text : '', v);
  const out: { word: string; start: number; end: number }[] = [];
  for (let i = 0; i < t.n; i++) out.push({ word: v.list[t.ids[i]], start: t.starts[i], end: t.ends[i] });
  return out;
}

/**
 * A shingle's number: FNV-1a over the word ids, folded to 30 bits so it stays
 * a small integer to the engine (a Map keyed by small integers is several
 * times faster than one keyed by doubles). Collisions happen and do not
 * matter: every hit is checked word by word before it counts.
 */
function hashAt(ids: Int32Array, p: number, k: number): number {
  let h = 0x811C9DC5 | 0;
  for (let t = 0; t < k; t++) h = Math.imul(h ^ ids[p + t], 0x01000193);
  return (h ^ (h >>> 15)) & 0x3FFFFFFF;
}

// ── quotations and paragraphs ─────────────────────────────────────────────

/**
 * The quotation marks, and what closes each. Arabic writes «…», English “…”
 * and "…", German „…“; somebody typing right to left on a keyboard that
 * mirrors them writes »…«, so a closing mark with nothing open opens a
 * quotation closed by its mirror.
 */
const CLOSES: Readonly<Record<string, string>> = {
  '«': '»', '»': '«',
  '“': '”', '”': '”“',
  '„': '“”',
  '‹': '›', '›': '‹',
  '"': '"',
};

/**
 * The quotations of a text: the outermost ones that close, as [open, close + 1)
 * ranges covering the marks themselves. A quotation that is still open at
 * the end of its paragraph was not one — an inch sign, a stray mark — and a
 * blank line closes everything.
 */
function quotesOf(text: string): [number, number][] {
  const out: [number, number][] = [];
  const stack: { at: number; closers: string }[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' && /^[ \t]*\n/.test(text.slice(i + 1, i + 40))) {
      stack.length = 0;
      continue;
    }
    const top = stack[stack.length - 1];
    if (top && top.closers.includes(ch)) {
      stack.pop();
      if (!stack.length) out.push([top.at, i + 1]);
      continue;
    }
    const closers = CLOSES[ch];
    if (closers && stack.length < 8) stack.push({ at: i, closers });
  }
  return out;
}

/** Paragraphs: the text between blank lines, as [start, end) ranges covering all of it. */
function paragraphsOf(text: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /\n[ \t]*\n/g;
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push([from, m.index]);
    from = m.index + m[0].length;
  }
  out.push([from, text.length]);
  return out;
}

/** Which of `ranges` (sorted, non-overlapping, covering) holds `at`. */
function rangeAt(ranges: readonly [number, number][], at: number): number {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ranges[mid][0] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ── the check ─────────────────────────────────────────────────────────────

/** The options, with anything missing or mistyped brought back to the defaults. */
function settle(o: Options | undefined): Required<Options> {
  const int = (v: unknown, d: number, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : d;
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    shingle: int(o?.shingle, DEFAULTS.shingle, 2, 25),
    minWords: int(o?.minWords, DEFAULTS.minWords, 1, 1_000_000),
    skipQuoted: bool(o?.skipQuoted, DEFAULTS.skipQuoted),
    skipCited: bool(o?.skipCited, DEFAULTS.skipCited),
    repeatWords: int(o?.repeatWords, DEFAULTS.repeatWords, 1, 1_000_000),
  };
}

/** A percentage to one decimal. */
function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** A run of equal words: [ps, pe) in the piece and [rs, re) in the ref, as token indexes. */
interface Span { piece: number; ref: number; ps: number; pe: number; rs: number; re: number }

/**
 * Runs of one piece and one ref, in piece order, joined where the gap
 * between them is at most JOIN_GAP words on both sides and the ref goes on in
 * the same direction.
 */
function joinSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && last.piece === s.piece && last.ref === s.ref
      && s.ps >= last.pe && s.ps - last.pe <= JOIN_GAP
      && s.rs >= last.re && s.rs - last.re <= JOIN_GAP) {
      last.pe = s.pe;
      last.re = s.re;
    } else out.push({ ...s });
  }
  return out;
}

/**
 * Compare the pieces with every ref.
 *
 * The pieces are read first and their shingles remembered; each ref is then
 * read once, and only its positions whose shingle a piece also has are
 * indexed. Each piece is walked word by word: where its shingle is in the
 * index, a run is grown from every candidate position, the longest per ref
 * is kept, and that ref is not looked at again until the run is past. Other
 * refs matching the same words are found at the same place, because the same
 * sentence copied from two sources is two findings — the score still counts
 * each word once.
 */
export function check(pieces: Piece[], refs: Ref[], o?: Options): Report {
  const opt = settle(o);
  const k = opt.shingle;
  const vocab = newVocab();
  const pt = pieces.map((p) => scan(typeof p.text === 'string' ? p.text : '', vocab));
  vocab.closed = true;

  const wanted = new Set<number>();
  for (const t of pt) for (let i = 0; i + k <= t.n; i++) wanted.add(hashAt(t.ids, i, k));

  const rt: Toks[] = [];
  const index = new Map<number, number[]>();
  for (let r = 0; r < refs.length; r++) {
    const t = scan(typeof refs[r].text === 'string' ? refs[r].text : '', vocab);
    rt.push(t);
    if (!wanted.size) continue;
    // Only windows of k known words can match; count how many known words end here.
    let known = 0;
    for (let q = 0; q < t.n; q++) {
      if (t.ids[q] < 0) {
        known = 0;
        continue;
      }
      if (++known < k) continue;
      const p = q - k + 1;
      const h = hashAt(t.ids, p, k);
      if (!wanted.has(h)) continue;
      let list = index.get(h);
      if (!list) index.set(h, (list = []));
      if (list.length < CANDIDATES * 2) list.push(r, p);
    }
  }

  // Grow runs.
  const found: Span[] = [];
  const nextFree = new Int32Array(refs.length);
  const bestLen = new Int32Array(refs.length);
  const bestPs = new Int32Array(refs.length);
  const bestRs = new Int32Array(refs.length);
  const touched: number[] = [];
  if (index.size) {
    for (let x = 0; x < pt.length; x++) {
      const t = pt[x];
      const ids = t.ids;
      nextFree.fill(0);
      for (let i = 0; i + k <= t.n; i++) {
        const list = index.get(hashAt(ids, i, k));
        if (!list) continue;
        touched.length = 0;
        for (let c = 0; c < list.length; c += 2) {
          const r = list[c];
          const p = list[c + 1];
          if (i < nextFree[r]) continue;
          const rids = rt[r].ids;
          const rn = rt[r].n;
          let len = 0;
          while (i + len < t.n && p + len < rn && ids[i + len] === rids[p + len]) len++;
          if (len < k) continue;
          let back = 0;
          while (i - back - 1 >= nextFree[r] && p - back - 1 >= 0 && ids[i - back - 1] === rids[p - back - 1]) back++;
          if (bestLen[r] === 0) touched.push(r);
          if (len + back > bestLen[r]) {
            bestLen[r] = len + back;
            bestPs[r] = i - back;
            bestRs[r] = p - back;
          }
        }
        for (const r of touched) {
          const ps = bestPs[r];
          const pe = ps + bestLen[r];
          found.push({ piece: x, ref: r, ps, pe, rs: bestRs[r], re: bestRs[r] + bestLen[r] });
          nextFree[r] = pe;
          bestLen[r] = 0;
        }
      }
    }
  }

  found.sort((a, b) => a.piece - b.piece || a.ref - b.ref || a.ps - b.ps);
  const spans = joinSpans(found).filter((s) => s.pe - s.ps >= opt.minWords);
  spans.sort((a, b) => a.piece - b.piece || a.ps - b.ps || a.ref - b.ref);

  // Quotations and paragraphs of the pieces that have matches, read once each.
  const quotedTok = new Map<number, Uint8Array>();
  const paraOf = new Map<number, { ranges: [number, number][]; keys: (string[] | undefined)[] }>();
  const quotedIn = (x: number): Uint8Array => {
    let q = quotedTok.get(x);
    if (!q) {
      const t = pt[x];
      q = new Uint8Array(t.n);
      const quotes = quotesOf(pieces[x].text);
      let s = 0;
      for (let i = 0; i < t.n && s < quotes.length; i++) {
        while (s < quotes.length && quotes[s][1] <= t.starts[i]) s++;
        if (s < quotes.length && quotes[s][0] <= t.starts[i]) q[i] = 1;
      }
      quotedTok.set(x, q);
    }
    return q;
  };
  const citedIn = (x: number, at: number, key: string): boolean => {
    let p = paraOf.get(x);
    if (!p) {
      const ranges = paragraphsOf(pieces[x].text);
      p = { ranges, keys: new Array(ranges.length) };
      paraOf.set(x, p);
    }
    const which = rangeAt(p.ranges, at);
    let keys = p.keys[which];
    if (!keys) {
      const [a, b] = p.ranges[which];
      keys = markersIn(pieces[x].text.slice(a, b));
      p.keys[which] = keys;
    }
    return keys.includes(key);
  };

  const covered = pt.map((t) => new Uint8Array(t.n));
  const refWords = new Float64Array(refs.length);
  const matches: Match[] = [];
  for (const s of spans) {
    const t = pt[s.piece];
    const r = rt[s.ref];
    const ref = refs[s.ref];
    const words = s.pe - s.ps;
    const q = quotedIn(s.piece);
    let inQuotes = 0;
    for (let i = s.ps; i < s.pe; i++) inQuotes += q[i];
    const quoted = inQuotes >= 0.8 * words;
    const cited = ref.kind === 'source' && !!ref.key && citedIn(s.piece, t.starts[s.ps], ref.key);
    matches.push({
      piece: pieces[s.piece].id,
      start: t.starts[s.ps],
      end: t.ends[s.pe - 1],
      words,
      ref: ref.id,
      refStart: r.starts[s.rs],
      refEnd: r.ends[s.re - 1],
      cited,
      quoted,
    });
    if ((opt.skipQuoted && quoted) || (opt.skipCited && cited)) continue;
    // One ref's runs in a piece never overlap, so its words are the sum.
    refWords[s.ref] += words;
    covered[s.piece].fill(1, s.ps, s.pe);
  }

  let total = 0;
  let matched = 0;
  const byPiece = pieces.map((p, x) => {
    let m = 0;
    for (const c of covered[x]) m += c;
    total += pt[x].n;
    matched += m;
    return { piece: p.id, words: pt[x].n, matchedWords: m, score: percent(m, pt[x].n) };
  });
  const byRef = refs
    .map((r, i) => ({ ref: r.id, words: refWords[i], score: percent(refWords[i], total), i }))
    .filter((r) => r.words > 0)
    .sort((a, b) => b.words - a.words || a.i - b.i)
    .map(({ ref, words, score }) => ({ ref, words, score }));

  return {
    words: total,
    matchedWords: matched,
    score: percent(matched, total),
    byRef,
    byPiece,
    matches,
    repeats: repeatsOf(pieces, pt, opt),
  };
}

/**
 * Passages the checked text says twice.
 *
 * All the pieces are laid end to end and indexed by shingle, never across a
 * piece's edge. Walking forwards, each position is compared with the earlier
 * positions that share its shingle, a run is grown from each for as long as
 * the words agree and the earlier copy has not run into the later one, and
 * the longest is kept. The later copy is then stepped over, so a pair is
 * reported once, earlier copy first.
 */
function repeatsOf(pieces: Piece[], pt: Toks[], opt: Required<Options>): Repeat[] {
  const k = opt.shingle;
  let total = 0;
  for (const t of pt) total += t.n;
  const ids = new Int32Array(total);
  const owner = new Int32Array(total);
  const first = new Int32Array(pt.length);
  const after = new Int32Array(pt.length);
  let at = 0;
  pt.forEach((t, x) => {
    first[x] = at;
    ids.set(t.ids.subarray(0, t.n), at);
    owner.fill(x, at, at + t.n);
    at += t.n;
    after[x] = at;
  });

  const index = new Map<number, number[]>();
  for (let i = 0; i + k <= total; i++) {
    if (owner[i] !== owner[i + k - 1]) continue;
    const h = hashAt(ids, i, k);
    let list = index.get(h);
    if (!list) index.set(h, (list = []));
    if (list.length < CANDIDATES) list.push(i);
  }

  const runs: { a: number; b: number; len: number }[] = [];
  for (let i = 0; i + k <= total;) {
    const list = owner[i] === owner[i + k - 1] ? index.get(hashAt(ids, i, k)) : undefined;
    let best = 0;
    let bestJ = -1;
    if (list) {
      const iEnd = after[owner[i]];
      for (const j of list) {
        if (j >= i) break;
        const jEnd = after[owner[j]];
        let len = 0;
        while (i + len < iEnd && j + len < jEnd && j + len < i && ids[i + len] === ids[j + len]) len++;
        if (len >= k && len > best) {
          best = len;
          bestJ = j;
        }
      }
    }
    if (best) {
      runs.push({ a: bestJ, b: i, len: best });
      i += best;
    } else i++;
  }

  // Join runs a changed word or three apart, as matches are joined.
  const joined: { a0: number; a1: number; b0: number; b1: number }[] = [];
  for (const r of runs) {
    const last = joined[joined.length - 1];
    if (last && owner[last.a0] === owner[r.a] && owner[last.b0] === owner[r.b]
      && r.b >= last.b1 && r.b - last.b1 <= JOIN_GAP
      && r.a >= last.a1 && r.a - last.a1 <= JOIN_GAP
      && r.a + r.len <= last.b0) {
      last.a1 = r.a + r.len;
      last.b1 = r.b + r.len;
    } else joined.push({ a0: r.a, a1: r.a + r.len, b0: r.b, b1: r.b + r.len });
  }

  const out: Repeat[] = [];
  for (const r of joined) {
    const words = Math.min(r.a1 - r.a0, r.b1 - r.b0);
    if (words < opt.repeatWords) continue;
    const xa = owner[r.a0];
    const xb = owner[r.b0];
    const ta = pt[xa];
    const tb = pt[xb];
    out.push({
      a: { piece: pieces[xa].id, start: ta.starts[r.a0 - first[xa]], end: ta.ends[r.a1 - 1 - first[xa]] },
      b: { piece: pieces[xb].id, start: tb.starts[r.b0 - first[xb]], end: tb.ends[r.b1 - 1 - first[xb]] },
      words,
    });
  }
  const order = new Map(pieces.map((p, i) => [p.id, i]));
  out.sort((x, y) => (order.get(x.a.piece) ?? 0) - (order.get(y.a.piece) ?? 0) || x.a.start - y.a.start
    || (order.get(x.b.piece) ?? 0) - (order.get(y.b.piece) ?? 0) || x.b.start - y.b.start);
  return out;
}

// ── what is checked, and against what ─────────────────────────────────────

/** A section with something written in it, finished. What the checks read. */
function written(s: Section): boolean {
  return s.state === 'done' && typeof s.text === 'string' && s.text.trim() !== '';
}

/**
 * A document's written text as pieces: every finished section with text,
 * then the abstract and the English abstract when they are not empty.
 */
export function piecesOf(doc: Doc): Piece[] {
  const out: Piece[] = doc.sections.filter(written).map((s) => ({ id: s.id, heading: s.heading, text: s.text }));
  if (doc.abstract?.trim()) out.push({ id: 'abstract', heading: 'Abstract', text: doc.abstract });
  if (doc.abstractEn?.trim()) out.push({ id: 'abstract-en', heading: 'Abstract (English)', text: doc.abstractEn });
  return out;
}

/** A pasted text as one piece. */
export function pieceOfText(text: string): Piece {
  return { id: 'text', heading: '', text: typeof text === 'string' ? text : '' };
}

/**
 * The refs a document is naturally compared with: the sources it may cite
 * that have an abstract — the abstract is the one text of a source the app
 * has, and the one a writer was handed — and the researcher's data files,
 * which a results chapter should report rather than copy. Samples and other
 * documents are the panel's to add.
 */
export function refsOf(doc: Doc): Ref[] {
  const out: Ref[] = [];
  for (const s of citable(doc.sources)) {
    if (!s.abstract?.trim()) continue;
    out.push({ id: `source:${s.key}`, kind: 'source', label: s.title, key: s.key, text: `${s.title}\n${s.abstract}` });
  }
  for (const f of doc.files ?? []) {
    if (!f.text?.trim()) continue;
    out.push({ id: `data:${f.id}`, kind: 'data', label: f.name, text: f.text });
  }
  return out;
}

/** Another document as a ref, for "compare with my other documents": its written sections, joined. */
export function refOfDoc(doc: Doc): Ref {
  return {
    id: `doc:${doc.id}`,
    kind: 'document',
    label: doc.meta?.title?.trim() || doc.request,
    text: doc.sections.filter(written).map((s) => s.text).join('\n\n'),
  };
}

// ── sentences ─────────────────────────────────────────────────────────────

/** A sentence of a text: its trimmed range, its text, the paragraph it is in and what kind of line holds it. */
export interface Sentence {
  start: number;
  end: number;
  text: string;
  /** Index of its paragraph (blank-line separated). */
  paragraph: number;
  line: 'text' | 'heading' | 'table';
}

/** What ends a sentence: the full stop, both question marks, the exclamation mark, the Arabic semicolon, an ellipsis. */
const TERMINATORS = new Set(['.', '؟', '?', '!', '؛', '…']);

/** What may follow the end of a sentence and still belong to it. */
const TRAILERS = new Set([')', ']', '»', '”', '"', '’', "'", '›', '«']);

/** Words a full stop follows without ending anything: titles and the abbreviations of references. */
const ABBREVIATIONS = new Set([
  'dr', 'prof', 'mr', 'mrs', 'ms', 'st', 'vs', 'cf', 'al', 'eg', 'ie', 'p', 'pp', 'vol', 'vols', 'fig', 'figs', 'ed',
  'eds', 'ch', 'chap', 'sec', 'para', 'cit', 'ibid', 'approx', 'jr', 'sr',
]);

/** The layout a line opens with — heading hashes, a quote's `>`, a bullet, a number. */
const LINE_LEAD = /^(?:[ \t]*(?:#{1,6}(?=[ \t])|>|[-*+•](?=[ \t])|[0-9\u0660-\u0669\u06F0-\u06F9]{1,3}[.)](?=[ \t])))*[ \t]*/;

const MARKER_AFTER = /^[ \t]*\[[ \t]*@[^[\]\n]{0,200}\]/;

/**
 * The sentences of a text, with their offsets.
 *
 * Sentences never cross a line: a heading, a list item and a table row are
 * each their own, and the model writes a paragraph as one line. A sentence
 * ends at . ؟ ? ! ؛ or …, and whatever closes it — a bracket, a quotation
 * mark, a citation marker written after the full stop — stays with it. A full
 * stop between digits (3.5) is a decimal point; one after a single letter or
 * a title (د. أحمد, Dr. Smith, pp. 12) is an abbreviation; one followed
 * straight by a letter (e.g., www.uod.ac) ends nothing. Markers and gaps are
 * stepped over whole, so the full stop in `[@s2, p. 4]` ends nothing either.
 */
export function sentencesOf(text: string): Sentence[] {
  const src = typeof text === 'string' ? text : '';
  const out: Sentence[] = [];
  let paragraph = 0;
  let blank = false;
  let lineStart = 0;
  while (lineStart <= src.length) {
    let lineEnd = src.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = src.length;
    const line = src.slice(lineStart, lineEnd);
    if (!line.trim()) {
      if (!blank && out.length) paragraph++;
      blank = true;
    } else {
      blank = false;
      const kind: Sentence['line'] = /^[ \t]{0,3}#/.test(line) ? 'heading' : /^[ \t]*\|/.test(line) ? 'table' : 'text';
      const push = (a: number, b: number) => {
        while (a < b && /\s/.test(src[a])) a++;
        while (b > a && /\s/.test(src[b - 1])) b--;
        if (b > a && HAS_WORD.test(src.slice(a, b))) out.push({ start: a, end: b, text: src.slice(a, b), paragraph, line: kind });
      };
      let s = lineStart + (LINE_LEAD.exec(line)?.[0].length ?? 0);
      for (let i = s; i < lineEnd; i++) {
        const ch = src[i];
        if (ch === '[') {
          if (src[i + 1] === '[') {
            const close = src.indexOf(']]', i + 2);
            if (close !== -1 && close < lineEnd) i = close + 1;
          } else {
            const e = markerEnd(src, i);
            if (e > 0) i = e - 1;
          }
          continue;
        }
        if (!TERMINATORS.has(ch)) continue;
        if (ch === '.') {
          const next = src[i + 1];
          if (isDigit(src.charCodeAt(i - 1)) && isDigit(src.charCodeAt(i + 1))) continue;
          if (next !== undefined && next !== '\n' && !/\s/.test(next) && !TERMINATORS.has(next) && !TRAILERS.has(next)) continue;
          const word = /[\p{L}]+$/u.exec(src.slice(Math.max(s, i - 12), i))?.[0] ?? '';
          const before = src[i - word.length - 1];
          const wordStarts = i - word.length === s || before === undefined || !/[\p{L}\p{N}]/u.test(before);
          if (word && wordStarts && (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase()))) continue;
        }
        let e = i + 1;
        while (e < lineEnd && (TERMINATORS.has(src[e]) || TRAILERS.has(src[e]))) e++;
        const m = MARKER_AFTER.exec(src.slice(e, Math.min(lineEnd, e + MARKER_MAX + 10)));
        if (m) {
          e += m[0].length;
          while (e < lineEnd && TERMINATORS.has(src[e])) e++;
        }
        push(s, e);
        s = e;
        i = e - 1;
      }
      push(s, lineEnd);
    }
    lineStart = lineEnd + 1;
  }
  return out;
}

// ── sentences worth looking up ────────────────────────────────────────────

/**
 * Words too common to say anything about a sentence, per language — enough
 * to tell a sentence of content from a sentence of glue, no more. Normalised
 * when the set is built, like the words they are compared with.
 */
const STOP = new Set([
  // Arabic
  'في', 'من', 'على', 'إلى', 'الى', 'عن', 'أن', 'ان', 'إن', 'أو', 'او', 'و', 'ثم', 'هذا', 'هذه', 'ذلك', 'تلك', 'التي', 'الذي',
  'الذين', 'اللذين', 'كما', 'قد', 'لقد', 'لا', 'ما', 'لم', 'لن', 'هو', 'هي', 'هم', 'هن', 'كان', 'كانت', 'يكون', 'تكون',
  'بين', 'كل', 'مع', 'عند', 'بعد', 'قبل', 'حيث', 'إذا', 'اذا', 'غير', 'أي', 'اي', 'أيضا', 'ايضا', 'هناك', 'وقد', 'وفي',
  'ومن', 'وهو', 'وهي', 'فإن', 'بها', 'به', 'لها', 'له', 'منها', 'منه', 'فيها', 'فيه', 'عليها', 'عليه', 'التى', 'ذات', 'لدى',
  'حتى', 'إلا', 'الا', 'بل', 'لكن', 'ولكن', 'كذلك', 'مثل', 'خلال', 'نحو', 'وأن', 'بأن', 'ولا', 'وما', 'اما', 'أما',
  // Sorani
  'لە', 'بە', 'و', 'کە', 'بۆ', 'لەسەر', 'ئەم', 'ئەو', 'یان', 'هەر', 'لەگەڵ', 'دا', 'ی', 'ە', 'ئەوە', 'ئەمە', 'بوو',
  'بێت', 'نییە', 'هەیە', 'زۆر', 'تر', 'لەوە', 'بەڵام', 'هەروەها', 'چونکە', 'تا', 'وەک', 'لەناو', 'بەو', 'بەم', 'ئەوەی',
  'کرد', 'دەکات', 'دەبێت', 'دەکرێت', 'ئەوان', 'خۆی', 'لێ', 'پێ', 'وا', 'هیچ', 'هەموو',
  // Badini
  'ژ', 'د', 'ل', 'ب', 'کو', 'ئەڤ', 'ئەڤە', 'دگەل', 'ژی', 'دناڤ', 'بۆ', 'یێ', 'یا', 'یێن', 'ڤێ', 'ڤی', 'وان', 'ئەوێ',
  'هندێ', 'دێ', 'بوو', 'هەیە', 'نینە', 'دکەت', 'دبیت', 'هەمی', 'چونکی', 'وەکی', 'پشتی', 'بەری',
  // English
  'the', 'a', 'an', 'of', 'to', 'in', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'for', 'on', 'with',
  'as', 'by', 'at', 'from', 'that', 'this', 'these', 'those', 'it', 'its', 'which', 'who', 'whom', 'not', 'but', 'also',
  'can', 'may', 'has', 'have', 'had', 'will', 'would', 'should', 'than', 'then', 'there', 'their', 'they', 'we', 'our',
  'such', 'into', 'more', 'most', 'other', 'some', 'any', 'all', 'each', 'both', 'between', 'about', 'if', 'so', 'do',
  'does', 'did', 'he', 'she', 'his', 'her', 'them', 'i', 'my', 'you', 'your', 'what', 'when', 'where', 'how', 'why',
].map(normalise));

/**
 * Sentences worth looking up in a scholarly catalogue, to find the sources a
 * text may have been copied from that nobody attached.
 *
 * A catalogue search is by words, so the useful sentences are the ones whose
 * words are rare: a sentence of stock phrasing finds a thousand papers, one
 * naming three unusual things finds the one it came from. Sentences between
 * 12 and 40 words, not mostly stop words, with no citation (a cited sentence
 * says where it came from already) and no gap, scored by the length of their
 * words weighted by how seldom the text uses them; the best of each piece in
 * turn, so the lookups are spread over the whole text rather than spent on
 * its introduction; each cut to 30 words, because a catalogue searched with
 * a paragraph finds nothing.
 */
export function distinctive(pieces: Piece[], n: number): string[] {
  const want = Math.floor(Number.isFinite(n) ? n : 0);
  if (want <= 0 || !Array.isArray(pieces)) return [];
  const vocab = newVocab();
  const read = pieces.map((p) => {
    const text = typeof p?.text === 'string' ? p.text : '';
    return { text, sentences: sentencesOf(text), toks: scan(text, vocab) };
  });
  const df = new Int32Array(vocab.list.length);
  for (const r of read) for (let i = 0; i < r.toks.n; i++) df[r.toks.ids[i]]++;
  const stop = vocab.list.map((w) => STOP.has(w));

  const lists = read.map((r) => {
    const out: { text: string; score: number; at: number }[] = [];
    let ti = 0;
    for (const s of r.sentences) {
      if (s.line !== 'text' || s.text.includes('[[') || /\[\s*@/.test(s.text)) continue;
      while (ti < r.toks.n && r.toks.starts[ti] < s.start) ti++;
      let tj = ti;
      while (tj < r.toks.n && r.toks.ends[tj] <= s.end) tj++;
      const count = tj - ti;
      if (count < 12 || count > 40) continue;
      let stops = 0;
      let score = 0;
      for (let i = ti; i < tj; i++) {
        const id = r.toks.ids[i];
        if (stop[id]) stops++;
        else score += vocab.list[id].length / df[id];
      }
      if (stops > count / 2) continue;
      const end = count > 30 ? r.toks.ends[ti + 29] : s.end;
      out.push({ text: r.text.slice(s.start, end).replace(/\s+/g, ' ').trim(), score, at: s.start });
    }
    return out.sort((a, b) => b.score - a.score || a.at - b.at);
  });

  const picked: string[] = [];
  const seen = new Set<string>();
  for (let round = 0; picked.length < want; round++) {
    let any = false;
    for (const list of lists) {
      if (round >= list.length) continue;
      any = true;
      const key = normalise(list[round].text);
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(list[round].text);
      if (picked.length >= want) break;
    }
    if (!any) break;
  }
  return picked;
}

// ── drawing matches ───────────────────────────────────────────────────────

/**
 * Segments of `text` for drawing highlights: the ranges clipped to the text,
 * overlapping and touching ones merged, and the text between them as
 * segments that are not hits — in order, covering all of it, none empty.
 */
export function segments(text: string, ranges: { start: number; end: number }[]): { text: string; hit: boolean }[] {
  const src = typeof text === 'string' ? text : '';
  const len = src.length;
  const clip = (v: number) => Math.max(0, Math.min(len, Math.floor(v)));
  const rs = (Array.isArray(ranges) ? ranges : [])
    .filter((r) => r && Number.isFinite(r.start) && Number.isFinite(r.end))
    .map((r) => [clip(r.start), clip(r.end)] as [number, number])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number][] = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [a, b] of merged) {
    if (a > at) out.push({ text: src.slice(at, a), hit: false });
    out.push({ text: src.slice(a, b), hit: true });
    at = b;
  }
  if (at < len) out.push({ text: src.slice(at), hit: false });
  return out;
}

/**
 * A window of text around a range, for showing a match in context: up to
 * `around` characters each side, cut back to a whole word where the window
 * would cut one, with '…' where anything was left out.
 */
export function context(text: string, start: number, end: number, around = 80): { before: string; hit: string; after: string } {
  const src = typeof text === 'string' ? text : '';
  const len = src.length;
  const clip = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(len, Math.floor(v))) : 0);
  const s = clip(start);
  const e = Math.max(s, clip(end));
  const span = Math.max(0, Number.isFinite(around) ? Math.floor(around) : 80);
  const from = Math.max(0, s - span);
  const to = Math.min(len, e + span);
  let before = src.slice(from, s);
  if (from > 0) {
    if (!/\s/.test(src[from - 1]) && !/\s/.test(src[from] ?? ' ')) {
      const cut = before.search(/\s/);
      before = cut === -1 ? '' : before.slice(cut);
    }
    before = '…' + before.trimStart();
  }
  let after = src.slice(e, to);
  if (to < len) {
    if (!/\s/.test(src[to]) && !/\s/.test(src[to - 1] ?? ' ')) {
      const cut = after.search(/\s\S*$/);
      after = cut === -1 ? '' : after.slice(0, cut);
    }
    after = after.trimEnd() + '…';
  }
  return { before, hit: src.slice(s, e), after };
}

// ── integrity ─────────────────────────────────────────────────────────────

export type Issue =
  /** A sentence that states a figure or reports what studies found, with no citation in it nor in its paragraph's last sentence. */
  | { what: 'uncited-claim'; section: string; start: number; end: number; text: string }
  /** A quoted passage of ≥ 8 words (inside « » “ ” " ") with no marker in its paragraph. */
  | { what: 'uncited-quote'; section: string; start: number; end: number; text: string }
  /** A source in use (citable) that no written section cites. */
  | { what: 'unused-source'; key: string }
  /** One source carries more than 30% of all citation instances, when there are at least 8. `share` 0..1. */
  | { what: 'dominant-source'; key: string; share: number }
  /** A retracted source that is cited somewhere. */
  | { what: 'retracted-source'; key: string }
  /** A written part of ≥ 250 words (level ≥ 2, or level 1 in a document without chapters) citing nothing, while the document has sources. */
  | { what: 'uncited-part'; section: string; words: number }
  /** A [[gap]] left for the researcher. `text` is what is inside the brackets. */
  | { what: 'gap'; section: string; start: number; end: number; text: string };

/**
 * How a sentence reports what others found, in the four languages. A
 * sentence that says "studies show" is making somebody else's claim, and has
 * to say whose. Matched normalised, at the start of a word, and each may be
 * the start of a longer word — الدراسات covers الدراساتُ and a Kurdish plural
 * ending is still the plural.
 */
const REPORTING = [
  // Arabic
  'تشير الدراسات', 'أشارت الدراسات', 'تشير الأبحاث', 'تشير البحوث', 'تشير الإحصائيات', 'تشير الإحصاءات', 'تشير التقارير',
  'تشير نتائج', 'أظهرت نتائج', 'أظهرت الدراسات', 'أظهرت دراسة', 'أثبتت الدراسات', 'أثبتت دراسة', 'أكدت الدراسات', 'أكدت دراسة',
  'تؤكد الدراسات', 'بينت الدراسات', 'بينت دراسة', 'كشفت الدراسات', 'كشفت دراسة', 'توصلت دراسة', 'توصلت الدراسات',
  'أوضحت دراسة', 'أوضحت الدراسات', 'وفقا لدراسة', 'وفقاً لدراسة', 'وفقا لإحصائيات', 'حسب دراسة', 'حسب إحصائيات', 'بحسب دراسة',
  'يرى الباحثون', 'يرى بعض الباحثين', 'يرى بعض', 'أكد الباحثون', 'يؤكد الباحثون', 'يشير الباحثون', 'أشار الباحثون',
  'تفيد التقارير', 'تذكر المصادر',
  // Sorani
  'لێکۆڵینەوەکان', 'توێژینەوەکان', 'توێژەران', 'بەپێی توێژینەوە', 'بەپێی لێکۆڵینەوە', 'بەپێی ئامار', 'ئامارەکان', 'بەگوێرەی ئامار',
  'بەگوێرەی توێژینەوە', 'ڕاپۆرتەکان',
  // Badini
  'ڤەکۆلینێن', 'ڤەکۆلینان', 'ڤەکولینێن', 'ڤەکولینان', 'ڤەکۆلەران', 'ڤەکولەران', 'لێکۆلینێن', 'ل دویڤ ڤەکۆلین',
  'ل دویڤ ئامار', 'ئامارێن', 'ڕاپۆرتێن',
  // English
  'according to', 'studies show', 'studies have shown', 'studies suggest', 'studies indicate', 'studies found',
  'research shows', 'research has shown', 'research indicates', 'research suggests', 'researchers found', 'researchers have found',
  'researchers argue', 'evidence suggests', 'evidence shows', 'statistics show', 'surveys show', 'data show', 'it has been shown',
  'it has been reported', 'reports indicate', 'scholars argue', 'experts say', 'a study by', 'a recent study',
].map((p) => normalise(p).replace(/\s+/g, ' '));

/** The words that make a number a proportion. */
const PERCENT_WORDS = ['بالمئة', 'بالمائة', 'في المئة', 'في المائة', 'percent', 'per cent', 'لەسەدا', 'ژ سەدێ', 'ژ سەدی'].map(normalise);

/** A figure: a percentage, a number of two digits or more (a count, a year), or a decimal. Read in normalised text. */
const FIGURE = /\d\s*%|%\s*\d|\d{2,}|\d[.,]\d/;

/** Letters that attach to the next word — and, so — before a reporting phrase: وتشير الدراسات. */
const REPORT_PROCLITICS = ['', '\u0648', '\u0641'];

const MARKERS_ANYWHERE = /\[[ \t]*@[^[\]\n]{0,200}\]/g;

/** Whether a sentence states a figure or reports a finding. Markers are read out first: their page numbers are not figures. */
function claims(sentence: string): boolean {
  const bare = normalise(sentence.replace(MARKERS_ANYWHERE, ' '));
  if (FIGURE.test(bare)) return true;
  const words = ` ${tokens(sentence).map((t) => t.word).join(' ')} `;
  if (PERCENT_WORDS.some((p) => words.includes(` ${p}`))) return true;
  return REPORTING.some((p) => REPORT_PROCLITICS.some((c) => words.includes(` ${c}${p}`)));
}

/** Every key of every marker group in a text, once per group — the citation instances, as the reader prints them. */
function citationsIn(text: string): string[] {
  const out: string[] = [];
  const take = (runs: readonly Run[]) => {
    for (const r of runs) if (r.t === 'cite') out.push(...r.keys);
  };
  for (const b of blocksOf(text)) {
    if (b.t === 'p' || b.t === 'h') take(b.runs);
    else if (b.t === 'ul' || b.t === 'ol') for (const it of b.items) take(it);
    else if (b.t === 'table') for (const row of [b.head, ...b.rows]) for (const cell of row) take(cell);
  }
  return out;
}

/** Whether a piece of text carries a citation marker. Only text with an `@` is read. */
function cites(text: string): boolean {
  return text.includes('@') && markersIn(text).length > 0;
}

/**
 * Every issue, in document order — section order, then position in the
 * section, a whole part's issue before the ones inside it — and the sources'
 * issues last: unused, then dominant, then retracted, each in source order.
 *
 * Only finished sections are read, as only they are checked for originality.
 * Sources are called unused only once something is written: before that,
 * every source is unused and saying so helps nobody.
 */
export function integrity(doc: Doc): Issue[] {
  const out: Issue[] = [];
  const sections = (doc.sections ?? []).filter(written);
  const usable = citable(doc.sources ?? []);
  const chapters = kindOf(doc.kind).chapters;
  const known = new Set((doc.sources ?? []).map((s) => s.key));
  const citedKeys = new Set<string>();
  const instances = new Map<string, number>();

  for (const sec of sections) {
    const text = sec.text;
    const found: { at: number; issue: Issue }[] = [];

    for (const key of citationsIn(text)) {
      citedKeys.add(key);
      if (known.has(key)) instances.set(key, (instances.get(key) ?? 0) + 1);
    }

    const words = wordCount(text);
    if (words >= 250 && (sec.level >= 2 || !chapters) && usable.length && markersIn(text).length === 0) {
      found.push({ at: -1, issue: { what: 'uncited-part', section: sec.id, words } });
    }

    // Claims with no citation in the sentence nor at the end of its paragraph.
    const sentences = sentencesOf(text);
    const lastOf = new Map<number, string>();
    for (const s of sentences) if (s.line !== 'heading') lastOf.set(s.paragraph, s.text);
    for (const s of sentences) {
      if (s.line !== 'text' || s.text.includes('[[')) continue;
      if (!claims(s.text)) continue;
      if (cites(s.text) || cites(lastOf.get(s.paragraph) ?? '')) continue;
      found.push({ at: s.start, issue: { what: 'uncited-claim', section: sec.id, start: s.start, end: s.end, text: s.text } });
    }

    // Long quotations with no citation in their paragraph.
    const paragraphs = paragraphsOf(text);
    for (const [a, b] of quotesOf(text)) {
      const inner = text.slice(a + 1, b - 1);
      if (tokens(inner).length < 8) continue;
      const [pa, pb] = paragraphs[rangeAt(paragraphs, a)];
      if (cites(text.slice(pa, pb))) continue;
      found.push({ at: a, issue: { what: 'uncited-quote', section: sec.id, start: a, end: b, text: inner.trim() } });
    }

    // Gaps left for the researcher.
    const gap = /\[\[([\s\S]*?)\]\]/g;
    for (let m = gap.exec(text); m; m = gap.exec(text)) {
      if (/^\s*@/.test(m[1])) continue;
      found.push({ at: m.index, issue: { what: 'gap', section: sec.id, start: m.index, end: m.index + m[0].length, text: m[1].trim() } });
    }

    found.sort((x, y) => x.at - y.at);
    for (const f of found) out.push(f.issue);
  }

  if (sections.length) {
    for (const s of usable) if (!citedKeys.has(s.key)) out.push({ what: 'unused-source', key: s.key });
  }
  let total = 0;
  for (const n of instances.values()) total += n;
  if (total >= 8) {
    for (const s of doc.sources ?? []) {
      const n = instances.get(s.key) ?? 0;
      if (n / total > 0.3) out.push({ what: 'dominant-source', key: s.key, share: Math.round((n / total) * 1000) / 1000 });
    }
  }
  for (const s of doc.sources ?? []) if (s.retracted && citedKeys.has(s.key)) out.push({ what: 'retracted-source', key: s.key });
  return out;
}
