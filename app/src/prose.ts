/**
 * Prose: the few shapes a section of a document is written in, read one way
 * for everything that shows it.
 *
 * A section's text is what the model wrote and the researcher then edited —
 * paragraphs, `###` subheadings, lists, the odd table, `[@s3]` markers and
 * `[[gaps]]`. The panel's preview draws it, the word counts measure it, and the
 * Word file is built from it, and the file has to be what the preview showed.
 * So there is one reader, here, and all of them use it. Two readers would be
 * two opinions about what a stray asterisk means, and the saved document would
 * be the one nobody looked at.
 *
 * ## Forgiving, because the writer is a model
 *
 * The syntax is markdown's, but only the part the model is told to use (see
 * `systemFor` in research.ts). What it does anyway — a `# ` heading, a code
 * fence, a `---` rule, a list nested three deep, a table with a cell missing —
 * is read as the nearest thing the document can hold, never as an error.
 * Nothing here throws, whatever it is given: a section that cannot be read is
 * a section the researcher cannot see, and they would have to find it in a
 * file they have not got.
 *
 * Where the model's meaning is unclear the text stays text. A `**` with no
 * partner is two asterisks, not the start of a bold that swallows the rest of
 * the paragraph; `[1]`, `[sic]` and `[the author]` are brackets, not markers.
 *
 * ## Markers are recognised here, and resolved elsewhere
 *
 * `[@s3]` becomes a cite run naming `s3`, whether or not a source `s3` exists.
 * Which markers name a usable record, and what a citation looks like, is
 * `cite.ts`'s business — this file only has to agree with it about where the
 * markers are.
 */

/** A piece of a line: text with its emphasis, one marker group, or one gap. */
export type Run =
  | { t: 'text'; text: string; bold?: boolean; italic?: boolean }
  | { t: 'cite'; keys: string[]; locator?: string }
  | { t: 'hole'; text: string };

/**
 * A block of a section. Headings are relative to the section they are in:
 * `###` is depth 1 and `####` depth 2, whatever level the section itself is.
 */
export type Block =
  | { t: 'p'; runs: Run[] }
  | { t: 'h'; depth: 1 | 2; runs: Run[] }
  | { t: 'ul' | 'ol'; items: Run[][] }
  | { t: 'table'; head: Run[][]; rows: Run[][][] }
  | { t: 'hole'; text: string };

// ── markers ───────────────────────────────────────────────────────────────

/** The longest bracket read as a marker group. Anything longer is prose that happens to be in brackets. */
const MARKER_MAX = 200;

/** A key as the app assigns them (`s3`), with the inner punctuation pandoc allows. */
const KEY = /^@([A-Za-z0-9_]+(?:[:./-][A-Za-z0-9_]+)*)([\s\S]*)$/;

/** Labels that may stand before a roman numeral in a locator: "p. xii", "ch. iv". */
const ROMAN_LOCATOR = /^(?:pp?|pages?|ch|chap|chapter|sec|section|para|vol|fig|table)\.?\s*[ivxlcdm]+$/i;

/**
 * Labels a locator into legislation or a long work begins with, which may be
 * followed by words and no number: "المادة الأولى", "البند ثانياً من المادة
 * الثانية", "الفصل الثاني", "chapter two". Iraqi laws number their articles in
 * words, so a locator without a digit is as ordinary there as one with.
 */
const LABELLED_LOCATOR = /^(?:(?:ال)?(?:مادة|مادتان|مادتين|فقرة|بند|فصل|باب|جزء)|المواد|مادەی|مادەیا|بڕگەی|بڕگەیا|بەندی|arts?|articles?|ch|chap|chapters?|sec|sections?|para|paragraphs?|parts?)(?=[\s.:/]|$)/iu;

/** The longest locator that begins with a label: an article, its clause and the law it is in take room, and are still one locator. */
const LABELLED_MAX = 160;

/**
 * Whether what follows a key is a locator — "p. 12", "pp. 3–5", "ص 45",
 * "ch. iv", "المادة الأولى" — rather than words. A locator has a number in it
 * or begins with a label; other words that follow a key mean the bracket was
 * prose, and prose stays text.
 */
