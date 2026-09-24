/**
 * The researcher's own data, read into text a model can be given.
 *
 * A results chapter written without the researcher's numbers is either a gap
 * or a fabrication, and the system prompt forbids the second. So the numbers
 * have to come in: the survey export, the spreadsheet of scores, the interview
 * notes, the draft chapter in Word. This file turns each of those into a
 * `DataFile` — plain text, laid out so a model reads it the way a person reads
 * the original.
 *
 * ## Read here, not by the model
 *
 * A Word file and a workbook are ZIP archives of XML. Handing one to a model
 * would be asking it to guess at a format; reading it here is a few hundred
 * lines and gives the same answer every time. So the archive is opened from
 * its central directory, the parts that hold the text are inflated, and the
 * XML is walked for exactly the elements that are text. Only a PDF goes to a
 * model, because its text cannot be recovered without laying out its pages —
 * and the prompt for that (`pdfPrompt`) asks for a transcription, nothing
 * added and nothing summarised, so what comes back is the file's text rather
 * than a model's account of it.
 *
 * ## Tables stay tables
 *
 * The part of a file that matters most is usually a table: the means and
 * standard deviations, the frequencies, the scores. Flattened into a stream of
 * words, a table is noise, and a model reading noise will still report
 * numbers. So every table — a CSV, a Word table, a sheet — comes out the same
 * way: one row per line, cells separated by a tab, the header row first, and
 * the empty cells kept, so that column four is column four on every line.
 *
 * A number is what the cell holds, not what a format rounds it to. The two
 * exceptions are the ones a reader would get wrong: a date is written as a
 * date rather than as Excel's count of days since 1900, and a percentage as
 * a percentage rather than as the fraction behind it — 0.45 in a column the
 * researcher sees as 45% would be reported as 0.45%.
 *
 * ## Pure
 *
 * No Tauri and no React. The panel reads the bytes through the human-only
 * readers — a person chose the file in a picker — and hands them here. The one
 * platform piece, raw inflate, is injected (`Inflate`), so the reader runs in
 * Node against `node:zlib` and in the webview on `DecompressionStream`.
 *
 * ## Refused, and said so
 *
 * A file that cannot be read is refused with a sentence that names it — a
 * password, a damaged archive, a Word file with no document in it — rather
 * than attached as nothing. An empty attachment the researcher believes was
 * read is data the document silently lacks.
 */

import type { DataFile, DocLang } from './research';

// ── which files ───────────────────────────────────────────────────────────

/**
 * What the file picker offers. Not .doc, .xls or .ppt: those are binary
 * formats with nothing in common with their successors, and every copy of
 * Office since 2007 saves the ones listed here.
 */
export const DATA_EXTENSIONS: string[] = ['txt', 'md', 'csv', 'tsv', 'json', 'docx', 'xlsx', 'pdf'];

const TEXT_EXTENSIONS = new Set(['txt', 'md', 'csv', 'tsv', 'json']);

