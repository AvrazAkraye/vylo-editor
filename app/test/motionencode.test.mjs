// Frames to an MP4 with WebCodecs, run against a fake VideoEncoder and
// VideoFrame installed on globalThis.
//
// What matters: the codec string names a level the frame really fits (an
// encoder refuses one too low, a decoder one too high); sizes are even;
// bitrate grows with size, rate and quality and stays inside its bounds; the
// loop draws, encodes and closes every frame in order, asks for a key frame
// every two seconds, waits when the encoder is full and lets the window
// breathe every few frames; samples with an avcC, samples in Annex B and
// samples out of order (B-frames) all become a correct file; and on every way
// out — the encoder failing, Cancel, `draw` throwing — the promise rejects
// with the right thing and the encoder and every frame are closed. A frame
// the caller says is unchanged is encoded without being drawn; sound that
// cannot be encoded leaves the film silent, never failed, and says so (the
// sound itself is tested in pro-mux-audio.test.mjs).
import {
  avcCodecFor, bitrateFor, canEncode, encodeMp4, evenSize,
} from '../.test-build/motionencode.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const level = (codec) => parseInt(codec.slice(-2), 16);
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));

// ── codec strings, sizes, bitrates ────────────────────────────────────────
{
  const hd = avcCodecFor(1280, 720, 30);
  ok('High, then Main, then Baseline', hd.length === 3 && hd[0].startsWith('avc1.6400') && hd[1].startsWith('avc1.4d00') && hd[2].startsWith('avc1.42e0'), hd);
  ok('720p30 fits level 3.1', hd.every((c) => level(c) <= 31) && hd[0] === 'avc1.64001f', hd);
  ok('1080p60 needs 4.2 or higher', level(avcCodecFor(1920, 1080, 60)[0]) >= 42, avcCodecFor(1920, 1080, 60));
  ok('4K30 is level 5.1', avcCodecFor(3840, 2160, 30)[0] === 'avc1.640033', avcCodecFor(3840, 2160, 30));
  ok('1080p30 and portrait 1080x1920 are level 4.0; 720p60 is 3.2',
    avcCodecFor(1920, 1080, 30)[0] === 'avc1.640028' && avcCodecFor(1080, 1920, 30)[0] === 'avc1.640028' && avcCodecFor(1280, 720, 60)[0] === 'avc1.640020');
  ok('a square 1080 at 60 fps is past 4.1\'s macroblock rate', level(avcCodecFor(1080, 1080, 60)[0]) === 42);
  const hi = avcCodecFor(1920, 1080, 30, 24e6);
  ok('a bitrate over Main\'s 4.0 ceiling (20 Mbit/s) raises Main to 4.1, while High\'s 25 Mbit/s still fits 4.0',
    hi[0] === 'avc1.640028' && hi[1] === 'avc1.4d0029', hi);
  ok('a frame past every level asks for 5.2 and lets the encoder decide', avcCodecFor(7680, 4320, 30)[0] === 'avc1.640034');
  ok('nonsense in, a codec string out', avcCodecFor(NaN, -5, 0).every((c) => /^avc1\.[0-9a-f]{6}$/.test(c)));

  ok('even sizes stay; odd ones round down', same(evenSize(1920, 1080), { width: 1920, height: 1080 }) && same(evenSize(1081, 675), { width: 1080, height: 674 }));
  ok('never below 2x2, even for nonsense', same(evenSize(1, 0), { width: 2, height: 2 }) && same(evenSize(NaN, Infinity), { width: 2, height: 2 }));

  const b = (w, h, f, q) => bitrateFor(w, h, f, q);
  ok('1080p30 high is 0.2 bits a pixel a frame', b(1920, 1080, 30, 'high') === Math.round(1920 * 1080 * 30 * 0.2));
  ok('more pixels, more frames or more quality never costs fewer bits',
    b(1280, 720, 30, 'high') <= b(1920, 1080, 30, 'high') && b(1920, 1080, 30, 'high') <= b(1920, 1080, 60, 'high')
    && b(1920, 1080, 30, 'medium') < b(1920, 1080, 30, 'high') && b(1920, 1080, 30, 'high') < b(1920, 1080, 30, 'very-high'));
  ok('at least 2 Mbit/s, at most 80', b(320, 180, 24, 'medium') === 2e6 && b(3840, 2160, 60, 'very-high') === 80e6);
  ok('an unknown quality is high; nonsense is the floor', b(1920, 1080, 30, 'ultra') === b(1920, 1080, 30, 'high') && b(NaN, 1080, 30, 'high') === 2e6);
}

