import type { Motion } from './motiontypes';
import { readMotion } from './motionread';

/**
 * Where motion graphics are kept between sessions: the webview's IndexedDB,
 * database `vylo-motion`, store `motions`, on this machine — the same
 * arrangement as videostore.ts.
 *
 * Not `localStorage`. A graphic keeps its pictures inside itself as data:
 * URLs, so rendering never touches the network — a logo for a sting, a photo
 * for a lower third — and one picture may be megabytes. `localStorage` is
 * one small quota shared with every chat and setting, and filling it would
 * start losing chats to a quota error nobody sees. IndexedDB is sized for
 * this.
 *
 * Keeping a graphic here is the app keeping its own state, in storage only
 * this app reads — not model output written to the person's disk. An MP4 or a
 * PNG reaches a file they can open only through Export, at a path they chose.
 *
 * Every function here resolves rather than throws when storage is refused — a
 * private window, a full disk — because a graphic that cannot be kept can
 * still be previewed and exported; `false` tells the panel to say so.
 */

const DB = 'vylo-motion';
const STORE = 'motions';

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        // The browser can close the connection under us (storage cleared, the
        // disk full); the next call opens a new one rather than failing on it.
        req.result.onclose = () => { opening = null; };
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  // A refusal is not cached: the next call tries again, in case it was the
  // moment and not the machine.
  void opening.then((d) => { if (!d) opening = null; });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/**
 * A write, settled when its transaction commits — not when the request
 * succeeds, which is before the data is on disk and before a quota error
 * aborts the whole transaction. With pictures inline, a quota error is the
 * failure this store will actually meet.
 */
function committed(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
    tx.onerror = () => resolve(false);
  });
}

/**
 * Write each graphic under the id it now has and remove the record it came
 * from, in one transaction: both happen or neither does. `false` when they did
 * not.
 */
async function rekey(d: IDBDatabase, moves: ReadonlyArray<{ from: unknown; motion: Motion }>): Promise<boolean> {
  try {
    const tx = d.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const { from, motion } of moves) {
      store.put(motion);
      if (from !== undefined && from !== null) store.delete(from as IDBValidKey);
    }
    return await committed(tx);
  } catch {
    return false;
  }
}

/**
 * Every kept graphic, most recently changed first. Each record is read again
 * (`readMotion`): one from an older build or a hand-edited file may hold
 * anything, and the panel draws what this returns without checking. A record
 * that is not a graphic at all is left out; the rest are repaired.
 *
 * A record whose own id the reader could not keep (empty, blank, a number,
 * overlong) was given a fresh one — and since the panel finds a graphic by its
 * id to save over or delete, that graphic would be shown but never found again,
 * and listed under another id on every launch. So it is kept under the fresh id
 * from now on and the old record removed. If that write is refused the graphic
 * is left out of this list, to be moved on a later launch; it is never listed
 * under an id that storage does not hold.
 */
export async function loadMotions(): Promise<Motion[]> {
  const d = await db();
  if (!d) return [];
  try {
    const all = await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    const out: Motion[] = [];
    const moves: Array<{ from: unknown; motion: Motion }> = [];
    for (const record of Array.isArray(all) ? (all as unknown[]) : []) {
      const m = readMotion(record);
      if (!m) continue;
      const stored = (record as { id?: unknown } | null)?.id;
      if (stored === m.id) out.push(m);
      else moves.push({ from: stored, motion: m });
    }
    if (moves.length && (await rekey(d, moves))) for (const { motion } of moves) out.push(motion);
    return out.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/** Keep a graphic, replacing the one with its id. `false` when it could not be kept. */
export async function saveMotion(m: Motion): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(m);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Forget a graphic. Resolves either way: there is nothing the panel could do about a refusal but show the graphic again. */
export async function deleteMotion(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await committed(tx);
  } catch {
    /* kept, as it was */
  }
}
