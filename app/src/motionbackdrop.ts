import type { Backdrop, BackdropLayer, Ctx, Env, Particles, ParticlesLayer, Pose } from './motiontypes';
import { LIMITS } from './motiontypes';
import { clamp, clamp01, finite, hash01, lerp, luminance, mixColors, rng, smoothstep, withAlpha } from './motionmath';

/**
 * Moving backgrounds and particles: the two kinds of layer that are not one
 * thing put somewhere but a field of things spread over the frame.
 * `motiondraw.ts`'s `paint` calls `drawBackdrop` and `drawParticles` after it
 * has set the layer's blend and opacity; everything here only adds to that
 * state, and leaves the context as it found it.
 *
 * ## A frame is a function of time
 *
 * Nothing is simulated. A backdrop is a handful of sines of one phase; a
 * particle's place is the exact solution of its flight at its age, and all
 * that looks random about it is `hash01` of the seed, its index and, in a
 * stream, which of its lives this is. So any frame can be drawn on its own —
 * the preview while scrubbing, a still, the 400th frame of an export — and a
 * test can ask for any moment in any order.
 *
 * ## Backdrops loop
 *
 * A backdrop runs a whole number of cycles in the graphic's length (`speed`
 * rounded, at least one), and every motion in it is a sine of a whole
 * multiple of that cycle's phase, or a pattern that has moved by exactly one
 * repeat of itself. Its last frame therefore runs into its first, and a
 * looping export has no jump. A stream of particles keeps the same promise:
 * each particle's life is a whole fraction of the graphic's length. Speed 0
 * holds a backdrop still and turns a particle layer into a still photograph
 * of itself.
 *
 * ## Under the words
 *
 * A backdrop is drawn under everything after it, so it is soft and low in
 * contrast: the document's own background shows through, patterns fade away
 * from where a headline sits, and on a dark ground light is added (`screen`)
 * where on a light one it is only tinted. A layer that names its own blend
 * keeps it: the screen is only chosen when the layer asked for none.
 *
 * ## WebKit
 *
 * The app draws in WKWebView, which has no `ctx.filter`: every softness here
 * is a radial gradient, most of them drawn once in a unit circle and placed
 * with the transform, so a field of three hundred soft dots costs a handful
 * of gradients rather than three hundred. WebKit does not dither gradients
 * either, so the soft styles carry a still grain of a level or two, and every
 * large gradient is sampled finely enough that its straight pieces do not
 * show as rings.
 */

const TAU = Math.PI * 2;

/** 1/φ: particle `i` starts its first life this far after particle `i − 1`, which spreads any number of them evenly. */
const GOLDEN = 0.6180339887498949;

/** A frame of 16:9 or 9:16, in square u: the area every density is written for. */
const WIDE_AREA = (100 * 16 / 9) * 100;

// ── shared ────────────────────────────────────────────────────────────────

/** A colour at an opacity, with the opacity kept in range whatever the arithmetic before it did. */
function rgba(color: string, alpha: number): string {
  return withAlpha(color, clamp01(finite(alpha, 0)));
}

/** A layer's colours as CSS colours: its own, or `fallback` when it names none. */
function colorsOf(env: Env, list: readonly string[] | undefined, fallback: readonly string[]): string[] {
  const named = Array.isArray(list) ? list.filter((c) => typeof c === 'string' && c.trim() !== '') : [];
  return (named.length ? named : fallback).slice(0, LIMITS.colors).map((c) => env.color(c));
}

/**
 * Whether the ground is dark. On a dark ground light is added, and on a light
 * one colour is laid on: `screen` over white is white, so the same backdrop
 * would vanish there.
 */
function darkGround(env: Env): boolean {
  return finite(luminance(env.color('bg')), 0) < 0.4;
}

/** Whether the layer left the blend as it is, so a style may choose its own. */
function plainBlend(ctx: Ctx): boolean {
  const op = ctx.globalCompositeOperation as string | undefined;
  return !op || op === 'source-over';
}

/** A fraction of a turn, 0 up to 1. A hair under a whole turn is the whole turn, so two times a period apart give the same frame to the last digit. */
function turnOf(x: number): number {
  const f = x - Math.floor(x);
  return f > 1 - 1e-9 ? 0 : f;
}

/**
 * A falloff as gradient stops, sampled every `1/n`. Finely, on purpose: a
 * gradient is straight between its stops, and on a flat ground a handful of
 * straight pieces shows as rings (the eye finds every change of slope).
 */
function falloff(n: number, f: (r: number) => number): (readonly [number, number])[] {
  return Array.from({ length: n + 1 }, (_, i) => [i / n, clamp01(f(i / n))] as const);
}

/** A soft round light, 1 in the middle to 0 at the edge: a gaussian, bent to reach zero exactly at the rim. */
const SOFT = falloff(16, (r) => Math.exp(-4.2 * r * r) * (1 - r * r));

/** A radial gradient with `SOFT`'s falloff: the light of every glow here. */
function softGlow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1e-3, r));
  for (const [at, a] of SOFT) g.addColorStop(at, rgba(color, alpha * a));
  return g;
}

/**
 * A gradient in the unit circle, for drawing many soft discs with one: each
 * disc is the unit circle moved and scaled into place, so the gradient is
 * made once per colour per frame rather than once per disc.
 */
function unitGradient(ctx: Ctx, color: string, stops: readonly (readonly [number, number])[]): CanvasGradient {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [at, a] of stops) g.addColorStop(at, rgba(color, a));
  return g;
}

/** Fill the unit circle, placed at `x, y` with radius `r`, at an opacity relative to the layer's. */
function stamp(ctx: Ctx, fill: CanvasGradient | string, x: number, y: number, r: number, alpha: number, base: number): void {
  if (!(r > 0.05) || !(alpha > 0.002)) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(r, r);
  ctx.globalAlpha = base * clamp01(alpha);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A small canvas of its own, off the page; null where there is none to be had (Node without a stand-in). */
function scratch(size: number): { canvas: CanvasImageSource; ctx: Ctx } | null {
  try {
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(size, size)
      : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: size, height: size }) : null;
    const ctx = canvas ? (canvas.getContext('2d') as Ctx | null) : null;
    return canvas && ctx ? { canvas, ctx } : null;
  } catch {
    return null;
  }
}

/**
 * Soft discs as small pictures, one per colour and falloff, made the first
 * time they are asked for and kept. WebKit fills a gradient disc many times
 * slower than it copies a picture of one: three hundred snowflakes drawn as
 * gradients take longer than a frame lasts. A picture depends only on its
 * colour and falloff, never on a frame, so keeping it changes no frame.
 */
const sprites = new Map<string, CanvasImageSource | null>();

