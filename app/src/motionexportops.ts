/**
 * Taking a motion graphic away: rendering it to an MP4 or a PNG, and putting
 * the file on the person's disk.
 *
 * ## What is rendered
 *
 * A frame is `motiondraw.ts`'s `paint` at that frame's own time, `i / fps` —
 * never the wall clock — so the file is the preview, frame for frame, however
 * fast or slow this machine draws. The frames go to `motionencode.ts`, which
 * encodes them with the window's own H.264 encoder (WebCodecs) and writes the
 * MP4 with `motionmp4.ts`; a PNG is one frame through the canvas's own PNG
 * encoder. No library, no media element and no network: the fonts are the
 * app's, and every picture is a data: URL inside the graphic (`preload` makes
 * both ready before the first frame, so frame 0 is not drawn in a fallback).
 *
 * Motion blur is `paint`'s: several paints spread over half a frame and
 * averaged, **centred on** the frame's time, so a blurred frame is the moment
 * it stands for, smeared both ways, rather than a moment half a frame late.
 *
 * ## Frames that are not painted
 *
 * Most of a graphic stands still most of the time: a title arrives in half a
 * second and holds for four. The document says exactly when anything can
 * move (`changingFrames`): a layer appears at its `start` (once it can be
 * seen) and goes at its `end`; between them it changes only while its
 * entrance, its exit, its loop, its count or its highlight runs, or always
 * if it is a moving backdrop, particles, or a kind not known to stand still.
 * A frame none of that touches — nor its motion-blur sub-frames, nor the
 * previous frame's — is the frame before it again, and is not painted: the
 * encoder takes the canvas as it stands (`motionencode.ts`). `paint` is a
 * pure function of the document and the time, so the pixels are the ones
 * painting would have made; hashed frame by frame in WebKit and Chrome,
 * every template in four languages, no skipped frame differed. A graphic
 * with scenes is painted whole until `motionscene.ts` says when its own
 * time moves.
 *
 * ## Sound
 *
 * With `sound`, the graphic's sound is rendered (`renderSoundBed`, at 48 kHz)
 * before the first frame and handed to the encoder, which writes it as an AAC
 * track or, when this window cannot encode AAC, leaves it out and says so in
 * the result's `audio`. A graphic without sound gives `audio: 'none'`.
 *
 * ## Sizes
 *
 * By the short side — 720, 1080 or 2160 pixels — as a whole multiple of the
 * shape's ratio, with both sides even because H.264 stores colour in 2 × 2
 * blocks. The 1080p of every shape is its own size in `FORMATS`. Nothing is
 * scaled afterwards: `paint` draws in `u`, 1% of the short side, so the same
 * graphic is simply drawn larger.
 *
 * ## Transparency
 *
 * An MP4 has no alpha. A graphic whose `backdrop` is null is transparent in the
 * editor, so its film is drawn over its own `bg` colour — a copy of the graphic
 * with `backdrop: 'bg'`; the graphic itself is never changed. So is one whose
 * backdrop is a colour that is not opaque (`#rrggbbaa`). A PNG keeps the
 * alpha when asked to and the graphic has any.
 *
 * ## Saving: SAFETY.md's rule
 *
 * Nothing a model wrote reaches the disk except through here, and nothing here
 * runs unless a person pressed **Download** or **Save as…** (MotionExport.tsx).
 * The bytes go to Rust's `export_write_video`, the command Video's files use:
 * at the path the OS save panel returned, or — for Download — in the Downloads
 * folder under a name made from the title, never over a file already there
 * (`Title.mp4`, then `Title (2).mp4`…, which Rust picks and returns). That
 * command is absent from the model's tool schema, writes only `.mp4 .webm .png
 * .srt .json` at an absolute path, and checks the first bytes are what the name
 * says. Motion adds no command and no kind of file: an MP4 and a PNG.
 *
 * ## Why the rules below are copies
 *
 * `fileNameFor`, `downloadsPath`, `writeMotionFile` and `openExported` are
 * `videoexport.ts`'s rules, copied rather than imported: that file imports
 * Remotion's web renderer, and Motion draws and encodes with no library, so it
 * must not pull one in by importing a neighbour. `test/motionexport.test.mjs`
 * holds the copies to the same answers as the originals.
 *
 * ## Why the name ends in `ops`
 *
 * Not `motionexport.ts`: the tab is `MotionExport.tsx`, and on macOS and
 * Windows, whose file systems ignore case, `import './MotionExport'` would find
 * this file first and the tab would be missing (tsc says TS1261; a build
 * resolves the wrong module). Video's chat hit the same thing, hence
 * `videochatops.ts` beside `VideoChat.tsx`.
 */

