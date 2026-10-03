/**
 * A GIF89a writer: frames of RGBA pixels in, the bytes of a looping GIF out.
 * Pure — no canvas, no DOM, no library — so a test can write a GIF, read it
 * back with a decoder of its own, and compare every pixel.
 *
 * ## Why this file exists at all
 *
 * A GIF is still what a chat, an email and a page take without a player: it
 * plays on its own, loops, and is pasted rather than uploaded. The window can
 * encode H.264 (WebCodecs) and PNG (the canvas), but nothing in it writes a
 * GIF, and Motion promises no encoding library. The format is small enough to
 * write in full: a header, a palette, and per frame a little control block and
 * the pixels' palette indices compressed with LZW.
 *
 * ## One palette for the whole animation
 *
 * A GIF may carry one global palette, or a local one per frame. This writer
 * uses **one global palette, chosen from frames sampled across the whole
 * animation** (`ColourCounter`), for three reasons that all come from what a
 * motion graphic is:
 *
 * - **No flicker.** With a palette per frame, a colour that is the same on
 *   screen for five seconds is a slightly different index and a slightly
 *   different colour in every frame, and a gradient's dither pattern moves
 *   with it: a background that should be still shimmers.
 * - **Small changes stay small.** A frame is written as only what changed
 *   since the one before (below). That works when an unchanged pixel has the
 *   same index in both frames, which only a shared palette guarantees.
 * - **Motion graphics have few colours.** The five palette tones, their
 *   anti-aliased edges and a gradient or two: 255 colours chosen once cover
 *   the whole animation, where a photograph would need a palette per frame.
 *
 * The cost is that the colours are chosen before the frames are written, so
 * the caller paints a sample of frames first (`motiongifops.ts` paints at most
 * 24, spread across the animation) and the whole animation again to encode.
 *
 * ## Choosing the colours
 *
 * Every sampled pixel is counted in a histogram of 64 levels a channel (6
 * bits; 262,144 bins, each keeping the exact sum of its colours). If the
 * animation has no more distinct colours than the palette holds, they are the
 * palette, exactly — a flat graphic loses nothing. Otherwise **median cut**:
 * the box of colours with the largest squared error is split at its weighted
 * median along its widest channel, until there are as many boxes as colours
 * allowed, and each box's colour is the exact mean of what fell in it.
 * Deterministic: every sort has a tie-breaker, and nothing is random.
 *
 * One index is always kept back for **transparency**, so a palette has at most
 * 255 colours. A transparent graphic needs it for its see-through pixels; an
 * opaque one uses it for "this pixel did not change" (below).
 *
 * ## Mapping a pixel to a colour
 *
 * A pixel whose colour is exactly in the palette gets that index — and no
 * dither, so a flat area stays flat and still. Any other colour looks up the
 * nearest palette colour through a cache of the same 64-level bins (the
 * nearest to the bin's centre, so the answer does not depend on which pixel
 * asked first). Dithering, for the colours between palette colours:
 *
 * - `ordered` (the default): an 8 × 8 Bayer threshold added before the lookup,
 *   anchored to the frame, not the content. The same colour at the same place
 *   dithers the same way in every frame, so a still gradient stays still and
 *   unchanged pixels stay unchanged. Its strength follows the palette's own
 *   spacing: half the median distance between neighbouring palette colours.
 * - `diffusion`: Floyd–Steinberg, left to right, top to bottom. Smoother for a
 *   still, but its error travels, so in an animation a small change upsets the
 *   pattern downstream of it and the frame-to-frame savings shrink.
 * - `none`.
 *
 * ## Writing only what changed
 *
 * The first frame is written whole. Each later one is written as the smallest
 * rectangle holding every pixel that differs from what is on screen, and
 * inside it a pixel that is the same is written as the transparent index —
 * "leave what is there" — which LZW packs into long runs. Two frames that are
 * the same are one frame shown for twice as long, so a hold costs nothing.
 *
 * "The same" allows one thing: a pixel whose colour is not in the palette
 * (a gradient, a soft glow) keeps the colour it showed until its true colour
 * has drifted more than 4 levels from what it was when drawn (`STICK`). A
 * moving backdrop is all such pixels, and redrawn at every change of its
 * dither it made a six-second title 60% larger; exact colours — text, flat
 * shapes, edges — are never held.
 *
 * A pixel that goes from visible to see-through cannot be written that way
 * (the transparent index means "leave it"), so the frame *before* it is
 * disposed with "restore to background", over a rectangle grown to cover
 * those pixels, and the next frame redraws what should remain. That is why a
 * frame is held back until the next one arrives: its disposal depends on it.
 * The last frame of a transparent GIF is disposed the same way, so a decoder
 * that does not clear the screen when the loop starts again does not show the
 * last frame through the first.
 *
 * ## Time
 *
 * A GIF counts delays in hundredths of a second. Each delay is the frame's
 * *end*, rounded, less the delays already written, so the rounding never adds
 * up: fifteen frames a second is 7, 6, 7, 7, 6, 7… and the total is the
 * animation's length, rounded once. A delay under 2 is written as 2, because
 * every browser shows 0 and 1 as a tenth of a second.
 *
 * ## LZW
 *
 * GIF's variant: codes from `min + 1` bits growing to 12, a clear code when the
 * table is full, an end code, least significant bit first, in blocks of at most
 * 255 bytes. The table is a direct one (a 12-bit prefix and an 8-bit index make
 * a 20-bit key) with a generation stamp, so a clear costs nothing. The code
 * size grows exactly when a decoder's does, including before the end code.
 */

