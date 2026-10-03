# 06 Gallery and brand kit

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Catalogue and search", the theme contract) first.

## Why
Templates are Motion's front door, and there will soon be many more. A person needs to find the right one by typing a few words, and a business needs
its graphics to look like *its* graphics every time without re-picking colours. Both should make the first screen simpler, not busier.

## You own
`app/src/motionbrand.ts`, `motionsearch.ts`, `app/src/MotionBrandKit.tsx`, `MotionHome.tsx`, `motionrecipe.ts`, `motiontemplates.ts`, `motionstore.ts`,
`app/test/pro-gallery.test.mjs` (and extend the existing recipe tests if you change what they check), `docs/pro/gallery.md`, `docs/pro/credits/06.md`,
CSS `/* pro:06 */`, your i18n entries. Packages 07 and 08 write their own templates' metadata in their own files; you do the original eighteen.

## Deliver
1. **Template metadata for the 18 original templates**: fill the new optional `RecipeMeta` fields (`tags`, `useWhen`, `avoidWhen`, `pairsWith`) in
   `CORE_META`. English words a person might actually type ("name tag", "subscribe", "sale", "countdown"). Keep each `useWhen`/`avoidWhen` one sentence;
   these also go into the model's prompt (package 10 reads them), so write them for a model too. They need `t()` entries only if the UI shows them.
2. **`motionsearch.ts`**: offline word-matching scorer (RESEARCH.md): lower-case, strip punctuation, simple plural folding, rarer words count more, name and
   tag hits count 3x, long descriptions scaled down; Arabic-script text normalised (strip tashkeel and tatweel, unify alef forms) so Arabic search works too.
   `searchRecipes(query, lang): RecipeId[]` ranked, empty query returns everything in gallery order. Pure.
3. **Gallery (`MotionHome.tsx`)**: a search box at the top and the existing groups as chips; results update as you type; a "Recent" row if there is
   history (`motionstore.ts`). Make the page **simpler than today**: fewer headings, the same thumbnails. Keep every current capability.
4. **Brand kit** (`motionbrand.ts`): `BrandKit { name, handle, url, logo? (data URL, the same limit as a picture layer), palette (five tones) or paletteId,
   voice (display font voice) }`. `readBrand(x)` clamps everything; persistence in `motionstore.ts` (follow how it stores things; fall back to nothing,
   never throw if storage is unavailable). `kitOptionsWithBrand`: when a kit is set, new graphics start in its palette and fonts, and templates that take a
   name/handle/logo fill them (extend `makeKit`/`buildMotion` minimally; the original eighteen build identically when no brand is set, test it).
   `applyBrand(doc, brand): Motion` re-skins an existing graphic (palette, voice, and fields that match), through `motionedit.ts` functions.
5. **`MotionBrandKit.tsx`**: one button "Brand" (Home and Design will mount it; props `{ onApplied?(): void; doc?: Motion; onChange?(next: Motion): void }`)
   opening a small sheet: name, handle, logo (use the existing picture importer in `motionpicture.ts`), five colour swatches, a font voice, a live preview
   swatch, Save and Clear. One screen, no tabs. Classes prefixed `mb-`.

## Acceptance
- Search ranking tests (English and Arabic), stability, empty/garbage queries; metadata present and well-formed for all 18; brand reader fuzz; identity
  without a brand (the 18 templates build byte-identically); `applyBrand` idempotent.
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
