/**
 * Which terminal panes are on screen at once.
 *
 * Every pane is already mounted whether or not it is showing — a terminal is a
 * place you leave a server running, so unmounting one would kill it. That means
 * showing two is not a question of keeping more alive; it is only a question of
 * which ones are drawn. This is that set.
 *
 * ## Why a cap of four
 *
 * It was three, and the reason given was that the panel is a horizontal band,
 * so panes split its width: at a 960-pixel window a fourth pane is about 240
 * pixels, narrower than the eighty columns most command output is written for,
 * so it would not show a fourth thing — it would make four things unreadable.
 *
 * That argument was about a window nobody has. The comment said the cap "can
 * be argued with in one place", and the argument is that a 1900-pixel window,
 * which is what a person running four shells is doing it on, gives each of
 * four panes about 470 pixels — eighty columns with room to spare. The narrow
 * case is still narrow, but it is now somebody choosing four panes on a small
 * window rather than the app deciding for everybody with a large one.
 *
 * Four rather than more because the fourth is where the honest version of the
 * old argument bites: a fifth is under 380 pixels even on a wide screen.
 *
 * ## The set is never empty
 *
 * Hiding the last visible pane leaves the panel blank with a list beside it,
 * which reads as broken rather than as empty. So the last one cannot be hidden
 * — the way to have no terminal is to close the panel.
 */

/** Beyond this, panes are narrower than the output they are showing. */
export const MAX_PANES = 4;

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

/**
 * Put a session in a particular pane.
 *
 * The other way to choose what is on screen — the list beside the panes —
 * answers "show this as well" and "hide this". It cannot answer "show this
 * *there*", and with four panes that is the question: the slots are a layout
 * somebody arranged, and swapping what is in one should not rearrange the
 * others.
 *
 * So a session already on screen is **exchanged** with the one in the slot
 * rather than added. Anything else would either duplicate it — two panes on
 * one shell, both live, each echoing the other's keystrokes — or silently drop
 * a pane, which is a layout changing shape because somebody picked from a
 * menu.
 */
export function swap(shown: readonly string[], at: number, id: string): string[] {
  if (at < 0 || at >= shown.length || !id) return [...shown];
  const here = shown[at];
  if (here === id) return [...shown];
  const elsewhere = shown.indexOf(id);
  const next = [...shown];
  next[at] = id;
  // Already drawn: the two trade places, so the same set is on screen.
  if (elsewhere >= 0) next[elsewhere] = here;
  return next;
}
