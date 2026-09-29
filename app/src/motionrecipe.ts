import type { Lang } from './i18n';
import { FORMATS, isRtlLang } from './motiontypes';
import type {
  Anim, BackdropLayer, ChartLayer, CounterLayer, Effect, Format, IconLayer, ImageLayer, Layer, Loop, LoopAnim, Paint, Palette,
  ParticlesLayer, RecipeGroup, RecipeId, ShapeLayer, TextLayer,
} from './motiontypes';
import { blankLayer } from './motionread';

/**
 * What a template is, before it is built: its name, its fields, its palette.
 *
 * The recipes themselves (`motionrecipes-*.ts`) turn fields into layers. What
 * is here is the part everything else needs to know without drawing anything:
 * the gallery names and describes each one, the panel makes a form from its
 * fields, and the model's prompt lists them so a request in words can pick one
 * and fill it in.
 *
 * One table serves all three, so a field added to a recipe appears in the
 * form and in what the model is told at the same moment, and cannot appear in
 * one and not the other.
 */

/**
 * How a field is edited and what it holds. Every value is a string — a
 * document keeps `fields` as `Record<string, string>` — and a recipe reads it
 * as the kind says:
 * - `line`: one line of words.
 * - `text`: a few lines of words.
 * - `number`: digits, with an optional sign and decimal point.
 * - `list`: one item a line, written `Label: value` for a chart or just `Label`
 *   for steps. `max` is the most items.
 * - `choice`: one of `options`.
 */
export type FieldKind = 'line' | 'text' | 'number' | 'list' | 'choice';

export interface Field {
  key: string;
  kind: FieldKind;
  /** The English label, which is also the `i18n.ts` key. */
  label: string;
  /** Characters for `line`, `text` and `number`; items for `list`. */
  max: number;
  /** For the model: what belongs here. Not shown to the person. */
  hint: string;
  options?: readonly string[];
}

export interface RecipeMeta {
  id: RecipeId;
  group: RecipeGroup;
  /** The English name and one-line description, which are also `i18n.ts` keys. */
  name: string;
  about: string;
  /** The gallery's colour for it, as a hue. */
  hue: number;
  /** Its natural length in seconds. */
  seconds: number;
  /** Made to sit over video: the frame is transparent, and the panel says an MP4 cannot keep that. */
  overlay: boolean;
  /** The palette it was designed in. */
  palette: PaletteId;
  fields: readonly Field[];
}

export const PALETTE_IDS = ['midnight', 'paper', 'sunset', 'mint', 'royal', 'mono', 'neon', 'ocean', 'daylight'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export interface PaletteInfo {
  id: PaletteId;
  /** The English name, which is also the `i18n.ts` key. */
  name: string;
  colors: Palette;
}

/**
 * Nine palettes. Each pairs a ground with a text colour that reads on it and
 * two accents that both read on the ground — `test/motiontemplates.test.mjs`
 * checks the contrast — so a graphic re-coloured by choosing another palette
 * stays legible without anyone checking it by eye.
 */
export const PALETTES: readonly PaletteInfo[] = [
  { id: 'midnight', name: 'Midnight', colors: { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' } },
  { id: 'paper', name: 'Ivory', colors: { bg: '#F6F3EC', fg: '#16161A', accent: '#E5484D', accent2: '#2E6BFF', muted: '#6E695F' } },
  { id: 'sunset', name: 'Sunset', colors: { bg: '#1A0F1F', fg: '#FFF3EA', accent: '#FF7A45', accent2: '#FFC24B', muted: '#B79AAE' } },
  { id: 'mint', name: 'Mint', colors: { bg: '#08201C', fg: '#E9FFF6', accent: '#2EE6A6', accent2: '#4CC9F0', muted: '#7FB5A6' } },
  { id: 'royal', name: 'Royal', colors: { bg: '#0E0A2B', fg: '#F4F0FF', accent: '#8B5CF6', accent2: '#22D3EE', muted: '#9C94C8' } },
  { id: 'mono', name: 'Monochrome', colors: { bg: '#0A0A0A', fg: '#FAFAFA', accent: '#FFFFFF', accent2: '#9CA3AF', muted: '#8A8A93' } },
  { id: 'neon', name: 'Neon', colors: { bg: '#06060F', fg: '#F2F2FF', accent: '#00F5D4', accent2: '#FF3D9A', muted: '#8484B0' } },
  { id: 'ocean', name: 'Ocean', colors: { bg: '#06283D', fg: '#EAF7FF', accent: '#1FB6FF', accent2: '#FFD166', muted: '#83A7BD' } },
  { id: 'daylight', name: 'Daylight', colors: { bg: '#FFFFFF', fg: '#101828', accent: '#2563EB', accent2: '#F59E0B', muted: '#667085' } },
];

/** A palette by id; the first when the id is not one. */
export function paletteOf(id: string | undefined): PaletteInfo {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

const line = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'line', label, max, hint });
const text = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'text', label, max, hint });
const number = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'number', label, max, hint });
const list = (key: string, label: string, max: number, hint: string): Field => ({ key, kind: 'list', label, max, hint });

