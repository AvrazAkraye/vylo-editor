/**
 * Telling everything that has a file open that the file just changed.
 *
 * Two things made this necessary at once, and they are the same problem.
 *
 * The to-do list can now be open twice — once in the sidebar and once filling
 * the window. Each panel reads `.vylo/TODO.md` when it mounts and holds the
 * text it read. Tick a box in one and the other is showing yesterday's news;
 * its next save is refused by the `expect_sha256` guard, which is correct and
 * is not an experience anybody should have to have.
 *
 * The second is older and worse. The agent can write that same file through the
 * review gate — that is what "plan this" does — and an open panel had no way to
 * know. It would sit there showing the list from before the plan was written.
 *
 * Both are "somebody else wrote the file you are looking at", so both are
 * answered here. `applyWrite` is already the single door every byte goes
 * through, so it is the one place that knows, and it says so.
 *
 * This is not a filesystem watcher. It hears about writes *this app* makes; a
 * change from another editor still needs a reload. That is a smaller claim than
 * watching the disk, and it is the whole claim — nothing here should be read as
 * promising more.
 */

type Listener = (content: string) => void;

/** Path → the things watching it. Paths are project-relative, as written. */
const watchers = new Map<string, Set<Listener>>();

/**
 * Watch one file. Returns the unsubscribe.
 *
 * Several things may watch the same path; that is the case this exists for.
 */
export function watch(path: string, listener: Listener): () => void {
  const set = watchers.get(path) ?? new Set<Listener>();
  watchers.set(path, set);
  set.add(listener);
  return () => {
    set.delete(listener);
    if (!set.size) watchers.delete(path);
  };
}

/**
 * Say that a file now holds this text.
 *
 * Iterates a copy, because a listener is allowed to unsubscribe while it is
 * being called — a panel that reacts by unmounting is an ordinary thing to
 * write, and it must not silently skip whoever came after it in the set.
 *
 * A listener that throws does not stop the rest. One panel with a bug must not
 * leave every other panel stale, and there is nothing useful to do with the
 * error here beyond not letting it spread.
 */
export function changed(path: string, content: string): void {
  const set = watchers.get(path);
  if (!set) return;
  for (const l of [...set]) {
    try {
      l(content);
    } catch {
      // Not this module's error to handle, and not a reason to skip the others.
    }
  }
}

/** How many things are watching a path. For tests, and for asserting cleanup. */
export const watching = (path: string): number => watchers.get(path)?.size ?? 0;
