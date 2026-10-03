import type { Ctx, Dir4 } from './motiontypes';
import { DIRS, LIMITS } from './motiontypes';
import { clamp, clamp01, easeOf, finite, hash01, smoothstep } from './motionmath';

/**
 * How one scene hands over to the next (pro pass, work package 05). A
 * transition is a picture of the scene that is leaving, a picture of the scene
 * that is arriving, and a progress from 0 to 1; `composite` lays the two on the
 * frame. `motionscene.ts` decides when a transition runs and paints the two
 * pictures; this file only knows how to mix them.
 *
 * ## The rules every transition keeps
 *
 * - **0 is only the old scene, 1 is only the new one.** At either end the
 *   other picture is not drawn at all — not drawn transparent, not drawn
 *   under — so the frame on each side of a transition is exactly the frame a
 *   scene paints on its own. `test/pro-scenes.test.mjs` checks this with the
 *   recording canvas for every kind.
 * - **Monotonic.** Progress is eased by a curve from `TRANSITION_EASES`, the
 *   curves in `motionmath.ts` that never go back: a transition that
 *   overshoots (`back-out`, `spring`, `bounce-out`, `elastic-out`) would show
 *   the old scene again after it had gone, so those are not offered here.
 * - **Logical directions.** `dir` is `start`, `end`, `up` or `down` with the
 *   meanings the layer effects give them (`slide` and `wipe` in
 *   `motionanim.ts`): `start` arrives from the reading side, `end` from the far
 *   side, `up` travels upward (from below), `down` downward. So a push written
 *   once runs right to left in English and left to right in Arabic and
 *   Kurdish, and a clock wipe turns the other way round.
 * - **Pure and seeded.** What looks random (a glitch's slices, where a light
 *   leak sits) comes from `hash01` of the scene's seed and the progress, never
 *   from `Math.random`, so every render of a moment is the same picture.
 * - **Canvas2D only, no `ctx.filter`.** WebKit has none (docs/MOTION.md). The
 *   moves that need a blur or a shader elsewhere are built from offset copies,
 *   clips and composite operations here; the glitch's colour split is an
 *   approximation, said so below.
 * - **Two canvases, reused.** The two pictures live on two offscreen canvases
 *   `motionscene.ts` keeps by size. A transition that shows one picture at a
 *   time (pixelate, glitch, flash) uses the other canvas as its scratch, so no
 *   kind ever needs a third, and nothing is allocated per frame but the odd
 *   gradient.
 *
 * ## Exact mixing
 *
 * Two pictures are not simply drawn one over the other where they meet: an
 * anti-aliased edge drawn twice lets the ground show through a hairline, and
 * a picture with transparent parts would let the old scene show through the
 * new one. The fade and the shaped reveals (iris, clock, blinds) are mixed on
 * the old scene's canvas instead: its pixels are scaled down (`destination-in`
 * with an alpha) or cut out where the new scene goes (`destination-out`), the
 * new scene is kept only there, and the two are added with `lighter`, which
 * sums premultiplied pixels, so every pixel is exactly `old·(1−c) + new·c`. The moving kinds (push, slide, whip) place
 * whole pictures on whole pixels, so their edges never overlap.
 *
 * The numbers — how long a fade is, the zoom-through's 1.2 to 1, which curves
 * suit which move — follow the scene-transition guidance in HyperFrames
 * (`skills/hyperframes-animation/transitions/overview.md`, Apache-2.0); the
 * code is this repository's own (docs/pro/credits/05.md).
 */

// ── the vocabulary ────────────────────────────────────────────────────────

/** Every way a scene can arrive. `cut` is no transition at all, and is how a scene with none is shown. */
export const TRANSITIONS = [
  'cut', 'fade', 'push', 'slide', 'iris', 'clock', 'blinds', 'pixelate', 'zoom', 'whip', 'flash', 'light-leak', 'glitch',
] as const;
export type TransitionKind = (typeof TRANSITIONS)[number];
/** A transition that takes time: every kind but `cut`, which a scene shows by having none. */
export type MovingKind = Exclude<TransitionKind, 'cut'>;

