/**
 * Citations: what a marker becomes in the text, and the list at the end, in
 * the style the researcher chose.
 *
 * The model never writes a citation (see research.ts). It writes `[@s3]`, and
 * this file turns that into a footnote, `(Family, 2020)` or `[3]` from the
 * record `s3` names, and builds the reference list from the same records. So a
 * citation and its entry always agree, a study nobody wrote has no record to be
 * built from, and changing the style re-formats the whole document without
 * asking the model anything.
 *
 * ## Six styles, as universities in the region ask for them
 *
 * Footnotes, the way Iraqi and Kurdish universities cite; and the five the
 * manuals name — APA 7, Harvard (as Cite Them Right gives it), Chicago
 * author-date (17th), MLA 9 and IEEE. Each entry is built from the fields the
 * record has, in the order the style puts them, and a field the record lacks
 * is left out along with its punctuation: no "undefined", no "()", no ", ,". A
 * reference list that looks broken is marked down whether or not the works
 * are real.
 *
 * ## Footnotes are the region's own style
 *
 * An Iraqi or Kurdish law faculty does not cite (Family, 2020). A marker
 * becomes a note at the foot of the page, as the owner's example — an Iraqi
 * law faculty's working paper — has them: the first note for a source says
 * everything a reader needs to find it — "author، title، publisher، city،
 * ط3، year، ص12." — and every later one only "author، مصدر سابق، ص40.".
 * Which note is the first is a fact about reading the document in order,
 * not about the document, so the context remembers what its notes have
 * cited (`seen`) as `renderRuns` goes, and a context serves one pass. A
 * later note is never "المصدر نفسه", even straight after the first: that is
 * shorter, and wrong the moment a paragraph moves.
 *
 * The list at the end is grouped by kind — dictionaries, books, theses,
 * studies, legislation, websites, and last the works in other scripts — each
 * group under an ordinal heading and numbered from one. A Latin-script work in
 * such a document is cited as Chicago's notes cite it, in English; a Kurdish
 * work in a Kurdish document in Kurdish words; an Arabic work in Arabic words,
 * whatever the document is written in. An English document with footnotes is
 * Chicago notes and bibliography throughout.
 *
 * ## Arabic script is formatted as Arabic script
 *
 * A source whose title is mostly Arabic-script letters is cited the way an
 * Arabic reference list cites it: Arabic commas, و for "and", وآخرون for
 * "et al.", and a given name never cut to an initial — "م." is not a name
 * anybody in Duhok or Baghdad would recognise. A Latin-script source keeps
 * Latin formatting even inside an Arabic document, and an Arabic, Sorani or
 * Badini document that cites both prints them as two lists, the local
 * sources first, which is how the region's theses are laid out.
 *
 * ## A law is not a book
 *
 * Law, Sharia and the humanities in Iraq cite legislation — a constitution, a
 * law, a regulation — and none of the five manuals has a rule for an Iraqi
 * law. A record of type `law` is cited by its name, number and year, the way
 * the region's legal writing names it ("قانون العقوبات رقم 111 لسنة 1969"),
 * with the article first when the marker gives one ("المادة ١٣ من …"), and
 * listed the same way in every style. A later footnote names a law without
 * its number and year; a constitution keeps its year, which is how it is told
 * from the one before. A Kurdish law in a Kurdish document is named in
 * Kurdish; an Iraqi law stays Arabic wherever it is cited. A dictionary is a
 * book to every style but the footnotes, whose list gives it a group of its
 * own. A book's edition and place are printed where its style prints them.
 *
 * ## Only what is cited, only what may be
 *
 * A source that is switched off, retracted, or never cited is not in the list,
 * and a marker naming it — or naming nothing — prints nothing. The numbers of
 * IEEE and the a/b of two works by the same author in the same year are
 * worked out over exactly the sources that are cited, so they are the same in
 * the text and in the list.
 */

import type { Doc, DocLang, Person, Source, Style } from './research';
import { DOC_LANGS, STYLES, WORDS } from './research';
import { markersIn } from './prose';
import type { Run } from './prose';

/** A piece of formatted text, for the preview and the Word file alike. */
export interface Rich {
  text: string;
  bold?: boolean;
  italic?: boolean;
  link?: string;
  /** A gap the researcher has to fill. */
  hole?: boolean;
  /**
   * A footnote, in the footnotes style: what the note at the foot of the page
   * says. The run's own `text` is empty — the caller draws the reference mark
   * where the run is, and numbers the notes (Word per page, the preview per part).
   */
  note?: Rich[];
}

/**
 * Everything a citation needs to know about its document. `order` is the
 * keys of the usable sources in the order they are first cited — IEEE's
 * numbering, and the only sources the reference list may hold.
 *
 * `seen` is the keys the footnotes of this pass have cited so far, filled by
 * `renderRuns`: the first note for a source is full and every later one short.
 * So a context is good for one pass over the document, in order; the preview
 * and the Word file each make a fresh one with `citeContext`.
 */
export interface CiteContext {
  style: Style;
  lang: DocLang;
  sources: Source[];
  order: string[];
  seen: Set<string>;
}

/** One reference list, or one group of it. `n` is the entry's number: IEEE's, or its place in a footnotes group. */
export interface RefGroup {
  heading: string;
  entries: { key: string; n?: number; runs: Rich[] }[];
}

// ── the context ───────────────────────────────────────────────────────────

/**
 * The context of a document: its style and language, its sources, and which
 * of them it cites, in the order it first cites them — section by section,
 * each read with `markersIn`, so the order is the order a reader meets them.
 *
 * Its `seen` starts empty and is filled by `renderRuns`, so make a fresh
 * context for each full pass over the document in order — the preview's
 * draw, the Word file's build — and never reuse one for a second pass: its
 * first footnotes would all come out short.
 */
export function citeContext(doc: Doc): CiteContext {
  const sources = Array.isArray(doc?.sources) ? doc.sources : [];
  const usable = new Set(sources.filter((s) => s && s.use && !s.retracted).map((s) => s.key));
  const order: string[] = [];
  for (const sec of Array.isArray(doc?.sections) ? doc.sections : []) {
    for (const k of markersIn(sec?.text ?? '')) if (usable.has(k) && !order.includes(k)) order.push(k);
  }
  return { style: STYLES.includes(doc?.style) ? doc.style : 'apa', lang: langOf(doc?.lang), sources, order, seen: new Set() };
}

/**
 * The styles this file formats. A style research.ts names that is not one of
 * them is formatted as APA — whole, rather than APA with another style's
 * words in it — until it is taught here.
 */
const FORMATS: readonly Style[] = ['footnotes', 'apa', 'harvard', 'chicago', 'mla', 'ieee'];
const styleOf = (s: unknown): Style => (FORMATS.includes(s as Style) ? (s as Style) : 'apa');
const langOf = (l: unknown): DocLang => (DOC_LANGS.includes(l as DocLang) ? (l as DocLang) : 'en');

/** What a context cites, and what follows from it: numbers, year letters, shared authors. */
interface Ledger {
  /** Usable, cited sources, in the order first cited. */
  cited: Source[];
  byKey: Map<string, Source>;
  /** IEEE's number for each. */
  n: Map<string, number>;
  /**
   * APA's longer in-text name for a work whose short one a different team
   * shares: "J. Smith", "Smith, Lee, et al." (see `apaNames`).
   */
  names: Map<string, string>;
  /** The letter after the year for two works that would otherwise cite alike. */
  suffix: Map<string, string>;
  /**
   * Keys whose short citation another cited work shares, so theirs says more:
   * MLA names the title; a later footnote keeps the title after the author, or
   * a law's number and year.
   */
  twins: Set<string>;
}

/**
 * The ledger of each context, remembered: a chapter's citations all ask the
 * same question of the same context, and a thesis has hundreds of them. It
 * is worked out again when the context's sources or order are replaced, its
 * style or language changes, or a source is switched off or retracted in
 * place — anything that changes what may be cited.
 */
const LEDGERS = new WeakMap<object, { sources: unknown; order: unknown; stamp: string; ledger: Ledger }>();

function ledgerOf(ctx: CiteContext): Ledger {
  if (!ctx || typeof ctx !== 'object') return workOut(ctx);
  const sources: unknown[] = Array.isArray(ctx.sources) ? ctx.sources : [];
  const flags = sources.map((s) => {
    const r = s as Partial<Source> | null;
    return (r?.use ? 'u' : '-') + (r?.retracted ? 'r' : '-');
  }).join('');
  const stamp = `${ctx.style}|${ctx.lang}|${Array.isArray(ctx.order) ? ctx.order.join(',') : ''}|${flags}`;
  const hit = LEDGERS.get(ctx);
  if (hit && hit.sources === ctx.sources && hit.order === ctx.order && hit.stamp === stamp) return hit.ledger;
  const ledger = workOut(ctx);
  LEDGERS.set(ctx, { sources: ctx.sources, order: ctx.order, stamp, ledger });
  return ledger;
}

function workOut(ctx: CiteContext): Ledger {
  const style = styleOf(ctx?.style);
  const lang = langOf(ctx?.lang);
  const usable = new Map<string, Source>();
  for (const s of Array.isArray(ctx?.sources) ? ctx.sources : []) {
    if (s && typeof s.key === 'string' && s.use && !s.retracted && !usable.has(s.key)) usable.set(s.key, s);
  }
  const cited: Source[] = [];
  for (const k of Array.isArray(ctx?.order) ? ctx.order : []) {
    const s = usable.get(k);
    if (s && !cited.includes(s)) cited.push(s);
  }
  const byKey = new Map(cited.map((s) => [s.key, s]));
  const n = new Map(cited.map((s, i) => [s.key, i + 1]));
  const suffix = new Map<string, string>();
  const twins = new Set<string>();
  const names = style === 'apa' ? apaNames(cited, lang) : new Map<string, string>();
  if (style === 'footnotes') {
    // A later note names a work by its authors, and a law by its bare name;
    // two cited works that would be named alike keep more of themselves.
    const named = new Map<string, string[]>();
    for (const s of cited) {
      const ps = people(s);
      const k = isLaw(s) ? `law\u0000${lawName(s, lang, true)}` : ps.length ? `who\u0000${noteNames(ps, formOf(s, lang))}` : '';
      if (k) named.set(k, [...(named.get(k) ?? []), s.key]);
    }
    for (const keys of named.values()) if (keys.length > 1) keys.forEach((k) => twins.add(k));
    return { cited, byKey, n, names, suffix, twins };
  }
  // Letters for whatever still cites alike once APA's names are longer: the
  // same people in the same year, or teams no surname tells apart.
  const alike = new Map<string, Source[]>();
  for (const s of cited) {
    if (isLaw(s)) continue;
    const w = tongue(arabicScript(s), style, lang);
    const who = names.get(s.key) ?? whoOf(s, style, w, lang);
    const k = style === 'mla' ? who : `${who}\u0000${yearOf(s.year)}`;
    alike.set(k, [...(alike.get(k) ?? []), s]);
  }
  for (const group of alike.values()) {
    if (group.length < 2) continue;
    if (style === 'mla') {
      for (const s of group) twins.add(s.key);
    } else if (style !== 'ieee') {
      const ar = arabicScript(group[0]);
      const letters = ar ? ARABIC_LETTERS : LATIN_LETTERS;
      [...group].sort(byEntry(collator(ar ? 'ar' : 'en')))
        .forEach((s, i) => suffix.set(s.key, letters[i] ?? `${letters[letters.length - 1]}${i}`));
    }
  }
  return { cited, byKey, n, names, suffix, twins };
}

