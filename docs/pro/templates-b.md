# 08 Templates B and visuals

Branch `pro-08-templates-b`. Five new backdrop kinds (the *finishes*), a new chart kind (`race`), and seven templates.
Nothing to mount: the templates reach the gallery through `META`, and the new kinds reach the inspector's menus through
`BACKDROPS` and `CHARTS` (two names there need a line each from the integrator; see `requests/08.md`).

## Engine additions

### The finishes (`motionbackdrop.ts`)

`BACKDROPS` is now the seven grounds and then five finishes (`grain`, `vignette`, `lightleak`, `scanlines`,
`halftone`). A finish is a backdrop layer like any other, but it is made to lie *over* a picture, as the last layers
of a graphic or over video in a transparent one. Each is seeded, drawn in u, transparent where it has nothing to
say, and loops (a whole number of cycles per graphic; speed 0 holds it). No `ctx.filter`.

| style | `colors` | `density` | `speed` | `seed` |
|---|---|---|---|---|
| `grain` | light grains, dark grains (white, black) | the stock: 0 fine and faint (0.16u flecks), 1 coarse and heavy (0.4u) | changes per second: 1 = 24 (film), 0.5 = 12, never more than the frame rate | which grain, frame by frame |
| `vignette` | the edge colour (black) | how far in and how dark | a slow breath of the edge | where the breath starts |
| `lightleak` | warm lights, one per leak (orange, amber, rose) | one to three leaks, and their strength | how often each blooms and fades | where they come in |
| `scanlines` | lines, rolling band (black, white) | pitch: 0 coarse (1.1u), 1 fine (0.4u) and darker | how often the band rolls down | where the band starts |
| `halftone` | dots, the colour they turn toward (text, accent) | screen: 0 large dots 3.6u apart, 1 small 1.8u apart | how often the field of light flows round | the field |

How each is built:

- **grain**: three 256 px noise tiles (a bell-shaped mix of light and dark flecks) made once per colour pair and kept
  (at most eight pairs). Each film frame shows one tile at a place, a quarter turn and a mirroring chosen by the seed
  and the frame index, as one pattern fill scaled so a fleck is a fixed share of the frame. The exposure flickers by
  up to 3%. It draws over transparency (no `source-atop`), so it survives as an overlay. Where no canvas can be made
  for the tiles, a few hundred flecks are drawn straight on.
- **vignette**: one radial gradient on an ellipse halfway between the frame's shape and a circle, clear in the middle,
  breathing a few per cent when moving.
- **lightleak**: per leak a broad soft glow just outside a side of the frame (the start or end side four times in
  five), a hot core, and sometimes a soft streak across the frame; plus a faint warm wash that swells with the bloom.
  Each blooms once a cycle, staggered; added with `screen` unless the layer names a blend. A still one is held at a
  bloom.
- **scanlines**: one path of thin rectangles at a pitch in u, and a soft band of light rolling down once a cycle,
  entering above and leaving below so the loop meets itself where nothing is lit.
- **halftone**: a dot screen at a press angle (15, 45 or 75 degrees) whose dot *area* follows a field of three
  travelling waves about a third of a turn apart plus a spreading ring (no lattice, which value noise showed as square
  blots), pressed toward its ends, calmer in the middle; quantised into at most 36 batches by size and tint.

The dither that the soft grounds already carried now also covers `vignette` and `lightleak` (`DITHERED`).

**Cost** (recording canvas, density 1, worst shape): grain 14 calls a frame, vignette 15, light leak 38, scan lines
454 (one fill), halftone 5,213 dots in 14 fills. Measured in the system WKWebView on this Mac with a pixel read-back
each frame: grain 1.4 ms (1080p) / 2.9 ms (4K), vignette 0.8 / 2.8, light leak 1.6 / 3.5, scan lines 0.9 / 2.0,
**halftone 11.2 / 14.4 ms** (the heaviest; aurora is 3.7 / 8.5 and bokeh 5.3 / 6.5 for comparison). The templates use
the halftone at density 0.35 to 0.5 (about 2,000 to 2,800 dots); the whole retro title paints in 7.2 ms at 1080p.

### The race (`motioncharts.ts`)

**Data model.** A chart's datum is `{label, value}`. A race keeps a datum's earlier values in its label, after a bar:

```json
{ "label": "Rome|12 18 25 31", "value": 40 }
```

