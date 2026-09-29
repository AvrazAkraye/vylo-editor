// The timeline's arithmetic (src/motiontrack.ts): where a moment is drawn,
// what the ruler numbers, where a dragged bar lands, and how much of a bar is
// its entrance and its exit.
//
// What matters. A drag is computed from where the bar was when the pointer
// went down, so the same pointer position always gives the same bar, however
// many moves came before it. Edges snap to the twentieth of a second and,
// within eight pixels, to the playhead, the graphic's ends and the other
// layers' edges; Alt lets go of all of it. Nothing is dragged outside the
// graphic or shorter than 0.05 s. The entrance and exit a bar shows are the
// engine's own (`inDone`, `outStart`), staggered pieces included.
import {
  DRAG_SLOP, FINE, GRID, MIN_LEN, PAD, SNAP_PX,
  dragTo, labelStep, nudge, partsOf, rowsOf, scaleOf, secs, snapTargets, stepRow, ticksOf, timeAt, timingOf, trimEnd, trimStart, xOf,
} from '../.test-build/motiontrack.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── pixels and seconds ────────────────────────────────────────────────────

ok('the constants are the ones the panel was promised', GRID === 0.05 && MIN_LEN === 0.05 && SNAP_PX === 8 && PAD > 0 && FINE < GRID && DRAG_SLOP > 0);
ok('a 5 s graphic on a track 524 px wide is 100 px a second', near(scaleOf(524, 5), 100));
ok('a track too narrow for its padding has no scale', scaleOf(PAD * 2, 5) === 0 && scaleOf(0, 5) === 0);
ok('a graphic of no length has no scale', scaleOf(500, 0) === 0 && scaleOf(500, NaN) === 0);
ok('0 s is drawn PAD px in', xOf(0, 100) === PAD);
ok('2.5 s is 250 px further', xOf(2.5, 100) === PAD + 250);
ok('seconds to pixels and back is the same moment', [0, 0.05, 1.23, 4.999, 5].every((t) => near(timeAt(xOf(t, 37.5), 37.5, 5), t)));
ok('a point left of the track is the start', timeAt(0, 100, 5) === 0);
ok('a point past the end is the end, not later', timeAt(9999, 100, 5) === 5);
ok('with no scale every point is the start', timeAt(300, 0, 5) === 0);

// ── the ruler ─────────────────────────────────────────────────────────────

ok('a wide second is numbered every second', labelStep(100) === 1 && labelStep(26) === 1);
ok('narrower, every two', labelStep(20) === 2 && labelStep(13) === 2);
ok('narrower still, every five', labelStep(12) === 5 && labelStep(6) === 5);
ok('and every ten when five would crowd', labelStep(5) === 10 && labelStep(1) === 10);
{
  const k = ticksOf(5, 100);
  const whole = k.filter((x) => !x.half);
  ok('5 s at 100 px a second: a tick each second, 0 to 5', same(whole.map((x) => x.at), [0, 1, 2, 3, 4, 5]));
  ok('each of them numbered', whole.every((x) => x.label));
  ok('and a half-second mark between each', same(k.filter((x) => x.half).map((x) => x.at), [0.5, 1.5, 2.5, 3.5, 4.5]));
  ok('a half-second mark is never numbered', k.filter((x) => x.half).every((x) => !x.label));
}
{
  const k = ticksOf(30, 6);
  ok('30 s at 6 px a second: every second has a tick', k.length === 31 && k.every((x) => !x.half));
  ok('and every fifth is numbered', same(k.filter((x) => x.label).map((x) => x.at), [0, 5, 10, 15, 20, 25, 30]));
}
{
  const k = ticksOf(30, 3);
  ok('under 4 px a second, only the numbered ticks are drawn', same(k.map((x) => x.at), [0, 10, 20, 30]));
}
ok('a length that is not whole has its last half mark', ticksOf(5.5, 100).some((x) => x.at === 5.5 && x.half));
ok('no scale, no ticks', ticksOf(5, 0).length === 0 && ticksOf(0, 100).length === 0);
ok('ticks run in order', (() => { const a = ticksOf(7, 80).map((x) => x.at); return a.every((v, i) => i === 0 || v > a[i - 1]); })());

// ── snapping ──────────────────────────────────────────────────────────────

const opts = (o = {}) => ({ seconds: 10, pps: 100, targets: [], snap: true, ...o });

