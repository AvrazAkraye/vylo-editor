/**
 * Slides: a presentation from a sentence, or from a document Research wrote.
 *
 * The same shape as Video (video.ts), on purpose. A request whose words switch
 * things on — "a 12-slide thesis defence in Sorani" — a model that writes
 * words into a fixed set of slide kinds, and the app's own code that draws
 * them: in the panel (SlideView.tsx), in a PowerPoint file (slidespptx.ts) and
 * in a PDF. The layout of every kind is one function (slideslayout.ts), so the
 * three can never disagree about where a title sits.
 *
 * ## The model writes words, never code
 *
 * What comes back is JSON: slides of the kinds below, with plain text fields.
 * `parsePlan` reads it and `sanitizeSlide` repairs it — markup stripped,
 * lengths capped, a kind that is missing what it needs turned into one that
 * does not need it — and nothing the model wrote is run. It reaches a file
 * only through Save, at a path the person chose: SAFETY.md's rule.
 *
 * ## No invented sources
 *
 * A presentation made from a sentence has nothing to cite, so the model is
 * told to name no study, book or author, and a references slide it writes
 * anyway is dropped. A deck made from a Research document carries that
 * document's own references, written by the app from records OpenAlex and
 * Crossref returned (`fromResearch`), and only those are shown.
 */

import type { Doc, Source } from './research';
import { WORDS, citable, localDigits } from './research';
import { jsonIn } from './researchrun';
import { videoLangOf } from './video';
import { fold } from './settings';

// ── the shape of a deck ───────────────────────────────────────────────────

export type DeckLang = 'ar' | 'ckb' | 'kmr' | 'en';

/** What the presentation is for, which decides its arc. */
export type DeckKind = 'defense' | 'lecture' | 'class' | 'conference' | 'pitch' | 'general';

export const DECK_KINDS: readonly DeckKind[] = ['defense', 'lecture', 'class', 'conference', 'pitch', 'general'];

/** How it looks: a palette and a weight, drawn by slideslayout.ts. */
export type Theme = 'academic' | 'modern' | 'elegant' | 'bold' | 'minimal' | 'warm';

export const THEMES: readonly Theme[] = ['academic', 'modern', 'elegant', 'bold', 'minimal', 'warm'];

/**
 * The kinds of slide. `references` is the app's alone: it is written from a
 * Research document's sources, never by the model.
 */
export type SlideKind = 'title' | 'section' | 'bullets' | 'two' | 'stat' | 'table' | 'timeline' | 'quote' | 'references' | 'end';

export const SLIDE_KINDS: readonly SlideKind[] = ['title', 'section', 'bullets', 'two', 'stat', 'table', 'timeline', 'quote', 'references', 'end'];

/** The kinds a person can add by hand, and the model may write. */
export const WRITTEN_KINDS: readonly SlideKind[] = SLIDE_KINDS.filter((k) => k !== 'references');

/** How many slides, as the picker offers them. Any count in `COUNT` can be asked for in words. */
export const COUNTS: readonly number[] = [8, 12, 16, 20];

export const COUNT = { min: 4, max: 30 } as const;

/** A big figure and what it is (`stat`), or a moment and what happened (`timeline`). */
export interface Pair { a: string; b: string }

/**
 * One slide. Every field is present on every kind, empty where the kind does
 * not use it, so a slide can change kind in the editor without losing words:
 * turning a comparison into bullets and back gives the comparison back.
 */
export interface Slide {
  id: string;
  kind: SlideKind;
  title: string;
  /** Under the title (title, section, end); who said it (quote). */
  subtitle: string;
  /** The points (bullets, references), or the first column (two). */
  points: string[];
  /** The two columns' headings. */
  head: string;
  head2: string;
  /** The second column. */
  points2: string[];
  pairs: Pair[];
  /** A table, its first row the header. */
  rows: string[][];
  /** A quotation. */
  body: string;
  /** What the presenter says while it is on screen. */
  notes: string;
}

/** What goes on the title slide under the title. Every field may be empty. */
export interface DeckMeta {
  presenter: string;
  supervisor: string;
  university: string;
  college: string;
  date: string;
}

export const EMPTY_META: DeckMeta = { presenter: '', supervisor: '', university: '', college: '', date: '' };

export type DeckStage = 'new' | 'planning' | 'ready';

/** One turn of the Chat tab: the person's message, or the model's answer and what it changed. */
export interface DeckTurn {
  role: 'you' | 'model';
  text: string;
  at: number;
  /** What the model's turn changed, in plain words, one line each — shown under its reply. */
  changes?: string[];
  /** What it asked for and did not get, one line each, shown apart. */
  skipped?: string[];
  /** The model's turn could not be understood or applied. */
  failed?: boolean;
  /** Buttons offered under the answer, for what only the person may press: saving a file. */
  offer?: ('pptx' | 'pdf')[];
  /** Whether the message was spoken rather than typed. */
  spoken?: boolean;
}

export interface Deck {
  id: string;
  v: 1;
  created: number;
  updated: number;
  /** What the person typed, as they typed it. */
  request: string;
  kind: DeckKind;
  lang: DeckLang;
  theme: Theme;
  /** How many slides were asked for. */
  count: number;
  /** How numbers are written. English is always 123. */
  digits?: 'eastern' | 'western';
  title: string;
  meta: DeckMeta;
  /** The logo on the title and the last slide, as a `data:image/png` or `data:image/jpeg` URL. */
  logo?: string;
  /** The logo's width over its height, so every renderer fits it the same way. */
  logoRatio?: number;
  /** Colours that replace the theme's: the band behind titles, and the accent. */
  brand?: { primary?: string; accent?: string };
  slides: Slide[];
  stage: DeckStage;
  error?: string;
  /** The model its last run was started with. */
  model?: string;
  /** The composer's choice, overridden — the same shape as Research's and Video's. */
  choice?: { provider: string; model: string; at?: string };
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** The Research document it was made from. */
  from?: { id: string; title: string };
  /** What the model is given of that document: its abstract and parts, cut to size. */
  source?: string;
  /** That document's references, as the app wrote them — the only ones a deck from it shows. */
  refs?: string[];
  /** The Chat tab's conversation, oldest first (slideschat.ts). */
  chat?: DeckTurn[];
}

