# W2-4 Template polish: the real fonts' verdict, and the margins

Read `docs/PRO.md`, `docs/pro/RESEARCH.md` ("Direction numbers"), `docs/pro/{check,templates-a,templates-b,direction}.md`.

## Why
The quality check run in real WebKit with real fonts is a better judge of the templates than any Node test. It found a real defect in the original templates, and
the direction numbers show several others fall outside the margins we now ask the model to keep. Templates are what most people use: they should be clean.

## You own
`app/src/motionrecipes-titles.ts`, `motionrecipes-overlays.ts`, `motionrecipes-data.ts`, `motionrecipes-pro-a.ts`, `motionrecipes-pro-b.ts`, their `-meta` files, `motioncharts.ts`
(only for the label defect below), the template tests, `docs/pro/w2-polish.md`, your i18n entries (the merge unions i18n.ts). Do not touch the panel, export or chat.

## Deliver
1. **Run the real-font sweep**: copy `/Volumes/ExtremeSSD/apps/vylo-editor-pro/app/.test-build/check-harness` into your own git-ignored `app/.test-build/` (it has a prebuilt
   off-screen WebKit host; it never touches the owner's app) and run `node run.mjs "mode=sweep&lang=en"`. It covers all 33 templates x 4 shapes x 4 languages with the
   check. Today there are no warnings and these tips: the Badini portrait bar chart cuts a label to "چارەکا سێ…" (`text-overflow`, a real defect); `price-card` has a plan
   label at contrast 3.0; `ui-chat` in Sorani shows a message 0.2 s shorter than it can be read. Fix each in the template (not in the check).
2. **Margins**: the landscape data templates keep words 0.9u inside the side margin, and in portrait `stats` and `donut` put labels where phone apps' buttons cover the bottom of the
   frame. Bring them inside the safe area the check and `motiondirection.ts` (`safeArea`) use, without changing the look more than needed.
3. **The cover frame**: the gallery's thumbnail for the core `lower-third`, `handle` (and any other template with a repeating light sweep) lands mid-sweep and looks like a smudge. Fix it
   in the template or (if it is in the thumbnail's frame choice) in the smallest place that fixes it, saying where.
4. Re-run the sweep until it is clean (zero tips for the shipped templates, or each remaining tip defended in `docs/pro/w2-polish.md`), and look at the worst few templates as pictures.

## Acceptance
- The sweep result before and after, in the document. Every original template still builds with the same ids (rebuilds keep the user's selection) and the same fields. The recipe tests
  and `pro-check.test.mjs` pass. `npm test`, `npx tsc --noEmit`, `npm run build` pass. Commit only your paths; do not push or merge.