{
  const r = dragTo('end', { start: 1, end: 3 }, 0.12, opts());
  ok('an edge snaps to the twentieth of a second', r.end === 3.1 && r.start === 1 && r.guide === null, r);
  const r2 = dragTo('end', { start: 1, end: 3 }, 0.14, opts());
  ok('to the nearest one', r2.end === 3.15, r2);
}
{
  const r = dragTo('end', { start: 1, end: 3 }, 0.14, opts({ targets: [3.2] }));
  ok('within 8 px it snaps to the playhead instead, and says so', r.end === 3.2 && r.guide === 3.2, r);
  const far = dragTo('end', { start: 1, end: 3 }, 0.1, opts({ targets: [3.2] }));
  ok('10 px away it does not', far.end === 3.1 && far.guide === null, far);
  const wide = dragTo('end', { start: 1, end: 3 }, 0.1, opts({ targets: [3.2], pps: 200 }));
  ok('the 8 px are pixels: zoomed in, the same seconds are too far', wide.end === 3.1 && wide.guide === null, wide);
  const close = dragTo('end', { start: 1, end: 3 }, 0.1, opts({ targets: [3.2], pps: 50 }));
  ok('zoomed out, they are near enough', close.end === 3.2 && close.guide === 3.2, close);
}
{
  const layers = [
    { id: 'a', start: 0, end: 2 },
    { id: 'b', start: 1.5, end: 4.25 },
    { id: 'c', start: 1.5, end: 6 },
  ];
  const t = snapTargets(layers, 'a', 2.7, 6);
  ok('the targets are the ends of the graphic, the playhead and the other layers’ edges', same(t, [0, 1.5, 2.7, 4.25, 6]), t);
  ok('but not the dragged layer’s own edges', !t.includes(2));
  ok('a playhead that is not a number is left out', same(snapTargets(layers, 'a', NaN, 6), [0, 1.5, 4.25, 6]));
  const r = dragTo('start', { start: 0, end: 2 }, 1.45, opts({ targets: t }));
  ok('a start snaps to another layer’s start', r.start === 1.5 && r.guide === 1.5, r);
  const e = dragTo('end', { start: 0, end: 2 }, 2.2, opts({ targets: t }));
  ok('an end snaps to another layer’s end', e.end === 4.25 && e.guide === 4.25, e);
}
{
  const r = dragTo('end', { start: 1, end: 3 }, 0.1437, opts({ targets: [3.15], snap: false }));
  ok('with Alt it snaps to nothing: not the target, not the grid', r.end === 3.14 && r.guide === null, r);
  const s = dragTo('start', { start: 1, end: 3 }, 0.123, opts({ snap: false }));
  ok('and is kept to the hundredth, never 1.1230000001', s.start === 1.12, s);
}
{
  // Moving a whole bar: either edge may be the one that snaps.
  const byEnd = dragTo('move', { start: 1, end: 2 }, 1.0, opts({ targets: [3.03] }));
  ok('a moved bar snaps by its end', byEnd.start === 2.03 && byEnd.end === 3.03 && byEnd.guide === 3.03, byEnd);
  const byStart = dragTo('move', { start: 1, end: 2 }, 1.0, opts({ targets: [1.97] }));
  ok('or by its start', byStart.start === 1.97 && byStart.end === 2.97 && byStart.guide === 1.97, byStart);
  const nearer = dragTo('move', { start: 1, end: 2 }, 1.0, opts({ targets: [1.95, 3.02] }));
  ok('whichever edge is nearer its target wins', nearer.start === 2.02 && nearer.end === 3.02 && nearer.guide === 3.02, nearer);
  const grid = dragTo('move', { start: 1, end: 2.37 }, 0.52, opts());
  ok('with nothing near, the start goes on the grid and the length is kept', grid.start === 1.5 && grid.end === 2.87, grid);
}

// ── clamping ──────────────────────────────────────────────────────────────