export function isRtl(lang: DeckLang): boolean {
  return lang !== 'en';
}

/**
 * Digits as the deck writes them: ١٢٣ in Arabic and Kurdish unless it says
 * otherwise, 123 in English. A percent sign beside Eastern digits is the
 * Arabic one, ٪, as ٧٨٪ is written; beside Western digits it stays %.
 */
export function digitsOf(text: string, deck: Pick<Deck, 'lang' | 'digits'>): string {
  const out = localDigits(text, { lang: deck.lang, digits: deck.digits });
  return out === text ? out : out.replace(/([٠-٩])\s?%|%\s?(?=[٠-٩])/g, (_m, d?: string) => (d ? `${d}٪` : '٪'));
}

// ── words the app writes itself ───────────────────────────────────────────

interface Fixed {
  /** A new slide's title, and a new point, before the person writes theirs. */
  slide: string;
  point: string;
  /** The last slide, when the model's reply had none. */
  thanks: string;
  questions: string;
  /** A title slide with no title at all. */
  untitled: string;
}

const FIXED: Readonly<Record<DeckLang, Fixed>> = {
  ar: { slide: 'عنوان الشريحة', point: 'نقطة جديدة', thanks: 'شكراً لحسن استماعكم', questions: 'الأسئلة والمناقشة', untitled: 'عرض تقديمي' },
  ckb: { slide: 'ناونیشانی سلاید', point: 'خاڵێکی نوێ', thanks: 'سوپاس بۆ گوێگرتنتان', questions: 'پرسیار و گفتوگۆ', untitled: 'پێشکەشکردن' },
  kmr: { slide: 'سەرناڤێ سلایدێ', point: 'خالەکا نوی', thanks: 'سوپاس بۆ گوهدارییا هەوە', questions: 'پسیار و گفتوگۆ', untitled: 'پێشکێشکرن' },
  en: { slide: 'Slide title', point: 'A new point', thanks: 'Thank you', questions: 'Questions and discussion', untitled: 'Presentation' },
};

/** The line above the presenter's and the supervisor's names, as Research writes them on a cover. */
export function byWords(lang: DeckLang): { by: string; supervisor: string; references: string } {
  const w = WORDS[lang];
  return { by: w.by, supervisor: w.supervisor, references: w.references };
}

// ── a new deck ────────────────────────────────────────────────────────────

const clampNum = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** How many slides a kind usually runs to, when the request does not say. */
export function countFor(kind: DeckKind): number {
  return kind === 'defense' ? 16 : 12;
}

export function newDeck(o: {
  id: string; now: number; request: string; lang: DeckLang; kind: DeckKind; theme: Theme; count: number;
  meta?: Partial<DeckMeta>; logo?: string; logoRatio?: number;
}): Deck {
  const count = Number.isFinite(o.count) ? clampNum(Math.round(o.count), COUNT.min, COUNT.max) : countFor(o.kind);
  return {
    id: o.id,
    v: 1,
    created: o.now,
    updated: o.now,
    request: o.request,
    kind: o.kind,
    lang: o.lang,
    theme: o.theme,
    count,
    title: '',
    meta: { ...EMPTY_META, ...(o.meta ?? {}) },
    ...(o.logo ? { logo: o.logo, ...(o.logoRatio ? { logoRatio: o.logoRatio } : {}) } : {}),
    slides: [],
    stage: 'new',
  };
}

// ── what a request asks for ───────────────────────────────────────────────

/**
 * Folded for matching, the way video.ts folds its requests: the app's one
 * fold, plus a phone's curly apostrophe and Kurdish ە typed as ه. Two
 * replacements, repeated here rather than exported from a file this module
 * does not own.
 */
function folded(s: string): string {
  return fold(s).replace(/[’‘ʼ]/g, "'").replace(/ە/g, 'ه').replace(/\s+/g, ' ');
}

/** Arabic-Indic and Eastern digits as ASCII, so "١٢ شريحة" is twelve slides like "12 slides" is. */
function asciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6F0));
}

