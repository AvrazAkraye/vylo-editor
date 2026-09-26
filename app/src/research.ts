/**
 * Research: working papers, articles, theses and dissertations, written
 * section by section with references that exist.
 *
 * Somebody writing a master's thesis in Duhok or a working paper for a
 * conference in Baghdad does not want a chat. They want to say what they need
 * — "ورقة عمل عن أثر الذكاء الاصطناعي في التعليم" — and get back a document in
 * the shape their institution expects, in their language, with a reference
 * list they can defend. This file is what the app knows about those shapes,
 * and it is pure, so every rule in it can be tested without a model.
 *
 * ## A skill is activated by the words that name it
 *
 * Each kind of document is a skill: a structure, a length, a front matter, and
 * the phrases that ask for it — in Arabic, Sorani, Badini and English. Typing
 * the phrase activates the skill; there is no menu to find first. `detect`
 * reads the phrase out of whatever was typed, through the app's one Arabic and
 * Kurdish fold, so ورقه عمل and ورقة عمل, أطروحة and اطروحة, كار and کار are
 * the same request.
 *
 * Phrases, never single words. رسالة is a letter as often as a thesis, بحث is
 * a search, عمل is work — a trigger on any of them would turn every sentence
 * into a request for a document.
 *
 * ## The model never writes a citation
 *
 * The one thing a generated thesis must not contain is a reference to a study
 * nobody wrote. So the model is never asked for one. It is handed numbered
 * records that came from OpenAlex and Crossref (or that the researcher typed),
 * and it may point at them only with a marker — `[@s3]`. The app turns markers
 * into citations and builds the reference list itself, from the records, in the
 * style the researcher chose (`cite.ts`). A marker that names no record is
 * dropped rather than printed, and a study the model mentions without a marker
 * has no entry to hide behind.
 *
 * The same rule covers data. A model asked for "chapter four: results" will
 * produce results; that is fabrication with a table around it. It is told
 * instead to leave a marked gap — `[[Table: …]]` — for the researcher's own
 * numbers, and to use data only when the researcher supplied it.
 *
 * ## Nothing here reaches disk
 *
 * This is a description of documents and of the requests that write them. The
 * panel shows the result; a Word file exists only when a person presses Save
 * and chooses where, and it is built from exactly what they were shown.
 */

import { fold } from './settings';
import type { Effort } from './effort';

// ── the vocabulary ────────────────────────────────────────────────────────

/** The languages a document can be written in. The same four as the app. */
export type DocLang = 'ar' | 'ckb' | 'kmr' | 'en';

export const DOC_LANGS: readonly DocLang[] = ['ar', 'ckb', 'kmr', 'en'];

/** The kinds of document — each one a skill. */
export type Kind = 'working-paper' | 'article' | 'conference' | 'review' | 'proposal' | 'graduation' | 'masters' | 'phd';

/**
 * Citation styles, as the reference list and the citations are formatted.
 *
 * `footnotes` is the one Arab and Kurdish universities use — a note at the foot
 * of the page, the full reference the first time and "مصدر سابق" after, and a
 * source list grouped by kind — and the default for a document in their
 * languages. The other five are the manuals English-language journals name.
 */
export type Style = 'footnotes' | 'apa' | 'harvard' | 'chicago' | 'mla' | 'ieee';

export const STYLES: readonly Style[] = ['footnotes', 'apa', 'harvard', 'chicago', 'mla', 'ieee'];

/** How long, relative to what the kind usually is. */
export type Length = 'short' | 'standard' | 'long';

export const LENGTHS: readonly Length[] = ['short', 'standard', 'long'];

/**
 * A person who wrote a source.
 *
 * `family` alone is an organisation, or a name that could not be split — an
 * Arabic name from a record that gives it whole is better kept whole than cut
 * at the wrong space.
 */
export interface Person {
  given?: string;
  family: string;
}

/** What a source is, as the reference styles distinguish them. */
export type SourceType =
  | 'article' | 'book' | 'chapter' | 'thesis' | 'conference' | 'report' | 'web'
  /** A constitution, a law, a regulation, instructions, a decision. */
  | 'law'
  | 'dictionary'
  | 'other';

/**
 * A work the document may cite.
 *
 * Every field is what the record said, not what a model said. `verified` is
 * true for a record that came from OpenAlex or Crossref, or a typed one whose
 * DOI resolved; a reference the researcher typed without a DOI is theirs to
 * vouch for, and is marked so rather than refused.
 */
export interface Source {
  /** The handle a marker uses: `s1`, `s2`… Assigned once, never reused in a document. */
  key: string;
  /** Bare and lower-case: `10.1000/xyz`, never a URL. */
  doi?: string;
  title: string;
  authors: Person[];
  year?: number;
  /** Journal, book, proceedings, or the publisher's site. */
  venue?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  /** Where the publisher is: بيروت, Oxford. */
  city?: string;
  /** "3" for a third edition. */
  edition?: string;
  /** Legislation's number: the 12 of "رقم ١٢ لسنة ٢٠١٠". */
  number?: string;
  /** When a law was published, as the gazette gives it: "٩ آذار ٢٠١٠". */
  issued?: string;
  url?: string;
  type: SourceType;
  /** Plain text, trimmed. What the model reads to know what the work says. */
  abstract?: string;
  /** ISO 639-1, when the record says. */
  lang?: string;
  /** How often it is cited, when the record says. Used to rank, never shown as a claim. */
  cited?: number;
  /**
   * Where the record came from. `model` is legislation the model named in the
   * plan from what it knows — never a study or a book, which it could invent
   * whole — and is marked for the researcher to check against the official text.
   */
  origin: 'openalex' | 'crossref' | 'person' | 'model';
  verified: boolean;
  /** The record says the work was retracted. Kept visible, never used. */
  retracted?: boolean;
  /** The researcher wants it in the document. Switched off, it is neither shown to the model nor cited. */
  use: boolean;
}

/** Where a section is. `author` is a part only the researcher can write — a dedication, their own data. */
export type SectionState = 'waiting' | 'writing' | 'done' | 'failed' | 'author';

export interface Section {
  id: string;
  /**
   * 1 is a chapter, or a main heading in a document without chapters. Four
   * levels, because an Arabic thesis in law runs الفصل › المبحث › المطلب › الفرع.
   */
  level: 1 | 2 | 3 | 4;
  heading: string;
  /** What it has to cover, from the outline. Shown to the researcher, and handed to the model. */
  brief: string;
  /** The words it should come to. Zero is a heading with nothing under it but its subsections. */
  words: number;
  /** Keys of the sources this section should lean on. Others may still be cited. */
  sources: string[];
  /** The body: paragraphs, `###` subheadings, lists, tables, `[@s3]` markers and `[[gaps]]`. */
  text: string;
  state: SectionState;
  error?: string;
}

/** What goes on the cover and into the statement under the title. Every field may be empty. */
export interface Meta {
  title: string;
  /** The English title, for the English abstract of a document in another language. */
  titleEn: string;
  author: string;
  /**
   * The line above the author's name on the cover — "بحث مقدم من قبل الطالب"
   * or "…الطالبة". Empty means the kind's own wording (`bylineOf`); it is a
   * field because the wording carries the author's gender in Arabic, and that
   * is not the app's to guess.
   */
  presented: string;
  supervisor: string;
  /** Under the supervisor's name: their chair, as "أستاذ القانون الإداري". */
  supervisorTitle: string;
  /** Lines printed above the university on a thesis cover — a country, a ministry. One per line. */
  authority: string;
  university: string;
  college: string;
  department: string;
  /** The specialisation the degree is in. */
  field: string;
  /** The conference, seminar or journal a paper is for. */
  venue: string;
  city: string;
  year: string;
}

/**
 * A file of the researcher's own — survey results, a spreadsheet, interview
 * notes, a draft chapter — read into text when they attached it.
 *
 * The text is what the model is given, and the only data the document may
 * report: rule 2 of the system prompt forbids inventing any, and these files
 * are how a results chapter gets real numbers instead of a gap.
 */
export interface DataFile {
  id: string;
  name: string;
  /** How it was read: as text, as a table (CSV, a spreadsheet), from a Word file, or transcribed from a PDF. */
  kind: 'text' | 'table' | 'document' | 'pdf';
  text: string;
  /** The size of the file on disk. */
  bytes: number;
  /** Only the start of it could be kept. */
  truncated: boolean;
}

/** Where a document's run is. */
export type Stage = 'new' | 'planning' | 'sources' | 'outline' | 'writing' | 'abstract' | 'done';

export interface Doc {
  id: string;
  v: 1;
  created: number;
  updated: number;
  /** What the researcher typed, as they typed it. */
  request: string;
  kind: Kind;
  lang: DocLang;
  style: Style;
  length: Length;
  meta: Meta;
  /** The researcher's own notes, data and instructions, used by every section. */
  notes: string;
  /** Search queries the plan chose, kept so the sources can be searched again. */
  queries: string[];
  sources: Source[];
  sections: Section[];
  abstract: string;
  /** The English abstract of a document in another language; empty for an English one. */
  abstractEn: string;
  keywords: string[];
  keywordsEn: string[];
  stage: Stage;
  /** Stop after the sources and the outline, for the researcher to check them before anything is written. */
  pause: boolean;
  /** The university's logo for the cover, as a `data:image/png` or `data:image/jpeg` URL. */
  logo?: string;
  /** Print the university's name under the logo, as logos that carry no name need. */
  logoCaption?: boolean;
  /** The font the Word file asks for; empty is the language's usual one. */
  font?: string;
  /**
   * How numbers are written. Iraqi and Kurdish universities print ١٢٣, and a
   * thesis in Western digits reads as a translation. English is always 123.
   */
  digits?: 'eastern' | 'western';
  /** The model its last run was started with, for the line that names it. */
  model?: string;
  /**
   * The model the researcher chose to write it with, as the composer names a
   * choice — a provider and a model. Absent is the composer's own.
   */
  choice?: {
    provider: string;
    model: string;
    /**
     * The provider's address when it was chosen. A provider removed in
     * Settings frees its id for the next one added, and a document must not
     * follow its old id to a host nobody chose for it.
     */
    at?: string;
  };
  /** How hard that model thinks — its effort. Absent is the model's default. */
  effort?: Effort;
  /** How many writers work on its parts at the same time. One writes them in order. */
  agents?: number;
  /** Words to aim for, when the researcher set a number rather than a length. */
  words?: number;
  /** Sources to look for, when the researcher set a number. */
  sourcesWanted?: number;
  /** The researcher's own data, read from files they attached. */
  files?: DataFile[];
  /** Whose way of writing it is written in, when one was chosen (researchers.ts). */
  voice?: Voice;
  error?: string;
}

