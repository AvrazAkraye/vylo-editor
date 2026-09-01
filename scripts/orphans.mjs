#!/usr/bin/env node
// Find the code nothing uses.
//
// This project has been bitten twice by the same class of bug, and both times
// it was one half of a pair being deleted: `Viewer.tsx` went in M8 and its
// eight `.vw-*` rules sat in `styles.css` until D6, and a dedupe pass removed
// the `files` key from `ar` while the other three languages kept it.
// `i18n.test.mjs` now checks the catalogue in both directions. This generalises
// that idea to four more pairs where one half can be deleted without the other
// noticing:
//
//   css      a class defined in styles.css that no frontend source writes
//   exports  a symbol exported from src/*.ts that nothing imports and nothing
//            in its own module uses either
//   tests    a test file on disk that no npm script runs, and a test named in
//            a script with no file on disk
//   rust     a #[tauri::command] missing from generate_handler!, and a name in
//            generate_handler! that no frontend invoke() reaches
//
// Regex over the source, deliberately. `knip` and `ts-prune` would each be a
// dependency to keep current and a config format to chase when it changes; this
// is a couple of hundred lines of string handling over sixty source files, and
// when it is wrong the fix is a line in ALLOW with the reason written next to
// it.
//
// ## What it does not claim
//
// It parses nothing. Three limits are worth knowing before trusting a green
// run:
//
//   - A class name built at runtime (`ac-${status}`) cannot be matched, so
//     every one of those is in ALLOW.css with the expression that builds it.
//   - An export is "used" if its name appears more than once in its own file.
//     A cluster of mutually-referencing dead functions therefore looks alive.
//   - `invoke` is found by scanning forward past a balanced generic. A command
//     name held in a variable would read as uninvoked.
//
// Run it:  node scripts/orphans.mjs
// Gate it: app/test/orphans.test.mjs

import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'app');
const SRC = join(APP, 'src');
const TESTS = join(APP, 'test');
const RUST = join(APP, 'src-tauri', 'src');

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const listing = (dir, ext) => readdirSync(dir).filter((f) => f.endsWith(ext)).sort();

/**
 * Every file under `dir` ending in `ext`, as paths relative to `dir`.
 *
 * Recursive, because `test/` grew a subdirectory of helpers while this was
 * being written and a suite could land in one next. A non-recursive read would
 * not report a test in there as unrun — it would not see it at all, which is
 * the silent half of the same failure.
 */
const listingDeep = (dir, ext, prefix = '') =>
  readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    if (statSync(full).isDirectory()) return listingDeep(full, ext, `${prefix}${f}/`);
    return f.endsWith(ext) ? [`${prefix}${f}`] : [];
  }).sort();
const frontendFiles = () =>
  readdirSync(SRC).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx')).sort();

/**
 * Known false positives, each with the reason it is one.
 *
 * An entry here is a claim that the thing is reached by a route this script
 * cannot see, and the reason has to name that route. An allow-list whose
 * entries say only "allowed" is a place to hide things, which is the opposite
 * of what this file is for.
 */
