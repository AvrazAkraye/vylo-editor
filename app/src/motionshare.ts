/**
 * Where a graphic is going, and what that means for the file.
 *
 * The Export tab used to ask what kind of file, how large and how good. Most
 * people are answering a different question — *where is this going?* — so the
 * tab now offers destinations, and this file turns one into settings:
 *
 * | destination | file | shape                                  | size, quality                 |
 * |-------------|------|----------------------------------------|-------------------------------|
 * | `story`     | MP4  | 9:16                                   | 1080p, balanced               |
 * | `post`      | MP4  | 4:5, or 1:1 when the graphic is square | 1080p, balanced               |
 * | `youtube`   | MP4  | 16:9                                   | 1080p, balanced               |
 * | `loop`      | GIF  | the graphic's own                      | 720 px long side, 15 a second |
 * | `picture`   | PNG  | the graphic's own                      | 1080p, at its best moment     |
 * | `custom`    | any  | the graphic's own                      | the person's choices          |
 *
 * 1080p and "balanced" are what the tab chose before there were destinations,
 * and what every platform these name shows; they are also what a person who
 * opens **More options** and changes them gets next time (`SharePrefs`, which
 * the tab remembers as it remembered its choices before).
 *
 * ## The graphic is never changed, only the file
 *
 * A destination of another shape makes a file of that shape from a **copy**
 * (`outputOf`). A graphic still tied to its template is built again from the
 * template for the shape — the template's designer drew every shape. One whose
 * layers were edited by hand is **fitted inside** the new frame, whole, on its
 * own background colour (`fitBox`, `fittedPaint`), as a wide film is shown in
 * a story. Laying its layers out again from their pins, which is what the
 * Design tab's shape buttons do, was tried first and is not safe without a
 * person looking: a wide title laid out at 9:16 ran off both sides of the
 * frame. A person who wants that can change the graphic's shape in Design and
 * see it. A graphic with scenes is fitted too, because building it again
 * would lose them. `reshape` says which, so the tab can say it and show it.
 *
 * ## Estimates
 *
 * `bytes` and `ms` are what the tab shows before anything is made. An MP4's
 * size is the bitrate the encoder is allowed times the length — a ceiling, so
 * `upTo` — and a GIF's or a PNG's is a guess from the pixels (`about`). The
 * time is the pixels to paint, read back and encode at rates measured on a
 * Mac (`COST`): the order of magnitude, so the person knows whether to wait or
 * to make a cup of tea, never a promise.
 *
 * Pure: no DOM, no storage, no clock. The tab (MotionExport.tsx) holds the
 * state; everything it decides is decided here, and tested.
 */

import { stillTime } from './motionanim';
import { paint } from './motiondraw';
import { setFormat } from './motionedit';
import { QUALITIES, SIZES, estimateBytes, fileNameFor, pixelsFor, type Quality, type Size } from './motionexportops';
import { GIF, GIF_RATES, GIF_SIDES, estimateGifBytes, gifFrames, gifSizeFor, movesEverywhere, seeThrough } from './motiongifops';
import { FORMATS, frameCount, isTone, type Ctx, type Format, type Motion } from './motiontypes';
import type { T } from './motionui';

// ── the destinations ──────────────────────────────────────────────────────

/** The three kinds of file Motion makes. */
export type ShareKind = 'mp4' | 'gif' | 'png';
export const SHARE_KINDS: readonly ShareKind[] = ['mp4', 'gif', 'png'];

export type Destination = 'story' | 'post' | 'youtube' | 'loop' | 'picture' | 'custom';
/** In the order the tab shows them: the three films, the loop, the still, and the person's own. */
export const DESTINATIONS: readonly Destination[] = ['story', 'post', 'youtube', 'loop', 'picture', 'custom'];

interface Spec {
  /** The kind of file; null is the person's choice. */
  kind: ShareKind | null;
  /** The shapes it takes, the first when the graphic's is not one of them; null is the graphic's own. */
  shapes: readonly Format[] | null;
}

const SPECS: Readonly<Record<Destination, Spec>> = {
  story: { kind: 'mp4', shapes: ['portrait'] },
  post: { kind: 'mp4', shapes: ['feed', 'square'] },
  youtube: { kind: 'mp4', shapes: ['landscape'] },
  loop: { kind: 'gif', shapes: null },
  picture: { kind: 'png', shapes: null },
  custom: { kind: null, shapes: null },
};