/** The curves a transition may be eased by: those of `EASES` that never turn back (see the header). */
export const TRANSITION_EASES = [
  'linear', 'in', 'out', 'inout', 'soft', 'cubic-out', 'quart-out', 'expo-out', 'expo-inout', 'circ-out', 'snappy',
] as const;
export type TransitionEase = (typeof TRANSITION_EASES)[number];

/** How a scene arrives: the move, how long it takes, and, for a move with a direction, which way. */
export interface Transition {
  kind: MovingKind;
  /** Seconds, `LIMITS.transitionMin` to `LIMITS.transitionMax`, and never longer than either scene beside it. */
  d: number;
  /** For the kinds `directed` says have one. Absent is the kind's own (`end`: from the far side). */
  dir?: Dir4;
  /** Absent is the kind's own curve. */
  ease?: TransitionEase;
}

/** A kind as it is designed: its length, its curve, and its direction when it has one. */
export interface TransitionLook {
  d: number;
  ease: TransitionEase;
  dir?: Dir4;
}

/**
 * Each kind's own length and curve. Calm moves (a fade, a light leak) are
 * slower and eased softly; directional ones (push, blinds) take half a second
 * in and out; the energetic ones (whip, glitch) are quick. A new scene from
 * the strip arrives with the graphic's most used transition, or a fade.
 */
export const TRANSITION_LOOKS: Readonly<Record<MovingKind, TransitionLook>> = {
  fade: { d: 0.5, ease: 'soft' },
  push: { d: 0.5, ease: 'inout', dir: 'end' },
  slide: { d: 0.5, ease: 'quart-out', dir: 'end' },
  iris: { d: 0.6, ease: 'inout' },
  clock: { d: 0.6, ease: 'inout' },
  blinds: { d: 0.5, ease: 'inout', dir: 'end' },
  pixelate: { d: 0.6, ease: 'linear' },
  zoom: { d: 0.45, ease: 'expo-inout' },
  whip: { d: 0.4, ease: 'expo-inout', dir: 'end' },
  flash: { d: 0.5, ease: 'soft' },
  'light-leak': { d: 0.8, ease: 'soft', dir: 'end' },
  glitch: { d: 0.3, ease: 'linear' },
};

/** Whether a direction means anything to a kind. */
export function directed(kind: TransitionKind): boolean {
  return kind !== 'cut' && TRANSITION_LOOKS[kind].dir !== undefined;
}

/** The curve a transition runs on: its own, or its kind's. */
export function easeOfTransition(tr: Pick<Transition, 'kind' | 'ease'>): TransitionEase {
  return tr.ease ?? TRANSITION_LOOKS[tr.kind]?.ease ?? 'inout';
}

/** The direction a transition travels in, for a kind that has one: its own, or its kind's. */
export function dirOfTransition(tr: Pick<Transition, 'kind' | 'dir'>): Dir4 {
  return tr.dir ?? TRANSITION_LOOKS[tr.kind]?.dir ?? 'end';
}

/** How far a transition is, eased: `x` is the share of its time gone, held to 0..1, and so is the answer. */
export function progressOf(tr: Pick<Transition, 'kind' | 'ease'>, x: number): number {
  return clamp01(easeOf(easeOfTransition(tr))(clamp01(finite(x, 0))));
}

// ── reading ───────────────────────────────────────────────────────────────

