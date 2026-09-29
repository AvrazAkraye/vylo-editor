// The animation evaluator: what a layer looks like at one moment.
//
// What matters. A pose is a pure function of the layer, the time and the
// reading direction, and it is total — whatever a hand-edited document holds,
// every field is finite and opacity stays in 0..1. An exit is the entrance
// played backwards, so at the same distance from the ends the two poses agree.
// Directions are logical: the same layer slides in from the start side, and
// that is the left in English and the right in Arabic. A split text's pieces
// start one `gap` apart and leave in the same order, the last one ending exactly
// at the layer's `end`. Loops never pop in with the layer. And a wipe that has
// not begun (an exit still waiting) must not turn the wipe that is under way.
import {
  DEFAULT_GAP, countAt, gapOf, inDone, outStart, poseAt, stillTime, unitsOf,
} from '../.test-build/motionanim.js';
import { blankLayer } from '../.test-build/motionread.js';
import { EFFECTS, LOOPS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A layer that runs 0..10 s with one entrance of 1 s on a linear curve, so progress equals time. */
const layer = (fx, o = {}, kind = 'shape') => blankLayer(kind, {
  id: 'l', start: 0, end: 10, in: { fx, d: 1, delay: 0, ease: 'linear', amount: 1, ...o },
});
const at = (l, t, rtl = false, unit) => poseAt(l, t, rtl, unit);

// ── the window a layer is on screen ───────────────────────────────────────
{
  const l = blankLayer('shape', { id: 'w', start: 2, end: 5 });
  ok('before start: off', at(l, 1.99).on === false);
  ok('at start: on', at(l, 2).on === true);
  ok('just before end: on', at(l, 4.999).on === true);
  ok('at end: off (the layer runs up to it, not through it)', at(l, 5).on === false);
  ok('a hidden layer is never on', at({ ...l, hidden: true }, 3).on === false);
  const p = at(l, 3);
  ok('with no animation the pose is the layer\'s own', p.dx === 0 && p.dy === 0 && p.sx === 1 && p.sy === 1 && p.rot === 0 && p.opacity === 1
    && p.reveal === 1 && p.mask === 1 && p.type === 1 && p.draw === 1 && p.grow === 1 && p.blur === 0 && p.glint === -1 && p.presence === 1, p);
  const b = blankLayer('shape', { id: 'b', start: 0, end: 5, scale: 2, rot: 30, opacity: 0.5 });
  const q = at(b, 1);
  ok('and it carries the layer\'s scale, rotation and opacity', q.sx === 2 && q.sy === 2 && q.rot === 30 && q.opacity === 0.5);
}

// ── every effect, at its ends and its middle ──────────────────────────────
{
  const start = (fx, o) => at(layer(fx, o), 0);
  const mid = (fx, o) => at(layer(fx, o), 0.5);
  const rest = (fx, o) => at(layer(fx, o), 1);
  for (const fx of EFFECTS.filter((f) => f !== 'none')) {
    const r = rest(fx);
    ok(`${fx}: at rest the layer is exactly as drawn`, r.dx === 0 && r.dy === 0 && r.sx === 1 && r.sy === 1 && r.rot === 0 && r.opacity === 1
      && r.reveal === 1 && r.mask === 1 && r.type === 1 && r.draw === 1 && r.grow === 1 && r.blur === 0, r);
  }
  ok('fade: transparent at the start, half at the middle', start('fade').opacity === 0 && near(mid('fade').opacity, 0.5));
  ok('rise: starts 6u low and transparent', near(start('rise').dy, 6) && start('rise').opacity === 0 && near(mid('rise').dy, 3));
  ok('drop: starts 6u high', near(start('drop').dy, -6));
  ok('amount scales the travel', near(start('rise', { amount: 2 }).dy, 12) && near(start('rise', { amount: 0.5 }).dy, 3));
  ok('pop: starts at 55% and is solid before it is big', near(start('pop').sx, 0.55) && start('pop').opacity === 0 && near(mid('pop').sx, 0.775) && mid('pop').opacity === 1);
  ok('zoom: starts 35% too large', near(start('zoom').sx, 1.35) && near(start('zoom').sy, 1.35));
  ok('spin: starts turned back 90 degrees and small', near(start('spin').rot, -90) && near(start('spin').sx, 0.6));
  ok('flip: starts flat', start('flip').sy === 0 && start('flip').sx === 1);
  ok('blur: starts 6u soft and comes into focus', near(start('blur').blur, 6) && near(mid('blur').blur, 3) && rest('blur').blur === 0);
  ok('wipe, mask, type, draw and grow report their progress', near(mid('wipe').reveal, 0.5) && near(mid('mask').mask, 0.5)
    && near(mid('type').type, 0.5) && near(mid('draw').draw, 0.5) && near(mid('grow').grow, 0.5));
}

// ── logical directions ────────────────────────────────────────────────────
{
  const slide = (dir, rtl) => at(layer('slide', { dir }), 0, rtl);
  ok('slide from the start side is from the left in English', near(slide('start', false).dx, -12));
  ok('and from the right in a right-to-left language', near(slide('start', true).dx, 12));
  ok('from the end side, the other way', near(slide('end', false).dx, 12) && near(slide('end', true).dx, -12));
  ok('the default is the start side', near(at(layer('slide'), 0, false).dx, -12));
  ok('up and down are physical', near(slide('up', false).dy, 12) && near(slide('down', true).dy, -12) && slide('up', true).dx === 0);
  const wipe = (dir, rtl) => at(layer('wipe', { dir }), 0.5, rtl).from;
  ok('wipe grows from the start edge: left in English, right in Arabic', wipe('start', false) === 'left' && wipe('start', true) === 'right');
  ok('from the end edge, the other way', wipe('end', false) === 'right' && wipe('end', true) === 'left');
  ok('up reveals from the bottom, down from the top', wipe('up', false) === 'bottom' && wipe('down', true) === 'top');
}

// ── an exit is the entrance played backwards ──────────────────────────────
{
  const l = blankLayer('shape', {
    id: 'x', start: 0, end: 10,
    in: { fx: 'rise', d: 1, delay: 0, ease: 'linear', amount: 1 },
    out: { fx: 'rise', d: 1, delay: 0, ease: 'linear', amount: 1 },
  });
  ok('before the exit begins the layer is at rest', near(at(l, 5).dy, 0) && at(l, 5).opacity === 1);
  ok('the exit starts from rest', near(at(l, 9).dy, 0));
  ok('and is halfway gone halfway through', near(at(l, 9.5).dy, 3) && near(at(l, 9.5).opacity, 0.5));
  ok('the mirror: 0.3 s in equals 0.3 s from the end', near(at(l, 0.3).dy, at(l, 9.7).dy) && near(at(l, 0.3).opacity, at(l, 9.7).opacity));
  ok('the last instant is gone', at(l, 9.999).opacity < 0.01);
  const eased = blankLayer('shape', { id: 'e', start: 0, end: 10, out: { fx: 'fade', d: 1, delay: 0, ease: 'cubic-out', amount: 1 } });
  ok('an exit on an ease-out curve leaves slowly and then quickly (it reads the curve on reversed time)',
    at(eased, 9.25).opacity > 0.9 && at(eased, 9.9).opacity < 0.3 && at(eased, 9.999).opacity < 0.01, [at(eased, 9.25).opacity, at(eased, 9.9).opacity]);
  const delayed = blankLayer('shape', { id: 'dl', start: 0, end: 10, out: { fx: 'fade', d: 1, delay: 2, ease: 'linear', amount: 1 } });
  ok('an exit delay ends the exit that long before the end of the layer', near(at(delayed, 7).opacity, 1) && near(at(delayed, 7.5).opacity, 0.5) && at(delayed, 8.5).opacity === 0 && at(delayed, 9.9).opacity === 0);
}

// ── curves that overshoot ─────────────────────────────────────────────────
{
  const l = layer('pop', { ease: 'back-out' });
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => at(l, i / 100).sx));
  ok('a pop on back-out really grows past its size and comes back', peak > 1.02 && near(at(l, 1).sx, 1));
  ok('but opacity never leaves 0..1', Array.from({ length: 101 }, (_, i) => at(l, i / 100).opacity).every((o) => o >= 0 && o <= 1));
  const g = layer('grow', { ease: 'elastic-out' });
  ok('a grow is allowed a little overshoot, and no more than 25%', Array.from({ length: 101 }, (_, i) => at(g, i / 100).grow).every((v) => v >= 0 && v <= 1.25));
}

