# The Pro pass: where it stands

Branch `pro` (worktree `/Volumes/ExtremeSSD/apps/vylo-editor-pro`), from `motion` (0.132.0 plus the unreleased
logo-shadow commit). **Not released, not pushed.** 171 files, about 41,700 lines added across 54 commits, 28 new
source modules, 22 new test files. **No Video file differs from the base** (a test pins it).

Written 2026-10-03, after four rounds: ten builders, four wiring packages, five adversarial reviews, four fixes.

## The gates, on the final tree

| Gate | Result |
|---|---|
| `npm test` (the whole chain) | 15,527 checks, 0 failed |
| `npx tsc --noEmit`, `npm run build` | clean |
| `cargo test --offline --lib` | 167 passed, 1 ignored (a by-hand full-disk test) |
| `scripts/notices.sh --check` | up to date |
| Quality check in real WebKit, real fonts, all 33 templates x 4 shapes x 4 languages | 528 combinations, **0 findings** |
| Whole-app scenarios (the 0.132.0 rig) vs the base | 21 of 22 as before; the 22nd drives the old export controls and was rewritten for the new ones |
| Preview | steady 60 Hz with scenes, sound and the live check; export time unchanged (10 s 4K: 5.03 s vs 5.04 s) |

## What a person gets (all inside Motion; no new studio, no new navigation)

- **Quality check.** A quiet "Looks good", or an amber "N tips" chip by the stage; each tip says what and has a Fix
  button; Fix all. 13 rules (off the edge, outside the safe area, overlap, covered text, low contrast, too small, too fast
  to read, blink, frozen, late start, empty stretch, too dense). Never blocks. Graphics made to sit over video are exempt
  from the timing tips.
- **Sound.** One row in Design: Off, Effects, Music, Both. Effects are generated from the animation itself (a slide gets
  a whoosh, a counter ticks, a title lands with an impact); Music is a mood from the existing composer. Made on the
  device; nothing downloaded or sent. Off by default. MP4 carries it as AAC; loudness -16 LUFS, true peak under -1.5 dBTP.
- **Scenes and transitions.** "+ Scene" above the timeline; 13 transitions (cut, fade, push, slide, iris, clock, blinds,
  pixelate, zoom, whip, flash, light leak, glitch). A template keeps its words form after "+ Scene" (it owns its own span).
- **Brand kit.** One button: name, handle, web address, logo, colours, headline face. New graphics start in it;
  "Apply to this graphic" re-skins one.
- **Gallery.** Search (English and Arabic, Sorani, Badini), a "Recently used" row, each template with when-to-use notes.
  33 templates: the original 18 plus lower thirds (4 styles), notifications, a chat card, a device stage, a hand-drawn
  callout, film look, a bar-chart race, a timeline, before/after, a price card, progress rings and a retro title; five new
  backdrops (grain, vignette, light leak, scan lines, halftone).
- **Export.** "Where is it going?": Story, Post, YouTube, Web loop (GIF), Picture; "More options" holds the old controls.
  First screen: 2 decisions, 5 before. Saving no longer risks destroying an existing file on a full disk; plain
  sentences for a full or read-only disk.
- **Chat.** Ask in words: add or split a scene, pick a transition, set the sound, apply the brand, tidy up. JSON only,
  closed lists, every number clamped; no figure the model made up (the race chart and the price included).
- **Better AI output.** The motion rules (durations, hierarchy, safe margins, reading time) are in both prompts.

## How to see it

- Files to look at and listen to: `/Volumes/ExtremeSSD/apps/vylo-pro-samples-final/` (6+ MP4s with sound, GIFs, a PNG,
  stress films, contact sheets of the 33 templates in `templates/`). **Nobody has listened to the sound yet.**
- The app: build or run the `pro` worktree yourself (`cd /Volumes/ExtremeSSD/apps/vylo-editor-pro/app && npm run tauri dev`);
  nothing has been run in the real app window, only in off-screen WebKit pages.

## Decisions that are yours

1. **Release or not, and when.** Nothing is released or pushed.
2. **The model's prompt roughly doubled** (17,900 characters for the plan, from 9,000): about 2,000 more input tokens per
   graphic request, from 33 templates' lines and the new operations. If that cost matters on the gateway, the template list
   can be sent only for the plan, or shortened.
3. **Two sound numbers for your ears** (`docs/pro/requests/R2.md` item 4): sparse effects-only graphics come out 1.3 to
   2.9 LU quieter than -16, and a lower third's sound sits mostly in one ear (pan width 0.7; 0.45 is gentler).
4. **Transition sounds.** A cut's whoosh (push, slide, whip, zoom) is a design choice not made.
5. **Kurdish.** The Sorani and Badini strings (UI and SAFETY) are best effort; `docs/pro/review-needed.md` lists them for a
   native speaker. The Arabic was read through twice and 28 strings fixed.
6. **SAFETY.md changed in all four languages**: `.gif` among the file types the export command writes (with a signature
   check, 64 MiB), a sentence that sound is made on the device from the graphic and nothing is downloaded or sent, and the
   brand kit's own local database `vylo-motion-brand`. Read those three lines.
7. **Remotion's licence** (your Video dependency, not part of this work): `@remotion/transitions` declares UNLICENSED and
   `@remotion/media` declares none in their metadata; worth confirming Remotion's licence covers them.

## Known limits

- Music (the composer in Video's `videosynth.ts`) holds the page for 0.16 to 0.9 s when first rendered; the preview pauses when
  a music setting changes so nobody sees it. The composer itself is Video's file and was not touched.
- A first-time "Make it" can't ask for scenes or sound; only edits can.
- Adding a scene before a template's end still turns the graphic into hand-edited layers (by design).
- Drum hits in the composer's music have a one-sample attack that some ears will hear as a click (Video's file; noted).
- Not run: Windows, the real app window, VoiceOver, speakers. Network volumes were simulated.
- If the app is killed mid-save, "Save as…" leaves a hidden `.vylo-saving-*.tmp` beside the intact old film.

## Merging into the main tree (the careful part)

`/Volumes/ExtremeSSD/apps/vylo-editor` (main) holds another session's **uncommitted** "music made with Python" work:
VideoPanel, VideoSound, VideoHome, VideoArt, videomix, videosynth, videotypes, videochatops, App.tsx, i18n.ts, styles.css,
package.json, lib.rs, SAFETY x4, several tests, and new files (pymusic.rs, videopython.ts). **The overlap with the Pro pass
is exactly seven files** (checked by comparing the two lists): `SAFETY.md` and its three translations, `app/package.json`,
`app/src/i18n.ts` and `app/src/styles.css`. No Video file, no Rust file, no `App.tsx` is in both. So the merge is small and
mechanical, but it should not happen while that work is open. When it lands (or is set aside), merge file by file with a three-way merge
(as for Motion: `git merge-file` per file against the base `8631266`), rebuild, and run the whole chain; SAFETY will need
its two versions combined by hand in all four languages. Back up the main tree's files first.

## Release checklist (when you say go)

Bump the version (0.133.0 suggested), fill `docs/BACKLOG.md`'s phase entry, `npm test`, `cargo test`, `npm run build`, push,
the macOS publish script from a clean worktree, Windows through CI, the GitHub release notes (what is above). The release
needs your explicit go; nothing here assumes it.
