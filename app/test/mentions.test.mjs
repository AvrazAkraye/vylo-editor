// `@` mentions.
//
// The failure that matters is a false positive: prose is full of `@`, and
// attaching a file because a sentence happened to contain its name would be
// worse than not supporting mentions at all. So most of these check what is
// NOT a mention.
import {
  applyMention, findMentions, folderListing, mentionQuery, treeResolver,
} from '../.test-build/mentions.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const TREE = [
  { path: 'src', is_dir: true },
  { path: 'src/App.tsx', is_dir: false },
  { path: 'src/agent.ts', is_dir: false },
  { path: 'src/lib', is_dir: true },
  { path: 'src/lib/util.ts', is_dir: false },
  { path: 'README.md', is_dir: false },
  { path: 'a.', is_dir: false },
];
const resolve = treeResolver(TREE);
const find = (t, term = false) => findMentions(t, resolve, term);

// ── what is a mention ─────────────────────────────────────────────────────
ok('a file resolves', find('look at @src/App.tsx').map((m) => m.path).join() === 'src/App.tsx');
ok('a folder resolves as a folder',
   find('@src/lib please')[0]?.kind === 'folder', find('@src/lib please'));
ok('several in one message all resolve',
   find('@src/App.tsx and @README.md').length === 2);
ok('a mention at the very start works', find('@README.md is stale').length === 1);
ok('a mention in brackets works', find('(@README.md)').length === 1, find('(@README.md)'));

// ── what is not ───────────────────────────────────────────────────────────
ok('an email address is not a mention', find('write to name@example.com').length === 0,
   find('write to name@example.com'));
ok('an unknown path is left as prose', find('@not/a/file anywhere').length === 0);
ok('a bare @ is not a mention', find('cost @ 5 dollars').length === 0);
ok('a handle mid-word is not a mention', find('see foo@src/App.tsx').length === 0,
   find('see foo@src/App.tsx'));
ok('@terminal is inert with no terminal open', find('@terminal').length === 0);
ok('@terminal resolves when one is open', find('@terminal', true)[0]?.kind === 'terminal');

// ── punctuation ───────────────────────────────────────────────────────────
ok('a trailing full stop is shed', find('check @src/App.tsx.').map((m) => m.path).join() === 'src/App.tsx');
ok('a trailing comma is shed', find('@README.md, then what').map((m) => m.path).join() === 'README.md');
ok('but a real file ending in a dot still wins',
   find('@a. is odd').map((m) => m.path).join() === 'a.', find('@a. is odd'));

// ── duplicates ────────────────────────────────────────────────────────────
ok('the same file twice is one attachment',
   find('@README.md vs @README.md').length === 1);

// ── the picker's view of the caret ────────────────────────────────────────
ok('typing after @ opens a query',
   JSON.stringify(mentionQuery('look at @src/Ap', 15)) === '{"start":8,"query":"src/Ap"}',
   mentionQuery('look at @src/Ap', 15));
ok('an empty query right after @ still opens',
   mentionQuery('hi @', 4)?.query === '', mentionQuery('hi @', 4));
ok('a space ends the query', mentionQuery('@src/App.tsx and more', 21) === null);
ok('the caret before the @ sees nothing', mentionQuery('look at @src', 4) === null);
ok('an email does not open the picker', mentionQuery('a@b', 3) === null, mentionQuery('a@b', 3));
ok('a second mention is found from the caret, not the first',
   mentionQuery('@README.md @src/A', 17)?.query === 'src/A',
   mentionQuery('@README.md @src/A', 17));

// ── inserting ─────────────────────────────────────────────────────────────
{
  const r = applyMention('look at @src/Ap', 8, 15, 'src/App.tsx');
  ok('the token is replaced whole', r.text === 'look at @src/App.tsx ', JSON.stringify(r.text));
  ok('the caret lands after the inserted space', r.caret === r.text.length, r.caret);
}
{
  const r = applyMention('a @rea done', 2, 6, 'README.md');
  ok('text after the caret survives', r.text === 'a @README.md  done', JSON.stringify(r.text));
}

// ── folder listing ────────────────────────────────────────────────────────
{
  const out = folderListing('src', TREE);
  ok('a folder sends its paths, not its contents', out.includes('src/App.tsx') && !out.includes('import'));
  ok('nested folders are marked', out.includes('src/lib/'), out);
  ok('the count is stated', out.startsWith('src/ — 4 entries'), out.split('\n')[0]);
  ok('the folder itself is not listed inside itself', !out.split('\n').includes('src/'));
}
{
  const many = Array.from({ length: 500 }, (_, i) => ({ path: `big/f${i}.ts`, is_dir: false }));
  const out = folderListing('big', many, 10);
  ok('a large folder is truncated', out.split('\n').length === 12, out.split('\n').length);
  ok('and says how many were left out', out.endsWith('… and 490 more'), out.slice(-30));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
