# W2-3 Chat: ask for it in words

Wave 2 of the Pro pass, brief `docs/pro/briefs/w2-3-chat.md`, branch `pro-w2-chat`. Motion's chat can now do what the new
parts do — "add a scene after the title with a push", "give it upbeat music", "use my brand", "tidy it up" — through the
same pure edits the buttons use. The model still writes JSON only, from closed lists, every number held; nothing it writes
is run, and every guard that was there is still there and still tested.

## Files

| File | What changed |
|---|---|
| `app/src/motionchatops.ts` | nine ops (`PRO_OPS`), their readers and steps; `ApplyOptions`; the order an answer runs in; what a rebuild keeps; the figure guard for a race and a price; `chatNoteText` |
| `app/src/motionai.ts` | the ops, the race's label and the finishes in the prompts; the graphic's scenes, sound and kit in the editor's view; `refineMotion`'s `brand` and `check` |
| `app/test/pro-chatops.test.mjs` | new: 139 checks, about 0.7 s |
| `app/test/motionai.test.mjs` | the prompt budget only: base + per template (see below) |
| `app/test/pro-direction.test.mjs` | its two prompt budgets raised by the same 1,300 (a deviation: see below) |
| `app/package.json` | `node test/pro-chatops.test.mjs` before `orphans.test` |
| `app/src/i18n.ts` | 18 keys in `ar`, `ckb`, `kmr` under `// Motion pro: w2-3 chat` |

`motionchatops.test.mjs` is untouched and passes as it was.

## The operations

| op | form (as the model is taught it) | applied through |
|---|---|---|
| `scene.add` | `{"op":"scene.add","at":2,"name":"Offer","transition":"push"}` — an empty 3 s scene after the one playing at `at` seconds (else after the last); also `after`/`scene` naming a scene; `transition` a word or `{kind,d,dir,ease}` | `addScene`, then `renameScene`, `setTransition` |
| `scene.split` | `{"op":"scene.split","at":4.5}` | `splitSceneAt` |
| `scene.remove` | `{"op":"scene.remove","scene":"s2"}` | `removeScene` |
| `scene.move` | `{"op":"scene.move","scene":"s3","to":1}`; also `"to":"first"/"last"`, `before`/`after` a scene | `moveScene` |
| `scene.transition` | `{"op":"scene.transition","scene":2,"kind":"push","d":0.5,"dir":"start"}`; `ease`; or `"transition":{…}`; `"kind":"cut"` removes it | `setTransition` |
| `scene.rename` | `{"op":"scene.rename","scene":"s2","name":"Offer"}`; `""` gives back "Scene n" | `renameScene` |
| `sound.set` | `{"op":"sound.set","mode":"music","mood":"calm","level":0.6}`; any of the three; a mood alone turns music on (off → music, effects → both); `"mood":"auto"` back to the template's | `readSound`, `withSound` |
| `brand.apply` | `{"op":"brand.apply"}` | `applyBrand(doc, kit)` with the kit the **app** passes |
| `check.fix` | `{"op":"check.fix"}` | `autofix(doc, checkMotion(doc))` |

A scene is named by its id, its number from 1 (`2`, `"2"`, `"٢"`, `"Scene 2"`), or its name when exactly one scene has it.
Names models reach for are read as the ops they mean (`add_scene`, `transition`, `music`, `tidy`, `apply_brand` …).

**Closed lists.** Transition kinds are `TRANSITIONS` (and motiontransition.ts's aliases: `crossfade`, `whip-pan` …);
directions `DIRS` (never left or right); curves `TRANSITION_EASES`; modes `SOUND_MODES` and a few words (`effects`,
`mute`); moods `SOUND_MOODS`, motionsound.ts's aliases and a few more (`upbeat` → uplifting, `dramatic` → cinematic,
`relaxed` → calm …). An op with **any** part that is not on its list changes nothing and names the part: "jazz" is not a
mood, and music in some other mood is not what was asked for.

