# Motion in the video, and Motion that finds out

Branch `vm`, from `main` at 0.133.0 (`45ac7c2`). Two asks from the owner, 2026-10-04:

1. "make the videos can load the saved motions one and add it to the big video" — the Video studio can take a
   graphic saved in Motion and put it into the film.
2. "i need the ask to use the AI to capi AI to get and make everything for us" — in Motion's **Ask** tab the person
   said *"add related to llm models"* and *"search llm models and get data"*; the model answered with questions
   ("do you want to change the title…?", "I need the budget data: how many categories…?"). The person wants the Ask to
   **go and get the data through the gateway's AI and make the graphic**, not to hand the work back.

## The one idea

Neither ask adds a place to go. The person already has a Video studio and a Motion studio:

- In **Video** a saved graphic becomes **a scene** (one more card in the storyboard, like a clip) or **a graphic on top
  of any scene** (a lower third over footage). The film exports it with everything else.
- In **Motion** the Ask tab **never asks the person for facts it can look up**. It searches the web through the
  model (Anthropic's server-side `web_search` tool, through `capi.vylo-tech.com`, exactly as Video's lookup already
  does), reads what the pages state, and builds the graphic from those facts, with the sources shown.

## The simplicity contract

- No new studio, no new navigation, no new setting. The Video storyboard's **Add scene** list gets one entry and a
  scene's editor gets one "graphic on top" row. The Ask tab looks exactly as it does; it just does the work and says
  where the facts came from.
- A person who never uses either sees no change.
- A film is **self-contained**: the graphic is *copied into the film* when it is added (like a clip it holds), so editing or
  deleting it in Motion later does not change a film already made. A held graphic offers "Update from Motion" when the
  saved one is newer.
- The model still **never invents a fact**. What changes is where a fact may come from: the person's words, the graphic
  itself, **or a page the web search returned, with its address**. A figure in a number field, counter or chart must be
  in one of those; the app checks it (`sourcedFields`), as it does today.

## Architecture

### Video holds Motion graphics (package `video`)

```ts
// videotypes.ts
export interface VideoMotion {            // a graphic the film holds
  id: string;                             // the film's own id for it
  from?: string;                          // the Motion id it was copied from
  stamp?: number;                         // that graphic's `updated` when copied
  title: string;
  doc: Motion;                            // read by readMotion every time the film is read
}
export interface MotionScene extends SceneBase { kind: 'motion'; motion: string; loop?: boolean }  // motion = VideoMotion.id
// SceneBase.over?: { motion: string; at?: number }   a graphic on top of ANY scene, from `at` seconds into it
// Video.motions?: VideoMotion[]
```

- **Time:** a scene shows the graphic's own time from its start; past the graphic's end it holds the last frame
  (`loop` repeats it). A graphic **on top** starts `at` seconds into its scene and plays once.
- **Size:** the graphic is painted at the film's frame (`Format` has the same four names as Motion's: landscape, portrait,
  square; the film has no `feed`), with the engine's own `paint(ctx, doc, t, { width, height })`. Motion lays out in `u` and pins,
  so any aspect works. Fonts: `ensureFonts(doc)` inside a Remotion `delayRender`.
- **Painting inside Remotion:** a `<canvas>` painted in `useLayoutEffect` from `useCurrentFrame()`. The export is
  `@remotion/web-renderer`'s `renderMediaOnWeb`, which already draws `@remotion/media` canvases (the clip scene), so a canvas
  is capturable; **prove it in the app's own WebKit before calling it done** (the host in
  `/Volumes/ExtremeSSD/apps/vylo-editor-motion/app/.test-build/qa-host*` and `/Volumes/ExtremeSSD/apps/vylo-editor-pro/app/.test-build/check-harness/`).
- **Sound:** a graphic's own sound (Motion's Sound row) is **not** mixed into the film in this version (`videomix.ts` belongs to
  another session). Say so on the scene's editor row in one plain sentence; do not hide it.
- **Reading:** a film read from storage or a link is untrusted. `readVideoMotions` runs every held graphic through
  `readMotion` (motionread.ts), caps their number and size, and drops a scene or overlay whose graphic is gone, as the
  reader does for a clip that is no longer held.
- **The model is never sent a held graphic's layers.** Prompts see its title, length and id at most (find how clips are
  described to the model and do the same).

### Motion's Ask finds out (package `ask`)

```ts
// motionresearch.ts
export interface Source { title: string; url: string }                 // https only, readable, capped
export interface WebFact { text: string; source: Source }
export interface Research { query: string; facts: WebFact[]; at: number; refused?: 'wire' | 'gateway' | 'none' }
export async function researchWeb(target, book, query, o?): Promise<Research>   // the one place Motion searches
export function factsBlock(r: Research): string                          // fenced, numbered, for the prompt
export function factNumbers(r: Research): Set<string>                    // numbers the facts state (numbersIn)
```

- **The flow.** An Ask reply may be `{"research":"<short search query>"}` (with `say` and no ops) instead of a question.
  The app runs `researchWeb`, then asks the model **again** with the facts block added; the second reply may not research
  again. One search per message, at most. The first "Make it" (`planMotion`) does the same with a plan.
- **The prompt changes.** Remove "ask one short question"; say: choose the most sensible reading and do it, saying in one
  sentence what you assumed; ask only if nothing can be done. Extend "Facts — never broken": a figure comes from the person's
  message, their first request, the graphic, **or the web facts given below, each with its source**; when you need facts you do
  not have, send `research`, never a question and never a guess.
