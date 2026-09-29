// Undo and redo for a motion graphic.
//
// What matters: typing is one step, not one a letter, and so is a drag; a
// layer added, removed or moved is always a step of its own, whatever key it
// carries; a new edit clears redo; an undo never crosses a model run — the
// history starts again when anything but the person changes the graphic — and
// never brings back an old error, stage or clock; the history is capped; and
// nothing is mutated: a step is the very document it was, shared, not copied.
import {
  COALESCE_MS, HISTORY_CAP, canRedo, canUndo, emptyHistory, recorded, redone, sameSnapshot, snapshotOf, synced, undone,
} from '../.test-build/motionhistory.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// Every document and history handed over is frozen, all the way down: this
// file is an ES module, so any write to one inside the history throws here.
const freeze = (x) => {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) freeze(v);
  }
  return x;
};
const layer = (id, o = {}) => ({
  kind: 'text', id, name: '', start: 0, end: 6, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1, text: 'Hello', voice: 'sans', size: 8,
  weight: 700, color: 'fg', align: 'center', lead: 1.15, track: 0, caps: false, max: 0, fit: false, ...o,
});
const motion = (o = {}) => freeze({
  id: 'm1', title: 'Launch', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 6,
  palette: { bg: '#0b1020', fg: '#f5f7ff', accent: '#4c8dff', accent2: '#ff6aa2', muted: '#8a93b2' }, backdrop: 'bg',
  layers: [layer('a'), layer('b'), layer('c')], stage: 'ready', created: 1, updated: 1, ...o,
});
/** The person changes one layer; the panel stamps the clock as it saves. */
const edit = (m, id, change) => freeze({ ...m, layers: m.layers.map((l) => (l.id === id ? { ...l, ...change } : l)), updated: m.updated + 1 });
const rec = (h, next, at, key) => freeze(recorded(h, next, at, key));

ok('typing within a second and a half is one step; a hundred steps are kept', COALESCE_MS === 1500 && HISTORY_CAP === 100);

// ── typing, drags and steps of their own ──────────────────────────────────
console.log('steps');
{
  const m0 = motion();
  let h = freeze(emptyHistory(m0));
  let cur = m0;
  const type = (text, at) => { const next = edit(cur, 'a', { text }); h = rec(h, next, at, 'layer:a:text'); cur = next; };
  type('H', 1000); type('Ha', 1100); type('Hal', 1200); type('Halo', 2600);
  ok('typing with the same key, each letter within the window of the last, is one step', h.past.length === 1, h.past.length);
  ok('and that step goes back to before the first letter — the document itself, not a copy', h.past[0] === m0);
  ok('the history holds the document as it is now', h.present === cur && h.key === 'layer:a:text' && h.at === 2600);
  type('Halo!', 2600 + COALESCE_MS + 1);
  ok('a pause longer than the window starts a new step', h.past.length === 2);
  const drag = (x, at) => { const next = edit(cur, 'b', { x }); h = rec(h, next, at, 'layer:b:xy'); cur = next; };
  for (let i = 1; i <= 50; i++) drag(i, 10000 + i * 16);
  ok('a drag — fifty moves of one layer, 16 ms apart — is one step', h.past.length === 3, h.past.length);
  const other = edit(cur, 'a', { size: 12 });
  h = rec(h, other, 10900, 'layer:a:size');
  cur = other;
  ok('another field is another step, however quick', h.past.length === 4);
  const keyless = edit(cur, 'a', { size: 13 });
  h = rec(h, keyless, 10901);
  cur = keyless;
  const keyless2 = edit(cur, 'a', { size: 14 });
  h = rec(h, keyless2, 10902);
  cur = keyless2;
  ok('an edit with no key is always a step of its own', h.past.length === 6 && h.key === null);
  // With the same key and inside the window, a change to which layers there are still stands alone.
  const typed = edit(cur, 'a', { text: 'x' });
  h = rec(h, typed, 20000, 'layer:a:text');
  cur = typed;
  const removed = freeze({ ...cur, layers: cur.layers.filter((l) => l.id !== 'c') });
  h = rec(h, removed, 20001, 'layer:a:text');
  cur = removed;
  ok('a layer removed is a step of its own, even under the same key', h.past.length === 8, h.past.length);
  const moved = freeze({ ...cur, layers: [cur.layers[1], cur.layers[0]] });
  h = rec(h, moved, 20002, 'layer:a:text');
  cur = moved;
  ok('a layer moved is too', h.past.length === 9);
  const added = freeze({ ...cur, layers: [...cur.layers, layer('d')] });
  h = rec(h, added, 20003, 'layer:a:text');
  cur = added;
  ok('and a layer added', h.past.length === 10);
  ok('a clock that runs backwards never joins a step', rec(h, edit(cur, 'a', { text: 'y' }), 10, 'layer:a:text').past.length === 11);
  ok('an edit that changes nothing the person sees is not a step', rec(h, cur, 30000, 'k') === h
    && rec(h, freeze({ ...cur, updated: 99, stage: 'planning' }), 30000, 'k').past.length === h.past.length);
}

