import type { Lang } from './i18n';
import type { Fps, Format, Layer, LayerKind, Motion, Paint, Palette, RecipeRef } from './motiontypes';
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
 *
 * ## A template owns a span (pro pass, F1)
 *
 * "+ Scene" at the end of a template graphic used to end the template: the
 * scene moves time, and a rebuild laid the template over the whole graphic,
 * so the next word typed would have spread the title across the new scene.
 * Now the template owns the time it was made for and the scenes added after
 * it are the person's: `RecipeRef.until` says where its part ends (absent is
 * the whole graphic, every graphic stored before this, read exactly as
 * before). motionscene.ts `addScene` sets it when a scene is added at or
 * after the template's end; one added inside the template's time still ends
 * the template.
 *
 * - **A rebuild** (new words, shape or language; the chat's; a brand applied
 *   through `onTemplatePart`) builds the template for `until` seconds and puts
 *   it back in place of the template's part: the layers that start before
 *   `until`. The person's layers — those starting at `until` or later — stay
 *   exactly where they are in time, and in the stack just above the template
 *   layer they were above. A template layer that ran on past `until` (the
 *   background "+ Scene" carried through the new scene) runs on as far again.
 *   The graphic keeps its length, scenes, sound and brand look.
 * - **The length** (`setSeconds`): longer, or shorter but still past `until`,
 *   is the person's part growing or shrinking as a graphic edited by hand
 *   does, and the template's part is not touched. A length that cuts into the
 *   template's time ends the span: with nothing of the person's after it the
 *   template is built again for the new length as a whole; with layers of the
 *   person's there, there is no honest rebuild, and the link is dropped.
 * - **A change by hand** (`setLayer`, `addLayer`, `removeLayer`,
 *   `duplicateLayer`, `moveLayer`; `byHand`) keeps the link when it leaves
 *   the template's part exactly as it was — a text added to the new scene, a
 *   layer of the person's moved, retimed within their scenes or removed — and
 *   drops it, as always, when it touches a template layer or brings a layer
 *   into the template's time.
 */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const stamp = (m: Motion, now: number): Motion => ({ ...m, updated: now });
/** A hair: two times this close are the same moment (motionscene.ts uses the same). */
const EPS = 1e-6;
const J = (x: unknown): string => JSON.stringify(x);

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

/** A layer of the person's in a graphic whose template's part ends at `until`: one that starts there or later. */
const ownLayer = (l: Layer, until: number): boolean => l.start >= until - EPS;

/** The link without its span: the template as a whole graphic's. Keys in the reader's order. */
const wholeRef = (r: RecipeRef): RecipeRef => ({ id: r.id, fields: r.fields });

/**
 * The template's part of a graphic whose template owns a span, as a graphic
 * of its own: `until` seconds long, the layers that start before `until` (one
 * that ran on past it cut back to it, as the template built it), the link
 * without the span, and no scenes or sound. What `onTemplatePart` hands an
 * edit that builds the template again.
 */
function partOf(m: Motion, r: RecipeRef, until: number): Motion {
  const layers = m.layers
    .filter((l) => !ownLayer(l, until))
    .map((l) => (l.end > until + EPS ? readLayer({ ...l, end: until }, { seconds: until }) ?? l : l));
  const part: Motion = { ...m, seconds: until, layers, recipe: wholeRef(r) };
  delete part.scenes;
  delete part.sound;
  return part;
}

/**
 * `done` — the template's part after an edit built it again — put back into
 * `m` in place of the part it was made from (the header's "A template owns a
 * span"): the template's new layers, each that ran on past `until` before
 * running on as far again; the person's layers where they were in time, and
 * in the stack just above the template layer that was below them (at the
 * bottom when none was), or the very object `m` when that would pass
 * `LIMITS.layers`. The length, the span, the scenes and the sound are `m`'s;
 * everything else the template decides (words, shape, language, palette) is
 * `done`'s. The particles' budget is spent in order, as the reader spends it.
 */
