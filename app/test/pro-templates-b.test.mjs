// Work package 08: the five finishes (motionbackdrop.ts), the bar-chart race
// (motioncharts.ts) and the seven templates (motionrecipes-pro-b.ts, -meta).
//
// What matters:
// - Each finish draws only what a browser accepts, in every shape, dark and
//   light, at any moment; the same moment twice is the same calls; it loops
//   (one period later is the same frame) and holds still at speed 0; it never
//   paints above the layer's opacity or leaves the state changed; it is drawn
//   in u (the same count of lines and dots at any output size); it costs a
//   bounded number of calls; and it is see-through where a finish should be.
// - The race reads and writes its data model exactly; its values at progress
//   0, the middle and 1 are the periods' own; places follow the values, ties
//   keep the written order; negative, zero and huge values are clean; the
//   scale follows the leader; two colours hand the lead's colour on.
// - Every template builds in every language, shape and length as a fixed
//   point of the reader, lays out the same in both directions (mirrored, box
//   for box), keeps every word inside the frame, paints clean frames, reads
//   its fields defensively, and has samples and metadata that are whole.
//
// ## The default run and the full sweep
//
// `npm test` runs a representative sweep of the templates: every template in
// two shapes (wide and tall, the two that differ most) and two languages
// (English and one right-to-left language, a different one per template so
// Arabic, Sorani and Badini all run), at its own length and at the shortest
// and longest a graphic may be (1 s and 30 s). The extremes run in full every
// time: the longest text every field takes and every field empty, in every
// shape, in English and Arabic; the mirror test in every shape; junk in every
// field. The full sweep — every template in every language and every shape,
// at its own length, 1, 2 and 30 s (448 builds) — runs with VYLO_FULL=1:
//
//   cd app && VYLO_FULL=1 node test/pro-templates-b.test.mjs   # this file, once npm test has built .test-build
//   cd app && VYLO_FULL=1 npm test                             # the whole chain, with the full sweep
//
// (docs/pro/f3-perf.md says why, and what the default was shown to still catch.)
import { createHash } from 'node:crypto';
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { drawBackdrop } from '../.test-build/motionbackdrop.js';
import { drawChart, raceSeries, raceData, raceValues, raceOrder, raceWindow, raceAt, RACE_STEPS } from '../.test-build/motioncharts.js';
import { PRO_B_RECIPES } from '../.test-build/motionrecipes-pro-b.js';
import { PRO_B_META } from '../.test-build/motionrecipes-pro-b-meta.js';
import { PRO_B_IDS } from '../.test-build/motionids.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';
import { META, PALETTE_IDS } from '../.test-build/motionrecipe.js';
import { readMotion, readLayer, blankLayer } from '../.test-build/motionread.js';
import { paint, makeEnv, layerBox } from '../.test-build/motiondraw.js';
import { inDone, outStart, unitsOf, stillTime, poseAt } from '../.test-build/motionanim.js';
import { BACKDROPS, CHARTS, RECIPE_IDS, CORE_RECIPE_IDS, RECIPE_GROUPS, LIMITS } from '../.test-build/motiontypes.js';
import { contrast, luminance, mixColors } from '../.test-build/motionmath.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);
/** The full sweep instead of the representative one (see the top of this file). */
const FULL = process.env.VYLO_FULL === '1';
const LANGS = ['en', 'ar', 'ckb', 'kmr'];
const FORMATS = ['landscape', 'portrait', 'square', 'feed'];
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const FINISHES = ['grain', 'vignette', 'lightleak', 'scanlines', 'halftone'];

// ── the finishes ──────────────────────────────────────────────────────────
console.log('finishes');

const DARK = { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' };
const LIGHT = { bg: '#F6F4EF', fg: '#14161F', accent: '#2F6BFF', accent2: '#FF5A7A', muted: '#6B7185' };
const docOf = (o = {}) => ({
  id: 'd', title: 't', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6,
  palette: DARK, backdrop: null, layers: [], stage: 'ready', created: 0, updated: 0, ...o,
});
const envOf = (ctx, doc, t, w, h) => ({
  ctx, doc, t, k: Math.min(w, h) / 100, width: w, height: h, rtl: doc.lang !== 'en',
  color: (c) => doc.palette[c] ?? c,
  paint: (p) => (typeof p === 'string' ? doc.palette[p] ?? p : '#FFFFFF'),
});
const POSE = { on: true, presence: 1, opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1 };
const base = { id: 'l', name: 'l', start: 0.5, end: 6, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1 };
const backdrop = (o = {}) => ({ ...base, kind: 'backdrop', style: 'grain', colors: [], speed: 1, density: 0.5, seed: 3, ...o });

/** One backdrop layer drawn as paint draws it, with the state before and after. */
function bd(layer, t, o = {}) {
  const doc = o.doc ?? docOf();
  const [w, h] = o.size ?? SIZES[doc.format];
  const { ctx, calls, check } = makeCanvas(w, h);
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.blend) ctx.globalCompositeOperation = o.blend;
  const before = J([ctx.globalAlpha, ctx.globalCompositeOperation, ctx.getTransform()]);
  const from = calls.length;
  drawBackdrop(envOf(ctx, doc, t, w, h), layer, POSE);
  const mine = calls.slice(from);
  const after = J([ctx.globalAlpha, ctx.globalCompositeOperation, ctx.getTransform()]);
  ctx.restore();
  return { calls: mine, problems: check(), same: before === after };
}
/**
 * A canvas handed to a call (the grain's tile, to `createPattern`) as a digest
 * of everything recorded on it, made once per canvas and again only when more
 * has been recorded on it since.
 */
const digests = new WeakMap();
function canvasDigest(cv) {
  const at = `${cv.width}x${cv.height}/${cv.rec?.calls?.length ?? 0}/${cv.rec?.problems?.length ?? 0}`;
  const kept = digests.get(cv);
  if (kept && kept.at === at) return kept.digest;
  const digest = `[canvas ${createHash('sha1').update(JSON.stringify(cv)).digest('hex')}]`;
  digests.set(cv, { at, digest });
  return digest;
}
/**
 * A frame's calls as one string, exactly. (It always was exact: it used to
 * pass a rounding replacer to `J`, which takes one argument, so the rounding
 * never ran, and every check below was written against the exact calls.) A
 * canvas in a call is written as `canvasDigest` of it rather than whole: whole,
 * the grain's tile was three megabytes of noise in every frame's string, twelve
 * of this file's sixteen seconds, and its digest tells the same canvases apart.
 */
const sig = (calls) => JSON.stringify(calls.map((c) => [c.name, c.args, c.m, c.alpha]), (_, v) => (
  v && typeof v === 'object' && typeof v.getContext === 'function' ? canvasDigest(v) : v
));
const count = (calls, name) => calls.filter((c) => c.name === name).length;
/**
 * Two frames' calls the same to a millionth (relative), numbers inside colour
 * strings included: a loop's two ends differ in the last bits of a float, and
 * rounding both to three places can still straddle a boundary.
 */
function sameFrame(a, b) {
  if (a.length !== b.length) return false;
  const near = (x, y) => x === y || Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  const flat = (v, out = []) => {
    if (typeof v === 'number') out.push(v);
    else if (typeof v === 'string') { out.push(v.replace(/-?\d+(\.\d+)?(e-?\d+)?/g, '#')); for (const m of v.matchAll(/-?\d+(\.\d+)?(e-?\d+)?/g)) out.push(parseFloat(m[0])); }
    else if (Array.isArray(v)) v.forEach((x) => flat(x, out));
    else if (v && typeof v === 'object' && typeof v.getContext !== 'function') Object.keys(v).sort().forEach((k) => flat(v[k], out));
    return out;
  };
  return a.every((c, i) => {
    const d = b[i];
    if (c.name !== d.name) return false;
    const x = flat([c.args, c.m, c.alpha]);
    const y = flat([d.args, d.m, d.alpha]);
    return x.length === y.length && x.every((v, j) => (typeof v === 'number' ? typeof y[j] === 'number' && near(v, y[j]) : v === y[j]));
  });
}

