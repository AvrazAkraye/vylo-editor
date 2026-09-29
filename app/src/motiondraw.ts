import type {
  CounterLayer, Ctx, Env, IconLayer, ImageLayer, Layer, Motion, Paint, Pose, Shadow, ShapeLayer, Split, TextLayer,
} from './motiontypes';
import { LIMITS, PINS, SHAPES, SPLITS, isRtlLang, isTone, pinOf, pxPerU } from './motiontypes';
import { countAt, inDone, poseAt } from './motionanim';
import {
  arcPath, arrowPath, blobPath, burstPath, clamp, clamp01, cssOf, ellipsePath, finite, fitPath, parseColor,
  parsePath, pathLength, pathToString, polygonPath, readableOn, rectPath, smoothstep, starPath, transformPath, trimPath, wavePath,
  type Seg,
} from './motionmath';
import { digitsFor, ensureFonts, fontString, formatNumber, scriptOf } from './motionfonts';
import { ICON_PATHS } from './videoicons';
import { drawBackdrop, drawParticles } from './motionbackdrop';
import { drawChart } from './motioncharts';

/**
 * The frame: `paint(ctx, doc, t)` draws a motion graphic at `t` seconds into a
 * canvas. The preview, the gallery's cards, a PNG and every frame of the MP4
 * are this one call, so they are the same picture. Text, shapes, icons,
 * pictures and counters are drawn here; backdrops, particles and charts are
 * placed here and drawn by motionbackdrop.ts and motioncharts.ts.
 *
 * ## Nothing is remembered that could change the picture
 *
 * What a layer looks like at `t` is `poseAt` (motionanim.ts); this file only
 * draws the pose. It keeps caches — laid-out text, measured widths, outlines,
 * decoded pictures — and every one is keyed on everything its result depends
 * on, so a cache can cost memory and never a different frame. Widths change
 * when a face finishes loading, so the text caches are dropped then
 * (`fontsChanged`), rather than keeping a layout measured in the fallback face.
 *
 * ## WebKit
 *
 * The app draws in WKWebView, whose canvas has no `filter` and no
 * `fontKerning` (Chrome has both, which is how the difference hid). Soft focus
 * is therefore made from the one blur every engine has: the shadow. The layer
 * is drawn far outside the frame and its shadow is offset back onto the
 * place it belongs (`soft`), so only the blurred copy is seen, and the sharp
 * layer is faded in over it as the blur resolves. A picture has more than one
 * colour, so its soft copy is a small copy grown back (`softPicture`). Shadows
 * are in canvas pixels whatever the transform, so every blur and offset is
 * scaled here. Tracking is placed letter by letter rather than left to
 * `ctx.letterSpacing`, so it is the same in every engine and in a test.
 * WebKit also draws a shadowed shape at full opacity unless its alpha is set
 * again once the shadow is on, and shadowed text at full opacity whatever is
 * set, so every shadow goes through `shadowOn`; and it fills text with a
 * gradient slowly enough to cost seconds a frame, so a shimmer is one fill per
 * layer (`sheen`).
 *
 * ## Text
 *
 * A text layer is laid out once into atoms — words, or characters when it is
 * typed, split into characters or tracked — each placed by measuring, so
 * nothing depends on how an engine breaks a line. Each is placed where the
 * text up to and including it ends, less its own width: that keeps the
 * font's kerning with what comes before it (the width of the letters before
 * it alone would lose the pair it makes with the last of them, as A does
 * with V), and a line drawn a word at a time lands exactly where the engine
 * would draw it whole. A line's baseline comes from the font's own ascent and
 * descent, not the letters in it, so a title never shifts as its characters
 * change. Words are never cut: a word wider than the wrap width widens the
 * box instead. Arabic script is never cut inside a word either — a letter
 * drawn alone loses the joins that make it the letter it is — so it types,
 * splits and highlights by words, and its words run right to left with the
 * neighbouring Latin words kept in their own order.
 *
 * Text is set at one size whatever the frame is drawn at — the size it has at
 * the 1080 px short side every format has (`LAYOUT_K`) — and drawn through a
 * scaled context. The faces the voices use change their letters' widths with
 * the size they are set at (SF Pro and New York have optical sizes: a word at
 * 12 px is up to a seventh wider, for its size, than at 1000 px), so a text
 * measured at the size it was drawn broke its lines and fitted its title
 * differently in a gallery card, the preview, a 1080p and a 4K export. Set at
 * one size and scaled, its letters keep their proportions at every output
 * size: everything inside a text's box — its metrics, wrap width, tracking,
 * highlight, outline and each piece's movement — is in those layout pixels,
 * and only what a canvas keeps in its own pixels (a shadow's blur and offset)
 * is worked out in the frame's.
 */

const DEG = Math.PI / 180;

/** Seconds a highlight's box or underline takes to draw itself once the words are in. */
const MARK_D = 0.45;

/** Soft focus, in u, at which the blurred copy has wholly replaced the sharp layer. */
const BLUR_FULL = 2.4;

/** A counter's line height, in sizes: it has no `lead` of its own. */
const COUNTER_LEAD = 1.2;

/** The smallest a `fit` title may shrink to, as a fraction of its size. */
const MIN_FIT = 0.3;

/**
 * Pixels per u that text and charts are laid out and drawn at, whatever the
 * size of the frame: 10.8, the 1080 px short side every format has. A text is
 * set at the size it has in its own format at full size, and drawn through a
 * context scaled by `k / 10.8` to the frame actually painted (the header's
 * Text says why), so its line breaks, its `fit`, its box and every word's
 * place are one function of the document — the same in a 320 px gallery
 * card, the preview and a 4K export — and a 1080p export is set at exactly
 * the sizes it was. A chart is laid out the same way (`drawChart`'s `scale`),
 * so its labels are sized and shortened the same at every output size.
 */
const LAYOUT_K = 10.8;

/** How much larger than its layout text or a chart is drawn in `env`'s frame: 1 at full size, 2 in 4K, a sixth in a gallery card. */
function layoutScale(env: Env): number {
  return env.k / LAYOUT_K;
}

/**
 * How much of a `draw` a stroke takes to come up to full strength. A dash with
 * round caps starts as a dot, and a frame of dots reads as noise; fading the
 * first few percent in makes the stroke seem to start from nothing.
 */
const INK_IN = 0.08;

/** Sub-frames of motion blur beyond which more cost time and add nothing a viewer sees. */
const MAX_SAMPLES = 32;

// ── small caches ──────────────────────────────────────────────────────────

/**
 * A map that forgets its least recently used entry past `max`. Every cache
 * here is keyed on everything its value depends on, so forgetting costs only
 * the time to work the value out again.
 */
class Lru<V> {
  private readonly m = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) {
      this.m.delete(k);
      this.m.set(k, v);
    }
    return v;
  }

  set(k: string, v: V): void {
    this.m.delete(k);
    this.m.set(k, v);
    if (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }

  clear(): void {
    this.m.clear();
  }
}

const widths = new Lru<number>(6000);
const metricsCache = new Lru<Metrics>(96);
const blocks = new Lru<Block>(96);
const outlines = new Lru<Seg[] | null>(160);
const path2ds = new Lru<Path2D>(160);

let fontEpoch = 0;
let watching = false;

/** Drop everything measured: a face has arrived, and widths taken in its fallback are wrong now. */
function fontsChanged(): void {
  fontEpoch += 1;
  widths.clear();
  metricsCache.clear();
  blocks.clear();
}

/** Listen once for faces that finish loading after the first frame (the bundled Arabic face, most often). */
function watchFonts(): void {
  if (watching) return;
  watching = true;
  try {
    const set = typeof document === 'undefined' ? undefined : document.fonts;
    if (set && typeof set.addEventListener === 'function') set.addEventListener('loadingdone', fontsChanged);
  } catch {
    /* no font set to watch: nothing will load later */
  }
}

// ── the frame's environment ───────────────────────────────────────────────

/** A colour string as the canvas takes it, or null when it is not one. */
function cssColor(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const c = parseColor(s);
  return c ? cssOf(c) : null;
}

/**
 * The frame's environment for the drawing files: pixels per u, direction, and
 * the two colour lookups. `color` never throws and never returns an empty
 * string — a colour the canvas ignores would leave whatever colour the last
 * layer set, a bug that shows only in some frames — so a word that is not a
 * colour becomes the palette's foreground, and a broken foreground white.
 */
export function makeEnv(ctx: Ctx, doc: Motion, t: number, width: number, height: number): Env {
  const w = finite(width, 0) > 0 ? width : 1;
  const h = finite(height, 0) > 0 ? height : 1;
  const palette: Partial<Record<string, unknown>> = doc && typeof doc.palette === 'object' && doc.palette ? doc.palette : {};
  const ink = cssColor(palette.fg) ?? '#ffffff';
  const known = new Map<string, string>();
  const color = (c: string): string => {
    if (typeof c !== 'string') return ink;
    const hit = known.get(c);
    if (hit !== undefined) return hit;
    const v = (isTone(c) ? cssColor(palette[c]) : cssColor(c)) ?? ink;
    known.set(c, v);
    return v;
  };
  return {
    ctx, doc, t: finite(t, 0), k: pxPerU(w, h), width: w, height: h, rtl: isRtlLang(doc?.lang),
    color,
    paint: (p, pw, ph) => paintOf(ctx, color, ink, p, pw, ph),
  };
}

/**
 * A paint for a box `w` x `h` px centred on the origin. A linear gradient runs
 * across the whole box at its angle, corner to corner as CSS draws one; a
 * radial one reaches the corners; a conic one starts at its angle, and is its
 * first colour where an engine has no conic gradients.
 */
function paintOf(ctx: Ctx, color: (c: string) => string, ink: string, p: Paint, w: number, h: number): string | CanvasGradient {
  if (typeof p === 'string') return color(p);
  if (!p || typeof p !== 'object') return ink;
  const stops = (Array.isArray(p.stops) ? p.stops : [])
    .slice(0, LIMITS.stops * 2)
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({ at: clamp01(finite(s.at, 0)), color: color(s.color) }))
    .sort((a, b) => a.at - b.at);
  if (!stops.length) return ink;
  if (stops.length === 1) return stops[0].color;
  const W = Math.max(1, finite(w, 1));
  const H = Math.max(1, finite(h, 1));
  const a = finite(p.angle, 0) * DEG;
  let g: CanvasGradient;
  if (p.kind === 'radial') {
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(0.5, Math.hypot(W, H) / 2));
  } else if (p.kind === 'conic') {
    if (typeof ctx.createConicGradient !== 'function') return stops[0].color;
    g = ctx.createConicGradient(a, 0, 0);
  } else {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const half = Math.max(0.5, (Math.abs(dx) * W + Math.abs(dy) * H) / 2);
    g = ctx.createLinearGradient(-dx * half, -dy * half, dx * half, dy * half);
  }
  for (const s of stops) g.addColorStop(s.at, s.color);
  return g;
}

/** One colour for a paint: its own, or a gradient's first stop — what a shadow or a soft-focus copy is drawn in. */
function solidOf(env: Env, p: Paint | null | undefined): string {
  if (typeof p === 'string') return env.color(p);
  if (p && typeof p === 'object' && Array.isArray(p.stops) && p.stops.length) {
    const first = p.stops.slice().sort((a, b) => finite(a?.at, 0) - finite(b?.at, 0))[0];
    return env.color(first?.color);
  }
  return env.color('fg');
}

// ── where a layer is ──────────────────────────────────────────────────────

const PIN_SET: ReadonlySet<string> = new Set(PINS);

/**
 * The top-left corner of a layer's `w` x `h` px box before its pose: the
 * pin names a point of the frame and the same point of the box is put there,
 * then moved by `x` toward the end and `y` down (motiontypes.ts, `Pin`).
 */
function placeOf(env: Env, layer: Layer, w: number, h: number): { left: number; top: number } {
  const { row, col } = pinOf(PIN_SET.has(layer.pin) ? layer.pin : 'mc');
  const rtl = env.rtl;
  let px = col === 's' ? (rtl ? env.width : 0) : col === 'c' ? env.width / 2 : rtl ? 0 : env.width;
  let py = row === 't' ? 0 : row === 'm' ? env.height / 2 : env.height;
  px += clamp(finite(layer.x, 0), -LIMITS.reach, LIMITS.reach) * env.k * (rtl ? -1 : 1);
  py += clamp(finite(layer.y, 0), -LIMITS.reach, LIMITS.reach) * env.k;
  const left = col === 's' ? (rtl ? px - w : px) : col === 'c' ? px - w / 2 : rtl ? px : px - w;
  const top = row === 't' ? py : row === 'm' ? py - h / 2 : py - h;
  return { left, top };
}

/** A length in u as pixels, kept finite, not negative, and within the largest a layer may be. */
function lenPx(env: Env, u: unknown, fallback: number): number {
  return clamp(finite(u as number, fallback), 0, LIMITS.size) * env.k;
}

/** The size of a layer's box in pixels, before its pose. */
function boxOf(env: Env, layer: Layer): { w: number; h: number } {
  switch (layer.kind) {
    case 'text': {
      const b = textBlock(env, layer);
      const s = layoutScale(env);
      return { w: b.w * s, h: b.h * s };
    }
    case 'counter': {
      const b = counterBlock(env, layer);
      const s = layoutScale(env);
      return { w: b.w * s, h: b.h * s };
    }
    case 'shape': {
      const w = lenPx(env, layer.w, 10);
      const h = lenPx(env, layer.h, 10);
      if (layer.shape === 'line') return { w, h: Math.max(h, strokeWidthOf(env, layer, true)) };
      return { w, h };
    }
    case 'icon': {
      const s = lenPx(env, layer.size, 8);
      const pad = layer.badge ? lenPx(env, layer.badge.pad, 0) : 0;
      return { w: s + 2 * pad, h: s + 2 * pad };
    }
    case 'image':
    case 'chart':
      return { w: lenPx(env, layer.w, 20), h: lenPx(env, layer.h, 20) };
    case 'backdrop':
      return { w: env.width, h: env.height };
    case 'particles':
      return { w: 0, h: 0 };
  }
  return { w: 0, h: 0 };
}

