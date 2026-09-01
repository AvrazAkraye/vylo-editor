// The project to-do list.
//
// The file belongs to a person. It will have headings, blank lines, paragraphs
// between groups and indentation nobody here chose — so the property that
// matters most is that editing one step leaves every other byte alone. A module
// that reformats somebody's file to tick a box is one they stop using.
import {
  parse, kindOf, payload, toggle, edit, remove, add, progress, STARTER,
} from '../.test-build/todo.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// A file with everything a real one has in it.
const REAL = `# Sprint

Some prose that explains the list.

- [ ] Rename the parser
- [x] \`cargo test\`
  - [ ] a nested one
* [ ] a star marker
+ [X] a plus, capital X

## Later

- [ ] Something after a heading

A closing note nobody wants moved.
`;

// ── which lines are steps ─────────────────────────────────────────────────
{
  const s = parse(REAL);
  ok('every marker style is a step', s.length === 6, s.length);
  ok('a heading is not a step', !s.some((x) => x.text.startsWith('#')));
  ok('prose is not a step', !s.some((x) => x.text.includes('explains')));
  ok('the closing note is not a step', !s.some((x) => x.text.includes('closing')));
  ok('done is read from the box', s[1].done === true && s[0].done === false);
  ok('a capital X is done too', s[4].done === true);
  ok('indent is kept, so a nested step stays nested', s[2].indent === '  ');
  ok('each step knows its own line', s[0].line === 4 && s.every((x, i) => i === 0 || x.line > s[i - 1].line));
}

// ── the kind, carried by backticks ────────────────────────────────────────
ok('a bare sentence is prose', kindOf('Rename the parser') === 'prose');
ok('a step that is only a command is a command', kindOf('`npm test`') === 'command');
ok('and surrounding space does not change that', kindOf('  `npm test`  ') === 'command');
// This is the one that matters: a sentence *about* a command is not one.
ok('prose containing a command is still prose',
   kindOf('run `npm test` first') === 'prose');
ok('two commands in one line is prose, not a command',
   kindOf('`npm test` `cargo test`') === 'prose');
ok('empty backticks are prose', kindOf('``') === 'prose');
ok('a command unwraps for sending', payload('`npm test`') === 'npm test');
ok('prose is sent as written, trimmed', payload('  Rename the parser  ') === 'Rename the parser');

// ── editing one line leaves the rest alone ────────────────────────────────
{
  const after = toggle(REAL, 4);
  ok('ticking changes the box', after.split('\n')[4] === '- [ ] Rename the parser'.replace('[ ]', '[x]'));
  ok('and changes nothing else', (() => {
    const a = REAL.split('\n'), b = after.split('\n');
    return a.length === b.length && a.every((l, i) => i === 4 || l === b[i]);
  })());
  ok('unticking goes back exactly', toggle(after, 4) === REAL);
}
ok('ticking a nested step keeps its indent',
   toggle(REAL, 6).split('\n')[6].startsWith('  - [x] '), toggle(REAL, 6).split('\n')[6]);
ok('a star marker stays a star', toggle(REAL, 7).split('\n')[7].startsWith('* [x]'));
ok('toggling a line that is not a step changes nothing', toggle(REAL, 0) === REAL);
ok('toggling past the end changes nothing', toggle(REAL, 999) === REAL && toggle(REAL, -1) === REAL);
ok('a file with no steps is returned unchanged', toggle('# nothing here\n', 0) === '# nothing here\n');

// ── the round trip ────────────────────────────────────────────────────────
ok('ticking and unticking every step returns the file', (() => {
  // parse returns addresses, not a document, so the file cannot come back
  // reformatted. The one legal difference is `[X]` becoming `[x]`, which is
  // documented and is a one-character diff on a line somebody edited anyway.
  const norm = (x) => x.replace(/\[X\]/g, '[x]');
  let t = REAL;
  for (const s of parse(REAL)) t = toggle(t, s.line);
  for (const s of parse(REAL)) t = toggle(t, s.line);
  return t === norm(REAL);
})());
ok('and a capital X normalises to lowercase, which is the only difference',
   toggle(toggle(REAL, 8), 8).split('\n')[8] === '+ [x] a plus, capital X',
   toggle(toggle(REAL, 8), 8).split('\n')[8]);

// ── editing words ─────────────────────────────────────────────────────────
ok('edit keeps the box and the marker',
   edit(REAL, 5, 'cargo build').split('\n')[5] === '- [x] cargo build');
ok('edit refuses to empty a step', edit(REAL, 4, '   ') === REAL);
// A pasted multi-line string would otherwise inject list items into the file.
ok('a newline in an edit becomes a space, not a second step',
   edit(REAL, 4, 'one\ntwo').split('\n')[4] === '- [ ] one two');

// ── removing ──────────────────────────────────────────────────────────────
{
  const after = remove(REAL, 4);
  ok('removing takes the line out', parse(after).length === 5);
  ok('and nothing else moves', after.split('\n')[4] === REAL.split('\n')[5]);
  ok('removing a non-step does nothing', remove(REAL, 0) === REAL);
}

// ── adding ────────────────────────────────────────────────────────────────
{
  const after = add(REAL, 'a new one');
  const steps = parse(after);
  ok('a new step joins the list', steps.length === 7);
  // After the last step rather than at the end of the file, so the closing note
  // stays under the list instead of being buried.
  ok('it lands after the last step, not after the closing note',
     after.includes('- [ ] a new one\n\nA closing note'), after.slice(-90));
  ok('and it is not done', steps.find((s) => s.text === 'a new one').done === false);
}
ok('adding to a file with no steps appends with a gap',
   add('# Title\n', 'first') === '# Title\n\n- [ ] first\n', JSON.stringify(add('# Title\n', 'first')));
ok('adding to an empty file needs no gap', add('', 'first') === '- [ ] first\n');
ok('adding nothing changes nothing', add(REAL, '   ') === REAL);
ok('a newline in a new step becomes a space',
   parse(add('', 'one\ntwo')).length === 1);

// ── the starter, and counting ─────────────────────────────────────────────
{
  const s = parse(STARTER);
  ok('the starter parses', s.length === 2);
  ok('and shows both kinds, so the convention is visible on first sight',
     s.some((x) => x.kind === 'prose') && s.some((x) => x.kind === 'command'));
}
ok('progress counts what is done', (() => {
  const p = progress(parse(REAL));
  return p.total === 6 && p.done === 2;
})(), progress(parse(REAL)));
ok('an empty list is 0 of 0, not a division', (() => {
  const p = progress([]);
  return p.total === 0 && p.done === 0;
})());

// ── CRLF, because a file in a project may have been written on Windows ────
{
  const crlf = '- [ ] one\r\n- [x] two\r\n';
  const s = parse(crlf);
  ok('a CRLF file still parses', s.length === 2, s.length);
  ok('and its text is not left with a carriage return',
     s[0].text === 'one' && !s[0].text.includes('\r'), JSON.stringify(s[0].text));
  ok('toggling a CRLF file keeps its line endings',
     toggle(crlf, 0).split('\n')[0].endsWith('\r'), JSON.stringify(toggle(crlf, 0).split('\n')[0]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
