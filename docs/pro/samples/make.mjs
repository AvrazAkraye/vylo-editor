// R2's sample maker, copied for S1 (scratch, git-ignored): make the sample files in the real engine, then verify each.
//   cd app && [S1_OUT=dir] node .test-build/s1/make.mjs [name-filter]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..');
const SAMPLES = process.env.S1_OUT || '/Volumes/ExtremeSSD/apps/vylo-pro-samples-final';
const out = join(here, 'out');
mkdirSync(join(out, 'meta'), { recursive: true });
const only = process.argv[2] ?? '';

export const SPECS = [
  { name: 'mp4/01-title-effects', recipe: 'big-title', dest: 'youtube', sound: { mode: 'fx', level: 0.6 } },
  { name: 'mp4/02-counter-both', recipe: 'big-number', dest: 'youtube', sound: { mode: 'both', level: 0.6 } },
  { name: 'mp4/03-bar-race-music', recipe: 'bar-race', dest: 'youtube', sound: { mode: 'music', level: 0.6 } },
  { name: 'mp4/04-scenes-push-iris-flash', dest: 'youtube', sound: { mode: 'both', level: 0.6, mood: 'uplifting' },
    scenes: { recipes: ['big-title', 'big-number', 'bar-chart', 'quote'], each: 3, transitions: [{ kind: 'push', d: 0.5 }, { kind: 'iris', d: 0.6 }, { kind: 'flash', d: 0.5 }], title: 'Four scenes' } },
  { name: 'mp4/05-story-9x16', recipe: 'handle', format: 'portrait', dest: 'story', sound: { mode: 'both', level: 0.6 } },
  { name: 'mp4/06-arabic-title', recipe: 'big-title', lang: 'ar', dest: 'youtube', sound: { mode: 'both', level: 0.6, mood: 'oriental' } },
  // S1: three more, for the fixes that landed after R2.
  { name: 'mp4/10-plus-scene-push-both', build: 'plusScene', dest: 'youtube', sound: { mode: 'both', level: 0.6 } },
  { name: 'mp4/11-four-scenes-effects', dest: 'youtube', sound: { mode: 'fx', level: 0.6 },
    scenes: { recipes: ['big-title', 'big-number', 'bar-chart', 'quote'], each: 3, transitions: [{ kind: 'push', d: 0.5 }, { kind: 'iris', d: 0.6 }, { kind: 'flash', d: 0.5 }], title: 'Four scenes' } },
  { name: 'mp4/12-brand-arabic-music', build: 'brand', recipe: 'logo-reveal', lang: 'ar', dest: 'youtube', fields: { tagline: 'خبز طازج كل صباح' },
    brand: { name: 'مخبز النور', handle: 'noorbakery', url: 'noorbakery.iq', paletteId: 'sunset', voice: 'serif' }, sound: { mode: 'music', level: 0.6 } },
  { name: 'gif/07-web-loop', recipe: 'loop-bg', dest: 'loop', sound: null },
  { name: 'gif/08-transparent-lower-third', recipe: 'lower-third', dest: 'loop', choices: { transparent: true }, sound: null },
  { name: 'png/09-picture-stats', recipe: 'stats', dest: 'picture', sound: null },
  // Harder cases, kept apart for the review.
  { name: 'stress/4k-60fps-lower-third-both', recipe: 'lower-third', fps: 60, dest: 'youtube', choices: { size: '4k' }, sound: { mode: 'both', level: 0.6 } },
  { name: 'stress/30s-blur-ten-scenes-both', dest: 'youtube', choices: { blur: true }, sound: { mode: 'both', level: 0.6, mood: 'epic' },
    scenes: { recipes: ['big-title', 'big-number', 'bar-chart', 'quote', 'stats', 'donut', 'kinetic', 'line-chart', 'countdown', 'logo-reveal'], each: 3,
      transitions: ['push', 'iris', 'flash', 'fade', 'slide', 'clock', 'blinds', 'zoom', 'whip'].map((kind) => ({ kind })), title: 'Ten scenes' } },
  { name: 'stress/sound-off-title', recipe: 'big-title', dest: 'youtube', sound: null },
  { name: 'stress/24fps-post-rebuilt-effects', recipe: 'lower-third', fps: 24, seconds: 4.39, dest: 'post', sound: { mode: 'fx', level: 0.6 } },
  { name: 'stress/level-1.0-steps-both', recipe: 'steps', dest: 'youtube', sound: { mode: 'both', level: 1 } },
  { name: 'stress/level-0.3-intro-both', recipe: 'intro', dest: 'youtube', sound: { mode: 'both', level: 0.3 } },
  { name: 'stress/fx-only-loop-bg', recipe: 'loop-bg', dest: 'youtube', sound: { mode: 'fx', level: 0.6 } },
];

