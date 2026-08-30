// What happens to your work when the disk moves underneath the app.
//
// `notify` is not what is worth testing here: whether FSEvents delivers a flag
// is not decided by anything in this repository, and a test that waits for the
// operating system to say something is a test that goes red on a loaded CI
// machine. The policy is: given one batch of changes, a set of open tabs and a
// set of staged proposals, what gets re-read, what a human is asked about, and
// what is ignored.
//
// The section that matters is the second one. A reload is a full-document
// replace, so a watcher that reloads a dirty buffer destroys unsaved work with
// no undo entry and no warning — silently, and precisely while somebody is in
// the middle of typing. Every route by which a dirty tab could end up in
// `reload` is tried here on purpose.
import {
  SELF_MS, SelfWrites, collapse, mergeAsks, plan,
} from '../.test-build/watch.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** A batch, spelled the way `watch.rs` sends one. */
const batch = (changes, truncated = false) => ({ changes, truncated });
const changed = (path) => ({ path, kind: 'changed' });
const removed = (path) => ({ path, kind: 'removed' });
const clean = (path) => ({ path, dirty: false });
const messy = (path) => ({ path, dirty: true });
const state = (tabs = [], staged = [], ours = undefined) => ({ tabs, staged, ours });

// ── nothing happening ─────────────────────────────────────────────────────
{
  const p = plan(batch([]), state([clean('a.ts')]));
  ok('an empty batch asks for nothing at all',
     p.reload.length === 0 && p.ask.length === 0 && p.close.length === 0
     && p.restage.length === 0 && !p.tree && !p.git, p);
}

ok('a change to a file nobody has open still redraws the tree and the git state',
   (() => {
     const p = plan(batch([changed('deep/other.ts')]), state([clean('a.ts')]));
     return p.tree && p.git && p.reload.length === 0 && p.ask.length === 0;
   })());

// ── the dirty buffer, which is where work gets lost ───────────────────────
{
  const p = plan(batch([changed('a.ts')]), state([messy('a.ts')]));
  ok('a dirty tab whose file changed is asked about and never reloaded',
     p.reload.length === 0 && p.ask.length === 1 && p.ask[0].path === 'a.ts', p);
  ok('and the question says what happened to it',
     p.ask[0].kind === 'changed', p.ask);
}

ok('a dirty tab is never reloaded however many times the file is reported',
   (() => {
     const many = ['a.ts', 'a.ts', 'a.ts', 'a.ts'].map(changed);
     const p = plan(batch(many), state([messy('a.ts')]));
     return p.reload.length === 0 && p.ask.length === 1;
   })());

ok('a dirty tab is not reloaded when the file was deleted either',
   (() => {
     const p = plan(batch([removed('a.ts')]), state([messy('a.ts')]));
     return p.reload.length === 0 && p.close.length === 0
       && p.ask.length === 1 && p.ask[0].kind === 'removed';
   })());

ok('a dirty tab named in a truncated batch is asked about, not reloaded',
   (() => {
     const p = plan(batch([], true), state([messy('a.ts'), clean('b.ts')]));
     return p.reload.length === 1 && p.reload[0] === 'b.ts'
       && p.ask.length === 1 && p.ask[0].path === 'a.ts';
   })());

ok('a dirty tab survives a batch that also touches a clean one',
   (() => {
     const p = plan(batch([changed('a.ts'), changed('b.ts')]),
                    state([messy('a.ts'), clean('b.ts')]));
     return p.reload.length === 1 && p.reload[0] === 'b.ts'
       && p.ask.length === 1 && p.ask[0].path === 'a.ts';
   })());

ok('a file that was created and then deleted inside one batch is deleted',
   (() => {
     const p = plan(batch([changed('a.ts'), removed('a.ts')]), state([messy('a.ts')]));
     return p.ask.length === 1 && p.ask[0].kind === 'removed';
   })());

ok('and a file deleted and then written again inside one batch is there',
   (() => {
     const p = plan(batch([removed('a.ts'), changed('a.ts')]), state([clean('a.ts')]));
     return p.close.length === 0 && p.reload.length === 1;
   })());

