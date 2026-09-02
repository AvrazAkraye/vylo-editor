// Where a context menu goes, and how the keyboard moves through it.
//
// Both are where context menus are usually wrong: one opened near the bottom
// runs off the screen and its last items become unreachable, and one that only
// answers the mouse is a set of actions a keyboard cannot reach at all.
import { EDGE, first, focusable, place, step, tidy } from '../.test-build/menu.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const VIEW = { w: 1200, h: 800 };
const SIZE = { w: 220, h: 300 };

// ── placement ─────────────────────────────────────────────────────────────
{
  const p = place({ x: 100, y: 100 }, SIZE, VIEW);
  ok('with room, it opens where the pointer is', p.x === 100 && p.y === 100);
}
// Flipping, not sliding: sliding leaves the menu under the cursor and the first
// item lands wherever the mouse happens to be.
{
  const p = place({ x: 1150, y: 100 }, SIZE, VIEW);
  ok('near the right edge it flips to the other side', p.x === 1150 - 220, p);
  ok('and does not slide back under the pointer', p.x + SIZE.w <= 1150);
}
{
  const p = place({ x: 100, y: 700 }, SIZE, VIEW);
  ok('near the bottom it flips upward', p.y === 700 - 300, p);
}
{
  const p = place({ x: 1150, y: 700 }, SIZE, VIEW);
  ok('in a corner it flips both ways', p.x === 930 && p.y === 400, p);
}
// Neither side fits: sit against the far edge rather than off it.
{
  const p = place({ x: 150, y: 100 }, { w: 1100, h: 100 }, VIEW);
  ok('a wide menu with no room either side sits against the edge',
     p.x + 1100 <= VIEW.w - EDGE && p.x >= EDGE, p);
}
// Taller than the window: pin to the top and let it scroll. Flipping cannot
// help when neither direction fits.
{
  const p = place({ x: 100, y: 400 }, { w: 200, h: 900 }, VIEW);
  ok('a menu taller than the window starts at the top edge', p.y === EDGE, p);
}
ok('nothing is ever placed off the left or top', (() => {
  for (const at of [{ x: 0, y: 0 }, { x: -50, y: -50 }, { x: 2, y: 3 }]) {
    const p = place(at, SIZE, VIEW);
    if (p.x < EDGE || p.y < EDGE) return false;
  }
  return true;
})());
ok('a pointer past the far edge still lands on screen', (() => {
  const p = place({ x: 5000, y: 5000 }, SIZE, VIEW);
  return p.x >= EDGE && p.x + SIZE.w <= VIEW.w - EDGE
      && p.y >= EDGE && p.y + SIZE.h <= VIEW.h - EDGE;
})(), place({ x: 5000, y: 5000 }, SIZE, VIEW));
ok('a tiny window does not produce a negative point', (() => {
  const p = place({ x: 10, y: 10 }, SIZE, { w: 100, h: 100 });
  return p.x === EDGE && p.y === EDGE;
})());

// ── what the keyboard can land on ─────────────────────────────────────────
const A = (id, extra = {}) => ({ kind: 'action', id, label: id, ...extra });
const DIV = { kind: 'divider' };
const SW = { kind: 'swatches' };

ok('an action is focusable', focusable(A('a')) === true);
ok('a disabled one is not', focusable(A('a', { disabled: true })) === false);
ok('a divider never is', focusable(DIV) === false);
// The colour row is one control with many values, so it is a stop, not a skip.
ok('the colour row is', focusable(SW) === true);

// ── moving ────────────────────────────────────────────────────────────────
{
  const items = [A('one'), DIV, A('two'), A('three')];
  ok('down from nowhere goes to the first', step(items, -1, 1) === 0);
  ok('up from nowhere goes to the last', step(items, -1, -1) === 3);
  ok('down skips the divider', step(items, 0, 1) === 2);
  ok('up skips it too', step(items, 2, -1) === 0);
  ok('down from the last wraps to the first', step(items, 3, 1) === 0);
  ok('up from the first wraps to the last', step(items, 0, -1) === 3);
}
{
  const items = [A('one'), A('off', { disabled: true }), A('two')];
  ok('a disabled item is stepped over', step(items, 0, 1) === 2);
  ok('in both directions', step(items, 2, -1) === 0);
}
// A menu of entirely disabled items should not trap the caret on one of them.
ok('nothing to land on is -1', step([DIV, A('x', { disabled: true })], -1, 1) === -1);
ok('and an empty menu is -1', step([], -1, 1) === -1);
ok('`first` is the first landable row', first([DIV, A('a')]) === 1);
ok('and -1 when there is none', first([DIV, DIV]) === -1);
ok('a menu of one wraps to itself', step([A('a')], 0, 1) === 0);
ok('the colour row is a stop on the way past', (() => {
  const items = [A('a'), SW, A('b')];
  return step(items, 0, 1) === 1 && step(items, 1, 1) === 2;
})());

// ── tidying ───────────────────────────────────────────────────────────────
// Building a menu means writing what a tab *could* have and dropping what it
// cannot; the dividers around a dropped group are what is left behind, and a
// rule under nothing is the visible half of a bug.
ok('a leading divider goes', tidy([DIV, A('a')]).length === 1);
ok('a trailing one goes', tidy([A('a'), DIV]).length === 1);
ok('two in a row become one', (() => {
  const out = tidy([A('a'), DIV, DIV, A('b')]);
  return out.length === 3 && out[1].kind === 'divider';
})());
ok('three in a row become one', tidy([A('a'), DIV, DIV, DIV, A('b')]).length === 3);
ok('a real divider between groups survives', (() => {
  const out = tidy([A('a'), DIV, A('b')]);
  return out.map((i) => i.kind).join() === 'action,divider,action';
})());
ok('a menu of only dividers is empty', tidy([DIV, DIV]).length === 0);
ok('an empty menu stays empty', tidy([]).length === 0);
ok('tidying does not mutate what it was given', (() => {
  const src = [DIV, A('a'), DIV];
  tidy(src);
  return src.length === 3;
})());
ok('the swatch row counts as content, so its dividers are kept', (() => {
  const out = tidy([A('a'), DIV, SW]);
  return out.length === 3;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
