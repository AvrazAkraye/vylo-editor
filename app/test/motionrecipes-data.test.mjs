// The data templates (motionrecipes-data.ts): a big number in a ring, a bar
// chart, a donut, a line chart and three figures.
//
// What matters: the numbers people type are read as they meant them — every
// separator and digit system the four languages use, a line with no number
// skipped, never NaN, never nothing — and every recipe, in every language and
// every shape of frame, at its own length and at 2 and 30 seconds, with the
// shortest and the longest words and with awkward data (one item, the most
// items, zeros, a billion, negatives), builds layers the reader leaves exactly
// as they are, with ids that are unique and the same in every shape, that
// arrive before they leave, that draw nothing a browser would reject at any
// moment, and that show something at the moment the gallery draws them.
//
//   npx esbuild src/motionrecipes-data.ts src/motiontemplates.ts src/motionrecipe.ts src/motionread.ts src/motionanim.ts src/motiondraw.ts --bundle --format=esm --outdir=.test-build --log-level=error && node test/motionrecipes-data.test.mjs
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { DATA_RECIPES, iconFor, itemsOf, numberOf } from '../.test-build/motionrecipes-data.js';
import { buildMotion, resolveFields } from '../.test-build/motiontemplates.js';
import { META, makeKit, paletteOf } from '../.test-build/motionrecipe.js';
import { readLayer } from '../.test-build/motionread.js';
import { countAt, inDone, outStart, poseAt, stillTime, unitsOf } from '../.test-build/motionanim.js';
import { layerBox, makeEnv, paint } from '../.test-build/motiondraw.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' \u2014 ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const IDS = ['big-number', 'bar-chart', 'donut', 'line-chart', 'stats'];
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const ARABIC_DIGIT = /[\u0660-\u0669\u06F0-\u06F9]/;

/** JSON with every object's keys sorted: two layers are the same when this is. */
const canon = (x) => JSON.stringify(x, (_, v) => (v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v));

/** What a recipe builds, before the document reader has seen it. */
function built(id, lang, format, fields, seconds) {
  const meta = META[id];
  const resolved = resolveFields(id, fields, lang);
  const kit = makeKit({ recipe: id, lang, format, palette: paletteOf(meta.palette).colors, seconds: seconds ?? meta.seconds, fields: resolved });
  return DATA_RECIPES[id].build(kit);
}
const docOf = (id, lang, format, fields, seconds) => buildMotion({ id: 't', recipe: id, lang, format, fields, seconds, now: 0 });

/** Paint a document at `t` on a fresh recording canvas of its size. */
function run(doc, t) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w, h);
  paint(c.ctx, doc, t, { strict: true });
  return c;
}

/**
 * Everything checked for one graphic, as a list of what went wrong: the reader
 * leaves every layer as built, ids are unique and the recipe's, times are in
 * order, entrances end before exits at the default length, frames at `samples`
 * moments are clean, and the gallery's moment shows something inside the frame.
 */
function problems(id, lang, format, fields, seconds, o = {}) {
  const out = [];
  let layers;
  let doc;
  try {
    layers = built(id, lang, format, fields, seconds);
    doc = docOf(id, lang, format, fields, seconds);
  } catch (e) {
    return [`throws: ${e && e.message}`];
  }
  const S = doc.seconds;
  if (canon(doc.layers) !== canon(layers)) out.push('the document reader changed the layers');
  const ids = new Set();
  for (const l of layers) {
    const again = readLayer(l, { seconds: S });
    if (canon(again) !== canon(l)) out.push(`${l.id}: not a fixed point of readLayer`);
    if (ids.has(l.id)) out.push(`${l.id}: id used twice`);
    ids.add(l.id);
    if (!l.id.startsWith(`${id}-`)) out.push(`${l.id}: id is not the recipe's`);
    if (!l.name) out.push(`${l.id}: no name`);
    if (!(l.start >= 0 && l.start < l.end && l.end <= S + 1e-9)) out.push(`${l.id}: times ${l.start}..${l.end} of ${S}`);
    if (o.timing) {
      const n = unitsOf(l);
      if (l.in && l.out && inDone(l, n) > outStart(l, n) + 1e-9) out.push(`${l.id}: entrance ends ${inDone(l, n).toFixed(2)} after the exit starts ${outStart(l, n).toFixed(2)}`);
      if (l.kind === 'counter' && l.out && l.start + l.count.delay + l.count.d > outStart(l) + 1e-9) out.push(`${l.id}: still counting when it leaves`);
    }
  }
  const still = stillTime(doc.layers, S);
  const shown = doc.layers.filter((l) => l.kind !== 'backdrop' && poseAt(l, still, lang !== 'en').on);
  if (!shown.length) out.push(`nothing on at stillTime ${still}`);
  const c = run(doc, still);
  if (!drewSomething(c.calls)) out.push('nothing drawn at stillTime');
  if (c.check().length) out.push(`stillTime: ${c.check()[0]}`);
  // Inside the safe margin at the gallery's moment — 8u on the wide frame, 6u on the others, less half a u — as the
  // recording canvas measures words (0.55 em a character).
  const [w, h] = SIZES[format];
  const env = makeEnv(c.ctx, doc, still, w, h);
  const safe = ((format === 'landscape' ? 8 : 6) - 0.5) * (Math.min(w, h) / 100);
  for (const l of doc.layers) {
    if (l.kind === 'backdrop') continue;
    const b = layerBox(env, l);
    if (!b) continue;
    if (b.x < safe || b.y < safe || b.x + b.w > w - safe || b.y + b.h > h - safe) out.push(`${l.id}: box outside the safe margin at stillTime ${JSON.stringify([b.x, b.y, b.w, b.h].map(Math.round))}`);
  }
  const samples = o.samples ?? 40;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * S;
    const bad = run(doc, t).check();
    if (bad.length) { out.push(`t=${t.toFixed(2)}: ${bad[0]}`); break; }
  }
  return out;
}