/** A name's extension, lower-case, or '' when it has none. */
function extensionOf(name: string): string {
  const m = /\.([^./\\]+)$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/**
 * How a file is read, from its name; `null` for one that cannot be — the old
 * binary formats and anything else — for which the panel says to save it as
 * .docx or .xlsx.
 */
export function kindOfName(name: string): 'text' | 'docx' | 'xlsx' | 'pdf' | null {
  const ext = extensionOf(name);
  if (TEXT_EXTENSIONS.has(ext)) return 'text';
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pdf') return ext;
  return null;
}

// ── how much ──────────────────────────────────────────────────────────────

/**
 * The most of one file that is kept, in characters. Far more than any single
 * request carries (`DATA_BUDGET` shares out a few tens of thousands), so the
 * limit is on what is stored with the document, not on what the model reads.
 */
export const MAX_DATA_CHARS = 200_000;

/**
 * Text within the limit: cut at the end of a line when one is near, so a
 * table never ends in half a row, and never between the halves of a
 * character outside the Basic Multilingual Plane.
 */
function capped(text: string): { text: string; cut: boolean } {
  if (text.length <= MAX_DATA_CHARS) return { text, cut: false };
  let end = MAX_DATA_CHARS;
  const line = text.lastIndexOf('\n', end);
  if (line > end * 0.8) end = line;
  else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return { text: text.slice(0, end).trimEnd(), cut: true };
}

/**
 * Text as every reader here hands it on: no byte-order mark, `\n` line
 * endings, no control characters but the tab and the line break, and no
 * trailing space at the end of a line or of the whole.
 */
function tidy(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── plain text and CSV ────────────────────────────────────────────────────

/**
 * Rows of cells, as RFC 4180 reads them: a quote opens a field only at its
 * start (spaces before it allowed), `""` inside one is a quote, and a quoted
 * field may hold the delimiter and line breaks. A quote anywhere else is a
 * character — 5" is five inches.
 */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  /** This field has had its quoted part; another quote in it is a character. */
  let wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = false;
      continue;
    }
    if (c === '"' && !wasQuoted && cell.trim() === '') { quoted = true; wasQuoted = true; cell = ''; continue; }
    if (c === delim || c === '\n') {
      row.push(cell);
      cell = '';
      wasQuoted = false;
      if (c === '\n') { rows.push(row); row = []; }
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** A cell on one line: a break inside a quoted field, or a tab, would start a new row or column. */
const oneLine = (cell: string): string => cell.replace(/\s+/g, ' ').trim();

/** Rows as tab-separated lines: trailing empty cells dropped, a row of nothing an empty line. */
function asLines(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => {
    const cells = r.map(oneLine);
    while (cells.length && cells[cells.length - 1] === '') cells.pop();
    return cells.join('\t');
  }).join('\n');
}

/** A number as some locale writes it: 3.5, 3,5, 1.234,5, the same in Arabic-Indic digits, -12%, 1.5E-3. */
const NUMBER = /^[-+\u2212]?[0-9\u0660-\u0669\u06F0-\u06F9]+(?:[.,\u066B\u066C][0-9\u0660-\u0669\u06F0-\u06F9]+)*(?:[eE][-+]?[0-9]+)?\s*[%\u066A]?$/;

/**
 * How one way of splitting a text reads: its fields, and the share of its
 * filled cells that are numbers. A table's cells mostly are, and the wrong
 * delimiter cuts them in half — 3,5;4,2 at its commas is 3 | 5;4 | 2, one
 * more field than at its semicolons, and fewer numbers.
 */
interface Split { d: string; n: number; numeric: number }

function splitOf(d: string, rows: readonly (readonly string[])[]): Split {
  let filled = 0;
  let numbers = 0;
  for (const r of rows) {
    for (const c of r) {
      const t = c.trim();
      if (!t) continue;
      filled++;
      if (NUMBER.test(t)) numbers++;
    }
  }
  return { d, n: rows[0]?.length ?? 0, numeric: filled ? numbers / filled : 0 };
}

/** The better of two splits: more of it numbers, then more fields; the earlier candidate on a tie. */
const better = (a: Split | null, b: Split): Split => (
  !a || b.numeric > a.numeric || (b.numeric === a.numeric && b.n > a.n) ? b : a
);

/**
 * The delimiter a text's first rows agree on, or `null`.
 *
 * Agreeing means every non-empty row of the sample splits into the same number
 * of fields, two or more, and the fields are short, as a table's are. Of the
 * delimiters that agree, the one whose cells are most often numbers wins, and
 * then the one that splits into most; and the winner has to have `min` fields.
 * `;` is here because Excel in a country that writes 1,5 for one and a half
 * saves its CSV with semicolons — and a file of such numbers with no header
 * agrees at its commas too, which is why numbers are asked about before fields.
 *
 * When the file does not say it is a table (`guessing`), rows that mostly end
 * like sentences are prose, however evenly its commas fall.
 */
function agreedDelimiter(text: string, candidates: readonly string[], o: { min: number; rows: number; guessing: boolean }): string | null {
  const SAMPLE = 20_000;
  const sample = text.length > SAMPLE ? text.slice(0, text.lastIndexOf('\n', SAMPLE) + 1 || SAMPLE) : text;
  if (o.guessing) {
    const lines = sample.split('\n').filter((l) => l.trim()).slice(0, 50);
    if (lines.filter((l) => /[.!?\u061F\u2026]["'\u201D)]*$/.test(l.trim())).length * 2 > lines.length) return null;
  }
  let best: Split | null = null;
  for (const d of candidates) {
    const rows = parseDelimited(sample, d).slice(0, 50).filter((r) => r.some((c) => c.trim()));
    if (rows.length < o.rows) continue;
    const n = rows[0].length;
    if (n < 2 || !rows.every((r) => r.length === n)) continue;
    // Prose split at its commas, or indented with a tab, has long cells; a table has short ones.
    const cells = rows.flat();
    if (cells.reduce((sum, c) => sum + c.length, 0) / cells.length > 60) continue;
    best = better(best, splitOf(d, rows));
  }
  // A .txt of 3,5;4,2 splits best at its semicolons, into two fields — too few
  // to call it a table, and no reason to cut it at its decimal commas instead.
  return best && best.n >= o.min ? best.d : null;
}

/**
 * For a file that says it is CSV: the delimiter its first line splits best at
 * (`better`), when its rows do not agree.
 */
function likeliestDelimiter(text: string): string {
  const first = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  return [',', ';', '\t'].reduce<Split | null>((a, d) => better(a, splitOf(d, parseDelimited(first, d).slice(0, 1))), null)?.d ?? ',';
}

/**
 * A text file as a `DataFile`.
 *
 * CSV and TSV — by their extension, or a .txt that is plainly one — become a
 * table: the quoting undone, one row per line, cells separated by tabs, the
 * header kept. Markdown and JSON are read as they are, because they already
 * read well; everything else is text. `truncated` is the reader's own flag
 * (the file was longer than it reads), and is set here too when the text is
 * cut to `MAX_DATA_CHARS`.
 *
 * Refused, by name, when its letters did not survive being read: the reader
 * decodes UTF-8 and puts U+FFFD where a byte is not, and Excel's plain "CSV"
 * on an Arabic copy of Windows is saved in Windows-1256, every Arabic letter
 * of which is such a byte. A survey whose answers are all question marks is
 * not data, and the model would still write about it.
 */
export function fromText(o: { id: string; name: string; text: string; bytes: number; truncated: boolean }): DataFile {
  const lost = (o.text.match(/\uFFFD/g) ?? []).length;
  if (lost > 2 && lost * 100 > o.text.length) {
    throw new Error(`${o.name}: this file is not saved as UTF-8, so its letters cannot be read. In Excel, save it as "CSV UTF-8"; in another editor, save it with the UTF-8 encoding; then attach it again.`);
  }
  const text = tidy(o.text);
  const ext = extensionOf(o.name);
  let delim: string | null = null;
  if (ext === 'tsv') delim = '\t';
  else if (ext === 'csv') delim = agreedDelimiter(text, [',', ';', '\t'], { min: 2, rows: 1, guessing: false }) ?? likeliestDelimiter(text);
  // Plainly delimited: three rows or more that agree, and for a comma or a
  // semicolon three columns or more, because two clauses a line is prose.
  else if (ext !== 'md' && ext !== 'json') {
    delim = agreedDelimiter(text, ['\t'], { min: 2, rows: 3, guessing: true })
      ?? agreedDelimiter(text, [',', ';'], { min: 3, rows: 3, guessing: true });
  }
  const body = delim ? tidy(asLines(parseDelimited(text, delim))) : text;
  const { text: kept, cut } = capped(body);
  return { id: o.id, name: o.name, kind: delim ? 'table' : 'text', text: kept, bytes: o.bytes, truncated: o.truncated || cut };
}

/**
 * A PDF's transcription as a `DataFile`: what a model wrote in answer to
 * `pdfPrompt`, with a code fence around the whole of it taken off, tidied and
 * cut like any other. `truncated` is the caller's — a transcription that
 * stopped at `max_tokens` did not reach the end of the file.
 */
export function fromPdf(o: { id: string; name: string; text: string; bytes: number; truncated: boolean }): DataFile {
  const fenced = /^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(o.text);
  const { text, cut } = capped(tidy(fenced ? fenced[1] : o.text));
  return { id: o.id, name: o.name, kind: 'pdf', text, bytes: o.bytes, truncated: o.truncated || cut };
}

// ── bytes ─────────────────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Each base64 character's value; base64url's two spellings too. -1 for anything else. */
const B64_VALUE = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

/**
 * Base64 to bytes, by hand.
 *
 * `atob` makes a binary string of the whole file first — sixteen megabytes of
 * it for the largest workbook the reader lets through — and a copy of that
 * again to reach bytes. This reads the characters once, straight into the
 * array, whatever the length. Line breaks and spaces are skipped, so a
 * wrapped encoding reads too, and it stops at the padding.
 */
export function bytesOf(base64: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((base64.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < base64.length; i++) {
    const c = base64.charCodeAt(i);
    if (c === 61) break; // '='
    const v = c < 128 ? B64_VALUE[c] : -1;
    if (v < 0) continue;
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, n);
}

/**
 * A text file's bytes as its text, or `null` when they are not text.
 *
 * The app's own reader takes UTF-8 and turns away a file with a NUL in it as
 * binary; Excel's "Unicode Text" — what Excel on an Arabic copy of Windows
 * offers for a tab-separated export — is UTF-16, with a NUL in every tab and
 * digit. So the panel reads such a file's bytes and asks here. UTF-8, with its
 * byte-order mark or without; UTF-16 either way round by its mark; and UTF-16
 * LE without one, when a NUL is the second byte of many of its characters and
 * the first of almost none. What is not valid UTF-8, or still holds a NUL once
 * decoded, is binary. The mark is not part of the text.
 */
export function textOfBytes(bytes: Uint8Array): string | null {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else {
    const n = Math.min(bytes.length, 8192) >> 1;
    let first = 0;
    let second = 0;
    for (let i = 0; i < n; i++) {
      if (bytes[2 * i] === 0) first++;
      if (bytes[2 * i + 1] === 0) second++;
    }
    // Arabic in UTF-16 has no NUL in it, but its spaces, tabs and digits do.
    if (second && second * 8 >= n && first * 8 <= second) encoding = 'utf-16le';
  }
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: encoding === 'utf-8' }).decode(bytes);
  } catch {
    return null;
  }
  return text.includes('\0') ? null : text;
}

/**
 * How a ZIP entry's deflated bytes are inflated: raw deflate, no header.
 * `inflateRaw` in the app, `node:zlib` in a test if it likes.
 */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

/**
 * More than any honest part of a workbook the reader lets through could
 * inflate to. An entry that goes past it is lying about its size, which is
 * what a ZIP bomb does.
 */
const MAX_INFLATED = 256 * 1024 * 1024;

/**
 * A platform that cannot inflate at all. Kept apart from a failure to inflate
 * one entry, which means the file is damaged: telling somebody their thesis
 * is damaged because their system's web view is old would send them looking
 * for a problem they do not have.
 */
class CannotInflate extends Error {}

/**
 * Raw inflate on the platform's `DecompressionStream` — the webview has it,
 * and so does Node. Read chunk by chunk, so an entry that inflates past
 * `MAX_INFLATED` is stopped rather than allowed to fill the memory.
 */
export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  let ds: DecompressionStream;
  try {
    ds = new DecompressionStream('deflate-raw');
  } catch {
    throw new CannotInflate('this system cannot open compressed files here, so Word and Excel files cannot be read. Save it as CSV or as text, and attach that.');
  }
  const writer = ds.writable.getWriter();
  // Not awaited before reading: the stream only takes more when its output is read.
  const written = writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close());
  // A failure here is the same one the reader reports; handled so it is never unhandled.
  written.catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED) {
      void reader.cancel().catch(() => {});
      throw new Error('This inflates to more than any real document holds.');
    }
    chunks.push(value);
  }
  await written;
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

