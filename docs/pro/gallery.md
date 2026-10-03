# 06 Gallery and brand kit

Work package 06 of the Pro pass (`docs/PRO.md`, brief `docs/pro/briefs/06-gallery.md`). Branch `pro-06-gallery`.

Two things, both meant to make the first screen simpler rather than busier: a **search** that finds a template from a
few words in any of the four languages, and a **brand kit** that makes a business's graphics start in its colours,
face, name and logo without anyone picking them again.

## What exists

| File | What it is |
|---|---|
| `app/src/motionsearch.ts` | Offline word-matching search over the templates; folding for Arabic script; the gallery's order; the recent list |
| `app/src/motionbrand.ts` | `BrandKit`, its reader, what a kit fills in a new graphic, and Apply brand |
| `app/src/MotionBrandKit.tsx` | The "Brand kit" button and its one-screen sheet |
| `app/src/MotionHome.tsx` | The gallery: search box, chips, the kit's button, a recent line; no heading |
| `app/src/motionrecipe.ts` | `tags`, `useWhen`, `avoidWhen`, `pairsWith` for the original eighteen; `Field.brand`; `RecipeMeta.logo` |
| `app/src/motiontemplates.ts` | `BuildOptions.look`, `Look`, `DISPLAY_VOICE`, `logoOk`, `lookOf` |
| `app/src/motionstore.ts` | `loadBrand`, `saveBrand`, `currentBrand`, `onBrand` (database `vylo-motion-brand`) |
| `app/test/pro-gallery.test.mjs` | 90 checks, about 1.2 s |
| `app/src/i18n.ts`, `app/src/styles.css` | 18 new strings in ar/ckb/kmr (`// Motion pro: 06 …`); CSS between `/* pro:06 start */` and `/* pro:06 end */` |

## The API

```ts
// motionsearch.ts
searchRecipes(query: string, lang: Lang): RecipeId[]   // best first; '' (or only punctuation / dropped words) = everything in gallery order; nonsense = []
foldSearch(text: string): string                      // how text is compared (exported for tests and anyone matching the same way)
searchWords(text: string): string[]                   // the words a text is searched by
recentRecipes(motions, most = 4): RecipeId[]          // templates of the newest graphics, each once
GALLERY_ORDER: readonly RecipeId[]                    // by group, then META order (was MotionHome's private ORDER)
GROUP_NAMES: Record<RecipeGroup, string>              // English group names = i18n keys (chips and search share them)

// motionbrand.ts
interface BrandKit { name; handle; url; logo?; paletteId: PaletteId | null; palette: Palette | null; voice: Voice }
readBrand(x: unknown): BrandKit | null                // clamps everything, never throws, fixed point; empty kit = null
kitOptionsWithBrand(o: BuildOptions, brand): BuildOptions   // the options for a NEW graphic with the kit put in (null kit: the very object)
applyBrand(doc: Motion, brand, now?): Motion          // re-skin an existing graphic; idempotent (second call returns the very object)
brandFields(recipe, brand), brandLook(brand), initialsOf(name), BRAND_LIMITS

// motiontemplates.ts
BuildOptions.look?: Look | null                       // { voice?: Voice; logo?: string } — absent/null: exactly the recipe's layers
lookOf(m: Motion): Look | null                        // read the look back from a template graphic, for rebuilds
DISPLAY_VOICE = 'bold'; logoOk(x): x is string

// motionstore.ts
loadBrand(): Promise<BrandKit | null>; saveBrand(b: BrandKit | null): Promise<boolean>
currentBrand(): BrandKit | null; onBrand(fn): () => void

// MotionBrandKit.tsx
<MotionBrandKit t={t} doc?={doc} onChange?={(next) => …} onApplied?={() => …} />
```

## The search

What is typed and what each template says are folded the same way and split into words:

- **Folding** (`foldSearch`): NFKD, then Latin accents, Arabic vowel marks, Quranic marks and the superscript alef
  removed (after decomposition the hamza and madda are marks too, so أ إ آ are already ا); tatweel and invisible
  joiners and direction marks removed; lower case; alef wasla to alef, alef maqsura and Persian/Kurdish yeh to Arabic
  yeh, keheh to kaf, teh marbuta and the Sorani heh (ھ) to heh; Eastern Arabic and Persian digits to 0-9.
- **Words** (`searchWords`): split on anything not a letter or digit, words under two characters and stop words
  ("a", "the", "template", "video", "في", "من", "لە", "بۆ", "ل", …) dropped; an Arabic-script word of four letters or
  more loses a leading article ال; a Latin word folds its plural (charts → chart, stories → story, boxes → box; press,
  status and axis keep their s). Not a stemmer: counter stays counter.
- **Index** per language: the name and tags (English) and the name in the interface's language and a few words of the
  language (`LOCAL_WORDS`) are the *strong* words; the description (both languages), `useWhen`, the group name (both)
  and the field labels (both) are the rest. English is in every language's index: people type "logo" in Arabic.
