/**
 * The cells of an Excel workbook's first sheet, with no library (docs/WA.md, package `audience`).
 *
 * A shopkeeper's customer list is very often an `.xlsx`. An `.xlsx` is a zip of XML parts, and the two this needs are
 * small: the shared strings (every piece of text in the workbook, stored once) and the first worksheet. So this is a
 * zip central-directory reader, the platform's own raw inflate (`DecompressionStream('deflate-raw')`, which both the
 * app's web view and Node have), and a tag scanner — a few hundred lines instead of a dependency with its own zip, its
 * own XML parser and a formula engine nobody here wants.
 *
 * `researchdata.ts` reads workbooks for the research panel and was the model for this; its helpers are private to it
 * and its limits are a thesis's (256 MB), so this has its own, sized for a list of people.
 *
 * ## The file is hostile
 *
 * It arrives from anywhere: a form, a download, a stranger. So:
 *
 *   - **Nothing is allocated from what the file claims.** A zip says how large each part will be when inflated; a zip
 *     bomb says "small" and inflates to gigabytes, or says "huge" to make the reader reserve it. Here a part is inflated a
 *     chunk at a time and stopped the moment it passes the size it claimed or the ceiling (`SHEET_LIMITS`), whichever is
 *     lower, and the claim itself is never used to size a buffer.
 *   - **Every count is bounded:** entries in the directory, rows, columns, cells, strings, characters in one cell. A
 *     sheet that says its next row is row 1,000,000 does not get a million empty rows.
 *   - **No XML feature that does work.** Only the five named entities and numeric references are expanded; a DOCTYPE is
 *     skipped, so a part cannot define an entity that expands to a gigabyte or one that reads a file.
 *   - **Formulas are never evaluated.** A formula cell is the value Excel last calculated and saved beside it; macros,
 *     external links, pivot caches and every other part are never opened.
 *   - Failure is a `SheetError` with a word for the interface (`damaged`, `locked`, `too-big`…), never a crash; the
 *     audience reader turns it into a `Parsed` with a `problem`.
 *
 * ## Excel's number trap
 *
 * Excel keeps a typed phone number as a number. `07501234567` becomes 7501234567 (the zero is gone), and long ones may
 * be written in scientific form (`9.647501234567E+12`). Turning that text into a JavaScript number and back is exact for
 * integers below 2^53 — but it is one careless `toFixed` or `toPrecision` away from rounding somebody's number into a
 * stranger's. So numbers are moved between forms as *strings of digits* (`expandNumber`), never through floating point.
 * The leading zero is put back by the audience reader, which knows the country.
 */
import type { FileProblem } from './whatsappbulktypes';

/** Why a workbook could not be read. The codes are `FileProblem`'s, so the audience reader passes them on unchanged. */
export class SheetError extends Error {
  readonly code: FileProblem;
  constructor(code: FileProblem) {
    super(code);
    this.name = 'SheetError';
    this.code = code;
  }
}

/**
 * The ceilings. A list of five thousand people with a dozen columns is well under a megabyte of XML; these leave room
 * for a messy real workbook (formatting, many sheets, a picture) and none for a bomb.
 */
export const SHEET_LIMITS = {
  /** The workbook file itself. */
  file: 10 * 1024 * 1024,
  /** One part, inflated. */
  part: 24 * 1024 * 1024,
  /** Every part read, inflated, together. */
  inflated: 48 * 1024 * 1024,
  /** Entries in the zip's directory. A workbook has a few dozen. */
  entries: 10_000,
  /** Rows of the sheet read (the audience keeps at most `LIMITS.recipients` people). */
  rows: 50_000,
  /** Columns of a row read; cells further right are passed over. */
  cols: 256,
  /** Cells with something in them, in all. */
  cells: 400_000,
  /** Shared strings kept. */
  strings: 400_000,
  /** Characters kept of one cell. */
  cellChars: 1_000,
} as const;

// ── numbers, as digits ────────────────────────────────────────────────────

