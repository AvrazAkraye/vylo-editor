import type { Lang } from './i18n';
import type { Fps, Format, Layer, LayerKind, Motion, Paint, Palette } from './motiontypes';
import { FPS_CHOICES, LIMITS } from './motiontypes';
import { blankLayer, fitParticles, newLayerId, readLayer, readPalette, readTitle } from './motionread';
import { buildMotion, lookOf } from './motiontemplates';
import { readScenes, sceneList, sceneSpan } from './motionscene';

/**
 * Every change a person can make to a graphic, as a pure function from one
 * graphic to the next.
 *
 * The studio's components never write into a graphic; they call `onEdit` with
 * one of these (motionui.ts), and the panel applies it, records it for undo and
 * keeps it. Being pure is what makes that safe and testable: an edit can be
 * tried on a copy, applied twice with the same result, and undone by keeping the
 * value it replaced.
 *
 * ## Editing a layer by hand ends the template
 *
 * A graphic made from a template remembers which one and the words it was
 * filled with (`Motion.recipe`), and while that link is there a change of
 * words, shape, language or length builds the graphic again from the recipe.
 * The moment a layer is edited by hand — moved, recoloured, retimed, added,
 * removed — there is no honest way to rebuild: it would throw the edit away. So
 * the link is dropped (`detach`), and from then on the layers are the person's
 * and the changes that need a recipe change only the graphic's settings. The
 * settings that do not depend on the layout (palette, title, backdrop, rate)
 * leave the link alone.
 *
 * ## Everything is read again
 *
 * A layer that comes out of `setLayer` has been through `readLayer`, so a
 * field the panel let through as -50 opacity or a scale of 9000 is clamped the
 * same way a model's answer would be. There is one set of limits, and it is the
 * reader's.
 *
 * ## What a rebuild keeps (pro pass, wave 2)
 *
 * A template graphic built again — new words, shape, language or length —
 * comes back from `buildMotion` with only what the recipe makes. What the
 * person chose on top of it is carried across, so an edit never takes it away
 * without a word:
 *
 * - its **sound** (`Motion.sound`, motionsound.ts), exactly as it was: the
 *   effects are worked out from the layers when they play, so new words get
 *   new effects in the same mode, mood and level;
 * - its **scenes** (`Motion.scenes`, motionscene.ts), read again for the
 *   rebuilt graphic by the rule `scenesFor` states;
 * - its **look** (`lookOf`, motiontemplates.ts): a brand's headline face and
 *   logo, which the palette and the words do not carry.
 *
 * ## Scenes when the length changes
 *
 * A cut stays where it was put, in seconds: the scenes before the end keep
 * their starts and lengths, and the **last scene stretches or shrinks** to the
 * new end. A scene that would start less than `LIMITS.sceneMin` before the new
 * end has no room left and goes, its time joining the scene before it (and
 * with one scene left there are none). A transition longer than a scene it
 * now sits beside is shortened to fit. That is exactly `readScenes` read for
 * the new length, so the list in memory is always the list the reader would
 * keep: never a scene past the end, never two that overlap, never a stale one.
 *
 * ## A new layer goes where the person is looking
 *
 * Without scenes a new layer runs the whole graphic, as it always did. With
 * scenes it runs through the scene the playhead is in (`sceneSpan`): a layer
 * added while looking at the third scene belongs to the third scene. `addLayer`
 * takes the playhead as `at`; `placeAdded` does the same for a change that
 * added a layer without knowing where the playhead was.
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const stamp = (m: Motion, now: number): Motion => ({ ...m, updated: now });

/**
 * The scenes `m` keeps once it is `seconds` long and its layers are `layers`:
 * the rule in the header ("Scenes when the length changes"). Undefined when it
 * has none, or none left.
 */
function scenesFor(m: Motion, layers: readonly Layer[], seconds: number): Motion['scenes'] {
  return readScenes(m.scenes, layers, seconds);
}

