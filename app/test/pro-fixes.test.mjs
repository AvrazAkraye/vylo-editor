// F2 of the Pro pass: the reviews' remaining small fixes (docs/pro/f2-fixes.md).
//
// What matters:
//
//   1. Scene sound (docs/pro/requests/R2.md, item 1). When a scene arrives with
//      a transition, the scene before it holds still from its hold moment to
//      the cut, and its exits are never drawn. Their sounds are gone with them:
//      on the very film review R2 measured (four scenes joined by a push, an
//      iris and a flash), the whooshes at 2.55, 5.55, 8.4 and 8.55 s no longer
//      play over a still picture, and nothing else in the film moves. The
//      stretches are the painter's own (`sceneHold`, `sceneList`), and the
//      recording canvas shows the picture really is still there. A graphic
//      without scenes sounds exactly as it did: every template, in every shape,
//      language and level, and two hundred random graphics, give the same cues
//      as the derivation before the fix, to the last digit.
//   2. The audio library's readers (R1, item 1): own fields, one guarded read
//      each, lists by index up to a ceiling, a bad entry skipped, never -0 —
//      so a Proxy, a revoked one, a throwing getter or four billion holes
//      neither throws nor hangs. (pro-review-safety.test.mjs runs them through
//      its whole hostile matrix too.)
//   3. The Export tab no longer imports Welcome.tsx for one boolean: IS_MAC is
//      in platform.ts, which imports nothing.
//   4. The layer panel's outline width offers what the reader keeps for the
//      type size, and a number box never sends a value past its own ceiling
//      because of rounding.
//   5. docs/MOTION.md names the two new ceilings, with the code's numbers.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { makeCanvas } from './motioncanvas.mjs';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { MAX_DASHES, readMotion, textOutlineMax, textShadowMax } from '../.test-build/motionread.js';
import { musicCuesOf, soundCues, soundKey, withSound } from '../.test-build/motionsound.js';
import { sceneHold, sceneList } from '../.test-build/motionscene.js';
import { paint } from '../.test-build/motiondraw.js';
import { EFFECTS, FORMAT_IDS, LANGUAGES, RECIPE_IDS } from '../.test-build/motiontypes.js';
import { listOf, own, rec } from '../.test-build/audiocore.js';
import { readAutomation, readLane } from '../.test-build/audioauto.js';
import { MAX_CHAIN, readChain, readFx, renderChain } from '../.test-build/audiofx.js';
import { duckLaneFor, readDuck } from '../.test-build/audioduck.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const timed = (f) => {
  const t0 = performance.now();
  let value, error;
  try { value = f(); } catch (e) { error = e; }
  return { ms: performance.now() - t0, value, error };
};
const NOW = 1_700_000_000_000;

// ── 1. scene sound ────────────────────────────────────────────────────────
console.log('scene sound');

/**
 * Review R2's four-scene film (`vylo-pro-samples/mp4/04-scenes-push-iris-flash.mp4`, made by its
 * `.test-build/r2/holdcheck.mjs`): big title, big number, bar chart and quote, three seconds each, joined by a
 * push at 3 s, an iris at 6 s and a flash at 9 s, with sound on Both. `cuts` makes every join a cut instead.
 */
function fourScenes(cuts = false) {
  const parts = ['big-title', 'big-number', 'bar-chart', 'quote'].map((r, k) => buildMotion({ id: `p${k}`, recipe: r, lang: 'en', format: 'landscape', seconds: 3, now: 0 }));
  const layers = [];
  parts.forEach((p, k) => p.layers.forEach((l) => layers.push({ ...l, id: `s${k}${l.id}`, start: l.start + k * 3, end: l.end + k * 3 })));
  const tr = [{ kind: 'push', d: 0.5 }, { kind: 'iris', d: 0.6 }, { kind: 'flash', d: 0.5 }];
  const m = readMotion({ ...parts[0], recipe: undefined, id: 'scenes', title: 'x', seconds: 12, layers,
    scenes: parts.map((_, k) => (k === 0 ? { start: 0 } : cuts ? { start: 3 * k } : { start: 3 * k, transition: tr[k - 1] })) }, 0);
  return withSound(m, { mode: 'both', level: 0.6, mood: 'uplifting' }, 0);
}
/** Where a film stands still: [hold, cut) for every scene the next arrives over by a transition. */
const stillsOf = (m) => {
  const list = sceneList(m);
  return list.slice(0, -1).flatMap((s, i) => (list[i + 1].transition ? [{ from: sceneHold(m, i), cut: s.end }] : []));
};
const inStill = (stills, t) => stills.some((s) => t >= s.from - 1e-6 && t < s.cut - 1e-9);
const key = (c) => JSON.stringify(c);
const at = (cues, t) => cues.filter((c) => Math.abs(c.t - t) < 0.006);

