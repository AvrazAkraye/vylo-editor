import type { ChartLayer, Ctx, Env, Pose } from './motiontypes';
import { LIMITS } from './motiontypes';
import { poseAt } from './motionanim';
import { clamp, clamp01, easeOf, finite, lerp, mixColors, smoothstep, withAlpha } from './motionmath';
import { digitsFor, fontString, formatNumber, scriptOf } from './motionfonts';

/**
 * Charts for Motion: bars, horizontal bars, a line, a donut and a progress
 * ring, drawn inside the chart layer's own `w × h` box. `motiondraw.ts`'s
 * `paint` has already moved the origin to the middle of that box and applied
 * the layer's own pose (its place, turn, scale and opacity), so this file
 * only lays the chart out and animates its data.
 *
 * ## One datum after another
 *
 * Each datum runs the layer's entrance on its own, `gap` seconds after the
 * one before (`poseAt` with a unit), so a bar chart grows bar by bar and a
 * donut sweeps in segment by segment. What a datum's pose says is read as how
 * much of it is there — grown, drawn and uncovered are the same thing to a
 * chart — and how visible it is relative to the layer, whose opacity is
 * already on the context. A value counts up as its datum grows and never
 * passes its own number: a curve that overshoots may stretch a bar, but a
 * label that says 104 on its way to 100 is a wrong number.
 *
 * ## Inside the box, whatever the data
 *
 * Labels shrink and then shorten to their room; a bar's overshoot is
 * allowed for in the layout; a value above `max` is drawn at the top of the
 * scale and still labelled with its own number. Negative values are drawn as
 * zero — a bar below the baseline needs a second axis these charts do not
 * have — and anything that is not a number is zero too.
 *
 * ## Direction
 *
 * In a right-to-left document the first datum is on the right of a bar or
 * line chart and horizontal bars grow from the right edge, as the language
 * reads; a donut still turns clockwise, as a clock does in every language.
 * Each label is set in the face for its own script and in its own direction.
 *
 * ## One layout at every size
 *
 * A chart is laid out in the pixels it has in a frame 1080 px on its short
 * side, whatever frame it is painted into, and drawn through a context
 * scaled to that frame (`drawChart`'s `scale`, which `motiondraw.ts` gives it
 * as it gives a text). The system faces set a word wider, for its size, the
 * smaller they set it (SF Pro has optical sizes), so a label measured at the
 * size it was drawn was sized, shortened and placed differently in the
 * stage's small preview, a gallery card and the export. Now every size,
 * ellipsis and place is a function of the document and the time alone; only
 * a hairline's least width is the frame's, so it never vanishes when small.
 */

const TAU = Math.PI * 2;

/** How far past its length a bar may stretch on an overshooting curve. The layout keeps this much room. */
const STRETCH = 1.1;

/** How much of its slot a label under a bar or a point may fill: the rest is the air between two labels. */
const LABEL_ROOM = 0.88;

/** Arabic script, where a label runs right to left whatever the document does. */
const ARABIC = /\p{Script=Arabic}/u;

/** A first strong letter of any script, to tell a word from a number. */
const LETTER = /\p{L}/u;

/** The Arabic percent sign, which Arabic-script documents write after Arabic-Indic digits. */
const ARABIC_PERCENT = String.fromCharCode(0x066a);

/** One datum as drawn. */
interface Datum {
  label: string;
  /** Never negative, always finite. */
  value: number;
  /** The number as it was given (signed, finite): what a label says, so a negative datum is never labelled 0. */
  shown: number;
  color: string;
  /** How far it has grown: may pass 1 for a curve that overshoots. */
  grow: number;
  /** 0 to 1: how much of it is there. */
  e: number;
  /** 0 to 1: its opacity relative to the layer's. */
  alpha: number;
}

/** Everything one chart is drawn from on one frame. */
interface Chart {
  env: Env;
  ctx: Ctx;
  layer: ChartLayer;
  /** The box, in pixels. */
  W: number;
  H: number;
  k: number;
  data: Datum[];
  /** The value the scale tops out at. */
  top: number;
  decimals: number;
  /** Pixels: the labels' size. */
  font: number;
  /** How large one of the chart's pixels is drawn in the frame: for the lengths that must be the frame's. */
  scale: number;
  /** The label colour as one colour, for the faint lines drawn in it. */
  ink: string;
  /** The label colour as the layer gives it, perhaps a gradient across the box. */
  inkFill: string | CanvasGradient;
  bg: string;
  /** The context's opacity on entry: the layer's. */
  base: number;
  rtl: boolean;
}

