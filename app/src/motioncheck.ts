import type { ChartLayer, Ctx, Env, Layer, Motion, Paint, Palette, Pose, TextLayer, Tone } from './motiontypes';
import { FORMATS, LIMITS, TONES, isTone } from './motiontypes';
import { layerBox, makeEnv } from './motiondraw';
import { inDone, outStart, unitsOf } from './motionanim';
import { drawChart } from './motioncharts';
import { clamp, contrast, cssOf, finite, flatten, parseColor, parsePath, pathBounds, type RGBA } from './motionmath';
import { fontString, scriptOf } from './motionfonts';
import { setLayer, setSeconds } from './motionedit';

/**
 * The quality check: what a careful designer would point out in a graphic,
 * found by pure functions, and the repairs that are safe to make for them.
 *
 * A person who is not a designer makes a graphic whose words run off the
 * edge, sit on a colour they cannot be read on, or flash by too fast to read.
 * HyperFrames finds these with a browser: it renders the page and measures
 * the pixels. Motion does not need one. Every box is a function of the
 * document (`layerBox` in motiondraw.ts), every moment of every layer is a
 * function of its timing (motionanim.ts), and every colour is a palette token
 * or a value — so the whole check is arithmetic over the document, finished
 * in a few milliseconds, and the same answer in the app and in a test.
 *
 * ## False alarms are worse than misses
 *
 * A person told that their good graphic is wrong stops listening, and then
 * the real problem goes unheard too. So every threshold below started from
 * the numbers in docs/pro/RESEARCH.md and was then tuned until none of the
 * eighteen templates, in all four shapes and all four languages, draws a
 * `warn` — a template is the house's idea of a good graphic, and a rule that
 * disagrees with it is the rule's fault. Where a number moved, `CHECK` says
 * why, and docs/pro/check.md lists each one against the template that moved
 * it. The check never blocks anything either: it says "tips", and every
 * finding is advice the person may ignore.
 *
 * ## What is measured, and where
 *
 * Everything is worked out in the format's own frame, whose short side is
 * 1080 px — the size text is laid out at (`LAYOUT_K` in motiondraw.ts) — and
 * reported in u. A layer is judged at rest: its own place, scale and turn,
 * with the entrance and exit finished and its loop ignored, since a title
 * that slides in from outside the frame is not "outside the frame". Text is
 * judged by its lines rather than its box: a short word in a box as wide as
 * the frame is not off the edge, because the box is only where words *may*
 * go. Shapes are judged turned as they are drawn — the intro's bands lean
 * seven degrees, and their upright bounds would cover the whole frame — so a
 * question like "how much of this title is on that plate" is answered by
 * sampling points of the title and asking the plate, in its own turned
 * frame, whether it holds each one. Time is judged from the timing alone:
 * when a layer is wholly in (`inDone`), when it starts to leave
 * (`outStart`), when any of it shows.
 *
 * Measuring words needs a canvas. The studio passes one; the tests pass the
 * recording canvas; with neither the check makes its own when the engine
 * has one, and otherwise leaves out the rules that need the words measured
 * rather than guess — a guessed width would land in motiondraw.ts's layout
 * caches, which are keyed on the font and not the canvas, and change the
 * next frame drawn.
 *
 * ## Repairs
 *
 * A finding may carry a `Fix`: field changes to layers, made through
 * motionedit.ts like any hand edit (so a template's link is dropped as it
 * would be by hand), and a new length for the graphic. `autofix` applies the
 * ones asked for and keeps a repair only when the check, run again, agrees:
 * its own finding is gone and nothing new has appeared. Then it looks again,
 * because one repair can make another possible, until nothing changes — which
 * is why a second `autofix` changes nothing.
 */

// ── the numbers ───────────────────────────────────────────────────────────

/**
 * Every number the check decides by. The starting points are HyperFrames'
 * (`packages/cli/src/utils/checkPipeline.ts`, the layout and contrast audits)
 * and the reading research in RESEARCH.md; the ones that moved were moved by
 * a template, and the comment says which.
 */
export const CHECK = {
  /** u a layer may run past the frame before it is off it: a box's edge is not its letters'. */
  bleed: 2.5,
  /**
   * u from every edge that words keep clear of. Title-safe would be 10u; the
   * charts, the steps and the lower thirds all set their words 8u in, and a
   * phone shows the whole frame, so the line is drawn where words start to
   * touch the edge: 5u, the vertical action-safe margin of a 16:9 frame.
   */
  safe: 5,
  /** Of the smaller of two texts, the share they may share before it is an overlap. */
  overlap: 0.2,
  /** Seconds two texts must sit on each other for it to count: a hand-over shorter than this is a cut, not a collision. */
  overlapHold: 0.5,
  /** Of a text, the share a layer drawn over it may cover before it is a tip, and before it is a warning. */
  covered: 0.15,
  coveredWarn: 0.5,
  /** Seconds a cover must stay over the words to count. */
  coveredHold: 0.25,
  /** WCAG's contrast for text, and for large text. */
  contrast: 4.5,
  contrastLarge: 3,
  /** u at which text is large: 24 px at the 1080 px side, or 19 px when bold — WCAG's sizes, as HyperFrames applies them to a frame in pixels. */
  large: 2.2,
  largeBold: 1.75,
  /** Below this share of the threshold, low contrast is a warning rather than a tip. */
  contrastWarn: 0.6,
  /**
   * u. Under `smallWarn` no phone reads it. A line of body text (`bodyWords`
   * or more) under `smallBody`, the size the engine gives a chart's labels,
   * is a tip; a short label under `smallLabel` is. The handle's "Follow us"
   * is 2.2u and the big title's small label 2.5u by design: a short label
   * reads smaller than a sentence does, which is why the brief's single 2.6u
   * became two lines.
   */
  smallWarn: 1.4,
  smallLabel: 2,
  smallBody: 2.6,
  bodyWords: 7,
  /**
   * Reading speed, in words a second, and Arabic script's slower pace. What a
   * word is depends on the language: Badini and Sorani write particles as
   * words of their own (the callout's "Start here" is five words in Badini),
   * while their joined words are long (the split reveal's subtitle is 41
   * letters in six words). So a text counts as the smaller of its words and
   * its letters over five (the typing-speed convention): each measure
   * overcounts one kind of language, and the smaller is the honest load.
   */
  wps: 2.5,
  wpsArabic: 2.2,
  letters: 5,
  /**
   * A phrase short enough to be taken in at a glance, like a sign: at most
   * this many words and letters. "GO", a countdown's number, the Badini
   * "دەست پێ بکە". Reading speed applies above it; half a second (`blink`)
   * applies to everything.
   */
  glanceWords: 3,
  glanceLetters: 16,
  blink: 0.5,
  /**
   * Seconds with nothing moving before a graphic looks stuck. Four, not three: a title holds while it is read, and a before-and-after
   * or a price card holds a good while longer than that. (A graphic made to sit over video is exempt: the video moves.)
   */
  frozen: 4,
  /** Seconds before which something must have appeared. */
  lateStart: 0.5,
  /** Seconds of an empty frame, after the first thing appears, that count. */
  empty: 0.3,
  /**
   * Text layers on screen at once, and the words between them, past which a
   * frame is too much to read. Both, because a line chart's twelve month
   * names are twelve layers and twelve words, and read as one axis.
   */
  dense: 10,
  denseWords: 24,
} as const;

