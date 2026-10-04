// The ready messages, found and filled (docs/wa/templates.md): `searchTemplates`, `foldForSearch` and
// `fillTemplate`, held to what a person typing on whatever keyboard they have expects.
//
// What matters, in order:
//
//   1. A word is found however it was typed. Arabic with or without harakat, with أ or ا, ي or ی, ك or ک,
//      ة or ه; Sorani and Badini typed on an Arabic keyboard (ر for ڕ, ه for ە, و for ۆ, ی for ێ, ل for ڵ,
//      ف for ڤ) or pasted with ZWNJ and direction marks; numbers in any of three digit sets. But ئ stays
//      itself: it is a letter of its own in Kurdish, and NFD would quietly merge it with ی.
//   2. What says it in its title comes first. Within one search, every message whose title holds the word is
//      listed before any message that only says it in its text.
//   3. Filling leaves the person's own blank alone. `{name}` survives for the engine, a blank the sender left
//      empty stays visible, and a value is put in as typed — `$&` is not a replacement pattern here.
//   4. Nothing a screen can hand it makes it throw: fuzzed queries, languages, filters and values, and a
//      thousand searches well inside a frame budget.
//
// The searches that name messages by id use the first half (`whatsapptemplates-a.ts`); the rules about order,
// filters and junk hold over the whole library, whatever `templates-b` adds.
import {
  CATEGORIES, TEMPLATES, searchTemplates, fillTemplate, foldForSearch, templateById, blanksOf,
} from '../.test-build/whatsapptemplates.js';
import { TEMPLATES_A } from '../.test-build/whatsapptemplates-a.js';

const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const info = (s) => console.log(`  info  ${s}`);
const ids = (xs) => xs.map((t) => t.id);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const has = (xs, ...want) => want.every((w) => xs.some((t) => t.id === w));
const throwsNot = (f) => { try { f(); return true; } catch { return false; } };

// ── folding ────────────────────────────────────────────────────────────────

const f = foldForSearch;
ok('fold: harakat and shadda go', f('تَخْفِيضَات') === f('تخفيضات') && f('تسوّقوا') === f('تسوقوا'));
ok('fold: أ إ آ ٱ are ا', ['أ', 'إ', 'آ', 'ٱ'].every((c) => f(c) === f('ا')));
ok('fold: an alef with a hamza typed after it is the same alef', f('ا\u0654') === f('أ'));
ok('fold: ي ى ی and Kurdish ێ are one letter', ['ي', 'ى', 'ێ'].every((c) => f(c) === f('ی')));
ok('fold: ك is ک', f('كود') === f('کود'));
ok('fold: ة ە ھ are ه', ['ة', 'ە', 'ھ'].every((c) => f(c) === f('ه')));
ok('fold: Kurdish ڕ ڵ ۆ ڤ are the letters an Arabic keyboard types for them', f('ڕ') === f('ر') && f('ڵ') === f('ل') && f('ۆ') === f('و') && f('ڤ') === f('ف'));
ok('fold: ؤ is و', f('ؤ') === f('و'));
ok('fold: ئ stays itself, not ی', f('ئ') !== f('ی') && f('ئەم') !== f('یەم'));
ok('fold: a yeh with a hamza typed after it is ئ', f('ي\u0654') === f('ئ'));
ok('fold: tatweel, ZWNJ and direction marks go', f('جه\u200Cژن') === f('جەژن') && f('عـيـد') === f('عید') && f('\u200Fنەورۆز\u202C') === f('نەورۆز'));
ok('fold: Arabic-Indic and Persian digits are 0–9', f('٣٤') === '34' && f('۵۶') === '56');
ok('fold: Latin accents and capitals go', f('Café NEWROZ') === 'cafe newroz');
ok('fold: anything not text folds to nothing', [null, undefined, {}, [], () => 1, Symbol('x'), NaN, Infinity].every((x) => f(x) === ''));
ok('fold: a finite number is its digits', f(42) === '42');
ok('fold: a megabyte is read only as far as the limit', f('a'.repeat(1_000_000)).length <= 4000);
ok('fold: a lone surrogate does not throw', throwsNot(() => f('\uD800 x \uDC00')));
ok('fold: an object with a toString that throws is not called', throwsNot(() => f({ toString() { throw new Error('no'); } })));

