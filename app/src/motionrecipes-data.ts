import type { Lang } from './i18n';
import type { Anim, Gradient, IconId, Layer, Paint, RecipeId, Shadow } from './motiontypes';
import { E, META, T, type Kit, type Recipe } from './motionrecipe';
import { digitsFor, formatNumber } from './motionfonts';

/**
 * The data templates: one big number in a ring, a bar chart, a donut, a line
 * chart and three figures side by side.
 *
 * They are the templates people reach for to make a number land — a result
 * in a year-end video, a chart in a lesson, a figure in a promo — so they are
 * built like the animated charts of a keynote rather than a spreadsheet's:
 * one idea per graphic, big type, few colours, and data that arrive in order
 * and count up to their own number (never past it) as they grow.
 *
 * ## The words are the person's; the numbers are read, never guessed
 *
 * A number field or a `Label: value` list is read by `numberOf` and
 * `itemsOf`, below, which accept the ways people actually write numbers —
 * Arabic-Indic and Persian digits, thousands grouped with `,` `٬` or spaces,
 * the Arabic decimal sign, a trailing `%` — and skip a line that has no
 * number in it. Nothing is invented to fill a chart: when no line reads at
 * all, the sample's items for the language are used, which are plainly
 * placeholders. The engine writes every number in the graphic's own digits,
 * so the recipes only ever pass plain numbers.
 *
 * ## Nothing here measures text
 *
 * A recipe runs before any font is loaded (and in Node, in tests), so sizes
 * are decided from estimates of how wide a number or a label will be — ems
 * measured once in the app's WebKit for the faces the voices resolve to (see
 * `EM`) — with room to spare. Where an estimate could still be wrong, the
 * layout leaves the renderer the last word: a chart shrinks or shortens its
 * own labels, and a one-line title or label is set with `fit`.
 *
 * ## Negative values
 *
 * The counters (the big number, the three figures, the line chart's final
 * value, the donut's legend) show a negative number with its sign, and the
 * big number's ring then sweeps the other way. The charts themselves draw
 * from a zero baseline and `motioncharts.ts` draws a negative datum as zero,
 * because a bar below the baseline needs an axis these charts do not have; the
 * data are passed through as they were written, so the document still holds
 * the person's numbers. A donut's centre and shares count only the slices
 * above zero, since a negative share of a whole is not a share.
 */

// ── reading what the person typed ─────────────────────────────────────────

/** A number as it was written: its value, the decimals it was written with, and the marks around it. */
export interface Figure {
  value: number;
  /** Places after the decimal sign as written, at most 3 (what a counter shows). */
  decimals: number;
  /** Written with a percent sign. */
  percent: boolean;
  /** A short mark before the number, such as a currency sign. */
  prefix: string;
  /** A short mark after it, such as `+` or `k` (not the percent sign, which is `percent`). */
  suffix: string;
}

/** One line of a list: its words and its number. */
export interface Item extends Figure {
  label: string;
}

/** The largest value the reader keeps (motionread.ts's `BIG`): past it, a sum of twelve could overflow. */
const BIG = 1e12;
/** How many characters of a label are kept: a chart's room for words is a few centimetres wide. */
const LABEL_CHARS = 24;
/** Short marks around a number that are kept as its prefix or suffix. */
const MARK_CHARS = 6;

const ZERO: Figure = { value: 0, decimals: 0, percent: false, prefix: '', suffix: '' };

/**
 * Arabic-Indic, Persian and full-width digits as 0-9; the Arabic and
 * full-width decimal, thousands and percent signs as their Latin forms; the
 * minus signs as `-`; and a zero-width non-joiner or joiner between two digits
 * — a Kurdish keyboard leaves one there — dropped, so 1200 typed with one after
 * the 1 is 1200, not 1. motionchatops.ts reads the numbers a person gave the
 * same way.
 */
function latinDigits(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\uFF10-\uFF19]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[\u066B\uFF0E]/g, '.')
    .replace(/[\u066C\uFF0C]/g, ',')
    .replace(/[\u066A\uFF05]/g, '%')
    .replace(/[\u2212\uFE63\uFF0D]/g, '-')
    .replace(/(\d)[\u200C\u200D]+(?=\d)/g, '$1');
}

/** Whether every group after the first is three digits and the first one to three: what grouping looks like. */
function grouped(parts: string[]): boolean {
  return parts[0].length >= 1 && parts[0].length <= 3 && parts.slice(1).every((p) => p.length === 3);
}

/**
 * The digits of a number as written — `1,200.5`, `1.200.000`, `4,5`, `12` —
 * as a value and its decimals, or null. Commas and dots are read by how they
 * are used: both present, the last one is the decimal sign; one kind used
 * more than once, it groups thousands; a single comma before exactly three
 * digits groups (`1,200` is twelve hundred), any other single one is the
 * decimal sign (`4,5`, `1.200`).
 */
function digitsOf(body: string): { n: number; decimals: number } | null {
  const commas = body.split(',').length - 1;
  const dots = body.split('.').length - 1;
  let int = body;
  let frac = '';
  if (commas && dots) {
    const dec = body.lastIndexOf(',') > body.lastIndexOf('.') ? ',' : '.';
    const halves = body.split(dec);
    if (halves.length !== 2) return null;
    const groups = halves[0].split(dec === ',' ? '.' : ',');
    if (!grouped(groups)) return null;
    int = groups.join('');
    frac = halves[1];
  } else if (commas || dots) {
    const sep = commas ? ',' : '.';
    const parts = body.split(sep);
    if (parts.length > 2) {
      if (!grouped(parts)) return null;
      int = parts.join('');
    } else if (sep === ',' && grouped(parts)) {
      int = parts.join('');
    } else {
      int = parts[0];
      frac = parts[1];
    }
  }
  if (!/^\d*$/.test(int) || !/^\d*$/.test(frac) || (!int && !frac)) return null;
  const n = Number(`${int || '0'}.${frac || '0'}`);
  return Number.isFinite(n) ? { n, decimals: Math.min(3, frac.length) } : null;
}

