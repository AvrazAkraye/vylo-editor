# Adversarial review of package `video` (the film holds Motion graphics)

Branch `vm-r-video` (worktree `vylo-editor-vm-r-video`), from the merged `2dcbf60`. Contract `docs/VM.md`, brief
`docs/vm/briefs/video.md`, builder's report `docs/vm/video.md`. Everything ran on this Mac with stubs and the app's own
WebKit (the builder's off-screen host, copied into the git-ignored `app/.test-build/vm-harness/`); nothing left the machine
(the host's content blocker, the page's fetch stub; `blocked` in every run lists only the Google font files, answered
locally, and Remotion's licence telemetry, answered locally).

## Findings

| # | Severity | What | State |
|---|---|---|---|
| 1 | **High** (the facts rule) | The chat's `known` numbers are every number in the storyboard's JSON, and a motion scene carries its held graphic's id (twelve hex digits) and an overlay its id and start. A film holding `770055aabbcc` let the model add a stat of **770055**; an overlay at 1.5 s let it state **1.5**. Same hole, older, for a clip's id and start second. | **Fixed** `76453e8` (`videochatops.ts`: `motion`, `over`, `clip`, `from` left out of the known numbers) |
| 2 | Medium | A graphic on top whose start is past a scene made shorter (3.5 s into a 4 s scene, then 2 s — the seconds field, the timeline's Shift+arrow and the chat's `set_seconds` change only `seconds`) drew **nothing** in the preview and the export, while the reader clamps the start to 1.5 s: the same unedited film exported differently after a restart. Proven in WebKit (no tag; after the fix, frames 45–59). | **Fixed** `d65bff0` (`overTime` takes the scene's length and uses the reader's `overAt`; the Starts at field shows that start) |
| 3 | Medium (truth) | SAFETY said deleting a graphic in the Motion panel deletes it, and listed what a video holds without the graphics placed in it. A film now keeps a copy (pictures included) in `vylo-video`. | **Fixed** `55cbf56` + the next commit: one sentence in all four SAFETY files (parity test green) — the copy leaves `vylo-video` with the video, or, once out of every scene, when the video is next saved after a restart (the reader lets it go in memory; nothing writes until the next edit); Sorani/Badini listed in `docs/vm/review-needed.md` |
| 4 | Low (truth, not this lane) | The Video home's gallery now shows a "Motion graphic" card under "The model builds every video from these scenes. Ask for one by name" — the model can neither make nor be asked for one. | Open: `VideoHome.tsx` belongs to the other session. Either filter `'motion'` out of that gallery or change its sentence. |
| 5 | Low (found, not this package) | A **poster** waits for an animation frame whenever a delayRender is pending (`renderStillOnWeb` has no background keepalive, unlike `renderMediaOnWeb`). A graphic always holds its first frame, so a poster of a frame with a graphic does not finish while the window is hidden — exactly as a poster of any scene with a picture already did (control run: an `image` scene's poster also waits). With animation frames both posters render correctly (the picture whole, the tag at its pin). | Open; renderer behaviour. Worth knowing for "All three shapes" + poster with the window minimised. |

## Judgement calls (no code changed)

- **The model can choose among the person's graphics.** `sanitizeScene` accepts any *held* id, so a reply can point a graphic
  scene at another held graphic, add a graphic scene by id, or turn any scene into one (`edit_scene`), though the prompt's
  note says only its seconds and transition are the model's. It can never make a graphic up, nor bring layers in. Contract
  "not in this version" lists *adding a held graphic by name*; this is by id. Acceptable; if the owner wants it strict,
  `edit_scene` should keep the old `motion` for a motion scene, as it keeps `over`.
- **The sound sentence** only for a graphic with a sound of its own: right. "Do not hide it" means do not hide a limit
  that applies; a sentence about a sound that does not exist on every silent graphic is noise.
- **No "Update from Motion" for a graphic on top** (the brief's row list has none; VM.md says "a held graphic offers" it).
  Change → the same graphic gives the new version as a second copy, so nothing is lost. Worth one button later.
- **Unused copies ride every save until the next start** (let go only by the reader, in memory), and **stay on disk until
  that video is next saved after a restart** — a film never touched again keeps them. Every edit writes the whole film: up
  to 12 × 1.5 MB. Same pattern as clips and pictures; acceptable, noted (SAFETY now says exactly this).
- **The picker marks the graphic in place** by its Motion id even when the film's copy is older.
- A graphic saved with no name shows Motion's own **"Untitled"** (in English, in every language) — Motion's convention.
- "Plan again" replaces graphic scenes and overlays like every other scene (the confirm says so); the copies are let go in
  memory at the next start and on disk at that video's next save.
- The watermark, the brand band (`look.logo`, reachable only through the chat's `set_scene_look` for a graphic scene) and a
  portrait film's story bar are drawn over a graphic, as over a clip: film chrome on top.

## What held up (with the evidence)

- **Export truth, independently** — the builder's proof re-run: 38/38; its first-frame hold: 14/14; its preview
  (11 seeks, 3 plays): every canvas byte-identical to Motion's paint of the moment, 29.7 fps.
- **Nine transitions** (fade, slide, wipe, zoom, iris, flash, panel, split, glitch), each with a graphic scene arriving and
  leaving and graphics on top on the scenes either side: 16/16 checks each — every graphic whole in every steady frame (no
  missing frame), present through the overlap, gone everywhere else, and the arriving graphic's clock starting with the
  transition (its cyan bar exactly at frames 105–134). Contact sheets: the graphics move, scale and clip with their scene.
- **Loop on and off** with one held graphic in two scenes: the bar at 15–29/60–74/105–119 (loop) and 150–164 (once); the
  last-frame square held 171–269. **Graphic on top at the film's first frame and at the latest start**: exact.
- **Portrait and square films** with a landscape tag and a portrait circle: tag at its pin (323 × 107 px, 44 px in), circle
  432 px and centred. **4K**: 864 px circle, transition checks 16/16.
- **Over every kind**: clip (real H.264 footage), gallery, image, title, the brand band, a scene with its own colour, and
  under the watermark: the tag whole (34,561 px) at its pin on each; Motion's lower-third template over a photo and a
  coloured scene, through a fade and a slide; a designed look under a see-through graphic.
- **Arabic and Sorani** (ڕ ێ ۆ ڵ ە) graphics and Motion's moving "kinetic" template: 13 frames compared with Motion's own
  paint of the same moment in the same page — mean error 0.02–1.6 after the film-wide colour curve, and each frame closer to
  its own moment than to the one before or after. (The encoder lifts the darks of the whole film alike — the DOM's #1A1A1A
  decodes as 38, a canvas's #203060 as (43, 56, 100) — not a graphic matter.)
- **A graphic whose paint throws** (every magenta fill, 121 throws): the export finishes with no error, the other graphics
  and scenes whole; Motion's paint isolates the failing layer.
- **Preview** with a heavy template as a scene and graphics on top on both sides: 29.6 / 29.2 fps across the transitions;
  no unpainted canvas in 331 animation frames across both scene changes.
- **Hostile data** (Node): ids `__proto__`/`constructor`, duplicate ids (reader and views agree), ids of another type,
  starts and lengths that are strings, NaN, ±Infinity, negative, 1e9/1e12; twelve 1.4 MB graphics read in ~31 ms; a
  10,000-entry list; nothing throws into the store's one `try` (which would empty the whole list of videos); the reader is
  idempotent at the 1.5 MB edge.
- **Undo/redo**: add/undo/redo; duplicate + move (pruning keeps the graphic); room made at the cap, then two undos bring the
  scene and its graphic back (the history tracks `motions`); `fitted`/`fitSeconds` keep graphics and the clock.
- **The model**: with twelve held graphics no prompt (chat, plan, redo, design, art, narration) carries their words or
  layers; the chat prompt grows by 1,167 characters for 6 graphic scenes and 6 overlay changes; ids it does not hold are
  dropped.
- **Interface** (WebKit, `ui-review.tsx`): 0, 1, 200 saved graphics with hostile titles (HTML, 400 L's, Arabic, Sorani,
  empty), en/ar/ckb, light/dark: the list opens in ~50 ms with 200, no markup runs, nothing overflows, the focus starts on the
  first graphic (Close when empty), Escape and a pick give it back to Add a scene; "Update from Motion" absent for an older
  or equal saved copy, present for a newer one. SSR (`vm-review-video.test.mjs`): the rows in four languages, a film that
  never uses the feature draws the same storyboard but for one option.

## Tests and gates

- `app/test/vm-review-video.test.mjs`: 55 checks (failing first on #1 and #2). **Not yet in the chain**: the orphans gate
  fails until it is (`test file on disk that no npm script runs`). Wire it in `test:4` right after
  `node test/vm-video.test.mjs` (`test:4` becomes 1,387 characters). With that line, `npm test` passed in full;
  `npx tsc --noEmit` and `npm run build`: green.
- WebKit harness (git-ignored, `app/.test-build/vm-harness/`): `review.tsx` (+ `review-fixture.ts`, `review-films.ts`,
  `review-clip.ts`), `review-analyze.mjs` (per-colour frame plans), `review-oracle.mjs` (against Motion's paint),
  `review-box.mjs`, `ui-review.tsx`, `preview-review.tsx`.
- Samples: `/Volumes/ExtremeSSD/apps/vylo-vm-samples/review-video/` — `trans-*.mp4` + `sheet-trans-*.png`, `loop.mp4`,
  `edge.mp4`, `film-*.mp4` (`film-short-before.mp4` is the failing frame set of #2), `sheet-*.png`, `poster-*.png`,
  `ui/*.png`.

## What the owner should try by hand

1. A lower third on top of a clip, then shorten that scene below the lower third's start: it should now show from half a
   second before the end, and the same after quitting and reopening.
2. In Chat: "add a scene with 770055 patients a year" on a film holding a graphic — it must be refused as a number nobody gave.
3. Press **Poster** (or All three shapes) on a film with a graphic and switch to another app before it finishes.
4. The Video home's gallery: the "Motion graphic" card under "Ask for one by name".
