// Fix package F3 of the Pro pass (performance; docs/pro/f3-perf.md): what R4 found slow, held fast.
//
// What matters, in order:
//
//   1. The sound bed shares the thread. `renderSoundBed` gives the thread back about every 8 ms, so a bed
//      rendered while the graphic plays no longer stops the preview. Measured here beside a 4 ms ticker: in
//      Node this measures the event loop, which is the same thread the page's frames would need; the frame
//      gaps themselves were measured in the app's own WebKit (the document above). A stopped render stops
//      at its next break.
//   2. It is the same sound, byte for byte. Six beds — effects, music, both, three rates and lengths, a
//      level that makes the limiter and the ceiling work — are pinned by digest, taken with the renderer as
//      it was before F3. Rendered two at a time they are still the same.
//   3. Moving the level does not compose the music again (the composer holds the thread for a good part of
//      its own work): the music is kept by everything its score is made from, and a bed made from the kept
//      music is the bed made without it.
//   4. The true peak, read a block at a time, is the meter's: `intervalPeaks` agrees with `truePeakOf` to a
//      32-bit float, and a block read with 16 samples either side gives the whole channel's points.
//   5. No transition draws a picture through `destination-in`, `source-in`, `source-out` or
//      `destination-atop`: WebKit draws an image with those through a whole-canvas buffer in the web
//      process, which is what took a glitch from 110 to 250 MB (2.5 GB painted back to back). The glitch
//      still deals its slices and splits its colours.
import { makeCanvas, FakeOffscreenCanvas } from './motioncanvas.mjs';
import { renderSoundBed } from '../.test-build/motionsound.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { intervalPeaks, truePeakOf } from '../.test-build/audiocore.js';
import { composite, TRANSITIONS } from '../.test-build/motiontransition.js';
import { createHash } from 'node:crypto';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const info = (s) => console.log(`  info  ${s}`);

// ── the stand-ins (Node has no Web Audio) and the pinned beds ─────────────

const mtof = (p) => 440 * Math.pow(2, (p - 69) / 12);
let composed = 0;
/** Plain sines for the notes, giving the thread back every few milliseconds as the real composer awaits its renders. */
async function standIn(score, rate) {
  composed++;
  const n = Math.max(1, Math.round(score.seconds * rate));
  const L = new Float32Array(n), R = new Float32Array(n);
  let since = performance.now();
  for (const note of score.notes) {
    if (performance.now() - since > 4) { await new Promise((r) => setImmediate(r)); since = performance.now(); }
    const f = Math.min(5000, Math.max(40, mtof(note.p)));
    const from = Math.round(note.t * rate);
    const len = Math.min(n - from, Math.round(Math.min(note.d, 0.6) * rate));
    const w = (2 * Math.PI * f) / rate;
    for (let i = 0; i < len; i++) {
      const s = Math.sin(w * i) * Math.min(1, i / (0.005 * rate)) * Math.exp(-i / (0.3 * rate)) * note.v * 0.05;
      L[from + i] += s;
      R[from + i] += s * 0.9;
    }
  }
  return [L, R];
}
/** Loud, bright and wide: a full-scale shaped 9 kHz tone, so the limiter and the ceiling have work to do. */
async function loud(score, rate) {
  const n = Math.max(1, Math.round(score.seconds * rate));
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(4 * Math.sin((2 * Math.PI * 9000 * i) / rate)) * 0.9;
    L[i] = v;
    R[i] = -v * 0.97;
  }
  return [L, R];
}
const digest = (bed) => (bed ? createHash('sha256').update(Buffer.from(bed.channels[0].buffer)).update(Buffer.from(bed.channels[1].buffer)).digest('hex').slice(0, 24) : 'none');
const doc = (recipe, seconds, sound, more = {}) => {
  const d = buildMotion({ id: more.id ?? `perf-${recipe}`, recipe, lang: more.lang ?? 'en', format: more.format ?? 'landscape', now: 1, seconds });
  d.sound = sound;
  return d;
};
/** Taken with the renderer before F3 (the same documents and stand-ins); graphics without scenes, whose cues F3 does not touch. */
const PINNED = [
  ['effects, steps, 10 s', () => doc('steps', 10, { mode: 'fx', level: 0.6, seed: 77 }), {}, '9083fcb7619684f7768f02ed'],
  ['effects, stats, 30 s, level 1', () => doc('stats', 30, { mode: 'fx', level: 1, seed: 5 }), {}, 'effb2fbe838fe26b9baba031'],
  ['effects, lower third, Arabic, portrait, 44.1 kHz', () => doc('lower-third', 8, { mode: 'fx', level: 0.45 }, { lang: 'ar', format: 'portrait' }), { sampleRate: 44100 }, 'b62baae2cf2950692529b80f'],
  ['both, stats, 10 s', () => doc('stats', 10, { mode: 'both', level: 0.6, seed: 4 }), { music: standIn }, '276829ec7eee2383a665e6fa'],
  ['music, big title, 6 s, level 0.3', () => doc('big-title', 6, { mode: 'music', level: 0.3, seed: 9 }), { music: standIn }, 'df919dc253afb8cc4fff36a5'],
  ['both, bar chart, 12 s, loud music, level 1', () => doc('bar-chart', 12, { mode: 'both', level: 1, seed: 3 }), { music: loud }, '1f3ab42491e9c5c0ad89ad07'],
];

