import type { Anim, Ctx, Layer, Motion } from './motiontypes';
import { LIMITS, isRtlLang } from './motiontypes';
import { outStart, unitsOf } from './motionanim';
import {
  TRANSITION_LOOKS, composite, dirOfTransition, needsOf, progressOf, readTransition, transitionKindOf,
  type MovingKind, type Picture, type Transition, type TransitionKind,
} from './motiontransition';

/**
 * Scenes, and how one hands over to the next (pro pass, work package 05;
 * docs/pro/scenes.md is the prose version of this header).
 *
 * ## A scene is a stretch of time
 *
 * `Motion.scenes` is a list of scenes in time order, back to back, the first
 * starting at 0 and the last ending at the graphic's end: `{ id, name, start,
 * end, transition? }`. A layer belongs to a scene by **being on screen during
 * it** — there is no `scene` field on a layer. That keeps the flat `layers`
 * list, every edit in `motionedit.ts`, the timeline, the chat's operations and
 * the model's vocabulary exactly as they were: a layer dragged into the third
 * scene's time is in the third scene, and a document can never name a scene
 * that is not there. A layer that runs across a cut — a background under the
 * whole film, a logo in the corner — is in both scenes, and is the film's
 * rather than either's: moving a scene leaves it where it is.
 *
 * So the frame of a graphic with scenes is the frame it always was, except at
 * a cut with a transition:
 *
 * - **The transition is the exit.** When the next scene arrives with anything
 *   but a cut, the scene that is leaving holds still from its *hold moment* —
 *   the last instant before any of its layers begins to leave (`outStart` in
 *   motionanim.ts) — until the cut. Its exits are not played: the transition
 *   takes them over, which is the rule HyperFrames' scene guidance gives
 *   ("exit animations are banned except on the final scene; the transition is
 *   the exit") and what makes a push or an iris read as one move. A scene that
 *   arrives by a cut leaves the one before it exactly as designed, exits and
 *   all.
 * - **During the transition** — from the cut, for its `d` seconds — the frame
 *   is the old scene's picture, frozen at its hold moment, mixed with the new
 *   scene's picture playing from its own start (entrances and all), by
 *   `composite` in motiontransition.ts. Both pictures are this same graphic
 *   painted at a moment, onto two offscreen canvases kept by size.
 * - **Everywhere else** `paintScenes` returns false and `paint` draws the frame
 *   as it always did. A graphic without scenes, or with one, never reaches
 *   here at all.
 *
 * ## Limits
 *
 * At most `LIMITS.scenes` (12) scenes, none shorter than `LIMITS.sceneMin`
 * (0.5 s); a transition takes `LIMITS.transitionMin` to `LIMITS.transitionMax`
 * (0.15 to 1.5 s) and never longer than either scene beside it; the first
 * scene arrives from nothing and has no transition. Fewer than two scenes is
 * no scenes. `readScenes` enforces all of it, and every edit below goes
 * through the same tidying, so an edit's result is what the reader would make
 * of it.
 *
 * ## This file draws nothing itself
 *
 * `motiondraw.ts` and `motionread.ts` import this file, so it must not import
 * them at run time: types come in with `import type`, the reading is its own,
 * and `paintScenes` is handed the drawing as a function (`SceneDraw`) by the
 * hook in `paint`. The few rules of motionread's it must agree with — how a
 * layer's start, end and effect timings are held inside a graphic — are
 * repeated in `retime`, and the test proves an edit comes back from
 * `readMotion` unchanged.
 */

/** One scene of a graphic: a stretch of its time, and how it arrives. */
export interface SceneSpec {
  /** Short, unique among the graphic's scenes: `s1`, `s2`… for scenes made here. */
  id: string;
  /** What the strip calls it; empty shows as "Scene n". */
  name: string;
  /** Seconds. A scene starts where the one before it ends; the first at 0, the last ends at the graphic's end. */
  start: number;
  end: number;
  /** How it arrives from the scene before. Absent is a cut, and the first scene never has one. */
  transition?: Transition;
}