const BLENDS: Readonly<Record<string, GlobalCompositeOperation>> = {
  normal: 'source-over', screen: 'screen', multiply: 'multiply', overlay: 'overlay', lighter: 'lighter',
};

/** A layer's blend as the canvas names it. An own-property lookup, so a stored word like `constructor` is no blend rather than a function. */
function blendOf(b: unknown): GlobalCompositeOperation {
  return typeof b === 'string' && Object.prototype.hasOwnProperty.call(BLENDS, b) ? BLENDS[b] : 'source-over';
}

/** A layer's box on the canvas, as the stage outlines it: unrotated, with its turn about its centre. */
export interface LayerBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees, clockwise, about (cx, cy). */
  rot: number;
  cx: number;
  cy: number;
}

/**
 * Where a layer is at `env.t`, in canvas pixels: the box as its pose moves,
 * scales and turns it (`rot` about `cx, cy`), for the stage's selection
 * outline and drag handles. Null when nothing of it is on screen — hidden,
 * outside its time, or faded to nothing — so the stage never offers handles
 * for something the person cannot see. A backdrop is the frame; particles are
 * a point, the emitter.
 */
export function layerBox(env: Env, layer: Layer): LayerBox | null {
  if (!layer || layer.hidden) return null;
  const pose = poseAt(layer, env.t, env.rtl);
  if (!pose.on) return null;
  if (layer.kind === 'backdrop') {
    return { x: 0, y: 0, w: env.width, h: env.height, rot: 0, cx: env.width / 2, cy: env.height / 2 };
  }
  const box = boxOf(env, layer);
  const at = placeOf(env, layer, box.w, box.h);
  const cx = at.left + box.w / 2 + pose.dx * env.k;
  const cy = at.top + box.h / 2 + pose.dy * env.k;
  const w = box.w * Math.abs(pose.sx);
  const h = box.h * Math.abs(pose.sy);
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: pose.rot, cx, cy };
}

/**
 * The id of the top-most layer drawn at canvas pixel (`px`, `py`) at `t`: the
 * first, from the front, whose box — turned as it is drawn — holds the point.
 * Backdrops cover the whole frame and are never what a click meant, and a
 * particle emitter has no area, so neither is hit.
 */
export function hitTest(ctx: Ctx, doc: Motion, t: number, px: number, py: number): string | null {
  const width = finite(ctx.canvas?.width, 0);
  const height = finite(ctx.canvas?.height, 0);
  if (!(width > 0 && height > 0) || !doc || !Array.isArray(doc.layers)) return null;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const env = makeEnv(ctx, doc, t, width, height);
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const layer = doc.layers[i];
    if (!layer || layer.kind === 'backdrop') continue;
    let b: LayerBox | null = null;
    try {
      b = layerBox(env, layer);
    } catch {
      b = null;
    }
    if (!b || !(b.w > 0 && b.h > 0)) continue;
    const a = -b.rot * DEG;
    const dx = px - b.cx;
    const dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return layer.id;
  }
  return null;
}

// ── the frame ─────────────────────────────────────────────────────────────

/** How to paint one frame. */
export interface PaintOptions {
  /** The frame's size in pixels; the canvas's own when absent. */
  width?: number;
  height?: number;
  /** false paints over what is there; the frame is cleared first otherwise. */
  clear?: boolean;
  /** Motion blur: `samples` sub-frames spread over `shutter` frames' time. One sample is no blur. */
  blur?: { samples: number; shutter: number };
  /** Throw a layer's error instead of skipping the layer (tests and exports that must not hide a fault). */
  strict?: boolean;
  /** Told which layer was skipped and why, when not `strict`. */
  onError?: (layerId: string, e: unknown) => void;
}

/**
 * Draw `doc` at `t` seconds over the whole canvas (or `o.width` x `o.height`
 * of it): the backdrop paint, then every layer that is not hidden, back to
 * front. Unless `strict`, a layer that throws is skipped and reported, so one
 * bad layer never costs the frame; the context is left balanced either way.
 * `o.blur` averages sub-frames around `t` into motion blur.
 */
export function paint(ctx: Ctx, doc: Motion, t: number, o: PaintOptions = {}): void {
  const width = finite(o.width ?? ctx.canvas?.width, 0);
  const height = finite(o.height ?? ctx.canvas?.height, 0);
  if (!(width > 0 && height > 0) || !doc) return;
  watchFonts();
  const samples = Math.min(MAX_SAMPLES, Math.round(finite(o.blur?.samples, 1)));
  if (samples > 1 && blurred(ctx, doc, t, o, width, height, samples)) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fresh(ctx);
  if (o.clear !== false) ctx.clearRect(0, 0, width, height);
  const env = makeEnv(ctx, doc, t, width, height);
  if (doc.backdrop !== null && doc.backdrop !== undefined) {
    ctx.save();
    try {
      ctx.translate(width / 2, height / 2);
      ctx.fillStyle = env.paint(doc.backdrop, width, height);
      ctx.fillRect(-width / 2, -height / 2, width, height);
    } finally {
      ctx.restore();
    }
  }
  const layers = Array.isArray(doc.layers) ? doc.layers : [];
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || layer.hidden) continue;
    try {
      drawLayer(env, layer);
    } catch (e) {
      if (o.strict) throw e;
      try {
        o.onError?.(String(layer.id), e);
      } catch {
        /* a report that fails must not cost the frame either */
      }
    }
  }
}

/** The state a frame starts from, whatever the canvas was last used for. */
function fresh(ctx: Ctx): void {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
  ctx.imageSmoothingEnabled = true;
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
}

/** One layer, in its own saved state. Text and counters place themselves, since a split title moves in pieces. */
function drawLayer(env: Env, layer: Layer): void {
  const t = env.t;
  if (!(t >= layer.start) || !(t < layer.end)) return;
  const pose = poseAt(layer, t, env.rtl);
  if (layer.kind === 'text' || layer.kind === 'counter') {
    drawTextual(env, layer, pose);
    return;
  }
  if (!pose.on) return;
  const ctx = env.ctx;
  ctx.save();
  try {
    ctx.globalCompositeOperation = blendOf(layer.blend);
    ctx.globalAlpha = pose.opacity;
    if (layer.kind === 'backdrop') {
      if (pose.reveal < 1) clipReveal(ctx, pose.reveal, pose.from, 0, 0, env.width, env.height);
      handOver(env, (e) => drawBackdrop(e, layer, pose));
      return;
    }
    const box = boxOf(env, layer);
    const at = placeOf(env, layer, box.w, box.h);
    ctx.translate(at.left + box.w / 2 + pose.dx * env.k, at.top + box.h / 2 + pose.dy * env.k);
    ctx.rotate(pose.rot * DEG);
    ctx.scale(pose.sx, pose.sy);
    switch (layer.kind) {
      case 'shape':
        drawShape(env, layer, pose, box.w, box.h);
        break;
      case 'icon':
        drawIcon(env, layer, pose, box.w);
        break;
      case 'image':
        drawPicture(env, layer, pose, box.w, box.h);
        break;
      case 'chart':
        if (pose.reveal < 1) clipReveal(ctx, pose.reveal, pose.from, -box.w / 2 - env.k, -box.h / 2 - env.k, box.w / 2 + env.k, box.h / 2 + env.k);
        handOver(env, (e) => drawChart(e, layer, pose, layoutScale(env)));
        break;
      case 'particles':
        handOver(env, (e) => drawParticles(e, layer, pose));
        break;
    }
  } finally {
    ctx.restore();
  }
}

/**
 * Run another module's drawer on a context that counts its saves, and undo any
 * it leaves behind. A clip or a transform left over by a throw half-way
 * through would otherwise apply to every layer after it — and, since the save
 * stack outlives the frame, to every frame after that.
 */
function handOver(env: Env, draw: (env: Env) => void): void {
  const real = env.ctx;
  let depth = 0;
  const bound = new Map<PropertyKey, unknown>();
  const counted = new Proxy(real, {
    get(target, prop) {
      if (prop === 'save') return () => { depth += 1; target.save(); };
      if (prop === 'restore') {
        return () => {
          if (depth > 0) {
            depth -= 1;
            target.restore();
          }
        };
      }
      const v: unknown = Reflect.get(target, prop, target);
      if (typeof v !== 'function') return v;
      let f = bound.get(prop);
      if (!f) {
        f = (v as (...a: unknown[]) => unknown).bind(target);
        bound.set(prop, f);
      }
      return f;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  });
  try {
    draw({ ...env, ctx: counted });
  } finally {
    while (depth > 0) {
      depth -= 1;
      real.restore();
    }
  }
}

// ── motion blur ───────────────────────────────────────────────────────────

const scratches = new Map<string, { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx }>();

/** A canvas to draw sub-frames on, kept by size: making one per frame of an export would churn memory. */
function scratchOf(which: string, w: number, h: number): Ctx | null {
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  const key = `${which}:${W}x${H}`;
  const hit = scratches.get(key);
  if (hit) return hit.ctx;
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(W, H);
  else if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    canvas = c;
  }
  const ctx = canvas ? (canvas.getContext('2d') as Ctx | null) : null;
  if (!canvas || !ctx) return null;
  // Only the sizes in use are kept: the stage's, an export's.
  for (const k of Array.from(scratches.keys())) if (k.startsWith(`${which}:`)) scratches.delete(k);
  scratches.set(key, { canvas, ctx });
  return ctx;
}

/** Whether every pixel of every frame is opaque: the backdrop paint is, and it is drawn first. */
function opaque(env: Env, doc: Motion): boolean {
  const b = doc.backdrop;
  if (b === null || b === undefined) return false;
  const colours = typeof b === 'string' ? [b] : Array.isArray(b.stops) ? b.stops.map((s) => s?.color) : [];
  if (!colours.length) return false;
  return colours.every((c) => {
    const rgba = parseColor(env.color(c as string));
    return !!rgba && rgba.a >= 1;
  });
}

/**
 * Motion blur: `n` sub-frames centred on `t`, at `t + ((s + ½)/n − ½)·shutter/fps`
 * — the middle of each of `n` equal slices of the shutter, so their mean is
 * exactly `t` (`s/n − ½` would put it half a slice early: 1/32 of a frame
 * for eight samples over the usual half-frame shutter) — averaged. An opaque
 * frame is averaged straight onto the target, sub-frame `s` laid over the
 * ones before at alpha `1/(s+1)` — an exact running mean.
 * Over a transparent frame that mean is wrong (a sample over nothing keeps
 * its full alpha, so a moving shape's first position stays solid and its
 * trail fades forwards), so there the sub-frames are summed at `1/n` each on
 * a second scratch, which is exact with alpha, and that is laid on the target.
 * False when there is no canvas to draw sub-frames on; the caller paints once.
 */
function blurred(ctx: Ctx, doc: Motion, t: number, o: PaintOptions, width: number, height: number, n: number): boolean {
  const sub = scratchOf('frame', width, height);
  if (!sub) return false;
  const fps = finite(doc.fps, 30) > 0 ? doc.fps : 30;
  const shutter = clamp(finite(o.blur?.shutter, 0.5), 0, 4);
  const one: PaintOptions = { width, height, strict: o.strict, onError: o.onError };
  const env = makeEnv(ctx, doc, t, width, height);
  const flat = opaque(env, doc);
  const sum = flat ? null : scratchOf('sum', width, height);
  if (!flat && !sum) return false;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  fresh(ctx);
  if (o.clear !== false) ctx.clearRect(0, 0, width, height);
  if (sum) {
    sum.setTransform(1, 0, 0, 1, 0, 0);
    fresh(sum);
    sum.clearRect(0, 0, width, height);
    sum.globalCompositeOperation = 'lighter';
  }
  const target = sum ?? ctx;
  for (let s = 0; s < n; s++) {
    paint(sub, doc, t + ((s + 0.5) / n - 0.5) * shutter / fps, one);
    target.globalAlpha = sum ? 1 / n : 1 / (s + 1);
    target.drawImage(sub.canvas, 0, 0);
  }
  if (sum) {
    sum.globalCompositeOperation = 'source-over';
    sum.globalAlpha = 1;
    ctx.globalAlpha = 1;
    ctx.drawImage(sum.canvas, 0, 0);
  }
  ctx.globalAlpha = 1;
  return true;
}

// ── soft focus, shadows, clips ────────────────────────────────────────────

/** How far outside the frame a soft-focus copy is drawn: past anything a layer can reach, at any export size. */
function offOf(env: Env): number {
  return Math.max(10000, 6 * Math.max(env.width, env.height));
}

/** How much the current layer is scaled, to scale canvas-pixel shadows with it. */
function scaleOf(p: Pose): number {
  return Math.sqrt(Math.abs(p.sx * p.sy)) || 0;
}

/** How much lower an alpha is set to make WebKit take it: far below the 1/255 a pixel can show. */
const ALPHA_NUDGE = 1e-6;

/**
 * Put a shadow on the context — every shadow this file casts is set here —
 * so that WebKit draws it, and what casts it, at the layer's opacity.
 *
 * The app's engine gets that wrong in two ways Chrome does not (measured in a
 * WKWebView on macOS 26, not assumed). A path filled or stroked with a shadow
 * that was set after the latest `save()` is drawn — shape and shadow — at
 * full opacity, unless `globalAlpha` has been given a *different* value since
 * that save: assigning the value it already holds does nothing, setting it to
 * 1 and back does nothing, and a layer at opacity 0 is drawn solid. And text
 * drawn with a shadow ignores `globalAlpha` altogether, save or no save; only
 * the shadow colour's own alpha is honoured. A plate or a title with a shadow
 * therefore did not fade in or out, but appeared and vanished whole.
 *
 * `alone` is a shadow drawn by itself (`soft`: the caster lands far outside
 * the frame). Its opacity is folded into the shadow's colour and the context
 * drawn at 1, which is the same picture in every engine and right for text as
 * well as paths. Otherwise the caster is seen too (`castShadow`: a shape's
 * fill or stroke, an icon, a badge), so the alpha must stay on the context,
 * and it is set again a millionth lower once the shadow is on — a real change,
 * which WebKit then honours, and far too small for a pixel to show. That
 * works for paths only, which is why a title's drop shadow is drawn with
 * `soft` and never with `castShadow`. At 1 nothing needs honouring (WebKit
 * draws at 1), so an opaque layer is left exactly as it was.
 */