export const ALLOW = {
  css: {
    // Built at runtime from a union type, so the whole name is never written.
    // `App.tsx`: <span className={`ac ac-${acStatus}`}>, and `acStatus` is
    // `CompleteStatus` in complete.ts — 'off' | 'idle' | 'thinking' |
    // 'cooldown' | 'error'. Five states, five rules, and they match.
    'ac-off': 'App.tsx builds `ac-${acStatus}`; CompleteStatus includes "off"',
    'ac-idle': 'App.tsx builds `ac-${acStatus}`; CompleteStatus includes "idle"',
    'ac-thinking': 'App.tsx builds `ac-${acStatus}`; CompleteStatus includes "thinking"',
    'ac-cooldown': 'App.tsx builds `ac-${acStatus}`; CompleteStatus includes "cooldown"',
    'ac-error': 'App.tsx builds `ac-${acStatus}`; CompleteStatus includes "error"',
    // `tags.ts`: tagClass() builds `tag-${t}` from TAGS, and TagPicker.tsx
    // builds `var(--tag-${tag})` from the same list. Eight colours, eight
    // rules, and `tags.test.mjs` asserts every swatch produces a distinct
    // class — so the set here cannot drift from the set there without that
    // test failing first.
    'tag-red': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-amber': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-green': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-teal': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-blue': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-violet': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-pink': 'tags.ts builds `tag-${t}` from TAGS',
    'tag-grey': 'tags.ts builds `tag-${t}` from TAGS',
    // `TodoTask.tsx` builds `pr-${task.priority}` from PRIORITIES, and the
    // panel builds `pr-${sum.priority}` from the same union. Five priorities,
    // five rules, and `todo.test.mjs` asserts every priority in PRIORITIES
    // parses back to itself — so the set here cannot drift from the set there
    // without that test failing first.
    'pr-critical': 'TodoTask.tsx builds `pr-${p}` from PRIORITIES',
    'pr-high': 'TodoTask.tsx builds `pr-${p}` from PRIORITIES',
    'pr-medium': 'TodoTask.tsx builds `pr-${p}` from PRIORITIES',
    'pr-low': 'TodoTask.tsx builds `pr-${p}` from PRIORITIES',
    'pr-maybe': 'TodoTask.tsx builds `pr-${p}` from PRIORITIES',
    // `TodoPanel.tsx` builds `sec-${s.key}` from SECTIONS. Only the three that
    // mean "act now" have a rule; the rest fall through to the plain heading,
    // which is why this list is shorter than SECTIONS.
    'sec-today': 'TodoPanel.tsx builds `sec-${s.key}` from SECTIONS',
    'sec-doing': 'TodoPanel.tsx builds `sec-${s.key}` from SECTIONS',
    'sec-blocked': 'TodoPanel.tsx builds `sec-${s.key}` from SECTIONS',
    // `Markdown.tsx`: <div className={`md-h md-h${h[1].length}`}> against
    // /^(#{1,4})\s+/ — four heading levels, four rules.
    'md-h1': 'Markdown.tsx builds `md-h${h[1].length}`; the pattern is #{1,4}',
    'md-h2': 'Markdown.tsx builds `md-h${h[1].length}`; the pattern is #{1,4}',
    'md-h3': 'Markdown.tsx builds `md-h${h[1].length}`; the pattern is #{1,4}',
    'md-h4': 'Markdown.tsx builds `md-h${h[1].length}`; the pattern is #{1,4}',
    // Written by a library, never by us. Verified in node_modules rather than
    // assumed: @codemirror/view sets `class: "cm-editor" + …` on the editor
    // root, and @xterm/xterm does `classList.add("xterm-viewport")` on the
    // scroll container. Every other `.cm-*` and `.xterm-*` rule in styles.css
    // is reached without an entry here, because both libraries are themed
    // through a JS object whose keys are selectors and those names are
    // therefore in `src` as strings — these two are simply not among them.
    'cm-editor': '@codemirror/view sets it on the editor root',
    'xterm-viewport': '@xterm/xterm sets it on the scroll container',
  },
  exports: {},
  tests: {},
  rust: {},
};

// ---------------------------------------------------------------- css

/**
 * Class names from the selector preludes of a stylesheet.
 *
 * Depth-aware rather than a split on braces, because `@media (…) { :root {…} }`
 * nests and a naive alternation starts reading declaration bodies as selectors
 * — which is how `transition: .2s` becomes a class. Only the text immediately
 * before a `{` is a prelude; everything before a `}` is declarations and goes
 * in the bin.
 */
export function cssClasses(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = new Set();
  let buf = '';
  for (const ch of text) {
    if (ch === '{') {
      for (const m of buf.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) found.add(m[1]);
      buf = '';
    } else if (ch === '}') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return found;
}

/**
 * A class defined in `styles.css` that no frontend source writes.
 *
 * All of `src`, not only `.tsx`. The obvious reading — a class belongs in JSX —
 * is wrong here and reported fifteen false positives before it was checked:
 * CodeMirror decorations carry their class in a plain `.ts` module, so
 * `syn-kw` lives in `highlight.ts`, `cm-was` and `cm-now` in `inline.ts`, and
 * `cm-staged-add` / `cm-staged-del` in `staged.ts`.
 *
 * Most library-owned `.cm-*` and `.xterm-*` names need no allow-list, but for a
 * reason too accidental to rely on: both libraries are themed through a JS
 * object whose keys are selectors, so `cm-focused` is in `Editor.tsx` as part
 * of a string. The two that are not — `cm-editor` and `xterm-viewport` — are in
 * ALLOW.css against the line in each library that emits them.
 */
export function deadCss() {
  const code = frontendFiles().map((f) => read(join(SRC, f))).join('\n');
  const defined = [...cssClasses(read(join(SRC, 'styles.css')))].sort();
  const dead = defined.filter((c) => {
    if (ALLOW.css[c]) return false;
    // `[^\w-]` on both sides, so `.chip` is not kept alive by `chip-row`.
    return !new RegExp(`(^|[^\\w-])${c}([^\\w-]|$)`).test(code);
  });
  return { defined, dead };
}

// ------------------------------------------------------------ exports

/** The names an `export` statement introduces. */
export function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(
    /^export\s+(?:async\s+)?(?:const|let|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) names.add(m[1]);
  // `export { a, b as c }` — what is exported is what follows `as`.
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] ?? bits[0]).trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** Every identifier anything pulls in through an `import`, `type` ones too. */
export function importedNames(sources) {
  const names = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/import\s+([\s\S]*?)\s+from\s*['"]/g)) {
      const clause = m[1];
      for (const braces of clause.matchAll(/\{([\s\S]*?)\}/g)) {
        for (const part of braces[1].split(',')) {
          const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
        }
      }
      const dflt = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:,|$)/);
      if (dflt) names.add(dflt[1]);
      const star = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
      if (star) names.add(star[1]);
    }
  }
  return names;
}

