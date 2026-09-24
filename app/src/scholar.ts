/**
 * Scholar: the references a document cites, found in OpenAlex and Crossref.
 *
 * This is the only part of Research that talks to the network, and it talks to
 * two public indexes of published work and nothing else. A generated thesis is
 * worth exactly as much as its reference list, and a reference list a model
 * wrote is a list of studies that may not exist. So the records come from here,
 * field by field as the index gave them, and the model only ever points at them.
 *
 * ## Why these two, and in this order
 *
 * OpenAlex ranks by relevance and returns what the model and the ranking need
 * — abstracts, languages, citation counts — in one request. Crossref is the
 * registry most DOIs live in, and it answers when OpenAlex will not: anonymous
 * OpenAlex search is a small daily budget and, under load, a 429 that asks for
 * thirty seconds. Waiting thirty seconds per query would leave somebody
 * watching a spinner for minutes, so a query OpenAlex cannot answer goes to
 * Crossref instead, and once OpenAlex has asked for a long rest it is not asked
 * again until the rest is over. Semantic Scholar is not used at all: it refuses
 * anonymous callers without the header a webview needs to read the refusal.
 *
 * ## Being a good guest
 *
 * Both are free services run for everybody. Crossref's anonymous pool allows
 * one request at a time, about one a second, so its requests here are strictly
 * sequential and at least a second apart. No header is ever sent — a
 * Content-Type or Authorization header turns a plain GET into a CORS preflight
 * Crossref refuses — and no address either: the researcher's email is theirs,
 * and Crossref's `mailto=` pool is not worth giving it away for.
 *
 * ## Pure, apart from the one call it is handed
 *
 * Every URL, every parser and the ranking are plain functions over strings and
 * JSON, tested against real responses. The fetching is a `Get` the panel
 * passes in, a thin wrapper over `fetch(url, { signal })`, so the search can be
 * run in a test with a fake that records every URL and never touches a socket.
 */

import type { Person, Source, SourceType } from './research';
import { fold } from './settings';
import { backoffMs, pause, retryAfterMs } from './retry';

/** One GET, as the panel makes it: the URL and an abort signal, and no headers. */
export type Get = (url: string, signal?: AbortSignal) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

const OPENALEX = 'https://api.openalex.org/works';
const CROSSREF = 'https://api.crossref.org/works';

/** What a record needs and no more: a whole OpenAlex work is tens of kilobytes. */
const OPENALEX_FIELDS = 'id,doi,title,display_name,publication_year,authorships,primary_location,biblio,type,language,abstract_inverted_index,cited_by_count,is_retracted';

/** Crossref's own names. `language` is not selectable there: asking for it is a 400. */
const CROSSREF_FIELDS = 'DOI,title,author,container-title,issued,type,abstract,volume,issue,page,publisher,URL';

/** Crossref's anonymous pool: one request at a time, one a second. */
const CROSSREF_GAP = 1000;

/** A page: at least five, because a query is one request whatever it asks for, and at most 25. */
const PAGE_MIN = 5;
const PAGE_MAX = 25;

/** More queries than this is a plan that went on too long, and each one spends the daily budget. */
const MAX_QUERIES = 10;

/** What the model reads of a work. Enough to know what it found; a whole abstract is rarely more. */
const ABSTRACT_MAX = 1500;

/** A work with more authors than this is a collaboration; the rest add weight to every save, not meaning. */
const AUTHORS_MAX = 100;

// ── small readers over JSON nobody promised the shape of ─────────────────

type Json = Record<string, unknown>;

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A field as one line of text, or undefined when there is nothing in it. */
function line(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  const t = s.normalize('NFC').replace(/\s+/g, ' ').trim();
  return t || undefined;
}

