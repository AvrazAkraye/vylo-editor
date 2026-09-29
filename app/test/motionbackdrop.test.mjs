// Backdrops and particles: the fields that move under a graphic and over it.
//
// What matters: every style draws, and draws nothing a browser would reject or
// ignore (motioncanvas's check()), at any moment a frame can be asked for —
// before the layer starts, at its start, in its middle, at its end, at a
// negative time — in every shape of frame; the same frame twice is the same
// calls; a backdrop one period later is the same frame to three decimals, so a
// looping export has no seam; a particle's place is a function of the time
// alone, so frames asked for out of order agree with frames asked for in order;
// and the layer's own opacity and blend, which paint set, are respected and
// left as they were.
import { readFileSync } from 'node:fs';
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { drawBackdrop, drawParticles } from '../.test-build/motionbackdrop.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const DARK = { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' };
const LIGHT = { bg: '#F6F4EF', fg: '#14161F', accent: '#2F6BFF', accent2: '#FF5A7A', muted: '#6B7185' };
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080] };

/** A word list from the contract itself, so a style added there and not here fails. */
const listOf = (name) => {
  const src = readFileSync(new URL('../src/motiontypes.ts', import.meta.url), 'utf8');
  const m = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(src);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
};
const BACKDROPS = listOf('BACKDROPS');
const PARTICLES = listOf('PARTICLES');

const docOf = (o = {}) => ({
  id: 'd', title: 't', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6,
  palette: DARK, backdrop: 'bg', layers: [], stage: 'ready', created: 0, updated: 0, ...o,
});
const envOf = (ctx, doc, t, w, h) => ({
  ctx, doc, t, k: Math.min(w, h) / 100, width: w, height: h, rtl: doc.lang !== 'en',
  color: (c) => doc.palette[c] ?? c,
  paint: (p) => (typeof p === 'string' ? doc.palette[p] ?? p : '#FFFFFF'),
});
const POSE = { on: true, presence: 1, opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1 };
const layerBase = { id: 'l', name: 'l', start: 0.5, end: 6, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1 };
const backdrop = (o = {}) => ({ ...layerBase, kind: 'backdrop', style: 'aurora', colors: ['accent', 'accent2'], speed: 1, density: 0.5, seed: 3, ...o });
const particles = (o = {}) => ({
  ...layerBase, kind: 'particles', style: 'confetti', colors: ['accent', 'accent2', 'fg'], count: 90, size: 1.2, speed: 1, spread: 8, burst: true, seed: 5, ...o,
});

/**
 * One layer drawn as paint draws it: saved, at the layer's opacity and blend,
 * the origin at the frame's corner for a backdrop and on the emitter for
 * particles; then the context's state after, to see that it was left alone.
 */
function frame(draw, layer, t, o = {}) {
  const doc = o.doc ?? docOf();
  const [w, h] = o.size ?? SIZES[doc.format] ?? SIZES.landscape;
  const { ctx, calls, check } = makeCanvas(w, h);
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  if (o.blend) ctx.globalCompositeOperation = o.blend;
  if (o.origin) ctx.translate(o.origin[0], o.origin[1]);
  const before = { alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation, m: JSON.stringify(ctx.getTransform()) };
  const from = calls.length;
  draw(envOf(ctx, doc, t, w, h), layer, POSE);
  const mine = calls.slice(from);
  const after = { alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation, m: JSON.stringify(ctx.getTransform()) };
  ctx.restore();
  return { calls: mine, problems: check(), same: JSON.stringify(before) === JSON.stringify(after) };
}
const bd = (layer, t, o = {}) => frame(drawBackdrop, layer, t, o);
const pt = (layer, t, o = {}) => {
  const doc = o.doc ?? docOf();
  const [w, h] = o.size ?? SIZES[doc.format] ?? SIZES.landscape;
  return frame(drawParticles, layer, t, { origin: [w / 2, h / 2], ...o });
};

