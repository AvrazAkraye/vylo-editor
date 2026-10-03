// Fix F1 of the Pro pass (docs/pro/f1-until.md): a template owns a span, not
// the whole graphic, so "+ Scene" no longer takes the template's words away.
//
// What matters, in the order the brief asks for it:
//
//   - Every graphic stored before this reads exactly as it did: no `until`
//     appears on any of the 33 templates, a stored link without one reads
//     without one, and a template with no span is built again exactly as the
//     rebuild built it before (the old rule, written out here, for every
//     template and every rebuilding edit).
//   - `readMotion` holds `until` to a number inside the graphic, at least the
//     shortest length, to the millisecond; anything else is the whole graphic.
//     Its reading is a fixed point.
//   - The shortest path: Big title, `addScene(m, 1)`, `setFields(m, { title:
//     'New' })` — the title changes, the second scene's layers and the scenes
//     do not, the result reads back unchanged; the same through the chat's
//     `fields` and `recipe` ops; and Design's "Words on screen" form is still
//     there after "+ Scene".
//   - "+ Scene" keeps the template at or after the end of its span and ends it
//     inside; the scene edits that mark, name or choose keep it; a scene moved
//     among the person's scenes keeps it, one moved through the template's
//     time ends it.
//   - A rebuild keeps the person's layers where they were, in time and in the
//     stack, the length, scenes, sound and brand look; a template layer that
//     ran on past the span runs on; `setSeconds` keeps the span past it and
//     ends it inside; a change by hand keeps the link only when the template's
//     part is untouched (`byHand`); a brand kit applied through
//     `onTemplatePart` re-skins the template's part and nothing else.
//   - Fuzz: random mixes of every edit, the chat's rebuild and undo-shaped
//     re-reads over all 33 templates — always a valid graphic that reads back
//     unchanged, a rebuild with nothing changed changes no layer (so no
//     template layer is ever there twice), and no layer of the person's lost.
import { createRequire } from 'module';
import { buildMotion, lookOf } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { META } from '../.test-build/motionrecipe.js';
import { FORMAT_IDS, LANGUAGES, LIMITS, RECIPE_IDS } from '../.test-build/motiontypes.js';
import {
  addLayer, byHand, detach, duplicateLayer, isAttached, moveLayer, onTemplatePart, placeAdded, removeLayer, setFields, setFormat, setLang,
  setLayer, setPalette, setSeconds, setTitle,
} from '../.test-build/motionedit.js';
import {
  addScene, moveScene, readScenes, removeScene, renameScene, sceneList, setTransition, splitSceneAt,
} from '../.test-build/motionscene.js';
import { readSound, withSound } from '../.test-build/motionsound.js';
import { applyBrand, readBrand } from '../.test-build/motionbrand.js';
import { applyOps } from '../.test-build/motionchatops.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), { got, want });
const J = (x) => JSON.stringify(x);
/** What the reader makes of a graphic is the graphic. */
const fixed = (m) => J(readMotion(JSON.parse(J(m)), 1)) === J(m);

/** Freeze a value all the way down, so an edit that mutates what it was given throws. */
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}

/** A seeded stream, so a failing fuzz can be run again. */
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = 1_700_000_000_000;
const tpl = (recipe, lang = 'en', format = 'landscape', seconds) =>
  freeze(buildMotion({ id: 'u', recipe, fields: {}, lang, format, now: 1, ...(seconds ? { seconds } : {}) }));
const textField = (recipe) => META[recipe].fields.find((f) => f.kind === 'line' || f.kind === 'text');
const layer = (m, id) => m.layers.find((l) => l.id === id);
/** The layers on screen at some moment of `from`..`to`. */
const during = (m, from, to) => m.layers.filter((l) => l.start < to - 1e-9 && l.end > from + 1e-9);
/** The template's part of a graphic: the layers that start before its span ends. */
const partLayers = (m) => m.layers.filter((l) => l.start < (m.recipe?.until ?? m.seconds) - 1e-6);