/** A query as the indexes should see it: one line, no control characters. */
function tidy(query: string): string {
  return (typeof query === 'string' ? query : '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A whole number of records between 1 and `most`. */
function count(n: number, most: number): number {
  return Math.min(most, Math.max(1, Number.isFinite(n) ? Math.floor(n) : 1));
}

// ── URLs ──────────────────────────────────────────────────────────────────

/** An OpenAlex search, relevance-ranked, with only the fields a record needs. */
export function openAlexUrl(query: string, perPage: number): string {
  return `${OPENALEX}?search=${encodeURIComponent(tidy(query))}&per-page=${count(perPage, 200)}&select=${OPENALEX_FIELDS}`;
}

/** A Crossref search. No `mailto`, ever: that would send somebody's address to a third party. */
export function crossrefUrl(query: string, rows: number): string {
  return `${CROSSREF}?query=${encodeURIComponent(tidy(query))}&rows=${count(rows, 1000)}&select=${CROSSREF_FIELDS}`;
}

/** A DOI as a path segment: escaped, except for the slash both services expect to see. */
function doiPath(doi: string): string {
  return encodeURIComponent(doi).replace(/%2F/gi, '/');
}

// ── DOIs ──────────────────────────────────────────────────────────────────

/**
 * A DOI as the app keeps it — bare and lower-case — out of however it was
 * pasted: a doi.org or dx.doi.org link, `doi:10.…`, `DOI 10.…`, or bare. `null`
 * for anything that is not one, so a typo is caught before a lookup is spent.
 *
 * DOIs are case-insensitive by definition, so lower-casing loses nothing and
 * makes two spellings of one DOI one key. Punctuation a sentence put after it
 * is dropped, and a closing bracket only when it closes nothing inside the DOI
 * — `10.1016/0004-3702(87)90086-5` keeps its own.
 */
export function cleanDoi(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (/%[0-9a-f]{2}/i.test(s)) {
    try { s = decodeURIComponent(s); } catch { /* not really escaped; keep it as typed */ }
  }
  s = s
    .replace(/^<(.*)>$/, '$1')
    .replace(/^(?:https?:\/\/)?(?:(?:dx|www)\.)?doi\.org\//i, '')
    .replace(/^doi\s*[:\uFF1A]?\s*/i, '')
    .replace(/[.,;:]+$/, '');
  const unclosed = (open: string, close: string) => s.endsWith(close) && s.split(open).length < s.split(close).length;
  if (unclosed('(', ')') || unclosed('[', ']')) s = s.slice(0, -1);
  if (!/^10\.\d+(?:\.\d+)*\/\S+$/.test(s)) return null;
  return s.toLowerCase();
}

// ── text ──────────────────────────────────────────────────────────────────

const NAMED: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function entities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e: string) => {
    if (e[0] !== '#') return Object.prototype.hasOwnProperty.call(NAMED, e.toLowerCase()) ? NAMED[e.toLowerCase()] : whole;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
  });
}

/** Tags that end a run of words: removing them must leave a space, or two sentences run together. */
const BLOCK_TAG = /<\/?(?:[\w-]+:)?(?:p|sec|title|list|list-item|label|caption|break|br|disp-quote|def-list|def-item|term|def|table-wrap|table|tr|td|th|div)\b[^<>]*>/gi;

/** Any other tag — `<i>`, `<jats:sub>` — goes without a space, so H<sub>2</sub>O stays one word. */
const INLINE_TAG = /<\/?[a-z][\w:.-]*(?:\s[^<>]*)?\/?>/gi;

/**
 * Markup out, entities decoded, one line, composed.
 *
 * Twice, because some publishers deposit their HTML escaped inside the JATS —
 * `<jats:p>&lt;p&gt;The impact…` — and one pass turns that into a literal
 * `<p>` in the text the model reads. A tag has to start with a letter, so
 * `p < 0.05` is left alone. Composed (NFC) because records arrive both ways —
 * a real Crossref abstract spells Jandrić as c and a combining accent — and a
 * letter in two pieces is a different string to every comparison after this.
 */
