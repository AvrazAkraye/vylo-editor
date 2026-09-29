// Typefaces, scripts and digits for motion graphics.
//
// What matters: a line with any Arabic-script character is set in the bundled
// Arabic face (Kurdish letters need it) and nothing else is; every voice's
// stack leads with its own family and ends with a generic one; the Arabic face
// is never asked for a weight it does not have; a counter's number is written
// the same on every engine — rounded, grouped, signed, and in Arabic-Indic
// digits with the Arabic separators for Arabic and Kurdish — without Intl; and
// loading fonts never holds up, or breaks, a first frame.
import {
  ARABIC_FACE, digitsFor, ensureFonts, fontStack, fontString, fontsNeeded, formatNumber, scriptOf, toArabicDigits,
} from '../.test-build/motionfonts.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const cps = (s) => Array.from(s).map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join(' ');
const ch = (...codes) => String.fromCharCode(...codes);

// ── scripts ───────────────────────────────────────────────────────────────
console.log('scripts');
ok('Latin words are latin', scriptOf('Hello, world 2026') === 'latin' && scriptOf('') === 'latin' && scriptOf('Ünïcödé — ok') === 'latin');
ok('Arabic and Kurdish words are arabic', scriptOf('مرحبا') === 'arabic' && scriptOf('سڵاو') === 'arabic' && scriptOf('کوردیا بادینی') === 'arabic');
ok('one Arabic-script word in a Latin line is enough', scriptOf('Welcome to هەولێر') === 'arabic');
ok('Arabic-Indic digits alone need the Arabic face', scriptOf('١٢٣') === 'arabic');
ok('every Arabic block counts: supplement, extended-A, both presentation forms',
  [0x0750, 0x077f, 0x08a0, 0x08ff, 0xfb50, 0xfdff, 0xfe70, 0xfefc].every((c) => scriptOf(`a${ch(c)}`) === 'arabic'));
ok('a byte-order mark is not a letter: a pasted Latin title stays Latin', scriptOf(`${ch(0xfeff)}Title`) === 'latin');
ok('not a string is latin, not a crash', scriptOf(undefined) === 'latin' && scriptOf(42) === 'latin');

// ── stacks ────────────────────────────────────────────────────────────────
console.log('stacks');
const VOICES = ['sans', 'bold', 'serif', 'round', 'mono', 'condensed'];
const LATIN = {
  sans: 'system-ui,"Helvetica Neue","Segoe UI",sans-serif',
  bold: '"Avenir Next","Avenir Next Condensed","Helvetica Neue","Segoe UI Black","Arial Black",sans-serif',
  serif: 'ui-serif,"New York","Iowan Old Style","Georgia","Times New Roman",serif',
  round: 'ui-rounded,"SF Pro Rounded","Arial Rounded MT Bold","Segoe UI",system-ui,sans-serif',
  mono: 'ui-monospace,"SF Mono","Menlo","Consolas","Courier New",monospace',
  condensed: '"Impact","Haettenschweiler","Arial Narrow Bold","Avenir Next Condensed","Arial Narrow",sans-serif',
};
ok('each voice\'s Latin stack is the one designed for it', VOICES.every((v) => fontStack(v, 'latin') === LATIN[v]), VOICES.map((v) => fontStack(v, 'latin')));
ok('the first family is the voice\'s own', fontStack('sans', 'latin').startsWith('system-ui') && fontStack('bold', 'latin').startsWith('"Avenir Next"')
  && fontStack('serif', 'latin').startsWith('ui-serif') && fontStack('round', 'latin').startsWith('ui-rounded')
  && fontStack('mono', 'latin').startsWith('ui-monospace') && fontStack('condensed', 'latin').startsWith('"Impact"'));
ok('no stack names a family Video may have loaded from Google Fonts, so a frame does not depend on it', VOICES.every((v) => !/Inter|Nunito/.test(fontStack(v, 'latin')) && !/Inter|Nunito/.test(fontStack(v, 'arabic'))));
ok('the bundled face is Vylo Arabic', ARABIC_FACE === 'Vylo Arabic');
ok('every Arabic stack leads with the bundled face, then the system\'s Arabic faces',
  VOICES.every((v) => fontStack(v, 'arabic').startsWith('"Vylo Arabic","Geeza Pro","Segoe UI","Tahoma",')));
