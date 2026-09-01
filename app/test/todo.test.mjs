// The project to-do list.
//
// The file belongs to a person. It will have headings, blank lines, paragraphs
// between groups and indentation nobody here chose — so the property that
// matters most is that editing one step leaves every other byte alone. A module
// that reformats somebody's file to tick a box is one they stop using.
import {
  parse, kindOf, payload, toggle, edit, remove, add, move, progress, STARTER,
  minutes, duration, tree, roll, flatten, plan, summarise,
  setStatus, setPriority, setProgress, setEstimate, setDue, toggleTag,
  STATUSES, PICKABLE, PRIORITIES, RANK,
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
  ok('the starter parses', s.length === 3, s.length);
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

// ══ The token grammar ═════════════════════════════════════════════════════
//
// Metadata rides on the line because the alternative was a sidecar that
// disagrees with the markdown the first time somebody edits the markdown.
// These tests are mostly about the ways that can go wrong.

const PLAN = `# Sprint

## Milestone 1

- [x] Login API !critical ~2h #backend
- [ ] JWT authentication !high @doing %45 ~40m #backend #security >Login API
      Need refresh tokens too.
  - [ ] Sign the token ~20m
  - [x] Verify the token ~10m
- [ ] User profile >JWT authentication +src/user.ts ^today

## Milestone 2

- [ ] Dashboard !low ~1d #frontend @deferred
`;

// ── each token ────────────────────────────────────────────────────────────
{
  const t = parse(PLAN);
  ok('every task is found across headings and nesting', t.length === 6, t.length);
  const jwt = t.find((x) => x.title.startsWith('JWT'));
  ok('the title has no tokens left in it', jwt.title === 'JWT authentication', jwt.title);
  ok('priority is read', jwt.priority === 'high');
  ok('status is read', jwt.status === 'doing');
  ok('progress is read', jwt.progress === 45);
  ok('an estimate becomes minutes', jwt.estimate === 40);
  ok('tags are read, all of them', jwt.tags.join() === 'backend,security', jwt.tags);
  ok('a dependency is read whole, spaces and all', jwt.needs.join() === 'Login API', jwt.needs);
  ok('a file is read', t.find((x) => x.title === 'User profile').files.join() === 'src/user.ts');
  ok('a due date is read', t.find((x) => x.title === 'User profile').due === 'today');
  ok('the heading above becomes the section', jwt.section === 'Milestone 1', jwt.section);
  ok('and a later heading takes over', t.find((x) => x.title === 'Dashboard').section === 'Milestone 2');
  ok('indented prose under a task becomes its note',
     jwt.note === 'Need refresh tokens too.', JSON.stringify(jwt.note));
  ok('a task without a note has none', t[0].note === '');
  ok('nesting is a depth, counted in the file own indent step',
     t.filter((x) => x.depth === 1).length === 2, t.map((x) => x.depth));
}

// ── a plain line is still a plain line ────────────────────────────────────
// Somebody who never learns the grammar must lose nothing.
{
  const t = parse('- [ ] Just a sentence about the thing\n');
  ok('a task with no tokens has no metadata', (() => {
    const x = t[0];
    return x.title === 'Just a sentence about the thing' && x.priority === null
      && x.status === 'todo' && x.progress === null && x.estimate === null
      && !x.tags.length && !x.files.length && !x.needs.length && x.due === null;
  })(), t[0]);
}

// ── tokens must start a word, or ordinary prose grows metadata ────────────
ok('C++ is not a file token', parse('- [ ] Port it to C++\n')[0].files.length === 0);
ok('and the title keeps it', parse('- [ ] Port it to C++\n')[0].title === 'Port it to C++');
ok('a mid-word hash is not a tag', parse('- [ ] Grade A#1 rating\n')[0].tags.length === 0);
ok('50% off is not progress', parse('- [ ] Ship the 50% off banner\n')[0].progress === null,
   parse('- [ ] Ship the 50% off banner\n')[0].progress);
ok('an email is not a status', parse('- [ ] Mail a@doing.com\n')[0].status === 'todo');

// ── code spans are invisible to the grammar ───────────────────────────────
// A command is a string somebody will run. Reading tokens out of it would both
// corrupt the command and invent metadata nobody wrote.
{
  const t = parse("- [ ] `git log --oneline | head -3` ~5m\n")[0];
  ok('a pipe inside backticks survives', t.title === '`git log --oneline | head -3`', t.title);
  ok('and the estimate outside it is still read', t.estimate === 5);
  ok('the command unwraps for sending', t.text === 'git log --oneline | head -3');
  ok('and it is still a command', t.kind === 'command');
}
ok('a > inside backticks is not a dependency',
   parse("- [ ] `awk '$1 > 2' f.txt`\n")[0].needs.length === 0);
ok('a # inside backticks is not a tag',
   parse("- [ ] `sed 's/#a/#b/' x`\n")[0].tags.length === 0);
ok('and the code keeps every character',
   parse("- [ ] `sed 's/#a/#b/' x`\n")[0].text === "sed 's/#a/#b/' x");

// ── the box outranks the word ─────────────────────────────────────────────
// `- [x] … @doing` is a stale token on a task somebody actually ticked.
ok('a ticked task is done whatever the status says',
   parse('- [x] A thing @doing %45\n')[0].status === 'done');
ok('a repeated token reads the first, so a hand-edited line stays steady',
   parse('- [ ] A thing !high !low\n')[0].priority === 'high');

// ── durations ─────────────────────────────────────────────────────────────
ok('bare digits are minutes', minutes('90') === 90);
ok('m is minutes', minutes('40m') === 40);
ok('h is hours', minutes('2h') === 120);
ok('mixed units add up', minutes('1h30m') === 90);
// Nobody estimating in days means calendar days, and a bar that thinks three
// days of work is 72 hours predicts a date nobody believes.
ok('a day is eight hours of work, not twenty-four', minutes('1d') === 480);
ok('nonsense is nothing', minutes('soon') === null && minutes('') === null);
ok('minutes print short', duration(40) === '40m');
ok('and roll up into hours', duration(95) === '1h 35m', duration(95));
ok('and into days', duration(480 + 60) === '1d 1h', duration(540));
ok('nothing prints as nothing', duration(0) === '' && duration(null) === '');
ok('a duration round-trips through the token', minutes(duration(95).replace(/\s/g, '')) === 95);

// ── the tree ──────────────────────────────────────────────────────────────
{
  const t = tree(parse(PLAN));
  ok('top-level tasks are roots', t.length === 4, t.length);
  ok('indented tasks are children of the one above',
     t[1].children.length === 2, t[1].children.length);
  ok('flatten returns everything again', flatten(t).length === 6);
  ok('and parents come before their children',
     flatten(t)[1].title === 'JWT authentication' && flatten(t)[2].title === 'Sign the token');
}

// ── what rolls up ─────────────────────────────────────────────────────────
{
  const p = plan(PLAN);
  const jwt = flatten(p).find((x) => x.title === 'JWT authentication');
  const profile = flatten(p).find((x) => x.title === 'User profile');

  ok('a done task is 100%', p[0].percent === 100);
  // Explicit progress on a parent loses to nothing: it was written by a person.
  ok('an explicit percent wins over the children', jwt.percent === 45, jwt.percent);
  ok('a task with no children and no percent is 0', profile.percent === 0);
  ok('children average when the parent says nothing', (() => {
    const q = plan('- [ ] Parent\n  - [x] One\n  - [ ] Two\n');
    return q[0].percent === 50;
  })());
  ok('a parent with three children rounds', (() => {
    const q = plan('- [ ] Parent\n  - [x] a\n  - [ ] b\n  - [ ] c\n');
    return q[0].percent === 33;
  })());

  // A dependency on an unfinished task blocks, and says what it waits for.
  ok('an unmet dependency blocks the task', profile.state === 'blocked', profile.state);
  ok('and names what it is waiting for', profile.waiting.join() === 'JWT authentication');
  // Login API is ticked, so the task depending on it is not blocked by it.
  ok('a met dependency does not block', jwt.waiting.length === 0, jwt.waiting);
  ok('and the status it was written with survives', jwt.state === 'doing');
  ok('a dependency matches the start of a title, so nobody retypes one', (() => {
    const q = plan('- [x] Login API for the web\n- [ ] Profile >Login\n');
    return flatten(q)[1].waiting.length === 0;
  })());
  ok('a done task is never blocked', (() => {
    const q = plan('- [ ] Nowhere\n- [x] Profile >Nowhere\n');
    return flatten(q)[1].state === 'done' && flatten(q)[1].waiting.length === 0;
  })());
}

// ── time remaining ────────────────────────────────────────────────────────
ok('a leaf estimate counts what is left of it', (() => {
  const q = plan('- [ ] A ~100m %25\n');
  return q[0].left === 75;
})(), plan('- [ ] A ~100m %25\n')[0].left);
ok('a done task has nothing left', plan('- [x] A ~100m\n')[0].left === 0);
ok('a deferred task is not counted against the remaining work',
   plan('- [ ] A ~100m @deferred\n')[0].left === 0);
// A parent estimated at 2h with subtasks adding to 3h is a stale estimate, and
// counting both would say 5h, which is true of nothing.
ok('a parent estimate never adds on top of its children', (() => {
  const q = plan('- [ ] Parent ~2h\n  - [ ] a ~1h\n  - [ ] b ~2h\n');
  return q[0].left === 180;
})(), plan('- [ ] Parent ~2h\n  - [ ] a ~1h\n  - [ ] b ~2h\n')[0].left);

// ── the summary ───────────────────────────────────────────────────────────
{
  const s = summarise(plan(PLAN));
  ok('done and total count leaves, which is what "how many left" means',
     s.total === 5 && s.done === 2, s);
  // A milestone broken into eight subtasks must not outvote seven nobody has
  // broken down yet, so the bar is the mean over top-level tasks.
  ok('percent is the mean over top-level tasks', s.percent === 36, s.percent);
  ok('the project is in progress when something is', s.status === 'doing');
  ok('the phase is where the work actually is', s.phase === 'Milestone 1', s.phase);
  ok('the highest outstanding priority is reported', s.priority === 'high', s.priority);
  ok('blocked tasks are counted', s.blocked === 1, s.blocked);
}
ok('everything done is a done project', summarise(plan('- [x] a\n- [x] b\n')).status === 'done');
ok('an empty file is not "done", which would be a lie', (() => {
  const s = summarise(plan('# Nothing\n'));
  return s.status === 'todo' && s.total === 0 && s.percent === 0;
})());
ok('blocked with nothing moving reports blocked',
   summarise(plan('- [ ] a\n- [ ] b >a\n')).status === 'blocked');
// Something in flight is more useful to report than something stuck.
ok('but work in progress outranks a blocker',
   summarise(plan('- [ ] a @doing\n- [ ] b\n- [ ] c >b\n')).status === 'doing');

// ══ Changing one line ═════════════════════════════════════════════════════
//
// The property that matters most: setting metadata rewrites one line and moves
// no other byte, because the file belongs to a person.

const untouched = (before, after, line) => {
  const a = before.split('\n'), b = after.split('\n');
  return a.length === b.length && a.every((l, i) => i === line || l === b[i]);
};

{
  const at = 5;   // JWT authentication
  ok('setting a priority changes the one line', (() => {
    const after = setPriority(PLAN, at, 'low');
    return untouched(PLAN, after, at) && parse(after)[1].priority === 'low';
  })());
  ok('and replaces in place rather than shuffling the line', (() => {
    const after = setPriority(PLAN, at, 'low');
    return after.split('\n')[at].startsWith('- [ ] JWT authentication !low @doing %45');
  })(), setPriority(PLAN, at, 'low').split('\n')[at]);
  ok('clearing a priority leaves no double space', (() => {
    const line = setPriority(PLAN, at, null).split('\n')[at];
    return !line.includes('  ') && !line.includes('!');
  })(), setPriority(PLAN, at, null).split('\n')[at]);
  ok('setting a priority on a task that had none appends it', (() => {
    const after = setPriority('- [ ] A thing\n', 0, 'critical');
    return after === '- [ ] A thing !critical\n';
  })(), setPriority('- [ ] A thing\n', 0, 'critical'));
}

ok('setting a status writes the token', parse(setStatus('- [ ] A\n', 0, 'testing'))[0].status === 'testing');
ok('setting it back to todo clears it', setStatus('- [ ] A @testing\n', 0, 'todo') === '- [ ] A\n');
// One true place records "finished", and a second would be free to disagree.
ok('setting done ticks the box rather than writing a word',
   setStatus('- [ ] A\n', 0, 'done') === '- [x] A\n');
ok('and moving a done task to another status unticks it',
   setStatus('- [x] A\n', 0, 'doing') === '- [ ] A @doing\n', setStatus('- [x] A\n', 0, 'doing'));
ok('setting done twice is not a toggle', setStatus('- [x] A\n', 0, 'done') === '- [x] A\n');

ok('progress is written', setProgress('- [ ] A\n', 0, 45) === '- [ ] A %45\n');
ok('zero clears it rather than writing a nought nobody reads',
   setProgress('- [ ] A %45\n', 0, 0) === '- [ ] A\n');
// A task at 100% that is not ticked is paperwork a to-do list exists to avoid.
ok('100 ticks the box instead', setProgress('- [ ] A %45\n', 0, 100) === '- [x] A\n',
   setProgress('- [ ] A %45\n', 0, 100));
ok('out of range is clamped', setProgress('- [ ] A\n', 0, 250) === '- [x] A\n');
ok('and negative is clamped to nothing', setProgress('- [ ] A\n', 0, -5) === '- [ ] A\n');

ok('an estimate is written readably', setEstimate('- [ ] A\n', 0, 95) === '- [ ] A ~1h35m\n',
   setEstimate('- [ ] A\n', 0, 95));
ok('and reads back as the same number', parse(setEstimate('- [ ] A\n', 0, 95))[0].estimate === 95);
ok('clearing an estimate removes it', setEstimate('- [ ] A ~2h\n', 0, null) === '- [ ] A\n');
ok('a due date is written', setDue('- [ ] A\n', 0, '2026-09-05') === '- [ ] A ^2026-09-05\n');
ok('and cleared', setDue('- [ ] A ^today\n', 0, null) === '- [ ] A\n');

// Tags are the one token a task may have several of.
ok('a tag is added', toggleTag('- [ ] A\n', 0, 'ui') === '- [ ] A #ui\n');
ok('a second tag joins the first', toggleTag('- [ ] A #ui\n', 0, 'ai') === '- [ ] A #ui #ai\n');
ok('an existing tag comes off', toggleTag('- [ ] A #ui #ai\n', 0, 'ui') === '- [ ] A #ai\n');
ok('a leading hash is accepted', toggleTag('- [ ] A\n', 0, '#ui') === '- [ ] A #ui\n');
ok('tags are lowercased so #UI and #ui are one tag',
   toggleTag('- [ ] A #ui\n', 0, 'UI') === '- [ ] A\n');
ok('punctuation is stripped rather than written into a token',
   toggleTag('- [ ] A\n', 0, 'front end!') === '- [ ] A #frontend\n',
   toggleTag('- [ ] A\n', 0, 'front end!'));
ok('an empty tag changes nothing', toggleTag('- [ ] A\n', 0, '  ') === '- [ ] A\n');

// ── ticking cleans up after itself ────────────────────────────────────────
// A task that is done is not also "in progress, 45%".
ok('ticking clears the status and the progress',
   toggle('- [ ] A @doing %45 !high ~2h\n', 0) === '- [x] A !high ~2h\n',
   toggle('- [ ] A @doing %45 !high ~2h\n', 0));
ok('and keeps the priority and the estimate, which are still true',
   parse(toggle('- [ ] A @doing %45 !high ~2h\n', 0))[0].estimate === 120);
ok('unticking does not invent a status back',
   toggle('- [x] A !high\n', 0) === '- [ ] A !high\n');

// ── editing words keeps the metadata ──────────────────────────────────────
{
  const after = edit('- [ ] Old title !high @doing ~2h #ui\n', 0, 'New title');
  ok('the words change and every token survives', after === '- [ ] New title !high @doing ~2h #ui\n', after);
  ok('a newline in an edit becomes a space, not a second task',
     edit('- [ ] A !high\n', 0, 'one\ntwo') === '- [ ] one two !high\n');
  ok('edit still refuses to empty a task', edit('- [ ] A\n', 0, '  ') === '- [ ] A\n');
}

// ── removing takes the subtree ────────────────────────────────────────────
// A subtask whose parent is gone is indented under nothing and reads as a task
// of the group above — worse than either outcome somebody was choosing between.
{
  const src = '- [ ] Parent\n  - [ ] a\n  - [ ] b\n- [ ] After\n';
  ok('removing a parent removes its children too',
     remove(src, 0) === '- [ ] After\n', JSON.stringify(remove(src, 0)));
  ok('removing a child leaves the parent', parse(remove(src, 1)).length === 3);
  ok('and the task after it is untouched', remove(src, 0).includes('- [ ] After'));
}

// ── adding ────────────────────────────────────────────────────────────────
{
  const src = '- [ ] Parent\n  - [ ] a\n- [ ] Other\n';
  // A new task typed at the bottom of the list is a new task, not a subtask of
  // whatever happened to be last.
  ok('a new task lands at the top level', add(src, 'New').endsWith('- [ ] Other\n- [ ] New\n'),
     JSON.stringify(add(src, 'New')));
  const kid = add(src, 'b', 0);
  ok('a subtask lands under its parent', kid === '- [ ] Parent\n  - [ ] a\n  - [ ] b\n- [ ] Other\n',
     JSON.stringify(kid));
  ok('and matches the indent its siblings already use', parse(kid)[2].indent === '  ');
  ok('adding three subtasks gives three siblings, not a ladder', (() => {
    let t = '- [ ] P\n';
    t = add(t, 'a', 0); t = add(t, 'b', 0); t = add(t, 'c', 0);
    return parse(t).filter((x) => x.depth === 1).length === 3;
  })());
}

// ── moving ────────────────────────────────────────────────────────────────
{
  const src = '- [ ] A\n- [ ] B\n- [ ] C\n';
  ok('a task moves after another', parse(move(src, 0, 2)).map((x) => x.title).join() === 'B,C,A');
  ok('a parent carries its children', (() => {
    const p = '- [ ] A\n  - [ ] a1\n- [ ] B\n';
    return parse(move(p, 0, 2)).map((x) => x.title).join() === 'B,A,a1';
  })(), parse(move('- [ ] A\n  - [ ] a1\n- [ ] B\n', 0, 2)).map((x) => x.title));
  // The block being spliced in is the block being cut out, so this would delete it.
  ok('a task cannot be dropped inside its own subtree', (() => {
    const p = '- [ ] A\n  - [ ] a1\n- [ ] B\n';
    return move(p, 0, 1) === p;
  })());
  ok('moving onto itself changes nothing', move(src, 0, 0) === src);
  ok('a line that is not a task is not a target', move(src, 0, 99) === src);
}

// ── nothing here reformats a file ─────────────────────────────────────────
ok('setting metadata on a CRLF file keeps its line endings',
   setPriority('- [ ] A\r\n- [ ] B\r\n', 0, 'high').split('\n')[0] === '- [ ] A !high\r',
   JSON.stringify(setPriority('- [ ] A\r\n- [ ] B\r\n', 0, 'high').split('\n')[0]));
ok('a star marker survives a status change',
   setStatus('* [ ] A\n', 0, 'doing') === '* [ ] A @doing\n');
ok('a nested task keeps its indent through a priority change',
   setPriority('- [ ] P\n    - [ ] a\n', 1, 'high') === '- [ ] P\n    - [ ] a !high\n');
ok('setting metadata on a line that is not a task changes nothing',
   setPriority('# Heading\n- [ ] A\n', 0, 'high') === '# Heading\n- [ ] A\n');
ok('and past the end of the file changes nothing',
   setPriority('- [ ] A\n', 99, 'high') === '- [ ] A\n');

// ── the vocabularies are complete and agree with each other ───────────────
ok('every pickable status is a status', PICKABLE.every((s) => STATUSES.includes(s)));
ok('the two the box owns are not pickable',
   !PICKABLE.includes('done') && !PICKABLE.includes('todo'));
ok('every priority has a rank', PRIORITIES.every((p) => typeof RANK[p] === 'number'));
ok('critical outranks everything', PRIORITIES.every((p) => p === 'critical' || RANK.critical < RANK[p]));
ok('every status the grammar accepts parses back to itself',
   PICKABLE.every((s) => parse(`- [ ] A @${s}\n`)[0].status === s));
ok('every priority the grammar accepts parses back to itself',
   PRIORITIES.every((p) => parse(`- [ ] A !${p}\n`)[0].priority === p));
ok('and the friendly spellings land on the real ones',
   parse('- [ ] A !med\n')[0].priority === 'medium'
   && parse('- [ ] A !nice\n')[0].priority === 'maybe'
   && parse('- [ ] A @progress\n')[0].status === 'doing'
   && parse('- [ ] A @reviewing\n')[0].status === 'review');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
