import type { Motion, Palette, RecipeId, Voice } from './motiontypes';
import { LIMITS, TONES, VOICES } from './motiontypes';
import { META, PALETTES, PALETTE_IDS, type BrandSlot, type PaletteId } from './motionrecipe';
import { cleanText, readPalette } from './motionread';
import { onTemplatePart, setLayer, setPalette } from './motionedit';
import { DISPLAY_VOICE, RECIPES, buildMotion, logoOk, type BuildOptions, type Look } from './motiontemplates';

/**
 * A brand kit: a business's graphics look like its graphics every time,
 * without anyone picking the colours again.
 *
 * One kit, kept on this machine (`motionstore.ts`), set from one small sheet
 * (`MotionBrandKit.tsx`). While it is set, a graphic started from a template
 * starts in the brand's colours and face, and a template that asks for the
 * organisation's name, its account or its logo has them filled in
 * (`kitOptionsWithBrand`); and "Apply brand" re-skins a graphic that already
 * exists (`applyBrand`). With no kit set, nothing anywhere changes: the
 * templates build byte for byte as they did before there were kits
 * (`test/pro-gallery.test.mjs` holds them to it).
 *
 * ## Every part is optional
 *
 * A kit can be only a name, or only colours. What it leaves out leaves the
 * template's own: no palette keeps each template in the palette it was
 * designed in (a kit made only to fill in a name must not turn every graphic
 * midnight blue); the house display face (`DISPLAY_VOICE`) as the voice keeps
 * each template's own faces. A kit with nothing in it is no kit (`readBrand`
 * returns null), so Clear and an emptied form are the same thing.
 *
 * ## Read like everything else
 *
 * The kit is stored and read back, and a stored record may be from an older
 * build or edited by hand, so `readBrand` treats it as input: every string is
 * one clean line under its cap, the logo is a picture the importer could have
 * written or nothing, a palette is five real colours or none, the voice is on
 * the list. It never throws, and reading its own output changes nothing.
 */

export interface BrandKit {
  /** The organisation's name, one line. Empty: none. */
  name: string;
  /** Its account name, without the @. */
  handle: string;
  /** Its web address, as it is printed: no scheme, no trailing slash. */
  url: string;
  /** Its logo, a `data:image/` PNG or JPEG the picture importer wrote, no longer than a picture layer's. */
  logo?: string;
  /** One of the nine palettes, when the colours are one; then `palette` is its five. */
  paletteId: PaletteId | null;
  /** The five colours graphics start in; null leaves every template its own. */
  palette: Palette | null;
  /** The face headlines are set in. `DISPLAY_VOICE` leaves the templates' own. */
  voice: Voice;
}

/** The longest each line of a kit may be, in characters: a name as long as a layer's name, a handle as long as the handle template takes. */
export const BRAND_LIMITS = { name: LIMITS.name, handle: 30, url: 80 } as const;

type Rec = Record<string, unknown>;

/** The value of an own property, never one from the prototype; undefined when reading it throws. */
function own(o: Rec, key: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined;
  } catch {
    return undefined;
  }
}