/** A plain decimal number, optionally in scientific form. Anchored, no nested repetition: linear on any input. */
const NUMBER_TEXT = /^([0-9]{1,30})(?:\.([0-9]{0,30}))?(?:[eE]([+-]?[0-9]{1,3}))?$/;

/**
 * A number's integer digits, moved by string arithmetic, or `null` when it is not a whole number.
 *
 * `9.647501234567E+12` → `9647501234567`; `7501234567.0` → `7501234567`; `7.501234567E9` → `7501234567`. `padded` is
 * how many zeros had to be written that the text did not hold: `9.6475012345E+11` → `964750123450` with one. Where the
 * text came from a spreadsheet's own XML that is exact (Excel stores the whole double); where it came from a CSV that
 * Excel wrote, a large `padded` means Excel rounded the number for display (`9.64751E+11`) and the digits are lost —
 * the audience reader refuses those rather than message whoever owns the rounded number.
 */
export function expandNumber(text: string): { digits: string; padded: number } | null {
  const m = NUMBER_TEXT.exec(text);
  if (!m) return null;
  const all = m[1] + (m[2] ?? '');
  const point = m[1].length + Number(m[3] ?? 0);
  if (point <= 0 || point > 30) return null;
  let whole: string;
  let padded = 0;
  if (point >= all.length) {
    padded = point - all.length;
    whole = all + '0'.repeat(padded);
  } else {
    // A fraction that is not all zeros is not a whole number, and so not a phone number either.
    for (let i = point; i < all.length; i++) if (all.charCodeAt(i) !== 48) return null;
    whole = all.slice(0, point);
  }
  let lead = 0;
  while (lead < whole.length - 1 && whole.charCodeAt(lead) === 48) lead++;
  return { digits: whole.slice(lead), padded };
}

// ── the zip ───────────────────────────────────────────────────────────────

const u16 = (b: Uint8Array, at: number): number => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number): number => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

interface Entry {
  flags: number;
  method: number;
  packed: number;
  size: number;
  /** Where its local header is. */
  offset: number;
}

/** Whether the bytes begin like a zip (a local file header, or the end record of an empty one). */
export const isZip = (b: Uint8Array): boolean =>
  b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && ((b[2] === 3 && b[3] === 4) || (b[2] === 5 && b[3] === 6));

/**
 * An OLE compound file: what a password-protected `.xlsx` really is (Office encrypts the whole package into one), and
 * what an old `.xls` is. Neither can be read here, and both deserve the same sentence: save it again as a plain `.xlsx`.
 */
export const isOle = (b: Uint8Array): boolean =>
  b.length >= 8 && u32(b, 0) === 0xe011cfd0 && u32(b, 4) === 0xe11ab1a1;

/**
 * The zip's entries, from its central directory — the index at the end, which has every entry's real sizes even when
 * the local headers leave them to a trailing descriptor. Names are keyed in lower case: the package format says part
 * names are compared without regard to case.
 */
