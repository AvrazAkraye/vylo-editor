// Export and sharing (work package 09): the GIF writer, the GIF export, the
// destinations, and the Export tab's first screen.
//
// The GIF is checked by reading it back with a decoder written here, from the
// GIF89a specification and nothing of motiongif.ts: the header and the
// logical screen, the palette's size, every LZW stream decoded and compared
// index for index (including streams long enough to fill the table and clear
// it), the loop block, the delays adding up to the graphic's length to within
// a hundredth, transparency — including pixels that go from visible to
// see-through, which only a disposal can write — and determinism. The
// palette is attacked from both ends: one colour, 256 colours, every pixel
// different, frames of one pixel and frames of a million. When ffmpeg is
// installed, its decoder must see the same frames, pixel for pixel.
//
// The GIF export runs with the painter, the canvas and the loader replaced by
// fakes that paint real pixels (a box that moves), so the whole loop is
// exercised: fonts first, frame i at i / fps, colours sampled across the
// animation, transparency kept or drawn over the background from a copy,
// progress, Cancel, and the ladder that makes a GIF smaller to fit.
//
// The destinations are a table, tested as one: every destination for every
// shape, and the graphic never changed. The readers are fuzzed.
//
// The Export tab is built here with esbuild and rendered with React's server
// renderer, which runs no effects: what it checks is the first screen's
// structure — six cards, one chosen, one button, More options closed — in
// every shape and in Arabic. How it looks in the app's own WebKit is not
// something a test in Node can say.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  ALPHA_CUT, ColourCounter, DITHERS, GifWriter, MAX_COLORS, MIN_DELAY, STICK, delaysFor, encodeGif, lzwEncode,
} from '../.test-build/motiongif.js';
import {
  GIF, GIF_RATES, GIF_SIDES, cutsBetween, estimateGifBytes, gifFrames, gifPlan, gifSizeFor, movesEverywhere, renderGif,
  seeThrough, smaller,
} from '../.test-build/motiongifops.js';
import {
  DESTINATIONS, FIRST_PREFS, SHARE_KINDS, bestDestination, destinationLine, destinationName, destinationStep, fileNameOf,
  fitBox, fittedPaint, kindOf, outputOf, ratioOf, readPrefs, reshapeOf, settingsFor, shapeFor, surroundOf,
} from '../.test-build/motionshare.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { stillTime } from '../.test-build/motionanim.js';
import { estimateBytes, fileNameFor, pixelsFor } from '../.test-build/motionexportops.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rejection = async (p) => { try { await p; return null; } catch (e) { return e; } };
const throws = (f) => { try { f(); return null; } catch (e) { return e; } };
const started = Date.now();

// ── a GIF decoder, from the specification ─────────────────────────────────

/** GIF's LZW: codes of `min + 1` bits growing to 12, least significant bit first. */
function lzwDecode(data, min, expect = Infinity) {
  const clear = 1 << min, end = clear + 1;
  let size = min + 1, next = end + 1, prev = -1;
  const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), length = new Int32Array(4096);
  for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; length[i] = 1; }
  const out = [];
  let bit = 0, sawEnd = false;
  const total = data.length * 8;
  const read = () => {
    let v = 0;
    for (let i = 0; i < size; i++, bit++) v |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    return v;
  };
  const first = (code) => { while (prefix[code] >= 0) code = prefix[code]; return suffix[code]; };
  const emit = (code) => {
    const at = out.length;
    for (let c = code, i = length[code] - 1; i >= 0; i--, c = prefix[c]) out[at + i] = suffix[c];
  };
  while (bit + size <= total) {
    const code = read();
    if (code === clear) { size = min + 1; next = end + 1; prev = -1; continue; }
    if (code === end) { sawEnd = true; break; }
    if (prev < 0) {
      if (code >= clear) throw new Error(`a first code ${code} that is not a root`);
      emit(code);
      prev = code;
      continue;
    }
    let k;
    if (code < next) { emit(code); k = first(code); }
    else if (code === next) { k = first(prev); emit(prev); out.push(k); }
    else throw new Error(`code ${code} past the table (${next})`);
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = k; length[next] = length[prev] + 1; next++;
      if (next === 1 << size && size < 12) size++;
    }
    prev = code;
    if (out.length > expect) throw new Error('more pixels than the image has');
  }
  const rest = total - bit;
  const tail = rest > 0 ? data[data.length - 1] >> (8 - rest) : 0;
  return { indices: Uint8Array.from(out), sawEnd, rest, tail };
}

/**
 * A whole GIF: its screen, palette, loop count, and every frame composed onto
 * the screen as a browser shows it — the frame's pixels where they are not the
 * transparent index, then its disposal before the next.
 */
function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const blocks = () => {
    const parts = [];
    for (let n = u8(); n; n = u8()) { parts.push(...bytes.subarray(p, p + n)); p += n; }
    return Uint8Array.from(parts);
  };
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  p = 6;
  const width = u16(), height = u16(), packed = u8(), background = u8(), aspect = u8();
  const hasTable = !!(packed & 0x80);
  const tableSize = hasTable ? 1 << ((packed & 7) + 1) : 0;
  const table = bytes.slice(p, p + 3 * tableSize);
  p += 3 * tableSize;
  const screen = new Uint8ClampedArray(width * height * 4);
  const frames = [];
  const lzw = [];
  let loop = null, gce = null, trailer = false;
  while (p < bytes.length) {
    const b = u8();
    if (b === 0x3b) { trailer = true; break; }
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const n = u8();
        const pk = u8();
        gce = { size: n, disposal: (pk >> 2) & 7, transparent: !!(pk & 1), delay: u16(), index: u8() };
        u8();
      } else if (label === 0xff) {
        const n = u8();
        const id = String.fromCharCode(...bytes.subarray(p, p + n));
        p += n;
        const data = blocks();
        if (id === 'NETSCAPE2.0' && data[0] === 1) loop = data[1] | (data[2] << 8);
      } else blocks();
      continue;
    }
    if (b !== 0x2c) throw new Error(`unexpected byte ${b} at ${p - 1}`);
    const x = u16(), y = u16(), w = u16(), h = u16(), ipk = u8();
    if (ipk & 0x80) throw new Error('a local colour table: this writer never writes one');
    const min = u8();
    const data = blocks();
    const got = lzwDecode(data, min, w * h);
    lzw.push({ ...got, min, pixels: w * h });
    const g = gce ?? { disposal: 0, transparent: false, delay: 0, index: -1 };
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const idx = got.indices[yy * w + xx];
        if (g.transparent && idx === g.index) continue;
        const at = ((y + yy) * width + (x + xx)) * 4;
        screen[at] = table[idx * 3]; screen[at + 1] = table[idx * 3 + 1]; screen[at + 2] = table[idx * 3 + 2]; screen[at + 3] = 255;
      }
    }
    frames.push({ rgba: screen.slice(), delay: g.delay, disposal: g.disposal, rect: { x, y, w, h }, transparent: g.transparent, index: g.index });
    if (g.disposal === 2) {
      for (let yy = 0; yy < h; yy++) screen.fill(0, ((y + yy) * width + x) * 4, ((y + yy) * width + x + w) * 4);
    }
    gce = null;
  }
  return { signature, width, height, packed, background, aspect, hasTable, tableSize, table, loop, frames, lzw, trailer, end: p };
}

// ── pixels to write ───────────────────────────────────────────────────────

const PAL = { bg: [11, 16, 32], fg: [245, 247, 255], accent: [76, 141, 255] };
/** A w × h frame of one colour, opaque. */
const flat = (w, h, [r, g, b], a = 255) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, a], i * 4);
  return px;
};
/** A box drawn into a frame. */
const box = (px, w, x0, y0, bw, bh, [r, g, b], a = 255) => {
  for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) px.set([r, g, b, a], (y * w + x) * 4);
  return px;
};
/** Every pixel's colour and alpha the same in two frames (alpha 0 pixels compared by alpha only). */
function sameFrame(a, b, tol = 0) {
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] !== b[i + 3]) return { at: i / 4, a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] };
    if (a[i + 3] === 0) continue;
    worst = Math.max(worst, Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (worst > tol) return { at: i / 4, worst, a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] };
  }
  return null;
}
const totalDelay = (g) => g.frames.reduce((s, f) => s + f.delay, 0);
/** A frame's pixels as the GIF should show them: alpha cut at half, colour kept. */
const asShown = (px) => {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < ALPHA_CUT) continue;
    out.set([px[i], px[i + 1], px[i + 2], 255], i);
  }
  return out;
};
let seed = 7;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };

