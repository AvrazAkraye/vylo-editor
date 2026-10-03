// Scenes and transitions (pro pass, work package 05): motionscene.ts,
// motiontransition.ts, the scenes hook in motiondraw.ts's `paint`, and the
// strip, MotionScenes.tsx.
//
// What matters, in the order the brief asks for it:
//
//   - A graphic without scenes paints exactly as before: the same recorded
//     draw calls for every one of the eighteen templates, in every shape and
//     language, whether `scenes` is absent, empty, one scene, or cuts with no
//     transition; and a graphic with transitions paints the same as without
//     them everywhere outside a transition and the hold before one.
//   - Every transition at progress 0 draws only the old scene's picture and
//     at 1 only the new one's; progress is monotonic for every curve offered
//     and each kind's own measure of "how much of the new scene" only grows;
//     direction mirrors in right-to-left graphics; everything is seeded, so
//     the same moment is the same calls.
//   - The scene that leaves holds still at its hold moment, and the arriving
//     one plays from its start, on two offscreen canvases that are reused.
//   - `readScenes` enforces the limits and never throws, whatever it is
//     handed, and its result is a fixed point; every edit returns a graphic
//     `readMotion` reads back unchanged, with the layer-timing rules stated in
//     motionscene.ts.
//   - A transition frame costs about two frames (measured and printed).
//   - motionscene.ts reaches neither motiondraw.ts nor motionread.ts at run
//     time, and nothing here sets `ctx.filter`.
//   - The strip renders a lone "+ Scene" for one scene and a chip per scene
//     with transition chips between them for more.
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { makeCanvas, offscreens, FakeOffscreenCanvas } from './motioncanvas.mjs';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { paint } from '../.test-build/motiondraw.js';
import { CORE_RECIPE_IDS, FORMAT_IDS, LANGUAGES, LIMITS, DIRS } from '../.test-build/motiontypes.js';
import { easeOf } from '../.test-build/motionmath.js';
import {
  NEW_SCENE, addScene, canAddScene, canSplitAt, moveScene, paintScenes, primaryTransition, readScenes, removeScene, renameScene,
  sceneAt, sceneHold, sceneList, sceneName, sceneSpan, setTransition, splitSceneAt,
} from '../.test-build/motionscene.js';
import {
  TRANSITIONS, TRANSITION_EASES, TRANSITION_LOOKS, composite, directed, dirOfTransition, easeOfTransition, needsOf, progressOf,
  readTransition, transitionKindOf, travelOf,
} from '../.test-build/motiontransition.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const eq = (name, got, want) => ok(name, Object.is(got, want) || JSON.stringify(got) === JSON.stringify(want), { got, want });
const J = (x) => JSON.stringify(x);
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };

/** A seeded stream for the fuzzing, so a failure can be run again. */
function rand(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A recorded call as something comparable: canvases and gradients by identity and content, never their live recorders. */
function tag(v) {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(tag);
  if (v instanceof FakeOffscreenCanvas) return `canvas#${offscreens.indexOf(v)}`;
  if (typeof v === 'object' && Array.isArray(v.stops) && v.kind) return `gradient:${v.kind}:${J(v.args)}:${J(v.stops)}`;
  if (typeof v === 'object' && Array.isArray(v.ops)) return `path:${v.d ?? ''}:${J(v.ops)}`;
  return typeof v;
}
/** The drawing a list of calls does. `measureText` is left out: it is how a layout is measured, and the layout cache decides how often. */
const sig = (calls) => J(calls.filter((c) => c.name !== 'measureText').map((c) => [c.name, tag(c.args), c.m, c.alpha, c.depth]));

/**
 * Paint `doc` at `t` on a small recording canvas: its signature and its
 * problems. Painted once first, so the layout caches are warm: a text laid out
 * for the first time sets the font to measure it, which is the cache's doing
 * and not the frame's.
 */
function frame(doc, t, scale = 10, o = {}) {
  const [w, h] = SIZES[doc.format];
  const size = [Math.round(w / scale), Math.round(h / scale)];
  paint(makeCanvas(...size).ctx, doc, t, { strict: true, ...o });
  const c = makeCanvas(...size);
  paint(c.ctx, doc, t, { strict: true, ...o });
  return { sig: sig(c.calls), calls: c.calls, problems: c.check() };
}

const plain = (doc) => {
  const d = { ...doc };
  delete d.scenes;
  return d;
};
const tpl = (recipe, lang = 'en', format = 'landscape') => buildMotion({ id: 'x', recipe, fields: {}, lang, format, now: 1 });

// ── a graphic without scenes paints exactly as before ─────────────────────
console.log('without scenes, nothing changes');
{
  const bad = [];
  let frames = 0;
  CORE_RECIPE_IDS.forEach((recipe, r) => {
    const lang = LANGUAGES[r % 4];
    const format = FORMAT_IDS[(r + 1) % 4];
    const m = tpl(recipe, lang, format);
    const cuts = readScenes([{ start: 0 }, { start: m.seconds / 3 }, { start: (2 * m.seconds) / 3 }], m.layers, m.seconds);
    const variants = {
      absent: plain(m),
      empty: { ...m, scenes: [] },
      one: { ...m, scenes: [{ id: 'a', name: 'All', start: 0, end: m.seconds }] },
      'cuts only': { ...m, scenes: cuts },
    };
    for (let k = 0; k < 9; k++) {
      const t = (k / 8) * (m.seconds - 1 / 30);
      frame(m, t);
      const base = frame(m, t);
      frames++;
      if (base.problems.length) bad.push(`${recipe} ${t}: ${base.problems[0]}`);
      for (const [name, v] of Object.entries(variants)) {
        if (frame(v, t).sig !== base.sig) bad.push(`${recipe} at ${t.toFixed(2)}: ${name} differs`);
      }
    }
  });
  ok(`the eighteen templates, nine moments each, draw the same calls with no scenes, empty, one, or cuts only (${frames} frames)`, bad.length === 0, bad.slice(0, 5));
  ok('the cuts-only list read as three scenes, none with a transition', (() => {
    const m = tpl('big-title');
    const s = readScenes([{ start: 0 }, { start: 2 }, { start: 4 }], m.layers, m.seconds);
    return s?.length === 3 && s.every((x) => !x.transition);
  })());
}
{
  // With transitions: the same as without them outside the windows (each transition, and the hold before it).
  const bad = [];
  for (const recipe of CORE_RECIPE_IDS) {
    const m = tpl(recipe);
    let d = splitSceneAt(m, m.seconds / 2, 1);
    d = setTransition(d, d.scenes[1].id, 'iris', 1);
    const cut = d.scenes[1].start;
    const hold = sceneHold(d, 0);
    const tr = d.scenes[1].transition;
    for (let k = 0; k < 12; k++) {
      const t = (k / 12) * m.seconds;
      if (t >= hold - 1e-9 && t < cut + tr.d) continue;
      if (frame(d, t).sig !== frame(m, t).sig) bad.push(`${recipe} at ${t}`);
    }
  }
  ok('with a transition, every moment outside it and its hold is the graphic\'s own frame', bad.length === 0, bad.slice(0, 5));
}

// ── transitions: the two ends, monotonic, mirrored, seeded ────────────────
console.log('transitions');
const W = 64, H = 36;
const pic = () => {
  const canvas = new FakeOffscreenCanvas(W, H);
  return { canvas, ctx: canvas.getContext('2d') };
};
const A = pic(), B = pic();
/** Composite on a fresh target; what was drawn on it, and on the two pictures' canvases, from this call. */
function mix(kind, p, dir = 'end', rtl = false, seed = 7) {
  const c = makeCanvas(W, H);
  const a0 = A.canvas.rec.calls.length, b0 = B.canvas.rec.calls.length;
  composite(c.ctx, kind, p, A, B, W, H, dir, rtl, seed);
  return {
    calls: c.calls, problems: [...c.check(), ...A.canvas.rec.check(), ...B.canvas.rec.check()],
    onA: A.canvas.rec.calls.slice(a0), onB: B.canvas.rec.calls.slice(b0),
    images: c.calls.filter((x) => x.name === 'drawImage').map((x) => x.args[0]),
  };
}
{
  ok('thirteen kinds, cut first', TRANSITIONS.length === 13 && TRANSITIONS[0] === 'cut', TRANSITIONS);
  const zero = [], one = [], problems = [];
  for (const kind of TRANSITIONS) {
    for (const dir of DIRS) {
      for (const rtl of [false, true]) {
        const at0 = mix(kind, 0, dir, rtl);
        const sawB = at0.onA.some((x) => x.name === 'drawImage' && x.args[0] === B.canvas);
        if (!at0.images.length || at0.images.some((im) => im !== A.canvas) || sawB) zero.push(`${kind}/${dir}/${rtl}`);
        const at1 = mix(kind, 1, dir, rtl);
        if (!at1.images.length || at1.images.some((im) => im !== B.canvas) || at1.onA.length || at1.onB.length) one.push(`${kind}/${dir}/${rtl}`);
        for (let p = 0; p <= 1.0001; p += 0.05) {
          const r = mix(kind, p, dir, rtl, 3);
          if (r.problems.length) problems.push(`${kind}/${dir}/${rtl} at ${p.toFixed(2)}: ${r.problems[0]}`);
        }
      }
    }
  }
  ok('at progress 0 every kind draws the old scene and nothing of the new', zero.length === 0, zero);
  ok('at progress 1 every kind draws the new scene alone, mixing nothing', one.length === 0, one);
  ok('every kind, way and direction, at every twentieth, draws only what a browser accepts, balanced', problems.length === 0, problems.slice(0, 5));
}
{
  // Monotonic progress for every curve offered; and the ones left out are left out for a reason.
  const bad = [];
  for (const ease of TRANSITION_EASES) {
    let last = -1;
    for (let i = 0; i <= 400; i++) {
      const p = progressOf({ kind: 'fade', ease }, i / 400);
      if (!(p >= last - 1e-12) || p < 0 || p > 1) bad.push(`${ease} at ${i / 400}`);
      last = p;
    }
    if (progressOf({ kind: 'fade', ease }, 0) !== 0 || progressOf({ kind: 'fade', ease }, 1) !== 1) bad.push(`${ease} ends`);
  }
  ok('every curve a transition may use rises from exactly 0 to exactly 1 and never turns back', bad.length === 0, bad.slice(0, 5));
  const turns = (name) => {
    const f = easeOf(name);
    let last = -Infinity;
    for (let i = 0; i <= 400; i++) {
      const y = f(i / 400);
      if (y < last - 1e-9 || y > 1 + 1e-9) return true;
      last = y;
    }
    return false;
  };
  ok('the curves left out overshoot or turn back', ['back-out', 'back-inout', 'elastic-out', 'bounce-out', 'spring'].every(turns));
  ok('and none of them is offered', ['back-out', 'back-inout', 'elastic-out', 'bounce-out', 'spring'].every((e) => !TRANSITION_EASES.includes(e)));
  eq('progress before the start is 0', progressOf({ kind: 'push' }, -3), 0);
  eq('progress past the end is 1', progressOf({ kind: 'push' }, 9), 1);
  eq('NaN progress is the start', progressOf({ kind: 'push' }, NaN), 0);
}
{
  // Each kind's own measure of how much of the new scene shows only grows with progress.
  const lastOf = (calls, name) => [...calls].reverse().find((c) => c.name === name);
  const measures = {
    fade: (r) => r.onA.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.alpha ?? 0,
    'light-leak': (r) => r.onA.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.alpha ?? 0,
    iris: (r) => lastOf(r.onA, 'arc')?.args[2] ?? 0,
    clock: (r) => { const a = lastOf(r.onA, 'arc'); return a ? Math.abs(a.args[4] - a.args[3]) : 0; },
    blinds: (r) => r.onA.filter((c) => c.name === 'rect').reduce((s, c) => s + c.args[2], 0),
    push: (r) => -Math.abs(r.calls.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.args[1] ?? W),
    slide: (r) => -Math.abs(r.calls.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.args[1] ?? W),
    whip: (r) => -Math.abs(r.calls.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.args[1] ?? W),
    zoom: (r) => -(r.calls.find((c) => c.name === 'drawImage' && c.args[0] === A.canvas)?.alpha ?? 0),
  };
  const bad = [];
  for (const [kind, measure] of Object.entries(measures)) {
    let last = -Infinity;
    for (let i = 1; i < 40; i++) {
      const v = measure(mix(kind, i / 40, 'end'));
      if (v < last - 1e-9) bad.push(`${kind} at ${i / 40}: ${v} after ${last}`);
      last = v;
    }
  }
  ok('fade, light leak, iris, clock, blinds, push, slide, whip and zoom each show only more of the new scene as progress grows', bad.length === 0, bad.slice(0, 5));
  // A shape with no area yet is not mixed at all: an engine may skip filling an empty path, and the new scene
  // would then be added whole over the old (seen in WebKit for blinds at their first frame).
  const tiny = ['iris', 'clock', 'blinds'].flatMap((kind) => [1e-9, 1e-4].map((p) => mix(kind, p, 'end'))
    .filter((r) => r.onA.some((c) => c.name === 'drawImage') || r.onB.length));
  ok('a reveal too small to fill leaves the old scene whole', tiny.length === 0, tiny.length);
  const both = mix('iris', 0.4);
  ok('a reveal fills the same shape on both pictures, so their edges agree', J(both.onB.filter((c) => c.name === 'arc').map((c) => c.args))
    === J(both.onA.filter((c) => c.name === 'arc').map((c) => c.args)) && both.onB.some((c) => c.name === 'globalCompositeOperation' && c.args[0] === 'destination-in'));
  const slices = mix('glitch', 0.4).calls.filter((c) => c.name === 'drawImage' && c.args.length === 9);
  ok('a glitch\'s knocked slices wrap round, so the frame stays covered', slices.some((c) => c.args[5] < 0) && slices.some((c) => c.args[5] > 0));
}
{
  // Direction is logical: right to left mirrors it.
  const bx = (r) => r.calls.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.args[1];
  eq('a push from the far side comes in from the right in English', Math.sign(bx(mix('push', 0.5, 'end', false))), 1);
  eq('and from the left in Arabic', Math.sign(bx(mix('push', 0.5, 'end', true))), -1);
  eq('a push from the reading side comes in from the left in English', Math.sign(bx(mix('push', 0.5, 'start', false))), -1);
  eq('a slide mirrors the same way', [Math.sign(bx(mix('slide', 0.4, 'end', false))), Math.sign(bx(mix('slide', 0.4, 'end', true)))], [1, -1]);
  eq('a whip pan too', [Math.sign(bx(mix('whip', 0.6, 'start', false))), Math.sign(bx(mix('whip', 0.6, 'start', true)))], [-1, 1]);
  const by = (r) => r.calls.find((c) => c.name === 'drawImage' && c.args[0] === B.canvas)?.args[2];
  eq('up arrives from below and down from above, in both directions', [by(mix('push', 0.5, 'up')), by(mix('push', 0.5, 'down', true))].map(Math.sign), [1, -1]);
  const arc = (rtl) => mix('clock', 0.3, 'end', rtl).onA.find((c) => c.name === 'arc').args;
  ok('a clock wipe turns clockwise in English and the other way in Arabic', arc(false)[5] === false && arc(true)[5] === true
    && arc(false)[4] > arc(false)[3] && arc(true)[4] < arc(true)[3]);
  const firstBar = (rtl) => mix('blinds', 0.3, 'start', rtl).onA.find((c) => c.name === 'rect').args[0];
  ok('blinds from the reading side fill from each bar\'s left in English and its right in Arabic', firstBar(false) === 0 && firstBar(true) > 0);
  const leak = (rtl) => mix('light-leak', 0.3, 'start', rtl).calls.find((c) => c.name === 'createRadialGradient').args[0];
  ok('a light leak crosses the other way in Arabic', leak(false) < W / 2 && leak(true) > W / 2, [leak(false), leak(true)]);
  eq('travelOf: start is toward the end, which is right in English', travelOf('start', false), [1, 0]);
  eq('travelOf: and left in Arabic', travelOf('start', true), [-1, 0]);
}
{
  const same = [];
  for (const kind of TRANSITIONS) {
    for (const p of [0.13, 0.5, 0.77]) {
      if (sig(mix(kind, p, 'end', false, 99).calls) !== sig(mix(kind, p, 'end', false, 99).calls)) same.push(`${kind} ${p}`);
    }
  }
  ok('the same progress and seed draw the same calls, every kind', same.length === 0, same);
  ok('a glitch deals other slices for another scene', sig(mix('glitch', 0.4, 'end', false, 1).calls) !== sig(mix('glitch', 0.4, 'end', false, 2).calls));
  eq('pixelate, glitch and flash show one picture at a time, swapping at the middle', ['pixelate', 'glitch', 'flash'].map((k) => [needsOf(k, 0.49), needsOf(k, 0.5)]), [['a', 'b'], ['a', 'b'], ['a', 'b']]);
  eq('the rest need both between the ends, and one at each end', [needsOf('push', 0), needsOf('push', 0.3), needsOf('push', 1)], ['a', 'both', 'b']);
}

// ── reading transitions and scenes ────────────────────────────────────────
console.log('reading');
{
  eq('a bare word is that kind as designed', readTransition('push'), { kind: 'push', d: 0.5 });
  eq('aliases', ['crossfade', 'zoom-through', 'Whip Pan', 'light_leak', 'clock-wipe'].map((w) => readTransition(w)?.kind), ['fade', 'zoom', 'whip', 'light-leak', 'clock']);
  eq('kinds by their words', ['Fade', ' glitch ', 'pixel', 'light leak', 'warp', 7].map(transitionKindOf), ['fade', 'glitch', 'pixelate', 'light-leak', undefined, undefined]);
  eq('a cut is no transition', [readTransition('cut'), readTransition({ kind: 'none' }), readTransition('teleport'), readTransition(null)], [undefined, undefined, undefined, undefined]);
  eq('d is held to 0.15..1.5', [readTransition({ kind: 'fade', d: 0.01 }).d, readTransition({ kind: 'fade', d: 9 }).d], [0.15, 1.5]);
  eq('and to the room the scenes leave', readTransition({ kind: 'fade', d: 1.2 }, 0.7).d, 0.7);
  eq('a numeric string and `duration` count', readTransition({ kind: 'fade', duration: '0.8' }).d, 0.8);
  eq('a direction only where it means something', [readTransition({ kind: 'push', dir: 'up' }).dir, readTransition({ kind: 'fade', dir: 'up' }).dir], ['up', undefined]);
  eq('left and right are not directions: they swap in Arabic', readTransition({ kind: 'push', dir: 'left' }).dir, undefined);
  eq('only a curve that never turns back', [readTransition({ kind: 'push', ease: 'spring' }).ease, readTransition({ kind: 'push', ease: 'Expo-Out' }).ease], [undefined, 'expo-out']);
  eq('directed kinds', TRANSITIONS.filter(directed), ['push', 'slide', 'blinds', 'whip', 'light-leak']);
  eq('a kind\'s own curve and direction fill in', [easeOfTransition({ kind: 'whip' }), dirOfTransition({ kind: 'push' }), dirOfTransition({ kind: 'push', dir: 'up' })], ['expo-inout', 'end', 'up']);
  ok('every kind has a look inside the limits', Object.entries(TRANSITION_LOOKS).every(([k, l]) => TRANSITIONS.includes(k)
    && l.d >= LIMITS.transitionMin && l.d <= LIMITS.transitionMax && TRANSITION_EASES.includes(l.ease)));
}
/** Every rule a tidy list keeps. Empty when it keeps them all. */
function invalid(list, seconds) {
  if (list === undefined) return [];
  const out = [];
  if (!Array.isArray(list) || list.length < 2) out.push('fewer than two');
  if (list.length > LIMITS.scenes) out.push('more than twelve');
  if (list[0]?.start !== 0) out.push('first not at 0');
  if (list[0]?.transition) out.push('first has a transition');
  if (Math.abs(list[list.length - 1].end - seconds) > 1e-9) out.push('last does not end at the end');
  const ids = new Set();
  list.forEach((s, i) => {
    if (typeof s.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s.id) || ids.has(s.id)) out.push(`id ${s.id}`);
    ids.add(s.id);
    if (typeof s.name !== 'string' || Array.from(s.name).length > LIMITS.name || s.name !== s.name.trim()) out.push(`name ${i}`);
    if (!(s.end - s.start >= LIMITS.sceneMin - 1e-6)) out.push(`scene ${i} too short`);
    if (i > 0 && s.start !== list[i - 1].end) out.push(`gap before ${i}`);
    const tr = s.transition;
    if (tr) {
      const room = Math.min(LIMITS.transitionMax, s.end - s.start, list[i - 1] ? list[i - 1].end - list[i - 1].start : 9);
      if (!(TRANSITIONS.includes(tr.kind) && tr.kind !== 'cut' && tr.d >= LIMITS.transitionMin - 1e-9 && tr.d <= room + 1e-9)) out.push(`transition ${i} ${J(tr)}`);
      if (tr.dir !== undefined && (!DIRS.includes(tr.dir) || !directed(tr.kind))) out.push(`dir ${i}`);
      if (tr.ease !== undefined && !TRANSITION_EASES.includes(tr.ease)) out.push(`ease ${i}`);
    }
  });
  return out;
}
{
  const many = Array.from({ length: 40 }, (_, i) => ({ start: i * 0.7, name: `S${i}`, transition: 'fade' }));
  const r = readScenes(many, [], 30);
  eq('at most twelve scenes', r.length, LIMITS.scenes);
  eq('and the last runs to the end', r[11].end, 30);
  eq('a scene shorter than half a second joins the one before', readScenes([{ start: 0 }, { start: 2 }, { start: 2.3 }, { start: 4 }], [], 6).map((s) => s.start), [0, 2, 4]);
  eq('one too near the end is dropped', readScenes([{ start: 0 }, { start: 3 }, { start: 5.8 }], [], 6).map((s) => [s.start, s.end]), [[0, 3], [3, 6]]);
  eq('fewer than two is none', [readScenes([{ start: 0 }], [], 6), readScenes([], [], 6), readScenes('x', [], 6), readScenes(null, [], 6)], [undefined, undefined, undefined, undefined]);
  eq('the first starts at 0 whatever it says', readScenes([{ start: 1 }, { start: 3 }], [], 6)[0].start, 0);
  eq('out of order is put in order', readScenes([{ start: 4, id: 'c' }, { start: 0, id: 'a' }, { start: 2, id: 'b' }], [], 6).map((s) => s.id), ['a', 'b', 'c']);
  eq('starts follow ends and durations when not given', readScenes([{ duration: 2 }, { end: 5 }, {}], [], 8).map((s) => s.start), [0, 2, 5]);
  eq('ids are made unique, and made when missing or malformed', readScenes([{ id: 'a' }, { start: 2, id: 'a' }, { start: 4, id: 'bad id!' }], [], 6).map((s) => s.id), ['a', 's1', 's2']);
  eq('the first scene arrives from nothing', readScenes([{ transition: 'push' }, { start: 3, transition: 'push' }], [], 6).map((s) => s.transition?.kind), [undefined, 'push']);
  eq('a transition is never longer than either scene beside it', readScenes([{ start: 0 }, { start: 0.6, transition: { kind: 'fade', d: 1.4 } }], [], 6)[1].transition.d, 0.6);
  eq('times are kept to the millisecond', readScenes([{ start: 0 }, { start: 2.00049 }], [], 6)[1].start, 2);
  eq('a name is one line, trimmed, at most sixty characters', readScenes([{ name: '  a\n b\u0000c ' }, { start: 3, name: 'x'.repeat(200) }], [], 6).map((s) => s.name), ['a b c', 'x'.repeat(60)]);
  eq('sceneName keeps an emoji whole', Array.from(sceneName('😀'.repeat(70))).length, 60);
  eq('a `title` stands for a name', readScenes([{ title: 'Intro' }, { start: 3 }], [], 6)[0].name, 'Intro');
  const r2 = readScenes([{ start: 0, name: 'A' }, { start: 2.5, name: 'B', transition: { kind: 'blinds', d: '0.4', dir: 'up', ease: 'soft' } }], [], 6);
  eq('a fixed point', J(readScenes(JSON.parse(J(r2)), [], 6)), J(r2));
  // readMotion carries scenes, drops broken ones, and is a fixed point with them.
  const m = tpl('kinetic');
  const withScenes = readMotion({ ...m, scenes: [{ start: 0 }, { start: 3, transition: 'zoom' }] }, 1);
  eq('readMotion keeps a graphic\'s scenes', withScenes.scenes.map((s) => s.transition?.kind), [undefined, 'zoom']);
  eq('and is a fixed point with them', J(readMotion(JSON.parse(J(withScenes)), 1)), J(withScenes));
  ok('and leaves no `scenes` on a graphic whose scenes do not read', !('scenes' in readMotion({ ...m, scenes: [{ start: 0 }] }, 1)) && !('scenes' in readMotion({ ...m, scenes: 'lots' }, 1)));
  eq('a graphic shortened under its scenes keeps those that still fit', readScenes(withScenes.scenes, [], 2), undefined);
}
{
  // Hostile input: never a throw, always a valid list or none, and a fixed point.
  const hostile = [];
  const throwing = new Proxy([], { get() { throw new Error('get'); }, ownKeys() { throw new Error('keys'); }, has() { throw new Error('has'); } });
  hostile.push(throwing, [throwing, throwing]);
  const getter = { get start() { throw new Error('start'); } };
  hostile.push([getter, { start: 3, get transition() { throw new Error('t'); } }]);
  const cyc = { start: 2 };
  cyc.self = cyc;
  cyc.transition = cyc;
  hostile.push([{ start: 0 }, cyc]);
  const sparse = [];
  sparse.length = 2 ** 32 - 1;
  sparse[0] = { start: 0 };
  sparse[5] = { start: 3 };
  hostile.push(sparse);
  hostile.push(JSON.parse('[{"__proto__":{"start":3},"start":0},{"start":3,"constructor":"x","toString":1}]'));
  hostile.push([{ start: Infinity }, { start: -Infinity }, { start: NaN }, { start: 1e308 }, { start: '3' }, { start: '3px' }]);
  hostile.push(Array.from({ length: 5000 }, (_, i) => ({ start: i / 100 })));
  const r = rand(5);
  const any = (depth = 0) => {
    const k = Math.floor(r() * 12);
    if (k === 0) return r() * 40 - 5;
    if (k === 1) return String(r() * 10);
    if (k === 2) return [NaN, Infinity, -0, 1e300, null, undefined, true][Math.floor(r() * 7)];
    if (k === 3) return ['fade', 'push', 'cut', 'zoom', 'glitch', '', 'x'.repeat(5000), '‮abc', 'up', 'start', 'left'][Math.floor(r() * 11)];
    if (k === 4 && depth < 3) return Array.from({ length: Math.floor(r() * 4) }, () => any(depth + 1));
    if (k >= 5 && depth < 3) {
      const o = {};
      for (const key of ['start', 'end', 'duration', 'id', 'name', 'title', 'transition', 'kind', 'd', 'dir', 'ease']) if (r() < 0.45) o[key] = any(depth + 1);
      return o;
    }
    return r();
  };
  for (let i = 0; i < 600; i++) hostile.push(Array.from({ length: Math.floor(r() * 16) }, () => any()));
  const bad = [];
  let read = 0;
  for (const x of hostile) {
    for (const seconds of [6, 1, 30, NaN, -4, 100]) {
      let out;
      try { out = readScenes(x, [], seconds); } catch (e) { bad.push(`threw ${e}`); continue; }
      const secs = Math.min(30, Math.max(1, Number.isFinite(seconds) ? seconds : 6));
      const wrong = invalid(out, secs);
      if (wrong.length) bad.push(`${wrong[0]} from ${String(J(x)).slice(0, 80)}`);
      if (out && J(readScenes(JSON.parse(J(out)), [], secs)) !== J(out)) bad.push(`not a fixed point: ${J(out).slice(0, 120)}`);
      if (out) read++;
    }
  }
  ok(`readScenes, ${hostile.length * 6} hostile and random inputs: no throw, always valid, a fixed point (${read} read as scenes)`, bad.length === 0 && read > 300, bad.slice(0, 5));
}

