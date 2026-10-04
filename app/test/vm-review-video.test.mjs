// Adversarial review of package `video` of docs/VM.md (docs/vm/review-video.md): the film holds graphics from
// the Motion studio. What the builder's own checks (vm-video.test.mjs) did not try, in order:
//
//   1. The model's side: a held graphic's id and a graphic's start on top are not "numbers the person gave" —
//      a stat the model invents from the digits of an id is refused like any other; no prompt carries a held
//      graphic's layers, measured with twelve held graphics; what a reply can and cannot do to a graphic scene.
//   2. Hostile stored films: ids named like prototype keys, two held graphics under one id, a scene naming an id of
//      another type, starts on top that are strings, NaN, negative or huge, graphics whose seconds and fps are
//      0, NaN, Infinity, negative or 1e9, twelve graphics of 1.4 MB each read in one go, a 10,000-entry list.
//   3. Undo, duplicate, move and the length of a film: pruning never lets go of a graphic something still uses, and a
//      fitted film keeps the graphic's own clock.
//   4. Time: a graphic on top keeps the start the film will have after it is read again, when its scene is made
//      shorter.
//   5. The interface, drawn with react-dom/server: the rows in the four languages, hostile titles, and a film
//      that never uses the feature.
//
// The exports in the app's own WebKit (nine transitions, loop, formats, graphics on top over every kind of scene,
// Arabic and Sorani against Motion's own paint, 4K, a graphic whose paint throws, posters, the player's frame rate)
// are in docs/vm/review-video.md; they need the off-screen host and are not part of this chain.
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  MAX_GRAPHIC_CHARS, MAX_HELD, addMotionScene, heldDoc, heldIn, hold, motionsInUse, overAt, overTime, pruneMotions,
  readVideoMotions, sceneSecondsFor, sceneTime, setOver,
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

console.log('The model: twelve held graphics, and what a reply can do to a graphic scene');
{
  let v = film({ seconds: 60 });
  const before = [chatPrompt(v, [], 'make it shorter'), planPrompt(v), scenePrompt(v, 1, 'shorter'), designPrompt(v), artPrompt(v), narrationPrompt(v)].map((p) => (p.system + p.user).length);
  const recipes = ['lower-third', 'big-title', 'big-number', 'bar-chart', 'logo-reveal', 'kinetic', 'intro', 'big-title', 'lower-third', 'big-number', 'kinetic', 'intro'];
  for (let i = 0; i < MAX_HELD; i++) {
    const d = graphic(recipes[i], { id: `g${i}`, now: 100 + i, fields: { title: `ZEBRAFINCH${i}`, name: `ZEBRAFINCH${i}`, role: `QUOKKA${i}` } });
    const r = i % 2 ? setOver(v, 's2', d, 1, newId) : addMotionScene(v, d, newId);
    v = { ...v, ...r.patch };
  }
  ok(`(the film holds ${MAX_HELD} graphics: six scenes, and graphics on top changed six times)`, v.motions.length === MAX_HELD);
  const prompts = [chatPrompt(v, [], 'make it shorter'), planPrompt(v), scenePrompt(v, 1, 'shorter'), designPrompt(v), artPrompt(v), narrationPrompt(v)];
  const all = prompts.map((p) => p.system + p.user).join('\n');
  ok('no prompt — chat, plan, redo, design, art, narration — carries a held graphic\'s words or layers', !/ZEBRAFINCH|QUOKKA/.test(all) && !all.includes('"layers"') && !all.includes('"palette"'));
  const grew = prompts.map((p, i) => (p.system + p.user).length - before[i]);
  const held = JSON.stringify(v.motions).length;
  info(`prompts grew by ${grew.join(', ')} characters (chat, plan, redo, design, art, narration) for ${MAX_HELD} held graphics of ${held} characters`);
  ok('…and grow by a line a graphic scene, never by the graphics: the chat prompt by under 200 characters a graphic', grew[0] < 200 * MAX_HELD && Math.max(...grew) < held / 20, grew);

  // What a reply can do to a scene that plays a graphic (by the exact ids the storyboard shows it).
  const at = v.scenes.findIndex((s) => s.kind === 'motion');
  const other = v.motions.find((m) => m.id !== v.scenes[at].motion && v.scenes.some((s) => s.kind === 'motion' && s.motion === m.id)).id;
  const moves = applyOps(v, [{ op: 'duplicate_scene', scene: at + 1 }, { op: 'move_scene', scene: at + 1, to: 1 }, { op: 'set_seconds', scene: at + 1, seconds: 9 }, { op: 'set_length', seconds: 30 }], newId);
  ok('a reply can duplicate, move and time a graphic scene, and fit the film to a length, keeping every graphic it plays',
    !moves.changes.some((c) => c.what === 'skipped') && [...motionsInUse({ scenes: moves.next.scenes })].every((id) => heldIn(v, id)) && motionsInUse({ scenes: moves.next.scenes }).size === motionsInUse(v).size, moves.changes);
  ok('…and its answer never carries the held graphics (only scenes): nothing a reply does writes Video.motions', !('motions' in moves.next));
  const none = applyOps(v, [{ op: 'add_scene', scene: { kind: 'motion' } }, { op: 'add_scene', scene: { kind: 'motion', motion: 'ffffffffffff' } }, { op: 'add_scene', scene: { kind: 'motion', motion: 'ZEBRAFINCH0' } }], newId);
  ok('a graphic scene for a graphic the film does not hold is dropped (no id, an unknown id, a graphic\'s title)', none.changes.every((c) => c.what === 'skipped'), none.changes);
  const swap = applyOps(v, [{ op: 'edit_scene', scene: at + 1, fields: { motion: other } }], newId);
  info(`judgement: an edit_scene may point a graphic scene at another graphic the film holds (${swap.next.scenes?.[at]?.motion === other ? 'it does' : 'it does not'}) — the note says only its seconds and transition are the model's`);
}