/**
 * A researcher's way of writing, as a document carries it: a copy made when
 * the voice was chosen, not a link to the researcher. A document half-written
 * in one voice must not change manner in chapter three because the profile
 * was relearned, and a researcher deleted from the list must not take the
 * voice out of a thesis written in it. `researchers.ts` builds it.
 */
export interface Voice {
  /** The researcher it was learned from, in the Researchers tab. */
  id: string;
  name: string;
  /** How they write, as the model is told it. English: it is instructions, not text anybody prints. */
  guide: string;
  /** A few short passages of their own, to show the manner. Never text to reuse. */
  excerpts: string[];
  /** The language their papers are in, which may not be the document's. */
  lang: DocLang;
}

// ── the skills ────────────────────────────────────────────────────────────

/**
 * One kind of document.
 *
 * `shape` is written for the model, in English, because it is instructions
 * rather than text anybody reads; the headings it produces are in the
 * document's language. It describes what universities in the region actually
 * ask for — the five-chapter Arab thesis, the working paper built on axes
 * (محاور) and ending in recommendations — rather than a generic essay.
 */
export interface KindSpec {
  id: Kind;
  /** English, and the i18n key. */
  label: string;
  /** One line for the skill's card. English, and the i18n key. */
  about: string;
  /** The phrases that ask for it, in every language the app speaks. */
  triggers: readonly string[];
  /**
   * When two kinds are named in one request, the higher wins: "خطة رسالة
   * ماجستير" is a plan *for* a thesis, and "a literature review for my master's
   * thesis" is a review. Otherwise the longest phrase wins.
   */
  rank: number;
  /** Total words to aim for. */
  words: Readonly<Record<Length, number>>;
  /** How many references to look for. */
  sources: number;
  /** Organised in chapters, each written as an introduction and its sections. */
  chapters: boolean;
  /** A thesis cover — authority, university, college, statement, supervisor — or a paper's. */
  cover: 'thesis' | 'paper';
  /** Dedication and acknowledgements pages, left for the researcher. */
  dedication: boolean;
  /** No abstract, one in the document's language, or that and an English one. */
  abstract: 'none' | 'one' | 'both';
  contents: boolean;
  shape: string;
}

/**
 * For a topic that is argued rather than measured, the empirical chapters are
 * the wrong shape. Said once, and added to every kind that has them.
 */
const THEORETICAL = [
  'If the topic is theoretical rather than empirical (law, Sharia, history,',
  'literature, linguistics, philosophy, politics), replace the method, results',
  'and discussion parts with analytical chapters or sections organised by theme,',
  'and keep the framework at the start and the conclusions at the end.',
].join(' ');

export const KINDS: readonly KindSpec[] = [
  {
    id: 'working-paper',
    label: 'Working paper',
    about: 'A paper for a conference, seminar or workshop, built on axes and ending in recommendations.',
    triggers: [
      'ورقة عمل', 'ورقة العمل', 'اوراق عمل', 'ورقات عمل',
      'وەرەقەی کار', 'ورقەی کار', 'پەڕەی کار', 'کاغەزی کار',
      'وەرەقا کاری', 'پەرا کاری', 'کاغەزا کاری',
      'working paper', 'work paper',
    ],
    rank: 2,
    words: { short: 2500, standard: 4500, long: 7000 },
    sources: 15,
    chapters: false,
    cover: 'thesis',
    dedication: false,
    abstract: 'none',
    contents: false,
    shape: [
      'A working paper (ورقة عمل) prepared for a university department, a conference, a seminar or a workshop.',
      '1. Introduction — one part, written with "### " subheadings inside it for: the subject and its',
      '   importance; the problem and its questions; the method and the plan of the paper.',
      '2. Two to four main parts, each analysing one dimension of the topic with evidence from the',
      '   sources, divided into subparts where the argument divides; each main part opens with a short',
      '   paragraph that says how it is divided.',
      '3. Conclusion — one part, written with two "### " subheadings inside it: the findings, and the',
      '   recommendations or proposals, each a numbered list of concrete points.',
    ].join('\n'),
  },
  {
    id: 'article',
    label: 'Research article',
    about: 'An article for a peer-reviewed journal: introduction, literature, method, results, discussion.',
    triggers: [
      'بحث علمي', 'بحث محكم', 'بحث للنشر', 'ورقة بحثية', 'مقال علمي', 'مقالة علمية',
      'توێژینەوەی زانستی', 'توێژینەوەیەکی زانستی', 'وتاری زانستی',
      'ڤەکولینا زانستی', 'ڤەکۆلینا زانستی', 'گۆتارا زانستی',
      'research paper', 'research article', 'journal article', 'scientific paper', 'academic paper',
    ],
    rank: 2,
    words: { short: 4500, standard: 7000, long: 10000 },
    sources: 30,
    chapters: false,
    cover: 'paper',
    dedication: false,
    abstract: 'both',
    contents: false,
    shape: [
      'A research article for a peer-reviewed journal. Main headings, in this order:',
      '1. Introduction: background, the problem, the gap in what is known, the aim, the questions or hypotheses.',
      '2. Literature review, organised by theme.',
      '3. Methodology: design, population and sample, instruments, procedures, analysis.',
      '4. Results.',
      '5. Discussion: the results read against the literature.',
      '6. Conclusion, with limitations and directions for future research.',
      'No chapters. ' + THEORETICAL,
    ].join('\n'),
  },
  {
    id: 'conference',
    label: 'Conference paper',
    about: 'A paper for a scientific conference: an abstract, the study, and recommendations, within the organisers’ limit.',
    triggers: [
      'بحث مؤتمر', 'بحث المؤتمر', 'بحث لمؤتمر', 'بحث مقدم الى مؤتمر', 'ورقة مؤتمر', 'بحوث المؤتمرات', 'مشاركة في مؤتمر',
      'توێژینەوەی کۆنفرانس', 'توێژینەوە بۆ کۆنفرانس', 'وتاری کۆنفرانس',
      'ڤەکولینا کۆنفرانسێ', 'ڤەکولین بۆ کۆنفرانسێ', 'گۆتارا کۆنفرانسێ',
      'conference paper', 'conference research', 'conference proceedings paper', 'paper for a conference',
    ],
    rank: 3,
    words: { short: 3000, standard: 5000, long: 7500 },
    sources: 25,
    chapters: false,
    cover: 'paper',
    dedication: false,
    abstract: 'both',
    contents: false,
    shape: [
      'A research paper for a scientific conference, to be read by its committee and published in its proceedings.',
      'Main headings, in this order:',
      '1. Introduction: the problem, its importance, the questions or hypotheses, and the aim — the conference theme it answers.',
      '2. Previous studies and the theoretical background, briefly.',
      '3. Methodology: approach, sample or material, instruments, analysis.',
      '4. Results and discussion, organised by the questions.',
      '5. Conclusions and recommendations, numbered and concrete.',
      'No chapters. Concise throughout: a conference allows few pages. ' + THEORETICAL,
    ].join('\n'),
  },
  {
    id: 'review',
    label: 'Literature review',
    about: 'A review that synthesises what has been published on a question, and where the gaps are.',
    triggers: [
      'مراجعة أدبيات', 'مراجعة الأدبيات', 'مراجعة منهجية', 'مراجعة الدراسات السابقة', 'مراجعة الادب',
      'پێداچوونەوەی ئەدەبیات', 'پێداچوونەوەی سەرچاوەکان', 'پێداچوونەوەی توێژینەوەکان',
      'پێداچوونا ئەدەبیاتێ', 'پێداچوونا ژێدەران', 'پێداچوونا ڤەکولینان',
      'literature review', 'systematic review', 'review article', 'scoping review',
    ],
    rank: 3,
    words: { short: 4000, standard: 6500, long: 9000 },
    sources: 40,
    chapters: false,
    cover: 'paper',
    dedication: false,
    abstract: 'both',
    contents: true,
    shape: [
      'A literature review. Main headings, in this order:',
      '1. Introduction: the scope, why a review is needed now, and the questions it answers.',
      '2. Method of the review. Say only what was done: the sources were found by keyword',
      '   search in OpenAlex and Crossref and chosen for relevance. Do not claim PRISMA counts,',
      '   databases or screening steps that did not happen.',
      '3. Three to five thematic sections that synthesise the sources, comparing and contrasting',
      '   them, rather than summarising them one after another.',
      '4. Gaps in the literature and directions for future research.',
      '5. Conclusion.',
      'No chapters.',
    ].join('\n'),
  },
  {
    id: 'proposal',
    label: 'Research proposal',
    about: 'The plan submitted for approval before a thesis: problem, questions, method and timeline.',
    triggers: [
      'خطة بحث', 'خطة البحث', 'خطة رسالة', 'خطة الرسالة', 'خطة أطروحة', 'خطة الاطروحة',
      'مقترح بحث', 'مقترح بحثي', 'مقترح البحث', 'بروبوزل',
      'پلانی توێژینەوە', 'پێشنیازی توێژینەوە', 'پرۆپۆزەڵ',
      'پلانا ڤەکولینێ', 'پێشنیارا ڤەکولینێ', 'پرۆپۆزەل',
      'research proposal', 'thesis proposal', 'dissertation proposal', 'research plan',
    ],
    rank: 4,
    words: { short: 2500, standard: 4000, long: 6000 },
    sources: 20,
    chapters: false,
    cover: 'thesis',
    dedication: false,
    abstract: 'none',
    contents: true,
    shape: [
      'A research proposal (خطة بحث) submitted for approval before the thesis is written.',
      'Main headings, in this order:',
      '1. Introduction.',
      '2. Problem statement.',
      '3. Research questions and/or hypotheses.',
      '4. Objectives.',
      '5. Significance (theoretical and applied).',
      '6. Scope and limits: subject, place, time, population.',
      '7. Definitions of key terms, conceptual and operational.',
      '8. Preliminary literature review and previous studies.',
      '9. Methodology: approach, population and sample, instruments, validity and reliability, analysis.',
      '10. Proposed plan of chapters.',
      '11. Timeline: a table of phases against months.',
      'No chapters. ' + THEORETICAL,
    ].join('\n'),
  },
  {
    id: 'graduation',
    label: 'Graduation project',
    about: 'An undergraduate graduation research, in four or five short chapters.',
    triggers: [
      'بحث تخرج', 'بحث التخرج', 'مشروع تخرج', 'مشروع التخرج', 'بحث بكالوريوس',
      'پرۆژەی دەرچوون', 'پرۆژەی دەرچون', 'توێژینەوەی دەرچوون',
      'پرۆژێ دەرچوونێ', 'پروژەیا دەرچوونێ', 'ڤەکولینا دەرچوونێ',
      'graduation project', 'graduation research', 'bachelor thesis', "bachelor's thesis", 'senior project', 'capstone project',
    ],
    rank: 1,
    words: { short: 6000, standard: 9000, long: 13000 },
    sources: 20,
    chapters: true,
    cover: 'thesis',
    dedication: true,
    abstract: 'one',
    contents: true,
    shape: [
      'An undergraduate graduation research project (بحث تخرج). Chapters:',
      'Chapter One — General framework: introduction, problem, questions, objectives, importance, limits, terms.',
      'Chapter Two — Theoretical background and previous studies.',
      'Chapter Three — Methodology and procedures.',
      'Chapter Four — Results and discussion.',
      'Then conclusions and recommendations, as a final main heading.',
      'Simpler and shorter than a thesis. ' + THEORETICAL,
    ].join('\n'),
  },
  {
    id: 'masters',
    label: 'Master’s thesis',
    about: 'A master’s thesis in the five-chapter form Arab and Kurdish universities ask for.',
    triggers: [
      'رسالة ماجستير', 'رسالة الماجستير', 'رسائل الماجستير', 'رسائل ماجستير',
      'رسالة ماستر', 'رسالة الماستر', 'رسائل الماستر', 'اطروحة ماجستير', 'بحث ماجستير',
      'نامەی ماستەر', 'نامەی ماجستێر', 'تێزی ماستەر',
      'نامەیا ماستەرێ', 'نامەیا ماستەر', 'تێزا ماستەرێ',
      "master's thesis", 'masters thesis', 'master thesis', "master's dissertation", 'master dissertation',
      'msc thesis', 'ma thesis', 'thesis',
    ],
    rank: 1,
    words: { short: 15000, standard: 25000, long: 40000 },
    sources: 50,
    chapters: true,
    cover: 'thesis',
    dedication: true,
    abstract: 'both',
    contents: true,
    shape: [
      'A master’s thesis (رسالة ماجستير) in the form used by Arab and Kurdish universities. Chapters:',
      'Chapter One — General framework of the study: introduction; the problem; questions and/or hypotheses;',
      '  objectives; importance, theoretical and applied; limits (subject, place, time, people);',
      '  definitions of terms, conceptual and operational.',
      'Chapter Two — Theoretical framework and previous studies: the framework in several sections;',
      '  previous studies, each summarised (aim, sample, method, findings) — only studies in the source',
      '  list; then a commentary on them: what this study takes from them and how it differs.',
      'Chapter Three — Methodology and procedures: approach, population, sample, instruments,',
      '  validity and reliability, procedures, statistical treatment.',
      'Chapter Four — Presentation and discussion of the results, question by question.',
      'Chapter Five — Conclusions, recommendations, and suggestions for further research.',
      THEORETICAL,
    ].join('\n'),
  },
  {
    id: 'phd',
    label: 'PhD dissertation',
    about: 'A doctoral dissertation: deeper chapters, a critical literature, and a contribution to knowledge.',
    triggers: [
      'أطروحة دكتوراه', 'أطروحة الدكتوراه', 'أطاريح دكتوراه', 'أطاريح الدكتوراه', 'رسالة دكتوراه',
      'رسالة الدكتوراه', 'رسائل الدكتوراه', 'أطروحة', 'الأطروحة', 'أطاريح',
      'نامەی دکتۆرا', 'تێزی دکتۆرا', 'نامەی دکتورا', 'تێزی دکتورا',
      'نامەیا دکتورایێ', 'تێزا دکتورایێ', 'نامەیا دکتۆرایێ',
      'phd thesis', 'phd dissertation', 'doctoral dissertation', 'doctoral thesis', 'dissertation',
    ],
    rank: 1,
    words: { short: 30000, standard: 45000, long: 70000 },
    sources: 80,
    chapters: true,
    cover: 'thesis',
    dedication: true,
    abstract: 'both',
    contents: true,
    shape: [
      'A doctoral dissertation (أطروحة دكتوراه). Deeper than a master’s thesis, and original. Chapters:',
      'Chapter One — Introduction and general framework: as in a master’s thesis, plus the originality',
      '  of the study and its intended contribution to knowledge.',
      'Chapter Two — Theoretical and conceptual framework, in several sections, building toward a model',
      '  or framework the study uses.',
      'Chapter Three — Literature review and previous studies, synthesised critically, ending with the gap.',
      'Chapter Four — Methodology: research philosophy, design, population, sampling, instruments,',
      '  validity, reliability, ethics, analysis.',
      'Chapter Five — Results.',
      'Chapter Six — Discussion: the results against the literature, the contribution to knowledge, implications.',
      'Chapter Seven — Conclusions, recommendations, limitations and future research.',
      THEORETICAL,
    ].join('\n'),
  },
];

