import type { Lang } from './i18n';
import type { Fps, Format, Layer, LayerKind, Motion, Paint, Palette } from './motiontypes';
import { FPS_CHOICES, LIMITS } from './motiontypes';
import { blankLayer, fitParticles, newLayerId, readLayer, readPalette, readTitle } from './motionread';
import { buildMotion } from './motiontemplates';

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
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const stamp = (m: Motion, now: number): Motion => ({ ...m, updated: now });

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

/** Build a template graphic again with some of its settings changed, keeping what the person chose. */
function rebuild(m: Motion, patch: { fields?: Record<string, string>; lang?: Lang; format?: Format; seconds?: number }, now: number): Motion {
  const r = m.recipe;
  if (!r) return m;
  const fresh = buildMotion({
    id: m.id, recipe: r.id, fields: patch.fields ?? r.fields, lang: patch.lang ?? m.lang, format: patch.format ?? m.format,
    palette: m.palette, seconds: patch.seconds ?? m.seconds, now: m.created, request: m.request, ai: m.ai,
  });
  return { ...fresh, title: m.title, fps: m.fps, backdrop: m.backdrop, stage: m.stage, error: m.error, created: m.created, updated: now };
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
 * are only brought inside it.
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
  return stamp({ ...m, seconds: s, layers }, now);
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
 * A new layer on top of the others (a background goes to the back), visible
 * from the start to the end with a gentle fade in, so what the person adds is
 * seen arriving rather than appearing. `patch` overrides any of it.
 */
export function addLayer(m: Motion, kind: LayerKind, patch: Partial<Layer> = {}, now = Date.now()): { motion: Motion; id: string } {
  if (m.layers.length >= LIMITS.layers) return { motion: m, id: '' };
  const given: Partial<Layer> = patch !== null && typeof patch === 'object' ? patch : {};
  const id = freeId(m, given.id);
  const wanted = {
    id, name: KIND_NAME[kind], start: 0, end: m.seconds,
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
