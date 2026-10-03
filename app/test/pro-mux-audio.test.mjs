// An MP4 with sound, and an export that does not repaint what cannot have
// changed (work package 03: motionaudioenc.ts, the sound track in
// motionmp4.ts, motionencode.ts's audio and repeated frames,
// motionexportops.ts's changingFrames and renderMp4's sound).
//
// What matters:
//   - AAC configs are read and written as 14496-3 says, and anything else is
//     refused; a bed is fitted to the film (two channels, its length, -1..1);
//     resampling keeps a tone and stops what would fold back;
//   - WebKit's description (a whole ES_Descriptor), ADTS frames and a missing
//     description all end as a correct AudioSpecificConfig and raw frames;
//   - the priming is read from timestamps when an encoder gives it, measured
//     when it does not, and 1024 when it cannot be measured;
//   - a box-walker written from the standard parses the file: every size
//     consistent, both tracks' samples tiling mdat exactly, chunks interleaved
//     by the second, durations agreeing within a frame, the edit list skipping
//     the priming and stopping before the padding, esds/mp4a/roll as written;
//   - where ffmpeg is installed: its AAC (priming 1024) muxed beside its H.264
//     decodes with nothing on stderr, to the same samples ffmpeg decodes from
//     the raw stream less its priming, the clicks where they were put;
//   - the encoder with fake WebCodecs: sound kept, dropped (no encoder, no
//     rate, a failure) without failing the film, Cancel during the sound, and
//     repeated frames encoded without being drawn;
//   - changingFrames against full renders on the recording canvas: no frame
//     that differs is ever skipped (every template, languages, shapes, blur,
//     and fuzzed timings), and on a document whose times fall between frames
//     the frames painted are exactly the frames that differ.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeCanvas } from './motioncanvas.mjs';
import { Mp4Writer, annexBToAvcc, ascFor, readAsc } from '../.test-build/motionmp4.js';
import {
  AAC_BITRATE, AAC_CODEC, AAC_RATE, DEFAULT_DELAY, adtsFrame, ascOf, burst, canEncodeAac, encodeAac, fitBed, lagOf, normalise, resample,
} from '../.test-build/motionaudioenc.js';
import { encodeMp4, withReport } from '../.test-build/motionencode.js';
import { changingFrames, renderMp4, unitsBound } from '../.test-build/motionexportops.js';
import { paint } from '../.test-build/motiondraw.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { RECIPE_IDS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (u) => Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const throws = (fn) => { try { fn(); return null; } catch (e) { return e; } };
let seed = 20261003;
const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32; };
const started = Date.now();

// ── AAC configs ───────────────────────────────────────────────────────────
console.log('AAC configs');
{
  ok('48 kHz stereo AAC-LC is 11 90, 44.1 kHz stereo 12 10, 22.05 kHz 13 90, 48 kHz mono 11 88',
    hex(ascFor(48000, 2)) === '1190' && hex(ascFor(44100, 2)) === '1210' && hex(ascFor(22050, 2)) === '1390' && hex(ascFor(48000, 1)) === '1188');
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const chans = [1, 2, 3, 4, 5, 6, 8];
  ok('every indexed rate and every channel layout reads back as written, two bytes, 1024-sample frames',
    rates.every((r) => chans.every((c) => { const a = ascFor(r, c); const back = readAsc(a); return a.length === 2 && same(back, { objectType: 2, sampleRate: r, channels: c, frameLength: 1024 }); })));
  const odd = ascFor(50000, 2);
  ok('a rate with no index is written out in 24 bits (five bytes) and reads back', odd.length === 5 && same(readAsc(odd), { objectType: 2, sampleRate: 50000, channels: 2, frameLength: 1024 }), hex(odd));
  ok('no config for 7 channels, 9, 0, or a rate that is not a whole positive number',
    [ascFor(48000, 7), ascFor(48000, 9), ascFor(48000, 0), ascFor(0, 2), ascFor(44100.5, 2), ascFor(-48000, 2)].every((x) => x === null));
  ok('the frame-length flag reads as 960-sample frames', readAsc(unhex('1194'))?.frameLength === 960);
  ok('an escaped object type is read past (and refused: not plain AAC)', readAsc(unhex('f8 00 00 00'.replace(/ /g, ''))) === null);
  ok('HE-AAC (5), PS (29), object type 0 and channel config 0 are refused',
    [unhex('2b92'), unhex('eb92'), unhex('0190'), unhex('1180')].every((a) => readAsc(a) === null));
  ok('a reserved rate index (13, 14) is refused, and a config cut short', readAsc(unhex('1690')) === null && readAsc(unhex('1710')) === null
    && readAsc(unhex('11')) === null && readAsc(new Uint8Array(0)) === null && readAsc(unhex('1780')) === null && readAsc('1190') === null);
  let threw = 0, bad = 0;
  for (let k = 0; k < 3000; k++) {
    const a = Uint8Array.from({ length: 1 + Math.floor(rand() * 7) }, () => Math.floor(rand() * 256));
    try {
      const r = readAsc(a);
      if (r && !(r.objectType >= 1 && r.objectType <= 4 && r.sampleRate > 0 && [1, 2, 3, 4, 5, 6, 8].includes(r.channels) && [960, 1024].includes(r.frameLength))) bad++;
    } catch { threw++; }
  }
  ok('3,000 random configs: never a throw, and what is accepted is plain AAC with real channels', threw === 0 && bad === 0, { threw, bad });
}

// ── the bed ───────────────────────────────────────────────────────────────
console.log('the bed');
{
  const L = Float32Array.from([0.5, -0.5, NaN, Infinity, -Infinity, 2, -3, 0.25]);
  const R = Float32Array.from([0.1, 0.2]);
  const bed = { channels: [L, R, new Float32Array(8)], sampleRate: 8000 };
  const f = fitBed(bed);
  ok('two channels, new arrays: the caller\'s are untouched', f.channels.length === 2 && f.channels[0] !== L && Number.isNaN(L[2]) && L[3] === Infinity);
  ok('NaN is silence; infinities and anything past full scale are full scale', same([...f.channels[0]], [0.5, -0.5, 0, 1, -1, 1, -1, 0.25]));
  ok('the shorter channel is made up with silence to the longer', f.channels[1].length === 8 && Math.abs(f.channels[1][1] - 0.2) < 1e-7 && f.channels[1][7] === 0);
  const mono = fitBed({ channels: [Float32Array.from([0.3, 0.4])], sampleRate: 48000 }, 0.0001);
  ok('a mono bed is played on both channels; fitted to 0.0001 s it is 5 samples',
    mono.channels.length === 2 && mono.channels[0].length === 5 && Math.abs(mono.channels[1][1] - 0.4) < 1e-7 && mono.channels[1][4] === 0);
  const cut = fitBed({ channels: [new Float32Array(48000).fill(0.1)], sampleRate: 48000 }, 0.5);
  ok('a bed longer than the film is cut to it', cut.channels[0].length === 24000);
  ok('no Float32Array channel, no channels, or a rate that is not one: null',
    [fitBed({ channels: [], sampleRate: 48000 }), fitBed({ channels: [[0.1, 0.2]], sampleRate: 48000 }), fitBed({ channels: [new Float32Array(4)], sampleRate: NaN }),
      fitBed({ channels: [new Float32Array(4)], sampleRate: 100 }), fitBed({ channels: [new Float32Array(4)], sampleRate: 1e6 }), fitBed(null), fitBed({})].every((x) => x === null));
}
{
  const tone = (n, f, rate, a = 0.5) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / rate));
  const err = (got, f, rate, a = 0.5) => { let m = 0; for (let i = 400; i < got.length - 400; i++) m = Math.max(m, Math.abs(got[i] - a * Math.sin((2 * Math.PI * f * i) / rate))); return m; };
  const peak = (x) => { let m = 0; for (let i = 400; i < x.length - 400; i++) m = Math.max(m, Math.abs(x[i])); return m; };
  const up = resample(tone(44100, 1000, 44100), 44100, 48000);
  ok('44.1 → 48 kHz: one second is 48,000 samples', up.length === 48000);
  ok('and a 1 kHz tone is the same tone, within 0.1% of full scale', err(up, 1000, 48000) < 1e-3, err(up, 1000, 48000));
  const down = resample(tone(48000, 15000, 48000), 48000, 44100);
  ok('48 → 44.1 kHz: a 15 kHz tone passes, within 1%', down.length === 44100 && err(down, 15000, 44100) < 0.01, err(down, 15000, 44100));
  const alias = resample(tone(48000, 23500, 48000), 48000, 44100);
  ok('and a 23.5 kHz tone, which would fold back to 20.6 kHz, is stopped (below -50 dB)', peak(alias) < 0.5 * 10 ** (-50 / 20), peak(alias));
  const dc = resample(new Float32Array(22050).fill(0.25), 22050, 48000);
  ok('a steady level is kept (22.05 → 48 kHz)', dc.length === 48000 && Math.abs(dc[24000] - 0.25) < 1e-6, dc[24000]);
  const id = Float32Array.from([1, 2, 3]);
  const copy = resample(id, 48000, 48000);
  ok('the same rate is a copy', copy !== id && same([...copy], [1, 2, 3]));
  ok('the first samples coincide: sample 0 is the input\'s sample 0', Math.abs(resample(tone(4800, 100, 48000, 0.5).map((v, i) => (i < 10 ? 0.3 : v)), 48000, 44100)[0] - 0.3) < 0.05);
  ok('rates that are not rates throw', [[48000, 0], [0, 48000], [NaN, 1], [48000, Infinity]].every(([a, b]) => throws(() => resample(id, a, b)) instanceof RangeError));
  ok('an empty bed resamples to nothing', resample(new Float32Array(0), 44100, 48000).length === 0);
}

