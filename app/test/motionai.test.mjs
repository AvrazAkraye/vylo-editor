// The model's side of the Motion studio: what it is told, and how its answer
// is read. No model is called: every request here goes to a fake.
//
// What matters. The prompt is written from the tables — every template, field,
// palette and word of the vocabulary is in it, one added to a table is in it
// the next time it is written — and it stays inside its budget. An answer is
// found however it is dressed (a fence, prose around it, a trailing comma,
// curly quotes, cut off) and read as a template and its words, as free
// layers, or both; one with nothing to draw is an error with a code, never a
// guess. The person's choices beat the model's; the model's language holds
// unless its words are in the other script. Nothing the model wrote reaches the
// graphic unread: no picture from an address, no `__proto__`, no more layers
// than the limit, no id, error or time of its own. A number the person did
// not give never shows as a fact: it becomes an example and `planned` says so.
// And asking passes the prompt, the signal and the effort through, stops with
// an AbortError, and lets the request's own error through.
//
// Needs .test-build/{motionai,motionchatops,motionread,motiontemplates,motiontypes}.js.
import {
  META, PALETTES, objectIn, parsePlan, planMotion, planSystem, planUser, planned, refineMotion, refineSystem, refineUser,
} from '../.test-build/motionai.js';
import { OPS, OP_GUIDE } from '../.test-build/motionchatops.js';
import { readMotion } from '../.test-build/motionread.js';
import { sampleFields } from '../.test-build/motiontemplates.js';
import {
  BACKDROPS, CHARTS, DIRS, EASES, EFFECTS, ICON_IDS, LIMITS, LOOPS, PARTICLES, PINS, SHAPES, SPLITS, TONES, VOICES,
} from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** The code a failed read throws, or 'no error'. */
const thrown = (f) => {
  try {
    f();
    return 'no error';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

const NOW = 1_700_000_000_000;
const REQ = { request: 'A title for the opening of our bakery in Erbil', lang: 'en', format: null, seconds: null, palette: null, recipe: null };
const CLEAN = {
  title: 'Bakery opening', lang: 'en', recipe: 'big-title',
  fields: { kicker: 'New', title: 'Fresh bread every morning', subtitle: 'Now open in Erbil' }, palette: 'sunset', format: 'portrait', seconds: 8,
};
const plan = (answer, req = REQ, id = 'g1') => parsePlan(typeof answer === 'string' ? answer : JSON.stringify(answer), req, { id, now: NOW });
const sunset = PALETTES.find((p) => p.id === 'sunset').colors;
const lower = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.toLowerCase()]));