- **The check.** `applyOps` already holds number fields to `known` numbers (`numbersIn` of the request, the person's message and the
  graphic's text). The facts' numbers join `known` for that turn only (`ApplyOptions.facts`). Nothing else loosens.
- **Sources stay with the graphic:** `Motion.sources?: Source[]` (read by `motionread.ts`, https only, at most 6), shown in
  the Ask tab under the reply as links, and the model is told to put one small credit line in the graphic ("Source: wikipedia.org").
- **Failure is plain.** Not on the Anthropic wire, the gateway refuses the tool, no pages, a timeout: `Research.refused` /
  empty facts, and the second call is told so; the reply says plainly that it could not look it up. Remember a refusal for the
  session as Video does (`webSearchRefused`).
- **Network and SAFETY.** The search is a tool of the same `/v1/messages` request through `generate()`; Motion's own files still
  make no request (`pro-export`'s "none of Motion's source files asks for the network" must keep passing: use `generate`, never
  `fetch`). SAFETY.md ×4 and the README say, once: *when you ask Motion for facts it does not have, the model may search the web
  through the gateway; the pages' addresses are shown and kept with the graphic.*

## Ownership

| | video | ask |
|---|---|---|
| New files | `videomotion.ts`, `VideoMotionView.tsx`, `VideoMotionPicker.tsx`, `test/vm-video*.test.mjs`, `docs/vm/video.md` | `motionresearch.ts`, `test/vm-ask*.test.mjs`, `docs/vm/ask.md` |
| Edits (small, named) | `videotypes.ts`, `video.ts`, `videoscenemore.tsx`, `VideoStoryboard.tsx`, one-line cases in `videoexport.ts`, `videotheme.ts`, `videochatops.ts` | `motionai.ts`, `motionchatops.ts`, `motiontypes.ts`, `motionread.ts`, `motionstate.ts`, `MotionChat.tsx`, `MotionPanel.tsx` (only where the status line or links need it) |
| Shared, by append | `i18n.ts` (`// vm video` at the end of each dictionary), `styles.css` (`/* vm:video start */ … /* vm:video end */`) | `i18n.ts` (`// vm ask`), `styles.css` (`/* vm:ask start */ … end`), SAFETY ×4, README |

`package.json`'s test lists are already wired (Phase 0). Do not edit it; if you need another test file, put it in your
`vm-*.test.mjs` or ask in `docs/vm/requests/<package>.md`.

## Rules for both

- **Stay in your lane.** Edit only the files above. A change elsewhere goes in `docs/vm/requests/<package>.md`; the integrator makes it.
  Never `git add -A`; add your paths.
- **The main tree is off limits** (`/Volumes/ExtremeSSD/apps/vylo-editor`: another session's uncommitted Video work; read-only use of
  committed files in your own worktree is the way). No other worktree, no `/opt/vylo-claude`, **no network, no real token**: the
  tests use a stubbed `ask`/`generate`. No `npm install`, no new dependency, no model-written code, no `ctx.filter`, no `<audio>`.
- **Video's other files** (`VideoPanel.tsx`, `VideoSound.tsx`, `videomix.ts`, `videosynth.ts`, `videopython.ts`, `App.tsx`) are
  being edited by another session: do not edit them. Package `video` touches `videotypes.ts` and `videochatops.ts` only at the
  places named, in the smallest possible way, away from the existing `Track` interface and the chat-op tables' ends.
- **House style:** long comments that say *why*; pure functions; no `any`; closed vocabulary; every external value read through a
  reader that clamps; look at the neighbouring file first.
- **i18n:** every visible word through `t('English sentence')`; `ar`, `ckb`, `kmr` entries at the end of each dictionary. Arabic
  must be good; Sorani and Badini best effort, listed in `docs/vm/review-needed.md` (append your own section).
- **Tests:** your `test/vm-*.test.mjs` imports every export you add (the orphans gate counts tests as users). Shape: `ok(name, cond, detail)`, a
  pass/fail count, exit 1 on failure. Fuzz the readers. Millisecond ceilings read `* SLOW` (see the top of `pro-perf.test.mjs`).
  Keep every `package.json` script under 8,191 characters (Windows `cmd`).
- **Gates before you finish:** `npm test`, `npx tsc --noEmit`, `npm run build`, `scripts/orphans.mjs` (inside `npm test`).
- **Commit** on your branch with `vm(video): …` / `vm(ask): …`. Do not push or merge. Leave the tree clean.
- **Report** in under 400 words and write `docs/vm/<package>.md` in more detail: what exists, the API, test counts, deviations, open
  problems, and what the integrator must mount where.

## How it comes together

1. Phase 0 (this commit): the plan, stubs, test wiring.
2. Two builders in parallel worktrees (`vylo-editor-vm-video`, `vylo-editor-vm-ask`).
3. Merge into `vm` (shared files by union), then adversarial review of both (the safety of a model-fetched fact; a film
   with a hostile held graphic; export in the app's own WebKit), fixes, the whole chain.
4. Merge into the main tree over the other session's uncommitted work exactly as for 0.133.0 (backup, rehearsal on a copy, per-file
   three-way merge, `git reset --mixed`). A release only on the owner's word.

## Not in this version

- A graphic's sound inside a film. A film's chat model adding a held graphic by name. Motion's Ask researching more than once per message.
  A graphic used in Slides.
