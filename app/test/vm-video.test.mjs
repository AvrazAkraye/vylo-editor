// Work package `video` of docs/VM.md: the film holds graphics from the Motion studio.
//
// What is checked, in order:
//
//   1. Placing a graphic: it is copied into the film (read by Motion's own reader), held once however often it is
//      placed (`from` + `stamp`), a changed one is a second copy only when it is placed again, the scene starts as
//      long as the graphic inside a scene's 2 to 20 seconds and goes before the close, at most MAX_HELD are held
//      (room is made only from graphics no scene uses), and a graphic over 1.5 MB is refused.
//   2. Change, Graphic on top (Add / Change / Remove / Starts at), Update from Motion (in place, for every scene).
//   3. The graphic's clock: a scene from its start, held at the last frame or repeated; an overlay from `at`, once.
//   4. The reader: hostile and old films — junk docs, a cycle, a 5 MB title, 5,000 held graphics, a scene naming a
//      graphic the film does not hold — and a fuzz; the views' cached read.
//   5. Undo: removing the last scene that uses a graphic does not let go of it, so undo finds it; the next read does.
//   6. The model's side: a reply keeps a held graphic and an overlay through an edit, a redo and a translation,
//      never makes one up, and never sees a graphic's layers.
//   7. Size: a portrait graphic in a landscape film keeps its proportions; painting at the film's size is fast
//      enough for the player (Node, recording canvas; the WebKit numbers are in docs/vm/video.md).
import { makeCanvas } from './motioncanvas.mjs';
import {
  MAX_GRAPHIC_CHARS, MAX_HELD, addMotionScene, changeSceneMotion, clearOver, freshId, graphicChars, heldCopyOf, heldDoc,
  heldIn, hold, motionsInUse, newerSaved, overAt, overTime, pruneMotions, readOver, readVideoMotions, sceneSecondsFor,
  sceneTime, setOver, updateHeld,
} from '../.test-build/videomotion.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { makeEnv, layerBox, paint } from '../.test-build/motiondraw.js';
import {
  blankScene, fitted, mainTextOf, newVideo, parseScene, planPrompt, readingSeconds, sanitizeScene, scenePrompt,
} from '../.test-build/video.js';
import { applyOps, chatPrompt } from '../.test-build/videochatops.js';
import { srtOf, wordsOf } from '../.test-build/videoexport.js';
import { recorded, snapshotOf, undone, emptyHistory } from '../.test-build/videohistory.js';