{
  const from = { start: 1, end: 3 };
  const left = dragTo('move', from, -5, opts({ seconds: 5 }));
  ok('a bar moved past the start stops at 0, its length kept', left.start === 0 && left.end === 2, left);
  const right = dragTo('move', from, 10, opts({ seconds: 5 }));
  ok('moved past the end, it stops with its end at the end', right.start === 3 && right.end === 5, right);
  const full = dragTo('move', { start: 0, end: 5 }, 1, opts({ seconds: 5 }));
  ok('a bar as long as the graphic cannot move', full.start === 0 && full.end === 5, full);
  const s0 = dragTo('start', from, -5, opts({ seconds: 5 }));
  ok('a start dragged before 0 stops at 0', s0.start === 0 && s0.end === 3, s0);
  const s1 = dragTo('start', from, 5, opts({ seconds: 5 }));
  ok('a start dragged past its end stops 0.05 s short of it', near(s1.start, 3 - MIN_LEN) && s1.end === 3, s1);
  const e1 = dragTo('end', from, 5, opts({ seconds: 5 }));
  ok('an end dragged past the graphic stops at its end', e1.end === 5 && e1.start === 1, e1);
  const e0 = dragTo('end', from, -5, opts({ seconds: 5 }));
  ok('an end dragged before its start stops 0.05 s after it', near(e0.end, 1 + MIN_LEN) && e0.start === 1, e0);
  const snapIn = dragTo('start', from, 2.1, opts({ seconds: 5, targets: [3.1] }));
  ok('a snap past the limit is clamped, and then shows no guide', near(snapIn.start, 2.95) && snapIn.guide === null, snapIn);
  const atEnd = dragTo('end', { start: 4.9, end: 5 }, -1, opts({ seconds: 5 }));
  ok('the last 0.05 s of a graphic is a layer that still exists', near(atEnd.end, 4.95) && atEnd.start === 4.9, atEnd);
}
{
  // The same pointer position gives the same bar, however it got there.
  const from = { start: 1.2, end: 2.6 };
  const o = opts({ seconds: 6, targets: [0, 6] });
  const direct = dragTo('move', from, 0.83, o);
  const steps = [0.1, 0.4, -0.3, 1.2, 0.83].map((dt) => dragTo('move', from, dt, o));
  ok('a drag never drifts: the last move alone decides', same(steps[steps.length - 1], direct), { direct, last: steps[steps.length - 1] });
  ok('and a drag back to where it began lands where it began', same(dragTo('move', from, 0, o), { start: 1.2, end: 2.6, guide: null }));
}

// ── the keys ──────────────────────────────────────────────────────────────

ok('→ moves a bar 0.05 s, its length kept', same(nudge({ start: 1, end: 3 }, 0.05, 5), { start: 1.05, end: 3.05 }));
ok('← twice from 0.1 is 0, not 1e-17', same(nudge(nudge({ start: 0.1, end: 1 }, -0.05, 5), -0.05, 5), { start: 0, end: 0.9 }));
ok('a nudge stops at the start', same(nudge({ start: 0.02, end: 1 }, -0.05, 5), { start: 0, end: 0.98 }));
ok('and at the end', same(nudge({ start: 3, end: 5 }, 0.5, 5), { start: 3, end: 5 }));
ok('[ sets the start at the playhead', same(trimStart({ start: 1, end: 3 }, 2.5), { start: 2.5, end: 3 }));
ok('[ past the end keeps 0.05 s', same(trimStart({ start: 1, end: 3 }, 3.2), { start: 2.95, end: 3 }));
ok('] sets the end at the playhead', same(trimEnd({ start: 1, end: 3 }, 4, 5), { start: 1, end: 4 }));
ok('] before the start keeps 0.05 s', same(trimEnd({ start: 1, end: 3 }, 0.5, 5), { start: 1, end: 1.05 }));
ok('] cannot go past the graphic', same(trimEnd({ start: 1, end: 3 }, 9, 5), { start: 1, end: 5 }));

// ── what a bar shows: its entrance and its exit ───────────────────────────

