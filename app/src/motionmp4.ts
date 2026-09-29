/**
 * The MP4 file a Motion export is saved as, written here byte by byte: one
 * H.264 video track in an ISO base media file (ISO/IEC 14496-12, with the AVC
 * sample entry of 14496-15). No muxing library: the Motion studio's promise is
 * that every step from the document to the file is this repository's own code
 * (docs/MOTION.md).
 *
 * ## The file
 *
 * `ftyp`, then the index (`moov`), then the pictures (`mdat`). The index goes
 * first ("fast start") so a web player, Quick Look or a phone's gallery can
 * show the first frame without reading to the end of the file. The price is
 * that nothing is written until `finish`, when every sample's size is known;
 * the samples wait in memory until then, which for a graphic of at most thirty
 * seconds is tens of megabytes.
 *
 * ## Time
 *
 * WebCodecs gives each sample its presentation time and duration in
 * microseconds, in decode order. The track counts in 1/90000 s, which 24, 25,
 * 30 and 60 fps (and 29.97's 3003 ticks) divide exactly, so no frame drifts.
 * WebCodecs gives no decode times, so they are made here: the presentation
 * times in rising order, which for a steady frame rate is the running sum of
 * the durations, strictly increasing as every demuxer requires. When an
 * encoder reorders pictures (B-frames), a
 * picture can be shown before its decode time would allow; then `ctts` holds
 * each sample's composition offset, all shifted up by the same amount so none
 * is negative (version 0: what ffmpeg writes and every player reads), and an
 * edit list (`elst`) starts the film at the first picture shown instead of at
 * that shift. A stream whose pictures come in order gets neither box.
 *
 * test/motionmp4.test.mjs checks every table against its own box parser and,
 * where ffmpeg is installed, decodes this writer's file and ffmpeg's own MP4
 * of the same stream and requires the same frames, hash for hash.
 */

// ── what goes in ──────────────────────────────────────────────────────────

/**
 * What the file needs before the first sample. `avcC` is the
 * AVCDecoderConfigurationRecord, exactly WebCodecs'
 * `decoderConfig.description`: it carries the SPS and PPS without which no
 * decoder can show a picture, and players read it from the sample entry, not
 * from the samples.
 */
export interface Mp4Config {
  width: number;
  height: number;
  /** Frames per second: how many samples share a chunk (about a second's worth), and the duration of a sample that has none. */
  fps: number;
  avcC: Uint8Array;
}

/**
 * One encoded picture as WebCodecs emits it: `data` is one access unit of
 * length-prefixed NAL units (the `avc` format), `timestamp` its presentation
 * time and `duration` its length, both in microseconds, and `key` whether a
 * decoder can start there.
 */
export interface Mp4Sample {
  data: Uint8Array;
  timestamp: number;
  duration: number;
  key: boolean;
}

/** Ticks per second on the track's clock: every frame rate Motion offers lands on whole ticks. */
const TIMESCALE = 90000;
/** The movie header's clock, in milliseconds: what players show a length in. */
const MOVIE_TIMESCALE = 1000;
/** 32-bit box sizes and chunk offsets (`stco`) cannot reach past this. */
const MAX_BYTES = 0xffffffff;
const TRACK_ID = 1;
/** `und`, packed as three 5-bit letters: the language of a track with no words. */
const LANGUAGE_UND = 0x55c4;
const IDENTITY = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];

// ── the writer ────────────────────────────────────────────────────────────

/**
 * An MP4 built from samples added in decode order. `finish` returns the whole
 * file; after it the writer holds nothing, so the samples' memory can go.
 *
 * `add` keeps each sample's bytes as they are, without copying, because a
 * copy would double what an export holds in memory: pass a buffer that will
 * not be reused. Both `add` and `finish` throw `Error('motion:too-large')`
 * when the file would pass 4 GiB, which 32-bit offsets cannot address; `add`
 * throws it as soon as the pictures alone are too big, so an export stops
 * early instead of after encoding the rest.
 *
 * Input that would make a file which begins like an MP4 (so Rust saves it)
 * but does not play is refused rather than written: an avcC without an SPS
 * and a PPS, a first sample that is not a key frame, a sample that is not
 * length-prefixed NAL units, two samples at the same time, and a time or
 * size that does not fit its 32-bit field.
 */
