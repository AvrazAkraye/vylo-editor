// The numbers rule under attack (motionchatops.ts `numbersIn`, `sourcedFields`,
// `sourcedLayer`; motionai.ts `parsePlan`; motiontemplates.ts `resolveFields`):
// a figure the graphic shows must be one the person gave, however the model
// spells it — and one the person did give must pass, however they spelled it.
//
// What matters: the rule checks what the graphic will actually draw, read by
// the template's own reader, so a number cannot slip past it by the way a line
// is written (`=`, a full-width colon, an Arabic comma, a dash with words
// after it, a second colon), by an exponent or a space between groups, or by
// digits in a prefix, suffix or unit drawn against it; a picture never comes
// from the model; a number the person wrote with spaces between its thousands,
// in full-width digits or with a joiner inside is theirs; the template's
// example unit never lands on the person's own figures, however often the
// graphic is built again; and reading every number in a message, or a list
// line full of spaces, costs about one pass over it.
import { parsePlan, planned } from '../.test-build/motionai.js';
import { applyOps, numbersIn, sourcedFields } from '../.test-build/motionchatops.js';
import { readMotion } from '../.test-build/motionread.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { setFields, setFormat, setLang } from '../.test-build/motionedit.js';
import { formatNumber } from '../.test-build/motionfonts.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);
const req = (request) => ({ request, lang: 'en', format: null, seconds: null, palette: null, recipe: null });
/** The values the graphic rolls to or draws: every counter's `to`, every chart datum. */
const values = (m) => [...new Set(m.layers.flatMap((l) => (l.kind === 'counter' ? [l.to] : l.kind === 'chart' ? l.data.map((d) => d.value) : [])))];
/** What the counters and charts show, as a person reads them. */
const faces = (m) => m.layers.map((l) => (l.kind === 'counter' ? `${l.prefix}${formatNumber(l.to, { decimals: l.decimals, group: l.group, lang: m.lang })}${l.suffix}`
  : l.kind === 'chart' ? l.data.map((d) => `${d.value}${l.unit}`).join(' ') : '')).filter(Boolean);
const plan = (request, reply) => parsePlan(J(reply), req(request), { id: 'p', now: 1 });
const chart = (items) => plan('a bar chart of our quarterly sales', { recipe: 'bar-chart', fields: { title: 'Sales', items } });
const codes = (notes) => notes.map((n) => (n.field ? `${n.code}:${n.field}` : n.code));

// ── what the rule always caught ───────────────────────────────────────────
console.log('controls');
{
  const m = chart('Q1: 87\nQ2: 55');
  ok('"Q1: 87" nobody gave is replaced by the example and flagged', !values(m).includes(87) && planned(m), values(m));
  const given = ['1200', '\u0661\u0662\u0660\u0660', '\u06F1\u06F2\u06F0\u06F0', '\u0661\u066C\u0662\u0660\u0660', '1,200', '1.200']
    .map((s) => values(plan(`${s} students`, { recipe: 'big-number', fields: { value: '1200', label: 'students' } }))[0]);
  ok('1200 the person wrote in Latin, Arabic-Indic or Persian digits, grouped with a comma, an Arabic separator or a point, passes', given.every((v) => v === 1200), given);
}

// ── numbers nobody gave, written so a looser check would not see them ────
console.log('smuggled');
{
  // The chart reads a line at the first ":", "=", "\u060C" or "\uFF1A" a number stands after, or at a dash; the check
  // reads it with the same reader, so every one of these is caught.
  const lines = ['Q1=87\nQ2=55', 'Q1 = 87 (est.)\nQ2 = 55 (est.)', 'Growth: 87%: est\nCost: 55%: est', 'Q1 - 87 (est)\nQ2 - 55 (est)',
    'Q1\uFF1A87\nQ2\uFF1A55', 'Q1\u060C 87 users\nQ2\u060C 55 users'];
  const leaked = lines.filter((items) => values(chart(items)).includes(87));
  ok('a chart value nobody gave is caught however the line is written', leaked.length === 0, leaked);
  const replaced = chart('Growth: 87%: est\nCost: 55%: est');
  ok('and the line keeps its label and its percent sign, with an example number', replaced.recipe.fields.items.split('\n')[0].startsWith('Growth: ')
    && replaced.recipe.fields.items.split('\n')[0].endsWith('%') && planned(replaced), replaced.recipe.fields.items);
  const e3 = values(plan('Our 1 clinic has 3 doctors', { recipe: 'big-number', fields: { value: '1e3', label: 'patients' } }))[0];
  const sp = values(plan('1 clinic, 200 patients', { recipe: 'big-number', fields: { value: '1 200', label: 'patients' } }))[0];
  ok('an exponent, or a space between two given numbers, does not make a new one (1e3 is not 1000, "1 200" not 1200)', e3 !== 1000 && sp !== 1200, { e3, sp });
  const theirs = values(plan('We have 1200 students', { recipe: 'big-number', fields: { value: '1 200', label: 'students' } }))[0];
  ok('"1 200" is fine where the person wrote 1200', theirs === 1200, theirs);
  const stats = buildMotion({ id: 's', recipe: 'stats', lang: 'en', format: 'landscape', now: 1, request: 'our year' });
  const r = applyOps(stats, [{ op: 'fields', set: { items: 'Students = 9999 (approx)\nCourses: 40\nCountries: 12' } }], 2, 'update the students figure');
  ok('a chat edit cannot put 9999 nobody gave into the figures', !values(r.motion).includes(9999) && codes(r.skipped).includes('unsourced:items'), [values(r.motion), r.skipped]);
}