// ── LZW ───────────────────────────────────────────────────────────────────
{
  const cases = [];
  for (const min of [2, 3, 4, 5, 6, 7, 8]) {
    const top = 1 << min;
    cases.push([`min ${min}, one index`, min, Uint8Array.of(top - 1)]);
    cases.push([`min ${min}, two`, min, Uint8Array.of(0, top - 1)]);
    cases.push([`min ${min}, a long run`, min, new Uint8Array(20000).fill(1)]);
    cases.push([`min ${min}, random`, min, Uint8Array.from({ length: 30000 }, () => Math.floor(rand() * top))]);
    cases.push([`min ${min}, a ramp`, min, Uint8Array.from({ length: 9000 }, (_, i) => i % top)]);
  }
  // Exactly the lengths around a code-size change: the end code is where a writer gets it wrong.
  for (let n = 1; n <= 40; n++) cases.push([`min 2, ${n} distinct-ish indices`, 2, Uint8Array.from({ length: n }, (_, i) => (i * 7 + (i >> 2)) & 3)]);
  cases.push(['nothing at all', 2, new Uint8Array(0)]);
  let bad = [];
  let clears = 0;
  for (const [name, min, src] of cases) {
    const data = lzwEncode(src, min);
    let got;
    try { got = lzwDecode(data, min); } catch (e) { bad.push([name, e.message]); continue; }
    if (!got.sawEnd || got.indices.length !== src.length || got.indices.some((v, i) => v !== src[i])) bad.push([name, got.indices.length, src.length, got.sawEnd]);
    else if (got.rest >= 8 || got.tail !== 0) bad.push([name, 'trailing', got.rest, got.tail]);
    if (src.length >= 30000 && min === 8) clears++;
  }
  ok(`LZW: ${cases.length} streams decode to exactly what was written, each ending on its end code`, bad.length === 0, bad.slice(0, 3));
  // A random stream at 8 bits fills the 4,096-entry table several times over: the clear code is exercised.
  const big = Uint8Array.from({ length: 200000 }, () => Math.floor(rand() * 256));
  const data = lzwEncode(big, 8);
  let codes = 0;
  { const g = lzwDecode(data, 8); codes = g.indices.length; }
  ok('LZW: a stream that fills the table again and again (200,000 random bytes) still decodes', codes === big.length && clears > 0);
  ok('LZW: an index too large for the code size is refused', throws(() => lzwEncode(Uint8Array.of(4), 2)) instanceof RangeError);
  ok('LZW: the same input, the same bytes', same([...lzwEncode(big.subarray(0, 5000), 8)], [...lzwEncode(big.subarray(0, 5000), 8)]));
}

// ── delays ────────────────────────────────────────────────────────────────
{
  ok('15 frames a second is 7, 6, 7, 7, 6, 7…', same(delaysFor(Array(6).fill(1 / 15)), [7, 6, 7, 7, 6, 7]), delaysFor(Array(6).fill(1 / 15)));
  let worst = 0, cases = 0;
  for (const fps of [5, 6, 8, 10, 12, 15, 20, 24, 25, 30, 50]) {
    for (let cs = 50; cs <= 1500; cs += 7) {
      // The frames a GIF has (gifFrames: the last runs to the end, and is never a sliver).
      const seconds = cs / 100;
      const { frames: n } = gifFrames(seconds, fps);
      const spans = Array.from({ length: n }, (_, i) => (i + 1 >= n ? seconds : (i + 1) / fps) - i / fps);
      const d = delaysFor(spans);
      worst = Math.max(worst, Math.abs(d.reduce((a, b) => a + b, 0) - seconds * 100));
      cases++;
    }
  }
  ok(`the delays of ${cases} rates and lengths add up to the length, within half a hundredth`, worst <= 0.5 + 1e-9, worst);
  ok('a last frame that would be a sliver is joined to the one before: 1.27 s at 15 is 19 frames', gifFrames(1.27, 15).frames === 19 && gifFrames(1.3, 15).frames === 20);
  ok(`no delay is under ${MIN_DELAY} hundredths (browsers slow those to a tenth)`, delaysFor(Array(10).fill(0.004)).every((d) => d >= MIN_DELAY));
  ok('a length that is not a number counts as nothing', same(delaysFor([NaN, 0.1]), [2, 8]), delaysFor([NaN, 0.1]));
}

// ── the file ──────────────────────────────────────────────────────────────
{
  const w = 40, h = 24;
  const frames = [];
  for (let i = 0; i < 12; i++) frames.push({ rgba: box(flat(w, h, PAL.bg), w, 2 + i * 2, 6, 8, 8, PAL.fg), seconds: 1 / 10 });
  const bytes = encodeGif(frames, { width: w, height: h });
  const g = decodeGif(bytes);
  ok('it starts GIF89a', g.signature === 'GIF89a');
  ok('the logical screen is the frame: 40 × 24, square pixels', g.width === 40 && g.height === 24 && g.aspect === 0);
  ok('a global palette, 8 bits a channel, no local ones', g.hasTable && ((g.packed >> 4) & 7) === 7);
  ok('two colours and a transparent index: a table of 4', g.tableSize === 4, g.tableSize);
  ok('the background is the transparent index', g.background === 2);
  ok('it loops for ever (NETSCAPE2.0, count 0)', g.loop === 0);
  ok('it ends with the trailer, and nothing after it', g.trailer && g.end === bytes.length);
  ok('every frame decodes to exactly its rectangle\'s pixels', g.lzw.every((l) => l.sawEnd && l.indices.length === l.pixels));
  ok('the LZW minimum code size is 2 for a table of 4', g.lzw.every((l) => l.min === 2));
  ok('twelve frames, each the one written, exactly', g.frames.length === 12 && g.frames.every((f, i) => sameFrame(f.rgba, frames[i].rgba) === null),
    g.frames.map((f, i) => sameFrame(f.rgba, frames[i].rgba)).find(Boolean));
  ok('the first frame is the whole screen; the rest only what moved', same(g.frames[0].rect, { x: 0, y: 0, w: 40, h: 24 })
    && g.frames.slice(1).every((f) => f.rect.w <= 10 && f.rect.h === 8 && f.rect.y === 6), g.frames.slice(1, 3).map((f) => f.rect));
  ok('every frame has the transparent index on, for the pixels it leaves alone', g.frames.every((f) => f.transparent && f.index === 2));
  ok('a tenth of a second each, 1.2 s in all', g.frames.every((f) => f.delay === 10) && totalDelay(g) === 120);
  ok('the same frames, the same bytes', same([...bytes], [...encodeGif(frames, { width: w, height: h })]));
  const once = decodeGif(encodeGif(frames, { width: w, height: h, loop: null }));
  ok('loop: null writes no loop block, and it plays once', once.loop === null && once.frames.length === 12);
  ok('loop: 3 plays it three times', decodeGif(encodeGif(frames, { width: w, height: h, loop: 3 })).loop === 3);
}

// ── holds, and the length ─────────────────────────────────────────────────
{
  const w = 30, h = 20;
  const fps = 15, seconds = 2.5;
  const n = Math.ceil(seconds * fps);
  const writer = new GifWriter({ width: w, height: h, palette: (() => { const c = new ColourCounter(); c.add(box(flat(w, h, PAL.bg), w, 0, 0, 5, 5, PAL.accent)); return c.palette(); })() });
  const src = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    // Moves for the first second, then holds.
    const x = Math.round(Math.min(1, t) * 20);
    const px = box(flat(w, h, PAL.bg), w, x, 5, 5, 5, PAL.accent);
    src.push(px);
    writer.add(px, Math.min((i + 1) / fps, seconds) - t);
  }
  const g = decodeGif(writer.finish());
  ok('frames that are the same are one frame, held: 38 painted, far fewer written', g.frames.length < n / 2 && writer.frames === g.frames.length, [g.frames.length, n]);
  ok('the last frame holds for the whole hold', g.frames[g.frames.length - 1].delay >= 100, g.frames[g.frames.length - 1].delay);
  ok('2.5 s at 15 a second is 250 hundredths, exactly', totalDelay(g) === 250, totalDelay(g));
  let t = 0, bad = null;
  for (const f of g.frames) {
    const i = Math.min(n - 1, Math.round((t / 100) * fps));
    if (sameFrame(f.rgba, src[i])) { bad = [t, i]; break; }
    t += f.delay;
  }
  ok('each written frame is the painted frame at its time', bad === null, bad);
  ok('a frame of no length is skipped', (() => {
    const wr = new GifWriter({ width: 2, height: 2, palette: { rgb: Uint8Array.of(1, 2, 3), count: 1 } });
    wr.add(flat(2, 2, [1, 2, 3]), 0); wr.add(flat(2, 2, [1, 2, 3]), NaN); wr.add(flat(2, 2, [1, 2, 3]), 0.5);
    const d = decodeGif(wr.finish());
    return d.frames.length === 1 && d.frames[0].delay === 50;
  })());
  const empty = decodeGif(new GifWriter({ width: 3, height: 3, palette: { rgb: Uint8Array.of(9, 9, 9), count: 1 } }).finish());
  ok('a writer given no frame still makes a GIF: one see-through frame', empty.frames.length === 1 && empty.frames[0].rgba.every((v) => v === 0));
}

// ── for every length a graphic may have, the GIF's delays are its length ──
{
  let worst = 0;
  const w = 8, h = 8;
  for (const fps of GIF_RATES) {
    for (const seconds of [1, 1.3, 2.5, 4.7, 9.9, 15]) {
      const { frames, seconds: len } = gifFrames(seconds, fps);
      const writer = new GifWriter({ width: w, height: h, palette: { rgb: Uint8Array.of(0, 0, 0, 255, 255, 255), count: 2 } });
      for (let i = 0; i < frames; i++) writer.add(box(flat(w, h, [0, 0, 0]), w, i % 8, 0, 1, 1, [255, 255, 255]), (i + 1 >= frames ? len : (i + 1) / fps) - i / fps);
      worst = Math.max(worst, Math.abs(totalDelay(decodeGif(writer.finish())) - len * 100));
    }
  }
  ok('at 10, 15 and 20 a second, every length from 1 to 15 s is within a hundredth of the graphic\'s', worst <= 1, worst);
}