function plain(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) out = entities(out.replace(BLOCK_TAG, ' ').replace(INLINE_TAG, ''));
  return out.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * The word "Abstract" some records begin with, which is a heading and not the
 * abstract. Only before a capital, a digit or a letter with no case, so an
 * abstract that begins "Abstract art…" keeps its first word. No `i` flag: with
 * it, `\p{Lu}` matches every letter.
 */
const LEADING_LABEL = /^(?:[Aa]bstract|ABSTRACT|[Ss]ummary|SUMMARY|الملخص|المستخلص|ملخص)\s*[:.\u2013\u2014-]?\s+(?=[\p{Lu}\p{Lo}\d"\u201C(])/u;

/** An abstract as the model reads it: plain, one paragraph, and not longer than it needs to be. */
function finish(s: string): string | undefined {
  const t = plain(s).replace(LEADING_LABEL, '');
  if (!t) return undefined;
  if (t.length <= ABSTRACT_MAX) return t;
  let cut = t.slice(0, ABSTRACT_MAX - 1);
  const space = cut.lastIndexOf(' ');
  if (space > ABSTRACT_MAX * 0.8) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.\u2013\u2014-]+$/, '')}…`;
}

/**
 * OpenAlex keeps an abstract as an inverted index — `{ word: [positions] }` —
 * because publishers let it index abstracts but not reprint them. Putting the
 * words back at their positions is the abstract.
 */
function uninvert(index: unknown): string {
  const o = obj(index);
  if (!o) return '';
  const words: string[] = [];
  for (const [word, at] of Object.entries(o)) {
    for (const i of arr(at)) {
      // An abstract is hundreds of words. A position past this is a broken record, not a long abstract.
      if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < 20000) words[i] = word;
    }
  }
  return words.filter((w) => typeof w === 'string').join(' ');
}

/** A structured abstract's own headings — Purpose, Methods — kept as text; the heading "Abstract" dropped. */
function jatsTitles(s: string): string {
  return s.replace(/<(?:[\w-]+:)?title\b[^<>]*>([\s\S]*?)<\/(?:[\w-]+:)?title>/gi, (_, inner: string) => {
    const t = plain(inner);
    if (!t || /^(?:abstract|summary|الملخص|المستخلص|ملخص)[.:]?$/i.test(t)) return ' ';
    return ` ${t}${/[.:?!]$/.test(t) ? '' : ':'} `;
  });
}

/** Normalised for "is this the same title": folded, letters and digits only, Arabic digits as Latin. */
function sameTitle(title: string): string {
  return fold(title)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

// ── people ────────────────────────────────────────────────────────────────

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Lower-case words that belong to the family name they come before: van Beethoven, de la Cruz. */
const PARTICLES = new Set(['van', 'von', 'der', 'den', 'de', 'del', 'della', 'di', 'da', 'dos', 'das', 'du', 'la', 'le', 'ten', 'ter', 'zu', 'bin', 'ibn', 'al', 'el']);
const SUFFIX = /^(?:jr\.?|sr\.?|ii|iii|iv)$/i;

/**
 * A name OpenAlex gives whole, split into given and family.
 *
 * A Latin-script name splits at its last word, with any particles before it.
 * An Arabic-script name is kept whole, as `research.ts` says of `Person`:
 * محمد عبد الرحمن cut at its last space is a man called الرحمن, and a name cut
 * at the wrong space is worse than one not cut at all.
 */
function personOf(name: string): Person | null {
  const s = name.normalize('NFC').replace(/[\u2010\u2011]/g, '-').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (ARABIC_SCRIPT.test(s)) return { family: s };
  const comma = s.indexOf(',');
  if (comma > 0) {
    const family = s.slice(0, comma).trim();
    const given = s.slice(comma + 1).trim();
    return given ? { given, family } : { family };
  }
  const parts = s.split(' ');
  if (parts.length === 1) return { family: s };
  let start = parts.length - 1;
  if (SUFFIX.test(parts[start]) && start > 1) start -= 1;
  while (start > 1 && PARTICLES.has(parts[start - 1])) start -= 1;
  return { given: parts.slice(0, start).join(' '), family: parts.slice(start).join(' ') };
}

/** A Crossref author: given and family when it has them, an organisation's `name` when it does not. */
function crossrefPerson(v: unknown): Person | null {
  const a = obj(v);
  if (!a) return null;
  const family = line(a.family);
  const given = line(a.given);
  if (family) return given ? { given, family } : { family };
  if (given) return personOf(given);
  const name = line(a.name);
  return name ? { family: name } : null;
}

// ── records ───────────────────────────────────────────────────────────────

/**
 * What each index calls a kind of work, as the reference styles distinguish
 * them. `null` is not a work anyone cites: a journal's front matter, an
 * erratum, a peer review, the index's own catch-all.
 */
const OPENALEX_TYPES: ReadonlyMap<string, SourceType | null> = new Map<string, SourceType | null>([
  ['article', 'article'], ['review', 'article'], ['letter', 'article'], ['editorial', 'article'],
  ['book-chapter', 'chapter'], ['reference-entry', 'chapter'],
  ['book', 'book'],
  ['dissertation', 'thesis'],
  ['report', 'report'], ['standard', 'report'],
  ['preprint', 'other'], ['dataset', 'other'],
  ['paratext', null], ['erratum', null], ['other', null], ['retraction', null],
  ['peer-review', null], ['grant', null], ['libguides', null], ['supplementary-materials', null],
]);

const CROSSREF_TYPES: ReadonlyMap<string, SourceType | null> = new Map<string, SourceType | null>([
  ['journal-article', 'article'],
  ['book-chapter', 'chapter'], ['book-section', 'chapter'], ['book-part', 'chapter'], ['book-track', 'chapter'], ['reference-entry', 'chapter'],
  ['book', 'book'], ['monograph', 'book'], ['edited-book', 'book'], ['reference-book', 'book'], ['book-set', 'book'], ['book-series', 'book'],
  ['proceedings-article', 'conference'], ['proceedings', 'conference'], ['proceedings-series', 'conference'],
  ['dissertation', 'thesis'],
  ['report', 'report'], ['report-component', 'report'], ['report-series', 'report'], ['standard', 'report'], ['standard-series', 'report'],
  ['posted-content', 'other'], ['dataset', 'other'],
  ['other', null], ['journal-issue', null], ['journal-volume', null], ['journal', null],
  ['component', null], ['grant', null], ['peer-review', null], ['database', null],
]);

/** Pages of a book that Crossref files as chapters. OpenAlex calls them paratext; Crossref does not say. */
const PARATEXT = /^(?:front ?matter|back ?matter|(?:author |subject )?index|(?:table of )?contents|editorial board|title page|half[- ]title|cover|copyright(?: page)?|series page|dedication|acknowledge?ments|list of contributors|notes on contributors)[.:]?$/i;

/** Elsevier and others put the retraction in the title when the record itself does not say. */
const RETRACTED_TITLE = /^\s*(?:retracted|withdrawn)(?: article)?\s*[:.\u2013\u2014-]/i;

/** A source with the fields that are absent left out, so a stored record has no `"x": undefined`. */
function compact(s: Source): Source {
  const out = s as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return s;
}

function kindOf(types: ReadonlyMap<string, SourceType | null>, type: string): SourceType | null {
  return types.has(type) ? (types.get(type) ?? null) : 'other';
}

function yearOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 1000 && v < 3000 ? v : undefined;
}

function langOf(v: unknown): string | undefined {
  return typeof v === 'string' && /^[a-z]{2,3}$/.test(v) ? v : undefined;
}

function citedOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined;
}

/**
 * One OpenAlex work. `strict` is a search: junk types and front matter are
 * dropped. A lookup of a DOI somebody typed is not strict — they asked for
 * that work, whatever it is.
 */
function openAlexWork(v: unknown, strict: boolean): Source | null {
  const w = obj(v);
  if (!w) return null;
  const title = plain(typeof w.title === 'string' ? w.title : typeof w.display_name === 'string' ? w.display_name : '');
  if (!title || (strict && PARATEXT.test(title))) return null;
  const kind = kindOf(OPENALEX_TYPES, typeof w.type === 'string' ? w.type : '');
  if (strict && kind === null) return null;
  const loc = obj(w.primary_location);
  const src = obj(loc?.source);
  const type: SourceType = kind === 'article' && src?.type === 'conference' ? 'conference' : kind ?? 'other';
  const doi = cleanDoi(typeof w.doi === 'string' ? w.doi : '') ?? undefined;
  const bib = obj(w.biblio);
  const first = line(bib?.first_page);
  const last = line(bib?.last_page);
  const landing = line(loc?.landing_page_url);
  const retracted = w.is_retracted === true || RETRACTED_TITLE.test(title);
  const authors = arr(w.authorships)
    .map((a) => {
      const au = obj(a);
      return personOf(line(obj(au?.author)?.display_name) ?? line(au?.raw_author_name) ?? '');
    })
    .filter((p): p is Person => p !== null)
    .slice(0, AUTHORS_MAX);
  return compact({
    key: '',
    doi,
    title,
    authors,
    year: yearOf(w.publication_year),
    venue: line(src?.display_name),
    volume: line(bib?.volume),
    issue: line(bib?.issue),
    pages: first && last && last !== first ? `${first}-${last}` : first,
    publisher: line(src?.host_organization_name),
    url: doi ? `https://doi.org/${doi}` : landing && /^https?:\/\//i.test(landing) ? landing : undefined,
    type,
    abstract: finish(uninvert(w.abstract_inverted_index)),
    lang: langOf(w.language),
    cited: citedOf(w.cited_by_count),
    origin: 'openalex',
    verified: true,
    retracted: retracted || undefined,
    use: !retracted,
  });
}

