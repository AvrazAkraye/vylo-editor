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
import { bitrateFor, encodeMp4 } from './motionencode';
import { paint, preload } from './motiondraw';
import { frameCount, sizeOf } from './motiontypes';
import type { Ctx, Format, Motion } from './motiontypes';

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

/**
 * What rendering uses, so a test can hand in its own: the encoder, the
 * painter, the loader, and where the canvas comes from. The defaults are the
 * real ones.
 */
export interface RenderDeps {
  encodeMp4: typeof encodeMp4;
  paint: typeof paint;
  preload: typeof preload;
  canvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas;
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

/**
 * The whole graphic as an MP4's bytes, at `size` and `quality`.
 *
 * Fonts and pictures are loaded first. Each frame `i` is painted at `i / fps`
 * into one canvas the size of the film and handed to the encoder, which
 * reports `onProgress(frames done, frames)` and stops between frames when
 * `signal` is aborted, rejecting with an `AbortError`. Its own failures come
 * through as they are: `motion:no-encoder` when this window has no H.264
 * encoder for the size, `motion:encode-failed: …`, `motion:too-large`.
 */
export async function renderMp4(
  m: Motion,
  o: { size: Size; quality: Quality; blur: boolean; onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  deps: Partial<RenderDeps> = {},
): Promise<Uint8Array> {
  const d = depsOf(deps);
  const { signal } = o;
  if (signal?.aborted) throw aborted();
  await d.preload(m);
  if (signal?.aborted) throw aborted();

  const { width, height } = pixelsFor(m.format, o.size);
  const canvas = d.canvas(width, height);
  const ctx = context2d(canvas, false);
  const film = opaque(m);
  const fps = m.fps;
  const look = o.blur ? { width, height, clear: true, blur: { ...BLUR } } : { width, height, clear: true };
  return d.encodeMp4({
    canvas, width, height, fps, frames: frameCount(m), quality: o.quality,
    draw: (i: number) => d.paint(ctx, film, i / fps, look),
    onProgress: o.onProgress,
    signal,
  });
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