function shadowOn(ctx: Ctx, colour: string, blurPx: number, ox: number, oy: number, alone: boolean): void {
  ctx.shadowBlur = Math.max(0, finite(blurPx, 0));
  ctx.shadowOffsetX = finite(ox, 0);
  ctx.shadowOffsetY = finite(oy, 0);
  const a = clamp01(finite(ctx.globalAlpha, 1));
  const c = alone && a < 1 ? parseColor(colour) : null;
  if (c) {
    ctx.shadowColor = `rgba(${c.r}, ${c.g}, ${c.b}, ${+(c.a * a).toFixed(5)})`;
    ctx.globalAlpha = 1;
    return;
  }
  ctx.shadowColor = colour;
  // Zero cannot be nudged lower, and WebKit would draw it solid: the least alpha above it shows nothing either.
  if (a < 1) ctx.globalAlpha = a > 0 ? a * (1 - ALPHA_NUDGE) : ALPHA_NUDGE;
}

/**
 * Draw what `draw` draws as only its shadow: the shapes land `off` pixels
 * outside the frame and the shadow, offset back, is all that is seen. With a
 * blur this is soft focus in an engine with no `ctx.filter`; with an offset it
 * is a drop shadow drawn under a whole title before any of it, so no letter's
 * shadow falls on the letter before it. `draw` must not set a paint: the
 * shapes are filled in opaque black, which makes the shadow exactly `colour`
 * — at the context's opacity, which `shadowOn` moves into the colour.
 */
function soft(env: Env, blurPx: number, colour: string, draw: () => void, ox = 0, oy = 0): void {
  const ctx = env.ctx;
  if (typeof ctx.getTransform !== 'function') return;
  const off = offOf(env);
  ctx.save();
  try {
    const m = ctx.getTransform();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - off, m.f);
    shadowOn(ctx, colour, blurPx, off + finite(ox, 0), finite(oy, 0), true);
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    draw();
  } finally {
    ctx.restore();
  }
}

/** A layer's drop shadow on the context, in canvas pixels for a layer drawn at `scale`, for a caster that is drawn too (never text: see `shadowOn`). */
function castShadow(env: Env, sh: Shadow | undefined, scale: number): void {
  if (!sh || typeof sh !== 'object') return;
  const k = env.k * scale;
  shadowOn(env.ctx, env.color(sh.color), clamp(finite(sh.blur, 0), 0, 50) * k,
    clamp(finite(sh.x, 0), -50, 50) * k, clamp(finite(sh.y, 0), -50, 50) * k, false);
}

function clipRect(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, Math.max(0, w), Math.max(0, h));
  ctx.clip();
}

/** Clip to the part of a box a `wipe` has uncovered, growing from the pose's edge. */
function clipReveal(ctx: Ctx, reveal: number, from: Pose['from'], x0: number, y0: number, x1: number, y1: number): void {
  const r = clamp01(finite(reveal, 1));
  const w = x1 - x0;
  const h = y1 - y0;
  if (from === 'right') clipRect(ctx, x1 - w * r, y0, w * r, h);
  else if (from === 'top') clipRect(ctx, x0, y0, w, h * r);
  else if (from === 'bottom') clipRect(ctx, x0, y1 - h * r, w, h * r);
  else clipRect(ctx, x0, y0, w * r, h);
}

/** A shimmer's band, as a fraction of the box it crosses, and the brightest it gets at `amount` 1. */
const GLINT_BAND = 0.2;
const GLINT_PEAK = 0.55;

/**
 * The length, in u, past which a shape's shimmer band stops growing with the
 * shape. A fifth of a 30u plate is a glint; a fifth of a 120u one is a
 * floodlight sweeping the frame, so a bigger surface keeps the 6u band a
 * 30u one has.
 */
const GLINT_REACH = 30;

/**
 * A `shimmer`'s highlight for a `w` x `h` box centred on the origin: a soft
 * slanted band of light at `glint` (0 to 1) across it, or null when the band
 * is outside the box or there is no light to draw. `amount` is the loop's
 * strength: 1 is the design (white at 55% at the band's heart), less is
 * softer, and more is no brighter — a band past 55% reads as a flash, not a
 * sheen. `k` (pixels per u) caps the band's width on a surface longer than
 * `GLINT_REACH`; without it the band is a fifth of the box whatever its size,
 * which is right for a block of words.
 */
function glintOf(ctx: Ctx, glint: number, w: number, h: number, amount: unknown = 1, k = 0): CanvasGradient | null {
  const g = finite(glint, -1);
  if (g < 0) return null;
  const peak = GLINT_PEAK * clamp01(finite(amount as number, 1));
  if (peak < 0.002) return null;
  const a = 20 * DEG;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = Math.max(0.5, (Math.abs(dx) * w + Math.abs(dy) * h) / 2);
  const band = k > 0 ? Math.min(GLINT_BAND, (GLINT_BAND * GLINT_REACH * k) / (2 * half)) : GLINT_BAND;
  const c = -band + clamp01(g) * (1 + 2 * band);
  const at = (x: number) => peak * Math.max(0, 1 - Math.abs(x - c) / band);
  const xs = [0, c - band, c, c + band, 1].filter((x) => x >= 0 && x <= 1).sort((p, q) => p - q);
  if (!xs.some((x) => at(x) > 0.001)) return null;
  const grad = ctx.createLinearGradient(-dx * half, -dy * half, dx * half, dy * half);
  for (const x of xs) grad.addColorStop(x, `rgba(255, 255, 255, ${at(x).toFixed(4)})`);
  return grad;
}

// ── measuring ─────────────────────────────────────────────────────────────

/** A font's line metrics, in px: the same for every string in it, which is what keeps a baseline still. */
interface Metrics {
  /** The font's ascent and descent. */
  asc: number;
  desc: number;
  /** The height of a capital. */
  cap: number;
}

function setFont(ctx: Ctx, font: string, rtl: boolean): void {
  ctx.font = font;
  ctx.direction = rtl ? 'rtl' : 'ltr';
}

/** The advance of `s` in `font` (set on `ctx` already), cached by font and string. */
function widthOf(ctx: Ctx, font: string, s: string): number {
  if (!s) return 0;
  const key = `${font}\u0001${s}`;
  let w = widths.get(key);
  if (w === undefined) {
    w = Math.max(0, finite(ctx.measureText(s).width, 0));
    widths.set(key, w);
  }
  return w;
}

/**
 * Ascent and descent of the font, from `measureText('Hg')`: the font's box
 * where the engine reports it, the letters' own box where it does not, and
 * 0.8 / 0.2 of the size where neither is known.
 */
function metricsOf(ctx: Ctx, font: string, px: number): Metrics {
  let m = metricsCache.get(font);
  if (m) return m;
  const t = ctx.measureText('Hg');
  const h = ctx.measureText('H');
  const fa = finite(t.fontBoundingBoxAscent, NaN);
  const fd = finite(t.fontBoundingBoxDescent, NaN);
  const aa = finite(t.actualBoundingBoxAscent, NaN);
  const ad = finite(t.actualBoundingBoxDescent, NaN);
  const asc = fa > 0 ? fa : aa > 0 ? aa : 0.8 * px;
  const desc = fd >= 0 && fa > 0 ? fd : ad >= 0 && aa > 0 ? ad : 0.2 * px;
  const capRaw = finite(h.actualBoundingBoxAscent, NaN);
  m = { asc, desc, cap: capRaw > 0 ? capRaw : 0.7 * px };
  metricsCache.set(font, m);
  return m;
}

interface Segmenter { segment(s: string): Iterable<{ segment: string; index: number }> }
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale?: string, o?: { granularity: string }) => Segmenter }).Segmenter;
const graphemer: Segmenter | null = typeof SegmenterCtor === 'function' ? new SegmenterCtor(undefined, { granularity: 'grapheme' }) : null;
const JOINS_BEFORE = /[\p{M}\u200C\u200D\uFE00-\uFE0F]/u;

/** The characters a reader counts, with where each starts: a letter and its accents are one. */
function graphemes(s: string): { g: string; i: number }[] {
  if (graphemer) return Array.from(graphemer.segment(s), (x) => ({ g: x.segment, i: x.index }));
  const out: { g: string; i: number }[] = [];
  let i = 0;
  for (const ch of s) {
    if (out.length && JOINS_BEFORE.test(ch)) out[out.length - 1].g += ch;
    else out.push({ g: ch, i });
    i += ch.length;
  }
  return out;
}

// ── laying out words ──────────────────────────────────────────────────────

/** One word or character, placed. `x` is its left edge in block pixels (the block's top-left is 0, 0). */
interface Atom {
  s: string;
  x: number;
  w: number;
  line: number;
  /** Which word it belongs to, counting in reading order. */
  word: number;
  /** Its first character's place in reading order, spaces not counted: what `type` reveals by. */
  c0: number;
  /** Characters in it. */
  n: number;
  /** Inside the highlighted phrase. */
  hi: boolean;
}

interface Line {
  top: number;
  base: number;
  /** The atoms on it: `atoms[a0]` to `atoms[a1 - 1]`. */
  a0: number;
  a1: number;
}

/** A laid-out text: the layer's box is `w` x `h`. */
interface Block {
  font: string;
  px: number;
  /** Line height, px. */
  lh: number;
  asc: number;
  desc: number;
  cap: number;
  /** How far any letter reaches above and below its baseline: what a clip must leave room for. */
  up: number;
  down: number;
  w: number;
  h: number;
  /** The direction the words run. */
  rtl: boolean;
  atoms: Atom[];
  lines: Line[];
  /** Atoms are characters. */
  chop: boolean;
  /** Arabic script: split, typed and highlighted by whole words only. */
  whole: boolean;
  /** The gap between two words, px: a space and its tracking. */
  space: number;
  /**
   * The highlighted phrase's extent on each line it is on, and how far its
   * own letters reach above and below the baseline there (Arabic script,
   * whose highlight box is centred on its ink; 0 where it is not measured).
   */
  marks: { line: number; x0: number; x1: number; up: number; down: number }[];
}

/** A word before it is placed, in logical order. */
interface Word {
  raw: string;
  s: string;
  /** Where it is in the text: what the highlight is matched by. */
  i0: number;
  i1: number;
  w: number;
  /**
   * Its bidi class for ordering it on a line: left to right, right to left,
   * or neither (digits and marks) until `resolveDirs` settles it. Not `dir`:
   * rtl.test.mjs allows one writer of anything called `.dir` in the app —
   * rtl.ts, which owns the document's direction — and this is a word's, not
   * the page's.
   */
  bidi: 'L' | 'R' | 'N';
  /** Its characters, when the layout places characters: text, start in the text, left edge in the word. */
  chars: { s: string; i0: number; i1: number; x: number; w: number }[];
  x: number;
}

const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]/;
const LETTER = /\p{L}/u;

/** A word's direction for ordering words on a line: right to left, left to right, or neither (digits and marks). */
function dirOfWord(s: string): 'L' | 'R' | 'N' {
  if (RTL_CHAR.test(s)) return 'R';
  if (LETTER.test(s)) return 'L';
  return 'N';
}

/**
 * The direction a text's words run. One script decides it; a text with both
 * runs the document's way, so a Kurdish line that starts with a brand name
 * still reads from the right, as its reader expects.
 */
function textRtl(text: string, docRtl: boolean): boolean {
  const arabic = RTL_CHAR.test(text);
  const latin = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/.test(text);
  if (arabic && !latin) return true;
  if (latin && !arabic) return false;
  return docRtl;
}

/**
 * A word that is neither way takes its neighbours' direction when they
 * agree and the line's otherwise, as the bidi algorithm treats digits and
 * marks between words.
 */
function resolveDirs(words: Word[], rtl: boolean): void {
  const base = rtl ? 'R' : 'L';
  for (let i = 0; i < words.length; i++) {
    if (words[i].bidi !== 'N') continue;
    let before: 'L' | 'R' | 'N' = 'N';
    for (let j = i - 1; j >= 0 && before === 'N'; j--) before = words[j].bidi;
    let after: 'L' | 'R' | 'N' = 'N';
    for (let j = i + 1; j < words.length && after === 'N'; j++) after = words[j].bidi;
    words[i].bidi = before !== 'N' && before === after ? before : base;
  }
}

/**
 * Place a line's words from left to right on the page: runs of one direction
 * keep their words' order inside them, and the runs follow the line's own
 * direction. Inside a run each word stands where the engine sets it in the
 * whole run — at the width of the text before it, spaces and all — so a
 * font's kerning across a space is kept: WebKit applies it ("Tokyo, WAVY"
 * closes up by a twentieth of an em there), and a line drawn word by word
 * then matches the same line drawn whole. `track` is added after every
 * character, spaces included. Returns the line's width.
 */
