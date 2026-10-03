// The MP4 writer: the file a Motion export is saved as, written with no library.
//
// What matters: the file is `ftyp`, `moov`, `mdat` in that order, and every
// box's size is exactly what it holds; the index finds each picture's own
// bytes (`stsz` sums to the pictures, every `stco` offset lands on its chunk's
// first sample); decode times add up to the durations given; `stss` lists
// exactly the key frames; `ctts` and `elst` appear only when pictures come out
// of order, and then put each picture back at the moment it was meant for; a
// file past 4 GiB is refused with a clear error; and an Annex-B stream becomes
// one sample per picture with the parameter sets in `avcC`. Where ffmpeg is
// installed, the file must also decode without a word on stderr to the same
// frames, hash for hash, as ffmpeg's own MP4 of the same stream, with and
// without B-frames. A sound track beside the pictures leaves the pictures'
// own tables as they were (only where their chunks sit moves), and a file
// without sound is the file it always was. The sound track itself is
// pro-mux-audio.test.mjs's.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp4Writer, annexBToAvcc, ascFor } from '../.test-build/motionmp4.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (s) => Uint8Array.from(s.replace(/\s+/g, '').match(/../g).map((b) => parseInt(b, 16)));
const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ── a box parser, written from the standard rather than from the writer ──
const u32 = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const i32 = (b, at) => u32(b, at) | 0;
const u16 = (b, at) => (b[at] << 8) + b[at + 1];
const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl']);
// Where the child boxes of a box that has fields first begin, from its start.
const KIDS_AT = { stsd: 16, dref: 16, avc1: 86 };
let nestingErrors = [];
function parse(b, from, to) {
  const list = [];
  let at = from;
  while (at < to) {
    const size = at + 8 <= to ? u32(b, at) : 0;
    if (size < 8 || at + size > to) { nestingErrors.push(`bad size at ${at}`); break; }
    const box = { type: fourcc(b, at + 4), at, size, body: at + 8, end: at + size };
    if (CONTAINERS.has(box.type)) box.kids = parse(b, at + 8, at + size);
    else if (KIDS_AT[box.type]) box.kids = parse(b, at + KIDS_AT[box.type], at + size);
    list.push(box);
    at += size;
  }
  if (at !== to) nestingErrors.push(`boxes overrun ${to} by ${at - to}`);
  return list;
}
const get = (list, path) => {
  let cur = { kids: list };
  for (const t of path.split('/')) {
    cur = (cur.kids || []).find((k) => k.type === t);
    if (!cur) return null;
  }
  return cur;
};
const STBL = 'moov/trak/mdia/minf/stbl';

/** Everything the tests look at, read from the bytes. */
function read(file) {
  nestingErrors = [];
  const top = parse(file, 0, file.length);
  const at = (p) => get(top, p);
  const tbl = (p) => at(`${STBL}/${p}`);
  const f = { top, nesting: nestingErrors.slice(), types: top.map((x) => x.type) };
  const mvhd = at('moov/mvhd');
  f.mvhd = { scale: u32(file, mvhd.body + 12), duration: u32(file, mvhd.body + 16) };
  const tkhd = at('moov/trak/tkhd');
  f.tkhd = { flags: u32(file, tkhd.body) & 0xffffff, id: u32(file, tkhd.body + 12), duration: u32(file, tkhd.body + 20),
    width: u32(file, tkhd.body + 76) / 65536, height: u32(file, tkhd.body + 80) / 65536 };
  const mdhd = at('moov/trak/mdia/mdhd');
  f.mdhd = { scale: u32(file, mdhd.body + 12), duration: u32(file, mdhd.body + 16), lang: u16(file, mdhd.body + 20) };
  const hdlr = at('moov/trak/mdia/hdlr');
  f.handler = fourcc(file, hdlr.body + 8);
  const avc1 = tbl('stsd/avc1');
  f.avc1 = avc1 && { width: u16(file, avc1.body + 24), height: u16(file, avc1.body + 26), depth: u16(file, avc1.body + 74),
    kids: avc1.kids.map((k) => k.type) };
  const avcC = tbl('stsd/avc1/avcC');
  f.avcC = avcC && file.slice(avcC.body, avcC.end);
  const colr = tbl('stsd/avc1/colr');
  f.colr = colr && [fourcc(file, colr.body), u16(file, colr.body + 4), u16(file, colr.body + 6), u16(file, colr.body + 8), file[colr.body + 10], colr.size];
  const pasp = tbl('stsd/avc1/pasp');
  f.pasp = pasp && [u32(file, pasp.body), u32(file, pasp.body + 4)];
  const table = (box, width, signed = false) => {
    if (!box) return null;
    const n = u32(file, box.body + 4);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let j = 0; j < width; j++) {
        const p = box.body + 8 + (i * width + j) * 4;
        row.push(signed && j === width - 1 ? i32(file, p) : u32(file, p));
      }
      rows.push(width === 1 ? row[0] : row);
    }
    return rows;
  };
  f.stts = table(tbl('stts'), 2);
  const ctts = tbl('ctts');
  f.cttsVersion = ctts ? file[ctts.body] : null;
  f.ctts = ctts ? table(ctts, 2, file[ctts.body] === 1) : null;
  f.stss = table(tbl('stss'), 1);
  f.stsc = table(tbl('stsc'), 3);
  f.stco = table(tbl('stco'), 1);
  const stsz = tbl('stsz');
  f.stsz = [];
  for (let i = 0; i < u32(file, stsz.body + 8); i++) f.stsz.push(u32(file, stsz.body + 12 + i * 4));
  const elst = at('moov/trak/edts/elst');
  f.elst = elst ? { version: file[elst.body], count: u32(file, elst.body + 4), segment: u32(file, elst.body + 8),
    mediaTime: i32(file, elst.body + 12), rate: u16(file, elst.body + 16) } : null;
  f.stblOrder = at(STBL).kids.map((k) => k.type);
  const mdat = at('mdat');
  f.mdat = { at: mdat.at, payload: mdat.size - 8 };
  // Each sample's file offset, from stsc + stco + stsz, as a player finds it.
  f.offsets = [];
  let s = 0;
  f.stco.forEach((chunkAt, c) => {
    let per = 0;
    for (const [first, count] of f.stsc) if (first <= c + 1) per = count;
    let p = chunkAt;
    for (let k = 0; k < per && s < f.stsz.length; k++, s++) { f.offsets.push(p); p += f.stsz[s]; }
  });
  // Decode and presentation times on the track's clock.
  f.dts = [];
  let t = 0;
  for (const [count, delta] of f.stts) for (let k = 0; k < count; k++) { f.dts.push(t); t += delta; }
  f.sttsTotal = t;
  const offs = [];
  if (f.ctts) for (const [count, off] of f.ctts) for (let k = 0; k < count; k++) offs.push(off);
  f.shown = f.dts.map((d, i) => d + (offs[i] || 0) - (f.elst ? f.elst.mediaTime : 0));
  return f;
}