/**
 * How `paint` hands its own drawing to `paintScenes`: draw this graphic,
 * scenes left out, at `at` seconds, over the whole of `target` at the frame's
 * size, clearing it first when `clear`.
 */
export type SceneDraw = (target: Ctx, at: number, clear: boolean) => void;

/** Seconds a scene made by "+ Scene" lasts, when the graphic has room for it. */
export const NEW_SCENE = 3;

/** A hair: two times this close are the same moment. */
const EPS = 1e-6;
/** How long before a cut a scene that has no exit is frozen: the last moment its layers are certainly all on. */
const BEFORE_CUT = 0.001;
/** motionread.ts's shortest layer, which `retime` must agree with. */
const MIN_SPAN = 0.05;
/** List entries looked at: well past `LIMITS.scenes`, short of what a list of a million could cost. */
const SCAN = 200;

// ── reading ───────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function rec(x: unknown): Rec | null {
  try {
    return x !== null && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : null;
  } catch {
    return null;
  }
}

/** A field that is `o`'s own; inherited names and throwing getters are not there. */
function own(o: Rec, k: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;
  } catch {
    return undefined;
  }
}

/** The first `cap` entries of an array, read one at a time (a sparse or hostile array costs only what is looked at); null for anything else. */
function listOf(x: unknown, cap: number): unknown[] | null {
  let n = 0;
  try {
    if (!Array.isArray(x)) return null;
    n = Math.min(x.length, cap);
  } catch {
    return null;
  }
  const out: unknown[] = [];
  for (let i = 0; i < n; i++) {
    try {
      out.push((x as unknown[])[i]);
    } catch {
      out.push(undefined);
    }
  }
  return out;
}

/** `x` as a number (a plain decimal string counts, as in motionread.ts), or null. */
function numOrNull(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.length <= 40 && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(x.trim())) {
    const n = Number(x.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const within = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v)) || 0;

/** To the millisecond: scene boundaries are kept that way, so a split made at a frame's time reads back as written. */
const ms = (x: number): number => Math.round(x * 1000) / 1000 || 0;

/** A graphic's length as the reader keeps it. */
function secondsOf(x: unknown): number {
  return within(numOrNull(x) ?? 6, LIMITS.minSeconds, LIMITS.seconds);
}

const SCENE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const idOf = (x: unknown): string | undefined => (typeof x === 'string' && x.length <= 40 && SCENE_ID.test(x) ? x : undefined);

const CONTROLS = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

/**
 * A scene's name as it is kept: one line, every run of space one space,
 * control characters and half surrogate pairs gone, composed, at most
 * `LIMITS.name` characters (an emoji is one, and never cut in half). The same
 * rule motionread.ts gives a layer's name.
 */
export function sceneName(x: unknown): string {
  let s = typeof x === 'string' ? x : typeof x === 'number' && Number.isFinite(x) ? String(x) : '';
  const room = LIMITS.name * 4 + 64;
  if (s.length > room) s = s.slice(0, room);
  s = s.replace(CONTROLS, ' ').replace(SURROGATES, (p) => (p.length === 2 ? p : '')).normalize('NFC').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > LIMITS.name ? chars.slice(0, LIMITS.name).join('').trim() : s;
}

/** A scene before it is tidied: where it starts, and what it was given. */
interface Draft {
  id: unknown;
  name: string;
  start: number;
  transition: unknown;
}

/**
 * Drafts as scenes: in time order; the first at 0; each at least
 * `LIMITS.sceneMin` long (a scene starting too soon after the one before, or
 * too near the end, is dropped and its time joins the one before); at most
 * `LIMITS.scenes`; each ending where the next starts and the last at
 * `seconds`; ids unique (a missing or repeated one gets the first free `sN`);
 * transitions read for the room the two scenes beside them leave, and none on
 * the first. Undefined when fewer than two scenes are left. Tidying a tidy
 * list changes nothing.
 */
