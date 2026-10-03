import type { Lang } from './i18n';
import type { Format, ImageLayer, Layer, Motion, Palette, RecipeId, Voice } from './motiontypes';
import { LIMITS, VOICES } from './motiontypes';
import { META, makeKit, paletteOf, type Field, type Kit, type LogoSlot, type PaletteId, type Recipe } from './motionrecipe';
import { readMotion } from './motionread';
import { TITLE_RECIPES } from './motionrecipes-titles';
import { OVERLAY_RECIPES } from './motionrecipes-overlays';
import { DATA_RECIPES } from './motionrecipes-data';
import { PRO_A_RECIPES } from './motionrecipes-pro-a';
import { PRO_B_RECIPES } from './motionrecipes-pro-b';

/**
 * The templates, assembled: a graphic built from a recipe and a few words.
 *
 * The recipes live in three files by kind (`motionrecipes-*.ts`), so no file is
 * the length of a novel and the people making them do not share one. This puts
 * them together and is the one way in: everything that starts a graphic from a
 * template — the gallery, the model's plan, a change of shape or language —
 * comes through `buildMotion`, so they all resolve the fields, pick the
 * palette and read the result the same way.
 *
 * ## A recipe is rebuilt, never patched
 *
 * Changing a template graphic's words, shape, language or length builds it
 * again from the recipe rather than editing the layers it made. The layout is
 * then always what the designer drew for that shape, not a stretched copy of
 * another; and because every layer's id is derived from its name, the person's
 * selection survives the rebuild. Editing a layer by hand is what breaks the
 * link (`motionedit.ts`): from then on there is no recipe to rebuild from and
 * the layers are theirs.
 */

export const RECIPES: Readonly<Partial<Record<RecipeId, Recipe>>> = { ...TITLE_RECIPES, ...OVERLAY_RECIPES, ...DATA_RECIPES, ...PRO_A_RECIPES, ...PRO_B_RECIPES };

const WORDS_PER_LINE = 80;

/** The sample words for a recipe in a language, falling back to English. */
export function sampleFields(id: RecipeId, lang: Lang): Record<string, string> {
  const r = RECIPES[id];
  return { ...(r?.sample.en ?? {}), ...(r?.sample[lang] ?? {}) };
}

/** A value cut to what its field allows: characters for a line, lines for a list. */
function fitted(field: Field, raw: string): string {
  const clean = raw.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').normalize('NFC');
  if (field.kind === 'list') {
    return clean.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, field.max).map((l) => Array.from(l).slice(0, WORDS_PER_LINE).join('')).join('\n');
  }
  if (field.kind === 'choice') return field.options?.includes(clean.trim()) ? clean.trim() : (field.options?.[0] ?? '');
  const one = field.kind === 'text' ? clean : clean.replace(/\n+/g, ' ');
  return Array.from(one.trim()).slice(0, field.max).join('');
}

/** Fields drawn against a template's figures: the mark before a number, the one after it, a chart's unit. */
const AFFIXES: ReadonlySet<string> = new Set(['prefix', 'suffix', 'unit']);

/**
 * Every field of a recipe, with a value. A field the person has not given —
 * absent, not empty — takes the sample's words for the language, so a template
 * started with nothing typed is a complete, readable example. A field given as
 * an empty string stays empty: clearing the small label above a headline is a
 * choice, and refilling it would undo it.
 *
 * The example's figures are one unit with their marks: once any figure field
 * (a number or a list) is given, a prefix, suffix or unit that is not given is
 * empty rather than the example's, so 1200 students written with no suffix is
 * not "1,200%" and a chart of visitors is not in the example's thousands. The
 * fields this returns hold every key, so a graphic built again from them (a
 * new shape, a new language) comes out the same.
 */
export function resolveFields(id: RecipeId, given: Record<string, string> | undefined, lang: Lang): Record<string, string> {
  const meta = META[id];
  const sample = sampleFields(id, lang);
  const valueOf = (key: string) => (given && typeof given[key] === 'string' ? given[key] : undefined);
  const figures = meta.fields.some((f) => (f.kind === 'number' || f.kind === 'list') && valueOf(f.key) !== undefined);
  const out: Record<string, string> = {};
  for (const f of meta.fields) {
    const v = valueOf(f.key);
    out[f.key] = fitted(f, v ?? (figures && AFFIXES.has(f.key) ? '' : sample[f.key] ?? ''));
  }
  return out;
}