// ── the archive ───────────────────────────────────────────────────────────

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

/** The largest part that is inflated at all. A sheet this big is refused, with a way round it. */
const MAX_PART = 128 * 1024 * 1024;

/** The sentences a file is refused with. Each names the file, the way the Rust readers do. */
const REFUSE = {
  damaged: (name: string) => new Error(`${name}: this file is damaged, or it is not really a Word or Excel file.`),
  locked: (name: string) => new Error(`${name}: this file is protected by a password, or saved in the old .doc or .xls format. Open it, save a copy as .docx or .xlsx without a password, and attach that.`),
  encrypted: (name: string) => new Error(`${name}: this file is encrypted. Save a copy without the password, and attach that.`),
  zip64: (name: string) => new Error(`${name}: this file is stored in the ZIP64 form, which is not read here. Save it again from Word or Excel, and attach the new copy.`),
  method: (name: string) => new Error(`${name}: part of this file is compressed in a way that is not read here. Save it again from Word or Excel, and attach the new copy.`),
  large: (name: string) => new Error(`${name}: part of this file is too large to read here. Save the part you need as a smaller file, or as CSV, and attach that.`),
  noDocument: (name: string) => new Error(`${name}: there is no document in this Word file.`),
  noSheets: (name: string) => new Error(`${name}: there are no worksheets in this Excel file.`),
};

/**
 * A ZIP's entries, from its central directory — the index at the end of the
 * archive, which has every entry's real sizes even when the local headers
 * leave them to a trailing descriptor, as Word's and the `docx` library's do.
 */
function entriesOf(bytes: Uint8Array, name: string): Map<string, Entry> {
  // An OLE compound file: what a password-protected .docx or .xlsx really is,
  // and what a .doc or .xls renamed is too.
  if (bytes.length >= 8 && u32(bytes, 0) === 0xe011cfd0 && u32(bytes, 4) === 0xe11ab1a1) throw REFUSE.locked(name);
  // The end record is the last thing in the archive, followed only by a
  // comment of at most 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (u32(bytes, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw REFUSE.damaged(name);
  const count = u16(bytes, end + 10);
  const size = u32(bytes, end + 12);
  const start = u32(bytes, end + 16);
  // A ZIP64 archive keeps its real numbers in another record and leaves these at their maximum.
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff
    || (end >= 20 && u32(bytes, end - 20) === 0x07064b50)) throw REFUSE.zip64(name);
  // An archive split across disks is not a file anybody attaches.
  if (u16(bytes, end + 4) !== 0 || u16(bytes, end + 6) !== 0 || start + size > end) throw REFUSE.damaged(name);
  const utf8 = new TextDecoder();
  const out = new Map<string, Entry>();
  let p = start;
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || u32(bytes, p) !== 0x02014b50) throw REFUSE.damaged(name);
    const nameLength = u16(bytes, p + 28);
    if (p + 46 + nameLength > end) throw REFUSE.damaged(name);
    const entry: Entry = {
      flags: u16(bytes, p + 8),
      method: u16(bytes, p + 10),
      packed: u32(bytes, p + 20),
      size: u32(bytes, p + 24),
      offset: u32(bytes, p + 42),
    };
    if (entry.packed === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) throw REFUSE.zip64(name);
    const part = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLength)).replace(/\\/g, '/');
    if (!out.has(part)) out.set(part, entry);
    p += 46 + nameLength + u16(bytes, p + 30) + u16(bytes, p + 32);
  }
  return out;
}

/** One entry's bytes, inflated, checked against the size the directory gave. */
async function unpack(bytes: Uint8Array, e: Entry, name: string, inflate: Inflate): Promise<Uint8Array> {
  if (e.flags & 1) throw REFUSE.encrypted(name);
  const p = e.offset;
  if (p + 30 > bytes.length || u32(bytes, p) !== 0x04034b50) throw REFUSE.damaged(name);
  const from = p + 30 + u16(bytes, p + 26) + u16(bytes, p + 28);
  if (from + e.packed > bytes.length) throw REFUSE.damaged(name);
  const raw = bytes.subarray(from, from + e.packed);
  if (e.method === 0) {
    if (e.packed !== e.size) throw REFUSE.damaged(name);
    return raw;
  }
  if (e.method !== 8) throw REFUSE.method(name);
  if (e.size > MAX_PART) throw REFUSE.large(name);
  let out: Uint8Array;
  try {
    out = await inflate(raw);
  } catch (e) {
    throw e instanceof CannotInflate ? new Error(`${name}: ${e.message}`) : REFUSE.damaged(name);
  }
  if (out.length !== e.size) throw REFUSE.damaged(name);
  return out;
}

/** A part's text. UTF-8 unless it says otherwise with a byte-order mark, which the format allows. */
function decodePart(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  return new TextDecoder().decode(b);
}

/** An Office file opened: its parts by name, read when asked for. */
interface Package {
  /** The part's text, or `null` when the package has none by that name. Names are matched without regard to case, as the format says. */
  text(part: string): Promise<string | null>;
}