// ── the prompt ────────────────────────────────────────────────────────────
{
  const s = planSystem();
  const recipes = Object.values(META);
  const missing = [
    ...recipes.map((r) => r.id), ...recipes.flatMap((r) => r.fields.map((f) => f.key)), ...PALETTES.map((p) => p.id),
  ].filter((w) => !s.includes(w));
  ok('every template, every field and every palette is in the prompt', missing.length === 0, missing);
  ok('every template\'s hint and limit is in it', recipes.every((r) => r.fields.every((f) => s.includes(f.hint) && s.includes(`≤${f.max}`))));
  const words = [...EFFECTS, ...EASES, ...PINS, ...VOICES, ...BACKDROPS, ...LOOPS, ...SHAPES, ...CHARTS, ...PARTICLES, ...DIRS, ...SPLITS, ...TONES, ...ICON_IDS];
  const lines = s.split('\n');
  const listed = (list, label) => lines.some((l) => l.includes(`${label}: ${list.join(' ')}`));
  ok('every effect, ease, pin, voice and backdrop word is in it', words.every((w) => s.includes(w)) && listed(EFFECTS, 'fx') && listed(EASES, 'ease')
    && s.includes(PINS.join(' ')) && listed(VOICES, 'voice') && listed(BACKDROPS, 'backdrop style'), words.filter((w) => !s.includes(w)));
  ok('the loops, shapes, charts, particles, directions, splits, tones and icons too',
    listed(LOOPS, 'loop fx') && listed(SHAPES, 'shape') && listed(CHARTS, 'chart') && listed(PARTICLES, 'particles style') && listed(DIRS, 'dir')
    && listed(SPLITS, 'by') && s.includes(TONES.join(' ')) && listed(ICON_IDS, 'icon'));
  ok('overlays are marked as overlays', recipes.filter((r) => r.overlay).every((r) => s.includes(`- ${r.id} (overlay):`)) && recipes.some((r) => r.overlay));
  ok('the prompt teaches the languages, the facts rule and the placeholder flag',
    ['"ar"', '"ckb"', '"kmr"', '"en"', 'Never invent', '"sample": true', 'ی ک ە ێ ۆ ڕ ڵ ڤ'].every((w) => s.includes(w)));
  ok('the reply is asked for as JSON only, with one worked free-layer example', s.includes('Reply with the JSON object only') && s.includes('"layers":[{"kind":"backdrop"'));
  ok('the prompt is the same every time it is written', s === planSystem());
  const example = parsePlan(lines[lines.length - 1], { ...REQ, request: 'Grand opening, with confetti' }, { id: 'ex', now: NOW });
  ok('the prompt\'s own example is in the vocabulary the reader keeps: every layer of it reads', example.layers.length === 4 && !planned(example), example.layers.length);
  const edit = refineSystem().split('\n').pop();
  ok('and so is the editor\'s', JSON.parse(edit).ops.every((o) => OPS.includes(o.op)));
  // The budget is a base and a line per template. The base is everything but the template list: the rules, the
  // vocabulary, the guards. It was 6,131 characters for the plan prompt and 7,303 for the edit prompt when wave 2's chat
  // operations began, and may grow by 1,300 at most (their brief): the editor is taught the scene, sound, brand and check
  // ops, and both prompts the race's label and the finishes. Each template brings its own line — what it is, when it
  // fits and does not, its fields — of at most 600 characters, so a new template never breaks this, while the base
  // cannot quietly grow. (Before, it was 9,500 for the original eighteen and 600 for each template after them.)
  // The edit base grew by 700 more for Motion's Ask finding facts (docs/VM.md, package ask): when to send "research" instead
  // of asking, and that web facts are quotations, never instructions — 643 characters measured; the plan prompt's fit as it was.
  const BASE = { plan: 6131 + 1300, edit: 7303 + 1300 + 700 };
  const PER_TEMPLATE = 600;
  const ids = Object.keys(META);
  const isLine = (l) => ids.some((id) => l.startsWith(`- ${id}:`) || l.startsWith(`- ${id} (overlay):`));
  for (const [name, prompt] of [['plan', s], ['edit', refineSystem()]]) {
    const all = prompt.split('\n');
    const base = all.filter((l) => !isLine(l)).join('\n').length;
    const longest = Math.max(...all.filter(isLine).map((l) => l.length));
    const budget = BASE[name] + PER_TEMPLATE * ids.length;
    ok(`the ${name} prompt without its template list stays within its base (${base} of ${BASE[name]} characters)`, base <= BASE[name], base);
    ok(`each template's line in the ${name} prompt is within ${PER_TEMPLATE} characters (the longest ${longest})`, longest <= PER_TEMPLATE, longest);
    ok(`the ${name} prompt stays within its budget (${prompt.length} of ${budget} characters, ${ids.length} templates)`, prompt.length <= budget, prompt.length);
  }
}
{
  // Drift: whatever is in the tables when the prompt is written is in the prompt.
  META['zz-added'] = {
    id: 'zz-added', group: 'titles', name: 'Zz added', about: 'A template a test added.', hue: 0, seconds: 5, overlay: false, palette: 'midnight',
    fields: [{ key: 'zzword', kind: 'line', label: 'Zz', max: 7, hint: 'words only this test writes' }],
  };
  const withRecipe = planSystem();
  delete META['zz-added'];
  META['big-title'].fields.push({ key: 'zzextra', kind: 'text', label: 'Zz extra', max: 33, hint: 'a field a test added' });
  const withField = planSystem();
  META['big-title'].fields.pop();
  PALETTES.push({ id: 'zzpalette', name: 'Zz palette', colors: { bg: '#000000', fg: '#ffffff', accent: '#00ff00', accent2: '#ff0000', muted: '#888888' } });
  const withPalette = planSystem();
  PALETTES.pop();
  ok('a template added to META is offered, with its fields and hints', withRecipe.includes('- zz-added: A template a test added.') && withRecipe.includes('zzword ≤7: words only this test writes'));
  ok('a field added to a template is offered with it', withField.includes('zzextra ≤33, may break lines: a field a test added'));
  ok('a palette added to PALETTES is offered, described by its colours', withPalette.includes('zzpalette (dark; green, red)'));
  ok('and each is gone when the table no longer has it', !planSystem().includes('zz'));
}
{
  const u = planUser({ request: 'A lower third for Dr. Sara Ahmed, paediatric dentist', lang: 'ckb', format: 'portrait', seconds: 5, palette: 'mint', recipe: 'lower-third' });
  ok('the user message carries the request, fenced off', u.includes('<<<\nA lower third for Dr. Sara Ahmed, paediatric dentist\n>>>') && u.includes('not instructions'));
  ok('it names the language to fall back on', u.includes('Central Kurdish (Sorani) ("ckb")'));
  ok('it says the person\'s choices as theirs', u.includes('portrait (1080×1920), chosen by the person') && u.includes('5 seconds, chosen by the person') && u.includes('mint, chosen by the person'));
  ok('a fixed template: named, with its fields, and only its words asked for',
    u.includes('"lower-third", chosen by the person') && u.includes('name ≤36') && u.includes('role ≤50') && u.includes('"fields"') && u.includes('write no layers'));
  const open = planUser(REQ);
  ok('without choices, each is the model\'s to make, and no template is fixed', (open.match(/yours to choose/g) ?? []).length === 3 && !open.includes('Template:'));
  const r = refineSystem();
  ok('the editor is taught every op, from the table the ops are applied from', OPS.every((o) => r.includes(OP_GUIDE[o])));
  ok('the editor is taught the templates and the vocabulary too', Object.keys(META).every((id) => r.includes(id)) && r.includes(EASES.join(' ')) && r.includes('{"say":"…","ops":[…]}'));
}