// ── 1. sharing the thread ─────────────────────────────────────────────────
console.log('the sound bed shares the thread');

/** Render beside a 4 ms ticker: the time it took, and the longest the ticker waited between two ticks. */
async function beside(d, o) {
  let last = performance.now();
  let longest = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 4);
  const t0 = performance.now();
  const bed = await renderSoundBed(d, o);
  const ms = performance.now() - t0;
  longest = Math.max(longest, performance.now() - last);
  clearInterval(timer);
  return { bed, ms, longest };
}
{
  // Warm the code first (a first call runs before the engine has compiled it), on beds of their own.
  await renderSoundBed(doc('steps', 2, { mode: 'fx', level: 0.6, seed: 1 }));
  await renderSoundBed(doc('stats', 2, { mode: 'music', level: 0.6, seed: 1 }), { music: standIn });
  // A fresh seed each try, so nothing is served from what was kept; the best of three, so a pause of the
  // machine's own (another process, a collection) is not counted against the render.
  const LIMIT = 30;
  for (const [name, make, o] of [
    ['a 10 s effects bed (steps)', (k) => doc('steps', 10, { mode: 'fx', level: 0.6, seed: 1000 + k }), {}],
    ['a 10 s music bed (stats, the stand-in composer)', (k) => doc('stats', 10, { mode: 'music', level: 0.6, seed: 2000 + k }), { music: standIn }],
  ]) {
    const runs = [];
    for (let k = 0; k < 3; k++) {
      const r = await beside(make(k), o);
      runs.push(r);
      if (r.longest < LIMIT) break;
    }
    const best = runs.reduce((a, b) => (b.longest < a.longest ? b : a));
    info(`${name}: ${runs.map((r) => `rendered in ${r.ms.toFixed(0)} ms, longest wait ${r.longest.toFixed(1)} ms`).join('; ')} (Node's event loop; the app's frames are measured in WebKit, docs/pro/f3-perf.md)`);
    ok(`${name}: the 4 ms ticker never waits ${LIMIT} ms or more (longest ${best.longest.toFixed(1)} ms)`, best.bed && best.longest < LIMIT, runs.map((r) => r.longest));
  }
}
{
  // Stopped part-way: it stops at the next break, not at the end. (An effects bed, so what is stopped is this
  // file's own work: the stand-in composer, unlike the real one, does not look at the signal.)
  const ctl = new AbortController();
  let stoppedAt = 0;
  const t0 = performance.now();
  const run = renderSoundBed(PINNED[1][1](), { signal: ctl.signal }).then(
    () => 'finished',
    (e) => { stoppedAt = performance.now(); return e?.name; },
  );
  setTimeout(() => ctl.abort(), 40);
  const how = await run;
  const after = stoppedAt - t0 - 40;
  ok(`stopped 40 ms into a 30 s bed, it stops at its next break (${after.toFixed(1)} ms after the stop)`, how === 'AbortError' && after < 40, { how, after });
  const again = await renderSoundBed(PINNED[1][1](), {});
  ok('and the same bed rendered again is whole: nothing of the stopped one was kept', digest(again) === PINNED[1][3], digest(again));
}

