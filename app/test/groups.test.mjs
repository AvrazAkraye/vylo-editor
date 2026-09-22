// Folders of terminals, and folders inside those.
//
// The model is a path rather than a tree of objects, and the reason is the
// restart: `newTab` mints a fresh id every launch, so a tree keyed by id comes
// back pointing at nothing while the sessions it described sit right there,
// restored by name. A path is already part of what a session saves.
//
// So most of this file is path arithmetic, and the cases that matter are the
// ones where a path is not a string: `apidocs` is not inside `api`, a name
// with a separator in it is two names, and a group four deep is three deep.
import {
  LAUNCH, MAX_DEPTH, MAX_NAME, SEP, all, ancestors, clean, depthOf, join,
  nameOf, nodes, parentOf, parts, renamed, tidy, under,
} from '../.test-build/groups.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (xs, ys) => JSON.stringify(xs) === JSON.stringify(ys);
const s = (id, group) => ({ id, ...(group === undefined ? {} : { group }) });

// ── one name ──────────────────────────────────────────────────────────────
ok('a plain name is itself', clean('api') === 'api');
ok('and is trimmed', clean('  api  ') === 'api');
// The separator is the one character a name cannot contain. Removing it would
// silently join two words that were not joined.
ok('a separator becomes a space', clean('api/tests') === 'api tests');
ok('and so does a run of them', clean('a//b') === 'a b');
ok('inner whitespace collapses', clean('the   build  watcher') === 'the build watcher');
ok('control characters are not a name', clean('a\u0000b\nc') === 'a b c');
ok('nothing is nothing', clean('') === '' && clean('   ') === '' && clean(SEP) === '');
ok('a non-string is nothing, not a crash',
   [null, undefined, 42, {}].every((x) => clean(x) === ''));
// Somebody pasting a folder path into the name box gets the start of it, which
// is usually the part that identifies it.
ok('a long name is cut, not refused', clean('x'.repeat(80)).length === MAX_NAME);
ok('and not left with a trailing space', clean(`${'x'.repeat(MAX_NAME - 1)} yyy`).endsWith('x'));

// ── paths ─────────────────────────────────────────────────────────────────
ok('a path is its segments', same(parts('api/tests'), ['api', 'tests']));
ok('empties are dropped', same(parts('/api//tests/'), ['api', 'tests']));
ok('nothing is no segments', same(parts(''), []) && same(parts(null), []));
ok('tidy rebuilds it', tidy('/api//tests/') === 'api/tests');
ok('and trims each segment', tidy(' api / tests ') === 'api/tests');
ok('the name is the last segment', nameOf('api/tests') === 'tests');
ok('and of a top-level group, itself', nameOf('api') === 'api');
ok('nothing has no name', nameOf('') === '');
ok('the parent is everything above', parentOf('api/tests/unit') === 'api/tests');
ok('a top-level group has no parent', parentOf('api') === '');
ok('depth counts the segments', depthOf('') === 0 && depthOf('api') === 1 && depthOf('api/tests') === 2);

// ── the cap ───────────────────────────────────────────────────────────────
ok('three levels', MAX_DEPTH === 3);
ok('a deeper path is cut to it', depthOf(tidy('a/b/c/d/e')) === MAX_DEPTH);
ok('and keeps the outermost', same(parts('a/b/c/d'), ['a', 'b', 'c']));
// A button that does nothing is worse than one that does the nearest possible
// thing: at the cap the new name replaces the deepest segment.
ok('joining at the cap replaces the deepest', join('a/b/c', 'd') === 'a/b/d');
ok('joining below it appends', join('a/b', 'c') === 'a/b/c');
ok('joining onto nothing is a top-level group', join('', 'api') === 'api');
ok('a name that cleans to nothing changes nothing', join('a/b', '   ') === 'a/b');
ok('and a name with a separator is one segment', join('a', 'b/c') === 'a/b c');

// ── ancestors ─────────────────────────────────────────────────────────────
ok('every group above, outermost first', same(ancestors('a/b/c'), ['a', 'a/b', 'a/b/c']));
ok('a top-level group is its own only ancestor', same(ancestors('a'), ['a']));
ok('nothing has none', same(ancestors(''), []));

// ── inside ────────────────────────────────────────────────────────────────
// `startsWith` would say that `apidocs` is inside `api`, which is the bug this
// function exists to not have.
ok('a child is inside its parent', under('api/tests', 'api'));
ok('and a grandchild is', under('api/tests/unit', 'api'));
ok('a group is inside itself', under('api', 'api'));
ok('a sibling is not', !under('web', 'api'));
ok('and neither is a name that merely starts the same', !under('apidocs', 'api'));
ok('nor the parent inside the child', !under('api', 'api/tests'));
ok('everything is inside nothing', under('api', '') && under('', ''));