// ── search: the plain cases ────────────────────────────────────────────────

const all = searchTemplates('', 'en');
const rank = new Map(CATEGORIES.map((c, i) => [c.id, i]));
ok('an empty search lists every message', all.length === TEMPLATES.length);
ok('an empty search lists them in category order', all.every((t, i) => i === 0 || rank.get(all[i - 1].category) <= rank.get(t.category)));
ok('within a category, an empty search keeps the library order', CATEGORIES.every((c) => {
  const got = ids(all.filter((t) => t.category === c.id));
  return sameList(got, ids(TEMPLATES.filter((t) => t.category === c.id)));
}));
ok('a search of spaces and punctuation is an empty search', sameList(ids(searchTemplates('  !!! ؟، ', 'ar')), ids(searchTemplates('', 'ar'))));
ok('no message is listed twice', [...['', 'eid', 'a', 'جەژن'].map((q) => searchTemplates(q, 'ckb'))].every((r) => new Set(ids(r)).size === r.length));
ok('the category filter keeps only that category', searchTemplates('', 'en', { category: 'holiday' }).every((t) => t.category === 'holiday')
  && searchTemplates('', 'en', { category: 'holiday' }).length === TEMPLATES.filter((t) => t.category === 'holiday').length);
ok('the kind filter keeps only that kind', searchTemplates('', 'en', { kind: 'service' }).every((t) => t.kind === 'service')
  && searchTemplates('', 'en', { kind: 'service' }).length === TEMPLATES.filter((t) => t.kind === 'service').length);
ok('both filters together', searchTemplates('', 'en', { category: 'appointment', kind: 'promo' }).every((t) => t.category === 'appointment' && t.kind === 'promo')
  && has(searchTemplates('', 'en', { category: 'appointment', kind: 'promo' }), 'appointment-3'));
ok('a filter with a word', ids(searchTemplates('eid', 'en', { category: 'holiday' })).every((id) => id.startsWith('holiday-')) && has(searchTemplates('eid', 'en', { category: 'holiday' }), 'holiday-1', 'holiday-2'));
ok('a category that does not exist lists nothing', searchTemplates('', 'en', { category: 'nope' }).length === 0);
ok('a filter that is not a string is no filter', searchTemplates('', 'en', { category: 7, kind: {} }).length === TEMPLATES.length);
ok('an unknown language searches as English', sameList(ids(searchTemplates('eid', 'xx')), ids(searchTemplates('eid', 'en'))));

// ── search: English ────────────────────────────────────────────────────────

const eid = searchTemplates('eid', 'en');
ok('"eid" finds the Eid offers and both Eid greetings', has(eid, 'sale-4', 'holiday-1', 'holiday-2'));
ok('"Eid" in capitals finds the same', sameList(ids(searchTemplates('EID', 'en')), ids(eid)));
ok('"eid sale" needs both words: the Eid offers, not the greeting', has(searchTemplates('eid sale', 'en'), 'sale-4') && !has(searchTemplates('eid sale', 'en'), 'holiday-1'));
ok('when no message has every word, the ones with most of them are shown', has(searchTemplates('eid qqqzzz', 'en'), 'holiday-1'));
ok('a word nothing has finds nothing', searchTemplates('qqqzzz', 'en').length === 0);
ok('a plural finds the singular ("reminders" finds the reminder)', has(searchTemplates('reminders', 'en'), 'appointment-1'));
ok('a tag is searchable in English ("restaurant")', has(searchTemplates('restaurant', 'en'), 'code-2', 'opening-1'));
ok('a category title is searchable ("loyalty")', has(searchTemplates('loyalty', 'en'), 'loyalty-1', 'loyalty-2', 'loyalty-3'));
ok('a placeholder\'s name is not a word of the text ("business" finds no first-half message)',
  !searchTemplates('business', 'en').some((t) => TEMPLATES_A.includes(t)));