// ── undo and redo ─────────────────────────────────────────────────────────
console.log('undo');
{
  const m0 = motion();
  const m1 = edit(m0, 'a', { text: 'One' });
  const m2 = edit(m1, 'b', { color: 'accent' });
  let h = rec(rec(freeze(emptyHistory(m0)), m1, 1, 'k1'), m2, 5000, 'k2');
  ok('two steps to undo, none to redo', canUndo(h) && !canRedo(h) && h.past.length === 2);
  const u = freeze(undone(h));
  ok('undo gives back the step before', sameSnapshot(u.present, m1) && u.present.layers === m1.layers, u.present.layers[1]);
  ok('and it can be redone', canRedo(u) && u.future.length === 1);
  const r = freeze(redone(u));
  ok('redo puts the edit back', sameSnapshot(r.present, m2) && r.present.layers === m2.layers && !canRedo(r));
  const u2 = freeze(undone(undone(h)));
  ok('undo twice reaches the start, and there it stops', sameSnapshot(u2.present, m0) && !canUndo(u2) && undone(u2) === u2);
  ok('redo with nothing to redo is the same history', redone(h) === h);
  const fresh = edit(u.present, 'c', { text: 'New' });
  const h2 = rec(u, fresh, 9000, 'k3');
  ok('a new edit after an undo clears what could have been redone', !canRedo(h2) && h2.future.length === 0 && h2.past.length === 2);
  // The moment's own fields are the moment's: undo leaves the clock, the stage and the error as they are now.
  const now = freeze({ ...m2, updated: 777, stage: 'ready', error: 'The model did not answer.' });
  const back = undone(freeze({ ...h, present: now }));
  ok('undo keeps the clock, the stage and the error of now', back.present.updated === 777 && back.present.stage === 'ready' && back.present.error === 'The model did not answer.');
  const past = freeze({ ...m0, error: 'An old failure', stage: 'new', updated: 3 });
  let h3 = freeze(emptyHistory(past));
  h3 = rec(h3, freeze({ ...edit(m0, 'a', { text: 'x' }), updated: 50 }), 1, 'k');
  const b3 = undone(h3);
  ok('and never brings back an old error, stage or clock', !('error' in b3.present) && b3.present.stage === 'ready' && b3.present.updated === 50, b3.present);
}