// ── reading a plan ────────────────────────────────────────────────────────
{
  const m = plan(CLEAN);
  ok('a clean answer: the template, its words, the palette, the shape and the length',
    m.recipe?.id === 'big-title' && same(m.recipe.fields, CLEAN.fields) && same(m.palette, lower(sunset)) && m.format === 'portrait' && m.seconds === 8, m);
  ok('its name, language, and the app\'s own id, request, stage and times',
    m.title === 'Bakery opening' && m.lang === 'en' && m.id === 'g1' && m.request === REQ.request && m.stage === 'ready' && m.ai === true
    && m.created === NOW && m.updated === NOW && m.error === undefined);
  ok('it is a fixed point of the reader', same(readMotion(m, NOW), m));
  const json = JSON.stringify(CLEAN);
  ok('in a code fence', same(plan('```json\n' + json + '\n```'), m));
  ok('with prose before and after', same(plan(`Sure! Here is the graphic:\n\n${json}\n\nLet me know if you want changes {or not}.`), m));
  ok('with trailing commas and a raw line break in a string',
    plan('{"recipe":"big-title","fields":{"kicker":"New","title":"Fresh\nbread",},"palette":"sunset",}').recipe?.fields.title === 'Fresh\nbread');
  const curly = plan('{“recipe”: “lower-third”, “fields”: {“name”: “Sara Ahmed”, “role”: “Dentist”}}');
  ok('with curly quotes for JSON\'s own', curly.recipe?.id === 'lower-third' && curly.recipe.fields.name === 'Sara Ahmed', curly.recipe);
  const quoted = plan('{"recipe":"quote","fields":{"quote":"Bread is “life” here","author":"Grandma"}}');
  ok('curly quotes inside a string are kept as written', quoted.recipe?.fields.quote === 'Bread is “life” here');
  const cut = plan('{"title":"Cut short","lang":"en","palette":"neon","layers":[{"kind":"text","text":"One"},{"kind":"text","text":"Two"},{"kind":"shape","sha');
  ok('an answer cut off keeps the layers written in full', cut.layers.length === 2 && cut.layers[1].text === 'Two' && cut.title === 'Cut short', cut.layers.length);
  const cutFields = plan('{"title":"Bakery","recipe":"big-title","fields":{"kicker":"New","title":"Fresh bread"},"palette":"sunset","format":"portr');
  ok('a plan cut off after its fields is the plan, not the fields inside it',
    cutFields.recipe?.id === 'big-title' && cutFields.recipe.fields.title === 'Fresh bread' && cutFields.title === 'Bakery' && cutFields.palette.accent === sunset.accent.toLowerCase(), cutFields);
}
{
  const f = plan({ fields: { name: 'Dr. Sara Ahmed', role: 'Paediatric dentist' } });
  ok('fields alone: the template they fill is the one meant', f.recipe?.id === 'lower-third' && f.recipe.fields.role === 'Paediatric dentist');
  const flat = plan('{"name":"Dr. Sara Ahmed","role":"Paediatric dentist"}');
  const titled = plan('{"title":"Big sale","subtitle":"Half off everything","kicker":"Today"}');
  ok('fields written at the top level, with no template named, too', flat.recipe?.id === 'lower-third' && titled.recipe?.id === 'big-title', titled.recipe);
  ok('a title alone names no template', thrown(() => plan('{"title":"Hello"}')) === 'motion:unreadable-plan');
  const fixed = plan({ title: 'Opening', fields: { title: 'Grand opening', subtitle: 'This Friday' } }, { ...REQ, recipe: 'intro' });
  ok('a template the person chose is the one used, whatever the answer says', fixed.recipe?.id === 'intro' && fixed.recipe.fields.subtitle === 'This Friday');
  const stray = plan({ recipe: 'big-title', fields: { title: 'Grand opening', subtitle: 'Friday' }, layers: [{ kind: 'particles' }] }, { ...REQ, recipe: 'intro' });
  const plainIntro = plan({ recipe: 'big-title', fields: { title: 'Grand opening', subtitle: 'Friday' } }, { ...REQ, recipe: 'intro' });
  ok('and it stays a template: layers the model added anyway are not taken (the same layers as without them)',
    stray.recipe?.id === 'intro' && stray.layers.map((l) => l.id).join() === plainIntro.layers.map((l) => l.id).join());
  const l = plan({ layers: [{ kind: 'text', text: 'Hello' }, { kind: 'particles', style: 'confetti' }] });
  ok('layers alone: a free composition with the defaults filled in',
    !l.recipe && l.layers.length === 2 && l.layers[0].text === 'Hello' && l.seconds === 6 && l.format === 'landscape' && same(l.palette, lower(PALETTES[0].colors)) && l.lang === 'en', l);
  const bare = plan('[{"kind":"text","text":"Only layers"},{"kind":"backdrop","style":"grid"}]');
  ok('a bare list of layers is read as the layers', bare.layers.length === 2 && bare.layers[1].style === 'grid');
  const both = plan({ ...CLEAN, layers: [{ kind: 'particles', style: 'confetti' }] });
  const alone = plan(CLEAN);
  ok('a template and layers: the layers go on top, and it is no longer a template (a rebuild would lose them)',
    !both.recipe && both.layers.length === alone.layers.length + 1 && both.layers[both.layers.length - 1].kind === 'particles');
  ok('same answer, same graphic: layer ids are the answer\'s own or made from their place, never random',
    same(plan({ layers: [{ kind: 'text', text: 'A' }, { kind: 'text', text: 'B', id: 'mine' }] }).layers.map((x) => x.id), ['text-1', 'mine']));
}
{
  for (const junk of ['Sorry, I cannot make that.', '', '{"foo":1}', '{"layers":[{"kind":"nope"}]}', '[1,2,3]', '{"layers":[]}', 'null']) {
    ok(`nothing to draw is an error with a code: ${JSON.stringify(junk).slice(0, 36)}`, thrown(() => plan(junk)) === 'motion:unreadable-plan');
  }
  ok('an answer that is not text is an error too', thrown(() => parsePlan(undefined, REQ, { id: 'x', now: NOW })) === 'motion:unreadable-plan');
}
{
  const long = plan({ recipe: 'big-title', fields: { kicker: 'A small label that runs on and on well past its forty characters', title: 'word '.repeat(80), subtitle: 'x' } });
  ok('words past a field\'s limit are cut to it, at a word', Array.from(long.recipe.fields.kicker).length <= 40 && Array.from(long.recipe.fields.title).length <= 90
    && !long.recipe.fields.kicker.endsWith(' '), long.recipe.fields);
  const items = plan({ recipe: 'steps', fields: { title: 'How', items: Array.from({ length: 20 }, (_, i) => `Step ${i}`) } });
  ok('a list given as an array is one item a line, at most its limit', items.recipe.fields.items.split('\n').length === META.steps.fields.find((f) => f.key === 'items').max);
  const objs = plan({ recipe: 'bar-chart', fields: { title: 'Sales', items: [{ label: 'Q1', value: 40 }] } }, { ...REQ, request: 'sales 40' });
  ok('a list of {label, value} is "Label: value" lines', objs.recipe.fields.items === 'Q1: 40', objs.recipe.fields);
}
{
  const hostile = '{"__proto__":{"polluted":1},"id":"someone-elses-graphic","error":"boom","stage":"planning","created":5,"updated":6,"request":"not this",'
    + '"recipe":"big-title","fields":{"__proto__":{"polluted":2},"constructor":"x","title":"Hi"}}';
  const h = plan(hostile);
  ok('a hostile answer pollutes nothing', ({}).polluted === undefined && Object.getPrototypeOf(h) === Object.prototype);
  ok('and its id, error, stage, times and request are not the graphic\'s',
    h.id === 'g1' && h.error === undefined && h.stage === 'ready' && h.created === NOW && h.updated === NOW && h.request === REQ.request, h);
  ok('its field keys are the template\'s own only', !has(h.recipe.fields, '__proto__') && !has(h.recipe.fields, 'constructor') && h.recipe.fields.title === 'Hi');
  const layered = plan('{"layers":[{"kind":"text","text":"x","__proto__":{"evil":1},"constructor":{"prototype":{"evil":2}}}]}');
  ok('a hostile layer is read as a layer, and nothing more', layered.layers.length === 1 && ({}).evil === undefined);
  const pics = plan({ layers: [{ kind: 'image', src: 'https://evil.example/a.png' }, { kind: 'image', src: 'file:///etc/passwd' }, { kind: 'text', text: 'safe' }] });
  ok('a picture from an address is never taken', pics.layers.length === 1 && !JSON.stringify(pics).includes('evil.example') && !JSON.stringify(pics).includes('file:'));
  const many = plan({ layers: Array.from({ length: 500 }, (_, i) => ({ kind: 'text', text: `L${i}` })) });
  ok(`five hundred layers are ${LIMITS.layers}, each with its own id`, many.layers.length === LIMITS.layers && new Set(many.layers.map((x) => x.id)).size === LIMITS.layers);
  const empty = plan({ layers: [{ kind: 'chart', data: [] }, { kind: 'chart', data: 'none' }, { kind: 'text', text: 'kept' }] });
  ok('a chart with no numbers is dropped rather than drawn empty', empty.layers.length === 1 && empty.layers[0].kind === 'text');
}
{
  const m = plan({ ...CLEAN, format: 'portrait', seconds: 12, palette: 'neon' }, { ...REQ, format: 'square', seconds: 5, palette: 'mint' });
  ok('the person\'s shape, length and palette beat the model\'s',
    m.format === 'square' && m.seconds === 5 && same(m.palette, lower(PALETTES.find((p) => p.id === 'mint').colors)), [m.format, m.seconds]);
  const own = plan({ ...CLEAN, palette: { bg: '#101010', accent: '#FF00AA' } });
  ok('a palette the model wrote as colours is read over the template\'s own', own.palette.bg === '#101010' && own.palette.accent === '#ff00aa');
  const none = plan({ recipe: 'lower-third', fields: { name: 'A', role: 'B' } });
  ok('with no palette or length named, the template\'s own', same(none.palette, lower(PALETTES.find((p) => p.id === META['lower-third'].palette).colors))
    && none.seconds === META['lower-third'].seconds);
}
{
  const ar = plan({ lang: 'ar', recipe: 'big-title', fields: { title: 'خبز طازج كل صباح' } });
  ok('the language is the answer\'s', ar.lang === 'ar');
  ok('with no language in the answer, the request\'s: the interface language settles it',
    plan({ recipe: 'big-title', fields: { title: 'خبز طازج' } }, { ...REQ, lang: 'kmr' }).lang === 'kmr'
    && plan({ recipe: 'big-title', fields: { title: 'Fresh bread' } }).lang === 'en');
  ok('Arabic words under "en" are drawn right to left, as Arabic', plan({ lang: 'en', recipe: 'big-title', fields: { title: 'خبز طازج كل صباح' } }).lang === 'ar');
  ok('Kurdish words under "en" are Kurdish', plan({ lang: 'en', recipe: 'big-title', fields: { title: 'نانی گەرم هەموو بەیانییەک' } }).lang === 'ckb');
  ok('English words under "ar" are English', plan({ lang: 'ar', recipe: 'big-title', fields: { title: 'Fresh bread' } }).lang === 'en');
  const k = plan({ lang: 'ckb', recipe: 'big-title', fields: { title: 'نانی گەرمي بەيانی' } });
  ok('Kurdish words are spelled with Kurdish letters', k.recipe.fields.title === 'نانی گەرمی بەیانی', k.recipe.fields.title);
  ok('the language by name is read too', plan({ lang: 'Arabic', recipe: 'big-title', fields: { title: 'مرحبا' } }).lang === 'ar');
}
{
  const plain = plan({ recipe: 'lower-third', fields: { name: 'Dr. Sara Ahmed', role: 'Dentist' } });
  ok('no title in the answer: the template\'s words name it', plain.title === 'Dr. Sara Ahmed', plain.title);
  ok('free layers: the first words on screen name it', plan({ layers: [{ kind: 'shape' }, { kind: 'text', text: 'Big day\nsecond line' }] }).title === 'Big day');
  ok('with no words at all, the request\'s first words', plan({ layers: [{ kind: 'shape' }] }).title === 'A title for the opening of');
}