// ── samples to write ──────────────────────────────────────────────────────
// A real x264 AVCDecoderConfigurationRecord (High, 320x180): the writer copies it as it is.
const AVCC = hex('0164000dffe1001a6764000dacd941419f9f0110000003001000000303c0f142996001000668ebe3cb22c0fdf8f800');
const US = 1e6 / 30;
/**
 * Bytes that say which sample they are, of a size that differs from sample to
 * sample: one NAL unit after its 4-byte length, which is what the writer
 * checks a sample is.
 */
function bytesFor(i) {
  const b = new Uint8Array(40 + ((i * 37) % 300));
  for (let k = 0; k < b.length; k++) b[k] = (i * 7 + k) & 0xff;
  new DataView(b.buffer).setUint32(0, b.length - 4);
  b[4] = 0x41; b[5] = i >> 8; b[6] = i & 0xff;
  return b;
}
function write(samples, cfg = {}) {
  const w = new Mp4Writer({ width: 1280, height: 720, fps: 30, avcC: AVCC, ...cfg });
  for (const s of samples) w.add(s);
  return { bytes: w.bytes, file: w.finish() };
}
const inOrder = (n, keyEvery = 30, start = 0) => Array.from({ length: n }, (_, i) => ({
  data: bytesFor(i), timestamp: start + Math.round(i * US), duration: Math.round(US), key: i % keyEvery === 0,
}));

