# Review R1: safety, readers and the promises

Wave 3 of the Pro pass (docs/PRO.md), branch `pro-r-safety`, 2026-10-03. The job was to break the new input
surfaces and the product's promises, then repair what broke. The regressions are
`app/test/pro-review-safety.test.mjs` (in the chain before `orphans.test`); what needs a file this review may not
edit is `docs/pro/requests/R1.md`.

## What was attacked

1. **Every reader of outside data.** `readMotion` (whole, and each new field: `sound`, `scenes`, layers, a recipe's
   fields, a stroke's dash, a shadow), `readLayer`, `readSound`, `readScenes`, `readTransition`, `readBrand`,
   `applyBrand`, `applyOps` (the list, one op, every field of every new op — `scene.*`, `sound.set`, `brand.apply`,
   `check.fix` — the message, the options, the clock), `searchRecipes` / `foldSearch` / `searchWords`,
   `recentRecipes`, `readPrefs`, `settingsFor` (choices and destination), `checkMotion`, `autofix` (findings and
   ids), `journalOf` (the unsaved graphic in localStorage), the audio library's `readAutomation`, `readLane`,
   `readFx`, `readChain`, `readDuck`, and the new `RecipeMeta` fields as data. Each was handed 38 hostile values:
   `undefined`, `null`, `true`, `0`, `-0`, `NaN`, `±Infinity`, `±1e308`, `5e-324`, words, `''`, ten megabytes of
   text, a right-to-left override and a lone surrogate, a Symbol, a BigInt, a function, an object with no primitive,
   Proxies whose every trap throws (object, list, list whose `get` throws), revoked Proxies (object and list),
   objects and lists nested 100,000 deep, cycles, throwing getters, `__proto__` / `constructor` / `toString` keys
   from `JSON.parse`, inherited fields, a list of a million, a sparse list of 2^32-1, forty holes, an invalid Date, a
   Map and a prototype-less object. 1,292 calls, run in a worker the test watches from outside, so a hang is a
   failure that names the call in flight rather than a stuck `npm test`. Then 3,000 random structured values
   through six readers and about 3,300 random documents, for fixed points, finite numbers, no `-0`, and `LIMITS`.
2. **The promises.** Motion's whole run-time import closure (static and dynamic imports, 108 files) for anything
   that can reach the network, every Tauri command and plugin in it, what can write a file and from where, the
   localStorage keys and IndexedDB names against SAFETY in all four languages, and the export command's accepted
   types, marks and byte ceilings (`video.rs`) against SAFETY in all four. Then every template in every language
   built, branded with a logo, painted, checked, given sound and music, edited by every new op and saved as a GIF,
   with `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, `FontFace(url())` trapped and every
   `Image.src` recorded.
3. **Resource ceilings.** The heaviest documents `LIMITS` allows, painted in the app's own engine (a small
   off-screen `WKWebView` host, macOS 26.2, the real `motiondraw.ts` bundled with esbuild; kept in the scratch area,
   not the repo), and the check, `autofix`, the sound renderer and the GIF plan measured in Node.

## What broke, and what was done

| # | Finding | Input | Fix |
|---|---|---|---|
| R1-1 | `applyOps`, documented "pure and total", threw | `ops` a Proxy list (any trap), a list whose `length` throws, or a sparse list: `new Array(20)` or length 2^32-1 → `Cannot read properties of undefined (reading 'op')` | `motionchatops.ts`: the list is read one index at a time into a plain array, each in a try; a hole is that op skipped as `invalid`; "too many" still counted |
| R1-2 | The gallery's search threw on anything not a string; the recent row threw on a non-list, **hung** on a sparse list, and took inherited names as templates | `searchRecipes(Object.create(null))`, a Proxy, `{toString(){throw}}`, a sparse array (`String()` of it is "Invalid string length"); `recentRecipes(7)`; `recentRecipes(sparse 2^32-1)` never returned; `{recipe:{id:'constructor'}}` was listed (`META['constructor']` is `Object`) | `motionsearch.ts`: only a string or finite number is text; `recentRecipes` reads at most 5,000 graphics by index, a template only when it is one of `META`'s own, and a `most` that is not a count is none |
| R1-3 | The export tab's remembered choices threw on a Proxy, took inherited fields, and `settingsFor` threw on `null` choices; a shape named `__proto__` gave NaN sizes | `readPrefs(new Proxy({}, {get(){throw}}))`; `settingsFor('picture', doc, null)`; `settingsFor(…, {format:'toString'})` | `motionshare.ts`: own fields only, each read in a try; the per-graphic choices read the same way; `hasOwnProperty` instead of `in FORMATS` |
| R1-4 | **A dash had no ceiling but half a pixel.** The canvas draws every dash, at about 45-70 ns each | a `path` of 400 long segments dashed `[0.025, 0.025]`u (6.8 million dashes): 290 ms a frame for one layer in WebKit at 1080p; sixty such layers, 15 s for the first frame (WebKit then caches an unchanged dashed path, but any `draw`, `grow`, turn or scale pays it again every frame) | `motionread.ts`: a stroke is cut into at most `MAX_DASHES` (4,000) dashes along the shape's own outline, measured with the same motionmath generators `motiondraw.ts` draws with; a finer pattern is widened, dash and gap in proportion (never dropped). One layer 2 ms, sixty 27 ms at 1080p and 76 ms at 4K. The template's dotted rule and every template are unchanged (528 builds compared before and after) |
| R1-5 | "Fix all" and the chat's `check.fix` had no ceiling on how many times they ran the check; `autofix` **hung** on a sparse list; the check threw on a Proxy | `autofix(doc, sparse 2^32-1)`: about 50 s; a graphic built so that sixty repairs are offered and most fail: 0.5-0.9 s, and in principle 64 rounds × every repair × a whole check (≈ 3,900 checks, about a minute); `checkMotion(new Proxy(…))` threw | `motioncheck.ts`: lists read by index up to 4,096; `FIX_CHECKS` = 160 checks per `autofix` (the same documents now 0.16-0.35 s; at most about 2.5 s); `checkMotion` catches what the rules do not, and looks at no more than `LIMITS.layers` layers and `LIMITS.scenes` scenes |
| R1-6 | **Words' outline and shadow were held to 20u and 100u whatever the type size.** Every letter is stroked and blurred on its own | sixty 500-letter layers of 3u words split by letter, 20u outline, 100u shadow, highlight box, shimmer: **2.2 s** a frame at 1080p, **7.2 s** at 4K in WebKit | `motionread.ts`: `textOutlineMax(size)` (half the type size, 2u to 20u) and `textShadowMax(size)` (twice it, 4u to 100u). The same document: 0.33 s and 0.57 s. Templates use at most 18% of either cap, and none builds differently |
| R1-7 | A sound's level could be `-0` | `{ mode: 'fx', level: -0 }`, `"-0"`, `-0.004` | `motionsound.ts`: `\|\| 0`, as `motionread.ts` does for every number |

Not fixed here, because the files are not this review's (each with its fix in `docs/pro/requests/R1.md`):

- **The audio library's readers** throw on Proxies, revoked Proxies and throwing getters (all five), take inherited
  fields, keep `-0`, and `readChain` walks a sparse list of 2^32-1 for about 57 s. Nothing feeds them outside data
  yet; the test runs them against everything JSON can hold (which holds) and prints the rest as `KNOWN`.
- **`MotionExport.tsx` imports `IS_MAC` from `Welcome.tsx`**, which brings `SignIn.tsx`, `account.ts`, `gateway.ts`
  and `environment.ts` (`list_tree`, `read_file`) into Motion's import closure. Nothing in Motion calls them; the
  test pins them with that reason until the import moves.
- The layer panel's outline and shadow fields still offer 20u and 100u on small words; the reader shows the cap back.
- docs/MOTION.md's "Limits" paragraph should name the two new ceilings.
- `gifPlan(null)` throws and `gifSizeFor('__proto__')` is NaN wide; only internal values reach them.

## What held

- `readMotion`, `readLayer`, `readSound` (but R1-7), `readScenes`, `readTransition`, `readBrand` and the brand
  store, `journalOf`: no throw, no hang, a fixed point (through JSON too), inside `LIMITS`, on every hostile value
  and every random one. The design in `motionread.ts` (own fields, reads in a try, lists by index, a ceiling on every
  list, `|| 0`) is the right one; the new readers that copied it held, the ones that did not are R1-1 to R1-3.
- `applyOps` keeps the model to closed lists: no op carries a brand kit (the kit is the caller's), a mood or
  transition or mode off its list changes nothing, `check.fix` reads nothing from the op, and the existing
  `test/pro-chatops.test.mjs` already proves garbage in every field changes nothing.
- **No network.** No Motion or audio file asks for it. Of the 108 files Motion can reach, five can: `generate.ts`
  (the model the person asks, as SAFETY says), `videomix.ts` and `videomedia.ts` (through `videosynth.ts`, which
  takes three pure helpers from `videomix.ts` — checked by reading their bodies — and is called only for `arrange`
  and `render`), and `account.ts` / `gateway.ts` (the `IS_MAC` path above). At run time, the whole studio exercised
  with the network trapped made no request, and its one picture was a `data:` URL.
- **No file without the button.** `writeMotionFile` and `export_write_video` appear only in `MotionExport.tsx` and
  `motionexportops.ts`; the export starts only from **Download** and **Save as…**; nothing that reads a model's
  answer names a renderer or a writer. No metadata (title, words) is written into an MP4 or a GIF.
- **No other command.** The Tauri commands in the closure are `export_write_video`, `open_exported`, `reveal_path`
  and `environment.ts`'s two; the packages are `api/core`, `api/path` and `plugin-dialog`. No shell, http, opener or
  fs plugin.
- **SAFETY in four languages agrees with the code** on what the review checked: the export command's six
  extensions, the GIF's two marks, the 1 GiB / 64 MiB / 5 MiB ceilings, the two localStorage keys
  (`vylo.motion.export.v1`, `vylo.motion.unsaved.v1`), the two databases (`vylo-motion`, `vylo-motion-brand`) and the
  files that make Motion's claims true. Keys are untouched by Motion: its model requests go through `generate.ts`'s
  `route`.
- **Ceilings that were already there:** a GIF asked for at 4K and 60 fps is 1,080 px, 20 a second, at most 300
  frames over 15 s, under 25 MB; 1,200 particles a document (four layers of 300 bubbles at 50u: 17 ms); ten
  half-tone backdrops at full density 38 ms; sixty 600u shapes with 100u shadows 8 ms (19 ms at 4K); twelve scenes
  (a transition paints the frame twice: the heaviest document is about 480,000 canvas calls a frame, 955,000 in a
  cross-fade); at most 240 sound cues, and 30 seconds of them made at 48 kHz in 0.9 s without holding the thread more
  than about 55 ms at a time (80 ms at 96 kHz; the preview's own rate decides); the check of sixty layers in under
  25 ms.

## Residual risk

Honestly stated:

- **A heavy document is still heavy.** After R1-4 and R1-6 the worst frame found is sixty layers of 500 small
  letters split by letter with every text effect on: 0.33 s at 1080p, 0.57 s at 4K, and a transition doubles it.
  Playing such a graphic stutters, its gallery card takes a third of a second, and a 30-second 60 fps 4K export with
  motion blur of it would take hours (it shows progress, can be cancelled, and its time estimate is a typical
  graphic's, so about ten times short). Nothing a template or a sensible request makes comes near it; a model can
  write it. The next ceiling would cut words a person wrote, which is a product decision (request 6).
- **The timings are one machine's.** WebKit numbers are from this Mac's `WKWebView`; Windows' WebView2 was not
  measured. Node's recording canvas counts calls rather than time, so the tests guard the counts and the shapes of
  the ceilings, not milliseconds in the app.
- **`autofix` is no longer idempotent on a document built to defeat it**: when the 160 checks run out, a second
  "Fix all" can still improve it. On every template and on the existing hostile corpus it still is.
- **The closure scan reads imports and patterns, not behaviour.** A network call written in a way the pattern does
  not match (`globalThis['fe'+'tch']`), or an `<img>` pointed at an address by a module outside Motion, would pass
  it; the run-time trap covers what the tests exercise, not every path through the interface. The Content Security
  Policy (`https:` allowed for user-named providers) is not a second line here.
- **Not reviewed here:** the Rust side beyond reading `video.rs`'s kinds and ceilings, the model's prompts
  (`motiondirection.ts`, covered by its own tests), the interface's handling of what the readers return, and Video.