// ── a fake WebCodecs ──────────────────────────────────────────────────────
// The engine's own clock: the fake encoder works on it even while the page's
// timers are throttled, as a real encoder does in a hidden window.
const engineLater = setTimeout;
const SPS = hex('6764000dacd941419f9f0110000003001000000303c0f14299600');
const PPS = hex('68ebe3cb22c0');
const AVCC = hex('0164000dffe1001a6764000dacd941419f9f0110000003001000000303c0f142996001000668ebe3cb22c0fdf8f800');
let world;
function install(scenario = {}) {
  world = { scenario, encoders: [], frames: [], probes: [] };
  globalThis.VideoFrame = class {
    constructor(source, init) {
      if (typeof init?.timestamp !== 'number') throw new TypeError('timestamp required');
      Object.assign(this, { source, timestamp: init.timestamp, duration: init.duration, visibleRect: init.visibleRect, closed: false });
      world.frames.push(this);
    }
    close() { this.closed = true; }
  };
  globalThis.VideoEncoder = class extends EventTarget {
    static async isConfigSupported(config) {
      world.probes.push(config);
      if (scenario.refuseAvcField && config.avc) throw new TypeError('The provided value is not of type AvcEncoderConfig');
      return { supported: scenario.supports ? scenario.supports(config) : true, config };
    }
    constructor({ output, error }) {
      super();
      Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: 0, maxQueue: 0, closeCalls: 0, keys: [], count: 0, held: [], listens: 0 });
      // Both real engines have the dequeue event; an older one would not.
      if (!scenario.noDequeueEvent) this.ondequeue = null;
      world.encoders.push(this);
    }
    addEventListener(type, fn, o) { if (type === 'dequeue') this.listens++; super.addEventListener(type, fn, o); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, options) {
      if (this.state !== 'configured') throw new DOMException('Cannot call encode on a closed codec', 'InvalidStateError');
      if (frame.closed) throw new TypeError('frame is closed');
      if (scenario.throwOnEncodeAt === this.count) throw new TypeError('bad frame');
      const i = this.count++;
      this.keys.push(!!options?.keyFrame);
      const job = { i, timestamp: frame.timestamp, duration: frame.duration, key: i === 0 || !!options?.keyFrame };
      if (scenario.sync) { this.process(job, false); return; }
      this.encodeQueueSize++;
      this.maxQueue = Math.max(this.maxQueue, this.encodeQueueSize);
      engineLater(() => this.process(job, true), scenario.delay ?? 0);
    }
    process(job, queued) {
      if (this.state !== 'configured') return;
      if (queued) {
        this.encodeQueueSize--;
        if (!scenario.noDequeueEvent && !scenario.silentDequeue) this.dispatchEvent(new Event('dequeue'));
      }
      if (scenario.errorAt === job.i) {
        this.state = 'closed'; // a codec that fails closes itself, then says why
        this.error(new DOMException('Encoder failure', 'EncodingError'));
        return;
      }
      // Two B-frames: I0 P3 B1 B2 P6 B4 B5 …, each chunk still stamped with its own presentation time.
      if (scenario.reorder && job.i % 3 !== 0) { this.held.push(job); return; }
      this.emit(job);
      for (const h of this.held.splice(0)) this.emit(h);
    }
    emit(job) {
      const annexB = scenario.annexB;
      // A slice NAL: header, first_mb_in_slice = 0, the frame's number, and the stop bit every NAL ends with.
      const slice = [job.key ? 0x65 : 0x41, 0x88, job.i & 0xff, job.i >> 8, 0x80];
      const data = annexB
        ? Uint8Array.from([...(job.key && !scenario.noParams ? [0, 0, 0, 1, ...SPS, 0, 0, 0, 1, ...PPS] : []), 0, 0, 0, 1, ...slice])
        : Uint8Array.from([0, 0, 0, slice.length, ...slice]);
      const chunk = {
        type: job.key ? 'key' : 'delta', timestamp: job.timestamp, duration: scenario.noDuration ? null : job.duration, byteLength: data.length,
        copyTo: (dst) => { if (scenario.copyThrowsAt === job.i) throw new Error('motion:too-large'); dst.set(data); },
      };
      const first = !this.emitted;
      this.emitted = true;
      const decoderConfig = { codec: this.config.codec, codedWidth: this.config.width, codedHeight: this.config.height };
      if (!annexB) decoderConfig.description = scenario.descriptionAsView ? new DataView(AVCC.buffer) : AVCC.buffer.slice(0);
      this.output(chunk, first ? { decoderConfig } : {});
    }
    async flush() {
      while (this.encodeQueueSize > 0 && this.state === 'configured') await new Promise((r) => engineLater(r, 1));
      if (this.state !== 'configured') throw new DOMException('Aborted due to close()', 'AbortError');
      for (const h of this.held.splice(0)) this.emit(h);
    }
    close() {
      if (this.state === 'closed') throw new DOMException('Cannot call close on a closed codec', 'InvalidStateError');
      this.state = 'closed';
      this.closeCalls++;
    }
  };
  return world;
}
function uninstall() { delete globalThis.VideoEncoder; delete globalThis.VideoFrame; }
const canvas = (width = 1280, height = 720) => ({ width, height });

