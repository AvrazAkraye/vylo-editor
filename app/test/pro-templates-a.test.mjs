// Work package 07's templates (motionrecipes-pro-a.ts, motionrecipes-pro-a-meta.ts):
// four lower thirds, a notification stack, a hand-drawn circle, a chat and a device.
//
//   npm test builds .test-build; alone:
//   npx esbuild src/motionrecipes-pro-a.ts src/motiontemplates.ts src/motionrecipe.ts src/motionread.ts src/motiondraw.ts \
//     src/motionanim.ts src/motiontypes.ts src/motionui.ts --bundle --format=esm --outdir=.test-build --log-level=error \
//     --external:@tauri-apps/api/core && node test/pro-templates-a.test.mjs
//
// What matters: the ids, the recipes and the metadata are one set, and every
// template has well-formed metadata, translated names and samples in all four
// languages; each builds in every language and shape at its own length and at
// 1, 2 and 30 seconds, with the longest words, Arabic words, one word, empty
// fields and words past the fields' caps, as a fixed point of the reader, and
// paints frames a browser accepts; nothing important leaves the safe margin;
// right to left is the mirror image of left to right; the two list readers
// (notifications, messages) read what a person writes and survive anything;
// and each template does what its comment says it does.
import { readFileSync } from 'node:fs';
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { PRO_A_RECIPES, notesOf, messagesOf } from '../.test-build/motionrecipes-pro-a.js';
import { buildMotion, RECIPES, sampleFields } from '../.test-build/motiontemplates.js';
import { META, makeKit, paletteOf, PALETTE_IDS } from '../.test-build/motionrecipe.js';
import { readLayer, readMotion } from '../.test-build/motionread.js';
import { paint, makeEnv, layerBox } from '../.test-build/motiondraw.js';
import { inDone, outStart, unitsOf, stillTime } from '../.test-build/motionanim.js';
import { RECIPE_IDS, RECIPE_GROUPS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const IDS = ['lt-bar', 'lt-pill', 'lt-kicker', 'lt-neon', 'ui-notify', 'ui-scribble', 'ui-chat', 'ui-device'];
const OVERLAYS = new Set(['lt-bar', 'lt-pill', 'lt-kicker', 'lt-neon', 'ui-notify', 'ui-scribble']);
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const LONG = {
  en: 'Extraordinary Wonderful Magnificent Remarkable Splendid Brilliant Outstanding Excellent Superb',
  ar: 'مدينة جميلة جدا في شمال العراق حيث الجبال العالية والوديان الخضراء والناس الطيبون دائما هنا',
};
const ARABIC = /[\u0600-\u06FF]/;
const build = (recipe, lang, format, more = {}) => buildMotion({ id: 'x', recipe, lang, format, now: 0, ...more });
const fill = (recipe, v) => Object.fromEntries(META[recipe].fields.map((f) => [f.key, typeof v === 'function' ? v(f) : v]));
const by = (doc) => Object.fromEntries(doc.layers.map((l) => [l.id.slice(doc.recipe.id.length + 1), l]));

/** Fields at their longest: every line field full, a list with every item full, in a language's long words. */
function longest(recipe, lang) {
  const words = LONG[lang];
  return fill(recipe, (f) => {
    if (f.kind !== 'list') return Array.from(words).slice(0, f.max).join('');
    const item = recipe === 'ui-chat' ? (i) => `${i % 2 ? 'Me' : 'Them'}: ${words}` : () => `${Array.from(words).slice(0, 28).join('')}: ${words}`;
    return Array.from({ length: f.max }, (_, i) => Array.from(item(i)).slice(0, 80).join('')).join('\n');
  });
}

/** Paint `doc` at `t` on a fresh recording canvas: the problems it reports and whether anything was drawn. */
function draw(doc, t) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w / 4, h / 4);
  paint(c.ctx, doc, t, { strict: true });
  return { problems: c.check(), drew: drewSomething(c.calls) };
}

/** What a structural check found wrong with one built document. */
function faults(doc) {
  const out = [];
  const ids = new Set();
  for (const l of doc.layers) {
    if (ids.has(l.id)) out.push(`duplicate id ${l.id}`);
    ids.add(l.id);
    if (!l.id.startsWith(`${doc.recipe.id}-`)) out.push(`id ${l.id} was not made by the kit (longer than 40 characters?)`);
    if (!l.name) out.push(`${l.id} has no name`);
    if (/\d/.test(l.name) && !/^Shine \d+$/.test(l.name)) out.push(`${l.id} is named with a number nothing translates: ${l.name}`);
    if (!same(readLayer(l, { seconds: doc.seconds }), l)) out.push(`${l.id} is not a fixed point of readLayer`);
    if (!(l.start < l.end && l.end <= doc.seconds + 1e-9 && l.start >= 0)) out.push(`${l.id} lives ${l.start}..${l.end} of ${doc.seconds}`);
    if (l.kind === 'text' && l.text && !(l.max > 0)) out.push(`${l.id} carries words with no wrap width`);
  }
  if (doc.layers.length > 60) out.push(`${doc.layers.length} layers`);
  return out;
}

