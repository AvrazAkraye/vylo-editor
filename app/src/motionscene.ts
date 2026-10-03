import type { Ctx, Layer, Motion } from './motiontypes';

/**
 * Scenes and the transitions between them. PLACEHOLDER from Phase 0
 * (docs/PRO.md): work package 05 replaces this file. `paintScenes` returns
 * `false` when it did not paint, and `paint()` then draws the frame as it always
 * did. This file must never import `motiondraw.ts` (that file imports this one):
 * a drawing function is handed in instead.
 */
export interface SceneSpec {
  id: string;
  name: string;
  start: number;
  end: number;
}

export function readScenes(_x: unknown, _layers: readonly Layer[], _seconds: number): SceneSpec[] | undefined {
  return undefined;
}

export function paintScenes(_ctx: Ctx, _doc: Motion, _t: number, _width: number, _height: number): boolean {
  return false;
}
