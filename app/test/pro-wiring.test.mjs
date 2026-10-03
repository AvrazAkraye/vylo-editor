// Wave 2, panel wiring (docs/pro/w2-panel.md): the studio's parts mounted
// once each, and edits that keep what the person chose.
//
// What matters, in the order the brief asks for it:
//
//   - A template graphic built again — new words, shape, language or length —
//     keeps its sound, its scenes and its brand look (face and logo), and
//     comes back from `readMotion` unchanged. A graphic that had none of them
//     gets none of them: no `sound` or `scenes` key appears, and an unbranded
//     template builds exactly as `buildMotion` builds it.
//   - A change of length keeps the scenes valid by one rule: the last scene
//     stretches or shrinks, the others keep their place, a scene with no room
//     left goes; never one past the end, never two that overlap, never a list
//     the reader would change (fuzzed over random edit sequences).
//   - A new layer runs through the scene under the playhead when the graphic
//     has scenes (`addLayer`'s `at`, and `placeAdded` for the Layers tab's
//     Add), the whole graphic otherwise; a copy keeps its original's time.
//   - Editing a layer by hand still ends the template, and keeps the sound and
//     the scenes.
//   - The mounts: the chip once per layout and outside the transport, one
//     sound preview, the strip above the timeline, the Sound row and the brand
//     button in Design, templates started in the kit; the new kinds named in
//     the inspector, each with the controls its fields mean.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  addLayer, detach, duplicateLayer, isAttached, placeAdded, setFields, setFormat, setLang, setLayer, setPalette, setSeconds, setTitle,
} from '../.test-build/motionedit.js';
import { readMotion } from '../.test-build/motionread.js';
import { buildMotion, lookOf, DISPLAY_VOICE } from '../.test-build/motiontemplates.js';
import { META } from '../.test-build/motionrecipe.js';
import { BACKDROPS, CHARTS, FORMAT_IDS, LANGUAGES, LIMITS, RECIPE_IDS } from '../.test-build/motiontypes.js';
import { addScene, readScenes, sceneList, sceneSpan, setTransition, splitSceneAt } from '../.test-build/motionscene.js';
import { readSound, withSound } from '../.test-build/motionsound.js';
import { applyBrand, kitOptionsWithBrand, readBrand } from '../.test-build/motionbrand.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), { got, want });
const J = (x) => JSON.stringify(x);
/** What the reader makes of a graphic is the graphic: nothing in it is stale or out of range. */
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
  buildMotion({ id: 'w', recipe, fields: {}, lang, format, now: 1, ...(seconds ? { seconds } : {}) });

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
    const tr = s[i].transition;
    if (tr && (tr.d < LIMITS.transitionMin - 1e-9 || tr.d > LIMITS.transitionMax + 1e-9
      || tr.d > s[i].end - s[i].start + 1e-9 || tr.d > s[i - 1].end - s[i - 1].start + 1e-9)) return false;
  }
  return J(readScenes(s, m.layers, m.seconds)) === J(s);
}

const MUSIC = { mode: 'music', level: 0.6, mood: 'calm' };
const BOTH = { mode: 'both', level: 0.35, seed: 4242 };