// ── renaming ──────────────────────────────────────────────────────────────
ok('the group itself is renamed', renamed('api', 'api', 'server') === 'server');
ok('and everything under it', renamed('api/tests', 'api', 'server') === 'server/tests');
ok('two levels down as well', renamed('api/tests/unit', 'api', 'server') === 'server/tests/unit');
ok('something outside is untouched', renamed('web', 'api', 'server') === 'web');
ok('and a name that merely starts the same', renamed('apidocs', 'api', 'server') === 'apidocs');
// Moving a group into another is the same rewrite.
ok('moving a group carries its children', renamed('api/tests', 'api', 'work/api') === 'work/api/tests');
ok('and the result is still capped', depthOf(renamed('api/tests/unit', 'api', 'work/api')) === MAX_DEPTH);
ok('renaming from nothing changes nothing', renamed('api', '', 'x') === 'api');

// ── which groups exist ────────────────────────────────────────────────────
{
  // A session in `api/tests` puts `api` on the list whether or not anything
  // else did: a path with a missing middle cannot be drawn.
  const got = all([], [s('t1', 'api/tests')]);
  ok('a session creates its ancestors', same(got, ['api', 'api/tests']), got);
}
ok('an empty group is kept, because nothing carries its path',
   same(all(['scratch'], []), ['scratch']));
ok('and its ancestors too', same(all(['a/b/c'], []), ['a', 'a/b', 'a/b/c']));
ok('loose sessions create nothing', same(all([], [s('t1'), s('t2', '')]), []));
{
  const got = all(['web'], [s('t1', 'api'), s('t2', 'api'), s('t3', 'web/ui')]);
  // Sorted by path, which puts a parent immediately before its children.
  ok('every group once, parents before children', same(got, ['api', 'web', 'web/ui']), got);
}
ok('rubbish in the lists is ignored',
   same(all([null, 42, ''], [null, { id: 'x' }, s('y', 'ok')]), ['ok']));

// ── the rail ──────────────────────────────────────────────────────────────
const kinds = (ns) => ns.map((n) => (n.kind === 'group' ? `[${n.name}@${n.depth}]` : `${n.id}@${n.depth}`)).join(' ');
{
  const ns = nodes([], [s('t1'), s('t2')]);
  ok('no groups is the flat list it was', kinds(ns) === 't1@1 t2@1', kinds(ns));
}
{
  const ns = nodes(['api'], [s('t1', 'api'), s('t2')]);
  // A session inside a group is one deeper than the group, which is what puts
  // it under the name rather than beside it.
  ok('a group holds its sessions one deeper', kinds(ns) === '[api@1] t1@2 t2@1', kinds(ns));
}
{
  // Loose sessions last: putting them first would push every named group below
  // the fold in a rail that has any.
  const ns = nodes([], [s('loose'), s('t1', 'api')]);
  ok('loose sessions come last', kinds(ns) === '[api@1] t1@2 loose@1', kinds(ns));
}
{
  const ns = nodes([], [s('t1', 'api'), s('t2', 'api/tests')]);
  // Sub-groups before sessions, which is what every tree the person already
  // uses does.
  ok('a sub-group is drawn before its parent’s own sessions',
     kinds(ns) === '[api@1] [tests@2] t2@3 t1@2', kinds(ns));
}
{
  const ns = nodes(['api'], [s('t1', 'api'), s('t2', 'api/tests')], new Set(['api']));
  ok('a shut group draws its header and nothing else', kinds(ns) === '[api@1]', kinds(ns));
  ok('and reports everything beneath it', ns[0].count === 2, ns[0]);
}
{
  const ns = nodes([], [s('t1', 'api/tests')]);
  const api = ns.find((n) => n.kind === 'group' && n.name === 'api');
  ok('a group counts its descendants, not just its own', api.count === 1, api);
}
{
  const ns = nodes(['empty'], []);
  ok('an empty group still draws', kinds(ns) === '[empty@1]', kinds(ns));
  ok('and says it holds nothing', ns[0].count === 0);
}
{
  // A row that jumps position when a group is opened is a row you have to find
  // again every time.
  const order = [s('c', 'g'), s('a', 'g'), s('b', 'g')];
  const ns = nodes(['g'], order);
  ok('sessions keep the list order they were given',
     kinds(ns) === '[g@1] c@2 a@2 b@2', kinds(ns));
}
ok('every session is drawn exactly once', (() => {
  const list = [s('a'), s('b', 'x'), s('c', 'x/y'), s('d', 'z'), s('e')];
  const ns = nodes(['w'], list);
  const ids = ns.filter((n) => n.kind === 'session').map((n) => n.id).sort();
  return same(ids, ['a', 'b', 'c', 'd', 'e']);
})());
ok('a shut group hides its sessions and nothing else’s', (() => {
  const ns = nodes([], [s('a', 'x'), s('b', 'y')], new Set(['x']));
  return kinds(ns) === '[x@1] [y@1] b@2';
})(), kinds(nodes([], [s('a', 'x'), s('b', 'y')], new Set(['x']))));
ok('no group is drawn twice', (() => {
  const ns = nodes(['api', 'api'], [s('a', 'api'), s('b', 'api')]);
  return ns.filter((n) => n.kind === 'group').length === 1;
})());
ok('nothing at all is no rows', same(nodes([], []), []));

// ── the launch counts ─────────────────────────────────────────────────────
// One, then the counts that are a shape: a pair, the row full, the grid full.
ok('four offers', same(LAUNCH, [1, 2, 4, 6]));
ok('and every one of them is a count the panes can hold', LAUNCH.every((n) => n >= 1 && n <= 6));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