/** Scenes that are what they claim: at least two, back to back from 0 to the end, none short, the reader's own list. */
function scenesValid(m) {
  if (!('scenes' in m)) return true;
  const s = m.scenes;
  if (!Array.isArray(s) || s.length < 2 || s.length > LIMITS.scenes) return false;
  if (s[0].start !== 0 || s[s.length - 1].end !== m.seconds) return false;
  for (let i = 0; i < s.length; i++) {
    if (s[i].end - s[i].start < LIMITS.sceneMin - 1e-6) return false;
    if (i && s[i].start !== s[i - 1].end) return false;
    if (i === 0 && s[i].transition) return false;
  }
  return J(readScenes(s, m.layers, m.seconds)) === J(s);
}

const KIT = readBrand({ name: 'Acme Bakery', handle: 'acme', url: 'acme.example', paletteId: 'sunset', voice: 'serif' });

// ── what was stored before reads as it did ────────────────────────────────
console.log('every graphic stored before reads exactly as it did');
{
  let clean = 0, noKey = 0;
  for (const recipe of RECIPE_IDS) {
    for (const format of FORMAT_IDS) {
      const m = tpl(recipe, 'en', format);
      if (fixed(m)) clean += 1;
      if (!('until' in m.recipe)) noKey += 1;
    }
  }
  eq(`all ${RECIPE_IDS.length} templates in every shape are a fixed point of the reader`, clean, RECIPE_IDS.length * FORMAT_IDS.length);
  eq('and none has a span: the template is the whole graphic, as before', noKey, RECIPE_IDS.length * FORMAT_IDS.length);
  const stored = readMotion({ id: 's', seconds: 8, layers: [], recipe: { id: 'big-title', fields: { title: 'Old' } } }, 1);
  eq('a link stored without a span reads without one, key for key', Object.keys(stored.recipe), ['id', 'fields']);

  // The rebuild as it was before spans: a template with none is built again exactly so (the rule written out).
  const before = (m, patch, now) => {
    const r = m.recipe;
    const fresh = buildMotion({
      id: m.id, recipe: r.id, fields: patch.fields ?? r.fields, lang: patch.lang ?? m.lang, format: patch.format ?? m.format,
      palette: m.palette, seconds: patch.seconds ?? m.seconds, now: m.created, request: m.request, ai: m.ai, look: lookOf(m),
    });
    const next = { ...fresh, title: m.title, fps: m.fps, backdrop: m.backdrop, stage: m.stage, error: m.error, created: m.created, updated: now };
    if (m.sound) next.sound = m.sound;
    const scenes = readScenes(m.scenes, fresh.layers, fresh.seconds);
    if (scenes) next.scenes = scenes;
    return next;
  };
  let same = 0, total = 0;
  const odd = [];
  for (const recipe of RECIPE_IDS) {
    const plain = tpl(recipe, 'en', 'landscape', 8);
    const field = textField(recipe);
    for (const m of [plain, freeze(withSound(splitSceneAt(plain, 4, NOW), { mode: 'music', level: 0.5, mood: 'calm' }, NOW))]) {
      const cases = [
        [setFormat(m, 'portrait', NOW), { format: 'portrait' }],
        [setLang(m, 'ar', NOW), { lang: 'ar' }],
        [setSeconds(m, 10, NOW), { seconds: 10 }],
        [setSeconds(m, 5, NOW), { seconds: 5 }],
        ...(field ? [[setFields(m, { [field.key]: 'Other words' }, NOW), { fields: { ...m.recipe.fields, [field.key]: 'Other words' } }]] : []),
      ];
      for (const [got, patch] of cases) {
        total += 1;
        if (J(got) === J(before(m, patch, NOW))) same += 1;
        else odd.push([recipe, Object.keys(patch)[0]]);
      }
    }
  }
  eq(`a template without a span rebuilds exactly as before (${total} rebuilds over every template, with and without scenes)`, odd.slice(0, 3), []);
  ok('(all of them)', same === total && total > 250, [same, total]);
}

