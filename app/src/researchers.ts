/**
 * Researchers: the people whose way of writing a document can be written in.
 *
 * A professor in Duhok who has published twenty papers has a manner that the
 * students and colleagues around them recognise at a glance — long sentences
 * held together by وعليه and فضلاً عن, "the researcher" rather than "I", a
 * question to open each part, sources brought in by name before the claim.
 * The researcher using the app saves such a person here, with one or more of
 * their papers, and a document can then be asked for "بأسلوب د. أحمد" and be
 * written the way that person writes.
 *
 * ## Two readings of the same papers
 *
 * The papers are read twice, and the two readings do different jobs.
 *
 * Code measures them (`fingerprint`): sentence and paragraph length, how
 * varied the vocabulary is, which connectors come back, how the writer refers
 * to themselves, how often they cite and ask. These are counts, the same every
 * time, and they are what makes "is this document close to how they write?"
 * a question with a number for an answer (`closeness`) rather than a feeling.
 *
 * A model describes them (`learnPrompt`, `parseGuide`): the things counting
 * cannot see — the tone, how an argument is built and closed, how certain
 * the writer allows themselves to be. It is given the counts as facts, so
 * the description does not contradict them, and it is told to describe the
 * manner and never the content. A guide that says "writes about water
 * policy" would make every document written in the voice drift towards
 * water policy.
 *
 * ## A voice is manner, not material
 *
 * What a document carries (`voiceOf`) is the guide, the numbers in words and
 * two or three short passages that show the manner. The passages are the
 * risky part: a model shown a paragraph and told "write like this" will
 * happily copy it, and copying the very person being imitated is the worst
 * kind of plagiarism. So the passages are few and short, chosen from the
 * middle of a paper where the manner is settled, and `voiceRules` in
 * research.ts says around them that they are never to be reused.
 *
 * ## Word lists are real usage
 *
 * The connectors and the words by which a writer refers to themselves are
 * listed per language — Arabic, Sorani as written in Sulaymaniyah and Erbil,
 * Badini as written in Duhok, English. They are matched through the app's
 * fold and a looser one on top (`plain`), because a Kurdish paper typed on an
 * Arabic keyboard writes ه for ە and ي for ی, and it is still the same word.
 *
 * Nothing here reaches disk or the network. The panel keeps the records and
 * sends the requests; this file only reads, measures and words them.
 */

import type { DocLang, Voice } from './research';
import { DOC_LANGS, docLangOf } from './research';
import { wordCount } from './prose';
import { fold } from './settings';
import { jsonIn } from './researchrun';

// ── the records ───────────────────────────────────────────────────────────

export interface Sample {
  id: string;
  /** A file's name, or what the researcher called a pasted text. */
  name: string;
  text: string;
  words: number;
  added: number;
  /** Only the start of it could be kept. */
  truncated: boolean;
}

export interface Researcher {
  id: string;
  v: 1;
  created: number;
  updated: number;
  name: string;
  /** Academic title or rank: "أ.د.", "Prof.", "پ.ی.د." */
  title: string;
  affiliation: string;
  field: string;
  /** Anything the user wants the model told about this researcher's writing, in their own words. */
  note: string;
  samples: Sample[];
  guide?: StyleGuide;
}

/** Numbers measured from the papers by code — no model, the same every time. */
export interface Fingerprint {
  lang: DocLang;
  words: number;
  sentences: number;
  /** Mean words per sentence, 1 decimal. */
  sentenceWords: number;
  /** Standard deviation of sentence length, 1 decimal. */
  sentenceSpread: number;
  /** Mean words per paragraph (blank-line separated prose paragraphs; headings, list items, table rows excluded), 1 decimal. */
  paragraphWords: number;
  /** Moving-average type-token ratio over windows of 100 folded words (MATTR), 0..1, 3 decimals; plain TTR when fewer than 100 words. */
  richness: number;
  /** Questions per 1,000 words. */
  questions: number;
  /** How the writer refers to themselves; 'impersonal' when no marker is found. */
  person: 'I' | 'we' | 'impersonal';
  /** Discourse connectors, the top 8 by rate, per 1,000 words, 1 decimal, rate > 0 only. */
  connectors: { word: string; per1000: number }[];
  /** Recurring 2- to 4-word phrases, shown in their first original spelling; top 10 by count × length. */
  phrases: { text: string; count: number }[];
  /** Citation-like marks per 1,000 words: (Author, 2019) / (Author 2019: 12), [12], superscript digits, footnote-ish "(1)". */
  citations: number;
  /** Share of blocks that are list items, 0..1, 2 decimals. */
  lists: number;
}

export interface StyleGuide {
  /** One paragraph: the voice in a nutshell. In the samples' language. */
  summary: string;
  /** 5–8 named traits, each a sentence or two. In the samples' language. */
  traits: { name: string; detail: string }[];
  /** Expressions they reuse — connectors, stock openings — ≤ 6 words each, at most 12. */
  phrases: string[];
  /** Things this writer does not do, at most 6. */
  avoid: string[];
  lang: DocLang;
  learned: number;
  /** The sample ids it was learned from, so the panel can say "learned before you added X". */
  from: string[];
}

/** The longest paper kept, in characters: a long thesis chapter, and more than enough to learn a manner from. */
export const MAX_SAMPLE_CHARS = 150_000;
/** Papers kept per researcher. Past ten, more papers teach nothing the first ten did not. */
export const MAX_SAMPLES = 10;
/** Characters of the papers the learning request carries, shared between samples like `dataBlock` shares its budget (smallest first, equal shares of what is left). */
export const LEARN_BUDGET = 60_000;
/** Fewer words than this measure nothing reliable: a fingerprint of one paragraph is that paragraph's quirks. */
export const MIN_WORDS = 150;

// ── the looser fold ───────────────────────────────────────────────────────

/** Characters with no width that keyboards and word processors scatter through Kurdish and Arabic text. */
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Kurdish letters an Arabic keyboard cannot type, and what it types instead.
 *
 * `fold` already makes Arabic and Kurdish yeh and kaf one letter. Counting a
 * writer's connectors needs one step more: somebody typing Sorani on an
 * Arabic layout writes هەروەها as ههروهها and بۆیە as بويه, and it is the
 * same connector. This fold is for matching words only — it would lose too
 * much to show anybody.
 */
const LOOSE: readonly (readonly [RegExp, string])[] = [
  [/[\u06D5\u06BE]/g, '\u0647'],  // Kurdish ae, heh doachashmee -> heh
  [/\u06CE/g, '\u06CC'],           // yeh with small v -> yeh
  [/\u06C6/g, '\u0648'],           // oe -> waw
  [/\u0695/g, '\u0631'],           // reh with small v below -> reh
  [/\u06B5/g, '\u0644'],           // lam with small v -> lam
  [/\u06A4/g, '\u0641'],           // veh -> feh
];

/** Arabic-Indic and Persian digits as ASCII: the two ranges both start at a multiple of sixteen. */
function asciiDigits(s: string): string {
  return s.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) % 16));
}

/** The app's fold, then the Arabic-keyboard spellings of Kurdish letters, invisible marks gone and digits in ASCII. */
function plain(s: string): string {
  let out = fold(s).replace(INVISIBLE, '');
  for (const [from, to] of LOOSE) out = out.replace(from, to);
  return asciiDigits(out);
}