// ── descriptions, ADTS, priming ───────────────────────────────────────────
console.log('descriptions, ADTS, priming');
const WEBKIT_DESCRIPTION = '038080802200000004808080144014001800000000000000000005808080021190068080800102';
{
  ok('a description that is an AudioSpecificConfig is taken as it is', hex(ascOf(unhex('1190'))) === '1190' && hex(ascOf(unhex('1210'))) === '1210');
  ok('WebKit\'s description (a whole ES_Descriptor, as measured on macOS 26.2) gives the config inside it: 11 90', hex(ascOf(unhex(WEBKIT_DESCRIPTION))) === '1190');
  // ffmpeg's own esds: ES_ID 1, a DecoderSpecificInfo of five bytes (an explicit SBR signal after the core config).
  ok('so does ffmpeg\'s esds payload', hex(ascOf(unhex('0380808025000100048080801740150000000001f40000000f3c0580808005119056e500068080800102'))) === '119056e500');
  ok('a description that is neither, or an ES_Descriptor cut short or whose config is not AAC: null',
    [unhex('0000'), unhex('ffff'), unhex('03808080'), unhex(WEBKIT_DESCRIPTION.slice(0, 50)), unhex(WEBKIT_DESCRIPTION.replace('021190', '020190')), null, undefined, new Uint8Array(1)]
      .every((d) => ascOf(d) === null));
  ok('the config is a copy, not a view of the description', (() => { const d = unhex('1190'); const a = ascOf(d); d[0] = 0; return a[0] === 0x11; })());
  let threw = 0;
  for (let k = 0; k < 3000; k++) {
    const d = unhex(WEBKIT_DESCRIPTION);
    for (let m = 1 + Math.floor(rand() * 4); m > 0; m--) d[Math.floor(rand() * d.length)] = Math.floor(rand() * 256);
    try { const a = ascOf(rand() < 0.3 ? d.subarray(0, Math.floor(rand() * d.length)) : d); if (a && !readAsc(a)) threw++; } catch { threw++; }
  }
  ok('3,000 mutated descriptions: never a throw, and never a config that does not read', threw === 0, threw);
}
const adts = (payload, rateIndex = 3, config = 2, crc = false) => {
  const len = payload.length + (crc ? 9 : 7);
  return Uint8Array.from([0xff, crc ? 0xf0 : 0xf1, (1 << 6) | (rateIndex << 2) | (config >> 2), ((config & 3) << 6) | (len >> 11), (len >> 3) & 0xff, ((len & 7) << 5) | 0x1f, 0xfc, ...(crc ? [0xab, 0xcd] : []), ...payload]);
};
{
  const a = adtsFrame(adts([1, 2, 3, 4]));
  ok('an ADTS frame: 48 kHz stereo, the payload after its 7-byte header', a && a.sampleRate === 48000 && a.channels === 2 && same([...a.payload], [1, 2, 3, 4]));
  const c = adtsFrame(adts([9, 8], 4, 1, true));
  ok('with a CRC the header is 9 bytes; 44.1 kHz mono', c && c.sampleRate === 44100 && c.channels === 1 && same([...c.payload], [9, 8]));
  const main = adts([1]); main[2] &= 0x3f; // profile 0: AAC Main
  const short = adts([1, 2, 3]).subarray(0, 8);
  ok('not ADTS, not AAC-LC, a length past the data, or a reserved rate: null',
    [adtsFrame(unhex('21000340681c')), adtsFrame(main), adtsFrame(short), adtsFrame(adts([1], 13)), adtsFrame(adts([1], 3, 0)), adtsFrame(new Uint8Array(3))].every((x) => x === null));
}
{
  const frames = [{ data: Uint8Array.of(1, 2), timestamp: 0, duration: 21333 }, { data: Uint8Array.of(3), timestamp: 21333, duration: 21333 }];
  const fromDesc = normalise(unhex(WEBKIT_DESCRIPTION), frames, 48000, 2);
  ok('normalise: WebKit\'s description, frames as they are', fromDesc && hex(fromDesc.asc) === '1190' && fromDesc.frames === frames);
  const fromAdts = normalise(null, frames.map((f) => ({ ...f, data: adts(f.data) })), 48000, 2);
  ok('normalise: no description and ADTS frames: the config from the header, the headers stripped',
    fromAdts && hex(fromAdts.asc) === '1190' && same(fromAdts.frames.map((f) => [...f.data]), [[1, 2], [3]]) && fromAdts.frames[1].timestamp === 21333);
  ok('normalise: no description, raw frames: the config built from the settings', hex(normalise(null, frames, 44100, 2)?.asc ?? []) === '1210');
  ok('normalise: a description whose object type is 0 is not believed; the settings are', hex(normalise(unhex('0190'), frames, 48000, 2)?.asc ?? []) === '1190');
  ok('normalise: a config that says another rate or channel count, an ADTS stream that breaks off, or an empty frame: null',
    normalise(unhex('1210'), frames, 48000, 2) === null && normalise(unhex('1188'), frames, 48000, 2) === null
    && normalise(null, [{ ...frames[0], data: adts([1]) }, frames[1]], 48000, 2) === null
    && normalise(unhex('1190'), [{ ...frames[0], data: new Uint8Array(0) }], 48000, 2) === null);
}
{
  const ref = burst();
  ok('the measuring burst: the same every time, 2,048 samples of noise then silence', same([...burst().subarray(0, 64)], [...ref.subarray(0, 64)])
    && ref.subarray(2048).every((v) => v === 0) && ref.subarray(0, 2048).some((v) => Math.abs(v) > 0.2) && ref.subarray(0, 2048).every((v) => Math.abs(v) <= 0.5));
  const delayed = (lag, gain, noise) => { const out = new Float32Array(ref.length + lag); for (let i = 0; i < ref.length; i++) out[i + lag] = gain * ref[i] + noise * (rand() * 2 - 1); return out; };
  ok('the lag of a burst delayed 2112 samples is 2112', lagOf(ref, delayed(2112, 1, 0)) === 2112);
  ok('and of 1024, 0 and 4800, at a third of the level, under noise as loud as a codec\'s', [1024, 0, 4800].every((lag) => lagOf(ref, delayed(lag, 0.33, 0.08)) === lag),
    [1024, 0, 4800].map((lag) => lagOf(ref, delayed(lag, 0.33, 0.08))));
  ok('silence, noise alone, or too little to search: no lag, not a guess',
    lagOf(ref, new Float32Array(9000)) === null && lagOf(ref, Float32Array.from({ length: 9000 }, () => rand() - 0.5)) === null && lagOf(ref, new Float32Array(100)) === null);
  ok('a lag past the most looked for is not found', lagOf(ref, delayed(7000, 1, 0)) === null);
}

// ── the sound track in the file ───────────────────────────────────────────
console.log('the sound track in the file');
const u32 = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u16 = (b, at) => (b[at] << 8) + b[at + 1];
const i16 = (b, at) => (u16(b, at) << 16) >> 16;
const i32 = (b, at) => u32(b, at) | 0;
const fourcc = (b, at) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
/** A box tree, from ISO 14496-12 rather than from the writer: containers, and the boxes whose children follow fixed fields. */
function boxes(b, from = 0, to = b.length, errors = []) {
  const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'dinf', 'stbl']);
  const KIDS_AT = { stsd: 16, dref: 16, avc1: 86, mp4a: 36 };
  const list = [];
  let at = from;
  while (at < to) {
    const size = at + 8 <= to ? u32(b, at) : 0;
    if (size < 8 || at + size > to) { errors.push(`bad size at ${at}`); break; }
    const x = { type: fourcc(b, at + 4), at, size, body: at + 8, end: at + size };
    if (CONTAINERS.has(x.type)) x.kids = boxes(b, at + 8, at + size, errors);
    else if (KIDS_AT[x.type]) x.kids = boxes(b, at + KIDS_AT[x.type], at + size, errors);
    list.push(x);
    at += size;
  }
  if (at !== to) errors.push(`overrun at ${to}`);
  list.errors = errors;
  return list;
}
const kid = (x, path) => path.split('/').reduce((cur, t) => cur && (cur.kids || []).find((k) => k.type === t), x);
const table = (b, x, width) => (x ? Array.from({ length: u32(b, x.body + 4) }, (_, i) => (width === 1 ? u32(b, x.body + 8 + i * 4)
  : Array.from({ length: width }, (_, j) => (width === 3 || j === 0 ? u32 : i32)(b, x.body + 8 + (i * width + j) * 4)))) : null);