function placeLine(words: Word[], rtl: boolean, measure: (s: string) => number, track: number): number {
  if (!words.length) return 0;
  const runs: Word[][] = [];
  for (const w of words) {
    const last = runs.length ? runs[runs.length - 1] : null;
    if (last && last[0].bidi === w.bidi) last.push(w);
    else runs.push([w]);
  }
  const tracked = (text: string) => measure(text) + (track ? graphemes(text).length * track : 0);
  const space = tracked(' ');
  const laid = runs.map((r) => {
    const at: number[] = [];
    let before = '';
    for (const w of r) {
      // The run up to and including this word, less the word: its kerning with the space before it counts.
      at.push(before ? tracked(before + w.s) - tracked(w.s) : 0);
      before += `${w.s} `;
    }
    return { at, width: tracked(r.map((w) => w.s).join(' ')) };
  });
  const total = laid.reduce((sum, l) => sum + l.width, 0) + (runs.length - 1) * space;
  let x = rtl ? total : 0;
  runs.forEach((r, n) => {
    const { at, width } = laid[n];
    const left = rtl ? x - width : x;
    r.forEach((w, j) => {
      w.x = r[0].bidi === 'R' ? left + width - at[j] - w.w : left + at[j];
    });
    x = rtl ? left - space : left + width + space;
  });
  return total;
}

/** What a text layer splits into, with Arabic script's rule: never into characters. */
function splitOf(layer: TextLayer, block: Block): Split {
  const by = layer.in?.by ?? layer.out?.by ?? 'all';
  if (!(SPLITS as readonly string[]).includes(by)) return 'all';
  if (by === 'char' && block.whole) return 'word';
  return by;
}

/** Whether a layer types itself in or out, which is drawn character by character. */
function typing(layer: Layer): boolean {
  return layer.in?.fx === 'type' || layer.out?.fx === 'type';
}

/**
 * A text layer laid out: font, lines, and every word or character placed, in
 * layout pixels (`LAYOUT_K` to the u, whatever the frame): the same block for
 * a gallery card, the preview and an export, which draw it scaled. Cached on
 * everything that decides it, including the font generation.
 */
function textBlock(env: Env, layer: TextLayer): Block {
  const ctx = env.ctx;
  const raw = String(typeof layer.text === 'string' ? layer.text : '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').slice(0, LIMITS.text * 2);
  const script = scriptOf(raw);
  const arabic = script === 'arabic';
  const rtl = textRtl(raw, env.rtl);
  const basePx = clamp(finite(layer.size, 8), 0.1, LIMITS.size) * LAYOUT_K;
  const lead = clamp(finite(layer.lead, 1.15), 0.5, 4);
  const maxPx = clamp(finite(layer.max, 0), 0, LIMITS.size) * LAYOUT_K;
  const fit = !!layer.fit && maxPx > 0;
  const trackEm = arabic ? 0 : clamp(finite(layer.track, 0), -0.5, 2);
  const caps = !!layer.caps && !arabic;
  const by = layer.in?.by ?? layer.out?.by ?? 'all';
  const chop = !arabic && (by === 'char' || typing(layer) || trackEm !== 0);
  const weight = finite(layer.weight, 700);
  const align = layer.align === 'center' || layer.align === 'end' ? layer.align : 'start';
  const hi = typeof layer.hi === 'string' ? layer.hi : '';
  const key = [raw, layer.voice, weight, basePx, lead, trackEm, maxPx, fit, caps, align, env.rtl, rtl, chop, hi, fontEpoch].join('\u0001');
  const hit = blocks.get(key);
  if (hit) return hit;

  const paragraphs = raw.split('\n').map((p, n, all) => {
    const offset = all.slice(0, n).reduce((s, q) => s + q.length + 1, 0);
    return Array.from(p.matchAll(/\S+/g), (m) => ({ raw: m[0], i0: offset + (m.index ?? 0) }));
  });
  const display = (s: string) => (caps ? s.toUpperCase() : s);

  /**
   * Words set as one line in `font`: the engine's own measure of the run —
   * kerning across its spaces included, as `placeLine` places it — with the
   * tracking after every character but the last. Wrapping and fitting decide
   * by the same width the line is then drawn at.
   */
  const lineWidth = (font: string, track: number, words: readonly string[]): number => {
    const text = words.join(' ');
    return widthOf(ctx, font, text) + (track && text ? (graphemes(text).length - 1) * track : 0);
  };

  /** Every line's widest at `px`, unwrapped: what `fit` shrinks by. */
  const widest = (px: number): number => {
    const font = fontString(layer.voice, weight, px, script);
    setFont(ctx, font, rtl);
    return Math.max(0, ...paragraphs.map((p) => lineWidth(font, trackEm * px, p.map((word) => display(word.raw)))));
  };

  let px = basePx;
  if (fit) {
    let s = 1;
    let most = widest(px);
    for (let i = 0; i < 6 && most > maxPx * 1.0005 && s > MIN_FIT; i++) {
      s = Math.max(MIN_FIT, s * (maxPx / most) * (i ? 0.998 : 1));
      most = widest(basePx * s);
    }
    px = basePx * s;
  }

  const font = fontString(layer.voice, weight, px, script);
  setFont(ctx, font, rtl);
  const metrics = metricsOf(ctx, font, px);
  const trackPx = trackEm * px;
  const lh = lead * px;
  const hiAt = hi ? raw.indexOf(hi) : -1;
  const h0 = hiAt;
  const h1 = hiAt < 0 ? -1 : hiAt + hi.length;

  const makeWord = (rawWord: string, i0: number): Word => {
    const s = display(rawWord);
    const chars: Word['chars'] = [];
    let w: number;
    if (chop) {
      const gs = graphemes(rawWord);
      let prefix = '';
      gs.forEach((g, j) => {
        const shown = display(g.g);
        // Where the letter stands in the whole word: the word up to and including it, less
        // the letter. The word before it alone would lose the kerning between the two (A and V).
        const upto = prefix + shown;
        const w1 = widthOf(ctx, font, shown);
        const x = (j ? widthOf(ctx, font, upto) - w1 : 0) + j * trackPx;
        chars.push({ s: shown, i0: i0 + g.i, i1: i0 + g.i + g.g.length, x, w: w1 });
        prefix = upto;
      });
      w = widthOf(ctx, font, prefix) + gs.length * trackPx;
    } else {
      w = widthOf(ctx, font, s);
    }
    return { raw: rawWord, s, i0, i1: i0 + rawWord.length, w, bidi: dirOfWord(rawWord), chars, x: 0 };
  };

  // Words in logical order, a paragraph's neutral words resolved against the whole paragraph.
  const lines: Word[][] = [];
  for (const p of paragraphs) {
    // A word is never cut, even when it is wider than the whole line: a whole
    // word reads, half of one does not. The box grows to hold it instead.
    const words = p.map((wd) => makeWord(wd.raw, wd.i0));
    resolveDirs(words, rtl);
    if (!(maxPx > 0) || fit) {
      lines.push(words);
      continue;
    }
    let line: Word[] = [];
    for (const wd of words) {
      if (line.length && lineWidth(font, trackPx, [...line.map((x) => x.s), wd.s]) > maxPx) {
        lines.push(line);
        line = [wd];
      } else {
        line.push(wd);
      }
    }
    lines.push(line);
  }

  const lineWidths = lines.map((l) => placeLine(l, rtl, (text) => widthOf(ctx, font, text), trackPx) - (l.length && trackPx ? trackPx : 0));
  // The box is the wrap width, or the widest line when a word will not fit in
  // it (or a fitted title reached its smallest size): the box is always what
  // is drawn, so its outline holds the words and its pin places all of them.
  const blockW = Math.max(maxPx, 0, ...lineWidths);
  const atoms: Atom[] = [];
  const outLines: Line[] = [];
  const marks: Block['marks'] = [];
  let word = 0;
  let c0 = 0;
  lines.forEach((l, n) => {
    const lw = lineWidths[n];
    const startLeft = !env.rtl;
    const offset = align === 'center' ? (blockW - lw) / 2 : (align === 'start') === startLeft ? 0 : blockW - lw;
    // A line placed right to left starts its words at its own width; a tracked
    // line's last letter carries spacing after it that is not part of the line.
    const shift = offset - (rtl && trackPx ? trackPx : 0);
    const top = n * lh;
    const base = top + (lh - (metrics.asc + metrics.desc)) / 2 + metrics.asc;
    const a0 = atoms.length;
    let m0 = Infinity;
    let m1 = -Infinity;
    const lit: string[] = [];
    for (const wd of l) {
      const pieces = chop && wd.chars.length ? wd.chars : [{ s: wd.s, i0: wd.i0, i1: wd.i1, x: 0, w: wd.w }];
      for (const ch of pieces) {
        const isHi = h0 >= 0 && ch.i0 < h1 && ch.i1 > h0;
        const x = shift + wd.x + ch.x;
        const n1 = chop ? 1 : graphemes(wd.raw).length;
        atoms.push({ s: ch.s, x, w: ch.w, line: n, word, c0, n: n1, hi: isHi });
        c0 += n1;
        if (isHi) {
          m0 = Math.min(m0, x);
          m1 = Math.max(m1, x + ch.w);
          lit.push(ch.s);
        }
      }
      word += 1;
    }
    outLines.push({ top, base, a0, a1: atoms.length });
    if (m1 > m0) {
      // Arabic script has no capitals to centre a highlight on: its own letters, dots and marks decide.
      const ink = arabic ? ctx.measureText(lit.join(' ')) : null;
      marks.push({
        line: n, x0: m0, x1: m1,
        up: Math.max(0, finite(ink?.actualBoundingBoxAscent, 0)), down: Math.max(0, finite(ink?.actualBoundingBoxDescent, 0)),
      });
    }
  });

  let up = metrics.asc;
  let down = metrics.desc;
  for (const l of lines) {
    if (!l.length) continue;
    const m = ctx.measureText(l.map((wd) => wd.s).join(' '));
    up = Math.max(up, finite(m.actualBoundingBoxAscent, 0));
    down = Math.max(down, finite(m.actualBoundingBoxDescent, 0));
  }

  const block: Block = {
    font, px, lh, asc: metrics.asc, desc: metrics.desc, cap: metrics.cap, up, down,
    w: blockW, h: Math.max(1, lines.length) * lh, rtl, atoms, lines: outLines, chop, whole: arabic,
    space: widthOf(ctx, font, ' ') + trackPx, marks,
  };
  blocks.set(key, block);
  return block;
}

/** A prefix or suffix as it is drawn: text, one line, not too long. */
function affix(s: unknown): string {
  return typeof s === 'string' ? Array.from(s.replace(/\s+/g, ' ')).slice(0, LIMITS.suffix).join('') : '';
}

const DIGIT = /\p{Nd}/u;

/**
 * A counter laid out for this frame, in layout pixels as a text is: the
 * number at `t` set with every digit the width of the widest, so the figures
 * that are not changing never move,
 * inside a box as wide as the wider of its first and last values. The prefix
 * leads and the suffix follows in the document's direction; the number's own
 * digits run left to right in every language.
 */
function counterBlock(env: Env, layer: CounterLayer): Block {
  const ctx = env.ctx;
  const lang = env.doc?.lang ?? 'en';
  const decimals = clamp(Math.round(finite(layer.decimals, 0)), 0, 3);
  const group = !!layer.group;
  const fmt = (v: number) => formatNumber(v, { decimals, group, lang });
  const prefix = affix(layer.prefix);
  const suffix = affix(layer.suffix);
  const arab = digitsFor(lang) === 'arab';
  const script = arab ? 'arabic' : scriptOf(prefix + suffix);
  const px = clamp(finite(layer.size, 10), 0.1, LIMITS.size) * LAYOUT_K;
  const font = fontString(layer.voice, finite(layer.weight, 700), px, script);
  const rtl = env.rtl;
  setFont(ctx, font, rtl);
  const metrics = metricsOf(ctx, font, px);
  const trackPx = clamp(finite(layer.track, 0), -0.5, 2) * px;
  const digitW = Math.max(...Array.from(arab ? '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669' : '0123456789', (d) => widthOf(ctx, font, d)));

  /** The pieces of one value, left to right on the page, and the width they take. */
  const lay = (v: number) => {
    const chars = graphemes(fmt(v)).map((g) => g.g);
    // A leading minus reads first, so in a right-to-left line it is drawn on the right, as bidi puts it.
    if (rtl && chars[0] === '-') chars.push(chars.shift() as string);
    const parts: { s: string; w: number; cell: number }[] = [];
    const pre = prefix ? { s: prefix, w: widthOf(ctx, font, prefix), cell: widthOf(ctx, font, prefix) } : null;
    const suf = suffix ? { s: suffix, w: widthOf(ctx, font, suffix), cell: widthOf(ctx, font, suffix) } : null;
    const num = chars.map((c) => {
      const w = widthOf(ctx, font, c);
      return { s: c, w, cell: DIGIT.test(c) ? digitW : w };
    });
    const order = rtl ? [suf, ...num, pre] : [pre, ...num, suf];
    for (const p of order) if (p) parts.push(p);
    const total = parts.reduce((s, p) => s + p.cell, 0) + Math.max(0, parts.length - 1) * trackPx;
    return { parts, total };
  };

  const from = finite(layer.from, 0);
  const to = finite(layer.to, from);
  const boxW = Math.max(lay(from).total, lay(to).total);
  const now = lay(countAt(layer, env.t));
  const lh = COUNTER_LEAD * px;
  const base = (lh - (metrics.asc + metrics.desc)) / 2 + metrics.asc;
  const align = layer.align === 'center' || layer.align === 'end' ? layer.align : 'start';
  const offset = align === 'center' ? (boxW - now.total) / 2 : (align === 'start') !== rtl ? 0 : boxW - now.total;
  const atoms: Atom[] = [];
  let x = offset;
  let c0 = 0;
  now.parts.forEach((p, i) => {
    atoms.push({ s: p.s, x: x + (p.cell - p.w) / 2, w: p.w, line: 0, word: i, c0, n: 1, hi: false });
    c0 += 1;
    x += p.cell + trackPx;
  });
  return {
    font, px, lh, asc: metrics.asc, desc: metrics.desc, cap: metrics.cap, up: Math.max(metrics.asc, 0.8 * px), down: metrics.desc,
    w: boxW, h: lh, rtl, atoms, lines: [{ top: 0, base, a0: 0, a1: atoms.length }], chop: true, whole: false,
    space: widthOf(ctx, font, ' ') + trackPx, marks: [],
  };
}