// ── a stream in order ─────────────────────────────────────────────────────
{
  const samples = inOrder(65);
  const { bytes, file } = write(samples);
  const f = read(file);
  ok('the file is ftyp, moov, mdat, in that order and nothing else', same(f.types, ['ftyp', 'moov', 'mdat']), f.types);
  ok('every box is exactly as long as what it holds, all the way down', f.nesting.length === 0 && f.top.reduce((a, x) => a + x.size, 0) === file.length, f.nesting);
  ok('ftyp: mp42, compatible with isom, mp42 and avc1',
    fourcc(file, 8) === 'mp42' && same([fourcc(file, 16), fourcc(file, 20), fourcc(file, 24)], ['isom', 'mp42', 'avc1']));
  ok('the pictures begin right after the index (fast start)', f.stco[0] === f.mdat.at + 8 && f.mdat.at === f.top[0].size + f.top[1].size);
  ok('stsz: one entry per sample, each its size, summing to the mdat payload',
    same(f.stsz, samples.map((s) => s.data.length)) && f.stsz.reduce((a, x) => a + x, 0) === f.mdat.payload && bytes === f.mdat.payload);
  ok('stco + stsc + stsz find every sample\'s own bytes',
    f.offsets.length === 65 && samples.every((s, i) => equalBytes(file.subarray(f.offsets[i], f.offsets[i] + s.data.length), s.data)));
  ok('about a second per chunk: 30, 30, then the 5 left over', same(f.stsc, [[1, 30, 1], [3, 5, 1]]) && f.stco.length === 3, f.stsc);
  ok('stts: 65 frames of 3000 ticks, totalling the summed durations',
    same(f.stts, [[65, 3000]]) && f.sttsTotal === samples.reduce((a, s) => a + Math.round(s.duration * 0.09), 0), f.stts);
  ok('stss lists exactly the key samples, counted from 1', same(f.stss, [1, 31, 61]), f.stss);
  ok('pictures in order: no ctts, no edit list', f.ctts === null && f.elst === null && !get(f.top, 'moov/trak/edts'));
  ok('the track clock is 90000, the movie clock 1000', f.mdhd.scale === 90000 && f.mvhd.scale === 1000);
  ok('lengths: 195000 ticks of media; 2167 ms of film (65 frames at 30 fps, rounded up)',
    f.mdhd.duration === 195000 && f.mvhd.duration === 2167 && f.tkhd.duration === 2167, [f.mdhd, f.mvhd, f.tkhd]);
  ok('track header: enabled and in the movie, track 1, 1280x720', f.tkhd.flags === 3 && f.tkhd.id === 1 && f.tkhd.width === 1280 && f.tkhd.height === 720, f.tkhd);
  ok('a video handler, language und', f.handler === 'vide' && f.mdhd.lang === 0x55c4);
  ok('the sample entry: avc1 1280x720 of depth 24, holding avcC, colr and pasp',
    f.avc1.width === 1280 && f.avc1.height === 720 && f.avc1.depth === 0x18 && same(f.avc1.kids, ['avcC', 'colr', 'pasp']), f.avc1);
  ok('avcC is the record given, byte for byte', equalBytes(f.avcC, AVCC));
  // The transfer is sRGB's (13), the canvas's own: with BT.709's (1), QuickTime and Safari showed every
  // mid-tone lighter than the canvas (grey 128 as 139); with 13 they match it within 2 levels.
  ok('colr says nclx: BT.709 primaries and matrix, the sRGB transfer, limited range, in 19 bytes', same(f.colr, ['nclx', 1, 13, 1, 0, 19]), f.colr);
  ok('square pixels', same(f.pasp, [1, 1]));
  ok('the sample table in the usual order', same(f.stblOrder, ['stsd', 'stts', 'stss', 'stsc', 'stsz', 'stco']), f.stblOrder);
  ok('each picture is shown at its own time', same(f.shown, samples.map((s) => Math.round(s.timestamp * 0.09))));
  ok('the same samples make the same file, byte for byte', equalBytes(write(inOrder(65)).file, file));
}
{
  const { file } = write(inOrder(20, 1));
  const f = read(file);
  ok('every sample a key: no stss (a missing stss means all are)', f.stss === null && f.nesting.length === 0);
  ok('fewer samples than a second: one chunk holding them all', same(f.stsc, [[1, 20, 1]]) && f.stco.length === 1);
}
{
  const { file } = write(inOrder(30, 30, 5_000_000));
  const f = read(file);
  ok('timestamps that start at 5 s start the film at 0, with no edit list', f.elst === null && f.shown[0] === 0 && f.mvhd.duration === 1000, f.shown.slice(0, 3));
}
{
  // Durations of 1/24 s and 1/60 s land on whole ticks too.
  const at = (fps) => {
    const f = read(write(Array.from({ length: 48 }, (_, i) => ({ data: bytesFor(i), timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), key: i === 0 })), { fps }).file);
    return f.ctts === null && f.stts.length === 1 && f.stts[0][1] === 90000 / fps;
  };
  ok('24 and 60 fps: one stts run of 3750 or 1500 ticks and no ctts from rounding', at(24) && at(60));
}
{
  // What encodeMp4 hands over: timestamps round(i * 1e6 / 30), durations
  // round(1e6 / 30) = 33333, a third of a microsecond short. Summed over a
  // minute that is 600 µs of drift, which must not turn into a ctts.
  const f = read(write(inOrder(1800, 60)).file);
  ok('a minute of rounded durations: one stts run, no ctts, the last frame on time',
    same(f.stts, [[1800, 3000]]) && f.ctts === null && f.shown[1799] === 1799 * 3000 && f.mvhd.duration === 60000, f.stts);
  const gap = inOrder(10).filter((_, i) => i !== 4);
  const g = read(write(gap).file);
  ok('a missing frame lengthens the one before it instead of adding a ctts',
    g.ctts === null && same(g.stts, [[3, 3000], [1, 6000], [5, 3000]]) && same(g.shown, [0, 1, 2, 3, 5, 6, 7, 8, 9].map((k) => k * 3000)), g.stts);
  const ntsc = read(write(Array.from({ length: 48 }, (_, i) => ({ data: bytesFor(i), timestamp: Math.round((i * 1001e6) / 24000), duration: Math.round(1001e6 / 24000), key: i === 0 })), { fps: 24 }).file);
  ok('23.976 fps, which 90000 does not divide: no ctts, each frame within half a tick',
    ntsc.ctts === null && ntsc.shown.every((t, i) => Math.abs(t - (i * 1001 * 90000) / 24000) <= 0.5), ntsc.stts);
  const bare = read(write(inOrder(5).map((s) => ({ ...s, duration: 0 }))).file);
  ok('samples without durations: timed by their timestamps, the last lasting one frame',
    same(bare.stts, [[5, 3000]]) && bare.mdhd.duration === 15000 && bare.ctts === null, bare.stts);
}