ok('"appointment reminder" puts the reminder first', searchTemplates('appointment reminder', 'en')[0]?.id === 'appointment-1');
ok('"newroz" puts Newroz first', searchTemplates('newroz', 'en')[0]?.id === 'holiday-4');

// ── search: Arabic ─────────────────────────────────────────────────────────

ok('Arabic: "تخفيضات" finds the season sale', has(searchTemplates('تخفيضات', 'ar'), 'sale-1'));
ok('Arabic: with harakat it finds the same list', sameList(ids(searchTemplates('تَخْفِيضَات', 'ar')), ids(searchTemplates('تخفيضات', 'ar'))));
ok('Arabic: "كود" with either kaf finds the same list, codes included', sameList(ids(searchTemplates('كود', 'ar')), ids(searchTemplates('کود', 'ar'))) && has(searchTemplates('كود', 'ar'), 'code-1'));
ok('Arabic: "هديه" without its ta marbuta finds the birthday gift', has(searchTemplates('هديه', 'ar'), 'birthday-1'));
ok('Arabic: "اعياد" without its hamza finds the holidays', has(searchTemplates('اعياد', 'ar'), 'holiday-1', 'holiday-6'));
ok('Arabic: "العيد" with its article finds Eid al-Fitr', has(searchTemplates('العيد', 'ar'), 'holiday-1'));
ok('Arabic: "عيد الفطر" puts Eid al-Fitr first', searchTemplates('عيد الفطر', 'ar')[0]?.id === 'holiday-1');
ok('Arabic: a tag in Arabic ("مطعم") finds restaurant messages', has(searchTemplates('مطعم', 'ar'), 'code-2', 'opening-1'));
ok('Arabic: English still works in the Arabic list', has(searchTemplates('newroz', 'ar'), 'holiday-4'));
ok('Arabic: "موعد" finds the appointments', has(searchTemplates('موعد', 'ar'), 'appointment-1', 'appointment-2'));

// ── search: Sorani ─────────────────────────────────────────────────────────

const dashkandin = searchTemplates('داشکاندن', 'ckb');
ok('Sorani: "داشکاندن" finds the sales', has(dashkandin, 'sale-1', 'code-1'));
ok('Sorani: typed with the Arabic kaf it finds the same list', sameList(ids(searchTemplates('داشكاندن', 'ckb')), ids(dashkandin)));
ok('Sorani: "نەورۆز" finds Newroz first', searchTemplates('نەورۆز', 'ckb')[0]?.id === 'holiday-4');
ok('Sorani: typed "نهوروز" on an Arabic keyboard it finds the same list', sameList(ids(searchTemplates('نهوروز', 'ckb')), ids(searchTemplates('نەورۆز', 'ckb'))));
ok('Sorani: "ڕۆژی لەدایکبوون" and "روژی لهدایکبوون" find the birthdays alike',
  has(searchTemplates('ڕۆژی لەدایکبوون', 'ckb'), 'birthday-1', 'birthday-2') && sameList(ids(searchTemplates('روژی لهدایکبوون', 'ckb')), ids(searchTemplates('ڕۆژی لەدایکبوون', 'ckb'))));
ok('Sorani: "جه‌ژن" with a ZWNJ finds the Eid greetings', has(searchTemplates('جه\u200Cژن', 'ckb'), 'holiday-1', 'holiday-2'));
ok('Sorani: "هەڵسەنگاندن" typed with ل finds the reviews', has(searchTemplates('هەلسەنگاندن', 'ckb'), 'review-1'));
ok('Sorani: a tag in Sorani ("چێشتخانە") finds restaurant messages', has(searchTemplates('چێشتخانە', 'ckb'), 'code-2'));

