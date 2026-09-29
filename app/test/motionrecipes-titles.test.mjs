// The title recipes (motionrecipes-titles.ts): big title, kinetic type, split
// reveal, quote card, steps, loop background.
//
//   npx esbuild src/motionrecipes-titles.ts src/motiontemplates.ts src/motionrecipe.ts src/motionread.ts \
//     src/motiondraw.ts src/motionanim.ts --bundle --format=esm --outdir=.test-build --log-level=error \
//     && node test/motionrecipes-titles.test.mjs
//
// What matters: every recipe builds in every language and every shape, at its
// own length, at 1, 2 and 30 seconds, with 90-character words and with one
// word; what it builds is already what the reader would make of it (a fixed
// point — nothing is clamped behind the designer's back); layer ids are the
// same in every shape, so a selection survives a change of format; every layer
// lives inside the graphic and finishes arriving before it starts to leave;
// every frame draws only what a browser accepts, and the still the gallery
// shows is not empty; words stay inside the frame whatever their length; right
// to left is the mirror image of left to right, box for box; the highlight is
// always found whole; a list is read defensively; and the loop background's
// last frame runs into its first.
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { TITLE_RECIPES } from '../.test-build/motionrecipes-titles.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';
import { META, makeKit, paletteOf } from '../.test-build/motionrecipe.js';
import { readLayer } from '../.test-build/motionread.js';
import { paint, makeEnv, layerBox } from '../.test-build/motiondraw.js';
import { inDone, outStart, unitsOf, stillTime, poseAt } from '../.test-build/motionanim.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const IDS = ['big-title', 'kinetic', 'split-title', 'quote', 'steps', 'loop-bg'];
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const BACKDROP_STYLES = ['aurora', 'grid', 'dots', 'rays', 'waves', 'bokeh', 'stripes'];

const LONG = {
  en: 'Extraordinary ideas travel further when simple tools let everyone share them with the world',
  ar: 'مدينة جميلة جدا في شمال العراق حيث الجبال العالية والوديان الخضراء والناس الطيبون دائما',
  ckb: 'شارێکی جوان لە باکووری عێراق کە چیای بەرز و دۆڵی سەوز و خەڵکی میهرەبانی تێدایە هەمیشە',
  kmr: 'باژێرەکێ جوان ل باکوورێ عێراقێ کو چیایێن بلند و نهالێن کەسک و خەلکێ باش لێ هەین هەردەم',
};
const ONE = { en: 'Launch', ar: 'انطلق', ckb: 'دەستپێک', kmr: 'دەستپێک' };

const build = (recipe, lang, format, more = {}) => buildMotion({ id: 'x', recipe, lang, format, now: 0, ...more });

/** Fields for a recipe from one value per kind: words cut to each field's length, a list of `items` lines, a choice as given. */
function fill(recipe, words, items = 5) {
  const out = {};
  for (const f of META[recipe].fields) {
    if (f.kind === 'choice') out[f.key] = f.options[0];
    else if (f.kind === 'list') out[f.key] = Array.from({ length: items }, () => Array.from(words).slice(0, 80).join('')).join('\n');
    else out[f.key] = Array.from(words).slice(0, f.max).join('').trim();
  }
  return out;
}

/** Paint `doc` at `t` on a fresh recording canvas: the problems it reports and whether anything was drawn. */
function draw(doc, t) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w / 4, h / 4);
  paint(c.ctx, doc, t, { strict: true });
  return { problems: c.check(), drew: drewSomething(c.calls), calls: c.calls };
}

