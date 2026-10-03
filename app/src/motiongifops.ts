/**
 * A motion graphic as a looping GIF: painted frame by frame at the GIF's own
 * rate, its colours chosen from frames across the whole animation, written by
 * `motiongif.ts`, and kept under a size a chat or a page will take.
 *
 * ## What is painted
 *
 * The same `paint` as the stage, the MP4 and the PNG, at each frame's own time
 * `i / fps` — never the wall clock — so the GIF is the preview, at fewer
 * frames. A GIF runs at **15 frames a second** unless asked otherwise, never
 * more than 20: a GIF's delays are hundredths of a second, browsers slow down
 * anything under two of them, and every frame is paid for in bytes. Its
 * **longest side is 720 pixels** unless asked otherwise, never more than 1080:
 * the long side, not the width, so a tall story is not twice the file of a
 * wide title. And it is **at most 15 seconds**: a longer graphic is cut there,
 * and the result says so (`trimmed`).
 *
 * ## Two passes
 *
 * One palette serves the whole animation (why: `motiongif.ts`), so it is
 * chosen first, from up to 24 frames spread evenly from the first to the last;
 * then every frame is painted again and written. The sample costs a few
 * frames' painting, and it is what keeps a background from flickering.
 *
 * ## Under 25 MB
 *
 * A GIF is far larger than an MP4 of the same picture, and chats and mail
 * refuse large ones. When a GIF comes out over `maxBytes` (25 MB unless asked
 * otherwise) it is made again smaller, giving up, in this order, what is
 * missed least: **colours** (256, then 128, then 64), then **size** (a fifth
 * off the long side at a time, down to 240 pixels), then **frames a second**
 * (12, 10, 8, then 6). `smaller` predicts how far down the ladder the measured
 * size needs to go, so one more attempt is usually enough, and an attempt that
 * passes the ceiling while it is still being written stops there rather than
 * finishing a file that will be thrown away. What was given up comes back in
 * `reduced`, for the panel to say in words; a GIF still over the ceiling at
 * the bottom of the ladder comes back with `over`, not as an error, because a
 * file a little large is better than none.
 *
 * ## Transparency
 *
 * A graphic with no backdrop (or a see-through one) keeps its transparency
 * when `transparent` is not false: a pixel under half alpha is see-through,
 * the rest opaque — a GIF has no soft edges. Otherwise the frames are drawn
 * over the graphic's own background colour, from a copy; the graphic itself is
 * never changed.
 *
 * ## Progress and Cancel
 *
 * `onProgress(done, total, attempt)` after every painted frame, sample frames
 * included; `attempt` is 2 or more while it is being made smaller. Aborting
 * `signal` stops between frames with an `AbortError`, as an MP4 does. The loop
 * yields to the event loop every few frames by a message rather than a timer,
 * for `motionencode.ts`'s reason: WebKit stretches timers to a second in a
 * window that is covered, which is where a window sits during a long export.
 */

import { paint, preload } from './motiondraw';
import { ColourCounter, GifWriter, MIN_DELAY, type Dither } from './motiongif';
import { sizeOf } from './motiontypes';
import type { Ctx, Format, Motion } from './motiontypes';

// ── what a GIF may be ─────────────────────────────────────────────────────

/** The defaults and the ceilings, in one place. */
export const GIF = {
  /** Frames a second: 15 unless asked, at most 20, and never below 6 when made smaller. */
  fps: 15,
  maxFps: 20,
  minFps: 6,
  /** The long side in pixels: 720 unless asked, at most 1080, and never below 240 when made smaller. */
  side: 720,
  maxSide: 1080,
  minSide: 240,
  /** The longest GIF, in seconds. */
  seconds: 15,
  /** The size a GIF is kept under, in bytes. */
  maxBytes: 25_000_000,
  /** Frames painted to choose the colours from. */
  samples: 24,
} as const;

/** The long sides a person can choose. */
export const GIF_SIDES: readonly number[] = [480, 720, 1080];
/** The rates a person can choose. */
export const GIF_RATES: readonly number[] = [10, 15, 20];
/** The palette sizes, largest first: the first rung of the ladder. */
const COLOURS = [256, 128, 64] as const;
const RATES_DOWN = [12, 10, 8, 6] as const;

