// ⌘K: turning what the model said into something safe to drop into a buffer.
//
// The output goes straight into someone's open file, so the failure that
// matters is not a bad edit — you can see and reject that — it is an edit that
// looks right and quietly duplicates code sitting just outside the region being
// replaced. Every rule here exists because a model does the thing it removes.
import { cleanEdit, contextAround, editMessages, editSize } from '../.test-build/inline.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── fences ────────────────────────────────────────────────────────────────
ok('plain text passes through', cleanEdit('const x = 1;') === 'const x = 1;');
ok('a fenced block is unwrapped',
   cleanEdit('```ts\nconst x = 1;\n```') === 'const x = 1;', cleanEdit('```ts\nconst x = 1;\n```'));
ok('a fence with no language is unwrapped',
   cleanEdit('```\na();\nb();\n```') === 'a();\nb();', cleanEdit('```\na();\nb();\n```'));
ok('an unopened closing fence is dropped',
   cleanEdit('a();\n```') === 'a();', cleanEdit('a();\n```'));
ok('empty stays empty', cleanEdit('   \n  ') === '');

// ── whitespace that would shift the region ────────────────────────────────
ok('a leading blank line is removed', cleanEdit('\n\nconst x = 1;') === 'const x = 1;');
ok('a trailing newline is removed', cleanEdit('const x = 1;\n') === 'const x = 1;');
ok('interior indentation is untouched',
   cleanEdit('if (a) {\n  b();\n}') === 'if (a) {\n  b();\n}');
ok('the first line keeps its indentation',
   cleanEdit('    return x;') === '    return x;', cleanEdit('    return x;'));

// ── echoed context: the expensive failure ─────────────────────────────────
{
  const before = 'function f() {\n  const a = 1;';
  ok('a repeated line from before the region is dropped',
     cleanEdit('  const a = 1;\n  return a;', { before }) === '  return a;',
     cleanEdit('  const a = 1;\n  return a;', { before }));
  ok('a line that merely resembles it is kept',
     cleanEdit('  const ab = 1;\n  return ab;', { before }) === '  const ab = 1;\n  return ab;');
}
{
  const after = '\n  return total;\n}';
  ok('running on into code below the region is cut',
     cleanEdit('  total += x;\n  return total;\n}', { after }) === '  total += x;',
     cleanEdit('  total += x;\n  return total;\n}', { after }));
  ok('a short line below is not used as an anchor',
     cleanEdit('a();\n}', { after: '}' }) === 'a();\n}', cleanEdit('a();\n}', { after: '}' }));
}

// ── context window ────────────────────────────────────────────────────────
{
  const doc = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
  const mid = doc.indexOf('line 200');
  const { before, after } = contextAround(doc, mid, mid + 8);
  ok('context before is capped at 60 lines', before.split('\n').length <= 60, before.split('\n').length);
  ok('context after is capped at 60 lines', after.split('\n').length <= 60, after.split('\n').length);
  ok('context before ends at the region', before.endsWith('line 199\n') || before.endsWith('line 199'), before.slice(-20));
  ok('context after starts at the region', after.trimStart().startsWith('\nline 201'.trim()) || after.includes('line 201'), after.slice(0, 20));
}
{
  // A region at the very start must not produce a negative slice.
  const { before, after } = contextAround('a\nb\nc', 0, 1);
  ok('a region at the start has empty context before', before === '', JSON.stringify(before));
  ok('and still has context after', after.includes('b'), after);
}

// ── the prompt ────────────────────────────────────────────────────────────
{
  const m = editMessages({
    path: 'src/a.ts', language: 'typescript',
    before: 'const a = 1;', selection: 'return a;', after: '}',
    instruction: 'return a doubled',
  });
  ok('the instruction reaches the prompt', m.user.includes('return a doubled'));
  ok('the selection is marked as a region', m.user.includes('<selected_region>'));
  ok('the surroundings are marked as context',
     m.user.includes('<code_before>') && m.user.includes('<code_after>'));
  ok('no memory means no memory block', !m.system.includes('undefined'), m.system.slice(-40));
}
{
  const m = editMessages({
    path: 'a.ts', language: '', before: 'x', selection: '', after: 'y',
    instruction: 'add a guard', memory: 'PROJECT NOTES',
  });
  ok('an empty selection asks for an insertion, not a replacement',
     m.user.includes('<insert_here/>') && !m.user.includes('<selected_region>'), m.user);
  ok('memory is appended to the system prompt', m.system.includes('PROJECT NOTES'));
  ok('an unknown language is omitted rather than sent blank', !m.user.includes('Language:'), m.user);
}

// ── size, which the bar shows before you accept ───────────────────────────
{
  const n = editSize('a\nb\nc', 'a\nB\nc');
  ok('a one-line rewrite counts as +1 −1', n.added === 1 && n.removed === 1, n);
  ok('an unchanged edit counts as nothing', JSON.stringify(editSize('a', 'a')) === '{"added":0,"removed":0}');
  const ins = editSize('', 'new();');
  ok('an insertion counts only additions', ins.added === 1 && ins.removed === 0, ins);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