/** Words a model or an older hand writes for a kind, and the kind each means. */
const KIND_ALIASES: ReadonlyMap<string, TransitionKind> = new Map<string, TransitionKind>([
  ['none', 'cut'], ['hard-cut', 'cut'], ['crossfade', 'fade'], ['cross-fade', 'fade'], ['dissolve', 'fade'],
  ['push-slide', 'push'], ['slide-over', 'slide'], ['cover', 'slide'], ['circle', 'iris'], ['circle-iris', 'iris'],
  ['clock-wipe', 'clock'], ['shutter', 'blinds'], ['pixel', 'pixelate'], ['pixels', 'pixelate'], ['zoom-through', 'zoom'],
  ['whip-pan', 'whip'], ['flash-through-white', 'flash'], ['white', 'flash'], ['leak', 'light-leak'],
]);

/** A kind from its word or one of its aliases (`crossfade`, `zoom-through`…), whatever its case, with spaces or underscores for hyphens. */
export function transitionKindOf(x: unknown): TransitionKind | undefined {
  if (typeof x !== 'string' || x.length > 40) return undefined;
  const s = x.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if ((TRANSITIONS as readonly string[]).includes(s)) return s as TransitionKind;
  return KIND_ALIASES.get(s);
}

function wordOf<T extends string>(x: unknown, list: readonly T[]): T | undefined {
  if (typeof x !== 'string' || x.length > 40) return undefined;
  const s = x.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? (s as T) : undefined;
}

/** A field that is the object's own: a getter that throws, or a name every object inherits, is not there. */
function ownField(o: object, k: string): unknown {
  try {
    return Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined;
  } catch {
    return undefined;
  }
}