is Rome at 12, 18, 25 and 31 in the first four periods and 40 in the last. The value is always the last period, so
the same data read as `hbars` (or by anything that only knows values, such as the figure check) is the final
standing. The numbers after the last bar are plain: digits (Arabic-Indic and Persian too), sign, point, exponent,
separated by spaces or semicolons. A label with no bar, or with words after its last bar, is all name and holds one
value. At most 12 periods (`RACE_STEPS`, the same as `LIMITS.dataPoints`); a shorter list holds its last value. The
label is held to `LIMITS.label` (40) characters by the reader, so `raceData` writes numbers short (`1.2e6`), and when a
row would still be longer it drops periods evenly (keeping the first and the last), then shortens the name, never the
numbers; it returns which periods it kept. No new field and no reader change were needed. Every chart kind now shows
only the part before the bar, so a race switched to bars shows clean names.

**Motion.** Bars arrive with the layer's entrance as any chart's do (`gap` apart, in the order they stand at the
start). The race runs inside `raceWindow(layer)`: from a short lead after the last bar arrived to a hold (up to 1.2 s)
before the exit, periods at an even pace. Between periods a value follows a monotone cubic (Fritsch–Carlson
slopes, flat at the ends), so it is exactly each period's value at that period, never overshoots the next number, and
eases out of the first and into the last. Places are the standings averaged over half a second around now (12
samples, bell-weighted), so an overtake is a slide, never a jump; ties keep the written order. The scale is the
current leader's value (the leading bar always runs the full length); ticks at 1, 2 or 5 times a power of ten, three to
six of them, cross-fading near the midpoint between two steps, numbers only for the stronger set. With two colours the
bars are the first and the leader the second, handed on as the lead changes, and the leader's number takes its colour.

**API** (all pure): `raceSeries(label, value)`, `raceData(rows)`, `raceValues(series, q)`, `raceOrder(values)`,
`raceWindow(layer)`, `raceAt(layer, t, steps)`, `RACE_STEPS`.

## Templates (`motionrecipes-pro-b.ts`, `-meta.ts`, ids in `PRO_B_IDS`)

| id | group | fields | what it does |
|---|---|---|---|
| `film-look` | overlays (transparent) | caption | light leak, vignette, mono caption typed in at the bottom start, grain on top |
| `bar-race` | data | title, items (`Name: v1, v2, …`), periods, unit | the race, the period large at the end of the heading row, rolling to the next as the race reaches it |
| `timeline` | titles | title, items (`Date: words`) | a line draws through up to six milestones; across with labels alternating above and below (wide, square), down the start side (tall); the last lit and glowing |
| `compare` | titles | before, words before, after, words after | a card; a handle wipes the second half in from the far edge to the middle; side by side, or stacked on the tall frame |
| `price-card` | brand | plan, price (`$19/month`), features, button | a card on a faint halftone; the price counts up, period beside it; features tick in; the button pops and catches one shine |
| `progress-stats` | data | title, items (`Label: 92%`) | one to four rings sweeping to their share, numbers counting in the middle |
| `retro-title` | titles | title, subtitle | a flash, the title flips open between two screen-blended accent copies that jitter, subtitle typed; halftone behind, scan lines and vignette over |

Details worth knowing:

- **Reading fields.** Racer lines take a colon, `=`, or no separator (`West 900 950`); values split at `, `, `;`,
  `،`, `|` or spaces, `12,18,25` with no spaces is three values, grouped thousands (`1,200`) and Arabic-Indic digits
  read (`numberOf`). Periods split at commas, Arabic commas, semicolons or bars, or at spaces when that is all there
  is. A milestone's date ends at the first `: ` (so `10:30` stays whole), else at `:`, else at ` - `. The price is read
  with `numberOf` up to a slash; the rest is the period; a price with no number (`Free`) is drawn as words. Lines with
  no number are skipped; when nothing reads, the sample's words for the language are used.
- **Digits.** Periods and timeline dates are written in Arabic-Indic digits in Arabic, Sorani and Badini graphics, as
  the charts and counters already write theirs. Width estimates treat both digit scripts alike, so each template in
  Arabic is the exact mirror of itself in English (tested box for box).
- **The handle** of `compare`: the wipe, the divider line (a `path` shape grown from the far edge) and the knob (which
  can be carried at most 36u by `slide`) move as one. All three use `cubic-out`; the knob runs the last part of the
  way on a shorter run, `d·∛(36/travel)`, which keeps it exactly on the line (tested to 0.05u in four layouts).
- **Wrapping.** `fit` sets words on one shrunk line, so blocks that wrap use `wrapped()`: the size is lowered until
  the longest word fits a line, and `fit` is kept for a single word.
- **Short graphics.** `settle` also shortens an entrance that would still be running when the exit starts, then the
  exit, and leaves out a layer with no time for either; a race too quick to read its periods shows only the last.