ok('the contract lists the five finishes after the seven grounds', J(BACKDROPS.slice(7)) === J(FINISHES) && BACKDROPS.length === 12, BACKDROPS);
ok('and the race after the five charts', CHARTS[CHARTS.length - 1] === 'race' && CHARTS.length === 6, CHARTS);
ok('a document naming a finish or the race reads back with it',
  readLayer({ kind: 'backdrop', style: 'lightleak' }, { seconds: 6 }).style === 'lightleak' && readLayer({ kind: 'chart', chart: 'race', data: [{ label: 'A|1 2', value: 3 }] }, { seconds: 6 }).chart === 'race'
  && readLayer({ kind: 'backdrop', style: 'film' }, { seconds: 6 }).style === 'aurora');
{
  const bad = [];
  const empty = [];
  for (const style of FINISHES) for (const format of FORMATS) for (const pal of [DARK, LIGHT]) for (const t of [-1, 0, 0.49, 0.5, 3.25, 5.99]) {
    const r = bd(backdrop({ style }), t, { doc: docOf({ format, palette: pal }) });
    if (r.problems.length) bad.push([style, format, t, r.problems.slice(0, 2)]);
    if (!drewSomething(r.calls)) empty.push([style, format, t]);
    if (!r.same) bad.push([style, format, t, 'state changed']);
  }
  ok('every finish, every shape, dark and light, six moments: nothing a browser rejects, state as it was', bad.length === 0, bad.slice(0, 3));
  ok('...and every one draws something at every one of them', empty.length === 0, empty.slice(0, 3));
}
{
  const bad = [];
  for (const style of FINISHES) for (const density of [0, 1]) for (const speed of [0, 0.4, 3]) for (const fps of [24, 30, 60]) {
    const r = bd(backdrop({ style, density, speed, seed: 99 }), 2.2, { doc: docOf({ fps }) });
    if (r.problems.length || !drewSomething(r.calls)) bad.push([style, density, speed, fps, r.problems.slice(0, 2)]);
  }
  const nonsense = [{ speed: NaN, density: Infinity, seed: NaN }, { colors: ['', 'nonsense', '#zzz'] }, { start: NaN }, { colors: ['accent'] }];
  for (const style of FINISHES) for (const o of nonsense) {
    const r = bd(backdrop({ style, ...o }), 1.5);
    if (r.problems.length || !drewSomething(r.calls)) bad.push([style, o, r.problems.slice(0, 2)]);
  }
  for (const style of FINISHES) {
    const r = bd(backdrop({ style }), NaN, { doc: docOf({ seconds: NaN, fps: NaN }) });
    if (r.problems.length) bad.push([style, 'NaN time', r.problems]);
    const none = bd(backdrop({ style }), 1, { size: [0, 0] });
    if (drewSomething(none.calls) || none.problems.length) bad.push([style, 'no frame']);
  }
  ok('the ends of density and speed, any frame rate, nonsense numbers and colours, no time and no frame: all clean', bad.length === 0, bad.slice(0, 3));
}
{
  const same = FINISHES.filter((style) => sig(bd(backdrop({ style }), 2.3).calls) === sig(bd(backdrop({ style }), 2.3).calls));
  ok('the same moment twice is the same calls', same.length === 5, FINISHES.filter((s) => !same.includes(s)));
  const moving = FINISHES.filter((style) => sig(bd(backdrop({ style }), 1.2).calls) !== sig(bd(backdrop({ style }), 1.9).calls));
  ok('every finish moves', moving.length === 5, FINISHES.filter((s) => !moving.includes(s)));
  const still = FINISHES.filter((style) => sig(bd(backdrop({ style, speed: 0 }), 1.2).calls) === sig(bd(backdrop({ style, speed: 0 }), 4.7).calls));
  ok('speed 0 holds every finish still', still.length === 5, FINISHES.filter((s) => !still.includes(s)));
  const seams = [];
  for (const style of FINISHES) for (const [speed, period] of [[1, 6], [2, 3], [3, 2], [0.4, 6]]) for (const t of [1.37, 2.9, 4.01]) {
    if (!sameFrame(bd(backdrop({ style, speed }), t).calls, bd(backdrop({ style, speed }), t + period).calls)) seams.push([style, speed, t]);
  }
  ok('one period later is the same frame, to a millionth: a looping export has no seam', seams.length === 0, seams.slice(0, 4));
  const seeds = FINISHES.filter((style) => sig(bd(backdrop({ style, seed: 1 }), 2).calls) !== sig(bd(backdrop({ style, seed: 2 }), 2).calls));
  ok('another seed is another finish', seeds.length === 5, FINISHES.filter((s) => !seeds.includes(s)));
  const over = FINISHES.filter((style) => bd(backdrop({ style }), 2, { alpha: 0.4 }).calls.some((c) => c.alpha > 0.4 + 1e-9));
  ok('nothing is drawn above the layer\'s opacity', over.length === 0, over);
}
{
  // In u: what a finish is made of is the same count of things at any output size.
  const marks = (style, w, h) => {
    const calls = bd(backdrop({ style, density: 0.7 }), 2, { size: [w, h] }).calls;
    return style === 'scanlines' ? count(calls, 'rect') : count(calls, 'arc');
  };
  const sizes = [];
  for (const style of ['scanlines', 'halftone']) for (const [w, h] of [[1920, 1080], [1080, 1350]]) {
    const big = marks(style, w * 2, h * 2);
    const small = marks(style, w / 4, h / 4);
    const full = marks(style, w, h);
    if (Math.abs(big - full) > full * 0.03 + 2 || Math.abs(small - full) > full * 0.06 + 2) sizes.push([style, w, h, small, full, big]);
  }
  ok('scan lines and halftone dots are laid out in u: the same count at a quarter, the full and twice the size', sizes.length === 0, sizes);
  const cells = [480, 1920, 3840].map((w) => {
    const c = bd(backdrop({ style: 'grain' }), 2, { size: [w, (w * 9) / 16] }).calls.find((x) => x.name === 'fillRect' && x.m && Math.abs(x.m[0]) !== 1);
    return c ? Math.hypot(c.m[0], c.m[1]) / (Math.min(w, (w * 9) / 16) / 100) : NaN;
  });
  ok('a grain fleck is the same share of the frame at any size (its scale in u)', cells.every((x) => Number.isFinite(x) && Math.abs(x - cells[0]) < 1e-9), cells);
}
{
  // Bounded cost: every finish's calls, at the densest, in the largest-area shape.
  const costs = {};
  for (const style of FINISHES) {
    let most = 0;
    for (const format of FORMATS) {
      const calls = bd(backdrop({ style, density: 1 }), 2.2, { doc: docOf({ format }) }).calls;
      most = Math.max(most, calls.length);
      if (style === 'halftone') costs.halftoneDots = Math.max(costs.halftoneDots ?? 0, count(calls, 'arc')), costs.halftoneFills = Math.max(costs.halftoneFills ?? 0, count(calls, 'fill'));
    }
    costs[style] = most;
  }
  console.log(`    cost (calls a frame at density 1, worst shape): ${J(costs)}`);
  ok('the heaviest finish, the halftone, is under 7,000 dots in under 40 fills; the others under 200 calls a frame',
    costs.halftoneDots < 7000 && costs.halftoneFills < 40 && ['grain', 'vignette', 'lightleak'].every((s) => costs[s] < 200) && costs.scanlines < 1000, costs);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) bd(backdrop({ style: 'halftone', density: 1 }), i * 0.3);
  const ms = (performance.now() - t0) / 20;
  console.log(`    halftone at density 1, 1920x1080, recorded in Node: ${ms.toFixed(1)} ms a frame (field and layout; the recording canvas draws nothing)`);
  ok('...and its field and layout take under 30 ms a frame in Node', ms < 30, ms);
}
{
  // See-through where a finish should be.
  const alphaOf = (s) => {
    const m = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(String(s));
    if (m) return parseFloat(m[1]);
    return /^#([0-9a-f]{8})$/i.test(String(s)) ? parseInt(String(s).slice(7), 16) / 255 : 1;
  };
  const opaque = [];
  for (const style of ['grain', 'vignette', 'scanlines', 'halftone']) for (const density of [0, 0.5, 1]) {
    const r = bd(backdrop({ style, density }), 2);
    for (const c of r.calls) {
      if (c.name === 'fillStyle' && c.set && typeof c.args[0] === 'string' && alphaOf(c.args[0]) >= 1) opaque.push([style, density, c.args[0]]);
      if (c.name === 'createRadialGradient' || c.name === 'createLinearGradient') { /* stops are checked below */ }
    }
  }
  ok('grain, vignette, scan lines and halftone set no opaque colour: what is under them shows', opaque.length === 0, opaque.slice(0, 3));
  const v = bd(backdrop({ style: 'vignette', density: 0.5 }), 2).calls;
  const g = v.find((c) => c.name === 'createRadialGradient');
  ok('the vignette is clear in the middle: its gradient starts past the centre', g && g.args[2] > 0.15 && g.args[2] < g.args[5], g?.args);
  const reach = (d) => bd(backdrop({ style: 'vignette', density: d, speed: 0 }), 2).calls.find((c) => c.name === 'createRadialGradient').args[2];
  ok('...and a denser vignette reaches further in', reach(1) < reach(0), [reach(0), reach(1)]);
  const grainOps = bd(backdrop({ style: 'grain' }), 2).calls.filter((c) => c.name === 'globalCompositeOperation').map((c) => c.args[0]);
  ok('the grain lies over a transparent frame too (no source-atop): it is a finish, not a dither', !grainOps.includes('source-atop') && count(bd(backdrop({ style: 'grain' }), 2).calls, 'createPattern') === 1, grainOps);
  const ops = (r) => new Set(r.calls.filter((c) => c.name === 'globalCompositeOperation').map((c) => c.args[0]));
  ok('a light leak is added as light (screen), unless the layer has a blend of its own',
    ops(bd(backdrop({ style: 'lightleak' }), 2)).has('screen') && !ops(bd(backdrop({ style: 'lightleak' }), 2, { blend: 'multiply' })).has('screen'));
}
{
  // Each finish's own behaviour.
  const grainFrames = (speed, fps) => {
    const seen = new Set();
    let last = '';
    let changes = 0;
    for (let i = 0; i < 240; i++) {
      const s = sig(bd(backdrop({ style: 'grain', speed }), 2 + i / 240, { doc: docOf({ fps }) }).calls);
      if (s !== last) changes++;
      last = s;
      seen.add(s);
    }
    return changes;
  };
  const film = grainFrames(1, 30);
  const twos = grainFrames(0.5, 30);
  const fast = grainFrames(3, 30);
  ok('the grain changes 24 times a second at speed 1 (film), 12 at 0.5, and never more often than the frame rate', Math.abs(film - 24) <= 1 && Math.abs(twos - 12) <= 1 && Math.abs(fast - 30) <= 1, { film, twos, fast });
  // Where no canvas can be made for the tiles, the grain is a few hundred flecks drawn straight on: coarser, never nothing.
  const kept = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  const bare = bd(backdrop({ style: 'grain', colors: ['#FFFFFE', '#010101'] }), 2);
  globalThis.OffscreenCanvas = kept;
  ok('with no canvas for its tiles the grain draws flecks instead, cleanly and within bounds',
    !bare.problems.length && count(bare.calls, 'createPattern') === 0 && count(bare.calls, 'rect') > 100 && count(bare.calls, 'rect') < 1200, [count(bare.calls, 'rect'), bare.problems]);
  const leaks = (d) => Math.max(...[0.6, 1.4, 2.2, 3, 3.8, 4.6, 5.4].map((t) => count(bd(backdrop({ style: 'lightleak', density: d }), t).calls, 'createRadialGradient')));
  ok('a denser light leak has more leaks (one to three, each a glow and a core)', leaks(0) === 2 && leaks(1) === 6, [leaks(0), leaks(1)]);
  const lines = (d) => count(bd(backdrop({ style: 'scanlines', density: d }), 2).calls, 'rect');
  ok('denser scan lines are finer and so more of them', lines(1) > lines(0) * 2, [lines(0), lines(1)]);
  const dots = (d) => count(bd(backdrop({ style: 'halftone', density: d }), 2).calls, 'arc');
  ok('a denser halftone screen has more, smaller dots', dots(1) > dots(0) * 2, [dots(0), dots(1)]);
}

