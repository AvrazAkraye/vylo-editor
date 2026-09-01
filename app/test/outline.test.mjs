// The shape of the file you have open.
//
// Two things here are opinions rather than mechanics, and both are tested as
// such: file order is the default because an outline is a map, and the
// "current" declaration is the last one *starting* at or before the caret,
// because the indexer reports where things start and nothing else.
import { anyMatch, arrange, badgeOf, current, familyOf, tally } from '../.test-build/outline.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const sym = (name, kind, line) => ({ name, kind, path: 'a.ts', line });
const FILE = [
  sym('Props', 'interface', 4),
  sym('MAX', 'const', 9),
  sym('render', 'function', 14),
  sym('Panel', 'class', 30),
  sym('helper', 'function', 52),
];

// ── families ──────────────────────────────────────────────────────────────
// One thing in five languages. An outline that coloured them differently would
// teach the reader the indexer's vocabulary instead of their own file's.
ok('every way of saying "callable" is one family',
   ['fn', 'function', 'def', 'func', 'method'].every((k) => familyOf(k) === 'callable'));
ok('and every way of saying "a type"',
   ['class', 'struct', 'interface', 'trait', 'enum', 'type', 'impl'].every((k) => familyOf(k) === 'type'));
ok('values', ['const', 'var', 'let'].every((k) => familyOf(k) === 'value'));
ok('sections, markdown headings included',
   ['mod', 'module', 'namespace', 'heading'].every((k) => familyOf(k) === 'section'));
ok('case does not matter', familyOf('Function') === 'callable');
// A language added to the indexer must not land in a blank family.
ok('an unknown kind is "other", not undefined', familyOf('macro') === 'other');
ok('and so is an empty one', familyOf('') === 'other');

// ── the badge ─────────────────────────────────────────────────────────────
ok('the badge is the kind first letter', badgeOf('function') === 'f' && badgeOf('type') === 't');
ok('lowercased', badgeOf('Class') === 'c');
ok('and space-trimmed', badgeOf('  enum') === 'e');
// A new language gets a sensible badge without this file being edited.
ok('an unknown kind still gets a badge', badgeOf('macro') === 'm');
ok('an empty kind does not produce undefined', badgeOf('') === '?');

// ── order ─────────────────────────────────────────────────────────────────
{
  // An outline is a map. Sorting it alphabetically throws away the only thing
  // a map has.
  const rows = arrange(FILE);
  ok('file order is the default', rows.map((r) => r.name).join() === 'Props,MAX,render,Panel,helper');
  ok('even when the input is not in order',
     arrange([...FILE].reverse()).map((r) => r.line).join() === '4,9,14,30,52');
  // `localeCompare`, so `helper` sorts before `MAX` — alphabetical the way a
  // reader means it, not the way ASCII does, where every capital precedes
  // every lowercase and the list splits into two alphabets.
  ok('alphabetical is available for the other job, and ignores case',
     arrange(FILE, { order: 'name' }).map((r) => r.name).join() === 'helper,MAX,Panel,Props,render',
     arrange(FILE, { order: 'name' }).map((r) => r.name));
  ok('and ties in a name sort fall back to the line', (() => {
    const dup = [sym('x', 'const', 20), sym('x', 'const', 5)];
    return arrange(dup, { order: 'name' }).map((r) => r.line).join() === '5,20';
  })());
  ok('arranging does not mutate the input', FILE[0].name === 'Props' && FILE.length === 5);
  ok('every row carries its family', rows.every((r) => typeof r.family === 'string'));
  ok('an empty file is an empty outline', arrange([]).length === 0);
}

// ── filtering ─────────────────────────────────────────────────────────────
{
  const rows = arrange(FILE, { query: 'ren' });
  ok('a query filters', rows.length >= 1 && rows.some((r) => r.name === 'render'));
  ok('and it is a subsequence match, as the palette is',
     arrange(FILE, { query: 'pnl' }).some((r) => r.name === 'Panel'));
  ok('a query that matches nothing gives nothing', arrange(FILE, { query: 'zzzz' }).length === 0);
  ok('whitespace is not a query', arrange(FILE, { query: '   ' }).length === 5);
}
// `rank` caps at forty, which is right for a palette and wrong for a filter:
// stopping silently at forty hides the match somebody was looking for.
ok('a filter in a large file is not capped at forty', (() => {
  const many = Array.from({ length: 120 }, (_, i) => sym(`handle${i}`, 'function', i + 1));
  return arrange(many, { query: 'handle' }).length === 120;
})(), arrange(Array.from({ length: 120 }, (_, i) => sym(`handle${i}`, 'function', i + 1)), { query: 'handle' }).length);
ok('and neither is an unfiltered one', (() => {
  const many = Array.from({ length: 120 }, (_, i) => sym(`a${i}`, 'function', i + 1));
  return arrange(many).length === 120;
})());

// ── where the caret is ────────────────────────────────────────────────────
ok('nothing before the first declaration', current(FILE, 2) === null);
ok('and nothing at line zero', current(FILE, 0) === null);
ok('on the line itself', current(FILE, 4)?.name === 'Props');
ok('inside a declaration', current(FILE, 20)?.name === 'render');
// Past the end of a function and before the next, every editor still names the
// one you just left. Occasionally wrong, never confusing.
ok('between two declarations it names the one above', current(FILE, 29)?.name === 'render');
ok('past the last one it names the last one', current(FILE, 9999)?.name === 'helper');
ok('an empty outline has no current symbol', current([], 10) === null);
ok('two declarations on one line take the later in file order', (() => {
  const two = [sym('x', 'const', 7), sym('y', 'function', 7)];
  return current(two, 7)?.name === 'y';
})());
{
  const rows = arrange(FILE, { cursor: 20 });
  ok('the current row is marked', rows.filter((r) => r.here).length === 1);
  ok('and it is the right one', rows.find((r) => r.here)?.name === 'render');
  ok('no cursor marks nothing', arrange(FILE).every((r) => !r.here));
}

// ── the tally ─────────────────────────────────────────────────────────────
{
  const t = tally(FILE);
  ok('families are counted', t.find((x) => x.family === 'callable')?.n === 2, t);
  ok('and empty families are not listed', t.every((x) => x.n > 0));
  ok('in a fixed order, so the heading does not reshuffle',
     tally([sym('a', 'const', 1), sym('B', 'class', 2), sym('c', 'fn', 3)])
       .map((x) => x.family).join() === 'type,callable,value');
  ok('nothing counts as nothing', tally([]).length === 0);
}

// ── the empty state's wording ─────────────────────────────────────────────
// "No matches" and "nothing here" are different sentences, and saying the
// first when somebody has not typed anything is telling them their search
// failed when they never made one.
ok('no query always matches', anyMatch(FILE, '') === true && anyMatch([], '  ') === true);
ok('a query that hits says so', anyMatch(FILE, 'ren') === true);
ok('and one that misses says so', anyMatch(FILE, 'zzzz') === false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