/**
 * APA's in-text names for works by different people that would otherwise
 * cite alike (APA 7, 8.18 and 8.20). A letter after the year says "the same
 * authors again" (9.47) — "Smith, J. A., Jones, K., & Brown, L. (2020a)" in
 * the list claims a second 2020 work by those three — so two different teams
 * are told apart by their names instead: first authors who share a surname
 * by their initials, "(J. Smith, 2020)" beside "(K. Smith, 2019)"; teams of
 * three or more that shorten to one "Smith et al." in one year by as many
 * surnames as it takes, then et al., "(Smith, Jones, et al., 2020)" beside
 * "(Smith, Lee, et al., 2020)" — or by every name when et al. would stand for
 * only one, since it means "and others". Teams no surname tells apart keep
 * one name, and `workOut` gives them letters, the only mark left.
 */
function apaNames(cited: Source[], lang: DocLang): Map<string, string> {
  const names = new Map<string, string>();
  const works = cited.filter((s) => !isLaw(s) && people(s).length);
  const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();
  const initialsOf = new Map<string, Set<string>>();
  for (const s of works) {
    const first = people(s)[0];
    const ini = initials(first.given, true);
    const k = first.family.toLocaleLowerCase();
    if (ini) initialsOf.set(k, (initialsOf.get(k) ?? new Set<string>()).add(ini));
  }
  const teams = new Map<string, string[]>();
  const alike = new Map<string, Source[]>();
  for (const s of works) {
    const ps = people(s);
    const fam = ps.map((p) => p.family);
    const ini = initials(ps[0].given, true);
    if (ini && (initialsOf.get(fam[0].toLocaleLowerCase())?.size ?? 0) > 1) fam[0] = `${ini} ${fam[0]}`;
    const who = teamOf(fam, 'apa', tongue(arabicScript(s), 'apa', lang));
    if (fam[0] !== ps[0].family) names.set(s.key, who);
    teams.set(s.key, fam);
    const k = `${who}\u0000${yearOf(s.year)}`;
    alike.set(k, [...(alike.get(k) ?? []), s]);
  }
  for (const group of alike.values()) {
    for (const s of group) {
      const fam = teams.get(s.key) as string[];
      if (fam.length < 3) continue;
      // Enough surnames to reach the first one each other team differs at.
      let upTo = 1;
      for (const o of group) {
        const other = teams.get(o.key) as string[];
        let d = 0;
        while (d < fam.length && d < other.length && same(fam[d], other[d])) d++;
        if (d < fam.length || d < other.length) upTo = Math.max(upTo, d + 1);
      }
      if (upTo < 2) continue;
      const w = tongue(arabicScript(s), 'apa', lang);
      names.set(s.key, upTo >= fam.length - 1
        ? joined(fam, w.comma, w.comma + w.wa)
        : fam.slice(0, upTo).join(w.comma) + w.comma + w.etal);
    }
  }
  return names;
}

const LATIN_LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ARABIC_LETTERS = 'أ ب ت ث ج ح خ د ذ ر ز س ش ص ض ط ظ ع غ ف ق ك ل م ن ه و ي'.split(' ');

// ── the script and the words ──────────────────────────────────────────────

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
/** Scripts whose names are never cut to an initial. */
const WHOLE_NAMES = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
const LETTER = /\p{L}/u;

/** Whether most of the letters in a text are Arabic-script; `null` when it has none. */
function mostlyArabic(text: string): boolean | null {
  let all = 0;
  let ar = 0;
  for (const ch of text) {
    if (!LETTER.test(ch)) continue;
    all++;
    if (ARABIC.test(ch)) ar++;
  }
  return all ? ar * 2 > all : null;
}

/** A source is Arabic-script when its title is; a record without a title is judged by its names. */
function arabicScript(s: Source): boolean {
  return mostlyArabic(str(s.title))
    ?? mostlyArabic([...people(s).map((p) => `${p.given ?? ''} ${p.family}`), str(s.venue)].join(' '))
    ?? false;
}

/** The small words of a citation, in the source's script. */
interface Tongue {
  ar: boolean;
  comma: string;
  /** "and" before a name, with the space after it where the language wants one. */
  wa: string;
  etal: string;
  nd: string;
  In: string;
  in: string;
  vol: string;
  no: string;
  p: string;
  pp: string;
  thesis: string;
  available: string;
  online: string;
}

/** "No date", for an Arabic-script source, in the document's language. */
const NO_DATE: Readonly<Record<DocLang, string>> = { ar: 'د.ت', ckb: 'بێ ڕێکەوت', kmr: 'بێ دیرۆک', en: 'n.d.' };

function tongue(arabic: boolean, style: Style, lang: DocLang): Tongue {
  if (!arabic) {
    return {
      ar: false, comma: ', ', wa: style === 'apa' ? '& ' : 'and ', etal: 'et al.',
      nd: style === 'harvard' ? 'no date' : 'n.d.',
      In: 'In', in: 'in', vol: 'vol.', no: 'no.', p: 'p.', pp: 'pp.', thesis: 'Thesis',
      available: 'Available at:', online: '[Online]. Available:',
    };
  }
  // Arabic joins و to the word after it; Kurdish writes it as a word of its own.
  return {
    ar: true, comma: '، ', wa: lang === 'ckb' || lang === 'kmr' ? 'و ' : 'و', etal: 'وآخرون',
    nd: NO_DATE[lang],
    In: 'في', in: 'في', vol: 'مج', no: 'ع', p: 'ص', pp: 'ص', thesis: 'رسالة جامعية',
    available: 'متاح على:', online: 'متاح على:',
  };
}

// ── the fields of a record ────────────────────────────────────────────────

/** A field as text: tags from Crossref removed, spaces collapsed, anything that is not text gone. */
function str(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return '';
  return v.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function yearOf(y: unknown): string {
  return typeof y === 'number' && Number.isInteger(y) && y > 0 && y < 10000 ? String(y) : '';
}

/** A title without the full stop the record ended it with — the style adds its own — unless that stop ends an abbreviation. */
function titleOf(raw: unknown): string {
  const t = str(raw);
  const cut = t.replace(/[\s.:;,،؛]+$/, '');
  return t.endsWith('.') && /(^|[\s.])\p{L}$/u.test(cut) ? t : cut;
}

function pagesOf(raw: unknown): string {
  return str(raw).replace(/\s*(?:-{1,2}|–|—)\s*/g, '–');
}

function doiOf(raw: unknown): string {
  const d = str(raw).replace(/^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i, '');
  return /^10\.[^\s/]+\/\S+$/.test(d) ? d : '';
}

/** Only a web address is printed as a link: never `javascript:`, never a file path. */
function urlOf(raw: unknown): string {
  const u = str(raw);
  return /^https?:\/\/[^\s]+$/i.test(u) ? u : '';
}

/** The people who wrote it, repaired: a name with only a given part is a whole name. */
function people(s: Source): Person[] {
  const out: Person[] = [];
  for (const a of Array.isArray(s.authors) ? s.authors : []) {
    if (!a || typeof a !== 'object') continue;
    const family = str(a.family);
    const given = str(a.given);
    if (family) out.push(given ? { family, given } : { family });
    else if (given) out.push({ family: given });
  }
  return out;
}

type Shape = 'periodical' | 'chapter' | 'conference' | 'book' | 'report' | 'thesis' | 'web';

function shapeOf(type: unknown): Shape {
  switch (type) {
    case 'chapter': case 'conference': case 'book': case 'report': case 'thesis': case 'web': return type;
    case 'dictionary': return 'book';
    default: return 'periodical';
  }
}

/** A source as the formatters read it: every field present or empty, never missing. */
interface Fields {
  style: Style;
  lang: DocLang;
  w: Tongue;
  ps: Person[];
  title: string;
  shape: Shape;
  year: string;
  /** The year with its letter, or the no-date word. What author-date styles print. */
  date: string;
  venue: string;
  volume: string;
  issue: string;
  pages: string;
  publisher: string;
  /** Where the publisher is. */
  city: string;
  edition: string;
  /** Who awarded a thesis: the publisher, or failing that the venue. */
  uni: string;
  doi: string;
  url: string;
  /** Legislation: cited by its name, number and year, never by an author. */
  law: boolean;
  /** The gazette date a law was published on. */
  issued: string;
}

/** Whether a record is legislation — a constitution, a law, a regulation — rather than a work somebody wrote. */
const isLaw = (s: Source): boolean => (s.type as string) === 'law';

function fieldsOf(s: Source, ctx: CiteContext, ledger: Ledger): Fields {
  const style = styleOf(ctx?.style);
  const lang = langOf(ctx?.lang);
  const w = tongue(arabicScript(s), style, lang);
  const year = yearOf(s.year);
  const suffix = ledger.suffix.get(s.key) ?? '';
  const publisher = str(s.publisher);
  const venue = str(s.venue);
  return {
    style, lang, w, ps: people(s), title: titleOf(s.title), shape: shapeOf(s.type), year,
    date: year ? year + suffix : suffix ? `${w.nd}-${suffix}` : w.nd,
    venue, volume: str(s.volume), issue: str(s.issue), pages: pagesOf(s.pages), publisher,
    city: str(s.city), edition: str(s.edition),
    uni: publisher || venue, doi: doiOf(s.doi), url: urlOf(s.url),
    law: isLaw(s), issued: str(s.issued),
  };
}

/** Letters only Kurdish writes: a work titled with them is Kurdish, a law titled with them a law of the Kurdistan Region. */
const KURDISH_LETTERS = /[\u0695\u06B5\u06CE\u06C6\u06D5\u06A4\u06C7]/;

/** Whether a work is written in Kurdish: by its title's letters, or by what its record says. */
function kurdish(s: Source): boolean {
  return KURDISH_LETTERS.test(str(s.title)) || /^(?:ku|ckb|kmr)$/i.test(str(s.lang));
}

/**
 * The words a source is cited in: English for a Latin-script work, Sorani or
 * Badini for a Kurdish work in a document in that language, and Arabic for
 * every other Arabic-script work — an Arabic book is an Arabic book in a
 * Kurdish thesis too.
 */
type Form = DocLang;
type LocalForm = Exclude<Form, 'en'>;

function formOf(s: Source, lang: DocLang): Form {
  if (!arabicScript(s)) return 'en';
  return (lang === 'ckb' || lang === 'kmr') && kurdish(s) ? lang : 'ar';
}

/** A constitution: listed before every other law, and never named without its year. */
function constitution(s: Source): boolean {
  return /^(?:ال)?دستور|^دەستوو?ر|\bconstitution\b/i.test(titleOf(s.title));
}

/** The number and year at the end of a law's title, in each form: what a later footnote leaves off. */
const LAW_TAIL: Readonly<Record<Form, RegExp>> = {
  ar: /\s+(?:رقم\s+\S+(?:\s+لسنة\s+\S+)?|لسنة\s+\S+)$/,
  ckb: /\s+(?:ژمارە\s+\S+(?:\s+ساڵی\s+\S+)?|ساڵی\s+\S+)$/,
  kmr: /\s+(?:ژمارە\s+\S+(?:\s+یا\s+سالا\s+\S+)?|یا\s+سالا\s+\S+)$/,
  en: /,?\s+(?:No\.\s*\S+(?:\s+of\s+\d+)?|of\s+\d{4})$/i,
};

/**
 * A law's name as it is cited — "قانون تنظيم المهن الهندسية رقم 31 لسنة 2012",
 * "دستور جمهورية العراق لسنة 2005", "یاسای ژمارە 3ی ساڵی 2011",
 * "Civil Code, No. 40 of 1951". A number or year the title already carries is
 * not said twice. `short` is the name a later footnote uses: the title
 * without them — except a constitution's, whose year is part of its name.
 */
function lawName(s: Source, lang: DocLang, short = false): string {
  const form = formOf(s, lang);
  const title = titleOf(s.title);
  if (short && !constitution(s)) return title.replace(LAW_TAIL[form], '').trim() || title;
  const number = str(s.number);
  const year = yearOf(s.year);
  // Left out only when the title already says it the way the form would: a
  // budget law "للسنوات المالية 2023 و2024 و2025" names the year in passing
  // and still needs its "لسنة 2023".
  const plain = title.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660));
  const n = number && !new RegExp(`(رقم|ژمارە|No\\.?)\\s*\\(?${number}\\)?(?!\\d)`).test(plain) ? number : '';
  const y = year && !new RegExp(`(لسنة|ساڵی|سالا|of)\\s*${year}\\s*$`).test(plain) ? year : '';
  switch (form) {
    case 'ckb': return `${title}${n ? ` ژمارە ${n}ی` : ''}${y ? ` ساڵی ${y}` : ''}`.trim();
    case 'kmr': return `${title}${n ? ` ژمارە ${n}` : ''}${y ? ` یا سالا ${y}` : ''}`.trim();
    case 'ar': return `${title}${n ? ` رقم ${n}` : ''}${y ? ` لسنة ${y}` : ''}`.trim();
    default: return `${title}${n ? `, No. ${n}` : ''}${y ? ` of ${y}` : ''}`.replace(/^, /, '').trim();
  }
}