/** What a structural check found wrong with one built document. */
function faults(doc) {
  const out = [];
  const ids = new Set();
  for (const l of doc.layers) {
    if (ids.has(l.id)) out.push(`duplicate id ${l.id}`);
    ids.add(l.id);
    if (!l.id.startsWith(`${doc.recipe.id}-`)) out.push(`id ${l.id} was not made by the kit (renamed by the reader?)`);
    if (!l.name) out.push(`${l.id} has no name`);
    if (!same(readLayer(l, { seconds: doc.seconds }), l)) out.push(`${l.id} is not a fixed point of readLayer`);
    if (!(l.start >= 0 && l.start < l.end && l.end <= doc.seconds + 1e-9)) out.push(`${l.id} lives ${l.start}..${l.end} of ${doc.seconds}`);
    if (l.kind === 'text' && l.text && !(l.max > 0)) out.push(`${l.id} carries words with no wrap width`);
  }
  return out;
}

/** The layers exactly as the recipe made them, before the document reader saw them. */
function raw(recipe, lang, format, seconds, fields) {
  const doc = build(recipe, lang, format, { seconds, fields });
  const kit = makeKit({ recipe, lang, format, palette: paletteOf(META[recipe].palette).colors, seconds: doc.seconds, fields: doc.recipe.fields });
  return { doc, layers: TITLE_RECIPES[recipe].build(kit) };
}

// ── the set ───────────────────────────────────────────────────────────────

ok('the file makes exactly the six title recipes', same(Object.keys(TITLE_RECIPES).sort(), [...IDS].sort()), Object.keys(TITLE_RECIPES));
ok('the templates bundle is current (it holds these recipes, not an older build of them)',
  IDS.every((id) => RECIPES[id] && same(RECIPES[id].sample, TITLE_RECIPES[id].sample)),
  'rebuild .test-build/motiontemplates.js with the command at the top of this file');

for (const id of IDS) {
  const r = TITLE_RECIPES[id];
  const keys = META[id].fields.map((f) => f.key);
  const bad = [];
  for (const lang of LANGS) {
    for (const k of keys) {
      const v = r.sample[lang]?.[k];
      const f = META[id].fields.find((x) => x.key === k);
      const lines = f.kind === 'list' ? v?.split('\n') ?? [] : [v];
      if (typeof v !== 'string' || v.trim() === '') bad.push(`${lang}.${k} empty`);
      else if (f.kind === 'list' ? lines.length > f.max : Array.from(v).length > f.max) bad.push(`${lang}.${k} too long`);
      else if (/[\u0660-\u0669\u06F0-\u06F9]/.test(v)) bad.push(`${lang}.${k} has Arabic-Indic digits`);
      else if (f.kind === 'choice' && !f.options.includes(v)) bad.push(`${lang}.${k} is not an option`);
    }
    if (lang !== 'en' && id !== 'loop-bg' && !keys.some((k) => /[\u0600-\u06FF]/.test(r.sample[lang][k]))) bad.push(`${lang} is not in Arabic script`);
  }
  ok(`${id}: a sample for every field in every language, within the field's length, plain digits`, bad.length === 0, bad);
}
ok('kinetic: each language\'s highlighted word is in its own title',
  LANGS.every((lang) => TITLE_RECIPES.kinetic.sample[lang].title.includes(TITLE_RECIPES.kinetic.sample[lang].highlight)));
ok('Sorani samples use the Sorani letters, Badini the northern ones',
  /[\u0695\u06B5\u06C6\u06CE\u06D5]/.test(Object.values(TITLE_RECIPES['big-title'].sample.ckb).join(' '))
  && /\u06A4/.test(Object.values(TITLE_RECIPES['big-title'].sample.kmr).join(' ')));
ok('loop background: its sample style is the aurora in every language', LANGS.every((l) => TITLE_RECIPES['loop-bg'].sample[l].style === 'aurora'));

// ── every language, every shape, the natural length ───────────────────────