/** The rules, in the order a list of findings is sorted by when all else is equal. */
export const RULES = [
  'off-canvas', 'text-overflow', 'low-contrast', 'covered', 'overlap', 'blink', 'too-fast', 'small-text',
  'outside-safe', 'empty-frame', 'late-start', 'frozen', 'dense',
] as const;
export type Rule = (typeof RULES)[number];

// ── what the check says ───────────────────────────────────────────────────

export type Severity = 'tip' | 'warn';

/** A repair: field changes to layers, applied through motionedit.ts, and perhaps a new length for the graphic. */
export interface Fix {
  /** English; the interface passes it through t(). */
  label: string;
  patches: { layerId: string; patch: Partial<Layer> }[];
  /** A new length for the graphic, in seconds, applied before the patches. */
  seconds?: number;
}

export interface Finding {
  /** Stable: the rule, the layer and, for a stretch of time, the moment — so a list does not jump as the graphic changes. */
  id: string;
  rule: string;
  severity: Severity;
  layerId?: string;
  /** Seconds, when it is about a stretch of time. */
  from?: number;
  to?: number;
  /** An English sentence with `{placeholders}`; the interface passes it through t() and fill(). */
  message: string;
  /** What fills the placeholders: numbers already written as text, and `other`, a layer's name. */
  vars?: Record<string, string | number>;
  fix?: Fix;
}

/** A 2D context the check measures words with: a canvas's, an OffscreenCanvas's, or the tests' recording one. */
export type MeasureCtx = Ctx;

export interface CheckOptions {
  ctx?: MeasureCtx;
}

// ── measuring ─────────────────────────────────────────────────────────────

let shared: MeasureCtx | null | undefined;

/**
 * A context to measure words with when the caller gives none: one, made once.
 * A page's own canvas first: it measures in the faces the page has loaded, as
 * the stage's canvas does, and what it measures lands in the caches the stage
 * draws from. Null in an engine with no canvas at all.
 */
function ownCtx(): MeasureCtx | null {
  if (shared !== undefined) return shared;
  shared = null;
  try {
    if (typeof document !== 'undefined') shared = document.createElement('canvas').getContext('2d');
    else if (typeof OffscreenCanvas !== 'undefined') shared = new OffscreenCanvas(8, 8).getContext('2d') as MeasureCtx | null;
  } catch {
    shared = null;
  }
  return shared;
}

/** A rectangle in u, upright, in the frame's physical coordinates (x from the left, y down). */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A rectangle turned `rot` degrees clockwise about its centre, in u: what a layer, or a line of its words, covers. */
interface Quad {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rot: number;
}

interface Span {
  from: number;
  to: number;
}

interface Pt {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

function during(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.to, b.to) - Math.max(a.from, b.from));
}

/** The upright bounds of a turned rectangle. */
function boundsOf(q: Quad): Rect {
  const a = q.rot * DEG;
  const hw = (Math.abs(q.w * Math.cos(a)) + Math.abs(q.h * Math.sin(a))) / 2;
  const hh = (Math.abs(q.w * Math.sin(a)) + Math.abs(q.h * Math.cos(a))) / 2;
  return { x0: q.cx - hw, y0: q.cy - hh, x1: q.cx + hw, y1: q.cy + hh };
}

function union(rs: readonly Rect[]): Rect | null {
  if (!rs.length) return null;
  return {
    x0: Math.min(...rs.map((r) => r.x0)), y0: Math.min(...rs.map((r) => r.y0)),
    x1: Math.max(...rs.map((r) => r.x1)), y1: Math.max(...rs.map((r) => r.y1)),
  };
}

/**
 * Points spread evenly over some turned rectangles, a few dozen at most:
 * what "how much of these words" is counted in. A grid of cell centres, so
 * an edge exactly on another's edge counts half, not all or nothing.
 */
function samplesOf(parts: readonly Quad[]): Pt[] {
  const per = parts.length <= 2 ? [8, 3] : parts.length <= 4 ? [6, 2] : [4, 1];
  const out: Pt[] = [];
  for (const q of parts) {
    const a = q.rot * DEG;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    for (let i = 0; i < per[0]; i++) {
      for (let j = 0; j < per[1]; j++) {
        const lx = ((i + 0.5) / per[0] - 0.5) * q.w;
        const ly = ((j + 0.5) / per[1] - 0.5) * q.h;
        out.push({ x: q.cx + lx * cos - ly * sin, y: q.cy + lx * sin + ly * cos });
      }
    }
  }
  return out;
}

/** Whether a point is inside a turned rectangle, or the ellipse it bounds. */
function holds(q: Quad, p: Pt, round: boolean): boolean {
  const a = -q.rot * DEG;
  const dx = p.x - q.cx;
  const dy = p.y - q.cy;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  const hw = q.w / 2;
  const hh = q.h / 2;
  if (!(hw > 0 && hh > 0)) return false;
  if (round) return (lx / hw) ** 2 + (ly / hh) ** 2 <= 1;
  return Math.abs(lx) <= hw && Math.abs(ly) <= hh;
}

/** Seconds as the messages write them: one decimal, never "-0" or "NaN". */
const secs = (x: number) => (Math.round(finite(x, 0) * 10) / 10 || 0).toFixed(1);
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Far enough before and after any moment that an entrance has finished and an exit not begun: a layer at rest. */
const PROBE = 1e4;

/** What a layer is when it is looked at, rather than drawn: in place, finished arriving, not yet leaving, its loop stilled. */
function atRest(layer: Layer): Layer {
  const still: Layer = { ...layer, start: -PROBE, end: PROBE, hidden: false, opacity: 1 };
  delete still.loop;
  return still;
}

const READABLE = /[\p{L}\p{N}]/u;

/** Words of a text, as spaces divide them; none when it has no letter or digit (a quotation mark is decoration, not words). */
function wordsOf(text: string): number {
  const t = typeof text === 'string' ? text.trim() : '';
  return t && READABLE.test(t) ? t.split(/\s+/).length : 0;
}