// ── what a frame shows around a cut ───────────────────────────────────────
console.log('the frame at a cut');
{
  const doc = readMotion({
    id: 'd', title: 't', lang: 'en', format: 'landscape', fps: 30, seconds: 6, backdrop: 'bg', stage: 'ready',
    layers: [
      { kind: 'backdrop', id: 'bg', style: 'aurora', start: 0, end: 6 },
      { kind: 'text', id: 'one', text: 'One', start: 0, end: 3, in: { fx: 'fade', d: 0.4 }, out: { fx: 'fade', d: 0.4 } },
      { kind: 'text', id: 'two', text: 'Two', start: 3, end: 6, in: { fx: 'rise', d: 0.5 } },
    ],
    scenes: [{ start: 0, name: 'Open' }, { start: 3, transition: { kind: 'push', d: 0.5 } }],
  }, 1);
  const bare = plain(doc);
  eq('the hold moment is where the leaving title\'s exit would begin', sceneHold(doc, 0), 2.6);
  eq('before it, the scene plays as designed', frame(doc, 2.5).sig, frame(bare, 2.5).sig);
  eq('from it to the cut, the scene holds still: its exit is the transition\'s', frame(doc, 2.8).sig, frame(bare, 2.6).sig);
  const arriving = setTransition(doc, doc.scenes[1].id, null, 1);
  eq('with a cut instead, the exit plays', frame(arriving, 2.8).sig, frame(bare, 2.8).sig);
  eq('and the hold is the cut', sceneHold(arriving, 0), 3);
  // At the cut: only the old scene's picture, frozen at its hold.
  const [w, h] = [192, 108];
  const before = offscreens.length;
  /** Paint `d` at `t` twice (the first warms the layout caches) and say what the second drew on the target and on each picture. */
  const twice = (d, t) => {
    paint(makeCanvas(w, h).ctx, d, t, { strict: true });
    const marks = offscreens.map((o) => o.rec?.calls.length ?? 0);
    const c = makeCanvas(w, h);
    paint(c.ctx, d, t, { strict: true });
    const drawn = new Map(offscreens.map((o, i) => [o, o.rec ? o.rec.calls.slice(marks[i] ?? 0) : []]));
    return { calls: c.calls, on: (o) => drawn.get(o) ?? [] };
  };
  const atCut = twice(doc, 3);
  const imgs = atCut.calls.filter((c) => c.name === 'drawImage').map((c) => c.args[0]);
  ok('at the cut the frame is one picture, of the old scene', imgs.length === 1 && imgs[0] instanceof FakeOffscreenCanvas, imgs.length);
  const picA = imgs[0];
  const held = twice(bare, 2.6);
  ok('and that picture is the old scene at its hold moment, call for call', atCut.on(picA).length > 20 && sig(atCut.on(picA)) === sig(held.calls));
  // Mid-transition: the new scene's picture is the graphic at that moment.
  const mid = twice(doc, 3.25);
  const both = [...new Set(mid.calls.filter((c) => c.name === 'drawImage').map((c) => c.args[0]))];
  ok('half way, both pictures are laid', both.length === 2 && both.includes(picA));
  const picB = both.find((x) => x !== picA);
  const now = twice(bare, 3.25);
  ok('the new scene plays from its start: its picture is the graphic at that moment, call for call', mid.on(picB).length > 20 && sig(mid.on(picB)) === sig(now.calls));
  ok('and the old one is still frozen at its hold moment', sig(mid.on(picA)) === sig(held.calls));
  const target = makeCanvas(w, h);
  ok('two offscreen canvases, made once and reused', (() => {
    const made = offscreens.length;
    for (let t = 3; t < 3.5; t += 1 / 30) paint(makeCanvas(w, h).ctx, doc, t, { strict: true });
    return offscreens.length === made && made - before <= 2;
  })(), offscreens.length - before);
  eq('after the transition, the graphic\'s own frame', frame(doc, 3.6).sig, frame(bare, 3.6).sig);
  ok('motion blur over a transition is clean', frame(doc, 3.2, 10, { blur: { samples: 4, shutter: 0.5 } }).problems.length === 0);
  // Right to left: the same push enters from the other side.
  const sideOf = (lang) => {
    const d = { ...doc, lang };
    const c = makeCanvas(w, h);
    paint(c.ctx, d, 3.25, { strict: true });
    const draws = c.calls.filter((x) => x.name === 'drawImage');
    return Math.sign(draws.find((x) => x.args[0] !== picA)?.args[1] ?? 0);
  };
  eq('a push into the second scene comes from the right in English and the left in Arabic', [sideOf('en'), sideOf('ar')], [1, -1]);
  ok('the same moment is the same frame', frame(doc, 3.3).sig === frame(doc, 3.3).sig);
  // The hook's own contract.
  const draws = [];
  const spy = (target2, at, clear) => draws.push([at, clear]);
  ok('paintScenes paints nothing without a drawing to call', paintScenes(target.ctx, doc, 3.2, w, h) === false);
  ok('nothing for a graphic without scenes', paintScenes(target.ctx, bare, 3.2, w, h, spy) === false && draws.length === 0);
  ok('nothing outside a transition or a hold', paintScenes(target.ctx, doc, 1, w, h, spy) === false && draws.length === 0);
  ok('a hold is the graphic painted at the hold moment, with paint\'s own clear', paintScenes(target.ctx, doc, 2.9, w, h, spy, false) === true && J(draws) === J([[2.6, false]]));
  // No canvas to paint on: the transition is a cut, and nothing throws.
  const keep = globalThis.OffscreenCanvas;
  globalThis.OffscreenCanvas = undefined;
  let fell;
  try { fell = paintScenes(makeCanvas(77, 33).ctx, doc, 3.2, 77, 33, spy); } finally { globalThis.OffscreenCanvas = keep; }
  ok('with no offscreen canvas a transition falls back to a cut', fell === false);
  // A layer still leaving across the cut moves the hold back to where it began to leave.
  const across = readMotion({ ...doc, layers: [...doc.layers, { kind: 'shape', id: 'bar', start: 1, end: 3.3, out: { fx: 'fade', d: 0.8 } }] }, 1);
  eq('a layer leaving across the cut holds the scene from where its exit began', sceneHold(across, 0), 2.5);
}