// ── the reader holds the span ─────────────────────────────────────────────
console.log('readMotion holds the span');
{
  const base = { id: 'r', title: 'r', seconds: 9, stage: 'ready', created: 1, updated: 1, layers: [], recipe: { id: 'big-title', fields: {} } };
  const read = (until, seconds = 9) => readMotion({ ...base, seconds, recipe: { ...base.recipe, until } }, 1).recipe.until;
  eq('a time inside the graphic is kept', read(6), 6);
  eq('to the millisecond', read(6.00049), 6);
  eq('a plain decimal string is a number, as everywhere in the reader', read('4.5'), 4.5);
  eq('shorter than the shortest graphic: the shortest', [read(0.2), read(-3), read(0)], [LIMITS.minSeconds, LIMITS.minSeconds, LIMITS.minSeconds]);
  eq('at the end or past it: the whole graphic, no span', [read(9), read(8.9999999), read(40), read(1e308)], [undefined, undefined, undefined, undefined]);
  eq('not a number: the whole graphic', [NaN, Infinity, -Infinity, 'six', '', null, true, {}, [], '6s'].map((x) => read(x)), Array(10).fill(undefined));
  eq('a graphic of the shortest length has no room for one', read(0.5, LIMITS.minSeconds), undefined);
  const r = readMotion({ ...base, recipe: { ...base.recipe, until: 6 } }, 1);
  eq('the link keeps its keys in the reader\'s order', Object.keys(r.recipe), ['id', 'fields', 'until']);
  ok('and the reading is a fixed point', fixed(r));
  const fz = rand(0xf1);
  let bad = 0;
  for (let i = 0; i < 2000; i++) {
    const seconds = fz() * 40 - 5;
    const until = [fz() * 40 - 5, String(fz() * 30), fz() < 0.5 ? undefined : null, Math.round(fz() * 30)][Math.floor(fz() * 4)];
    const m = readMotion({ ...base, seconds, recipe: { ...base.recipe, until } }, 1);
    const u = m.recipe.until;
    if (!fixed(m) || (u !== undefined && !(u >= LIMITS.minSeconds && u < m.seconds && Math.round(u * 1000) / 1000 === u))) bad += 1;
  }
  eq('2,000 random spans and lengths: always inside, to the millisecond, a fixed point', bad, 0);
}

// ── the shortest path ─────────────────────────────────────────────────────
console.log('the shortest path: a template, "+ Scene", new words');
const big = tpl('big-title');
const added = freeze(addScene(big, 1, NOW));
{
  ok('the setup: Big title, then "+ Scene": two scenes, nine seconds, still the template', sceneList(added).length === 2 && added.seconds === 9
    && isAttached(added) && added.recipe.until === 6 && fixed(added));
  const next = setFields(added, { title: 'New' }, NOW);
  eq('the title changes', layer(next, 'big-title-title').text, 'New');
  eq('and the template keeps the words it was given', next.recipe.fields, { ...big.recipe.fields, title: 'New' });
  // The background running through both scenes is one layer, the template's: its pattern is seeded from the words
  // (motionrecipe.ts `makeKit`), so it follows them in both scenes alike, and the cut shows no seam.
  const times = (m) => during(m, 6, 9).map((l) => [l.id, l.start, l.end]);
  eq('the second scene holds the same layers for the same time', times(next), times(added));
  const directBg = buildMotion({ id: 'u', recipe: 'big-title', fields: { ...big.recipe.fields, title: 'New' }, lang: 'en', format: 'landscape', now: 1 })
    .layers.find((l) => l.kind === 'backdrop');
  eq('and the background through it is the template\'s own, run on to the end', J(layer(next, 'big-title-aurora')), J({ ...directBg, end: 9 }));
  eq('the scenes are what they were', next.scenes, added.scenes);
  eq('the length and the span too', [next.seconds, next.recipe.until], [9, 6]);
  ok('and it reads back unchanged', fixed(next));
  const direct = buildMotion({ id: 'u', recipe: 'big-title', fields: { ...big.recipe.fields, title: 'New' }, lang: 'en', format: 'landscape', seconds: 6, now: 1 });
  eq('the template\'s part is the template built for its six seconds', J(partLayers(next).map((l) => ({ ...l, end: Math.min(l.end, 6) }))), J(direct.layers));

  // The same through the chat: its `fields` op and its `recipe` op for the same template.
  const said = applyOps(added, [{ op: 'fields', set: { title: 'New' } }], NOW);
  eq('through the chat\'s fields: the same graphic', J({ ...said.motion, updated: 0 }), J({ ...next, updated: 0 }));
  ok('and nothing about the template ending is said', !said.notes.some((n) => n.code === 'detached'), said.notes);
  const again = applyOps(added, [{ op: 'recipe', id: 'big-title', fields: { ...big.recipe.fields, title: 'New' } }], NOW).motion;
  ok('through the chat\'s recipe for the same template: the title, the second scene, the scenes and the span all as above',
    layer(again, 'big-title-title').text === 'New' && J(times(again)) === J(times(added)) && J(again.scenes) === J(added.scenes)
    && again.recipe.until === 6 && again.seconds === 9 && fixed(again), again.recipe);
  const other = applyOps(added, [{ op: 'recipe', id: 'lower-third', fields: { name: 'Sara', role: 'Dentist' } }], NOW).motion;
  ok('another template starts again over the whole graphic, as it always did', other.recipe.id === 'lower-third' && other.recipe.until === undefined
    && other.scenes === undefined && other.layers.every((l) => l.id.startsWith('lower-third-')) && fixed(other));
}

