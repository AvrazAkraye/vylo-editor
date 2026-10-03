// Adversarial review R2 (export, sound and sync): regression tests for what the real-engine review
// found (docs/pro/review-export.md). The measurements themselves were made in the app's WebKit with its
// real encoders and checked with ffmpeg and AVFoundation; these hold the fixes in place in Node.
//
//   - the film's sound is held under -1.5 dBTP as a player decodes it: AAC's overshoot (up to 1.9 dB in
//     WebKit) is measured on the decoded track and the bed turned down and encoded again (motionencode.ts);
//   - decodeAac plays a track as the edit list does: priming skipped, padding left off, every channel;
//   - a bed cut short to the film's whole frames ends on a fade, not on whatever sample the cut hit;
//   - a film without sound is byte for byte what the 0.132.0 writer made (golden hashes taken from it);
//   - the preview's sound: restarted when it runs 45 ms ahead (not 120), left alone for one call when the
//     picture is merely late after a slow frame, followed at once on a seek or a loop, silent while hidden;
//   - a transparent GIF loops without residue in ffmpeg's decoder (when ffmpeg is installed).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mp4Writer, ascFor } from '../.test-build/motionmp4.js';
import { decodeAac, encodeAac, fitBed } from '../.test-build/motionaudioenc.js';
import { encodeMp4 } from '../.test-build/motionencode.js';
import { truePeakOf } from '../.test-build/audiocore.js';
import { encodeGif } from '../.test-build/motiongif.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { withSound } from '../.test-build/motionsound.js';
import { dispose, follow, position, prepare, setAudioFactory } from '../.test-build/motionsoundplay.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const started = Date.now();
const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)));
const db = (x) => 20 * Math.log10(x);
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const settle = (p) => p.then((value) => ({ value }), (error) => ({ error }));
const AVCC = hex('0164000dffe1001a6764000dacd941419f9f0110000003001000000303c0f142996001000668ebe3cb22c0fdf8f800');

