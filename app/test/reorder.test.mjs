// Dragging a row to a different place in a list.
//
// `move` is six lines and is the whole feature, which is why it is tested from
// every side here: the two directions are not one implementation seen twice.
// Moving an item towards the back of a list first pulls everything after it
// forward by one, so a destination index means one thing on the way out and
// something one place along on the way back — and a tab that lands beside where
// it was dropped is the kind of wrong that looks like the app is guessing.
//
// The rest is the arithmetic behind the gesture, and it is here for the same
// reason: `dropIndex` is where that off-by-one is converted, and it also has to
// hold up in a right-to-left strip, where row 0 is the one furthest to the
// right. Three of this app's four languages are written that way, so a matcher
// that assumes ascending coordinates is broken for most of its users.
import {
  SLACK, THRESHOLD, began, centres, contains, dropIndex, insertionAt, move, orderBy,
} from '../.test-build/reorder.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const L = () => ['a', 'b', 'c', 'd'];

// ── move: towards the back ────────────────────────────────────────────────
//
// The direction the naive version gets wrong. Every row between the item and
// where it went shifts one place towards the front, and the item takes the
// index it was given in the list that results — not the slot that index named
// before it was lifted out.
eq('one place back', move(L(), 0, 1), ['b', 'a', 'c', 'd']);
eq('two places back', move(L(), 0, 2), ['b', 'c', 'a', 'd']);
eq('to the last place', move(L(), 0, 3), ['b', 'c', 'd', 'a']);
eq('from the middle, back', move(L(), 1, 2), ['a', 'c', 'b', 'd']);
eq('the second-to-last to the last', move(L(), 2, 3), ['a', 'b', 'd', 'c']);

// ── move: towards the front ───────────────────────────────────────────────
eq('one place forward', move(L(), 3, 2), ['a', 'b', 'd', 'c']);
eq('two places forward', move(L(), 3, 1), ['a', 'd', 'b', 'c']);
eq('to the first place', move(L(), 3, 0), ['d', 'a', 'b', 'c']);
eq('from the middle, forward', move(L(), 2, 1), ['a', 'c', 'b', 'd']);

// The two directions have to be each other's inverse, or a drag and the drag
// that puts it back do not agree — which is how an order drifts one place per
// correction until nothing is where anybody left it.
{
  let same = true;
  for (let from = 0; from < 4; from++) {
    for (let to = 0; to < 4; to++) {
      const there = move(L(), from, to);
      const back = move(there, to, from);
      if (JSON.stringify(back) !== JSON.stringify(L())) same = false;
    }
  }
  ok('every move is undone by the move back', same);
}

// Nothing may be lost or duplicated. A splice pair that is wrong by one in the
// wrong place drops an item, and a tab that vanishes because it was dragged is
// the failure this whole feature is not allowed to have.
{
  let kept = true;
  for (let from = 0; from < 4; from++) {
    for (let to = 0; to < 4; to++) {
      const out = move(L(), from, to);
      if (out.length !== 4 || new Set(out).size !== 4) kept = false;
    }
  }
  ok('every move is a permutation: nothing lost, nothing duplicated', kept);
}

// ── move: the edges ───────────────────────────────────────────────────────
{
  const list = L();
  ok('a move to itself returns the same array, not a copy', move(list, 2, 2) === list);
  const none = [];
  ok('a move in an empty list returns the same array', move(none, 0, 0) === none);
  const one = ['only'];
  ok('a one-item list has nowhere to go', move(one, 0, 0) === one);
  ok('and cannot be moved to a place it does not have', move(one, 0, 3) === one);
}
{
  const list = L();
  ok('a `from` past the end changes nothing', move(list, 9, 0) === list);
  ok('a negative `from` changes nothing', move(list, -1, 0) === list);
  ok('a fractional `from` changes nothing', move(list, 1.5, 0) === list);
  ok('a NaN `from` changes nothing', move(list, NaN, 0) === list);
  ok('a NaN `to` changes nothing', move(list, 0, NaN) === list);
  ok('a fractional `to` changes nothing', move(list, 0, 2.5) === list);
}
// `to` is clamped rather than refused: a pointer past the last row means the
// end of the strip, which is a real answer, where an item that is not in the
// list is not.
eq('a `to` past the end is the end', move(L(), 0, 99), ['b', 'c', 'd', 'a']);
eq('a negative `to` is the front', move(L(), 3, -4), ['d', 'a', 'b', 'c']);
{
  const list = L();
  move(list, 0, 3);
  eq('the input is never mutated', list, L());
}

