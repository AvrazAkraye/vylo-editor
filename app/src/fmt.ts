import type { Lang } from './i18n';

/**
 * Dates, times and numbers as the interface's language writes them.
 *
 * `toLocaleDateString(undefined, …)` follows the operating system, so a
 * Kurdish or Arabic interface on an English Mac said "27 Sep" beside Kurdish
 * words. These follow the language chosen in the app instead:
 *
 * - Arabic in the Iraqi form — أيلول, not سبتمبر — which is how Iraq and the
 *   Kurdistan Region name the months.
 * - Sorani with its own month names (ئەیلوول).
 * - Badini with the same Arabic-script names: the system has no Badini of its
 *   own, only Kurmanji in Latin letters (îlon), which a Badini reader does not
 *   write the interface in.
 *
 * Digits stay 0–9 everywhere, like every other number the interface shows;
 * a document's own digits are its own setting (Research, Slides).
 *
 * `setUiLang` is called by App whenever the language changes.
 */

let ui: Lang = 'en';

export function setUiLang(l: Lang): void {
  ui = l;
}

const LOCALE: Readonly<Record<Lang, string | undefined>> = {
  // English keeps the system's own conventions: day-month or month-day.
  en: undefined,
  ar: 'ar-IQ-u-nu-latn',
  ckb: 'ckb-u-nu-latn',
  kmr: 'ckb-u-nu-latn',
};

/** The locale for `toLocale…String` calls that show something to the person. */
export function locale(): string | undefined {
  return LOCALE[ui];
}

/** The same, for a language given rather than the interface's, as `Intl` takes it. */
export function localeOf(l: string): string {
  return (l in LOCALE ? LOCALE[l as Lang] : l) ?? 'en';
}

// ── Kurdish, where the platform has none ─────────────────────────────────

/**
 * Month and weekday names the app carries itself. macOS knows Sorani; the
 * Chromium engine under Windows does not, and falls back to English. No
 * platform has Badini in Arabic script, so Badini always uses its own.
 */
const OWN: Readonly<Record<'ckb' | 'kmr', { months: readonly string[]; days: readonly string[]; of: (day: number, month: string) => string }>> = {
  ckb: {
    months: ['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان', 'ئایار', 'حوزەیران', 'تەمووز', 'ئاب', 'ئەیلوول', 'تشرینی یەکەم', 'تشرینی دووەم', 'کانوونی یەکەم'],
    days: ['یەکشەممە', 'دووشەممە', 'سێشەممە', 'چوارشەممە', 'پێنجشەممە', 'هەینی', 'شەممە'],
    of: (d, m) => `${d}ی ${m}`,
  },
  kmr: {
    months: ['کانوونا دووێ', 'شوبات', 'ئادار', 'نیسان', 'گولان', 'حزیران', 'تیرمەه', 'تەباخ', 'ئیلون', 'چریا ئێکێ', 'چریا دووێ', 'کانوونا ئێکێ'],
    days: ['یەکشەمب', 'دووشەمب', 'سێشەمب', 'چارشەمب', 'پێنجشەمب', 'ئەینی', 'شەمبی'],
    of: (d, m) => `${d} ${m}`,
  },
};

let ckbKnown: boolean | null = null;
/** Whether this engine can name dates in Sorani itself. */
function hasSorani(): boolean {
  if (ckbKnown === null) {
    try { ckbKnown = Intl.DateTimeFormat.supportedLocalesOf(['ckb']).length > 0; } catch { ckbKnown = false; }
  }
  return ckbKnown;
}

/** Which own table a language needs here, if any. */
function own(l: string): (typeof OWN)['ckb'] | null {
  if (l === 'kmr') return OWN.kmr;
  if (l === 'ckb' && !hasSorani()) return OWN.ckb;
  return null;
}

/** "27 Sep", "27 أيلول", "27ی ئەیلوول" — with the year when asked. */
export function dateText(at: number, o: { year?: boolean; lang?: string } = {}): string {
  const d = new Date(at);
  const tab = own(o.lang ?? ui);
  if (tab) return tab.of(d.getDate(), tab.months[d.getMonth()]) + (o.year ? ` ${d.getFullYear()}` : '');
  return d.toLocaleDateString(o.lang ? localeOf(o.lang) : locale(), { day: 'numeric', month: 'short', ...(o.year ? { year: 'numeric' } : {}) });
}

/** A time of day. Kurdish without the platform's help is written 14:05. */
export function timeText(at: number): string {
  const d = new Date(at);
  if (own(ui)) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
}

/** "ئەیلوول 2026", for a calendar's heading. */
export function monthText(year: number, month: number, lang: string): string {
  const tab = own(lang);
  if (tab) return `${tab.months[month]} ${year}`;
  return new Intl.DateTimeFormat(localeOf(lang), { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));
}

/** A weekday's name; `short` where the platform has one. */
export function weekdayText(d: Date, lang: string, long = false): string {
  const tab = own(lang);
  if (tab) return tab.days[d.getDay()];
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: long ? 'long' : 'short' }).format(d);
}

/** "Wednesday, 2 September", for the heading over a day. */
export function longDateText(d: Date, lang: string): string {
  const tab = own(lang);
  if (tab) return `${tab.days[d.getDay()]}، ${tab.of(d.getDate(), tab.months[d.getMonth()])}`;
  return new Intl.DateTimeFormat(localeOf(lang), { weekday: 'long', day: 'numeric', month: 'long' }).format(d);
}