/** A law cited at an article: "المادة ١٣ من قانون …", "مادەی ٥ لە یاسای …", "Civil Code, art. 4". */
function lawAt(s: Source, lang: DocLang, loc: string, short = false): string {
  const form = formOf(s, lang);
  const name = lawName(s, lang, short) || (form === 'en' ? 'Anonymous' : 'مجهول');
  if (!loc) return name;
  switch (form) {
    case 'ckb': return `${loc} لە ${name}`;
    case 'kmr': return `${loc} ژ ${name}`;
    case 'ar': return `${loc} من ${name}`;
    default: return `${name}, ${loc}`;
  }
}

const ARTICLE: Readonly<Record<Form, string>> = { ar: 'المادة ', ckb: 'مادەی ', kmr: 'مادەیا ', en: 'art. ' };

/**
 * Where in a law a marker points. What the model wrote — "المادة ١٣/ثانياً",
 * "المادتان ٦ و٨" — is kept as it is; a bare number is an article, and says so.
 */
function articleOf(loc: string, form: Form): string {
  const l = str(loc);
  return /^\p{Nd}/u.test(l) ? ARTICLE[form] + l : l;
}

const ENGLISH_ORDINAL = ['th', 'st', 'nd', 'rd'];

/**
 * An edition as the style writes it — "3rd ed.", "3rd edn." in Harvard,
 * "ط3" in Arabic — and nothing for a first edition, which no style mentions.
 */
function editionOf(f: Fields): string {
  const typed = f.edition.replace(/\s*\b(?:edition|edn\.?|ed\.?)$/i, '').trim();
  if (!typed) return '';
  const digits = typed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  const m = /^(\d+)(?:st|nd|rd|th)?$/i.exec(digits);
  const n = m ? Number(m[1]) : NaN;
  if (n === 1) return '';
  if (f.w.ar) return /^(?:ط|الطبعة)/.test(typed) ? typed : m ? `ط${typed}` : `الطبعة ${typed}`;
  const label = f.style === 'harvard' ? 'edn.' : 'ed.';
  if (!m) return `${typed} ${label}`;
  const tens = n % 100;
  return `${n}${tens >= 11 && tens <= 13 ? 'th' : ENGLISH_ORDINAL[n % 10] ?? 'th'} ${label}`;
}

/** "City: Publisher" for the styles that name the place, the publisher alone otherwise. */
function placed(f: Fields, publisher: string): string {
  if (!f.city || f.style === 'apa' || f.style === 'mla') return publisher;
  return publisher ? `${f.city}: ${publisher}` : f.city;
}

// ── names ─────────────────────────────────────────────────────────────────

/**
 * Initials of a given name: "Mary Jane" → "M. J.", "Jean-Paul" → "J.-P.",
 * "J.R.R." → "J. R. R.". An Arabic-script (or Chinese, Japanese, Korean)
 * given name is returned whole: an initial of it identifies nobody.
 */
function initials(given: string | undefined, spaced: boolean): string {
  if (!given) return '';
  if (WHOLE_NAMES.test(given)) return given;
  const out: string[] = [];
  for (const word of given.split(/[\s.]+/)) {
    const parts = word.split('-').map((p) => {
      const ch = [...p].find((c) => LETTER.test(c));
      return ch ? `${ch.toLocaleUpperCase()}.` : '';
    }).filter(Boolean);
    if (parts.length) out.push(parts.join('-'));
  }
  return out.join(spaced ? ' ' : '');
}

const inverted = (p: Person, given: string | undefined, w: Tongue): string => (given ? p.family + w.comma + given : p.family);
const natural = (p: Person, given: string | undefined): string => (given ? `${given} ${p.family}` : p.family);

function joined(names: string[], sep: string, last: string): string {
  return names.length === 1 ? names[0] : names.slice(0, -1).join(sep) + last + names[names.length - 1];
}

/** The authors as a reference entry opens with them. */
function namesOf(ps: Person[], style: Style, w: Tongue): string {
  switch (style) {
    case 'harvard':
      return joined(ps.map((p) => inverted(p, initials(p.given, false), w)), w.comma, ` ${w.wa}`);
    case 'chicago': {
      const names = ps.map((p, i) => (i === 0 ? inverted(p, p.given, w) : natural(p, p.given)));
      // More than ten: the first seven, then et al. (CMOS 17, 14.76).
      if (names.length > 10) return names.slice(0, 7).join(w.comma) + w.comma + w.etal;
      return joined(names, w.comma, w.comma + w.wa);
    }
    case 'mla': {
      const first = inverted(ps[0], ps[0].given, w);
      if (ps.length === 1) return first;
      if (ps.length === 2) return first + w.comma + w.wa + natural(ps[1], ps[1].given);
      return first + w.comma + w.etal;
    }
    case 'ieee': {
      const names = ps.map((p) => natural(p, initials(p.given, true)));
      if (names.length > 6) return `${names[0]} ${w.etal}`;
      if (names.length === 2) return `${names[0]} ${w.wa}${names[1]}`;
      return joined(names, w.comma, w.comma + w.wa);
    }
    default: {
      const names = ps.map((p) => inverted(p, initials(p.given, true), w));
      // Twenty-one or more: the first nineteen, an ellipsis, and the last (APA 7, 9.8).
      if (names.length > 20) return `${names.slice(0, 19).join(w.comma)}${w.comma}. . . ${names[names.length - 1]}`;
      return joined(names, w.comma, w.comma + w.wa);
    }
  }
}

/** Words a cut title may not end on, in the scripts titles come in. */
const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'from', 'by', 'with', 'into', '&',
  'و', 'في', 'من', 'على', 'عن', 'إلى', 'الى', 'مع', 'لە', 'بۆ', 'بە', 'ژ', 'بو',
]);

/**
 * The first words of a title, for a citation of a work with no author and a
 * later Chicago note: the main title, or its first four words when it is
 * longer than five. A cut is a title's key words (CMOS 17, 14.30), so it
 * never ends on a small word or a comma — "Civil society and the state in
 * Iraq" is "Civil society", not "Civil society and the".
 */
function shortTitle(title: string): string {
  const head = title.split(/[:?؟!]/)[0].trim() || title;
  const words = head.split(' ');
  if (words.length <= 5) return head;
  const kept = words.slice(0, 4);
  while (kept.length > 1 && FUNCTION_WORDS.has(kept[kept.length - 1].replace(/[,،;؛]+$/, '').toLocaleLowerCase())) kept.pop();
  return kept.join(' ').replace(/[\s,،;؛:–—-]+$/, '') || words.slice(0, 4).join(' ');
}

/** A short title as a citation prints it: in quotation marks for a part of something, plain otherwise. */
function citedTitle(s: Source, style: Style, w: Tongue): string {
  const t = shortTitle(titleOf(s.title));
  const quoted = !w.ar && style !== 'harvard' && ['periodical', 'chapter', 'conference'].includes(shapeOf(s.type));
  return quoted ? `"${t}"` : t;
}

/** Who a citation names: the family names the style allows, the title when nobody is named, a law's name for a law. */
function whoOf(s: Source, style: Style, w: Tongue, lang: DocLang): string {
  if (isLaw(s)) return lawAt(s, lang, '');
  const fam = people(s).map((p) => p.family);
  if (!fam.length) return titleOf(s.title) ? citedTitle(s, style, w) : str(s.venue) || (w.ar ? 'مجهول' : 'Anonymous');
  return teamOf(fam, style, w);
}