// ── pictures with a sound track beside them ───────────────────────────────
{
  const samples = inOrder(65);
  const plain = write(samples).file;
  const w = new Mp4Writer({ width: 1280, height: 720, fps: 30, avcC: AVCC });
  for (const s of samples) w.add(s);
  w.addAudioTrack({ asc: ascFor(48000, 2), sampleRate: 48000, channels: 2, delaySamples: 2112, totalSamples: Math.round((65 / 30) * 48000) });
  for (let j = 0; j < 104; j++) w.addAudioSample({ data: Uint8Array.of(0x21, j & 0xff, 3, 4) });
  const file = w.finish();
  const f = read(file);
  const p = read(plain);
  const top = parse(file, 0, file.length);
  const traks = get(top, 'moov').kids.filter((k) => k.type === 'trak');
  ok('with sound: two tracks, and still ftyp, moov, mdat, every box as long as it holds', traks.length === 2 && same(f.types, ['ftyp', 'moov', 'mdat']) && f.nesting.length === 0, f.nesting);
  ok('the pictures\' tables are the ones they have without sound: stts, stss, stsc, stsz, avcC, colr, lengths',
    same([f.stts, f.stss, f.stsc, f.stsz, f.colr, f.mdhd, f.tkhd], [p.stts, p.stss, p.stsc, p.stsz, p.colr, p.mdhd, p.tkhd]) && equalBytes(f.avcC, p.avcC));
  ok('only where their chunks sit has moved, and every picture is still where the index says',
    !same(f.stco, p.stco) && f.stco.length === p.stco.length && samples.every((s, i) => equalBytes(file.subarray(f.offsets[i], f.offsets[i] + s.data.length), s.data)));
  ok('the movie is as long as the longer track: 2167 ms', f.mvhd.duration === 2167);
  const plainTop = parse(plain, 0, plain.length);
  ok('without sound: one track, and the next free track id is 2, as before there was sound',
    get(plainTop, 'moov').kids.filter((k) => k.type === 'trak').length === 1 && u32(plain, get(plainTop, 'moov/mvhd').body + 96) === 2);
}

// ── pictures out of order (B-frames) ──────────────────────────────────────
{
  // Decode order I0 P3 B1 B2 P6 B4 B5 …: what an encoder with two B-frames emits.
  const order = [0];
  for (let p = 3; p < 30; p += 3) order.push(p, p - 2, p - 1);
  const samples = order.map((k, i) => ({ data: bytesFor(i), timestamp: Math.round(k * US), duration: Math.round(US), key: k === 0 }));
  const { file } = write(samples);
  const f = read(file);
  ok('reordered pictures: a ctts box, version 0, with no negative offset',
    f.ctts !== null && f.cttsVersion === 0 && f.ctts.every(([, o]) => o >= 0), f.ctts);
  ok('and one edit, at rate 1, starting where the first picture is shown',
    f.elst && f.elst.count === 1 && f.elst.rate === 1 && f.elst.mediaTime === 3000, f.elst);
  ok('each picture is shown at the moment it was meant for', same(f.shown, order.map((k) => k * 3000)), f.shown);
  ok('decode times still rise by one frame each, summing to the durations', same(f.stts, [[28, 3000]]) && f.sttsTotal === 28 * 3000);
  ok('the film is 28 frames long: 934 ms', f.elst.segment === 934 && f.mvhd.duration === 934 && f.tkhd.duration === 934, f.elst);
  ok('ctts sits between stss and stsc', same(f.stblOrder, ['stsd', 'stts', 'stss', 'ctts', 'stsc', 'stsz', 'stco']), f.stblOrder);
  ok('still every sample\'s bytes where the index says', f.nesting.length === 0
    && samples.every((s, i) => equalBytes(file.subarray(f.offsets[i], f.offsets[i] + s.data.length), s.data)));
}