for (const id of IDS) {
  const problems = [];
  const moving = [];
  const drawing = [];
  const empty = [];
  let idsByFormat = null;
  for (const lang of LANGS) {
    const idSets = [];
    for (const format of FORMATS) {
      const { doc, layers } = raw(id, lang, format);
      problems.push(...faults(doc).map((p) => `${lang} ${format}: ${p}`));
      if (!same(layers, doc.layers)) problems.push(`${lang} ${format}: the reader changed what the recipe made`);
      idSets.push(doc.layers.map((l) => l.id).sort().join(','));
      for (const l of doc.layers) {
        const n = unitsOf(l);
        if (inDone(l, n) > outStart(l, n) + 1e-9) moving.push(`${lang} ${format} ${l.id}: in ${inDone(l, n).toFixed(2)} > out ${outStart(l, n).toFixed(2)}`);
      }
      for (let i = 0; i < 40; i++) {
        const t = (i / 39) * (doc.seconds - 1e-3);
        const d = draw(doc, t);
        if (d.problems.length) drawing.push(`${lang} ${format} @${t.toFixed(2)}: ${d.problems.slice(0, 2).join('; ')}`);
      }
      const still = stillTime(doc.layers, doc.seconds);
      const words = doc.layers.filter((l) => l.kind !== 'backdrop' && l.kind !== 'particles');
      const on = (words.length ? words : doc.layers).some((l) => poseAt(l, still, lang !== 'en').on);
      if (!draw(doc, still).drew || !on) empty.push(`${lang} ${format} @${still.toFixed(2)}`);
    }
    if (new Set(idSets).size !== 1) problems.push(`${lang}: layer ids differ between shapes`);
    idsByFormat = idsByFormat ?? idSets[0];
  }
  ok(`${id}: builds in 4 languages x 4 shapes, every layer named, unique, stable across shapes, a fixed point, inside the graphic`, problems.length === 0, problems.slice(0, 4));
  ok(`${id}: every layer has landed before it begins to leave`, moving.length === 0, moving.slice(0, 4));
  ok(`${id}: 40 frames across the length draw nothing a browser would reject`, drawing.length === 0, drawing.slice(0, 3));
  ok(`${id}: the still the gallery shows is not empty`, empty.length === 0, empty.slice(0, 4));
}

// ── other lengths ─────────────────────────────────────────────────────────

for (const id of IDS) {
  const bad = [];
  for (const seconds of [1, 2, 30]) {
    for (const lang of ['en', 'ar']) {
      for (const format of FORMATS) {
        const { doc, layers } = raw(id, lang, format, seconds);
        if (doc.seconds !== seconds) bad.push(`${seconds}s ${lang} ${format}: the graphic is ${doc.seconds}s`);
        bad.push(...faults(doc).map((p) => `${seconds}s ${lang} ${format}: ${p}`));
        if (!same(layers, doc.layers)) bad.push(`${seconds}s ${lang} ${format}: the reader changed what the recipe made`);
        for (let i = 0; i < 12; i++) {
          const d = draw(doc, (i / 11) * (seconds - 1e-3));
          if (d.problems.length) bad.push(`${seconds}s ${lang} ${format}: ${d.problems[0]}`);
        }
        if (seconds >= 2) {
          for (const l of doc.layers) {
            const n = unitsOf(l);
            if (inDone(l, n) > outStart(l, n) + 1e-9) bad.push(`${seconds}s ${lang} ${format} ${l.id}: lands after it starts to leave`);
          }
          const still = stillTime(doc.layers, doc.seconds);
          if (!draw(doc, still).drew) bad.push(`${seconds}s ${lang} ${format}: empty still`);
        }
      }
    }
  }
  ok(`${id}: at 1, 2 and 30 seconds it builds, stays a fixed point and draws cleanly; at 2 and 30 it lands before it leaves`, bad.length === 0, bad.slice(0, 4));
}

for (const id of IDS.filter((x) => x !== 'loop-bg')) {
  const late = [];
  for (const seconds of [META[id].seconds, 12, 30]) {
    const doc = build(id, 'en', 'landscape', { seconds });
    for (const l of doc.layers) {
      if (!l.out || l.end < seconds - 1e-9) continue;
      const n = unitsOf(l);
      if (outStart(l, n) < seconds - 0.75) late.push(`${seconds}s ${l.id} starts leaving at ${outStart(l, n).toFixed(2)}`);
    }
  }
  ok(`${id}: the exit is the last three quarters of a second, however long the graphic`, late.length === 0, late.slice(0, 3));
}