function rejoin(m: Motion, until: number, done: Motion): Motion {
  const r = done.recipe;
  if (!r) return m;
  const made = new Set(done.layers.map((l) => l.id));
  const before = new Map(m.layers.map((l) => [l.id, l]));
  const bottom: Layer[] = [];
  const above = new Map<string, Layer[]>();
  let under: string | null = null;
  for (const l of m.layers) {
    // A layer with an id the template makes is the template's, wherever it is: it is never kept twice.
    if (made.has(l.id)) under = l.id;
    else if (ownLayer(l, until)) {
      if (under === null) bottom.push(l);
      else above.set(under, [...(above.get(under) ?? []), l]);
    }
  }
  const layers: Layer[] = [];
  const put = (l: Layer) => layers.push(fitParticles(l, layers));
  bottom.forEach(put);
  for (const f of done.layers) {
    const was = before.get(f.id);
    const runsOn = was && was.end > until + EPS && f.end >= until - EPS;
    put(runsOn ? readLayer({ ...f, end: was.end }, { seconds: m.seconds }) ?? f : f);
    (above.get(f.id) ?? []).forEach(put);
  }
  if (layers.length > LIMITS.layers) return m;
  const next: Motion = { ...done, seconds: m.seconds, layers, recipe: { ...r, until } };
  if (m.sound) next.sound = m.sound;
  else delete next.sound;
  return withScenes(next, scenesFor(m, layers, m.seconds));
}

/**
 * Apply `edit` — a change that builds the template again: new words, a new
 * shape or language, a brand kit (motionbrand.ts `applyBrand`) — to the
 * template's part of a graphic, and put the result back. A graphic whose
 * template owns the whole of it (no `until`) is simply handed to `edit`, so
 * it changes exactly as it always did. Otherwise `edit` sees the template's
 * part as a graphic of its own (`partOf`) and what it returns is put back
 * (`rejoin`): the person's scenes and layers, the length, the scenes and the
 * sound stay. `m` itself when the edit changed nothing, or did not give back
 * the same template for the same time.
 */
export function onTemplatePart(m: Motion, edit: (part: Motion) => Motion): Motion {
  const r = m.recipe;
  const until = r?.until;
  if (!r || until === undefined) return edit(m);
  const part = partOf(m, r, until);
  const done = edit(part);
  if (done === part || done.recipe?.id !== r.id || Math.abs(done.seconds - until) > EPS) return m;
  return rejoin(m, until, done);
}

/**
 * The template link after a change made by hand from `before` to `after`
 * (the header's "A template owns a span"): dropped, as it always was, unless
 * the template owns a span and the change left its part exactly as it was —
 * the same layers starting before `until`, unchanged and in the same order,
 * and the same length. Then the change was to the person's scenes, which a
 * rebuild keeps.
 */
export function byHand(before: Motion, after: Motion): Motion {
  const until = before.recipe?.until;
  if (until === undefined || !after.recipe || after.recipe !== before.recipe || after.seconds !== before.seconds) return detach(after);
  const was = before.layers.filter((l) => !ownLayer(l, until));
  const now = after.layers.filter((l) => !ownLayer(l, until));
  const kept = was.length === now.length && was.every((l, i) => l === now[i] || J(l) === J(now[i]));
  return kept ? after : detach(after);
}

/**
 * Build a template graphic again with some of its settings changed, keeping
 * what the person chose: the title, rate, frame and dates as before, and its
 * sound, scenes and brand look (the header's "What a rebuild keeps"). A
 * template that owns a span is built again for that span only
 * (`onTemplatePart`); the length is never changed that way (`setSeconds`).
 */