// ── a wipe that has not begun must not turn the one under way ─────────────
{
  const l = blankLayer('shape', {
    id: 'wp', start: 0, end: 10,
    in: { fx: 'wipe', d: 1, delay: 0, ease: 'linear', amount: 1, dir: 'start' },
    out: { fx: 'wipe', d: 1, delay: 0, ease: 'linear', amount: 1, dir: 'end' },
  });
  ok('during the entrance the edge is the entrance\'s', at(l, 0.5, false).from === 'left' && near(at(l, 0.5, false).reveal, 0.5));
  ok('during the exit it is the exit\'s', at(l, 9.5, false).from === 'right' && near(at(l, 9.5, false).reveal, 0.5));
  ok('and in the hold nothing is hidden', at(l, 5).reveal === 1);
}

// ── split text: stagger in, and out in the same order ─────────────────────
{
  const l = blankLayer('text', {
    id: 't', start: 0, end: 10, text: 'a b c d',
    in: { fx: 'rise', d: 1, delay: 0, ease: 'linear', amount: 1, by: 'word', gap: 0.1 },
    out: { fx: 'rise', d: 1, delay: 0, ease: 'linear', amount: 1, by: 'word', gap: 0.1 },
  });
  const u = (i, t) => at(l, t, false, { i, n: 4 });
  ok('the first piece starts at once, the fourth 0.3 s later', near(u(0, 0).opacity, 0) && near(u(0, 0.3).opacity, 0.3) && near(u(3, 0.3).opacity, 0) && near(u(3, 0.8).opacity, 0.5));
  ok('the last piece finishes 3 gaps after the first', near(u(3, 1.3).opacity, 1) && near(u(0, 1).opacity, 1));
  ok('inDone counts the stagger', near(inDone(l, 4), 1.3) && near(inDone(l, 1), 1));
  ok('they leave in the same order', u(0, 8.75).opacity < u(3, 8.75).opacity, [u(0, 8.75).opacity, u(3, 8.75).opacity]);
  ok('the last piece is gone exactly at the end', near(u(3, 9.999).opacity, 0, 0.01) && u(0, 9.7).opacity === 0);
  ok('outStart counts the stagger', near(outStart(l, 4), 8.7) && near(outStart(l, 1), 9));
  ok('gapOf reads the animation\'s gap, then the default', gapOf(l, l.in) === 0.1 && gapOf(l, { fx: 'fade', d: 1, delay: 0, ease: 'out', amount: 1 }) === DEFAULT_GAP);
  const chart = blankLayer('chart', { id: 'c', gap: 0.25 });
  ok('a chart\'s data are spaced by the chart\'s own gap', gapOf(chart, undefined) === 0.25);
}