/** One Crossref work, strict or not as for OpenAlex. */
function crossrefWork(v: unknown, strict: boolean): Source | null {
  const w = obj(v);
  if (!w) return null;
  const title = plain(arr(w.title).find((t): t is string => typeof t === 'string' && t.trim() !== '') ?? (typeof w.title === 'string' ? w.title : ''));
  if (!title || (strict && PARATEXT.test(title))) return null;
  const kind = kindOf(CROSSREF_TYPES, typeof w.type === 'string' ? w.type : '');
  if (strict && kind === null) return null;
  const doi = cleanDoi(typeof w.DOI === 'string' ? w.DOI : '') ?? undefined;
  const issued = arr(arr(obj(w.issued)?.['date-parts'])[0]);
  const venue = arr(w['container-title']).find((t): t is string => typeof t === 'string' && t.trim() !== '');
  const retracted = RETRACTED_TITLE.test(title);
  const url = line(w.URL);
  const abstract = typeof w.abstract === 'string' ? finish(jatsTitles(w.abstract)) : undefined;
  return compact({
    key: '',
    doi,
    title,
    authors: arr(w.author).map(crossrefPerson).filter((p): p is Person => p !== null).slice(0, AUTHORS_MAX),
    year: yearOf(issued[0]),
    venue: venue ? plain(venue) || undefined : undefined,
    volume: line(w.volume),
    issue: line(w.issue),
    pages: line(w.page),
    publisher: line(w.publisher),
    url: url && /^https?:\/\//i.test(url) ? url : doi ? `https://doi.org/${doi}` : undefined,
    type: kind ?? 'other',
    abstract,
    lang: langOf(w.language),
    cited: citedOf(w['is-referenced-by-count']),
    origin: 'crossref',
    verified: true,
    retracted: retracted || undefined,
    use: !retracted,
  });
}