/**
 * Draw a chart layer, centred on the origin. The layer-level `pose` is on the
 * context already; each datum's own pose (`poseAt` with `{ i, n }`) decides
 * how much of it is there and how visible it is.
 *
 * `scale` is how much larger than its layout the chart is drawn: it is laid
 * out at `env.k / scale` pixels per u and drawn through a context scaled by
 * `scale` (the header's One layout says why). `motiondraw.ts` passes the
 * scale that takes the 1080 px layout to the frame; 1, the default, lays the
 * chart out in the frame's own pixels.
 */
export function drawChart(env: Env, layer: ChartLayer, pose: Pose, scale = 1): void {
  const ctx = env.ctx;
  const drawn = finite(scale, 1) > 0 ? scale : 1;
  const k = (finite(env.k, 0) > 0 ? env.k : 1) / drawn;
  const W = clamp(finite(layer.w, 60), 1, LIMITS.size) * k;
  const H = clamp(finite(layer.h, 40), 1, LIMITS.size) * k;
  const raw = Array.isArray(layer.data) ? layer.data.slice(0, LIMITS.dataPoints) : [];
  if (!raw.length) return;

  const colors = paletteOf(env, layer.colors);
  const n = raw.length;
  const layerAlpha = Math.max(1e-6, finite(pose.opacity, 1));
  const data: Datum[] = raw.map((d, i) => {
    const p = poseAt(layer, env.t, env.rtl, { i, n });
    // A draw or a wipe still under way caps the growth; with neither, a curve that overshoots may stretch the datum past its length.
    const held = Math.min(clamp01(finite(p.draw, 1)), clamp01(finite(p.reveal, 1)));
    const grow = held < 1 ? Math.min(clamp(finite(p.grow, 1), 0, 1.25), held) : clamp(finite(p.grow, 1), 0, 1.25);
    return {
      label: typeof d?.label === 'string' ? Array.from(d.label.trim()).slice(0, LIMITS.label).join('') : '',
      value: Math.max(0, finite(Number(d?.value), 0)),
      shown: finite(Number(d?.value), 0),
      color: colors[i % colors.length],
      grow,
      e: clamp01(grow),
      alpha: clamp01(finite(p.opacity, 0) / layerAlpha),
    };
  });
  const largest = Math.max(...data.map((d) => d.value));
  const max = finite(layer.max, 0);
  const inkPaint = layer.color ?? 'fg';
  const c: Chart = {
    env, ctx, layer, W, H, k, data,
    top: max > 0 ? max : largest > 0 ? largest : 1,
    decimals: decimalsOf(data.map((d) => d.value)),
    font: clamp(finite(layer.size, 2.4), 0.5, 40) * k,
    scale: drawn,
    ink: typeof inkPaint === 'string' ? env.color(inkPaint) : env.color(inkPaint.stops?.[0]?.color ?? 'fg'),
    inkFill: env.paint(inkPaint, W, H),
    bg: env.color('bg'),
    base: clamp01(finite(ctx.globalAlpha, 1)),
    rtl: !!env.rtl,
  };
  ctx.save();
  if (drawn !== 1) ctx.scale(drawn, drawn);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (layer.chart) {
    case 'hbars': hbars(c); break;
    case 'line': line(c); break;
    case 'donut': donut(c); break;
    case 'ring': ring(c); break;
    default: bars(c); break;
  }
  ctx.restore();
}

// ── shared ────────────────────────────────────────────────────────────────

function rgba(color: string, alpha: number): string {
  return withAlpha(color, clamp01(finite(alpha, 0)));
}

/** The data colours as CSS colours, the palette's own when the layer names none. */
function paletteOf(env: Env, list: readonly string[] | undefined): string[] {
  const named = Array.isArray(list) ? list.filter((x) => typeof x === 'string' && x.trim() !== '') : [];
  return (named.length ? named : ['accent', 'accent2', 'fg', 'muted']).slice(0, LIMITS.colors).map((x) => env.color(x));
}

/**
 * Decimals the values need: none when they are all whole, one otherwise, and
 * two when every value is below one, where a single decimal would round
 * most of them to the same number.
 */
function decimalsOf(values: number[]): number {
  if (values.every((v) => Math.abs(v - Math.round(v)) < 1e-9)) return 0;
  return Math.max(...values) < 1 ? 2 : 1;
}

/** A value as it is written: the document's digits, grouped, with the unit after it. */
function valueText(c: Chart, v: number, decimals = c.decimals): string {
  const num = formatNumber(v, { decimals, group: true, lang: c.env.doc.lang });
  const raw = typeof c.layer.unit === 'string' ? Array.from(c.layer.unit.trim()).slice(0, LIMITS.suffix).join('') : '';
  const unit = raw === '%' || raw === ARABIC_PERCENT ? percentSign(c) : raw;
  if (!unit) return num;
  // A word ("users", "كم") stands apart from its number; a sign (%, $) or a letter (k, M) does not.
  return LETTER.test(unit[0]) && Array.from(unit).length > 1 ? `${num} ${unit}` : `${num}${unit}`;
}