// ── transparency ──────────────────────────────────────────────────────────
{
  const w = 24, h = 16;
  const clear = () => new Uint8ClampedArray(w * h * 4);
  const frames = [
    { rgba: box(clear(), w, 2, 2, 10, 10, PAL.fg), seconds: 0.2 },
    // The box moves right: its old pixels must become see-through again.
    { rgba: box(clear(), w, 10, 2, 10, 10, PAL.fg), seconds: 0.2 },
    // Half-transparent edges: under half alpha is gone, over it is kept.
    { rgba: box(box(clear(), w, 10, 2, 10, 10, PAL.fg), w, 4, 4, 3, 3, PAL.accent, 100), seconds: 0.2 },
    { rgba: box(box(clear(), w, 10, 2, 10, 10, PAL.fg), w, 4, 4, 3, 3, PAL.accent, 200), seconds: 0.2 },
    // Everything gone.
    { rgba: clear(), seconds: 0.2 },
    { rgba: box(clear(), w, 0, 0, 3, 3, PAL.accent), seconds: 0.2 },
  ];
  const g = decodeGif(encodeGif(frames, { width: w, height: h, transparent: true }));
  // Under half alpha is not shown, so the third frame is the second, held: five frames.
  const shown = frames.map((f) => asShown(f.rgba)).filter((f, i, all) => i === 0 || sameFrame(f, all[i - 1]) !== null);
  const diffs = g.frames.map((f, i) => sameFrame(f.rgba, shown[i]));
  ok('a transparent GIF shows each frame exactly: see-through where it should be, even where something was', g.frames.length === 5 && diffs.every((d) => d === null),
    [g.frames.length, diffs.find(Boolean)]);
  ok('pixels that go see-through are cleared by the frame before (disposal 2), and only then', same(g.frames.map((f) => f.disposal), [2, 1, 2, 1, 2]), g.frames.map((f) => f.disposal));
  ok('a pixel under half alpha is see-through, over it shown', g.frames[1].delay === 40 && g.frames[2].rgba[(4 * w + 4) * 4 + 3] === 255);
  ok('the last frame is cleared too, so the loop starts on a clean screen', g.frames[g.frames.length - 1].disposal === 2);
  const opaque = decodeGif(encodeGif(frames.map((f) => ({ ...f, rgba: f.rgba.map((v, i) => (i % 4 === 3 ? 255 : v)) })), { width: w, height: h }));
  ok('without transparent, alpha is ignored and nothing is disposed', opaque.frames.every((f) => f.disposal === 1) && opaque.frames.every((f) => f.rgba.every((v, i) => i % 4 !== 3 || v === 255)));
  const none = decodeGif(encodeGif([{ rgba: clear(), seconds: 1 }], { width: w, height: h, transparent: true }));
  ok('a frame with nothing visible is a valid, see-through GIF', none.frames.length === 1 && none.frames[0].rgba.every((v) => v === 0) && none.tableSize === 2);
}

// ── hostile palettes, tiny and large frames ───────────────────────────────
{
  const one = decodeGif(encodeGif([{ rgba: flat(10, 10, [200, 30, 60]), seconds: 1 }], { width: 10, height: 10 }));
  ok('one colour: a table of 2, the colour exact', one.tableSize === 2 && sameFrame(one.frames[0].rgba, flat(10, 10, [200, 30, 60])) === null);

  const w = 16, h = 16;
  const all = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < 256; i++) all.set([i, 255 - i, (i * 37) & 255, 255], i * 4);
  const g256 = decodeGif(encodeGif([{ rgba: all, seconds: 1 }], { width: w, height: h }));
  const d256 = sameFrame(g256.frames[0].rgba, all, 24);
  ok('256 colours: a table of 256 (255 colours and transparency), every pixel within 24 levels', g256.tableSize === 256 && d256 === null, d256);

  const few = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < 256; i++) few.set([(i % 5) * 60, ((i >> 3) % 7) * 40, 90, 255], i * 4);
  const gf = decodeGif(encodeGif([{ rgba: few, seconds: 1 }], { width: w, height: h }));
  ok('35 colours are the palette exactly: nothing lost', sameFrame(gf.frames[0].rgba, few) === null && gf.tableSize === 64);

  const W = 64, H = 64;
  const noise = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) noise.set([rand() * 256, rand() * 256, rand() * 256, 255], i * 4);
  for (const dither of DITHERS) {
    const g = decodeGif(encodeGif([{ rgba: noise, seconds: 1 }], { width: W, height: H, dither }));
    let err = 0;
    for (let i = 0; i < noise.length; i += 4) err += Math.abs(g.frames[0].rgba[i] - noise[i]) + Math.abs(g.frames[0].rgba[i + 1] - noise[i + 1]) + Math.abs(g.frames[0].rgba[i + 2] - noise[i + 2]);
    const mean = err / (W * H * 3);
    ok(`every pixel different (4,096 random colours), ${dither}: decodes, and on average within 24 levels`, g.lzw[0].sawEnd && mean < 24, mean);
  }

  for (const [tw, th] of [[1, 1], [1, 7], [7, 1], [2, 2]]) {
    const frames = [{ rgba: flat(tw, th, [1, 2, 3]), seconds: 0.1 }, { rgba: flat(tw, th, [250, 2, 3]), seconds: 0.1 }];
    const g = decodeGif(encodeGif(frames, { width: tw, height: th }));
    ok(`a ${tw} × ${th} GIF`, g.width === tw && g.height === th && g.frames.length === 2 && sameFrame(g.frames[1].rgba, frames[1].rgba) === null);
  }

  const L = 1080;
  const t0 = Date.now();
  const big = [0, 1, 2].map((i) => ({ rgba: box(flat(L, L, PAL.bg), L, 100 + i * 200, 400, 300, 200, PAL.fg), seconds: 0.5 }));
  const gb = decodeGif(encodeGif(big, { width: L, height: L }));
  ok('a 1080 × 1080 GIF of three frames, each exact', gb.frames.length === 3 && gb.frames.every((f, i) => sameFrame(f.rgba, big[i].rgba) === null));
  ok('and it is small: the later frames are only their change', gb.frames.slice(1).every((f) => f.rect.w * f.rect.h < (L * L) / 4), gb.frames.map((f) => f.rect));
  console.log(`        (1080 × 1080, three frames, written and read back in ${Date.now() - t0} ms)`);

  ok('a size of 0 or past 65,535 is refused', throws(() => new GifWriter({ width: 0, height: 5, palette: { rgb: Uint8Array.of(0, 0, 0), count: 1 } })) instanceof RangeError
    && throws(() => new GifWriter({ width: 70000, height: 5, palette: { rgb: Uint8Array.of(0, 0, 0), count: 1 } })) instanceof RangeError);
  ok('a palette of 0 or 256 colours is refused (one index is transparency)', throws(() => new GifWriter({ width: 2, height: 2, palette: { rgb: new Uint8Array(0), count: 0 } })) instanceof RangeError
    && throws(() => new GifWriter({ width: 2, height: 2, palette: { rgb: new Uint8Array(768), count: 256 } })) instanceof RangeError && MAX_COLORS === 255);
  const wr = new GifWriter({ width: 2, height: 2, palette: { rgb: Uint8Array.of(0, 0, 0), count: 1 } });
  ok('a frame too short for the size is refused', throws(() => wr.add(new Uint8ClampedArray(12), 1)) instanceof RangeError);
  wr.finish();
  ok('nothing is added to, or finished twice, a finished writer', /finished/.test(throws(() => wr.add(flat(2, 2, [0, 0, 0]), 1))?.message) && /finished/.test(throws(() => wr.finish())?.message));
}

