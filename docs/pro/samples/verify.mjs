// R2 verifier (scratch, git-ignored): checks a real exported MP4 with ffprobe, ffmpeg's decoder and meter,
// and AVFoundation, against the sound bed the app rendered for it.
//   node .test-build/r2/verify.mjs <file.mp4> [bed.f32] [meta.json]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..');
const { measureLoudness } = await import(pathToFileURL(join(app, '.test-build', 'loudness.js')).href);

const run = (cmd, args, raw = false) => spawnSync(cmd, args, { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const r2 = (x, n = 2) => (Number.isFinite(x) ? +x.toFixed(n) : x);

export function probe(file) {
  const p = run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=index,codec_type,codec_name,profile,width,height,sample_rate,channels,channel_layout,start_time,duration,nb_frames,nb_read_frames,r_frame_rate,avg_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,bit_rate:stream_side_data:format=duration,nb_streams,format_name,start_time',
    '-of', 'json', file]);
  return JSON.parse(p.stdout || '{}');
}

/** ffmpeg's decode of the sound, edit list honoured, stereo float at 48 kHz, as two planes. */
export function ffAudio(file) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'], true);
  const b = r.stdout;
  const f = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4));
  return deinterleave(f);
}

export function deinterleave(f) {
  const n = Math.floor(f.length / 2);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return [L, R];
}

export function readPlanar(file, channels = 2) {
  const b = readFileSync(file);
  const f = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  const n = f.length / channels;
  return Array.from({ length: channels }, (_, c) => f.subarray(c * n, (c + 1) * n));
}

export function avAudio(file) {
  const out = join(here, 'out', 'av-tmp.f32');
  const r = run(join(here, 'avdump'), [file, out]);
  const info = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
  const ch = existsSync(out) && info.frames ? deinterleave(new Float32Array(readFileSync(out).buffer.slice(0))) : null;
  return { info, ch };
}