/** The graphic with these scenes, or without the key at all when there are none (`readMotion`'s fixed point needs that). */
function withScenes(m: Motion, scenes: Motion['scenes']): Motion {
  if (scenes) return { ...m, scenes };
  if (!('scenes' in m)) return m;
  const next = { ...m };
  delete next.scenes;
  return next;
}

/** Whether the graphic is still a template's, rebuilt when its words or shape change. */
export function isAttached(m: Motion): boolean {
  return !!m.recipe;
}

/** Drop the link to the template: the layers are the person's from here. */
export function detach(m: Motion): Motion {
  if (!m.recipe) return m;
  const next = { ...m };
  delete next.recipe;
  return next;
}

/**
 * Build a template graphic again with some of its settings changed, keeping
 * what the person chose: the title, rate, frame and dates as before, and its
 * sound, scenes and brand look (the header's "What a rebuild keeps").
 */
function rebuild(m: Motion, patch: { fields?: Record<string, string>; lang?: Lang; format?: Format; seconds?: number }, now: number): Motion {
  const r = m.recipe;
  if (!r) return m;
  const fresh = buildMotion({
    id: m.id, recipe: r.id, fields: patch.fields ?? r.fields, lang: patch.lang ?? m.lang, format: patch.format ?? m.format,
    palette: m.palette, seconds: patch.seconds ?? m.seconds, now: m.created, request: m.request, ai: m.ai, look: lookOf(m),
  });
  const next: Motion = { ...fresh, title: m.title, fps: m.fps, backdrop: m.backdrop, stage: m.stage, error: m.error, created: m.created, updated: now };
  if (m.sound) next.sound = m.sound;
  return withScenes(next, scenesFor(m, fresh.layers, fresh.seconds));
}

export function setTitle(m: Motion, title: string, now = Date.now()): Motion {
  // Kept as the reader keeps it (one line, composed, "Untitled" when empty), so a title is the same after reopening.
  const clean = readTitle(title);
  return clean === m.title ? m : stamp({ ...m, title: clean }, now);
}

/** Change the words of a template graphic. A graphic edited by hand has no fields to change and is returned as it is. */
export function setFields(m: Motion, fields: Record<string, string>, now = Date.now()): Motion {
  if (!m.recipe) return m;
  // A value that is not words leaves its field as it was; read as empty it would bring the template's sample back.
  const given: Record<string, string> = {};
  for (const key of Object.keys(fields ?? {})) {
    const v: unknown = fields[key];
    if (typeof v === 'string') given[key] = v;
  }
  return rebuild(m, { fields: { ...m.recipe.fields, ...given } }, now);
}

export function setFormat(m: Motion, format: Format, now = Date.now()): Motion {
  if (format === m.format) return m;
  // Pinned layers reflow on their own; a template is rebuilt for the shape, because its designer drew each shape.
  return m.recipe ? rebuild(m, { format }, now) : stamp({ ...m, format }, now);
}

export function setLang(m: Motion, lang: Lang, now = Date.now()): Motion {
  if (lang === m.lang) return m;
  return m.recipe ? rebuild(m, { lang }, now) : stamp({ ...m, lang }, now);
}

export function setFps(m: Motion, fps: Fps, now = Date.now()): Motion {
  return (FPS_CHOICES as readonly number[]).includes(fps) && fps !== m.fps ? stamp({ ...m, fps }, now) : m;
}

/**
 * Change the length. A template is built again for it, so its entrance stays at
 * the start and its exit lands on the new end. A graphic edited by hand keeps
 * its layers: those that ran to the old end run to the new one, and the rest
 * are only brought inside it. Either way its scenes follow the rule in the
 * header: the last one stretches or shrinks, the others keep their place, and
 * one with no room left goes.
 */
