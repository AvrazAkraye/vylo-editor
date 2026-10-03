/*
 * Portions derived from HyperFrames (heygen-com/hyperframes, Apache-2.0),
 * packages/cli/src/registry/localSearch.ts: the scoring scheme (a name or tag
 * word worth three of a description word, the smoothed rarity weight
 * ln((N+1)/(df+1)) + 1, the score divided by the square root of the entry's
 * word count) and the four plural-folding rules.
 * Changed: rewritten for Motion's templates; Arabic-script folding (marks,
 * tatweel, alef and yeh and kaf forms, the article, Eastern digits) so Arabic,
 * Sorani and Badini are searched as well as English; the interface's own
 * translations and words of each language in the index; prefix matches, so the
 * results follow typing; ties kept in the gallery's order; a recent list.
 */
import { translator, type Lang } from './i18n';
import type { Motion, RecipeGroup, RecipeId } from './motiontypes';
import { LANGUAGES, RECIPE_GROUPS } from './motiontypes';
import { META, recipesOf, type RecipeMeta } from './motionrecipe';

/**
 * Finding a template by typing a few words, offline.
 *
 * There will soon be many more templates than fit on a screen, and a person
 * looking for "the one with the name at the bottom" types *name* — not the
 * template's name, which they do not know. So each template is described in
 * the words people use for it (`RecipeMeta.tags`, `useWhen`), and this matches
 * what is typed against those, its name and its description, in English and in
 * the interface's language. No model, no network, no dependency: a few hundred
 * words, scored in well under a millisecond.
 *
 * ## How a template scores
 *
 * What is typed and what a template says are both folded the same way (see
 * `foldSearch`) and split into words. A word the template is *named* or
 * *tagged* with counts three times one in its description; a word only the
 * beginning of one of its words — "coun" while "countdown" is being typed —
 * counts half. Each counts by how rare it is among the templates, so "chart",
 * which four templates mention, decides less than "donut", which one does. The
 * sum is divided by the square root of how many words the template has, or the
 * wordiest description would win every search. Words that say nothing ("a",
 * "the", "template", "في", "لە") are dropped first.
 *
 * Templates that share no word with the search are left out; the rest come
 * best first, and equal scores keep the gallery's order, so the same search
 * always lists the same templates in the same order. A search of nothing — or
 * of nothing but punctuation and dropped words — is no search, and lists every
 * template in the gallery's order.
 *
 * ## Arabic, Sorani and Badini
 *
 * Arabic script is written with optional marks and in several forms of the
 * same letter, and a search must not miss "الشعار" because it was typed
 * "الشعار" with a hamza or without one. Folding strips the vowel marks and the
 * tatweel, makes one letter of the alef forms, of Arabic and Persian yeh and
 * alef maqsura, of Arabic and Persian kaf, of the hehs and of teh marbuta, and
 * drops the article from the front of a word; Eastern digits become 0-9. The
 * index of each language holds the names, descriptions, field labels and group
 * names the interface already shows in it (`i18n.ts`), and a few words of its
 * own per template (`LOCAL_WORDS`), and always the English too — people type
 * "logo" in Arabic as often as "شعار".
 */

/** The groups' names, which are also `i18n.ts` keys: the gallery's chips show them, and the search matches them. */
export const GROUP_NAMES: Readonly<Record<RecipeGroup, string>> = {
  titles: 'Titles', overlays: 'Overlays', data: 'Numbers and data', brand: 'Brand', backgrounds: 'Backgrounds',
};

/** Every template in the gallery's order: by group, and within one as `META` lists them. */
export const GALLERY_ORDER: readonly RecipeId[] = RECIPE_GROUPS.flatMap((g) => recipesOf(g).map((m) => m.id));

/**
 * Words people use in each language for each template, beyond what its
 * translated name and description already say. Searched, never shown, so not
 * `i18n.ts` keys. The Sorani and Badini lines were written without a native
 * speaker (docs/pro/review-needed.md).
 */
