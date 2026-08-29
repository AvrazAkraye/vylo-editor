// Ranking, not filtering, is what makes ⌘P useful — almost everything matches a
// short query, so these check the ORDER rather than the membership.
import { score, rank, positions } from '../.test-build/fuzzy.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const FILES = [
  'app/src/App.tsx', 'app/src/agent.ts', 'app/src/attachments.ts',
  'app/src/TerminalPanel.tsx', 'app/src/TerminalView.tsx', 'app/src/pending.ts',
  'app/src-tauri/src/pty.rs', 'app/src-tauri/src/lib.rs', 'docs/PRD.md',
  'app/src/styles.css', 'app/test/diff.test.mjs',
];
const top = (q, n = 1) => rank(q, FILES, (f) => f, n);

ok('non-subsequence does not match', score('zzz', 'app/src/App.tsx') === null);
ok('empty query matches everything', score('', 'anything') === 0);

ok('exact file name wins', top('App.tsx')[0] === 'app/src/App.tsx', top('App.tsx', 3).join(', '));
ok('segment initials work', top('aspty')[0] === 'app/src-tauri/src/pty.rs', top('aspty', 3).join(', '));
ok('file name beats the same letters in the path',
   top('agent')[0] === 'app/src/agent.ts', top('agent', 3).join(', '));
ok('shorter path breaks a tie',
   score('pty', 'app/src-tauri/src/pty.rs') > score('pty', 'app/src-tauri/src/deeply/nested/pty.rs'));

// Both terminal files match "term"; the shorter name should come first.
{
  const r = rank('terminal', FILES, (f) => f, 2);
  ok('both terminal files surface', r.length === 2 && r.every((f) => f.includes('Terminal')), r.join(', '));
}

ok('camelCase hump scores above a mid-word letter',
   score('tp', 'TerminalPanel.tsx') > score('tp', 'atypical.ts'),
   `${score('tp', 'TerminalPanel.tsx')} vs ${score('tp', 'atypical.ts')}`);

ok('positions line up with the query', JSON.stringify(positions('apx', 'app/x.ts')) === '[0,1,4]',
   JSON.stringify(positions('apx', 'app/x.ts')));
ok('positions empty when it does not match', positions('zq', 'app.ts').length === 0);

ok('limit is respected', rank('s', FILES, (f) => f, 3).length === 3);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