function rebuild(m: Motion, patch: { fields?: Record<string, string>; lang?: Lang; format?: Format; seconds?: number }, now: number): Motion {
  if (!m.recipe) return m;
  return onTemplatePart(m, (part) => {
    const r = part.recipe;
    if (!r) return part;
    const fresh = buildMotion({
      id: part.id, recipe: r.id, fields: patch.fields ?? r.fields, lang: patch.lang ?? part.lang, format: patch.format ?? part.format,
      palette: part.palette, seconds: patch.seconds ?? part.seconds, now: part.created, request: part.request, ai: part.ai, look: lookOf(part),
    });
    const next: Motion = {
      ...fresh, title: part.title, fps: part.fps, backdrop: part.backdrop, stage: part.stage, error: part.error, created: part.created, updated: now,
    };
    if (part.sound) next.sound = part.sound;
    // Where its facts came from stays with it through a hand edit of its words, shape, language or length.
    if (part.sources) next.sources = part.sources;
    return withScenes(next, scenesFor(part, fresh.layers, fresh.seconds));
  });
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
 *
 * A template that owns a span (`RecipeRef.until`) keeps it while the new
 * length is past it: the person's scenes change as a graphic edited by hand
 * does, and the template's part is left as it is. A length that cuts into the
 * template's time builds the template again for it as a whole, when nothing
 * after the span is the person's; when something is, there is no honest
 * rebuild, and the link is dropped.
 */
export function setSeconds(m: Motion, seconds: number, now = Date.now()): Motion {
  const s = clamp(Math.round((Number.isFinite(seconds) ? seconds : m.seconds) * 10) / 10, LIMITS.minSeconds, LIMITS.seconds);
  if (s === m.seconds) return m;
  const r = m.recipe;
  const until = r?.until;
  let doc = m;
  if (r && until === undefined) return rebuild(m, { seconds: s }, now);
  if (r && until !== undefined && s <= until + EPS) {
    if (!m.layers.some((l) => ownLayer(l, until))) return rebuild({ ...m, recipe: wholeRef(r) }, { seconds: s }, now);
    doc = detach(m);
  }
  const layers = doc.layers.map((l): Layer => {
    const toEnd = l.end >= m.seconds - 1e-6;
    const end = toEnd ? s : Math.min(l.end, s);
    const start = Math.min(l.start, Math.max(0, end - 0.05));
    return readLayer({ ...l, start, end }, { seconds: s }) ?? l;
  });
  return withScenes(stamp({ ...doc, seconds: s, layers }, now), scenesFor(doc, layers, s));
}

export function setPalette(m: Motion, colors: Palette, now = Date.now()): Motion {
  return stamp({ ...m, palette: readPalette(colors, m.palette) }, now);
}

export function setBackdrop(m: Motion, paint: Paint | null, now = Date.now()): Motion {
  return stamp({ ...m, backdrop: paint }, now);
}

/**
 * Change fields of one layer. Read again, so nothing out of range survives;
 * the graphic stops being a template's, unless the layer is the person's own
 * in a template that owns a span and stays out of the template's time
 * (`byHand`).
 */
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
  return stamp(byHand(m, { ...m, layers }), now);
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
  return { motion: stamp(byHand(m, { ...m, layers }), now), id };
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
 *
 * A template that owns a span: the layer `addLayer` made ran the whole
 * graphic, through the template's time, and so cost the graphic its template.
 * When the change did nothing else, and the layer now runs through one of the
 * person's scenes, the link comes back (`byHand` on the change as placed): the
 * layer never was in the template's time.
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
  if (!moved) return after;
  const placed = { ...after, layers };
  if (before.recipe?.until === undefined || after.recipe || J({ ...after, layers: [], updated: 0 }) !== J({ ...detach(before), layers: [], updated: 0 })) return placed;
  const relinked = byHand(before, { ...before, layers, updated: after.updated });
  return relinked.recipe ? relinked : placed;
}

export function removeLayer(m: Motion, id: string, now = Date.now()): Motion {
  if (!m.layers.some((l) => l.id === id)) return m;
  return stamp(byHand(m, { ...m, layers: m.layers.filter((l) => l.id !== id) }), now);
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
  return { motion: stamp(byHand(m, { ...m, layers }), now), id: copyId };
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
  return stamp(byHand(m, { ...m, layers }), now);
}
