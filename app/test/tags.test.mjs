// Colour tags on chats and terminal sessions.
//
// Small, and the interesting half is what happens to a value that did not come
// from this code: the store is JSON a person can edit and an older build can
// write, so `tagOf` is the only thing standing between a bad string and a list
// that will not render.
import { TAGS, SWATCHES, LABELS, tagOf, tagClass, nextTag } from '../.test-build/tags.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the set ───────────────────────────────────────────────────────────────
ok('nine values, eight of them colours', TAGS.length === 9 && SWATCHES.length === 8);
ok('none is first, because clearing is a choice and choices go where you look',
   TAGS[0] === 'none');
ok('and none is not offered as a swatch', !SWATCHES.includes('none'));
ok('every tag has a label, which is also its i18n key',
   TAGS.every((t) => typeof LABELS[t] === 'string' && LABELS[t].length > 0));
ok('no two tags share a label', new Set(Object.values(LABELS)).size === TAGS.length);

// ── anything can arrive from the store ────────────────────────────────────
ok('a real tag survives', tagOf('violet') === 'violet');
ok('undefined is none', tagOf(undefined) === 'none');
ok('null is none', tagOf(null) === 'none');
// An older build, a hand-edited file, or a rename in this file: all arrive the
// same way, and none of them may stop a list from rendering.
ok('a name nobody recognises is none, not an error', tagOf('chartreuse') === 'none');
ok('a number is none', tagOf(7) === 'none');
ok('an object is none', tagOf({ tag: 'red' }) === 'none');
ok('the empty string is none', tagOf('') === 'none');
ok('case matters, because the stored value is the name', tagOf('Red') === 'none');

// ── what the row gets ─────────────────────────────────────────────────────
ok('a tag becomes a class', tagClass('teal') === 'tag-teal');
ok('none draws nothing', tagClass('none') === '');
ok('and so does rubbish', tagClass('nonsense') === '' && tagClass(undefined) === '');
ok('every swatch produces a distinct class',
   new Set(SWATCHES.map(tagClass)).size === SWATCHES.length);

// ── cycling ───────────────────────────────────────────────────────────────
ok('cycling moves one along', nextTag('none') === TAGS[1]);
// The ring passes back through `none`, so a keystroke can always reach "no
// colour" — otherwise somebody who cycled in has to use the mouse to get out.
ok('the last wraps to none', nextTag(TAGS[TAGS.length - 1]) === 'none');
ok('cycling from rubbish starts at the beginning', nextTag('nonsense') === TAGS[1]);
ok('nine steps returns where it started', (() => {
  let t = 'red';
  for (let i = 0; i < TAGS.length; i++) t = nextTag(t);
  return t === 'red';
})());
ok('the cycle visits every tag exactly once', (() => {
  const seen = new Set();
  let t = 'none';
  for (let i = 0; i < TAGS.length; i++) { seen.add(t); t = nextTag(t); }
  return seen.size === TAGS.length;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