// ── 2. hostile stored films ───────────────────────────────────────────────

console.log('Hostile stored films');
{
  const base = film();
  // Ids named like the keys of an object's prototype: every structure keyed by id is a Map, a Set or a find.
  const proto = JSON.parse(`{"motions":[{"id":"__proto__","title":"P","doc":${JSON.stringify(LOWER)}},{"id":"constructor","title":"C","doc":${JSON.stringify(TITLE)}}],
    "scenes":[{"id":"a","kind":"motion","motion":"__proto__","seconds":3,"transition":"fade"},{"id":"b","kind":"kinetic","text":"x","seconds":3,"transition":"fade","over":{"motion":"constructor","at":1}},
      {"id":"c","kind":"motion","motion":"hasOwnProperty","seconds":3,"transition":"fade"},{"id":"d","kind":"kinetic","text":"y","seconds":3,"transition":"fade","over":{"motion":"toString"}}]}`);
  const p = readVideoMotions({ ...base, ...proto });
  ok('graphics held as "__proto__" and "constructor" read like any other, and play', same(p.motions.map((m) => m.id), ['__proto__', 'constructor']) && heldDoc(heldIn(p, '__proto__'))?.title === LOWER.title && heldDoc(heldIn(p, 'constructor'))?.title === TITLE.title);
  ok('…a scene or an overlay naming "hasOwnProperty" or "toString", which the film does not hold, goes', !p.scenes.some((s) => s.id === 'c') && !('over' in p.scenes.find((s) => s.id === 'd')));
  ok('…and nothing leaked onto Object.prototype', ({}).title === undefined && Object.getPrototypeOf(p) === Object.prototype && Object.getPrototypeOf(p.motions[0]) === Object.prototype);

  // Two held graphics under one id: the reader and the views agree on which one plays (the first).
  const two = { ...base, motions: [{ id: 'dd', title: 'First', doc: LOWER }, { id: 'dd', title: 'Second', doc: TITLE }], scenes: [{ id: 's', kind: 'motion', motion: 'dd', seconds: 3, transition: 'fade' }] };
  const r2 = readVideoMotions(two);
  ok('two held graphics with one id: the reader keeps the first, and the views before any read play the first too', r2.motions.length === 1 && r2.motions[0].title === 'First' && heldIn(two, 'dd').title === 'First');

  // A scene naming an id of another type.
  const typed = readVideoMotions({ ...base, motions: [{ id: '7', title: 'Seven', doc: LOWER }], scenes: [{ id: 'n', kind: 'motion', motion: 7, seconds: 3, transition: 'fade' }, { id: 'k', kind: 'kinetic', text: 'z', seconds: 3, transition: 'fade', over: { motion: ['7'] } }] });
  ok('a scene naming the number 7 or an overlay naming ["7"] is not the graphic held as "7"', !typed.scenes.some((s) => s.id === 'n') && !('over' in typed.scenes.find((s) => s.id === 'k')) && !typed.motions);

  // A graphic on top whose start is a string, NaN, negative, huge, an object.
  const starts = ['2', NaN, -4, 1e12, Infinity, null, {}, [1], '1e3'];
  const read = starts.map((at) => readVideoMotions({ ...base, motions: [{ id: 'o', title: 'o', doc: LOWER }], scenes: [{ id: 's', kind: 'kinetic', text: 'x', seconds: 3, transition: 'fade', over: { motion: 'o', at } }] }).scenes[0].over);
  ok('a start on top that is not a number reads as the scene\'s start; a huge one as the latest the scene allows', read.every((o) => o && o.motion === 'o' && (o.at === undefined || (o.at >= 0 && o.at <= 2.5))) && read[3].at === 2.5, read);
  const doc = heldDoc({ id: 'o', title: 'o', doc: LOWER });
  ok('…and the view\'s clock never throws or goes past the graphic on any of them', starts.every((at) => [0, 45, 89, 1e9].every((f) => { const t = overTime(f, 30, at, doc, 3); return t === null || (t >= 0 && t < doc.seconds); })));

  // A graphic whose seconds and fps are 0, NaN, Infinity, negative or 1e9.
  let bad = 0;
  for (const seconds of [0, NaN, Infinity, -5, 1e9, '7', null]) {
    for (const fps of [0, NaN, Infinity, -30, 1e9]) {
      const d = readMotion({ ...LOWER, seconds, fps });
      const scene = sceneSecondsFor(d);
      const times = [0, 30, 1e6, -1].flatMap((f) => [sceneTime(f, 30, d), sceneTime(f, 30, d, true), overTime(f, 30, 0, d, 3) ?? 0]);
      if (!d || !(d.seconds >= 1 && d.seconds <= 30) || !(d.fps > 0 && d.fps <= 120) || !(scene >= 2 && scene <= 20) || !times.every((t) => Number.isFinite(t) && t >= 0 && t < d.seconds)) bad++;
    }
  }
  ok('a graphic of 0, NaN, Infinity, negative or 1e9 seconds or fps is read into range, and its clock stays inside it', bad === 0, bad);

  // Twelve graphics of 1.4 MB each, the most a film may hold, read in one go — the store reads every film this way.
  const heavy = (i) => ({ ...LOWER, id: `h${i}`, layers: [...LOWER.layers, { id: 'pic', kind: 'image', name: 'P', start: 0, end: 5, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1, src: `data:image/png;base64,${'A'.repeat(1_400_000 + i)}`, w: 30, h: 20, fit: 'cover', radius: 0 }] });
  const motions = [];
  const scenes = [];
  for (let i = 0; i < MAX_HELD; i++) {
    motions.push({ id: `g${i}`, title: 'G', doc: heavy(i) });
    scenes.push({ id: `s${i}`, kind: 'motion', motion: `g${i}`, seconds: 3, transition: 'fade' });
  }
  const stored = JSON.parse(JSON.stringify({ ...base, motions, scenes }));
  const t0 = performance.now();
  const hr = readVideoMotions(stored);
  const ms = performance.now() - t0;
  info(`twelve graphics of 1.4 MB read in ${ms.toFixed(0)} ms`);
  ok('a film of twelve 1.4 MB graphics keeps them all, in well under half a second', hr.motions.length === MAX_HELD && hr.motions.every((m) => m.doc.layers.some((l) => l.kind === 'image' && l.src.length > 1_400_000)) && ms < 500 * SLOW, `${ms.toFixed(0)} ms`);

  // A list of 10,000 entries whose used graphics sit at the far end.
  const many = Array.from({ length: 10_000 }, (_, i) => ({ id: `x${i}`, title: 't', doc: { layers: [] } }));
  const usedLate = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, kind: 'motion', motion: `x${9999 - i}`, seconds: 3, transition: 'fade' }));
  const t1 = performance.now();
  const lr = readVideoMotions({ ...base, motions: many, scenes: usedLate });
  const ms2 = performance.now() - t1;
  ok('a 10,000-entry list is read in well under a second, keeping at most twelve', (lr.motions?.length ?? 0) <= MAX_HELD && lr.scenes.every((s) => s.kind !== 'motion' || heldIn(lr, s.motion)) && ms2 < 1000 * SLOW, `${ms2.toFixed(0)} ms`);

  // The store reads every film through checked() inside one try: one hostile film must not throw and empty the list.
  let threw = 0;
  for (const x of [{ ...base, motions: 'x', scenes: [{ kind: 'motion' }, null, 7, 'x', { over: { motion: { toString: 1 } } }] }, { ...base, scenes: [{ kind: 'motion', motion: '__proto__' }], motions: [{ id: '__proto__', doc: null }] }, { ...base, motions: [{ id: 'a', doc: { layers: Array.from({ length: 10_000 }, () => ({ kind: 'text', text: 'x'.repeat(10_000) })) } }], scenes: [{ id: 's', kind: 'motion', motion: 'a', seconds: 3 }] }]) {
    try { readVideoMotions(x); } catch { threw++; }
  }
  ok('the reader throws on none of the store\'s hostile records (one throw would empty the whole list of videos)', threw === 0, threw);
}