// ── what is drawn against a number ────────────────────────────────────────
console.log('prefix, suffix, unit');
{
  const shown = [
    ...faces(plan('our 5 clinics', { recipe: 'big-number', fields: { value: '5', suffix: '000', label: 'patients' } })),
    ...faces(plan('our 5 clinics', { recipe: 'big-number', fields: { value: '5', prefix: '19', label: 'patients' } })),
    ...faces(plan('our 5 clinics', { layers: [{ kind: 'counter', to: 5, suffix: '000 patients' }] })),
    ...faces(plan('5 clinics', { layers: [{ kind: 'chart', data: [{ label: 'A', value: 5 }], unit: '00%' }] })),
    ...faces(plan('5 clinics', { recipe: 'bar-chart', fields: { title: 'Clinics', items: 'A: 5', unit: ' 000' } })),
  ];
  ok('digits against a number are refused: a given 5 never becomes 5000, 195 or 500%', J(shown) === J(['5', '5', '5', '5', '5']), shown);
  const counter = readMotion({ id: 'x', title: 'x', request: 'our 5 clinics', layers: [{ kind: 'counter', id: 'n', to: 5, suffix: '+' }] });
  const set = applyOps(counter, [{ op: 'layer', id: 'n', set: { suffix: '000' } }], 2);
  ok('in the chat, a counter keeps its own suffix and says why', faces(set.motion)[0] === '5+' && J(codes(set.skipped)) === J(['unsourced:suffix']), [faces(set.motion), set.skipped]);
  const added = applyOps(counter, [{ op: 'add', kind: 'counter', set: { to: 5, prefix: '1 ' } }], 2);
  const made = added.motion.layers.find((l) => l.kind === 'counter' && l.id !== 'n');
  ok('a counter added with a prefix that would read as more of the number has none, and says why', made?.prefix === '' && codes(added.skipped).includes('unsourced:prefix'), [made?.prefix, added.skipped]);
  const big = buildMotion({ id: 'b', recipe: 'big-number', fields: { value: '5', suffix: '+', label: 'clinics' }, lang: 'en', format: 'landscape', now: 1, request: 'our 5 clinics' });
  const field = applyOps(big, [{ op: 'fields', set: { suffix: '000' } }], 2);
  ok('a template\'s suffix field keeps its own the same way', field.motion === big && J(codes(field.skipped)) === J(['unsourced:suffix']), field.skipped);
  const rated = plan('rated 4.5 out of 5 by our patients', { recipe: 'big-number', fields: { value: '4.5', suffix: '/5', label: 'rating' } });
  const minutes = plan('open 24 hours', { layers: [{ kind: 'counter', to: 24, suffix: ' h / 24' }] });
  ok('a number somebody gave may stand in an affix apart from the figure: 4.5/5, 24 h / 24', faces(rated)[0] === '4.5/5' && faces(minutes)[0] === '24 h / 24', [faces(rated), faces(minutes)]);
}

