// Changing a motion graphic by asking: the ops the model answers with, and
// the one door they go through.
//
// What matters. Every op does what it says and nothing else, alone or several
// in one answer, and the answer is one graphic — one undo step — read once more
// so it is a fixed point of the reader. What is not an op, names a layer or a
// field that is not there, or would make something no reader keeps (a picture
// from an address, a number out of range) is skipped with a reason, never
// guessed at; nothing ever throws, whatever the model wrote (fuzzed below), and
// nothing handed in is changed (the inputs are frozen). A template stays one
// until a layer is edited by hand, and `recipe` starts again keeping the shape,
// length, palette and language. `speed` scales every timing and stays inside
// its limits. And a number nobody gave is never written as a fact: the field
// keeps its own, or an example stands in and says so.
//
// Needs .test-build/{motionchatops,motionread,motiontemplates,motiontypes}.js.
import {
  MAX_OPS, OPS, OP_GUIDE, applyOps, formatWord, langWord, numbersIn, paletteWord, recipeWord, sourcedFields
} from '../.test-build/motionchatops.js';
import { blankLayer, readMotion } from '../.test-build/motionread.js';
import { buildMotion, sampleFields } from '../.test-build/motiontemplates.js';
import { LIMITS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const codes = (list) => list.map((n) => n.code);

/** Freeze a value all the way down, so a mutation throws in strict mode. */
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}