const isDestination = (d: unknown): d is Destination => DESTINATIONS.includes(d as Destination);

/** The kind of file a destination makes; `custom` makes the one chosen. */
export function kindOf(d: Destination, chosen: ShareKind = 'mp4'): ShareKind {
  return SPECS[isDestination(d) ? d : 'custom'].kind ?? (SHARE_KINDS.includes(chosen) ? chosen : 'mp4');
}

/** The shape of the file a destination makes from a graphic of shape `from`. */
export function shapeFor(d: Destination, from: Format): Format {
  const own: Format = from in FORMATS ? from : 'landscape';
  const shapes = SPECS[isDestination(d) ? d : 'custom'].shapes;
  return !shapes || shapes.includes(own) ? own : shapes[0];
}

/**
 * The destination chosen for a graphic before the person chooses: the film
 * for where its shape is usually seen — a tall graphic is a story, a square or
 * 4:5 one a post, a wide one a video — so the shortest path never changes the
 * shape. A window that cannot make an MP4 gets the picture, as the tab did.
 */
export function bestDestination(m: Pick<Motion, 'format'>, canMp4 = true): Destination {
  if (!canMp4) return 'picture';
  if (m.format === 'portrait') return 'story';
  if (m.format === 'feed' || m.format === 'square') return 'post';
  return 'youtube';
}

/** A destination's two words, written out so the catalogue's check sees each. */
export function destinationName(d: Destination, t: T): string {
  switch (d) {
    case 'story': return t('Story or Reel');
    case 'post': return t('Post');
    case 'youtube': return t('YouTube');
    case 'loop': return t('Web loop');
    case 'picture': return t('Picture');
    default: return t('Custom');
  }
}

/** A destination's one line, with `{ratio}` where the file's shape goes (`ratioOf`). */
export function destinationLine(d: Destination, t: T): string {
  switch (d) {
    case 'story': return t('Tall {ratio} video for phones');
    case 'post': return t('{ratio} video for a feed');
    case 'youtube': return t('Wide {ratio} video');
    case 'loop': return t('A GIF that plays on repeat');
    case 'picture': return t('A PNG of its best moment');
    default: return t('Every setting, your choice');
  }
}

/** A shape as its ratio, `9:16`. */
export function ratioOf(f: Format): string {
  return (FORMATS[f] ?? FORMATS.landscape).ratio;
}

/**
 * The card an arrow key moves to in the tab's group of destinations, as a
 * radio group's arrows do: down, and right in a left-to-right interface (left
 * in Arabic and Kurdish), go forward; up and the other way go back; Home and
 * End go to the ends; round the ends, and past any card that cannot be
 * chosen. Null for any other key, or when nothing can be chosen.
 */
export function destinationStep(i: number, key: string, rtl: boolean, enabled: readonly boolean[]): number | null {
  const n = enabled.length;
  if (!n || !enabled.some(Boolean)) return null;
  const from = Number.isInteger(i) && i >= 0 && i < n ? i : 0;
  const walk = (start: number, by: number): number => {
    for (let k = 0, at = start; k < n; k++, at = (at + by + n) % n) if (enabled[at]) return at;
    return from;
  };
  if (key === 'Home') return walk(0, 1);
  if (key === 'End') return walk(n - 1, -1);
  const forward = key === 'ArrowDown' || key === (rtl ? 'ArrowLeft' : 'ArrowRight');
  const back = key === 'ArrowUp' || key === (rtl ? 'ArrowRight' : 'ArrowLeft');
  if (!forward && !back) return null;
  return walk((from + (forward ? 1 : -1) + n) % n, forward ? 1 : -1);
}

// ── what the person chose ─────────────────────────────────────────────────

/**
 * What **More options** changes and the tab remembers between sessions: the
 * custom destination's kind, the MP4's or PNG's size, the MP4's quality and
 * motion blur, and the GIF's long side and rate. Version 1 of the tab kept the
 * first four (with the kind as `format`, MP4 or PNG), and `readPrefs` reads
 * those too, so nobody loses a choice to the redesign.
 */
export interface SharePrefs {
  kind: ShareKind;
  size: Size;
  quality: Quality;
  blur: boolean;
  gifSide: number;
  gifFps: number;
}