/**
 * The one weight every chart word is set in. A chart layer names no weight,
 * and `fontsNeeded` loads its face at this one before the first frame, so a
 * chart drawn at any other would be drawn in a face nobody waited for.
 */
const WEIGHT = 600;

/** Set the face for this text: its script's face, and its script's direction, so bidi places its marks right. */
function setType(c: Chart, px: number, text: string, number = false): void {
  c.ctx.font = fontString(c.layer.voice, WEIGHT, Math.max(1, px), scriptOf(text));
  const rtl = number ? c.rtl : ARABIC.test(text) || (!LETTER.test(text) && c.rtl);
  c.ctx.direction = rtl ? 'rtl' : 'ltr';
}

function widthOf(c: Chart, text: string): number {
  const w = finite(c.ctx.measureText(text).width, 0);
  return w > 0 ? w : 0;
}

/**
 * One size for a set of texts: `px`, or smaller until the widest fits `room`,
 * but never below `least` of it — past that a label is shortened instead,
 * because words too small to read are worse than a word cut short.
 */
function sizeFor(c: Chart, px: number, texts: string[], room: number, least = 0.7, number = false): number {
  let size = px;
  for (const t of texts) {
    if (!t) continue;
    setType(c, px, t, number);
    const w = widthOf(c, t);
    if (w > room && w > 0) size = Math.min(size, (px * room) / w);
  }
  return Math.max(px * least, size);
}

/** The text, cut short with an ellipsis to fit `room` at the face already set; empty when not even one letter fits. */
function shorten(c: Chart, text: string, room: number): string {
  if (widthOf(c, text) <= room) return text;
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (widthOf(c, chars.slice(0, mid).join('').trimEnd() + '…') <= room) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? chars.slice(0, lo).join('').trimEnd() + '…' : '';
}

/** Write a label in the label colour, at an opacity relative to the layer's. */
function label(c: Chart, text: string, px: number, x: number, y: number, align: CanvasTextAlign, room: number, alpha: number): void {
  if (!text || !(alpha > 0.002)) return;
  setType(c, px, text);
  const shown = shorten(c, text, room);
  if (!shown) return;
  c.ctx.globalAlpha = c.base * clamp01(alpha);
  c.ctx.fillStyle = c.inkFill;
  c.ctx.textAlign = align;
  c.ctx.fillText(shown, x, y);
}

/** Write a value; values are never shortened, so their size was chosen to fit. */
function value(c: Chart, text: string, px: number, x: number, y: number, align: CanvasTextAlign, alpha: number, fill: string | CanvasGradient = c.inkFill): void {
  if (!(alpha > 0.002)) return;
  setType(c, px, text, true);
  c.ctx.globalAlpha = c.base * clamp01(alpha);
  c.ctx.fillStyle = fill;
  c.ctx.textAlign = align;
  c.ctx.fillText(text, x, y);
}

/**
 * A bar's visible length for its growth: an overshoot is kept, squeezed into
 * the room `STRETCH` leaves, so a spring still reads as a spring.
 */
function stretch(g: number): number {
  return g <= 1 ? g : 1 + ((g - 1) / 0.25) * (STRETCH - 1);
}

/** A datum's share of the scale, 0 to 1: above `max` is at the top. */
function share(c: Chart, v: number): number {
  return clamp01(v / c.top);
}

/**
 * A rectangle with its two corners at one end rounded: a bar, rounded at its
 * tip. `tip` is the side it grows toward.
 */
function tipRounded(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, tip: 'up' | 'left' | 'right'): void {
  const w = x1 - x0;
  const h = y1 - y0;
  const rr = Math.max(0, Math.min(r, (tip === 'up' ? w : h) / 2, tip === 'up' ? h : w));
  ctx.beginPath();
  if (tip === 'up') {
    ctx.moveTo(x0, y1);
    ctx.lineTo(x0, y0 + rr);
    ctx.arcTo(x0, y0, x0 + rr, y0, rr);
    ctx.lineTo(x1 - rr, y0);
    ctx.arcTo(x1, y0, x1, y0 + rr, rr);
    ctx.lineTo(x1, y1);
  } else if (tip === 'right') {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - rr, y0);
    ctx.arcTo(x1, y0, x1, y0 + rr, rr);
    ctx.lineTo(x1, y1 - rr);
    ctx.arcTo(x1, y1, x1 - rr, y1, rr);
    ctx.lineTo(x0, y1);
  } else {
    ctx.moveTo(x1, y0);
    ctx.lineTo(x0 + rr, y0);
    ctx.arcTo(x0, y0, x0, y0 + rr, rr);
    ctx.lineTo(x0, y1 - rr);
    ctx.arcTo(x0, y1, x0 + rr, y1, rr);
    ctx.lineTo(x1, y1);
  }
  ctx.closePath();
}

