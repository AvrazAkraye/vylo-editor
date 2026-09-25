import type { Deck } from './slides';

/**
 * Undo and redo for the Slides module.
 *
 * The same rules as the Video module's (videohistory.ts), for its reasons,
 * over a deck's fields instead of a video's.
 *
 * ## What is remembered
 *
 * What a person changes by hand, or asks the Chat tab to: the slides, the
 * title, the look, the colours, the title slide's names and logo, the
 * language and how numbers are written. A whole chat message is one step —
 * a translation of twenty slides is taken back by one undo. The conversation
 * itself is not: what was said stays said.
 *
 * Typing is one step, not one step a letter. A change gets a *group* from
 * what it touched (`slide:<id>:title`, `meta`, `theme`), and a change in the
 * same group less than `COALESCE_MS` after the last one joins it. A slide
 * added, removed or moved is always a step of its own.
 *
 * ## Never across a model run
 *
 * The history keeps what the deck looked like after its last step (`seen`).
 * When the deck is not that any more — the slides written again, one slide
 * rewritten by the model — the history before it is dropped: undo never puts
 * back a deck the model has since replaced; it starts again from what the run
 * left.
 *
 * Snapshots are the deck's own objects, not copies: every change in the panel
 * makes new arrays and objects rather than editing old ones.
 */

/** The fields undo gives back. */
export const TRACKED = ['slides', 'title', 'theme', 'brand', 'meta', 'logo', 'logoRatio', 'lang', 'digits'] as const;
export type Tracked = Pick<Deck, (typeof TRACKED)[number]>;

/** Typing in one field within this long of the last keystroke is the same step. */
export const COALESCE_MS = 800;
/** Steps kept a deck. */
export const HISTORY_CAP = 100;

export interface History {
  past: Tracked[];
  future: Tracked[];
  /** The deck as the last step left it; anything else means something other than the person changed it. */
  seen: Tracked | null;
  /** What the last step changed, for joining typing into one step. */
  group: string | null;
  /** When the last step was taken (ms). */
  at: number;
}

export const emptyHistory = (): History => ({ past: [], future: [], seen: null, group: null, at: 0 });

export function snapshotOf(d: Tracked): Tracked {
  return { slides: d.slides, title: d.title, theme: d.theme, brand: d.brand, meta: d.meta, logo: d.logo, logoRatio: d.logoRatio, lang: d.lang, digits: d.digits };
}

/** The same deck, field by field — by identity, which is what an unchanged field keeps. */
export function sameSnapshot(a: Tracked, b: Tracked): boolean {
  return TRACKED.every((k) => a[k] === b[k]);
}

function changedFields(a: object, b: object): string[] {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).sort();
}

/**
 * What a change touched, when it is the kind typing makes: one field, or one
 * slide's own fields with every slide still in its place. `null` for anything
 * that is a step by itself.
 */
export function groupOf(before: Tracked, after: Tracked): string | null {
  const keys = TRACKED.filter((k) => before[k] !== after[k]);
  if (keys.length !== 1) return null;
  const k = keys[0];
  if (k === 'slides') {
    const a = before.slides;
    const b = after.slides;
    if (a.length !== b.length) return null;
    let at = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id) return null;
      if (a[i] !== b[i]) {
        if (at >= 0) return null;
        at = i;
      }
    }
    if (at < 0) return null;
    const fields = changedFields(a[at], b[at]);
    if (!fields.length || fields.includes('kind') || fields.includes('id')) return null;
    return `slide:${a[at].id}:${fields.join(',')}`;
  }
  if (k === 'meta' || k === 'brand') {
    const fields = changedFields(before[k] ?? {}, after[k] ?? {});
    return fields.length ? `${k}:${fields.join(',')}` : k;
  }
  return k;
}

/** The history after a change the person made, from `before` to `after`, at time `at`. */
export function recorded(h: History, before: Tracked, after: Tracked, at: number, alone = false): History {
  if (sameSnapshot(before, after)) return h;
  // Something else changed the deck since our last step: what came before it is not ours to give back.
  const fresh = h.seen !== null && !sameSnapshot(before, h.seen);
  const group = alone ? null : groupOf(before, after);
  const past = fresh ? [] : h.past;
  const join = !fresh && group !== null && group === h.group && at - h.at <= COALESCE_MS && past.length > 0;
  return {
    past: join ? past : [...past, before].slice(-HISTORY_CAP),
    future: [],
    seen: after,
    group,
    at,
  };
}

function stale(h: History, current: Tracked): boolean {
  return h.seen !== null && !sameSnapshot(current, h.seen);
}

export const canUndo = (h: History, current: Tracked) => h.past.length > 0 && !stale(h, current);
export const canRedo = (h: History, current: Tracked) => h.future.length > 0 && !stale(h, current);

/** One step back: the snapshot to put back, or `null` — also when the deck changed under the history, which is then dropped. */
export function undone(h: History, current: Tracked): { history: History; snapshot: Tracked | null } {
  if (stale(h, current)) return { history: emptyHistory(), snapshot: null };
  if (!h.past.length) return { history: h, snapshot: null };
  const snapshot = h.past[h.past.length - 1];
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, snapshotOf(current)].slice(-HISTORY_CAP), seen: snapshot, group: null, at: 0 },
    snapshot,
  };
}

/** One step forward again, after an undo. */
export function redone(h: History, current: Tracked): { history: History; snapshot: Tracked | null } {
  if (stale(h, current)) return { history: emptyHistory(), snapshot: null };
  if (!h.future.length) return { history: h, snapshot: null };
  const snapshot = h.future[h.future.length - 1];
  return {
    history: { past: [...h.past, snapshotOf(current)].slice(-HISTORY_CAP), future: h.future.slice(0, -1), seen: snapshot, group: null, at: 0 },
    snapshot,
  };
}

// ── every deck's history, this session ────────────────────────────────────

const books = new Map<string, History>();
const book = (id: string) => books.get(id) ?? emptyHistory();

/** The histories the panel keeps, one a deck, for this session only. */
export const deckHistory = {
  /** A change the person made. `alone` makes it its own step, never joined to typing: a chat message. */
  record(id: string, before: Tracked, after: Tracked, alone = false, at = Date.now()): void {
    books.set(id, recorded(book(id), snapshotOf(before), snapshotOf(after), at, alone));
  },
  undo(id: string, current: Tracked): Tracked | null {
    const r = undone(book(id), snapshotOf(current));
    books.set(id, r.history);
    return r.snapshot;
  },
  redo(id: string, current: Tracked): Tracked | null {
    const r = redone(book(id), snapshotOf(current));
    books.set(id, r.history);
    return r.snapshot;
  },
  canUndo: (id: string, current: Tracked) => canUndo(book(id), snapshotOf(current)),
  canRedo: (id: string, current: Tracked) => canRedo(book(id), snapshotOf(current)),
  /** Drop a deck's history — it was deleted. */
  forget(id: string): void {
    books.delete(id);
  },
};
