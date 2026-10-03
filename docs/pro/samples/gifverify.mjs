// R2: a GIF read by two decoders that are not the test suite's own (ffmpeg's and macOS ImageIO's),
// compared with each other, with the file's own blocks, and with the renderer's canvas (scratch).
//   node .test-build/r2/gifverify.mjs <file.gif> [reference-dir]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = (cmd, args, raw = false) => spawnSync(cmd, args, { encoding: raw ? 'buffer' : 'utf8', maxBuffer: 2 ** 31 });

/** The file's own blocks: screen, global table size, loop block, each frame's GCE (delay, disposal, transparency) and rectangle. */
export function blocks(b) {
  const out = { header: String.fromCharCode(...b.subarray(0, 6)), width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8), frames: [] };
  const flags = b[10];
  out.globalTable = flags & 0x80 ? 2 << (flags & 7) : 0;
  out.background = b[11];
  let at = 13 + (flags & 0x80 ? 3 * (2 << (flags & 7)) : 0);
  let gce = null;
  while (at < b.length) {
    const k = b[at];
    if (k === 0x3b) { out.trailer = true; break; }
    if (k === 0x21) {
      const label = b[at + 1];
      if (label === 0xf9) gce = { disposal: (b[at + 3] >> 2) & 7, transparentFlag: b[at + 3] & 1, delay: b[at + 4] | (b[at + 5] << 8), index: b[at + 6] };
      if (label === 0xff && String.fromCharCode(...b.subarray(at + 3, at + 14)) === 'NETSCAPE2.0') out.loop = b[at + 16] | (b[at + 17] << 8);
      at += 2;
      while (b[at] !== 0) at += b[at] + 1;
      at += 1;
      continue;
    }
    if (k === 0x2c) {
      const f = { x: b[at + 1] | (b[at + 2] << 8), y: b[at + 3] | (b[at + 4] << 8), w: b[at + 5] | (b[at + 6] << 8), h: b[at + 7] | (b[at + 8] << 8), local: !!(b[at + 9] & 0x80), ...gce };
      out.frames.push(f);
      gce = null;
      at += 10 + (b[at + 9] & 0x80 ? 3 * (2 << (b[at + 9] & 7)) : 0);
      at += 1; // LZW minimum code size
      while (b[at] !== 0) at += b[at] + 1;
      at += 1;
      continue;
    }
    out.error = `unknown block 0x${k.toString(16)} at ${at}`;
    break;
  }
  return out;
}

