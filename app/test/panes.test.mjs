// Which terminal panes are drawn at once.
//
// Small rules, and each one exists because the obvious version has a way of
// leaving somebody looking at a blank panel or at a pane that moved.
import { MAX_PANES, toggle, only, prune, focused, swap } from '../.test-build/panes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const ORDER = ['a', 'b', 'c', 'd', 'e'];

// ── showing and hiding ────────────────────────────────────────────────────
ok('showing a second pane keeps the first', toggle(['a'], 'b', ORDER).join() === 'a,b');
ok('and a third', toggle(['a', 'b'], 'c', ORDER).join() === 'a,b,c');
ok('hiding one leaves the rest', toggle(['a', 'b', 'c'], 'b', ORDER).join() === 'a,c');
// A blank panel beside a full list reads as a failure, not as empty.
ok('the last visible pane cannot be hidden', toggle(['a'], 'a', ORDER).join() === 'a');
ok('and the call is not destructive about it', (() => {
  const before = ['a'];
  return toggle(before, 'a', ORDER) !== before && before.join() === 'a';
})());

// ── the order is the list's, not the order things were clicked ────────────
// A pane that jumps position when you show a third is one you have to find
// again every time.
ok('panes follow the session list', toggle(['c'], 'a', ORDER).join() === 'a,c');
ok('however they were added', toggle(toggle(['e'], 'b', ORDER), 'a', ORDER).join() === 'a,b,e');

// ── the cap ───────────────────────────────────────────────────────────────
ok('four is the cap', MAX_PANES === 4);
ok('and a fourth pane is allowed, which is what the cap being four means',
   toggle(['a', 'b', 'c'], 'd', ORDER).join() === 'a,b,c,d');
{
  const five = toggle(['a', 'b', 'c', 'd'], 'e', ORDER);
  ok('a fifth does not simply appear', five.length === MAX_PANES, five);
  // Dropping the newest would make the button look broken; dropping the oldest
  // makes it do what it says.
  ok('and the one just asked for is the one that shows', five.includes('e'), five);
  ok('the oldest is the one that goes', !five.includes('a'), five);
  ok('and the rest keep list order', five.join() === 'b,c,d,e', five);
}

// ── clicking a row ────────────────────────────────────────────────────────
ok('clicking a row shows just it', only('c').join() === 'c');

// ── a session that closed ─────────────────────────────────────────────────
ok('a pane whose session went is dropped', prune(['a', 'x', 'c'], ORDER).join() === 'a,c');
ok('and the survivors keep list order', prune(['c', 'a'], ORDER).join() === 'a,c');
// Never an empty panel: if everything showing has closed, show something.
ok('losing every visible pane falls back to the first session',
   prune(['x', 'y'], ORDER).join() === 'a');
ok('with no sessions at all it is genuinely empty', prune(['x'], []).length === 0);
ok('an empty set with sessions still falls back', prune([], ORDER).join() === 'a');

// ── which pane the bar acts on ────────────────────────────────────────────
// Acting on a hidden pane is the same class of bug as writing to a file nobody
// has open.
ok('the bar acts on the pane asked for when it is visible', focused(['a', 'b'], 'b') === 'b');
ok('and falls back to the first visible one when it is not', focused(['a', 'b'], 'z') === 'a');
ok('with nothing visible it is empty rather than undefined', focused([], 'a') === '');

// ── choosing what is in a pane ────────────────────────────────────────────
//
// The list beside the panes answers "show this as well" and "hide this". It
// cannot answer "show this *there*", and with four panes that is the question:
// the slots are a layout somebody arranged, and changing one must not
// rearrange the others.
ok('a session not on screen takes the slot', swap(['a', 'b', 'c'], 1, 'd').join() === 'a,d,c');
ok('and the rest do not move', swap(['a', 'b', 'c', 'd'], 0, 'e').join() === 'e,b,c,d');
// Two panes on one shell would both be live, each echoing the other's
// keystrokes. They trade places instead.
ok('a session already drawn trades places with the one in the slot',
   swap(['a', 'b', 'c'], 0, 'c').join() === 'c,b,a');
ok('so the same set is still on screen', (() => {
  const before = ['a', 'b', 'c'];
  const after = swap(before, 2, 'a');
  return [...after].sort().join() === [...before].sort().join();
})());
ok('picking what is already there changes nothing', swap(['a', 'b'], 1, 'b').join() === 'a,b');
ok('a slot that does not exist changes nothing',
   swap(['a', 'b'], 5, 'c').join() === 'a,b' && swap(['a', 'b'], -1, 'c').join() === 'a,b');
ok('and neither does no session', swap(['a', 'b'], 0, '').join() === 'a,b');
ok('swapping does not mutate what it was given', (() => {
  const before = ['a', 'b'];
  swap(before, 0, 'c');
  return before.join() === 'a,b';
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