// ── the palette: chosen across frames, flat colours exact, still things still ─
{
  const w = 64, h = 36;
  const grad = (shift) => {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([20 + x * 3, 30 + y * 2, 120 + ((x + y) & 63), 255], (y * w + x) * 4);
    return box(px, w, 4 + shift, 10, 12, 12, PAL.fg);
  };
  const frames = [0, 4, 8, 12, 12].map((s) => ({ rgba: grad(s), seconds: 0.1 }));
  const counter = new ColourCounter();
  for (const f of frames) counter.add(f.rgba);
  const pal = counter.palette(255);
  ok('more colours than a palette holds: median cut gives 255', pal.count === 255 && counter.pixels === w * h * 5);
  const hasFg = Array.from({ length: pal.count }, (_, i) => [...pal.rgb.subarray(i * 3, i * 3 + 3)]).some((c) => same(c, PAL.fg));
  ok('a flat colour among many is in the palette exactly (the box takes its majority colour)', hasFg);
  const g = decodeGif(encodeGif(frames, { width: w, height: h }));
  const fgExact = g.frames.every((f, i) => {
    for (let y = 10; y < 22; y++) for (let x = 4 + [0, 4, 8, 12, 12][i]; x < 16 + [0, 4, 8, 12, 12][i]; x++) {
      const at = (y * w + x) * 4;
      if (!same([...f.rgba.subarray(at, at + 3)], PAL.fg)) return false;
    }
    return true;
  });
  ok('so it is drawn exactly, and never dithered', fgExact);
  ok('an unchanged gradient dithers the same in every frame: the last two frames are one', g.frames.length === 4 && g.frames[3].delay === 20, g.frames.map((f) => f.delay));
  const d = g.frames.map((f, i) => sameFrame(f.rgba, frames[i].rgba, 40)).find(Boolean);
  ok('and every pixel of the gradient is within 40 levels', !d, d);
  const fewer = counter.palette(15);
  ok('a palette of at most 15 colours has 15', fewer.count === 15);
  const reread = new ColourCounter();
  for (const f of frames) reread.add(f.rgba);
  ok('the palette is the same every time', same([...reread.palette(255).rgb], [...pal.rgb]));
  const empty = new ColourCounter();
  empty.add(new Uint8ClampedArray(64), true);
  ok('nothing counted (all see-through) is one black colour', empty.palette().count === 1 && empty.pixels === 0);
}

// ── a drift held, exact colours never ────────────────────────────────────
{
  // A glow that drifts a level or so a frame: every colour an approximation, the way a moving backdrop is.
  const w = 96, h = 54, n = 30;
  const frames = [];
  for (let i = 0; i < n; i++) {
    const px = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - 30 - i, y - 27) / 60;
      px.set([20 + 90 * Math.max(0, 1 - d), 24 + 40 * Math.max(0, 1 - d) + y, 60 + 150 * Math.max(0, 1 - d), 255], (y * w + x) * 4);
    }
    box(px, w, 70, 10, 10, 10, PAL.fg);
    frames.push({ rgba: px, seconds: 1 / 15 });
  }
  const exact = encodeGif(frames, { width: w, height: h, tolerance: 0 });
  const held = encodeGif(frames, { width: w, height: h });
  const many = new ColourCounter();
  frames.forEach((f) => many.add(f.rgba));
  ok('(the glow has more colours than a palette holds, so none of it is exact)', many.palette().count === 255);
  ok(`a drifting glow held within ${STICK} levels is smaller than one redrawn at every change`, STICK === 4 && held.length < exact.length * 0.85, [held.length, exact.length]);
  const g0 = decodeGif(exact), g4 = decodeGif(held);
  let worst = 0;
  g4.frames.forEach((f, k) => {
    // Frames joined by holding are compared at their start.
    let t = 0; for (let j = 0; j < k; j++) t += g4.frames[j].delay;
    const i = Math.min(n - 1, Math.round((t / 100) * 15));
    const ref = g0.frames[Math.min(g0.frames.length - 1, i)].rgba;
    for (let p = 0; p < ref.length; p += 4) worst = Math.max(worst, Math.abs(f.rgba[p] - ref[p]), Math.abs(f.rgba[p + 1] - ref[p + 1]), Math.abs(f.rgba[p + 2] - ref[p + 2]));
  });
  ok('and no pixel of it is far from the exact GIF (within the palette step and the hold)', worst <= 24, worst);
  const fgExact = g4.frames.every((f) => same([...f.rgba.subarray((15 * w + 75) * 4, (15 * w + 75) * 4 + 3)], PAL.fg));
  ok('the flat box in it is exact in every frame', fgExact);
  // Two exact colours two levels apart: the second is drawn, never held at the first.
  const a = flat(8, 8, [100, 100, 100]), b = flat(8, 8, [102, 101, 100]);
  const gx = decodeGif(encodeGif([{ rgba: a, seconds: 0.1 }, { rgba: b, seconds: 0.1 }], { width: 8, height: 8 }));
  ok('a colour that is in the palette is never held, however close', gx.frames.length === 2 && sameFrame(gx.frames[1].rgba, b) === null);
}