// A small MP4 reader: enough to see what the writer made of the samples.
const u32 = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
function mp4(file) {
  const boxes = {};
  const walk = (from, to, path) => {
    for (let at = from; at + 8 <= to;) {
      const size = u32(file, at), type = String.fromCharCode(...file.subarray(at + 4, at + 8));
      const p = path ? `${path}/${type}` : type;
      boxes[p] = { at, size, body: at + 8 };
      if (['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl'].includes(type)) walk(at + 8, at + size, p);
      if (type === 'stsd') walk(at + 16, at + size, p);
      if (type === 'avc1') walk(at + 86, at + size, p);
      at += size || to;
    }
  };
  walk(0, file.length, '');
  const S = 'moov/trak/mdia/minf/stbl';
  const list = (p, width) => {
    const b = boxes[`${S}/${p}`];
    if (!b) return null;
    return Array.from({ length: u32(file, b.body + 4) }, (_, i) => (width === 1 ? u32(file, b.body + 8 + i * 4)
      : Array.from({ length: width }, (_, j) => u32(file, b.body + 8 + (i * width + j) * 4))));
  };
  const avcC = boxes[`${S}/stsd/avc1/avcC`];
  const stsz = boxes[`${S}/stsz`];
  const elst = boxes['moov/trak/edts/elst'];
  const f = {
    top: Object.keys(boxes).filter((k) => !k.includes('/')),
    avcC: avcC && file.slice(avcC.body, avcC.at + avcC.size),
    samples: u32(file, stsz.body + 8),
    stts: list('stts', 2), ctts: list('ctts', 2), stss: list('stss', 1), stco: list('stco', 1),
    mediaTime: elst ? u32(file, elst.body + 12) : 0,
    elst: !!elst,
  };
  const offs = [];
  if (f.ctts) for (const [n, o] of f.ctts) for (let k = 0; k < n; k++) offs.push(o);
  f.shown = [];
  let t = 0, i = 0;
  for (const [n, d] of f.stts) for (let k = 0; k < n; k++, i++) { f.shown.push(t + (offs[i] || 0) - f.mediaTime); t += d; }
  f.firstSample = file.slice(f.stco[0], f.stco[0] + u32(file, stsz.body + 12));
  return f;
}
const allClosed = (w) => w.frames.length > 0 && w.frames.every((f) => f.closed);
const encoderClosed = (w) => w.encoders.length === 1 && w.encoders[0].state === 'closed';

