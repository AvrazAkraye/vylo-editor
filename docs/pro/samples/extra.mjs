// S1: second opinions on a film R2's verify.mjs already checked (scratch, git-ignored).
//   node .test-build/s1/extra.mjs <file.mp4> [bed.f32] [fps]
// - afinfo (AudioToolbox): the audio track's valid frames, priming and remainder, as Apple's file reader sees the edit list.
// - afconvert (AudioToolbox's ExtAudioFile): a third decode of the AAC, to float WAV; its length, lag against the bed,
//   loudness and true peak by the app's meter AND by ffmpeg's meter on that WAV.
// - avdump (AVFoundation's AVAssetReader): the app's meter, clipping and stereo balance on that decode too.
// - ffprobe: the first video and audio packet times (the priming shows as a negative audio pts the edit list skips).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deinterleave, ebur, lagOf, readPlanar, rms, peak, clicks } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..');
const { measureLoudness } = await import(pathToFileURL(join(app, '.test-build', 'loudness.js')).href);
const run = (cmd, args, raw = false) => spawnSync(cmd, args, { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 1 << 30 });
const r2 = (x, n = 2) => (Number.isFinite(x) ? +x.toFixed(n) : x);
const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** A float WAV's samples (afconvert writes a RIFF with a `data` chunk; walk the chunks). */
function readWav(file) {
  const b = readFileSync(file);
  let at = 12, fmt = null;
  while (at + 8 <= b.length) {
    const id = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(at + 8), channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    if (id === 'data') {
      const f = new Float32Array(b.buffer.slice(b.byteOffset + at + 8, b.byteOffset + at + 8 + size));
      return { fmt, ch: deinterleave(f) };
    }
    at += 8 + size + (size & 1);
  }
  return { fmt, ch: null };
}

function stereo(L, R) {
  const rl = rms(L), rr = rms(R);
  let corr = 0;
  for (let i = 0; i < L.length; i++) corr += L[i] * R[i];
  return { lrDb: r2(db(rl) - db(rr)), correlation: r2(corr / Math.max(1e-30, Math.sqrt(rl * rl * L.length * rr * rr * R.length)), 3) };
}

function clipped(chs) {
  let n = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= 0.999) n++;
  return n;
}

export function extra(file, bedFile, fps = 30) {
  const res = { file: basename(file) };
  const p = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,nb_read_frames,start_time,duration', '-count_frames', '-of', 'json', file]).stdout);
  const v = p.streams.find((s) => s.codec_type === 'video');
  const a = p.streams.find((s) => s.codec_type === 'audio');
  const frames = +v.nb_read_frames;
  const expected = Math.round((frames / fps) * 48000);
  res.expectedSamples = expected;
  const pk = (sel) => {
    const o = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', sel, '-show_entries', 'packet=pts_time,duration_time', '-read_intervals', '%+#1', '-of', 'json', file]).stdout);
    return o.packets?.[0] ? +o.packets[0].pts_time : null;
  };
  res.firstPacket = { video: pk('v:0'), audio: a ? pk('a:0') : null };
  if (!a) return res;
  // afinfo: "audio N valid frames + P priming + R remainder = T"
  const ai = run('afinfo', [file]).stdout;
  const m = /audio (\d+) valid frames \+ (\d+) priming \+ (\d+) remainder = (\d+)/.exec(ai);
  const dur = /estimated duration: ([\d.]+) sec/.exec(ai);
  const layout = /Channel layout: (.+)/.exec(ai);
  res.afinfo = m ? { valid: +m[1], priming: +m[2], remainder: +m[3], total: +m[4], duration: dur ? +dur[1] : null, layout: layout?.[1]?.trim(), validVsExpected: +m[1] - expected } : { raw: ai.slice(0, 400) };
  // afconvert: AudioToolbox's own decode.
  const wav = join(here, 'out', `af-${process.pid}.wav`);
  const c = run('afconvert', ['-f', 'WAVE', '-d', 'LEF32@48000', file, wav]);
  res.afconvert = { status: c.status, err: c.stderr.trim() };
  if (c.status === 0 && existsSync(wav)) {
    const { fmt, ch } = readWav(wav);
    const [L, R] = ch;
    const mine = measureLoudness([L, R], 48000);
    const ff = ebur(wav);
    res.afconvert = {
      fmt, samples: L.length, vsExpected: L.length - expected, appMeter: { lufs: r2(mine.lufs), truePeak: r2(mine.truePeakDb) },
      ffmpegMeter: { lufs: ff.lufs, truePeak: ff.truePeak }, clipped: clipped([L, R]), stereo: stereo(L, R),
      firstMsPeak: r2(Math.max(peak(L, 0, 48), peak(R, 0, 48)), 5), lastMsPeak: r2(Math.max(peak(L, L.length - 48), peak(R, R.length - 48)), 5),
      clicks: [...clicks(L), ...clicks(R)].sort((x, y) => x.t - y.t).slice(0, 10),
    };
    if (bedFile && existsSync(bedFile)) res.afconvert.lag = lagOf(readPlanar(bedFile)[0], L);
    rmSync(wav);
  }
  // AVFoundation's decode, metered by the app's meter.
  const avOut = join(here, 'out', `av-${process.pid}.f32`);
  const r = run(join(here, 'avdump'), [file, avOut]);
  const info = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
  if (existsSync(avOut) && info.frames) {
    const [L, R] = deinterleave(new Float32Array(readFileSync(avOut).buffer.slice(0)));
    const mine = measureLoudness([L, R], 48000);
    res.avfoundation = { videoStart: info.videoStart, videoDuration: info.videoDuration, audioStart: info.audioStart, audioDuration: info.audioDuration, samples: L.length,
      vsExpected: L.length - expected, appMeter: { lufs: r2(mine.lufs), truePeak: r2(mine.truePeakDb) }, clipped: clipped([L, R]), stereo: stereo(L, R) };
    rmSync(avOut);
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [file, bed, fps] = process.argv.slice(2);
  console.log(JSON.stringify(extra(file, bed, fps ? +fps : 30), null, 1));
}
