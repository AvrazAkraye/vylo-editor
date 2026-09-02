// Asking for a shell command in words.
//
// The parser is the whole risk here: everything it calls a command is put in
// front of somebody with a Run button under it. So the tests are mostly about
// what it refuses to call a command, and about the `#` reply being inert by
// construction rather than merely handled.
import {
  CONTEXT_LINES, MAX_COMMAND_CHARS, MAX_COMMAND_LINES, SYSTEM,
  ask, lastLines, parse, reason,
} from '../.test-build/command.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the ordinary answer ───────────────────────────────────────────────────
ok('a bare command is a command', (() => {
  const r = parse('git log --oneline -10');
  return r.kind === 'command' && r.text === 'git log --oneline -10';
})());
ok('surrounding whitespace goes', parse('  ls -la  \n').text === 'ls -la');
ok('a multi-line command survives, because real ones are',
   parse('for f in *.ts; do\n  echo "$f"\ndone').kind === 'command');
ok('and keeps every line',
   parse('a\nb\nc').text === 'a\nb\nc');

// ── fences ────────────────────────────────────────────────────────────────
// A model told not to use fences occasionally uses them anyway, and the fence
// is then the most reliable signal of where the command is.
ok('a fenced block is unwrapped', parse('```sh\nnpm test\n```').text === 'npm test');
ok('with no language too', parse('```\nnpm test\n```').text === 'npm test');
ok('prose around a fence is discarded in favour of the fence',
   parse('Here you go:\n```bash\nrm -rf build\n```\nHope that helps.').text === 'rm -rf build');
ok('an unterminated fence still yields its first line',
   parse('```sh\nnpm run build').text === 'npm run build');
ok('a fence containing several lines keeps them',
   parse('```\ncd app\nnpm test\n```').text === 'cd app\nnpm test');

// ── the inert reply ───────────────────────────────────────────────────────
// `#` starts a comment in every shell this app runs, so a note that somehow
// reached a prompt would do nothing. Inert by construction beats checked-for.
{
  const r = parse('# That is a question, not a command.');
  ok('a hash line is a note, never a command', r.kind === 'note');
  ok('and the hash is not shown to the reader', r.text === 'That is a question, not a command.');
}
ok('several hash lines all lose their hashes',
   parse('# one\n# two').text === 'one\ntwo');
ok('a hash with no space still parses', parse('#nope').text === 'nope');
ok('a command that merely contains a hash is still a command',
   parse('grep "#define" src/a.c').kind === 'command');

// ── what it refuses to call a command ─────────────────────────────────────
// A reply too long to be a command somebody asked for is not one.
ok('a wall of text is a note, not a command', (() => {
  const r = parse(Array.from({ length: MAX_COMMAND_LINES + 3 }, (_, i) => `line ${i}`).join('\n'));
  return r.kind === 'note';
})());
ok('and so is one enormous line', (() => {
  const r = parse('echo ' + 'x'.repeat(MAX_COMMAND_CHARS + 10));
  return r.kind === 'note';
})());
ok('exactly at the line cap is still a command', (() => {
  const r = parse(Array.from({ length: MAX_COMMAND_LINES }, (_, i) => `echo ${i}`).join('\n'));
  return r.kind === 'command';
})());
ok('nothing at all is nothing', parse('') === null && parse('   \n ') === null);
ok('a missing reply does not throw', parse(undefined) === null && parse(null) === null);
ok('an empty fence is nothing', parse('```\n\n```') === null);

// A model that copies the prompt character along with the command.
ok('a leading $ is stripped', parse('$ npm test').text === 'npm test');
ok('and a leading >', parse('> npm test').text === 'npm test');
ok('but a redirect is not a prompt', parse('echo hi > out.txt').text === 'echo hi > out.txt');

// ── the message sent ──────────────────────────────────────────────────────
{
  const m = ask({
    question: 'find every ts file over 100k',
    environment: 'macOS, zsh',
    cwd: '/work/app',
    output: 'ls: no such file\n',
  });
  ok('the environment is included', m.includes('macOS, zsh'));
  ok('the directory is named', m.includes('/work/app'));
  ok('the question is labelled as the request', m.includes('Request: find every ts file over 100k'));
  ok('output is included, and labelled as context only',
     m.includes('ls: no such file') && m.includes('context only'));
  // An error above a question reads as "explain this", which is a different
  // request from the one that was made.
  ok('and comes after the question, not before it',
     m.indexOf('Request:') < m.indexOf('ls: no such file'));
}
ok('an ask with nothing but a question still works', (() => {
  const m = ask({ question: 'list files' });
  return m.trim() === 'Request: list files';
})(), ask({ question: 'list files' }));
ok('blank context is left out entirely', (() => {
  const m = ask({ question: 'x', environment: '  ', cwd: '', output: '\n\n' });
  return m.trim() === 'Request: x';
})(), ask({ question: 'x', environment: '  ', cwd: '', output: '\n\n' }));

// ── the output tail ───────────────────────────────────────────────────────
ok('the last lines are taken, not the first', (() => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
  const tail = lastLines(text, 3);
  return tail === 'line 97\nline 98\nline 99';
})(), lastLines(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n'), 3));
ok('trailing blank lines do not eat the budget', (() => {
  const text = 'real one\nreal two\n\n\n\n';
  return lastLines(text, 2) === 'real one\nreal two';
})(), lastLines('real one\nreal two\n\n\n\n', 2));
ok('carriage returns are dropped, because a pty writes them',
   lastLines('a\r\nb\r\n', 5) === 'a\nb');
ok('less output than asked for is all of it', lastLines('one', 40) === 'one');
ok('no output is no output', lastLines('', 40) === '' && lastLines('\n\n', 40) === '');
ok('the context budget is a real number', CONTEXT_LINES > 0 && CONTEXT_LINES <= 200);

// ── the dialog's "why" ────────────────────────────────────────────────────
// The person's own words beside what they are being offered, which is the only
// way to notice an answer to a different question.
ok('the reason is the question', reason('  undo   my last commit ') === 'undo my last commit');
ok('and a long one is cut', reason('x'.repeat(300)).length === 120);
ok('with an ellipsis, so it reads as cut', reason('x'.repeat(300)).endsWith('…'));

// ── the prompt says the things it has to ──────────────────────────────────
ok('the prompt forbids commentary', /no explanation/i.test(SYSTEM));
ok('and fences', /fence/i.test(SYSTEM));
ok('and describes the # reply, or nothing would ever produce one', SYSTEM.includes('# '));
// The reply is run verbatim after approval, so the prompt has to say so.
ok('and says the reply is run verbatim', /verbatim/i.test(SYSTEM));
ok('and warns off destructive answers', /deletes|force-push|rewrites history/i.test(SYSTEM));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