// ── fake WebCodecs: a picture encoder, and an "AAC" codec that carries PCM with a priming and an overshoot ──
function install(o = {}) {
  const world = { audioEncoders: [], decoders: 0 };
  const P = o.priming ?? 2112;
  globalThis.VideoFrame = class { constructor(_src, init) { this.timestamp = init.timestamp; this.duration = init.duration; } close() {} };
  globalThis.VideoEncoder = class extends EventTarget {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor({ output, error }) { super(); Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: 0, n: 0, ondequeue: null }); }
    configure() { this.state = 'configured'; }
    encode(frame, opt) {
      const i = this.n++;
      const key = i === 0 || !!opt?.keyFrame;
      const data = Uint8Array.from([0, 0, 0, 3, key ? 0x65 : 0x41, 0x88, i & 0xff]);
      this.output({ type: key ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration, byteLength: data.length, copyTo: (d) => d.set(data) },
        i === 0 ? { decoderConfig: { codec: 'avc1.64000d', description: AVCC.buffer.slice(0) } } : {});
    }
    async flush() {}
    close() { this.state = 'closed'; }
  };
  if (o.noAudio) { for (const k of ['AudioData', 'AudioEncoder', 'AudioDecoder', 'EncodedAudioChunk']) delete globalThis[k]; return world; }
  globalThis.AudioData = class { constructor(init) { Object.assign(this, init); this.data = new Float32Array(init.data); } close() {} };
  globalThis.AudioEncoder = class {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor({ output, error }) {
      Object.assign(this, { output, error, state: 'unconfigured', encodeQueueSize: 0, inputPeak: 0, out: [], made: 0 });
      // How far this encoder's output rises above its input: the codec's overshoot, as a gain.
      this.boost = typeof o.boost === 'function' ? o.boost(world.audioEncoders.length) : o.boost ?? 1;
      world.audioEncoders.push(this);
    }
    configure(c) { this.c = c; this.state = 'configured'; this.pending = Array.from({ length: c.numberOfChannels }, () => [new Float32Array(P)]); this.held = P; }
    encode(d) {
      const n = d.numberOfFrames;
      for (let c = 0; c < this.c.numberOfChannels; c++) {
        const part = d.data.slice(c * n, (c + 1) * n);
        for (const v of part) this.inputPeak = Math.max(this.inputPeak, Math.abs(v));
        this.pending[c].push(part);
      }
      this.held += n;
      this.emit(false);
      o.onEncode?.(world.audioEncoders.indexOf(this));
    }
    emit(final) {
      while (this.held >= 1024 || (final && this.held > 0)) {
        const planes = this.pending.map((parts) => {
          const all = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
          let at = 0;
          for (const p of parts) { all.set(p, at); at += p.length; }
          parts.length = 0;
          if (all.length > 1024) parts.push(all.slice(1024));
          const f = new Float32Array(1024);
          f.set(all.subarray(0, 1024));
          return f.map((v) => v * this.boost);
        });
        this.held = Math.max(0, this.held - 1024);
        const pcm = new Float32Array(1024 * planes.length);
        planes.forEach((p, c) => pcm.set(p, c * 1024));
        this.out.push(planes);
        const data = new Uint8Array(pcm.buffer);
        const j = this.made++;
        const rate = this.c.sampleRate;
        const meta = j === 0 ? { decoderConfig: { codec: this.c.codec, sampleRate: rate, numberOfChannels: this.c.numberOfChannels, description: ascFor(rate, this.c.numberOfChannels).buffer.slice(0) } } : undefined;
        this.output({ type: 'key', timestamp: Math.round((j * 1024 * 1e6) / rate), duration: Math.round((1024 * 1e6) / rate), byteLength: data.length, copyTo: (dst) => dst.set(data) }, meta);
      }
    }
    async flush() { this.emit(true); }
    close() { this.state = 'closed'; }
  };
  if (o.noDecoder) { delete globalThis.AudioDecoder; delete globalThis.EncodedAudioChunk; return world; }
  globalThis.EncodedAudioChunk = class { constructor(init) { Object.assign(this, init); this.data = new Uint8Array(init.data); } };
  globalThis.AudioDecoder = class {
    constructor({ output, error }) { Object.assign(this, { output, error, state: 'unconfigured' }); world.decoders++; }
    configure() { if (o.decoderFails) throw new DOMException('Unsupported', 'NotSupportedError'); this.state = 'configured'; }
    decode(chunk) {
      const pcm = new Float32Array(chunk.data.buffer.slice(chunk.data.byteOffset, chunk.data.byteOffset + chunk.data.byteLength));
      this.output({ numberOfFrames: 1024, copyTo: (dst, x) => dst.set(pcm.subarray((x?.planeIndex ?? 0) * 1024, ((x?.planeIndex ?? 0) + 1) * 1024)), close() {} });
    }
    async flush() {}
    close() { this.state = 'closed'; }
  };
  return world;
}
const tone = (seconds, peakDb, rate = 48000) => {
  const a = 10 ** (peakDb / 20);
  return { channels: [0, 1].map((c) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => a * Math.sin((2 * Math.PI * (330 + 110 * c) * i) / rate))), sampleRate: rate };
};
/** What a player decodes from an encoder's output: its frames joined, the priming skipped, `n` samples, every channel. */
const heard = (enc, priming, n) => [0, 1].map((c) => {
  const all = new Float32Array(enc.out.length * 1024);
  enc.out.forEach((planes, j) => all.set(planes[c], j * 1024));
  return all.subarray(priming, priming + n);
});
const canvas = { width: 64, height: 36 };
const film = (audio, extra = {}) => encodeMp4({ canvas, width: 64, height: 36, fps: 30, frames: 90, draw: () => {}, audio, ...extra });

