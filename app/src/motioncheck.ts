import type { Motion } from './motiontypes';

/**
 * The quality check. PLACEHOLDER from Phase 0 (docs/PRO.md): work package 01
 * replaces this file.
 */
export type Severity = 'tip' | 'warn';

export interface Finding {
  /** A stable id: rule, layer and moment. */
  id: string;
  rule: string;
  severity: Severity;
  layerId?: string;
  /** English; goes through t(). */
  message: string;
}

export function checkMotion(_doc: Motion): Finding[] {
  return [];
}