/** The works in an OpenAlex answer — a search's `results`, or one work — or `null` for neither. */
function openAlexList(json: unknown, strict: boolean): Source[] | null {
  const o = obj(json);
  if (!o) return null;
  const list = Array.isArray(o.results) ? o.results : typeof o.id === 'string' || typeof o.title === 'string' ? [o] : null;
  if (!list) return null;
  return list.map((w) => openAlexWork(w, strict)).filter((s): s is Source => s !== null);
}

/** The works in a Crossref answer — `message.items`, or one work's `message` — or `null` for neither. */
function crossrefList(json: unknown, strict: boolean): Source[] | null {
  const m = obj(obj(json)?.message);
  if (!m) return null;
  const list = Array.isArray(m.items) ? m.items : typeof m.DOI === 'string' || Array.isArray(m.title) ? [m] : null;
  if (!list) return null;
  return list.map((w) => crossrefWork(w, strict)).filter((s): s is Source => s !== null);
}

/**
 * The works in an OpenAlex search (`results[]`) or single-work answer, as
 * sources: `key` empty for `merge` to assign, verified, in use unless retracted.
 * Works without a title, and the kinds nobody cites, are left out.
 */
export function fromOpenAlex(json: unknown): Source[] {
  return openAlexList(json, true) ?? [];
}

