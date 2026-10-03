# F4: robust saving, and the clock

Branch `pro-f4-robust`, from `pro` at `65a1e82`, 2026-10-03. The findings are review R2's (`docs/pro/requests/R2.md`
items 2 and 3, `docs/pro/review-export.md` "Breaking it" and "The preview"). Nothing is pushed or merged.

## 1. Save as… that survives a full disk (`app/src-tauri/src/video.rs`)

**What was wrong.** Save as… wrote with `fs::write`, which truncates the old file and then writes. Run against a real
full volume (an 8 MB HFS+ disk image, 1 MB film at the name, 64 MB film saved over it), the old code returned
`No space left on device (os error 28)` and left **0 bytes** at the path: the old film was gone. Download removed a
partial file when `write_all` failed, but nothing flushed, so a network volume that reports `ENOSPC` or `EIO` only at
flush or close was reported as saved (`File`'s drop throws a close error away).

**Save as… now** (`replace`, `replace_with`, `Temporary`):

1. If a plain file is at the path, it is opened for writing without truncating. That asks the system the question
   `fs::write` asked, so a read-only or locked film is still refused (`Permission denied (os error 13)`) although a
   rename alone could replace it.
2. A temporary file is created with `create_new` in the same folder: `.vylo-saving-<pid>-<n>.tmp`. It is hidden, on
   the same file system (so the rename is atomic), and short. It is not the film's name plus a suffix, because a
   120-letter Arabic title is already 244 bytes of a 255-byte name limit. The old file's permission bits are copied
   to it before any byte is written, so a `0600` film stays private.
3. `write_all`, then the flush (`put`), then `rename` over the path, then a best-effort flush of the folder.
4. Any error, or a panic, drops the `Temporary`, which closes and removes the file. The old file is untouched. The
   error is `<the path asked for>: <the system's error>`, as before, so Video's and Motion's tabs read it as they did.

**Download** (`write_new`, `write_new_with`) now flushes before it returns `Ok`, and removes the file if the write or
the flush fails, so the name is free again.

**The flush** (`put`, `flush_to_disk`, `cannot_flush`). On macOS, `sync_all` is `fcntl(F_FULLFSYNC)`, which APFS, HFS+,
FAT and UDF offer and some network and FUSE volumes refuse (`ENOTTY`, `ENOTSUP`). There it falls back to a plain
`fsync` (`libc`, already a macOS dependency, as SQLite does). A file system that cannot flush at all counts as saved,
which is what every save was before. A full disk, an I/O error or a lost connection is still the save's failure.

**Kept:** the extension allow-list with `.gif`, the magic bytes, the size caps, the name and path rules, never replacing
on Download, the written list for Open, and every existing test, unchanged.

**What it costs**, written in `replace`'s comment:

- The old and new films are on the disk together while the new one is written. A disk with room for only one now
  refuses the save and keeps the old film. Before, it lost the old film.
- A folder where the person may change a file but not add one refuses the replace. The macOS save panel only offers
  folders it can write to, so this is rare there.
- The new film is a new file. The old one's Finder tags, extended attributes and owner are not carried over.
- A link at the name is replaced by the film, not written through. The link's target is untouched.
- A process killed between creating the temporary file and the rename (a crash, a power cut) leaves the hidden
  `.vylo-saving-….tmp` beside a whole old file. Nothing sweeps those away: deleting files by pattern in a person's
  folder seemed a worse risk than an occasional hidden leftover.

**Tests** (`video.rs`, `cargo test --offline --lib` with its own target directory): **167 passed, 1 ignored**. Before
this package it was 162; the 5 new tests are:

- `save_as_replaces_by_a_rename_and_leaves_no_temporary_file`: over an existing film, including a shorter film (no
  old tail is left); Arabic, Kurdish and mixed names for MP4, GIF and PNG; a 244-byte Arabic name; `0600` and `0640`
  permissions kept; a link replaced while its target is untouched; 20 saves in a row with no temporary file left.
- `a_failed_save_as_leaves_the_old_file_whole`: the disk fills half-way (the system's own `ENOSPC`, from
  `from_raw_os_error`), `EIO` at the flush after every byte, a panicking writer, a first save to a new name, and a
  rename refused by a non-empty folder. In each case the old bytes are unchanged and the folder listing is identical.
- `a_failed_download_leaves_nothing`: part-way and at the flush, with and without a film already at the name. The
  error names the numbered file, and the next Download takes the freed name.
- `a_read_only_file_or_folder_keeps_the_old_file` (unix): a `0444` film is refused and kept. A `0555` folder refuses
  both Save as… and Download and gains no file. Each check is skipped if the system lets this user write anyway
  (root).
- `a_flush_the_file_system_does_not_offer_is_not_a_failure`: which errors mean "cannot flush" and which mean "failed",
  plus a real write and flush.
- `a_real_full_disk` (ignored, run by hand with `VYLO_FULL_DISK`): a real full volume, not a simulated one. It was run
  on throwaway 8–12 MB **HFS+, APFS, exFAT and FAT** disk images, attached with `-nobrowse` in a scratch folder and
  detached afterwards. On all four, Save as… of a 64 MB film over a 1 MB one gave `No space left on device (os error
  28)`, the old film stayed whole, and no temporary file was left. Download gave the same error and left no partial
  file. A film that fits then replaced the old one. On exFAT and FAT, macOS keeps a file's extended attributes in a
  `._name` file beside it; that file belongs to the old film, so the test ignores it.

## 2. A full disk in plain words (`MotionExport.tsx`)

`sentence` (now exported) asks `diskTrouble` (new, exported) why the disk refused. Only the end of Rust's message is
read: the path comes first and may contain any text. The system's error ends with `(os error N)`, and the number
decides:

| system | full | read-only | not allowed |
|---|---|---|---|
| macOS, Linux | 28 (ENOSPC); 69 / 122 (EDQUOT) when the words say "quota exceeded" | 30 (EROFS) | 13 (EACCES), 1 (EPERM, which includes macOS privacy protection) |
| Windows (by `navigator.userAgent`; its words are in the system's language, so only numbers are read) | 112, 39, 1295 | 19 | 5 |

The sentences, in four languages through `t()`:

- "The disk is full. Free some space, or save somewhere else." (R2's wording)
- "This disk is read-only. Save somewhere else."
- "Saving there is not allowed. Save somewhere else, or check the permissions."

Everything else is unchanged: the engine's `motion:` codes, and `explain()` for any other failure (an `EIO` still
shows the system's words). The i18n entries are at the end of `ar`, `ckb` and `kmr`, under `// Motion pro: F4 robust`.
The Sorani and Badini lines are listed in `review-needed.md`.

**Tests**: `test/pro-robust.test.mjs`, **34 checks**, wired before `orphans.test`. The tab is built with esbuild and
run on:

- the real macOS wordings (taken from Rust's `io::Error`, and the full-disk one from the disk images), behind Arabic
  and Kurdish paths;
- Linux's quota and Windows' numbers, with Arabic Windows text;
- numbers that mean something else on the other system (EIO 5 on a Mac, out-of-paper 28 on Windows), which are not
  misread;
- paths built to look like errors;
- the sentences in all four languages, with no English or system words left in ar, ckb and kmr;
- 3,000 fuzzed messages;
- the `video.rs` contract, read from its source: the temporary file and rename, no `fs::write` in `write_media`,
  `write_all` then the flush, Download's removal, the `<path>: <error>` format, and the old checks.

**SAFETY.md** was checked and left alone. "Save as MP4… writes to the path the save panel returned, replacing a file
there only because the panel asked you first", "never over a file already there", "a link at the name is not
followed" (Download) and "It creates no folders" are all still true. The "one `grep` for `fs::write`" sentence is
about `lib.rs`, which this package did not touch. No sentence describes how the bytes are written.

## 3. The clock (`motionplay.ts`)

- **Play and seek.** The stamp is now `performance.now()` at `play()` and at a `seek()` while playing. The first
  frame counts the time since the press, as the sound does, so the picture is no longer a frame behind: 17 ms at
  60 Hz, 33 ms at 30 Hz. "Not counting" is `null`, not 0, because 0 is a valid time. A frame whose time is earlier
  than the press (a press handled inside the frame whose callbacks then run) counts as no time, and the stamp stays
  at the press.
- **Looping.** A loop lasts `seconds`, as the MP4, the GIF and the sound bed do. While the time is in the last frame's
  own stretch, `[last, seconds)`, the playhead shows the last frame and the extra time is kept (`held`). The next
  round then starts exactly where the time says. `t %= seconds` used to leave a playhead past the last frame. A gap
  longer than a whole short graphic goes round as many times as the time says. Seek, bind, step, pause and reset
  forget the held time.
- The audio clock is **not** wired as a time source (that is `motionsoundplay.ts`, another package's file).

**Tests**: `test/motionplay.test.mjs` 25 → **50 checks**. They stub `performance.now` to the same clock the hand-driven
`requestAnimationFrame` uses, which is how a browser behaves. They cover: the picture against a sound started at the
press over 90 frames at 60 Hz (drift under 1e-9 s); the first frame at 30 Hz; seeking while playing and while paused;
a frame time earlier than the press; the fallback with no `performance`; the loop's last stretch (5.98 s shows the
last frame, and 6.01 s is 0.01 s into the next round); held time forgotten on pause and seek; a 0.2 s graphic at
double speed; and a fuzz of 60 plays and 24,000 frames with random lengths, rates, speeds, stalls and seeks. Every
playhead is inside `[0, last]` and exactly where the time says. Against the old `motionplay.ts`, **24 of the 50
fail**, including the fuzz: 571 playheads past the last frame.

## Whole chain

`npm test`: 166 suites, 15,428 checks, 0 failed. `npx tsc --noEmit` and `npm run build` pass. `cargo test --offline
--lib`: 167 passed, 1 ignored.

## Not verified, and open

- **Network volumes.** The late `ENOSPC`/`EIO` at flush, and the `F_FULLFSYNC` → `fsync` fallback, were simulated
  (a writer that fails at the flush; the classifier unit-tested). No SMB, NFS or FUSE volume was available offline.
  All four local file systems tried offer `F_FULLFSYNC`.
- **Windows** was not run. Its error numbers and the rename-over behaviour come from documentation. One consequence
  to watch: a film opened in a player with **Open** may refuse a Save as… over it on Windows (sharing violation 32,
  or 5, which the tab would call "not allowed").
- **The real app** was not driven: no export to a full disk through the window, and no preview measured in WebKit
  after the clock change. R2's drift numbers predate it. The expected result is drift near 0 ms, with the sound about
  8 ms late from output latency where it was about 9 ms early.
- Download still writes at its final name. A process killed mid-write leaves a partial film there; a failed write
  does not.
- A process killed mid-Save-as leaves a hidden `.vylo-saving-….tmp` file (see above).