import { invoke } from '@tauri-apps/api/core';
import { downloadDir, join } from '@tauri-apps/api/path';
import { bitrateFor, encodeMp4, withReport } from './motionencode';
import type { AudioOutcome, Mp4Bytes } from './motionencode';
import { AAC_RATE } from './motionaudioenc';
import { countAt, gapOf, poseAt } from './motionanim';
import { paint, preload } from './motiondraw';
import { formatNumber, scriptOf } from './motionfonts';
import { renderSoundBed } from './motionsound';
import type { SoundBed } from './motionsound';
import { LIMITS, SPLITS, frameCount, sizeOf } from './motiontypes';
import type { Anim, Ctx, Format, Layer, Motion } from './motiontypes';

// ── what can be made ──────────────────────────────────────────────────────

/** A film's or a picture's size, by its short side: 720, 1080 or 2160 pixels. */
export type Size = '720p' | '1080p' | '4k';
export const SIZES: readonly Size[] = ['720p', '1080p', '4k'];

const SHORT_SIDE: Readonly<Record<Size, number>> = { '720p': 720, '1080p': 1080, '4k': 2160 };

/** What a size is called on a button: `4K` for 2160p, as everyone says it. */
export function sizeName(s: Size): string {
  return s === '4k' ? '4K' : s;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

/**
 * A shape's pixel size at a size: a whole multiple of its ratio (16:9 is 16n ×
 * 9n), with both sides even. The short side is the size's own — 1920 × 1080 at
 * 1080p, 1080 × 1350 for a feed post, 3840 × 2160 at 4K — because all four
 * ratios allow it; a ratio that did not would come out a step smaller rather
 * than a pixel off true.
 */
export function pixelsFor(format: Format, size: Size): { width: number; height: number } {
  // The shape's own size (a wide frame for a shape it does not know), reduced to its ratio.
  const f = sizeOf(format);
  const g = gcd(f.width, f.height);
  const across = f.width / g;
  const down = f.height / g;
  let n = Math.max(1, Math.round((SHORT_SIDE[size] ?? SHORT_SIDE['1080p']) / Math.min(across, down)));
  // An odd side times an odd multiple is odd, which H.264 cannot take.
  if ((across % 2 || down % 2) && n % 2) n = n > 1 ? n - 1 : 2;
  return { width: across * n, height: down * n };
}

/**
 * How many bits the encoder may spend: `motionencode.ts`'s presets, which
 * scale with the frame, so one word serves every shape and size.
 */
export type Quality = 'medium' | 'high' | 'very-high';
export const QUALITIES: readonly Quality[] = ['medium', 'high', 'very-high'];

/** What each shape is called in a file name. */
export const FORMAT_TAG: Readonly<Record<Format, string>> = { landscape: '16x9', portrait: '9x16', square: '1x1', feed: '4x5' };

/**
 * About how many bytes an MP4 may be: the bitrate the encoder is asked for,
 * times the length. The rate is variable and flat colour costs little, so the
 * file usually comes out well under this (a 3-second 720p title: 0.5 MB in
 * WebKit, 0.8 MB in Chrome, against 2.1) — which is why the tab says "up to":
 * it is the number to hold against an upload limit, not a prediction.
 */
export function estimateBytes(m: Pick<Motion, 'seconds' | 'fps' | 'format'>, size: Size, quality: Quality): number {
  const { width, height } = pixelsFor(m.format, size);
  const seconds = Number.isFinite(m.seconds) && m.seconds > 0 ? m.seconds : 0;
  return Math.round((bitrateFor(width, height, m.fps, quality) * seconds) / 8);
}

/**
 * The frame a moment falls on: the nearest one, and never past the last —
 * the moment a layer that runs to the end has ended, and nothing is drawn.
 */
export function frameAt(m: Pick<Motion, 'seconds' | 'fps'>, at: number): number {
  const last = frameCount(m) - 1;
  const i = Math.round((Number.isFinite(at) ? at : 0) * m.fps);
  return Math.min(last, Math.max(0, i));
}

// ── rendering ─────────────────────────────────────────────────────────────

// ── frames that cannot have changed ───────────────────────────────────────

/** `motionanim.ts`'s shortest effect: a duration of 0 is this. */
const MIN_D = 0.001;
/** `motiondraw.ts`'s `MARK_D`: how long a highlight's box or underline takes to draw itself once the words have landed. */
const MARK_D = 0.45;
/** `motiondraw.ts`'s `MAX_SAMPLES`: the most sub-frames motion blur paints. */
const MAX_SAMPLES = 32;
/** Loops whose `amount` scales all they do, so that at 0 they do nothing. A shimmer moves at any amount. */
const SCALED_LOOPS = ['float', 'pulse', 'spin', 'sway', 'breathe'];
/**
 * The kinds of layer, and of chart, known to be drawn from their pose (and a
 * counter from its figure) and nothing else that moves with time. Written
 * out rather than read from `LAYER_KINDS` and `CHARTS` on purpose: a kind or
 * a chart added later (a bar-chart race re-orders its bars as time passes)
 * is painted at every frame it shows until someone has checked it and listed
 * it here, so a new drawing can never be frozen by a skipped frame.
 */
const STILL_KINDS: readonly string[] = ['text', 'counter', 'shape', 'icon', 'image', 'chart'];
const STILL_CHARTS: readonly string[] = ['bars', 'hbars', 'line', 'donut', 'ring'];

/**
 * How far a run of `count` staggered effects has got at one moment: unit `i`
 * has progressed `r(i)` — at most 0 not begun, at least 1 done, in between
 * under way, read exactly as `clamp01` reads it — and `r` is monotone in `i`
 * (each unit starts a steady `gap` after the one before). The number of
 * units done when none is under way; NaN, which equals nothing, when one is.
 * Found by bisection, so a 500-letter title costs ten looks, not 500.
 */
function standing(count: number, r: (i: number) => number): number {
  const done = (i: number) => r(i) >= 1;
  const moving = (i: number) => {
    const x = r(i);
    return x > 0 && x < 1;
  };
  if (count <= 1) return moving(0) ? NaN : done(0) ? 1 : 0;
  // The units done are a prefix when progress falls with `i`, a suffix when it rises.
  const falling = r(0) >= r(count - 1);
  let lo = 0;
  let hi = count;
  // The first index on the other side of the done/not-done boundary.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (done(mid) === falling) lo = mid + 1;
    else hi = mid;
  }
  const doneCount = falling ? lo : count - lo;
  // The not-done unit nearest the boundary has made the most progress of all
  // the not-done ones: if it has not begun, none has.
  const nearest = falling ? lo : lo - 1;
  if (nearest >= 0 && nearest < count && moving(nearest)) return NaN;
  return doneCount;
}