// ── drawing words ─────────────────────────────────────────────────────────

/** Atoms of one line of a piece. */
interface Row {
  line: number;
  atoms: number[];
}

/** One unit a split text animates: its atoms by line, and its box in block-centred pixels. */
interface Piece {
  rows: Row[];
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cx: number;
  cy: number;
  c0: number;
  chars: number;
}

const piecesCache = new WeakMap<Block, Map<Split, Piece[]>>();

/** The units `split` makes of a block, in reading order. Lines with nothing on them are not units. */
function piecesOf(block: Block, split: Split): Piece[] {
  let byBlock = piecesCache.get(block);
  if (!byBlock) {
    byBlock = new Map();
    piecesCache.set(block, byBlock);
  }
  const hit = byBlock.get(split);
  if (hit) return hit;
  const groups: number[][] = [];
  if (split === 'all') {
    groups.push(block.atoms.map((_, i) => i));
  } else if (split === 'line') {
    for (const l of block.lines) if (l.a1 > l.a0) groups.push(Array.from({ length: l.a1 - l.a0 }, (_, i) => l.a0 + i));
  } else if (split === 'char' && block.chop) {
    block.atoms.forEach((_, i) => groups.push([i]));
  } else {
    let last = -1;
    block.atoms.forEach((a, i) => {
      if (a.word !== last) groups.push([]);
      groups[groups.length - 1].push(i);
      last = a.word;
    });
  }
  const ox = -block.w / 2;
  const oy = -block.h / 2;
  const pieces = groups.map((g): Piece => {
    const rows: Row[] = [];
    for (const i of g) {
      const a = block.atoms[i];
      const last = rows.length ? rows[rows.length - 1] : null;
      if (last && last.line === a.line) last.atoms.push(i);
      else rows.push({ line: a.line, atoms: [i] });
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let chars = 0;
    let c0 = Infinity;
    for (const i of g) {
      const a = block.atoms[i];
      x0 = Math.min(x0, a.x);
      x1 = Math.max(x1, a.x + a.w);
      chars += a.n;
      c0 = Math.min(c0, a.c0);
    }
    if (split === 'all' || !g.length) {
      x0 = 0;
      x1 = block.w;
    }
    const lines = rows.map((r) => block.lines[r.line]);
    const y0 = split === 'all' || !lines.length ? 0 : Math.min(...lines.map((l) => l.top));
    const y1 = split === 'all' || !lines.length ? block.h : Math.max(...lines.map((l) => l.top + block.lh));
    return {
      rows, x0: x0 + ox, x1: x1 + ox, y0: y0 + oy, y1: y1 + oy, cx: (x0 + x1) / 2 + ox, cy: (y0 + y1) / 2 + oy,
      c0: Number.isFinite(c0) ? c0 : 0, chars,
    };
  });
  byBlock.set(split, pieces);
  return pieces;
}

/** How a text or counter is coloured and decorated. */
interface Look {
  color: Paint;
  outline?: { color: Paint; width: number };
  shadow?: Shadow;
  hi?: { style: 'color' | 'box' | 'underline'; color: Paint };
}

type Pass = 'shadow' | 'outline' | 'fill' | 'glint';

/** A text or counter layer: laid out, placed at its pin, and drawn whole or in its pieces. */
function drawTextual(env: Env, layer: TextLayer | CounterLayer, pose: Pose): void {
  if (layer.kind === 'text') {
    const block = textBlock(env, layer);
    if (!block.atoms.length) return;
    const s = layoutScale(env);
    const at = placeOf(env, layer, block.w * s, block.h * s);
    const hiStyle = layer.hiStyle === 'box' || layer.hiStyle === 'underline' ? layer.hiStyle : 'color';
    const look: Look = {
      color: layer.color ?? 'fg',
      outline: layer.outline && finite(layer.outline.width, 0) > 0 ? layer.outline : undefined,
      shadow: layer.shadow,
      hi: block.marks.length ? { style: hiStyle, color: layer.hiColor ?? 'accent' } : undefined,
    };
    drawWords(env, layer, block, look, pose, splitOf(layer, block), at.left + (block.w * s) / 2, at.top + (block.h * s) / 2);
    return;
  }
  if (!pose.on) return;
  const block = counterBlock(env, layer);
  const s = layoutScale(env);
  const at = placeOf(env, layer, block.w * s, block.h * s);
  drawWords(env, layer, block, { color: layer.color ?? 'fg', shadow: layer.shadow }, pose, 'all', at.left + (block.w * s) / 2, at.top + (block.h * s) / 2);
}

/** A 2D transform as the canvas keeps it, `[a, b, c, d, e, f]`: what `getTransform` reads, as plain numbers. */
type Affine = [number, number, number, number, number, number];

function affineOf(ctx: Ctx): Affine | null {
  if (typeof ctx.getTransform !== 'function') return null;
  const m = ctx.getTransform();
  const out: Affine = [m.a, m.b, m.c, m.d, m.e, m.f];
  return out.every(Number.isFinite) ? out : null;
}

/** `m` then `n`, as `ctx.transform(n)` after `m`. */
function affineTimes(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** A box in the space `m` maps from, as the canvas pixels it covers: `[x0, y0, x1, y1]`. */
function deviceBox(m: Affine, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const xa = m[0] * x0;
  const xb = m[0] * x1;
  const ya = m[2] * y0;
  const yb = m[2] * y1;
  const ua = m[1] * x0;
  const ub = m[1] * x1;
  const va = m[3] * y0;
  const vb = m[3] * y1;
  return [
    Math.min(xa, xb) + Math.min(ya, yb) + m[4], Math.min(ua, ub) + Math.min(va, vb) + m[5],
    Math.max(xa, xb) + Math.max(ya, yb) + m[4], Math.max(ua, ub) + Math.max(va, vb) + m[5],
  ];
}

/** Whether canvas pixels `b`, grown by `halo` on every side, reach the `w` x `h` frame. */
function reaches(b: readonly number[], halo: number, w: number, h: number): boolean {
  return b[2] + halo >= 0 && b[0] - halo <= w && b[3] + halo >= 0 && b[1] - halo <= h;
}

/** Where a piece is drawn, for leaving out the letters that land nowhere on the frame: its transform, and how far past its letters it can paint (shadow, soft focus, outline), in canvas pixels. */
interface Cull {
  m: Affine;
  halo: number;
}

/**
 * What an atom can paint, in block-centred pixels before its piece's pose:
 * its advance, and its line from the tallest letter's top to the lowest
 * letter's foot, an em wider all round for overhanging letters and marks.
 * Generous on purpose: it decides only what is left out as off the frame.
 */
function atomReach(block: Block, a: Atom): [number, number, number, number] {
  const ox = -block.w / 2;
  const oy = -block.h / 2;
  const top = block.lines[a.line]?.top ?? 0;
  const em = block.px;
  return [ox + a.x - em, oy + top - block.up - em, ox + a.x + a.w + em, oy + top + block.lh + block.up + block.down + em];
}

/**
 * Draw a laid-out block whose box centre is at (`cx`, `cy`) in the frame.
 * Whole, it moves as one by the layer's pose. Split, the layer stands still at
 * its own turn and scale and each piece moves by its own pose about its own
 * centre — the piece's offset still in the frame's axes, as a whole layer's
 * is. Past the layer's own transform the context is scaled from layout pixels
 * to the frame's (`layoutScale`), so everything drawn after is in the block's
 * layout pixels; a pose moves a piece in u, which is turned into them.
 *
 * Each pass runs over every piece before the next pass starts — shadows, then
 * outlines, then fills — so no letter's outline or shadow is drawn over the
 * letter before it.
 *
 * A piece — and, inside one, a word or letter — that lands wholly off the
 * frame is left out of every pass: a 600u title scaled up eightfold has a few
 * letters on screen and hundreds off it, and an engine rasterises what it is
 * given before it clips.
 *
 * The shimmer is one gradient fill for the whole layer (`sheen`), not one
 * per letter. Filling text with a gradient is where WebKit is slowest — it
 * masks every glyph at its full size, on or off the frame — so a 500-letter
 * shimmering title took almost three seconds a frame there. Instead the
 * letters are set once, in white, on a sheet the size of the frame; the band
 * is laid over them `source-in`, which keeps it only where the letters are;
 * and the sheet is laid on the frame once.
 */
function drawWords(env: Env, layer: TextLayer | CounterLayer, block: Block, look: Look, pose: Pose, split: Split, cx: number, cy: number): void {
  const ctx = env.ctx;
  const k = env.k;
  const whole = split === 'all';
  const pieces = piecesOf(block, split);
  if (!pieces.length) return;
  const r0 = finite(layer.rot, 0);
  const s0 = finite(layer.scale, 1);
  if (whole && !pose.on) return;
  if (!whole && Math.abs(s0) < 1e-4) return;
  const poses = whole ? [pose] : pieces.map((_, i) => poseAt(layer, env.t, env.rtl, { i, n: pieces.length }));
  if (!poses.some((p) => p.on)) return;

  ctx.save();
  try {
    ctx.globalCompositeOperation = blendOf(layer.blend);
    if (whole) {
      ctx.globalAlpha = pose.opacity;
      ctx.translate(cx + pose.dx * k, cy + pose.dy * k);
      ctx.rotate(pose.rot * DEG);
      ctx.scale(pose.sx, pose.sy);
    } else {
      ctx.globalAlpha = 1;
      ctx.translate(cx, cy);
      ctx.rotate(r0 * DEG);
      ctx.scale(s0, s0);
    }
    const S = layoutScale(env);
    if (S !== 1) ctx.scale(S, S);
    const m0 = affineOf(ctx);
    /** A split piece's own place: its pose about its centre, the offset (u, in the frame's axes) turned back into the block's. */
    const stepsOf = (piece: Piece, p: Pose) => {
      const a = -r0 * DEG;
      const dx = p.dx * k;
      const dy = p.dy * k;
      const s1 = s0 * S;
      return {
        tx: (dx * Math.cos(a) - dy * Math.sin(a)) / s1 + piece.cx, ty: (dx * Math.sin(a) + dy * Math.cos(a)) / s1 + piece.cy,
        rot: (p.rot - r0) * DEG, sx: p.sx / s0, sy: p.sy / s0,
      };
    };
    const place = (g: Ctx, piece: Piece, p: Pose) => {
      if (whole) return;
      const s = stepsOf(piece, p);
      g.globalAlpha = p.opacity;
      g.translate(s.tx, s.ty);
      g.rotate(s.rot);
      g.scale(s.sx, s.sy);
      g.translate(-piece.cx, -piece.cy);
    };
    // Each piece's transform and reach, and whether it lands on the frame at all.
    const culls = pieces.map((piece, i): Cull | null => {
      const p = poses[i];
      if (!m0 || !p.on) return null;
      let m = m0;
      if (!whole) {
        const s = stepsOf(piece, p);
        const cos = Math.cos(s.rot);
        const sin = Math.sin(s.rot);
        m = affineTimes(affineTimes(affineTimes(affineTimes(m, [1, 0, 0, 1, s.tx, s.ty]), [cos, sin, -sin, cos, 0, 0]), [s.sx, 0, 0, s.sy, 0, 0]), [1, 0, 0, 1, -piece.cx, -piece.cy]);
      }
      const sh = look.shadow;
      const drop = sh ? Math.abs(clamp(finite(sh.x, 0), -50, 50)) + Math.abs(clamp(finite(sh.y, 0), -50, 50)) + 2 * clamp(finite(sh.blur, 0), 0, 50) : 0;
      const line = look.outline ? 2 * clamp(finite(look.outline.width, 0), 0, 10) : 0;
      const grow = Math.max(Math.abs(p.sx), Math.abs(p.sy), scaleOf(p));
      return { m, halo: (drop + line + 2 * Math.max(0, finite(p.blur, 0))) * k * grow + 2 };
    });
    const em = block.px;
    const pieceBox = (piece: Piece, c: Cull) =>
      deviceBox(c.m, piece.x0 - em, piece.y0 - block.up - em, piece.x1 + em, piece.y1 + block.up + block.down + em);
    const seen = pieces.map((piece, i) => {
      const c = culls[i];
      return poses[i].on && (!c || reaches(pieceBox(piece, c), c.halo, env.width, env.height));
    });
    ctx.font = block.font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.direction = block.rtl ? 'rtl' : 'ltr';
    const fill = env.paint(look.color, block.w, block.h);
    const hi = look.hi;
    let marks: Mark[] = [];
    if (hi && hi.style !== 'color') {
      const presence = Math.min(...poses.map((p) => p.presence));
      const alpha = whole ? pose.opacity : Math.max(...poses.map((p) => p.opacity));
      marks = marksOf(block, hi.style, markProgress(layer, env.t, pieces.length, presence), S);
      if (marks.length && alpha > 0.001) {
        ctx.save();
        try {
          ctx.globalAlpha = clamp01(alpha);
          ctx.fillStyle = env.paint(hi.color, block.w, block.h);
          ctx.beginPath();
          traceMarks(ctx, marks);
          ctx.fill();
        } finally {
          ctx.restore();
        }
      }
    }
    const hiFill = hi && hi.style === 'color' ? env.paint(hi.color, block.w, block.h) : fill;
    // On the box the phrase takes whichever of the palette's ink and ground reads
    // better on it — but only where the box already is, so as the box grows the
    // words change colour at its edge instead of vanishing ahead of it.
    const onBox = hi && hi.style === 'box' && marks.length ? readableOn(solidOf(env, hi.color), env.color('fg'), env.color('bg')) : null;
    const amount = layer.loop?.amount;
    const glint = glintOf(ctx, pose.glint, block.w, block.h, amount);
    const inks: Ink = (a) => (a.hi ? hiFill : fill);
    /** One pass over the pieces that reach the frame, on `g` (the frame, or the shimmer's sheet); `lit` is what the glint pass fills letters with. */
    const run = (g: Ctx, pass: Pass, ink: Ink, region?: 'inside' | 'outside', lit: string | CanvasGradient | null = null) => {
      const on = g === ctx ? env : { ...env, ctx: g };
      pieces.forEach((piece, i) => {
        if (!seen[i]) return;
        g.save();
        try {
          if (region) clipMarks(g, marks, region);
          place(g, piece, poses[i]);
          drawPiece(on, block, look, piece, poses[i], pass, ink, lit, culls[i]);
        } finally {
          g.restore();
        }
      });
    };
    if (look.shadow) run(ctx, 'shadow', inks);
    if (look.outline) run(ctx, 'outline', inks);
    run(ctx, 'fill', inks, onBox ? 'outside' : undefined);
    if (onBox) run(ctx, 'fill', (a) => (a.hi ? onBox : null), 'inside');
    if (glint) {
      // The frame's pixels the lit pieces can reach: all the sheet is cleared, filled and laid down over.
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      pieces.forEach((piece, i) => {
        const c = culls[i];
        if (!seen[i] || !c) return;
        const b = pieceBox(piece, c);
        x0 = Math.min(x0, b[0]);
        y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[2]);
        y1 = Math.max(y1, b[3]);
      });
      const bx = Math.max(0, Math.floor(x0) - 2);
      const by = Math.max(0, Math.floor(y0) - 2);
      const bw = Math.min(env.width, Math.ceil(x1) + 2) - bx;
      const bh = Math.min(env.height, Math.ceil(y1) + 2) - by;
      const sheet = m0 ? sheetOf(env.width, env.height) : null;
      if (!sheet || !m0) run(ctx, 'glint', inks, undefined, glint);
      else if (bw >= 1 && bh >= 1) sheen(ctx, sheet, m0, [bx, by, bw, bh], block, (g) => {
        g.globalAlpha = whole ? pose.opacity : 1;
        run(g, 'glint', inks, undefined, '#ffffff');
      }, (g) => glintOf(g, pose.glint, block.w, block.h, amount));
    }
  } finally {
    ctx.restore();
  }
}

let sheetW = 0;
let sheetH = 0;

/**
 * The canvas a shimmer is composed on: at least the frame's size, and kept at
 * the largest asked for, so a gallery's small cards and the stage's frame
 * share one rather than making a new one each time they take turns.
 */
function sheetOf(w: number, h: number): Ctx | null {
  const W = Math.max(1, Math.ceil(w), sheetW);
  const H = Math.max(1, Math.ceil(h), sheetH);
  const g = scratchOf('glint', W, H);
  if (g) {
    sheetW = W;
    sheetH = H;
  }
  return g;
}

/**
 * A block's shimmer, composed on `sheet` and laid on `ctx` once: inside the
 * canvas-pixel box `[x, y, w, h]` (the only part of the sheet this touches, so
 * nothing another layer left there can show), `mask` sets the letters in
 * white at their pieces' opacity under the block's transform `m`, the band
 * `band` makes is filled over them `source-in` — the band where the letters
 * are, as strong as they are — and the box is drawn onto the frame in the
 * layer's blend.
 */
function sheen(ctx: Ctx, sheet: Ctx, m: Affine, box: [number, number, number, number], block: Block,
  mask: (g: Ctx) => void, band: (g: Ctx) => CanvasGradient | null): void {
  const [x, y, w, h] = box;
  fresh(sheet);
  sheet.setTransform(1, 0, 0, 1, 0, 0);
  // Made first: without a band there must be no white letters on the sheet to lay down.
  const light = band(sheet);
  if (!light) return;
  sheet.clearRect(x, y, w, h);
  sheet.save();
  try {
    sheet.beginPath();
    sheet.rect(x, y, w, h);
    sheet.clip();
    sheet.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    sheet.font = block.font;
    sheet.textAlign = 'left';
    sheet.textBaseline = 'alphabetic';
    sheet.direction = block.rtl ? 'rtl' : 'ltr';
    mask(sheet);
    // The box, in canvas pixels, filled with the band in the block's own space: a
    // path takes the transform it is traced in, a fill's gradient the one it is filled in.
    sheet.save();
    sheet.setTransform(1, 0, 0, 1, 0, 0);
    sheet.beginPath();
    sheet.rect(x, y, w, h);
    sheet.restore();
    sheet.globalAlpha = 1;
    sheet.globalCompositeOperation = 'source-in';
    sheet.fillStyle = light;
    sheet.fill();
  } finally {
    sheet.restore();
  }
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(sheet.canvas, x, y, w, h, x, y, w, h);
  } finally {
    ctx.restore();
  }
}

