/**
 * The Word file: a document as the researcher was shown it, laid out the way
 * the university it is for lays one out.
 *
 * ## The owner's example is the specification
 *
 * The owner sent a working paper from a law faculty in Iraq and said: this is
 * what the module must produce. So every measurement here is taken from that
 * file — a cover with the institution on the reading side and the logo across
 * from it, the title, who presented it and who supervised, two years under a
 * double rule; headings centred and bold at every level; justified body text
 * with a first-line indent; footnotes at the foot of each page, numbered from
 * one again on every page, each opening "١ ) "; a source list grouped by kind,
 * each group numbered from one. Sizes are in half-points and spacing in
 * twentieths of a point, as Word stores them, so a number here can be checked
 * against the example's XML without converting anything.
 *
 * ## Built from what was shown
 *
 * The preview and this file read a section with the same reader (`prose.ts`)
 * and cite it with the same context (`cite.ts`), walked in the same order —
 * the sections, then the blocks, then the cells and items — so the note that
 * is a source's first in the preview is its first here too, and a later one
 * says "مصدر سابق" in both. Nothing is written that the preview did not show:
 * a part not written yet is its heading alone, never its brief.
 *
 * ## Text only ever goes in as text
 *
 * Everything a model or a researcher wrote enters the file as the text of a
 * run, which the `docx` library escapes; a title that reads
 * `</w:t><w:fldSimple …/>` is printed, not obeyed. The only XML written here is
 * a few fixed elements the library cannot express — footnotes restarting on
 * every page and numbered ١٢٣, the section's direction, the direction and
 * place of the footnote rule — added to the finished parts at the place the schema gives
 * them. Word calls a file whose elements are out of order unreadable, and
 * offers to repair it, which is not what anybody wants to see on a thesis.
 * The only fields are the page number and the table of contents.
 *
 * ## Direction and digits are decided per word
 *
 * An Arabic paragraph that names SPSS or cites (Smith, 2020) is still an
 * Arabic paragraph, but the Latin words in it are not Arabic text: marked as
 * right-to-left, Word turns "GPT-4" into "4-GPT", and the digits of a DOI in
 * Eastern numerals are no longer a DOI. So a paragraph is cut into runs by
 * script, word by word; a number or a full stop goes with the words around
 * it, and a pair of brackets goes together, with what it encloses;
 * the Arabic-script runs are marked right-to-left and have their digits
 * written as the document writes them (`localDigits`), and the Latin ones are
 * left as they are. A paragraph with no Arabic-script letters at all — a
 * Chicago note for an English book, an English abstract — is laid out left to
 * right, as a reader of it expects.
 *
 * ## The library is loaded when it is needed
 *
 * `docx` is imported inside `docxBase64`, so the bundler puts it in a chunk of
 * its own and the app does not load it until somebody saves a Word file.
 */

import type { Doc, DocLang, Section } from './research';
import { EMPTY_META, WORDS, bylineOf, kindOf, localDigits, statementOf, yearsOf } from './research';
import { blocksOf } from './prose';
import type { Block, Run } from './prose';
import { citeContext, referenceList, renderRuns } from './cite';
import type { CiteContext, Rich } from './cite';
import type { Document as DocxFile, FileChild, IParagraphStyleOptions, Paragraph as DocxParagraph, ParagraphChild } from 'docx';

type Lib = typeof import('docx');
/** A paragraph, a table, or the table of contents. */
type Part = FileChild;

// ── the page ──────────────────────────────────────────────────────────────

/** A4, with 2.5 cm margins all round, as the example has it. */
const PAGE = { width: 11906, height: 16838, margin: 1417 };
const TEXT_WIDTH = PAGE.width - 2 * PAGE.margin;

/** The logo's box on the cover: 4.2 × 4.8 cm, in EMU. A logo of another shape keeps its own and fits inside. */
const LOGO_BOX = { width: 1512000, height: 1728000 };
const EMU_PER_PIXEL = 9525;

/** Sizes, in half-points. */
interface Look {
  body: number;
  list: number;
  ref: number;
  note: number;
  footer: number;
  /** A section heading, by level. */
  heading: readonly [number, number, number, number];
  /** `###` and `####` inside a section. */
  sub: readonly [number, number];
  cell: number;
  /** Line spacing of body text, in 240ths of a line. */
  line: number;
  firstLine: number;
  cover: { lines: number; title: number; statement: number; by: number; who: number; whoTitle: number; years: number };
}

/** Arabic, Sorani and Badini: the example's own sizes, 14pt text under 16pt headings. */
const ARABIC_LOOK: Look = {
  body: 28, list: 26, ref: 24, note: 24, footer: 28,
  heading: [32, 32, 32, 32], sub: [28, 26], cell: 24,
  line: 307, firstLine: 709,
  cover: { lines: 28, title: 44, statement: 28, by: 24, who: 36, whoTitle: 28, years: 28 },
};

/** English: 12pt text at one and a half lines, headings stepping down a size a level. */
const LATIN_LOOK: Look = {
  body: 24, list: 24, ref: 24, note: 20, footer: 24,
  heading: [28, 26, 24, 24], sub: [24, 24], cell: 22,
  line: 360, firstLine: 720,
  cover: { lines: 26, title: 40, statement: 26, by: 24, who: 32, whoTitle: 26, years: 26 },
};

/** The usual font of each language, when neither the call nor the document names one. */
const FONT: Readonly<Record<DocLang, string>> = { ar: 'Simplified Arabic', ckb: 'Arial', kmr: 'Arial', en: 'Times New Roman' };

/**
 * The language Word is told the Arabic-script text is in, for spelling and
 * shaping. English documents cite Arabic works in Arabic.
 */
const TAG: Readonly<Record<DocLang, string>> = { ar: 'ar-IQ', ckb: 'ckb-IQ', kmr: 'ku-Arab-IQ', en: 'ar-IQ' };

/**
 * A conclusion, by its heading. The last main part named so starts a page of
 * its own in a thesis-shaped document, as the example's الخاتمة does; when
 * none is named so, the last main part does.
 */
const CONCLUSION = /خاتمة|ئەنجام|ئه\u200Cنجام|کۆتایی|conclusion/i;

const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ── script ────────────────────────────────────────────────────────────────

