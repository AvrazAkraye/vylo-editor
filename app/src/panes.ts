/**
 * Which terminal panes are on screen at once.
 *
 * Every pane is already mounted whether or not it is showing — a terminal is a
 * place you leave a server running, so unmounting one would kill it. That means
 * showing two is not a question of keeping more alive; it is only a question of
 * which ones are drawn. This is that set.
 *
 * ## Why a cap of three
 *
 * The panel is a horizontal band, so panes split its width. At the default
 * window a fourth pane is about 240 pixels wide, which is narrower than the
 * eighty columns most command output is written for — so the fourth pane does
 * not show you a fourth thing, it makes four things unreadable. The cap is a
 * legibility limit rather than a technical one, and it is here rather than in
 * the component so it can be argued with in one place.
 *
 * ## The set is never empty
 *
 * Hiding the last visible pane leaves the panel blank with a list beside it,
 * which reads as broken rather than as empty. So the last one cannot be hidden
 * — the way to have no terminal is to close the panel.
 */

/** Beyond this, panes are narrower than the output they are showing. */
export const MAX_PANES = 3;

/**
 * Add a pane, or remove it if it is already showing.
 *
 * `order` is the session list, and the result follows it rather than the order
 * things were clicked: panes that jump position when you show a third are panes
 * you have to find again every time.
 */
export function toggle(shown: readonly string[], id: string, order: readonly string[]): string[] {
  if (shown.includes(id)) {
    // Never to nothing. A blank panel beside a full list reads as a failure.
    if (shown.length === 1) return [...shown];
    return shown.filter((x) => x !== id);
  }
  const next = [...shown, id];
  // Oldest out when the cap is reached, so the one just asked for is always the
  // one that appears. Dropping the *newest* would make the button do nothing,
  // which is the worse of the two surprises.
  const kept = next.length > MAX_PANES ? next.slice(next.length - MAX_PANES) : next;
  return order.filter((x) => kept.includes(x));
}

/** Show one pane and only that one. What clicking a row does. */
export function only(id: string): string[] {
  return [id];
}

/**
 * The set, with anything that no longer exists dropped.
 *
 * A pane whose session has closed must go, and if that leaves nothing the
 * fallback is the first session there is — never an empty panel.
 */
export function prune(shown: readonly string[], order: readonly string[]): string[] {
  const live = order.filter((x) => shown.includes(x));
  if (live.length) return live;
  return order.length ? [order[0]] : [];
}

/**
 * Which pane the panel bar acts on.
 *
 * Send to chat, Clear and the fullscreen toggle apply to one pane, and it has
 * to be one that is actually showing — acting on a hidden pane is the same
 * class of bug as writing to a file nobody has open. Prefers the caller's
 * choice, falls back to the first visible one.
 */
export function focused(shown: readonly string[], want: string): string {
  return shown.includes(want) ? want : (shown[0] ?? '');
}
