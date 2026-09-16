/**
 * How large the window draws itself.
 *
 * ## A ladder, not a multiplier
 *
 * The obvious implementation is `z * 1.1` and `z / 1.1`, and it is wrong in a
 * way that only shows up after a while: floating point does not come back.
 * Step in three times and out three times and you are at 0.9999999999999998,
 * which is not 1, so "am I at the normal size" can no longer be answered and
 * the reset command starts doing something visible for no reason. Worse, the
 * two directions drift apart — a run of ins and outs in a different order
 * lands somewhere else.
 *
 * So the steps are a fixed list and the current level is a position in it.
 * Stepping out and back in returns to the same number, every time, because it
 * is the same array element.
 *
 * ## The ends
 *
 * It clamps rather than wraps. Wrapping would mean somebody holding the key
 * down to make things bigger watches the window suddenly become tiny.
 *
 * ## What the numbers are
 *
 * Tighter near 100% and looser away from it, because the steps people take
 * most are the small ones either side of normal — going from 100% to 110% is
 * a decision about comfort, and going from 180% to 200% is somebody who has
 * already decided and wants more of it.
 */

export const STEPS: readonly number[] = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

/** Where everyone starts, and what Reset goes back to. */
export const NORMAL = 1;

/** Where this is kept. Versioned, like every other stored preference here. */
export const KEY = 'vylo.zoom.v1';

/**
 * The rung a factor sits on, or the nearest one.
 *
 * A stored value that is not on the ladder is not thrown away: it can come
 * from a hand-edited store, or from a build whose ladder had different rungs,
 * and in both cases the person's intent — roughly this big — survives better
 * by snapping than by resetting to 100%.
 */
export function rungOf(factor: number): number {
  if (!Number.isFinite(factor)) return STEPS.indexOf(NORMAL);
  let best = 0;
  for (let i = 1; i < STEPS.length; i++) {
    if (Math.abs(STEPS[i] - factor) < Math.abs(STEPS[best] - factor)) best = i;
  }
  return best;
}

/** One step larger, or the largest. */
export function larger(factor: number): number {
  return STEPS[Math.min(rungOf(factor) + 1, STEPS.length - 1)];
}

/** One step smaller, or the smallest. */
export function smaller(factor: number): number {
  return STEPS[Math.max(rungOf(factor) - 1, 0)];
}

/** Whether a step in that direction would change anything. */
export const canGrow = (factor: number) => larger(factor) !== factor;
export const canShrink = (factor: number) => smaller(factor) !== factor;

/**
 * A stored value, repaired.
 *
 * Absent, not a number, or out of range all mean the normal size — a window
 * that will not open at a readable size because of a bad string in storage is
 * a worse failure than any zoom level.
 */
export function read(raw: string | null): number {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return NORMAL;
  return STEPS[rungOf(n)];
}

/** What goes into storage. */
export const write = (factor: number) => String(factor);

/**
 * As a percentage, for the one place that says it out loud.
 *
 * Rounded, because 1.25 is 125% but 1.1 is 110.00000000000001% once it has
 * been through a multiplication, and a status bar reading that is worse than
 * one reading nothing.
 */
export const percent = (factor: number) => Math.round(factor * 100);
