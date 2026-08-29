// Terminal output on its way to a model.
//
// The cost of getting this wrong is not a crash, it is a bill. A pty carries
// what a screen should look like, so a progress bar redrawing itself two
// hundred times is two hundred copies of the same line wrapped in escape codes,
// all of it charged as input tokens to say nothing.
import { clip, collapseCarriage, readable, stripAnsi } from '../.test-build/ansi.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const E = '\x1b';

// ── escape sequences ──────────────────────────────────────────────────────
ok('colour codes go', stripAnsi(`${E}[32mpass${E}[0m`) === 'pass', stripAnsi(`${E}[32mpass${E}[0m`));
ok('bold and reset go', stripAnsi(`${E}[1mx${E}[22m`) === 'x');
ok('cursor moves go', stripAnsi(`a${E}[2Ab`) === 'ab');
ok('clear-line goes', stripAnsi(`${E}[2Kdone`) === 'done');
ok('a private-mode set goes', stripAnsi(`${E}[?25lhidden${E}[?25h`) === 'hidden');
ok('an OSC title goes', stripAnsi(`${E}]0;my title\x07text`) === 'text', stripAnsi(`${E}]0;my title\x07text`));
ok('an OSC ended by ST goes', stripAnsi(`${E}]8;;http://x${E}\\link`) === 'link',
   stripAnsi(`${E}]8;;http://x${E}\\link`));
ok('plain text is untouched', stripAnsi('nothing to strip') === 'nothing to strip');
ok('a literal bracket survives', stripAnsi('arr[0] = 1') === 'arr[0] = 1');

// ── progress bars ─────────────────────────────────────────────────────────
ok('only the last version of a redrawn line is kept',
   collapseCarriage('10%\r50%\r100%') === '100%', collapseCarriage('10%\r50%\r100%'));
ok('other lines are unaffected',
   collapseCarriage('one\n10%\r99%\ntwo') === 'one\n99%\ntwo');
ok('a line with no carriage return is untouched', collapseCarriage('plain') === 'plain');
// A pty turns every \n into \r\n, so treating that trailing \r as an overwrite
// discards the line — which would have meant every command returning nothing.
ok('CRLF is a line ending, not an overwrite',
   collapseCarriage('one\r\ntwo\r\n') === 'one\ntwo\n', JSON.stringify(collapseCarriage('one\r\ntwo\r\n')));
ok('a real overwrite inside a CRLF line still collapses',
   collapseCarriage('10%\r99%\r\ndone\r\n') === '99%\ndone\n',
   JSON.stringify(collapseCarriage('10%\r99%\r\ndone\r\n')));

// ── the two together ──────────────────────────────────────────────────────
{
  const frames = Array.from({ length: 200 }, (_, i) => `${E}[2K${E}[0G[${i}/200]`).join('\r');
  const out = readable(`installing\n${frames}\ndone\n`);
  ok('two hundred progress frames collapse to one',
     out.text === 'installing\n[199/200]\ndone', JSON.stringify(out.text));
  ok('and the result is a fraction of the input', out.text.length < frames.length / 20,
     `${out.text.length} vs ${frames.length}`);
}
ok('a cleared screen does not leave a wall of blank lines',
   readable('a\n\n\n\n\n\nb').text === 'a\n\nb', JSON.stringify(readable('a\n\n\n\n\n\nb').text));
ok('trailing spaces are trimmed per line', readable('a   \nb  ').text === 'a\nb');

// ── clipping ──────────────────────────────────────────────────────────────
{
  const long = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n');
  const out = clip(long, 1000);
  ok('a long run is clipped', out.truncated && out.text.length < 1200, out.text.length);
  ok('the start survives', out.text.startsWith('line 0'), out.text.slice(0, 20));
  ok('the end survives, because that is where the error is',
     out.text.trimEnd().endsWith('line 4999'), out.text.slice(-20));
  ok('and it says how much went', /\d+ characters omitted/.test(out.text));
}
ok('short output is not clipped', clip('fine', 100).truncated === false);

// ── a realistic failing test run ──────────────────────────────────────────
{
  const raw = `${E}[?25l${E}[32m✓${E}[0m two passed\r\n${E}[31m✗${E}[0m one failed\r\n`
            + `${E}[2K  expected ${E}[32m'a'${E}[0m to equal ${E}[31m'b'${E}[0m\r\n${E}[?25h`;
  const out = readable(raw);
  ok('a failing run reads as plain text',
     out.text === "✓ two passed\n✗ one failed\n  expected 'a' to equal 'b'",
     JSON.stringify(out.text));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
