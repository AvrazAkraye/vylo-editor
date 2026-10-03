import type { Lang } from './i18n';
import { dirFor } from './rtl';
import type { IconId } from './videotypes';
import { PRO_A_IDS, PRO_B_IDS } from './motionids';
import type { SoundSpec } from './motionsound';
import type { SceneSpec } from './motionscene';

export type { IconId } from './videotypes';
export { ICON_IDS } from './videotypes';

/**
 * What a motion graphic is, and the closed vocabulary it is written in.
 *
 * This file is the contract every other `motion*.ts` is written against, and
 * docs/MOTION.md is the prose version of it. It holds no behaviour beyond a
 * few pure lookups: the document (`Motion`), the words a model or a person may
 * choose from (`EFFECTS`, `EASES`, `VOICES`, …), the limits every reader
 * enforces (`LIMITS`), and the two small interfaces the drawing files pass each
 * other (`Env`, `Pose`).
 *
 * ## Why the vocabulary is closed
 *
 * The model writes a graphic as JSON, and `motionread.ts` reads it. A field
 * that can hold any word is a field that can hold a word nothing draws, so
 * every choice here is a union from a list: an unknown word is repaired to the
 * default, never trusted. That is also what keeps the Motion studio inside
 * SAFETY.md's rule, since nothing the model wrote can be anything but a choice
 * from these lists and a number inside these limits.
 *
 * ## Units
 *
 * Everything that has a size is in **u**: 1u is 1% of the frame's short side,
 * so 10.8 px in a 1080 frame. Positions are a `pin` (one of nine points of the
 * frame) plus an offset in u. The horizontal part of a pin and of `align` is
 * logical — `s` is the left in English and the right in Arabic and Kurdish — so
 * a graphic written once is on the correct side in every language.
 */

// ── the frame ─────────────────────────────────────────────────────────────

export const FORMATS = {
  landscape: { width: 1920, height: 1080, ratio: '16:9' },
  portrait: { width: 1080, height: 1920, ratio: '9:16' },
  square: { width: 1080, height: 1080, ratio: '1:1' },
  feed: { width: 1080, height: 1350, ratio: '4:5' },
} as const;
export type Format = keyof typeof FORMATS;
export const FORMAT_IDS = Object.keys(FORMATS) as Format[];

export const FPS_CHOICES = [24, 30, 60] as const;
export type Fps = (typeof FPS_CHOICES)[number];

/** Every ceiling a reader enforces. A model's answer is input; these are what it is checked against. */
export const LIMITS = {
  layers: 60,
  seconds: 30,
  minSeconds: 1,
  title: 120,
  name: 60,
  text: 500,
  suffix: 12,
  request: 2000,
  dataPoints: 12,
  label: 40,
  colors: 6,
  stops: 6,
  particles: 300,
  path: 3000,
  fields: 24,
  fieldChars: 1200,
  /** Characters of a data: URL a picture may be. About 4.5 MB of image. */
  image: 6_000_000,
  /** Farthest a layer may sit from its pin, and largest it may be, in u. */
  reach: 400,
  size: 600,
  /**
   * The largest type, in u: two frame-heights. Past that a letter is bigger than
   * anything that can be seen of it, and every glyph is still laid out and drawn.
   */
  fontSize: 200,
  /** The most a layer may be scaled (and, by an effect, grown further still). */
  scale: 4,
  /** The largest a particle may be, in u. */
  particleSize: 50,
  /**
   * The most particles a whole document may draw each frame, across its
   * layers: `particles` bounds one layer, and 60 layers of it is eighteen
   * thousand discs a frame. Earlier layers keep their count; later ones are
   * cut to what is left.
   */
  particleBudget: 1200,
  /** The most scenes a graphic may be cut into, and the shortest a scene may be, in seconds (`motionscene.ts`). */
  scenes: 12,
  sceneMin: 0.5,
  /** Seconds a transition between two scenes may take; never longer than either scene beside it. */
  transitionMin: 0.15,
  transitionMax: 1.5,
} as const;

// ── the vocabulary ────────────────────────────────────────────────────────