// ── the clean tab, which is the whole point ───────────────────────────────
{
  const p = plan(batch([changed('a.ts')]), state([clean('a.ts')]));
  ok('a clean tab whose file changed is reloaded without asking',
     p.reload.length === 1 && p.reload[0] === 'a.ts' && p.ask.length === 0, p);
}

ok('a clean tab whose file was deleted is closed rather than reloaded',
   (() => {
     const p = plan(batch([removed('a.ts')]), state([clean('a.ts')]));
     return p.close.length === 1 && p.close[0] === 'a.ts' && p.reload.length === 0;
   })());

// ── staged proposals ──────────────────────────────────────────────────────
ok('a staged proposal whose file moved is re-based, not dropped',
   (() => {
     const p = plan(batch([changed('a.ts')]), state([], ['a.ts']));
     return p.restage.length === 1 && p.restage[0] === 'a.ts';
   })());

ok('a staged proposal is re-based even when its file was deleted',
   (() => {
     const p = plan(batch([removed('a.ts')]), state([], ['a.ts']));
     return p.restage.length === 1;
   })());

ok('a proposal against a file nothing touched is left alone',
   (() => {
     const p = plan(batch([changed('b.ts')]), state([], ['a.ts']));
     return p.restage.length === 0;
   })());

ok('a file that is both open, dirty and staged is asked about and re-based',
   (() => {
     const p = plan(batch([changed('a.ts')]), state([messy('a.ts')], ['a.ts']));
     return p.ask.length === 1 && p.restage.length === 1 && p.reload.length === 0;
   })());

ok('a truncated batch re-bases every proposal, because it cannot say which moved',
   (() => {
     const p = plan(batch([], true), state([], ['a.ts', 'b.ts']));
     return p.restage.length === 2 && p.tree && p.git;
   })());

// The model writes `src/app.ts` on every platform; the filesystem says
// `src\app.ts` on Windows. Compared literally, no proposal would ever be
// re-based there and the diff would go stale in silence.
ok('a Windows path from the filesystem matches the forward-slash path staged against it',
   (() => {
     const p = plan(batch([changed('src\\app.ts')]),
                    state([clean('src/app.ts')], ['src/app.ts']));
     return p.restage.length === 1 && p.restage[0] === 'src/app.ts'
       && p.reload.length === 1 && p.reload[0] === 'src/app.ts';
   })());

ok('and the plan names the path the way the app already holds it, not the way the event spelled it',
   (() => {
     const p = plan(batch([changed('src\\app.ts')]), state([messy('src/app.ts')]));
     return p.ask[0].path === 'src/app.ts';
   })());

// ── git ───────────────────────────────────────────────────────────────────
// A commit made in the integrated terminal touches nothing in the working
// tree, so without these two files the branch and the modified count on the
// status bar stay wrong until the folder is reopened.
{
  const p = plan(batch([changed('.git/HEAD')]), state([clean('a.ts')]));
  ok('a branch switch refreshes the git state', p.git, p);
  ok('and does not redraw the tree or touch a tab',
     !p.tree && p.reload.length === 0 && p.ask.length === 0, p);
}

ok('the git index is git news and nothing else',
   (() => {
     const p = plan(batch([changed('.git/index')]), state([clean('a.ts')]));
     return p.git && !p.tree;
   })());

ok('a path merely starting with the four letters .git is an ordinary file',
   (() => {
     const p = plan(batch([changed('.gitignore')]), state([clean('.gitignore')]));
     return p.tree && p.reload.length === 1;
   })());

ok('anything else inside .git that reaches here is still never a tab or the tree',
   (() => {
     const p = plan(batch([changed('.git/objects/ab/cdef')]), state());
     return p.git && !p.tree;
   })());

// ── the app's own writes ──────────────────────────────────────────────────
// Reloading a clean tab that this app has just written is not merely wasted
// work: the reload replaces the whole document and CodeMirror maps the caret
// through it, so saving a file would send the cursor to the end of it.
{
  const ours = new SelfWrites();
  const t0 = 1_000_000;
  ours.note('a.ts', t0);
  const p = plan(batch([changed('a.ts')]),
                 { tabs: [clean('a.ts')], staged: [], ours: { claims: (x) => ours.claims(x, t0 + 100) } });
  ok('a file this app has just written is not reported back to it',
     p.reload.length === 0 && !p.tree && !p.git, p);
}

