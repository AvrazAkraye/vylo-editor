// Snap presets for the terminal panes.
//
// A preset is one button for a shape that takes four gestures by hand, and the
// rules here are the ones that stop the button doing something surprising: the
// pane you are in never goes, the cap is never exceeded, a pane that is hidden
// keeps its width, and the shape the buttons say you are in is read from the
// row rather than remembered from the last click.
//
// `shares` and `MAX_PANES` are the real ones, because this module is the seam
// between `panes.ts` and `split.ts` and a weight only means what `split.ts`
// says it means.
import { PRESETS, TOLERANCE, WIDE, apply, describe } from '../.test-build/layouts.js';
import { MAX_PANES } from '../.test-build/panes.js';
import { shares } from '../.test-build/split.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const same = (xs, ys) => xs.join() === ys.join();
const row = (focus, shown, order, weights = {}) => ({ focus, shown, order, weights });

const ONE = ['a'];
const TWO = ['a', 'b'];
const THREE = ['a', 'b', 'c'];
const FOUR = ['a', 'b', 'c', 'd'];
/** The widths a workbench leaves behind, for tests that start from one. */
const BENCH = { a: 1.3, b: 0.7 };

// ── the buttons ───────────────────────────────────────────────────────────
ok('five presets, shapes first and the repair last',
   same(PRESETS.map((p) => p.id), ['solo', 'pair', 'workbench', 'quad', 'tidy']), PRESETS.map((p) => p.id));
ok('each has a one-word label, because it is a button',
   PRESETS.every((p) => /^[A-Z][a-z]+$/.test(p.label)), PRESETS.map((p) => p.label));
ok('and a sentence about it', PRESETS.every((p) => p.about.length > 10 && p.about.endsWith('.')));

// ── solo ──────────────────────────────────────────────────────────────────
ok('solo from one session is that session', (() => {
  const r = apply('solo', row('a', ONE, ONE));
  return same(r.shown, ['a']) && r.needsNew === false;
})());
ok('solo from two shown keeps the one you are in', same(apply('solo', row('b', TWO, TWO)).shown, ['b']));
ok('solo from three shown, focus in the middle', same(apply('solo', row('b', THREE, THREE)).shown, ['b']));
ok('solo from four sessions with three shown', same(apply('solo', row('c', THREE, FOUR)).shown, ['c']));
// Showing them again should find the arrangement they had.
ok('solo leaves the panes it hid their widths', (() => {
  const r = apply('solo', row('a', TWO, TWO, BENCH));
  return r.weights.b === 0.7 && r.weights.a === 1.3;
})(), apply('solo', row('a', TWO, TWO, BENCH)).weights);

// ── pair ──────────────────────────────────────────────────────────────────
// Nothing to pair it with, and this does not invent a session.
ok('pair from one session is the one pane and a request for another', (() => {
  const r = apply('pair', row('a', ONE, ONE));
  return same(r.shown, ['a']) && r.needsNew === true;
})(), apply('pair', row('a', ONE, ONE)));
ok('pair from two sessions shows both', (() => {
  const r = apply('pair', row('a', ONE, TWO));
  return same(r.shown, TWO) && r.needsNew === false;
})(), apply('pair', row('a', ONE, TWO)));
ok('and evens them', (() => {
  const r = apply('pair', row('a', TWO, TWO, BENCH));
  return shares(r.shown, r.weights).every((x) => near(x, 0.5));
})(), apply('pair', row('a', TWO, TWO, BENCH)).weights);
ok('pair from three sessions takes the next in the list', same(apply('pair', row('a', ONE, THREE)).shown, ['a', 'b']));
ok('and the one after that when the focus is second', same(apply('pair', row('b', ['b'], THREE)).shown, ['b', 'c']));
// The list wraps: the last session's neighbour is the first.
ok('the last session pairs with the first', same(apply('pair', row('c', ['c'], THREE)).shown, ['a', 'c']));
ok('the same from four', same(apply('pair', row('d', ['d'], FOUR)).shown, ['a', 'd']));
ok('the row comes back in list order, not in the order it was filled',
   same(apply('pair', row('c', ['c'], FOUR)).shown, ['c', 'd']));