const finite = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * A shape's GIF size for a long side: the long side as asked (within the
 * limits), the short side in the shape's ratio, rounded. A GIF has no even
 * sizes rule (H.264's), so nothing is lost to it.
 */
export function gifSizeFor(format: Format, side: number): { width: number; height: number } {
  const f = sizeOf(format);
  const long = Math.round(Math.min(GIF.maxSide, Math.max(16, finite(side, GIF.side))));
  if (f.width >= f.height) return { width: long, height: Math.max(1, Math.round((long * f.height) / f.width)) };
  return { width: Math.max(1, Math.round((long * f.width) / f.height)), height: long };
}

/** What a GIF is made at: its long side, its rate and its palette size (256, 128 or 64, one index of which is transparency). */
export interface GifPlan {
  side: number;
  fps: number;
  colors: number;
}

/**
 * A plan from what was asked, inside the limits. A side smaller than the
 * ladder's floor may be asked for (a sticker-sized GIF); the floor is only how
 * far making it smaller goes on its own.
 */
export function gifPlan(o: { side?: number; fps?: number; colors?: number } = {}): GifPlan {
  const side = Math.round(Math.min(GIF.maxSide, Math.max(16, finite(o.side, GIF.side))));
  const fps = Math.round(Math.min(GIF.maxFps, Math.max(1, finite(o.fps, GIF.fps))));
  const colors = Math.round(Math.min(256, Math.max(2, finite(o.colors, 256))));
  return { side, fps, colors };
}

/**
 * The frames of a GIF: how many, and how long it runs (at most `GIF.seconds`).
 * Frame `i` starts at `i / fps`; the last runs to the end, so it may be
 * shorter than the rest — but never shorter than the 2 hundredths a browser
 * shows as written (`MIN_DELAY`): such a sliver is joined to the frame before,
 * or the GIF would run a hundredth or two long.
 */
export function gifFrames(seconds: number, fps: number): { frames: number; seconds: number; trimmed: boolean } {
  const len = Math.max(0.1, finite(seconds, 1));
  const kept = Math.min(len, GIF.seconds);
  const rate = Math.max(1, finite(fps, GIF.fps));
  let frames = Math.max(1, Math.ceil(kept * rate - 1e-9));
  if (frames > 1 && kept - (frames - 1) / rate < MIN_DELAY / 100 - 1e-9) frames--;
  return { frames, seconds: kept, trimmed: len > GIF.seconds + 1e-9 };
}

/**
 * The next plan for a GIF that came out `measured` bytes against a ceiling
 * of `cap`: down the ladder — colours, then size, then frames a second — as
 * many rungs as the prediction says are needed to land under nine tenths of
 * the ceiling, and at least one. Null when there is no rung left.
 *
 * The prediction is rough, and only has to point the right way: halving the
 * palette saves about an eighth (shorter codes, longer runs), a smaller side
 * saves its area, and fewer frames save their share of the changes.
 */
export function smaller(p: GifPlan, measured: number, cap: number): GifPlan | null {
  const next = { ...p };
  let predicted = Math.max(0, finite(measured, 0));
  const target = 0.9 * Math.max(1, finite(cap, GIF.maxBytes));
  let steps = 0;
  while (steps === 0 || predicted > target) {
    const fewer = COLOURS.find((c) => c < next.colors);
    if (fewer !== undefined) {
      predicted *= 0.88;
      next.colors = fewer;
    } else if (next.side > GIF.minSide) {
      const side = Math.max(GIF.minSide, Math.round((next.side * 0.8) / 8) * 8);
      predicted *= (side / next.side) ** 2;
      next.side = side;
    } else {
      const rate = RATES_DOWN.find((r) => r < next.fps);
      if (rate === undefined) return steps ? next : null;
      predicted *= rate / next.fps;
      next.fps = rate;
    }
    steps++;
  }
  return next;
}

/** One thing a GIF gave up to fit: from what to what. */
export interface GifCut {
  what: 'colors' | 'size' | 'fps';
  from: number;
  to: number;
}

/** What was given up between two plans, in the ladder's order. */
export function cutsBetween(from: GifPlan, to: GifPlan): GifCut[] {
  const out: GifCut[] = [];
  if (to.colors !== from.colors) out.push({ what: 'colors', from: from.colors, to: to.colors });
  if (to.side !== from.side) out.push({ what: 'size', from: from.side, to: to.side });
  if (to.fps !== from.fps) out.push({ what: 'fps', from: from.fps, to: to.fps });
  return out;
}

/**
 * About how many bytes a GIF will be, before it is made: the first frame
 * whole, then what changes. A moving backdrop or particles change most of the
 * frame every frame; anything else changes a part of it. Rough by nature —
 * the panel says "about", and the ceiling is what is promised. Measured in
 * the app's WebKit at 15 a second: an aurora title 0.22 bytes a pixel a
 * frame, a looping background 0.19, an intro 0.10, a chart over a grid 0.06,
 * a lower third with no backdrop next to nothing — so 0.2 for a moving
 * backdrop, which errs high, and 0.02 without one.
 */
export function estimateGifBytes(width: number, height: number, frames: number, moving: boolean): number {
  const px = Math.max(1, width * height);
  const n = Math.max(1, Math.round(finite(frames, 1)));
  return Math.round(px * 0.3 + px * (moving ? 0.2 : 0.02) * (n - 1));
}

/** Whether a graphic has something that moves over the whole frame for as long as it is on: a backdrop layer or particles. */
export function movesEverywhere(m: Pick<Motion, 'layers'>): boolean {
  return (m.layers ?? []).some((l) => !l.hidden && (l.kind === 'backdrop' || l.kind === 'particles'));
}

// ── rendering ─────────────────────────────────────────────────────────────

/** What rendering uses, so a test can hand in its own. The defaults are the real ones. */
export interface GifDeps {
  paint: typeof paint;
  preload: typeof preload;
  canvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
  /** One turn of the event loop. */
  tick: () => Promise<void>;
}

export interface GifOptions {
  /** The long side in pixels (`GIF.side`). */
  side?: number;
  /** Frames a second (`GIF.fps`). */
  fps?: number;
  /** Palette size, 2 to 256 (256). */
  colors?: number;
  dither?: Dither;
  /** Keep a transparent graphic's transparency (true). */
  transparent?: boolean;
  /** The ceiling in bytes (`GIF.maxBytes`). */
  maxBytes?: number;
  onProgress?: (done: number, total: number, attempt: number) => void;
  signal?: AbortSignal;
}

/** A GIF, and what it was made at. */
export interface GifMade {
  bytes: Uint8Array;
  width: number;
  height: number;
  fps: number;
  colors: number;
  /** How long it runs. */
  seconds: number;
  /** Frames in the file, after frames that were the same were joined. */
  frames: number;
  /** The graphic was longer than a GIF may be, and only its first `GIF.seconds` are in it. */
  trimmed: boolean;
  /** Whether it keeps transparency. */
  transparent: boolean;
  /** What was given up to fit under the ceiling. */
  reduced: GifCut[];
  /** Still over the ceiling at the bottom of the ladder. */
  over: boolean;
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  throw new Error('motion:no-canvas');
}

/** A turn of the event loop by a message, which no window throttles (motionencode.ts says why). */
function tick(): Promise<void> {
  if (typeof MessageChannel !== 'function') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function depsOf(d: Partial<GifDeps>): GifDeps {
  return { paint: d.paint ?? paint, preload: d.preload ?? preload, canvas: d.canvas ?? makeCanvas, tick: d.tick ?? tick };
}

const isOffscreen = (c: HTMLCanvasElement | OffscreenCanvas): c is OffscreenCanvas =>
  typeof (c as OffscreenCanvas).convertToBlob === 'function';

/**
 * A context the frames are read back from, with alpha only when the GIF keeps
 * transparency. Not `willReadFrequently`, though every frame is read: that
 * hint moves the canvas off the GPU, and in the app's WebKit painting there
 * costs more than reading back from the GPU saves — a six-second title over
 * an aurora took 1.7 s with the hint and 1.1 s without, a 1080-pixel intro
 * 3.4 s against 1.5 s (measured 2026-10-03).
 */
function context2d(canvas: HTMLCanvasElement | OffscreenCanvas, alpha: boolean): Ctx {
  const ctx = isOffscreen(canvas) ? canvas.getContext('2d', { alpha }) : canvas.getContext('2d', { alpha });
  if (!ctx) throw new Error('motion:no-canvas');
  return ctx;
}

/** `motionexportops.ts`'s rule: no backdrop, or a colour that is not opaque, lets what is behind through. */
export function seeThrough(backdrop: Motion['backdrop']): boolean {
  return backdrop === null || (typeof backdrop === 'string' && /^#[0-9a-f]{8}$/i.test(backdrop) && !/ff$/i.test(backdrop));
}

function aborted(): Error {
  return typeof DOMException === 'function'
    ? new DOMException('Aborted', 'AbortError')
    : Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/** Thrown inside an attempt that has already passed the ceiling. */
class TooBig extends Error {
  constructor(readonly projected: number) {
    super('motion:gif-too-big');
  }
}

/** Frames between yields, and the longest stretch without one. */
const YIELD_EVERY = 4;
const YIELD_MS = 50;
const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * The graphic as a looping GIF's bytes. Rejects with `AbortError` when
 * cancelled and `motion:no-canvas` when the window cannot give a canvas;
 * anything `paint` throws comes through as it is.
 */
export async function renderGif(m: Motion, o: GifOptions = {}, deps: Partial<GifDeps> = {}): Promise<GifMade> {
  const d = depsOf(deps);
  const { signal } = o;
  if (signal?.aborted) throw aborted();
  await d.preload(m);
  if (signal?.aborted) throw aborted();

  const keep = o.transparent !== false && seeThrough(m.backdrop);
  // Drawn over its own background from a copy when the transparency is not kept; the graphic is never changed.
  const doc: Motion = keep || !seeThrough(m.backdrop) ? m : { ...m, backdrop: 'bg' };
  const cap = Math.max(1, finite(o.maxBytes, GIF.maxBytes));
  const first = gifPlan(o);
  let plan = first;
  let attempt = 1;
  const at = (n: number, ceiling: number): Attempt => ({ keep, cap: ceiling, attempt: n, dither: o.dither, onProgress: o.onProgress, signal });

  for (;;) {
    const made = await attemptGif(doc, plan, at(attempt, cap), d);
    if (!(made instanceof TooBig) && made.bytes.length <= cap) return { ...made, reduced: cutsBetween(first, plan), over: false };
    const next = smaller(plan, made instanceof TooBig ? made.projected : made.bytes.length, cap);
    if (!next) {
      // Nothing left to give up: the smallest GIF there is, written whole and said to be over.
      const whole = made instanceof TooBig ? await attemptGif(doc, plan, at(attempt + 1, Infinity), d) : made;
      if (whole instanceof TooBig) throw new Error('motion:gif-failed');
      return { ...whole, reduced: cutsBetween(first, plan), over: whole.bytes.length > cap };
    }
    plan = next;
    attempt++;
  }
}

interface Attempt {
  keep: boolean;
  cap: number;
  attempt: number;
  dither?: Dither;
  onProgress?: GifOptions['onProgress'];
  signal?: AbortSignal;
}

/** One GIF at one plan, or `TooBig` as soon as it is certain to pass the ceiling. */
async function attemptGif(doc: Motion, plan: GifPlan, a: Attempt, d: GifDeps): Promise<GifMade | TooBig> {
  const { width, height } = gifSizeFor(doc.format, plan.side);
  const { frames, seconds, trimmed } = gifFrames(doc.seconds, plan.fps);
  const canvas = d.canvas(width, height);
  const ctx = context2d(canvas, a.keep);
  const look = { width, height, clear: true };
  const pixels = async (t: number): Promise<Uint8ClampedArray> => {
    await d.paint(ctx, doc, t, look);
    return ctx.getImageData(0, 0, width, height).data;
  };

  const sampleCount = Math.min(frames, GIF.samples);
  const picks = [...new Set(Array.from({ length: sampleCount }, (_, k) =>
    sampleCount === 1 ? 0 : Math.round((k * (frames - 1)) / (sampleCount - 1))))];
  const total = picks.length + frames;
  let done = 0;
  let turned = now();
  const step = async () => {
    done++;
    a.onProgress?.(done, total, a.attempt);
    if (done % YIELD_EVERY === 0 || now() - turned >= YIELD_MS) {
      await d.tick();
      turned = now();
    }
    if (a.signal?.aborted) throw aborted();
  };

  const counter = new ColourCounter();
  for (const i of picks) {
    counter.add(await pixels(i / plan.fps), a.keep);
    await step();
  }
  const writer = new GifWriter({
    width, height, palette: counter.palette(plan.colors - 1), dither: a.dither ?? 'ordered', transparent: a.keep, loop: 0,
  });
  for (let i = 0; i < frames; i++) {
    const start = i / plan.fps;
    const end = i + 1 >= frames ? seconds : (i + 1) / plan.fps;
    writer.add(await pixels(start), end - start);
    await step();
    if (writer.size > a.cap) return new TooBig((writer.size / (i + 1)) * frames);
  }
  const bytes = writer.finish();
  return {
    bytes, width, height, fps: plan.fps, colors: plan.colors, seconds, frames: writer.frames, trimmed,
    transparent: a.keep, reduced: [], over: false,
  };
}
