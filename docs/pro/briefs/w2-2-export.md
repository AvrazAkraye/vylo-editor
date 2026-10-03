# W2-2 Export wiring: sound in the file, saving a GIF, the promises, the notices

Read `docs/PRO.md`, then `docs/pro/requests/{03,09,02}.md` and `docs/pro/{mux-audio,export,audio,sound}.md`.

## Why
The MP4 writer can carry sound and the dialog can offer a GIF, but nothing connects them: Export never asks for the sound, a GIF cannot be saved (the Rust command
refuses the extension), and the documents that state what the app does (SAFETY.md in four languages, THIRD_PARTY_NOTICES.md, docs/MOTION.md) are out of date.

## You own
`app/src/MotionExport.tsx`, `motionexportops.ts`, `app/src-tauri/src/video.rs` (Rust: an allow-list line and a magic-bytes check, with tests), `SAFETY.md`,
`SAFETY.ar.md`, `SAFETY.ckb.md`, `SAFETY.kmr.md`, `THIRD_PARTY_NOTICES.md` and `scripts/notices.sh` if it needs a fix, `docs/MOTION.md`, `docs/pro/w2-export.md`,
`app/test/pro-export.test.mjs` and the export/mux tests (extend, never weaken), your i18n entries and CSS `/* pro:w2-2 */`. Do not touch the panel, the chat or the templates (others are on them).

## Deliver
1. **Sound into the file**: `renderMp4` is called with `sound: true` when the graphic has sound (`doc.sound` and a mode other than `off`); progress covers it; when
   `audio === 'dropped'` the dialog says so quietly after the export ("Saved without sound: this computer cannot make the audio track"); the dialog's `soundNote` slot
   says what will be in the file (MP4: the sound chosen; GIF and PNG: none). `fileNameFor` takes `'gif'`; export `seeThrough` (package 09 asked); mark GIF done.
2. **Saving a GIF** (Rust, `video.rs`): allow `.gif` in `export_write_video` with the same checks the others get (the file's first bytes must be `GIF89a` or `GIF87a`;
   the existing size cap; the same atomic-ish write behaviour and name rules), and tests in the file's own test module. `cargo` is installed; the registry is cached.
   Use your **own target directory** (`CARGO_TARGET_DIR=/Volumes/ExtremeSSD/apps/vylo-editor-pro-target`, never the main tree's `target/`) and `--offline`; the first
   build takes a while: start it early and in the background. If the crate genuinely cannot build here, say so, keep the change minimal and obviously correct, and
   report that it is unrun.
3. **The promises.** SAFETY.md lists the file types the export command writes: add `.gif`, in all four languages, keeping the four documents' parity rules (same
   backticked identifiers, same heading and table counts; `i18n.test.mjs` checks). Say in one honest sentence per document what sound means for the promise (made on the
   device from the graphic itself, nothing downloaded or sent; Motion still makes no request of its own). Do not weaken or reword any other claim. Any new Rust text
   or table row follows the file's existing form.
4. **THIRD_PARTY_NOTICES.md** is stale (generated for 0.23.0, missing Remotion, mediabunny (MPL-2.0 needs its source notice), docx, qrcode-generator, zod...).
   Try `scripts/notices.sh` (offline); if it cannot run, bring the file up to date from `app/package.json` and the packages' own licence files by hand, accurately.
   Add a section for Apache-2.0 material taken from HyperFrames: the licence text, what was taken and where it went, from every `docs/pro/credits/*.md`.
5. **docs/MOTION.md**: add the new files to the engine table, describe scenes, sound, the brand kit, the check, destinations and GIF, strike Sound and GIF from "Not in
   this version" (alpha video, nested groups and hand keyframes stay), and keep the voice of the document. Keep "Motion makes no network request of its own" true and say how.

## Acceptance
- An MP4 export with a sound-bearing graphic passes the sound to the encoder; without sound nothing changes (test with the existing fakes). A GIF can be saved through the
  Rust command (cargo tests, or honestly unrun). SAFETY parity test passes. `npm test`, `npx tsc --noEmit`, `npm run build` pass. Commit only your paths; do not push or merge.
