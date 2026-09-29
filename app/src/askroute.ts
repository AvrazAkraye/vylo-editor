import { detect, type Kind } from './research';
import { fold } from './settings';

/**
 * Ask Vylo: one box, anywhere in the app, that sends what you ask to the part
 * of the app that does it — a new Research document, a video, a motion graphic, a presentation
 * (from words, or from a Research document you wrote), a message to one of
 * your documents' Chat tab, or the ordinary chat.
 *
 * Routed here, on this machine, without asking a model: the words that
 * decide it are the ones the modules already activate on (research.ts's
 * skills, the words for a video or a presentation), plus the ones that point
 * at a document you already have ("my thesis", "بحثي", "توێژینەوەکەم"). The
 * box shows where a request will go and the phrase that decided it, as the
 * Research skill chip does, and the destination can be changed before it is
 * sent. What happens next is each module's own run, started as its own form
 * would start it — nothing here writes a file or runs anything.
 *
 * Pure, and tested in test/askroute.test.mjs.
 */

export type Dest = 'research' | 'video' | 'motion' | 'slides' | 'doc-chat' | 'chat';

export interface DocRef { id: string; title: string; kind: Kind; updated: number }

export interface Route {
  dest: Dest;
  /** The phrase that decided it, as typed; empty when nothing did and it is the chat. */
  phrase: string;
  /** For Research: the kind of document the words named. */
  kind?: Kind;
  /** For slides from a document, and for a document's chat: which document. */
  docId?: string;
}

/** Words that ask for a video, in every language the app speaks. */
const VIDEO = [
  'video', 'videos', 'clip', 'reel', 'reels', 'tiktok', 'short film', 'promo video', 'mp4',
  'فيديو', 'فديو', 'مقطع فيديو', 'ريلز',
  'ڤیدیۆ', 'ڤیدیو', 'ڤیدۆ', 'ڤیدیۆیەک', 'ڤیدیۆیەکی', 'ڤیدیۆیەکێ', 'کلیپ',
];

/**
 * Words that ask for a motion graphic: an animated title, a lower third, a logo
 * reveal, a chart that draws itself. Specific on purpose — "animation" alone is
 * as likely to be about a button in the code, and a request that names a video
 * as well ("a motion graphic video") is still this, so it is checked first.
 */
const MOTION = [
  'motion graphic', 'motion graphics', 'lower third', 'lower thirds', 'logo reveal', 'logo sting', 'intro sting',
  'animated title', 'animated titles', 'animated text', 'animated logo', 'animated chart', 'animated graph',
  'animated counter', 'animated number', 'kinetic type', 'kinetic typography', 'title animation', 'text animation',
  'موشن جرافيك', 'موشن غرافيك', 'موشن', 'عنوان متحرك', 'نص متحرك', 'شعار متحرك', 'مخطط متحرك', 'ثلث سفلي', 'لوير ثيرد', 'إنترو', 'انترو',
  'مۆشن گرافیک', 'مۆشن', 'ناونیشانی جوڵاو', 'نووسینی جوڵاو', 'لۆگۆی جوڵاو', 'گرافیکی جوڵاو', 'ئەنیمەیشن',
  'ناڤونیشانێ جوڵاو', 'لۆگۆیێ جوڵاو', 'گرافیکا جوڵاو',
];

/** Words that ask for a presentation. */
const SLIDES = [
  'slides', 'slide deck', 'slideshow', 'slide show', 'presentation', 'powerpoint', 'power point', 'pptx', 'deck',
  'عرض تقديمي', 'عرضا تقديميا', 'عرضاً تقديمياً', 'شرائح', 'شرائح عرض', 'بوربوينت', 'باوربوينت',
  'سلاید', 'سلایدەکان', 'سلایدێن', 'پێشکەشکردن', 'پێشکێشکرن', 'پاوەرپۆینت',
];

/**
 * Words that point at a document you already have, rather than asking for a
 * new one: a possessive, or "the document". "رسالة ماجستير عن…" is a new
 * thesis; "رسالتي" is yours.
 */