{
  const film = fourScenes();
  const cutFilm = fourScenes(true);
  const list = sceneList(film);
  const stills = stillsOf(film);
  ok('the setup: four scenes, a push, an iris and a flash; held still from 2.4, 5.55 and 8.4 s to the cuts at 3, 6 and 9 (as R2 measured)',
    list.length === 4 && same(list.slice(1).map((s) => s.transition?.kind), ['push', 'iris', 'flash'])
    && same(stills.map((s) => [Math.round(s.from * 1000) / 1000, s.cut]), [[2.4, 3], [5.55, 6], [8.4, 9]]), stills);

  const cues = soundCues(film);
  const ghosts = cues.filter((c) => inStill(stills, c.t));
  ok('no cue starts while a scene holds still for its transition', ghosts.length === 0, ghosts);
  const reported = [2.55, 5.55, 8.4, 8.55].map((t) => at(cues, t).filter((c) => c.kind === 'whoosh' && c.rev));
  ok('the four exit whooshes R2 heard over a still picture (2.55, 5.55, 8.4, 8.55 s) are gone', reported.every((r) => r.length === 0), reported);

  const cutCues = soundCues(cutFilm);
  const exits = [2.55, 5.55, 8.4, 8.55].map((t) => at(cutCues, t).filter((c) => c.kind === 'whoosh' && c.rev));
  ok('joined by cuts instead, the same scenes leave as designed, exits and all: those four whooshes play', exits.every((r) => r.length === 1), exits);
  const kept = new Set(cues.map(key));
  const onlyCut = cutCues.filter((c) => !kept.has(key(c)));
  const cutKeys = new Set(cutCues.map(key));
  ok('and they are the only difference: every other cue (each scene\'s entrances at the moment its picture plays them, the last scene\'s exit) is the same, to the last digit',
    onlyCut.length === 4 && onlyCut.every((c) => c.kind === 'whoosh' && c.rev && inStill(stills, c.t)) && cues.every((c) => cutKeys.has(key(c))) && cues.length === cutCues.length - 4,
    onlyCut.map((c) => `${c.kind}@${c.t}`));
  const nextIn = cues.filter((c) => [3, 6, 9].some((cut) => c.t >= cut && c.t < cut + 0.6) && !c.rev);
  ok(`the next scenes' entrances still sound during their transitions (${nextIn.length}: ${nextIn.map((c) => `${c.kind}@${c.t}`).join(' ')})`, nextIn.length >= 6);
  ok('the bed\'s key follows the cues, so a bed made before the fix is not reused', soundKey(film) !== soundKey(cutFilm));
  ok('the music\'s accents keep off the still stretches too (scene starts and landings only)', musicCuesOf(film).every((t) => !inStill(stills, t)) && same(musicCuesOf(film), musicCuesOf(cutFilm)),
    musicCuesOf(film));

  // The picture: inside each stretch every frame is the hold moment's frame, call for call; so the cues follow the painter.
  // (Each moment is painted twice and the second kept: the first fills the text layout cache, and a warm frame
  // measures nothing, so only warm frames are compared.)
  const W = 640, H = 360;
  const frame = (t) => {
    paint(makeCanvas(W, H).ctx, film, t, { width: W, height: H, clear: true });
    const { ctx, calls } = makeCanvas(W, H);
    paint(ctx, film, t, { width: W, height: H, clear: true });
    return JSON.stringify(calls.map((c) => [c.name, c.args, c.m, c.alpha]));
  };
  const frozen = stills.map((s) => {
    const still = frame(s.from);
    return [s.from + (s.cut - s.from) / 3, s.from + (2 * (s.cut - s.from)) / 3, s.cut - 0.01].every((t) => frame(t) === still);
  });
  const moving = frame(1) !== frame(stills[0].from);
  ok('the painter agrees: inside each stretch every frame is the hold moment\'s, call for call (and before the hold the picture moves)', frozen.every(Boolean) && moving, frozen);
}