function tidy(drafts: readonly Draft[], seconds: number): SceneSpec[] | undefined {
  const secs = secondsOf(seconds);
  const order = drafts
    .map((d, i) => ({ d, i, at: ms(within(d.start, 0, secs)) }))
    .sort((x, y) => x.at - y.at || x.i - y.i);
  const kept: { d: Draft; at: number }[] = [];
  for (const o of order) {
    if (kept.length >= LIMITS.scenes) break;
    if (!kept.length) {
      kept.push({ d: o.d, at: 0 });
      continue;
    }
    if (o.at < kept[kept.length - 1].at + LIMITS.sceneMin - EPS || o.at > secs - LIMITS.sceneMin + EPS) continue;
    kept.push(o);
  }
  if (kept.length < 2) return undefined;
  const taken = new Set<string>();
  const ids = kept.map((k) => {
    const id = idOf(k.d.id);
    if (!id || taken.has(id)) return null;
    taken.add(id);
    return id;
  });
  let n = 1;
  const fresh = (): string => {
    while (taken.has(`s${n}`)) n++;
    taken.add(`s${n}`);
    return `s${n}`;
  };
  const out: SceneSpec[] = kept.map((k, i) => ({
    id: ids[i] ?? fresh(), name: k.d.name, start: k.at, end: i + 1 < kept.length ? kept[i + 1].at : secs,
  }));
  for (let i = 1; i < out.length; i++) {
    const room = Math.min(LIMITS.transitionMax, out[i - 1].end - out[i - 1].start, out[i].end - out[i].start);
    const tr = readTransition(kept[i].d.transition, room);
    if (tr) out[i].transition = tr;
  }
  return out;
}

/**
 * A graphic's scenes from anything, or undefined for none. Each entry is an
 * object with a `start` (seconds), or none, when it starts where the entry
 * before it ended (its `end`, or its `start` plus its `duration`); a `name`
 * (or `title`), an `id`, and a `transition` (a word such as `"fade"`, or
 * `{ kind, d, dir, ease }`; see `readTransition`). Then tidied: see `tidy`.
 * Never throws. `layers` is unused: a layer belongs to a scene by its time,
 * so nothing about a layer can make a scene wrong (the parameter is the
 * contract motionread.ts calls).
 */
export function readScenes(x: unknown, _layers: readonly Layer[], seconds: number): SceneSpec[] | undefined {
  try {
    const list = listOf(x, SCAN);
    if (!list) return undefined;
    const drafts: Draft[] = [];
    let cursor = 0;
    for (const item of list) {
      const o = rec(item);
      if (!o) continue;
      const start = numOrNull(own(o, 'start')) ?? cursor;
      const end = numOrNull(own(o, 'end'));
      const d = numOrNull(own(o, 'duration'));
      cursor = end ?? (d !== null ? start + d : cursor);
      drafts.push({ id: own(o, 'id'), name: sceneName(own(o, 'name') ?? own(o, 'title')), start, transition: own(o, 'transition') });
    }
    return tidy(drafts, secondsOf(seconds));
  } catch {
    return undefined;
  }
}

/** A graphic's scenes as the reader would keep them, or undefined when it has fewer than two. Robust to a graphic an older edit left untidy. */
function scenesIn(m: Motion): SceneSpec[] | undefined {
  if (!m || !Array.isArray(m.scenes) || m.scenes.length < 2) return undefined;
  return readScenes(m.scenes, [], m.seconds);
}

/** The scene a graphic without scenes is: all of it. */
function whole(m: Motion): SceneSpec {
  return { id: 's1', name: '', start: 0, end: secondsOf(m?.seconds) };
}

/** The scene `t` falls in: the last that starts at or before it. */
function indexIn(list: readonly SceneSpec[], t: number): number {
  const at = Number.isFinite(t) ? t : 0;
  let i = 0;
  while (i + 1 < list.length && at >= list[i + 1].start - EPS) i++;
  return i;
}