/** A kind's spec. */
export function kindOf(id: Kind): KindSpec {
  return KINDS.find((k) => k.id === id) ?? KINDS[0];
}

// ── activation ────────────────────────────────────────────────────────────

/** A letter, a mark or a digit, in any script. `\b` is ASCII-only and never fires inside Arabic. */
const LETTER = /[\p{L}\p{M}\p{N}]/u;

/** Letters that attach to the next word in Arabic — and, in, by, for, like. */
const PROCLITIC = new Set(['\u0648', '\u0641', '\u0628', '\u0644', '\u06A9']);

/**
 * Folded for matching, and what else the app's fold leaves apart.
 *
 * `fold` is the app's answer to "is this the same word" and is used as it is.
 * Two things it does not do matter here: a curly apostrophe is what a phone
 * types in "master’s", and Kurdish ە is written ه on an Arabic keyboard.
 */
function folded(s: string): string {
  return fold(s).replace(/[\u2019\u2018\u02BC]/g, "'").replace(/\u06D5/g, '\u0647').replace(/\s+/g, ' ');
}

/** Every trigger, folded once. */
const PHRASES = KINDS.flatMap((k) => k.triggers.map((p) => ({ kind: k, trigger: p, phrase: folded(p) })));

/** Whether a phrase at `at` in `text` stands on its own rather than inside a longer word. */
function standsAlone(text: string, at: number, len: number): boolean {
  const after = text[at + len];
  if (after !== undefined && LETTER.test(after)) return false;
  if (at === 0) return true;
  const before = text[at - 1];
  if (!LETTER.test(before)) return true;
  // وورقة عمل, بأطروحة: one attached letter, itself at the start of a word.
  return PROCLITIC.has(before) && (at === 1 || !LETTER.test(text[at - 2]));
}

export interface Detected {
  kind: Kind;
  /** The phrase that activated it, as the catalogue spells it — for showing. */
  trigger: string;
  /** The same, folded — what was matched. */
  phrase: string;
  /** Where in the folded text. */
  index: number;
}

/**
 * Which skill a request activates, or `null` when it names none.
 *
 * Every trigger that stands on its own is found. The highest-ranked kind wins,
 * then the longest phrase — "أطروحة ماجستير" is a master's thesis, not a
 * dissertation because it contains أطروحة — then the earliest.
 */
export function detect(text: string): Detected | null {
  const hay = folded(typeof text === 'string' ? text : '');
  if (!hay.trim()) return null;
  let best: (Detected & { rank: number }) | null = null;
  for (const { kind, trigger, phrase } of PHRASES) {
    for (let at = hay.indexOf(phrase); at !== -1; at = hay.indexOf(phrase, at + 1)) {
      if (!standsAlone(hay, at, phrase.length)) continue;
      const better = !best
        || kind.rank > best.rank
        || (kind.rank === best.rank && phrase.length > best.phrase.length)
        || (kind.rank === best.rank && phrase.length === best.phrase.length && at < best.index);
      if (better) best = { kind: kind.id, trigger, phrase, index: at, rank: kind.rank };
      break;
    }
  }
  return best && { kind: best.kind, trigger: best.trigger, phrase: best.phrase, index: best.index };
}

/**
 * The names a style goes by in a request, in every script it is typed in.
 * Folded when the table is built, like the triggers, so a name typed with
 * Arabic or Kurdish letters matches either way.
 */
const STYLE_NAMES: readonly (readonly [Style, readonly string[]])[] = [
  ['footnotes', ['footnotes', 'footnote', 'هوامش', 'الهوامش', 'بالهوامش', 'پەراوێز', 'پەراوێزەکان', 'پەراوێزان']],
  ['apa', ['apa', 'ای پی ای', 'ئەی پی ئەی']],
  ['harvard', ['harvard', 'هارفارد', 'هارڤارد']],
  ['chicago', ['chicago', 'شیکاغو', 'شیکاگو']],
  ['mla', ['mla']],
  ['ieee', ['ieee']],
];

const STYLE_RES = STYLE_NAMES.map(([style, names]) => [
  style,
  new RegExp(`(^|[^\\p{L}])(${names.map((n) => folded(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})([^\\p{L}]|$)`, 'u'),
] as const);

