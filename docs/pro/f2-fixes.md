# F2: the reviews' remaining small fixes

Branch `pro-f2-fixes`, from `pro` at `e6a619f`, 2026-10-03. The brief is `docs/pro/briefs/f2-fixes.md`; the
findings come from `docs/pro/requests/R1.md` (items 1-4) and `R2.md` (item 1). Nothing is pushed or merged.

## 1. Scene sound (R2 item 1)

**What was wrong.** When a scene arrives with a transition, the scene before it holds still from its hold moment
(`sceneHold`) to the cut, and its exits are never drawn. `soundCues` did not know, so each of those exits still
sounded: on R2's four-scene film, reversed whooshes at 2.55, 5.55, 8.4 and 8.55 s over a still picture.

**The rule now** (`motionsound.ts`, header section "Scenes", `stillsOf` and `heardAt`):

- The stretches the picture stands still through are `[sceneHold(doc, i), scene i's end)` for every scene whose
  next one arrives by anything but a cut, from `sceneList` and `sceneHold`: the lookups the painter's own hold is
  computed by, so the two cannot disagree. A cut makes no stretch; a graphic without scenes has none.
- A cue that starts inside a stretch is dropped: exits the transition took over, entrances of layers that would
  have appeared during the exit (scenes.md: "never seen"), the last ticks of a count. Its music accent goes too,
  because `musicCuesOf` reads the same cues.
- One exception: a layer that **arrives** inside a stretch and is still on screen after the cut. The new scene's
  picture, which plays live from the cut, is the first to show it (mid-arrival), so its cues are heard **at the
  cut**. Cues moved onto one cut are thinned like any others.
- Everything from the cut on is untouched: the next scene's entrances play, and are heard, at their own times
  during the transition. Exits of a layer that runs across the cut happen in the later scene, where they are drawn.

The filter runs before thinning, so a dropped cue frees its room for others. `soundKey` hashes the cues, so a bed
made before the fix is never reused. `SOUND_VERSION` did not need a bump.

**Proof** (`test/pro-fixes.test.mjs`, "scene sound"): R2's film is rebuilt exactly as `holdcheck.mjs` built it.
The stretches are 2.4-3, 5.55-6 and 8.4-9 s. No cue starts in them, and the four whooshes are gone. Joined by cuts
instead, the same film has exactly those four whooshes and is otherwise identical to the last digit. Fourteen
cues of the next scenes' entrances still sound inside the three transitions, the music's accents are unchanged, and the recording canvas
shows that every frame inside each stretch is the hold moment's frame, call for call. Edge cases: a layer arriving
inside a stretch and staying is heard at 3.0 s, or at 2.6 s when the join is a cut; one that arrives and is gone by
the cut is silent; a big title landing there is no music accent; a layer running across the cut keeps its exit.
**Without scenes nothing changed:** a SHA-256 over the cues of 1,784 graphics (every template in every shape,
language and three levels, plus 200 random graphics; 13,884 cues; kind, time, length, gain, direction and layer)
equals the digest taken from the derivation on `pro` before the fix. Pan and pitch are left out of the digest so
that R2 request 4 (`PAN_WIDTH`) can be tuned without retaking it.

`motionscene.ts` was not touched. Only its existing exports `sceneList` and `sceneHold` were needed, and
`motionsound.ts` now imports them at run time. `motionscene.ts` imports neither `motionread.ts` nor `motiondraw.ts`
nor `motionsound.ts`, so there is no cycle.

## 2. The audio library's readers (R1 item 1)

`audiocore.ts` gained the three reads `motionread.ts` uses: `rec` (an object, or null, and never throws on a
revoked Proxy), `own` (an own field, read once in a try) and `listOf` (one index at a time, up to a cap; a hole or a
throwing index is `undefined`). The readers are built on them:

- `audioauto.ts`: `readLane`, `readAutomation` and `readPoint`. Each field is read once; points are capped at
  16,384 entries looked at and lanes at 128; every number goes through `|| 0` after its clamp, so `{ t: -0, v: -0 }`
  reads back as `{ t: 0, v: 0 }`. Both readers are wrapped in a try.