/** A frame's calls as text, every number to three decimals (in strings too: a colour's alpha). */
const round = (x) => { const r = Math.round(x * 1000) / 1000; return Object.is(r, -0) ? 0 : r; };
const sig = (calls, digits = true) => JSON.stringify(calls.map((c) => [c.name, c.args, c.m, c.alpha]), (_, v) => {
  // A canvas handed to createPattern (the grain's tile) is the same object every frame; its pixels are not the frame.
  if (v && typeof v === 'object' && typeof v.getContext === 'function') return '[canvas]';
  if (!digits) return v;
  if (typeof v === 'number') return round(v);
  if (typeof v === 'string') return v.replace(/-?\d+\.\d+(e-?\d+)?/g, (x) => String(round(parseFloat(x))));
  return v;
});
const draws = (calls) => calls.filter((c) => ['fill', 'stroke', 'fillRect', 'fillText'].includes(c.name)).length;

// ── the vocabulary ────────────────────────────────────────────────────────
ok('the contract lists seven backdrops and five particle styles', BACKDROPS.length === 7 && PARTICLES.length === 5, { BACKDROPS, PARTICLES });

// ── backdrops: clean, in every shape, at every moment ─────────────────────
{
  const times = [-1, 0, 0.49, 0.5, 3.25, 5.99];
  const bad = [];
  const empty = [];
  for (const style of BACKDROPS) {
    for (const format of Object.keys(SIZES)) {
      for (const pal of [DARK, LIGHT]) {
        for (const t of times) {
          const r = bd(backdrop({ style }), t, { doc: docOf({ format, palette: pal }) });
          if (r.problems.length) bad.push([style, format, t, r.problems.slice(0, 3)]);
          if (!drewSomething(r.calls)) empty.push([style, format, t]);
        }
      }
    }
  }
  ok('every backdrop, every shape, dark and light, at -1, 0, before start, start, middle and end: nothing a browser rejects', bad.length === 0, bad.slice(0, 4));
  ok('every backdrop draws something at every one of those moments', empty.length === 0, empty.slice(0, 4));
}
{
  const bad = [];
  for (const style of BACKDROPS) {
    for (const density of [0, 1]) {
      for (const speed of [0, 0.4, 3]) {
        const r = bd(backdrop({ style, density, speed, seed: 99 }), 2.2);
        if (r.problems.length || !drewSomething(r.calls)) bad.push([style, density, speed, r.problems.slice(0, 2)]);
      }
    }
  }
  ok('the ends of density and speed are clean too', bad.length === 0, bad.slice(0, 4));
}
{
  const nonsense = [
    backdrop({ style: 'plasma' }),
    backdrop({ speed: NaN, density: Infinity, seed: NaN }),
    backdrop({ colors: [] }),
    backdrop({ colors: ['', 'accent'] }),
    backdrop({ start: NaN }),
  ];
  const results = nonsense.map((l) => bd(l, 1.5));
  ok('an unknown style, non-numbers and no colours still draw, cleanly', results.every((r) => !r.problems.length && drewSomething(r.calls)),
    results.map((r) => r.problems.slice(0, 2)));
  const short = bd(backdrop(), 1, { doc: docOf({ seconds: 0 }) });
  const broken = bd(backdrop(), NaN, { doc: docOf({ seconds: NaN }) });
  ok('a graphic with no length, or a time that is not a number, is still clean', !short.problems.length && !broken.problems.length && drewSomething(short.calls),
    [short.problems, broken.problems]);
  const none = bd(backdrop(), 1, { size: [0, 0] });
  ok('a frame of no size draws nothing and complains of nothing', !drewSomething(none.calls) && !none.problems.length, none.problems);
}

