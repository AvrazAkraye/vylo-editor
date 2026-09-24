import type { Video } from './videotypes';

/**
 * Where videos are kept between sessions: the webview's IndexedDB, database
 * `vylo-video`, on this machine — the same arrangement as researchstore.ts.
 *
 * Not `localStorage`. A video carries its pictures as data: URLs, fetched once
 * so that rendering never touches the network, and a brand logo besides; a
 * single storyboard can be several megabytes. `localStorage` is one small
 * quota shared with every chat and setting, and filling it would start losing
 * chats to a quota error nobody sees. IndexedDB is sized for this.
 *
 * Keeping a video here is the app keeping its own state, in storage only this
 * app reads — not model output written to the person's disk. An MP4 reaches a
 * file they can open only through Export, at a path they chose.
 *
 * Every function here resolves rather than throws when storage is refused — a
 * private window, a full disk — because a video that cannot be kept can still
 * be previewed and exported; `false` tells the panel to say so.
 */

const DB = 'vylo-video';
const STORE = 'videos';

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

/** Whether a stored record is a video this version can show: an id and a list of scenes. */
function isVideo(x: unknown): x is Video {
  const v = x as Partial<Video> | null;
  return !!v && typeof v.id === 'string' && Array.isArray(v.scenes);
}

/** Every kept video, most recently changed first. */
export async function loadVideos(): Promise<Video[]> {
  const d = await db();
  if (!d) return [];
  try {
    const all = await done(d.transaction(STORE, 'readonly').objectStore(STORE).getAll());
    return ((all ?? []) as unknown[])
      .filter(isVideo)
      .sort((a, b) => (Number(b.updated) || 0) - (Number(a.updated) || 0));
  } catch {
    return [];
  }
}

/** Keep a video, replacing the one with its id. `false` when it could not be kept. */
export async function saveVideo(v: Video): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(v);
    return await committed(tx);
  } catch {
    return false;
  }
}

/** Forget a video. Resolves either way: there is nothing the panel could do about a refusal but show the video again. */
export async function deleteVideo(id: string): Promise<void> {
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