/** How colours between the palette's are drawn. */
export type Dither = 'none' | 'ordered' | 'diffusion';
export const DITHERS: readonly Dither[] = ['none', 'ordered', 'diffusion'];

/** The colours a GIF is drawn with: `count` RGB triples. The transparent index is `count`, right after them. */
export interface GifPalette {
  rgb: Uint8Array;
  count: number;
}

/** The most colours a palette holds: 256 indices, one kept for transparency. */
export const MAX_COLORS = 255;

/** Below this alpha (of 255) a pixel of a transparent GIF is see-through: a GIF has no partial transparency. */
export const ALPHA_CUT = 128;

const clampInt = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number.isFinite(x) ? x : lo)));
const byte = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : x | 0);

// ── counting colours ──────────────────────────────────────────────────────

/** Bits a channel keeps in a histogram bin and in the lookup cache: 64 levels. */
const BIN_BITS = 6;
const BINS = 1 << (3 * BIN_BITS);
const binOf = (r: number, g: number, b: number) => ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);

/**
 * The colours of the frames a palette is chosen from. `add` each sampled
 * frame, then ask for a `palette`. Runs of the same colour — most of a motion
 * graphic — are counted once, so counting costs little more than reading.
 */
export class ColourCounter {
  private n = new Float64Array(BINS);
  private sr = new Float64Array(BINS);
  private sg = new Float64Array(BINS);
  private sb = new Float64Array(BINS);
  /**
   * Each bin's most common exact colour, by a majority vote (Boyer–Moore):
   * `rep` is the candidate and `votes` its lead, which is never more than how
   * often it was seen. A flat area falls in one bin with a few anti-aliased
   * neighbours, and this is how its palette colour comes out exact.
   */
  private rep = new Int32Array(BINS);
  private votes = new Float64Array(BINS);
  /** Distinct colours exactly, while there are few enough to be the palette themselves. */
  private exact: Map<number, number> | null = new Map();
  private total = 0;

  /** The pixels counted so far. */
  get pixels(): number {
    return this.total;
  }

  /**
   * Count a frame's pixels: RGBA, four bytes a pixel. With `transparent`, a
   * pixel under `ALPHA_CUT` is see-through and has no colour to count; without
   * it, alpha is ignored (the frame was drawn opaque).
   */
  add(rgba: ArrayLike<number>, transparent = false): void {
    let last = -1;
    let run = 0;
    const len = rgba.length - (rgba.length % 4);
    for (let p = 0; p < len; p += 4) {
      if (transparent && rgba[p + 3] < ALPHA_CUT) continue;
      const key = (byte(rgba[p]) << 16) | (byte(rgba[p + 1]) << 8) | byte(rgba[p + 2]);
      if (key === last) {
        run++;
        continue;
      }
      if (run) this.count(last, run);
      last = key;
      run = 1;
    }
    if (run) this.count(last, run);
  }

  private count(key: number, run: number) {
    const r = key >> 16, g = (key >> 8) & 255, b = key & 255;
    const i = binOf(r, g, b);
    this.n[i] += run;
    this.sr[i] += r * run;
    this.sg[i] += g * run;
    this.sb[i] += b * run;
    this.total += run;
    if (this.rep[i] === key) this.votes[i] += run;
    else if (this.votes[i] >= run) this.votes[i] -= run;
    else {
      this.votes[i] = run - this.votes[i];
      this.rep[i] = key;
    }
    if (this.exact) {
      this.exact.set(key, (this.exact.get(key) ?? 0) + run);
      // Past what any palette holds, an exact list is no use: stop keeping it.
      if (this.exact.size > MAX_COLORS) this.exact = null;
    }
  }

