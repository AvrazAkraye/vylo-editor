import type { Doc } from './research';
import { readResearcher, type Researcher } from './researchers';

/**
 * Where research documents are kept between sessions: the webview's IndexedDB,
 * database `vylo-research`, on this machine.
 *
 * Not `localStorage`, which is where chats are. A doctoral dissertation is a
 * few hundred thousand characters of Arabic before its sources are counted,
 * and `localStorage` is one small quota shared by every chat, every terminal's
 * scrollback and every setting. Filling it with one thesis would start losing
 * chats, silently, to a quota error nobody sees. IndexedDB is sized for this.
 *
 * Saving here is not the app writing model output to the researcher's disk:
 * it is the app keeping its own state, as it keeps chats, in storage that only
 * this app reads. A document reaches a file the researcher can open only
 * through Save as Word, which they press.
 *
 * Every function here resolves rather than throws when storage is refused — a
 * private window, a full disk — because a document that cannot be kept should
 * still be writable and savable; `false` tells the panel to say so.
 */

const DB = 'vylo-research';
const STORE = 'docs';
/**
 * The researchers whose manner documents can be written in, with the papers
 * it was learned from (researchers.ts). Added in version 2 of the database;
 * the upgrade only creates what is missing, so the documents kept by version
 * 1 are untouched.
 */
const PEOPLE = 'people';

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
        if (!req.result.objectStoreNames.contains(PEOPLE)) req.result.createObjectStore(PEOPLE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        // The browser can close the connection under us (storage cleared, the
        // disk full); the next call opens a new one rather than failing on it.
        req.result.onclose = () => { opening = null; };
        // A newer version opened elsewhere — another window of the app after
        // an update — is let through rather than blocked by this one.
        req.result.onversionchange = () => { req.result.close(); opening = null; };
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
 * aborts the whole transaction.
 */
function committed(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
    tx.onerror = () => resolve(false);
  });
}

/** Every kept document, newest first. */
export async function loadDocs(): Promise<Doc[]> {
  const d = await db();
  if (!d) return [];
  try {
    const all = await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return ((all ?? []) as Doc[])
      .filter((x) => x && typeof x.id === 'string' && x.v === 1)
      .sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/** Keep a document, replacing the one with its id. */
export async function saveDoc(doc: Doc): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(doc);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Forget a document. */
export async function deleteDoc(id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Every kept researcher, the most recently changed first; `null` when the database could not be opened, to be asked again. */
export async function loadPeople(): Promise<Researcher[] | null> {
  const d = await db();
  if (!d) return null;
  try {
    const all = await done(d.transaction(PEOPLE, 'readonly').objectStore(PEOPLE).getAll());
    return ((all ?? []) as unknown[])
      .map(readResearcher)
      .filter((x): x is Researcher => x !== null)
      .sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/** Keep a researcher, replacing the one with their id. */
export async function savePerson(r: Researcher): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(PEOPLE, 'readwrite');
    tx.objectStore(PEOPLE).put(r);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Forget a researcher and the papers kept with them. Documents written in their manner keep their own copy of it. */
export async function deletePerson(id: string): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(PEOPLE, 'readwrite');
    tx.objectStore(PEOPLE).delete(id);
    return await committed(tx);
  } catch {
    return false;
  }
}
