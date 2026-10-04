import { TEMPLATES_A } from './whatsapptemplates-a';
import { TEMPLATES_B } from './whatsapptemplates-b';
import { LIMITS, MESSAGE_LANGS, type Category, type CategoryId, type Lang, type Template, type TemplateKind } from './whatsappbulktypes';

/**
 * The ready messages: what a shopkeeper picks in step 2 of a broadcast, fills two blanks of, and sends
 * (docs/WA.md, docs/wa/templates.md).
 *
 * This file is the library's API — the categories, lookup, search and filling. The messages themselves are
 * data in two files written side by side: `whatsapptemplates-a.ts` (sales, openings, appointments, holidays,
 * …) and `whatsapptemplates-b.ts` (orders, delivery, payments, codes, …). Nothing here knows which half a
 * message came from; the screens, the writer and the assistant read only these names.
 *
 * ## What the library promises, and why it is data rather than generated text
 *
 * A message from this list goes to hundreds of people from the owner's own number. So every text is written
 * once, by hand, in English, Arabic, Sorani and Badini, says nothing the sender has not filled in (a price,
 * a percentage, a date is always a `{placeholder}`), and is checked by the tests in `test/wa-templates*.mjs`
 * — the same placeholders in all four languages, no stray Latin letters in the right-to-left ones, no number
 * that was not the sender's, nothing over 700 characters. A model can write a fresh one (whatsappwrite.ts);
 * this list is the part that is right before anyone presses anything.
 */

// ── the categories ────────────────────────────────────────────────────────

/**
 * All twenty-six categories, in the order a person looks for them: selling first (the reason most people
 * open Broadcast), then the occasions they send to everyone, then looking after the people who already
 * bought, then the trades with their own vocabulary, then the plain notices and codes.
 *
 * Each icon is an `Icon.tsx` name, and no two categories share one, so a row of chips can be told apart at a
 * glance in a 248 px column. The titles are short because they are chips: two words at most where a language
 * allows it.
 */
