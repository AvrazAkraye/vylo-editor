// The translation catalogues, checked against the source that uses them.
//
// These are the failures this catches, all of which have actually happened:
// a key added to one language and forgotten in the others; a key added twice
// in the same dictionary (a TypeScript error, but only if you build); a string
// whose UI was removed, left behind in three languages; and an entry whose key
// and value sit on separate lines being half-deleted by a line-based edit.
//
// It reads the file as text rather than importing it, because the dictionaries
// are module-private and the point is to check the file, not the runtime.
import { readFileSync, readdirSync } from 'fs';

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
const used = new Set([...code.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)].map((m) => m[1]));
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

// The parser above is the thing most likely to be wrong, so prove it saw a
// realistic number of entries rather than silently matching nothing.
ok('the file parsed to a plausible catalogue', base.size > 50, `${base.size} keys`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