  /**
   * At most `max` colours (1 to 255) for what was counted: the colours
   * themselves when there are that few, median cut otherwise. Nothing counted
   * (every pixel see-through) is one black colour, so the GIF is still valid.
   */
  palette(max = MAX_COLORS): GifPalette {
    const most = clampInt(max, 1, MAX_COLORS);
    if (this.total === 0) return { rgb: new Uint8Array(3), count: 1 };
    if (this.exact && this.exact.size <= most) {
      // Most used first, then by value: the order is the same every time.
      const keys = [...this.exact.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((e) => e[0]);
      const rgb = new Uint8Array(keys.length * 3);
      keys.forEach((k, i) => { rgb[i * 3] = k >> 16; rgb[i * 3 + 1] = (k >> 8) & 255; rgb[i * 3 + 2] = k & 255; });
      return { rgb, count: keys.length };
    }
    return medianCut(this.n, [this.sr, this.sg, this.sb], this.rep, this.votes, most);
  }
}

interface Box { lo: number; hi: number; n: number; err: number; axis: number }

/**
 * Median cut over the histogram's bins. Each bin is one item, weighted by its
 * count and standing at its exact mean colour. A box's error is its count
 * times its variance (the squared distance of its colours from their mean);
 * the box with the most is split at the weighted median of its widest
 * channel, until there are `max` boxes or none can be split.
 *
 * A box's colour is the mean of what is in it — except a box that is mostly
 * one colour: one bin holding at least half of it, and one exact colour
 * holding at least half of that bin. That is a flat area, and it takes its own
 * colour, so it is matched exactly and never dithered.
 */
function medianCut(n: Float64Array, sums: readonly Float64Array[], rep: Int32Array, votes: Float64Array, max: number): GifPalette {
  const ids: number[] = [];
  for (let i = 0; i < BINS; i++) if (n[i] > 0) ids.push(i);
  const items = ids.length;
  const w = new Float64Array(items);
  const ch = [new Float64Array(items), new Float64Array(items), new Float64Array(items)];
  ids.forEach((bin, j) => {
    w[j] = n[bin];
    for (let c = 0; c < 3; c++) ch[c][j] = sums[c][bin] / n[bin];
  });
  const order = Array.from({ length: items }, (_, j) => j);

  const measure = (lo: number, hi: number): Box => {
    let total = 0;
    const s = [0, 0, 0];
    const q = [0, 0, 0];
    for (let k = lo; k < hi; k++) {
      const j = order[k];
      total += w[j];
      for (let c = 0; c < 3; c++) {
        s[c] += w[j] * ch[c][j];
        q[c] += w[j] * ch[c][j] * ch[c][j];
      }
    }
    const v = [0, 1, 2].map((c) => Math.max(0, q[c] / total - (s[c] / total) ** 2));
    const axis = v[1] >= v[0] && v[1] >= v[2] ? 1 : v[0] >= v[2] ? 0 : 2;
    return { lo, hi, n: total, err: hi - lo > 1 ? total * (v[0] + v[1] + v[2]) : 0, axis };
  };

  const boxes: Box[] = [measure(0, items)];
  while (boxes.length < max) {
    let pick = -1;
    for (let b = 0; b < boxes.length; b++) {
      if (boxes[b].err > 0 && (pick < 0 || boxes[b].err > boxes[pick].err)) pick = b;
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const c = ch[box.axis];
    const part = order.slice(box.lo, box.hi).sort((a, b) => c[a] - c[b] || a - b);
    for (let k = 0; k < part.length; k++) order[box.lo + k] = part[k];
    // The weighted median, kept strictly inside so both halves have an item.
    let acc = 0;
    let cut = box.lo + 1;
    for (let k = box.lo; k < box.hi - 1; k++) {
      acc += w[order[k]];
      cut = k + 1;
      if (acc >= box.n / 2) break;
    }
    boxes.splice(pick, 1, measure(box.lo, cut), measure(cut, box.hi));
  }

  const rgb = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, i) => {
    const s = [0, 0, 0];
    let top = -1;
    for (let k = box.lo; k < box.hi; k++) {
      const j = order[k];
      for (let c = 0; c < 3; c++) s[c] += w[j] * ch[c][j];
      if (top < 0 || w[j] > w[top] || (w[j] === w[top] && j < top)) top = j;
    }
    const bin = ids[top];
    if (2 * w[top] >= box.n && 2 * votes[bin] >= n[bin]) {
      const key = rep[bin];
      rgb.set([key >> 16, (key >> 8) & 255, key & 255], i * 3);
    } else {
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = byte(Math.round(s[c] / box.n));
    }
  });
  return { rgb, count: boxes.length };
}

