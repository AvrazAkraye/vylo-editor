// The edits every change to a motion graphic goes through.
//
// What matters. An edit never mutates what it was given (the panel keeps the
// old value for undo, so a mutation is a corrupted history). Whatever a control
// lets through is clamped by the same reader a model's answer goes through, so
// no field can hold a value nothing draws. Editing a layer by hand ends the
// template — the words can no longer be rebuilt over the person's work — while
// the settings that don't depend on the layout leave the link alone. And a
// template graphic rebuilt for another shape, language or length keeps what
// the person chose and every layer's id, so their selection survives.
import {
  addLayer, detach, duplicateLayer, isAttached, moveLayer, removeLayer, setBackdrop, setFields, setFormat, setFps, setLang,
  setLayer, setPalette, setSeconds, setTitle,
} from '../.test-build/motionedit.js';
import { blankLayer } from '../.test-build/motionread.js';
import { META } from '../.test-build/motionrecipe.js';
import { buildMotion, RECIPES } from '../.test-build/motiontemplates.js';
import { LIMITS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** Freeze a value all the way down, so a mutation throws in strict mode. */
function freeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
}

const NOW = 1_700_000_000_000;

// A graphic edited by hand: no template behind it.
const hand = freeze({
  id: 'g1', title: 'Hand', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6,
  palette: { bg: '#000000', fg: '#FFFFFF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#888888' }, backdrop: 'bg', stage: 'ready', created: 1, updated: 1,
  layers: [
    blankLayer('text', { id: 'a', name: 'Title', text: 'Hello', start: 0, end: 6 }),
    blankLayer('shape', { id: 'b', name: 'Bar', start: 1, end: 4 }),
    blankLayer('backdrop', { id: 'c', name: 'Back', start: 0, end: 6 }),
  ],
});

// ── setLayer ──────────────────────────────────────────────────────────────
{
  const next = setLayer(hand, 'a', { text: 'Hi', opacity: 5, x: 9999, rot: 'nope' }, NOW);
  const a = next.layers.find((l) => l.id === 'a');
  ok('a field is changed', a.text === 'Hi');
  ok('and clamped by the reader: opacity 5 is 1', a.opacity === 1);
  ok('an offset beyond reach is brought back', Math.abs(a.x) <= LIMITS.reach);
  ok('junk in a number field falls back, it does not stay', Number.isFinite(a.rot));
  ok('the layer keeps its id even if the patch names another', setLayer(hand, 'a', { id: 'zzz' }, NOW).layers.some((l) => l.id === 'a'));
  ok('the input is untouched (it is frozen, so a mutation would have thrown)', hand.layers[0].text === 'Hello');
  ok('updated is stamped', next.updated === NOW);
  ok('an unknown id changes nothing (same object)', setLayer(hand, 'nope', { text: 'x' }, NOW) === hand);
  ok('a value it already had changes nothing (same object)', setLayer(hand, 'a', { text: 'Hello' }, NOW) === hand);
  ok('other layers are shared, not copied', next.layers[1] === hand.layers[1]);
}

