# W2-3 Chat: ask for it in words

Read `docs/PRO.md` ("Words work as well as buttons"), then `motionchatops.ts`, `motionai.ts`, and `docs/pro/{scenes,sound,gallery,check,direction,templates-b}.md`
and `docs/pro/requests/{05,06,08}.md`.

## Why
Motion's chat is its main way to change a graphic. It must be able to do what the new parts do: "add a scene after the title with a push", "give it upbeat music", "use
my brand", "tidy it up". It must stay safe: JSON only, every word from a closed list, every number clamped.

## You own
`app/src/motionchatops.ts`, `motionai.ts`, `app/test/motionchatops.test.mjs`/`motionai.test.mjs` (extend; never weaken), a new `app/test/pro-chatops.test.mjs` (wire into
`package.json`'s chain before `orphans.test` yourself), `docs/pro/w2-chat.md`, your i18n entries if any. Do not touch the panel, export, or templates.

## Deliver
1. **New operations**, each read by a reader that clamps and refuses anything off the list, and applied through the pure functions that exist: `scene.add {at, name?}`,
   `scene.split {at}`, `scene.remove {scene}`, `scene.move {scene, to}`, `scene.transition {scene, kind, d?, dir?}`, `scene.rename {scene, name}` (`motionscene.ts`);
   `sound.set {mode, mood?, level?}` (`motionsound.ts`, moods from the closed list); `brand.apply` (the saved brand kit, `applyBrand`; if none is saved, say so in the
   reply, change nothing); `check.fix` (`autofix(doc, checkMotion(doc))`, reply says what changed). The model may name a scene by its id or its position.
2. **The prompts** (`OP_GUIDE`, vocabulary): the new operations and the new backdrop kinds and the race chart *including its label format* (`Rome|12 18 25`, earlier values
   in the label, `value` the last); terse, in the existing style. The base prompt (without the template list) may grow by at most 1,300 characters, and the test budget
   says so: adjust `motionai.test.mjs`'s allowance to base + per-template, with the reason written in the test.
3. **No figure the model made up**: extend `sourcedFields`/`numbersIn` so a race chart's earlier values and a price card's price count as figures that must come from
   the person (they are not read today), with tests; keep the existing guarantee exactly.
4. **Keep every guard**: JSON only, no pictures, the person's words as delimited data, the fence-closing tests. A reply that asks for something the vocabulary does not
   have is repaired to nothing, never trusted.

## Acceptance
- Each operation: a valid example applies and `readMotion` accepts the result; hostile and garbage variants (wrong types, huge numbers, unknown kinds, `__proto__`,
  100,000-deep objects) never throw and change nothing; scene operations respect `LIMITS`. The existing chat/AI tests pass untouched. `npm test`, `npx tsc --noEmit`,
  `npm run build` pass. Commit only your paths; do not push or merge.
