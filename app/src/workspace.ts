/**
 * What was open in a folder, so reopening a project reopens the work.
 *
 * The folder, the model, the rail, the sidebar width, the terminal height and
 * every chat already come back on launch. The open files do not, so returning
 * to a project means finding and reopening six files by hand — and the crash
 * drafts (G4) already hold the unsaved contents of exactly those files, with
 * nowhere to put them.
 *
 * ## Keyed by folder, because a path is only a name
 *
 * `src/index.ts` is a different file in every project. One global tab list
 * would reopen one project's files against another project's tree, and the
 * same relative path saved from two folders would fight over one caret line.
 *
 * ## A stored value is input, not memory
 *
 * localStorage is editable — devtools, or anything else running in the webview
 * — so what comes back out is not necessarily what went in. Everything read
 * here is validated on the way in rather than trusted: a path that is absolute
 * or climbs out through `..` is dropped, and so is a line that is not a line.
 * `resolve()` on the Rust side would refuse such a path anyway, but refusing it
 * here is the difference between a tab that is quietly not restored and an
 * error message on launch about a file the user never asked for.
 *
 * ## Storage is a parameter
 *
 * Every function takes the store, so the whole file runs in node with no
 * browser. The `localStorage` default belongs at the call site; putting it in a
 * default parameter here would make the module untestable in exactly the case
 * that matters — a store that throws, or that holds something odd.
 */

export interface Tab {
  path: string;
  /** Caret line, 1-based, matching every other line number in the app. */
  line: number;
}

export interface Workspace {
  tabs: Tab[];
  /** The tab that was showing, or null when it was the chat. */
  active: string | null;
}

/** A folder nobody has opened, and what a corrupt store reads as. */
export const NO_TABS: Workspace = { tabs: [], active: null };

/** The parts of `localStorage` this needs, so a fake is three lines. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEY = 'vylo.tabs.v1';

/**
 * Every restored tab costs a file read and a CodeMirror instance *at launch*,
 * paid before anything is on screen. Twelve is already more than anyone is
 * reading at once; past that the cost is paid every launch for tabs nobody
 * looks at.
 */
export const MAX_TABS = 12;

/**
 * Nothing ever deletes a folder's entry, so without a cap this key grows for
 * the life of the install. Twenty is the same order as the welcome screen's
 * recent projects, which is the list this one shadows.
 */
export const MAX_FOLDERS = 20;

/**
 * How many chat ids a folder's remembered order may hold.
 *
 * `store.ts` keeps at most forty chats, so this cannot be reached by chats that
 * exist; it bounds what a hand-edited store can put in the key.
 */
const MAX_ORDER = 60;

interface Stored extends Workspace {
  /** Which folder to forget first. A counter, not a clock — see `saveWorkspace`. */
  seq: number;
  /**
   * Chat ids in the order somebody dragged them into.
   *
   * Here rather than in a second store because it answers the question this key
   * already answers — what was this folder like when you left it. Records
   * written before this existed have no such order, and that is the right
   * meaning rather than an unknown one: nobody had arranged anything.
   */
  chats: string[];
}

type All = Record<string, Stored>;

const SEPARATOR = /[/\\]/;

/**
 * A path we would never have written: absolute, drive-lettered, or climbing out
 * of the folder. Note this tests *segments* — `src/a..b.ts` is an ordinary
 * filename and a substring match would refuse it.
 */
function suspicious(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return true;
  if (/^[A-Za-z]:/.test(path)) return true;
  return path.split(SEPARATOR).includes('..');
}

function lineOf(v: unknown): number {
  const n = typeof v === 'number' ? Math.floor(v) : NaN;
  // Line 1 rather than dropping the tab: a caret we cannot place is a reason to
  // open the file at the top, not a reason not to open it.
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

/**
 * Trim to the cap, newest kept.
 *
 * The tab you were looking at survives the trim even when it is the oldest one
 * open — dropping it would lose the only tab the person was certainly using, to
 * keep eleven they may not have touched in an hour. It takes the discarded
 * entry's place rather than being appended, so the rest keep their order.
 */
function capTabs(tabs: Tab[], active: string | null): Tab[] {
  if (tabs.length <= MAX_TABS) return tabs;
  const kept = tabs.slice(-MAX_TABS);
  if (!active || kept.some((x) => x.path === active)) return kept;
  const it = tabs.find((x) => x.path === active);
  return it ? [it, ...kept.slice(1)] : kept;
}

/** A stored order, with everything that is not an id removed. */
function cleanOrder(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of v) {
    // An id in two places is not two places. Keeping the first is what
    // `orderBy` does with the same list.
    if (typeof id !== 'string' || !id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_ORDER) break;
  }
  return out;
}

/** One folder's stored value, with everything unbelievable removed. */
function clean(v: unknown, seq: number): Stored | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as { tabs?: unknown; active?: unknown; chats?: unknown };
  if (!Array.isArray(raw.tabs)) return null;

  const tabs: Tab[] = [];
  const seen = new Set<string>();
  for (const item of raw.tabs) {
    if (!item || typeof item !== 'object') continue;
    const { path, line } = item as { path?: unknown; line?: unknown };
    // Duplicates collapse to the first: the tab strip cannot show one file
    // twice, so a second entry is a second caret line for a tab that will only
    // be restored once.
    if (typeof path !== 'string' || suspicious(path) || seen.has(path)) continue;
    seen.add(path);
    tabs.push({ path, line: lineOf(line) });
  }

  const capped = capTabs(tabs, typeof raw.active === 'string' ? raw.active : null);
  const active = typeof raw.active === 'string' && capped.some((x) => x.path === raw.active)
    ? raw.active
    : null;
  return { tabs: capped, active, seq, chats: cleanOrder(raw.chats) };
}

