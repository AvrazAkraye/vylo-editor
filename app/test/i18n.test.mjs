// Everything this product ships in four languages, checked for agreement.
//
// Two surfaces, one failure mode: something changed in one language and
// forgotten in the other three, silently, for as long as nobody happens to read
// them. Part one is `src/i18n.ts`. Part two, at the bottom, is the four SAFETY
// documents.
//
// These are the catalogue failures this catches, all of which have actually
// happened: a key added to one language and forgotten in the others; a key
// added twice in the same dictionary (a TypeScript error, but only if you
// build); a string whose UI was removed, left behind in three languages; and an
// entry whose key and value sit on separate lines being half-deleted by a
// line-based edit.
//
// It reads the file as text rather than importing it, because the dictionaries
// are module-private and the point is to check the file, not the runtime.
import { readFileSync, readdirSync, existsSync } from 'fs';
import { PRESETS } from '../.test-build/layouts.js';
import { join, resolve as resolvePath } from 'path';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// Line endings are normalised on the way in, and that is not housekeeping.
// ENTRY below spans two lines for the long entries, and its `\n?` cannot
// consume a `\r`. GitHub's Windows runners check out with CRLF, so every
// multi-line entry vanished from the catalogue there while every single-line
// one matched — which the key-parity checks could not see, because all three
// languages lost the same entries. Only the forward check below caught it, on
// CI, after it was green on a Mac.
const nl = (t) => t.replace(/\r\n/g, '\n');
const src = nl(readFileSync('src/i18n.ts', 'utf8'));
const LANGS = ['ar', 'ckb', 'kmr'];