// ── 2. the same bytes ─────────────────────────────────────────────────────
console.log('the same bytes');
{
  const got = [];
  for (const [name, make, o, want] of PINNED) {
    const bed = await renderSoundBed(make(), o);
    got.push([name, digest(bed), want]);
  }
  const wrong = got.filter(([, d, w]) => d !== w);
  ok(`${PINNED.length} beds (effects, music, both; 44.1 and 48 kHz; 6 to 30 s; levels 0.3 to 1, the ceiling working) are byte for byte the renderer's before F3`, wrong.length === 0, wrong);
  // Two at a time: renders that share the thread share the kept effects and music, and that changes nothing.
  const pair = await Promise.all([
    renderSoundBed(doc('steps', 10, { mode: 'fx', level: 0.6, seed: 77 }), {}),
    renderSoundBed(doc('stats', 10, { mode: 'both', level: 0.6, seed: 4 }), { music: (s, r) => standIn(s, r) }),
    renderSoundBed(doc('bar-chart', 12, { mode: 'both', level: 1, seed: 3 }), { music: (s, r) => loud(s, r) }),
  ]);
  ok('three rendered at once are each the same bed as alone', digest(pair[0]) === PINNED[0][3] && digest(pair[1]) === PINNED[3][3] && digest(pair[2]) === PINNED[5][3], pair.map(digest));
}

// ── 3. the level moves, the music stays ───────────────────────────────────
console.log('the music is kept');
{
  const make = (level, mood) => doc('stats', 10, { mode: 'both', level, seed: 6, ...(mood ? { mood } : {}) }, { id: 'perf-kept' });
  composed = 0;
  await renderSoundBed(make(0.6), { music: standIn });
  const first = composed;
  const moved = await renderSoundBed(make(0.35), { music: standIn });
  const kept = composed - first;
  // The same bed without the kept music: another renderer (the same notes) is not served the kept piece.
  const fresh = await renderSoundBed(make(0.35), { music: (s, r) => standIn(s, r) });
  ok('moving the level renders the bed again but does not compose the music again', first === 1 && kept === 0, { first, kept });
  ok('...and the bed made from the kept music is the one made without it', digest(moved) === digest(fresh) && digest(moved) !== 'none', [digest(moved), digest(fresh)]);
  composed = 0;
  await renderSoundBed(make(0.35, 'calm'), { music: standIn });
  ok('another mood is composed', composed === 1, composed);
}

// ── 4. the true peak, a block at a time ───────────────────────────────────
console.log('the true peak');
{
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
  const signals = {
    'full-scale noise': Float32Array.from({ length: 48000 }, () => rnd() * 2 - 1),
    'an 18 kHz tone between its samples': Float32Array.from({ length: 48000 }, (_, i) => 0.9 * Math.sin((2 * Math.PI * 18000 * i) / 48000 + 0.7)),
    'clicks in silence': Float32Array.from({ length: 30000 }, (_, i) => (i % 997 === 0 ? (i % 2 ? 1 : -1) : 0)),
    'a rendered bed': null,
  };
  const bed = await renderSoundBed(doc('bar-chart', 12, { mode: 'both', level: 1, seed: 3 }), { music: loud });
  signals['a rendered bed'] = bed.channels[0];
  const bad = [];
  for (const [name, x] of Object.entries(signals)) {
    const all = intervalPeaks(x);
    let most = 0;
    for (const v of all) if (v > most) most = v;
    if (most !== Math.fround(truePeakOf([x]))) bad.push(`${name}: ${most} vs ${truePeakOf([x])}`);
    // A block read with 16 samples either side: its points are the whole channel's.
    for (let k = 0; k < 20; k++) {
      const from = 16 + Math.floor(rnd() * (x.length - 5000));
      const to = from + 1 + Math.floor(rnd() * 4000);
      const part = intervalPeaks(x.subarray(from - 16, Math.min(x.length, to + 16)));
      for (let i = from; i < to; i++) if (part[i - from + 16] !== all[i]) { bad.push(`${name}: point ${i} of a block differs`); break; }
    }
  }
  ok('the points intervalPeaks reads are truePeakOf\'s (to a 32-bit float), and a block read with 16 samples either side gives the whole channel\'s', bad.length === 0, bad.slice(0, 3));
}