// A preset is about shape. Somebody who put c beside a and presses Pair means
// "these two, even", not "a and whatever is next".
ok('pair keeps a companion already on screen rather than reaching for the next',
   same(apply('pair', row('a', ['a', 'c'], FOUR)).shown, ['a', 'c']));
ok('pair from three shown drops the one farthest after the focus',
   same(apply('pair', row('b', THREE, THREE)).shown, ['b', 'c']));
ok('wrapping counts for that too', same(apply('pair', row('c', THREE, THREE)).shown, ['a', 'c']));
ok('pair from four sessions with three shown keeps the nearest', (() => {
  const r = apply('pair', row('a', THREE, FOUR));
  return same(r.shown, ['a', 'b']) && r.needsNew === false;
})());

// ── workbench ─────────────────────────────────────────────────────────────
ok('workbench from one session asks for another', (() => {
  const r = apply('workbench', row('a', ONE, ONE));
  return same(r.shown, ['a']) && r.needsNew === true;
})());
ok('workbench from two makes the one you are in wide', (() => {
  const r = apply('workbench', row('a', ONE, TWO));
  const f = shares(r.shown, r.weights);
  return same(r.shown, TWO) && near(f[0], WIDE) && near(f[1], 1 - WIDE);
})(), apply('workbench', row('a', ONE, TWO)));
ok('and wide is the focused pane whichever side it is on', (() => {
  const r = apply('workbench', row('b', TWO, TWO));
  const f = shares(r.shown, r.weights);
  return same(r.shown, TWO) && near(f[0], 1 - WIDE) && near(f[1], WIDE);
})());
ok('workbench from three sessions takes the next in the list', (() => {
  const r = apply('workbench', row('b', ['b'], THREE));
  return same(r.shown, ['b', 'c']) && near(shares(r.shown, r.weights)[0], WIDE);
})());
ok('workbench wraps too', (() => {
  const r = apply('workbench', row('c', ['c'], THREE));
  return same(r.shown, ['a', 'c']) && near(shares(r.shown, r.weights)[1], WIDE);
})());
ok('workbench from three shown keeps two, the focus wide', (() => {
  const r = apply('workbench', row('a', THREE, THREE));
  return same(r.shown, ['a', 'b']) && near(shares(r.shown, r.weights)[0], WIDE);
})());
ok('workbench from four sessions keeps the companion already on screen', (() => {
  const r = apply('workbench', row('b', ['b', 'd'], FOUR));
  return same(r.shown, ['b', 'd']) && near(shares(r.shown, r.weights)[0], WIDE);
})());
ok('workbench leaves hidden panes their widths', apply('workbench', row('a', ONE, TWO, { c: 4 })).weights.c === 4);
// Written as share × count, so 1 stays the even weight and these sit either
// side of it rather than dwarfing every pane still on the default.
ok('the widths are written on the scale split.ts uses', (() => {
  const w = apply('workbench', row('a', ONE, TWO)).weights;
  return near(w.a, WIDE * 2) && near(w.b, (1 - WIDE) * 2);
})());
ok('the wide share is sixty-five per cent', WIDE === 0.65);

