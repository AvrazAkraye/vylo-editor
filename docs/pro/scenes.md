# Scenes and transitions: the model

Work package 05 of the Pro pass. The code is `app/src/motionscene.ts` (the model, the reader, the frame, the
edits), `app/src/motiontransition.ts` (the thirteen transitions) and `app/src/MotionScenes.tsx` (the strip); the
tests are `app/test/pro-scenes.test.mjs`. This page is the prose version of `motionscene.ts`'s header.

## What a person sees

A graphic is one scene until somebody adds a second. The studio shows a single quiet **+ Scene** above the
timeline and nothing else. Press it and the graphic grows by a three-second scene that arrives with a fade; the
strip now shows a chip per scene (as wide as the scene is long, in time order like the timeline), a small chip
between two scenes saying how the second arrives, and **+ Scene** and **Split here** at its end. A scene chip
takes the playhead to its scene and opens a short menu (name, move earlier or later, join with its neighbour). A
transition chip opens the kinds, the direction for the kinds that have one, and the length.

## The document

```
Motion.scenes?: SceneSpec[]            absent (or fewer than two) is one scene, exactly as before

SceneSpec
  id          s1, s2, …                unique among the scenes
  name        ""                       empty shows as "Scene n"
  start, end  seconds                  back to back: the first at 0, each where the last ended, the last at the end
  transition? { kind, d, dir?, ease? } how the scene ARRIVES; absent is a cut; never on the first scene

kind   cut fade push slide iris clock blinds pixelate zoom whip flash light-leak glitch
dir    start end up down               logical, as for the layer effects; only push, slide, blinds, whip, light-leak
ease   linear in out inout soft cubic-out quart-out expo-out expo-inout circ-out snappy   (never one that turns back)
```

A model writes the same thing, loosely: `"scenes": [{ "name": "Hook" }, { "start": 3, "transition": "push" }]`.
A missing `start` follows the entry before (its `end`, or its `start` plus `duration`); a bare word is a
transition as designed; `crossfade`, `zoom-through`, `whip-pan`, `circle` and the like are read as the kinds
they mean. `left` and `right` are never directions (they swap in Arabic).

### Limits (`LIMITS` in motiontypes.ts)

| | |
|---|---|
| scenes | at most 12; fewer than 2 is none |
| a scene | at least 0.5 s; times kept to the millisecond |
| a transition | 0.15 to 1.5 s, and never longer than either scene beside it |

`readScenes` enforces them for a model's answer, a stored record and a hand edit alike. Out of order is put in
order; the first scene starts at 0 whatever it says; a scene starting less than 0.5 s after the one before, or
less than 0.5 s before the end, is dropped and its time joins its neighbour; a missing or repeated id gets the
first free `sN`.
It never throws and its result is a fixed point.

## The choice: a layer belongs to a scene by its time

There is **no `scene` field on a layer**. A layer is in the scenes it is on screen during. The alternative, an
optional `scene` id on `LayerBase`, was considered and rejected:

- **Nothing else has to change.** The flat `layers` list, every edit in `motionedit.ts`, the timeline's drags,
  the chat's operations, the templates and the model's vocabulary keep working as they are. Dragging a layer into
  the third scene's time puts it in the third scene; there is no second fact to keep in step with the first.
- **A document cannot be wrong about it.** With an id, a layer could name a scene that is not there, or sit in a
  scene whose time it is not on screen during; the reader would have to repair both, forever.
- **The model need not learn it.** A model that writes scene boundaries gets scenes; it does not have to tag
  sixty layers.
- **The frame stays the frame.** Outside a transition (and the hold before one), a graphic with scenes paints
  exactly what it painted without them, because a scene's picture *is* the graphic at a moment.

What the choice costs: a layer that runs across a cut (a background under the whole film, a logo in a corner) is
in **both** scenes' pictures, so a push moves it out with the old scene and back in with the new one, as a whole
picture would. That is how a push looks in any editor whose clips each carry their background, and it is the
honest reading of "the transition moves the picture". Such a layer belongs to the film, not to a scene: moving a
scene leaves it where it is.

## The frame

1. **No scenes, or one:** `paint` never calls into `motionscene.ts`. Proven: the eighteen templates, nine moments
   each, record the same draw calls with `scenes` absent, empty, one scene, or cuts with no transition; and a
   separate comparison against Phase 0's own `motiondraw.ts` (2,592 frames: every template, shape and language)
   found no difference.
2. **The transition is the exit.** When a scene arrives with anything but a cut, the scene before it holds still
   from its *hold moment* until the cut. The hold moment is the last instant before any of its layers begins to
   leave: start at the cut; while some layer is still leaving there (its exit begun, `outStart` in motionanim.ts,
   and not over), move back to where that exit began. A layer that left and was gone earlier in the scene does not
   count; with no exit at all the hold is a millisecond before the cut. Its exits are therefore never played —
   the transition takes them over, which is HyperFrames' rule ("exit animations are banned except on the final
   scene; the transition is the exit") and is what makes an iris or a push read as one move. A scene that arrives
   by a **cut** leaves the one before exactly as designed, exits and all.
3. **During a transition** (from the cut, for `d` seconds) the frame is the old scene's picture, frozen at its
   hold moment, mixed with the new scene's picture, which plays from its own start (entrances and all). Each
   picture is `paint` of the same graphic, scenes left out, at a moment, onto one of two offscreen canvases kept
   per frame size and reused (`motiondraw.ts` hands `paintScenes` its own drawing as a function, so
   `motionscene.ts` never imports it).
