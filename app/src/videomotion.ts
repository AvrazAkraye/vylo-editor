import type { Motion } from './motiontypes';
import type { MotionScene, Scene, Video, VideoMotion } from './videotypes';
import { readMotion, readTitle } from './motionread';

/**
 * A film that holds graphics from the Motion studio (docs/VM.md, package
 * `video`): placing one, reading a held one back, keeping one copy of each,
 * knowing when the saved graphic is newer, the graphic's own clock inside a
 * scene, and letting go of graphics nothing uses. Pure — every function takes
 * a film and gives a new one or a value — so every rule is tested without a
 * browser (`test/vm-video.test.mjs`); the Remotion views are
 * VideoMotionView.tsx and the list to choose from is VideoMotionPicker.tsx.
 *
 * ## Copied, like a clip
 *
 * A film is self-contained. A graphic is copied into `Video.motions` when the
 * person places it, the way a clip's bytes are kept in `Video.clips`, so the
 * film renders without the Motion store and without the network, and editing
 * or deleting the graphic in Motion later does not change a film already made.
 * `from` and `stamp` remember which saved graphic it was and as of when: the
 * storyboard offers "Update from Motion" when the saved one is newer
 * (`newerSaved`), and placing the same unchanged graphic twice holds it once
 * (`heldCopyOf`).
 *
 * ## Read every time
 *
 * A film read from storage is input, like a model's answer: a hand-edited
 * file or an older build may hold anything. `readVideoMotions` reads every
 * held graphic again through Motion's own reader (`readMotion`), caps how
 * many a film holds and how large each may be, and drops a scene — or takes
 * off an overlay — whose graphic is not held, as a clip scene whose clip is
 * gone is dropped. The views read through `heldDoc` too, so a graphic no
 * reader has seen never reaches `paint`.
 *
 * ## Letting go, and undo
 *
 * Undo (videohistory.ts) gives back the film's tracked fields, and
 * `Video.motions` is not one of them. A graphic let go of the moment its last
 * scene is removed would be missing when an undo brings that scene back. So a
 * graphic nothing uses is let go when the film is next read
 * (`readVideoMotions`, once a session, before any undo history exists) — and,
 * during a session, only to make room when a film already holds `MAX_HELD`
 * (`hold`). An unused graphic costs storage until then, never a frame: nothing
 * draws it.
 *
 * ## The model
 *
 * The model is never sent a held graphic's layers: a scene names its graphic
 * by id, and that is all the storyboard JSON it reads carries.
 */

/** How many graphics one film may hold. */
export const MAX_HELD = 12;

/**
 * The largest graphic a film takes, in characters of its JSON: a lower third
 * or a title is a few kilobytes, and a graphic with a photograph in it a few
 * hundred. Past this it is a film of pictures, which a film should hold as
 * pictures, and every save of the film would write it again.
 */
export const MAX_GRAPHIC_CHARS = 1_500_000;

/**
 * Entries of a stored `motions` list the reader looks at, at most. The list is
 * indexed by id before anything is read, so a hostile film of thousands of
 * entries costs a pass over this many and never a read of each.
 */
const SCAN = 10_000;

/** What a scene may last, in seconds: video.ts's `SCENE_SECONDS`, kept here so this file needs nothing of the planner's. */
const SCENE_MIN = 2;
const SCENE_MAX = 20;

/** Why a graphic was not placed: the film holds as many as it may, the graphic is too large, or it is not a graphic. */
export type Refusal = 'full' | 'big' | 'unreadable';

const tenths = (n: number) => Math.round(n * 10) / 10;
const finite = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** An id a film may use for a held graphic: a short string with nothing invisible in it. */
function idOk(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0 && x.length <= 64 && /^[A-Za-z0-9_-]+$/.test(x);
}

/**
 * The held graphics of a film, as a list of objects whatever was stored: a film that has not been through
 * `readVideoMotions` yet (one the store has not read again) may hold anything there, and every function
 * here must refuse rather than throw on it.
 */
function heldList(v: Pick<Video, 'motions'> | null | undefined): VideoMotion[] {
  const m = v?.motions;
  return Array.isArray(m) ? m.filter(isObj) as unknown as VideoMotion[] : [];
}

