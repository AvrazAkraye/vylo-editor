// Edits under attack (motionedit.ts, and the chat's `layer` op in
// motionchatops.ts; motionhistory.ts): hostile arguments, and edits applied the
// way the panel really applies them — a slider sends one per step of a drag.
//
// What matters: every edit's output is already what the reader would make of
// it (a fixed point), so a graphic does not change when it is next opened; a
// patch cannot turn a layer into another kind; a length slider dragged down and
// back leaves a hand-made graphic as it was; odd numbers are refused rather
// than read as a place in the stack; and the history joins a burst of typing
// into one step and never undoes what the model put there since.
//
// Checks marked "fails today" prove a bug and pass once it is fixed.
import { readFileSync } from 'node:fs';
import {
  addLayer, moveLayer, setFields, setLayer, setSeconds, setTitle,
} from '../.test-build/motionedit.js';
import { readMotion } from '../.test-build/motionread.js';
import { LIMITS } from '../.test-build/motiontypes.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { applyOps } from '../.test-build/motionchatops.js';
import { emptyHistory, undone, canUndo } from '../.test-build/motionhistory.js';
import { recordEdit } from '../.test-build/motionstate.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);
const fixed = (m) => J(readMotion(JSON.parse(J(m)), m.created)) === J(m);
const doc = readMotion({ id: 'd', title: 'Doc', seconds: 6, created: 1, updated: 1, layers: [
  { kind: 'text', id: 'a', text: 'Hello', start: 0, end: 6, in: { fx: 'rise', d: 0.8 }, out: { fx: 'fade', d: 0.5 } },
  { kind: 'shape', id: 'b', start: 2, end: 5, in: { fx: 'pop', d: 1.2 } },
  { kind: 'counter', id: 'c', to: 50, start: 4, end: 6 },
] });

// ── the fixed point, with random numbers ──────────────────────────────────
console.log('fixed point');
{
  let seed = 99;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const f = () => { const r = rnd(); return r < 0.25 ? Math.round(rnd() * 300) / 10 : r < 0.5 ? rnd() * 35 - 2 : r < 0.75 ? 30 - rnd() * 0.1 : rnd() * 0.2; };
  const bad = [];
  for (let i = 0; i < 5000 && bad.length < 3; i++) {
    const a = readMotion({ id: 'x', seconds: f(), layers: [{ kind: 'text', id: 'a', start: f(), end: f(), in: { fx: 'rise', d: f(), delay: f() }, out: { fx: 'fade', d: f() } }] }, 1);
    for (const e of [a, setSeconds(a, f(), 2), setLayer(a, 'a', { start: f(), end: f() }, 2)]) if (!fixed(e)) bad.push(J(e.layers[0]));
  }
  ok('5,000 random times and lengths: the reader, setSeconds and setLayer all give a fixed point', bad.length === 0, bad);
  const odd = setLayer(doc, 'a', { x: NaN, y: -Infinity, scale: '9000', opacity: '-50', rot: 1e308, size: 'big' }, 2);
  const l = odd.layers[0];
  ok('NaN, infinities and words for numbers are clamped or refused', l.x === 0 && l.y === 0 && l.scale === LIMITS.scale && l.opacity === 0 && l.rot === 3600 && l.size === 8 && fixed(odd), l);
  const proto = setLayer(doc, 'a', JSON.parse('{"__proto__":{"kind":"shape"},"constructor":1,"size":12}'), 2);
  ok('"__proto__" and "constructor" in a patch are only words', proto.layers[0].kind === 'text' && proto.layers[0].size === 12);
}

