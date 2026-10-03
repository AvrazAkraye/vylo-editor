# W2-4 Template polish: the real fonts' verdict, and the margins

Wave-2 package 4 of the Pro pass (`docs/PRO.md`, brief `docs/pro/briefs/w2-4-polish.md`), branch `pro-w2-polish`. Built,
tested and committed; nothing to mount. Every template keeps its ids and its fields (see "Ids" below).

## The verdict, before and after

All 33 templates × 4 shapes × 4 languages (528 graphics), built from their samples, checked by `checkMotion` in the
app's own engine (an off-screen WKWebView with the bundled Arabic face; the harness below):

| | before | after |
|---|---|---|
| Warnings | 0 | 0 |
| Tips | **25** | **0** |
| `text-overflow`: `bar-chart`, portrait, Badini — the chart cut its third label to "چارەکا سێ…" | 1 | 0 |
| `low-contrast`: `price-card`'s plan label, 3.0:1, every shape and language | 16 | 0 |
| `too-fast`: `ui-chat`, Sorani message 3 (2.8 s of 3.0) and Badini message 4 (1.5 s of 1.8), every shape | 8 | 0 |
| Slowest check (varies 7–13 ms run to run) | 13 ms | 7 ms |

The brief named only the Sorani chat tip; the Badini one was in the same sweep and has the same cause. The price card
was also checked in all nine palettes (144 graphics): no finding.

Two audits the check does not make, added to the harness for this package:

| | before | after |
|---|---|---|
| **Safe area**: every string `paint()` draws at the still, against `safeArea()` (motiondirection.ts) — 8.9u from the sides of the wide frame, 30.3u from the bottom of a portrait one, 6.3u top and bottom of a 4:5 one | 44 rows in 12 template/shape groups (worst: the portrait bar chart's names 6.5u from the bottom) | 0 |
| The same with every list field filled to its maximum (cycled sample lines) | (not run) | 0 (two portrait templates were fixed by it: see below) |
| **Cover**: a `shimmer` lit at `stillTime`, at the default length and at 2.5, 8, 12 and 20 s | `lower-third` and `handle` mid-sweep everywhere; `intro` (every length) and `logo-reveal` (8 s and longer) exactly on a sweep's first frame, a frame before it shows | only `lt-neon`'s running light, kept (below) |

The check over the maximum-filled templates finds only `dense` on a six-milestone timeline (twelve texts at once):
true of that much content, not a layout fault.

## What was wrong, and what changed

### 1. The Badini label cut short (`motioncharts.ts`, `sizeFor`)

Not a long label: the widest needed 0.97 of its size, far above the chart's 0.7 floor. `sizeFor` aimed the shrunk
size at exactly the slot, and WebKit's width is not exactly proportional to the size, so the label measured a hair over
the slot and `shorten` cut it. Shrinking now aims at 97% of the room (`FIT`). This is the one change the brief allowed
in `motioncharts.ts`; it applies to every chart that shrinks a label or a value. The template itself is unchanged.
A Node test reproduces it with a face that sets a little wider when smaller (width ∝ size^0.98): with `FIT = 1` it
cuts exactly "چارەکا سێ…" (and Arabic and Sorani labels in the other tall shapes); with 0.97 nothing is cut.

### 2. The price card's plan label (`motionrecipes-pro-b.ts`)

The accent on an 18% tint of itself, at the top of the card where the card's sheen is lightest: 3.0:1 in the card's own
palette (royal), worse in paper. The recipe now works out that ground from the palette (bg, the sheen's top stop, the
tint) and sets the name in the accent where it clears 3.2:1 and in the ink where it does not; the pill keeps its tint.
Royal and paper get the ink; midnight, sunset, mint, mono, neon, ocean and daylight keep the accent.

### 3. The chat read too fast at its end (`motionrecipes-pro-a.ts`)

Every message stays to the end, so the last ones have the least time, and the pacing only promised "all in 0.8 s before
the exit". It now also presses the conversation until each message has the time its words take, read as the check reads
it (`READING`: the check's 2.5 / 2.2 words a second, letters over five, a glance exempt; the check cannot be imported
by a template, so the numbers are copied and a test holds them equal to `CHECK`). The pressing stops at 0.35 of the
natural pace, where the typing dots go and messages stop arriving in turn: a conversation too long for a very short
graphic is pressed as before, and the check's tip then says so honestly. At 8 s, Sorani and Badini run 5–6% quicker
(the last message arrives at 5.75 and 5.70 s instead of 6.05); English and Arabic are unchanged.

### 4. Margins (`motionrecipes-data.ts`, `motionrecipes-pro-b.ts`, `motionrecipes-pro-a.ts`)

`sideOf` and `footOf` (and `bottomOf` in pro-b): the template's own margin or `safeArea(format)`, whichever is further in.

- **Landscape data templates** (bar chart, donut, line chart, stats, the race): words and the chart box 8.9u from the
  sides instead of 8. A 0.9u narrower layout; nothing else moves.
- **Portrait, out of the bottom 30.3u**: the bar chart (its names were 6.5u from the bottom), the donut (legend 22u),
  stats (13.5u), progress rings (27u in Badini), the race, the line chart (already clear, now by design), the film look's
  caption (18u → 30.3u) and, found by the maximum-filled audit, the chat (six long messages reached 18u) and the
  timeline (six milestones reached 12u). Square frames are unchanged; 4:5 frames move 0.3u.
- `ui-device`: its landscape headline started at 9u and its "Y" overhung to 8.8u; it now starts at 9.4u.

The look: portrait stats sets its numbers 17% smaller to keep three figures above the band (1,200 at 11.5u rather than
13.9u, still the largest thing on screen); the portrait donut is 72.6u rather than 74 and sits 10u higher; the
portrait bar chart's bars are shorter. Everything else is a shift of a few u.

### 5. The cover frame (`motionrecipes-overlays.ts`, `motionrecipes-pro-b.ts`)

**Where it was:** the gallery card and a graphic's cover are drawn at `stillTime` (motionanim.ts), 0.35 s after the
last layer has arrived. A sweep of light has no entrance, so one that started after the words had landed *was* the
last arrival, and the cover caught it a third of the way across the glass (the lower third at 1.85 s, band at 0.32; the
handle at 1.40 s, 0.35). In a long hold the repeated sweeps did the same later (a 12 s lower third's cover caught the
second one). The price card's button shine had the same timing.

**Fixed in the templates, not in `stillTime`** (not this package's file; package 07's request 3 proposed the general
fix there). `sweep()` in the overlays: one sweep, while the piece lands, over by the still — computed with the same
`stillTime` from the layers without it, which the sweep cannot move (it starts no later than they settle and has no
exit; a test checks the still is identical with and without the sweeps). Per template:

| template | before | after |
|---|---|---|
| lower third | 1.5–2.6 s, after the words; again every 5 s | 0.75–1.62 s: across the glass as it settles, behind the words arriving |
| handle | 1.05–2.05 s; again every 5 s | 0–1.15 s, riding the pill's own slide (it moves with the glass) |
| logo reveal | 1.0–1.9 s; again every 4 s | 1.0–1.9 s, once |
| intro | 1.35–2.25 s; again every 4 s | 0.07–1.21 s, riding the wide band's own wipe |
| price card | after everything, 1 s | rides the button's pop, over by the still |

**Kept: `lt-neon`'s running light.** It is lit at the still by design (it runs through the whole hold). Looked at
full size it is a brighter stretch of the neon tube itself, not a band across glass, and reads as the neon's look;
package 07's own test exempts it for the same reason.

## Pictures looked at

Rendered in the harness at the still and mid-move, over a stand-in for footage for the overlays: the lower third and
handle before (the pale slanted band through the plate behind the name) and after (clean); both mid-sweep (the light
still crosses); the neon at its still and mid-hold, cropped; contact sheets with the safe-area guides drawn for stats,
donut, bar chart, chat, timeline and film look in all shapes and languages; the price card before ("PRO" barely
reads) and after; full-size portrait stats in English and the portrait bar chart in Badini (all four names whole);
the intro mid-sweep. Not looked at: the gallery cards inside the running app (not launched, to keep off the owner's
data) and an exported MP4 (the frames are the same `paint`).

## Ids and fields

Built at HEAD and now, every template × language × shape at its own length and at 1, 2.5, 12 and 30 s (2,640
graphics): the fields are identical and no id is new. The only ids no longer made are decoration: the repeated sweeps
`shine-2` to `shine-4` of the lower third, handle, logo reveal and intro in 12 and 30 s graphics, and the one `shine`
of the lower third, logo reveal and intro at 1 s, where there is no room for a sweep before the still.

## Tests

`npm test` passes; `npx tsc --noEmit` and `npm run build` pass. Template suites: overlays 121, data 109, titles 97,
templates A 161, templates B 96, check 129, gallery 90, charts 52, direction 85. Added or changed:

- overlays: the lower third's sweep is over by the still; a long hold keeps one sweep; no sweep is lit at the still for
  any core overlay or brand template in any shape, language and length (1.5 to 30 s), and the sweeps never move the
  still; the handle's and intro's light ride their shape's entrance. Replaced: "a light crosses the glass once the words
  have landed" and "a long hold gets more than one sweep of light" — the two promises that put a sweep under the cover.
- data: words (texts, numbers, charts) inside `safeArea` at the still for every case the suite builds (samples,
  longest words, most items, 2 and 30 s); chart labels shrunk to their slot are drawn whole under a face that sets wider
  when smaller.
- templates A: `READING` equals the check's numbers; every chat message is on screen long enough to read in every
  language and shape at 6, 8 and 12 s.
- templates B: the button's light rides its pop and is over by the still at any length; the plan's name reads on its
  pill (≥3.2:1) in all nine palettes, in the ink on royal; the film look's caption inside the safe area.

## Deviations

1. **`test/pro-gallery.test.mjs`** (package 06's file): its pinned digest of the eighteen core templates moved, as its
   own comment prescribes for a recipe changed on purpose; the new value and the reason are written there. One line.
2. **Repeated sweeps are gone** from long graphics (one sweep each). With `stillTime` as it is, a later sweep is always
   the last arrival, so it is either repeats or a clean cover. If 07's request 3 (skip shimmer-only layers in
   `stillTime`) is ever adopted, repeats could return.
3. The lower third's, handle's and intro's light now crosses while they land, not after; their comments say so.
4. Margins were brought in beyond the two named in the brief (bar chart, line chart, race, progress rings, film look,
   chat, timeline, device), because the audit found them on the same rule.
5. `motioncharts.ts`'s `FIT` applies to every chart's shrunk labels and values, not only the bar chart's.
6. `READING` (pro-a) is a copy of three of the check's numbers, held equal by a test, because the check imports the
   editor, which builds templates.
7. No new visible strings, so no i18n entries and nothing for `review-needed.md`.

## Open problems

- `lt-neon`'s running light is lit at its cover (defended above; say if it should be timed off the still too).
- The Node canvas measures with an approximation; the real faces were checked here, by hand, in the harness. A WebKit
  run in CI would make the sweep a gate.
- `ui-device` (07) ends its screen gleam exactly at its still; it is not lit there, but has no margin.

## The harness (not committed)

`app/.test-build/check-harness/`, git-ignored: a copy of the integrator's harness (prebuilt off-screen WKWebView host,
`run.mjs`, `entry.tsx`; `node run.mjs "mode=sweep&lang=en"`), plus this package's `entry2.tsx` / `run2.mjs`:
`mode=sweep` (optionally `&fill=max`), `mode=safe` (optionally `&fill=max`; ignores the off-frame copy a shadow-only
text is drawn as), `mode=cover`, `mode=palettes&recipe=…`, `mode=labelfit`, and pictures: `mode=sheet&recipe=…`
(every shape and language, `&guides=1` draws the safe areas) and `mode=frame&recipe=…&format=…&lang=…&t=…`. Output in
`shots/`. It never touches the owner's app or data.