/** A citation style named in a request — "APA", "هارفارد", "بالهوامش" — or `null`. */
export function styleIn(text: string): Style | null {
  const s = folded(typeof text === 'string' ? text : '');
  for (const [style, re] of STYLE_RES) if (re.test(s)) return style;
  return null;
}

/** Letters only Kurdish writes. */
const KURDISH = /[\u0695\u06B5\u06CE\u06C6\u06D5\u06A4\u06C7]/;
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/**
 * Words that are Badini and not Sorani, and the other way round — enough to
 * tell a request apart, no more. Folded, like the words they are compared
 * with, so a Badini request typed on an Arabic keyboard is still Badini.
 */
const BADINI = new Set(['ژ', 'د', 'دڤێت', 'دڤێ', 'ئەز', 'دەربارێ', 'ڤێ', 'ڤی', 'ژبۆ', 'دکەت', 'چێبکە', 'بنڤیسە'].map(folded));
const SORANI = new Set(['لە', 'دەمەوێت', 'دەمەوێ', 'دەربارەی', 'لەسەر', 'بۆم', 'ئەمە', 'دەکات', 'بنووسە', 'دروستبکە'].map(folded));

/**
 * The language a request is written in, which is the language the document
 * will be — somebody who asks in Sorani wants a Sorani thesis.
 *
 * Kurdish is told from Arabic by the letters only Kurdish has, and Badini from
 * Sorani by a handful of words each uses and the other does not. A Kurdish
 * request too short to tell is Sorani, and one with no letters at all is
 * `fallback`. The panel shows the guess, and it can be changed.
 */
export function docLangOf(text: string, fallback: DocLang = 'en'): DocLang {
  const s = typeof text === 'string' ? text : '';
  if (!ARABIC_SCRIPT.test(s)) return /\p{L}/u.test(s) ? 'en' : fallback;
  const w = s.split(/[^\p{L}\p{M}]+/u).filter(Boolean).map(folded);
  const badini = w.filter((x) => BADINI.has(x)).length + (s.match(/\u06A4/g)?.length ?? 0);
  const sorani = w.filter((x) => SORANI.has(x)).length + (s.match(/[\u0695\u06B5]/g)?.length ?? 0) / 2;
  // Arabic letters and no Kurdish ones is Arabic, unless the words say it is
  // Badini typed on an Arabic keyboard.
  if (!KURDISH.test(s)) return badini >= 2 && badini > sorani ? 'kmr' : 'ar';
  return badini > sorani ? 'kmr' : 'ckb';
}

// ── fixed words of a document ─────────────────────────────────────────────

/**
 * The words every document of a language uses the same way — headings the
 * app writes rather than the model, and the statement under a thesis title.
 *
 * `statement` is a list of pieces, and a piece that names a field the
 * researcher left empty is dropped whole: "submitted to the Council of {college}"
 * with no college is not a sentence worth printing half of.
 */
export interface Words {
  abstract: string;
  keywords: string;
  contents: string;
  references: string;
  /** The first group of an Arabic-script document's reference list: works in Arabic script. */
  local: string;
  /** The second: everything else. */
  foreign: string;
  dedication: string;
  thanks: string;
  /** Before the author's name when a statement above it already said what the document is. */
  by: string;
  /** Before the author's name when nothing did: "ورقة عمل مقدمة من قبل". */
  byline: Readonly<Record<Kind, string>>;
  supervisor: string;
  /**
   * The marks after the two years at the foot of a cover: ١٤٤٨هـ and ٢٠٢٦م in
   * Arabic, the Kurdish and the common year in Kurdish. Empty in English,
   * whose cover carries the city and one year.
   */
  calendar: { local: string; common: string };
  /** What stands in a dedication page until the researcher writes one. */
  holeDedication: string;
  holeThanks: string;
  statement: Readonly<Record<Kind, readonly string[]>>;
}

export const WORDS: Readonly<Record<DocLang, Words>> = {
  ar: {
    abstract: 'المستخلص',
    keywords: 'الكلمات المفتاحية',
    contents: 'المحتويات',
    references: 'قائمة المصادر',
    local: 'أولاً: المصادر العربية',
    foreign: 'ثانياً: المصادر الأجنبية',
    dedication: 'الإهداء',
    thanks: 'الشكر والتقدير',
    by: 'من قبل',
    byline: {
      'working-paper': 'ورقة عمل مقدمة من قبل', article: 'بحث مقدم من قبل', conference: 'بحث مقدم من قبل', review: 'بحث مقدم من قبل',
      proposal: 'خطة بحث مقدمة من قبل', graduation: 'بحث تخرج مقدم من قبل', masters: 'رسالة مقدمة من قبل', phd: 'أطروحة مقدمة من قبل',
    },
    supervisor: 'بإشراف',
    calendar: { local: 'هـ', common: 'م' },
    holeDedication: '[اكتب الإهداء هنا]',
    holeThanks: '[اكتب كلمة الشكر والتقدير هنا]',
    statement: {
      'working-paper': ['ورقة عمل مقدمة إلى {venue}'],
      article: ['بحث مقدم للنشر في {venue}'],
      conference: ['بحث مقدم إلى {venue}'],
      review: ['بحث مقدم للنشر في {venue}'],
      proposal: ['خطة بحث مقدمة إلى {department}', 'في {college}', '، {university}'],
      graduation: ['بحث تخرج مقدم إلى {department}', 'في {college}', '، {university}', '، وهو جزء من متطلبات نيل درجة البكالوريوس', 'في {field}'],
      masters: ['رسالة مقدمة إلى مجلس {college}', 'في {university}', '، وهي جزء من متطلبات نيل درجة الماجستير', 'في {field}'],
      phd: ['أطروحة مقدمة إلى مجلس {college}', 'في {university}', '، وهي جزء من متطلبات نيل درجة الدكتوراه', 'في {field}'],
    },
  },
  ckb: {
    abstract: 'پوختە',
    keywords: 'وشە سەرەکییەکان',
    contents: 'ناوەڕۆک',
    references: 'لیستی سەرچاوەکان',
    local: 'یەکەم: سەرچاوە کوردی و عەرەبییەکان',
    foreign: 'دووەم: سەرچاوە بیانییەکان',
    dedication: 'پێشکەشکردن',
    thanks: 'سوپاس و پێزانین',
    by: 'لەلایەن',
    byline: {
      'working-paper': 'وەرەقەی کار پێشکەشکراوە لەلایەن', article: 'توێژینەوە پێشکەشکراوە لەلایەن', conference: 'توێژینەوە پێشکەشکراوە لەلایەن', review: 'توێژینەوە پێشکەشکراوە لەلایەن',
      proposal: 'پلانی توێژینەوە پێشکەشکراوە لەلایەن', graduation: 'پرۆژەی دەرچوون پێشکەشکراوە لەلایەن', masters: 'نامە پێشکەشکراوە لەلایەن', phd: 'نامە پێشکەشکراوە لەلایەن',
    },
    supervisor: 'بە سەرپەرشتیی',
    calendar: { local: 'ک', common: 'ز' },
    holeDedication: '[پێشکەشکردن لێرە بنووسە]',
    holeThanks: '[سوپاس و پێزانین لێرە بنووسە]',
    statement: {
      'working-paper': ['وەرەقەی کارە پێشکەش بە {venue} کراوە'],
      article: ['توێژینەوەیەکە بۆ بڵاوکردنەوە لە {venue}'],
      conference: ['توێژینەوەیەکە پێشکەش بە {venue} کراوە'],
      review: ['توێژینەوەیەکە بۆ بڵاوکردنەوە لە {venue}'],
      proposal: ['پلانی توێژینەوەیە پێشکەش بە {department} کراوە', 'لە {college}', '، {university}'],
      graduation: ['پرۆژەی دەرچوونە پێشکەش بە {department} کراوە', 'لە {college}', '، {university}', '، وەک بەشێک لە پێداویستییەکانی بەدەستهێنانی بڕوانامەی بەکالۆریۆس', 'لە {field}'],
      masters: ['نامەیەکە پێشکەش بە ئەنجومەنی {college} کراوە', 'لە {university}', '، وەک بەشێک لە پێداویستییەکانی بەدەستهێنانی بڕوانامەی ماستەر', 'لە {field}'],
      phd: ['نامەیەکە پێشکەش بە ئەنجومەنی {college} کراوە', 'لە {university}', '، وەک بەشێک لە پێداویستییەکانی بەدەستهێنانی بڕوانامەی دکتۆرا', 'لە {field}'],
    },
  },
  kmr: {
    abstract: 'پوختە',
    keywords: 'پەیڤێن سەرەکی',
    contents: 'ناڤەڕۆک',
    references: 'لیستا ژێدەران',
    local: 'ئێک: ژێدەرێن کوردی و عەرەبی',
    foreign: 'دوو: ژێدەرێن بیانی',
    dedication: 'پێشکێشکرن',
    thanks: 'سوپاس و پێزانین',
    by: 'ژ لایێ',
    byline: {
      'working-paper': 'وەرەقا کاری پێشکێشکری ژ لایێ', article: 'ڤەکولین پێشکێشکری ژ لایێ', conference: 'ڤەکولین پێشکێشکری ژ لایێ', review: 'ڤەکولین پێشکێشکری ژ لایێ',
      proposal: 'پلانا ڤەکولینێ پێشکێشکری ژ لایێ', graduation: 'پرۆژێ دەرچوونێ پێشکێشکری ژ لایێ', masters: 'نامە پێشکێشکری ژ لایێ', phd: 'نامە پێشکێشکری ژ لایێ',
    },
    supervisor: 'ب سەرپەرشتیا',
    calendar: { local: 'ک', common: 'ز' },
    holeDedication: '[پێشکێشکرنێ ل ڤێرە بنڤیسە]',
    holeThanks: '[سوپاس و پێزانینێ ل ڤێرە بنڤیسە]',
    statement: {
      'working-paper': ['وەرەقا کاری یە پێشکێشی {venue} کری'],
      article: ['ڤەکولینەکە بۆ بەلاڤکرنێ د {venue} دا'],
      conference: ['ڤەکولینەکە پێشکێشی {venue} کری'],
      review: ['ڤەکولینەکە بۆ بەلاڤکرنێ د {venue} دا'],
      proposal: ['پلانا ڤەکولینێ یە پێشکێشی {department} کری', 'ل {college}', '، {university}'],
      graduation: ['پرۆژێ دەرچوونێ یە پێشکێشی {department} کری', 'ل {college}', '، {university}', '، وەک پشکەک ژ پێدڤیێن بدەستڤەئینانا بڕوانامەیا بەکالۆریۆسێ', 'د {field} دا'],
      masters: ['نامەیەکە پێشکێشی ئەنجومەنا {college} کری', 'ل {university}', '، وەک پشکەک ژ پێدڤیێن بدەستڤەئینانا بڕوانامەیا ماستەرێ', 'د {field} دا'],
      phd: ['نامەیەکە پێشکێشی ئەنجومەنا {college} کری', 'ل {university}', '، وەک پشکەک ژ پێدڤیێن بدەستڤەئینانا بڕوانامەیا دکتورایێ', 'د {field} دا'],
    },
  },
  en: {
    abstract: 'Abstract',
    keywords: 'Keywords',
    contents: 'Contents',
    references: 'References',
    local: 'Sources in Arabic script',
    foreign: 'Other sources',
    dedication: 'Dedication',
    thanks: 'Acknowledgements',
    by: 'By',
    byline: {
      'working-paper': 'A working paper presented by', article: 'A paper by', conference: 'A paper presented by', review: 'A paper by',
      proposal: 'A research proposal by', graduation: 'A graduation project by', masters: 'A thesis by', phd: 'A dissertation by',
    },
    supervisor: 'Supervised by',
    calendar: { local: '', common: '' },
    holeDedication: '[Write your dedication here]',
    holeThanks: '[Write your acknowledgements here]',
    statement: {
      'working-paper': ['A working paper presented to {venue}'],
      article: ['A paper submitted for publication in {venue}'],
      conference: ['A paper presented to {venue}'],
      review: ['A paper submitted for publication in {venue}'],
      proposal: ['A research proposal submitted to {department}', ', {college}', ', {university}'],
      graduation: ['A graduation project submitted to {department}', ', {college}', ', {university}', ', in partial fulfilment of the requirements for the degree of Bachelor', 'in {field}'],
      masters: ['A thesis submitted to the Council of {college}', 'at {university}', 'in partial fulfilment of the requirements for the degree of Master', 'in {field}'],
      phd: ['A dissertation submitted to the Council of {college}', 'at {university}', 'in partial fulfilment of the requirements for the degree of Doctor of Philosophy', 'in {field}'],
    },
  },
};