// ── mapping pixels to the palette ─────────────────────────────────────────

/** The 8 × 8 Bayer matrix, as offsets from -0.5 to 0.5. */
const BAYER: Float32Array = (() => {
  const m = new Float32Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Interleave the bits of x ^ y and y, lowest bits first so that they weigh most: the classic
      // recursive construction, in which neighbouring pixels get thresholds as far apart as possible.
      let v = 0;
      for (let bit = 0; bit < 3; bit++) {
        const xb = ((x ^ y) >> bit) & 1;
        const yb = (y >> bit) & 1;
        v = (v << 2) | (xb << 1) | yb;
      }
      m[y * 8 + x] = (v + 0.5) / 64 - 0.5;
    }
  }
  return m;
})();

/** Exact palette colours, by open addressing, and the nearest colour per 64-level bin, filled as asked. */
class Mapper {
  readonly pal: GifPalette;
  private keys = new Int32Array(1024).fill(-1);
  private vals = new Uint8Array(1024);
  private near = new Int16Array(BINS).fill(-1);
  /** How far ordered dithering moves a channel either way. */
  readonly amp: number;

  constructor(pal: GifPalette) {
    this.pal = pal;
    for (let i = pal.count - 1; i >= 0; i--) {
      const key = (pal.rgb[i * 3] << 16) | (pal.rgb[i * 3 + 1] << 8) | pal.rgb[i * 3 + 2];
      let h = (Math.imul(key, 0x9e3779b1) >>> 22) & 1023;
      while (this.keys[h] !== -1 && this.keys[h] !== key) h = (h + 1) & 1023;
      this.keys[h] = key;
      this.vals[h] = i;
    }
    this.amp = spacing(pal) / 2;
  }

  /** The index of exactly this colour, or -1. */
  exact(key: number): number {
    let h = (Math.imul(key, 0x9e3779b1) >>> 22) & 1023;
    for (;;) {
      const k = this.keys[h];
      if (k === key) return this.vals[h];
      if (k === -1) return -1;
      h = (h + 1) & 1023;
    }
  }

  /** The palette colour nearest this one (to its bin's centre, so the answer never depends on who asked first). */
  nearest(r: number, g: number, b: number): number {
    const bin = binOf(r, g, b);
    const hit = this.near[bin];
    if (hit >= 0) return hit;
    const cr = (r & ~3) + 1.5, cg = (g & ~3) + 1.5, cb = (b & ~3) + 1.5;
    const rgb = this.pal.rgb;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.pal.count; i++) {
      const dr = rgb[i * 3] - cr, dg = rgb[i * 3 + 1] - cg, db = rgb[i * 3 + 2] - cb;
      const d = dr * dr + dg * dg + db * db;
      if (d < bestD) { bestD = d; best = i; }
    }
    this.near[bin] = best;
    return best;
  }
}

/** The median distance from each palette colour to its nearest neighbour, at most 64: how far apart the palette's steps are. */
function spacing(pal: GifPalette): number {
  if (pal.count < 2) return 0;
  const d: number[] = [];
  for (let i = 0; i < pal.count; i++) {
    let best = Infinity;
    for (let j = 0; j < pal.count; j++) {
      if (i === j) continue;
      const dr = pal.rgb[i * 3] - pal.rgb[j * 3], dg = pal.rgb[i * 3 + 1] - pal.rgb[j * 3 + 1], db = pal.rgb[i * 3 + 2] - pal.rgb[j * 3 + 2];
      best = Math.min(best, Math.sqrt(dr * dr + dg * dg + db * db));
    }
    d.push(best);
  }
  d.sort((a, b) => a - b);
  return Math.min(64, d[d.length >> 1]);
}

/**
 * A frame's pixels as palette indices into `out`: see-through pixels (when
 * `transparent`) are `clear`, exact colours their own index, and the rest the
 * nearest colour after dithering.
 */