export class Mp4Writer {
  private readonly cfg: Mp4Config;
  /** Bytes in each NAL unit's length prefix, as the avcC says: what every sample must be made of. */
  private readonly nalLength: number;
  private samples: Mp4Sample[] = [];
  private size = 0;
  private finished = false;

  constructor(cfg: Mp4Config) {
    const { width, height, fps, avcC } = cfg;
    if (!isDimension(width) || !isDimension(height)) throw new RangeError(`Mp4Writer: bad size ${width}x${height}`);
    if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`Mp4Writer: bad frame rate ${fps}`);
    // An Annex-B stream, an empty description or a record without its SPS and
    // PPS here would make a file no player decodes, and that Rust would still
    // save, since it begins like an MP4.
    const nalLength = avcC instanceof Uint8Array ? nalLengthOf(avcC) : 0;
    if (!nalLength) throw new TypeError('Mp4Writer: avcC is not an AVCDecoderConfigurationRecord');
    this.nalLength = nalLength;
    this.cfg = { width, height, fps, avcC: avcC.slice() };
  }

  /** Adds the next sample in decode order. */
  add(s: Mp4Sample): void {
    if (this.finished) throw new Error('Mp4Writer: already finished');
    if (!(s.data instanceof Uint8Array) || s.data.byteLength === 0) throw new TypeError('Mp4Writer: a sample needs bytes');
    if (!Number.isFinite(s.timestamp)) throw new TypeError(`Mp4Writer: bad timestamp ${s.timestamp}`);
    // A decoder can start only at a key frame (AVFoundation decodes nothing
    // of a file that starts elsewhere), and a sample that is not whole
    // length-prefixed NAL units — Annex B, say — is one no player can read.
    if (!this.samples.length && !s.key) throw new TypeError('Mp4Writer: the first sample is not a key frame');
    if (!isLengthPrefixed(s.data, this.nalLength)) throw new TypeError('Mp4Writer: a sample is not length-prefixed NAL units');
    if (this.size + s.data.byteLength + 8 > MAX_BYTES) throw new Error('motion:too-large');
    this.samples.push({ data: s.data, timestamp: s.timestamp, duration: s.duration, key: !!s.key });
    this.size += s.data.byteLength;
  }

  /** The bytes of pictures added so far: the file's size, less a few kilobytes of index. */
  get bytes(): number {
    return this.size;
  }

  /** The finished file: `ftyp`, `moov`, `mdat`. */
  finish(): Uint8Array {
    if (this.finished) throw new Error('Mp4Writer: already finished');
    const samples = this.samples;
    if (!samples.length) throw new Error('Mp4Writer: no samples');
    const t = timing(samples, this.cfg.fps);

    // About a second of samples per chunk: few enough offsets to keep the
    // index small, and a player reading ahead reads in useful pieces.
    const per = Math.max(1, Math.round(this.cfg.fps));
    const chunks: number[] = [];
    const within: number[] = [];
    let at = 0;
    for (let i = 0; i < samples.length; i += per) {
      const count = Math.min(per, samples.length - i);
      chunks.push(count);
      within.push(at);
      for (let j = i; j < i + count; j++) at += samples[j].data.byteLength;
    }

    const head = ftyp();
    // The index's size does not depend on the offsets in it (each is 32
    // bits), so it is built once to measure where the pictures will start.
    const index = (start: number) => moov(this.cfg, t, samples, chunks, within.map((w) => start + w));
    const start = head.byteLength + index(0).byteLength + 8;
    const total = start + this.size;
    if (total > MAX_BYTES) throw new Error('motion:too-large');
    const m = index(start);

    const out = new Uint8Array(total);
    out.set(head, 0);
    out.set(m, head.byteLength);
    out.set(new Fields().u32(this.size + 8).text('mdat').done(), head.byteLength + m.byteLength);
    let p = start;
    for (const s of samples) {
      out.set(s.data, p);
      p += s.data.byteLength;
    }
    this.samples = [];
    this.finished = true;
    return out;
  }
}