/**
 * The statement under a document's title, with the pieces whose fields are
 * empty left out. Empty when its first piece — what was submitted, to whom —
 * is gone, because the rest says nothing without it.
 *
 * Pieces carry their own commas and are joined with spaces, because where a
 * comma belongs is a matter of each language's grammar, not of the join.
 */
export function statementOf(doc: Pick<Doc, 'kind' | 'lang' | 'meta'>): string {
  const meta = doc.meta as unknown as Record<string, string | undefined>;
  const filled = WORDS[doc.lang].statement[doc.kind].map((piece) => {
    let whole = true;
    const out = piece.replace(/\{(\w+)\}/g, (_, k: string) => {
      const v = (meta[k] ?? '').trim();
      if (!v) whole = false;
      return v;
    });
    return whole ? out : null;
  });
  if (!filled[0]) return '';
  return filled.filter((p): p is string => p !== null).join(' ').replace(/ ([،,])/g, '$1');
}

/**
 * The line above the author's name on the cover.
 *
 * What the researcher typed, when they typed one; otherwise "من قبل" under a
 * statement that already said what the document is, or the kind's own phrase
 * — "ورقة عمل مقدمة من قبل" — when nothing did.
 */
export function bylineOf(doc: Pick<Doc, 'kind' | 'lang' | 'meta'>): string {
  const typed = (doc.meta.presented ?? '').trim();
  if (typed) return typed;
  const w = WORDS[doc.lang];
  return statementOf(doc) ? w.by : w.byline[doc.kind];
}

/**
 * The year in the Islamic calendar.
 *
 * The engine's Umm al-Qura calendar when it has one, and otherwise the mean
 * length of the Islamic year counted from its epoch — which can be a year out
 * for a few days either side of Muharram, and is only ever the fallback.
 */
export function hijriYear(at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { year: 'numeric', timeZone: 'UTC' }).formatToParts(at);
    const y = Number.parseInt(parts.find((p) => p.type === 'year')?.value ?? '', 10);
    if (y > 1300 && y < 1700) return y;
  } catch { /* an engine without the Islamic calendars */ }
  const days = at.getTime() / 86_400_000 + 492_148;
  return Math.floor(days / 354.36667) + 1;
}

/**
 * The two dates at the foot of a cover, the one on the reading side first.
 *
 * Arabic prints the Hijri year and the Gregorian, as Iraqi university covers
 * do. Kurdish prints the Kurdish year,
 * which turns at Newroz, and the Gregorian. English prints the city and the
 * year. The year is the one on the cover field when it is a number, so a
 * thesis finished in January can say the year it was submitted.
 */
export function yearsOf(doc: Pick<Doc, 'lang' | 'meta' | 'created'>): { start: string; end: string } {
  const made = new Date(doc.created);
  const typed = Number.parseInt(doc.meta.year, 10);
  const common = Number.isFinite(typed) && typed > 0 ? typed : made.getUTCFullYear();
  // A year other than the one it was made in is dated from the middle of it.
  const at = common === made.getUTCFullYear() ? made : new Date(Date.UTC(common, 6, 1));
  const cal = WORDS[doc.lang].calendar;
  if (doc.lang === 'ar') return { start: `${hijriYear(at)}${cal.local}`, end: `${common}${cal.common}` };
  if (doc.lang === 'ckb' || doc.lang === 'kmr') {
    const newroz = Date.UTC(common, 2, 21);
    return { start: `${common + (at.getTime() >= newroz ? 700 : 699)}${cal.local}`, end: `${common}${cal.common}` };
  }
  return { start: doc.meta.city.trim(), end: String(common) };
}

const EASTERN = '٠١٢٣٤٥٦٧٨٩';

const LATIN = /[A-Za-z\u00C0-\u024F]/;
const ARABIC_LETTER = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * Text with its digits in the document's own numerals.
 *
 * Arabic and Kurdish print ١٢٣ unless the researcher chose otherwise. Each run
 * of digits follows the script of the nearest letter before it — after it,
 * when nothing comes before — so "عام 2024" becomes عام ٢٠٢٤ while "SPSS 29",
 * an English reference's (2020) and a DOI's 10.1000/xyz keep their digits: a
 * DOI in Eastern digits is not a DOI any more, and an English citation inside
 * an Arabic thesis is still written the English way. Digits with no letter
 * anywhere near them are the document's own. This is the rule the Word file
 * follows too, so the reader and the file print the same numbers.
 */
export function localDigits(text: string, doc: Pick<Doc, 'lang' | 'digits'>): string {
  if (doc.lang === 'en' || doc.digits === 'western' || !/[0-9]/.test(text)) return text;
  const chars = Array.from(text);
  const side = (from: number, step: 1 | -1): 'L' | 'R' | null => {
    for (let i = from; i >= 0 && i < chars.length; i += step) {
      if (LATIN.test(chars[i])) return 'L';
      if (ARABIC_LETTER.test(chars[i]) && !/[\u0660-\u0669\u06F0-\u06F9]/.test(chars[i])) return 'R';
    }
    return null;
  };
  let out = '';
  for (let i = 0; i < chars.length;) {
    if (!/[0-9]/.test(chars[i])) { out += chars[i++]; continue; }
    let j = i;
    while (j < chars.length && /[0-9]/.test(chars[j])) j++;
    const run = chars.slice(i, j).join('');
    const by = side(i - 1, -1) ?? side(j, 1) ?? 'R';
    out += by === 'L' ? run : run.replace(/[0-9]/g, (d) => EASTERN[d.charCodeAt(0) - 48]);
    i = j;
  }
  return out;
}

// ── a new document ────────────────────────────────────────────────────────

export const EMPTY_META: Meta = {
  title: '', titleEn: '', author: '', presented: '', supervisor: '', supervisorTitle: '', authority: '',
  university: '', college: '', department: '', field: '', venue: '', city: '', year: '',
};

// ── universities, and their logos ─────────────────────────────────────────

/**
 * Universities a researcher is likely to be writing for, by the name their
 * covers print — Iraq's public universities and the Kurdistan Region's, in
 * Arabic, Sorani and English. A list to choose from, not a rule: any name can
 * be typed.
 */