/** A mark before a number: a currency sign, perhaps after a country's letters (`$`, `US$`, `€`), or `#`. */
const PREFIX = /^(?:[A-Z]{0,3}\p{Sc}|#)\s*/u;
/** What a mark after a number starts with: a letter (`k`, `users`, `ألف`), a currency sign, `+`, `×`, `°`, `‰` or a prime. */
const MARK_START = /^[\p{L}\p{Sc}+\u00D7\u00B0\u2030\u2032\u2033]/u;

/**
 * A number as written, or null. `strict` also refuses one followed by words
 * that are not a short mark — what a line with no separator needs, so `Q1`
 * or `Step 3:` is not read as a value.
 */
function figureOf(raw: string, strict: boolean): Figure | null {
  if (typeof raw !== 'string') return null;
  // Thousands grouped with spaces: the typographic ones always, a plain space only where a number is expected anyway —
  // in a line split at no colon, `COVID-19 400` is a label and a number, not 19,400.
  const spaces = strict ? /(\d)[\u00A0\u202F\u2009](?=\d{3}(?!\d))/g : /(\d)[ \u00A0\u202F\u2009](?=\d{3}(?!\d))/g;
  let s = latinDigits(raw.normalize('NFC')).replace(spaces, '$1').trim();
  let sign = 1;
  const signOf = () => {
    const m = /^([+-])\s*/.exec(s);
    if (!m) return;
    if (m[1] === '-') sign = -sign;
    s = s.slice(m[0].length);
  };
  signOf();
  const pre = PREFIX.exec(s);
  const prefix = pre ? pre[0].trim() : '';
  if (pre) {
    s = s.slice(pre[0].length);
    signOf();
  }
  const m = /^(\d[\d.,]*|[.,]\d+)(?:[eE]([+-]?\d{1,2}))?/.exec(s);
  if (!m) return null;
  // A separator left dangling at the end ("40," or "40.") is punctuation, not a decimal sign.
  const body = m[1].replace(/[.,]+$/, '');
  const digits = digitsOf(body);
  if (!digits) return null;
  const rest = s.slice(m[0].length).trim();
  const percent = rest.startsWith('%');
  const after = (percent ? rest.slice(1) : rest).trim();
  const mark = !!after && MARK_START.test(after) && !/\d/.test(after) && Array.from(after).length <= MARK_CHARS;
  if (strict && after && !mark) return null;
  let value = digits.n * (m[2] ? Math.pow(10, Number(m[2])) : 1) * sign;
  if (!Number.isFinite(value)) return null;
  value = Math.min(BIG, Math.max(-BIG, value)) || 0;
  const decimals = m[2] ? (Number.isInteger(value) ? 0 : Math.min(3, digits.decimals)) : digits.decimals;
  return { value, decimals, percent, prefix, suffix: mark ? after : '' };
}

/**
 * A number as a person writes it, or null when there is none. Takes
 * Arabic-Indic (٠-٩) and Persian (۰-۹) digits, `,` `٬` `.` or spaces grouping
 * thousands, `.` `,` or `٫` as the decimal sign, a sign (`-`, `−`, `+`), an
 * exponent (`1e9`), a currency sign before it (`$`, `US$`) and a mark after it
 * (`%`, `٪`, `+`, `k`, a short unit). Words after the number that are not a
 * mark are ignored, so `40 (estimated)` is 40. The value is held inside the
 * reader's ±1e12, and is never NaN and never -0.
 */
export function numberOf(raw: string): Figure | null {
  return figureOf(raw, false);
}

/** Where a label may end and its number begin, strongest first: a colon, an equals sign, an Arabic comma. */
const STRONG = /[:=\u060C\uFF1A]/g;
const DASH = /[-\u2013\u2014]/g;

/** A label as a chart shows it: one line, single spaces, no separator left dangling, at most `LABEL_CHARS` characters. */
function labelOf(s: string): string {
  const one = s.replace(/\s+/g, ' ').replace(/[\s:=\u060C\uFF1A\u2013\u2014-]+$/, '').trim();
  return Array.from(one).slice(0, LABEL_CHARS).join('').trim();
}

/** Every index where `re` matches in `s`, first to last. */
function marks(s: string, re: RegExp): number[] {
  const out: number[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m.index);
  return out;
}

/**
 * One line of a list, or null when it has no number. Tried in order: split at
 * a colon, `=` or an Arabic comma (the first one after which a number stands,
 * so a label may hold one); at a dash, where the rest is a number and nothing
 * else (`Q1 - 40`, `Q1-40`; a negative number needs a colon, `Q1: -40`); at
 * the last word, when it is a number (`Q1 40`, `COVID-19 400`); at a dash
 * followed by a number and other words (`Q1 - 40 (est.)`); and last the line
 * as a bare number. A bullet in front of the line is not part of the label.
 */
export function itemOf(line: string): Item | null {
  const s = line.replace(/^\s*(?:[\u2022\u00B7\u25AA\u25E6*]+|[-\u2013\u2014](?=\s))\s*/, '').trim();
  if (!s) return null;
  const split = (re: RegExp, strict: boolean): Item | null => {
    for (const i of marks(s, re)) {
      const f = figureOf(s.slice(i + 1), strict);
      if (f) return { label: labelOf(s.slice(0, i)), ...f };
    }
    return null;
  };
  const words = s.split(/\s+/);
  const last = (): Item | null => {
    const f = words.length > 1 ? figureOf(words[words.length - 1], true) : null;
    return f ? { label: labelOf(words.slice(0, -1).join(' ')), ...f } : null;
  };
  const bare = figureOf(s, true);
  return split(STRONG, false) ?? split(DASH, true) ?? last() ?? split(DASH, false) ?? (bare ? { label: '', ...bare } : null);
}

function linesOf(text: string, max: number): Item[] {
  const out: Item[] = [];
  for (const line of String(text ?? '').split(/\r\n?|\n/)) {
    if (out.length >= max) break;
    const item = itemOf(line);
    if (item) out.push(item);
  }
  return out;
}

/**
 * A `Label: value` list as items: at most `max`, lines with no number
 * skipped, and never none — when nothing reads, `fallback` (the sample's list
 * for the language) is read instead, and past that a single zero.
 */
export function itemsOf(text: string, max: number, fallback = ''): Item[] {
  const cap = Math.max(1, Math.floor(Number.isFinite(max) ? max : 1));
  const mine = linesOf(text, cap);
  if (mine.length) return mine;
  const theirs = linesOf(fallback, cap);
  return theirs.length ? theirs : [{ label: '', ...ZERO }];
}

// ── icons for figures ─────────────────────────────────────────────────────

/**
 * Which icon stands for a figure, by a word in its label. A word matches at
 * the start of a word of the label, whatever follows it, so a plural or a
 * Kurdish ending still matches ("users", قوتابیان, کۆرسەکان); in Arabic
 * script it may also follow what Arabic joins to the front of a word — the
 * article and a one-letter conjunction or preposition (الطلاب, للطلاب) — but
 * not other letters, so عام (year) is not found in طعام (food). The first row
 * that matches wins, so the more particular words come first — money before
 * countries, because دولار (dollar) begins with دول (countries).
 */
const ICON_WORDS: readonly (readonly [IconId, readonly string[]])[] = [
  ['money', ['revenue', 'sales', 'sale', 'profit', 'income', 'money', 'price', 'cost', 'budget', 'dollar', 'euro', 'fund', 'donation', 'earning', 'spend', 'saving', '$', '€', '£',
    'إيراد', 'ايراد', 'مبيع', 'ربح', 'أرباح', 'ارباح', 'دخل', 'مبلغ', 'أموال', 'اموال', 'سعر', 'تكلف', 'ميزاني', 'دولار', 'تبرع', 'دينار',
    'داهات', 'قازانج', 'فرۆش', 'پارە', 'نرخ', 'تێچوو', 'بودجە', 'دارایی', 'دینار', 'فرۆتن']],
  ['graduation', ['student', 'graduate', 'pupil', 'alumni', 'طالب', 'طلاب', 'طلبة', 'خريج', 'قوتابی', 'خوێندکار', 'دەرچوو']],
  ['users', ['user', 'people', 'person', 'member', 'customer', 'client', 'follower', 'visitor', 'subscriber', 'employee', 'staff', 'team', 'volunteer', 'guest', 'attendee', 'participant', 'viewer', 'fan',
    'مستخدم', 'عميل', 'عملاء', 'زبون', 'زبائن', 'شخص', 'أشخاص', 'اشخاص', 'الناس', 'عضو', 'أعضاء', 'اعضاء', 'متابع', 'زائر', 'زوار', 'مشترك', 'موظف', 'عامل', 'عمال', 'فريق', 'متطوع', 'ضيف', 'مشارك',
    'بەکارهێنەر', 'بکارهێنەر', 'کڕیار', 'کریار', 'خەڵک', 'خەلک', 'کەس', 'ئەندام', 'فۆڵۆوەر', 'سەردانکەر', 'سەرەدانکەر', 'فەرمانبەر', 'کارمەند', 'تیم', 'میوان', 'بەشداربوو', 'بەشدار']],
  ['clock', ['hour', 'minute', 'second', 'time', 'uptime', 'ساعة', 'ساعات', 'دقيق', 'وقت', 'کاتژمێر', 'خولەک', 'دەمژمێر', 'کات']],
  ['calendar', ['day', 'week', 'month', 'year', 'event', 'date', 'يوم', 'أيام', 'ايام', 'أسبوع', 'اسبوع', 'شهر', 'سنة', 'سنوات', 'عام', 'أعوام', 'فعالي', 'ڕۆژ', 'رۆژ', 'هەفتە', 'حەفتی', 'مانگ', 'هەیڤ', 'ساڵ', 'سال', 'بۆنە']],
  ['trend', ['growth', 'increase', 'rise', 'rate', 'return', 'conversion', 'نمو', 'زيادة', 'ارتفاع', 'معدل', 'نسبة', 'گەشە', 'زیادبوون', 'زێدەبوون', 'ڕێژە', 'رێژە']],
  ['globe', ['countr', 'nation', 'world', 'language', 'دول', 'بلد', 'بلدان', 'لغة', 'لغات', 'وڵات', 'وەلات', 'جیهان', 'زمان']],
  ['pin', ['city', 'cities', 'location', 'branch', 'office', 'store', 'shop', 'site', 'مدين', 'مدن', 'فرع', 'فروع', 'موقع', 'مكتب', 'متجر', 'شار', 'باژێر', 'لق', 'نووسینگە', 'فرۆشگا', 'دوکان']],
  ['trophy', ['award', 'prize', 'win', 'trophy', 'champion', 'جائز', 'جوائز', 'فوز', 'بطول', 'خەڵات', 'خەلات', 'براوە']],
  ['medal', ['medal', 'ميدالي', 'مدالي', 'مەدالیا']],
  ['rocket', ['project', 'launch', 'startup', 'release', 'مشروع', 'مشاريع', 'إطلاق', 'اطلاق', 'پڕۆژە', 'پرۆژە']],
  ['cart', ['order', 'purchase', 'product', 'item', 'sold', 'طلب', 'منتج', 'مشتري', 'داواکاری', 'داخوازی', 'بەرهەم', 'کڕین', 'کرین']],
  ['star', ['rating', 'review', 'star', 'score', 'تقييم', 'نجوم', 'مراجع', 'هەڵسەنگاندن', 'هەلسەنگاندن', 'ئەستێرە', 'ستێر']],
  ['smile', ['satisf', 'happy', 'smile', 'رضا', 'سعيد', 'سعادة', 'ڕەزامەندی', 'رازیبوون', 'دڵخۆش', 'دلخوش']],
  ['heart', ['like', 'love', 'favourite', 'favorite', 'heart', 'إعجاب', 'اعجاب', 'حب', 'لایک', 'خۆشەویست']],
  ['chat', ['message', 'comment', 'chat', 'conversation', 'feedback', 'رسال', 'تعليق', 'محادث', 'نامە', 'کۆمێنت', 'لێدوان', 'گفتوگۆ']],
  ['mail', ['email', 'e-mail', 'newsletter', 'بريد', 'ئیمەیڵ', 'ئیمەیل']],
  ['phone', ['call', 'phone', 'اتصال', 'مكالم', 'هاتف', 'پەیوەندی', 'تەلەفۆن']],
  ['book', ['course', 'book', 'lesson', 'class', 'lecture', 'module', 'دورة', 'دورات', 'كتاب', 'كتب', 'درس', 'دروس', 'محاضر', 'کۆرس', 'کتێب', 'پەرتووک', 'وانە', 'خول']],
  ['school', ['school', 'universit', 'college', 'campus', 'مدرس', 'جامع', 'كلي', 'قوتابخانە', 'زانکۆ', 'کۆلێژ', 'کۆلیژ']],
  ['target', ['goal', 'target', 'mission', 'هدف', 'أهداف', 'اهداف', 'ئامانج', 'ئارمانج']],
  ['handshake', ['partner', 'deal', 'contract', 'sponsor', 'client deal', 'شريك', 'شركاء', 'صفق', 'عقد', 'هاوبەش', 'هەڤپشک', 'گرێبەست']],
  ['truck', ['deliver', 'shipment', 'shipping', 'توصيل', 'شحن', 'گەیاندن', 'گەهاندن']],
  ['plane', ['flight', 'trip', 'travel', 'tourist', 'رحل', 'سفر', 'سياح', 'گەشت', 'فڕین', 'فرین']],
  ['food', ['meal', 'food', 'dish', 'وجب', 'طعام', 'أكل', 'اكل', 'خواردن', 'خوارن']],
  ['coffee', ['coffee', 'cup', 'قهو', 'قاوە']],
  ['code', ['code', 'commit', 'app', 'software', 'feature', 'برمج', 'تطبيق', 'کۆد', 'ئەپ', 'بەرنامە']],
  ['play', ['video', 'view', 'watch', 'stream', 'فيديو', 'مشاهد', 'ڤیدیۆ', 'بینەر', 'سەیرکردن']],
  ['camera', ['photo', 'picture', 'image', 'صور', 'وێنە']],
  ['music', ['song', 'music', 'track', 'أغني', 'اغني', 'موسيق', 'گۆرانی', 'مۆسیقا', 'سترێن']],
  ['stethoscope', ['patient', 'doctor', 'clinic', 'health', 'مريض', 'مرضى', 'طبيب', 'أطباء', 'اطباء', 'عياد', 'صحة', 'صحي', 'نەخۆش', 'نەخوش', 'دکتۆر', 'پزیشک', 'تەندروستی']],
  ['building', ['compan', 'business', 'building', 'firm', 'شرك', 'مبنى', 'مبان', 'کۆمپانیا', 'کۆمپانی', 'باڵەخانە']],
  ['home', ['home', 'house', 'famil', 'منزل', 'منازل', 'بيت', 'بيوت', 'أسر', 'اسر', 'عائل', 'ماڵ', 'مال', 'خێزان']],
  ['leaf', ['tree', 'plant', 'green', 'eco', 'recycl', 'شجر', 'أشجار', 'نبات', 'بيئ', 'درەخت', 'دار', 'ژینگە']],
  ['bolt', ['energy', 'power', 'speed', 'fast', 'طاق', 'سرع', 'وزە', 'خێرایی', 'هێز']],
  ['bulb', ['idea', 'innovation', 'فكر', 'أفكار', 'افكار', 'ابتكار', 'بیرۆکە', 'داهێنان']],
  ['shield', ['secur', 'safe', 'protect', 'أمن', 'امن', 'حماي', 'ئاسایش', 'پاراستن']],
];

/** The icons a figure takes when no word in its label names one, by its place. */
const ICON_CYCLE: readonly IconId[] = ['star', 'target', 'bolt'];

/** Letters Arabic and Kurdish write two ways, written one way, so ي and ی (or ك and ک) match each other. */
function foldArabic(s: string): string {
  return s
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9')
    .replace(/[\u0623\u0625\u0622]/g, '\u0627')
    .replace(/[\u0629\u06D5]/g, '\u0647')
    .replace(/[\u200C\u200D\u0640]/g, '');
}

const ARABIC_LETTER = /[\u0600-\u06FF]/;

/** What Arabic joins to the front of a word: a conjunction, a preposition and the article, in that order, each optional. */
const JOINED = '(?:[\u0648\u0641])?(?:[\u0628\u0644\u06A9])?(?:\u0627\u0644|\u0644)?';

const escapeRe = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** An icon for a figure: the first `ICON_WORDS` row with a word in `label`, else `ICON_CYCLE` by its place `i`. */
export function iconFor(label: string, i: number): IconId {
  const text = foldArabic(String(label ?? '').toLowerCase());
  for (const [icon, words] of ICON_WORDS) {
    for (const w of words) {
      const re = ARABIC_LETTER.test(w)
        ? new RegExp(`(?:^|\\s)${JOINED}${escapeRe(foldArabic(w))}`)
        : w.length === 1 ? null : new RegExp(`(?:^|[^a-z])${escapeRe(w)}`);
      if (re ? re.test(text) : text.includes(w)) return icon;
    }
  }
  const n = ICON_CYCLE.length;
  return ICON_CYCLE[((Math.floor(i) % n) + n) % n];
}

// ── estimating widths ─────────────────────────────────────────────────────

/**
 * Advance widths in ems of a figure's glyphs, measured in the app's WebKit:
 * `system-ui` at weight 800 for Latin digits, and the bundled Noto Sans
 * Arabic (whose heaviest is 700) for Arabic-Indic ones. A little over the
 * measurement, so an estimate errs on the side of room.
 */
const EM = {
  latin: { digit: 0.69, group: 0.26, point: 0.26, minus: 0.46, percent: 0.94, mark: 0.68, space: 0.21 },
  arab: { digit: 0.59, group: 0.28, point: 0.28, minus: 0.46, percent: 0.56, mark: 0.52, space: 0.32 },
} as const;

/** How wide a number will be drawn by a counter, in ems of its size. */
function figureEm(value: number, decimals: number, prefix: string, suffix: string, lang: Lang): number {
  const e = digitsFor(lang) === 'arab' ? EM.arab : EM.latin;
  const shown = formatNumber(value, { decimals, group: true, lang });
  let w = 0;
  for (const ch of `${prefix}${shown}${suffix}`) {
    if (/[0-9\u0660-\u0669]/.test(ch)) w += e.digit;
    else if (ch === ',' || ch === '\u066C') w += e.group;
    else if (ch === '.' || ch === '\u066B') w += e.point;
    else if (ch === '-') w += e.minus;
    else if (ch === '%' || ch === '\u066A') w += e.percent;
    else if (/\s/.test(ch)) w += e.space;
    else w += e.mark;
  }
  return w * 1.04;
}

/** How wide words will be at weight 500 to 600, in ems: an average per letter, Arabic script a little narrower. */
function wordsEm(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/\s/.test(ch)) w += 0.26;
    else if (ARABIC_LETTER.test(ch)) w += 0.47;
    else if (/[A-Z0-9MW@%&]/.test(ch) || /[mw]/.test(ch)) w += 0.66;
    else if (/[iljtf.,:;'!|]/.test(ch)) w += 0.28;
    else w += 0.52;
  }
  return w * 1.05;
}

// ── shared pieces ─────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A colour with no colour: what a chart is given for a datum another chart layer draws. */
const CLEAR = '#00000000';

/** The family's plate shadow. */
const PLATE_SHADOW: Shadow = { color: 'rgba(0,0,0,.35)', blur: 3, x: 0, y: 1 };

/** A two-tone paint across a shape, the family's way of giving an accent fill depth. */
function sheen(angle = 30): Gradient {
  return { kind: 'linear', angle, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] };
}