/** The disc for `color` and `stops`, or null when no canvas can be made (then the caller fills a gradient). */
function spriteOf(color: string, stops: readonly (readonly [number, number])[], name: string): CanvasImageSource | null {
  const key = `${name}|${color}`;
  const kept = sprites.get(key);
  if (kept !== undefined) return kept;
  const size = 96;
  const s = scratch(size);
  let made: CanvasImageSource | null = null;
  if (s) {
    try {
      s.ctx.translate(size / 2, size / 2);
      s.ctx.scale(size / 2, size / 2);
      s.ctx.fillStyle = unitGradient(s.ctx, color, stops);
      s.ctx.beginPath();
      s.ctx.arc(0, 0, 1, 0, TAU);
      s.ctx.fill();
      made = s.canvas;
    } catch {
      made = null;
    }
  }
  // Colours come from documents, so the keeping is bounded.
  if (sprites.size >= 96) sprites.clear();
  sprites.set(key, made);
  return made;
}

/**
 * A soft disc at `x, y` with radius `r`: the kept picture when there is one,
 * the gradient otherwise. Leaves `globalAlpha` at `base`.
 */
function blot(ctx: Ctx, color: string, stops: readonly (readonly [number, number])[], name: string, x: number, y: number, r: number, alpha: number, base: number): void {
  if (!(r > 0.05) || !(alpha > 0.002)) return;
  const sprite = spriteOf(color, stops, name);
  if (!sprite) {
    stamp(ctx, unitGradient(ctx, color, stops), x, y, r, alpha, base);
    return;
  }
  ctx.globalAlpha = base * clamp01(alpha);
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = base;
}

// ── backdrops ─────────────────────────────────────────────────────────────

/** What every backdrop style is drawn from on one frame. */
interface Scene {
  env: Env;
  ctx: Ctx;
  /** The frame, in pixels. */
  W: number;
  H: number;
  /** Pixels per u. */
  k: number;
  seed: number;
  /** 0 to 1: how many things, how close together. */
  density: number;
  dark: boolean;
  /** The layer asked for no blend of its own. */
  plain: boolean;
  /** 0 up to 1: how far through its cycle the backdrop is. */
  turn: number;
  /** The same, in radians: every motion is a sine of a whole multiple of it. */
  phase: number;
  /**
   * How far the drifting styles wander, 0 to 1. A short graphic wanders less,
   * so fitting a whole cycle into it is never a rush, and a speed under 1
   * wanders less rather than faster.
   */
  reach: number;
  /** The frame's area over a 16:9 frame's, in u: counts scale with it. */
  area: number;
  colors: string[];
}

const BACKDROP_COLORS: Record<Backdrop, readonly string[]> = {
  aurora: ['accent', 'accent2', 'muted'],
  grid: ['fg', 'accent'],
  dots: ['fg', 'accent'],
  rays: ['accent', 'fg'],
  waves: ['accent', 'accent2', 'muted'],
  bokeh: ['accent', 'accent2', 'fg'],
  stripes: ['fg', 'accent'],
};

/**
 * Draw a backdrop: the whole frame, under everything after it. The layer's
 * place, size and turn mean nothing to a backdrop, so the pose is not read;
 * its opacity and blend are already on the context.
 */
export function drawBackdrop(env: Env, layer: BackdropLayer, _pose: Pose): void {
  const ctx = env.ctx;
  const W = finite(env.width, 0);
  const H = finite(env.height, 0);
  if (!(W > 0 && H > 0)) return;
  const k = finite(env.k, 0) > 0 ? env.k : Math.min(W, H) / 100;
  const style: Backdrop = layer.style in BACKDROP_COLORS ? layer.style : 'aurora';

  const seconds = Math.max(LIMITS.minSeconds, finite(env.doc?.seconds, 10));
  const speed = clamp(finite(layer.speed, 1), 0, 3);
  const period = seconds / Math.max(1, Math.round(speed));
  const s = finite(env.t, 0) - finite(layer.start, 0);
  const turn = speed > 0 ? turnOf(s / period) : 0;

  const scene: Scene = {
    env, ctx, W, H, k,
    seed: finite(layer.seed, 1),
    density: clamp01(finite(layer.density, 0.5)),
    dark: darkGround(env),
    plain: plainBlend(ctx),
    turn,
    phase: turn * TAU,
    reach: clamp(seconds / 10, 0.25, 1) * Math.min(1, speed),
    area: clamp((W / k) * (H / k) / WIDE_AREA, 0.3, 2),
    colors: colorsOf(env, layer.colors, BACKDROP_COLORS[style]),
  };
  ctx.save();
  switch (style) {
    case 'grid': grid(scene); break;
    case 'dots': dots(scene); break;
    case 'rays': rays(scene); break;
    case 'waves': waves(scene); break;
    case 'bokeh': bokeh(scene); break;
    case 'stripes': stripes(scene); break;
    default: aurora(scene); break;
  }
  if (style !== 'grid' && style !== 'dots') grain(scene);
  ctx.restore();
}

/** The grain's tile: made once, the same on every frame; null where there is no canvas to make it on (Node without one). */
let grainTile: CanvasImageSource | null | undefined;

function grainOf(): CanvasImageSource | null {
  if (grainTile !== undefined) return grainTile;
  grainTile = null;
  try {
    const size = 64;
    const s = scratch(size);
    if (!s) return null;
    const img = s.ctx.createImageData(size, size);
    const next = rng(0x6e01);
    // White, its opacity the noise: 0 to 5 in 255, most of them near 2.
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round((next() + next()) * 2.5);
    }
    s.ctx.putImageData(img, 0, 0);
    grainTile = s.canvas;
  } catch {
    grainTile = null;
  }
  return grainTile;
}

/**
 * A fine, still grain over the soft styles. A canvas gradient has 256 steps
 * and WebKit does not dither them, so a slow dark gradient shows its steps as
 * rings. Lightening each pixel by 0 to 5 levels at random breaks the rings up
 * and cannot be seen for itself. `source-atop` lays it only where there is
 * paint already, so a transparent graphic stays transparent. It is the same
 * on every frame, so the loop still meets itself.
 */
function grain(sc: Scene): void {
  const tile = grainOf();
  if (!tile) return;
  const pattern = sc.ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  const { ctx } = sc;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, sc.W, sc.H);
  ctx.restore();
}

/** How the edges darken, from where the vignette begins (0) to past the corners (1). */
const VIGNETTE = falloff(12, (r) => Math.pow(smoothstep(0, 1, r), 1.15));

/**
 * The edges drawn back toward the ground colour, so a backdrop frames the
 * middle rather than reaching the edge as hard as it does the centre. An
 * ellipse the frame's shape: a circle would darken a portrait frame's top
 * and bottom and hardly touch its sides.
 */