// ── 3. undo, duplicate, move, length ──────────────────────────────────────

console.log('Undo, redo, duplicate, move and the film\'s length');
{
  const v0 = film();
  const add = addMotionScene(v0, LOWER, newId);
  const v1 = { ...v0, ...add.patch };
  let h = recorded(emptyHistory(), snapshotOf(v0), snapshotOf(v1), 1);
  const u = undone(h, snapshotOf(v1));
  const back = { ...v1, ...u.snapshot };
  ok('add a graphic scene, undo: the scene is gone and so is the copy', back.scenes.length === 3 && back.motions === undefined);
  const rd = redone(u.history, snapshotOf(back));
  const again = { ...back, ...rd.snapshot };
  ok('…redo: both are back, the same objects', again.scenes === v1.scenes && again.motions === v1.motions);

  // Duplicate and move by hand (the timeline's D and Alt+arrow), then the next read: nothing used is let go.
  const at = v1.scenes.findIndex((s) => s.kind === 'motion');
  const dup = duplicateScene(v1.scenes, at, newId);
  const moved = moveScene(dup, at + 1, 0);
  const v2 = { ...v1, scenes: moved };
  ok('a graphic scene duplicated and moved first plays the same held graphic twice', v2.scenes.filter((s) => s.motion === add.patch.motions[0].id).length === 2);
  ok('…and neither pruning nor the next read lets go of it', pruneMotions(v2) === v2 && readVideoMotions(v2).motions?.length === 1 && readVideoMotions(v2).scenes.filter((s) => s.kind === 'motion').length === 2);
  // Remove one of the two: still in use.
  const v3 = { ...v2, scenes: v2.scenes.filter((s, i) => i !== 0) };
  ok('removing one of two scenes that play a graphic keeps it held', pruneMotions(v3) === v3);

  // At the cap: a film of twelve, one no longer used; placing a thirteenth lets that one go — and undo gives it back.
  let f = film();
  for (let i = 0; i < MAX_HELD; i++) f = { ...f, ...addMotionScene(f, graphic('big-title', { id: `c${i}`, now: 3000 + i }), newId).patch };
  const gone = f.scenes.find((s) => s.kind === 'motion');
  const fRemoved = { ...f, scenes: f.scenes.filter((s) => s.id !== gone.id) };
  let hist = recorded(emptyHistory(), snapshotOf(f), snapshotOf(fRemoved), 10);
  const placed = addMotionScene(fRemoved, graphic('big-title', { id: 'c-new', now: 4000 }), newId);
  ok('(a film of twelve with one unused makes room for a new one)', !('refused' in placed) && placed.patch.motions.length === MAX_HELD && !heldIn(placed.patch, gone.motion));
  const fNew = { ...fRemoved, ...placed.patch };
  hist = recorded(hist, snapshotOf(fRemoved), snapshotOf(fNew), 20_000);
  const u1 = undone(hist, snapshotOf(fNew));
  const s1 = { ...fNew, ...u1.snapshot };
  const u2 = undone(u1.history, snapshotOf(s1));
  const s2 = { ...s1, ...u2.snapshot };
  ok('…undo twice: the removed scene is back and the graphic it plays is held again (the history tracks Video.motions)', s2.scenes.some((s) => s.id === gone.id) && !!heldDoc(heldIn(s2, gone.motion)));

  // The film's length: fitted (a plan, the chat's set_length) and a template's fitSeconds keep the graphic scenes and their graphics.
  const fit = fitted(v2.scenes, { seconds: 60 });
  const fit2 = fitSeconds(v2.scenes, 8);
  ok('fitting the film to 60 s or to 8 s keeps every graphic scene and the graphic it plays',
    [fit, fit2].every((sc) => sc.filter((s) => s.kind === 'motion').length === 2 && sc.every((s) => s.kind !== 'motion' || s.motion === add.patch.motions[0].id)));
  const longer = fit.find((s) => s.kind === 'motion');
  const docL = heldDoc(add.patch.motions[0]);
  ok('…and the graphic\'s clock follows the scene\'s frames: past its own end it holds its last frame',
    sceneTime(sceneFrames(longer) - 1, 30, docL) === sceneTime(Math.round(docL.seconds * 30) + 5, 30, docL));
}