// ── 5. transitions and full-canvas compositing ────────────────────────────
console.log('transitions');
const FULL_CANVAS = new Set(['destination-in', 'source-in', 'source-out', 'destination-atop']);
/** Each `drawImage` in `calls` with the composite operation it was drawn under (save and restore followed). */
function drawsWithOp(calls) {
  const out = [];
  let op = 'source-over';
  const stack = [];
  for (const c of calls) {
    if (c.name === 'save') stack.push(op);
    else if (c.name === 'restore') op = stack.pop() ?? 'source-over';
    else if (c.name === 'globalCompositeOperation' && c.set) op = c.args[0];
    else if (c.name === 'drawImage') out.push({ op, c });
  }
  return out;
}
{
  const W = 640, H = 360;
  const pic = () => { const canvas = new FakeOffscreenCanvas(W, H); return { canvas, ctx: canvas.getContext('2d') }; };
  const bad = [];
  let glitchFrames = 0, knocked = 0, split = 0, tintedRight = 0, draws = 0;
  for (const kind of TRANSITIONS) {
    for (let i = 0; i <= 40; i++) {
      const A = pic(), B = pic();
      const stage = makeCanvas(W, H);
      composite(stage.ctx, kind, i / 40, A, B, W, H, 'end', i % 2 === 1, 7);
      for (const [where, calls] of [['the stage', stage.calls], ['the old picture', A.canvas.rec.calls], ['the new picture', B.canvas.rec.calls]]) {
        for (const { op } of drawsWithOp(calls)) if (FULL_CANVAS.has(op)) bad.push(`${kind} at ${i / 40}: a picture drawn on ${where} with ${op}`);
      }
      if (kind === 'glitch' && i > 0 && i < 40) {
        glitchFrames++;
        const onStage = drawsWithOp(stage.calls);
        draws += onStage.length;
        if (onStage.some(({ c }) => c.args.length === 9 && c.args[5] !== 0)) knocked++;
        if (onStage.filter(({ op, c }) => op === 'lighter' && c.args[1] !== 0).length === 2) split++;
        const scratch = i < 20 ? B : A;
        const onScratch = drawsWithOp(scratch.canvas.rec.calls).map(({ op }) => op);
        const fills = scratch.canvas.rec.calls.filter((c) => c.name === 'globalCompositeOperation' && c.set).map((c) => c.args[0]);
        if (onScratch.filter((op) => op === 'multiply').length === 2 && fills.filter((op) => op === 'source-atop').length === 2) tintedRight++;
      }
    }
  }
  ok('no kind of transition, at any of 41 moments, draws a picture with destination-in, source-in, source-out or destination-atop', bad.length === 0, bad.slice(0, 4));
  ok(`the glitch still knocks slices sideways (${knocked} of ${glitchFrames} frames) and splits the colours, a red and a cyan copy added either side (${split})`, knocked >= glitchFrames - 4 && split >= glitchFrames - 4, { glitchFrames, knocked, split });
  ok('...each tinted on the free canvas by filling the picture\'s shape (source-atop) and multiplying the picture in', tintedRight >= glitchFrames - 4, { glitchFrames, tintedRight });
  info(`a glitch frame draws ${(draws / glitchFrames).toFixed(1)} pictures on the stage on average (slices, their wrap-round, the two colour copies)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