/** One line: control characters gone, composed, every run of white space one space, trimmed, at most `max` characters. */
function oneLine(x: unknown, max: number): string {
  if (typeof x !== 'string') return '';
  const s = cleanText(x, max * 4).replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

/** An account name as a template draws it: no @ in front (the template draws its own), no spaces. */
function handleOf(x: unknown): string {
  const s = oneLine(x, BRAND_LIMITS.handle * 4).replace(/^[@\uff20\s]+/, '').replace(/\s+/g, '');
  return Array.from(s).slice(0, BRAND_LIMITS.handle).join('');
}

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * A web address as it is printed on a graphic: no scheme in front (every one
 * of them, so `https://http://x` is `x` and reading it again changes nothing),
 * no spaces, cut to length, and then no slash behind.
 */
function urlOf(x: unknown): string {
  let s = oneLine(x, BRAND_LIMITS.url * 4).replace(/\s+/g, '');
  while (SCHEME.test(s)) s = s.replace(SCHEME, '');
  return Array.from(s).slice(0, BRAND_LIMITS.url).join('').replace(/\/+$/, '');
}

/** Two palettes no tone of which agrees, to tell which tones of a given palette were real colours (see `paletteOfKit`). */
const PROBE_A = PALETTES[0].colors;
const PROBE_B: Palette = { bg: '#010203', fg: '#040506', accent: '#070809', accent2: '#0a0b0c', muted: '#0d0e0f' };

/**
 * A kit's colours. A palette's id wins; then five colours, each repaired from
 * the first palette where it does not read — or null when not one of the five
 * reads, which is a kit that chose no colours, not one that chose midnight.
 * Five colours that are exactly one of the nine palettes are that palette.
 */
function paletteOfKit(o: Rec): { paletteId: PaletteId | null; palette: Palette | null } {
  const id = own(o, 'paletteId');
  if (typeof id === 'string' && (PALETTE_IDS as readonly string[]).includes(id)) {
    const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
    return { paletteId: p.id, palette: readPalette(p.colors) };
  }
  const given = own(o, 'palette');
  if (!given || typeof given !== 'object') return { paletteId: null, palette: null };
  const a = readPalette(given, PROBE_A);
  const b = readPalette(given, PROBE_B);
  if (!TONES.some((t) => a[t] === b[t])) return { paletteId: null, palette: null };
  const known = PALETTES.find((p) => {
    const colours = readPalette(p.colors);
    return TONES.every((t) => colours[t] === a[t]);
  });
  return { paletteId: known ? known.id : null, palette: a };
}

/**
 * A brand kit from anything, or null when it is not one or holds nothing (see
 * the header). Never throws; reading what it returns gives the same again.
 */
export function readBrand(x: unknown): BrandKit | null {
  try {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
    const o = x as Rec;
    const logo = own(o, 'logo');
    const voice = own(o, 'voice');
    const kit: BrandKit = {
      name: oneLine(own(o, 'name'), BRAND_LIMITS.name),
      handle: handleOf(own(o, 'handle')),
      url: urlOf(own(o, 'url')),
      ...paletteOfKit(o),
      voice: typeof voice === 'string' && (VOICES as readonly string[]).includes(voice) ? (voice as Voice) : DISPLAY_VOICE,
    };
    if (logoOk(logo)) kit.logo = logo;
    const empty = !kit.name && !kit.handle && !kit.url && !kit.logo && !kit.palette && kit.voice === DISPLAY_VOICE;
    return empty ? null : kit;
  } catch {
    return null;
  }
}

const ARABIC_SCRIPT = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/;

/**
 * A badge's letters from a name: the first letters of its first two words,
 * capitals — "Vylo Tech" is VT, "Vylo" is V — and only the first letter in
 * Arabic script, whose letters join and would not read apart. Empty for no
 * name.
 */
export function initialsOf(name: string): string {
  const words = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const first = Array.from(words[0])[0] ?? '';
  if (ARABIC_SCRIPT.test(words[0]) || words.length < 2) return first.toLocaleUpperCase('en');
  const second = Array.from(words[1])[0] ?? '';
  return ARABIC_SCRIPT.test(second) ? first.toLocaleUpperCase('en') : `${first}${second}`.toLocaleUpperCase('en');
}

/** What a brand kit holds for one slot; empty when it holds nothing there. */
function slotValue(brand: BrandKit, slot: BrandSlot): string {
  if (slot === 'name') return brand.name;
  if (slot === 'handle') return brand.handle;
  if (slot === 'url') return brand.url;
  return initialsOf(brand.name);
}

/**
 * The words a brand puts into a template: every field that takes something of
 * the brand (`Field.brand`) and that the kit has something for. A template
 * with no such field gets nothing.
 */
export function brandFields(recipe: RecipeId, brand: BrandKit): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of META[recipe]?.fields ?? []) {
    if (!f.brand) continue;
    const v = slotValue(brand, f.brand);
    if (v) out[f.key] = v;
  }
  return out;
}

/** The look a kit draws templates in (`Look`), or null when it changes nothing beyond colours and words. */
export function brandLook(brand: BrandKit): Look | null {
  const look: Look = {};
  if (brand.voice !== DISPLAY_VOICE) look.voice = brand.voice;
  if (brand.logo && logoOk(brand.logo)) look.logo = brand.logo;
  return look.voice || look.logo ? look : null;
}

