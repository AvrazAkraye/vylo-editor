// Dates and numbers in the interface's language (fmt.ts).
//
// An Arabic or Kurdish interface on an English Mac used to say "27 Sep".
// These pin the months each language names, and that the digits stay 0-9 like
// every other number the interface shows.
import { dateText, locale, localeOf, longDateText, monthText, setUiLang, timeText, weekdayText } from '../.test-build/fmt.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const sep27 = new Date(2026, 8, 27, 14, 5);
const day = () => sep27.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

setUiLang('ar');
ok('Arabic names the month as Iraq does', day().includes('أيلول'), day());
ok('with the digits the interface uses', /27/.test(day()) && !/[٠-٩]/.test(day()), day());
setUiLang('ckb');
ok('Sorani has its own month name', day().includes('ئەیلوول'), day());
setUiLang('kmr');
ok('Badini is written in Arabic script, not Latin Kurmanji', /[؀-ۿ]/.test(day()) && !/îlon|îln/i.test(day()), day());
setUiLang('en');
ok('English keeps the system’s own order', locale() === undefined);
ok('numbers group with the interface’s digits', (12345).toLocaleString(localeOf('ar')) === '12,345');
ok('localeOf maps a language code and passes others through', localeOf('ckb') === 'ckb-u-nu-latn' && localeOf('fr') === 'fr' && localeOf('en') === 'en');

// Badini has no platform names at all, and Chromium (Windows) has no Sorani:
// the app's own names are used, in Arabic script.
setUiLang('kmr');
ok('Badini date from the app’s own names', dateText(+sep27) === '27 ئیلون', dateText(+sep27));
ok('with the year when asked', dateText(+sep27, { year: true }) === '27 ئیلون 2026');
ok('Badini time is written 14:05', timeText(+sep27) === '14:05');
ok('Badini calendar heading', monthText(2026, 8, 'kmr') === 'ئیلون 2026');
ok('Badini weekday', weekdayText(sep27, 'kmr') === 'یەکشەمب', weekdayText(sep27, 'kmr'));
ok('Badini long date', longDateText(sep27, 'kmr') === 'یەکشەمب، 27 ئیلون', longDateText(sep27, 'kmr'));
setUiLang('ckb');
ok('Sorani date is Kurdish, whichever names are used', /ئەیلوول/.test(dateText(+sep27)), dateText(+sep27));
ok('Sorani calendar heading is Kurdish', /ئەیلوول/.test(monthText(2026, 8, 'ckb')), monthText(2026, 8, 'ckb'));
setUiLang('ar');
ok('Arabic calendar heading, Iraqi month', /أيلول/.test(monthText(2026, 8, 'ar')), monthText(2026, 8, 'ar'));
setUiLang('en');
ok('English date unchanged in shape', /Sep/.test(dateText(+sep27)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