// ── the click/drag threshold ──────────────────────────────────────────────
//
// Without this every click on a tab is a one-pixel reorder: a finger on a
// trackpad does not hold still between the button going down and coming up.
{
  const at = (x, y) => ({ x, y });
  ok('a press that did not move is not a drag', !began(at(10, 10), at(10, 10)));
  ok('a pixel of tremor is not a drag', !began(at(10, 10), at(11, 10)));
  ok('just under the threshold is not a drag', !began(at(0, 0), at(THRESHOLD - 1, 0)));
  ok('the threshold itself is a drag', began(at(0, 0), at(THRESHOLD, 0)));
  ok('travel on the other axis counts too', began(at(0, 0), at(0, -THRESHOLD)));
  ok('and travel is a distance, not a coordinate', began(at(0, 0), at(-3, -3)));
  ok('the threshold is a few pixels, not tens of them', THRESHOLD > 1 && THRESHOLD < 10, THRESHOLD);
}

// ── inside the strip, or a cancel ─────────────────────────────────────────
//
// A drop outside the strip is a cancel and never a close. Losing a tab because
// a drag ended in the wrong place is not forgiven, so the only thing being
// decided here is whether the order changes.
{
  const strip = { left: 100, top: 200, right: 400, bottom: 234 };
  ok('the middle of the strip is inside', contains(strip, { x: 250, y: 210 }));
  ok('a corner is inside', contains(strip, { x: 100, y: 200 }));
  ok('a hair below it is still inside, because a sweep wanders',
     contains(strip, { x: 250, y: 240 }));
  ok('and so is a hair past its end', contains(strip, { x: 405, y: 210 }));
  ok('far below it is outside', !contains(strip, { x: 250, y: 234 + SLACK + 1 }));
  ok('far above it is outside', !contains(strip, { x: 250, y: 200 - SLACK - 1 }));
  ok('far past its end is outside', !contains(strip, { x: 400 + SLACK + 1, y: 210 }));
  ok('far before its start is outside', !contains(strip, { x: 100 - SLACK - 1, y: 210 }));
  ok('the slack is generous, because a false cancel reads as a broken feature',
     SLACK >= 16, SLACK);
  ok('a caller may ask for none', !contains(strip, { x: 250, y: 240 }, 0));
}

// ── midpoints ─────────────────────────────────────────────────────────────
{
  const boxes = [
    { left: 0, top: 0, right: 20, bottom: 10 },
    { left: 20, top: 0, right: 60, bottom: 10 },
  ];
  eq('midpoints across', centres(boxes, 'x'), [10, 40]);
  eq('midpoints down', centres(boxes, 'y'), [5, 5]);
  eq('no boxes, no midpoints', centres([], 'x'), []);
}

// ── where the drop lands ──────────────────────────────────────────────────
//
// Four rows of equal width, midpoints at 10, 30, 50, 70.
{
  const mids = [10, 30, 50, 70];
  eq('dragged nowhere, it stays where it is', dropIndex(mids, 10, 0), 0);
  eq('anywhere inside its own row is still where it is', dropIndex(mids, 18, 0), 0);
  eq('past the next row\'s middle, it takes that row\'s place', dropIndex(mids, 31, 0), 1);
  eq('past the third row\'s middle, it takes the third place', dropIndex(mids, 51, 0), 2);
  eq('past the last row, it goes to the end', dropIndex(mids, 999, 0), 3);
  eq('and before the first, to the front', dropIndex(mids, -999, 3), 0);
  eq('the last row moved one place forward', dropIndex(mids, 45, 3), 2);
  eq('the last row moved to the front', dropIndex(mids, 5, 3), 0);
  eq('a middle row, forward', dropIndex(mids, 25, 2), 1);
  eq('a middle row, back', dropIndex(mids, 55, 1), 2);
  eq('a middle row left where it is', dropIndex(mids, 31, 1), 1);

  // The conversion, stated on its own. A row swaps with another when it has
  // crossed *that row's* middle, and 55 is past the third row's middle for
  // something arriving from the front and short of it for something arriving
  // from the back — the same coordinate, two answers, which is the whole
  // reason this is one function and not a line at three call sites.
  eq('crossing the third row from the front takes its place', dropIndex(mids, 55, 0), 2);
  eq('the same coordinate from the back has crossed nothing yet', dropIndex(mids, 55, 3), 3);
  eq('crossing it from the back takes its place too', dropIndex(mids, 45, 3), 2);
  eq('past the last row from the front', dropIndex(mids, 71, 0), 3);
  eq('past the last row from the back is where it already was', dropIndex(mids, 71, 3), 3);

  // Swept from one end to the other, the answer only ever moves one place at a
  // time and never doubles back. A conversion applied in the wrong direction
  // shows up here as a jump.
  {
    let seen = [];
    for (let pos = -10; pos <= 90; pos++) seen.push(dropIndex(mids, pos, 0));
    const steps = seen.filter((v, i) => i > 0 && v !== seen[i - 1]);
    eq('a sweep from the front visits every place in order', steps, [1, 2, 3]);
    seen = [];
    for (let pos = 90; pos >= -10; pos--) seen.push(dropIndex(mids, pos, 3));
    const back = seen.filter((v, i) => i > 0 && v !== seen[i - 1]);
    eq('and a sweep from the back visits them in reverse', back, [2, 1, 0]);
  }
}