/**
 * The pieces a layer's entrance and exit run on: a chart's data, and a split
 * text's words, lines or letters; `split` when the text is drawn piece by
 * piece rather than whole. The renderer decides the exact count from its
 * layout (a wrapped line, a letter cluster), so where this cannot be sure it
 * counts what the renderer cannot exceed — every word for lines that wrap,
 * every code point for letters — and says the count is not `exact`: a piece
 * the renderer has is then never missed, and one it does not have only costs
 * a frame painted that need not have been.
 */
function piecesOf(l: Layer): { n: number; exact: boolean; split: boolean } {
  if (l.kind === 'chart') return { n: Math.max(1, Math.min(LIMITS.dataPoints, Array.isArray(l.data) ? l.data.length : 0)), exact: true, split: false };
  if (l.kind !== 'text') return { n: 1, exact: true, split: false };
  const by = l.in?.by ?? l.out?.by ?? 'all';
  if (by === 'all' || !(SPLITS as readonly string[]).includes(by)) return { n: 1, exact: true, split: false };
  // The text as `motiondraw.ts`'s `textBlock` reads it, and its words as that splits them.
  const raw = String(typeof l.text === 'string' ? l.text : '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ').slice(0, LIMITS.text * 2);
  const words = raw.match(/\S+/g) ?? [];
  const n = (count: number, exact: boolean) => ({ n: Math.max(1, count), exact: exact && count > 0, split: true });
  if (by === 'word') return n(words.length, true);
  if (by === 'line') {
    if (finite(l.max, 0) > 0 && !l.fit) return n(words.length, false);
    return n(raw.split('\n').filter((p) => /\S/.test(p)).length, true);
  }
  // Letters, except in Arabic script, whose letters join and which splits into words instead.
  if (scriptOf(raw) === 'arabic') return n(words.length, true);
  let letters = 0;
  for (const w of words) letters += Array.from(w).length;
  // A letter is a code point exactly when nothing combines with it: plain printable ASCII.
  return n(letters, words.every((w) => /^[\x21-\x7e]+$/.test(w)));
}