/** The same, for a Crossref search (`message.items[]`) or single-work answer. */
export function fromCrossref(json: unknown): Source[] {
  return crossrefList(json, true) ?? [];
}

// ── merging ───────────────────────────────────────────────────────────────

/** Every key a record can be recognised by: its DOI, and its title with its year. */
function identities(s: Source): string[] {
  const out: string[] = [];
  const doi = cleanDoi(s.doi ?? '');
  if (doi) out.push(`doi:${doi}`);
  const t = sameTitle(typeof s.title === 'string' ? s.title : '');
  if (t) out.push(`title:${t}|${s.year ?? ''}`);
  return out;
}

/**
 * `found` added to `existing`, without anything already there.
 *
 * A record is already there when its DOI is, or its normalised title with the
 * same year — the second catches a work Crossref and OpenAlex hold under
 * different DOIs, a preprint and its article, and the Arabic records that have
 * no DOI at all. `existing` comes back first and untouched, keys and all; each
 * new record gets the next key after the highest `sN` in use, so a key a
 * section cites never comes to mean a different work. At most `max` are added.
 *
 * `floor` is the highest `sN` the document uses anywhere else — researchrun's
 * `highestKey`, which reads the outline and the markers in the text. The
 * sources alone are not enough: a marker left in the text for a record that
 * was never kept, or one the researcher deleted, still names its key, and a
 * new work given that key would be cited for a claim nobody read it for.
 */
export function merge(existing: Source[], found: Source[], max: number, floor = 0): Source[] {
  const seen = new Set<string>();
  let last = Number.isInteger(floor) && floor > 0 ? floor : 0;
  for (const s of existing) {
    for (const id of identities(s)) seen.add(id);
    const n = /^s(\d+)$/.exec(s.key)?.[1];
    if (n) last = Math.max(last, Number(n));
  }
  const room = max > 0 ? Math.floor(max) : 0;
  const out = [...existing];
  let added = 0;
  for (const s of found) {
    if (added >= room) break;
    if (!s || typeof s.title !== 'string' || !s.title.trim()) continue;
    const ids = identities(s);
    if (ids.some((id) => seen.has(id))) continue;
    for (const id of ids) seen.add(id);
    last += 1;
    added += 1;
    out.push({ ...s, key: `s${last}` });
  }
  return out;
}

// ── searching ─────────────────────────────────────────────────────────────

type Answer =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status: number; retryAfter: string | null };

/** Whether something thrown is an abort — `fetch`'s DOMException, or ours. */
function isAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError';
}

/** The error a stopped search ends with: the abort that was caught, the signal's reason, or a fresh AbortError. */
function stopped(signal?: AbortSignal, cause?: unknown): unknown {
  if (isAbort(cause)) return cause;
  if (isAbort(signal?.reason)) return signal?.reason;
  const e = new Error('The search was stopped.');
  e.name = 'AbortError';
  return e;
}