// ── Design's form is still there ──────────────────────────────────────────
console.log('Design keeps the words form after "+ Scene"');
{
  const require = createRequire(import.meta.url);
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  if (!esbuild) ok('esbuild is there to build the Design tab', false);
  else {
    esbuild.buildSync({
      entryPoints: ['src/MotionDesign.tsx'], bundle: true, format: 'esm', outdir: '.test-build/pro-until', logLevel: 'error',
      external: ['react', 'react-dom', '@tauri-apps/api/core', '@tauri-apps/plugin-dialog', '@codemirror/state'],
    });
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MotionDesign } = await import('../.test-build/pro-until/MotionDesign.js');
    const quiet = console.error;
    const render = (doc) => {
      console.error = () => {};
      try {
        return renderToStaticMarkup(createElement(MotionDesign, { t: (s) => s, doc, selected: null, onSelect: () => {}, onEdit: () => {} }));
      } finally {
        console.error = quiet;
      }
    };
    const NONE = 'This graphic has no template words to change here';
    const html = render(added);
    ok('"Words on screen" still holds the template\'s fields after "+ Scene"', !html.includes(NONE)
      && META['big-title'].fields.every((f) => html.includes(`>${f.label}<`)) && html.includes(big.recipe.fields.title), html.slice(0, 400));
    ok('a graphic whose template really ended still says where its words went', render(detach(added)).includes(NONE));
  }
}

// ── "+ Scene" and the other scene edits ───────────────────────────────────
console.log('the scene edits, against the span');
{
  eq('a second "+ Scene" at the end keeps the span where it was', addScene(added, 8, NOW).recipe?.until, 6);
  const between = addScene(added, 2, NOW);
  ok('"+ Scene" at the template\'s end, with the person\'s scene after it: kept, and the new scene sits between',
    between.recipe?.until === 6 && sceneList(between).map((s) => s.start).join() === '0,6,9' && fixed(between), between.scenes);
  const split = freeze(splitSceneAt(big, 3, NOW));
  ok('"+ Scene" inside the template\'s time moves its layers: the template ends', !addScene(split, 1, NOW).recipe);
  ok('"+ Scene" after a template already split into scenes, at its end: kept', addScene(split, 4, NOW).recipe?.until === 6);
  const cutAgain = splitSceneAt(added, 3, NOW);
  ok('splitting inside the template\'s time marks a cut and moves nothing: kept, the span with it',
    cutAgain.recipe?.until === 6 && J(cutAgain.layers) === J(added.layers) && fixed(cutAgain));
  const words = setFields(cutAgain, { kicker: 'Now' }, NOW);
  ok('and new words after it keep all three scenes', J(words.scenes) === J(cutAgain.scenes) && words.recipe.until === 6 && fixed(words));
  const s2 = sceneList(added)[1].id;
  ok('a transition, a name, joining a scene: kept, with the span', setTransition(added, s2, 'push', NOW).recipe?.until === 6
    && renameScene(added, s2, 'Offer', NOW).recipe?.until === 6 && removeScene(added, s2, NOW).recipe?.until === 6);
  const four = freeze(addScene(addScene(added, 8, NOW), 11, NOW));
  const ids = sceneList(four).map((s) => s.id);
  const swapped = moveScene(four, ids[3], 1, NOW);
  ok('moving one of the person\'s scenes among the person\'s: kept', swapped.recipe?.until === 6 && J(partLayers(swapped)) === J(partLayers(four)) && fixed(swapped));
  ok('moving a scene to before the template\'s: the template ends', !moveScene(four, ids[2], 0, NOW).recipe && !moveScene(four, ids[0], 2, NOW).recipe);
  ok('a palette, a title, a frame rate leave the span alone', setPalette(added, { ...added.palette, accent: '#123456' }, NOW).recipe?.until === 6
    && setTitle(added, 'Again', NOW).recipe?.until === 6);
}