/** What an atom is filled with in a pass, or null to leave it out of the pass. */
type Ink = (a: Atom) => string | CanvasGradient | null;

/** A highlight's box, or its underline, on one line: block-centred pixels. */
interface Mark {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/** How far a highlight's box or underline has drawn itself: it starts when the last word lands and leaves with the first to go. */
function markProgress(layer: Layer, t: number, units: number, presence: number): number {
  const a = layer.in;
  const exit = clamp01(finite(presence, 1));
  if (!a || a.fx === 'none') return exit;
  const p = clamp01((t - inDone(layer, units)) / MARK_D);
  return Math.min(1 - (1 - p) ** 3, exit);
}

/** A highlight box's room beside the phrase, in ems — and never more than half the gap to the next word. */
const HI_PAD_X = 0.12;

/**
 * A highlight box's room above and below, in ems: above a Latin phrase's
 * capitals and below its baseline alike — enough below for a descender (a
 * fifth to a quarter of an em in the faces the voices use) and above for a
 * ring or an accent on a capital; and around an Arabic phrase's own ink,
 * which already holds its dots and marks.
 */
const HI_PAD_Y = 0.28;
const HI_PAD_INK = 0.14;

/**
 * The highlighter's box behind the phrase, or the line under it, on each line
 * the phrase is on, grown from where the words start reading by `progress`.
 *
 * The box is centred on where the phrase looks to be: a Latin one on its
 * capitals' middle, with as much room above the capitals as below the
 * baseline, so a capital never sits high in it; an Arabic one, which has no
 * capitals, on the middle of its own ink, dots and marks included. Beside
 * the phrase it leaves 0.12 em, but never more than half a word space: a
 * condensed face's space is narrow (Impact's is 0.18 em), and a box wider
 * than half of it would touch the next word. Everything is in the block's
 * layout pixels; `scale` is how large they are drawn, for the one length that
 * is the frame's — the underline's least thickness.
 */
function marksOf(block: Block, style: 'box' | 'underline', progress: number, scale = 1): Mark[] {
  const out: Mark[] = [];
  const f = clamp01(progress);
  if (f <= 0.001) return out;
  const ox = -block.w / 2;
  const oy = -block.h / 2;
  const px = block.px;
  for (const m of block.marks) {
    const base = oy + block.lines[m.line].base;
    let x0: number;
    let x1: number;
    let y0: number;
    let y1: number;
    let r: number;
    if (style === 'box') {
      const padX = Math.max(0, Math.min(HI_PAD_X * px, finite(block.space, px) / 2));
      x0 = ox + m.x0 - padX;
      x1 = ox + m.x1 + padX;
      let mid: number;
      let half: number;
      if (block.whole) {
        // An engine that measures no ink: the tall letters and a descent, as the font has them.
        const up = m.up > 0 ? m.up : Math.max(block.cap, 0.62 * block.up);
        const down = m.up > 0 ? m.down : Math.min(block.down, 0.42 * px);
        mid = base - (up - down) / 2;
        half = (up + down) / 2 + HI_PAD_INK * px;
      } else {
        mid = base - block.cap / 2;
        half = block.cap / 2 + HI_PAD_Y * px;
      }
      y0 = mid - half;
      y1 = mid + half;
      r = 0.16 * px;
    } else {
      // Never thinner than a pixelful and a half of the frame, however small the words are drawn.
      const th = Math.max(0.065 * px, 1.5 / Math.max(1e-6, scale));
      const y = base + Math.max(0.1 * px, Math.min(block.desc, 0.3 * px) * 0.55);
      x0 = ox + m.x0;
      x1 = ox + m.x1;
      y0 = y - th / 2;
      y1 = y + th / 2;
      r = th / 2;
    }
    const w = (x1 - x0) * f;
    if (w <= 0.5) continue;
    out.push({ x: block.rtl ? x1 - w : x0, y: y0, w, h: y1 - y0, r: Math.min(r, w / 2, (y1 - y0) / 2) });
  }
  return out;
}

function traceMarks(ctx: Ctx, marks: Mark[]): void {
  for (const m of marks) {
    if (typeof ctx.roundRect === 'function') ctx.roundRect(m.x, m.y, m.w, m.h, m.r);
    else ctx.rect(m.x, m.y, m.w, m.h);
  }
}

/** Clip to the highlight's boxes, or to everywhere but them. */
function clipMarks(ctx: Ctx, marks: Mark[], region: 'inside' | 'outside'): void {
  ctx.beginPath();
  if (region === 'outside') ctx.rect(-1e6, -1e6, 2e6, 2e6);
  traceMarks(ctx, marks);
  ctx.clip(region === 'outside' ? 'evenodd' : 'nonzero');
}

/**
 * One pass of one piece: its visible atoms, under the piece's wipe and each
 * line's mask, less the atoms `cull` finds wholly off the frame. The glint
 * pass fills its letters with `lit`: white, for the sheet a shimmer is
 * composed on, or the band itself where there is no sheet.
 */
function drawPiece(env: Env, block: Block, look: Look, piece: Piece, p: Pose, pass: Pass, ink: Ink, lit: string | CanvasGradient | null, cull: Cull | null): void {
  const ctx = env.ctx;
  const type = clamp01(finite(p.type, 1));
  const shown = type >= 1 ? Infinity : Math.ceil(type * piece.chars - 1e-9);
  if (shown <= 0) return;
  const reveal = clamp01(finite(p.reveal, 1));
  if (reveal <= 0) return;
  const mask = clamp01(finite(p.mask, 1));
  if (mask <= 0) return;
  const ox = -block.w / 2;
  const oy = -block.h / 2;
  const px = block.px;
  if (reveal < 1) {
    const padX = 0.3 * px;
    const padY = 0.4 * px;
    clipReveal(ctx, reveal, p.from, piece.x0 - padX, piece.y0 - padY, piece.x1 + padX, piece.y1 + padY);
  }
  const scale = scaleOf(p);
  const k = env.k;
  const blurU = Math.max(0, finite(p.blur, 0));
  const fog = pass === 'fill' && blurU > 0.01 ? clamp01(blurU / BLUR_FULL) : 0;

  const onFrame = (i: number) => !cull || reaches(deviceBox(cull.m, ...atomReach(block, block.atoms[i])), cull.halo, env.width, env.height);

  for (const row of piece.rows) {
    const line = block.lines[row.line];
    const atoms = row.atoms.filter((i) => block.atoms[i].c0 - piece.c0 < shown && ink(block.atoms[i]) !== null && onFrame(i));
    if (!atoms.length) continue;
    const base = oy + line.base;
    ctx.save();
    try {
      if (mask < 1) {
        const bottom = oy + Math.max(line.top + block.lh, line.base + block.down);
        const reach = bottom - (base - block.up);
        clipRect(ctx, piece.x0 - px, oy + line.top - 3 * px, piece.x1 - piece.x0 + 2 * px, bottom - (oy + line.top - 3 * px));
        ctx.translate(0, (1 - mask) * Math.max(1.05 * block.lh, reach));
      }
      const text = (i: number, how: 'fill' | 'stroke') => {
        const a = block.atoms[i];
        if (how === 'fill') ctx.fillText(a.s, ox + a.x, base);
        else ctx.strokeText(a.s, ox + a.x, base);
      };
      if (pass === 'shadow' && look.shadow) {
        const sh = look.shadow;
        const s = k * scale;
        soft(env, (clamp(finite(sh.blur, 0), 0, 50) + blurU) * s, env.color(sh.color), () => {
          for (const i of atoms) text(i, 'fill');
        }, clamp(finite(sh.x, 0), -50, 50) * s, clamp(finite(sh.y, 0), -50, 50) * s);
      } else if (pass === 'outline' && look.outline) {
        ctx.globalAlpha *= 1 - clamp01(blurU / BLUR_FULL);
        ctx.strokeStyle = env.paint(look.outline.color, block.w, block.h);
        // In layout pixels, as the letters are: at least half a pixel of the frame.
        ctx.lineWidth = Math.max(0.5 / Math.max(1e-6, layoutScale(env)), clamp(finite(look.outline.width, 0), 0, 10) * LAYOUT_K * 2);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const i of atoms) text(i, 'stroke');
      } else if (pass === 'fill') {
        if (fog > 0) {
          const base0 = ctx.globalAlpha;
          ctx.globalAlpha = base0 * Math.min(1, fog * 1.6);
          // One soft copy per colour: a shadow has one colour.
          const byColour = new Map<string, number[]>();
          for (const i of atoms) {
            const want = ink(block.atoms[i]);
            const c = typeof want === 'string' ? want : solidOf(env, look.color);
            const list = byColour.get(c);
            if (list) list.push(i);
            else byColour.set(c, [i]);
          }
          byColour.forEach((g, c) => {
            soft(env, blurU * k * scale, c, () => {
              for (const i of g) text(i, 'fill');
            });
          });
          ctx.globalAlpha = base0 * (1 - fog);
        }
        if (fog < 1) {
          let current: string | CanvasGradient | null = null;
          for (const i of atoms) {
            const want = ink(block.atoms[i]);
            if (!want) continue;
            if (want !== current) {
              ctx.fillStyle = want;
              current = want;
            }
            text(i, 'fill');
          }
        }
      } else if (pass === 'glint' && lit) {
        ctx.fillStyle = lit;
        for (const i of atoms) text(i, 'fill');
      }
    } finally {
      ctx.restore();
    }
  }
}