export interface BuildOptions {
  id: string;
  recipe: RecipeId;
  fields?: Record<string, string>;
  lang: Lang;
  format: Format;
  /** A palette by id, or five colours. Default: the recipe's own. */
  palette?: PaletteId | Palette;
  seconds?: number;
  now?: number;
  request?: string;
  ai?: boolean;
  /** How a brand draws it beyond its palette and words (`Look`). Absent or null: exactly as the recipe draws it. */
  look?: Look | null;
}

// ── a brand's look ────────────────────────────────────────────────────────

/**
 * What a brand changes in how a template is drawn, beyond the palette and the
 * words (which `BuildOptions` already carries): the face its headlines are set
 * in, and its logo, in a template with a place for one (`RecipeMeta.logo`).
 * `motionbrand.ts` makes one from a brand kit; `lookOf` reads one back from a
 * graphic, so a template built again — new words, a new shape — keeps it.
 */
export interface Look {
  voice?: Voice;
  /** A `data:image/` PNG or JPEG, as the picture importer writes one. */
  logo?: string;
}

/**
 * The house's display face: every recipe sets its headline, a badge's letters
 * and a countdown's numbers in `bold`, and its body, labels and figures in
 * `sans`. A brand's voice takes the place of this one and of no other, so
 * reading stays as the designer set it, and the templates whose whole look is
 * a typeface — kinetic type's condensed words, the quote card's serif, the
 * subscribe button's rounded label — keep theirs. Every layer set in it is
 * fitted to its box (`fit`), so a wider face shrinks to the room the layout
 * measured instead of running out of it.
 */
export const DISPLAY_VOICE: Voice = 'bold';

/** A layer set in a voice, the kinds that have one. */
type Voiced = Extract<Layer, { voice: Voice }>;
const voiced = (l: Layer): l is Voiced => l.kind === 'text' || l.kind === 'counter' || l.kind === 'chart';

/** A logo the reader will keep: the picture importer's own two formats, inside the picture limit (`motionread.ts` reads a source the same way). */
export function logoOk(x: unknown): x is string {
  return typeof x === 'string' && x.length <= LIMITS.image && /^data:image\/(?:png|jpeg);base64,/i.test(x.slice(0, 32));
}

/**
 * A recipe's layers with the logo in its slot: a picture with the slot
 * layer's place in the stack, its box, its time on screen, its entrance, exit
 * and loop, and its shadow — fitted whole (`contain`) with square corners, so
 * a logo on a transparent ground is its own outline and casts its own shadow
 * (`motiondraw.ts`) — and without the layers that drew what the logo replaces.
 * A recipe that did not make the slot's layer (a shape it leaves out) is left
 * as it is.
 */
function withLogo(c: Kit, layers: readonly Layer[], slot: LogoSlot, src: string): Layer[] {
  const at = layers.findIndex((l) => l.id === c.id(slot.layer));
  if (at < 0) return layers.slice();
  const from = layers[at];
  const side = 'w' in from && 'h' in from ? { w: from.w, h: from.h } : { w: 30, h: 30 };
  const logo: ImageLayer = c.image('logo', {
    src, ...side, fit: 'contain', radius: 0,
    pin: from.pin, x: from.x, y: from.y, scale: from.scale, rot: from.rot, opacity: from.opacity, start: from.start, end: from.end,
    ...(from.in ? { in: from.in } : {}), ...(from.out ? { out: from.out } : {}), ...(from.loop ? { loop: from.loop } : {}),
    ...(from.shadow ? { shadow: from.shadow } : {}),
  });
  const gone = new Set((slot.drop ?? []).map((name) => c.id(name)));
  return layers.flatMap((l, i) => (i === at ? [logo] : gone.has(l.id) ? [] : [l]));
}

