/**
 * Where a context menu goes, and how the keyboard moves through it.
 *
 * Both are arithmetic and both are where context menus are usually wrong: one
 * opened near the bottom of the window runs off the screen and its last three
 * items become unreachable, and one that only responds to the mouse is a set of
 * actions somebody navigating by keyboard cannot get to at all.
 *
 * Nothing here touches the DOM. A point and a size in, a point and an index
 * out.
 */

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** A gap kept between the menu and the window edge. */
export const EDGE = 8;

/**
 * Where to put the menu.
 *
 * It opens down and to the trailing side of the pointer, which is where the
 * pointer is already going. When there is no room it *flips* to the other side
 * rather than sliding, because sliding leaves the menu under the cursor and the
 * first item lands wherever the mouse happens to be — which is how somebody
 * opens a menu and immediately triggers the thing at the top of it.
 *
 * A menu taller than the window is clamped rather than flipped, since neither
 * side fits; it starts at the top edge and scrolls.
 */
export function place(at: Point, size: Size, view: Size, edge = EDGE): Point {
  const fit = (start: number, extent: number, limit: number): number => {
    // Bigger than the window: pin to the near edge and let it scroll.
    if (extent >= limit - edge * 2) return edge;
    // Fits where it wants to go.
    if (start + extent <= limit - edge) return Math.max(edge, start);
    // Flip to the other side of the pointer. Both ends have to land: after a
    // flip the far end sits exactly at `start`, so this also refuses a pointer
    // that is itself off the screen — which a synthetic event can be, and which
    // otherwise places a menu nobody can see.
    const flipped = start - extent;
    if (flipped >= edge && start <= limit - edge) return flipped;
    // Neither side fits: sit against the far edge.
    return Math.max(edge, limit - edge - extent);
  };
  return { x: fit(at.x, size.w, view.w), y: fit(at.y, size.h, view.h) };
}

/** What a menu is made of. */
export interface Action {
  kind: 'action';
  id: string;
  /** The English sentence, which is also the `i18n.ts` key. */
  label: string;
  /** Shown greyed on the right — a shortcut, or a count. */
  hint?: string;
  disabled?: boolean;
  /** Red, for something that cannot be undone. */
  danger?: boolean;
}

/** A rule. Never focusable. */
export interface Divider { kind: 'divider' }

/** The row of colours. One control, many values, so it is not an `Action`. */
export interface Swatches { kind: 'swatches' }

export type Item = Action | Divider | Swatches;

/** Whether the keyboard can land on this row. */
export const focusable = (item: Item): boolean =>
  item.kind === 'action' ? !item.disabled : item.kind === 'swatches';

/**
 * The next row the keyboard should land on.
 *
 * Wraps, skips dividers and anything disabled, and returns -1 when there is
 * nothing to land on — a menu of entirely disabled items should not trap the
 * caret on one of them.
 *
 * `from` of -1 means "nothing selected yet", so the first press goes to the
 * first item going down and the last going up.
 */
export function step(items: readonly Item[], from: number, delta: 1 | -1): number {
  const n = items.length;
  if (!n || !items.some(focusable)) return -1;
  let at = from;
  for (let i = 0; i < n; i++) {
    at = at < 0
      ? (delta > 0 ? 0 : n - 1)
      : (at + delta + n) % n;
    if (focusable(items[at])) return at;
  }
  return -1;
}

/** The first row the keyboard can land on. For opening with a key. */
export const first = (items: readonly Item[]): number => step(items, -1, 1);

/**
 * Trim a menu down to what is worth showing.
 *
 * Dividers that ended up at the top, at the bottom, or next to another divider
 * are removed. Building a menu means writing the items a tab *could* have and
 * dropping the ones it cannot, and the dividers around a dropped group are what
 * is left behind — a rule under nothing is the visible half of a bug.
 */
export function tidy(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  for (const item of items) {
    if (item.kind === 'divider') {
      if (!out.length || out[out.length - 1].kind === 'divider') continue;
    }
    out.push(item);
  }
  while (out.length && out[out.length - 1].kind === 'divider') out.pop();
  // A menu of nothing but rules is a menu of nothing.
  return out.some((i) => i.kind !== 'divider') ? out : [];
}