- **Score**: for each word searched, its rarity `ln((N+1)/(df+1)) + 1` (N templates, df that have it) times 3 for a
  strong word, 1 for any other, half that when it only *begins* one of the template's words (so results follow
  typing: "subs" finds subscribe); the sum divided by the square root of how many words the template has. Score 0 is
  left out; ties keep the gallery's order; at most 12 words of a search and 400 characters are read.

`avoidWhen` is deliberately **not** indexed: "avoid when the values are a trend" must not make a template match "trend".

What the tests hold it to: 19 English, 13 Arabic and 6 Sorani/Badini searches put the obvious template first (name tag
→ lower third, sale → kinetic, شعار/الشعار → logo reveal, اشترا → subscribe, لۆگۆ → logo reveal, پێنگاڤ → steps …);
every original template is the first result for its own name in all four languages; marks, tatweel, hamza and the
Kurdish keyboard's yeh/kaf change nothing; case, spacing, punctuation and word order change nothing; 2,000 random
mixed-script searches are deterministic and return each template at most once; null, numbers, 100,000 characters,
bidi overrides, emoji and a lone surrogate do not throw; a search takes tens of microseconds.

## Metadata for the original eighteen

Each has 8 to 10 lower-case `tags` (the words people type: "name tag", "subscribe", "sale", "countdown", "youtube",
"kpi" …), a one-sentence `useWhen` and `avoidWhen` written to be decided on by the model (package 10 puts them in
the prompt; each `avoidWhen` names the template to use instead), and two or three `pairsWith`. The test checks every
one is present, short, one sentence, and that the pairs are real ids. None is shown on screen, so none is an i18n key.

Two new optional metadata fields, for the eighteen and for packages 07/08 to opt into later:

- `Field.brand?: 'name' | 'handle' | 'url' | 'initials'`: the field means the brand. Set on the logo reveal's `name`
  and `mark` (badge letters → initials) and the handle template's `handle`. A lower third's `name` is a *person's*
  and is never filled from a kit. No original template has a web-address field; `url` is there for new ones.
- `RecipeMeta.logo?: { layer, drop? }`: where a logo goes. Only the logo reveal has one: the logo takes the badge's
  place in the stack, its box, timing, entrance, exit and shadow, fitted whole with square corners, so a transparent
  logo casts its own shadow (the logo-shadow fix in `motiondraw.ts`); the badge's sheen, letters and shine layers are
  left out. Rendered in WKWebView: it reads as a real logo sting.

## The brand kit

