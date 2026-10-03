// The pro pass under attack: review R1, safety, readers and the promises
// (docs/pro/review-safety.md says what was attacked, what broke and why).
//
// What matters:
//
//   - Every reader of data from outside — a stored graphic, a model's answer,
//     a hand edit, a remembered choice, a search box — given hostile values
//     (wrong types, NaN, Infinity, 1e308, -0, ten megabytes of text, objects
//     100,000 deep, `__proto__` and `constructor` keys, Proxies that throw or
//     are revoked, cycles, a million entries, four billion holes): never
//     throws, never hangs (each call is timed, and the whole run is watched
//     from outside, so a hang is a failure naming the call, not a stuck
//     chain), keeps what it returns inside `LIMITS`, and reading what it
//     returned changes nothing.
//   - The promises SAFETY.md and docs/MOTION.md make about Motion hold for
//     everything Motion's code can reach, not only its own files: the network
//     modules and Tauri commands in its import closure are a pinned list; at
//     run time nothing asks for the network; only Export writes a file; the
//     storage it names is the storage there is, in all four languages.
//   - A document can no longer buy unbounded work: a dash finer than a stroke
//     can afford is widened, words' outlines and shadows are held to their
//     type size, "Fix all" runs the check a bounded number of times. Each
//     regression found by this review has its own test here, named R1-n.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { makeCanvas, offscreens } from './motioncanvas.mjs';
import { MAX_DASHES, readMotion, readLayer, textOutlineMax, textShadowMax } from '../.test-build/motionread.js';
import { readSound, renderSoundBed, soundCues } from '../.test-build/motionsound.js';
import { readScenes } from '../.test-build/motionscene.js';
import { readTransition } from '../.test-build/motiontransition.js';
import { readBrand, applyBrand } from '../.test-build/motionbrand.js';
import { MAX_OPS, applyOps, PRO_OPS } from '../.test-build/motionchatops.js';
import { foldSearch, recentRecipes, searchRecipes, searchWords } from '../.test-build/motionsearch.js';
import { readPrefs, settingsFor, FIRST_PREFS, DESTINATIONS } from '../.test-build/motionshare.js';
import { GIF, gifFrames, gifPlan, renderGif } from '../.test-build/motiongifops.js';
import { checkMotion, autofix } from '../.test-build/motioncheck.js';
import { journalOf } from '../.test-build/motionstate.js';
import { readAutomation, readLane } from '../.test-build/audioauto.js';
import { MAX_CHAIN, readChain, readFx } from '../.test-build/audiofx.js';
import { duckLaneFor, readDuck } from '../.test-build/audioduck.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { META } from '../.test-build/motionrecipe.js';
import { paint } from '../.test-build/motiondraw.js';
import { fitPath, parsePath, pathLength } from '../.test-build/motionmath.js';
import { FORMAT_IDS, LANGUAGES, LIMITS, RECIPE_IDS } from '../.test-build/motiontypes.js';

// ── the hostile matrix, run in a worker the main thread watches ───────────
//
// A hang in a reader would hang `npm test` with no word of which call it was.
// So the matrix runs in a worker that says which call it is starting; the main
// thread terminates it if it goes quiet and names the call in flight.

const NOW = 1_700_000_000_000;
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** Every hostile value, made fresh where it is used (a Proxy cannot cross to another thread). */
function hostileValues() {
  const trap = () => { throw new Error('trap'); };
  const traps = { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap, defineProperty: trap, set: trap };
  const revokedObj = Proxy.revocable({}, {});
  revokedObj.revoke();
  const revokedArr = Proxy.revocable([], {});
  revokedArr.revoke();
  let deep = {};
  for (let i = 0; i < 100_000; i++) deep = { a: deep, layers: deep, mode: deep, start: deep, name: deep, op: 'scene.add', kind: deep };
  let deepList = [];
  for (let i = 0; i < 100_000; i++) deepList = [deepList];
  const cyc = { id: 'c', kind: 'text', mode: 'music', start: 1 };
  cyc.self = cyc;
  cyc.layers = [cyc, cyc];
  cyc.sound = cyc;
  cyc.scenes = [cyc, cyc];
  cyc.palette = cyc;
  const cycList = [];
  cycList.push(cycList, cycList);
  const sparse = [];
  sparse.length = 2 ** 32 - 1;
  const holes = new Array(40);
  const getters = {
    get mode() { throw new Error('g'); }, get start() { throw new Error('g'); }, get name() { throw new Error('g'); },
    get layers() { throw new Error('g'); }, get kind() { throw new Error('g'); }, get length() { throw new Error('g'); },
  };
  return {
    undefined: undefined, null: null, true: true, zero: 0, negZero: -0, NaN: NaN, Infinity: Infinity, negInfinity: -Infinity,
    e308: 1e308, negE308: -1e308, tiny: 5e-324, word: 'music', empty: '', tenMB: 'x'.repeat(10_000_000),
    bidi: String.fromCharCode(0x202e) + 'evil' + String.fromCharCode(0xd800), symbol: Symbol('s'), bigint: 10n, fn: () => 1,
    noPrimitive: { toString: trap, valueOf: trap, [Symbol.toPrimitive]: trap }, emptyList: [],
    proxy: new Proxy({}, traps), proxyList: new Proxy([], traps), proxyListGet: new Proxy([1, 2, 3], { get: trap }),
    revoked: revokedObj.proxy, revokedList: revokedArr.proxy, deep, deepList, cyc, cycList, getters,
    protoJson: JSON.parse('{"__proto__":{"mode":"music","name":"x","kind":"text","start":3,"polluted":1},"constructor":"x","toString":1,"id":"__proto__"}'),
    inherited: Object.create({ mode: 'music', name: 'Inh', kind: 'gif', paletteId: 'sunset', target: 'volume', points: [{ t: 0, v: 1 }], layers: [{ kind: 'text' }] }),
    million: new Array(1_000_000).fill({ start: 1, kind: 'text', op: 'title' }), sparse, holes,
    date: new Date(NaN), map: new Map([['mode', 'music']]), nullProto: Object.create(null),
  };
}