// ── backdrops: pure, moving, and looping ──────────────────────────────────
{
  const same = BACKDROPS.filter((style) => sig(bd(backdrop({ style }), 2.3).calls, false) === sig(bd(backdrop({ style }), 2.3).calls, false));
  ok('the same moment twice is the same calls, exactly', same.length === BACKDROPS.length, BACKDROPS.filter((s) => !same.includes(s)));
  const moving = BACKDROPS.filter((style) => sig(bd(backdrop({ style }), 1.2).calls) !== sig(bd(backdrop({ style }), 1.9).calls));
  ok('every backdrop moves', moving.length === BACKDROPS.length, BACKDROPS.filter((s) => !moving.includes(s)));
  const still = BACKDROPS.filter((style) => sig(bd(backdrop({ style, speed: 0 }), 1.2).calls) === sig(bd(backdrop({ style, speed: 0 }), 4.7).calls));
  ok('speed 0 holds every backdrop still', still.length === BACKDROPS.length, BACKDROPS.filter((s) => !still.includes(s)));
}
{
  // Period = the graphic's length over speed rounded (at least one cycle).
  const cases = [[1, 6], [2, 3], [3, 2], [0.4, 6], [1.6, 3]];
  const seams = [];
  for (const style of BACKDROPS) {
    for (const [speed, period] of cases) {
      for (const t of [1.37, 2.9]) {
        const a = sig(bd(backdrop({ style, speed }), t).calls);
        const b = sig(bd(backdrop({ style, speed }), t + period).calls);
        if (a !== b) seams.push([style, speed, t]);
      }
    }
    for (const format of ['portrait', 'square']) {
      const doc = docOf({ format, seconds: 7.5 });
      const a = sig(bd(backdrop({ style, speed: 2 }), 1.1, { doc }).calls);
      const b = sig(bd(backdrop({ style, speed: 2 }), 1.1 + 3.75, { doc }).calls);
      if (a !== b) seams.push([style, format]);
    }
  }
  ok('every backdrop one period later is the same frame, to three decimals: a loop has no seam', seams.length === 0, seams.slice(0, 5));
  const mid = BACKDROPS.filter((style) => sig(bd(backdrop({ style, speed: 1 }), 2).calls) !== sig(bd(backdrop({ style, speed: 1 }), 2 + 3).calls));
  ok('and half a period later it is not (the period is not shorter than it should be)', mid.length === BACKDROPS.length, BACKDROPS.filter((s) => !mid.includes(s)));
}

// ── backdrops: the layer's opacity and blend ──────────────────────────────
{
  const over = [];
  const changed = [];
  for (const style of BACKDROPS) {
    const r = bd(backdrop({ style }), 2, { alpha: 0.4 });
    if (r.calls.some((c) => c.alpha > 0.4 + 1e-9)) over.push(style);
    if (!r.same) changed.push(style);
  }
  ok('nothing is drawn above the layer\'s opacity', over.length === 0, over);
  ok('opacity, blend and transform are as paint left them afterwards', changed.length === 0, changed);
  const ops = (r) => new Set(r.calls.filter((c) => c.name === 'globalCompositeOperation').map((c) => c.args[0]));
  const darkAurora = bd(backdrop({ style: 'aurora' }), 2);
  const lightAurora = bd(backdrop({ style: 'aurora' }), 2, { doc: docOf({ palette: LIGHT }) });
  const blended = bd(backdrop({ style: 'aurora' }), 2, { blend: 'multiply' });
  ok('the aurora adds light (screen) on a dark ground, and only tints a light one',
    ops(darkAurora).has('screen') && !ops(lightAurora).has('screen'), [[...ops(darkAurora)], [...ops(lightAurora)]]);
  ok('a layer with a blend of its own keeps it', !ops(blended).has('screen'), [...ops(blended)]);
  // The grain that dithers the soft styles must never paint where nothing is, or a transparent graphic turns opaque.
  const grained = BACKDROPS.filter((style) => bd(backdrop({ style }), 2).calls.some((c) => c.name === 'createPattern'));
  const atop = grained.every((style) => {
    const calls = bd(backdrop({ style }), 2).calls;
    const at = calls.findIndex((c) => c.name === 'createPattern');
    const fill = calls.findIndex((c, i) => i > at && c.name === 'fillRect');
    return calls.slice(at, fill).some((c) => c.name === 'globalCompositeOperation' && c.args[0] === 'source-atop');
  });
  ok('the soft styles are dithered by a grain laid only over paint already there (source-atop)',
    grained.length >= 5 && !grained.includes('grid') && atop, grained);
}

// ── backdrops: density and area ───────────────────────────────────────────
{
  const moves = (r) => r.calls.filter((c) => c.name === 'moveTo').length;
  ok('a denser grid has more lines', moves(bd(backdrop({ style: 'grid', density: 1 }), 2)) > moves(bd(backdrop({ style: 'grid', density: 0 }), 2)) * 1.8);
  const discs = (r) => r.calls.filter((c) => c.name === 'arc').length;
  const wide = discs(bd(backdrop({ style: 'bokeh', density: 1 }), 2));
  const square = discs(bd(backdrop({ style: 'bokeh', density: 1 }), 2, { doc: docOf({ format: 'square' }) }));
  ok('a square frame has fewer bokeh discs than a wide one: count follows area', square < wide && square > 0, { wide, square });
  const waves = (d) => bd(backdrop({ style: 'waves', density: d }), 2).calls.filter((c) => c.name === 'closePath').length;
  ok('waves: three at the least density, five at the most', waves(0) === 3 && waves(1) === 5, [waves(0), waves(1)]);
}