export const FIRST_PREFS: Readonly<SharePrefs> = { kind: 'mp4', size: '1080p', quality: 'high', blur: false, gifSide: GIF.side, gifFps: GIF.fps };

/** Remembered choices from storage, whatever was stored: every field checked, anything unknown the default. */
export function readPrefs(raw: unknown): SharePrefs {
  // Only the object's own fields, each read on its own: a field it inherits is not a choice anybody made, and a
  // getter or a Proxy that throws is a field that is not there — never a tab that cannot open.
  const field = (k: string): unknown => {
    try {
      return Object.prototype.hasOwnProperty.call(raw, k) ? (raw as Record<string, unknown>)[k] : undefined;
    } catch {
      return undefined;
    }
  };
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...FIRST_PREFS };
  } catch {
    return { ...FIRST_PREFS };
  }
  const pick = <X>(list: readonly X[], v: unknown, d: X): X => (list.includes(v as X) ? (v as X) : d);
  const blur = field('blur');
  return {
    kind: pick(SHARE_KINDS, field('kind') ?? field('format'), FIRST_PREFS.kind),
    size: pick(SIZES, field('size'), FIRST_PREFS.size),
    quality: pick(QUALITIES, field('quality'), FIRST_PREFS.quality),
    blur: typeof blur === 'boolean' ? blur : FIRST_PREFS.blur,
    gifSide: pick(GIF_SIDES, field('gifSide'), FIRST_PREFS.gifSide),
    gifFps: pick(GIF_RATES, field('gifFps'), FIRST_PREFS.gifFps),
  };
}

/** Everything a file depends on that the person can choose: the remembered choices, and two that last only while the graphic is open. */
export interface ShareChoices extends SharePrefs {
  /** Keep a transparent graphic's transparency in a GIF or a PNG (true). */
  transparent: boolean;
  /** A picture's moment: its best one (`stillTime`), or the playhead's. */
  frame: 'best' | 'playhead';
  /** Where the playhead is, in seconds. */
  playhead: number;
}

// ── settings ──────────────────────────────────────────────────────────────

/** Everything about the file a destination makes from a graphic, and what it costs. */
export interface ShareSettings {
  dest: Destination;
  kind: ShareKind;
  /** The graphic's shape, and the file's. */
  from: Format;
  format: Format;
  /** How the file has another shape: it has not; the template built again; or the graphic fitted inside the frame. */
  reshape: 'none' | 'rebuild' | 'fit';
  /** An MP4's or a PNG's size, by its short side; null for a GIF. */
  size: Size | null;
  /** A GIF's long side in pixels; null otherwise. */
  side: number | null;
  width: number;
  height: number;
  /** An MP4's quality; null otherwise. */
  quality: Quality | null;
  /** An MP4's motion blur. */
  blur: boolean;
  /** Frames a second in the file (a PNG: the graphic's own, which picks its frame). */
  fps: number;
  /** How long the file runs (a PNG: 0), and how many frames that is. */
  seconds: number;
  frames: number;
  /** The graphic is longer than a GIF may be, and the GIF is its first `GIF.seconds`. */
  trimmed: boolean;
  /** The file keeps the graphic's transparency. */
  transparent: boolean;
  /** The graphic is transparent and the file is not (an MP4 never is). */
  alphaLost: boolean;
  /** A picture's moment in seconds, and how it was chosen; null otherwise. */
  at: number | null;
  frame: 'best' | 'playhead' | null;
  /** About how many bytes; `upTo` when it is a ceiling rather than a guess. */
  bytes: number;
  upTo: boolean;
  /** A GIF guessed over its ceiling: it will be made smaller to fit. */
  capped: boolean;
  /** About how long making it takes, in milliseconds. */
  ms: number;
}

/**
 * Milliseconds a megapixel costs, measured on an M-series Mac in the app's
 * WebKit (2026-10-03): a film is painted and encoded at about 3 to 4 ms a
 * megapixel a frame (a 6-second title at 720p, 180 frames, in 0.5 s); a GIF,
 * painted, read back, matched to its palette and compressed, at about 25 (the
 * same title as a 720-pixel GIF, 90 frames and 24 samples, in 1.1 s); a PNG
 * is one paint and the canvas's own encoder. Plus a fixed start: fonts,
 * pictures, the encoder.
 */