// ── 4. time ───────────────────────────────────────────────────────────────

console.log('Time: a graphic on top in a scene made shorter');
{
  // Starts 3.5 s into a 4 s scene; then the scene is made 2 s long — the storyboard's seconds field, the timeline's
  // Shift+arrow and the chat's set_seconds change only `seconds`.
  let v = film();
  v = { ...v, ...setOver(v, 's2', LOWER, 3.5, ids('aa11')).patch };
  ok('(the graphic on top starts at 3.5 s of the 4 s scene)', v.scenes[1].over.at === 3.5);
  const shorter = { ...v, scenes: v.scenes.map((s) => (s.id === 's2' ? { ...s, seconds: 2 } : s)) };
  const read = readVideoMotions(JSON.parse(JSON.stringify(shorter)));
  const doc = heldDoc(heldIn(shorter, 'aa11'));
  const s2 = shorter.scenes[1];
  const r2 = read.scenes[1];
  ok('the film\'s reader keeps the start inside the shorter scene (1.5 s)', r2.over?.at === 1.5, r2.over);
  // What the view draws (VideoMotionView.tsx MotionOverlay): overTime with the scene's own length.
  const shown = (s) => Array.from({ length: sceneFrames(s) }, (_, f) => overTime(f, 30, s.over.at, doc, s.seconds) !== null);
  const now = shown(s2);
  const later = shown(r2);
  ok('…and the film shows the graphic in the same frames now as after it is read again (next start of the app)',
    same(now, later), { now: now.indexOf(true), later: later.indexOf(true) });
  ok('…from 1.5 s, to the end of the scene', later.indexOf(true) === 45 && later.slice(45).every(Boolean));
  ok('overTime without a scene length is as it was (a start is a start)', overTime(45, 30, 3.5, doc) === null && overTime(105, 30, 3.5, doc) === 0);
  const view = readFileSync('src/VideoMotionView.tsx', 'utf8');
  ok('the overlay view hands overTime its scene\'s length', /overTime\(frame, fps, over\.at, doc, scene\.seconds\)/.test(view));
  const row = readFileSync('src/VideoMotionPicker.tsx', 'utf8');
  ok('…and the Starts at field shows the start the film plays, not one past the scene\'s end', /value=\{overAt\(over\.at, scene\.seconds\)\}/.test(row));
}

