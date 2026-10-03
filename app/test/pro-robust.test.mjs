// Fix package F4 of the Pro pass (docs/pro/f4-robust.md): saving that survives a full disk, and saying so plainly.
//
// Review R2 (docs/pro/requests/R2.md item 2) found that Save as… over an existing film truncated it before writing,
// so a disk that filled part-way lost the old film and left half a new one; that Download reported success without
// a flush, so a network volume's late error was never seen; and that the Export tab showed a full disk in the
// system's English ("No space left on device (os error 28)"). The writing is Rust's (`video.rs`, with its own tests,
// run by `cargo test`); this suite holds the two ends that meet in the middle:
//
// - the Export tab's sentence (`MotionExport.tsx` `sentence` and `diskTrouble`), built here with esbuild and run on
//   the messages Rust really sends — the system's words as macOS prints them (captured from `io::Error`, and from a
//   real full disk on a small volume), Linux's, and Windows' numbers with its words in another language — in four
//   languages, with paths that try to look like errors, and fuzzed;
// - the contract between them, read from `video.rs`: a refusal is `<the path>: <the system's error>`, so the error's
//   `(os error N)` is the end of the message; Save as… writes a temporary file, flushes it and renames it, and never
//   truncates; Download flushes before it says saved.
//
// The clock's half of the package (the first frame after play, the loop's wrap) is in `motionplay.test.mjs`, which
// already drives `motionplay.ts`'s clock by hand.
import { readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rust = readFileSync(new URL('../src-tauri/src/video.rs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ── the tab, built ────────────────────────────────────────────────────────
const out = fileURLToPath(new URL('../.test-build/pro-robust/', import.meta.url));
const esbuild = await import('esbuild');
rmSync(out, { recursive: true, force: true });
await esbuild.build({
  entryPoints: ['MotionExport.tsx', 'i18n.ts'].map((f) => fileURLToPath(new URL(`../src/${f}`, import.meta.url))), bundle: true, format: 'esm', outdir: out,
  external: ['react', 'react-dom', '@tauri-apps/api/core'], logLevel: 'error', jsx: 'automatic', platform: 'node',
});
const store = new Map();
globalThis.localStorage ??= { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.window ??= globalThis;
const { sentence, diskTrouble } = await import(`${out}MotionExport.js`);
const { translator } = await import(`${out}i18n.js`);
const en = (s) => s;

const FULL = 'The disk is full. Free some space, or save somewhere else.';
const READ_ONLY = 'This disk is read-only. Save somewhere else.';
const DENIED = 'Saving there is not allowed. Save somewhere else, or check the permissions.';

// ── what Rust sends, and what it means ────────────────────────────────────
console.log('the reason, read from the end of what Rust sends');
{
  // The system's words exactly as Rust's `io::Error` prints them on macOS (taken from the running Rust, and the
  // first from a real full disk: an 8 MB HFS+, APFS, exFAT and FAT volume each), behind the paths the tab writes to.
  const mac = [
    ['/Users/a/Downloads/عيادة.mp4: No space left on device (os error 28)', 'full'],
    ['/Users/a/Downloads/عيادة (2).mp4: No space left on device (os error 28)', 'full'],
    ['/Volumes/NAS/ڕێکلامی کلینیک.gif: Disc quota exceeded (os error 69)', 'full'],
    ['/Volumes/DVD/ڤیدیۆ.png: Read-only file system (os error 30)', 'read-only'],
    ['/Users/a/Movies/promo.mp4: Permission denied (os error 13)', 'denied'],
    ['/Users/a/Desktop/promo.mp4: Operation not permitted (os error 1)', 'denied'],
  ];
  // Linux spells the quota with a k and numbers it 122.
  const linux = [
    ['/home/a/Downloads/promo.mp4: No space left on device (os error 28)', 'full'],
    ['/home/a/promo.mp4: Disk quota exceeded (os error 122)', 'full'],
    ['/media/cd/promo.mp4: Read-only file system (os error 30)', 'read-only'],
  ];
  const wrong = [];
  for (const [m, want] of [...mac, ...linux]) if (diskTrouble(m, false) !== want) wrong.push([m, diskTrouble(m, false)]);
  ok('macOS and Linux: full (ENOSPC, EDQUOT), read-only (EROFS), not allowed (EACCES, EPERM)', wrong.length === 0, wrong);

  // Windows writes its words in the system's language; only its numbers are read.
  const win = [
    ['C:\\Users\\a\\Downloads\\promo.mp4: There is not enough space on the disk. (os error 112)', 'full'],
    ['C:\\Users\\a\\Downloads\\عيادة.mp4: لا توجد مساحة كافية على القرص. (os error 112)', 'full'],
    ['D:\\promo.mp4: Reached the end of the file. (os error 39)', 'full'],
    ['\\\\nas\\share\\promo.mp4: (os error 1295)', 'full'],
    ['E:\\promo.gif: The media is write protected. (os error 19)', 'read-only'],
    ['C:\\Program Files\\promo.mp4: تم رفض الوصول. (os error 5)', 'denied'],
  ];
  const wrongWin = win.filter(([m, want]) => diskTrouble(m, true) !== want);
  ok('Windows: by its numbers, whatever language its words are in', wrongWin.length === 0, wrongWin);

  // The same numbers mean other things on the other systems: none is misread.
  const other = [
    ['/Volumes/NAS/promo.mp4: Input/output error (os error 5)', false],
    ['/Volumes/x/promo.mp4: Operation not supported by device (os error 19)', false],
    ['/x/promo.mp4: Unknown error: 112 (os error 112)', false],
    ['/x/promo.mp4: Destination address required (os error 39)', false],
    ['/x/promo.mp4: Srmount error (os error 69)', false],
    ['/x/promo.mp4: Host is down (os error 112)', false],
    ['C:\\promo.mp4: The printer is out of paper. (os error 28)', true],
    ['C:\\promo.mp4: The process cannot access the file because it is being used by another process. (os error 32)', true],
    ['C:\\promo.mp4: (os error 13)', true],
    ['C:\\promo.mp4: (os error 30)', true],
  ];
  const misread = other.filter(([m, w]) => diskTrouble(m, w) !== null);
  ok('a number that means something else on this system is not read as a disk trouble', misread.length === 0, misread.map(([m, w]) => [m, w, diskTrouble(m, w)]));

  // A folder can be called anything; the path comes first and the reason last.
  const tricks = [
    '/Users/a/No space left on device (os error 28)/promo.mp4: Input/output error (os error 5)',
    '/Users/a/(os error 28)/promo.mp4: is not an MP4 video',
    '/Users/a/Permission denied (os error 13)/promo.mp4: there are already 999 files with this name',
    '/Users/a/full (os error 28).mp4: is a directory',
    '/Users/a/Downloads/promo.mp4: the file is larger than 1 GB',
    'motion:too-large',
    '',
    '(os error)',
    'os error 28',
  ];
  // (The first ends in a Mac's EIO, which is 5: on Windows 5 would be "access denied", so it is a Mac's message only.)
  const misled = tricks.filter((m, i) => diskTrouble(m, false) !== null || (i > 0 && diskTrouble(m, true) !== null));
  ok('a path that looks like an error is not one: only the end of the message is read', misled.length === 0, misled);
  ok('a folder named for the quota is not the quota', diskTrouble('/x/quota exceeded/promo.mp4: Srmount error (os error 69)', false) === null);
  ok('trailing white space after the number is still the end', diskTrouble('/x/promo.mp4: No space left on device (os error 28)\n', false) === 'full');
}

// ── the sentence, in four languages ───────────────────────────────────────
console.log('the sentence a person reads');
{
  const cases = [
    ['/Users/a/Downloads/عيادة.mp4: No space left on device (os error 28)', FULL],
    ['/Volumes/DVD/promo.png: Read-only file system (os error 30)', READ_ONLY],
    ['/Users/a/Movies/promo.mp4: Permission denied (os error 13)', DENIED],
    ['/Users/a/Desktop/promo.mp4: Operation not permitted (os error 1)', DENIED],
  ];
  // Tauri rejects with the string Rust returned; an Error carrying it is said the same way.
  ok('English: each says what happened and what to do, as a string and as an Error',
    cases.every(([m, want]) => sentence(m, en, false) === want && sentence(new Error(m), en, false) === want),
    cases.map(([m]) => sentence(m, en, false)));
  ok('the full disk is R2\'s sentence, word for word', sentence(cases[0][0], en, false) === 'The disk is full. Free some space, or save somewhere else.');
  ok('none of them carries the system\'s words or the path', cases.every(([m]) => !/os error|No space|Permission denied|Read-only file|Operation not|عيادة|\/Users/.test(sentence(m, en, false))));
  ok('Windows\' own numbers give the same sentences', sentence('C:\\x\\promo.mp4: لا توجد مساحة كافية على القرص. (os error 112)', en, true) === FULL
    && sentence('E:\\promo.gif: (os error 19)', en, true) === READ_ONLY && sentence('C:\\promo.mp4: (os error 5)', en, true) === DENIED);

  for (const lang of ['ar', 'ckb', 'kmr']) {
    const t = translator(lang);
    const said = cases.map(([m]) => sentence(m, t, false));
    const translated = [FULL, READ_ONLY, DENIED].every((s) => t(s) !== s && t(s).trim().length > 10);
    ok(`${lang}: all three sentences are translated`, translated, [FULL, READ_ONLY, DENIED].filter((s) => t(s) === s));
    ok(`${lang}: and the person reads them, with no English and no system words left`,
      said.every((s, i) => s === t(cases[i][1]) && !/[A-Za-z]/.test(s)), said);
  }
  {
    const ar = translator('ar');
    ok('Arabic: the full disk says the disk is full, and to free space or save elsewhere',
      /القرص ممتلئ/.test(sentence(cases[0][0], ar, false)) && /مكان آخر/.test(sentence(cases[0][0], ar, false)));
  }

  // Everything else is as it was.
  ok('the engine\'s own codes are unchanged', sentence('motion:too-large', en, false) === 'The video is too large to save. Choose a smaller size, or make it shorter.'
    && sentence(new Error('motion:no-encoder'), en, false) === 'This window cannot make an MP4 here. Save a PNG instead.'
    && sentence('motion:encode-failed: the encoder closed', en, false) === 'The video could not be encoded: the encoder closed');
  const other = '/Volumes/NAS/promo.mp4: Input/output error (os error 5)';
  ok('another failure is explained as before, the system\'s words kept', /^Could not save the file\. .*Input\/output error \(os error 5\)\.$/.test(sentence(other, en, false)), sentence(other, en, false));
  ok('so is a refusal of Rust\'s own', /^Could not save the file\. .*is not an MP4 video\.$/.test(sentence('/x/promo.mp4: is not an MP4 video', en, false)));
  ok('and nothing thrown at all', typeof sentence(undefined, en, false) === 'string' && typeof sentence({ weird: 1 }, en, false) === 'string');
}

// ── fuzz ──────────────────────────────────────────────────────────────────
console.log('fuzz');
{
  let seed = 4;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const parts = ['/Users/a/', 'C:\\', 'عيادة', 'ڕێکلام', ': ', '(os error ', ')', '28', '30', '13', '1', '5', '112', 'No space left on device ', 'quota exceeded ',
    ' ', '\n', '%', '.mp4', '(', ')', ':', '9999999999999999999999', '-1', '٢٨', '\u202e'];
  let threw = 0, odd = 0, unexplained = 0;
  for (let i = 0; i < 3000; i++) {
    const m = Array.from({ length: 1 + Math.floor(rnd() * 9) }, () => pick(parts)).join('');
    const w = rnd() < 0.5;
    try {
      const d = diskTrouble(m, w);
      if (![null, 'full', 'read-only', 'denied'].includes(d)) odd++;
      const s = sentence(m, en, w);
      if (typeof s !== 'string' || !s) unexplained++;
      // A reason is said only when the message ends in the system's number.
      if (d !== null && !/\(os error \d+\)\s*$/.test(m)) odd++;
    } catch {
      threw++;
    }
  }
  ok('3000 random messages: never a throw, always a sentence, a reason only from a message ending in a system number', threw === 0 && odd === 0 && unexplained === 0, { threw, odd, unexplained });
}

// ── the contract with video.rs ────────────────────────────────────────────
console.log('the contract with video.rs');
{
  const body = (name) => {
    const at = rust.indexOf(`fn ${name}(`);
    const end = rust.indexOf('\n}\n', at);
    return at === -1 ? '' : rust.slice(at, end);
  };
  const media = body('write_media');
  ok('Save as… no longer writes in place (`fs::write` truncates first): it replaces', !/fs::write\(/.test(media) && /replace\(&p, bytes\)\?/.test(media));
  const replacing = body('replace_with');
  ok('the replace writes a temporary file, fills it and renames it over the target', /Temporary::new\(dir\)/.test(replacing) && /fill\(temp\.file\(\)\)/.test(replacing)
    && /temp\.put_in_place\(p\)/.test(replacing));
  ok('its refusals are `<the path>: <the system\'s error>`, so the error is the end of the message', /let fail = \|e: io::Error\| format!\("\{shown\}: \{e\}"\)/.test(replacing));
  const temporary = rust.slice(rust.indexOf('impl Temporary'), rust.indexOf('impl Drop for Temporary'));
  ok('the temporary file is created new (never replacing, never following a link), in the same folder, hidden and short',
    /create_new\(true\)/.test(temporary) && /dir\.join\(format!\("\.vylo-saving-\{\}-\{n\}\.tmp", std::process::id\(\)\)\)/.test(temporary));
  ok('and removed when dropped unless it was put in place', /impl Drop for Temporary[\s\S]*?fs::remove_file\(p\)/.test(rust));
  const put = body('put');
  ok('every write is `write_all` and then a flush to the disk', /f\.write_all\(bytes\)\?;\s*flush_to_disk\(f\)/.test(put));
  ok('the flush is `sync_all`, with a plain fsync where macOS\'s full flush is not offered', /f\.sync_all\(\)/.test(body('flush_to_disk')) && /libc::fsync/.test(body('fsync')));
  const fresh = body('write_new_with');
  ok('Download: a failed write or flush removes the file and names it', /if let Err\(e\) = fill\(&mut f\)[\s\S]*?fs::remove_file\(&at\)[\s\S]*?format!\("\{\}: \{e\}", at\.to_string_lossy\(\)\)/.test(fresh));
  ok('and the unique write still creates each name new', /create_new\(true\)\.open\(&at\)/.test(fresh));
  ok('the old checks are all still there: path, kind, size, bytes', /decode_path\(path_header\)\?/.test(media) && /check_path\(&path, !unique\)\?/.test(media)
    && /bytes\.len\(\) > max/.test(media) && /kind\.check\(bytes\)/.test(media));
  ok('Rust\'s tests cover the failures: a full disk part-way, a late flush error, a panic, a refused rename, a read-only file and folder, a real full disk by hand',
    ['a_failed_save_as_leaves_the_old_file_whole', 'a_failed_download_leaves_nothing', 'a_read_only_file_or_folder_keeps_the_old_file',
      'save_as_replaces_by_a_rename_and_leaves_no_temporary_file', 'a_flush_the_file_system_does_not_offer_is_not_a_failure'].every((n) => rust.includes(`fn ${n}()`))
    && /#\[ignore\]\s*fn a_real_full_disk\(\)/.test(rust));
  // The tab reads the reason from the end of the message: the number Rust's io::Error prints last.
  ok('the tab reads `(os error N)` at the end, which is how io::Error ends its Display', /\\\(os error \(\\d\+\)\\\)\\s\*\$/.test(src('MotionExport.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