- `audiofx.ts`: `readFx` (own fields, knobs never -0, wrapped in a try) and `readChain` (the first `MAX_CHAIN * 4`
  = 64 entries, by index). `run` (`renderChain`, `chainEnvelopes`) and `buildChain` now read their chain by index
  too.
- `audioduck.ts`: `readDuck` (own fields, never -0). `duckLaneFor` reads its spans by index, up to 2^19 (more than
  `findSpeech` can find in the hour a lane runs), with own fields.

A bad entry is that entry skipped. Against the pre-fix code, the five readers threw in 20 of 25 hostile cases; now
none does. `readChain` of 2^32-1 holes takes 0.1 ms (R1 measured about 57 s). In `test/pro-review-safety.test.mjs`
the `KNOWN` line is gone: the five readers are in the hostile matrix (12 new reader entries, 46 readers and 1,748 calls in all),
and the audio block makes six real assertions.

## 3. The Export tab's network import (R1 item 2)

`IS_MAC` is now in the new `src/platform.ts`, which imports nothing. `MotionExport.tsx` imports it from there.
`Welcome.tsx` imports it and re-exports it (`export { IS_MAC }`), so App, Slides, Settings and Research are
unchanged. Motion's closure is now 102 files (the review counted 108). In the safety test, `account.ts` and `gateway.ts` are out
of `REACHED` and `list_tree` and `read_file` are out of `PINNED`. A new assertion says that Welcome, SignIn,
account, gateway and environment are all outside the closure.

## 4. The layer panel's limits (R1 item 3)

- **Outline width** (`MotionKinds.tsx`): `max={textOutlineMax(layer.size)}`. The test renders the field and reads
  its `aria-valuemax` for 1, 3, 7.7, 25, 40, 60 and 200u words. A width typed at the ceiling reads back unchanged.
- **Rounding at an edge** (`MotionControls.tsx`, new `storedOf`): a box used to round what it sent to its digits,
  so a ceiling such as 2.6665u (5.333u words) was sent as 2.67 and taken back by the reader. It now sends the
  nearest value inside the edge (2.66). Round edges behave as before; the test covers both.
- **Shadow blur: not done.** That field is in `MotionLayers.tsx` (`StyleFields`), which is not on F2's list.
  The brief named `MotionControls.tsx`, but the field is not there. The change it needs is one line, plus the
  import of `textShadowMax` from `./motionread`:

  ```tsx
  <NumberField label={t('Blur')} value={shadow.blur} min={0} max={layer.kind === 'text' ? textShadowMax(layer.size) : 100} ...
  ```

## 5. docs/MOTION.md (R1 item 4)

"Limits" now names `MAX_DASHES` (4,000) and the words' outline and shadow ceilings. The opening paragraph names
the safety review's closure scan and its trapped network. The Sound paragraph says that a still stretch before a
transition is silent. The test checks that the numbers in the text are the code's.

## Tests

- `test/pro-fixes.test.mjs` is new: **44 checks**, wired into the chain before `orphans.test`.
- `test/pro-review-safety.test.mjs`: **63 checks**.
- `npm test`: the whole chain passes (exit 0, no FAIL line, about 78 s). `npx tsc --noEmit` and `npm run build`
  pass.

## Not done, and why

- **Shadow blur field** (above): it needs `MotionLayers.tsx`.
- **Not in this brief:**
  - R1 item 5 (`gifPlan(null)`, `gifSizeFor('__proto__')`).
  - R2 item 2, including its os-error-28 sentence in `MotionExport.tsx`.
  - R2 items 3-5.
  - R3 item 2 (`motioncheck.ts`).
- **Not verified:**
  - Nothing was heard: the scene fix is proven on cue lists and canvas calls, not by ear.
  - The panel was rendered by React's server renderer, not in the app's WebKit.
  - `docs/pro/review-safety.md` still lists these items as "not fixed here". It is the reviewer's page, so F2
    left it alone.
