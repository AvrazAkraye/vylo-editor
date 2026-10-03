// The overlay and brand recipes (motionrecipes-overlays.ts): lower third,
// subscribe, callout, social handle, logo reveal, countdown, intro sting.
//
//   npx esbuild src/motionrecipes-overlays.ts src/motiontemplates.ts src/motionrecipe.ts src/motionread.ts \
//     src/motiondraw.ts src/motionanim.ts --bundle --format=esm --outdir=.test-build --log-level=error \
//     && node test/motionrecipes-overlays.test.mjs
//
// What matters: every recipe builds in every language and every shape, at its
// own length and at 2 and 30 seconds, with 90-character words and with one
// word; what it builds is already what the reader would make of it (a fixed
// point — nothing is clamped behind the designer's back); layer ids are the
// same in every shape, so a selection survives a change of format; every layer
// lives inside the graphic and finishes arriving before it starts to leave;
// every frame draws only what a browser accepts, and the still the gallery
// shows is not empty and catches no sweep of light half-way across the glass
// (at any length); an overlay's frame is transparent and its words stay
// inside the safe margin; and right to left is the mirror image of left to
// right, box for box.
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { OVERLAY_RECIPES } from '../.test-build/motionrecipes-overlays.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';
import { META, makeKit, paletteOf } from '../.test-build/motionrecipe.js';
import { readLayer } from '../.test-build/motionread.js';
import { paint, makeEnv, layerBox } from '../.test-build/motiondraw.js';
import { inDone, outStart, unitsOf, stillTime } from '../.test-build/motionanim.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const IDS = ['lower-third', 'subscribe', 'callout', 'handle', 'logo-reveal', 'countdown', 'intro'];
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const OVERLAYS = new Set(['lower-third', 'subscribe', 'callout', 'handle']);
const LONG = { en: 'Extraordinary Wonderful Magnificent Remarkable Splendid Brilliant Outstanding Excellent Superb', ar: 'مدينة جميلة جدا في شمال العراق حيث الجبال العالية والوديان الخضراء والناس الطيبون دائما هنا' };
const build = (recipe, lang, format, more = {}) => buildMotion({ id: 'x', recipe, lang, format, now: 0, ...more });
const fill = (recipe, v) => Object.fromEntries(META[recipe].fields.map((f) => [f.key, typeof v === 'function' ? v(f) : v]));

/** Paint `doc` at `t` on a fresh recording canvas; the problems it reports and whether anything was drawn. */
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
    if (!l.id.startsWith(`${doc.recipe.id}-`)) out.push(`id ${l.id} was not made by the kit (renamed by the reader?)`);
    if (!l.name) out.push(`${l.id} has no name`);
    const again = readLayer(l, { seconds: doc.seconds });
    if (!same(again, l)) out.push(`${l.id} is not a fixed point of readLayer`);
    if (!(l.start < l.end && l.end <= doc.seconds + 1e-9 && l.start >= 0)) out.push(`${l.id} lives ${l.start}..${l.end} of ${doc.seconds}`);
    if (l.kind === 'text' && l.text && !(l.max > 0)) out.push(`${l.id} carries words with no wrap width`);
  }
  return out;
}

// ── the set ───────────────────────────────────────────────────────────────

ok('the file makes exactly the seven overlay and brand recipes', same(Object.keys(OVERLAY_RECIPES).sort(), [...IDS].sort()), Object.keys(OVERLAY_RECIPES));
ok('the templates bundle is current (it holds these recipes, not an older build of them)',
  IDS.every((id) => RECIPES[id] && same(RECIPES[id].sample, OVERLAY_RECIPES[id].sample)),
  'rebuild .test-build/motiontemplates.js with the command at the top of this file');
