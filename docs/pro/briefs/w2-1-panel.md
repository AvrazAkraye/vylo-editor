# W2-1 Panel wiring: put the new parts into the studio, and keep them through edits

Read `docs/PRO.md` (the simplicity contract is the point of this package), then every `docs/pro/requests/*.md` and the "mount" notes in the
work-package reports `docs/pro/{check,sound,scenes,gallery,templates-a,templates-b,export,direction}.md` that concern the panel.

## Why
Ten parts were built and tested apart. This package makes them one studio, and makes them survive an edit: today editing a template graphic's
words, shape, language or length rebuilds it and silently drops its sound, scenes and brand.

## You own
`app/src/MotionPanel.tsx`, `MotionDesign.tsx`, `MotionKinds.tsx`, `MotionControls.tsx`, `MotionTimeline.tsx` (only if a scene strip needs a hook),
`motionedit.ts`, `motionstate.ts`, `motionui.ts`, `motionstore.ts` (brand loading only), a new `app/test/pro-wiring.test.mjs` (wire it into `package.json`'s
test chain yourself, before `orphans.test`; the merge script unions `package.json`), `docs/pro/w2-panel.md`, your i18n entries (the merge unions i18n.ts),
CSS `/* pro:w2-1 */`. Others are working at the same time on: export (`MotionExport.tsx`, `motionexportops.ts`, Rust, SAFETY, notices), the chat
(`motionchatops.ts`, `motionai.ts`), and template polish (`motionrecipes-*.ts`): do not touch those.

## Deliver
1. **Mount, once each**, in both layouts (the sidebar, around `MotionStage` at about line 1322, and the full window at about 944):
   - `<MotionChecks t doc onApply onSelect />` in its own row by the stage, on the end side, **not** inside the stage's transport bar (that bar is forced
     left-to-right); do not pass a `ctx`.
   - `<MotionSoundPanel t doc onChange />` in `MotionDesign` (the Design tab), with `onChange={(next) => onEdit((m) => withSound(m, next.sound), 'sound')}` or the
     equivalent through the studio's edit path, so undo works. And exactly one `<MotionSoundPreview doc />` in `MotionPanel`.
   - `<MotionScenes t doc onEdit onSeek />` directly above `<MotionTimeline>` inside `.mo-full-time`.
   - `<MotionBrandKit t doc onChange />` in `MotionDesign`. In `startTemplate`: build through `kitOptionsWithBrand(options, currentBrand())`, and `loadBrand()` once
     when the panel opens.
2. **Edits keep what they should** (`motionedit.ts`): `rebuild()` carries `sound`, `scenes` and `look: lookOf(m)`; `setSeconds` keeps scenes valid (state your
   rule: the last scene stretches or shrinks, others are clamped; never a stale or overlapping scene); a new layer (`addLayer`) spans the scene the playhead is
   in when the graphic has scenes (`sceneSpan`), the whole graphic otherwise. The hand-edit "detach" still works. Tests for each, including a round trip
   through `readMotion`.
3. **New kinds appear properly** in `MotionKinds.tsx`/`MotionControls.tsx`: the backdrop kinds `grain`, `vignette`, `lightleak`, `scanlines`, `halftone` and the
   `race` chart show their own names and icons in the inspector (their translations already exist), with the controls their fields need.
4. **Look at it.** Mount the panel in an off-screen WebKit page (there is a panel harness from the 0.132.0 work at
   `/Volumes/ExtremeSSD/apps/vylo-editor-motion/app/.test-build/motion-harness/` and a check harness at
   `/Volumes/ExtremeSSD/apps/vylo-editor-pro/app/.test-build/check-harness/`: read them, copy what you need into your own git-ignored `.test-build`, never drive the
   owner's running app). Capture the studio in English and Arabic, light and dark, with a plain graphic and with a multi-scene one. Describe what you saw in
   `docs/pro/w2-panel.md` and **judge it against the simplicity contract**: count the new always-visible controls on the first screen (budget: the check chip and
   one Sound row, nothing else), and say so honestly if something is noisier than it should be, then fix it.

## Acceptance
- Shortest path unchanged: Home, pick a template, change the words, Export: no new step or decision. A plain graphic shows the check chip and (in Design) the Sound
  row; scenes show only a quiet "+ Scene".
- Keyboard and RTL work for everything you mounted. `npm test`, `npx tsc --noEmit`, `npm run build` pass. Commit only your paths on your branch; do not push or merge.
