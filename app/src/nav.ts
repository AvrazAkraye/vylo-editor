/**
 * Where you have been, so there is a way back.
 *
 * Go-to-definition without a way back makes navigating *worse*: one keystroke
 * takes you somewhere unfamiliar and returning is a manual search for the file
 * you were reading a second ago. The jump and the return are one feature, not
 * two, and this is the half that is easy to leave out.
 *
 * ## Browser semantics, because everyone already knows them
 *
 * A list of places and a cursor into it. Going somewhere new from the middle of
 * the trail discards what was ahead — the alternative is a tree, and nobody has
 * ever wanted a tree of their editor navigation.
 *
 * ## Why places carry a line
 *
 * Recording only the file would return you to the top of a two-thousand line
 * source file you were reading in the middle of. The line is captured from the
 * cursor at the moment of the jump, which is why `visit` is called with where
 * you *are* before it is called with where you are going.
 */

export interface Place {
  path: string;
  /** 1-based, matching every other line number in the app. */
  line: number;
}

export interface Nav {
  list: Place[];
  /** Index of the current place, or -1 when nothing has been visited. */
  at: number;
}

export const NO_NAV: Nav = { list: [], at: -1 };

/**
 * Longer than anyone retraces, short enough that the trail cannot grow without
 * bound in a session left open for a week.
 */
const MAX = 50;

const same = (a: Place | undefined, b: Place) => !!a && a.path === b.path && a.line === b.line;

/**
 * Record arriving somewhere.
 *
 * Arriving where you already are changes nothing — otherwise pressing back
 * would walk through a run of identical entries before appearing to do
 * anything, which reads as the key not working.
 */
export function visit(nav: Nav, place: Place): Nav {
  if (same(nav.list[nav.at], place)) return nav;
  const list = [...nav.list.slice(0, nav.at + 1), place];
  // Oldest first out, and `at` moves with the window so it still points at the
  // entry it pointed at before the trim.
  const over = Math.max(0, list.length - MAX);
  return { list: list.slice(over), at: list.length - over - 1 };
}

export const canBack = (nav: Nav) => nav.at > 0;
export const canForward = (nav: Nav) => nav.at >= 0 && nav.at < nav.list.length - 1;

/** The previous place, and the trail with the cursor moved onto it. */
export function back(nav: Nav): { nav: Nav; place: Place | null } {
  if (!canBack(nav)) return { nav, place: null };
  const at = nav.at - 1;
  return { nav: { ...nav, at }, place: nav.list[at] };
}

/** The place stepped back from, if any. */
export function forward(nav: Nav): { nav: Nav; place: Place | null } {
  if (!canForward(nav)) return { nav, place: null };
  const at = nav.at + 1;
  return { nav: { ...nav, at }, place: nav.list[at] };
}

/**
 * Forget a file.
 *
 * Called when a file is deleted or renamed. Leaving it in the trail means back
 * eventually lands on a path that no longer exists, and the error it raises is
 * about a file the person never asked for.
 */
export function forget(nav: Nav, path: string): Nav {
  if (!nav.list.some((p) => p.path === path)) return nav;
  // Count what disappears at or before the cursor, so the cursor keeps pointing
  // at the same remaining entry rather than sliding to a different one.
  const before = nav.list.slice(0, nav.at + 1).filter((p) => p.path === path).length;
  const list = nav.list.filter((p) => p.path !== path);
  return { list, at: Math.min(list.length - 1, nav.at - before) };
}
