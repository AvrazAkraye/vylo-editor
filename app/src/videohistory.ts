import type { Scene, Video } from './videotypes';
import { TRANSITION_FRAMES, sceneFrames } from './video';

/**
 * Undo and redo for the Video module, and the hand edits the timeline makes.
 *
 * ## What is remembered
 *
 * The parts of a video a person changes by hand — the scenes, the brand, the
 * style, the shape, the title, the credits card. Not the sound, the facts or
 * the model's settings: those have their own tabs and their own ways back.
 *
 * Typing is one step, not one step a letter. A change is given a *group* from
 * what it touched (`scene:<id>:title`, `brand:name`, `style`), and a change in
 * the same group less than `COALESCE_MS` after the last one joins it. A new
 * scene, a scene removed, a move — anything that changes which scenes there
 * are or their order — is always a step of its own.
 *
 * ## Never across a model run
 *
 * The history keeps what the video looked like after its last step (`seen`).
 * When the video is not that any more — a storyboard planned, a scene written
 * again, a picture fetched: anything the app did rather than the person —
 * the history before it is dropped. Undo never puts back a storyboard the
 * model has since replaced, and never takes away a picture it just fetched;
 * it starts again from what the run left.
 *
 * Snapshots are the video's own objects, not copies: every change in the panel
 * makes new arrays and objects rather than editing old ones, so an old scene
 * list is still exactly what it was, and a picture's data URL is held once
 * however many steps mention it.
 */

// ── snapshots ─────────────────────────────────────────────────────────────

/** The fields undo gives back. */
export const TRACKED = ['scenes', 'brand', 'style', 'format', 'title', 'credits'] as const;
export type Tracked = Pick<Video, (typeof TRACKED)[number]>;

/** Typing in one field within this long of the last keystroke is the same step. */
export const COALESCE_MS = 800;
/** Steps kept a video. */
export const HISTORY_CAP = 100;

export interface History {
  past: Tracked[];
  future: Tracked[];
  /** The video as the last step left it; anything else means something other than the person changed it. */
  seen: Tracked | null;
  /** What the last step changed, for joining typing into one step. */
  group: string | null;
  /** When the last step was taken (ms). */
  at: number;
}

export const emptyHistory = (): History => ({ past: [], future: [], seen: null, group: null, at: 0 });

export function snapshotOf(v: Tracked): Tracked {
  return { scenes: v.scenes, brand: v.brand, style: v.style, format: v.format, title: v.title, credits: v.credits };
}

/** The same video, field by field — by identity, which is what an unchanged field keeps. */
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
 * scene's own fields with every scene still in its place. `null` for anything
 * that is a step by itself.
 */
export function groupOf(before: Tracked, after: Tracked): string | null {
  const keys = TRACKED.filter((k) => before[k] !== after[k]);
  if (keys.length !== 1) return null;
  const k = keys[0];
  if (k === 'scenes') {
    const a = before.scenes;
    const b = after.scenes;
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
    return `scene:${a[at].id}:${fields.join(',')}`;
  }
  if (k === 'brand') {
    const fields = changedFields(before.brand ?? {}, after.brand ?? {});
    return fields.length ? `brand:${fields.join(',')}` : 'brand';
  }
  return k;
}