function indexFrame(rgba: ArrayLike<number>, w: number, h: number, map: Mapper, dither: Dither, transparent: boolean, clear: number, out: Uint8Array) {
  if (dither === 'diffusion') {
    diffuse(rgba, w, h, map, transparent, clear, out);
    return;
  }
  const ordered = dither === 'ordered' && map.amp > 0;
  const amp = 2 * map.amp;
  let lastKey = -1;
  let lastIdx = 0;
  for (let y = 0, i = 0; y < h; y++) {
    const row = (y & 7) << 3;
    for (let x = 0; x < w; x++, i++) {
      const p = i << 2;
      if (transparent && rgba[p + 3] < ALPHA_CUT) {
        out[i] = clear;
        continue;
      }
      const r = byte(rgba[p]), g = byte(rgba[p + 1]), b = byte(rgba[p + 2]);
      const key = (r << 16) | (g << 8) | b;
      if (key === lastKey) {
        out[i] = lastIdx;
        continue;
      }
      const hit = map.exact(key);
      if (hit >= 0) {
        // Only an exact colour is remembered for the run: a dithered one depends on where it is.
        out[i] = lastIdx = hit;
        lastKey = key;
        continue;
      }
      lastKey = -1;
      if (ordered) {
        const d = BAYER[row | (x & 7)] * amp;
        out[i] = map.nearest(byte(r + d), byte(g + d), byte(b + d));
      } else {
        out[i] = map.nearest(r, g, b);
      }
    }
  }
}

/** Floyd–Steinberg, left to right and top to bottom. An exact colour neither takes nor passes on error. */
function diffuse(rgba: ArrayLike<number>, w: number, h: number, map: Mapper, transparent: boolean, clear: number, out: Uint8Array) {
  let cur = new Float32Array((w + 2) * 3);
  let next = new Float32Array((w + 2) * 3);
  const rgb = map.pal.rgb;
  for (let y = 0, i = 0; y < h; y++) {
    next.fill(0);
    for (let x = 0; x < w; x++, i++) {
      const p = i << 2;
      if (transparent && rgba[p + 3] < ALPHA_CUT) {
        out[i] = clear;
        continue;
      }
      const r0 = byte(rgba[p]), g0 = byte(rgba[p + 1]), b0 = byte(rgba[p + 2]);
      const hit = map.exact((r0 << 16) | (g0 << 8) | b0);
      if (hit >= 0) {
        out[i] = hit;
        continue;
      }
      const e = (x + 1) * 3;
      const r = byte(Math.round(r0 + cur[e])), g = byte(Math.round(g0 + cur[e + 1])), b = byte(Math.round(b0 + cur[e + 2]));
      const k = map.nearest(r, g, b);
      out[i] = k;
      const er = r - rgb[k * 3], eg = g - rgb[k * 3 + 1], eb = b - rgb[k * 3 + 2];
      const spread = (arr: Float32Array, at: number, f: number) => {
        arr[at] += er * f;
        arr[at + 1] += eg * f;
        arr[at + 2] += eb * f;
      };
      spread(cur, e + 3, 7 / 16);
      spread(next, e - 3, 3 / 16);
      spread(next, e, 5 / 16);
      spread(next, e + 3, 1 / 16);
    }
    [cur, next] = [next, cur];
  }
}

// ── LZW ───────────────────────────────────────────────────────────────────

/** A growing byte buffer. */
class Bytes {
  buf: Uint8Array;
  len = 0;
  constructor(size = 1024) {
    this.buf = new Uint8Array(Math.max(16, size));
  }
  private room(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
  push(b: number) {
    this.room(1);
    this.buf[this.len++] = b;
  }
  u16(v: number) {
    this.push(v & 255);
    this.push((v >> 8) & 255);
  }
  bytes(src: ArrayLike<number>) {
    this.room(src.length);
    for (let i = 0; i < src.length; i++) this.buf[this.len++] = src[i];
  }
  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

/** The LZW table: a 20-bit key (12-bit prefix code, 8-bit index) to a code, valid when its stamp is the current generation. */
class LzwTable {
  stamp = new Int32Array(1 << 20);
  code = new Uint16Array(1 << 20);
  gen = 0;
}

/**
 * Indices as GIF's LZW code stream, least significant bit first: the raw
 * bytes, before they are cut into blocks. `min` is the minimum code size, 2
 * to 8, and every index must be below `1 << min`. Exported for the tests,
 * which decode it with a decoder of their own.
 */
export function lzwEncode(indices: Uint8Array, min: number): Uint8Array {
  const m = clampInt(min, 2, 8);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= 1 << m) throw new RangeError(`lzwEncode: index ${indices[i]} needs more than ${m} bits`);
  }
  return encodeLzw(indices, m, new LzwTable());
}