export function setSeconds(m: Motion, seconds: number, now = Date.now()): Motion {
  const s = clamp(Math.round((Number.isFinite(seconds) ? seconds : m.seconds) * 10) / 10, LIMITS.minSeconds, LIMITS.seconds);
  if (s === m.seconds) return m;
  if (m.recipe) return rebuild(m, { seconds: s }, now);
  const layers = m.layers.map((l): Layer => {
    const toEnd = l.end >= m.seconds - 1e-6;
    const end = toEnd ? s : Math.min(l.end, s);
    const start = Math.min(l.start, Math.max(0, end - 0.05));
    return readLayer({ ...l, start, end }, { seconds: s }) ?? l;
  });
  return withScenes(stamp({ ...m, seconds: s, layers }, now), scenesFor(m, layers, s));
}

export function setPalette(m: Motion, colors: Palette, now = Date.now()): Motion {
  return stamp({ ...m, palette: readPalette(colors, m.palette) }, now);
}

export function setBackdrop(m: Motion, paint: Paint | null, now = Date.now()): Motion {
  return stamp({ ...m, backdrop: paint }, now);
}

/** Change fields of one layer. Read again, so nothing out of range survives; the graphic stops being a template's. */
export function setLayer(m: Motion, id: string, patch: Partial<Layer>, now = Date.now()): Motion {
  const at = m.layers.findIndex((l) => l.id === id);
  if (at < 0) return m;
  // The kind is the layer's own: a patch that names another would turn a headline into a shape and lose its words.
  const read = readLayer({ ...m.layers[at], ...patch, id, kind: m.layers[at].kind }, { seconds: m.seconds });
  if (!read) return m;
  // The particles of the other layers come first: the layer being edited is the one held to the budget.
  const next = fitParticles(read, m.layers.filter((_, i) => i !== at));
  // A field committed with the value it already had (a blur, a drag that ended
  // where it began) changes nothing, so it must not cost the graphic its
  // template or the person an undo step.
  if (JSON.stringify(next) === JSON.stringify(m.layers[at])) return m;
  const layers = m.layers.slice();
  layers[at] = next;
  return stamp(detach({ ...m, layers }), now);
}

/**
 * The id for a new layer: the one the caller asked for when nothing in the
 * graphic has it, otherwise a fresh one. A panel that wants to select the layer
 * it is adding has to know the id before the edit is applied — the edit is a
 * function that runs later, on the newest copy — so it chooses the id itself.
 */
function freeId(m: Motion, wanted: unknown): string {
  const taken = new Set(m.layers.map((l) => l.id));
  return typeof wanted === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(wanted) && !taken.has(wanted) ? wanted : newLayerId(taken);
}

/** What a layer of each kind is called until the person renames it. */
const KIND_NAME: Readonly<Record<LayerKind, string>> = {
  text: 'Text', shape: 'Shape', icon: 'Icon', image: 'Picture', counter: 'Counter', chart: 'Chart', backdrop: 'Background', particles: 'Particles',
};

/**
 * Where a layer added at `at` seconds runs: through the scene `at` is in when
 * the graphic has scenes, the whole graphic otherwise (and when `at` is not a
 * time).
 */
function spanAt(m: Motion, at: number | undefined): { start: number; end: number } {
  return typeof at === 'number' && Number.isFinite(at) && sceneList(m).length ? sceneSpan(m, at) : { start: 0, end: m.seconds };
}

/**
 * A new layer on top of the others (a background goes to the back), visible
 * through the scene the playhead (`at`) is in — the whole graphic when it has
 * no scenes or no playhead is given — with a gentle fade in, so what the
 * person adds is seen arriving rather than appearing. `patch` overrides any of
 * it, its own `start` and `end` included.
 */
export function addLayer(m: Motion, kind: LayerKind, patch: Partial<Layer> = {}, now = Date.now(), at?: number): { motion: Motion; id: string } {
  if (m.layers.length >= LIMITS.layers) return { motion: m, id: '' };
  const given: Partial<Layer> = patch !== null && typeof patch === 'object' ? patch : {};
  const id = freeId(m, given.id);
  const span = spanAt(m, at);
  const wanted = {
    id, name: KIND_NAME[kind], start: span.start, end: span.end,
    ...(kind === 'backdrop' ? {} : { in: { fx: 'fade', d: 0.5, delay: 0.1, ease: 'out', amount: 1 } }),
    ...given,
  } as Partial<Layer>;
  // Read for this graphic's length, not the longest one: a start or an entrance past the end is brought inside it now,
  // so the layer added is the layer that comes back when the graphic is opened again.
  const read = readLayer({ ...blankLayer(kind, wanted), ...wanted, kind, id }, { seconds: m.seconds }) ?? blankLayer(kind, { id });
  const made = fitParticles(read, m.layers);
  const layers = kind === 'backdrop' ? [made, ...m.layers] : [...m.layers, made];
  return { motion: stamp(detach({ ...m, layers }), now), id };
}