/** R for right-to-left scripts, L for the rest. */
type Side = 'R' | 'L';

/** Arabic, Hebrew and the scripts between them, and their presentation forms. */
const RIGHT = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LETTER = /\p{L}/u;

/**
 * The side a character is on, if it has one. Only letters do: an Arabic comma
 * or semicolon, or an Arabic-Indic digit, goes with the words around it — the
 * "؛" that joins a Latin note to an Arabic one belongs to neither.
 */
function sideOf(ch: string): Side | null {
  if (!LETTER.test(ch)) return null;
  return RIGHT.test(ch) ? 'R' : 'L';
}

function firstSide(text: string): Side | null {
  for (const ch of text) {
    const s = sideOf(ch);
    if (s) return s;
  }
  return null;
}

/**
 * The direction of a paragraph of body text: the document's own, unless the
 * paragraph has none of its script and some of the other — an English quote
 * in an Arabic thesis, an Arabic one in an English paper.
 */
function sideOfText(text: string, own: Side): Side {
  let r = false;
  let l = false;
  for (const ch of text) {
    const s = sideOf(ch);
    if (s === 'R') r = true;
    else if (s === 'L') l = true;
    if (r && l) return own;
  }
  if (own === 'R') return !r && l ? 'L' : 'R';
  return !l && r ? 'R' : 'L';
}

/**
 * Characters XML 1.0 cannot carry — control characters, a lone half of a
 * surrogate pair — which a pasted source or a model can still produce. One of
 * them anywhere and Word will not open the file.
 */
function clean(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g, (m) => (m.length === 2 ? m : '\uFFFD'));
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A piece of a paragraph in one script, with the formatting of the rich run it came from. */
interface Piece {
  text: string;
  side: Side;
  at: number;
}

/**
 * The brackets the Unicode bidirectional algorithm pairs, opening to closing.
 * Only these: a browser and LibreOffice pair nothing else, and the pieces
 * must fall where they draw them.
 */
const PAIRED: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const CLOSING = new Set(Object.values(PAIRED));

/**
 * A paragraph's text cut into runs by script, the way the Unicode
 * bidirectional algorithm would read it, so Word and LibreOffice agree.
 *
 * A word is split into its core — from its first letter or digit to its last
 * — and the punctuation around it. A core is on the side of its first letter;
 * a number on the side of the word before it, or failing that the word after,
 * so "(Smith, 2020)" keeps 2020 and "عام 2020" is written عام ٢٠٢٠.
 *
 * A pair of brackets is on one side, as the algorithm's rule N0 puts it: the
 * paragraph's when anything inside is, and otherwise the side inside when the
 * text before the opening bracket is on it too. It matters in Word, which
 * reads a bracket in a right-to-left run as right-to-left whatever surrounds
 * it: in "نموذج GPT-4 (OpenAI) في" with its ")" on the Arabic side, Word
 * turns the ")" round and draws it beyond "GPT-4", though LibreOffice and a
 * browser, pairing the brackets themselves, draw it right.
 *
 * Other punctuation and spaces between two words (or brackets) of one side
 * are theirs, and otherwise the paragraph's: the full stop after "برنامج
 * SPSS." ends the Arabic sentence, and the one after an Arabic citation in an
 * English sentence ends the English one. `end` is the side after the last
 * word, the paragraph's unless a caller ends the text on the other. Pieces
 * never cross a rich run, whose formatting they carry.
 */
function piecesOf(rich: readonly Rich[], own: Side, end: Side = own): Piece[] {
  type Unit = { text: string; at: number; core: boolean; side: Side | null };
  const units: Unit[] = [];
  // Punctuation one character a unit, so a bracket can differ from the full stop after it.
  const marks = (text: string, at: number) => {
    for (const ch of text) units.push({ text: ch, at, core: false, side: null });
  };
  rich.forEach((r, at) => {
    if (r.note || !r.text) return;
    for (const m of r.text.match(/\s+|\S+/g) ?? []) {
      const core = /[\p{L}\p{N}][\s\S]*[\p{L}\p{N}\p{M}]|[\p{L}\p{N}]/u.exec(m);
      if (!core || /^\s/.test(m)) {
        marks(m, at);
        continue;
      }
      marks(m.slice(0, core.index), at);
      units.push({ text: core[0], at, core: true, side: firstSide(core[0]) });
      marks(m.slice(core.index + core[0].length), at);
    }
  });
  // Numbers: the side of the word before, else of the word after, else the paragraph's.
  let before: Side | null = null;
  for (const u of units) {
    if (!u.core) continue;
    if (u.side) before = u.side;
    else if (before) u.side = before;
  }
  let after: Side | null = null;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (!u.core) continue;
    if (u.side) after = u.side;
    else u.side = after ?? own;
  }
  // Brackets: paired as the algorithm pairs them (BD16), a closing bracket
  // with the nearest open one of its kind, and each pair given one side (N0),
  // in the order the pairs open.
  const open: { close: string; at: number }[] = [];
  const pairs: [number, number][] = [];
  units.forEach((u, i) => {
    if (u.core) return;
    if (PAIRED[u.text]) open.push({ close: PAIRED[u.text], at: i });
    else if (CLOSING.has(u.text)) {
      const j = open.map((o) => o.close).lastIndexOf(u.text);
      if (j >= 0) {
        pairs.push([open[j].at, i]);
        open.length = j;
      }
    }
  });
  pairs.sort((a, b) => a[0] - b[0]);
  for (const [o, c] of pairs) {
    let inside: Side | null = null;
    for (let i = o + 1; i < c && inside !== own; i++) if (units[i].core) inside = units[i].side;
    // Nothing inside with a side: the brackets are punctuation like any other.
    if (!inside) continue;
    let before: Side = own;
    for (let i = o - 1; i >= 0; i--) {
      if (units[i].side) {
        before = units[i].side as Side;
        break;
      }
    }
    units[o].side = units[c].side = inside === own ? own : before;
  }
  // Other punctuation and spaces: the side of the words or brackets on both sides of them when they agree.
  let last: Side = own;
  const prev = units.map((u) => {
    const was = last;
    if (u.side) last = u.side;
    return was;
  });
  let next: Side = end;
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.side) {
      next = u.side;
      continue;
    }
    u.side = prev[i] === next ? next : own;
  }
  const out: Piece[] = [];
  for (const u of units) {
    const s = u.side as Side;
    const tail = out[out.length - 1];
    if (tail && tail.at === u.at && tail.side === s) tail.text += u.text;
    else out.push({ text: u.text, side: s, at: u.at });
  }
  return out;
}