// ── choosing ──────────────────────────────────────────────────────────────
{
  uninstall();
  ok('no VideoEncoder: canEncode says null', (await canEncode(1920, 1080, 30)) === null);
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 3, draw: () => {} }));
  ok('no VideoEncoder: encodeMp4 rejects with motion:no-encoder', r.error?.message === 'motion:no-encoder', r.error?.message);

  let w = install();
  ok('hardware High first', same(await canEncode(1920, 1080, 30), { codec: 'avc1.640028', hardware: true }));
  const first = w.probes[0];
  ok('asked with the whole request: avc format, quality latency, variable bitrate, the even size and the bitrate of "high"',
    first.avc?.format === 'avc' && first.latencyMode === 'quality' && first.bitrateMode === 'variable' && first.hardwareAcceleration === 'prefer-hardware'
    && first.width === 1920 && first.height === 1080 && first.framerate === 30 && first.bitrate === bitrateFor(1920, 1080, 30, 'high'), first);
  w = install({ supports: (c) => c.codec.startsWith('avc1.42') });
  ok('a Baseline-only encoder gets Baseline', same(await canEncode(1280, 720, 30), { codec: 'avc1.42e01f', hardware: true }));
  w = install({ supports: (c) => c.hardwareAcceleration === 'no-preference' });
  ok('an encoder that is not hardware says so', same(await canEncode(1280, 720, 30), { codec: 'avc1.64001f', hardware: false }));
  w = install({ refuseAvcField: true });
  ok('an engine that throws on the avc field is asked again without it', same(await canEncode(1280, 720, 30), { codec: 'avc1.64001f', hardware: true }));
  await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 2, draw: () => {} });
  ok('and is configured without it', w.encoders[0].config.avc === undefined && w.encoders[0].config.latencyMode === 'quality');
  w = install({ supports: (c) => !c.latencyMode });
  ok('an engine that refuses the modes gets the plain request', (await canEncode(1280, 720, 30))?.codec === 'avc1.64001f' && w.probes.some((p) => !p.latencyMode));
  install({ supports: () => false });
  ok('nothing supported: null, and motion:no-encoder',
    (await canEncode(1280, 720, 30)) === null
    && (await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 3, draw: () => {} }))).error?.message === 'motion:no-encoder');
  w = install();
  await canEncode(1081, 675, 30, 'very-high');
  ok('canEncode asks at the even size and the quality given', w.probes[0].width === 1080 && w.probes[0].height === 674
    && w.probes[0].bitrate === bitrateFor(1080, 674, 30, 'very-high'));
}