ok('and ends with the voice\'s generic family', fontStack('serif', 'arabic').endsWith(',serif') && fontStack('mono', 'arabic').endsWith(',monospace')
  && ['sans', 'bold', 'round', 'condensed'].every((v) => fontStack(v, 'arabic').endsWith(',sans-serif')));
ok('every stack ends with a generic family, so something always draws', VOICES.every((v) => /,(sans-serif|serif|monospace)$/.test(fontStack(v, 'latin'))));
ok('an unknown voice is set as sans, not in the browser\'s default serif', fontStack('comic', 'latin') === LATIN.sans && fontStack('constructor', 'latin') === LATIN.sans
  && fontStack('comic', 'arabic').endsWith(',sans-serif'));

// ── ctx.font ──────────────────────────────────────────────────────────────
console.log('ctx.font');
ok('weight, size in px, then the stack', fontString('sans', 700, 32, 'latin') === `700 32px ${LATIN.sans}`);
ok('the size is rounded to hundredths', fontString('sans', 400, 12.3456, 'latin').startsWith('400 12.35px ') && fontString('sans', 400, 10.8, 'latin').startsWith('400 10.8px '));
ok('Latin weights are held in 100..900', fontString('bold', 950, 10, 'latin').startsWith('900 ') && fontString('bold', 50, 10, 'latin').startsWith('100 '));
ok('the Arabic face is only asked for the 400..700 it has', fontString('bold', 900, 10, 'arabic').startsWith('700 ') && fontString('sans', 100, 10, 'arabic').startsWith('400 ')
  && fontString('sans', 600, 10, 'arabic').startsWith('600 '));
ok('a weight is a whole number, and a number', fontString('sans', 650.4, 10, 'latin').startsWith('650 ') && fontString('sans', NaN, 10, 'latin').startsWith('400 ')
  && fontString('sans', NaN, 10, 'arabic').startsWith('400 '));
ok('a size that is not one is 0px, never "NaNpx" (which the canvas would ignore without a word)',
  fontString('sans', 400, NaN, 'latin').startsWith('400 0px ') && fontString('sans', 400, -5, 'latin').startsWith('400 0px ')
  && fontString('sans', 400, Infinity, 'latin').startsWith('400 0px ') && fontString('sans', 400, 1e300, 'latin').startsWith('400 100000px '));
ok('every font string has the shape the canvas parses', VOICES.every((v) => ['latin', 'arabic'].every((s) =>
  [0, 0.5, 13.37, 800].every((px) => /^[1-9]00 \d+(?:\.\d{1,2})?px (?:"[^"]+"|[a-z-]+)(?:,(?:"[^"]+"|[a-z-]+))+$/.test(fontString(v, 700, px, s))))));

// ── digits ────────────────────────────────────────────────────────────────
console.log('digits');
ok('English numbers in Western digits; Arabic and both Kurdish languages in Arabic-Indic',
  digitsFor('en') === 'latn' && digitsFor('ar') === 'arab' && digitsFor('ckb') === 'arab' && digitsFor('kmr') === 'arab' && digitsFor('xx') === 'latn');
ok('0-9 become U+0660..U+0669, and nothing else changes', toArabicDigits('0123456789') === '٠١٢٣٤٥٦٧٨٩'
  && cps(toArabicDigits('09')) === '0660 0669' && toArabicDigits('1.5, x-2') === '١.٥, x-٢');

const f = (n, decimals, group = true, lang = 'en') => formatNumber(n, { decimals, group, lang });
ok('the example: 1234567.891 to two places', f(1234567.891, 2) === '1,234,567.89', f(1234567.891, 2));
ok('and in Arabic: Arabic-Indic digits, ٬ between thousands, ٫ for the point', f(1234567.891, 2, true, 'ar') === '١٬٢٣٤٬٥٦٧٫٨٩'
  && cps(f(1234567.891, 2, true, 'ar')) === '0661 066c 0662 0663 0664 066c 0665 0666 0667 066b 0668 0669', cps(f(1234567.891, 2, true, 'ar')));
