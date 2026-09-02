// How wide each pane is when several share a row.
//
// Shares rather than pixels, keyed by pane rather than by position. Both of
// those are here because the obvious version breaks the moment the window is
// resized or a pane is hidden and shown again.
import { MIN, after, evened, isEven, shares } from '../.test-build/split.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const sums = (f) => near(f.reduce((a, b) => a + b, 0), 1);

// ── shares ────────────────────────────────────────────────────────────────
ok('no panes, no shares', shares([], {}).length === 0);
ok('one pane is the whole row', shares(['a'], {}).join() === '1');
ok('two with nothing said are half each', shares(['a', 'b'], {}).every((x) => near(x, 0.5)));
ok('three are a third each', shares(['a', 'b', 'c'], {}).every((x) => near(x, 1 / 3)));
ok('they always add up to one', sums(shares(['a', 'b', 'c'], { a: 5, b: 1, c: 2 })));
ok('weights are relative, so the scale does not matter', (() => {
  const a = shares(['a', 'b'], { a: 1, b: 3 });
  const b = shares(['a', 'b'], { a: 100, b: 300 });
  return near(a[0], b[0]) && near(a[0], 0.25);
})());
// A stored value that has gone wrong must not make every pane NaN.
ok('a bad weight reads as one', (() => {
  for (const bad of [0, -1, NaN, Infinity, 'wide', null, undefined]) {
    const f = shares(['a', 'b'], { a: bad, b: 1 });
    if (!sums(f) || !near(f[0], 0.5)) return false;
  }
  return true;
})());

// ── dragging ──────────────────────────────────────────────────────────────
{
  // The divider before pane 1 sits between 0 and 1.
  const w = after(['a', 'b'], {}, 1, 0.1);
  const f = shares(['a', 'b'], w);
  ok('a drag widens the pane before the divider', near(f[0], 0.6), f);
  ok('and narrows the one after it', near(f[1], 0.4), f);
  ok('the row still adds up', sums(f));
}
{
  const f = shares(['a', 'b'], after(['a', 'b'], {}, 1, -0.2));
  ok('dragging back the other way', near(f[0], 0.3) && near(f[1], 0.7), f);
}
{
  // Only the two either side of it, and no others.
  const ids = ['a', 'b', 'c'];
  const f = shares(ids, after(ids, {}, 1, 0.1));
  ok('the third pane is untouched by a drag between the first two',
     near(f[2], 1 / 3), f);
  ok('and the two either side took the change',
     near(f[0], 1 / 3 + 0.1) && near(f[1], 1 / 3 - 0.1), f);
}
{
  const ids = ['a', 'b', 'c'];
  const f = shares(ids, after(ids, {}, 2, 0.1));
  ok('the second divider moves the second and third', near(f[0], 1 / 3), f);
  ok('and them alone', near(f[1], 1 / 3 + 0.1) && near(f[2], 1 / 3 - 0.1), f);
}

// ── the minimum ───────────────────────────────────────────────────────────
// A divider that stops moving is understood. One that snaps back looks broken.
{
  const f = shares(['a', 'b'], after(['a', 'b'], {}, 1, 0.9));
  ok('a drag past the end stops at the minimum', near(f[1], MIN), f);
  ok('and the other pane takes the rest', near(f[0], 1 - MIN), f);
}
{
  const f = shares(['a', 'b'], after(['a', 'b'], {}, 1, -0.9));
  ok('the same in the other direction', near(f[0], MIN), f);
}
ok('a pane is never dragged to nothing', (() => {
  let w = {};
  const ids = ['a', 'b', 'c'];
  for (let i = 0; i < 40; i++) w = after(ids, w, 1, -0.2);
  return shares(ids, w).every((x) => x >= MIN - 1e-9);
})(), shares(['a', 'b', 'c'], (() => { let w = {}; for (let i = 0; i < 40; i++) w = after(['a','b','c'], w, 1, -0.2); return w; })()));
// Nothing can move without pushing something below its minimum.
ok('a row too small for its panes does not move at all', (() => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  return after(ids, {}, 1, 0.1, 0.2) === undefined || shares(ids, after(ids, {}, 1, 0.1, 0.2)).every((x) => near(x, 1 / 9));
})());

// ── what a drag must not do ───────────────────────────────────────────────
ok('there is no divider before the first pane', after(['a', 'b'], {}, 0, 0.1) !== undefined
   && shares(['a', 'b'], after(['a', 'b'], {}, 0, 0.1)).every((x) => near(x, 0.5)));
ok('nor after the last', shares(['a', 'b'], after(['a', 'b'], {}, 2, 0.1)).every((x) => near(x, 0.5)));
ok('a drag of nothing changes nothing', after(['a', 'b'], {}, 1, 0) === undefined
   || shares(['a', 'b'], after(['a', 'b'], {}, 1, 0)).every((x) => near(x, 0.5)));
ok('nonsense does not throw', (() => {
  for (const d of [NaN, Infinity, -Infinity]) after(['a', 'b'], {}, 1, d);
  return true;
})());
ok('dragging does not mutate what it was given', (() => {
  const w = { a: 1, b: 1 };
  after(['a', 'b'], w, 1, 0.2);
  return w.a === 1 && w.b === 1;
})());

// ── panes that are not on screen ──────────────────────────────────────────
// An array indexed by position would hand the third pane's width to whatever
// became third, which is somebody else's pane.
{
  const w = after(['a', 'b'], { c: 4 }, 1, 0.2);
  ok('a hidden pane keeps its width through a drag', w.c === 4);
  ok('and finds it again when it comes back', (() => {
    const f = shares(['a', 'b', 'c'], w);
    return f[2] > f[0] && f[2] > f[1];
  })(), shares(['a', 'b', 'c'], w));
}
ok('hiding the middle pane leaves the other two as they were', (() => {
  const w = after(['a', 'b', 'c'], {}, 1, 0.1);   // a wider, b narrower
  const both = shares(['a', 'c'], w);
  return both[0] > both[1];
})());

// ── evening out ───────────────────────────────────────────────────────────
{
  const w = after(['a', 'b'], {}, 1, 0.3);
  ok('a dragged row is not even', isEven(['a', 'b'], w) === false);
  const back = evened(['a', 'b'], w);
  ok('evening it out makes it even', isEven(['a', 'b'], back) === true);
  ok('and the shares say so', shares(['a', 'b'], back).every((x) => near(x, 0.5)));
}
ok('a fresh row is already even', isEven(['a', 'b', 'c'], {}) === true);
ok('evening leaves panes that are not on screen alone',
   evened(['a'], { b: 7 }).b === 7);
ok('a single pane is always even', isEven(['a'], { a: 9 }) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