// ── encoding ──────────────────────────────────────────────────────────────
{
  const w = install({ delay: 2 });
  const drawn = [], progress = [];
  const c = canvas();
  const file = await encodeMp4({
    canvas: c, width: 1280, height: 720, fps: 30, frames: 90, quality: 'medium',
    draw: (i) => { drawn.push(i); }, onProgress: (d, t) => progress.push([d, t]),
  });
  const f = mp4(file);
  const e = w.encoders[0];
  ok('an MP4: ftyp, moov, mdat, with 90 samples', same(f.top, ['ftyp', 'moov', 'mdat']) && f.samples === 90, f);
  ok('the avcC is the encoder\'s description, byte for byte', f.avcC && same([...f.avcC], [...AVCC]));
  ok('every frame drawn once, in order', same(drawn, Array.from({ length: 90 }, (_, i) => i)));
  ok('each frame made from the canvas, stamped i/30 s and one frame long',
    w.frames.length === 90 && w.frames.every((fr, i) => fr.source === c && fr.timestamp === Math.round((i * 1e6) / 30) && fr.duration === 33333 && !fr.visibleRect));
  ok('a key frame asked for every two seconds', same(e.keys.map((k, i) => (k ? i : -1)).filter((i) => i >= 0), [0, 60]));
  ok('and marked in the file (stss 1 and 61)', same(f.stss, [1, 61]));
  ok('in order: no ctts, no edit list; each frame shown at its time', f.ctts === null && !f.elst && same(f.shown, Array.from({ length: 90 }, (_, i) => i * 3000)));
  ok('configured as probed: medium bitrate, 30 fps, the avc format', e.config.bitrate === bitrateFor(1280, 720, 30, 'medium') && e.config.framerate === 30 && e.config.avc?.format === 'avc');
  ok('drawing waits while the encoder holds more than 6 frames', e.maxQueue <= 7 && e.maxQueue >= 6, e.maxQueue);
  ok('progress after every frame, ending at 90 of 90', progress.length === 90 && same(progress[89], [90, 90]) && progress.every(([d], i) => d === i + 1));
  ok('the encoder and every frame are closed', encoderClosed(w) && e.closeCalls === 1 && allClosed(w));
  ok('the bytes report no sound and every frame painted, without the report being in the bytes',
    file.audio === 'none' && file.painted === 90 && file.frames === 90 && Object.keys(file).length === file.length);
}
{
  // Frames the caller says are the frame before them again: not drawn, still encoded, each at its own time.
  const w = install({ delay: 1 });
  const drawn = [];
  const asked = [];
  const c = canvas();
  const file = await encodeMp4({
    canvas: c, width: 1280, height: 720, fps: 30, frames: 90, draw: (i) => { drawn.push(i); },
    unchanged: (i) => { asked.push(i); return i % 30 > 9; },
  });
  const f = mp4(file);
  ok('an unchanged frame is not drawn: 10 of every 30 are', drawn.length === 30 && drawn.every((i) => i % 30 <= 9) && file.painted === 30);
  ok('but every frame is made from the canvas and encoded at its own time: 90 samples, steady',
    w.frames.length === 90 && w.frames.every((fr, i) => fr.source === c && fr.timestamp === Math.round((i * 1e6) / 30)) && f.samples === 90 && same(f.stts, [[90, 3000]]));
  ok('key frames stay every two seconds', same(f.stss, [1, 61]));
  ok('the first frame is never asked about; every other once, in order', same(asked, Array.from({ length: 89 }, (_, i) => i + 1)));
  ok('closed as ever', encoderClosed(w) && allClosed(w));
}
{
  // This fake world has no AudioEncoder: a film with sound is still a film.
  const w = install();
  const bed = { channels: [new Float32Array(48000), new Float32Array(48000)], sampleRate: 48000 };
  const file = await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 30, draw: () => {}, audio: bed });
  ok('sound that this window cannot encode: the film is made without it, and says dropped', file.audio === 'dropped' && mp4(file).samples === 30 && encoderClosed(w));
}
{
  // The window must get a turn at least every eight frames, even when the
  // encoder never makes drawing wait: each turn is a message task (a timer
  // would be throttled), so count the channels and the frame each came after.
  install({ sync: true });
  const Channel = globalThis.MessageChannel;
  let now = -1;
  const turns = [];
  globalThis.MessageChannel = class extends Channel { constructor() { super(); turns.push(now); } };
  try {
    await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 64, draw: (i) => { now = i; } });
  } finally {
    globalThis.MessageChannel = Channel;
  }
  const gaps = turns.map((f, i) => f - (i ? turns[i - 1] : -1));
  ok('the event loop gets a turn, by message, at least every 8 frames', turns.length >= 8 && Math.max(...gaps) <= 8, turns);
}
{
  // Slow frames — 4K with motion blur is about 130 ms each in WebKit — must not hold the window for eight
  // of them (measured: 1,023 ms without a turn). Frames of 30 ms here: a turn at least every 50 ms, so
  // after every second frame, never eight.
  install({ sync: true });
  const Channel = globalThis.MessageChannel;
  let now = -1;
  const turns = [];
  globalThis.MessageChannel = class extends Channel { constructor() { super(); turns.push(now); } };
  const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* drawing */ } };
  try {
    await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 16, draw: (i) => { now = i; busy(30); } });
  } finally {
    globalThis.MessageChannel = Channel;
  }
  const gaps = turns.map((f, i) => f - (i ? turns[i - 1] : -1));
  ok('slow frames: a turn at least every 50 ms, not only every 8 frames', turns.length >= 7 && Math.max(...gaps) <= 2, turns);
}
{
  // A WKWebView that is hidden, minimized or covered stretches every timer to
  // a second (measured: an export there ran at 9 frames/s while it waited on
  // setTimeout(0)). The page's timers are throttled here the same way; the
  // encoder, like a real one, works on its own clock. No wait may be a timer.
  const w = install({ delay: 1 });
  const pageTimer = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...rest) => pageTimer(fn, Math.max(1000, ms || 0), ...rest);
  const t0 = Date.now();
  let r;
  try {
    r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: () => {} }));
  } finally {
    globalThis.setTimeout = pageTimer;
  }
  const took = Date.now() - t0;
  ok('with every page timer stretched to a second, 90 frames still take well under one such second', r.value && took < 900, took);
  ok('because a full encoder is waited on through its dequeue event', w.encoders[0].listens > 0 && w.encoders[0].maxQueue <= 7, [w.encoders[0].listens, w.encoders[0].maxQueue]);
}
{
  const w = install({ delay: 1, noDequeueEvent: true });
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: () => {} }));
  ok('an engine without the dequeue event is still held to 7 frames, and finishes', r.value && w.encoders[0].maxQueue <= 7 && w.encoders[0].listens === 0);
  const w2 = install({ delay: 1, silentDequeue: true });
  const r2 = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 20, draw: () => {} }));
  ok('a dequeue event that never comes: the safety net still finishes the export', r2.value && mp4(r2.value).samples === 20 && encoderClosed(w2));
}
{
  const w = install({ annexB: true });
  const file = await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 65, draw: () => {} });
  const f = mp4(file);
  ok('Annex B from the encoder (no description): 65 samples, and the avcC built from its SPS and PPS', f.samples === 65 && same([...f.avcC], [...AVCC]));
  ok('the samples are length-prefixed, without the parameter sets', same([...f.firstSample], [0, 0, 0, 5, 0x65, 0x88, 0, 0, 0x80]), [...f.firstSample]);
  ok('key frames still marked', same(f.stss, [1, 61]) && encoderClosed(w) && allClosed(w));
}
{
  const w = install({ reorder: true });
  const file = await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: () => {} });
  const f = mp4(file);
  ok('chunks out of order (B-frames): a ctts and an edit list', f.ctts !== null && f.elst);
  ok('and every frame is shown at its own time', same([...f.shown].sort((a, b) => a - b), Array.from({ length: 90 }, (_, i) => i * 3000)) && f.shown[1] === 3 * 3000, f.shown.slice(0, 6));
  ok('closed as ever', encoderClosed(w) && allClosed(w));
}
{
  install({ noDuration: true, descriptionAsView: true });
  const f = mp4(await encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 60, frames: 30, draw: () => {} }));
  ok('chunks without a duration, and a description given as a view: still a correct file', f.samples === 30 && same(f.stts, [[30, 1500]]) && same([...f.avcC], [...AVCC]));
}
{
  const w = install();
  await encodeMp4({ canvas: canvas(1081, 675), width: 1081, height: 675, fps: 30, frames: 3, draw: () => {} });
  ok('an odd size: the encoder gets it rounded down, each frame is cropped to it, not scaled',
    w.encoders[0].config.width === 1080 && w.encoders[0].config.height === 674 && w.frames.every((fr) => same(fr.visibleRect, { x: 0, y: 0, width: 1080, height: 674 })));
  const r = await settle(encodeMp4({ canvas: canvas(640, 360), width: 1280, height: 720, fps: 30, frames: 3, draw: () => {} }));
  ok('a canvas smaller than the frame is refused before anything opens', r.error instanceof RangeError && w.encoders.length === 1);
  const bad = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 0, frames: 3, draw: () => {} }));
  const none = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 0, draw: () => {} }));
  ok('no frame rate or no frames: refused', bad.error instanceof RangeError && none.error instanceof RangeError);
}

