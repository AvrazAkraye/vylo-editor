# 01 Check: the quality check, auto-fix and the chip

Work package 01 of the Pro pass (`docs/PRO.md`), branch `pro-01-check`. Built and tested; not mounted (the
integrator mounts it, see the end).

## What exists

| File | What |
|---|---|
| `app/src/motioncheck.ts` | The rules (`checkMotion`), the repairs (`autofix`), `summarize`, and every threshold in one table (`CHECK`). Pure; no DOM beyond an optional canvas to measure words with. |
| `app/src/MotionChecks.tsx` | The chip by the stage and its menu of tips. |
| `app/test/pro-check.test.mjs` | 125 assertions: each rule positive, negative and edge (English and Arabic where a side matters), the 18 templates × 4 shapes × 4 languages, a 260-document hostile corpus, repairs over it, speed. |
| `app/src/styles.css` | Between `/* pro:01 start */` and `/* pro:01 end */`: `mk-check*`, logical properties only, built on `.mo-pop`. |
| `app/src/i18n.ts` | 30 entries in `ar`, `ckb`, `kmr` under `// Motion pro: 01 check` (`Shrink to fit` already existed and is reused). |

## The API

```ts
export type Severity = 'tip' | 'warn';
export interface Fix { label: string; patches: { layerId: string; patch: Partial<Layer> }[]; seconds?: number }
export interface Finding {
  id: string; rule: string; severity: Severity; layerId?: string; from?: number; to?: number;
  message: string;                          // English with {placeholders}: t() then fill()
  vars?: Record<string, string | number>;   // numbers already written ('3.4'); `other` is a layer name (pass it through shownName)
  fix?: Fix;
}
export type MeasureCtx = Ctx;               // a 2D context
export interface CheckOptions { ctx?: MeasureCtx }
export const CHECK: {...};                  // every threshold
export const RULES: readonly Rule[];        // the 13 rules, in sort order
export function checkMotion(doc: Motion, o?: CheckOptions): Finding[];                                  // pure
export function autofix(doc: Motion, findings: readonly Finding[], ids?: readonly string[], o?: CheckOptions): Motion;  // pure, idempotent
export function summarize(findings: readonly Finding[]): { warn: number; tip: number; clean: boolean };
```

`checkMotion` sorts warnings first, then by layer order, then by rule. Ids are `rule:layerId` (`overlap:a:b` for a
pair, `empty-frame:@2.0` for a stretch of time), so a list does not jump as the graphic changes. It never throws: a
layer it cannot place is skipped, and a rule that fails costs only its own findings.

`autofix` re-runs the check on `doc` itself and follows the findings asked for by rule and layer (not the exact id,
so a stale list from 250 ms ago still means what it meant). Each repair is applied through `motionedit.ts`
(`setLayer`, `setSeconds`, stamped with the graphic's own `updated`, so the result is a function of the input; the
panel stamps the time) and kept only if the check, run again, agrees: its finding is gone, no finding has appeared or
grown in number, and there are no more warnings. It loops until nothing changes, so a second call changes nothing;
it returns the very same object when it made no change. A repair to a template graphic detaches it, as a hand edit does.

## How it measures

