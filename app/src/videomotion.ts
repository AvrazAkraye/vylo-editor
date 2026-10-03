import type { Motion } from './motiontypes';

/**
 * A film that holds Motion graphics. PLACEHOLDER from Phase 0 (docs/VM.md): the
 * `video` package replaces this file with the holding, reading, dedupe,
 * staleness and time-mapping functions, and moves `VideoMotion` into
 * `videotypes.ts` where the film's other types live.
 */
export interface HeldGraphic {
  id: string;
  from?: string;
  stamp?: number;
  title: string;
  doc: Motion;
}

/** How many graphics one film may hold. */
export const MAX_HELD = 12;

/** Placeholder so the type is used; the package replaces it. */
export function heldGraphic(_id: string): HeldGraphic | null {
  return null;
}
