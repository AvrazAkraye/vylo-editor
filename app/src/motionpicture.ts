import { LIMITS } from './motiontypes';

/**
 * A picture the person chose, made ready to live inside a graphic.
 *
 * A picture layer keeps its picture as a `data:image/` URL (motiontypes.ts,
 * `ImageLayer.src`): rendering never touches the network or the disk, and the
 * graphic is one self-contained record. That makes the size of the URL the
 * size of the record — kept in IndexedDB, copied into every undo step, read
 * at every launch — so `motionread.ts` refuses one longer than
 * `LIMITS.image`. This file is what gets a camera's twelve-megapixel photo
 * under that line without the person having to know it exists.
 *
 * ## What it does to a picture
 *
 * 1. Refuses anything that is not a PNG, JPEG, WebP, GIF or SVG, and anything
 *    over 12 MB: past that the decode alone stalls the window.
 * 2. Decodes it into an image, and draws it at most 2048 pixels on its long
 *    side — the long side of the largest frame is 1920 — never enlarged, in
 *    halving steps so a big photo is averaged rather than sampled.
 * 3. Writes it again: as PNG when it has any transparency, and always for SVG
 *    (a drawing, flat colour, often transparent) and GIF (a drawing, usually;
 *    only the first frame is kept), otherwise as JPEG at 0.9.
 * 4. When that is still longer than the limit, lowers the JPEG quality a
 *    little, then makes it smaller, until it fits; and says so when even a
 *    small one cannot.
 *
 * The decisions — which types, how big, which encoding, the size loop — are
 * pure functions below, tested in Node with a fake encoder
 * (test/motionpicture.test.mjs). Only `readPicture` touches the DOM.
 */

/** The file types a picture layer takes, as `<input accept>` wants them. */
export const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

const TYPES: ReadonlySet<string> = new Set(PICTURE_ACCEPT.split(','));

/** What a file with no type is read as, by its name's ending (a drag from some apps carries none). */
const EXTENSIONS: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
};

/** The largest file taken: 12 MB. */
export const PICTURE_MAX_BYTES = 12 * 1024 * 1024;

/** The longest side a picture is kept at, in pixels. */
export const PICTURE_MAX_SIDE = 2048;

/** A picture made smaller than this on its long side to fit is not worth keeping: it would be a smudge in any frame. */
const MIN_SIDE = 96;

/** An SVG that says nothing of its size is drawn this big on its long side. */
const SVG_SIDE = 1024;

/** The long side of a new picture layer, in u (a fraction of the frame's short side). */
export const PICTURE_LONG_U = 40;

/** Why a picture was not taken. */
export type PictureProblem = 'type' | 'size' | 'read' | 'budget';

export type PictureResult =
  | { ok: true; src: string; w: number; h: number }
  | { ok: false; why: PictureProblem };

/**
 * The type a file is taken as, or null when it is not a picture this takes.
 * The declared type first; a file with none (or the generic
 * `application/octet-stream`) is read by the ending of its name.
 */
export function pictureType(file: { type?: string; name?: string }): string | null {
  const declared = String(file.type ?? '').trim().toLowerCase();
  if (TYPES.has(declared)) return declared;
  if (declared && declared !== 'application/octet-stream') return null;
  const ext = /\.([a-z0-9]+)$/i.exec(String(file.name ?? ''))?.[1]?.toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(EXTENSIONS, ext) ? EXTENSIONS[ext] : null;
}

/** Whether a file is too big to take at all. */
export function tooBig(bytes: number, max = PICTURE_MAX_BYTES): boolean {
  return !(Number.isFinite(bytes) && bytes >= 0 && bytes <= max);
}

