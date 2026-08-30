// The code nothing uses, and the scanner that finds it.
//
// Two bugs in the Lessons list are the same bug: `Viewer.tsx` was deleted and
// its eight `.vw-*` rules were not, and a dedupe pass removed `files` from `ar`
// and not from the other three catalogues. Something referenced from one place
// and forgotten in another. `i18n.test.mjs` closed that for the catalogues;
// `scripts/orphans.mjs` closes it for four more pairs, and this is its gate.
//
// The assertions are in three groups, and the middle one is the load-bearing
// group:
//
//   1. the repository has no orphans
//   2. the scanners still find things when there is something to find
//   3. every allow-list entry has a reason, and is still needed
//
// (1) alone is worth very little. Every check in `orphans.mjs` is a regex, and
// a regex that has stopped matching returns an empty list, which is
// indistinguishable from success — the same failure that hid every multi-line
// i18n entry on Windows for a while. So (2) runs each parser over a fixture
// built from the exact shapes in this repository that broke a first attempt:
// a nested `@media`, a `transition: .2s` that is not a class, a
// `#[tauri::command]` quoted inside a doc comment, `#[tauri::command(async)]`,
// and an `invoke` whose generic contains string literals of its own.
//
// (3) is the same idea one level up. An allow-list entry for something that is
// no longer there is exactly the `.vw-*` bug wearing a different hat, so each
// one is checked to be a false positive the scanner would still produce.
import {
  ALLOW, cssClasses, deadCss, exportedNames, importedNames,
  rustCommands, handlerNames, invokedNames, scan,
} from '../../scripts/orphans.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// ---------------------------------------------------------------- 1

const { orphans, sizes } = scan();
for (const [label, items] of Object.entries(orphans)) {
  ok(`none: ${label}`, items.length === 0, items.join(' | '));
}

// The scanners saw a realistic amount of the repository. Without this, a
// renamed directory or a regex that matches nothing passes every check above.
ok(`styles.css parsed to a plausible number of classes`, sizes.cssClasses > 200, `${sizes.cssClasses}`);
ok(`src/*.ts parsed to a plausible number of exports`, sizes.exports > 200, `${sizes.exports}`);
ok(`test/ holds a plausible number of test files`, sizes.testFiles > 20, `${sizes.testFiles}`);
ok(`the Rust sources hold a plausible number of commands`, sizes.rustCommands > 30, `${sizes.rustCommands}`);
ok(`generate_handler! parsed to a plausible number of names`, sizes.registered > 30, `${sizes.registered}`);
ok(`the frontend parsed to a plausible number of invoke() calls`, sizes.invoked > 30, `${sizes.invoked}`);

// ---------------------------------------------------------------- 2

{
  // A stylesheet shaped like the real one: nested at-rules, a declaration whose
  // value begins with a dot, and a class that only ever appears in a selector.
  const css = cssClasses(`
/* .in-a-comment { } */
.kept { transition: .2s ease; background: url(a.b.c); }
.also-kept:hover, .third::after { color: red }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --x: 1 }
  .nested { border-radius: .5rem }
}
`);
  ok('a class in a plain selector is found', css.has('kept'));
  ok('a class in a selector list is found', css.has('also-kept') && css.has('third'));
  ok('a class inside a nested at-rule is found', css.has('nested'));
  ok('a declaration value is not read as a selector', !css.has('2s') && !css.has('5rem'));
  ok('a filename in url() is not read as a selector', !css.has('b') && !css.has('c'));
  ok('a class in a comment is not counted', !css.has('in-a-comment'));
}

{
  const names = exportedNames([
    'export const A = 1;',
    'export async function b() {}',
    'export type C = string;',
    'export interface D {}',
    'export class E {}',
    'export enum F { x }',
    'export { g, h as i };',
    'const notExported = 2;',
    '  export const indented = 3;',
  ].join('\n'));
  ok('every export form is seen', ['A', 'b', 'C', 'D', 'E', 'F', 'g', 'i'].every((n) => names.has(n)),
     [...names].join(','));
  ok('`h as i` is recorded under the exported name', names.has('i') && !names.has('h'));
  ok('a plain declaration is not an export', !names.has('notExported'));
  // Anchored to the start of a line on purpose: `export` inside a nested block
  // is not a module export, and neither is the word in a sentence.
  ok('an indented `export` is not counted', !names.has('indented'));
}

{
  const imported = importedNames([
    "import { a, b as c } from './x';",
    "import type { D } from './y';",
    "import Def from './z';",
    "import * as ns from './w';",
    'import {\n  multi,\n  line,\n} from "./v";',
    "import './side-effect';",
  ]);
  ok('a named import is seen', imported.has('a'));
  ok('a renamed import is seen under the local name', imported.has('b') && !imported.has('c'));
  ok('a type-only import counts as a use', imported.has('D'));
  ok('a default import is seen', imported.has('Def'));
  ok('a namespace import is seen', imported.has('ns'));
  // Every test file in this directory imports across several lines; missing
  // these would mark most of the codebase dead.
  ok('an import spanning lines is seen', imported.has('multi') && imported.has('line'));
}

