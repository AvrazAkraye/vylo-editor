import type { Motion } from './motiontypes';

/**
 * Undo and redo for a motion graphic: pure functions over a small value the
 * panel keeps beside the document, on the same ideas as videohistory.ts.
 *
 * ## What a step is
 *
 * Everything the person edits — the layers, their words and colours, the
 * palette, the shape, the length, the language, the title. Not `updated` (the
 * clock), `stage` (whether the model is at work) or `error` (what its last run
 * said): those describe a moment, not the graphic, so undo neither compares
 * them nor gives them back.
 *
 * Typing is one step, not one a letter: an edit with the same `key` as the
 * last (`layer:<id>:text`, `palette:accent`) less than `COALESCE_MS` after it
 * joins that step — and so does a drag, which is a hundred small moves of one
 * layer. An edit with no key is always a step of its own, and so is anything
 * that adds, removes or reorders layers, whatever key it carries: a layer
 * deleted by mistake comes back with one undo, and never takes the typing
 * before it along. A new edit clears what could have been redone.
 *
 * ## Never across a model run
 *
 * The history knows the document as its last step left it (`present`). When
 * the document is not that any more — the model designed it again, a template
 * replaced it, a stored copy was opened: anything but the person changed it —
 * the steps before it are not the person's to take back. `synced` starts the
 * history again from the document as it is, and `undone`, `redone`, `canUndo`
 * and `canRedo` do the same when given the current document. An undo never
 * puts back a graphic the model has since replaced. `recorded` trusts
 * `present`, so the panel records onto a synced history:
 * `recorded(synced(h, doc), next, Date.now(), key)`.
 *
 * ## Snapshots are the documents themselves
 *
 * Every edit makes a new document and never changes an old one, so a
 * snapshot is the document value itself, not a copy: an unchanged layer is
 * the same object in every step, and a picture's data: URL is held once
 * however many steps mention it. Nothing here mutates a document or a
 * history.
 */

/** Edits with the same key less than this apart are one step — typing, a drag, a slider held and moved — so an undo takes back a change, not a letter. */
export const COALESCE_MS = 1500;
/** Steps kept each way. A bound, because each step holds its own list of layers (pictures are shared, so a step is small but not free). */
export const HISTORY_CAP = 100;

/**
 * What the panel keeps beside a graphic, one per graphic. A value that is
 * never changed in place, so the panel can hold it in React state and tell a
 * change by identity.
 */
export interface MotionHistory {
  /** Earlier documents, oldest first: the last is what one undo gives back. */
  past: Motion[];
  /** The document as the last step left it. Anything else means something other than the person changed it. */
  present: Motion;
  /** Documents undone, the next redo last. */
  future: Motion[];
  /** What the last step changed, for joining the next edit to it; null after an undo, a redo or an edit with no key. */
  key: string | null;
  /** When the last step was taken, in ms. */
  at: number;
}

/** A history with nothing to undo, starting from `m`. */
export function emptyHistory(m: Motion): MotionHistory {
  return { past: [], present: m, future: [], key: null, at: 0 };
}

/**
 * A document as a step keeps it: the document itself, shared rather than
 * copied, without the last run's `error` — a message about a moment that has
 * passed, which an undo must never bring back.
 */
export function snapshotOf(m: Motion): Motion {
  if (m.error === undefined) return m;
  const s = { ...m };
  delete s.error;
  return s;
}

/** The fields that belong to a moment rather than to the graphic. */
const UNTRACKED: ReadonlySet<string> = new Set(['updated', 'stage', 'error']);

/**
 * Deep equality for documents: identity first (an unchanged layer is the same
 * object), then field by field. A field set to `undefined` is a field that is
 * not there. Deeper than any document goes means different — a cycle cannot
 * come from `readMotion`, but it must not overflow the stack either.
 */
function equal(a: unknown, b: unknown, depth: number): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (depth > 32 || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const y = b as unknown[];
    if (a.length !== y.length) return false;
    for (let i = 0; i < a.length; i++) if (!equal(a[i], y[i], depth + 1)) return false;
    return true;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const kx = Object.keys(x).filter((k) => x[k] !== undefined);
  const ky = Object.keys(y).filter((k) => y[k] !== undefined);
  if (kx.length !== ky.length) return false;
  for (const k of kx) {
    if (!Object.prototype.hasOwnProperty.call(y, k) || !equal(x[k], y[k], depth + 1)) return false;
  }
  return true;
}