function encodeLzw(indices: Uint8Array, min: number, table: LzwTable): Uint8Array {
  const out = new Bytes(Math.max(64, indices.length >> 1));
  let acc = 0;
  let nbits = 0;
  const emit = (code: number, size: number) => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(acc & 255);
      acc >>>= 8;
      nbits -= 8;
    }
  };
  const clear = 1 << min;
  const end = clear + 1;
  let size = min + 1;
  let next = end + 1;
  table.gen++;
  emit(clear, size);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      if (table.stamp[key] === table.gen) {
        prefix = table.code[key];
        continue;
      }
      emit(prefix, size);
      if (next === 4096) {
        emit(clear, size);
        size = min + 1;
        next = end + 1;
        table.gen++;
      } else {
        // The code size grows as the decoder's will: when the code about to be added no longer fits.
        if (next >= 1 << size) size++;
        table.stamp[key] = table.gen;
        table.code[key] = next++;
      }
      prefix = k;
    }
    emit(prefix, size);
    // Reading that last code, a decoder adds one more entry and may grow its code size before the end code.
    if (next >= 1 << size && size < 12) size++;
  }
  emit(end, size);
  if (nbits > 0) out.push(acc & 255);
  return out.done();
}

/** Bytes cut into GIF data sub-blocks — a length byte, then up to 255 bytes — and the empty block that ends them. */
function subBlocks(data: Uint8Array, out: Bytes) {
  for (let at = 0; at < data.length; at += 255) {
    const n = Math.min(255, data.length - at);
    out.push(n);
    out.bytes(data.subarray(at, at + n));
  }
  out.push(0);
}

// ── time ──────────────────────────────────────────────────────────────────

/** The shortest delay written, in hundredths: browsers show 0 and 1 as 10. */
export const MIN_DELAY = 2;
const MAX_DELAY = 65535;

/**
 * Delays in hundredths of a second for frames lasting `seconds` each: every
 * frame's end, rounded, less what has been written, so the total is the sum of
 * the lengths rounded once — within half a hundredth — however many frames.
 */
export function delaysFor(seconds: readonly number[]): number[] {
  let end = 0;
  let written = 0;
  return seconds.map((s) => {
    end += Number.isFinite(s) && s > 0 ? s : 0;
    const d = Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(end * 100) - written));
    written += d;
    return d;
  });
}

// ── the writer ────────────────────────────────────────────────────────────

export interface GifWriterOptions {
  width: number;
  height: number;
  palette: GifPalette;
  /** Default `ordered`. */
  dither?: Dither;
  /** Pixels under half alpha are see-through. Without it alpha is ignored. */
  transparent?: boolean;
  /** How many times to play: 0 (the default) is for ever; null writes no loop block, and it plays once. */
  loop?: number | null;
  /**
   * How far, in levels a channel, a colour that is not in the palette may
   * drift from what it was when last drawn before the pixel is drawn again
   * (`STICK`, unless given; 0 redraws every change).
   */
  tolerance?: number;
}

/**
 * How far a pixel's true colour may drift, in levels a channel, from the
 * colour it had when it was last drawn before it is drawn again: 4. A moving
 * backdrop is a slow drift of colours that are all approximations; redrawn at
 * every change, every pixel changes every frame, and a six-second title over
 * an aurora came out at 8.9 MB. Held within 4 levels it is 5.6 MB, and side by
 * side at twice the size the two cannot be told apart. A colour that is
 * exactly in the palette is never held: flat colour, text and edges are always
 * exact. Measured in the app's WebKit, 2026-10-03.
 */
export const STICK = 4;

interface Rect { x: number; y: number; w: number; h: number }