function vignette(sc: Scene, alpha: number): void {
  const { ctx, W, H } = sc;
  const bg = sc.env.color('bg');
  ctx.save();
  if (!sc.plain) ctx.globalCompositeOperation = 'source-over';
  ctx.translate(W / 2, H / 2);
  ctx.scale(W / 2, H / 2);
  const g = ctx.createRadialGradient(0, 0, 0.45, 0, 0, 1.5);
  for (const [at, v] of VIGNETTE) g.addColorStop(at, rgba(bg, alpha * v));
  ctx.fillStyle = g;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

/**
 * `aurora`: three or four very large soft lights, each a long ellipse — a
 * veil rather than a spot — drifting on closed Lissajous paths (whole-number
 * frequencies, so each path closes in one cycle) and slowly turning, added
 * to a dark ground or laid thinly on a light one, with the edges drawn back.
 */
function aurora(sc: Scene): void {
  const { ctx, W, H, phase, reach, dark } = sc;
  const n = 3 + Math.round(sc.density);
  const big = Math.max(W, H);
  const spin = hash01(sc.seed, 101) * TAU;
  ctx.save();
  if (sc.plain && dark) ctx.globalCompositeOperation = 'screen';
  for (let j = 0; j < n; j++) {
    const h = (ch: number) => hash01(sc.seed, j, ch);
    // Round the frame and out toward its edges, so the ground shows between the lights and the middle is the calmest part.
    const around = spin + (j / n) * TAU + (h(1) - 0.5) * 0.6;
    // Each axis's reach is divided by its frequency, so a light on a figure-of-eight moves no faster than one on an ellipse.
    const fx = 1 + (j % 2);
    const fy = 2 - (j % 2);
    const x = W * (0.5 + 0.4 * Math.cos(around))
      + (W * 0.12 * reach * Math.sin(fx * phase + h(2) * TAU)) / fx
      + (W * 0.03 * reach * Math.sin(3 * phase + h(3) * TAU)) / 3;
    const y = H * (0.5 + 0.38 * Math.sin(around))
      + (H * 0.12 * reach * Math.cos(fy * phase + h(4) * TAU)) / fy;
    const r = big * lerp(0.3, 0.42, h(5)) * (1 + 0.08 * reach * Math.sin(phase + h(6) * TAU));
    const a = dark ? lerp(0.44, 0.56, h(7)) : lerp(0.24, 0.32, h(7));
    const stretch = lerp(1.35, 1.8, h(8));
    const tilt = h(9) * Math.PI + 0.35 * reach * Math.sin(phase + h(10) * TAU);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(r * stretch, r / stretch);
    ctx.fillStyle = unitGradient(ctx, sc.colors[j % sc.colors.length], SOFT.map(([at, v]) => [at, v * a] as const));
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.restore();
  vignette(sc, dark ? 0.6 : 0.35);
}

/**
 * `grid`: fine lines, scrolling diagonally by exactly one square per cycle,
 * fading out toward the edges; the crossings are dots that brighten as a
 * diagonal wave of light passes over them.
 */
function grid(sc: Scene): void {
  const { ctx, W, H, k, dark } = sc;
  const step = k * lerp(13, 5, sc.density);
  const off = sc.turn * step;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.hypot(W, H) / 2;
  const line = sc.colors[0];
  const dot = sc.colors[1 % sc.colors.length];
  const a = dark ? 0.19 : 0.15;

  const mask = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  mask.addColorStop(0, rgba(line, a));
  mask.addColorStop(0.4, rgba(line, a * 0.85));
  mask.addColorStop(0.75, rgba(line, a * 0.3));
  mask.addColorStop(1, rgba(line, 0));
  const cols = Math.ceil(W / step) + 2;
  const rows = Math.ceil(H / step) + 2;
  ctx.beginPath();
  for (let i = 0; i < cols; i++) {
    const x = off + (i - 1) * step;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  for (let j = 0; j < rows; j++) {
    const y = off + (j - 1) * step;
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
  }
  ctx.strokeStyle = mask;
  ctx.lineWidth = Math.max(1, 0.1 * k);
  ctx.stroke();

  // The crossings, in a few batches by brightness rather than one fill each.
  const lambda = (W + H) * 0.55;
  const buckets = new Map<number, { x: number; y: number; r: number }[]>();
  const glows: { x: number; y: number; r: number; a: number }[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = off + (i - 1) * step;
      const y = off + (j - 1) * step;
      const fade = 1 - smoothstep(0.15, 0.95, Math.hypot(x - cx, y - cy) / R);
      if (fade <= 0.01) continue;
      const wave = 0.5 + 0.5 * Math.cos(((x + y) / lambda) * TAU - sc.phase);
      const crest = Math.pow(wave, 5);
      const alpha = fade * ((dark ? 0.2 : 0.16) + (dark ? 0.62 : 0.46) * crest);
      const r = k * (0.13 + 0.15 * crest);
      const key = Math.round(alpha * 24);
      if (key <= 0) continue;
      const list = buckets.get(key) ?? [];
      list.push({ x, y, r });
      buckets.set(key, list);
      if (crest > 0.15) glows.push({ x, y, r: k * 1.9, a: fade * crest * (dark ? 0.45 : 0.25) });
    }
  }
  for (const [key, list] of [...buckets.entries()].sort((p, q) => p[0] - q[0])) {
    ctx.beginPath();
    for (const d of list) {
      ctx.moveTo(d.x + d.r, d.y);
      ctx.arc(d.x, d.y, d.r, 0, TAU);
    }
    ctx.fillStyle = rgba(dot, key / 24);
    ctx.fill();
  }
  const base = ctx.globalAlpha;
  for (const g of glows) blot(ctx, dot, SOFT, 'soft', g.x, g.y, g.r, g.a, base);
}

/**
 * `dots`: a halftone screen whose dots swell and brighten as a broad
 * diagonal wave sweeps across it, one wavelength per cycle. The middle,
 * where words usually sit, is calmer than the edges.
 */
function dots(sc: Scene): void {
  const { ctx, W, H, k, dark } = sc;
  const pitch = k * lerp(5.2, 2.4, sc.density);
  const rowH = pitch * Math.sqrt(3) / 2;
  const angle = lerp(0.35, 1.0, hash01(sc.seed, 11));
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const lambda = (Math.abs(W * ux) + Math.abs(H * uy)) * 0.8;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.hypot(W, H) / 2;
  const color = sc.colors[0];
  const accent = sc.colors[1 % sc.colors.length];
  const levels = 24;
  const tints = 4;
  const buckets = new Map<number, { x: number; y: number; r: number }[]>();
  const rows = Math.ceil(H / rowH) + 2;
  const cols = Math.ceil(W / pitch) + 2;
  for (let j = 0; j < rows; j++) {
    const y = (j - 0.5) * rowH;
    const shift = (j % 2) * pitch * 0.5;
    for (let i = 0; i < cols; i++) {
      const x = (i - 0.5) * pitch + shift;
      const wave = 0.5 + 0.5 * Math.cos(((x * ux + y * uy) / lambda) * TAU - sc.phase);
      const swell = wave * wave * (3 - 2 * wave);
      const calm = lerp(0.5, 1, smoothstep(0.1, 0.85, Math.hypot(x - cx, y - cy) / R));
      const r = pitch * (0.08 + 0.19 * swell) * lerp(0.85, 1, calm);
      const alpha = calm * (dark ? 0.09 + 0.2 * swell : 0.07 + 0.15 * swell);
      const key = Math.round(alpha * levels);
      if (key <= 0 || r < 0.3) continue;
      // Toward the crest the dots take on the second colour, so the wave reads as light and not only as size.
      const slot = key * tints + Math.round(swell * (tints - 1));
      const list = buckets.get(slot) ?? [];
      list.push({ x, y, r });
      buckets.set(slot, list);
    }
  }
  for (const [slot, list] of [...buckets.entries()].sort((p, q) => p[0] - q[0])) {
    ctx.beginPath();
    for (const d of list) {
      ctx.moveTo(d.x + d.r, d.y);
      ctx.arc(d.x, d.y, d.r, 0, TAU);
    }
    const tint = (slot % tints) / (tints - 1);
    ctx.fillStyle = rgba(mixColors(color, accent, tint * 0.75), Math.floor(slot / tints) / levels);
    ctx.fill();
  }
}

/**
 * `rays`: a sunburst from the middle of the frame, alternate wedges light and
 * faint, each wedge's edge feathered by three widths laid over each other,
 * everything fading with distance. It turns by exactly one light-and-faint
 * pair per cycle, which is where the pattern meets itself.
 */
function rays(sc: Scene): void {
  const { ctx, W, H, dark } = sc;
  const n = 2 * Math.round(lerp(7, 15, sc.density));
  const wedge = TAU / n;
  const cx = W / 2;
  const cy = H / 2;
  // Past the corners: where the light rounds down to nothing is a visible ring, so it happens off the frame.
  const R = (Math.hypot(W, H) / 2) * 1.3;
  const rot = hash01(sc.seed, 21) * wedge * 2 + sc.turn * wedge * 2;
  const light = dark ? mixColors(sc.colors[0], '#ffffff', 0.18) : sc.colors[0];
  const faint = sc.colors[1 % sc.colors.length];
  const a = dark ? 0.13 : 0.1;

  // Up from nothing at the point, then a long smooth fall.
  const profile = falloff(24, (r) => smoothstep(0, 0.1, r) * Math.pow(1 - r, 1.8));
  const fade = (color: string, alpha: number, reach: number): CanvasGradient => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    for (const [at, v] of profile) g.addColorStop(at, rgba(color, alpha * v));
    return g;
  };
  for (const width of [1, 0.74, 0.48]) {
    // Each width reaches a little further, so the three gradients' 8-bit steps fall at different radii instead of piling up.
    const reach = R * (1.12 - width * 0.12);
    for (const odd of [0, 1]) {
      ctx.beginPath();
      for (let i = odd; i < n; i += 2) {
        const mid = rot + (i + 0.5) * wedge;
        const half = (wedge / 2) * width;
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, reach, mid - half, mid + half);
        ctx.closePath();
      }
      ctx.fillStyle = odd ? fade(faint, (a * 0.36) / 2.2, reach) : fade(light, a / 2.2, reach);
      ctx.fill();
    }
  }
  // A soft light where the rays meet, so the middle is a glow and not a point.
  ctx.fillStyle = softGlow(ctx, cx, cy, Math.min(W, H) * 0.55, light, dark ? 0.14 : 0.1);
  ctx.fillRect(0, 0, W, H);
}

