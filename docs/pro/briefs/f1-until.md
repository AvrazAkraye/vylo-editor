# F1: a template owns a span, not the whole graphic

Read `docs/PRO.md`, `docs/pro/requests/R3.md` (item 1 is this package, with the reasoning and a proposed design), `docs/pro/review-interface.md`, `docs/pro/scenes.md`.

## The problem
Home, pick Big title, press "+ Scene": the graphic grows by an empty scene and Design's *Words on screen* form disappears ("This graphic has no template words to change here"). The cause: scene edits that move layers in time detach the template link, because a rebuild would lay the template across the whole length and undo the scenes. The shortest path (change the words) must survive the new feature.

## Deliver
Implement the design in R3's request, or a better one you can justify in `docs/pro/f1-until.md`:
- `RecipeRef` gains an optional `until?: number`; absent means the whole graphic, as today, so everything stored and every old document is unchanged (a fixed-point test over the 33 templates).
- `addScene` at or after the end of the template's span keeps `recipe` and sets `until`; adding a scene inside the span still detaches. `setFields`, `setLang`, `setFormat`, `setSeconds`, `setPalette`, and the chat's `rebuilt` rebuild the template for `until` seconds, keep the layers the fresh build does not make (the added scenes' layers) where they are, and keep `seconds`, `scenes`, `sound`, and the brand `look`.
- `splitSceneAt`, `setTransition`, `renameScene`, `moveScene` keep behaving as they do and are checked against the new rule; `readMotion` clamps `until` (finite, within the document, at least the minimum length) and `until` never outlives its template (a hand edit still detaches).
- Design's *Words on screen* form stays after "+ Scene"; the form edits only the template's part.
- The shortest-path test: build Big title, `addScene(m, 1)`, `setFields(m, { title: 'New' })`: the title changes, the second scene's layers and the scenes are unchanged, `readMotion` is a fixed point; the same through the chat's rebuild.

## You own
`motiontypes.ts` (RecipeRef only), `motionread.ts` (the recipe reader only), `motionscene.ts` (edit functions), `motionedit.ts`, `motionchatops.ts` (`rebuilt` and its callers), `motionstate.ts`, `motionui.ts`, `MotionDesign.tsx` (only if the form needs a hook), the tests that cover them (extend, never weaken), a new `test/pro-until.test.mjs` (wire into package.json before orphans.test), `docs/pro/f1-until.md`. Another agent (F2) is changing `motionsound.ts`, `audio*.ts`, `MotionExport.tsx`, `MotionKinds.tsx`, `MotionControls.tsx`, `docs/MOTION.md`: do not touch those.

## Acceptance
Fuzz the edit sequences (random mixes of addScene, splitSceneAt, setFields, setSeconds, setFormat, undo-shaped re-reads): always a valid document, `readMotion` a fixed point, no template layer ever duplicated, no scene layer lost. `npm test`, `npx tsc --noEmit`, `npm run build` pass. Commit only your paths on your branch; do not push or merge.