{
  // The rule's edges, on a small film: a title in scene 1, then a push at 3 s.
  const L = (o) => ({ kind: 'text', text: 'Words', size: 6, pin: 'mc', x: 0, y: 0, start: 0, end: 3, ...o });
  const slide = { fx: 'slide', d: 0.5, delay: 0, ease: 'linear' };
  const film = (layers, transition = 'push') => withSound(readMotion({ id: 'edge', title: 'e', seconds: 6, layers,
    scenes: [{ start: 0 }, transition ? { start: 3, transition } : { start: 3 }] }, NOW), { mode: 'fx', level: 1 }, NOW);
  const base = [L({ id: 'a', in: slide, out: { ...slide, d: 0.6 } })];
  const hold = sceneHold(film(base), 0);
  ok('the setup: the title\'s exit starts at 2.4 s, which is where scene 1 holds still', Math.abs(hold - 2.4) < 1e-9, hold);

  // A layer arriving inside the still stretch and staying past the cut: the new scene's picture is the first to show it.
  const late = [...base, L({ id: 'b', start: 2.6, end: 5, in: slide })];
  const lateCues = soundCues(film(late)).filter((c) => c.layer === 'b');
  ok('a layer that arrives while scene 1 stands still and stays into scene 2 is heard at the cut, when the new picture brings it in',
    lateCues.length >= 1 && lateCues.every((c) => c.t >= 3) && lateCues.some((c) => c.kind === 'whoosh' && c.t === 3), lateCues.map((c) => `${c.kind}@${c.t}`));
  const lateCut = soundCues(film(late, null)).filter((c) => c.layer === 'b');
  ok('(joined by a cut, it is heard where it arrives, at 2.6 s)', lateCut.some((c) => c.kind === 'whoosh' && Math.abs(c.t - 2.6) < 1e-9), lateCut.map((c) => `${c.kind}@${c.t}`));
  // One that arrives there and is gone by the cut is never seen at all.
  const unseen = soundCues(film([...base, L({ id: 'c', start: 2.6, end: 3, in: { ...slide, d: 0.2 } })])).filter((c) => c.layer === 'c');
  ok('a layer that arrives and is gone inside the still stretch is never seen, and never heard', unseen.length === 0, unseen);
  // A big title landing there is not a music accent.
  const big = [...base, L({ id: 'd', size: 14, start: 2.5, end: 3, in: { fx: 'pop', d: 0.3, delay: 0, ease: 'linear' } })];
  const accents = musicCuesOf(withSound(film(big), { mode: 'both', level: 0.6 }, NOW));
  const accentsCut = musicCuesOf(withSound(film(big, null), { mode: 'both', level: 0.6 }, NOW));
  ok('a big title landing inside the still stretch is no accent for the music (it is one when the scenes meet by a cut)',
    !accents.some((t) => t > 2.4 && t < 3) && accentsCut.some((t) => t > 2.4 && t < 3), { accents, accentsCut });
  // The last scene, and a layer across the cut, leave as designed.
  const across = [...base, L({ id: 'e', start: 1, end: 5.5, out: slide })];
  const acrossCues = soundCues(film(across)).filter((c) => c.layer === 'e' && c.rev);
  ok('a layer that runs across the cut leaves in scene 2, where it is drawn: its exit still sounds', acrossCues.length === 1 && Math.abs(acrossCues[0].t - 5) < 1e-9, acrossCues);
}

{
  // A graphic without scenes: the same cues as before the fix. The digest below was taken from the cue derivation
  // as it was on `pro` at e6a619f (before this fix), over the corpus `noSceneCorpus` makes. It covers what the fix
  // could change about a cue (what, when, how long, how loud, which way, whose); pan and pitch are left out so that
  // the owner's ear (R2 request 4: PAN_WIDTH) can move them without retaking it. Retake it only if a template's
  // animation, or the cue rules themselves, are changed on purpose.
  const BEFORE = { docs: 1784, cues: 13884, sha256: '2be2f2bd82811b1e763e2d7de66f00833bee2e813443fa9219a5cf3b08fcd2fb' };
  const docs = noSceneCorpus();
  const all = docs.map((d) => soundCues(d).map(timing));
  const got = { docs: docs.length, cues: all.reduce((s, c) => s + c.length, 0), sha256: createHash('sha256').update(JSON.stringify(all)).digest('hex') };
  ok(`a graphic without scenes sounds as before: every template in every shape, language and three levels, and 200 random graphics (${got.docs} graphics, ${got.cues} cues), the same cues as the derivation before the fix`,
    same(got, BEFORE), got);
  const one = docs[5];
  const withCuts = { ...one, scenes: [{ id: 's1', name: '', start: 0, end: 2 }, { id: 's2', name: '', start: 2, end: one.seconds }] };
  ok('and one whose scenes all meet by cuts sounds as it would with none', same(soundCues(withCuts), soundCues(one)));
}