/** ffmpeg's EBU R128 meter (its own, not the app's): integrated loudness and true peak. */
export function ebur(file) {
  const r = run('ffmpeg', ['-nostats', '-v', 'info', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true+sample:framelog=quiet', '-f', 'null', '-']);
  const s = r.stderr;
  const tail = s.slice(s.lastIndexOf('Summary:'));
  const I = /I:\s+(-?[\d.]+|-inf) LUFS/.exec(tail);
  const LRA = /LRA:\s+(-?[\d.]+) LU/.exec(tail);
  const tp = /True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(tail);
  const sp = /Sample peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(tail);
  return { lufs: I ? parseFloat(I[1]) : null, lra: LRA ? parseFloat(LRA[1]) : null, truePeak: tp ? parseFloat(tp[1]) : null, samplePeak: sp ? parseFloat(sp[1]) : null };
}

/** The lag (decoded later by `lag` samples) at which `dec` best matches `ref`, over the loudest half second of `ref`. */
export function lagOf(ref, dec, max = 3000) {
  const W = 24000;
  let best = 0, at = 0;
  for (let s = 0; s + W < ref.length; s += 4800) {
    let e = 0;
    for (let k = s; k < s + W; k++) e += ref[k] * ref[k];
    if (e > best) { best = e; at = s; }
  }
  if (!(best > 0)) return { lag: null, score: 0 };
  let top = -Infinity, lag = 0;
  const lo = Math.max(-max, -at), hi = Math.min(max, dec.length - at - W);
  for (let l = lo; l <= hi; l++) {
    let dot = 0, ee = 0;
    for (let k = at; k < at + W; k += 1) { const d = dec[k + l]; dot += ref[k] * d; ee += d * d; }
    const sc = ee > 0 ? dot / Math.sqrt(best * ee) : 0;
    if (sc > top) { top = sc; lag = l; }
  }
  return { lag, score: r2(top, 4), at };
}

/**
 * Discontinuities: samples whose second difference stands far out of its neighbourhood (an isolated spike,
 * which is what a click is), reported with their time. `floor` ignores the very quiet.
 */
export function clicks(x, rate = 48000, o = {}) {
  const ratio = o.ratio ?? 10, floor = o.floor ?? 0.02, half = o.half ?? 240;
  const n = x.length;
  const d = new Float32Array(n);
  for (let i = 2; i < n; i++) d[i] = x[i] - 2 * x[i - 1] + x[i - 2];
  // running mean square of d over ±half
  const sq = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) sq[i + 1] = sq[i] + d[i] * d[i];
  const out = [];
  for (let i = 2; i < n; i++) {
    const a = Math.abs(d[i]);
    if (a < floor) continue;
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
    const local = (sq[hi] - sq[lo] - (sq[Math.min(n, i + 3)] - sq[Math.max(0, i - 2)])) / Math.max(1, hi - lo - 5);
    const rms = Math.sqrt(local);
    if (a > ratio * rms) { out.push({ t: r2(i / rate, 5), i, jump: r2(a, 4), localRms: r2(rms, 5) }); i += 48; }
  }
  return out;
}

export function rms(x, a = 0, b = x.length) {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}

export function peak(x, a = 0, b = x.length) {
  let m = 0;
  for (let i = a; i < b; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

/** The whole check of one film. */
export function verify(file, bedFile, meta = {}) {
  const res = { file };
  const p = probe(file);
  const v = (p.streams || []).find((s) => s.codec_type === 'video');
  const a = (p.streams || []).find((s) => s.codec_type === 'audio');
  res.container = { format: p.format?.format_name, streams: p.format?.nb_streams, duration: +p.format?.duration };
  res.video = v && { codec: v.codec_name, profile: v.profile, size: `${v.width}x${v.height}`, pix: v.pix_fmt, range: v.color_range, primaries: v.color_primaries, transfer: v.color_transfer, matrix: v.color_space, start: +v.start_time, duration: +v.duration, frames: +v.nb_read_frames, rate: v.r_frame_rate };
  res.audio = a && { codec: a.codec_name, profile: a.profile, rate: +a.sample_rate, channels: a.channels, start: +a.start_time, duration: +a.duration, packets: +a.nb_read_frames };
  const dec = run('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-']);
  res.ffmpegErrors = dec.stderr.trim();
  if (!a) return res;
  const fps = meta.fps ?? 30;
  const frames = res.video?.frames ?? 0;
  const film = frames / fps;
  const [L, R] = ffAudio(file);
  res.decoded = { samples: L.length, seconds: r2(L.length / 48000, 5), expected: Math.round(film * 48000), filmSeconds: r2(film, 5) };
  res.decoded.diffSamples = L.length - res.decoded.expected;
  res.decoded.diffFrames = r2((L.length / 48000 - film) * fps, 3);
  res.meter = ebur(file);
  const mine = measureLoudness([L, R], 48000);
  res.appMeterOnDecoded = { lufs: r2(mine.lufs), truePeak: r2(mine.truePeakDb), samplePeak: r2(mine.samplePeakDb), lra: r2(mine.range) };
  let clip = 0;
  for (const c of [L, R]) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.999) clip++;
  res.clipped = clip;
  const rl = rms(L), rr = rms(R);
  let corr = 0;
  for (let i = 0; i < L.length; i++) corr += L[i] * R[i];
  res.stereo = { lrDb: r2(db(rl) - db(rr)), correlation: r2(corr / Math.max(1e-30, Math.sqrt(rl * rl * L.length * rr * rr * R.length)), 3) };
  res.edges = { firstMsPeak: r2(peak(L, 0, 48) + 0, 5), first5: Array.from(L.subarray(0, 5), (x) => r2(x, 5)), lastMsPeak: r2(Math.max(peak(L, L.length - 48), peak(R, R.length - 48)), 5), last5: Array.from(L.subarray(L.length - 5), (x) => r2(x, 5)) };
  res.clicksDecoded = [...clicks(L), ...clicks(R)].sort((x, y) => x.t - y.t).slice(0, 20);
  if (bedFile && existsSync(bedFile)) {
    const [bL, bR] = readPlanar(bedFile);
    const bm = measureLoudness([bL, bR], 48000);
    res.bed = { samples: bL.length, lufs: r2(bm.lufs), truePeak: r2(bm.truePeakDb), samplePeak: r2(bm.samplePeakDb) };
    res.bed.bedVsFilmSamples = bL.length - res.decoded.expected;
    res.lagFfmpeg = lagOf(bL, L);
    // Residual after alignment at lag 0: how much the codec changed (and whether anything else did).
    const n = Math.min(bL.length, L.length);
    let e = 0, s = 0;
    for (let i = 0; i < n; i++) { const d = L[i] - bL[i]; e += d * d; s += bL[i] * bL[i]; }
    res.snrDb = r2(10 * Math.log10(s / Math.max(1e-30, e)), 1);
    res.clicksBed = [...clicks(bL), ...clicks(bR)].sort((x, y) => x.t - y.t).slice(0, 20);
    res.bedEdges = { first: r2(Math.abs(bL[0]), 6), last: r2(Math.max(Math.abs(bL[bL.length - 1]), Math.abs(bR[bR.length - 1])), 6), lastMsPeak: r2(Math.max(peak(bL, bL.length - 48), peak(bR, bR.length - 48)), 5) };
    // The film's end, if the film is shorter than the bed: what level the bed had where it was cut.
    if (bL.length > res.decoded.expected) res.bedAtFilmEnd = r2(Math.max(peak(bL, res.decoded.expected - 48, res.decoded.expected), peak(bR, res.decoded.expected - 48, res.decoded.expected)), 5);
  }
  const av = avAudio(file);
  res.avfoundation = av.info;
  if (av.ch && bedFile && existsSync(bedFile)) {
    const [bL] = readPlanar(bedFile);
    res.lagAVFoundation = lagOf(bL, av.ch[0]);
    res.avfoundation.samplesVsExpected = av.ch[0].length - res.decoded.expected;
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [file, bed, metaFile] = process.argv.slice(2);
  const meta = metaFile ? JSON.parse(readFileSync(metaFile, 'utf8')) : {};
  console.log(JSON.stringify(verify(file, bed, meta.doc ?? meta), null, 1));
}