ok('Sorani and Badini write it the same way', f(1234567.891, 2, true, 'ckb') === '١٬٢٣٤٬٥٦٧٫٨٩' && f(1234567.891, 2, true, 'kmr') === '١٬٢٣٤٬٥٦٧٫٨٩');
ok('grouping off is no separators at all', f(1234567.891, 2, false) === '1234567.89' && f(1234567.891, 2, false, 'ar') === '١٢٣٤٥٦٧٫٨٩');
ok('groups of three from the right, whatever the length', f(0, 0) === '0' && f(7, 0) === '7' && f(999, 0) === '999' && f(1000, 0) === '1,000'
  && f(12345, 0) === '12,345' && f(123456, 0) === '123,456' && f(1234567, 0) === '1,234,567');
ok('0 to 3 places', f(3.14159, 0) === '3' && f(3.14159, 1) === '3.1' && f(3.14159, 2) === '3.14' && f(3.14159, 3) === '3.142');
ok('places held in 0..3, whole', f(3.14159, 7) === '3.142' && f(3.14159, -1) === '3' && f(3.14159, NaN) === '3' && f(3.14159, 1.6) === '3.14');
ok('rounding carries into the grouping', f(999.999, 2) === '1,000.00' && f(0.5, 0) === '1' && f(2.5, 0) === '3');
ok('a minus sign is kept', f(-1234.5, 1) === '-1,234.5' && f(-1234.5, 1, true, 'ar') === '-١٬٢٣٤٫٥' && f(-3, 0) === '-3');
ok('-0, and a negative that shows as zero, have no sign', f(-0, 0) === '0' && f(-0.001, 2) === '0.00' && f(-0.004, 2, true, 'ar') === '٠٫٠٠');
ok('what is not a number is 0', f(NaN, 2) === '0' && f(Infinity, 0) === '0' && f(-Infinity, 0) === '0' && f(NaN, 0, true, 'ar') === '٠');
ok('large numbers in full, never in exponent notation', f(123456789012, 0) === '123,456,789,012' && f(Number.MAX_SAFE_INTEGER, 0) === '9,007,199,254,740,991'
  && f(1e21, 0) === '1,000,000,000,000,000,000,000' && f(1e21, 2) === '1,000,000,000,000,000,000,000.00' && f(-1e21, 0) === '-1,000,000,000,000,000,000,000');
{
  const huge = f(1e300, 1);
  ok('even 1e300: every digit, grouped', !/e/i.test(huge) && huge.startsWith('1,000,000,000,000,000,052,504') && huge.endsWith('.0') && huge.replace(/[^0-9]/g, '').length === 302, huge.slice(0, 40));
}
ok('the same call gives the same string every time', f(98765.4321, 3, true, 'ckb') === f(98765.4321, 3, true, 'ckb') && f(98765.4321, 3, true, 'ckb') === '٩٨٬٧٦٥٫٤٣٢');