/** The readers, each a function of one hostile value; `again` reads the output back where that means anything. */
function readers() {
  const doc = buildMotion({ id: 'h', recipe: 'big-title', lang: 'en', format: 'landscape', now: NOW });
  const three = readMotion({ ...doc, seconds: 9, scenes: [{ start: 0 }, { start: 3, transition: 'push' }, { start: 6, transition: 'fade' }] }, NOW);
  const kit = { name: 'Acme', handle: 'acme', logo: PNG, paletteId: 'sunset' };
  const ops = (x) => applyOps(three, x, NOW, '', { brand: kit });
  return {
    readMotion: { f: (x) => readMotion(x, NOW), again: (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW) },
    'readMotion.sound': { f: (x) => readMotion({ ...doc, sound: x }, NOW), again: (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW) },
    'readMotion.scenes': { f: (x) => readMotion({ ...doc, scenes: x }, NOW), again: (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW) },
    'readMotion.layers': { f: (x) => readMotion({ ...doc, layers: x }, NOW), again: (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW) },
    'readMotion.layer': { f: (x) => readMotion({ ...doc, layers: [x, { kind: 'shape', shape: 'path', d: 'M0 0 L100 100', stroke: { dash: [x, x] }, shadow: x }] }, NOW) },
    'readMotion.recipe': { f: (x) => readMotion({ ...doc, recipe: { id: 'big-title', fields: x } }, NOW), again: (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW) },
    readLayer: { f: (x) => readLayer(x, { seconds: x }) },
    readSound: { f: readSound, again: readSound },
    readScenes: { f: (x) => readScenes(x, [], 12), again: (s) => readScenes(s, [], 12) },
    'readScenes.seconds': { f: (x) => readScenes([{ start: 0 }, { start: 2, transition: 'fade' }], [], x) },
    readTransition: { f: readTransition, again: readTransition },
    'readTransition.max': { f: (x) => readTransition('fade', x) },
    readBrand: { f: readBrand, again: readBrand },
    applyBrand: { f: (x) => applyBrand(doc, x, NOW) },
    'applyOps.ops': { f: ops },
    'applyOps.op': { f: (x) => ops([x]) },
    'applyOps.fields': { f: (x) => ops(PRO_OPS.map((op) => ({ op, at: x, scene: x, name: x, transition: x, kind: x, d: x, dir: x, ease: x, to: x, before: x, mode: x, mood: x, level: x }))) },
    'applyOps.said': { f: (x) => applyOps(three, [{ op: 'title', value: 'x' }], NOW, x) },
    'applyOps.options': { f: (x) => applyOps(three, [{ op: 'brand.apply' }, { op: 'check.fix' }], NOW, '', x) },
    'applyOps.now': { f: (x) => applyOps(three, [{ op: 'title', value: 'x' }], x) },
    searchRecipes: { f: (x) => searchRecipes(x, 'ar') },
    'searchRecipes.lang': { f: (x) => searchRecipes('title', x) },
    foldSearch: { f: foldSearch }, searchWords: { f: searchWords },
    recentRecipes: { f: (x) => recentRecipes(x) }, 'recentRecipes.most': { f: (x) => recentRecipes([doc], x) },
    readPrefs: { f: readPrefs, again: readPrefs },
    'settingsFor.choices': { f: (x) => settingsFor('loop', doc, x) }, 'settingsFor.dest': { f: (x) => settingsFor(x, doc, {}) },
    checkMotion: { f: (x) => checkMotion(x) }, 'checkMotion.options': { f: (x) => checkMotion(doc, x) },
    'autofix.findings': { f: (x) => autofix(doc, x) }, 'autofix.ids': { f: (x) => autofix(doc, [], x) },
    // The journal is a string from localStorage: the value itself, and the value as JSON where JSON can write it.
    journalOf: { f: (x) => [journalOf(x), journalOf(jsonOf(x))] },
    // The audio library's readers (docs/pro/requests/R1.md, item 1): no outside data reaches them yet, and these hold
    // them to the same promise for when it does. Each value is read as itself and in the field the reader reads lists from.
    readAutomation: { f: readAutomation, again: readAutomation },
    'readAutomation.lanes': { f: (x) => readAutomation({ lanes: x }), again: readAutomation },
    'readAutomation.lane': { f: (x) => readAutomation({ lanes: [x, { target: 'volume', points: x }, { target: 'rate', points: [x, { t: 1, v: 2 }] }] }), again: readAutomation },
    readLane: { f: readLane, again: readLane },
    'readLane.points': { f: (x) => readLane({ target: 'volume', points: x }), again: readLane },
    'readLane.point': { f: (x) => readLane({ target: 'fx.a.mix', points: [x, { t: x, v: x, curve: x, viaX: x, viaY: x }, { t: 2, v: 1, curve: 'bezier', viaX: x, viaY: 0.5 }] }), again: (l) => readLane(l) },
    readFx: { f: readFx, again: readFx },
    'readFx.knobs': { f: (x) => ['eq', 'filter', 'compressor', 'limiter', 'delay', 'reverb'].map((type) => readFx({ type, id: x, on: x, mode: x, slope: x, truePeak: x, lowGain: x, freq: x, ratio: x, ceiling: x, time: x, seed: x, size: x })) },
    readChain: { f: readChain, again: readChain },
    'readChain.entry': { f: (x) => readChain([x, { type: 'eq', id: 'a' }, x, { type: 'delay', id: 'a' }]), again: readChain },
    readDuck: { f: readDuck, again: readDuck },
    'readDuck.fields': { f: (x) => readDuck({ depth: x, attack: x, release: x, hold: x, lead: x, threshold: x, range: x, minSpeech: x }), again: readDuck },
  };
}

/** `x` as JSON, or null where JSON cannot write it (a cycle, a BigInt, a Proxy, too deep). */
function jsonOf(x) {
  try {
    return JSON.stringify(x) ?? null;
  } catch {
    return null;
  }
}

/** Every number in a value finite and never -0; at most `budget` nodes looked at. */
function numbersSound(x, seen = new Set(), budget = { n: 200_000 }) {
  if (budget.n-- <= 0) return true;
  if (typeof x === 'number') return Number.isFinite(x) && !Object.is(x, -0);
  if (!x || typeof x !== 'object' || seen.has(x)) return true;
  seen.add(x);
  for (const v of Object.values(x)) if (!numbersSound(v, seen, budget)) return false;
  return true;
}

/** Whether a graphic is inside every ceiling `LIMITS` names, and the ones this review added. */
function withinLimits(m) {
  if (m === null) return true;
  const why = [];
  if (!(m.seconds >= LIMITS.minSeconds && m.seconds <= LIMITS.seconds)) why.push('seconds');
  if (m.layers.length > LIMITS.layers) why.push('layers');
  let particles = 0;
  for (const l of m.layers) {
    if (Math.abs(l.x) > LIMITS.reach || Math.abs(l.y) > LIMITS.reach || l.scale > LIMITS.scale) why.push('place');
    if (l.kind === 'text') {
      if (Array.from(l.text).length > LIMITS.text || l.size > LIMITS.fontSize) why.push('text');
      if (l.outline && l.outline.width > textOutlineMax(l.size) + 1e-9) why.push('outline');
      if (l.shadow && l.shadow.blur > textShadowMax(l.size) + 1e-9) why.push('shadow');
    }
    if (l.kind === 'particles') particles += l.count;
    if (l.kind === 'shape' && l.stroke?.dash && dashCount(l) > MAX_DASHES + 1e-6) why.push('dash');
    if (l.kind === 'image' && !(l.src === '' || l.src.startsWith('data:image/'))) why.push('picture');
  }
  if (particles > LIMITS.particleBudget) why.push('particles');
  if (m.scenes) {
    if (m.scenes.length < 2 || m.scenes.length > LIMITS.scenes) why.push('scene count');
    m.scenes.forEach((s, i) => {
      if (s.end - s.start < LIMITS.sceneMin - 1e-6) why.push('scene length');
      if (s.transition && (s.transition.d < LIMITS.transitionMin - 1e-9 || s.transition.d > LIMITS.transitionMax + 1e-9 || i === 0)) why.push('transition');
    });
  }
  if (m.sound && !(m.sound.level >= 0 && m.sound.level <= 1)) why.push('level');
  return why;
}

/** How many dashes a shape's stroke is cut into, measured here by the test's own route to the same length. */
function dashCount(l) {
  const period = l.stroke.dash[0] + l.stroke.dash[1];
  if (l.shape === 'line') return l.w / period;
  if (l.shape !== 'path') return 0; // the other outlines are measured by motionread itself; the path is where the length lives
  const p = parsePath(l.d, LIMITS.path);
  return p ? pathLength(fitPath(p, l.w, l.h)) / period : 0;
}

if (!isMainThread) {
  // ── the worker: run the matrix, saying what starts ────────────────────────
  const values = hostileValues();
  const rs = readers();
  const out = { bad: [], slow: [], calls: 0, worst: { ms: 0, at: '' } };
  for (const [rn, r] of Object.entries(rs)) {
    for (const [vn, v] of Object.entries(values)) {
      parentPort.postMessage({ start: `${rn}(${vn})` });
      const t0 = performance.now();
      let got;
      try {
        got = r.f(v);
      } catch (e) {
        out.bad.push(`${rn}(${vn}) threw ${String(e?.message ?? e).slice(0, 60)}`);
        continue;
      }
      const ms = performance.now() - t0;
      out.calls++;
      if (ms > out.worst.ms) out.worst = { ms, at: `${rn}(${vn})` };
      if (ms > 1500) out.slow.push(`${rn}(${vn}) ${ms.toFixed(0)} ms`);
      const m = got && typeof got === 'object' && 'motion' in got ? got.motion : got;
      if (m && typeof m === 'object' && Array.isArray(m.layers) && 'palette' in m) {
        const why = withinLimits(m);
        if (why.length) out.bad.push(`${rn}(${vn}) outside LIMITS: ${why.join(', ')}`);
      }
      if (!numbersSound(got)) out.bad.push(`${rn}(${vn}) holds a number that is not finite, or -0`);
      if (r.again && got !== undefined && got !== null) {
        try {
          const back = r.again(got);
          if (JSON.stringify(back) !== JSON.stringify(got)) out.bad.push(`${rn}(${vn}) is not a fixed point`);
        } catch (e) {
          out.bad.push(`${rn}(${vn}) threw on its own output`);
        }
      }
    }
  }
  parentPort.postMessage({ done: out });
} else {
  await main();
}

