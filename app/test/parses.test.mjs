// "Does the file you are about to approve still parse?"
//
// Two properties matter more than any individual case here.
//
// The first is that a *pass* is never invented. Roughly thirty-five extensions
// have no bundled grammar, Markdown has one that cannot fail, and a file over
// the cap is not parsed at all — every one of those has to come back "not
// checked", because a green badge on something nobody looked at is the one way
// this feature can lie.
//
// The second is that a *failure* is never invented either. The bundled grammars
// are behind the languages they parse — this repository's own App.tsx, agent.ts
// and lib.rs all produce error nodes while compiling perfectly — so the rule is
// a comparison: a grammar that cannot read the file already on disk is not
// allowed an opinion about the file after the change. The tests at the bottom
// pin that, using constructs the grammars genuinely reject.
import { checkParse, hunksWithParseError } from '../.test-build/parses.js';
import { loadGrammars, grammarsReady } from '../.test-build/highlight.js';
import { diffRows, hunks } from '../.test-build/pending.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** A brand new file: nothing on disk, so `before` is empty. */
const proposed = (code, path) => checkParse('', code, path);

// ── before the grammars arrive ────────────────────────────────────────────
// This has to run first: loading them is a one-way door for the process.
ok('nothing is claimed before the grammars load', !grammarsReady());
{
  const c = proposed('function f() {\n', 'a.ts');
  ok('a file that does not parse is still only "not checked" while they load',
     c.verdict === 'unchecked' && c.reason === 'not-loaded' && c.lines.length === 0, c);
}

await loadGrammars();
ok('the grammars report themselves ready', grammarsReady());

// ── a brace that is missing, and a brace too many ─────────────────────────
{
  const c = proposed('export function f() {\n  return 1;\n', 'src/a.ts');
  ok('a function left unclosed does not parse', c.verdict === 'broken', c);
  ok('and it is reported at the end of the file, where the parser gave up',
     c.lines[0] === 3, c.lines);
  ok('the reason says a parse actually ran', c.reason === 'checked', c);
}
{
  const c = proposed('export function f() {\n  return 1;\n}\n}\n', 'src/a.ts');
  ok('a stray closing brace does not parse', c.verdict === 'broken', c);
  ok('and it is reported on the line the brace is on', c.lines[0] === 4, c.lines);
}
{
  const c = proposed('export function f(): number {\n  return 1;\n}\n', 'src/a.ts');
  ok('a valid file parses', c.verdict === 'parses' && c.reason === 'checked', c);
  ok('and a file that parses carries no lines', c.lines.length === 0, c.lines);
}

// ── the empty file ────────────────────────────────────────────────────────
{
  const c = proposed('', 'src/a.ts');
  ok('an empty file parses, because it is valid in every language',
     c.verdict === 'parses', c);
  const w = proposed('   \n\n', 'src/a.ts');
  ok('and so does one that is only whitespace', w.verdict === 'parses', w);
}

// ── a language with no grammar ────────────────────────────────────────────
{
  const c = proposed('fn main() { this is not any language ((( }', 'main.zig');
  ok('an extension with no grammar is not checked',
     c.verdict === 'unchecked' && c.reason === 'no-grammar', c);
  ok('and — the point of the whole state — it is never reported as a pass',
     c.verdict !== 'parses', c);
}
ok('a file with no extension at all is not checked',
   proposed('anything {{{', 'Makefile').reason === 'no-grammar');
{
  // Markdown's grammar has no error nodes to find. "parses" would be green by
  // construction, which is exactly the badge that teaches people to skim.
  const c = proposed('} } } not markdown at all {{{\n', 'README.md');
  ok('markdown is not checked, because a grammar that accepts every byte cannot fail',
     c.verdict === 'unchecked' && c.reason === 'no-signal', c);
}

// ── too large ─────────────────────────────────────────────────────────────
{
  const line = 'const x = 1;\n';
  const big = line.repeat(9000) + 'function f() {\n';   // > 100,000 chars, and broken
  ok('a file over the highlighter cap is above it', big.length > 100_000, big.length);
  const c = proposed(big, 'src/big.ts');
  ok('a file too large to parse is not checked rather than passed',
     c.verdict === 'unchecked' && c.reason === 'too-large', c);
  const rev = checkParse(big, 'const x = 1;\n', 'src/big.ts');
  ok('and the cap applies to the file being replaced too, since the verdict is a comparison',
     rev.verdict === 'unchecked' && rev.reason === 'too-large', rev);
}