function isDimension(n: number): boolean {
  return Number.isInteger(n) && n > 0 && n <= 0xffff;
}

/**
 * The size of the NAL length prefix an AVCDecoderConfigurationRecord
 * (14496-15, 5.3.3.1) gives its samples — 1, 2 or 4 bytes — when the record
 * is whole: version 1, at least one SPS and one PPS, each of them inside the
 * record and of its own NAL type. 0 for anything else.
 */
function nalLengthOf(avcC: Uint8Array): number {
  if (avcC.length < 7 || avcC[0] !== 1) return 0;
  const size = (avcC[4] & 3) + 1;
  if (size === 3) return 0;
  let at = 6;
  // `count` parameter sets of NAL type `type`, each after its 16-bit length.
  const sets = (count: number, type: number): boolean => {
    if (count < 1) return false;
    for (let i = 0; i < count; i++) {
      if (at + 2 > avcC.length) return false;
      const len = (avcC[at] << 8) | avcC[at + 1];
      if (len < 1 || at + 2 + len > avcC.length || (avcC[at + 2] & 0x1f) !== type) return false;
      at += 2 + len;
    }
    return true;
  };
  if (!sets(avcC[5] & 0x1f, SPS) || at >= avcC.length) return 0;
  const pps = avcC[at++];
  return sets(pps, PPS) ? size : 0;
}

/** Whether `data` is whole NAL units, each after a `size`-byte length, with nothing left over. */
function isLengthPrefixed(data: Uint8Array, size: number): boolean {
  let at = 0;
  while (at < data.length) {
    if (at + size > data.length) return false;
    let len = 0;
    for (let k = 0; k < size; k++) len = len * 256 + data[at + k];
    if (len < 1 || at + size + len > data.length) return false;
    at += size + len;
  }
  return true;
}

// ── time ──────────────────────────────────────────────────────────────────

/** Where every sample sits on the track's clock, in ticks, and how long the film is. */
interface Timing {
  /** Each sample's decode duration (`stts`). */
  deltas: number[];
  /** Each sample's composition offset (`ctts`); null when pictures are shown in decode order. */
  offsets: number[] | null;
  /** The composition time of the first picture shown: where the edit list starts the film. */
  start: number;
  /** From the first decode to the last sample's end: the media's own length (`mdhd`). */
  media: number;
  /** Milliseconds from the first picture shown to the end of the last: the film's length (`mvhd`, `tkhd`, `elst`). */
  movie: number;
}

const ticks = (us: number) => Math.round((us * TIMESCALE) / 1e6);

function timing(samples: readonly Mp4Sample[], fps: number): Timing {
  const n = samples.length;
  const pts = samples.map((s) => ticks(s.timestamp));
  let first = Infinity;
  for (const p of pts) first = Math.min(first, p);
  // A sample without a usable duration lasts one frame.
  const own = samples.map((s) => Math.max(1, ticks(Number.isFinite(s.duration) && s.duration > 0 ? s.duration : 1e6 / fps)));
  // Decode times are the presentation times in rising order. For frames at a
  // steady rate that is exactly the running sum of their durations; unlike
  // that sum it cannot drift when the durations are rounded (1e6 / 30 is not
  // a whole number of microseconds) or a frame is missing, so a stream whose
  // pictures come in order never needs `ctts`. Each is kept at least one tick
  // after the last: demuxers require them to rise.
  const sorted = pts.map((p) => p - first).sort((a, b) => a - b);
  // Two pictures at one moment: AVFoundation shows one and drops the other.
  for (let i = 1; i < n; i++) if (sorted[i] === sorted[i - 1]) throw new RangeError('Mp4Writer: two samples have the same timestamp');
  const dts: number[] = [];
  for (let i = 0; i < n; i++) dts.push(i === 0 ? 0 : Math.max(sorted[i], dts[i - 1] + 1));
  // A reordered picture is shown before its decode time on this clock; the
  // smallest shift that keeps every offset at zero or more is the decoder's
  // delay, and the edit list takes it away again.
  let shift = 0;
  for (let i = 0; i < n; i++) shift = Math.max(shift, dts[i] - (pts[i] - first));
  const offsets = pts.map((p, i) => p - first + shift - dts[i]);
  let end = 0;
  for (let i = 0; i < n; i++) end = Math.max(end, dts[i] + offsets[i] + own[i]);
  const deltas = dts.map((d, i) => (i + 1 < n ? dts[i + 1] - d : own[i]));
  return {
    deltas,
    offsets: offsets.some((o) => o !== 0) ? offsets : null,
    start: shift,
    media: dts[n - 1] + own[n - 1],
    // Rounded up, so the last frame is never cut short.
    movie: Math.ceil((end - shift) / (TIMESCALE / MOVIE_TIMESCALE)),
  };
}