/** MPEG-4 descriptors (14496-1): tag, 7-bit-piece length, body. */
function descriptors(b, from, to) {
  const out = [];
  let at = from;
  while (at < to) {
    const tag = b[at++];
    let size = 0;
    for (let n = 0; n < 4; n++) { const x = b[at++]; size = size * 128 + (x & 0x7f); if (!(x & 0x80)) break; }
    out.push({ tag, body: at, end: at + size });
    at += size;
  }
  return { list: out, overrun: at !== to };
}
/** Everything about a file the checks look at, read from its bytes. */
function readFile(b) {
  const errors = [];
  const top = boxes(b, 0, b.length, errors);
  const moov = top.find((x) => x.type === 'moov');
  const traks = moov.kids.filter((x) => x.type === 'trak');
  const mvhd = kid(moov, 'mvhd');
  const f = { errors, top: top.map((x) => x.type), mvhd: { scale: u32(b, mvhd.body + 12), duration: u32(b, mvhd.body + 16), next: u32(b, mvhd.body + 96) } };
  const mdat = top.find((x) => x.type === 'mdat');
  f.mdat = { from: mdat.body, to: mdat.end };
  f.tracks = traks.map((t) => {
    const tkhd = kid(t, 'tkhd');
    const mdhd = kid(t, 'mdia/mdhd');
    const stbl = kid(t, 'mdia/minf/stbl');
    const s = (n) => kid(stbl, n);
    const stsz = s('stsz');
    const sizes = Array.from({ length: u32(b, stsz.body + 8) }, (_, i) => u32(b, stsz.body + 12 + i * 4));
    const stsc = table(b, s('stsc'), 3);
    const stco = table(b, s('stco'), 1);
    const offsets = [];
    const chunks = [];
    let n = 0;
    stco.forEach((chunkAt, c) => {
      let per = 0;
      for (const [first, count] of stsc) if (first <= c + 1) per = count;
      chunks.push({ at: chunkAt, first: n, count: per });
      let p = chunkAt;
      for (let k = 0; k < per && n < sizes.length; k++, n++) { offsets.push(p); p += sizes[n]; }
    });
    const elst = kid(t, 'edts/elst');
    const tr = {
      handler: fourcc(b, kid(t, 'mdia/hdlr').body + 8),
      tkhd: { flags: u32(b, tkhd.body) & 0xffffff, id: u32(b, tkhd.body + 12), duration: u32(b, tkhd.body + 20), group: u16(b, tkhd.body + 34), volume: u16(b, tkhd.body + 36) },
      mdhd: { scale: u32(b, mdhd.body + 12), duration: u32(b, mdhd.body + 16) },
      stts: table(b, s('stts'), 2), stsc, stco, sizes, offsets, chunks,
      elst: elst ? { count: u32(b, elst.body + 4), segment: u32(b, elst.body + 8), mediaTime: i32(b, elst.body + 12), rate: u16(b, elst.body + 16) } : null,
      kids: kid(t, 'mdia/minf').kids.map((x) => x.type), stbl: stbl.kids.map((x) => x.type),
    };
    const mp4a = s('stsd/mp4a');
    if (mp4a) {
      tr.mp4a = { ref: u16(b, mp4a.body + 6), channels: u16(b, mp4a.body + 16), bits: u16(b, mp4a.body + 18), rate: u32(b, mp4a.body + 24) / 65536 };
      const esds = kid(mp4a, 'esds');
      const es = descriptors(b, esds.body + 4, esds.end);
      const esd = es.list[0];
      const inner = descriptors(b, esd.body + 3, esd.end);
      const dc = inner.list.find((d) => d.tag === 4);
      const sl = inner.list.find((d) => d.tag === 6);
      const dsi = descriptors(b, dc.body + 13, dc.end).list.find((d) => d.tag === 5);
      tr.esds = {
        overrun: es.overrun || inner.overrun, tag: esd.tag, esId: u16(b, esd.body), object: b[dc.body], stream: b[dc.body + 1],
        buffer: (b[dc.body + 2] << 16) + u16(b, dc.body + 3), max: u32(b, dc.body + 5), avg: u32(b, dc.body + 9),
        asc: hex(b.subarray(dsi.body, dsi.end)), sl: sl && b[sl.body],
      };
      const sgpd = s('sgpd');
      const sbgp = s('sbgp');
      tr.roll = sgpd && sbgp ? { version: b[sgpd.body], type: fourcc(b, sgpd.body + 4), length: u32(b, sgpd.body + 8), entries: u32(b, sgpd.body + 12), distance: i16(b, sgpd.body + 16),
        groupType: fourcc(b, sbgp.body + 4), runs: u32(b, sbgp.body + 8), count: u32(b, sbgp.body + 12), index: u32(b, sbgp.body + 16) } : null;
    }
    return tr;
  });
  return f;
}
// An x264 AVCDecoderConfigurationRecord, and samples that say which they are (one NAL unit each).
const AVCC = unhex('0164000dffe1001a6764000dacd941419f9f0110000003001000000303c0f142996001000668ebe3cb22c0fdf8f800');
const picture = (i) => { const b = new Uint8Array(40 + ((i * 37) % 300)); for (let k = 0; k < b.length; k++) b[k] = (i * 7 + k) & 0xff; new DataView(b.buffer).setUint32(0, b.length - 4); b[4] = 0x41; return b; };
const sound = (j) => { const b = new Uint8Array(6 + ((j * 53) % 400)); for (let k = 0; k < b.length; k++) b[k] = (j * 11 + k * 3) & 0xff; b[0] = 0x21; return b; };
function film({ fps = 30, frames = 120, rate = 48000, delay = 2112, total = Math.round((frames / fps) * rate), count = Math.ceil((delay + total) / 1024), asc = ascFor(rate, 2) } = {}) {
  const w = new Mp4Writer({ width: 640, height: 360, fps, avcC: AVCC });
  const pictures = Array.from({ length: frames }, (_, i) => picture(i));
  pictures.forEach((data, i) => w.add({ data, timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), key: i % 60 === 0 }));
  w.addAudioTrack({ asc, sampleRate: rate, channels: 2, delaySamples: delay, totalSamples: total });
  const sounds = Array.from({ length: count }, (_, j) => sound(j));
  for (const data of sounds) w.addAudioSample({ data, timestamp: 0, duration: 0 });
  const bytes = w.bytes;
  return { file: w.finish(), pictures, sounds, bytes };
}
{
  const fps = 30, frames = 120, rate = 48000, delay = 2112, total = 192000;
  const { file, pictures, sounds, bytes } = film({ fps, frames, rate, delay, total });
  const f = readFile(file);
  const [v, a] = f.tracks;
  ok('ftyp, moov, mdat; every box exactly as long as what it holds', same(f.top, ['ftyp', 'moov', 'mdat']) && f.errors.length === 0, f.errors);
  ok('two tracks: the pictures (1) then the sound (2); the next free track id is 3',
    f.tracks.length === 2 && v.handler === 'vide' && a.handler === 'soun' && v.tkhd.id === 1 && a.tkhd.id === 2 && f.mvhd.next === 3);
  const all = [...v.sizes, ...a.sizes].reduce((s, x) => s + x, 0);
  ok('stsz: both tracks\' sizes sum to the mdat payload, and to what the writer counted', all === f.mdat.to - f.mdat.from && all === bytes);
  const spans = [...v.offsets.map((o, i) => [o, o + v.sizes[i]]), ...a.offsets.map((o, j) => [o, o + a.sizes[j]])].sort((x, y) => x[0] - y[0]);
  ok('every chunk offset lands inside mdat, and the samples tile it exactly: no gap, no overlap',
    spans[0][0] === f.mdat.from && spans[spans.length - 1][1] === f.mdat.to && spans.every((s, i) => i === 0 || s[0] === spans[i - 1][1])
    && [...v.stco, ...a.stco].every((o) => o >= f.mdat.from && o < f.mdat.to));
  ok('each picture and each sound frame is where the index says, byte for byte',
    pictures.every((p, i) => same([...file.subarray(v.offsets[i], v.offsets[i] + p.length)], [...p]))
    && sounds.every((s, j) => same([...file.subarray(a.offsets[j], a.offsets[j] + s.length)], [...s])));
  const order = [...v.chunks.map((c, k) => ({ t: 'v', k, at: c.at })), ...a.chunks.map((c, k) => ({ t: 'a', k, at: c.at, first: c.first }))].sort((x, y) => x.at - y.at);
  const second = (j) => Math.max(0, Math.floor((j * 1024 - delay) / rate + 1e-9));
  ok('interleaved by the second: a second of pictures, then the sound heard in it', order.map((c) => c.t).join('') === 'vavavava'
    && a.chunks.every((c, k) => second(c.first) === k && second(c.first + c.count - 1) === k), order.map((c) => c.t).join(''));
  ok('the sound\'s chunks hold every frame once, in order', a.chunks.reduce((s, c) => s + c.count, 0) === sounds.length && a.chunks.every((c, k) => k === 0 || c.first === a.chunks[k - 1].first + a.chunks[k - 1].count));
  ok('the sound is on its own clock: one tick a sample, every frame 1024', a.mdhd.scale === rate && same(a.stts, [[sounds.length, 1024]]) && a.mdhd.duration === sounds.length * 1024);
  ok('one edit, rate 1: from the first sample after the 2112 of priming, for exactly 4000 ms (the input, not the padding)',
    a.elst && a.elst.count === 1 && a.elst.mediaTime === 2112 && a.elst.segment === 4000 && a.elst.rate === 1, a.elst);
  ok('the two tracks are as long as each other, and the film is that long: 4000 ms',
    v.tkhd.duration === 4000 && a.tkhd.duration === 4000 && f.mvhd.duration === 4000 && Math.abs(v.tkhd.duration - a.tkhd.duration) <= 1000 / fps, [v.tkhd, a.tkhd, f.mvhd]);
  ok('the pictures keep no edit list (they start at 0), as before there was sound', v.elst === null && v.mdhd.scale === 90000 && same(v.stts, [[120, 3000]]));
  ok('the sound track header: enabled, alternate group 1, volume 1.0', a.tkhd.flags === 3 && a.tkhd.group === 1 && a.tkhd.volume === 0x0100);
  ok('a sound media handler and header: soun, smhd, then dinf and stbl', same(a.kids, ['smhd', 'dinf', 'stbl']));
  ok('mp4a: data reference 1, two channels of 16 bits at 48000 Hz', same(a.mp4a, { ref: 1, channels: 2, bits: 16, rate: 48000 }), a.mp4a);
  const biggest = Math.max(...sounds.map((s) => s.length));
  const bits = sounds.reduce((s, x) => s + x.length, 0) * 8;
  ok('esds: an ES_Descriptor for track 2 of MPEG-4 audio (0x40, stream type 5), the AudioSpecificConfig inside, SL 2',
    a.esds.tag === 3 && !a.esds.overrun && a.esds.esId === 2 && a.esds.object === 0x40 && a.esds.stream === 0x15 && a.esds.asc === '1190' && a.esds.sl === 2, a.esds);
  ok('esds: the largest frame as the buffer, the average bitrate over the frames, the busiest second at or above it',
    a.esds.buffer === biggest && a.esds.avg === Math.round(bits / ((sounds.length * 1024) / rate)) && a.esds.max >= a.esds.avg, a.esds);
  ok('a roll group of -1 that every sound frame belongs to (AVFoundation trims twice without it)',
    same(a.roll, { version: 1, type: 'roll', length: 2, entries: 1, distance: -1, groupType: 'roll', runs: 1, count: sounds.length, index: 1 }), a.roll);
  ok('the sound\'s sample table in order: stsd, stts, stsc, stsz, stco, sgpd, sbgp', same(a.stbl, ['stsd', 'stts', 'stsc', 'stsz', 'stco', 'sgpd', 'sbgp']), a.stbl);
  const again = film({ fps, frames, rate, delay, total }).file;
  ok('the same samples make the same file, byte for byte', again.length === file.length && again.every((x, i) => x === file[i]));
}
{
  // Shapes the timing can take: 44.1 kHz at 24 fps, priming 1024, sound a little longer or shorter than the pictures, 960-sample frames.
  for (const c of [
    { fps: 24, frames: 72, rate: 44100, delay: 1024 },
    { fps: 60, frames: 300, rate: 48000, delay: 0 },
    { fps: 30, frames: 90, rate: 48000, delay: 2112, total: 144000 + 300 },
    { fps: 30, frames: 90, rate: 48000, delay: 2112, total: 144000 - 4000 },
    { fps: 25, frames: 50, rate: 22050, delay: 2112 },
  ]) {
    const { file } = film(c);
    const f = readFile(file);
    const [v, a] = f.tracks;
    const total = c.total ?? Math.round((c.frames / c.fps) * c.rate);
    const want = Math.ceil((total * 1000) / c.rate);
    ok(`${c.rate} Hz at ${c.fps} fps, priming ${c.delay}, ${total} samples: the edit list skips the priming and plays ${want} ms, the film the longer of the two`,
      f.errors.length === 0 && a.elst.mediaTime === c.delay && a.elst.segment === want && a.tkhd.duration === want
      && f.mvhd.duration === Math.max(v.tkhd.duration, want) && a.mp4a.rate === c.rate && a.esds.asc === hex(ascFor(c.rate, 2)), [a.elst, v.tkhd.duration, f.mvhd.duration]);
  }
  const short = readFile(film({ frames: 30, total: 48000, count: 10 }).file);
  ok('sound frames that hold less than the length given: the edit list plays only what they hold', short.tracks[1].elst.segment === Math.ceil(((10 * 1024 - 2112) * 1000) / 48000), short.tracks[1].elst);
  const nine60 = readFile(film({ frames: 30, asc: unhex('1194'), count: 52 }).file);
  ok('a 960-sample-frame config makes 960-tick samples', same(nine60.tracks[1].stts, [[52, 960]]) && nine60.tracks[1].mdhd.duration === 52 * 960);
}
{
  const w = () => { const x = new Mp4Writer({ width: 2, height: 2, fps: 30, avcC: AVCC }); x.add({ data: picture(0), timestamp: 0, duration: 33333, key: true }); return x; };
  const cfg = { asc: ascFor(48000, 2), sampleRate: 48000, channels: 2, delaySamples: 2112, totalSamples: 48000 };
  ok('a config that is not an AAC AudioSpecificConfig is refused with a TypeError',
    [{ ...cfg, asc: unhex('2b92') }, { ...cfg, asc: new Uint8Array(0) }, { ...cfg, asc: '1190' }, { ...cfg, asc: null }].every((c) => throws(() => w().addAudioTrack(c)) instanceof TypeError));
  ok('a rate the entry cannot hold, or another than the config\'s, or channels not the config\'s, or sample counts not whole and at least 0: RangeError',
    [{ ...cfg, sampleRate: 96000, asc: ascFor(96000, 2) }, { ...cfg, sampleRate: 44100 }, { ...cfg, channels: 1 }, { ...cfg, delaySamples: -1 }, { ...cfg, totalSamples: 1.5 }, { ...cfg, delaySamples: NaN }]
      .every((c) => throws(() => w().addAudioTrack(c)) instanceof RangeError));
  const x = w();
  const e1 = throws(() => x.addAudioTrack({ ...cfg, asc: unhex('2b92') }));
  x.addAudioTrack(cfg);
  ok('a refused config changes nothing: the next one is taken', e1 instanceof TypeError);
  ok('a second sound track is refused', /already has a sound track/.test(throws(() => x.addAudioTrack(cfg))?.message));
  ok('an empty sound sample is refused', throws(() => x.addAudioSample({ data: new Uint8Array(0) })) instanceof TypeError && throws(() => x.addAudioSample({})) instanceof TypeError);
  ok('a sound track with no samples is not finished into a file', /no samples/.test(throws(() => x.finish())?.message));
  ok('a sound sample with no sound track is refused', /no sound track/.test(throws(() => w().addAudioSample({ data: sound(0) }))?.message));
  const done = w();
  done.finish();
  ok('a finished writer takes no sound', /finished/.test(throws(() => done.addAudioTrack(cfg))?.message) && /finished/.test(throws(() => done.addAudioSample({ data: sound(0) }))?.message));
  const asc = ascFor(48000, 2);
  const kept = w();
  kept.addAudioTrack({ ...cfg, asc });
  asc[0] = 0;
  kept.addAudioSample({ data: sound(1) });
  ok('the config is copied: changing the caller\'s buffer afterwards changes nothing', readFile(kept.finish()).tracks[1].esds.asc === '1190');
  let bad = 0, other = 0;
  for (let k = 0; k < 300; k++) {
    const m = { asc: ascFor([48000, 44100, 22050][k % 3], 1 + (k % 2)), sampleRate: [48000, 44100, 22050, 8000, 65535][Math.floor(rand() * 5)], channels: 1 + Math.floor(rand() * 2),
      delaySamples: Math.floor(rand() * 5000) - 100, totalSamples: Math.floor(rand() * 200000) };
    const x2 = w();
    try { x2.addAudioTrack(m); } catch (e) { if (!(e instanceof RangeError || e instanceof TypeError)) other++; continue; }
    for (let j = 0; j < 1 + Math.floor(rand() * 200); j++) x2.addAudioSample({ data: sound(j) });
    try { const f = readFile(x2.finish()); if (f.errors.length || f.tracks[1].elst.mediaTime !== m.delaySamples) bad++; } catch { other++; }
  }
  ok('300 random sound configs: refused with a Type- or RangeError, or written whole with their priming', bad === 0 && other === 0, { bad, other });
}

