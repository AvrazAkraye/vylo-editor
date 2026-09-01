// Telling everything that has a file open that the file just changed.
//
// Small, and every test here is about a way a naive `Set.forEach` gets it
// wrong: unsubscribing mid-broadcast, a listener that throws, two watchers on
// one path, cleanup.
import { changed, watch, watching } from '../.test-build/docs.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const F = '.vylo/TODO.md';

// ── the ordinary case ─────────────────────────────────────────────────────
{
  let got = null;
  const off = watch(F, (text) => { got = text; });
  changed(F, '- [x] done');
  ok('a watcher hears about a write', got === '- [x] done');
  off();
  changed(F, 'later');
  ok('and stops hearing once it unsubscribes', got === '- [x] done');
  ok('and is no longer counted', watching(F) === 0);
}

// ── the case this exists for: the same file open twice ────────────────────
{
  const heard = [];
  const a = watch(F, (t) => heard.push(`a:${t}`));
  const b = watch(F, (t) => heard.push(`b:${t}`));
  ok('two panels can watch one file', watching(F) === 2);
  changed(F, 'x');
  ok('and both hear about it', heard.join() === 'a:x,b:x', heard);
  a(); b();
  ok('cleanup leaves nothing behind', watching(F) === 0);
}

// ── paths do not bleed into each other ────────────────────────────────────
{
  let todo = 0, other = 0;
  const a = watch(F, () => { todo++; });
  const b = watch('VYLO.md', () => { other++; });
  changed('VYLO.md', 'memory');
  ok('a write to one file does not wake watchers of another', todo === 0 && other === 1);
  a(); b();
}
ok('a write nobody is watching is not an error', (() => {
  changed('nothing/watched.txt', 'x');
  return true;
})());

// ── a listener that unsubscribes while it is being called ─────────────────
// A panel that reacts by unmounting is an ordinary thing to write, and it must
// not silently skip whoever came after it in the set.
{
  const heard = [];
  let off1;
  off1 = watch(F, (t) => { heard.push(`one:${t}`); off1(); });
  const off2 = watch(F, (t) => { heard.push(`two:${t}`); });
  changed(F, 'x');
  ok('everyone still hears the broadcast it happened during',
     heard.join() === 'one:x,two:x', heard);
  ok('and the one that left is gone next time', (() => {
    heard.length = 0;
    changed(F, 'y');
    return heard.join() === 'two:y';
  })(), heard);
  off2();
}

// ── a listener that throws ────────────────────────────────────────────────
// One panel with a bug must not leave every other panel stale.
{
  const heard = [];
  const a = watch(F, () => { throw new Error('boom'); });
  const b = watch(F, (t) => heard.push(t));
  let threw = false;
  try { changed(F, 'x'); } catch { threw = true; }
  ok('a throwing listener does not stop the others', heard.join() === 'x', heard);
  ok('and does not escape to the caller', threw === false);
  a(); b();
}

// ── unsubscribing twice, and out of order ─────────────────────────────────
{
  const off = watch(F, () => {});
  off();
  off();
  ok('unsubscribing twice is not an error', watching(F) === 0);
}
{
  const a = watch(F, () => {});
  const b = watch(F, () => {});
  b(); a();
  ok('unsubscribing out of order still cleans up', watching(F) === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