const CATEGORY_LIST: Category[] = [
  { id: 'sale', icon: 'memory', title: { en: 'Sales & discounts', ar: 'تخفيضات وعروض', ckb: 'داشکاندن', kmr: 'داشکاندن' } },
  { id: 'new', icon: 'sparkle', title: { en: 'New arrivals', ar: 'وصل حديثاً', ckb: 'بەرهەمی نوێ', kmr: 'بەرهەمێن نوی' } },
  { id: 'flash', icon: 'bolt', title: { en: 'Flash sales', ar: 'عروض خاطفة', ckb: 'داشکاندنی خێرا', kmr: 'داشکاندنا بلەز' } },
  { id: 'code', icon: 'clipboard', title: { en: 'Promo codes', ar: 'أكواد الخصم', ckb: 'کۆدی داشکاندن', kmr: 'کۆدێن داشکاندنێ' } },
  { id: 'holiday', icon: 'image', title: { en: 'Holidays & greetings', ar: 'أعياد ومناسبات', ckb: 'جەژن و بۆنەکان', kmr: 'جەژن و بۆنە' } },
  { id: 'event', icon: 'calendar', title: { en: 'Events & invitations', ar: 'فعاليات ودعوات', ckb: 'چالاکی و بانگهێشت', kmr: 'چالاکی و ڤەخوەندن' } },
  { id: 'opening', icon: 'play', title: { en: 'Openings', ar: 'افتتاح', ckb: 'کردنەوە', kmr: 'ڤەکرن' } },
  { id: 'restock', icon: 'check', title: { en: 'Back in stock', ar: 'متوفر من جديد', ckb: 'دووبارە بەردەستە', kmr: 'دیسان بەردەستە' } },
  { id: 'loyalty', icon: 'person', title: { en: 'Loyalty & points', ar: 'الولاء والنقاط', ckb: 'خاڵ و کڕیاری بەردەوام', kmr: 'خال و کریارێن بەردەوام' } },
  { id: 'referral', icon: 'link', title: { en: 'Referrals', ar: 'دعوة الأصدقاء', ckb: 'ناساندنی هاوڕێ', kmr: 'ناساندنا هەڤالان' } },
  { id: 'birthday', icon: 'camera', title: { en: 'Birthdays', ar: 'أعياد الميلاد', ckb: 'ڕۆژی لەدایکبوون', kmr: 'ڕۆژبوون' } },
  { id: 'welcome', icon: 'chat', title: { en: 'Welcome', ar: 'ترحيب', ckb: 'بەخێرهاتن', kmr: 'ب خێرهاتن' } },
  { id: 'cart', icon: 'attach', title: { en: 'Left in the cart', ar: 'سلة لم تكتمل', ckb: 'سەبەتەی تەواونەکراو', kmr: 'سەبەتەیا نەتمام' } },
  { id: 'order', icon: 'folder', title: { en: 'Orders', ar: 'الطلبات', ckb: 'داواکاری', kmr: 'داخوازی' } },
  { id: 'delivery', icon: 'send', title: { en: 'Delivery', ar: 'التوصيل', ckb: 'گەیاندن', kmr: 'گەهاندن' } },
  { id: 'payment', icon: 'file', title: { en: 'Payments', ar: 'المدفوعات', ckb: 'پارەدان', kmr: 'پارەدان' } },
  { id: 'appointment', icon: 'clock', title: { en: 'Appointments', ar: 'المواعيد', ckb: 'ژوان', kmr: 'ژڤان' } },
  { id: 'followup', icon: 'search', title: { en: 'Follow-ups', ar: 'متابعة', ckb: 'بەدواداچوون', kmr: 'بەدویداچوون' } },
  { id: 'review', icon: 'star', title: { en: 'Reviews', ar: 'التقييمات', ckb: 'هەڵسەنگاندن', kmr: 'هەلسەنگاندن' } },
  { id: 'survey', icon: 'list', title: { en: 'Surveys', ar: 'استبيانات', ckb: 'ڕاپرسی', kmr: 'ڕاپرسی' } },
  { id: 'food', icon: 'flame', title: { en: 'Food & restaurants', ar: 'مطاعم وطعام', ckb: 'خواردن و چێشتخانە', kmr: 'خوارن و خوارنگەه' } },
  { id: 'property', icon: 'grid', title: { en: 'Real estate', ar: 'عقارات', ckb: 'خانووبەرە', kmr: 'خانووبەرە' } },
  { id: 'course', icon: 'film', title: { en: 'Courses & schools', ar: 'دورات ومدارس', ckb: 'خول و قوتابخانە', kmr: 'خول و قوتابخانە' } },
  { id: 'health', icon: 'plus', title: { en: 'Clinics & health', ar: 'عيادات وصحة', ckb: 'نۆڕینگە و تەندروستی', kmr: 'کلینیک و ساخلەمی' } },
  { id: 'notice', icon: 'warning', title: { en: 'Notices', ar: 'إشعارات', ckb: 'ئاگاداری', kmr: 'ئاگەهداری' } },
  { id: 'verify', icon: 'shield', title: { en: 'Codes & security', ar: 'رموز التحقق', ckb: 'کۆدی پشتڕاستکردنەوە', kmr: 'کۆدێن پشتڕاستکرنێ' } },
];

export const CATEGORIES: readonly Category[] = Object.freeze(
  CATEGORY_LIST.map((c) => Object.freeze({ ...c, title: Object.freeze({ ...c.title }) })),
);

/** A category by its id, or `undefined` for anything that is not one (a stored id from an older version, a typo, not a string). */
export function categoryById(id: unknown): Category | undefined {
  return typeof id === 'string' ? CATEGORIES.find((c) => c.id === id) : undefined;
}

/** Where a category stands in `CATEGORIES`; unknown ones go last, so a stray message is listed rather than lost. */
const CATEGORY_RANK: ReadonlyMap<string, number> = new Map(CATEGORIES.map((c, i) => [c.id, i]));
const rankOf = (id: string): number => CATEGORY_RANK.get(id) ?? CATEGORIES.length;

// ── the placeholders ──────────────────────────────────────────────────────

/**
 * Every placeholder a ready message may use, and nothing else.
 *
 * One fixed list, so that the form in step 2 can label each blank, the test can reject `{Name}` and
 * `{ business }` before a customer sees them, and the two halves of the library cannot drift into synonyms
 * (`{shop}` here, `{business}` there). The engine fills `{name}` from each person's row; every other one is
 * filled once, by the sender, through `fillTemplate`.
 */