const COST = { paint: 2.5, h264: 1.5, gif: 22, png: 25, start: 400 } as const;

const finite = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/**
 * The settings for `dest` and `doc`, with the person's choices where the
 * destination leaves room for them (`c`, all optional: anything missing is
 * the first choice). Pure; the graphic is only read.
 */
export function settingsFor(dest: Destination, doc: Motion, given: Partial<ShareChoices> = {}): ShareSettings {
  const d: Destination = isDestination(dest) ? dest : 'custom';
  const p = readPrefs(given);
  // The choices that last only while the graphic is open, read as the remembered ones are: own fields, or none.
  const c: Partial<ShareChoices> = {};
  for (const k of ['transparent', 'frame', 'playhead'] as const) {
    try {
      if (given && typeof given === 'object' && Object.prototype.hasOwnProperty.call(given, k)) (c as Record<string, unknown>)[k] = given[k];
    } catch {
      /* a choice that cannot be read is no choice */
    }
  }
  const kind = kindOf(d, p.kind);
  // `in` would take '__proto__' or 'toString' for a shape, and every size after it would be NaN.
  const from: Format = Object.prototype.hasOwnProperty.call(FORMATS, doc.format) ? doc.format : 'landscape';
  const format = shapeFor(d, from);
  const reshape = reshapeOf(doc, format);
  const clear = seeThrough(doc.backdrop);
  const keep = c.transparent !== false;
  const fps = doc.fps > 0 ? doc.fps : 30;
  const length = Math.max(0.1, finite(doc.seconds, 1));
  const base = {
    dest: d, kind, from, format, reshape, blur: false, trimmed: false, at: null, frame: null, upTo: false, capped: false,
  } as const;

  if (kind === 'gif') {
    const side = p.gifSide;
    const { width, height } = gifSizeFor(format, side);
    const g = gifFrames(length, p.gifFps);
    const guess = estimateGifBytes(width, height, g.frames, movesEverywhere(doc));
    const mp = (width * height) / 1e6;
    const samples = Math.min(g.frames, GIF.samples);
    const once = (samples + g.frames) * mp * COST.paint + g.frames * mp * COST.gif;
    const capped = guess > GIF.maxBytes;
    return {
      ...base, size: null, side, width, height, quality: null, fps: p.gifFps, seconds: g.seconds, frames: g.frames,
      trimmed: g.trimmed, transparent: clear && keep, alphaLost: clear && !keep,
      bytes: Math.min(guess, GIF.maxBytes), capped, ms: Math.round(COST.start + once * (capped ? 2 : 1)),
    };
  }

  const size = p.size;
  const { width, height } = pixelsFor(format, size);
  const mp = (width * height) / 1e6;

  if (kind === 'png') {
    const frame = c.frame === 'playhead' ? 'playhead' : 'best';
    const out = outputOf(doc, { format, reshape });
    const at = frame === 'best' ? stillTime(out.layers, out.seconds) : Math.max(0, finite(c.playhead, 0));
    return {
      ...base, size, side: null, width, height, quality: null, fps, seconds: 0, frames: 1, transparent: clear && keep,
      alphaLost: clear && !keep, at, frame, bytes: Math.round(width * height * 0.5), ms: Math.round(COST.start + mp * (COST.paint + COST.png)),
    };
  }

  const quality = p.quality;
  const frames = frameCount({ seconds: length, fps });
  const perFrame = mp * (COST.paint * (p.blur ? 8 : 1) + COST.h264);
  return {
    ...base, size, side: null, width, height, quality, blur: p.blur, fps, seconds: length, frames,
    transparent: false, alphaLost: clear, upTo: true,
    bytes: estimateBytes({ format, fps, seconds: length }, size, quality), ms: Math.round(COST.start + frames * perFrame),
  };
}

/** How a file of shape `format` is made from `m`: as it is, its template built again, or the graphic fitted inside. */
export function reshapeOf(m: Pick<Motion, 'format' | 'recipe' | 'scenes'>, format: Format): ShareSettings['reshape'] {
  if (format === m.format) return 'none';
  return m.recipe && !(m.scenes && m.scenes.length) ? 'rebuild' : 'fit';
}