// ── tidy ──────────────────────────────────────────────────────────────────
ok('tidy from one pane is that pane', same(apply('tidy', row('a', ONE, ONE)).shown, ['a']));
ok('tidy keeps the panes you have', same(apply('tidy', row('b', THREE, FOUR)).shown, THREE));
ok('and squares them back up', (() => {
  const r = apply('tidy', row('b', THREE, FOUR, { a: 2, b: 0.5, c: 1 }));
  return shares(r.shown, r.weights).every((x) => near(x, 1 / 3));
})(), apply('tidy', row('b', THREE, FOUR, { a: 2, b: 0.5, c: 1 })).weights);
ok('tidy on a workbench makes a pair', (() => {
  const r = apply('tidy', row('a', TWO, TWO, BENCH));
  return same(r.shown, TWO) && shares(r.shown, r.weights).every((x) => near(x, 0.5));
})());
// Tidy is a repair, not a shape: it does not reach into the list for more.
ok('tidy does not add panes', (() => {
  const r = apply('tidy', row('a', ONE, FOUR));
  return same(r.shown, ['a']) && r.needsNew === false;
})());
ok('tidy leaves hidden panes alone', apply('tidy', row('a', TWO, FOUR, { d: 5 })).weights.d === 5);
ok('a focus that is not on screen is brought on', same(apply('tidy', row('d', TWO, FOUR)).shown, ['a', 'b', 'd']));
ok('and when that would be five, the farthest goes', (() => {
  const five = ['a', 'b', 'c', 'd', 'e'];
  const r = apply('tidy', row('e', FOUR, five));
  // d is the one farthest after the focus once e joins; a, b and c stay.
  return r.shown.length === MAX_PANES && same(r.shown, ['a', 'b', 'c', 'e']);
})(), apply('tidy', row('e', FOUR, ['a', 'b', 'c', 'd', 'e'])).shown);

// ── what no preset may do ─────────────────────────────────────────────────
const EVERY = PRESETS.map((p) => p.id);
const ROWS = [
  row('a', ONE, ONE), row('b', TWO, TWO), row('c', THREE, THREE), row('d', ['d'], FOUR),
  row('a', THREE, FOUR), row('b', ['b', 'd'], FOUR), row('d', THREE, FOUR),
];
ok('no preset shows more than the cap', EVERY.every((p) => ROWS.every((r) => apply(p, r).shown.length <= MAX_PANES)));
ok('no preset drops the focused pane', EVERY.every((p) => ROWS.every((r) => apply(p, r).shown.includes(r.focus))));
ok('no preset leaves the row blank while there are sessions',
   EVERY.every((p) => ROWS.every((r) => apply(p, r).shown.length >= 1)));
ok('no preset shows a pane twice',
   EVERY.every((p) => ROWS.every((r) => new Set(apply(p, r).shown).size === apply(p, r).shown.length)));
ok('nothing passed in is changed', (() => {
  const shown = ['a', 'b', 'c'], order = [...FOUR], weights = { a: 2, d: 5 };
  for (const p of EVERY) apply(p, row('b', shown, order, weights));
  return same(shown, THREE) && same(order, FOUR) && weights.a === 2 && weights.d === 5 && Object.keys(weights).length === 2;
})());
ok('the widths for a single pane are left as they were', (() => {
  const w = { a: 1.3, b: 0.7 };
  return EVERY.every((p) => apply(p, row('a', ONE, ONE, w)).weights.a === 1.3);
})());
ok('the cap is four', MAX_PANES === 4);

// ── quad ──────────────────────────────────────────────────────────────────
//
// The cap in one press. It is a shape like any other, so everything the other
// shapes promise has to hold for it too.
ok('quad fills the row to the cap', (() => {
  const r = apply('quad', row('a', ONE, FOUR));
  return r.shown.length === MAX_PANES && same(r.shown, FOUR);
})(), apply('quad', row('a', ONE, FOUR)).shown);
ok('and evens them out', (() => {
  const r = apply('quad', row('a', FOUR, FOUR, { a: 2, b: 0.5, c: 1, d: 0.5 }));
  return FOUR.every((id) => r.weights[id] === 1);
})());
ok('the pane you are in stays, wherever it is in the list',
   apply('quad', row('c', ['c'], FOUR)).shown.includes('c'));
ok('with fewer sessions than the cap it takes what there is',
   same(apply('quad', row('a', ONE, TWO)).shown, TWO));
