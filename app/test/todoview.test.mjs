// How the to-do list is arranged on screen.
//
// Grouping and filtering is where a task board gets its answers wrong quietly:
// a task in two columns, a blocked task hidden behind a filter, a heading whose
// count disagrees with the rows under it. All of it is arithmetic, so all of it
// is here.
import { plan } from '../.test-build/todo.js';
import {
  SECTIONS, COLUMNS, sectionOf, sections, columns, today, dueOn,
  parseQuery, isEmpty, matches, search, sortBy, tagsIn, activeFiles,
} from '../.test-build/todoview.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// A fixed clock, so none of this is a race against midnight.
const NOW = new Date('2026-09-01T10:00:00');
const one = (line) => plan(line + '\n')[0];

// ── dates ─────────────────────────────────────────────────────────────────
ok('today is the local date', today(NOW) === '2026-09-01', today(NOW));
ok('a padded month and day', today(new Date('2026-01-05T10:00:00')) === '2026-01-05');
ok('"today" resolves', dueOn('today', NOW) === '2026-09-01');
ok('"tomorrow" resolves', dueOn('tomorrow', NOW) === '2026-09-02');
ok('and crosses a month end', dueOn('tomorrow', new Date('2026-09-30T10:00:00')) === '2026-10-01');
ok('a written date is itself', dueOn('2026-12-25', NOW) === '2026-12-25');
ok('no date is null', dueOn(null, NOW) === null && dueOn('someday', NOW) === null);

// ── which section claims a task ───────────────────────────────────────────
ok('done goes to completed', sectionOf(one('- [x] A'), NOW) === 'done');
ok('deferred goes to later', sectionOf(one('- [ ] A @deferred'), NOW) === 'later');
ok('due today is today', sectionOf(one('- [ ] A ^today'), NOW) === 'today');
// A task due on Tuesday is not "upcoming", and hiding it in the past helps
// nobody.
ok('overdue is today, not a section of its own',
   sectionOf(one('- [ ] A ^2026-08-01'), NOW) === 'today');
ok('due later is upcoming', sectionOf(one('- [ ] A ^2026-12-25'), NOW) === 'upcoming');
ok('in progress is its own section', sectionOf(one('- [ ] A @doing'), NOW) === 'doing');
ok('so are review and testing',
   sectionOf(one('- [ ] A @review'), NOW) === 'doing' && sectionOf(one('- [ ] A @testing'), NOW) === 'doing');
ok('high priority is urgent', sectionOf(one('- [ ] A !high'), NOW) === 'urgent');
ok('critical too', sectionOf(one('- [ ] A !critical'), NOW) === 'urgent');
ok('medium is not', sectionOf(one('- [ ] A !medium'), NOW) === 'backlog');
ok('a plain task is backlog', sectionOf(one('- [ ] A'), NOW) === 'backlog');
{
  // Blocked is derived, not written, so it has to survive the derivation.
  const p = plan('- [ ] Dep\n- [ ] A >Dep\n');
  ok('an unmet dependency puts a task in blocked', sectionOf(p[1], NOW) === 'blocked');
}
// Ticking a blocked, overdue, critical task must still file it under completed.
ok('done beats everything else', sectionOf(one('- [x] A ^2026-01-01 !critical'), NOW) === 'done');

// ── one task, one section ─────────────────────────────────────────────────
{
  const p = plan(`- [ ] Due and urgent ^today !critical
- [ ] Moving @doing
- [ ] Plain
- [x] Finished
`);
  const s = sections(p, NOW);
  const all = s.flatMap((x) => x.tasks);
  ok('every task is placed exactly once', all.length === 4 && new Set(all).size === 4, all.length);
  // A task in two places is one somebody ticks in one and finds again in the
  // other, under a heading whose count no longer adds up.
  ok('a task that qualifies for three sections appears in one',
     s.filter((x) => x.tasks.some((t) => t.title === 'Due and urgent')).length === 1);
  ok('and it is the first that claims it', s[0].key === 'today');
  ok('empty sections are dropped', s.every((x) => x.tasks.length > 0));
  ok('the order is the declared one', (() => {
    const want = SECTIONS.map((x) => x.key).filter((k) => s.some((y) => y.key === k));
    return s.map((x) => x.key).join() === want.join();
  })(), s.map((x) => x.key));
}
ok('an empty list has no sections', sections([], NOW).length === 0);
ok('every section key has a title and an icon',
   SECTIONS.every((s) => s.key && s.title && s.icon));

// ── the board ─────────────────────────────────────────────────────────────
{
  const p = plan(`- [ ] Inbox one
- [ ] Planned one @planning
- [ ] Doing one @doing
- [ ] Dep
- [ ] Blocked one >Dep
- [x] Done one
`);
  const c = columns(p);
  const by = (k) => c.find((x) => x.key === k).tasks.map((t) => t.title);
  ok('a plain task is in the inbox', by('todo').join() === 'Inbox one,Dep', by('todo'));
  ok('planning has its own column', by('planning').join() === 'Planned one');
  ok('in progress has its own', by('doing').join() === 'Doing one');
  ok('a derived block lands in blocked', by('blocked').join() === 'Blocked one');
  ok('done is done', by('done').join() === 'Done one');
  ok('every card is on the board exactly once',
     c.flatMap((x) => x.tasks).length === 6);
  // Dropping a card in a column has to be recordable in the file, and only a
  // status is.
  ok('every column is a status', COLUMNS.every((x) => typeof x.key === 'string'));
}