// ── limits and mistakes ───────────────────────────────────────────────────
{
  // Views of one 16 MiB buffer: 4 GiB of "pictures" without 4 GiB of memory.
  // Each one NAL unit after its length, as a sample must be.
  const unit = (n) => { const b = new Uint8Array(n); new DataView(b.buffer).setUint32(0, n - 4); b[4] = 0x41; return b; };
  const big = unit(16 * 1024 * 1024);
  const w = new Mp4Writer({ width: 1920, height: 1080, fps: 30, avcC: AVCC });
  for (let i = 0; i < 255; i++) w.add({ data: big, timestamp: i * US, duration: US, key: i % 60 === 0 });
  // Just under what add allows, so only the index tips it over.
  w.add({ data: unit(0xffffffff - w.bytes - 8 - 40), timestamp: 255 * US, duration: US, key: false });
  const e = throws(() => w.finish());
  ok('a file past 4 GiB is refused at finish, with motion:too-large', e && e.message === 'motion:too-large', e && e.message);
  const w2 = new Mp4Writer({ width: 1920, height: 1080, fps: 30, avcC: AVCC });
  for (let i = 0; i < 255; i++) w2.add({ data: big, timestamp: i * US, duration: US, key: i === 0 });
  const e2 = throws(() => w2.add({ data: big, timestamp: 255 * US, duration: US, key: false }));
  ok('and at add, as soon as the pictures alone are too many', e2 && e2.message === 'motion:too-large' && w2.bytes === 255 * big.length, e2 && e2.message);
}
{
  ok('an Annex-B stream is not an avcC', throws(() => new Mp4Writer({ width: 2, height: 2, fps: 30, avcC: hex('0000000167640') })) instanceof TypeError);
  ok('a size that is not a positive whole number is refused', throws(() => new Mp4Writer({ width: 0, height: 720, fps: 30, avcC: AVCC })) instanceof RangeError
    && throws(() => new Mp4Writer({ width: 1280.5, height: 720, fps: 30, avcC: AVCC })) instanceof RangeError);
  ok('a frame rate that is not one is refused', throws(() => new Mp4Writer({ width: 2, height: 2, fps: 0, avcC: AVCC })) instanceof RangeError);
  const w = new Mp4Writer({ width: 2, height: 2, fps: 30, avcC: AVCC });
  ok('an empty sample or a NaN timestamp is refused', throws(() => w.add({ data: new Uint8Array(0), timestamp: 0, duration: 1, key: true })) instanceof TypeError
    && throws(() => w.add({ data: bytesFor(1), timestamp: NaN, duration: 1, key: true })) instanceof TypeError);
  ok('no samples, no file', /no samples/.test(throws(() => w.finish())?.message));
  const avcC = AVCC.slice();
  const w2 = new Mp4Writer({ width: 2, height: 2, fps: 30, avcC });
  avcC[1] = 0x42;
  w2.add({ data: bytesFor(1), timestamp: 0, duration: 0, key: true });
  const f = read(w2.finish());
  ok('the avcC is copied: changing the caller\'s buffer afterwards changes nothing', equalBytes(f.avcC, AVCC));
  ok('a sample without a duration lasts one frame', same(f.stts, [[1, 3000]]));
  ok('a finished writer takes nothing more', /finished/.test(throws(() => w2.add({ data: bytesFor(1), timestamp: 0, duration: 1, key: true }))?.message)
    && /finished/.test(throws(() => w2.finish())?.message));
}