/**
 * Every template. The order is the gallery's order within a group.
 */
export const META: Readonly<Record<RecipeId, RecipeMeta>> = {
  'big-title': {
    id: 'big-title', group: 'titles', name: 'Big title', hue: 262, seconds: 6, overlay: false, palette: 'midnight',
    about: 'A headline that rises line by line over a moving background.',
    fields: [
      line('kicker', 'Small label', 40, 'a tiny label above the headline, 1 to 3 words; may be empty'),
      text('title', 'Title', 90, 'the headline, 3 to 8 words'),
      line('subtitle', 'Subtitle', 100, 'one supporting line under it'),
    ],
  },
  kinetic: {
    id: 'kinetic', group: 'titles', name: 'Kinetic type', hue: 330, seconds: 5, overlay: false, palette: 'neon',
    about: 'Words that slam in one after another, one of them lit up.',
    fields: [
      line('title', 'Title', 60, 'a punchy phrase of 2 to 6 words'),
      line('highlight', 'Highlighted word', 24, 'one word from the title to light up'),
    ],
  },
  'split-title': {
    id: 'split-title', group: 'titles', name: 'Split reveal', hue: 12, seconds: 5, overlay: false, palette: 'sunset',
    about: 'Two colour panels sweep across and the title appears between them.',
    fields: [
      line('title', 'Title', 50, 'the title, 2 to 5 words'),
      line('subtitle', 'Subtitle', 80, 'one supporting line'),
    ],
  },
  quote: {
    id: 'quote', group: 'titles', name: 'Quote card', hue: 292, seconds: 7, overlay: false, palette: 'royal',
    about: 'A quotation that reveals line by line, with who said it.',
    fields: [
      text('quote', 'Quote', 160, 'the quotation, without quotation marks'),
      line('author', 'Author', 40, 'who said it'),
      line('role', 'Role', 50, 'their role or where it is from; may be empty'),
    ],
  },
  'lower-third': {
    id: 'lower-third', group: 'overlays', name: 'Lower third', hue: 205, seconds: 5, overlay: true, palette: 'midnight',
    about: 'A name and a role that slide in over a video.',
    fields: [
      line('name', 'Name', 36, 'a person or place name'),
      line('role', 'Role', 50, 'their role, or one line about them'),
    ],
  },
  subscribe: {
    id: 'subscribe', group: 'overlays', name: 'Subscribe', hue: 0, seconds: 5, overlay: true, palette: 'paper',
    about: 'A button that gets clicked, with a ringing bell.',
    fields: [
      line('label', 'Button', 20, 'the button text, for example Subscribe'),
      line('done', 'After the click', 20, 'the text once it is clicked, for example Subscribed'),
    ],
  },
  callout: {
    id: 'callout', group: 'overlays', name: 'Callout', hue: 48, seconds: 4, overlay: true, palette: 'sunset',
    about: 'A pulsing marker, a line and a label to point at something.',
    fields: [
      line('label', 'Label', 40, 'what is being pointed at'),
      line('number', 'Number', 3, 'a step number or short mark, for example 1'),
    ],
  },
  handle: {
    id: 'handle', group: 'overlays', name: 'Social handle', hue: 175, seconds: 4, overlay: true, palette: 'ocean',
    about: 'Your @name in a pill that slides in and shines.',
    fields: [
      line('handle', 'Handle', 30, 'the account name, without the @'),
      line('caption', 'Caption', 40, 'a few words before it, for example Follow us'),
    ],
  },
  'big-number': {
    id: 'big-number', group: 'data', name: 'Big number', hue: 38, seconds: 5, overlay: false, palette: 'midnight',
    about: 'A number that counts up inside a ring.',
    fields: [
      number('value', 'Number', 12, 'the number to count up to, digits only'),
      line('prefix', 'Before the number', 4, 'a symbol before it, for example $; may be empty'),
      line('suffix', 'After the number', 4, 'a symbol after it, for example % or +; may be empty'),
      line('label', 'Label', 60, 'what the number measures'),
    ],
  },
  'bar-chart': {
    id: 'bar-chart', group: 'data', name: 'Bar chart', hue: 142, seconds: 6, overlay: false, palette: 'mint',
    about: 'Bars that grow one after another with their values.',
    fields: [
      line('title', 'Title', 60, 'what the chart shows'),
      list('items', 'Bars', 8, 'one bar per line written Label: value, for example Q1: 40'),
      line('unit', 'Unit', 6, 'written after each value, for example % or k; may be empty'),
    ],
  },
  donut: {
    id: 'donut', group: 'data', name: 'Donut chart', hue: 320, seconds: 6, overlay: false, palette: 'royal',
    about: 'A ring divided by share, sweeping around.',
    fields: [
      line('title', 'Title', 60, 'what the chart shows'),
      list('items', 'Slices', 6, 'one slice per line written Label: value'),
    ],
  },
  'line-chart': {
    id: 'line-chart', group: 'data', name: 'Line chart', hue: 195, seconds: 6, overlay: false, palette: 'ocean',
    about: 'A line that draws itself across the data.',
    fields: [
      line('title', 'Title', 60, 'what the chart shows'),
      list('items', 'Points', 12, 'one point per line written Label: value, in order'),
      line('unit', 'Unit', 6, 'written after the last value; may be empty'),
    ],
  },
  stats: {
    id: 'stats', group: 'data', name: 'Three numbers', hue: 24, seconds: 6, overlay: false, palette: 'midnight',
    about: 'Three figures with icons that count up together.',
    fields: [
      line('title', 'Title', 60, 'a heading over the three figures'),
      list('items', 'Figures', 3, 'exactly three lines written Label: value, for example Students: 1200'),
    ],
  },
  'logo-reveal': {
    id: 'logo-reveal', group: 'brand', name: 'Logo reveal', hue: 252, seconds: 5, overlay: false, palette: 'royal',
    about: 'A badge that bursts open and shines, with your name.',
    fields: [
      line('name', 'Name', 30, 'the brand or organisation name'),
      line('tagline', 'Tagline', 60, 'a short line under it; may be empty'),
      line('mark', 'Badge letters', 2, 'one or two letters for the badge, usually the initials'),
    ],
  },
  countdown: {
    id: 'countdown', group: 'brand', name: 'Countdown', hue: 8, seconds: 4, overlay: false, palette: 'neon',
    about: 'Numbers that count down with a ring, ending in a burst.',
    fields: [
      number('from', 'Start from', 2, 'the number to start from, 3 to 10'),
      line('final', 'Last word', 12, 'the word after zero, for example GO'),
    ],
  },
  intro: {
    id: 'intro', group: 'brand', name: 'Intro sting', hue: 280, seconds: 4, overlay: false, palette: 'sunset',
    about: 'A quick sweep of colour that lands your title.',
    fields: [
      line('title', 'Title', 40, 'the title, 1 to 4 words'),
      line('subtitle', 'Subtitle', 60, 'a short line under it; may be empty'),
    ],
  },
  steps: {
    id: 'steps', group: 'titles', name: 'Steps', hue: 165, seconds: 7, overlay: false, palette: 'mint',
    about: 'A list that builds itself, one numbered step at a time.',
    fields: [
      line('title', 'Title', 60, 'a heading over the steps'),
      list('items', 'Steps', 5, 'one step per line, a few words each'),
    ],
  },
  'loop-bg': {
    id: 'loop-bg', group: 'backgrounds', name: 'Loop background', hue: 228, seconds: 8, overlay: false, palette: 'midnight',
    about: 'A moving background that repeats without a seam.',
    fields: [
      { key: 'style', kind: 'choice', label: 'Style', max: 12, hint: 'the look of the background',
        options: ['aurora', 'grid', 'dots', 'rays', 'waves', 'bokeh', 'stripes'] },
    ],
  },
};

