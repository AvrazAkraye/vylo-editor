// Knowing what is half-typed at a shell prompt.
//
// The whole design rests on one decision: count the keystrokes rather than read
// the screen, and stop the moment something happens that cannot be counted. A
// suggestion list that is sometimes about a different command is worse than no
// list, because it is one somebody presses Tab on — so most of this file is
// about when it gives up.
import {
  NOTHING, fragment, keystrokes, kindOf, rank, typed, worth,
} from '../.test-build/suggest.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** Type a string one chunk at a time, as a keyboard would. */
const type = (s, from = NOTHING) => [...s].reduce((st, c) => typed(st, c), from);

// ── counting what was typed ───────────────────────────────────────────────
ok('nothing typed is nothing', NOTHING.line === '' && NOTHING.sure === true);
ok('letters accumulate', type('git st').line === 'git st');
ok('and it stays sure', type('git st').sure === true);
ok('a whole chunk at once is the same as one at a time',
   typed(NOTHING, 'git status').line === type('git status').line);

ok('backspace removes one', type('lss\x7f').line === 'ls');
ok('the other backspace does too', type('lss\b').line === 'ls');
ok('backspace on an empty line is not an error', type('\x7f\x7f').line === '');
ok('Ctrl-U clears the line', type('git status\x15').line === '');
ok('Ctrl-W takes the last word', type('git status\x17').line === 'git ');
ok('and Ctrl-W over a trailing space takes the word before it',
   type('git status \x17').line === 'git ', type('git status \x17').line);

// Enter is the only thing that restores certainty, which is what makes the
// give-up cases safe.
ok('Enter starts a new line', type('ls\r').line === '');
ok('and so does a newline', type('ls\n').line === '');
ok('Ctrl-C abandons the line', type('rm -rf /\x03').line === '');
ok('and leaves it sure', type('rm -rf /\x03').sure === true);

// ── when it gives up ──────────────────────────────────────────────────────
// The up arrow recalls history, Tab runs the shell's own completion, Ctrl-R
// searches. None of it comes back through here.
ok('an arrow key gives up', type('ls\x1b[A').sure === false);
ok('any escape sequence does', type('ls\x1b').sure === false);
ok('Tab does, because the shell edits the line itself', type('ls sr\t').sure === false);
ok('Ctrl-R does', type('l\x12').sure === false);
ok('an unmodelled control character does', type('ls\x01').sure === false);
ok('and once unsure it stays unsure while typing continues',
   type('abc', type('ls\x1b[A')).sure === false);
// Enter is the way back.
ok('Enter makes it sure again', type('\r', type('ls\x1b[A')).sure === true);
ok('and the line is empty then', type('\r', type('ls\x1b[A')).line === '');
ok('a chunk after an escape is not counted either', (() => {
  const st = typed(NOTHING, 'ls\x1b[Agit');
  return st.sure === false;
})());

// ── the fragment being completed ──────────────────────────────────────────
ok('one word is the fragment', fragment('gi') === 'gi');
ok('the last word is', fragment('git che') === 'che');
// At a trailing space everything in the directory is a candidate.
ok('a trailing space starts an empty fragment', fragment('git ') === '');
ok('several spaces too', fragment('git   ') === '');
ok('an empty line has an empty fragment', fragment('') === '');
// A path with a space in it is one argument.
ok('a quoted space does not split the fragment',
   fragment('cat "my file') === 'my file', fragment('cat "my file'));
ok('single quotes too', fragment("cat 'my fi") === 'my fi');
ok('an escaped space does not split it',
   fragment('cat my\\ fi') === 'my fi', fragment('cat my\\ fi'));
ok('a closed quote still ends at the next space',
   fragment('cat "a b" c') === 'c', fragment('cat "a b" c'));

// ── programs or paths ─────────────────────────────────────────────────────
ok('the first word is a program', kindOf('gi') === 'command');
ok('an empty line wants a program', kindOf('') === 'command');
ok('the second word is a path', kindOf('cat RE') === 'path');
ok('and so is a trailing space after a program', kindOf('cat ') === 'path');
// The case a simpler rule gets wrong: offering filenames where only programs go.
ok('a word after a pipe is a program again', kindOf('cat x | gr') === 'command');
ok('after && too', kindOf('npm test && gi') === 'command');
ok('after a semicolon', kindOf('cd x; l') === 'command');
ok('and inside a subshell', kindOf('(l') === 'command');
ok('but an argument after all that is still a path',
   kindOf('cat a | grep RE') === 'path');

// ── ordering ──────────────────────────────────────────────────────────────
// This completes a shell, and a shell completes prefixes.
{
  const c = ['claude', 'clear', 'cmake', 'declare', 'Clang'];
  const r = rank(c, 'cl');
  ok('prefixes come first', r[0] === 'claude' && r[1] === 'clear', r);
  ok('a differently-cased prefix comes after the exact ones',
     r.indexOf('Clang') > r.indexOf('clear'), r);
  ok('and a match in the middle comes last', r[r.length - 1] === 'declare', r);
}
// Offering `ls` when `ls` is typed is a suggestion to press Tab and change
// nothing.
ok('a candidate equal to the fragment is dropped', !rank(['ls', 'lsof'], 'ls').includes('ls'));
ok('but a longer one is kept', rank(['ls', 'lsof'], 'ls').join() === 'lsof');
ok('an empty fragment offers everything', rank(['a', 'b'], '').length === 2);
ok('nothing matching is nothing', rank(['abc'], 'zzz').length === 0);
ok('duplicates are shown once', rank(['ls', 'ls', 'lsof'], 'l').join() === 'ls,lsof');
ok('the limit is respected', rank(['a1', 'a2', 'a3', 'a4'], 'a', 2).length === 2);
ok('empty candidates are skipped', rank(['', 'ab'], 'a').join() === 'ab');

// ── what gets sent ────────────────────────────────────────────────────────
// Appending the remainder is wrong the moment the match was case-insensitive:
// typing `app` and choosing `App.js` would leave `app.js`, a different file.
ok('the fragment is deleted and the whole word typed',
   keystrokes('app', 'App.js') === '\x7f\x7f\x7fApp.js');
ok('an empty fragment types the word alone', keystrokes('', 'README') === 'README');
ok('and the backspace is the one a terminal sends',
   keystrokes('a', 'b').startsWith('\x7f'));

// ── whether to show anything ──────────────────────────────────────────────
ok('nothing to show when unsure', worth({ line: 'l', sure: false }, ['ls']) === false);
ok('nor with no matches', worth({ line: 'l', sure: true }, []) === false);
ok('nor on an empty line', worth({ line: '   ', sure: true }, ['ls']) === false);
ok('but yes with a line and matches', worth({ line: 'l', sure: true }, ['ls']) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