// ── input that would make a file Rust saves and nothing plays ─────────────
// Each of these once came out as bytes that begin with `ftyp` (so
// export_write_video writes them) and that ffmpeg or AVFoundation cannot
// decode, or decode wrong. Now each is refused with an error.
{
  // AVCC: 01 64 00 0d ff | e1: one SPS of 0x1a bytes at 8 | 01: one PPS of 6 bytes at 37 | fd f8 f8 00.
  const cfg = (avcC) => ({ width: 320, height: 180, fps: 30, avcC });
  const refused = (avcC) => throws(() => new Mp4Writer(cfg(avcC))) instanceof TypeError;
  const at = (i, v) => { const c = AVCC.slice(); c[i] = v; return c; };
  const withSets = (spsList, ppsList, lengthByte = 0xff) => Uint8Array.from([1, 0x64, 0, 0x0d, lengthByte, 0xe0 | spsList.length,
    ...spsList.flatMap((s) => [s.length >> 8, s.length & 0xff, ...s]), ppsList.length, ...ppsList.flatMap((p) => [p.length >> 8, p.length & 0xff, ...p])]);
  const SPS1 = [...AVCC.subarray(8, 34)], PPS1 = [...AVCC.subarray(37, 43)];
  ok('an avcC with no SPS, or no PPS, is refused', refused(withSets([], [PPS1])) && refused(withSets([SPS1], [])));
  ok('an avcC claiming 31 SPS it does not hold, or cut short, is refused', refused(at(5, 0xff)) && refused(AVCC.slice(0, 20)) && refused(AVCC.slice(0, 40)));
  ok('an avcC whose "SPS" is a PPS, or whose NAL lengths are 3 bytes, is refused', refused(at(8, 0x68)) && refused(at(4, 0xfe)));
  ok('two SPS and two PPS are a record, and so is one with 2-byte lengths',
    !refused(withSets([SPS1, SPS1], [PPS1, PPS1])) && !refused(at(4, 0xfd)));

  const sample = (data, key = true, timestamp = 0) => ({ data: Uint8Array.from(data), timestamp, duration: 33333, key });
  const addError = (w, s) => throws(() => w.add(s));
  const w = new Mp4Writer(cfg(AVCC));
  ok('a first sample that is not a key frame is refused (AVFoundation decodes nothing of such a file)',
    /first sample is not a key frame/.test(addError(w, sample([0, 0, 0, 2, 0x41, 0x9a], false))?.message));
  const annexB = addError(w, sample([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00, 0x33, 0xff]));
  ok('a sample in Annex B (a start code where its length should be) is refused', annexB instanceof TypeError && /length-prefixed/.test(annexB.message), annexB?.message);
  ok('and so is one with a byte left over, or a NAL unit of length 0',
    addError(w, sample([...bytesFor(3), 0])) instanceof TypeError && addError(w, sample([0, 0, 0, 0, 0, 0, 0, 2, 0x41, 0x9a])) instanceof TypeError);
  ok('two whole NAL units in one sample are one sample', addError(w, sample([0, 0, 0, 2, 0x06, 0x05, 0, 0, 0, 2, 0x65, 0x88])) === null && w.bytes === 12);
  const w16 = new Mp4Writer(cfg(at(4, 0xfd)));
  ok('with 2-byte lengths in the avcC, samples are read with 2-byte lengths',
    addError(w16, sample([0, 2, 0x65, 0x88])) === null && addError(w16, sample([...bytesFor(1)], false, 33333)) instanceof TypeError);

  const dup = inOrder(10).map((s, i) => (i === 3 ? { ...s, timestamp: Math.round(2 * US) } : s));
  const e1 = throws(() => write(dup));
  ok('two samples at the same time are refused (AVFoundation drops one of them)', e1 instanceof RangeError && /same timestamp/.test(e1.message), e1?.message);
  // 2^32 ticks of 90 kHz is 13.25 hours: a longer gap or duration once wrapped silently (50,000 s became 2,278 s).
  const long = throws(() => write(inOrder(10).map((s, i) => (i === 9 ? { ...s, duration: 5e10 } : s))));
  const gap = throws(() => write(inOrder(10).map((s, i) => (i === 9 ? { ...s, timestamp: 5e10 } : s))));
  ok('a duration or a time past 32 bits of the track clock is refused, not wrapped',
    long instanceof RangeError && /32 bits/.test(long.message) && gap instanceof RangeError, [long?.message, gap?.message]);
  const under = read(write(inOrder(10).map((s, i) => (i === 9 ? { ...s, timestamp: 4.7e10 } : s))).file);
  ok('while one just under it is written exactly', under.shown[9] === 4.23e9 && under.nesting.length === 0, under.shown[9]);
}
{
  // Mutations of a real record and random samples: the writer either refuses
  // with a TypeError or writes a file whose boxes nest, and what it accepts as
  // a sample is whole NAL units by a reading of its own.
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
  const whole = (d) => { let p = 0; while (p < d.length) { if (p + 4 > d.length) return false; const n = u32(d, p); if (n < 1 || p + 4 + n > d.length) return false; p += 4 + n; } return true; };
  let other = 0, wrongAccept = 0, badFile = 0, accepted = 0;
  for (let k = 0; k < 400; k++) {
    const c = AVCC.slice();
    for (let m = 1 + Math.floor(rand() * 3); m > 0; m--) c[Math.floor(rand() * c.length)] = Math.floor(rand() * 256);
    let w;
    try { w = new Mp4Writer({ width: 320, height: 180, fps: 30, avcC: c }); } catch (e) { if (!(e instanceof TypeError)) other++; continue; }
    accepted++;
    const data = Uint8Array.from({ length: 1 + Math.floor(rand() * 24) }, () => (rand() < 0.5 ? 0 : Math.floor(rand() * 256)));
    try { w.add({ data, timestamp: 0, duration: 33333, key: true }); if (!whole(data) && (c[4] & 3) === 3) wrongAccept++; } catch (e) { if (!(e instanceof TypeError)) other++; }
    try { w.add({ data: bytesFor(k), timestamp: 33333, duration: 33333, key: false }); } catch { /* a 1- or 2-byte-length record */ }
    try { const f = read(w.finish()); if (f.nesting.length) badFile++; } catch (e) { if (!/no samples/.test(e.message)) other++; }
  }
  ok('400 mutated records and random samples: refused with a TypeError or written whole', other === 0 && wrongAccept === 0 && badFile === 0 && accepted > 20,
    { other, wrongAccept, badFile, accepted });
}
{
  // 200,000 samples (1.85 hours at 30 fps): the tables stay right and the index is quick to build.
  const n = 200000;
  const w = new Mp4Writer({ width: 16, height: 16, fps: 30, avcC: AVCC });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) w.add({ data: Uint8Array.of(0, 0, 0, 4, 0x41, i >> 16, (i >> 8) & 0xff, i & 0xff), timestamp: Math.round((i * 1e6) / 30), duration: 33333, key: i % 60 === 0 });
  const file = w.finish();
  const ms = Date.now() - t0;
  const f = read(file);
  ok('200,000 samples: one stts run, 6,667 chunks of 30 (the last of 20), 3,334 key frames, every offset right',
    same(f.stts, [[n, 3000]]) && same(f.stsc, [[1, 30, 1], [6667, 20, 1]]) && f.stco.length === 6667 && f.stss.length === 3334
    && f.stsz.length === n && f.offsets.every((o, i) => file[o + 4] === 0x41 && file[o + 7] === (i & 0xff)) && f.mdhd.duration === n * 3000,
    [f.stts, f.stsc, f.stco.length, f.stss.length]);
  ok('and are written in well under two seconds', ms < 2000, ms);
}