const LOCAL_WORDS: Readonly<Record<'ar' | 'ckb' | 'kmr', Partial<Record<RecipeId, string>>>> = {
  ar: {
    'big-title': 'عنوان، عنوان رئيسي، افتتاحية، مقدمة، فصل، إعلان',
    kinetic: 'كلمات متحركة، شعار، عرض، تخفيضات، تنزيلات، ترويج، حماسي',
    'split-title': 'كشف، لوحات، قسم، فصل، انتقال، عنوان',
    quote: 'اقتباس، مقولة، شهادة، رأي، تقييم، قول',
    'lower-third': 'اسم، شريط الاسم، بطاقة اسم، تعريف، متحدث، مقابلة، مذيع',
    subscribe: 'اشترك، اشتراك، زر، جرس، تابع، متابعة، قناة، يوتيوب، إعجاب',
    callout: 'إشارة، سهم، مؤشر، تعليق توضيحي، تحديد، شرح',
    handle: 'حساب، اسم المستخدم، تواصل اجتماعي، انستغرام، تيك توك، تابعنا',
    'big-number': 'رقم، عداد، إحصائية، نسبة، إنجاز، نمو',
    'bar-chart': 'مخطط، رسم بياني، أعمدة، مقارنة، ترتيب، بيانات، نتائج',
    donut: 'دائري، فطيرة، حصة، نسبة مئوية، توزيع',
    'line-chart': 'خط، اتجاه، نمو، تطور، عبر الزمن، شهري',
    stats: 'إحصائيات، أرقام، إنجازات، حقائق، نتائج',
    'logo-reveal': 'شعار، لوغو، علامة تجارية، شركة، هوية، خاتمة',
    countdown: 'عد تنازلي، مؤقت، إطلاق، بداية، حدث، رأس السنة',
    intro: 'مقدمة، افتتاحية، بداية، انترو، قناة',
    steps: 'خطوات، قائمة، طريقة، شرح، مراحل، تعليمات، دليل',
    'loop-bg': 'خلفية، متكررة، حلقة، نمط، تدرج، شفق',
  },
  ckb: {
    'big-title': 'ناونیشان، سەردێڕ، دەستپێک، بەش، ڕاگەیاندن',
    kinetic: 'وشەی جووڵاو، دروشم، داشکاندن، ڕیکلام، بانگەشە',
    'split-title': 'دەرخستن، بەش، گواستنەوە، ناونیشان',
    quote: 'وتە، گوتە، بۆچوون، هەڵسەنگاندن',
    'lower-third': 'ناو، ناوی کەس، ناساندن، قسەکەر، چاوپێکەوتن، پێشکەشکار',
    subscribe: 'بەشداربوون، سبسکرایب، دوگمە، زەنگ، فۆڵۆ، کەناڵ، یوتیوب',
    callout: 'ئاماژە، تیر، نیشانە، ڕوونکردنەوە',
    handle: 'هەژمار، ناوی بەکارهێنەر، سۆشیال میدیا، ئینستاگرام، تیکتۆک',
    'big-number': 'ژمارە، ژمێرەر، ئامار، ڕێژە، گەشە',
    'bar-chart': 'هێڵکاری، چارت، ستوون، بەراوردکردن، داتا، ئەنجام',
    donut: 'بازنە، پشک، ڕێژەی سەدی، دابەشبوون',
    'line-chart': 'هێڵ، ڕەوت، گەشە، پەرەسەندن، مانگانە',
    stats: 'ئامارەکان، ژمارەکان، دەستکەوت، ڕاستی',
    'logo-reveal': 'لۆگۆ، براند، کۆمپانیا، ناسنامە، کۆتایی',
    countdown: 'ژماردنی پێچەوانە، کاتژمێر، دەستپێکردن، بۆنە، ساڵی نوێ',
    intro: 'دەستپێک، پێشەکی، ئینترۆ، کەناڵ',
    steps: 'هەنگاو، لیست، ڕێگا، ڕێنمایی، قۆناغ',
    'loop-bg': 'باکگراوند، پاشبنەما، دووبارە، نەخش، ڕەنگاوڕەنگ',
  },
  kmr: {
    'big-title': 'سەرناڤ، ناڤونیشان، دەستپێک، پشک، ڕاگەهاندن',
    kinetic: 'پەیڤێن لڤۆک، دروشم، داشکاندن، ڕێکلام',
    'split-title': 'ئاشکەراکرن، پشک، ڤەگوهاستن، سەرناڤ',
    quote: 'گۆتن، بۆچوون، هەلسەنگاندن',
    'lower-third': 'ناڤ، ناڤێ کەسی، ناساندن، ئاخڤەر، چاڤپێکەفتن',
    subscribe: 'بەشداربوون، سبسکرایب، دوگمە، زەنگ، فۆلۆ، کەنال، یوتیوب',
    callout: 'ئاماژە، تیر، نیشان، ڕوونکرن',
    handle: 'هژمار، ناڤێ بکارهێنەری، سۆشیال میدیا، ئینستاگرام، تیکتۆک',
    'big-number': 'ژمارە، ژمێرەر، ئامار، ڕێژە، گەشە',
    'bar-chart': 'چارت، ستوین، بەراوردکرن، داتا، ئەنجام',
    donut: 'بازنە، پشک، ڕێژا سەدی',
    'line-chart': 'هێل، ڕەوت، گەشە، پێشکەفتن، هەیڤانە',
    stats: 'ئامار، ژمارە، دەستکەفت، ڕاستی',
    'logo-reveal': 'لۆگۆ، براند، کۆمپانی، ناسنامە، دوماهی',
    countdown: 'هژمارتنا بەرەڤاژی، دەمژمێر، دەستپێکرن، بۆنە، سالا نوی',
    intro: 'دەستپێک، پێشەکی، ئینترۆ، کەنال',
    steps: 'پێنگاڤ، لیست، ڕێک، ڕێنمایی، قوناغ',
    'loop-bg': 'باکگراوند، پاشبنەما، دووبارە، نەخش',
  },
};