// ── a rebuild keeps the sound ─────────────────────────────────────────────
console.log('a rebuild keeps the sound');
{
  let kept = 0, same = 0, total = 0, roundTrip = 0, noKey = 0;
  for (const recipe of RECIPE_IDS) {
    const plain = freeze(tpl(recipe));
    const loud = freeze(withSound(plain, MUSIC, NOW));
    const field = META[recipe].fields.find((f) => f.kind === 'line' || f.kind === 'text');
    const edits = [
      (m) => setFormat(m, 'portrait', NOW),
      (m) => setLang(m, 'ar', NOW),
      (m) => setSeconds(m, m.seconds + 2, NOW),
      ...(field ? [(m) => setFields(m, { [field.key]: 'New words here' }, NOW)] : []),
    ];
    for (const edit of edits) {
      total += 1;
      const a = edit(loud);
      if (J(a.sound) === J(loud.sound)) kept += 1;
      if (fixed(a)) roundTrip += 1;
      const b = edit(plain);
      if (!('sound' in b)) noKey += 1;
      // Everything but the sound is what the same edit makes of the graphic without it.
      const { sound: _s, ...rest } = a;
      if (J({ ...rest, updated: 0 }) === J({ ...b, updated: 0 })) same += 1;
    }
  }
  eq(`every rebuild of every template keeps its sound (${total} edits)`, kept, total);
  eq('and reads back from readMotion unchanged', roundTrip, total);
  eq('a graphic with no sound gets no `sound` key', noKey, total);
  eq('and the sound changes nothing else the rebuild does', same, total);
  const both = withSound(tpl('stats'), BOTH, NOW);
  eq('a sound with a seed and a level keeps both through new words', setFields(both, { title: 'Our year' }, NOW).sound, readSound(BOTH));
  eq('a template turned to Off at the defaults has no sound to keep', 'sound' in setFormat(withSound(both, { mode: 'off', level: 0.6 }, NOW), 'square', NOW), false);
  eq('off with a chosen mood is kept, for turning it on again', setLang(withSound(tpl('quote'), { mode: 'off', level: 0.6, mood: 'epic' }, NOW), 'ckb', NOW).sound, { mode: 'off', level: 0.6, mood: 'epic' });
}

// ── a rebuild keeps the scenes ────────────────────────────────────────────
console.log('a rebuild keeps the scenes');
{
  // Split keeps the template link, so a template graphic can have scenes and still be rebuilt.
  const base = tpl('big-title', 'en', 'landscape', 8);
  let cut = splitSceneAt(base, 3, NOW);
  cut = setTransition(cut, cut.scenes[1].id, 'push', NOW);
  cut = splitSceneAt(cut, 6, NOW);
  cut = freeze(setTransition(cut, cut.scenes[2].id, { kind: 'iris', d: 0.6 }, NOW));
  ok('the setup: three scenes on a graphic still linked to its template', sceneList(cut).length === 3 && isAttached(cut));
  for (const [name, edit] of [
    ['new words', (m) => setFields(m, { title: 'Brand new' }, NOW)],
    ['a new shape', (m) => setFormat(m, 'portrait', NOW)],
    ['a new language', (m) => setLang(m, 'ar', NOW)],
  ]) {
    const next = edit(cut);
    eq(`${name}: the scenes are as they were`, next.scenes, cut.scenes);
    ok(`${name}: still a template's, and reads back unchanged`, isAttached(next) && fixed(next));
  }
  ok('a graphic without scenes gets no `scenes` key from a rebuild',
    [setFields(base, { title: 'X' }, NOW), setFormat(base, 'feed', NOW), setLang(base, 'kmr', NOW), setSeconds(base, 4, NOW)].every((m) => !('scenes' in m)));

  // The length: the last scene stretches or shrinks, the others keep their place.
  const longer = setSeconds(cut, 12, NOW);
  eq('longer: the cuts stay where they were', longer.scenes.map((s) => s.start), [0, 3, 6]);
  eq('and the last scene runs to the new end', longer.scenes[2].end, 12);
  eq('with its transitions as they were', longer.scenes.map((s) => s.transition?.kind ?? 'cut'), ['cut', 'push', 'iris']);
  ok('valid, and read back unchanged', scenesValid(longer) && fixed(longer));
  const shorter = setSeconds(cut, 6.3, NOW);
  eq('shorter, with no room left for the last scene: it goes, and the one before runs to the end',
    shorter.scenes.map((s) => [s.start, s.end]), [[0, 3], [3, 6.3]]);
  ok('valid, and read back unchanged', scenesValid(shorter) && fixed(shorter));
  const tiny = setSeconds(cut, 3.2, NOW);
  ok('shorter than the second scene\'s start plus its least length: no scenes at all, and no key', !('scenes' in tiny) && fixed(tiny));
  const squeezed = setSeconds(cut, 6.6, NOW);
  ok('a transition longer than the scene it now sits beside is shortened to fit', scenesValid(squeezed)
    && squeezed.scenes[2].transition.d <= squeezed.scenes[2].end - squeezed.scenes[2].start + 1e-9, squeezed.scenes);

  // By hand: the same rule, and the layers that ran to the end run to the new one.
  const byHand = freeze(detach(cut));
  const grown = setSeconds(byHand, 11, NOW);
  eq('by hand, longer: the same scenes as the template\'s', grown.scenes.map((s) => [s.start, s.end]), [[0, 3], [3, 6], [6, 11]]);
  ok('and the layers that ran to the old end run to the new one', byHand.layers.filter((l) => l.end >= 8 - 1e-6).every((l) => grown.layers.find((x) => x.id === l.id).end === 11));
  const cutBack = setSeconds(byHand, 4, NOW);
  eq('by hand, shorter: the scene past the end goes', cutBack.scenes.map((s) => [s.start, s.end]), [[0, 3], [3, 4]]);
  ok('valid, and read back unchanged', scenesValid(cutBack) && fixed(cutBack) && scenesValid(grown) && fixed(grown));
  const none = freeze(detach(base));
  ok('by hand without scenes: no key appears', !('scenes' in setSeconds(none, 3, NOW)) && !('scenes' in setSeconds(none, 20, NOW)));
}

