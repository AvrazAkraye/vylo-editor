// How large the window draws itself.
//
// The whole module exists because the obvious implementation — multiply by 1.1
// — does not come back. Most of this file is about that: stepping out and back
// in has to land on the number it started from, not near it, or "am I at the
// normal size" stops having an answer and Reset starts doing something visible
// for no reason.
import {
  KEY, NORMAL, STEPS, canGrow, canShrink, larger, percent, read, rungOf,
  smaller, write,
} from '../.test-build/zoom.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the ladder itself ─────────────────────────────────────────────────────
ok('normal is on the ladder', STEPS.includes(NORMAL));
ok('the steps only ever grow', STEPS.every((s, i) => i === 0 || s > STEPS[i - 1]), STEPS);
ok('none of them is zero or negative', STEPS.every((s) => s > 0));
ok('the storage key is versioned', /\.v\d+$/.test(KEY), KEY);

// ── stepping ──────────────────────────────────────────────────────────────
ok('larger goes up one rung', larger(1) === STEPS[STEPS.indexOf(1) + 1]);
ok('smaller goes down one rung', smaller(1) === STEPS[STEPS.indexOf(1) - 1]);
ok('it clamps at the top rather than wrapping', larger(STEPS[STEPS.length - 1]) === STEPS[STEPS.length - 1]);
ok('and at the bottom', smaller(STEPS[0]) === STEPS[0]);
ok('canGrow is false only at the top',
   canGrow(NORMAL) && !canGrow(STEPS[STEPS.length - 1]));
ok('canShrink is false only at the bottom',
   canShrink(NORMAL) && !canShrink(STEPS[0]));

// The reason this module is a ladder and not a multiplication.
ok('out and back in returns to exactly where it started', (() => {
  let z = NORMAL;
  for (let i = 0; i < 4; i++) z = smaller(z);
  for (let i = 0; i < 4; i++) z = larger(z);
  return z === NORMAL;
})());
ok('and in any order, because the position is what moves', (() => {
  let z = NORMAL;
  for (const step of [larger, larger, smaller, larger, smaller, smaller]) z = step(z);
  return z === NORMAL;
})());
ok('a long run in one direction stops at an end and stays a real step', (() => {
  let z = NORMAL;
  for (let i = 0; i < 50; i++) z = larger(z);
  return z === STEPS[STEPS.length - 1] && STEPS.includes(z);
})());
ok('every rung is reachable from the bottom', (() => {
  let z = STEPS[0];
  const seen = [z];
  for (let i = 0; i < STEPS.length; i++) { z = larger(z); seen.push(z); }
  return STEPS.every((s) => seen.includes(s));
})());

// ── a value that is not on the ladder ─────────────────────────────────────
// It can come from a hand-edited store or from a build with different rungs.
// The intent — roughly this big — survives better by snapping than by resetting.
ok('an off-ladder value snaps to the nearest rung', STEPS[rungOf(1.04)] === 1);
ok('and snapping is by distance, not by rounding down', STEPS[rungOf(1.2)] === 1.25, STEPS[rungOf(1.2)]);
ok('something far above the top snaps to the top', STEPS[rungOf(99)] === STEPS[STEPS.length - 1]);
ok('and far below to the bottom', STEPS[rungOf(0.01)] === STEPS[0]);
ok('a nonsense number is the normal size, not a crash', STEPS[rungOf(NaN)] === NORMAL);
ok('stepping from an off-ladder value still lands on the ladder',
   STEPS.includes(larger(1.04)) && STEPS.includes(smaller(1.04)));

// ── storage ───────────────────────────────────────────────────────────────
ok('nothing stored is the normal size', read(null) === NORMAL);
ok('an empty string is too', read('') === NORMAL);
ok('so is a string that is not a number', read('big') === NORMAL);
ok('and zero or a negative, which would be a window nobody can read',
   read('0') === NORMAL && read('-2') === NORMAL);
ok('a stored level comes back', read('1.5') === 1.5);
ok('an off-ladder stored level snaps', read('1.04') === 1);
ok('write then read is the same level', (() => STEPS.every((s) => read(write(s)) === s))());

// ── saying it out loud ────────────────────────────────────────────────────
ok('the normal size is 100%', percent(NORMAL) === 100);
ok('and a level reads as a whole number of per cent',
   STEPS.every((s) => Number.isInteger(percent(s))), STEPS.map(percent));
ok('1.1 does not read as 110.00000000000001%', percent(1.1) === 110, percent(1.1));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