/** Graphics without scenes: every template in every shape, language and three levels, and 200 random ones. */
function noSceneCorpus() {
  const docs = [];
  for (const id of RECIPE_IDS) for (const format of FORMAT_IDS) for (const lang of LANGUAGES) for (const level of [0.3, 0.6, 1]) {
    const d = buildMotion({ id: `g-${id}`, recipe: id, lang, format, now: 1 });
    d.sound = { mode: 'fx', level };
    docs.push(d);
  }
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pickOf = (a) => a[Math.floor(rnd() * a.length)];
  const kinds = ['text', 'shape', 'icon', 'counter', 'chart', 'backdrop', 'particles'];
  for (let i = 0; i < 200; i++) {
    const seconds = 1 + Math.floor(rnd() * 30);
    const layers = [];
    for (let j = 0; j < 1 + Math.floor(rnd() * 20); j++) {
      const start = rnd() * seconds;
      layers.push({
        kind: pickOf(kinds), id: `l${j}`, text: 'some words here', size: rnd() * 40, w: rnd() * 100, h: rnd() * 100, from: rnd() * 1000, to: rnd() * 1000,
        start, end: start + rnd() * seconds, pin: pickOf(['ts', 'mc', 'be', 'ms']), x: rnd() * 800 - 400, scale: rnd() * 3,
        in: rnd() < 0.8 ? { fx: pickOf(EFFECTS), d: rnd() * 3, delay: rnd(), ease: pickOf(['linear', 'back-out', 'spring']), by: pickOf(['all', 'word', 'char', 'line']), gap: rnd() } : undefined,
        out: rnd() < 0.5 ? { fx: pickOf(EFFECTS), d: rnd() * 2 } : undefined,
        loop: rnd() < 0.2 ? { fx: 'shimmer', d: rnd() * 5 } : undefined,
        count: { d: rnd() * 4, delay: rnd() }, burst: rnd() < 0.5,
      });
    }
    docs.push(readMotion({ id: `f${i}`, title: 'f', seconds, lang: pickOf(['en', 'ar']), format: pickOf(FORMAT_IDS), layers, sound: { mode: 'fx', level: Math.round(rnd() * 100) / 100 } }, 1));
  }
  return docs;
}
/** What the scene fix could change about a cue: what, when, how long, how loud, which way, whose. */
function timing(c) {
  return [c.kind, c.t, c.d, c.gain, c.rev, c.layer];
}