/**
 * The timing of one graphic. `pace` is 1 at the recipe's own length or longer
 * — a longer graphic only holds longer — and less when it is shorter, so a
 * two-second version still arrives, holds and leaves instead of being cut off
 * half-way in.
 */
interface Beat {
  pace: number;
  /** Seconds the closing exit takes. */
  exit: number;
  /** Seconds, scaled to the pace. */
  s(t: number): number;
}

function beatOf(c: Kit): Beat {
  const pace = clamp(c.seconds / META[c.recipe].seconds, 0.45, 1);
  return { pace, exit: Math.min(T.exit, c.seconds * 0.2), s: (t) => t * pace };
}

/** The frame's safe margin: wider on the wide frame, as titles are set there. */
const marginOf = (c: Kit) => (c.landscape ? 8 : 6);

/** A percent sign in the graphic's own writing: `٪` after Arabic-Indic digits. */
function markOf(c: Kit, mark: string): string {
  const m = String(mark ?? '');
  if (digitsFor(c.lang) !== 'arab') return m.replace(/\u066A/g, '%');
  return m.replace(/%/g, '\u066A');
}

const isPercent = (mark: string) => /^\s*[%\u066A]\s*$/.test(mark);

/** A unit as a counter writes it after the number: a word (`users`, `ألف`) stands a space apart, a sign (`%`, `k`) does not, as the charts write theirs. */
function unitAfter(unit: string): string {
  const u = unit.trim();
  return u && /\p{L}/u.test(u[0]) && Array.from(u).length > 1 ? ` ${u}` : u;
}