/**
 * The graphic a file is made from: the graphic itself when the shape is its
 * own, otherwise a copy in the file's shape. A template is built again for the
 * shape (`setFormat`, as the Design tab does it) with the graphic's sound kept,
 * which building again does not know about. A graphic fitted inside is the
 * graphic with the file's shape and nothing else changed: the renderer is
 * handed `fittedPaint`, which draws the graphic in its own shape and places it.
 * Never the graphic changed.
 */
export function outputOf(m: Motion, s: Pick<ShareSettings, 'format' | 'reshape'>): Motion {
  if (s.format === m.format || s.reshape === 'none') return m;
  if (s.reshape === 'rebuild') {
    const built = setFormat(m, s.format, m.updated);
    return m.sound ? { ...built, sound: m.sound } : built;
  }
  return { ...m, format: s.format };
}

/** Where a graphic fitted inside a frame goes: a rectangle in the frame's pixels. */
export interface FitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The largest rectangle of shape `from` that fits a `width × height` frame,
 * centred: a wide graphic in a tall frame is as wide as the frame, with the
 * same room above and below. Whole pixels, at least one.
 */
export function fitBox(from: Format, width: number, height: number): FitBox {
  const f = FORMATS[from] ?? FORMATS.landscape;
  const W = Math.max(1, Math.round(finite(width, 1)));
  const H = Math.max(1, Math.round(finite(height, 1)));
  const scale = Math.min(W / f.width, H / f.height);
  const w = Math.max(1, Math.min(W, Math.round(f.width * scale)));
  const h = Math.max(1, Math.min(H, Math.round(f.height * scale)));
  return { x: Math.floor((W - w) / 2), y: Math.floor((H - h) / 2), w, h };
}

/** The colour around a fitted graphic: its backdrop when that is one colour, its palette's background otherwise. */
export function surroundOf(m: Pick<Motion, 'backdrop' | 'palette'>): string {
  const b = m.backdrop;
  if (typeof b === 'string') return isTone(b) ? m.palette[b] : b;
  return m.palette.bg;
}

/**
 * A painter, in `paint`'s own shape, for a file that a graphic is fitted
 * inside: each frame paints `original` — in its own shape, at the box's size,
 * with the backdrop the renderer chose for this file (its own, or `bg` for a
 * film, which has no transparency) — into a canvas of its own, then fills the
 * frame with the colour around it (or leaves it clear, for a transparent GIF
 * or PNG) and draws the graphic into the box. Handed to `renderMp4`,
 * `renderPng` or `renderGif` as their `paint`; `canvas` makes the one canvas
 * it paints into, so this file never touches the DOM itself.
 */
export function fittedPaint(
  original: Motion,
  box: FitBox,
  canvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas,
  draw: typeof paint = paint,
): typeof paint {
  let inner: Ctx | null = null;
  return (ctx, film, t, o = {}) => {
    if (!inner) {
      const c = canvas(box.w, box.h);
      const got = typeof (c as OffscreenCanvas).convertToBlob === 'function'
        ? (c as OffscreenCanvas).getContext('2d', { alpha: true })
        : (c as HTMLCanvasElement).getContext('2d', { alpha: true });
      if (!got) throw new Error('motion:no-canvas');
      inner = got;
    }
    const look = { ...film, format: original.format, layers: original.layers, scenes: original.scenes };
    draw(inner, look, t, { width: box.w, height: box.h, clear: true, blur: o.blur, strict: o.strict, onError: o.onError });
    const width = finite(o.width ?? ctx.canvas?.width, box.w);
    const height = finite(o.height ?? ctx.canvas?.height, box.h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, width, height);
    if (!seeThrough(film.backdrop)) {
      ctx.fillStyle = surroundOf(film);
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(inner.canvas, box.x, box.y);
  };
}

/**
 * The name a file is saved under: `motionexportops.ts`'s rule for the title,
 * the file's shape as a tag, and its kind's extension. That rule names MP4s
 * and PNGs; a GIF's name is a PNG's with the extension changed, which is the
 * same length, so the eighty-character limit holds as it is.
 */
export function fileNameOf(m: Pick<Motion, 'title'>, kind: ShareKind, tag = ''): string {
  if (kind !== 'gif') return fileNameFor(m, kind, tag);
  return fileNameFor(m, 'png', tag).replace(/\.png$/, '.gif');
}