for (const id of IDS) {
  const r = OVERLAY_RECIPES[id];
  const keys = META[id].fields.map((f) => f.key);
  ok(`${id}: a sample for every field in every language, within the field's length`,
    LANGS.every((lang) => keys.every((k) => {
      const v = r.sample[lang]?.[k];
      const f = META[id].fields.find((x) => x.key === k);
      return typeof v === 'string' && v.trim() !== '' && Array.from(v).length <= f.max && !/[\u0660-\u0669]/.test(v);
    })));
  ok(`${id}: Kurdish samples are Kurdish, not Arabic (Sorani uses its own letters)`,
    Object.values(r.sample.ckb).join(' ').match(/[ڕڵۆێەڤ]/) !== null || id === 'countdown' && /ە/.test(r.sample.ckb.final));
}

// ── every recipe × language × shape ───────────────────────────────────────

for (const id of IDS) {
  const problems = [];
  const idsByLang = {};
  let drewAtStill = true;
  let drawProblems = [];
  let order = [];
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
      const list = doc.layers.map((l) => l.id).join(',');
      (idsByLang[lang] ??= new Set()).add(list);
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
  ok(`${id}: builds in every language and shape; every layer is a fixed point of the reader, named, inside the graphic, and its words have a wrap width`, !problems.length, problems.slice(0, 4));
  ok(`${id}: layer ids are the same in every shape`, LANGS.every((l) => idsByLang[l]?.size === 1), Object.fromEntries(LANGS.map((l) => [l, idsByLang[l]?.size])));
  ok(`${id}: every layer has finished arriving before it starts to leave`, !order.length, order.slice(0, 3));
  ok(`${id}: something is drawn at the still the gallery shows`, drewAtStill);
  ok(`${id}: 40 frames across the length draw nothing a browser would reject`, !drawProblems.length, drawProblems.slice(0, 3));
}

// In WKWebView a shape with a shadow ignores its layer's opacity (the shadow is
// set inside a nested save, where WebKit drops the alpha it inherited), so such
// a shape must never lean on a fade: no opacity below 1, no loop that dims it,
// and every entrance and exit either leaves opacity alone or pops from nothing.
{
  const FADES = new Set(['fade', 'rise', 'drop', 'slide', 'zoom', 'blur', 'spin', 'flip']);
  const leans = (a) => a && (FADES.has(a.fx) || (a.fx === 'pop' && a.amount < 2));
  const bad = [];
  for (const id of IDS) {
    for (const format of FORMATS) {
      const doc = build(id, 'en', format);
      for (const l of doc.layers) {
        if (l.kind !== 'shape' || !l.shadow) continue;
        if (l.opacity < 1 || l.loop?.fx === 'breathe') bad.push(`${l.id} opacity ${l.opacity}`);
        // A pressed copy that starts at 92% on top of the button it replaces needs no fade to arrive.
        if (leans(l.in) && !(l.id.endsWith('-pressed') && l.in.amount < 0.3)) bad.push(`${l.id} in ${l.in.fx} ${l.in.amount}`);
        if (leans(l.out)) bad.push(`${l.id} out ${l.out.fx} ${l.out.amount}`);
      }
    }
  }
  ok('no shape with a shadow leans on a fade (WebKit would draw it opaque)', !bad.length, [...new Set(bad)].slice(0, 4));
}

// ── other lengths and other words ─────────────────────────────────────────