/**
 * Nine points: the row (`t` top, `m` middle, `b` bottom) then the column (`s`
 * start, `c` centre, `e` end). Start and end are logical.
 *
 * A pin names a point of the **frame** and, the same word, the point of the
 * **layer's own box** that is put there — the way CSS absolute positioning
 * works. A layer pinned `bs` with `x: 8, y: -10` has its bottom-start corner 8u
 * in from the start edge and 10u up from the bottom; pinned `mc` its centre is
 * at the centre of the frame. So a template never has to add half a width to
 * place something against an edge, and the same layer is flush to the correct
 * corner in every language. A text layer's box is as wide as its `max` (or its
 * longest line) and as tall as its lines; a counter's is as wide as its
 * widest value; a shape's, icon's, image's and chart's are their own size; a
 * particle layer has no box, and its emitter sits at the point.
 */
export const PINS = ['ts', 'tc', 'te', 'ms', 'mc', 'me', 'bs', 'bc', 'be'] as const;
export type Pin = (typeof PINS)[number];

/**
 * How a layer arrives and leaves. An exit is the entrance played backwards, so
 * this one list serves both; see `motionanim.ts` for what each does, in numbers.
 *
 * - `fade`, `rise`, `drop`, `slide`, `pop`, `zoom`: opacity and movement.
 * - `wipe`: a clean edge reveals the layer from one side.
 * - `mask`: text rises from behind its own line, the classic title reveal.
 * - `type`: characters appear one after another.
 * - `blur`: soft focus resolves to sharp.
 * - `spin`, `flip`: a turn, about the layer's centre.
 * - `grow`: the layer extends from its base (a bar, a line, a rule).
 * - `draw`: a stroke draws itself along its path.
 */
export const EFFECTS = [
  'none', 'fade', 'rise', 'drop', 'slide', 'pop', 'zoom', 'wipe', 'mask', 'type', 'blur', 'spin', 'flip', 'grow', 'draw',
] as const;
export type Effect = (typeof EFFECTS)[number];

/** Motions that go on while a layer is on screen, and settle nothing. */
export const LOOPS = ['none', 'float', 'pulse', 'spin', 'sway', 'breathe', 'shimmer'] as const;
export type Loop = (typeof LOOPS)[number];

/**
 * Timing curves. Anything else the maths knows, `bezier(x1,y1,x2,y2)`, is also
 * accepted by `easeOf`, but the panel and the model choose from this list.
 */
export const EASES = [
  'linear', 'in', 'out', 'inout', 'soft', 'cubic-out', 'quart-out', 'expo-out', 'expo-inout', 'circ-out',
  'back-out', 'back-inout', 'elastic-out', 'bounce-out', 'spring', 'snappy',
] as const;
export type EaseName = (typeof EASES)[number];

/** Which way an effect comes from or reveals toward. `start` and `end` are logical. */
export const DIRS = ['up', 'down', 'start', 'end'] as const;
export type Dir4 = (typeof DIRS)[number];

/** What a text layer splits into, each unit running the effect `gap` seconds after the last. */
export const SPLITS = ['all', 'line', 'word', 'char'] as const;
export type Split = (typeof SPLITS)[number];

/**
 * Typefaces by their feel. Each is a font stack (`motionfonts.ts`): the
 * system's best face for that feel, with the bundled Arabic face for Arabic
 * script so Sorani and Badini letters always have glyphs.
 */
export const VOICES = ['sans', 'bold', 'serif', 'round', 'mono', 'condensed'] as const;
export type Voice = (typeof VOICES)[number];

export const SHAPES = ['rect', 'ellipse', 'arc', 'polygon', 'star', 'line', 'arrow', 'burst', 'wave', 'blob', 'path'] as const;
export type Shape = (typeof SHAPES)[number];

/** `race` is a bar-chart race: each datum's label carries its earlier values (`motioncharts.ts`, "The race"). */
export const CHARTS = ['bars', 'hbars', 'line', 'donut', 'ring', 'race'] as const;
export type Chart = (typeof CHARTS)[number];

/**
 * Seven moving grounds made to loop under words, then five finishes laid over
 * a picture: film grain, a vignette, light leaks, scan lines and a halftone
 * screen. What each field means to each is in `motionbackdrop.ts`.
 */
export const BACKDROPS = ['aurora', 'grid', 'dots', 'rays', 'waves', 'bokeh', 'stripes', 'grain', 'vignette', 'lightleak', 'scanlines', 'halftone'] as const;
export type Backdrop = (typeof BACKDROPS)[number];
/** The grounds alone: what a loop background can be. */
export type Ground = Exclude<Backdrop, 'grain' | 'vignette' | 'lightleak' | 'scanlines' | 'halftone'>;