// `needsNew` is how the panel knows to open one, and quad asks for it the
// same way pair does.
ok('and asks for one more when there are none to take',
   apply('quad', row('a', ONE, ONE)).needsNew === true);
ok('a row already at the cap is not rearranged by quad',
   same(apply('quad', row('b', FOUR, FOUR)).shown, FOUR));

// ── a row that has gone stale ─────────────────────────────────────────────
// A layout restored from disk can name sessions that have since closed.
ok('a pane that no longer exists is dropped', same(apply('pair', row('a', ['a', 'zzz'], TWO)).shown, TWO));
ok('and tidy does not keep it either', same(apply('tidy', row('a', ['a', 'zzz'], TWO)).shown, ['a']));
ok('a focus that no longer exists falls back to the first pane on screen',
   same(apply('solo', row('zzz', ['b', 'c'], THREE)).shown, ['b']));
ok('and to the first session when nothing is on screen', same(apply('solo', row('zzz', [], THREE)).shown, ['a']));
ok('no sessions at all is an empty row and a request for one', (() => {
  const r = apply('pair', row('a', [], []));
  return r.shown.length === 0 && r.needsNew === true;
})());

// ── recognising a shape ───────────────────────────────────────────────────
ok('a single pane is solo', describe(['a'], {}) === 'solo');
ok('whatever its width', describe(['a'], { a: 9 }) === 'solo');
ok('two even panes are a pair', describe(TWO, {}) === 'pair');
ok('a 65/35 is a workbench', describe(TWO, BENCH) === 'workbench');
ok('whichever side is wide', describe(TWO, { a: 0.7, b: 1.3 }) === 'workbench');
// Dragged to 55/45 was chosen, and is neither shape.
ok('a hand-dragged 55/45 is custom', describe(TWO, { a: 0.55, b: 0.45 }) === 'custom');
ok('and so is 60/40', describe(TWO, { a: 0.6, b: 0.4 }) === 'custom');
ok('three panes are custom however even', describe(THREE, {}) === 'custom');
ok('nothing on screen is custom', describe([], {}) === 'custom');
// A divider nudged by a pixel is still the shape it was.
ok('a pixel off a pair is still a pair', describe(TWO, { a: 0.51, b: 0.49 }) === 'pair');
ok('a pixel off a workbench is still a workbench', describe(TWO, { a: 0.66, b: 0.34 }) === 'workbench');
ok('further off is not', describe(TWO, { a: 0.535, b: 0.465 }) === 'custom');
ok('the tolerance is two per cent', TOLERANCE === 0.02);
ok('hidden panes do not count', describe(TWO, { a: 1, b: 1, c: 99 }) === 'pair');

// ── the buttons agree with themselves ─────────────────────────────────────
// What a preset makes is what describe() says it is, so the button that was
// pressed is the one that lights.
ok('solo round-trips', (() => { const r = apply('solo', row('a', TWO, TWO)); return describe(r.shown, r.weights) === 'solo'; })());
ok('pair round-trips', (() => { const r = apply('pair', row('a', ONE, THREE, { a: 3 })); return describe(r.shown, r.weights) === 'pair'; })());
ok('workbench round-trips', (() => { const r = apply('workbench', row('b', ONE, THREE)); return describe(r.shown, r.weights) === 'workbench'; })());
ok('tidy on two panes reads as a pair', (() => { const r = apply('tidy', row('a', TWO, TWO, BENCH)); return describe(r.shown, r.weights) === 'pair'; })());
ok('tidy on three reads as custom, because there is no three-pane shape',
   (() => { const r = apply('tidy', row('a', THREE, THREE, { a: 5 })); return describe(r.shown, r.weights) === 'custom'; })());
ok('every shape from every starting row round-trips', ['solo', 'pair', 'workbench'].every((p) =>
  ROWS.filter((r) => r.order.length >= 2).every((r) => { const a = apply(p, r); return describe(a.shown, a.weights) === p; })));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