// ── the extension decides ─────────────────────────────────────────────────
{
  const trailing = '[1, 2, ]';
  const asJson = proposed(trailing, 'data.json');
  const asJs = proposed(trailing, 'data.js');
  ok('a trailing comma is a syntax error in JSON', asJson.verdict === 'broken', asJson);
  ok('and an array literal in JavaScript', asJs.verdict === 'parses', asJs);
}
{
  const rust = 'fn main() {}\n';
  ok('the same bytes parse as Rust', proposed(rust, 'main.rs').verdict === 'parses');
  ok('and do not parse as Python', proposed(rust, 'main.py').verdict === 'broken');
}
{
  const py = 'def f():\n    return 1\n';
  ok('and the other way round: Python parses as Python',
     proposed(py, 'a.py').verdict === 'parses');
  ok('and not as Rust', proposed(py, 'a.rs').verdict === 'broken');
}

// ── the grammars are behind the languages, and that is not the file's fault ──
// Every construct below is valid and compiles; the bundled grammar rejects it.
// Without the before/after comparison, eleven of this app's own source files
// would carry a permanent "does not parse" on every diff.
{
  const before = 'fn a() {\n    let x = 1;\n}\n';
  const after = 'fn a() {\n    let Ok(x) = f() else { return };\n}\n';
  ok('valid Rust the grammar has never supported is an error node',
     proposed(after, 'a.rs').verdict === 'broken', proposed(after, 'a.rs'));
  const c = checkParse(before, after, 'a.rs');
  ok('so a change that only introduces it is a false alarm we accept',
     c.verdict === 'broken', c);
}
{
  const already = 'use base64::Engine as _;\nfn a() {\n    let x = 1;\n}\n';
  ok('a file the grammar already cannot read does not parse on its own',
     proposed(already, 'a.rs').verdict === 'broken');
  const c = checkParse(already, already + 'fn b() {\n', 'a.rs');
  ok('but against that file, a broken change is reported as not checked',
     c.verdict === 'unchecked' && c.reason === 'already-broken', c);
  ok('and it makes no claim, in either direction',
     c.verdict !== 'broken' && c.verdict !== 'parses' && c.lines.length === 0, c);
}
{
  // The same trap in TypeScript: a type predicate with a generic. `agent.ts`,
  // `budget.ts` and `attachments.ts` all contain one.
  const line = 'const f = (b: X): b is Y => true;\n';
  ok('a type predicate the grammar rejects is an error node',
     proposed(line, 'a.ts').verdict === 'broken');
  const c = checkParse(line, line + 'function g() {\n', 'a.ts');
  ok('so a file that already had one is not judged either',
     c.verdict === 'unchecked' && c.reason === 'already-broken', c);
}
{
  // The direction that must keep working: the file on disk is fine and the
  // change breaks it. This is the whole feature.
  const before = 'export function f() {\n  return 1;\n}\n';
  const after = 'export function f() {\n  return 1;\n';
  const c = checkParse(before, after, 'src/a.ts');
  ok('a change that truncates a working file is reported',
     c.verdict === 'broken' && c.reason === 'checked', c);
}
{
  // And the opposite: a change that repairs the file says nothing about how bad
  // it was, only that what is proposed parses.
  const c = checkParse('function f() {\n', 'function f() {\n}\n', 'src/a.ts');
  ok('a change that fixes a broken file reports the proposal, not the original',
     c.verdict === 'parses', c);
}

// ── line numbers ──────────────────────────────────────────────────────────
{
  const code = 'const a = 1;\nconst b = 2;\nconst c = 3;\n}\nconst d = 4;\n';
  const c = proposed(code, 'src/a.ts');
  ok('the reported line indexes the proposed file from 1',
     c.lines[0] === 4, c.lines);
  ok('and every reported line is a real line of that file',
     c.lines.every((n) => n >= 1 && n <= code.split('\n').length), c.lines);
  ok('and they are ascending with no repeats',
     c.lines.every((n, i) => i === 0 || n > c.lines[i - 1]), c.lines);
}
{
  // One broken line can raise several error nodes; a person is being sent to a
  // line, so the line appears once.
  const c = proposed('const f = (b: X): b is Y => true;\n', 'a.ts');
  ok('several error nodes on one line collapse to one line number',
     c.lines.length === 1 && c.lines[0] === 1, c.lines);
}

