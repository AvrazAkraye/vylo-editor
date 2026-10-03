# 10 AI direction: motion rules the model is given

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Direction numbers") first, then `motionai.ts` and `motionchatops.ts` (read), `motionrecipe.ts` META.

## Why
The model chooses a template or writes layers. Today it is told the vocabulary and the limits; it is not told how a good motion graphic *moves and is laid
out*. Adding the rules (durations, easing, hierarchy, safe margins, reading time, one accent) makes the same sentence produce a better graphic, invisibly.

## You own
`app/src/motiondirection.ts`, `app/src/motionai.ts`, `app/test/pro-direction.test.mjs` (extend `motionai.test.mjs`), `docs/pro/direction.md`,
`docs/pro/credits/10.md`, your i18n entries (if any). Read-only: `motionchatops.ts`, `motioncheck.ts` (a placeholder exporting `Finding`; package 01 fills it).

## Deliver
1. **`motiondirection.ts`**: the rules as **constants and a function**, one source of truth: durations by weight, spring damping choices, entrance/exit ratio,
   stagger range, first-motion delay, scene phases, size hierarchy, safe margins, minimum text size, reading speed, accent-once, the caption grouping limits.
   Where RESEARCH.md says the sources contradict, pick and write *why*. Export `DIRECTION` (the numbers), and `directionPrompt(opts: { lang; format; seconds })`
   returning the text for the system prompt, short, imperative, numbered, in the model's terms (the vocabulary words, `u`, `pin`). The check (package 01) and
   the templates (7, 8) will import `DIRECTION`, so its names are a contract: keep them stable and documented.
2. **`motionai.ts`**: add the direction block to both prompts (new graphic; change an existing one) without growing them past a stated budget (measure the
   current prompt length and keep the increase modest; justify it). Add the template metadata (`useWhen`, `avoidWhen`, `tags`, `pairsWith` from `META`, which
   package 06 fills) to the template list the model sees, **only if present**, so it keeps working either way. Keep every existing guard (the model writes JSON
   only, no pictures, no invented numbers) and the injection resistance (the person's words are data inside a delimited block).
3. **A "fix with AI" prompt builder** (`findingsPrompt(findings: readonly Finding[], doc): string`): turns the check's findings into a short, safe request for
   the existing change flow ("Make the headline fit inside the frame; keep everything else"). It sends no picture and nothing the person did not already have.
   Wired to a button in wave 2, not now.

## Acceptance
- Tests: the prompt contains each numbered rule exactly once; the numbers in the prompt equal `DIRECTION`; the prompt stays under its budget; hostile user
  text cannot close the delimited block or add instructions (extend the existing injection tests); `findingsPrompt` is deterministic and bounded; the existing
  `motionai.test.mjs` and fuzz tests pass untouched.
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