// The same strip in a right-to-left language: row 0 is the one on the right, so
// the midpoints descend. Nothing tells this function that; it reads it off the
// numbers, because a direction passed in is a direction a caller can forget.
{
  const mids = [70, 50, 30, 10];
  eq('the first row, dragged one place along', dropIndex(mids, 45, 0), 1);
  eq('the first row, dragged two places along', dropIndex(mids, 25, 0), 2);
  eq('the first row, dragged to the end', dropIndex(mids, -999, 0), 3);
  eq('the last row, dragged to the front', dropIndex(mids, 999, 3), 0);
  eq('the last row, dragged one place forward', dropIndex(mids, 45, 3), 2);
  eq('a row dropped on itself does not move', dropIndex(mids, 48, 1), 1);
}

// Degenerate lists still have to answer, because a strip can hold one row.
{
  eq('one row has one place', dropIndex([10], 999, 0), 0);
  eq('and it is still that place at the other end', dropIndex([10], -999, 0), 0);
  eq('no rows, no places', dropIndex([], 5, 0), 0);
}

// ── the insertion line ────────────────────────────────────────────────────
//
// Drawn while the drag is live rather than at the end of it: the rows do not
// move until the pointer comes up, so this line is the only thing that says
// where the item is about to go.
{
  eq('travelling back, the line is behind the row it will land on', insertionAt(2, 0, 2), 'after');
  eq('travelling forward, it is in front of that row', insertionAt(1, 3, 1), 'before');
  eq('no line on the rows it is passing', insertionAt(1, 0, 2), null);
  eq('no line on the row being carried', insertionAt(0, 0, 2), null);
  eq('and none at all when the drop would change nothing', insertionAt(2, 2, 2), null);
}

// ── a remembered order ────────────────────────────────────────────────────
//
// The chat list is sorted by when each chat was last used and is re-read after
// every reply, so an order somebody dragged into place has to be re-applied on
// every read rather than only after a restart.
{
  const id = (x) => x.id;
  const chat = (i) => ({ id: i });
  const ids = (xs) => xs.map(id).join('');

  const live = [chat('c'), chat('a'), chat('b')];
  ok('nothing remembered leaves the list exactly as it came',
     orderBy(live, [], id) === live);
  ok('an empty list is returned as it came', orderBy([], ['a'], id).length === 0);
  ok('an order about entirely other things leaves it alone',
     orderBy(live, ['x', 'y'], id) === live);

  eq('a remembered order is applied', ids(orderBy(live, ['a', 'b', 'c'], id)), 'abc');
  eq('and it survives the list arriving in another order',
     ids(orderBy([chat('b'), chat('c'), chat('a')], ['a', 'b', 'c'], id)), 'abc');

  // The case the feature exists for: the agent replies in `c`, which sends it
  // to the front of the incoming list, and the arrangement must not move.
  eq('a reply that re-sorts the incoming list changes nothing',
     ids(orderBy([chat('c'), chat('a'), chat('b')], ['b', 'a', 'c'], id)), 'bac');

  // Something new. It is new because something just happened in it, and the
  // incoming list is already sorted by that.
  eq('a new item goes to the front',
     ids(orderBy([chat('d'), chat('c'), chat('a'), chat('b')], ['a', 'b', 'c'], id)), 'dabc');
  eq('two new items keep the order they arrived in',
     ids(orderBy([chat('e'), chat('d'), chat('a')], ['a', 'b'], id)), 'eda');

  eq('an item that is gone is simply not there',
     ids(orderBy([chat('a'), chat('c')], ['a', 'b', 'c'], id)), 'ac');
  eq('a stored order holding the same id twice seats it once',
     ids(orderBy([chat('a'), chat('b')], ['b', 'b', 'a'], id)), 'ba');
  ok('nothing is lost or duplicated on the way through',
     orderBy([chat('d'), chat('a'), chat('b')], ['a', 'b', 'c'], id).length === 3);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