function openPackage(bytes: Uint8Array, name: string, inflate: Inflate): Package {
  const entries = entriesOf(bytes, name);
  const folded = new Map([...entries.keys()].map((k) => [k.toLowerCase(), k]));
  return {
    async text(part) {
      const key = entries.has(part) ? part : folded.get(part.toLowerCase());
      const e = key === undefined ? undefined : entries.get(key);
      return e ? decodePart(await unpack(bytes, e, name, inflate)) : null;
    },
  };
}

// ── XML, as much of it as these parts use ─────────────────────────────────

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * The five named entities and numeric references. Nothing declared in a
 * DOCTYPE is ever expanded, so a part cannot define an entity that expands to
 * a gigabyte, or one that reads a file.
 */
function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (all, e: string) => {
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
 * The tags and the text of a part, in order, with the text's entities
 * decoded. Declarations, processing instructions and comments are passed
 * over; CDATA is text. It checks nothing — Office writes well-formed XML, and
 * what matters with a part that is not is that the walk ends, not that it
 * complains.
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
    if (body[0] === '/') { yield { t: 'close', name: body.slice(1).trim() }; continue; }
    const empty = body.endsWith('/');
    const inner = empty ? body.slice(0, -1) : body;
    const space = inner.search(/\s/);
    yield space === -1
      ? { t: 'open', name: inner, attrs: '', empty }
      : { t: 'open', name: inner.slice(0, space), attrs: inner.slice(space), empty };
  }
}

const ATTRIBUTE = new Map<string, RegExp>();