// ── the race: its data model ──────────────────────────────────────────────
console.log('the race');
{
  const r = raceSeries('Rome|12 18 25', 31);
  ok('raceSeries: the name before the bar, the values after it, then the value', r.name === 'Rome' && J(r.series) === J([12, 18, 25, 31]), r);
  ok('...a label with no bar is all name, its series the value alone', J(raceSeries('Rome', 7)) === J({ name: 'Rome', series: [7] }));
  ok('...a bar followed by words is part of the name', J(raceSeries('A|B', 2)) === J({ name: 'A|B', series: [2] }) && raceSeries('Q1|2023 sales', 1).name === 'Q1|2023 sales');
  ok('...the last bar counts, so a name may hold one', J(raceSeries('A|B|1 2', 3)) === J({ name: 'A|B', series: [1, 2, 3] }));
  ok('...a bar with nothing after it is a name', J(raceSeries('Rome|', 5)) === J({ name: 'Rome', series: [5] }));
  ok('...Arabic-Indic and Persian digits, the Arabic decimal sign, signs, exponents and semicolons read',
    J(raceSeries('روما|١٢ ۱۸;٢٫٥ -3 1e3', 4).series) === J([12, 18, 2.5, -3, 1000, 4]), raceSeries('روما|١٢ ۱۸;٢٫٥ -3 1e3', 4));
  const long = raceSeries(`A|${Array.from({ length: 30 }, (_, i) => i).join(' ')}`, 99);
  ok(`...at most ${RACE_STEPS} periods, the value always last`, long.series.length === RACE_STEPS && long.series[RACE_STEPS - 1] === 99 && long.series[0] === 0, long.series);
  const wild = [raceSeries('A|1e999 -1e999', NaN), raceSeries(null, Infinity), raceSeries(undefined, 'x'), raceSeries('A|1 2', -0)];
  ok('...every number finite and held to ±1e12, never -0', wild.every((x) => x.series.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e12 && !Object.is(v, -0))), wild);
}
{
  const rows = [{ name: 'Apples', values: [40, 55, 72] }, { name: 'Oranges', values: [28, 44, 70, 95] }, { name: 'Pi|e', values: [1.5] }];
  const { data, steps } = raceData(rows);
  const back = data.map((d) => raceSeries(d.label, d.value));
  ok('raceData: rows padded to the longest (a short one holds its last value), and read back exactly',
    J(steps) === J([0, 1, 2, 3]) && J(back[0].series) === J([40, 55, 72, 72]) && J(back[1].series) === J([28, 44, 70, 95]) && J(back[2].series) === J([1.5, 1.5, 1.5, 1.5]), { data, back });
  ok('...a bar in a name is written as a slash, so the name reads back whole', back[2].name === 'Pi/e', back[2]);
  const big = raceData([{ name: 'Very long racer name here', values: [1234567, 2345678, 3456789, 4567890, 5678901, 6789012, 7890123, 8901234] }, { name: 'B', values: [1, 2, 3, 4, 5, 6, 7, 8] }]);
  const backBig = big.data.map((d) => raceSeries(d.label, d.value));
  ok('...a label that would pass 40 characters drops periods evenly, keeping the first and the last, and says which',
    big.data.every((d) => Array.from(d.label).length <= LIMITS.label) && big.steps[0] === 0 && big.steps[big.steps.length - 1] === 7 && big.steps.length < 8
    && J(backBig[1].series) === J(big.steps.map((i) => i + 1)) && backBig[0].series.every((v, j) => v === [1234567, 2345678, 3456789, 4567890, 5678901, 6789012, 7890123, 8901234][big.steps[j]]), big);
  const huge = raceData([{ name: 'X'.repeat(40), values: [1e12, -1e12, 5e11] }]);
  ok('...and a name too long for even two periods gives way, never the numbers', Array.from(huge.data[0].label).length <= LIMITS.label
    && J(raceSeries(huge.data[0].label, huge.data[0].value).series.slice(-1)) === J([5e11]), huge);
  const exact = raceData([{ name: 'n', values: [1200000, 0.1, 12.5, -3e-7, 4.5e11] }]);
  ok('...numbers are written short and exactly (1.2e6), every one reading back to itself', J(raceSeries(exact.data[0].label, exact.data[0].value).series) === J([1200000, 0.1, 12.5, -3e-7, 4.5e11]) && exact.data[0].label.includes('1.2e6'), exact);
  const many = raceData(Array.from({ length: 20 }, (_, i) => ({ name: `R${i}`, values: [i] })));
  const none = raceData([]);
  const junk = raceData([{ name: null, values: [NaN, Infinity, 'x'] }, null]);
  ok('...at most twelve racers; none, or junk, is still data', many.data.length === LIMITS.dataPoints && none.data.length === 0 && junk.data.every((d) => typeof d.label === 'string' && Number.isFinite(d.value)), [many.data.length, none, junk]);
}
{
  const S = [[10, 40, 20, 50, 30], [30, 30, 30, 30, 30], [0, 5, 60, 60, 90]];
  ok('raceValues: at 0 the first period, at the last the last, at a whole number that period exactly',
    J(raceValues(S, 0)) === J([10, 30, 0]) && J(raceValues(S, 4)) === J([30, 30, 90]) && J(raceValues(S, 2)) === J([20, 30, 60]) && J(raceValues(S, 99)) === J([30, 30, 90]) && J(raceValues(S, -5)) === J([10, 30, 0]));
  let between = true;
  for (let q = 0; q <= 4; q += 0.01) {
    const v = raceValues(S, q);
    const i = Math.min(3, Math.floor(q));
    S.forEach((s, j) => { if (v[j] < Math.min(s[i], s[i + 1]) - 1e-9 || v[j] > Math.max(s[i], s[i + 1]) + 1e-9) between = false; });
  }
  ok('...between two periods a value never leaves their range (no overshoot past the next number)', between);
  const smooth = raceValues([[0, 100]], 0.5)[0];
  ok('...and eases out of the first period and into the last (no jump in speed at the ends)', raceValues([[0, 100]], 0.05)[0] < 5 && smooth === 50, [raceValues([[0, 100]], 0.05)[0], smooth]);
  ok('...a shorter series holds its last value', J(raceValues([[1, 2, 3], [7]], 2)) === J([3, 7]));
  ok('raceOrder: the largest first; equal values keep the order they were given in', J(raceOrder([5, 9, 5, 1])) === J([1, 0, 2, 3]) && J(raceOrder([3, 3, 3])) === J([0, 1, 2]));
  ok('...negative, zero, huge and not-a-number', J(raceOrder([-5, 0, 1e12, NaN, -1e12])) === J([3, 1, 0, 2, 4]));
}