// ── against ffmpeg's own AAC, when it is installed ────────────────────────
const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0;
const encoders = has('ffmpeg') ? spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '' : '';
if (has('ffprobe') && /libx264/.test(encoders) && /\baac\b/.test(encoders)) {
  console.log('against ffmpeg');
  const dir = join(fileURLToPath(new URL('../.test-build/', import.meta.url)), `pro-mux-audio-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: o.raw ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024 });
  try {
    const wav = join(dir, 'clicks.wav'), aac = join(dir, 'clicks.aac'), ref = join(dir, 'pic.mp4'), raw = join(dir, 'pic.h264'), out = join(dir, 'out.mp4');
    // Three seconds of silence with three 2 ms clicks, and three seconds of pictures.
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'aevalsrc=\'0.8*sin(2*PI*3000*t)*(between(t,0.5,0.502)+between(t,1.25,1.252)+between(t,2.5,2.502))\':s=48000:d=3', '-ac', '2', wav]);
    run('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-c:a', 'aac', '-b:a', '128k', '-f', 'adts', aac]);
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-bf', '0', ref]);
    run('ffmpeg', ['-v', 'error', '-y', '-i', ref, '-c', 'copy', '-bsf:v', 'h264_mp4toannexb', '-f', 'h264', raw]);
    const stream = new Uint8Array(readFileSync(aac));
    const frames = [];
    for (let at = 0; at + 7 <= stream.length;) {
      const len = ((stream[at + 3] & 3) << 11) | (stream[at + 4] << 3) | (stream[at + 5] >> 5);
      const a = adtsFrame(stream.subarray(at, at + len));
      if (!a) break;
      frames.push(a.payload);
      at += len;
    }
    const pics = annexBToAvcc(new Uint8Array(readFileSync(raw)));
    ok('ffmpeg\'s AAC split into its ADTS frames, its H.264 into 90 pictures', frames.length >= 141 && pics?.samples.length === 90, [frames.length, pics?.samples.length]);
    // ffmpeg's AAC encoder primes with 1024 samples; the edit list must skip exactly those.
    const w = new Mp4Writer({ width: 320, height: 180, fps: 30, avcC: pics.avcC });
    pics.samples.forEach((data, i) => w.add({ data, timestamp: Math.round((i * 1e6) / 30), duration: 33333, key: i === 0 }));
    w.addAudioTrack({ asc: ascFor(48000, 2), sampleRate: 48000, channels: 2, delaySamples: 1024, totalSamples: 144000 });
    for (const data of frames) w.addAudioSample({ data });
    writeFileSync(out, w.finish());
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,sample_rate,channels,start_time,duration:format=duration', '-of', 'json', out]).stdout || '{}');
    const [vs, as] = probe.streams || [];
    ok('ffprobe: h264 then AAC LC, 48000 Hz stereo, both starting at 0 and 3.000 s long',
      vs?.codec_name === 'h264' && as?.codec_name === 'aac' && as.profile === 'LC' && as.sample_rate === '48000' && as.channels === 2
      && Number(vs.start_time) === 0 && Number(as.start_time) === 0 && Math.abs(Number(vs.duration) - 3) < 0.001 && Math.abs(Number(as.duration) - 3) < 0.001
      && Math.abs(Number(probe.format?.duration) - 3) < 0.001, probe);
    const decode = run('ffmpeg', ['-v', 'error', '-i', out, '-f', 'null', '-']);
    ok('ffmpeg decodes both streams with nothing on stderr', decode.status === 0 && decode.stderr === '', decode.stderr.slice(0, 300));
    const mine = run('ffmpeg', ['-v', 'error', '-i', out, '-map', '0:a', '-f', 'f32le', '-'], { raw: true }).stdout;
    const theirs = run('ffmpeg', ['-v', 'error', '-i', aac, '-f', 'f32le', '-'], { raw: true }).stdout;
    // Two channels of four bytes: the raw stream less its 1024 samples of priming, cut at 3 s.
    const want = theirs.subarray(1024 * 8, (1024 + 144000) * 8);
    ok('the sound as a player plays it is exactly the stream\'s decoded samples less the priming, 144,000 of them',
      mine.length === 144000 * 8 && want.length === mine.length && mine.equals(want), [mine.length, want.length]);
    const pcm = new Float32Array(mine.buffer, mine.byteOffset, mine.length / 4);
    const onsets = [];
    for (let i = 0; i < pcm.length; i += 2) if (Math.abs(pcm[i]) > 0.05) { onsets.push(i / 2); i += 2 * 2400; }
    ok('so each click is heard where it was put: at 0.5, 1.25 and 2.5 s, within 4 samples', onsets.length === 3 && [24000, 60000, 120000].every((s, k) => Math.abs(onsets[k] - s) <= 4), onsets);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── a fake WebCodecs ──────────────────────────────────────────────────────
// Video as motionencode.test.mjs fakes it; audio lossless: the "AAC" frame is
// the 1024 samples themselves, after `priming` samples of silence, so the
// fake decoder gives back exactly what went in, that much later.
const SPS = unhex('6764000dacd941419f9f0110000003001000000303c0f14299600');
const PPS = unhex('68ebe3cb22c0');
const esdsOf = (asc) => Uint8Array.from([0x03, 0x80, 0x80, 0x80, 32 + asc.length, 0, 0, 0, 0x04, 0x80, 0x80, 0x80, 18 + asc.length, 0x40, 0x14, 0, 0x18, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x05, 0x80, 0x80, 0x80, asc.length, ...asc, 0x06, 0x80, 0x80, 0x80, 1, 2]);
let world;
function install(sc = {}) {
  world = { sc, videoEncoders: [], frames: [], audioEncoders: [], audioProbes: [], audioData: [], decoders: [] };
  globalThis.VideoFrame = class {
    constructor(source, init) { Object.assign(this, { source, timestamp: init.timestamp, duration: init.duration, visibleRect: init.visibleRect, closed: false }); world.frames.push(this); }
    close() { this.closed = true; }
  };
  globalThis.VideoEncoder = class extends EventTarget {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor({ output, error }) { super(); Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: 0, count: 0, closeCalls: 0, ondequeue: null }); world.videoEncoders.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, o) {
      if (this.state !== 'configured') throw new DOMException('closed', 'InvalidStateError');
      const i = this.count++;
      const key = i === 0 || !!o?.keyFrame;
      const nal = [key ? 0x65 : 0x41, 0x88, i & 0xff, i >> 8, 0x80];
      const data = sc.annexB
        ? Uint8Array.from([...(key ? [0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS] : []), 0, 0, 0, 1, ...nal])
        : Uint8Array.from([0, 0, 0, nal.length, ...nal]);
      const decoderConfig = { codec: this.config.codec };
      if (!sc.annexB) decoderConfig.description = AVCC.buffer.slice(0);
      this.output({ type: key ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration, byteLength: data.length, copyTo: (d) => d.set(data) }, i === 0 ? { decoderConfig } : {});
    }
    async flush() { if (this.state !== 'configured') throw new DOMException('closed', 'AbortError'); }
    close() { this.state = 'closed'; this.closeCalls++; }
  };
  if (sc.noAudio) { delete globalThis.AudioEncoder; delete globalThis.AudioData; delete globalThis.AudioDecoder; delete globalThis.EncodedAudioChunk; return world; }
  globalThis.AudioData = class {
    constructor(init) {
      Object.assign(this, { format: init.format, sampleRate: init.sampleRate, numberOfFrames: init.numberOfFrames, numberOfChannels: init.numberOfChannels, timestamp: init.timestamp, closed: false });
      this.data = new Float32Array(init.data);
      world.audioData.push(this);
    }
    close() { this.closed = true; }
  };
  globalThis.AudioEncoder = class {
    static async isConfigSupported(config) {
      world.audioProbes.push(config);
      if (sc.refuseAacField && config.aac) throw new TypeError('aac is not a member');
      return { supported: sc.audioSupports ? sc.audioSupports(config) : true, config };
    }
    constructor({ output, error }) { Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: 0, closeCalls: 0, made: 0, fed: 0 }); world.audioEncoders.push(this); }
    configure(config) {
      this.config = config;
      this.state = 'configured';
      this.priming = sc.priming ?? 2112;
      this.pending = Array.from({ length: config.numberOfChannels }, () => [new Float32Array(this.priming)]);
      this.held = this.priming;
    }
    encode(data) {
      if (this.state !== 'configured') throw new DOMException('closed', 'InvalidStateError');
      if (data.closed) throw new TypeError('closed data');
      const n = data.numberOfFrames;
      for (let c = 0; c < this.config.numberOfChannels; c++) this.pending[c].push(data.data.slice(c * n, (c + 1) * n));
      this.held += n;
      this.fed += n;
      if (sc.audioErrorAfter !== undefined && this.fed > sc.audioErrorAfter) { this.state = 'closed'; this.error(new DOMException('Audio encoder failure', 'EncodingError')); return; }
      this.emit(false);
    }
    emit(final) {
      while (this.held >= 1024 || (final && this.held > 0)) {
        const planes = this.pending.map((parts) => {
          const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
          let at = 0;
          for (const p of parts) { all.set(p, at); at += p.length; }
          const frame = new Float32Array(1024);
          frame.set(all.subarray(0, 1024));
          parts.length = 0;
          if (all.length > 1024) parts.push(all.slice(1024));
          return frame;
        });
        this.held = Math.max(0, this.held - 1024);
        const pcm = new Float32Array(1024 * planes.length);
        planes.forEach((p, c) => pcm.set(p, c * 1024));
        let data = new Uint8Array(pcm.buffer);
        const rate = this.config.sampleRate;
        if (sc.adts) data = adts([...data].slice(0, 2000), [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050].indexOf(rate), this.config.numberOfChannels);
        const j = this.made++;
        const timestamp = Math.round(((j * 1024 - (sc.reportPriming ? this.priming : 0)) * 1e6) / rate);
        const asc = ascFor(rate, this.config.numberOfChannels);
        const description = sc.description === 'esds' ? esdsOf(asc) : sc.description === 'broken' ? unhex('0190') : sc.description === 'none' || sc.adts ? undefined : asc;
        const meta = j === 0 ? { decoderConfig: { codec: this.config.codec, sampleRate: rate, numberOfChannels: this.config.numberOfChannels, ...(description ? { description: description.buffer.slice(0) } : {}) } } : undefined;
        this.output({ type: 'key', timestamp, duration: Math.round((1024 * 1e6) / rate), byteLength: data.length, copyTo: (d) => d.set(data) }, meta);
      }
    }
    async flush() {
      if (this.state !== 'configured') throw new DOMException('closed', 'AbortError');
      this.emit(true);
      if (sc.extraFrame) { this.held = 1; this.emit(true); }
    }
    close() { if (this.state === 'closed') throw new DOMException('Cannot call close on a closed codec', 'InvalidStateError'); this.state = 'closed'; this.closeCalls++; }
  };
  if (sc.noDecoder) { delete globalThis.AudioDecoder; delete globalThis.EncodedAudioChunk; return world; }
  globalThis.EncodedAudioChunk = class { constructor(init) { Object.assign(this, init); this.data = new Uint8Array(init.data); } };
  globalThis.AudioDecoder = class {
    constructor({ output, error }) { Object.assign(this, { output, error, state: 'unconfigured', closeCalls: 0 }); world.decoders.push(this); }
    configure(config) {
      if (!readAsc(new Uint8Array(config.description))) throw new TypeError('not an AudioSpecificConfig');
      if (sc.decoderFails) throw new DOMException('Unsupported', 'NotSupportedError');
      this.config = config;
      this.state = 'configured';
    }
    decode(chunk) {
      const pcm = new Float32Array(chunk.data.buffer.slice(chunk.data.byteOffset, chunk.data.byteOffset + chunk.data.byteLength));
      const plane = pcm.subarray(0, 1024);
      this.output({ numberOfFrames: 1024, copyTo: (dst, o) => dst.set(o?.planeIndex ? pcm.subarray(1024, 2048) : plane), close() {} });
    }
    async flush() {}
    close() { this.state = 'closed'; this.closeCalls++; }
  };
  return world;
}
const tone = (seconds, rate = 48000, channels = 2) => ({
  channels: Array.from({ length: channels }, (_, c) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * (440 + 110 * c) * i) / rate))),
  sampleRate: rate,
});
const decoded = (frames, c = 0) => { const out = new Float32Array(frames.length * 1024); frames.forEach((f, j) => out.set(new Float32Array(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength)).subarray(c * 1024, c * 1024 + 1024), j * 1024)); return out; };

console.log('encodeAac, with a fake encoder');
{
  install({ priming: 1600 });
  ok('canEncodeAac asks the encoder for 48 kHz stereo AAC-LC at 128 kbit/s', (await canEncodeAac()) === true
    && same(world.audioProbes[0], { codec: AAC_CODEC, sampleRate: AAC_RATE, numberOfChannels: 2, bitrate: AAC_BITRATE }) && AAC_CODEC === 'mp4a.40.2');
  const bed = tone(1);
  const progress = [];
  const t = await encodeAac(bed, { onProgress: (d, n) => progress.push([d, n]) });
  ok('a second at 48 kHz: AAC-LC 11 90, 48000 samples, 49 frames (priming and padding included)',
    hex(t.asc) === '1190' && t.sampleRate === 48000 && t.channels === 2 && t.totalSamples === 48000 && t.frames.length === Math.ceil((1600 + 48000) / 1024));
  ok('the priming is measured, not assumed: 1600, the fake encoder\'s, from a burst decoded back', t.delaySamples === 1600 && world.decoders.length === 1);
  const back = decoded(t.frames);
  ok('the frames are the bed, after the priming (sample for sample, both channels)',
    [0, 1, 777, 47999].every((i) => Math.abs(back[1600 + i] - bed.channels[0][i]) < 1e-6) && Math.abs(decoded(t.frames, 1)[1600 + 123] - bed.channels[1][123]) < 1e-6);
  ok('the encoder was asked for raw AAC frames, and closed; every AudioData closed',
    world.audioEncoders.every((e) => e.config.aac?.format === 'aac' && e.state === 'closed') && world.audioData.every((d) => d.closed) && world.decoders.every((d) => d.state === 'closed'));
  ok('progress in samples, rising, ending at 48000 of 48000', progress.length >= 5 && same(progress[progress.length - 1], [48000, 48000]) && progress.every(([d], i) => i === 0 || d > progress[i - 1][0]));
  const again = await encodeAac(bed);
  ok('measured once: a second bed with the same settings asks no decoder', again.delaySamples === 1600 && world.decoders.length === 1);
}
{
  install({ priming: 1600, reportPriming: true });
  const t = await encodeAac(tone(0.5));
  ok('an encoder that stamps its priming before 0 is believed, and nothing is measured', t.delaySamples === 1600 && t.frames[0].timestamp < 0 && world.decoders.length === 0);
}
{
  install({ priming: 2112, noDecoder: true });
  const t = await encodeAac(tone(0.5));
  ok('no AudioDecoder to measure with: 1024 is assumed', t.delaySamples === DEFAULT_DELAY && DEFAULT_DELAY === 1024);
  install({ priming: 2112, decoderFails: true });
  const t2 = await encodeAac(tone(0.5));
  ok('a decoder that refuses the stream: 1024, and the next export asks again (a failure is not kept)', t2.delaySamples === 1024
    && (await encodeAac(tone(0.5))).delaySamples === 1024 && world.decoders.length === 2);
}
{
  install({ description: 'esds', priming: 2112 });
  const t = await encodeAac(tone(0.25));
  ok('WebKit\'s ES_Descriptor description: the config inside it, and the priming still measured', hex(t.asc) === '1190' && t.delaySamples === 2112);
  install({ adts: true, priming: 2112 });
  const a = await encodeAac(tone(0.25));
  ok('ADTS frames: the config from their headers, the frames stripped of them', hex(a.asc) === '1190' && a.frames.every((f) => f.data[0] !== 0xff || f.data[1] < 0xf0) && a.frames[0].data.length === 2000);
  install({ description: 'broken', priming: 2112 });
  ok('a description with object type 0: the config built from the settings', hex((await encodeAac(tone(0.25))).asc) === '1190');
  install({ description: 'none', priming: 2112 });
  ok('no description and raw frames: the config built from the settings', hex((await encodeAac(tone(0.25))).asc) === '1190');
}
{
  install({ audioSupports: (c) => c.sampleRate === 48000 || c.sampleRate === 44100 });
  const t = await encodeAac(tone(0.5, 22050));
  ok('a 22.05 kHz bed where only 48 and 44.1 are taken: resampled to 48 kHz, 24000 samples',
    t.sampleRate === 48000 && t.totalSamples === 24000 && world.audioProbes.some((p) => p.sampleRate === 22050) && hex(t.asc) === '1190');
  install();
  const own = await encodeAac(tone(0.5, 44100));
  ok('a 44.1 kHz bed where it is taken: kept at 44.1 kHz (12 10), not resampled', own.sampleRate === 44100 && own.totalSamples === 22050 && hex(own.asc) === '1210');
  install({ refuseAacField: true });
  const plain = await encodeAac(tone(0.25));
  ok('an engine that throws on the aac field is configured without it', plain.sampleRate === 48000 && world.audioEncoders.every((e) => e.config.aac === undefined));
  install({ extraFrame: true, priming: 2112 });
  const extra = await encodeAac(tone(0.25));
  ok('an encoder that flushes a frame more than needed (Chrome does): the length is still the bed\'s', extra.totalSamples === 12000 && extra.frames.length === Math.ceil((2112 + 12000) / 1024) + 1);
  ok('a bitrate is held between 32 and 320 kbit/s', (await encodeAac(tone(0.1), { bitrate: 1e9 })) && world.audioEncoders.some((e) => e.config.bitrate === 320000)
    && (await encodeAac(tone(0.1), { bitrate: 5 })) && world.audioEncoders.some((e) => e.config.bitrate === 32000));
}
{
  install({ audioSupports: () => false });
  ok('no rate taken at all: motion:no-aac', (await settle(encodeAac(tone(0.25)))).error?.message === 'motion:no-aac');
  install({ noAudio: true });
  ok('no AudioEncoder: canEncodeAac is false, encodeAac motion:no-aac', (await canEncodeAac()) === false && (await settle(encodeAac(tone(0.25)))).error?.message === 'motion:no-aac');
  install();
  ok('a bed with nothing in it: motion:no-sound', (await settle(encodeAac({ channels: [], sampleRate: 48000 }))).error?.message === 'motion:no-sound');
  install({ audioErrorAfter: 10000 });
  const r = await settle(encodeAac(tone(1)));
  ok('the encoder failing: motion:aac-failed and the engine\'s words, the encoder not closed twice', r.error?.message === 'motion:aac-failed: Audio encoder failure'
    && world.audioEncoders[0].state === 'closed', r.error?.message);
  install();
  const ctl = new AbortController();
  const r2 = await settle(encodeAac(tone(2), { signal: ctl.signal, onProgress: (d) => { if (d >= 9600) ctl.abort(); } }));
  ok('Cancel while encoding: an AbortError, and the encoder closed', r2.error?.name === 'AbortError' && world.audioEncoders.every((e) => e.state === 'closed') && world.audioData.every((d) => d.closed));
  const pre = new AbortController();
  pre.abort();
  install();
  ok('already cancelled: nothing is opened', (await settle(encodeAac(tone(1), { signal: pre.signal }))).error?.name === 'AbortError' && world.audioEncoders.length === 0 && world.audioProbes.length === 0);
}

console.log('encodeMp4 with sound, with fakes');
const canvas = (width = 640, height = 360) => ({ width, height });
function readMp4(bytes) { return readFile(bytes); }
{
  install({ priming: 2112 });
  const drawn = [];
  const sounds = [];
  const bytes = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 90, draw: (i) => drawn.push(i), audio: tone(3.2), onSound: (d, n) => sounds.push([d, n]) });
  const f = readMp4(bytes);
  ok('sound given and encoded: audio kept, two tracks, every frame painted', bytes.audio === 'kept' && bytes.painted === 90 && bytes.frames === 90 && f.tracks.length === 2 && drawn.length === 90);
  ok('the bed fitted to the film: 3.2 s of tone cut to 3 s (144,000 samples), the edit list skipping the measured 2112',
    f.tracks[1].elst.mediaTime === 2112 && f.tracks[1].elst.segment === 3000 && f.tracks[0].tkhd.duration === 3000 && f.mvhd.duration === 3000, f.tracks[1].elst);
  ok('the sound encoded before the first frame, its progress ending at 144000 of 144000', sounds.length > 0 && same(sounds[sounds.length - 1], [144000, 144000]));
  ok('the report is on the bytes but not in them: not enumerable, read-only', !Object.keys(bytes).includes('audio') && throws(() => { 'use strict'; bytes.audio = 'none'; }) instanceof TypeError
    && bytes.audio === 'kept' && JSON.stringify(Object.keys({ ...bytes }).filter((k) => !/^\d+$/.test(k))) === '[]');
  ok('everything opened is closed: the video encoder, every frame, the audio encoder, every AudioData',
    world.videoEncoders.every((e) => e.state === 'closed') && world.frames.every((x) => x.closed) && world.audioEncoders.every((e) => e.state === 'closed') && world.audioData.every((d) => d.closed));
  install({ priming: 2112 });
  const short = readMp4(await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 90, draw: () => {}, audio: { channels: [new Float32Array(1000).fill(0.2)], sampleRate: 48000 } }));
  ok('a mono bed shorter than the film: stereo, made up with silence to 3 s', short.tracks[1].mp4a.channels === 2 && short.tracks[1].elst.segment === 3000);
  install({ priming: 2112, annexB: true });
  const ab = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, audio: tone(1) });
  ok('an Annex-B picture stream with sound: both tracks still written', ab.audio === 'kept' && readMp4(ab).tracks.length === 2);
}
{
  install({ noAudio: true });
  const bytes = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, audio: tone(1) });
  ok('no AAC encoder in this window: the film is made, without sound, and says so (dropped)', bytes.audio === 'dropped' && readMp4(bytes).tracks.length === 1);
  install({ audioErrorAfter: 5000 });
  const failed = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, audio: tone(1) });
  ok('the AAC encoder failing: the film is made without sound (dropped)', failed.audio === 'dropped' && readMp4(failed).tracks.length === 1 && world.audioEncoders.every((e) => e.state === 'closed'));
  install();
  const unusable = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, audio: { channels: [], sampleRate: 0 } });
  ok('a bed with nothing usable in it: dropped, the film made', unusable.audio === 'dropped' && world.audioEncoders.length === 0);
  install();
  const silent = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {} });
  const silent2 = await encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, audio: undefined, unchanged: () => false });
  ok('no sound given: none, one track, and the same bytes as without the new options', silent.audio === 'none' && silent.painted === 30 && readMp4(silent).tracks.length === 1
    && silent.length === silent2.length && silent.every((x, i) => x === silent2[i]) && world.audioProbes.length === 0);
}
{
  install({ priming: 2112 });
  const ctl = new AbortController();
  const r = await settle(encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 90, draw: () => {}, audio: tone(3), signal: ctl.signal, onSound: (d) => { if (d >= 4800) ctl.abort(); } }));
  ok('Cancel during the sound is Cancel: an AbortError, no picture encoder opened, the sound\'s closed',
    r.error?.name === 'AbortError' && r.error.message === 'Aborted' && world.videoEncoders.length === 0 && world.audioEncoders.every((e) => e.state === 'closed'), r.error?.message);
}
{
  install();
  const drawn = [];
  const asked = [];
  const still = new Set([5, 6, 7, 20, 21, 29]);
  const bytes = await encodeMp4({
    canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: (i) => drawn.push(i), unchanged: (i) => { asked.push(i); return still.has(i); },
  });
  const f = readMp4(bytes);
  ok('a frame that is the one before it again is not drawn', same(drawn, Array.from({ length: 30 }, (_, i) => i).filter((i) => !still.has(i))) && bytes.painted === 24);
  ok('but every frame is encoded, from the canvas, at its own time, and the file has all 30', world.frames.length === 30
    && world.frames.every((x, i) => x.timestamp === Math.round((i * 1e6) / 30) && x.source.width === 640) && f.tracks[0].sizes.length === 30 && same(f.tracks[0].stts, [[30, 3000]]));
  ok('the first frame is always drawn, and never asked about', drawn[0] === 0 && !asked.includes(0) && same(asked, Array.from({ length: 29 }, (_, i) => i + 1)));
  install();
  const boom = new Error('the plan broke');
  const r = await settle(encodeMp4({ canvas: canvas(), width: 640, height: 360, fps: 30, frames: 30, draw: () => {}, unchanged: (i) => { if (i === 9) throw boom; return false; } }));
  ok('unchanged throwing rejects with its error and closes everything', r.error === boom && world.videoEncoders.every((e) => e.state === 'closed') && world.frames.every((x) => x.closed));
}
{
  const b = new Uint8Array([1, 2, 3]);
  const r = withReport(b, { audio: 'kept', painted: 2, frames: 3 });
  const r2 = withReport(r, { audio: 'dropped', painted: 1, frames: 3 });
  ok('withReport: the same array, reported, and reported again', r === b && r2 === b && b.audio === 'dropped' && b.painted === 1 && same([...b], [1, 2, 3]) && Object.keys(b).length === 3);
}
for (const k of ['VideoFrame', 'VideoEncoder', 'AudioEncoder', 'AudioData', 'AudioDecoder', 'EncodedAudioChunk']) delete globalThis[k];

// ── frames that cannot have changed ───────────────────────────────────────
console.log('frames that cannot have changed');
const QUERIES = new Set(['measureText', 'getTransform', 'getLineDash', 'isPointInPath', 'isPointInStroke', 'getImageData', 'createImageData']);
const replacer = (_, v) => (v && typeof v === 'object' && typeof v.getContext === 'function' ? '[canvas]' : typeof v === 'function' ? undefined : v);
/** What a frame draws, as a string: every call but the questions, with its numbers, transform and alpha. */
function picture2(doc, t, w = 192, h = 108) {
  const c = makeCanvas(w, h);
  paint(c.ctx, doc, t, { clear: true });
  return JSON.stringify(c.calls.filter((x) => !QUERIES.has(x.name)).map((x) => [x.name, x.args, x.m, x.alpha, x.set ? 1 : 0]), replacer);
}
/** What frame i draws, with motion blur: its sub-frames, as paint spreads them. */
function blurred(doc, i, fps, samples, shutter, w, h) {
  const t = i / fps;
  return Array.from({ length: samples }, (_, s) => picture2(doc, t + ((s + 0.5) / samples - 0.5) * shutter / doc.fps, w, h)).join('|');
}
/** For each frame, whether it draws anything other than the frame before it. */
function differs(doc, o = {}) {
  const fps = doc.fps, frames = Math.max(1, Math.round(doc.seconds * fps));
  const at = (i) => (o.blur ? blurred(doc, i, fps, o.blur.samples, o.blur.shutter, o.w, o.h) : picture2(doc, i / fps, o.w, o.h));
  // Every text laid out once first (at the moment its layer starts), as in an
  // export after its first frames: a layout's measuring is not a picture.
  for (const l of doc.layers) if (l && l.start >= 0 && l.start < doc.seconds) picture2(doc, l.start, o.w, o.h);
  const out = [1];
  let before = at(0);
  for (let i = 1; i < frames; i++) { const now = at(i); out.push(now === before ? 0 : 1); before = now; }
  return out;
}
const film2 = (doc) => (doc.backdrop === null ? { ...doc, backdrop: 'bg' } : doc);
/** The skipped frames that draw differently from the frame before them: none, or the plan is wrong. Draws only what it must. */
function wronglySkipped(doc, plan, o = {}) {
  const fps = doc.fps;
  const memo = new Map();
  const at = (i) => {
    if (!memo.has(i)) memo.set(i, o.blur ? blurred(doc, i, fps, o.blur.samples, o.blur.shutter, o.w, o.h) : picture2(doc, i / fps, o.w, o.h));
    return memo.get(i);
  };
  if (plan.some((x) => x === 0)) for (const l of doc.layers) if (l && l.start >= 0 && l.start < doc.seconds) picture2(doc, l.start, o.w, o.h);
  const wrong = [];
  plan.forEach((p, i) => { if (i > 0 && p === 0 && at(i) !== at(i - 1)) wrong.push(i); });
  return wrong;
}
{
  let wrong = [], skipped = 0, needless = 0, total = 0, checked = 0;
  const perRecipe = {};
  const runs = [['en', 'landscape'], ['ar', 'portrait'], ['ckb', 'square'], ['kmr', 'feed']];
  for (const [r, recipe] of RECIPE_IDS.entries()) {
    for (const [lang, format] of [runs[0], ...(r % 3 === 0 ? [runs[1 + ((r / 3) % 3)]] : [])]) {
      const doc = film2(buildMotion({ id: 'x', recipe, lang, format, now: 0 }));
      const frames = Math.round(doc.seconds * doc.fps);
      const plan = changingFrames(doc, { fps: doc.fps, frames });
      total += frames;
      const s = plan.filter((x) => x === 0).length;
      perRecipe[recipe] = (perRecipe[recipe] ?? 0) + s;
      // A plan that paints every frame cannot skip one wrongly (a template with a moving backdrop, say).
      if (!s) continue;
      skipped += s;
      checked += frames;
      const real = differs(doc);
      real.forEach((d, i) => { if (d && !plan[i]) wrong.push(`${recipe}/${lang}/${format}@${i}`); if (!d && plan[i]) needless++; });
    }
  }
  ok(`every template, painted whole at every frame: no frame that draws differently is ever skipped (${checked} frames compared)`, wrong.length === 0 && checked > 600, wrong.slice(0, 10));
  ok(`and frames are skipped where nothing moves: ${skipped} of ${total}, in ${Object.values(perRecipe).filter((n) => n > 0).length} templates`,
    skipped > 150 && perRecipe['lower-third'] > 40 && perRecipe.steps > 60 && perRecipe.handle > 40, perRecipe);
  ok(`painting a frame that turned out the same is rare: ${needless} of the ${checked} frames of those templates`, needless <= checked * 0.04, needless);
}
{
  // Motion blur: a frame is its sub-frames; one that is skipped must have the same ones as the frame before.
  let wrong = [], skipped = 0;
  const blur = { samples: 8, shutter: 0.5 };
  for (const recipe of ['lower-third', 'steps', 'handle']) {
    const doc = film2(buildMotion({ id: 'x', recipe, lang: recipe === 'steps' ? 'ar' : 'en', format: 'landscape', now: 0 }));
    const frames = Math.round(doc.seconds * doc.fps);
    const plan = changingFrames(doc, { fps: doc.fps, frames, blur });
    for (const i of wronglySkipped(doc, plan, { blur, w: 64, h: 36 })) wrong.push(`${recipe}@${i}`);
    skipped += plan.filter((x) => x === 0).length;
    const noBlur = changingFrames(doc, { fps: doc.fps, frames }).filter((x) => x === 0).length;
    if (!(plan.filter((x) => x === 0).length <= noBlur)) wrong.push(`${recipe}: blur skipped more than no blur`);
  }
  ok(`with motion blur, no frame whose sub-frames differ is skipped, and blur never skips more (${skipped} skipped)`, wrong.length === 0 && skipped > 100, wrong.slice(0, 10));
}
{
  // A document whose every time falls between frames: exactly the frames that differ are painted.
  const base = { id: 'x', title: 't', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 4,
    palette: { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' }, backdrop: 'bg', stage: 'ready', created: 0, updated: 0 };
  const L = (o) => ({ id: o.id, name: o.id, start: 0, end: 4, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1, ...o });
  const layers = [
    L({ id: 'title', kind: 'text', start: 0.21, end: 3.71, text: 'Three words here', voice: 'sans', size: 8, weight: 700, color: 'fg', align: 'center', lead: 1.1, track: 0, caps: false, max: 0, fit: false,
      in: { fx: 'rise', d: 0.43, delay: 0.05, ease: 'expo-out', amount: 1, by: 'word', gap: 0.07 }, out: { fx: 'fade', d: 0.27, delay: 0.02, ease: 'linear', amount: 1 } }),
    L({ id: 'bar', kind: 'shape', shape: 'rect', start: 1.27, end: 2.93, w: 30, h: 2, radius: 1, sides: 5, inner: 0.5, from: 0, sweep: 360, fill: 'accent', seed: 1, y: 12,
      in: { fx: 'grow', d: 0.31, delay: 0, ease: 'linear', amount: 1 }, loop: { fx: 'pulse', d: 1, amount: 0 } }),
    L({ id: 'n', kind: 'counter', start: 0.11, end: 3.91, from: 0, to: 250, decimals: 0, prefix: '', suffix: '%', group: true, voice: 'mono', size: 6, weight: 600, color: 'fg', align: 'center', track: 0,
      count: { d: 0.63, delay: 2.13, ease: 'cubic-out' }, y: -20 }),
  ];
  const doc = { ...base, layers };
  const plan = [...changingFrames(doc, { fps: 30, frames: 120 })];
  const real = differs(doc);
  ok('a hand-made document whose times fall between frames: the frames painted are exactly the frames that differ', same(plan, real),
    plan.map((p, i) => (p === real[i] ? '' : `${i}:${p}/${real[i]}`)).filter(Boolean));
  ok('and that is half the film skipped: the holds between its moves', plan.filter((x) => x === 0).length >= 55, plan.filter((x) => x === 0).length);
  const looped = { ...doc, layers: [...layers.slice(0, 1), { ...layers[1], loop: { fx: 'pulse', d: 1, amount: 0.5 } }, layers[2]] };
  const lp = changingFrames(looped, { fps: 30, frames: 120 });
  ok('a loop that does something is moving for as long as its layer is there (frames 39 to 88)', lp.slice(39, 89).every((x) => x === 1) && same([...lp], differs(looped)));
  const shimmer = { ...doc, layers: [{ ...layers[1], loop: { fx: 'shimmer', d: 1, amount: 0 } }] };
  ok('a shimmer moves even at amount 0', changingFrames(shimmer, { fps: 30, frames: 120 }).slice(40, 88).every((x) => x === 1));
  const back = { ...doc, layers: [L({ id: 'bd', kind: 'backdrop', style: 'aurora', colors: ['#112233', '#445566'], speed: 1, density: 0.5, seed: 3, start: 1.5, end: 2.5 })] };
  const bp = changingFrames(back, { fps: 30, frames: 120 });
  ok('a moving backdrop: every frame it is on (and the one after it goes), none outside', bp.slice(46, 76).every((x) => x === 1) && bp.slice(1, 45).every((x) => x === 0) && bp.slice(77).every((x) => x === 0)
    && same([...bp], differs(back)), [...bp].join(''));
  const chart = L({ id: 'c', kind: 'chart', chart: 'bars', start: 0.52, end: 3.48, w: 40, h: 20, data: [{ label: 'a', value: 3 }, { label: 'b', value: 5 }], colors: ['#4C8DFF'], max: 0, unit: '',
    labels: true, values: true, voice: 'sans', size: 3, color: 'fg', thick: 2, gap: 0.09, in: { fx: 'grow', d: 0.5, delay: 0.03, ease: 'cubic-out', amount: 1 } });
  const bars = changingFrames({ ...doc, layers: [chart] }, { fps: 30, frames: 120 });
  ok('a bar chart grows its two bars, one after the other, then holds: exactly the frames that differ', same([...bars], differs({ ...doc, layers: [chart] }))
    && bars.slice(40, 104).every((x) => x === 0), [...bars].join(''));
  const race = changingFrames({ ...doc, layers: [{ ...chart, chart: 'race' }] }, { fps: 30, frames: 120 });
  const novel = changingFrames({ ...doc, layers: [{ ...layers[1], kind: 'hologram' }] }, { fps: 30, frames: 120 });
  ok('a chart, or a kind of layer, not known to stand still is painted at every frame it shows (a race re-orders its bars)',
    race.slice(16, 105).every((x) => x === 1) && novel.slice(39, 89).every((x) => x === 1));
  ok('a document with scenes is painted whole', changingFrames({ ...doc, scenes: [{ id: 's', name: 's', start: 0, end: 4 }] }, { fps: 30, frames: 120 }).every((x) => x === 1));
  ok('no frames, no plan; a frame rate that is not one: every frame painted',
    changingFrames(doc, { fps: 30, frames: 0 }).length === 0 && changingFrames(doc, { fps: 0, frames: 10 }).every((x) => x === 1) && changingFrames(doc, { fps: NaN, frames: 3 }).length === 3);
  ok('an empty document is one frame painted and the rest repeated', same([...changingFrames({ ...base, layers: [] }, { fps: 30, frames: 5 })], [1, 0, 0, 0, 0]));
  ok('hidden layers and layers whose times are not numbers change nothing',
    same([...changingFrames({ ...base, layers: [{ ...layers[0], hidden: true }, { ...layers[1], start: NaN }, { ...layers[2], end: 'x' }] }, { fps: 30, frames: 6 })], [1, 0, 0, 0, 0, 0]));
}
{
  const t = (o) => ({ id: 't', kind: 'text', start: 0, end: 4, ...o });
  ok('pieces: all is 1, words are words, lines are lines unless they wrap, letters are code points; Arabic letters are words',
    unitsBound(t({ text: 'a b c' })) === 1 && unitsBound(t({ text: 'one two  three\nfour', in: { by: 'word' } })) === 4
    && unitsBound(t({ text: 'one two\n\nthree', in: { by: 'line' } })) === 2 && unitsBound(t({ text: 'one two\nthree', max: 20, in: { by: 'line' } })) === 3
    && unitsBound(t({ text: 'one two\nthree', max: 20, fit: true, out: { by: 'line' } })) === 2
    && unitsBound(t({ text: 'ab 👩‍👩‍👧', in: { by: 'char' } })) === 2 + Array.from('👩‍👩‍👧').length && unitsBound(t({ text: 'سڵاو لە هەمووان', in: { by: 'char' } })) === 3
    && unitsBound(t({ text: '', in: { by: 'word' } })) === 1 && unitsBound(t({ text: 'x', in: { by: 'nonsense' } })) === 1);
  ok('a chart: its data, at most twelve; anything else one', unitsBound({ kind: 'chart', data: new Array(20).fill({}) }) === 12 && unitsBound({ kind: 'chart', data: [] }) === 1 && unitsBound({ kind: 'shape' }) === 1);
}
{
  // Timings scrambled: delays, durations, gaps, splits and loops a person or a model could set. Never a frame that differs skipped.
  const wrong = [];
  let docs = 0, frames = 0, skippedFuzz = 0;
  const recipes = RECIPE_IDS.filter((r) => ['lower-third', 'steps', 'handle', 'subscribe', 'big-number', 'stats', 'split-title', 'callout'].includes(r));
  for (let k = 0; k < 40; k++) {
    const recipe = recipes[k % recipes.length];
    const doc = film2(buildMotion({ id: 'x', recipe, lang: ['en', 'ar'][k % 2], format: 'landscape', now: 0 }));
    const r3 = (x) => Math.round(x * 1000) / 1000;
    const layers = doc.layers.filter((l) => l.kind !== 'backdrop' && l.kind !== 'particles').map((l) => {
      const m = { ...l, start: r3(rand() * 2), end: r3(2 + rand() * 2.5) };
      if (rand() < 0.8) m.in = { fx: ['fade', 'rise', 'pop', 'type', 'wipe', 'grow', 'mask'][Math.floor(rand() * 7)], d: r3(rand() * 0.8), delay: r3(rand() * 0.4), ease: ['linear', 'expo-out', 'spring', 'back-out'][Math.floor(rand() * 4)], amount: 1, by: ['all', 'word', 'char', 'line'][Math.floor(rand() * 4)], gap: r3(rand() * 0.1) };
      if (rand() < 0.6) m.out = { fx: ['fade', 'rise', 'slide'][Math.floor(rand() * 3)], d: r3(rand() * 0.5), delay: r3(rand() * 0.2), ease: 'linear', amount: 1, gap: r3(rand() * 0.1) };
      m.loop = rand() < 0.15 ? { fx: ['float', 'spin', 'pulse'][Math.floor(rand() * 3)], d: 1.3, amount: rand() < 0.5 ? 0 : 0.7 } : undefined;
      return m;
    });
    const fuzzed = { ...doc, seconds: 4.5, layers };
    const n = Math.round(4.5 * 30);
    const blur = k % 5 === 4 ? { samples: 8, shutter: 0.5 } : undefined;
    const plan = changingFrames(fuzzed, { fps: 30, frames: n, blur });
    skippedFuzz += plan.filter((x) => x === 0).length;
    for (const i of wronglySkipped(fuzzed, plan, { w: 96, h: 54, blur })) wrong.push(`${k}/${recipe}@${i}`);
    docs++;
    frames += n;
  }
  ok(`${docs} documents with scrambled timings, some blurred: none of the ${skippedFuzz} frames skipped (of ${frames}) differs from the one before`,
    wrong.length === 0 && skippedFuzz > 1000, wrong.slice(0, 10));
}

// ── rendering a film with sound ───────────────────────────────────────────
console.log('rendering a film with sound');
const MP4 = Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
function fakes(o = {}) {
  const log = { order: [], beds: [], encode: null, paints: [] };
  const deps = {
    preload: async () => { log.order.push('preload'); },
    paint: (ctx, doc, t) => { log.paints.push(t); },
    canvas: (w, h) => ({ width: w, height: h, getContext: () => ({ fake: true }) }),
    soundBed: async (doc, opts) => {
      log.order.push('sound');
      log.beds.push({ doc, opts });
      if (o.bedError) throw o.bedError;
      return o.bed === undefined ? tone(1) : o.bed;
    },
    encodeMp4: async (e) => {
      log.order.push('encode');
      log.encode = e;
      for (let i = 0; i < e.frames; i++) if (i === 0 || !e.unchanged?.(i)) await e.draw(i);
      const out = MP4.slice();
      return o.report ? withReport(out, o.report) : out;
    },
  };
  return { log, deps };
}
const lower = buildMotion({ id: 'x', recipe: 'lower-third', lang: 'en', format: 'landscape', now: 0 });
{
  const { log, deps } = fakes({ report: { audio: 'kept', painted: 99, frames: 150 } });
  const sounds = [];
  const bytes = await renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true, onSound: (d, n) => sounds.push([d, n]) }, deps);
  ok('with sound: the bed is rendered once, after the fonts, at 48 kHz, with the signal, before any frame', same(log.order, ['preload', 'sound', 'encode'])
    && log.beds.length === 1 && log.beds[0].doc === lower && log.beds[0].opts.sampleRate === 48000 && 'signal' in log.beds[0].opts);
  ok('the sound stage is announced (0 of 1) before it starts', same(sounds[0], [0, 1]));
  ok('the bed goes to the encoder as its audio; onSound goes with it', log.encode.audio?.sampleRate === 48000 && log.encode.audio.channels.length === 2 && typeof log.encode.onSound === 'function');
  ok('the encoder\'s report comes back on the bytes', bytes.audio === 'kept' && bytes.painted === 99 && bytes.frames === 150);
  const plan = changingFrames(lower, { fps: 30, frames: 150 });
  ok('the encoder is told which frames are the frame before them again: changingFrames, for the film as painted',
    Array.from({ length: 149 }, (_, i) => i + 1).every((i) => log.encode.unchanged(i) === (plan[i] === 0)) && log.paints.length === plan.filter((x) => x === 1).length);
}
{
  const { log, deps } = fakes();
  const bytes = await renderMp4(lower, { size: '720p', quality: 'high', blur: false }, deps);
  ok('without sound (the default): no bed is rendered, no audio given, and the film says none', !log.order.includes('sound') && log.encode.audio === undefined && bytes.audio === 'none' && bytes === bytes);
  ok('a plain encoder\'s bytes are returned as they are, with the frames it was asked for', bytes.frames === 150 && bytes.painted === 150 && same([...bytes], [...MP4]));
  const off = fakes();
  await renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: false }, off.deps);
  ok('sound: false is the same', !off.log.order.includes('sound'));
  const none = fakes({ bed: null });
  const silent = await renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true }, none.deps);
  ok('a graphic with no sound to render: none', silent.audio === 'none' && none.log.encode.audio === undefined);
  const broken = fakes({ bedError: new Error('the synth broke') });
  const film = await renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true }, broken.deps);
  ok('a bed that fails to render: the film is still made, without sound, and says dropped', film.audio === 'dropped' && broken.log.order.includes('encode') && broken.log.encode.audio === undefined);
  const plain = fakes();
  const given = await renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true }, plain.deps);
  ok('an encoder that says nothing about a bed it was given: dropped, not kept', given.audio === 'dropped');
  const ctl = new AbortController();
  const cancel = fakes({ bedError: new DOMException('Aborted', 'AbortError') });
  const r = await settle(renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true, signal: ctl.signal }, cancel.deps));
  ok('Cancel while the sound renders is Cancel: nothing is encoded', r.error?.name === 'AbortError' && !cancel.log.order.includes('encode'));
  const late = fakes();
  late.deps.soundBed = async () => { ctl2.abort(); return tone(1); };
  const ctl2 = new AbortController();
  const r2 = await settle(renderMp4(lower, { size: '720p', quality: 'high', blur: false, sound: true, signal: ctl2.signal }, late.deps));
  ok('nor when Cancel comes as the bed finishes', r2.error?.name === 'AbortError' && !late.log.order.includes('encode'));
  const blurred3 = fakes();
  await renderMp4(lower, { size: '720p', quality: 'high', blur: true }, blurred3.deps);
  const planBlur = changingFrames(lower, { fps: 30, frames: 150, blur: { samples: 8, shutter: 0.5 } });
  ok('with motion blur, the plan is the blurred one', Array.from({ length: 149 }, (_, i) => i + 1).every((i) => blurred3.log.encode.unchanged(i) === (planBlur[i] === 0)));
}

// ── what the new code may not do ──────────────────────────────────────────
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const code = strip(readFileSync(new URL('../src/motionaudioenc.ts', import.meta.url), 'utf8'));
  ok('motionaudioenc.ts makes no media element and touches no DOM: PCM in, AAC out',
    !/createElement|HTMLMediaElement|HTMLAudioElement|\bAudio\(|AudioContext|document\.|window\.|\bfetch\s*\(/.test(code));
  ok('and imports only the MP4 writer\'s config readers and the bed\'s type', same([...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]), ['./motionmp4', './motionsound']));
  const ops = strip(readFileSync(new URL('../src/motionexportops.ts', import.meta.url), 'utf8'));
  ok('motionexportops.ts reads no filter and makes no media element', !/\.filter\s*=|ctx\.filter|<\s*audio|new\s+Audio\b/.test(ops));
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