/** Entries whose key and value may sit on separate lines when the key is long. */
// `\r?` twice, and both are load-bearing on Windows. A long entry puts its value
// on the next line, so the pattern spans one; and in multiline mode `$` matches
// *before* the `\n`, which puts it after the `\r` that CRLF leaves behind.
// Without either, every multi-line entry silently vanishes from the catalogue.
const ENTRY = /^ {2}'((?:[^'\\]|\\.)+)':[ \t]*\r?\n?[ \t]*'((?:[^'\\]|\\.)*)',[ \t]*\r?$/gm;

const dicts = {};
for (const lang of LANGS) {
  const from = src.indexOf(`const ${lang}: Dict = {`);
  const to = src.indexOf('\n};', from);
  ok(`${lang} dictionary is present`, from !== -1 && to > from);
  const body = src.slice(from, to);
  const entries = [...body.matchAll(ENTRY)];
  const keys = entries.map((m) => m[1]);
  dicts[lang] = { keys, set: new Set(keys), values: entries.map((m) => m[2]) };
  ok(`${lang} has no duplicate keys`, keys.length === new Set(keys).size,
     keys.filter((k, i) => keys.indexOf(k) !== i).join(', '));
  ok(`${lang} has no empty translations`, dicts[lang].values.every((v) => v.trim().length > 0));
}

// Every language carries the same keys, or a UI element silently falls back to
// English in one language and not the others.
const base = dicts.ar.set;
for (const lang of LANGS.slice(1)) {
  const missing = [...base].filter((k) => !dicts[lang].set.has(k));
  const extra = [...dicts[lang].set].filter((k) => !base.has(k));
  ok(`${lang} covers the same keys as ar`, missing.length === 0, `missing: ${missing.join(' | ')}`);
  ok(`${lang} carries no keys the others lack`, extra.length === 0, `extra: ${extra.join(' | ')}`);
}

// A translation nothing renders is three languages of drift waiting to be
// updated by someone who does not know it is dead.
const code = readdirSync('src')
  .filter((f) => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== 'i18n.ts')
  .map((f) => nl(readFileSync(`src/${f}`, 'utf8')))
  .join('\n');
const dead = [...base].filter((k) => !code.includes(k.replace(/\\'/g, "'")));
ok('no catalogue entry has lost its UI', dead.length === 0, dead.join(' | '));

// And the other direction, which nothing above could see: every check here
// starts from the catalogue, so a string the UI passes to `t()` that no
// catalogue has passes the whole suite while rendering in English inside an
// RTL interface. Two of them had.
/**
 * Every single-quoted literal handed to `t()`, however it is handed over.
 *
 * This used to be `t('…')` and nothing else, which missed the shape the
 * codebase uses whenever a label depends on state:
 *
 *     t(open ? 'Hide the message box' : 'Show the message box')
 *
 * Both of those shipped in English in every language, and the test that exists
 * to catch exactly that said nothing — the failure this file's own header
 * warns about, where a pattern that has stopped matching is indistinguishable
 * from a clean result.
 *
 * It reads raw source, so a comment that quotes a call — writing out what one
 * looks like, in prose — is scanned like code and asks for a key nobody uses.
 * That is a false positive, and it is the safe direction to be wrong in: it
 * fails loudly with the string in the message, where the failure it replaced
 * was a label shipping in English with nothing said at all.
 *
 * So the parens are walked rather than matched. Only single quotes count: a
 * template literal is assembled at runtime and cannot be a key, and a double
 * quote in this codebase is a JSX attribute.
 */
function handedToT(src) {
  const out = new Set();
  const calls = /\bt\(/g;
  let m;
  while ((m = calls.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') { depth += 1; i += 1; continue; }
      if (c === ')') { depth -= 1; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') {
        let j = i + 1;
        let lit = '';
        while (j < src.length && src[j] !== c) {
          if (src[j] === '\\') { lit += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
          lit += src[j];
          j += 1;
        }
        // A literal next to a comparison is the thing being *tested*, not the
        // label — `t(sp === 'code' ? 'Code' : 'Chat')` hands over two strings
        // and compares against a third. Only the labels are keys.
        const before = src.slice(Math.max(0, i - 4), i).trimEnd();
        const after = src.slice(j + 1, j + 5).trimStart();
        const compared = /[=!]=$/.test(before) || /^[=!]==?/.test(after);
        if (c === "'" && lit && !compared) out.add(lit);
        i = j + 1;
        continue;
      }
      i += 1;
    }
  }
  return out;
}
const used = handedToT(code);
const untranslated = [...used].filter((k) => !base.has(k));
// A long entry puts its value on the next line, and that is the shape that
// broke on Windows. Parse the file again with CRLF and assert the catalogue is
// identical, so nobody has to discover this from a red build a second time.
{
  const crlf = [...readFileSync('src/i18n.ts', 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')
    .slice(src.indexOf("  '"), undefined).matchAll(ENTRY)];
  const asLf = [...src.slice(src.indexOf("  '")).matchAll(ENTRY)];
  ok('the catalogue parses the same with CRLF line endings',
     crlf.length === asLf.length, `lf ${asLf.length} vs crlf ${crlf.length}`);
  const multi = [...base].filter((k) => k.length > 60);
  ok('and the long entries, whose value sits on the next line, are among them',
     multi.length > 0 && multi.every((k) => base.has(k)), `${multi.length} long keys`);
}

ok('every string the UI hands to t() is in the catalogues',
   untranslated.length === 0, untranslated.join(' | '));

// ── strings the scanner cannot see ────────────────────────────────────────
//
// The scanner reads `t('…')` out of the source, so it only finds strings
// written at the call. A label kept in a data table and handed over as
// `t(p.label)` is invisible to it — and the terminal's layout presets are
// exactly that. Every one of them happened to be translated, by hand, with
// nothing checking; the fifth was added and would have shipped in English in
// all three languages.
//
// The same shape exists for the module registry, which `modules.test.mjs`
// already guards. This is the other one.
{
  const missing = [];
  for (const p of PRESETS) {
    if (!base.has(p.label)) missing.push(`label: ${p.label}`);
    if (!base.has(p.about)) missing.push(`about: ${p.about}`);
  }
  ok('every layout preset has its label and its sentence in the catalogues',
     missing.length === 0, missing.join(' | '));
}

// The scanner above is the thing most likely to be wrong, and it *was* wrong
// for as long as the app had a label that depends on state — so it is checked
// against the shapes that broke it, the way `orphans.mjs` and `rtl.mjs` are.
// A pattern that has stopped matching returns nothing, and nothing looks
// exactly like a clean result.
ok('the scanner sees a plain call', handedToT("t('Settings')").has('Settings'));
ok('and both labels of a ternary', (() => {
  const seen = handedToT("t(open ? 'Hide the box' : 'Show the box')");
  return seen.has('Hide the box') && seen.has('Show the box');
})());
ok('but not the value the ternary is testing', (() => {
  const seen = handedToT("t(sp === 'code' ? 'Code' : 'Chat')");
  return seen.has('Code') && seen.has('Chat') && !seen.has('code');
})());
ok('nor the other way round', !handedToT("t('x' === y ? 'A' : 'B')").has('x'));
ok('a label inside a nested call is still found',
   handedToT("fill(t('Open {name}'), { name })").has('Open {name}'));
ok('a template literal is assembled at runtime and is not a key',
   handedToT('t(`Open ${name}`)').size === 0);
ok('and an empty string is not a key', handedToT("t(a ? 'A' : '')").has('') === false);

// The parser above is the thing most likely to be wrong, so prove it saw a
// realistic number of entries rather than silently matching nothing.
ok('the file parsed to a plausible catalogue', base.size > 50, `${base.size} keys`);

// ─── the SAFETY documents ─────────────────────────────────────────────────
//
// SAFETY.md makes checkable claims about what the code does, and three
// translations make the same claims to people who will never read the English.
// Nothing held them together: a correction to SAFETY.md left `SAFETY.ar.md`,
// `SAFETY.ckb.md` and `SAFETY.kmr.md` stating the old, wrong thing. That is
// worse than a stale README, because the document's whole value is that a
// reader can check it — and four of its claims were found false at once, which
// then had to be repaired in four files by hand.
//
// A translation cannot be diffed against its source, so this checks the parts
// that do not translate:
//
//   1. the set of backticked identifiers — every file path, command name and
//      storage key the document cites. This is the load-bearing check. A
//      sentence naming `read_text_attachment` in English and not in Arabic is
//      exactly the desync that matters.
//   2. the section and table shape. A paragraph added to one file and not the
//      others almost always moves one of these counts.
//   3. the version each document says it describes, against package.json.
//
// It deliberately does not check prose. There is no way to, and pretending
// otherwise would make this a test people learn to work around.
{
  const REPO = resolvePath('..');
  const SOURCE = 'SAFETY.md';
  const TRANSLATIONS = ['SAFETY.ar.md', 'SAFETY.ckb.md', 'SAFETY.kmr.md'];

  // Fenced blocks are excluded throughout. They hold the CSP and the tool
  // schema, whose *labels* are translated while the identifiers inside them are
  // not, so comparing them as text would fail for a reason that is not a bug.
  const doc = (f) => {
    const p = join(REPO, f);
    return existsSync(p) ? nl(readFileSync(p, 'utf8')).replace(/```[\s\S]*?```/g, '') : null;
  };
  const cited = (text) =>
    new Set([...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1].trim()));
  const shape = (text) => ({
    h2: (text.match(/^## /gm) || []).length,
    h3: (text.match(/^### /gm) || []).length,
    rows: (text.match(/^\|/gm) || []).length,
  });

  for (const f of [SOURCE, ...TRANSLATIONS]) ok(`${f} is present`, doc(f) !== null);

  const src = doc(SOURCE);
  if (src) {
    const srcCited = cited(src);
    const srcShape = shape(src);

    // A document that cites nothing cannot be checked, and an empty set would
    // make every comparison below pass. So the count is asserted, not assumed.
    ok('SAFETY.md cites a plausible number of identifiers',
       srcCited.size > 80, `${srcCited.size} cited`);

    for (const f of TRANSLATIONS) {
      const text = doc(f);
      if (!text) continue;
      const theirs = cited(text);
      ok(`${f} names everything SAFETY.md names`,
         [...srcCited].every((i) => theirs.has(i)),
         [...srcCited].filter((i) => !theirs.has(i)).join(' | '));
      ok(`${f} names nothing SAFETY.md does not`,
         [...theirs].every((i) => srcCited.has(i)),
         [...theirs].filter((i) => !srcCited.has(i)).join(' | '));
      const s = shape(text);
      for (const k of ['h2', 'h3', 'rows']) {
        ok(`${f} has SAFETY.md's ${k} count`, s[k] === srcShape[k],
           `got ${s[k]}, want ${srcShape[k]}`);
      }
    }

    // "It describes version X" and "Last checked against X" are the two places
    // a stale document gives itself away, and the two a version bump forgets.
    const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
    for (const f of [SOURCE, ...TRANSLATIONS]) {
      const text = doc(f);
      if (text) ok(`${f} says it describes ${version}`, text.includes(version));
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