/** A layer as `duplicateLayer` copies it, with what a copy changes left out: so a copy and its original compare equal. */
function asCopy(l: Layer): string {
  return JSON.stringify({ ...l, id: '', x: 0, y: 0, locked: false, ...(l.kind === 'particles' ? { count: 0 } : {}) });
}

/**
 * A change that added a layer, put right for a graphic with scenes. The
 * Layers tab's "Add" asks `addLayer` for a layer without saying where the
 * playhead is, so the layer comes back running the whole graphic; the panel
 * hands the change through this with the playhead, and each layer `after` has
 * that `before` did not, running the whole graphic, is made to run through the
 * scene `at` is in instead (`sceneSpan`). Left alone: a copy of a layer
 * (`duplicateLayer` puts it directly above its original, the same but for its
 * id and a small offset), which keeps its original's time; a layer given a
 * time of its own; and every graphic without scenes, which is returned as it
 * is — the very object.
 */
export function placeAdded(before: Motion, after: Motion, at: number): Motion {
  if (after === before || !Number.isFinite(at) || !sceneList(after).length) return after;
  const span = sceneSpan(after, at);
  const whole = (s: { start: number; end: number }) => s.start <= 1e-6 && s.end >= after.seconds - 1e-6;
  if (whole(span)) return after;
  const had = new Set(before.layers.map((l) => l.id));
  let moved = false;
  const layers = after.layers.map((l, i) => {
    if (had.has(l.id) || !whole(l)) return l;
    const below = after.layers[i - 1];
    if (below && below.kind === l.kind && asCopy(below) === asCopy(l)) return l;
    const read = readLayer({ ...l, start: span.start, end: span.end }, { seconds: after.seconds });
    if (!read) return l;
    moved = true;
    return read;
  });
  return moved ? { ...after, layers } : after;
}

export function removeLayer(m: Motion, id: string, now = Date.now()): Motion {
  if (!m.layers.some((l) => l.id === id)) return m;
  return stamp(detach({ ...m, layers: m.layers.filter((l) => l.id !== id) }), now);
}

/** A copy of a layer, a little to one side so it is seen to be a copy, directly above the original. */
export function duplicateLayer(m: Motion, id: string, now = Date.now(), wanted?: string): { motion: Motion; id: string } {
  const at = m.layers.findIndex((l) => l.id === id);
  if (at < 0 || m.layers.length >= LIMITS.layers) return { motion: m, id: '' };
  const copyId = freeId(m, wanted);
  const src = m.layers[at];
  const read = readLayer({ ...src, id: copyId, x: src.x + 3, y: src.y + 3, locked: false }, { seconds: m.seconds });
  if (!read) return { motion: m, id: '' };
  const copy = fitParticles(read, m.layers);
  const layers = m.layers.slice();
  layers.splice(at + 1, 0, copy);
  return { motion: stamp(detach({ ...m, layers }), now), id: copyId };
}

/** Move a layer to a place in the stack (0 is the back). */
export function moveLayer(m: Motion, id: string, to: number, now = Date.now()): Motion {
  const from = m.layers.findIndex((l) => l.id === id);
  if (from < 0 || !Number.isFinite(to)) return m;
  const target = clamp(Math.round(to), 0, m.layers.length - 1);
  if (target === from) return m;
  const layers = m.layers.slice();
  const [moved] = layers.splice(from, 1);
  layers.splice(target, 0, moved);
  return stamp(detach({ ...m, layers }), now);
}
