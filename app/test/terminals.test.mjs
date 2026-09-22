// The terminal session list.
//
// The state is the part worth testing hardest: it decides whether a row shows a
// tick or a warning, and reporting a crashed command as finished-cleanly is the
// one mistake here that would matter.
import { stateOf, titleOf, since, matches, filter, shorten, ROW_VIEW, ROW_VIEW_KEY, readView, writeView, rowOf, programOf, markOf } from '../.test-build/terminals.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const shell = (n, over = {}) => ({ id: `t${n}`, n, born: 0, dead: false, ...over });
const cmd = (n, command, over = {}) => ({ id: `t${n}`, n, born: 0, dead: false, command, ...over });

// ── state ─────────────────────────────────────────────────────────────────
ok('an open shell is live', stateOf(shell(1)) === 'live');
ok('a command still going is busy', stateOf(cmd(1, 'npm test')) === 'busy');
ok('a command that exited 0 is ok', stateOf(cmd(1, 'npm test', { dead: true, code: 0 })) === 'ok');
ok('a non-zero exit is a failure', stateOf(cmd(1, 'npm test', { dead: true, code: 1 })) === 'failed');
// A signal is not a clean finish, and neither is a code nobody recorded.
ok('killed by a signal is a failure, not a tick',
   stateOf(cmd(1, 'sleep 99', { dead: true, code: null })) === 'failed');
ok('and a finished pane with no code recorded is a failure, not a tick',
   stateOf(cmd(1, 'x', { dead: true })) === 'failed');
ok('a closed shell is reported the same way', stateOf(shell(1, { dead: true, code: 0 })) === 'ok');

// ── titles ────────────────────────────────────────────────────────────────
{
  const t = titleOf(shell(3));
  ok('a shell is named by its number', t.text === 'Terminal 3');
  ok('and is not set as a string that ran', t.mono === false);
}
{
  const t = titleOf(cmd(1, 'cargo test --quiet'));
  ok('a command pane is named by its command', t.text === 'cargo test --quiet');
  ok('and is set in the mono face, because it is a string that ran', t.mono === true);
}
ok('the word Terminal is translatable', titleOf(shell(2), 'تێرمینال').text === 'تێرمینال 2');

// ── a name somebody typed ─────────────────────────────────────────────────
{
  ok('a typed name wins over the default', titleOf(shell(3, { name: 'scratch' })).text === 'scratch');
  // A renamed command pane is still running that command; the words somebody
  // chose are prose, not a string that ran.
  const t = titleOf(cmd(1, 'npm test', { name: 'the failing one' }));
  ok('and over the command', t.text === 'the failing one');
  ok('and is set as prose, not as code', t.mono === false);
  ok('an empty name falls back rather than showing nothing',
     titleOf(shell(4, { name: '   ' })).text === 'Terminal 4');
  ok('the command survives a rename, so it is not lost',
     cmd(1, 'npm test', { name: 'x' }).command === 'npm test');
}
{
  const list = [shell(1), cmd(2, 'npm test', { name: 'watcher' })];
  ok('a renamed pane is found by its new name', filter(list, 'watcher').length === 1);
  // The command is still what it runs, and people search for what they ran.
  ok('and still by the command it is running', filter(list, 'npm').length === 1);
  // Not by a terminal number: this pane was born running a command and was
  // never labelled `Terminal 2`, so nobody has ever seen that name for it.
  // This assertion said the opposite when it was first written, which is what
  // sent the matcher looking for a number no pane of this kind ever had.
  ok('but not by a terminal number it was never shown under',
     filter(list, 'Terminal 2').length === 0);
}
{
  // A command pane was never called `Terminal 2`, and a first attempt at the
  // rule above matched the number unconditionally, so every command pane
  // answered to every terminal number.
  const list = [shell(1), cmd(2, 'npm test')];
  ok('a command pane does not answer to a terminal number it never had',
     filter(list, 'Terminal 2').length === 0, filter(list, 'Terminal 2').map((x) => x.command ?? x.n));
  ok('and the shell that does still answers to its own',
     filter(list, 'Terminal 1').length === 1);
}