/** The recipes of a group, in gallery order. */
export function recipesOf(group: RecipeGroup): RecipeMeta[] {
  return (Object.values(META) as RecipeMeta[]).filter((m) => m.group === group);
}

// ── the kit a recipe builds with ──────────────────────────────────────────

/**
 * The family's timing. Every recipe takes its durations from here, so the
 * templates move as one hand: an entrance is a beat and a bit, a stagger is a
 * fraction of it, an exit is quicker than the entrance it undoes. Changing the
 * feel of every template at once is a change to this table.
 */
export const T = {
  /** A whole entrance: a rise, a mask, a slide, a wipe. */
  enter: 0.7,
  /** A small entrance: a badge, an icon, a rule. */
  quick: 0.45,
  /** An exit. Quicker than the entrance it undoes. */
  exit: 0.45,
  /** Between one word, line or item and the next. */
  gap: 0.07,
  /** A beat: the pause between two ideas. */
  beat: 0.6,
  /** How much of one entrance has played when the next begins. */
  overlap: 0.55,
} as const;

/** The family's curves, by role. */
export const E = {
  enter: 'expo-out',
  pop: 'back-out',
  soft: 'soft',
  // An exit runs the entrance's curve on reversed time, so a curve that eases OUT
  // (fast, then settling) makes a graphic leave slowly and then quickly. 'in' here
  // did the opposite — a fast start and a sliver that lingered for the last
  // fraction of a second.
  exit: 'out',
  spring: 'spring',
  snap: 'snappy',
} as const;