// ── against ffmpeg, when it is installed ──────────────────────────────────
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
if (has('ffmpeg') && has('ffprobe')) {
  const dir = join(fileURLToPath(new URL('../.test-build/', import.meta.url)), `pro-export-ffmpeg-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const run = (cmd, args) => spawnSync(cmd, args, { maxBuffer: 256 * 1024 * 1024 });
  try {
    const w = 48, h = 32, fps = 15, seconds = 2.2;
    const n = Math.ceil(seconds * fps);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = i / fps;
      const px = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([20 + x * 4, 40 + y * 5, 160, 255], (y * w + x) * 4);
      box(px, w, Math.round(Math.min(1, t) * 30), 8, 12, 12, PAL.fg);
      frames.push({ rgba: px, seconds: Math.min((i + 1) / fps, seconds) - t });
    }
    for (const transparent of [false, true]) {
      const src = transparent ? frames.map((f, i) => ({ ...f, rgba: box(new Uint8ClampedArray(w * h * 4), w, Math.round(Math.min(1, i / fps) * 30), 8, 12, 12, PAL.fg) })) : frames;
      const bytes = encodeGif(src, { width: w, height: h, transparent });
      const file = join(dir, `t${transparent ? 1 : 0}.gif`);
      writeFileSync(file, bytes);
      const mine = decodeGif(bytes);
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file]).stdout.toString() || '{}');
      const st = probe.streams?.[0] ?? {};
      ok(`ffprobe${transparent ? ', transparent' : ''}: a GIF, 48 × 32, ${mine.frames.length} frames, 2.2 s`,
        st.codec_name === 'gif' && st.width === w && st.height === h && Number(st.nb_read_frames) === mine.frames.length
        && Math.abs(Number(probe.format?.duration) - seconds) < 0.011, probe);
      const raw = run('ffmpeg', ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
      const out = raw.stdout;
      const size = w * h * 4;
      const theirs = Array.from({ length: Math.floor(out.length / size) }, (_, i) => new Uint8ClampedArray(out.subarray(i * size, (i + 1) * size)));
      const diff = theirs.length === mine.frames.length ? mine.frames.map((f, i) => sameFrame(f.rgba, theirs[i])).find(Boolean) : 'count';
      ok(`ffmpeg${transparent ? ', transparent' : ''}: decodes with nothing on stderr, the same frames pixel for pixel`, raw.status === 0 && raw.stderr.length === 0 && !diff,
        [raw.stderr.toString().slice(0, 200), theirs.length, mine.frames.length, diff]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── the GIF's plan ────────────────────────────────────────────────────────
{
  ok('15 a second, 720 pixels, 15 s, 25 MB unless asked', GIF.fps === 15 && GIF.side === 720 && GIF.seconds === 15 && GIF.maxBytes === 25_000_000
    && GIF.maxFps === 20 && GIF.maxSide === 1080);
  ok('the sizes and rates a person can choose are inside the limits', GIF_SIDES.every((s) => s <= GIF.maxSide) && GIF_RATES.every((r) => r <= GIF.maxFps)
    && GIF_SIDES.includes(GIF.side) && GIF_RATES.includes(GIF.fps));
  const shapes = { landscape: [720, 405], portrait: [405, 720], square: [720, 720], feed: [576, 720] };
  ok('720 on the long side for every shape', Object.entries(shapes).every(([f, [w, h]]) => same(gifSizeFor(f, 720), { width: w, height: h })),
    Object.keys(shapes).map((f) => gifSizeFor(f, 720)));
  ok('never more than 1080, and a shape it does not know is wide', same(gifSizeFor('portrait', 4000), { width: 608, height: 1080 }) && same(gifSizeFor('cinema', 480), { width: 480, height: 270 }));
  ok('a plan is kept inside the limits', same(gifPlan({ side: 9999, fps: 99, colors: 9999 }), { side: 1080, fps: 20, colors: 256 })
    && same(gifPlan({ side: -5, fps: NaN, colors: 1 }), { side: 16, fps: 15, colors: 2 }) && same(gifPlan(), { side: 720, fps: 15, colors: 256 }));
  ok('frames: 2.5 s at 15 is 38, the last one shorter', same(gifFrames(2.5, 15), { frames: 38, seconds: 2.5, trimmed: false }));
  ok('a 30-second graphic is its first 15 seconds, and says so', same(gifFrames(30, 15), { frames: 225, seconds: 15, trimmed: true }));
  ok('a length that is not a number is one second', same(gifFrames(NaN, 10), { frames: 10, seconds: 1, trimmed: false }));

  const p = gifPlan();
  const one = smaller(p, 25.5e6, 25e6);
  ok('a little over: fewer colours first', one.colors === 128 && one.side === 720 && one.fps === 15, one);
  const lots = smaller(p, 80e6, 25e6);
  ok('far over: colours, then size', lots.colors === 64 && lots.side < 720 && lots.fps === 15, lots);
  const bottom = { side: 240, fps: 6, colors: 64 };
  ok('nothing left to give up: null', smaller(bottom, 99e6, 25e6) === null);
  const rates = smaller({ side: 240, fps: 15, colors: 64 }, 30e6, 25e6);
  ok('at the smallest size, frames a second go next', rates.side === 240 && rates.fps < 15 && rates.colors === 64, rates);
  let walk = gifPlan({ side: 1080, fps: 20 }), steps = 0, order = [];
  for (let next; (next = smaller(walk, 1e12, 1)); walk = next, steps++) order.push(...cutsBetween(walk, next).map((c) => c.what));
  ok('down the whole ladder in order: colours, size, frames a second — and it ends', steps < 30 && order.indexOf('size') > order.lastIndexOf('colors')
    && order.indexOf('fps') > order.lastIndexOf('size') && same(walk, { side: 240, fps: 6, colors: 64 }), [order, walk]);
  ok('cuts list what changed, in that order', same(cutsBetween({ side: 720, fps: 15, colors: 256 }, { side: 576, fps: 10, colors: 64 }).map((c) => c.what), ['colors', 'size', 'fps']));
  ok('the estimate grows with the frames, and with a backdrop that moves', estimateGifBytes(720, 405, 100, false) > estimateGifBytes(720, 405, 10, false)
    && estimateGifBytes(720, 405, 100, true) > estimateGifBytes(720, 405, 100, false));
  ok('a backdrop layer or particles move everywhere; text does not', movesEverywhere({ layers: [{ kind: 'backdrop' }] }) && movesEverywhere({ layers: [{ kind: 'particles' }] })
    && !movesEverywhere({ layers: [{ kind: 'text' }, { kind: 'backdrop', hidden: true }] }) && !movesEverywhere({}));
  ok('see-through: none, or a colour that is not opaque', seeThrough(null) && seeThrough('#00000000') && seeThrough('#0b102080') && !seeThrough('#0b1020ff')
    && !seeThrough('bg') && !seeThrough('#123456'));
}

// ── rendering a GIF ───────────────────────────────────────────────────────

const graphic = (o = {}) => ({
  id: 'm1', title: 'Launch day', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 2,
  palette: { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' },
  backdrop: 'bg', layers: [{ id: 'l1', kind: 'text', text: 'Hi' }], stage: 'ready', created: 1, updated: 1, ...o,
});
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/**
 * A painter that paints real pixels: the backdrop (none, or the palette's
 * `bg`), and a box of `fg` that moves for the first second. `log` records the
 * order of things and every paint.
 */
function fakes(o = {}) {
  const log = { order: [], paints: [], canvases: [], preloaded: false, ticks: 0 };
  const deps = {
    preload: async (m) => { log.order.push('preload'); log.preloadedDoc = m; await new Promise((r) => setTimeout(r, 2)); log.preloaded = true; },
    paint: (ctx, doc, t, opts) => {
      log.order.push('paint');
      log.paints.push({ ctx, doc, t, opts, preloadedFirst: log.preloaded });
      const { width: w, height: h } = opts;
      const px = ctx.px;
      px.fill(0);
      if (doc.backdrop !== null && !/^#[0-9a-f]{6}00$/i.test(doc.backdrop)) {
        const bg = hex(doc.backdrop === 'bg' ? doc.palette.bg : doc.backdrop.slice(0, 7));
        for (let i = 0; i < w * h; i++) px.set([...bg, 255], i * 4);
      }
      const bw = Math.max(1, Math.round(w / 6)), bh = Math.max(1, Math.round(h / 4));
      const x = Math.round(Math.min(1, t) * (w - bw));
      const seedColour = o.noise ? null : hex(doc.palette.fg);
      for (let y = Math.round(h / 3); y < Math.round(h / 3) + bh; y++) {
        for (let xx = x; xx < x + bw; xx++) {
          const c = seedColour ?? [rand() * 256, rand() * 256, rand() * 256];
          px.set([...c, 255], (y * w + xx) * 4);
        }
      }
      if (o.noise) for (let i = 0; i < w * h; i++) px.set([rand() * 256, rand() * 256, rand() * 256, 255], i * 4);
    },
    canvas: (w, h) => {
      const c = {
        width: w, height: h, contexts: [],
        getContext(type, opts) {
          c.contexts.push({ type, opts });
          if (o.noContext) return null;
          const ctx = { canvas: c, px: new Uint8ClampedArray(w * h * 4), getImageData: (x, y, ww, hh) => ({ data: ctx.px.slice(), width: ww, height: hh }) };
          return ctx;
        },
      };
      log.canvases.push(c);
      return c;
    },
    tick: async () => { log.ticks++; },
  };
  return { log, deps };
}

{
  const { log, deps } = fakes();
  const m = graphic({ seconds: 2 });
  const before = JSON.stringify(m);
  const progress = [];
  const made = await renderGif(m, { side: 120, fps: 10, onProgress: (d, t, a) => progress.push([d, t, a]) }, deps);
  const g = decodeGif(made.bytes);
  ok('fonts and pictures first, and waited for', log.order[0] === 'preload' && log.paints.every((p) => p.preloadedFirst) && log.preloadedDoc === m);
  ok('a wide graphic at a 120-pixel long side is 120 × 68', made.width === 120 && made.height === 68 && g.width === 120 && g.height === 68);
  ok('the colours are chosen from frames across the whole animation, first and last included',
    log.paints.slice(0, 20).map((p) => p.t).join() === Array.from({ length: 20 }, (_, i) => i / 10).join(), log.paints.slice(0, 20).map((p) => p.t));
  const enc = log.paints.slice(20);
  ok('then every frame, frame i at exactly i / fps', enc.length === 20 && enc.every((p, i) => p.t === i / 10), enc.map((p) => p.t));
  ok('each painted whole, at the GIF\'s size', log.paints.every((p) => p.opts.width === 120 && p.opts.height === 68 && p.opts.clear === true));
  ok('into one canvas, with no alpha for an opaque graphic (and on the GPU: no willReadFrequently)', log.canvases.length === 1
    && same(log.canvases[0].contexts, [{ type: '2d', opts: { alpha: false } }]), log.canvases[0].contexts);
  ok('the graphic as it is, unchanged', log.paints.every((p) => p.doc === m) && JSON.stringify(m) === before);
  ok('2 s at 10 a second: 200 hundredths, the box moving for one second then held', totalDelay(g) === 200 && g.frames.length === 11, [totalDelay(g), g.frames.length]);
  ok('it says what it made', made.fps === 10 && made.colors === 256 && made.seconds === 2 && !made.trimmed && !made.transparent && !made.over
    && same(made.reduced, []) && made.frames === g.frames.length);
  ok('progress counts every painted frame, the colour samples too', progress.length === 40 && same(progress[39], [40, 40, 1]) && progress.every((p, i) => p[0] === i + 1));
  ok('and it lets the window breathe while it works', log.ticks >= 10, log.ticks);
}
{
  const { log, deps } = fakes();
  const m = graphic({ backdrop: null, format: 'portrait' });
  const made = await renderGif(m, { side: 64, fps: 10 }, deps);
  const g = decodeGif(made.bytes);
  ok('a transparent graphic keeps its transparency: alpha in the canvas, see-through in the GIF', made.transparent
    && same(log.canvases[0].contexts[0].opts, { alpha: true })
    && g.frames[0].rgba[3] === 0 && g.frames.every((f) => f.rgba.some((v, i) => i % 4 === 3 && v === 255)));
  ok('a tall graphic is 36 × 64', made.width === 36 && made.height === 64);
  const drawn = fakes();
  const over = await renderGif(m, { side: 64, fps: 10, transparent: false }, drawn.deps);
  ok('asked not to, it is drawn over its own background, from a copy', !over.transparent && drawn.log.paints.every((p) => p.doc.backdrop === 'bg' && p.doc !== m)
    && m.backdrop === null && decodeGif(over.bytes).frames[0].rgba[3] === 255);
}
{
  const { log, deps } = fakes();
  const made = await renderGif(graphic({ seconds: 20 }), { side: 48, fps: 6 }, deps);
  ok('a 20-second graphic is cut to its first 15 seconds, and says so', made.trimmed && made.seconds === 15
    && totalDelay(decodeGif(made.bytes)) === 1500 && Math.max(...log.paints.map((p) => p.t)) < 15);
}
{
  const { log, deps } = fakes();
  const ctl = new AbortController();
  const e = await rejection(renderGif(graphic(), { side: 48, fps: 10, signal: ctl.signal, onProgress: (d) => { if (d === 7) ctl.abort(); } }, deps));
  ok('Cancel stops between frames with an AbortError', e?.name === 'AbortError' && log.paints.length === 7, [e?.name, log.paints.length]);
  const early = fakes();
  const ctl2 = new AbortController();
  ctl2.abort();
  const e2 = await rejection(renderGif(graphic(), { signal: ctl2.signal }, early.deps));
  ok('cancelled before it starts, it loads and paints nothing', e2?.name === 'AbortError' && early.log.order.length === 0);
  const blank = fakes({ noContext: true });
  const e3 = await rejection(renderGif(graphic(), { side: 48 }, blank.deps));
  ok('a canvas the window cannot give is said so', e3?.message === 'motion:no-canvas', e3?.message);
}
{
  // Noise everywhere: a GIF that cannot fit a tiny ceiling. It is made smaller, rung by rung, and says what it gave up.
  const { log, deps } = fakes({ noise: true });
  const attempts = new Set();
  const made = await renderGif(graphic({ seconds: 1 }), { side: 480, fps: 15, maxBytes: 60_000, onProgress: (d, t, a) => attempts.add(a) }, deps);
  ok('over the ceiling, it is made again, smaller', attempts.size > 1 && made.reduced.length > 0, [...attempts]);
  ok('giving up colours first', made.reduced[0].what === 'colors' && made.reduced[0].from === 256, made.reduced);
  ok('and it fits, or says it does not', (made.bytes.length <= 60_000 && !made.over) || made.over, [made.bytes.length, made.over]);
  ok('what it says matches what it is', made.width === gifSizeFor('landscape', made.reduced.find((c) => c.what === 'size')?.to ?? 480).width
    && made.colors === (made.reduced.find((c) => c.what === 'colors')?.to ?? 256));
  const sizes = new Set(log.canvases.map((c) => c.width));
  ok('each attempt at a smaller size paints into a canvas of that size', [...sizes].every((w) => w <= 480), [...sizes]);
  const hopeless = fakes({ noise: true });
  const tiny = await renderGif(graphic({ seconds: 1 }), { side: 240, fps: 6, colors: 64, maxBytes: 10 }, hopeless.deps);
  ok('nothing left to give up: the smallest GIF, whole, marked over', tiny.over && tiny.bytes.length > 10 && decodeGif(tiny.bytes).trailer);
}

// ── the destinations ──────────────────────────────────────────────────────

const SHAPES = ['landscape', 'portrait', 'square', 'feed'];
const custom = (m) => ({ ...graphic(m) });
{
  ok('six destinations, films first, Custom last', same(DESTINATIONS, ['story', 'post', 'youtube', 'loop', 'picture', 'custom']));
  ok('three kinds of file', same(SHARE_KINDS, ['mp4', 'gif', 'png']));
  const table = {
    story: { landscape: 'portrait', portrait: 'portrait', square: 'portrait', feed: 'portrait' },
    post: { landscape: 'feed', portrait: 'feed', square: 'square', feed: 'feed' },
    youtube: { landscape: 'landscape', portrait: 'landscape', square: 'landscape', feed: 'landscape' },
    loop: { landscape: 'landscape', portrait: 'portrait', square: 'square', feed: 'feed' },
    picture: { landscape: 'landscape', portrait: 'portrait', square: 'square', feed: 'feed' },
    custom: { landscape: 'landscape', portrait: 'portrait', square: 'square', feed: 'feed' },
  };
  const kinds = { story: 'mp4', post: 'mp4', youtube: 'mp4', loop: 'gif', picture: 'png', custom: 'mp4' };
  let wrong = [];
  for (const d of DESTINATIONS) {
    for (const f of SHAPES) {
      const m = custom({ format: f });
      const before = JSON.stringify(m);
      const s = settingsFor(d, m);
      const want = table[d][f];
      const px = s.kind === 'gif' ? gifSizeFor(want, 720) : pixelsFor(want, '1080p');
      const good = s.dest === d && s.kind === kinds[d] && s.format === want && s.from === f
        && s.reshape === (want === f ? 'none' : 'fit') && s.width === px.width && s.height === px.height
        && (s.kind === 'gif' ? s.size === null && s.side === 720 && s.fps === 15 && s.quality === null
          : s.size === '1080p' && s.side === null && (s.kind === 'mp4' ? s.quality === 'high' && s.fps === 30 : s.quality === null))
        && JSON.stringify(m) === before;
      if (!good || shapeFor(d, f) !== want || kindOf(d) !== kinds[d]) wrong.push([d, f, s.kind, s.format, s.reshape, s.width, s.height]);
    }
  }
  ok('every destination for every shape: the kind, the shape, the size, the quality — and the graphic unchanged', wrong.length === 0, wrong);
  ok('the best destination is the one for the graphic\'s own shape, so the shortest path changes nothing',
    bestDestination({ format: 'portrait' }) === 'story' && bestDestination({ format: 'feed' }) === 'post' && bestDestination({ format: 'square' }) === 'post'
    && bestDestination({ format: 'landscape' }) === 'youtube' && SHAPES.every((f) => settingsFor(bestDestination({ format: f }), custom({ format: f })).reshape === 'none'));
  ok('a window with no MP4 encoder starts on the picture', SHAPES.every((f) => bestDestination({ format: f }, false) === 'picture'));
  ok('Custom makes the kind chosen; others ignore it', kindOf('custom', 'gif') === 'gif' && kindOf('custom', 'png') === 'png' && kindOf('custom', 'nope') === 'mp4'
    && kindOf('story', 'gif') === 'mp4' && kindOf('nowhere') === 'mp4');
  ok('a destination it does not know is Custom', settingsFor('nowhere', custom()).dest === 'custom');
}
{
  const m = custom({ format: 'landscape', seconds: 6, fps: 30 });
  const story = settingsFor('story', m);
  ok('an MP4\'s estimate is the encoder\'s ceiling ("up to") for the file\'s own shape', story.upTo && story.bytes === estimateBytes({ format: 'portrait', fps: 30, seconds: 6 }, '1080p', 'high'));
  const big = settingsFor('youtube', m, { size: '4k', quality: 'very-high' });
  ok('More options carry through: 4K, best quality', big.size === '4k' && big.quality === 'very-high' && big.width === 3840 && big.bytes > settingsFor('youtube', m).bytes);
  const blur = settingsFor('youtube', m, { blur: true });
  ok('motion blur makes it take longer, not larger', blur.blur && blur.ms > settingsFor('youtube', m).ms && blur.bytes === settingsFor('youtube', m).bytes);
  ok('a longer graphic takes longer to make', settingsFor('youtube', { ...m, seconds: 12 }).ms > settingsFor('youtube', m).ms);
  ok('a frame count for the film', story.frames === 180 && story.seconds === 6);
  const gif = settingsFor('loop', m, { gifSide: 1080, gifFps: 20 });
  ok('a GIF\'s side and rate come from More options', gif.side === 1080 && gif.fps === 20 && gif.width === 1080 && gif.height === 608 && gif.frames === 120);
  ok('choices that are not on the list are the first ones', same(settingsFor('loop', m, { gifSide: 999, gifFps: 7 }).side, 720) && settingsFor('loop', m, { gifFps: 7 }).fps === 15);
  const long = settingsFor('loop', custom({ seconds: 25 }));
  ok('a GIF of a long graphic is cut, and says so first', long.trimmed && long.seconds === 15 && long.frames === 225);
  const busy = settingsFor('loop', custom({ seconds: 15, layers: [{ id: 'b', kind: 'backdrop' }] }), { gifSide: 1080, gifFps: 20 });
  ok('a GIF guessed past 25 MB says it will be made smaller, and is shown at the ceiling', busy.capped && busy.bytes === GIF.maxBytes);
  ok('a small GIF is not', !settingsFor('loop', custom({ seconds: 2 })).capped);
}
{
  const clear = custom({ backdrop: null });
  const film = settingsFor('youtube', clear);
  ok('an MP4 of a transparent graphic loses its transparency, and says so', film.alphaLost && !film.transparent);
  ok('a GIF and a PNG keep it unless asked not to', settingsFor('loop', clear).transparent && settingsFor('picture', clear).transparent
    && !settingsFor('loop', clear, { transparent: false }).transparent && settingsFor('loop', clear, { transparent: false }).alphaLost);
  ok('an opaque graphic has nothing to keep or lose', ['youtube', 'loop', 'picture'].every((d) => !settingsFor(d, custom()).transparent && !settingsFor(d, custom()).alphaLost));
  const pic = settingsFor('picture', custom({ layers: [{ id: 'a', kind: 'text', text: 'Hi', start: 0, end: 2, in: { fx: 'rise', d: 0.6 } }] }));
  const doc = custom({ layers: [{ id: 'a', kind: 'text', text: 'Hi', start: 0, end: 2, in: { fx: 'rise', d: 0.6 } }] });
  ok('a picture is the best moment: stillTime, after the entrance', pic.frame === 'best' && pic.at === stillTime(doc.layers, doc.seconds) && pic.at > 0, pic.at);
  ok('or the playhead\'s, when chosen', settingsFor('picture', doc, { frame: 'playhead', playhead: 1.25 }).at === 1.25
    && settingsFor('picture', doc, { frame: 'playhead', playhead: NaN }).at === 0);
  ok('a picture is one frame', pic.frames === 1 && pic.seconds === 0 && pic.kind === 'png');
}
{
  // A template graphic in another shape is built again from its template; one edited by hand is laid out again.
  const tpl = buildMotion({ id: 'tpl', recipe: 'lower-third', lang: 'en', format: 'landscape', now: 5 });
  tpl.sound = { mode: 'music' };
  const before = JSON.stringify(tpl);
  const s = settingsFor('story', tpl);
  const out = outputOf(tpl, s);
  ok('a template graphic sent to a story is built again from its template at 9:16', s.reshape === 'rebuild' && out.format === 'portrait' && out.recipe?.id === 'lower-third'
    && out !== tpl && out.layers !== tpl.layers);
  ok('keeping its title, colours, rate and sound', out.title === tpl.title && same(out.palette, tpl.palette) && out.fps === tpl.fps && same(out.sound, tpl.sound) && out.id === tpl.id);
  ok('and the graphic itself is untouched', JSON.stringify(tpl) === before);
  const own = { ...tpl };
  delete own.recipe;
  const s2 = settingsFor('story', own);
  const out2 = outputOf(own, s2);
  ok('a graphic edited by hand is fitted inside: the same graphic, the file\'s shape, nothing else changed', s2.reshape === 'fit' && out2.format === 'portrait'
    && out2.layers === own.layers && same({ ...out2, format: own.format }, own));
  const scened = { ...tpl, scenes: [{ id: 's1' }] };
  ok('a graphic with scenes is fitted, so its scenes are kept', reshapeOf(scened, 'portrait') === 'fit' && outputOf(scened, settingsFor('story', scened)).scenes === scened.scenes);
  ok('its own shape is the graphic itself', outputOf(tpl, settingsFor('youtube', tpl)) === tpl && reshapeOf(tpl, 'landscape') === 'none');
  const pic = settingsFor('picture', tpl);
  ok('a template\'s best moment is after its entrance and before its exit', pic.at > 0 && pic.at < tpl.seconds, pic.at);
}
{
  // Fitted inside: the box, the colour around it, and the painter.
  ok('a wide graphic in a 9:16 film: as wide as the frame, centred', same(fitBox('landscape', 1080, 1920), { x: 0, y: 656, w: 1080, h: 608 }));
  ok('a tall graphic in a 16:9 film: as tall as the frame, centred', same(fitBox('portrait', 1920, 1080), { x: 656, y: 0, w: 608, h: 1080 }));
  ok('a square in a 4:5 post, and the same shape fills it', same(fitBox('square', 1080, 1350), { x: 0, y: 135, w: 1080, h: 1080 }) && same(fitBox('feed', 1080, 1350), { x: 0, y: 0, w: 1080, h: 1350 }));
  ok('every box fits its frame, for every pair of shapes and sizes', SHAPES.every((a) => SHAPES.every((b) => ['720p', '1080p', '4k'].every((z) => {
    const { width, height } = pixelsFor(b, z);
    const r = fitBox(a, width, height);
    return r.x >= 0 && r.y >= 0 && r.x + r.w <= width && r.y + r.h <= height && (r.w === width || r.h === height);
  }))));
  ok('a frame of no size is a box of one pixel', same(fitBox('landscape', 0, NaN), { x: 0, y: 0, w: 1, h: 1 }));
  const m = custom({ backdrop: 'accent' });
  ok('the colour around: the backdrop when it is one colour, the background otherwise', surroundOf(m) === m.palette.accent
    && surroundOf({ ...m, backdrop: '#123456' }) === '#123456' && surroundOf({ ...m, backdrop: { kind: 'linear' } }) === m.palette.bg && surroundOf({ ...m, backdrop: null }) === m.palette.bg);

  const calls = [];
  const inner = [];
  const made = [];
  const fake = (name) => new Proxy({}, { get: (_, k) => (k === 'canvas' ? { width: 1080, height: 1920, name } : (...a) => calls.push([name, k, ...a])), set: (_, k, v) => { calls.push([name, `=${String(k)}`, v]); return true; } });
  const painter = fittedPaint(m, fitBox('landscape', 1080, 1920), (w, h) => { made.push([w, h]); return { width: w, height: h, getContext: (type, o) => { made.push([type, o]); return fake('inner'); } }; },
    (ctx, doc, t, o) => inner.push({ ctx: ctx.canvas.name, doc, t, o }));
  const main = fake('main');
  const film = { ...m, format: 'portrait', backdrop: 'bg' };
  painter(main, film, 1.5, { width: 1080, height: 1920, clear: true, blur: { samples: 8, shutter: 0.5 } });
  painter(main, film, 1.6, { width: 1080, height: 1920, clear: true });
  ok('one canvas for the graphic, its box\'s size, with alpha', same(made, [[1080, 608], ['2d', { alpha: true }]]));
  ok('the graphic is painted in its own shape at the box\'s size, at the frame\'s time, blur passed on', inner.length === 2 && inner[0].ctx === 'inner'
    && inner[0].doc.format === 'landscape' && inner[0].doc.layers === m.layers && inner[0].t === 1.5 && inner[0].o.width === 1080 && inner[0].o.height === 608
    && same(inner[0].o.blur, { samples: 8, shutter: 0.5 }) && inner[1].o.blur === undefined);
  ok('with the backdrop the renderer chose for the file (bg for a film)', inner.every((p) => p.doc.backdrop === 'bg'));
  const order = calls.filter((c) => c[0] === 'main').map((c) => c[1]);
  ok('then the frame: reset, cleared, filled with the colour around, and the graphic drawn in its box',
    same(order.slice(0, 6), ['setTransform', '=globalAlpha', '=globalCompositeOperation', 'clearRect', '=fillStyle', 'fillRect'])
    && calls.find((c) => c[1] === '=fillStyle')[2] === m.palette.bg && same(calls.find((c) => c[1] === 'drawImage').slice(3), [0, 656]));
  calls.length = 0;
  painter(main, { ...film, backdrop: null }, 2, { width: 1080, height: 1920 });
  ok('a file that keeps transparency is left clear around the graphic', !calls.some((c) => c[1] === 'fillRect') && calls.some((c) => c[1] === 'clearRect'));
  const none = fittedPaint(m, fitBox('landscape', 100, 100), () => ({ getContext: () => null }), () => {});
  ok('a canvas the window cannot give is said so', throws(() => none(fake('x'), film, 0, {}))?.message === 'motion:no-canvas');
}
{
  // The remembered choices: whatever storage holds, a valid set comes out.
  ok('nothing stored: the first choices', same(readPrefs(null), FIRST_PREFS) && same(readPrefs('x'), FIRST_PREFS) && same(readPrefs([]), FIRST_PREFS));
  ok('what version 1 stored is read: format, size, quality, blur', same(readPrefs({ format: 'png', size: '4k', quality: 'medium', blur: true }),
    { kind: 'png', size: '4k', quality: 'medium', blur: true, gifSide: 720, gifFps: 15 }));
  ok('and what this one stores', same(readPrefs({ format: 'gif', size: '720p', quality: 'very-high', blur: false, gifSide: 1080, gifFps: 20 }),
    { kind: 'gif', size: '720p', quality: 'very-high', blur: false, gifSide: 1080, gifFps: 20 }));
  const junk = [undefined, 0, NaN, '', 'gif', true, {}, [], { kind: 7 }, { size: '8k' }, { gifSide: '720' }, { gifFps: 15.5 }, { blur: 'yes' }, { __proto__: { kind: 'gif' } }];
  for (let i = 0; i < 300; i++) {
    const pick = (list) => list[Math.floor(rand() * list.length)];
    junk.push({ format: pick(['mp4', 'gif', 'png', 'webm', 3, null]), kind: pick([undefined, 'png', 'jpg']), size: pick(['720p', '1080p', '4k', '2k', 0]),
      quality: pick(['medium', 'high', 'very-high', 'max']), blur: pick([true, false, 1, 'true']), gifSide: pick([480, 720, 1080, 999, -1, '480']),
      gifFps: pick([10, 15, 20, 60, NaN]) });
  }
  const valid = (p) => SHARE_KINDS.includes(p.kind) && ['720p', '1080p', '4k'].includes(p.size) && ['medium', 'high', 'very-high'].includes(p.quality)
    && typeof p.blur === 'boolean' && GIF_SIDES.includes(p.gifSide) && GIF_RATES.includes(p.gifFps) && Object.keys(p).length === 6;
  ok(`${junk.length} stored values, valid or not, each read as a valid set`, junk.every((j) => valid(readPrefs(j))), junk.find((j) => !valid(readPrefs(j))));
  ok('settings from junk choices are still whole', junk.slice(0, 80).every((j) => DESTINATIONS.every((d) => {
    const s = settingsFor(d, custom(), j && typeof j === 'object' ? j : {});
    return Number.isFinite(s.width) && s.width > 0 && Number.isFinite(s.bytes) && Number.isFinite(s.ms) && SHARE_KINDS.includes(s.kind);
  })));
  ok('a graphic with odd numbers still gets whole settings', DESTINATIONS.every((d) => {
    const s = settingsFor(d, custom({ seconds: NaN, fps: 0, format: 'cinema' }));
    return Number.isFinite(s.width) && Number.isFinite(s.ms) && s.frames >= 1;
  }));
}
{
  const all = Array(6).fill(true);
  const step = (i, k, rtl = false, en = all) => destinationStep(i, k, rtl, en);
  ok('arrows: right and down go forward, left and up back, round the ends', step(0, 'ArrowRight') === 1 && step(0, 'ArrowDown') === 1 && step(0, 'ArrowLeft') === 5
    && step(0, 'ArrowUp') === 5 && step(5, 'ArrowRight') === 0);
  ok('in Arabic and Kurdish, left goes forward', step(0, 'ArrowLeft', true) === 1 && step(1, 'ArrowRight', true) === 0 && step(0, 'ArrowDown', true) === 1);
  ok('Home and End', step(3, 'Home') === 0 && step(1, 'End') === 5);
  const films = [false, false, false, true, true, true];
  ok('cards that cannot be chosen are passed over', step(3, 'ArrowRight', false, films) === 4 && step(3, 'ArrowLeft', false, films) === 5 && step(4, 'Home', false, films) === 3);
  ok('other keys, or nothing to choose, are not its business', step(0, 'Enter') === null && step(0, 'a') === null && destinationStep(0, 'ArrowRight', false, Array(6).fill(false)) === null
    && destinationStep(0, 'ArrowRight', false, []) === null);
}
{
  const mark = (s) => `«${s}»`;
  const names = DESTINATIONS.map((d) => destinationName(d, mark));
  ok('six names, each through the translator, each different', names.every((n) => /^«.+»$/.test(n)) && new Set(names).size === 6, names);
  const lines = DESTINATIONS.map((d) => destinationLine(d, mark));
  ok('six lines, the films with the file\'s shape in them', lines.every((l) => /^«.+»$/.test(l)) && lines.slice(0, 3).every((l) => l.includes('{ratio}')) && new Set(lines).size === 6);
  ok('ratios as everyone writes them', ratioOf('portrait') === '9:16' && ratioOf('feed') === '4:5' && ratioOf('square') === '1:1' && ratioOf('landscape') === '16:9' && ratioOf('x') === '16:9');
  ok('a GIF is named like the rest, with .gif', fileNameOf({ title: 'Launch day' }, 'gif', '16x9') === 'Launch day 16x9.gif'
    && fileNameOf({ title: 'يوم الإطلاق' }, 'gif') === 'يوم الإطلاق.gif' && fileNameOf({ title: '' }, 'gif', '1x1') === 'motion 1x1.gif');
  ok('MP4 and PNG names are motionexportops.ts\' own', fileNameOf({ title: 'x' }, 'mp4', '9x16') === fileNameFor({ title: 'x' }, 'mp4', '9x16')
    && fileNameOf({ title: 'y' }, 'png') === fileNameFor({ title: 'y' }, 'png'));
  const long = fileNameOf({ title: 'word '.repeat(40) }, 'gif', '4x5');
  ok('eighty characters at most, as every export name', Array.from(long).length <= 80 && long.endsWith('4x5.gif'), long);
}

// ── what the export may not do ────────────────────────────────────────────
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const files = ['motiongif.ts', 'motiongifops.ts', 'motionshare.ts', 'MotionExport.tsx'];
  const src = Object.fromEntries(files.map((f) => [f, strip(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))]));
  const all = Object.values(src).join('\n');
  ok('no request leaves the machine', !/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(all));
  ok('no media element, and no ctx.filter (WebKit has none)', !/<\s*(video|audio)\b|new\s+Audio\b|createElement\(\s*['"`](video|audio)/i.test(all) && !/\.filter\s*=/.test(all));
  ok('no direction set by hand (rtl.ts owns it)', !/\.dir\s*=/.test(all));
  ok('motiongif.ts imports nothing and touches no DOM', !/^import\s/m.test(src['motiongif.ts']) && !/\b(document|window|navigator|HTML\w*)\b/.test(src['motiongif.ts']));
  ok('motionshare.ts touches no DOM, no storage and no clock', !/\b(document|window|localStorage|Date\.now|performance)\b/.test(src['motionshare.ts']));
  const commands = [...all.matchAll(/invoke(?:<[^>]*>)?\(\s*'([a-z_|:]+)'/g)].map((m) => m[1]);
  ok('the only command the tab calls itself is Video\'s reveal_path', commands.every((c) => ['export_write_video', 'open_exported', 'reveal_path'].includes(c)), commands);
  ok('a GIF is written by the same command as an MP4 (motionexportops.ts\' writeMotionFile)', /writeMotionFile\(/.test(src['MotionExport.tsx']) && !/export_write_gif/.test(all));
}

// ── the Export tab's first screen ─────────────────────────────────────────
{
  const out = fileURLToPath(new URL('../.test-build/pro-export-ui/', import.meta.url));
  let esbuild = null;
  try { esbuild = await import('esbuild'); } catch { esbuild = null; }
  ok('esbuild is there to build the tab', !!esbuild);
  if (esbuild) {
    rmSync(out, { recursive: true, force: true });
    await esbuild.build({
      entryPoints: ['MotionExport.tsx', 'i18n.ts'].map((f) => fileURLToPath(new URL(`../src/${f}`, import.meta.url))), bundle: true, format: 'esm', outdir: out,
      external: ['react', 'react-dom', '@tauri-apps/api/core'], logLevel: 'error', jsx: 'automatic', platform: 'node',
    });
    const store = new Map();
    globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
    globalThis.window ??= globalThis;
    const React = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { MotionExport } = await import(`${out}MotionExport.js`);
    const { translator } = await import(`${out}i18n.js`);
    const render = (doc, t = (s) => s, extra = {}) => renderToStaticMarkup(React.createElement(MotionExport, { t, doc, onError: () => {}, ...extra }));
    const count = (html, re) => (html.match(re) ?? []).length;
    const firstScreen = (html) => ({
      radios: count(html, /role="radio"/g),
      checked: [...html.matchAll(/role="radio" id="mo-share-[^"]*-(\w+)" aria-checked="true"/g)].map((m) => m[1]),
      primary: count(html, /class="sb-cta-go mo-ex-go"/g),
      expanded: /class="mo-share-more"[^>]*aria-expanded="false"|aria-expanded="false"[^>]*class="mo-share-more"/.test(html),
      panel: /vid-dl-more/.test(html),
      groups: count(html, /role="group"/g),
      checkboxes: count(html, /type="checkbox"/g),
      saveAs: /mo-ex-saveas/.test(html),
    });
    let wrong = [];
    for (const f of SHAPES) {
      const html = render(custom({ id: `g-${f}`, format: f }));
      const s = firstScreen(html);
      const want = bestDestination({ format: f });
      if (s.radios !== 6 || !same(s.checked, [want]) || s.primary !== 1 || !s.expanded || s.panel || s.groups || s.checkboxes || s.saveAs) wrong.push([f, s]);
    }
    ok('every shape: six cards, the one for its shape chosen, one button, More options closed, nothing else to decide', wrong.length === 0, wrong);
    // The 0.132.0 tab put five decisions before its Download, all on its first screen: the kind of file, the size and
    // the quality (three groups of buttons), motion blur (a checkbox), and Save as… beside Download. Counted the same
    // way here: groups of choices, checkboxes, Save as…, and now the one disclosure.
    const BEFORE = 3 + 1 + 1;
    const html = render(custom({ id: 'g-count' }));
    const s0 = firstScreen(html);
    const now = count(html, /role="radiogroup"/g) + s0.groups + s0.checkboxes + (s0.saveAs ? 1 : 0) + count(html, /class="mo-share-more"/g);
    ok(`fewer decisions on the first screen than before: ${now} (where is it going, and More options) against ${BEFORE}`, now === 2 && now < BEFORE, now);
    ok('and nothing on it to press but the cards, Download and More options', count(html, /<button/g) === 6 + 1 + 1, count(html, /<button/g));
    ok('the cards say what they make, the films with their shape', /Story or Reel/.test(html) && /<bdi dir="ltr">9:16<\/bdi>/.test(html) && /<bdi dir="ltr">16:9<\/bdi>/.test(html)
      && /Web loop/.test(html) && /A PNG of its best moment/.test(html));
    ok('one line says what will be made', /1080p · 1920 × 1080 · MP4/.test(html) && /up to about/.test(html));
    ok('a radio group, labelled by its question', /role="radiogroup" aria-labelledby="mo-share-q-g-count"/.test(html) && /id="mo-share-q-g-count">Where is it going\?/.test(html));
    ok('only the chosen card is in the tab order', count(html, /tabindex="0"/gi) === 1 && count(html, /tabindex="-1"/gi) === 5);
    const sound = render(custom({ id: 'g-sound' }), (s) => s, { soundNote: React.createElement('span', { className: 'probe-sound' }, 'Music, -14 LUFS') });
    ok('the sound slot is filled under the line for an MP4', /class="mo-share-sound"><span class="probe-sound">Music, -14 LUFS<\/span>/.test(sound));
    ok('and is not there without a note', !/mo-share-sound/.test(html));
    const alpha = render(custom({ id: 'g-alpha', backdrop: null }));
    ok('a transparent graphic\'s film says it cannot keep transparency, as before', /An MP4 cannot keep transparency/.test(alpha) && /mo-ex-alpha/.test(alpha));
    const long = render(custom({ id: 'g-long', seconds: 25 }));
    ok('no GIF note when the film is chosen', !/A GIF runs/.test(long));
    {
      const ar = render(custom({ id: 'g-ar', format: 'portrait' }), translator('ar'));
      const english = ['Where is it going?', 'Story or Reel', 'Web loop', 'Custom', 'More options', 'Download MP4', 'Tall', 'video for a feed', 'Every setting'];
      ok('in Arabic, the first screen has none of its English words left', english.every((w) => !ar.includes(w)), english.filter((w) => ar.includes(w)));
      ok('and the ratio stays a left-to-right 9:16 inside the Arabic', /<bdi dir="ltr">9:16<\/bdi>/.test(ar));
    }
    rmSync(out, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