// ── every way out closes everything ───────────────────────────────────────
{
  const w = install({ errorAt: 20 });
  const drawn = [];
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: (i) => { drawn.push(i); } }));
  ok('the encoder failing rejects with motion:encode-failed and the engine\'s words', r.error?.message === 'motion:encode-failed: Encoder failure', r.error?.message);
  ok('the loop stops soon after, and the failed encoder is not closed twice', drawn.length < 40 && w.encoders[0].state === 'closed' && w.encoders[0].closeCalls === 0, drawn.length);
  ok('every frame closed', allClosed(w));
}
{
  const w = install({ delay: 1 });
  const ctl = new AbortController();
  const drawn = [];
  const r = await settle(encodeMp4({
    canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, signal: ctl.signal,
    draw: (i) => { drawn.push(i); }, onProgress: (d) => { if (d === 30) ctl.abort(); },
  }));
  ok('Cancel mid-way rejects with an AbortError DOMException, "Aborted"',
    r.error instanceof DOMException && r.error.name === 'AbortError' && r.error.message === 'Aborted', r.error && [r.error.name, r.error.message]);
  ok('nothing is drawn after it', drawn.length <= 31, drawn.length);
  ok('the encoder is closed once, and every frame', encoderClosed(w) && w.encoders[0].closeCalls === 1 && allClosed(w));
}
{
  const w = install();
  const ctl = new AbortController();
  let later = null;
  const pending = encodeMp4({
    canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, signal: ctl.signal,
    draw: (i) => (i === 10 ? new Promise((_, reject) => { later = reject; }) : undefined),
  });
  setTimeout(() => ctl.abort(), 20);
  const r = await settle(pending);
  later?.(new Error('the drawing gave up afterwards'));
  await new Promise((res) => setTimeout(res, 5));
  ok('Cancel while a frame is still being drawn does not wait for it', r.error?.name === 'AbortError' && encoderClosed(w) && allClosed(w), r.error?.message);
}
{
  const ctl = new AbortController();
  ctl.abort();
  const w = install();
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, signal: ctl.signal, draw: () => {} }));
  ok('already cancelled: AbortError before any encoder opens', r.error?.name === 'AbortError' && w.encoders.length === 0 && w.probes.length === 0);
}
{
  const w = install();
  const boom = new Error('the font did not load');
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: (i) => { if (i === 5) throw boom; } }));
  ok('draw throwing rejects with its own error', r.error === boom);
  ok('and closes the encoder and every frame', encoderClosed(w) && w.encoders[0].closeCalls === 1 && allClosed(w));
  const w2 = install();
  const r2 = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: async (i) => { if (i === 7) throw boom; } }));
  ok('so does an async draw rejecting', r2.error === boom && encoderClosed(w2) && allClosed(w2));
}
{
  // How the writer's motion:too-large reaches the caller: thrown inside the encoder's output callback.
  const w = install({ copyThrowsAt: 5 });
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: () => {} }));
  ok('a failure inside the output callback rejects the export with it', r.error?.message === 'motion:too-large' && encoderClosed(w) && w.encoders[0].closeCalls === 1 && allClosed(w), r.error?.message);
  const w2 = install({ annexB: true, noParams: true });
  const r2 = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 10, draw: () => {} }));
  ok('Annex B without parameter sets: motion:encode-failed, not a broken file', /^motion:encode-failed: /.test(r2.error?.message) && encoderClosed(w2), r2.error?.message);
}
{
  const w = install({ throwOnEncodeAt: 3 });
  const r = await settle(encodeMp4({ canvas: canvas(), width: 1280, height: 720, fps: 30, frames: 90, draw: () => {} }));
  ok('encode() throwing still closes the frame it was given, and the encoder', r.error instanceof TypeError && w.frames.length === 4 && allClosed(w) && encoderClosed(w));
}
uninstall();

// ── nothing but canvas and WebCodecs ──────────────────────────────────────
{
  const { readFileSync } = await import('node:fs');
  const code = readFileSync(new URL('../src/motionencode.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ok('motionencode.ts makes no media element and touches no DOM beyond its canvas',
    !/createElement|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|\bAudio\(|document\.|window\./.test(code));
  ok('and imports only this repository\'s own: the MP4 writer, the AAC encoder, the sound bed\'s type',
    same([...code.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]), ['./motionmp4', './motionmp4', './motionaudioenc', './motionaudioenc', './motionsound']));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