// ── loops ─────────────────────────────────────────────────────────────────
{
  const loop = (fx, o = {}, base = {}) => blankLayer('shape', { id: 'lp', start: 0, end: 10, loop: { fx, d: 4, amount: 1, ...o }, ...base });
  ok('float rises by 1u a quarter of the way through a cycle', near(at(loop('float'), 1).dy, 1));
  ok('and is stronger with amount', near(at(loop('float', { amount: 2 }), 1).dy, 2));
  ok('pulse swells 4.5% at mid-cycle and starts at 1', near(at(loop('pulse'), 2).sx, 1.045) && near(at(loop('pulse'), 0).sx, 1));
  ok('spin turns a full circle a cycle', near(at(loop('spin'), 2).rot, 180) && near(at(loop('spin'), 4).rot, 360));
  ok('sway is 4 degrees at its peak', near(at(loop('sway'), 1).rot, 4));
  ok('breathe dims by a quarter at mid-cycle', near(at(loop('breathe'), 2).opacity, 0.75));
  ok('shimmer reports where its highlight is', near(at(loop('shimmer'), 1).glint, 0.25) && at(loop('float'), 1).glint === -1);
  const withIn = loop('float', {}, { in: { fx: 'fade', d: 2, delay: 0, ease: 'linear', amount: 1 } });
  ok('a loop fades in with the layer (weighted by how present it is)', near(at(withIn, 1).dy, 0.5, 1e-6), at(withIn, 1).dy);
  ok('every loop word is handled', LOOPS.filter((f) => f !== 'none').every((fx) => { const p = at(loop(fx), 1.3); return Number.isFinite(p.dy) && Number.isFinite(p.sx) && Number.isFinite(p.rot); }));
}