export const UNIVERSITIES: readonly string[] = [
  'جامعة بغداد', 'الجامعة المستنصرية', 'الجامعة التكنولوجية', 'جامعة النهرين', 'جامعة الموصل', 'جامعة البصرة',
  'جامعة الكوفة', 'جامعة بابل', 'جامعة تكريت', 'جامعة الأنبار', 'جامعة ديالى', 'جامعة كربلاء', 'جامعة واسط',
  'جامعة القادسية', 'جامعة ذي قار', 'جامعة ميسان', 'جامعة المثنى', 'جامعة كركوك', 'جامعة سامراء', 'جامعة الفلوجة',
  'جامعة نينوى', 'جامعة الحمدانية', 'جامعة تلعفر', 'جامعة الفرات الأوسط التقنية', 'الجامعة التقنية الوسطى',
  'الجامعة التقنية الشمالية', 'الجامعة التقنية الجنوبية', 'الجامعة العراقية', 'جامعة صلاح الدين', 'جامعة السليمانية',
  'جامعة دهوك', 'جامعة كويه', 'جامعة زاخو', 'جامعة كرميان', 'جامعة حلبجة', 'جامعة رابرين', 'جامعة سوران',
  'جامعة أربيل التقنية', 'جامعة السليمانية التقنية', 'جامعة دهوك التقنية',
  'زانکۆی سەلاحەددین', 'زانکۆی سلێمانی', 'زانکۆی دهۆک', 'زانکۆی کۆیە', 'زانکۆی زاخۆ', 'زانکۆی گەرمیان',
  'زانکۆی هەڵەبجە', 'زانکۆی ڕاپەڕین', 'زانکۆی سۆران', 'زانکۆی پۆلیتەکنیکی هەولێر', 'زانکۆی پۆلیتەکنیکی سلێمانی',
  'زانکۆی پۆلیتەکنیکی دهۆک', 'زانکۆیا دهۆکێ', 'زانکۆیا زاخۆ',
  'University of Baghdad', 'University of Mosul', 'University of Basrah', 'University of Kufa', 'University of Babylon',
  'Tikrit University', 'Salahaddin University-Erbil', 'University of Sulaimani', 'University of Duhok', 'Koya University',
  'University of Zakho', 'University of Garmian', 'University of Halabja', 'Soran University', 'University of Raparin',
  'Erbil Polytechnic University', 'Sulaimani Polytechnic University', 'Duhok Polytechnic University',
  'University of Kurdistan Hewlêr', 'American University of Kurdistan', 'The American University of Iraq, Sulaimani',
];

/** Where the logos are kept: one per university, and one for covers that name none. */
export const LOGO_KEY = 'vylo.research.logo.v1';

/** Logos by university, the key being the university's name folded — so جامعة دهوك and جامعه دهوك are one. */
export type Logos = Readonly<Record<string, string>>;

const logoKey = (university: string) => folded(university.trim());

/**
 * The saved logos, from storage. The first version kept one logo as a bare
 * data URL, and it was the logo of whichever university the profile named;
 * `university` is that name, so the logo stays with it.
 */