// ── the race: drawn ───────────────────────────────────────────────────────
const PALETTE = DARK;
const chartDoc = (lang = 'en') => ({ ...docOf({ lang, seconds: 12 }) });
const grow = (o = {}) => ({ fx: 'grow', d: 0.8, delay: 0, ease: 'expo-out', amount: 1, ...o });
const race = (o = {}) => ({
  id: 'r', name: 'r', start: 0, end: 12, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1,
  kind: 'chart', chart: 'race', w: 140, h: 70, colors: ['muted', 'accent'], max: 0, unit: '', labels: true, values: true, voice: 'sans', size: 3,
  color: 'fg', thick: 1.4, gap: 0.08, in: grow(), out: grow({ d: 0.45, ease: 'out' }),
  data: [{ label: 'A|10 40 20 50', value: 30 }, { label: 'B|30 30 30 30', value: 30 }, { label: 'C|0 5 60 60', value: 90 }, { label: 'D|20 20 25 10', value: 5 }], ...o,
});
function drawRace(layer, t, o = {}) {
  const { ctx, calls, check } = makeCanvas(1920, 1080);
  ctx.save();
  ctx.translate(960, 540);
  const doc = chartDoc(o.lang);
  drawChart({ ...envOf(ctx, doc, t, 1920, 1080), color: (c) => PALETTE[c] ?? c }, layer, POSE);
  ctx.restore();
  const texts = [];
  let font = '';
  let fill = '';
  for (const c of calls) {
    if (c.name === 'font' && c.set) font = c.args[0];
    if (c.name === 'fillStyle' && c.set) fill = c.args[0];
    if (c.name === 'fillText') texts.push({ text: c.args[0], x: c.args[1], y: c.args[2], font, fill, alpha: c.alpha });
  }
  return { calls, problems: check(), texts };
}
const num = (s) => parseFloat([...String(s)].map((ch) => {
  const c = ch.charCodeAt(0);
  if (c >= 0x660 && c <= 0x669) return String(c - 0x660);
  if (c === 0x66b) return '.';
  return ch === ',' || c === 0x66c ? '' : ch;
}).join('').replace(/[^0-9.\-]/g, ''));
const NAMES = ['A', 'B', 'C', 'D'];
/** The names top to bottom, and each name's value as written beside it, at `t`. */
function standing(layer, t, lang) {
  const r = drawRace(layer, t, { lang });
  const labels = r.texts.filter((x) => NAMES.includes(x.text)).sort((p, q) => p.y - q.y);
  const values = Object.fromEntries(labels.map((l) => [l.text, num(r.texts.find((x) => !NAMES.includes(x.text) && Math.abs(x.y - l.y) < 1e-6 && x !== l)?.text)]));
  return { order: labels.map((l) => l.text), values, r };
}
{
  const layer = race();
  const win = raceWindow(layer);
  ok('raceWindow: after the last bar has arrived and before the exit, with a hold on the final standing',
    win.from >= inDone(layer, 4) && win.to <= outStart(layer, 4) - 1 && win.to > win.from, win);
  ok('raceAt: 0 before the window, the last period after it, even in between', raceAt(layer, 0, 5) === 0 && raceAt(layer, 11, 5) === 4
    && Math.abs(raceAt(layer, (win.from + win.to) / 2, 5) - 2) < 1e-9 && raceAt(layer, NaN, 5) === 0 && raceAt(layer, 5, 1) === 0);
  const start = standing(layer, win.from - 0.3);
  const mid = standing(layer, (win.from + win.to) / 2);
  const end = standing(layer, 11.2);
  ok('at progress 0: the first period\'s values, in their order (B 30, D 20, A 10, C 0)', J(start.order) === J(['B', 'D', 'A', 'C']) && J(start.values) === J({ B: 30, D: 20, A: 10, C: 0 }), start);
  ok('half-way: the middle period\'s values, in their order (C 60, B 30, D 25, A 20)', J(mid.order) === J(['C', 'B', 'D', 'A']) && J(mid.values) === J({ C: 60, B: 30, D: 25, A: 20 }), mid);
  ok('at progress 1: the final values, which are the data\'s own (C 90, A 30, B 30, D 5)', J(end.order) === J(['C', 'A', 'B', 'D']) && J(end.values) === J({ C: 90, A: 30, B: 30, D: 5 }), end);
  ok('...and A and B, tied at 30, stand in the order they were written', end.order.indexOf('A') < end.order.indexOf('B'));
  const ties = race({ data: [{ label: 'D|5 5 5', value: 5 }, { label: 'A|5 5 5', value: 5 }, { label: 'C|5 5 5', value: 5 }] });
  const tied = [0.5, 3, 6, 9, 11.4].map((t) => standing(ties, t).order.join(''));
  ok('a race of equal values never reshuffles: the written order, at every moment', tied.every((o) => o === 'DAC'), tied);
  const frames = [];
  for (let t = 0; t <= 12; t += 0.05) frames.push(drawRace(layer, t));
  const sorted = frames.every((f) => {
    const y = f.texts.filter((x) => NAMES.includes(x.text)).map((x) => x.y);
    return y.every(Number.isFinite);
  });
  ok('through the whole race every frame is clean, and every place finite', frames.every((f) => !f.problems.length) && sorted, frames.find((f) => f.problems.length)?.problems);
  // Places glide: between two frames 1/20 s apart no bar moves more than its own row.
  const rowY = (f) => Object.fromEntries(f.texts.filter((x) => NAMES.includes(x.text)).map((x) => [x.text, x.y]));
  let jump = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = rowY(frames[i - 1]);
    const b = rowY(frames[i]);
    for (const n of NAMES) if (a[n] !== undefined && b[n] !== undefined) jump = Math.max(jump, Math.abs(a[n] - b[n]));
  }
  ok('an overtake is a slide: no bar moves more than one row in a twentieth of a second', jump > 0 && jump < (70 * 10.8 * 0.86) / 4, jump);
}
{
  const edge = race({ data: [{ label: 'Neg|-5 -40 -10', value: -20 }, { label: 'Zero|0 0 0', value: 0 }, { label: 'Huge|1e12 5e11 1', value: 1e12 }, { label: 'Tiny|0.001 0.002', value: 0.004 }] });
  const bad = [];
  for (const lang of ['en', 'ar']) for (const t of [-1, 0, 0.3, 2, 5, 8, 11.5, 12.5]) {
    const r = drawRace(edge, t, { lang });
    if (r.problems.length) bad.push([lang, t, r.problems.slice(0, 2)]);
  }
  ok('negative, zero, huge and tiny values: clean in both directions at every moment', bad.length === 0, bad.slice(0, 2));
  const end = drawRace(edge, 11.2);
  const neg = end.texts.find((x) => /^-20/.test(x.text));
  ok('...a negative value is labelled with its sign, never a false 0', !!neg, end.texts.map((x) => x.text));
  const tops = (t) => end.texts.length && drawRace(race(), t).texts.filter((x) => x.y < -300).map((x) => num(x.text));
  const early = tops(2.5);
  const late = tops(11.2);
  ok('the scale follows the leader: the ticks at the end reach further than at the start, three to seven of them',
    Math.max(...late) > Math.max(...early) && early.length >= 3 && early.length <= 7 && late.length >= 3 && late.length <= 7, { early, late });
  // Two colours: the bars in the first, the leader in the second.
  const fills = (t) => {
    const r = drawRace(race(), t);
    return r.calls.filter((c) => c.name === 'createLinearGradient').length;
  };
  const leader = drawRace(race(), 11.2).texts.find((x) => x.text === '90');
  ok('with two colours the leader\'s number is in the second (the accent), the others in the ink', leader && leader.fill.toLowerCase() === PALETTE.accent.toLowerCase()
    && drawRace(race(), 11.2).texts.filter((x) => x.text === '5').every((x) => x.fill.toLowerCase() !== PALETTE.accent.toLowerCase()), leader);
  ok('...and every bar is drawn once a frame', fills(6) === 4, fills(6));
  const en = drawRace(race(), 11.2);
  const ar = drawRace(race(), 11.2, { lang: 'ar' });
  const le = en.texts.find((x) => x.text === 'C');
  const la = ar.texts.find((x) => x.text === 'C');
  ok('in Arabic the bars grow from the right: the names on the right, mirrored', le.x < 0 && la.x > 0 && Math.abs(le.x + la.x) < 1e-6, [le.x, la.x]);
  ok('...and the values in Arabic-Indic digits', ar.texts.some((x) => x.text === '٩٠'), ar.texts.map((x) => x.text));
  const same = J(drawRace(race(), 6.3).calls) === J(drawRace(race(), 6.3).calls);
  ok('the same moment twice is the same calls', same);
  const plain = drawRace(race({ chart: 'hbars' }), 11).texts.map((x) => x.text);
  ok('any other chart shows the race\'s names alone, and its final values', ['A', 'B', 'C', 'D'].every((n) => plain.includes(n)) && !plain.some((x) => x.includes('|')) && plain.includes('90'), plain);
  const short = race({ start: 0, end: 1, in: grow({ d: 0.6 }), out: grow({ d: 0.6 }) });
  const sw = raceWindow(short);
  ok('a race too short to run is still a window (from = to) and still clean', sw.to >= sw.from && Number.isFinite(sw.from) && !drawRace(short, 0.5).problems.length, sw);
  const odd = raceWindow(blankLayer('chart', { chart: 'race', data: [], in: undefined, out: undefined }));
  ok('...and a race with no data or no animation has a finite window', Number.isFinite(odd.from) && Number.isFinite(odd.to), odd);
}