const plain = (rich: readonly Rich[]): string => rich.map((r) => (r.note ? '' : r.text)).join('');

// ── pictures ──────────────────────────────────────────────────────────────

interface Picture {
  type: 'png' | 'jpg';
  data: Uint8Array;
  width: number;
  height: number;
}

/** A PNG's size, from its header; `null` when it is not a PNG. */
function pngSize(b: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || sig.some((v, i) => b[i] !== v)) return null;
  const u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const width = u32(16);
  const height = u32(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** A JPEG's size, from its frame header; `null` when it is not a JPEG. */
function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) + b[i + 3];
    const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame && i + 8 < b.length) {
      const height = (b[i + 5] << 8) + b[i + 6];
      const width = (b[i + 7] << 8) + b[i + 8];
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** The logo, when it is a PNG or a JPEG data URL that is what it says it is. Anything else is left off the cover. */
function pictureOf(url: unknown): Picture | null {
  const m = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)$/i.exec(str(url));
  if (!m) return null;
  let data: Uint8Array;
  try {
    const bin = atob(m[2].replace(/\s+/g, ''));
    data = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  const png = m[1].toLowerCase() === 'png';
  const size = png ? pngSize(data) : jpegSize(data);
  return size ? { type: png ? 'png' : 'jpg', data, ...size } : null;
}

// ── the finished parts ────────────────────────────────────────────────────

/**
 * Where a new element goes among the children of `parent`: before the first
 * of the elements the schema puts after it, or at the end.
 */
function insertBefore(xml: string, parent: string, followers: readonly string[], element: string, skipIf: RegExp): string {
  // The last element of that name — not one whose name merely starts with it, as w:compatSetting does w:compat's.
  let open = -1;
  for (const m of xml.matchAll(new RegExp(`<${parent}[\\s/>]`, 'g'))) open = m.index ?? -1;
  if (open === -1) return xml;
  const openEnd = xml.indexOf('>', open);
  if (openEnd === -1 || xml[openEnd - 1] === '/') return xml;
  const close = xml.indexOf(`</${parent}>`, openEnd);
  if (close === -1) return xml;
  const inner = xml.slice(openEnd + 1, close);
  if (skipIf.test(inner)) return xml;
  const next = new RegExp(`<(?:${followers.join('|')})[\\s/>]`).exec(inner);
  const at = next ? openEnd + 1 + next.index : close;
  return xml.slice(0, at) + element + xml.slice(at);
}

/** What the finished parts need that the library cannot say. */
interface Fixes {
  rtl: boolean;
  notes: boolean;
  eastern: boolean;
}

/** `w:footnotePr`: numbered from one on every page, in the document's digits. */
function footnotePr(f: Fixes, settings: boolean): string {
  return '<w:footnotePr>'
    + (f.eastern ? '<w:numFmt w:val="hindiNumbers"/>' : '')
    + '<w:numRestart w:val="eachPage"/>'
    + (settings ? '<w:footnote w:id="-1"/><w:footnote w:id="0"/>' : '')
    + '</w:footnotePr>';
}

/** CT_SectPr, from footnotePr on. */
const AFTER_FOOTNOTES_IN_SECTION = [
  'w:endnotePr', 'w:type', 'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType', 'w:pgNumType', 'w:cols',
  'w:formProt', 'w:vAlign', 'w:noEndnote', 'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid',
  'w:printerSettings', 'w:sectPrChange',
];
const AFTER_BIDI_IN_SECTION = ['w:rtlGutter', 'w:docGrid', 'w:printerSettings', 'w:sectPrChange'];
/** CT_Settings, from footnotePr on. */
const AFTER_FOOTNOTES_IN_SETTINGS = [
  'w:endnotePr', 'w:compat', 'w:docVars', 'w:rsids', 'm:mathPr', 'w:attachedSchema', 'w:themeFontLang', 'w:clrSchemeMapping',
  'w:doNotIncludeSubdocsInStats', 'w:doNotAutoCompress', 'w:forceUpgrade', 'w:captions', 'w:readModeInkLockDown', 'w:smartTagType',
  'sl:schemaLibrary', 'w:shapeDefaults', 'w:doNotEmbedSmartTags', 'w:decimalSymbol', 'w:listSeparator',
];
/** CT_PPrBase, from bidi on. */
const AFTER_BIDI_IN_PARAGRAPH = [
  'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind', 'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
  'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap', 'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange',
];

/** CT_PPrBase, from jc on. */
const AFTER_JC_IN_PARAGRAPH = AFTER_BIDI_IN_PARAGRAPH.slice(AFTER_BIDI_IN_PARAGRAPH.indexOf('w:jc') + 1);

/**
 * The two notes Word draws the footnote rule from. The library gives each of
 * them a note number, as it gives every note, and a rule has none. In a
 * right-to-left document their paragraphs are right-to-left and aligned
 * "right", as the example's are, which in a right-to-left paragraph Word
 * reads as its far end: the rule sits at the left of the page, under the
 * end of the lines, where the example's Word rendering has it. LibreOffice
 * draws the rule from its page style and ignores both.
 */
function separators(xml: string, rtl: boolean): string {
  return xml.replace(/<w:footnote\b[^>]*w:type="(?:separator|continuationSeparator)"[^>]*>[\s\S]*?<\/w:footnote>/g, (note) => {
    const bare = note.replace(/<w:r>(?:(?!<w:r>)[\s\S])*?<w:footnoteRef\/><\/w:r>/g, '');
    if (!rtl) return bare;
    const bidi = insertBefore(bare, 'w:pPr', AFTER_BIDI_IN_PARAGRAPH, '<w:bidi/>', /<w:bidi[\s/>]/);
    return insertBefore(bidi, 'w:pPr', AFTER_JC_IN_PARAGRAPH, '<w:jc w:val="right"/>', /<w:jc[\s/>]/);
  });
}

const EDITS: Readonly<Record<string, (xml: string, f: Fixes) => string>> = {
  'word/document.xml': (xml, f) => {
    let out = xml;
    if (f.notes) out = insertBefore(out, 'w:sectPr', AFTER_FOOTNOTES_IN_SECTION, footnotePr(f, false), /<w:footnotePr[\s/>]/);
    if (f.rtl) out = insertBefore(out, 'w:sectPr', AFTER_BIDI_IN_SECTION, '<w:bidi/>', /<w:bidi[\s/>]/);
    return out;
  },
  'word/settings.xml': (xml, f) => {
    let out = xml;
    if (f.notes) out = insertBefore(out, 'w:settings', AFTER_FOOTNOTES_IN_SETTINGS, footnotePr(f, true), /<w:footnotePr[\s/>]/);
    // Complex-script layout on, as Word writes it for an Arabic document; a
    // flag, so before the compatibility mode (the library writes it after).
    if (f.rtl) out = insertBefore(out, 'w:compat', ['w:compatSetting'], '<w:useFELayout/>', /<w:useFELayout[\s/>]/);
    return out;
  },
  'word/footnotes.xml': (xml, f) => separators(xml, f.rtl),
};

/** The zip the library builds, as far as it is used here. */
interface Zip {
  file(path: string): { async(type: 'string'): Promise<string> } | null;
  file(path: string, data: string): unknown;
  generateAsync(o: { type: 'base64'; compression: 'DEFLATE'; mimeType: string }): Promise<string>;
}

/**
 * The file as base64, with the fixed elements added. The library's own packer
 * holds the zip it builds; a library that no longer does gets its file saved
 * as it made it, which Word opens, only with footnotes numbered straight
 * through.
 */
async function pack(L: Lib, file: DocxFile, fixes: Fixes): Promise<string> {
  const compiler = (L.Packer as unknown as { compiler?: { compile?: (f: DocxFile, prettify?: undefined, overrides?: []) => Zip } }).compiler;
  if (!compiler || typeof compiler.compile !== 'function') return L.Packer.toBase64String(file);
  const zip = compiler.compile(file, undefined, []);
  for (const [path, edit] of Object.entries(EDITS)) {
    const part = zip.file(path);
    if (part) zip.file(path, edit(await part.async('string'), fixes));
  }
  return zip.generateAsync({ type: 'base64', compression: 'DEFLATE', mimeType: MIME });
}

// ── the document ──────────────────────────────────────────────────────────

/** How a paragraph is set. Spacing in twentieths of a point; `size` is the paragraph mark's. */
interface Shape {
  side: Side;
  align: 'start' | 'center' | 'end' | 'both';
  size: number;
  before?: number;
  after?: number;
  line?: number;
  start?: number;
  hanging?: number;
  firstLine?: number;
  keepNext?: boolean;
  pageBreak?: boolean;
  heading?: 1 | 2 | 3 | 4;
  style?: string;
  rule?: boolean;
}

/** How the text of a run is set, before the rich run's own emphasis. */
interface Face {
  size: number;
  bold?: boolean;
  italic?: boolean;
}

/**
 * A Word file of `doc`, as base64 — the bytes the Save button hands to the
 * app's one command that writes them, to the path the person chose.
 *
 * `o.font` overrides the document's font, which overrides the language's
 * usual one (Simplified Arabic for Arabic, as the example; Arial for Kurdish;
 * Times New Roman for English), for Latin and Arabic script alike.
 */
export async function docxBase64(doc: Doc, o: { font?: string } = {}): Promise<string> {
  const L = await import('docx');
  const { file, fixes } = compose(L, doc, o.font);
  return pack(L, file, fixes);
}

/** The whole document, in the order the preview draws it. */
function compose(L: Lib, stored: Doc, fontWanted?: string): { file: DocxFile; fixes: Fixes } {
  // A document saved by an older build may lack a cover field; every one is text here.
  const doc: Doc = { ...stored, meta: { ...EMPTY_META, ...(stored.meta ?? {}) } };
  const lang: DocLang = doc.lang === 'ckb' || doc.lang === 'kmr' || doc.lang === 'ar' ? doc.lang : 'en';
  const own: Side = lang === 'en' ? 'L' : 'R';
  const look = lang === 'en' ? LATIN_LOOK : ARABIC_LOOK;
  const eastern = lang !== 'en' && doc.digits !== 'western';
  const w = WORDS[lang];
  const k = kindOf(doc.kind);
  const meta = doc.meta;
  const fontName = clean(str(fontWanted).trim() || str(doc.font).trim() || FONT[lang]).slice(0, 64);
  const font = { ascii: fontName, hAnsi: fontName, cs: fontName, eastAsia: fontName };
  const tag = TAG[lang];
  const ctx: CiteContext = citeContext(doc);
  const notes: Record<string, { children: DocxParagraph[] }> = {};
  let noteCount = 0;
  const toc: { title: string; level: number }[] = [];
  const thesis = k.cover === 'thesis';
  const A = L.AlignmentType;
  const ALIGN = { start: A.START, center: A.CENTER, end: A.END, both: A.BOTH } as const;
  const digits = (text: string) => (eastern ? localDigits(text, { lang, digits: 'eastern' }) : text);

  // ── runs and paragraphs ──

  /** The runs that are a [[gap]], and the paragraphs that hold one: the body must not end on one. */
  const holes = new WeakSet<object>();
  const holed = new WeakSet<object>();

  const textRun = (text: string, face: Face & { hole?: boolean }, side: Side) => {
    const run = new L.TextRun({
      text,
      font,
      size: face.size,
      sizeComplexScript: face.size,
      ...(face.bold ? { bold: true, boldComplexScript: true } : {}),
      ...(face.italic ? { italics: true, italicsComplexScript: true } : {}),
      ...(face.hole ? { highlight: L.HighlightColor.YELLOW, highlightComplexScript: false } : {}),
      // A Latin run in a right-to-left document says it is not one: the heading
      // and footnote styles it may sit in are.
      ...(side === 'R' ? { rightToLeft: true, language: { bidirectional: tag } } : { ...(own === 'R' ? { rightToLeft: false } : {}), language: { value: 'en-US' } }),
    });
    if (face.hole) holes.add(run);
    return run;
  };

  /**
   * Rich runs as Word runs: split by script, digits localised on the
   * right-to-left side, notes as footnotes. `end` is the side the text ends
   * on, when it is not the paragraph's.
   */
  const childrenOf = (rich: readonly Rich[], face: Face, side: Side, end: Side = side): ParagraphChild[] => {
    const pieces = piecesOf(rich, side, end);
    const out: ParagraphChild[] = [];
    rich.forEach((r, at) => {
      if (r.note) {
        out.push(noteMark(r.note, side));
        return;
      }
      for (const p of pieces) {
        if (p.at !== at) continue;
        const text = clean(p.side === 'R' ? digits(p.text) : p.text);
        if (!text) continue;
        out.push(textRun(text, { size: face.size, bold: face.bold || r.bold, italic: face.italic || r.italic, hole: r.hole }, p.side));
      }
    });
    return out;
  };

  // A left-to-right paragraph in a right-to-left document says so: the styles
  // it takes (footnote text, headings) are right-to-left.
  const paragraph = (children: ParagraphChild[], s: Shape) => {
    const p = new L.Paragraph({
      children,
      ...(s.side === 'R' ? { bidirectional: true } : own === 'R' ? { bidirectional: false } : {}),
      alignment: ALIGN[s.align],
      spacing: { before: s.before ?? 0, after: s.after ?? 0, ...(s.line ? { line: s.line } : {}) },
      ...(s.start !== undefined || s.hanging !== undefined || s.firstLine !== undefined
        ? { indent: { ...(s.start !== undefined ? { start: s.start } : {}), ...(s.hanging ? { hanging: s.hanging } : {}), ...(s.firstLine ? { firstLine: s.firstLine } : {}) } }
        : {}),
      ...(s.keepNext ? { keepNext: true } : {}),
      ...(s.pageBreak ? { pageBreakBefore: true } : {}),
      ...(s.heading ? { heading: [L.HeadingLevel.HEADING_1, L.HeadingLevel.HEADING_2, L.HeadingLevel.HEADING_3, L.HeadingLevel.HEADING_4][s.heading - 1] } : {}),
      ...(s.style ? { style: s.style } : {}),
      ...(s.rule ? { border: { bottom: { style: L.BorderStyle.DOUBLE, size: 6, space: 1, color: '000000' } } } : {}),
      run: { font, size: s.size, sizeComplexScript: s.size, ...(s.side === 'R' ? { rightToLeft: true } : {}) },
    });
    if (children.some((c) => holes.has(c))) holed.add(p);
    return p;
  };

  /** A line of plain text, set as `s` says; nothing at all when it is empty. */
  const line = (text: string, face: Face, s: Omit<Shape, 'side' | 'size'> & { side?: Side }): DocxParagraph[] => {
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return [];
    const rich: Rich[] = [{ text: t }];
    const side = s.side ?? sideOfText(t, own);
    return [paragraph(childrenOf(rich, face, side), { ...s, side, size: face.size })];
  };

  /** Space the example makes with an empty paragraph. */
  const gap = (after: number, size = look.body) => paragraph([], { side: own, align: 'both', size, line: 240, after });

  /**
   * A footnote: its mark here, its text at the foot of the page. The text
   * opens " ) " after the number, as the example's notes do, and is laid out
   * in its own script's direction.
   */
  const noteMark = (note: Rich[], outer: Side): ParagraphChild => {
    const id = ++noteCount;
    const side = sideOfText(plain(note), own);
    const body: Rich[] = [{ text: lang === 'en' ? ' ' : ' ) ' }, ...note];
    // A right-to-left note ending in a Latin citation — an Arabic source and
    // a foreign one in one marker — ends as the Latin does: its last bracket
    // and full stop go in the Latin run, which Word draws left to right, and
    // a left-to-right mark after them, in that run too, holds them there in
    // LibreOffice, which would otherwise send them to the far end of the line.
    const tail = plain(note).split('؛').pop() ?? '';
    const latinEnd = side === 'R' && firstSide(tail) === 'L' && !Array.from(tail).some((ch) => sideOf(ch) === 'R');
    if (latinEnd) body.push({ text: '\u200E' });
    notes[String(id)] = {
      children: [paragraph(childrenOf(body, { size: look.note }, side, latinEnd ? 'L' : side),
        { side, align: side === 'L' ? 'start' : 'both', size: look.note, line: 240, style: 'FootnoteText' })],
    };
    return new L.TextRun({
      style: 'FootnoteReference',
      children: [new L.FootnoteReference(id)],
      ...(outer === 'R' ? { rightToLeft: true } : {}),
    });
  };

  // ── the cover ──

  const title = str(meta.title).trim() || str(doc.request).trim();
  const statement = statementOf(doc);
  const author = str(meta.author).trim();
  const supervisor = str(meta.supervisor).trim();
  const supervisorTitle = str(meta.supervisorTitle).trim();

  /** Who presented it and who supervised it, with the example's spacing; nothing for a field left empty. */
  const people = (big: boolean): DocxParagraph[] => {
    const c = look.cover;
    const out: DocxParagraph[] = [];
    if (author) {
      out.push(...line(bylineOf(doc), { size: c.by }, { align: 'center', line: 312, after: 120 }));
      out.push(...line(author, { size: big ? c.who : c.who - 8, bold: true }, { align: 'center', line: 312, after: 120 }));
    }
    if (supervisor) {
      if (out.length) out.push(gap(big ? 320 : 120));
      out.push(...line(w.supervisor, { size: c.by }, { align: 'center', line: 312, after: 80 }));
      out.push(...line(supervisor, { size: big ? c.who : c.who - 8, bold: true }, { align: 'center', line: 312, after: 80 }));
      out.push(...line(supervisorTitle, { size: c.whoTitle, bold: true }, { align: 'center', line: 312, after: 80 }));
    }
    return out;
  };

  const noBorders = {
    top: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
    bottom: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
    left: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
    right: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
    insideHorizontal: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
    insideVertical: { style: L.BorderStyle.NONE, size: 0, color: 'auto' },
  };

  /** A row of cells with no borders, laid out from the reading side: the cover's two tables. */
  const layout = (cells: { width: number; children: DocxParagraph[] }[]) => new L.Table({
    rows: [new L.TableRow({
      children: cells.map((c) => new L.TableCell({
        width: { size: c.width, type: L.WidthType.DXA },
        margins: { left: 0, right: 0 },
        children: c.children.length ? c.children : [paragraph([], { side: own, align: 'start', size: look.body })],
      })),
    })],
    width: { size: cells.reduce((n, c) => n + c.width, 0), type: L.WidthType.DXA },
    columnWidths: cells.map((c) => c.width),
    layout: L.TableLayoutType.FIXED,
    borders: noBorders,
    ...(own === 'R' ? { visuallyRightToLeft: true } : {}),
  });

  /**
   * A thesis cover, as the example's: the institution on the reading side and
   * the logo across from it, the title, who presented it and who supervised,
   * and the two years under a double rule.
   */
  const thesisCover = (): Part[] => {
    const c = look.cover;
    const out: Part[] = [];
    const lines = [...str(meta.authority).split('\n'), str(meta.university), str(meta.college), str(meta.department)]
      .map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const institution = lines.flatMap((l) => line(l, { size: c.lines, bold: true }, { align: 'start', line: 300, after: 40, side: own }));
    const logo = pictureOf(doc.logo);
    if (logo) {
      const scale = Math.min(LOGO_BOX.width / logo.width, LOGO_BOX.height / logo.height);
      const picture = new L.ImageRun({
        type: logo.type,
        data: logo.data,
        transformation: { width: (logo.width * scale) / EMU_PER_PIXEL, height: (logo.height * scale) / EMU_PER_PIXEL },
      });
      // The university's name under the logo, when the researcher asked for
      // it: logos that carry no name of their own need one. Picture and name
      // are then centred on each other rather than the picture pushed to the
      // cell's edge.
      const caption = doc.logoCaption ? str(meta.university).replace(/\s+/g, ' ').trim() : '';
      const named = caption
        ? line(caption, { size: c.lines - 4, bold: true }, { align: 'center', line: 276, after: 0, side: own })
        : [];
      out.push(layout([
        { width: 6236, children: institution },
        // Word's own spacing under a picture, which the example's logo keeps.
        { width: 2835, children: [
          paragraph([picture], { side: own, align: caption ? 'center' : 'end', size: look.body, line: 276, after: caption ? 60 : 200 }),
          ...named,
        ] },
      ]));
    } else {
      out.push(...institution);
    }
    if (out.length) out.push(gap(440));
    const titled = line(title, { size: c.title, bold: true }, { align: 'center', line: 336, after: 200 });
    out.push(...titled);
    const who = people(true);
    const said = line(statement, { size: c.statement }, { align: 'center', line: 312, after: 240 });
    if (titled.length && (said.length || who.length)) out.push(gap(400));
    out.push(...said, ...who);
    const years = yearsOf(doc);
    const start = years.start.trim();
    const end = years.end.trim();
    if (start || end) {
      out.push(gap(480));
      out.push(paragraph([], { side: own, align: 'center', size: look.body, line: 240, after: 80, rule: true }));
      const year = (text: string, align: 'start' | 'end') => line(text, { size: c.years, bold: true }, { align, side: own, line: 276, after: 200 });
      out.push(start && end
        ? layout([{ width: TEXT_WIDTH / 2, children: year(start, 'start') }, { width: TEXT_WIDTH / 2, children: year(end, 'end') }])
        : line(start || end, { size: c.years, bold: true }, { align: 'center', side: own, line: 276, after: 200 })[0]);
    }
    return out;
  };

  /** A paper's title block, at the top of its first page. */
  const paperTitle = (): Part[] => {
    const c = look.cover;
    const out: Part[] = [];
    out.push(...line(title, { size: c.title - 8, bold: true }, { align: 'center', line: 312, after: 160 }));
    out.push(...line(statement, { size: c.by }, { align: 'center', line: 312, after: 160 }));
    out.push(...people(false));
    if (out.length) out.push(gap(240));
    return out;
  };

  // ── headings, blocks and parts ──

  /** A part's heading: centred and bold at every level in Arabic script, as the example; centred only at the top in English. */
  const heading = (text: string, level: 1 | 2 | 3 | 4, pageBreak: boolean): DocxParagraph[] => {
    const t = text.replace(/\s+/g, ' ').trim();
    // A part with no heading still starts its page when it should.
    if (!t) return pageBreak ? [paragraph([], { side: own, align: 'start', size: look.body, pageBreak })] : [];
    toc.push({ title: digits(t), level });
    const english = lang === 'en' && sideOfText(t, own) === 'L';
    return line(t, { size: look.heading[level - 1], bold: true, italic: english && level === 4 }, {
      align: english && level > 1 ? 'start' : 'center',
      line: 300,
      before: pageBreak ? 0 : level === 1 ? 160 : 120,
      after: pageBreak ? 120 : 80,
      keepNext: true,
      pageBreak,
      heading: level,
    });
  };

  /** A title the table of contents leaves out: the front matter's. */
  const frontTitle = (text: string, pageBreak: boolean, side?: Side): DocxParagraph[] =>
    line(text, { size: look.heading[0], bold: true }, { align: 'center', line: 300, after: 120, keepNext: true, pageBreak, side });

  const rendered = (runs: Run[]): Rich[] => renderRuns(runs, ctx);

  const bodyPara = (rich: Rich[], side = sideOfText(plain(rich), own)): DocxParagraph =>
    paragraph(childrenOf(rich, { size: look.body }, side), { side, align: 'both', size: look.body, line: look.line, after: 60, firstLine: look.firstLine });

  /** A list item or a list entry with its number typed, as the example types "١. ", hanging from its number. */
  const numbered = (label: string, rich: Rich[], size: number, side: Side, bold: boolean, wide = false): DocxParagraph => {
    const all: Rich[] = label ? [{ text: label, bold }, ...rich] : rich;
    const indent = label ? (wide ? { start: 624, hanging: 624 } : { start: 510, hanging: 369 }) : { start: 709, hanging: 709 };
    // Latin-script lines are set ragged: a justified line of an English
    // reference stretches its words round a DOI that cannot break.
    return paragraph(childrenOf(all, { size }, side), { side, align: side === 'L' ? 'start' : 'both', size, line: 264, after: 20, ...indent });
  };

  const table = (b: Extract<Block, { t: 'table' }>): Part[] => {
    const cols = Math.max(1, b.head.length, ...b.rows.map((r) => r.length));
    const width = Math.floor(TEXT_WIDTH / cols);
    const edge = { style: L.BorderStyle.SINGLE, size: 4, color: '000000' };
    const cell = (runs: Run[] | undefined, head: boolean) => {
      const rich = rendered(runs ?? []);
      const side = sideOfText(plain(rich), own);
      return new L.TableCell({
        width: { size: width, type: L.WidthType.DXA },
        ...(head ? { shading: { type: L.ShadingType.CLEAR, fill: 'D9D9D9', color: 'auto' } } : {}),
        children: [paragraph(childrenOf(rich, { size: look.cell, bold: head }, side),
          { side, align: head ? 'center' : 'start', size: look.cell, line: 240, before: 40, after: 40 })],
      });
    };
    const row = (cells: Run[][], head: boolean) => new L.TableRow({
      ...(head ? { tableHeader: true } : {}),
      children: Array.from({ length: cols }, (_, i) => cell(cells[i], head)),
    });
    return [
      new L.Table({
        rows: [row(b.head, true), ...b.rows.map((r) => row(r, false))],
        width: { size: width * cols, type: L.WidthType.DXA },
        columnWidths: Array.from({ length: cols }, () => width),
        layout: L.TableLayoutType.FIXED,
        alignment: A.CENTER,
        borders: { top: edge, bottom: edge, left: edge, right: edge, insideHorizontal: edge, insideVertical: edge },
        ...(own === 'R' ? { visuallyRightToLeft: true } : {}),
      }),
      gap(120),
    ];
  };

  const blockParts = (b: Block): Part[] => {
    switch (b.t) {
      case 'p':
        return [bodyPara(rendered(b.runs))];
      case 'hole':
        return [bodyPara([{ text: `[${b.text}]`, hole: true }])];
      case 'h': {
        const rich = rendered(b.runs);
        const side = sideOfText(plain(rich), own);
        const english = lang === 'en';
        return [paragraph(childrenOf(rich, { size: look.sub[b.depth - 1], bold: true, italic: english && b.depth === 2 }, side), {
          side, align: 'start', size: look.sub[b.depth - 1], line: 300, before: b.depth === 1 ? 100 : 80, after: 60, keepNext: true,
        })];
      }
      case 'ul':
      case 'ol':
        return b.items.map((item, i) => {
          const rich = rendered(item);
          const side = sideOfText(plain(rich), own);
          return numbered(b.t === 'ol' ? `${i + 1}. ` : '• ', rich, look.list, side, b.t === 'ol');
        });
      case 'table':
        return table(b);
    }
  };

  /** A paragraph of plain text — an abstract — split where the writer left a blank line. */
  const prose = (text: string, side?: Side): DocxParagraph[] =>
    str(text).split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .map((p) => bodyPara([{ text: p }], side ?? sideOfText(p, own)));

  const keywords = (label: string, words: string[], side: Side): DocxParagraph[] => {
    const kept = words.map((x) => str(x).trim()).filter(Boolean);
    if (!kept.length) return [];
    const rich: Rich[] = [{ text: `${label}: `, bold: true }, { text: kept.join(side === 'R' ? '، ' : ', ') }];
    return [paragraph(childrenOf(rich, { size: look.body }, side), { side, align: 'both', size: look.body, line: look.line, before: 120, after: 60 })];
  };

  // ── the order of things ──

  const children: Part[] = [];
  children.push(...(thesis ? thesisCover() : paperTitle()));

  if (k.dedication) {
    for (const [head, hole] of [[w.dedication, w.holeDedication], [w.thanks, w.holeThanks]]) {
      children.push(...frontTitle(head, true));
      children.push(paragraph(childrenOf([{ text: hole, hole: true }], { size: look.body }, own), { side: own, align: 'center', size: look.body, line: look.line, before: 240 }));
    }
  }

  if (k.abstract !== 'none' && str(doc.abstract).trim()) {
    children.push(...frontTitle(w.abstract, thesis));
    children.push(...prose(doc.abstract));
    children.push(...keywords(w.keywords, Array.isArray(doc.keywords) ? doc.keywords : [], own));
  }

  const tocAt = k.contents ? children.length : -1;

  const sections: Section[] = (Array.isArray(doc.sections) ? doc.sections : []).filter((s) => s && typeof s === 'object');
  const levelOf = (s: Section): 1 | 2 | 3 | 4 => (s.level === 2 || s.level === 3 || s.level === 4 ? s.level : 1);
  const tops = sections.map((s, i) => (levelOf(s) === 1 ? i : -1)).filter((i) => i >= 0);
  const named = tops.slice(1).filter((i) => CONCLUSION.test(str(sections[i].heading)));
  const conclusion = named.length ? named[named.length - 1] : tops.length > 1 ? tops[tops.length - 1] : -1;
  sections.forEach((s, i) => {
    const level = levelOf(s);
    const pageBreak = thesis && (i === 0 || (level === 1 && (k.chapters || i === conclusion)));
    children.push(...heading(str(s.heading), level, pageBreak));
    const text = str(s.text);
    if (text.trim()) for (const b of blocksOf(text)) children.push(...blockParts(b));
  });

  const refs = referenceList(ctx);
  if (refs.length) {
    children.push(...heading(w.references, 1, thesis));
    for (const g of refs) {
      if (g.heading && g.heading !== w.references) {
        const side = sideOfText(g.heading, own);
        children.push(paragraph(childrenOf([{ text: g.heading }], { size: look.sub[0], bold: true }, side),
          { side, align: 'start', size: look.sub[0], line: 300, before: 100, after: 60, keepNext: true }));
      }
      for (const e of g.entries) {
        const side = firstSide(plain(e.runs)) ?? own;
        const label = e.n === undefined ? '' : doc.style === 'ieee' ? `[${e.n}] ` : `${e.n}. `;
        children.push(numbered(label, e.runs, look.ref, side, doc.style !== 'ieee', doc.style === 'ieee'));
      }
    }
  }

  if (k.abstract === 'both' && lang !== 'en' && str(doc.abstractEn).trim()) {
    const titleEn = str(meta.titleEn).trim();
    const opened = line(titleEn, { size: look.heading[0], bold: true }, { align: 'center', line: 300, after: 200, pageBreak: true, side: 'L' });
    children.push(...opened);
    toc.push({ title: WORDS.en.abstract, level: 1 });
    children.push(...line(WORDS.en.abstract, { size: look.heading[0], bold: true },
      { align: 'center', line: 300, after: 120, keepNext: true, pageBreak: !opened.length, heading: 1, side: 'L' }));
    children.push(...prose(doc.abstractEn, 'L'));
    children.push(...keywords(WORDS.en.keywords, Array.isArray(doc.keywordsEn) ? doc.keywordsEn : [], 'L'));
  }

  // The contents, now that the headings it lists are known. Word fills in
  // the page numbers when the file is opened (`updateFields`); until then
  // each entry is its heading.
  const hasToc = tocAt >= 0 && toc.length > 0;
  if (hasToc) {
    children.splice(tocAt, 0, ...frontTitle(w.contents, thesis), new L.TableOfContents(w.contents, {
      hyperlink: true,
      headingStyleRange: '1-4',
      cachedEntries: toc.map((t) => ({ title: clean(t.title), level: t.level })),
    }));
  }

  // LibreOffice gives the page number the look of the last run before the
  // section ends: a document that ends on a [[gap]] — an unfinished part, or
  // the thanks of a thesis with nothing after them — would have every page
  // number highlighted, as if it too were left to fill in. A plain line a
  // point high ends it instead, too small to push anything onto a new page.
  if (holed.has(children[children.length - 1])) children.push(gap(0, 2));

  // ── styles ──

  // `bidirectional` is not in the typings of a paragraph style, but the
  // library writes it with the rest of a style's paragraph properties.
  const rtlStyle = own === 'R' ? { bidirectional: true } : {};
  const runStyle = (size: number, bold = false, italic = false) => ({
    font, size, sizeComplexScript: size,
    ...(bold ? { bold: true, boldComplexScript: true } : {}),
    ...(italic ? { italics: true, italicsComplexScript: true } : {}),
    ...(own === 'R' ? { rightToLeft: true } : {}),
  });
  const headingStyle = (level: 1 | 2 | 3 | 4) => ({
    run: { ...runStyle(look.heading[level - 1], true, lang === 'en' && level === 4), color: '000000' },
    paragraph: { keepNext: true, keepLines: true, outlineLevel: level - 1, ...rtlStyle },
  });
  const tocStyle = (level: number): IParagraphStyleOptions => ({
    id: `TOC${level}`,
    name: `toc ${level}`,
    basedOn: 'Normal',
    next: 'Normal',
    uiPriority: 39,
    unhideWhenUsed: true,
    paragraph: { indent: { start: (level - 1) * 440 }, spacing: { before: level === 1 ? 120 : 0, after: 60 }, ...rtlStyle },
    run: runStyle(level === 1 ? look.body : look.body - 2, level === 1),
  });

  // The page number's paragraph is left to right in the example too: a
  // centred number has no reading side, and the number's run carries the script.
  const footer = new L.Footer({
    children: [new L.Paragraph({
      alignment: A.CENTER,
      children: [new L.TextRun({
        children: [L.PageNumber.CURRENT],
        font,
        size: look.footer,
        sizeComplexScript: look.footer,
        ...(own === 'R' ? { rightToLeft: true, language: { bidirectional: tag } } : {}),
      })],
    })],
  });

  const file = new L.Document({
    title: clean(title),
    creator: clean(author),
    lastModifiedBy: clean(author),
    features: { updateFields: hasToc },
    // Word 2010's layout, as the example: 2013's shrinks the spaces of a
    // justified line to fit another word on it, and the lines would break
    // elsewhere than the example's.
    compatibility: { version: 14 },
    styles: {
      default: {
        document: {
          run: { font, size: look.body, sizeComplexScript: look.body, language: { value: 'en-US', bidirectional: tag } },
        },
        heading1: headingStyle(1),
        heading2: headingStyle(2),
        heading3: headingStyle(3),
        heading4: headingStyle(4),
        footnoteText: { run: runStyle(look.note), paragraph: { spacing: { after: 0, line: 240 }, ...rtlStyle } },
        footnoteReference: { run: { superScript: true } },
      },
      paragraphStyles: [1, 2, 3, 4].map(tocStyle),
    },
    footnotes: notes,
    sections: [{
      properties: {
        page: {
          size: { width: PAGE.width, height: PAGE.height },
          margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, header: 720, footer: 720, gutter: 0 },
          pageNumbers: { start: 1, formatType: eastern ? L.NumberFormat.HINDI_NUMBERS : L.NumberFormat.DECIMAL },
        },
        // The cover is page one and shows no number; the first page after it shows ٢.
        ...(thesis ? { titlePage: true } : {}),
      },
      footers: { default: footer },
      children,
    }],
  });

  return { file, fixes: { rtl: own === 'R', notes: doc.style === 'footnotes', eastern } };
}

// ── the file's name ───────────────────────────────────────────────────────

/** Names Windows keeps for devices, which no file may have. */
const DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A name for the saved file, from the title: its letters in whatever script
 * they are in, its digits, spaces, `-` and `_`, and nothing a file system
 * could read as a path or refuse — no `/ \ : * ? " < > |`, no control
 * characters, no other punctuation. At most eighty characters with the
 * extension, cut where a word ends. `research.docx` when the title leaves
 * nothing.
 */
export function fileNameFor(doc: Doc): string {
  const title = str(doc?.meta?.title).normalize('NFC');
  const kept = title.replace(/[^\p{L}\p{M}\p{N}\u200C _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const max = 80 - '.docx'.length;
  const chars = Array.from(kept);
  let base = kept;
  if (chars.length > max) {
    const head = chars.slice(0, max + 1).join('');
    const at = head.lastIndexOf(' ');
    base = (at > 0 ? head.slice(0, at) : chars.slice(0, max).join('')).trim();
  }
  if (!base) return 'research.docx';
  return `${DEVICE.test(base) ? `${base}_` : base}.docx`;
}