// ── long words, one word ──────────────────────────────────────────────────

/** Text boxes at rest that reach outside the frame, less a margin, in u. */
function outside(doc, margin = 3) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w, h);
  const out = [];
  for (const l of doc.layers) {
    if (l.kind !== 'text' && l.kind !== 'counter') continue;
    const t = Math.min(inDone(l, unitsOf(l)) + 0.01, l.end - 0.01);
    const env = makeEnv(c.ctx, doc, t, w, h);
    const b = layerBox(env, { ...l, rot: 0, loop: undefined });
    if (!b) continue;
    const m = margin * env.k;
    if (b.x < m - 0.5 || b.y < m - 0.5 || b.x + b.w > w - m + 0.5 || b.y + b.h > h - m + 0.5) {
      out.push(`${l.id} box ${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)} in ${w}x${h}`);
    }
  }
  return out;
}

for (const id of IDS.filter((x) => x !== 'loop-bg')) {
  const bad = [];
  for (const lang of LANGS) {
    for (const [label, words, items] of [['90 characters', LONG[lang], 5], ['one word', ONE[lang], 1]]) {
      for (const format of FORMATS) {
        const fields = fill(id, words, items);
        const { doc, layers } = raw(id, lang, format, undefined, fields);
        bad.push(...faults(doc).map((p) => `${label} ${lang} ${format}: ${p}`));
        if (!same(layers, doc.layers)) bad.push(`${label} ${lang} ${format}: the reader changed what the recipe made`);
        bad.push(...outside(doc).map((p) => `${label} ${lang} ${format}: ${p}`));
        for (const t of [0.5, 1.5, stillTime(doc.layers, doc.seconds), doc.seconds - 0.2]) {
          const d = draw(doc, t);
          if (d.problems.length) bad.push(`${label} ${lang} ${format} @${t.toFixed(2)}: ${d.problems[0]}`);
        }
        const texts = doc.layers.filter((l) => l.kind === 'text');
        const small = texts.filter((l) => l.size < 2.2);
        if (small.length) bad.push(`${label} ${lang} ${format}: ${small.map((l) => `${l.id} at ${l.size}u`).join(', ')}`);
        const heavy = texts.find((l) => l.id.endsWith('-title') && l.size < 5);
        if (heavy) bad.push(`${label} ${lang} ${format}: the title shrank to ${heavy.size}u`);
      }
    }
  }
  ok(`${id}: 90-character and one-word fields build, stay fixed points, keep every text box inside the frame and draw cleanly`, bad.length === 0, bad.slice(0, 5));
}

{
  const bad = [];
  for (const id of ['big-title', 'split-title', 'quote', 'steps', 'kinetic']) {
    for (const format of FORMATS) {
      for (const lang of LANGS) {
        const doc = build(id, lang, format);
        bad.push(...outside(doc, 4).map((p) => `${id} ${lang} ${format}: ${p}`));
      }
    }
  }
  ok('the sample words sit at least 4u inside every frame', bad.length === 0, bad.slice(0, 5));
}

// ── right to left ─────────────────────────────────────────────────────────

/**
 * The same Latin words built in English and in Arabic: every box on screen in
 * the one is the mirror of the other's — same size and height, its centre the
 * same distance from the opposite edge, and any turn reversed.
 */