- **Names.** Repeated layers share plain names (`Date`, `Feature`, `Period`) rather than numbered ones: a numbered
  name is translated only through `motionui.ts`'s table, which is not this package's.

## Hand check (rendered and looked at)

I rendered every template and every finish in the system **WKWebView** (a 60-line Swift host in the git-ignored
`app/.test-build/wk08/`, never the app or its data) to PNG and looked at them: all seven templates in landscape
English, portrait Arabic, square Sorani and 4:5 Badini, at their still moments; the race at the start, middle and
end; the compare handle mid-sweep; the finishes over a stand-in "footage" picture. What I saw and changed:

- The race reads as intended: names at the start side, values past the tips, ticks above, leader in the accent;
  mirrored in Arabic with Arabic-Indic digits. A half-faded tick cross-fade lingered during the final hold, so the
  fade now happens only near the midpoint between steps.
- The halftone first showed square blots (value-noise lattice); replaced by an interference field. Two waves near
  square to each other then wove a checkerboard; the waves are now about a third of a turn apart.
- The grain was harsh and the leak pale; both retuned (softer, larger flecks; saturated hues and a stronger body).
- `fit` collapsed wrapped blocks onto one shrunk line (seen in the 4:5 compare); replaced by `wrapped()`.
- Fonts in the harness are the system's and the bundled Arabic face; the app's own stacks may set Latin a little
  differently. I did not check the gallery cards or the panel, which other packages are changing.

## Tests

- `test/pro-templates-b.test.mjs`: **92 checks** — the finishes (clean in every shape, dark and light, six moments;
  ends of density, speed and frame rate; nonsense; deterministic; loop seam to 1e-6; speed 0; seeds; opacity; u
  layout at three sizes; cost; see-through; grain rate 24/12/30 a second; no-canvas fallback; leak count; scan line
  and dot density), the race's model (reader, writer round trip, thinning, exact short numbers, limits), values at
  progress 0, middle and 1, monotone between periods, ranks and stable ties, negative/zero/huge/tiny values, the
  scale following the leader, colour hand-over, RTL, other kinds showing names only, windows; and the templates
  (identity and metadata; samples in four languages; 448 builds as fixed points with stable ids, clean frames and
  arrivals before exits; RTL mirror box for box; longest text and empty fields in every shape; 300 junk-field builds;
  each template's own promises).
- Extended: `motionbackdrop.test.mjs` (twelve backdrops; the dither check skips film grain, which is meant to cover
  transparency) and `motioncharts.test.mjs` (six charts; race in every data set, size and direction; its tick numbers
  counted apart): 40 and 52 checks, all pass.
- `npx tsc --noEmit` passes; `npm run build` passes; `npm run orphans`: 0 orphans.
- `npm test`: every step passes **except one assertion in `motionai.test.mjs`**: the model's plan prompt is 10,827
  characters against a 9,500 budget. The prompt lists every template with its fields and hints; without this
  package's seven it is 9,046 (with the new vocabulary words), so no trimming can fit seven templates in the 454
  characters left, and package 07 adds its own. The test belongs to the AI package's area; it is request 1 in
  `requests/08.md`. All 44 steps after it in the chain were run by hand and pass (orphans and e2e included).

## Deviations

- **Two compile-forced edits outside my files**: `motionrecipes-titles.ts` keys its loop looks by the new `Ground`
  type (the seven grounds) instead of `Backdrop`, which now has twelve names (3 lines; the loop background still
  offers only grounds); and `MotionControls.tsx` gains a `race` glyph, because the chart chooser draws a glyph per
  kind (1 line). Both are needed for `tsc` once `BACKDROPS` and `CHARTS` grow.
- `motiontypes.ts`: besides the two list lines, a `Ground` type next to them, and comments.
- The price is a `line` field (`$19/month`), not a `number` field, so the person can type the currency and period in
  the Design panel (a number field keeps digits only). It is therefore not yet held to the figure check: request 2.
- Seven templates, as briefed, plus nothing else; the seventh of my choice is the retro title, so that the scan lines
  and halftone have a template.

## Open problems

See `requests/08.md`. In short: the prompt budget; the figure check does not yet read a race's earlier values or the
price line; the inspector names the new kinds `Stripes` and `Ring` until `MotionKinds.tsx` gets a case each; the
model is not yet told the race's label format; the gallery still of `bar-race` is its starting order (stillTime is
not mine); a racer's line is cut at 80 characters by `motiontemplates.ts`, which limits very long races (ten periods
of five-digit numbers fit). Sorani and Badini strings need a native speaker (`review-needed.md`).