/** One attribute's value, decoded, or `null`. */
function attr(attrs: string, name: string): string | null {
  if (!attrs) return null;
  let re = ATTRIBUTE.get(name);
  if (!re) {
    re = new RegExp(`(?:^|\\s)${name.replace(/[.:-]/g, '\\$&')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
    ATTRIBUTE.set(name, re);
  }
  const m = re.exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : null;
}

const WORD_NS = ['http://schemas.openxmlformats.org/wordprocessingml/2006/main', 'http://purl.oclc.org/ooxml/wordprocessingml/main'];
const SHEET_NS = ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main'];
const COMPAT_NS = ['http://schemas.openxmlformats.org/markup-compatibility/2006'];

/**
 * The prefix a part binds a namespace to, with its colon — `w:` in every Word
 * file anybody has seen, but that is a declaration, not a rule — '' when it is
 * the default namespace, and `null` when the part does not declare it at all.
 * The standard's transitional and strict names are both known.
 */
function prefixOf(xml: string, uris: readonly string[]): string | null {
  for (const m of xml.slice(0, 32_768).matchAll(/xmlns(?::([\w.-]+))?\s*=\s*["']([^"']*)["']/g)) {
    if (uris.includes(m[2])) return m[1] ? `${m[1]}:` : '';
  }
  return null;
}

/** A name without its prefix. */
const local = (name: string): string => name.slice(name.indexOf(':') + 1);

interface Relationship { id: string; type: string; target: string }

/** The relationships a `.rels` part lists, external ones left out. */
function relationshipsIn(xml: string | null): Relationship[] {
  const out: Relationship[] = [];
  for (const tok of tokens(xml ?? '')) {
    if (tok.t !== 'open' || local(tok.name) !== 'Relationship' || attr(tok.attrs, 'TargetMode') === 'External') continue;
    out.push({ id: attr(tok.attrs, 'Id') ?? '', type: attr(tok.attrs, 'Type') ?? '', target: attr(tok.attrs, 'Target') ?? '' });
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

/**
 * The package's main part — the document or the workbook — and its text:
 * where the root relationships say it is, or under its usual name when they
 * say nothing or name a part that is not there. `null` when neither is.
 */
async function mainPart(pkg: Package, usual: string): Promise<{ part: string; xml: string } | null> {
  const root = relationshipsIn(await pkg.text('_rels/.rels')).find((r) => r.type.endsWith('/officeDocument'));
  for (const part of root ? [resolvePart('', root.target), usual] : [usual]) {
    const xml = await pkg.text(part);
    if (xml !== null) return { part, xml };
  }
  return null;
}

// ── Word ──────────────────────────────────────────────────────────────────

/** What a Word document's text is being collected into, innermost last. */
type Box =
  | { kind: 'body'; lines: string[] }
  | { kind: 'para'; text: string; mid: boolean }
  | { kind: 'table'; rows: string[][]; row: string[] }
  | { kind: 'cell'; parts: string[]; span: number };

/**
 * How deep paragraphs, tables and cells are read into one another. Far past
 * any document Word writes — a paragraph in a table in a cell of a table is
 * six deep — and a part that nests a million paragraphs is not allowed a
 * million boxes. What is deeper is not read, and the file says it was cut.
 */
const MAX_DEPTH = 128;

/**
 * Adobe's Symbol font, from 0x20 to 0xFE: what each of its bytes is in
 * Unicode, U+FFFD where it is nothing. Word's Insert › Symbol writes a
 * character of it as `<w:sym w:font="Symbol" w:char="F0B1"/>` — the byte
 * under F000 — and not as the ± itself.
 */
const SYMBOL_FONT = [
  ' !\u2200#\u2203%&\u220B()\u2217+,\u2212./', // 0x20: ASCII, but for ∀ ∃ ∋ ∗ −
  '0123456789:;<=>?', // 0x30: ASCII
  '\u2245\u0391\u0392\u03A7\u0394\u0395\u03A6\u0393\u0397\u0399\u03D1\u039A\u039B\u039C\u039D\u039F', // 0x40: ≅, then capitals in the order of the Latin ones: Α Β Χ Δ Ε Φ Γ Η Ι ϑ Κ Λ Μ Ν Ο
  '\u03A0\u0398\u03A1\u03A3\u03A4\u03A5\u03C2\u03A9\u039E\u03A8\u0396[\u2234]\u22A5_', // 0x50: Π Θ Ρ Σ Τ Υ ς Ω Ξ Ψ Ζ [ ∴ ] ⊥ _
  '\uFFFD\u03B1\u03B2\u03C7\u03B4\u03B5\u03C6\u03B3\u03B7\u03B9\u03D5\u03BA\u03BB\u03BC\u03BD\u03BF', // 0x60: small letters the same way: α β χ δ ε φ γ η ι ϕ κ λ μ ν ο
  '\u03C0\u03B8\u03C1\u03C3\u03C4\u03C5\u03D6\u03C9\u03BE\u03C8\u03B6{|}\u223C\uFFFD', // 0x70: π θ ρ σ τ υ ϖ ω ξ ψ ζ { | } ∼
  '\uFFFD'.repeat(32), // 0x80 to 0x9F: nothing
  '\u20AC\u03D2\u2032\u2264\u2044\u221E\u0192\u2663\u2666\u2665\u2660\u2194\u2190\u2191\u2192\u2193', // 0xA0: € ϒ ′ ≤ ⁄ ∞ ƒ ♣ ♦ ♥ ♠ ↔ ← ↑ → ↓
  '\u00B0\u00B1\u2033\u2265\u00D7\u221D\u2202\u2022\u00F7\u2260\u2261\u2248\u2026\u23D0\u23AF\u21B5', // 0xB0: ° ± ″ ≥ × ∝ ∂ • ÷ ≠ ≡ ≈ … ⏐ ⎯ ↵
  '\u2135\u2111\u211C\u2118\u2297\u2295\u2205\u2229\u222A\u2283\u2287\u2284\u2282\u2286\u2208\u2209', // 0xC0: ℵ ℑ ℜ ℘ ⊗ ⊕ ∅ ∩ ∪ ⊃ ⊇ ⊄ ⊂ ⊆ ∈ ∉
  '\u2220\u2207\u00AE\u00A9\u2122\u220F\u221A\u22C5\u00AC\u2227\u2228\u21D4\u21D0\u21D1\u21D2\u21D3', // 0xD0: ∠ ∇ ® © ™ ∏ √ ⋅ ¬ ∧ ∨ ⇔ ⇐ ⇑ ⇒ ⇓
  '\u25CA\u27E8\u00AE\u00A9\u2122\u2211\u239B\u239C\u239D\u23A1\u23A2\u23A3\u23A7\u23A8\u23A9\u23AA', // 0xE0: ◊ ⟨ ® © ™ ∑, then pieces of tall brackets
  '\uFFFD\u27E9\u222B\u2320\u23AE\u2321\u239E\u239F\u23A0\u23A4\u23A5\u23A6\u23AB\u23AC\u23AD', // 0xF0: nothing, ⟩ ∫, then more pieces
].join('');

/** Fonts whose characters are pictures, not letters: nothing in Unicode says which picture a byte is. */
const PICTURE_FONT = /wingdings|webdings|dingbat|marlett/i;

/**
 * The character a `w:sym` stands for. In the Symbol font, a byte of the table
 * above, written F0xx or plainly; in Wingdings and its like, or any other font
 * that writes a byte under F000, U+FFFD — a mark that something is there,
 * where leaving it out would make 3.45 ± 0.81 read 3.45 0.81. Anything else
 * is the Unicode character it names.
 */
function symbolChar(font: string, hex: string): string {
  const code = Number.parseInt(hex, 16);
  const byte = code >= 0xf000 && code <= 0xf0ff ? code - 0xf000 : code < 0x100 ? code : -1;
  if (byte >= 0x20 && /^symbol$/i.test(font.trim())) return SYMBOL_FONT[byte - 0x20] ?? '\uFFFD';
  if (!(code > 0x1f) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || (code >= 0xf000 && code <= 0xf0ff)
    || (byte >= 0 && PICTURE_FONT.test(font))) return '\uFFFD';
  return String.fromCodePoint(code);
}

/**
 * A Word document's text: each paragraph a line, a tab a tab, a line break a
 * line break, and each table its rows, one per line, cells separated by tabs,
 * with a blank line either side.
 *
 * Only what the document shows is read. Deleted text in tracked changes
 * (`w:delText`, `w:moveFrom`), field codes (`w:instrText` — the `PAGE` or
 * `TOC \o` behind a field; its result is read), the tab stops a paragraph's
 * properties define, the properties a row or a cell had before a tracked
 * change, and the older copy of a text box that Word keeps for older readers
 * (`mc:Fallback`) are passed over. A symbol inserted from a symbol font
 * (`w:sym`) is its character. A cell that spans columns is followed by empty
 * cells for the columns it covers, and a row that starts past the first
 * column (`w:gridBefore`) begins with empty cells for the ones it skips, so
 * every cell stays in its column. A table inside a cell is flattened into the
 * cell. `cut` when something nested past `MAX_DEPTH` was left out.
 */
function documentText(xml: string, w: string): { text: string; cut: boolean } {
  const mc = prefixOf(xml, COMPAT_NS) ?? 'mc:';
  const P = `${w}p`, T = `${w}t`, TBL = `${w}tbl`, TR = `${w}tr`, TC = `${w}tc`, PPR = `${w}pPr`, SPAN = `${w}gridSpan`, VAL = `${w}val`;
  const BEFORE = `${w}gridBefore`, SYM = `${w}sym`;
  const TABS = new Set([`${w}tab`, `${w}ptab`]);
  const BREAKS = new Set([`${w}br`, `${w}cr`]);
  const SKIP = new Set([`${w}del`, `${w}moveFrom`, `${w}instrText`, `${w}delInstrText`, `${w}trPrChange`, `${w}tcPrChange`, `${mc}Fallback`]);

  const body: Box = { kind: 'body', lines: [] };
  const stack: Box[] = [body];
  const top = (): Box => stack[stack.length - 1];
  let skip = 0;
  let inText = 0;
  let inProps = 0;
  /** Tables open on the stack: a `</w:tbl>` when there are none closes nothing, and looks for nothing. */
  let tables = 0;
  /** Boxes opened past `MAX_DEPTH`, and not pushed: their closes are counted off here instead. */
  let over = 0;
  let cut = false;

  const open = (b: Box) => {
    if (stack.length >= MAX_DEPTH) { over++; cut = true; return; }
    if (b.kind === 'table') tables++;
    stack.push(b);
  };
  /** A `w:val` counting grid columns — a cell's span, a row's columns skipped — from 0 to 64. */
  const grid = (attrs: string): number => Math.min(Math.max(Number.parseInt(attr(attrs, VAL) ?? '', 10) || 0, 0), 64);
  // A paragraph's text is only ever added to, never looked at: reading the
  // end of a string built a piece at a time copies the whole of it, and a
  // paragraph holding a hundred thousand text boxes would be copied as often.
  // So whether it ends partway through a line (`mid`) is kept beside it.
  const add = (s: string) => {
    const b = top();
    if (b.kind === 'para' && s) { b.text += s; b.mid = !s.endsWith('\n'); }
  };
  /** Hand a finished paragraph or table, as text, to what holds it. */
  const deliver = (text: string, table: boolean) => {
    const b = top();
    if (b.kind === 'body') {
      if (table) body.lines.push('', text, '');
      else body.lines.push(text);
    } else if (b.kind === 'cell') {
      // A table inside a cell: rows run on, separated by semicolons.
      b.parts.push(table ? text.split('\n').map((r) => r.split('\t').join(', ')).join('; ') : text);
    } else if (b.kind === 'para') {
      // A text box sits inside a run of the paragraph it floats beside: its
      // paragraphs are lines of their own, not words of that one.
      b.text += `${b.mid ? '\n' : ''}${text}\n`;
      b.mid = false;
    }
  };
  const close = (kind: Box['kind']) => {
    const b = top();
    if (b.kind !== kind || stack.length === 1) return;
    stack.pop();
    if (b.kind === 'table') tables--;
    if (b.kind === 'para') deliver(b.text, false);
    else if (b.kind === 'cell') {
      const t = top();
      if (t.kind === 'table') t.row.push(oneLine(b.parts.join(' ')), ...Array<string>(b.span - 1).fill(''));
    } else if (b.kind === 'table') {
      if (b.row.length) b.rows.push(b.row);
      const text = asLines(b.rows);
      if (text.trim()) deliver(text, true);
    }
  };

  for (const tok of tokens(xml)) {
    if (tok.t === 'text') {
      if (inText && !skip) add(tok.text);
      continue;
    }
    const name = tok.name;
    if (SKIP.has(name)) {
      if (tok.t === 'close') skip = Math.max(0, skip - 1);
      else if (!tok.empty) skip++;
      continue;
    }
    if (skip) continue;
    if (tok.t === 'close') {
      if (over && (name === P || name === TC || name === TBL)) over--;
      else if (name === P) close('para');
      else if (name === T) inText = Math.max(0, inText - 1);
      else if (name === PPR) inProps = Math.max(0, inProps - 1);
      else if (name === TC) close('cell');
      else if (name === TR) {
        const b = top();
        if (b.kind === 'table') { b.rows.push(b.row); b.row = []; }
      } else if (name === TBL && tables) {
        // A cell or paragraph left open inside is closed with it. With no
        // table open, a stray close is nothing: counted, not searched for, so
        // a part of a million of them is a million steps and not a million
        // walks down the stack.
        while (top().kind !== 'table') close(top().kind);
        close('table');
      }
      continue;
    }
    if (name === P) {
      if (tok.empty) deliver('', false);
      else open({ kind: 'para', text: '', mid: false });
    } else if (name === T) {
      if (!tok.empty) inText++;
    } else if (TABS.has(name)) {
      if (!inProps) add('\t');
    } else if (BREAKS.has(name)) {
      add('\n');
    } else if (name === `${w}noBreakHyphen`) {
      add('-');
    } else if (name === SYM) {
      add(symbolChar(attr(tok.attrs, `${w}font`) ?? '', attr(tok.attrs, `${w}char`) ?? ''));
    } else if (name === PPR) {
      if (!tok.empty) inProps++;
    } else if (name === TBL) {
      if (!tok.empty) open({ kind: 'table', rows: [], row: [] });
    } else if (name === TC) {
      if (!tok.empty) open({ kind: 'cell', parts: [], span: 1 });
      else { const b = top(); if (b.kind === 'table') b.row.push(''); }
    } else if (name === SPAN) {
      const b = top();
      const n = grid(tok.attrs);
      if (b.kind === 'cell' && n > 1) b.span = n;
    } else if (name === BEFORE) {
      // In the row's properties, before its first cell. A row that stops
      // short (`w:gridAfter`) needs nothing: a row's empty cells at the end
      // are dropped anyway.
      const b = top();
      if (b.kind === 'table') b.row.push(...Array<string>(grid(tok.attrs)).fill(''));
    }
  }
  // A part that ended early: whatever was open is closed as it stands.
  while (stack.length > 1) close(top().kind);
  return { text: tidy(body.lines.join('\n')), cut };
}

/**
 * A Word file as a `DataFile`: its paragraphs and tables, as `documentText`
 * reads them. Refused when it is not an archive, is locked, or has no
 * document in it.
 */
export async function fromDocx(o: { id: string; name: string; bytes: Uint8Array; size: number }, inflate: Inflate): Promise<DataFile> {
  const main = await mainPart(openPackage(o.bytes, o.name, inflate), 'word/document.xml');
  // A part that does not declare Word's namespace is not a Word document: a
  // workbook given the wrong extension has a main part too.
  const w = main && prefixOf(main.xml, WORD_NS);
  if (!main || w === null) throw REFUSE.noDocument(o.name);
  const doc = documentText(main.xml, w);
  const { text, cut } = capped(doc.text);
  return { id: o.id, name: o.name, kind: 'document', text, bytes: o.size, truncated: cut || doc.cut };
}

// ── Excel ─────────────────────────────────────────────────────────────────

/** How a number is shown, where showing it as stored would mislead. */
type Shown = { as: 'date'; time: boolean; seconds: boolean } | { as: 'time'; seconds: boolean } | { as: 'percent'; places: number } | null;

/**
 * Excel's own number formats that are dates, times or percentages, by id. The
 * rest of the built-in ones are numbers, currencies and fractions, and are
 * shown as stored — as are the East Asian locales' own ids, which mean
 * different things in different locales.
 */
function builtInFormat(id: number): Shown {
  if (id === 9) return { as: 'percent', places: 0 };
  if (id === 10) return { as: 'percent', places: 2 };
  if (id >= 14 && id <= 17) return { as: 'date', time: false, seconds: false };
  if (id === 22) return { as: 'date', time: true, seconds: false };
  if ((id >= 18 && id <= 21) || (id >= 45 && id <= 47)) return { as: 'time', seconds: id === 19 || id === 21 || id >= 45 };
  return null;
}

/** A format code the workbook defines, read for whether it is a date, a time or a percentage. */
function customFormat(code: string): Shown {
  // Its first section, without literal text, escaped characters, colours and locales.
  const f = code.split(';')[0].replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[(?!h\]|hh\]|m\]|mm\]|s\]|ss\])[^\]]*\]/gi, '').replace(/_./g, '');
  if (f.includes('%')) {
    const dot = f.indexOf('.');
    // Thirty places is as many as Excel will show.
    return { as: 'percent', places: dot === -1 ? 0 : Math.min((f.slice(dot + 1).match(/[0#?]/g) ?? []).length, 30) };
  }
  const lower = f.toLowerCase();
  const date = /[dy]/.test(lower) || /(^|[^h:])m{3,}/.test(lower);
  const time = /[hs]/.test(lower);
  if (date) return { as: 'date', time, seconds: /s/.test(lower) };
  if (time) return { as: 'time', seconds: /s/.test(lower) };
  return null;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `x` × 10^`by`, by moving its decimal point in its digits rather than by multiplying in binary. */
function shifted(x: number, by: number): number {
  const [m, e = '0'] = String(x).split('e');
  return Number(`${m}e${Number(e) + by}`);
}

/**
 * A number to `places` decimals as Excel shows it: to Excel's 15 significant
 * digits first, then half away from zero, in decimal. `toFixed` rounds the
 * binary value, and 0.145 × 100 in binary is 14.499999999999998 — 14% where
 * Excel shows 15%.
 */
function fixed(v: number, places: number): string {
  const x = Number(v.toPrecision(15));
  const r = shifted(Math.round(shifted(Math.abs(x), places)), -places);
  return `${x < 0 ? '-' : ''}${r.toFixed(places)}`;
}

/**
 * A number as the researcher sees it, for the formats that matter: a date as
 * `2025-03-14`, a time as `09:30`, a percentage as `45%` or `45.20%`, with the
 * places the format gives. Anything else, and anything out of range, is the
 * number as stored.
 */
function shownNumber(raw: string, shown: Shown, date1904: boolean): string {
  const v = Number(raw);
  if (!shown || !raw.trim() || !Number.isFinite(v)) return raw;
  if (shown.as === 'percent') return Number.isFinite(v * 100) ? `${fixed(v * 100, shown.places)}%` : raw;
  if (v < 0 || v >= 2_958_466) return raw;
  // Seconds, rounded, from Excel's epoch. The 1900 system counts a 29 February
  // 1900 that never was, so serials before it are a day behind the calendar.
  const seconds = Math.round(v * 86_400);
  const clock = seconds % 86_400;
  const hms = `${pad(Math.floor(clock / 3600))}:${pad(Math.floor((clock % 3600) / 60))}`;
  const secs = `:${pad(clock % 60)}`;
  // A day or more on a clock is a duration, which the clock would wrap.
  if (shown.as === 'time') return v >= 1 ? raw : hms + (shown.seconds ? secs : '');
  const days = Math.floor(seconds / 86_400);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const at = new Date(epoch + (date1904 || days >= 61 ? days : days + 1) * 86_400_000);
  const day = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
  return shown.time ? `${day} ${hms}${shown.seconds ? secs : ''}` : day;
}

/** Excel's escape for characters XML cannot hold: `_x000D_` is a carriage return, `_x005F_` an underscore. */
const unescapeExcel = (s: string): string => s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)));

/** A cell reference's column, from zero: `C5` → 2, `AA1` → 26. -1 when there are no letters. */
function columnOf(ref: string): number {
  let n = 0;
  let i = 0;
  for (; i < ref.length; i++) {
    const c = ref.charCodeAt(i) | 32;
    if (c < 97 || c > 122) break;
    n = n * 26 + (c - 96);
  }
  return i === 0 ? -1 : n - 1;
}

/**
 * The shared strings — every piece of text in the workbook, stored once and
 * pointed at by index. A rich-text string is its runs joined; the phonetic
 * guide Japanese text carries (`rPh`) is not part of it.
 */
function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const s = prefixOf(xml, SHEET_NS) ?? '';
  const out: string[] = [];
  let cur: string | null = null;
  let inText = 0;
  let phonetic = 0;
  for (const tok of tokens(xml)) {
    if (tok.t === 'text') { if (cur !== null && inText && !phonetic) cur += tok.text; continue; }
    const name = tok.name;
    if (tok.t === 'open') {
      if (name === `${s}si`) { if (tok.empty) out.push(''); else cur = ''; }
      else if (name === `${s}t` && !tok.empty) inText++;
      else if (name === `${s}rPh` && !tok.empty) phonetic++;
    } else if (name === `${s}si`) { out.push(unescapeExcel(cur ?? '')); cur = null; }
    else if (name === `${s}t`) inText = Math.max(0, inText - 1);
    else if (name === `${s}rPh`) phonetic = Math.max(0, phonetic - 1);
  }
  return out;
}

/** How each cell style shows a number, by the style's index — the `s` of a cell. */
function cellFormats(xml: string | null): Shown[] {
  if (!xml) return [];
  const s = prefixOf(xml, SHEET_NS) ?? '';
  const custom = new Map<number, Shown>();
  const out: Shown[] = [];
  let inCellXfs = 0;
  for (const tok of tokens(xml)) {
    if (tok.t === 'text') continue;
    if (tok.name === `${s}cellXfs`) {
      if (tok.t === 'close') inCellXfs = 0;
      else if (!tok.empty) inCellXfs = 1;
      continue;
    }
    if (tok.t !== 'open') continue;
    if (tok.name === `${s}numFmt`) {
      const id = Number.parseInt(attr(tok.attrs, 'numFmtId') ?? '', 10);
      if (Number.isFinite(id)) custom.set(id, customFormat(attr(tok.attrs, 'formatCode') ?? ''));
    } else if (tok.name === `${s}xf` && inCellXfs) {
      const id = Number.parseInt(attr(tok.attrs, 'numFmtId') ?? '0', 10);
      out.push(custom.has(id) ? custom.get(id) ?? null : builtInFormat(id));
    }
  }
  return out;
}

/** What a sheet is read with: the workbook's strings, its styles, and which calendar it counts days in. */
interface Book { strings: string[]; formats: Shown[]; date1904: boolean }

/**
 * A sheet's rows as tab-separated lines, stopping once `room` characters are
 * filled.
 *
 * Cells go where their reference says, with empty cells between, so every
 * value stays in its column; the columns empty on every row at the left are
 * dropped, so a table that starts at column C starts at the margin. A run of
 * empty rows is one blank line. A formula is its last calculated value.
 */
function sheetText(xml: string, book: Book, room: number): { text: string; full: boolean } {
  const s = prefixOf(xml, SHEET_NS) ?? '';
  const ROW = `${s}row`, C = `${s}c`, V = `${s}v`, IS = `${s}is`, T = `${s}t`, RPH = `${s}rPh`;
  const rows: { at: number; cells: string[] }[] = [];
  let used = 0;
  let full = true;
  let row: string[] | null = null;
  let rowAt = 0;
  let col = -1;
  let cell: { type: string; style: number; value: string; inline: string } | null = null;
  let inValue = 0;
  let inInline = 0;
  let inText = 0;
  let phonetic = 0;

  for (const tok of tokens(xml)) {
    if (tok.t === 'text') {
      if (!cell) continue;
      if (inValue) cell.value += tok.text;
      else if (inInline && inText && !phonetic) cell.inline += tok.text;
      continue;
    }
    const name = tok.name;
    if (tok.t === 'open') {
      if (name === ROW) {
        const r = Number.parseInt(attr(tok.attrs, 'r') ?? '', 10);
        rowAt = r > 0 ? r : rowAt + 1;
        row = [];
        col = -1;
        if (tok.empty) row = null;
      } else if (name === C && row) {
        const ref = attr(tok.attrs, 'r');
        const at = ref ? columnOf(ref) : -1;
        col = at >= 0 ? at : col + 1;
        if (tok.empty) continue;
        cell = { type: attr(tok.attrs, 't') ?? 'n', style: Number.parseInt(attr(tok.attrs, 's') ?? '0', 10) || 0, value: '', inline: '' };
      } else if (name === V && cell && !tok.empty) inValue++;
      else if (name === IS && cell && !tok.empty) inInline++;
      else if (name === T && cell && !tok.empty) inText++;
      else if (name === RPH && !tok.empty) phonetic++;
      continue;
    }
    if (name === V) inValue = Math.max(0, inValue - 1);
    else if (name === IS) inInline = Math.max(0, inInline - 1);
    else if (name === T) inText = Math.max(0, inText - 1);
    else if (name === RPH) phonetic = Math.max(0, phonetic - 1);
    else if (name === C && cell && row) {
      const v = cell.value;
      let text: string;
      if (cell.type === 's') text = book.strings[Number.parseInt(v, 10)] ?? '';
      else if (cell.type === 'inlineStr') text = unescapeExcel(cell.inline);
      else if (cell.type === 'b') text = v.trim() === '1' || v.trim() === 'true' ? 'TRUE' : 'FALSE';
      else if (cell.type === 'n') text = shownNumber(v.trim(), book.formats[cell.style] ?? null, book.date1904);
      else text = unescapeExcel(v); // str, e, d: the text itself
      text = oneLine(text);
      if (text && col < 16_384) row[col] = text;
      cell = null;
    } else if (name === ROW && row) {
      const cells = Array.from(row, (c) => c ?? '');
      if (cells.some((c) => c)) {
        rows.push({ at: rowAt, cells });
        used += cells.reduce((sum, c) => sum + c.length + 1, 0);
        if (used > room) { full = false; break; }
      }
      row = null;
    }
  }

  if (!rows.length) return { text: '', full };
  const left = rows.reduce((min, r) => Math.min(min, r.cells.findIndex((c) => c !== '')), Infinity);
  const lines: string[] = [];
  rows.forEach((r, i) => {
    if (i > 0 && r.at > rows[i - 1].at + 1) lines.push('');
    lines.push(asLines([r.cells.slice(left)]));
  });
  return { text: lines.join('\n'), full };
}

/**
 * A workbook as a `DataFile`: every worksheet, in the workbook's order, as a
 * block headed `Sheet: <name>` and followed by its rows (`sheetText`). Empty
 * sheets are left out; a hidden one is read, and says it is hidden. Refused
 * when it is not an archive, is locked, or has no worksheets.
 */
export async function fromXlsx(o: { id: string; name: string; bytes: Uint8Array; size: number }, inflate: Inflate): Promise<DataFile> {
  const pkg = openPackage(o.bytes, o.name, inflate);
  const main = await mainPart(pkg, 'xl/workbook.xml');
  const s = main && prefixOf(main.xml, SHEET_NS);
  if (!main || s === null) throw REFUSE.noSheets(o.name);
  const rels = relationshipsIn(await pkg.text(relsFor(main.part)));
  // Looked up once per sheet: a map, so a workbook of many sheets is not
  // sheets × relationships comparisons. The first of an id is the one, as it was.
  const relById = new Map<string, Relationship>();
  for (const r of rels) if (!relById.has(r.id)) relById.set(r.id, r);
  const partOf = (type: string, usual: string) => {
    const r = rels.find((x) => x.type.endsWith(type));
    return r ? resolvePart(main.part, r.target) : usual;
  };

  const sheets: { name: string; hidden: boolean; part: string }[] = [];
  let date1904 = false;
  for (const tok of tokens(main.xml)) {
    if (tok.t !== 'open') continue;
    if (tok.name === `${s}workbookPr`) date1904 = /^(1|true)$/i.test(attr(tok.attrs, 'date1904') ?? '');
    if (tok.name !== `${s}sheet`) continue;
    // The relationship id is `r:id`, under whatever prefix the part gave that namespace.
    const id = /(?:^|\s)[\w.-]+:id\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tok.attrs);
    const rel = id ? relById.get(id[1] ?? id[2]) : undefined;
    // A chart sheet has no cells.
    if (rel && !rel.type.endsWith('/worksheet')) continue;
    const state = attr(tok.attrs, 'state') ?? '';
    sheets.push({
      name: attr(tok.attrs, 'name') ?? `Sheet${sheets.length + 1}`,
      hidden: state === 'hidden' || state === 'veryHidden',
      part: rel ? resolvePart(main.part, rel.target) : `xl/worksheets/sheet${sheets.length + 1}.xml`,
    });
  }

  const book: Book = {
    strings: sharedStrings(await pkg.text(partOf('/sharedStrings', 'xl/sharedStrings.xml'))),
    formats: cellFormats(await pkg.text(partOf('/styles', 'xl/styles.xml'))),
    date1904,
  };
  const blocks: string[] = [];
  let found = 0;
  let used = 0;
  let full = true;
  /** Parts already read: two sheets naming one part are one sheet, and it is inflated once. */
  const read = new Set<string>();
  for (const sheet of sheets) {
    // Full already, with sheets still to come: they are not read, and the
    // file is marked as cut.
    if (used >= MAX_DATA_CHARS) { full = false; break; }
    if (read.has(sheet.part.toLowerCase())) continue;
    read.add(sheet.part.toLowerCase());
    const part = await pkg.text(sheet.part);
    if (part === null) continue;
    found++;
    const { text, full: whole } = sheetText(part, book, MAX_DATA_CHARS - used);
    if (text) {
      const block = `Sheet: ${sheet.name}${sheet.hidden ? ' (hidden)' : ''}\n${text}`;
      blocks.push(block);
      used += block.length + 2;
    }
    if (!whole) { full = false; break; }
  }
  if (!found) throw REFUSE.noSheets(o.name);
  const { text, cut } = capped(tidy(blocks.join('\n\n')));
  return { id: o.id, name: o.name, kind: 'table', text, bytes: o.size, truncated: cut || !full };
}

// ── PDF ───────────────────────────────────────────────────────────────────

const LANGUAGE_NAME: Readonly<Record<DocLang, string>> = {
  ar: 'Arabic', ckb: 'Central Kurdish (Sorani)', kmr: 'Northern Kurdish (Badini)', en: 'English',
};

/**
 * What a model is asked to do with a PDF of the researcher's: write out its
 * text, and nothing else.
 *
 * A PDF is the one format whose text cannot be read here, so a model reads it
 * — and a model asked to "read" a file summarises it, tidies it, translates
 * it into the language it was spoken to in, and fills a blurred cell with a
 * likely number. Every one of those turns the researcher's data into
 * something they did not collect. So the request is for a transcription: the
 * file's own language and script, its numbers digit for digit, its tables as
 * pipe tables with every cell in its column, and a marked gap — never a guess —
 * where a page cannot be read. `lang` is the document's language, named so the
 * model is told not to translate into it.
 */
export function pdfPrompt(name: string, lang: DocLang): string {
  const file = name.replace(/[\r\n]+/g, ' ').trim();
  return [
    `The attached PDF, "${file}", is the researcher's own data: results, tables, notes or a draft. Transcribe it, so that its text can be used as data in a document they are writing in ${LANGUAGE_NAME[lang]}.`,
    '',
    '1. Write out the text exactly as it is in the file, in its own language and script. Do not translate it — not into ' + LANGUAGE_NAME[lang] + ', not into anything — and do not correct, summarise, shorten or reorder it.',
    '2. Add nothing: no introduction, no comments, no explanations, no headings of your own. Everything you write must be written in the file.',
    '3. Every number exactly as printed: each digit, decimal point, sign and percent sign, in the numerals the file uses.',
    '4. Every table as a pipe table: a header row, a |---| row under it, then one line per row of the table, every cell in its own column, an empty cell left empty. A table that runs on to the next page is one table.',
    '5. Each heading on a line of its own, as it is written. Paragraphs separated by a blank line. Leave out running headers, footers and page numbers that repeat on every page.',
    '6. A chart or a figure: its title, and the values printed on it, if any. Never estimate a value from the height of a bar or the course of a line.',
    '7. Where a page, a table or a passage cannot be read, write a gap in double square brackets in its place, such as [[page 4 could not be read]], and go on. Never guess what it says.',
    '',
    'Reply with the transcription only.',
  ].join('\n');
}