/**
 * One request. A failure of the network, of the service or of its JSON comes
 * back as an answer to act on; being stopped is thrown, because nothing after
 * it should run.
 */
async function ask(get: Get, url: string, signal?: AbortSignal): Promise<Answer> {
  if (signal?.aborted) throw stopped(signal);
  try {
    const r = await get(url, signal);
    if (!r.ok) {
      let retryAfter: string | null = null;
      try { retryAfter = r.headers?.get('retry-after') ?? null; } catch { /* no headers to read */ }
      return { ok: false, status: r.status, retryAfter };
    }
    return { ok: true, status: r.status, json: await r.json() };
  } catch (e) {
    if (signal?.aborted || isAbort(e)) throw stopped(signal, e);
    return { ok: false, status: 0, retryAfter: null };
  }
}

/** The queries worth sending: trimmed, non-empty, each once however it was spelt. */
function distinct(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of Array.isArray(queries) ? queries : []) {
    const t = tidy(q);
    const k = fold(t);
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.slice(0, MAX_QUERIES);
}

/**
 * Which records come first.
 *
 * The indexes rank by relevance to the query, and they are better at that than
 * anything that could be done here with a title and a year, so their order is
 * the main key. Two things are put ahead of it:
 *
 * - A record the model can use. One with authors and an abstract can be cited
 *   and understood; one with authors and no abstract can be cited, but the
 *   model knows it only by its title; one with no authors is cited by its
 *   title, the weakest reference a thesis can carry, whether or not there is
 *   an abstract to read. So four tiers: both, authors only, abstract only,
 *   neither.
 * - A little for being cited. A study cited a thousand times is usually the
 *   one a supervisor expects to see, but citation counts favour old and
 *   English work, and a thesis on a local question needs local sources more
 *   than famous ones. So it is worth half a place per power of ten: a
 *   thousand citations moves a work up a place and a half, a million three
 *   places, and nothing moves one out of its tier.
 *
 * Positions are compared across queries rather than query by query: the plan
 * chose each query for a different part of the topic, and the third result of
 * every query is worth more than the tenth of the first.
 */
function tier(s: Source): number {
  return (s.authors.length ? 0 : 2) + (s.abstract ? 0 : 1);
}

const CITED_LIFT = 0.5;

interface Found { s: Source; q: number; at: number }

function rank(pool: readonly Found[]): Source[] {
  const score = (f: Found) => f.at - CITED_LIFT * Math.log10(1 + (f.s.cited ?? 0));
  return [...pool]
    .sort((a, b) => tier(a.s) - tier(b.s) || score(a) - score(b) || a.q - b.q || a.at - b.at)
    .map((f) => f.s);
}

/**
 * Records for a document: every query searched, the results pooled, the
 * duplicates dropped, ranked, and the best `want` returned with keys s1… .
 *
 * Each query asks for its share of `want` and a margin — about 1.6 times,
 * because some results are duplicates across queries and some are not works
 * anyone cites. OpenAlex first; a query it cannot answer (a 429, a 5xx, no
 * network, an answer that is not a result list) goes to Crossref, one request
 * at a time and a second apart. A query neither could answer is counted in
 * `failed`, so the panel can say the list is short and why, and `sent` is how
 * many queries there were once repeats were dropped and the list capped — so
 * "every search failed" can be told from "some did" by comparing the two. Of
 * two records of one work, the one the model can use more of is kept; either
 * saying it was retracted is enough to mark it so.
 *
 * `onFound` is told how many records there are so far after each query.
 * `sleep` is the wait between Crossref requests, replaceable so a test does not
 * wait. Aborting stops at the next request or wait and throws the AbortError.
 */