const text = (o) => ({ kind: 'text', id: 't', name: 'T', text: 'One two three', start: 0, end: 5, ...o });
{
  const l = text({ in: { fx: 'rise', d: 0.7, delay: 0.1, ease: 'expo-out', amount: 1 }, out: { fx: 'fade', d: 0.45, delay: 0, ease: 'in', amount: 1 } });
  const p = partsOf(l);
  ok('the entrance runs from its delay for its length', same(p.in, { start: 0.1, end: 0.8 }), p.in);
  ok('the exit ends at the layer’s end and lasts its length', same(p.out, { start: 4.55, end: 5 }), p.out);
  ok('at 100 px a second that is 70 px and 45 px', near((p.in.end - p.in.start) * 100, 70) && near((p.out.end - p.out.start) * 100, 45));
}
{
  // Three words, each running the rise 0.09 s after the last.
  const l = text({ start: 1, end: 6, in: { fx: 'mask', d: 0.7, delay: 0.15, ease: 'expo-out', amount: 1, by: 'word', gap: 0.09 }, out: { fx: 'mask', d: 0.45, delay: 0, ease: 'in', amount: 1, by: 'word' } });
  const p = partsOf(l);
  ok('a split entrance lasts until the last word lands', same(p.in, { start: 1.15, end: 2.03 }), p.in);
  ok('a split exit begins when the first word leaves (the default gap)', same(p.out, { start: 5.47, end: 6 }), p.out);
}
{
  const l = text({ text: 'سڵاو لە هەمووان', in: { fx: 'type', d: 0.5, delay: 0, ease: 'linear', amount: 1, by: 'char', gap: 0.1 } });
  ok('Arabic script split by letter is timed by word, as it is drawn', same(partsOf(l).in, { start: 0, end: 0.7 }), partsOf(l).in);
}
{
  const chart = {
    kind: 'chart', id: 'c', name: 'Chart', start: 0.5, end: 6, gap: 0.12,
    data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }, { label: 'c', value: 3 }, { label: 'd', value: 4 }],
    in: { fx: 'grow', d: 0.9, delay: 0, ease: 'back-out', amount: 1 },
  };
  ok('a chart’s bars arrive one after another by its own gap', same(partsOf(chart).in, { start: 0.5, end: 1.76 }), partsOf(chart).in);
  ok('and with no exit it has none', partsOf(chart).out === null);
}
{
  const l = text({ start: 2, end: 5, out: { fx: 'slide', d: 0.5, delay: 0.3, ease: 'in', amount: 1 } });
  ok('an exit with a delay finishes that long before the end', same(partsOf(l).out, { start: 4.2, end: 4.7 }), partsOf(l).out);
}
{
  const short = text({ start: 0, end: 0.5, in: { fx: 'rise', d: 0.7, delay: 0, ease: 'out', amount: 1 }, out: { fx: 'fade', d: 0.45, delay: 0, ease: 'in', amount: 1 } });
  const p = partsOf(short);
  ok('an entrance longer than the layer is cut at its end', same(p.in, { start: 0, end: 0.5 }), p.in);
  ok('and the exit at its start', same(p.out, { start: 0.05, end: 0.5 }), p.out);
}
ok('a layer with no animation has neither', same(partsOf(text({})), { in: null, out: null }));
ok('nor one whose effect is none', same(partsOf(text({ in: { fx: 'none', d: 1, delay: 0, ease: 'out', amount: 1 } })), { in: null, out: null }));
ok('an entrance that waits past the end shows none', partsOf(text({ start: 0, end: 1, in: { fx: 'fade', d: 0.5, delay: 2, ease: 'out', amount: 1 } })).in === null);

// ── what a drag carries along ─────────────────────────────────────────────

{
  const enter = { fx: 'rise', d: 0.7, delay: 0, ease: 'out', amount: 1 };
  const k = timingOf(text({ in: enter }));
  ok('a drag keeps the entrance it began with', k.in === enter && 'out' in k && !('count' in k));
  const count = { d: 1.6, delay: 0.2, ease: 'expo-out' };
  ok('and a counter’s roll', timingOf({ kind: 'counter', start: 0, end: 5, count }).count === count);
}

// ── rows ──────────────────────────────────────────────────────────────────

{
  const layers = [{ id: 'back' }, { id: 'middle' }, { id: 'front' }];
  ok('the front layer is the first row', same(rowsOf(layers).map((l) => l.id), ['front', 'middle', 'back']));
  ok('and the document is not turned round with it', layers[0].id === 'back');
  const ids = ['front', 'middle', 'back'];
  ok('↓ goes to the next row', stepRow(ids, 'front', 1) === 'middle');
  ok('↑ at the top stays there', stepRow(ids, 'front', -1) === 'front');
  ok('End goes to the last', stepRow(ids, 'middle', 99) === 'back');
  ok('from no row, the first', stepRow(ids, null, 1) === 'front' && stepRow(ids, 'gone', 1) === 'front');
  ok('with no rows, none', stepRow([], 'front', 1) === null);
}

ok('seconds are written as read: 1.2, 3, 0.57', secs(1.2) === '1.2' && secs(3) === '3' && secs(0.57) === '0.57' && secs(NaN) === '0');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