// ── the search box ────────────────────────────────────────────────────────
ok('plain words are words', parseQuery('login api').words.join() === 'login,api');
ok('the file sigils work in the box too', (() => {
  const q = parseQuery('#bug !high @doing');
  return q.tags.join() === 'bug' && q.priority.join() === 'high' && q.status.join() === 'doing';
})(), parseQuery('#bug !high @doing'));
ok('is:done and is:open are about the box', (() => {
  return parseQuery('is:done').done === true && parseQuery('is:open').done === false;
})());
ok('is: also accepts a status', parseQuery('is:blocked').status.join() === 'blocked');
ok('file: searches paths', parseQuery('file:editor.tsx').files.join() === 'editor.tsx');
ok('an unknown sigil word is just a word', parseQuery('!urgent').words.join() === '!urgent');
ok('an empty box narrows nothing', isEmpty(parseQuery('   ')) === true);
ok('and one term does', isEmpty(parseQuery('#bug')) === false);
ok('case does not matter', parseQuery('#Bug !HIGH').tags.join() === 'bug');

{
  const p = plan(`- [ ] Fix the login form !high #bug +src/auth/Login.tsx
      Reported by a customer.
- [ ] Write the docs !low #docs
- [x] Ship it #bug
`);
  const titles = (s) => search(p, s).map((t) => t.title).join();

  ok('a word matches the title', titles('login') === 'Fix the login form');
  ok('two words both have to match', titles('login docs') === '');
  ok('a tag matches', titles('#bug') === 'Fix the login form,Ship it');
  ok('a tag and a state narrow together', titles('#bug is:open') === 'Fix the login form');
  ok('a priority matches', titles('!low') === 'Write the docs');
  // Nothing is two priorities, so asking for both has to mean either.
  ok('two priorities mean either', search(p, '!high !low').length === 2);
  ok('but two tags mean both', search(p, '#bug #docs').length === 0);
  ok('a path matches on any part of it', titles('file:login.tsx') === 'Fix the login form');
  ok('the note is searched, because that is where the detail was written',
     titles('customer') === 'Fix the login form');
  ok('a search that matches nothing returns nothing', titles('zzz') === '');
  ok('an empty search returns the tree it was given', search(p, '  ') === p);
}
{
  // A filtered list that keeps parents for structure shows rows that did not
  // match, and nobody can tell answers from scaffolding.
  const p = plan('- [ ] Parent\n  - [ ] Child matches\n');
  ok('a matching subtask comes back alone, not under its parent',
     search(p, 'child').map((t) => t.title).join() === 'Child matches');
  ok('and a section name finds a whole group', (() => {
    const q = plan('## Milestone 2\n\n- [ ] A\n- [ ] B\n');
    return search(q, 'milestone').length === 2;
  })());
}

// ── sorting ───────────────────────────────────────────────────────────────
{
  const p = plan(`- [ ] A !low ^2026-12-01 %10
- [ ] B !critical %90
- [ ] C ^2026-09-02 %50
`);
  const t = (s) => sortBy(p, s, NOW).map((x) => x.title).join();
  ok('the default is the order the file is written in', t('file') === 'A,B,C');
  ok('priority puts critical first, and no priority above low',
     t('priority') === 'B,C,A', t('priority'));
  ok('a task with no priority sits between medium and low', (() => {
    const q = plan('- [ ] none\n- [ ] low !low\n- [ ] med !medium\n');
    return sortBy(q, 'priority', NOW).map((x) => x.title).join() === 'med,none,low';
  })());
  ok('due sorts by date, undated last', t('due') === 'C,A,B', t('due'));
  // The nearly-finished go on top, because finishing them is why anybody sorts
  // by progress.
  ok('progress puts the nearly-done first', t('progress') === 'B,C,A', t('progress'));
  ok('sorting does not mutate the list', (() => {
    sortBy(p, 'priority', NOW);
    return p.map((x) => x.title).join() === 'A,B,C';
  })());
  ok('ties keep file order, so rows do not swap about', (() => {
    const q = plan('- [ ] one !high\n- [ ] two !high\n- [ ] three !high\n');
    return sortBy(q, 'priority', NOW).map((x) => x.title).join() === 'one,two,three';
  })());
}

// ── the chips ─────────────────────────────────────────────────────────────
{
  const p = plan('- [ ] A #ui #bug\n- [ ] B #ui\n  - [ ] C #ui #perf\n');
  ok('tags are counted across the whole tree', (() => {
    const tags = tagsIn(p);
    return tags[0].tag === 'ui' && tags[0].n === 3;
  })(), tagsIn(p));
  ok('and the rest sort alphabetically after the count',
     tagsIn(p).map((x) => x.tag).join() === 'ui,bug,perf', tagsIn(p).map((x) => x.tag));
}
{
  const p = plan(`- [ ] A @doing +src/a.ts +src/b.ts
- [ ] B @testing +src/a.ts
- [ ] C +src/never.ts
- [x] D @doing +src/done.ts
`);
  ok('the overview lists the files the work in flight touches',
     activeFiles(p).join() === 'src/a.ts,src/b.ts', activeFiles(p));
  ok('a file is listed once however many tasks name it', activeFiles(p).length === 2);
  ok('a task nobody has started contributes nothing', !activeFiles(p).includes('src/never.ts'));
  ok('and neither does a finished one', !activeFiles(p).includes('src/done.ts'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