/** The history after a change the person made, from `before` to `after`, at time `at`. */
export function recorded(h: History, before: Tracked, after: Tracked, at: number): History {
  if (sameSnapshot(before, after)) return h;
  // Something else changed the video since our last step: what came before it is not ours to give back.
  const fresh = h.seen !== null && !sameSnapshot(before, h.seen);
  const group = groupOf(before, after);
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

/**
 * One step back: the snapshot to put back, or `null` when there is none — or
 * when the video changed under the history, which is then dropped.
 */
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

// ── every video's history, this session ───────────────────────────────────

const books = new Map<string, History>();
const book = (id: string) => books.get(id) ?? emptyHistory();

/**
 * The histories the panel keeps, one a video, for this session only — an
 * undo that survived a restart would be undoing into a video the person no
 * longer remembers.
 */
export const videoHistory = {
  /** A change the person made. Call it with the video before and after. */
  record(id: string, before: Tracked, after: Tracked, at = Date.now()): void {
    books.set(id, recorded(book(id), snapshotOf(before), snapshotOf(after), at));
  },
  /** The fields to put back for one step back, or `null`. */
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
  /** Drop a video's history — it was deleted. */
  forget(id: string): void {
    books.delete(id);
  },
};

// ── the storyboard, edited by hand ────────────────────────────────────────

/** What one scene may last, and the step the timeline changes it by — the storyboard's own limits. */
export const SCENE_MIN = 2;
export const SCENE_MAX = 20;
export const SCENE_STEP = 0.5;

/** A length in seconds, on the half second, within what a scene may last. */
export function snapSeconds(n: number): number {
  if (!Number.isFinite(n)) return SCENE_MIN;
  return Math.min(SCENE_MAX, Math.max(SCENE_MIN, Math.round(n / SCENE_STEP) * SCENE_STEP));
}

/** The scenes with the one at `from` put at `to` (its index afterwards). */
export function moveScene(scenes: Scene[], from: number, to: number): Scene[] {
  if (from < 0 || from >= scenes.length) return scenes;
  const at = Math.min(scenes.length - 1, Math.max(0, to));
  if (at === from) return scenes;
  const next = [...scenes];
  const [s] = next.splice(from, 1);
  next.splice(at, 0, s);
  return next;
}

/**
 * The scene at `index` twice, the copy straight after it with an id of its
 * own. The fields are shared rather than copied: nothing edits a scene's
 * arrays in place, and a copied picture would be the same megabytes twice.
 */
export function duplicateScene(scenes: Scene[], index: number, newId: () => string): Scene[] {
  const s = scenes[index];
  if (!s) return scenes;
  const next = [...scenes];
  next.splice(index + 1, 0, { ...s, id: newId() });
  return next;
}

/** The scenes without the one at `index` — never the last one left. */
export function removeScene(scenes: Scene[], index: number): Scene[] {
  if (scenes.length <= 1 || index < 0 || index >= scenes.length) return scenes;
  return scenes.filter((_, i) => i !== index);
}

/** The scene at `index` lasting `seconds`, snapped. The same list when nothing changes. */
export function resizeScene(scenes: Scene[], index: number, seconds: number): Scene[] {
  const s = scenes[index];
  if (!s) return scenes;
  const n = snapSeconds(seconds);
  if (n === s.seconds) return scenes;
  return scenes.map((x, i) => (i === index ? { ...x, seconds: n } : x));
}

/** Where a scene sits in the film, in frames. */
export interface Slot {
  start: number;
  frames: number;
  /** The scene before hands over to this one by overlapping it. */
  into: boolean;
  /** This scene hands over to the next by overlapping it. */
  out: boolean;
}

/** Every scene's place in the film, transitions overlapped — the composition's own arithmetic. */
export function slotsOf(scenes: Scene[]): Slot[] {
  const out: Slot[] = [];
  let at = 0;
  scenes.forEach((s, i) => {
    const frames = sceneFrames(s);
    const overlaps = i < scenes.length - 1 && s.transition !== 'none';
    out.push({ start: at, frames, into: i > 0 && scenes[i - 1].transition !== 'none', out: overlaps });
    at += frames - (overlaps ? TRANSITION_FRAMES : 0);
  });
  return out;
}

/** The scene on screen at `frame`: during a transition, the one arriving. */
export function sceneAtFrame(scenes: Scene[], frame: number): number {
  const slots = slotsOf(scenes);
  let at = 0;
  for (let i = 0; i < slots.length; i++) if (slots[i].start <= frame) at = i;
  return at;
}

/**
 * Where a scene dragged along the timeline lands, as its index afterwards:
 * before the first other scene whose middle is past the point it is held at.
 */
export function dropIndexOf(scenes: Scene[], from: number, frame: number): number {
  const slots = slotsOf(scenes);
  let to = 0;
  slots.forEach((s, i) => {
    if (i !== from && s.start + s.frames / 2 < frame) to += 1;
  });
  return to;
}