/** A rectangle with every corner rounded: a legend's swatch. */
function rounded(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  ctx.beginPath();
  ctx.moveTo(x0 + rr, y0);
  ctx.arcTo(x1, y0, x1, y1, rr);
  ctx.arcTo(x1, y1, x0, y1, rr);
  ctx.arcTo(x0, y1, x0, y0, rr);
  ctx.arcTo(x0, y0, x1, y0, rr);
  ctx.closePath();
}

/**
 * The percent sign that goes with the document's digits: the Arabic one after
 * Arabic-Indic digits, the Latin one after Latin digits, whichever the layer
 * wrote — a template writes `%` once for every language.
 */
function percentSign(c: Chart): string {
  return digitsFor(c.env.doc.lang) === 'arab' ? ARABIC_PERCENT : '%';
}

/** A faint rule in the label colour: a baseline. */
function rule(c: Chart, x0: number, y0: number, x1: number, y1: number): void {
  const { ctx } = c;
  ctx.globalAlpha = c.base;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = rgba(c.ink, 0.22);
  // Never thinner than a pixel of the frame, however small the chart is drawn.
  ctx.lineWidth = Math.max(1 / c.scale, 0.14 * c.k);
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Where along a row datum `i` of `n` sits: from the start edge, which is the right in a right-to-left document. */
function along(c: Chart, i: number, n: number, from: number, to: number): number {
  const at = n > 1 ? from + ((to - from) * i) / (n - 1) : (from + to) / 2;
  return c.rtl ? -at : at;
}

// ── bars ──────────────────────────────────────────────────────────────────

/** `bars`: upright bars rounded at the top over a faint baseline, the label under each and the value counting up above it. */
function bars(c: Chart): void {
  const { ctx, W, H, k, data } = c;
  const n = data.length;
  const slot = W / n;
  const showLabels = c.layer.labels && data.some((d) => d.label);
  const showValues = c.layer.values;
  const labelPx = showLabels ? sizeFor(c, c.font, data.map((d) => d.label), slot * LABEL_ROOM) : 0;
  const valuePx = showValues ? sizeFor(c, c.font, data.map((d) => valueText(c, d.shown)), slot * 0.96, 0.5, true) : 0;
  const labelRow = showLabels ? Math.min(labelPx * 1.9, H * 0.3) : 0;
  const valueRow = showValues ? Math.min(valuePx * 1.6, H * 0.3) : 0;
  const baseY = H / 2 - labelRow;
  const topY = -H / 2 + valueRow;
  const full = Math.max(0, baseY - topY) / STRETCH;
  const barW = Math.max(1, Math.min(slot * 0.62, H * 0.45));
  const radius = Math.min(barW * 0.24, k * 1.8);

  rule(c, -W / 2, baseY, W / 2, baseY);
  data.forEach((d, i) => {
    const cx = along(c, i, n, -W / 2 + slot / 2, W / 2 - slot / 2);
    const f = share(c, d.value);
    // A value too small to see at this scale still shows as a sliver, so it does not read as zero.
    const len = f > 0 ? Math.max(full * f, Math.min(full, k * 0.45)) : 0;
    const h = len * stretch(d.grow);
    if (h > 0.25 && d.alpha > 0.002) {
      ctx.globalAlpha = c.base * d.alpha;
      tipRounded(ctx, cx - barW / 2, baseY - h, cx + barW / 2, baseY, radius, 'up');
      const g = ctx.createLinearGradient(0, baseY - Math.max(h, 1), 0, baseY);
      g.addColorStop(0, d.color);
      g.addColorStop(1, mixColors(d.color, c.bg, 0.3));
      ctx.fillStyle = g;
      ctx.fill();
    }
    if (showValues && d.e > 0) {
      ctx.textBaseline = 'alphabetic';
      const text = valueText(c, d.shown * d.e);
      setType(c, valuePx, text, true);
      const half = widthOf(c, text) / 2;
      const x = clamp(cx, -W / 2 + half, W / 2 - half);
      value(c, text, valuePx, x, baseY - h - valuePx * 0.42, 'center', d.alpha * smoothstep(0, 0.12, d.e));
    }
    if (showLabels) {
      ctx.textBaseline = 'middle';
      label(c, d.label, labelPx, cx, baseY + labelRow / 2 + labelPx * 0.08, 'center', slot * LABEL_ROOM, d.alpha * 0.78 * smoothstep(0, 0.2, d.e));
    }
  });
}

/** `hbars`: bars lying down, grown from the start edge, the label flush against the bar's start and the value just past its tip. */
function hbars(c: Chart): void {
  const { ctx, W, H, k, data } = c;
  const n = data.length;
  const rowH = H / n;
  const showLabels = c.layer.labels && data.some((d) => d.label);
  const showValues = c.layer.values;
  const cap = rowH * 0.62;
  const labelPx = showLabels ? Math.min(sizeFor(c, c.font, data.map((d) => d.label), W * 0.34), cap) : 0;
  const valueTexts = data.map((d) => valueText(c, d.shown));
  const valuePx = showValues ? Math.min(sizeFor(c, c.font, valueTexts, W * 0.24, 0.5, true), cap) : 0;
  let labelW = 0;
  if (showLabels) {
    for (const d of data) {
      if (!d.label) continue;
      setType(c, labelPx, d.label);
      labelW = Math.max(labelW, widthOf(c, d.label));
    }
    labelW = Math.min(labelW, W * 0.34);
  }
  let valueW = 0;
  if (showValues) {
    for (const t of valueTexts) {
      setType(c, valuePx, t, true);
      valueW = Math.max(valueW, widthOf(c, t));
    }
  }
  const gap = Math.max(labelPx, valuePx, k) * 0.6;
  const start = -W / 2 + (labelW > 0 ? labelW + gap : 0);
  const room = Math.max(0, W / 2 - (valueW > 0 ? valueW + gap : 0) - start);
  const full = room / STRETCH;
  const thick = Math.max(1, Math.min(rowH * 0.62, Math.max(c.font * 2.2, H * 0.16)));
  const radius = Math.min(thick * 0.3, k * 1.6);
  const dir = c.rtl ? -1 : 1;
  const x0 = dir * start;

  rule(c, x0, -H / 2 + rowH * 0.5 - thick * 0.7, x0, H / 2 - rowH * 0.5 + thick * 0.7);
  data.forEach((d, i) => {
    const cy = -H / 2 + (i + 0.5) * rowH;
    const f = share(c, d.value);
    const len = (f > 0 ? Math.max(full * f, Math.min(full, k * 0.45)) : 0) * stretch(d.grow);
    const tip = x0 + dir * len;
    if (len > 0.25 && d.alpha > 0.002) {
      ctx.globalAlpha = c.base * d.alpha;
      if (dir > 0) tipRounded(ctx, x0, cy - thick / 2, tip, cy + thick / 2, radius, 'right');
      else tipRounded(ctx, tip, cy - thick / 2, x0, cy + thick / 2, radius, 'left');
      const g = ctx.createLinearGradient(x0, 0, x0 + dir * Math.max(len, 1), 0);
      g.addColorStop(0, mixColors(d.color, c.bg, 0.3));
      g.addColorStop(1, d.color);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.textBaseline = 'middle';
    if (showValues && d.e > 0) {
      value(c, valueText(c, d.shown * d.e), valuePx, tip + dir * gap * 0.8, cy, dir > 0 ? 'left' : 'right', d.alpha * smoothstep(0, 0.12, d.e));
    }
    if (showLabels) {
      label(c, d.label, labelPx, x0 - dir * gap, cy, dir > 0 ? 'right' : 'left', labelW, d.alpha * 0.78 * smoothstep(0, 0.2, d.e));
    }
  });
}

// ── line ──────────────────────────────────────────────────────────────────

/** Cubic Bézier at `t`. */
function bez(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const s = 1 - t;
  return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
}

/**
 * `line`: a smooth curve through the points (Catmull-Rom, its handles kept
 * inside the plot so the curve never dips under the baseline), a soft area
 * under it, dots that pop in as the line reaches them, labels along the
 * bottom. The line draws on from the first datum to the last: each segment
 * adds its share as its datum's entrance runs, so the stroke is always one
 * unbroken piece however the entrances overlap.
 */
function line(c: Chart): void {
  const { ctx, W, H, k, data } = c;
  const n = data.length;
  const showLabels = c.layer.labels && data.some((d) => d.label);
  const showValues = c.layer.values;
  const lineW = clamp(finite(c.layer.thick, 1) * k, 1, H * 0.08);
  const dotR = Math.max(lineW * 1.25, k * 0.7);
  const step = n > 1 ? W / (n - 1) : W;
  const labelPx = showLabels ? sizeFor(c, c.font, data.map((d) => d.label), Math.min(step, W) * LABEL_ROOM) : 0;
  const valueTexts = data.map((d) => valueText(c, d.shown));
  const valuePx = showValues ? sizeFor(c, c.font, valueTexts, Math.min(step, W) * 0.96, 0.5, true) : 0;
  // Inset the ends so the first and last dot, value and label stay inside the box.
  let pad = dotR + lineW;
  if (showLabels) {
    for (const d of [data[0], data[n - 1]]) {
      if (!d.label) continue;
      setType(c, labelPx, d.label);
      pad = Math.max(pad, Math.min(widthOf(c, d.label), step * LABEL_ROOM) / 2);
    }
  }
  if (showValues) {
    for (const t of [valueTexts[0], valueTexts[n - 1]]) {
      setType(c, valuePx, t, true);
      pad = Math.max(pad, widthOf(c, t) / 2);
    }
  }
  pad = Math.min(pad, W * 0.3);
  const labelRow = showLabels ? Math.min(labelPx * 1.9, H * 0.3) : 0;
  const valueRow = showValues ? Math.min(valuePx * 1.7, H * 0.3) : 0;
  const baseY = H / 2 - labelRow - lineW / 2;
  const topY = -H / 2 + valueRow + dotR;
  const plotH = Math.max(0, baseY - topY);
  const pts = data.map((d, i) => ({ x: along(c, i, n, -W / 2 + pad, W / 2 - pad), y: baseY - plotH * share(c, d.value) }));

  // The curve as a polyline, fine enough that the eye sees a curve, with the length to each point.
  const poly: { x: number; y: number }[] = [{ ...pts[0] }];
  const reach: number[] = [0];
  let total = 0;
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const p = pts[i];
    const q = pts[i + 1];
    const b = pts[Math.min(n - 1, i + 2)];
    const c1x = p.x + (q.x - a.x) / 6;
    const c1y = clamp(p.y + (q.y - a.y) / 6, topY, baseY);
    const c2x = q.x - (b.x - p.x) / 6;
    const c2y = clamp(q.y - (b.y - p.y) / 6, topY, baseY);
    for (let s = 1; s <= 20; s++) {
      const t = s / 20;
      const x = bez(p.x, c1x, c2x, q.x, t);
      const y = bez(p.y, c1y, c2y, q.y, t);
      const last = poly[poly.length - 1];
      total += Math.hypot(x - last.x, y - last.y);
      poly.push({ x, y });
    }
    reach.push(total);
  }
  // Drawn so far: each segment's share of the length, as far as its datum has come.
  let drawn = 0;
  for (let i = 1; i < n; i++) drawn += (reach[i] - reach[i - 1]) * data[i].e;
  const color = data[0].color;

  rule(c, -W / 2 + pad * 0.4, baseY + lineW / 2, W / 2 - pad * 0.4, baseY + lineW / 2);
  // The drawn part of the polyline: whole pieces up to `drawn`, then the piece it ends inside.
  const shown: { x: number; y: number }[] = [poly[0]];
  let run = 0;
  for (let j = 1; j < poly.length && n > 1; j++) {
    const a = poly[j - 1];
    const b = poly[j];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + seg <= drawn) {
      shown.push(b);
      run += seg;
      continue;
    }
    const t = seg > 0 ? clamp01((drawn - run) / seg) : 0;
    if (t > 0) shown.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
    break;
  }
  if (shown.length > 1) {
    const tipX = shown[shown.length - 1].x;
    ctx.globalAlpha = c.base;
    ctx.beginPath();
    ctx.moveTo(shown[0].x, baseY);
    for (const p of shown) ctx.lineTo(p.x, p.y);
    ctx.lineTo(tipX, baseY);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, topY, 0, baseY);
    g.addColorStop(0, rgba(color, 0.3));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    shown.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const pop = easeOf('back-out');
  const popLen = Math.max(1, Math.min(total * 0.06, step * 0.35));
  data.forEach((d, i) => {
    const p = pts[i];
    // A point pops when the line reaches it; the first, which the line starts from, with its own entrance.
    const s = i === 0 || n === 1 ? clamp01(d.e * 3) : clamp01((drawn - reach[i]) / popLen + 1);
    if (s > 0 && d.alpha > 0.002) {
      const r = dotR * Math.max(0, finite(pop(s), s));
      ctx.globalAlpha = c.base * d.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.45, 0, TAU);
      ctx.fillStyle = c.bg;
      ctx.fill();
    }
    if (showValues && s > 0) {
      ctx.textBaseline = 'alphabetic';
      value(c, valueText(c, d.shown * s), valuePx, p.x, p.y - dotR - valuePx * 0.45, 'center', s * d.alpha);
    }
    if (showLabels) {
      ctx.textBaseline = 'middle';
      // Centred under its point, so no wider than twice the way to the nearer edge.
      const room = Math.min(Math.min(step, W) * LABEL_ROOM, 2 * (W / 2 - Math.abs(p.x)));
      label(c, d.label, labelPx, p.x, H / 2 - labelRow / 2 + labelPx * 0.08, 'center', room, d.alpha * 0.78 * smoothstep(0, 0.2, d.e));
    }
  });
}

