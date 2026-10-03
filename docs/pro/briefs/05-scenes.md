# 05 Scenes and transitions

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Scenes and transitions", "Time") first.

## Why
A Motion graphic is one scene. A short film (a title, then a stat, then a call to action) needs several, with a clean transition between them.
The simple version: you add a scene, you pick how it arrives, and nothing else about the studio changes.

## You own
`app/src/motionscene.ts`, `motiontransition.ts`, `app/src/MotionScenes.tsx`, `app/test/pro-scenes.test.mjs`, `docs/pro/scenes.md`,
`docs/pro/credits/05.md`, CSS `/* pro:05 */`, your i18n entries. Regions you alone may edit: the scenes hook in `paint()` and whatever helper you add
beside it in `motiondraw.ts` (touch nothing else there), the `LayerBase` and `LIMITS` lines you need in `motiontypes.ts`, the `readScenes` call
in `readMotion` and the layer base reader in `motionread.ts`.

## Contract
`motionscene.ts` is a placeholder exporting `SceneSpec`, `readScenes(x, layers, seconds)` and `paintScenes(ctx, doc, t, width, height): boolean`;
`paint()` already calls `paintScenes` for a document with `scenes` and falls through when it returns `false`. **A document without `scenes` must paint
exactly as before** (test: identical recorded draw calls for the 18 templates). `motionscene.ts` must not import `motiondraw.ts` or `motionread.ts` at run
time (they import it): `import type`, a reader of your own, and a drawing callback passed in (extend the call site in `paint()` to build it).

## Design (decide, document in `docs/pro/scenes.md`, keep it simple)
Keep the flat `layers` array and the existing editing model working untouched. A sensible shape: `scenes: SceneSpec[]` in time order, consecutive,
each `{ id, name, start, end, transition?: { kind, d, dir?, ease? } }` with the transition describing how the scene *arrives*; a layer belongs to a
scene by an optional `scene` id (or by falling inside its range: choose, and justify). During a transition into scene B, the previous scene is
painted **frozen at its hold moment** (the last instant before any of its layers' exits begin, `outStart` in `motionanim.ts`) and B plays from its
start; both go to offscreen canvases and are composited by the transition. Limits: at most 12 scenes, a transition 0.15 to 1.5 s, never longer than
either neighbouring scene.

## Transitions (Canvas2D only; **no `ctx.filter`**; pure and seeded)
`cut`, `fade`, `push`, `slide` (over), `iris`, `clock`, `blinds`, `pixelate`, `zoom` (through), `whip`, `flash`, `light-leak`, `glitch` (slices and an
RGB offset: approximate). Direction is **logical** (`start`/`end`/`up`/`down`) so RTL mirrors. Each has progress 0 = only the old scene, 1 = only the new;
monotonic; eased by the existing easing functions. Cost ceiling: two offscreen canvases per frame, reused, never allocated per frame.

## Pure edits (in `motionscene.ts`, not `motionedit.ts`)
`addScene(doc, at)`, `splitSceneAt`, `removeScene` (merge into its neighbour), `moveScene`, `setTransition`, `renameScene`, `sceneAt(doc, t)`, with the
layer time-shifting rules stated and tested. They return a new `Motion` that `readMotion` accepts.

## The strip: `MotionScenes.tsx`
Props `{ doc: Motion; t: number; onChange(next: Motion): void; onSeek(t: number): void }`. A thin strip above the timeline: scene chips (name,
colour), a small transition chip between neighbours (click: a short menu of kinds, direction, duration), "+ Scene" and "Split here". With one
scene (or none) it shows only a quiet "+ Scene". Keyboard and RTL complete; classes prefixed `ms-`.

## Acceptance
- No-scenes identity; each transition at progress 0 and 1 is only A / only B (assert the draw structure with the recording canvas); monotonic progress;
  RTL mirroring; determinism; limits enforced by `readScenes`; fuzz of `readScenes` and the edit functions (no throw, always a valid document).
- Performance: a transition frame costs at most about twice a normal frame (record it).
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