export const PARTICLES = ['confetti', 'sparks', 'bubbles', 'stars', 'snow'] as const;
export type Particles = (typeof PARTICLES)[number];

/** How a layer mixes with what is under it (`globalCompositeOperation`). */
export const BLENDS = ['normal', 'screen', 'multiply', 'overlay', 'lighter'] as const;
export type Blend = (typeof BLENDS)[number];

export const LANGUAGES: readonly Lang[] = ['en', 'ar', 'ckb', 'kmr'];

/**
 * The templates. Each is a function in `motiontemplates.ts` that builds layers
 * from a few fields; `test/motiontemplates.test.mjs` fails if an id here has no
 * recipe, or a recipe has no id here.
 */
export const CORE_RECIPE_IDS = [
  'big-title', 'kinetic', 'split-title', 'quote',
  'lower-third', 'subscribe', 'callout', 'handle',
  'big-number', 'bar-chart', 'donut', 'line-chart', 'stats',
  'logo-reveal', 'countdown', 'intro',
  'steps', 'loop-bg',
] as const;
export type CoreRecipeId = (typeof CORE_RECIPE_IDS)[number];

/** The original eighteen, then the pro pass's (`motionids.ts`). */
export const RECIPE_IDS = [...CORE_RECIPE_IDS, ...PRO_A_IDS, ...PRO_B_IDS] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export const RECIPE_GROUPS = ['titles', 'overlays', 'data', 'brand', 'backgrounds'] as const;
export type RecipeGroup = (typeof RECIPE_GROUPS)[number];

// ── colour ────────────────────────────────────────────────────────────────

/** The five colours a graphic is drawn in. A layer names one of them, or gives a hex value. */
export const TONES = ['bg', 'fg', 'accent', 'accent2', 'muted'] as const;
export type Tone = (typeof TONES)[number];
export type Palette = Record<Tone, string>;

/**
 * A gradient. `angle` is physical, in degrees clockwise from the +x axis, so 0
 * runs left to right and 90 top to bottom. Radial gradients ignore it and
 * start at the centre; conic ones start at it.
 */
export interface Gradient {
  kind: 'linear' | 'radial' | 'conic';
  angle: number;
  stops: { at: number; color: string }[];
}

/** A tone, a hex colour, or a gradient. */
export type Paint = string | Gradient;

// ── animation ─────────────────────────────────────────────────────────────

/** An entrance or an exit. */
export interface Anim {
  fx: Effect;
  /** Seconds the effect takes. */
  d: number;
  /** Seconds after the layer's `start` an entrance begins; before its `end` an exit finishes. */
  delay: number;
  ease: string;
  /** Strength: 1 is the effect as designed, 0.5 half as far, 2 twice. */
  amount: number;
  dir?: Dir4;
  /** Text only: what runs the effect on its own. Default `all`. */
  by?: Split;
  /** Seconds between one unit starting and the next. Default 0.04. */
  gap?: number;
}

/** A motion that repeats while the layer is on screen. */
export interface LoopAnim {
  fx: Loop;
  /** Seconds for one cycle. */
  d: number;
  amount: number;
}

export interface Shadow {
  color: string;
  blur: number;
  x: number;
  y: number;
}

export interface Stroke {
  color: Paint;
  /** u. */
  width: number;
  cap: 'round' | 'butt' | 'square';
  dash?: [number, number];
}

// ── layers ────────────────────────────────────────────────────────────────

