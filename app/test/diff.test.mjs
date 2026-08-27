// Pure-function checks on the hand-rolled diff. Bundled with esbuild so the
// TypeScript source is tested rather than a copy.
import { diffLines, countChanges } from '../.test-build/pending.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const render = (rows) => rows.map((r) => r.kind + r.text).join('\n');

// 1. one changed line in the middle
{
  const a = 'one\ntwo\nthree';
  const b = 'one\nTWO\nthree';
  const rows = diffLines(a, b);
  const n = countChanges(rows);
  ok('single line change → 1 add / 1 remove', n.added === 1 && n.removed === 1, JSON.stringify(n));
  ok('unchanged lines kept as context', rows.filter((r) => r.kind === ' ').length === 2, render(rows));
}

// 2. pure insertion
{
  const rows = diffLines('a\nb', 'a\nnew\nb');
  const n = countChanges(rows);
  ok('insertion → 1 add / 0 remove', n.added === 1 && n.removed === 0, JSON.stringify(n));
}

// 3. pure deletion
{
  const rows = diffLines('a\ngone\nb', 'a\nb');
  const n = countChanges(rows);
  ok('deletion → 0 add / 1 remove', n.added === 0 && n.removed === 1, JSON.stringify(n));
}

// 4. new file (empty before)
{
  const rows = diffLines('', 'hello\nworld');
  const n = countChanges(rows);
  ok('new file → all additions', n.added === 2 && n.removed === 0, JSON.stringify(n));
}

// 5. identical input produces no changes
{
  const rows = diffLines('same\ntext', 'same\ntext');
  const n = countChanges(rows);
  ok('identical → no changes', n.added === 0 && n.removed === 0, JSON.stringify(n));
}

// 6. line numbers line up on both sides
{
  const rows = diffLines('a\nb\nc', 'a\nX\nc');
  const del = rows.find((r) => r.kind === '-');
  const add = rows.find((r) => r.kind === '+');
  ok('removed line keeps its OLD line number', del?.a === 2, JSON.stringify(del));
  ok('added line keeps its NEW line number', add?.b === 2, JSON.stringify(add));
}

// 7. long unchanged runs collapse, so a 1-line change in a big file stays readable
{
  const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  const edited = big.replace('line 100', 'line 100 CHANGED');
  const rows = diffLines(big, edited);
  ok('collapses untouched regions', rows.length < 20, `${rows.length} rows for a 200-line file`);
  ok('keeps a gap marker', rows.some((r) => r.text === '⋯'), render(rows).slice(0, 120));
  const n = countChanges(rows);
  ok('still exactly one change', n.added === 1 && n.removed === 1, JSON.stringify(n));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