// ── folding ───────────────────────────────────────────────────────────────

/** Combining marks left by decomposition (Latin accents), and the Arabic vowel marks, Quranic marks and superscript alef. */
const MARKS = /[\u0300-\u036f\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e4\u06e7\u06e8\u06ea-\u06ed]/g;
/** Tatweel, and the invisible joiners and direction marks a word can carry. */
const INVISIBLE = /[\u0640\u061c\u200b-\u200f\u2066-\u2069\u202a-\u202e\ufeff]/g;

/** One letter for each family of forms: after decomposition the hamza and madda are marks, so أ إ آ are already ا. */
const SAME_LETTER: Readonly<Record<string, string>> = {
  '\u0671': '\u0627', // alef wasla to alef
  '\u0649': '\u064a', // alef maqsura to yeh
  '\u06cc': '\u064a', // Persian / Kurdish yeh to Arabic yeh
  '\u06a9': '\u0643', // keheh (Persian / Kurdish kaf) to kaf
  '\u0629': '\u0647', // teh marbuta to heh
  '\u06be': '\u0647', // heh doachashmee (Sorani h) to heh
  '\u06c1': '\u0647', // heh goal to heh
};

/**
 * Text as the search compares it: decomposed so accents and Arabic marks can
 * go, lower case, the Arabic-script letter forms made one (see the header),
 * Eastern Arabic and Persian digits as 0-9, invisible characters removed.
 */
export function foldSearch(text: string): string {
  return String(text ?? '')
    .slice(0, 4000)
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(INVISIBLE, '')
    .toLowerCase()
    .replace(/[\u0671\u0649\u06cc\u06a9\u0629\u06be\u06c1]/g, (c) => SAME_LETTER[c] ?? c)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

const ARABIC = /[\u0600-\u06ff]/;

/** Words that decide nothing, folded the way the text is. */
const STOP: ReadonlySet<string> = new Set([
  ...('the a an and or of to in on at is are be it its for with that this as by from into one not no all over under when where which who ' +
    'they them their we our you your he she his her but if then than so such can may will each other some any every my me want need ' +
    'make create show please template templates graphic graphics animation animated motion video').split(' '),
  ...'من في على إلى عن مع أو ثم هذا هذه ذلك تلك التي الذي أن كل لي لك يا'.split(' '),
  ...'لە بۆ بە کە لەگەڵ ئەم ئەو یان دا'.split(' '),
  ...'ل ب کو دگەل ئەڤ ژ'.split(' '),
].map((w) => foldSearch(w)));

/**
 * The plural folded to its singular, and nothing else: "charts" is "chart",
 * "stories" is "story", "boxes" is "box", but "press", "status" and "axis"
 * keep their s. Not a stemmer: "counter" stays "counter".
 */
function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/[^aeiou]ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2);
  if (/(ss|us|is)$/.test(w)) return w;
  return w.endsWith('s') ? w.slice(0, -1) : w;
}

/** One word as the index keeps it: an Arabic-script word without its article, a Latin one in the singular. */
function wordOf(w: string): string {
  if (ARABIC.test(w)) return w.length >= 4 && w.startsWith('\u0627\u0644') ? w.slice(2) : w;
  return singular(w);
}

/** The words of a text, folded, the empty and the dropped left out, in order. */
export function searchWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of foldSearch(text).split(/[^\p{L}\p{N}]+/u)) {
    if (Array.from(raw).length < 2 || STOP.has(raw)) continue;
    const w = wordOf(raw);
    if (Array.from(w).length >= 2 && !STOP.has(w)) out.push(w);
  }
  return out;
}