// ── numbers nobody gave ───────────────────────────────────────────────────
{
  const req = { ...REQ, request: 'A big number for the patients our clinic treated' };
  const m = plan({ recipe: 'big-number', fields: { value: '8731', suffix: '+', label: 'Patients treated' } }, req);
  const example = sampleFields('big-number', 'en').value ?? '';
  ok('a number the request did not give is replaced by the template\'s example', m.recipe.fields.value !== '8731' && m.recipe.fields.value === example, m.recipe.fields);
  ok('and `planned` says the graphic shows examples', planned(m) === true);
  ok('`planned` is about that graphic: a copy, or a graphic planned from given numbers, is not', !planned({ ...m }) && !planned(plan(CLEAN)) && !planned(null));
  const eastern = plan({ lang: 'ar', recipe: 'big-number', fields: { value: '87', suffix: '%', label: 'من المرضى راضون' } }, { ...REQ, lang: 'ar', request: 'رقم كبير: ٨٧٪ من المرضى راضون' });
  ok('a number in Arabic-Indic digits in the request, written in Latin digits, was given', eastern.recipe.fields.value === '87' && !planned(eastern), eastern.recipe.fields);
  const grouped = plan({ recipe: 'big-number', fields: { value: '1200', label: 'Students' } }, { ...REQ, request: 'We have 1,200 students' });
  const k = plan({ recipe: 'big-number', fields: { value: '3000', label: 'Followers' } }, { ...REQ, request: 'Celebrate 3k followers' });
  ok('"1,200" in the request is 1200; "3k" is not 3000', grouped.recipe.fields.value === '1200' && !planned(grouped) && k.recipe.fields.value !== '3000' && planned(k));
  const eastAnswer = plan({ recipe: 'big-number', fields: { value: '١٬٢٠٠', label: 'Students' } }, { ...REQ, request: 'We have 1200 students' });
  ok('a number field is written in one spelling', eastAnswer.recipe.fields.value === '1200', eastAnswer.recipe.fields);
  const chart = plan({ recipe: 'bar-chart', fields: { title: 'Sales', items: 'Q1: 40\nQ2: 55\nQ3: 7313', unit: '%' } }, { ...REQ, request: 'Sales: 40 in Q1 and 55 in Q2' });
  const lines = chart.recipe.fields.items.split('\n');
  ok('a chart keeps the values given and replaces the one invented, keeping its label',
    lines[0] === 'Q1: 40' && lines[1] === 'Q2: 55' && lines[2].startsWith('Q3:') && !lines[2].includes('7313') && planned(chart), lines);
  const said = plan({ recipe: 'big-title', fields: { title: 'Your headline here' }, sample: true });
  ok('an answer that says it wrote placeholders is `planned` too', planned(said));
  const count = plan({ layers: [{ kind: 'counter', to: 5000, suffix: '+' }, { kind: 'chart', data: [{ label: 'A', value: 12 }, { label: 'B', value: 40 }] }] }, { ...REQ, request: 'our 40 branches' });
  ok('free layers too: a counter and a chart show only numbers given, or placeholders',
    count.layers[0].to !== 5000 && count.layers[1].data[0].value !== 12 && count.layers[1].data[1].value === 40 && planned(count), count.layers.map((l) => l.to ?? l.data));
  const countdown = plan({ recipe: 'countdown', fields: { from: '10', final: 'GO' } }, { ...REQ, request: 'a countdown from 10 for the launch' });
  ok('a countdown starts where the request said', countdown.recipe.fields.from === '10' && !planned(countdown));
}