for (const id of IDS.filter((x) => x !== 'loop-bg')) {
  const bad = [];
  const fields = Object.fromEntries(META[id].fields.map((f) => [f.key, TITLE_RECIPES[id].sample.en[f.key]]));
  for (const format of FORMATS) {
    const en = build(id, 'en', format, { fields });
    const ar = build(id, 'ar', format, { fields });
    const [w, h] = SIZES[format];
    const c = makeCanvas(w, h);
    for (const t of [stillTime(en.layers, en.seconds), 1.2]) {
      const ee = makeEnv(c.ctx, en, t, w, h);
      const ea = makeEnv(c.ctx, ar, t, w, h);
      for (let i = 0; i < en.layers.length; i++) {
        const a = layerBox(ee, en.layers[i]);
        const b = layerBox(ea, ar.layers[i]);
        if (!a && !b) continue;
        if (!a || !b) { bad.push(`${format} @${t.toFixed(2)} ${en.layers[i].id}: shown in one direction only`); continue; }
        const near = (x, y) => Math.abs(x - y) < 0.75;
        if (!(near(a.cx + b.cx, w) && near(a.cy, b.cy) && near(a.w, b.w) && near(a.h, b.h) && near(a.rot, -b.rot))) {
          bad.push(`${format} @${t.toFixed(2)} ${en.layers[i].id}: ${[a.cx, a.cy, a.rot].map(Math.round)} vs ${[b.cx, b.cy, b.rot].map(Math.round)}`);
        }
      }
    }
  }
  ok(`${id}: right to left is the mirror of left to right, box for box`, bad.length === 0, bad.slice(0, 4));
}

// ── what each recipe promises ─────────────────────────────────────────────

{
  const words = (doc, suffix) => doc.layers.find((l) => l.id.endsWith(suffix));
  const lines = (l) => l.text.split('\n');
  const doc = build('big-title', 'en', 'landscape');
  const title = words(doc, '-title');
  ok('big title: the headline reveals line by line from behind its baseline, and its lines are the ones the stagger counts',
    title.in.fx === 'mask' && title.in.by === 'line' && unitsOf(title) === lines(title).length && lines(title).length <= 3);
  ok('big title: aurora under a label, headline, rule and subtitle, in that order back to front',
    same(doc.layers.map((l) => l.id.replace('big-title-', '')), ['aurora', 'kicker', 'title', 'rule-start', 'rule-end', 'subtitle']));
  ok('big title: the label, rule and subtitle start as the one before is half in',
    words(doc, '-kicker').in.delay < title.in.delay && title.in.delay < words(doc, '-rule-start').in.delay
      && words(doc, '-rule-start').in.delay < words(doc, '-subtitle').in.delay);
  const bare = build('big-title', 'en', 'landscape', { fields: { kicker: '', subtitle: '' } });
  ok('big title: an emptied label or subtitle leaves no layer behind', !bare.layers.some((l) => /kicker|subtitle/.test(l.id)));
  const portrait = build('big-title', 'en', 'portrait');
  ok('big title: a portrait headline is narrower and smaller than the landscape one, as designed',
    words(portrait, '-title').max < title.max && words(portrait, '-title').size <= title.size && words(portrait, '-title').size >= 9);
  ok('big title: the landscape headline is 11 to 14u', title.size >= 11 && title.size <= 14);
}

{
  const doc = build('kinetic', 'en', 'landscape');
  const words = doc.layers.find((l) => l.id === 'kinetic-words');
  const title = doc.layers.find((l) => l.id === 'kinetic-title');
  ok('kinetic: the words slam in one after another, popping past their size', words.in.fx === 'pop' && words.in.by === 'word' && words.in.ease === 'back-out' && words.in.gap >= 0.08);
  ok('kinetic: the words hand over to the highlighted title the moment they land',
    Math.abs(title.start - inDone(words, unitsOf(words))) < 1e-6 && words.end > title.start && words.end - title.start < 0.2 && same(words.text, title.text));
  ok('kinetic: the title carries the highlight box on the sample word and pushes in through the hold',
    title.hi === 'big' && title.hiStyle === 'box' && title.loop?.fx === 'pulse' && title.loop.d >= 2 * (doc.seconds - title.start) - 1e-6);
  ok('kinetic: the block leans, and leans the other way right to left',
    words.rot < 0 && build('kinetic', 'ar', 'landscape').layers.find((l) => l.id === 'kinetic-words').rot === -words.rot);
  const shapes = doc.layers.filter((l) => l.kind === 'shape');
  ok('kinetic: accent shapes pulse around the block once it has landed',
    shapes.length >= 5 && shapes.every((s) => s.loop?.fx === 'pulse' && s.in.delay >= title.start - 1e-9)
      && shapes.every((s) => [s.fill, s.stroke?.color].includes('accent2')));
  const wrong = build('kinetic', 'en', 'landscape', { fields: { title: 'Make every second count', highlight: 'SECOND' } });
  ok('kinetic: a highlight written in another case is found as the title writes it',
    wrong.layers.find((l) => l.id === 'kinetic-title').hi === 'second');
  const none = build('kinetic', 'en', 'landscape', { fields: { title: 'Make every second count', highlight: 'minute' } });
  ok('kinetic: a highlight that is not in the title lights nothing up', none.layers.find((l) => l.id === 'kinetic-title').hi === undefined);
  const pair = build('kinetic', 'en', 'portrait', { fields: { title: 'We build tools for the people who make things', highlight: 'the people' } });
  const t = pair.layers.find((l) => l.id === 'kinetic-title');
  ok('kinetic: a highlighted phrase of several words is never broken across two lines', t.hi === 'the people' && t.text.includes('the people'));
  const arabic = build('kinetic', 'ckb', 'landscape');
  ok('kinetic: the Sorani highlight is found in the Sorani title', arabic.layers.find((l) => l.id === 'kinetic-title').hi === 'گەورە');
}