// ── edits ─────────────────────────────────────────────────────────────────
console.log('edits');
const fixed = (m) => J(readMotion(JSON.parse(J(m)), 1)) === J(m);
{
  const m = tpl('big-title');
  const two = addScene(m, 1, 5);
  eq('"+ Scene" on one scene makes two, the second at the old end', two.scenes.map((s) => [s.start, s.end]), [[0, 6], [6, 6 + NEW_SCENE]]);
  eq('the graphic grows by the new scene', two.seconds, 6 + NEW_SCENE);
  eq('the new scene arrives with a fade by default', two.scenes[1].transition, { kind: 'fade', d: TRANSITION_LOOKS.fade.d });
  ok('its layers stay where they were, but a background that ran to the end runs on through it', two.layers.every((l, i) => {
    const was = m.layers[i];
    return l.kind === 'backdrop' && was.end === m.seconds ? l.start === was.start && l.end === two.seconds : J(l) === J(was);
  }) && m.layers.some((l) => l.kind === 'backdrop'));
  // At the template's end the new scene is the person's: the template keeps its words and owns its six seconds (docs/pro/f1-until.md).
  ok('it is stamped, still the template\'s, which now owns the time up to the cut, and reads back unchanged',
    two.updated === 5 && two.recipe?.id === 'big-title' && two.recipe.until === 6 && J(two.recipe.fields) === J(m.recipe.fields) && fixed(two));
  ok('a second "+ Scene" at the end keeps that span', addScene(two, 7, 5).recipe?.until === 6);
  const inside = addScene(splitSceneAt(m, 3, 5), 1, 5);
  ok('a scene added inside the template\'s time moves its layers: the template ends', inside.seconds === 9 && !inside.recipe && fixed(inside));
  // A background that ran to the end runs on; layers after the cut move; layers across it grow.
  const base = readMotion({
    id: 'e', title: 'e', lang: 'en', format: 'square', fps: 30, seconds: 9, stage: 'ready', created: 1, updated: 1,
    layers: [
      { kind: 'backdrop', id: 'bg', style: 'grid', start: 0, end: 9 },
      { kind: 'text', id: 'a', text: 'A', start: 0, end: 3, out: { fx: 'fade', d: 0.3 } },
      { kind: 'text', id: 'b', text: 'B', start: 3, end: 6, in: { fx: 'rise', d: 3 } },
      { kind: 'shape', id: 'x', start: 2, end: 7 },
      { kind: 'counter', id: 'c', start: 6, end: 9, count: { d: 3, delay: 0 } },
    ],
    scenes: [{ start: 0, id: 'one' }, { start: 3, id: 'two', transition: 'push' }, { start: 6, id: 'three', transition: 'push' }],
  }, 1);
  const at = (doc, id) => doc.layers.find((l) => l.id === id);
  const mid = addScene(base, 4, 2);
  eq('added after the scene under the playhead, it pushes the later ones on', mid.scenes.map((s) => [s.id, s.start, s.end]), [['one', 0, 3], ['two', 3, 6], ['s1', 6, 9], ['three', 9, 12]]);
  eq('a layer after the cut moves later by the new scene', [at(mid, 'c').start, at(mid, 'c').end], [9, 12]);
  eq('a layer across the cut grows by it', [at(mid, 'x').start, at(mid, 'x').end], [2, 10]);
  eq('a background across the cut grows by it', at(mid, 'bg').end, 12);
  eq('a layer before the cut stays', [at(mid, 'a').start, at(mid, 'a').end, at(mid, 'b').start, at(mid, 'b').end], [0, 3, 3, 6]);
  eq('the new scene arrives with the graphic\'s usual transition', mid.scenes[2].transition.kind, 'push');
  eq('primaryTransition is the most used', primaryTransition(base).kind, 'push');
  ok('and it reads back unchanged', fixed(mid));
  const end = addScene(base, 8, 2);
  eq('added at the end, a background that ran to the end runs on', [at(end, 'bg').end, at(end, 'c').end], [12, 9]);
  const full = readMotion({ ...base, seconds: 30, layers: [] }, 1);
  ok('no room under thirty seconds: nothing changes', addScene(full, 1, 2) === full && !canAddScene(full));
  const nearly = readMotion({ ...base, seconds: 29.2 }, 1);
  eq('with less than three seconds left, the new scene gets what is left', addScene(nearly, 1, 2).seconds, 30);
  const twelve = readMotion({ ...base, seconds: 30, scenes: Array.from({ length: 12 }, (_, i) => ({ start: i * 2.5 })) }, 1);
  ok('twelve scenes: no more', addScene(twelve, 1, 2) === twelve && !canAddScene(twelve) && !canSplitAt(twelve, 1.25));

  const split = splitSceneAt(base, 4.5, 3);
  eq('split cuts the scene under the playhead in two', split.scenes.map((s) => [s.start, s.end]), [[0, 3], [3, 4.5], [4.5, 6], [6, 9]]);
  ok('and moves nothing: the new piece arrives by a cut', J(split.layers) === J(base.layers) && !split.scenes[2].transition && split.scenes[1].transition.kind === 'push');
  ok('a split too near a cut does nothing', splitSceneAt(base, 3.2, 3) === base && !canSplitAt(base, 5.7) && canSplitAt(base, 4.5));
  eq('a graphic without scenes splits into two', splitSceneAt(m, 2.5, 3).scenes.map((s) => s.start), [0, 2.5]);
  ok('splitting keeps the template link', !!splitSceneAt(m, 2.5, 3).recipe && fixed(splitSceneAt(m, 2.5, 3)));

  const joined = removeScene(base, 'two', 4);
  eq('removing a scene joins it to the one before', joined.scenes.map((s) => [s.id, s.start, s.end]), [['one', 0, 6], ['three', 6, 9]]);
  ok('and no layer moves', J(joined.layers) === J(base.layers) && fixed(joined));
  eq('removing the first lets the second start at 0, with no transition', removeScene(base, 'one', 4).scenes.map((s) => [s.id, s.start, s.transition?.kind]), [['two', 0, undefined], ['three', 6, 'push']]);
  ok('one scene left is no scenes', !('scenes' in removeScene(removeScene(base, 'one', 4), 'two', 4)));
  ok('an unknown id changes nothing', removeScene(base, 'nope', 4) === base);

  const moved = moveScene(base, 'three', 0, 6);
  eq('moving a scene lays the scenes back to back in the new order', moved.scenes.map((s) => [s.id, s.start, s.end]), [['three', 0, 3], ['one', 3, 6], ['two', 6, 9]]);
  eq('the layers inside a scene go with it', [at(moved, 'c').start, at(moved, 'a').start, at(moved, 'b').start], [0, 3, 6]);
  eq('a layer across a cut stays where it is', [at(moved, 'x').start, at(moved, 'x').end, at(moved, 'bg').end], [2, 7, 9]);
  eq('the scene that is now first arrives from nothing; the old first by a cut', moved.scenes.map((s) => s.transition?.kind), [undefined, undefined, 'push']);
  ok('a moved graphic reads back unchanged and is detached', fixed(moved) && !moved.recipe);
  ok('moving to where it is changes nothing', moveScene(base, 'two', 1, 6) === base);
  eq('an index past the end is the end', moveScene(base, 'one', 99, 6).scenes.map((s) => s.id), ['two', 'three', 'one']);

  const t1 = setTransition(base, 'two', 'iris', 7);
  eq('choosing a kind starts from its own length', t1.scenes[1].transition, { kind: 'iris', d: TRANSITION_LOOKS.iris.d });
  eq('changing the length keeps the kind', setTransition(t1, 'two', { d: 1.2 }, 7).scenes[1].transition, { kind: 'iris', d: 1.2 });
  eq('a length longer than a scene beside it is cut to fit', setTransition(split, split.scenes[2].id, { kind: 'fade', d: 1.5 }, 7).scenes[2].transition.d, 1.5);
  eq('a direction is kept across kinds that have one', setTransition(setTransition(base, 'two', { dir: 'up' }, 7), 'two', 'slide', 7).scenes[1].transition, { kind: 'slide', d: TRANSITION_LOOKS.slide.d, dir: 'up' });
  ok('null and "cut" make it a cut', !setTransition(base, 'two', null, 7).scenes[1].transition && !setTransition(base, 'two', 'cut', 7).scenes[1].transition);
  ok('the first scene arrives from nothing: setting its transition changes nothing', setTransition(base, 'one', 'fade', 7) === base);
  ok('setting what is already there changes nothing', setTransition(base, 'two', { kind: 'push' }, 7) === base);
  eq('rename keeps a name the reader would', renameScene(base, 'two', '  The\nmiddle  ', 8).scenes[1].name, 'The middle');
  ok('the same name changes nothing', renameScene(base, 'one', '', 8) === base);
  ok('rename keeps the template link and reads back unchanged', fixed(renameScene(split, 'two', 'x', 8)));

  eq('sceneAt', [0, 2.99, 3, 8.9, 50, -1].map((t) => sceneAt(base, t)), [0, 0, 1, 2, 2, 0]);
  eq('sceneSpan', [sceneSpan(base, 4), sceneSpan(m, 4)], [{ start: 3, end: 6 }, { start: 0, end: 6 }]);
  eq('sceneList is empty for a graphic of one scene', [sceneList(m).length, sceneList(base).length], [0, 3]);
}
{
  // Fuzz: random edits in random order on every template — never a throw, always a valid graphic that reads back unchanged.
  const r = rand(11);
  const pickId = (m) => {
    const l = sceneList(m);
    return r() < 0.1 ? 'nope' : l.length ? l[Math.floor(r() * l.length)].id : 's1';
  };
  const garbage = [null, undefined, NaN, Infinity, -1, 1e9, '3', 'fade', {}, [], { kind: 'push', d: -1, dir: 'left', ease: 'spring' }];
  const bad = [];
  let edits = 0;
  for (let run = 0; run < 120; run++) {
    const recipe = CORE_RECIPE_IDS[run % CORE_RECIPE_IDS.length];
    let m = tpl(recipe, LANGUAGES[run % 4], FORMAT_IDS[(run >> 2) % 4]);
    for (let k = 0; k < 10; k++) {
      const what = Math.floor(r() * 6);
      const t = r() < 0.1 ? garbage[Math.floor(r() * garbage.length)] : r() * (m.seconds + 1) - 0.5;
      let next;
      try {
        if (what === 0) next = addScene(m, t, 9);
        else if (what === 1) next = splitSceneAt(m, t, 9);
        else if (what === 2) next = removeScene(m, pickId(m), 9);
        else if (what === 3) next = moveScene(m, pickId(m), r() < 0.1 ? garbage[Math.floor(r() * 7)] : Math.floor(r() * 14) - 1, 9);
        else if (what === 4) {
          const spec = r() < 0.2 ? garbage[Math.floor(r() * garbage.length)]
            : { kind: TRANSITIONS[Math.floor(r() * TRANSITIONS.length)], d: r() * 2, dir: DIRS[Math.floor(r() * 4)], ease: TRANSITION_EASES[Math.floor(r() * 11)] };
          next = setTransition(m, pickId(m), spec, 9);
        } else next = renameScene(m, pickId(m), ['', 'Intro', '‮x\n', 'z'.repeat(300), 42][Math.floor(r() * 5)], 9);
      } catch (e) {
        bad.push(`${recipe} edit ${what} threw ${e}`);
        break;
      }
      edits++;
      if (!fixed(next)) {
        const back = readMotion(JSON.parse(J(next)), 1);
        bad.push(`${recipe} edit ${what} does not read back: ${J(next.scenes)} vs ${J(back?.scenes)}`);
        break;
      }
      const wrong = invalid(next.scenes, next.seconds);
      if (wrong.length) bad.push(`${recipe} edit ${what}: ${wrong[0]}`);
      if (next.layers.some((l) => !(l.start >= 0 && l.end > l.start && l.end <= next.seconds + 1e-9))) bad.push(`${recipe} edit ${what}: a layer outside the graphic`);
      if (next.scenes && next.scenes.length < 2) bad.push('fewer than two scenes kept');
      m = next;
    }
    // A few frames of what came out, around every cut.
    for (const s of sceneList(m)) {
      for (const dt of [-0.3, 0, 0.1, 0.3]) {
        const f = frame(m, Math.max(0, Math.min(m.seconds - 0.01, s.start + dt)), 16);
        if (f.problems.length) bad.push(`${recipe} frame at ${s.start + dt}: ${f.problems[0]}`);
      }
    }
  }
  ok(`${edits} random edits on the templates: no throw, valid scenes, read back unchanged, clean frames`, bad.length === 0 && edits > 1000, bad.slice(0, 5));
}

