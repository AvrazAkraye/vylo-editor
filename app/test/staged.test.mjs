// Placing a staged diff over the file it applies to.
//
// The whole feature rests on one mapping: a diff row's `a` number is a position
// in `before`, and `before` is what the buffer holds, so it points at a real
// line. Added lines have no `a` — they do not exist yet — so each run has to be
// anchored to the last line that did. Get that wrong and the proposal is drawn
// at the wrong lines, which is worse than not drawing it at all.
import { stagedMarks } from '../.test-build/staged.js';
import { diffRows } from '../.test-build/pending.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const marks = (before, after) => stagedMarks(diffRows(before, after));

// ── a line replaced in the middle ─────────────────────────────────────────
{
  const m = marks('a\nb\nc', 'a\nB\nc');
  ok('the replaced line is marked at its real number', JSON.stringify(m.removed) === '[2]', m.removed);
  ok('the new line is anchored just after it',
     m.added.length === 1 && m.added[0].after === 2 && m.added[0].lines.join() === 'B', m.added);
}

// ── a pure insertion ──────────────────────────────────────────────────────
{
  const m = marks('a\nc', 'a\nb\nc');
  ok('an insertion removes nothing', m.removed.length === 0, m.removed);
  ok('and lands after the line it follows',
     m.added.length === 1 && m.added[0].after === 1 && m.added[0].lines.join() === 'b', m.added);
}
{
  const m = marks('b\nc', 'a\nb\nc');
  ok('an insertion at the very top anchors at 0',
     m.added.length === 1 && m.added[0].after === 0, m.added);
}
{
  const m = marks('a\nb', 'a\nb\nc');
  ok('an insertion at the end anchors at the last line',
     m.added.length === 1 && m.added[0].after === 2, m.added);
}

// ── a pure deletion ───────────────────────────────────────────────────────
{
  const m = marks('a\nb\nc', 'a\nc');
  ok('a deletion marks the line and adds nothing',
     JSON.stringify(m.removed) === '[2]' && m.added.length === 0, m);
}

// ── several separate changes ──────────────────────────────────────────────
{
  const before = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9'].join('\n');
  const after = before.replace('l1', 'ONE').replace('l8', 'EIGHT');
  const m = marks(before, after);
  ok('both changed lines are marked at their own numbers',
     JSON.stringify(m.removed) === '[2,9]', m.removed);
  ok('each replacement anchors to its own line',
     m.added.length === 2 && m.added[0].after === 2 && m.added[1].after === 9, m.added);
  ok('and carries the right text',
     m.added[0].lines.join() === 'ONE' && m.added[1].lines.join() === 'EIGHT', m.added);
}

// ── a multi-line block swapped for another ────────────────────────────────
{
  const m = marks('head\nx\ny\nz\ntail', 'head\nP\nQ\ntail');
  ok('every removed line is marked', JSON.stringify(m.removed) === '[2,3,4]', m.removed);
  ok('the replacement is one group, not one per line',
     m.added.length === 1 && m.added[0].lines.length === 2, m.added);
  ok('anchored after the last removed line', m.added[0].after === 4, m.added);
}

// ── nothing to show ───────────────────────────────────────────────────────
{
  const m = marks('same\ntext', 'same\ntext');
  ok('an identical file marks nothing', m.removed.length === 0 && m.added.length === 0, m);
}
{
  const m = marks('', 'brand\nnew');
  ok('a new file is all additions at the top',
     m.removed.length === 0 && m.added.length === 1 && m.added[0].after === 0, m);
}

// ── the invariant that makes the mapping safe ─────────────────────────────
{
  // Every removed line number must be a real line in `before`, or the
  // decoration lands somewhere arbitrary.
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const after = before
    .replace('line 3', 'THREE')
    .replace('line 15\n', '')
    .replace('line 27', 'line 27\nEXTRA');
  const m = marks(before, after);
  const count = before.split('\n').length;
  ok('every marked line exists in the buffer',
     m.removed.every((n) => n >= 1 && n <= count), m.removed);
  ok('every anchor is a real line or the top',
     m.added.every((g) => g.after >= 0 && g.after <= count), m.added.map((g) => g.after));
  ok('marks are in file order',
     m.removed.every((n, i) => i === 0 || n > m.removed[i - 1]), m.removed);
}

// ── where an added run starts in the proposed file ────────────────────────
//
// `from` is what lets the added lines be highlighted: they are lines of the
// *proposed* document and have to be parsed as part of it. If it is off by one
// the block shows a neighbouring line's colours, which is worse than none.
{
  const rows = diffRows('a\nb\nc', 'a\nNEW1\nNEW2\nb\nc');
  const m = stagedMarks(rows);
  ok('an inserted run knows where it starts in the new file',
     m.added.length === 1 && m.added[0].from === 2, m.added);
  ok('and `from` indexes the proposed lines exactly', (() => {
    const after = 'a\nNEW1\nNEW2\nb\nc'.split('\n');
    const g = m.added[0];
    return after.slice(g.from - 1, g.from - 1 + g.lines.length).join('\n') === g.lines.join('\n');
  })(), m.added[0]);
}
{
  const before = 'one\ntwo\nthree\nfour';
  const after = 'ADDED\none\ntwo\nX\nthree\nfour\nEND';
  const m = stagedMarks(diffRows(before, after));
  const lines = after.split('\n');
  ok('every run indexes the proposed file, wherever it lands',
     m.added.length === 3 && m.added.every((g) =>
       lines.slice(g.from - 1, g.from - 1 + g.lines.length).join('\n') === g.lines.join('\n')),
     m.added);
  ok('including one at the very top', m.added[0].from === 1 && m.added[0].after === 0, m.added[0]);
}
{
  // A replacement: lines out and lines in at the same place.
  const m = stagedMarks(diffRows('keep\nold\nkeep2', 'keep\nnew1\nnew2\nkeep2'));
  const lines = 'keep\nnew1\nnew2\nkeep2'.split('\n');
  ok('a replacement indexes the new lines, not the old ones',
     m.added.every((g) => lines.slice(g.from - 1, g.from - 1 + g.lines.length).join('\n') === g.lines.join('\n')),
     m.added);
}
{
  const m = stagedMarks(diffRows('', 'only\nlines'));
  ok('a file that was empty starts at line one', m.added[0].from === 1, m.added);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