/**
 * `waves`: three to five layered waves rising from the bottom edge, each the
 * sum of two sines travelling opposite ways at whole-number speeds, so the
 * swell rolls without drifting off and closes on itself every cycle.
 */
function waves(sc: Scene): void {
  const { ctx, W, H, dark } = sc;
  const n = 3 + Math.round(sc.density * 2);
  const short = Math.min(W, H);
  // How high the swell reaches: the frame's height in a wide or square frame, less of it in a tall one,
  // where the same share would fill the lower half.
  const rise = (short + H) / 2;
  const span = Math.max(W, rise);
  const steps = 72;
  for (let j = 0; j < n; j++) {
    const depth = n > 1 ? j / (n - 1) : 1;
    const h = (ch: number) => hash01(sc.seed, j, ch);
    const base = H - rise * (lerp(0.36, 0.1, depth) - 0.025 * (h(1) - 0.5));
    const amp = short * lerp(0.065, 0.035, depth) * lerp(0.6, 1, sc.reach);
    // The swell goes round once a cycle and the ripple on it once or twice, half as long when twice, so no layer
    // rolls faster than an easy pace. Lengths follow the longer of the width and the swell's height, so a tall
    // frame has swells too and not a chop.
    const m2 = 1 + (j % 2);
    const l1 = span * lerp(0.9, 1.4, h(2));
    const l2 = (span * lerp(0.4, 0.6, h(3))) / m2;
    const way = j % 2 ? 1 : -1;
    const p1 = h(4) * TAU;
    const p2 = h(5) * TAU;
    const yAt = (x: number) => base + amp * (0.7 * Math.sin((x / l1) * TAU + way * sc.phase + p1)
      + 0.3 * Math.sin((x / l2) * TAU - way * m2 * sc.phase + p2));
    const color = sc.colors[(n - 1 - j) % sc.colors.length];
    const top = dark ? lerp(0.13, 0.24, depth) : lerp(0.1, 0.18, depth);

    const pts: [number, number][] = [];
    for (let q = 0; q <= steps; q++) {
      const x = (q / steps) * W;
      pts.push([x, yAt(x)]);
    }
    ctx.beginPath();
    ctx.moveTo(-2, H + 2);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(W + 2, H + 2);
    ctx.closePath();
    // Strongest at the crest and thinning below it, so the layers read as light through water rather than stacked card.
    const g = ctx.createLinearGradient(0, base - amp, 0, base + (H - base) * 0.9 + amp);
    g.addColorStop(0, rgba(color, top));
    g.addColorStop(0.35, rgba(color, top * 0.55));
    g.addColorStop(1, rgba(color, top * 0.12));
    ctx.fillStyle = g;
    ctx.fill();

    // The crest, lit: a soft wide line under a fine bright one. It is what makes a flat fill read as a wave.
    ctx.beginPath();
    pts.forEach(([x, y], q) => (q ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    const lit = mixColors(color, '#ffffff', dark ? 0.45 : 0.15);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = rgba(lit, top * 0.35);
    ctx.lineWidth = Math.max(2, sc.k * 0.7);
    ctx.stroke();
    ctx.strokeStyle = rgba(lit, Math.min(1, top * 2.2));
    ctx.lineWidth = Math.max(1, sc.k * 0.13);
    ctx.stroke();
  }
}

/**
 * `bokeh`: soft discs, the out-of-focus lights of a lens, each drifting up a
 * little while it swells and fades in and out again. A disc's life is a
 * whole fraction of the cycle and it comes back where it was one cycle ago,
 * so the field loops; the lives are staggered, so the field is never empty.
 */
function bokeh(sc: Scene): void {
  const { ctx, W, H, k, dark } = sc;
  const n = Math.max(4, Math.round(lerp(12, 34, sc.density) * sc.area));
  ctx.save();
  if (sc.plain && dark) ctx.globalCompositeOperation = 'screen';
  const base = ctx.globalAlpha;
  const discs: { x: number; y: number; r: number; a: number; color: number; crisp: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const lives = hash01(sc.seed, i, 1) < 0.5 ? 1 : 2;
    const v = sc.turn * lives + ((i * GOLDEN + hash01(sc.seed, i, 2) * 0.2) % 1);
    const u = v - Math.floor(v);
    const life = Math.floor(v) % lives;
    const h = (ch: number) => hash01(sc.seed + life * 173, i, ch);
    const z = Math.pow(h(3), 1.7);
    const r = k * lerp(2.6, 15, z) * (1 + 0.05 * Math.sin(u * TAU * 2 + h(4) * TAU));
    const rise = H * lerp(0.1, 0.22, h(5)) * lerp(0.5, 1, sc.reach);
    const x = W * (h(6) * 1.1 - 0.05) + W * 0.012 * sc.reach * Math.sin(u * TAU + h(7) * TAU);
    const y = H * (h(8) * 1.1 - 0.05) + rise * (0.5 - u);
    const show = smoothstep(0, 0.28, u) * (1 - smoothstep(0.68, 1, u));
    const pulse = 0.85 + 0.15 * Math.sin(u * TAU * 3 + h(9) * TAU);
    const a = (dark ? lerp(0.34, 0.14, z) : lerp(0.24, 0.1, z)) * show * pulse;
    discs.push({ x, y, r, a, color: i % sc.colors.length, crisp: z < 0.45 });
  }
  // Far and wide first, so the small sharp ones sit in front.
  discs.sort((p, q) => q.r - p.r);
  // A lens's disc is nearly flat with a slightly brighter rim; the far ones are only a glow.
  const crispStops: readonly (readonly [number, number])[] = [[0, 0.72], [0.62, 0.8], [0.84, 1], [0.93, 0.5], [1, 0]];
  const softStops: readonly (readonly [number, number])[] = [[0, 0.9], [0.35, 0.75], [0.7, 0.35], [1, 0]];
  const cache = new Map<string, CanvasGradient>();
  for (const d of discs) {
    const key = `${d.color}${d.crisp ? 'c' : 's'}`;
    let g = cache.get(key);
    if (!g) {
      g = unitGradient(ctx, sc.colors[d.color], d.crisp ? crispStops : softStops);
      cache.set(key, g);
    }
    stamp(ctx, g, d.x, d.y, d.r, d.a, base);
  }
  ctx.restore();
}

/** How the stripes fade along their length, from the lit side (0) to the far one (1). */
const SHADE = falloff(10, (r) => 0.8 * Math.pow(r, 1.5));

/**
 * `stripes`: wide diagonal bands, soft-edged, alternately light and faint,
 * sliding along their normal by one light-and-faint pair per cycle. One
 * linear gradient carries every band, so the edges are as soft as its stops
 * make them and the frame is filled once.
 */
function stripes(sc: Scene): void {
  const { ctx, W, H, k, dark } = sc;
  const band = k * lerp(13, 4.5, sc.density);
  const rep = band * 2;
  const angle = (hash01(sc.seed, 31) < 0.5 ? -1 : 1) * lerp(0.5, 0.8, hash01(sc.seed, 32));
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const proj = [0, W * ux, H * uy, W * ux + H * uy];
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const start = lo - rep + sc.turn * rep;
  const count = Math.max(1, Math.ceil((hi - start) / rep) + 1);
  const g = ctx.createLinearGradient(ux * start, uy * start, ux * (start + count * rep), uy * (start + count * rep));
  const color = dark ? mixColors(sc.colors[0], '#ffffff', 0.12) : sc.colors[0];
  const tint = sc.colors[1 % sc.colors.length];
  const strong = dark ? 0.1 : 0.08;
  // A soft band of light and a longer gap: a raised cosine, squared, sampled finely enough that no ramp shows a corner.
  const samples = 8;
  for (let r = 0; r < count; r++) {
    for (let q = 0; q < samples; q++) {
      const f = q / samples;
      const lift = Math.pow(0.5 + 0.5 * Math.cos(f * TAU), 2);
      g.addColorStop(clamp01((r + f) / count), rgba(mixColors(tint, color, lift), strong * (0.1 + 0.9 * lift)));
    }
  }
  g.addColorStop(1, rgba(color, strong));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // The light falls across the bands from one side: they fade along their own length toward the other.
  const vx = -uy * (hash01(sc.seed, 33) < 0.5 ? 1 : -1);
  const vy = ux * (hash01(sc.seed, 33) < 0.5 ? 1 : -1);
  const along = [0, W * vx, H * vy, W * vx + H * vy];
  const a0 = Math.min(...along);
  const a1 = Math.max(...along);
  const bg = sc.env.color('bg');
  const shade = ctx.createLinearGradient(vx * a0, vy * a0, vx * a1, vy * a1);
  for (const [at, v] of SHADE) shade.addColorStop(at, rgba(bg, v));
  ctx.save();
  if (!sc.plain) ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  vignette(sc, dark ? 0.4 : 0.22);
}

// ── particles ─────────────────────────────────────────────────────────────

/** A rectangle in the particle layer's own coordinates, where the emitter is the origin. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What every particle of one layer shares on one frame. */
interface Field {
  ctx: Ctx;
  k: number;
  seed: number;
  /** Seconds since the layer started. */
  s: number;
  /** 0 to 3, 1 as designed. */
  speed: number;
  /** Speed 0: every particle held where it is at one chosen moment. */
  still: boolean;
  /** The graphic's length: a stream repeats in it. */
  seconds: number;
  /** Pixels: a typical particle. */
  size: number;
  /** Pixels: the radius particles set off from. 0 is the whole frame. */
  spread: number;
  frame: Box;
  colors: string[];
  dark: boolean;
  plain: boolean;
  /** The layer's opacity, which every particle's is relative to. */
  base: number;
}

/** A launch from the emitter: the physics of a burst, and of a stream from a point. */
interface Throw {
  /** Seconds a particle lives, at speed 1. */
  life: [number, number];
  /** u per second at launch. */
  launch: [number, number];
  /** Radians, clockwise from +x: where the cone points. A cone of π is every direction. */
  aim: number;
  cone: number;
  /** Per second: how fast the air takes a particle's speed. */
  drag: number;
  /** u per second², down; negative floats up. */
  gravity: number;
  /**
   * How launch speeds are spread: ½ fills the cloud evenly by area, nearer 1
   * throws most of them far, into the ring a firework makes.
   */
  shape: number;
  /** u of side-to-side flutter once the launch has spent itself, and its slowest and fastest frequencies. */
  sway: [number, number, number];
  /**
   * How much drag and gravity differ from piece to piece, ± this fraction:
   * the larger a piece, the harder it falls (or rises).
   */
  vary: number;
  /** Thrown out from where each one starts, as a firework's ring is, rather than any way at all, as a cloud is. */
  out: boolean;
}

/** A pass across the whole frame, for a layer with no spread. */
interface Pass {
  /** 1 falls, −1 rises, 0 stays put and twinkles. */
  way: 1 | -1 | 0;
  /** u per second, far to near. */
  pace: [number, number];
  /** u of side-to-side sway, and its frequencies per second. */
  sway: number;
  hz: [number, number];
  /** Seconds a still particle lives. */
  life: [number, number];
}

const THROWS: Record<Particles, Throw> = {
  confetti: { life: [2.8, 4.4], launch: [55, 135], aim: -Math.PI / 2, cone: 1.2, drag: 2.6, gravity: 58, shape: 0.8, sway: [2.4, 0.8, 1.6], vary: 0.35, out: false },
  sparks: { life: [0.5, 1.15], launch: [45, 135], aim: 0, cone: Math.PI, drag: 3.2, gravity: 22, shape: 0.8, sway: [0, 0, 0], vary: 0.2, out: true },
  bubbles: { life: [2.4, 4], launch: [3, 30], aim: 0, cone: Math.PI, drag: 1.8, gravity: -24, shape: 0.5, sway: [1, 0.7, 1.3], vary: 0.45, out: false },
  stars: { life: [1.3, 2.4], launch: [5, 58], aim: 0, cone: Math.PI, drag: 3.4, gravity: 0, shape: 0.5, sway: [0, 0, 0], vary: 0.2, out: false },
  snow: { life: [2.8, 4.6], launch: [3, 22], aim: 0, cone: Math.PI, drag: 1.3, gravity: 7, shape: 0.5, sway: [1.6, 0.25, 0.5], vary: 0.35, out: false },
};

const PASSES: Record<Particles, Pass> = {
  confetti: { way: 1, pace: [20, 32], sway: 2.6, hz: [0.6, 1.3], life: [0, 0] },
  sparks: { way: -1, pace: [7, 16], sway: 1.6, hz: [0.8, 1.8], life: [0, 0] },
  bubbles: { way: -1, pace: [6, 13], sway: 1.4, hz: [0.35, 0.8], life: [0, 0] },
  stars: { way: 0, pace: [0, 0], sway: 0, hz: [0, 0], life: [1.6, 3.2] },
  snow: { way: 1, pace: [3.5, 9], sway: 2.4, hz: [0.12, 0.32], life: [0, 0] },
};

const PARTICLE_COLORS: Record<Particles, readonly string[]> = {
  confetti: ['accent', 'accent2', 'fg', 'muted'],
  sparks: ['accent', 'fg'],
  bubbles: ['fg', 'accent'],
  stars: ['fg', 'accent'],
  snow: ['fg'],
};

/** One particle on one frame. */
interface Spot {
  x: number;
  y: number;
  /** Pixels per second of its own time: the way a spark streaks. */
  vx: number;
  vy: number;
  /** Seconds (at speed 1) since it set off. */
  age: number;
  /** 0 to 1 through its life. */
  u: number;
  /** 0 to 1: how much of it shows, arriving and leaving. */
  show: number;
  /** 0 far to 1 near: its size and pace. */
  z: number;
  /** Its traits, for this life. */
  h: (ch: number) => number;
}

/**
 * Where a thrown particle is `age` seconds after launch, along one axis, with
 * drag `c` and gravity `g`: the exact solution of `v' = g − c·v`, so no frame
 * depends on the frame before it.
 */
function flight(p0: number, v0: number, g: number, c: number, age: number): number {
  const drift = g / c;
  return p0 + drift * age + (v0 - drift) * (1 - Math.exp(-c * age)) / c;
}

/** Its speed along that axis at that age. */
function flightSpeed(v0: number, g: number, c: number, age: number): number {
  const drift = g / c;
  return drift + (v0 - drift) * Math.exp(-c * age);
}

/**
 * Which life a streaming particle is in and how far through it. There are a
 * whole number of lives in the graphic's length, so at the end the stream is
 * as it was at the start; `offset` staggers the particles so the field is
 * always full.
 */
function lifeOf(f: Field, nominal: number, offset: number): { u: number; life: number } {
  if (f.still) return { u: offset, life: 0 };
  const lives = Math.max(1, Math.round((f.seconds * f.speed) / Math.max(0.05, nominal)));
  const v = (f.s * lives) / f.seconds + offset;
  let whole = Math.floor(v);
  let u = v - whole;
  if (u > 1 - 1e-9) {
    u = 0;
    whole += 1;
  }
  return { u, life: ((whole % lives) + lives) % lives };
}

/** How far a burst particle is into its flight, or null before the burst and after it has gone. */
function burstAge(f: Field, nominal: number, still: number): number | null {
  if (f.s < 0) return null;
  const age = f.still ? nominal * still : f.s * f.speed;
  return age < nominal ? age : null;
}

/** A particle thrown from the emitter: a burst, or one life of a fountain. */
function thrown(f: Field, style: Particles, i: number, burst: boolean): Spot | null {
  const p = THROWS[style];
  const nominal = lerp(p.life[0], p.life[1], hash01(f.seed, i, 1));
  let age: number;
  let life = 0;
  if (burst) {
    const a = burstAge(f, nominal, 0.3);
    if (a === null) return null;
    age = a;
  } else {
    const l = lifeOf(f, nominal, (i * GOLDEN + hash01(f.seed, i, 2) * 0.1) % 1);
    age = l.u * nominal;
    life = l.life;
  }
  const h = (ch: number) => hash01(f.seed + life * 131, i, ch);
  const rr = f.spread * Math.sqrt(h(3));
  const ra = h(4) * TAU;
  const x0 = rr * Math.cos(ra);
  const y0 = rr * Math.sin(ra);
  const dir = p.cone < Math.PI ? p.aim + (h(5) * 2 - 1) * p.cone
    : p.out && rr > 0 ? ra + (h(8) - 0.5) * 1.6
    : h(5) * TAU;
  const v = f.k * lerp(p.launch[0], p.launch[1], Math.pow(h(6), p.shape));
  // Channel 10 is the piece's size wherever it is drawn, so the big ones are the heavy (or buoyant) ones.
  const g = f.k * p.gravity * lerp(1 - p.vary, 1 + p.vary, h(10));
  const drag = p.drag * lerp(1 + p.vary, 1 - p.vary, h(22));
  const vx0 = v * Math.cos(dir);
  const vy0 = v * Math.sin(dir);
  const u = age / nominal;
  // The flutter grows as the launch dies away: a piece in free flight does not sway, one drifting down does.
  const w = TAU * lerp(p.sway[1], p.sway[2], h(20));
  const amp = f.k * p.sway[0] * smoothstep(0, 0.7, age);
  const phase = w * age + h(21) * TAU;
  return {
    x: flight(x0, vx0, 0, drag, age) + amp * Math.sin(phase),
    y: flight(y0, vy0, g, drag, age),
    vx: flightSpeed(vx0, 0, drag, age) + amp * w * Math.cos(phase),
    vy: flightSpeed(vy0, g, drag, age),
    age,
    u,
    show: smoothstep(0, 0.04, u) * (1 - smoothstep(0.58, 1, u)),
    z: hash01(f.seed, i, 7),
    h,
  };
}

/** A particle crossing the whole frame (or twinkling in place in it), for a layer with no spread. */
function crossing(f: Field, style: Particles, i: number, burst: boolean): Spot | null {
  const p = PASSES[style];
  const { x0, y0, x1, y1 } = f.frame;
  const fw = Math.max(1, x1 - x0);
  const fh = Math.max(1, y1 - y0);
  const z = hash01(f.seed, i, 1);
  const offset = (i * GOLDEN + hash01(f.seed, i, 2) * 0.1) % 1;

  if (p.way === 0) {
    const nominal = lerp(p.life[0], p.life[1], hash01(f.seed, i, 3));
    let u: number;
    let life = 0;
    if (burst) {
      const a = burstAge(f, nominal, 0.4);
      if (a === null) return null;
      u = a / nominal;
    } else {
      const l = lifeOf(f, nominal, offset);
      u = l.u;
      life = l.life;
    }
    const h = (ch: number) => hash01(f.seed + life * 131, i, ch);
    return {
      x: x0 + fw * h(4), y: y0 + fh * h(5), vx: 0, vy: 0, age: u * nominal, u,
      show: smoothstep(0, 0.12, u) * (1 - smoothstep(0.55, 1, u)), z, h,
    };
  }

  const margin = f.size * 2.5 + f.k * 2;
  const pace = f.k * lerp(p.pace[0], p.pace[1], z);
  const travel = fh + margin * 2;
  let dist: number;
  let age: number;
  let u: number;
  let life = 0;
  if (burst) {
    // Staggered beyond the edge, so the shower comes through over a moment rather than as one line.
    const lead = fh * 0.6 * hash01(f.seed, i, 3);
    const nominal = (travel + lead) / pace;
    const a = burstAge(f, nominal, 0.45);
    if (a === null) return null;
    age = a;
    dist = a * pace - lead;
    u = a / nominal;
  } else {
    const nominal = travel / pace;
    const l = lifeOf(f, nominal, offset);
    u = l.u;
    life = l.life;
    age = u * nominal;
    dist = u * travel;
  }
  const h = (ch: number) => hash01(f.seed + life * 131, i, ch);
  const w = TAU * lerp(p.hz[0], p.hz[1], h(5));
  const amp = f.k * p.sway * lerp(0.5, 1, z);
  const wind = style === 'snow' ? f.k * 1.2 * age : 0;
  const x = x0 + fw * (h(4) * 1.1 - 0.05) + amp * Math.sin(w * age + h(6) * TAU) + wind;
  const y = p.way > 0 ? y0 - margin + dist : y1 + margin - dist;
  // Embers die out on the way up; everything else is simply off the frame at both ends.
  const show = style === 'sparks'
    ? smoothstep(0, 0.06, u) * (1 - smoothstep(lerp(0.15, 0.45, h(7)), lerp(0.4, 0.8, h(7)), u))
    : smoothstep(0, 0.02, u) * (1 - smoothstep(0.98, 1, u));
  return { x, y, vx: amp * w * Math.cos(w * age + h(6) * TAU), vy: p.way * pace, age, u, show, z, h };
}

/**
 * The frame in the layer's own coordinates, for a layer that spreads over it.
 * The current transform says where `paint` put the emitter; without one (a
 * context that cannot report it) the pin says the same, less the layer's turn
 * and scale.
 */
function frameAround(env: Env, layer: ParticlesLayer, pose: Pose, k: number): Box {
  const W = env.width;
  const H = env.height;
  const ctx = env.ctx;
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  if (m && [m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite)) {
    const det = m.a * m.d - m.b * m.c;
    if (Math.abs(det) > 1e-9) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        const dx = px - m.e;
        const dy = py - m.f;
        xs.push((m.d * dx - m.c * dy) / det);
        ys.push((m.a * dy - m.b * dx) / det);
      }
      return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
    }
  }
  const pin = typeof layer.pin === 'string' ? layer.pin : 'mc';
  const col = pin[1];
  const row = pin[0];
  const px = col === 'c' ? W / 2 : (col === 's') !== env.rtl ? 0 : W;
  const py = row === 'm' ? H / 2 : row === 't' ? 0 : H;
  const ox = px + (env.rtl ? -1 : 1) * finite(layer.x, 0) * k + finite(pose.dx, 0) * k;
  const oy = py + finite(layer.y, 0) * k + finite(pose.dy, 0) * k;
  return { x0: -ox, y0: -oy, x1: W - ox, y1: H - oy };
}

