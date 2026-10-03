// S1: the cues of the scene films, before and after F2's scene-sound fix, on the very same graphic (scratch).
// "after" is this tree's motionsound (../motionsound.js); "before" is the same file at R2's commit 2758ba7, built into
// before/ (see docs/pro/samples.md). The graphics are the ones the films were made from, dumped by samples.ts dumpDoc.
//   cd app && node .test-build/s1/cuesab.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as after from '../motionsound.js';
import * as before from './before/motionsound.js';
import { sceneHold, sceneList } from '../motionscene.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'out', 'docs');
const fmt = (c) => `${c.kind}${c.rev ? '(rev)' : ''}@${+c.t.toFixed(3)}`;
const key = (c) => `${c.kind}|${c.rev ? 1 : 0}|${c.t.toFixed(4)}`;
const rows = {};
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  const doc = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const list = sceneList(doc);
  const stills = list.slice(0, -1).map((s, i) => (list[i + 1].transition ? [+sceneHold(doc, i).toFixed(3), s.end] : null)).filter(Boolean);
  const a = after.soundCues(doc), b = before.soundCues(doc);
  const inStill = (c) => stills.some(([x, y]) => c.t >= x - 1e-6 && c.t < y);
  const ka = new Set(a.map(key)), kb = new Set(b.map(key));
  // The same graphic joined by cuts: every exit is drawn, so its sounds should be there.
  const cutDoc = { ...doc, scenes: (doc.scenes ?? []).map((s) => { const { transition, ...rest } = s; return rest; }) };
  const cut = after.soundCues(cutDoc);
  rows[f] = {
    stills,
    before: { n: b.length, inStills: b.filter(inStill).map(fmt), music: before.musicCuesOf(doc) },
    after: { n: a.length, inStills: a.filter(inStill).map(fmt), music: after.musicCuesOf(doc) },
    gone: b.filter((c) => !ka.has(key(c))).map(fmt),
    added: a.filter((c) => !kb.has(key(c))).map(fmt),
    joinedByCuts: { n: cut.length, whooshesAtStills: cut.filter(inStill).map(fmt) },
    afterList: a.map(fmt).join(' '),
  };
  console.log(f, JSON.stringify(rows[f], null, 1));
}