{
  const ours = new SelfWrites();
  const t0 = 1_000_000;
  ours.note('a.ts', t0);
  ok('the claim expires, so an outside change later is seen',
     !ours.claims('a.ts', t0 + SELF_MS + 1));
  ok('and it holds right up to the edge of the window',
     ours.claims('a.ts', t0 + SELF_MS));
  ok('a path never written is never claimed', !ours.claims('b.ts', t0));
  ok('opening another folder clears every claim',
     (() => { ours.clear(); return !ours.claims('a.ts', t0); })());
}

ok('a claim survives being reported several times, because one write is several events',
   (() => {
     const ours = new SelfWrites();
     ours.note('a.ts', 0);
     return ours.claims('a.ts', 1) && ours.claims('a.ts', 2) && ours.claims('a.ts', 3);
   })());

ok('a claim is matched whichever separators the two sides used',
   (() => {
     const ours = new SelfWrites();
     ours.note('src/app.ts', 0);
     return ours.claims('src\\app.ts', 1);
   })());

ok('muting our own write does not mute somebody else’s in the same batch',
   (() => {
     const ours = new SelfWrites();
     ours.note('a.ts', 0);
     const p = plan(batch([changed('a.ts'), changed('b.ts')]),
                    { tabs: [clean('a.ts'), clean('b.ts')], staged: [],
                      ours: { claims: (x) => ours.claims(x, 1) } });
     return p.reload.length === 1 && p.reload[0] === 'b.ts' && p.tree && p.git;
   })());

ok('a batch with no `ours` at all still plans, rather than throwing',
   (() => {
     const p = plan(batch([changed('a.ts')]), { tabs: [clean('a.ts')], staged: [] });
     return p.reload.length === 1;
   })());

// ── collapsing a batch ────────────────────────────────────────────────────
ok('several events for one path collapse to one, in the position it first appeared',
   (() => {
     const c = collapse([changed('a.ts'), changed('b.ts'), removed('a.ts')]);
     return c.length === 2 && c[0].path === 'a.ts' && c[0].kind === 'removed'
       && c[1].path === 'b.ts';
   })());

ok('collapsing does not mutate what it was given',
   (() => {
     const input = [changed('a.ts'), removed('a.ts')];
     collapse(input);
     return input.length === 2 && input[0].kind === 'changed';
   })());

// ── merging the questions already on screen ───────────────────────────────
ok('a second report about the same file replaces the question rather than stacking one',
   (() => {
     const m = mergeAsks([changed('a.ts')], [removed('a.ts')]);
     return m.length === 1 && m[0].kind === 'removed';
   })());

ok('and a different file adds a second question',
   (() => {
     const m = mergeAsks([changed('a.ts')], [changed('b.ts')]);
     return m.length === 2;
   })());

ok('merging leaves the questions already on screen untouched',
   (() => {
     const open = [changed('a.ts')];
     mergeAsks(open, [removed('a.ts')]);
     return open[0].kind === 'changed';
   })());

// ── a storm ───────────────────────────────────────────────────────────────
// `git checkout` across a large branch. The batch says the world moved and
// does not say where, so no conclusion may be drawn from a path's absence.
{
  const p = plan(batch([], true),
                 state([clean('a.ts'), messy('b.ts'), clean('c.ts')], ['d.ts']));
  ok('a truncated batch reloads every clean tab',
     p.reload.length === 2 && p.reload.includes('a.ts') && p.reload.includes('c.ts'), p);
  ok('asks about every dirty one',
     p.ask.length === 1 && p.ask[0].path === 'b.ts', p);
  ok('re-bases every proposal, and redraws both the tree and the git state',
     p.restage.length === 1 && p.tree && p.git, p);
  ok('and closes nothing, because it does not know that anything is gone',
     p.close.length === 0, p);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