{
  const rs = [
    '/// A doc comment that says `#[tauri::command]` and then a sentence.',
    '/// taking `State` cannot be called from a unit test.',
    'pub fn not_a_command<F>(x: &str) -> Result<Live, String> {}',
    '#[tauri::command]',
    'fn plain(root: String) -> Result<(), String> {}',
    '#[tauri::command(async)]',
    'fn with_arg(mode: Mode) -> Result<Shot, String> {}',
    '#[tauri::command]',
    '#[allow(clippy::too_many_arguments)]',
    'pub fn after_another_attribute() {}',
  ].join('\n');
  const names = rustCommands(rs);
  ok('a plain #[tauri::command] is found', names.includes('plain'));
  // `capture_screenshot` is the only one written this way, and the first draft
  // of the scanner missed it entirely — a whole command invisible to both
  // directions of the check.
  ok('#[tauri::command(async)] is the same attribute', names.includes('with_arg'));
  ok('an attribute between the marker and the signature is stepped over',
     names.includes('after_another_attribute'));
  // Both `lib.rs` and `watch.rs` quote the attribute inside a `///` block to
  // explain why a command taking `State` cannot be unit-tested. A looser match
  // reads the next line of prose as a signature.
  ok('the attribute quoted in a doc comment invents nothing',
     !names.includes('not_a_command'), names.join(','));
  eq('and nothing else is found', names.length, 3);
}

{
  const names = handlerNames(
    '.invoke_handler(tauri::generate_handler![\n  a, b,\n  mod_one::c, mod_two::d\n])',
  );
  ok('a bare name is registered', names.includes('a') && names.includes('b'));
  ok('a module-qualified name is registered under its own name',
     names.includes('c') && names.includes('d'), names.join(','));
  eq('and nothing else', names.length, 4);
}

{
  const src = [
    "await invoke('plain', { a: 1 });",
    "await invoke<{ ok: boolean }>('with_generic');",
    // The trap: the generic carries string literals of its own, and a scanner
    // that takes the first quoted string after `invoke` returns 'file'.
    "await invoke<{ kind: 'file' | 'dir' | 'missing' }>('with_union');",
    // Five call sites in this app break the line here.
    'await invoke<{\n  code: number; stdout: string;\n}>(\n  \'across_lines\', { root },\n);',
    'await invoke<Array<string>>(\'nested_generic\');',
    'const notACall = invoke;',
  ].join('\n');
  const names = invokedNames(src);
  ok('a plain invoke is found', names.has('plain'));
  ok('an invoke with a generic is found', names.has('with_generic'));
  ok('a string union inside the generic is not mistaken for the command',
     names.has('with_union') && !names.has('file') && !names.has('dir'), [...names].join(','));
  ok('an invoke broken across lines is found', names.has('across_lines'));
  ok('a nested generic is stepped over', names.has('nested_generic'), [...names].join(','));
  ok('a bare reference to `invoke` names no command', !names.has('notACall'));
}

// ---------------------------------------------------------------- 3

for (const [group, entries] of Object.entries(ALLOW)) {
  for (const [key, reason] of Object.entries(entries)) {
    ok(`ALLOW.${group}['${key}'] gives a reason`,
       typeof reason === 'string' && reason.trim().length > 10, JSON.stringify(reason));
  }
}

{
  // An allow-list entry for something that no longer exists is the `.vw-*` bug
  // again: one half deleted, the other half left behind. Clear the list, and
  // every name in it must come back as a finding.
  const saved = { ...ALLOW.css };
  for (const k of Object.keys(ALLOW.css)) delete ALLOW.css[k];
  const raw = new Set(deadCss().dead);
  Object.assign(ALLOW.css, saved);
  const stale = Object.keys(saved).filter((k) => !raw.has(k));
  ok('every allow-listed class is still a class the scanner would flag',
     stale.length === 0, stale.join(' | '));
  ok('and clearing the list is what makes them appear', raw.size >= Object.keys(saved).length,
     `${raw.size} without the list, ${Object.keys(saved).length} in it`);
}

ok('the other allow-lists are empty, so nothing is excused silently',
   Object.keys(ALLOW.exports).length + Object.keys(ALLOW.tests).length
     + Object.keys(ALLOW.rust).length === 0,
   [...Object.keys(ALLOW.exports), ...Object.keys(ALLOW.tests), ...Object.keys(ALLOW.rust)].join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