/** Letters and digits, which is what a reader reads. */
function lettersOf(text: string): number {
  return (String(text).match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * The widths of a text's lines, in px at `px`, laid out as motiondraw.ts's
 * `textBlock` lays them: a fitted text is one line a paragraph at the size
 * it was shrunk to; any other wraps at `max` a word at a time, a word never
 * cut. The same font string and the same measure, so the lines found are the
 * lines drawn.
 */
function lineWidths(ctx: MeasureCtx, layer: TextLayer, px: number, rtl: boolean): number[] {
  const raw = String(layer.text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ').slice(0, LIMITS.text * 2);
  const script = scriptOf(raw);
  const arabic = script === 'arabic';
  const caps = !!layer.caps && !arabic;
  const track = arabic ? 0 : clamp(finite(layer.track, 0), -0.5, 2) * px;
  ctx.font = fontString(layer.voice, finite(layer.weight, 700), px, script);
  ctx.direction = rtl ? 'rtl' : 'ltr';
  const shown = (s: string) => (caps ? s.toUpperCase() : s);
  const widthOf = (words: readonly string[]) => {
    const text = words.join(' ');
    if (!text) return 0;
    return Math.max(0, finite(ctx.measureText(text).width, 0)) + (track ? (Array.from(text).length - 1) * track : 0);
  };
  const size = clamp(finite(layer.size, 8), 0.1, LIMITS.size);
  const maxPx = clamp(finite(layer.max, 0), 0, LIMITS.size) * (px / size);
  const wrap = maxPx > 0 && !layer.fit;
  const out: number[] = [];
  for (const p of raw.split('\n')) {
    const words = (p.match(/\S+/g) ?? []).map(shown);
    if (!wrap) {
      out.push(widthOf(words));
      continue;
    }
    let line: string[] = [];
    for (const w of words) {
      if (line.length && widthOf([...line, w]) > maxPx) {
        out.push(widthOf(line));
        line = [w];
      } else line.push(w);
    }
    out.push(widthOf(line));
  }
  return out;
}

const REST_POSE: Pose = {
  on: true, presence: 1, opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0,
  reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1,
};

/**
 * Whether a chart cuts any of its labels short to fit, found the only honest
 * way: by running the chart's own layout. It draws through a context that
 * keeps every measurement and state change and drops every pixel, and
 * listens for a label ending in an ellipsis — motioncharts.ts is the
 * authority on what fits, and a copy of its layout here would drift.
 */
function cutLabels(env: Env, layer: ChartLayer): boolean {
  const real = env.ctx;
  let depth = 0;
  let cut = false;
  const quiet = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'clearRect', 'drawImage', 'putImageData', 'strokeText', 'clip']);
  const listening = new Proxy(real, {
    get(target, prop) {
      if (prop === 'fillText') return (s: unknown) => { if (typeof s === 'string' && s.endsWith('…')) cut = true; };
      if (typeof prop === 'string' && quiet.has(prop)) return () => undefined;
      if (prop === 'save') return () => { depth += 1; target.save(); };
      if (prop === 'restore') return () => { if (depth > 0) { depth -= 1; target.restore(); } };
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  try {
    drawChart({ ...env, ctx: listening }, atRest(layer) as ChartLayer, { ...REST_POSE }, 1);
  } catch {
    /* a chart that cannot be laid out has nothing cut to report */
  } finally {
    while (depth > 0) {
      depth -= 1;
      real.restore();
    }
  }
  return cut;
}

// ── each layer, once ──────────────────────────────────────────────────────

/** A layer as the rules see it: where it is at rest, when it shows, and, for words, how big they are and how many. */
interface Item {
  layer: Layer;
  /** Its place in the stack, back to front. */
  i: number;
  /** What it covers at rest: a line of words each, or its box. Empty when it has no place to judge. */
  parts: Quad[];
  /** The upright bounds of `parts`. */
  ink: Rect | null;
  /** Points spread over `parts`. */
  pts: Pt[];
  /** When any of it shows: its entrance has begun and its exit not finished. Null when it never does. */
  on: Span | null;
  /** When all of it is in: entrance over, exit not begun. Null when it never settles. */
  held: Span | null;
  /** Text and counters: the words, their count, whether Arabic script, and the type's size as drawn (u). */
  text: string;
  words: number;
  arabic: boolean;
  size: number;
  /** Text: the widest line, in u at the layer's own scale — what is compared with `max`. */
  width: number;
}

const MIN_ALPHA = 0.05;

/** When any of a layer shows. Never, when it is hidden, transparent or scaled to nothing. */
function spanOn(l: Layer): Span | null {
  if (l.hidden || !(finite(l.opacity, 1) > MIN_ALPHA) || !(Math.abs(finite(l.scale, 1)) > 1e-4)) return null;
  const s = finite(l.start, 0);
  const e = finite(l.end, s);
  const len = Math.max(0, e - s);
  const a = l.in && l.in.fx !== 'none' ? s + clamp(finite(l.in.delay, 0), 0, len) : s;
  const b = l.out && l.out.fx !== 'none' ? e - clamp(finite(l.out.delay, 0), 0, len) : e;
  return b > a ? { from: a, to: b } : null;
}

function spanHeld(l: Layer, on: Span | null): Span | null {
  if (!on) return null;
  const n = unitsOf(l);
  const a = Math.max(on.from, finite(inDone(l, n), on.from));
  const b = Math.min(on.to, finite(outStart(l, n), on.to));
  return b - a > 1e-3 ? { from: a, to: b } : null;
}

/**
 * When a text can be read: from half-way through its entrance to half-way
 * through its exit. Words are read as soon as they are mostly there — an
 * expo-out rise is nine tenths in at a third of its length — and while they
 * are leaving; from settled to leaving alone gave five of the templates a
 * reading tip at their own sample words, which were written to be read.
 */
function spanRead(l: Layer, on: Span | null): Span | null {
  if (!on) return null;
  const n = unitsOf(l);
  const a = l.in && l.in.fx !== 'none' ? (on.from + Math.max(on.from, finite(inDone(l, n), on.from))) / 2 : on.from;
  const b = l.out && l.out.fx !== 'none' ? (on.to + Math.min(on.to, finite(outStart(l, n), on.to))) / 2 : on.to;
  return b - a > 1e-3 ? { from: a, to: b } : null;
}

/** Whether a layer puts anything on the frame at all: a shape with neither fill nor stroke, an empty picture, a chart with no data do not. */
function inked(l: Layer, palette: Palette): boolean {
  switch (l.kind) {
    case 'text':
      return wordsOf(l.text) > 0;
    case 'shape': {
      const fill = l.fill !== null && Math.max(0, ...coloursOf(l.fill, palette).map((c) => c.a)) > MIN_ALPHA;
      const stroke = !!l.stroke && l.stroke.width > 0 && Math.max(0, ...coloursOf(l.stroke.color, palette).map((c) => c.a)) > MIN_ALPHA;
      return fill || stroke;
    }
    case 'image':
      return l.src !== '';
    case 'chart':
      return l.data.length > 0;
    case 'counter':
    case 'icon':
      return true;
    default:
      return false;
  }
}

function itemOf(env: Env, ctx: MeasureCtx | null, layer: Layer, i: number): Item {
  const on = spanOn(layer);
  const item: Item = {
    layer, i, parts: [], ink: null, pts: [], on, held: spanHeld(layer, on), text: '', words: 0, arabic: false, size: 0, width: 0,
  };
  if (layer.kind === 'text') {
    item.text = layer.text;
    item.words = wordsOf(layer.text);
    item.arabic = scriptOf(layer.text) === 'arabic';
    item.size = clamp(finite(layer.size, 8), 0.1, LIMITS.size);
  } else if (layer.kind === 'counter') {
    item.text = `${layer.prefix}${layer.to}${layer.suffix}`;
    item.words = 1;
    item.size = clamp(finite(layer.size, 10), 0.1, LIMITS.size);
  }
  if (layer.kind === 'particles') return item;
  // Text and counters are laid out by measuring; without a context to measure with they have no place to judge.
  if ((layer.kind === 'text' || layer.kind === 'counter') && !ctx) return item;
  const box = layerBox(env, atRest(layer));
  if (!box || !(box.w >= 0 && box.h >= 0)) return item;
  const k = env.k;
  const scale = Math.abs(finite(layer.scale, 1));
  const whole: Quad = { cx: box.cx / k, cy: box.cy / k, w: box.w / k, h: box.h / k, rot: finite(box.rot, 0) };
  item.parts = [whole];
  if (layer.kind === 'text' && ctx && scale > 1e-6) {
    // The box's own size, before the layer's scale: its lines times their height, so a fitted title's size is its height over that.
    const boxW = box.w / scale;
    const boxH = box.h / scale;
    const paragraphs = Math.max(1, String(layer.text).replace(/\r\n?/g, '\n').split('\n').length);
    const lead = clamp(finite(layer.lead, 1.15), 0.5, 4);
    const fitted = layer.fit && layer.max > 0 ? Math.min(item.size, boxH / k / (paragraphs * lead)) : item.size;
    item.size = fitted;
    const lines = lineWidths(ctx, layer, fitted * k, env.rtl);
    item.width = Math.max(0, ...lines) / k;
    const lh = boxH / Math.max(1, lines.length);
    // Each line where `textBlock` puts it, aligned in a box as wide as the wrap width or the widest line: start is the
    // document's start side. When the lines found are not the box's (a count that disagrees), the box stands for them.
    if (Math.abs(lh - lead * fitted * k) <= 0.02 * lh + 0.5) {
      const a = whole.rot * DEG;
      const startLeft = !env.rtl;
      item.parts = [];
      lines.forEach((lw0, n) => {
        const lw = Math.min(boxW, lw0);
        if (!(lw > 0)) return;
        const off = layer.align === 'center' ? (boxW - lw) / 2 : (layer.align === 'start') === startLeft ? 0 : boxW - lw;
        const dx = (off + lw / 2 - boxW / 2) * scale;
        const dy = ((n + 0.5) * lh - boxH / 2) * scale;
        item.parts.push({
          cx: whole.cx + (dx * Math.cos(a) - dy * Math.sin(a)) / k, cy: whole.cy + (dx * Math.sin(a) + dy * Math.cos(a)) / k,
          w: (lw * scale) / k, h: (lh * scale) / k, rot: whole.rot,
        });
      });
    }
  }
  item.size *= scale;
  item.ink = union(item.parts.map(boundsOf));
  item.pts = samplesOf(item.parts);
  return item;
}

/**
 * How much of its bounding box a path shape fills, worked out from its outline
 * rather than guessed. A speech bubble or a rounded plate drawn as a path is
 * nearly all of its box; a star or an arrow is about half. Counting every path
 * as half-filled meant words set on such a plate were judged against the frame
 * behind it, and a good graphic was told its words could not be read. The
 * outline's closed pieces are summed by the shoelace formula (holes are not
 * subtracted: a path with one is rare, and its words are then judged on a plate
 * a little too solid, which can only miss a problem, never invent one). An open
 * or unreadable path keeps the old half. Remembered by the path's text.
 */
const SOLID_PATHS = new Map<string, number>();
function pathSolid(d: string | undefined): number {
  if (typeof d !== 'string' || !d) return 0.5;
  const hit = SOLID_PATHS.get(d);
  if (hit !== undefined) return hit;
  let out = 0.5;
  try {
    const segs = parsePath(d);
    if (segs && segs.length > 1) {
      const box = pathBounds(segs);
      let area = 0;
      let closedAny = false;
      for (const line of flatten(segs)) {
        if (!line.closed || line.pts.length < 6) continue;
        closedAny = true;
        let sum = 0;
        for (let i = 0; i < line.pts.length; i += 2) {
          const j = (i + 2) % line.pts.length;
          sum += line.pts[i] * line.pts[j + 1] - line.pts[j] * line.pts[i + 1];
        }
        area += Math.abs(sum) / 2;
      }
      if (closedAny && box.w > 0 && box.h > 0) out = clamp(area / (box.w * box.h), 0.05, 1);
    }
  } catch {
    out = 0.5;
  }
  if (SOLID_PATHS.size >= 64) SOLID_PATHS.clear();
  SOLID_PATHS.set(d, out);
  return out;
}

/** The share of `a`'s points inside `b`. A shape that is not a rectangle counts as round when it is an ellipse, and by `SOLID` otherwise. */
function shareIn(a: Item, b: Item): number {
  if (!a.pts.length || !b.parts.length) return 0;
  const round = b.layer.kind === 'shape' && b.layer.shape === 'ellipse';
  let n = 0;
  for (const p of a.pts) if (b.parts.some((q) => holds(q, p, round))) n += 1;
  const solid = b.layer.kind === 'shape' && b.layer.shape !== 'ellipse'
    ? (b.layer.shape === 'path' ? pathSolid(b.layer.d) : SOLID[b.layer.shape] ?? 0.5)
    : 1;
  return (n / a.pts.length) * solid;
}

/** The area a layer covers, in square u. */
const areaOf = (it: Item) => it.parts.reduce((s, q) => s + Math.max(0, q.w) * Math.max(0, q.h), 0);

// ── colour ────────────────────────────────────────────────────────────────

/** A paint's colours: a tone or a value, or a gradient's stops. Unreadable ones are left out. */
function coloursOf(p: Paint | null | undefined, palette: Palette): RGBA[] {
  const one = (c: unknown): RGBA | null => {
    if (typeof c !== 'string') return null;
    return parseColor(isTone(c) ? palette[c] : c);
  };
  if (typeof p === 'string') {
    const c = one(p);
    return c ? [c] : [];
  }
  if (!p || typeof p !== 'object' || !Array.isArray(p.stops)) return [];
  const out: RGBA[] = [];
  for (const s of p.stops.slice(0, LIMITS.stops)) {
    const c = one(s?.color);
    if (c) out.push(c);
  }
  return out;
}

/** `top` laid over the opaque `under` at `alpha` of its own opacity. */
function over(top: RGBA, under: RGBA, alpha: number): RGBA {
  const a = clamp(top.a * alpha, 0, 1);
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

const css = (c: RGBA) => cssOf({ ...c, a: 1 });

/** The distinct colours, at most a dozen: a ground is a handful of possibilities, never a combinatorial pile. */
function distinct(cs: RGBA[]): RGBA[] {
  const seen = new Map<string, RGBA>();
  for (const c of cs) if (seen.size < 12) seen.set(css(c), c);
  return [...seen.values()];
}

/**
 * How much of its box a shape fills, for shapes sampled as rectangles: a
 * rectangle all of it, a star or an arrow about half, and a line, an arc or a
 * wave — strokes — none worth counting as a ground or a cover. An ellipse is
 * tested as one.
 */
const SOLID: Readonly<Record<string, number>> = {
  rect: 1, polygon: 0.7, blob: 0.75, star: 0.4, burst: 0.5, path: 0.5, arrow: 0.5, line: 0, arc: 0, wave: 0,
};

/**
 * The colours that may be under a text, worst case: the frame's own paint,
 * then every shape below the text that covers most of its letters, laid over
 * it in order at the opacity it is drawn with. A shape that covers only some
 * of the letters, or is there only part of the time, adds its colours as
 * another possibility rather than replacing the ground. Null when the ground
 * cannot be known: a transparent frame (an overlay goes over video nobody
 * here has seen) or a picture under the words. Moving backdrops are texture
 * over the ground — soft light, a grid, dots — and are not counted; nor is a
 * shape mixed in by a blend mode other than normal.
 */
function groundOf(doc: Motion, items: readonly Item[], text: Item): RGBA[] | null {
  const when = text.held ?? text.on;
  if (!when || !text.pts.length) return null;
  let ground: RGBA[] | null = null;
  if (doc.backdrop !== null && doc.backdrop !== undefined) {
    const cs = coloursOf(doc.backdrop, doc.palette);
    ground = cs.length && cs.every((c) => c.a >= 0.95) ? cs.map((c) => ({ ...c, a: 1 })) : null;
  }
  for (const it of items) {
    if (it.i >= text.i) break;
    const l = it.layer;
    if (!it.on || !it.parts.length || during(it.on, when) < 0.05) continue;
    if (l.kind === 'image') {
      if (l.src && shareIn(text, it) >= 0.25) ground = null;
      continue;
    }
    if (l.kind !== 'shape' || l.fill === null || (l.blend && l.blend !== 'normal')) continue;
    const share = shareIn(text, it);
    if (share < 0.25) continue;
    const alpha = clamp(finite(l.opacity, 1), 0, 1);
    const fills = coloursOf(l.fill, doc.palette);
    if (!fills.length) continue;
    const whole = share >= 0.6 && it.on.from <= when.from + 0.05 && it.on.to >= when.to - 0.05;
    const opaque = fills.every((c) => c.a * alpha >= 0.95);
    if (!ground) {
      // Over an unknown ground only an opaque shape that is under all of the words, all the time, makes it known.
      if (whole && opaque) ground = fills.map((c) => ({ ...c, a: 1 }));
      continue;
    }
    const laid = distinct(ground.flatMap((g) => fills.map((f) => over(f, g, alpha))));
    ground = whole ? laid : distinct([...ground, ...laid]);
  }
  return ground;
}

/** The worst contrast of a text's colours, at the opacity they are drawn with, against any of the ground's. */
function worstContrast(colours: readonly RGBA[], alpha: number, ground: readonly RGBA[]): number {
  let worst = Infinity;
  for (const g of ground) {
    for (const c of colours) worst = Math.min(worst, contrast(css(over(c, g, alpha)), css(g)));
  }
  return Number.isFinite(worst) ? worst : 21;
}

// ── the rules ─────────────────────────────────────────────────────────────

/** Everything a rule needs, worked out once. */
interface Scene {
  doc: Motion;
  items: Item[];
  /** The frame's size in u. */
  W: number;
  H: number;
  rtl: boolean;
  env: Env;
  measured: boolean;
}

type Out = (f: Finding) => void;

/** Words or a number a person reads: text with a letter or digit in it, or a counter. */
const isWords = (it: Item) => (it.layer.kind === 'text' || it.layer.kind === 'counter') && it.words > 0;

/** A move that brings `r` inside the safe area, in physical u; null when it is bigger than the safe area. */
function moveInside(s: Scene, r: Rect): { dx: number; dy: number } | null {
  const m = CHECK.safe + 0.25;
  if (r.x1 - r.x0 > s.W - 2 * m || r.y1 - r.y0 > s.H - 2 * m) return null;
  const dx = r.x0 < m ? m - r.x0 : r.x1 > s.W - m ? s.W - m - r.x1 : 0;
  const dy = r.y0 < m ? m - r.y0 : r.y1 > s.H - m ? s.H - m - r.y1 : 0;
  return { dx, dy };
}

function moveFix(s: Scene, it: Item, label: string): Fix | undefined {
  if (!it.ink) return undefined;
  const mv = moveInside(s, it.ink);
  if (!mv || (Math.abs(mv.dx) < 1e-6 && Math.abs(mv.dy) < 1e-6)) return undefined;
  const l = it.layer;
  // `x` is logical: toward the end, which is leftward in a right-to-left graphic.
  const x = round2(l.x + (s.rtl ? -mv.dx : mv.dx));
  const y = round2(l.y + mv.dy);
  if (Math.abs(x) > LIMITS.reach || Math.abs(y) > LIMITS.reach) return undefined;
  return { label, patches: [{ layerId: l.id, patch: { x, y } }] };
}

/** `off-canvas` and `outside-safe`: words, numbers, charts and icons that run off the frame or crowd its edge. */
function edges(s: Scene, out: Out): void {
  for (const it of s.items) {
    const l = it.layer;
    if (!it.on || !it.ink) continue;
    if (l.kind === 'text' || l.kind === 'counter') {
      if (!isWords(it)) continue;
    } else if ((l.kind !== 'chart' && l.kind !== 'icon') || !inked(l, s.doc.palette)) continue;
    const r = it.ink;
    const past = Math.max(-r.x0, -r.y0, r.x1 - s.W, r.y1 - s.H);
    if (past > CHECK.bleed) {
      out({
        id: `off-canvas:${l.id}`, rule: 'off-canvas', severity: l.kind === 'icon' ? 'tip' : 'warn', layerId: l.id,
        message: 'Part of this runs off the edge of the frame.', fix: moveFix(s, it, 'Move it inside'),
      });
      continue;
    }
    if (l.kind !== 'text' && l.kind !== 'counter') continue;
    if (Math.min(r.x0, r.y0, s.W - r.x1, s.H - r.y1) < CHECK.safe) {
      out({
        id: `outside-safe:${l.id}`, rule: 'outside-safe', severity: 'tip', layerId: l.id,
        message: 'These words are very close to the edge, where a phone or a player can cover them.', fix: moveFix(s, it, 'Move it in'),
      });
    }
  }
}

/** `text-overflow`: words wider than the width they wrap at, and chart labels cut short. */
function overflow(s: Scene, out: Out): void {
  if (!s.measured) return;
  for (const it of s.items) {
    const l = it.layer;
    if (!it.on) continue;
    if (l.kind === 'chart') {
      if (it.parts.length && l.labels && cutLabels(s.env, l)) {
        out({ id: `text-overflow:${l.id}`, rule: 'text-overflow', severity: 'tip', layerId: l.id, message: 'Some of this chart’s labels are cut short to fit.' });
      }
      continue;
    }
    if (l.kind !== 'text' || !isWords(it) || !(l.max > 0) || !(it.width > l.max * 1.02 + 0.2)) continue;
    const size = Math.floor(l.size * (l.max / it.width) * 0.97 * 100) / 100;
    out({
      id: `text-overflow:${l.id}`, rule: 'text-overflow', severity: 'warn', layerId: l.id,
      message: 'These words are wider than their box.',
      fix: size >= CHECK.smallWarn ? { label: 'Shrink to fit', patches: [{ layerId: l.id, patch: { size } }] } : undefined,
    });
  }
}

/** `overlap`: two texts on top of each other, for long enough to be a collision rather than a hand-over. */
function overlaps(s: Scene, out: Out): void {
  const words = s.items.filter((it) => isWords(it) && it.pts.length && it.held);
  for (let a = 0; a < words.length; a++) {
    for (let b = a + 1; b < words.length; b++) {
      const p = words[a];
      const q = words[b];
      if (p.text.trim() === q.text.trim()) continue;
      const hold = during(p.held as Span, q.held as Span);
      if (hold < CHECK.overlapHold) continue;
      // The smaller of the two, and how much of it the other covers.
      const [small, big] = areaOf(p) <= areaOf(q) ? [p, q] : [q, p];
      let n = 0;
      for (const pt of small.pts) if (big.parts.some((qd) => holds(qd, pt, false))) n += 1;
      if (n / small.pts.length <= CHECK.overlap) continue;
      const from = Math.max((p.held as Span).from, (q.held as Span).from);
      out({
        id: `overlap:${p.layer.id}:${q.layer.id}`, rule: 'overlap', severity: 'warn', layerId: q.layer.id, from, to: from + hold,
        message: 'These words overlap “{other}” for {seconds} s.', vars: { other: p.layer.name, seconds: secs(hold) },
      });
    }
  }
}

/** `covered`: words under a solid layer drawn after them. */
function covers(s: Scene, out: Out): void {
  for (const t of s.items) {
    const when = t.held ?? t.on;
    if (!isWords(t) || !t.pts.length || !when) continue;
    let worst = 0;
    let by: Item | null = null;
    for (const c of s.items) {
      if (c.i <= t.i || !c.on || !c.parts.length) continue;
      const l = c.layer;
      let solid = false;
      if (l.kind === 'image' && l.src) solid = true;
      else if (l.kind === 'shape' && l.fill !== null && (!l.blend || l.blend === 'normal')) {
        solid = Math.min(1, ...coloursOf(l.fill, s.doc.palette).map((x) => x.a)) * clamp(finite(l.opacity, 1), 0, 1) >= 0.9;
      }
      if (!solid || during(c.on, when) < CHECK.coveredHold) continue;
      const share = shareIn(t, c);
      if (share > worst) {
        worst = share;
        by = c;
      }
    }
    if (!by || worst < CHECK.covered) continue;
    out({
      id: `covered:${t.layer.id}`, rule: 'covered', severity: worst >= CHECK.coveredWarn ? 'warn' : 'tip', layerId: t.layer.id,
      message: '“{other}” covers {percent}% of these words.', vars: { other: by.layer.name, percent: Math.round(Math.min(1, worst) * 100) },
    });
  }
}

/** `low-contrast`: words that do not stand out from what is under them. */
function contrasts(s: Scene, out: Out): void {
  const pal = s.doc.palette;
  for (const t of s.items) {
    const l = t.layer;
    if (!isWords(t) || (l.kind !== 'text' && l.kind !== 'counter')) continue;
    // An outline or a strong shadow is a ground of the words' own: what is behind them is not what they are read against.
    if (l.kind === 'text' && l.outline && l.outline.width >= 0.15) continue;
    if (l.shadow && Math.max(0, ...coloursOf(l.shadow.color, pal).map((c) => c.a)) >= 0.4) continue;
    const ground = groundOf(s.doc, s.items, t);
    if (!ground || !ground.length) continue;
    const colours = coloursOf(l.color, pal);
    if (!colours.length) continue;
    const alpha = clamp(finite(l.opacity, 1), 0, 1);
    const ratio = worstContrast(colours, alpha, ground);
    const large = t.size >= CHECK.large || (t.size >= CHECK.largeBold && finite(l.weight, 400) >= 700);
    const need = large ? CHECK.contrastLarge : CHECK.contrast;
    if (ratio >= need) continue;
    // The palette colour that reads best, if one reads well enough: a tone, so the graphic can still be re-coloured.
    let best: Tone | null = null;
    let bestRatio = ratio;
    for (const tone of TONES) {
      const c = coloursOf(tone, pal);
      if (!c.length) continue;
      const r = worstContrast(c, alpha, ground);
      if (r > bestRatio + 1e-6) {
        best = tone;
        bestRatio = r;
      }
    }
    out({
      id: `low-contrast:${l.id}`, rule: 'low-contrast', severity: ratio < need * CHECK.contrastWarn ? 'warn' : 'tip', layerId: l.id,
      message: 'These words are hard to read against what is behind them (contrast {ratio} to 1).', vars: { ratio: ratio.toFixed(1) },
      fix: best && bestRatio >= need ? { label: 'Use a clearer colour', patches: [{ layerId: l.id, patch: { color: best } }] } : undefined,
    });
  }
}

/** `small-text`: type too small to read on a phone. */
function smallText(s: Scene, out: Out): void {
  if (!s.measured) return;
  for (const t of s.items) {
    const l = t.layer;
    if (!isWords(t) || !t.on || (l.kind !== 'text' && l.kind !== 'counter')) continue;
    const floor = t.words >= CHECK.bodyWords ? CHECK.smallBody : CHECK.smallLabel;
    if (!(t.size < floor)) continue;
    const scale = Math.abs(finite(l.scale, 1));
    // A fitted text is as small as its box makes it; a larger size would change nothing.
    const shrunk = l.kind === 'text' && l.fit && l.max > 0 && t.size < l.size * scale - 1e-3;
    const size = Math.ceil((floor / Math.max(0.05, scale)) * 10) / 10;
    out({
      id: `small-text:${l.id}`, rule: 'small-text', severity: t.size < CHECK.smallWarn ? 'warn' : 'tip', layerId: l.id,
      message: 'This type is small enough to be hard to read on a phone.',
      fix: !shrunk && scale > 0.05 && size <= LIMITS.fontSize ? { label: 'Make it larger', patches: [{ layerId: l.id, patch: { size } }] } : undefined,
    });
  }
}

/** The total length of a set of spans, overlaps counted once. */
function lengthOf(spans: readonly Span[]): number {
  const sorted = spans.filter((x) => x.to > x.from).sort((a, b) => a.from - b.from);
  let total = 0;
  let end = -Infinity;
  for (const x of sorted) {
    const from = Math.max(x.from, end);
    if (x.to > from) total += x.to - from;
    end = Math.max(end, x.to);
  }
  return total;
}

/**
 * Text layers grouped by their words: a template that hands a title from one
 * layer to another (the kinetic title's words arrive in one and settle in the
 * next) shows one text, and it is read across both.
 */
function readings(s: Scene): Item[][] {
  const groups = new Map<string, Item[]>();
  for (const it of s.items) {
    if (!isWords(it) || !it.on) continue;
    const key = it.layer.kind === 'text' ? `t:${it.text.trim().replace(/\s+/g, ' ')}` : `c:${it.layer.id}`;
    const g = groups.get(key);
    if (g) g.push(it);
    else groups.set(key, [it]);
  }
  return [...groups.values()];
}

/** The layer that stands for a group: the one settled on screen the longest. */
function mainOf(g: Item[]): Item {
  const len = (it: Item) => (it.held ? it.held.to - it.held.from : 0) + 1e-3 * (it.on ? it.on.to - it.on.from : 0);
  return g.reduce((a, b) => (len(b) > len(a) ? b : a));
}

/** A longer layer: its end moved later by `more` seconds, when the graphic has the room. */
function longer(s: Scene, it: Item, more: number): Fix | undefined {
  const l = it.layer;
  const end = Math.ceil((l.end + more + 0.05) * 20) / 20;
  return end <= s.doc.seconds + 1e-9
    ? { label: 'Keep it on screen longer', patches: [{ layerId: l.id, patch: { end: Math.min(end, s.doc.seconds) } }] }
    : undefined;
}

/** `too-fast` and `blink`: words gone before they can be read. */
function reading(s: Scene, out: Out): void {
  for (const g of readings(s)) {
    const main = mainOf(g);
    const l = main.layer;
    const shown = lengthOf(g.map((it) => it.on as Span));
    if (shown < CHECK.blink) {
      out({
        id: `blink:${l.id}`, rule: 'blink', severity: 'warn', layerId: l.id, from: main.on?.from, to: main.on?.to,
        message: 'These words are on screen for less than half a second.', fix: longer(s, main, CHECK.blink - shown),
      });
      continue;
    }
    if (l.kind !== 'text') continue;
    const letters = lettersOf(main.text);
    if (main.words <= CHECK.glanceWords && letters <= CHECK.glanceLetters) continue;
    const read = lengthOf(g.map((it) => spanRead(it.layer, it.on)).filter((x): x is Span => x !== null));
    // Spaces overcount a language that writes its particles apart, letters one that joins its words: the smaller is the load.
    const need = Math.min(main.words, letters / CHECK.letters) / (main.arabic ? CHECK.wpsArabic : CHECK.wps);
    if (read >= need) continue;
    out({
      id: `too-fast:${l.id}`, rule: 'too-fast', severity: read < need / 2 ? 'warn' : 'tip', layerId: l.id,
      message: 'There is not enough time to read these words: {seconds} s, where about {needed} s is needed.',
      vars: { seconds: secs(read), needed: secs(need) },
      fix: longer(s, main, need - read),
    });
  }
}

/** Layers that are what a graphic shows, as against the ground it shows them on: backdrops and particles are ground. */
function foreground(s: Scene): Item[] {
  return s.items.filter((it) => it.on && it.layer.kind !== 'backdrop' && it.layer.kind !== 'particles' && inked(it.layer, s.doc.palette));
}

/** The stretches of [from, to] that no span covers. */
function gaps(spans: readonly Span[], from: number, to: number): Span[] {
  const sorted = spans.filter((x) => x.to >= x.from).sort((a, b) => a.from - b.from);
  const out: Span[] = [];
  let at = from;
  for (const x of sorted) {
    if (x.from > at) out.push({ from: at, to: Math.min(x.from, to) });
    at = Math.max(at, x.to);
    if (at >= to) break;
  }
  if (at < to) out.push({ from: at, to });
  return out.filter((x) => x.to - x.from > 1e-6);
}

/** A graphic with a transparent frame goes over footage somebody else made: nothing it does not draw is "stuck" or "empty". */
const overVideo = (s: Scene) => s.doc.backdrop === null || s.doc.backdrop === undefined;

/** `late-start` and `empty-frame`: a graphic that keeps the viewer waiting, or shows nothing. */
function emptiness(s: Scene, out: Out): void {
  const fg = foreground(s);
  if (!fg.length) return;
  const spans = fg.map((it) => it.on as Span);
  const first = Math.min(...spans.map((x) => x.from));
  // Over video (a transparent frame) the picture is moving and the graphic is meant to arrive when it is needed: not kept waiting.
  if (first > CHECK.lateStart && !overVideo(s)) {
    out({
      id: 'late-start', rule: 'late-start', severity: 'tip', from: 0, to: first,
      message: 'Nothing appears until {seconds} s; the first half second is when a viewer decides to stay.', vars: { seconds: secs(first) },
    });
  }
  const seconds = s.doc.seconds;
  // A scene with nothing in it yet is one that has just been added: it is being built, not a mistake to report, and the repair
  // (trim the graphic) would delete it. A gap that lies wholly inside such a scene is left alone.
  const building = (s.doc.scenes ?? []).filter((sc) => !spans.some((x) => x.from < sc.end - 1e-6 && x.to > sc.start + 1e-6));
  for (const g of gaps(spans, first, seconds)) {
    if (g.to - g.from < CHECK.empty) continue;
    if (building.some((sc) => g.from >= sc.start - 1e-6 && g.to <= sc.end + 1e-6)) continue;
    const last = g.to >= seconds - 1e-6;
    // At the end, the graphic could simply stop when its last layer does.
    const end = Math.ceil((Math.max(...fg.map((it) => it.layer.end)) + 0.05) * 10) / 10;
    const trim = last && end >= LIMITS.minSeconds && end <= seconds - 0.25;
    out({
      id: `empty-frame:@${secs(g.from)}`, rule: 'empty-frame', severity: 'tip', from: g.from, to: g.to,
      message: last ? 'The last {seconds} s show nothing.' : 'Nothing is on screen for {seconds} s.', vars: { seconds: secs(g.to - g.from) },
      fix: trim ? { label: 'Trim the end', patches: [], seconds: end } : undefined,
    });
  }
}

/** When each layer is changing: arriving, leaving, looping, counting, or — a backdrop, particles — always. */
function changes(s: Scene): Span[] {
  const spans: Span[] = [];
  for (const it of s.items) {
    const l = it.layer;
    const on = it.on;
    if (!on) continue;
    const always = l.kind === 'backdrop' ? l.speed > 0 : l.kind === 'particles' ? l.count > 0 : false;
    if (!always && !inked(l, s.doc.palette)) continue;
    if (always || (l.loop && l.loop.fx !== 'none' && l.loop.amount > 0)) {
      spans.push(on);
      continue;
    }
    // A cut is a change too: the moment something appears or goes.
    spans.push({ from: on.from, to: on.from }, { from: on.to, to: on.to });
    const n = unitsOf(l);
    if (l.in && l.in.fx !== 'none') spans.push({ from: on.from, to: finite(inDone(l, n), on.from) });
    if (l.out && l.out.fx !== 'none') spans.push({ from: finite(outStart(l, n), on.to), to: on.to });
    if (l.kind === 'counter' && l.from !== l.to) {
      const a = l.start + finite(l.count.delay, 0);
      spans.push({ from: a, to: a + finite(l.count.d, 0) });
    }
  }
  return spans;
}

/** `frozen`: a stretch where nothing at all moves. */
function stillness(s: Scene, out: Out): void {
  if (!foreground(s).length || overVideo(s)) return;
  for (const g of gaps(changes(s), 0, s.doc.seconds)) {
    if (g.to - g.from < CHECK.frozen) continue;
    out({
      id: `frozen:@${secs(g.from)}`, rule: 'frozen', severity: 'tip', from: g.from, to: g.to,
      message: 'Nothing moves for {seconds} s.', vars: { seconds: secs(g.to - g.from) },
    });
  }
}

/** `dense`: more on screen at once than anyone reads. */
function density(s: Scene, out: Out): void {
  const texts = s.items.filter((it) => it.layer.kind === 'text' && isWords(it) && it.held);
  if (texts.length <= CHECK.dense) return;
  // Every moment a text settles is a candidate for the busiest one.
  for (const at of [...new Set(texts.map((it) => (it.held as Span).from))].sort((a, b) => a - b)) {
    const now = texts.filter((it) => (it.held as Span).from <= at && (it.held as Span).to > at);
    const words = now.reduce((n, it) => n + it.words, 0);
    if (now.length <= CHECK.dense || words <= CHECK.denseWords) continue;
    out({
      id: `dense:@${secs(at)}`, rule: 'dense', severity: 'tip', from: at, to: Math.min(...now.map((it) => (it.held as Span).to)),
      message: '{count} separate texts are on screen at once; fewer read faster.', vars: { count: now.length },
    });
    return;
  }
}

// ── the check ─────────────────────────────────────────────────────────────

/**
 * A context for makeEnv when there is nothing to measure with: the rules
 * that need words measured are skipped then, and nothing else asks it anything.
 */
const NO_CTX = {} as MeasureCtx;

/**
 * A finding without the keys it has no value for, rather than keys set to
 * undefined, so the object a test compares and the one JSON keeps are the
 * same; times to the millisecond, so a sort never turns on the last bit of a sum.
 */
function tidy(f: Finding): Finding {
  const copy: Finding = { id: f.id, rule: f.rule, severity: f.severity, message: f.message };
  if (f.layerId !== undefined) copy.layerId = f.layerId;
  if (f.from !== undefined && Number.isFinite(f.from)) copy.from = Math.round(f.from * 1000) / 1000;
  if (f.to !== undefined && Number.isFinite(f.to)) copy.to = Math.round(f.to * 1000) / 1000;
  if (f.vars !== undefined) copy.vars = f.vars;
  if (f.fix !== undefined) copy.fix = f.fix;
  return copy;
}

/**
 * Everything worth pointing out in `doc`, warnings first, then in the order
 * of the layers they are about. Pure: the same document gives the same list,
 * in the same order, with the same ids. Never throws: a layer the check
 * cannot place is a layer it says nothing about, as paint() skips a layer it
 * cannot draw.
 */
export function checkMotion(doc: Motion, o: CheckOptions = {}): Finding[] {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.layers)) return [];
  const ctx = o?.ctx ?? ownCtx();
  const size = FORMATS[doc.format] ?? FORMATS.landscape;
  const env = makeEnv(ctx ?? NO_CTX, doc, 0, size.width, size.height);
  const items: Item[] = [];
  doc.layers.forEach((layer, i) => {
    if (!layer || typeof layer !== 'object') return;
    try {
      items.push(itemOf(env, ctx, layer, i));
    } catch {
      /* a layer that cannot be placed is left out of the check */
    }
  });
  const scene: Scene = { doc, items, W: size.width / env.k, H: size.height / env.k, rtl: env.rtl, env, measured: !!ctx };
  const found = new Map<string, Finding>();
  const out: Out = (f) => {
    if (!found.has(f.id)) found.set(f.id, tidy(f));
  };
  for (const rule of [edges, overflow, overlaps, covers, contrasts, smallText, reading, emptiness, stillness, density]) {
    try {
      rule(scene, out);
    } catch {
      /* a rule that fails costs its own findings, never the others' */
    }
  }
  const order = new Map(doc.layers.map((l, i) => [l?.id, i] as const));
  return [...found.values()].sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'warn' ? -1 : 1)
    || (a.layerId === undefined ? 1 : 0) - (b.layerId === undefined ? 1 : 0)
    || (order.get(a.layerId ?? '') ?? 0) - (order.get(b.layerId ?? '') ?? 0)
    || RULES.indexOf(a.rule as Rule) - RULES.indexOf(b.rule as Rule)
    || finite(a.from, 0) - finite(b.from, 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** How many tips and warnings, and whether there is nothing to say. */
export function summarize(findings: readonly Finding[]): { warn: number; tip: number; clean: boolean } {
  let warn = 0;
  let tip = 0;
  for (const f of Array.isArray(findings) ? findings : []) {
    if (f?.severity === 'warn') warn += 1;
    else if (f?.severity === 'tip') tip += 1;
  }
  return { warn, tip, clean: warn + tip === 0 };
}

// ── repairs ───────────────────────────────────────────────────────────────

/** A repair applied through motionedit.ts, stamped with the graphic's own time so the result is a function of the input. */
function applyFix(doc: Motion, fix: Fix): Motion {
  let m = doc;
  if (fix.seconds !== undefined && Number.isFinite(fix.seconds)) m = setSeconds(m, fix.seconds, doc.updated);
  for (const p of fix.patches) m = setLayer(m, p.layerId, p.patch, doc.updated);
  return m;
}

/**
 * What a finding is about, ignoring when: a repair may move a stretch of
 * time, and an empty stretch that moved is not a new problem. An overlap is
 * about a pair, so the pair is its key.
 */
const keyOf = (f: Finding) => (f.rule === 'overlap' ? f.id : `${f.rule}|${f.layerId ?? ''}`);

/** Whether `after` is better than `before` for `f`: `f` is gone, nothing has appeared or grown in number, and there are no more warnings. */
function better(before: readonly Finding[], after: readonly Finding[], f: Finding): boolean {
  if (after.some((x) => x.id === f.id)) return false;
  const count = (list: readonly Finding[]) => {
    const m = new Map<string, number>();
    for (const x of list) m.set(keyOf(x), (m.get(keyOf(x)) ?? 0) + 1);
    return m;
  };
  const was = count(before);
  for (const [k, n] of count(after)) if (n > (was.get(k) ?? 0)) return false;
  return after.filter((x) => x.severity === 'warn').length <= before.filter((x) => x.severity === 'warn').length;
}

/**
 * `doc` with the repairs made for the findings named by `ids` — every one of
 * `findings` when `ids` is not given. A finding is followed by what it is
 * about (its rule and layer, `keyOf`) rather than its exact id, and looked up
 * again on `doc` itself each time: a list from a check a moment ago that the
 * graphic has since moved past is never applied blindly, and an empty
 * stretch that a repair moved is still the one asked about. Each repair is
 * kept only if the check, run again, agrees it helped: its finding is gone,
 * no other has appeared, and there are no more warnings than before. Then it
 * looks again, because one repair can make another possible, until nothing
 * changes. That is what makes it idempotent: every repair still possible
 * afterwards was tried on this very document in the last round and refused,
 * so a second call finds nothing to do. Returns `doc` itself when nothing
 * changed. Pure.
 */
export function autofix(doc: Motion, findings: readonly Finding[], ids?: readonly string[], o: CheckOptions = {}): Motion {
  if (!doc || typeof doc !== 'object') return doc;
  const given = Array.isArray(findings) ? findings.filter((f): f is Finding => !!f && typeof f.id === 'string') : [];
  const named = ids === undefined ? null : new Set(ids.filter((x) => typeof x === 'string'));
  const chosen = named ? given.filter((f) => named.has(f.id)) : given;
  // An id the caller has that the list does not: look for it in the graphic as it is now.
  const missing = named ? [...named].filter((id) => !given.some((f) => f.id === id)) : [];
  const wanted = new Set(chosen.map(keyOf));
  if (missing.length) for (const f of checkMotion(doc, o)) if (missing.includes(f.id)) wanted.add(keyOf(f));
  if (!wanted.size) return doc;
  let cur = doc;
  // Every repair kept removes a finding and adds none, so the loop ends on its own; the cap is a guard.
  for (let round = 0; round < 64; round++) {
    const now = checkMotion(cur, o);
    let next: Motion | null = null;
    for (const f of now) {
      if (!f.fix || !wanted.has(keyOf(f))) continue;
      let tried: Motion;
      try {
        tried = applyFix(cur, f.fix);
      } catch {
        continue;
      }
      if (tried !== cur && better(now, checkMotion(tried, o), f)) {
        next = tried;
        break;
      }
    }
    if (!next) break;
    cur = next;
  }
  return cur;
}
