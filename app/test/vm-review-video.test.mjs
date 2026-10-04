// Adversarial review of package `video` of docs/VM.md (docs/vm/review-video.md): the film holds graphics from
// the Motion studio. What the builder's own checks (vm-video.test.mjs) did not try, in order:
//
//   1. The model's side: a held graphic's id and a graphic's start on top are not "numbers the person gave" —
//      a stat the model invents from the digits of an id is refused like any other; no prompt carries a held
//      graphic's layers, measured with twelve held graphics; what a reply can and cannot do to a graphic scene.
//   2. Hostile stored films: ids named like prototype keys, two held graphics under one id, a scene naming an id of
//      another type, starts on top that are strings, NaN, negative or huge, graphics whose seconds and fps are
//      0, NaN, Infinity, negative or 1e9, twelve graphics of 1.4 MB each read in one go, a 10,000-entry list.
//   3. Time: a graphic on top keeps the start the film will have after it is read again, when its scene is made
//      shorter; a fitted film keeps the graphic's own clock; the clock at a transition's overlap.
//   4. Undo, duplicate, move and the length of a film: pruning never lets go of a graphic something still uses.
//   5. The interface, drawn with react-dom/server: the rows in the four languages, hostile titles, and a film
//      that never uses the feature.
//
// The exports in the app's own WebKit (transitions, loop, formats, overlays over every kind of scene, Arabic and
// Sorani, 4K) are in docs/vm/review-video.md; they need the off-screen host and are not part of this chain.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  MAX_GRAPHIC_CHARS, MAX_HELD, addMotionScene, heldDoc, heldIn, hold, motionsInUse, overAt, overTime, pruneMotions,
  readVideoMotions, sceneTime, setOver,
} from '../.test-build/videomotion.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { fitted, newVideo, sanitizeScene, planPrompt, scenePrompt, designPrompt, artPrompt, sceneFrames } from '../.test-build/video.js';
import { applyOps, chatPrompt } from '../.test-build/videochatops.js';
import { narrationPrompt } from '../.test-build/videomix.js';
import { duplicateScene, moveScene, recorded, redone, snapshotOf, undone, emptyHistory } from '../.test-build/videohistory.js';
import { fitSeconds } from '../.test-build/videotemplates.js';

const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const info = (s) => console.log(`  info  ${s}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let n = 0;
const newId = () => `r${++n}`;
/** Ids handed out in order, then fresh ones: the first a placing asks for is the held graphic's. */
const ids = (...xs) => () => xs.shift() ?? newId();

const graphic = (recipe, o = {}) => buildMotion({ id: o.id ?? `m-${recipe}`, recipe, lang: o.lang ?? 'en', format: o.format ?? 'landscape', now: o.now ?? 1000, seconds: o.seconds, fields: o.fields });
const LOWER = graphic('lower-third', { fields: { name: 'ZEBRAFINCH Aziz', role: 'QUOKKA of design' } });
const TITLE = graphic('big-title', { seconds: 4, fields: { title: 'PANGOLIN title', subtitle: 'AXOLOTL words' } });

const film = (o = {}) => ({
  ...newVideo({ id: 'v1', now: 1000, request: 'a promo for the clinic', lang: 'en', format: 'landscape', style: 'modern', seconds: 20 }),
  title: 'Clinic promo',
  stage: 'ready',
  scenes: [
    { id: 's1', kind: 'title', title: 'A clinic that listens', seconds: 3, transition: 'fade' },
    { id: 's2', kind: 'kinetic', text: 'Care close to home.', seconds: 4, transition: 'fade' },
    { id: 's3', kind: 'outro', headline: 'The clinic', cta: 'Call us', seconds: 3, transition: 'none' },
  ],
  ...o,
});
const skipped = (r, why) => r.changes.some((c) => c.what === 'skipped' && c.why === why);

// ── 1. the model's side ───────────────────────────────────────────────────

console.log('The model: the facts rule');
{
  // The held graphic's id is 770055aabbcc (the first id a placing asks for), and a graphic sits on scene 2 from 1.5 s.
  let v = film();
  v = { ...v, ...addMotionScene(v, LOWER, ids('770055aabbcc', 'scene-m')).patch };
  v = { ...v, ...setOver(v, 's2', TITLE, 1.5, ids('4040bbccddee')).patch };
  ok('(the fixture holds two graphics, under the ids it was given)', !!heldIn(v, '770055aabbcc') && !!heldIn(v, '4040bbccddee') && v.scenes[1].over.at === 1.5);
  const stat = (value) => applyOps(v, [{ op: 'add_scene', scene: { kind: 'stat', value, label: 'patients a year' } }], newId);
  ok('a stat the model invents is refused (the control)', skipped(stat(4242), 'unsourced'));
  ok('a stat made of the digits of a held graphic\'s id is refused too: an id is not a number the person gave', skipped(stat(770055), 'unsourced'), stat(770055).changes);
  ok('…nor are the digits of a graphic on top\'s id', skipped(stat(4040), 'unsourced'), stat(4040).changes);
  ok('…nor the second a graphic on top starts at', skipped(stat(1.5), 'unsourced'), stat(1.5).changes);
  const big = applyOps(v, [{ op: 'add_scene', scene: { kind: 'bigtype', lines: ['770055 happy patients'] } }], newId);
  ok('…nor a poster that states it', skipped(big, 'unsourced'), big.changes);
  // A number the storyboard does state is still known: the rule is not tightened past what it was.
  const kept = applyOps(film({ scenes: [...film().scenes.slice(0, 2), { id: 'st', kind: 'stat', value: 120, label: 'beds', seconds: 3, transition: 'fade' }, film().scenes[2]] }),
    [{ op: 'add_scene', scene: { kind: 'stat', value: 120, label: 'beds, again' } }], newId);
  ok('a number a scene already states is still one the model may use', !skipped(kept, 'unsourced'), kept.changes);

  // Found here, from before this package: a clip scene's id and its start second are not facts either.
  const clipFilm = film({
    clips: [{ id: '313377aa00bb', src: 'data:video/mp4;base64,AAAA', seconds: 20, width: 640, height: 360, hasAudio: false, title: 'c', author: 'a', sourceUrl: 'https://example.com/v', site: 'Example' }],
    scenes: [...film().scenes.slice(0, 2), { id: 'cl', kind: 'clip', clip: '313377aa00bb', from: 17, seconds: 3, transition: 'fade' }, film().scenes[2]],
  });
  const cs = (value) => applyOps(clipFilm, [{ op: 'add_scene', scene: { kind: 'stat', value, label: 'x' } }], newId);
  ok('a stat made of a clip\'s id is refused', skipped(cs(313377), 'unsourced'), cs(313377).changes);
  ok('…and of the second the clip starts from', skipped(cs(17), 'unsourced'), cs(17).changes);
}

// The tail of the file is added below, section by section.
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