/** One or more family names as a citation shortens them in the style. */
function teamOf(fam: string[], style: Style, w: Tongue): string {
  if (fam.length === 1) return fam[0];
  if (w.ar) return fam.length === 2 ? `${fam[0]} ${w.wa}${fam[1]}` : `${fam[0]} ${w.etal}`;
  if (fam.length === 2) return `${fam[0]} ${style === 'apa' ? '&' : 'and'} ${fam[1]}`;
  if (fam.length === 3 && style === 'harvard') return `${fam[0]}, ${fam[1]} and ${fam[2]}`;
  if (fam.length === 3 && style === 'chicago') return `${fam[0]}, ${fam[1]}, and ${fam[2]}`;
  return `${fam[0]} et al.`;
}

// ── in the text ───────────────────────────────────────────────────────────

/**
 * The page a locator names — "p. 12", "pp. 12-15", "ص 12", "ل ١٢", or a bare
 * number — with an en dash in a range; `null` when it names something else.
 */
function pageOf(l: string): string | null {
  const m = /^(?:pages?|pp?)\.?\s*(\p{Nd}[\s\S]*)$/iu.exec(l) ?? /^(?:ص\s?ص|ص|ل)\.?\s*(\p{Nd}[\s\S]*)$/u.exec(l);
  const found = m ? m[1] : /^\p{Nd}/u.test(l) ? l : null;
  return found === null ? null : found.replace(/(\p{Nd})\s*(?:-{1,2}|–|—)\s*(?=\p{Nd})/gu, '$1–');
}

/**
 * A locator as the style writes it. A page is "p. 12" in APA, Harvard and
 * IEEE, a bare "12" in Chicago and MLA, and "ص 12" for an Arabic-script
 * source; anything that is not a page — "ch. 3", "para. 4" — is kept as typed.
 */
function locate(loc: string, style: Style, w: Tongue): string {
  const l = str(loc);
  if (!l) return '';
  const page = pageOf(l);
  if (page === null) return l;
  if (style === 'chicago' || style === 'mla') return page;
  return `${/[–,]/.test(page) && !w.ar ? w.pp : w.p} ${page}`;
}

/** A citation's name followed by a comma — inside the closing quotation mark, as APA puts it. */
function withComma(who: string, w: Tongue): string {
  return !w.ar && who.endsWith('"') ? `${who.slice(0, -1)}," ` : who + w.comma;
}

/** The keys of a marker group that name a usable, cited source, once each, and the locator if it is still theirs. */
function knownOf(keys: unknown, ledger: Ledger, locator: unknown): { known: string[]; loc: string } {
  const asked: string[] = [];
  for (const k of Array.isArray(keys) ? keys : []) if (typeof k === 'string' && !asked.includes(k)) asked.push(k);
  const known = asked.filter((k) => ledger.byKey.has(k));
  return { known, loc: known.length && known[0] === asked[0] && typeof locator === 'string' ? locator : '' };
}

/**
 * The in-text citation for one marker group: `(Family, 2020)`, `(Family
 * 2020, 45)`, `(Family 45)` or `[3]`, per the style. Keys that name no
 * usable, cited source are left out, and when none is left the answer is
 * empty rather than an empty pair of brackets.
 *
 * In the footnotes style it is the text of the note the group would make —
 * full or short as the context's `seen` stands — and nothing is recorded:
 * only `renderRuns` moves a pass along.
 *
 * A locator belongs to the group's first key, and is dropped with it.
 */
export function inText(keys: string[], ctx: CiteContext, locator?: string): string {
  const ledger = ledgerOf(ctx);
  const { known, loc } = knownOf(keys, ledger, locator);
  if (!known.length) return '';
  const style = styleOf(ctx?.style);
  const lang = langOf(ctx?.lang);
  if (style === 'footnotes') return plain(footnote(known, loc, ctx, ledger, false));

  const items = known.map((key, i) => {
    const s = ledger.byKey.get(key) as Source;
    const w = tongue(arabicScript(s), style, lang);
    const year = yearOf(s.year);
    const suffix = ledger.suffix.get(key) ?? '';
    const short = whoOf(s, style, w, lang);
    return {
      s, w, key,
      law: isLaw(s),
      n: ledger.n.get(key) as number,
      who: ledger.names.get(key) ?? short,
      /** What APA files it under: "J. Smith" is still a Smith. */
      short,
      // A law's year is part of its name.
      dates: isLaw(s) ? [] : [year ? year + suffix : suffix ? `${w.nd}-${suffix}` : w.nd],
      year: year ? Number(year) : Infinity,
      loc: i === 0 && loc ? (isLaw(s) ? articleOf(loc, formOf(s, lang)) : locate(loc, style, w)) : '',
    };
  });

  if (style === 'ieee') {
    // [1], [3] and [1]–[3]: three or more in a row are a range; a cited page stands alone.
    items.sort((a, b) => a.n - b.n);
    const parts: string[] = [];
    for (let i = 0; i < items.length;) {
      let j = i;
      while (!items[i].loc && j + 1 < items.length && !items[j + 1].loc && items[j + 1].n === items[j].n + 1) j++;
      if (j - i >= 2) {
        parts.push(`[${items[i].n}]–[${items[j].n}]`);
      } else {
        for (let k = i; k <= j; k++) parts.push(`[${items[k].n}${items[k].loc ? items[k].w.comma + items[k].loc : ''}]`);
      }
      i = j + 1;
    }
    return parts.join(lang === 'en' ? ', ' : '، ');
  }

  const coll = collator(items.every((it) => it.w.ar) ? 'ar' : 'en');
  // The year's letter settles a tie: 2019a before 2019b.
  const letter = (a: (typeof items)[number], b: (typeof items)[number]) => coll.compare(a.dates[0] ?? '', b.dates[0] ?? '');
  if (style === 'apa') items.sort((a, b) => coll.compare(a.short, b.short) || coll.compare(a.who, b.who) || a.year - b.year || letter(a, b));
  if (style === 'harvard') items.sort((a, b) => a.year - b.year || coll.compare(a.who, b.who) || letter(a, b));
  // Two works by the same people, side by side, share one name: (Adams, 2019, 2021).
  const merged: typeof items = [];
  for (const it of items) {
    const prev = merged[merged.length - 1];
    if (style !== 'mla' && prev && !prev.law && !it.law && prev.who === it.who && prev.w.ar === it.w.ar && !prev.loc && !it.loc) prev.dates.push(...it.dates);
    else merged.push({ ...it, dates: [...it.dates] });
  }
  const parts = merged.map((it) => {
    const { w } = it;
    const loc = it.loc ? w.comma + it.loc : '';
    if (it.law) return lawAt(it.s, lang, it.loc);
    if (style === 'mla') {
      const title = ledger.twins.has(it.key) && people(it.s).length ? w.comma + citedTitle(it.s, style, w) : '';
      return it.who + title + (it.loc ? ` ${it.loc}` : '');
    }
    if (style === 'chicago') return `${it.who} ${it.dates.join(w.comma)}${loc}`;
    return withComma(it.who, w) + it.dates.join(w.comma) + loc;
  });
  return `(${parts.join(merged.every((it) => it.w.ar) ? '؛ ' : '; ')})`;
}

/**
 * A line of runs as it is printed: markers become citations, gaps become
 * bracketed holes, text keeps its emphasis.
 *
 * In the footnotes style a marker becomes a note — `{ text: '', note }` — set
 * against the word before it, as a footnote reference is ("…لسنة 2005¹."), and
 * the note is full or short by whether this pass has cited the source before.
 * So call it on a document's runs in document order, with a context made
 * fresh by `citeContext` for that pass: it records in the context's `seen`
 * what each note cites.
 *
 * A note's mark is the caller's to draw, so brackets somebody wrapped a
 * marker in — "([@s3])" — go with it rather than print around the mark.
 *
 * A marker that cites nothing usable disappears, and takes the space before
 * it — "as shown [@s99]." reads "as shown." rather than "as shown ." — and
 * the brackets around it, when somebody wrapped it in some. It leaves no note.
 */