// ── the person's layers ───────────────────────────────────────────────────
console.log('the person\'s layers in the scenes after the template');
{
  const withText = addLayer(added, 'text', { id: 'mine', text: 'Our new shop' }, NOW, 7.5);
  const doc = freeze(withText.motion);
  const mine = layer(doc, 'mine');
  ok('a text added in the second scene runs through it, and the template stays one', mine.start === 6 && mine.end === 9 && doc.recipe?.until === 6 && fixed(doc));
  const placed = placeAdded(added, addLayer(added, 'icon', { id: 'star' }, NOW).motion, 7.5);
  ok('the Layers tab\'s Add, put in the second scene by placeAdded: the link the whole-graphic layer cost comes back',
    layer(placed, 'star').start === 6 && placed.recipe?.until === 6 && fixed(placed));
  const intoTemplate = placeAdded(added, addLayer(added, 'icon', { id: 'star' }, NOW).motion, 2);
  ok('the same Add with the playhead in the template\'s scene: the template ends, as a hand edit does', !intoTemplate.recipe && fixed(intoTemplate));
  ok('a text added across the whole graphic ends it', !addLayer(added, 'text', {}, NOW).motion.recipe);
  ok('editing the person\'s layer, moving it within their scenes, copying it, restacking it, removing it: kept',
    setLayer(doc, 'mine', { text: 'Opening soon', x: 5, start: 6.5 }, NOW).recipe?.until === 6
    && duplicateLayer(doc, 'mine', NOW).motion.recipe?.until === 6
    && moveLayer(doc, 'mine', 2, NOW).recipe?.until === 6
    && removeLayer(doc, 'mine', NOW).recipe?.until === 6);
  ok('bringing it into the template\'s time ends the template', !setLayer(doc, 'mine', { start: 5 }, NOW).recipe);
  ok('editing a template layer by hand still ends it', !setLayer(doc, 'big-title-title', { x: 4 }, NOW).recipe
    && !removeLayer(doc, 'big-title-kicker', NOW).recipe && !moveLayer(doc, 'big-title-title', 0, NOW).recipe
    && !setLayer(doc, 'big-title-aurora', { opacity: 0.5 }, NOW).recipe);
  ok('byHand without a span is detach, as always', byHand(big, { ...big, layers: big.layers.slice(1) }).recipe === undefined
    && byHand(doc, { ...doc, layers: doc.layers.slice() }).recipe === doc.recipe);

  // A rebuild keeps them where they were: in time, and just above the template layer that was below them.
  const low = freeze(moveLayer(doc, 'mine', 2, NOW));
  const bg = freeze(addLayer(low, 'backdrop', { id: 'ground', style: 'grid' }, NOW, 7).motion);
  ok('the setup: the text sits above the second template layer, a background of the person\'s at the very back',
    bg.layers[0].id === 'ground' && bg.layers[3].id === 'mine' && bg.recipe?.until === 6);
  for (const [name, edit] of [
    ['new words', (m) => setFields(m, { title: 'New' }, NOW)],
    ['a new shape', (m) => setFormat(m, 'portrait', NOW)],
    ['a new language', (m) => setLang(m, 'ar', NOW)],
    ['the chat\'s words', (m) => applyOps(m, [{ op: 'fields', set: { subtitle: 'Today' } }], NOW).motion],
  ]) {
    const next = edit(bg);
    ok(`${name}: the person's layers exactly as they were, in the same place in the stack`,
      J(layer(next, 'mine')) === J(layer(bg, 'mine')) && J(layer(next, 'ground')) === J(layer(bg, 'ground'))
      && next.layers[0].id === 'ground' && next.layers[3].id === 'mine' && next.layers.length === bg.layers.length, next.layers.map((l) => l.id));
    ok(`${name}: the length, the span, the scenes; and it reads back unchanged`, next.seconds === 9 && next.recipe?.until === 6
      && J(next.scenes) === J(bg.scenes) && fixed(next));
    ok(`${name}: the background that ran through the second scene still does`, layer(next, 'big-title-aurora').end === 9);
  }
  const sounded = freeze(withSound(bg, { mode: 'both', level: 0.4, seed: 7 }, NOW));
  eq('the sound is kept through a rebuild', setFormat(sounded, 'square', NOW).sound, readSound({ mode: 'both', level: 0.4, seed: 7 }));

  // The brand kit, applied to the template's part (onTemplatePart) — the chat's brand.apply does this.
  const branded = onTemplatePart(bg, (part) => applyBrand(part, KIT, NOW));
  ok('a brand kit applied to the template\'s part: re-skinned, the person\'s layers and the scenes as they were',
    branded.palette.accent !== bg.palette.accent && J(layer(branded, 'mine')) === J(layer(bg, 'mine')) && branded.recipe?.until === 6
    && J(branded.scenes) === J(bg.scenes) && fixed(branded));
  eq('and its face is the kit\'s', lookOf(branded)?.voice, 'serif');
  const viaChat = applyOps(bg, [{ op: 'brand.apply' }], NOW, '', { brand: KIT }).motion;
  eq('the chat\'s brand.apply does the same', J({ ...viaChat, updated: 0 }), J({ ...branded, updated: 0 }));
  ok('new words after the brand keep its face and the person\'s layers', lookOf(setFields(branded, { title: 'Hi' }, NOW))?.voice === 'serif'
    && J(layer(setFields(branded, { title: 'Hi' }, NOW), 'mine')) === J(layer(bg, 'mine')));
  // The brand sheet's own button calls applyBrand on the whole graphic: it must give the same as the chat's wrapper, not lay the title across the scenes.
  const direct = applyBrand(bg, KIT, NOW);
  eq('applyBrand on a graphic whose template owns a span: the same as through onTemplatePart', J({ ...direct, updated: 0 }), J({ ...branded, updated: 0 }));
  ok('and the person\'s layers and the scenes are still there', J(layer(direct, 'mine')) === J(layer(bg, 'mine')) && direct.recipe?.until === 6 && J(direct.scenes) === J(bg.scenes));
  ok('onTemplatePart without a span is just the edit', onTemplatePart(big, (m) => setTitle(m, 'X', NOW)).title === 'X'
    && onTemplatePart(bg, (part) => part) === bg);
  const chatLayer = applyOps(bg, [{ op: 'layer', id: 'mine', set: { text: 'Hello' } }], NOW);
  ok('the chat editing the person\'s layer keeps the template and says nothing of ending it', chatLayer.motion.recipe?.until === 6
    && !chatLayer.notes.some((n) => n.code === 'detached'), chatLayer.notes);
  ok('the chat editing a template layer still ends it, and says so',
    applyOps(bg, [{ op: 'layer', id: 'big-title-title', set: { x: 3 } }], NOW).notes.some((n) => n.code === 'detached'));
  // The chat's language check reads the person's own words after the span as well as the template's.
  const long = freeze(setLayer(bg, 'mine', { text: 'Our new shop opens on Monday morning, right in the middle of town' }, NOW));
  const arabic = { op: 'fields', set: { kicker: 'جديد', title: 'أفكار تحرك الناس', subtitle: 'قصص وأدوات' } };
  const halfway = applyOps(long, [arabic, { op: 'lang', value: 'ar' }], NOW);
  ok('Arabic asked for with only the template\'s words rewritten: the person\'s English is most of what shows, so not yet',
    halfway.motion.lang === 'en' && halfway.skipped.some((n) => n.code === 'untranslated'), halfway.skipped);
  const whole = applyOps(long, [arabic, { op: 'layer', id: 'mine', set: { text: 'متجرنا الجديد يفتح يوم الاثنين' } }, { op: 'lang', value: 'ar' }], NOW);
  ok('with the person\'s text rewritten too: Arabic, and still a template', whole.motion.lang === 'ar' && whole.motion.recipe?.until === 6 && fixed(whole.motion), whole.skipped);
}