/**
 * Draw a particle layer. `paint` has put the origin on the emitter (the
 * layer's pin point) and set its blend and opacity. A burst leaves the
 * emitter together at the layer's start; a stream is always full.
 */
export function drawParticles(env: Env, layer: ParticlesLayer, pose: Pose): void {
  const n = clamp(Math.round(finite(layer.count, 40)), 0, LIMITS.particles);
  const W = finite(env.width, 0);
  const H = finite(env.height, 0);
  if (!n || !(W > 0 && H > 0)) return;
  const ctx = env.ctx;
  const k = finite(env.k, 0) > 0 ? env.k : Math.min(W, H) / 100;
  const style: Particles = layer.style in THROWS ? layer.style : 'confetti';
  const speed = clamp(finite(layer.speed, 1), 0, 3);
  const f: Field = {
    ctx,
    k,
    seed: finite(layer.seed, 1),
    s: finite(env.t, 0) - finite(layer.start, 0),
    speed,
    still: speed < 0.01,
    seconds: Math.max(LIMITS.minSeconds, finite(env.doc?.seconds, 10)),
    size: Math.max(0.2, finite(layer.size, 1.2)) * k,
    spread: Math.max(0, finite(layer.spread, 0)) * k,
    frame: frameAround(env, layer, pose, k),
    colors: colorsOf(env, layer.colors, PARTICLE_COLORS[style]),
    dark: darkGround(env),
    plain: plainBlend(ctx),
    base: clamp01(finite(ctx.globalAlpha, 1)),
  };
  const burst = !!layer.burst;
  const spots: { spot: Spot; i: number }[] = [];
  for (let i = 0; i < n; i++) {
    const spot = f.spread > 0 ? thrown(f, style, i, burst) : crossing(f, style, i, burst);
    if (spot && spot.show > 0.004 && Number.isFinite(spot.x) && Number.isFinite(spot.y)) spots.push({ spot, i });
  }
  if (!spots.length) return;
  ctx.save();
  switch (style) {
    case 'sparks': sparks(f, spots); break;
    case 'bubbles': bubbles(f, spots); break;
    case 'stars': stars(f, spots); break;
    case 'snow': snow(f, spots); break;
    default: confetti(f, spots); break;
  }
  ctx.restore();
}