// ── the index ─────────────────────────────────────────────────────────────

interface Entry {
  id: RecipeId;
  /** Its names and tags, in English and the language: a hit here counts three times. */
  strong: ReadonlySet<string>;
  /** Everything: its description, when to use it, its fields and its group too. */
  all: ReadonlySet<string>;
  /** Its words as one list, for matching the start of a word. */
  words: readonly string[];
  strongWords: readonly string[];
}

/** A word in a name or tag is worth this many in a description. */
const STRONG = 3;
/** The start of a word, while it is being typed, is worth this much of the whole word. */
const PREFIX = 0.5;
/** The most words of a search that are looked at; the rest add nothing a person would notice. */
const MOST_WORDS = 12;

const indexes = new Map<Lang, readonly Entry[]>();

function entryOf(m: RecipeMeta, lang: Lang): Entry {
  const t = translator(lang);
  const local = lang === 'en' ? undefined : LOCAL_WORDS[lang]?.[m.id];
  const strongText = [m.name, t(m.name), ...(m.tags ?? []), local ?? ''];
  const weakText = [
    m.about, t(m.about), m.useWhen ?? '', GROUP_NAMES[m.group], t(GROUP_NAMES[m.group]),
    ...m.fields.flatMap((f) => [f.label, t(f.label)]),
  ];
  const strong = new Set(strongText.flatMap(searchWords));
  const all = new Set([...strong, ...weakText.flatMap(searchWords)]);
  return { id: m.id, strong, all, words: [...all], strongWords: [...strong] };
}

/** Every template's words in a language, in the gallery's order. Built once a language; a code that is not one of the four is English. */
function indexOf(asked: Lang): readonly Entry[] {
  const lang: Lang = LANGUAGES.includes(asked) ? asked : 'en';
  let index = indexes.get(lang);
  if (!index) {
    index = GALLERY_ORDER.filter((id) => META[id]).map((id) => entryOf(META[id], lang));
    indexes.set(lang, index);
  }
  return index;
}

/** How much a template has of a word: the whole word or only its start, in a name or tag or anywhere. */
function hitOf(e: Entry, q: string): number {
  if (e.strong.has(q)) return STRONG;
  if (e.all.has(q)) return 1;
  if (e.strongWords.some((w) => w.length > q.length && w.startsWith(q))) return STRONG * PREFIX;
  if (e.words.some((w) => w.length > q.length && w.startsWith(q))) return PREFIX;
  return 0;
}

/**
 * The templates a search finds, best first (see the header): every template in
 * the gallery's order when nothing searchable was typed, none when nothing
 * matches. Pure: the same words in the same language give the same list.
 */
export function searchRecipes(query: string, lang: Lang): RecipeId[] {
  const index = indexOf(lang);
  const asked = [...new Set(searchWords(String(query ?? '').slice(0, 400)))].slice(0, MOST_WORDS);
  if (!asked.length) return index.map((e) => e.id);
  const hits = asked.map((q) => index.map((e) => hitOf(e, q)));
  const n = index.length;
  const rarity = hits.map((row) => Math.log((n + 1) / (row.filter((h) => h > 0).length + 1)) + 1);
  const scored = index.map((e, i) => {
    let score = 0;
    for (let k = 0; k < asked.length; k++) score += rarity[k] * hits[k][i];
    return { id: e.id, at: i, score: score / Math.sqrt(Math.max(1, e.all.size)) };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.at - b.at).map((s) => s.id);
}

/**
 * The templates used most recently, newest first and each once: from the
 * graphics kept on this machine (`motionstore.ts`), each of which remembers
 * the template it was started from while it is still that template's. A
 * graphic edited by hand no longer counts, and nor does a template that no
 * longer exists.
 */
export function recentRecipes(motions: ReadonlyArray<Pick<Motion, 'recipe' | 'updated'>>, most = 4): RecipeId[] {
  const out: RecipeId[] = [];
  const order = motions
    .map((m, i) => ({ id: m?.recipe?.id, updated: Number.isFinite(m?.updated) ? m.updated : 0, i }))
    .sort((a, b) => b.updated - a.updated || a.i - b.i);
  for (const m of order) {
    if (out.length >= Math.max(0, most)) break;
    if (m.id && META[m.id] && !out.includes(m.id)) out.push(m.id);
  }
  return out;
}