/** The graphic a film holds under `id`. */
export function heldIn(v: Pick<Video, 'motions'> | null | undefined, id: unknown): VideoMotion | undefined {
  if (!idOk(id)) return undefined;
  return heldList(v).find((m) => isObj(m) && m.id === id);
}

/**
 * The copy a film already holds of a saved graphic as it is now — the same
 * Motion id, the same `updated` — so placing it a second time holds it once.
 * A graphic changed in Motion since is another copy: the old one stays as the
 * film's scenes have it until the person asks for the new one ("Update").
 */
export function heldCopyOf(v: Pick<Video, 'motions'> | null | undefined, doc: Pick<Motion, 'id' | 'updated'>): VideoMotion | undefined {
  return heldList(v).find((m) => isObj(m) && m.from === doc.id && m.stamp === doc.updated);
}

/** A graphic's size as its JSON's length; `Infinity` for one that cannot be written (a cycle, a getter that throws). */
export function graphicChars(doc: unknown): number {
  try {
    const s = JSON.stringify(doc);
    return typeof s === 'string' ? s.length : Infinity;
  } catch {
    return Infinity;
  }
}

/** The ids the film's scenes play and lay on top, scene by scene. */
export function motionsInUse(v: Pick<Video, 'scenes'> | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const s of Array.isArray(v?.scenes) ? v.scenes : []) {
    if (!isObj(s)) continue;
    if (s.kind === 'motion' && typeof s.motion === 'string') out.add(s.motion);
    if (isObj(s.over) && typeof s.over.motion === 'string') out.add(s.over.motion);
  }
  return out;
}

/**
 * The film without the graphics nothing plays or lays on top — the same film
 * when it uses every one. Not called when the person removes a scene (undo
 * would bring back a scene whose graphic was gone; see the header): it is how
 * the reader lets go, and how `hold` makes room.
 */
export function pruneMotions<V extends Pick<Video, 'scenes' | 'motions'>>(v: V): V {
  const list = heldList(v);
  if (!list.length) return v;
  const used = motionsInUse(v);
  const kept = list.filter((m) => isObj(m) && used.has(m.id));
  if (kept.length === list.length) return v;
  return { ...v, motions: kept.length ? kept : undefined };
}