const NOW = 1_700_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// A graphic edited by hand: every kind of layer, no template behind it.
const free = freeze(readMotion({
  id: 'g1', title: 'Hand made', request: 'A promo: 1200 students, 40 and 65 in the chart', lang: 'en', format: 'landscape', fps: 30,
  seconds: 6, palette: { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' }, backdrop: 'bg',
  stage: 'ready', created: 1, updated: 1,
  layers: [
    blankLayer('backdrop', { id: 'bg', name: 'Back', start: 0, end: 6, loop: { fx: 'float', d: 4, amount: 1 } }),
    blankLayer('text', { id: 'title', name: 'Title', text: 'Hello there', start: 0, end: 6, in: { fx: 'rise', d: 0.8, delay: 0.2, ease: 'expo-out', amount: 1, by: 'word', gap: 0.08 }, out: { fx: 'fade', d: 0.4, delay: 0, ease: 'in', amount: 1 } }),
    blankLayer('text', { id: 'sub', name: 'Subtitle', text: 'Welcome to the show', start: 0.5, end: 6 }),
    blankLayer('shape', { id: 'bar', name: 'Bar', start: 1, end: 4 }),
    blankLayer('counter', { id: 'num', name: 'Students', from: 0, to: 1200, start: 0, end: 6 }),
    blankLayer('chart', { id: 'chart', name: 'Chart', data: [{ label: 'A', value: 40 }, { label: 'B', value: 65 }], start: 0, end: 6 }),
    blankLayer('image', { id: 'pic', name: 'Logo', src: PNG, start: 0, end: 6 }),
  ],
}, NOW));

// A template graphic, and a hand-built graphic that still says it came from a template.
const tmpl = freeze(buildMotion({
  id: 't1', recipe: 'big-title', fields: { kicker: 'New', title: 'Fresh bread', subtitle: 'Every morning' }, lang: 'en', format: 'landscape', now: 1,
}));
const attached = freeze(readMotion({ ...JSON.parse(JSON.stringify(free)), id: 'a1', recipe: { id: 'big-title', fields: { kicker: 'New', title: 'Hello there', subtitle: 'Welcome' } } }, NOW));
const bigNumber = freeze(buildMotion({
  id: 'n1', recipe: 'big-number', fields: { value: '1200', label: 'Students' }, lang: 'en', format: 'landscape', now: 1,
  request: 'A big number: 1200 students',
}));
const bars = freeze(buildMotion({
  id: 'b1', recipe: 'bar-chart', fields: { title: 'Sales', items: 'A: 10\nB: 20' }, lang: 'en', format: 'landscape', now: 1,
  request: 'Sales were 10 and 20',
}));

/** An answer applied, and its result checked against the reader: the same graphic read again is itself. */
const results = [];
function apply(m, ops, said) {
  const before = JSON.stringify(m);
  const r = applyOps(m, ops, NOW, said);
  results.push({ name: JSON.stringify(ops).slice(0, 60), r, input: m, before });
  return r;
}

// ── the catalogue ─────────────────────────────────────────────────────────
ok('eleven ops, each with its line for the prompt', OPS.length === 11 && OPS.every((o) => typeof OP_GUIDE[o] === 'string' && OP_GUIDE[o].includes(`"op":"${o}"`)));
ok('at most twelve ops an answer', MAX_OPS === 12);
ok('words for a template, a palette, a language and a frame are read however they are written',
  recipeWord('Lower third') === 'lower-third' && recipeWord('big_title') === 'big-title' && recipeWord('nope') === null
  && paletteWord('Sunset')?.id === 'sunset' && paletteWord('rainbow') === null
  && langWord('Arabic') === 'ar' && langWord('ar-IQ') === 'ar' && langWord('Kurdish (Sorani)') === 'ckb' && langWord('badini') === 'kmr' && langWord('xx') === null
  && formatWord('9:16') === 'portrait' && formatWord('vertical') === 'portrait' && formatWord('square') === 'square' && formatWord('round') === null);

// ── numbers somebody gave ─────────────────────────────────────────────────
{
  const n = (s) => [...numbersIn(s)];
  ok('numbers in any grouping and any digits are the same numbers',
    numbersIn('1,200 students').has('1200') && numbersIn('١٬٢٠٠').has('1200') && numbersIn('٨٧٪').has('87') && numbersIn('۴۵').has('45')
    && numbersIn('12٫5').has('12.5') && numbersIn('1,234.5').has('1234.5') && numbersIn('2,5').has('2.5'), [n('1,200'), n('٨٧٪'), n('12٫5')]);
  ok('"3k" is 3, never 3000', numbersIn('3k followers').has('3') && !numbersIn('3k followers').has('3000'));
  ok('a date is its parts', numbersIn('29.09.2026').has('2026') && numbersIn('29.09.2026').has('29'));
  ok('no text, no numbers', numbersIn('').size === 0 && numbersIn(undefined).size === 0);
}

// ── each op ───────────────────────────────────────────────────────────────
{
  const r = apply(tmpl, [{ op: 'fields', set: { title: 'Warm bread' } }]);
  ok('fields: the template\'s words change, the rest stay, and it is still a template',
    r.motion.recipe?.id === 'big-title' && r.motion.recipe.fields.title === 'Warm bread' && r.motion.recipe.fields.kicker === 'New'
    && same(r.notes, [{ code: 'fields', keys: ['title'] }]) && !r.skipped.length, r);
  ok('fields keeps the graphic\'s id, name and creation', r.motion.id === 't1' && r.motion.title === tmpl.title && r.motion.created === tmpl.created && r.motion.updated === NOW);
  const k = apply(tmpl, [{ op: 'fields', set: { Title: 'By its label', colour: 'red' } }]);
  ok('fields: a key by its label reads, an unknown key is skipped by name',
    k.motion.recipe?.fields.title === 'By its label' && same(k.skipped, [{ code: 'no-field', op: 'fields', field: 'colour' }]), k);
  const d = apply(free, [{ op: 'fields', set: { title: 'x' } }]);
  ok('fields on a graphic that is no longer a template: skipped, nothing changes', d.motion === free && same(d.skipped, [{ code: 'not-template', op: 'fields' }]));
  const flat = apply(tmpl, [{ op: 'fields', subtitle: 'Written flat' }]);
  ok('fields written flat on the op still read', flat.motion.recipe?.fields.subtitle === 'Written flat');
}
{
  const r = apply(tmpl, [{ op: 'palette', id: 'sunset' }]);
  ok('palette by id: its colours, said by name; the template stays one',
    r.motion.palette.accent === '#ff7a45' && same(r.notes, [{ code: 'palette', id: 'sunset', name: 'Sunset' }]) && r.motion.recipe?.id === 'big-title', r.notes);
  const c = apply(free, [{ op: 'palette', colors: { accent: '#FF0000', text: '#111111' } }]);
  ok('palette by colours: only those change, and the note says which',
    c.motion.palette.accent === '#ff0000' && c.motion.palette.fg === '#111111' && c.motion.palette.bg === free.palette.bg
    && same(c.notes, [{ code: 'colors', tones: ['fg', 'accent'] }]), c.notes);
  const bad = apply(free, [{ op: 'palette', id: 'rainbow' }, { op: 'palette', colors: { accent: 'reddish' } }]);
  ok('a palette that is not one, or colours that are not colours: skipped (and the same reason is said once)', bad.motion === free && same(bad.skipped, [{ code: 'invalid', op: 'palette' }]), bad.skipped);
  const sameOne = apply(tmpl, [{ op: 'palette', id: 'midnight' }]);
  ok('the palette it already has changes nothing and says nothing', sameOne.motion === tmpl && !sameOne.notes.length && !sameOne.skipped.length);
}
{
  const r = apply(free, [{ op: 'seconds', value: 8 }]);
  ok('seconds: the length changes, and layers that ran to the end still do',
    r.motion.seconds === 8 && r.motion.layers.find((l) => l.id === 'title').end === 8 && r.motion.layers.find((l) => l.id === 'bar').end === 4
    && same(r.notes, [{ code: 'seconds', value: 8 }]), r.notes);
  const t = apply(tmpl, [{ op: 'seconds', value: '12s' }]);
  ok('seconds on a template rebuilds it at that length', t.motion.seconds === 12 && t.motion.recipe?.id === 'big-title');
  const clamp = apply(free, [{ op: 'seconds', value: 400 }]);
  ok('a length past the limit is the limit', clamp.motion.seconds === LIMITS.seconds);
  const bad = apply(free, [{ op: 'seconds', value: 'soon' }, { op: 'seconds', value: -3 }]);
  ok('a length that is not one is skipped', bad.motion === free && same(bad.skipped, [{ code: 'invalid', op: 'seconds' }]), bad.skipped);
}
{
  const r = apply(tmpl, [{ op: 'format', value: '9:16' }]);
  ok('format: the frame changes (by name or ratio), a template stays one', r.motion.format === 'portrait' && r.motion.recipe?.id === 'big-title' && same(r.notes, [{ code: 'format', value: 'portrait' }]));
  ok('format that is not one: skipped', apply(free, [{ op: 'format', value: 'round' }]).skipped[0]?.code === 'invalid');
}
{
  const r = apply(free, [{ op: 'title', value: '  Spring   promo ' }]);
  ok('title: renamed, tidied', r.motion.title === 'Spring promo' && same(r.notes, [{ code: 'title', value: 'Spring promo' }]));
  ok('an empty title is skipped', apply(free, [{ op: 'title', value: '   ' }]).skipped[0]?.code === 'invalid');
}
{
  // A language changes the direction, not the words: only with the words rewritten in it.
  const words = { title: 'مرحباً بكم', sub: 'أهلاً وسهلاً في العرض' };
  const r = apply(free, [
    { op: 'lang', value: 'ar' },
    { op: 'layer', id: 'title', set: { text: words.title } },
    { op: 'layer', id: 'sub', set: { text: words.sub } },
  ]);
  ok('lang with every text rewritten in it: applied', r.motion.lang === 'ar' && r.notes[0]?.code === 'lang' && r.motion.layers.find((l) => l.id === 'sub').text === words.sub, r.notes);
  const alone = apply(free, [{ op: 'lang', value: 'ar' }]);
  ok('lang with the words left in English: refused, nothing changes', alone.motion === free && same(alone.skipped, [{ code: 'untranslated', value: 'ar' }]));
  const t = apply(tmpl, [{ op: 'fields', set: { kicker: 'جديد', title: 'خبز طازج', subtitle: 'كل صباح' } }, { op: 'lang', value: 'Arabic' }]);
  ok('a template\'s lang with its fields rewritten: applied, and still a template', t.motion.lang === 'ar' && t.motion.recipe?.fields.title === 'خبز طازج', t.skipped);
  const viaLayers = apply(attached, [{ op: 'lang', value: 'ar' }, { op: 'layer', id: 'title', set: { text: words.title } }, { op: 'layer', id: 'sub', set: { text: words.sub } }]);
  ok('a template\'s lang with its text layers rewritten instead: applied too (and it is no longer a template)',
    viaLayers.motion.lang === 'ar' && !viaLayers.motion.recipe && viaLayers.notes[0]?.code === 'lang', viaLayers.skipped);
  const stillEnglish = apply(tmpl, [{ op: 'lang', value: 'ar' }]);
  ok('a template\'s lang with nothing rewritten: refused', stillEnglish.motion === tmpl && same(stillEnglish.skipped, [{ code: 'untranslated', value: 'ar' }]));
  const k = apply(tmpl, [{ op: 'lang', value: 'ckb' }, { op: 'fields', set: { kicker: 'نوێ', title: 'نانی گەرم', subtitle: 'هەموو بەیانیيەک' } }]);
  ok('Kurdish words are written with Kurdish letters (ي becomes ی)', k.motion.lang === 'ckb' && k.motion.recipe?.fields.subtitle === 'هەموو بەیانییەک', k.motion.recipe?.fields);
}
{
  const r = apply(free, [{ op: 'layer', id: 'title', set: { size: 12, color: 'accent', in: { d: 0.4 } } }]);
  const t = r.motion.layers.find((l) => l.id === 'title');
  ok('layer: fields change, and an entrance is merged with what it was', t.size === 12 && t.color === 'accent' && t.in.fx === 'rise' && t.in.d === 0.4 && t.in.by === 'word'
    && same(r.notes, [{ code: 'layer', id: 'title', name: 'Title' }]), t);
  const byName = apply(free, [{ op: 'layer', id: 'Subtitle', set: { text: 'By name' } }]);
  ok('layer by its name, when one layer has it', byName.motion.layers.find((l) => l.id === 'sub').text === 'By name');
  const off = apply(free, [{ op: 'layer', id: 'title', set: { in: null } }]);
  ok('"in": null removes the entrance', off.motion.layers.find((l) => l.id === 'title').in === undefined);
  const word = apply(free, [{ op: 'layer', id: 'sub', set: { in: 'pop' } }]);
  ok('an entrance given as a bare word is that effect', word.motion.layers.find((l) => l.id === 'sub').in?.fx === 'pop');
  const wild = apply(free, [{ op: 'layer', id: 'bar', set: { x: 99999, y: -99999, opacity: 7, scale: 900, w: -5, rot: 'spin' } }]);
  const b = wild.motion.layers.find((l) => l.id === 'bar');
  ok('layer: a number out of range is held to it', b.x === LIMITS.reach && b.y === -LIMITS.reach && b.opacity === 1 && b.scale <= 8 && b.w >= 0 && Number.isFinite(b.rot), b);
  const url = apply(free, [{ op: 'layer', id: 'pic', set: { src: 'https://evil.example/a.png', w: 20 } }]);
  const pic = url.motion.layers.find((l) => l.id === 'pic');
  ok('layer: a picture from an address is refused; the rest applies', pic.src === PNG && pic.w === 20 && same(url.skipped, [{ code: 'refused', op: 'layer', field: 'src' }]), url.skipped);
  const other = apply(free, [{ op: 'layer', id: 'title', set: { src: PNG } }]);
  ok('layer: a field another kind has is not this one\'s', same(other.skipped, [{ code: 'no-field', op: 'layer', field: 'src' }]) && other.motion === free);
  const none = apply(free, [{ op: 'layer', id: 'ghost', set: { size: 3 } }]);
  ok('layer: an id that is not there is skipped by name', none.motion === free && same(none.skipped, [{ code: 'no-layer', op: 'layer', id: 'ghost' }]));
  const kind = apply(free, [{ op: 'layer', id: 'title', set: { kind: 'shape' } }]);
  ok('layer: its kind cannot be changed', kind.motion === free && kind.skipped[0]?.field === 'kind');
  const tpl = apply(attached, [{ op: 'layer', id: 'title', set: { size: 20 } }]);
  ok('editing a layer by hand ends the template, and says so', !tpl.motion.recipe && codes(tpl.notes).join() === 'layer,detached');
  const nochange = apply(attached, [{ op: 'layer', id: 'title', set: { text: 'Hello there' } }]);
  ok('a layer op that changes nothing does not end the template', nochange.motion === attached && !nochange.notes.length);
}
{
  const r = apply(free, [{ op: 'add', kind: 'text', set: { text: 'Book now', pin: 'bc', y: -8 } }]);
  const top = r.motion.layers[r.motion.layers.length - 1];
  ok('add: a new layer on top, with what was asked', top.kind === 'text' && top.text === 'Book now' && top.pin === 'bc' && r.motion.layers.length === free.layers.length + 1
    && r.notes[0]?.code === 'add' && r.notes[0].id === top.id && r.notes[0].kind === 'text');
  const back = apply(free, [{ op: 'add', kind: 'background', set: { style: 'dots' } }]);
  ok('add: a backdrop (by any name) goes to the back', back.motion.layers[0].kind === 'backdrop' && back.motion.layers[0].style === 'dots');
  const img = apply(free, [{ op: 'add', kind: 'image', set: { src: 'https://evil.example/a.png' } }]);
  ok('add: a picture layer without a picture of the person\'s is refused', img.motion === free && same(img.skipped, [{ code: 'refused', op: 'add', field: 'image' }]));
  const empty = apply(free, [{ op: 'add', kind: 'chart', set: { data: [] } }]);
  ok('add: a chart with no numbers is not drawn', empty.motion === free && same(empty.skipped, [{ code: 'no-data', op: 'add' }]));
  const made = apply(free, [{ op: 'add', kind: 'chart', set: { data: [{ label: 'X', value: 7717 }, { label: 'Y', value: 40 }] } }]);
  const ch = made.motion.layers[made.motion.layers.length - 1];
  ok('add: a chart\'s number nobody gave becomes a placeholder, and says so', ch.data[0].value !== 7717 && ch.data[1].value === 40 && codes(made.notes).includes('sample'), ch.data);
  const full = readMotion({ ...JSON.parse(JSON.stringify(free)), layers: Array.from({ length: LIMITS.layers }, (_, i) => blankLayer('shape', { id: `s${i}` })) }, NOW);
  const f = apply(freeze(full), [{ op: 'add', kind: 'text', set: { text: 'one more' } }]);
  ok('add: a graphic at its limit takes no more', f.motion === full && same(f.skipped, [{ code: 'full', op: 'add' }]));
  ok('add: a kind that is not one is skipped', apply(free, [{ op: 'add', kind: 'hologram' }]).skipped[0]?.code === 'invalid');
}
{
  const r = apply(free, [{ op: 'remove', id: 'bar' }]);
  ok('remove: the layer goes, said by name', !r.motion.layers.some((l) => l.id === 'bar') && same(r.notes, [{ code: 'remove', id: 'bar', name: 'Bar' }]));
  ok('remove: an id that is not there is skipped', same(apply(free, [{ op: 'remove', id: 'ghost' }]).skipped, [{ code: 'no-layer', op: 'remove', id: 'ghost' }]));
}
{
  const src = apply(apply(tmpl, [{ op: 'palette', id: 'ocean' }, { op: 'format', value: 'square' }, { op: 'seconds', value: 9 }]).motion, []).motion;
  const r = apply(src, [{ op: 'recipe', id: 'lower-third', fields: { name: 'Dr. Sara Ahmed', role: 'Dentist' } }]);
  ok('recipe: another template, its fields written', r.motion.recipe?.id === 'lower-third' && r.motion.recipe.fields.name === 'Dr. Sara Ahmed'
    && same(r.notes, [{ code: 'recipe', id: 'lower-third', name: 'Lower third' }]), r.notes);
  ok('recipe keeps the palette, the format, the length, the language, the id and the name',
    same(r.motion.palette, src.palette) && r.motion.format === 'square' && r.motion.seconds === 9 && r.motion.lang === src.lang && r.motion.id === src.id && r.motion.title === src.title);
  const fromFree = apply(free, [{ op: 'layer', id: 'bar', set: { w: 10 } }, { op: 'recipe', id: 'Big title', fields: { title: 'Again' } }]);
  ok('a template started again after a hand edit is a template, and "detached" is not said', fromFree.motion.recipe?.id === 'big-title' && !codes(fromFree.notes).includes('detached'));
  ok('recipe: a template that is not one is skipped', apply(free, [{ op: 'recipe', id: 'hologram' }]).skipped[0]?.code === 'invalid');
}
{
  const r = apply(free, [{ op: 'speed', value: 2 }]);
  const t = r.motion.layers.find((l) => l.id === 'title');
  const was = free.layers.find((l) => l.id === 'title');
  const back = r.motion.layers.find((l) => l.id === 'bg');
  const num = r.motion.layers.find((l) => l.id === 'num');
  const oldNum = free.layers.find((l) => l.id === 'num');
  ok('speed 2: entrances, exits, delays and staggers take half as long', t.in.d === was.in.d / 2 && t.in.delay === was.in.delay / 2 && t.in.gap === was.in.gap / 2 && t.out.d === was.out.d / 2, t);
  ok('speed 2: a loop cycles twice as fast, a counter rolls in half the time, a backdrop drifts twice as fast',
    back.loop.d === free.layers.find((l) => l.id === 'bg').loop.d / 2 && num.count.d === oldNum.count.d / 2 && back.speed === free.layers.find((l) => l.id === 'bg').speed * 2);
  ok('speed: when layers start and end is left alone', same(r.motion.layers.map((l) => [l.start, l.end]), free.layers.map((l) => [l.start, l.end])));
  ok('speed: said with its factor; it edits layers, so a template stops being one', same(r.notes, [{ code: 'speed', value: 2 }]) && !apply(attached, [{ op: 'speed', value: 2 }]).motion.recipe);
  const fast = apply(free, [{ op: 'speed', value: 100 }]);
  ok('speed past its limit is 4 times, and every timing stays in the reader\'s range',
    fast.notes[0]?.value === 4 && fast.motion.layers.every((l) => (!l.in || l.in.d >= 0.05) && (!l.loop || l.loop.d >= 0.4)), fast.notes);
  const slow = apply(free, [{ op: 'speed', value: 0.5 }]);
  ok('speed below 1 is slower', slow.motion.layers.find((l) => l.id === 'title').in.d === was.in.d * 2);
  ok('speed 1 changes nothing; a speed that is not a number is skipped',
    apply(free, [{ op: 'speed', value: 1 }]).motion === free && apply(free, [{ op: 'speed', value: 'zoom' }]).skipped[0]?.code === 'invalid');
}

// ── numbers nobody gave ───────────────────────────────────────────────────
{
  const r = apply(bigNumber, [{ op: 'fields', set: { value: '9999' } }], 'make the number bigger');
  ok('a number nobody gave is not written: the field keeps its own, and says why',
    r.motion === bigNumber && same(r.skipped, [{ code: 'unsourced', field: 'value' }]), r);
  const said = apply(bigNumber, [{ op: 'fields', set: { value: '٢٬٥٠٠' } }], 'change it to 2,500 please');
  ok('a number the person just wrote is written, in one spelling', said.motion.recipe?.fields.value === '2500' && !said.skipped.length, said.motion.recipe?.fields);
  const list = apply(bars, [{ op: 'fields', set: { items: 'A: 10\nB: 20\nC: 7717' } }]);
  const lines = list.motion.recipe?.fields.items.split('\n') ?? [];
  const example = (sampleFields('bar-chart', 'en').items ?? '').split('\n').filter(Boolean);
  ok('a list item with a number nobody gave keeps its label and takes an example, and says so',
    lines.length === 3 && lines[0] === 'A: 10' && lines[2].startsWith('C:') && !lines[2].includes('7717') && codes(list.notes).includes('sample'), { lines, example });
  const moved = apply(bars, [{ op: 'fields', set: { items: 'A: 15\nB: 20' } }]);
  ok('an item that had a number keeps it rather than take one nobody gave',
    moved.motion === bars && same(moved.skipped, [{ code: 'unsourced', field: 'items' }]), moved);
  const counter = apply(free, [{ op: 'layer', id: 'num', set: { to: 5000, size: 20 } }]);
  const c = counter.motion.layers.find((l) => l.id === 'num');
  ok('a counter keeps the number it had, and the rest of the op applies', c.to === 1200 && c.size === 20 && same(counter.skipped, [{ code: 'unsourced', field: 'to' }]), counter);
  const chart = apply(free, [{ op: 'layer', id: 'chart', set: { data: [{ label: 'A', value: 40 }, { label: 'B', value: 66 }] } }]);
  ok('a chart\'s value nobody gave goes back to what it was', same(chart.motion.layers.find((l) => l.id === 'chart').data.map((d) => d.value), [40, 65]));
  const re = apply(free, [{ op: 'recipe', id: 'big-number', fields: { value: '1200', label: 'Students' } }]);
  ok('a number already in the graphic may be used again', re.motion.recipe?.fields.value === '1200' && !codes(re.notes).includes('sample'));
  const made = apply(free, [{ op: 'recipe', id: 'big-number', fields: { value: '8731', suffix: '%', label: 'Happy' } }]);
  ok('a new template with a number nobody gave shows its example instead, and says so',
    made.motion.recipe?.fields.value === (sampleFields('big-number', 'en').value ?? '') && codes(made.notes).includes('sample'), made.motion.recipe?.fields);
}

// ── answers, whole ────────────────────────────────────────────────────────
{
  const r = apply(free, [
    { op: 'palette', id: 'mint' }, { op: 'seconds', value: 7 }, { op: 'title', value: 'Together' }, { op: 'speed', value: 1.5 },
    { op: 'remove', id: 'pic' }, { op: 'add', kind: 'text', set: { text: 'Now' } },
  ]);
  ok('several ops: all applied to one graphic, said in order',
    same(codes(r.notes), ['palette', 'seconds', 'title', 'speed', 'remove', 'add']) && r.motion.seconds === 7 && r.motion.title === 'Together'
    && !r.motion.layers.some((l) => l.id === 'pic'), codes(r.notes));
  const mixed = apply(free, [{ op: 'explode' }, 'nonsense', { op: 'title', value: 'Kept' }, { op: 'layer', id: 'nope', set: {} }]);
  ok('an unknown op, a non-op and a missing layer are skipped; the valid op still applies',
    mixed.motion.title === 'Kept' && same(codes(mixed.skipped), ['unknown', 'invalid', 'no-layer']) && mixed.skipped[0].op === 'explode', mixed.skipped);
  const aliases = apply(free, [{ action: 'set_title', value: 'Via alias' }, { type: 'delete_layer', layer: 'bar' }]);
  ok('op names models reach for are read as the ops they mean', aliases.motion.title === 'Via alias' && !aliases.motion.layers.some((l) => l.id === 'bar'));
  const many = apply(free, Array.from({ length: 15 }, (_, i) => ({ op: 'title', value: `T${i}` })));
  ok('at most twelve ops are read; the rest are said', many.motion.title === 'T11' && same(many.skipped, [{ code: 'too-many', count: 3 }]));
  const wrapped = apply(free, { say: 'ok', ops: [{ op: 'title', value: 'Wrapped' }] });
  const single = apply(free, { op: 'title', value: 'Single' });
  ok('a whole answer or a single op is read too', wrapped.motion.title === 'Wrapped' && single.motion.title === 'Single');
  ok('nothing that is ops is no change', [null, undefined, 'ops', 42, {}, []].every((x) => applyOps(free, x, NOW).motion === free));
  const once = apply(attached, [{ op: 'layer', id: 'title', set: { size: 30 } }, { op: 'layer', id: 'sub', set: { size: 5 } }]);
  ok('"detached" is said once', codes(once.notes).filter((c) => c === 'detached').length === 1);
}

// ── the order of an answer ────────────────────────────────────────────────
{
  const first = tmpl.layers.find((l) => l.kind === 'text');
  // "Faster, and the title X": the words are the template's to change, so they are applied before the speed ends the template.
  const both = apply(tmpl, [{ op: 'speed', value: 1.5 }, { op: 'fields', set: { title: 'Ready' } }]);
  ok('a speed written before the words still finds a template to change', both.motion.layers.some((l) => l.kind === 'text' && l.text.includes('Ready'))
    && !both.skipped.some((n) => n.code === 'not-template') && codes(both.notes).join() === 'fields,speed,detached', [both.notes, both.skipped]);
  const rebuilt = buildMotion({ id: 't1', recipe: 'big-title', fields: { ...tmpl.recipe.fields, title: 'Ready' }, lang: 'en', format: 'landscape', now: 1 });
  const sped = both.motion.layers.find((l) => l.id === first.id);
  const calm = rebuilt.layers.find((l) => l.id === first.id);
  ok('and the speed is on top: the rebuilt layers are the ones that moved faster', !both.motion.recipe && sped.in.d < calm.in.d, [sped.in.d, calm.in.d]);
  // "Make the headline bigger, and put it in portrait": the layout is the template's for the new shape, the edit is on top.
  const shaped = apply(tmpl, [{ op: 'layer', id: first.id, set: { size: 4 } }, { op: 'format', value: 'portrait' }]);
  const plain = buildMotion({ id: 't1', recipe: 'big-title', fields: tmpl.recipe.fields, lang: 'en', format: 'portrait', now: 1 });
  const other = plain.layers.find((l) => l.kind === 'text' && l.id !== first.id);
  ok('a layer edit written before a change of shape is applied after the rebuild', shaped.motion.format === 'portrait' && shaped.motion.layers.find((l) => l.id === first.id)?.size === 4
    && same(shaped.motion.layers.find((l) => l.id === other.id)?.y, other.y) && !shaped.motion.recipe, shaped.skipped);
  // A new template still comes before the words written for it, and the layer edits after both.
  const again = apply(free, [{ op: 'layer', id: 'bar', set: { w: 10 } }, { op: 'recipe', id: 'lower-third', fields: { name: 'Sara' } }, { op: 'fields', set: { role: 'Dentist' } }]);
  ok('a new template is built first, then its words, then hand edits', again.motion.recipe?.id === 'lower-third' && again.motion.recipe.fields.role === 'Dentist' && again.motion.recipe.fields.name === 'Sara');
  ok('only the order of ops that edit layers by hand is kept among themselves', same(apply(free, [{ op: 'add', kind: 'text', set: { text: 'one' } }, { op: 'remove', id: 'bar' }, { op: 'add', kind: 'text', set: { text: 'two' } }]).motion.layers.filter((l) => l.kind === 'text').map((l) => l.text).slice(-2), ['one', 'two']));
}

// ── fuzz: whatever the model writes ───────────────────────────────────────
{
  let seed = 20260929;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ids = free.layers.map((l) => l.id);
  const junk = () => pick([
    null, undefined, 0, -1, 1e308, -1e308, NaN, Infinity, 'NaN', '', 'x', '__proto__', 'constructor', {}, [], [1, 2], { fx: 'rise', d: -4 }, { fx: 'nope' },
    'https://evil.example/a.png', 'file:///etc/passwd', 'javascript:alert(1)', PNG, true, false, '٨٧', '1,200', { a: { b: { c: 1 } } }, 'accent', '#ff0000',
    'portrait', 'ar', 'ckb', 'sunset', 'lower-third', 'big-number', 12, 0.5, 99999, -0, 'x'.repeat(5000), [{ label: 'Q', value: 5 }], { label: 'y' },
  ]);
  /** An own property of any name, `__proto__` included, as JSON.parse makes one. */
  const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
  const inner = () => {
    const o = {};
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) put(o, pick(['text', 'size', 'x', 'y', 'src', 'in', 'out', 'loop', 'color', 'to', 'from', 'data', 'fx', 'title', 'value', 'kind', 'items', 'accent', '__proto__', 'constructor', 'end', 'start', 'd']), junk());
    return o;
  };
  const randomOp = () => {
    if (rnd() < 0.05) return junk();
    const o = {};
    put(o, pick(['op', 'op', 'op', 'action', 'type']), pick([...OPS, ...OPS, 'nope', '', 'EDIT', 'set_palette', 'delete', 'add_layer', null, 42]));
    const n = Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) put(o, pick(['id', 'value', 'set', 'fields', 'colors', 'kind', 'layer', 'name', 'x', 'size', 'text', 'in', 'src', '__proto__', 'constructor']), rnd() < 0.4 ? inner() : junk());
    if (rnd() < 0.5) put(o, 'id', pick(ids));
    return o;
  };
  const bases = [free, tmpl, attached, bigNumber, bars];
  let threw = 0;
  let unread = 0;
  let wild = 0;
  let over = 0;
  let changed = 0;
  for (let i = 0; i < 300; i++) {
    const base = bases[i % bases.length];
    const ops = rnd() < 0.05 ? junk() : Array.from({ length: Math.floor(rnd() * 16) }, randomOp);
    const before = JSON.stringify(base);
    let r;
    try {
      r = applyOps(base, ops, NOW, pick(['', 'make it 5000', '٣٠']));
    } catch (e) {
      threw++;
      continue;
    }
    if (JSON.stringify(base) !== before) changed++;
    if (!same(readMotion(r.motion, NOW), r.motion)) unread++;
    if (r.motion.layers.some((l) => l.kind === 'image' && l.src && !l.src.startsWith('data:image/'))) wild++;
    if (r.motion.layers.length > LIMITS.layers || !Array.isArray(r.notes) || !Array.isArray(r.skipped)) over++;
  }
  ok('300 random answers: nothing throws', threw === 0, threw);
  ok('300 random answers: every result reads as itself', unread === 0, unread);
  ok('300 random answers: no picture from an address, no graphic past its limits', wild === 0 && over === 0, { wild, over });
  ok('300 random answers: no input changed', changed === 0, changed);
  ok('no prototype was touched on the way', ({}).polluted === undefined && ({}).x === undefined && Object.getPrototypeOf({}) === Object.prototype);
}