/** The sample's words for a field in the graphic's language. */
function sampleOf(c: Kit, key: string): string {
  const r = SAMPLES[c.recipe as DataId];
  return r?.[c.lang]?.[key] ?? r?.en?.[key] ?? '';
}

/**
 * Every animation of a layer held inside its own span, and a layer that would
 * start too late to be seen dropped: what the reader would do to it, done
 * here, so a graphic of one second reads back exactly as it was built.
 */
function settle(layers: Layer[], seconds: number): Layer[] {
  const out: Layer[] = [];
  for (const l of layers) {
    const end = Math.min(l.end, seconds);
    if (!(l.start < seconds - 0.05) || !(end > l.start + 0.05)) continue;
    const span = end - l.start;
    const fit = (a: Anim | undefined): Anim | undefined => (a ? { ...a, d: clamp(a.d, 0.05, span), delay: clamp(a.delay, 0, span) } : a);
    const next = { ...l, end } as Layer;
    if (l.in) next.in = fit(l.in);
    if (l.out) next.out = fit(l.out);
    if (next.kind === 'counter') next.count = { ...next.count, d: clamp(next.count.d, 0.05, span), delay: clamp(next.count.delay, 0, span) };
    out.push(next);
  }
  return out;
}

/** A moving ground under everything: faint, slow, and there from the first frame to the last. */
function groundOf(c: Kit, b: Beat, style: 'aurora' | 'grid' | 'dots' | 'bokeh', o: { opacity?: number; density?: number; speed?: number } = {}): Layer {
  return c.backdrop('backdrop', {
    style, colors: ['accent', 'accent2'], speed: o.speed ?? 1, density: o.density ?? 0.5, opacity: o.opacity ?? 0.8,
    start: 0, end: c.seconds, in: c.enter('fade', { d: b.s(1), ease: E.soft }),
  });
}

/** Where a chart's heading ends, and its layers. */
interface Head {
  layers: Layer[];
  /** u from the top of the frame to the bottom of the title: where the chart may begin. */
  bottom: number;
}

/**
 * A graphic's heading: a short accent rule drawn from the start edge, then
 * the title masked up from behind its own line a beat later, at the start
 * margin or centred. On the wide frame it is one line (`fit` shrinks a long
 * one); on a narrower one a title too long for a line takes two, set small
 * enough that two hold it, rather than shrinking into a caption. An empty
 * title is no title: the chart below it takes the room.
 */
function headOf(c: Kit, b: Beat, align: 'start' | 'center'): Head {
  const M = marginOf(c);
  const text = (c.fields.title ?? '').trim();
  if (!text) return { layers: [], bottom: M };
  const full = c.landscape ? 6.4 : c.portrait ? 6.6 : 5.8;
  const max = c.u.w - 2 * M;
  const ems = wordsEm(text) * 1.1;
  const wraps = !c.landscape && ems * full > max;
  const shrunk = wraps ? Math.min(full, (2 * max * 0.86) / ems) : full;
  // A line breaks between words, never inside one (motiondraw.ts never cuts a word), so a title with a word wider than
  // a line even at the two-line size — a web address, an e-mail — would run off the frame: it is one line, fitted.
  const two = wraps && Math.max(...text.split(/\s+/).map((w) => wordsEm(w) * 1.1)) * shrunk <= max;
  const size = two ? shrunk : full;
  const ruleY = c.portrait ? 10 : c.landscape ? 8 : 6.5;
  const y = ruleY + 3;
  const pin = align === 'center' ? 'tc' : 'ts';
  const x = align === 'center' ? 0 : M;
  const lead = 1.12;
  return {
    bottom: y + size * lead * (two ? 2 : 1),
    layers: [
      c.shape('accent-rule', {
        name: 'Accent rule', shape: 'rect', w: 6, h: 0.8, radius: 0.4, fill: 'accent', pin, x, y: ruleY, start: b.s(0.05), end: c.seconds,
        in: c.enter('grow', { d: b.s(0.55) }), out: c.leave('grow', { d: b.exit }),
      }),
      c.text('title', {
        text, voice: 'sans', size, weight: 800, color: 'fg', align, lead, max, fit: !two, pin, x, y,
        start: b.s(0.12), end: c.seconds,
        in: c.enter('mask', { by: 'line', gap: T.gap, d: b.s(T.enter) }), out: c.leave('mask', { by: 'line', gap: T.gap, d: b.exit }),
      }),
    ],
  };
}

// ── big number ────────────────────────────────────────────────────────────

/**
 * The big number's entrance curve: at a fifth of its size-change within the
 * first 5% of the run (so the number is there as the count starts), at rest
 * by 36%, then past rest to 1.19 at `LAND_PEAK` and back to rest at the end.
 * Fed to `pop`, whose overshoot is kept, that is a number that grows as it
 * counts and swells gently as it lands. Written exactly as the reader writes
 * a curve back, so a graphic reads back unchanged.
 */
const LAND = 'bezier(0.02,0.95,0.7,1.5)';
/** Where in its run `LAND` peaks: the entrance is timed so this is the moment the count lands. */
const LAND_PEAK = 0.709;

/**
 * Big number: a faint track ring opens (0.1 s), then the accent ring sweeps
 * round from the top while the number rolls up from zero inside it — both on
 * the same 1.6 s `expo-out`, so the ring closes exactly as the number lands,
 * fast at first and settling gently, which is what makes a count feel like it
 * arrives rather than stops. The number pops in, grows to its size as it
 * counts and swells a few per cent past it at the moment it lands before
 * settling (`LAND`): one gentle pulse, on one layer. The label masks up
 * beneath in the muted tone while the count is still running. Everything
 * leaves together, the ring unwinding the way it came.
 *
 * The ring is a real gauge when the number is a percentage (80% sweeps 80% of
 * the way round, a negative one sweeps backwards) and a whole circle
 * otherwise. The type is sized by the number's width, so twelve digits stay
 * inside the ring.
 */
function bigNumber(c: Kit): Layer[] {
  const b = beatOf(c);
  const fig = numberOf(c.fields.value ?? '') ?? numberOf(sampleOf(c, 'value')) ?? ZERO;
  const prefix = markOf(c, c.fields.prefix || fig.prefix);
  const suffix = markOf(c, c.fields.suffix || (fig.percent ? '%' : fig.suffix));
  const percent = isPercent(suffix) || (fig.percent && !c.fields.suffix);
  const shape = c.landscape
    ? { d: 58, th: 2.4, label: 4.6, max: 110, gap: 5.5 }
    : c.portrait
      ? { d: 76, th: 3, label: 5.2, max: 80, gap: 7 }
      : c.square
        ? { d: 54, th: 2.3, label: 4.3, max: 80, gap: 5 }
        : { d: 60, th: 2.5, label: 4.6, max: 80, gap: 5.5 };
  const label = (c.fields.label ?? '').trim();
  // The ring and the label under it are centred as one group, the label's height guessed from its length.
  const lines = label ? Math.min(3, Math.ceil((wordsEm(label) * shape.label) / shape.max)) : 0;
  const below = lines ? shape.gap + lines * shape.label * 1.3 : 0;
  const L = { ...shape, y: -below / 2 };
  const sweep = percent ? clamp(fig.value, -100, 100) * 3.6 : fig.value < 0 ? -360 : 360;
  const em = figureEm(fig.value, fig.decimals, prefix, suffix, c.lang);
  const inner = L.d / 2 - L.th - 1.5;
  // The number's corners stay inside the ring: half its width and half a digit's height within the inner radius.
  const size = Math.min(L.d * 0.3, (0.92 * inner) / Math.hypot(em / 2, 0.36));
  const t0 = b.s(0.3);
  const roll = b.s(1.6);
  // When the count is seen to land: `expo-out` (1 − 2^−10x) comes within half of the last digit shown at
  // x = log2(2·|value|·10^decimals) / 10 of its run — 73% for 80, the whole run for 1,000 and more — and the ring is
  // closed to the eye by then too. The swell peaks there.
  const landing = clamp(Math.log2(Math.max(1, 2 * Math.abs(fig.value) * Math.pow(10, fig.decimals))) / 10, 0.55, 1);
  const ring = { shape: 'arc' as const, w: L.d, h: L.d, from: 0, fill: null, pin: 'mc' as const, x: 0, y: L.y };
  const layers: Layer[] = [
    groundOf(c, b, 'aurora', { opacity: 0.75, density: 0.45 }),
    c.shape('track', {
      ...ring, sweep: 360, stroke: { color: 'fg', width: L.th, cap: 'round' }, opacity: 0.12, start: b.s(0.1), end: c.seconds,
      in: c.enter('zoom', { d: b.s(0.9), amount: 0.25 }), out: c.leave('fade', { d: b.exit }),
    }),
    c.shape('ring', {
      ...ring, sweep, stroke: { color: sheen(45), width: L.th, cap: 'round' }, shadow: { color: 'accent', blur: 2.2, x: 0, y: 0 },
      start: t0, end: c.seconds, in: c.enter('draw', { d: roll }), out: c.leave('draw', { d: b.exit }),
    }),
    c.counter('number', {
      from: 0, to: fig.value, decimals: fig.decimals, prefix, suffix, group: true, voice: 'sans', size, weight: 800, color: 'fg',
      align: 'center', track: -0.01, pin: 'mc', x: 0, y: L.y, start: t0, end: c.seconds, count: { d: roll, delay: 0, ease: E.enter },
      // One entrance that pops the number in, grows it to its size as it counts, and swells it a few per cent past that
      // exactly as the count lands (LAND peaks at LAND_PEAK of its run), settling after: the landing's pulse.
      in: c.enter('pop', { d: (roll * landing) / LAND_PEAK, ease: LAND, amount: 0.35 }), out: c.leave('pop', { d: b.exit, amount: 0.35 }),
    }),
  ];
  if (label) {
    layers.push(c.text('label', {
      text: label, voice: 'sans', size: L.label, weight: 500, color: 'muted', align: 'center', lead: 1.3, max: L.max,
      pin: 'tc', x: 0, y: c.u.h / 2 + L.y + L.d / 2 + L.gap, start: b.s(0.85), end: c.seconds,
      in: c.enter('mask', { by: 'line', gap: T.gap, d: b.s(T.enter) }), out: c.leave('mask', { by: 'line', gap: T.gap, d: b.exit }),
    }));
  }
  return settle(layers, c.seconds);
}