function entriesOf(b: Uint8Array): Map<string, Entry> {
  // The end record is the last thing in the archive, followed only by a comment of at most 64 KB.
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (u32(b, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new SheetError('damaged');
  const count = u16(b, end + 10);
  const size = u32(b, end + 12);
  const start = u32(b, end + 16);
  // ZIP64 keeps its real numbers elsewhere and leaves these at their maximum; no workbook a person attaches needs it.
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new SheetError('damaged');
  if (u16(b, end + 4) !== 0 || u16(b, end + 6) !== 0 || start + size > end) throw new SheetError('damaged');
  const utf8 = new TextDecoder();
  const out = new Map<string, Entry>();
  let p = start;
  for (let n = 0; n < count && n < SHEET_LIMITS.entries; n++) {
    if (p + 46 > end || u32(b, p) !== 0x02014b50) throw new SheetError('damaged');
    const nameLength = u16(b, p + 28);
    if (p + 46 + nameLength > end) throw new SheetError('damaged');
    const entry: Entry = {
      flags: u16(b, p + 8),
      method: u16(b, p + 10),
      packed: u32(b, p + 20),
      size: u32(b, p + 24),
      offset: u32(b, p + 42),
    };
    const name = utf8.decode(b.subarray(p + 46, p + 46 + nameLength)).replace(/\\/g, '/').toLowerCase();
    if (!out.has(name)) out.set(name, entry);
    p += 46 + nameLength + u16(b, p + 30) + u16(b, p + 32);
  }
  return out;
}

/**
 * Raw inflate on the platform's `DecompressionStream`, read a chunk at a time and stopped past `cap`. The cap is what
 * makes a zip bomb harmless: its output is never held beyond the size its own directory claimed.
 */
async function inflate(data: Uint8Array, cap: number): Promise<Uint8Array> {
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch {
    throw new SheetError('cannot-inflate');
  }
  const writer = ds.writable.getWriter();
  // Not awaited before reading: the stream only takes more input when its output is read.
  const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  written.catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) {
        void reader.cancel().catch(() => {});
        throw new SheetError('damaged');
      }
      chunks.push(value);
    }
    await written;
  } catch (e) {
    throw e instanceof SheetError ? e : new SheetError('damaged');
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** An opened package: a part's text by name, with a budget for everything inflated. */
interface Package {
  text(part: string): Promise<string | null>;
}

function openPackage(b: Uint8Array): Package {
  const entries = entriesOf(b);
  let budget: number = SHEET_LIMITS.inflated;
  return {
    async text(part) {
      const e = entries.get(part.replace(/^\/+/, '').toLowerCase());
      if (!e) return null;
      if (e.flags & 1) throw new SheetError('locked');
      const p = e.offset;
      if (p + 30 > b.length || u32(b, p) !== 0x04034b50) throw new SheetError('damaged');
      const from = p + 30 + u16(b, p + 26) + u16(b, p + 28);
      if (from + e.packed > b.length) throw new SheetError('damaged');
      if (e.size > SHEET_LIMITS.part || e.size > budget) throw new SheetError('too-big');
      const raw = b.subarray(from, from + e.packed);
      let bytes: Uint8Array;
      if (e.method === 0) {
        if (e.packed !== e.size) throw new SheetError('damaged');
        bytes = raw;
      } else if (e.method === 8) {
        bytes = await inflate(raw, e.size);
        if (bytes.length !== e.size) throw new SheetError('damaged');
      } else {
        throw new SheetError('damaged');
      }
      budget -= bytes.length;
      return decodePart(bytes);
    },
  };
}

/** A part's text: UTF-8 unless a byte-order mark says UTF-16, which the format allows. */
function decodePart(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder().decode(b);
}

// ── XML, as much of it as two parts need ──────────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** The five named entities and numeric references; nothing declared in a DOCTYPE is ever expanded. */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z]{2,4});/g, (all, e: string) => {
    if (e[0] !== '#') return ENTITIES[e] ?? all;
    const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : '';
  });
}

type Token =
  | { t: 'open'; name: string; attrs: string; empty: boolean }
  | { t: 'close'; name: string }
  | { t: 'text'; text: string };

/**
 * The tags and text of a part, in order, with names stripped of their prefix (`x:row` is `row`: strict workbooks and
 * some exporters prefix the main namespace). Declarations, processing instructions and comments are passed over; CDATA
 * is text. It checks nothing: what matters with a part that is not well formed is that the walk ends, and it does, in
 * one pass — every step moves forward by `indexOf`.
 */