for (const id of IDS) {
  const problems = [];
  for (const seconds of [1, 2, 30]) {
    for (const [lang, format] of [['en', 'landscape'], ['ckb', 'portrait']]) {
      try {
        const doc = build(id, lang, format, { seconds });
        problems.push(...faults(doc).map((p) => `${seconds}s ${lang}: ${p}`));
        const still = stillTime(doc.layers, doc.seconds);
        const s = draw(doc, still);
        if (!s.drew) problems.push(`${seconds}s ${lang}: nothing drawn at ${still}`);
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

for (const id of IDS) {
  const problems = [];
  const cases = {
    'long words': fill(id, (f) => (f.kind === 'number' ? '7' : LONG.en)),
    'long Arabic words': fill(id, (f) => (f.kind === 'number' ? '٧' : LONG.ar)),
    'one word': fill(id, (f) => (f.kind === 'number' ? '4' : 'Hi')),
    'empty fields': fill(id, ''),
  };
  for (const [what, fields] of Object.entries(cases)) {
    for (const format of FORMATS) {
      try {
        const doc = build(id, what.includes('Arabic') ? 'ar' : 'en', format, { fields });
        problems.push(...faults(doc).map((p) => `${what} ${format}: ${p}`));
        const still = stillTime(doc.layers, doc.seconds);
        const s = draw(doc, still);
        problems.push(...s.problems.map((p) => `${what} ${format}: ${p}`));
        if (what !== 'empty fields' && !s.drew) problems.push(`${what} ${format}: nothing drawn`);
      } catch (e) {
        problems.push(`${what} ${format} threw ${e}`);
      }
    }
  }
  // Past the fields' own caps, straight into the recipe: 90 characters in every field.
  try {
    const kit = makeKit({ recipe: id, lang: 'en', format: 'portrait', palette: paletteOf(META[id].palette).colors, seconds: META[id].seconds, fields: fill(id, 'x'.repeat(40) + ' ' + 'y'.repeat(49)) });
    const layers = OVERLAY_RECIPES[id].build(kit);
    for (const l of layers) if (!same(readLayer(l, { seconds: kit.seconds }), l)) problems.push(`uncapped: ${l.id} is not a fixed point`);
  } catch (e) {
    problems.push(`uncapped threw ${e}`);
  }
  ok(`${id}: 90-character words, one word and empty fields build and draw cleanly`, !problems.length, problems.slice(0, 3));
}

// ── layout ────────────────────────────────────────────────────────────────

/** Every layer's box at `t`, in u, keyed by id: what the stage would outline. */
function boxes(doc, t) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w, h);
  const env = makeEnv(c.ctx, doc, t, w, h);
  const out = {};
  for (const l of doc.layers) {
    if (l.kind === 'backdrop' || l.kind === 'particles') continue;
    const b = layerBox(env, l);
    if (b) out[l.id] = { x: b.x / env.k, y: b.y / env.k, w: b.w / env.k, h: b.h / env.k, rot: b.rot, W: w / env.k, H: h / env.k, blend: l.blend, kind: l.kind, spreads: l.out?.fx === 'zoom' && l.kind === 'shape' };
  }
  return out;
}

for (const id of IDS) {
  const outside = [];
  for (const lang of ['en', 'ar']) {
    for (const format of FORMATS) {
      const doc = build(id, lang, format, { fields: fill(id, (f) => (f.kind === 'number' ? '3' : f.max >= 30 ? LONG[lang].slice(0, f.max) : 'Word')) });
      const still = stillTime(doc.layers, doc.seconds);
      const margin = format === 'landscape' ? 8 : 6;
      for (const [lid, b] of Object.entries(boxes(doc, still))) {
        // Glows, flashes, the sting's bands and rings that burst outward reach past the frame on purpose.
        if (b.blend === 'screen' || b.w > b.W || lid.includes('band') || b.spreads) continue;
        // A turned box is checked by its turned corners.
        const a = (b.rot * Math.PI) / 180;
        const hw = (b.w * Math.abs(Math.cos(a)) + b.h * Math.abs(Math.sin(a))) / 2;
        const hh = (b.w * Math.abs(Math.sin(a)) + b.h * Math.abs(Math.cos(a))) / 2;
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const slack = 0.5;
        if (cx - hw < margin - slack || cy - hh < margin - slack || cx + hw > b.W - margin + slack || cy + hh > b.H - margin + slack) {
          outside.push(`${lang}/${format} ${lid} at ${(cx - hw).toFixed(1)},${(cy - hh).toFixed(1)} ${(2 * hw).toFixed(1)}x${(2 * hh).toFixed(1)}`);
        }
      }
    }
  }
  ok(`${id}: with the longest words, everything stays inside the safe margin`, !outside.length, outside.slice(0, 3));
}

for (const id of IDS) {
  const off = [];
  for (const format of FORMATS) {
    // The same words both ways, so any difference is the direction's.
    const fields = { ...OVERLAY_RECIPES[id].sample.en };
    const ltr = build(id, 'en', format, { fields });
    const rtl = build(id, 'ar', format, { fields });
    const t = stillTime(ltr.layers, ltr.seconds);
    const a = boxes(ltr, t);
    const b = boxes(rtl, t);
    for (const lid of Object.keys(a)) {
      // The pointer is drawn as every desktop draws it, pointing up-left in both directions.
      if (lid.includes('cursor')) continue;
      const p = a[lid];
      const q = b[lid];
      if (!q) { off.push(`${format} ${lid} missing right to left`); continue; }
      const mirrored = Math.abs(q.x - (p.W - p.x - p.w)) < 0.05 && Math.abs(q.y - p.y) < 0.05 && Math.abs(q.w - p.w) < 0.05 && Math.abs(q.rot + p.rot) < 0.05;
      if (!mirrored) off.push(`${format} ${lid}: ${p.x.toFixed(2)}→${q.x.toFixed(2)} rot ${p.rot.toFixed(1)}→${q.rot.toFixed(1)}`);
    }
  }
  ok(`${id}: right to left is the mirror image of left to right`, !off.length, off.slice(0, 3));
}

// ── what each one does ────────────────────────────────────────────────────

{
  const doc = build('lower-third', 'en', 'landscape');
  const by = Object.fromEntries(doc.layers.map((l) => [l.id.replace('lower-third-', ''), l]));
  ok('lower third: the bar grows up, the plate wipes out of it, the name masks and the role slides',
    by.bar.in.fx === 'grow' && by.bar.in.dir === 'up' && by.plate.in.fx === 'wipe' && by.name.in.fx === 'mask' && by.role.in.fx === 'slide');
  ok('lower third: it leaves in reverse, the bar last, on the last frame',
    by.bar.end === doc.seconds && by.plate.end < by.bar.end && by.name.end < by.plate.end && by.bar.out.fx === 'grow' && by.plate.out.fx === 'wipe');
  ok('lower third: the words are fitted to the plate', by.name.fit && by.role.fit && by.name.max <= by.plate.w && by.role.max <= by.plate.w);
  {
    // Both are pinned at their start edge, so x is where each begins.
    const padStart = by.name.x - by.plate.x;
    const after = (l) => by.plate.x + by.plate.w - (l.x + l.max);
    ok('lower third: the words end inside the plate, with headroom reaching into its end padding (SF Pro sets wider when small)',
      [by.name, by.role].every((l) => after(l) > 0 && after(l) < padStart), [after(by.name), after(by.role), padStart]);
  }
  ok('lower third: a light crosses the glass as it settles, behind the words arriving, and has crossed by the gallery\'s still',
    by.shine?.loop?.fx === 'shimmer' && by.shine.start > by.plate.start && by.shine.start < inDone(by.role)
      && by.shine.end <= stillTime(doc.layers, doc.seconds) - 0.04 && by.shine.end - by.shine.start === by.shine.loop.d && by.shine.loop.d >= 0.7,
    [by.shine?.start, by.shine?.end, stillTime(doc.layers, doc.seconds)]);
  const narrow = build('lower-third', 'en', 'landscape', { fields: { name: 'Al', role: 'Chef' } });
  const wide = build('lower-third', 'en', 'landscape', { fields: { name: 'Alexandra Konstantinopoulou-Smith', role: 'Head of International Partnerships' } });
  const plateW = (d) => d.layers.find((l) => l.id === 'lower-third-plate').w;
  ok('lower third: the plate is sized to the words', plateW(narrow) < plateW(doc) && plateW(doc) < plateW(wide), [plateW(narrow), plateW(doc), plateW(wide)]);
  const tall = build('lower-third', 'en', 'portrait');
  const bottom = (d) => { const p = d.layers.find((l) => l.id === 'lower-third-plate'); return d.format === 'portrait' ? 177.78 / 2 - p.y : 50 - p.y; };
  ok('lower third: in portrait it sits higher', bottom(tall) > bottom(doc) + 10);
  // A sweep that came back in a long hold was the last thing to arrive, so a long graphic's cover caught it instead.
  const long = build('lower-third', 'en', 'landscape', { seconds: 30 });
  ok('lower third: a long hold keeps the one sweep, so its cover is clean too', long.layers.filter((l) => l.loop?.fx === 'shimmer').length === 1);
}
{
  const doc = build('subscribe', 'en', 'landscape');
  const by = Object.fromEntries(doc.layers.map((l) => [l.id.replace('subscribe-', ''), l]));
  const click = by['button-pressed'].start;
  ok('subscribe: the button is pressed where the pointer clicks — it hands over to a smaller copy that springs back',
    by.button.end > click && by.button.end - click < 0.1 && by['button-pressed'].in.fx === 'pop' && by['button-pressed'].in.amount < 0.3);
  ok('subscribe: the label cross-fades to the one after the click, with a check that draws itself',
    by.label.end > click && by.done.start >= click && by.done.start < by.label.end && by.check.in.fx === 'draw');
  ok('subscribe: the bell rings from the click, swinging, and comes to rest upright',
    by['bell-ring'].start === click && by['bell-ring'].loop.fx === 'sway'
    && ((x) => Math.abs(x - Math.round(x)) < 1e-6)((by['bell-ring'].end - by['bell-ring'].start) / (by['bell-ring'].loop.d / 2))
    && by['bell-rest'].start === by['bell-ring'].end && by.bell.end === click);
  ok('subscribe: a ripple spreads from the click and stars burst from the bell',
    by.ripple.start === click && by.ripple.out.fx === 'zoom' && by.stars.style === 'stars' && by.stars.burst && by.stars.start >= click);
  ok('subscribe: the pointer glides in before the click and is gone before the end', by.cursor.start < click && by['cursor-click'].end < doc.seconds - 0.4);
}
{
  const doc = build('callout', 'en', 'landscape');
  const by = Object.fromEntries(doc.layers.map((l) => [l.id.replace('callout-', ''), l]));
  ok('callout: the ring pulses and a sonar ring spreads and fades from it', by.ring.loop?.fx === 'pulse' && by.sonar.out.fx === 'zoom');
  ok('callout: the line draws from the marker to the plate, the label masks in, the badge pops with the number',
    by.leader.in.fx === 'draw' && by.leader.start < by.plate.start && by.label.in.fx === 'mask' && by.badge.in.fx === 'pop' && by.number.text === '1');
  const ar = build('callout', 'ar', 'landscape');
  ok('callout: the number is written in Arabic-Indic digits in Arabic', ar.layers.find((l) => l.id === 'callout-number').text === '١');
  ok('callout: the leader line is drawn mirrored right to left', ar.layers.find((l) => l.id === 'callout-leader').d.startsWith('M100 100'));
  const two = build('callout', 'en', 'portrait', { fields: { label: 'Tap the settings button at the top', number: '2' } });
  ok('callout: a long label breaks into two lines rather than shrinking', two.layers.find((l) => l.id === 'callout-label').text.split('\n').length === 2);
}
{
  const doc = build('handle', 'en', 'landscape');
  const moving = doc.layers.filter((l) => !l.loop);
  ok('handle: the pill and all it holds slide in from the start with one spring, and slide back out',
    moving.every((l) => l.in?.fx === 'slide' && l.in.dir === 'start' && l.in.ease === 'back-out' && same(l.in, moving[0].in) && l.out?.fx === 'slide'));
  ok('handle: an @ typed in front of the handle is not doubled',
    build('handle', 'en', 'landscape', { fields: { handle: '@@lana', caption: '' } }).layers.find((l) => l.id === 'handle-handle').text === 'lana');
  ok('handle: with no caption there is no caption layer and the pill is shorter',
    (() => { const d = build('handle', 'en', 'landscape', { fields: { handle: 'lana', caption: '' } }); return !d.layers.some((l) => l.id === 'handle-caption') && d.layers[0].h < doc.layers[0].h; })());
}
{
  const doc = build('logo-reveal', 'en', 'landscape');
  const by = Object.fromEntries(doc.layers.map((l) => [l.id.replace('logo-reveal-', ''), l]));
  ok('logo reveal: the badge pops, rings burst, sparks fly, a light sweeps it once, the name masks in',
    by.badge.in.fx === 'pop' && by.badge.in.ease === 'back-out' && by['ring-1'].out.fx === 'zoom' && by.sparks.style === 'sparks' && by.shine.loop.fx === 'shimmer' && by.name.in.fx === 'mask');
  ok('logo reveal: a backdrop moves under it', doc.layers[0].kind === 'backdrop' && doc.backdrop !== null);
  const bx = boxes(doc, stillTime(doc.layers, doc.seconds));
  const left = Math.min(bx['logo-reveal-badge'].x, bx['logo-reveal-name'].x);
  const right = Math.max(bx['logo-reveal-badge'].x + bx['logo-reveal-badge'].w, bx['logo-reveal-name'].x + bx['logo-reveal-name'].w);
  ok('logo reveal: in landscape the badge is beside the words and the lockup is centred',
    bx['logo-reveal-badge'].x < bx['logo-reveal-name'].x && Math.abs((left + right) / 2 - bx['logo-reveal-badge'].W / 2) < 1, [left, right]);
  const tall = boxes(build('logo-reveal', 'en', 'portrait'), 2.5);
  ok('logo reveal: in portrait the lockup is stacked', tall['logo-reveal-badge'].y + tall['logo-reveal-badge'].h <= tall['logo-reveal-name'].y + 0.01);
  ok('logo reveal: an empty badge field takes the first letter of the name',
    build('logo-reveal', 'en', 'square', { fields: { name: 'quiet harbour', tagline: '', mark: '' } }).layers.find((l) => l.id === 'logo-reveal-mark').text === 'Q');
}
{
  const numerals = (d) => d.layers.filter((l) => /^countdown-n\d+$/.test(l.id));
  const doc = build('countdown', 'en', 'landscape');
  ok('countdown: 3, 2, 1 on a one-second grid, then the last word', same(numerals(doc).map((l) => [l.text, l.start]), [['3', 0], ['2', 1], ['1', 2]])
    && doc.layers.find((l) => l.id === 'countdown-final').start === 3);
  ok('countdown: an arc sweeps the ring in each step', doc.layers.filter((l) => l.shape === 'arc' && l.in?.fx === 'draw').length === 3);
  ok('countdown: confetti bursts with the last word', doc.layers.some((l) => l.kind === 'particles' && l.style === 'confetti' && l.burst && l.start === 3));
  ok('countdown: the start is held to 3..10, and junk counts from 3',
    numerals(build('countdown', 'en', 'square', { fields: { from: '25', final: 'GO' } })).length === 10
    && numerals(build('countdown', 'en', 'square', { fields: { from: '1', final: 'GO' } })).length === 3
    && numerals(build('countdown', 'en', 'square', { fields: { from: 'x', final: 'GO' } })).length === 3
    && numerals(build('countdown', 'ar', 'square', { fields: { from: '٥', final: 'GO' } })).length === 5);
  const ten = build('countdown', 'en', 'landscape', { fields: { from: '10', final: 'GO' }, seconds: 11 });
  ok('countdown: any length still ends on the word — ten steps in eleven seconds are a second each',
    numerals(ten)[0].start === 0 && Math.abs(ten.layers.find((l) => l.id === 'countdown-final').start - 10) < 1e-9);
  ok('countdown: numbers are written in the language\'s digits', same(numerals(build('countdown', 'ckb', 'landscape')).map((l) => l.text), ['٣', '٢', '١']));
}
{
  const doc = build('intro', 'en', 'landscape');
  const bands = doc.layers.filter((l) => l.id.includes('band'));
  const title = doc.layers.find((l) => l.id === 'intro-title');
  ok('intro: bands wipe in from the start on a slant and collapse away toward the far end',
    bands.length === 3 && bands.every((l) => l.in.fx === 'wipe' && l.in.dir === 'start' && l.out.fx === 'grow' && l.out.dir === 'end' && l.rot !== 0));
  ok('intro: the title snaps in with an overshoot on top of the bands', title.in.fx === 'pop' && title.in.ease === 'back-out' && doc.layers.indexOf(title) > doc.layers.indexOf(bands[2]));
  ok('intro: the words leave before the bands sweep away', title.end < Math.min(...bands.map((b) => outStart(b))) + 0.2);
  const still = stillTime(doc.layers, doc.seconds);
  ok('intro: the gallery still shows the title in place', still >= inDone(title) && still <= outStart(title), still);
}
{
  // The gallery still catches no words mid-move: whatever words are on screen then have arrived and not begun to leave.
  const off = [];
  for (const id of IDS) {
    for (const lang of LANGS) {
      const doc = build(id, lang, 'landscape');
      const still = stillTime(doc.layers, doc.seconds);
      const words = doc.layers.filter((l) => l.kind === 'text' && l.start <= still && still < l.end);
      if (!words.length || words.some((l) => still < inDone(l, unitsOf(l)) - 1e-9 || still > outStart(l, unitsOf(l)) + 1e-9)) off.push(`${id}/${lang} @${still.toFixed(2)}`);
    }
  }
  ok('every recipe\'s gallery still shows its words, settled', !off.length, off);
}
{
  // The gallery's card and a graphic's cover are drawn at stillTime. A sweep of light caught there half-way across the
  // glass reads as a smudge (the lower third and the handle did, in every shape and language): no sweep may be crossing
  // then, at the recipe's own length, short or long, and adding the sweeps must not have moved the still.
  const lit = [];
  const moved = [];
  for (const id of IDS) for (const lang of LANGS) for (const format of FORMATS) for (const seconds of [undefined, 1.5, 2.5, 12, 30]) {
    const doc = build(id, lang, format, seconds ? { seconds } : {});
    const still = stillTime(doc.layers, doc.seconds);
    const sweeps = doc.layers.filter((l) => l.loop?.fx === 'shimmer');
    for (const l of sweeps) if (l.start <= still && still < l.end) lit.push(`${id}/${lang}/${format}/${doc.seconds}s ${l.id} ${l.start}-${l.end} @${still}`);
    if (sweeps.length && Math.abs(stillTime(doc.layers.filter((l) => !sweeps.includes(l)), doc.seconds) - still) > 1e-9) moved.push(`${id}/${lang}/${format}/${doc.seconds}s`);
  }
  ok('no sweep of light is crossing at the still the gallery and a cover show, at any length', !lit.length, lit.slice(0, 4));
  ok('a sweep never moves the still: it is the same with the sweeps and without them', !moved.length, moved.slice(0, 4));
  const handle = build('handle', 'en', 'landscape');
  const pill = handle.layers.find((l) => l.id === 'handle-pill');
  const shine = handle.layers.find((l) => l.id === 'handle-shine');
  ok('handle: the light rides the pill\'s own slide, so it moves with the glass it lights', !!shine && same(shine.in, pill.in) && shine.start === pill.start);
  const intro = build('intro', 'en', 'landscape');
  const band = intro.layers.find((l) => l.id === 'intro-band');
  const glint = intro.layers.find((l) => l.id === 'intro-shine');
  ok('intro: the light rides the wide band\'s own wipe', !!glint && same(glint.in, band.in) && glint.start === band.start && glint.rot === band.rot);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