// ── totality: nothing a document holds can make a pose non-finite ─────────
{
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const junk = [NaN, Infinity, -Infinity, -1, 0, 1e-9, 1e9, 0.5, 3, undefined];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  let bad = 0;
  for (let n = 0; n < 4000; n += 1) {
    const l = {
      ...blankLayer('text', { id: 'f', start: 0, end: 5 }),
      start: pick(junk), end: pick([5, ...junk]), opacity: pick(junk), scale: pick(junk), rot: pick(junk),
      in: { fx: pick(EFFECTS), d: pick(junk), delay: pick(junk), ease: pick(['out', 'bezier(9,9,9,9)', 'nope', 'spring']), amount: pick(junk), dir: pick(['up', 'start', undefined]) },
      out: { fx: pick(EFFECTS), d: pick(junk), delay: pick(junk), ease: pick(['in', 'back-out']), amount: pick(junk) },
      loop: { fx: pick(LOOPS), d: pick(junk), amount: pick(junk) },
    };
    const p = poseAt(l, pick([0, 0.5, 2.5, 4.999, 5, -1, 1e9, ...junk]), rnd() < 0.5, rnd() < 0.5 ? { i: Math.floor(rnd() * 5), n: 5 } : undefined);
    const nums = [p.presence, p.opacity, p.dx, p.dy, p.sx, p.sy, p.rot, p.reveal, p.mask, p.type, p.draw, p.grow, p.blur, p.glint];
    if (!nums.every(Number.isFinite) || p.opacity < 0 || p.opacity > 1 || typeof p.on !== 'boolean') bad += 1;
  }
  ok('4000 garbage layers and times: every pose field finite, opacity in 0..1', bad === 0, bad);
}

// ── counters ──────────────────────────────────────────────────────────────
{
  const c = (o = {}) => blankLayer('counter', { id: 'n', start: 1, end: 10, from: 0, to: 100, count: { d: 2, delay: 0.5, ease: 'linear' }, ...o });
  ok('it shows `from` until the roll starts', countAt(c(), 0) === 0 && countAt(c(), 1.5) === 0);
  ok('rolls linearly', near(countAt(c(), 2.5), 50));
  ok('and stops on `to`', countAt(c(), 3.5) === 100 && countAt(c(), 99) === 100);
  ok('an overshooting curve never shows a number past `to`', Array.from({ length: 101 }, (_, i) => countAt(c({ count: { d: 2, delay: 0.5, ease: 'back-out' } }), 1.5 + i / 50)).every((v) => v >= 0 && v <= 100));
  ok('counting down works', near(countAt(c({ from: 100, to: 0 }), 2.5), 50));
  ok('nonsense time is `from`, never NaN', Number.isFinite(countAt(c(), NaN)) && countAt(c(), NaN) === 0);
}

// ── units, and the still that stands for a graphic ────────────────────────
{
  const text = (t, by, extra = {}) => blankLayer('text', { id: 'u', text: t, in: { fx: 'rise', d: 1, delay: 0, ease: 'out', amount: 1, by }, ...extra });
  ok('one unit unless split', unitsOf(text('a b c', 'all')) === 1 && unitsOf(blankLayer('shape', { id: 's' })) === 1);
  ok('lines are counted at the breaks written', unitsOf(text('a\nb\nc', 'line')) === 3);
  ok('words at spaces', unitsOf(text('one  two three', 'word')) === 3);
  ok('characters without spaces', unitsOf(text('ab cd', 'char')) === 4);
  ok('Arabic script is never split into letters, it falls back to words', unitsOf(text('مرحبا بالعالم', 'char')) === 2);
  ok('a chart has a unit per datum', unitsOf(blankLayer('chart', { id: 'c' })) >= 1);

  const a = blankLayer('text', { id: 'a', start: 0, end: 6, in: { fx: 'fade', d: 1, delay: 0.5, ease: 'out', amount: 1 }, out: { fx: 'fade', d: 0.5, delay: 0, ease: 'in', amount: 1 } });
  const s = stillTime([a], 6);
  ok('the still is a little into the hold: after the entrance, before the exit', s > inDone(a) && s < outStart(a), [s, inDone(a), outStart(a)]);
  ok('a graphic of nothing but a background is drawn at its middle', stillTime([blankLayer('backdrop', { id: 'b', start: 0, end: 8 })], 8) === 4);
  ok('and an empty one too', stillTime([], 6) === 3);
  ok('hidden layers do not decide it', stillTime([{ ...a, hidden: true }], 6) === 3);
  const tight = blankLayer('text', { id: 't', start: 0, end: 2, in: { fx: 'fade', d: 1.5, delay: 0, ease: 'out', amount: 1 }, out: { fx: 'fade', d: 1, delay: 0, ease: 'in', amount: 1 } });
  const st = stillTime([tight], 2);
  ok('when there is no hold it stays inside the graphic', st >= 0 && st < 2, st);
  const k = blankLayer('counter', { id: 'k', start: 0, end: 8, count: { d: 3, delay: 1, ease: 'out' }, in: { fx: 'fade', d: 0.5, delay: 0, ease: 'out', amount: 1 } });
  ok('a counter is settled when its roll is done, not when it fades in', stillTime([k], 8) >= 4, stillTime([k], 8));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