// ── numbers the person gave ───────────────────────────────────────────────
console.log('given');
{
  const spellings = ['1 200', '1\u00A0200', '1\u202F200', '1\u2009200', '\uFF11\uFF12\uFF10\uFF10', '1\u200C200', '\u0661\u200C\u0662\u0660\u0660'];
  const got = spellings.map((s) => values(plan(`${s} students this year`, { recipe: 'big-number', fields: { value: '1200', label: 'students' } }))[0]);
  ok('1200 the person wrote with spaces between thousands (plain, no-break, narrow, thin), in full-width digits or with a joiner inside: passes', got.every((v) => v === 1200), got);
  const both = numbersIn('1 200 students');
  ok('a number grouped by spaces is both readings: 1200, and 1 and 200', both.has('1200') && both.has('1') && both.has('200'), [...both]);
  const wide = values(plan('We have 1200 students', { recipe: 'big-number', fields: { value: '\uFF11\uFF12\uFF10\uFF10', label: 'students' } }))[0];
  const joined = values(plan('We have 1200 students', { recipe: 'big-number', fields: { value: '1\u200C200', label: 'students' } }))[0];
  ok('and the template draws those spellings as the number they are, not the example or 1', wide === 1200 && joined === 1200, [wide, joined]);
}

// ── examples on the person's numbers ──────────────────────────────────────
console.log('examples');
{
  const big = plan('a big number: 1200 students this year', { recipe: 'big-number', fields: { value: '1200', label: 'students this year' } });
  const bars = plan('visitors: Mon 10, Tue 20', { recipe: 'bar-chart', fields: { title: 'Visitors', items: 'Mon: 10\nTue: 20' } });
  const line = plan('visitors: Mon 10, Tue 20', { recipe: 'line-chart', fields: { title: 'Visitors', items: 'Mon: 10\nTue: 20' } });
  const units = [faces(big)[0], bars.layers.find((l) => l.kind === 'chart').unit, line.layers.find((l) => l.kind === 'chart').unit];
  ok('the example\'s "%" or "k" is not put after the person\'s own figures when the answer names no unit', J(units) === J(['1,200', '', '']), units);
  const again = [setFields(big, { label: 'pupils' }, 2), setLang(big, 'ar', 2), setFormat(big, 'portrait', 2), setLang(setLang(big, 'ckb', 2), 'en', 3)];
  ok('built again — new words, a language, a shape — it still has no "%"', again.every((m) => m.recipe.fields.suffix === '' && !faces(m).some((f) => /[%\u066A]/.test(f))), again.map(faces));
  const rebuilt = buildMotion({ id: 'p', recipe: 'big-number', fields: big.recipe.fields, lang: 'en', format: big.format, now: 1, request: big.request, ai: true });
  ok('the fields it keeps build the same graphic', J(rebuilt.layers) === J(big.layers));
  const gallery = buildMotion({ id: 'g', recipe: 'big-number', lang: 'en', format: 'landscape', now: 1 });
  const galleryBars = buildMotion({ id: 'g', recipe: 'bar-chart', lang: 'en', format: 'landscape', now: 1 });
  ok('with no figures given, the example is shown whole, its "%" and "k" with it', faces(gallery)[0] === '80%' && galleryBars.layers.find((l) => l.kind === 'chart').unit === 'k', [faces(gallery), galleryBars.recipe.fields.unit]);
  const cleared = setFields(gallery, { suffix: '' }, 2);
  ok('a suffix the person clears stays cleared', faces(cleared)[0] === '80' && faces(setLang(cleared, 'ar', 3))[0].indexOf('\u066A') < 0, faces(cleared));
  const odd = ['Infinity', '\uFF18\uFF17', '', 'N/A'].map((value) => plan('a big number for our patients', { recipe: 'big-number', fields: { value, label: 'patients' } }));
  ok('a figure that is no number, or none the person gave, shows the example and says so', odd.every((m) => values(m)[0] === 80 && planned(m)), odd.map((m) => [values(m), planned(m)]));
}

// ── cost ──────────────────────────────────────────────────────────────────
console.log('cost');
{
  const row = Array.from({ length: 40_000 }, (_, i) => i + 1).join(',');
  numbersIn('1,2,3');
  const t0 = performance.now();
  const known = numbersIn(row);
  const dt = performance.now() - t0;
  ok(`every number of a 40,000-number pasted row is read in ${dt.toFixed(1)} ms`, known.has('39999') && dt < 50, dt);
  const t1 = performance.now();
  const lines = [
    sourcedFields('bar-chart', { items: '1' + ' '.repeat(100_000) + 'x' }, null, known, 'en'),
    sourcedFields('bar-chart', { items: ':'.repeat(100_000) + '7' }, null, known, 'en'),
    sourcedFields('big-number', { value: '1' + ' '.repeat(100_000) + 'x', suffix: '1' + ' '.repeat(100_000) + 'x' }, null, known, 'en'),
  ];
  const dt1 = performance.now() - t1;
  ok(`list lines and values 100,000 characters long, full of spaces or colons, are checked in ${dt1.toFixed(1)} ms`, dt1 < 50 && lines.every((s) => typeof s.sampled === 'boolean'), dt1);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