// ── 5. the interface, drawn ───────────────────────────────────────────────

console.log('The interface, drawn with react-dom/server');
{
  const require = createRequire(import.meta.url);
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  if (!esbuild) ok('esbuild is there to build the rows', false);
  else {
    esbuild.buildSync({
      entryPoints: ['src/VideoMotionPicker.tsx', 'src/VideoStoryboard.tsx', 'src/i18n.ts'], bundle: true, format: 'esm', outdir: '.test-build/vm-review-video', logLevel: 'error',
      external: ['react', 'react-dom', '@tauri-apps/api/core', '@codemirror/state'], jsx: 'automatic',
    });
    const { createElement: h } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MotionSceneRow, OverRow, MotionPicker } = await import('../.test-build/vm-review-video/VideoMotionPicker.js');
    const { Storyboard } = await import('../.test-build/vm-review-video/VideoStoryboard.js');
    const { translator } = await import('../.test-build/vm-review-video/i18n.js');
    const quiet = console.error;
    const render = (el) => { console.error = () => {}; try { return renderToStaticMarkup(el); } finally { console.error = quiet; } };
    const noop = () => {};

    const HOSTILE = [
      '<img src=x onerror="alert(1)">',
      'مرحبا ‮gnp.exe بكم',
      'L'.repeat(4000),
      '',
    ];
    let v = film();
    const placed = addMotionScene(v, LOWER, ids('aaaa00000001', 'mscene'));
    v = { ...v, ...placed.patch };
    v = { ...v, ...setOver(v, 's2', TITLE, 1, ids('bbbb00000002')).patch };
    const ms = v.scenes.find((s) => s.kind === 'motion');
    for (const title of HOSTILE) {
      const hv = { ...v, motions: v.motions.map((m) => ({ ...m, title })) };
      const row = render(h(MotionSceneRow, { t: (s) => s, video: hv, scene: ms, onChange: noop, onVideo: noop }));
      const over = render(h(OverRow, { t: (s) => s, video: hv, scene: hv.scenes[1], onChange: noop, onVideo: noop }));
      ok(`a held title ${JSON.stringify(title.slice(0, 24))}${title.length > 24 ? '…' : ''} is text, never markup, and set in its own direction`,
        !/<img/i.test(row + over) && row.includes('dir="auto"') && over.includes('dir="auto"'));
    }
    const plain = render(h(MotionSceneRow, { t: (s) => s, video: v, scene: ms, onChange: noop, onVideo: noop }));
    ok('the row of a graphic scene: its name, its length, Change and Repeat; no Update while nothing is newer', plain.includes(LOWER.title) && plain.includes('A graphic from Motion, 5 s long.') && plain.includes('>Change<') && plain.includes('Repeat it while the scene lasts') && !plain.includes('Update from Motion'));
    ok('…and no sound sentence for a graphic without a sound of its own', !plain.includes('sound'));
    const loud = { ...v, motions: v.motions.map((m) => ({ ...m, doc: { ...m.doc, sound: { kind: 'sfx', level: 0.8 } } })) };
    const loudRow = render(h(MotionSceneRow, { t: (s) => s, video: loud, scene: ms, onChange: noop, onVideo: noop }));
    info(`a graphic with sound: the sentence is ${loudRow.includes('own sound is not part of the film yet') ? 'shown' : 'not shown (heldDoc reads the sound away or the row hides it)'}`);
    const missing = render(h(MotionSceneRow, { t: (s) => s, video: { ...v, motions: [] }, scene: ms, onChange: noop, onVideo: noop }));
    ok('a graphic scene whose graphic is gone says so, and offers Change to pick another', missing.includes('This graphic is no longer in the film.') && missing.includes('>Change<'));
    const noWay = render(h(OverRow, { t: (s) => s, video: film(), scene: film().scenes[1], onChange: noop }));
    ok('without the panel\'s onVideo, a scene with nothing on top has no Graphic on top row at all', noWay === '');
    const picker = render(h(MotionPicker, { t: (s) => s, title: 'Choose', onPick: () => null, onClose: noop }));
    ok('the list, before the store answers: a status line, the copy sentence and Close', picker.includes('role="status"') && picker.includes('A copy goes into the film') && picker.includes('>Close<'));

    // The four languages: no English sentence of these rows is left untranslated.
    const english = ['Change', 'Repeat it while the scene lasts', 'Graphic on top', 'Remove', 'Starts at (seconds into the scene)', 'It plays once, from that second, over the scene.', 'A copy goes into the film', 'Reading your saved graphics', 'This graphic is no longer in the film.', 'Close'];
    for (const lang of ['ar', 'ckb', 'kmr']) {
      const t = translator(lang);
      const out = [
        render(h(MotionSceneRow, { t, video: v, scene: ms, onChange: noop, onVideo: noop })),
        render(h(MotionSceneRow, { t, video: { ...v, motions: [] }, scene: ms, onChange: noop, onVideo: noop })),
        render(h(OverRow, { t, video: v, scene: v.scenes[1], onChange: noop, onVideo: noop })),
        render(h(MotionPicker, { t, title: t('Choose a graphic for the new scene'), onPick: () => null, onClose: noop })),
      ].join('\n');
      const left = english.filter((e) => out.includes(`>${e}`) || out.includes(`${e}<`));
      ok(`${lang}: every sentence of the rows and the list is in ${lang}`, left.length === 0 && /[؀-ۿ]/.test(out), left);
    }

    // A film that never uses the feature: the storyboard draws exactly as without the panel's onVideo, but for the
    // one entry in the kinds list.
    const f0 = film();
    const without = render(h(Storyboard, { t: (s) => s, video: f0, locked: false, onScenes: noop, onRedo: noop, onSeek: noop, onAdd: noop, onError: noop }));
    const withIt = render(h(Storyboard, { t: (s) => s, video: f0, locked: false, onScenes: noop, onVideo: noop, onRedo: noop, onSeek: noop, onAdd: noop, onError: noop }));
    ok('a film that never uses the feature: the storyboard is the same but for "Motion graphic" in Add scene', withIt.replace('<option value="motion">Motion graphic</option>', '') === without && withIt.includes('<option value="motion">Motion graphic</option>'));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
