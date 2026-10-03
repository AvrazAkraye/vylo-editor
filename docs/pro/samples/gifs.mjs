// S1: the GIFs and the PNG, checked again (scratch, git-ignored).
//   cd app && node .test-build/s1/gifs.mjs
// For each GIF: the renderer's canvas at ten moments (samples.ts gifReference, in the engine), then R2's gifverify
// (the file's own blocks, ffmpeg's decode, macOS ImageIO's decode, each against the other and the canvas), a loop
// restart (ffmpeg plays it twice: the second pass must equal the first), and `sips` (macOS's image tool).
// The PNG: ffprobe, sips, and its pixels by ffmpeg and by ImageIO (sips to TIFF, then ffmpeg) compared.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gifVerify } from './gifverify.mjs';
import { SPECS } from './make.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..', '..');
const SAMPLES = process.env.S1_OUT || '/Volumes/ExtremeSSD/apps/vylo-pro-samples-final';
const run = (cmd, args, raw = false) => spawnSync(cmd, args, { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 2 ** 31 });
const TIMES = [0, 8 / 15, 1, 2, 3, 4, 67 / 15, 70 / 15, 72 / 15, 74 / 15];
mkdirSync(join(here, 'out', 'meta'), { recursive: true });
const out = {};
for (const spec of SPECS.filter((s) => s.name.startsWith('gif/'))) {
  const base = spec.name.split('/').pop();
  const json = join(here, 'out', `gifref-${base}.json`);
  const h = spawnSync('node', [join(here, 'wk2.mjs'), join(here, 'samples.ts'), `gifReference(${JSON.stringify(spec)}, ${JSON.stringify(TIMES)})`, json, '--size', '800x600', '--timeout', '200'],
    { encoding: 'utf8', cwd: app, env: { ...process.env, TMPDIR: join(here, 'tmp') } });
  if (h.status !== 0) { console.log(base, 'reference failed', h.stdout, h.stderr); continue; }
  const file = join(SAMPLES, `${spec.name}.gif`);
  const v = gifVerify(file, join(here, 'out', 'gifref', base));
  // The loop: two passes through ffmpeg's looping demuxer; the second must be byte for byte the first.
  const n = v.width * v.height * 4;
  const two = run('ffmpeg', ['-v', 'error', '-ignore_loop', '0', '-i', file, '-frames:v', String(2 * v.frames), '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], true).stdout;
  const first = two.subarray(0, v.frames * n), second = two.subarray(v.frames * n, 2 * v.frames * n);
  let differ = 0;
  for (let i = 0; i < first.length; i++) if (first[i] !== second[i]) differ++;
  v.loopRestart = { framesDecoded: Math.floor(two.length / n), bytesThatDiffer: differ };
  const sips = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', '-g', 'hasAlpha', file]).stdout;
  v.sips = Object.fromEntries([...sips.matchAll(/^\s+(\w+): (.+)$/gm)].map((m) => [m[1], m[2].trim()]));
  out[base] = v;
  writeFileSync(join(here, 'out', 'meta', `${base}.gifverify.json`), JSON.stringify(v, null, 1));
  console.log(base, JSON.stringify({ frames: v.frames, total: v.totalSeconds, loop: v.loop, imageio: v.imageio, ffmpeg: v.ffmpeg, colours: v.colours, partialAlpha: v.partialAlpha,
    ffVsIO: v.ffmpegVsImageIO, vsCanvas: v.vsCanvas?.map((x) => x.meanAbs), alphaWrong: v.vsCanvas?.reduce((a, x) => a + x.alphaWrong, 0), loopRestart: v.loopRestart, sips: v.sips, errors: v.ffmpegErrors }));
}
// The PNG.
const png = join(SAMPLES, 'png/09-picture-stats.png');
const p = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height,pix_fmt,color_space,color_primaries,color_transfer', '-of', 'json', png]).stdout).streams[0];
const sips = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', '-g', 'hasAlpha', '-g', 'space', '-g', 'profile', png]).stdout;
const tiff = join(here, 'out', 'png-imageio.tiff');
run('sips', ['-s', 'format', 'tiff', png, '--out', tiff]);
const a = run('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], true).stdout;
const b = run('ffmpeg', ['-v', 'error', '-i', tiff, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], true).stdout;
let maxd = 0;
for (let i = 0; i < Math.min(a.length, b.length); i++) maxd = Math.max(maxd, Math.abs(a[i] - b[i]));
const chunks = [];
{
  const buf = readFileSync(png);
  for (let at = 8; at + 8 <= buf.length;) { const len = buf.readUInt32BE(at); chunks.push(buf.toString('latin1', at + 4, at + 8)); at += 12 + len; }
}
out.png = { ffprobe: p, sips: Object.fromEntries([...sips.matchAll(/^\s+(\w+): (.+)$/gm)].map((m) => [m[1], m[2].trim()])), chunks: [...new Set(chunks)],
  ffmpegVsImageIO: { bytes: [a.length, b.length], maxChannelDiff: maxd } };
console.log('png', JSON.stringify(out.png));
writeFileSync(join(here, 'out', 'gifs-png.json'), JSON.stringify(out, null, 1));