4. Everywhere else, `paintScenes` returns false and `paint` goes on as it always did.

A layer that *starts* after its scene's hold moment is never seen when the next scene arrives with a
transition: it would have appeared during the exit. That is a consequence of the rule, not a bug.

## The transitions

All Canvas2D, no `ctx.filter`, pure and seeded (`hash01` of the scene's id and the progress), progress eased by
a curve that never turns back. At progress 0 only the old picture is drawn and at 1 only the new one: the other is
not drawn at all, so the frames either side of a transition are a scene's own.

| kind | how | defaults |
|---|---|---|
| fade | `old·(1−p) + new·p`, mixed exactly on the old picture's canvas (`destination-in`, then `lighter`) | 0.5 s soft |
| push | both pictures side by side, moved along the way of travel, on whole pixels | 0.5 s inout, from the far side |
| slide | the new picture slides over the old, which is drawn only where not yet covered | 0.5 s quart-out |
| iris | a circle from the centre: the new picture kept inside it (`destination-in`), the same circle cut out of the old (`destination-out`), the two added (`lighter`) | 0.6 s inout |
| clock | a wedge from twelve o'clock, clockwise in a left-to-right graphic and the other way in a right-to-left one | 0.6 s inout |
| blinds | eight bars across the way of travel, each filled from its leading edge, cut at whole pixels | 0.5 s inout |
| pixelate | the old picture breaks into blocks (up to about 24 across the short side) and the new one resolves out of them | 0.6 s linear |
| zoom | through: the old grows toward the viewer and fades, the new settles from close up (1.2 to 1); both always cover the frame | 0.45 s expo-inout |
| whip | a push with a smear of six trailing copies (a running mean), strongest at the middle | 0.4 s expo-inout |
| flash | through white, laid `source-atop` so a transparent graphic flashes its own shapes and not the empty frame | 0.5 s soft |
| light-leak | a fade with a warm glow washing across along the way of travel (`screen`) | 0.8 s soft |
| glitch | horizontal slices knocked sideways, and a red and a cyan copy either side with `lighter`. **Approximate**: a true colour split takes each channel from its own place, which needs per-pixel work | 0.3 s linear |

Pixelate, glitch and flash show one picture at a time, swapping at the middle, so the other picture is never
painted and its canvas is their scratch: no kind needs a third canvas. A transition frame costs about two frames:
2.0x the time and 2.06x the canvas calls of a normal frame in the test (recording canvas, `stats` template), and
2.04x in WKWebView at 960 x 540 (2.35 ms against 1.15 ms, read back each frame).

**Checked in the app's own engine.** A throwaway harness (a WKWebView with a non-persistent store, not part of
`npm test`) ran every kind in both directions at every twentieth of its progress over two opaque pictures: no pixel
of any frame fell below opaque, so no edge lets the ground through. It also confirmed the exact mixes (a fade of red
and blue at 0.5 is 128/0/128; of two half-transparent pictures, alpha 128), that a transparent new scene does not
let the old one show through an iris or a slide, that a flash on a transparent ground whitens only what is drawn,
that `ctx.filter` is absent, and it rendered a contact sheet of all thirteen through `paint` with no error. Two
first attempts at the shaped reveals failed it and were replaced: a clip for the second fill left edges up to 4%
see-through round a small iris, and cutting the new scene with an even-odd complement up to 18%; and a blinds frame
whose bars were not yet a pixel wide added the new scene whole over the old (an empty path is not filled), which is
why a shape with no area is not mixed at all.

## The edits (pure, in `motionscene.ts`)

Each returns a new `Motion` that `readMotion` reads back unchanged (fuzzed: about 1,200 random edits on the
templates), or the same object when nothing changed (no undo step).

| edit | what it does to time and layers | template link |
|---|---|---|
| `addScene(doc, at)` | adds an empty scene after the one `at` is in; the graphic grows by 3 s (or what is left under 30 s). A layer starting at the cut or later moves later; one across the cut grows; at the end, a background (`backdrop` layer) that ran to the end runs on. It arrives with the graphic's most used transition, or a fade. | kept when the cut is at or after the end of the template's part (it then owns only that part: `recipe.until`, `docs/pro/f1-until.md`); dropped inside it |
| `splitSceneAt(doc, t)` | cuts the scene `t` is in at `t`; nothing moves; the second piece arrives by a cut, so the graphic looks the same until a transition is chosen. Both pieces must be at least 0.5 s. | kept |
| `removeScene(doc, id)` | joins the scene to the one before (the first: to the one after); no layer moves or goes. One scene left is none. | kept |
| `moveScene(doc, id, to)` | reorders; scenes keep their lengths and transitions and are laid back to back; a layer wholly inside a scene moves with it; a layer across a cut stays. The new first scene loses its transition. | kept when the move is among the scenes after the template's part; dropped otherwise |
| `setTransition(doc, id, spec)` | a kind, part of `{ kind, d, dir, ease }`, or `null`/`'cut'`. Another kind starts from its own length and curve and keeps the direction. | kept |
| `renameScene(doc, id, name)` | one line, at most 60 characters | kept |

Lookups: `sceneList`, `sceneAt`, `sceneSpan` (where a layer added at the playhead belongs), `sceneHold`,
`canAddScene`, `canSplitAt`, `primaryTransition`, `sceneName`.

## Not in this package

The chat's `scene.*` operations, mounting the strip, carrying scenes through a template rebuild and a change of
length, and placing a new layer in the current scene: see `docs/pro/requests/05.md`.