/** How many pieces a layer's entrance and exit run on, or more (see `piecesOf`). */
export function unitsBound(l: Layer): number {
  return piecesOf(l).n;
}

/** Above this many pieces, whether any is visible is not worked out piece by piece: the frame is painted. */
const MAX_LOOKS = 64;

/** A finite number, or `fallback`: `motionmath.ts`'s `finite`, which the timings below must read numbers exactly as. */
function finite(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

/**
 * Everything about a layer that can make two moments look different, as a
 * key: equal keys at two moments mean the layer is drawn the same at both.
 * Null when it is under way — moving, so like no other moment. Every timing
 * is computed with the same arithmetic, in the same order, as `poseAt` and
 * the highlight's `markProgress` compute it, so a key changes exactly where
 * what they return can. A counter's part is the number it shows, as
 * `motiondraw.ts`'s `counterBlock` writes it: the end of a roll that eases
 * out shows the same figure for many frames, and those are the same picture.
 */
function keyAt(l: Layer, t: number, pieces: { n: number; exact: boolean; split: boolean }, lang: Motion['lang']): (number | string)[] | null {
  // Drawn from `start` up to `end` (`motiondraw.ts`'s `drawLayer`), and only
  // if it shows: its pose `on`, or, for a text drawn in pieces, one piece's.
  // A layer that is there but cannot be seen — an entrance not yet begun, an
  // exit over — draws nothing, the same nothing as a layer that is not there.
  if (!(t >= l.start) || !(t < l.end)) return [0];
  const units = pieces.n;
  if (!pieces.split) {
    if (!poseAt(l, t, false).on) return [0];
  } else if (pieces.exact && units <= MAX_LOOKS) {
    let any = false;
    for (let i = 0; i < units && !any; i++) any = poseAt(l, t, false, { i, n: units }).on;
    if (!any) return [0];
  }
  // Backdrops and particles move for as long as they show; so does anything not known to stand still.
  if (!STILL_KINDS.includes(l.kind) || (l.kind === 'chart' && !STILL_CHARTS.includes(l.chart))) return null;
  const loop = l.loop;
  if (loop && loop.fx !== 'none') {
    const still = SCALED_LOOPS.includes(loop.fx) && Math.min(3, Math.max(0, finite(loop.amount, 1))) === 0;
    if (!still) return null;
  }
  const key: (number | string)[] = [1];
  const enter: Anim | undefined = l.in;
  if (enter && enter.fx !== 'none') {
    const d = Math.max(MIN_D, finite(enter.d, 0.6));
    const g = gapOf(l, enter);
    key.push(standing(units, (i) => (t - (l.start + finite(enter.delay, 0) + i * g)) / d));
    if (l.kind === 'text' && typeof l.hi === 'string' && l.hi && (l.hiStyle === 'box' || l.hiStyle === 'underline')) {
      // The highlight draws itself after the last piece lands: `inDone(layer, n) + MARK_D`, n the pieces.
      const landed = l.start + finite(enter.delay, 0);
      key.push(standing(units, (i) => (t - (landed + Math.max(0, i) * g + d)) / MARK_D));
    }
  }
  const leave: Anim | undefined = l.out;
  if (leave && leave.fx !== 'none') {
    const d = Math.max(MIN_D, finite(leave.d, 0.4));
    const g = gapOf(l, leave);
    // The piece `j` places from the last leaves `j` gaps before the end.
    key.push(standing(units, (j) => (l.end - finite(leave.delay, 0) - j * g - t) / d));
  }
  if (l.kind === 'counter') {
    if (!l.count || typeof l.count !== 'object') return null;
    const decimals = Math.min(3, Math.max(0, Math.round(finite(l.decimals, 0))));
    key.push(formatNumber(countAt(l, t), { decimals, group: !!l.group, lang }));
  }
  return key.some((k) => typeof k === 'number' && Number.isNaN(k)) ? null : key;
}

/**
 * Which frames of a film must be painted: 1 for a frame that can look
 * different from the one before it, 0 for one that is that frame again. The
 * first frame is always painted. A frame is the one before it again when,
 * at each of its motion-blur sub-frames (`blur`, as `paint` takes it) and the
 * same sub-frame of the frame before, every layer's key (`keyAt`) is the
 * same: nothing is under way at either, and nothing appeared, left, landed
 * or began between them. A document with scenes is painted whole: how its
 * time moves is `motionscene.ts`'s to say.
 */
export function changingFrames(m: Motion, o: { fps: number; frames: number; blur?: { samples: number; shutter: number } }): Uint8Array {
  const frames = Math.max(0, Math.floor(finite(o.frames, 0)));
  const out = new Uint8Array(frames);
  if (!frames) return out;
  const fps = o.fps;
  const layers = Array.isArray(m?.layers) ? m.layers : [];
  if (!(fps > 0) || !Number.isFinite(fps) || (Array.isArray(m.scenes) && m.scenes.length > 0)) return out.fill(1);
  // The moments `paint` draws a frame at: its own time, or its blur's sub-frames (`motiondraw.ts`'s `blurred`).
  const samples = Math.min(MAX_SAMPLES, Math.round(finite(o.blur?.samples, 1)));
  const docFps = finite(m.fps, 30) > 0 ? m.fps : 30;
  const shutter = Math.min(4, Math.max(0, finite(o.blur?.shutter, 0.5)));
  const moments = (i: number): number[] => {
    const t = i / fps;
    if (samples <= 1) return [t];
    return Array.from({ length: samples }, (_, s) => t + ((s + 0.5) / samples - 0.5) * shutter / docFps);
  };
  const shown = layers.filter((l): l is Layer => !!l && typeof l === 'object' && !l.hidden);
  const pieces = shown.map(piecesOf);
  const lang = m.lang ?? 'en';
  const keys = (i: number) => moments(i).map((t) => shown.map((l, k) => keyAt(l, t, pieces[k], lang)));
  type Key = ReturnType<typeof keyAt>;
  const same = (a: Key[][], b: Key[][]) => a.every((at, s) => at.every((x, k) => {
    const y = b[s][k];
    return x !== null && y !== null && x.length === y.length && x.every((v, n) => v === y[n]);
  }));
  out[0] = 1;
  let before = keys(0);
  for (let i = 1; i < frames; i++) {
    const now = keys(i);
    out[i] = same(before, now) ? 0 : 1;
    before = now;
  }
  return out;
}

// ── rendering ─────────────────────────────────────────────────────────────

/**
 * What rendering uses, so a test can hand in its own: the encoder, the
 * painter, the loader, where the canvas comes from, and the sound. The
 * defaults are the real ones.
 */
export interface RenderDeps {
  encodeMp4: typeof encodeMp4;
  paint: typeof paint;
  preload: typeof preload;
  canvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
  soundBed: typeof renderSoundBed;
}

/**
 * A canvas for one export. A detached `<canvas>` where there is a document —
 * its text is drawn with the fonts the document loaded, exactly as the stage
 * draws it — and an `OffscreenCanvas` where there is not.
 */
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

function depsOf(d: Partial<RenderDeps>): RenderDeps {
  return {
    encodeMp4: d.encodeMp4 ?? encodeMp4,
    paint: d.paint ?? paint,
    preload: d.preload ?? preload,
    canvas: d.canvas ?? makeCanvas,
    soundBed: d.soundBed ?? renderSoundBed,
  };
}

const isOffscreen = (c: HTMLCanvasElement | OffscreenCanvas): c is OffscreenCanvas =>
  typeof (c as OffscreenCanvas).convertToBlob === 'function';

/**
 * The canvas's 2D context. `alpha: false` for a film, whose every pixel is
 * opaque anyway: what is encoded is then exactly what is drawn, whatever the
 * engine would have done with a pixel that was half see-through.
 */
function context2d(canvas: HTMLCanvasElement | OffscreenCanvas, alpha: boolean): Ctx {
  const ctx = isOffscreen(canvas) ? canvas.getContext('2d', { alpha }) : canvas.getContext('2d', { alpha });
  // A canvas too large for this window's memory has no context.
  if (!ctx) throw new Error('motion:no-canvas');
  return ctx;
}

/**
 * Whether the backdrop lets what is behind it through: none at all, or a
 * colour that is not opaque — `#rrggbbaa`, which is how the reader writes one,
 * and what a model's `"backdrop": "transparent"` becomes (`#00000000`). Such a
 * film was drawn over black, and its "opaque" PNG came out see-through.
 */
function seeThrough(backdrop: Motion['backdrop']): boolean {
  return backdrop === null || (typeof backdrop === 'string' && /^#[0-9a-f]{8}$/i.test(backdrop) && !/ff$/i.test(backdrop));
}

/** The graphic drawn over its own background colour: a copy when it is transparent, the graphic itself otherwise. */
function opaque(m: Motion): Motion {
  return seeThrough(m.backdrop) ? { ...m, backdrop: 'bg' } : m;
}

/** Motion blur for a film: eight paints over half a frame, the frame's time at their centre. */
const BLUR = { samples: 8, shutter: 0.5 } as const;

function aborted(): Error {
  // What `fetch` and the encoder throw, so the panel tells every cancellation
  // apart the same way: `name === 'AbortError'`.
  return typeof DOMException === 'function'
    ? new DOMException('Aborted', 'AbortError')
    : Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

const isAbort = (e: unknown) => (e as { name?: unknown } | null)?.name === 'AbortError';

/**
 * The whole graphic as an MP4's bytes, at `size` and `quality`, with its
 * sound when `sound` is true (off unless asked: the shortest path to a film
 * is unchanged).
 *
 * Fonts and pictures are loaded first, then the sound is rendered
 * (`onSound(0, 1)` as it starts, then the encoder's `onSound(samples done,
 * samples)`). Each frame `i` is painted at `i / fps` into one canvas the size
 * of the film — except a frame that cannot differ from the one before it
 * (`changingFrames`), which is not painted again — and handed to the
 * encoder, which reports `onProgress(frames done, frames)` and stops between
 * frames when `signal` is aborted, rejecting with an `AbortError`. Its own
 * failures come through as they are: `motion:no-encoder` when this window has
 * no H.264 encoder for the size, `motion:encode-failed: …`,
 * `motion:too-large`. Sound never fails a film: a bed that will not render
 * or encode leaves the film silent, and the result's `audio` says
 * `'dropped'` (`Mp4Bytes`).
 */
export async function renderMp4(
  m: Motion,
  o: {
    size: Size; quality: Quality; blur: boolean; sound?: boolean;
    onProgress?: (done: number, total: number) => void; onSound?: (done: number, total: number) => void; signal?: AbortSignal;
  },
  deps: Partial<RenderDeps> = {},
): Promise<Mp4Bytes> {
  const d = depsOf(deps);
  const { signal } = o;
  if (signal?.aborted) throw aborted();
  await d.preload(m);
  if (signal?.aborted) throw aborted();

  let bed: SoundBed | null = null;
  let lost = false;
  if (o.sound) {
    o.onSound?.(0, 1);
    try {
      bed = await d.soundBed(m, { signal, sampleRate: AAC_RATE });
    } catch (e) {
      if (signal?.aborted || isAbort(e)) throw aborted();
      lost = true;
    }
    if (signal?.aborted) throw aborted();
  }

  const { width, height } = pixelsFor(m.format, o.size);
  const canvas = d.canvas(width, height);
  const ctx = context2d(canvas, false);
  const film = opaque(m);
  const fps = m.fps;
  const frames = frameCount(m);
  const look = o.blur ? { width, height, clear: true, blur: { ...BLUR } } : { width, height, clear: true };
  const changes = changingFrames(film, { fps, frames, blur: o.blur ? BLUR : undefined });
  const bytes: Uint8Array & Partial<Mp4Bytes> = await d.encodeMp4({
    canvas, width, height, fps, frames, quality: o.quality,
    draw: (i: number) => d.paint(ctx, film, i / fps, look),
    unchanged: (i: number) => changes[i] === 0,
    audio: bed ?? undefined,
    onProgress: o.onProgress,
    onSound: o.onSound,
    signal,
  });
  const audio: AudioOutcome = lost ? 'dropped' : bytes.audio ?? (bed ? 'dropped' : 'none');
  return withReport(bytes, { audio, painted: bytes.painted ?? frames, frames });
}

/** The eight bytes every PNG starts with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** The canvas as PNG bytes, from the engine's own encoder; checked, because Rust will check them too. */
async function pngOf(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
  const blob = isOffscreen(canvas)
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('motion:png-failed');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!isPng(bytes)) throw new Error('motion:png-failed');
  return bytes;
}

/**
 * One frame as a PNG's bytes: the frame nearest `at` seconds (never past the
 * last), at `size`. With `transparent`, a graphic with no backdrop (or one that
 * is not opaque) keeps its alpha; otherwise the frame is drawn over the
 * graphic's background, as the film would be.
 */
export async function renderPng(
  m: Motion,
  o: { size: Size; at: number; transparent: boolean },
  deps: Partial<RenderDeps> = {},
): Promise<Uint8Array> {
  const d = depsOf(deps);
  await d.preload(m);
  const { width, height } = pixelsFor(m.format, o.size);
  const canvas = d.canvas(width, height);
  const ctx = context2d(canvas, true);
  const still = o.transparent && seeThrough(m.backdrop) ? m : opaque(m);
  await d.paint(ctx, still, frameAt(m, o.at) / m.fps, { width, height, clear: true });
  return pngOf(canvas);
}

// ── names and places ──────────────────────────────────────────────────────
// videoexport.ts's rules, copied (see the top of this file for why).

/** Names Windows keeps for devices, which no file may have. */
const DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A name for a saved file, from the title — `videoexport.ts`'s `fileNameFor`
 * rule, copied. Its letters in whatever script they are in — Arabic, Sorani's
 * ڕ ڵ ێ ۆ ە, Badini's ڤ — its digits, spaces, `-`, `_` and the zero-width
 * non-joiner Persian-script words need, and nothing a file system could read as
 * a path or refuse: no `/ \ : * ? " < > |`, no control characters, no other
 * punctuation. `tag` follows the title — `16x9` for the shape. At most eighty
 * characters with the extension, cut where a word ends. `motion.mp4` when the
 * title leaves nothing, and never a name Windows keeps for a device.
 *
 * Only a wish: when the name is taken in the Downloads folder, Rust saves at
 * `Title (2).mp4`, `Title (3).mp4`… and says which.
 */
export function fileNameFor(m: Pick<Motion, 'title'>, ext: 'mp4' | 'png', tag = ''): string {
  const title = (typeof m?.title === 'string' ? m.title : '').normalize('NFC');
  const kept = title.replace(/[^\p{L}\p{M}\p{N}\u200C _-]+/gu, ' ').replace(/\s+/g, ' ').trim();
  const end = `${tag ? ` ${tag}` : ''}.${ext}`;
  const max = 80 - end.length;
  const chars = Array.from(kept);
  let base = kept;
  if (chars.length > max) {
    const head = chars.slice(0, max + 1).join('');
    const at = head.lastIndexOf(' ');
    base = (at > 0 ? head.slice(0, at) : chars.slice(0, max).join('')).trim();
  }
  if (!base) base = 'motion';
  return `${DEVICE.test(base) ? `${base}_` : base}${end}`;
}

/** The Downloads folder joined to a name — where **Download** saves. */
export async function downloadsPath(name: string): Promise<string> {
  return join(await downloadDir(), name);
}

/**
 * Write an export at `path` and return where it landed — `writeVideoFile`'s
 * call, exactly.
 *
 * `path` is what the save panel returned, and a file already there is
 * replaced: the panel asked. With `unique` it is a wish in the Downloads
 * folder, and nothing there is ever replaced: Rust writes the first free name
 * of `Title.mp4`, `Title (2).mp4`… and returns it. The bytes are the request's
 * whole body (a raw IPC body, not base64 in JSON: a film is megabytes) and the
 * path travels in a header, URI-encoded because a header is ASCII and a path
 * can be Arabic or Kurdish. Rust's refusal — not an absolute `.mp4` or `.png`
 * path in a folder that exists, bytes that are not what the name says, too
 * many of them — comes back as the rejection's message.
 */
export async function writeMotionFile(path: string, bytes: Uint8Array, o: { unique?: boolean } = {}): Promise<string> {
  const headers: Record<string, string> = { 'x-path': encodeURIComponent(path) };
  if (o.unique) headers['x-unique'] = '1';
  const written = await invoke<string>('export_write_video', bytes, { headers });
  return typeof written === 'string' && written ? written : path;
}

/**
 * Open a file `writeMotionFile` wrote in the app the system plays or shows it
 * with — never in this page, which has no media element. Rust refuses any
 * file it did not write in this session.
 */
export async function openExported(path: string): Promise<void> {
  await invoke('open_exported', { path });
}