// ── age ───────────────────────────────────────────────────────────────────
// The identity translator: English is the key, so this is what `since` returns
// with no translation, which is what the assertions below were written against.
const en = (s) => s;
ok('seconds, under a minute', since(0, 41_000, en) === '41s');
ok('just opened reads as zero rather than blank', since(0, 200, en) === '0s');
ok('minutes, over one', since(0, 61_000, en) === '1m' && since(0, 59 * 60_000, en) === '59m');
ok('hours, over sixty minutes', since(0, 60 * 60_000, en) === '1h');
ok('days, over a day', since(0, 25 * 3600_000, en) === '1d');
// And a translated one moves the unit rather than having it stuck on the end.
ok('the unit is the translated part', since(0, 61_000, (s) => s.replace('{n}m', 'د {n}')) === 'د 1');
// Clocks move backwards — a laptop waking, an NTP correction — and a negative
// age would render as "-3s" on a row that is fine.
ok('a clock that went backwards does not render a negative age', since(5000, 0, en) === '0s');

// ── filtering ─────────────────────────────────────────────────────────────
{
  const list = [shell(1), shell(2), cmd(3, 'npm test'), cmd(4, 'cargo build --release')];
  ok('an empty query keeps everything, because a list that empties looks broken',
     filter(list, '').length === 4 && filter(list, '   ').length === 4);
  ok('the same array comes back untouched when nothing was typed', filter(list, '') === list);
  ok('a command matches on its own text', filter(list, 'cargo').length === 1);
  ok('matching is case-folded', filter(list, 'CARGO').length === 1);
  ok('a partial word matches', filter(list, 'rele').length === 1);
  ok('a shell matches on its name', filter(list, 'Terminal 2').length === 1);
  ok('the number alone matches its shell', filter(list, '2').length === 1);
  ok('nothing matching is empty rather than everything', filter(list, 'zzz').length === 0);
  ok('a query is trimmed before it is used', filter(list, '  cargo  ').length === 1);
}
ok('a translated Terminal is what gets searched',
   filter([shell(1)], 'تێرمینال', 'تێرمینال').length === 1);

// ── the path under a terminal ─────────────────────────────────────────────
//
// A path is read from the right: the folder you are in is the last segment,
// and the ones before it matter less the further away they are. Truncating the
// end would leave `/Users/you/wo…`, which answers a question nobody asked.
ok('a short path is left alone', shorten('/a/b', '') === '/a/b');
ok('exactly at the limit is left alone', shorten('/a/b/c', '') === '/a/b/c');
ok('a long one loses its front, not its end',
   shorten('/Users/you/work/apps/vylo/src', '') === '…/apps/vylo/src',
   shorten('/Users/you/work/apps/vylo/src', ''));
ok('so the folder you are in always survives',
   shorten('/a/b/c/d/e/f/g', '').endsWith('/g'));

// `~`, as every shell prompt writes it.
ok('the home directory becomes a tilde',
   shorten('/Users/you/work', '/Users/you') === '~/work');
ok('home itself is just the tilde', shorten('/Users/you', '/Users/you') === '~');
ok('and a deep path under home still shortens',
   shorten('/Users/you/a/b/c/d', '/Users/you') === '…/b/c/d',
   shorten('/Users/you/a/b/c/d', '/Users/you'));
// `/Users/youxp` must not be read as `/Users/you` plus `xp`.
ok('a directory that merely starts like home is not home',
   shorten('/Users/youxp/w', '/Users/you') === '/Users/youxp/w',
   shorten('/Users/youxp/w', '/Users/you'));
ok('no home given changes nothing', shorten('/Users/you/w', '') === '/Users/you/w');

ok('a relative path keeps its shape', shorten('a/b', '') === 'a/b');
ok('nothing is nothing', shorten('', '') === '' && shorten('   ', '') === '');
ok('a missing path does not throw', shorten(undefined, '') === '' && shorten(null, '') === '');
ok('the root is the root', shorten('/', '') === '/');
ok('a repeated slash does not become an empty segment',
   shorten('/a//b', '') === '/a/b', shorten('/a//b', ''));