console.log('the film\'s sound under the ceiling, as a player decodes it');
{
  // A bed at -2.5 dBTP through a codec that adds 1.9 dB, the most measured in WebKit: -0.6 dBTP before the fix.
  const w = install({ boost: 10 ** (1.9 / 20) });
  const bytes = await film(tone(3, -2.5));
  const bedEncoders = w.audioEncoders.filter((e) => e.c.numberOfChannels === 2 && e.out.length > 100);
  const last = bedEncoders[bedEncoders.length - 1];
  const peak = db(truePeakOf(heard(last, 2112, 144000)));
  ok('a bed whose decoded peak passes -1.5 dBTP is turned down and encoded again: the film\'s sound peaks at -1.8 dBTP',
    bytes.audio === 'kept' && bedEncoders.length === 2 && near(peak, -1.8, 0.05), { encoders: bedEncoders.length, peak });
  ok('turned down by exactly the excess and the margin: the second encoder was fed the bed 1.2 dB lower',
    near(db(last.inputPeak) - db(bedEncoders[0].inputPeak), -1.2, 0.05), db(last.inputPeak) - db(bedEncoders[0].inputPeak));
  ok('and the film carries the corrected track (its bytes are the second encoder\'s)', Buffer.from(bytes).includes(Buffer.from(new Uint8Array(new Float32Array(last.out[50][0]).buffer))));
}
{
  const w = install({ boost: 10 ** (1.9 / 20) });
  const bytes = await film(tone(3, -6));
  const bedEncoders = w.audioEncoders.filter((e) => e.out.length > 100);
  ok('a bed that stays under after the codec is encoded once, and left as it is', bytes.audio === 'kept' && bedEncoders.length === 1 && near(db(bedEncoders[0].inputPeak), -6, 0.01));
}
{
  const w = install({ boost: 10 ** (1.45 / 20) });
  await film(tone(3, -3));
  ok('a decoded peak within 0.1 dB of the ceiling (-1.55) is corrected too: another decoder may read it a few hundredths higher',
    w.audioEncoders.filter((e) => e.out.length > 100).length === 2);
}
{
  const w = install({ boost: 10 ** (1.9 / 20), noDecoder: true });
  const bytes = await film(tone(3, -2.5));
  ok('no AudioDecoder to check with: the track is kept as encoded, once', bytes.audio === 'kept' && w.audioEncoders.filter((e) => e.out.length > 100).length === 1);
  const w2 = install({ boost: 10 ** (1.9 / 20), decoderFails: true });
  const b2 = await film(tone(3, -2.5));
  ok('a decoder that refuses the stream: kept as encoded, and the film is made', b2.audio === 'kept' && w2.audioEncoders.filter((e) => e.out.length > 100).length === 1);
}
{
  // An encoder whose overshoot grows each time it is asked again: the correction gives up after two.
  const w = install({ boost: (k) => 10 ** ((1.9 + 3 * k) / 20) });
  const bytes = await film(tone(3, -2.5));
  ok('at most two corrections, then the film is made with what there is', bytes.audio === 'kept' && w.audioEncoders.filter((e) => e.out.length > 100).length === 3);
}
{
  const ctl = new AbortController();
  install({ boost: 10 ** (1.9 / 20), onEncode: (k) => { if (k >= 2) ctl.abort(); } });
  const r = await settle(film(tone(3, -2.5), { signal: ctl.signal }));
  ok('Cancel during the correcting encode is Cancel', r.error?.name === 'AbortError', r.error?.message);
}
{
  install({ noAudio: true });
  const bytes = await film(tone(3, -2.5));
  ok('no AAC encoder at all: still a silent film, dropped', bytes.audio === 'dropped');
}

console.log('decodeAac: the track as the edit list plays it');
{
  const w = install({ priming: 2112, boost: 1 });
  const bed = tone(0.5, -6);
  const track = await encodeAac(bed);
  const d = await decodeAac(track);
  ok('two channels, the input\'s length, the priming skipped: sample for sample the bed',
    d?.length === 2 && d[0].length === 24000 && [0, 1, 999, 23999].every((i) => near(d[0][i], bed.channels[0][i]) && near(d[1][i], bed.channels[1][i])));
  ok('every decoder it opened is closed afterwards (one for the priming, one here)', w.decoders === 2);
  install({ noDecoder: true });
  ok('no decoder: null', (await decodeAac(track)) === null);
  install({ decoderFails: true });
  ok('a decoder that refuses it: null, not a throw', (await decodeAac(track)) === null);
  const pre = new AbortController();
  pre.abort();
  install();
  ok('already cancelled: an AbortError', (await settle(decodeAac(track, pre.signal))).error?.name === 'AbortError');
  ok('a track with no frames: null', (await decodeAac({ ...track, frames: [] })) === null);
}

console.log('a bed cut to the film\'s whole frames');
{
  // 4.39 s at 24 frames a second is 105 frames, 4.375 s of film: the bed loses its last 15 ms.
  const rate = 48000;
  const loud = { channels: [new Float32Array(Math.round(4.39 * rate)).fill(0.5)], sampleRate: rate };
  const cut = fitBed(loud, 105 / 24);
  const L = cut.channels[0], n = L.length;
  ok('cut to 210,000 samples, its last one silent, faded over its last 10 ms (raised cosine, rising into the cut)',
    n === 210000 && L[n - 1] === 0 && near(L[n - 481], 0.5, 1e-9) && near(L[n - 480], 0.5, 1e-4) && near(L[n - 241], 0.25, 0.01) && L[n - 2] < 0.001 && Array.from(L.subarray(n - 480)).every((v, i, a) => i === 0 || v <= a[i - 1] + 1e-9));
  const pad = fitBed({ channels: [new Float32Array(1000).fill(0.5)], sampleRate: rate }, 1);
  ok('made up with silence when short: its own samples untouched', pad.channels[0].length === 48000 && pad.channels[0][999] === 0.5 && pad.channels[0][1000] === 0);
  const exact = fitBed({ channels: [new Float32Array(48000).fill(0.5)], sampleRate: rate }, 1);
  ok('exactly the film\'s length: untouched, no fade', exact.channels[0][47999] === 0.5);
  const whole = fitBed({ channels: [new Float32Array(48000).fill(0.5)], sampleRate: rate });
  ok('no length asked: the bed as it is', whole.channels[0][47999] === 0.5 && whole.channels[0].length === 48000);
}