// ── boxes ─────────────────────────────────────────────────────────────────

/** A box's fields, big-endian as ISO BMFF writes every number. Negative numbers go in as two's complement. */
class Fields {
  private b: number[] = [];
  u8(x: number): this {
    this.b.push(x & 0xff);
    return this;
  }
  u16(x: number): this {
    this.b.push((x >>> 8) & 0xff, x & 0xff);
    return this;
  }
  u32(x: number): this {
    // Past 32 bits a time or a size would wrap into another number and the
    // file would still look whole (a 14-hour gap became 38 minutes): refuse.
    if (!Number.isInteger(x) || x > 0xffffffff || x < -0x80000000) throw new RangeError(`Mp4Writer: ${x} does not fit in 32 bits`);
    this.b.push((x >>> 24) & 0xff, (x >>> 16) & 0xff, (x >>> 8) & 0xff, x & 0xff);
    return this;
  }
  u32s(xs: readonly number[]): this {
    for (const x of xs) this.u32(x);
    return this;
  }
  zeros(n: number): this {
    for (let i = 0; i < n; i++) this.b.push(0);
    return this;
  }
  text(s: string): this {
    for (let i = 0; i < s.length; i++) this.b.push(s.charCodeAt(i) & 0xff);
    return this;
  }
  bytes(a: Uint8Array): this {
    for (let i = 0; i < a.length; i++) this.b.push(a[i]);
    return this;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.b);
  }
}