// ── fonts a document needs ────────────────────────────────────────────────
console.log('fonts needed');
const text = (o) => ({ kind: 'text', voice: 'sans', weight: 700, text: 'Hello', ...o });
const doc = (layers, lang = 'en') => ({ lang, layers });
{
  const need = fontsNeeded(doc([
    text(), text(), text({ voice: 'bold', weight: 800, text: 'سڵاو' }), text({ voice: 'serif', weight: 400, text: 'Quote' }),
    { kind: 'counter', voice: 'sans', weight: 800, prefix: '$', suffix: '' },
    { kind: 'chart', voice: 'mono', unit: '%', data: [{ label: 'Q1', value: 1 }] },
    { kind: 'shape' }, { kind: 'icon' }, { kind: 'image' }, { kind: 'backdrop' }, { kind: 'particles' },
  ]));
  ok('one font for each voice, weight and script used by words, and no more', need.length === 5, need);
  ok('in the order the layers use them, at 32px', need[0] === fontString('sans', 700, 32, 'latin') && need[1] === fontString('bold', 800, 32, 'arabic')
    && need[2] === fontString('serif', 400, 32, 'latin') && need[3] === fontString('sans', 800, 32, 'latin') && need.every((x) => / 32px /.test(x)), need);
  ok('Arabic words ask the Arabic face for a weight it has', need[1].startsWith('700 32px "Vylo Arabic"'));
  const ar = fontsNeeded(doc([{ kind: 'counter', voice: 'bold', weight: 900, prefix: '', suffix: '' }, { kind: 'chart', voice: 'sans', unit: '', data: [] }], 'ckb'));
  ok('in Kurdish a counter and a chart need the Arabic face for their digits alone', ar.length === 2 && ar.every((x) => x.includes('"Vylo Arabic"')), ar);
  ok('an Arabic unit or label is enough in an English graphic', fontsNeeded(doc([{ kind: 'chart', voice: 'sans', unit: 'کم', data: [] }]))[0].includes('"Vylo Arabic"'));
  ok('a graphic with no words needs no fonts', fontsNeeded(doc([{ kind: 'shape' }, { kind: 'backdrop' }])).length === 0 && fontsNeeded(doc([])).length === 0);
}

// ── loading ───────────────────────────────────────────────────────────────
console.log('loading');
{
  const m = doc([text(), text({ text: 'سڵاو', weight: 500 })]);
  const t0 = performance.now();
  await ensureFonts(m);
  ok('with no document (Node) it resolves at once', performance.now() - t0 < 50);

  const calls = [];
  globalThis.document = { fonts: { load: (font, sample) => { calls.push([font, sample]); return Promise.resolve([]); } } };
  await ensureFonts(m);
  ok('every font needed is loaded', calls.length === 2 && calls[0][0] === fontsNeeded(m)[0] && calls[1][0] === fontsNeeded(m)[1], calls);
  ok('with a sample in its own script — the Arabic face is only fetched for Arabic text', calls[0][1] === 'Aa0' && scriptOf(calls[1][1]) === 'arabic'
    && /[ڕڵێۆە]/.test(calls[1][1]) && /[٠-٩]/.test(calls[1][1]), calls.map((c) => c[1]));

  globalThis.document = { fonts: { load: () => Promise.reject(new Error('404')) } };
  ok('a load that fails still resolves', (await ensureFonts(m).then(() => 'resolved', () => 'rejected')) === 'resolved');
  globalThis.document = { fonts: { load: () => { throw new SyntaxError('bad font'); } } };
  ok('a load that throws still resolves', (await ensureFonts(m).then(() => 'resolved', () => 'rejected')) === 'resolved');
  globalThis.document = { fonts: {} };
  ok('no load function is nothing to wait for', (await ensureFonts(m).then(() => 'resolved', () => 'rejected')) === 'resolved');
  globalThis.document = { get fonts() { throw new Error('denied'); } };
  ok('a document.fonts that throws is none', (await ensureFonts(m).then(() => 'resolved', () => 'rejected')) === 'resolved');
  globalThis.document = { fonts: { load: () => new Promise(() => {}) } };
  const t1 = performance.now();
  await ensureFonts(m, 40);
  const waited = performance.now() - t1;
  ok(`a face that never arrives is given up on at the cap (${waited.toFixed(0)} ms of 40)`, waited >= 35 && waited < 400, waited);
  let loads = 0;
  globalThis.document = { fonts: { load: () => { loads++; return Promise.resolve([]); } } };
  const t2 = performance.now();
  await ensureFonts(doc([{ kind: 'shape' }]));
  ok('a graphic with no words resolves without loading anything', loads === 0 && performance.now() - t2 < 50);
  ok('a document that is not one resolves too', (await ensureFonts(null).then(() => 'resolved', () => 'rejected')) === 'resolved');
  delete globalThis.document;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