/** A fresh id that no held graphic has: twelve hex digits, like every other id the Video module makes. */
export function freshId(taken: ReadonlySet<string> = new Set()): string {
  for (;;) {
    const bytes = new Uint8Array(6);
    try {
      crypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (!taken.has(id)) return id;
  }
}

/** A graphic as a film holds it: read again, so what the film keeps is exactly what Motion's reader accepts. */
function copyOf(doc: unknown, id: string): VideoMotion | Refusal {
  const read = readMotion(doc, isObj(doc) ? finite(doc.updated, 0) : 0);
  if (!read) return 'unreadable';
  if (graphicChars(read) > MAX_GRAPHIC_CHARS) return 'big';
  return { id, from: read.id, stamp: read.updated, title: read.title, doc: read };
}

/**
 * The film's held graphics with `doc` among them, and the id it goes by —
 * or why it was not placed. The same saved graphic, unchanged, is held once
 * (`heldCopyOf`). A film that holds `MAX_HELD` first lets go of graphics no
 * scene uses any more (removed this session; see the header), and refuses
 * only when every one it holds is in use.
 */
export function hold(
  v: Pick<Video, 'scenes' | 'motions'>,
  doc: Motion,
  newId: (taken: ReadonlySet<string>) => string = freshId,
): { motions: VideoMotion[]; id: string } | { refused: Refusal } {
  const list = heldList(v);
  const same = isObj(doc) ? heldCopyOf(v, doc) : undefined;
  if (same) return { motions: list, id: same.id };
  let room = list;
  if (room.length >= MAX_HELD) room = heldList(pruneMotions(v));
  if (room.length >= MAX_HELD) return { refused: 'full' };
  const taken = new Set(room.map((m) => m.id));
  const copy = copyOf(doc, newId(taken));
  if (typeof copy === 'string') return { refused: copy };
  return { motions: [...room, copy], id: copy.id };
}

/** How long a scene that plays a graphic starts out: the graphic's own length, inside what a scene may last. */
export function sceneSecondsFor(doc: Pick<Motion, 'seconds'> | null | undefined): number {
  const s = finite(doc?.seconds, SCENE_MIN);
  return tenths(Math.min(SCENE_MAX, Math.max(SCENE_MIN, s)));
}

/**
 * Where a scene the person adds goes: before the close, which should stay
 * last — VideoPanel.tsx's rule for every scene added by hand.
 */
function insertAt(scenes: readonly Scene[]): number {
  return scenes.length && scenes[scenes.length - 1].kind === 'outro' ? scenes.length - 1 : scenes.length;
}

/** What the storyboard hands up for a film that now holds a graphic: its held graphics and its scenes, one step. */
export interface MotionPatch { motions: VideoMotion[]; scenes: Scene[] }

/**
 * Add scene → Motion graphic: a new scene that plays `doc`, as long as the
 * graphic, before the close; the graphic held (once). `sceneId` is the new
 * scene's, for the storyboard to open it.
 */
export function addMotionScene(
  v: Pick<Video, 'scenes' | 'motions'>,
  doc: Motion,
  newId: (taken: ReadonlySet<string>) => string = freshId,
): { patch: MotionPatch; sceneId: string } | { refused: Refusal } {
  const held = hold(v, doc, newId);
  if ('refused' in held) return held;
  const scenes = Array.isArray(v.scenes) ? [...v.scenes] : [];
  const sceneId = newId(new Set(scenes.map((s) => s.id)));
  const scene: MotionScene = {
    id: sceneId, kind: 'motion', motion: held.id, seconds: sceneSecondsFor(heldIn(held, held.id)?.doc), transition: 'fade',
  };
  scenes.splice(insertAt(scenes), 0, scene);
  return { patch: { motions: held.motions, scenes }, sceneId };
}

/**
 * Change: the motion scene `sceneId` plays `doc` instead, and lasts as long as
 * it. The graphic it played stays held until the film is next read, in case an
 * undo puts it back.
 */
export function changeSceneMotion(
  v: Pick<Video, 'scenes' | 'motions'>,
  sceneId: string,
  doc: Motion,
  newId: (taken: ReadonlySet<string>) => string = freshId,
): { patch: MotionPatch } | { refused: Refusal } {
  const held = hold(v, doc, newId);
  if ('refused' in held) return held;
  const seconds = sceneSecondsFor(heldIn(held, held.id)?.doc);
  const scenes = (v.scenes ?? []).map((s) => (s.id === sceneId && s.kind === 'motion' ? { ...s, motion: held.id, seconds } : s));
  return { patch: { motions: held.motions, scenes } };
}

/** When a graphic on top starts, in seconds into its scene: a tenth of a second at a time, inside the scene. */
export function overAt(at: unknown, sceneSeconds?: number): number {
  const top = Math.max(0, finite(sceneSeconds, SCENE_MAX) - 0.5);
  return tenths(Math.min(top, Math.max(0, finite(at, 0))));
}

/**
 * Graphic on top → Add or Change: `doc` laid over scene `sceneId` from `at`
 * seconds into it (the overlay's own start, when it had one and none is
 * given). Any scene but a motion scene, which is a graphic already.
 */
export function setOver(
  v: Pick<Video, 'scenes' | 'motions'>,
  sceneId: string,
  doc: Motion,
  at?: number,
  newId: (taken: ReadonlySet<string>) => string = freshId,
): { patch: MotionPatch } | { refused: Refusal } {
  const held = hold(v, doc, newId);
  if ('refused' in held) return held;
  const scenes = (v.scenes ?? []).map((s) => {
    if (s.id !== sceneId || s.kind === 'motion') return s;
    return { ...s, over: { motion: held.id, at: overAt(at ?? s.over?.at, s.seconds) } } as Scene;
  });
  return { patch: { motions: held.motions, scenes } };
}

/** Graphic on top → Remove: the scene without it. Its graphic stays held until the film is next read. */
export function clearOver(scenes: readonly Scene[], sceneId: string): Scene[] {
  return scenes.map((s) => {
    if (s.id !== sceneId || !s.over) return s;
    const { over: _over, ...rest } = s;
    return rest as Scene;
  });
}

/**
 * The saved graphic that is newer than a held copy of it — what "Update from
 * Motion" would bring in — or `undefined` when the copy is current, the
 * graphic was deleted, or the copy was not from Motion's store at all.
 */
export function newerSaved(held: VideoMotion | undefined, saved: readonly Motion[]): Motion | undefined {
  if (!held || typeof held.from !== 'string') return undefined;
  const stamp = finite(held.stamp, 0);
  return saved.find((m) => m && m.id === held.from && finite(m.updated, 0) > stamp);
}

/**
 * Update from Motion: the held graphic `heldId` replaced, in place, by the
 * saved one — so every scene and overlay that names it plays the new one, and
 * their ids and places do not move.
 */
export function updateHeld(
  v: Pick<Video, 'motions'>,
  heldId: string,
  doc: Motion,
): { motions: VideoMotion[] } | { refused: Refusal } {
  const list = heldList(v);
  const at = list.findIndex((m) => isObj(m) && m.id === heldId);
  if (at < 0) return { refused: 'unreadable' };
  const copy = copyOf(doc, heldId);
  if (typeof copy === 'string') return { refused: copy };
  return { motions: list.map((m, i) => (i === at ? copy : m)) };
}

// ── the clock ─────────────────────────────────────────────────────────────

/** The moment a graphic's last frame is drawn at: a layer that runs to the end is not drawn *at* the end. */
function lastMoment(doc: Pick<Motion, 'seconds' | 'fps'>): number {
  const len = finite(doc.seconds, 0);
  const fps = finite(doc.fps, 30) > 0 ? finite(doc.fps, 30) : 30;
  return Math.max(0, len - 1 / fps);
}

/**
 * Seconds into the graphic a motion scene shows at its own `frame`: the
 * graphic's time from the scene's start — the scene's own clock, not the
 * look's pace, which is the film's words' rhythm and not the graphic's.
 * Past the graphic's end the last frame holds; with `loop` it plays again
 * from its start. A graphic of no length shows its first frame.
 */
export function sceneTime(frame: number, fps: number, doc: Pick<Motion, 'seconds' | 'fps'>, loop = false): number {
  const rate = finite(fps, 30) > 0 ? finite(fps, 30) : 30;
  const t = Math.max(0, finite(frame, 0)) / rate;
  const len = finite(doc.seconds, 0);
  if (!(len > 0)) return 0;
  if (loop) return t % len;
  return Math.min(t, lastMoment(doc));
}

/**
 * Seconds into the graphic a graphic on top shows at its scene's `frame`, or
 * `null` when it is not on: before `at`, and once it has played — it plays
 * once. Not held at its last frame after it: a graphic with a solid ground
 * would otherwise cover the rest of the scene.
 */
export function overTime(frame: number, fps: number, at: number | undefined, doc: Pick<Motion, 'seconds'>): number | null {
  const rate = finite(fps, 30) > 0 ? finite(fps, 30) : 30;
  const t = Math.max(0, finite(frame, 0)) / rate - Math.max(0, finite(at, 0));
  const len = finite(doc.seconds, 0);
  return t >= 0 && t < len ? t : null;
}

// ── reading ───────────────────────────────────────────────────────────────

/** A held graphic from a stored film, read: its doc through `readMotion`, its words capped; `null` when it is not one. */
function readHeld(x: unknown): VideoMotion | null {
  if (!isObj(x) || !idOk(x.id)) return null;
  const stamp = finite(x.stamp, -1);
  const doc = readMotion(x.doc, stamp >= 0 ? stamp : 0);
  if (!doc || graphicChars(doc) > MAX_GRAPHIC_CHARS) return null;
  const out: VideoMotion = { id: x.id, title: typeof x.title === 'string' ? readTitle(x.title) : doc.title, doc };
  if (typeof x.from === 'string' && x.from.length <= 128 && x.from.trim()) out.from = x.from;
  if (stamp >= 0) out.stamp = stamp;
  return out;
}

/** A graphic on top as stored, read against what the film holds; `undefined` when it names nothing held. */
export function readOver(raw: unknown, held: ReadonlySet<string>, sceneSeconds?: number): { motion: string; at?: number } | undefined {
  if (!isObj(raw) || !idOk(raw.motion) || !held.has(raw.motion)) return undefined;
  const at = overAt(raw.at, sceneSeconds);
  return at > 0 ? { motion: raw.motion, at } : { motion: raw.motion };
}

/**
 * A film read from storage, its graphics read again — the reader for
 * `Video.motions` (see the header). In order:
 *
 * 1. The stored list is indexed by id (the first entry of an id wins), over
 *    at most `SCAN` entries, without reading any.
 * 2. The graphics the scenes use are read, in the order the film first uses
 *    them, through `readMotion`, at most `MAX_HELD` kept and at most three
 *    times that many tried; one larger than `MAX_GRAPHIC_CHARS` is not kept.
 *    A graphic no scene uses is not kept either: this is where it is let go.
 * 3. A motion scene whose graphic is not kept is dropped; an overlay whose
 *    graphic is not kept is taken off its scene, and a motion scene has none.
 *    `loop` is kept only as `true`.
 *
 * A film with no held graphics, no motion scene and no overlay is returned as
 * it was.
 */
export function readVideoMotions<V extends Video>(v: V): V {
  if (!isObj(v) || !Array.isArray(v.scenes)) return v;
  const raw = (v as { motions?: unknown }).motions;
  const scenes = v.scenes;
  const touches = (s: unknown) => isObj(s) && (s.kind === 'motion' || s.over !== undefined);
  if (raw === undefined && !scenes.some(touches)) return v;

  const byId = new Map<string, unknown>();
  if (Array.isArray(raw)) {
    for (const x of raw.slice(0, SCAN)) {
      if (isObj(x) && idOk(x.id) && !byId.has(x.id)) byId.set(x.id, x);
    }
  }
  const wanted: string[] = [];
  for (const s of scenes) {
    if (!isObj(s)) continue;
    if (s.kind === 'motion' && idOk(s.motion)) wanted.push(s.motion);
    if (isObj(s.over) && idOk(s.over.motion)) wanted.push(s.over.motion);
  }
  const kept: VideoMotion[] = [];
  const ids = new Set<string>();
  let tried = 0;
  for (const id of wanted) {
    if (kept.length >= MAX_HELD || tried >= MAX_HELD * 3) break;
    if (ids.has(id) || !byId.has(id)) continue;
    tried++;
    const m = readHeld(byId.get(id));
    if (m) {
      kept.push(m);
      ids.add(id);
    }
  }

  const out: Scene[] = [];
  for (const s of scenes) {
    if (!isObj(s)) {
      out.push(s);
      continue;
    }
    let next = s as Scene;
    if (next.kind === 'motion') {
      if (!idOk(next.motion) || !ids.has(next.motion)) continue;
      // A scene that is a graphic has none on top: nothing would draw it.
      const { loop, over: _over, ...rest } = next;
      next = loop === true ? { ...rest, loop: true } : rest;
    }
    if (next.over !== undefined) {
      const over = readOver(next.over, ids, finite(next.seconds, SCENE_MAX));
      const { over: _old, ...rest } = next;
      next = (over ? { ...rest, over } : rest) as Scene;
    }
    out.push(next);
  }
  const film = { ...v, scenes: out };
  if (kept.length) film.motions = kept;
  else delete film.motions;
  return film;
}

/**
 * Held graphics already read for drawing, by the held object: a film is drawn
 * thirty times a second, and its held graphics change only when the person
 * places or updates one, so each is read once.
 */
const readDocs = new WeakMap<object, Motion | null>();

/**
 * The graphic a held entry draws, read — the views' one way to a held
 * graphic, so a doc no reader has seen (a film from before the store read it,
 * a hand-edited record) never reaches `paint`. `null` when it is not one.
 */
export function heldDoc(held: VideoMotion | undefined | null): Motion | null {
  if (!isObj(held)) return null;
  if (readDocs.has(held)) return readDocs.get(held) ?? null;
  const m = readHeld(held);
  const doc = m ? m.doc : null;
  readDocs.set(held, doc);
  return doc;
}