console.log('a film without sound is the 0.132.0 writer\'s file');
{
  // Hashes taken with the writer at git 4b13ed8 (0.132.0) from the same samples (R2 review).
  const GOLDEN = {
    '30x90@640x360': '76a7a015e9ca0092c1b6c6dd5ed072d39aae70807dc33b82bf65a710050f1c9c',
    '24x105@1080x1350': '335f8e62193e1a07a41ae9216bad67997fde982b8f84c0bb8d7e0b4d726739d9',
    '60x300@3840x2160': 'e5c831e6c67b112040ab22f639c284b37a4a30e111ef901324ea94e9002feb14',
  };
  for (const [key, want] of Object.entries(GOLDEN)) {
    const [, fps, frames, w, h] = /^(\d+)x(\d+)@(\d+)x(\d+)$/.exec(key).map(Number);
    const m = new Mp4Writer({ width: w, height: h, fps, avcC: AVCC });
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed >>> 24; };
    for (let i = 0; i < frames; i++) {
      const isKey = i % Math.round(2 * fps) === 0;
      const nal = [isKey ? 0x65 : 0x41, ...Array.from({ length: 20 + (i * 37) % 300 }, rnd)];
      m.add({ data: Uint8Array.from([0, 0, (nal.length >> 8) & 0xff, nal.length & 0xff, ...nal]), timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), key: isKey });
    }
    ok(`${fps} fps, ${frames} frames, ${w}x${h}: byte for byte the 0.132.0 file`, createHash('sha256').update(m.finish()).digest('hex') === want);
  }
}

