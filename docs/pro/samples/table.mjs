// S1: the measurement table for the samples' README, from out/meta (this run) and R2's numbers (scratch).
//   cd app && node .test-build/s1/table.mjs [r2-meta-dir]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPECS } from './make.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const R2 = process.argv[2] || '/Volumes/ExtremeSSD/apps/vylo-editor-pro-r-export/app/.test-build/r2/out/meta';
const j = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const cuts = {
  '04-scenes-push-iris-flash': null, '10-plus-scene-push-both': null, '11-four-scenes-effects': null, '30s-blur-ten-scenes-both': null,
};
const sgn = (x) => (x > 0 ? `+${x}` : `${x}`.replace('-', '−'));
const neg = (x) => `${x}`.replace('-', '−');
const rows = [];
for (const s of SPECS.filter((x) => !x.name.startsWith('gif/') && !x.name.startsWith('png/'))) {
  const base = s.name.split('/').pop();
  const meta = j(join(here, 'out', 'meta', `${base}.json`));
  const v = j(join(here, 'out', 'meta', `${base}.verify.json`));
  const e = j(join(here, 'out', 'meta', `${base}.extra.json`));
  const o = j(join(R2, `${base}.verify.json`));
  if (!v) continue;
  const fps = meta.doc.fps;
  const film = `${v.video.size.replace('x', '×')}, ${fps}, ${+(v.video.frames / fps).toFixed(3)}`;
  if (!v.audio) {
    rows.push(`| ${base} | ${film} | ${meta.painted}/${meta.frames} | ${v.video.start} + ${v.video.duration} | no sound track | | | | | | | | ${meta.ms} |`);
    continue;
  }
  const off = [v.decoded.diffSamples, e.avfoundation.vsExpected, e.afconvert.vsExpected, e.afinfo.validVsExpected].join(', ');
  const lag = [v.lagFfmpeg?.lag, v.lagAVFoundation?.lag, e.afconvert.lag?.lag].join(' / ');
  const lufs = `${neg(v.meter.lufs)} / ${neg(v.appMeterOnDecoded.lufs)}`;
  const tp = `${neg(v.meter.truePeak)} / ${neg(v.appMeterOnDecoded.truePeak)}`;
  const was = o?.meter ? `${neg(o.meter.lufs)}, ${neg(o.meter.truePeak)}` : 'new';
  const edges = `${v.edges.firstMsPeak} / ${v.edges.lastMsPeak}`;
  rows.push(`| ${base} | ${film} | ${meta.painted}/${meta.frames} | ${v.video.start} + ${v.video.duration} | ${v.audio.start} + ${v.audio.duration} | ${off} | ${lag} | ${lufs} | ${tp} | ${was} | ${v.clipped + e.afconvert.clipped + e.avfoundation.clipped} | ${sgn(v.stereo.lrDb)} (${v.stereo.correlation}) | ${edges} | ${meta.ms} |`);
}
console.log('| film | size, fps, s | painted / frames | video start + length (s) | sound start + length (s) | decoded − expected samples (ffmpeg, AVFoundation, afconvert, afinfo) | lag (ffmpeg / AVF / afconvert) | LUFS (ffmpeg meter / app meter) | true peak dBTP (ffmpeg / app) | R2: LUFS, dBTP | clipped samples (3 decoders) | L − R dB (correlation) | first / last ms peak | export ms |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) console.log(r);