// ── which hunk to mark ────────────────────────────────────────────────────
{
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].join('\n');
  const after = ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'K', 'l'].join('\n');
  const rows = diffRows(before, after);
  const list = hunks(rows);
  ok('the fixture really has two separate hunks', list.length === 2, list);

  const first = hunksWithParseError(rows, list, [2]);
  ok('an error on a changed line marks that hunk and only that hunk',
     first.size === 1 && first.has(list[0].index), [...first]);

  const second = hunksWithParseError(rows, list, [11]);
  ok('an error in the other hunk marks the other one',
     second.size === 1 && second.has(list[1].index), [...second]);

  ok('an error between the hunks marks neither without context',
     hunksWithParseError(rows, list, [6]).size === 0);
  ok('and marks the nearer one once the drawn context is counted',
     hunksWithParseError(rows, list, [5], 3).has(list[0].index));

  ok('two errors can mark two hunks', hunksWithParseError(rows, list, [2, 11]).size === 2);
  ok('no errors marks nothing', hunksWithParseError(rows, list, []).size === 0);
  ok('a line past the end of the file marks nothing rather than throwing',
     hunksWithParseError(rows, list, [9999]).size === 0);
  ok('no rows marks nothing', hunksWithParseError([], [], [1]).size === 0);
}
{
  // `a` and `b` number two different documents, and a deletion makes them
  // disagree. Matching the parse against the wrong one marks a hunk that is off
  // by however many lines the change removed.
  const before = ['1', '2', 'DELETE', '4', '5', '6', '7', '8', '9', '10',
                  '11', '12', '13', '14', '15', '16'].join('\n');
  const after = ['1', '2', '4', '5', '6', '7', '8', '9', '10',
                 '11', '12', '13', '14', '15', 'SIXTEEN'].join('\n');
  const rows = diffRows(before, after);
  const list = hunks(rows);
  ok('the deletion and the edit are far enough apart to stay two hunks',
     list.length === 2, list);
  // 'SIXTEEN' is line 15 of the proposal and line 16 of the file on disk.
  const marked = hunksWithParseError(rows, list, [15]);
  ok('an error is matched against the proposal, not against the file being replaced',
     marked.size === 1 && marked.has(list[1].index), [...marked]);
  ok('and a removed line is not a line of the proposal, so its old number marks nothing',
     hunksWithParseError(rows, list, [3]).size === 0);
}
{
  // The commonest real shape: a brace goes missing in the middle and the parser
  // reports it at the end, in no hunk at all. Nothing is invented for that —
  // the file-level label carries the line, and no hunk is blamed wrongly.
  const before = 'function a() {\n  one();\n}\n' + 'const pad = 1;\n'.repeat(20) + 'function z() {\n  nine();\n}\n';
  const after = before.replace('function a() {\n  one();\n}\n', 'function a() {\n  one();\n');
  const c = checkParse(before, after, 'src/a.ts');
  ok('removing a closing brace mid-file breaks the proposal', c.verdict === 'broken', c);
  const rows = diffRows(before, after);
  const list = hunks(rows);
  const marked = hunksWithParseError(rows, list, c.lines, 3);
  ok('and when the error lands outside every hunk, no hunk is blamed',
     marked.size === 0, { lines: c.lines, marked: [...marked] });
}

// ── the cache ─────────────────────────────────────────────────────────────
{
  const code = 'const cached = 1;\n';
  const a = proposed(code, 'a.ts');
  const b = proposed(code, 'a.ts');
  ok('the same document is parsed once', a.lines === b.lines);
  ok('the cache stays bounded and keeps working', (() => {
    for (let i = 0; i < 200; i++) proposed(`const v${i} = ${i};\n`, 'a.ts');
    return proposed('function last() {\n', 'a.ts').verdict === 'broken';
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