export function gifVerify(file, refDir) {
  const b = readFileSync(file);
  const bl = blocks(b);
  const res = { file: basename(file), size: b.length, header: bl.header, width: bl.width, height: bl.height, loop: bl.loop, trailer: !!bl.trailer, globalTable: bl.globalTable, frames: bl.frames.length, error: bl.error };
  const delays = bl.frames.map((f) => f.delay);
  res.totalSeconds = delays.reduce((a, x) => a + x, 0) / 100;
  res.minDelay = Math.min(...delays);
  res.disposals = [...new Set(bl.frames.map((f) => f.disposal))];
  res.lastDisposal = bl.frames.at(-1)?.disposal;
  res.localTables = bl.frames.filter((f) => f.local).length;
  // ImageIO (Safari, Preview, Quick Look).
  const ioRaw = join(here, 'out', `${res.file}.imageio.rgba`);
  const io = JSON.parse(run(join(here, 'gifcheck'), [file, ioRaw]).stdout.trim() || '{}');
  res.imageio = { count: io.count, loopCount: io.loopCount, total: +io.total?.toFixed(3), delaysMatch: JSON.stringify((io.unclamped ?? []).map((d) => Math.round(d * 100))) === JSON.stringify(delays) };
  // ffmpeg (a third decoder, not the test's): every frame, composed, RGBA.
  const W = bl.width, H = bl.height, n = W * H * 4;
  const ff = run('ffmpeg', ['-v', 'error', '-i', file, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], true);
  res.ffmpegErrors = ff.stderr.toString().trim();
  const frames = Math.floor(ff.stdout.length / n);
  res.ffmpeg = { frames };
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=duration_time:format=duration', '-of', 'json', file]).stdout);
  res.ffmpeg.total = +probe.format.duration;
  res.ffmpeg.delaysMatch = JSON.stringify(probe.frames.map((f) => Math.round(+f.duration_time * 100))) === JSON.stringify(delays);
  const ioBuf = existsSync(ioRaw) ? readFileSync(ioRaw) : null;
  let maxDiff = 0, colours = 0, partialAlpha = 0, clear = 0;
  const alphaDisagree = [];
  for (let k = 0; k < frames; k++) {
    const f = ff.stdout.subarray(k * n, (k + 1) * n);
    const set = new Set();
    let cl = 0;
    for (let p = 0; p < n; p += 4) {
      const a = f[p + 3];
      if (a === 0) cl++;
      else { set.add((f[p] << 16) | (f[p + 1] << 8) | f[p + 2]); if (a !== 255) partialAlpha++; }
    }
    colours = Math.max(colours, set.size);
    clear = Math.max(clear, cl / (W * H));
    if (ioBuf) {
      // ImageIO's is premultiplied (a GIF pixel is fully opaque or fully clear, so it is the same numbers where opaque); rows top-down.
      const g = ioBuf.subarray(k * n, (k + 1) * n);
      let dis = 0;
      for (let p = 0; p < n; p += 4) {
        const a1 = f[p + 3], a2 = g[p + 3];
        if ((a1 === 0) !== (a2 === 0)) { dis++; continue; }
        if (a1) for (let c = 0; c < 3; c++) maxDiff = Math.max(maxDiff, Math.abs(f[p + c] - g[p + c]));
      }
      if (dis) alphaDisagree.push([k, dis]);
    }
  }
  res.colours = colours;
  res.partialAlpha = partialAlpha;
  res.maxClearShare = +clear.toFixed(4);
  res.ffmpegVsImageIO = { maxChannelDiff: maxDiff, framesWhereAlphaDiffers: alphaDisagree.slice(0, 8), framesCompared: ioBuf ? Math.min(frames, io.count) : 0 };
  // Against the renderer's own canvas, at the frames the reference dump holds.
  if (refDir && existsSync(join(refDir, 'index.json'))) {
    const idx = JSON.parse(readFileSync(join(refDir, 'index.json'), 'utf8'));
    res.vsCanvas = [];
    for (const r of idx.frames) {
      const ref = readFileSync(join(refDir, `${r.i}.rgba`));
      // the GIF frame showing at time r.t: the one whose start is the latest at or before it
      let tsum = 0, k = 0;
      for (; k < delays.length; k++) { if (tsum + delays[k] / 100 > r.t + 0.005 + 1e-6) break; tsum += delays[k] / 100; }
      const f = ff.stdout.subarray(k * n, (k + 1) * n);
      let abs = 0, exact = 0, alphaWrong = 0, cnt = 0;
      for (let p = 0; p < n; p += 4) {
        const ra = ref[p + 3] >= 128, ga = f[p + 3] > 0;
        if (ra !== ga) { alphaWrong++; continue; }
        if (!ra) { exact++; continue; }
        let d = 0;
        for (let c = 0; c < 3; c++) d += Math.abs(ref[p + c] - f[p + c]);
        abs += d / 3; cnt++;
        if (d === 0) exact++;
      }
      res.vsCanvas.push({ t: r.t, gifFrame: k, meanAbs: +(abs / Math.max(1, cnt)).toFixed(2), exactShare: +(exact / (W * H)).toFixed(3), alphaWrong });
    }
  }
  return res;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log(JSON.stringify(gifVerify(process.argv[2], process.argv[3]), null, 1));
}