A kit is a name, an account, a web address, a logo (a picture through the existing importer, `readPicture`, same
limit as a picture layer), colours and a headline face. **Every part is optional** and leaving a part out leaves the
template its own: no colours (the sheet's "Each template's own") keeps each template in the palette it was designed
in; the house display face (`bold`, shown as "Heavy") keeps every template's own faces. A kit with nothing in it is no
kit, so Clear and an emptied form are the same.

- **The reader** (`readBrand`): name one line ≤ 60 characters; handle without @ or spaces ≤ 30; address without any
  scheme (every one, so the reader is a fixed point), spaces or trailing slash, ≤ 80; logo a `data:image/png|jpeg;base64,`
  URL ≤ `LIMITS.image` or nothing (the same rule as `motionread.ts`'s picture source; never an address, never SVG);
  `paletteId` one of the nine, else five colours each repaired from the first palette, or null when not one reads;
  five colours that are a preset become that preset; the voice from `VOICES` else `bold`. Own properties only; a
  Proxy that throws from every trap is no kit. Fuzzed with 3,000 random records.
- **New graphics** (`kitOptionsWithBrand`): the kit's palette when the caller chose none (a palette the person picked
  wins); the brand's words in the fields that mean the brand when not given (words a person or the model wrote win;
  the badge's initials come from the brand only when the name did); and a `look` with the face and the logo.
- **The face** replaces only the house display face (`DISPLAY_VOICE`, `bold`): every recipe sets its headline, a
  badge's letters and a countdown's numbers in it and body, labels and figures in `sans`. Templates whose look *is* a
  typeface keep it (kinetic's condensed, the quote's serif, subscribe's rounded). Every `bold` layer is `fit`, so a
  wider face shrinks to the room the recipe measured instead of running out of it. The test checks, layer by layer
  in all 18 × 4 languages × 4 shapes, that exactly the `bold` layers changed.
- **Apply brand** (`applyBrand`): a template graphic is built again once with its own words but the brand's in the
  brand fields, the kit's palette and look, and keeps everything else it carries (title, frame, rate, sound, scenes —
  it spreads the graphic rather than listing what to keep). A graphic edited by hand goes through `motionedit.ts`:
  `setPalette`, and `setLayer` on every `bold` layer. Idempotent: the second call returns the very object.
- **Keeping it** (`motionstore.ts`): IndexedDB database `vylo-motion-brand`, store `kit`, one record. *Not* a second
  store in `vylo-motion`, because that would mean opening it at version 2, and an older build (the release the owner
  goes back to) would then fail to open `vylo-motion` at version 1 and show no graphics. The session keeps the kit in
  memory (`currentBrand`), every button showing it hears of a save (`onBrand`), storage refusal still lasts the
  session and `saveBrand` returns `false`, and a load that started before a save does not undo it.

## The Home page, before and after

Before: banner; **"Templates 18"** heading; a paragraph; chips; the grid; "Your graphics" heading; covers.

After: banner; **one bar** — the search box ("Search 18 templates") at the start, the kit's button at the end, the
same chips under them; a "Recently used" line of up to four templates (only once there is history, hidden while
searching); the grid; "Your graphics"; covers. The paragraph shows only until the person has a graphic of their own.

So: one heading fewer, the paragraph gone for anyone who has used Motion, the same thumbnails built the same way, and
every capability kept (chips with counts, hover/focus playing, lazy building, broken templates leaving no card, the
banner's "See the templates" scrolling to the bar and focusing the first card). The shortest path is unchanged: Home,
pick a template, change the words, Export. With no kit set the kit is one quiet button.

Keyboard: Escape empties the box (and the studio's own Escape then works as before); the down arrow, or Enter while
searching, goes to the first card; the clear buttons put the focus back in the box. The chips' group keeps its
accessible name. A polite status line says how many templates the search found. The sheet is a `role="dialog"`,
Escape closes it and returns focus to the button, a press outside closes it (not the confirmation Clear asks), it
hangs from the button's other edge when it would leave the window and opens upward when there is no room below.

The **"Brand kit"** label is a deviation from the brief's "Brand": the gallery already has a chip called "Brand" (the
logo reveal, countdown and intro group), and two "Brand" controls side by side read as one.

## Proof that the eighteen build exactly as before

1. During development, the base commit's builder (`c921d23`, bundled before any change) and this branch's were run
   side by side: **9,216 builds** (18 templates × 4 languages × 4 shapes × 4 sets of fields × 4 lengths × 2 palettes)
   compared as JSON, through `buildMotion(o)`, `buildMotion(kitOptionsWithBrand(o, null))` and
   `buildMotion({ ...o, look: null })`. **0 differ.**
2. In the test: the sha256 of the JSON of every original template in every language and shape is pinned to the value
   the base commit gives (`e658d75f…`), and 576 builds check that no kit, an empty kit, no look, an empty look and the
   house face all give the plain build and the very options object.

If a recipe is changed on purpose later, the pinned digest moves; the test says how to update it.

## Seen in the app's engine

A throwaway harness in `app/.test-build/motion-harness/` (git-ignored): a WKWebView host with a non-persistent data
store and the real `styles.css`, `MotionHome`, `MotionBrandKit` and renderer, in English (light) and Arabic, Sorani and
Badini (dark/light), at 1440 and 980 pixels. Seen: the bar in both directions; the chips wrap under the box in long
languages; the recent line; the no-match state; the sheet at Home and as Design would mount it (flipped to fit); the
brand's serif in the preview; and a branded logo reveal and big title painted by `paint()` frame by frame. Two layout
problems were found and fixed this way (the kit's button wrapping to a line of its own; the chips squeezed into three
lines in Kurdish at 980 px). Not done: the real app (`tauri dev` shares the owner's data), VoiceOver.

## Deviations

- The button says "Brand kit" (above). `BrandKitProps` also takes `t`, which every component here needs.
- `kitOptionsWithBrand` returns `BuildOptions` (what `buildMotion` takes), not `KitOptions`: the recipes' kit
  (`makeKit`) is untouched, and the only builder change is the optional `look`, applied after the recipe builds.
- "Recent" is derived from the graphics `motionstore.ts` already keeps (`recentRecipes(motions)`), not a new record:
  it covers templates the model picked too, and needs no storage of its own.
- The kit's colours are optional, and the gallery's cards stay in each template's own palette (a gallery of eighteen
  cards in one palette is harder to tell apart; the button shows the kit's colours).
- The old explanatory paragraph is kept as a first-run hint rather than deleted (it also keeps its translations in use).

## Open problems

- **A rebuild loses the face and the logo until wave 2 wires `lookOf`** (see `docs/pro/requests/06.md`): changing a
  branded template graphic's words, shape, language or length goes through `motionedit.ts`'s private `rebuild`,
  which does not pass `look`. Palette and words survive (they are in the document); the face reverts to the
  template's and the logo to the badge. One line in `rebuild`, one in `motionchatops.ts` `rebuilt`.
- New graphics start in the brand only once `MotionPanel.tsx` builds through `kitOptionsWithBrand` (integration).
- `motionedit.ts`'s `rebuild` keeps a fixed list of fields, so it drops `sound` and `scenes` on any rebuild (not this
  package's file; reported for 04/05).
- A graphic edited by hand takes a kit's face on its `bold` layers once; re-branding it with a third face finds no
  `bold` layer left. Template graphics re-brand any number of times.
- The Sorani and Badini strings and search words are best effort (`docs/pro/review-needed.md`).
- The contrast hint checks text on the background only, not the accents (package 01's check covers graphics).
- "number" ranks Three numbers just above Big number (both are named "number"; the shorter entry wins).