export interface LayerBase {
  id: string;
  /** What the timeline calls it. */
  name: string;
  /** Seconds. The layer is drawn from `start` up to `end`. */
  start: number;
  end: number;
  pin: Pin;
  /** u from the pin's point of the frame. Positive `x` moves toward the end; positive `y` moves down. */
  x: number;
  y: number;
  /** 1 is as drawn. */
  scale: number;
  /** Degrees, clockwise. */
  rot: number;
  opacity: number;
  in?: Anim;
  out?: Anim;
  loop?: LoopAnim;
  shadow?: Shadow;
  blend?: Blend;
  hidden?: boolean;
  locked?: boolean;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  voice: Voice;
  /** u: the font size. */
  size: number;
  /** 100 to 900, in steps of 100. */
  weight: number;
  color: Paint;
  align: 'start' | 'center' | 'end';
  /** Line height, in sizes. */
  lead: number;
  /** Letter spacing, in ems. Ignored for Arabic script, whose letters join. */
  track: number;
  caps: boolean;
  /** u: wrap width. 0 wraps only at line breaks. */
  max: number;
  /** Shrink the size until the longest line fits `max`. */
  fit: boolean;
  /** A phrase inside `text` to set apart. Must appear in `text` exactly. */
  hi?: string;
  hiColor?: Paint;
  hiStyle?: 'color' | 'box' | 'underline';
  outline?: { color: Paint; width: number };
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  shape: Shape;
  /** u. A `line` runs the width; an `arc` and a `polygon` fit the smaller side. */
  w: number;
  h: number;
  /** u: the corner radius of a `rect`. At least half the shorter side makes a pill. */
  radius: number;
  /** Points of a `polygon` or `star`, rays of a `burst`, periods of a `wave`. */
  sides: number;
  /** A `star`'s inner radius or a `burst`'s ray depth, as a fraction of the outer. */
  inner: number;
  /** An `arc`: where it starts, in degrees clockwise from the top, and how far it sweeps. */
  from: number;
  sweep: number;
  fill: Paint | null;
  stroke?: Stroke;
  /** A `path`: SVG path data drawn in a 100 x 100 box scaled to `w` x `h`. */
  d?: string;
  /** Varies a `blob`'s outline and a `wave`'s phase. */
  seed: number;
}

export interface IconLayer extends LayerBase {
  kind: 'icon';
  icon: IconId;
  /** u: the glyph's square. */
  size: number;
  color: Paint;
  /** Line weight in the icon's 24-unit grid. 1.75 is the set's own. */
  weight: number;
  /** A shape behind the glyph. `pad` is the room around it, in u. */
  badge?: { shape: 'circle' | 'squircle'; fill: Paint; pad: number };
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  /** A `data:image/` URL: pictures are kept inside the graphic, so rendering never touches the network. */
  src: string;
  w: number;
  h: number;
  fit: 'cover' | 'contain';
  radius: number;
}

/** A number that rolls from one value to another. Shares text's typography. */
export interface CounterLayer extends LayerBase {
  kind: 'counter';
  from: number;
  to: number;
  decimals: number;
  prefix: string;
  suffix: string;
  /** Thousands separators. */
  group: boolean;
  voice: Voice;
  size: number;
  weight: number;
  color: Paint;
  align: 'start' | 'center' | 'end';
  track: number;
  /** The roll: seconds it takes, seconds after `start` it begins, and its curve. */
  count: { d: number; delay: number; ease: string };
}

export interface ChartLayer extends LayerBase {
  kind: 'chart';
  chart: Chart;
  w: number;
  h: number;
  data: { label: string; value: number }[];
  /** One colour per datum, cycling. */
  colors: string[];
  /** The value the scale tops out at. 0 uses the largest datum. */
  max: number;
  /** Written after a value. */
  unit: string;
  labels: boolean;
  values: boolean;
  voice: Voice;
  /** u: the labels' size. */
  size: number;
  color: Paint;
  /** u: a line's, a ring's and a donut's thickness. */
  thick: number;
  /** Seconds between one datum starting and the next. */
  gap: number;
}

/** A full-frame moving background. Its position, scale and rotation are ignored. */
export interface BackdropLayer extends LayerBase {
  kind: 'backdrop';
  style: Backdrop;
  colors: string[];
  /** 0 to 3; 1 is the design speed. */
  speed: number;
  /** 0 to 1: how many elements, how close together. */
  density: number;
  seed: number;
}

export interface ParticlesLayer extends LayerBase {
  kind: 'particles';
  style: Particles;
  colors: string[];
  count: number;
  /** u: a typical particle. */
  size: number;
  speed: number;
  /** u: the radius of the area they start in. 0 spreads them over the frame. */
  spread: number;
  /** One burst when the layer starts, rather than a continuous stream. */
  burst: boolean;
  seed: number;
}

export type Layer =
  | TextLayer | ShapeLayer | IconLayer | ImageLayer | CounterLayer | ChartLayer | BackdropLayer | ParticlesLayer;
export type LayerKind = Layer['kind'];
export const LAYER_KINDS: readonly LayerKind[] = ['text', 'shape', 'icon', 'image', 'counter', 'chart', 'backdrop', 'particles'];

// ── the document ──────────────────────────────────────────────────────────

/** Which template a graphic came from, and the words it was filled with, so it can be built again for another shape or language. */
export interface RecipeRef {
  id: RecipeId;
  fields: Record<string, string>;
}

