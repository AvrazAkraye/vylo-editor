/**
 * The four things Vylo keeps outside the folder you are editing.
 *
 * `SAFETY.md` has documented them since the beginning, and its own table used
 * to answer "how to clear it" for `checkpoints/` with *no in-app button —
 * delete the directory*. That is an honest admission and a bad answer: the
 * storage section of a safety document exists so a person who wants their data
 * gone can make it gone, and sending them into
 * `~/Library/Application Support/com.vylo.editor` with a file manager is asking
 * them to do the app's job by hand. The Storage tab in Settings is the answer,
 * and this is the little that tab needs that is not React.
 *
 * ## Three on disk, one in the webview
 *
 * The split is the one thing about these four that is easy to get wrong, and
 * getting it wrong is exactly the failure `VYLO.md` and `SAFETY.md` both record
 * having already made once: drafts, checkpoints and file history are
 * directories in the Tauri app data folder, and **clipboard history is not**.
 * It is `localStorage`, under `vylo.clips.v1`. So deleting the app data
 * directory does not clear the clips, and the command that empties a directory
 * cannot empty them either — which is why `isOnDisk` exists rather than the
 * panel assuming all four go the same way.
 *
 * ## Why the sizes come from Rust
 *
 * Because they have to be real. The tab shows a number and then offers to act
 * on it, and somebody deciding whether to throw away their undo history is
 * owed the actual figure rather than one the UI estimated from a count of
 * files it never opened. `store_sizes` walks the three directories; this module
 * only turns bytes into something readable.
 */

/** One of the four, named as the settings catalogue names them. */
export type StoreId = 'drafts' | 'checkpoints' | 'fileHistory' | 'clipboardHistory' | 'terminals';

/**
 * The three that are directories, in the order the Storage tab lists them.
 *
 * These strings cross the IPC boundary as the `storeId` argument of
 * `store_empty`, where Rust deserialises them into a closed enum — so a typo
 * here is a button that fails rather than a directory that goes. `LocalStore`
 * in `src-tauri/src/lib.rs` is the other end, and `test/stores.test.mjs` reads
 * that file to check the two agree.
 */
export const ON_DISK = ['drafts', 'checkpoints', 'fileHistory'] as const;

export type DiskStore = (typeof ON_DISK)[number];

/** Bytes per directory, exactly as `store_sizes` answers. */
export interface Sizes {
  drafts: number;
  checkpoints: number;
  fileHistory: number;
}

/** Whether emptying this one is a Tauri command or a `localStorage` write. */
export function isOnDisk(id: StoreId): id is DiskStore {
  return (ON_DISK as readonly string[]).includes(id);
}

/**
 * How big one store is, or null while the answer is still on its way.
 *
 * Null rather than zero, and that distinction is the reason this is a function
 * and not a property lookup. Zero means *nothing is kept*, which is a real
 * state with a real consequence — the Empty button is disabled and the row says
 * so. A store whose size has not arrived yet is not empty; showing it as `0 B`
 * for the half-second the walk takes offers a person the wrong fact about their
 * own disk, and offers it fastest on the slowest machines.
 *
 * The clipboard is measured by `clipboardBytes` below rather than by Rust,
 * because it is a string in this window's `localStorage`.
 */
export function usage(id: StoreId, disk: Sizes | null, clipboard: number, terminals = 0): number | null {
  if (id === 'clipboardHistory') return Math.max(0, Math.round(clipboard));
  // Also a string in this window's `localStorage`, for the same reason: it is
  // written by the frontend and Rust never sees it.
  if (id === 'terminals') return Math.max(0, Math.round(terminals));
  return disk ? disk[id] : null;
}

/**
 * What the clipboard history is taking, from the history itself.
 *
 * The obvious one line — `JSON.stringify(clips).length` — is wrong in exactly
 * one place, and it is the place a person looks hardest. `clear` writes `[]`,
 * so an emptied history is still two characters in `localStorage`: the row
 * would settle on **2 B** the moment somebody pressed Empty, with the button
 * still live beside it, telling them their clipboard data is still there
 * seconds after they threw it away. An empty store holds nothing, and the two
 * brackets are the container rather than the contents.
 *
 * Everything else about the figure is deliberately the string's own length.
 * This is what the store *costs*, punctuation and escaping included, which is
 * the same question `store_sizes` answers for the other three by weighing the
 * files rather than the text inside them.
 */
export function clipboardBytes(clips: readonly unknown[]): number {
  if (!clips.length) return 0;
  return JSON.stringify(clips).length;
}

const KB = 1024;
const MB = KB * KB;

/**
 * One decimal, and never a trailing `.0`: "4 MB" rather than "4.0 MB".
 *
 * Above a hundred the decimal is noise — nobody reads "412.3 kB" differently
 * from "412 kB" — and dropping it keeps the column from jittering a character
 * wider as a store grows.
 */
function trim(x: number): string {
  return x >= 100 ? String(Math.round(x)) : x.toFixed(1).replace(/\.0$/, '');
}

/**
 * Bytes as a person reads them.
 *
 * Binary units under decimal names, which is what every file manager on both
 * of this app's platforms shows and therefore what the number beside it in
 * Finder will say. `history.rs` and `checkpoint.rs` write their caps the same
 * way — "32 MB per folder" is 32 × 1024 × 1024 there — so a store at its cap
 * reads as 32 MB here rather than 33.6.
 */
export function human(bytes: number): string {
  // Anything that is not a number of bytes is nothing kept. A store size
  // arrives from a directory walk that answers 0 for a directory that is not
  // there, and this is the same answer for the same reason.
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) return `${trim(bytes / KB)} kB`;
  return `${trim(bytes / MB)} MB`;
}