/**
 * What a recipe is handed to build with. The layer makers return valid layers
 * (they go through `blankLayer`, which reads what it makes), with stable ids:
 * a recipe built again for another shape gives each layer the id it had, so the
 * person's selection survives a change of format.
 */
export interface Kit {
  recipe: RecipeId;
  lang: Lang;
  rtl: boolean;
  format: Format;
  palette: Palette;
  seconds: number;
  /** The frame's size in u (1u is 1% of the short side): landscape is 177.8 wide by 100 tall, portrait 100 wide by 177.8 tall, square 100 by 100, feed 100 by 125. */
  u: { w: number; h: number };
  landscape: boolean;
  portrait: boolean;
  square: boolean;
  /** 4:5. */
  feed: boolean;
  /** Taller than wide: portrait and feed. */
  tall: boolean;
  /** The fields, resolved: the person's words or the sample's, trimmed and capped. */
  fields: Record<string, string>;
  /** A number made from the fields, for anything that varies but must not change between renders. */
  seed: number;
  /** When an exit that ends the graphic begins. */
  exitAt: number;
  id(name: string): string;
  text(name: string, o?: Partial<TextLayer>): TextLayer;
  shape(name: string, o?: Partial<ShapeLayer>): ShapeLayer;
  icon(name: string, o?: Partial<IconLayer>): IconLayer;
  counter(name: string, o?: Partial<CounterLayer>): CounterLayer;
  chart(name: string, o?: Partial<ChartLayer>): ChartLayer;
  backdrop(name: string, o?: Partial<BackdropLayer>): BackdropLayer;
  particles(name: string, o?: Partial<ParticlesLayer>): ParticlesLayer;
  image(name: string, o?: Partial<ImageLayer>): ImageLayer;
  /** An entrance with the family's defaults. */
  enter(fx: Effect, o?: Partial<Anim>): Anim;
  /** An exit with the family's defaults. */
  leave(fx: Effect, o?: Partial<Anim>): Anim;
  loop(fx: Loop, o?: Partial<LoopAnim>): LoopAnim;
}

