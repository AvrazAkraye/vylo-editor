// Knowing what is half-typed at a shell prompt.
//
// The whole design rests on one decision: count the keystrokes rather than read
// the screen, and stop the moment something happens that cannot be counted. A
// suggestion list that is sometimes about a different command is worse than no
// list, because it is one somebody presses Tab on — so most of this file is
// about when it gives up.
import {
  HISTORY_MAX, NOTHING, fragment, keystrokes, kindOf, preview, rank, remember,
  quotePath, suggest, typed, typedPart, wantsDir, worth,
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
const word = (text) => ({ text, kind: 'path' });
ok('the fragment is deleted and the whole word typed',
   keystrokes({ line: 'cat app', sure: true }, word('App.js')) === '\x7f\x7f\x7fApp.js');
ok('an empty fragment types the word alone',
   keystrokes({ line: 'cat ', sure: true }, word('README')) === 'README');
ok('and the backspace is the one a terminal sends',
   keystrokes({ line: 'a', sure: true }, word('b')).startsWith('\x7f'));
// A line out of history replaces the WHOLE line — that is what finishing
// `claude` into `claude --dangerously-skip-permissions` means.
ok('a history line deletes everything typed, not just the last word', (() => {
  const k = keystrokes({ line: 'git com', sure: true }, { text: 'git commit -m "x"', kind: 'history' });
  return k === '\x7f'.repeat(7) + 'git commit -m "x"';
})(), keystrokes({ line: 'git com', sure: true }, { text: 'git commit -m "x"', kind: 'history' }));

// ── whether to show anything ──────────────────────────────────────────────
ok('nothing to show when unsure', worth({ line: 'l', sure: false }, ['ls']) === false);
ok('nor with no matches', worth({ line: 'l', sure: true }, []) === false);
ok('nor on an empty line', worth({ line: '   ', sure: true }, ['ls']) === false);
ok('but yes with a line and matches', worth({ line: 'l', sure: true }, ['ls']) === true);

// ── history ──────────────────────────────────────────────────────────────
ok('a line is remembered', remember([], 'npm test').join() === 'npm test');
ok('most recent last', remember(['a'], 'b').join() === 'a,b');
// A command run ten times should appear once, and as the most recent.
ok('running it again moves it to the front rather than repeating it',
   remember(['a', 'b'], 'a').join() === 'b,a');
ok('blank lines are not history', remember(['a'], '   ').join() === 'a');
ok('surrounding space is trimmed', remember([], '  ls -la  ').join() === 'ls -la');
ok('remembering does not mutate', (() => {
  const h = ['a'];
  remember(h, 'b');
  return h.length === 1;
})());
// An unbounded array in a terminal left open for a week is a leak.
ok('history is capped, keeping the newest', (() => {
  let h = [];
  for (let i = 0; i < HISTORY_MAX + 40; i++) h = remember(h, `cmd${i}`);
  return h.length === HISTORY_MAX && h[h.length - 1] === `cmd${HISTORY_MAX + 39}`;
})());

// ── what gets offered ────────────────────────────────────────────────────
{
  const history = ['npm test', 'claude --dangerously-skip-permissions', 'git status'];
  const commands = ['claude', 'clang', 'clear'];

  // The reported case: having run it once, typing `claude` offers it back.
  const s1 = suggest('claude', { history, commands });
  ok('a past line leads the list',
     s1[0].kind === 'history' && s1[0].text === 'claude --dangerously-skip-permissions', s1);
  ok('and programs on PATH follow it', (() => {
    const s2 = suggest('cl', { history, commands });
    return s2[0].kind === 'history' && s2.some((x) => x.kind === 'command' && x.text === 'clang');
  })(), suggest('cl', { history, commands }));
  ok('a partial first word finds it too',
     suggest('cla', { history, commands })[0].text === 'claude --dangerously-skip-permissions');
  ok('the line already typed is not offered back',
     !suggest('npm test', { history, commands }).some((x) => x.text === 'npm test'));
  ok('most recent history first', (() => {
    const h = ['git a', 'git b'];
    return suggest('git', { history: h }).map((x) => x.text).join() === 'git b,git a';
  })());
}
// ── history, mid-line ────────────────────────────────────────────────────
//
// This used to stop at the first word, on the grounds that offering a past
// command mid-argument would replace the argument being written. It cannot: a
// candidate has to start with everything typed, so taking one only ever adds
// characters. The limit was guarding against a looser match than this makes,
// and it cost the case the feature is most wanted for.
ok('a past line is offered from the middle of it', (() => {
  const s2 = suggest('claude --dang', {
    history: ['claude --dangerously-skip-permissions'], paths: [],
  });
  return s2[0]?.kind === 'history' && s2[0].text === 'claude --dangerously-skip-permissions';
})(), suggest('claude --dang', { history: ['claude --dangerously-skip-permissions'] }));
ok('however deep into the line the caret is', (() => {
  const h = ['docker compose up --build --detach'];
  return suggest('docker compose up --bu', { history: h })[0]?.text === h[0];
})());
ok('and every character already typed survives taking it', (() => {
  const line = 'cat READ';
  const s2 = suggest(line, { history: ['cat README.md && npm test'], paths: ['README.md'] });
  return s2[0].kind === 'history' && s2[0].text.startsWith(line);
})());
ok('a past line that diverges from what is typed is not offered', (() => {
  const s2 = suggest('cat X', { history: ['cat README.md'], paths: [] });
  return s2.every((x) => x.kind !== 'history');
})());
// The list is ordered by likelihood; the arrow keys are how you disagree.
ok('the path is still there, under the line that leads', (() => {
  const s2 = suggest('cat READ', { history: ['cat README.md && npm test'], paths: ['README.md'] });
  return s2.some((x) => x.kind === 'path' && x.text === 'README.md');
})(), suggest('cat READ', { history: ['cat README.md && npm test'], paths: ['README.md'] }));
ok('and with no history it leads on its own', (() => {
  const s2 = suggest('cat READ', { history: [], paths: ['README.md'] });
  return s2[0].kind === 'path' && s2[0].text === 'README.md';
})());
// Without the guard an empty line ranks with an empty fragment, which matches
// every binary on PATH — two thousand programs offered for no keystrokes.
ok('an empty line offers nothing at all', suggest('', { history: ['ls'], commands: ['ls'] }).length === 0);
ok('and neither does whitespace', suggest('   ', { commands: ['ls'] }).length === 0);
ok('the limit is honoured', (() => {
  const many = Array.from({ length: 40 }, (_, i) => `run${i}`);
  return suggest('run', { history: many }, 5).length === 5;
})());
ok('a source that is missing entirely does not throw', suggest('x', {}).length === 0);

// ── how much of a suggestion is already typed ─────────────────────────────
ok('a word suggestion bolds the fragment',
   typedPart('cat app', { text: 'App.js', kind: 'path' }) === 3);
ok('a history suggestion bolds the whole line',
   typedPart('  claude', { text: 'claude --x', kind: 'history' }) === 6);

// ── a dropped path, as it should be typed ────────────────────────────────
// A quoted path is harder to read and to edit, so an ordinary one is bare.
ok('an ordinary path is left alone', quotePath('/Users/you/app/App.js') === '/Users/you/app/App.js');
ok('so are the punctuation characters a path really uses',
   quotePath('/a/b-c_d.e+f@g%h,i:j') === '/a/b-c_d.e+f@g%h,i:j');
ok('a space is quoted', quotePath('/a/my file.png') === "'/a/my file.png'");
// A folder called `$(whoami)` is a legal folder, and pasting it unquoted at a
// prompt is a command waiting for an Enter the person will assume is theirs.
ok('a substitution is quoted, not executed', quotePath('/a/$(whoami)') === "'/a/$(whoami)'");
ok('a backtick too', quotePath('/a/`id`') === "'/a/`id`'");
ok('a semicolon too', quotePath('/a/x;rm -rf y') === "'/a/x;rm -rf y'");
ok('a glob too', quotePath('/a/*.png') === "'/a/*.png'");
ok('a tilde too', quotePath('~/secret') === "'~/secret'");
// The one character a single-quoted string cannot contain.
ok('a single quote closes, escapes and reopens', (() => {
  const q = quotePath("/a/it's here.png");
  return q === `'/a/it'\\''s here.png'`;
})(), quotePath("/a/it's here.png"));
ok('an empty path is an empty argument, not nothing', quotePath('') === "''");

// ── what only takes a directory ───────────────────────────────────────────
//
// `cd README.md` is not a near miss worth completing: it is an error the shell
// will refuse, so offering it is the list putting a wrong answer under the
// cursor. Three commands, named literally — guessing from the name would be
// wrong for `mkdir`, whose argument is a folder that does not exist yet and
// for which a list of existing ones is the least useful thing on offer.

ok('cd wants a directory', wantsDir('cd sr'));
ok('and so does pushd', wantsDir('pushd '));
ok('and rmdir', wantsDir('rmdir old'));
ok('ls does not — it takes files, and mostly is given them', !wantsDir('ls sr'));
ok('mkdir does not, because its argument does not exist yet', !wantsDir('mkdir new'));
ok('the command word itself is never a directory, however it is spelled',
   !wantsDir('cd') && !wantsDir('c'));
// `ls /tmp && cd sr` completes for `cd`, not for `ls`.
ok('the governing command is the current one, not the first on the line',
   wantsDir('ls /tmp && cd sr'), 'ls /tmp && cd sr');
ok('after a pipe too', wantsDir('cat x | pushd '));
ok('and a command after a separator does not inherit the last one',
   !wantsDir('cd /tmp && ls sr'), 'cd /tmp && ls sr');
ok('a path already deep in still belongs to its command', wantsDir('cd ~/Doc'));
ok('an argument that is not the first still belongs to it', !wantsDir('cp a b'));

// ── the dim text ahead of the cursor ──────────────────────────────────────
//
// The ghost and the keystrokes are one action described twice, and the way two
// descriptions of one action stop agreeing is by being worked out separately.
// So the test is not "preview looks right" — it is that typing the keystrokes
// produces exactly the previewed line.

/** What the line becomes once the keystrokes land, backspaces and all. */
const applied = (line, choice) => {
  let out = line;
  for (const c of keystrokes({ line, sure: true }, choice)) {
    if (c === '\x7f') out = out.slice(0, -1);
    else out += c;
  }
  return out;
};
for (const [line, choice] of [
  ['cd sr', { text: 'src/', kind: 'path' }],
  ['cd ', { text: 'src/', kind: 'path' }],
  ['l', { text: 'ls', kind: 'command' }],
  ['git', { text: 'git commit --amend', kind: 'history' }],
  ['cat src/ma', { text: 'src/main.rs', kind: 'path' }],
  ['app', { text: 'App.js', kind: 'path' }],
  ['  ls sr', { text: 'src/', kind: 'path' }],
]) {
  ok(`preview matches the keystrokes: ${JSON.stringify(line)} -> ${choice.text}`,
     preview(line, choice) === applied(line, choice),
     [preview(line, choice), applied(line, choice)]);
}
ok('a path completion keeps what came before it on the line',
   preview('cat src/ma', { text: 'src/main.rs', kind: 'path' }) === 'cat src/main.rs');
ok('a history line replaces the whole line, leading spaces and all',
   preview('  git', { text: 'git push', kind: 'history' }) === 'git push');
// Case-insensitive matching can rewrite what was typed, and the ghost has to
// admit it rather than claim characters are staying that are not.
ok('a completion that rewrites the typed characters does not start with them',
   preview('app', { text: 'App.js', kind: 'path' }).startsWith('app') === false);
ok('while one that only adds to them does',
   preview('App', { text: 'App.js', kind: 'path' }).startsWith('App'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
