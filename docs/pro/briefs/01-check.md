# 01 Check: the quality check, auto-fix and the chip

Read `docs/PRO.md` (rules, simplicity contract) and `docs/pro/RESEARCH.md` ("Quality checks") first.

## Why
A person who is not a designer makes a graphic whose text runs off the edge, sits on a busy colour, or flashes by
too fast to read. HyperFrames catches this with a browser; Motion already knows every box, so it can do it with pure
functions, instantly, and fix most of it with one click. This is the feature that makes the AI's and the person's
graphics look professional without asking them to learn anything.

## You own
`app/src/motioncheck.ts`, `app/src/MotionChecks.tsx`, `app/test/pro-check.test.mjs`, `docs/pro/check.md`,
`docs/pro/credits/01.md`, the CSS between `/* pro:01 start */` and `/* pro:01 end */`, your i18n entries.

## Contract (keep these names; the placeholder already exports `Finding`, `Severity`, `checkMotion`)
```ts
export type Severity = 'tip' | 'warn';
export interface Finding {
  id: string;            // stable: rule + layer + moment, so a list does not jump
  rule: string;          // see the rules below
  severity: Severity;
  layerId?: string;
  from?: number; to?: number;          // seconds, when it is about a span
  message: string;       // English sentence with {placeholders}; the UI passes it through t() and fill()
  vars?: Record<string, string | number>;
  fix?: Fix;             // a deterministic repair, when there is a safe one
}
export interface Fix { label: string; patches: { layerId: string; patch: Partial<Layer> }[]; seconds?: number }
export function checkMotion(doc: Motion, o?: { ctx?: MeasureCtx }): Finding[];   // pure
export function autofix(doc: Motion, findings: readonly Finding[], ids?: readonly string[]): Motion;  // pure, idempotent
export function summarize(findings: readonly Finding[]): { warn: number; tip: number; clean: boolean };
```
`checkMotion` needs text measurement. Look at how `motiondraw.ts` lays text out (`LAYOUT_K`, `layerBox`) and at
`test/motioncanvas.mjs` (the recording canvas the tests use). Prefer reusing `layerBox` through an `Env`; the UI passes an
`OffscreenCanvas` context, the tests pass the recording canvas.

## Rules (start from the thresholds in RESEARCH.md; **tune them against the 18 core templates**)
`off-canvas` (box past the frame by more than 2.5u), `outside-safe` (text outside title-safe, 10u margin each side),
`text-overflow` (laid-out text taller or wider than its box, or cut with an ellipsis), `overlap` (two visible text boxes
overlapping more than 20% of the smaller, at the same time), `covered` (text 15% or more under a later opaque layer),
`low-contrast` (WCAG 4.5, or 3.0 for large text; resolve the colour behind from backdrop, gradient worst stop, or an
opaque shape under it; skip images), `small-text` (body under 2.6u; the engine's own minimum), `too-fast` (reading speed over
about 2.5 words a second: Arabic-script about 2.2; use the fully-entered time), `blink` (text visible under 0.5 s),
`frozen` (3 s or more with nothing moving, computed from entrance/exit windows and loops), `late-start` (nothing visible before
0.5 s), `empty-frame` (a stretch of 0.3 s or more with no visible content before the end), `dense` (more than 7 text layers
visible at once). Add rules only with a test and a reason.

**False alarms are worse than misses.** A person who is told their good graphic is wrong stops listening. Every one of the 18
core templates, in all four formats and four languages, must produce **no `warn`** (a `tip` only where you can defend it in
`docs/pro/check.md`). If a template trips a rule, fix the rule's threshold, or report the template defect in your document.

## Auto-fix
Only safe, deterministic repairs: move into the safe area, shrink text to fit (`fit`/`size`), switch a colour to a palette token
that passes contrast, lengthen a layer to its reading time (never past `doc.seconds`). `autofix` applies through `motionedit.ts`
functions (so the recipe link detaches like any hand edit) and is **idempotent**: a second pass changes nothing, and a fix must
never create a new finding.

## The chip: `MotionChecks.tsx`
Props: `{ doc: Motion; onApply(next: Motion): void; onSelect(layerId: string): void }`. One line by the stage: "Looks good"
(quiet, green) or "3 tips" (amber). Click opens a small popover: each tip a sentence, its layer name, a **Fix** button, and
**Fix all**. Runs debounced (250 ms) after the document changes, never on every frame. Say "tips", never "errors". Keyboard: the
chip is a button, the list is a menu, Escape closes, Enter fixes. RTL by construction. Reuse the look of existing popovers and
chips in `MotionControls.tsx`/`MotionDesign.tsx`; prefix new classes `mk-`.

## Acceptance
- Each rule: positive, negative, edge; deterministic; no NaN; no throw on any document `readMotion` can produce (fuzz it).
- Performance: `checkMotion` on a 30-layer document under 25 ms in Node (record the number).
- Autofix idempotence and no-regression property over the fuzz corpus.
- The 18 templates x 4 formats x 4 languages have no `warn`.
- `npm test`, `npx tsc --noEmit`, `npm run build` all pass.