// ── the length, fuzzed ────────────────────────────────────────────────────
console.log('scenes stay valid through any sequence of edits');
{
  const r = rand(0x5ce7e);
  const recipes = ['big-title', 'stats', 'lower-third', 'countdown', 'bar-chart', 'logo-reveal', 'kinetic', 'quote'];
  let steps = 0, bad = [], lost = 0, unread = 0;
  for (let run = 0; run < 60; run++) {
    const recipe = recipes[run % recipes.length];
    let m = withSound(tpl(recipe, LANGUAGES[run % LANGUAGES.length], FORMAT_IDS[run % FORMAT_IDS.length]), MUSIC, NOW);
    for (let k = 0; k < 14; k++) {
      const pick = Math.floor(r() * 8);
      const at = r() * m.seconds;
      if (pick === 0) m = splitSceneAt(m, at, NOW);
      else if (pick === 1) m = addScene(m, at, NOW);
      else if (pick === 2) m = setSeconds(m, LIMITS.minSeconds + r() * (LIMITS.seconds - LIMITS.minSeconds), NOW);
      else if (pick === 3) m = setFormat(m, FORMAT_IDS[Math.floor(r() * FORMAT_IDS.length)], NOW);
      else if (pick === 4) m = setLang(m, LANGUAGES[Math.floor(r() * LANGUAGES.length)], NOW);
      else if (pick === 5 && sceneList(m).length) {
        const s = sceneList(m);
        m = setTransition(m, s[1 + Math.floor(r() * (s.length - 1))].id, ['fade', 'push', 'zoom', 'whip', 'cut'][Math.floor(r() * 5)], NOW);
      } else if (pick === 6) m = setSeconds(m, Math.round(r() * 60) / 2, NOW);
      else if (pick === 7 && m.recipe) {
        const field = META[m.recipe.id].fields.find((f) => f.kind === 'line' || f.kind === 'text');
        if (field) m = setFields(m, { [field.key]: `Words ${k}` }, NOW);
      }
      steps += 1;
      if (!scenesValid(m)) bad.push({ recipe, run, k, seconds: m.seconds, scenes: m.scenes });
      if (J(m.sound) !== J(readSound(MUSIC))) lost += 1;
      if (!fixed(m)) unread += 1;
    }
  }
  eq(`${steps} random edits: every scene list valid and the reader's own`, bad.slice(0, 2), []);
  eq('the sound survived every one of them', lost, 0);
  eq('and every graphic read back from readMotion unchanged', unread, 0);
}