export const PLACEHOLDERS: readonly string[] = Object.freeze([
  'name', 'business', 'offer', 'price', 'old_price', 'discount', 'code', 'date', 'time', 'place', 'address',
  'link', 'phone', 'product', 'service', 'hours', 'points', 'days',
]);

/**
 * The placeholders that differ from person to person and so are left for the engine (`whatsappcampaign.ts`),
 * never asked of the sender. Only `{name}` among the library's own; an audience's columns (`{city}`) are
 * the engine's too, and are never in a ready message.
 */
const PER_PERSON: ReadonlySet<string> = new Set(['name']);

/**
 * What each placeholder is called on the form, in the four languages: the label above the blank the sender
 * fills. Kept here, beside the list, so a placeholder cannot be added without a label.
 */
export const PLACEHOLDER_TITLES: Readonly<Record<string, Readonly<Record<Lang, string>>>> = Object.freeze({
  name: { en: 'Name', ar: 'الاسم', ckb: 'ناو', kmr: 'ناڤ' },
  business: { en: 'Business name', ar: 'اسم النشاط التجاري', ckb: 'ناوی کار', kmr: 'ناڤێ کاری' },
  offer: { en: 'The offer', ar: 'العرض', ckb: 'ئۆفەر', kmr: 'ئۆفەر' },
  price: { en: 'Price', ar: 'السعر', ckb: 'نرخ', kmr: 'بها' },
  old_price: { en: 'Old price', ar: 'السعر السابق', ckb: 'نرخی پێشوو', kmr: 'بهایێ بەرێ' },
  discount: { en: 'Discount', ar: 'نسبة الخصم', ckb: 'ڕێژەی داشکاندن', kmr: 'ڕێژەیا داشکاندنێ' },
  code: { en: 'Code', ar: 'الكود', ckb: 'کۆد', kmr: 'کۆد' },
  date: { en: 'Date', ar: 'التاريخ', ckb: 'بەروار', kmr: 'بەروار' },
  time: { en: 'Time', ar: 'الوقت', ckb: 'کات', kmr: 'دەم' },
  place: { en: 'Place', ar: 'المكان', ckb: 'شوێن', kmr: 'جه' },
  address: { en: 'Address', ar: 'العنوان', ckb: 'ناونیشان', kmr: 'ناڤونیشان' },
  link: { en: 'Link', ar: 'الرابط', ckb: 'بەستەر', kmr: 'لینک' },
  phone: { en: 'Phone', ar: 'الهاتف', ckb: 'مۆبایل', kmr: 'مۆبایل' },
  product: { en: 'Product', ar: 'المنتج', ckb: 'بەرهەم', kmr: 'بەرهەم' },
  service: { en: 'Service', ar: 'الخدمة', ckb: 'خزمەتگوزاری', kmr: 'خزمەت' },
  hours: { en: 'Opening hours', ar: 'أوقات الدوام', ckb: 'کاتی کارکردن', kmr: 'دەمێن کاری' },
  points: { en: 'Points', ar: 'النقاط', ckb: 'خاڵ', kmr: 'خال' },
  days: { en: 'Days', ar: 'الأيام', ckb: 'ڕۆژ', kmr: 'ڕۆژ' },
});

/**
 * A placeholder as written in a message: a brace, a name, a brace. The name stops at a brace, a bar or a
 * line break, so the engine's `{name|fallback}` is never mistaken for one of these and is left whole for
 * the engine, and a stray `{` in a sentence cannot swallow the rest of the message.
 */
const SLOT = /\{([^{}|\n]{1,40})\}/g;

