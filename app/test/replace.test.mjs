// Replace across files.
//
// This rewrites every matching file in a project at once, so the failures worth
// guarding are the ones that are invisible in a diff nobody reads: replacing
// inside the replacement for ever, and a whole-word match that skips the
// occurrence right after a rejected one.
import { countIn, replaceAll } from '../.test-build/replace.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the basics ────────────────────────────────────────────────────────────
{
  const r = replaceAll('a b a', 'a', 'X');
  ok('every occurrence goes', r.text === 'X b X' && r.count === 2, r);
}
ok('no match changes nothing',
   JSON.stringify(replaceAll('abc', 'zzz', 'X')) === JSON.stringify({ text: 'abc', count: 0 }));
ok('an empty needle is refused rather than looping',
   JSON.stringify(replaceAll('abc', '', 'X')) === JSON.stringify({ text: 'abc', count: 0 }));
ok('replacing with nothing deletes',
   replaceAll('keep-drop-keep', 'drop-', '').text === 'keep-keep');
ok('it is literal, not a regex',
   replaceAll('a.c abc', 'a.c', 'X').text === 'X abc', replaceAll('a.c abc', 'a.c', 'X'));

// ── the one that would never terminate ────────────────────────────────────
{
  // Renaming `id` to `userId` puts the needle inside the replacement. Scanning
  // from after the match rather than after the insertion loops for ever.
  const r = replaceAll('id, id', 'id', 'userId');
  ok('a replacement containing the needle is not rewritten',
     r.text === 'userId, userId' && r.count === 2, r);
}
{
  const r = replaceAll('aaa', 'a', 'aa');
  ok('and growth does not run away', r.text === 'aaaaaa' && r.count === 3, r);
}

// ── case ──────────────────────────────────────────────────────────────────
ok('case matters by default', replaceAll('Foo foo', 'foo', 'bar').text === 'Foo bar');
{
  const r = replaceAll('Foo foo FOO', 'foo', 'bar', { fold: true });
  ok('folding matches every case', r.count === 3, r);
  ok('and inserts the replacement verbatim rather than guessing at case',
     r.text === 'bar bar bar', r.text);
}

// ── whole word ────────────────────────────────────────────────────────────
{
  const r = replaceAll('id, grid, id_x, myid, id', 'id', 'X', { words: true });
  ok('only standalone words are replaced', r.text === 'X, grid, id_x, myid, X', r.text);
  ok('and the count matches', r.count === 2, r);
}
{
  // `griid id` — the rejected match inside `griid` must not consume the real
  // one that follows. Stepping past the whole rejected match would skip it.
  const r = replaceAll('iid id', 'id', 'X', { words: true });
  ok('a rejected match does not swallow the next one', r.text === 'iid X', r.text);
}
ok('whole word and folding together',
   replaceAll('ID id GRID', 'id', 'X', { words: true, fold: true }).text === 'X X GRID');

// ── realistic ─────────────────────────────────────────────────────────────
{
  const src = 'const oldName = 1;\nfunction oldName() {}\n// oldNameSuffix stays\n';
  const r = replaceAll(src, 'oldName', 'newName', { words: true });
  ok('a rename touches the identifier and not what contains it',
     r.text === 'const newName = 1;\nfunction newName() {}\n// oldNameSuffix stays\n', r.text);
  ok('and reports how many', r.count === 2, r);
}
{
  const multi = 'line one\nline two\nline one\n';
  ok('multi-line text is fine', replaceAll(multi, 'line one', 'X').count === 2);
  ok('newlines survive', replaceAll(multi, 'one', '1').text === 'line 1\nline two\nline 1\n');
}

// ── counting is the same operation ────────────────────────────────────────
ok('counting agrees with replacing', countIn('a b a', 'a') === 2);
ok('counting respects whole word', countIn('id grid', 'id', { words: true }) === 1);
ok('counting does not need a replacement that fits', countIn('aaa', 'a') === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