// ── what a row says ───────────────────────────────────────────────────────
//
// A list of six shells titled "Terminal 1" through "Terminal 6" tells you
// nothing you did not already know. These tests are about the row saying the
// thing that tells one pane from another.
const sh = (over = {}) => ({ id: 'a', n: 1, born: 0, dead: false, ...over });
const NOW = 60_000;

ok('the stored view round-trips', (() => {
  const v = { titleAs: 'branch', meta: { branch: false, cwd: true, state: false }, density: 'compact' };
  const back = readView(writeView(v));
  return back.titleAs === 'branch' && back.density === 'compact' && back.meta.cwd === true;
})());
ok('nothing stored is the default', readView(null).titleAs === ROW_VIEW.titleAs);
ok('corrupt JSON is the default', readView('{{{').density === 'comfortable');
ok('an unknown title choice is ignored', readView('{"titleAs":"phase"}').titleAs === ROW_VIEW.titleAs);
ok('a non-boolean meta flag is ignored', readView('{"meta":{"branch":"yes"}}').meta.branch === ROW_VIEW.meta.branch);
ok('and one real field is kept while another is junk', (() => {
  const v = readView('{"density":"compact","titleAs":42}');
  return v.density === 'compact' && v.titleAs === ROW_VIEW.titleAs;
})());
ok('the key is versioned', /\.v\d+$/.test(ROW_VIEW_KEY));
ok('reading does not share the default meta object', (() => {
  const a = readView('{"meta":{"cwd":true}}');
  return a.meta.cwd === true && ROW_VIEW.meta.cwd === false;
})());

// ── the title ─────────────────────────────────────────────────────────────
{
  const facts = { cwd: '/Users/you/work/vylo', branch: 'main', last: 'npm test' };
  const V = (over = {}) => ({ ...ROW_VIEW, ...over, meta: { ...ROW_VIEW.meta, ...(over.meta ?? {}) } });

  ok('by command, it is the last thing run', rowOf(sh(), facts, V(), { now: NOW }).title === 'npm test');
  ok('and set in the mono face, because it is a string that ran',
     rowOf(sh(), facts, V(), { now: NOW }).mono === true);
  // The folder's own name is what a person calls the directory they are in.
  ok('by folder, it is the folder name and not the whole path',
     rowOf(sh(), facts, V({ titleAs: 'cwd' }), { now: NOW }).title === 'vylo');
  ok('and that is prose, not a command',
     rowOf(sh(), facts, V({ titleAs: 'cwd' }), { now: NOW }).mono === false);
  ok('by branch, it is the branch', rowOf(sh(), facts, V({ titleAs: 'branch' }), { now: NOW }).title === 'main');
  ok('home itself reads as ~',
     rowOf(sh(), { cwd: '/Users/you' }, V({ titleAs: 'cwd' }), { home: '/Users/you', now: NOW }).title === '~');
}
// A row with no title is a row you cannot click on purpose.
ok('a pane that has run nothing falls through to what it has', (() => {
  const r = rowOf(sh(), { cwd: '/a/b', branch: 'main' }, ROW_VIEW, { now: NOW });
  return r.title === 'b';
})(), rowOf(sh(), { cwd: '/a/b', branch: 'main' }, ROW_VIEW, { now: NOW }));
ok('and one outside a repository falls through past branch', (() => {
  const view = { ...ROW_VIEW, titleAs: 'branch' };
  return rowOf(sh(), { cwd: '/a/b' }, view, { now: NOW }).title === 'b';
})());
ok('a pane with nothing at all keeps its number',
   rowOf(sh({ n: 3 }), {}, ROW_VIEW, { now: NOW }).title === 'Terminal 3');
