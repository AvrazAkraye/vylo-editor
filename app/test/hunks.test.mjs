// Partial approval: the file that results from taking some changes and not
// others.
//
// This produces content that gets written to someone's disk, so the property
// that matters is composition — taking every hunk must reproduce `after`
// exactly and taking none must reproduce `before` exactly. If either drifts,
// partial approval silently corrupts files, and a diff that looked right on
// screen is no defence.
import { diffRows, hunks, buildPartial } from '../.test-build/pending.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const all = (list) => new Set(list.map((h) => h.index));
const build = (before, after, pick) => {
  const rows = diffRows(before, after);
  const list = hunks(rows);
  return { rows, list, out: buildPartial(rows, list, pick(list)) };
};

// Two edits far enough apart to stay separate: L1 and L12, ten lines between.
const L = (n) => Array.from({ length: n }, (_, i) => `l${i}`);
const BEFORE = L(14).join('\n');
const AFTER = L(14).map((x, i) => (i === 1 ? 'EDIT1' : i === 12 ? 'EDIT12' : x)).join('\n');

// The property the whole feature rests on.
{
  const none = build(BEFORE, AFTER, () => new Set());
  const every = build(BEFORE, AFTER, (l) => all(l));
  ok('two separated edits are two hunks', every.list.length === 2, every.list);
  ok('taking none reproduces the original exactly', none.out === BEFORE, none.out);
  ok('taking all reproduces the proposal exactly', every.out === AFTER, every.out);
}

// Taking one of two.
{
  const first = build(BEFORE, AFTER, () => new Set([0]));
  ok('taking the first leaves the second untouched',
     first.out === L(14).map((x, i) => (i === 1 ? 'EDIT1' : x)).join('\n'), first.out);
  const second = build(BEFORE, AFTER, () => new Set([1]));
  ok('taking the second leaves the first untouched',
     second.out === L(14).map((x, i) => (i === 12 ? 'EDIT12' : x)).join('\n'), second.out);
}

// The merge threshold, pinned. Six unchanged lines between two edits is exactly
// the context shown either side, so they merge and get one checkbox; seven and
// they are separate. Getting this wrong does not corrupt anything, but it does
// decide whether a person is offered one decision or two, so it is worth
// stating rather than leaving to whatever the constant happens to be.
{
  const near = build(L(10).join('\n'), L(10).map((x, i) => (i === 1 || i === 8 ? x + '!' : x)).join('\n'), (l) => all(l));
  ok('edits six lines apart are one decision', near.list.length === 1, near.list.length);
  const far = build(L(11).join('\n'), L(11).map((x, i) => (i === 1 || i === 9 ? x + '!' : x)).join('\n'), (l) => all(l));
  ok('edits seven lines apart are two', far.list.length === 2, far.list.length);
}

// Edits a couple of lines apart read as one change, so they get one checkbox.
{
  const before = ['a', 'b', 'c', 'd', 'e'].join('\n');
  const after = ['A', 'b', 'C', 'd', 'e'].join('\n');
  const r = build(before, after, (l) => all(l));
  ok('nearby edits merge into one hunk', r.list.length === 1, r.list);
  ok('and the merged hunk still round-trips', r.out === after, r.out);
}

// Far apart, they stay separate.
{
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
  const after = before.replace('line 2', 'CHANGED 2').replace('line 30', 'CHANGED 30');
  const r = build(before, after, (l) => all(l));
  ok('distant edits stay separate', r.list.length === 2, r.list.length);
  ok('and still round-trip', r.out === after);
}

// Pure insertion and pure deletion.
{
  const ins = build('a\nb', 'a\nnew\nb', (l) => all(l));
  ok('an insertion round-trips', ins.out === 'a\nnew\nb', ins.out);
  ok('and rejecting it leaves the original', buildPartial(ins.rows, ins.list, new Set()) === 'a\nb');

  const del = build('a\ngone\nb', 'a\nb', (l) => all(l));
  ok('a deletion round-trips', del.out === 'a\nb', del.out);
  ok('and rejecting it keeps the line', buildPartial(del.rows, del.list, new Set()) === 'a\ngone\nb');
}

// A new file is one hunk of pure additions.
{
  const r = build('', 'one\ntwo', (l) => all(l));
  ok('a new file is a single hunk', r.list.length === 1 && r.list[0].removed === 0, r.list);
  ok('taking it writes the file', r.out === 'one\ntwo', r.out);
  ok('rejecting it writes nothing', buildPartial(r.rows, r.list, new Set()) === '', JSON.stringify(buildPartial(r.rows, r.list, new Set())));
}

// A trailing newline is a real line and must survive, or every approval
// quietly strips the last one.
{
  const before = 'a\nb\n';
  const after = 'a\nB\n';
  const r = build(before, after, (l) => all(l));
  ok('a trailing newline survives approval', r.out === after, JSON.stringify(r.out));
  ok('and survives rejection', buildPartial(r.rows, r.list, new Set()) === before, JSON.stringify(buildPartial(r.rows, r.list, new Set())));
}

// Counts drive what the button says, so they have to match the rows.
{
  const r = build('a\nb\nc', 'a\nX\nY\nc', (l) => all(l));
  const n = r.list.reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
  ok('hunk counts match the rows',
     n.added === r.rows.filter((x) => x.kind === '+').length
     && n.removed === r.rows.filter((x) => x.kind === '-').length, n);
}

// Every subset must compose, not just all-or-nothing.
{
  const before = Array.from({ length: 60 }, (_, i) => `l${i}`).join('\n');
  let after = before;
  for (const i of [5, 25, 45]) after = after.replace(`l${i}\n`, `l${i}-edited\nextra${i}\n`);
  const rows = diffRows(before, after);
  const list = hunks(rows);
  ok('three distant edits are three hunks', list.length === 3, list.length);
  let allSubsetsHold = true;
  for (let mask = 0; mask < 8; mask++) {
    const pick = new Set([0, 1, 2].filter((i) => mask & (1 << i)));
    const out = buildPartial(rows, list, pick);
    // Each accepted hunk's additions present, each rejected hunk's removals kept.
    for (const h of list) {
      const on = pick.has(h.index);
      for (let k = h.from; k <= h.to; k++) {
        const r = rows[k];
        const present = out.split('\n').includes(r.text);
        if (r.kind === '+' && on && !present) allSubsetsHold = false;
        if (r.kind === '-' && !on && !present) allSubsetsHold = false;
      }
    }
    if (mask === 7 && out !== after) allSubsetsHold = false;
    if (mask === 0 && out !== before) allSubsetsHold = false;
  }
  ok('every subset of three hunks composes correctly', allSubsetsHold);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