// ── particles: clean, in every mode, at every moment ──────────────────────
{
  const bad = [];
  const empty = [];
  for (const style of PARTICLES) {
    for (const burst of [true, false]) {
      for (const spread of [0, 8]) {
        for (const format of Object.keys(SIZES)) {
          for (const t of [-1, 0, 0.49, 0.5, 0.8, 3.25, 5.99]) {
            const r = pt(particles({ style, burst, spread }), t, { doc: docOf({ format }) });
            if (r.problems.length) bad.push([style, burst, spread, format, t, r.problems.slice(0, 3)]);
          }
          const shown = burst ? [0.8] : [-1, 0.5, 3.25, 5.99];
          for (const t of shown) if (!drewSomething(pt(particles({ style, burst, spread }), t, { doc: docOf({ format }) }).calls)) empty.push([style, burst, spread, format, t]);
        }
      }
    }
  }
  ok('every particle style, burst and stream, from a point and over the frame, in every shape and at every moment: clean', bad.length === 0, bad.slice(0, 4));
  ok('a burst shows just after it starts; a stream shows at every moment, before its start included', empty.length === 0, empty.slice(0, 4));
}
{
  const before = PARTICLES.filter((style) => !drewSomething(pt(particles({ style, burst: true }), 0.49).calls) && !drewSomething(pt(particles({ style, burst: true }), -2).calls));
  ok('a burst draws nothing before its start', before.length === PARTICLES.length, PARTICLES.filter((s) => !before.includes(s)));
  const gone = PARTICLES.filter((style) => !drewSomething(pt(particles({ style, burst: true }), 0.5 + 12).calls));
  ok('and nothing once every particle has lived its life', gone.length === PARTICLES.length, PARTICLES.filter((s) => !gone.includes(s)));
  const nonsense = [
    particles({ style: 'glitter' }), particles({ count: NaN, size: -3, speed: Infinity, spread: NaN, seed: NaN }),
    particles({ colors: [] }), particles({ count: 5000 }), particles({ size: 0 }),
  ];
  const results = nonsense.map((l) => pt(l, 0.9));
  ok('nonsense in a particle layer still draws, cleanly', results.every((r) => !r.problems.length && drewSomething(r.calls)), results.map((r) => r.problems.slice(0, 2)));
  ok('no particles, nothing drawn', !drewSomething(pt(particles({ count: 0 }), 1).calls));
  const many = pt(particles({ style: 'snow', count: 5000, burst: false }), 1).calls.filter((c) => c.name === 'drawImage' || c.name === 'arc').length;
  ok('a count past the ceiling is held to 300', many > 0 && many <= 300, many);
}

// ── particles: a function of time ─────────────────────────────────────────
{
  const impure = [];
  for (const style of PARTICLES) {
    for (const burst of [true, false]) {
      for (const spread of [0, 8]) {
        const layer = particles({ style, burst, spread });
        const a = sig(pt(layer, 2).calls, false);
        pt(layer, 1);
        const b = sig(pt(layer, 2).calls, false);
        if (a !== b) impure.push([style, burst, spread]);
      }
    }
  }
  ok('the frame at 2 s is the same drawn before or after the frame at 1 s', impure.length === 0, impure);
  const seeds = PARTICLES.filter((style) => sig(pt(particles({ style, burst: false, seed: 1 }), 2).calls) !== sig(pt(particles({ style, burst: false, seed: 2 }), 2).calls));
  ok('another seed is another field', seeds.length === PARTICLES.length);
  const seams = [];
  for (const style of PARTICLES) {
    for (const spread of [0, 8]) {
      for (const speed of [1, 2.3]) {
        const layer = particles({ style, burst: false, spread, speed });
        if (sig(pt(layer, 1.3).calls) !== sig(pt(layer, 1.3 + 6).calls)) seams.push([style, spread, speed]);
      }
    }
  }
  ok('a stream is the same one graphic-length later: a looping export has no seam', seams.length === 0, seams);
  const still = PARTICLES.filter((style) => [true, false].every((burst) => {
    const layer = particles({ style, burst, speed: 0 });
    return drewSomething(pt(layer, 1).calls) && sig(pt(layer, 1).calls) === sig(pt(layer, 4).calls);
  }));
  ok('speed 0 is a still of the field, burst and stream', still.length === PARTICLES.length, PARTICLES.filter((s) => !still.includes(s)));
}