// ── Annex B ───────────────────────────────────────────────────────────────
{
  const SPS = hex('6764000dacd941419f9f0110000003001000000303c0f14299600');
  const PPS = hex('68ebe3cb22c0');
  const SC4 = [0, 0, 0, 1], SC3 = [0, 0, 1];
  const nal = (sc, bytes) => [...sc, ...bytes];
  // first_mb_in_slice = 0 sets the top bit of the byte after the header; 0x40 is a later slice of the same picture.
  const stream = Uint8Array.from([
    0, 0, // stray zeros before the first start code
    ...nal(SC4, [0x09, 0xf0]), ...nal(SC4, SPS), ...nal(SC4, PPS), ...nal(SC3, [0x06, 0x05, 0x01, 0x80]),
    ...nal(SC3, [0x65, 0x88, 0x84, 0x21]), ...nal(SC3, [0x65, 0x40, 0x84, 0x22]), 0, 0, // two slices, trailing zeros
    ...nal(SC4, [0x09, 0x30]), ...nal(SC4, [0x41, 0x9a, 0x11]),
    ...nal(SC3, [0x41, 0x9a, 0x12]), // no delimiter: a new picture by its first slice alone
    ...nal(SC4, SPS), ...nal(SC4, PPS), ...nal(SC4, [0x65, 0x88, 0x99]), // parameter sets again before the next IDR
    ...nal(SC4, [0x0c, 0xff, 0xff, 0x80]), // filler
  ]);
  const r = annexBToAvcc(stream);
  const nalsOf = (s) => { const out = []; for (let at = 0; at < s.length;) { const n = u32(s, at); out.push([...s.subarray(at + 4, at + 4 + n)]); at += 4 + n; } return out; };
  ok('four pictures, four samples', r && r.samples.length === 4, r && r.samples.length);
  ok('a picture of two slices stays one sample, with its SEI and without its delimiter',
    same(nalsOf(r.samples[0]), [[0x06, 0x05, 0x01, 0x80], [0x65, 0x88, 0x84, 0x21], [0x65, 0x40, 0x84, 0x22]]), nalsOf(r.samples[0]));
  ok('a delimiter is dropped; a picture without one is still split by its first slice',
    same(nalsOf(r.samples[1]), [[0x41, 0x9a, 0x11]]) && same(nalsOf(r.samples[2]), [[0x41, 0x9a, 0x12]]));
  ok('parameter sets already in avcC are dropped from samples, and filler with them', same(nalsOf(r.samples[3]), [[0x65, 0x88, 0x99]]), nalsOf(r.samples[3]));
  const c = r.avcC;
  ok('avcC: version 1, profile, compatibility and level copied from the SPS, 4-byte lengths',
    c[0] === 1 && c[1] === 0x64 && c[2] === 0x00 && c[3] === 0x0d && c[4] === 0xff, [...c.subarray(0, 5)]);
  ok('avcC: one SPS and one PPS, each byte for byte',
    c[5] === 0xe1 && u16(c, 6) === SPS.length && equalBytes(c.subarray(8, 8 + SPS.length), SPS)
    && c[8 + SPS.length] === 1 && equalBytes(c.subarray(11 + SPS.length, 11 + SPS.length + PPS.length), PPS));
  ok('High profile: the chroma and bit-depth fields follow (4:2:0, 8 bits, no extensions)',
    same([...c.subarray(c.length - 4)], [0xfd, 0xf8, 0xf8, 0]) && c.length === 11 + SPS.length + PPS.length + 4);
  ok('the same record x264 itself makes for this SPS and PPS', equalBytes(c, AVCC));
  const avcCFor = (sps) => annexBToAvcc(Uint8Array.from([...nal(SC4, sps), ...nal(SC4, PPS), ...nal(SC4, [0x65, 0x88])])).avcC;
  const baseline = avcCFor([0x67, 0x42, 0xc0, 0x1e, 0xda, 0x02]);
  ok('Baseline: no chroma fields', baseline.length === 6 + 2 + 6 + 1 + 2 + PPS.length && baseline[1] === 0x42);
  // High 4:4:4 (244): sps_id 0, chroma_format_idc 3, separate planes 0, depths 0 → 1 00100 0 1 1.
  const four44 = avcCFor([0x67, 0xf4, 0x00, 0x1e, 0x91, 0x80]);
  // High 10 (110): sps_id 0, chroma 1, luma and chroma depth 2 → 1 010 011 011.
  const ten = avcCFor([0x67, 0x6e, 0x00, 0x1e, 0xa6, 0xc0]);
  ok('the chroma format and bit depths are read from the SPS, not assumed',
    same([...four44.subarray(four44.length - 4)], [0xff, 0xf8, 0xf8, 0]) && same([...ten.subarray(ten.length - 4)], [0xfd, 0xfa, 0xfa, 0]),
    [[...four44.subarray(four44.length - 4)], [...ten.subarray(ten.length - 4)]]);
  ok('no parameter sets, no pictures, or no start codes: null',
    annexBToAvcc(Uint8Array.from(nal(SC4, [0x65, 0x88]))) === null
    && annexBToAvcc(Uint8Array.from([...nal(SC4, SPS), ...nal(SC4, PPS)])) === null
    && annexBToAvcc(Uint8Array.from([1, 2, 3, 4, 5])) === null && annexBToAvcc(new Uint8Array(0)) === null);
}

