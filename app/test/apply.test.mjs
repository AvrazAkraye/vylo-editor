// Applying a code block from a reply.
//
// Two failures matter here and neither is visible. Picking the wrong target
// file stages an edit against something the reply was not about; and an empty
// or malformed SEARCH block matches everywhere, which is not an edit but a way
// to corrupt a file at a position nobody chose.
import { applyMessages, applyTarget, parseApply } from '../.test-build/apply.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FILES = new Set(['src/App.tsx', 'src/agent.ts', 'README.md', 'Cargo.toml']);
const exists = (p) => FILES.has(p);
const target = (info, before, open = null) => applyTarget(info, before, open, exists);

// ── choosing the file ─────────────────────────────────────────────────────
ok('a path in the fence info wins', target('ts src/App.tsx', '', 'README.md') === 'src/App.tsx');
ok('a bare path in the fence info works', target('src/agent.ts', '', null) === 'src/agent.ts');
ok('a language alone is not a path', target('typescript', '', null) === null);
ok('an unknown path in the info is ignored', target('ts src/nope.ts', '', 'README.md') === 'README.md');

ok('a backticked path in the prose above is used',
   target('ts', 'Change this in `src/agent.ts`:', 'README.md') === 'src/agent.ts');
ok('a bare path in the prose above is used',
   target('ts', 'In src/agent.ts you would write:', null) === 'src/agent.ts');
ok('the nearest mention wins',
   target('ts', 'First README.md.\nThen in `src/agent.ts`:', null) === 'src/agent.ts',
   target('ts', 'First README.md.\nThen in `src/agent.ts`:', null));
ok('prose further back than a few lines is not used',
   target('ts', 'src/agent.ts\n\n\n\n\nand now:', 'README.md') === 'README.md');

ok('the open file is the fallback', target('ts', 'do this:', 'src/App.tsx') === 'src/App.tsx');
ok('with no clue at all there is no target', target('ts', 'do this:', null) === null);
ok('an open file that no longer exists is not used', target('ts', '', 'src/gone.ts') === null);
ok('a directory-looking token is not a file', target('ts src/', '', null) === null);

// ── parsing the edit ──────────────────────────────────────────────────────
const B = (a, b) => `<<<<<<< SEARCH\n${a}\n=======\n${b}\n>>>>>>> REPLACE`;

{
  const r = parseApply(B('const a = 1;', 'const a = 2;'));
  ok('one block parses', r.length === 1 && r[0].old === 'const a = 1;' && r[0].replacement === 'const a = 2;', r);
}
{
  const r = parseApply(`${B('a', 'A')}\n\n${B('b', 'B')}`);
  ok('several blocks parse in order',
     r.length === 2 && r[0].old === 'a' && r[1].replacement === 'B', r);
}
{
  const r = parseApply(`Here you go:\n\n${B('x', 'y')}\n\nThat should do it.`);
  ok('prose around the blocks is ignored', r.length === 1 && r[0].old === 'x', r);
}
{
  const multi = parseApply(B('function f() {\n  return 1;\n}', 'function f() {\n  return 2;\n}'));
  ok('multi-line content survives, indentation included',
     multi[0].old === 'function f() {\n  return 1;\n}'
     && multi[0].replacement.includes('  return 2;'), multi);
}
ok('CRLF is tolerated', parseApply(B('a', 'b').replace(/\n/g, '\r\n'))[0]?.old === 'a');
ok('a deletion is a valid edit', parseApply(B('gone();', ''))[0]?.replacement === '');

// ── what must not parse ───────────────────────────────────────────────────
ok('an empty SEARCH is refused', parseApply(B('   ', 'anything')).length === 0,
   parseApply(B('   ', 'anything')));
ok('no markers means no edits', parseApply('just some prose').length === 0);
ok('a block with no divider is refused',
   parseApply('<<<<<<< SEARCH\na\n>>>>>>> REPLACE').length === 0);
ok('an unterminated block is refused',
   parseApply('<<<<<<< SEARCH\na\n=======\nb').length === 0);
{
  // A divider inside the replacement must not end the block early.
  const r = parseApply('<<<<<<< SEARCH\nold\n=======\nnew\nmore new\n>>>>>>> REPLACE');
  ok('content after the divider is all replacement',
     r[0]?.replacement === 'new\nmore new', r);
}
ok('empty input is empty output', parseApply('').length === 0);

// ── the prompt ────────────────────────────────────────────────────────────
{
  const m = applyMessages({ path: 'src/a.ts', language: 'typescript', file: 'const a = 1;', snippet: 'const a = 2;' });
  ok('the file and the snippet are both sent',
     m.user.includes('<current_file>') && m.user.includes('<proposed_snippet>'));
  ok('the format is specified in the system prompt', m.system.includes('<<<<<<< SEARCH'));
  ok('uniqueness is demanded, since stageEdit enforces it',
     /exactly once/.test(m.system));
  ok('an unknown language is omitted rather than sent blank',
     !applyMessages({ path: 'a', language: '', file: 'x', snippet: 'y' }).user.includes('Language:'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