type Placed = { spot: Spot; i: number }[];

/** Confetti: small rectangles tumbling in the plane and flipping over, the far face a shade darker. */
function confetti(f: Field, spots: Placed): void {
  const { ctx } = f;
  for (const { spot: p, i } of spots) {
    const h = p.h;
    const w = f.size * lerp(0.75, 1.2, h(10));
    const ht = w * lerp(0.42, 0.62, h(11));
    const angle = h(12) * TAU + p.age * lerp(-5, 5, h(13));
    const turn = Math.cos(h(14) * TAU + p.age * lerp(4, 9, h(15)) * (h(16) < 0.5 ? -1 : 1));
    const flip = (turn < 0 ? -1 : 1) * Math.max(0.06, Math.abs(turn));
    const color = f.colors[i % f.colors.length];
    const face = mixColors(color, '#000000', (turn < 0 ? 0.22 : 0) + 0.2 * (1 - Math.abs(turn)));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    ctx.scale(1, flip);
    ctx.globalAlpha = f.base * p.show;
    ctx.fillStyle = face;
    ctx.fillRect(-w / 2, -ht / 2, w, ht);
    ctx.restore();
  }
}

/** Sparks: short bright streaks along their flight, a hot core in a coloured glow, shrinking as they burn out. */
function sparks(f: Field, spots: Placed): void {
  const { ctx } = f;
  if (f.plain && f.dark) ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const { spot: p, i } of spots) {
    const speed = Math.hypot(p.vx, p.vy);
    const len = clamp(speed * 0.05, f.size * 0.5, f.size * 7) * (1 - 0.5 * p.u);
    const ux = speed > 1e-6 ? p.vx / speed : 0;
    const uy = speed > 1e-6 ? p.vy / speed : -1;
    const width = f.size * 0.3 * (1 - 0.6 * p.u);
    const flicker = 0.78 + 0.22 * Math.sin(p.age * 38 + p.h(10) * TAU);
    const a = p.show * flicker;
    const color = f.colors[i % f.colors.length];
    ctx.beginPath();
    ctx.moveTo(p.x - ux * len, p.y - uy * len);
    ctx.lineTo(p.x, p.y);
    ctx.globalAlpha = f.base * clamp01(a * (f.dark ? 0.35 : 0.2));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(0.5, width * 3.2);
    ctx.stroke();
    ctx.globalAlpha = f.base * clamp01(a);
    // White-hot on a dark ground; on a light one a white core would vanish, so the colour itself, a shade deeper.
    ctx.strokeStyle = f.dark ? mixColors(color, '#ffffff', 0.65) : mixColors(color, '#000000', 0.12);
    ctx.lineWidth = Math.max(0.5, width);
    ctx.stroke();
  }
  ctx.globalAlpha = f.base;
}