// ── what a transition costs ───────────────────────────────────────────────
console.log('cost');
{
  const m = tpl('stats');
  let d = splitSceneAt(m, 3, 1);
  d = setTransition(d, d.scenes[1].id, { kind: 'push', d: 0.6 }, 1);
  const size = [480, 270];
  const time = (t) => {
    const c = makeCanvas(...size);
    const t0 = performance.now();
    paint(c.ctx, d, t, { strict: true });
    return performance.now() - t0;
  };
  const count = (t) => {
    const mark = offscreens.map((o) => o.rec?.calls.length ?? 0);
    const c = makeCanvas(...size);
    paint(c.ctx, d, t, { strict: true });
    return c.calls.length + offscreens.reduce((s, o, i) => s + (o.rec ? o.rec.calls.length - (mark[i] ?? 0) : 0), 0);
  };
  for (let i = 0; i < 20; i++) { time(2.5); time(3.3); }
  const normal = [], moving = [];
  for (let i = 0; i < 80; i++) { normal.push(time(2.5)); moving.push(time(3.3)); }
  const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
  const ratio = median(moving) / median(normal);
  const calls = count(3.3) / count(2.5);
  console.log(`  a normal frame ${median(normal).toFixed(3)} ms, a transition frame ${median(moving).toFixed(3)} ms: ${ratio.toFixed(2)}x the time, ${calls.toFixed(2)}x the calls`);
  ok('a transition frame makes about twice a frame\'s calls (two pictures and the mix)', calls <= 2.2, calls);
  ok('and costs about twice a frame\'s time (at most 3x, measured)', ratio <= 3, ratio);
}