// ── bar chart ─────────────────────────────────────────────────────────────

/** The most colours a chart layer keeps (the reader's `LIMITS.colors`): past it they cycle. */
const CHART_COLORS = 6;

/**
 * Bar colours: the accent, with the tallest bar in the second accent — the one
 * the eye should land on. A chart holds six colours and cycles them, so with
 * seven or eight bars the tallest can have a colour of its own only where no
 * other bar shares its place in the cycle; where one would, every bar is the
 * accent rather than two of them lit.
 */
function barColors(items: Item[]): string[] {
  const n = items.length;
  if (n < 2) return ['accent'];
  let top = 0;
  items.forEach((it, i) => { if (it.value > items[top].value) top = i; });
  const cycle = Math.min(n, CHART_COLORS);
  const alone = items.every((_, i) => i === top || i % cycle !== top % cycle);
  return alone ? Array.from({ length: cycle }, (_, i) => (i === top % cycle ? 'accent2' : 'accent')) : ['accent'];
}

/**
 * How a bar grows. The design is `back-out` (`E.pop`): a bar that overshoots a
 * hair and settles, the gesture of a bar landing, which motioncharts.ts's
 * `stretch` leaves room for. But that chart reads a datum's growth as
 * `min(grow, clamp01(draw), clamp01(reveal))`, which holds it at 1, so an
 * overshooting curve is cut off at full height and the bar stops dead while
 * still moving. Until the chart lets growth pass 1, the bars ease out.
 */
const BAR_EASE = E.enter;

/**
 * Bar chart: the title masks in under its accent rule, then the bars grow
 * from a faint baseline one after another, 0.1 s apart, fast at first and
 * settling softly (`BAR_EASE`), each with its value counting up above it and
 * its unit after the number; the tallest is lit in the second accent. They
 * leave in the same order, shrinking back into the baseline.
 *
 * One to eight bars fill the width below the title. In portrait, more than
 * four, or labels too long for their slot anywhere, lie the bars down
 * (`hbars`), where a label has a third of the width to itself.
 */
function barChart(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const items = itemsOf(c.fields.items ?? '', META['bar-chart'].fields[1].max, sampleOf(c, 'items'));
  const n = items.length;
  const unit = markOf(c, c.fields.unit ?? '');
  const head = headOf(c, b, 'start');
  const size = c.landscape ? 3.2 : c.portrait ? 3.8 : c.square ? 3.3 : 3.5;
  const W = c.u.w - 2 * M;
  const longest = Math.max(...items.map((it) => wordsEm(it.label) * size));
  const horizontal = (c.portrait && n > 4) || longest > ((W / n) * 0.92) / 0.8;
  const top = head.bottom + (c.landscape ? 7 : 8);
  const bottom = c.u.h - M;
  const room = Math.max(20, bottom - top);
  const h = horizontal ? Math.min(room, n * size * 3.6) : room;
  const layers: Layer[] = [
    groundOf(c, b, 'grid', { opacity: 0.55, density: 0.4 }),
    ...head.layers,
    c.chart('chart', {
      chart: horizontal ? 'hbars' : 'bars', w: W, h, data: items.map((it) => ({ label: it.label, value: it.value })),
      colors: barColors(items), max: 0, unit, labels: true, values: true, voice: 'sans', size, color: 'fg', thick: 1.4,
      gap: b.s(0.1), pin: 'tc', x: 0, y: top + (room - h) / 2, start: b.s(0.35), end: c.seconds,
      in: c.enter('grow', { d: b.s(0.8), ease: BAR_EASE }), out: c.leave('grow', { d: b.exit }),
    }),
  ];
  return settle(layers, c.seconds);
}

// ── donut ─────────────────────────────────────────────────────────────────

/** How a slice is coloured: a palette tone, full or as a tint (drawn by a second, fainter chart layer). */
interface Tone {
  color: string;
  tint: boolean;
}

/** The opacity a tint is drawn at. */
const TINT = 0.5;

/**
 * Slice colours for one to six slices, every one distinct: the two accents,
 * then the muted tone and the ink, then the accents again as tints. Tokens
 * only, so a new palette re-colours the donut without building it again.
 */
function tonesOf(n: number): Tone[] {
  const all: Tone[] = [
    { color: 'accent', tint: false }, { color: 'accent2', tint: false }, { color: 'muted', tint: false },
    { color: 'fg', tint: false }, { color: 'accent', tint: true }, { color: 'accent2', tint: true },
  ];
  return all.slice(0, Math.max(1, Math.min(6, n)));
}

/** What stands under a donut's total, in each language: the app's own translation of "in total". */
const IN_TOTAL: Readonly<Record<Lang, string>> = { en: 'in total', ar: 'بالمجمل', ckb: 'بە گشتی', kmr: 'ب گشتی' };

/**
 * Donut: the title masks in and a faint track ring opens, then the slices
 * sweep in clockwise from the top one after another, 0.14 s apart, while the
 * number in the middle counts up to the total and each legend row — a
 * swatch, the name, the value counting up — arrives with its own slice, so
 * the eye can follow which is which. When the values are shares of a hundred
 * the middle shows the largest share and its name instead of a total of 100.
 * The slices unwind the way they came and the rest fades with them.
 *
 * The legend sits beside the ring on a wide frame and under it otherwise, in
 * two columns when there are more than three slices on a square or 4:5 one,
 * and is only as wide as its words need, so a short legend keeps the whole
 * graphic together in the middle of the frame.
 */