// ── never across a model run ──────────────────────────────────────────────
console.log('model runs');
{
  const m0 = motion();
  const m1 = edit(m0, 'a', { text: 'Mine' });
  const h = rec(freeze(emptyHistory(m0)), m1, 1, 'k');
  const designed = freeze({ ...m1, layers: [layer('x', { text: 'The model\'s' })], ai: true });
  ok('with the document the model replaced, there is nothing to undo', canUndo(h, m1) && !canUndo(h, designed) && !canRedo(h, designed));
  const u = undone(h, designed);
  ok('and asking anyway gives the document as it is and an empty history', u.present === designed && u.past.length === 0 && u.future.length === 0);
  const s = synced(h, designed);
  ok('synced starts the history again from what the run left', s.present === designed && s.past.length === 0);
  const mine = edit(designed, 'x', { text: 'Edited after' });
  const h2 = rec(synced(h, designed), mine, 5, 'k');
  const back = undone(h2);
  ok('an edit after the run undoes to the run\'s result, never to before it', sameSnapshot(back.present, designed) && !canUndo(back));
  const saved = freeze({ ...m1, updated: 99999 });
  ok('saving (a new clock) is not somebody else\'s change', synced(h, saved).past.length === 1 && canUndo(h, saved) && synced(h, saved).present === saved);
  ok('nor is the model starting to work (a new stage)', canUndo(h, freeze({ ...m1, stage: 'planning' })));
  ok('a redo is refused the same way', (() => {
    const hu = freeze(undone(h));
    return canRedo(hu, hu.present) && !canRedo(hu, designed) && redone(hu, designed).present === designed && redone(hu, designed).future.length === 0;
  })());
  ok('another graphic altogether starts a history of its own', !canUndo(h, freeze({ ...m1, id: 'm2' })));
}

// ── what the same graphic is ──────────────────────────────────────────────
console.log('snapshots');
{
  const m = motion();
  ok('the clock, the stage and the error are not the graphic', sameSnapshot(m, freeze({ ...m, updated: 5, stage: 'new', error: 'x' })));
  ok('the same fields in new objects are the same graphic', sameSnapshot(m, JSON.parse(JSON.stringify(m))));
  ok('key order does not matter', sameSnapshot(m, freeze(Object.fromEntries(Object.entries(m).reverse()))));
  ok('a field set to undefined is a field that is not there', sameSnapshot(m, freeze({ ...m, recipe: undefined, ai: undefined })));
  ok('a changed word, colour, layer or palette is another graphic',
    !sameSnapshot(m, edit(m, 'b', { text: 'Other' })) && !sameSnapshot(m, edit(m, 'c', { color: 'accent' }))
    && !sameSnapshot(m, freeze({ ...m, palette: { ...m.palette, accent: '#ffffff' } })) && !sameSnapshot(m, freeze({ ...m, layers: m.layers.slice(1) }))
    && !sameSnapshot(m, freeze({ ...m, ai: true })) && !sameSnapshot(m, freeze({ ...m, seconds: 7 })));
  ok('a gradient against a colour, a list against an object: different, not a crash',
    !sameSnapshot(freeze({ ...m, backdrop: { kind: 'linear', angle: 0, stops: [] } }), m) && !sameSnapshot(freeze({ ...m, layers: {} }), m));
  const loop = { ...m };
  loop.self = loop;
  const loop2 = { ...m };
  loop2.self = loop2;
  let threw = false;
  try { sameSnapshot(loop, loop2); } catch { threw = true; }
  ok('a document with a cycle is compared without overflowing the stack', !threw);
  ok('a snapshot is the document itself when it has no error', snapshotOf(m) === m);
  const withError = freeze({ ...m, error: 'failed' });
  const snap = snapshotOf(withError);
  ok('and the document without the error when it has one, left as it was', !('error' in snap) && withError.error === 'failed' && snap.layers === m.layers);
}

// ── the cap ───────────────────────────────────────────────────────────────
console.log('cap');
{
  let cur = motion();
  const first = [];
  let h = freeze(emptyHistory(cur));
  for (let i = 0; i < HISTORY_CAP + 30; i++) {
    const next = edit(cur, 'a', { text: `step ${i}` });
    first.push(cur);
    h = rec(h, next, i * 10);
    cur = next;
  }
  ok(`at most ${HISTORY_CAP} steps back`, h.past.length === HISTORY_CAP, h.past.length);
  ok('the oldest are the ones let go', h.past[0] === first[30] && h.past[HISTORY_CAP - 1] === first[first.length - 1]);
  let u = h;
  for (let i = 0; i < HISTORY_CAP + 10; i++) u = freeze(undone(u));
  ok(`and at most ${HISTORY_CAP} steps forward`, u.future.length === HISTORY_CAP && u.past.length === 0 && sameSnapshot(u.present, first[30]));
  ok('a picture held by every step is held once: each step shares the unchanged layers', h.past.every((s) => s.layers[1] === h.past[0].layers[1]));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