// ── add, remove, duplicate, move ──────────────────────────────────────────
{
  const { motion: m1, id } = addLayer(hand, 'text', {}, NOW);
  ok('a new layer goes on top', m1.layers[m1.layers.length - 1].id === id);
  ok('with an id nothing else has', new Set(m1.layers.map((l) => l.id)).size === m1.layers.length);
  const added = m1.layers.find((l) => l.id === id);
  ok('it runs to the end of the graphic', added.start === 0 && added.end === hand.seconds);
  ok('and arrives with a fade rather than appearing', added.in?.fx === 'fade');
  const { motion: m2, id: bid } = addLayer(hand, 'backdrop', {}, NOW);
  const asked = addLayer(hand, 'shape', { id: 'wanted1' }, NOW);
  ok('a free id the caller asks for is the id the layer gets (a panel selects it before the edit runs)', asked.id === 'wanted1' && asked.motion.layers.some((l) => l.id === 'wanted1'));
  ok('an id already taken, or not an id, is replaced by a fresh one', addLayer(hand, 'shape', { id: 'a' }, NOW).id !== 'a' && addLayer(hand, 'shape', { id: 'not an id!' }, NOW).id !== 'not an id!');
  const dup2 = duplicateLayer(hand, 'a', NOW, 'copy7');
  ok('and so is a copy\'s', dup2.id === 'copy7' && dup2.motion.layers[1].id === 'copy7');
  ok('a background goes to the back', m2.layers[0].id === bid);
  ok('and does not fade in (it is the ground)', m2.layers[0].in === undefined);

  let full = hand;
  for (let i = 0; i < LIMITS.layers + 5; i += 1) full = addLayer(full, 'shape', {}, NOW).motion;
  ok('layers are capped', full.layers.length === LIMITS.layers);
  ok('adding past the cap says nothing was added', addLayer(full, 'text', {}, NOW).id === '');

  ok('remove takes the layer out', removeLayer(hand, 'b', NOW).layers.map((l) => l.id).join() === 'a,c');
  ok('an unknown id removes nothing (same object)', removeLayer(hand, 'nope', NOW) === hand);

  const dup = duplicateLayer(hand, 'a', NOW);
  ok('a copy sits directly above the original', dup.motion.layers[1].id === dup.id && dup.motion.layers[0].id === 'a');
  ok('a little to one side, so it is seen to be a copy', dup.motion.layers[1].x === hand.layers[0].x + 3);
  ok('with its own id', dup.id !== 'a' && dup.id !== '');
  ok('a copy of a locked layer is not locked', duplicateLayer({ ...hand, layers: [{ ...hand.layers[0], locked: true }] }, 'a', NOW).motion.layers[1].locked !== true);

  ok('move to the back', moveLayer(hand, 'c', 0, NOW).layers.map((l) => l.id).join() === 'c,a,b');
  ok('move to the front', moveLayer(hand, 'a', 99, NOW).layers.map((l) => l.id).join() === 'b,c,a');
  ok('a move to where it is changes nothing (same object)', moveLayer(hand, 'a', 0, NOW) === hand);
}

// ── the particle budget holds for hand edits too ──────────────────────────
{
  let m = { ...hand, layers: [] };
  for (let i = 0; i < 6; i += 1) m = addLayer(m, 'particles', { count: 300 }, NOW).motion;
  const counts = m.layers.map((l) => l.count);
  ok('layers added past the document\'s particle budget are cut to what is left', counts.reduce((n, c) => n + c, 0) === LIMITS.particleBudget && counts[0] === 300 && counts[counts.length - 1] === 0, counts);
  const first = m.layers[0].id;
  const lowered = setLayer(m, first, { count: 100 }, NOW);
  ok('lowering one leaves the others as they are', lowered.layers[0].count === 100 && lowered.layers.slice(1).every((l, i) => l.count === counts[i + 1]));
  const raised = setLayer(lowered, m.layers[m.layers.length - 1].id, { count: 300 }, NOW);
  ok('and the room it made can be spent by another, up to the budget', raised.layers.reduce((n, l) => n + l.count, 0) === LIMITS.particleBudget && raised.layers[raised.layers.length - 1].count === 200);
  const again = setLayer(m, m.layers[1].id, { count: 300 }, NOW);
  ok('raising a layer past the budget changes nothing else and cannot exceed it', again === m || again.layers.reduce((n, l) => n + l.count, 0) <= LIMITS.particleBudget);
  ok('a copy is cut to the budget too', duplicateLayer(m, first, NOW).motion.layers.reduce((n, l) => n + l.count, 0) <= LIMITS.particleBudget);
}

// ── settings ──────────────────────────────────────────────────────────────
{
  ok('the title is trimmed and limited', setTitle(hand, `  ${'x'.repeat(500)}\n`, NOW).title.length === LIMITS.title);
  ok('the same title is no change (same object)', setTitle(hand, 'Hand', NOW) === hand);
  ok('fps only takes the three rates', setFps(hand, 25, NOW) === hand && setFps(hand, 60, NOW).fps === 60);
  ok('a palette is repaired token by token', setPalette(hand, { accent: 'not a colour' }, NOW).palette.accent.toLowerCase() === hand.palette.accent.toLowerCase());
  ok('the backdrop can be cleared to transparent', setBackdrop(hand, null, NOW).backdrop === null);

  const longer = setSeconds(hand, 10, NOW);
  ok('a longer graphic: layers that ran to the end run to the new end', longer.layers[0].end === 10 && longer.layers[2].end === 10);
  ok('layers that ended sooner keep their end', longer.layers[1].end === 4);
  const shorter = setSeconds(hand, 3, NOW);
  ok('a shorter one: nothing runs past the end', shorter.layers.every((l) => l.end <= 3 && l.start < l.end));
  ok('length is clamped to the limits', setSeconds(hand, 999, NOW).seconds === LIMITS.seconds && setSeconds(hand, 0, NOW).seconds === LIMITS.minSeconds);
  ok('nonsense length keeps the length', setSeconds(hand, NaN, NOW) === hand);
  ok('a detached graphic changes shape by name only', setFormat(hand, 'portrait', NOW).format === 'portrait' && setFormat(hand, 'portrait', NOW).layers === hand.layers);
  ok('and language', setLang(hand, 'ar', NOW).lang === 'ar');
  ok('fields do nothing on a graphic edited by hand', setFields(hand, { title: 'x' }, NOW) === hand);
  ok('it is not attached', !isAttached(hand));
  ok('detach on a detached graphic is the same object', detach(hand) === hand);
}