async function main() {
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

  // ── 1. every reader against every hostile value ─────────────────────────
  console.log('hostile values');
  {
    const result = await new Promise((resolve) => {
      const w = new Worker(new URL(import.meta.url), { resourceLimits: { stackSizeMb: 8 } });
      let current = '(nothing yet)';
      let last = Date.now();
      const watch = setInterval(() => {
        if (Date.now() - last > 20_000) {
          clearInterval(watch);
          void w.terminate();
          resolve({ hung: current });
        }
      }, 250);
      w.on('message', (msg) => {
        last = Date.now();
        if (msg.start) current = msg.start;
        if (msg.done) {
          clearInterval(watch);
          void w.terminate();
          resolve(msg.done);
        }
      });
      w.on('error', (e) => {
        clearInterval(watch);
        resolve({ crashed: `${current}: ${String(e?.message ?? e)}` });
      });
    });
    ok('no reader hangs (each call watched from outside, 20 s of silence is a hang)', !result.hung, result.hung);
    ok('no reader takes the worker down', !result.crashed, result.crashed);
    if (result.calls !== undefined) {
      const n = Object.keys(readers()).length * Object.keys(hostileValues()).length;
      ok(`${n} hostile calls across ${Object.keys(readers()).length} readers: none throws, each output inside LIMITS, finite, never -0, and a fixed point`,
        result.bad.length === 0 && result.calls === n, result.bad.slice(0, 12));
      ok(`and none takes more than 1.5 s (the slowest: ${result.worst.at}, ${result.worst.ms.toFixed(0)} ms)`, result.slow.length === 0, result.slow);
    }
  }

  // ── 2. random structured fuzz: fixed points and limits ──────────────────
  console.log('random documents');
  {
    let s = 0x2026_1003;
    const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
    const pick = (a) => a[Math.floor(r() * a.length)];
    const nums = [0, -0, 1, -1, 0.5, 1e-7, 1e308, -1e308, NaN, Infinity, 5e-324, 0.15, 0.1499, 1.5, 1.5001, 30, 30.0001, 2147483648, 99.99, 100, 100.01, 0.6, 0.004, -0.004, 1.004, 600, 601, 0.02, 3000];
    const strs = ['', ' ', 'music', 'MUSIC ', 'fx', 'both', 'off', 'calm', 'Lo-Fi', 'push', 'fade', 'glitch', 'end', 'start', 'left', '__proto__', 'constructor',
      '0x10', '1e3', ' 7 ', '7px', 'Infinity', '-0', 'x'.repeat(90), 'https://http://example.com/', '@@handle name', '#fff', 'rgb(1,2,3)', 'url(http://x)',
      'midnight', 'sunset', 'bold', 'serif', PNG, 'data:image/svg+xml;base64,AAAA', 'http://example.com/a.png', 'text', 'shape', 'particles', 'path',
      'M0 0 L100 100 L0 0 L100 100 L0 0 Z', 'race', 'type', 'char', 'word', 'mp4', 'gif', 'png', '4k', 'very-high'];
    const leaf = () => { const k = r(); return k < 0.4 ? pick(nums) : k < 0.8 ? pick(strs) : k < 0.85 ? null : k < 0.9 ? undefined : r() < 0.5; };
    const KEYS = ['mode', 'level', 'mood', 'seed', 'start', 'end', 'duration', 'name', 'title', 'id', 'transition', 'kind', 'd', 'dir', 'ease', 'fx', 'type',
      'handle', 'url', 'logo', 'paletteId', 'palette', 'voice', 'size', 'quality', 'blur', 'gifSide', 'gifFps', 'format', 'shape', 'w', 'h', 'stroke', 'dash',
      'width', 'outline', 'shadow', 'text', 'count', 'style', 'layers', 'scenes', 'sound', 'seconds', 'fps', 'in', 'out', 'by', 'sides', 'inner', '__proto__'];
    const val = (depth = 0) => {
      const k = r();
      if (depth > 4 || k < 0.45) return leaf();
      if (k < 0.7) return Array.from({ length: Math.floor(r() * 7) }, () => val(depth + 1));
      const o = {};
      for (let i = Math.floor(r() * 7); i > 0; i--) Object.defineProperty(o, pick(KEYS), { value: val(depth + 1), enumerable: true, configurable: true, writable: true });
      return o;
    };
    const fixed = {
      readSound: [readSound, readSound], readScenes: [(x) => readScenes(x, [], 14), (x) => readScenes(x, [], 14)], readBrand: [readBrand, readBrand],
      readPrefs: [readPrefs, readPrefs], readTransition: [readTransition, readTransition],
      readMotion: [(x) => readMotion(x, NOW), (m) => readMotion(JSON.parse(JSON.stringify(m)), NOW)],
    };
    const bad = [];
    let docs = 0;
    for (let i = 0; i < 3000; i++) {
      const x = val();
      for (const [name, [read, again]] of Object.entries(fixed)) {
        let a, b;
        try {
          a = read(x);
          b = a === null || a === undefined ? a : again(a);
        } catch (e) {
          bad.push(`${name} threw`);
          continue;
        }
        if (JSON.stringify(a) !== JSON.stringify(b) || !numbersSound(a)) bad.push(`${name}: ${JSON.stringify(x).slice(0, 160)}`);
        if (name === 'readMotion' && a) {
          docs++;
          const why = withinLimits(a);
          if (why.length) bad.push(`limits ${why}: ${JSON.stringify(x).slice(0, 160)}`);
        }
      }
      // And a document shaped like one, with layers, scenes and sound from the same stream.
      const m = readMotion({ id: `r${i}`, seconds: pick(nums), layers: Array.from({ length: 1 + Math.floor(r() * 8) }, () => ({ ...val(1), kind: pick(['text', 'shape', 'particles', 'chart', 'counter', 'backdrop', 'icon', 'image']), shape: pick(['path', 'star', 'rect', 'wave', 'line', 'burst']), d: pick(strs), stroke: { dash: [pick(nums), pick(nums)], width: pick(nums) }, text: pick(strs), size: pick(nums), outline: { width: pick(nums) }, shadow: { blur: pick(nums) }, sides: pick(nums), inner: pick(nums), w: pick(nums), h: pick(nums) })), scenes: val(1), sound: val(1) }, NOW);
      if (m) {
        docs++;
        const back = readMotion(JSON.parse(JSON.stringify(m)), NOW);
        const why = withinLimits(m);
        if (!same(back, m) || why.length || !numbersSound(m)) bad.push(`document ${i}: ${why.join(',') || 'not a fixed point'}`);
      }
    }
    ok(`3,000 random values through six readers, and ${docs} documents: every output a fixed point, finite, never -0, inside LIMITS`, bad.length === 0, bad.slice(0, 6));
  }

  // ── 3. the regressions this review found ────────────────────────────────
  console.log('regressions');
  const doc = buildMotion({ id: 'g', recipe: 'big-title', lang: 'en', format: 'landscape', now: NOW });
  const three = readMotion({ ...doc, seconds: 9, scenes: [{ start: 0 }, { start: 3, transition: 'push' }, { start: 6, transition: 'fade' }] }, NOW);
  {
    // R1-1: applyOps promised "pure and total", and read the list it was handed outside its try.
    const trap = () => { throw new Error('trap'); };
    const proxyList = new Proxy([], { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
    const lengthThrows = new Proxy([{ op: 'title', value: 'x' }], { get: (t, k) => { if (k === 'length') throw new Error('length'); return t[k]; } });
    const holes = new Array(20);
    const sparse = [];
    sparse.length = 2 ** 32 - 1;
    const got = [proxyList, lengthThrows, holes, sparse].map((ops) => timed(() => applyOps(three, ops, NOW)));
    ok('R1-1 an answer that is a Proxy list, a list whose length throws, twenty holes or four billion: no throw, nothing changes',
      got.every((g) => !g.error && g.value.motion === three), got.map((g) => String(g.error ?? '')));
    ok('R1-1 and the ops past the twelfth are still counted as too many', got[2].value?.skipped.some((n) => n.code === 'too-many' && n.count === 20 - MAX_OPS)
      && got[3].value?.skipped.some((n) => n.code === 'too-many' && n.count === 2 ** 32 - 1 - MAX_OPS) && got[3].ms < 200, got[3].ms);
    const mixed = [{ op: 'title', value: 'Kept' }];
    mixed.length = 3;
    const r = applyOps(three, mixed, NOW);
    ok('R1-1 a hole in a real answer is that op skipped, not the answer', r.motion.title === 'Kept' && r.skipped.some((n) => n.code === 'invalid'), r.skipped);
  }
  {
    // R1-2: the search box and the recent row read anything as text, a list as a list.
    const trap = () => { throw new Error('trap'); };
    const queries = [new Proxy({}, { get: trap }), Object.create(null), Symbol('s'), { toString: trap }, [1, 2], 10n, null, undefined, true];
    const got = queries.map((q) => timed(() => [searchRecipes(q, 'en'), foldSearch(q), searchWords(q)]));
    ok('R1-2 a search of something that is not words is no search: every template, no throw', got.every((g) => !g.error && g.value[0].length === RECIPE_IDS.length),
      got.map((g) => String(g.error ?? '')));
    ok('R1-2 a number typed is searched as its digits', foldSearch(42) === '42' && searchWords(2026).join() === '2026');
    const sparse = [];
    sparse.length = 2 ** 32 - 1;
    const recent = [7, 'x', null, new Proxy([], { get: trap }), sparse].map((list) => timed(() => recentRecipes(list)));
    ok('R1-2 the recent row of something that is not a list of graphics is empty, at once (four billion holes was a hang)',
      recent.every((g) => !g.error && g.value.length === 0 && g.ms < 100), recent.map((g) => [String(g.error ?? ''), g.ms.toFixed(0)]));
    const inherited = recentRecipes([{ recipe: { id: 'constructor' }, updated: 3 }, { recipe: { id: '__proto__' }, updated: 2 }, { recipe: { id: 'toString' }, updated: 4 }, { recipe: { id: 'quote' }, updated: 1 }]);
    ok('R1-2 a template is one of META\'s own: "constructor", "__proto__" and "toString" are not templates', same(inherited, ['quote']), inherited);
    ok('R1-2 and "most" that is not a count is none', recentRecipes([doc], NaN).length === 0 && recentRecipes([doc], Symbol('s')).length === 0
      && same(recentRecipes([doc], Infinity), ['big-title']));
  }
  {
    // R1-3: remembered choices are read from the object's own fields, and a Proxy is no choice at all.
    const trap = () => { throw new Error('trap'); };
    const hostile = [new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap }), (() => { const p = Proxy.revocable({}, {}); p.revoke(); return p.proxy; })(),
      Object.create({ kind: 'gif', size: '4k', blur: true, gifSide: 1080 }), { get size() { throw new Error('g'); }, kind: 'png' }];
    const read = hostile.map((x) => timed(() => readPrefs(x)));
    ok('R1-3 readPrefs of a Proxy, a revoked one, inherited fields or a throwing getter: the first choices, no throw',
      read.slice(0, 3).every((g) => !g.error && same(g.value, FIRST_PREFS)) && !read[3].error && read[3].value.kind === 'png' && read[3].value.size === FIRST_PREFS.size,
      read.map((g) => String(g.error ?? JSON.stringify(g.value))));
    const settings = [null, 7, hostile[0], hostile[1]].map((c) => timed(() => settingsFor('picture', doc, c)));
    ok('R1-3 settingsFor with choices that are null, a number or a Proxy: the first choices, no throw', settings.every((g) => !g.error && g.value.kind === 'png' && g.value.frame === 'best'),
      settings.map((g) => String(g.error ?? '')));
    const odd = ['__proto__', 'toString', 'constructor'].map((format) => settingsFor('custom', { ...doc, format }, {}));
    ok('R1-3 a shape named "__proto__" or "toString" is the landscape it falls back to, never a NaN size', odd.every((s) => s.from === 'landscape' && Number.isFinite(s.width) && Number.isFinite(s.height)),
      odd.map((s) => [s.from, s.width]));
  }
  {
    // R1-4: a dash finer than its stroke can afford is widened in proportion; the template's dotted rule is as it was.
    const zig = 'M0 0' + ' L100 100 L0 0'.repeat(200);
    const raw = (dash, o = {}) => ({ id: 'z', seconds: 6, layers: [{ id: 's', kind: 'shape', shape: 'path', d: zig, w: 600, h: 600, fill: null, stroke: { width: 1, dash }, ...o }] });
    const m = readMotion(raw([0.025, 0.025]), NOW);
    const l = m.layers[0];
    const span = pathLength(fitPath(parsePath(zig, LIMITS.path), 600, 600));
    ok(`R1-4 a 0.05u dash along a ${Math.round(span).toLocaleString('en')}u path (6.8 million dashes, 290 ms a frame in WebKit) is widened under ${MAX_DASHES} dashes`,
      l.stroke.dash && span / (l.stroke.dash[0] + l.stroke.dash[1]) <= MAX_DASHES && span / (l.stroke.dash[0] + l.stroke.dash[1]) > MAX_DASHES * 0.9, l.stroke.dash);
    ok('R1-4 in the same rhythm (dash and gap in proportion), and reading it again changes nothing', Math.abs(l.stroke.dash[0] / l.stroke.dash[1] - 1) < 1e-9
      && same(readMotion(JSON.parse(JSON.stringify(m)), NOW), m));
    const uneven = readMotion(raw([0.01, 0.03]), NOW).layers[0].stroke.dash;
    ok('R1-4 an uneven pattern keeps its proportion', uneven && Math.abs(uneven[1] / uneven[0] - 3) < 1e-9, uneven);
    const kinds = [
      { shape: 'star', sides: 24, inner: 0.05, w: 600, h: 600, d: undefined }, { shape: 'burst', sides: 24, inner: 0.05, w: 600, h: 600, d: undefined },
      { shape: 'wave', sides: 24, w: 600, h: 600, d: undefined }, { shape: 'rect', w: 600, h: 600, d: undefined }, { shape: 'line', w: 600, h: 4, d: undefined },
      { shape: 'blob', w: 600, h: 600, seed: 9, d: undefined }, { shape: 'ellipse', w: 600, h: 600, d: undefined }, { shape: 'arc', w: 600, h: 600, sweep: 360, d: undefined },
    ];
    const fine = kinds.map((k) => readMotion(raw([0.03, 0.03], k), NOW).layers[0]);
    ok('R1-4 every kind of outline dashed every 0.06u is widened, and is a fixed point', fine.every((x) => x.stroke.dash && x.stroke.dash[0] > 0.03
      && same(readLayer(JSON.parse(JSON.stringify(x)), { seconds: 6 }), x)), fine.map((x) => [x.shape, x.stroke.dash]));
    const sane = readMotion(raw([2, 1], { shape: 'ellipse', w: 60, h: 60, d: undefined }), NOW).layers[0].stroke.dash;
    ok('R1-4 a dash any design uses is kept exactly', same(sane, [2, 1]), sane);
    const dotted = RECIPE_IDS.flatMap((id) => buildMotion({ id: 't', recipe: id, lang: 'en', format: 'landscape', now: NOW }).layers).filter((x) => x.kind === 'shape' && x.stroke?.dash);
    ok(`R1-4 the templates' own dashes (${dotted.length}) are untouched`, dotted.length > 0 && dotted.every((x) => same(x.stroke.dash, [0.24, 3.1])), dotted.map((x) => x.stroke.dash));
    const { ctx, calls } = makeCanvas(1920, 1080);
    paint(ctx, m, 1, { width: 1920, height: 1080, clear: true });
    const set = calls.filter((c) => c.name === 'setLineDash').map((c) => c.args[0]);
    ok('R1-4 and the drawing asks the canvas for that wider pattern', set.some((d) => d.length === 2 && d[0] >= l.stroke.dash[0] * 10.8 - 1e-6), set);
  }
  {
    // R1-5: "Fix all" and the chat's check.fix ran the check without a ceiling on how many times.
    const sparse = [];
    sparse.length = 2 ** 32 - 1;
    const trap = () => { throw new Error('trap'); };
    const got = [sparse, [new Proxy({}, { get: trap }), null, 7, { id: 7 }], new Proxy([], { get: trap })].map((f) => timed(() => autofix(doc, f)));
    ok('R1-5 autofix of four billion holes, of findings that throw or are not findings: no throw, nothing changes, at once (the holes were 50 s)',
      got.every((g) => !g.error && g.value === doc && g.ms < 200), got.map((g) => [String(g.error ?? ''), g.ms.toFixed(0)]));
    const ids = timed(() => autofix(doc, [], sparse));
    ok('R1-5 and so is a list of ids of four billion holes', !ids.error && ids.value === doc && ids.ms < 200, ids.ms);
    // A graphic built to fail: thirty small words packed so that growing any collides, and thirty against the edges whose repairs work, one a round.
    const L = [];
    for (let i = 0; i < 30; i++) L.push({ id: `a${i}`, kind: 'text', text: `Tiny words packed in ${i}`, size: 1.2, pin: 'mc', x: (i % 6) * 9 - 25, y: Math.floor(i / 6) * 2.2 - 5, start: 0, end: 30 });
    for (let i = 0; i < 30; i++) L.push({ id: `b${i}`, kind: 'text', text: `Edge ${i}`, size: 2.5, pin: i % 2 ? 'ts' : 'bs', x: -2 + (i % 15) * 12, y: 0, start: 0, end: 30 });
    const hard = readMotion({ id: 'w', seconds: 30, layers: L }, NOW);
    const measure = { ctx: makeCanvas(1920, 1080).ctx };
    const before = checkMotion(hard, measure);
    const fix = timed(() => autofix(hard, before, undefined, measure));
    const after = checkMotion(fix.value, measure);
    ok(`R1-5 a graphic built to keep "Fix all" busy is done in ${fix.ms.toFixed(0)} ms (${before.length} tips, ${after.length} after), and is better, not worse`,
      !fix.error && fix.ms < 4000 && after.length < before.length && after.filter((f) => f.severity === 'warn').length <= before.filter((f) => f.severity === 'warn').length,
      [String(fix.error ?? ''), fix.ms, before.length, after.length]);
    const check = [new Proxy({}, { get: trap }), { layers: sparse }, { layers: new Proxy([], { get: trap }) }, { layers: Array.from({ length: 10_000 }, (_, i) => ({ id: `t${i}`, kind: 'text', text: 'overlap' })) }]
      .map((d) => timed(() => checkMotion(d, measure)));
    ok('R1-5 the check of a Proxy, four billion holes or ten thousand layers: no throw, at once (it looks at the layers a graphic may have)',
      check.every((g) => !g.error && Array.isArray(g.value) && g.ms < 1500), check.map((g) => [String(g.error ?? ''), g.ms.toFixed(0)]));
  }
  {
    // R1-6: words' outlines and shadows are held to their type size.
    const raw = (size, width, blur) => readMotion({ id: 'o', layers: [{ id: 't', kind: 'text', text: 'Hello', size, outline: { width }, shadow: { blur } }] }, NOW).layers[0];
    const small = raw(3, 20, 100);
    const big = raw(60, 20, 100);
    ok('R1-6 3u words: a 20u outline is 2u, a 100u shadow 6u', small.outline.width === 2 && small.shadow.blur === 6, [small.outline.width, small.shadow.blur]);
    ok('R1-6 60u words keep the old ceilings, 20u and 100u', big.outline.width === 20 && big.shadow.blur === 100, [big.outline.width, big.shadow.blur]);
    ok('R1-6 and a label keeps its own floor: 1u words may have a 2u outline and a 4u shadow', raw(1, 5, 5).outline.width === 2 && raw(1, 5, 5).shadow.blur === 4);
    ok('R1-6 the caps are a fixed point', same(readLayer(JSON.parse(JSON.stringify(small)), { seconds: 6 }), small));
    let worst = 0;
    for (const id of RECIPE_IDS) for (const format of FORMAT_IDS) for (const lang of LANGUAGES) {
      for (const x of buildMotion({ id: 't', recipe: id, lang, format, now: NOW }).layers) {
        if (x.kind !== 'text') continue;
        if (x.shadow) worst = Math.max(worst, x.shadow.blur / textShadowMax(x.size));
        if (x.outline) worst = Math.max(worst, x.outline.width / textOutlineMax(x.size));
      }
    }
    ok(`R1-6 every template in every shape and language stays well inside (its closest: ${(worst * 100).toFixed(0)}% of the cap)`, worst > 0 && worst < 0.5, worst);
  }
  {
    // R1-7: a sound's level is never -0.
    const z = [-0, '-0', -0.004, '-0.001'].map((level) => readSound({ mode: 'fx', level }));
    ok('R1-7 a level of -0, "-0" or a hair under zero is 0, not -0', z.every((s) => Object.is(s.level, 0)), z.map((s) => Object.is(s.level, -0)));
  }
  {
    // The new RecipeMeta fields: data, read by the search and the prompt. Held to what both readers assume.
    const bad = [];
    for (const [id, m] of Object.entries(META)) {
      if (m.tags !== undefined && (!Array.isArray(m.tags) || m.tags.some((t) => typeof t !== 'string' || !t.trim() || t.length > 40))) bad.push(`${id}: tags`);
      for (const k of ['useWhen', 'avoidWhen']) if (m[k] !== undefined && (typeof m[k] !== 'string' || m[k].length > 400 || /[\u0000-\u001f]/.test(m[k]))) bad.push(`${id}: ${k}`);
      if (m.pairsWith !== undefined && (!Array.isArray(m.pairsWith) || m.pairsWith.some((p) => !Object.prototype.hasOwnProperty.call(META, p) || p === id))) bad.push(`${id}: pairsWith`);
    }
    ok(`every template's tags, notes and pairings (${Object.keys(META).length}) are words, short, and name templates that exist`, bad.length === 0, bad);
  }

  // ── 4. the audio library's readers (not yet fed outside data; hardened by F2, docs/pro/requests/R1.md item 1) ──
  console.log('audio library');
  {
    let deep = {};
    for (let i = 0; i < 100_000; i++) deep = { lanes: deep, points: deep, target: deep };
    const plain = [undefined, null, 0, NaN, 1e308, -0, 'volume', '', 'x'.repeat(1_000_000), [], {}, deep, JSON.parse('{"__proto__":{"target":"volume"},"lanes":[{"target":"constructor","points":[{"t":1e308,"v":-1e308}]}]}'),
      { lanes: new Array(1_000_000).fill({ target: 'volume', points: [{ t: 0, v: 1 }] }) }, { target: 'volume', points: new Array(1_000_000).fill({ t: 1, v: 2 }) }];
    const fns = { readAutomation, readLane, readFx, readChain, readDuck };
    const bad = [];
    for (const [n, f] of Object.entries(fns)) for (const x of plain) {
      const g = timed(() => f(x));
      if (g.error || g.ms > 1500 || !numbersSound(g.value)) bad.push(`${n}: ${String(g.error ?? g.ms)}`);
    }
    ok('readAutomation, readLane, readFx, readChain, readDuck: anything JSON can hold, a million entries, 100,000 deep — no throw, at once, finite', bad.length === 0, bad);
    // What the review found and asked for (docs/pro/requests/R1.md, item 1), each now held. The whole hostile matrix
    // above runs the five as well; these name the cases the review measured.
    const trap = () => { throw new Error('trap'); };
    const traps = { get: trap, has: trap, ownKeys: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap };
    const revoked = (target) => { const p = Proxy.revocable(target, {}); p.revoke(); return p.proxy; };
    const throwing = { get lanes() { throw new Error('g'); }, get target() { throw new Error('g'); }, get points() { throw new Error('g'); }, get type() { throw new Error('g'); }, get depth() { throw new Error('g'); } };
    const hostile = { proxy: new Proxy({}, traps), proxyList: new Proxy([], traps), revoked: revoked({}), revokedList: revoked([]), getters: throwing };
    const threw = [];
    for (const [n, f] of Object.entries(fns)) for (const [hn, x] of Object.entries(hostile)) if (timed(() => f(x)).error) threw.push(`${n}(${hn})`);
    ok('R1 item 1: a Proxy whose traps throw, a revoked Proxy (object or list) and throwing getters throw out of none of the five (all five threw on at least one)',
      threw.length === 0, threw);
    const inner = [
      timed(() => readAutomation({ lanes: [hostile.proxy, { target: 'volume', points: [hostile.revoked, { t: 0, v: 0.5 }, throwing] }] })),
      timed(() => readLane({ target: 'volume', points: hostile.proxyList })),
      timed(() => readChain([hostile.proxy, { type: 'eq', lowGain: 3 }, throwing, hostile.revoked])),
      timed(() => readFx({ type: 'eq', get lowGain() { throw new Error('g'); }, midGain: 2 })),
    ];
    ok('and a bad entry inside a good list is that entry skipped, not the list: the readable lane, the readable effect, the readable knob are kept',
      inner.every((g) => !g.error) && inner[0].value.lanes.length === 1 && inner[0].value.lanes[0].points.length === 1 && inner[0].value.lanes[0].points[0].v === 0.5
      && same(inner[1].value, { target: 'volume', points: [] }) && inner[2].value.length === 1 && inner[2].value[0].lowGain === 3
      && inner[3].value.lowGain === 0 && inner[3].value.midGain === 2, inner.map((g) => String(g.error ?? JSON.stringify(g.value)).slice(0, 120)));
    const sparse = [];
    sparse.length = 2 ** 32 - 1;
    const walks = [() => readChain(sparse), () => readAutomation({ lanes: sparse }), () => readLane({ target: 'volume', points: sparse }), () => duckLaneFor(sparse)]
      .map((f) => timed(f));
    ok(`readChain of four billion holes is at once (${walks[0].ms.toFixed(1)} ms; it was about 57 s), and so are the lanes', the points' and the spans' (${walks.slice(1).map((g) => g.ms.toFixed(1)).join(', ')} ms)`,
      walks.every((g) => !g.error && g.ms < 300) && walks[0].value.length === 0, walks.map((g) => [String(g.error ?? ''), g.ms.toFixed(0)]));
    const looked = readChain([...Array.from({ length: MAX_CHAIN * 4 }, () => 'junk'), { type: 'eq' }]);
    ok(`readChain looks at the first ${MAX_CHAIN * 4} entries: an effect after that many entries of junk is not read`, looked.length === 0
      && readChain([...Array.from({ length: MAX_CHAIN * 4 - 1 }, () => 'junk'), { type: 'eq' }]).length === 1);
    const inherited = Object.create({ target: 'volume', points: [{ t: 0, v: 1 }], lanes: [{ target: 'volume', points: [{ t: 0, v: 1 }] }], type: 'eq', depth: 0.9 });
    ok('only an object\'s own fields are read: an inherited target, lanes, type or depth is not there',
      readLane(inherited) === undefined && readAutomation(inherited).lanes.length === 0 && readFx(inherited) === undefined && readDuck(inherited).depth === readDuck({}).depth);
    const zero = readLane({ target: 'volume', points: [{ t: -0, v: -0 }, { t: 1, v: -0.5, curve: 'bezier', viaX: -0, viaY: -0 }] });
    const zeroFx = readFx({ type: 'eq', lowGain: -0, midGain: '-0' });
    const zeroDuck = readDuck({ depth: -0, hold: -0, lead: -0, threshold: -0, minSpeech: -0 });
    ok('-0 is read as 0 everywhere: a point\'s time and value ({ t: -0, v: -0 } read back as -0), a knob, a duck setting',
      Object.is(zero.points[0].t, 0) && Object.is(zero.points[0].v, 0) && Object.is(zero.points[1].v, 0) && Object.is(zeroFx.lowGain, 0) && Object.is(zeroFx.midGain, 0)
      && ['depth', 'hold', 'lead', 'threshold', 'minSpeech'].every((k) => Object.is(zeroDuck[k], 0)), [zero.points, zeroFx.lowGain, zeroDuck]);
  }

  // ── 5. the promises: what Motion's code can reach ───────────────────────
  console.log('the promises');
  const SRC = new URL('../src/', import.meta.url);
  const ROOT = new URL('../../', import.meta.url);
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const text = (f) => readFileSync(new URL(f, SRC), 'utf8');
  const motionFiles = readdirSync(SRC).filter((f) => /^(motion.*\.ts|Motion.*\.tsx|audio.*\.ts|loudness\.ts)$/.test(f)).sort();
  /** A file's run-time imports: static and dynamic, never `import type`; local ones resolved, packages by name. */
  const importsOf = (f) => {
    const s = strip(text(f));
    const specs = [];
    for (const m of s.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) if (!m[1]) specs.push(m[2]);
    for (const m of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
    const local = [];
    const pkgs = [];
    for (const p of specs) {
      if (!p.startsWith('.')) { pkgs.push(p); continue; }
      const b = p.replace(/^\.\//, '');
      const hit = ['.ts', '.tsx'].map((e) => b + e).find((x) => existsSync(new URL(x, SRC)));
      if (hit) local.push(hit);
    }
    return { local, pkgs };
  };
  const closure = new Set();
  const pkgs = new Map();
  const stack = [...motionFiles];
  while (stack.length) {
    const f = stack.pop();
    if (closure.has(f)) continue;
    closure.add(f);
    const { local, pkgs: p } = importsOf(f);
    for (const x of p) pkgs.set(x, [...(pkgs.get(x) ?? []), f]);
    stack.push(...local);
  }
  const NET = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.connection|import\(\s*['"`]https?:/;
  const net = [...closure].filter((f) => NET.test(strip(text(f)))).sort();
  // Each file that can reach the network and is reachable from Motion, and why that is not a request of Motion's.
  // (account.ts and gateway.ts were here, reached through MotionExport.tsx -> Welcome.tsx -> SignIn.tsx for one boolean,
  // IS_MAC; it now comes from platform.ts, which imports nothing: docs/pro/requests/R1.md, item 2.)
  const REACHED = {
    'generate.ts': 'the one request Motion causes: the model the person asks (SAFETY.md, the request table)',
    'videomix.ts': 'through videosynth.ts, which takes encodeWav, sceneStarts and toDataUrl from it: pure functions (checked below)',
    'videomedia.ts': 'imported by videomix.ts for its picture search, which nothing in Motion calls',
  };
  ok(`Motion's run-time import closure is ${closure.size} files; the ones that can reach the network are exactly the pinned list, each for a stated reason`,
    same(net, Object.keys(REACHED).sort()), { found: net, pinned: Object.keys(REACHED).sort() });
  ok(`and none of Motion's own ${motionFiles.length} files is one of them`, motionFiles.every((f) => !net.includes(f)));
  const signIn = ['Welcome.tsx', 'SignIn.tsx', 'account.ts', 'gateway.ts', 'environment.ts'].filter((f) => closure.has(f));
  ok('Motion reaches no network module of the sign-in screen: Welcome, SignIn, account, gateway and environment are outside its closure, and the Export tab takes IS_MAC from platform.ts, which imports nothing',
    signIn.length === 0 && closure.has('platform.ts') && importsOf('platform.ts').local.length === 0 && importsOf('platform.ts').pkgs.length === 0
    && importsOf('MotionExport.tsx').local.includes('platform.ts') && !importsOf('MotionExport.tsx').local.includes('Welcome.tsx'), signIn);
  const synth = strip(text('videosynth.ts'));
  const fromMix = /import\s*\{([^}]*)\}\s*from\s*'\.\/videomix'/.exec(synth)?.[1].split(',').map((x) => x.trim()).filter(Boolean).sort();
  const mix = strip(text('videomix.ts'));
  const bodyOf = (name) => {
    const at = mix.search(new RegExp(`export (?:async )?function ${name}\\b`));
    if (at < 0) return null;
    let depth = 0;
    for (let i = mix.indexOf('{', mix.indexOf(')', at)); i < mix.length; i++) {
      if (mix[i] === '{') depth++;
      if (mix[i] === '}' && --depth === 0) return mix.slice(at, i + 1);
    }
    return null;
  };
  ok('videosynth.ts takes exactly encodeWav, sceneStarts and toDataUrl from videomix.ts, and not one of them asks for the network or calls another module',
    same(fromMix, ['encodeWav', 'sceneStarts', 'toDataUrl']) && fromMix.every((n) => { const b = bodyOf(n); return b && !NET.test(b) && !/\binvoke\b|openverse|wikimedia|https?:/.test(b); }), fromMix);
  const sound = strip(text('motionsound.ts'));
  const used = [...new Set([...sound.matchAll(/synthMod\.(\w+)/g)].map((m) => m[1]))].sort();
  ok('motionsound.ts calls only arrange and render of the composer it imports', same(used, ['arrange', 'render']), used);

  const COMMAND = /invoke(?:<[^>]*>)?\(\s*'([a-z_|:]+)'/g;
  const commands = {};
  for (const f of closure) for (const m of strip(text(f)).matchAll(COMMAND)) commands[m[1]] = [...new Set([...(commands[m[1]] ?? []), f])];
  const PINNED = {
    export_write_video: ['motionexportops.ts'], open_exported: ['motionexportops.ts'], reveal_path: ['MotionExport.tsx'],
  };
  ok('the Tauri commands anywhere in that closure are the pinned three: the export, Open and Show in Finder (SignIn\'s list_tree and read_file are gone with it)',
    same(Object.keys(commands).sort(), Object.keys(PINNED).sort()) && Object.entries(PINNED).every(([c, fs]) => same(commands[c].sort(), fs)), commands);
  const tauri = [...pkgs.keys()].filter((p) => p.startsWith('@tauri-apps/')).sort();
  ok('and the only Tauri packages it imports are the core, the path helper and the save dialog — no shell, no http, no opener, no fs',
    same(tauri, ['@tauri-apps/api/core', '@tauri-apps/api/path', '@tauri-apps/plugin-dialog']), tauri);
  const writers = motionFiles.filter((f) => /\bwriteMotionFile\s*\(|'export_write_video'/.test(strip(text(f))));
  ok('a file is written only by the export: writeMotionFile and export_write_video appear in MotionExport.tsx and motionexportops.ts alone', same(writers, ['MotionExport.tsx', 'motionexportops.ts']), writers);
  const model = ['motionai.ts', 'motionchatops.ts', 'MotionChat.tsx', 'motiondirection.ts'];
  const reach = model.filter((f) => /\b(writeMotionFile|renderMp4|renderGif|renderPng|makeFile|export_write\w*|downloadsPath)\b/.test(strip(text(f))));
  ok('and nothing that reads the model\'s answer names a way to make or write one', reach.length === 0, reach);
  const startsExport = strip(text('MotionExport.tsx'));
  ok('the export starts only from the two buttons a person presses (Download, Save as…)', /onClick=\{download\}/.test(startsExport) && /onClick=\{\(\) => void saveAs\(\)\}/.test(startsExport)
    && !/^export (?:async )?function (?:download|saveAs|start)/m.test(startsExport));

  // Storage, and SAFETY in its four languages.
  const SAFETY = ['SAFETY.md', 'SAFETY.ar.md', 'SAFETY.ckb.md', 'SAFETY.kmr.md'].map((f) => [f, readFileSync(new URL(f, ROOT), 'utf8')]);
  const keys = new Set();
  for (const f of motionFiles) {
    const s = strip(text(f));
    if (!/localStorage/.test(s)) continue;
    for (const m of s.matchAll(/['"`](vylo\.[a-z0-9.\-_]+)['"`]/gi)) keys.add(m[1]);
  }
  ok(`Motion keeps ${keys.size} things in localStorage, and each is named in all four SAFETY files`, keys.size === 2 && [...keys].every((k) => SAFETY.every(([, s]) => s.includes(k))), [...keys]);
  const dbs = [...strip(text('motionstore.ts')).matchAll(/'(vylo-[a-z-]+)'/g)].map((m) => m[1]);
  ok('and two IndexedDB databases, each named in all four', same([...new Set(dbs)].sort(), ['vylo-motion', 'vylo-motion-brand']) && dbs.every((d) => SAFETY.every(([, s]) => s.includes(`\`${d}\``))), dbs);
  const rs = readFileSync(new URL('app/src-tauri/src/video.rs', ROOT), 'utf8');
  const kinds = [...(/pub fn of\(path: &Path\)[\s\S]*?match ext\.as_str\(\) \{([\s\S]*?)_ =>/.exec(rs)?.[1] ?? '').matchAll(/"([a-z0-9]+)"\s*=>/g)].map((m) => m[1]);
  ok(`the export command takes ${kinds.join(', ')}, and every SAFETY file names each and the GIF's two marks`, kinds.length === 6 && kinds.includes('gif')
    && SAFETY.every(([, s]) => kinds.every((k) => s.includes(`.${k}`)) && s.includes('GIF89a') && s.includes('GIF87a')), kinds);
  const caps = { MAX_VIDEO_BYTES: '1024 * 1024 * 1024', MAX_IMAGE_BYTES: '64 * 1024 * 1024', MAX_TEXT_BYTES: '5 * 1024 * 1024' };
  ok('and its byte ceilings are the ones SAFETY gives (1 GiB, 64 MiB, 5 MiB), in each language', Object.entries(caps).every(([k, v]) => rs.includes(`pub const ${k}: usize = ${v};`))
    && SAFETY.every(([f, s]) => (f === 'SAFETY.ar.md' ? /1 غيبيبايت/.test(s) && /64 ميبيبايت/.test(s) && /5 ميبيبايت/.test(s) : /1 GiB/.test(s) && /64 MiB/.test(s) && /5 MiB/.test(s))));
  ok('every SAFETY file names the files that make Motion\'s claims true', SAFETY.every(([, s]) => ['motionread.ts', 'motiondraw.ts', 'motionencode.ts', 'motionmp4.ts', 'motiongif.ts', 'motionsound.ts', 'motionstore.ts', 'motiontemplates.ts']
    .every((f) => s.includes(`app/src/${f}`))), SAFETY.map(([f, s]) => [f, ['motionread.ts', 'motiongif.ts', 'motionsound.ts'].filter((x) => !s.includes(x))]));

  // At run time: nothing asks for the network while Motion does everything it does without a person's model.
  {
    const asked = [];
    const record = (what) => (...a) => { asked.push(`${what} ${String(a[0]).slice(0, 80)}`); throw new Error(`motion asked for the network: ${what}`); };
    const keep = {
      fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket, EventSource: globalThis.EventSource,
      Image: globalThis.Image, FontFace: globalThis.FontFace, Worker: globalThis.Worker,
    };
    const pictures = [];
    globalThis.fetch = record('fetch');
    globalThis.XMLHttpRequest = function () { record('XMLHttpRequest')(); };
    globalThis.WebSocket = function (u) { record('WebSocket')(u); };
    globalThis.EventSource = function (u) { record('EventSource')(u); };
    globalThis.FontFace = function (n, src) { if (/url\(/i.test(String(src))) record('FontFace')(src); };
    globalThis.Worker = function (u) { record('Worker')(u); };
    globalThis.Image = class {
      constructor() { this.naturalWidth = 0; this.naturalHeight = 0; this.decoding = 'auto'; }
      set src(v) { pictures.push(String(v)); this._src = v; }
      get src() { return this._src; }
      decode() { return Promise.resolve(); }
    };
    let error = null;
    try {
      const kit = { name: 'Acme', handle: 'acme', url: 'https://acme.example', logo: PNG, paletteId: 'sunset', voice: 'serif' };
      for (const id of RECIPE_IDS) for (const lang of LANGUAGES) {
        const m = readMotion(buildMotion({ id: `n-${id}-${lang}`, recipe: id, lang, format: 'portrait', now: NOW }), NOW);
        const branded = applyBrand(m, kit, NOW);
        const { ctx } = makeCanvas(270, 480);
        for (const t of [0.2, m.seconds / 2, m.seconds - 0.1]) paint(ctx, branded, t, { width: 270, height: 480, clear: true });
        checkMotion(branded, { ctx });
        soundCues({ ...branded, sound: { mode: 'both' } });
      }
      const ops = applyOps(three, PRO_OPS.map((op) => ({ op, at: 2, scene: 2, name: 'Two', kind: 'push', mode: 'both', mood: 'calm', level: 0.5, to: 1 })), NOW, '', { brand: kit });
      const standIn = async (score, rate) => [0, 1].map(() => new Float32Array(Math.round(9 * rate)).fill(0.1));
      await renderSoundBed({ ...ops.motion, sound: { mode: 'both', level: 0.6 } }, { music: standIn, sampleRate: 8000 });
      await renderSoundBed({ ...ops.motion, sound: { mode: 'fx', level: 0.6 } }, { sampleRate: 8000 });
      const gifDeps = { canvas: (w, h) => makeCanvas(w, h).canvas, tick: async () => {} };
      await renderGif({ ...ops.motion, seconds: 2 }, { side: 48, fps: 6 }, gifDeps);
      searchRecipes('logo', 'ckb');
      settingsFor('loop', ops.motion, {});
    } catch (e) {
      error = e;
    } finally {
      Object.assign(globalThis, keep);
      for (const [k, v] of Object.entries(keep)) if (v === undefined) delete globalThis[k];
    }
    ok(`every template in every language built, branded with a logo, painted, checked, given sound and music, edited by every new op, saved as a GIF: no request (${pictures.length} pictures, every one data:)`,
      !error && asked.length === 0 && pictures.length > 0 && pictures.every((p) => p.startsWith('data:image/')), String(error ?? asked.slice(0, 3)));
  }

  // ── 6. resource ceilings, measured where Node can measure them ──────────
  console.log('ceilings');
  {
    const plan = gifPlan({ side: 3840, fps: 60, colors: 1e9 });
    const frames = gifFrames(30, plan.fps);
    ok(`a 4K, 60 fps GIF of a 30-second graphic is asked for: it is ${plan.side} px, ${plan.fps} a second, ${frames.frames} frames over ${frames.seconds} s`,
      plan.side === GIF.maxSide && plan.fps === GIF.maxFps && plan.colors === 256 && frames.frames === GIF.maxFps * GIF.seconds && frames.trimmed);
    const long = readMotion({ ...doc, fps: 60, seconds: 30 }, NOW);
    const s = settingsFor('loop', long, { gifSide: 3840, gifFps: 60 });
    ok('and the export tab offers no more than that, whatever was remembered', s.width <= GIF.maxSide && s.height <= GIF.maxSide && s.frames <= GIF.maxFps * GIF.seconds && s.bytes <= GIF.maxBytes, s);

    // The heaviest document LIMITS allows of each costly kind, painted once: the number of canvas calls is the frame's cost
    // in a form Node can count (WebKit's times are in docs/pro/review-safety.md).
    const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(8).slice(0, 500);
    const sink = readMotion({
      id: 'sink', seconds: 30, fps: 60,
      layers: Array.from({ length: 80 }, (_, i) => [
        { kind: 'text', text, size: 3, max: 90, in: { fx: 'rise', by: 'char', d: 3, gap: 0.001 }, outline: { width: 20 }, hi: 'dolor', hiStyle: 'box', shadow: { blur: 100 } },
        { kind: 'particles', count: 300, size: 50, style: 'bubbles', burst: false, speed: 3 },
        { kind: 'backdrop', style: 'halftone', density: 1 },
        { kind: 'shape', shape: 'path', d: 'M0 0' + ' L100 100 L0 0'.repeat(200), w: 600, h: 600, fill: null, stroke: { width: 1, dash: [0.025, 0.025] } },
      ][i % 4]),
      scenes: Array.from({ length: 20 }, (_, i) => ({ start: i * 1.5, transition: i % 2 ? 'fade' : 'glitch' })),
    }, NOW);
    ok('the heaviest document is held: 60 layers, 1,200 particles, 12 scenes, every dash and every text effect inside its cap',
      sink.layers.length === 60 && sink.layers.reduce((n, l) => n + (l.kind === 'particles' ? l.count : 0), 0) === LIMITS.particleBudget
      && sink.scenes.length === 12 && withinLimits(sink).length === 0, withinLimits(sink));
    // Counted on the frame's canvas and on the two a transition paints its scenes into.
    const callsOf = (t) => {
      const { ctx, calls } = makeCanvas(1920, 1080);
      const before = offscreens.map((c) => c.rec?.calls.length ?? 0);
      const frame = timed(() => paint(ctx, sink, t, { width: 1920, height: 1080, clear: true }));
      const extra = offscreens.reduce((n, c, i) => n + (c.rec?.calls.length ?? 0) - (before[i] ?? 0), 0);
      for (const c of offscreens) if (c.rec) c.rec.calls.length = 0;
      return { n: calls.length + extra, error: frame.error, ms: frame.ms };
    };
    const still = callsOf(1);
    const cut = callsOf(1.6);
    ok(`and a frame of it is ${still.n.toLocaleString('en')} canvas calls, ${cut.n.toLocaleString('en')} in a transition (two scenes): bounded`,
      !still.error && !cut.error && still.n > 10_000 && still.n < 600_000 && cut.n > still.n * 1.5 && cut.n < 1_200_000, [still.n, cut.n]);

    const busy = readMotion({
      id: 'busy', seconds: 30, sound: { mode: 'fx', level: 1 },
      layers: Array.from({ length: 60 }, (_, i) => ({ kind: i % 2 ? 'counter' : 'text', text: text.slice(0, 120), size: 20, start: (i * 0.5) % 29, in: { fx: 'type', d: 2 }, out: { fx: 'slide' }, from: 0, to: 1e12, count: { d: 20 } })),
    }, NOW);
    ok(`a graphic that asks for a sound at every turn gets at most 240 (${soundCues(busy).length})`, soundCues(busy).length <= 240);
    let last = performance.now();
    let longest = 0;
    const beat = setInterval(() => { const n = performance.now(); longest = Math.max(longest, n - last); last = n; }, 1);
    const bed = await renderSoundBed(busy, { sampleRate: 48000 });
    clearInterval(beat);
    ok(`and its 30 seconds of effects are made without holding the thread more than ${longest.toFixed(0)} ms at a time`, bed && bed.channels[0].length === 30 * 48000 && longest < 400, longest);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