// ── the length ────────────────────────────────────────────────────────────
console.log('the length, against the span');
{
  const doc = freeze(addLayer(added, 'text', { id: 'mine', text: 'Our new shop' }, NOW, 7.5).motion);
  const longer = setSeconds(doc, 12, NOW);
  ok('longer: the span is kept and the template\'s part is not touched', longer.recipe?.until === 6 && J(partLayers(longer).filter((l) => l.end <= 6)) === J(partLayers(doc).filter((l) => l.end <= 6)));
  ok('the layers that ran to the end run to the new one; the last scene stretches', layer(longer, 'mine').end === 12
    && layer(longer, 'big-title-aurora').end === 12 && sceneList(longer).at(-1).end === 12 && fixed(longer));
  const less = setSeconds(longer, 8, NOW);
  ok('shorter but still past the span: kept, the person\'s scene shrinks', less.recipe?.until === 6 && layer(less, 'mine').end === 8 && fixed(less));
  ok('and new words still find the template', layer(setFields(less, { title: 'Again' }, NOW), 'big-title-title').text === 'Again');
  const into = setSeconds(added, 4, NOW);
  const whole = buildMotion({ id: 'u', recipe: 'big-title', fields: big.recipe.fields, lang: 'en', format: 'landscape', seconds: 4, now: 1 });
  ok('into the template\'s time with nothing of the person\'s after it: the template, whole, built for the new length',
    into.recipe?.until === undefined && isAttached(into) && J(into.layers) === J(whole.layers) && !('scenes' in into) && fixed(into));
  ok('exactly to the span\'s end: the same', setSeconds(added, 6, NOW).recipe?.until === undefined && J(setSeconds(added, 6, NOW).layers) === J(tpl('big-title').layers));
  const cut = setSeconds(doc, 5, NOW);
  ok('into it with a layer of the person\'s after it: no honest rebuild, the template ends and every layer is kept',
    !cut.recipe && cut.layers.length === doc.layers.length && !!layer(cut, 'mine') && fixed(cut));
}