// ── hostile arguments ─────────────────────────────────────────────────────
console.log('hostile arguments');
{
  // Fails today: setLayer spreads the patch over the layer, `kind` included, and reads the result — so a patch
  // with a kind turns the words into a shape (or an empty picture) and the text is gone.
  const kinds = ['shape', 'image', 'backdrop'].map((kind) => setLayer(doc, 'a', { kind }, 2).layers[0].kind);
  ok('a patch cannot change a layer\'s kind', kinds.every((k) => k === 'text'), kinds);
  // Fails today: blankLayer reads a new layer for a 30-second graphic, so addLayer keeps times and entrances past
  // the graphic's end until it is next opened, when they change.
  const late = addLayer(doc, 'text', { start: 20 }, 2).motion;
  const long = addLayer(doc, 'text', { end: 25, in: { fx: 'fade', d: 20 } }, 2).motion;
  ok('a layer added past the end of a 6-second graphic is already inside it', fixed(late) && fixed(long), [late.layers[3], long.layers[3]].map((x) => `${x.start}..${x.end} in.d=${x.in?.d}`));
  // Fails today: Math.round(NaN) is NaN, clamp keeps it, and splice reads NaN as 0 — the layer goes to the back,
  // and even a layer already at the back makes a new graphic (ending its template).
  ok('moving a layer to NaN leaves the stack as it is', moveLayer(doc, 'c', NaN, 2) === doc && moveLayer(doc, 'a', NaN, 2) === doc,
    moveLayer(doc, 'c', NaN, 2).layers.map((x) => x.id));
  // Fails today: setTitle keeps double spaces, tabs, control characters, a trailing space after the cut, decomposed
  // letters and an empty title, all of which the reader changes on the next open.
  const titles = ['a  b', '', 'a\tb', 'x\u0000y', 'x'.repeat(119) + ' y', 'é'].filter((t) => !fixed(setTitle(doc, t, 2)));
  ok('whatever is typed as a title, it is saved as it will be read back', titles.length === 0, titles);
  // Fails today: a value that is not a string is taken as "not given", and the template's example comes back.
  const tpl = buildMotion({ id: 't', recipe: 'big-title', lang: 'en', format: 'landscape', now: 1, fields: { title: 'Our launch' } });
  const kept = [123, null, ['Our', 'launch']].map((v) => setFields(tpl, { title: v }, 2).recipe.fields.title);
  ok('a field set to something that is not words keeps the person\'s words, not the example', kept.every((t) => t === 'Our launch'), kept);
  // Fails today: the default only applies to `undefined`.
  let threw = null;
  try { addLayer(doc, 'text', null, 2); } catch (e) { threw = String(e); }
  ok('addLayer with a null patch adds a layer rather than throwing', threw === null, threw);
  // Fails today: `duration` is added to the patch's start only if `start` came first in the op.
  const r = applyOps(doc, [{ op: 'layer', id: 'a', set: { duration: 2, start: 3 } }], 5);
  const a = r.motion.layers.find((x) => x.id === 'a');
  ok('a chat op that gives duration before start: the layer runs from start for that long', a.start === 3 && a.end === 5, `${a.start}..${a.end}`);
}

// ── the length slider ─────────────────────────────────────────────────────
console.log('length');
{
  // setSeconds moves every layer inside the new length and clamps its entrance to what fits, so it cannot be undone
  // by setting the old length again: on a hand-made 6-second graphic, 6 s → 1 s → 6 s leaves every late layer
  // starting at 0.95 s with a 0.05 s entrance. MotionDesign's range input used to apply it at every step of a drag,
  // each to the last result. It now applies it once, when the drag is let go (the browser's `change` event), from the
  // graphic as it was. The panel cannot run here, so hold its source to that.
  const src = readFileSync(new URL('../src/MotionDesign.tsx', import.meta.url), 'utf8');
  const ranges = [...src.matchAll(/type="range"[\s\S]{0,400}/g)].map((m) => m[0]);
  ok('the length range input does not apply setSeconds at each step of a drag', ranges.length === 1 && !/setSeconds/.test(ranges[0]), ranges);
  ok('the length is applied on the browser\'s change event, the release', /addEventListener\('change'/.test(src));
  ok('a drag that ends where it began is no edit', setSeconds(doc, doc.seconds, 2) === doc);
  const t = buildMotion({ id: 't', recipe: 'lower-third', lang: 'en', format: 'landscape', now: 1 });
  let u = t;
  for (const s of [4, 3, 2, 1, 2, 3, 4, 5]) u = setSeconds(u, s, 2);
  ok('the same drag on a template graphic rebuilds it exactly', J(u.layers) === J(t.layers));
}

// ── history ───────────────────────────────────────────────────────────────
console.log('history');
{
  let h = emptyHistory(doc), d = doc, now = 1000;
  for (let i = 0; i < 1000; i++) { const n = setLayer(d, 'a', { text: 'x'.repeat((i % 400) + 1) }, now); h = recordEdit(h, d, n, now, 'layer:a:text'); d = n; now += 10; }
  ok('1,000 keystrokes 10 ms apart are one step, and one undo gives the words back', h.past.length === 1 && undone(h, d).present.layers[0].text === 'Hello');
  h = emptyHistory(doc); d = doc; now = 0;
  for (let i = 0; i < 250; i++) { const n = setLayer(d, 'a', { text: `z${i}` }, now); h = recordEdit(h, d, n, now); d = n; now += 5000; }
  ok('250 separate edits keep the last 100', h.past.length === 100);
  const mine = setLayer(doc, 'a', { text: 'mine' }, 5);
  const hm = recordEdit(emptyHistory(doc), doc, mine, 5, 'k');
  const model = readMotion({ ...mine, layers: [{ kind: 'text', id: 'm', text: 'model' }] });
  ok('after the model replaces the graphic, there is nothing of the person\'s to undo', !canUndo(hm, model) && undone(hm, model).present.layers[0].text === 'model');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
