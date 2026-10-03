# F2: the reviews' remaining small fixes

Read `docs/PRO.md`, `docs/pro/requests/R1.md`, `R2.md`, `R3.md` (items other than 1), `docs/pro/review-export.md`, `review-safety.md`, `review-interface.md`.

## Deliver (each with a test)
1. **Scene sound (R2)**: when a scene ends with a transition, its layers' exit animations are skipped (the scene holds still at `sceneHold`), but `soundCues` still derives whooshes/pops from those exits, so they play over a frozen picture about half a second before each cut. Cues from an exit must be dropped when the scene hold removes that exit (and entrances of the next scene should be heard at the moment they actually play); derive this from the same scene functions the painter uses so they cannot disagree. Prove it on the sample the reviewer used (a four-scene film: the cues at 2.55, 5.55, 8.4, 8.55 s must be gone) and for a graphic without scenes (cues unchanged).
2. **Audio readers (R1)**: `audioauto`, `audiofx`, `audioduck` readers throw on Proxies, and `readChain` takes ~57 s on a sparse list. Nothing feeds them outside data yet, but harden them like the other readers (one safe read per field, bounded length, a bad entry skipped), and turn the reviewer's "known" test lines into real assertions.
3. **The export tab's network import (R1)**: `MotionExport.tsx` takes `IS_MAC` from `Welcome.tsx`, which pulls the sign-in network modules into Motion's import graph. Move the platform test to a tiny module with no such imports (or use what the Motion code already has), update `Welcome.tsx` only as far as needed to use it, and update the safety review's pinned list (`test/pro-review-safety.test.mjs`) so it now asserts Motion reaches no network module.
4. **The layer panel's limits (R1)**: the outline and shadow fields still offer 20u and 100u on small text, though the reader now caps them to the type size (half for outlines, twice for shadow blur); make the controls offer what the reader keeps, so a value never snaps back.
5. **Docs (R1)**: `docs/MOTION.md` lists the two new limits (dashes per stroke, outline and shadow relative to type size) beside the others.

## You own
`motionsound.ts` (cue derivation only; the renderer part belongs to a finished review: keep its fixes), `audiocore.ts`, `audiofx.ts`, `audioauto.ts`, `audioduck.ts`, `MotionExport.tsx`, a small new platform module, `Welcome.tsx` (only the import), `MotionKinds.tsx`, `MotionControls.tsx`, `docs/MOTION.md`, `test/pro-review-safety.test.mjs`, `test/pro-sound.test.mjs`, `test/pro-audio.test.mjs`, a new `test/pro-fixes.test.mjs` (wire into package.json before orphans.test), `docs/pro/f2-fixes.md`. Another agent (F1) is changing `motiontypes.ts` (RecipeRef), `motionread.ts` (recipe reader), `motionscene.ts`, `motionedit.ts`, `motionchatops.ts`, `motionstate.ts`: do not touch those; if the scene sound fix needs a `motionscene.ts` function, use the existing exports (`sceneHold`, `sceneList`, `sceneSpan`) and say what you needed.

## Acceptance
`npm test`, `npx tsc --noEmit`, `npm run build` pass. Commit only your paths on your branch; do not push or merge.