// ── 2. the audio library's readers ────────────────────────────────────────
console.log('audio readers');
{
  const trap = () => { throw new Error('trap'); };
  const traps = { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap };
  const revoked = (target) => { const p = Proxy.revocable(target, {}); p.revoke(); return p.proxy; };

  // The three reads, on their own.
  ok('rec: an object to read, or null for a list, a primitive, null or a revoked Proxy (whose Array.isArray throws)',
    rec({}) !== null && rec([]) === null && rec('x') === null && rec(null) === null && rec(revoked({})) === null && rec(revoked([])) === null);
  const getter = { get a() { throw new Error('g'); }, b: 2 };
  ok('own: the own field, read once in a try; an inherited one, a throwing getter, a trap or no object is not there',
    own(getter, 'b') === 2 && own(getter, 'a') === undefined && own(Object.create({ c: 1 }), 'c') === undefined && own(new Proxy({}, traps), 'x') === undefined && own(null, 'x') === undefined);
  const sparse = [];
  sparse.length = 2 ** 32 - 1;
  const holes = timed(() => listOf(sparse, 100));
  ok('listOf: at most `cap` indices, one at a time; a hole or a throwing index is undefined; a non-list, a Proxy whose length throws or a revoked list is null',
    !holes.error && holes.value.length === 100 && holes.value.every((v) => v === undefined) && holes.ms < 50
    && same(listOf([1, 2, 3], 2), [1, 2]) && listOf('abc', 9) === null && listOf(new Proxy([], traps), 9) === null && listOf(revoked([]), 9) === null
    && same(listOf(new Proxy([1, 2], { get: (t, k) => { if (k === '1') throw new Error('i'); return t[k]; } }), 9), [1, undefined]) && same(listOf([1], -3), []));

  // Never throws, on what the review threw at them.
  const throwing = { get lanes() { throw new Error('g'); }, get target() { throw new Error('g'); }, get points() { throw new Error('g'); }, get type() { throw new Error('g'); }, get attack() { throw new Error('g'); } };
  const hostile = [new Proxy({}, traps), new Proxy([], traps), revoked({}), revoked([]), throwing, new Proxy([1, 2, 3], { get: trap })];
  const readers = { readAutomation, readLane, readFx, readChain, readDuck, duckLaneFor };
  const threw = Object.entries(readers).flatMap(([n, f]) => hostile.map((x, i) => (timed(() => f(x)).error ? `${n}#${i}` : null)).filter(Boolean));
  ok('readAutomation, readLane, readFx, readChain, readDuck and duckLaneFor: a Proxy that throws (object, list, list whose get throws), a revoked one (object, list), throwing getters: no throw',
    threw.length === 0, threw);
  ok('what they return for those is what nothing gives: no lanes, no lane, no effect, no chain, the defaults, a lane that stays at 1',
    hostile.every((x) => readAutomation(x).lanes.length === 0 && readLane(x) === undefined && readFx(x) === undefined && readChain(x).length === 0
      && same(readDuck(x), readDuck({})) && same(duckLaneFor(x), duckLaneFor([]))));

  // Four billion holes, a million entries.
  const walks = { readChain: () => readChain(sparse), readAutomation: () => readAutomation({ lanes: sparse }), readLane: () => readLane({ target: 'volume', points: sparse }),
    duckLaneFor: () => duckLaneFor(sparse), renderChain: () => renderChain([new Float32Array(64)], 48000, sparse) };
  const ms = Object.entries(walks).map(([n, f]) => { const g = timed(f); return [n, g.error ? String(g.error) : Math.round(g.ms)]; });
  ok(`a sparse list of 2^32-1 is read at once by each (${ms.map(([n, v]) => `${n} ${v} ms`).join(', ')}; readChain took about 57 s)`, ms.every(([, v]) => typeof v === 'number' && v < 300), ms);
  const million = new Array(1_000_000).fill({ type: 'eq', lowGain: 1 });
  const big = timed(() => readChain(million));
  ok(`a chain of a million effects: the first ${MAX_CHAIN}, at once (${big.ms.toFixed(1)} ms)`, big.value.length === MAX_CHAIN && big.ms < 50);

  // A bad entry is that entry skipped.
  const lane = readLane({ target: 'volume', points: [{ t: 0, v: 1 }, new Proxy({}, traps), , { get t() { throw new Error('g'); }, v: 3 }, revoked({}), { t: 2, v: 0.5 }] });
  ok('a lane keeps its readable points around a Proxy, a hole, a throwing getter and a revoked point', same(lane.points, [{ t: 0, v: 1 }, { t: 2, v: 0.5 }]), lane.points);
  const chain = readChain([{ type: 'eq', id: 'x' }, , new Proxy({}, traps), { type: 'delay', id: 'x', get mix() { throw new Error('g'); } }]);
  ok('a chain keeps its readable effects; a knob whose getter throws is its default; an id used before is dropped', chain.length === 2 && chain[0].id === 'x' && !('id' in chain[1])
    && chain[1].mix === readFx({ type: 'delay' }).mix, chain);
  const auto = readAutomation({ lanes: [revoked({}), { target: 'rate', points: [{ t: 1, v: 2 }] }, , new Proxy({}, traps)] });
  ok('an automation keeps its readable lanes', auto.lanes.length === 1 && auto.lanes[0].target === 'rate', auto);
  const ducked = duckLaneFor([{ start: 1, end: 2 }, new Proxy({}, traps), , revoked({}), { start: 4, get end() { throw new Error('g'); } }]);
  ok('a duck keeps its readable spans', same(ducked, duckLaneFor([{ start: 1, end: 2 }])), ducked);

  // Inherited fields are not fields; -0 is 0.
  const inh = (o) => Object.create(o);
  ok('an inherited target, points, lanes, type, knob or setting is not read', readLane(inh({ target: 'volume', points: [] })) === undefined
    && readAutomation(inh({ lanes: [{ target: 'volume', points: [{ t: 0, v: 1 }] }] })).lanes.length === 0 && readFx(inh({ type: 'eq' })) === undefined
    && readFx({ type: 'eq', ...{}, __proto__: { lowGain: 9 } }).lowGain === 0 && readDuck(inh({ depth: 0.9 })).depth === 0.25
    && same(duckLaneFor([inh({ start: 1, end: 2 })]), duckLaneFor([])));
  const z = readLane({ target: 'volume', points: [{ t: -0, v: -0 }] }).points[0];
  ok('{ t: -0, v: -0 } reads back as { t: 0, v: 0 } (it was -0), and so do a knob and a duck setting', Object.is(z.t, 0) && Object.is(z.v, 0)
    && Object.is(readFx({ type: 'eq', midGain: -0 }).midGain, 0) && Object.is(readDuck({ threshold: -0 }).threshold, 0) && Object.is(readDuck({ depth: '-0' }).depth, 0), z);

  // What they read is still what they read: fixed points, and the old behaviour (pro-audio.test.mjs holds the rest).
  const fx = readChain([{ type: 'eq', lowGain: 3, id: 'a' }, { type: 'filter', mode: 'lowpass', slope: '24' }, { type: 'compressor', ratio: 99 }, { type: 'limiter', truePeak: false },
    { type: 'delay', time: 1 }, { type: 'reverb', seed: 3.7 }]);
  const lanes = readAutomation({ lanes: [{ target: 'volume', points: [{ t: 2, v: 9 }, { t: 1, v: 0.5, curve: 'bezier', viaX: 0.2, viaY: 0.9 }] }] });
  const duck = readDuck({ depth: 0.5, attack: 0.2 });
  ok('what reads is read as before, and reading it again changes nothing', same(readChain(fx), fx) && same(readAutomation(lanes), lanes) && same(readDuck(duck), duck)
    && fx[1].slope === 24 && fx[2].ratio === 20 && fx[3].truePeak === false && fx[4].time === 10 && fx[5].seed === 4 && lanes.lanes[0].points[1].v === 4 && duck.lead === 0.2);
}