// ── donut and ring ────────────────────────────────────────────────────────

/**
 * `donut`: segments in proportion to the values, with small gaps, swept in
 * one after another clockwise from the top over a faint track. In the middle,
 * in its own colour, the largest datum's share — or, when the values carry a
 * unit other than a percentage, their total in the first colour. With labels
 * or values, a legend beside the ring when the box is wide and under it when
 * it is not.
 */
function donut(c: Chart): void {
  const { ctx, W, H, k, data } = c;
  const n = data.length;
  const showLabels = c.layer.labels && data.some((d) => d.label);
  const showValues = c.layer.values;
  const legend = showLabels || showValues;
  const side = legend && W >= H * 1.2;
  const cols = !legend || side ? 1 : n > 4 ? 2 : 1;
  const rows = legend ? Math.ceil(n / cols) : 0;

  // The legend's rows: a swatch, the label, the value at the far end.
  let rowPx = c.font;
  if (side) rowPx = Math.min(rowPx, H / Math.max(1, n) / 1.8);
  else if (legend) rowPx = Math.min(rowPx, (H * 0.42) / Math.max(1, rows) / 1.8);
  const rowH = rowPx * 1.8;
  const swatch = rowPx * 0.8;
  const texts = data.map((d) => valueText(c, d.shown));
  let labelW = 0;
  let valueW = 0;
  if (showLabels) {
    for (const d of data) {
      if (!d.label) continue;
      setType(c, rowPx, d.label);
      labelW = Math.max(labelW, widthOf(c, d.label));
    }
  }
  if (showValues) {
    for (const t of texts) {
      setType(c, rowPx, t, true);
      valueW = Math.max(valueW, widthOf(c, t));
    }
  }
  const inner = rowPx * 0.6;
  const colMax = side ? W * 0.5 : W / cols - rowPx;
  const rowW = Math.min(colMax, swatch + inner + labelW + (showLabels && showValues ? rowPx * 1.2 : 0) + valueW);
  const gapLegend = rowPx * 1.6;

  // The ring: what is left, as large as it can be.
  let cx = 0;
  let cy = 0;
  let outer: number;
  if (side) {
    outer = Math.max(k, Math.min(H, W - rowW - gapLegend) / 2);
    const group = outer * 2 + gapLegend + rowW;
    cx = (c.rtl ? 1 : -1) * (group / 2 - outer);
  } else if (legend) {
    const legendH = rows * rowH;
    outer = Math.max(k, Math.min(W, H - legendH - gapLegend) / 2);
    cy = -(legendH + gapLegend) / 2;
  } else {
    outer = Math.min(W, H) / 2;
  }
  const thick = clamp(finite(c.layer.thick, 6) * k, 1, outer * 0.6);
  const mid = outer - thick / 2;

  ctx.globalAlpha = c.base;
  ctx.beginPath();
  ctx.arc(cx, cy, mid, 0, TAU);
  ctx.strokeStyle = rgba(c.ink, 0.08);
  ctx.lineWidth = thick;
  ctx.stroke();

  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total > 0) {
    const live = data.filter((d) => d.value > 0).length;
    const gapA = live > 1 ? Math.min((k * 0.5 + thick * 0.06) / Math.max(1, mid), TAU / live / 4) : 0;
    // One sweep round from the top: it has come as far as the segments' entrances add up to, so the
    // segments fill in order however their entrances overlap, and a long gap is a pause in the sweep.
    const swept = data.reduce((sum, d) => sum + (d.value / total) * TAU * d.e, 0);
    let a0 = -Math.PI / 2;
    ctx.lineCap = 'butt';
    for (const d of data) {
      const sweep = (d.value / total) * TAU;
      const visible = Math.max(sweep * 0.4, sweep - gapA);
      const from = a0 + (sweep - visible) / 2;
      const to = Math.min(from + visible, -Math.PI / 2 + swept);
      if (sweep > 0 && to > from && d.alpha > 0.002) {
        ctx.globalAlpha = c.base * d.alpha;
        ctx.beginPath();
        ctx.arc(cx, cy, mid, from, to);
        ctx.strokeStyle = d.color;
        ctx.lineWidth = thick;
        ctx.stroke();
      }
      a0 += sweep;
    }
  }

  // The middle: the largest datum's share, or the total when the values carry a unit of their own.
  const hole = Math.max(0, mid - thick / 2) * 2;
  if (showValues && hole > k) {
    const unit = typeof c.layer.unit === 'string' ? c.layer.unit.trim() : '';
    const byTotal = unit !== '' && unit !== '%' && unit !== ARABIC_PERCENT;
    let big = data[0];
    for (const d of data) if (d.value > big.value) big = d;
    const pct = (v: number) => formatNumber(v, { decimals: 0, group: true, lang: c.env.doc.lang }) + percentSign(c);
    const whole = total > 0 ? (big.value / total) * 100 : 0;
    const text = byTotal ? valueText(c, data.reduce((sum, d) => sum + d.value * d.e, 0)) : pct(whole * big.e);
    const sub = showLabels && !byTotal ? big.label : '';
    // Sized for the number it counts up to, so it does not grow as it counts.
    // A number in a hole has nowhere else to go: it shrinks as far as it must.
    const px = sizeFor(c, hole * 0.34, [byTotal ? valueText(c, total) : pct(whole)], hole * 0.74, 0.1, true);
    const subPx = Math.min(c.font, px * 0.42);
    ctx.textBaseline = 'middle';
    const y = sub ? cy - subPx * 0.55 : cy;
    value(c, text, px, cx, y, 'center', byTotal ? 1 : big.alpha * smoothstep(0, 0.2, big.e), byTotal ? data[0].color : big.color);
    if (sub) label(c, sub, subPx, cx, y + px * 0.5 + subPx * 0.55, 'center', hole * 0.72, 0.72 * smoothstep(0, 0.2, big.e));
  }

  if (!legend) return;
  // The legend, each row arriving with its segment.
  const dir = c.rtl ? -1 : 1;
  const colW = side ? rowW : W / cols;
  data.forEach((d, i) => {
    const col = side ? 0 : Math.floor(i / rows);
    const row = side ? i : i % rows;
    let x0: number;
    let y: number;
    if (side) {
      x0 = cx + dir * (outer + gapLegend);
      y = cy - (n * rowH) / 2 + (row + 0.5) * rowH;
    } else {
      const blockW = cols * Math.min(colW, rowW + rowPx);
      x0 = dir * (-blockW / 2 + col * Math.min(colW, rowW + rowPx));
      y = cy + outer + gapLegend + (row + 0.5) * rowH;
    }
    const show = d.alpha * smoothstep(0, 0.25, d.e);
    if (show <= 0.002) return;
    const sx = dir > 0 ? x0 : x0 - swatch;
    ctx.globalAlpha = c.base * show;
    rounded(ctx, sx, y - swatch / 2, sx + swatch, y + swatch / 2, swatch * 0.28);
    ctx.fillStyle = d.color;
    ctx.fill();
    ctx.textBaseline = 'middle';
    const textX = x0 + dir * (swatch + inner);
    const end = x0 + dir * rowW;
    if (showValues) value(c, valueText(c, d.shown * d.e), rowPx, end, y, dir > 0 ? 'right' : 'left', show);
    if (showLabels) {
      const room = Math.max(0, rowW - swatch - inner - (showValues ? valueW + rowPx * 0.8 : 0));
      label(c, d.label, rowPx, textX, y, dir > 0 ? 'left' : 'right', room, show * 0.85);
    }
  });
}

