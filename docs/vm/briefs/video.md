# Package `video`: the film holds Motion graphics

Read `docs/VM.md` first (the idea, the contract, the rules). You build the first of its two halves.

## Why
The owner makes lower thirds, counters and titles in Motion and long films in Video, and today the two never meet: a
graphic saved in Motion has to be exported and cannot be placed in the film. They asked for the Video studio to **load the
saved Motion graphics and add them to the big video**. Make it feel like what the Video studio already does with a clip.

## What a person sees (keep it this small)
1. **Add scene → "Motion graphic".** A list of the graphics saved in Motion (a small picture of each, its name, its length).
   Choosing one adds a scene that plays it. The scene's length starts as the graphic's own, within the film's scene limits.
   With nothing saved: one plain sentence ("You have no saved graphics yet. Make one in Motion and it will be here.").
2. **A scene that is a graphic:** its card in the storyboard shows the graphic; its editor row has the graphic's name, **Change**,
   **Repeat** (loop), and — only when the saved graphic is newer than the copy the film holds — **Update from Motion**. One plain
   sentence says its sound is not part of the film yet.
3. **On top of any scene:** the scene editor gets one row, **Graphic on top** — Add / Change / Remove, and **Starts at** (seconds into
   the scene). A lower third over a clip is the use. It plays once.
4. The film exports it with everything else, and the preview shows it.

Nothing else changes anywhere. No setting. The Motion module being off does not matter: the graphics are in the same local store.

## Study first (all in your worktree)
- **The clip is your model.** `ClipScene`, `ClipView` (`videoscenenew.tsx`), `Video.clips`, the reader's `case 'clip'` (`video.ts` ~1573),
  `blankScene`'s `case 'clip'` (~1824), the text/words switches (`video.ts` ~1226 and ~1316, `videotheme.ts` ~1116, `videoexport.ts` ~477,
  `videochatops.ts` ~1594), `SceneBody` in `videoscenemore.tsx` (~955: **add the overlay right after `body`**), `VideoStoryboard.tsx`
  (kind labels ~58/82, the editor ~1151, the Add-scene menu), `videostore.ts` (how a film is kept and read). `tsc` will list every switch
  that must learn the new kind: let it.
- **How the model is told about a film** (`videochatops.ts`, `video.ts` `planPrompt`/`describe…`): find how clips appear and give a held
  graphic no more than its title, length and id. Never its layers.
- **Motion's side:** `loadMotions()` (`motionstore.ts`, already reads every record through `readMotion`), `readMotion`/`motionread.ts`,
  `paint(ctx, doc, t, { width, height, clear })` (`motiondraw.ts`; scene-aware), `ensureFonts(doc)` (`motionfonts.ts`), `MotionThumb.tsx`
  (the small pictures), `frameCount`, `LIMITS`.
- **Remotion:** `useCurrentFrame`, `useVideoConfig`, `delayRender`/`continueRender`, `Sequence`. The film is drawn by Remotion in the
  preview (`@remotion/player`) and exported by `renderMediaOnWeb` (`videoexport.ts`), which draws the page's DOM into a canvas frame by frame.

## You own
New: `app/src/videomotion.ts` (pure: holding, reading, dedupe, staleness, time mapping, pruning), `app/src/VideoMotionView.tsx`
(the Remotion views: a canvas scene and an overlay), `app/src/VideoMotionPicker.tsx` (the list), `app/test/vm-video*.test.mjs`
(the placeholder `vm-video.test.mjs` is yours to replace; you may add more files only if you also ask for their test-chain
lines in `docs/vm/requests/video.md`), `docs/vm/video.md`.
Small edits, named: `videotypes.ts` (`VideoMotion`, `MotionScene`, `SceneBase.over`, `Video.motions`, `SCENE_KINDS`), `video.ts`,
`videoscenemore.tsx`, `VideoStoryboard.tsx`, and one-line `case 'motion'` additions in `videoexport.ts`, `videotheme.ts`, `videochatops.ts`.
Shared by append: `i18n.ts` (`// vm video`), `styles.css` (`/* vm:video start */ … /* vm:video end */`).

## The hard part, and how to prove it
A `<canvas>` painted inside the Remotion tree must (a) show in the **preview** at the right frame while scrubbing and playing,
(b) be captured by **`renderMediaOnWeb`** in the export. `@remotion/media` draws its clip frames onto canvases and the exporter
captures those, so (b) should hold; **do not assume it**. Paint synchronously in `useLayoutEffect` keyed on the frame, hold a
`delayRender` until `ensureFonts` resolves, and handle the case of no 2D context.
Prove it in the app's **own WebKit**, not Chrome: there are two hosts you can reuse or copy from
(`/Volumes/ExtremeSSD/apps/vylo-editor-motion/app/.test-build/qa-host.swift` + `qa-lib.ts` + `s04-export.ts`, and
`/Volumes/ExtremeSSD/apps/vylo-editor-pro/app/.test-build/check-harness/`); read-only, copy what you need into your own
`app/.test-build/` (git-ignored). Export a short film — a title scene, a held graphic scene, a clip-less scene with a graphic on
top — decode frames of the MP4 (the harness or `ffmpeg` if it is on the machine) and show with pixel checks that the graphic is in
the right frames and not in the others. Leave one sample MP4 and a contact sheet in `/Volumes/ExtremeSSD/apps/vylo-vm-samples/video/`.
If WebKit's capture of the canvas fails, find out why and fix it in your own view (for example draw the canvas to an `<img>`
data URL per frame inside the `delayRender`); report what you found.

## Edge cases that must be decided and tested
- A held graphic whose `doc` is hostile or from an older build (read through `readMotion`; a film with 5,000 held graphics; one with
  a 5 MB title; a scene that names a graphic the film does not hold → the scene is dropped like a missing clip, an overlay is removed).
- The film's format vs the graphic's: paint at the film's frame; check a portrait graphic in a landscape film is not stretched
  (Motion's `u` units make this work; verify with a template made in each shape).
- A graphic longer than its scene (cut at the scene's end) and shorter (hold the last frame; `loop` repeats). A zero-length or one-frame graphic.
- Add the same graphic twice → one held copy (dedupe on `from` + `stamp`); a changed saved graphic → a second copy only when asked ("Update"
  replaces in place for every scene that uses it). Removing the last scene that uses a held graphic drops it (`pruneMotions`), without
  breaking undo (undo restores the film as it was).
- Size: cap the number of held graphics (12) and refuse a graphic whose JSON is over 1.5 MB with a plain sentence.
- RTL and the four languages in the picker and the rows; keyboard use; focus returns where it was; every word through `t()`.
- Preview performance: painting a template at the film's size every frame must not drop the player below 30 fps (measure `paint` with a
  recording canvas in Node and in WebKit; note it).

## Not yours
The graphic's sound (do not touch `videomix.ts`); chat ops for adding a graphic; Slides; anything in the other session's files.