// ── the templates ─────────────────────────────────────────────────────────
console.log('templates');
const IDS = [...PRO_B_IDS];
ok('seven templates, each with metadata and a recipe, among RECIPE_IDS, none an original id',
  IDS.length === 7 && IDS.every((id) => PRO_B_META[id] && PRO_B_RECIPES[id] && RECIPES[id] && J(META[id]) === J(PRO_B_META[id]) && RECIPE_IDS.includes(id) && !CORE_RECIPE_IDS.includes(id))
  && J(Object.keys(PRO_B_RECIPES).sort()) === J([...IDS].sort()) && J(Object.keys(PRO_B_META).sort()) === J([...IDS].sort()), IDS);
{
  const bad = [];
  for (const id of IDS) {
    const m = PRO_B_META[id];
    if (m.id !== id) bad.push(`${id}: id`);
    if (!RECIPE_GROUPS.includes(m.group) || !PALETTE_IDS.includes(m.palette)) bad.push(`${id}: group or palette`);
    if (!(m.seconds >= 4 && m.seconds <= 12)) bad.push(`${id}: ${m.seconds} s`);
    if (!m.fields.length || m.fields.length > 4) bad.push(`${id}: ${m.fields.length} fields`);
    if (new Set(m.fields.map((f) => f.key)).size !== m.fields.length) bad.push(`${id}: duplicate field`);
    for (const f of m.fields) if (!f.label || !f.hint || !(f.max > 0) || !['line', 'text', 'list', 'number', 'choice'].includes(f.kind)) bad.push(`${id}.${f.key}`);
    if (!Array.isArray(m.tags) || m.tags.length < 5 || m.tags.some((t) => t !== t.toLowerCase())) bad.push(`${id}: tags`);
    for (const k of ['useWhen', 'avoidWhen', 'about']) if (typeof m[k] !== 'string' || !/^[A-Z].*\.$/.test(m[k]) || m[k].length > 220 || (m[k].match(/\. /g) ?? []).length) bad.push(`${id}: ${k} is not one sentence`);
    if (!(m.pairsWith ?? []).length || m.pairsWith.some((p) => !RECIPE_IDS.includes(p) || p === id)) bad.push(`${id}: pairsWith`);
    if (m.overlay !== (id === 'film-look')) bad.push(`${id}: overlay`);
  }
  ok('metadata: a group and palette, 4 to 12 s, one to four fields with labels and hints, tags, one-sentence useWhen/avoidWhen, pairs that exist', bad.length === 0, bad);
}
{
  const bad = [];
  for (const id of IDS) {
    const r = PRO_B_RECIPES[id];
    for (const lang of LANGS) {
      for (const f of PRO_B_META[id].fields) {
        const v = r.sample[lang]?.[f.key];
        if (typeof v !== 'string' || !v.trim()) { bad.push(`${id} ${lang}.${f.key} empty`); continue; }
        if (f.kind === 'list' ? v.split('\n').length > f.max : Array.from(v).length > f.max) bad.push(`${id} ${lang}.${f.key} too long`);
        if (/[٠-٩۰-۹]/.test(v)) bad.push(`${id} ${lang}.${f.key} has Arabic-Indic digits`);
      }
      if (lang !== 'en' && !Object.values(r.sample[lang]).some((v) => /[؀-ۿ]/.test(v))) bad.push(`${id} ${lang} is not in Arabic script`);
    }
  }
  ok('every field has a sample in all four languages, within its limit, in plain digits, the others in Arabic script', bad.length === 0, bad);
  ok('Sorani samples use Sorani letters, Badini the northern ones', /[ڕڵۆێە]/.test(Object.values(PRO_B_RECIPES['bar-race'].sample.ckb).join(' '))
    && /ڤ/.test(Object.values(PRO_B_RECIPES['film-look'].sample.kmr).join(' ')));
}