/** A number, or a plain decimal string of one ("0.4"); `fallback` otherwise. */
function numberOf(x: unknown, fallback: number): number {
  if (typeof x === 'number') return Number.isFinite(x) ? x : fallback;
  if (typeof x === 'string' && x.length <= 40 && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(x.trim())) {
    const n = Number(x.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/**
 * A transition, or undefined for a cut. A bare word (`"fade"`) is that kind as
 * designed; an object names its `kind` (or `fx`), and may give `d` (or
 * `duration`), `dir` and `ease`. `d` is held to 0.15 s … `maxD`, where the
 * caller passes the most the two scenes beside it allow (`LIMITS.transitionMax`
 * at most); the kind's own length when not given. `dir` is kept only for a kind
 * that has one, and only as one of `DIRS` (never `left` or `right`, which swap
 * in Arabic); `ease` only as one of `TRANSITION_EASES`. Anything else is left
 * out, so the kind's own applies. Never throws; reading the result again
 * changes nothing.
 */
export function readTransition(x: unknown, maxD: number = LIMITS.transitionMax): Transition | undefined {
  let o: object | null = null;
  try {
    o = typeof x === 'string' ? { kind: x } : x !== null && typeof x === 'object' && !Array.isArray(x) ? x : null;
  } catch {
    o = null;
  }
  if (!o) return undefined;
  const kind = transitionKindOf(ownField(o, 'kind') ?? ownField(o, 'fx') ?? ownField(o, 'type'));
  if (!kind || kind === 'cut') return undefined;
  const look = TRANSITION_LOOKS[kind];
  const hi = clamp(finite(maxD, LIMITS.transitionMax), LIMITS.transitionMin, LIMITS.transitionMax);
  const dir = look.dir !== undefined ? wordOf(ownField(o, 'dir'), DIRS) : undefined;
  const ease = wordOf(ownField(o, 'ease'), TRANSITION_EASES);
  // `dir` is the way a transition travels, not the document's direction; it is set through the literal because
  // rtl.test.mjs keeps every assignment to a `dir` property in rtl.ts (motionread.ts's `readAnim` does the same).
  return {
    kind,
    d: clamp(numberOf(ownField(o, 'd') ?? ownField(o, 'duration'), look.d), LIMITS.transitionMin, hi) || 0,
    ...(dir ? { dir } : {}),
    ...(ease ? { ease } : {}),
  };
}

// ── mixing two pictures ───────────────────────────────────────────────────

/** A picture of one scene: an offscreen canvas the size of the frame, and its context. */
export interface Picture {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: Ctx;
}

/**
 * Which pictures a kind shows at progress `p`: `a` the old scene, `b` the new,
 * or both. At either end only one; pixelate, glitch and flash show one at a
 * time all the way through, swapping at the middle, so the other is never
 * painted (and its canvas is free to be their scratch).
 */
export function needsOf(kind: TransitionKind, p: number): 'a' | 'b' | 'both' {
  if (!(p > 0)) return 'a';
  if (p >= 1) return 'b';
  if (kind === 'pixelate' || kind === 'glitch' || kind === 'flash' || kind === 'cut') return p < 0.5 ? 'a' : 'b';
  return 'both';
}

/**
 * The way the new scene travels, as a physical unit vector: `start` arrives
 * from the reading side (from the left in English, so it moves right), `end`
 * from the far side, `up` moves up, `down` moves down.
 */
export function travelOf(dir: Dir4, rtl: boolean): [number, number] {
  if (dir === 'up') return [0, -1];
  if (dir === 'down') return [0, 1];
  const toEnd = rtl ? -1 : 1;
  return [dir === 'start' ? toEnd : -toEnd, 0];
}

/** The state a composite starts from, whatever the context was last used for. */
function calm(ctx: Ctx): void {
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'rgba(0, 0, 0, 0)';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.imageSmoothingEnabled = true;
}

/** Lay a whole picture at (x, y), scaled about the frame's centre by `s`, at `alpha`. Nothing is drawn when it would not be seen. */
function lay(ctx: Ctx, pic: Picture, W: number, H: number, x = 0, y = 0, s = 1, alpha = 1): void {
  if (!(alpha > 0.0005) || !(s > 0)) return;
  const w = W * s;
  const h = H * s;
  const left = (W - w) / 2 + x;
  const top = (H - h) / 2 + y;
  if (left >= W || top >= H || left + w <= 0 || top + h <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  if (s === 1) ctx.drawImage(pic.canvas, left, top);
  else ctx.drawImage(pic.canvas, left, top, w, h);
  ctx.globalAlpha = 1;
}

/**
 * The fade, mixed exactly on the old scene's canvas: its pixels scaled by
 * `1 − p` (`destination-in` with that alpha), the new scene's added at `p`
 * with `lighter`. Correct for transparent pictures as well as opaque ones.
 */
function mixFade(a: Picture, b: Picture, W: number, H: number, p: number): void {
  const c = a.ctx;
  c.save();
  try {
    c.setTransform(1, 0, 0, 1, 0, 0);
    calm(c);
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = `rgba(0, 0, 0, ${(1 - p).toFixed(4)})`;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = clamp01(p);
    c.drawImage(b.canvas, 0, 0);
  } finally {
    c.restore();
  }
}

/**
 * A shaped reveal, mixed exactly on the old scene's canvas. The same shape is
 * filled on both canvases, so its anti-aliased edge has the same coverage `c`
 * on each: the new scene is kept only inside it (`destination-in`, which in
 * WebKit and Chromium alike clears everything the shape does not cover; its
 * canvas is painted again every frame), the shape is cut out of the old scene
 * (`destination-out`), and the two are added (`lighter`). An edge pixel is so
 * exactly `old·(1−c) + new·c` and never lets the ground through. Two other
 * ways were measured in WebKit and left a faint ring round an iris: a clip in
 * place of the second fill (edges up to 4% see-through), and cutting the new
 * scene with the frame-less-the-shape filled even-odd (up to 18%). The caller
 * only mixes a shape that has area (`SHAPE_MIN`): an engine may skip filling an
 * empty path, and then the new scene would be added whole over the old.
 */
function mixShape(a: Picture, b: Picture, shape: (c: Ctx) => void): void {
  for (const [pic, op] of [[b, 'destination-in'], [a, 'destination-out']] as const) {
    const c = pic.ctx;
    c.save();
    try {
      c.setTransform(1, 0, 0, 1, 0, 0);
      calm(c);
      c.beginPath();
      shape(c);
      c.globalCompositeOperation = op;
      c.fillStyle = '#000000';
      c.fill();
    } finally {
      c.restore();
    }
  }
  const c = a.ctx;
  c.save();
  try {
    c.setTransform(1, 0, 0, 1, 0, 0);
    calm(c);
    c.globalCompositeOperation = 'lighter';
    c.drawImage(b.canvas, 0, 0);
  } finally {
    c.restore();
  }
}

/** Pixels a shaped reveal must reach (an iris's radius, a clock's rim, a bar's width) before it is mixed at all. */
const SHAPE_MIN = 0.5;

/** Bars of a blinds transition across the frame. A bar is cut at whole pixels, so neighbours never overlap. */
const BLINDS = 8;

/**
 * The bars of `blinds` at `p`, handed to `bar` as rectangles: each of `BLINDS`
 * strips across the way of travel is filled from its leading edge, `p` of the
 * way. How many there are; none until a bar is a whole pixel wide.
 */
function blindsBars(W: number, H: number, p: number, vx: number, vy: number, bar?: (x: number, y: number, w: number, h: number) => void): number {
  const across = vx !== 0;
  const size = across ? W : H;
  const forward = (across ? vx : vy) > 0;
  const step = size / BLINDS;
  let n = 0;
  for (let i = 0; i < BLINDS; i++) {
    const from = forward ? i * step : (i + 1) * step - p * step;
    const lo = Math.round(from);
    const hi = Math.round(from + p * step);
    if (hi <= lo) continue;
    n++;
    if (across) bar?.(lo, 0, hi - lo, H);
    else bar?.(0, lo, W, hi - lo);
  }
  return n;
}

/** Copies a whip pan's smear is drawn with: a running mean of them is the blur, made of the one thing every engine has, `drawImage`. */
const WHIP_COPIES = 6;
/** How far the smear reaches at the fastest moment, as a share of the frame. */
const WHIP_REACH = 0.12;

/**
 * The old scene and the new side by side, moved along the way of travel by
 * `p` of the frame, on whole pixels. `smear` adds copies trailing behind, each
 * laid at the running mean's weight, `1/(k+1)`: the whip pan's blur.
 */
function pushPair(ctx: Ctx, a: Picture, b: Picture, W: number, H: number, p: number, vx: number, vy: number, smear: number): void {
  const ax = Math.round(vx * p * W);
  const ay = Math.round(vy * p * H);
  const reach = vx !== 0 ? Math.abs(ax) : Math.abs(ay);
  const size = vx !== 0 ? W : H;
  // The trail never reaches past where either picture covers the frame, so every copy still fills it.
  const far = Math.max(0, Math.min(smear, reach, size - reach));
  const copies = far >= 1 ? WHIP_COPIES : 1;
  for (let k = 0; k < copies; k++) {
    const back = copies > 1 ? Math.round((far * k) / (copies - 1)) : 0;
    const x = ax - vx * back;
    const y = ay - vy * back;
    const weight = 1 / (k + 1);
    lay(ctx, a, W, H, x, y, 1, weight);
    lay(ctx, b, W, H, x - vx * W, y - vy * H, 1, weight);
  }
}

/** The largest block a pixelate reaches, as a share of the frame's short side: about two dozen blocks across it. */
const PIXEL_BLOCKS = 24;

/**
 * Pixelate: the old scene breaks into blocks that grow to their largest at the
 * middle, where the new scene takes over and resolves. The picture is drawn
 * small on the scratch canvas (smoothed, so each block is the colour of what
 * it covers) and back up without smoothing.
 */
function pixelate(ctx: Ctx, pic: Picture, scratch: Picture, W: number, H: number, p: number): void {
  const f = p < 0.5 ? p / 0.5 : (1 - p) / 0.5;
  const most = Math.max(2, Math.round(Math.min(W, H) / PIXEL_BLOCKS));
  const block = 1 + Math.round(clamp01(f) * (most - 1));
  if (block <= 1) {
    lay(ctx, pic, W, H);
    return;
  }
  const sw = Math.max(1, Math.ceil(W / block));
  const sh = Math.max(1, Math.ceil(H / block));
  const s = scratch.ctx;
  s.save();
  try {
    s.setTransform(1, 0, 0, 1, 0, 0);
    calm(s);
    s.clearRect(0, 0, sw + 1, sh + 1);
    s.drawImage(pic.canvas, 0, 0, W, H, 0, 0, sw, sh);
  } finally {
    s.restore();
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch.canvas, 0, 0, sw, sh, 0, 0, sw * block, sh * block);
  ctx.imageSmoothingEnabled = true;
}

/** How many times a glitch deals its slices again over the whole transition. */
const GLITCH_STEPS = 12;

/**
 * The picture tinted one colour on the scratch canvas: the picture's own
 * shape filled with `tint` (`source-atop` over a copy of it), then the
 * picture multiplied into that, so each pixel keeps only the tint's channels
 * of its colour and nothing is painted where the picture is empty.
 *
 * It never draws a picture with `destination-in` (nor `source-in`,
 * `source-out` or `destination-atop`): WebKit draws an image under one of
 * those through a temporary buffer the size of the whole canvas. Measured in
 * the app's engine, the earlier tint — a multiplied fill cut back to the
 * picture with a `destination-in` draw, twice a frame — took the web content
 * process from about 110 to 250 MB while a glitch played at 1080p (2.5 GB
 * when 150 frames were painted without a break) and cost 5 ms a frame more;
 * this one costs what any other transition does (F3, `docs/pro/f3-perf.md`).
 * A fill under those operations does not grow it: the fade and the shaped
 * reveals use them only with fills.
 */
function tinted(scratch: Picture, pic: Picture, W: number, H: number, tint: string): void {
  const s = scratch.ctx;
  s.save();
  try {
    s.setTransform(1, 0, 0, 1, 0, 0);
    calm(s);
    s.clearRect(0, 0, W, H);
    s.drawImage(pic.canvas, 0, 0);
    s.globalCompositeOperation = 'source-atop';
    s.fillStyle = tint;
    s.fillRect(0, 0, W, H);
    s.globalCompositeOperation = 'multiply';
    s.drawImage(pic.canvas, 0, 0);
  } finally {
    s.restore();
  }
}

/**
 * Glitch: the picture dealt in horizontal slices, some knocked sideways, and a
 * red and a cyan copy laid a few pixels either side with `lighter`. That colour
 * split is an approximation — a true one would take each channel from its own
 * place, which needs per-pixel work this file does not do — and reads as one.
 * It is strongest at the middle, where the old scene gives way to the new.
 */
function glitch(ctx: Ctx, pic: Picture, scratch: Picture, W: number, H: number, p: number, seed: number): void {
  const strength = Math.sin(Math.PI * clamp01(p));
  if (strength < 0.02) {
    lay(ctx, pic, W, H);
    return;
  }
  const step = Math.min(GLITCH_STEPS - 1, Math.floor(p * GLITCH_STEPS));
  let y = 0;
  for (let k = 0; y < H && k < 64; k++) {
    const h = Math.min(H - y, Math.max(1, Math.round(H * (0.03 + 0.14 * hash01(seed, step, k)))));
    const knock = hash01(seed + 1, step, k);
    const dx = knock < 0.45 ? 0 : Math.round((hash01(seed + 2, step, k) - 0.5) * 2 * strength * 0.06 * W);
    ctx.drawImage(pic.canvas, 0, y, W, h, dx, y, W, h);
    // What a knocked slice leaves bare at one edge comes round from the other, so the frame stays covered.
    if (dx !== 0) ctx.drawImage(pic.canvas, 0, y, W, h, dx - Math.sign(dx) * W, y, W, h);
    y += h;
  }
  const shift = Math.max(1, Math.round(strength * 0.012 * W));
  ctx.globalCompositeOperation = 'lighter';
  tinted(scratch, pic, W, H, '#ff0000');
  ctx.globalAlpha = 0.35 * strength;
  ctx.drawImage(scratch.canvas, shift, 0);
  tinted(scratch, pic, W, H, '#00ffff');
  ctx.drawImage(scratch.canvas, -shift, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Flash through white: the old scene whitens to its brightest at the middle,
 * the new one comes out of it. The white is laid `source-atop`, only over what
 * is drawn, so a graphic on a transparent ground flashes its own shapes and
 * not the empty frame.
 */
function flash(ctx: Ctx, pic: Picture, W: number, H: number, p: number): void {
  lay(ctx, pic, W, H);
  const white = clamp01(p < 0.5 ? p / 0.5 : (1 - p) / 0.5);
  if (!(white > 0)) return;
  ctx.globalCompositeOperation = 'source-atop';
  ctx.globalAlpha = white;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * A light leak: a fade with a warm glow washing across the frame along the
 * way of travel, brightest at the middle (`screen`, so it only ever lightens).
 * Where it crosses is moved a little by the scene's seed, so two leaks in one
 * graphic do not look the same.
 */
function lightLeak(ctx: Ctx, W: number, H: number, p: number, vx: number, vy: number, seed: number): void {
  const glow = Math.sin(Math.PI * clamp01(p));
  if (!(glow > 0.002)) return;
  const big = Math.max(W, H);
  const side = 0.25 + 0.5 * hash01(seed, 7);
  const along = -0.25 + 1.5 * p;
  const cx = vx !== 0 ? (vx > 0 ? along : 1 - along) * W : side * W;
  const cy = vx !== 0 ? side * H : (vy > 0 ? along : 1 - along) * H;
  ctx.globalCompositeOperation = 'screen';
  const warm = ctx.createRadialGradient(cx, cy, 0, cx, cy, big * 0.75);
  warm.addColorStop(0, `rgba(255, 176, 86, ${(0.85 * glow).toFixed(4)})`);
  warm.addColorStop(0.55, `rgba(255, 112, 64, ${(0.4 * glow).toFixed(4)})`);
  warm.addColorStop(1, 'rgba(255, 112, 64, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, W, H);
  const lag = along - 0.2;
  const hx = vx !== 0 ? (vx > 0 ? lag : 1 - lag) * W : (1 - side) * W;
  const hy = vx !== 0 ? (1 - side) * H : (vy > 0 ? lag : 1 - lag) * H;
  const hot = ctx.createRadialGradient(hx, hy, 0, hx, hy, big * 0.4);
  hot.addColorStop(0, `rgba(255, 236, 190, ${(0.6 * glow).toFixed(4)})`);
  hot.addColorStop(1, 'rgba(255, 236, 190, 0)');
  ctx.fillStyle = hot;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Lay a transition on `ctx` at eased progress `p`: `a` is the old scene's
 * picture, `b` the new one's, both the frame's size (`w` × `h` pixels) and
 * already painted where `needsOf` says they are needed. `ctx` is drawn on with
 * the identity transform and is left in the state it was handed in (every
 * change is inside a save). The fade and the shaped reveals are mixed on
 * `a`'s canvas, so `a` holds the mix afterwards (and a shaped reveal leaves
 * `b` cut to its shape); pixelate and glitch use the canvas of the picture
 * they are not showing as scratch. Both pictures are painted again for every
 * frame, so neither is expected to survive one.
 */
export function composite(
  ctx: Ctx, kind: TransitionKind, p: number, a: Picture, b: Picture, w: number, h: number, dir: Dir4, rtl: boolean, seed: number,
): void {
  const W = Math.max(1, Math.round(finite(w, 1)));
  const H = Math.max(1, Math.round(finite(h, 1)));
  const at = clamp01(finite(p, 0));
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    calm(ctx);
    if (at <= 0 || kind === 'cut') {
      lay(ctx, at >= 1 ? b : a, W, H);
      return;
    }
    if (at >= 1) {
      lay(ctx, b, W, H);
      return;
    }
    const [vx, vy] = travelOf(DIRS.includes(dir) ? dir : 'end', rtl);
    switch (kind) {
      case 'fade':
        mixFade(a, b, W, H, at);
        lay(ctx, a, W, H);
        return;
      case 'light-leak':
        mixFade(a, b, W, H, at);
        lay(ctx, a, W, H);
        lightLeak(ctx, W, H, at, vx, vy, seed);
        return;
      case 'iris': {
        const r = at * (Math.hypot(W, H) / 2 + 1);
        if (r >= SHAPE_MIN) mixShape(a, b, (c) => c.arc(W / 2, H / 2, r, 0, Math.PI * 2));
        lay(ctx, a, W, H);
        return;
      }
      case 'clock': {
        // From twelve o'clock, clockwise in a left-to-right graphic and the other way in a right-to-left one.
        const r = Math.hypot(W, H) / 2 + 1;
        const from = -Math.PI / 2;
        const to = from + (rtl ? -1 : 1) * at * Math.PI * 2;
        if (at * Math.PI * 2 * r >= SHAPE_MIN) {
          mixShape(a, b, (c) => {
            c.moveTo(W / 2, H / 2);
            c.arc(W / 2, H / 2, r, from, to, rtl);
            c.closePath();
          });
        }
        lay(ctx, a, W, H);
        return;
      }
      case 'blinds':
        if (blindsBars(W, H, at, vx, vy) > 0) mixShape(a, b, (c) => blindsBars(W, H, at, vx, vy, (x, y, w, h) => c.rect(x, y, w, h)));
        lay(ctx, a, W, H);
        return;
      case 'push':
        pushPair(ctx, a, b, W, H, at, vx, vy, 0);
        return;
      case 'whip': {
        const size = vx !== 0 ? W : H;
        pushPair(ctx, a, b, W, H, at, vx, vy, WHIP_REACH * size * 4 * at * (1 - at));
        return;
      }
      case 'slide': {
        // The new scene slides over the old, which stays still and is drawn only where it is not yet covered.
        const bx = Math.round(-vx * (1 - at) * W);
        const by = Math.round(-vy * (1 - at) * H);
        const x0 = vx > 0 ? bx + W : 0;
        const x1 = vx < 0 ? bx : W;
        const y0 = vy > 0 ? by + H : 0;
        const y1 = vy < 0 ? by : H;
        if (x1 > x0 && y1 > y0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x0, y0, x1 - x0, y1 - y0);
          ctx.clip();
          lay(ctx, a, W, H);
          ctx.restore();
        }
        lay(ctx, b, W, H, bx, by);
        return;
      }
      case 'zoom': {
        // Through the old scene into the new: the old one grows toward the viewer and fades; the new one settles
        // from close up. The new one is whole before the old begins to fade, and both are at least the frame's
        // size, so an opaque graphic never shows through to nothing.
        lay(ctx, b, W, H, 0, 0, 1.2 - 0.2 * at, smoothstep(0, 0.2, at));
        lay(ctx, a, W, H, 0, 0, 1 + 0.3 * at, 1 - smoothstep(0.2, 0.75, at));
        return;
      }
      case 'pixelate':
        if (at < 0.5) pixelate(ctx, a, b, W, H, at);
        else pixelate(ctx, b, a, W, H, at);
        return;
      case 'glitch':
        if (at < 0.5) glitch(ctx, a, b, W, H, at, seed);
        else glitch(ctx, b, a, W, H, at, seed);
        return;
      case 'flash':
        flash(ctx, at < 0.5 ? a : b, W, H, at);
        return;
    }
  } finally {
    ctx.restore();
  }
}