function donut(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const items = itemsOf(c.fields.items ?? '', META.donut.fields[1].max, sampleOf(c, 'items'));
  const n = items.length;
  const tones = tonesOf(n);
  const head = headOf(c, b, 'start');
  const top = head.bottom + (c.landscape ? 8 : 7);
  const bottom = c.u.h - M;
  const side = c.landscape;
  const cols = !side && !c.portrait && n > 3 ? 2 : 1;
  const rows = Math.ceil(n / cols);
  const font = c.landscape ? 3.6 : c.portrait ? 4.4 : c.square ? 3.4 : 3.6;
  const rowH = font * (side ? 2.5 : 2.3);
  const sw = font * 0.72;

  // What the slices add up to, and whether they are shares of a hundred.
  const shares = items.map((it) => Math.max(0, it.value));
  const total = shares.reduce((s, v) => s + v, 0);
  const asShares = total > 0 && Math.abs(total - 100) < 0.5 && items.every((it) => it.value >= 0);
  let biggest = 0;
  shares.forEach((v, i) => { if (v > shares[biggest]) biggest = i; });
  const suffixes = items.map((it) => markOf(c, it.percent || asShares ? '%' : ''));

  // A legend row, sized to its words: the swatch, the name, a gap, the value at the far end.
  const valueW = Math.max(...items.map((it, i) => figureEm(it.value, it.decimals, '', suffixes[i], c.lang))) * font;
  const nameW = Math.min(font * 15, Math.max(font * 4, ...items.map((it) => wordsEm(it.label) * font)));
  const gapS = font * 0.7;
  const gapV = font * 1.8;
  const colGap = cols === 2 ? font * 2.2 : 0;
  const avail = c.u.w - 2 * M;
  const colW = Math.min(sw + gapS + nameW + gapV + valueW, side ? 70 : (avail - colGap * (cols - 1)) / cols);
  const legendW = cols * colW + (cols - 1) * colGap;

  // The ring and the legend: side by side on the wide frame, stacked and centred otherwise.
  let D: number;
  let ringX = 0;
  let ringY: number;
  let legendX0: number;
  let legendY0: number;
  if (side) {
    D = Math.min(62, bottom - top - 2);
    const between = Math.max(10, D * 0.2);
    const group = D + between + legendW;
    ringX = -group / 2 + D / 2;
    ringY = (top + bottom) / 2 - c.u.h / 2;
    legendX0 = -group / 2 + D + between;
    legendY0 = ringY - (rows * rowH) / 2;
  } else {
    const legendH = rows * rowH;
    const between = 7;
    D = Math.max(20, Math.min(c.portrait ? 74 : c.square ? 48 : 58, bottom - top - legendH - between));
    const spare = Math.max(0, bottom - top - (D + between + legendH));
    ringY = top + spare * 0.4 + D / 2 - c.u.h / 2;
    legendX0 = -legendW / 2;
    legendY0 = ringY + D / 2 + between;
  }
  const thick = D * 0.13;
  const t0 = b.s(0.4);
  const gap = b.s(0.14);
  const sweepD = b.s(0.9);
  const data = items.map((it) => ({ label: it.label, value: it.value }));
  // The chart's own track is drawn in the ground's colour, so it is not seen: the track is its own layer, which fades out
  // with the rest instead of staying until the chart's last frame.
  const chart = {
    chart: 'donut' as const, w: D, h: D, data, max: 0, unit: '', labels: false, values: false, voice: 'sans' as const, size: font,
    color: 'bg', thick, gap, pin: 'mc' as const, x: ringX, y: ringY, start: t0, end: c.seconds,
    in: c.enter('draw', { d: sweepD }), out: c.leave('draw', { d: b.exit }),
  };
  const layers: Layer[] = [
    groundOf(c, b, 'aurora', { opacity: 0.6, density: 0.4 }),
    ...head.layers,
    c.shape('track', {
      shape: 'arc', w: D, h: D, from: 0, sweep: 360, fill: null, stroke: { color: 'fg', width: thick, cap: 'butt' }, opacity: 0.08,
      pin: 'mc', x: ringX, y: ringY, start: b.s(0.2), end: c.seconds,
      in: c.enter('zoom', { d: b.s(0.9), amount: 0.2 }), out: c.leave('fade', { d: b.exit }),
    }),
    c.chart('chart', { ...chart, colors: tones.map((t) => (t.tint ? CLEAR : t.color)) }),
  ];
  if (tones.some((t) => t.tint)) {
    // A token has no opacity of its own, so the tinted slices are a second chart over the first, at the tint's opacity, drawing only them.
    layers.push(c.chart('chart-tints', { ...chart, colors: tones.map((t) => (t.tint ? t.color : CLEAR)), opacity: TINT }));
  }

  // The middle: the total counting up — or the largest share and its name, when the values are shares of a hundred.
  const hole = D - 2 * thick;
  const middle = asShares ? items[biggest].value : total;
  const middleDec = asShares ? items[biggest].decimals : Math.max(0, ...items.map((it) => it.decimals));
  const pct = asShares ? markOf(c, '%') : '';
  const caption = asShares ? items[biggest].label : IN_TOTAL[c.lang] ?? IN_TOTAL.en;
  const numSize = Math.min(hole * 0.28, (hole * 0.7) / figureEm(middle, middleDec, '', pct, c.lang));
  const capSize = Math.max(2.2, Math.min(font * 0.9, numSize * 0.34));
  const lift = caption ? capSize * 0.85 : 0;
  const roll = sweepD + (n - 1) * gap;
  layers.push(c.counter('total', {
    from: 0, to: middle, decimals: middleDec, prefix: '', suffix: pct, group: true, voice: 'sans', size: numSize, weight: 800,
    color: 'fg', align: 'center', track: -0.01, pin: 'mc', x: ringX, y: ringY - lift, start: t0, end: c.seconds,
    count: { d: roll, delay: 0, ease: E.enter }, in: c.enter('fade', { d: b.s(0.6) }), out: c.leave('fade', { d: b.exit }),
  }));
  if (caption) {
    layers.push(c.text('total-label', {
      name: 'Total label', text: caption, voice: 'sans', size: capSize, weight: 600, color: 'muted', align: 'center', lead: 1.2, max: hole * 0.74, fit: true,
      pin: 'mc', x: ringX, y: ringY - lift + numSize * 0.6 + capSize * 0.75, start: t0 + b.s(0.3), end: c.seconds,
      in: c.enter('rise', { d: b.s(0.6), amount: 0.5 }), out: c.leave('fade', { d: b.exit }),
    }));
  }

  // The legend: a row per slice, arriving with its slice.
  items.forEach((it, i) => {
    const col = cols === 2 ? Math.floor(i / rows) : 0;
    const row = cols === 2 ? i % rows : i;
    const x0 = legendX0 + col * (colW + colGap);
    const x1 = x0 + colW;
    const y = legendY0 + (row + 0.5) * rowH;
    const at = t0 + i * gap + b.s(0.15);
    const tone = tones[i];
    const nameX = x0 + sw + gapS;
    const nameMax = Math.max(font * 3, x1 - nameX - gapV - valueW);
    layers.push(
      c.shape(`swatch-${i + 1}`, {
        shape: 'rect', w: sw, h: sw, radius: sw * 0.3, fill: tone.color, opacity: tone.tint ? TINT : 1, pin: 'mc', x: x0 + sw / 2, y,
        start: at, end: c.seconds, in: c.enter('pop', { d: b.s(T.quick), ease: E.pop }), out: c.leave('fade', { d: b.exit }),
      }),
      c.text(`name-${i + 1}`, {
        text: it.label, voice: 'sans', size: font, weight: 600, color: 'fg', align: 'start', lead: 1.2, max: nameMax, fit: true,
        pin: 'mc', x: nameX + nameMax / 2, y, start: at + b.s(0.04), end: c.seconds,
        in: c.enter('rise', { d: b.s(0.6), amount: 0.5 }), out: c.leave('fade', { d: b.exit }),
      }),
      c.counter(`value-${i + 1}`, {
        from: 0, to: it.value, decimals: it.decimals, prefix: '', suffix: suffixes[i], group: true, voice: 'sans', size: font, weight: 700,
        color: 'muted', align: 'end', track: 0, pin: 'me', x: -(c.u.w / 2 - x1), y, start: at + b.s(0.08), end: c.seconds,
        count: { d: sweepD, delay: 0, ease: E.enter }, in: c.enter('fade', { d: b.s(0.5) }), out: c.leave('fade', { d: b.exit }),
      }),
    );
  });
  return settle(layers, c.seconds);
}

// ── line chart ────────────────────────────────────────────────────────────

/**
 * Line chart: the title masks in, then the line draws itself from the first
 * point to the last (right to left in Arabic and Kurdish) in one unbroken
 * stroke on an in-out curve, a soft area filling in under it and each point's
 * dot popping as the line reaches it, with its label rising beneath at the
 * same moment. As the line arrives, the last value is called out in a tag
 * that unrolls out of the last point and counts up, with the unit after it,
 * and a soft glow breathes behind that point for as long as the graphic
 * holds. On the way out the line retracts to its first point and the tag
 * rolls back in.
 *
 * On the wide frame the tag stands beside the last point, where the line can
 * never run under it; on the others, where width is scarce, it stands above
 * it. The chart's own labels are off and drawn here instead, so where every
 * point falls is known before anything is measured — which is what lets the
 * tag sit exactly at the last point. Labels too long for their place are
 * thinned (every second or third, counted back from the last) rather than
 * shrunk into dust; the others stay in the graphic, hidden.
 */