// ── shapes ────────────────────────────────────────────────────────────────

const SHAPE_SET: ReadonlySet<string> = new Set(SHAPES);

/** A shape's line: its stroke's width, or for the shapes that are only a line (`line`, `arc`, `wave`) 0.6u when it names none. */
function strokeWidthOf(env: Env, layer: ShapeLayer, open: boolean): number {
  const st = layer.stroke && typeof layer.stroke === 'object' ? layer.stroke : undefined;
  const w = st ? clamp(finite(st.width, 0), 0, 50) * env.k : 0;
  return open && !(w > 0) ? 0.6 * env.k : w;
}

/** Split an outline at each move, so each part can draw itself on at its own length. */
function subpaths(segs: Seg[]): Seg[][] {
  const out: Seg[][] = [];
  for (const s of segs) {
    if (s.t === 'M' || !out.length) out.push([]);
    out[out.length - 1].push(s);
  }
  return out;
}

/** The first `f` of each part of an outline: all of them draw on together and finish together. */
function trimmed(segs: Seg[], f: number): Seg[] {
  if (f >= 1) return segs;
  const out: Seg[] = [];
  for (const sub of subpaths(segs)) {
    const part = trimPath(sub, 0, f);
    for (const s of part) out.push(s);
  }
  return out;
}

/** Put an outline on the context as its current path. */
function trace(ctx: Ctx, segs: Seg[]): void {
  ctx.beginPath();
  for (const s of segs) {
    const p = s.p;
    if (s.t === 'M') ctx.moveTo(p[0], p[1]);
    else if (s.t === 'L') ctx.lineTo(p[0], p[1]);
    else if (s.t === 'C') ctx.bezierCurveTo(p[0], p[1], p[2], p[3], p[4], p[5]);
    else ctx.closePath();
  }
}

/** A Path2D for an outline that does not change from frame to frame, kept by `key`. */
function pathFor(key: string, segs: Seg[]): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  let p = path2ds.get(key);
  if (!p) {
    p = new Path2D(pathToString(segs));
    path2ds.set(key, p);
  }
  return p;
}

/** Fill or stroke an outline: from its cached Path2D when it has one. */
function paintPath(ctx: Ctx, segs: Seg[], how: 'fill' | 'stroke' | 'clip', key?: string): void {
  const p = key ? pathFor(key, segs) : null;
  if (p) {
    if (how === 'fill') ctx.fill(p);
    else if (how === 'stroke') ctx.stroke(p);
    else ctx.clip(p);
    return;
  }
  trace(ctx, segs);
  if (how === 'fill') ctx.fill();
  else if (how === 'stroke') ctx.stroke();
  else ctx.clip();
}

/**
 * A shape's resting outline in pixels, centred on the origin: the motionmath
 * generator for its kind at `W` x `H`, or null when there is nothing to draw
 * (a path that does not parse, a size that is not one). Cached by every
 * number that shapes it.
 */
function outlineOf(env: Env, layer: ShapeLayer, W: number, H: number, lineW: number): { segs: Seg[] | null; key: string } {
  const shape = SHAPE_SET.has(layer.shape) ? layer.shape : 'rect';
  const k = env.k;
  const radius = clamp(finite(layer.radius, 0), 0, LIMITS.size) * k;
  const sides = clamp(Math.round(finite(layer.sides, 5)), shape === 'wave' ? 1 : 3, 64);
  const inner = clamp(finite(layer.inner, 0.45), 0.05, 0.98);
  const from = finite(layer.from, 0);
  const sweep = clamp(finite(layer.sweep, 270), -360, 360);
  const seed = finite(layer.seed, 1);
  const cap = layer.stroke?.cap ?? 'round';
  const d = shape === 'path' && typeof layer.d === 'string' ? layer.d.slice(0, LIMITS.path) : '';
  const key = [shape, W, H, radius, sides, inner, from, sweep, seed, lineW, cap, env.rtl, d].join('|');
  let segs = outlines.get(key);
  if (segs === undefined) {
    segs = buildOutline(shape, W, H, radius, sides, inner, from, sweep, seed, lineW, cap, env.rtl, d);
    outlines.set(key, segs);
  }
  return { segs, key };
}

function buildOutline(
  shape: string, W: number, H: number, radius: number, sides: number, inner: number, from: number, sweep: number,
  seed: number, lineW: number, cap: string, rtl: boolean, d: string,
): Seg[] | null {
  if (!(W > 0) || !(H > 0) && shape !== 'line') return null;
  const S = Math.min(W, H);
  switch (shape) {
    case 'rect':
      return rectPath(W, H, Math.min(radius, S / 2));
    case 'ellipse':
      return ellipsePath(W, H);
    case 'arc': {
      // The ring's stroke stays inside the box, as a progress ring should.
      const r = Math.max(1, S - lineW);
      return arcPath(r, r, from, sweep);
    }
    case 'polygon':
      return polygonPath(sides, S, S);
    case 'star':
      return starPath(sides, W, H, inner);
    case 'line': {
      const inset = cap === 'butt' ? 0 : lineW / 2;
      const half = Math.max(0.005, W / 2 - inset);
      return [{ t: 'M', p: [-half, 0] }, { t: 'L', p: [half, 0] }];
    }
    case 'arrow': {
      const a = arrowPath(W, H);
      return rtl ? transformPath(a, -1, 0, 0, 1, 0, 0) : a;
    }
    case 'burst':
      return burstPath(sides, W, H, inner);
    case 'wave':
      // Phase is in periods; seeds are usually whole numbers, so they are spread by the golden ratio.
      return wavePath(Math.max(1, W - lineW), Math.max(1, H - lineW), sides, seed * 0.6180339887);
    case 'blob':
      return blobPath(W, H, seed);
    case 'path': {
      const p = d ? parsePath(d, LIMITS.path) : null;
      return p && p.length ? fitPath(p, W, H) : null;
    }
  }
  return null;
}

/**
 * The axis a `grow` extends along and the edge it grows from: the start edge
 * for a wide shape (a bar, a rule), the bottom for a tall one, unless the
 * animation names a direction — `up` from the bottom, `down` from the top,
 * `start` and `end` from those edges.
 */
function growFrom(layer: Layer, W: number, H: number, rtl: boolean): { axis: 'x' | 'y'; side: -1 | 1 } {
  const a = layer.in?.fx === 'grow' ? layer.in : layer.out?.fx === 'grow' ? layer.out : undefined;
  const startSide: -1 | 1 = rtl ? 1 : -1;
  switch (a?.dir) {
    case 'up': return { axis: 'y', side: 1 };
    case 'down': return { axis: 'y', side: -1 };
    case 'start': return { axis: 'x', side: startSide };
    case 'end': return { axis: 'x', side: startSide === -1 ? 1 : -1 };
  }
  return W >= H ? { axis: 'x', side: startSide } : { axis: 'y', side: 1 };
}

/** A shape grown to `g` of its extent from its base edge. A rectangle keeps its corners round rather than squashing them. */
function grownOutline(layer: ShapeLayer, segs: Seg[], W: number, H: number, g: number, radius: number, rtl: boolean): Seg[] {
  const { axis, side } = growFrom(layer, W, H, rtl);
  if (layer.shape === 'rect') {
    const w = axis === 'x' ? W * g : W;
    const h = axis === 'y' ? H * g : H;
    const r = rectPath(Math.max(0.01, w), Math.max(0.01, h), Math.min(radius, Math.min(w, h) / 2));
    const dx = axis === 'x' ? (side * (W - w)) / 2 : 0;
    const dy = axis === 'y' ? (side * (H - h)) / 2 : 0;
    return transformPath(r, 1, 0, 0, 1, dx, dy);
  }
  const ax = axis === 'x' ? (side * W) / 2 : 0;
  const ay = axis === 'y' ? (side * H) / 2 : 0;
  const sx = axis === 'x' ? g : 1;
  const sy = axis === 'y' ? g : 1;
  return transformPath(segs, sx, 0, 0, sy, ax * (1 - sx), ay * (1 - sy));
}

/**
 * A shape layer, centred on the origin. Fill, then stroke; `draw` strokes the
 * outline on and fades the fill in as it closes (a filled shape with no
 * stroke draws its outline on in its own colour), `grow` extends it from its
 * base, and soft focus and the shimmer are drawn over the same outline.
 */
function drawShape(env: Env, layer: ShapeLayer, pose: Pose, W: number, H: number): void {
  const ctx = env.ctx;
  const k = env.k;
  const shape = SHAPE_SET.has(layer.shape) ? layer.shape : 'rect';
  const open = shape === 'line' || shape === 'arc' || shape === 'wave';
  const st = layer.stroke && typeof layer.stroke === 'object' ? layer.stroke : undefined;
  const lineW = strokeWidthOf(env, layer, open);
  const cap: CanvasLineCap = st?.cap === 'butt' || st?.cap === 'square' ? st.cap : 'round';
  const strokePaint: Paint | null = open ? st?.color ?? layer.fill ?? 'accent' : lineW > 0 && st ? st.color : null;
  const fillPaint: Paint | null = open ? null : layer.fill ?? null;
  if (!fillPaint && !strokePaint) return;
  const draw = clamp01(finite(pose.draw, 1));
  const grow = clamp(finite(pose.grow, 1), 0, 1.25);
  const reveal = clamp01(finite(pose.reveal, 1));
  if (draw <= 0 || grow <= 0.001 || reveal <= 0) return;

  const { segs: rest, key } = outlineOf(env, layer, W, H, lineW);
  if (!rest || !rest.length) return;
  const radius = clamp(finite(layer.radius, 0), 0, LIMITS.size) * k;
  let full = rest;
  let fullKey: string | undefined = key;
  if (grow !== 1) {
    full = grownOutline(layer, rest, W, H, grow, radius, env.rtl);
    fullKey = undefined;
  }
  // An arc draws on by its sweep, which keeps its round end round; the rest are trimmed.
  let drawn = full;
  let drawnKey = fullKey;
  if (draw < 1) {
    if (shape === 'arc') {
      const r = Math.max(1, Math.min(W, H) - lineW);
      drawn = arcPath(r, r, finite(layer.from, 0), clamp(finite(layer.sweep, 270), -360, 360) * draw);
      if (grow !== 1) drawn = grownOutline(layer, drawn, W, H, grow, radius, env.rtl);
    } else {
      drawn = trimmed(full, draw);
    }
    drawnKey = undefined;
  }

  const scale = scaleOf(pose);
  const shadowPad = layer.shadow ? (Math.abs(finite(layer.shadow.x, 0)) + Math.abs(finite(layer.shadow.y, 0)) + 2 * finite(layer.shadow.blur, 0)) * k : 0;
  if (reveal < 1) {
    // Two pixels of the 1080 px layout, not of this frame, so a wipe's edge is at the same place in u at every size.
    const pad = lineW + shadowPad + 2 * layoutScale(env);
    clipReveal(ctx, reveal, pose.from, -W / 2 - pad, -H / 2 - pad, W / 2 + pad, H / 2 + pad);
  }

  const blurU = Math.max(0, finite(pose.blur, 0));
  const fog = blurU > 0.01 ? clamp01(blurU / BLUR_FULL) : 0;
  if (fog > 0) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * Math.min(1, fog * 1.6);
    soft(env, blurU * k * scale, solidOf(env, fillPaint ?? strokePaint), () => {
      if (fillPaint) paintPath(ctx, full, 'fill', fullKey);
      else {
        ctx.lineWidth = Math.max(0.5, lineW);
        ctx.lineCap = cap;
        ctx.lineJoin = 'round';
        paintPath(ctx, drawn, 'stroke', drawnKey);
      }
    });
    ctx.globalAlpha = base * (1 - fog);
    if (fog >= 1) return;
  }

  const fillAlpha = draw < 1 ? smoothstep(0.55, 1, draw) : 1;
  if (fillPaint && fillAlpha > 0) {
    ctx.save();
    try {
      ctx.globalAlpha *= fillAlpha;
      ctx.fillStyle = env.paint(fillPaint, W, H);
      castShadow(env, layer.shadow, scale);
      paintPath(ctx, full, 'fill', fullKey);
    } finally {
      ctx.restore();
    }
  }
  if (fillPaint && !strokePaint && draw < 1 && fillAlpha < 1) {
    // The outline a filled shape draws on with, gone as the fill arrives.
    ctx.save();
    try {
      ctx.globalAlpha *= (1 - fillAlpha) * smoothstep(0, INK_IN, draw);
      ctx.strokeStyle = solidOf(env, fillPaint);
      ctx.lineWidth = Math.max(0.35 * k, 1.5);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      paintPath(ctx, drawn, 'stroke');
    } finally {
      ctx.restore();
    }
  }
  if (strokePaint && lineW > 0) {
    ctx.save();
    try {
      ctx.strokeStyle = env.paint(strokePaint, W, H);
      ctx.lineWidth = lineW;
      ctx.lineCap = cap;
      ctx.lineJoin = shape === 'rect' || shape === 'polygon' ? 'miter' : 'round';
      const dash = st?.dash;
      if (Array.isArray(dash) && dash.length === 2) {
        const a = clamp(finite(dash[0], 0), 0, LIMITS.size) * k;
        const b = clamp(finite(dash[1], 0), 0, LIMITS.size) * k;
        if (a + b > 0.5) ctx.setLineDash([a, b]);
      }
      if (!fillPaint) castShadow(env, layer.shadow, scale);
      if (draw < 1) ctx.globalAlpha *= smoothstep(0, INK_IN, draw);
      paintPath(ctx, drawn, 'stroke', drawnKey);
    } finally {
      ctx.restore();
    }
  }

  const glint = glintOf(ctx, pose.glint, W, H, layer.loop?.amount, k);
  if (glint) {
    ctx.save();
    try {
      if (fillPaint) {
        ctx.fillStyle = glint;
        paintPath(ctx, full, 'fill', fullKey);
      } else {
        ctx.strokeStyle = glint;
        ctx.lineWidth = lineW;
        ctx.lineCap = cap;
        ctx.lineJoin = 'round';
        paintPath(ctx, drawn, 'stroke', drawnKey);
      }
    } finally {
      ctx.restore();
    }
  }
}