/** Every layer's box at `t`, in u, keyed by its id without the recipe: what the stage would outline. */
function boxes(doc, t) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w, h);
  const env = makeEnv(c.ctx, doc, t, w, h);
  const out = {};
  for (const l of doc.layers) {
    if (l.kind === 'backdrop' || l.kind === 'particles') continue;
    const b = layerBox(env, l);
    if (b) out[l.id.slice(doc.recipe.id.length + 1)] = { x: b.x / env.k, y: b.y / env.k, w: b.w / env.k, h: b.h / env.k, rot: b.rot, W: w / env.k, H: h / env.k, blend: l.blend, kind: l.kind };
  }
  return out;
}

// ── the set ───────────────────────────────────────────────────────────────

const idsSrc = readFileSync(new URL('../src/motionids.ts', import.meta.url), 'utf8');
const listed = [...idsSrc.slice(idsSrc.indexOf('PRO_A_IDS'), idsSrc.indexOf(']', idsSrc.indexOf('PRO_A_IDS'))).matchAll(/'([^']*)'/g)].map((m) => m[1]);
ok('PRO_A_IDS, the recipes and the metadata are the same eight templates', same(listed, IDS) && same(Object.keys(PRO_A_RECIPES), IDS)
  && IDS.every((id) => META[id]?.id === id && RECIPE_IDS.includes(id)), listed);
ok('the templates bundle is current (it holds these recipes, not an older build)', IDS.every((id) => RECIPES[id] && same(RECIPES[id].sample, PRO_A_RECIPES[id].sample)));
ok('the ids are short and kebab-case, so every layer id stays inside the reader\'s 40 characters', IDS.every((id) => /^(lt|ui)-[a-z]+$/.test(id) && id.length <= 12));