// ── 3. the Export tab's platform test ─────────────────────────────────────
console.log('platform');
{
  const src = (f) => readFileSync(`src/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  const platform = src('platform.ts');
  const exportTab = src('MotionExport.tsx');
  const welcome = src('Welcome.tsx');
  ok('platform.ts imports nothing and says only which computer this is', !/\bimport\b/.test(platform) && /export const IS_MAC = typeof navigator !== 'undefined' && \/Mac\/i\.test\(navigator\.userAgent\);/.test(platform));
  ok('the Export tab takes IS_MAC from it, not from Welcome.tsx', /import \{ IS_MAC \} from '\.\/platform';/.test(exportTab) && !/from '\.\/Welcome'/.test(exportTab));
  ok('Welcome.tsx re-exports the same one, so App, Slides, Settings and Research are unchanged', /import \{ IS_MAC \} from '\.\/platform';/.test(welcome) && /export \{ IS_MAC \};/.test(welcome)
    && !/export const IS_MAC/.test(welcome));
}

// ── 4. the layer panel's limits ───────────────────────────────────────────
console.log('layer panel');
{
  const require = createRequire(import.meta.url);
  let esbuild = null;
  try { esbuild = require('esbuild'); } catch { esbuild = null; }
  ok('esbuild is there to build the inspector', !!esbuild);
  if (esbuild) {
    esbuild.buildSync({
      entryPoints: ['src/MotionKinds.tsx', 'src/MotionControls.tsx'], bundle: true, format: 'esm', outdir: '.test-build/pro-fixes', logLevel: 'error',
      external: ['react', 'react-dom', '@tauri-apps/api/core', '@codemirror/state'],
    });
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { TextContent } = await import('../.test-build/pro-fixes/MotionKinds.js');
    const { storedOf } = await import('../.test-build/pro-fixes/MotionControls.js');
    const t = (s) => s;
    const quiet = console.error;
    const doc = readMotion({ id: 'k', title: 'k', seconds: 6, layers: [{ id: 'w', kind: 'text', text: 'Hi', size: 3, outline: { width: 1 } }] }, NOW);
    /** The Width field under Stroke: its ceiling, as the box tells a screen reader. */
    const widthMax = (size) => {
      const layer = { ...doc.layers[0], size, outline: { color: 'bg', width: 1 } };
      console.error = () => {};
      let html;
      try { html = renderToStaticMarkup(createElement(TextContent, { t, layer, doc, set: () => {}, update: () => {} })); } finally { console.error = quiet; }
      const row = html.slice(html.lastIndexOf('>Width<'));
      return Number(/aria-valuemax="([^"]+)"/.exec(row)?.[1]);
    };
    const sizes = [1, 3, 7.7, 25, 40, 60, 200];
    const offered = sizes.map(widthMax);
    ok(`a word's outline offers what the reader keeps for its size: ${sizes.map((s, i) => `${s}u words ${offered[i]}u`).join(', ')}`,
      sizes.every((s, i) => offered[i] === textOutlineMax(s)) && offered[1] === 2 && offered[5] === 20, offered);
    // And what the box offers is what the reader keeps: a width at the ceiling reads back unchanged.
    const back = sizes.map((s, i) => readMotion({ ...doc, layers: [{ ...doc.layers[0], size: s, outline: { color: 'bg', width: storedOf(1e9, 0, offered[i], 1, 2) } }] }, NOW).layers[0].outline.width);
    ok('typing past it sends the ceiling, and the reader keeps that ceiling as it is (no snapping back)', back.every((w, i) => w === storedOf(1e9, 0, offered[i], 1, 2)), back);
    ok('a box never sends past its edge because of rounding: 2.6665u (5.333u words) kept to two places is 2.66, not 2.67, and the reader keeps it',
      storedOf(2.6665, 0, textOutlineMax(5.333), 1, 2) === 2.66 && readMotion({ ...doc, layers: [{ ...doc.layers[0], size: 5.333, outline: { color: 'bg', width: 2.66 } }] }, NOW).layers[0].outline.width === 2.66);
    ok('and otherwise rounds and holds exactly as before: 5 is 5, 25 is held to 20, 50% is 0.5, -3 is held to 0, a round edge stays itself (and a floor of -0.335 is -0.33, not -0.34)',
      storedOf(5, 0, 20, 1, 2) === 5 && storedOf(25, 0, 20, 1, 2) === 20 && storedOf(50, 0, 100, 100, 0) === 0.5 && storedOf(-3, 0, 20, 1, 2) === 0
      && storedOf(7, 0, 7, 100, 0) === 0.07 && storedOf(0.333333, -1, 1, 1, 2) === 0.33 && storedOf(-1, -0.335, 1, 1, 2) === -0.33);
  }
  // The shadow's blur field is in MotionLayers.tsx, which F2 may not edit; see docs/pro/f2-fixes.md for the one line it needs.
  ok('the shadow ceiling the blur field must offer is exported for it (twice the type size, 4u to 100u)', textShadowMax(3) === 6 && textShadowMax(1) === 4 && textShadowMax(60) === 100);
}

// ── 5. docs/MOTION.md ─────────────────────────────────────────────────────
console.log('docs');
{
  const md = readFileSync('../docs/MOTION.md', 'utf8').replace(/\s+/g, ' ');
  const limits = md.slice(md.indexOf('**Limits.**'), md.indexOf('**No figure the model made up.**'));
  ok('"Limits" names the dash ceiling with the code\'s number', limits.includes('at most 4,000 dashes (`MAX_DASHES`)') && MAX_DASHES === 4000);
  ok('and the words\' outline and shadow ceilings, with the code\'s numbers', limits.includes('Words\' outlines are at most half their type size and their shadows\' blur twice it (2u and 4u at the least, 20u and 100u at the most')
    && textOutlineMax(0) === 2 && textShadowMax(0) === 4 && textOutlineMax(1000) === 20 && textShadowMax(1000) === 100 && textOutlineMax(10) === 5 && textShadowMax(10) === 20);
  ok('the opening names the safety review\'s closure scan and its trapped network', md.includes('`test/pro-review-safety.test.mjs` reads everything they import, and runs the studio with the network trapped'));
  ok('and the Sound paragraph says the still stretch before a transition is silent', md.includes('Nothing is heard while a scene holds still for the transition after it'));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