/** Bubbles: clear circles with a thin rim, a faint body and a curved highlight, swelling a little as they rise. */
function bubbles(f: Field, spots: Placed): void {
  const { ctx } = f;
  ctx.lineCap = 'round';
  for (const { spot: p, i } of spots) {
    const h = p.h;
    const r = f.size * lerp(0.45, 1.25, Math.pow(h(10), 1.4)) * lerp(0.85, 1.1, p.u);
    const color = f.colors[i % f.colors.length];
    const a = p.show;
    ctx.globalAlpha = f.base * clamp01(a);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.fillStyle = rgba(color, f.dark ? 0.08 : 0.1);
    ctx.fill();
    ctx.strokeStyle = f.dark ? rgba(mixColors(color, '#ffffff', 0.3), 0.6) : rgba(color, 0.75);
    ctx.lineWidth = Math.max(0.75, r * 0.08);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.7, Math.PI * 1.08, Math.PI * 1.42);
    ctx.strokeStyle = rgba('#ffffff', 0.7);
    ctx.lineWidth = Math.max(0.75, r * 0.12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x + r * 0.34, p.y + r * 0.36, r * 0.07, 0, TAU);
    ctx.fillStyle = rgba('#ffffff', 0.45);
    ctx.fill();
  }
  ctx.globalAlpha = f.base;
}

