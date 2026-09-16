// Pasting a lot of text into a shell.
//
// The hazard is narrow and worth stating: a paste that ends in a newline runs.
// Everything here is about telling that case apart from the ordinary one, and
// about not crying wolf — a confirmation people see for two-line pastes is one
// they learn to dismiss without reading, which is worse than not having it.
import { BULK_BYTES, BULK_LINES, head, isBulk, size, summarise } from '../.test-build/paste.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');

// ── what is held and what goes straight through ───────────────────────────
ok('a typed-length command goes straight through', !isBulk('git status'));
ok('so does an empty paste', !isBulk(''));
ok('two lines is a command and its argument, not a blob', !isBulk(lines(2)));
ok('and so is a paste at the line limit', !isBulk(lines(BULK_LINES)), BULK_LINES);
ok('past the limit it is held', isBulk(lines(BULK_LINES + 1)));
ok('a long single line is held on length alone',
   isBulk('x'.repeat(BULK_BYTES)) && !isBulk('x'.repeat(BULK_BYTES - 1)));
// Text copied with the line break at the end is three lines and a return, not
// four — counting it would hold pastes a keystroke short of the threshold.
ok('a trailing newline is not a line of its own',
   !isBulk(`${lines(BULK_LINES)}\n`), `${BULK_LINES} lines + newline`);
ok('carriage returns count the same as newlines',
   isBulk(lines(BULK_LINES + 1).replace(/\n/g, '\r\n')));

// ── what the chip says ────────────────────────────────────────────────────
{
  const s = summarise('one\ntwo\nthree');
  ok('the lines are counted', s.lines === 3, s);
  ok('the first line is what it shows', s.head === 'one', s);
  ok('and it does not run on arrival', s.runs === false, s);
}
{
  const s = summarise('rm -rf /tmp/x\n');
  ok('a trailing newline is the one thing worth warning about', s.runs === true, s);
  ok('and it is still one line', s.lines === 1, s);
}
ok('an empty paste has no lines', summarise('').lines === 0);
ok('bytes are the whole string, newline and all', summarise('ab\n').bytes === 3);
ok('the head is trimmed, so indented text does not show as blank',
   summarise('    indented\nmore').head === 'indented');
ok('\\r\\n is not left on the head',
   summarise('one\r\ntwo').head === 'one', summarise('one\r\ntwo').head);

// ── a size a person reads ─────────────────────────────────────────────────
ok('small pastes are bytes', size(240) === '240 B');
ok('past a thousand it is kilobytes', size(12400) === '12 KB', size(12400));
ok('and past a million, megabytes with one decimal', size(2_400_000) === '2.4 MB', size(2_400_000));
ok('the boundary does not read as 1000 B', size(1000) === '1 KB');

// ── the chip is one line tall, whatever is in it ──────────────────────────
// The strip's height changes the size of the terminal above it, so a chip that
// wrapped would resize the pane it is describing.
ok('a short first line is left alone', head('ls -la\nmore') === 'ls -la');
ok('a long one is cut with an ellipsis', (() => {
  const out = head('x'.repeat(200), 20);
  return out.length === 20 && out.endsWith('…');
})(), head('x'.repeat(200), 20));
ok('cutting never returns more than it was asked for',
   [1, 5, 40, 200].every((w) => head('y'.repeat(500), w).length <= w));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