// Somebody who renamed a pane meant those words.
ok('a typed name wins over every choice', (() => {
  const named = sh({ name: 'build watcher' });
  return ['command', 'cwd', 'branch'].every((titleAs) =>
    rowOf(named, { cwd: '/a/b', branch: 'main', last: 'x' }, { ...ROW_VIEW, titleAs }, { now: NOW }).title === 'build watcher');
})());
ok('and reads as prose', rowOf(sh({ name: 'x' }), { last: 'ls' }, ROW_VIEW, { now: NOW }).mono === false);
// A command pane exists to run one command; that is its title.
ok('a command pane is titled by its command',
   rowOf(sh({ command: 'npm run build' }), { last: 'other' }, ROW_VIEW, { now: NOW }).title === 'npm run build');

// ── the second line ───────────────────────────────────────────────────────
{
  const facts = { cwd: '/Users/you/work/vylo', branch: 'main', last: 'npm test' };
  const kinds = (v) => rowOf(sh(), facts, v, { now: NOW }).subs.map((x) => x.kind).join();
  ok('the default shows the state, the branch and the age',
     kinds(ROW_VIEW) === 'state,branch,age', kinds(ROW_VIEW));
  ok('the folder can be added', (() => {
    const v = { ...ROW_VIEW, meta: { ...ROW_VIEW.meta, cwd: true } };
    return kinds(v) === 'state,branch,cwd,age';
  })());
  ok('and everything can be turned off but the age', (() => {
    const v = { ...ROW_VIEW, meta: { branch: false, cwd: false, state: false } };
    return kinds(v) === 'age';
  })());
  ok('the folder is shortened, not printed whole', (() => {
    const v = { ...ROW_VIEW, meta: { ...ROW_VIEW.meta, cwd: true } };
    const sub = rowOf(sh(), facts, v, { now: NOW, home: '/Users/you' }).subs.find((x) => x.kind === 'cwd');
    return sub.text.length < facts.cwd.length;
  })());
  // Saying "main" twice on one row is one of them wasted.
  ok('the branch is not repeated as metadata when it is the title', (() => {
    const v = { ...ROW_VIEW, titleAs: 'branch' };
    return !rowOf(sh(), facts, v, { now: NOW }).subs.some((x) => x.kind === 'branch');
  })());
  ok('but a renamed pane still shows its branch below', (() => {
    const v = { ...ROW_VIEW, titleAs: 'branch' };
    return rowOf(sh({ name: 'main' }), facts, v, { now: NOW }).subs.some((x) => x.kind === 'branch');
  })());
  ok('nothing known means nothing but the state and the age',
     rowOf(sh(), {}, ROW_VIEW, { now: NOW }).subs.map((x) => x.kind).join() === 'state,age');
  ok('the state reads as words', rowOf(sh(), {}, ROW_VIEW, { now: NOW }).subs[0].text === 'shell');
  ok('a dead pane says its exit code',
     rowOf(sh({ dead: true, code: 1 }), {}, ROW_VIEW, { now: NOW }).subs[0].text === 'exit 1');
  ok('no clock given means no age', rowOf(sh(), {}, ROW_VIEW, {}).subs.every((x) => x.kind !== 'age'));
}

// ── how the sessions are laid out ─────────────────────────────────────────
//
// A view, not a mode: the sessions, their scrollback and their processes are
// the same either way, so the only thing that has to survive is the choice.
ok('a new window shows panes, which is what this panel was built to do',
   ROW_VIEW.as === 'panes');
ok('the choice survives a save and a load',
   readView(JSON.stringify({ ...ROW_VIEW, as: 'tabs' })).as === 'tabs');
ok('and panes comes back as panes',
   readView(JSON.stringify({ ...ROW_VIEW, as: 'panes' })).as === 'panes');
// A stored value is input, not memory — it can be hand-edited or left behind
// by a build that spelled it differently.
ok('a layout this build has never heard of is the default',
   readView(JSON.stringify({ as: 'carousel' })).as === 'panes');