// ── search: Badini ─────────────────────────────────────────────────────────

ok('Badini: "ڤەکرن" finds the openings', has(searchTemplates('ڤەکرن', 'kmr'), 'opening-1'));
ok('Badini: typed "فەکرن" with ف it finds the same list', sameList(ids(searchTemplates('فەکرن', 'kmr')), ids(searchTemplates('ڤەکرن', 'kmr'))));
ok('Badini: "سالا نوی" puts the New Year first', searchTemplates('سالا نوی', 'kmr')[0]?.id === 'holiday-5');
ok('Badini: "ژڤان" finds the appointments', has(searchTemplates('ژڤان', 'kmr'), 'appointment-1', 'appointment-2', 'appointment-4'));
ok('Badini: "جه ژنا" split by a space still finds Eid through both words', has(searchTemplates('جەژنا قوربانێ', 'kmr'), 'holiday-2'));

// ── search: title before text ──────────────────────────────────────────────

/** Whether a message's title, in the language or in English, holds the folded word. */
const titleHas = (t, lang, w) => f(t.title[lang]).includes(w) || f(t.title.en).includes(w);
const QUERIES = [
  ['thank', 'en'], ['eid', 'en'], ['birthday', 'en'], ['offer', 'en'], ['new', 'en'], ['day', 'en'], ['code', 'en'],
  ['عيد', 'ar'], ['عرض', 'ar'], ['موعد', 'ar'], ['شكر', 'ar'], ['جديد', 'ar'],
  ['ئۆفەر', 'ckb'], ['سوپاس', 'ckb'], ['ژوان', 'ckb'], ['نوێ', 'ckb'], ['جەژن', 'ckb'],
  ['ئۆفەر', 'kmr'], ['سوپاس', 'kmr'], ['ژڤان', 'kmr'], ['نوی', 'kmr'], ['جەژن', 'kmr'],
];
for (const [q, lang] of QUERIES) {
  const r = searchTemplates(q, lang);
  const w = f(q);
  const flags = r.map((t) => titleHas(t, lang, w));
  const firstText = flags.indexOf(false);
  ok(`"${q}" (${lang}): every title hit comes before every text hit`, r.length > 0 && (firstText < 0 || !flags.slice(firstText).includes(true)),
    r.map((t, i) => `${t.id}${flags[i] ? '*' : ''}`).join(' '));
}
ok('ties keep the library order (the four Eid greetings and offers of one weight stay in order)', (() => {
  const r = searchTemplates('eid', 'en', { category: 'holiday' });
  return sameList(ids(r), ids(TEMPLATES.filter((t) => r.includes(t))));
})());

// ── filling ────────────────────────────────────────────────────────────────

const sale1 = templateById('sale-1');
const values = { business: 'Nali Fashion', discount: '30%', product: 'winter coats', date: 'Friday', link: 'nali.example/sale' };
for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
  const out = fillTemplate(sale1, lang, values);
  ok(`fill (${lang}): every blank given is filled, {name} is left for the engine`,
    out.includes('Nali Fashion') && out.includes('30%') && out.includes('{name}') && !/\{(business|discount|product|date|link)\}/.test(out));
}
ok('fill: {name} is filled when the sender names it', !fillTemplate(sale1, 'en', { name: 'Avin' }).includes('{name}') && fillTemplate(sale1, 'en', { name: 'Avin' }).includes('Avin'));
ok('fill: a blank left empty stays visible', fillTemplate(sale1, 'en', { business: '   ', discount: '' }).includes('{business}') && fillTemplate(sale1, 'en', { discount: '' }).includes('{discount}'));
ok('fill: a value that is not a string is not a value', fillTemplate(sale1, 'en', { business: 42, discount: null, product: { x: 1 } }).includes('{business}'));
ok('fill: $& and $1 go in as typed', fillTemplate(sale1, 'en', { discount: '$& and $1', business: "$'" }).includes('*$& and $1*') && fillTemplate(sale1, 'en', { business: "$'" }).includes("at $':"));
ok('fill: a value saying {name} is put in, not filled again', fillTemplate(sale1, 'en', { business: '{name} & Co', name: 'X' }).includes('{name} & Co'));
ok('fill: a value is trimmed and loses control characters, keeps its line breaks',
  fillTemplate(sale1, 'en', { business: '  A\u0000B\u0007\nC  ' }).includes('at AB\nC:'));
