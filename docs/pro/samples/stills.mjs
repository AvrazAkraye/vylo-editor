// S1: the decoded sound inside each still stretch (the picture frozen before a transition), R2's film against this one.
//   cd app && node .test-build/s1/stills.mjs
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ffAudio } from './verify.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const OLD = '/Volumes/ExtremeSSD/apps/vylo-pro-samples', NEW = process.env.S1_OUT || '/Volumes/ExtremeSSD/apps/vylo-pro-samples-final';
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');
function at(ch, a, b) {
  let pk = 0, s = 0, n = 0;
  for (const x of ch) for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) { pk = Math.max(pk, Math.abs(x[i])); s += x[i] * x[i]; n++; }
  return `${db(Math.sqrt(s / n))}/${db(pk)}`;
}
for (const name of ['mp4/04-scenes-push-iris-flash', 'mp4/10-plus-scene-push-both', 'mp4/11-four-scenes-effects', 'stress/30s-blur-ten-scenes-both']) {
  const base = name.split('/').pop();
  const stills = JSON.parse(readFileSync(join(here, 'out', 'meta', `${base}.json`), 'utf8')).stills;
  const now = ffAudio(join(NEW, `${name}.mp4`));
  const old = existsSync(join(OLD, `${name}.mp4`)) ? ffAudio(join(OLD, `${name}.mp4`)) : null;
  console.log(base, 'RMS/peak dBFS in each still stretch:', stills.map(([a, b]) => `${a}-${b}s ${old ? `R2 ${at(old, a, b)} -> ` : ''}now ${at(now, a, b)}`).join(' | '));
}