export function readLogos(raw: string | null, university = ''): Logos {
  if (!raw) return {};
  if (raw.startsWith('data:image/')) return /^data:image\/(png|jpeg);base64,/.test(raw) ? { [logoKey(university)]: raw } : {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, url] of Object.entries(v)) {
      if (typeof url === 'string' && /^data:image\/(png|jpeg);base64,/.test(url)) out[k] = url;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The logo for a university: its own, and nothing when it has none. Another
 * university's logo on a cover is worse than no logo; the one kept for covers
 * that name no university is only for those.
 */
export function logoFor(logos: Logos, university: string): string {
  return logos[logoKey(university)] ?? '';
}

/**
 * How many logos are kept, and how much they may weigh together. They share
 * the browser's storage with the chats, and a supervisor who prepares covers
 * for every university they examine at would otherwise crowd the chats out.
 */
export const LOGO_LIBRARY = { count: 8, bytes: 1_600_000 } as const;

/**
 * The logos with this university's set — or taken away, when `url` is empty.
 * The one just set goes last, and the oldest go first when the library is
 * over its limits.
 */
export function withLogo(logos: Logos, university: string, url: string): Logos {
  const key = logoKey(university);
  const next: Record<string, string> = { ...logos };
  delete next[key];
  if (url) next[key] = url;
  const keys = Object.keys(next);
  let bytes = keys.reduce((n, k) => n + next[k].length, 0);
  let count = keys.length;
  for (const k of keys) {
    if (k === key || (count <= LOGO_LIBRARY.count && bytes <= LOGO_LIBRARY.bytes)) break;
    bytes -= next[k].length;
    count -= 1;
    delete next[k];
  }
  return next;
}

/** The cover fields a researcher fills once and keeps: who they are, and where. */
export type Profile = Pick<Meta, 'author' | 'supervisor' | 'supervisorTitle' | 'authority' | 'university' | 'college' | 'department' | 'field' | 'city'>;

export const PROFILE_KEY = 'vylo.research.profile.v1';

/** A saved profile, or an empty one. Never throws on what is in storage. */
export function readProfile(raw: string | null): Profile {
  const out: Profile = {
    author: '', supervisor: '', supervisorTitle: '', authority: '', university: '', college: '', department: '', field: '', city: '',
  };
  try {
    const v = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    for (const k of Object.keys(out) as (keyof Profile)[]) {
      if (typeof v[k] === 'string') out[k] = (v[k] as string).slice(0, 400);
    }
  } catch { /* nothing kept, or not ours */ }
  return out;
}

/**
 * A document for a request, with the skill it activated, the language it was
 * asked in, and a style when one was named. Nothing is written yet.
 */
export function newDoc(o: {
  id: string;
  now: number;
  request: string;
  kind?: Kind;
  lang?: DocLang;
  style?: Style;
  length?: Length;
  meta?: Partial<Meta>;
  notes?: string;
  pause?: boolean;
  fallbackLang?: DocLang;
  logo?: string;
}): Doc {
  const request = o.request.trim();
  const year = String(new Date(o.now).getFullYear());
  const lang = o.lang ?? docLangOf(request, o.fallbackLang);
  return {
    id: o.id,
    v: 1,
    created: o.now,
    updated: o.now,
    request,
    kind: o.kind ?? detect(request)?.kind ?? 'article',
    lang,
    style: o.style ?? styleIn(request) ?? (lang === 'en' ? 'apa' : 'footnotes'),
    length: o.length ?? 'standard',
    meta: { ...EMPTY_META, year, ...o.meta },
    notes: o.notes ?? '',
    queries: [],
    sources: [],
    sections: [],
    abstract: '',
    abstractEn: '',
    keywords: [],
    keywordsEn: [],
    stage: 'new',
    pause: o.pause ?? false,
    digits: lang === 'en' ? 'western' : 'eastern',
    ...(o.logo ? { logo: o.logo } : {}),
  };
}

/** The limits on what a researcher may set, and what a mistyped number is brought back to. */
export const LIMITS = {
  words: { min: 500, max: 150_000 },
  sources: { min: 0, max: 200 },
  agents: { min: 1, max: 8 },
} as const;

/** A number the researcher typed, as a whole number inside its limits; `null` when it is not a number at all. */
export function clampTo(value: unknown, limit: { min: number; max: number }): number | null {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(limit.max, Math.max(limit.min, Math.round(n)));
}

/** The words a document should come to, all sections together: the number the researcher set, or its kind's length. */
export function targetWords(doc: Pick<Doc, 'kind' | 'length'> & Partial<Pick<Doc, 'words'>>): number {
  const set = doc.words ? clampTo(doc.words, LIMITS.words) : null;
  return set ?? kindOf(doc.kind).words[doc.length];
}

/** The references to look for: the number the researcher set, or one scaled a little with the length. */
export function targetSources(doc: Pick<Doc, 'kind' | 'length'> & Partial<Pick<Doc, 'sourcesWanted'>>): number {
  if (doc.sourcesWanted !== undefined) return clampTo(doc.sourcesWanted, LIMITS.sources) ?? 0;
  const n = kindOf(doc.kind).sources;
  return doc.length === 'short' ? Math.round(n * 0.7) : doc.length === 'long' ? Math.round(n * 1.3) : n;
}

/** How many writers a document runs with, from one to the limit. */
export function agentsOf(doc: Partial<Pick<Doc, 'agents'>>): number {
  return clampTo(doc.agents ?? 1, LIMITS.agents) ?? 1;
}

/**
 * Pages a number of words comes to, roughly, as the Word file sets them: an
 * A4 page at 14 point with line-and-a-half spacing holds about 250 words of
 * Arabic or Kurdish and 300 of English at 12 point.
 */
export function pagesFor(words: number, lang: DocLang): number {
  return Math.max(1, Math.round(words / (lang === 'en' ? 300 : 250)));
}

/** How much of the researcher's files each kind of request carries, in characters. */
export const DATA_BUDGET = { plan: 3_000, outline: 16_000, section: 24_000 } as const;

/**
 * The researcher's files as the model reads them, inside a budget.
 *
 * The budget is shared out so a small file is never cut to make room for a
 * large one: each file in turn, smallest first, gets an equal share of what is
 * left. A file that had to be cut says so, because a model that believes it
 * has the whole survey will write about the part it never saw.
 */
export function dataBlock(files: readonly DataFile[] | undefined, budget: number): string {
  const list = (files ?? []).filter((f) => f.text.trim());
  if (!list.length || budget <= 0) return '';
  const share = new Map<string, number>();
  let left = budget;
  const bySize = [...list].sort((a, b) => a.text.length - b.text.length);
  bySize.forEach((f, i) => {
    const give = Math.min(f.text.length, Math.floor(left / (bySize.length - i)));
    share.set(f.id, give);
    left -= give;
  });
  const parts = list.map((f) => {
    const n = share.get(f.id) ?? 0;
    const cut = n < f.text.length || f.truncated;
    return `--- ${f.name}${cut ? ' (only its beginning is shown here)' : ''} ---\n${f.text.slice(0, n)}`;
  });
  return [
    'The researcher\'s own data files. They are the only data this document may report: use their figures exactly as given, and do not extend them to anything they do not contain.',
    ...parts,
    '--- end of the data files ---',
  ].join('\n');
}

/**
 * Output tokens to allow for a section of `words` words.
 *
 * Arabic-script text costs roughly twice the tokens per word English does,
 * and a model that thinks before it writes spends from the same allowance, so
 * the headroom is generous. The transport lowers it to what the model allows;
 * a section that still runs out is continued, not cut.
 */
export function tokensFor(words: number, lang: DocLang): number {
  const perWord = lang === 'en' ? 1.6 : 3.2;
  return Math.round(Math.max(400, words) * perWord) + 8000;
}

// ── what the model is told ────────────────────────────────────────────────

const LANGUAGE: Readonly<Record<DocLang, string>> = {
  ar: 'Write in Modern Standard Arabic (الفصحى), in the formal academic register of Arab universities.',
  ckb: 'Write in Central Kurdish (Sorani), in the Kurdish Arabic-based alphabet and the formal academic register of universities in the Kurdistan Region. Use the Kurdish letters (ی ک ە ێ ۆ ڕ ڵ), never Arabic substitutes for them.',
  kmr: 'Write in Northern Kurdish (Kurmanji, the Badini dialect), in the Kurdish Arabic-based alphabet and the formal academic register of the University of Duhok. Use the Kurdish letters (ی ک ە ێ ۆ ڤ), never Arabic substitutes for them.',
  en: 'Write in formal academic English.',
};

/** How subheadings are numbered in each language's academic writing. */
const ORDINAL_EXAMPLE: Readonly<Record<DocLang, string>> = {
  ar: '"### أولاً: …", "### ثانياً: …"',
  ckb: '"### یەکەم: …", "### دووەم: …"',
  kmr: '"### ئێک: …", "### دوو: …"',
  en: '',
};

/**
 * How the parts of a document are named, in the languages whose universities
 * have a convention of their own. Arabic writing in law, Sharia and the
 * humanities divides into مبحث, مطلب and فرع under chapters; a model left to
 * itself writes "Section 1.2", and an Iraqi examiner reads that as a
 * translation. Taken from an Iraqi law faculty's working paper the owner sent
 * as the model to follow.
 */
const HIERARCHY: Readonly<Record<DocLang, string>> = {
  ar: [
    'Name the parts as Arab universities do. The first part is "المقدمة" and the last "الخاتمة".',
    'In law, Sharia and the humanities, divide the body into مباحث and each مبحث into مطالب, and a مطلب into فروع where the argument divides further; a thesis has فصول above the مباحث. Number them with ordinal words: "الفصل الأول: …", "المبحث الأول: …", "المطلب الثاني: …", "الفرع الأول: …".',
    'In the sciences and the social sciences use the chapter and section names of the shape above, in Arabic.',
    'Points numbered أولاً، ثانياً… inside a part are "### " subheadings written in its text, not parts of the outline.',
  ].join('\n'),
  ckb: [
    'Name the parts as universities in the Kurdistan Region do. The first part is "پێشەکی" and the last "ئەنجام".',
    'In law, Sharia and the humanities, divide the body into باس (باسی یەکەم…) and each باس into تەوەر; a thesis has بەش above them. Number them with ordinal words.',
    'Points numbered یەکەم، دووەم… inside a part are "### " subheadings written in its text, not parts of the outline.',
  ].join('\n'),
  kmr: [
    'Name the parts as the University of Duhok does. The first part is "پێشەکی" and the last "ئەنجام".',
    'In law, Sharia and the humanities, divide the body into باس (باسێ ئێکێ…) and each باس into تەوەر; a thesis has پشک above them. Number them with ordinal words.',
    'Points numbered ئێک، دوو… inside a part are "### " subheadings written in its text, not parts of the outline.',
  ].join('\n'),
  en: '',
};

const LANGUAGE_NAME: Readonly<Record<DocLang, string>> = {
  ar: 'Arabic', ckb: 'Central Kurdish (Sorani)', kmr: 'Northern Kurdish (Badini)', en: 'English',
};

/**
 * What the model is, for every request a document makes.
 *
 * The rules are the reason the module exists, so they are said in full every
 * time rather than trusted to carry over: cite only through markers, invent no
 * data, and write only the part that was asked for.
 */
export function systemFor(doc: Pick<Doc, 'kind' | 'lang'> & Partial<Pick<Doc, 'voice'>>): string {
  const k = kindOf(doc.kind);
  return [
    `You are an experienced academic writer and research supervisor, helping a researcher write a ${k.label.toLowerCase()} in ${LANGUAGE_NAME[doc.lang]}.`,
    LANGUAGE[doc.lang],
    '',
    'Rules that are never broken:',
    '',
    '1. Sources. Cite only the sources you are given, and only with their markers, exactly like [@s3] or [@s3; @s7], placed where the claim is made. Never write a citation any other way: no author and year in brackets, no footnote numbers, no reference list. The app formats every citation — as footnotes or in the text, in the researcher\'s style — and builds the reference list itself, from the records. Never mention a study, author, book, statistic or date that is not in the sources you were given. If the argument needs evidence you do not have, make the point without attributing it, or leave a gap for the researcher.',
    '',
    '   Legislation in the list (a constitution, a law, a regulation, instructions, a decision) is cited the same way, with the article after a comma: [@s2, المادة ١٣/ثانياً]. A locator is only ever an article or paragraph of legislation, or a page the researcher gave you: never invent a page number. Never put words in quotation marks as the text of a law or a source unless you were given those exact words; say what it provides instead.',
    '',
    '2. Data. Never invent data: no survey results, samples, statistics, percentages, interview quotations, participants, scores, dates of fieldwork, or findings of the researcher\'s own study. Where the document needs them, write a gap in double square brackets saying exactly what the researcher must put there, such as [[Table: the mean and standard deviation of each axis of the questionnaire]]. Use the researcher\'s notes and data when they are given, and only as given.',
    '',
    '3. Format. Plain paragraphs separated by a blank line. "### " for a subheading inside the section and "#### " below that. "- " for a bulleted list and "1. " for a numbered one. **Bold** sparingly, for a term being defined. A table only where it genuinely compares things, as a pipe table with a header row. No other markdown, no code blocks, no horizontal rules.' + (doc.lang === 'en' ? '' : ' Number subheadings with ordinal words, the way Arab and Kurdish universities do — ' + ORDINAL_EXAMPLE[doc.lang] + '.'),
    '',
    '4. Voice. Scholarly, precise and cohesive; every paragraph earns its place. Do not repeat the heading you were given. Do not talk about yourself or the writing. Do not end every section by summarising the whole document.',
    ...voiceRules(doc.voice, doc.lang),
  ].join('\n');
}

/** The most of a voice's passages that goes into every request: a system prompt is paid for on each one. */
export const VOICE_BUDGET = { guide: 4_000, excerpts: 3_600 } as const;

/**
 * Rule 5, when the document is written in a researcher's voice.
 *
 * The four rules above come first and say so: a voice changes how a thing is
 * said, never what may be cited or claimed. And the passages are there for
 * their manner only. A model shown three paragraphs of somebody's paper and
 * asked to write "like this" will, left to itself, lift phrases from them —
 * which is plagiarism of the very person being imitated, and the Originality
 * tab compares the document with their papers for exactly that reason.
 */
export function voiceRules(voice: Voice | undefined, lang: DocLang): string[] {
  if (!voice || (!voice.guide.trim() && !voice.excerpts.length)) return [];
  // The passages are somebody else's text and the guide a model's: neither
  // may open or close the tags that fence the passages in.
  const unfenced = (x: string) => x.replace(/<\s*\/?\s*passage[^>]*>/gi, ' ');
  const guide = unfenced(voice.guide.trim()).slice(0, VOICE_BUDGET.guide);
  const passages: string[] = [];
  let left: number = VOICE_BUDGET.excerpts;
  for (const e of voice.excerpts) {
    const x = unfenced(e).trim();
    if (!x || left <= 0) continue;
    const cut = x.length > left ? `${x.slice(0, left - 1)}…` : x;
    passages.push(cut);
    left -= cut.length;
  }
  const other = voice.lang !== lang;
  return [
    '',
    `5. Manner. Write in the manner of ${voice.name.trim() || 'the researcher'}: the researcher wants this document to read as if they had written it. Rules 1 to 4 come first — the manner changes how things are said, never what may be cited, claimed or invented.`,
    other
      ? `   Their papers are in ${LANGUAGE_NAME[voice.lang]} and this document is in ${LANGUAGE_NAME[lang]}: carry the manner over — the build of the sentences, the way the argument moves, the tone, how claims are hedged and how parts open and close — in natural ${LANGUAGE_NAME[lang]}, not their words translated.`
      : '',
    guide ? `   How they write:\n${guide.split('\n').map((l) => `   ${l}`).join('\n')}` : '',
    passages.length
      ? '   Passages from their own papers, to show the manner and nothing else. Never copy a sentence or a phrase of more than four words from them, never reuse their content, examples or data, and never cite them: they are not sources of this document.'
      : '',
    ...passages.map((x, i) => `   <passage ${i + 1}>\n${x}\n   </passage ${i + 1}>`),
  ].filter((l) => l !== '');
}

/** A source as the model reads it: its marker, who and when, what, and — when asked — what it says. */
export function sourceLine(s: Source, withAbstract: boolean, abstractChars = 700): string {
  if (s.type === 'law') {
    const law = `[@${s.key}] Legislation: ${s.title}${s.number ? `, No. ${s.number}` : ''}${s.year ? ` of ${s.year}` : ''}.`;
    // Proposed from the model's own memory in the plan: its articles are the
    // model's to get right, and it is told to cite only the ones it is sure of.
    return s.origin === 'model' ? `${law} (Cite only articles you are sure of.)` : law;
  }
  const who = s.authors.length
    ? s.authors.slice(0, 3).map((a) => a.family).join(', ') + (s.authors.length > 3 ? ' et al.' : '')
    : 'Anonymous';
  const head = `[@${s.key}] ${who} (${s.year ?? 'n.d.'}). ${s.title}${s.venue ? `. ${s.venue}` : ''}.`;
  if (!withAbstract || !s.abstract) return head;
  const a = s.abstract.length > abstractChars ? `${s.abstract.slice(0, abstractChars - 1)}…` : s.abstract;
  return `${head}\n    ${a}`;
}

/** The sources a model may cite: the ones in use, never a retracted one. */
export function citable(sources: readonly Source[]): Source[] {
  return sources.filter((s) => s.use && !s.retracted);
}

/**
 * The first request: turn what the researcher typed into a title, a field,
 * keywords and the searches that will find its literature.
 *
 * It asks for JSON and nothing else. Queries are mostly English because that
 * is what the scholarly indexes hold most of, plus a few in the document's
 * language so its own literature is looked for too.
 */
export function planPrompt(doc: Doc): string {
  const k = kindOf(doc.kind);
  const other = doc.lang !== 'en';
  return [
    `The researcher asked for a ${k.label.toLowerCase()}. Their request, as they wrote it:`,
    '',
    doc.request,
    '',
    doc.meta.title ? `They have already chosen the title: ${doc.meta.title}` : '',
    doc.meta.field ? `Their field: ${doc.meta.field}` : '',
    doc.notes.trim() ? `Their notes:\n${doc.notes.trim()}` : '',
    dataBlock(doc.files, DATA_BUDGET.plan),
    '',
    'Reply with one JSON object and nothing else, of this shape:',
    '{',
    `  "title": "a precise academic title, in ${LANGUAGE_NAME[doc.lang]}",`,
    other ? '  "titleEn": "the same title in English",' : '  "titleEn": "",',
    `  "field": "the academic field or specialisation, in ${LANGUAGE_NAME[doc.lang]}",`,
    `  "keywords": ["4 to 6 keywords, in ${LANGUAGE_NAME[doc.lang]}"],`,
    other ? '  "keywordsEn": ["the same keywords in English"],' : '  "keywordsEn": [],',
    '  "queries": ["6 to 8 short searches for a scholarly index, 2 to 6 words each: most in English,'
      + (other ? ` and 2 or 3 in ${LANGUAGE_NAME[doc.lang]}` : '') + '; each one aimed at a different part of the topic"],',
    '  "laws": [{ "title": "the official name of a constitution, law, regulation, instructions or decision the topic turns on, in the document\'s language, without its number and year", "number": "its number, or empty if you are not certain of it", "year": 2010 }]',
    '}',
    'List in "laws" only legislation you are certain exists, of the country the topic is about — at most 8, and none when the topic is not about law or regulation. Leave out anything you are unsure of: the researcher checks every one against the official text, and a law that does not exist is worse than one left out.',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/**
 * Between the search and the outline: which of the works found belong in this
 * document at all.
 *
 * A search engine matches words, not subjects. Searching "NGO oversight Iraq"
 * returned, in a real run, papers on religious freedom in China and on
 * blockchain in real estate, and a model handed them as sources cited them. So
 * the model reads what was found — titles and the start of each abstract —
 * and says which a careful researcher on this topic would cite. The rest are
 * switched off, not deleted: the researcher sees them and can switch one back.
 */
export function screenPrompt(doc: Doc, found: readonly Source[]): string {
  const k = kindOf(doc.kind);
  return [
    `The researcher is writing a ${k.label.toLowerCase()} titled: ${doc.meta.title || doc.request}`,
    doc.meta.field ? `Field: ${doc.meta.field}` : '',
    '',
    'A search of scholarly indexes returned the works below. Some are on the topic; a search engine also returns works that merely share a word with it.',
    'Keep a work only if a careful researcher on this topic would cite it: it studies the same subject, its legal or policy framework, the same country or region, or the concepts and methods the document relies on. Drop works about other subjects, even when they share a keyword.',
    '',
    ...found.map((s) => sourceLine(s, true, 320)),
    '',
    'Reply with one JSON object and nothing else, naming the markers to keep: { "keep": ["s6", "s9"] }',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/**
 * The second: the outline, in the kind's shape, with how many words each part
 * gets and which sources it should lean on.
 */
export function outlinePrompt(doc: Doc): string {
  const k = kindOf(doc.kind);
  const total = targetWords(doc);
  const list = citable(doc.sources).map((s) => sourceLine(s, false)).join('\n');
  return [
    `Plan the outline of a ${k.label.toLowerCase()} titled: ${doc.meta.title || doc.request}`,
    doc.meta.field ? `Field: ${doc.meta.field}` : '',
    `Language of the document: ${LANGUAGE_NAME[doc.lang]}. Every heading and brief is in that language.`,
    '',
    'The shape this kind of document takes:',
    k.shape,
    '',
    `It should come to about ${total.toLocaleString('en')} words in all.`,
    k.chapters
      ? 'Level 1 is a chapter heading, written the way the language numbers chapters (e.g. "الفصل الأول: …"); give it 150 to 300 words of its own introduction. Level 2 is a section of the chapter, level 3 a subsection, and level 4 below that where the argument divides further. A part is written in one piece, so keep each between 600 and 2,000 words.'
      : 'Level 1 is a main heading, level 2 a subheading, level 3 below that, and level 4 below that where the argument divides further. A part is written in one piece, so keep each between 250 and 1,800 words; a heading whose content is all in its subheadings gets 0, or 100 to 200 words when it opens by saying how it is divided.',
    'Do not include the abstract, the table of contents, a dedication, acknowledgements or the reference list: the app adds those.',
    HIERARCHY[doc.lang],
    '',
    doc.notes.trim() ? `The researcher's notes and data:\n${doc.notes.trim()}\n` : '',
    doc.files?.length ? 'Plan the parts that report results around the data files below — one part for each question or table they answer — and nothing the data cannot support.' : '',
    dataBlock(doc.files, DATA_BUDGET.outline),
    list ? 'The sources available, by marker:' : 'No sources were found; plan without them.',
    list,
    '',
    'Reply with one JSON object and nothing else, of this shape:',
    '{ "sections": [ { "level": 1, "heading": "…", "brief": "one or two sentences: what this part must cover", "words": 800, "sources": ["s1", "s4"] } ] }',
    'In "sources", name only markers from the list above, the ones each part should draw on.',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/**
 * A request for one section.
 *
 * It carries the whole outline, so the model knows what comes before and after
 * and does not write the next section's content into this one; the end of the
 * section before, so the prose carries on rather than starting over; the
 * sources this section should lean on, with what they say, and the others by
 * title only, so any of them can still be cited without paying for every
 * abstract every time.
 */
export function sectionPrompt(
  doc: Doc, index: number, o: { previous?: string; redo?: string; current?: string; parallel?: boolean } = {},
): string {
  const k = kindOf(doc.kind);
  const sec = doc.sections[index];
  const outline = doc.sections.map((s, i) =>
    `${'  '.repeat(s.level - 1)}${i === index ? '→ ' : ''}${s.heading}${i === index ? '   ← WRITE THIS ONE' : ''}`).join('\n');
  const usable = citable(doc.sources);
  const leaning = new Set(sec.sources);
  const near = usable.filter((s) => leaning.has(s.key));
  const rest = usable.filter((s) => !leaning.has(s.key));
  const hasChildren = (doc.sections[index + 1]?.level ?? 0) > sec.level;
  return [
    `Document: a ${k.label.toLowerCase()}, "${doc.meta.title || doc.request}".`,
    doc.meta.field ? `Field: ${doc.meta.field}.` : '',
    '',
    'The outline:',
    outline,
    '',
    `Write the part marked "WRITE THIS ONE": "${sec.heading}".`,
    sec.brief ? `What it must cover: ${sec.brief}` : '',
    `Length: about ${sec.words.toLocaleString('en')} words.`,
    hasChildren
      ? 'Its subsections follow it and are written separately: write only its own introduction, and leave their content to them.'
      : '',
    '',
    doc.notes.trim() ? `The researcher's notes and data — use them where they belong, exactly as given:\n${doc.notes.trim()}\n` : '',
    dataBlock(doc.files, DATA_BUDGET.section),
    o.previous ? `The end of the part before it, for continuity (do not repeat it):\n…${o.previous}\n` : '',
    // Several writers work at once, each on its own part of the same outline.
    // Without this each one opens by introducing the whole topic again.
    o.parallel
      ? 'Other parts of this document are being written at the same time, from this same outline, by other writers. Write only this part: do not introduce the topic again, do not anticipate the parts after it, and begin with this part\'s own substance.'
      : '',
    near.length ? 'Sources this part should draw on, with what each says:' : '',
    ...near.map((s) => sourceLine(s, true)),
    '',
    rest.length ? (near.length ? 'Other sources you may cite where they fit:' : 'Sources you may cite where they fit:') : '',
    ...rest.map((s) => sourceLine(s, false)),
    usable.length ? '' : 'There are no sources for this document. Cite nothing, and leave [[gaps]] where evidence is needed.',
    o.current ? `The current text of this part, which the researcher wants rewritten:\n${o.current}\n` : '',
    o.redo ? `The researcher's instruction for the rewrite: ${o.redo}\n` : '',
    'Reply with the text of this part only, beginning with its first paragraph.',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}

/**
 * A continuation, when a section ran out of room mid-sentence. The model is
 * given where it stopped and carries on from there, rather than starting the
 * section again and repeating half of it.
 */
export function continuePrompt(
  doc: Doc, index: number, sofar: string, o: { redo?: string; current?: string; parallel?: boolean } = {},
): string {
  return [
    // A rewrite that runs out of room is still that rewrite: the instruction
    // goes with the continuation, or the second half is written to the old brief.
    sectionPrompt(doc, index, o),
    '',
    'You already wrote the beginning of this part and ran out of room. It ends:',
    `…${sofar.slice(-1500)}`,
    '',
    'Continue exactly from where it stops, without repeating anything, and finish the part.',
  ].join('\n');
}

/**
 * The last request: the abstract, written from what was actually written
 * rather than from the plan, so it does not promise chapters that came out
 * differently.
 */
export function abstractPrompt(doc: Doc): string {
  const k = kindOf(doc.kind);
  const both = k.abstract === 'both' && doc.lang !== 'en';
  const digest = doc.sections
    .filter((s) => s.state === 'done' && s.text.trim())
    .map((s) => `${s.heading}\n${s.text.replace(/\[@[^\]]*\]/g, '').replace(/\s+/g, ' ').slice(0, s.level === 1 ? 700 : 450)}`)
    .join('\n\n');
  return [
    `Write the abstract of this ${k.label.toLowerCase()}: "${doc.meta.title || doc.request}".`,
    `In ${LANGUAGE_NAME[doc.lang]}, 200 to 300 words, one paragraph: the problem, the aim, the approach, the main points or findings, and the conclusion. No citations. Where findings depend on data the researcher has not supplied, say what the study examines rather than what it found.`,
    both ? 'Then the same abstract in English.' : '',
    '',
    'What the document says, part by part:',
    digest,
    '',
    'Reply with one JSON object and nothing else:',
    both ? '{ "abstract": "…", "abstractEn": "…" }' : '{ "abstract": "…" }',
  ].filter((l, i, all) => l !== '' || all[i - 1] !== '').join('\n');
}
