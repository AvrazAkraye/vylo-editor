# W2-2 Export wiring: sound in the file, saving a GIF, the promises, the notices

Wave 2 of the Pro pass (`docs/PRO.md`), brief `docs/pro/briefs/w2-2-export.md`, branch `pro-w2-export`. Nothing here is
released or pushed.

## What is wired

**Sound into the film.** The Export tab's Download and Save as… now go through one function, `makeFile` in
`MotionExport.tsx` (the step between the button and the write, exported so the wiring can be tested). For an MP4 it calls
`renderMp4(out, { …, sound: filmSound(out), onSound })`. `filmSound` (new, `motionexportops.ts`) is true exactly when the
graphic has a sound that is not Off, read through `readSound`, so a graphic that never chose sound is rendered with
`sound: false` and its film is the film it was before (no bed, no `audio` given to the encoder, no sound stage). `out`
is the graphic the file is made from, so a template rebuilt for another shape and a graphic fitted into one both carry
their sound (both tested).

- **Progress.** While the sound is made, before the first frame, the bar reads "Preparing the sound…" (indeterminate;
  the frame counter is hidden), and the time left is reckoned from the first frame, not from before the sound.
- **Dropped sound.** When the result's `audio` is `'dropped'` (no AAC encoder, or the bed would not render), the film
  is saved and the line under the saved file says "Saved without sound: this computer cannot make the audio track."
  Never an error.
- **The sound slot.** A graphic with sound gets one line under the cards saying what the file will carry
  (`soundLineOf`): MP4 "With sound: effects made from the animation." / "With sound: music (Calm)." / "With sound:
  effects and music (Epic)." (the chosen mood, else the template's); GIF "Without sound: a GIF cannot carry it."; PNG
  "Without sound: a picture has none." A graphic without sound has no line, so its first screen is unchanged (tested:
  still 2 decisions, the same 8 buttons). The `soundNote` prop still takes the MP4 line's place when a panel passes one.