function lineChart(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const items = itemsOf(c.fields.items ?? '', META['line-chart'].fields[1].max, sampleOf(c, 'items'));
  const n = items.length;
  const unit = markOf(c, c.fields.unit ?? '');
  const last = items[n - 1];
  const head = headOf(c, b, 'start');
  const beside = c.landscape;
  const font = c.landscape ? 3 : c.portrait ? 3.4 : 3;
  const thick = c.landscape ? 0.9 : 1;
  // The tag: its words, their estimated width, and the plate around them.
  const tagSize = c.landscape ? 3.8 : c.portrait ? 4.4 : 3.8;
  const tagSuffix = unitAfter(unit);
  const tagW = figureEm(last.value, last.decimals, '', tagSuffix, c.lang) * tagSize + tagSize * 1.7;
  const tagH = tagSize * 1.9;
  const tagGap = 2.2;
  const dotR = Math.max(thick * 1.25, 0.7);
  const pad = dotR + thick;
  // Horizontal: the first and last points are placed so that what stands around them stays inside the safe margin — a
  // dot, half a label centred under it, the glow behind the last point and a tag beside it.
  const A = c.u.w - 2 * M;
  // Each label's box is as wide as its words (with a little to spare), so a short one at either end stays inside the frame.
  const labelEms = items.map((it) => wordsEm(it.label) * font * 1.08);
  const slack = 1;
  const cap = c.landscape ? 26 : 22;
  const half = (i: number) => Math.min(cap, labelEms[i] + slack) / 2;
  const glowR = dotR * 2.5;
  const endRoom = beside ? dotR + tagGap + tagW : Math.max(pad, glowR, half(n - 1));
  let startRoom = Math.max(pad, half(0));
  let span = Math.max(10, A - startRoom - endRoom);
  let step = n > 1 ? span / (n - 1) : span;
  // The labels share one size, the largest at which the widest shown fits its room. When even 72% is not enough, only
  // every second or third is shown, counted back from the last, and each shown one has the room of the ones between.
  const need = Math.max(...labelEms);
  let every = 1;
  while (every < n - 1 && need * 0.72 > Math.min(cap, step * every * 0.92)) every += 1;
  const shown = (i: number) => (n - 1 - i) % every === 0;
  // With the first point's label hidden, the start needs room only for the first label shown, which is further in.
  // The step can only grow from this, so the thinning above still holds.
  const lead0 = (n - 1) % every;
  if (lead0 > 0) {
    startRoom = Math.max(pad, half(lead0) - lead0 * step);
    span = Math.max(10, A - startRoom - endRoom);
    step = n > 1 ? span / (n - 1) : span;
  }
  const room = Math.min(cap, n > 1 ? step * every * 0.92 : span);
  const widest = Math.max(1, ...labelEms.filter((_, i) => shown(i)));
  const labelScale = clamp(room / widest, 0.72, 1);
  // The chart's box holds the points `pad` in from its edges.
  const Wc = span + 2 * pad;
  const boxX = -c.u.w / 2 + M + startRoom + span / 2;
  // Vertical: the plot from under the title (and a tag above its highest point) to above the row of labels; on a tall
  // frame no taller than it is wide, and a little above the middle of the room it has.
  const labelRow = font * 1.3 + 2.4;
  const above = beside ? tagH / 2 : tagH + tagGap + dotR;
  const top = head.bottom + (c.landscape ? 9 : 8) + above;
  const bottom = c.u.h - M - labelRow;
  const Hc = Math.max(16, Math.min(bottom - top, beside ? 999 : Wc));
  const boxY = top + Math.max(0, bottom - top - Hc) * 0.4 + Hc / 2 - c.u.h / 2;
  // Where each point falls, as motioncharts.ts's `line` places it with its labels and values off.
  const lineW = Math.min(thick, Hc * 0.08);
  const baseY = Hc / 2 - lineW / 2;
  const plotTop = -Hc / 2 + dotR;
  const largest = Math.max(0, ...items.map((it) => it.value));
  const scale = largest > 0 ? largest : 1;
  const px = (i: number) => boxX + (n > 1 ? -Wc / 2 + pad + (i * (Wc - 2 * pad)) / (n - 1) : 0);
  const py = (i: number) => boxY + baseY - (baseY - plotTop) * clamp(Math.max(0, items[i].value) / scale, 0, 1);

  const t0 = b.s(0.45);
  const drawD = b.s(n > 1 ? 1.2 + 0.08 * n : 0.6);
  const arrive = t0 + drawD;
  // When the line reaches point i on its `inout` curve (by its x, which the length follows closely).
  const inout = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const reachAt = (f: number) => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (inout(mid) < f) lo = mid;
      else hi = mid;
    }
    return t0 + drawD * lo;
  };
  const layers: Layer[] = [
    groundOf(c, b, 'grid', { opacity: 0.5, density: 0.4 }),
    ...head.layers,
    c.chart('chart', {
      chart: 'line', w: Wc, h: Hc, data: items.map((it) => ({ label: it.label, value: it.value })), colors: ['accent'], max: 0,
      unit, labels: false, values: false, voice: 'sans', size: font, color: 'fg', thick, gap: 0, pin: 'mc', x: boxX, y: boxY,
      start: t0, end: c.seconds, in: c.enter('draw', { d: drawD, ease: 'inout' }), out: c.leave('draw', { d: b.exit }),
    }),
  ];
  items.forEach((it, i) => {
    if (!it.label) return;
    const at = n > 1 ? reachAt(i / (n - 1)) : t0;
    layers.push(c.text(`label-${i + 1}`, {
      text: it.label, voice: 'sans', size: font * labelScale, weight: 500, color: 'muted', align: 'center', lead: 1.2,
      max: Math.min(room, labelEms[i] * labelScale + slack), fit: true,
      pin: 'tc', x: px(i), y: c.u.h / 2 + boxY + Hc / 2 + 2.4, start: Math.max(0, at - b.s(0.1)), end: c.seconds,
      hidden: shown(i) ? undefined : true,
      in: c.enter('rise', { d: b.s(0.5), amount: 0.5 }), out: c.leave('fade', { d: b.exit }),
    }));
  });
  // The last point: a glow that breathes behind it, and the tag at it. The tag unrolls with a wipe rather than fading in,
  // out of the point: beside it from the start side, above it from below.
  const lx = px(n - 1);
  const ly = py(n - 1);
  const tagX = beside ? lx + dotR + tagGap + tagW / 2 : clamp(lx, -c.u.w / 2 + M + tagW / 2, c.u.w / 2 - M - tagW / 2);
  const tagY = beside ? Math.min(ly, boxY + baseY - tagH / 2 - 0.6) : ly - dotR - tagGap - tagH / 2;
  const unroll = (delay: number) => c.enter('wipe', { d: b.s(0.55), dir: beside ? 'start' : 'up', delay });
  const rollUp = (delay: number) => c.leave('wipe', { d: b.exit, dir: beside ? 'start' : 'up', delay });
  layers.push(
    c.shape('glow', {
      shape: 'ellipse', w: glowR * 2, h: glowR * 2, fill: 'accent', opacity: 0.28, pin: 'mc', x: lx, y: ly, start: arrive - b.s(0.1),
      end: c.seconds, in: c.enter('pop', { d: b.s(0.5), ease: E.pop }), out: c.leave('fade', { d: b.exit }), loop: c.loop('pulse', { d: 1.6, amount: 3 }),
    }),
    c.shape('tag', {
      shape: 'rect', w: tagW, h: tagH, radius: tagH / 2, fill: 'accent', shadow: PLATE_SHADOW, pin: 'mc', x: tagX, y: tagY,
      start: arrive - b.s(0.1), end: c.seconds, in: unroll(0), out: rollUp(0),
    }),
    // The number trails the plate by a moment coming in and leads it going out, so it is never uncovered where the plate is not.
    c.counter('tag-value', {
      name: 'Tag value', from: 0, to: last.value, decimals: last.decimals, prefix: '', suffix: tagSuffix, group: true, voice: 'sans', size: tagSize, weight: 800,
      color: 'bg', align: 'center', track: 0, pin: 'mc', x: tagX, y: tagY, start: arrive - b.s(0.1), end: c.seconds,
      count: { d: b.s(0.7), delay: b.s(0.05), ease: E.enter }, in: unroll(b.s(0.06)), out: rollUp(Math.min(0.06, b.exit / 4)),
    }),
  );
  return settle(layers, c.seconds);
}

// ── three figures ─────────────────────────────────────────────────────────

/**
 * Three numbers: the title masks in, then three figures arrive 0.15 s apart,
 * each an icon that pops in its badge, a number that rises while it rolls up
 * from zero, and its label in the muted tone beneath; thin rules grow between
 * them as they land. The icons float gently while the graphic holds, out of
 * step with one another, so the still part is not quite still. The icon for
 * each figure is chosen by a word in its label (`iconFor`).
 *
 * Three columns on the wide, square and 4:5 frames; on the tall one the three
 * figures stack, one under another, each centred, with a rule between them.
 * The numbers share one size, the largest at which the widest of them fits.
 * The badges cast no shadow, so that they can fade with their figure at the end
 * (a shadowed shape is kept from fading throughout these recipes: see `glassOf`
 * in motionrecipes-overlays.ts).
 */