// ── particles: where they are ─────────────────────────────────────────────
{
  // Device positions of what was drawn: a piece's transform, an arc's centre or a soft disc's middle through its transform.
  const at = (c, x, y) => [c.m[0] * x + c.m[2] * y + c.m[4], c.m[1] * x + c.m[3] * y + c.m[5]];
  const where = (calls) => calls.filter((c) => ['fillRect', 'arc', 'drawImage'].includes(c.name)).map((c) => (c.name === 'arc'
    ? at(c, c.args[0], c.args[1])
    : c.name === 'drawImage' ? at(c, c.args[1] + c.args[3] / 2, c.args[2] + c.args[4] / 2)
    : [c.m[4], c.m[5]]));
  const mean = (pts, f) => pts.reduce((s, p) => s + f(p), 0) / Math.max(1, pts.length);
  const out = (t) => mean(where(pt(particles({ style: 'confetti', spread: 4 }), t).calls), ([x, y]) => Math.hypot(x - 960, y - 540));
  ok('a burst leaves the emitter: further out 0.6 s after it than 0.1 s after', out(1.1) > out(0.6) * 2, [out(0.6), out(1.1)]);
  const early = where(pt(particles({ style: 'stars', spread: 6 }), 0.52).calls);
  ok('...and starts inside its spread', early.length > 0 && early.every(([x, y]) => Math.hypot(x - 960, y - 540) < 6 * 10.8 + 30), early.length);
  const y = (style, t) => mean(where(pt(particles({ style, spread: 0, count: 60 }), t).calls), (p) => p[1]);
  ok('confetti over the whole frame falls', y('confetti', 2.5) > y('confetti', 1.5) + 50, [y('confetti', 1.5), y('confetti', 2.5)]);
  ok('bubbles over the whole frame rise', y('bubbles', 3.5) < y('bubbles', 2.5) - 20, [y('bubbles', 2.5), y('bubbles', 3.5)]);
  const field = where(pt(particles({ style: 'snow', spread: 0, burst: false, count: 200 }), 2).calls);
  const xs = field.map((p) => p[0]);
  const ys = field.map((p) => p[1]);
  ok('snow with no spread covers the whole frame, wherever the emitter is',
    Math.min(...xs) < 192 && Math.max(...xs) > 1728 && Math.min(...ys) < 108 && Math.max(...ys) > 972, [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]);
  const corner = where(pt(particles({ style: 'snow', spread: 0, burst: false, count: 200 }), 2, { origin: [100, 1000] }).calls);
  const cx = corner.map((p) => p[0]);
  ok('...the emitter in a corner included', Math.min(...cx) < 192 && Math.max(...cx) > 1728, [Math.min(...cx), Math.max(...cx)]);
}
{
  const over = [];
  for (const style of PARTICLES) {
    const r = pt(particles({ style }), 0.8, { alpha: 0.3 });
    if (r.calls.some((c) => c.alpha > 0.3 + 1e-9)) over.push(style);
    if (!r.same) over.push(`${style} changed the state`);
  }
  ok('particles stay under the layer\'s opacity and leave the state as they found it', over.length === 0, over);
  const lit = pt(particles({ style: 'sparks' }), 0.8).calls.some((c) => c.name === 'globalCompositeOperation' && c.args[0] === 'lighter');
  const kept = pt(particles({ style: 'sparks' }), 0.8, { blend: 'multiply' }).calls.some((c) => c.name === 'globalCompositeOperation' && c.args[0] === 'lighter');
  ok('sparks add light on a dark ground, unless the layer has a blend of its own', lit && !kept);
  const flakes = pt(particles({ style: 'snow', burst: false, count: 300 }), 2).calls;
  ok('a soft particle is one picture copied, not a gradient filled', draws(flakes) === 0 && flakes.filter((c) => c.name === 'drawImage').length > 200
    && !flakes.some((c) => c.name === 'createRadialGradient'), flakes.filter((c) => c.name === 'drawImage').length);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
