// S1: extra.mjs over every MP4 of the set; results in out/meta/<name>.extra.json (scratch).
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extra } from './extra.mjs';
import { SPECS } from './make.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = process.env.S1_OUT || '/Volumes/ExtremeSSD/apps/vylo-pro-samples-final';
for (const s of SPECS.filter((x) => !x.name.startsWith('gif/') && !x.name.startsWith('png/'))) {
  const base = s.name.split('/').pop();
  const bed = join(here, 'out', 'beds', `${base}.bed.f32`);
  const r = extra(join(SAMPLES, `${s.name}.mp4`), existsSync(bed) ? bed : '', s.fps ?? 30);
  writeFileSync(join(here, 'out', 'meta', `${base}.extra.json`), JSON.stringify(r, null, 1));
  const a = r.afconvert, v = r.avfoundation, i = r.afinfo;
  console.log(base, r.firstPacket.video, r.firstPacket.audio, i ? `afinfo ${i.valid}+${i.priming}+${i.remainder} (${i.validVsExpected})` : 'no audio',
    a ? `| afconvert ${a.vsExpected} lag ${a.lag?.lag} app ${a.appMeter.lufs}/${a.appMeter.truePeak} ff ${a.ffmpegMeter.lufs}/${a.ffmpegMeter.truePeak} clip ${a.clipped} LR ${a.stereo.lrDb} clicks ${a.clicks.length} edges ${a.firstMsPeak}/${a.lastMsPeak}` : '',
    v ? `| AVF ${v.vsExpected} app ${v.appMeter.lufs}/${v.appMeter.truePeak} clip ${v.clipped} LR ${v.stereo.lrDb} corr ${v.stereo.correlation}` : '');
}