/** `plain` for many words, remembered: a paper repeats its vocabulary, and folding is the slow part. */
function plainer(): (w: string) => string {
  const seen = new Map<string, string>();
  return (w) => {
    let v = seen.get(w);
    if (v === undefined) { v = plain(w); seen.set(w, v); }
    return v;
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Not inside a word: the letters, marks and digits of any script. */
const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
/** And not before one — nor before ".x", so the "i" of "i.e." is not the pronoun. */
const AFTER = '(?![\\p{L}\\p{M}\\p{N}]|\\.\\p{L})';

// ── the word lists ────────────────────────────────────────────────────────

/**
 * Discourse connectors, per language: the words that carry an argument from
 * one sentence to the next, and the clearest single trace of a writer's
 * habits. An entry may list spellings separated by `|`; the first is the one
 * shown. Spaces inside an entry match any spacing, none included, because
 * Kurdish writes لەبەرئەوە and لەبەر ئەوە about equally.
 *
 * Arabic entries also match with و or ف in front (ولذا, فإن كان…), which is
 * how Arabic attaches them; that is why the list says لذا and not ولذا.
 * Sorani entries also match with the emphatic ش after (هەروەهاش).
 */
export const CONNECTORS: Readonly<Record<DocLang, readonly string[]>> = {
  ar: [
    'وعليه', 'من ثم', 'فضلاً عن ذلك', 'فضلاً عن', 'بيد أن', 'إلا أن', 'غير أن', 'في حين', 'لذا', 'لذلك',
    'إذ', 'أي أن', 'بمعنى آخر', 'من جهة أخرى', 'من ناحية أخرى', 'علاوة على ذلك', 'بناءً على ما تقدم',
    'بناءً على ذلك', 'مما سبق', 'يتضح', 'تجدر الإشارة', 'نستنتج', 'مما لا شك فيه', 'بالتالي',
    'إضافة إلى ذلك', 'بالإضافة إلى ذلك', 'على سبيل المثال', 'في المقابل', 'من هنا', 'لا سيما', 'كما أن',
    'لكن', 'مع ذلك', 'خلاصة القول', 'ذلك أن', 'حيث إن', 'من الجدير بالذكر', 'على الرغم من', 'وهكذا',
  ],
  ckb: [
    'هەروەها', 'بەڵام', 'بۆیە', 'هەر بۆیە', 'لەبەر ئەوەی', 'لەبەر ئەوە', 'چونکە', 'لە کاتێکدا', 'جگە لەوە',
    'جگە لەمە', 'بە واتایەکی تر|بە واتایەکی دیکە', 'لەگەڵ ئەوەشدا', 'کەواتە', 'بە کورتی',
    'لە لایەکی ترەوە|لە لایەکی دیکەوە', 'سەرەڕای ئەوە', 'بۆ نموونە', 'واتە', 'بەم پێیە', 'لە ئەنجامدا',
    'هەرچەندە', 'ئەگەرچی', 'بەڵکو', 'لە کۆتاییدا', 'بە گشتی', 'بە تایبەتی', 'لە بەرامبەردا', 'کەچی',
    'لە ڕاستیدا', 'شایانی باسە|شایەنی باسە', 'بێگومان', 'بەم شێوەیە', 'لەم ڕووەوە', 'هاوکات',
  ],
  kmr: [
    'هەروەسا|هەر وەسا', 'بەلێ', 'لەوما', 'ژبەر هندێ|ژ بەر هندێ', 'ژبەر ڤێ چەندێ|ژ بەر ڤێ چەندێ',
    'دگەل هندێ', 'ب ڤی رەنگی', 'یانژی|یان ژی', 'هەروەکی|هەر وەکی', 'دیسان',
    'ژ لایەکێ دیڤە|ژ لایەکێ دی ڤە|ژ لایێ دی ڤە', 'چونکی', 'ژبەرکو|ژ بەر کو', 'ئانکو', 'ب کورتی',
    'ب گشتی', 'ب تایبەتی', 'د ئەنجامدا', 'ژبلی هندێ|ژ بلی هندێ', 'ل سەر ڤێ چەندێ', 'د هەمان دەمدا',
    'ب هەمان شێوە', 'بەروڤاژی', 'هەرچەندە', 'سەرەرای هندێ|سەرەڕای هندێ', 'بێگومان', 'پاشان',
    'ب گۆتنەکا دی|ب گوتنەکا دی', 'بۆ نموونە', 'ل دووماهیێ|ل دوماهیێ|ل دووماهیکێ',
  ],
  en: [
    'however', 'moreover', 'therefore', 'thus', 'furthermore', 'in addition', 'consequently', 'nevertheless',
    'nonetheless', 'for example', 'for instance', 'in contrast', 'by contrast', 'indeed', 'hence', 'notably',
    'in other words', 'on the other hand', 'as a result', 'similarly', 'likewise', 'in particular',
    'accordingly', 'conversely', 'in fact', 'that is', 'specifically', 'in summary', 'in conclusion',
    'overall', 'additionally', 'whereas', 'although',
  ],
};

/**
 * How a writer refers to themselves, per language: the first person
 * singular, the plural of modesty Arabic and Kurdish academic writing favours,
 * or the third person ("the researcher", "this study") that most Arab and
 * Kurdish universities ask of a thesis. Spellings as in `CONNECTORS`.
 *
 * Kurdish needs care: ئەم is "we" in Badini and "this" in Sorani, and من is
 * "I" in both and "from" in Arabic — which is why each language has its own
 * list and a text is read with the list of the language it is in.
 */
export const PERSON_MARKERS: Readonly<Record<DocLang, Readonly<Record<'I' | 'we' | 'impersonal', readonly string[]>>>> = {
  ar: {
    I: ['أرى', 'أعتقد', 'رأيي', 'في رأيي', 'برأيي', 'أظن', 'أرجح', 'أنني', 'إنني', 'أنا', 'بحثي', 'دراستي'],
    we: ['نرى', 'نعتقد', 'بحثنا', 'دراستنا', 'نحن', 'إننا', 'أننا', 'رأينا', 'نلاحظ', 'لاحظنا', 'نجد'],
    impersonal: ['الباحث', 'الباحثة', 'يرى الباحث', 'ترى الباحثة', 'هذه الدراسة', 'الدراسة الحالية', 'هذا البحث', 'البحث الحالي'],
  },
  ckb: {
    I: ['من', 'بۆچوونی من', 'بە بڕوای من', 'بە ڕای من', 'پێم وایە', 'توێژینەوەکەم'],
    we: ['ئێمە', 'پێمان وایە', 'بە بڕوای ئێمە', 'بۆچوونی ئێمە', 'توێژینەوەکەمان'],
    impersonal: ['توێژەر', 'توێژەرەکە', 'توێژەر پێی وایە', 'بۆچوونی توێژەر', 'ئەم توێژینەوەیە', 'لەم توێژینەوەیەدا'],
  },
  kmr: {
    I: ['ئەز', 'من', 'ب دیتنا من', 'ب بۆچوونا من', 'ڤەکۆلینا من'],
    we: ['ئەم', 'مە', 'ب دیتنا مە', 'ب بۆچوونا مە', 'ڤەکۆلینا مە'],
    impersonal: ['ڤەکۆلەر', 'ڤەکۆلەری', 'ڤەکۆلەرێ', 'ئەڤ ڤەکۆلینە', 'ڤێ ڤەکۆلینێ', 'د ڤێ ڤەکۆلینێ دا'],
  },
  en: {
    I: ['i', 'my', 'me', 'myself', 'in my view'],
    we: ['we', 'our', 'us', 'ourselves', 'in our view'],
    impersonal: ['the researcher', 'this study', 'the present study', 'the current study', 'this paper', 'this article', 'this research', 'the author', 'the present author'],
  },
};

/**
 * Words too common to make a phrase worth listing: "في هذا" and "of the" come
 * back in every paper ever written and say nothing about this one. One set
 * for all four languages, because a paper quotes the others.
 */
const STOP = new Set([
  // Arabic
  'في', 'من', 'على', 'إلى', 'عن', 'أن', 'إن', 'أو', 'و', 'ما', 'لا', 'لم', 'لن', 'قد', 'ثم', 'هو', 'هي', 'هم',
  'هذا', 'هذه', 'ذلك', 'تلك', 'التي', 'الذي', 'الذين', 'كان', 'كانت', 'يكون', 'تكون', 'مع', 'كل', 'بين', 'عند',
  'حيث', 'كما', 'به', 'بها', 'له', 'لها', 'فيه', 'فيها', 'منه', 'منها', 'عليه', 'عليها', 'إلا', 'أي', 'بعد',
  'قبل', 'حتى', 'عبر', 'ضمن', 'غير', 'أكثر', 'أما', 'إذا', 'لقد', 'تم', 'وقد', 'وفي', 'ومن', 'وهو', 'وهي',
  'وأن', 'بأن', 'وإن', 'ولا', 'وما', 'فإن', 'وعلى', 'وهذا', 'وهذه', 'الى',
  // Sorani
  'لە', 'بۆ', 'بە', 'کە', 'ئەم', 'ئەو', 'ئەوە', 'ئەمە', 'یان', 'لەسەر', 'لەگەڵ', 'هەیە', 'نییە', 'بوو',
  'دەبێت', 'دەکات', 'دا', 'ی', 'یە', 'تر', 'دیکە', 'هەموو', 'هەر', 'زۆر', 'لەناو', 'لەنێوان', 'بەپێی',
  'ئەوەی', 'وە', 'لەم', 'لەو', 'بەم', 'بەو', 'تێدا', 'دەکرێت', 'بێت', 'کرد',
  // Badini
  'ژ', 'د', 'ل', 'ب', 'ڤە', 'کو', 'ئەڤ', 'ئەڤە', 'ژی', 'دگەل', 'هەمی', 'دکەت', 'دبیت', 'نینە', 'ڤێ', 'ڤی',
  'وی', 'وێ', 'ئێک', 'دناڤبەرا', 'سەر', 'ناڤ', 'ئەڤێ', 'ئەڤان', 'یێ', 'یا', 'یێن',
  // English
  'the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'that', 'this', 'these', 'those', 'it', 'its', 'for', 'with', 'as', 'by', 'at', 'from', 'which', 'who',
  'whom', 'not', 'but', 'has', 'have', 'had', 'their', 'they', 'them', 'there', 'can', 'may', 'also', 'more',
  'such', 'than', 'into', 'between', 'each', 'other', 'some', 'all', 'any', 'both', 'only', 'so', 'if',
  'when', 'while', 'we', 'our', 'i', 'my', 'he', 'she', 'his', 'her', 'would', 'should', 'could', 'will',
  'do', 'does', 'did', 'about', 'up', 'out', 'no', 'one',
].map(plain));

/**
 * One pattern for a list of entries, the longest first so that "فضلاً عن ذلك"
 * is one connector and not "فضلاً عن" with two words after it; each entry is
 * its own group, so a match says which entry it was.
 */
function listPattern(entries: readonly string[], lang: DocLang): { re: RegExp; order: number[] } {
  const alts = entries.map((e, i) => ({
    i,
    src: e.split('|').map((v) => plain(v).trim().split(/\s+/).map(escapeRe).join('\\s*')).sort((a, b) => b.length - a.length),
  }));
  alts.sort((a, b) => b.src[0].length - a.src[0].length || a.i - b.i);
  const prefix = lang === 'ar' ? '(?:[وف])?' : '';
  const suffix = lang === 'ckb' ? '(?:ش)?' : '';
  const body = alts.map((a) => `(${a.src.join('|')})`).join('|');
  return { re: new RegExp(`${BEFORE}${prefix}(?:${body})${suffix}${AFTER}`, 'gu'), order: alts.map((a) => a.i) };
}

/** How many times each entry of a list is found in an already-`plain` text. */
function counted(text: string, entries: readonly string[], lang: DocLang): number[] {
  const { re, order } = listPattern(entries, lang);
  const n = entries.map(() => 0);
  for (const m of text.matchAll(re)) {
    for (let g = 1; g < m.length; g++) if (m[g] !== undefined) { n[order[g - 1]]++; break; }
  }
  return n;
}

// ── keeping a paper ───────────────────────────────────────────────────────

/** Headings under which a paper lists its references — the writer's sources, not the writer's prose. */
const REFERENCE_HEADINGS = new Set([
  'المصادر', 'المراجع', 'قائمة المصادر', 'قائمة المراجع', 'المصادر والمراجع', 'قائمة المصادر والمراجع',
  'ثبت المصادر', 'ثبت المصادر والمراجع', 'الهوامش',
  'سەرچاوەکان', 'لیستی سەرچاوەکان', 'سەرچاوە',
  'ژێدەر', 'ژێدەران', 'لیستا ژێدەران',
  'references', 'reference list', 'bibliography', 'works cited',
].map(plain));

/** A line as a heading reads when compared with those: no hashes, no "5." or "خامساً:", no colon after. */
function headingWords(line: string): string {
  let s = plain(line).trim().replace(/^#+\s*/, '');
  s = s.replace(/^(?:[0-9]+|[ivx]+|[a-z])\s*[.)\-–]\s*/, '');
  const colon = s.search(/[:：]/);
  if (colon !== -1 && colon < s.length - 1 && s.slice(0, colon).trim().split(/\s+/).length === 1) s = s.slice(colon + 1);
  return s.replace(/[:.\s]+$/, '').trim().replace(/\s+/g, ' ');
}

/** The text up to its references section, when one begins in the last 40% of it. */
function withoutReferences(text: string): string {
  const from = Math.floor(text.length * 0.6);
  let at = 0;
  for (const line of text.split('\n')) {
    if (at >= from && line.trim() && line.trim().split(/\s+/).length <= 6 && REFERENCE_HEADINGS.has(headingWords(line))) {
      return text.slice(0, at).trimEnd();
    }
    at += line.length + 1;
  }
  return text;
}

/**
 * Text cut to `MAX_SAMPLE_CHARS`, at the end of a paragraph or else of a
 * sentence in the last 2,000 characters — half a sentence at the end of a
 * sample is a sentence length nobody wrote.
 */
function capped(text: string): { text: string; cut: boolean } {
  if (text.length <= MAX_SAMPLE_CHARS) return { text, cut: false };
  const from = MAX_SAMPLE_CHARS - 2_000;
  const window = text.slice(from, MAX_SAMPLE_CHARS);
  let end = MAX_SAMPLE_CHARS;
  const para = window.lastIndexOf('\n\n');
  if (para !== -1) end = from + para;
  else {
    let last = -1;
    for (const m of window.matchAll(/[.!?؟…]["'»”)\]]*(?=\s)/g)) last = (m.index ?? 0) + m[0].length;
    if (last !== -1) end = from + last;
    else if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  }
  return { text: text.slice(0, end).trimEnd(), cut: true };
}

/**
 * A paper as kept: NFC, control characters except \n and \t removed, runs of
 * spaces collapsed, 3+ newlines → 2, trimmed, its references section dropped
 * when a heading names it in the last 40% of the text, and cut at
 * `MAX_SAMPLE_CHARS`. Words are counted as the rest of the app counts them.
 */
export function sampleOf(o: { id: string; name: string; text: string; now: number }): Sample {
  const cleaned = (typeof o.text === 'string' ? o.text : '')
    .normalize('NFC')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const { text, cut } = capped(withoutReferences(cleaned));
  return {
    id: o.id,
    name: (typeof o.name === 'string' ? o.name : '').replace(/\s+/g, ' ').trim().slice(0, 200),
    text,
    words: wordCount(text),
    added: o.now,
    truncated: cut,
  };
}

export function newResearcher(o: { id: string; now: number; name: string }): Researcher {
  return {
    id: o.id, v: 1, created: o.now, updated: o.now, name: o.name.trim(),
    title: '', affiliation: '', field: '', note: '', samples: [],
  };
}

function usable(samples: readonly Sample[] | undefined): Sample[] {
  return (samples ?? []).filter((s) => s && typeof s.text === 'string' && s.text.trim() !== '');
}

// ── reading a paper ───────────────────────────────────────────────────────

/** A piece of a paper: prose, a heading, a list item, a table row or a quotation, with where it starts. */
interface Block { kind: 'p' | 'h' | 'li' | 'row' | 'quote'; text: string; at: number }

const WORDISH = /[\p{L}\p{N}]/u;
const LIST_ITEM = /^(?:[-*•▪◦●–—]|\(?[0-9\u0660-\u0669\u06F0-\u06F9]{1,3}[.)\-–]|\(?[a-z][.)]|[\u0621-\u064A\u06A9\u06CC][)\-–])\s+/u;
const SENTENCE_END = /[.!?؟…]["'»”)\]]*$/;

function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((w) => WORDISH.test(w));
}

/**
 * The blocks of a paper. Papers arrive from Word (paragraphs a blank line
 * apart), from a PDF transcript (the same) and pasted (often one paragraph
 * per line, no blank lines), so a line that ends a sentence also ends its
 * paragraph, and a short line with no full stop that starts one is a
 * heading. Pipe and tab tables, list markers and `>` quotations are what they
 * look like.
 */
function blocksIn(text: string): Block[] {
  const out: Block[] = [];
  let buf: string[] = [];
  let start = 0;
  const flush = () => {
    if (!buf.length) return;
    const joined = buf.join(' ').replace(/\s+/g, ' ').trim();
    const one = buf.length === 1;
    buf = [];
    if (!joined) return;
    const heading = one && wordsOf(joined).length <= 12 && !/[.!?؟…،,;؛]["'»”)\]]*$/.test(joined);
    out.push({ kind: heading ? 'h' : 'p', text: joined, at: start });
  };
  const lines = text.split('\n');
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const here = at;
    at += line.length + 1;
    const t = line.trim();
    if (!t) { flush(); continue; }
    const pipes = t.match(/\|/g)?.length ?? 0;
    if (t.startsWith('|') || pipes >= 2 || (line.match(/\t/g)?.length ?? 0) >= 2) { flush(); out.push({ kind: 'row', text: t, at: here }); continue; }
    if (/^#{1,6}\s/.test(t)) { flush(); out.push({ kind: 'h', text: t.replace(/^#+\s*/, ''), at: here }); continue; }
    if (t.startsWith('>')) { flush(); out.push({ kind: 'quote', text: t.replace(/^>+\s*/, ''), at: here }); continue; }
    if (LIST_ITEM.test(t)) { flush(); out.push({ kind: 'li', text: t.replace(LIST_ITEM, ''), at: here }); continue; }
    const next = (lines[i + 1] ?? '').trim();
    if (!buf.length && next && wordsOf(t).length <= 8 && !/[.!?؟…،,;؛:]["'»”)\]]*$/.test(t)) {
      out.push({ kind: 'h', text: t, at: here });
      continue;
    }
    if (!buf.length) start = here;
    buf.push(t);
    if (SENTENCE_END.test(t)) flush();
  }
  flush();
  return out;
}

/** Abbreviations whose full stop does not end a sentence. Single letters (initials, د.) are caught separately. */
const ABBREVIATIONS = new Set(['dr', 'prof', 'mr', 'mrs', 'ms', 'e.g', 'i.e', 'etc', 'al', 'vol', 'pp', 'no', 'fig', 'cf', 'vs', 'ed', 'eds', 'ch', 'st', 'jr', 'inc', 'ltd', 'ibid', 'op', 'cit', 'ص', 'ج', 'م', 'هـ', 'ط']);

/** Whether a word before a full stop is an initial, a title or an abbreviation — short, or dotted inside (e.g, أ.د). */
function abbreviated(word: string): boolean {
  if (word.length > 8 && !word.includes('.')) return false;
  const w = plain(word).replace(/^[^\p{L}\p{N}]+/u, '');
  return (w.match(/\p{L}/gu)?.length ?? 0) === 1 || ABBREVIATIONS.has(w) || w.includes('.');
}

/**
 * The lengths, in words, of the sentences of a paragraph. A sentence ends at
 * . ! ? ؟ or … followed by a space or the end; not at the full stop of a
 * decimal (3.5 — no space after it), an initial or a title (د. — one letter),
 * or an abbreviation (e.g., et al.).
 */
function sentenceLengths(text: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (const m of text.matchAll(/[.!?؟…]+["'»”)\]]*(?=\s|$)/g)) {
    const end = (m.index ?? 0) + m[0].length;
    if (m[0] === '.') {
      const at = m.index ?? 0;
      const space = Math.max(text.lastIndexOf(' ', at), from - 1);
      const before = text.slice(space + 1, at);
      if (abbreviated(before)) continue;
    }
    const n = wordsOf(text.slice(from, end)).length;
    if (n) out.push(n);
    from = end;
  }
  const rest = wordsOf(text.slice(from)).length;
  if (rest) out.push(rest);
  return out;
}

/** A word as counted: without the punctuation around it. */
const EDGE = /^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu;

// ── measuring ─────────────────────────────────────────────────────────────

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The language most of the papers' words are in. Read paragraph by paragraph
 * with `docLangOf`, weighted by words: an Arabic paper that quotes a Kurdish
 * title once is still Arabic, which reading it whole would not say, because
 * one Kurdish letter makes a request Kurdish. `fallback` when there are no words.
 */
export function langOfSamples(samples: readonly Sample[], fallback: DocLang = 'en'): DocLang {
  const weight: Record<DocLang, number> = { ar: 0, ckb: 0, kmr: 0, en: 0 };
  for (const s of usable(samples)) {
    for (const chunk of s.text.split(/\n\s*\n|\n(?=.{200})/)) {
      const n = wordsOf(chunk).length;
      // The start of a paragraph says its language as well as the whole of it does, at a fraction of the cost.
      if (n) weight[docLangOf(chunk.slice(0, 600), fallback)] += n;
    }
  }
  let best: DocLang = fallback;
  let most = 0;
  for (const l of DOC_LANGS) if (weight[l] > most) { best = l; most = weight[l]; }
  return best;
}

/** Moving-average type-token ratio over windows of 100 words; the plain ratio when there are fewer. */
function mattr(words: readonly string[]): number {
  if (!words.length) return 0;
  const W = 100;
  if (words.length < W) return new Set(words).size / words.length;
  const count = new Map<string, number>();
  let distinct = 0;
  let sum = 0;
  let windows = 0;
  for (let i = 0; i < words.length; i++) {
    const c = count.get(words[i]) ?? 0;
    if (c === 0) distinct++;
    count.set(words[i], c + 1);
    if (i >= W) {
      const old = words[i - W];
      const k = (count.get(old) ?? 1) - 1;
      if (k === 0) { distinct--; count.delete(old); } else count.set(old, k);
    }
    if (i >= W - 1) { sum += distinct / W; windows++; }
  }
  return sum / windows;
}

/** Citation-like marks: author and year in brackets, [12], superscript digits, and "(3)" right after a word. */
function citationMarks(text: string): number {
  const t = asciiDigits(text);
  const authorYear = t.match(/\([^()\n]{0,120}?\p{L}[^()\n]{0,120}?(?<!\d)(?:1[5-9]|20)\d\d(?!\d)[^()\n]{0,40}\)/gu)?.length ?? 0;
  const numbered = t.match(/\[\d{1,3}(?:\s*[-–,،]\s*\d{1,3})*\]/g)?.length ?? 0;
  const superscript = t.match(/[¹²³⁰⁴⁵⁶⁷⁸⁹]+/g)?.length ?? 0;
  const footnote = t.match(/(?<=[\p{L}\p{M}.,،؛:"»”])\s?\(\d{1,3}\)/gu)?.length ?? 0;
  return authorYear + numbered + superscript + footnote;
}

/**
 * Phrases the writer comes back to: two to four words in a row, never across
 * punctuation, counted folded, at least three times, not all stop words, and
 * not part of a longer listed phrase that comes back exactly as often — "the
 * light of" is only ever "in the light of", and listing both says one thing twice.
 */
function recurring(texts: readonly string[], key: (w: string) => string): { text: string; count: number }[] {
  const seen = new Map<string, { text: string; count: number; first: number; n: number }>();
  let order = 0;
  for (const text of texts) {
    let run: { raw: string; key: string }[] = [];
    const end = () => {
      for (let i = 0; i < run.length; i++) {
        let k = run[i].key;
        for (let n = 2; n <= 4 && i + n <= run.length; n++) {
          k += ' ' + run[i + n - 1].key;
          const got = seen.get(k);
          if (got) got.count++;
          else seen.set(k, { text: run.slice(i, i + n).map((w) => w.raw).join(' '), count: 1, first: order++, n });
        }
      }
      run = [];
    };
    for (const token of text.split(/\s+/)) {
      if (!token) continue;
      const raw = token.replace(EDGE, '');
      if (/^[^\p{L}\p{N}\p{M}]/u.test(token)) end();
      if (!raw || !WORDISH.test(raw)) { end(); continue; }
      run.push({ raw, key: key(raw) });
      if (/[^\p{L}\p{N}\p{M}]$/u.test(token)) end();
    }
    end();
  }
  const listed = [...seen.entries()]
    .filter(([k, v]) => v.count >= 3 && !k.split(' ').every((w) => STOP.has(w)))
    .map(([k, v]) => ({ k, ...v }));
  const count = new Map(listed.map((x) => [x.k, x.count]));
  // Each longer phrase names the shorter ones inside it that it makes redundant.
  const inside = new Set<string>();
  for (const b of listed) {
    if (b.n < 3) continue;
    const w = b.k.split(' ');
    for (let i = 0; i < w.length; i++) {
      for (let j = i + 2; j <= w.length; j++) {
        if (j - i === w.length) continue;
        const k = w.slice(i, j).join(' ');
        if (count.get(k) === b.count) inside.add(k);
      }
    }
  }
  const kept = listed.filter((a) => !inside.has(a.k));
  kept.sort((a, b) => b.count * b.n - a.count * a.n || b.count - a.count || a.first - b.first);
  return kept.slice(0, 10).map((x) => ({ text: x.text, count: x.count }));
}

/** Prose paragraphs and list items of every usable sample, and the paragraphs on their own. */
function readAll(samples: readonly Sample[]): { paras: string[]; items: string[] } {
  const paras: string[] = [];
  const items: string[] = [];
  for (const s of usable(samples)) {
    for (const b of blocksIn(s.text)) {
      if (b.kind === 'p') paras.push(b.text);
      else if (b.kind === 'li') items.push(b.text);
    }
  }
  return { paras, items };
}

/**
 * The papers measured, all together; `null` under `MIN_WORDS` words of prose.
 *
 * Words are those of the prose paragraphs and list items — not headings,
 * tables or quotations of other people, which are not the writer's sentences.
 * Sentence and paragraph lengths are measured on paragraphs only: a list item
 * is a fragment by design.
 */
export function fingerprint(samples: readonly Sample[]): Fingerprint | null {
  const list = usable(samples);
  const { paras, items } = readAll(list);
  const prose = [...paras, ...items];
  const key = plainer();
  const folded = prose.flatMap((t) => wordsOf(t).map((w) => key(w.replace(EDGE, ''))).filter(Boolean));
  const words = folded.length;
  if (words < MIN_WORDS) return null;
  const lang = langOfSamples(list);

  const sentences = paras.flatMap(sentenceLengths);
  const mean = sentences.length ? sentences.reduce((a, b) => a + b, 0) / sentences.length : 0;
  const spread = sentences.length ? Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length) : 0;
  const paraWords = paras.map((p) => wordsOf(p).length);
  const per1000 = (n: number) => (n * 1000) / words;

  const text = plain(prose.join('\n\n'));
  const questions = prose.reduce((n, t) => n + (t.match(/[?؟]+/g)?.length ?? 0), 0);

  const marks = PERSON_MARKERS[lang];
  const people = (['I', 'we', 'impersonal'] as const).map((p) => ({ p, n: counted(text, marks[p], lang).reduce((a, b) => a + b, 0) }));
  // Ties go to the more reserved form: a paper that says "we" and "the
  // researcher" equally often is closer to a thesis than to an essay.
  const top = [...people].sort((a, b) => b.n - a.n || (a.p === 'impersonal' ? -1 : b.p === 'impersonal' ? 1 : a.p === 'we' ? -1 : 1))[0];

  const connectorCounts = counted(text, CONNECTORS[lang], lang);
  const connectors = CONNECTORS[lang]
    .map((e, i) => ({ word: e.split('|')[0], n: connectorCounts[i], i }))
    .filter((c) => c.n > 0 && r1(per1000(c.n)) > 0)
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, 8)
    .map((c) => ({ word: c.word, per1000: r1(per1000(c.n)) }));

  return {
    lang,
    words,
    sentences: sentences.length,
    sentenceWords: r1(mean),
    sentenceSpread: r1(spread),
    paragraphWords: paraWords.length ? r1(paraWords.reduce((a, b) => a + b, 0) / paraWords.length) : 0,
    richness: r3(mattr(folded)),
    questions: r1(per1000(questions)),
    person: top.n > 0 ? top.p : 'impersonal',
    connectors,
    phrases: recurring(prose, key),
    citations: r1(per1000(prose.reduce((n, t) => n + citationMarks(t), 0))),
    lists: paras.length + items.length ? r2(items.length / (paras.length + items.length)) : 0,
  };
}

// ── comparing ─────────────────────────────────────────────────────────────

/** 0–100 for two non-negative numbers: 100 when equal, falling with their ratio; `soft` keeps near-zero rates from looking far apart. */
function ratio(a: number, b: number, soft = 0): number {
  const x = a + soft;
  const y = b + soft;
  if (x <= 0 && y <= 0) return 100;
  if (x <= 0 || y <= 0) return 0;
  return (100 * Math.min(x, y)) / Math.max(x, y);
}

/** Cosine similarity of two connector profiles, over the union of their words, as 0–100. */
function cosine(a: Fingerprint['connectors'], b: Fingerprint['connectors']): number {
  if (!a.length && !b.length) return 100;
  const va = new Map(a.map((c) => [plain(c.word), c.per1000]));
  const vb = new Map(b.map((c) => [plain(c.word), c.per1000]));
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of new Set([...va.keys(), ...vb.keys()])) {
    const x = va.get(k) ?? 0;
    const y = vb.get(k) ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? (100 * dot) / Math.sqrt(na * nb) : 0;
}

const PERSON_NEAR: Readonly<Record<string, number>> = { 'I|we': 50, 'we|I': 50, 'we|impersonal': 40, 'impersonal|we': 40 };

/** How much each part counts in the overall score: what a reader notices first counts most. */
const WEIGHTS = { sentences: 3, connectors: 3, paragraphs: 1.5, vocabulary: 1.5, person: 1, questions: 0.5 } as const;

/**
 * How close a written text is to a researcher's fingerprint: 0–100 overall
 * and per part. Every part is symmetric, so it does not matter which is the
 * researcher and which the document. `null` if either is.
 */
export function closeness(
  a: Fingerprint | null,
  b: Fingerprint | null,
): { score: number; parts: { what: 'sentences' | 'paragraphs' | 'vocabulary' | 'connectors' | 'person' | 'questions'; score: number }[] } | null {
  if (!a || !b) return null;
  const parts = [
    { what: 'sentences' as const, score: 0.7 * ratio(a.sentenceWords, b.sentenceWords) + 0.3 * ratio(a.sentenceSpread, b.sentenceSpread, 1) },
    { what: 'paragraphs' as const, score: ratio(a.paragraphWords, b.paragraphWords) },
    // Richness lives in a narrow band (0.5–0.8 for most prose), so its ratio is sharpened.
    { what: 'vocabulary' as const, score: 100 * (ratio(a.richness, b.richness) / 100) ** 3 },
    { what: 'connectors' as const, score: cosine(a.connectors, b.connectors) },
    { what: 'person' as const, score: a.person === b.person ? 100 : PERSON_NEAR[`${a.person}|${b.person}`] ?? 0 },
    { what: 'questions' as const, score: ratio(a.questions, b.questions, 1) },
  ].map((p) => ({ what: p.what, score: Math.round(Math.max(0, Math.min(100, p.score))) }));
  let sum = 0;
  let weight = 0;
  for (const p of parts) { sum += p.score * WEIGHTS[p.what]; weight += WEIGHTS[p.what]; }
  return { score: Math.round(sum / weight), parts };
}

// ── passages that show the manner ─────────────────────────────────────────

/** A paragraph that is somebody else's words: it opens and closes with quotation marks. */
function quoted(text: string): boolean {
  return /^["«“„‹']/.test(text) && /["»”‹›'][.!?؟…]*\)?[.،,]?$/.test(text);
}

/** A passage cut to `chars` at the end of a sentence, or at a word with "…" when no sentence ends late enough. */
function cutAt(text: string, chars: number): string {
  if (text.length <= chars) return text;
  const head = text.slice(0, chars);
  let last = -1;
  for (const m of head.matchAll(/[.!?؟…]["'»”)\]]*(?=\s|$)/g)) last = (m.index ?? 0) + m[0].length;
  if (last >= chars * 0.4) return head.slice(0, last).trim();
  const space = head.lastIndexOf(' ', chars - 1);
  return `${head.slice(0, space > 0 ? space : chars - 1).trim()}…`;
}

/**
 * 2–4 passages that show the manner best: prose paragraphs (not headings,
 * lists, tables, references or quotations) of 60 to 220 words, close to the
 * writer's median paragraph, from the middle of a paper rather than its first
 * page, from different samples where there are several, whole paragraphs cut
 * to `chars` at a sentence boundary. The same papers give the same passages.
 */
export function excerptsOf(samples: readonly Sample[], n = 3, chars = 1100): string[] {
  const want = Math.max(0, Math.min(4, Math.floor(n)));
  if (!want || chars <= 0) return [];
  const lengths: number[] = [];
  const bySample: { text: string; score: number; at: number }[][] = [];
  const found: { s: number; text: string; words: number; pos: number; at: number }[] = [];
  usable(samples).forEach((s, si) => {
    bySample.push([]);
    for (const b of blocksIn(s.text)) {
      if (b.kind !== 'p') continue;
      const w = wordsOf(b.text).length;
      lengths.push(w);
      if (w < 60 || w > 220 || quoted(b.text) || b.text.includes('[[')) continue;
      found.push({ s: si, text: b.text, words: w, pos: b.at / Math.max(1, s.text.length), at: b.at });
    }
  });
  if (!found.length) return [];
  const sorted = [...lengths].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1;
  for (const c of found) {
    const edge = (c.pos < 0.15 ? 1 : 0) + (c.pos > 0.9 ? 0.5 : 0);
    bySample[c.s].push({ text: c.text, at: c.at, score: Math.abs(c.words - median) / median + edge + Math.abs(c.pos - 0.5) * 0.2 });
  }
  for (const q of bySample) q.sort((a, b) => a.score - b.score || a.at - b.at);
  const out: string[] = [];
  while (out.length < want && bySample.some((q) => q.length)) {
    // Each round takes one passage from every paper that has one, the best first.
    const round = bySample.map((q, i) => ({ q, i })).filter((x) => x.q.length).sort((a, b) => a.q[0].score - b.q[0].score || a.i - b.i);
    for (const { q } of round) {
      out.push(cutAt(q.shift()!.text, chars));
      if (out.length >= want) break;
    }
  }
  return out;
}

// ── learning ──────────────────────────────────────────────────────────────

const LANGUAGE_NAME: Readonly<Record<DocLang, string>> = {
  ar: 'Arabic', ckb: 'Central Kurdish (Sorani)', kmr: 'Northern Kurdish (Badini)', en: 'English',
};

const PERSON_TEXT: Readonly<Record<Fingerprint['person'], string>> = {
  I: 'Writes in the first person singular ("I", "in my view").',
  we: 'Refers to themselves as "we" (the plural of modesty).',
  impersonal: 'Refers to themselves as "the researcher" or "this study", never "I" or "we".',
};

/**
 * The fingerprint in plain English sentences, one per line. The recurring
 * phrases go to the learning request, which picks the stock expressions out
 * of them, and not into a voice: counted phrases are as often the writer's
 * subject ("التعليم في المجتمع") as their manner, and a model handed them
 * while writing would reuse them word for word.
 */
function measured(p: Fingerprint, phrases: boolean): string[] {
  const cv = p.sentenceWords ? p.sentenceSpread / p.sentenceWords : 0;
  const vary = cv < 0.35 ? 'fairly even in length' : cv < 0.6 ? 'varying in length' : 'varying a lot';
  return [
    `Counted over ${p.words} words of their papers, in ${LANGUAGE_NAME[p.lang]}.`,
    p.sentences ? `Sentences average ${Math.round(p.sentenceWords)} words, ${vary} (spread ${Math.round(p.sentenceSpread)}).` : '',
    p.paragraphWords ? `Paragraphs average ${Math.round(p.paragraphWords)} words.` : '',
    PERSON_TEXT[p.person],
    p.questions >= 0.5 ? `Asks about ${p.questions} questions per 1,000 words.` : 'Rarely asks questions.',
    p.connectors.length ? `Favourite connectors: ${p.connectors.map((c) => `${c.word} (${c.per1000} per 1,000 words)`).join(', ')}.` : '',
    phrases && p.phrases.length ? `Recurring phrases: ${p.phrases.map((x) => `"${x.text}" (${x.count} times)`).join(', ')}.` : '',
    p.citations >= 0.5 ? `Brings in sources about ${p.citations} times per 1,000 words.` : 'Rarely cites in the running text.',
    p.lists >= 0.05 ? `${Math.round(p.lists * 100)}% of blocks are list items.` : 'Writes in continuous prose; lists are rare.',
    `Vocabulary richness ${p.richness} (moving-average type-token ratio over 100-word windows, 0 to 1).`,
  ].filter(Boolean);
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * The papers inside the budget, shared as `dataBlock` shares its own: each
 * paper in turn, smallest first, gets an equal share of what is left, so a
 * short paper is never cut to make room for a long one. A cut paper says so —
 * a model that thinks it has read the whole paper describes its ending too.
 */
function papersBlock(samples: readonly Sample[], budget: number): string {
  const share = new Map<Sample, number>();
  let left = budget;
  const bySize = [...samples].sort((a, b) => a.text.length - b.text.length);
  bySize.forEach((s, i) => {
    const give = Math.min(s.text.length, Math.floor(left / (bySize.length - i)));
    share.set(s, give);
    left -= give;
  });
  const parts = samples.map((s) => {
    const n = share.get(s) ?? 0;
    const cut = n < s.text.length || s.truncated;
    let text = s.text.slice(0, n);
    if (n < s.text.length) {
      const space = text.search(/\s\S*$/);
      if (space > n - 300) text = text.slice(0, space);
    }
    return `--- ${oneLine(s.name) || 'Untitled'}${cut ? ' (only its beginning is shown here)' : ''} ---\n${text.trimEnd()}`;
  });
  return [
    'The papers, as they wrote them. They are here for their manner only.',
    ...parts,
    '--- end of the papers ---',
  ].join('\n');
}

/**
 * The learning request: a stylistician describing a writer's manner, never
 * their content. It carries who the researcher is, what the code measured,
 * and the papers inside `LEARN_BUDGET`, and asks for one JSON object in the
 * papers' language.
 */
export function learnPrompt(r: Researcher): { system: string; user: string } {
  const list = usable(r.samples);
  const lang = langOfSamples(list, r.guide?.lang ?? 'en');
  const print = fingerprint(list);
  const name = oneLine(`${r.title} ${r.name}`);
  const system = [
    'You are a stylistician. You read a researcher\'s papers and describe their manner of writing — how they write, never what they write about — so that another writer can write new text that reads as theirs.',
    'You describe manner only: tone, the build of sentences and paragraphs, how an argument moves, vocabulary and register, transitions, openings and closings, hedging and certainty, how sources are brought in. You never summarise the content, and you never name topics, findings, works, people or places from the papers.',
    'You reply with one JSON object and nothing else.',
  ].join('\n');
  const user = [
    'Describe how this researcher writes, from their papers below.',
    '',
    'About the researcher:',
    `- Name: ${name || '(not given)'}`,
    r.affiliation.trim() ? `- Affiliation: ${oneLine(r.affiliation)}` : null,
    r.field.trim() ? `- Field: ${oneLine(r.field)}` : null,
    r.note.trim() ? `- What the user says about their writing, in the user's own words: ${r.note.trim()}` : null,
    '',
    ...(print ? ['Measured from the papers by code — exact counts, not impressions:', ...measured(print, true).map((l) => `- ${l}`), ''] : []),
    papersBlock(list, LEARN_BUDGET),
    '',
    'Reply with ONE JSON object and nothing else:',
    '{',
    '  "summary": "one paragraph: the voice in a nutshell",',
    '  "traits": [{"name": "a short name for the trait", "detail": "a sentence or two, concrete enough to imitate"}],',
    '  "phrases": ["an expression they reuse"],',
    '  "avoid": ["something this writer does not do"]',
    '}',
    '',
    'Rules:',
    `1. Write every value in ${LANGUAGE_NAME[lang]}, the language of the papers.`,
    '2. Manner only, never content: no topics, no findings or claims, no names of works, people, places or institutions from the papers. Somebody reading your description must learn how this person writes and nothing about what they wrote about.',
    '3. traits: 5 to 8 of them, covering tone, sentence build, how the argument moves, vocabulary, transitions, openings and closings, hedging and certainty, and how sources are brought in.',
    '4. phrases: at most 12 expressions they actually reuse — connectors, stock openings, formulas for bringing in a source or closing a part — each at most 6 words, spelled as they spell them. No phrases about the subject matter.',
    '5. avoid: at most 6 things this writer does not do.',
    '6. Base everything on the papers and the measured numbers; where your impression and the numbers disagree, the numbers are right.',
  ].filter((l): l is string => l !== null).join('\n');
  return { system, user };
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max).trim() : '';
}

/** Short strings from an array, trimmed, each once, at most `max`, those failing `ok` dropped. */
function strings(v: unknown, max: number, chars: number, ok: (s: string) => boolean = () => true): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!s || !ok(s)) continue;
    const cut = s.slice(0, chars).trim();
    const k = plain(cut);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cut);
    if (out.length >= max) break;
  }
  return out;
}

/** Traits from an array of {name, detail}, or from an object of name → detail. */
function traitsOf(v: unknown): { name: string; detail: string }[] {
  const raw: unknown[] = Array.isArray(v)
    ? v
    : v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([name, detail]) => ({ name, detail })) : [];
  const out: { name: string; detail: string }[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const name = str(o.name, 120);
    const detail = str(o.detail, 400);
    if (!name || !detail) continue;
    out.push({ name, detail });
    if (out.length >= 8) break;
  }
  return out;
}

/** The learning reply read, or `null` when it holds no summary. */
export function parseGuide(text: string, o: { lang: DocLang; now: number; from: string[] }): StyleGuide | null {
  const v = jsonIn(text);
  if (!v || typeof v !== 'object') return null;
  const x = v as Record<string, unknown>;
  const summary = str(x.summary, 1_200);
  if (!summary) return null;
  return {
    summary,
    traits: traitsOf(x.traits),
    phrases: strings(x.phrases, 12, 200, (s) => wordsOf(s).length <= 6),
    avoid: strings(x.avoid, 6, 300),
    lang: o.lang,
    learned: o.now,
    from: [...o.from],
  };
}

/** The longest guide text a voice carries: `voiceRules` keeps no more of it. */
const GUIDE_CHARS = 4_000;

/**
 * The guide and the measured numbers, as the model is told them: English
 * labels, the traits, the phrases they reuse, what they avoid, the numbers in
 * words, then the user's own note. The numbers and the note are kept whole
 * when the text has to be shortened; the traits give way first, then the summary.
 */
export function guideText(g: StyleGuide | undefined, print: Fingerprint | null, note?: string): string {
  const tail = [
    print ? `Measured from their papers:\n${measured(print, false).map((l) => `- ${l}`).join('\n')}` : '',
    note?.trim() ? `What the user says about their writing: ${note.trim().slice(0, 800)}` : '',
  ].filter(Boolean).join('\n\n');
  if (!g) return tail.slice(0, GUIDE_CHARS);
  const head = (detail: number, summary: number) => [
    `In a nutshell: ${g.summary.slice(0, summary)}`,
    g.traits.length ? `Traits:\n${g.traits.map((t) => `- ${t.name}: ${t.detail.length > detail ? `${t.detail.slice(0, detail - 1)}…` : t.detail}`).join('\n')}` : '',
    g.phrases.length ? `Expressions they reuse: ${g.phrases.join('; ')}` : '',
    g.avoid.length ? `They avoid:\n${g.avoid.map((a) => `- ${a}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const room = GUIDE_CHARS - (tail ? tail.length + 2 : 0);
  let text = head(400, 1_200);
  for (const [d, s] of [[300, 1_200], [200, 900], [120, 600], [60, 400]] as const) {
    if (text.length <= room) break;
    text = head(d, s);
  }
  if (text.length > room) {
    const cut = text.slice(0, Math.max(0, room));
    const line = cut.lastIndexOf('\n');
    text = line > room * 0.5 ? cut.slice(0, line) : cut;
  }
  return [text, tail].filter(Boolean).join('\n\n').slice(0, GUIDE_CHARS);
}

/**
 * A document's copy of the voice: the guide and the numbers in words, three
 * passages, and the language of the papers. `null` when the researcher has
 * neither a guide nor enough of their writing to measure.
 */
export function voiceOf(r: Researcher): Voice | null {
  const list = usable(r.samples);
  const print = fingerprint(list);
  if (!r.guide && !print) return null;
  return {
    id: r.id,
    name: oneLine(`${r.title} ${r.name}`),
    guide: guideText(r.guide, print, r.note),
    excerpts: excerptsOf(list, 3, 1100),
    lang: langOfSamples(list, r.guide?.lang ?? 'en'),
  };
}

/** Whether the guide predates the samples: a sample added or removed since it was learned. */
export function stale(r: Researcher): boolean {
  if (!r.guide) return false;
  const now = new Set(r.samples.map((s) => s.id));
  const then = new Set(r.guide.from);
  return now.size !== then.size || [...now].some((id) => !then.has(id));
}

// ── finding the researcher a request names ────────────────────────────────

/** Titles that may stand before a name — in the request or in the name as saved. */
const TITLES = [
  'أ.د.', 'أ. د.', 'أ.م.د.', 'م.د.', 'م.م.', 'د.', 'د', 'الدكتور', 'الدكتورة', 'دكتور', 'دكتورة', 'الأستاذ', 'الأستاذة',
  'الأستاذ الدكتور', 'بروفيسور', 'البروفيسور',
  'دکتۆر', 'د.', 'پ.ی.د.', 'پ.د.', 'پ.ی.', 'پرۆفیسۆر', 'پڕۆفیسۆر', 'مامۆستا',
  'dr', 'dr.', 'prof', 'prof.', 'professor', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.',
].map(plain);
const TITLE_ALT = [...new Set(TITLES)].sort((a, b) => b.length - a.length).map((t) => escapeRe(t).replace(/\\\.\s*/g, '\\.\\s*').replace(/ /g, '\\s*')).join('|');
const TITLE_RE = `(?:(?:${TITLE_ALT})(?:\\s+|(?<=\\.)))`;
const LEADING_TITLES = new RegExp(`^${TITLE_RE}+`, 'u');

/**
 * The words that ask for somebody's manner, before their name. Only phrases
 * that mean "in the manner of": a bare "مثل", "وەک", "like" or "as" is how a
 * request gives examples — "colours such as green", "الخلفاء مثل علي" — and
 * taking the word after it for a researcher's surname would quietly write the
 * document in a manner nobody asked for.
 */
const CUES = [
  'بأسلوب', 'على أسلوب', 'على طريقة', 'بطريقة', 'كما يكتب', 'كما تكتب',
  'بە شێوازی', 'بە ستایلی', 'بە شێوەی نووسینی', 'ب شێوازێ', 'ب ستایلێ',
  'in the style of', 'in the manner of', 'in the voice of',
].map(plain);
const CUE_RE = `(?:${[...new Set(CUES)].sort((a, b) => b.length - a.length).map((c) => c.split(/\s+/).map(escapeRe).join('\\s+')).join('|')})`;

/** A name as it is matched: folded, its titles gone, its words without surrounding punctuation. */
function nameWords(name: string): string[] {
  const s = plain(typeof name === 'string' ? name : '').trim().replace(/\s+/g, ' ').replace(LEADING_TITLES, '');
  return s.split(' ').map((w) => w.replace(EDGE, '')).filter(Boolean);
}

const letters = (s: string) => s.match(/\p{L}/gu)?.length ?? 0;

/**
 * The researcher a request names, or null.
 *
 * The whole name anywhere in the request is enough; after a phrase that asks
 * for a manner ("بأسلوب", "بە شێوازی", "ب شێوازێ", "in the style of") part of
 * the name is enough too — "بأسلوب الجبوري". Titles are optional, matching is
 * folded and by whole words, a name of fewer than three letters never
 * matches, and when two people match the one with the longer match wins, so
 * "أحمد الجبوري الموصلي" is not taken for "أحمد الجبوري".
 */
export function voiceIn(request: string, people: readonly Researcher[]): Researcher | null {
  const text = plain(typeof request === 'string' ? request : '').replace(/\s+/g, ' ');
  if (!text.trim()) return null;
  let best: Researcher | null = null;
  let longest = 0;
  for (const r of people) {
    const words = nameWords(r?.name ?? '');
    if (letters(words.join('')) < 3) continue;
    const full = words.map(escapeRe).join('\\s+');
    let got = 0;
    // The whole name outranks a part of another name of the same length. A
    // one-word name is a word the request may use for its own sake, and
    // counts only after a cue.
    if (words.length >= 2 && new RegExp(`${BEFORE}${full}${AFTER}`, 'u').test(text)) got = words.join(' ').length + 0.5;
    else {
      const parts: string[] = [];
      for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j <= words.length; j++) {
          const part = words.slice(i, j);
          if (letters(part.join('')) >= 3) parts.push(part.join(' '));
        }
      }
      parts.sort((a, b) => b.length - a.length);
      if (parts.length) {
        const re = new RegExp(`${BEFORE}${CUE_RE}\\s+${TITLE_RE}*(${parts.map((p) => p.split(' ').map(escapeRe).join('\\s+')).join('|')})${AFTER}`, 'u');
        const m = re.exec(text);
        if (m) got = m[1].length;
      }
    }
    if (got > longest) { best = r; longest = got; }
  }
  return best;
}

// ── reading a stored record ───────────────────────────────────────────────

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown, or: number) => (typeof v === 'number' && Number.isFinite(v) ? v : or);
const langOf = (v: unknown): DocLang | null => (DOC_LANGS.includes(v as DocLang) ? (v as DocLang) : null);

function readSample(raw: unknown): Sample | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || !s.id || typeof s.text !== 'string') return null;
  return {
    id: s.id,
    name: text(s.name, 200),
    text: s.text,
    words: typeof s.words === 'number' && Number.isFinite(s.words) && s.words >= 0 ? Math.round(s.words) : wordCount(s.text),
    added: num(s.added, 0),
    truncated: s.truncated === true,
  };
}

function readGuide(raw: unknown, samples: readonly Sample[]): StyleGuide | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  const summary = typeof g.summary === 'string' ? g.summary.trim() : '';
  if (!summary) return undefined;
  return {
    summary,
    traits: traitsOf(g.traits),
    phrases: strings(g.phrases, 12, 200),
    avoid: strings(g.avoid, 6, 300),
    lang: langOf(g.lang) ?? langOfSamples(samples),
    learned: num(g.learned, 0),
    from: Array.isArray(g.from) ? g.from.filter((x): x is string => typeof x === 'string') : [],
  };
}

/**
 * A stored record read back defensively — IndexedDB may hold anything,
 * including a record written by a later version of the app. `null` unless it
 * is an object with a string id and `v === 1`; every other field defaulted;
 * samples that are not samples dropped, each id once; a guide kept only if
 * its summary is a non-empty string.
 */
export function readResearcher(raw: unknown): Researcher | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || r.v !== 1) return null;
  const samples: Sample[] = [];
  const ids = new Set<string>();
  for (const x of Array.isArray(r.samples) ? r.samples : []) {
    const s = readSample(x);
    if (!s || ids.has(s.id)) continue;
    ids.add(s.id);
    samples.push(s);
  }
  const created = num(r.created, 0);
  const out: Researcher = {
    id: r.id,
    v: 1,
    created,
    updated: num(r.updated, created),
    name: text(r.name, 200),
    title: text(r.title, 80),
    affiliation: text(r.affiliation, 300),
    field: text(r.field, 300),
    note: text(r.note, 4_000),
    samples,
  };
  const guide = readGuide(r.guide, samples);
  if (guide) out.guide = guide;
  return out;
}