// ── a template graphic (needs the recipes) ────────────────────────────────
// Any recipe with a text field will do; use whichever the build has.
const RID = ['big-title', 'lower-third', 'kinetic', 'big-number'].find((id) => RECIPES[id]);
if (RID) {
  const field = META[RID].fields.find((f) => f.kind === 'line' || f.kind === 'text').key;
  const WORDS = 'Dr. Layla Hassan';
  const made = freeze(buildMotion({ id: 'gt', recipe: RID, lang: 'en', format: 'landscape', now: 5 }));
  ok('a template graphic is attached', isAttached(made) && made.recipe.id === RID);
  ok('and has layers', made.layers.length > 0);
  const ids = made.layers.map((l) => l.id);

  const fieldsChanged = setFields(made, { [field]: WORDS }, NOW);
  ok('changing the words rebuilds it', fieldsChanged.layers.some((l) => l.kind === 'text' && l.text.toLowerCase().includes('layla')));
  ok('and it is still attached, with the new words', isAttached(fieldsChanged) && fieldsChanged.recipe.fields[field] === WORDS);
  ok('every layer keeps its id', fieldsChanged.layers.map((l) => l.id).join() === ids.join());
  ok('the id, title, created and rate are the person\'s', fieldsChanged.id === 'gt' && fieldsChanged.created === 5 && fieldsChanged.fps === 30);

  const portrait = setFormat(made, 'portrait', NOW);
  ok('another shape is built for that shape', portrait.format === 'portrait' && portrait.layers.map((l) => l.id).join() === ids.join());
  ok('and the words carry over', portrait.recipe.fields[field] === made.recipe.fields[field]);

  const arabic = setLang(made, 'ar', NOW);
  ok('another language rebuilds and keeps the words', arabic.lang === 'ar' && arabic.recipe.fields[field] === made.recipe.fields[field]);

  const longer = setSeconds(made, 12, NOW);
  ok('a longer template graphic is built for the length', longer.seconds === 12 && longer.layers.every((l) => l.end <= 12));

  const colours = setPalette(made, { accent: '#FF0000' }, NOW);
  ok('a palette change leaves the link alone', isAttached(colours) && colours.palette.accent.toUpperCase() === '#FF0000');
  ok('and so does the title, the rate and the backdrop', isAttached(setTitle(made, 'x', NOW)) && isAttached(setFps(made, 60, NOW)) && isAttached(setBackdrop(made, null, NOW)));

  const target = made.layers.find((l) => l.kind !== 'backdrop') ?? made.layers[0];
  const edited = setLayer(made, target.id, { x: target.x + 5 }, NOW);
  ok('editing a layer by hand ends the template', !isAttached(edited) && edited.recipe === undefined);
  ok('but committing the value a layer already has does not', setLayer(made, target.id, { x: target.x }, NOW) === made && isAttached(made));
  ok('so a later change of words is refused, not destructive', setFields(edited, { [field]: 'x' }, NOW) === edited);
  ok('adding a layer also ends it', !isAttached(addLayer(made, 'text', {}, NOW).motion));
  ok('so does removing one', !isAttached(removeLayer(made, ids[0], NOW)));
  ok('the person\'s palette survives a rebuild', setFields(colours, { [field]: 'Y' }, NOW).palette.accent.toUpperCase() === '#FF0000');
} else {
  console.log('  (no recipe is built yet: the template-graphic checks are skipped)');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