function locatorLike(s: string): boolean {
  if (/[[\]@]/.test(s)) return false;
  if (LABELLED_LOCATOR.test(s)) return s.length <= LABELLED_MAX;
  if (s.length > 60) return false;
  return /\p{N}/u.test(s) || ROMAN_LOCATOR.test(s);
}

/**
 * The pieces of a marker group, one per key with whatever follows it.
 *
 * Keys are separated by `;` or `,` and by the Arabic `؛` `،`, which is what an
 * Arabic keyboard types — a comma only before another `@`, so "pp. 12, 15"
 * stays one locator — or by nothing but a space before the next `@`.
 * `cleanSection` in researchrun.ts splits with this too, and has to: if it
 * read `[@s3؛ @s45]` as one key where this file reads two, `s45` would reach
 * the stored text without ever being checked against the sources.
 */
export function markerPieces(inner: string): string[] {
  return inner.split(/[;؛]|[,،](?=\s*@)|\s+(?=@)/).map((p) => p.trim()).filter(Boolean);
}

/**
 * What is inside `[…]`, read as a marker group, or `null` when it is not one.
 *
 * Split into keys by `markerPieces`, and a key may be followed by a locator.
 * Only the first locator is kept: a run carries one, and a group citing two
 * pages of two works at once is rarer than a model inventing a page.
 */