export interface Motion {
  id: string;
  title: string;
  /** What the person asked for, in their own words. Empty for a template started as it is. */
  request: string;
  /** The language its words are in: it decides direction, digits and fonts. */
  lang: Lang;
  format: Format;
  fps: Fps;
  /** Length, 1 to 30. */
  seconds: number;
  palette: Palette;
  /** Painted first, under every layer. Null leaves the frame transparent. */
  backdrop: Paint | null;
  /** Back to front. */
  layers: Layer[];
  recipe?: RecipeRef;
  /** The sound it carries (`motionsound.ts`). Absent is silence. */
  sound?: SoundSpec;
  /** Its scenes and the transitions between them (`motionscene.ts`). Absent is one scene, as before. */
  scenes?: SceneSpec[];
  /** Designed by the model rather than started from a template as it is. */
  ai?: boolean;
  stage: 'new' | 'planning' | 'ready';
  error?: string;
  created: number;
  updated: number;
}

// ── what the drawing files hand each other ────────────────────────────────

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Everything one drawing call needs to know about the frame it is drawing into.
 * Built once per frame by `motiondraw.ts`'s `paint` and passed down.
 */
export interface Env {
  ctx: Ctx;
  doc: Motion;
  /** Seconds into the graphic. */
  t: number;
  /** Pixels per u. */
  k: number;
  /** The target's size in pixels. */
  width: number;
  height: number;
  rtl: boolean;
  /** A tone or a colour, as a CSS colour string. */
  color(c: string): string;
  /**
   * A paint as something `fillStyle` takes, for a box `w` x `h` **pixels**
   * centred on the current origin (the drawing code translates to the layer's
   * centre first).
   */
  paint(p: Paint, w: number, h: number): string | CanvasGradient;
}

/**
 * A layer's animated state at one moment (`motionanim.ts`'s `poseAt`): what the
 * effects, the loop and the layer's own transform add up to. Lengths are in u,
 * already resolved for direction, so the drawing code never asks which way the
 * language reads to place something.
 */
export interface Pose {
  /** Whether anything is drawn: inside `start`..`end`, not hidden, visible enough to see. */
  on: boolean;
  /** 0 to 1: how far in the layer is, entrance and exit together. Loops are weighted by it. */
  presence: number;
  opacity: number;
  /** Physical offsets from the layer's resting place. */
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  rot: number;
  /** How much of the layer a `wipe` has uncovered, and the edge it grows from. 1 is all of it. */
  reveal: number;
  from: 'left' | 'right' | 'top' | 'bottom';
  /** A `mask` reveal: 0 hidden below its own line, 1 at rest. */
  mask: number;
  /** A `type` reveal: the fraction of characters showing. */
  type: number;
  /** A `draw` reveal: the fraction of the stroke drawn. */
  draw: number;
  /** A `grow` reveal: the fraction of its extent. */
  grow: number;
  /** Soft focus, in u. 0 is sharp. */
  blur: number;
  /** A `shimmer` loop's highlight position, 0 to 1 across the layer; -1 when not shimmering. */
  glint: number;
}

// ── small lookups ─────────────────────────────────────────────────────────

/** The frame's pixel size at a scale (1 is the format's own). */
export function sizeOf(format: Format, scale = 1): { width: number; height: number } {
  const f = FORMATS[format] ?? FORMATS.landscape;
  return { width: Math.round(f.width * scale), height: Math.round(f.height * scale) };
}

/** Pixels per u for a frame of this size: 1% of its short side. */
export function pxPerU(width: number, height: number): number {
  return Math.min(width, height) / 100;
}

/** How many frames a graphic has. */
export function frameCount(m: Pick<Motion, 'seconds' | 'fps'>): number {
  return Math.max(1, Math.round(m.seconds * m.fps));
}

/** The row and column of a pin: `bs` is `['b', 's']`. */
export function pinOf(pin: Pin): { row: 't' | 'm' | 'b'; col: 's' | 'c' | 'e' } {
  return { row: pin[0] as 't' | 'm' | 'b', col: pin[1] as 's' | 'c' | 'e' };
}

export function isTone(c: string): c is Tone {
  return (TONES as readonly string[]).includes(c);
}

/** Whether a language is written right to left: rtl.ts's rule, the one the whole interface follows. */
export function isRtlLang(lang: Lang): boolean {
  return dirFor(lang) === 'rtl';
}