const build = (recipe, lang, format, more = {}) => buildMotion({ id: 'x', recipe, lang, format, now: 0, ...more });
function frameProblems(doc, t, scale = 8) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w / scale, h / scale);
  paint(c.ctx, doc, t, { strict: true });
  return { problems: c.check(), drew: drewSomething(c.calls) };
}
/** Text and counter boxes at rest that reach outside the frame. */
function outside(doc) {
  const [w, h] = SIZES[doc.format];
  const c = makeCanvas(w, h);
  const out = [];
  for (const l of doc.layers) {
    if (l.kind !== 'text' && l.kind !== 'counter') continue;
    const t = Math.min(inDone(l, unitsOf(l)) + 0.01, l.end - 0.01);
    const b = layerBox(makeEnv(c.ctx, doc, t, w, h), { ...l, rot: 0, loop: undefined });
    if (b && (b.x < -0.5 || b.y < -0.5 || b.x + b.w > w + 0.5 || b.y + b.h > h + 0.5)) out.push(`${doc.recipe.id} ${doc.format} ${doc.lang}: ${l.id} ${Math.round(b.x)}..${Math.round(b.x + b.w)} x ${Math.round(b.y)}..${Math.round(b.y + b.h)}`);
  }
  return out;
}
{
  const bad = [];
  let builds = 0;
  // The representative default: wide and tall, English and a right-to-left language that turns with the template,
  // at the template's own length and at the shortest and the longest. VYLO_FULL=1: every language, shape and length.
  const sweepLangs = (i) => (FULL ? LANGS : ['en', LANGS[1 + (i % 3)]]);
  const sweepFormats = FULL ? FORMATS : ['landscape', 'portrait'];
  const sweepSeconds = FULL ? [undefined, 1, 2, 30] : [undefined, LIMITS.minSeconds, LIMITS.seconds];
  for (const [i, id] of IDS.entries()) for (const lang of sweepLangs(i)) {
    const idsBy = [];
    for (const format of sweepFormats) for (const seconds of sweepSeconds) {
      const doc = build(id, lang, format, { seconds });
      builds++;
      const key = `${id} ${lang} ${format} ${seconds ?? 'own'}`;
      if (J(readMotion(JSON.parse(J(doc)), 0)) !== J(doc)) bad.push(`${key}: not a fixed point of the reader`);
      if (J(build(id, lang, format, { seconds })) !== J(doc)) bad.push(`${key}: not deterministic`);
      if (!doc.layers.length) bad.push(`${key}: no layers`);
      const seen = new Set();
      for (const l of doc.layers) {
        if (seen.has(l.id)) bad.push(`${key}: duplicate id ${l.id}`);
        seen.add(l.id);
        if (!l.id.startsWith(`${id}-`) || !l.name) bad.push(`${key}: ${l.id} id or name`);
        if (!(l.start >= 0 && l.start < l.end && l.end <= doc.seconds + 1e-9)) bad.push(`${key}: ${l.id} lives ${l.start}..${l.end}`);
        const n = unitsOf(l);
        if (l.in && l.out && inDone(l, n) > outStart(l, n) + 1e-6) bad.push(`${key}: ${l.id} leaves before it has arrived`);
      }
      if (seconds === undefined) idsBy.push(doc.layers.map((l) => l.id).sort().join());
      const times = Array.from({ length: 12 }, (_, i) => (doc.seconds * i) / 11);
      for (const t of times) {
        const f = frameProblems(doc, t);
        if (f.problems.length) { bad.push(`${key} @${t.toFixed(2)}: ${f.problems[0]}`); break; }
      }
      if (seconds === undefined && !frameProblems(doc, stillTime(doc.layers, doc.seconds)).drew) bad.push(`${key}: the gallery still is empty`);
    }
    if (new Set(idsBy).size !== 1) bad.push(`${id} ${lang}: layer ids differ between shapes`);
  }
  ok(`${builds} builds (${FULL ? 'every template, language and shape, at its own length, 1, 2 and 30 s' : 'every template, wide and tall, in English and a right-to-left language, at its own length, 1 and 30 s; VYLO_FULL=1 for all 448'}): fixed points, deterministic, ids stable across shapes, every layer inside the graphic and arriving before it leaves, clean frames, a still that is not empty`,
    bad.length === 0, bad.slice(0, 6));
}
{
  // Right to left is the mirror image of left to right, box for box (the same words in both).
  const bad = [];
  for (const id of IDS) for (const format of FORMATS) {
    const fields = PRO_B_RECIPES[id].sample.en;
    const en = build(id, 'en', format, { fields });
    const ar = build(id, 'ar', format, { fields });
    const [w, h] = SIZES[format];
    const c = makeCanvas(w, h);
    if (J(en.layers.map((l) => l.id)) !== J(ar.layers.map((l) => l.id))) { bad.push(`${id} ${format}: different layers`); continue; }
    en.layers.forEach((l, i) => {
      if (l.kind === 'backdrop') return;
      const r = ar.layers[i];
      const t = Math.min(inDone(l, unitsOf(l)) + 0.01, l.end - 0.01);
      const a = layerBox(makeEnv(c.ctx, en, t, w, h), { ...l, loop: undefined });
      const b = layerBox(makeEnv(c.ctx, ar, t, w, h), { ...r, loop: undefined });
      if (!a || !b) return;
      if (Math.abs(a.x - (w - b.x - b.w)) > 0.6 || Math.abs(a.y - b.y) > 0.6 || Math.abs(a.w - b.w) > 0.6) bad.push(`${id} ${format}: ${l.id} ${Math.round(a.x)} vs ${Math.round(w - b.x - b.w)}`);
    });
  }
  ok('every template in Arabic is the mirror image of itself in English, box for box', bad.length === 0, bad.slice(0, 5));
}
{
  // Words that cannot be broken, the longest sensible text, and nothing at all.
  const out = [];
  const bad = [];
  const LONG = {
    en: 'Extraordinary ideas travel further when simple tools let everyone share them',
    ar: 'مدينة جميلة جدا في شمال العراق حيث الجبال العالية والوديان الخضراء والناس',
  };
  for (const id of IDS) for (const format of FORMATS) for (const lang of ['en', 'ar']) {
    const fields = Object.fromEntries(PRO_B_META[id].fields.map((f) => [f.key, f.kind === 'list'
      ? Array.from({ length: f.max }, (_, i) => `${Array.from(LONG[lang]).slice(0, 40).join('')}: ${10 + i}, ${20 + i}, ${30 + i}`).join('\n')
      : Array.from(LONG[lang]).slice(0, f.max).join('')]));
    out.push(...outside(build(id, lang, format, { fields })));
    const empty = build(id, lang, format, { fields: Object.fromEntries(PRO_B_META[id].fields.map((f) => [f.key, ''])) });
    const f = frameProblems(empty, empty.seconds / 2);
    if (f.problems.length) bad.push(`${id} ${format} ${lang} empty: ${f.problems[0]}`);
  }
  ok('the longest text every field takes, in English and Arabic, in every shape: every box inside the frame', out.length === 0, out.slice(0, 4));
  ok('every field empty: still builds and paints clean frames', bad.length === 0, bad.slice(0, 3));
}
{
  // Reading the fields: seeded junk into every field of every template.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ALPHA = ['1', '2', '0', '٣', '۴', ',', '،', ':', ';', '|', '.', '-', '%', '$', ' ', ' ', 'a', 'Z', 'ب', 'ڕ', '\n', '‌', '١٢٬٥٠٠', '1,200', 'e9', '/', '–'];
  const junk = () => Array.from({ length: Math.floor(rnd() * 90) }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join('');
  const bad = [];
  for (let i = 0; i < 300; i++) {
    const id = IDS[i % IDS.length];
    const fields = Object.fromEntries(PRO_B_META[id].fields.map((f) => [f.key, junk()]));
    const lang = LANGS[i % 4];
    const format = FORMATS[(i >> 2) % 4];
    let doc;
    try { doc = build(id, lang, format, { fields }); } catch (e) { bad.push(`${id} threw ${e}`); continue; }
    if (J(readMotion(JSON.parse(J(doc)), 0)) !== J(doc)) bad.push(`${id} ${i}: not a fixed point`);
    for (const l of doc.layers) if (l.kind === 'chart') for (const d of l.data) if (!Number.isFinite(d.value) || Array.from(d.label).length > LIMITS.label) bad.push(`${id} ${i}: datum ${J(d)}`);
    const f = frameProblems(doc, doc.seconds * 0.6);
    if (f.problems.length) bad.push(`${id} ${i}: ${f.problems[0]}`);
  }
  ok('300 builds with junk in every field (digits of three scripts, separators, joiners): no throw, fixed points, finite data, clean frames', bad.length === 0, bad.slice(0, 4));
}

// ── each template's own promises ──────────────────────────────────────────
{
  const doc = build('film-look', 'en', 'landscape');
  const styles = doc.layers.filter((l) => l.kind === 'backdrop').map((l) => l.style);
  ok('film look: transparent, made of a light leak, a vignette and grain (on top), with the caption under the grain',
    doc.backdrop === null && J(styles) === J(['lightleak', 'vignette', 'grain']) && doc.layers[doc.layers.length - 1].style === 'grain' && doc.layers.some((l) => l.id === 'film-look-caption'), styles);
  const bare = build('film-look', 'ar', 'portrait', { fields: { caption: '' } });
  ok('...no caption, no caption layer; the finishes run to the last frame', !bare.layers.some((l) => l.kind === 'text') && bare.layers.every((l) => l.end === bare.seconds && l.start === 0));
  // The caption keeps inside the title-safe area the model is told about: 8.9u from the sides of the wide frame, and
  // above the bottom 30.3u of a portrait one, where a phone app's buttons and caption lie over the video.
  const cap = (format) => build('film-look', 'en', format).layers.find((l) => l.id === 'film-look-caption');
  ok('...the caption sits inside the title-safe area: 8.9u in on the wide frame, above the bottom 30.3u in portrait',
    cap('landscape').x >= 8.9 && cap('portrait').y <= -30.3 && cap('feed').y <= -6.3 && cap('square').y <= -6, [cap('landscape').x, cap('portrait').y]);
}
{
  const doc = build('bar-race', 'en', 'landscape');
  const chart = doc.layers.find((l) => l.kind === 'chart');
  const periods = doc.layers.filter((l) => l.id.startsWith('bar-race-period-'));
  const read = chart.data.map((d) => raceSeries(d.label, d.value));
  ok('bar race: the sample\'s racers go into a race chart and read back as written', chart.chart === 'race' && read[0].name === 'Apples' && J(read[0].series) === J([40, 55, 72, 90, 112, 126]) && chart.unit === 't', read[0]);
  const win = raceWindow(chart);
  const shownAt = (t) => periods.filter((l) => t >= l.start && t < l.end && poseAt(l, t, false).opacity > l.opacity * 0.6).map((l) => l.text);
  const at = (j) => win.from + ((win.to - win.from) * j) / 5;
  ok('...the period shown is the one the bars are at: 2019 at the start, each in turn, 2024 at the end',
    J([0, 1, 2, 3, 4, 5].map((j) => shownAt(at(j)).join())) === J(['2019', '2020', '2021', '2022', '2023', '2024']) && shownAt(doc.seconds - 1).join() === '2024', [0, 1, 2, 3, 4, 5].map((j) => shownAt(at(j))));
  const ar = build('bar-race', 'ar', 'landscape');
  ok('...in Arabic the periods are written in Arabic-Indic digits, as the values are', ar.layers.some((l) => l.text === '٢٠١٩'));
  const typed = build('bar-race', 'en', 'square', { fields: { items: 'North: 1,200, 1,500, 2,100\nSouth: ١٢٠٠، ١٨٠٠، ١٩٠٠\nWest 900 950 1000\nno numbers here', periods: 'Q1 Q2 Q3' } });
  const tr = typed.layers.find((l) => l.kind === 'chart').data.map((d) => raceSeries(d.label, d.value));
  ok('...grouped thousands, Arabic-Indic digits and commas, and a line with no colon all read; a line with no number is skipped; periods split at spaces',
    J(tr.map((r) => [r.name, r.series])) === J([['North', [1200, 1500, 2100]], ['South', [1200, 1800, 1900]], ['West', [900, 950, 1000]]])
    && typed.layers.filter((l) => l.id.startsWith('bar-race-period-')).map((l) => l.text).join() === 'Q1,Q2,Q3', tr);
  // Ten periods of five-digit values: a line (80 characters at most) holds them all, a chart label (40) does not.
  const many = build('bar-race', 'en', 'landscape', { fields: { items: Array.from({ length: 10 }, (_, i) => `R${i}: ${Array.from({ length: 10 }, (_, j) => 10000 + i * 100 + j * 7).join(', ')}`).join('\n'), periods: Array.from({ length: 10 }, (_, j) => `P${j + 1}`).join(', ') } });
  const mc = many.layers.find((l) => l.kind === 'chart');
  const mp = many.layers.filter((l) => l.id.startsWith('bar-race-period-')).map((l) => l.text);
  const kept = raceSeries(mc.data[0].label, mc.data[0].value).series.length;
  ok('...a long race keeps its first and last periods and labels exactly the ones it kept', kept < 10 && mp.length === kept && mp[0] === 'P1' && mp[mp.length - 1] === 'P10' && mc.data.every((d) => Array.from(d.label).length <= LIMITS.label), { kept, mp });
}
{
  const doc = build('timeline', 'en', 'landscape', { fields: { items: '10:30: Doors open\n2019 - Founded\nJust words\n• 2024: Bullet' } });
  const text = (key) => doc.layers.find((l) => l.id === `timeline-${key}`)?.text;
  ok('timeline: a date before ": " (a time keeps its colon), or before " - "; a line with neither is all words; a bullet is not a word',
    text('date-1') === '10:30' && text('event-1') === 'Doors open' && text('date-2') === '2019' && text('event-2') === 'Founded' && !text('date-3') && text('event-3') === 'Just words' && text('date-4') === '2024', doc.layers.map((l) => [l.id, l.text]));
  const glow = doc.layers.find((l) => l.id === 'timeline-glow');
  const dots = doc.layers.filter((l) => l.id.startsWith('timeline-dot-')).map((l) => l.start);
  ok('...the milestones arrive in order as the line reaches them, the last one lit', dots.every((s, i) => !i || s > dots[i - 1]) && glow && glow.start >= dots[dots.length - 2], dots);
  ok('...across on the wide and square frames, down the start side on the tall ones', build('timeline', 'en', 'square').layers.find((l) => l.id === 'timeline-line').w > 40
    && build('timeline', 'en', 'portrait').layers.find((l) => l.id === 'timeline-line').h > 40);
}
{
  // The handle: the divider's line, the wipe's edge and the knob are in one place all the way across.
  const off = [];
  for (const [format, lang] of [['landscape', 'en'], ['landscape', 'ar'], ['square', 'ckb'], ['portrait', 'en']]) {
    const doc = build('compare', lang, format);
    const L = (k) => doc.layers.find((l) => l.id === `compare-${k}`);
    const div = L('divider');
    const panel = L('after-panel');
    const knob = L('knob');
    const rtl = lang !== 'en';
    const stacked = format === 'portrait';
    for (let t = div.start; t <= div.start + div.in.d + 0.2; t += 0.02) {
      const g = poseAt(div, t, rtl).grow;
      const k = poseAt(knob, t, rtl);
      const w = poseAt(panel, t, rtl).reveal;
      // Logical position along the sweep, in u from the card's middle: the line starts at the far edge of the second half.
      const span = stacked ? div.h : div.w;
      const line = span * (1 - g);
      const edge = span * (1 - w);
      if (Math.abs(line - edge) > 1e-6) off.push([format, lang, t.toFixed(2), 'wipe', line, edge]);
      if (k.opacity > 0.02) {
        const at = stacked ? k.dy : (rtl ? -1 : 1) * k.dx;
        if (Math.abs(at - line) > 0.05) off.push([format, lang, t.toFixed(2), 'knob', at, line]);
      }
    }
  }
  ok('before and after: the knob, the divider and the wipe\'s edge move as one, in every direction and in both layouts', off.length === 0, off.slice(0, 4));
}
{
  const fig = (price, lang = 'en') => {
    const doc = build('price-card', lang, 'landscape', { fields: { price } });
    return [doc.layers.find((l) => l.id === 'price-card-price'), doc.layers.find((l) => l.id === 'price-card-period'), doc.layers.find((l) => l.id === 'price-card-price-words')];
  };
  const [a, ap] = fig('$19/month');
  const [b] = fig('19 €');
  const [c2, cp] = fig('١٩$/شهرياً', 'ar');
  const [d, , dw] = fig('Free');
  ok('price card: the price counts up to the person\'s figure, the currency against it and the period after it',
    a.to === 19 && a.prefix === '$' && ap.text === '/month' && b.to === 19 && b.suffix === '€' && c2.to === 19 && cp.text === '/شهرياً', [a?.to, a?.prefix, ap?.text, b?.suffix, c2?.to]);
  ok('...a price with no number is shown as it is', !d && dw.text === 'Free');
  const doc = build('price-card', 'en', 'landscape');
  ok('...three features with a check each, and a button that catches the light once', doc.layers.filter((l) => l.id.startsWith('price-card-feature-')).length === 3
    && doc.layers.filter((l) => l.id.startsWith('price-card-check-')).length === 3 && doc.layers.some((l) => l.id === 'price-card-button-shine' && l.loop?.fx === 'shimmer'));
  // The light rides the button's pop and has crossed it by the still the gallery and a cover show (it used to start
  // after everything had landed, which made it the last arrival, and the cover caught it a third of the way across).
  const lit = [];
  for (const lang of LANGS) for (const format of FORMATS) for (const seconds of [undefined, 2.5, 12, 30]) {
    const d = build('price-card', lang, format, seconds ? { seconds } : {});
    const still = stillTime(d.layers, d.seconds);
    const shine = d.layers.find((l) => l.id === 'price-card-button-shine');
    const button = d.layers.find((l) => l.id === 'price-card-button');
    if (shine && !(shine.end <= still && J(shine.in) === J(button.in) && shine.start === button.start && !shine.out)) lit.push(`${lang}/${format}/${d.seconds}s ${shine.start}-${shine.end} @${still}`);
  }
  ok('...the button\'s light rides its pop and has crossed it by the still, at any length', !lit.length, lit.slice(0, 3));
  // The plan's name reads on its pill (3:1 for bold words this size) in every palette: the accent where it does, the ink
  // where it does not — the card's own palette, royal, measured 3.0 in the app's check with the accent.
  const weak = [];
  for (const palette of PALETTE_IDS) {
    const d = build('price-card', 'en', 'landscape', { palette });
    const p = d.palette;
    const lit2 = mixColors(p.bg, luminance(p.bg) < 0.4 ? '#FFFFFF' : '#000000', luminance(p.bg) < 0.4 ? 0.09 : 0.03);
    const ground = mixColors(lit2, p.accent, 0.18);
    const plan = d.layers.find((l) => l.id === 'price-card-plan');
    const ratio = contrast(p[plan.color], ground);
    if (!(ratio >= 3.2)) weak.push(`${palette}: ${plan.color} ${ratio.toFixed(2)}`);
  }
  ok('...the plan\'s name reads on its pill in every palette', !weak.length, weak);
  ok('...on the card\'s own palette the name is in the ink, on the accent\'s tint', doc.layers.find((l) => l.id === 'price-card-plan').color === 'fg');
}
{
  const doc = build('progress-stats', 'en', 'landscape', { fields: { items: 'Done: 92%\nUsers: 1200\nHalf: 50' } });
  const rings = doc.layers.filter((l) => l.kind === 'chart');
  ok('progress rings: a percentage over a hundred, a plain number filling its ring, the fullest lit in the second accent',
    rings.length === 3 && rings[0].max === 100 && rings[1].max === 0 && rings[2].max === 100 && rings[1].colors[0] === 'accent2' && rings[0].colors[0] === 'accent', rings.map((r) => [r.max, r.colors]));
  const four = build('progress-stats', 'en', 'square').layers.filter((l) => l.kind === 'chart');
  ok('...four rings two by two on the square frame', new Set(four.map((r) => r.x)).size === 2 && new Set(four.map((r) => r.y)).size === 2, four.map((r) => [r.x, r.y]));
}
{
  const doc = build('retro-title', 'en', 'landscape');
  const glows = doc.layers.filter((l) => l.name === 'Title glow');
  ok('retro screen: the title switches on (flip) between two copies in the accents added as light, under scan lines and a vignette',
    doc.layers.find((l) => l.id === 'retro-title-title').in.fx === 'flip' && glows.length === 2 && glows.every((g) => g.blend === 'screen')
    && J(doc.layers.slice(-2).map((l) => l.style)) === J(['scanlines', 'vignette']), doc.layers.map((l) => l.id));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