/**
 * The same graphic as the person sees it: equal in every field they edit,
 * whatever `updated`, `stage` and `error` say. Saving (which stamps
 * `updated`) and a model starting to work are not edits.
 */
export function sameSnapshot(a: Motion, b: Motion): boolean {
  if (a === b) return true;
  const x = a as unknown as Record<string, unknown>;
  const y = b as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (!UNTRACKED.has(k) && !equal(x[k], y[k], 0)) return false;
  return true;
}

/** The same layers in the same order: an edit that adds, removes or moves one is never joined to the last. */
function sameOrder(a: Motion['layers'], b: Motion['layers']): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]?.id !== b[i]?.id) return false;
  return true;
}

/** A step's document put back with the moment's own fields — the clock, the stage, the last run's error — as they are now. */
function restored(s: Motion, now: Motion): Motion {
  const out: Motion = { ...s, updated: now.updated, stage: now.stage };
  if (now.error !== undefined) out.error = now.error;
  else delete out.error;
  return out;
}

/**
 * The history for the document as it is now. When `current` is the history's
 * `present` as the person sees it, the history goes on (holding `current`,
 * whose clock may have moved); otherwise something other than the person
 * changed the graphic, and the history starts again from it.
 */
export function synced(h: MotionHistory, current: Motion): MotionHistory {
  if (current === h.present) return h;
  return sameSnapshot(h.present, current) ? { ...h, present: current } : emptyHistory(current);
}

/**
 * The history after the person changed the document from `present` to
 * `next` at `now` (ms). `key` names what the edit touched; the same key
 * within `COALESCE_MS` of the last edit, with the layers still the same ones
 * in the same order, joins that step. An edit that changes nothing the person
 * sees is not a step.
 */
export function recorded(h: MotionHistory, next: Motion, now: number, key?: string): MotionHistory {
  if (sameSnapshot(h.present, next)) return next === h.present ? h : { ...h, present: next };
  const k = typeof key === 'string' && key !== '' ? key : null;
  const join = k !== null && k === h.key && h.past.length > 0 && now >= h.at && now - h.at <= COALESCE_MS
    && sameOrder(h.present.layers, next.layers);
  return {
    past: join ? h.past : [...h.past, snapshotOf(h.present)].slice(-HISTORY_CAP),
    present: next,
    future: [],
    key: k,
    at: now,
  };
}

/**
 * One step back: the history whose `present` is the document to show — the
 * same history when there is nothing to undo. Given `current`, a document
 * changed by anything but the person first starts the history again, so
 * there is then nothing to undo.
 */
export function undone(h: MotionHistory, current?: Motion): MotionHistory {
  const s = current ? synced(h, current) : h;
  if (!s.past.length) return s;
  return {
    past: s.past.slice(0, -1),
    present: restored(s.past[s.past.length - 1], s.present),
    future: [...s.future, snapshotOf(s.present)].slice(-HISTORY_CAP),
    key: null,
    at: 0,
  };
}

/** One step forward again, after an undo; as `undone`, the other way. */
export function redone(h: MotionHistory, current?: Motion): MotionHistory {
  const s = current ? synced(h, current) : h;
  if (!s.future.length) return s;
  return {
    past: [...s.past, snapshotOf(s.present)].slice(-HISTORY_CAP),
    present: restored(s.future[s.future.length - 1], s.present),
    future: s.future.slice(0, -1),
    key: null,
    at: 0,
  };
}

/** Whether there is a step to undo — none when `current` was changed by anything but the person. */
export function canUndo(h: MotionHistory, current?: Motion): boolean {
  return (current ? synced(h, current) : h).past.length > 0;
}

/** Whether there is a step to redo, on the same terms. */
export function canRedo(h: MotionHistory, current?: Motion): boolean {
  return (current ? synced(h, current) : h).future.length > 0;
}