// ── reading numbers ───────────────────────────────────────────────────────

const num = (s) => { const f = numberOf(s); return f ? f.value : null; };
ok('plain numbers', num('40') === 40 && num('0') === 0 && num('3.5') === 3.5 && num('.5') === 0.5 && num('+7') === 7);
ok('a comma before three digits groups thousands', num('1,200') === 1200 && num('12,345,678') === 12345678);
ok('dots used more than once group thousands', num('1.200.000') === 1200000);
ok('both signs: the last one is the decimal sign', num('1,234.5') === 1234.5 && num('1.234,5') === 1234.5);
ok('a single comma before other than three digits is a decimal comma', num('4,5') === 4.5 && num('1,25') === 1.25);
ok('a single dot is a decimal point, even before three digits', num('1.200') === 1.2);
ok('spaces grouping thousands', num('1 200 000') === 1200000 && num('1\u00A0200') === 1200 && num('1\u202F200') === 1200);
ok('Arabic-Indic digits, Arabic separators', num('\u0664\u0660') === 40 && num('\u0661\u066C\u0662\u0660\u0660') === 1200 && num('\u0663\u066B\u0665') === 3.5);
ok('Persian digits', num('\u06F4\u06F0') === 40 && num('\u06F1\u06F2\u06F5') === 125);
ok('a percent sign, Latin or Arabic', numberOf('45%').percent && num('45%') === 45 && numberOf('\u0664\u0665\u066A').percent && num('\u0664\u0665\u066A') === 45);
ok('negative numbers, with a hyphen or a minus sign', num('-40') === -40 && num('\u221240') === -40 && num('- 40') === -40);
ok('never -0', Object.is(num('-0'), 0) && Object.is(num('-0.00'), 0));
ok('a currency sign before, a mark after', (() => {
  const a = numberOf('$1,200');
  const b = numberOf('1200+');
  const c = numberOf('US$ 5');
  const d = numberOf('2.5M');
  return a.value === 1200 && a.prefix === '$' && b.value === 1200 && b.suffix === '+' && c.prefix === 'US$' && c.value === 5 && d.value === 2.5 && d.suffix === 'M';
})());
ok('decimals as written, at most three', numberOf('4.50').decimals === 2 && numberOf('3.14159').decimals === 3 && numberOf('1,200').decimals === 0);
ok('an exponent', num('1e9') === 1e9 && numberOf('1e9').decimals === 0);
ok('held inside the reader\u2019s range', num('1e99') === 1e12 && num('-99999999999999999') === -1e12);
ok('words after a number that are not a mark are ignored', num('40 (estimated)') === 40 && numberOf('40 (estimated)').suffix === '');
ok('no number, no figure', [null, undefined, 12, '', '   ', 'abc', 'Q', 'NaN', 'Infinity', '-', '.', ',', '%', '$'].every((x) => numberOf(x) === null));
ok('never NaN, whatever is typed', ['1,2,3', '1..2', '\u0661\u066C\u066C\u0662', '0x10', '1e', '--5', '+-5', '9'.repeat(400), '\u0661'.repeat(40), '1,23,4', '.,.,'].every((s) => {
  const f = numberOf(s);
  return f === null || (Number.isFinite(f.value) && Number.isInteger(f.decimals));
}));