{
  const doc = build('split-title', 'en', 'landscape');
  const by = (s) => doc.layers.find((l) => l.id === `split-title-${s}`);
  ok('split reveal: the two panels sweep in from opposite sides and leave the way they came',
    by('panel-top').in.fx === 'wipe' && by('panel-top').in.dir === 'start' && by('panel-bottom').in.dir === 'end'
      && by('panel-top').out.dir === 'start' && by('panel-bottom').out.dir === 'end');
  ok('split reveal: the seam opens after the panels meet, and the title rises inside it',
    by('opening-top').in.fx === 'grow' && by('opening-top').in.dir === 'up' && by('opening-bottom').in.dir === 'down'
      && by('opening-top').in.delay >= 0.5 && by('title').in.fx === 'mask' && by('title').in.delay > by('opening-top').in.delay);
  ok('split reveal: the two halves of the opening overlap across the seam, so no panel shows between them',
    by('opening-top').y + by('opening-top').h / 2 > by('opening-bottom').y - by('opening-bottom').h / 2 + 0.5);
  ok('split reveal: the opening is the ground\'s colour and the words the ink that reads on it',
    by('opening-top').fill === 'bg' && by('title').color === 'fg');
}

{
  const short = build('quote', 'en', 'landscape', { fields: { quote: 'Less, but better.', author: 'A. Designer', role: '' } });
  const long = build('quote', 'en', 'landscape', { fields: { quote: LONG.en + ' And then some more.', author: 'A. Designer' } });
  const body = (d) => d.layers.find((l) => l.id === 'quote-quote');
  ok('quote: a short quotation is set larger than a long one', body(short).size > body(long).size + 1.5, [body(short).size, body(long).size]);
  ok('quote: an emptied role leaves no layer', !short.layers.some((l) => l.id === 'quote-role'));
  const doc = build('quote', 'en', 'landscape');
  const mark = doc.layers.find((l) => l.id === 'quote-mark');
  ok('quote: a giant accent quotation mark pops in first', mark.text === '\u201C' && mark.color === 'accent' && mark.size >= 30 && mark.in.fx === 'pop'
    && doc.layers.filter((l) => l.in && l.kind !== 'backdrop').every((l) => l.in.delay >= mark.in.delay));
  ok('quote: the quotation reveals line by line, then the rule, the author and the role',
    body(doc).in.by === 'line' && body(doc).in.fx === 'mask'
      && doc.layers.find((l) => l.id === 'quote-rule-start').in.delay < doc.layers.find((l) => l.id === 'quote-author').in.delay
      && doc.layers.find((l) => l.id === 'quote-author').in.delay < doc.layers.find((l) => l.id === 'quote-role').in.delay);
  const bad = [];
  for (const n of [30, 60, 90, 120, 160]) {
    for (const format of FORMATS) {
      const words = Array.from('The quick brown fox jumps over the lazy dog while the band plays on. '.repeat(3)).slice(0, n).join('').trim();
      const d = build('quote', 'en', format, { fields: { quote: words } });
      const q = body(d);
      if (q.text.replace(/\n/g, ' ') !== words.replace(/\s+/g, ' ')) bad.push(`${n} ${format}: words changed`);
      if (outside(d).length) bad.push(`${n} ${format}: ${outside(d)[0]}`);
    }
  }
  ok('quote: 30 to 160 characters keep every word and stay inside every frame', bad.length === 0, bad.slice(0, 3));
}