ok('and so is one that is not a string', readView('{"as":3}').as === 'panes');
ok('nothing stored at all is the default', readView(null).as === 'panes');
ok('a stored layout does not disturb the rest of the view', (() => {
  const v = readView(JSON.stringify({ ...ROW_VIEW, as: 'tabs' }));
  return v.titleAs === ROW_VIEW.titleAs && v.density === ROW_VIEW.density
      && v.meta.state === ROW_VIEW.meta.state;
})());

// ── what is running in there ──────────────────────────────────────────────
// Fourteen rows all wearing a terminal glyph is fourteen rows that look the
// same. The picture is what is *running*, which is read from the last command
// the pane was given — the panel has no process table, only what was typed.
ok('a bare program is itself', programOf('claude') === 'claude');
ok('arguments are not the program', programOf('claude --resume') === 'claude');
ok('and neither is its path', programOf('/opt/homebrew/bin/claude') === 'claude');
ok('a Windows path either', programOf('C:\\tools\\claude.exe') === 'claude.exe');
ok('case does not matter', programOf('CLAUDE') === 'claude');
ok('nothing is nothing', programOf('') === '' && programOf('   ') === '');
ok('and a non-string is not a crash',
   [null, undefined, 42, {}].every((x) => programOf(x) === ''));

// The last segment of a chain, because that is what is running by the time
// anybody looks at the row.
ok('a chain runs its last part', programOf('cd api && claude') === 'claude');
ok('so does a semicolon', programOf('nvm use 20; claude') === 'claude');
ok('and an or', programOf('claude || bash') === 'bash');
ok('a pipe ends at the far end', programOf('cat log | claude') === 'claude');
ok('and the first part is not the answer', programOf('claude && npm test') !== 'claude');

// Environment assignments come before the program and are not it.
ok('one assignment is stepped over', programOf('FOO=bar claude') === 'claude');
ok('several are', programOf('A=1 B=2 C=3 claude') === 'claude');
ok('but a bare word that merely contains = is not one', programOf('./x=y') === 'x=y');

// Launchers take the real program as their first argument.
ok('sudo is not a program', programOf('sudo claude') === 'claude');
ok('nor is npx', programOf('npx claude') === 'claude');
ok('nor env', programOf('env claude') === 'claude');
ok('and two of them stack', programOf('sudo env claude') === 'claude');
// Bounded, so `sudo sudo sudo …` cannot run away.
ok('a pile of launchers still ends', typeof programOf('sudo '.repeat(50) + 'claude') === 'string');
ok('a launcher on its own is itself', programOf('sudo') === '');

ok('quotes come off', programOf('"claude"') === 'claude' && programOf("'claude'") === 'claude');

// ── which mark the row draws ──────────────────────────────────────────────
const said = (last) => markOf(shell(1), { last });
ok('a pane that has run claude says so', said('claude') === 'claude');
ok('with arguments too', said('claude --continue') === 'claude');
ok('after a cd as well', said('cd ~/work && claude') === 'claude');
ok('claude-code counts', said('claude-code') === 'claude');
ok('a pane running something else is a terminal', said('npm test') === 'terminal');
ok('and one that has run nothing is a terminal', said(undefined) === 'terminal' && said('') === 'terminal');
// Something that merely mentions it is not it: `git commit -m 'claude'` is git.
ok('a mention is not a program', said("git commit -m 'claude fixed it'") === 'terminal');
ok('and neither is a path that contains the word', said('ls ~/claude') === 'terminal');
// A command pane exists to run one thing and that thing is known exactly.
ok('a command pane is read from its command',
   markOf(shell(1, { command: 'claude -p "hello"' }), {}) === 'claude');
ok('and the command wins over the history',
   markOf(shell(1, { command: 'npm test' }), { last: 'claude' }) === 'terminal');
// What it was running has exited.
ok('a dead pane is a terminal whatever it ran',
   markOf(shell(1, { dead: true, code: 0 }), { last: 'claude' }) === 'terminal');
ok('even one that failed',
   markOf(shell(1, { dead: true, code: 1 }), { last: 'claude' }) === 'terminal');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