const MINE = [
  'my thesis', 'my dissertation', 'my paper', 'my document', 'my research', 'my article', 'my working paper', 'my review',
  'this document', 'the document', 'this thesis', 'this paper', 'my latest', 'from my', 'of my', 'in my',
  'بحثي', 'رسالتي', 'أطروحتي', 'اطروحتي', 'مستندي', 'ورقتي', 'مقالي', 'هذا البحث', 'هذه الرسالة', 'هذا المستند', 'المستند',
  'توێژینەوەکەم', 'نامەکەم', 'بەڵگەنامەکەم', 'وتارەکەم', 'ئەم توێژینەوەیە', 'ئەم بەڵگەنامەیە', 'بەڵگەنامەکە',
  'ڤەکولینا من', 'ڤەکۆلینا من', 'نامەیا من', 'بەلگەنامێ من', 'ئەڤ ڤەکولینە', 'بەلگەنامێ',
];

const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

/** The one-letter and short prefixes Arabic and Kurdish write onto a word: و، ف، ب، ل، بۆ، لە، ژ، د. */
const PREFIXES = () => ['و', 'ف', 'ب', 'ل', 'بۆ', 'لە', 'ژ', 'د'].map(norm).map(escape).join('|');

/** Folded for matching, and every run of spaces one space. */
const norm = (s: string) => fold(s).replace(/[\u200c\u200d]/g, '').replace(/\s+/g, ' ').trim();

/**
 * The phrase of `list` in `text`, the longest first, as the text spells it.
 * Latin phrases on word boundaries; Arabic-script ones where a word starts, so
 * a prefix (و، ب، ل، بۆ) does not hide them and "مقطع" inside another word
 * does not count.
 */
function find(text: string, list: readonly string[]): string {
  const t = ` ${norm(text)} `;
  const sorted = [...list].map((p) => ({ p, n: norm(p) })).sort((a, b) => b.n.length - a.n.length);
  for (const { p, n } of sorted) {
    if (!n) continue;
    if (ARABIC_SCRIPT.test(n)) {
      const re = new RegExp(`(?:^|[\\s(«"'،,.:؛;!?؟])(?:${PREFIXES()})?${escape(n)}(?=$|[\\s)»"'،,.:؛;!?؟])`, 'u');
      if (re.test(t)) return p;
    } else if (new RegExp(`(?:^|[^\\p{L}\\p{N}])${escape(n)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(t)) {
      return p;
    }
  }
  return '';
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
}

/** The document a request most likely means: of the kind it names, else the newest. */
function docFor(kind: Kind | undefined, docs: readonly DocRef[]): string | undefined {
  const byNew = [...docs].sort((a, b) => b.updated - a.updated);
  return (kind ? byNew.find((d) => d.kind === kind) : undefined)?.id ?? byNew[0]?.id;
}

/**
 * Where a request goes. A presentation or a video named anywhere wins — "make
 * slides from my thesis" is slides, from that thesis. A document of your own
 * named with no new one asked for is that document's chat. A kind of document
 * named is a new Research document. Anything else is the chat. A module that
 * is off is never chosen; its request goes on down the list.
 */
export function route(text: string, ctx: { docs: readonly DocRef[]; on: ReadonlySet<'research' | 'video' | 'motion' | 'slides'> }): Route {
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return { dest: 'chat', phrase: '' };
  const mine = find(s, MINE);
  const found = detect(s);
  const slides = find(s, SLIDES);
  if (slides && ctx.on.has('slides')) {
    const docId = mine && ctx.docs.length ? docFor(found?.kind, ctx.docs) : undefined;
    return { dest: 'slides', phrase: slides, ...(docId ? { docId } : {}) };
  }
  const motion = find(s, MOTION);
  if (motion && ctx.on.has('motion')) return { dest: 'motion', phrase: motion };
  const video = find(s, VIDEO);
  if (video && ctx.on.has('video')) return { dest: 'video', phrase: video };
  if (mine && ctx.docs.length && ctx.on.has('research')) {
    return { dest: 'doc-chat', phrase: mine, docId: docFor(found?.kind, ctx.docs) };
  }
  if (found && ctx.on.has('research')) return { dest: 'research', phrase: found.trigger, kind: found.kind };
  return { dest: 'chat', phrase: '' };
}

/** The destinations the box offers, in order, given what is switched on and whether there are documents. */
export function destinations(on: ReadonlySet<'research' | 'video' | 'motion' | 'slides'>, hasDocs: boolean): Dest[] {
  return [
    ...(on.has('research') ? ['research' as const] : []),
    ...(on.has('research') && hasDocs ? ['doc-chat' as const] : []),
    ...(on.has('video') ? ['video' as const] : []),
    ...(on.has('motion') ? ['motion' as const] : []),
    ...(on.has('slides') ? ['slides' as const] : []),
    'chat' as const,
  ];
}