/** The placeholders a text uses, each once, in the order they first appear. Anything that is not a string has none. */
export function placeholdersIn(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  const seen: string[] = [];
  for (const m of text.slice(0, LIMITS.messageChars * 2).matchAll(SLOT)) {
    const key = m[1].trim();
    if (key && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

/**
 * The blanks the sender fills for a message: its placeholders less the ones the engine fills per person.
 * What the form in step 2 draws, one field each, in the message's own order.
 */
export function blanksOf(t: Template | undefined): string[] {
  const vars = t && Array.isArray(t.vars) ? t.vars : [];
  return vars.filter((v) => typeof v === 'string' && !PER_PERSON.has(v));
}

// ── the library ───────────────────────────────────────────────────────────

/**
 * A message the screens cannot change by accident. A picker that edits the text in place for its preview
 * would otherwise rewrite the library for every later pick until the app restarts; frozen, that edit throws
 * where it is made.
 */
function frozen(t: Template): Template {
  return Object.freeze({
    ...t,
    title: Object.freeze({ ...t.title }),
    text: Object.freeze({ ...t.text }),
    vars: Object.freeze([...t.vars]) as string[],
    tags: Object.freeze([...t.tags]) as string[],
  });
}

export const TEMPLATES: readonly Template[] = Object.freeze([...TEMPLATES_A, ...TEMPLATES_B].map(frozen));

/** The languages every template is written in. */
export const TEMPLATE_LANGS: readonly Lang[] = MESSAGE_LANGS;

const BY_ID: ReadonlyMap<string, Template> = new Map(TEMPLATES.map((t) => [t.id, t]));

export function templateById(id: string): Template | undefined {
  return typeof id === 'string' ? BY_ID.get(id) : undefined;
}

/** A language the library has, or English for anything else (an old setting, a typo, not a string). */
function langOf(lang: unknown): Lang {
  return typeof lang === 'string' && (TEMPLATE_LANGS as readonly string[]).includes(lang) ? (lang as Lang) : 'en';
}

// ── the tags, in four languages ───────────────────────────────────────────

/**
 * The words a tag is found by, in each language, several to a line where people use several.
 *
 * A message's tags are English (`restaurant`, `eid`), but a person searching in Sorani types چێشتخانە, not
 * "restaurant". This table is how the tags are searchable "in the given language and in English": a tag
 * listed here is found by any of its words in the person's language; a tag that is not listed is still found
 * in English and through its category's title. Every tag of `whatsapptemplates-a.ts` is listed (a test
 * holds that); a new tag in either half should be added here.
 */
export const TAG_WORDS: Readonly<Record<string, Readonly<Record<Lang, string>>>> = Object.freeze({
  // kinds of business
  shop: { en: 'shop store', ar: 'متجر محل', ckb: 'دوکان فرۆشگا', kmr: 'دوکان فرۆشگەه' },
  clothing: { en: 'clothing clothes fashion', ar: 'ملابس أزياء', ckb: 'جل جلوبەرگ', kmr: 'جل جلک' },
  supermarket: { en: 'supermarket grocery market', ar: 'سوبرماركت بقالة', ckb: 'سوپەرمارکێت', kmr: 'سوپەرمارکێت' },
  'online-store': { en: 'online store website', ar: 'متجر إلكتروني أونلاين', ckb: 'فرۆشگای ئۆنلاین', kmr: 'فرۆشگەها ئۆنلاین' },
  electronics: { en: 'electronics phones', ar: 'إلكترونيات هواتف', ckb: 'ئەلیکترۆنیات مۆبایل', kmr: 'ئەلیکترۆنیات مۆبایل' },
  restaurant: { en: 'restaurant', ar: 'مطعم', ckb: 'چێشتخانە ڕێستۆرانت', kmr: 'خوارنگەه ڕێستۆرانت' },
  cafe: { en: 'cafe coffee', ar: 'مقهى كافيه قهوة', ckb: 'کافێ قاوە', kmr: 'کافێ قەهوە' },
  salon: { en: 'salon beauty hair', ar: 'صالون تجميل', ckb: 'ئارایشگا جوانکاری', kmr: 'ئارایشگەه جوانکاری' },
  barber: { en: 'barber', ar: 'حلاق', ckb: 'سەرتاشخانە', kmr: 'سەرتاش' },
  clinic: { en: 'clinic doctor', ar: 'عيادة طبيب', ckb: 'نۆڕینگە کلینیک دکتۆر', kmr: 'کلینیک نۆژدار دکتۆر' },
  school: { en: 'school', ar: 'مدرسة', ckb: 'قوتابخانە', kmr: 'قوتابخانە' },
  training: { en: 'training course class workshop', ar: 'تدريب دورة ورشة', ckb: 'ڕاهێنان خول وۆرکشۆپ', kmr: 'ڕاهێنان خول وۆرکشۆپ' },
  'real-estate': { en: 'real estate property home', ar: 'عقارات عقار منزل', ckb: 'خانووبەرە خانوو', kmr: 'خانووبەرە خانی' },
  services: { en: 'services contractor', ar: 'خدمات مقاول', ckb: 'خزمەتگوزاری', kmr: 'خزمەت' },
  exhibition: { en: 'exhibition fair', ar: 'معرض', ckb: 'پێشانگا', kmr: 'پێشانگەه' },
  // occasions
  eid: { en: 'eid', ar: 'عيد', ckb: 'جەژن', kmr: 'جەژن' },
  'eid-al-fitr': { en: 'eid al-fitr', ar: 'عيد الفطر', ckb: 'جەژنی ڕەمەزان', kmr: 'جەژنا ڕەمەزانێ' },
  'eid-al-adha': { en: 'eid al-adha', ar: 'عيد الأضحى', ckb: 'جەژنی قوربان', kmr: 'جەژنا قوربانێ' },
  ramadan: { en: 'ramadan', ar: 'رمضان', ckb: 'ڕەمەزان', kmr: 'ڕەمەزان' },
  newroz: { en: 'newroz nowruz', ar: 'نوروز', ckb: 'نەورۆز', kmr: 'نەورۆز' },
  'new-year': { en: 'new year', ar: 'رأس السنة سنة جديدة', ckb: 'ساڵی نوێ', kmr: 'سالا نوی' },
  'mothers-day': { en: "mother's day mother", ar: 'عيد الأم', ckb: 'ڕۆژی دایک', kmr: 'ڕۆژا دایکێ' },
  'teachers-day': { en: "teachers' day teacher", ar: 'يوم المعلم', ckb: 'ڕۆژی مامۆستا', kmr: 'ڕۆژا مامۆستایان' },
  christmas: { en: 'christmas', ar: 'عيد الميلاد المجيد كريسماس', ckb: 'کریسمس', kmr: 'کریسمس' },
  weekend: { en: 'weekend', ar: 'نهاية الأسبوع', ckb: 'کۆتایی هەفتە', kmr: 'دوماهیا هەفتیێ' },
  seasonal: { en: 'season seasonal', ar: 'موسم', ckb: 'وەرز', kmr: 'وەرز' },
  // what the message is about
  thanks: { en: 'thanks thank you', ar: 'شكر', ckb: 'سوپاس', kmr: 'سوپاس' },
  reminder: { en: 'reminder', ar: 'تذكير', ckb: 'بیرخستنەوە', kmr: 'بیرئینان' },
  booking: { en: 'booking reservation', ar: 'حجز', ckb: 'نۆرە حیجز', kmr: 'نۆرە حیجز' },
  gift: { en: 'gift', ar: 'هدية', ckb: 'دیاری', kmr: 'دیاری' },
  coupon: { en: 'coupon voucher', ar: 'قسيمة كوبون', ckb: 'کوپۆن', kmr: 'کوپۆن' },
  price: { en: 'price', ar: 'سعر', ckb: 'نرخ', kmr: 'بها نرخ' },
  invitation: { en: 'invitation invite', ar: 'دعوة', ckb: 'بانگهێشت', kmr: 'ڤەخوەندن' },
  feedback: { en: 'feedback opinion', ar: 'رأي ملاحظات', ckb: 'ڕا تێبینی', kmr: 'ڕا تێبینی' },
  quote: { en: 'quote estimate', ar: 'عرض سعر', ckb: 'نرخنامە', kmr: 'نرخنامە' },
  members: { en: 'members membership vip', ar: 'أعضاء عضوية', ckb: 'ئەندام', kmr: 'ئەندام' },
  'pre-order': { en: 'pre-order reserve', ar: 'حجز مسبق', ckb: 'پێشوەختە', kmr: 'بەری دەمی' },
  renovation: { en: 'renovation new look', ar: 'تجديد', ckb: 'نوێکردنەوە', kmr: 'نویکرن' },
  branch: { en: 'branch', ar: 'فرع', ckb: 'لق', kmr: 'لق' },
});

// ── search ────────────────────────────────────────────────────────────────

/**
 * Marks that hang off a letter and are never typed into a search box: the Latin combining accents, the
 * Arabic harakat and shadda, the superscript alef, the Quranic marks. Removed after composing, so that a
 * hamza on an alef has already become أ (folded to ا below) and the hamza of ئ has stayed on it.
 */
const MARKS = /[\u0300-\u036F\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED\u08D3-\u08FF]/g;

/**
 * Characters with no sound: tatweel, the Arabic letter mark, the zero-width joiners and non-joiners (Sorani
 * text is full of ZWNJ after ە), the direction marks, embeddings and isolates every copy out of a
 * right-to-left app carries, and the byte-order mark.
 */
const SILENT = /[\u0640\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** A Latin letter with an accent: decomposed, so the accent can go and `café` is found by `cafe`. */
const LATIN_ACCENTED = /[\u00C0-\u024F\u1E00-\u1EFF]/g;

/**
 * One letter for each family a person might type for it.
 *
 * ## Why this folds the Kurdish letters, which `whatsappfind.ts` deliberately does not
 *
 * The inbox search is precise on purpose: it searches thousands of messages, and a search that cannot
 * tell ڕۆژ from رۆژ there buries the one chat a person wants. This library is a hundred messages written
 * by us, and the failure that matters here is the opposite one — a person who types on an Arabic keyboard,
 * as a great many Kurds do, writes رۆژ or روژ for ڕۆژ, ه for ە, ی for ێ, ل for ڵ, ف for ڤ, and must
 * still find the message. So here recall wins: each Kurdish letter folds to the Arabic-keyboard letter
 * people type in its place. The cost, an extra message in a list of a hundred, is small.
 *
 * ئ is the exception, as it is in `whatsappfind.ts`: it begins a third of Sorani words and every Arabic
 * keyboard has it, so it is left itself rather than merged with ی.
 */
const SAME: Readonly<Record<string, string>> = {
  '\u0623': '\u0627', '\u0625': '\u0627', '\u0622': '\u0627', '\u0671': '\u0627', // أ إ آ ٱ → ا
  '\u0624': '\u0648', '\u06C6': '\u0648',                                      // ؤ ۆ → و
  '\u064A': '\u06CC', '\u0649': '\u06CC', '\u06CE': '\u06CC',                    // ي ى ێ → ی
  '\u0643': '\u06A9',                                                          // ك → ک
  '\u0629': '\u0647', '\u06D5': '\u0647', '\u06C0': '\u0647', '\u06BE': '\u0647', // ة ە ۀ ھ → ه
  '\u0695': '\u0631',                                                          // ڕ → ر
  '\u06B5': '\u0644',                                                          // ڵ → ل
  '\u06A4': '\u0641',                                                          // ڤ → ف
};
const SAME_LETTERS = new RegExp(`[${Object.keys(SAME).join('')}]`, 'g');

/** The longest text the fold reads: a message is at most 700 characters, a query far less. */
const FOLD_CHARS = 4_000;

/**
 * Text as the search compares it.
 *
 * Composed first (NFKC: a hamza typed after an alef becomes أ, a ligature pasted from a PDF becomes its
 * letters), then the silent characters and the marks go, then lower case, then the letter families of
 * `SAME` become one, then both sets of Arabic-Indic digits become 0–9 — a phone number or a price can be
 * searched in either. Never NFD on Arabic script: that splits ئ into ی and a hamza, and dropping the hamza
 * would merge the two (see `whatsappfind.ts`, which learned it first).
 *
 * Anything that is not a string or a finite number folds to nothing, so a search box handed `null` or an
 * object lists everything instead of throwing; `String(x)` would run the object's own `toString`.
 */
export function foldForSearch(text: unknown): string {
  const s = typeof text === 'string' ? text : typeof text === 'number' && Number.isFinite(text) ? String(text) : '';
  return s
    .slice(0, FOLD_CHARS)
    .normalize('NFKC')
    .replace(LATIN_ACCENTED, (c) => c.normalize('NFD').replace(/[\u0300-\u036F]/g, ''))
    .replace(MARKS, '')
    .replace(SILENT, '')
    .toLowerCase()
    .replace(SAME_LETTERS, (c) => SAME[c] ?? c)
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** A query is a few words; more than this many are a paste, and the first ones decide. */
const QUERY_CHARS = 200;
const QUERY_WORDS = 8;

/**
 * How much a word found in each part of a message counts. A title hit outranks any tag or category hit, and
 * those outrank a hit in the body, whatever the bonus: the brief's "title above text" holds for one word, and
 * for several the sum still favours the message whose title says what was asked.
 */
const W_TITLE = 8;
const W_TAG = 4;
const W_TEXT = 2;
/** A word found at the start of a word in the message, rather than inside one ("eid" in Eid, not in "said"). */
const W_START = 1;

/** One message, folded for one language: the parts a word can be found in, built once and kept. */
interface Indexed {
  t: Template;
  /** Its place in the empty search's order: category first, then where it sits in the library. */
  order: number;
  title: string;
  tags: string;
  text: string;
}

/**
 * The parts of a message a search reads in `lang`, each in that language and in English, folded.
 *
 * Placeholders are taken out of the text first: every second message says `{business}`, and a search for
 * "business" or "name" that matched all of them would be no search at all.
 */
function indexOne(t: Template, order: number, lang: Lang): Indexed {
  const both = (r: Readonly<Record<Lang, string>> | undefined): string => {
    if (!r) return '';
    const mine = typeof r[lang] === 'string' ? r[lang] : '';
    const en = lang === 'en' || typeof r.en !== 'string' ? '' : r.en;
    return `${mine}\n${en}`;
  };
  const noSlots = (s: string): string => s.replace(/\{[^{}]*\}/g, ' ');
  const tagWords = (Array.isArray(t.tags) ? t.tags : [])
    .filter((g): g is string => typeof g === 'string')
    .map((g) => `${g}\n${both(TAG_WORDS[g])}`);
  const cat = categoryById(t.category);
  return {
    t,
    order,
    title: foldForSearch(both(t.title)),
    tags: foldForSearch([...tagWords, both(cat?.title)].join('\n')),
    text: foldForSearch(noSlots(both(t.text))),
  };
}

/** The library in category order, then library order: what an empty search lists, and how ties are broken. */
const ORDERED: readonly Template[] = TEMPLATES
  .map((t, i) => ({ t, i }))
  .sort((a, b) => rankOf(a.t.category) - rankOf(b.t.category) || a.i - b.i)
  .map((x) => x.t);

const INDEX = new Map<Lang, readonly Indexed[]>();

function indexFor(lang: Lang): readonly Indexed[] {
  let idx = INDEX.get(lang);
  if (!idx) {
    idx = ORDERED.map((t, i) => indexOne(t, i, lang));
    INDEX.set(lang, idx);
  }
  return idx;
}

/** Whether the character before `at` ends a word, so a hit there starts one. */
const LETTER = /[\p{L}\p{N}]/u;
const startsWord = (s: string, at: number): boolean => at === 0 || !LETTER.test(s[at - 1]);

/**
 * The forms a word is looked for in. The word itself, and: an Arabic word of four letters or more without
 * its article (العيد finds عيد الفطر), an English word without a plural s (discounts finds discount). Not a
 * stemmer; the two endings people type most and the library writes least.
 */
function formsOf(w: string): string[] {
  const out = [w];
  if (w.length >= 4 && w.startsWith('\u0627\u0644')) out.push(w.slice(2));
  if (w.length >= 4 && /^[a-z]+s$/.test(w) && !/ss$/.test(w)) out.push(w.slice(0, -1));
  return out;
}

/** What one word scores in one part: its weight if any form is there, plus the bonus when one starts a word. */
function hit(field: string, forms: readonly string[], weight: number): number {
  let best = 0;
  for (const f of forms) {
    let at = field.indexOf(f);
    if (at < 0) continue;
    let score = weight;
    // The first occurrence may be inside a word and a later one at the start of one.
    while (at >= 0) {
      if (startsWord(field, at)) { score = weight + W_START; break; }
      at = field.indexOf(f, at + 1);
    }
    best = Math.max(best, score);
  }
  return best;
}

/**
 * The templates matching a search in a language (title, text and tags), best first; an empty search lists
 * them in category order.
 *
 * Every word must be found — in the title, the tags, the category's title or the text, in `lang` or in
 * English — and a message scores, for each word, the best part it was found in. Ties keep the empty
 * search's order, so the list does not reshuffle as a word is typed. When no message has every word and
 * there were several, the messages with the most of them are listed instead: "eid xmas" should show the Eid
 * greetings rather than an empty screen.
 *
 * Never throws: a query that is not a string is an empty one, an unknown language is English, a filter that
 * is not a string is no filter, and one that names no category or kind lists nothing.
 */
export function searchTemplates(
  query: string, lang: Lang, o: { category?: CategoryId; kind?: TemplateKind } = {},
): Template[] {
  const opts: { category?: unknown; kind?: unknown } = o !== null && typeof o === 'object' ? o : {};
  const category = typeof opts.category === 'string' ? opts.category : undefined;
  const kind = typeof opts.kind === 'string' ? opts.kind : undefined;
  const pool = indexFor(langOf(lang)).filter(
    (x) => (category === undefined || x.t.category === category) && (kind === undefined || x.t.kind === kind),
  );
  const words = [...new Set(
    foldForSearch(typeof query === 'string' ? query.slice(0, QUERY_CHARS) : '')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 0),
  )].slice(0, QUERY_WORDS);
  if (words.length === 0) return pool.map((x) => x.t);

  const scored = pool.map((x) => {
    let score = 0;
    let found = 0;
    for (const w of words) {
      const forms = formsOf(w);
      const best = Math.max(hit(x.title, forms, W_TITLE), hit(x.tags, forms, W_TAG), hit(x.text, forms, W_TEXT));
      if (best > 0) { found += 1; score += best; }
    }
    return { x, score, found };
  });
  const byScore = (a: { x: Indexed; score: number; found: number }, b: { x: Indexed; score: number; found: number }) =>
    b.found - a.found || b.score - a.score || a.x.order - b.x.order;
  const all = scored.filter((s) => s.found === words.length);
  if (all.length > 0 || words.length === 1) return all.sort(byScore).map((s) => s.x.t);
  return scored.filter((s) => s.found > 0).sort(byScore).map((s) => s.x.t);
}

// ── filling ───────────────────────────────────────────────────────────────

/** C0 control characters other than the line break and the tab: a value pasted from a spreadsheet can carry them, and WhatsApp shows them as boxes. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * A value the sender typed, as it goes into the message: a string with something in it, without control
 * characters or the spaces around it, no longer than a whole message may be. Anything else — empty, only
 * spaces, a number, `null` — is not a value, and the placeholder stays visible so the screen can show the
 * blank as unfilled rather than send a message with a hole in it.
 */
function valueOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const clean = v.replace(CONTROL, '').trim().slice(0, LIMITS.messageChars);
  return clean.length > 0 ? clean : null;
}

/**
 * A template's text in a language with the placeholders that `values` names filled in; the others
 * (`{name}`) are left for each person.
 *
 * One pass over the text with a function, never a replacement string: an offer of "$& off" or a code of
 * `$1` goes in as typed, and a value that itself says `{name}` is not filled a second time here (the engine
 * reads what is left, as it would read anything the person typed into the message). Only the value's own
 * keys count — a placeholder called `{constructor}` is not filled from `Object.prototype`.
 *
 * A language the template lacks falls back to English; something that is not a template gives an empty
 * text rather than an exception.
 */
export function fillTemplate(t: Template, lang: Lang, values: Record<string, string>): string {
  if (!t || typeof t !== 'object' || !t.text || typeof t.text !== 'object') return '';
  const own = t.text[langOf(lang)];
  const text = typeof own === 'string' && own.length > 0 ? own : typeof t.text.en === 'string' ? t.text.en : '';
  const vals: Record<string, unknown> = values !== null && typeof values === 'object' ? values : {};
  return text.replace(SLOT, (whole: string, inner: string) => {
    const key = inner.trim();
    if (!Object.prototype.hasOwnProperty.call(vals, key)) return whole;
    const v = valueOf(vals[key]);
    return v === null ? whole : v;
  });
}