// ── every result above ────────────────────────────────────────────────────
ok(`every result is a fixed point of the reader (${results.length} answers)`, results.every(({ r }) => same(readMotion(r.motion, NOW), r.motion)),
  results.filter(({ r }) => !same(readMotion(r.motion, NOW), r.motion)).map((x) => x.name));
ok('no input was changed by any answer', results.every(({ input, before }) => JSON.stringify(input) === before));
ok('every note and every skip has a code', results.every(({ r }) => [...r.notes, ...r.skipped].every((n) => typeof n.code === 'string' && n.code)));

// ── a countdown's start is a design choice, not a figure ──────────────────
{
  const s = sourcedFields('countdown', { from: '7', final: 'GO' }, null, new Set(), 'en');
  ok('a countdown\'s start needs no source', s.fields.from === '7' && s.sampled === false && s.kept.length === 0, s);
  const b = sourcedFields('big-number', { value: '9999', label: 'x' }, null, new Set(), 'en');
  ok('a big number still does', b.fields.value === undefined && b.sampled === true, b);
}

// ── a model draws no pictures ─────────────────────────────────────────────
{
  const base = buildMotion({ id: 'pic', recipe: 'big-title', lang: 'en', format: 'landscape', now: 1 });
  const withPicture = applyOps(base, [{ op: 'add', kind: 'image', set: { src: PNG, w: 30, h: 20 } }], 2);
  ok('an image cannot be added by a model, even with a real PNG', withPicture.motion.layers.length === base.layers.length && withPicture.skipped.some((n) => n.code === 'refused'), withPicture.skipped);
  const svg = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3Ctext%3E87%25 agree%3C/text%3E%3C/svg%3E';
  const viaSvg = applyOps(base, [{ op: 'add', kind: 'image', set: { src: svg } }], 2);
  ok('nor an SVG a model wrote', viaSvg.motion.layers.length === base.layers.length && viaSvg.skipped.length > 0);
  const own = applyOps(base, [{ op: 'add', kind: 'image' }], 2);
  ok('nor an empty picture frame', own.motion.layers.every((l) => l.kind !== 'image'));
  const hand = applyOps({ ...base, layers: [...base.layers, blankLayer('image', { id: 'logo', src: PNG })], recipe: undefined }, [{ op: 'layer', id: 'logo', set: { src: svg, w: 10 } }], 2);
  const logo = hand.motion.layers.find((l) => l.id === 'logo');
  ok('a model cannot change the source of a picture the person brought', logo.src === PNG && hand.skipped.some((n) => n.code === 'refused' && n.field === 'src'), hand.skipped);
  ok('but can still move and resize it', logo.w === 10);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