/** The smallest rectangle around every pixel `hit(i)` is true for, or null. */
function bounds(w: number, h: number, hit: (i: number) => boolean): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (!hit(i)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * A GIF written a frame at a time, so a long animation never holds more than
 * three frames of indices. `add` each frame with how long it lasts; `finish`
 * returns the file. `size` is what is written so far, for a caller watching a
 * ceiling.
 */
export class GifWriter {
  readonly width: number;
  readonly height: number;
  readonly clear: number;
  private readonly bits: number;
  private readonly map: Mapper;
  private readonly dither: Dither;
  private readonly transparent: boolean;
  private readonly tolerance: number;
  private readonly out = new Bytes(1 << 16);
  private readonly table = new LzwTable();
  /** The frame just indexed, the one held back, and what is on screen before the held one is drawn. */
  private cur: Uint8Array;
  private held: Uint8Array;
  private base: Uint8Array;
  /** Each pixel's true colour when it was last drawn: what a held pixel's drift is measured from. */
  private drawn: Uint8Array;
  private holding = false;
  private first = true;
  private heldEnd = 0;
  private time = 0;
  private written = 0;
  private finished = false;
  /** Frames in the file (after the same ones were joined). */
  frames = 0;

  constructor(o: GifWriterOptions) {
    const w = Math.round(o.width), h = Math.round(o.height);
    if (!(w >= 1 && w <= 65535 && h >= 1 && h <= 65535)) throw new RangeError(`GifWriter: bad size ${o.width} x ${o.height}`);
    const count = o.palette?.count;
    if (!(Number.isInteger(count) && count >= 1 && count <= MAX_COLORS && o.palette.rgb.length >= count * 3)) {
      throw new RangeError(`GifWriter: a palette has 1 to ${MAX_COLORS} colours`);
    }
    this.width = w;
    this.height = h;
    this.clear = count;
    // The table holds the colours and the transparent index, rounded up to a power of two.
    let bits = 1;
    while (1 << bits < count + 1) bits++;
    this.bits = bits;
    this.map = new Mapper({ rgb: o.palette.rgb.slice(0, count * 3), count });
    this.dither = DITHERS.includes(o.dither as Dither) ? (o.dither as Dither) : 'ordered';
    this.transparent = !!o.transparent;
    this.tolerance = clampInt(o.tolerance ?? STICK, 0, 64);
    const n = w * h;
    this.cur = new Uint8Array(n);
    this.held = new Uint8Array(n);
    this.base = new Uint8Array(n).fill(this.clear);
    this.drawn = new Uint8Array(this.tolerance > 0 ? n * 3 : 0);

    const out = this.out;
    out.bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    out.u16(w);
    out.u16(h);
    // A global table of 2^bits colours, 8 bits a channel, not sorted.
    out.push(0x80 | (7 << 4) | (bits - 1));
    out.push(this.clear); // background: the transparent index
    out.push(0); // square pixels
    const table = new Uint8Array(3 << bits);
    table.set(this.map.pal.rgb);
    out.bytes(table);
    const loop = o.loop === undefined ? 0 : o.loop;
    if (loop !== null) {
      out.bytes([0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 0x03, 0x01]);
      out.u16(clampInt(loop, 0, 65535));
      out.push(0);
    }
  }

  /** Bytes written so far; the frame held back is not in it yet. */
  get size(): number {
    return this.out.len;
  }

  /** One frame of RGBA pixels, `width × height × 4` bytes, shown for `seconds`. A frame of no length is skipped. */
  add(rgba: ArrayLike<number>, seconds: number): void {
    if (this.finished) throw new Error('GifWriter: already finished');
    const n = this.width * this.height;
    if (!rgba || rgba.length < n * 4) throw new RangeError(`GifWriter: a frame is ${n * 4} bytes, got ${rgba?.length}`);
    if (!(Number.isFinite(seconds) && seconds > 0)) return;
    indexFrame(rgba, this.width, this.height, this.map, this.dither, this.transparent, this.clear, this.cur);
    if (this.tolerance > 0) this.hold(rgba);
    this.time += seconds;
    if (this.holding && same(this.cur, this.held)) {
      this.heldEnd = this.time;
      return;
    }
    if (this.holding) this.flush(this.cur);
    [this.cur, this.held] = [this.held, this.cur];
    this.holding = true;
    this.heldEnd = this.time;
  }

  /**
   * Keep what the frame before showed wherever this frame's colour is not in
   * the palette and has drifted no more than `tolerance` from the colour the
   * pixel had when it was last drawn (`drawn`). The drift is measured against
   * the true colour then, not the palette colour shown, so it holds however
   * far apart the palette's colours are, and what is shown is never further
   * from the truth than the palette's step plus `tolerance`.
   */
  private hold(rgba: ArrayLike<number>) {
    const { cur, held, clear, drawn, tolerance: tol } = this;
    for (let i = 0, p = 0, q = 0; i < cur.length; i++, p += 4, q += 3) {
      const r = byte(rgba[p]), g = byte(rgba[p + 1]), b = byte(rgba[p + 2]);
      const was = held[i];
      if (this.holding && cur[i] !== was && cur[i] !== clear && was !== clear
        && Math.abs(r - drawn[q]) <= tol && Math.abs(g - drawn[q + 1]) <= tol && Math.abs(b - drawn[q + 2]) <= tol
        && this.map.exact((r << 16) | (g << 8) | b) < 0) {
        cur[i] = was;
        continue;
      }
      if (cur[i] !== was || !this.holding) {
        drawn[q] = r;
        drawn[q + 1] = g;
        drawn[q + 2] = b;
      }
    }
  }

  /** The file. Nothing can be added after. */
  finish(): Uint8Array {
    if (this.finished) throw new Error('GifWriter: already finished');
    if (!this.holding) {
      // No frame at all: one see-through frame of the shortest delay, so the file is still a GIF.
      this.held.fill(this.clear);
      this.holding = true;
      this.heldEnd = MIN_DELAY / 100;
    }
    this.flush(null);
    this.finished = true;
    this.out.push(0x3b);
    return this.out.done();
  }

  /**
   * Write the frame held back, now that the next one (`after`, or null at the
   * end) says how it must be disposed of.
   */
  private flush(after: Uint8Array | null) {
    const { width: w, height: h, clear } = this;
    const held = this.held;
    const base = this.base;
    let rect: Rect | null = this.first ? { x: 0, y: 0, w, h } : bounds(w, h, (i) => held[i] !== base[i]);
    let dispose = 1;
    // Pixels that are visible now and see-through next can only be cleared by restoring this frame's area.
    const gone = after
      ? (this.transparent ? bounds(w, h, (i) => held[i] !== clear && after[i] === clear) : null)
      : (this.transparent ? bounds(w, h, (i) => held[i] !== clear) : null);
    if (gone) {
      dispose = 2;
      rect = union(rect, gone);
    }
    // A frame that changes nothing on screen still has to hold its time: one leave-alone pixel.
    rect ??= { x: 0, y: 0, w: 1, h: 1 };

    const px = new Uint8Array(rect.w * rect.h);
    for (let y = 0, k = 0; y < rect.h; y++) {
      for (let x = 0, i = (rect.y + y) * w + rect.x; x < rect.w; x++, i++, k++) {
        px[k] = held[i] === base[i] ? clear : held[i];
      }
    }

    const end = Math.round(this.heldEnd * 100);
    const delay = Math.min(MAX_DELAY, Math.max(MIN_DELAY, end - this.written));
    this.written += delay;

    const out = this.out;
    out.bytes([0x21, 0xf9, 0x04, (dispose << 2) | 1]);
    out.u16(delay);
    out.push(clear);
    out.push(0);
    out.push(0x2c);
    out.u16(rect.x);
    out.u16(rect.y);
    out.u16(rect.w);
    out.u16(rect.h);
    out.push(0);
    const min = Math.max(2, this.bits);
    out.push(min);
    subBlocks(encodeLzw(px, min, this.table), out);
    this.frames++;
    this.first = false;

    // What the screen shows before the next frame is drawn.
    base.set(held);
    if (dispose === 2) {
      for (let y = rect.y; y < rect.y + rect.h; y++) base.fill(clear, y * w + rect.x, y * w + rect.x + rect.w);
    }
  }
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── all at once ───────────────────────────────────────────────────────────

export interface GifFrame {
  rgba: ArrayLike<number>;
  seconds: number;
}

/**
 * A whole GIF from frames held in memory: the palette from every frame, then
 * each frame written. For a few small frames — a test, a short loop; a long
 * animation goes through `ColourCounter` and `GifWriter` a frame at a time
 * (`motiongifops.ts`).
 */
export function encodeGif(
  frames: readonly GifFrame[],
  o: { width: number; height: number; colors?: number; dither?: Dither; transparent?: boolean; loop?: number | null; tolerance?: number },
): Uint8Array {
  const counter = new ColourCounter();
  for (const f of frames) counter.add(f.rgba, o.transparent);
  const writer = new GifWriter({
    width: o.width, height: o.height, palette: counter.palette(o.colors ?? MAX_COLORS),
    dither: o.dither, transparent: o.transparent, loop: o.loop, tolerance: o.tolerance,
  });
  for (const f of frames) writer.add(f.rgba, f.seconds);
  return writer.finish();
}