- `fileNameFor` takes `'gif'`; `seeThrough` is exported (a test holds `motiongifops.ts`'s copy to it).

**Saving a GIF (Rust, `video.rs`).** `Kind::Gif` for `.gif` (any case): the bytes must begin `GIF89a` or `GIF87a`; the
ceiling is `MAX_IMAGE_BYTES` (64 MiB, the poster's); the same path rules, the same replace-or-number write; Open opens
it. The module's table gains the row, every doc comment that counted or listed the kinds says six and `.gif`, and the
refusal names `.gif` among the saved kinds. Tests, in the file's own module: GIF 89a and 87a written byte for byte
(Latin, Arabic names, `.GIF`); numbered unique writes per extension; refusals for an empty file, a PNG, an MP4, `GIF89`,
lower-case `gif89a`, `GIF90a`, a shifted signature, SVG and a script named `.gif`; a GIF named `.png` or `.mp4` refused;
`.gif`-like names (`.gif`, `gif`, `loop.gifv`, `loop.gif.exe`, `x.apng`, `x.jpeg`) refused, `x.webp`/`x.jpg` still
refused; the ceiling exact, one byte over, and the real 64 MiB + 1; Open of a GIF, and of a GIF swapped for a PNG
refused. **Run:** `cargo test --offline --lib` with its own target directory: 162 passed (the 8 in `video.rs` among them).

## SAFETY.md, exactly what changed (all four languages)

1. *What reaches the network*, the Motion paragraph: the saving sentence now names the GIF writer
   (`app/src/motiongif.ts`) beside the MP4 writer, and "no telemetry event is sent for either" became "for any of them".
   One sentence added on sound: made the same way, synthesised on this machine from the graphic itself
   (`app/src/motionsound.ts`), encoded by the window's own AAC encoder into the same MP4, nothing downloaded or sent, and
   the Motion panel still contacts no one but the model you ask.
2. `export_write_video`: Motion writes "an MP4, a GIF or a PNG" (twice); the accepted names gain `.gif`; "a GIF that
   does not begin `GIF89a` or `GIF87a`" joins the wrong-bytes examples; "64 MiB for a poster or a GIF".
3. `open_exported`: opens a `.gif` too.

No other sentence was touched. New backticked identifiers in all four: `app/src/motiongif.ts`, `app/src/motionsound.ts`,
`GIF89a`, `GIF87a`. `test/i18n.test.mjs` (identifiers, heading and table counts, version) passes. The storage paragraph
(`vylo.motion.export.v1`) stays true as written.

## THIRD_PARTY_NOTICES.md and `scripts/notices.sh`

The generator ran offline here (3 s); the npm tree it read matches this worktree's `package-lock.json` for all 80
production packages (checked). Regenerated for 0.132.0: 80 npm packages (was 40: Remotion's packages, mediabunny and
its encoders, docx, qrcode-generator, zod and their dependencies) and 353 crates; mediabunny's four MPL-2.0 packages are
in *Source for MPL-2.0 components*. `--check` passes afterwards.

Three fixes to the generator:

- **Remotion's licence was printed as MIT-0.** Its "Allowed use cases" begins "Permission is hereby granted, free of
  charge" and has no MIT notice clause, which is the MIT-0 test, so the file reproduced Remotion's licence as the MIT-0
  text (and so as the text for `dunce`, which offers MIT-0). A `LicenseRef-Remotion` classifier now runs first; MIT-0
  is correctly listed as having no text in the tree.
- **`SEE LICENSE IN LICENSE.md`** was listed as an SPDX identifier with a SPDX URL; it is now said to be a pointer to the
  package's own file, reproduced above as `LicenseRef-Remotion`.
- **A section for code adapted into `app/src`** (*Code adapted into this source*), generated from the files whose
  opening comment says "Portions derived from …" (today `audioauto.ts` and `motionsearch.ts`, both HyperFrames,
  Apache-2.0): each header printed as it stands, HyperFrames' copyright line ("Copyright 2026 HeyGen, Inc.", from its
  LICENSE at commit 8c81efb; it has no NOTICE file), the pointer to the Apache-2.0 text, and the ten
  `docs/pro/credits/*.md` that record ideas and numbers taken without code. A header naming a project the generator has
  no notice for is listed under *Gaps*.

## docs/MOTION.md

The intro (MP4, GIF or PNG; no audio library; WebCodecs and Web Audio named), how "Motion makes no network request of
its own" stays true (and a new test that reads all 64 Motion source files for `fetch`, XHR, sockets and beacons), the
document's `sound` and `scenes` fields, the direction rules and the scene limits, thirty new rows in the engine table,
a section *Simple on top* (scenes and transitions, sound, the brand kit, the check, destinations, GIF), and "Not in this
version" without Sound and GIF.

## Tests

`pro-export.test.mjs` 192 → 232 (names, the see-through rule, `filmSound` with 600 fuzzed fields and hostile objects,
the sound line in English and Arabic, 900 fuzzed lines, `makeFile` with the fakes `renderMp4` is tested with: sound
passed, not passed, off, dropped, failed bed, Cancel, rebuilt and fitted shapes, a picture; the no-network sweep).
Whole chain (`npm test`): 157 suites, 14,859 checks, 0 failed. `npx tsc --noEmit` and `npm run build` pass; `cargo test
--offline --lib` 162 passed; `scripts/notices.sh --check` passes.

## Open problems

1. **SAFETY's storage section does not mention `vylo-motion-brand`**, the brand kit's IndexedDB database (package 06),
   nor that a graphic now keeps its sound and scenes settings. Not changed here (the brief allowed only the export and
   sound changes); a claim to add, in four languages, before release.
2. Sorani and Badini (UI strings and the SAFETY sentences) are best effort; the Arabic is careful but not native
   (`review-needed.md`).
3. Not seen in the real app: no WKWebView run of the tab with sound, and no real export with sound through this wiring
   (03 measured the encoder path; this package tested the call with fakes).
4. `modes.test.mjs` (not mine) has a comment listing `.mp4/.webm/.png/.srt` for Open; it is a comment only.
5. The notices file depends on every `Portions derived from` header and on `docs/pro/credits`: a wave-2 package that
   adds either makes `notices.sh --check` stale until it is run again after the merge.
6. `@remotion/transitions` declares `UNLICENSED` and `@remotion/media` declares no licence (listed under *Gaps*): the
   owner may want to confirm Remotion's licence covers them.
