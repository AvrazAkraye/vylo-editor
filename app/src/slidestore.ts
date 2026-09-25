import type { Deck } from './slides';

/**
 * Where presentations are kept between sessions: the webview's IndexedDB,
 * database `vylo-slides`, on this machine — the same arrangement as
 * videostore.ts and researchstore.ts.
 *
 * Not `localStorage`, for their reason: a deck carries its logo as a data:
 * URL and a deck made from a thesis carries a part of the thesis, and
 * `localStorage` is one small quota shared with every chat and setting.
 *
 * Keeping a deck here is the app keeping its own state, in storage only this
 * app reads — not model output written to the person's disk. A `.pptx` or a
 * PDF reaches a file they can open only through Save, at a path they chose.
 *
 * Every function here resolves rather than throws when storage is refused — a
 * private window, a full disk — because a deck that cannot be kept can still
 * be shown and saved; `false` tells the panel to say so.
 */

const DB = 'vylo-slides';
const STORE = 'decks';

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
        req.result.onclose = () => { opening = null; };
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  // A refusal is not cached: the next call tries again.
  void opening.then((d) => { if (!d) opening = null; });
  return opening;
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** A write, settled when its transaction commits — after a quota error would have aborted it. */
function committed(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
    tx.onerror = () => resolve(false);
  });
}

/** Whether a stored record is a deck this version can show: an id and a list of slides. */
function isDeck(x: unknown): x is Deck {
  const d = x as Partial<Deck> | null;
  return !!d && typeof d.id === 'string' && Array.isArray(d.slides) && typeof d.meta === 'object' && d.meta !== null;
}

/** Every kept deck, most recently changed first. */
export async function loadDecks(): Promise<Deck[]> {
  const d = await db();
  if (!d) return [];
  try {
    const all = await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return ((all ?? []) as unknown[])
      .filter(isDeck)
      .sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0));
  } catch {
    return [];
  }
}

/** Keep a deck, replacing the one with its id. `false` when it could not be kept. */
export async function saveDeck(deck: Deck): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(deck);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Forget a deck. Resolves either way. */
export async function deleteDeck(id: string): Promise<void> {
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