// ── purity ────────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../src/motionmp4.ts', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('motionmp4.ts imports nothing and touches no DOM', !/^import\s/m.test(code) && !/\b(document|window|navigator|HTML\w*|VideoEncoder)\b/.test(code));
}

// ── against ffmpeg, when it is installed ──────────────────────────────────
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
if (has('ffmpeg') && has('ffprobe') && /libx264/.test(spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '')) {
  const dir = join(fileURLToPath(new URL('../.test-build/', import.meta.url)), `motionmp4-ffmpeg-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const hashes = (text) => text.split('\n').filter((l) => /^0,/.test(l)).map((l) => l.split(',').map((x) => x.trim()));
  try {
    for (const bf of [0, 2]) {
      const ref = join(dir, `ref${bf}.mp4`), raw = join(dir, `ref${bf}.h264`), out = join(dir, `out${bf}.mp4`);
      // ffmpeg's own MP4 of a 2-second clip, and the same stream as Annex B;
      // x264's access unit delimiters are on, so the splitter meets them too.
      run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '2', '-c:v', 'libx264',
        '-bf', String(bf), '-pix_fmt', 'yuv420p', '-x264-params', 'aud=1', ref]);
      run('ffmpeg', ['-v', 'error', '-y', '-i', ref, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', raw]);
      const packets = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=time_base:packet=pts,duration,flags',
        '-of', 'json', ref]).stdout);
      const [num, den] = packets.streams[0].time_base.split('/').map(Number);
      const us = (t) => (t * num * 1e6) / den;
      const conv = annexBToAvcc(new Uint8Array(readFileSync(raw)));
      const pk = packets.packets;
      ok(`ffmpeg -bf ${bf}: Annex B splits into its 60 pictures`, conv && conv.samples.length === 60 && pk.length === 60, [conv?.samples.length, pk.length]);
      // ffmpeg's own samples, read through its own index, less delimiters:
      // the splitter must cut exactly where ffmpeg did.
      const rf = new Uint8Array(readFileSync(ref));
      const rr = read(rf);
      const strip = (s) => { const kept = []; for (let at = 0; at < s.length;) { const n = u32(s, at); if ((s[at + 4] & 0x1f) !== 9) kept.push(...s.subarray(at, at + 4 + n)); at += 4 + n; } return kept; };
      ok(`ffmpeg -bf ${bf}: every sample is byte for byte ffmpeg's own`,
        conv.samples.every((s, i) => equalBytes(s, strip(rf.subarray(rr.offsets[i], rr.offsets[i] + rr.stsz[i])))));
      const w = new Mp4Writer({ width: 320, height: 180, fps: 30, avcC: conv.avcC });
      conv.samples.forEach((data, i) => w.add({ data, timestamp: us(pk[i].pts), duration: us(pk[i].duration), key: pk[i].flags[0] === 'K' }));
      const file = w.finish();
      writeFileSync(out, file);
      const f = read(file);
      ok(`ffmpeg -bf ${bf}: ctts and elst ${bf ? 'present' : 'absent'}`, bf ? f.ctts !== null && f.elst !== null : f.ctts === null && f.elst === null);
      const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,duration:format=duration',
        '-of', 'json', out]).stdout || '{}');
      const st = (probe.streams || [])[0] || {};
      ok(`ffprobe -bf ${bf}: h264, 320x180, 60 frames, 2.0 s`,
        st.codec_name === 'h264' && st.width === 320 && st.height === 180 && st.nb_frames === '60'
        && Math.abs(Number(st.duration) - 2) < 0.001 && Math.abs(Number(probe.format?.duration) - 2) < 0.001, probe);
      const colour = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=color_primaries,color_transfer,color_space,color_range', '-of', 'json', out]).stdout || '{}').streams?.[0];
      ok(`ffprobe -bf ${bf}: reads the colour as BT.709 primaries and matrix, the sRGB transfer, limited range`,
        same([colour?.color_primaries, colour?.color_transfer, colour?.color_space, colour?.color_range], ['bt709', 'iec61966-2-1', 'bt709', 'tv']), colour);
      const mine = run('ffmpeg', ['-v', 'error', '-i', out, '-f', 'framemd5', '-']);
      const theirs = run('ffmpeg', ['-v', 'error', '-i', ref, '-f', 'framemd5', '-']);
      ok(`ffmpeg -bf ${bf}: decodes with nothing on stderr`, mine.status === 0 && mine.stderr === '', mine.stderr.slice(0, 300));
      const a = hashes(mine.stdout), b = hashes(theirs.stdout);
      ok(`ffmpeg -bf ${bf}: the same 60 frames as ffmpeg's own MP4, in the same order at the same times`,
        a.length === 60 && same(a, b), a.findIndex((x, i) => !same(x, b[i])));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