// ── a rebuild keeps the brand's look ──────────────────────────────────────
console.log('a rebuild keeps the brand\'s look');
{
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const kit = readBrand({ name: 'Rasan Studio', handle: 'rasan', url: 'rasan.example', logo: PNG, paletteId: 'ocean', voice: 'serif' });
  ok('the setup: a kit with a logo, a palette and a face', !!kit && !!kit.logo && kit.voice === 'serif');
  const branded = freeze(buildMotion(kitOptionsWithBrand({ id: 'b', recipe: 'logo-reveal', lang: 'en', format: 'landscape', now: 1 }, kit)));
  const look = lookOf(branded);
  ok('a logo reveal started in the kit wears its logo and its face', !!look && look.logo === PNG && look.voice === 'serif', look);
  for (const [name, edit] of [
    ['new words', (m) => setFields(m, { tagline: 'Since 2019' }, NOW)],
    ['a new shape', (m) => setFormat(m, 'square', NOW)],
    ['a new language', (m) => setLang(m, 'kmr', NOW)],
    ['a new length', (m) => setSeconds(m, m.seconds + 3, NOW)],
  ]) {
    const next = edit(branded);
    eq(`${name}: the logo and the face are kept`, lookOf(next), look);
    ok(`${name}: the logo is still in its slot, and nothing reads differently`,
      next.layers.some((l) => l.kind === 'image' && l.src === PNG) && fixed(next));
  }
  const title = freeze(buildMotion(kitOptionsWithBrand({ id: 'c', recipe: 'big-title', lang: 'ar', format: 'portrait', now: 1 }, kit)));
  const retitled = setFields(title, { title: 'عنوان جديد' }, NOW);
  ok('a big title in the brand\'s face keeps it through new words',
    lookOf(title)?.voice === 'serif' && lookOf(retitled)?.voice === 'serif'
    && !retitled.layers.some((l) => 'voice' in l && l.voice === DISPLAY_VOICE && title.layers.find((x) => x.id === l.id && x.voice !== DISPLAY_VOICE)));
  // Without a brand nothing changes: every template rebuilds exactly as buildMotion builds it.
  let plain = 0;
  for (const recipe of RECIPE_IDS) {
    const m = tpl(recipe);
    const next = setFormat(m, 'feed', NOW);
    const direct = buildMotion({ id: 'w', recipe, fields: m.recipe.fields, lang: 'en', format: 'feed', palette: m.palette, seconds: m.seconds, now: 1, request: '', ai: false });
    if (J(next.layers) === J(direct.layers) && lookOf(next) === null) plain += 1;
  }
  eq('an unbranded template rebuilds exactly as before (every recipe)', plain, RECIPE_IDS.length);
  const applied = applyBrand(withSound(splitSceneAt(tpl('logo-reveal', 'en', 'landscape', 8), 4, NOW), BOTH, NOW), kit, NOW);
  const after = setFields(applied, { name: 'Rasan' }, NOW);
  ok('Apply brand, then new words: logo, face, sound and scenes all still there',
    J(lookOf(after)) === J(lookOf(applied)) && J(after.sound) === J(applied.sound) && J(after.scenes) === J(applied.scenes) && !!lookOf(applied));
}