// ── the frame ─────────────────────────────────────────────────────────────

/**
 * When a scene is frozen for the transition after it: the last instant
 * before any of its layers begins to leave. Starting from the cut, every
 * layer still leaving there (its exit begun, `outStart`, and not yet over)
 * moves the moment back to where its exit began, until none is; a layer that
 * left and was gone earlier in the scene does not count, since it was meant
 * to be gone by the end. With no exit at all it is a millisecond before the
 * cut. Never before the scene's start.
 */
function freezeTime(layers: readonly Layer[], s: SceneSpec): number {
  let h = s.end;
  for (let pass = 0; pass <= layers.length; pass++) {
    let moved = false;
    for (const l of layers) {
      if (!l || l.hidden || !l.out || l.out.fx === 'none') continue;
      if (!(l.start < s.end && l.end > s.start)) continue;
      const from = outStart(l, unitsOf(l));
      if (from < h - EPS && l.end >= h - EPS) {
        h = from;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return Math.max(s.start, Math.min(h, s.end - BEFORE_CUT));
}

/** The moment scene `i` is painted at when the clock reads `now`: `now`, or its hold moment once the next scene's transition is due. */
function shownAt(layers: readonly Layer[], list: readonly SceneSpec[], i: number, now: number): number {
  if (!list[i + 1]?.transition) return now;
  const h = freezeTime(layers, list[i]);
  return now >= h ? h : now;
}

/**
 * The moment the scene at `index` holds still at for the transition after it
 * (see `freezeTime`), or its end when the next scene arrives by a cut, or
 * there is none.
 */
export function sceneHold(m: Motion, index: number): number {
  const list = scenesIn(m);
  const s = list?.[Math.round(Number.isFinite(index) ? index : -1)];
  if (!list || !s) return secondsOf(m?.seconds);
  return list[list.indexOf(s) + 1]?.transition ? freezeTime(Array.isArray(m.layers) ? m.layers : [], s) : s.end;
}

/** A 32-bit number from a scene's id: the seed of what looks random in its transition. FNV-1a. */
function seedOf(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The pictures the two scenes of a transition are painted on: two canvases per frame size, kept for the two sizes most recently used. */
const pairs: { w: number; h: number; a: Picture; b: Picture }[] = [];

function canvasOf(w: number, h: number): Picture | null {
  try {
    let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
    if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(w, h);
    else if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      canvas = c;
    }
    const ctx = canvas ? (canvas.getContext('2d') as Ctx | null) : null;
    return canvas && ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

/** The two canvases for a frame of this size, made once and reused: the stage's and an export's, or a card's, live side by side. */
function picturesOf(width: number, height: number): { a: Picture; b: Picture } | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const at = pairs.findIndex((p) => p.w === w && p.h === h);
  if (at >= 0) {
    const [hit] = pairs.splice(at, 1);
    pairs.unshift(hit);
    return hit;
  }
  const a = canvasOf(w, h);
  const b = a ? canvasOf(w, h) : null;
  if (!a || !b) return null;
  pairs.unshift({ w, h, a, b });
  pairs.length = Math.min(pairs.length, 2);
  return pairs[0];
}

/**
 * Paint a graphic that has scenes at `t`, when the moment needs it: inside a
 * transition (the two scenes mixed) or in a scene held still before one (its
 * hold moment painted instead). False everywhere else, and `paint` draws the
 * frame as it always does; false too when no offscreen canvas can be made, so
 * a transition there is a cut. `draw` paints the graphic, scenes left out, at
 * a moment (see `SceneDraw`); `clear` is `paint`'s own.
 */
export function paintScenes(ctx: Ctx, doc: Motion, t: number, width: number, height: number, draw?: SceneDraw, clear = true): boolean {
  if (!draw) return false;
  const list = scenesIn(doc);
  if (!list) return false;
  const now = Number.isFinite(t) ? t : 0;
  const layers = Array.isArray(doc.layers) ? doc.layers : [];
  const i = indexIn(list, now);
  const scene = list[i];
  const tr = scene.transition;
  if (i > 0 && tr && now >= scene.start - EPS && now < scene.start + tr.d) {
    const p = progressOf(tr, (now - scene.start) / tr.d);
    const pics = picturesOf(width, height);
    if (!pics) return false;
    const need = needsOf(tr.kind, p);
    if (need !== 'b') draw(pics.a.ctx, shownAt(layers, list, i - 1, now), true);
    if (need !== 'a') draw(pics.b.ctx, shownAt(layers, list, i, now), true);
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (clear) ctx.clearRect(0, 0, width, height);
      composite(ctx, tr.kind, p, pics.a, pics.b, width, height, dirOfTransition(tr), isRtlLang(doc.lang), seedOf(scene.id));
    } finally {
      ctx.restore();
    }
    return true;
  }
  const at = shownAt(layers, list, i, now);
  if (at === now) return false;
  draw(ctx, at, clear);
  return true;
}

// ── looking up ────────────────────────────────────────────────────────────

/** A graphic's scenes, tidied, or an empty list when it has fewer than two (it is one scene, shown as none). */
export function sceneList(m: Motion): SceneSpec[] {
  return scenesIn(m) ?? [];
}

/** Which scene `t` falls in: its index in `sceneList`, 0 for a graphic without scenes. */
export function sceneAt(m: Motion, t: number): number {
  const list = scenesIn(m);
  return list ? indexIn(list, t) : 0;
}

/** The time of the scene `t` falls in, or the whole graphic without scenes: where a layer added there belongs. */
export function sceneSpan(m: Motion, t: number): { start: number; end: number } {
  const list = scenesIn(m) ?? [whole(m)];
  const s = list[indexIn(list, t)];
  return { start: s.start, end: s.end };
}

/** Seconds a new scene would get: up to `NEW_SCENE`, what is left under `LIMITS.seconds`; less than `LIMITS.sceneMin` is no room. */
function roomFor(m: Motion): number {
  const left = Math.floor((LIMITS.seconds - secondsOf(m?.seconds)) * 1000 + EPS) / 1000;
  return Math.min(NEW_SCENE, Math.max(0, left));
}

/** Whether "+ Scene" can add one: fewer than `LIMITS.scenes`, and room left under `LIMITS.seconds`. */
export function canAddScene(m: Motion): boolean {
  return (scenesIn(m)?.length ?? 1) < LIMITS.scenes && roomFor(m) >= LIMITS.sceneMin - EPS;
}

/** Whether `t` can be a new cut: both pieces at least `LIMITS.sceneMin`, and fewer than `LIMITS.scenes`. */
export function canSplitAt(m: Motion, t: number): boolean {
  const list = scenesIn(m) ?? [whole(m)];
  if (list.length >= LIMITS.scenes || !Number.isFinite(t)) return false;
  const at = ms(t);
  const s = list[indexIn(list, at)];
  return at >= s.start + LIMITS.sceneMin - EPS && at <= s.end - LIMITS.sceneMin + EPS;
}

/**
 * The transition a new scene arrives with: the one the graphic already uses
 * most (one primary transition for most cuts reads as a style; a different one
 * at every cut reads as a sampler), or a fade when it has none.
 */
export function primaryTransition(m: Motion): Transition {
  const counts = new Map<MovingKind, number>();
  let best: Transition | undefined;
  let most = 0;
  for (const s of sceneList(m)) {
    if (!s.transition) continue;
    const n = (counts.get(s.transition.kind) ?? 0) + 1;
    counts.set(s.transition.kind, n);
    if (n > most) {
      most = n;
      best = s.transition;
    }
  }
  return best ? { ...best } : { kind: 'fade', d: TRANSITION_LOOKS.fade.d };
}

// ── edits ─────────────────────────────────────────────────────────────────
//
// Pure, like motionedit.ts's: each returns a new graphic (the same one when
// nothing changed, so a no-op costs no undo step) stamped `updated: now`, which
// `readMotion` reads back unchanged. Edits that only mark cuts, name scenes or
// choose transitions keep the template link (`recipe`). Edits that move layers
// in time keep it only when they leave the template's own time alone — "+
// Scene" at or after the end of the template's part, which then owns that
// span (`RecipeRef.until`, motionedit.ts "A template owns a span"); a scene
// moved among the scenes after it — and drop it otherwise, as editing a
// template's layer by hand does: a rebuild would lay the template over the
// time the edit moved.

const stamp = (m: Motion, now: number): Motion => ({ ...m, updated: now });

/** The graphic with these scenes, or with none when the list is undefined. */
function withScenes(m: Motion, list: SceneSpec[] | undefined): Motion {
  const next = { ...m };
  if (list) next.scenes = list;
  else delete next.scenes;
  return next;
}

/** The template link dropped: its layers are the person's from here. */
function detach(m: Motion): Motion {
  if (!m.recipe) return m;
  const next = { ...m };
  delete next.recipe;
  return next;
}

/** Where the template's part of a template graphic ends — `recipe.until`, else its end — or undefined without a template. */
function templateEnd(m: Motion): number | undefined {
  if (!m.recipe) return undefined;
  return m.recipe.until ?? secondsOf(m.seconds);
}

/** The template link owning the time up to `until` (to the millisecond, as the reader keeps it); the rest is the person's. */
function spanned(m: Motion, until: number): Motion {
  return m.recipe ? { ...m, recipe: { ...m.recipe, until: ms(until) } } : m;
}

const draftOf = (s: SceneSpec): Draft => ({ id: s.id, name: s.name, start: s.start, transition: s.transition });

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** An effect's timings held inside a layer `span` seconds long, as motionread.ts's `readAnim` holds them. */
function fitAnim(a: Anim, span: number): Anim {
  const room = Math.max(MIN_SPAN, span);
  const d = within(a.d, MIN_SPAN, room);
  const delay = within(a.delay, 0, room);
  return d === a.d && delay === a.delay ? a : { ...a, d, delay };
}

/**
 * A layer moved to `start`..`end`, held inside a graphic `seconds` long and
 * its effects' timings inside its length — the rules motionread.ts's
 * `baseOf`, `readAnim` and counter reader apply, repeated because this file
 * may not import that one. So a layer moved here reads back as it is.
 */
function retime(l: Layer, start: number, end: number, seconds: number): Layer {
  const s = Math.min(seconds - MIN_SPAN, Math.max(0, start)) || 0;
  const e = Math.min(seconds, Math.max(s + MIN_SPAN, end));
  if (s === l.start && e === l.end) return l;
  const span = e - s;
  const next = { ...l, start: s, end: e } as Layer;
  if (next.in) next.in = fitAnim(next.in, span);
  if (next.out) next.out = fitAnim(next.out, span);
  if (next.kind === 'counter') {
    const c = next.count;
    const d = within(c.d, MIN_SPAN, span);
    const delay = within(c.delay, 0, span);
    if (d !== c.d || delay !== c.delay) next.count = { ...c, d, delay };
  }
  return next;
}

/**
 * Add a scene after the one `at` falls in (after the whole graphic, when it
 * has no scenes yet: it becomes the first of two). The graphic grows by the
 * new scene's length — `NEW_SCENE` seconds, or what is left under
 * `LIMITS.seconds` — and the time is made at the cut:
 *
 * - a layer that starts at the cut or later moves later by that length, with
 *   the scenes after it;
 * - a layer that runs across the cut grows by it, so what ran through the cut
 *   runs through the new scene too;
 * - when the new scene is added at the end, a background (a `backdrop` layer)
 *   that ran to the end runs on through it;
 * - every other layer stays where it is: the new scene starts empty.
 *
 * It arrives with `primaryTransition`. Unchanged when there are already
 * `LIMITS.scenes` scenes or less than `LIMITS.sceneMin` of room.
 *
 * A template graphic stays one when the cut is at or after the end of the
 * template's part (the whole graphic, or `recipe.until`): nothing of the
 * template moves, the template now owns the time up to that end, and the new
 * scene is the person's. A cut inside the template's time ends the template.
 */
export function addScene(m: Motion, at: number, now = Date.now()): Motion {
  if (!canAddScene(m)) return m;
  const list = scenesIn(m) ?? [whole(m)];
  const secs = secondsOf(m.seconds);
  const len = roomFor(m);
  const seconds = Math.min(LIMITS.seconds, secs + len);
  const i = indexIn(list, Number.isFinite(at) ? at : 0);
  const cut = list[i].end;
  const atEnd = cut >= secs - EPS;
  const layers = (Array.isArray(m.layers) ? m.layers : []).map((l): Layer => {
    if (l.start >= cut - EPS) return retime(l, l.start + len, l.end + len, seconds);
    if (l.end > cut + EPS || (atEnd && l.kind === 'backdrop' && l.end >= cut - EPS)) return retime(l, l.start, l.end + len, seconds);
    return l;
  });
  const drafts: Draft[] = [];
  list.forEach((s, j) => {
    drafts.push({ ...draftOf(s), start: j > i ? s.start + len : s.start });
    if (j === i) drafts.push({ id: undefined, name: '', start: cut, transition: primaryTransition(m) });
  });
  const scenes = tidy(drafts, seconds);
  if (!scenes || scenes.length !== list.length + 1) return m;
  const end = templateEnd(m);
  const next = withScenes({ ...m, seconds, layers }, scenes);
  return stamp(end !== undefined && cut >= end - EPS ? spanned(next, end) : detach(next), now);
}

/**
 * Cut the scene `t` falls in into two at `t` (to the millisecond). Nothing
 * moves: the first piece keeps the scene's id, name and transition, and the
 * second arrives by a cut, so the graphic looks exactly as it did until a
 * transition is chosen for it. A graphic without scenes becomes two.
 * Unchanged when either piece would be shorter than `LIMITS.sceneMin`, or
 * there are already `LIMITS.scenes`.
 */
export function splitSceneAt(m: Motion, t: number, now = Date.now()): Motion {
  if (!canSplitAt(m, t)) return m;
  const list = scenesIn(m) ?? [whole(m)];
  const at = ms(t);
  const i = indexIn(list, at);
  const drafts = list.map(draftOf);
  drafts.splice(i + 1, 0, { id: undefined, name: '', start: at, transition: undefined });
  const scenes = tidy(drafts, m.seconds);
  if (!scenes || scenes.length !== list.length + 1) return m;
  return stamp(withScenes(m, scenes), now);
}

/**
 * Take a scene away by joining it to its neighbour: the scene before it runs
 * on over its time (for the first scene, the second starts at 0 instead).
 * No layer moves or goes: what was in it is in the neighbour now. A graphic
 * left with one scene has none.
 */
export function removeScene(m: Motion, id: string, now = Date.now()): Motion {
  const list = scenesIn(m);
  const i = list ? list.findIndex((s) => s.id === id) : -1;
  if (!list || i < 0) return m;
  const drafts = list.filter((_, j) => j !== i).map(draftOf);
  drafts[0] = { ...drafts[0], start: 0 };
  return stamp(withScenes(m, tidy(drafts, m.seconds)), now);
}

/**
 * Move a scene to another place in the order (`to` is its new index), with
 * everything in it. Each scene keeps its length and its transition; the
 * scenes are laid back to back in the new order, and every layer that lies
 * wholly inside one scene moves with it. A layer that runs across a cut is
 * the film's, not a scene's, and stays where it is in time. The scene that
 * ends up first arrives from nothing, so it loses its transition; the one that
 * was first arrives by a cut until one is chosen.
 *
 * The template link is kept only when the template owns a span
 * (`recipe.until`) and every scene that starts inside it stays where it was:
 * the move was among the person's scenes, and no layer of the template moved.
 */
export function moveScene(m: Motion, id: string, to: number, now = Date.now()): Motion {
  const list = scenesIn(m);
  const from = list ? list.findIndex((s) => s.id === id) : -1;
  if (!list || from < 0 || !Number.isFinite(to)) return m;
  const target = within(Math.round(to), 0, list.length - 1);
  if (target === from) return m;
  const order = list.slice();
  const [moved] = order.splice(from, 1);
  order.splice(target, 0, moved);
  const secs = secondsOf(m.seconds);
  const shift = new Map<string, number>();
  let cursor = 0;
  const drafts = order.map((s): Draft => {
    shift.set(s.id, cursor - s.start);
    const d = { ...draftOf(s), start: cursor };
    cursor = ms(cursor + (s.end - s.start));
    return d;
  });
  const layers = (Array.isArray(m.layers) ? m.layers : []).map((l): Layer => {
    const home = list.find((s) => l.start >= s.start - EPS && l.end <= s.end + EPS);
    const by = home ? shift.get(home.id) ?? 0 : 0;
    return by ? retime(l, l.start + by, l.end + by, secs) : l;
  });
  const until = m.recipe?.until;
  const kept = until !== undefined && list.every((s) => s.start >= until - EPS || shift.get(s.id) === 0);
  const next = withScenes({ ...m, layers }, tidy(drafts, secs));
  return stamp(kept ? next : detach(next), now);
}

/** Part of a transition to change: any of its fields, and `kind` may be `cut`. */
export type TransitionChange = Partial<Omit<Transition, 'kind'>> & { kind?: TransitionKind };

/**
 * Choose how a scene arrives: a kind (`'fade'`), some of `{ kind, d, dir,
 * ease }`, or `null` (or `'cut'`) for a cut. Choosing another kind starts from
 * that kind's own length and curve and keeps the direction; changing the
 * length, direction or curve keeps the rest. Held to the limits by the reader:
 * a length longer than either scene beside it is cut to fit. The first scene
 * arrives from nothing and is left as it is.
 */
export function setTransition(m: Motion, id: string, spec: TransitionKind | TransitionChange | null, now = Date.now()): Motion {
  const list = scenesIn(m);
  const i = list ? list.findIndex((s) => s.id === id) : -1;
  if (!list || i <= 0) return m;
  const cur = list[i].transition;
  const given: TransitionChange = typeof spec === 'string' ? { kind: spec } : spec !== null && typeof spec === 'object' ? spec : { kind: 'cut' };
  // A word that names no kind changes nothing (an alias such as `crossfade` is the kind it stands for).
  const kind = given.kind === undefined ? cur?.kind ?? 'fade' : transitionKindOf(given.kind);
  if (!kind) return m;
  let next: Partial<Transition> | undefined;
  if (kind !== 'cut') {
    const kept = cur && cur.kind === kind ? cur : undefined;
    const dir = given.dir ?? cur?.dir;
    const ease = given.ease ?? kept?.ease;
    next = { kind, d: given.d ?? kept?.d ?? TRANSITION_LOOKS[kind].d, ...(dir ? { dir } : {}), ...(ease ? { ease } : {}) };
  }
  const drafts = list.map(draftOf);
  drafts[i] = { ...drafts[i], transition: next };
  const scenes = tidy(drafts, m.seconds);
  return same(scenes, list) ? m : stamp(withScenes(m, scenes), now);
}

/** Rename a scene. Read as the reader keeps a name (`sceneName`); an empty name shows as "Scene n". */
export function renameScene(m: Motion, id: string, name: string, now = Date.now()): Motion {
  const list = scenesIn(m);
  const i = list ? list.findIndex((s) => s.id === id) : -1;
  if (!list || i < 0) return m;
  const clean = sceneName(name);
  if (clean === list[i].name) return m;
  const scenes = list.slice();
  scenes[i] = { ...scenes[i], name: clean };
  return stamp(withScenes(m, scenes), now);
}