function readAll(store: Store): All {
  let raw: string | null = null;
  // Reading can throw outright, not just return null: a webview with site data
  // blocked raises on the property access itself.
  try { raw = store.getItem(KEY); } catch { return {}; }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Nothing to salvage and nothing to report: this is launch, and the next
    // save replaces it. Losing a tab list is not worth a dialog.
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: All = {};
  for (const [folder, v] of Object.entries(parsed as Record<string, unknown>)) {
    const seq = typeof (v as { seq?: unknown })?.seq === 'number'
      ? (v as { seq: number }).seq
      : 0;
    const ws = clean(v, Number.isFinite(seq) ? seq : 0);
    if (ws) out[folder] = ws;
  }
  return out;
}

/** What was open in this folder last time, or nothing if it was never opened. */
export function loadWorkspace(store: Store, folder: string): Workspace {
  const found = readAll(store)[folder];
  return found ? { tabs: found.tabs, active: found.active } : NO_TABS;
}

/**
 * Remember what is open in this folder.
 *
 * Saving an empty tab list *forgets* the folder rather than storing emptiness:
 * closing every tab is a decision, and there is nothing to distinguish the
 * record of it from having no record at all.
 */
/**
 * Which number the folder being written gets.
 *
 * A counter, not `Date.now()`. Ordering is the only thing this number is for,
 * and a timestamp gets it wrong in exactly the two cases that matter: two saves
 * inside the same millisecond tie, and a clock that stepped back makes the
 * folder you just used look like the oldest one.
 *
 * Shared with `saveChatOrder`, which writes the same key: two copies of this
 * would be two answers to which folder is forgotten first.
 */
function nextSeq(all: All): number {
  return Object.values(all).reduce((m, x) => Math.max(m, x.seq), 0) + 1;
}

/** Cap the folders and write, or remove the key when there is nothing left. */
function flush(store: Store, all: All): void {
  const entries = Object.entries(all)
    .sort((a, b) => b[1].seq - a[1].seq)
    .slice(0, MAX_FOLDERS);
  try {
    // An empty map is not worth a key, and removing it is also how a value
    // nothing could parse stops sitting there.
    if (!entries.length) store.removeItem(KEY);
    else store.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* quota, or storage disabled */ }
}

export function saveWorkspace(store: Store, folder: string, ws: Workspace): void {
  if (!folder) return;
  const all = readAll(store);
  const kept = clean(ws, 0);
  // The chat order is not this function's to write, and not its to drop either.
  const chats = all[folder]?.chats ?? [];

  if (!kept || !kept.tabs.length) {
    // Closing every tab forgets the folder — unless its chats have been
    // arranged. That is a decision about the folder rather than about its tabs,
    // and nothing else records it.
    if (chats.length) all[folder] = { tabs: [], active: null, chats, seq: all[folder].seq };
    else delete all[folder];
  } else {
    all[folder] = { ...kept, chats, seq: nextSeq(all) };
  }
  flush(store, all);
}

/** The order this folder's chats were last dragged into, or nothing. */
export function loadChatOrder(store: Store, folder: string): string[] {
  return readAll(store)[folder]?.chats ?? [];
}

/**
 * Remember the order this folder's chats are in.
 *
 * An empty order forgets it, exactly as an empty tab list forgets the tabs:
 * there is nothing to distinguish the record of an arrangement nobody made from
 * having no record at all. A folder with tabs open keeps its entry either way.
 */
export function saveChatOrder(store: Store, folder: string, ids: string[]): void {
  if (!folder) return;
  const all = readAll(store);
  const chats = cleanOrder(ids);
  const had = all[folder];
  if (!chats.length && !had?.tabs.length) {
    delete all[folder];
  } else {
    all[folder] = {
      tabs: had?.tabs ?? [], active: had?.active ?? null, chats, seq: nextSeq(all),
    };
  }
  flush(store, all);
}

/**
 * Drop the tabs whose files are gone.
 *
 * Files move and are deleted between sessions, by git as much as by anyone, so
 * a stored list is a list of guesses. A missing file is *not* an error here:
 * greeting someone with "could not open src/old.ts" about a file they deleted
 * last week reports their own tidying back to them as a fault.
 *
 * `exists` is supplied by the caller so this stays pure — the app answers it
 * from the filesystem, a test from a set.
 */
export function keepExisting(ws: Workspace, exists: (path: string) => boolean): Workspace {
  const tabs = ws.tabs.filter((x) => exists(x.path));
  if (tabs.length === ws.tabs.length) return ws;
  const active = ws.active === null
    ? null
    : tabs.some((x) => x.path === ws.active)
      // The file you were looking at is the one most likely to be gone, and
      // showing the chat when five of six files came back answers the wrong
      // question. Fall back to work, not to an empty screen.
      ? ws.active
      : tabs[0]?.path ?? null;
  return { tabs, active };
}
