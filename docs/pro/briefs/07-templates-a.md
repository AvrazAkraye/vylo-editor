# 07 Templates A: lower thirds, notifications, chat, device, callout

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Direction numbers", "Catalogue") and `docs/MOTION.md` ("Adding a recipe") first. Look at
`motionrecipes-titles.ts` and `motionrecipes-overlays.ts`: match their craft.

## Why
Templates are what most people use. Each should look like a designer made it, work in all four shapes and both directions, and need only a few words.
All of these use only the existing layer kinds (text, shape, icon, counter, particles): no engine change.

## You own
`app/src/motionrecipes-pro-a.ts` (how each is built), `motionrecipes-pro-a-meta.ts` (name, fields, metadata; data only), the `PRO_A_IDS` list in
`motionids.ts`, `app/test/pro-templates-a.test.mjs`, `docs/pro/templates-a.md`, `docs/pro/credits/07.md`, your i18n entries (names, descriptions, field
labels, layer names, and **samples in all four languages**).

## Templates (about 8; quality over count; ids are yours, kebab-case, prefixed `lt-`/`ui-` as you like)
1. **Lower-third pack**: four distinct styles, each its own template: mask-reveal bar (accent bar draws, name rises from behind a mask, role fades),
   soft pill (rounded pill with a small icon), kicker + name + underline, neon outline. Fields: name, role (and a kicker where it fits). `overlay: true`
   (transparent frame, made to sit over video). Pinned `bs`, so correct in RTL.
2. **Notification stack**: one to three cards (icon, title, one line) that pop in with a stagger and settle; fields as a list (`Title: line`).
3. **Chat conversation**: bubbles alternating sides (logical start/end), a typing-dots moment before each reply, fields as a list (`Me: ...` / `Them: ...`).
   Bubble widths from the text, so wrap carefully.
4. **Device stage**: a phone (portrait) or browser window (landscape) frame drawn with shapes, with a headline beside it and a screen area showing a gradient
   or a big word. (Templates cannot carry pictures; the person can place a picture layer inside later, so leave a clean screen area.)
5. **Hand-drawn callout**: a circle or underline that *draws itself* (`draw` entrance) around/under a word, an arrow and a short label.
Fewer, better is fine. Each template: 4 to 8 seconds, 4 fields at most, an `exitAt` exit, a sensible palette, and metadata (`tags`, `useWhen`, `avoidWhen`).

## Rules
- Use `pin` and `u`, never pixels; use the `Kit` helpers (`c.text`, `c.shape`, `c.enter`, `c.leave`...). Follow the direction numbers: standard
  entrance 0.3-0.5 s, exits about 60% of that, stagger 0.05-0.12 s, accent on one element, a 3:1 hierarchy, nothing important outside the 10u margins.
- Every field has a sample in en, ar, ckb, kmr (the gallery draws with them). Long words and long Arabic lines must wrap or ellipsise cleanly; test
  the longest sensible input and an empty one.
- Group them (`titles`/`overlays`/`data`) where they belong; `overlay: true` only for ones meant to sit over video.

## Acceptance
- The existing recipe tests iterate `RECIPE_IDS` and render every template in every shape and language at many times (finite numbers, balanced
  `save`/`restore`, not empty, no layer that ends before it starts): yours are covered the moment their ids are in `motionids.ts`. Add tests for field
  limits, long text, empty fields, and RTL pins.
- A hand check: render each at its best moment to a PNG using the recording canvas or the WebKit harness if you can, and describe what you saw in your
  document. If you cannot render pictures, say so.
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