/** The layers a recipe built, drawn in a look: the display face swapped for the brand's, and the logo in its slot. */
function styled(c: Kit, layers: Layer[], look: Look): Layer[] {
  const voice = look.voice && (VOICES as readonly string[]).includes(look.voice) ? look.voice : null;
  let out = voice && voice !== DISPLAY_VOICE
    ? layers.map((l): Layer => (voiced(l) && l.voice === DISPLAY_VOICE ? { ...l, voice } : l))
    : layers;
  const slot = META[c.recipe]?.logo;
  if (slot && logoOk(look.logo)) out = withLogo(c, out, slot, look.logo);
  return out;
}

/**
 * The look a template graphic is drawn in, read from its layers: what a
 * rebuild (`motionedit.ts`, `motionchatops.ts`) passes to `buildMotion` so new
 * words or a new shape do not take the brand's face and logo away. The logo is
 * the picture in the template's logo slot; the voice is the face its display
 * layers now have, found by building the template plainly and comparing the
 * layers it sets in `DISPLAY_VOICE` with the graphic's, id by id (the ids are
 * stable). Null for a graphic with no template, or one drawn as the recipe
 * draws it.
 */
export function lookOf(m: Motion): Look | null {
  const r = m.recipe;
  if (!r || !META[r.id] || !RECIPES[r.id]) return null;
  const look: Look = {};
  const logo = m.layers.find((l) => l.id === `${r.id}-logo` && l.kind === 'image');
  if (logo && logo.kind === 'image' && META[r.id].logo && logoOk(logo.src)) look.logo = logo.src;
  let plain: Motion | null = null;
  try {
    plain = buildMotion({ id: m.id, recipe: r.id, fields: r.fields, lang: m.lang, format: m.format, palette: m.palette, seconds: m.seconds, now: 0 });
  } catch {
    plain = null;
  }
  const mine = new Map(m.layers.map((l) => [l.id, l]));
  for (const l of plain?.layers ?? []) {
    if (!voiced(l) || l.voice !== DISPLAY_VOICE) continue;
    const now = mine.get(l.id);
    if (now && voiced(now) && now.voice !== DISPLAY_VOICE) {
      look.voice = now.voice;
      break;
    }
  }
  return look.voice || look.logo ? look : null;
}

/** What to call a graphic before the person names it: its first line of words, else the template's name. */
function titleFor(id: RecipeId, fields: Record<string, string>): string {
  for (const key of ['title', 'name', 'quote', 'label', 'handle', 'value']) {
    const v = fields[key];
    if (v) return Array.from(v.split('\n')[0]).slice(0, LIMITS.title).join('');
  }
  return META[id].name;
}

/** A graphic from a recipe, its fields, and a shape, language and palette. */
export function buildMotion(o: BuildOptions): Motion {
  const meta = META[o.recipe];
  const recipe = RECIPES[o.recipe];
  const now = o.now ?? Date.now();
  const palette = typeof o.palette === 'object' && o.palette ? o.palette : paletteOf(o.palette ?? meta.palette).colors;
  const seconds = Math.min(LIMITS.seconds, Math.max(LIMITS.minSeconds, Number.isFinite(o.seconds) ? (o.seconds as number) : meta.seconds));
  const fields = resolveFields(o.recipe, o.fields, o.lang);
  const kit = makeKit({ recipe: o.recipe, lang: o.lang, format: o.format, palette, seconds, fields });
  const built = recipe ? recipe.build(kit) : [];
  // With no look this is the recipe's own list, untouched: a graphic with no brand builds as it always did.
  const layers = o.look ? styled(kit, built, o.look) : built;
  const backdrop = recipe && recipe.backdrop !== undefined ? recipe.backdrop : meta.overlay ? null : 'bg';
  const made = readMotion({
    id: o.id, title: titleFor(o.recipe, fields), request: o.request ?? '', lang: o.lang, format: o.format, fps: 30, seconds,
    palette, backdrop, layers, recipe: { id: o.recipe, fields }, ai: o.ai === true, stage: 'ready', created: now, updated: now,
  }, now);
  if (!made) throw new Error(`motion: recipe ${o.recipe} did not build`);
  return made;
}