**Numbers.** A number that cannot mean anything in its field is refused, not stretched: a time outside the graphic, a
transition longer than a graphic (> 30 s) or negative, a place outside 1..12, a level outside 0..100, 1e308, NaN. One that
can is held to the edit's limits: a transition to 0.15–1.5 s and to the two scenes beside it, a place past the last to the
last, a level 60 read as 60 %. Scenes stay inside `LIMITS` because every edit goes through `motionscene.ts`'s tidying;
the limits are said back as `scene-limit` (`full`, `short`, `first`).

**The brand kit is the app's.** `applyOps(m, ops, now, said, { brand, check })`: the op itself carries nothing, so a kit,
colours or a logo an answer writes into it are never read (tested). `refineMotion` takes `brand` (default
`currentBrand()`), tells the model only whether one is saved, and passes the same kit to the op. With none: `no-brand`,
nothing changes. A logo comes only from the person's own kit, as their importer wrote it.

**The check** measures with the page canvas in the app (no `ctx` passed, as `check.md` asks); tests pass a recording
canvas. It repairs only what `autofix` proves better and says what it did by the repairs' own labels (`Move it inside`,
`Trim the end` …, existing i18n keys) and how many tips are left.

## The order an answer runs in

`TURN`: 0 the template's ops (fields, palette, seconds, format, lang, title, recipe); 1 `brand.apply`, which rebuilds the
template with the brand, so after its words; 2 `sound.set`; 3 hand edits and scene ops, in the order written ("add a
scene, then a title timed into it" works); 4 `check.fix`, which repairs what everything else made.

**What a rebuild keeps.** `rebuilt` (the `recipe` op) now keeps the sound always, and the scenes and the brand's look
(`lookOf`, request 06 #2) when it is the same template; another template is another layout and starts as one scene.
`carried` puts back sound and scenes that a template op dropped while keeping the length — `motionedit.ts`'s `rebuild`
drops them today (requests 04/05). When W2-1's fix lands it does nothing; a change of length is left to `motionedit.ts`.

## No figure the person did not give

Exactly the old rule, extended:

- **A race's line** (`bar-race` items): every value on it, read as the template reads it (`racerOf`, a copy of the private
  reader in `motionrecipes-pro-b.ts`: `12,18,25` is three values, `1e3` is a thousand). A line with any value nobody gave
  keeps the line it had (or its values under a new name), else takes round placeholders and says `sample`.
- **A race's earlier values in a chart layer's labels** (`Rome|12 18 25`, `raceSeries`), for **every** chart kind, so a
  number cannot be planted in a bar chart's label and shown by switching it to a race. Unknown values take the old datum's,
  or placeholders; the label is rewritten within `LIMITS.label`, the name giving way, never a number.
- **A price card's price**: the number it counts up to (`numberOf` before the slash) and any other digits in the field
  (`/3 months`, `from 19`), held as a number field is.

Both readers are held to the templates by building them: 16 race lines and 9 prices, each accepted with exactly the numbers
the built graphic draws, and refused when any one of them is missing.

## The prompts

Taught from the tables: the nine op lines, when to reach for them ("Music or effects", "My brand", "Tidy it up"), how
scenes are named and that the transition is a scene's exit; in both prompts a race datum `{"label":"Rome|12 18 25",
"value":31}` and that `grain vignette lightleak scanlines halftone` are finishes, last, over everything.

| characters | before | after | change |
|---|---|---|---|
| plan prompt without the template list | 6,131 | 6,330 | +199 |
| edit prompt without the template list | 7,303 | 8,559 | +1,256 (about 300 tokens a request) |
| plan prompt, whole (33 templates) | 17,687 | 17,886 | +199 |
| edit prompt, whole | 18,859 | 20,115 | +1,256 |
| editor's request for a plain graphic | | about +125 (scenes, sound, kit lines) | |

`motionai.test.mjs` now holds each prompt to base + per template: the base ≤ before + 1,300, each template's line ≤ 600
characters, the whole ≤ both. `pro-direction.test.mjs` holds the same base numbers.

## Tests

`pro-chatops.test.mjs`, 139 checks: the catalogue and every op's own example applied; each op valid, at its limits, and
refused part by part; the order; the race and price guards against the built templates; the prompts and the editor's view
(fenced scene names, kit contents never shown); three answers through `refineMotion` with a fake model; `chatNoteText` for
every new note (through `t`, isolated, no override survives); 462 garbage values in every part of every op (wrong types,
1e308, unknown words, `__proto__`, Proxies, revoked Proxies, objects and arrays 100,000 deep) — no throw, nothing changed;
whole answers that are such things; a reply nested 100,000 deep; 300 random answers (no throw, fixed points, scenes within
`LIMITS`, sound on its lists, no picture, inputs unchanged).

Whole chain: `npm test` passes (14,947 checks, 157 suites, 0 failures, about 76 s on this machine); `npx tsc --noEmit` and
`npm run build` pass.

## Deviations

1. **`PRO_OPS` beside `OPS`**, not inside it: `motionchatops.test.mjs` pins `OPS` at eleven, and the brief says the
   existing tests pass untouched. `ALL_OPS` is both; the prompt and the reader use it.
2. **`pro-direction.test.mjs` edited** (not in my list): its "without the template list" budgets (6,300 / 7,450) left
   169 and 147 characters, so no new op could be taught. Raised to before + 1,300, with the reason, the same numbers as
   `motionai.test.mjs`. Nothing else in it changed.
3. `scene.add`'s `at` is seconds, as `addScene`'s is and as `scene.split`'s; a scene is named with `after` (or `at` set to
   an id). `scene.add` also takes `transition` (the brief's own example: "with a push").
4. Numbers outside what their field can mean are refused rather than clamped (see above) — the brief asks both that every
   number be clamped and that huge numbers change nothing; this keeps both.
5. **The notes' words live in `motionchatops.ts`** (`chatNoteText`), since `motionstate.ts` (W2-1's) says the others;
   wiring it is one line (below). Its own isolate rule repeats `motionstate.ts`'s `quoted` (an import would be a cycle).
6. The Kurdish strings for review are listed here, not in `review-needed.md`, which is not in my list.

## Open problems and what was not verified

- **No real model.** Every answer is the test's. Whether a model writes these ops well — names scenes by id, maps
  "upbeat" to `uplifting`, computes `at` — is untested; the readers forgive the common slips.
- **Until `noteText` delegates, the new notes show as "Skipped a change that could not be read"** in the chat (request 1).
- `check.fix` in the same answer as `scene.add`: the new scene is empty, and the check's repair for an empty end is to
  trim it, which undoes the scene. True to the check; the prompt does not warn.
- `brand.apply` needs `loadBrand()` to have run (W2-1 calls it when the panel opens); before that the kit reads as none.
- `carried` covers a gap W2-1 is closing in `motionedit.ts`; the brand's face and logo still go through `rebuild` on a
  `fields` edit until then.
- A plan (`parsePlan`) still cannot ask for scenes or sound; only the editor can.
- The check in Node measures with stand-in widths; in the app it uses the page's canvas, not exercised here.

## For the integrator

1. `motionstate.ts`, `noteText`'s `default:` — `return chatNoteText(n, t) ?? t('Skipped a change that could not be read');`
   (import `chatNoteText` from `./motionchatops`; it returns null for every note it does not own).
2. `refineMotion` needs nothing from the panel: it reads the session's kit itself. Pass `brand` only to override.
3. When W2-1's `rebuild` keeps sound, scenes and look, `carried` becomes a no-op; it can stay.
4. A native speaker should read the `ckb` and `kmr` values of the 18 keys under `// Motion pro: w2-3 chat` in `i18n.ts`
   (append them to `review-needed.md`): Added a scene: {name} · Cut the scene in two at {s} s · Joined {name} with the
   scene beside it · Moved {name} to place {n} · {name} now arrives with: {kind} · Scene {n} is now called {name} ·
   Scene {n} has no name of its own now · Sound off · Sound: {how} · Applied the brand kit: {name} · Applied the brand
   kit · Tidied: {fixes}. {n} tips are left for a change by hand · Tidied: {fixes} · Skipped: there is no scene
   “{scene}” · Skipped: the first scene starts the graphic, so it arrives from nothing · No brand kit is saved yet: set
   one up with the Brand kit button · The quality check found nothing to fix · The quality check found {n} tips, and none
   it can fix by itself.
