# 08 Templates B and visuals: film finish, race chart, timeline, compare, price

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Catalogue", "Direction numbers") and `docs/MOTION.md` first. Look at `motionbackdrop.ts`,
`motioncharts.ts` and `motionrecipes-data.ts`.

## Why
Some of the most-wanted looks need a small engine addition: a film-grain or light-leak overlay, a bar-chart race. They stay in the closed vocabulary,
deterministic, and Canvas2D only.

## You own
`app/src/motionrecipes-pro-b.ts`, `motionrecipes-pro-b-meta.ts`, the `PRO_B_IDS` list in `motionids.ts`, `motionbackdrop.ts`, `motioncharts.ts`, the
`BACKDROPS` and `CHARTS` lines (and their types) in `motiontypes.ts`, whatever the reader needs for the new names in `motionread.ts` (a one-line
list use, if anything), `app/test/pro-templates-b.test.mjs` (extend `motionbackdrop.test.mjs`/`motioncharts.test.mjs`), `docs/pro/templates-b.md`,
`docs/pro/credits/08.md`, your i18n entries.

## Engine additions
1. **Backdrop kinds** (each: seeded, bounded cost, correct at any size via `u`, transparent where it should be, no `ctx.filter`):
   `grain` (film grain from pre-computed noise tiles reshuffled by frame, so it flickers like film; strength and size), `vignette`, `lightleak` (warm
   moving glows that bloom and fade, blend `screen`/`lighter`), `scanlines`, `halftone`. Each takes the existing backdrop fields (`colors`, `speed`,
   `density`, `seed`); document what each field means for each kind.
2. **Chart `race`**: a bar-chart race: bars for several items whose values change over time, ranks swapping smoothly, the axis rescaling, the leader's
   value counting. Data model: the chart's `data` is one row per item and you decide how a series of values over time fits the existing `{label, value}`
   shape (for example one value list per label encoded in the field text) without breaking the other chart kinds. Document it. Limits: `LIMITS.dataPoints`.
   If the closed vocabulary needs a new field, add it minimally and read it with clamps.

## Templates (about 7; quality over count)
`film-look` (grain + vignette + light leak overlay for putting over footage; `overlay: true`), `bar-race`, `timeline` (horizontal milestones with dates),
`compare` (before/after with a wipe handle), `price-card` (plan, price, three bullet points, a button), `progress-stats` (rings filling with labels), and
one of your own choice if you find a gap. All fields have samples in four languages; metadata `tags`, `useWhen`, `avoidWhen`.

## Acceptance
- New backdrop kinds: finite numbers, balanced state, deterministic, correct at all four shapes, bounded cost (record a number for the heaviest).
- `race`: values and ranks at progress 0, mid and 1 are what they should be; ties are stable; negative, zero and huge values are handled.
- Template tests as in package 07's brief. `npm test`, `npx tsc --noEmit`, `npm run build` pass.