// ── a new layer goes where the person is looking ──────────────────────────
console.log('a new layer goes into the scene under the playhead');
{
  let m = tpl('stats', 'en', 'landscape', 9);
  m = splitSceneAt(splitSceneAt(m, 3, NOW), 6, NOW);
  const scened = freeze(detach(m));
  const second = sceneSpan(scened, 4);
  const at4 = addLayer(scened, 'text', { text: 'Hello' }, NOW, 4);
  const made = at4.motion.layers.find((l) => l.id === at4.id);
  eq('addLayer at 4 s runs through the second scene', [made.start, made.end], [second.start, second.end]);
  ok('and reads back unchanged', fixed(at4.motion));
  const noAt = addLayer(scened, 'text', {}, NOW).motion;
  eq('without the playhead it runs the whole graphic, as before', [noAt.layers.at(-1).start, noAt.layers.at(-1).end], [0, scened.seconds]);
  const flat = freeze(detach(tpl('stats', 'en', 'landscape', 9)));
  const flatAt = addLayer(flat, 'shape', {}, NOW, 4).motion;
  eq('a graphic without scenes: the whole graphic, whatever the playhead', [flatAt.layers.at(-1).start, flatAt.layers.at(-1).end], [0, 9]);
  const own = addLayer(scened, 'text', { start: 1, end: 2 }, NOW, 7).motion;
  eq('a time given in the patch wins over the scene', [own.layers.at(-1).start, own.layers.at(-1).end], [1, 2]);
  const back = addLayer(scened, 'backdrop', {}, NOW, 7);
  const bd = back.motion.layers.find((l) => l.id === back.id);
  ok('a background added in the last scene goes to the back, in that scene', back.motion.layers[0].id === back.id && bd.start === 6 && bd.end === 9);

  // The Layers tab's Add, which knows no playhead: the panel hands the change through placeAdded.
  const layersAdd = (doc, kind, at) => placeAdded(doc, addLayer(doc, kind, { id: 'fresh' }, NOW).motion, at);
  const placed = layersAdd(scened, 'icon', 7.5);
  const icon = placed.layers.find((l) => l.id === 'fresh');
  eq('Add in Layers with the playhead in the third scene: the third scene', [icon.start, icon.end], [6, 9]);
  ok('read back unchanged', fixed(placed));
  const top = scened.layers.length - 1;
  const whole = setLayer(scened, scened.layers[top].id, { start: 0, end: 9 }, NOW);
  const copied = duplicateLayer(whole, whole.layers[top].id, NOW);
  const copy = placeAdded(whole, copied.motion, 4).layers.find((l) => l.id === copied.id);
  eq('a copy of a layer that runs the whole graphic keeps its time', [copy.start, copy.end], [0, 9]);
  const flatAdd = addLayer(flat, 'text', {}, NOW).motion;
  ok('without scenes placeAdded hands back the very object', placeAdded(flat, flatAdd, 4) === flatAdd);
  ok('and a change that added nothing is handed back as it is', placeAdded(scened, setTitle(scened, 'Other', NOW), 4).title === 'Other');
  const timed = addLayer(scened, 'text', { id: 'timed', start: 2, end: 5 }, NOW).motion;
  const t2 = placeAdded(scened, timed, 7).layers.find((l) => l.id === 'timed');
  eq('a layer added with a time of its own keeps it', [t2.start, t2.end], [2, 5]);
}

// ── editing by hand still ends the template, and keeps the rest ──────────
console.log('the hand edit still detaches');
{
  const m = freeze(withSound(splitSceneAt(tpl('lower-third', 'en', 'landscape', 8), 4, NOW), MUSIC, NOW));
  const moved = setLayer(m, m.layers.at(-1).id, { x: 7 }, NOW);
  ok('a layer moved by hand: no longer a template\'s', !isAttached(moved));
  ok('with its sound and its scenes as they were', J(moved.sound) === J(m.sound) && J(moved.scenes) === J(m.scenes));
  ok('and new words do nothing to it any more', setFields(moved, { name: 'Other' }, NOW) === moved);
  ok('the palette and the title leave the link alone', isAttached(setPalette(m, { ...m.palette, accent: '#123456' }, NOW)) && isAttached(setTitle(m, 'Again', NOW)));
}