export function renderRuns(runs: Run[], ctx: CiteContext): Rich[] {
  const out: Rich[] = [];
  const notes = styleOf(ctx?.style) === 'footnotes';
  let dropped = false;
  /** The run whose "(" opened just before the last note, if one did. */
  let opened: Rich | null = null;
  for (const r of Array.isArray(runs) ? runs : []) {
    if (!r || typeof r !== 'object') continue;
    const wrap = opened;
    opened = null;
    if (r.t === 'text') {
      let text = typeof r.text === 'string' ? r.text : '';
      if (wrap && /^\)/.test(text) && out.includes(wrap)) {
        wrap.text = wrap.text.replace(/\s*\($/, '');
        if (!wrap.text) out.splice(out.indexOf(wrap), 1);
        text = text.slice(1);
      }
      if (dropped) {
        const last = out[out.length - 1];
        if (!last) text = text.replace(/^\s+/, '');
        else if (!last.hole && /\($/.test(last.text) && /^\)/.test(text)) {
          last.text = last.text.replace(/\s*\($/, '');
          text = text.slice(1);
          if (!last.text) out.pop();
        }
      }
      dropped = false;
      if (!text) continue;
      const rich: Rich = { text };
      if (r.bold) rich.bold = true;
      if (r.italic) rich.italic = true;
      out.push(rich);
    } else if (r.t === 'cite') {
      if (notes) {
        const ledger = ledgerOf(ctx);
        const { known, loc } = knownOf(r.keys, ledger, r.locator);
        const note = known.length ? footnote(known, loc, ctx, ledger, true) : [];
        if (note.length) {
          const last = out[out.length - 1];
          if (last && !last.hole && !last.note) {
            last.text = last.text.replace(/\s+$/, '');
            if (!last.text) out.pop();
            else if (/\($/.test(last.text)) opened = last;
          }
          out.push({ text: '', note });
          dropped = false;
          continue;
        }
      } else {
        const text = inText(r.keys, ctx, r.locator);
        if (text) {
          out.push({ text });
          dropped = false;
          continue;
        }
      }
      const last = out[out.length - 1];
      if (last && !last.hole && !last.note) {
        last.text = last.text.replace(/\s+$/, '');
        if (!last.text) out.pop();
      }
      dropped = true;
    } else if (r.t === 'hole') {
      out.push({ text: `[${typeof r.text === 'string' ? r.text : ''}]`, hole: true });
      dropped = false;
    }
  }
  return out;
}

// ── entries ───────────────────────────────────────────────────────────────

/**
 * An entry being built. `stop` adds a full stop unless one is there, `sp` a
 * space unless one is there or nothing is, and runs of the same format are
 * merged — so the formatters below can say what goes where without counting
 * punctuation. `cut` starts the next text in a run of its own, for text whose
 * digits must be judged apart from the rest's (see `localDigits`).
 */
function entry() {
  const runs: Rich[] = [];
  let tail = '';
  let apart = false;
  const e = {
    runs,
    put(text: string, f: { italic?: boolean; link?: string } = {}) {
      if (!text) return e;
      const last = runs[runs.length - 1];
      if (last && !apart && !last.link && !f.link && !!last.italic === !!f.italic) last.text += text;
      else runs.push({ text, ...(f.italic ? { italic: true } : {}), ...(f.link ? { link: f.link } : {}) });
      tail = (tail + text).slice(-8);
      apart = false;
      return e;
    },
    cut() {
      apart = true;
      return e;
    },
    sp() {
      if (tail && !/\s$/.test(tail)) e.put(' ');
      return e;
    },
    stop() {
      if (tail && !/[.?!؟…]["'»]?$/.test(tail)) e.put('.');
      return e;
    },
    endsWith(re: RegExp) {
      return re.test(tail);
    },
  };
  return e;
}

type Entry = ReturnType<typeof entry>;

const terminal = (t: string): boolean => /[.?!؟…]$/.test(t);

/**
 * A title in quotation marks with the stop or comma that follows it — inside
 * the marks in English, as American styles put it, and after them in Arabic.
 */
function quoted(f: Fields, punct: '.' | ','): string {
  if (terminal(f.title)) return `"${f.title}"`;
  return f.w.ar ? `"${f.title}"${punct === ',' ? '،' : '.'}` : `"${f.title}${punct}"`;
}
const doiLink = (doi: string): string => `https://doi.org/${doi}`;
const pageLabel = (f: Fields): string => (f.w.ar ? f.w.p : /[–,]/.test(f.pages) ? f.w.pp : f.w.p);

/** Whether a name printed as the publisher is the author again, which APA leaves out. */
function byAuthor(f: Fields, name: string): boolean {
  return f.ps.length === 1 && !f.ps[0].given && f.ps[0].family.toLocaleLowerCase() === name.toLocaleLowerCase();
}

/** The DOI, or failing that the address, as the last thing in an APA or Chicago entry. */
function trailingLink(e: Entry, f: Fields): void {
  if (f.doi) e.sp().put(doiLink(f.doi), { link: doiLink(f.doi) });
  else if (f.url) e.sp().put(f.url, { link: f.url });
}

/** APA 7: Family, A. B., & Other, C. (2020). Title. *Journal*, *12*(3), 45–67. https://doi.org/… */
function apa(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const italic = f.shape === 'book' || f.shape === 'report' || f.shape === 'thesis' || f.shape === 'web';
  const title = () => {
    if (!f.title) return;
    e.sp().put(f.title, { italic });
    if (f.shape === 'thesis') e.put(` [${w.thesis}${f.uni ? w.comma + f.uni : ''}]`);
    if ((f.shape === 'book' || f.shape === 'report') && editionOf(f)) e.put(` (${editionOf(f)})`);
    e.stop();
  };
  const date = () => e.sp().put(`(${f.date}).`);
  if (f.ps.length) {
    e.put(namesOf(f.ps, 'apa', w)).stop();
    date();
    title();
  } else {
    title();
    date();
  }
  switch (f.shape) {
    case 'periodical':
      if (f.venue) {
        e.sp().put(f.venue, { italic: true });
        if (f.volume) e.put(w.comma).put(f.volume, { italic: true });
        if (f.issue) e.put(`${f.volume ? '' : w.comma}(${f.issue})`);
        if (f.pages) e.put(w.comma + f.pages);
        e.stop();
      }
      break;
    case 'chapter':
    case 'conference':
      if (f.venue) {
        e.sp().put(`${w.In} `).put(f.venue, { italic: true });
        if (f.pages) e.put(` (${pageLabel(f)} ${f.pages})`);
        e.stop();
      }
      if (f.publisher && !byAuthor(f, f.publisher)) e.sp().put(f.publisher).stop();
      break;
    case 'book':
    case 'report': {
      const pub = f.publisher || f.venue;
      if (pub && !byAuthor(f, pub)) e.sp().put(pub).stop();
      break;
    }
    case 'web':
      if (f.venue && !byAuthor(f, f.venue)) e.sp().put(f.venue).stop();
      break;
    default:
      break;
  }
  trailingLink(e, f);
  return e.runs;
}

/** Harvard (Cite Them Right): Family, A.B. and Other, C. (2020) 'Title', *Journal*, 12(3), pp. 45–67. Available at: … */
function harvard(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const quoted = f.shape === 'periodical' || f.shape === 'chapter' || f.shape === 'conference';
  // Single quotation marks are the British habit; an Arabic title takes the double ones Arabic uses.
  const q = w.ar ? '"' : "'";
  let titled = false;
  const title = () => {
    if (!f.title) return;
    titled = true;
    if (quoted) e.sp().put(q + f.title + q);
    else e.sp().put(f.title, { italic: true });
  };
  const date = () => e.sp().put(`(${f.date})`);
  if (f.ps.length) {
    e.put(namesOf(f.ps, 'harvard', w));
    date();
    title();
  } else {
    title();
    date();
  }
  // After "(2020) 'Title'" the container follows a comma; after "(2020)" alone, a space;
  // after an italic title, a full stop.
  const onward = (comma: boolean) => {
    if (e.endsWith(/\)$/)) e.sp();
    else if (comma && titled && quoted) e.put(w.comma);
    else e.stop().sp();
  };
  const pages = (lead: string) => {
    if (f.pages) e.put(`${lead}${pageLabel(f)} ${f.pages}`);
  };
  switch (f.shape) {
    case 'periodical':
      if (f.venue) {
        onward(true);
        e.put(f.venue, { italic: true });
        if (f.volume) e.put(w.comma + f.volume);
        if (f.issue) e.put(`${f.volume ? '' : w.comma}(${f.issue})`);
        pages(w.comma);
      }
      break;
    case 'chapter':
    case 'conference':
      if (f.venue) {
        onward(true);
        if (f.shape === 'chapter') e.put(`${w.in} `);
        e.put(f.venue, { italic: true });
      }
      if (f.publisher) {
        onward(false);
        e.put(placed(f, f.publisher));
        pages(w.comma);
      } else if (f.pages) {
        onward(true);
        pages('');
      }
      break;
    case 'book':
    case 'report':
      if (editionOf(f)) {
        onward(false);
        e.put(editionOf(f));
      }
      if (f.publisher || f.venue || f.city) {
        onward(false);
        e.put(placed(f, f.publisher || f.venue));
      }
      break;
    case 'thesis':
      onward(false);
      e.put(w.thesis);
      if (f.uni) e.stop().sp().put(f.uni);
      break;
    case 'web':
      if (f.venue) {
        onward(false);
        e.put(f.venue);
      }
      break;
  }
  e.stop();
  if (f.doi) e.sp().put(`${w.available} `).put(doiLink(f.doi), { link: doiLink(f.doi) });
  else if (f.url) e.sp().put(`${w.available} `).put(f.url, { link: f.url });
  return e.runs;
}

/** Chicago author-date: Family, Given, and Given Other. 2020. "Title." *Journal* 12 (3): 45–67. https://doi.org/…. */
function chicago(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const quotedTitle = f.shape !== 'book' && f.shape !== 'report';
  const title = () => {
    if (!f.title) return;
    if (quotedTitle) e.sp().put(quoted(f, '.'));
    else e.sp().put(f.title, { italic: true }).stop();
  };
  const date = () => e.sp().put(f.date).stop();
  if (f.ps.length) {
    e.put(namesOf(f.ps, 'chicago', w)).stop();
    date();
    title();
  } else {
    title();
    date();
  }
  switch (f.shape) {
    case 'periodical':
      if (f.venue) {
        e.sp().put(f.venue, { italic: true });
        if (f.volume) e.put(` ${f.volume}`);
        if (f.issue) e.put(f.volume ? ` (${f.issue})` : `${w.comma}${w.no} ${f.issue}`);
        if (f.pages) e.put((f.volume || f.issue ? ': ' : w.comma) + f.pages);
        e.stop();
      }
      break;
    case 'chapter':
    case 'conference':
      if (f.venue) {
        e.sp().put(`${w.In} `).put(f.venue, { italic: true });
        if (f.pages) e.put(w.comma + f.pages);
        e.stop();
      }
      if (f.publisher) e.sp().put(placed(f, f.publisher)).stop();
      break;
    case 'book':
    case 'report':
      if (editionOf(f)) e.sp().put(editionOf(f)).stop();
      if (f.publisher || f.venue || f.city) e.sp().put(placed(f, f.publisher || f.venue)).stop();
      break;
    case 'thesis':
      e.sp().put(w.thesis + (f.uni ? w.comma + f.uni : '')).stop();
      break;
    case 'web':
      if (f.venue) e.sp().put(f.venue).stop();
      break;
  }
  if (f.doi || f.url) {
    trailingLink(e, f);
    e.put('.');
  }
  return e.runs;
}

/** MLA 9: Family, Given, and Given Other. "Title." *Journal*, vol. 12, no. 3, 2020, pp. 45–67, https://doi.org/…. */
function mla(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const quotedTitle = f.shape === 'periodical' || f.shape === 'chapter' || f.shape === 'conference' || f.shape === 'web';
  if (f.ps.length) e.put(namesOf(f.ps, 'mla', w)).stop();
  if (f.title) {
    if (quotedTitle) e.sp().put(quoted(f, '.'));
    else e.sp().put(f.title, { italic: true }).stop();
  }
  const els: Rich[][] = [];
  const add = (text: string, fmt: Omit<Rich, 'text'> = {}) => {
    if (text) els.push([{ text, ...fmt }]);
  };
  const pages = () => add(f.pages ? `${pageLabel(f)} ${f.pages}` : '');
  const link = () => {
    if (f.doi) add(doiLink(f.doi), { link: doiLink(f.doi) });
    else if (f.url) add(f.url.replace(/^https?:\/\//i, ''), { link: f.url });
  };
  switch (f.shape) {
    case 'periodical':
      add(f.venue, { italic: true });
      add(f.volume ? `${w.vol} ${f.volume}` : '');
      add(f.issue ? `${w.no} ${f.issue}` : '');
      add(f.year);
      pages();
      break;
    case 'chapter':
    case 'conference':
      add(f.venue, { italic: true });
      add(f.publisher);
      add(f.year);
      pages();
      break;
    case 'web':
      add(f.venue, { italic: true });
      add(f.year);
      break;
    case 'thesis':
      // Title. Year. Institution, thesis.
      if (f.year) e.sp().put(f.year).stop();
      add(f.uni);
      add(w.ar ? w.thesis : f.uni ? 'thesis' : 'Thesis');
      break;
    default:
      add(editionOf(f));
      add(f.publisher || f.venue);
      add(f.year);
      break;
  }
  link();
  if (els.length) {
    e.sp();
    els.forEach((el, i) => {
      if (i) e.put(w.comma);
      for (const r of el) e.put(r.text, r);
    });
    e.stop();
  }
  return e.runs;
}

/** IEEE: A. B. Family and C. Other, "Title," *Journal*, vol. 12, no. 3, pp. 45–67, 2020, doi: 10…. */
function ieee(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const els: Rich[][] = [];
  const add = (...rs: Rich[]) => {
    const kept = rs.filter((r) => r.text);
    if (kept.length) els.push(kept);
  };
  const pages = () => add({ text: f.pages ? `${pageLabel(f)} ${f.pages}` : '' });
  const within = () => {
    if (f.venue) add({ text: `${w.in} ` }, { text: f.venue, italic: true });
  };
  switch (f.shape) {
    case 'periodical':
      add({ text: f.venue, italic: true });
      add({ text: f.volume ? `${w.vol} ${f.volume}` : '' });
      add({ text: f.issue ? `${w.no} ${f.issue}` : '' });
      pages();
      add({ text: f.year });
      break;
    case 'chapter':
      within();
      add({ text: placed(f, f.publisher) });
      add({ text: f.year });
      pages();
      break;
    case 'conference':
      within();
      add({ text: f.year });
      pages();
      break;
    case 'thesis':
      add({ text: w.thesis });
      add({ text: f.uni });
      add({ text: f.year });
      break;
    case 'web':
      add({ text: f.venue, italic: true });
      add({ text: f.year });
      break;
    default:
      add({ text: placed(f, f.publisher || f.venue) });
      add({ text: f.year });
      break;
  }
  if (f.doi) add({ text: 'doi: ' }, { text: f.doi, link: doiLink(f.doi) });

  if (f.ps.length) e.put(namesOf(f.ps, 'ieee', w));
  if (f.title) {
    if (f.ps.length) e.put(w.comma);
    if (f.shape === 'book') {
      e.put(f.title, { italic: true });
      if (editionOf(f)) e.put(w.comma + editionOf(f));
      e.stop();
    } else {
      e.put(quoted(f, els.length ? ',' : '.'));
    }
  }
  if (els.length) {
    if (f.ps.length && !f.title) e.put(w.comma);
    else e.sp();
    els.forEach((el, i) => {
      if (i) e.put(w.comma);
      for (const r of el) e.put(r.text, r);
    });
  }
  e.stop();
  if (!f.doi && f.url) e.sp().put(`${w.online} `).put(f.url, { link: f.url });
  return e.runs;
}

/**
 * Legislation, the same in every style, since none of the five manuals has a
 * rule for an Iraqi law: its name, number and year, then where it was
 * published — "قانون تنظيم المهن الهندسية رقم 31 لسنة 2012، الوقائع العراقية، العدد
 * 4250، 3 نيسان 2012." The footnotes style lists it the same way.
 */
function legislation(f: Fields, s: Source): Rich[] {
  const e = entry();
  const form = formOf(s, f.lang);
  const issue = f.issue ? `${form === 'en' ? 'no.' : form === 'ar' ? 'العدد' : 'ژمارە'} ${f.issue}` : '';
  e.put([lawName(s, f.lang), f.venue, issue, f.issued].filter(Boolean).join(f.w.comma)).stop();
  trailingLink(e, f);
  return e.runs;
}

// ── footnotes ─────────────────────────────────────────────────────────────

/** The words of a note and of a footnotes list entry, for an Arabic-script work, in the language it is cited in. */
interface NoteWords {
  comma: string;
  /** Before the last of two or three names: joined to it in Arabic, a word of its own in Kurdish. */
  and: string;
  etal: string;
  /** "Cited before": what a later note says instead of the rest of the reference. */
  opcit: string;
  page: string;
  vol: string;
  issue: string;
  edition: string;
  /** Before the journal an article is in, the book a chapter is in, the conference a paper went to. Kurdish names them alone. */
  article: string;
  chapter: string;
  conference: string;
  thesis: string;
  master: string;
  phd: string;
  /** Before a web page's address. */
  available: string;
  nd: string;
  /** A work with neither author nor title. */
  anon: string;
}

const NOTE: Readonly<Record<LocalForm, NoteWords>> = {
  ar: {
    comma: '، ', and: ' و', etal: ' وآخرون', opcit: 'مصدر سابق', page: 'ص', vol: 'المجلد ', issue: 'العدد ', edition: 'ط',
    article: 'بحث منشور في ', chapter: 'فصل منشور في ', conference: 'بحث مقدم إلى ',
    thesis: 'رسالة', master: 'رسالة ماجستير', phd: 'أطروحة دكتوراه', available: 'متاح على: ', nd: NO_DATE.ar, anon: 'مجهول',
  },
  ckb: {
    comma: '، ', and: ' و ', etal: ' و هاوکاران', opcit: 'سەرچاوەی پێشوو', page: 'ل', vol: 'بەرگی ', issue: 'ژمارە ', edition: 'چاپی ',
    article: '', chapter: '', conference: '',
    thesis: 'نامە', master: 'نامەی ماستەر', phd: 'نامەی دکتۆرا', available: '', nd: NO_DATE.ckb, anon: 'نەناسراو',
  },
  kmr: {
    comma: '، ', and: ' و ', etal: ' و هەڤکاران', opcit: 'ژێدەرێ بەری', page: 'ل', vol: 'بەرگێ ', issue: 'ژمارە ', edition: 'چاپا ',
    article: '', chapter: '', conference: '',
    thesis: 'نامە', master: 'نامەیا ماستەرێ', phd: 'نامەیا دکتورایێ', available: '', nd: NO_DATE.kmr, anon: 'نەناسراو',
  },
};

/**
 * The people who wrote a work as a note names them: whole names in their own
 * order — "ليلى حسن الربيعي وسامر خليل عبد الجبار" — the first of four or more
 * with وآخرون, and Chicago's "A, B, and C" in English.
 */
function noteNames(ps: Person[], form: Form): string {
  const names = ps.map((p) => natural(p, p.given));
  if (form === 'en') {
    if (names.length > 3) return `${names[0]} et al.`;
    return names.length === 3 ? `${names[0]}, ${names[1]}, and ${names[2]}` : names.join(' and ');
  }
  const W = NOTE[form];
  if (names.length > 3) return names[0] + W.etal;
  return names.length === 3 ? names[0] + W.comma + names[1] + W.and + names[2] : names.join(W.and);
}

/**
 * The year as a note prints it. An Arabic work dated before 1500 is dated in
 * the Hijri calendar — no Arabic book was printed in 1414 AD — and says so:
 * ١٤١٤هـ. A work with no year says that it has none, as Arabic notes do.
 */
function noteYear(f: Fields, form: LocalForm): string {
  if (!f.year) return NOTE[form].nd;
  return form === 'ar' && Number(f.year) < 1500 ? `${f.year}هـ` : f.year;
}

/** A locator in a note: "ص12", "ل12", Chicago's bare "12"; anything that is not a page as it was written. */
function noteLoc(loc: string, form: Form, w: Tongue): string {
  const l = str(loc);
  if (!l) return '';
  if (form === 'en') return locate(l, 'chicago', w);
  const page = pageOf(l);
  return page === null ? l : NOTE[form].page + page;
}

/** An edition in Kurdish words, "چاپی 3"; in Arabic, as every style writes it, "ط3". */
function localEdition(f: Fields, form: LocalForm): string {
  const ed = editionOf(f);
  if (form === 'ar' || !ed) return ed;
  const typed = f.edition.replace(/\s*\b(?:edition|edn\.?|ed\.?)$/i, '').replace(/^(?:ط|الطبعة)\s*/, '').trim();
  return /^چاپ/.test(typed) ? typed : NOTE[form].edition + typed;
}

/** A volume or an issue with its word before it, unless the record's own text already says it: "عدد خاص". */
function labelled(value: string, word: string, said: RegExp): string {
  return !value ? '' : said.test(value) ? value : word + value;
}
const SAYS_VOLUME = /^(?:ال)?مجلد|^مج(?:[\s.]|$)|^بەرگ|^vol/i;
const SAYS_ISSUE = /^(?:ال)?عدد|^ع(?:[\s.]|$)|^ژمار|^no\b/i;

/**
 * What kind of thesis it was, as far as the record says: the university's own
 * line may name it ("رسالة ماجستير، كلية القانون"), and then nothing is added;
 * otherwise the degree it names, or the plain word for a thesis.
 */
function thesisWord(f: Fields, form: Form): string {
  const said = `${f.publisher} ${f.venue}`;
  if (/رسال|أطروح|اطروح|نامە|تێز|thesis|dissertation|\bdiss\./i.test(said)) return '';
  const phd = /دكتورا|دکتۆرا|دکتورا|ph\.?\s?d|doctor/i.test(said);
  const master = /ماجستير|ماستر|ماستەر|master/i.test(said);
  if (form === 'en') return phd ? 'PhD diss.' : master ? "master's thesis" : 'thesis';
  return phd ? NOTE[form].phd : master ? NOTE[form].master : NOTE[form].thesis;
}

/**
 * An Arabic-script work as an Iraqi law faculty's working paper — the
 * owner's example — writes it, piece by piece: who, the title, where it was
 * published, the year. A note puts a book's edition after its place — "دار
 * الأفق، بغداد، ط3، 1420هـ" — and the list puts it first — "ط3، دار الأفق،
 * بغداد، 1420هـ". An article's page range is in neither: a note cites the
 * page the marker gave, and the list the article.
 */
function localParts(f: Fields, form: LocalForm, where: 'note' | 'list'): string[] {
  const W = NOTE[form];
  const year = noteYear(f, form);
  const parts = [f.ps.length ? noteNames(f.ps, form) : '', f.title];
  switch (f.shape) {
    case 'book':
    case 'report': {
      const pub = f.publisher || f.venue;
      const ed = localEdition(f, form);
      parts.push(...(where === 'note' ? [pub, f.city, ed] : [ed, pub, f.city]), year);
      break;
    }
    case 'thesis':
      parts.push(thesisWord(f, form), f.uni, year);
      break;
    case 'chapter':
      parts.push(f.venue && W.chapter + f.venue, f.publisher, f.city, year);
      break;
    case 'conference':
      parts.push(f.venue && W.conference + f.venue, year);
      break;
    case 'web':
      parts.push(f.venue, year);
      break;
    default:
      parts.push(f.venue && W.article + f.venue, labelled(f.volume, W.vol, SAYS_VOLUME), labelled(f.issue, W.issue, SAYS_ISSUE), year);
  }
  return parts.filter(Boolean);
}

/**
 * Pieces of an Arabic-script reference, joined with Arabic commas, each in a
 * run of its own: a title with "COVID-19" in it keeps its Latin digits, and
 * the year beside it is still written in the document's own.
 */
function pieces(e: Entry, parts: string[], comma: string): Entry {
  const kept = parts.filter(Boolean);
  kept.forEach((p, i) => e.cut().put(i < kept.length - 1 ? p + comma : p));
  return e;
}

/**
 * The note for an Arabic-script work. The first time, everything, then the
 * page; after that its authors, "مصدر سابق" and the page — and the title too
 * when another cited work has the same authors, or there are no authors to
 * name it by.
 */
function localNote(f: Fields, form: LocalForm, loc: string, later: boolean, twin: boolean, last: boolean): Rich[] {
  const W = NOTE[form];
  const e = entry();
  const at = noteLoc(loc, form, f.w);
  if (later) {
    const who = f.ps.length ? noteNames(f.ps, form) : '';
    pieces(e, [who || f.title || W.anon, who && twin ? f.title : '', W.opcit, at], W.comma);
  } else {
    pieces(e, [...localParts(f, form, 'note'), at], W.comma);
    if (f.shape === 'web' && f.url) e.put(W.comma + W.available).put(f.url, { link: f.url });
  }
  if (last) e.stop();
  return e.runs;
}

/** An Arabic-script work in a footnotes list: as its first note, without a page, the edition first. */
function localEntry(f: Fields, form: LocalForm): Rich[] {
  const W = NOTE[form];
  const e = pieces(entry(), localParts(f, form, 'list'), W.comma);
  if (f.shape === 'web' && f.url) e.put(W.comma + W.available).put(f.url, { link: f.url });
  e.stop();
  if (f.doi) e.sp().put(doiLink(f.doi), { link: doiLink(f.doi) });
  else if (f.url && f.shape !== 'web') e.sp().put(f.url, { link: f.url });
  return e.runs;
}

/**
 * A Chicago note being built: elements joined by commas, and a quoted title
 * that waits for its punctuation — the comma after it goes inside the marks,
 * a parenthesis after it does not take one, and the stop that ends the note
 * goes inside too, as American punctuation has it.
 */
function chain() {
  const e = entry();
  let open = '';
  const c = {
    put(text: string, fmt: { italic?: boolean; link?: string } = {}) {
      e.put(text, fmt);
      return c;
    },
    /** Before the next element: a comma, or with `' '` only a space — for the parenthesis of a book's facts. */
    next(glue: ', ' | ' ' = ', ') {
      if (open) {
        e.put(glue === ', ' && !terminal(open) ? ',"' : '"').put(' ');
        open = '';
      } else if (e.runs.length) {
        e.put(glue);
      }
      return c;
    },
    quote(title: string) {
      e.put(`"${title}`);
      open = title;
      return c;
    },
    /** The note's runs, closed: with its stop when it is the last in its group, without when another follows. */
    end(last: boolean): Rich[] {
      if (!e.runs.length) e.put('Anonymous');
      if (open) e.put(last && !terminal(open) ? '."' : '"');
      else if (last) e.stop();
      return e.runs;
    },
  };
  return c;
}

/**
 * The first note for a Latin-script work, as Chicago's notes write it:
 * `Anna Beth Family and Carl Other, "Title," *Journal* 12, no. 3 (2020): 45,
 * https://doi.org/….` — or for a book `Name, *Title*, 3rd ed. (City:
 * Publisher, 2014), 45.` The page is the one the marker gave, never the
 * article's range.
 */
function chicagoNote(f: Fields, loc: string, last: boolean): Rich[] {
  const c = chain();
  if (f.ps.length) c.put(noteNames(f.ps, 'en'));
  let page = noteLoc(loc, 'en', f.w);
  const facts = (...xs: string[]) => xs.filter(Boolean).join(', ');
  switch (f.shape) {
    case 'book':
    case 'report': {
      if (f.title) c.next().put(f.title, { italic: true });
      if (editionOf(f)) c.next().put(editionOf(f));
      const pub = facts(placed(f, f.publisher || f.venue), f.year);
      if (pub) c.next(' ').put(`(${pub})`);
      break;
    }
    case 'chapter':
    case 'conference': {
      if (f.title) c.next().quote(f.title);
      if (f.venue) c.next().put('in ').put(f.venue, { italic: true });
      const pub = facts(placed(f, f.publisher), f.year);
      if (pub) c.next(' ').put(`(${pub})`);
      break;
    }
    case 'thesis': {
      if (f.title) c.next().quote(f.title);
      const pub = facts(thesisWord(f, 'en'), f.uni, f.year);
      if (pub) c.next(' ').put(`(${pub})`);
      break;
    }
    case 'web':
      if (f.title) c.next().quote(f.title);
      if (f.venue) c.next().put(f.venue);
      if (f.year) c.next().put(f.year);
      break;
    default:
      if (f.title) c.next().quote(f.title);
      if (f.venue) {
        c.next().put(f.venue, { italic: true });
        if (f.volume) c.put(` ${f.volume}`);
        if (f.issue) c.put(`, no. ${f.issue}`);
        if (f.year) c.put(` (${f.year})`);
        if (page) c.put(`${f.year ? ':' : ','} ${page}`);
        page = '';
      } else if (f.year) {
        c.next().put(f.year);
      }
  }
  if (page) c.next().put(page);
  if (f.doi) c.next().put(doiLink(f.doi), { link: doiLink(f.doi) });
  else if (f.url) c.next().put(f.url, { link: f.url });
  return c.end(last);
}

/** A later note for a Latin-script work, Chicago's short form: `Family and Other, "Short Title," 45.` */
function chicagoShort(f: Fields, loc: string, last: boolean): Rich[] {
  const c = chain();
  const fam = f.ps.map((p) => p.family);
  if (fam.length) c.put(fam.length > 3 ? `${fam[0]} et al.` : fam.length === 3 ? `${fam[0]}, ${fam[1]}, and ${fam[2]}` : fam.join(' and '));
  if (f.title) {
    // The main title without its subtitle, and the question it asks, if it asks one.
    let t = shortTitle(f.title);
    if (f.title.startsWith(t) && /[?؟!]/.test(f.title.charAt(t.length))) t += f.title.charAt(t.length);
    // Without an initial A or The (CMOS 17, 14.30); the word after it now
    // starts the title, and takes its capital unless it has its own ("iPhone").
    const bare = t.replace(/^(?:the|an?)\s+(?=\S)/i, '');
    if (bare !== t) t = /^\p{Ll}[^\p{Lu}]*$/u.test(bare.split(' ')[0]) ? bare.charAt(0).toLocaleUpperCase() + bare.slice(1) : bare;
    if (f.shape === 'book' || f.shape === 'report') c.next().put(t, { italic: true });
    else c.next().quote(t);
  }
  const page = noteLoc(loc, 'en', f.w);
  if (page) c.next().put(page);
  return c.end(last);
}

/**
 * A Latin-script work in a footnotes list, as Chicago's bibliography lists
 * it: `Family, Anna Beth, and Carl Other. "Title." *Journal* 12, no. 3
 * (2020): 45–67. https://doi.org/….` — the year with the publication facts,
 * where the notes put it, rather than after the name.
 */
function bibliography(f: Fields): Rich[] {
  const { w } = f;
  const e = entry();
  const facts = (...xs: string[]) => xs.filter(Boolean).join(w.comma);
  if (f.ps.length) e.put(namesOf(f.ps, 'chicago', w)).stop();
  if (f.title) {
    if (f.shape === 'book' || f.shape === 'report') e.sp().put(f.title, { italic: true }).stop();
    else e.sp().put(quoted(f, '.'));
  }
  const add = (text: string) => {
    if (text) e.sp().put(text).stop();
  };
  switch (f.shape) {
    case 'book':
    case 'report': {
      add(editionOf(f));
      const pub = placed(f, f.publisher || f.venue);
      add(facts(pub, f.year || (pub ? w.nd : '')));
      break;
    }
    case 'chapter':
    case 'conference':
      if (f.venue) {
        e.sp().put(`${w.In} `).put(f.venue, { italic: true });
        if (f.pages) e.put(w.comma + f.pages);
        e.stop();
      }
      add(facts(placed(f, f.publisher), f.year));
      break;
    case 'thesis': {
      const kind = thesisWord(f, 'en');
      add(facts(kind && kind[0].toUpperCase() + kind.slice(1), f.uni, f.year));
      break;
    }
    case 'web':
      add(facts(f.venue, f.year));
      break;
    default:
      if (f.venue) {
        e.sp().put(f.venue, { italic: true });
        if (f.volume) e.put(` ${f.volume}`);
        if (f.issue) e.put(`${w.comma}${w.no} ${f.issue}`);
        if (f.year) e.put(` (${f.year})`);
        if (f.pages) e.put((f.year ? ': ' : w.comma) + f.pages);
        e.stop();
      } else {
        add(f.year);
      }
  }
  if (f.doi || f.url) {
    trailingLink(e, f);
    e.put('.');
  }
  return e.runs;
}

/** One source's part of a note: a law at its article, or a work in its own script's form, full or short. */
function notePart(s: Source, ctx: CiteContext, ledger: Ledger, loc: string, later: boolean, last: boolean): Rich[] {
  const f = fieldsOf(s, ctx, ledger);
  const form = formOf(s, f.lang);
  const twin = ledger.twins.has(s.key);
  if (f.law) {
    const e = entry().put(lawAt(s, f.lang, loc ? articleOf(loc, form) : '', later && !twin));
    if (last) e.stop();
    return e.runs;
  }
  if (form === 'en') return later ? chicagoShort(f, loc, last) : chicagoNote(f, loc, last);
  return localNote(f, form, loc, later, twin, last);
}

/** The keys the notes of a context's pass have cited so far — made when a context came without one. */
function seenOf(ctx: CiteContext): Set<string> {
  if (!ctx || typeof ctx !== 'object') return new Set();
  if (!(ctx.seen instanceof Set)) ctx.seen = new Set();
  return ctx.seen;
}

/**
 * The note for one marker group: each known source's part, in the order the
 * marker names them, joined with "؛ " (with "; " in an English document), and
 * one stop at the end. Each part is full or short by whether the pass has
 * cited that source before; `record` makes this note count as having cited
 * them.
 */
function footnote(known: string[], loc: string, ctx: CiteContext, ledger: Ledger, record: boolean): Rich[] {
  const seen = seenOf(ctx);
  const e = entry();
  known.forEach((key, i) => {
    if (i) e.put(langOf(ctx?.lang) === 'en' ? '; ' : '؛ ');
    // Each source's part in runs of its own, so an English one beside an
    // Arabic one does not keep the Arabic one's digits Western.
    const part = notePart(ledger.byKey.get(key) as Source, ctx, ledger, i === 0 ? loc : '', seen.has(key), i === known.length - 1);
    for (const r of part) e.cut().put(r.text, r);
  });
  if (record) for (const k of known) seen.add(k);
  return e.runs;
}

const plain = (runs: Rich[]): string => runs.map((r) => r.text).join('');

/**
 * One reference entry, in the context's style. Italics where the style wants
 * them; a DOI is printed and linked as `https://doi.org/…` (IEEE prints it as
 * `doi: 10.…`, linked the same way). The entry carries no `[n]`: IEEE's number
 * is `n` in `referenceList`, for the caller to set as it sets a list number.
 *
 * In the footnotes style an Arabic-script work is listed as an Iraqi law
 * faculty's working paper lists it — "author، title، ط3، publisher، city،
 * year." — in Kurdish words for a Kurdish work in a Kurdish document, and a
 * Latin-script work as Chicago's bibliography lists it.
 */
export function reference(s: Source, ctx: CiteContext): Rich[] {
  if (!s || typeof s !== 'object') return [];
  const f = fieldsOf(s, ctx, ledgerOf(ctx));
  if (f.law) return legislation(f, s);
  if (f.style === 'footnotes') {
    const form = formOf(s, f.lang);
    return form === 'en' ? bibliography(f) : localEntry(f, form);
  }
  switch (f.style) {
    case 'harvard': return harvard(f);
    case 'chicago': return chicago(f);
    case 'mla': return mla(f);
    case 'ieee': return ieee(f);
    default: return apa(f);
  }
}

// ── the list ──────────────────────────────────────────────────────────────

const COLLATORS: Partial<Record<'ar' | 'en', Intl.Collator>> = {};

function collator(locale: 'ar' | 'en'): Intl.Collator {
  return (COLLATORS[locale] ??= new Intl.Collator(locale, { sensitivity: 'base', numeric: true }));
}

/**
 * What an entry is alphabetised by. An Arabic list ignores the article ال —
 * الزهراني is filed under ز, as Arabic reference lists file it — and an
 * English title ignores "The", "A" and "An". A family name keeps its English
 * words: "An" is a surname.
 */
function filed(text: string, title = false): string {
  const t = text.replace(/^ال(?=[\u0600-\u06FF]{2})/, '');
  return title ? t.replace(/^(?:the|an?)\s+/i, '') : t;
}

/**
 * First author, then the other authors (so a work by one person comes before
 * one by that person and others), then the year — undated first, as APA
 * files them — then the title.
 */
function byEntry(coll: Intl.Collator): (a: Source, b: Source) => number {
  const first = (s: Source) => {
    const ps = people(s);
    return ps.length ? filed(ps[0].family) : filed(titleOf(s.title), true);
  };
  const rest = (s: Source) => people(s).slice(1).map((p) => filed(p.family)).join(' ');
  const year = (s: Source) => Number(yearOf(s.year) || 0);
  return (a, b) => coll.compare(first(a), first(b))
    || coll.compare(rest(a), rest(b))
    || year(a) - year(b)
    || coll.compare(filed(titleOf(a.title), true), filed(titleOf(b.title), true))
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * The reference list: only the sources the text cites and may cite.
 *
 * IEEE is one list in the order of first citation, numbered. The other styles
 * are alphabetical; an Arabic, Sorani or Badini document citing both
 * Arabic-script and other works gets two lists, headed `local` and `foreign`
 * from WORDS, and the caller prints `references` above them. Nothing cited is
 * no list at all.
 *
 * The footnotes style is `shelves`: in Arabic, Sorani and Badini the groups
 * by kind, each under its ordinal heading and numbered from one; in English
 * one Chicago bibliography, alphabetical and unnumbered, whose heading is
 * empty because `references` above it is all it needs.
 */
export function referenceList(ctx: CiteContext): RefGroup[] {
  const ledger = ledgerOf(ctx);
  if (!ledger.cited.length) return [];
  const words = WORDS[langOf(ctx?.lang)];
  if (styleOf(ctx?.style) === 'footnotes') return shelves(ledger, ctx);
  if (styleOf(ctx?.style) === 'ieee') {
    return [{ heading: words.references, entries: ledger.cited.map((s, i) => ({ key: s.key, n: i + 1, runs: reference(s, ctx) })) }];
  }
  const list = (sources: Source[], locale: 'ar' | 'en') =>
    [...sources].sort(byEntry(collator(locale))).map((s) => ({ key: s.key, runs: reference(s, ctx) }));
  const local = ledger.cited.filter(arabicScript);
  const foreign = ledger.cited.filter((s) => !arabicScript(s));
  if (langOf(ctx?.lang) !== 'en' && local.length && foreign.length) {
    return [
      { heading: words.local, entries: list(local, 'ar') },
      { heading: words.foreign, entries: list(foreign, 'en') },
    ];
  }
  return [{ heading: words.references, entries: list(ledger.cited, foreign.length ? 'en' : 'ar') }];
}

// ── the footnotes list ────────────────────────────────────────────────────

/** The groups of a footnotes list, in the order they are printed. `foreign` is every Latin-script work, whatever it is. */
const SHELVES = ['dictionary', 'book', 'thesis', 'research', 'law', 'web', 'foreign'] as const;
type Shelf = (typeof SHELVES)[number];

const SHELF_NAMES: Readonly<Record<LocalForm, Readonly<Record<Shelf, string>>>> = {
  ar: {
    dictionary: 'المعاجم', book: 'الكتب', thesis: 'الرسائل والأطاريح', research: 'البحوث والدراسات',
    law: 'الدستور والتشريعات والقرارات', web: 'المواقع الإلكترونية', foreign: 'المصادر الأجنبية',
  },
  ckb: {
    dictionary: 'فەرهەنگەکان', book: 'کتێبەکان', thesis: 'نامە و تێزەکان', research: 'توێژینەوەکان',
    law: 'دەستوور و یاساکان', web: 'ماڵپەڕەکان', foreign: 'سەرچاوە بیانییەکان',
  },
  kmr: {
    dictionary: 'فەرهەنگ', book: 'پەرتووک', thesis: 'نامە و تێز', research: 'ڤەکولین',
    law: 'دەستوور و یاسا', web: 'ماڵپەر', foreign: 'ژێدەرێن بیانی',
  },
};

/** "أولاً: المعاجم" — the groups are counted in words, first to seventh, over the groups that have entries. */
const ORDINALS: Readonly<Record<LocalForm, readonly string[]>> = {
  ar: ['أولاً', 'ثانياً', 'ثالثاً', 'رابعاً', 'خامساً', 'سادساً', 'سابعاً'],
  ckb: ['یەکەم', 'دووەم', 'سێیەم', 'چوارەم', 'پێنجەم', 'شەشەم', 'حەوتەم'],
  kmr: ['ئێک', 'دوو', 'سێ', 'چار', 'پێنج', 'شەش', 'حەفت'],
};

function shelfOf(s: Source): Shelf {
  if (!arabicScript(s)) return 'foreign';
  switch (s.type) {
    case 'dictionary': case 'book': case 'thesis': case 'law': case 'web': return s.type;
    default: return 'research';
  }
}

/** A title an Arabic name is printed with — د. أ.د. أ.م.د. م.م. — which is not where it is filed. */
const HONORIFIC = /^(?:(?:أ\.\s*م\.\s*د|أ\.\s*د|م\.\s*م|م\.\s*د|د|أ|م)\.\s*)+/;

const order3 = (x: number, y: number): number => (x < y ? -1 : x > y ? 1 : 0);
const byKeyName = (a: Source, b: Source): number => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/**
 * An Arabic-script group filed as the example files it: by the names as they
 * are printed, whole and in their own order — "بشرى عادل" before "كريم ناصر" —
 * without the title before them or the article ال, then by title and year.
 */
function byPrinted(lang: DocLang): (a: Source, b: Source) => number {
  const coll = collator('ar');
  const who = (s: Source) => {
    const ps = people(s);
    return filed((ps.length ? noteNames(ps, formOf(s, lang)) : titleOf(s.title)).replace(HONORIFIC, ''));
  };
  const year = (s: Source) => Number(yearOf(s.year) || 0);
  return (a, b) => coll.compare(who(a), who(b))
    || coll.compare(filed(titleOf(a.title)), filed(titleOf(b.title)))
    || year(a) - year(b)
    || byKeyName(a, b);
}

/** A number as the record wrote it, in either set of digits; Infinity when it is not one. */
function numberIn(raw: unknown): number {
  const t = str(raw).replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  return /^\d+$/.test(t) ? Number(t) : Infinity;
}

/**
 * Legislation as the example lists it: the constitution first, then by year —
 * and within a year by the gazette's issue, which is the order they were
 * published in, when two came out in the same gazette — then by name.
 */
function byLaw(a: Source, b: Source): number {
  const year = (s: Source) => Number(yearOf(s.year)) || Infinity;
  return Number(constitution(b)) - Number(constitution(a))
    || order3(year(a), year(b))
    || (str(a.venue) === str(b.venue) ? order3(numberIn(a.issue), numberIn(b.issue)) : 0)
    || collator('ar').compare(filed(titleOf(a.title)), filed(titleOf(b.title)))
    || byKeyName(a, b);
}

/** The footnotes list: see `referenceList`. */
function shelves(ledger: Ledger, ctx: CiteContext): RefGroup[] {
  const lang = langOf(ctx?.lang);
  const one = (s: Source) => ({ key: s.key, runs: reference(s, ctx) });
  if (lang === 'en') {
    // Latin-script works by family name, as Chicago files them; the Arabic-script
    // ones after them, by the names they are printed with.
    const latin = ledger.cited.filter((s) => !arabicScript(s)).sort(byEntry(collator('en')));
    const arabic = ledger.cited.filter(arabicScript).sort(byPrinted(lang));
    return [{ heading: '', entries: [...latin, ...arabic].map(one) }];
  }
  const out: RefGroup[] = [];
  for (const shelf of SHELVES) {
    const on = ledger.cited.filter((s) => shelfOf(s) === shelf);
    if (!on.length) continue;
    on.sort(shelf === 'foreign' ? byEntry(collator('en')) : shelf === 'law' ? byLaw : byPrinted(lang));
    out.push({
      heading: `${ORDINALS[lang][out.length]}: ${SHELF_NAMES[lang][shelf]}`,
      entries: on.map((s, i) => ({ key: s.key, n: i + 1, runs: reference(s, ctx) })),
    });
  }
  return out;
}
