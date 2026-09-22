// The typeface Arabic and Kurdish are drawn in.
//
// The app ships Badini and Sorani, and the system has no dependable Arabic
// face — macOS draws Geeza Pro, Windows Tahoma, Linux whatever is installed.
// So one is bundled. Two things about that can break silently, which is why
// they are checked here rather than looked at:
//
// 1. Coverage. Sorani and Badini need five letters plain Arabic does not have.
//    A font missing them does not fail: it falls back per character, and a
//    Kurdish sentence renders in two typefaces. Cairo — the obvious pick — is
//    missing all five, which is how this test came to exist.
//
// 2. Scoping. Without `unicode-range` the face claims Latin as well, and the
//    entire interface silently changes typeface on load.
import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const FONT = new URL('../src/fonts/arabic.woff2', import.meta.url);
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

// ── the file is there, and is what it claims ──────────────────────────────
ok('the font is bundled, not fetched', existsSync(FONT));
const bytes = readFileSync(FONT);
// woff2 files start with the signature 'wOF2'.
ok('it is a real woff2', bytes.subarray(0, 4).toString('latin1') === 'wOF2',
   bytes.subarray(0, 4).toString('latin1'));
const kb = Math.round(statSync(FONT).size / 1024);
ok('it is subset, not the whole family', kb < 200, kb + ' KB');

// ── it is the exact file whose coverage was checked ──────────────────────
//
// Coverage cannot honestly be re-derived here: a woff2 keeps its tables in a
// brotli stream, and a cmap parser written inside a test is one more thing
// that can be wrong. So the file is pinned instead. Swapping the font fails
// this line, which is the point — the replacement has to be checked for the
// five Kurdish letters before the pin is updated, and src/fonts/README.md has
// the ten-line script that does it.
//
// Verified on 2026-09-22 against Noto Sans Arabic: ڕ ڵ ۆ ێ ە all present,
// along with پ چ ژ گ ڤ ھ and the Arabic-Indic digits.
const EXPECTED_SHA256 = '3f665b0cb67ec6e30918d7aabc68a01c2e9502435140cce4a94ee26aa13634cd';
const actual = createHash('sha256').update(bytes).digest('hex');
ok('it is the font whose Kurdish coverage was verified', actual === EXPECTED_SHA256,
   actual.slice(0, 16) + '\u2026');

// ── the stylesheet uses it correctly ──────────────────────────────────────
const face = /@font-face\{[\s\S]*?\}/.exec(css)?.[0] ?? '';
ok('a face is declared', face !== '');
ok('it points at the bundled file', face.includes("url('./fonts/arabic.woff2')"));
ok('it is scoped to Arabic script', face.includes('unicode-range'));
ok('the Arabic block is in that range', face.includes('U+0600-06FF'));
ok('so are the joiners Arabic shaping needs', face.includes('U+200C-200D'));
ok('it never claims Latin', !/unicode-range:[^;]*U\+0{0,3}0-/.test(face.replace(/\s+/g, '')));
ok('it swaps rather than blocking paint', face.includes('font-display:swap'));
ok('one file covers the UI weights', /font-weight:\s*400\s+700/.test(face));

// ── and both stacks reach for it first ────────────────────────────────────
//
// Order is not cosmetic. A family is chosen per codepoint, so a face listed
// after the system stack never gets asked about Arabic at all.
for (const token of ['--sans', '--mono']) {
  const line = new RegExp(`${token}:([^;]*);`).exec(css)?.[1] ?? '';
  ok(`${token} leads with it`, line.trimStart().startsWith("'Vylo Arabic'"), line.trim());
  ok(`${token} still falls back to the system face`,
     /system|ui-monospace|-apple-system/.test(line), line.trim());
}


console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
