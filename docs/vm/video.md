# Package `video`: the film holds Motion graphics — what was built

Branch `vm-video` (worktree `vylo-editor-vm-video`), from `fd3adc1`. Contract: `docs/VM.md`; brief: `docs/vm/briefs/video.md`.

## What a person gets

- **Add scene → Motion graphic.** The storyboard's kind list has "Motion graphic"; Add a scene opens the list of graphics saved
  in Motion (each painted by Motion's own thumbnail, with its name and length; newest first). Choosing one adds a scene that
  plays it, before the close, as long as the graphic (2–20 s). With nothing saved: "You have no saved graphics yet. Make one
  in Motion and it will be here."
- **A scene that is a graphic:** its card shows the graphic (the storyboard's Remotion thumbnail paints it); its row has the
  graphic's name and length, **Change**, **Repeat it while the scene lasts**, and **Update from Motion** only while the saved
  graphic is newer than the film's copy. When the graphic has a sound of its own: "This graphic’s own sound is not part of the
  film yet." Art direction, the scene's look and "Redo this scene…" are not shown for it (a graphic is drawn as Motion made it,
  and the model cannot make one).
- **Graphic on top** (every other scene): Add / Change / Remove and **Starts at (seconds into the scene)**; it plays once.
- The preview and the export show both. The film keeps a **copy** (self-contained, like a clip).

## Files

| File | What |
|---|---|
| `app/src/videomotion.ts` (new, pure) | holding (`hold`, dedupe `heldCopyOf`, caps), placing (`addMotionScene`, `changeSceneMotion`, `setOver`, `clearOver`, `overAt`), staleness (`newerSaved`, `updateHeld`), the clock (`sceneTime`, `overTime`), reading (`readVideoMotions`, `readOver`, `heldDoc`), letting go (`pruneMotions`, `motionsInUse`), `freshId`, `sceneSecondsFor`, `graphicChars`, `MAX_HELD` = 12, `MAX_GRAPHIC_CHARS` = 1,500,000 |
| `app/src/VideoMotionView.tsx` (new) | `MotionSceneView` (a scene that is a graphic) and `MotionOverlay` (a graphic on top); both paint with Motion's `paint` onto a `<canvas>` |
| `app/src/VideoMotionPicker.tsx` (new) | `MotionPicker` (the list), `MotionSceneRow`, `OverRow`, `refusalText` |
| `app/src/videotypes.ts` | `VideoMotion`, `MotionScene`, `SceneBase.over`, `Video.motions`, `'motion'` in `Scene`/`SCENE_KINDS` |
| `app/src/video.ts` | `sanitizeScene` `case 'motion'` (only an exact held id; it reads no `over`); `parseScene` keeps the person's `over`; `wordsOf`/`mainTextOf`/`blankScene` cases |
| `app/src/videoscenemore.tsx` | `SceneBody`: `case 'motion'`, and the overlay right after `body` |
| `app/src/VideoStoryboard.tsx` | kind name/about, the Add path, the rows, the optional `onVideo` prop |
| `app/src/videochatops.ts` | `sceneLine` notes (a placed graphic; a graphic on top), `'motion'`/`'over'` in `NOT_WORDS`, `edit_scene` keeps the scene's `over` (one line, beside the line that keeps its look) |
| `app/src/videoexport.ts` | `wordsOf` `case 'motion'` (subtitles: none of its own) |
| `app/src/VideoArt.tsx` | **deviation**, three entries — see below |
| `app/src/i18n.ts`, `app/src/styles.css` | 22 strings × ar/ckb/kmr under `// vm video`; CSS between `/* vm:video start */ … end */` |
| `app/test/vm-video.test.mjs` | 129 checks (replaces the placeholder) |

## The API (videomotion.ts)

```ts
hold(v, doc, newId?) → { motions, id } | { refused: 'full' | 'big' | 'unreadable' }
addMotionScene(v, doc, newId?) → { patch: { motions, scenes }, sceneId } | { refused }
changeSceneMotion(v, sceneId, doc, newId?) → { patch } | { refused }
setOver(v, sceneId, doc, at?, newId?) → { patch } | { refused }      clearOver(scenes, sceneId) → scenes
newerSaved(held, saved[]) → Motion | undefined                       updateHeld(v, heldId, doc) → { motions } | { refused }
sceneTime(frame, fps, doc, loop?) → seconds                          overTime(frame, fps, at, doc) → seconds | null
readVideoMotions(v) → v (read)       pruneMotions(v) → v       heldDoc(held) → Motion | null (cached per held object)
```

Decisions, each tested:

- **Dedupe** on `from` + `stamp` (Motion id + `updated`). A graphic changed in Motion is a second copy only when placed again;
  **Update** replaces the held copy in place (same id), so every scene and overlay that uses it plays the new one.
- **Time.** A scene: the graphic's own clock from the scene's start (`useCurrentFrame`, not the look's pace); past its end the
  last frame (`seconds − 1/fps`) holds; Repeat → modulo. An overlay: from `at`, once; **not** held after its end (a graphic with a
  solid ground would otherwise blank the rest of the scene). A graphic longer than its scene is cut where the scene ends.
- **Size.** Painted at the film's frame by `paint(ctx, doc, t, { width, height })`; Motion's `u` = 1% of the short side and pins,
  so a portrait graphic in a landscape film is placed by the same rules, never stretched (unit-tested with `layerBox`, and
  measured in decoded export frames: a 40u circle is 432 × 432 px at 1080p).
- **Caps.** 12 held graphics; a graphic over 1.5 M characters of JSON is refused ("too large… usually from a big picture").
  When a film holds 12 and some are no longer used (their scenes removed this session), room is made from those only.
- **The reader** indexes the stored list (≤ 10,000 entries) by id, reads only the graphics scenes use, in order, at most 12 kept
  and 36 tried, through `readMotion` (every function here also skips entries of a stored list that are not objects, so a film
  the store has not read yet refuses rather than throws); drops a motion scene whose graphic is gone, takes off an overlay whose graphic is gone (and
  any `over` on a motion scene); keeps `loop` only as `true`; caps titles through Motion's `readTitle`. 5,000 held graphics read
  in ~2 ms. Fuzzed (1,500 junk films). The views also read every held graphic through `heldDoc` (once per held object), so
  nothing unread reaches `paint` even before the store reader is mounted.
- **Undo.** `videohistory.ts` does not track `motions`. So removing the last scene that uses a graphic does **not** let go of it
  (the storyboard hands up the scene list alone) — undo brings the scene back and its graphic is still held. The graphic is let
  go by `readVideoMotions` when the film is next read (once a session, before any history exists). Tested with the pure
  `recorded`/`undone`, including the contrast case (letting go at once would break undo).
- **The model** never sees a held graphic's layers: a scene's JSON carries `"motion":"<id>"` (and `"over":{…}`), plus a note
  "a graphic the person made in Motion and placed here: only its seconds and transition are yours to change". A reply keeps a
  motion scene (by its exact held id — an edit of its seconds or transition works) and every overlay through chat edits, a redo
  and a translation (tested). It cannot place, move or remove a graphic on top: `sanitizeScene` reads no `over`, and `edit_scene`
  and `parseScene` put back the scene's own. Nothing in the catalogue or the schema offers the kind; a reply that names a held
  graphic's exact id in `add_scene` would get a scene that plays it (as `duplicate_scene` would) — never a new graphic.

## The hard part: proven in the app's own WebKit

Harness (git-ignored): `app/.test-build/vm-harness/` — `host.swift` (the QA host from `vylo-editor-motion`, plus a content blocker
that lets nothing load but `127.0.0.1`, `data:`, `blob:`), `run.mjs`, `stub.ts` (Tauri fake; the Google font files answered with
this Mac's Arial, the app's own Arabic face served where `styles.css` looks for it, Remotion's licence telemetry answered locally
and recorded — **no request left the machine**), `fixture.ts`, `sample.ts`, `proof.tsx`, `ui.tsx`, `analyze.mjs`, `analyze-hold.mjs`.
Run from `app/`: `node .test-build/vm-harness/run.mjs .test-build/vm-harness/proof.tsx "window.__run('export', '<abs>/proof.mp4')" out.json --timeout 600`,
then `node .test-build/vm-harness/analyze.mjs <abs>/proof.mp4` (modes: `export`, `export720`, `export4k`, `hold`, `sample`, `preview`, `perf`).

- **Export** — the app's own `renderVideo` (→ `renderMediaOnWeb`, same options) in WKWebView (macOS 26.2). Proof film: title →
  kinetic scene with a green graphic on top from 1.5 s → a portrait magenta-circle graphic scene (4 s, graphic 3 s, cyan bar at
  1–2 s) → close; hard cuts. Decoded with ffmpeg: **38/38 pixel checks pass at 1080p, 720p and 2160p**: each colour in exactly its
  frames over all 420 (green 135–194, magenta 210–329 incl. the held last second, cyan 240–269), the circle round and 40u, the bar
  and the tag at their pins. Render times: 2.3 s (1080p), 2.5 s (720p), 7.4 s (4K) for 420 frames. In the 4K export the graphic
  canvases in the renderer's page were **3840 px wide** (a MutationObserver on its scaffold): painted at 4K, not scaled up.
- **The first frame waits** (`useDelayRender` around `preload`): a film that *opens* with a graphic holding a 2000 × 2000 picture,
  and a later graphic with a picture and Arabic words in the app's own Arabic face. Decoded: **14/14** — the picture is whole on the
  film's frame 0 and on the later scene's first frame, and the Arabic is set in the same box and ink on its first frame as half a
  second later. The control in the same page: Motion's `paint` drawn before the picture decodes draws none of it (0 px), after
  `preload` all of it — so the hold is what makes those first frames whole.
- **Preview** — `@remotion/player` with the sample film (templates that move every frame): after 11 seeks and 3 play-then-pause
  runs, the graphic's canvas equals, byte for byte, Motion's `paint` of the same graphic at the moment that frame should show
  (diff 0), and differs from the moments one frame before and after wherever the graphic moves. The player kept **29.7 fps** over 3
  s of the graphic scenes (the page was made visible with the QA host's rAF shim: an off-screen WKWebView page is hidden and gets no
  animation frames; the export proof ran without the shim).
- **Paint cost** at the film's size, flushed every frame (`getImageData`), WebKit: 1.3–7.6 ms a frame at 1920×1080 over 8
  templates (big-number 6.9, kinetic 7.6, lower-third 1.3), 1.7–5.6 ms at 1600×900. Node, recording canvas (JS only): 0.07–0.54 ms;
  the test holds it under 8 ms × SLOW. In the player the canvas's backing store is its shown size × the screen's density, not the
  full frame; in the export it is the frame × the export's scale (`usePixelDensity`).
- **Storyboard** (`ui.tsx`, en light, ar dark, ckb light, kmr light, en dark empty): the kind is offered; the list opens with the
  focus on the first graphic; Escape closes it and the focus is back on Add a scene; choosing adds the scene and holds the
  graphic in one `onVideo` step and opens the card; Repeat; Update from Motion appears after the saved graphic changes and
  replaces the copy; Graphic on top → Add, Starts at 1.5, Remove; focus back on the button after a pick; no console errors.

Samples: `/Volumes/ExtremeSSD/apps/vylo-vm-samples/video/` — `vm-video-sample.mp4` (19 s, templates: a lower third over a scene,
a portrait big number and a big title as scenes, transitions, the style's look) and `vm-video-sample-contact-sheet.png`;
`vm-video-proof.mp4` and `vm-video-proof-contact-sheet.png` (the pixel-check film).

## Gates

`npm test` (whole chain, incl. orphans and i18n parity), `npx tsc --noEmit`, `npm run build`: green. `vm-video.test.mjs`: 129 passed.
One run of the chain failed a timing check in `pro-perf.test.mjs` ("stopped 40 ms into a 30 s bed… 40.8 ms after the stop",
the sound bed, not this package); it passed alone three times (22–25 ms) and the chain passed again after.

## What the integrator must mount (also in `docs/vm/requests/video.md`)

1. **`VideoPanel.tsx`**: `<Storyboard … onVideo={change} />` (the same `change` every hand edit goes through). Without it the
   storyboard shows no way in to a graphic (no "Motion graphic" in Add, no Graphic on top row) and behaves exactly as before.
2. **`videostore.ts` `checked()`**: `out = readVideoMotions(out);` (import from `./videomotion`). Until then the views read every
   held graphic themselves (`heldDoc`), and a scene whose graphic is missing paints the film's background — but stale scenes and
   unused graphics are not dropped from storage.
3. **Recommended, `videohistory.ts`**: `'motions'` in `TRACKED` and `snapshotOf`, so Update from Motion is undoable too (today it
   is not recorded; adding/removing scenes is). Nothing else needs to change for it.

## Deviations

- **`VideoArt.tsx`** (not in the brief's list): `SceneKind` includes `'motion'`, and three `Record<SceneKind, …>` there (hue, gallery
  group, picture) failed `tsc`; one entry each was added. The alternative (excluding `'motion'` from `SceneKind`) broke
  `VideoSound.tsx`, `VideoDownloads.tsx` and `VideoHome.tsx`, which are off limits. Side effect: the Video home's gallery of kinds
  shows a "Motion graphic" card.
- **`SCENE_KINDS` includes `'motion'`**, so `sanitizeScene` reads the kind — only ever as a graphic the film already holds, by its
  exact id. The model is not told it can make one.
- **The sound sentence** shows only when the graphic has a sound of its own (a sentence about a sound that does not exist would
  confuse).

## Open problems

- Fonts in the harness were this Mac's Arial instead of the styles' Google fonts (no network); the film's own text faces were
  not the subject. Motion's own faces (system + bundled Arabic) were used by the graphics.
- **Undo at the cap.** The one place the edit path lets go of a graphic: a film already holding 12, some no longer used (their
  scenes removed this session), lets go of those to take a new one. Undoing one of those earlier removals then brings back a scene
  whose graphic is gone: it shows the film's background, and the next read of the film drops it. Request #3 (`'motions'` in
  `TRACKED`) removes the case.
- **The sound sentence** is shown only when the graphic has a sound of its own; VM.md says "do not hide it". If the review wants
  it always, it is one line in `VideoMotionPicker.tsx` (`SoundNote`).
- An overlay's graphic is not shown in the timeline (`VideoTimeline.tsx`, not in this package).
- Found, not mine: the clip row's "Its own sound" uses `vid-f vid-check`, and `.vid-f input` gives the checkbox the full width, so
  its label is pushed to the far edge. The graphic's Repeat row uses `vid-check` alone.