/**
 * How a new graphic is built while a kit is set: the options `buildMotion`
 * takes, with the brand put in where the caller left room for it.
 *
 * - **Colours**: the kit's palette when the caller chose none. A palette the
 *   person picked for this graphic wins over the brand's.
 * - **Words**: the fields that take something of the brand, when the caller
 *   did not give them. The words a person or the model wrote win; and a
 *   badge's letters come from the brand only when the name did, so a logo
 *   reveal of another name does not wear the brand's initials.
 * - **Look**: the kit's face and logo.
 *
 * With no kit, the options are returned as they are, the very object.
 */
export function kitOptionsWithBrand(o: BuildOptions, brand: BrandKit | null | undefined): BuildOptions {
  const kit = brand ? readBrand(brand) : null;
  if (!kit || !META[o.recipe]) return o;
  const given = o.fields ?? {};
  const has = (k: string) => typeof given[k] === 'string';
  const meta = META[o.recipe];
  const named = meta.fields.some((f) => f.brand === 'name' && has(f.key));
  const fill = brandFields(o.recipe, kit);
  const fields: Record<string, string> = { ...given };
  let added = false;
  for (const f of meta.fields) {
    if (!f.brand || has(f.key) || fill[f.key] === undefined) continue;
    if (f.brand === 'initials' && named) continue;
    fields[f.key] = fill[f.key];
    added = true;
  }
  const look = brandLook(kit);
  return {
    ...o,
    ...(added ? { fields } : {}),
    ...(o.palette === undefined && kit.palette ? { palette: kit.palette } : {}),
    ...(look && !o.look ? { look } : {}),
  };
}

/** A layer that has a voice. */
const voiced = (l: Motion['layers'][number]): l is Extract<Motion['layers'][number], { voice: Voice }> =>
  l.kind === 'text' || l.kind === 'counter' || l.kind === 'chart';

const samePalette = (a: Palette, b: Palette) => TONES.every((t) => a[t] === b[t]);

/**
 * A graphic that exists, re-skinned in a brand: its colours, its face, and
 * the words that are the brand's. Applying the same kit twice gives the same
 * graphic back — the very object, when there was nothing to change.
 *
 * - **A template's graphic** (still linked to its template) is built again
 *   once, with its own words but the brand's in the fields that take them, the
 *   kit's palette, face and logo, the way changing its words builds it again
 *   (`motionedit.ts` `setFields`), and keeps everything else it carries —
 *   title, frame, rate, sound, scenes. The face here is the kit's exactly: a
 *   kit that leaves faces alone puts back the template's own.
 * - **A graphic edited by hand** has no template to build from, so it is
 *   changed through `motionedit.ts`: the palette (`setPalette`), and each layer
 *   set in the house display face (`setLayer`) into the kit's. A kit that
 *   leaves faces alone leaves them alone, and its words and logo have no field
 *   to go in.
 */
export function applyBrand(doc: Motion, brand: BrandKit | null | undefined, now: number = Date.now()): Motion {
  const kit = brand ? readBrand(brand) : null;
  if (!kit) return doc;
  // A template that owns only a span (scenes were added after it) is re-skinned for that span alone, and the person's scenes and layers stay.
  if (doc.recipe?.until !== undefined) return onTemplatePart(doc, (part) => applyBrand(part, kit, now));
  const r = doc.recipe;
  if (r && META[r.id] && RECIPES[r.id]) {
    let fresh: Motion;
    try {
      fresh = buildMotion({
        id: doc.id, recipe: r.id, fields: { ...r.fields, ...brandFields(r.id, kit) }, lang: doc.lang, format: doc.format,
        palette: kit.palette ?? doc.palette, seconds: doc.seconds, now: doc.created, request: doc.request, ai: doc.ai, look: brandLook(kit),
      });
    } catch {
      return doc;
    }
    const same = JSON.stringify([fresh.palette, fresh.layers, fresh.recipe]) === JSON.stringify([doc.palette, doc.layers, doc.recipe]);
    return same ? doc : { ...doc, palette: fresh.palette, layers: fresh.layers, recipe: fresh.recipe, updated: now };
  }
  let m = doc;
  if (kit.palette && !samePalette(readPalette(kit.palette), m.palette)) m = setPalette(m, kit.palette, now);
  if (kit.voice !== DISPLAY_VOICE) {
    for (const l of doc.layers) if (voiced(l) && l.voice === DISPLAY_VOICE) m = setLayer(m, l.id, { voice: kit.voice }, now);
  }
  return m;
}
