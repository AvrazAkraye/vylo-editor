/**
 * How wide each pane is when several share a row.
 *
 * Two terminals side by side arrived locked at half each, which is the right
 * default and the wrong only option: the pane you are reading and the pane you
 * are glancing at are rarely the same size. This is the arithmetic for dragging
 * the line between them.
 *
 * ## Weights, not pixels
 *
 * A pane's size is a *share* of whatever width the row has, so the arrangement
 * survives the window being resized, the sidebar being dragged, and the panel
 * being made full screen. Storing pixels would mean three panes that add up to
 * the old window every time the new one is a different size.
 *
 * ## Keyed by pane, not by position
 *
 * The weights are a map from pane id, so hiding a pane and showing it again
 * finds the width it had. An array indexed by position would hand the third
 * pane's width to whatever became third, which is somebody else's pane.
 */

/** Share per pane id. A pane with no entry weighs 1. */
export type Weights = Readonly<Record<string, number>>;

/**
 * The smallest a pane may be dragged, as a share of the row.
 *
 * Below about an eighth there is not enough width for a terminal to be worth
 * looking at — a shell prompt alone is thirty-odd columns — and a pane dragged
 * to nothing is a pane somebody has to work out how to get back. The caller may
 * pass a different figure; this is what the terminal uses.
 */
export const MIN = 0.12;

/** A weight worth using, or 1. Guards a stored value that has gone wrong. */
const weigh = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 1;

/**
 * Each pane's share of the row, in order, summing to 1.
 *
 * Normalised here rather than kept normalised, because the set of visible panes
 * changes and a share is only meaningful against the ones actually on screen.
 */
export function shares(ids: readonly string[], weights: Weights): number[] {
  if (!ids.length) return [];
  const raw = ids.map((id) => weigh(weights[id]));
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((n) => n / total);
}

/**
 * Move the divider at `at` by `delta` of the row's width.
 *
 * The divider before pane `at` sits between `at - 1` and `at`, and a drag takes
 * width from one and gives it to the other — the panes either side of it and no
 * others. A drag that would push either below `min` is clamped to the point
 * where it stops, rather than refused: a divider that stops moving is
 * understood, and one that snaps back looks broken.
 *
 * Panes that are not on screen keep whatever they had.
 */
export function after(
  ids: readonly string[], weights: Weights, at: number, delta: number, min = MIN,
): Weights {
  if (at < 1 || at >= ids.length || !Number.isFinite(delta) || delta === 0) return weights;
  // Not enough room for everything at its minimum: nothing can move without
  // pushing something below it.
  if (min * ids.length >= 1) return weights;

  const f = shares(ids, weights);
  const left = at - 1;
  // Clamped from both sides. `delta` is what the pointer asked for; this is
  // what is left of it once neither neighbour may go below `min`.
  const room = Math.max(-(f[left] - min), Math.min(delta, f[at] - min));
  if (!Number.isFinite(room) || room === 0) return weights;

  const next = [...f];
  next[left] += room;
  next[at] -= room;

  // Written back as shares, which are weights: they are only ever compared to
  // each other, so the scale does not matter and 1 stays the default.
  const out: Record<string, number> = { ...weights };
  ids.forEach((id, i) => { out[id] = next[i] * ids.length; });
  return out;
}

/** Everything on screen back to the same width. What a double-click does. */
export function evened(ids: readonly string[], weights: Weights): Weights {
  const out: Record<string, number> = { ...weights };
  for (const id of ids) out[id] = 1;
  return out;
}

/** Whether anything has been dragged, so "even them out" can be offered or not. */
export function isEven(ids: readonly string[], weights: Weights): boolean {
  const f = shares(ids, weights);
  return f.every((x) => Math.abs(x - 1 / ids.length) < 0.005);
}