{
  const doc = (items, more = {}) => build('steps', 'en', 'landscape', { fields: { title: 'How it works', items }, ...more });
  const texts = (d) => d.layers.filter((l) => /^steps-step-\d$/.test(l.id)).map((l) => l.text.replace(/\n/g, ' '));
  ok('steps: numbering and bullets the person typed are taken off; the recipe numbers them',
    same(texts(doc('1. Plan\n2) Build\n- Test\n• Ship')), ['Plan', 'Build', 'Test', 'Ship']));
  ok('steps: blank lines are skipped and more than five steps are cut to five', texts(doc('a\n\n  \nb\nc\nd\ne\nf\ng')).length === 5);
  ok('steps: a list with nothing in it still shows the steps it started with', texts(doc('   \n  ')).length === 4);
  const five = doc('One\nTwo\nThree\nFour\nFive');
  const numbers = five.layers.filter((l) => l.kind === 'counter');
  ok('steps: each circle holds its number as a counter, so it is written in the language\'s digits',
    same(numbers.map((l) => [l.from, l.to]), [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]));
  const starts = five.layers.filter((l) => /circle/.test(l.id)).map((l) => l.in.delay);
  ok('steps: a step arrives every seven tenths of a second', starts.every((s, i) => i === 0 || Math.abs(s - starts[i - 1] - 0.7) < 1e-6));
  const lines = five.layers.filter((l) => /-line-/.test(l.id));
  ok('steps: a line draws down to each step after the first, just before its circle pops',
    lines.length === 4 && lines.every((l, i) => l.in.fx === 'grow' && l.in.dir === 'down' && l.in.delay < starts[i + 1]));
  const bands = five.layers.filter((l) => /-band-/.test(l.id));
  ok('steps: the band marking the newest step hands on to the next and settles',
    bands.every((b, i) => i === bands.length - 1 || b.end > starts[i + 1]) && bands.every((b) => b.end < five.seconds - 0.5));
  const pitch = (d) => { const c = d.layers.filter((l) => /circle/.test(l.id)); return c.length > 1 ? c[1].y - c[0].y : Infinity; };
  ok('steps: fewer steps are spaced wider, more are spaced closer, and all fit', pitch(doc('A\nB')) >= pitch(five) && outside(five).length === 0);
}

// ── fields cleared ────────────────────────────────────────────────────────

{
  const bad = [];
  for (const id of IDS.filter((x) => x !== 'loop-bg')) {
    for (const format of FORMATS) {
      const fields = Object.fromEntries(META[id].fields.map((f) => [f.key, '']));
      const doc = build(id, 'en', format, { fields });
      bad.push(...faults(doc).map((p) => `${id} ${format}: ${p}`));
      if (doc.layers.some((l) => l.kind === 'text' && l.text === '')) bad.push(`${id} ${format}: an empty text layer`);
      for (const t of [0.5, doc.seconds / 2]) if (draw(doc, t).problems.length) bad.push(`${id} ${format}: draws badly`);
    }
  }
  ok('every field cleared: each recipe still builds, draws cleanly and leaves no empty text layer', bad.length === 0, bad.slice(0, 4));
  const kinetic = build('kinetic', 'en', 'landscape', { fields: { title: '', highlight: '' } });
  ok('kinetic: with no title, only its background remains', kinetic.layers.length === 1 && kinetic.layers[0].kind === 'backdrop');
  const steps = build('steps', 'en', 'landscape', { fields: { title: '', items: 'One\nTwo' } });
  ok('steps: with no heading the list is centred on its own', !steps.layers.some((l) => l.id === 'steps-title') && outside(steps).length === 0);
}

