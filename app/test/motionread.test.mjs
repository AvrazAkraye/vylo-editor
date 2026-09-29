// Reading a motion graphic: the model's answer, a stored record, a file
// somebody edited by hand.
//
// What matters: nothing read is trusted and nothing read throws. Whatever
// arrives comes out a valid Motion — every number clamped, every word from its
// list, every colour checked and written one way, every list under its
// ceiling — or null when it is not a graphic at all. Reading twice changes
// nothing (a saved graphic must not drift a little on every launch). A picture
// is only ever a data:image/ URL, so drawing can never reach the network. Ids
// are unique, a highlight is in its words, and hostile input — prototype keys,
// cycles, deep nesting, megabytes of text, ten thousand layers — costs its own
// fields and a few milliseconds, never the studio.
import { readFileSync } from 'node:fs';
import {
  DEFAULT_PALETTE, blankLayer, cleanText, newLayerId, readAnim, readFields, readLayer, readLoop, readMotion,
  readPaint, readPalette,
} from '../.test-build/motionread.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the contract, read from its source so this test checks what it says ──
const typesSrc = readFileSync(new URL('../src/motiontypes.ts', import.meta.url), 'utf8');
const videoSrc = readFileSync(new URL('../src/videotypes.ts', import.meta.url), 'utf8');
const listIn = (src, name) => {
  const at = src.indexOf(`export const ${name}`);
  if (at < 0) return [];
  const open = src.indexOf('[', src.indexOf('=', at));
  return [...src.slice(open, src.indexOf(']', open)).matchAll(/'([^']*)'/g)].map((m) => m[1]);
};
const blockIn = (name) => {
  const at = typesSrc.indexOf(`export const ${name}`);
  return typesSrc.slice(at, typesSrc.indexOf('} as const;', at));
};
const LIMITS = Object.fromEntries([...blockIn('LIMITS').matchAll(/^\s*(\w+): ([\d_.]+),/gm)].map((m) => [m[1], Number(m[2].replace(/_/g, ''))]));
const FORMAT_IDS = [...blockIn('FORMATS').matchAll(/^\s*(\w+): \{ width/gm)].map((m) => m[1]);
const [EFFECTS, LOOPS, EASES, DIRS, SPLITS, VOICES, SHAPES, CHARTS, BACKDROPS, PARTICLES, BLENDS, TONES, PINS, RECIPE_IDS, LAYER_KINDS, LANGUAGES] = [
  'EFFECTS', 'LOOPS', 'EASES', 'DIRS', 'SPLITS', 'VOICES', 'SHAPES', 'CHARTS', 'BACKDROPS', 'PARTICLES', 'BLENDS', 'TONES', 'PINS',
  'RECIPE_IDS', 'LAYER_KINDS', 'LANGUAGES',
].map((n) => listIn(typesSrc, n));
const ICON_IDS = listIn(videoSrc, 'ICON_IDS');
ok('the contract\'s lists and limits were found in its source',
  EFFECTS.includes('fade') && EASES.includes('expo-out') && PINS.length === 9 && TONES.length === 5 && LAYER_KINDS.length === 8
  && ICON_IDS.includes('sparkle') && LANGUAGES.join() === 'en,ar,ckb,kmr' && FORMAT_IDS.join() === 'landscape,portrait,square,feed'
  && LIMITS.layers === 60 && LIMITS.image === 6000000 && LIMITS.reach === 400 && LIMITS.size === 600, { LIMITS, FORMAT_IDS });

// ── what a valid document is ──────────────────────────────────────────────
const NOW = 1_780_000_000_000;
const MOTION_KEYS = ['id', 'title', 'request', 'lang', 'format', 'fps', 'seconds', 'palette', 'backdrop', 'layers', 'recipe', 'ai', 'stage', 'error', 'created', 'updated'];
const BASE_KEYS = ['kind', 'id', 'name', 'start', 'end', 'pin', 'x', 'y', 'scale', 'rot', 'opacity', 'in', 'out', 'loop', 'shadow', 'blend', 'hidden', 'locked'];
const KIND_KEYS = {
  text: ['text', 'voice', 'size', 'weight', 'color', 'align', 'lead', 'track', 'caps', 'max', 'fit', 'hi', 'hiColor', 'hiStyle', 'outline'],
  shape: ['shape', 'w', 'h', 'radius', 'sides', 'inner', 'from', 'sweep', 'fill', 'seed', 'stroke', 'd'],
  icon: ['icon', 'size', 'color', 'weight', 'badge'],
  image: ['src', 'w', 'h', 'fit', 'radius'],
  counter: ['from', 'to', 'decimals', 'prefix', 'suffix', 'group', 'voice', 'size', 'weight', 'color', 'align', 'track', 'count'],
  chart: ['chart', 'w', 'h', 'data', 'colors', 'max', 'unit', 'labels', 'values', 'voice', 'size', 'color', 'thick', 'gap'],
  backdrop: ['style', 'colors', 'speed', 'density', 'seed'],
  particles: ['style', 'colors', 'count', 'size', 'speed', 'spread', 'burst', 'seed'],
};
const OPTIONAL = new Set(['in', 'out', 'loop', 'shadow', 'blend', 'hidden', 'locked', 'hi', 'hiColor', 'hiStyle', 'outline', 'stroke', 'd', 'badge']);
const HEX = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;
const IMAGE = /^data:image\/(?:png|jpeg);base64,/i;
const BAD_CHARS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u2028\u2029]/;
const LONE = /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && !Object.is(v, -0);
const within = (v, lo, hi) => isNum(v) && v >= lo - 1e-9 && v <= hi + 1e-9;
const chars = (s) => Array.from(s).length;
const colourOk = (c) => typeof c === 'string' && (TONES.includes(c) || (HEX.test(c) && !(c.length === 9 && c.endsWith('ff'))));
const hexOk = (c) => colourOk(c) && !TONES.includes(c);
const words = (s, max) => typeof s === 'string' && chars(s) <= max && !BAD_CHARS.test(s) && !LONE.test(s) && s === s.normalize('NFC') && !/[^\S\n]+$/m.test(s);
const line = (s, max) => words(s, max) && !s.includes('\n') && s === s.trim() && !/\s\s/.test(s);
const affix = (s, max) => typeof s === 'string' && chars(s) <= max && !BAD_CHARS.test(s) && !LONE.test(s) && !s.includes('\n');
function paintOk(p) {
  if (typeof p === 'string') return colourOk(p);
  if (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).join() !== 'kind,angle,stops') return false;
  const s = p.stops;
  return ['linear', 'radial', 'conic'].includes(p.kind) && within(p.angle, -360, 360) && Array.isArray(s) && s.length >= 2 && s.length <= LIMITS.stops
    && s.every((x, i) => Object.keys(x).join() === 'at,color' && within(x.at, 0, 1) && colourOk(x.color) && (i === 0 || s[i - 1].at <= x.at));
}
function easeOk(e) {
  if (EASES.includes(e)) return true;
  const m = /^bezier\(([^,()]+),([^,()]+),([^,()]+),([^,()]+)\)$/.exec(e);
  const n = m ? m.slice(1).map(Number) : [];
  return n.length === 4 && n.every(isNum) && within(n[0], 0, 1) && within(n[2], 0, 1) && within(n[1], -5, 5) && within(n[3], -5, 5);
}
function animOk(a, span) {
  return a && Object.keys(a).every((k) => ['fx', 'd', 'delay', 'ease', 'amount', 'dir', 'by', 'gap'].includes(k))
    && EFFECTS.includes(a.fx) && a.fx !== 'none' && within(a.d, 0.05, Math.max(0.05, span)) && within(a.delay, 0, span)
    && easeOk(a.ease) && within(a.amount, 0, 3) && (a.dir === undefined || DIRS.includes(a.dir))
    && (a.by === undefined || SPLITS.includes(a.by)) && (a.gap === undefined || within(a.gap, 0, 1));
}
/** Every rule a document must keep, as a list of the ones it breaks. */
function problems(m) {
  const bad = [];
  const need = (cond, what) => { if (!cond) bad.push(what); };
  // No undefined, no -0, no non-finite number, no function anywhere; only plain objects and arrays.
  const walk = (v, path, depth) => {
    if (depth > 12) return bad.push(`${path}: too deep`);
    if (v === undefined) bad.push(`${path}: undefined`);
    else if (typeof v === 'number' && !isNum(v)) bad.push(`${path}: number ${v}`);
    else if (typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') bad.push(`${path}: ${typeof v}`);
    else if (v && typeof v === 'object') {
      const proto = Object.getPrototypeOf(v);
      need(proto === Object.prototype || proto === Array.prototype, `${path}: not a plain object`);
      for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`, depth + 1);
    }
  };
  walk(m, 'm', 0);
  need(Object.keys(m).every((k) => MOTION_KEYS.includes(k)), `motion keys ${Object.keys(m)}`);
  need(typeof m.id === 'string' && m.id.trim() !== '' && m.id.length <= 128, 'id');
  need(line(m.title, LIMITS.title) && m.title !== '', `title ${JSON.stringify(m.title)}`);
  need(words(m.request, LIMITS.request), 'request');
  need(LANGUAGES.includes(m.lang), 'lang');
  need(FORMAT_IDS.includes(m.format), 'format');
  need([24, 30, 60].includes(m.fps), 'fps');
  need(within(m.seconds, 1, 30), 'seconds');
  need(m.palette && Object.keys(m.palette).join() === TONES.join() && TONES.every((t) => hexOk(m.palette[t])), 'palette');
  need(m.backdrop === null || paintOk(m.backdrop), 'backdrop');
  need(['new', 'ready'].includes(m.stage), `stage ${m.stage}`);
  need(m.ai === undefined || m.ai === true, 'ai');
  need(m.error === undefined || (words(m.error, 400) && m.error !== ''), 'error');
  need(within(m.created, 0, 8.64e15) && within(m.updated, 0, 8.64e15), 'times');
  if (m.recipe !== undefined) {
    const f = m.recipe.fields;
    need(Object.keys(m.recipe).join() === 'id,fields' && RECIPE_IDS.includes(m.recipe.id), 'recipe');
    need(f && Object.keys(f).length <= LIMITS.fields && Object.keys(f).every((k) => /^[a-z][a-z0-9-]{0,23}$/.test(k) && words(f[k], LIMITS.fieldChars)), 'fields');
  }
  need(Array.isArray(m.layers) && m.layers.length <= LIMITS.layers, 'layers');
  const ids = new Set();
  for (const [i, l] of (m.layers ?? []).entries()) {
    const at = `layer ${i} (${l.kind})`;
    const allowed = [...BASE_KEYS, ...(KIND_KEYS[l.kind] ?? [])];
    need(LAYER_KINDS.includes(l.kind), `${at}: kind`);
    need(Object.keys(l).every((k) => allowed.includes(k)), `${at}: keys ${Object.keys(l).filter((k) => !allowed.includes(k))}`);
    need(allowed.every((k) => OPTIONAL.has(k) || k in l), `${at}: missing ${allowed.filter((k) => !OPTIONAL.has(k) && !(k in l))}`);
    need(typeof l.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(l.id) && !ids.has(l.id), `${at}: id ${l.id}`);
    ids.add(l.id);
    need(line(l.name, LIMITS.name), `${at}: name`);
    need(within(l.start, 0, m.seconds - 0.05) && within(l.end, 0, m.seconds) && l.end - l.start >= 0.05 - 1e-9, `${at}: start ${l.start} end ${l.end}`);
    need(PINS.includes(l.pin), `${at}: pin`);
    need(within(l.x, -400, 400) && within(l.y, -400, 400) && within(l.scale, 0, 8) && within(l.rot, -3600, 3600) && within(l.opacity, 0, 1), `${at}: transform`);
    const span = l.end - l.start;
    need(l.in === undefined || animOk(l.in, span), `${at}: in ${JSON.stringify(l.in)}`);
    need(l.out === undefined || animOk(l.out, span), `${at}: out`);
    need(l.loop === undefined || (Object.keys(l.loop).join() === 'fx,d,amount' && LOOPS.includes(l.loop.fx) && l.loop.fx !== 'none' && within(l.loop.d, 0.4, 60) && within(l.loop.amount, 0, 3)), `${at}: loop`);
    need(l.shadow === undefined || (colourOk(l.shadow.color) && within(l.shadow.blur, 0, 100) && within(l.shadow.x, -100, 100) && within(l.shadow.y, -100, 100)), `${at}: shadow`);
    need(l.blend === undefined || BLENDS.includes(l.blend), `${at}: blend`);
    need(l.hidden === undefined || l.hidden === true, `${at}: hidden`);
    need(l.locked === undefined || l.locked === true, `${at}: locked`);
    const size = (k) => within(l[k], 0, LIMITS.size);
    if (l.kind === 'text' || l.kind === 'counter') {
      need(VOICES.includes(l.voice) && size('size') && [100, 200, 300, 400, 500, 600, 700, 800, 900].includes(l.weight), `${at}: type`);
      need(paintOk(l.color) && ['start', 'center', 'end'].includes(l.align) && within(l.track, -0.2, 1), `${at}: colour/align/track`);
    }
    if (l.kind === 'text') {
      need(words(l.text, LIMITS.text), `${at}: text`);
      need(within(l.lead, 0.7, 2.5) && size('max') && typeof l.caps === 'boolean' && typeof l.fit === 'boolean', `${at}: text numbers`);
      need(l.hi === undefined ? l.hiColor === undefined && l.hiStyle === undefined : l.hi !== '' && l.text.includes(l.hi), `${at}: hi`);
      need(l.hiColor === undefined || paintOk(l.hiColor), `${at}: hiColor`);
      need(l.hiStyle === undefined || ['color', 'box', 'underline'].includes(l.hiStyle), `${at}: hiStyle`);
      need(l.outline === undefined || (Object.keys(l.outline).join() === 'color,width' && paintOk(l.outline.color) && within(l.outline.width, 0, 20)), `${at}: outline`);
    }
    if (l.kind === 'shape') {
      need(SHAPES.includes(l.shape) && size('w') && size('h') && size('radius'), `${at}: shape`);
      need(Number.isInteger(l.sides) && l.sides >= 3 && l.sides <= 24 && within(l.inner, 0.05, 0.95), `${at}: sides/inner`);
      need(within(l.from, -360, 360) && within(l.sweep, -360, 360) && (l.fill === null || paintOk(l.fill)), `${at}: arc/fill`);
      need(Number.isInteger(l.seed) && l.seed >= 0, `${at}: seed`);
      need(l.d === undefined || (l.d.length <= LIMITS.path && l.d !== '' && /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/.test(l.d)), `${at}: d`);
      const s = l.stroke;
      need(s === undefined || (paintOk(s.color) && within(s.width, 0, 100) && ['round', 'butt', 'square'].includes(s.cap)
        && (s.dash === undefined || (s.dash.length === 2 && s.dash.every((v) => within(v, 0, LIMITS.size)) && s.dash[0] + s.dash[1] > 0))), `${at}: stroke`);
    }
    if (l.kind === 'icon') {
      need(ICON_IDS.includes(l.icon) && size('size') && paintOk(l.color) && within(l.weight, 0.25, 6), `${at}: icon`);
      need(l.badge === undefined || (['circle', 'squircle'].includes(l.badge.shape) && paintOk(l.badge.fill) && within(l.badge.pad, 0, 100)), `${at}: badge`);
    }
    if (l.kind === 'image') {
      need(l.src === '' || (IMAGE.test(l.src) && l.src.length <= LIMITS.image), `${at}: src ${String(l.src).slice(0, 40)}`);
      need(size('w') && size('h') && ['cover', 'contain'].includes(l.fit) && size('radius'), `${at}: image box`);
    }
    if (l.kind === 'counter') {
      need(within(l.from, -1e12, 1e12) && within(l.to, -1e12, 1e12) && [0, 1, 2, 3].includes(l.decimals), `${at}: counter numbers`);
      need(affix(l.prefix, LIMITS.suffix) && affix(l.suffix, LIMITS.suffix) && typeof l.group === 'boolean', `${at}: affixes`);
      need(Object.keys(l.count).join() === 'd,delay,ease' && within(l.count.d, 0.05, Math.max(0.05, span)) && within(l.count.delay, 0, span) && easeOk(l.count.ease), `${at}: count`);
    }
    if (l.kind === 'chart') {
      need(CHARTS.includes(l.chart) && size('w') && size('h') && size('size') && VOICES.includes(l.voice) && paintOk(l.color), `${at}: chart`);
      need(Array.isArray(l.data) && l.data.length <= LIMITS.dataPoints
        && l.data.every((d) => Object.keys(d).join() === 'label,value' && line(d.label, LIMITS.label) && within(d.value, -1e12, 1e12)), `${at}: data`);
      need(within(l.max, 0, 1e12) && affix(l.unit, LIMITS.suffix) && typeof l.labels === 'boolean' && typeof l.values === 'boolean', `${at}: chart fields`);
      need(within(l.thick, 0, 100) && within(l.gap, 0, 1), `${at}: thick/gap`);
    }
    if (l.kind === 'chart' || l.kind === 'backdrop' || l.kind === 'particles') {
      need(Array.isArray(l.colors) && l.colors.length >= 1 && l.colors.length <= LIMITS.colors && l.colors.every(colourOk), `${at}: colors`);
    }
    if (l.kind === 'backdrop') need(BACKDROPS.includes(l.style) && within(l.speed, 0, 3) && within(l.density, 0, 1) && Number.isInteger(l.seed), `${at}: backdrop`);
    if (l.kind === 'particles') {
      need(PARTICLES.includes(l.style) && Number.isInteger(l.count) && within(l.count, 0, LIMITS.particles) && size('size'), `${at}: particles`);
      need(within(l.speed, 0, 3) && within(l.spread, 0, 400) && typeof l.burst === 'boolean' && Number.isInteger(l.seed), `${at}: particles motion`);
    }
  }
  return bad;
}

/** Deep equality, key order included: a reader writes every document one way. */
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.join('\u0001') === kb.join('\u0001') && ka.every((k) => same(a[k], b[k]));
};

/** A document that reads is valid, a fixed point, and the same after a trip through JSON (an export, a paste). */
function holds(x) {
  let m;
  try { m = readMotion(x, NOW); } catch (e) { return { threw: String(e) }; }
  if (m === null) return { m };
  const bad = problems(m);
  if (bad.length) return { m, bad };
  if (!same(readMotion(m, NOW + 5000), m)) return { m, bad: ['not a fixed point'] };
  if (!same(readMotion(JSON.parse(JSON.stringify(m)), NOW), m)) return { m, bad: ['changed by JSON'] };
  return { m };
}

// ── hostile and ordinary documents ────────────────────────────────────────
console.log('documents');
const cyclic = { title: 'A loop' };
cyclic.self = cyclic;
cyclic.layers = [cyclic, { kind: 'text', text: 'ok', in: cyclic, color: cyclic }];
cyclic.palette = cyclic;
let deep = { kind: 'text' };
for (let i = 0; i < 100000; i++) deep = { a: deep, kind: 'text', in: deep };
const trap = new Proxy({}, {
  get() { throw new Error('get'); }, has() { throw new Error('has'); }, ownKeys() { throw new Error('keys'); },
  getOwnPropertyDescriptor() { throw new Error('descriptor'); }, getPrototypeOf() { throw new Error('proto'); },
});
const revocable = Proxy.revocable({}, {});
revocable.revoke();
const throwing = { layers: [{ kind: 'text' }] };
Object.defineProperty(throwing, 'title', { enumerable: true, get() { throw new Error('boom'); } });
Object.defineProperty(throwing.layers[0], 'text', { enumerable: true, get() { throw new Error('boom'); } });
const sparse = [];
sparse.length = 4294967295;
sparse[3] = { kind: 'icon', icon: 'rocket' };
const fullDoc = {
  id: 'motion-1', title: 'Launch day', request: 'A launch sting for Duhok Robotics', lang: 'en', format: 'square', fps: 60, seconds: 8,
  palette: { bg: '#101014', fg: '#FAFAFA', accent: '#FF5A1F', accent2: '#FFD23F', muted: '#77798C' }, backdrop: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'accent2' }, { at: 1, color: 'bg' }] },
  recipe: { id: 'logo-reveal', fields: { brand: 'Duhok Robotics', tagline: 'Build the future' } }, ai: true, stage: 'ready', created: 1000, updated: 2000,
  layers: [
    { kind: 'backdrop', id: 'bg', style: 'aurora', colors: ['accent', 'accent2'], speed: 0.8 },
    { kind: 'particles', id: 'confetti', style: 'confetti', count: 120, start: 1.2, burst: true },
    { kind: 'shape', id: 'ring', shape: 'arc', w: 40, h: 40, from: 0, sweep: 300, fill: null, stroke: { color: 'accent', width: 1.2, cap: 'round', dash: [3, 2] }, in: { fx: 'draw', d: 1.2, ease: 'expo-out' } },
    { kind: 'text', id: 'title', text: 'Build the future', hi: 'future', hiColor: 'accent', hiStyle: 'underline', size: 9, weight: 800, voice: 'bold', pin: 'mc', in: { fx: 'rise', by: 'word', gap: 0.06, d: 0.7, ease: 'back-out' }, out: { fx: 'fade', d: 0.4 } },
    { kind: 'counter', id: 'n', from: 0, to: 1250000, prefix: '$', suffix: '+', group: true, decimals: 0, start: 2, end: 7 },
    { kind: 'chart', id: 'c', chart: 'donut', data: [{ label: 'Yes', value: 62 }, { label: 'No', value: 38 }], unit: '%', colors: ['accent', 'muted'] },
    { kind: 'icon', id: 'i', icon: 'rocket', badge: { shape: 'squircle', fill: 'accent', pad: 2 }, loop: { fx: 'float', d: 2.4, amount: 1 } },
    { kind: 'image', id: 'logo', src: 'data:image/png;base64,iVBORw0KGgo=', w: 20, h: 20, fit: 'contain' },
  ],
};
const CASES = [
  ['nothing', undefined, null],
  ['null', null, null],
  ['a number', 42, null],
  ['a string', 'make me a title', null],
  ['an empty list', [], null],
  ['a list holding a document', [{ title: 'x' }], null],
  ['an empty object', {}, null],
  ['an object with no field of a graphic', { foo: 1, bar: 'x' }, null],
  ['fields that are all null', { title: null, layers: null }, null],
  ['a Proxy that throws from every trap', trap, null],
  ['a revoked Proxy', revocable.proxy, null],
  ['only a title', { title: 'Just a title' }],
  ['a full document', fullDoc],
  ['layers that are a word', { layers: 'nope' }],
  ['layers that are all junk', { layers: [1, 'x', null, [], {}, { kind: 'nope' }, { kind: ['text'] }] }],
  ['numbers written as strings', { seconds: '7', fps: '60', layers: [{ kind: 'text', x: ' 12.5 ', size: '9', weight: '650', start: '1', end: '4' }] }],
  ['NaN and Infinity everywhere', { seconds: NaN, fps: Infinity, created: NaN, layers: [{ kind: 'shape', x: NaN, y: -Infinity, w: Infinity, rot: NaN, sides: NaN, start: NaN, end: Infinity, in: { fx: 'fade', d: NaN, delay: Infinity } }] }],
  ['huge numbers', { seconds: 1e9, created: 1e300, layers: [{ kind: 'shape', w: 1e9, sides: 1000, rot: -1e9, seed: 1e20 }, { kind: 'counter', from: -1e300, to: 1e300, decimals: 99 }] }],
  ['start and end the wrong way round', { layers: [{ kind: 'text', start: 5, end: 2 }] }],
  ['an end that is missing', { seconds: 9, layers: [{ kind: 'text', start: 2 }] }],
  ['the same id twice', { layers: [{ kind: 'text', id: 'a' }, { kind: 'text', id: 'a' }, { kind: 'icon', id: 'a' }] }],
  ['ids that are not ids', { layers: [{ kind: 'text', id: 'a b' }, { kind: 'text', id: 'x'.repeat(100) }, { kind: 'text', id: 5 }, { kind: 'text', id: '' }] }],
  ['a highlight not in the words', { layers: [{ kind: 'text', text: 'Hello world', hi: 'World', hiColor: 'accent', hiStyle: 'box' }] }],
  ['addresses where a picture goes', { layers: ['https://evil.example/a.png', 'http://x/y.jpg', '//evil.example/z.png', 'file:///etc/passwd', 'blob:null/1', 'asset://x', 'javascript:alert(1)', 'data:text/html,<b>x</b>', ' data:image/png;base64,AAAA'].map((src) => ({ kind: 'image', src })) }],
  ['__proto__ as a key, from JSON', JSON.parse('{"__proto__":{"polluted":true},"title":"P","layers":[{"kind":"text","__proto__":{"text":"evil","polluted":true}}],"recipe":{"id":"quote","fields":{"__proto__":"x","quote":"q"}}}')],
  ['constructor and prototype as keys', { constructor: { prototype: { polluted: true } }, title: 'C', layers: [{ kind: 'text', constructor: 'x', prototype: {}, toString: 'no' }] }],
  ['getters that throw', throwing],
  ['a cycle', cyclic],
  ['a hundred thousand levels deep', { title: 'deep', palette: deep, layers: [deep], recipe: { id: 'quote', fields: deep } }],
  ['a sparse list four billion long', { layers: sparse }],
  ['lists where objects go', { palette: ['#fff'], layers: [{ kind: 'counter', count: [1, 2], in: ['fade'], shadow: [], outline: [] }], recipe: [] }],
  ['objects where lists go', { layers: { 0: { kind: 'text' } } }],
  ['a stored planning with layers', { stage: 'planning', layers: [{ kind: 'text' }] }],
  ['a stored planning with none', { stage: 'planning', layers: [] }],
  ['control characters and broken pairs in words', { title: `a${String.fromCharCode(0)}b\tc\r\nd`, layers: [{ kind: 'text', text: `x${String.fromCharCode(0xd800)}y\r\nz  \n${String.fromCharCode(0x85)}e${String.fromCharCode(0x301)}`, name: `n${String.fromCharCode(0x200b)}m` }] }],
  ['every kind of colour', { backdrop: 'rgba(255, 0, 0, 0.5)', palette: { bg: 'hsl(220 40% 10%)', fg: 'white', accent: '#abc', accent2: 'blak', muted: 'url(https://x)' },
    layers: [{ kind: 'text', color: 'ACCENT' }, { kind: 'text', color: 'red' }, { kind: 'shape', fill: ['#fff', 'nope', 'bg'] }] }],
  ['gradients of every size', { layers: [
    { kind: 'shape', fill: { kind: 'conic', stops: [{ color: 'accent' }] } },
    { kind: 'shape', fill: { kind: 'linear', stops: [] } },
    { kind: 'shape', fill: { kind: 'spiral', angle: 900, stops: Array.from({ length: 10 }, (_, i) => ({ at: 1 - i / 10, color: i % 2 ? 'fg' : '#123456' })) } },
  ] }],
  ['a recipe with junk fields', { recipe: { id: 'Big-Title', fields: { Title: 'Hi', 'bad key': 'x', n: 5, o: { x: 1 }, b: true, long: 'y'.repeat(5000) } } }],
  ['a model\'s spelling of the words', { format: '9:16', lang: 'ar-IQ', duration: 12, layers: [
    { kind: 'text', pin: 'bottom-start', weight: 'bold', align: 'centre', in: { fx: 'Rise', ease: 'ease-out' }, duration: 3, start: 1 },
    { kind: 'shape', pin: 'top', width: 50, height: 5 }, { kind: 'text', pin: 'left' },
  ] }],
  ['every blank layer in one document', { layers: LAYER_KINDS.map((k) => blankLayer(k)) }],
];
for (const [name, x, expect] of CASES) {
  const r = holds(x);
  if (expect === null) ok(`${name}: not a graphic`, !r.threw && r.m === null, r);
  else ok(`${name}: a valid graphic, the same when read again`, !r.threw && r.m !== null && !r.bad, { threw: r.threw, bad: r.bad });
}
ok('nothing was polluted', ({}).polluted === undefined && Object.prototype.polluted === undefined && Object.getOwnPropertyNames(Object.prototype).every((k) => k !== 'polluted'));

// ── fuzzed documents ──────────────────────────────────────────────────────
console.log('fuzz');
{
  let seed = 20260929;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const one = (list) => list[Math.floor(rnd() * list.length)];
  const NUMS = [0, -0, 1, -1, 0.5, 2, 7, 12.5, 100, 3600, 0.001, 0.04, 1e12, -1e12, 1e300, -1e300, NaN, Infinity, -Infinity];
  const STRS = [
    '', ' ', 'nope', 'Infinity', 'NaN', '7', ' 12.5 ', '1e3', '0x10', '-0', '#abc', '#AABBCC', '#aabbcc80', '#aabbccff', 'rgb(1,2,3)', 'hsl(10 50% 50%)',
    'url(https://evil.example/x)', 'https://evil.example/x.png', 'data:image/png;base64,AAAA', 'data:image/svg+xml,<svg/>', 'data:text/html,<b>hi</b>',
    'bezier(0.1,0.2,0.3,0.4)', 'cubic-bezier(2, -1, 0.5, 9)', 'bezier(1,2)', 'line one\r\nline two  \n\tthree', `nul${String.fromCharCode(0)}bell${String.fromCharCode(7)}`,
    `half ${String.fromCharCode(0xd800)} pair`, `e${String.fromCharCode(0x301)}`, 'سڵاو لە هەمووان', 'مرحبا 123', '🎉 party 🎉', 'M0 0 L100 100 Z', 'M0 0 <script>',
    '__proto__', 'constructor', 'toString', 'x'.repeat(3000), 'Title', 'bottom-start', 'top', 'centre', '16:9', '9:16', 'ar-IQ', 'CKB', 'bold', 'semibold',
    'ease-out', 'words', 'left', 'transparent',
  ];
  const WORDS = [...EFFECTS, ...LOOPS, ...EASES, ...PINS, ...VOICES, ...SHAPES, ...CHARTS, ...BACKDROPS, ...PARTICLES, ...BLENDS, ...TONES, ...DIRS,
    ...SPLITS, ...LAYER_KINDS, ...RECIPE_IDS, ...FORMAT_IDS, ...LANGUAGES, 'sparkle', 'rocket', 'new', 'planning', 'ready', 'start', 'center', 'end',
    'box', 'underline', 'cover', 'contain', 'circle', 'squircle', 'round', 'butt', 'square', 'linear', 'radial', 'conic'];
  const KEYS = [...MOTION_KEYS, ...BASE_KEYS, ...new Set(Object.values(KIND_KEYS).flat()), 'fx', 'd', 'delay', 'ease', 'amount', 'dir', 'by', 'gap', 'at',
    'stops', 'angle', 'fields', 'label', 'value', 'blur', 'width', 'cap', 'dash', 'pad', 'duration', '__proto__', 'constructor', 'toString', 'Title', 'x-y', ''];
  const value = (depth) => {
    const r = rnd();
    if (r < 0.2) return one(NUMS);
    if (r < 0.28) return (rnd() - 0.4) * 10 ** Math.floor(rnd() * 6);
    if (r < 0.4) return one(STRS);
    if (r < 0.55) { const w = one(WORDS); return rnd() < 0.15 ? w.toUpperCase() : w; }
    if (r < 0.6) return rnd() < 0.5;
    if (r < 0.64) return null;
    if (r < 0.66) return undefined;
    if (depth >= 3) return one(WORDS);
    if (r < 0.8) return Array.from({ length: Math.floor(rnd() * 5) }, () => value(depth + 1));
    return object(depth + 1);
  };
  const object = (depth) => {
    const o = {};
    for (let n = Math.floor(rnd() * 8); n > 0; n--) {
      Object.defineProperty(o, one(KEYS), { value: value(depth), enumerable: true, configurable: true, writable: true });
    }
    return o;
  };
  // A layer: most often a real one with a few fields broken, sometimes junk that names a kind.
  const layer = () => {
    const r = rnd();
    if (r < 0.1) return value(1);
    const l = r < 0.6 ? { ...blankLayer(one(LAYER_KINDS)) } : { kind: one([...LAYER_KINDS, 'Text', 'nope']) };
    for (let n = Math.floor(rnd() * 7); n > 0; n--) {
      const k = one(rnd() < 0.7 ? [...Object.keys(l), ...Object.values(KIND_KEYS).flat()] : KEYS);
      Object.defineProperty(l, k, { value: rnd() < 0.3 ? String(one(NUMS)) : value(1), enumerable: true, configurable: true, writable: true });
    }
    if (rnd() < 0.05) l.in = l;
    return l;
  };
  const doc = () => {
    if (rnd() < 0.15) return value(0);
    const d = rnd() < 0.3 ? object(0) : {};
    if (rnd() < 0.9) d.layers = Array.from({ length: Math.floor(rnd() * 10) }, layer);
    for (const k of MOTION_KEYS) if (k !== 'layers' && rnd() < 0.4) d[k] = value(1);
    return d;
  };
  let threw = 0, broken = null, graphics = 0, layers = 0;
  for (let i = 0; i < 600; i++) {
    const x = doc();
    const r = holds(x);
    if (r.threw) threw++;
    else if (r.bad && !broken) broken = { i, bad: r.bad.slice(0, 5), layers: r.m?.layers?.map((l) => l.kind) };
    if (r.m) { graphics++; layers += r.m.layers.length; }
  }
  ok('600 fuzzed documents: none throws', threw === 0, threw);
  ok('every one that reads keeps every rule, is a fixed point and survives JSON', broken === null, broken);
  ok('and the fuzz reached real graphics with real layers', graphics > 300 && layers > 1000, { graphics, layers });
}

// ── clamps ────────────────────────────────────────────────────────────────
console.log('clamps');
const doc1 = (layer, extra = {}) => readMotion({ ...extra, layers: [layer] }, NOW);
const L = (layer, extra) => doc1(layer, extra).layers[0];
{
  const secs = (v) => readMotion({ seconds: v }, NOW).seconds;
  ok('seconds: 1 to 30, 6 when not a number', secs(0) === 1 && secs(99) === 30 && secs('12') === 12 && secs('x') === 6 && readMotion({ title: 't' }).seconds === 6);
  const fps = (v) => readMotion({ fps: v }, NOW).fps;
  ok('fps: 24, 30 or 60, and 30 for anything else', fps(24) === 24 && fps('60') === 60 && fps(25) === 30 && fps(59.94) === 30 && fps('fast') === 30);
  const fmt = (v) => readMotion({ format: v }, NOW).format;
  ok('format: a name in any case or its ratio; landscape otherwise', fmt('PORTRAIT') === 'portrait' && fmt('9:16') === 'portrait' && fmt('4:5') === 'feed' && fmt('tall') === 'landscape');
  const lang = (v) => readMotion({ lang: v }, NOW).lang;
  const bd = (v) => readMotion({ title: 'x', backdrop: v }).backdrop;
  ok('backdrop: null, "transparent" and any colour with no opacity are all null (one spelling of a see-through frame)',
    bd(null) === null && bd('transparent') === null && bd('#00000000') === null && bd('#fff0') === null && bd('rgba(10, 20, 30, 0)') === null,
    [bd(null), bd('transparent'), bd('#00000000'), bd('#fff0'), bd('rgba(10, 20, 30, 0)')]);
  ok('backdrop: a colour with any opacity, a token and a gradient are kept; nothing given is the palette\'s ground',
    bd('#11223380') === '#11223380' && bd('accent') === 'accent' && readMotion({ title: 'x' }).backdrop === 'bg'
    && bd({ kind: 'linear', angle: 0, stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }] })?.kind === 'linear',
    [bd('#11223380'), bd('accent'), readMotion({ title: 'x' }).backdrop]);
  ok('lang: a shipped language or a regional form of it; English otherwise', lang('ar-IQ') === 'ar' && lang('CKB') === 'ckb' && lang('kmr') === 'kmr' && lang('ku') === 'en' && lang(7) === 'en');
  ok('title: one line, trimmed, capped; "Untitled" when empty', readMotion({ title: '  Two\n lines  ' }).title === 'Two lines' && readMotion({ title: '   ' }).title === 'Untitled'
    && chars(readMotion({ title: 'é'.repeat(500) }).title) === LIMITS.title);
  ok('position within ±reach, scale 0..LIMITS.scale, rot ±3600, opacity 0..1', (() => {
    const l = L({ kind: 'text', x: 1e6, y: -1e6, scale: 9, rot: 1e5, opacity: 2 });
    const k = L({ kind: 'text', scale: -1, opacity: '-1', rot: -1e5 });
    return l.x === 400 && l.y === -400 && l.scale === LIMITS.scale && l.rot === 3600 && l.opacity === 1 && k.scale === 0 && k.opacity === 0 && k.rot === -3600;
  })());
  {
    const a = L({ kind: 'text', start: -3, end: 100 });
    const b = L({ kind: 'text', start: 100 });
    const c = L({ kind: 'text', start: 5, end: 2 });
    const d = L({ kind: 'text', start: 3, end: 3 });
    const e = L({ kind: 'text', start: 2 }, { seconds: 9 });
    ok('start from 0, end no later than the graphic', a.start === 0 && a.end === 6, a);
    ok('a start past the end still leaves a moment on screen', b.start === 5.95 && b.end === 6, b);
    ok('start and end the wrong way round are swapped', c.start === 2 && c.end === 5, c);
    ok('an end at the start is moved 0.05 s after it', d.start === 3 && Math.abs(d.end - 3.05) < 1e-9, d);
    ok('no end runs to the end of the graphic', e.end === 9, e);
    ok('a duration is read as an end', L({ kind: 'text', start: 1, duration: 2 }).end === 3);
  }
  const w = (v) => L({ kind: 'text', weight: v }).weight;
  ok('weight on the hundred, 100..900, from a number or a name', w(650) === 700 && w(640) === 600 && w(50) === 100 && w(1000) === 900 && w('bold') === 700 && w('Semi Bold') === 600 && w('heavy!') === 700);
  {
    const t = L({ kind: 'text', lead: 5, track: 2, size: 1e4, max: -3 });
    const u = L({ kind: 'text', lead: 0, track: -1 });
    ok('lead 0.7..2.5, track -0.2..1, type 0..LIMITS.fontSize', t.lead === 2.5 && t.track === 1 && t.size === LIMITS.fontSize && t.max === 0 && u.lead === 0.7 && u.track === -0.2);
  }
  {
    const s = L({ kind: 'shape', sides: 2.4, inner: 0, from: 720, sweep: -720 });
    const r = L({ kind: 'shape', sides: 7.6, inner: 1 });
    ok('sides a whole number 3..24; inner 0.05..0.95; arcs within a turn', s.sides === 3 && r.sides === 8 && L({ kind: 'shape', sides: 99 }).sides === 24
      && s.inner === 0.05 && r.inner === 0.95 && s.from === 360 && s.sweep === -360);
  }
  ok('particles: a whole number up to the limit', L({ kind: 'particles', count: 5000 }).count === 300 && L({ kind: 'particles', count: 12.7 }).count === 13 && L({ kind: 'particles', count: -4 }).count === 0);
  ok('particles: no bigger than LIMITS.particleSize', L({ kind: 'particles', size: 1e4 }).size === LIMITS.particleSize && L({ kind: 'particles', size: 2 }).size === 2);
  ok('a counter\'s and a chart\'s type are held to the same size as a headline\'s', L({ kind: 'counter', size: 1e4 }).size === LIMITS.fontSize && L({ kind: 'counter', size: 30 }).size === 30 && L({ kind: 'chart', size: 1e4 }).size === LIMITS.fontSize);
  ok('an icon may still be as large as LIMITS.size (a path costs the same at any size)', L({ kind: 'icon', size: 1e4 }).size === LIMITS.size);
  {
    // One layer is bounded by `particles`; sixty of them would be eighteen thousand discs a frame.
    const many = readMotion({ layers: Array.from({ length: 12 }, (_, i) => ({ kind: 'particles', id: `p${i}`, count: 300 })) }, NOW).layers;
    const drawn = many.reduce((n, l) => n + l.count, 0);
    ok('a document draws at most LIMITS.particleBudget particles in all', drawn === LIMITS.particleBudget, drawn);
    ok('earlier layers keep their count and later ones are cut to what is left', many[0].count === 300 && many[LIMITS.particleBudget / 300 - 1].count === 300 && many[LIMITS.particleBudget / 300].count === 0, many.map((l) => l.count));
    const mixed = readMotion({ layers: [{ kind: 'particles', id: 'a', count: 1000 }, { kind: 'text', id: 't', text: 'Hi' }, { kind: 'particles', id: 'b', count: 300 }] }, NOW).layers;
    ok('and only particle layers are counted, however the others are ordered around them', mixed[0].count === 300 && mixed[1].kind === 'text' && mixed[2].count === 300, mixed.map((l) => l.count ?? l.kind));
    const under = readMotion({ layers: [{ kind: 'particles', id: 'a', count: 200 }, { kind: 'particles', id: 'b', count: 60 }] }, NOW).layers;
    ok('a document within the budget is left alone', under[0].count === 200 && under[1].count === 60);
  }
  {
    const c = L({ kind: 'counter', from: -1e15, to: 1e15, decimals: 7, prefix: 'x'.repeat(50), suffix: ' km' });
    ok('counter values within ±1e12, decimals 0..3, affixes capped with their spaces kept',
      c.from === -1e12 && c.to === 1e12 && c.decimals === 3 && c.prefix.length === 12 && c.suffix === ' km' && L({ kind: 'counter', decimals: 1.6 }).decimals === 2);
    const k = L({ kind: 'counter', start: 0, end: 1, count: { d: 9, delay: -1, ease: 'nope' } });
    ok('the roll fits in the layer and has a real curve', k.count.d === 1 && k.count.delay === 0 && k.count.ease === 'expo-out', k.count);
  }
  {
    const data = Array.from({ length: 20 }, (_, i) => ({ label: `L${i}`.padEnd(100, 'x'), value: i }));
    const c = L({ kind: 'chart', data: [...data.slice(0, 2), { label: 'no', value: NaN }, { label: 'str', value: '7' }, { label: 'big', value: 1e20 }, 5, 'x', ...data] });
    ok('chart data: at most 12, labels capped, a datum with no number dropped, "7" read, values within ±1e12',
      c.data.length === 12 && c.data.every((d) => chars(d.label) <= 40) && !c.data.some((d) => d.label === 'no')
      && c.data.find((d) => d.label === 'str').value === 7 && c.data.find((d) => d.label === 'big').value === 1e12 && c.data.some((d) => d.label === '' && d.value === 5), c.data.slice(0, 7));
    ok('a chart with no data keeps none — no numbers are invented', L({ kind: 'chart' }).data.length === 0 && L({ kind: 'chart', data: 'lots' }).data.length === 0);
    ok('colour lists: at most 6 valid ones, the kind\'s own when none reads, a single word read as a list',
      L({ kind: 'backdrop', colors: Array(10).fill('#fff') }).colors.length === 6 && L({ kind: 'backdrop', colors: ['nope', 7] }).colors.join() === 'accent,accent2'
      && L({ kind: 'particles', colors: [] }).colors.join() === 'accent,accent2,fg' && L({ kind: 'chart', colors: 'muted' }).colors.join() === 'muted');
  }
  ok('text capped at LIMITS.text, names at LIMITS.name', chars(L({ kind: 'text', text: 'w'.repeat(1000) }).text) === LIMITS.text && L({ kind: 'text', name: 'n'.repeat(100) }).name.length === LIMITS.name);
  ok('words that are not a string are the placeholder; empty words stay empty', L({ kind: 'text' }).text === 'Your words' && L({ kind: 'text', text: {} }).text === 'Your words'
    && L({ kind: 'text', text: '' }).text === '' && L({ kind: 'text', text: 2024 }).text === '2024');
  ok('an unknown word is the kind\'s default', (() => {
    const t = L({ kind: 'text', voice: 'comic', align: 'left', pin: 'middle-left', color: 'red' });
    const s = L({ kind: 'shape', shape: 'heart', fill: 'nope' });
    return t.voice === 'sans' && t.align === 'center' && t.pin === 'mc' && t.color === 'fg' && s.shape === 'rect' && s.fill === 'accent'
      && L({ kind: 'icon', icon: 'unicorn' }).icon === 'sparkle' && L({ kind: 'chart', chart: 'pie' }).chart === 'bars'
      && L({ kind: 'backdrop', style: 'plasma' }).style === 'aurora' && L({ kind: 'particles', style: 'fire' }).style === 'confetti'
      && L({ kind: 'image', fit: 'fill' }).fit === 'cover' && L({ kind: 'text', blend: 'difference' }).blend === undefined;
  })());
  ok('pins from the words a model writes; left and right are not words for a pin',
    L({ kind: 'text', pin: 'bottom-start' }).pin === 'bs' && L({ kind: 'text', pin: 'Top End' }).pin === 'te' && L({ kind: 'text', pin: 'top' }).pin === 'tc'
    && L({ kind: 'text', pin: 'center' }).pin === 'mc' && L({ kind: 'text', pin: 'end' }).pin === 'me' && L({ kind: 'text', pin: 'bottom-left' }).pin === 'mc');
  ok('hidden and locked only when exactly true', L({ kind: 'text', hidden: true, locked: 'true' }).hidden === true && !('locked' in L({ kind: 'text', locked: 'true' }))
    && !('hidden' in L({ kind: 'text', hidden: 1 })));
  ok('a fill of null is an outline with nothing inside, and stays so', L({ kind: 'shape', fill: null }).fill === null && L({ kind: 'shape' }).fill === 'accent');
  ok('a path is kept only when it is path letters and numbers, short enough',
    L({ kind: 'shape', d: ' M0 0 L100 100 Z ' }).d === 'M0 0 L100 100 Z' && L({ kind: 'shape', d: 'M0 0 <script>' }).d === undefined
    && L({ kind: 'shape', d: 'M0 0 url(x)' }).d === undefined && L({ kind: 'shape', d: `M${' 1'.repeat(2000)}` }).d === undefined && L({ kind: 'shape', d: '' }).d === undefined);
}

// ── pictures never come from anywhere ─────────────────────────────────────
console.log('pictures');
{
  const src = (v) => L({ kind: 'image', src: v }).src;
  const remote = ['https://evil.example/a.png', 'http://x/y.jpg', '//evil.example/z.png', 'file:///etc/passwd', 'blob:null/1', 'asset://localhost/x.png',
    'tauri://x', 'javascript:alert(1)', 'data:text/html,<img src=x>', 'data:image/x-icon;base64,AAAA', ' data:image/png;base64,AAAA', 'data:image/png', 'DATA:'];
  ok('no address of any kind is a picture', remote.every((v) => src(v) === ''), remote.map(src));
  ok('a base64 PNG or JPEG data: URL — all the importer ever writes — is a picture', ['data:image/png;base64,AAAA', 'data:image/jpeg;base64,AAAA', 'DATA:IMAGE/PNG;base64,AAAA'].every((v) => src(v) === v));
  ok('an SVG, a GIF or a WebP is not, however it is written: those are what a model could write by hand',
    ['data:image/webp;base64,AAAA', 'data:image/gif;base64,R0lG', 'data:image/svg+xml,%3Csvg%2F%3E', 'data:image/svg+xml;utf8,<svg/>',
      'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png,AAAA', 'data:image/jpeg;charset=utf-8,AAAA'].every((v) => src(v) === ''));
  const big = `data:image/png;base64,${'A'.repeat(LIMITS.image)}`;
  ok('a picture over LIMITS.image is dropped, never cut (a cut picture is a broken one)', src(big) === '' && src(big.slice(0, LIMITS.image)) === big.slice(0, LIMITS.image));
  ok('an image layer with no picture is a valid empty frame', L({ kind: 'image' }).src === '' && problems(doc1({ kind: 'image' })).length === 0);
  ok('colours cannot hold an address either', readPaint('url(https://evil.example/x)', 'fg') === 'fg' && readPalette({ bg: 'url(x)' }).bg === DEFAULT_PALETTE.bg);
}

// ── ids ───────────────────────────────────────────────────────────────────
console.log('ids');
{
  const m = readMotion({ layers: [{ kind: 'text', id: 'a' }, { kind: 'text', id: 'a' }, { kind: 'icon' }, { kind: 'text', id: 'b c' }, { kind: 'text', id: 'keep_me-2' }] }, NOW);
  const ids = m.layers.map((l) => l.id);
  ok('ids are unique across the document', new Set(ids).size === ids.length, ids);
  ok('the first holder of an id and a good id keep theirs', ids[0] === 'a' && ids[4] === 'keep_me-2');
  ok('a duplicate, a missing and a malformed id are fresh ones', /^l[0-9a-z]{6}$/.test(ids[1]) && /^l[0-9a-z]{6}$/.test(ids[2]) && /^l[0-9a-z]{6}$/.test(ids[3]), ids);
  const taken = new Set();
  let good = true;
  for (let i = 0; i < 2000; i++) {
    const id = newLayerId(taken);
    if (!/^l[0-9a-z]{6}$/.test(id) || taken.has(id)) good = false;
    taken.add(id);
  }
  ok('newLayerId: "l" and six base-36 letters, never one already taken', good && taken.size === 2000);
  ok('a document with no id gets one, and keeps it when read again', (() => {
    const a = readMotion({ title: 'x' }, NOW);
    return typeof a.id === 'string' && a.id.length > 4 && readMotion(a, NOW).id === a.id;
  })());
  ok('a stored id is kept exactly, even an odd one (it is the record\'s key)', readMotion({ id: 'My graphic #1', title: 'x' }).id === 'My graphic #1'
    && readMotion({ id: '', title: 'x' }).id !== '' && readMotion({ id: `a${String.fromCharCode(0)}`, title: 'x' }).id !== `a${String.fromCharCode(0)}`);
}

// ── highlights ────────────────────────────────────────────────────────────
console.log('highlights');
{
  const kept = L({ kind: 'text', text: 'Build the future', hi: 'future', hiColor: 'rgb(255,0,0)', hiStyle: 'Box' });
  ok('a highlight in the words is kept, with its colour and style', kept.hi === 'future' && kept.hiColor === '#ff0000' && kept.hiStyle === 'box', kept);
  const gone = L({ kind: 'text', text: 'Build the future', hi: 'Future', hiColor: 'accent', hiStyle: 'box' });
  ok('one not exactly in them is dropped, and its colour and style with it', !('hi' in gone) && !('hiColor' in gone) && !('hiStyle' in gone), gone);
  ok('an empty highlight is none', !('hi' in L({ kind: 'text', text: 'abc', hi: '' })) && !('hi' in L({ kind: 'text', text: 'a b', hi: ' ' })));
  const junk = L({ kind: 'text', text: 'abc', hi: 'b', hiColor: 'nope', hiStyle: 'glow' });
  ok('a highlight keeps only a colour and a style that are real', junk.hi === 'b' && !('hiColor' in junk) && !('hiStyle' in junk));
  ok('a highlight is read like the words, so a stray trailing space does not lose it', L({ kind: 'text', text: 'Hello world', hi: 'world ' }).hi === 'world');
}

// ── the pieces ────────────────────────────────────────────────────────────
console.log('pieces');
{
  const nul = String.fromCharCode(0);
  ok('cleanText: control characters go, a tab is a space, line endings are \\n', cleanText(`a${nul}b\tc\r\nd\re${String.fromCharCode(0x2028)}f`, 99) === 'ab c\nd\ne\nf');
  ok('cleanText: no space at the end of a line; leading space and blank lines stay', cleanText('  one   \n\n two \t', 99) === '  one\n\n two');
  ok('cleanText: composed, so é typed two ways is one letter', cleanText(`e${String.fromCharCode(0x301)}`, 99) === 'é' && cleanText(`e${String.fromCharCode(0x301)}`, 1) === 'é');
  ok('cleanText: capped by characters, an emoji never cut in half', cleanText('🎉🎉🎉', 2) === '🎉🎉' && cleanText('ab🎉', 3) === 'ab🎉');
  ok('cleanText: half a surrogate pair is not a character', cleanText(`a${String.fromCharCode(0xd83c)}b${String.fromCharCode(0xdf89)}`, 9) === 'ab');
  ok('cleanText: numbers are written out; anything else is nothing', cleanText(42.5, 9) === '42.5' && cleanText(NaN, 9) === '' && [null, undefined, {}, [], true].every((v) => cleanText(v, 9) === ''));
  ok('cleanText: reading twice changes nothing', ['  a \r\n b\t', `x${nul}y`, 'é'.normalize('NFD').repeat(9), '🎉 '.repeat(9)].every((s) => cleanText(cleanText(s, 7), 7) === cleanText(s, 7)));

  const p = (v) => readPaint(v, 'FALLBACK');
  ok('tokens, in any case', p('accent') === 'accent' && p(' ACCENT2 ') === 'accent2');
  ok('hex in every length, written #rrggbb or #rrggbbaa', p('#ABC') === '#aabbcc' && p('abcdef') === '#abcdef' && p('#abcd') === '#aabbccdd'
    && p('#AABBCCFF') === '#aabbcc' && p('#aabbcc80') === '#aabbcc80');
  ok('rgb() and hsl(), comma or space syntax, with alpha', p('rgb(255, 0, 0)') === '#ff0000' && p('rgba(255,0,0,0.5)') === '#ff000080'
    && p('rgb(100% 0% 0% / 50%)') === '#ff000080' && p('hsl(120, 100%, 50%)') === '#00ff00' && p('hsl(0.5turn 100% 50%)') === '#00ffff' && p('hsla(0 0% 100% / 1)') === '#ffffff');
  ok('transparent, white and black; no other names', p('transparent') === '#00000000' && p('White') === '#ffffff' && p('red') === 'FALLBACK' && p('navy') === 'FALLBACK');
  ok('what is not a colour is the fallback', ['#12345', 'rgb(1,2)', 'rgb(a,b,c)', 'hsl()', 42, {}, null, undefined, [], 'x'.repeat(100)].every((v) => p(v) === 'FALLBACK'));
  const g = p({ type: 'radial', angle: 900, stops: [{ at: 1, color: '#FFF' }, { at: 0, color: 'bg' }, { at: 0.5, color: 'nope' }] });
  ok('a gradient: its kind, its angle within a turn, its stops checked and sorted',
    same(g, { kind: 'radial', angle: 360, stops: [{ at: 0, color: 'bg' }, { at: 1, color: '#ffffff' }] }), g);
  ok('a gradient with one colour left is that colour; with none, the fallback',
    p({ kind: 'linear', stops: [{ color: 'fg' }, { color: 'x' }] }) === 'fg' && p({ kind: 'linear', stops: [] }) === 'FALLBACK' && p({ kind: 'linear' }) === 'FALLBACK');
  ok('stops that give no place are spread evenly, and at most six are kept', (() => {
    const e = p({ stops: ['#000', '#111', '#222'] });
    const m = p({ stops: Array(10).fill('fg') });
    return same(e.stops.map((s) => s.at), [0, 0.5, 1]) && m.stops.length === 6 && e.kind === 'linear' && e.angle === 90;
  })());
  ok('a list of colours is the gradient it plainly means', same(p(['accent', 'accent2']), { kind: 'linear', angle: 90, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] }));

  ok('readPalette: repaired colour by colour, never from a token', (() => {
    const pal = readPalette({ bg: '#000', fg: 'accent', accent: 'nope', background: '#fff', secondary: 'rgb(0,0,255)' });
    return pal.bg === '#000000' && pal.fg === DEFAULT_PALETTE.fg && pal.accent === DEFAULT_PALETTE.accent && pal.accent2 === '#0000ff' && pal.muted === DEFAULT_PALETTE.muted;
  })());
  ok('readPalette: nothing is the default palette, and the default is its own reading', same(readPalette(undefined), DEFAULT_PALETTE) && same(readPalette(DEFAULT_PALETTE), DEFAULT_PALETTE)
    && same(readPalette([1, 2]), DEFAULT_PALETTE) && Object.isFrozen(DEFAULT_PALETTE));
  ok('readPalette: a fallback palette fills what is missing', readPalette({ bg: '#111111' }, { ...DEFAULT_PALETTE, fg: '#222222' }).fg === '#222222');
  ok('the default palette is the one the contract names', same(DEFAULT_PALETTE, { bg: '#0b1020', fg: '#f5f7ff', accent: '#4c8dff', accent2: '#ff6aa2', muted: '#8a93b2' }));

  ok('readAnim: none, an unknown effect or not an object is no animation', [{ fx: 'none' }, { fx: 'explode' }, 'none', null, 7, [], {}].every((v) => readAnim(v, 6) === undefined));
  ok('readAnim: a bare word is that effect as designed', same(readAnim('Fade', 6), { fx: 'fade', d: 0.6, delay: 0, ease: 'out', amount: 1 }));
  ok('readAnim: durations fit the layer; amount 0..3', (() => {
    const a = readAnim({ fx: 'rise', d: 100, delay: -1, amount: 5 }, 4);
    const b = readAnim({ fx: 'rise', d: 0, delay: 100, amount: -1 }, 4);
    const c = readAnim({ fx: 'rise' }, 0.3);
    return a.d === 4 && a.delay === 0 && a.amount === 3 && b.d === 0.05 && b.delay === 4 && b.amount === 0 && c.d === 0.3;
  })());
  ok('readAnim: an ease from the list, a CSS name for one, or a Bézier written back one way', readAnim({ fx: 'pop', ease: 'Expo-Out' }, 6).ease === 'expo-out'
    && readAnim({ fx: 'pop', ease: 'ease-in-out' }, 6).ease === 'inout' && readAnim({ fx: 'pop', ease: 'cubic-bezier(.2, .8, .2, 1)' }, 6).ease === 'bezier(0.2,0.8,0.2,1)'
    && readAnim({ fx: 'pop', ease: 'bezier(2,-9,0.5,9)' }, 6).ease === 'bezier(1,-5,0.5,5)' && readAnim({ fx: 'pop', ease: 'bezier(1,2,3)' }, 6).ease === 'out'
    && readAnim({ fx: 'pop', ease: 'bezier(a,b,c,d)' }, 6).ease === 'out' && readAnim({ fx: 'pop', ease: 'wobbly' }, 6).ease === 'out');
  ok('readAnim: dir, by and gap only when they are real, gap within 0..1', (() => {
    const a = readAnim({ fx: 'slide', dir: 'END', by: 'word', gap: 5 }, 6);
    const b = readAnim({ fx: 'slide', dir: 'left', by: 'sentence', gap: 'soon' }, 6);
    return a.dir === 'end' && a.by === 'word' && a.gap === 1 && !('dir' in b) && !('by' in b) && !('gap' in b);
  })());
  ok('readLoop: a real loop, one cycle 0.4 to 60 s — never a seizure-rate flicker', same(readLoop({ fx: 'pulse', d: 0.01, amount: 9 }), { fx: 'pulse', d: 0.4, amount: 3 })
    && same(readLoop('float'), { fx: 'float', d: 2, amount: 1 }) && readLoop({ fx: 'none' }) === undefined && readLoop({ fx: 'wiggle' }) === undefined && readLoop(null) === undefined);

  const f = readFields(JSON.parse('{"Title":"Hi","__proto__":"x","constructor":"c","bad key":"x","n":5,"o":{"x":1},"b":true,"z":null,"long":"' + 'y'.repeat(5000) + '","title":"second"}'));
  ok('readFields: names lower-cased and checked, numbers written out, objects and yes/no dropped',
    same(Object.keys(f), ['title', 'constructor', 'n', 'long']) && f.title === 'Hi' && f.n === '5' && f.long.length === LIMITS.fieldChars, f);
  ok('readFields: at most LIMITS.fields, and nothing from not an object', Object.keys(readFields(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 'v'])))).length === LIMITS.fields
    && same(readFields([1, 2]), {}) && same(readFields('x'), {}));
  ok('readLayer: null for a kind nothing draws, or not an object', readLayer({ kind: 'video' }, { seconds: 6 }) === null && readLayer('text', { seconds: 6 }) === null
    && readLayer(null, { seconds: 6 }) === null && readLayer({ kind: 'TEXT' }, { seconds: 6 })?.kind === 'text');
  ok('readLayer: a context that is not one is a six-second graphic', readLayer({ kind: 'text', end: 20 }, undefined).end === 6);
}

// ── blank layers ──────────────────────────────────────────────────────────
console.log('blank layers');
{
  for (const kind of LAYER_KINDS) {
    const b = blankLayer(kind);
    ok(`${kind}: a blank layer reads back unchanged`, same(readLayer(b, { seconds: 6 }), b) && same(readLayer(b, { seconds: 30 }), b), b);
  }
  const t = blankLayer('text');
  ok('text starts as the design says', t.start === 0 && t.end === 6 && t.pin === 'mc' && t.x === 0 && t.y === 0 && t.scale === 1 && t.rot === 0 && t.opacity === 1
    && t.size === 8 && t.weight === 700 && t.voice === 'sans' && t.color === 'fg' && t.align === 'center' && t.lead === 1.15 && t.track === 0
    && t.caps === false && t.max === 0 && t.fit === false && t.text === 'Your words', t);
  const s = blankLayer('shape');
  ok('shape', s.shape === 'rect' && s.w === 30 && s.h === 16 && s.radius === 2 && s.sides === 5 && s.inner === 0.5 && s.from === 0 && s.sweep === 270 && s.fill === 'accent' && s.seed === 1, s);
  const i = blankLayer('icon');
  ok('icon', i.icon === 'sparkle' && i.size === 10 && i.color === 'fg' && i.weight === 1.75, i);
  const im = blankLayer('image');
  ok('image', im.w === 30 && im.h === 20 && im.fit === 'cover' && im.radius === 1.5 && im.src === '', im);
  const c = blankLayer('counter');
  ok('counter', c.from === 0 && c.to === 100 && c.decimals === 0 && c.prefix === '' && c.suffix === '' && c.group === true && c.size === 14 && c.weight === 800
    && same(c.count, { d: 1.6, delay: 0.2, ease: 'expo-out' }), c);
  const ch = blankLayer('chart');
  ok('chart, with sample numbers that are plainly samples', ch.chart === 'bars' && ch.w === 60 && ch.h === 32 && same(ch.data, [{ label: 'Q1', value: 40 }, { label: 'Q2', value: 65 }, { label: 'Q3', value: 90 }])
    && same(ch.colors, ['accent', 'accent2']) && ch.max === 0 && ch.unit === '' && ch.labels && ch.values && ch.size === 2.6 && ch.thick === 1.4 && ch.gap === 0.12 && ch.color === 'fg', ch);
  const bd = blankLayer('backdrop');
  ok('backdrop', bd.style === 'aurora' && same(bd.colors, ['accent', 'accent2']) && bd.speed === 1 && bd.density === 0.5 && bd.seed === 1, bd);
  const pa = blankLayer('particles');
  ok('particles', pa.style === 'confetti' && same(pa.colors, ['accent', 'accent2', 'fg']) && pa.count === 60 && pa.size === 1.4 && pa.speed === 1 && pa.spread === 0 && pa.burst === true && pa.seed === 1, pa);
  ok('each blank layer has a fresh id, unless it is given one', blankLayer('text').id !== blankLayer('text').id && blankLayer('text', { id: 'hello' }).id === 'hello'
    && /^l[0-9a-z]{6}$/.test(blankLayer('text', { id: 'not ok' }).id));
  const o = blankLayer('text', { text: 'Hi', size: 1e9, voice: 'comic', kind: 'shape', in: { fx: 'rise' }, junk: 1 });
  ok('what it is given is written over the defaults and read again', o.kind === 'text' && o.text === 'Hi' && o.size === LIMITS.fontSize && o.voice === 'sans' && o.in.fx === 'rise' && !('junk' in o), o);
  ok('it lasts 0 to 6 s unless told; one that starts later with no end runs to the end', blankLayer('text', { start: 2 }).end === 6 && blankLayer('text', { end: 9 }).end === 9
    && (() => { const l = blankLayer('text', { start: 8 }); return l.start === 8 && l.end === 30; })());
  ok('a blank layer from JSON with a __proto__ key is still a plain layer', (() => {
    const l = blankLayer('text', JSON.parse('{"__proto__":{"text":"evil"},"size":9}'));
    return l.text === 'Your words' && l.size === 9 && ({}).text === undefined;
  })());
}

// ── cost ──────────────────────────────────────────────────────────────────
console.log('cost');
{
  const big = 'x'.repeat(5_000_000);
  const t0 = performance.now();
  const m = readMotion({ title: big, request: big, error: big, layers: [{ kind: 'text', text: big, name: big, hi: big }, { kind: 'counter', prefix: big }, { kind: 'shape', d: big }],
    recipe: { id: 'quote', fields: { quote: big, [big]: 'key' } } }, NOW);
  const dt = performance.now() - t0;
  ok(`a 5 MB string in every field: read in ${dt.toFixed(1)} ms, and capped`, dt < 250 && m.title.length === LIMITS.title && m.request.length === LIMITS.request
    && m.layers[0].text.length === LIMITS.text && m.layers[0].hi === m.layers[0].text && m.layers[1].prefix.length === LIMITS.suffix && !('d' in m.layers[2])
    && m.recipe.fields.quote.length === LIMITS.fieldChars && Object.keys(m.recipe.fields).length === 1, dt);
  const many = Array.from({ length: 10000 }, (_, i) => ({ kind: 'text', id: `t${i}`, text: `Layer ${i}` }));
  const t1 = performance.now();
  const n = readMotion({ layers: many }, NOW);
  const dt1 = performance.now() - t1;
  ok(`10,000 layers: read in ${dt1.toFixed(1)} ms, and capped at ${LIMITS.layers}`, dt1 < 250 && n.layers.length === LIMITS.layers && n.layers[59].id === 't59', dt1);
  const junk = Array.from({ length: 1_000_000 }, (_, i) => (i % 2 ? { kind: 'nope' } : 7));
  const t2 = performance.now();
  const j = readMotion({ layers: junk }, NOW);
  const dt2 = performance.now() - t2;
  ok(`a million junk layers: ${dt2.toFixed(1)} ms, and none kept`, dt2 < 250 && j.layers.length === 0, dt2);
  const t3 = performance.now();
  const pic = readMotion({ layers: [{ kind: 'image', src: `data:image/png;base64,${'A'.repeat(5_000_000)}` }] }, NOW);
  ok(`a 5 MB picture is kept whole, in ${(performance.now() - t3).toFixed(1)} ms`, pic.layers[0].src.length === 5_000_022 && performance.now() - t3 < 250);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
