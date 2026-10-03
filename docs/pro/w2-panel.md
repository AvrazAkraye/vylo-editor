# W2-1 Panel wiring

Wave 2 of the Pro pass (`docs/PRO.md`, brief `docs/pro/briefs/w2-1-panel.md`), branch `pro-w2-panel`. The ten parts
of wave 1 are now one studio, and a template graphic's edits no longer drop its sound, scenes or brand.

## What is mounted where

| Part | Sidebar (`View`, MotionPanel.tsx) | Full window (`stage`, MotionPanel.tsx) |
|---|---|---|
| `MotionChecks` (via the panel's `Checks`) | a row of its own under the compact stage, end side | a row of its own under the transport, end side, lined up with the bar's end |
| `MotionSoundPreview` | exactly one, in `View` (which both layouts render), while a finished graphic is open | the same one |
| `MotionScenes` | not mounted (the sidebar has no timeline) | directly above `MotionTimeline` in `.mo-full-time` |
| `MotionSoundPanel` | Design, a one-row section after Length | the same (Design is the side column) |
| `MotionBrandKit` | Design, on the Colours heading's line, at its end | the same |

- The chip is never in `.mo-stage-bar` (that bar is `dir="ltr"`); no `ctx` is passed. A repair is `onEdit(() => next)`,
  one undo step; a tip selects its layer.
- Sound: `onChange={(next) => onEdit((m) => withSound(m, next.sound), 'sound')}`, so it applies to the newest copy and a
  level drag is one step.
- Brand: `startTemplate` builds through `kitOptionsWithBrand(..., currentBrand())` (Home's cards and the sidebar's
  template cards both go through it); `loadBrand()` runs once, in the effect that loads the graphics. With no kit the
  options are the very object, so a template starts exactly as before.
- Layers' edits go through `inScene`: `placeAdded(m, change(m), read().t)`, so "Add a layer" lands in the scene under the
  playhead when the graphic has scenes.

## Edits keep what they should (`motionedit.ts`)

- `rebuild()` (behind `setFields`, `setFormat`, `setLang`, `setSeconds` on a template graphic) passes `look: lookOf(m)` to
  `buildMotion`, copies `sound` as it was, and re-reads `scenes` for the rebuilt graphic. A graphic without sound or scenes
  gets no key (the reader's fixed point).
- **The length rule** (stated in the header): a cut stays where it was put; the scenes before the end keep their starts
  and lengths; the **last scene stretches or shrinks** to the new end; a scene that would start less than 0.5 s before
  the new end goes and its time joins the one before (one left is none); a transition longer than a scene it now sits
  beside is shortened. It is `readScenes` read for the new length, so memory always holds the reader's list. Template and
  hand-edited graphics follow the same rule.
- `addLayer(m, kind, patch, now, at?)`: with scenes and a playhead `at`, the layer runs through `sceneSpan(m, at)`; without
  scenes, or without `at`, the whole graphic as before; a `start`/`end` in the patch wins. `placeAdded(before, after, at)`
  does the same for a change that added a whole-graphic layer without knowing the playhead; a copy (`duplicateLayer`) keeps
  its original's time.
- The hand edit still detaches (`setLayer` drops `recipe`, keeps sound and scenes).

## New kinds in the inspector (`MotionKinds.tsx`)

`backdropName` names `grain`, `vignette`, `lightleak`, `scanlines`, `halftone`; `chartName` names `race` (its glyph was
already in MotionControls.tsx). A finish's two sliders are named as that finish reads them (grain: Flicker, Coarseness;
vignette: Breathing, Reach; light leak: Blooms, Strength; scan lines: Rolls, Fineness; halftone: Flow, Fineness); a race
shows how its earlier values are written ("Rome|12 18 25") and hides Max, which a race does not use.

## Tests

`test/pro-wiring.test.mjs`, 96 checks, wired before `orphans.test`: sound kept through 130 rebuilds of all 33 templates
(and nothing else changed by it), scenes kept and re-read, the length rule both ways, 840 random edits fuzzed (scenes
always valid and the reader's own, sound never lost, every graphic a `readMotion` fixed point), the look kept through
four kinds of rebuild, unbranded templates identical to `buildMotion`, `addLayer`/`placeAdded`, detach, the mounts, and
Design and the inspector rendered. A rebuild with its look: median 0.2 ms in Node. `npm test` (exit 0), `npx tsc --noEmit`
and `npm run build` pass.

## What I saw

An off-screen WKWebView (`app/.test-build/w2-harness/`, git-ignored: `host.swift` with occlusion detection off and a
non-persistent store, `entry.tsx` mounting the real `MotionPanel` with a fake Tauri, `run.mjs`). Never the owner's app.
Captured: full window and sidebar, English/Arabic, light/dark, plain and three-scene graphics; Sorani and Badini for the
chip menu and the strip; the chip's menu, Fix all and undo; the brand sheet; the transition menu; Escape in each popup
(closes it, focus back on its trigger, the window stays); a template started from Home with a kit (palette, name, serif
face and logo applied); the inspector for a grain and a race.

**Against the simplicity contract.** Plain template graphic, first screen: full window (1280×800) shows two new things,
the green "Looks good" status under the transport and a quiet "+ Scene" at the end of a 28 px band above the timeline;
the Design column shows none above the fold. Sidebar (380×900): one, the status row (pushes the tabs down ~30 px).
Further down Design: the Sound row (one line, Off) and the Brand kit button, which takes no line of its own. That is the
budget (chip, Sound row, quiet "+ Scene"); the Brand button is the one addition, mounted because the brief asks for it.

Fixed because of what I saw: the Sound row's label column (now lines up with "Frame rate"); the brand sheet opening half
under the column's edge (now scrolled into view); the strip's menus clipped invisible by `.mo-full-time{overflow:hidden}`
(the area now lets them out; the timeline still scrolls inside its 40%, measured); the strip's chips on a different
time scale from the ruler (now on the timeline's axis, buttons in the names column); a 32 px band for "+ Scene" (28 px);
a "move the finish to the top" hint, dropped because the film-look template puts its caption over its finishes by design.

## Deviations

- Layers' Add is placed by a panel-side wrapper (`placeAdded`), because MotionLayers.tsx is not this package's file.
- The strip is full-window only; the sidebar shows no scene controls.
- `onSeek` is not passed to `MotionScenes` (it defaults to the studio's clock).

## Open problems

1. Adding a scene makes the check say "1 tip": the new scene is empty, and `empty-frame`'s Fix trims the graphic, which
   would delete that scene (motioncheck.ts, package 01; it does not read scenes yet).
2. With the strip on the time axis, its buttons sit before the track visually but after it in Tab order (CSS `order`);
   moving `.ms-end` before the track in MotionScenes.tsx would fix it.
3. Not verified: real key presses (only dispatched events), VoiceOver, sound actually heard, focus after "+ Scene" (the
   strip re-renders its button), Sorani/Badini wording (`review-needed.md`).
4. For W2-3: `motionchatops.ts` `rebuilt` should pass `look: lookOf(d)` and keep `sound`/`scenes`; the chat's add can pass `at`.