function* tokens(xml: string): Generator<Token> {
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    const stop = lt === -1 ? n : lt;
    if (stop > i) yield { t: 'text', text: decodeEntities(xml.slice(i, stop)) };
    if (lt === -1) return;
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      yield { t: 'text', text: xml.slice(lt + 9, e === -1 ? n : e) };
      i = e === -1 ? n : e + 3;
      continue;
    }
    if (xml.startsWith('<!--', lt)) {
      const e = xml.indexOf('-->', lt + 4);
      i = e === -1 ? n : e + 3;
      continue;
    }
    // A tag ends at the first `>` outside a quoted attribute value.
    let j = lt + 1;
    let quote = 0;
    for (; j < n; j++) {
      const c = xml.charCodeAt(j);
      if (quote) { if (c === quote) quote = 0; } else if (c === 34 || c === 39) quote = c; else if (c === 62) break;
    }
    const body = xml.slice(lt + 1, j);
    i = j + 1;
    if (body[0] === '?' || body[0] === '!') continue;
    if (body[0] === '/') { yield { t: 'close', name: local(body.slice(1).trim()) }; continue; }
    const empty = body.endsWith('/');
    const inner = empty ? body.slice(0, -1) : body;
    const space = inner.search(/[\s]/);
    yield space === -1
      ? { t: 'open', name: local(inner), attrs: '', empty }
      : { t: 'open', name: local(inner.slice(0, space)), attrs: inner.slice(space), empty };
  }
}

/** A name without its namespace prefix. */
const local = (name: string): string => name.slice(name.indexOf(':') + 1);

const ATTRIBUTE = new Map<string, RegExp>();

/** One attribute's value, decoded, or `null`. `r:id` is matched under any prefix, as `id` after a colon. */
function attr(attrs: string, name: string): string | null {
  if (!attrs) return null;
  let re = ATTRIBUTE.get(name);
  if (!re) {
    re = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTRIBUTE.set(name, re);
  }
  const m = re.exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
}

interface Relationship { id: string; type: string; target: string }

/** The relationships a `.rels` part lists. External ones (a link to another file or a web address) are left out. */
function relationshipsIn(xml: string | null): Relationship[] {
  const out: Relationship[] = [];
  for (const tok of tokens(xml ?? '')) {
    if (tok.t !== 'open' || tok.name !== 'Relationship' || attr(tok.attrs, 'TargetMode') === 'External') continue;
    out.push({ id: attr(tok.attrs, 'Id') ?? '', type: attr(tok.attrs, 'Type') ?? '', target: attr(tok.attrs, 'Target') ?? '' });
    if (out.length > 1000) break;
  }
  return out;
}