console.log('the preview\'s sound against the playhead');
{
  class Param { constructor(v) { this.value = v; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } cancelScheduledValues() {} setTargetAtTime(v) { this.value = v; } }
  class Node0 { connect(n) { return n; } disconnect() {} }
  class Ctx {
    constructor() { Object.assign(this, { state: 'running', currentTime: 0, sampleRate: 16000, destination: new Node0(), sources: [], onstatechange: null }); }
    createGain() { const n = new Node0(); n.gain = new Param(1); return n; }
    createBuffer(channels, length, sampleRate) { return { length, sampleRate, duration: length / sampleRate, copyToChannel() {} }; }
    createBufferSource() {
      const s = new Node0();
      Object.assign(s, { playbackRate: new Param(1), started: null, stopped: null, onended: null });
      s.start = (when, offset) => { s.started = { when, offset }; };
      s.stop = (when) => { s.stopped = when ?? this.currentTime; };
      this.sources.push(s);
      return s;
    }
    resume() { return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  // A page with a visibility and a clock this test moves.
  const listeners = {};
  const doc = { hidden: false, addEventListener: (k, f) => { (listeners[k] ??= new Set()).add(f); }, removeEventListener: (k, f) => listeners[k]?.delete(f) };
  const realPerf = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let wall = 1000;
  Object.defineProperty(globalThis, 'performance', { value: { now: () => wall }, configurable: true, writable: true });
  globalThis.document = doc;
  const ctx = new Ctx();
  setAudioFactory(() => ctx);
  const g = withSound(buildMotion({ id: 'pv', recipe: 'big-number', lang: 'en', format: 'landscape', seconds: 8, now: 0 }), { mode: 'fx', level: 0.6 }, 0);
  ok('a graphic with sound gets ready', (await prepare(g)) === true);
  const live = () => ctx.sources.filter((s) => s.started && s.stopped === null);
  const F = 1 / 60;
  let t = 1;
  const tick = (dWall, dCtx, dT) => { wall += dWall * 1000; ctx.currentTime += dCtx; t += dT; follow({ t, playing: true, speed: 1 }); };
  follow({ t, playing: true, speed: 1 });
  ok('play: one source, at the playhead', live().length === 1 && live()[0].started.offset === 1);
  tick(F, F, F);
  tick(F, F + 0.05, F);
  ok('sound 50 ms ahead of the picture is started again at the playhead (it was left alone up to 120 ms)',
    ctx.sources.length === 2 && live().length === 1 && near(live()[0].started.offset, t, 1e-9), { offset: live()[0]?.started.offset, t });
  tick(F, F - 0.05, F);
  ok('sound 50 ms behind is left alone: late is noticed later, and a restart is heard', ctx.sources.length === 2);
  tick(F, F - 0.1, F);
  ok('150 ms behind: started again', ctx.sources.length === 3 && near(live()[0].started.offset, t, 1e-9));
  // A 200 ms stall between the clock's tick and this call: the picture is late, not lost.
  tick(0.2 + F, 0.2 + F, F);
  ok('a slow frame (200 ms) leaves the playhead behind for one call: the sound is not sent back', ctx.sources.length === 3);
  tick(F, F, 0.2 + F);
  ok('and the next tick catches it up: nothing to do, no restart at all', ctx.sources.length === 3 && Math.abs(position() - t) < 0.01, position() - t);
  // A 400 ms stall: the clock counts at most a quarter of a second of it, so 150 ms are really lost.
  tick(0.4 + F, 0.4 + F, F);
  tick(F, F, 0.25);
  ok('a 400 ms stall: one restart, at the playhead once it has caught up (two before, the first sending the sound back)',
    ctx.sources.length === 4 && near(live()[0].started.offset, t, 1e-9));
  tick(F, F, -0.5);
  ok('a seek back half a second: followed at once', ctx.sources.length === 5 && near(live()[0].started.offset, t, 1e-9));
  const before = ctx.sources.length;
  tick(F, F, 6 - t + 0.95);
  ok('a seek forward: followed at once', ctx.sources.length === before + 1 && near(live()[0].started.offset, t, 1e-9));
  tick(F, F, -t + 0.02);
  ok('a loop back to the start: followed at once', ctx.sources.length === before + 2 && near(live()[0].started.offset, 0.02, 1e-9));
  // Hidden: the playhead stops (no frames), so does the sound.
  doc.hidden = true;
  for (const f of listeners.visibilitychange ?? []) f();
  ok('the page hidden: the sound stops with the picture', live().length === 0);
  const count = ctx.sources.length;
  tick(F, F, 0);
  ok('and nothing starts while it is hidden', ctx.sources.length === count && live().length === 0);
  doc.hidden = false;
  wall += 10000;
  ctx.currentTime += 10;
  tick(F, F, F);
  ok('shown again: it starts with the next frame, at the playhead', live().length === 1 && near(live()[0].started.offset, t, 1e-9));
  dispose();
  ok('dispose stops listening to the page', !(listeners.visibilitychange?.size));
  setAudioFactory(null);
  delete globalThis.document;
  if (realPerf) Object.defineProperty(globalThis, 'performance', realPerf);
  else delete globalThis.performance;
}

// ── a transparent GIF loops cleanly in a decoder the suite does not own ───
const has = (cmd) => spawnSync(cmd, ['-version'], { encoding: 'utf8' }).status === 0;
if (has('ffmpeg')) {
  console.log('a transparent GIF in ffmpeg, looped');
  const dir = join(fileURLToPath(new URL('../.test-build/', import.meta.url)), 'r2-gif');
  mkdirSync(dir, { recursive: true });
  const W = 24, H = 16;
  // A square that moves and then leaves: its last frame is see-through where the first is drawn.
  const frames = Array.from({ length: 6 }, (_, k) => {
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 2; y < 10; y++) for (let x = 2 + 3 * k; x < 8 + 3 * k && x < W; x++) if (k < 5) rgba.set([255, 80, 0, 255], (y * W + x) * 4);
    return { rgba, seconds: 0.1 };
  });
  const gif = encodeGif(frames, { width: W, height: H, transparent: true });
  const file = join(dir, 'loop.gif');
  writeFileSync(file, gif);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-ignore_loop', '0', '-i', file, '-frames:v', '12', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 24 });
  const n = W * H * 4;
  const got = Math.floor(r.stdout.length / n);
  const passOne = r.stdout.subarray(0, 6 * n), passTwo = r.stdout.subarray(6 * n, 12 * n);
  ok('ffmpeg plays it twice round, the second pass pixel for pixel the first (no residue at the restart)', got === 12 && Buffer.compare(passOne, passTwo) === 0, { got });
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - started) / 1000).toFixed(1)} s)`);
if (fail) process.exit(1);