/** What a recipe is, apart from its metadata. */
export interface Recipe {
  build(c: Kit): Layer[];
  /** Words to fill the fields with when the person has given none, per language. */
  sample: Record<Lang, Record<string, string>>;
  /** The frame's own paint. Default: the `bg` tone, or transparent for an overlay. */
  backdrop?: Paint | null;
}

/** A small stable hash of some text: FNV-1a, so the same words always make the same number. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const titled = (s: string) => s.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Everything a recipe needs to know about the graphic being built. */
export interface KitOptions {
  recipe: RecipeId;
  lang: Lang;
  format: Format;
  palette: Palette;
  seconds: number;
  fields: Record<string, string>;
}

export function makeKit(o: KitOptions): Kit {
  const size = FORMATS[o.format] ?? FORMATS.landscape;
  const short = Math.min(size.width, size.height);
  const u = { w: (size.width / short) * 100, h: (size.height / short) * 100 };
  const seed = hashOf(`${o.recipe}|${o.lang}|${Object.keys(o.fields).sort().map((k) => `${k}=${o.fields[k]}`).join('|')}`);
  const seconds = o.seconds;
  const make = <L extends Layer>(kind: L['kind'], name: string, more: Partial<L> | undefined, defaults: Partial<L> = {}): L =>
    blankLayer(kind, { id: `${o.recipe}-${name}`, name: titled(name), start: 0, end: seconds, ...defaults, ...more } as Partial<Layer>) as L;
  return {
    recipe: o.recipe,
    lang: o.lang,
    rtl: isRtlLang(o.lang),
    format: o.format,
    palette: o.palette,
    seconds,
    u,
    landscape: o.format === 'landscape',
    portrait: o.format === 'portrait',
    square: o.format === 'square',
    feed: o.format === 'feed',
    tall: size.height > size.width,
    fields: o.fields,
    seed,
    exitAt: Math.max(0, seconds - T.exit),
    id: (name) => `${o.recipe}-${name}`,
    text: (name, more) => make<TextLayer>('text', name, more),
    shape: (name, more) => make<ShapeLayer>('shape', name, more),
    icon: (name, more) => make<IconLayer>('icon', name, more),
    counter: (name, more) => make<CounterLayer>('counter', name, more),
    chart: (name, more) => make<ChartLayer>('chart', name, more),
    backdrop: (name, more) => make<BackdropLayer>('backdrop', name, more, { seed: (seed % 997) + 1 }),
    particles: (name, more) => make<ParticlesLayer>('particles', name, more, { seed: (seed % 991) + 1 }),
    image: (name, more) => make<ImageLayer>('image', name, more),
    enter: (fx, more) => ({ fx, d: T.enter, delay: 0, ease: E.enter, amount: 1, ...more }),
    leave: (fx, more) => ({ fx, d: T.exit, delay: 0, ease: E.exit, amount: 1, ...more }),
    loop: (fx, more) => ({ fx, d: 4, amount: 1, ...more }),
  };
}