/** Stars: four-pointed glints in a soft glow, swelling and dimming as they twinkle. */
function stars(f: Field, spots: Placed): void {
  const { ctx } = f;
  if (f.plain && f.dark) ctx.globalCompositeOperation = 'lighter';
  for (const { spot: p, i } of spots) {
    const h = p.h;
    const twinkle = 0.8 + 0.2 * Math.sin(p.age * lerp(5, 9, h(10)) + h(11) * TAU);
    const r = f.size * lerp(0.55, 1.3, h(12)) * (0.55 + 0.45 * Math.sin(Math.PI * clamp01(p.u))) * twinkle;
    const a = p.show * (0.65 + 0.35 * twinkle);
    const color = f.colors[i % f.colors.length];
    blot(ctx, color, SOFT, 'soft', p.x, p.y, r * (f.dark ? 2.4 : 1.7), a * (f.dark ? 0.45 : 0.22), f.base);
    const spin = h(13) * 0.6 + p.age * 0.35;
    const waist = r * 0.16;
    ctx.beginPath();
    // Four points joined by curves pulled in to a narrow waist: a glint, not a cross.
    for (let q = 0; q < 4; q++) {
      const a0 = spin + (q * Math.PI) / 2;
      const a1 = a0 + Math.PI / 2;
      const mid = a0 + Math.PI / 4;
      if (q === 0) ctx.moveTo(p.x + Math.cos(a0) * r, p.y + Math.sin(a0) * r);
      ctx.quadraticCurveTo(p.x + Math.cos(mid) * waist, p.y + Math.sin(mid) * waist, p.x + Math.cos(a1) * r, p.y + Math.sin(a1) * r);
    }
    ctx.closePath();
    ctx.globalAlpha = f.base * clamp01(a);
    ctx.fillStyle = f.dark ? mixColors(color, '#ffffff', 0.55) : color;
    ctx.fill();
  }
  ctx.globalAlpha = f.base;
}

/** A snowflake's falloff: a soft dot with a body, not only a glow. */
const FLAKE: readonly (readonly [number, number])[] = [[0, 1], [0.45, 0.8], [0.75, 0.3], [1, 0]];

/** Snow: soft dots, nearer ones larger, brighter and faster. */
function snow(f: Field, spots: Placed): void {
  const { ctx } = f;
  // Far flakes first, so near ones pass in front.
  const order = [...spots].sort((p, q) => p.spot.z - q.spot.z || p.i - q.i);
  for (const { spot: p, i } of order) {
    const r = f.size * 0.6 * lerp(0.35, 1, p.z);
    blot(ctx, f.colors[i % f.colors.length], FLAKE, 'flake', p.x, p.y, r, p.show * lerp(0.35, 0.95, p.z), f.base);
  }
}