const SLOW = process.env.CI ? 4 : 1; // a shared runner is several times slower than the machine that releases; budgets stay strict here
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const info = (s) => console.log(`  info  ${s}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Deep-frozen, so a function that edits its input in place throws. */
function frozen(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.values(x).forEach(frozen);
    Object.freeze(x);
  }
  return x;
}

let n = 0;
const newId = () => `id${++n}`;

// ── fixtures ──────────────────────────────────────────────────────────────

/** A saved graphic as `loadMotions` hands it over: built from a template, read. */
const graphic = (recipe, o = {}) => buildMotion({ id: o.id ?? `m-${recipe}`, recipe, lang: o.lang ?? 'en', format: o.format ?? 'landscape', now: o.now ?? 1000, seconds: o.seconds, fields: o.fields });
const LOWER = graphic('lower-third', { fields: { name: 'ZEBRAFINCH Aziz', role: 'Head of design' } });
const NUMBER = graphic('big-number', { format: 'portrait' });
const TITLE = graphic('big-title', { seconds: 4 });

const film = (o = {}) => frozen({
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

// ── 1. placing a graphic ──────────────────────────────────────────────────

{
  const v = film();
  const r = addMotionScene(v, LOWER, newId);
  ok('a graphic is placed as a scene of its own', !('refused' in r) && r.patch.scenes.length === 4 && r.patch.motions.length === 1, r);
  const s = r.patch.scenes.find((x) => x.id === r.sceneId);
  ok('…before the close, which stays last', r.patch.scenes[2] === s && r.patch.scenes[3].kind === 'outro');
  ok('…a motion scene naming the held copy', s.kind === 'motion' && s.motion === r.patch.motions[0].id && s.transition === 'fade');
  ok('…as long as the graphic (5 s)', s.seconds === 5, s.seconds);
  const held = r.patch.motions[0];
  ok('the held copy remembers which saved graphic it was and as of when', held.from === LOWER.id && held.stamp === LOWER.updated && held.title === LOWER.title);
  ok('…and is what Motion\'s reader makes of it', same(held.doc, readMotion(LOWER, LOWER.updated)));
  ok('the film given is not changed', v.scenes.length === 3 && v.motions === undefined);

  // Placing the same graphic again holds it once.
  const v2 = { ...v, ...r.patch };
  const again = addMotionScene(v2, LOWER, newId);
  ok('the same graphic placed twice is held once', again.patch.motions.length === 1 && again.patch.motions[0] === held);
  ok('…and both scenes play it', again.patch.scenes.filter((x) => x.kind === 'motion' && x.motion === held.id).length === 2);
  ok('heldCopyOf finds it by Motion id and stamp', heldCopyOf(v2, LOWER) === held && heldCopyOf(v2, { id: LOWER.id, updated: 2 }) === undefined);

  // A changed saved graphic is a second copy, and only when placed.
  const changed = { ...LOWER, updated: 5000, title: 'Lower third, changed' };
  const third = addMotionScene(v2, changed, newId);
  ok('a graphic changed in Motion and placed again is a second copy', third.patch.motions.length === 2 && third.patch.motions[0] === held && third.patch.motions[1].stamp === 5000);
  ok('…and the scenes placed before still play the first', third.patch.scenes.filter((x) => x.motion === held.id).length === 1);

  // Lengths.
  ok('a one-second graphic gets a scene of two (the least a scene may last)', sceneSecondsFor({ seconds: 1 }) === 2);
  ok('a thirty-second graphic gets twenty (the most)', sceneSecondsFor({ seconds: 30 }) === 20);
  ok('lengths are in tenths', sceneSecondsFor({ seconds: 6.25 }) === 6.3);
  ok('a length that is not a number is the least', sceneSecondsFor({ seconds: NaN }) === 2 && sceneSecondsFor(null) === 2);
  ok('a film with no close gets the scene at its end', addMotionScene(film({ scenes: [v.scenes[0]] }), TITLE, newId).patch.scenes[1].kind === 'motion');
  ok('a film with no scenes gets one', addMotionScene(film({ scenes: [] }), TITLE, newId).patch.scenes.length === 1);
}

{
  // Refusals: not a graphic, too large, too many.
  const v = film();
  ok('something that is not a graphic is refused, not placed', same(hold(v, 'not a graphic', newId), { refused: 'unreadable' }) && same(hold(v, null, newId), { refused: 'unreadable' }));
  const big = { ...LOWER, id: 'm-big', layers: [...LOWER.layers, { id: 'pic', kind: 'image', name: 'Photo', start: 0, end: 5, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1, src: `data:image/png;base64,${'A'.repeat(1_600_000)}`, w: 30, h: 20, fit: 'cover', radius: 0 }] };
  ok('the big fixture really carries its picture through the reader', readMotion(big).layers.some((l) => l.kind === 'image' && l.src.length > 1_500_000));
  ok('a graphic over 1.5 MB is refused', same(addMotionScene(v, big, newId), { refused: 'big' }));
  ok('…the limit is 1.5 million characters of JSON', MAX_GRAPHIC_CHARS === 1_500_000 && graphicChars(readMotion(big)) > MAX_GRAPHIC_CHARS && graphicChars(LOWER) < MAX_GRAPHIC_CHARS);
  const cyc = {}; cyc.self = cyc;
  ok('a graphic that cannot be written as JSON is of no size a film takes', graphicChars(cyc) === Infinity);
  // A film the store has not read again may hold anything in its list: placing a graphic still works.
  const junky = film({ motions: [null, 'x', 7, [], { id: 'ok1', title: 'T', doc: LOWER, from: LOWER.id, stamp: LOWER.updated }] });
  const r0 = addMotionScene(junky, LOWER, newId);
  ok('a film holding junk in its list still takes a graphic, and finds the copy it already holds', !('refused' in r0) && r0.patch.motions.length === 1 && r0.patch.motions[0].id === 'ok1');
  ok('…Graphic on top and Change do not throw on it either', !('refused' in setOver(junky, 's2', TITLE, 0, newId)) && !('refused' in changeSceneMotion(junky, 's2', TITLE, newId)));

  // Twelve in use: the thirteenth is refused.
  let f = film();
  for (let i = 0; i < MAX_HELD; i++) {
    const r = addMotionScene(f, graphic('big-title', { id: `g${i}`, now: 2000 + i }), newId);
    f = { ...f, ...r.patch };
  }
  ok(`a film holds ${MAX_HELD}`, f.motions.length === MAX_HELD && MAX_HELD === 12);
  ok('…and the next one is refused while every one is in use', same(addMotionScene(f, graphic('big-title', { id: 'g13' }), newId), { refused: 'full' }));
  ok('…a graphic it holds already is still placed (held once)', !('refused' in addMotionScene(f, graphic('big-title', { id: 'g3', now: 2003 }), newId)));
  // A scene removed this session leaves its graphic held; room is made from such graphics, and only from them.
  const removed = { ...f, scenes: f.scenes.filter((s) => s.motion !== f.motions[0].id) };
  const r = addMotionScene(removed, graphic('big-title', { id: 'g13' }), newId);
  ok('…with one no scene uses any more, room is made by letting that one go', !('refused' in r) && r.patch.motions.length === MAX_HELD && !r.patch.motions.some((m) => m.id === f.motions[0].id));
}

// ── 2. Change, Graphic on top, Update ─────────────────────────────────────

{
  const placed = addMotionScene(film(), LOWER, newId);
  const v = frozen({ ...film(), ...placed.patch });
  const ch = changeSceneMotion(v, placed.sceneId, TITLE, newId);
  const s = ch.patch.scenes.find((x) => x.id === placed.sceneId);
  ok('Change: the scene plays the other graphic, and lasts as long as it', s.motion !== placed.patch.motions[0].id && heldIn(ch.patch, s.motion).from === TITLE.id && s.seconds === 4);
  ok('…the graphic it played stays held until the film is next read (an undo may want it back)', ch.patch.motions.length === 2);
  ok('…other scenes are the same objects', ch.patch.scenes.filter((x) => x.id !== placed.sceneId).every((x, i) => x === v.scenes.filter((y) => y.id !== placed.sceneId)[i]));
  ok('Change on a scene that is not a graphic changes nothing', changeSceneMotion(v, 's2', TITLE, newId).patch.scenes.find((x) => x.id === 's2') === v.scenes[1]);

  const on = setOver(v, 's2', LOWER, 1.5, newId);
  const s2 = on.patch.scenes.find((x) => x.id === 's2');
  ok('Graphic on top → Add: the scene carries it from 1.5 s', same(s2.over, { motion: placed.patch.motions[0].id, at: 1.5 }), s2.over);
  ok('…the same graphic is held once', on.patch.motions.length === 1);
  ok('…not on a scene that is a graphic itself', setOver(v, placed.sceneId, LOWER, 0, newId).patch.scenes.find((x) => x.id === placed.sceneId).over === undefined);
  const v2 = frozen({ ...v, ...on.patch });
  const swapped = setOver(v2, 's2', TITLE, undefined, newId).patch;
  const swap = swapped.scenes.find((x) => x.id === 's2');
  ok('…Change keeps its start', swap.over.at === 1.5 && heldIn(swapped, swap.over.motion).from === TITLE.id);
  const off = clearOver(v2.scenes, 's2');
  ok('…Remove takes it off, and nothing else', !('over' in off.find((x) => x.id === 's2')) && off.filter((x) => x.id !== 's2').every((x, i) => x === v2.scenes.filter((y) => y.id !== 's2')[i]));
  ok('Starts at: a tenth of a second at a time, inside the scene', overAt(1.234, 4) === 1.2 && overAt(9, 4) === 3.5 && overAt(-2, 4) === 0 && overAt('x', 4) === 0 && overAt(3) === 3);

  // Update from Motion.
  const held = v2.motions[0];
  const newer = { ...LOWER, updated: 9000, title: 'The new lower third' };
  ok('the saved graphic, changed since it was placed, is offered', newerSaved(held, [TITLE, newer]) === newer);
  ok('…not while the copy is current', newerSaved(held, [LOWER]) === undefined);
  ok('…not when it was deleted in Motion', newerSaved(held, [TITLE]) === undefined);
  ok('…not for a held graphic that names no saved one', newerSaved({ ...held, from: undefined }, [newer]) === undefined && newerSaved(undefined, [newer]) === undefined);
  const up = updateHeld(v2, held.id, newer);
  ok('Update replaces the held copy in place, under the same id', up.motions.length === 1 && up.motions[0].id === held.id && up.motions[0].stamp === 9000 && up.motions[0].title === 'The new lower third');
  const v3 = { ...v2, ...up };
  ok('…so the scene and the overlay that use it both play the new one', heldIn(v3, v3.scenes.find((x) => x.kind === 'motion').motion).doc.updated === 9000 && heldIn(v3, v3.scenes.find((x) => x.id === 's2').over.motion).doc.updated === 9000);
  ok('…and a graphic that is too large now is refused, the old copy kept', same(updateHeld(v2, held.id, { ...newer, layers: [{ id: 'p', kind: 'image', start: 0, end: 1, src: `data:image/jpeg;base64,${'B'.repeat(1_600_000)}` }] }), { refused: 'big' }));
  ok('…one the film does not hold is not updated', same(updateHeld(v2, 'nope', newer), { refused: 'unreadable' }));
}

// ── 3. the graphic's clock ────────────────────────────────────────────────

{
  const doc = { seconds: 5, fps: 30 };
  ok('a scene shows the graphic from its start', sceneTime(0, 30, doc) === 0 && sceneTime(30, 30, doc) === 1 && sceneTime(75, 30, doc) === 2.5);
  ok('past its end the last frame holds (not drawn at the end itself)', Math.abs(sceneTime(150, 30, doc) - (5 - 1 / 30)) < 1e-9 && sceneTime(600, 30, doc) === sceneTime(150, 30, doc));
  ok('…the last frame of a 24 fps graphic is its own', Math.abs(sceneTime(999, 30, { seconds: 2, fps: 24 }) - (2 - 1 / 24)) < 1e-9);
  ok('with Repeat it plays again from its start', Math.abs(sceneTime(165, 30, doc, true) - 0.5) < 1e-9 && sceneTime(150, 30, doc, true) === 0);
  ok('a graphic longer than its scene is cut where the scene ends (its time runs on until then)', sceneTime(119, 30, { seconds: 30, fps: 30 }) < 4);
  ok('a graphic of no length, or a broken one, shows its first frame', sceneTime(90, 30, { seconds: 0, fps: 30 }) === 0 && sceneTime(90, 30, { seconds: NaN }) === 0 && sceneTime(90, 30, {}) === 0);
  ok('a one-frame graphic shows that frame throughout', sceneTime(0, 30, { seconds: 1 / 30, fps: 30 }) === 0 && sceneTime(300, 30, { seconds: 1 / 30, fps: 30 }) === 0);
  ok('frames that are not numbers, or before the start, are the start', sceneTime(NaN, 30, doc) === 0 && sceneTime(-5, 30, doc) === 0 && sceneTime(30, 0, doc) === 1);

  ok('an overlay is off before its start', overTime(44, 30, 1.5, doc) === null && overTime(0, 30, 1.5, doc) === null);
  ok('…on from it, on its own clock', overTime(45, 30, 1.5, doc) === 0 && overTime(75, 30, 1.5, doc) === 1);
  ok('…and off once it has played: once, not held over the rest of the scene', overTime(45 + 149, 30, 1.5, doc) !== null && overTime(45 + 150, 30, 1.5, doc) === null);
  ok('…no start is the scene\'s start; a broken one too', overTime(0, 30, undefined, doc) === 0 && overTime(0, 30, NaN, doc) === 0 && overTime(0, 30, -3, doc) === 0);
  ok('…a graphic of no length is never on', overTime(0, 30, 0, { seconds: 0 }) === null);
}

// ── 4. the reader ─────────────────────────────────────────────────────────

{
  const plain = film();
  ok('a film with no graphics is read as it is (the same object)', readVideoMotions(plain) === plain);
  ok('not a film: returned as it is', readVideoMotions(null) === null && readVideoMotions('x') === 'x');

  const placed = addMotionScene(film(), LOWER, newId);
  const good = { ...film(), ...placed.patch };
  const withOver = { ...good, scenes: good.scenes.map((s) => (s.id === 's2' ? { ...s, over: { motion: good.motions[0].id, at: 2 } } : s)) };
  const read = readVideoMotions(JSON.parse(JSON.stringify(withOver)));
  ok('a good film reads back with its graphic, scene and overlay', read.motions.length === 1 && read.scenes.length === 4 && same(read.scenes[1].over, { motion: good.motions[0].id, at: 2 }));
  ok('…its graphic read by Motion\'s reader', same(read.motions[0].doc, readMotion(LOWER, LOWER.updated)));

  const gone = readVideoMotions({ ...withOver, motions: [] });
  ok('a scene naming a graphic the film does not hold is dropped, as a clip scene without its clip', gone.scenes.length === 3 && !gone.scenes.some((s) => s.kind === 'motion'));
  ok('…and an overlay naming one is taken off its scene', !('over' in gone.scenes[1]) && gone.scenes[1].text === 'Care close to home.');
  ok('…and the film holds none', !('motions' in gone));

  const unused = readVideoMotions({ ...good, motions: [...good.motions, { ...good.motions[0], id: 'spare' }] });
  ok('a graphic no scene uses is let go when the film is read', unused.motions.length === 1 && unused.motions[0].id === good.motions[0].id);

  const hostile = {
    ...withOver,
    motions: [
      { id: good.motions[0].id, title: 'T'.repeat(5_000_000), from: 'x'.repeat(500), stamp: -4, doc: good.motions[0].doc },
      { id: '../../etc', doc: LOWER }, 'junk', null, 42, { id: 'n', doc: 'not a graphic' },
    ],
    scenes: [
      ...withOver.scenes,
      { id: 'h1', kind: 'motion', motion: 'n', seconds: 3, transition: 'fade' },
      { id: 'h2', kind: 'motion', motion: good.motions[0].id, loop: 'yes', seconds: 3, transition: 'fade' },
      { id: 'h3', kind: 'kinetic', text: 'x', seconds: 3, transition: 'fade', over: { motion: good.motions[0].id, at: 1e9 } },
      { id: 'h4', kind: 'kinetic', text: 'y', seconds: 3, transition: 'fade', over: 'everything' },
      { id: 'h5', kind: 'motion', motion: { $gt: '' }, seconds: 3, transition: 'fade' },
      { id: 'h6', kind: 'motion', motion: good.motions[0].id, seconds: 3, transition: 'fade', over: { motion: good.motions[0].id } },
    ],
  };
  const h = readVideoMotions(hostile);
  ok('a 5 MB title is capped by Motion\'s title reader', h.motions[0].title.length <= 120, h.motions[0].title.length);
  ok('…an overlong source id is dropped, a negative stamp too', !('from' in h.motions[0]) && !('stamp' in h.motions[0]));
  ok('…an id with path characters is not an id; junk entries are skipped', h.motions.length === 1);
  ok('…a scene whose graphic is not a graphic is dropped, and one naming an object', !h.scenes.some((s) => s.id === 'h1' || s.id === 'h5'));
  ok('…Repeat is kept only as true', h.scenes.find((s) => s.id === 'h2') && !('loop' in h.scenes.find((s) => s.id === 'h2')));
  ok('…an overlay\'s start is held inside its scene', h.scenes.find((s) => s.id === 'h3').over.at === 2.5);
  ok('…an overlay that is not one is taken off', !('over' in h.scenes.find((s) => s.id === 'h4')));
  ok('…and a scene that is a graphic has none on top', h.scenes.find((s) => s.id === 'h6') && !('over' in h.scenes.find((s) => s.id === 'h6')));

  const cyc = { ...LOWER }; cyc.layers = [...LOWER.layers]; cyc.self = cyc;
  const c = readVideoMotions({ ...good, motions: [{ ...good.motions[0], doc: cyc }] });
  ok('a held graphic with a cycle in it is read (the reader keeps only the fields of a graphic)', c.motions?.length === 1 && graphicChars(c.motions[0]) < Infinity);

  // 5,000 held graphics, every one used by a scene.
  const many = [];
  const scenes = [];
  for (let i = 0; i < 5000; i++) {
    many.push({ id: `g${i}`, title: `G${i}`, doc: LOWER });
    scenes.push({ id: `s${i}`, kind: 'motion', motion: `g${i}`, seconds: 2, transition: 'fade' });
  }
  const t0 = performance.now();
  const big = readVideoMotions({ ...film(), motions: many, scenes });
  const ms = performance.now() - t0;
  ok(`a film of 5,000 held graphics keeps ${MAX_HELD}`, big.motions.length === MAX_HELD);
  ok('…and the scenes that play them, dropping the rest', big.scenes.length === MAX_HELD && big.scenes.every((s) => big.motions.some((m) => m.id === s.motion)));
  ok('…in well under a second', ms < 1000 * SLOW, `${ms.toFixed(0)} ms`);
  info(`5,000 held graphics read in ${ms.toFixed(0)} ms`);

  // Five thousand held graphics that are all broken: at most three times MAX_HELD are tried.
  const broken = readVideoMotions({ ...film(), motions: many.map((m) => ({ ...m, doc: { layers: 'no', seconds: 'x' } })), scenes });
  ok('broken graphics read as graphics (Motion repairs what it can) and are capped all the same', broken.motions.length <= MAX_HELD);

  // A graphic too large to hold is not kept.
  const huge = readVideoMotions({ ...good, motions: [{ ...good.motions[0], doc: { ...LOWER, layers: [{ id: 'p', kind: 'image', start: 0, end: 1, src: `data:image/png;base64,${'A'.repeat(1_600_000)}` }] } }] });
  ok('a held graphic larger than 1.5 MB is not kept, and its scene goes with it', !huge.motions && !huge.scenes.some((s) => s.kind === 'motion'));

  // readOver alone.
  const ids = new Set(['a1']);
  ok('readOver keeps a held graphic, with its start', same(readOver({ motion: 'a1', at: 1 }, ids, 5), { motion: 'a1', at: 1 }) && same(readOver({ motion: 'a1' }, ids), { motion: 'a1' }));
  ok('…and nothing else', [null, 'a1', { motion: 'b' }, { motion: 1 }, [], { at: 1 }].every((x) => readOver(x, ids) === undefined));

  // The views' read, cached per held object.
  const heldOne = good.motions[0];
  const d1 = heldDoc(heldOne);
  ok('the views read a held graphic once and reuse it', d1 && heldDoc(heldOne) === d1);
  ok('…a held entry that is not one is null, every time', heldDoc({ id: 'x', doc: 'no' }) === null && heldDoc(null) === null && heldDoc({ id: 'bad id!', doc: LOWER }) === null);
}

{
  // Fuzz: whatever a stored film holds, the reader returns one whose every reference is held.
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const junk = (d = 0) => {
    const r = rnd();
    if (d > 3 || r < 0.2) return pick([null, undefined, 0, -1, 1e308, NaN, '', 'x', 'g1', true, '<script>', '‮evil']);
    if (r < 0.4) return Array.from({ length: Math.floor(rnd() * 4) }, () => junk(d + 1));
    const o = {};
    for (const k of ['id', 'kind', 'motion', 'over', 'at', 'loop', 'doc', 'title', 'from', 'stamp', 'seconds', 'layers']) if (rnd() < 0.4) o[k] = junk(d + 1);
    return o;
  };
  let threw = 0, bad = 0;
  for (let i = 0; i < 1500; i++) {
    const motions = rnd() < 0.2 ? junk() : Array.from({ length: Math.floor(rnd() * 6) }, () => (rnd() < 0.5 ? { id: pick(['g1', 'g2', 'g3']), title: junk(), doc: rnd() < 0.5 ? LOWER : junk() } : junk()));
    const scenes = Array.from({ length: Math.floor(rnd() * 6) }, () => (rnd() < 0.5
      ? { id: `s${i}`, kind: pick(['motion', 'kinetic', 'title']), motion: pick(['g1', 'g2', 'g3', 7, null]), over: rnd() < 0.5 ? { motion: pick(['g1', 'g2', 'zz']), at: junk() } : junk(), seconds: 3, transition: 'fade', loop: junk() }
      : junk()));
    try {
      const out = readVideoMotions({ ...film(), motions, scenes });
      const held = new Set((out.motions ?? []).map((m) => m.id));
      const okRefs = out.scenes.every((s) => !s || typeof s !== 'object' || ((s.kind !== 'motion' || held.has(s.motion)) && (s.over === undefined || held.has(s.over.motion))));
      const okDocs = (out.motions ?? []).every((m) => m.doc && Array.isArray(m.doc.layers) && graphicChars(m.doc) <= MAX_GRAPHIC_CHARS && typeof m.title === 'string');
      const okLoop = out.scenes.every((s) => !s || s.kind !== 'motion' || s.loop === undefined || s.loop === true);
      if (!okRefs || !okDocs || !okLoop || (out.motions ?? []).length > MAX_HELD) bad++;
    } catch {
      threw++;
    }
  }
  ok('fuzz: the reader never throws on 1,500 junk films', threw === 0, threw);
  ok('fuzz: every scene and overlay it keeps names a graphic it holds; every graphic it holds is read and within size', bad === 0, bad);
}

// ── 5. undo ───────────────────────────────────────────────────────────────

{
  const placed = addMotionScene(film(), LOWER, newId);
  const v = { ...film(), ...placed.patch };
  // The storyboard removes a scene by handing up the scene list alone (onScenes): the held graphic stays.
  const after = { ...v, scenes: v.scenes.filter((s) => s.id !== placed.sceneId) };
  let h = recorded(emptyHistory(), snapshotOf(v), snapshotOf(after), 1);
  const back = undone(h, snapshotOf(after));
  const restored = { ...after, ...back.snapshot };
  const s = restored.scenes.find((x) => x.id === placed.sceneId);
  ok('removing the last scene that uses a graphic, then undo: the scene is back', !!s);
  ok('…and its graphic is still held, so it draws', !!heldIn(restored, s.motion) && !!heldDoc(heldIn(restored, s.motion)));
  ok('…undo gives back the held graphics with the scenes (videohistory tracks them: docs/vm/requests/video.md, item 3)', 'motions' in back.snapshot && back.snapshot.motions === v.motions);
  ok('the next read of the film without the scene lets go of the graphic (pruneMotions)', !readVideoMotions(after).motions && pruneMotions(after).motions === undefined);
  ok('pruneMotions keeps the film as it is when every graphic is used', pruneMotions(v) === v);
  const contrast = { ...pruneMotions(after), ...back.snapshot };
  ok('(and so even after a read let the graphic go, the scene undo brings back has its graphic to play)', !!heldIn(contrast, s.motion));
  ok('motionsInUse sees scenes and overlays', same([...motionsInUse({ scenes: [{ kind: 'motion', motion: 'a' }, { kind: 'title', over: { motion: 'b' } }, null] })], ['a', 'b']));
}

// "Update from Motion" is one undo step now that the history tracks the held graphics.
{
  const placed = addMotionScene(film(), LOWER, newId);
  const v = { ...film(), ...placed.patch };
  const held = v.motions[0];
  const up = updateHeld(v, held.id, { ...LOWER, title: 'Newer title', updated: (LOWER.updated ?? 0) + 5 });
  const after = { ...v, motions: up.motions };
  const h = recorded(emptyHistory(), snapshotOf(v), snapshotOf(after), 1);
  ok('Update from Motion is recorded as a step', h.past.length === 1);
  const back = undone(h, snapshotOf(after));
  ok('…and undo gives back the copy the film held before', !!back && back.snapshot.motions === v.motions);
}

// ── 6. the model's side ───────────────────────────────────────────────────

{
  const placed = addMotionScene(film(), LOWER, newId);
  let v = { ...film(), ...placed.patch };
  v = frozen({ ...v, ...setOver(v, 's2', TITLE, 1, newId).patch });
  const heldLower = v.motions[0];
  const heldTitle = v.motions[1];

  // sanitizeScene, which every reply goes through.
  ok('a reply may keep a scene that plays a held graphic', sanitizeScene({ kind: 'motion', motion: heldLower.id, seconds: 4, loop: true }, v, newId)?.motion === heldLower.id);
  ok('…with Repeat only as true', sanitizeScene({ kind: 'motion', motion: heldLower.id, loop: 'yes' }, v, newId).loop === undefined);
  ok('…but never make one up: an id the film does not hold, a number, a title', [heldLower.id + 'x', 1, heldLower.title, null].every((m) => sanitizeScene({ kind: 'motion', motion: m }, v, newId) === null));
  ok('…nor bring one in the reply itself', sanitizeScene({ kind: 'motion', motion: 'fresh', doc: LOWER }, v, newId) === null);
  const k = sanitizeScene({ kind: 'kinetic', text: 'Hello there', over: { motion: heldTitle.id, at: 2 } }, v, newId);
  ok('a reply cannot put a graphic on top of a scene, even one the film holds', k.text === 'Hello there' && k.over === undefined);
  const added = applyOps(v, [{ op: 'add_scene', after: 1, scene: { kind: 'kinetic', text: 'New words here', over: { motion: heldTitle.id } } }], newId);
  ok('…nor through add_scene', added.next.scenes.length === v.scenes.length + 1 && added.next.scenes.every((s) => s.id === 's2' || !s.over), added.changes);
  const moved = applyOps(v, [{ op: 'edit_scene', scene: 2, fields: { text: 'Other words now', over: null } }, { op: 'edit_scene', scene: 1, fields: { over: { motion: heldTitle.id } } }], newId);
  ok('…and an edit can neither remove nor move one', same(moved.next.scenes.find((s) => s.id === 's2').over, v.scenes[1].over) && moved.next.scenes.find((s) => s.id === 's1').over === undefined, moved.next.scenes.map((s) => s.over));

  // A chat edit of a scene's words keeps its overlay; one of a motion scene's seconds keeps the graphic.
  const edited = applyOps(v, [{ op: 'edit_scene', scene: 2, fields: { text: 'Care, right next door.' } }], newId);
  const s2 = edited.next.scenes.find((s) => s.id === 's2');
  ok('a chat edit of a scene\'s words keeps the graphic on top', s2.text === 'Care, right next door.' && same(s2.over, v.scenes[1].over), s2);
  const at = v.scenes.findIndex((s) => s.kind === 'motion') + 1;
  const longer = applyOps(v, [{ op: 'edit_scene', scene: at, fields: { seconds: 7 } }], newId);
  const ms = longer.next.scenes?.find((s) => s.kind === 'motion');
  ok('a chat edit of a graphic scene\'s seconds keeps its graphic', ms?.seconds === 7 && ms.motion === heldLower.id, longer.changes);
  const timed = applyOps(v, [{ op: 'set_seconds', scene: at, seconds: 6 }, { op: 'set_transition', scene: at, transition: 'zoom' }], newId);
  ok('set_seconds and set_transition work on a graphic scene', timed.next.scenes[at - 1].seconds === 6 && timed.next.scenes[at - 1].transition === 'zoom');

  // A translation: a graphic scene has no words of the film's, and its id is not one.
  const tr = applyOps(v, [
    { op: 'set_language', lang: 'ckb' },
    { op: 'edit_scene', scene: 1, fields: { title: 'کلینیکێک کە گوێ دەگرێت' } },
    { op: 'edit_scene', scene: 2, fields: { text: 'چاودێری لە نزیک ماڵەوە.' } },
    { op: 'edit_scene', scene: 4, fields: { headline: 'کلینیکەکە', cta: 'پەیوەندیمان پێوە بکە' } },
  ], newId);
  ok('a translation is not blocked by a graphic\'s scene or a graphic on top (their ids are not words)', tr.next.lang === 'ckb', tr.changes);
  ok('…and the graphic on top survives it', same(tr.next.scenes[1].over, v.scenes[1].over));

  // A redo keeps the person's graphic on top.
  const redo = parseScene('{"kind":"bullets","heading":"Why us","points":["Close","Kind"]}', v.scenes[1], v, newId);
  ok('a scene written again by the model keeps the graphic the person put on top', redo.kind === 'bullets' && same(redo.over, v.scenes[1].over));

  // The model is never sent a graphic's layers.
  const prompts = [chatPrompt(v, [], 'make it shorter'), planPrompt(v), scenePrompt(v, 1, 'shorter')].map((p) => p.system + '\n' + p.user).join('\n');
  ok('no prompt carries a held graphic\'s words, layers or palette', !prompts.includes('ZEBRAFINCH') && !prompts.includes('"layers"') && !prompts.includes('"palette"') && !prompts.includes('Head of design'));
  ok('…the chat sees the scene as a graphic placed by the person, by id', prompts.includes(`"motion":"${heldLower.id}"`) && prompts.includes('a graphic the person made in Motion'));
  ok('…and the overlay as the person\'s', prompts.includes('with a graphic from Motion on top that the person placed'));

  // The other places a kind is counted.
  ok('a graphic scene starts readable, like a clip (a few seconds)', readingSeconds({ kind: 'motion', motion: 'x', seconds: 3 }) > 2 && readingSeconds({ kind: 'motion', motion: 'x', seconds: 3 }) < 3);
  ok('it has no words for the film\'s emphasis', mainTextOf({ kind: 'motion', motion: 'x' }) === '');
  ok('…nor subtitles of its own', same(wordsOf({ kind: 'motion', motion: 'x' }, v), []) && typeof srtOf(v) === 'string');
  const blank = blankScene('motion', v, newId);
  ok('a blank graphic scene plays the first held graphic, as long as it', blank.kind === 'motion' && blank.motion === heldLower.id && blank.seconds === 5);
  ok('…and with none held it names none (the storyboard offers the list instead)', blankScene('motion', film(), newId).motion === '');
  ok('fitting a film to a length keeps graphic scenes', fitted(v.scenes, { seconds: 30 }).filter((s) => s.kind === 'motion').length === 1);
}

// ── 7. size and speed ─────────────────────────────────────────────────────

{
  // A portrait graphic in a landscape film: a 40u circle stays a circle, sized by the film's short side.
  const doc = readMotion({ id: 'p', format: 'portrait', seconds: 3, backdrop: null, layers: [{ id: 'c', kind: 'shape', shape: 'ellipse', w: 40, h: 40, pin: 'mc', start: 0, end: 3, fill: 'accent' }] });
  const { ctx } = makeCanvas(1920, 1080);
  const box = layerBox(makeEnv(ctx, doc, 1, 1920, 1080), doc.layers[0]);
  ok('a portrait graphic in a landscape film is not stretched (40u x 40u is square, 432 px)', Math.abs(box.w - box.h) < 1e-6 && Math.abs(box.w - 432) < 1e-6, box);
  ok('…and sits where its pin says, the frame\'s centre', Math.abs(box.cx - 960) < 1e-6 && Math.abs(box.cy - 540) < 1e-6, box);
  const sq = layerBox(makeEnv(ctx, doc, 1, 1080, 1920), doc.layers[0]);
  ok('…the same in a portrait film', Math.abs(sq.w - 432) < 1e-6 && Math.abs(sq.cy - 960) < 1e-6);

  // Painting at the film's size every frame, as the preview does.
  const recipes = ['big-title', 'lower-third', 'big-number', 'bar-chart', 'logo-reveal', 'loop-bg', 'kinetic', 'intro'];
  const times = [];
  for (const recipe of recipes) {
    const d = graphic(recipe);
    const c = makeCanvas(1920, 1080);
    paint(c.ctx, d, 0.5, { width: 1920, height: 1080 }); // caches warm, as after the first frame
    const frames = 45;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) paint(c.ctx, d, sceneTime(f * 3, 30, d), { width: 1920, height: 1080 });
    const per = (performance.now() - t0) / frames;
    times.push(per);
    info(`paint ${recipe} at 1920 x 1080 (recording canvas): ${per.toFixed(2)} ms a frame`);
    ok(`painting ${recipe} at the film's size leaves room for 30 frames a second`, per < 8 * SLOW, `${per.toFixed(1)} ms`);
  }
  info(`mean ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2)} ms a frame over ${recipes.length} templates`);
  ok('freshId makes ids the film does not have', [...Array(50)].map(() => freshId(new Set(['a']))).every((x) => /^[0-9a-f]{12}$/.test(x)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