// ── fuzz ──────────────────────────────────────────────────────────────────
console.log('random edit sequences on every template');
{
  const r = rand(0xf1f1);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const KINDS = ['text', 'shape', 'icon', 'backdrop'];
  let steps = 0, spanned = 0, rebuilds = 0, undos = 0;
  const bad = [];
  const note = (what, detail) => { if (bad.length < 6) bad.push({ what, ...detail }); };
  let serial = 0;
  for (let run = 0; run < 132; run++) {
    const recipe = RECIPE_IDS[run % RECIPE_IDS.length];
    let m = tpl(recipe, LANGUAGES[run % 4], FORMAT_IDS[(run >> 2) % 4]);
    const history = [m];
    let mine = new Set();
    for (let k = 0; k < 16; k++) {
      // Most runs start with "+ Scene" at the end, so most of the edits after it meet a template that owns a span.
      const op = k === 0 && r() < 0.7 ? 0 : Math.floor(r() * 16);
      const at = (k === 0 && op === 0) || r() < 0.4 ? m.seconds - 0.01 : r() * m.seconds;
      let next = m;
      let removed = null;
      try {
        if (op === 0 || op === 1) next = addScene(m, at, NOW);
        else if (op === 2) next = splitSceneAt(m, at, NOW);
        else if (op === 3 && m.recipe) {
          const f = textField(m.recipe.id);
          if (f) next = setFields(m, { [f.key]: `Words ${run}.${k}` }, NOW);
        } else if (op === 4) {
          const u = m.recipe?.until;
          next = setSeconds(m, u !== undefined && r() < 0.5 ? u + (r() * 2 - 1) : LIMITS.minSeconds + r() * (LIMITS.seconds - LIMITS.minSeconds), NOW);
        } else if (op === 5) next = setFormat(m, pick(FORMAT_IDS), NOW);
        else if (op === 6) next = setLang(m, pick(LANGUAGES), NOW);
        else if (op === 7) {
          const id = `own${serial++}`;
          next = addLayer(m, pick(KINDS), { id }, NOW, at).motion;
          if (layer(next, id)) mine.add(id);
        } else if (op === 8) {
          const id = `own${serial++}`;
          next = placeAdded(m, addLayer(m, 'text', { id, text: 'Hi' }, NOW).motion, at);
          if (layer(next, id)) mine.add(id);
        } else if (op === 9 && m.layers.length) {
          const l = r() < 0.6 && mine.size ? layer(m, pick([...mine])) : pick(m.layers);
          if (l) next = setLayer(m, l.id, r() < 0.5 ? { x: Math.round(r() * 20 - 10) } : { start: Math.max(0, l.start + r() * 2 - 1) }, NOW);
        } else if (op === 10 && mine.size) {
          removed = pick([...mine]);
          next = removeLayer(m, removed, NOW);
        } else if (op === 11 && sceneList(m).length) {
          const s = sceneList(m);
          next = r() < 0.5 ? moveScene(m, pick(s).id, Math.floor(r() * s.length), NOW) : removeScene(m, pick(s).id, NOW);
        } else if (op === 12 && sceneList(m).length) {
          next = setTransition(m, pick(sceneList(m).slice(1)).id, pick(['fade', 'push', 'iris', 'cut']), NOW);
        } else if (op === 13 && m.recipe) {
          const f = textField(m.recipe.id);
          const ops = r() < 0.5 && f ? [{ op: 'fields', set: { [f.key]: `Chat ${k}` } }] : [{ op: 'recipe', id: m.recipe.id, fields: m.recipe.fields }];
          next = applyOps(m, ops, NOW).motion;
        } else if (op === 14 && r() < 0.3) {
          next = applyOps(m, [{ op: 'brand.apply' }], NOW, '', { brand: KIT }).motion;
        } else if (op === 15 && history.length > 1) {
          // Undo-shaped: a graphic from earlier, as the store or the history hands it back.
          next = readMotion(JSON.parse(J(history[Math.floor(r() * history.length)])), 1);
          mine = new Set([...mine].filter((id) => layer(next, id)));
          undos += 1;
        }
      } catch (e) {
        note('threw', { recipe, run, k, op, e: String(e) });
        break;
      }
      steps += 1;
      if (next.recipe && (op === 3 || op === 5 || op === 6 || op === 13)) rebuilds += 1;
      if (next.recipe?.until !== undefined) spanned += 1;
      // A valid graphic, the reader's own.
      if (!fixed(next)) note('not a fixed point', { recipe, run, k, op });
      if (!scenesValid(next)) note('scenes', { recipe, run, k, op, scenes: next.scenes });
      if (next.layers.some((l) => !(l.start >= 0 && l.end > l.start && l.end <= next.seconds + 1e-9))) note('a layer outside', { recipe, run, k, op });
      if (new Set(next.layers.map((l) => l.id)).size !== next.layers.length) note('an id twice', { recipe, run, k, op });
      const u = next.recipe?.until;
      if (u !== undefined && !(u >= LIMITS.minSeconds && u < next.seconds && Math.round(u * 1000) / 1000 === u)) note('span', { recipe, run, k, op, u, s: next.seconds });
      // No layer of the person's lost.
      for (const id of mine) if (id !== removed && !layer(next, id)) note('lost', { recipe, run, k, op, id });
      if (removed) mine.delete(removed);
      // A rebuild with nothing changed changes no layer: the template's are there once each, as built, and the rest are kept.
      if (next.recipe) {
        const again = setFields(next, {}, NOW);
        if (J(again.layers) !== J(next.layers)) note('a rebuild with nothing changed changed the layers', {
          recipe, run, k, op, u, ids: [next.layers.map((l) => l.id).join(), again.layers.map((l) => l.id).join()],
        });
      }
      m = freeze(next);
      history.push(m);
    }
  }
  console.log(`  (${steps} edits, ${spanned} of them on a template that owns a span, ${rebuilds} rebuilds, ${undos} undo-shaped re-reads)`);
  eq('every graphic valid and the reader\'s own, no layer of the person\'s lost, none of the template\'s twice', bad, []);
  ok('the fuzz reached the new case often', spanned > steps / 4 && rebuilds > 150 && undos > 50, { steps, spanned, rebuilds, undos });
}

// ── speed ─────────────────────────────────────────────────────────────────
console.log('speed');
{
  const times = [];
  for (const recipe of RECIPE_IDS) {
    const field = textField(recipe);
    if (!field) continue;
    const m = addLayer(addScene(tpl(recipe), 1, NOW), 'text', { text: 'Mine' }, NOW, tpl(recipe).seconds + 1).motion;
    const t0 = performance.now();
    setFields(m, { [field.key]: 'Typed' }, NOW);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`  (a rebuild of a template's span: median ${median.toFixed(1)} ms, slowest ${times.at(-1).toFixed(1)} ms over ${times.length} templates)`);
  ok('a rebuild of a span stays quick enough to type into (median < 25 ms)', median < 25, median);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