export async function search(
  queries: string[],
  want: number,
  get: Get,
  o: { signal?: AbortSignal; onFound?: (n: number) => void; sleep?: (ms: number, signal?: AbortSignal) => Promise<void> } = {},
): Promise<{ sources: Source[]; failed: number; sent: number }> {
  const { signal, onFound } = o;
  const sleep = o.sleep ?? pause;
  if (signal?.aborted) throw stopped(signal);
  const wanted = want > 0 ? Math.floor(want) : 0;
  const qs = distinct(queries);
  if (!qs.length || !wanted) return { sources: [], failed: 0, sent: 0 };
  const per = Math.min(PAGE_MAX, Math.max(PAGE_MIN, Math.ceil((wanted * 1.6) / qs.length)));

  const pool: Found[] = [];
  const index = new Map<string, Found>();
  const add = (s: Source, q: number, at: number) => {
    const ids = identities(s);
    const same = ids.map((id) => index.get(id)).find((f): f is Found => f !== undefined);
    if (!same) {
      const f = { s, q, at };
      pool.push(f);
      for (const id of ids) index.set(id, f);
      return;
    }
    const retracted = same.s.retracted || s.retracted;
    if (tier(s) < tier(same.s)) same.s = s;
    if (retracted) same.s = { ...same.s, retracted: true, use: false };
    for (const id of ids) if (!index.has(id)) index.set(id, same);
  };

  let failed = 0;
  let restUntil = 0;
  let crossrefAt = -Infinity;
  for (let q = 0; q < qs.length; q++) {
    let found: Source[] | null = null;
    if (Date.now() >= restUntil) {
      const r = await ask(get, openAlexUrl(qs[q], per), signal);
      if (r.ok) found = openAlexList(r.json, true);
      else if (r.status === 429 && backoffMs(1, r.retryAfter) < 0) {
        // Asked to come back in more than ten seconds: the rest of this search goes to Crossref.
        restUntil = Date.now() + (retryAfterMs(r.retryAfter) ?? 0);
      }
    }
    if (found === null) {
      const since = Date.now() - crossrefAt;
      if (since < CROSSREF_GAP) {
        await sleep(CROSSREF_GAP - since, signal);
        if (signal?.aborted) throw stopped(signal);
      }
      const r = await ask(get, crossrefUrl(qs[q], per), signal);
      crossrefAt = Date.now();
      if (r.ok) found = crossrefList(r.json, true);
    }
    if (found === null) {
      failed += 1;
      continue;
    }
    found.forEach((s, at) => add(s, q, at));
    onFound?.(Math.min(pool.length, wanted));
  }
  return { sources: merge([], rank(pool), wanted), failed, sent: qs.length };
}

/**
 * The record for a DOI somebody typed, verified by an index that holds it:
 * OpenAlex first, then Crossref, the registry most DOIs live in. `null` when
 * the text is not a DOI or both say they have never heard of it; a throw when
 * it could not be told — a network down or a service refusing is not the same
 * answer as "no such work", and saying it was would call a real reference fake.
 */
export async function lookupDoi(doi: string, get: Get, signal?: AbortSignal): Promise<Source | null> {
  const clean = cleanDoi(doi);
  if (!clean) return null;
  const path = doiPath(clean);
  const oa = await ask(get, `${OPENALEX}/doi:${path}?select=${OPENALEX_FIELDS}`, signal);
  const a = oa.ok ? openAlexList(oa.json, false)?.[0] : undefined;
  if (a) return { ...a, doi: a.doi ?? clean };
  const cr = await ask(get, `${CROSSREF}/${path}`, signal);
  const c = cr.ok ? crossrefList(cr.json, false)?.[0] : undefined;
  if (c) return { ...c, doi: c.doi ?? clean };
  const unknown = (r: Answer) => r.ok || r.status === 404;
  if (unknown(oa) && unknown(cr)) return null;
  const said = (r: Answer) => (r.status ? `HTTP ${r.status}` : 'no answer');
  throw new Error(`The DOI could not be checked: OpenAlex gave ${said(oa)}, Crossref ${said(cr)}.`);
}
