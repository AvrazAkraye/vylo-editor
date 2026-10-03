// S1: R2's cuts.mjs for every film with scenes (scratch, git-ignored). Around each scene cut: the largest second
// difference within ±5 ms, against the RMS of the second difference over ±50 ms, in ffmpeg's decode and in the bed.
// A click reads in the tens; R2 measured 0.46 to 4.08.
//   cd app && node .test-build/s1/cuts2.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffAudio, readPlanar } from './verify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES = process.env.S1_OUT || '/Volumes/ExtremeSSD/apps/vylo-pro-samples-final';
const films = ['mp4/04-scenes-push-iris-flash', 'mp4/10-plus-scene-push-both', 'mp4/11-four-scenes-effects', 'stress/30s-blur-ten-scenes-both'];
const out = {};
for (const name of films) {
  const base = name.split('/').pop();
  const meta = JSON.parse(readFileSync(join(here, 'out', 'meta', `${base}.json`), 'utf8'));
  const cuts = meta.doc.scenes.slice(1).map((s) => s.start);
  const bed = join(here, 'out', 'beds', `${base}.bed.f32`);
  out[base] = { cuts };
  for (const [label, ch] of [['decoded', ffAudio(join(SAMPLES, `${name}.mp4`))], ['bed', existsSync(bed) ? readPlanar(bed) : null]]) {
    if (!ch) continue;
    const worst = [];
    for (const t of cuts) {
      let r = 0;
      for (const x of ch) {
        const c = Math.round(t * 48000);
        const d2 = (i) => x[i] - 2 * x[i - 1] + x[i - 2];
        let peak = 0, s = 0, n = 0;
        for (let i = c - 240; i <= c + 240; i++) peak = Math.max(peak, Math.abs(d2(i)));
        for (let i = c - 2400; i <= c + 2400; i++) { s += d2(i) ** 2; n++; }
        // A silent neighbourhood has no second difference at all: no click (ratio 0).
        r = Math.max(r, s > 0 ? peak / Math.sqrt(s / n) : 0);
      }
      worst.push(+r.toFixed(2));
    }
    out[base][label] = worst;
  }
  console.log(base, JSON.stringify(out[base]));
}
