/**
 * What a tab's menu does.
 *
 * Four operations that read as obvious and are not: pinning, closing the
 * others, closing the ones after, and the order pinning implies. Each has a
 * case where the obvious implementation loses somebody's work or their
 * arrangement, so each is here rather than inline in a click handler.
 */

/**
 * Pinned tabs, in the order they were pinned.
 *
 * An array rather than a set, because the order is shown: pinned tabs sit at
 * the front of the strip, and a `Set` would leave that order to whatever the
 * iteration happened to be.
 */
export type Pinned = readonly string[];

export const isPinned = (pinned: Pinned, id: string): boolean => pinned.includes(id);

/** Pin, or unpin. Pinning appends, so the newest pin is the rightmost. */
export function togglePin(pinned: Pinned, id: string): string[] {
  return isPinned(pinned, id) ? pinned.filter((x) => x !== id) : [...pinned, id];
}

/**
 * The strip's order: pinned first, then the rest.
 *
 * Both halves keep the order they already had, so pinning a tab moves that one
 * tab and disturbs nothing else. Sorting by pinned-ness alone would be enough
 * to put them in front and would also reshuffle everything each time the set
 * changed, which is the sort of movement that makes a strip unusable.
 *
 * Pinned ids that are not open are ignored rather than dropped, so closing and
 * reopening a file finds it still pinned.
 */
export function arrange(tabs: readonly string[], pinned: Pinned): string[] {
  const front = pinned.filter((id) => tabs.includes(id));
  return [...front, ...tabs.filter((id) => !front.includes(id))];
}

/**
 * Which tabs "Close other tabs" closes.
 *
 * Never a pinned one. Pinning is somebody saying *keep this*, and a bulk close
 * that ignores it is the one action that makes pinning worth nothing — it is
 * also the action people reach for most, so the two would meet immediately.
 */
export function others(tabs: readonly string[], keep: string, pinned: Pinned = []): string[] {
  return tabs.filter((id) => id !== keep && !isPinned(pinned, id));
}

/**
 * Which tabs "Close tabs to the right" closes.
 *
 * "To the right" is the strip's own order, which is what somebody is looking at
 * — so it takes the arranged order, not the raw one. Everything after the tab,
 * pinned tabs excepted; a pinned tab that has been dragged past this one is
 * still pinned.
 */
export function after(tabs: readonly string[], from: string, pinned: Pinned = []): string[] {
  const at = tabs.indexOf(from);
  if (at < 0) return [];
  return tabs.slice(at + 1).filter((id) => !isPinned(pinned, id));
}

/**
 * The tab to show once some have been closed.
 *
 * The one to the right of what went, then the one to the left, then nothing.
 * That is what every editor does and it is the only rule that keeps the caret
 * near where the person was looking — jumping to the first tab after closing
 * the ninth is disorienting in a way that is hard to name and easy to feel.
 */
export function nextActive(
  tabs: readonly string[], closing: readonly string[], active: string,
): string | null {
  if (!closing.includes(active)) return active;
  const left = tabs.filter((id) => !closing.includes(id));
  if (!left.length) return null;
  const at = tabs.indexOf(active);
  for (let i = at + 1; i < tabs.length; i++) if (left.includes(tabs[i])) return tabs[i];
  for (let i = at - 1; i >= 0; i--) if (left.includes(tabs[i])) return tabs[i];
  return left[0];
}

/** The file name, for a menu that has to name what it is acting on. */
export function nameOf(path: string): string {
  const bits = path.split('/');
  return bits[bits.length - 1] || path;
}

/** The folder a file is in, for "Copy the folder". Empty at the root. */
export function folderOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at <= 0 ? '' : path.slice(0, at);
}