/**
 * `ring`: one progress ring — the first datum over the scale, swept clockwise
 * from the top with round ends over a faint track — with the value counting
 * up in the middle and its label under it. With no `max`, a value up to 100
 * is read as a percentage of 100, and a larger one fills the ring.
 */
function ring(c: Chart): void {
  const { ctx, W, H, k, data } = c;
  const d = data[0];
  const max = finite(c.layer.max, 0);
  const top = max > 0 ? max : d.value <= 100 ? 100 : d.value;
  const f = clamp01(d.value / top);
  const outer = Math.min(W, H) / 2;
  const thick = clamp(finite(c.layer.thick, 6) * k, 1, outer * 0.45);
  const mid = outer - thick / 2;

  ctx.globalAlpha = c.base;
  ctx.beginPath();
  ctx.arc(0, 0, mid, 0, TAU);
  ctx.strokeStyle = rgba(d.color, 0.16);
  ctx.lineWidth = thick;
  ctx.stroke();

  const sweep = f * TAU * d.e;
  if (sweep > 1e-4 && d.alpha > 0.002) {
    ctx.globalAlpha = c.base * d.alpha;
    ctx.beginPath();
    ctx.arc(0, 0, mid, -Math.PI / 2, -Math.PI / 2 + sweep);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = thick;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  const hole = Math.max(0, mid - thick / 2) * 2;
  const showLabel = c.layer.labels && d.label !== '';
  const labelPx = showLabel ? Math.min(c.font, hole * 0.16) : 0;
  let y = 0;
  ctx.textBaseline = 'middle';
  if (c.layer.values && hole > k) {
    const px = sizeFor(c, hole * 0.3, [valueText(c, d.shown)], hole * 0.72, 0.1, true);
    y = showLabel ? -labelPx * 0.6 : 0;
    value(c, valueText(c, d.shown * d.e), px, 0, y, 'center', d.alpha * smoothstep(0, 0.1, d.e));
    y += px * 0.5 + labelPx * 0.7;
  }
  if (showLabel) label(c, d.label, labelPx, 0, y, 'center', hole * 0.74, d.alpha * 0.75);
}