// ── icons ─────────────────────────────────────────────────────────────────

/** An icon's outline on its 24-unit grid centred on the origin, whole and part by part with each part's length. */
interface IconShape {
  segs: Seg[];
  key: string;
  parts: { segs: Seg[]; len: number; key: string }[];
}

const iconShapes = new Map<string, IconShape | null>();

function iconShape(id: string): IconShape | null {
  const name = Object.prototype.hasOwnProperty.call(ICON_PATHS, id) ? id : 'sparkle';
  let s = iconShapes.get(name);
  if (s === undefined) {
    const parsed = parsePath(ICON_PATHS[name as keyof typeof ICON_PATHS]);
    if (!parsed || !parsed.length) s = null;
    else {
      const segs = transformPath(parsed, 1, 0, 0, 1, -12, -12);
      s = {
        segs,
        key: `icon|${name}`,
        parts: subpaths(segs).map((p, i) => ({ segs: p, len: Math.max(0.01, finite(pathLength(p), 0.01)), key: `icon|${name}|${i}` })),
      };
    }
    iconShapes.set(name, s);
  }
  return s;
}

/**
 * An icon: the set's stroked outline scaled to `size`, its weight scaling with
 * it, over its badge when it has one. `draw` runs each part of the outline
 * on with a dash as long as the part, so every stroke starts and finishes
 * together; an id that is not an icon draws the sparkle rather than nothing.
 */
function drawIcon(env: Env, layer: IconLayer, pose: Pose, box: number): void {
  const ctx = env.ctx;
  const k = env.k;
  const S = lenPx(env, layer.size, 8);
  const shapeOf = iconShape(typeof layer.icon === 'string' ? layer.icon : 'sparkle');
  if (!shapeOf || !(S > 0)) return;
  const draw = clamp01(finite(pose.draw, 1));
  const reveal = clamp01(finite(pose.reveal, 1));
  if (draw <= 0 || reveal <= 0) return;
  const scale = scaleOf(pose);
  if (reveal < 1) {
    const pad = 0.1 * box + 2 * layoutScale(env);
    clipReveal(ctx, reveal, pose.from, -box / 2 - pad, -box / 2 - pad, box / 2 + pad, box / 2 + pad);
  }
  const blurU = Math.max(0, finite(pose.blur, 0));
  const fog = blurU > 0.01 ? clamp01(blurU / BLUR_FULL) : 0;
  const badge = layer.badge && typeof layer.badge === 'object' ? layer.badge : undefined;
  const glyphW = clamp(finite(layer.weight, 1.75), 0.25, 6);

  const badgeSegs = badge ? (badge.shape === 'circle' ? ellipsePath(box, box) : rectPath(box, box, box * 0.3)) : null;
  const badgeKey = badge ? `badge|${badge.shape}|${box}` : '';
  const glyph = (how: 'plain' | 'soft') => {
    ctx.save();
    try {
      ctx.scale(S / 24, S / 24);
      ctx.lineWidth = glyphW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (how === 'plain') ctx.strokeStyle = env.paint(layer.color ?? 'fg', 24, 24);
      if (how === 'plain' && !badge) castShadow(env, layer.shadow, scale);
      if (draw >= 1) {
        paintPath(ctx, shapeOf.segs, 'stroke', shapeOf.key);
      } else {
        ctx.globalAlpha *= smoothstep(0, INK_IN, draw);
        for (const part of shapeOf.parts) {
          ctx.setLineDash([part.len, part.len + 1]);
          ctx.lineDashOffset = part.len * (1 - draw);
          paintPath(ctx, part.segs, 'stroke', part.key);
        }
      }
    } finally {
      ctx.restore();
    }
  };

  if (fog > 0) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * Math.min(1, fog * 1.6);
    if (badgeSegs && badge) soft(env, blurU * k * scale, solidOf(env, badge.fill), () => paintPath(ctx, badgeSegs, 'fill', badgeKey));
    soft(env, blurU * k * scale, solidOf(env, layer.color), () => glyph('soft'));
    ctx.globalAlpha = base * (1 - fog);
    if (fog >= 1) return;
  }
  if (badgeSegs && badge) {
    ctx.save();
    try {
      // The badge is drawn with the glyph: it fills in as the glyph draws on.
      ctx.globalAlpha *= draw < 1 ? smoothstep(0, 0.6, draw) : 1;
      ctx.fillStyle = env.paint(badge.fill, box, box);
      castShadow(env, layer.shadow, scale);
      paintPath(ctx, badgeSegs, 'fill', badgeKey);
    } finally {
      ctx.restore();
    }
  }
  glyph('plain');
  if (draw < 1) return;
  // The shimmer crosses the badge when there is one: a light glyph on a badge would hide it.
  const shine = badgeSegs ? glintOf(ctx, pose.glint, box, box, layer.loop?.amount, k) : null;
  if (shine && badgeSegs) {
    ctx.save();
    try {
      ctx.fillStyle = shine;
      paintPath(ctx, badgeSegs, 'fill', badgeKey);
    } finally {
      ctx.restore();
    }
  }
  const glint = glintOf(ctx, pose.glint, 24, 24, layer.loop?.amount);
  if (glint) {
    ctx.save();
    try {
      ctx.scale(S / 24, S / 24);
      ctx.lineWidth = glyphW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = glint;
      paintPath(ctx, shapeOf.segs, 'stroke', shapeOf.key);
    } finally {
      ctx.restore();
    }
  }
}

// ── pictures ──────────────────────────────────────────────────────────────

interface Picture {
  img: HTMLImageElement;
  ok: boolean;
  wait: Promise<void>;
}

/** Room for every picture one document can hold: fewer, and a graphic with more would evict and decode its own pictures every frame, and never show them. */
const pictures = new Lru<Picture>(LIMITS.layers + 4);

/**
 * A picture, decoding or decoded, by its `data:image/` URL — never anything
 * else, since Motion makes no request of its own. Null where there is no
 * `Image` (Node) or the source is not a picture.
 */
function pictureOf(src: unknown): Picture | null {
  if (typeof src !== 'string' || !/^data:image\//i.test(src) || typeof Image === 'undefined') return null;
  let p = pictures.get(src);
  if (!p) {
    const img = new Image();
    const entry: Picture = { img, ok: false, wait: Promise.resolve() };
    img.decoding = 'async';
    img.src = src;
    const decoded = typeof img.decode === 'function'
      ? img.decode()
      : new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('picture')); });
    entry.wait = decoded.then(() => { entry.ok = img.naturalWidth > 0 && img.naturalHeight > 0; }, () => { entry.ok = false; });
    pictures.set(src, entry);
    p = entry;
  }
  return p;
}

/**
 * A picture layer: `cover` fills the box and crops, `contain` fits inside it,
 * both inside the rounded corners. A picture still decoding (or broken)
 * draws a quiet placeholder of its box: `paint` never waits, and `preload`
 * is how a caller has pictures ready for the first frame.
 */
function drawPicture(env: Env, layer: ImageLayer, pose: Pose, W: number, H: number): void {
  const ctx = env.ctx;
  const k = env.k;
  if (!(W > 0 && H > 0)) return;
  const reveal = clamp01(finite(pose.reveal, 1));
  if (reveal <= 0) return;
  const r = Math.min(clamp(finite(layer.radius, 0), 0, LIMITS.size) * k, Math.min(W, H) / 2);
  const scale = scaleOf(pose);
  const edge = 2 * layoutScale(env);
  if (reveal < 1) clipReveal(ctx, reveal, pose.from, -W / 2 - edge, -H / 2 - edge, W / 2 + edge, H / 2 + edge);
  const frame = rectPath(W, H, r);
  const frameKey = `frame|${W}|${H}|${r}`;
  const pic = pictureOf(layer.src);
  if (!pic || !pic.ok) {
    const muted = env.color('muted');
    ctx.save();
    try {
      ctx.globalAlpha *= 0.16;
      ctx.fillStyle = muted;
      paintPath(ctx, frame, 'fill', frameKey);
    } finally {
      ctx.restore();
    }
    ctx.save();
    try {
      ctx.globalAlpha *= 0.7;
      ctx.strokeStyle = muted;
      ctx.lineWidth = Math.max(1, 0.25 * k);
      paintPath(ctx, frame, 'stroke', frameKey);
      const s = Math.min(W, H) * 0.22;
      ctx.lineWidth = Math.max(1, 0.3 * k);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.6);
      ctx.lineTo(-s * 0.25, -s * 0.2);
      ctx.lineTo(s * 0.2, s * 0.25);
      ctx.lineTo(s * 0.5, 0);
      ctx.lineTo(s, s * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(s * 0.55, -s * 0.5, s * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
    return;
  }

  const iw = pic.img.naturalWidth;
  const ih = pic.img.naturalHeight;
  const contain = layer.fit === 'contain';
  const f = contain ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih);
  const dw = iw * f;
  const dh = ih * f;
  if (layer.shadow) {
    ctx.save();
    try {
      const sh = layer.shadow;
      const s = k * scale;
      const shape = contain ? rectPath(dw, dh, Math.min(r, Math.min(dw, dh) / 2)) : frame;
      soft(env, clamp(finite(sh.blur, 0), 0, 50) * s, env.color(sh.color), () => paintPath(ctx, shape, 'fill'),
        clamp(finite(sh.x, 0), -50, 50) * s, clamp(finite(sh.y, 0), -50, 50) * s);
    } finally {
      ctx.restore();
    }
  }
  ctx.save();
  try {
    if (!contain || r > 0) paintPath(ctx, contain ? rectPath(dw, dh, Math.min(r, Math.min(dw, dh) / 2)) : frame, 'clip', contain ? undefined : frameKey);
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    const blurU = Math.max(0, finite(pose.blur, 0));
    const fog = blurU > 0.01 ? clamp01(blurU / BLUR_FULL) : 0;
    const base = ctx.globalAlpha;
    if (fog > 0) {
      ctx.globalAlpha = base * Math.min(1, fog * 1.6);
      if (!softPicture(ctx, pic.img, dw, dh, blurU * k * scale)) ctx.globalAlpha = base;
      else ctx.globalAlpha = base * (1 - fog);
    }
    if (ctx.globalAlpha > 0.001) ctx.drawImage(pic.img, -dw / 2, -dh / 2, dw, dh);
    ctx.globalAlpha = base;
    const glint = glintOf(ctx, pose.glint, W, H, layer.loop?.amount, k);
    if (glint) {
      ctx.fillStyle = glint;
      ctx.fillRect(-W / 2, -H / 2, W, H);
    }
  } finally {
    ctx.restore();
  }
}

/** The largest side of the small copy a soft picture is drawn from, and of the copies it is grown back through. */
const SOFT_SIDE = 512;
const SOFT_GROW = 1024;

/**
 * A picture out of focus, centred on the origin at `dw` x `dh`: drawn small
 * on a scratch canvas and grown back to size, which every engine smooths.
 * That is the blur a canvas has for a picture without `ctx.filter` (a
 * shadow, which soft focus uses for everything else, has only one colour).
 * It grows back in steps of two, between two scratches: one stretch by eight
 * or more shows the small copy's grid as steps along every diagonal, and
 * doubling at a time smooths them away. False when there is no scratch
 * canvas to draw on.
 */
function softPicture(ctx: Ctx, img: CanvasImageSource, dw: number, dh: number, blurPx: number): boolean {
  let f = Math.max(2, finite(blurPx, 0) / 2);
  f = Math.max(f, dw / SOFT_SIDE, dh / SOFT_SIDE);
  let w = Math.max(1, Math.round(dw / f));
  let h = Math.max(1, Math.round(dh / f));
  const a = scratchOf('soft-a', SOFT_GROW + 2, SOFT_GROW + 2);
  const b = scratchOf('soft-b', SOFT_GROW + 2, SOFT_GROW + 2);
  if (!a || !b) return false;
  for (const g of [a, b]) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
  }
  a.clearRect(0, 0, w + 2, h + 2);
  a.drawImage(img, 0, 0, w, h);
  let from = a;
  while (w * 2 <= SOFT_GROW && h * 2 <= SOFT_GROW && w * 2 < dw && h * 2 < dh) {
    const to = from === a ? b : a;
    to.clearRect(0, 0, w * 2 + 2, h * 2 + 2);
    to.drawImage(from.canvas, 0, 0, w, h, 0, 0, w * 2, h * 2);
    w *= 2;
    h *= 2;
    from = to;
  }
  ctx.drawImage(from.canvas, 0, 0, w, h, -dw / 2, -dh / 2, dw, dh);
  return true;
}

// ── ready for the first frame ─────────────────────────────────────────────

/**
 * Everything a document draws with, ready: every picture decoded and every
 * face it sets words in loaded (`ensureFonts`, which gives up after two
 * seconds rather than hold the first frame). Call it before the first frame
 * of a preview and before an export; `paint` itself never waits, so without
 * it a picture draws as a placeholder until it has decoded. Always resolves.
 */
export async function preload(doc: Motion): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const l of Array.isArray(doc?.layers) ? doc.layers : []) {
    if (l && l.kind === 'image') {
      const p = pictureOf(l.src);
      if (p) jobs.push(p.wait);
    }
  }
  jobs.push(Promise.resolve().then(() => ensureFonts(doc)).catch(() => undefined));
  await Promise.all(jobs);
  // Widths taken before a face arrived were taken in its fallback.
  fontsChanged();
}