function stats(c: Kit): Layer[] {
  const b = beatOf(c);
  const M = marginOf(c);
  const items = itemsOf(c.fields.items ?? '', META.stats.fields[1].max, sampleOf(c, 'items'));
  const n = items.length;
  const stacked = c.portrait;
  const head = headOf(c, b, 'center');
  const layers: Layer[] = [groundOf(c, b, 'aurora', { opacity: 0.55, density: 0.35 }), ...head.layers];
  const marks = items.map((it) => ({ prefix: markOf(c, it.prefix), suffix: markOf(c, it.percent ? '%' : it.suffix) }));
  const widest = Math.max(...items.map((it, i) => figureEm(it.value, it.decimals, marks[i].prefix, marks[i].suffix, c.lang)));
  const top = head.bottom + (c.landscape ? 6 : 7);
  const bottom = c.u.h - M;
  const at = (i: number) => b.s(0.45) + i * b.s(0.15);

  // One figure, centred on x: the badge, the number under it, the label under that (two lines at most, as a label is short).
  type Look = { glyph: number; numSize: number; labelSize: number; labelMax: number };
  const heightOf = (o: Look) => o.glyph * 1.84 + 3.5 + o.numSize * 1.2 + 2 + o.labelSize * 1.25 * 2;
  const figure = (i: number, x: number, y0: number, o: Look): void => {
    const it = items[i];
    const badge = o.glyph * 1.84;
    const numY = y0 + badge + 3.5 + o.numSize * 0.6;
    layers.push(
      c.icon(`icon-${i + 1}`, {
        icon: iconFor(it.label, i), size: o.glyph, color: 'bg', weight: 2, badge: { shape: 'circle', fill: sheen(35), pad: o.glyph * 0.42 },
        pin: 'mc', x, y: y0 + badge / 2, start: at(i), end: c.seconds,
        in: c.enter('pop', { d: b.s(0.55), ease: E.pop }), out: c.leave('pop', { d: b.exit }),
        loop: c.loop('float', { d: 3.2 + i * 0.45, amount: 0.35 }),
      }),
      c.counter(`number-${i + 1}`, {
        from: 0, to: it.value, decimals: it.decimals, prefix: marks[i].prefix, suffix: marks[i].suffix, group: true, voice: 'sans',
        size: o.numSize, weight: 800, color: 'fg', align: 'center', track: -0.01, pin: 'mc', x, y: numY,
        start: at(i) + b.s(0.08), end: c.seconds, count: { d: b.s(1.6), delay: 0, ease: E.enter },
        in: c.enter('rise', { d: b.s(T.enter) }), out: c.leave('rise', { d: b.exit }),
      }),
    );
    if (it.label) {
      layers.push(c.text(`label-${i + 1}`, {
        text: it.label, voice: 'sans', size: o.labelSize, weight: 500, color: 'muted', align: 'center', lead: 1.25, max: o.labelMax,
        pin: 'tc', x, y: c.u.h / 2 + numY + o.numSize * 0.6 + 2, start: at(i) + b.s(0.2), end: c.seconds,
        in: c.enter('rise', { d: b.s(T.enter), amount: 0.6 }), out: c.leave('rise', { d: b.exit, amount: 0.6 }),
      }));
    }
  };
  const rule = (i: number, o: { x: number; y: number; w: number; h: number; dir: 'down' | 'start' }) => {
    layers.push(c.shape(`rule-${i}`, {
      shape: 'rect', w: o.w, h: o.h, radius: 0.1, fill: 'fg', opacity: 0.14, pin: 'mc', x: o.x, y: o.y,
      start: at(i), end: c.seconds, in: c.enter('grow', { d: b.s(0.8), dir: o.dir }), out: c.leave('grow', { d: b.exit, dir: o.dir }),
    }));
  };

  if (stacked) {
    // Three figures stacked fill a tall frame; under a two-line title they are set a little smaller rather than crowd the foot.
    const full: Look = { glyph: 6.4, numSize: Math.min(14, ((c.u.w - 2 * M) * 0.86) / widest), labelSize: 4.2, labelMax: c.u.w - 2 * M - 8 };
    const k = Math.min(1, (bottom - top) / (n * heightOf(full) + (n - 1) * 6));
    const o: Look = { ...full, glyph: full.glyph * k, numSize: full.numSize * k, labelSize: full.labelSize * Math.max(0.85, k) };
    const blockH = heightOf(o);
    const between = Math.max(4, Math.min(14, (bottom - top - n * blockH) / Math.max(1, n)));
    const total = n * blockH + (n - 1) * between;
    const y0 = top + Math.max(0, bottom - top - total) * 0.45 - c.u.h / 2;
    for (let i = 0; i < n; i++) {
      const y = y0 + i * (blockH + between);
      figure(i, 0, y, o);
      if (i > 0) rule(i, { x: 0, y: y - between / 2, w: Math.min(40, c.u.w - 2 * M), h: 0.2, dir: 'start' });
    }
    return settle(layers, c.seconds);
  }

  // Three columns across the safe area (a little narrower on the wide frame, where the whole width is too much for three).
  const colW = c.landscape ? 52 : (c.u.w - 2 * M) / 3;
  const o: Look = {
    glyph: c.landscape ? 6.4 : 5,
    numSize: Math.min(c.landscape ? 13 : 9.5, (colW * 0.84) / widest),
    labelSize: c.landscape ? 3.6 : 3.1,
    labelMax: colW - (c.landscape ? 8 : 2),
  };
  const blockH = heightOf(o);
  const y0 = top + Math.max(0, bottom - top - blockH) * 0.42 - c.u.h / 2;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * colW;
    figure(i, x, y0, o);
    if (i > 0) rule(i, { x: x - colW / 2, y: y0 + blockH / 2, w: 0.2, h: blockH * 0.9, dir: 'down' });
  }
  return settle(layers, c.seconds);
}

// ── the samples ───────────────────────────────────────────────────────────

type DataId = 'big-number' | 'bar-chart' | 'donut' | 'line-chart' | 'stats';

/**
 * What each template says before the person writes anything: plainly
 * placeholders — round numbers, quarters, months, a budget's usual lines —
 * so nobody mistakes one for a fact. Digits are 0-9 here; the engine writes
 * them in the graphic's own.
 */
const SAMPLES: Readonly<Record<DataId, Record<Lang, Record<string, string>>>> = {
  'big-number': {
    en: { value: '80', prefix: '', suffix: '%', label: 'Of this year’s goal' },
    ar: { value: '80', prefix: '', suffix: '%', label: 'من هدف هذا العام' },
    ckb: { value: '80', prefix: '', suffix: '%', label: 'لە ئامانجی ئەمساڵ' },
    kmr: { value: '80', prefix: '', suffix: '%', label: 'ژ ئارمانجا ئەڤ سالێ' },
  },
  'bar-chart': {
    en: { title: 'Sales by quarter', items: 'Q1: 40\nQ2: 55\nQ3: 70\nQ4: 90', unit: 'k' },
    ar: { title: 'المبيعات حسب الربع', items: 'الربع الأول: 40\nالربع الثاني: 55\nالربع الثالث: 70\nالربع الرابع: 90', unit: 'ألف' },
    ckb: { title: 'فرۆشتن بەپێی چارەک', items: 'چارەکی یەکەم: 40\nچارەکی دووەم: 55\nچارەکی سێیەم: 70\nچارەکی چوارەم: 90', unit: 'هەزار' },
    kmr: { title: 'فرۆتن ل دویڤ چارەکان', items: 'چارەکا ئێکێ: 40\nچارەکا دووێ: 55\nچارەکا سێیێ: 70\nچارەکا چارێ: 90', unit: 'هزار' },
  },
  donut: {
    en: { title: 'Where the budget goes', items: 'Salaries: 500\nRent: 200\nMarketing: 150\nOther: 150' },
    ar: { title: 'أين تذهب الميزانية', items: 'الرواتب: 500\nالإيجار: 200\nالتسويق: 150\nأخرى: 150' },
    ckb: { title: 'بودجە بۆ کوێ دەچێت', items: 'مووچە: 500\nکرێ: 200\nبازاڕکردن: 150\nهیتر: 150' },
    kmr: { title: 'بودجە بۆ کیڤە دچیت', items: 'مووچە: 500\nکرێ: 200\nبازارکرن: 150\nیێن دی: 150' },
  },
  'line-chart': {
    en: { title: 'Monthly visitors', items: 'Jan: 20\nFeb: 35\nMar: 30\nApr: 50\nMay: 65\nJun: 80', unit: 'k' },
    ar: { title: 'الزوار شهرياً', items: 'كانون الثاني: 20\nشباط: 35\nآذار: 30\nنيسان: 50\nأيار: 65\nحزيران: 80', unit: 'ألف' },
    ckb: { title: 'سەردانکەرانی مانگانە', items: 'کانوونی دووەم: 20\nشوبات: 35\nئازار: 30\nنیسان: 50\nئایار: 65\nحوزەیران: 80', unit: 'هەزار' },
    kmr: { title: 'سەرەدانکەرێن هەیڤانە', items: 'کانوونا دووێ: 20\nشوبات: 35\nئادار: 30\nنیسان: 50\nگولان: 65\nحزیران: 80', unit: 'هزار' },
  },
  stats: {
    en: { title: 'Our year in numbers', items: 'Students: 1200\nCourses: 40\nCountries: 12' },
    ar: { title: 'عامنا بالأرقام', items: 'الطلاب: 1200\nالدورات: 40\nالدول: 12' },
    ckb: { title: 'ساڵەکەمان بە ژمارە', items: 'قوتابیان: 1200\nکۆرسەکان: 40\nوڵاتان: 12' },
    kmr: { title: 'سالا مە ب ژمارە', items: 'خوێندکار: 1200\nکۆرس: 40\nوەلات: 12' },
  },
};

// ── the recipes ───────────────────────────────────────────────────────────

const recipe = (id: DataId, build: (c: Kit) => Layer[], backdrop?: Paint | null): Recipe =>
  backdrop === undefined ? { build, sample: SAMPLES[id] } : { build, sample: SAMPLES[id], backdrop };

export const DATA_RECIPES: Partial<Record<RecipeId, Recipe>> = {
  'big-number': recipe('big-number', bigNumber),
  'bar-chart': recipe('bar-chart', barChart),
  donut: recipe('donut', donut),
  'line-chart': recipe('line-chart', lineChart),
  stats: recipe('stats', stats),
};