Everything is worked out in the format's own frame (short side 1080 px, `LAYOUT_K`) and reported in u. A layer is
judged **at rest**: a copy with its entrance finished, its exit not begun, its loop stilled, fed to `layerBox`. Text
is judged by **its lines**, not its box: the lines are wrapped exactly as `textBlock` wraps them (same font string,
same measure, same greedy wrap; a fitted text's size is read back from its box height), aligned as `textBlock`
aligns them, so a short word in a frame-wide box is not "off the edge". Shapes and text are **turned rectangles**;
"how much of these words is on that plate" samples up to 24 points per line of the words and asks the plate, in its
own turned frame, whether it holds each (an ellipse is tested as an ellipse). The intro's bands lean seven degrees,
and their upright bounds cover the whole frame: that is what made this necessary (the first version called the
intro's subtitle unreadable at 1.0:1).

Chart labels cut short are found by running the chart's own layout (`drawChart`) through a context that keeps every
measurement and drops every pixel, listening for a label ending in "…".

**The measuring context.** With none given, the check makes one from `document.createElement('canvas')`, falling back
to `OffscreenCanvas`. This matters more than it looks: `motiondraw.ts` keys its layout caches (`widths`, `blocks`) on
the font string, not the canvas, so whatever the check measures is what the stage then draws with. A context that
sees other faces than the stage's (an OffscreenCanvas that has not loaded the bundled Arabic face, say) would change
the stage's layout. The chip therefore passes none. With no canvas at all, the rules that need measured words are
skipped rather than guessed.

## The rules, the numbers, and what moved them

Starting points are RESEARCH.md's and the HyperFrames source's (checked against `layout-audit.browser.js` and
`contrast-audit.browser.js`: overlap 20% of the smaller, occlusion 15% for prose, panel breach max(24 px, 2.5% of the
short edge) = 2.5u, WCAG 4.5 / 3.0 for 24 px or 19 px bold). Tuned until the 18 templates draw nothing.

| Rule | Severity | Finds | Threshold | Repair |
|---|---|---|---|---|
| `off-canvas` | warn (icon: tip) | words, numbers, a chart or an icon past the frame | > 2.5u past an edge, letters not box | move inside the safe area, when it fits |
| `outside-safe` | tip | words inside the frame but crowding an edge | < **5u** from an edge (brief: 10u) | move in |
| `text-overflow` | warn; chart: tip | widest line wider than `max` (a long word, or a fitted title at its smallest); chart labels cut with "…" | > `max` × 1.02 + 0.2u | text: a smaller `size` (refused if it would make small text) |
| `overlap` | warn | two texts (letters, by sampled points) sharing > 20% of the smaller | both settled ≥ 0.5 s together | none |
| `covered` | tip; ≥ 50%: warn | words under a later solid layer (shape ≥ 0.9 opaque, normal blend; a picture) | ≥ 15%, for ≥ 0.25 s | none |
| `low-contrast` | tip; < 0.6 × need: warn | words against the ground under them | 4.5, or 3.0 at ≥ 2.2u (≥ 1.75u bold) | the palette tone that reads best, when it clears the bar |
| `small-text` | warn < 1.4u; tip otherwise | type as drawn (fit and scale applied) | label < **2.0u**; body (≥ 7 words) < 2.6u | a larger `size` (not for a fitted title: its box decides) |
| `too-fast` | tip; < half: warn | not enough time to read | min(words, letters/5) at 2.5 w/s (Arabic script 2.2), read from **half-way in to half-way out** | a later `end`, within the graphic |
| `blink` | warn | words on screen < 0.5 s | union of on-screen time | a later `end`, within the graphic |
| `frozen` | tip | nothing changing (entrances, exits, loops, counts, cuts, moving backdrops, particles) | ≥ 3 s | none |
| `late-start` | tip | nothing (but background) appears | after 0.5 s | none |
| `empty-frame` | tip | nothing but background on screen, after the first thing appears | ≥ 0.3 s | at the end only: trim the graphic (`Fix.seconds`) |
| `dense` | tip | too many texts at once | > 7 texts **and** > 24 words | none |

What moved, and why:

- **Safe margin 10u → 5u.** The charts, the steps and the lower thirds set their words 8u from the edge by design, and
  a phone shows the whole frame. 5u is the vertical action-safe margin of a 16:9 frame.
- **Small text split in two.** The handle's "Follow us" is 2.2u and the big title's small label 2.5u: a short label
  reads smaller than a sentence does. 2.6u stays for body text (seven words or more); labels get 2.0u (HyperFrames'
  20 px minimum body at 1080, rounded); under 1.4u is a warning everywhere.
- **Reading time from half-way in to half-way out**, not from fully entered: an expo-out rise is nine tenths there at a
  third of its length, and the stricter window gave five templates (big title, split reveal, intro, kinetic, callout) a
  reading tip at their own sample words.
- **Reading load = the smaller of words and letters ÷ 5.** Badini and Sorani write particles as words (the callout's
  "Start here" is five words in Badini, "ژ ڤێرێ دەست پێ بکە"), while their joined words are long (the split reveal's
  Badini subtitle is 41 letters in six words). Each measure overcounts one kind of language.
- **A glance is exempt from reading speed**: ≤ 3 words and ≤ 16 letters ("GO", a countdown number, the Badini countdown's
  "دەست پێ بکە", which the word count alone called 3 words in 0.3 s). Half a second (`blink`) still applies.
- **Dense needs words as well as layers**: a line chart's twelve month names are twelve layers.
- **Off-canvas leaves shapes and pictures alone** (bands, panels and photos bleed by design) and is a tip for an icon.
- **A text with no letter or digit is decoration** (the quote's giant “ was an overlap with the quote under it).
- **Contrast ignores moving backdrops** (soft light, a grid, dots: texture over the ground, never the ground) and blend
  modes other than normal; a transparent frame or a picture under the words makes the ground unknown, and then nothing
  is said. Outlined words and words with a strong shadow (alpha ≥ 0.4) carry their own ground and are skipped.

## Against the templates

- **Node, recording canvas** (Arabic letters at 0.43 em and an Arabic space at 0.31, the bundled face's widths from
  the per-letter table in `motionrecipes-titles.ts`; Latin at the canvas's own 0.55): 18 × 4 × 4 = 288 graphics, **no
  finding at all**. Slowest check 3.5 ms.
- **Node, the canvas's default measure** (Arabic a third too wide): one warning, `steps` in Arabic landscape, the title
  reaching over the step numbers. The recipe places the title with the real face's widths, and in the real face it does
  not reach (about 42u wide, not 56u). Not in the test: `motiondraw.ts` caches layouts by font, so two measures cannot
  share a process.
- **The app's engine with the real faces** (WKWebView on macOS 26.2, the harness below): 288 graphics, slowest check
  **6 ms**, **one tip**: `bar-chart`, portrait, Badini — the chart really draws its third label as "چارەکا سێ…". That
  is a true defect of the template at that shape and language (`requests/01.md`), and the tip is right to say it.
- **Every palette**, 18 templates × 9 palettes × landscape and portrait × English and Arabic: four tips, all
  `logo-reveal` in Ivory (`paper`): the badge letters (`bg`) on the red-to-blue badge with its white sheen come out at
  2.5:1. True, and only when a person picks that palette.

## The chip (`MotionChecks.tsx`)

Props: `{ t, doc, onApply(next), onSelect(layerId) }`. One line: a small green "Looks good" (a status, not a button)
or an amber "3 tips" button. The check runs once on mount, then 250 ms after the graphic stops changing, and again
when a face finishes loading (`document.fonts` `loadingdone`) — never with the playhead. Clicking the chip opens a
menu (the colour popover's look, `.mo-pop`, 320 px) of tips: the sentence, the layer's name (through `shownName`, or
"The whole graphic"), the repair as a small button with its own label ("Move it inside", "Make it larger", …), and
"Fix all" when more than one can be fixed. A warning is marked by an amber dot and, for a screen reader, "Worth
fixing:". A tip with a layer selects it on the stage. A repair the check refuses marks its button "This one needs a
change by hand." instead of doing nothing silently. The status has its own polite live region, so opening the menu is
not read out.

Keys: the chip is a button (`aria-haspopup="menu"`, ArrowDown opens); in the menu, arrows move (and wrap), Home and End
go to the ends, Enter or Space takes the focused item, Escape closes and returns the focus to the chip (and is taken,
so the full window does not also close), Tab leaves. The panel's own keys already stand aside inside `[role="menu"]`.

**Verified in the app's engine** (an off-screen WKWebView, `app/.test-build/check-harness/`, not committed): opens with
the focus on the first tip; ArrowDown 0→1, End →6, Home →0, ArrowUp wraps to 6; Escape prevented, menu closed, focus
back on the chip; a tip selects its layer and closes; one Fix applies (3 → 2 tips) and the focus stays in the menu;
Fix all → "Looks good". The same in Sorani. Screenshots in English (light) and Arabic (dark) looked right: mirrored,
end-aligned to the chip, inside the window.

## Tests and speed

`node test/pro-check.test.mjs`: **125 passed**, about 1.9 s; the whole `npm test` chain about 34 s. The hostile corpus:
260 documents through `readMotion`, 1,607 findings, none malformed, no NaN, the same twice; repairs over 160 of them
changed 102 and removed 249 findings, with nothing new, never more warnings, readable by the reader as they are, and a
second pass changing nothing (0.6 s).

Speed, thirty layers (twelve two-line texts, nine shapes, four counters, a chart, an icon, a picture, a backdrop,
particles): **0.5 ms median** of 25 in Node, 1.1 ms the first time. In WebKit, the same document: **17 ms the first
time** (the code not yet compiled, every line laid out), **about 1 ms** after (WebKit's clock counts whole
milliseconds); the slowest of the 288 template checks there, 6 ms. The 25 ms budget holds with a wide margin. A Fix all on a graphic with N fixable tips re-checks O(N²) times in the worst case
(well under 100 ms for N ≤ 20).

## Deviations from the brief

1. The chip takes `t` as well, like every Motion component.
2. `autofix` takes an optional fourth argument, the `CheckOptions` (a measuring context), and follows findings by rule
   and layer rather than exact id.
3. The default measuring context is a page canvas, not an OffscreenCanvas, for the cache reason above.
4. The thresholds above moved; each move is written next to its number in `CHECK`.
5. `text-overflow` for a text is "wider than `max`" only: a text's box is its lines, so it cannot be taller than itself.
   The ellipsis is a chart's.
6. `covered`, `overlap`, `frozen`, `late-start` and `dense` have no repair: none is a safe change to one layer
   (`covered` would be a reorder, which a `Fix` cannot express).
7. The document is `docs/pro/check.md` (the brief's name), not `01.md`.

## Open problems

- The Node tests measure with an approximation of the faces; the real faces were checked once, by hand, in the
  harness. A WebKit run in CI would close that.
- The contrast ground is an estimate: moving backdrops are ignored, a gradient is judged by its worst stop, a picture
  makes it unknown (so text on a busy photo is never flagged). The highlight colour (`hi`) and chart labels are not
  checked for contrast; chart labels are not checked for size.
- Scenes (package 05): the check reads layer times as absolute. If scenes remap time or hide layers per scene, the
  timeline rules should read `doc.scenes`.
- The chip must not sit inside the stage's `dir="ltr"` transport bar: its words would align left in Arabic.

## For the integrator

- Mount `<MotionChecks t={t} doc={open} onApply={(next) => onEdit(() => next)} onSelect={select} />` in one line by
  the stage, on the end side, **outside** the `dir="ltr"` transport (for example in a row of its own above or beside
  the transport in `MotionPanel.tsx`'s `View` and full window). `onEdit(() => next)` makes the repair one undo step.
- Do not pass a `ctx`; let the check make its page canvas.
- Wave 2 chat: "check and fix" is `autofix(doc, checkMotion(doc))`; a model can be told the findings as their filled
  English sentences (package 10 consumes `Finding`).