const items = (s, max = 12, fb = '') => itemsOf(s, max, fb).map((it) => [it.label, it.value]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok('Label: value lines', same(items('Q1: 40\nQ2: 55'), [['Q1', 40], ['Q2', 55]]));
ok('every separator: : = - \u060C', same(items('A: 1\nB = 2\nC - 3\nD\u060C 4\nE\u20135\nF\uFF1A6'), [['A', 1], ['B', 2], ['C', 3], ['D', 4], ['E', 5], ['F', 6]]));
ok('a negative value after a colon', same(items('Loss: -40\nGain: +5'), [['Loss', -40], ['Gain', 5]]));
ok('a dash in the label is not the separator', same(items('Wi-Fi users - 40\n2019-2020: 12\nCOVID-19 400\nQ1 - 40 (est.)'), [['Wi-Fi users', 40], ['2019-2020', 12], ['COVID-19', 400], ['Q1', 40]]));
ok('no separator: the last word, if it is a number', same(items('Q1 40\nJan 2024\nStep 3:\nQ1'), [['Q1', 40], ['Jan', 2024]]));
ok('a line with no number is skipped', same(items('Title\nQ1: 40\n\nnothing here: yes\nQ2: 5'), [['Q1', 40], ['Q2', 5]]));
ok('a bare number is an item with no label', same(items('40\n55'), [['', 40], ['', 55]]));
ok('bullets are not labels', same(items('\u2022 Q1: 40\n- Q2: 55\n* Q3: 70'), [['Q1', 40], ['Q2', 55], ['Q3', 70]]));
ok('Arabic and Kurdish lines', same(items('\u0627\u0644\u0631\u0628\u0639: \u0664\u0660\n\u0686\u0627\u0631\u06D5\u06A9\u06CC \u06CC\u06D5\u06A9\u06D5\u0645: \u0665\u066B\u0665'), [['\u0627\u0644\u0631\u0628\u0639', 40], ['\u0686\u0627\u0631\u06D5\u06A9\u06CC \u06CC\u06D5\u06A9\u06D5\u0645', 5.5]]));
ok('grouped thousands and percents in a list', same(items('A: 1,200\nB: 12.5%\nC: \u0661\u066C\u0660\u0660\u0660'), [['A', 1200], ['B', 12.5], ['C', 1000]]));
ok('at most the field\u2019s max', itemsOf('a:1\nb:2\nc:3\nd:4', 3).length === 3);
ok('labels are cut to 24 characters', (() => {
  const [it] = itemsOf(`${'x'.repeat(30)}: 5`, 3);
  return Array.from(it.label).length === 24 && it.value === 5;
})());
ok('labels are one line with single spaces, no separator left over', same(items('  Big    label  :  7'), [['Big label', 7]]));
ok('nothing readable: the fallback\u2019s items', same(items('no numbers here\njust words', 5, 'X: 1\nY: 2'), [['X', 1], ['Y', 2]]));
ok('never nothing: one zero when even the fallback has no number', same(items('', 5, 'words'), [['', 0]]));
ok('an empty field reads the fallback', same(items('', 5, 'X: 1'), [['X', 1]]));

// ── icons ────────────────────────────────────────────────────────────────

ok('icons by a word in the label, in any of the four languages', [
  ['Students', 'graduation'], ['Active users', 'users'], ['Revenue', 'money'], ['Hours saved', 'clock'], ['Growth', 'trend'],
  ['Countries', 'globe'], ['Awards won', 'trophy'], ['Courses', 'book'],
  ['\u0627\u0644\u0637\u0644\u0627\u0628', 'graduation'], ['\u0627\u0644\u0645\u0628\u064A\u0639\u0627\u062A', 'money'], ['\u062F\u0648\u0644\u0627\u0631', 'money'], ['\u0627\u0644\u062F\u0648\u0644', 'globe'],
  ['\u0642\u0648\u062A\u0627\u0628\u06CC\u0627\u0646', 'graduation'], ['\u06A9\u06C6\u0631\u0633\u06D5\u06A9\u0627\u0646', 'book'], ['\u0648\u06B5\u0627\u062A\u0627\u0646', 'globe'],
  ['\u062E\u0648\u06CE\u0646\u062F\u06A9\u0627\u0631', 'graduation'], ['\u0648\u06D5\u0644\u0627\u062A', 'globe'],
].every(([label, icon]) => iconFor(label, 0) === icon), [['Students', iconFor('Students', 0)], ['\u0627\u0644\u062F\u0648\u0644', iconFor('\u0627\u0644\u062F\u0648\u0644', 0)]]);
ok('Arabic-script words match at a word\u2019s start, after a joined article or preposition, never inside another word', [
  ['\u0644\u0644\u0637\u0644\u0627\u0628', 'graduation'], ['\u0648\u0627\u0644\u0645\u0633\u062A\u062E\u062F\u0645\u064A\u0646', 'users'],
  ['\u0637\u0639\u0627\u0645', 'food'], ['\u0631\u0633\u0627\u0644\u0629', 'chat'], ['\u0645\u0628\u0644\u063A', 'money'],
  ['\u0628\u06D5\u0631\u0646\u0627\u0645\u06D5', 'code'], ['\u0639\u0627\u0645\u0644\u064A\u0646', 'users'], ['\u062F\u0627\u0631\u0627\u06CC\u06CC', 'money'],
].every(([label, icon]) => iconFor(label, 0) === icon), ['\u0637\u0639\u0627\u0645', '\u0631\u0633\u0627\u0644\u0629', '\u0645\u0628\u0644\u063A', '\u0628\u06D5\u0631\u0646\u0627\u0645\u06D5'].map((l) => iconFor(l, 0)));
ok('Arabic letters written the Kurdish way still match', iconFor('\u0627\u0644\u0637\u0644\u0627\u0628', 0) === iconFor('\u0627\u0644\u0637\u0644\u0627\u0628'.replace(/\u064A/g, '\u06CC'), 0));
ok('no word, a steady cycle by place', iconFor('Something else', 0) === 'star' && iconFor('Something else', 1) === 'target' && iconFor('Something else', 2) === 'bolt' && iconFor('', 3) === 'star');
ok('"separate" is not "rate", "updates" is not "date"', iconFor('Separate', 0) === 'star' && iconFor('Updates', 1) === 'target');

// ── the samples ───────────────────────────────────────────────────────────

for (const id of IDS) {
  const r = DATA_RECIPES[id];
  const meta = META[id];
  ok(`${id}: a recipe with its meta`, !!r && typeof r.build === 'function' && !!meta && meta.group === 'data');
  const missing = [];
  for (const lang of LANGS) {
    for (const f of meta.fields) {
      const v = r.sample[lang]?.[f.key];
      if (typeof v !== 'string' || (!v && f.key !== 'prefix')) missing.push(`${lang}.${f.key}`);
      else if (ARABIC_DIGIT.test(v)) missing.push(`${lang}.${f.key} has Arabic-Indic digits`);
      else if (f.kind === 'list') {
        const lines = v.split('\n');
        if (lines.length > f.max || itemsOf(v, f.max).length !== lines.length) missing.push(`${lang}.${f.key} has a line that does not read`);
      } else if (f.kind === 'number' && !numberOf(v)) missing.push(`${lang}.${f.key} is not a number`);
      else if (Array.from(v).length > f.max) missing.push(`${lang}.${f.key} is longer than ${f.max}`);
    }
  }
  ok(`${id}: a sample for every field in all four languages, lists that read, digits 0-9`, !missing.length, missing);
  ok(`${id}: the samples in Arabic script are in it`, ['ar', 'ckb', 'kmr'].every((lang) => meta.fields.every((f) => {
    const v = r.sample[lang][f.key];
    return !v || f.kind === 'number' || f.key === 'prefix' || f.key === 'suffix' || /[\u0600-\u06FF]/.test(v);
  })));
}
ok('Sorani samples use Sorani letters, Badini ones Badini', ['ckb', 'kmr'].every((lang) => {
  const all = IDS.map((id) => Object.values(DATA_RECIPES[id].sample[lang]).join(' ')).join(' ');
  return lang === 'ckb' ? /[\u0695\u06B5\u06C6\u06CE\u06D5]/.test(all) : /[\u06A4]/.test(all);
}));

// ── every recipe, language and shape ──────────────────────────────────────

for (const id of IDS) {
  const bad = [];
  for (const lang of LANGS) {
    const idLists = [];
    for (const format of FORMATS) {
      for (const p of problems(id, lang, format, undefined, undefined, { timing: true })) bad.push(`${lang} ${format}: ${p}`);
      idLists.push(built(id, lang, format).map((l) => l.id).join(','));
    }
    if (new Set(idLists).size !== 1) bad.push(`${lang}: ids differ between shapes`);
  }
  ok(`${id}: 4 languages \u00D7 4 shapes build cleanly, read back unchanged, keep their ids, arrive before they leave, draw cleanly at 40 moments and show something`, !bad.length, bad.slice(0, 6));
}

for (const id of IDS) {
  const bad = [];
  for (const seconds of [1, 2, 30]) {
    for (const [lang, format] of [['en', 'landscape'], ['ar', 'portrait'], ['ckb', 'square'], ['kmr', 'feed']]) {
      for (const p of problems(id, lang, format, undefined, seconds, { samples: 24 })) bad.push(`${seconds} s ${lang} ${format}: ${p}`);
    }
  }
  ok(`${id}: at 1, 2 and 30 seconds`, !bad.length, bad.slice(0, 6));
  const long = problems(id, 'en', 'landscape', undefined, 30, { samples: 4, timing: true });
  ok(`${id}: at 30 seconds the entrance still ends before the exit`, !long.length, long);
}

// ── the words people type ─────────────────────────────────────────────────

const LONG = 'A title that goes on for far longer than anybody would ever want a title to be, and more';
const LONG_AR = '\u0639\u0646\u0648\u0627\u0646 \u0637\u0648\u064A\u0644 \u062C\u062F\u0627\u064B '.repeat(8);
const long30 = (i) => `A category with a long name ${i}`.slice(0, 30);
const FIELDS = {
  'big-number': [
    { value: '1', prefix: '', suffix: '', label: 'Goal' },
    { value: '999999999999', prefix: 'US$', suffix: '+', label: LONG },
    { value: '1000000000', prefix: '', suffix: '', label: LONG_AR },
    { value: '0', prefix: '', suffix: '%', label: '' },
    { value: '-42.5', prefix: '', suffix: '%', label: 'Down' },
    { value: '-1200', prefix: '$', suffix: '', label: 'Loss' },
    { value: 'not a number', prefix: '', suffix: '', label: 'Fallback' },
    { value: '\u0668\u0665\u066A', prefix: '', suffix: '', label: '\u0627\u0644\u0647\u062F\u0641' },
  ],
  'bar-chart': [
    { title: 'Sales', items: 'A: 1', unit: '' },
    { title: LONG, items: Array.from({ length: 8 }, (_, i) => `${long30(i)}: ${(i + 1) * 12}`).join('\n'), unit: 'visits' },
    { title: 'Zeros', items: 'A: 0\nB: 0\nC: 0', unit: '%' },
    { title: 'Billions', items: 'A: 1000000000\nB: 250000000\nC: 999999999', unit: '' },
    { title: 'Negatives', items: 'A: -10\nB: 20\nC: -30', unit: '' },
    { title: 'All negative', items: 'A: -10\nB: -20', unit: '' },
    { title: '', items: 'junk\nmore junk', unit: 'k' },
    { title: 'Seven', items: Array.from({ length: 7 }, (_, i) => `Q${i + 1}: ${i === 6 ? 100 : 10 + i}`).join('\n'), unit: '' },
  ],
  donut: [
    { title: 'One', items: 'Everything: 1' },
    { title: LONG, items: Array.from({ length: 6 }, (_, i) => `${long30(i)}: ${(i + 1) * 1000000}`).join('\n') },
    { title: 'Shares', items: 'Mobile: 60\nDesktop: 30\nTablet: 10' },
    { title: 'Zeros', items: 'A: 0\nB: 0' },
    { title: 'Mixed', items: 'A: -5\nB: 10\nC: 1000000000' },
    { title: 'Five', items: 'A: 1\nB: 2\nC: 3\nD: 4\nE: 5' },
  ],
  'line-chart': [
    { title: 'One point', items: 'Jan: 5', unit: '' },
    { title: 'Two', items: 'Start: 1\nEnd: 2', unit: 'k' },
    { title: LONG, items: Array.from({ length: 12 }, (_, i) => `${long30(i)}: ${Math.round(50 + 40 * Math.sin(i))}`).join('\n'), unit: 'visits' },
    { title: 'Flat', items: 'A: 0\nB: 0\nC: 0', unit: '' },
    { title: 'Billions', items: 'A: 1\nB: 1000000000\nC: 5', unit: '' },
    { title: 'Falls', items: 'A: 90\nB: -10\nC: 20\nD: 5', unit: '%' },
  ],
  stats: [
    { title: 'One', items: 'Students: 5' },
    { title: 'Two', items: 'Users: 1000000000\nHours: 0' },
    { title: LONG, items: `${long30(1)}: 1\n${long30(2)}: -250\n${long30(3)}: 99.5%` },
    { title: '', items: 'Revenue: $2,500,000\nGrowth: 12%\nTeams: 40+' },
  ],
};
for (const id of IDS) {
  const bad = [];
  FIELDS[id].forEach((fields, k) => {
    for (const [lang, format] of [['en', 'landscape'], ['ar', 'landscape'], ['ckb', 'portrait'], ['kmr', 'square'], ['en', 'feed']]) {
      for (const p of problems(id, lang, format, fields, undefined, { samples: 16, timing: true })) bad.push(`case ${k} ${lang} ${format}: ${p}`);
    }
  });
  ok(`${id}: one word, 90 characters, one item and the most, zeros, a billion, negatives`, !bad.length, bad.slice(0, 6));
}

// ── what each recipe promises ─────────────────────────────────────────────

{
  const layers = built('big-number', 'en', 'landscape');
  const ring = layers.find((l) => l.id === 'big-number-ring');
  const number = layers.find((l) => l.id === 'big-number-number');
  const label = layers.find((l) => l.id === 'big-number-label');
  ok('big number: the ring is a gauge for a percentage (80% sweeps 288\u00B0) over a full faint track', ring.sweep === 288 && layers.find((l) => l.id === 'big-number-track').sweep === 360);
  ok('big number: the ring draws on with the count, the same start, length and curve', ring.in.fx === 'draw' && near(ring.start, number.start) && near(ring.in.d, number.count.d) && ring.in.ease === number.count.ease && number.count.ease === 'expo-out');
  ok('big number: rolls from 0 to the value with the suffix', number.from === 0 && number.to === 80 && number.suffix === '%');
  // Landing as it is seen: the first moment the number shown is the final one.
  const shownAt = (l) => { for (let t = l.start; t < l.end; t += 0.01) if (Math.round(countAt(l, t)) === l.to) return t; return l.end; };
  const peakAt = (l) => { let best = l.start; for (let t = l.start; t < l.end; t += 0.01) if (poseAt(l, t, false).sx > poseAt(l, best, false).sx) best = t; return best; };
  const s = (t) => poseAt(number, t, false).sx;
  ok('big number: the number swells a few per cent past its size as the count is seen to land, then settles',
    Math.abs(peakAt(number) - shownAt(number)) < 0.12 && s(peakAt(number)) > 1.02 && s(peakAt(number)) < 1.05 && near(s(number.start + number.in.d + 0.01), 1, 1e-9),
    [peakAt(number), shownAt(number)]);
  const thousand = built('big-number', 'en', 'landscape', { value: '12500', prefix: '', suffix: '', label: '' }).find((l) => l.id === 'big-number-number');
  ok('big number: a longer count lands later, and swells later with it', peakAt(thousand) > peakAt(number) + 0.2 && Math.abs(peakAt(thousand) - shownAt(thousand)) < 0.15, [peakAt(thousand), shownAt(thousand)]);
  ok('big number: the label masks up beneath, muted', label.in.fx === 'mask' && label.color === 'muted' && label.y > 50);
  ok('big number: everything leaves together at the end', layers.filter((l) => l.out).every((l) => near(outStart(l, unitsOf(l)), 5 - 0.45, 0.2)));
  const big = built('big-number', 'en', 'landscape', { value: '1000000000', prefix: '', suffix: '', label: '' }).find((l) => l.id === 'big-number-number');
  ok('big number: a long number is set smaller, so it stays inside the ring', big.size < number.size * 0.6);
  const neg = built('big-number', 'en', 'landscape', { value: '-25', prefix: '', suffix: '%', label: '' });
  ok('big number: a negative percentage sweeps the other way', neg.find((l) => l.id === 'big-number-ring').sweep === -90 && neg.find((l) => l.id === 'big-number-number').to === -25);
  const ar = built('big-number', 'ar', 'landscape').find((l) => l.id === 'big-number-number');
  ok('big number: the percent sign is the Arabic one after Arabic-Indic digits', ar.suffix === '\u066A');
}
{
  const [chart] = built('bar-chart', 'en', 'landscape').filter((l) => l.kind === 'chart');
  ok('bar chart: bars that grow one after another, 0.1 s apart, values counting with the unit', chart.chart === 'bars' && chart.in.fx === 'grow' && ['back-out', 'expo-out'].includes(chart.in.ease) && near(chart.gap, 0.1) && chart.values && chart.unit === 'k');
  {
    // Each bar grows smoothly to rest: never faster at the moment it arrives than a frame's worth of its height.
    const n = chart.data.length;
    const g = (t, i) => { const p = poseAt(chart, t, false, { i, n }); return Math.min(Math.max(0, p.grow), 1.25, Math.min(1, p.draw), Math.min(1, p.reveal)); };
    const jumps = [];
    for (let i = 0; i < n; i++) {
      // The first frame at full height, and how far the frame before it was from there.
      let t1 = chart.start + chart.in.delay + i * chart.gap;
      while (g(t1, i) < 0.999 && t1 < chart.end) t1 += 1 / 240;
      const before = g(t1 - 1 / 30, i);
      if (1 - before > 0.03) jumps.push([i, +before.toFixed(3)]);
    }
    ok('bar chart: every bar settles into its height, none stops dead', !jumps.length, jumps);
  }
  ok('bar chart: the tallest bar in the second accent', chart.colors.join() === 'accent,accent,accent,accent2');
  const tall = built('bar-chart', 'en', 'portrait', { title: 'T', items: 'A: 1\nB: 2\nC: 3\nD: 4\nE: 5', unit: '' }).find((l) => l.kind === 'chart');
  const four = built('bar-chart', 'en', 'portrait', { title: 'T', items: 'A: 1\nB: 2\nC: 3\nD: 4', unit: '' }).find((l) => l.kind === 'chart');
  const wordy = built('bar-chart', 'en', 'landscape', { title: 'T', items: Array.from({ length: 8 }, (_, i) => `${long30(i)}: ${i + 1}`).join('\n'), unit: '' }).find((l) => l.kind === 'chart');
  ok('bar chart: in portrait, more than four bars lie down; long labels lie them down anywhere', tall.chart === 'hbars' && four.chart === 'bars' && wordy.chart === 'hbars');
  const edge = built('bar-chart', 'en', 'landscape', { title: 'T', items: 'A: 1\nB: 2\nC: 3\nD: 4\nE: 5\nF: 6\nG: 7\nH: 99', unit: '' }).find((l) => l.kind === 'chart');
  const inner = built('bar-chart', 'en', 'landscape', { title: 'T', items: 'A: 1\nB: 2\nC: 3\nD: 99\nE: 5\nF: 6\nG: 7\nH: 8', unit: '' }).find((l) => l.kind === 'chart');
  const lit = (c) => c.data.map((_, i) => c.colors[i % c.colors.length]).filter((x) => x === 'accent2').length;
  ok('bar chart: with eight bars, one bar lit or none, never two', lit(edge) === 0 && lit(inner) === 1 && inner.colors[3 % inner.colors.length] === 'accent2');
}
{
  const layers = built('donut', 'en', 'landscape');
  const chart = layers.find((l) => l.id === 'donut-chart');
  const total = layers.find((l) => l.id === 'donut-total');
  ok('donut: slices sweep in clockwise one after another over a track that is its own layer', chart.chart === 'donut' && chart.in.fx === 'draw' && chart.gap > 0.1 && !chart.labels && !chart.values && !!layers.find((l) => l.id === 'donut-track'));
  ok('donut: the total counts up in the middle, as long as the slices take', total.to === 1000 && near(total.count.d, chart.in.d + (chart.data.length - 1) * chart.gap) && total.x === chart.x && total.y < chart.y);
  ok('donut: a legend row per slice, each arriving with its slice', [1, 2, 3, 4].every((i) => {
    const sw = layers.find((l) => l.id === `donut-swatch-${i}`);
    const value = layers.find((l) => l.id === `donut-value-${i}`);
    return sw && value && near(sw.start, chart.start + (i - 1) * chart.gap + 0.15) && value.to === chart.data[i - 1].value && sw.fill === chart.colors[i - 1];
  }));
  const six = built('donut', 'en', 'landscape', { title: 'T', items: 'A: 1\nB: 2\nC: 3\nD: 4\nE: 5\nF: 6' });
  const a = six.find((l) => l.id === 'donut-chart');
  const b = six.find((l) => l.id === 'donut-chart-tints');
  const tones = a.colors.map((c, i) => (c === '#00000000' ? `${b.colors[i]}@${b.opacity}` : c));
  ok('donut: six slices, six different colours (the last two tints drawn by a second chart)', new Set(tones).size === 6 && !!b && b.opacity < 1 && canon(b.data) === canon(a.data) && b.x === a.x && b.w === a.w);
  const shares = built('donut', 'en', 'landscape', { title: 'T', items: 'Mobile: 60\nDesktop: 30\nTablet: 10' });
  const mid = shares.find((l) => l.id === 'donut-total');
  ok('donut: shares of a hundred show the largest share and its name in the middle', mid.to === 60 && mid.suffix === '%' && shares.find((l) => l.id === 'donut-total-label').text === 'Mobile');
}
{
  const layers = built('line-chart', 'en', 'landscape');
  const chart = layers.find((l) => l.id === 'line-chart-chart');
  const tag = layers.find((l) => l.id === 'line-chart-tag');
  const value = layers.find((l) => l.id === 'line-chart-tag-value');
  ok('line chart: one line drawn on from the first point to the last, labels and values drawn here', chart.chart === 'line' && chart.in.fx === 'draw' && chart.gap === 0 && !chart.labels && !chart.values);
  ok('line chart: the last value in a tag with the unit, as the line arrives', value.to === 80 && value.suffix === 'k' && near(tag.start, chart.start + chart.in.d - 0.1, 1e-6));
  ok('line chart: on the wide frame the tag stands beside the last point, past the plot\u2019s end', tag.x - tag.w / 2 > chart.x + chart.w / 2 - 3);
  const tall = built('line-chart', 'en', 'portrait');
  const tc = tall.find((l) => l.id === 'line-chart-chart');
  const tt = tall.find((l) => l.id === 'line-chart-tag');
  ok('line chart: on a tall frame the tag stands above the last point, inside the frame', tt.y + tt.h / 2 < tc.y - tc.h / 2 + 2 && Math.abs(tt.x) + tt.w / 2 <= 50 - 6 + 1e-9);
  const labels = layers.filter((l) => l.id.startsWith('line-chart-label-'));
  ok('line chart: a label under each point, rising as the line reaches it', labels.length === 6 && labels.every((l, i) => i === 0 || l.start > labels[i - 1].start));
  const many = built('line-chart', 'ckb', 'portrait', { title: 'T', items: Array.from({ length: 12 }, (_, i) => `${long30(i)}: ${i}`).join('\n'), unit: '' });
  const shownLabels = many.filter((l) => l.id.startsWith('line-chart-label-') && !l.hidden);
  ok('line chart: labels too long for their place are thinned from the last one back, the rest kept hidden', shownLabels.length < 12 && shownLabels.some((l) => l.id === 'line-chart-label-12') && many.filter((l) => l.id.startsWith('line-chart-label-')).length === 12);
}
{
  const layers = built('stats', 'en', 'landscape');
  const icons = layers.filter((l) => l.kind === 'icon');
  const numbers = layers.filter((l) => l.kind === 'counter');
  ok('three figures: three icons chosen by their labels, three counters rolling up 0.15 s apart', icons.map((l) => l.icon).join() === 'graduation,book,globe' && numbers.length === 3 && near(numbers[1].start - numbers[0].start, 0.15) && numbers.every((l) => l.from === 0));
  ok('three figures: two thin rules between the columns, grown', layers.filter((l) => l.id.startsWith('stats-rule-')).length === 2 && layers.filter((l) => l.id.startsWith('stats-rule-')).every((l) => l.in.fx === 'grow' && l.w < 1));
  ok('three figures: no badge casts a shadow (a shadowed shape cannot fade in WebKit)', icons.every((l) => !l.shadow));
  const marks = built('stats', 'en', 'landscape', { title: 'T', items: 'Revenue: $2,500,000\nGrowth: 12%\nTeams: 40+' }).filter((l) => l.kind === 'counter');
  ok('three figures: the marks typed with a number are kept', marks[0].prefix === '$' && marks[0].to === 2500000 && marks[1].suffix === '%' && marks[2].suffix === '+');
  const tall = built('stats', 'en', 'portrait').filter((l) => l.kind === 'counter');
  ok('three figures: in portrait they stack', tall.every((l) => l.x === 0) && tall[1].y > tall[0].y && tall[2].y > tall[1].y);
}

// ── the counters count, and never past their number ───────────────────────

{
  const bad = [];
  for (const id of IDS) {
    for (const l of built(id, 'en', 'landscape').filter((x) => x.kind === 'counter')) {
      const lo = Math.min(l.from, l.to);
      const hi = Math.max(l.from, l.to);
      for (let t = l.start; t < l.end; t += 0.05) {
        const v = countAt(l, t);
        if (!(v >= lo - 1e-9 && v <= hi + 1e-9)) { bad.push(`${l.id} at ${t.toFixed(2)}: ${v}`); break; }
      }
      if (countAt(l, l.start + l.count.delay + l.count.d + 1e-6) !== l.to) bad.push(`${l.id}: does not land on ${l.to}`);
    }
  }
  ok('every counter stays between zero and its number and lands on it', !bad.length, bad);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
