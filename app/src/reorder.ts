/**
 * Moving one item in a list, and the arithmetic a drag needs to decide where.
 *
 * Three lists in this app are in an order nobody chose: the editor tabs, the
 * terminal sessions and the chats. Each is drawn by a different component, and
 * the only thing they can usefully share is this file — the part with no DOM
 * in it, which is also the part that is wrong in ways nobody sees until a tab
 * lands one place to the left of where it was dropped.
 *
 * Nothing here imports React or touches an element. `Box` and `Point` are the
 * three or four numbers a `DOMRect` and a `PointerEvent` carry, so the hook
 * hands over real ones and a test hands over literals.
 *
 * ## `to` is where the item ends up, not the slot it was aimed at
 *
 * There are two readings of `move(list, from, to)` and they disagree in
 * exactly one direction:
 *
 *   A. `to` is an index in the list *as it will be*. `move([a,b,c,d], 0, 2)`
 *      is `[b,c,a,d]` — `a` is at index 2, and `b` and `c`, which were between
 *      it and where it went, each shifted one place towards the front.
 *   B. `to` is a slot in the list *as it stands*, before the item is lifted
 *      out: "put it in front of whatever is at index 2 right now". Under that
 *      reading the same call is `[b,a,c,d]`.
 *
 * They agree when the item moves towards the front and differ by one when it
 * moves towards the back, because lifting the item out has already pulled
 * everything after it forward by one. This file takes reading A, so
 * splice-out-then-splice-in is correct as written — and `dropIndex` below does
 * the conversion from a pointer position, which is naturally B-shaped, in one
 * documented place rather than at three call sites.
 *
 * ## Layout is measured once, at the moment the drag begins
 *
 * `dropIndex` takes the midpoints of the rows, not the rows themselves, and
 * the caller is expected to measure them when the gesture starts rather than
 * on every move. The item being carried is drawn translated under the pointer,
 * so its own box moves with the finger — re-measuring mid-drag would feed that
 * movement back in and the target would chase the pointer instead of the
 * layout. Measure the static layout once; it is not changing, because nothing
 * is reordered until the pointer comes up.
 */

export type Axis = 'x' | 'y';

export interface Point { x: number; y: number }

/** The part of a `DOMRect` this file uses. A real one satisfies it. */
export interface Box { left: number; top: number; right: number; bottom: number }

/**
 * How far the pointer travels before a press becomes a drag.
 *
 * Without it every click on a tab is a one-pixel reorder, because a finger on a
 * trackpad does not hold still while a button goes down and up. Four pixels is
 * what the platforms use and is under the distance anybody moves by accident.
 */
export const THRESHOLD = 4;

/**
 * How far outside the strip the pointer may stray and still count as inside.
 *
 * A drop outside the strip is a cancel, so this decides how easy the cancel is
 * to hit by mistake. Sweeping a tab along a 34px strip wanders further off it
 * vertically than people think, and a reorder that gives up because the pointer
 * left the strip by three pixels reads as broken. Roughly one strip's height is
 * forgiving enough for the sweep and still nowhere near a deliberate flick away.
 */
export const SLACK = 32;

/**
 * The list with the item at `from` moved so that it sits at `to`.
 *
 * The same array comes back when nothing would change — a move to itself, an
 * index that is not a position in this list, a list too short to have two
 * positions. React call sites can therefore compare identities to decide
 * whether anything happened, and a caller cannot accidentally persist a
 * rewrite of a list it did not change.
 *
 * `from` out of range is a no-op and `to` out of range is clamped, which looks
 * asymmetric and is not: `from` names an item, and there is no item, so there
 * is nothing to move. `to` names a destination, and a pointer past the last row
 * means the end of the list rather than nothing at all.
 */
export function move<T>(list: T[], from: number, to: number): T[] {
  const n = list.length;
  // A fractional or NaN index is a caller bug rather than a position; doing
  // nothing is the only answer that cannot silently reorder the wrong row.
  if (!Number.isInteger(from) || from < 0 || from >= n) return list;
  if (!Number.isInteger(to)) return list;
  const dest = Math.min(Math.max(to, 0), n - 1);
  if (dest === from) return list;
  const out = list.slice();
  out.splice(from, 1);
  out.splice(dest, 0, list[from]);
  return out;
}

