// The four local stores: what they are called on both sides of the IPC
// boundary, and how their sizes read.
//
// Two things are being protected.
//
// The first is the wire. `store_empty` takes a closed enum in Rust, so a name
// the frontend sends that Rust does not recognise is not a compile error and
// not a type error — it is a button that reports "invalid args" the first time
// somebody presses it, months after the rename that caused it. Nothing in
// TypeScript can see the Rust end, so this reads `lib.rs` as text, the way
// `settings.test.mjs` reads `Icon.tsx` for the same class of silent mismatch.
//
// The second is the number. The Storage tab shows a size and then offers to
// throw that store away, so the size is a claim the app has to stand behind:
// zero and "not measured yet" are different states, and rendering the second
// as the first tells somebody their undo history is empty while the walk that
// would have said otherwise is still running.
import { readFileSync } from 'fs';
import { ON_DISK, clipboardBytes, human, isOnDisk, usage } from '../.test-build/stores.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

// ── the wire ──────────────────────────────────────────────────────────────
{
  const rust = readFileSync('src-tauri/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');

  const from = rust.indexOf('enum LocalStore {');
  const to = rust.indexOf('\n}', from);
  ok('LocalStore is in lib.rs', from !== -1 && to > from);

  const variants = [...rust.slice(from, to).matchAll(/^ {4}(\w+),$/gm)].map((m) => m[1]);
  ok('and it parsed to a plausible set of variants', variants.length === 3, variants.join(', '));

  // serde is what turns `Drafts` into the `"drafts"` this side sends. Without
  // the attribute the enum would want `"Drafts"`, and every one of these names
  // would be wrong in the same way at the same moment.
  ok('the enum renames its variants for the wire',
     /#\[serde\(rename_all = "camelCase"\)\]\n(?:#\[[^\]]*\]\n)*enum LocalStore \{/.test(rust));

  const camel = (s) => s[0].toLowerCase() + s.slice(1);
  ok('every store the frontend can empty is a variant Rust accepts',
     ON_DISK.every((id) => variants.map(camel).includes(id)),
     ON_DISK.filter((id) => !variants.map(camel).includes(id)).join(', '));
  ok('and Rust accepts nothing the frontend cannot name',
     variants.map(camel).every((v) => ON_DISK.includes(v)),
     variants.map(camel).filter((v) => !ON_DISK.includes(v)).join(', '));

  // The size reply is the same agreement in the other direction: a field that
  // arrives as `file_history` reads as undefined and draws a store using no
  // space at all, which is the most reassuring possible way to be wrong.
  const sFrom = rust.indexOf('struct StoreSizes {');
  const fields = [...rust.slice(sFrom, rust.indexOf('\n}', sFrom)).matchAll(/^ {4}(\w+): u64,$/gm)]
    .map((m) => m[1]);
  ok('StoreSizes carries one field per store', fields.length === ON_DISK.length, fields.join(', '));
  ok('and it is renamed for the wire too, so `file_history` never reaches JavaScript',
     /#\[serde\(rename_all = "camelCase"\)\]\nstruct StoreSizes \{/.test(rust));

  for (const name of ['store_sizes', 'store_empty']) {
    ok(`${name} is a Tauri command`,
       new RegExp(`#\\[tauri::command\\]\\nfn ${name}\\b`).test(rust));
  }
}

// ── which store goes which way ────────────────────────────────────────────
//
// Clipboard history is `localStorage` and the other three are directories.
// This has been written down wrong once already — in `VYLO.md` and in
// `SAFETY.md` — and it matters because deleting the app data directory does
// not clear the clips, so a button that treated all four alike would say it
// had emptied something it had not touched.
{
  ok('drafts are on disk', isOnDisk('drafts'));
  ok('so are checkpoints', isOnDisk('checkpoints'));
  ok('so is the file history', isOnDisk('fileHistory'));
  ok('the clipboard history is not — it is localStorage', !isOnDisk('clipboardHistory'));
  ok('exactly three of the four are directories', ON_DISK.length === 3);
}

// ── nothing measured yet is not the same as nothing kept ──────────────────
{
  const sizes = { drafts: 1024, checkpoints: 40 * 1024 * 1024, fileHistory: 0 };
  ok('a store reports the bytes Rust walked', usage('drafts', sizes, 0) === 1024);
  ok('a store with nothing in it reports zero', usage('fileHistory', sizes, 0) === 0);
  ok('and before the walk answers it reports nothing at all',
     usage('drafts', null, 0) === null);
  ok('the clipboard is measured here, so it has an answer immediately',
     usage('clipboardHistory', null, 812) === 812);
  ok('a clipboard of nothing is zero rather than null — it was measured and it is empty',
     usage('clipboardHistory', null, 0) === 0);
  ok('a negative measurement is floored rather than drawn',
     usage('clipboardHistory', null, -5) === 0);
}

// ── what the clipboard history costs ──────────────────────────────────────
//
// The one figure on this tab that is not a directory walk, and the one that had
// a hole in it. `clear` in `clips.ts` writes `[]`, so the naive measurement of
// an emptied history is two characters — and the row would have said "2 B"
// with the Empty button still live, the instant after somebody emptied it.
{
  ok('a history with nothing in it costs nothing, not the two brackets around it',
     clipboardBytes([]) === 0, String(clipboardBytes([])));
  ok('so the row reads 0 B rather than 2 B the moment Empty is pressed',
     human(clipboardBytes([])) === '0 B', human(clipboardBytes([])));
  ok('and the Empty button is disabled on it, which is what `=== 0` decides',
     usage('clipboardHistory', null, clipboardBytes([])) === 0);

  const one = [{ text: 'hello', at: 1 }];
  ok('a history that holds something costs what the string costs',
     clipboardBytes(one) === JSON.stringify(one).length, String(clipboardBytes(one)));
  ok('which is more than nothing, so the button is live',
     clipboardBytes(one) > 0);
  ok('two clips cost more than one — the figure tracks the store',
     clipboardBytes([...one, { text: 'goodbye', at: 2 }]) > clipboardBytes(one));
}

// ── sizes as a person reads them ──────────────────────────────────────────
{
  ok('nothing kept reads as 0 B and not as a blank', human(0) === '0 B', human(0));
  ok('a handful of bytes is counted in bytes', human(412) === '412 B', human(412));
  ok('one byte short of a kilobyte still is', human(1023) === '1023 B', human(1023));
  ok('a kilobyte is a kilobyte', human(1024) === '1 kB', human(1024));
  ok('and carries one decimal while it is small enough to matter',
     human(1024 * 1.5) === '1.5 kB', human(1536));
  ok('but not a trailing zero — "4 kB", never "4.0 kB"',
     human(4096) === '4 kB', human(4096));
  ok('above a hundred the decimal is noise and goes',
     human(412 * 1024) === '412 kB', human(412 * 1024));
  ok('a megabyte reads in megabytes', human(1024 * 1024) === '1 MB', human(1024 * 1024));
  ok('the 32 MB cap history.rs writes reads back as 32 MB, not 33.6',
     human(32 * 1024 * 1024) === '32 MB', human(32 * 1024 * 1024));
  ok('and a store between two units keeps its decimal',
     human(2.4 * 1024 * 1024) === '2.4 MB', human(2.4 * 1024 * 1024));
  ok('a size that is not a number is nothing kept rather than NaN on screen',
     human(NaN) === '0 B' && human(Infinity) === '0 B' && human(-1) === '0 B');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