// ── speed ─────────────────────────────────────────────────────────────────
console.log('speed');
{
  // A rebuild now also builds the template once more, plainly, to read the brand's face (lookOf): typing in a field
  // rebuilds on every key, so the pair must stay quick.
  const times = [];
  for (const recipe of RECIPE_IDS) {
    const m = withSound(tpl(recipe), MUSIC, NOW);
    const field = META[recipe].fields.find((f) => f.kind === 'line' || f.kind === 'text');
    if (!field) continue;
    const t0 = performance.now();
    setFields(m, { [field.key]: 'Typed' }, NOW);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  console.log(`  (a rebuild with its look: median ${median.toFixed(1)} ms, slowest ${times.at(-1).toFixed(1)} ms over ${times.length} templates)`);
  ok('a rebuild with its look takes well under a frame budget for typing (median < 25 ms)', median < 25, median);
}

// ── the mounts ────────────────────────────────────────────────────────────
console.log('the mounts');
{
  const panel = readFileSync('src/MotionPanel.tsx', 'utf8');
  const design = readFileSync('src/MotionDesign.tsx', 'utf8');
  const count = (src, re) => (src.match(re) ?? []).length;
  eq('the check chip is mounted in one place, Checks', count(panel, /<MotionChecks\b/g), 1);
  eq('and Checks twice: under the compact stage, and under the full window\'s', count(panel, /<Checks\b/g), 2);
  ok('never inside the transport (MotionStage draws that; the chip is not passed into it)', !/<MotionStage[^>]*>[\s\S]{0,200}<MotionChecks/.test(panel) && !/mo-stage-bar[\s\S]{0,400}MotionChecks/.test(panel));
  ok('without a measuring context', !/<MotionChecks[^>]*\bctx=/.test(panel));
  eq('exactly one sound preview', count(panel, /<MotionSoundPreview\b/g), 1);
  ok('the strip directly above the timeline, in the full window\'s time area',
    /<div className="mo-full-time">\s*<MotionScenes t=\{t\} doc=\{open\} onEdit=\{onEdit\} \/>\s*<MotionTimeline/.test(panel));
  eq('the strip once', count(panel, /<MotionScenes\b/g), 1);
  ok('templates start in the brand kit', /buildMotion\(kitOptionsWithBrand\([\s\S]{0,140}currentBrand\(\)\)\)/.test(panel));
  ok('and the kit is loaded with the graphics, once', /if \(loaded\) return;\s*loaded = true;[\s\S]{0,200}void loadBrand\(\);/.test(panel));
  ok('Layers\' Add goes through placeAdded with the playhead', /placeAdded\(m, change\(m\), read\(\)\.t\)/.test(panel) && /<MotionLayers[^>]*onEdit=\{inScene\}/.test(panel));
  eq('Design mounts the Sound row once', count(design, /<MotionSoundPanel\b/g), 1);
  ok('through the edit path, applied to the newest copy under one key', /onEdit\(\(m\) => withSound\(m, next\.sound\), 'sound'\)/.test(design));
  eq('and the brand kit\'s button once', count(design, /<MotionBrandKit\b/g), 1);
  ok('on the Colours heading\'s line', /<Section title=\{t\('Colours'\)\} aside=\{<BrandSlot><MotionBrandKit/.test(design));
  const css = readFileSync('src/styles.css', 'utf8');
  const a = css.indexOf('/* pro:w2-1 start */'), b = css.indexOf('/* pro:w2-1 end */');
  const mine = css.slice(a, b);
  ok('this package\'s styles are in their own block', a > 0 && b > a);
  ok('with no physical left or right in them', !/(^|[^-])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)/.test(mine));
}

// ── what Design and the inspector draw ────────────────────────────────────
console.log('Design and the inspector, drawn');
{
  const require = createRequire(import.meta.url);
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  if (!esbuild) ok('esbuild is there to build Design and the inspector', false);
  else {
    esbuild.buildSync({
      entryPoints: ['src/MotionDesign.tsx', 'src/MotionKinds.tsx'], bundle: true, format: 'esm', outdir: '.test-build/pro-wiring', logLevel: 'error',
      external: ['react', 'react-dom', '@tauri-apps/api/core', '@codemirror/state'],
    });
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MotionDesign } = await import('../.test-build/pro-wiring/MotionDesign.js');
    const { BackdropContent, ChartContent, backdropName, chartName } = await import('../.test-build/pro-wiring/MotionKinds.js');
    const t = (s) => s;
    const quiet = console.error;
    const render = (el) => {
      console.error = () => {};
      try { return renderToStaticMarkup(el); } finally { console.error = quiet; }
    };
    const design = (doc) => render(createElement(MotionDesign, { t, doc, selected: null, onSelect: () => {}, onEdit: () => {} }));
    const off = design(tpl('big-title'));
    eq('a plain graphic: one Sound row in Design', (off.match(/class="mo-de-sec mo-de-sound"/g) ?? []).length, 1);
    ok('Off, Effects, Music, Both, with Off chosen', ['>Off<', '>Effects<', '>Music<', '>Both<'].every((w) => off.includes(w)) && /aria-checked="true"[^>]*>Off</.test(off), off.slice(off.indexOf('mo-de-sound'), off.indexOf('mo-de-sound') + 900));
    ok('and nothing more of sound while it is off: no moods, no level', !off.includes('mo-sound-moods') && !off.includes('>Level<'));
    ok('the brand kit is one button on the Colours heading\'s line', /class="mo-de-head"><h3[^>]*>Colours<\/h3><span class="mo-de-brand"><div class="mb-anchor"><button[^>]*class="ghost mb-btn"/.test(off));
    const music = design(withSound(tpl('big-title'), MUSIC, NOW));
    ok('with Music: the moods and the level appear', music.includes('mo-sound-moods') && music.includes('>Level<'));
    ok('in the order of the tab: length, then sound, then language', off.indexOf('mo-de-len') < off.indexOf('mo-de-sound') && off.indexOf('mo-de-sound') < off.indexOf('Language of the words'));

    const names = BACKDROPS.map((b) => backdropName(b, t));
    eq('every background style has a name of its own', new Set(names).size, BACKDROPS.length);
    eq('the finishes by their names', ['grain', 'vignette', 'lightleak', 'scanlines', 'halftone'].map((b) => backdropName(b, t)), ['Grain', 'Vignette', 'Light leak', 'Scan lines', 'Halftone']);
    eq('every chart kind has a name of its own', new Set(CHARTS.map((c) => chartName(c, t))).size, CHARTS.length);
    eq('the race is the Race', chartName('race', t), 'Race');

    const film = tpl('film-look');
    const finish = film.layers.find((l) => l.kind === 'backdrop' && l.style === 'grain');
    ok('the setup: the film look has a grain', !!finish);
    const props = (layer, doc) => ({ t, layer, doc, set: () => {}, update: () => {} });
    const grain = render(createElement(BackdropContent, props(finish, film)));
    ok('a grain\'s sliders are named for what they do', grain.includes('>Coarseness<') && grain.includes('>Flicker<') && !grain.includes('>Density<'), grain.slice(0, 300));
    const leak = render(createElement(BackdropContent, props({ ...finish, style: 'lightleak' }, film)));
    ok('a light leak\'s: how strong, and how many times it blooms', leak.includes('>Strength<') && leak.includes('>Blooms<'));
    const ground = film.layers.find((l) => l.kind === 'backdrop' && !['grain', 'vignette', 'lightleak', 'scanlines', 'halftone'].includes(l.style))
      ?? { ...finish, style: 'aurora' };
    const aurora = render(createElement(BackdropContent, props({ ...ground, style: 'aurora' }, film)));
    ok('a ground keeps Speed and Density', aurora.includes('>Speed<') && aurora.includes('>Density<'));

    const raceDoc = tpl('bar-race');
    const race = raceDoc.layers.find((l) => l.kind === 'chart' && l.chart === 'race');
    ok('the setup: the bar-chart race has a race', !!race);
    const raced = render(createElement(ChartContent, props(race, raceDoc)));
    ok('a race: its kind lit as Race, with its own glyph (bars lying down and a rising arrow)',
      /aria-checked="true"[^>]*aria-label="Race"><svg[^>]*><path d="M4\.5 4\.5v15M4\.5 8h13/.test(raced));
    ok('a race says how its earlier values are written', raced.includes('Earlier values go in the label after a |'));
    ok('and offers no Max, which a race does not use', !raced.includes('>Max<'));
    const bars = render(createElement(ChartContent, props({ ...race, chart: 'bars' }, raceDoc)));
    ok('bars keep their Max and say nothing about races', bars.includes('>Max<') && !bars.includes('Earlier values'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