// ── the rules of the house ────────────────────────────────────────────────
console.log('the house rules');
{
  // motionscene.ts must not reach motiondraw.ts or motionread.ts at run time: they import it.
  const runtime = (file) => {
    const src = readFileSync(`src/${file}.ts`, 'utf8');
    return [...src.matchAll(/^import\s+(?!type\b)([\s\S]*?)\s+from\s+'\.\/([\w-]+)'/gm)]
      .filter((m) => !/^\{\s*(?:type\s+\w+\s*,?\s*)+\}$/.test(m[1].trim()))
      .map((m) => m[2]);
  };
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file) || !existsSync(`src/${file}.ts`)) return;
    seen.add(file);
    for (const dep of runtime(file)) walk(dep);
  };
  walk('motionscene');
  ok('motionscene.ts reaches neither motiondraw.ts nor motionread.ts at run time', !seen.has('motiondraw') && !seen.has('motionread'), [...seen]);
  ok('nor does motiontransition.ts', seen.has('motiontransition'));
  const code = ['motionscene', 'motiontransition'].map((f) => readFileSync(`src/${f}.ts`, 'utf8')).join('\n');
  ok('nothing here sets ctx.filter', !/\.filter\s*=|\[['"]filter['"]\]/.test(code));
  ok('nothing here is random but seeded, and no clock but an edit\'s stamp', !/Math\.random\(|Date\.now\(\)/.test(code.replace(/now = Date\.now\(\)/g, '')));
}

// ── the strip ─────────────────────────────────────────────────────────────
console.log('the strip');
{
  const require = createRequire(import.meta.url);
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  if (!esbuild) ok('esbuild is there to build the strip', false);
  else {
    esbuild.buildSync({
      entryPoints: ['src/MotionScenes.tsx'], bundle: true, format: 'esm', outdir: '.test-build/pro-scenes', logLevel: 'error',
      external: ['react', 'react-dom', '@tauri-apps/api/core', '@codemirror/state'],
    });
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { MotionScenes } = await import('../.test-build/pro-scenes/MotionScenes.js');
    const t = (s) => s;
    const quietError = console.error;
    const render = (doc) => {
      console.error = () => {};
      try { return renderToStaticMarkup(createElement(MotionScenes, { t, doc, onEdit: () => {} })); } finally { console.error = quietError; }
    };
    const one = render(tpl('big-title'));
    ok('one scene: only a quiet "+ Scene"', one.includes('ms-add ms-quiet') && !one.includes('ms-track') && !one.includes('Split here'), one.slice(0, 200));
    let three = splitSceneAt(addScene(tpl('big-title'), 1, 1), 2, 1);
    three = setTransition(three, three.scenes[2].id, 'whip', 1);
    const html = render(three);
    eq('three scenes: three chips', (html.match(/class="ms-chip /g) ?? []).length, 3);
    eq('and two transition chips between them', (html.match(/class="ms-cut( is-cut)?"/g) ?? []).length, 2);
    ok('a cut and a whip pan, named', html.includes('>Cut<') && html.includes('>Whip pan<'));
    ok('the track runs left to right; the strip itself follows the page', /class="ms-track"[^>]*dir="ltr"/.test(html) && !/class="ms"[^>]*dir=/.test(html));
    ok('the scene under the playhead is marked', (html.match(/aria-current="true"/g) ?? []).length === 1);
    ok('one tab stop in the track', (html.match(/data-ms-key="[^"]*" tabindex="0"/g) ?? []).length === 1);
    ok('"+ Scene" and "Split here" at its end', html.includes('ms-end') && html.includes('Split here') && html.includes('aria-label="Add a scene"'));
    ok('every scene chip is a button that opens a menu', (html.match(/aria-haspopup="dialog"/g) ?? []).length === 5);
    ok('no physical left or right in the strip\'s styles', (() => {
      const css = readFileSync('src/styles.css', 'utf8');
      const a = css.indexOf('/* pro:05 start */'), b = css.indexOf('/* pro:05 end */');
      const mine = css.slice(a, b);
      return a > 0 && b > a && !/(^|[^-])(left|right)\s*:|margin-(left|right)|padding-(left|right)|border-(left|right)|text-align:\s*(left|right)/.test(mine);
    })());
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