ok('fill: a value longer than a whole message is cut to one', fillTemplate(sale1, 'en', { business: 'x'.repeat(100_000) }).length < 4_500);
ok('fill: only the values\' own keys count (no {constructor} from the prototype)',
  fillTemplate({ text: { en: '{constructor} {toString} {hasOwnProperty}' } }, 'en', {}) === '{constructor} {toString} {hasOwnProperty}');
ok('fill: an unknown language is English', fillTemplate(sale1, 'xx', {}) === sale1.text.en);
ok('fill: a language the template lacks falls back to English', fillTemplate({ text: { en: 'Hi {offer}', ar: '' } }, 'ar', { offer: 'o' }) === 'Hi o');
ok('fill: not a template gives an empty text', [null, undefined, 5, 'x', {}, { text: null }].every((t) => fillTemplate(t, 'en', {}) === ''));
ok('fill: values that are not an object fill nothing', fillTemplate(sale1, 'en', null) === sale1.text.en && fillTemplate(sale1, 'en', 'business') === sale1.text.en);
ok('fill: the engine\'s {name|fallback} is left whole', fillTemplate({ text: { en: 'Hi {name|friend}, {offer}' } }, 'en', { name: 'A', offer: 'B' }) === 'Hi {name|friend}, B');
ok('fill: the template itself is unchanged', (() => { const before = sale1.text.en; fillTemplate(sale1, 'en', values); return sale1.text.en === before; })());

// Every message, in every language, with every blank the form asks for: only the engine's {name} is left.
{
  const left = [];
  for (const t of TEMPLATES_A) {
    const v = Object.fromEntries(blanksOf(t).map((k) => [k, `«${k}»`]));
    for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
      const out = fillTemplate(t, lang, v);
      const rest = [...out.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((k) => k !== 'name');
      if (rest.length > 0 || out.length > 1000) left.push(`${t.id}.${lang}`);
    }
  }
  ok('filling every blank of every first-half message leaves only {name}', left.length === 0, left.join(', '));
}