// ── fuzz: whatever the model answers ─────────────────────────────────────
{
  let seed = 7_2026;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const leaf = () => pick([null, 0, -7, 1e308, 'x', '', '٨٧', '1,200', 'https://evil.example/a.png', 'big-title', 'lower-third', 'sunset', 'ar', 'portrait', true, 12, 'text', 'chart', 'counter', '__proto__']);
  const value = (depth) => {
    const r = rnd();
    if (depth > 3 || r < 0.4) return leaf();
    if (r < 0.6) return Array.from({ length: Math.floor(rnd() * 4) }, () => value(depth + 1));
    const o = {};
    for (let i = 0, n = Math.floor(rnd() * 5); i < n; i++) {
      Object.defineProperty(o, pick(['recipe', 'fields', 'layers', 'kind', 'text', 'title', 'value', 'items', 'palette', 'lang', 'format', 'seconds', 'to', 'data', 'src', 'sample', '__proto__', 'id', 'error']), { value: value(depth + 1), enumerable: true, writable: true, configurable: true });
    }
    return o;
  };
  const layer = () => ({
    kind: pick(['text', 'shape', 'chart', 'counter', 'image', 'particles', 'backdrop', 'icon', 'nope']), text: leaf(), to: leaf(), data: value(2), src: leaf(),
    x: leaf(), size: leaf(), in: value(2), loop: leaf(), id: pick(['a', 'a', 'b', leaf()]),
  });
  const planish = () => ({
    recipe: pick(['big-title', 'lower-third', 'bar-chart', 'big-number', 'stats', 'countdown', 'nope', undefined]), fields: value(1),
    layers: rnd() < 0.5 ? Array.from({ length: Math.floor(rnd() * 5) }, layer) : undefined, palette: leaf(), lang: leaf(), format: leaf(), seconds: leaf(), sample: leaf(),
  });
  const dress = (json) => pick([json, '```json\n' + json + '\n```', `Here you go: ${json} Enjoy.`, json.slice(0, Math.floor(json.length * rnd())), json.replace(/"/g, pick(['"', '“']))]);
  let bad = 0;
  let drawn = 0;
  for (let i = 0; i < 200; i++) {
    const text = dress(JSON.stringify(rnd() < 0.6 ? planish() : value(0)) ?? 'null');
    try {
      const m = parsePlan(text, REQ, { id: 'f', now: NOW });
      drawn++;
      // An address may be words on screen (drawn as letters, never fetched); a picture is only ever a data: URL.
      const fetches = m.layers.some((l) => l.kind === 'image' && !l.src.startsWith('data:image/'));
      if (!same(readMotion(m, NOW), m) || m.id !== 'f' || m.error !== undefined || m.layers.length > LIMITS.layers || fetches) bad++;
    } catch (e) {
      if (!(e instanceof Error) || e.message !== 'motion:unreadable-plan') bad++;
    }
  }
  ok(`200 random replies: each is a graphic the reader keeps as it is, or the unreadable code (${drawn} drawn)`, bad === 0 && drawn > 0, bad);
  ok('and no prototype was touched', ({}).polluted === undefined && Object.getPrototypeOf({}) === Object.prototype);
}

// ── asking ────────────────────────────────────────────────────────────────
const TARGET = { baseUrl: 'https://gateway.invalid', apiKey: 'test-key', wire: 'anthropic', model: 'claude-test' };
const BOOK = { 'claude-test': 'low' };
{
  let seen = null;
  let chars = -1;
  const ctl = new AbortController();
  const ask = async (target, system, user, o) => {
    seen = { target, system, user, o };
    o.onText?.(42);
    return JSON.stringify(CLEAN);
  };
  const m = await planMotion(TARGET, BOOK, REQ, { ask, signal: ctl.signal, onText: (n) => { chars = n; }, id: 'p1', now: NOW });
  ok('planMotion hands the asker the target, the prompt, the request, the signal and the effort',
    seen.target === TARGET && seen.system === planSystem() && seen.user === planUser(REQ) && seen.o.signal === ctl.signal && seen.o.book === BOOK && chars === 42);
  ok('and returns the graphic read from its answer', m.id === 'p1' && m.recipe?.id === 'big-title' && m.created === NOW);

  const stopped = new AbortController();
  stopped.abort();
  let called = false;
  const early = await planMotion(TARGET, BOOK, REQ, { ask: async () => { called = true; return JSON.stringify(CLEAN); }, signal: stopped.signal }).then(() => 'resolved', (e) => e?.name);
  ok('an aborted signal rejects with an AbortError, and asks nothing', early === 'AbortError' && !called, early);
  const midway = new AbortController();
  const late = await planMotion(TARGET, BOOK, REQ, { ask: async () => { midway.abort(); return JSON.stringify(CLEAN); }, signal: midway.signal }).then(() => 'resolved', (e) => e?.name);
  ok('a stop while the model answers rejects with an AbortError too', late === 'AbortError', late);
  const boom = new Error('The server answered 500: overloaded');
  const failed = await planMotion(TARGET, BOOK, REQ, { ask: async () => { throw boom; } }).then(() => 'resolved', (e) => e);
  ok('the asker\'s own error comes through as it was thrown', failed === boom);
  const unreadable = await planMotion(TARGET, BOOK, REQ, { ask: async () => 'I would rather not.' }).then(() => 'resolved', (e) => e?.message);
  ok('an answer with nothing to draw rejects with the code', unreadable === 'motion:unreadable-plan');
}
{
  const base = plan({ title: 'Promo', palette: 'mint', layers: [
    { kind: 'text', id: 'headline', name: 'Headline', text: 'Hello there', in: { fx: 'rise', d: 0.8 } },
    { kind: 'image', id: 'logo', src: 'data:image/png;base64,iVBORw0KGgo=' },
    { kind: 'text', id: 'long', text: 'word '.repeat(200) },
  ] }, { ...REQ, request: 'A promo for our shop' });
  const ask = (reply) => async () => reply;
  const r = await refineMotion(TARGET, BOOK, base, 'faster please', { ask: ask('Done!\n```json\n{"say":"It is faster now.","ops":[{"op":"speed","value":2}]}\n```'), now: NOW });
  ok('an edit: the ops applied, the sentence kept', r.said === 'It is faster now.' && r.notes.some((n) => n.code === 'speed')
    && r.motion.layers.find((l) => l.id === 'headline').in.d === 0.4 && same(readMotion(r.motion, NOW), r.motion), r);
  const bare = await refineMotion(TARGET, BOOK, base, 'rename it', { ask: ask('[{"op":"title","value":"Spring sale"}]'), now: NOW });
  ok('a bare list of ops is read as the ops', bare.motion.title === 'Spring sale' && bare.said === '');
  const question = await refineMotion(TARGET, BOOK, base, 'change it', { ask: ask('{"say":"Which part should change?","ops":[]}'), now: NOW });
  ok('an answer with no ops is not an error: nothing changes', question.motion === base && !question.notes.length && !question.skipped.length && question.said === 'Which part should change?');
  const nothing = await refineMotion(TARGET, BOOK, base, 'x', { ask: ask('{"say":"Done.","ops":[{"op":"explode"},{"op":"layer","id":"ghost","set":{"size":2}}]}'), now: NOW });
  ok('ops that cannot be applied are said, not an error', nothing.motion === base && !nothing.notes.length
    && same(nothing.skipped, [{ code: 'unknown', op: 'explode' }, { code: 'no-layer', op: 'layer', id: 'ghost' }]), nothing.skipped);
  const none = await refineMotion(TARGET, BOOK, base, 'x', { ask: ask('Sure, I made it faster for you.') }).then(() => 'resolved', (e) => e?.message);
  ok('a reply with no JSON at all is `motion:unreadable-edit`', none === 'motion:unreadable-edit', none);
  const loud = await refineMotion(TARGET, BOOK, base, 'x', { ask: ask(JSON.stringify({ say: `**Done!** I made it \`faster\`. ${'And more. '.repeat(40)}`, ops: [] })), now: NOW });
  ok('the sentence is plain words, at most 200 characters', !loud.said.includes('**') && !loud.said.includes('`') && Array.from(loud.said).length <= 200 && loud.said.startsWith('Done!'), loud.said);
  const numbers = plan({ recipe: 'big-number', fields: { value: '500', label: 'Customers' } }, { ...REQ, request: 'We have 500 customers' });
  const sampled = await refineMotion(TARGET, BOOK, numbers, 'make it a donut chart', { ask: ask('{"say":"Now a donut.","ops":[{"op":"recipe","id":"donut","fields":{"title":"Customers","items":"New: 300\\nReturning: 200"}}]}'), now: NOW });
  ok('an edit that puts in example numbers is `planned`, and says so', planned(sampled.motion) && sampled.notes.some((n) => n.code === 'sample') && !planned(numbers));
  const stop = new AbortController();
  stop.abort();
  const early = await refineMotion(TARGET, BOOK, base, 'x', { ask: ask('{"ops":[]}'), signal: stop.signal }).then(() => 'resolved', (e) => e?.name);
  ok('an aborted edit rejects with an AbortError', early === 'AbortError');
  let seen = null;
  await refineMotion(TARGET, BOOK, base, 'Make the title red', { ask: async (t, system, user, o) => { seen = { system, user, o }; return '{"ops":[]}'; } });
  ok('the editor is sent its prompt, the graphic and the message', seen.system === refineSystem() && seen.user === refineUser(base, 'Make the title red') && seen.o.book === BOOK);
  const u = refineUser(base, 'Make the title red');
  ok('the graphic is shown by its layers\' ids, settings and words; the message fenced off',
    u.includes('"id":"headline"') && u.includes('"name":"Headline"') && u.includes('Palette: mint') && u.includes('<<<\nMake the title red\n>>>')
    && u.includes('Template: none') && u.includes('A promo for our shop'));
  ok('never a picture\'s data, and long words trimmed', !u.includes('data:image') && !u.includes('word '.repeat(60)) && u.includes('…'));
  const t = refineUser(plan(CLEAN), 'shorter');
  ok('a template graphic is shown with its fields', t.includes('Template: "big-title"') && t.includes('"title":"Fresh bread every morning"'));
}

// ── finding JSON in a reply ───────────────────────────────────────────────
ok('objectIn: past braces inside strings', same(objectIn('text {"a":"}{"} more'), { a: '}{' }));
ok('objectIn: the first object the caller wants', same(objectIn('{"x":1} then {"recipe":"y"}', (o) => 'recipe' in o), { recipe: 'y' }));
ok('objectIn: nothing is null', objectIn('no json here') === null && objectIn('') === null && objectIn(undefined) === null && objectIn('{"a":') !== undefined);
ok('objectIn: an object cut off is closed where it can be, and a number that may not be finished is left out', same(objectIn('{"a":1,"b":[1,2'), { a: 1, b: [1] }));
ok('objectIn: an item of a list cut off is dropped whole; an object that is not one keeps what was written',
  same(objectIn('{"ops":[{"op":"speed","value":2},{"op":"recipe","fields":{"name":"Dr', (o) => Array.isArray(o.ops)), { ops: [{ op: 'speed', value: 2 }] })
  && same(objectIn('{"recipe":"big-title","fields":{"title":"Hi","subti'), { recipe: 'big-title', fields: { title: 'Hi' } }));

// ── a model draws no pictures ─────────────────────────────────────────────
{
  const svg = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctext%3E87%25 agree%3C/text%3E%3C/svg%3E';
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const m = plan({ recipe: 'big-title', fields: { title: 'Hello' }, layers: [{ kind: 'image', src: svg }, { kind: 'image', src: png, id: 'p2' }, { kind: 'shape' }] });
  ok('image layers in a plan are left out, whatever they hold', !m.layers.some((l) => l.kind === 'image'));
  const free = plan({ title: 'x', layers: [{ kind: 'image', src: svg }, { kind: 'text', text: 'Hi' }] });
  ok('a free composition keeps its other layers', free.layers.some((l) => l.kind === 'text') && !free.layers.some((l) => l.kind === 'image'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
