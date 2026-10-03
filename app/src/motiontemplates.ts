import type { Lang } from './i18n';
import type { Format, Motion, Palette, RecipeId } from './motiontypes';
import { LIMITS } from './motiontypes';
import { META, makeKit, paletteOf, type Field, type PaletteId, type Recipe } from './motionrecipe';
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
  const layers = recipe ? recipe.build(kit) : [];
  const backdrop = recipe && recipe.backdrop !== undefined ? recipe.backdrop : meta.overlay ? null : 'bg';
  const made = readMotion({
    id: o.id, title: titleFor(o.recipe, fields), request: o.request ?? '', lang: o.lang, format: o.format, fps: 30, seconds,
    palette, backdrop, layers, recipe: { id: o.recipe, fields }, ai: o.ai === true, stage: 'ready', created: now, updated: now,
  }, now);
  if (!made) throw new Error(`motion: recipe ${o.recipe} did not build`);
  return made;
}