// ── the loop ──────────────────────────────────────────────────────────────

{
  const bad = [];
  const seam = [];
  for (const style of BACKDROP_STYLES) {
    for (const format of FORMATS) {
      const doc = build('loop-bg', 'en', format, { fields: { style } });
      const bd = doc.layers.find((l) => l.kind === 'backdrop');
      const pt = doc.layers.find((l) => l.kind === 'particles');
      if (!bd || bd.style !== style) bad.push(`${style} ${format}: backdrop ${bd?.style}`);
      if (!pt || pt.burst !== false) bad.push(`${style} ${format}: particles are not a stream`);
      if (doc.layers.some((l) => l.kind === 'text' || l.in || l.out)) bad.push(`${style} ${format}: words, or a fade that would break the loop`);
      if (doc.layers.some((l) => l.start !== 0 || l.end !== doc.seconds)) bad.push(`${style} ${format}: a layer does not span the loop`);
      // A moment and the same moment one loop later draw the same frame, so the
      // last frame of the loop runs into its first. (The layers are lengthened
      // for the second look; the loop's period is the graphic's length.)
      const later = { ...doc, layers: doc.layers.map((l) => ({ ...l, end: doc.seconds + 2 })) };
      const at = 0.37;
      const a = draw(later, at).calls.filter((c) => !c.set).map((c) => c.args);
      const b = draw(later, at + doc.seconds).calls.filter((c) => !c.set).map((c) => c.args);
      const flat = (x) => JSON.stringify(x).match(/-?\d+(\.\d+)?(e-?\d+)?/g) ?? [];
      const fa = flat(a);
      const fb = flat(b);
      const off = fa.length !== fb.length ? Infinity : Math.max(0, ...fa.map((v, i) => Math.abs(Number(v) - Number(fb[i]))));
      if (!(off < 0.05)) seam.push(`${style} ${format}: ${off}`);
    }
  }
  ok('loop background: every style builds as one backdrop and a stream of particles, with no words and no fades', bad.length === 0, bad.slice(0, 3));
  ok('loop background: the last frame runs into the first, in every style and shape', seam.length === 0, seam.slice(0, 3));
  const odd = build('loop-bg', 'en', 'landscape', { fields: { style: 'plaid' } });
  ok('loop background: a style that is not one is the aurora', odd.layers[0].style === 'aurora');
  ok('loop background: eight seconds long unless asked otherwise', odd.seconds === 8);
}

// ── colour ────────────────────────────────────────────────────────────────

{
  const bad = [];
  const TOKENS = new Set(['bg', 'fg', 'accent', 'accent2', 'muted']);
  const okColour = (c) => c === null || c === undefined || TOKENS.has(c) || /^#(000000|ffffff)[0-9a-f]{2}$/.test(c);
  const paints = (p) => (p && typeof p === 'object' ? p.stops.map((s) => s.color) : [p]);
  for (const id of IDS) {
    for (const palette of ['midnight', 'paper', 'daylight', 'mono']) {
      const doc = build(id, 'en', 'landscape', { palette });
      for (const l of doc.layers) {
        const colours = [
          ...paints(l.color), ...paints(l.fill), ...paints(l.hiColor), ...(l.stroke ? paints(l.stroke.color) : []),
          ...(l.shadow ? [l.shadow.color] : []), ...(l.colors ?? []),
        ];
        for (const c of colours) if (!okColour(c)) bad.push(`${id} ${palette} ${l.id}: ${c}`);
      }
    }
  }
  ok('every colour is a palette token, or black or white with alpha for a shadow', bad.length === 0, bad.slice(0, 4));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