/**
 * A picture's size drawn at most `max` pixels on its long side: never
 * enlarged, its shape kept, whole pixels and at least one each way. Null for a
 * size that is not one.
 */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } | null {
  if (!(w > 0 && h > 0 && max > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * The size of a new picture layer in u: its long side `long`, the other in
 * proportion, both to a tenth of a u and at least a tenth — a panorama is a
 * thin strip, not a square.
 */
export function boxFor(w: number, h: number, long = PICTURE_LONG_U): { w: number; h: number } {
  if (!(w > 0 && h > 0) || !Number.isFinite(w) || !Number.isFinite(h)) return { w: long, h: long };
  const r = (x: number) => Math.max(0.1, Math.round(x * 10) / 10);
  return w >= h ? { w: r(long), h: r((long * h) / w) } : { w: r((long * w) / h), h: r(long) };
}

/**
 * How a picture is written again: PNG when it has transparency, and for SVG
 * and GIF, which are drawings (a photo in either is rare, and JPEG smears flat
 * colour); JPEG otherwise, which is a tenth of the size for a photo.
 */
export function outputType(type: string, transparent: boolean): 'image/png' | 'image/jpeg' {
  return transparent || type === 'image/svg+xml' || type === 'image/gif' ? 'image/png' : 'image/jpeg';
}

/** Whether any pixel of RGBA data is less than opaque. */
export function anyTransparent(data: ArrayLike<number>): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

/**
 * The drawing size an SVG declares, from its `width` and `height` (in
 * pixels, or unitless) or else its `viewBox`; null when it declares none. An
 * SVG drawn as an image with no size has none of its own, and each engine
 * guesses a different one.
 */
export function svgSize(text: string): { w: number; h: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(String(text).slice(0, 20000))?.[0];
  if (!tag) return null;
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const px = (v: string | undefined) => {
    const m = v ? /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/i.exec(v) : null;
    return m ? Number(m[1]) : NaN;
  };
  const w = px(attr('width'));
  const h = px(attr('height'));
  if (w > 0 && h > 0) return { w, h };
  const box = (attr('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (box.length === 4 && box[2] > 0 && box[3] > 0 && box.every(Number.isFinite)) return { w: box[2], h: box[3] };
  return null;
}

/**
 * The size an SVG is drawn at: its own shape, `SVG_SIDE` on the long side
 * whatever it declares — a drawing is sharp at any size, and a 24-pixel logo
 * drawn at 24 pixels would be a blur in a 1080 frame.
 */
export function svgDrawSize(declared: { w: number; h: number } | null): { w: number; h: number } {
  const d = declared && declared.w > 0 && declared.h > 0 ? declared : { w: 1, h: 1 };
  const k = SVG_SIDE / Math.max(d.w, d.h);
  return { w: Math.max(1, Math.round(d.w * k)), h: Math.max(1, Math.round(d.h * k)) };
}

/** Writes the picture at a size and quality, as a data URL. */
export type Encoder = (w: number, h: number, quality: number) => string;

/**
 * The picture written small enough: first at `size`; a JPEG then at a lower
 * quality (0.8, then 0.7), and then — either kind — made smaller, by about as
 * much as it was over, until the URL is at most `budget` characters. Null when
 * it would have to be smaller than `MIN_SIDE` on its long side to fit, or has
 * not fitted after a dozen tries.
 */
export function fitToBudget(
  size: { w: number; h: number },
  budget: number,
  encode: Encoder,
  jpeg: boolean,
): { src: string; w: number; h: number; quality: number } | null {
  let { w, h } = size;
  let quality = jpeg ? 0.9 : 1;
  for (let tries = 0; tries < 12; tries++) {
    const src = encode(w, h, quality);
    if (src.length <= budget) return { src, w, h, quality };
    if (jpeg && quality > 0.75) {
      quality = Math.round((quality - 0.1) * 10) / 10;
      continue;
    }
    // Area, and so roughly bytes, goes with the square of the side: shrink by
    // the square root of how far over it is, and a little more, so it lands
    // under rather than circling the line.
    const k = Math.min(0.9, Math.max(0.35, Math.sqrt(budget / src.length) * 0.92));
    const next = { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
    if (Math.max(next.w, next.h) < MIN_SIDE) return null;
    ({ w, h } = next);
  }
  return null;
}

// ── in the window ─────────────────────────────────────────────────────────

function readAs(file: Blob, how: 'url' | 'text'): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => (typeof r.result === 'string' ? resolve(r.result) : reject(new Error('unreadable')));
    r.onerror = () => reject(r.error ?? new Error('unreadable'));
    if (how === 'url') r.readAsDataURL(file);
    else r.readAsText(file);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('undecodable'));
    img.src = src;
  });
}

function canvas(w: number, h: number): { el: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const ctx = el.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { el, ctx };
}

/**
 * The picture drawn at `w` x `h`, halving from its own size first when it is
 * more than twice as big: one draw from 6000 pixels to 2000 samples rather
 * than averages, and a photo's fine detail comes out as grain.
 */
function drawAt(img: CanvasImageSource, from: { w: number; h: number }, w: number, h: number) {
  let src: CanvasImageSource = img;
  let cur = { ...from };
  while (cur.w / 2 >= w && cur.h / 2 >= h) {
    const half = canvas(Math.max(1, Math.round(cur.w / 2)), Math.max(1, Math.round(cur.h / 2)));
    if (!half) break;
    half.ctx.drawImage(src, 0, 0, half.el.width, half.el.height);
    src = half.el;
    cur = { w: half.el.width, h: half.el.height };
  }
  const out = canvas(w, h);
  if (!out) return null;
  out.ctx.drawImage(src, 0, 0, w, h);
  return out;
}

/**
 * A file the person chose, as a picture for a layer: its data URL (at most
 * `LIMITS.image` characters) and its size in pixels — or why it was not
 * taken. Never throws.
 */
export async function readPicture(file: File, budget: number = LIMITS.image): Promise<PictureResult> {
  const type = pictureType(file);
  if (!type) return { ok: false, why: 'type' };
  if (tooBig(file.size)) return { ok: false, why: 'size' };
  try {
    const url = await readAs(file, 'url');
    const img = await decode(url);
    let natural = { w: img.naturalWidth, h: img.naturalHeight };
    let target: { w: number; h: number } | null;
    if (type === 'image/svg+xml') {
      const declared = svgSize(await readAs(file, 'text').catch(() => ''));
      target = svgDrawSize(declared ?? (natural.w > 0 && natural.h > 0 ? natural : null));
      natural = target;
    } else {
      target = fitWithin(natural.w, natural.h, PICTURE_MAX_SIDE);
    }
    if (!target) return { ok: false, why: 'read' };
    const first = drawAt(img, natural, target.w, target.h);
    if (!first) return { ok: false, why: 'read' };
    const opaque = type === 'image/jpeg' || !anyTransparent(first.ctx.getImageData(0, 0, target.w, target.h).data);
    const out = outputType(type, !opaque);
    let cache = { w: target.w, h: target.h, el: first.el };
    const encode: Encoder = (w, h, quality) => {
      if (w !== cache.w || h !== cache.h) {
        const next = drawAt(img, natural, w, h);
        if (!next) return '';
        cache = { w, h, el: next.el };
      }
      return cache.el.toDataURL(out, quality);
    };
    const fitted = fitToBudget(target, budget, encode, out === 'image/jpeg');
    if (!fitted || !fitted.src.startsWith('data:image/')) return { ok: false, why: fitted ? 'read' : 'budget' };
    return { ok: true, src: fitted.src, w: fitted.w, h: fitted.h };
  } catch {
    return { ok: false, why: 'read' };
  }
}