function host(expression, json, timeout = 280) {
  const r = spawnSync('perl', ['-e', `alarm ${timeout + 30}; exec @ARGV`, 'node', join(here, 'wk2.mjs'), join(here, 'samples.ts'), expression, json, '--size', '800x600', '--timeout', String(timeout), '--dir', SAMPLES],
    { encoding: 'utf8', cwd: app, maxBuffer: 1 << 26, env: { ...process.env, TMPDIR: join(here, 'tmp') } });
  return { ok: r.status === 0, log: `${r.stdout}${r.stderr}`.trim() };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const rows = [];
  for (const spec of SPECS) {
    if (only && !spec.name.includes(only)) continue;
    const base = spec.name.split('/').pop();
    const json = join(out, 'meta', `${base}.json`);
    const long = spec.name.includes('30s') || spec.name.includes('4k');
    const h = host(`sample(${JSON.stringify(spec)})`, json, long ? 560 : 280);
    if (!h.ok) { console.log(`${spec.name}: HARNESS FAILED\n${h.log.slice(-1500)}`); continue; }
    const meta = JSON.parse(readFileSync(json, 'utf8'));
    console.log(`${spec.name}.${meta.ext}: ${meta.ms} ms, ${meta.bytes} bytes, audio=${meta.audio}, painted ${meta.painted}/${meta.frames}, plan ${meta.changing}`);
    if (meta.ext === 'mp4') {
      const bed = join(out, 'beds', `${base}.bed.f32`);
      const v = verify(join(SAMPLES, `${spec.name}.mp4`), existsSync(bed) ? bed : '', meta.doc);
      writeFileSync(join(out, 'meta', `${base}.verify.json`), JSON.stringify(v, null, 1));
      rows.push({ name: spec.name, meta, v });
      console.log(`  ffprobe v ${v.video?.codec} ${v.video?.size} ${v.video?.frames}f ${v.video?.duration}s start ${v.video?.start} | a ${v.audio ? `${v.audio.codec} ${v.audio.rate} ${v.audio.channels}ch start ${v.audio.start} dur ${v.audio.duration}` : 'none'} | errors: ${v.ffmpegErrors || 'none'}`);
      if (v.audio) {
        console.log(`  decoded ${v.decoded.samples} vs ${v.decoded.expected} (${v.decoded.diffFrames} frames) | AVF ${v.avfoundation.audioStart}+${v.avfoundation.audioDuration} video ${v.avfoundation.videoStart}+${v.avfoundation.videoDuration} samples ${v.avfoundation.frames}`);
        console.log(`  lag vs bed: ffmpeg ${JSON.stringify(v.lagFfmpeg)} AVF ${JSON.stringify(v.lagAVFoundation)} | snr ${v.snrDb} dB`);
        console.log(`  loudness: ffmpeg ${v.meter.lufs} LUFS TP ${v.meter.truePeak} SP ${v.meter.samplePeak} | app-on-decoded ${v.appMeterOnDecoded.lufs} TP ${v.appMeterOnDecoded.truePeak} | bed ${v.bed?.lufs} TP ${v.bed?.truePeak} | clipped ${v.clipped} | L-R ${v.stereo.lrDb} dB corr ${v.stereo.correlation}`);
        console.log(`  edges: first ${v.edges.firstMsPeak} last ${v.edges.lastMsPeak} | bed first ${v.bedEdges?.first} last ${v.bedEdges?.last} | bed-vs-film ${v.bed?.bedVsFilmSamples} samples, bed at film end ${v.bedAtFilmEnd ?? '-'} | clicks decoded ${v.clicksDecoded.length} bed ${v.clicksBed?.length}`);
      }
    }
  }
  writeFileSync(join(out, 'summary.json'), JSON.stringify(rows.map((r) => ({ name: r.name, meta: { ms: r.meta.ms, bytes: r.meta.bytes, audio: r.meta.audio, painted: r.meta.painted, frames: r.meta.frames }, v: r.v })), null, 1));
}
