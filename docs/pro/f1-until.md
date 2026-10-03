# F1: a template owns a span, not the whole graphic

Wave-3 fix package F1 of the Pro pass (`docs/PRO.md`, brief `docs/pro/briefs/f1-until.md`, the finding
`docs/pro/requests/R3.md` §1), branch `pro-f1-until`. Built, tested and committed; nothing to mount, no new string.

## What a person sees now

Home, Big title, "+ Scene": the graphic grows by a three-second scene, as before, and Design's *Words on screen* still
holds the template's three fields. Typing a new title changes the title in the first scene; the second scene keeps its
time, its transition and everything in it, and the background that ran on through it still does. A text added to the
second scene (Layers' Add with the playhead there, or the chat) is the person's: new words, a new shape or language,
a longer or shorter graphic, a brand kit from the chat — none of them touch it, and the template stays a template.

## The design: R3's, completed

`RecipeRef` gains `until?: number`, the second where the template's part of the graphic ends. Absent is the whole
graphic, which is what every stored graphic means, so they all read and rebuild exactly as before. The R3 proposal is
implemented as written; three things it left open had to be decided, and each is the smallest rule that keeps a
rebuild honest:

1. **Which layers are the template's.** R3 said "keep every layer whose id the fresh build does not make". That keeps
   too much: a template makes some layers only for some words (the fourth bar of a chart with four items), so after
   the words shrink the old layer would survive as a stale copy. The rule used is **by time**: a layer that starts
   before `until` is the template's and is replaced by the fresh build; a layer that starts at `until` or later is the
   person's and is kept — unless the fresh build makes a layer with its id, in which case it is the template's (a
   template layer is never there twice).
2. **A template layer that runs on past the span.** "+ Scene" at the end carries a background that ran to the end on
   through the new scene (motionscene.ts). A fresh build ends it at `until`, which would leave the new scene without
   its background. So a fresh layer that reaches `until`, whose old self ran past it, runs on as far again.
   Its look is the template's: a backdrop's pattern is seeded from the words (motionrecipe.ts `makeKit`), so new words
   reshuffle it in both scenes alike, as they always did in one — the cut shows no seam. ("The second scene's layers
   are unchanged" is therefore tested as: the same layers for the same time, the person's byte for byte, the
   background the template's own run on.)
3. **Layers the person adds after the span.** For the second scene to be worth having, putting something in it must
   not end the template one click after "+ Scene" stopped doing so. A change by hand keeps the link when it leaves the
   template's part exactly as it was (`byHand`); it still ends it when it touches a template layer or brings a layer
   into the template's time.

Where a person's layer sits in the stack survives a rebuild: it goes back just above the template layer that was
below it (at the very bottom when none was).

## The rules, edit by edit

| edit | template that owns the whole graphic (no `until`) | template that owns a span |
|---|---|---|
| `addScene` | at the end: kept, `until` = the old end; inside: ends (as before) | cut at or after `until`: kept; inside: ends |
| `splitSceneAt`, `setTransition`, `renameScene`, `removeScene` | kept (as before) | kept, `until` unchanged |
| `moveScene` | ends (as before) | kept when every scene starting before `until` stays put (a move among the person's scenes); else ends |
| `setFields`, `setLang`, `setFormat`, chat `fields` / `format` / `lang` / `recipe` (same template) | rebuilt whole (unchanged, byte for byte) | template built for `until` s and put back (`onTemplatePart`); length, scenes, sound, brand look, person's layers kept |
| chat `recipe` (another template) | whole graphic, one scene (as before) | the same: starting again replaces everything |
| chat `brand.apply` | as before | applied to the template's part through `onTemplatePart` |
| `setPalette`, `setTitle`, `setFps`, `setBackdrop` | kept (as before) | kept |
| `setSeconds` | rebuilt for the new length (as before) | past `until`: the person's part changes as a hand-edited graphic's does, the template's part untouched, `until` kept. At or before `until`: with nothing of the person's after it, the template is rebuilt whole for the new length and `until` goes; with something, there is no honest rebuild and the link is dropped (every layer kept) |
| `setLayer`, `addLayer`, `removeLayer`, `duplicateLayer`, `moveLayer`, chat `layer` / `add` / `remove` | ends (as before) | kept when the template's part (the layers starting before `until`) is exactly as it was and the length the same (`byHand`); else ends |
| `placeAdded` (Layers' Add) | as before | the whole-graphic layer `addLayer` made cost the link; put into one of the person's scenes, the link comes back |
| chat `speed` | ends (as before) | ends (it retimes every layer) |

`readMotion` keeps `until` when it is a number (or a plain decimal string) below the graphic's length, to the
millisecond, at least `LIMITS.minSeconds`; a value at or past the end, or not a number, is the whole graphic. The link
keeps its keys in the order `id, fields, until`, so every edit's result is a fixed point of the reader.

## API (motionedit.ts)

- `onTemplatePart(m, edit)`: apply an edit that builds the template again to the template's part of `m` and put the
  result back. Without `until` it is just `edit(m)`. Used by `rebuild`, the chat's `rebuilt` and its `brand.apply`;
  meant for `applyBrand` too (requests/F1.md).
- `byHand(before, after)`: the link after a change by hand — `detach(after)` unless the template owns a span and its
  part is untouched.

## Tests

`test/pro-until.test.mjs`, 81 checks, wired before `orphans.test`:

- every one of the 33 templates in every shape reads as a fixed point with no `until`; a template without a span
  rebuilds exactly as the old rule (written out in the test) for 326 rebuilds over every template, with and without
  scenes;
- the reader's table of spans, and 2,000 random spans and lengths;
- the shortest path, through `setFields`, the chat's `fields` and its `recipe` for the same template; Design's form
  rendered (react-dom/server) after "+ Scene";
- every scene edit and every layer edit against the span; the stack order and the run-on background through four
  kinds of rebuild; the brand kit through `onTemplatePart` and through the chat; the length; the chat's language
  check counting the person's own words;
- the fuzz: 132 runs over all 33 templates, 2,112 random edits (addScene, splitSceneAt, setFields, setSeconds — half
  of them aimed around `until` — setFormat, setLang, addLayer at the playhead, placeAdded, setLayer on the person's
  or a template's layer, removeLayer, moveScene, removeScene, setTransition, the chat's `fields` and `recipe`,
  brand.apply, undo-shaped re-reads of an earlier graphic through JSON and `readMotion`). After every step: the reader's
  fixed point, valid scenes, every layer inside the graphic, ids unique, the span in range, no layer of the person's
  lost, and **a rebuild with nothing changed changes no layer** (so no template layer is ever there twice and none is
  missing). About a third of the steps run on a template that owns a span.
- mutation check (by hand, not in the suite): dropping the person's layers in `rejoin`, not running the background
  on, or never detaching in `byHand` each fails both the direct tests and the fuzz.

Changed tests (the old assertions described the bug): `pro-scenes` ("+ Scene" on Big title is now still the template,
with `until` 6; added: a second "+ Scene" keeps it, one inside the template's time ends it); `pro-chatops` (`scene.add`
at the end no longer says `detached`; added: inside the template's time it still does).

Also checked once, outside the suite: the old code (`git show HEAD`) and the new, built side by side, over 3,649 random
edits on graphics that never get a span (including the chat's ops and brand.apply) — byte-identical results in every
one; the only divergence is "+ Scene" at the end, the intended change.

`npm test` (whole chain), `npx tsc --noEmit`, `npm run build` pass.

## Open problems

- **`applyBrand` from the Brand kit sheet** (`MotionBrandKit.tsx` → `motionbrand.ts`, not this package's files)
  still builds the template over the whole graphic: on a graphic whose template owns a span, "Apply to this graphic"
  would lay the template over the person's scenes and drop their layers. The chat's `brand.apply` is already routed
  through `onTemplatePart`. A one-line fix in `applyBrand` is in `docs/pro/requests/F1.md`.
- A rebuild that would pass `LIMITS.layers` (the template's layers plus the person's) changes nothing rather than
  drop a layer. Only reachable near 60 layers.
- The model is not told that a template's words cover only its span (motionai.ts says "Change its words with
  fields", still true). Not needed for correctness.
- `docs/pro/scenes.md`'s table says `addScene` and `moveScene` drop the link; see requests/F1.md.
- Not verified in the app's own engine or by hand in the studio: the change is in pure edit functions, checked in Node;
  the Design form was checked by rendering it to markup, not by clicking.