function box(type: string, ...parts: (Uint8Array | null)[]): Uint8Array {
  let size = 8;
  for (const p of parts) if (p) size += p.byteLength;
  const out = new Uint8Array(size);
  out.set(new Fields().u32(size).text(type).done(), 0);
  let at = 8;
  for (const p of parts) {
    if (!p) continue;
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

function fullBox(type: string, version: number, flags: number, ...parts: (Uint8Array | null)[]): Uint8Array {
  return box(type, new Fields().u8(version).u8(flags >>> 16).u16(flags).done(), ...parts);
}

/** Consecutive equal values as [count, value] pairs: how `stts` and `ctts` are written. */
function runs(xs: readonly number[]): number[] {
  const out: number[] = [];
  for (const x of xs) {
    if (out.length && out[out.length - 1] === x) out[out.length - 2]++;
    else out.push(1, x);
  }
  return out;
}

function ftyp(): Uint8Array {
  return box('ftyp', new Fields().text('mp42').u32(0).text('isom').text('mp42').text('avc1').done());
}

function moov(
  cfg: Mp4Config, t: Timing, samples: readonly Mp4Sample[], chunks: readonly number[], offsets: readonly number[],
): Uint8Array {
  const { width, height } = cfg;
  // Creation and modification times are 0 (1904): the same frames always
  // make the same file, and nothing about when it was made leaks into it.
  const mvhd = fullBox('mvhd', 0, 0, new Fields()
    .u32(0).u32(0).u32(MOVIE_TIMESCALE).u32(t.movie)
    .u32(0x00010000).u16(0x0100).zeros(10)
    .u32s(IDENTITY).zeros(24).u32(TRACK_ID + 1).done());
  // Flags 3: the track is enabled and part of the presentation.
  const tkhd = fullBox('tkhd', 0, 3, new Fields()
    .u32(0).u32(0).u32(TRACK_ID).u32(0).u32(t.movie)
    .zeros(8).u16(0).u16(0).u16(0).u16(0)
    .u32s(IDENTITY).u32(width * 65536).u32(height * 65536).done());
  const edts = t.offsets
    ? box('edts', fullBox('elst', 0, 0, new Fields().u32(1).u32(t.movie).u32(t.start).u16(1).u16(0).done()))
    : null;
  const mdhd = fullBox('mdhd', 0, 0, new Fields()
    .u32(0).u32(0).u32(TIMESCALE).u32(t.media).u16(LANGUAGE_UND).u16(0).done());
  const hdlr = fullBox('hdlr', 0, 0, new Fields().u32(0).text('vide').zeros(12).text('VideoHandler').u8(0).done());
  const vmhd = fullBox('vmhd', 0, 1, new Fields().zeros(8).done());
  const dinf = box('dinf', fullBox('dref', 0, 0, new Fields().u32(1).done(), fullBox('url ', 0, 1)));

  const avc1 = box('avc1',
    new Fields()
      .zeros(6).u16(1) // reserved; data_reference_index
      .zeros(16) // pre_defined, reserved, pre_defined[3]
      .u16(width).u16(height)
      .u32(0x00480000).u32(0x00480000) // 72 dpi, as every file says
      .u32(0).u16(1) // reserved; one frame per sample
      .zeros(32) // compressorname: none
      .u16(0x0018).u16(0xffff) // depth: colour without alpha; pre_defined -1
      .done(),
    box('avcC', cfg.avcC),
    // BT.709 primaries and matrix in limited range: what both engines'
    // encoders were measured to produce (flat patches decode within 1.4
    // levels of BT.709's values and 28 from BT.601's). WebKit's stream says
    // nothing about colour itself, and its decoderConfig claims full range,
    // which it is not; without this box a player guesses, and a guess of
    // BT.601 shifts every colour.
    //
    // The transfer is sRGB's (13), not BT.709's (1): the pixels are the
    // canvas's, which are sRGB, and WebKit's decoderConfig says so too
    // (`iec61966-2-1`). It matters on a Mac: AVFoundation — QuickTime, Safari,
    // Quick Look, Photos — colour-manages by this tag, and with 1 it showed
    // every mid-tone lighter than the canvas draws it (grey 128 as 139,
    // #606060 as 106, #4C8DFF as #5897FF); with 13 every patch is within 2
    // levels of the canvas. Chrome shows the file the same either way, and a
    // player that ignores the transfer is unaffected.
    box('colr', new Fields().text('nclx').u16(1).u16(13).u16(1).u8(0).done()),
    box('pasp', new Fields().u32(1).u32(1).done()));
  const stsd = fullBox('stsd', 0, 0, new Fields().u32(1).done(), avc1);

  const timeRuns = runs(t.deltas);
  const stts = fullBox('stts', 0, 0, new Fields().u32(timeRuns.length / 2).u32s(timeRuns).done());
  let stss: Uint8Array | null = null;
  if (samples.some((s) => !s.key)) {
    const keys: number[] = [];
    samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    stss = fullBox('stss', 0, 0, new Fields().u32(keys.length).u32s(keys).done());
  }
  let ctts: Uint8Array | null = null;
  if (t.offsets) {
    const offsetRuns = runs(t.offsets);
    // Version 1 reads the offsets as signed. The shift in `timing` keeps them
    // all at zero or more, so this is version 0 unless that ever changes.
    const signed = t.offsets.some((o) => o < 0);
    ctts = fullBox('ctts', signed ? 1 : 0, 0, new Fields().u32(offsetRuns.length / 2).u32s(offsetRuns).done());
  }
  const chunkRows: number[] = [];
  chunks.forEach((count, i) => {
    if (i === 0 || count !== chunks[i - 1]) chunkRows.push(i + 1, count, 1);
  });
  const stsc = fullBox('stsc', 0, 0, new Fields().u32(chunkRows.length / 3).u32s(chunkRows).done());
  const stsz = fullBox('stsz', 0, 0, new Fields().u32(0).u32(samples.length).u32s(samples.map((s) => s.data.byteLength)).done());
  const stco = fullBox('stco', 0, 0, new Fields().u32(offsets.length).u32s(offsets).done());
  const stbl = box('stbl', stsd, stts, stss, ctts, stsc, stsz, stco);

  return box('moov', mvhd, box('trak', tkhd, edts, box('mdia', mdhd, hdlr, box('minf', vmhd, dinf, stbl))));
}

// ── Annex B ───────────────────────────────────────────────────────────────

// NAL unit types (H.264 Table 7-1) this file tells apart.
const SLICE = 1;
const PARTITION_A = 2;
const IDR = 5;
const SEI = 6;
const SPS = 7;
const PPS = 8;
const AUD = 9;
const FILLER = 12;
const SPS_EXTENSION = 13;

/**
 * An Annex-B H.264 stream (start codes between NAL units) as what an MP4
 * holds: the AVCDecoderConfigurationRecord built from the parameter sets that
 * come before the first picture, and one length-prefixed sample per access
 * unit. An engine that ignores WebCodecs' `avc` format emits this, and so does
 * an `ffmpeg -f h264` file.
 *
 * Access units are split where H.264 says one begins (7.4.1.2.3): at an
 * access unit delimiter, a parameter set or SEI, or a slice whose
 * first_mb_in_slice is 0, whichever comes first after a picture. Delimiters
 * and filler are dropped, and so are parameter sets identical to ones in the
 * record, which is where an `avc1` file keeps them; anything else is kept.
 * Null when the stream has no SPS or PPS before its first picture, or no
 * picture at all: nothing could decode it.
 */
export function annexBToAvcc(stream: Uint8Array): { avcC: Uint8Array; samples: Uint8Array[] } | null {
  const sps: Uint8Array[] = [];
  const pps: Uint8Array[] = [];
  const units: Uint8Array[][] = [];
  let unit: Uint8Array[] = [];
  let hasPicture = false;
  let seenPicture = false;
  for (const nal of nalUnits(stream)) {
    const type = nal[0] & 0x1f;
    const picture = type >= SLICE && type <= IDR;
    const firstSlice = (type === SLICE || type === PARTITION_A || type === IDR) && nal.length > 1 && (nal[1] & 0x80) !== 0;
    const opens = firstSlice || type === AUD || type === SEI || type === SPS || type === PPS || type === SPS_EXTENSION
      || (type >= 14 && type <= 18);
    if (opens && hasPicture) {
      units.push(unit);
      unit = [];
      hasPicture = false;
    }
    if (!seenPicture && type === SPS) addOnce(sps, nal);
    if (!seenPicture && type === PPS) addOnce(pps, nal);
    unit.push(nal);
    if (picture) hasPicture = seenPicture = true;
  }
  if (hasPicture) units.push(unit);
  if (!sps.length || !pps.length || !units.length || sps[0].length < 4) return null;

  const samples = units.map((nals) => {
    const kept = nals.filter((nal) => {
      const type = nal[0] & 0x1f;
      if (type === AUD || type === FILLER) return false;
      if (type === SPS) return !sps.some((p) => same(p, nal));
      if (type === PPS) return !pps.some((p) => same(p, nal));
      return true;
    });
    let size = 0;
    for (const nal of kept) size += 4 + nal.length;
    const out = new Uint8Array(size);
    const view = new DataView(out.buffer);
    let at = 0;
    for (const nal of kept) {
      view.setUint32(at, nal.length);
      out.set(nal, at + 4);
      at += 4 + nal.length;
    }
    return out;
  });
  return { avcC: avcCOf(sps.slice(0, 31), pps.slice(0, 255)), samples };
}

/** The NAL units between start codes, without the zero bytes that pad the end of one (or begin a four-byte start code). */
function nalUnits(stream: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const take = (from: number, to: number) => {
    while (to > from && stream[to - 1] === 0) to--;
    if (to > from) out.push(stream.subarray(from, to));
  };
  let from = -1;
  let i = 0;
  while (i + 2 < stream.length) {
    const c = stream[i + 2];
    // A start code is 00 00 01: a byte above 1 in third place rules out
    // three starting positions at once.
    if (c > 1) i += 3;
    else if (c === 0) i += 1;
    else if (stream[i] === 0 && stream[i + 1] === 0) {
      if (from >= 0) take(from, i);
      i += 3;
      from = i;
    } else i += 3;
  }
  if (from >= 0) take(from, stream.length);
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function addOnce(list: Uint8Array[], nal: Uint8Array): void {
  if (!list.some((x) => same(x, nal))) list.push(nal);
}

/** Profiles whose SPS carries chroma_format_idc and bit depths (7.3.2.1.1). */
const CHROMA_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

/**
 * The AVCDecoderConfigurationRecord (14496-15, 5.3.3.1) for parameter sets.
 * Profiles other than Baseline, Main and Extended get the record's chroma and
 * bit-depth fields as well, read from the SPS, as the standard and ffmpeg's
 * own writer do; a High-profile record without them is one some parsers refuse.
 */
function avcCOf(sps: Uint8Array[], pps: Uint8Array[]): Uint8Array {
  const first = sps[0];
  const profile = first[1];
  const f = new Fields().u8(1).u8(profile).u8(first[2]).u8(first[3])
    .u8(0xfc | 3) // 4-byte NAL lengths
    .u8(0xe0 | sps.length);
  for (const s of sps) f.u16(s.length).bytes(s);
  f.u8(pps.length);
  for (const p of pps) f.u16(p.length).bytes(p);
  if (profile !== 66 && profile !== 77 && profile !== 88) {
    const c = chromaOf(first);
    f.u8(0xfc | c.format).u8(0xf8 | c.lumaDepth).u8(0xf8 | c.chromaDepth).u8(0);
  }
  return f.done();
}

/** chroma_format_idc and the two bit depths (less 8) from an SPS; 4:2:0 at 8 bits when the profile does not say. */
function chromaOf(sps: Uint8Array): { format: number; lumaDepth: number; chromaDepth: number } {
  const r = bits(unescape(sps.subarray(1)));
  const profile = r.u(8);
  r.u(16); // constraint flags, level
  r.ue(); // seq_parameter_set_id
  if (!CHROMA_PROFILES.includes(profile)) return { format: 1, lumaDepth: 0, chromaDepth: 0 };
  const format = r.ue();
  if (format === 3) r.u(1); // separate_colour_plane_flag
  const lumaDepth = r.ue();
  const chromaDepth = r.ue();
  return { format: format & 3, lumaDepth: lumaDepth & 7, chromaDepth: chromaDepth & 7 };
}

/** A NAL unit's payload without emulation-prevention bytes (the 03 in 00 00 03): the bits the syntax describes. */
function unescape(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  let zeros = 0;
  for (let i = 0; i < b.length; i++) {
    if (zeros >= 2 && b[i] === 3) {
      zeros = 0;
      continue;
    }
    out.push(b[i]);
    zeros = b[i] === 0 ? zeros + 1 : 0;
  }
  return Uint8Array.from(out);
}

/** An MSB-first bit reader that reads zeros past the end rather than throwing: a short SPS gives defaults, not a crash. */
function bits(b: Uint8Array): { u(n: number): number; ue(): number } {
  let pos = 0;
  const bit = () => {
    const byte = pos >> 3;
    const v = byte < b.length ? (b[byte] >> (7 - (pos & 7))) & 1 : 0;
    pos++;
    return v;
  };
  const u = (n: number) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 2 + bit();
    return v;
  };
  return {
    u,
    ue: () => {
      let zeros = 0;
      while (bit() === 0) if (++zeros > 31) return 0;
      return 2 ** zeros - 1 + u(zeros);
    },
  };
}