/**
 * A symbol exported from `src/*.ts` that nothing imports.
 *
 * Split in two, because the literal question has fifty-eight answers here and
 * only one of the two halves is a defect:
 *
 *   dead       nobody imports it and its own module never names it again. The
 *              declaration is the only occurrence: it is unreachable.
 *   redundant  nobody imports it, but its own module uses it. The code is
 *              alive and the `export` keyword is surplus. Reported, not gated
 *              — fifty-eight of these is a house style, not a regression, and
 *              an allow-list with fifty-eight excuses in it would be worthless.
 *
 * The count that separates them is taken **within the declaring file only**.
 * Counting across the project would let a common name — `Store`, `Tab`, `Open`
 * are all exported types here — be kept alive by an unrelated symbol somewhere
 * else, and a dead-code check that under-reports is the failure that matters.
 *
 * Tests count as importers. They import from `.test-build/`, but by the same
 * name, and a symbol exported so a test can pin it is not dead. There is no
 * entry point to exclude: `main.tsx` exports nothing, and only `.ts` is
 * scanned, so the `.tsx` components App.tsx imports are out of scope anyway.
 */
export function deadExports() {
  const consumers = [
    ...frontendFiles().map((f) => read(join(SRC, f))),
    ...listingDeep(TESTS, '.mjs').map((f) => read(join(TESTS, f))),
  ];
  const imported = importedNames(consumers);
  const dead = [];
  const redundant = [];
  let total = 0;
  for (const file of listing(SRC, '.ts')) {
    const own = read(join(SRC, file));
    for (const name of exportedNames(own)) {
      total++;
      if (imported.has(name) || ALLOW.exports[`${file}:${name}`]) continue;
      const uses = (own.match(new RegExp(`\\b${name}\\b`, 'g')) ?? []).length;
      (uses <= 1 ? dead : redundant).push(`${file}:${name}`);
    }
  }
  return { total, dead: dead.sort(), redundant: redundant.sort() };
}

// -------------------------------------------------------------- tests

/**
 * A test file no npm script runs, and a test named in a script with no file.
 *
 * Every script, not only `test`. A suite that is slower or needs a network is
 * reasonably given a lane of its own — `test:rust` already has one — and a file
 * reached by `npm run test:e2e` is run by somebody. What this is looking for is
 * the file reached by nothing at all, which is how `memory.test.mjs` sat here
 * with thirty-two passing assertions that no build ever executed.
 */
export function unrunTests() {
  const scripts = JSON.parse(read(join(APP, 'package.json'))).scripts ?? {};
  const all = Object.values(scripts).join('\n');
  const named = new Set([...all.matchAll(/\btest\/([\w./-]+\.mjs)\b/g)].map((m) => m[1]));
  const onDisk = listingDeep(TESTS, '.test.mjs');
  return {
    onDisk,
    neverRun: onDisk.filter((f) => !named.has(f) && !ALLOW.tests[f]),
    noSuchFile: [...named].filter((f) => !onDisk.includes(f)).sort(),
  };
}

// --------------------------------------------------------------- rust

/**
 * The name of every `#[tauri::command]` in a Rust file.
 *
 * The attribute has to be alone on its line. `lib.rs` and `watch.rs` both
 * mention `#[tauri::command]` inside a `///` comment explaining why a command
 * taking `State` cannot be unit-tested, and a looser match invents two commands
 * out of the next line of prose. `#[tauri::command(async)]` is the same
 * attribute with an argument — `capture_screenshot` is the one that uses it,
 * and dropping it would have hidden a whole command from both directions.
 */
export function rustCommands(src) {
  const names = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[tauri::command(\([^)]*\))?\]\s*$/.test(lines[i])) continue;
    // Other attributes may sit between the marker and the signature.
    for (let j = i + 1; j < lines.length && j < i + 8; j++) {
      if (/^\s*#\[/.test(lines[j])) continue;
      const m = lines[j].match(/\bfn\s+([a-z_]\w*)/);
      if (m) names.push(m[1]);
      break;
    }
  }
  return names;
}