const i18n = readFileSync(new URL('../src/i18n.ts', import.meta.url), 'utf8');
const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\r?\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*\r?$/gm;
const dictOf = (lang) => {
  const a = i18n.indexOf(`const ${lang}: Dict = {`);
  return new Map([...i18n.slice(a, i18n.indexOf('\n};', a)).matchAll(ENTRY)].map((m) => [m[1].replace(/\\'/g, "'"), m[2]]));
};
const dicts = { ar: dictOf('ar'), ckb: dictOf('ckb'), kmr: dictOf('kmr') };
const translated = (s) => ['ar', 'ckb', 'kmr'].every((l) => (dicts[l].get(s) ?? '').trim() !== '' && dicts[l].get(s) !== s);

for (const id of IDS) {
  const m = META[id];
  const sentence = (s) => typeof s === 'string' && /^[A-Z].{10,150}\.$/.test(s);
  ok(`${id}: metadata is well-formed — group, length of 4 to 8 seconds, a palette, at most 4 fields, tags, when to use it and when not`,
    RECIPE_GROUPS.includes(m.group) && m.seconds >= 4 && m.seconds <= 8 && PALETTE_IDS.includes(m.palette) && m.fields.length >= 1 && m.fields.length <= 4
    && Array.isArray(m.tags) && m.tags.length >= 5 && m.tags.every((t) => t === t.toLowerCase() && t.trim() === t && t.length <= 20)
    && sentence(m.useWhen) && sentence(m.avoidWhen) && sentence(m.about) && (m.pairsWith ?? []).every((p) => RECIPE_IDS.includes(p) && p !== id)
    && m.overlay === OVERLAYS.has(id) && Number.isFinite(m.hue));
  ok(`${id}: its name, its description and its field labels are translated into Arabic, Sorani and Badini`,
    [m.name, m.about, ...m.fields.map((f) => f.label)].every(translated), [m.name, m.about, ...m.fields.map((f) => f.label)].filter((s) => !translated(s)));
  const r = PRO_A_RECIPES[id];
  ok(`${id}: a sample for every field in every language, within the field's limit, with no Arabic-Indic digits`,
    LANGS.every((lang) => m.fields.every((f) => {
      const v = r.sample[lang]?.[f.key];
      const fits = f.kind === 'list' ? v.split('\n').length <= f.max && v.split('\n').every((l) => Array.from(l).length <= 80) : Array.from(v).length <= f.max;
      return typeof v === 'string' && v.trim() !== '' && fits && !/[\u0660-\u0669\u06F0-\u06F9]/.test(v);
    })));
  ok(`${id}: the Arabic and Kurdish samples are in Arabic script, the Kurdish ones with Kurdish letters, the English ones in Latin`,
    ['ar', 'ckb', 'kmr'].every((l) => Object.values(r.sample[l]).some((v) => ARABIC.test(v))) && /[ڕڵۆێەڤ]/.test(Object.values(r.sample.ckb).join(' '))
    && /[ڕۆێەڤ]/.test(Object.values(r.sample.kmr).join(' ')) && !Object.values(r.sample.en).some((v) => ARABIC.test(v)));
}
ok('groups: the lower thirds, notifications and the circle are overlays, the chat a title, the device a brand piece',
  IDS.every((id) => META[id].group === (OVERLAYS.has(id) ? 'overlays' : id === 'ui-chat' ? 'titles' : 'brand')));

// ── every template × language × shape ─────────────────────────────────────

for (const id of IDS) {
  const problems = [];
  const order = [];
  const idsByLang = {};
  let drewAtStill = true;
  const drawProblems = [];
  for (const lang of LANGS) {
    for (const format of FORMATS) {
      let doc;
      try {
        doc = build(id, lang, format);
      } catch (e) {
        problems.push(`${lang}/${format} threw ${e}`);
        continue;
      }
      problems.push(...faults(doc).map((p) => `${lang}/${format}: ${p}`));
      if (OVERLAYS.has(id) !== (doc.backdrop === null)) problems.push(`${lang}/${format}: backdrop ${JSON.stringify(doc.backdrop)}`);
      (idsByLang[lang] ??= new Set()).add(doc.layers.map((l) => l.id).join(','));
      for (const l of doc.layers) {
        const n = unitsOf(l);
        if (inDone(l, n) > outStart(l, n) + 1e-9) order.push(`${lang}/${format} ${l.id}: arrives until ${inDone(l, n).toFixed(3)}, leaves from ${outStart(l, n).toFixed(3)}`);
      }
      const still = stillTime(doc.layers, doc.seconds);
      const s = draw(doc, still);
      if (!s.drew) drewAtStill = false;
      drawProblems.push(...s.problems.map((p) => `${lang}/${format} @${still.toFixed(2)}: ${p}`));
      for (let i = 0; i < 40; i++) {
        const t = (i / 40) * doc.seconds;
        drawProblems.push(...draw(doc, t).problems.map((p) => `${lang}/${format} @${t.toFixed(2)}: ${p}`));
      }
    }
  }
  ok(`${id}: builds in every language and shape; every layer is a fixed point of the reader, named, inside the graphic, its words with a wrap width`, !problems.length, problems.slice(0, 4));
  // The device is a browser when wide and a phone otherwise, so its window buttons and the phone's island differ; every other id is shared.
  const shared = (list) => list.split(',').filter((x) => !/-(dot-\d|address|address-text|lock|island|button-power|button-volume)$/.test(x)).join(',');
  ok(`${id}: layer ids are the same in every shape, so a selection survives a change of format`,
    LANGS.every((l) => new Set([...(idsByLang[l] ?? [])].map(id === 'ui-device' ? shared : (x) => x)).size === 1));
  ok(`${id}: every layer has finished arriving before it starts to leave`, !order.length, order.slice(0, 3));
  ok(`${id}: something is drawn at the still the gallery shows`, drewAtStill);
  ok(`${id}: 40 frames across the length draw nothing a browser would reject`, !drawProblems.length, drawProblems.slice(0, 3));
}

for (const id of IDS) {
  const problems = [];
  for (const seconds of [1, 2, 30]) {
    for (const [lang, format] of [['en', 'landscape'], ['ckb', 'portrait'], ['ar', 'feed']]) {
      try {
        const doc = build(id, lang, format, { seconds });
        problems.push(...faults(doc).map((p) => `${seconds}s ${lang}: ${p}`));
        const still = stillTime(doc.layers, doc.seconds);
        if (!draw(doc, still).drew) problems.push(`${seconds}s ${lang}: nothing drawn at ${still}`);
        for (let i = 0; i < 12; i++) problems.push(...draw(doc, (i / 12) * seconds).problems);
        if (seconds >= 2) {
          for (const l of doc.layers) {
            const n = unitsOf(l);
            if (inDone(l, n) > outStart(l, n) + 1e-9) problems.push(`${seconds}s ${l.id} leaves before it has arrived`);
          }
        }
      } catch (e) {
        problems.push(`${seconds}s ${lang} threw ${e}`);
      }
    }
  }
  ok(`${id}: works at 1, 2 and 30 seconds`, !problems.length, problems.slice(0, 3));
}

// ── words: the longest, Arabic, one, none, past the caps ──────────────────

for (const id of IDS) {
  const problems = [];
  const cases = {
    'the longest words': ['en', longest(id, 'en')],
    'the longest Arabic words': ['ar', longest(id, 'ar')],
    'one word': ['en', fill(id, (f) => (f.kind === 'list' ? 'Hi' : 'Hi'))],
    'empty fields': ['en', fill(id, '')],
  };
  for (const [what, [lang, fields]] of Object.entries(cases)) {
    for (const format of FORMATS) {
      try {
        const doc = build(id, lang, format, { fields });
        problems.push(...faults(doc).map((p) => `${what} ${format}: ${p}`));
        const s = draw(doc, stillTime(doc.layers, doc.seconds));
        problems.push(...s.problems.map((p) => `${what} ${format}: ${p}`));
        if (!s.drew) problems.push(`${what} ${format}: nothing drawn`);
      } catch (e) {
        problems.push(`${what} ${format} threw ${e}`);
      }
    }
  }
  // Past the fields' own caps, straight into the recipe.
  try {
    const kit = makeKit({ recipe: id, lang: 'en', format: 'portrait', palette: paletteOf(META[id].palette).colors, seconds: META[id].seconds, fields: fill(id, 'x'.repeat(40) + ' ' + 'y'.repeat(49) + '\n' + 'z'.repeat(300)) });
    for (const l of PRO_A_RECIPES[id].build(kit)) if (!same(readLayer(l, { seconds: kit.seconds }), l)) problems.push(`uncapped: ${l.id} is not a fixed point`);
  } catch (e) {
    problems.push(`uncapped threw ${e}`);
  }
  ok(`${id}: the longest words, long Arabic, one word, empty fields and words past the caps build and draw cleanly`, !problems.length, problems.slice(0, 3));
}

for (const id of IDS) {
  const outside = [];
  for (const lang of ['en', 'ar']) {
    for (const format of FORMATS) {
      for (const fields of [undefined, longest(id, lang)]) {
        const doc = build(id, lang, format, { fields });
        const still = stillTime(doc.layers, doc.seconds);
        const margin = format === 'landscape' ? 8 : 6;
        for (const [lid, b] of Object.entries(boxes(doc, still))) {
          // A glow is meant to spill past the frame.
          if (b.blend === 'screen') continue;
          const a = (b.rot * Math.PI) / 180;
          const hw = (b.w * Math.abs(Math.cos(a)) + b.h * Math.abs(Math.sin(a))) / 2;
          const hh = (b.w * Math.abs(Math.sin(a)) + b.h * Math.abs(Math.cos(a))) / 2;
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const slack = 0.5;
          if (cx - hw < margin - slack || cy - hh < margin - slack || cx + hw > b.W - margin + slack || cy + hh > b.H - margin + slack) {
            outside.push(`${lang}/${format}${fields ? ' long' : ''} ${lid} at ${(cx - hw).toFixed(1)},${(cy - hh).toFixed(1)} ${(2 * hw).toFixed(1)}x${(2 * hh).toFixed(1)} of ${b.W.toFixed(0)}x${b.H.toFixed(0)}`);
          }
        }
      }
    }
  }
  ok(`${id}: with the samples and with the longest words, everything stays inside the safe margin`, !outside.length, outside.slice(0, 3));
}

for (const id of IDS) {
  const off = [];
  for (const format of FORMATS) {
    const fields = { ...PRO_A_RECIPES[id].sample.en };
    const ltr = build(id, 'en', format, { fields });
    const rtl = build(id, 'ar', format, { fields });
    const t = stillTime(ltr.layers, ltr.seconds);
    const a = boxes(ltr, t);
    const b = boxes(rtl, t);
    for (const lid of Object.keys(a)) {
      const p = a[lid];
      const q = b[lid];
      if (!q) { off.push(`${format} ${lid} missing right to left`); continue; }
      const mirrored = Math.abs(q.x - (p.W - p.x - p.w)) < 0.05 && Math.abs(q.y - p.y) < 0.05 && Math.abs(q.w - p.w) < 0.05 && Math.abs(q.rot + p.rot) < 0.05;
      if (!mirrored) off.push(`${format} ${lid}: ${p.x.toFixed(2)}→${q.x.toFixed(2)} rot ${p.rot.toFixed(1)}→${q.rot.toFixed(1)}`);
    }
    if (!same(ltr.layers.map((l) => l.pin), rtl.layers.map((l) => l.pin))) off.push(`${format}: pins differ between directions`);
  }
  ok(`${id}: right to left is the mirror image of left to right, box for box, with the same pins`, !off.length, off.slice(0, 3));
}
ok('the lower thirds are pinned at the bottom-start corner, so they sit on the right in Arabic and Kurdish',
  ['lt-bar', 'lt-kicker', 'lt-neon'].every((id) => build(id, 'ar', 'landscape').layers.every((l) => l.pin === 'bs'))
  && build('lt-pill', 'ar', 'landscape').layers.every((l) => l.pin === 'ms'));
{
  const off = [];
  for (const id of IDS) {
    for (const lang of LANGS) {
      const doc = build(id, lang, 'landscape');
      const still = stillTime(doc.layers, doc.seconds);
      const words = doc.layers.filter((l) => l.kind === 'text' && l.start <= still && still < l.end);
      if (!words.length || words.some((l) => still < inDone(l, unitsOf(l)) - 1e-9 || still > outStart(l, unitsOf(l)) + 1e-9)) off.push(`${id}/${lang} @${still.toFixed(2)}`);
      // No band of light is half-way across a plate in the gallery's picture (the neon's running light is its look, and stays).
      if (doc.layers.some((l) => l.loop?.fx === 'shimmer' && l.id !== 'lt-neon-light' && l.start <= still && still < l.end)) off.push(`${id}/${lang}: a shine crosses the still`);
    }
  }
  ok('every template\'s gallery still shows its words settled, and no shine half-way across them', !off.length, off);
}
{
  const missing = new Set();
  for (const id of IDS) for (const lang of LANGS) for (const format of FORMATS) for (const seconds of [undefined, 2, 30]) {
    for (const l of build(id, lang, format, { seconds }).layers) if (!translated(l.name.replace(/\d+/g, '{n}'))) missing.add(l.name);
  }
  ok('every layer name these templates give is translated into Arabic, Sorani and Badini', !missing.size, [...missing]);
}

// ── the list readers ──────────────────────────────────────────────────────

ok('notifications: Title: line is a title and a line',
  same(notesOf('New order: 2 tickets\nReminder:   Call Lana  '), [{ title: 'New order', body: '2 tickets' }, { title: 'Reminder', body: 'Call Lana' }]));
ok('notifications: a time is not a title, nor is a line with nothing after its colon',
  same(notesOf('Meet at 10:30 today'), [{ title: 'Meet at 10:30 today', body: '' }]) && same(notesOf('Done:'), [{ title: 'Done', body: '' }]));
ok('notifications: a full-width colon counts, a long first part does not, blank lines are skipped, three at most',
  same(notesOf('رسالة\uFF1Aمرحبا'), [{ title: 'رسالة', body: 'مرحبا' }]) && notesOf('x'.repeat(41) + ': y')[0].body === ''
  && notesOf('\n\na\n\nb\nc\nd\ne').length === 3 && same(notesOf(''), []) && same(notesOf(null), []) && same(notesOf(42), []));
ok('messages: Me is the person\'s side, Them or a name the other\'s, in all four languages',
  same(messagesOf('Them: hi\nMe: hey\nLana: ok\nأنا: نعم\nمن: باشە\nئەز: باشە\nME: x').map((m) => m.me), [false, true, false, true, true, true]));
ok('messages: an unlabelled line answers the one before it, a time is not a label, an empty message is skipped, six at most',
  same(messagesOf('Hello\nHi there\nSee you at 7:30'), [{ me: false, text: 'Hello' }, { me: true, text: 'Hi there' }, { me: false, text: 'See you at 7:30' }])
  && same(messagesOf('Me:\nThem: ok'), [{ me: false, text: 'ok' }]) && messagesOf('a\nb\nc\nd\ne\nf\ng\nh').length === 6 && same(messagesOf(undefined), []));
ok('a line cut at the field\'s 80 characters mid-word ends in an ellipsis, not a broken word',
  notesOf(`Title: ${'word '.repeat(20)}`.slice(0, 80))[0].body.endsWith('\u2026') && !/ w\u2026$/.test(notesOf(`T: ${'abcdefgh '.repeat(9)}`.slice(0, 80))[0].body)
  && messagesOf('Me: short one')[0].text === 'short one');
{
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ALPHABET = ['a', 'Z', ' ', ':', '\uFF1A', '\n', '\n', '7', '0', 'م', 'ێ', 'ڕ', '\u200C', '\u202E', '\u2026', '!', '@', 'Me', 'أنا', '\t', '  ', '😀', '\uD800'];
  const bad = [];
  for (let i = 0; i < 3000; i++) {
    let s = '';
    for (let n = Math.floor(rnd() * 160); n > 0; n--) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    try {
      const a = notesOf(s);
      const b = messagesOf(s);
      if (a.length > 3 || a.some((x) => typeof x.title !== 'string' || !x.title || typeof x.body !== 'string' || x.title !== x.title.trim())) bad.push(`notes ${JSON.stringify(s)}`);
      if (b.length > 6 || b.some((x) => typeof x.me !== 'boolean' || !x.text || x.text.includes('\n'))) bad.push(`messages ${JSON.stringify(s)}`);
      if (!same(a, notesOf(s)) || !same(b, messagesOf(s))) bad.push(`not deterministic ${JSON.stringify(s)}`);
    } catch (e) {
      bad.push(`threw ${e} on ${JSON.stringify(s)}`);
    }
  }
  ok('3000 random lists: the readers never throw, never return more than they may, and read the same twice', !bad.length, bad.slice(0, 3));
}
{
  // Hostile words straight through the template, as a model or a paste could give them.
  const HOSTILE = ['', ' ', 'W'.repeat(5000), '\u202Eevil\u202C', 'Me:\nMe:\nMe:', ':::\n:::', 'a:b:c:d\n'.repeat(50), '\uD800 \uDFFF', '👩\u200D👩\u200D👧\u200D👦'.repeat(40), 'مدينة '.repeat(200), 'Label: 1\n'.repeat(100)];
  const bad = [];
  for (const id of IDS) {
    HOSTILE.forEach((value, h) => {
      const lang = LANGS[h % 4];
      const format = FORMATS[(h + IDS.indexOf(id)) % 4];
      try {
        const m = build(id, lang, format, { fields: fill(id, value) });
        if (!same(build(id, lang, format, { fields: fill(id, value) }), m)) bad.push(`${id}/${h} not deterministic`);
        if (!same(readMotion(JSON.parse(JSON.stringify(m)), 0), m)) bad.push(`${id}/${h} not a fixed point`);
        if (!m.layers.length) bad.push(`${id}/${h} empty`);
        for (let i = 0; i < 8; i++) { const p = draw(m, (m.seconds * i) / 7).problems; if (p.length) { bad.push(`${id}/${h}: ${p[0]}`); break; } }
      } catch (e) {
        bad.push(`${id}/${h} threw ${e}`);
      }
    });
  }
  ok('hostile words in every field of every template: deterministic, fixed points, never empty, clean frames', !bad.length, bad.slice(0, 4));
}

// ── what each one does ────────────────────────────────────────────────────

{
  const doc = build('lt-bar', 'en', 'landscape');
  const l = by(doc);
  ok('news bar: a tab grows up, a sweep of accent grows from it across the plate and hands over to one that collapses toward the end',
    l.tab.in.fx === 'grow' && l.tab.in.dir === 'up' && l.sweep.in.fx === 'grow' && l.sweep.in.dir === 'start' && l.sweep.end === l['sweep-out'].start
    && l['sweep-out'].out.fx === 'grow' && l['sweep-out'].out.dir === 'end' && Math.abs(l['sweep-out'].out.d - (l['sweep-out'].end - l['sweep-out'].start)) < 1e-6);
  ok('news bar: the plate is there under the sweep the moment it is full, and the name masks up as the colour leaves',
    l.plate.start === l.sweep.end && l.name.start === l.sweep.end && l.name.in.fx === 'mask' && doc.layers.indexOf(l.name) < doc.layers.indexOf(l['sweep-out']));
  ok('news bar: the role sits on a strip of the ink, in the ground colour, in capitals in Latin',
    l.strip.fill === 'fg' && l.role.color === 'bg' && l.role.caps && build('lt-bar', 'ar', 'landscape').layers.find((x) => x.id === 'lt-bar-role').caps === false);
  ok('news bar: the plate is sized to the name, the words fitted inside it',
    l.name.fit && l.name.max < l.plate.w && by(build('lt-bar', 'en', 'landscape', { fields: { name: 'Al', role: 'Chef' } })).plate.w < l.plate.w);
  ok('news bar: it leaves in reverse and the tab is last, on the last frame', l.tab.end === doc.seconds && l.plate.end < l.tab.end && l.name.end < l.plate.end && l.strip.end < l.plate.end);
  ok('news bar: with no role there is no strip, and the tab is only as tall as the plate',
    (() => { const d = by(build('lt-bar', 'en', 'landscape', { fields: { name: 'Dara', role: '' } })); return !d.strip && !d.role && Math.abs(d.tab.h - d.plate.h) < 1e-6; })());
}
{
  const doc = build('lt-pill', 'en', 'landscape');
  const l = by(doc);
  ok('soft pill: a round pill springs in, a badge pops and a person icon draws itself on it, then the name and role rise',
    l.pill.radius === l.pill.h / 2 && l.pill.in.fx === 'pop' && l.pill.in.ease === 'back-out' && l.badge.in.fx === 'pop' && l.icon.icon === 'user' && l.icon.in.fx === 'draw'
    && l.name.in.fx === 'rise' && l.role.start > l.name.start);
  ok('soft pill: it is made for a light palette and its badge is the solid accent', META['lt-pill'].palette === 'daylight' && l.badge.fill === 'accent');
  ok('soft pill: a long name makes a longer pill, up to the frame',
    by(build('lt-pill', 'en', 'landscape', { fields: { name: 'Alexandra Konstantinopoulou', role: 'Host' } })).pill.w > l.pill.w);
}
{
  const doc = build('lt-kicker', 'en', 'landscape');
  const l = by(doc);
  ok('kicker: the tag straddles the plate\'s top edge, at the words\' start',
    Math.abs((-l.tag.y + l.tag.h / 2) - (-l.plate.y + l.plate.h)) < 1e-3 && l.tag.x === l.name.x && l.kicker.caps && l.tag.fill === 'accent');
  ok('kicker: the underline draws from the start under the name, as long as the name and no longer than the plate allows',
    l.underline.in.fx === 'grow' && l.underline.in.dir === 'start' && l.underline.w <= l.plate.w - 2 && l.underline.start > l.name.start);
  const bare = by(build('lt-kicker', 'en', 'landscape', { fields: { kicker: '', name: 'Aram Karim', role: 'Scientist' } }));
  ok('kicker: with no kicker there is no tag and the plate is shorter', !bare.tag && !bare.kicker && bare.plate.h < l.plate.h);
}
{
  const doc = build('lt-neon', 'en', 'landscape');
  const l = by(doc);
  ok('neon: the tube traces the outline, the plate fills in behind it as it closes, and the glow flickers once and comes on',
    l.tube.in.fx === 'draw' && l.tube.fill === null && l.plate.start > l.tube.start && l.plate.start < inDone(l.tube)
    && l['glow-flicker'].end - l['glow-flicker'].start < 0.1 && l.glow.start > l['glow-flicker'].end && l.glow.shadow?.color === 'accent');
  ok('neon: the name glows in the accent, the role is in the second accent, a light runs along the tube while it holds',
    l.name.shadow?.color === 'accent' && l.role.color === 'accent2' && l.light?.loop?.fx === 'shimmer' && l.light.stroke.color === '#ffffff00');
  ok('neon: it leaves with the tube drawing itself back out on the last frame', l.tube.out.fx === 'draw' && l.tube.end === doc.seconds);
}
{
  const doc = build('ui-notify', 'en', 'landscape');
  const cards = doc.layers.filter((l) => /^ui-notify-card-\d$/.test(l.id));
  ok('notifications: three cards, eight tenths of a second apart, sliding in from the end in a wide frame and leaving top first',
    cards.length === 3 && cards.every((c, i) => Math.abs(c.start - (0.3 + 0.8 * i)) < 1e-6 && c.in.fx === 'slide' && c.in.dir === 'end' && c.in.ease === 'back-out')
    && cards[0].end < cards[1].end && cards[1].end < cards[2].end && cards.every((c) => c.pin === 'ts'));
  const tall = build('ui-notify', 'en', 'portrait').layers.filter((l) => /^ui-notify-card-\d$/.test(l.id));
  ok('notifications: in the tall shapes they drop in at the top centre', tall.every((c) => c.in.fx === 'drop' && Math.abs(c.x - (100 - c.w) / 2) < 1e-3));
  ok('notifications: everything on a card moves with it', ['icon', 'title', 'time', 'text', 'glass'].every((p) => {
    const x = doc.layers.find((l) => l.id === `ui-notify-card-2-${p}`);
    return x && same(x.in, cards[1].in) && same(x.out, cards[1].out) && x.start === cards[1].start && x.end === cards[1].end;
  }));
  const icon = (lang) => build('ui-notify', lang, 'landscape').layers.filter((l) => l.kind === 'icon').map((l) => l.icon);
  ok('notifications: the icon follows the words in every language — a message, a delivery, a reminder', LANGS.every((lang) => same(icon(lang), ['chat', 'truck', 'clock'])), LANGS.map(icon));
  ok('notifications: a card says "now" in the graphic\'s language', same(LANGS.map((lang) => build('ui-notify', lang, 'square').layers.find((l) => l.id === 'ui-notify-card-1-time').text), ['now', 'الآن', 'ئێستا', 'نوکە']));
  const long = build('ui-notify', 'en', 'landscape', { fields: { items: `${LONG.en.slice(0, 39)}: short\nOrder: ${LONG.en}` } });
  const lt = by(long);
  ok('notifications: a long title is cut to one line and a long line to two, each with an ellipsis',
    !lt['card-1-title'].text.includes('\n') && lt['card-1-title'].text.endsWith('\u2026') && lt['card-2-text'].text.split('\n').length === 2 && lt['card-2-text'].text.endsWith('\u2026'));
  ok('notifications: a list emptied of every line shows the example rather than nothing',
    build('ui-notify', 'kmr', 'landscape', { fields: { items: '' } }).layers.filter((l) => /^ui-notify-card-\d$/.test(l.id)).length === 3);
}
{
  const doc = build('ui-scribble', 'en', 'landscape');
  const l = by(doc);
  ok('circle: a marker loop draws itself round the word, a fainter second pass follows, then the arrow, its head, the note and its underline',
    l.word.in.fx === 'pop' && l.circle.shape === 'path' && l.circle.in.fx === 'draw' && l['circle-2'].start > l.circle.start && l['circle-2'].opacity < 1
    && l.arrow.start > l.circle.start && l.arrowhead.start >= inDone(l.arrow) - 0.05 && l.label.in.fx === 'type' && l.underline.start > l.label.start);
  ok('circle: the words carry an outline in the ground colour rather than a plate', l.word.outline?.color === 'bg' && l.label.outline?.color === 'bg');
  const ar = by(build('ui-scribble', 'ar', 'landscape', { fields: PRO_A_RECIPES['ui-scribble'].sample.en }));
  const firstX = (d) => Number(/^M([\d.-]+)/.exec(d)[1]);
  ok('circle: right to left, every mark is drawn mirrored and the note tilts the other way',
    Math.abs(firstX(ar.circle.d) - (100 - firstX(l.circle.d))) < 0.02 && Math.abs(firstX(ar.arrow.d) - (100 - firstX(l.arrow.d))) < 0.02 && ar.label.rot === -l.label.rot && l.label.rot !== 0);
  ok('circle: the same words draw the same loop; other words a slightly different one',
    by(build('ui-scribble', 'en', 'square')).circle.d === by(build('ui-scribble', 'en', 'square')).circle.d
    && by(build('ui-scribble', 'en', 'square', { fields: { word: 'Sale', label: 'Today' } })).circle.d !== by(build('ui-scribble', 'en', 'square')).circle.d);
  const empty = by(build('ui-scribble', 'en', 'landscape', { fields: { word: '', label: 'Watch this' } }));
  ok('circle: with no word it circles what is under it, at a size of its own', !empty.word && empty.circle.w > 30 && empty.circle.h > 20);
  ok('circle: a long word shrinks before it is cut', !by(build('ui-scribble', 'en', 'portrait', { fields: { word: 'Extraordinary', label: 'x' } })).word.text.includes('\n'));
}
{
  const doc = build('ui-chat', 'en', 'landscape');
  const l = by(doc);
  const msgs = doc.layers.filter((x) => /^ui-chat-message-\d$/.test(x.id));
  const mid = (x) => x.x + x.w / 2;
  ok('chat: their messages sit on the start side, the person\'s on the end side, in the accent',
    msgs.length === 4 && mid(msgs[0]) < mid(msgs[1]) && msgs[1].fill === 'accent' && msgs[0].fill === 'fg' && msgs[0].opacity < 0.2
    && msgs[0].name === 'Their message' && msgs[1].name === 'Your message');
  const typing = doc.layers.filter((x) => /^ui-chat-typing-\d$/.test(x.id));
  ok('chat: before each of theirs, three dots say they are typing, and the message replaces them in the same place',
    typing.length === 2 && typing.every((t) => { const m = l[`message-${t.id.slice(-1)}`]; return t.end === m.start && t.y === m.y && t.x === m.x; })
    && doc.layers.filter((x) => /^ui-chat-typing-\d-dot-\d$/.test(x.id)).every((x) => x.loop?.fx === 'float'));
  ok('chat: the messages arrive in order at a reading pace, and the whole conversation lifts away at the end',
    msgs.every((m, i) => !i || m.start - msgs[i - 1].start >= 0.7) && msgs.every((m) => m.end === doc.seconds && m.out.fx === 'drop'));
  ok('chat: a bubble is as wide as its words and its sender\'s lower corner is square',
    by(build('ui-chat', 'en', 'landscape', { fields: { name: '', items: 'Me: ok' } }))['message-1'].w < msgs[1].w
    && /L100 [\d.]+A[\d.]+ [\d.]+ 0 0 1 [\d.]+ 100/.test(msgs[1].d));
  ok('chat: the header shows the other person\'s initial and name, and there is none without a name',
    l.initial.text === 'L' && l.contact.text === 'Lana' && !by(build('ui-chat', 'en', 'landscape', { fields: { name: '', items: 'Me: hi' } })).avatar);
  // Six long messages still fit the frame: smaller type first, then fewer lines a bubble.
  const full = build('ui-chat', 'en', 'landscape', { fields: longest('ui-chat', 'en') });
  const fb = boxes(full, stillTime(full.layers, full.seconds));
  const texts = full.layers.filter((x) => /^ui-chat-message-\d-text$/.test(x.id));
  ok('chat: six long messages fit the frame, each at most four lines and cut with an ellipsis',
    texts.length === 6 && Object.values(fb).every((b) => b.y >= 6 && b.y + b.h <= b.H - 6) && texts.every((x) => x.text.split('\n').length <= 4 && x.text.endsWith('\u2026')));
  const short = build('ui-chat', 'en', 'landscape', { seconds: 4 });
  ok('chat: a shorter graphic presses the conversation together, and every message has arrived before the exit',
    short.layers.filter((x) => /^ui-chat-message-\d$/.test(x.id)).every((m) => inDone(m) <= outStart(m) - 0.5));
}
{
  const wide = by(build('ui-device', 'en', 'landscape'));
  const tall = by(build('ui-device', 'en', 'portrait'));
  ok('device: a browser window when wide, a phone in portrait', wide.body.name === 'Browser window' && wide.address && !wide.island
    && tall.body.name === 'Phone' && tall.island && tall['button-power'] && !tall.address);
  const parts = ['body', 'screen', 'address', 'lock', 'dot-1', 'address-text'];
  ok('device: every part of the device rises as one and sinks as one', parts.every((p) => same(wide[p].in, wide.body.in) && same(wide[p].out, wide.body.out) && wide[p].end === wide.body.end)
    && same(wide['screen-light'].out, wide.body.out) && same(wide['screen-word'].out, wide.body.out));
  ok('device: once it has landed the screen lights from the bottom and the word on it pops in',
    wide['screen-light'].in.fx === 'wipe' && wide['screen-light'].in.dir === 'up' && wide['screen-light'].start >= inDone(wide.body) - 0.25 && wide['screen-word'].start > wide['screen-light'].start);
  ok('device: the headline is beside the device when wide and above it in portrait',
    wide.title.x + wide.title.max / 2 < wide.body.x - wide.body.w / 2 && tall.title.y < tall.body.y - tall.body.h / 2 && tall.title.align === 'center');
  ok('device: no word, no word on the screen — a clean screen for a picture', !by(build('ui-device', 'en', 'square', { fields: { title: 'Hello', subtitle: '', screen: '' } }))['screen-word']);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