function markerGroup(inner: string): { keys: string[]; locator?: string } | null {
  if (!/^\s*@/.test(inner)) return null;
  const keys: string[] = [];
  let locator = '';
  for (const piece of markerPieces(inner)) {
    const m = KEY.exec(piece);
    if (!m) return null;
    const rest = m[2].replace(/^[\s,،:.]+/, '').trim().replace(/\s+/g, ' ');
    if (rest) {
      if (!locatorLike(rest)) return null;
      if (!locator) locator = rest;
    }
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  if (!keys.length) return null;
  return locator ? { keys, locator } : { keys };
}

// ── a line ────────────────────────────────────────────────────────────────

/** Characters a backslash makes literal. */
const ESCAPABLE = '\\`*_[]()#+-.!|~>{}';

type Tok =
  | { k: 'text'; s: string }
  | { k: 'delim'; ch: '*' | '_'; size: 1 | 2; role?: 'open' | 'close' }
  | { k: 'cite'; keys: string[]; locator?: string }
  | { k: 'hole'; text: string };

const WORDISH = /[\p{L}\p{N}]/u;

/**
 * The runs of one line (or one paragraph, joined).
 *
 * One pass, left to right. Gaps and marker groups are taken whole, so an
 * asterisk inside a gap is the researcher's asterisk. Emphasis is matched the
 * way markdown matches it, simplified: a delimiter can open when the next
 * character is not a space and close when the previous one is not; `_` never
 * opens or closes inside a word, so `snake_case` is a word. A delimiter left
 * without a partner is printed as it was typed.
 *
 * Every search ahead is either bounded or remembered, so a line of ten
 * thousand `[` costs ten thousand steps and not fifty million.
 */
export function runsOf(line: string): Run[] {
  const s = typeof line === 'string' ? line.replace(/<br\s*\/?>/gi, ' ') : '';
  try {
    return render(tokens(s));
  } catch {
    return s ? [{ t: 'text', text: s }] : [];
  }
}

function tokens(s: string): Tok[] {
  const toks: Tok[] = [];
  const open: Record<string, number[]> = { '*1': [], '*2': [], '_1': [], '_2': [] };
  let buf = '';
  const flush = () => {
    if (buf) toks.push({ k: 'text', s: buf });
    buf = '';
  };
  const delim = (ch: '*' | '_', size: 1 | 2, canOpen: boolean, canClose: boolean) => {
    const stack = open[ch + size];
    if (canClose && stack.length) {
      const at = stack.pop() as number;
      (toks[at] as Extract<Tok, { k: 'delim' }>).role = 'open';
      toks.push({ k: 'delim', ch, size, role: 'close' });
    } else if (canOpen) {
      stack.push(toks.length);
      toks.push({ k: 'delim', ch, size });
    } else {
      toks.push({ k: 'text', s: ch.repeat(size) });
    }
  };
  // The next `]` and `]]` at or after the cursor, remembered; Infinity is "none left".
  let close = -1;
  let closeHole = -1;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && ESCAPABLE.includes(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      let n = 1;
      while (s[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = s.slice(i + n, i + n + 400).indexOf(fence);
      buf += end > 0 ? s.slice(i + n, i + n + end) : fence;
      i += end > 0 ? n + end + n : n;
      continue;
    }
    if (c === '[' && s[i + 1] === '[') {
      if (closeHole !== Infinity && closeHole < i + 2) {
        const at = s.indexOf(']]', i + 2);
        closeHole = at === -1 ? Infinity : at;
      }
      if (closeHole !== Infinity) {
        let end = closeHole;
        while (s[end + 2] === ']') end++;
        const inner = s.slice(i + 2, end);
        const group = markerGroup(inner);
        flush();
        toks.push(group ? { k: 'cite', ...group } : { k: 'hole', text: inner.replace(/\s+/g, ' ').trim() || '…' });
        i = end + 2;
        continue;
      }
    } else if (c === '[') {
      if (close !== Infinity && close < i + 1) {
        const at = s.indexOf(']', i + 1);
        close = at === -1 ? Infinity : at;
      }
      if (close !== Infinity && close - i <= MARKER_MAX) {
        const group = markerGroup(s.slice(i + 1, close));
        if (group) {
          flush();
          toks.push({ k: 'cite', ...group });
          i = close + 1;
          continue;
        }
      }
    }
    if (c === '*' || c === '_') {
      let n = 1;
      while (s[i + n] === c) n++;
      const prev = i > 0 ? s[i - 1] : '';
      const next = s[i + n] ?? '';
      let canOpen = next !== '' && !/\s/.test(next);
      let canClose = prev !== '' && !/\s/.test(prev);
      if (c === '_') {
        if (WORDISH.test(prev)) canOpen = false;
        if (WORDISH.test(next)) canClose = false;
      }
      if (n > 3 || (!canOpen && !canClose)) {
        buf += s.slice(i, i + n);
      } else {
        flush();
        if (n === 3) {
          // `***x***`: bold outside, italic inside — so a closing run closes the italic first.
          const closing = canClose && (open[c + '1'].length > 0 || open[c + '2'].length > 0);
          const sizes: (1 | 2)[] = closing ? [1, 2] : [2, 1];
          for (const size of sizes) delim(c, size, canOpen, canClose);
        } else {
          delim(c, n as 1 | 2, canOpen, canClose);
        }
      }
      i += n;
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return toks;
}

function render(toks: readonly Tok[]): Run[] {
  const runs: Run[] = [];
  let bold = 0;
  let italic = 0;
  const text = (t: string) => {
    if (!t) return;
    const last = runs[runs.length - 1];
    if (last && last.t === 'text' && !!last.bold === bold > 0 && !!last.italic === italic > 0) {
      last.text += t;
      return;
    }
    const run: Run = { t: 'text', text: t };
    if (bold > 0) run.bold = true;
    if (italic > 0) run.italic = true;
    runs.push(run);
  };
  for (const tok of toks) {
    if (tok.k === 'text') text(tok.s);
    else if (tok.k === 'cite') runs.push(tok.locator ? { t: 'cite', keys: tok.keys, locator: tok.locator } : { t: 'cite', keys: tok.keys });
    else if (tok.k === 'hole') runs.push({ t: 'hole', text: tok.text });
    else if (!tok.role) text(tok.ch.repeat(tok.size));
    else if (tok.size === 2) bold += tok.role === 'open' ? 1 : -1;
    else italic += tok.role === 'open' ? 1 : -1;
  }
  return runs;
}

// ── blocks ────────────────────────────────────────────────────────────────

const BULLET = /^(\s*)[-*+•]\s+(.*)$/;
const ORDERED = /^(\s*)[0-9\u0660-\u0669\u06F0-\u06F9]{1,3}[.)]\s+(.*)$/;
const RULE = /^\s*([-*_=])(?:\s*\1){2,}\s*$/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const QUOTE = /^\s{0,3}(?:>\s?)+/;
const HOLE_LINE = /^\[\[([\s\S]*)\]\]$/;
const SEPARATOR = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/;

/** A whole line that is one gap and nothing else, as its text; `null` otherwise. */
function holeLine(line: string): string | null {
  const m = HOLE_LINE.exec(line);
  if (!m || m[1].includes(']]') || markerGroup(m[1])) return null;
  return m[1].replace(/\s+/g, ' ').trim() || '…';
}

/** Whether a line has a `|` of its own — not an escaped one, not one inside a gap. */
function hasPipe(line: string): boolean {
  return cellsOf(line).length > 1 || /^\|/.test(line.trim());
}

function isSeparator(line: string, head: string): boolean {
  const t = line.trim();
  return t.includes('-') && SEPARATOR.test(t) && (t.includes('|') || head.trim().startsWith('|'));
}

/**
 * The most columns a table is given. No table in a thesis is wider, and
 * padding every row of a runaway one to its widest would cost memory the
 * size of its width times its length. What is past the last column is kept,
 * joined into it.
 */
const MAX_COLUMNS = 40;

/** A table row's cells, as text. Pipes inside a gap or escaped with `\` are the cell's own. */
function cellsOf(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let hole = -1;
  for (let i = 0; i < r.length; i++) {
    const c = r[i];
    if (c === '\\' && i + 1 < r.length) {
      cur += c + r[i + 1];
      i++;
      continue;
    }
    if (c === '[' && r[i + 1] === '[' && hole !== Infinity) {
      if (hole < i + 2) {
        const at = r.indexOf(']]', i + 2);
        hole = at === -1 ? Infinity : at;
      }
      if (hole !== Infinity) {
        cur += r.slice(i, hole + 2);
        i = hole + 1;
        continue;
      }
    }
    if (c === '|') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  if (cells.length > MAX_COLUMNS) cells.splice(MAX_COLUMNS - 1, cells.length, cells.slice(MAX_COLUMNS - 1).join(' | '));
  return cells;
}

/**
 * A section's text as blocks.
 *
 * Paragraphs are separated by blank lines, and the lines of one paragraph are
 * joined with a space. A list continues across a blank line when the next item
 * is of the same kind — a model that spaces out "1. … 2. … 3." still means one
 * list numbered to three, not three lists numbered 1. An indented item joins
 * whatever list it is under, so nesting flattens rather than disappears.
 *
 * What the document cannot hold is read as the nearest thing it can: `#` and
 * `##` headings (the section's own heading is the app's, not the model's) and
 * headings deeper than `####` become paragraphs of their text; fences and
 * rules are dropped, and whatever was between fences is prose; a quotation
 * mark `>` is dropped from the start of a line.
 */
export function blocksOf(text: string): Block[] {
  const src = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : '';
  try {
    return blocks(src);
  } catch {
    return src.trim() ? [{ t: 'p', runs: [{ t: 'text', text: src.trim() }] }] : [];
  }
}

function blocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(QUOTE, ''));
  const out: Block[] = [];
  let para: string[] = [];
  let list: { t: 'ul' | 'ol'; items: string[] } | null = null;

  const flushPara = () => {
    const joined = para.map((l) => l.trim()).join(' ').trim();
    para = [];
    if (!joined) return;
    const hole = holeLine(joined);
    if (hole !== null) {
      out.push({ t: 'hole', text: hole });
      return;
    }
    const runs = runsOf(joined);
    if (runs.length) out.push({ t: 'p', runs });
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((it) => runsOf(it.trim())).filter((r) => r.length > 0);
      if (items.length) out.push({ t: list.t, items });
    }
    list = null;
  };
  const flushAll = () => {
    flushPara();
    flushList();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      // A blank line ends a paragraph, but not a list: the next item decides that.
      flushPara();
      continue;
    }
    if (FENCE.test(line) || RULE.test(line)) {
      flushAll();
      continue;
    }

    if (/^#{1,6}$/.test(trimmed)) {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})(\s+|(?=[^#]))(.*)$/.exec(trimmed);
    if (heading) {
      const depth = heading[1].length;
      const body = heading[3].replace(/\s+#+\s*$/, '').trim();
      if (depth === 3 || depth === 4) {
        flushAll();
        const runs = runsOf(body);
        if (runs.length) out.push({ t: 'h', depth: depth === 3 ? 1 : 2, runs });
        continue;
      }
      if (heading[2]) {
        flushAll();
        const runs = runsOf(body);
        if (runs.length) out.push({ t: 'p', runs });
        continue;
      }
    }

    const hole = holeLine(trimmed);
    if (hole !== null) {
      flushAll();
      out.push({ t: 'hole', text: hole });
      continue;
    }

    if (hasPipe(trimmed)) {
      const next = lines[i + 1] ?? '';
      const separated = isSeparator(next, trimmed);
      const bare = !separated && trimmed.startsWith('|') && next.trim().startsWith('|');
      if (separated || bare) {
        flushAll();
        const rows: string[][] = [cellsOf(trimmed)];
        let j = separated ? i + 2 : i + 1;
        for (; j < lines.length; j++) {
          const r = lines[j].trim();
          if (!r || !(bare ? r.startsWith('|') : hasPipe(r))) break;
          if (isSeparator(r, '|')) continue;
          rows.push(cellsOf(r));
        }
        i = j - 1;
        const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
        const cells = rows.map((r) => {
          const runs = r.map((c) => runsOf(c));
          while (runs.length < width) runs.push([]);
          return runs;
        });
        out.push({ t: 'table', head: cells[0], rows: cells.slice(1) });
        continue;
      }
    }

    const bullet = BULLET.exec(line);
    const ordered = bullet ? null : ORDERED.exec(line);
    const item = bullet ?? ordered;
    if (item) {
      const kind = bullet ? 'ul' : 'ol';
      const nested = item[1].length > 0;
      flushPara();
      if (list && (list.t === kind || nested)) {
        list.items.push(item[2]);
      } else {
        flushList();
        list = { t: kind, items: [item[2]] };
      }
      continue;
    }

    if (list && /^\s/.test(line)) {
      // An indented line under an item is more of that item.
      list.items[list.items.length - 1] += ' ' + trimmed;
      continue;
    }

    flushList();
    para.push(trimmed);
  }
  flushAll();
  return out;
}

// ── what a section says ───────────────────────────────────────────────────

/** Every run of every block, in reading order. */
function allRuns(bs: readonly Block[]): Run[] {
  const out: Run[] = [];
  for (const b of bs) {
    if (b.t === 'p' || b.t === 'h') out.push(...b.runs);
    else if (b.t === 'ul' || b.t === 'ol') for (const it of b.items) out.push(...it);
    else if (b.t === 'table') for (const row of [b.head, ...b.rows]) for (const cell of row) out.push(...cell);
    else if (b.t === 'hole') out.push({ t: 'hole', text: b.text });
  }
  return out;
}

/**
 * The keys a text cites, in the order they are first cited, each once.
 *
 * Read through `blocksOf`, so a key counts exactly when the preview and the
 * Word file would print a citation for it — a marker inside a gap, or inside
 * a bracket that is not a marker group, is not a citation.
 */
export function markersIn(text: string): string[] {
  const seen: string[] = [];
  for (const r of allRuns(blocksOf(text))) {
    if (r.t !== 'cite') continue;
    for (const k of r.keys) if (!seen.includes(k)) seen.push(k);
  }
  return seen;
}

/**
 * The words of a text, as a reader counts them.
 *
 * Markup is not words: list markers, heading hashes, table pipes and marker
 * groups are gone before anything is counted, and a gap counts for what it
 * says, not for its brackets. A word is anything between spaces with a letter
 * or a digit in it, in any script — which is what makes Arabic and Kurdish
 * count, where `\w` would find nothing, and a lone dash or `،` count as nothing.
 */
export function wordCount(text: string): number {
  const parts: string[] = [];
  for (const r of allRuns(blocksOf(text))) parts.push(r.t === 'cite' ? ' ' : r.t === 'hole' ? ` ${r.text} ` : r.text);
  let n = 0;
  for (const w of parts.join(' ').split(/\s+/)) if (WORDISH.test(w)) n++;
  return n;
}