/** Where a part's relationships are: `xl/workbook.xml` → `xl/_rels/workbook.xml.rels`. */
function relsFor(part: string): string {
  const slash = part.lastIndexOf('/');
  return `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
}

/** A relationship's target as a part name: relative to the part that names it, or from the root. */
function resolvePart(from: string, target: string): string {
  let t = target;
  try { t = decodeURIComponent(target); } catch { /* not percent-encoded after all */ }
  const base = t.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of t.split('/')) {
    if (seg === '..') base.pop();
    else if (seg && seg !== '.') base.push(seg);
  }
  return base.join('/');
}

/** Excel's escape for characters XML cannot hold: `_x000D_` is a carriage return. */
const unescapeExcel = (s: string): string =>
  s.includes('_x') ? s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16))) : s;

/** A cell reference's column, from zero: `C5` → 2, `AA1` → 26; -1 when there are no letters. Bounded to three letters. */
function columnOf(ref: string): number {
  let n = 0;
  let i = 0;
  for (; i < ref.length && i < 4; i++) {
    const c = ref.charCodeAt(i) | 32;
    if (c < 97 || c > 122) break;
    n = n * 26 + (c - 96);
  }
  return i === 0 ? -1 : n - 1;
}

/** Text kept of one cell: capped, so one enormous cell cannot hold the reader. */
const capCell = (s: string): string => (s.length > SHEET_LIMITS.cellChars ? s.slice(0, SHEET_LIMITS.cellChars) : s);

// ── the workbook ──────────────────────────────────────────────────────────

/**
 * The shared strings: every piece of text in the workbook, stored once and pointed at by index. A rich-text string is
 * its runs joined; the phonetic guide (`rPh`) is not part of it.
 */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  let cur: string | null = null;
  let inText = 0;
  let phonetic = 0;
  for (const tok of tokens(xml)) {
    if (tok.t === 'text') {
      if (cur !== null && inText && !phonetic && cur.length < SHEET_LIMITS.cellChars) cur += tok.text;
      continue;
    }
    if (tok.t === 'open') {
      if (tok.name === 'si') { if (tok.empty) out.push(''); else cur = ''; }
      else if (tok.name === 't' && !tok.empty) inText++;
      else if (tok.name === 'rPh' && !tok.empty) phonetic++;
    } else if (tok.name === 'si') {
      out.push(capCell(unescapeExcel(cur ?? '')));
      cur = null;
      if (out.length >= SHEET_LIMITS.strings) break;
    } else if (tok.name === 't') inText = Math.max(0, inText - 1);
    else if (tok.name === 'rPh') phonetic = Math.max(0, phonetic - 1);
  }
  return out;
}

/** What a sheet came to: its rows by row number (`rows[0]` is row 1), and whether a ceiling cut it short. */
export interface Sheet {
  rows: string[][];
  cut: boolean;
}

/**
 * A worksheet's cells, where their references put them: `rows[r - 1][c]`, empty strings in the gaps, so that column C
 * is column C on every row and row 7 is row 7 (the audience reader reports a bad number by its row). Trailing empty
 * cells are not kept.
 */
function sheetRows(xml: string, strings: readonly string[]): Sheet {
  const rows: string[][] = [];
  let cut = false;
  let cells = 0;
  let inData = false;
  let row: string[] | null = null;
  let rowAt = 0;
  let col = -1;
  let cell: { type: string; value: string; inline: string } | null = null;
  let inValue = 0;
  let inInline = 0;
  let inText = 0;
  let phonetic = 0;

  for (const tok of tokens(xml)) {
    if (tok.t === 'text') {
      if (!cell) continue;
      if (inValue && cell.value.length < SHEET_LIMITS.cellChars) cell.value += tok.text;
      else if (inInline && inText && !phonetic && cell.inline.length < SHEET_LIMITS.cellChars) cell.inline += tok.text;
      continue;
    }
    const name = tok.name;
    if (tok.t === 'open') {
      if (name === 'sheetData') { inData = !tok.empty; continue; }
      if (!inData) continue;
      if (name === 'row') {
        const r = Number.parseInt(attr(tok.attrs, 'r') ?? '', 10);
        // Rows come in order; one that says otherwise is put after the last, never before it.
        rowAt = r > rowAt ? r : rowAt + 1;
        if (rowAt > SHEET_LIMITS.rows) { cut = true; break; }
        row = tok.empty ? null : [];
        col = -1;
      } else if (name === 'c' && row) {
        const ref = attr(tok.attrs, 'r');
        const at = ref ? columnOf(ref) : -1;
        col = at >= 0 ? at : col + 1;
        if (tok.empty) continue;
        cell = { type: attr(tok.attrs, 't') ?? 'n', value: '', inline: '' };
      } else if (name === 'v' && cell && !tok.empty) inValue++;
      else if (name === 'is' && cell && !tok.empty) inInline++;
      else if (name === 't' && cell && !tok.empty) inText++;
      else if (name === 'rPh' && !tok.empty) phonetic++;
      // `f` (a formula) is deliberately not read: the cell's value is the result Excel saved.
      continue;
    }
    if (name === 'sheetData') { inData = false; continue; }
    if (name === 'v') inValue = Math.max(0, inValue - 1);
    else if (name === 'is') inInline = Math.max(0, inInline - 1);
    else if (name === 't') inText = Math.max(0, inText - 1);
    else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
    else if (name === 'c' && cell && row) {
      const text = capCell(cellText(cell, strings));
      if (text && col < SHEET_LIMITS.cols) {
        while (row.length < col) row.push('');
        row[col] = text;
        if (++cells >= SHEET_LIMITS.cells) { cut = true; cell = null; break; }
      }
      cell = null;
    } else if (name === 'row' && row) {
      if (row.length) {
        while (rows.length < rowAt - 1) rows.push([]);
        rows[rowAt - 1] = row;
      }
      row = null;
    }
  }
  // A row the cell ceiling stopped inside is kept as far as it was read.
  if (row && row.length) {
    while (rows.length < rowAt - 1) rows.push([]);
    rows[rowAt - 1] = row;
  }
  return { rows, cut };
}

/** One cell as text. A number is its exact digits when it is whole (Excel's trap, above); otherwise as stored. */
function cellText(cell: { type: string; value: string; inline: string }, strings: readonly string[]): string {
  const v = cell.value;
  switch (cell.type) {
    case 's': {
      const i = Number.parseInt(v, 10);
      return i >= 0 && i < strings.length ? strings[i] : '';
    }
    case 'inlineStr': return unescapeExcel(cell.inline).trim();
    case 'b': return v.trim() === '1' || v.trim().toLowerCase() === 'true' ? 'TRUE' : 'FALSE';
    case 'e': return '';
    case 'n': {
      const t = v.trim();
      const whole = expandNumber(t);
      return whole ? whole.digits : t;
    }
    default: return unescapeExcel(v).trim(); // str (a formula's text result), d (an ISO date)
  }
}

/** The content types that mark a workbook's main part: ordinary, macro-enabled, template, add-in. */
const WORKBOOK_TYPE = /(spreadsheetml\.(sheet|template)\.main\+xml|ms-excel\.(sheet|template|addin)\.macroEnabled\.main\+xml)/i;

/**
 * The first sheet of a workbook, as rows of cell text, and whether a ceiling cut it short.
 *
 * The workbook is found the way the format says — `[Content_Types].xml` names its main part — then the package's root
 * relationships, then the usual name. The first *visible* sheet in the workbook's own order is the one read: a hidden
 * first sheet is usually a lookup table nobody meant to send to. Throws `SheetError`, never anything else.
 */
export async function readSheet(bytes: Uint8Array): Promise<Sheet> {
  try {
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) throw new SheetError('empty');
    if (bytes.length > SHEET_LIMITS.file) throw new SheetError('too-big');
    if (isOle(bytes)) throw new SheetError('locked');
    if (!isZip(bytes)) throw new SheetError('not-a-sheet');
    const pkg = openPackage(bytes);

    const types = await pkg.text('[Content_Types].xml');
    if (types === null) throw new SheetError('not-a-sheet');
    let book: string | null = null;
    for (const tok of tokens(types)) {
      if (tok.t === 'open' && tok.name === 'Override' && WORKBOOK_TYPE.test(attr(tok.attrs, 'ContentType') ?? '')) {
        book = (attr(tok.attrs, 'PartName') ?? '').replace(/^\/+/, '');
        break;
      }
    }
    if (!book) {
      const root = relationshipsIn(await pkg.text('_rels/.rels')).find((r) => r.type.endsWith('/officeDocument'));
      book = root ? resolvePart('', root.target) : 'xl/workbook.xml';
    }
    const bookXml = await pkg.text(book);
    if (bookXml === null) throw new SheetError('not-a-sheet');

    const rels = relationshipsIn(await pkg.text(relsFor(book)));
    let sheetPart = '';
    for (const tok of tokens(bookXml)) {
      if (tok.t !== 'open' || tok.name !== 'sheet') continue;
      const state = attr(tok.attrs, 'state');
      if (state === 'hidden' || state === 'veryHidden') continue;
      const rel = rels.find((r) => r.id === attr(tok.attrs, 'id'));
      // A chart sheet is a picture, not cells.
      if (rel && rel.type.endsWith('/worksheet')) { sheetPart = resolvePart(book, rel.target); break; }
    }
    const sheetXml = await pkg.text(sheetPart || 'xl/worksheets/sheet1.xml');
    if (sheetXml === null) throw new SheetError('not-a-sheet');

    const stringsRel = rels.find((r) => r.type.endsWith('/sharedStrings'));
    const strings = sharedStrings(await pkg.text(stringsRel ? resolvePart(book, stringsRel.target) : 'xl/sharedStrings.xml'));
    return sheetRows(sheetXml, strings);
  } catch (e) {
    throw e instanceof SheetError ? e : new SheetError('damaged');
  }
}

/** The first sheet's rows of cell text (`rows[0]` is row 1). See `readSheet`; throws `SheetError`. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  return (await readSheet(bytes)).rows;
}