// ── fuzz ───────────────────────────────────────────────────────────────────

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(20261004);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const ALPHABET = [
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZéüİß ',
  ...'ابتثجحخدذرزسشصضطظعغفقكلمنهوي ءأإآؤئةى',
  ...'ڕڵۆێەڤگپچژکیھ',
  '\u064B', '\u064E', '\u0651', '\u0652', '\u0654', '\u0670', '\u0640', '\u200C', '\u200D', '\u200F', '\u202E', '\u2066', '\uFEFF',
  ...'0123456789٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
  '🎉', '🌙', '👍🏽', '🏳️‍🌈', '\uD800', '\uDFFF',
  ...'{}[]()*+?.^$|\\/-_،؟!:;\'"`~%&#@\n\t',
];
const fuzzString = (n) => Array.from({ length: n }, () => pick(ALPHABET)).join('');
const JUNK = [null, undefined, 0, -1, NaN, {}, [], true, () => 'x', Symbol('s'), new Date(0), Object.create(null)];
const LANGS_FUZZ = ['en', 'ar', 'ckb', 'kmr', 'xx', '', null, undefined, 7];
const CATS_FUZZ = [undefined, ...CATEGORIES.map((c) => c.id), 'nope', 3, null];
const KINDS_FUZZ = [undefined, 'promo', 'service', 'greeting', 'other', {}];
{
  let threw = 0, badShape = 0, badFilter = 0, dup = 0;
  const library = new Set(TEMPLATES);
  for (let i = 0; i < 2000; i++) {
    const q = rnd() < 0.1 ? pick(JUNK) : fuzzString(Math.floor(rnd() * 24));
    const lang = pick(LANGS_FUZZ);
    const o = rnd() < 0.05 ? pick(JUNK) : { category: pick(CATS_FUZZ), kind: pick(KINDS_FUZZ) };
    try {
      const r = searchTemplates(q, lang, o);
      if (!Array.isArray(r) || !r.every((t) => library.has(t))) badShape++;
      if (new Set(r).size !== r.length) dup++;
      if (o && typeof o === 'object' && typeof o.category === 'string' && !r.every((t) => t.category === o.category)) badFilter++;
      if (o && typeof o === 'object' && typeof o.kind === 'string' && !r.every((t) => t.kind === o.kind)) badFilter++;
    } catch { threw++; }
  }
  ok('fuzz: two thousand searches, none throws', threw === 0, threw);
  ok('fuzz: every result is a list of library messages', badShape === 0, badShape);
  ok('fuzz: no result lists a message twice', dup === 0, dup);
  ok('fuzz: a string filter always holds', badFilter === 0, badFilter);
}
{
  let threw = 0, notString = 0, notIdempotent = 0;
  for (let i = 0; i < 2000; i++) {
    const s = fuzzString(Math.floor(rnd() * 40));
    try {
      const once = foldForSearch(s);
      if (typeof once !== 'string') notString++;
      if (foldForSearch(once) !== once) notIdempotent++;
    } catch { threw++; }
  }
  ok('fuzz: folding two thousand strings never throws and always gives text', threw === 0 && notString === 0, { threw, notString });
  ok('fuzz: folding twice is folding once', notIdempotent === 0, notIdempotent);
}
{
  let threw = 0, notString = 0, lost = 0;
  const keys = ['name', 'business', 'offer', 'date', 'code', 'link', 'constructor', '__proto__', ''];
  for (let i = 0; i < 1000; i++) {
    const t = rnd() < 0.05 ? pick(JUNK) : pick(TEMPLATES);
    const lang = pick(LANGS_FUZZ);
    const v = rnd() < 0.1 ? pick(JUNK) : Object.fromEntries(keys.filter(() => rnd() < 0.4).map((k) => [k, rnd() < 0.2 ? pick(JUNK) : fuzzString(Math.floor(rnd() * 30))]));
    try {
      const out = fillTemplate(t, lang, v);
      if (typeof out !== 'string') notString++;
      // A placeholder the values do not name is never lost.
      if (t && t.text && v && typeof v === 'object' && !Object.prototype.hasOwnProperty.call(v, 'name') && t.vars?.includes('name') && !out.includes('{name}')) lost++;
    } catch { threw++; }
  }
  ok('fuzz: a thousand fills with junk values never throw and always give text', threw === 0 && notString === 0, { threw, notString });
  ok('fuzz: {name} survives every fill that did not name it', lost === 0, lost);
}

// ── speed ──────────────────────────────────────────────────────────────────

{
  const words = ['eid', 'sale', 'تخفيضات', 'جەژن', 'ژڤان', 'code', 'نوی', 'birthday', 'عرض', 'a', 'ئۆفەر', 'new year'];
  const langs = ['en', 'ar', 'ckb', 'kmr'];
  for (const l of langs) searchTemplates('x', l); // build each language's index once
  const t0 = performance.now();
  for (let i = 0; i < 1000; i++) searchTemplates(words[i % words.length], langs[i % 4]);
  const ms = performance.now() - t0;
  info(`1000 searches: ${ms.toFixed(1)} ms`);
  ok('a thousand searches take under 600 ms (one keystroke well inside a frame)', ms < 600 * SLOW, ms.toFixed(1));
  const t1 = performance.now();
  searchTemplates('ا'.repeat(100_000), 'ar');
  const ms1 = performance.now() - t1;
  ok('a pasted 100,000-character query is answered in under 50 ms', ms1 < 50 * SLOW, ms1.toFixed(1));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