/** The names inside `tauri::generate_handler![…]`, `module::` prefixes dropped. */
export function handlerNames(src) {
  const at = src.indexOf('generate_handler![');
  if (at === -1) return [];
  const body = src.slice(at + 'generate_handler!['.length, src.indexOf(']', at));
  return body
    .split(',')
    .map((s) => s.trim().split('::').pop())
    .filter((s) => /^[a-z_]\w*$/.test(s));
}

/**
 * The command name of every `invoke(…)` in the frontend.
 *
 * A scanner rather than one regex, because the generic is the whole difficulty.
 * `invoke<{ kind: 'file' | 'dir' }>('path_kind')` puts two string literals in
 * front of the one that matters, and five call sites here break the line after
 * the `>`. So: skip a balanced `<…>` if there is one, require the `(`, and take
 * the first literal after it.
 */
export function invokedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/\binvoke\s*/g)) {
    let i = m.index + m[0].length;
    if (src[i] === '<') {
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === '<') depth++;
        else if (src[i] === '>' && --depth === 0) { i++; break; }
      }
      while (/\s/.test(src[i])) i++;
    }
    if (src[i] !== '(') continue;
    i++;
    while (/\s/.test(src[i])) i++;
    const quote = src[i];
    if (quote !== "'" && quote !== '"' && quote !== '`') continue;
    const name = src.slice(i + 1, src.indexOf(quote, i + 1));
    if (/^[a-z_]\w*$/.test(name)) names.add(name);
  }
  return names;
}

/**
 * A command defined but not registered, and a command registered but never
 * called.
 *
 * The second is the sharp one, and it is two different findings wearing one
 * shape: either the Rust is dead, or it is a live capability exposed to the
 * webview that nothing can reach. Both are worth knowing, and the second is
 * worth knowing more — an IPC command the frontend never calls is surface with
 * no user.
 */
export function deadCommands() {
  const defined = new Set(listing(RUST, '.rs').flatMap((f) => rustCommands(read(join(RUST, f)))));
  const registered = new Set(handlerNames(read(join(RUST, 'lib.rs'))));
  const invoked = invokedNames(frontendFiles().map((f) => read(join(SRC, f))).join('\n'));
  return {
    defined: [...defined].sort(),
    registered: [...registered].sort(),
    invoked: [...invoked].sort(),
    unregistered: [...defined].filter((n) => !registered.has(n) && !ALLOW.rust[n]).sort(),
    uninvoked: [...registered].filter((n) => !invoked.has(n) && !ALLOW.rust[n]).sort(),
  };
}

// --------------------------------------------------------------- scan

/**
 * Everything, in one shape.
 *
 * `orphans` is what fails a build. `sizes` is how much the scanners actually
 * saw, and it is not decoration: every check here is a regex, and a regex that
 * stops matching returns an empty list, which reads exactly like success. The
 * test asserts the sizes are plausible for that reason.
 */
export function scan() {
  const css = deadCss();
  const exp = deadExports();
  const tests = unrunTests();
  const rust = deadCommands();
  return {
    orphans: {
      'css class in styles.css that no frontend source writes': css.dead,
      'symbol exported from src/*.ts that nothing uses at all': exp.dead,
      'test file on disk that no npm script runs': tests.neverRun,
      'test named in package.json with no file on disk': tests.noSuchFile,
      '#[tauri::command] missing from generate_handler!': rust.unregistered,
      'command in generate_handler! that no invoke() reaches': rust.uninvoked,
    },
    notes: {
      'exported from src/*.ts, used only inside its own module': exp.redundant,
    },
    sizes: {
      cssClasses: css.defined.length,
      exports: exp.total,
      testFiles: tests.onDisk.length,
      rustCommands: rust.defined.length,
      registered: rust.registered.length,
      invoked: rust.invoked.length,
    },
  };
}

// Run directly for a report; imported by `app/test/orphans.test.mjs` for a gate.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { orphans, notes, sizes } = scan();
  let n = 0;
  for (const [label, items] of Object.entries(orphans)) {
    console.log(`${items.length ? '✗' : '✓'} ${label}${items.length ? ':' : ''}`);
    for (const item of items) console.log(`      ${item}`);
    n += items.length;
  }
  console.log('');
  for (const [label, items] of Object.entries(notes)) {
    console.log(`· ${items.length} ${label}${items.length ? ':' : ''}`);
    if (items.length) console.log(`      ${items.join(', ')}`);
  }
  console.log(`\nscanned: ${Object.entries(sizes).map(([k, v]) => `${v} ${k}`).join(', ')}`);
  console.log(`${n} orphan${n === 1 ? '' : 's'}`);
  process.exit(n ? 1 : 0);
}
