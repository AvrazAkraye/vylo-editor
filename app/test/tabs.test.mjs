// What a tab's menu does.
//
// Four operations that read as obvious and are not. Each test below is a case
// where the obvious implementation loses somebody's arrangement or shows them
// the wrong file afterwards.
import {
  after, arrange, folderOf, isPinned, nameOf, nextActive, others, togglePin,
} from '../.test-build/tabs.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const TABS = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'];

// ── pinning ───────────────────────────────────────────────────────────────
ok('nothing is pinned to begin with', isPinned([], 'a.ts') === false);
ok('pinning pins', togglePin([], 'a.ts').join() === 'a.ts');
ok('pinning again unpins', togglePin(['a.ts'], 'a.ts').length === 0);
ok('the newest pin is last', togglePin(['a.ts'], 'b.ts').join() === 'a.ts,b.ts');
ok('unpinning the middle leaves the order', togglePin(['a', 'b', 'c'], 'b').join() === 'a,c');
ok('pinning does not mutate', (() => {
  const src = ['a'];
  togglePin(src, 'b');
  return src.length === 1;
})());

// ── the strip's order ─────────────────────────────────────────────────────
// Pinning a tab moves that one tab and disturbs nothing else.
ok('pinned tabs come first', arrange(TABS, ['d.ts']).join() === 'd.ts,a.ts,b.ts,c.ts,e.ts');
ok('and keep the order they were pinned in',
   arrange(TABS, ['d.ts', 'b.ts']).join() === 'd.ts,b.ts,a.ts,c.ts,e.ts');
ok('the rest keep the order they had',
   arrange(TABS, ['c.ts']).slice(1).join() === 'a.ts,b.ts,d.ts,e.ts');
ok('nothing pinned is the order unchanged', arrange(TABS, []).join() === TABS.join());
// Closing and reopening a file should find it still pinned.
ok('a pinned tab that is not open is ignored, not dropped',
   arrange(TABS, ['zzz.ts', 'b.ts']).join() === 'b.ts,a.ts,c.ts,d.ts,e.ts');
ok('everything pinned is everything, in pin order',
   arrange(TABS, [...TABS].reverse()).join() === [...TABS].reverse().join());
ok('arranging does not mutate', (() => { arrange(TABS, ['c.ts']); return TABS[0] === 'a.ts'; })());

// ── close others ──────────────────────────────────────────────────────────
ok('everything but the one kept', others(TABS, 'c.ts').join() === 'a.ts,b.ts,d.ts,e.ts');
// Pinning is somebody saying "keep this", and the bulk close is the action
// people reach for most — the two would meet immediately.
ok('never a pinned tab', others(TABS, 'c.ts', ['a.ts', 'e.ts']).join() === 'b.ts,d.ts');
ok('keeping a pinned tab is not a contradiction',
   others(TABS, 'a.ts', ['a.ts']).join() === 'b.ts,c.ts,d.ts,e.ts');
ok('everything pinned closes nothing', others(TABS, 'c.ts', TABS).length === 0);
ok('a lone tab has no others', others(['a.ts'], 'a.ts').length === 0);
ok('a tab that is not there closes everything else',
   others(TABS, 'zzz').length === 5);

// ── close to the right ────────────────────────────────────────────────────
ok('everything after it', after(TABS, 'c.ts').join() === 'd.ts,e.ts');
ok('nothing after the last one', after(TABS, 'e.ts').length === 0);
ok('everything after the first', after(TABS, 'a.ts').length === 4);
ok('a pinned tab to the right survives', after(TABS, 'b.ts', ['d.ts']).join() === 'c.ts,e.ts');
ok('a tab that is not there closes nothing', after(TABS, 'zzz').length === 0);

// ── what to show afterwards ───────────────────────────────────────────────
// Jumping to the first tab after closing the ninth is disorienting in a way
// that is hard to name and easy to feel.
ok('closing something else leaves the active tab alone',
   nextActive(TABS, ['a.ts'], 'c.ts') === 'c.ts');
ok('closing the active one moves right', nextActive(TABS, ['c.ts'], 'c.ts') === 'd.ts');
ok('and left when there is no right', nextActive(TABS, ['e.ts'], 'e.ts') === 'd.ts');
ok('past a run of closed ones to the right',
   nextActive(TABS, ['c.ts', 'd.ts'], 'c.ts') === 'e.ts');
ok('and back to the left when everything right went',
   nextActive(TABS, ['c.ts', 'd.ts', 'e.ts'], 'c.ts') === 'b.ts');
ok('closing everything leaves nothing', nextActive(TABS, TABS, 'c.ts') === null);
ok('closing everything but one lands on it',
   nextActive(TABS, others(TABS, 'b.ts'), 'c.ts') === 'b.ts');
ok('an empty strip is nothing', nextActive([], [], 'a') === null || nextActive([], [], 'a') === 'a');

// ── naming ────────────────────────────────────────────────────────────────
ok('the name is the last part', nameOf('src/app/main.ts') === 'main.ts');
ok('a bare name is itself', nameOf('README.md') === 'README.md');
ok('a trailing slash does not give an empty name', nameOf('src/') === 'src/');
ok('the folder is everything before it', folderOf('src/app/main.ts') === 'src/app');
ok('a file at the root has no folder', folderOf('README.md') === '');
ok('and a leading slash is not a folder', folderOf('/main.ts') === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