function hay(request: unknown): string {
  return folded(asciiDigits(typeof request === 'string' ? request : ''));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An attached Arabic prefix — and, with, for, the — which "للمناقشة" carries. */
const PREFIX = '(?:[وفبلک]{1,2}|[وفبل]?ال)?';

/**
 * An ending Kurdish or Arabic attaches to a noun — "وانەیەک" is a lesson,
 * "سمینارەکان" the seminars, "محاضرات" lectures — folded as `folded` folds
 * them, so the name is still found with its grammar on it.
 */
const SUFFIX = `(?:${['یەک', 'ێک', 'ەکە', 'ەکان', 'کان', 'ان', 'ات', 'ی', 'ێ', 'ە'].map(folded).map(escapeRe).join('|')})?`;

/** Any of `names`, standing on its own, after an optional attached prefix and before an optional ending. */
function namesRe(names: readonly string[]): RegExp {
  const alts = [...new Set(names.map(folded))].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return new RegExp(`(?:^|[^\\p{L}\\p{M}\\p{N}])${PREFIX}(?:${alts})${SUFFIX}(?=[^\\p{L}\\p{M}\\p{N}]|$)`, 'u');
}

/** The entry of a table named earliest in `text`. */
function earliest<T>(text: string, table: readonly (readonly [T, RegExp])[]): T | null {
  let best: { v: T; at: number } | null = null;
  for (const [v, re] of table) {
    const m = re.exec(text);
    if (m && (!best || m.index < best.at)) best = { v, at: m.index };
  }
  return best ? best.v : null;
}

/**
 * The words each kind goes by. Defence first: "a thesis defence presentation"
 * is a defence although it says "presentation", and "مناقشة" in a request
 * for slides only ever means the viva.
 */
const KIND_NAMES: readonly (readonly [DeckKind, readonly string[]])[] = [
  ['defense', [
    'defense', 'defence', 'viva', 'thesis defense', 'thesis defence', 'dissertation defense', 'dissertation defence',
    'مناقشة', 'مناقشه', 'مناقشة رسالة', 'مناقشة اطروحة', 'مناقشة أطروحة', 'دفاع',
    'بەرگری', 'بەرگریکردن', 'گفتوگۆی نامە', 'گفتوگۆکردنی نامە', 'دیفاع', 'دیفاعکرن',
  ]],
  ['lecture', ['lecture', 'lectures', 'lesson', 'lessons', 'محاضرة', 'محاضره', 'محاضرات', 'درس', 'دروس', 'وانە', 'وانه', 'مۆحازەرە', 'محازەرە', 'لێکچەر', 'دەرس']],
  ['conference', ['conference', 'symposium', 'conference talk', 'مؤتمر', 'ندوة', 'ملتقى', 'کۆنفرانس', 'کونفرانس', 'سیمپۆزیۆم']],
  ['pitch', [
    'pitch', 'investor', 'investors', 'startup', 'start-up', 'business plan', 'sales deck', 'pitch deck',
    'مستثمر', 'مستثمرين', 'عرض استثماري', 'مشروع تجاري', 'خطة عمل', 'شركة ناشئة',
    'وەبەرهێنەر', 'وەبەرهێنان', 'پرۆژەی بازرگانی', 'پلانی کار', 'کۆمپانیا',
  ]],
  ['class', [
    'seminar', 'class presentation', 'class project', 'homework', 'assignment', 'report',
    'سمنار', 'سيمنار', 'سمينار', 'تقرير', 'واجب', 'عرض صفي',
    'سمینار', 'سیمینار', 'ڕاپۆرت', 'ڕاپۆرتی', 'ئەرک',
  ]],
];

const KIND_RES = KIND_NAMES.map(([k, names]) => [k, namesRe(names)] as const);

/** The kind of presentation a request names, or `null`. */
export function kindIn(request: string): DeckKind | null {
  return earliest(hay(request), KIND_RES);
}

const THEME_NAMES: readonly (readonly [Theme, readonly string[]])[] = [
  ['academic', ['academic', 'university', 'scholarly', 'formal', 'أكاديمي', 'اكاديمي', 'أكاديمية', 'جامعي', 'رسمي', 'ئەکادیمی', 'زانکۆیی', 'فەرمی']],
  ['modern', ['modern', 'clean', 'sleek', 'corporate', 'professional', 'حديث', 'عصري', 'مودرن', 'مۆدێرن', 'پرۆفیشناڵ']],
  ['elegant', ['elegant', 'luxury', 'premium', 'classy', 'فاخر', 'أنيق', 'راقي', 'شیک', 'ئەلەگانت']],
  ['bold', ['bold', 'energetic', 'dynamic', 'vivid', 'جريء', 'حماسي', 'قوي', 'بەهێز', 'بهێز']],
  ['minimal', ['minimal', 'minimalist', 'simple', 'plain', 'بسيط', 'مينيمال', 'سادە', 'ساکار']],
  ['warm', ['warm', 'friendly', 'cozy', 'دافئ', 'ودود', 'گەرم', 'دۆستانە']],
];

const THEME_RES = THEME_NAMES.map(([th, names]) => [th, namesRe(names)] as const);

/** The look a request names, or `null`. */
export function themeIn(request: string): Theme | null {
  return earliest(hay(request), THEME_RES);
}

/** The words for a slide, in each language, singular and plural, with Kurdish's attached endings allowed. */
const SLIDE_UNITS = [
  'slide', 'slides', 'page', 'pages',
  'شريحة', 'شرائح', 'شريحه', 'سلايد', 'سلايدات', 'سلايدز', 'صفحة', 'صفحات',
  'سلاید', 'سلایدەکان', 'سلایدی', 'سلایدێ', 'پەڕە', 'لاپەڕە', 'بەرگ',
];

const COUNT_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.,])(\\d{1,2})[\\s-]*(?:${[...new Set(SLIDE_UNITS.map(folded))].sort((a, b) => b.length - a.length).map(escapeRe).join('|')})`,
  'u',
);

/** The number of slides a request names, inside `COUNT`, or `null`. "5 minutes" is not five slides. */
export function countIn(request: string): number | null {
  const m = COUNT_RE.exec(hay(request));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? clampNum(n, COUNT.min, COUNT.max) : null;
}

/** The language the slides are written in: named in the request, or the one it is written in. */
export function deckLangOf(request: string, fallback: DeckLang): DeckLang {
  return videoLangOf(request, fallback);
}

// ── what the model is told ────────────────────────────────────────────────

export const LANGUAGE_NAME: Readonly<Record<DeckLang, string>> = {
  ar: 'Arabic', ckb: 'Central Kurdish (Sorani)', kmr: 'Northern Kurdish (Badini)', en: 'English',
};

/**
 * How the words are written in each language. Kurdish is spelled out letter by
 * letter for video.ts's reason: a model's Kurdish drifts into Arabic spelling,
 * and Badini into Sorani, and a Duhok audience reads either as somebody else's.
 */
export const LANGUAGE: Readonly<Record<DeckLang, string>> = {
  ar: 'Write every word in Arabic: clear Modern Standard Arabic in the register of a good university presentation — precise, concise, never padded.',
  ckb: 'Write every word in Central Kurdish (Sorani), in the Kurdish Arabic-based alphabet with its own letters — ی ک ە ێ ۆ ڕ ڵ — never Arabic substitutes for them (not ي, ك, ة, and not ه where Kurdish writes ە). Use the words and spelling people in Sulaymaniyah and Erbil write, not Arabic or Persian words where a Kurdish one exists, and not Badini forms.',
  kmr: 'Write every word in Northern Kurdish as it is spoken in Duhok (Badini), in the Kurdish Arabic-based alphabet with its own letters — ی ک ە ێ ۆ ڤ — never Arabic substitutes for them (not ي, ك, ة). Use Badini words and grammar (for example ئەز, دڤێت, ژ, ل, ڤێ), not Sorani forms like دەمەوێت or لە, and not Arabic words where a Kurdish one exists.',
  en: 'Write every word in English: plain, precise and confident — the voice of a good speaker, not a brochure.',
};

/** The arc each kind of presentation follows. */
export const ARC: Readonly<Record<DeckKind, string>> = {
  defense: 'A thesis or dissertation defence before an examining committee. The usual order: title; outline; introduction and the research problem; significance; objectives, and the questions or hypotheses; previous studies in brief; methodology (design, population and sample, tools, analysis); results — the main findings, with their real figures; discussion; conclusions; recommendations and future work; thanks and questions. Formal, precise, impersonal.',
  lecture: 'A university lecture. Title; what the students will learn; the topic in logical steps, each with its definitions and an example; a summary; questions to review it; thanks.',
  class: 'A student\'s class presentation or seminar. Title; outline; introduction; the main points in order, with examples; conclusion; thanks and questions.',
  conference: 'A research talk at a conference, ten to fifteen minutes. Title; the problem and why it matters; the aim; the method; the key results; what they mean; conclusion; thanks and questions.',
  pitch: 'A business or project pitch. Title; the problem; the solution; how it works; who it is for; how it makes money or keeps going; milestones reached (only ones the request gives); the team if the request names it; what is asked for; thanks and contact.',
  general: 'A clear, well-built presentation on the subject: title; outline; the main points in a logical order; conclusion; thanks.',
};

/** The tone each look asks of the words; slideslayout.ts draws the rest. */
export const TONE: Readonly<Record<Theme, string>> = {
  academic: 'academic — formal and exact',
  modern: 'modern — clean and confident',
  elegant: 'elegant — measured and refined',
  bold: 'bold — short, strong lines',
  minimal: 'minimal — as few words as will carry it',
  warm: 'warm — friendly and plain',
};

export const SCHEMA = [
  'Each slide is an object with a "kind" and the fields that kind uses:',
  '- {"kind":"title","title":"…","subtitle":"…"} — the first slide. The presenter, supervisor, university and date are added by the app: do not write them.',
  '- {"kind":"section","title":"…","subtitle":"…"} — a divider before a new part. Only in decks of twelve slides or more, and not more than three of them.',
  '- {"kind":"bullets","title":"…","points":["…","…"]} — three to six points, each at most about fifteen words. The most used kind, but not the only one.',
  '- {"kind":"two","title":"…","head":"…","points":["…"],"head2":"…","points2":["…"]} — two sides: a comparison, before and after, advantages and limits. Two to five points a side.',
  '- {"kind":"stat","title":"…","pairs":[{"a":"85%","b":"what the figure is"}]} — one to three big figures, each with a short label.',
  '- {"kind":"table","title":"…","rows":[["heading","heading"],["cell","cell"]]} — a header row, then up to six rows of at most four columns.',
  '- {"kind":"timeline","title":"…","pairs":[{"a":"2019","b":"what happened"}]} — three to six steps in order: dates, phases or stages of a method.',
  '- {"kind":"quote","body":"…","subtitle":"who said it"} — a quotation or a definition, and whose it is.',
  '- {"kind":"end","title":"…","subtitle":"…"} — the last slide: thanks, and questions or how to get in touch.',
  'Every slide also has "notes": what the presenter says while it is on screen — two to five natural spoken sentences that add to the slide rather than read it out.',
  'Write numbers with the digits 0-9; the app writes them as the language does. No markdown, no emoji, no HTML: plain text in every field.',
].join('\n');

/**
 * The rule on facts, which is the rule the whole module keeps. Figures,
 * quotations and sources come from the request or the document, or they are
 * not on a slide.
 */
function factsRule(deck: Deck): string {
  if (deck.source?.trim()) {
    return [
      'Everything on the slides comes from the document below. Use its findings and figures exactly as it states them;',
      'add no figure, result, quotation, date or name it does not contain. Do not write a references slide and do not',
      'cite sources on the slides: the app adds the document\'s own reference list after your slides.',
    ].join('\n');
  }
  return [
    'Use "stat", "table" and "quote" only for figures, data and quotations the request itself gives, or facts so well known',
    'that any textbook states them the same way; otherwise say it in words, with no number. Name no study, book, article',
    'or author as a source, and write no references slide: this presentation has no sources to cite, and an invented one',
    'is the worst thing it could contain.',
  ].join('\n');
}

function systemOf(deck: Deck): string {
  return [
    'You write the slides of presentations: the words on each slide and what the presenter says with it.',
    'You reply with JSON only. You never write code, HTML or markdown.',
    LANGUAGE[deck.lang] ?? LANGUAGE.en,
  ].join('\n');
}

export const quoted = (label: string, text: string) => `${label}:\n"""\n${text.replace(/"""/g, '"')}\n"""`;

/** The slides the model is asked for: the deck's count, less the references slides the app will add. */
export function modelCount(deck: Pick<Deck, 'count' | 'refs'>): number {
  const refs = refSlides(deck.refs ?? []).length;
  return clampNum(deck.count - refs, COUNT.min, COUNT.max);
}

export function planPrompt(deck: Deck): { system: string; user: string } {
  const lang = LANGUAGE_NAME[deck.lang];
  const n = modelCount(deck);
  const user = [
    quoted('The request, as the person wrote it', deck.request),
    '',
    'The presentation:',
    `- ${ARC[deck.kind] ?? ARC.general}`,
    `- Language of every word, notes included: ${lang}.`,
    `- Exactly ${n} slides, counting the title slide and the last one.`,
    `- Tone: ${TONE[deck.theme] ?? TONE.modern}.`,
    '- One idea to a slide. Vary the kinds where the content suits another kind — a comparison is "two", a sequence is "timeline" — but never force one.',
    '',
    factsRule(deck),
    ...(deck.source?.trim() ? ['', quoted('The document the presentation is made from', deck.source.trim())] : []),
    '',
    'Reply with one JSON object and nothing else — no explanation before or after it:',
    `{"title":"the presentation's title, in ${lang}","slides":[slide, slide, …]}`,
    '',
    SCHEMA,
  ].join('\n');
  return { system: systemOf(deck), user };
}

/** A slide as the model reads it again: its words, without the id. */
export function slideJson(s: Slide): string {
  const out: Record<string, unknown> = { kind: s.kind };
  if (s.title) out.title = s.title;
  if (s.subtitle) out.subtitle = s.subtitle;
  if (s.points.length) out.points = s.points;
  if (s.head) out.head = s.head;
  if (s.points2.length) out.points2 = s.points2;
  if (s.head2) out.head2 = s.head2;
  if (s.pairs.length) out.pairs = s.pairs;
  if (s.rows.length) out.rows = s.rows;
  if (s.body) out.body = s.body;
  return JSON.stringify(out);
}

/**
 * Write one slide again, with the person's instruction or without. The model
 * sees the whole deck, so the new slide fits between its neighbours and does
 * not repeat them.
 */
export function slidePrompt(deck: Deck, index: number, instruction: string): { system: string; user: string } {
  const slides = deck.slides ?? [];
  const i = clampNum(Math.round(Number.isFinite(index) ? index : 0), 0, Math.max(0, slides.length - 1));
  const lang = LANGUAGE_NAME[deck.lang];
  const asked = typeof instruction === 'string' && instruction.trim()
    ? quoted('The person\'s instruction for this slide', instruction.trim())
    : 'The person gave no instruction: make it better — clearer, tighter, and in the kind that says it best.';
  const user = [
    quoted('The presentation was requested as', deck.request),
    '',
    `- ${ARC[deck.kind] ?? ARC.general}`,
    `- Language: ${lang}. Tone: ${TONE[deck.theme] ?? TONE.modern}.`,
    'Its slides, in order:',
    ...slides.map((s, n) => `${n + 1}. ${slideJson(s)}`),
    '',
    factsRule(deck),
    ...(deck.source?.trim() ? ['', quoted('The document the presentation is made from', deck.source.trim())] : []),
    '',
    `Rewrite slide ${i + 1} only. It keeps its place: consistent with the slides around it, not repeating them. It may change kind if the instruction asks for it or another kind says it better.`,
    asked,
    '',
    SCHEMA,
    '',
    `Reply with that one slide as a JSON object and nothing else, words and notes in ${lang}, like {"kind":"bullets","title":"…","points":["…"],"notes":"…"}.`,
  ].join('\n');
  return { system: systemOf(deck), user };
}

// ── reading the reply ─────────────────────────────────────────────────────

const INVISIBLE = /[​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Kurdish in Kurdish letters and Arabic in Arabic ones — the same repair video.ts makes. */
function inScript(s: string, lang: DeckLang): string {
  if (lang === 'ckb' || lang === 'kmr') return s.replace(/[يى]/g, 'ی').replace(/ك/g, 'ک');
  if (lang === 'ar') return s.replace(/ی/g, 'ي').replace(/ک/g, 'ك');
  return s;
}

/** Cut to `cap` characters at a word's end, with an ellipsis; whole characters, so an emoji is never split. */
function capped(s: string, cap: number): string {
  const chars = Array.from(s);
  if (chars.length <= cap) return s;
  const cut = chars.slice(0, cap - 1).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > cap * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Slide text from whatever the model put in a field: markup and its contents
 * gone where it is a script or a style, other tags stripped, markdown
 * emphasis and a leading list marker removed, invisible letters gone, white
 * space collapsed, spelled in the deck's script, and capped.
 */
export function clean(v: unknown, cap: number, lang: DeckLang): string {
  const raw = typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
  if (!raw) return '';
  const s = raw
    .slice(0, 6000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?[a-z!][^>]*>/gi, '')
    .replace(/\*\*|__|`/g, '')
    .replace(INVISIBLE, '')
    .replace(CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:[-•*▪●◦–]|\d{1,2}[.)])\s+/, '');
  return capped(inScript(s, lang), cap);
}

function list(v: unknown, max: number, cap: number, lang: DeckLang): string[] {
  const raw = Array.isArray(v) ? v.slice(0, 100) : typeof v === 'string' ? v.split(/\n/) : [];
  const out: string[] = [];
  for (const x of raw) {
    const s = typeof x === 'object' && x !== null ? clean((x as Record<string, unknown>).text ?? (x as Record<string, unknown>).point, cap, lang) : clean(x, cap, lang);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** How much a field may hold. Long enough for a real slide; short enough that a runaway reply cannot bury one. */
export const CAP = {
  title: 120, subtitle: 220, point: 220, head: 80, a: 40, b: 160, cell: 90, body: 420, notes: 1500,
  points: 7, pairs: 6, rows: 8, cols: 5,
} as const;

/** The kind a model's word names, including the names it uses for them unasked. */
function kindOf(v: unknown): SlideKind | null {
  const k = typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s_-]+/g, '') : '';
  const alias: Record<string, SlideKind> = {
    title: 'title', cover: 'title', titleslide: 'title', opening: 'title',
    section: 'section', divider: 'section', sectionheader: 'section', part: 'section',
    bullets: 'bullets', bullet: 'bullets', list: 'bullets', content: 'bullets', points: 'bullets', text: 'bullets', agenda: 'bullets', outline: 'bullets',
    two: 'two', twocolumn: 'two', twocolumns: 'two', columns: 'two', comparison: 'two', compare: 'two',
    stat: 'stat', stats: 'stat', number: 'stat', numbers: 'stat', figures: 'stat', kpi: 'stat', metric: 'stat', metrics: 'stat',
    table: 'table',
    timeline: 'timeline', steps: 'timeline', process: 'timeline', stages: 'timeline',
    quote: 'quote', quotation: 'quote', definition: 'quote',
    references: 'references', sources: 'references', bibliography: 'references',
    end: 'end', closing: 'end', thanks: 'end', thankyou: 'end', outro: 'end', conclusion: 'end',
  };
  return alias[k] ?? null;
}

function blank(id: string, kind: SlideKind): Slide {
  return { id, kind, title: '', subtitle: '', points: [], head: '', head2: '', points2: [], pairs: [], rows: [], body: '', notes: '' };
}

function pairsOf(v: unknown, lang: DeckLang): Pair[] {
  if (!Array.isArray(v)) return [];
  const out: Pair[] = [];
  for (const x of v.slice(0, 50)) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const a = clean(o.a ?? o.value ?? o.number ?? o.figure ?? o.when ?? o.date ?? o.year ?? o.step ?? o.label, CAP.a, lang);
    const b = clean(o.b ?? o.label2 ?? o.what ?? o.text ?? o.description ?? o.caption ?? (o.value !== undefined || o.number !== undefined ? o.label : undefined), CAP.b, lang);
    if (a || b) out.push({ a, b });
    if (out.length >= CAP.pairs) break;
  }
  return out;
}

function rowsOf(v: unknown, lang: DeckLang): string[][] {
  let raw: unknown = v;
  // {"head":[…],"rows":[[…]]} is a table too.
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    raw = [...(Array.isArray(o.head) ? [o.head] : Array.isArray(o.header) ? [o.header] : []), ...(Array.isArray(o.rows) ? o.rows : [])];
  }
  if (!Array.isArray(raw)) return [];
  const rows = raw.slice(0, CAP.rows)
    .filter((r): r is unknown[] => Array.isArray(r))
    .map((r) => r.slice(0, CAP.cols).map((c) => clean(c, CAP.cell, lang)));
  const cols = Math.max(0, ...rows.map((r) => r.length));
  // Every row as wide as the widest, so a table always has corners.
  return rows.filter((r) => r.some(Boolean)).map((r) => [...r, ...Array(cols - r.length).fill('')]);
}

/**
 * A slide from whatever the model wrote, or `null` when nothing in it could be
 * shown. A kind missing what it needs becomes one that does not need it —
 * a table with one row is its cells as points, a comparison with one side is
 * that side as points — rather than an empty frame on a projector.
 */
export function sanitizeSlide(raw: unknown, lang: DeckLang, newId: () => string): Slide | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  let kind = kindOf(o.kind ?? o.type ?? o.layout);
  const s = blank(newId(), kind ?? 'bullets');
  s.title = clean(o.title ?? o.heading ?? o.headline, CAP.title, lang);
  s.subtitle = clean(o.subtitle ?? o.author ?? o.by ?? o.source ?? o.caption, CAP.subtitle, lang);
  const left = o.left && typeof o.left === 'object' ? o.left as Record<string, unknown> : null;
  const right = o.right && typeof o.right === 'object' ? o.right as Record<string, unknown> : null;
  s.points = list(o.points ?? o.bullets ?? o.items ?? left?.points ?? left?.bullets, CAP.points, CAP.point, lang);
  s.head = clean(o.head ?? left?.head ?? left?.title ?? left?.heading, CAP.head, lang);
  s.head2 = clean(o.head2 ?? right?.head ?? right?.title ?? right?.heading, CAP.head, lang);
  s.points2 = list(o.points2 ?? o.bullets2 ?? right?.points ?? right?.bullets, CAP.points, CAP.point, lang);
  s.pairs = pairsOf(o.pairs ?? o.stats ?? o.figures ?? o.steps ?? o.events ?? o.items, lang);
  s.rows = rowsOf(o.rows ?? o.table, lang);
  s.body = clean(o.body ?? o.quote ?? o.text ?? o.definition, CAP.body, lang);
  s.notes = clean(o.notes ?? o.speakerNotes ?? o.speaker_notes ?? o.script, CAP.notes, lang);
  if (!kind) kind = s.rows.length > 1 ? 'table' : s.points2.length ? 'two' : 'bullets';

  // What each kind needs, and what it becomes without it.
  const asPoints = (extra: string[]) => {
    s.kind = 'bullets';
    s.points = [...s.points, ...extra].filter(Boolean).slice(0, CAP.points);
  };
  s.kind = kind;
  if (kind === 'two' && (!s.points.length || !s.points2.length)) asPoints(s.points2);
  else if (kind === 'stat' && !s.pairs.some((p) => p.a)) asPoints(s.pairs.map((p) => p.b));
  else if (kind === 'stat') s.pairs = s.pairs.filter((p) => p.a).slice(0, 3);
  else if (kind === 'timeline' && s.pairs.length < 2) asPoints(s.pairs.map((p) => [p.a, p.b].filter(Boolean).join(' — ')));
  else if (kind === 'table' && s.rows.length < 2) asPoints(s.rows.flat());
  else if (kind === 'quote' && !s.body) {
    if (s.points.length) asPoints([]);
    else { s.kind = 'section'; }
  }
  // Content kinds need something under the title; a bare title is a divider.
  if (s.kind === 'bullets' && !s.points.length) s.kind = s.title ? 'section' : 'bullets';
  const said = s.title || s.subtitle || s.points.length || s.pairs.length || s.rows.length || s.body;
  return said ? s : null;
}

/**
 * The slides in a reply: the objects of its `slides` array, read one by one,
 * so a reply cut off by the length limit still gives every slide it finished
 * rather than nothing. Also a reply that is only the array.
 */
function slidesIn(text: string): { title: string; slides: unknown[] } | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const whole = jsonIn(text) as Record<string, unknown> | null;
  if (whole && Array.isArray(whole.slides)) return { title: typeof whole.title === 'string' ? whole.title : '', slides: whole.slides };
  // Cut off, or an array on its own: walk the objects after `"slides": [`, or after the first `[`.
  const key = text.search(/"slides"\s*:\s*\[/);
  const from = key >= 0 ? text.indexOf('[', key) : text.indexOf('[');
  if (from < 0) return null;
  const title = key >= 0 ? (/"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text.slice(0, key))?.[1] ?? '') : '';
  const slides: unknown[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0) {
      if (--depth === 0 && start >= 0) {
        const o = jsonIn(text.slice(start, i + 1));
        if (o) slides.push(o);
        start = -1;
      }
    } else if (c === ']' && depth === 0) break;
  }
  let t = '';
  try { t = title ? JSON.parse(`"${title}"`) : ''; } catch { t = ''; }
  return slides.length ? { title: t, slides } : null;
}

/** The references of a Research document, as slides of at most seven. */
export function refSlides(refs: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < refs.length && out.length < 4; i += 7) out.push(refs.slice(i, i + 7));
  return out;
}

/**
 * A deck from the model's reply, or `null` when there is no slide in it.
 *
 * The model is asked for a title slide first and a closing slide last, and
 * this makes sure of both rather than trusting it. A references slide it
 * wrote is dropped (see the header); a deck made from a Research document
 * gets that document's own before the close.
 */
export function parsePlan(text: string, deck: Deck, newId: () => string): { title: string; slides: Slide[] } | null {
  const plan = slidesIn(text);
  if (!plan) return null;
  let slides = plan.slides.slice(0, 80)
    .map((x) => sanitizeSlide(x, deck.lang, newId))
    .filter((x): x is Slide => x !== null && x.kind !== 'references');
  if (!slides.length) return null;
  const words = FIXED[deck.lang];
  const first = slides.find((x) => x.kind === 'title');
  const title = clean(plan.title, CAP.title, deck.lang) || first?.title || capped(clean(deck.request, CAP.title, deck.lang), 80) || words.untitled;

  if (slides[0].kind !== 'title') {
    const at = slides.findIndex((x) => x.kind === 'title');
    if (at > 0) slides = [slides[at], ...slides.slice(0, at), ...slides.slice(at + 1)];
    else slides = [{ ...blank(newId(), 'title'), title }, ...slides];
  }
  if (!slides[0].title) slides[0] = { ...slides[0], title };
  if (slides.length < 2 || slides[slides.length - 1].kind !== 'end') {
    const at = slides.map((x) => x.kind).lastIndexOf('end');
    if (at > 0) slides = [...slides.slice(0, at), ...slides.slice(at + 1), slides[at]];
    else slides = [...slides, { ...blank(newId(), 'end'), title: words.thanks, subtitle: words.questions }];
  }
  // A reply far longer than asked keeps the opening, as many as fit, and the close.
  const max = Math.min(COUNT.max, Math.max(deck.count, modelCount(deck)) + 4);
  if (slides.length > max) slides = [...slides.slice(0, max - 1), slides[slides.length - 1]];

  const refs = refSlides(deck.refs ?? []);
  if (refs.length) {
    const heading = byWords(deck.lang).references;
    const made = refs.map((points) => ({ ...blank(newId(), 'references'), title: heading, points }));
    slides = [...slides.slice(0, -1), ...made, slides[slides.length - 1]];
  }
  return { title, slides };
}

/**
 * One slide written again, read from the reply, or `null` when there is
 * none. It keeps the old slide's id: the same place in the deck with new
 * words, so the selection and the editor stay on it. Notes the model did not
 * write again are kept.
 */
export function parseSlide(text: string, old: Slide, deck: Deck, newId: () => string): Slide | null {
  if (typeof text !== 'string') return null;
  let o = jsonIn(text) as Record<string, unknown> | null;
  if (o && typeof o.slide === 'object' && o.slide !== null) o = o.slide as Record<string, unknown>;
  else if (o && Array.isArray(o.slides) && o.slides.length) o = o.slides[0] as Record<string, unknown>;
  const s = sanitizeSlide(o, deck.lang, newId);
  if (!s || s.kind === 'references') return null;
  return { ...s, id: old.id || s.id, notes: s.notes || old.notes };
}

/** A slide added by hand: the kind's shape, with words to replace. */
export function blankSlide(kind: SlideKind, deck: Pick<Deck, 'lang' | 'title'>, newId: () => string): Slide {
  const w = FIXED[deck.lang] ?? FIXED.en;
  const s = blank(newId(), kind);
  s.title = kind === 'end' ? w.thanks : kind === 'title' ? deck.title || w.untitled : kind === 'references' ? byWords(deck.lang).references : kind === 'quote' ? '' : w.slide;
  if (kind === 'end') s.subtitle = w.questions;
  if (kind === 'bullets' || kind === 'references') s.points = [w.point];
  if (kind === 'two') { s.head = '1'; s.head2 = '2'; s.points = [w.point]; s.points2 = [w.point]; }
  if (kind === 'stat') s.pairs = [{ a: '0', b: w.point }];
  if (kind === 'timeline') s.pairs = [{ a: '1', b: w.point }, { a: '2', b: w.point }, { a: '3', b: w.point }];
  if (kind === 'table') s.rows = [['A', 'B'], ['', '']];
  if (kind === 'quote') s.body = w.point;
  return s;
}

// ── from a Research document ──────────────────────────────────────────────

/** How much of a document the model is given. A thesis is far more; the slides need its findings, not its prose. */
export const SOURCE_BUDGET = 40_000;

/** A section's text as the model is given it: markers, gaps and markup out, white space tidied. */
function plainOf(text: string): string {
  return text
    .replace(/\[@[^\]]*\]/g, '')
    .replace(/\[\[[^\]]*\]\]/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** One reference, short: "Family, G. (2020). Title. Venue." — the app's words, from the record. */
export function refLine(s: Source): string {
  const people = (s.authors ?? []).slice(0, 3).map((p) => [p.family, p.given ? `${p.given.trim()[0]}.` : ''].filter(Boolean).join(', '));
  const who = people.length ? `${people.join('; ')}${(s.authors?.length ?? 0) > 3 ? ' et al.' : ''}` : '';
  const year = s.year ? `(${s.year})` : '';
  const parts = [[who, year].filter(Boolean).join(' '), s.title?.trim(), s.venue?.trim()].filter(Boolean);
  return capped(parts.join('. ').replace(/\.\./g, '.'), CAP.point);
}

/** The kind of presentation a Research document is defended or presented with. */
function kindForDoc(doc: Pick<Doc, 'kind'>): DeckKind {
  return doc.kind === 'masters' || doc.kind === 'phd' || doc.kind === 'graduation' || doc.kind === 'proposal' ? 'defense' : 'conference';
}

/**
 * What a deck made from a Research document starts with: its language, its
 * title, the cover's names, the parts the model presents from, and the
 * references it may show — only sources the document cites, when it cites
 * any, from the records it holds.
 */
export function fromResearch(doc: Doc): {
  request: string; kind: DeckKind; lang: DeckLang; title: string; meta: DeckMeta; source: string; refs: string[];
  logo?: string; digits?: 'eastern' | 'western';
} {
  const lang = doc.lang;
  const title = doc.meta?.title?.trim() || doc.request.trim();
  const written = doc.sections.filter((s) => s.text.trim());
  const per = Math.max(600, Math.floor((SOURCE_BUDGET - 4000) / Math.max(1, written.length)));
  const head = [
    `Title: ${title}`,
    doc.abstract?.trim() ? `Abstract: ${plainOf(doc.abstract)}` : '',
    doc.keywords?.length ? `Keywords: ${doc.keywords.join(', ')}` : '',
  ].filter(Boolean).join('\n');
  const parts = doc.sections.map((s) => {
    const heading = `${'#'.repeat(s.level)} ${s.heading.trim()}`;
    const body = plainOf(s.text);
    return body ? `${heading}\n${capped(body, per)}` : heading;
  });
  const source = capped([head, '', ...parts].join('\n\n'), SOURCE_BUDGET);

  const usable = citable(doc.sources ?? []);
  const text = doc.sections.map((s) => s.text).join('\n');
  const cited = usable.filter((s) => text.includes(`@${s.key}`));
  const refs = (cited.length ? cited : usable).slice(0, 28).map(refLine).filter(Boolean);

  const m = doc.meta;
  const meta: DeckMeta = {
    presenter: m?.author?.trim() ?? '',
    supervisor: m?.supervisor?.trim() ?? '',
    university: m?.university?.trim() ?? '',
    college: [m?.college, m?.department].map((x) => x?.trim()).filter(Boolean).join(' — '),
    date: m?.year?.trim() ?? '',
  };
  return {
    request: title,
    kind: kindForDoc(doc),
    lang,
    title,
    meta,
    source,
    refs,
    ...(doc.logo ? { logo: doc.logo } : {}),
    ...(doc.digits ? { digits: doc.digits } : {}),
  };
}

/** A file name for the deck: its title, without what a file system refuses. */
export function fileNameFor(deck: Pick<Deck, 'title' | 'request'>, ext: 'pptx' | 'pdf'): string {
  const base = (deck.title || deck.request || 'Slides')
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, '');
  return `${base || 'Slides'}.${ext}`;
}