/** Has the pointer moved far enough for this to be a drag rather than a click? */
export function began(a: Point, b: Point, threshold = THRESHOLD): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Squared on both sides: the comparison is the only thing wanted and a square
  // root per pointermove buys nothing.
  return dx * dx + dy * dy >= threshold * threshold;
}

/** Is the pointer within the strip, allowing `slack` outside it? */
export function contains(box: Box, p: Point, slack = SLACK): boolean {
  return p.x >= box.left - slack && p.x <= box.right + slack
    && p.y >= box.top - slack && p.y <= box.bottom + slack;
}

/** The middle of each box along the axis the list runs in. */
export function centres(boxes: readonly Box[], axis: Axis): number[] {
  return boxes.map((b) => (axis === 'x' ? (b.left + b.right) / 2 : (b.top + b.bottom) / 2));
}

/**
 * Where the carried item would land, as an index in the list it will become.
 *
 * `mids` is the midpoint of every row in list order and `pos` is the pointer on
 * the same axis. The count of rows the pointer is past is a slot in the list as
 * it stands — reading B in the header — so it is converted here, and the
 * conversion is the whole reason this is a function rather than a line at each
 * call site: past its own midpoint, the carried item has to give up one place
 * to the row it just crossed, and that subtraction applies in one direction
 * only.
 *
 * A row's own midpoint being counted is what makes the gesture quiet: dropping
 * an item back where it started, or anywhere inside its own row, comes out as
 * `from` and changes nothing.
 *
 * **Three of the four interface languages are right to left**, and a horizontal
 * strip in one of them lays row 0 out at the greatest `x`. That is read off the
 * midpoints rather than passed in, because the numbers already say it and a
 * direction threaded down from the caller is a direction a caller can forget.
 */
export function dropIndex(mids: readonly number[], pos: number, from: number): number {
  const n = mids.length;
  const reversed = n > 1 && mids[n - 1] < mids[0];
  let gap = 0;
  while (gap < n && (reversed ? mids[gap] > pos : mids[gap] < pos)) gap++;
  return gap > from ? gap - 1 : gap;
}

/**
 * Which edge of the row at `index` the insertion line is drawn on, if any.
 *
 * The rows do not move until the pointer comes up, so the line is what says
 * where the item is going — showing it only at the end would be showing it
 * after the decision has been made. It is drawn against the row the item will
 * land on: in front of that row when the item is travelling towards the front
 * of the list, behind it when it is travelling towards the back. A drop that
 * would change nothing draws nothing, which is how "you are back where you
 * started" is said without a word.
 */
export function insertionAt(index: number, from: number, to: number): 'before' | 'after' | null {
  if (to === from || index !== to) return null;
  return to < from ? 'before' : 'after';
}

/**
 * A live list put back into a remembered order.
 *
 * The chat list arrives sorted by when each chat was last used, and that order
 * changes under the reader every time the agent replies — so a chat dragged
 * into place has to be put back there on every re-read, not only after a
 * restart. `order` is the ids as they were left; anything not in it is new
 * since then.
 *
 * **New items go to the front, in the order they arrived.** They are new
 * because something just happened in them, the incoming list is already sorted
 * by that, and a chat created a second ago belongs where the reader is looking
 * rather than at the bottom of a list they arranged last week.
 *
 * The same array comes back when nothing is remembered about any of it, so the
 * overwhelmingly common case — nobody has ever dragged anything — costs a
 * length check.
 */
export function orderBy<T>(items: T[], order: readonly string[], key: (t: T) => string): T[] {
  if (!order.length || !items.length) return items;
  const seat = new Map<string, number>();
  // First wins, so a store that somehow holds an id twice seats it once.
  for (let i = 0; i < order.length; i++) if (!seat.has(order[i])) seat.set(order[i], i);

  const fresh: T[] = [];
  const known: T[] = [];
  for (const item of items) (seat.has(key(item)) ? known : fresh).push(item);
  if (!known.length) return items;

  known.sort((a, b) => (seat.get(key(a)) ?? 0) - (seat.get(key(b)) ?? 0));
  return [...fresh, ...known];
}
