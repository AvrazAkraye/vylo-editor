// Motion's maths: the curves, colours, noise and path geometry every frame
// is drawn with.
//
// What matters: a finished effect rests exactly (every ease is 0 at 0 and 1
// at 1, not nearly), the curves that must only go forward do, and the ones
// that overshoot do; a colour is read in every form CSS writes it and nothing
// else is a colour; anything that looks random is the same on every render;
// a path in any spelling of the SVG grammar reads to the same absolute
// segments, a malformed one reads to null rather than half a path, and
// lengths, cuts and points along a path agree with each other far inside a
// pixel; every outline is finite and non-empty for any size a model or a
// slider can produce. A NaN here is a blank frame, so the garbage inputs are
// tested as carefully as the good ones.
import { readFileSync } from 'node:fs';
import {
  arcPath, arrowPath, bezier, blobPath, burstPath, clamp, clamp01, contrast, cssOf, easeOf, ellipsePath,
  fbm2, finite, fitPath, flatten, frac, hash01, hexOf, invLerp, isEase, lerp, luminance, mixColors,
  noise1, noise2, parseColor, parsePath, pathBounds, pathLength, pathToString, pointAt, polygonPath,
  readableOn, rectPath, remap, rng, smoothstep, spring, starPath, strokeLength, transformPath, trimPath,
  wavePath, withAlpha, wrap,
} from '../.test-build/motionmath.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
const grid = (n = 2000) => Array.from({ length: n + 1 }, (_, i) => i / n);
const take = (next, n) => Array.from({ length: n }, () => next());

// ── numbers ───────────────────────────────────────────────────────────────
ok('clamp holds a number to its range', clamp(5, 0, 10) === 5 && clamp(-1, 0, 10) === 0 && clamp(11, 0, 10) === 10);
ok('clamp: NaN reads as the low edge, and crossed bounds give the low edge',
  clamp(NaN, 2, 10) === 2 && clamp(5, 10, 0) === 10 && clamp(-5, 10, 0) === 10 && clamp(50, 10, 0) === 10);
ok('clamp holds infinities too', clamp(Infinity, 0, 1) === 1 && clamp(-Infinity, 0, 1) === 0);
ok('clamp01, NaN as 0', clamp01(0.3) === 0.3 && clamp01(-2) === 0 && clamp01(7) === 1 && clamp01(NaN) === 0 && clamp01(Infinity) === 1);
ok('lerp: its ends, and unclamped between and beyond', lerp(0.1, 0.7, 0) === 0.1 && lerp(0, 10, 0.25) === 2.5 && lerp(0, 10, 1.5) === 15 && lerp(0, 10, -0.5) === -5);
{
  const r = rng(3);
  let exact = true;
  for (let i = 0; i < 2000; i++) {
    const a = (r() - 0.5) * 10 ** (r() * 8 - 2), b = (r() - 0.5) * 10 ** (r() * 8 - 2);
    if (lerp(a, b, 1) !== b || lerp(a, b, 0) !== a) exact = false;
  }
  ok('lerp lands exactly on b at 1 and on a at 0, for 2000 awkward pairs (a finished effect rests precisely)', exact);
}
ok('lerp: NaN t stays at a; equal ends stay put; opposite huge ends do not overflow',
  lerp(3, 9, NaN) === 3 && lerp(0.1, 0.1, 0.3) === 0.1 && lerp(-1e308, 1e308, 0.5) === 0);
ok('invLerp, unclamped; 0 for an empty span or NaN', invLerp(10, 20, 15) === 0.5 && invLerp(10, 20, 30) === 2 && invLerp(5, 5, 7) === 0 && invLerp(0, 1, NaN) === 0);
ok('remap carries a value between spans; an empty span gives the start', remap(15, 10, 20, 100, 200) === 150 && remap(3, 3, 3, 7, 9) === 7);
ok('smoothstep: flat ends, 0.5 in the middle, a hard step when a = b, NaN as 0',
  smoothstep(0, 1, -1) === 0 && smoothstep(0, 1, 2) === 1 && smoothstep(0, 1, 0.5) === 0.5
  && smoothstep(2, 2, 1) === 0 && smoothstep(2, 2, 3) === 1 && smoothstep(0, 1, NaN) === 0);
ok('frac: always in [0, 1), negatives included; non-finite is 0',
  frac(2.25) === 0.25 && frac(-0.25) === 0.75 && frac(-1e-20) === 0 && frac(NaN) === 0 && frac(Infinity) === 0);
{
  const r = rng(9);
  let good = true;
  for (let i = 0; i < 5000; i++) {
    const f = frac((r() - 0.5) * 10 ** (r() * 14 - 7));
    if (!(f >= 0 && f < 1)) good = false;
  }
  ok('frac stays in [0, 1) over fourteen orders of magnitude', good);
}
ok('wrap is a positive modulo; a zero or non-finite divisor gives 0',
  wrap(-30, 360) === 330 && wrap(725, 360) === 5 && wrap(-360, 360) === 0 && wrap(5, -3) === 2
  && wrap(5, 0) === 0 && wrap(NaN, 3) === 0 && wrap(1, NaN) === 0 && wrap(1, Infinity) === 0);
{
  const r = rng(10);
  let good = true;
  for (let i = 0; i < 5000; i++) {
    const n = r() * 100 + 1e-3, w = wrap((r() - 0.5) * 1e6, n);
    if (!(w >= 0 && w < n)) good = false;
  }
  ok('wrap stays in [0, n) for 5000 random pairs', good);
}
ok('finite: finite numbers pass, anything else is the fallback',
  finite(3, 1) === 3 && finite(-0.5, 1) === -0.5 && [NaN, Infinity, -Infinity, '3', null, undefined, {}, [2]].every((x) => finite(x, 1) === 1));

// ── easing ────────────────────────────────────────────────────────────────
const EASE_WORDS = ['linear', 'in', 'out', 'inout', 'soft', 'cubic-out', 'quart-out', 'expo-out', 'expo-inout', 'circ-out',
  'back-out', 'back-inout', 'elastic-out', 'bounce-out', 'spring', 'snappy'];
{
  const src = readFileSync(new URL('../src/motiontypes.ts', import.meta.url), 'utf8');
  const m = /export const EASES = \[([\s\S]*?)\] as const/.exec(src);
  const listed = m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
  ok('the words tested here are exactly the contract\'s EASES', same(listed, EASE_WORDS), listed);
}
for (const name of EASE_WORDS) {
  const f = easeOf(name);
  ok(`${name}: exactly 0 at 0 and 1 at 1; input held to 0..1, NaN as 0`,
    f(0) === 0 && f(1) === 1 && f(-0.5) === 0 && f(1.5) === 1 && f(NaN) === 0 && f(-Infinity) === 0 && f(Infinity) === 1,
    [f(0), f(1), f(-0.5), f(1.5), f(NaN)]);
  ok(`${name}: finite at 4001 points, and a known word`, grid(4000).every((x) => Number.isFinite(f(x))) && isEase(name));
}
for (const name of ['linear', 'in', 'out', 'inout', 'soft', 'cubic-out', 'quart-out', 'expo-out', 'expo-inout', 'circ-out', 'snappy']) {
  const ys = grid(4000).map(easeOf(name));
  ok(`${name} never goes backwards and never leaves 0..1`, ys.every((y, i) => y >= 0 && y <= 1 && (i === 0 || y >= ys[i - 1])));
}
{
  const f = (n) => easeOf(n);
  ok('the definitions: in x³, out 1-(1-x)³, inout, soft, quart-out, circ-out',
    f('in')(0.5) === 0.125 && f('out')(0.5) === 0.875 && f('inout')(0.25) === 0.0625 && near(f('inout')(0.75), 0.9375, 1e-15)
    && near(f('soft')(0.5), 0.5, 1e-15) && f('quart-out')(0.5) === 0.9375 && near(f('circ-out')(0.5), Math.sqrt(0.75), 1e-15));
  ok('expo-out is 1-2^(-10x) lifted to meet 1 without a last-frame jump', near(f('expo-out')(0.5), (1 - 2 ** -5) / (1 - 2 ** -10), 1e-12)
    && near(f('expo-out')(1 - 1e-9), 1, 1e-6) && near(f('expo-inout')(0.5), 0.5, 1e-15));
  ok('back-out, elastic-out and bounce-out are the standard curves',
    near(f('back-out')(0.5), 1 + 2.70158 * -0.125 + 1.70158 * 0.25, 1e-12) && near(f('elastic-out')(0.5), 1 + 2 ** -5 * 0.5, 1e-9)
    && near(f('bounce-out')(0.5), 0.765625, 1e-12));
  ok('`out` and `cubic-out` are one curve', grid(200).every((x) => f('out')(x) === f('cubic-out')(x)));
}
for (const name of ['back-out', 'back-inout', 'elastic-out', 'spring']) {
  const peak = Math.max(...grid(4000).map(easeOf(name)));
  ok(`${name} overshoots past 1 somewhere`, peak > 1.01, peak);
}
ok('back-inout also pulls back under 0 on the way out', Math.min(...grid(4000).map(easeOf('back-inout'))) < -0.05);
{
  const ys = grid(10000).map(easeOf('bounce-out'));
  ok('bounce-out bounces inside [0, 1.0001]', Math.min(...ys) >= 0 && Math.max(...ys) <= 1.0001);
}
{
  const f = easeOf('spring');
  const peak = Math.max(...grid(10000).map(f));
  ok('spring overshoots 10–15%, a damping ratio of about 0.55', peak > 1.1 && peak < 1.15, peak);
  ok('spring is within 0.005 of rest from 92% on', grid(10000).filter((x) => x >= 0.92).every((x) => Math.abs(f(x) - 1) < 0.005));
  ok('spring arrives without a jump on the last frame', Math.abs(f(1 - 1e-7) - 1) < 1e-7 && Math.abs(f(0.999) - 1) < 1e-4);
  ok('spring starts from rest (no instant jump off 0)', f(0.001) < 0.01);
}
ok('spring(): other dampings and stiffnesses, including nonsense, keep exact finite ends',
  [[0.2, 1], [0.9, 8], [0.05, 0.25], [NaN, NaN], [5, -3], [-1, 1e9]].every(([z, c]) => {
    const f = spring(z, c);
    return f(0) === 0 && f(1) === 1 && grid(1000).every((x) => Number.isFinite(f(x)));
  }));
ok('a looser spring overshoots further', Math.max(...grid(4000).map(spring(0.3))) > Math.max(...grid(4000).map(spring(0.7))));

// ── bezier ────────────────────────────────────────────────────────────────
{
  // An independent solve: 80 halvings on the parameter, no Newton.
  const ref = (x1, y1, x2, y2) => (x) => {
    const bx = (t) => 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t * t * x2 + t ** 3;
    const by = (t) => 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t * t * y2 + t ** 3;
    let lo = 0, hi = 1;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
    return by((lo + hi) / 2);
  };
  ok('bezier(0.25, 0.1, 0.25, 1) — CSS `ease` — is 0.8024 at 50%', near(bezier(0.25, 0.1, 0.25, 1)(0.5), 0.8024, 1e-4), bezier(0.25, 0.1, 0.25, 1)(0.5));
  const r = rng(77);
  let worst = 0;
  const curves = [[0, 1, 1, 0], [1, 1, 0, 0], [0.42, 0, 0.58, 1], [0.16, 1, 0.3, 1], [0.68, -0.6, 0.32, 1.6], [0, 0, 0.58, 1], [0.9, 0.1, 0.1, 0.9]];
  for (let c = 0; c < 60; c++) curves.push([r(), r() * 3 - 1, r(), r() * 3 - 1]);
  for (const [x1, y1, x2, y2] of curves) {
    const f = bezier(x1, y1, x2, y2), g = ref(x1, y1, x2, y2);
    for (let i = 1; i < 200; i++) worst = Math.max(worst, Math.abs(f(i / 200) - g(i / 200)));
  }
  ok('bezier agrees with a brute-force solve to 1e-7 on 67 curves', worst < 1e-7, worst);
  // bezier(1, 0, 0, 1) stops dead at x = 0.5 (zero slope in x): a band of
  // parameters about 5e-6 wide all evaluate to exactly 0.5 in doubles, so no
  // solver can do better than that band. The truth there is 0.5, by symmetry.
  const flat = bezier(1, 0, 0, 1), flatRef = ref(1, 0, 0, 1);
  ok('the flattest curve CSS allows is within 2e-6 where it stops dead, and within 1e-5 everywhere',
    near(flat(0.5), 0.5, 2e-6) && grid(400).every((x) => near(flat(x) + flat(1 - x), 1, 1e-5) && near(flat(x), flatRef(x), 1e-5)), flat(0.5));
  ok('bezier(0, 0, 1, 1) is the straight line', grid(100).every((x) => near(bezier(0, 0, 1, 1)(x), x, 1e-9)));
  ok('CSS ease-in and ease-out mirror each other', grid(100).every((x) => near(bezier(0.42, 0, 1, 1)(x) + bezier(0, 0, 0.58, 1)(1 - x), 1, 1e-8)));
  const held = bezier(-1, 0.5, 2, 0.5);
  const ys = grid(1000).map(held);
  ok('x1 and x2 are held to 0..1, so the curve stays a function going forward', ys.every((y, i) => Number.isFinite(y) && (i === 0 || y >= ys[i - 1])));
  const wild = bezier(NaN, Infinity, NaN, -Infinity);
  ok('non-finite controls still give a curve with exact ends', wild(0) === 0 && wild(1) === 1 && grid(100).every((x) => Number.isFinite(wild(x))));
  ok('y controls are held to ±10', Math.max(...grid(1000).map(bezier(0.5, 1e9, 0.5, 1))) < 10);
}
{
  const out = easeOf('out');
  ok('easeOf reads `bezier( .25 , .1 , .25 , 1 )`, spacing and all',
    grid(50).every((x) => easeOf('bezier( .25 , .1 , .25 , 1 )')(x) === bezier(0.25, 0.1, 0.25, 1)(x)));
  ok('`cubic-bezier(…)` is the same curve under the CSS name, and snappy is bezier(0.16, 1, 0.3, 1)',
    grid(50).every((x) => easeOf('cubic-bezier(0.16,1,0.3,1)')(x) === easeOf('snappy')(x)));
  ok('case and spacing do not change a word', easeOf(' Expo-Out ') === easeOf('expo-out') && easeOf('SPRING') === easeOf('spring'));
  const unknown = ['wobble', '', ' ', 'ease-in', 'bezier(1,2,3)', 'bezier(0,0,1,1', 'bezier(a,b,c,d)', 'bezier(1e999,0,1,1)',
    'bezier(0,0,1,1)x', 'constructor', '__proto__', 'toString', 'hasOwnProperty'];
  ok('an unknown word eases as `out`', unknown.every((w) => easeOf(w) === out));
  ok('so does anything that is not a string', [null, undefined, 42, {}, ['out'], NaN].every((w) => easeOf(w) === out));
  ok('isEase knows the words and bezier strings, and nothing else',
    unknown.every((w) => !isEase(w)) && isEase('bezier(0,0,1,1)') && isEase('CUBIC-BEZIER(0, 0, 1, 1)') && isEase('bezier(-1,5,2,-5)') && !isEase(null));
}

// ── colour ────────────────────────────────────────────────────────────────
{
  const rgba = (s) => { const c = parseColor(s); return c && [c.r, c.g, c.b, Math.round(c.a * 1000) / 1000]; };
  ok('#rgb, #rgba, #rrggbb and #rrggbbaa, any case',
    same(rgba('#fff'), [255, 255, 255, 1]) && same(rgba('#0F08'), [0, 255, 0, 0.533]) && same(rgba('#FF8000'), [255, 128, 0, 1])
    && same(rgba('#ff800080'), [255, 128, 0, 0.502]) && same(rgba('  #AbCdEf  '), [171, 205, 239, 1]));
  ok('rgb() and rgba(): commas, spaces, percentages, a slash before alpha',
    same(rgba('rgb(255, 128, 0)'), [255, 128, 0, 1]) && same(rgba('rgb(255 128 0)'), [255, 128, 0, 1])
    && same(rgba('rgb(100%, 50%, 0%)'), [255, 127.5, 0, 1]) && same(rgba('rgba(0,0,0,0.5)'), [0, 0, 0, 0.5])
    && same(rgba('rgb(0 0 0 / 50%)'), [0, 0, 0, 0.5]) && same(rgba('RGBA(10 20 30 / .25)'), [10, 20, 30, 0.25])
    && same(rgba('rgb(1,2,3,40%)'), [1, 2, 3, 0.4]));
  ok('channels out of range are clamped, as CSS does', same(rgba('rgb(300, -5, 1e2)'), [255, 0, 100, 1]) && same(rgba('rgba(0,0,0,7)'), [0, 0, 0, 1]));
  ok('hsl() and hsla(), with angle units',
    same(rgba('hsl(0, 100%, 50%)'), [255, 0, 0, 1]) && same(rgba('hsl(120 100% 25%)'), [0, 127.5, 0, 1])
    && same(rgba('hsla(240, 100%, 50%, 0.5)'), [0, 0, 255, 0.5]) && same(rgba('hsl(0.5turn 100% 50%)'), [0, 255, 255, 1])
    && same(rgba('hsl(-120deg 100% 50%)'), [0, 0, 255, 1]) && same(rgba('hsl(0 0% 100% / 10%)'), [255, 255, 255, 0.1]));
  ok('white, black and transparent, and no other names',
    same(rgba(' White '), [255, 255, 255, 1]) && same(rgba('BLACK'), [0, 0, 0, 1]) && same(rgba('transparent'), [0, 0, 0, 0])
    && parseColor('red') === null && parseColor('accent') === null);
  const garbage = ['javascript:1', '#12', '#12345', '#1234567', '#ggg', 'rgb(1,2)', 'rgb(1,2,3,4,5)', 'rgb(a,b,c)', 'rgb(1 2, 3)',
    'rgb(1 2 3 / )', 'rgb(1 2 3 / 4 / 5)', 'rgb (1,2,3)', 'rgb(1,2,3', 'hsl(1,2,3', 'hsl(x, 1%, 1%)', 'url(x)', '', '   ',
    'rgb(1e999,0,0)', 'expression(alert(1))', '#fff;background:red', 'rgb(1,,2,3)', 'rgb(,1,2,3)'];
  ok('garbage is not a colour', garbage.every((s) => parseColor(s) === null), garbage.filter((s) => parseColor(s) !== null));
  ok('nor is anything that is not a string, nor a string too long to be one',
    [null, undefined, 12, {}, ['#fff'], NaN, true].every((s) => parseColor(s) === null) && parseColor(`rgb(${' '.repeat(300)}1,2,3)`) === null);
}
ok('cssOf: #rrggbb when opaque, rgba() when not, fields made safe',
  cssOf({ r: 255, g: 128, b: 0, a: 1 }) === '#ff8000' && cssOf({ r: 255, g: 0, b: 0, a: 0.5 }) === 'rgba(255,0,0,0.5)'
  && cssOf({ r: 127.5, g: 300, b: -4, a: 0.12345 }) === 'rgba(128,255,0,0.123)'
  && cssOf({ r: NaN, g: Infinity, b: 0, a: NaN }) === '#000000' && cssOf(null) === '#000000' && cssOf({ r: 1, g: 2, b: 3, a: 0.9999 }) === '#010203');
ok('hexOf: #RRGGBB upper-case, alpha dropped; null for a non-colour',
  hexOf('#abc') === '#AABBCC' && hexOf('rgba(255,0,0,0.5)') === '#FF0000' && hexOf('hsl(120 100% 25%)') === '#008000' && hexOf('nope') === null && hexOf(3) === null);
ok('mixColors: 0 is a, 1 is b, linear between, t held to 0..1',
  mixColors('#000000', '#ffffff', 0) === '#000000' && mixColors('#000000', '#ffffff', 1) === '#ffffff'
  && mixColors('#000000', '#ffffff', 0.5) === '#808080' && mixColors('#000', '#fff', 7) === '#ffffff' && mixColors('#000', '#fff', NaN) === '#000000');
ok('mixColors toward transparent keeps the hue (no grey fringe) and fades alpha',
  mixColors('#ff0000', 'transparent', 0.5) === 'rgba(255,0,0,0.5)' && mixColors('rgba(0,0,255,0.2)', '#0000ff', 0.5) === 'rgba(0,0,255,0.6)'
  && mixColors('transparent', 'transparent', 0.5) === 'rgba(0,0,0,0)');
ok('mixColors: an unreadable colour gives the other one; two give black',
  mixColors('nope', '#FFF', 0.5) === '#ffffff' && mixColors('#123456', 42, 0.9) === '#123456' && mixColors('x', 'y', 0.5) === '#000000');
ok('withAlpha replaces alpha; NaN keeps the colour\'s own; garbage is black',
  withAlpha('#ff0000', 0.5) === 'rgba(255,0,0,0.5)' && withAlpha('#ff000080', 1) === '#ff0000' && withAlpha('rgba(0,0,0,0.25)', NaN) === 'rgba(0,0,0,0.25)'
  && withAlpha('nope', 0.3) === 'rgba(0,0,0,0.3)' && withAlpha('#fff', 9) === '#ffffff');
ok('luminance runs from black to white; garbage counts as black',
  luminance('#000') === 0 && near(luminance('#fff'), 1, 1e-12) && luminance('nope') === 0 && near(luminance('#808080'), 0.2158605, 1e-6));
ok('black on white is 21:1, symmetric, and a colour on itself is 1:1',
  near(contrast('#000000', 'white'), 21, 1e-9) && contrast('#123456', '#abcdef') === contrast('#abcdef', '#123456') && contrast('#777', '#777') === 1);
ok('readableOn picks whichever reads better, returned as given',
  readableOn('#000000', '#ffffff', '#111111') === '#ffffff' && readableOn('#ffffff', 'white', '#111111') === '#111111'
  && readableOn('#FFE14D', '#FFFFFF', '#1a1a1a') === '#1a1a1a' && readableOn('#1B1446', 'white', 'black') === 'white');

// ── randomness and noise ──────────────────────────────────────────────────
{
  // mulberry32 as published, and murmur3's finaliser as published: rng is the
  // one seeded through the other. Pinned, because changing either would
  // silently re-roll every seeded picture anyone has made.
  const mulberry32 = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fmix32 = (h) => {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    return h ^ (h >>> 16);
  };
  ok('rng is mulberry32 seeded through murmur3\'s finaliser', [0, 1, 42, 123456789, 2 ** 31 - 1, 2 ** 32 - 1].every((s) => same(take(rng(s), 50), take(mulberry32(fmix32(s | 0)), 50))));
  const firstOf = (from, to, f) => { const seen = new Set(); let dup = 0; for (let s = from; s <= to; s++) { const v = f(s); if (seen.has(v)) dup++; seen.add(v); } return dup; };
  ok('neighbouring seeds do not share first values (plain mulberry32 repeats a fifth of them)',
    firstOf(0, 100000, (s) => rng(s)()) < 20 && firstOf(0, 100000, (s) => mulberry32(s)()) > 10000, firstOf(0, 100000, (s) => rng(s)()));
  const xs = take(rng(42), 20000);
  ok('rng: the same seed is the same stream', same(xs.slice(0, 1000), take(rng(42), 1000)));
  ok('rng: every value in [0, 1), mean about a half', xs.every((x) => x >= 0 && x < 1) && Math.abs(xs.reduce((s, x) => s + x, 0) / xs.length - 0.5) < 0.01);
  const firsts = [0, 1, -1, 1.2, 1.7, -0.5, 2 ** 32, 2 ** 32 + 1, 1e20, -1e20, 0.1, 0.2].map((s) => rng(s)());
  ok('rng: different seeds — fractions, negatives and huge ones included — are different streams', new Set(firsts).size === firsts.length, firsts);
  const many = [];
  for (let s = -1500; s <= 1500; s++) {
    many.push(rng(s)(), rng(s + 0.5)());
    if (s) many.push(rng(s * 2 ** 32 + 1)());
  }
  ok('rng: 9002 seeds around zero, halfway between, and 2^32 apart all start differently', new Set(many).size === many.length, many.length - new Set(many).size);
  ok('rng: a non-finite seed is seed 0', same(take(rng(NaN), 5), take(rng(0), 5)) && same(take(rng(-Infinity), 5), take(rng(0), 5)));
}
{
  const N = 20000;
  const buckets = new Array(20).fill(0);
  let sum = 0, corr = 0, prev = hash01(-1, 7);
  for (let i = 0; i < N; i++) {
    const h = hash01(i, 7);
    buckets[Math.floor(h * 20)]++;
    sum += h;
    corr += (h - 0.5) * (prev - 0.5);
    prev = h;
  }
  const chi = buckets.reduce((s, b) => s + (b - N / 20) ** 2 / (N / 20), 0);
  ok('hash01 over consecutive integers fills 20 buckets evenly (χ² under the p = 0.001 line, 43.8)', chi < 43.8, chi);
  ok('hash01: mean about a half, neighbours uncorrelated', Math.abs(sum / N - 0.5) < 0.01 && Math.abs(corr / N / (1 / 12)) < 0.03, [sum / N, corr / N * 12]);
  ok('hash01 is a pure function; order, fractions and every argument count',
    hash01(3, 4, 5) === hash01(3, 4, 5) && hash01(1, 2) !== hash01(2, 1) && hash01(1.5) !== hash01(1) && hash01(1, 0, 0) !== hash01(1, 0, 1) && hash01(-1) !== hash01(1));
  ok('hash01 stays in [0, 1) for any input, garbage included',
    [0, -0, 1e300, -1e300, NaN, Infinity, 0.5, 2 ** 53].every((x) => { const h = hash01(x, x, x); return h >= 0 && h < 1; }));
}
{
  let worst1 = 0, worst2 = 0, lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (let i = 0; i < 20000; i++) {
    const x = i * 0.0137 - 50, y = i * 0.0071 - 20;
    const a = noise1(x, 3);
    worst1 = Math.max(worst1, Math.abs(noise1(x + 1e-4, 3) - a));
    lo = Math.min(lo, a); hi = Math.max(hi, a);
    const b = noise2(x, y, 3);
    worst2 = Math.max(worst2, Math.abs(noise2(x + 1e-4, y, 3) - b), Math.abs(noise2(x, y + 1e-4, 3) - b));
    lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b);
  }
  ok('noise1 is continuous: a step of 1e-4 moves it less than 1e-3', worst1 < 1e-3, worst1);
  ok('noise1 stays in [-1, 1] and uses most of it', lo >= -1 && hi <= 1 && hi - lo > 1.2, [lo, hi]);
  ok('noise2 is continuous in both directions', worst2 < 1e-3, worst2);
  ok('noise2 stays in [-1, 1] and uses most of it', lo2 >= -1 && hi2 <= 1 && hi2 - lo2 > 1.2, [lo2, hi2]);
  ok('noise is continuous across a lattice line', Math.abs(noise2(3 - 1e-9, 0.4) - noise2(3 + 1e-9, 0.4)) < 1e-7 && Math.abs(noise1(-2 - 1e-9) - noise1(-2 + 1e-9)) < 1e-7);
  ok('noise is seeded: same seed same value, another seed another', noise2(1.3, 2.7, 5) === noise2(1.3, 2.7, 5) && noise2(1.3, 2.7, 5) !== noise2(1.3, 2.7, 6) && noise1(0.5, 1) !== noise1(0.5, 2));
  ok('noise of garbage is a number', [NaN, Infinity, -Infinity].every((v) => Number.isFinite(noise1(v, v)) && Number.isFinite(noise2(v, v, v)) && Number.isFinite(fbm2(v, v, v, v))));
  let flo = Infinity, fhi = -Infinity;
  for (let i = 0; i < 5000; i++) { const v = fbm2(i * 0.037, i * 0.021, 5, 9); flo = Math.min(flo, v); fhi = Math.max(fhi, v); }
  ok('fbm2 stays within [-1, 1] and is deterministic', flo >= -1 && fhi <= 1 && fhi - flo > 0.5 && fbm2(0.3, 0.7, 4, 2) === fbm2(0.3, 0.7, 4, 2), [flo, fhi]);
  ok('fbm2: octaves are held to 1..8; one octave is noise2 itself', fbm2(0.3, 0.7, 1, 2) === noise2(0.3, 0.7, 2)
    && fbm2(0.3, 0.7, 0, 2) === fbm2(0.3, 0.7, 1, 2) && fbm2(0.3, 0.7, 99, 2) === fbm2(0.3, 0.7, 8, 2) && Number.isFinite(fbm2(0.3, 0.7, NaN, 2)));
}

// ── paths: reading ────────────────────────────────────────────────────────
const M = (x, y) => ({ t: 'M', p: [x, y] });
const L = (x, y) => ({ t: 'L', p: [x, y] });
const C = (...p) => ({ t: 'C', p });
const Z = { t: 'Z', p: [] };
const P = (d) => parsePath(d);
const segsNear = (a, b, eps) => Array.isArray(a) && Array.isArray(b) && a.length === b.length
  && a.every((s, i) => s.t === b[i].t && s.p.length === b[i].p.length && s.p.every((v, k) => Math.abs(v - b[i].p[k]) <= eps));
const poly = (lines) => lines.reduce((sum, { pts, closed }) => {
  let s = 0;
  for (let i = 2; i < pts.length; i += 2) s += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  if (closed && pts.length >= 4) s += Math.hypot(pts[0] - pts[pts.length - 2], pts[1] - pts[pts.length - 1]);
  return sum + s;
}, 0);

ok('a plain path reads as absolute segments', same(P('M10 20 L30 40 C1 2 3 4 5 6 Z'), [M(10, 20), L(30, 40), C(1, 2, 3, 4, 5, 6), Z]));
ok('numbers run together: .5.5 is two, -.5-.5 is two, 1e-3 is one',
  same(P('M.5.5'), [M(0.5, 0.5)]) && same(P('M1e-3-.5L-.5-.5'), [M(0.001, -0.5), L(-0.5, -0.5)])
  && same(P('M1.5.5'), [M(1.5, 0.5)]) && same(P('M1E2,+2e+1'), [M(100, 20)]) && same(P('M1.e1 2.'), [M(10, 2)]) && same(P('M1e1.5'), [M(10, 0.5)]));
ok('separators: commas, tabs and newlines, or none at all',
  same(P('M 10,20\tL\n30 , 40'), P('M10 20L30 40')) && same(P('M10-20l5-5'), [M(10, -20), L(15, -25)]));
ok('a command is repeated by listing more numbers: after M they are lines',
  same(P('M0 0 10 0 20 0'), [M(0, 0), L(10, 0), L(20, 0)]) && same(P('m1 1 2 2 3 3'), [M(1, 1), L(3, 3), L(6, 6)])
  && same(P('M0 0 C1 2 3 4 5 6 7 8 9 10 11 12'), [M(0, 0), C(1, 2, 3, 4, 5, 6), C(7, 8, 9, 10, 11, 12)]));
ok('relative commands, H and V become lines', same(P('M0,0L10,0l0,10h-10v-10z'), [M(0, 0), L(10, 0), L(10, 10), L(0, 10), L(0, 0), Z]));
ok('a relative move after Z is from the closed subpath\'s start', same(P('M10 10 L20 10 Z m5 5 l1 0'), [M(10, 10), L(20, 10), Z, M(15, 15), L(16, 15)]));
ok('drawing on after Z starts its new subpath with an explicit M', same(P('M0 0 L10 0 L10 10 Z L20 20'), [M(0, 0), L(10, 0), L(10, 10), Z, M(0, 0), L(20, 20)]));
ok('a move straight after a move keeps only the last; a doubled Z is one', same(P('M1 1 M2 2 L3 3 Z Z'), [M(2, 2), L(3, 3), Z]));
ok('S reflects the previous curve\'s second handle, and only after C or S',
  same(P('M0 0 C10 0 20 10 30 10 S50 20 60 20')[2], C(40, 10, 50, 20, 60, 20)) && same(P('M0 0 S10 10 20 0')[1], C(0, 0, 10, 10, 20, 0))
  && same(P('M0 0 L5 5 S10 10 20 0')[2], C(5, 5, 10, 10, 20, 0)) && same(P('M0 0 c10 0 20 10 30 10 s20 10 30 10')[2], C(40, 10, 50, 20, 60, 20)));
ok('Q is raised to the cubic that draws the same curve', segsNear(P('M0 0 Q50 100 100 0'), [M(0, 0), C(100 / 3, 200 / 3, 200 / 3, 200 / 3, 100, 0)], 1e-12));
ok('T reflects the previous quadratic\'s control point; with none it is a straight run',
  segsNear(P('M0 0 Q25 50 50 0 T100 0'), [M(0, 0), C(50 / 3, 100 / 3, 100 / 3, 100 / 3, 50, 0), C(200 / 3, -100 / 3, 250 / 3, -100 / 3, 100, 0)], 1e-12)
  && segsNear(P('M0 0 T30 0'), [M(0, 0), C(0, 0, 10, 0, 30, 0)], 1e-12) && segsNear(P('M0 0 q25 50 50 0 t50 0'), P('M0 0 Q25 50 50 0 T100 0'), 1e-12));
{
  const circle = P('M 0 -50 A 50 50 0 1 1 0 50 A 50 50 0 1 1 0 -50 Z');
  ok('a circle drawn as two arcs is 2πr long, to 0.2%', Math.abs(pathLength(circle) / (100 * Math.PI) - 1) < 0.002, pathLength(circle));
  ok('arcs become cubics of at most 90°, each ending exactly on its endpoint',
    circle.filter((s) => s.t === 'C').length === 4 && same(circle[2].p.slice(4), [0, 50]) && same(circle[4].p.slice(4), [0, -50]));
  let worst = 0;
  const pts = flatten(circle, 0.001)[0].pts;
  for (let i = 0; i < pts.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(pts[i], pts[i + 1]) - 50));
  ok('every point of that circle is 50 from its centre', worst < 0.02, worst);
  ok('arc flags written without separators: a1 1 0 00.5.5', (() => {
    const a = P('M0 0a1 1 0 00.5.5');
    return a.length === 2 && a[1].t === 'C' && same(a[1].p.slice(4), [0.5, 0.5]);
  })());
  ok('radii too small to reach are scaled up, to a semicircle', Math.abs(pathLength(P('M0 0 A1 1 0 0 1 100 0')) / (50 * Math.PI) - 1) < 0.001);
  ok('the sweep flag chooses the side, the large-arc flag the long way round',
    near(pathBounds(P('M0 0 A50 50 0 0 1 100 0')).y, -50, 1e-9) && near(pathBounds(P('M0 0 A50 50 0 0 0 100 0')).h, 50, 1e-9)
    && near(pathLength(P('M0 0 A50 50 0 1 1 50 50')), 0.75 * 100 * Math.PI, 0.05) && near(pathLength(P('M0 0 A50 50 0 0 1 50 50')), 0.25 * 100 * Math.PI, 0.02));
  const r30 = (x, y) => [x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6), x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6)];
  const [ax, ay] = r30(-100, 0);
  const [bx, by] = r30(100, 0);
  const tilted = P(`M${ax} ${ay} A100 50 30 0 1 ${bx} ${by}`);
  const tp = flatten(tilted, 0.001)[0].pts;
  let off = 0;
  for (let i = 0; i < tp.length; i += 2) {
    const u = tp[i] * Math.cos(Math.PI / 6) + tp[i + 1] * Math.sin(Math.PI / 6);
    const v = -tp[i] * Math.sin(Math.PI / 6) + tp[i + 1] * Math.cos(Math.PI / 6);
    off = Math.max(off, Math.abs(Math.hypot(u / 100, v / 50) - 1));
  }
  ok('a rotated elliptical arc stays on its rotated ellipse', off < 5e-4 && near(pathLength(tilted), pathLength(P('M-100 0 A100 50 0 0 1 100 0')), 1e-6), off);
  ok('a zero radius is a straight line; an arc to its own start draws nothing',
    same(P('M0 0 A0 10 0 0 1 10 10'), [M(0, 0), L(10, 10)]) && same(P('M5 5 A10 10 0 0 1 5 5'), [M(5, 5)]));
  ok('negative radii are their size; relative arcs are from the current point',
    segsNear(P('M0 0 A-50 -50 0 0 1 100 0'), P('M0 0 A50 50 0 0 1 100 0'), 0) && segsNear(P('M10 10 a50 50 0 0 1 100 0'), P('M10 10 A50 50 0 0 1 110 10'), 1e-9));
}
{
  const bad = ['', '   ', 'L10 10', 'Z', '10 10', 'M10', 'M10 20 L', 'M10 20 30', 'M10 20 X30 40', 'M 1e999 0', 'M1e 0', 'M1e+ 0',
    'M0 0 Z 10 10', 'hello', 'M0 0 A1 1 0 2 0 5 5', 'M0 0 A1 1 0 0 0 5', 'M0 0 L1 1 -', 'M . 5', 'M0 0 L1 1e', 'M0 0 Lnan 1',
    'M0 0 L1 Infinity', 'M0 0 L 2e9 0', 'M0 0 ſ1 1 2 2', 'M0 0 L1 1 # comment', 'M0 0 L1 1 <script>', 'M0 0 H', 'M0 0 C1 2 3 4 5'];
  ok('malformed data is null, never half a path', bad.every((d) => parsePath(d) === null), bad.filter((d) => parsePath(d) !== null));
  ok('so is anything that is not a string', [null, undefined, 42, {}, ['M0 0']].every((d) => parsePath(d) === null));
  const long = 'M0 0' + ' L1 1'.repeat(2000);
  ok('a path over the segment limit is refused; the limit can be raised',
    parsePath(long) === null && parsePath(long, 3000)?.length === 2001 && parsePath('M0 0 L1 1', 1) === null && parsePath('M0 0 L1 1', 2)?.length === 2);
  ok('an arc counts as the cubics it becomes', parsePath('M0 0 A50 50 0 1 1 0 1', 4) === null && parsePath('M0 0 A50 50 0 1 1 0 1', 5)?.length === 5);
  ok('relative steps may not walk a point past a billion, though each number is inside it',
    parsePath('M0 0 l1e9 0 l1e9 0') === null && parsePath('M0 0 l5e8 0 l5e8 0')?.length === 3 && parsePath('M0 0 l6e8 0 s6e8 0 0 0') === null);
}
{
  // Token soup: whatever parses must be finite everywhere downstream, and nothing may throw.
  const r = rng(2024);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const toks = ['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z', 'z',
    ' ', ',', '-', '.', 'e', '0', '1', '5', '.5', '-3', '1e2', '1e-3', '99', '0 0', '1 1', '10 20', 'x', '\n'];
  const finiteAll = (segs) => {
    const b = pathBounds(segs), q = pointAt(segs, r()), cut = trimPath(segs, r() * 0.5, 0.5 + r() * 0.5);
    return Number.isFinite(pathLength(segs)) && [b.x, b.y, b.w, b.h, q.x, q.y, q.angle].every(Number.isFinite)
      && cut.every((s) => s.p.every(Number.isFinite)) && Number.isFinite(pathLength(cut))
      && flatten(segs, 0.5).every((l) => l.pts.every(Number.isFinite)) && !/NaN|Infinity/.test(pathToString(segs));
  };
  let parsed = 0, bad = null;
  for (let i = 0; i < 6000; i++) {
    let d = r() < 0.7 ? 'M' + pick(['0 0', '1 1', '10 20', '-5,5']) : '';
    for (let k = 1 + Math.floor(r() * 25); k > 0; k--) d += pick(toks) + (r() < 0.5 ? ' ' : '');
    try {
      const s = parsePath(d);
      if (s) { parsed++; if (!finiteAll(s) && !bad) bad = d; }
    } catch (e) { if (!bad) bad = `${d} threw ${e.message}`; }
  }
  ok(`6000 random strings: none throws, and the ${parsed} that parse stay finite through every function`, !bad && parsed > 50, bad);
  const junk = () => pick([0, 1, -1, 1e6, NaN, Infinity, -Infinity, undefined, null, 'x', {}, 3.5, -1e300, 1e300]);
  bad = null;
  for (let i = 0; i < 3000; i++) {
    const segs = [];
    for (let k = Math.floor(r() * 12); k > 0; k--) {
      segs.push(r() < 0.05 ? pick([null, 3, 'M']) : { t: pick(['M', 'L', 'C', 'Z', 'Q', undefined, 'm']), p: r() < 0.1 ? pick([null, 'abc', 5]) : Array.from({ length: Math.floor(r() * 8) }, junk) });
    }
    try {
      const moved = transformPath(segs, junk(), junk(), junk(), junk(), junk(), junk()), fitted = fitPath(segs, junk(), junk());
      if (!(finiteAll(segs) && finiteAll(moved) && finiteAll(fitted)) && !bad) bad = segs;
    } catch (e) { if (!bad) bad = e.message; }
  }
  ok('3000 hand-built paths full of holes, NaNs and ±1e300: no throw, nothing non-finite out', !bad, bad);
  ok('a coordinate of 1e300 is held to a billion rather than overflowing to NaN',
    pathLength([{ t: 'M', p: [-1e300, 0] }, { t: 'L', p: [1e300, 0] }]) === 2e9
    && transformPath([M(1, 1)], 1e300, 0, 0, 1e300, 0, 0)[0].p.every((v) => v === 1e9));
}
{
  const paths = ['M10 20 L30 40 C1 2 3 4 5 6 Z', 'M0 0 Q50 100 100 0 T200 0', 'M 0 -50 A 50 50 0 1 1 0 50 A 50 50 0 1 1 0 -50 Z',
    'm1 1 2 2 3 3 h4 v-5 s1 2 3 4 z m7 7 l1 1', 'M0 0a1 1 0 00.5.5', 'M-.5-.5l1e-3 2.5e2', 'M3 3 A40 20 33 1 0 -7 12 z'];
  let good = true, again = true;
  for (const d of paths) {
    const a = parsePath(d), text = pathToString(a), b = parsePath(text);
    if (!b || !segsNear(a, b, 1e-6)) good = false;
    if (pathToString(b) !== text) again = false;
  }
  ok('pathToString reads back through parsePath to the same segments, to a millionth', good);
  ok('writing what it read back gives the same text', again);
  ok('an integer path comes back exactly', same(parsePath(pathToString(P('M10 20 L30 40 C1 2 3 4 5 6 Z'))), P('M10 20 L30 40 C1 2 3 4 5 6 Z')));
  ok('the text is what Path2D takes', pathToString(P('M10 20 L30 40 Z')) === 'M10 20 L30 40 Z' && pathToString([]) === '');
  ok('a hand-built path with holes in it is written with zeros, and one without a move starts at the origin',
    pathToString([{ t: 'L', p: [5] }, { t: 'Q', p: [1, 2] }, null, { t: 'Z' }, { t: 'L', p: [NaN, Infinity] }]) === 'M0 0 L5 0 Z L0 0');
}
{
  // motiondraw reads every icon through parsePath: each of the app's icons must read. Taken from the
  // source text, so the count guards against the extraction quietly finding nothing.
  const src = readFileSync(new URL('../src/videoicons.tsx', import.meta.url), 'utf8');
  const block = /export const ICON_PATHS[^{]*\{([\s\S]*?)\n\};/.exec(src);
  const icons = block ? [...block[1].matchAll(/^\s*['"]?([\w-]+)['"]?:\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]) : [];
  const wrong = icons.filter(([, d]) => {
    const p = parsePath(d);
    if (!p) return true;
    const b = pathBounds(p);
    return !(b.x >= -1 && b.y >= -1 && b.x + b.w <= 25 && b.y + b.h <= 25) || Math.abs(poly(flatten(p, 0.0005)) / pathLength(p) - 1) > 1e-4;
  }).map(([name]) => name);
  ok(`all ${icons.length} of the app's icon paths read, stay in their 24 grid, and measure as they flatten`, icons.length >= 40 && !wrong.length, wrong);
}

// ── paths: measuring and cutting ──────────────────────────────────────────
ok('a unit circle from ellipsePath is 2π long, to 0.1%', Math.abs(pathLength(ellipsePath(2, 2)) / (2 * Math.PI) - 1) < 0.001, pathLength(ellipsePath(2, 2)));
ok('length does not depend on scale: ten times the circle is ten times as long', near(pathLength(ellipsePath(20, 20)), 10 * pathLength(ellipsePath(2, 2)), 1e-9));
ok('lines and the closing edge count; moves do not',
  pathLength(P('M0 0 L3 4')) === 5 && near(pathLength(P('M0 0 L10 0 L10 10 Z')), 20 + Math.hypot(10, 10), 1e-12)
  && pathLength(P('M0 0 M5 5')) === 0 && pathLength([]) === 0 && pathLength(null) === 0);
ok('a straight cubic measures as its line', near(pathLength(P('M0 0 C10 0 20 0 30 0')), 30, 1e-9));
{
  const cusp = P('M0 0 C100 100 0 100 100 0');
  const measured = pathLength(cusp), fine = poly(flatten(cusp, 1e-5));
  ok('a cusp (zero speed mid-curve) does not trip the measure', Math.abs(measured / fine - 1) < 1e-5, [measured, fine]);
}
ok('strokeLength is pathLength', strokeLength === pathLength);
{
  const line = P('M0 0 L100 0');
  ok('trimming a line 0.25 → 0.75 keeps exactly its middle half', same(trimPath(line, 0.25, 0.75), [M(25, 0), L(75, 0)]) && pathLength(trimPath(line, 0.25, 0.75)) === 50);
  ok('from ≥ to is nothing; the ends are held to 0..1; NaN is 0',
    same(trimPath(line, 0.5, 0.5), []) && same(trimPath(line, 0.8, 0.2), []) && same(trimPath(line, -1, 0.5), [M(0, 0), L(50, 0)])
    && same(trimPath(line, 0.5, 9), [M(50, 0), L(100, 0)]) && same(trimPath(line, NaN, 0.5), [M(0, 0), L(50, 0)]) && same(trimPath(line, 0.5, NaN), []));
  const curve = P('M0 0 C30 -60 70 60 100 0 S150 -40 200 0');
  const total = pathLength(curve);
  const mid = trimPath(curve, 0.25, 0.75);
  ok('a trimmed curve is still curves: cut, not flattened', mid.length > 1 && mid.every((s) => s.t === 'M' || s.t === 'C'));
  ok('the middle half of a curve is half its length, measured', near(pathLength(mid), total / 2, total * 1e-7), [pathLength(mid), total / 2]);
  ok('and flattened, the same', Math.abs(poly(flatten(mid, 0.001)) / poly(flatten(curve, 0.001)) - 0.5) < 1e-3);
  const a = pointAt(curve, 0.25), b = pointAt(curve, 0.75), end = mid[mid.length - 1].p;
  ok('its ends are where pointAt puts those fractions', Math.hypot(mid[0].p[0] - a.x, mid[0].p[1] - a.y) < 1e-6 && Math.hypot(end[4] - b.x, end[5] - b.y) < 1e-6);
  ok('two cuts at the same place make the whole', near(pathLength(trimPath(curve, 0, 0.4)) + pathLength(trimPath(curve, 0.4, 1)), total, total * 1e-7));
  const ref = flatten(curve, 0.0005)[0].pts;
  const onRef = (x, y) => {
    let d = Infinity;
    for (let i = 2; i < ref.length; i += 2) {
      const x0 = ref[i - 2], y0 = ref[i - 1], dx = ref[i] - x0, dy = ref[i + 1] - y0;
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
      d = Math.min(d, Math.hypot(x0 + dx * t - x, y0 + dy * t - y));
    }
    return d;
  };
  const cutPts = flatten(mid, 0.01)[0].pts;
  let far = 0;
  for (let i = 0; i < cutPts.length; i += 2) far = Math.max(far, onRef(cutPts[i], cutPts[i + 1]));
  ok('the cut pieces lie on the original curve', far < 0.02, far);
}
{
  const square = P('M0 0 L10 0 L10 10 L0 10 Z');
  ok('a closed subpath is cut open, its closing edge becoming a line', same(trimPath(square, 0.5, 1), [M(10, 10), L(0, 10), L(0, 0)]));
  ok('all of it is the path as it was, Z and all', same(trimPath(square, 0, 1), square));
  ok('a cut across subpaths starts each piece with its own move', same(trimPath(P('M0 0 L10 0 M0 10 L10 10'), 0.25, 0.75), [M(5, 0), L(10, 0), M(0, 10), L(5, 10)]));
  ok('a path with no length trims to nothing, but all of it is still itself', same(trimPath(P('M5 5 Z'), 0.2, 0.8), []) && same(trimPath(P('M5 5 Z'), 0, 1), P('M5 5 Z')));
  ok('garbage in, empty out', same(trimPath(null, 0, 0.5), []) && same(trimPath([{ t: 'L' }], 0.1, 0.9), []));
}
{
  const line = P('M0 0 L100 0');
  ok('pointAt along a straight line', same(pointAt(line, 0), { x: 0, y: 0, angle: 0 }) && same(pointAt(line, 0.5), { x: 50, y: 0, angle: 0 }) && same(pointAt(line, 1), { x: 100, y: 0, angle: 0 }));
  ok('pointAt round a corner, heading down after it', same(pointAt(P('M0 0 L100 0 L100 100'), 0.75), { x: 100, y: 50, angle: Math.PI / 2 }));
  ok('fractions are held to 0..1; NaN is the start', same(pointAt(line, -3), pointAt(line, 0)) && same(pointAt(line, 3), pointAt(line, 1)) && same(pointAt(line, NaN), pointAt(line, 0)));
  const q = pointAt(ellipsePath(200, 200), 0.25);
  ok('a quarter of the way round a circle from the top is its right side, heading down', near(q.x, 100, 0.05) && near(q.y, 0, 0.05) && near(q.angle, Math.PI / 2, 1e-3), q);
  const e = pointAt(ellipsePath(200, 200), 0.125);
  ok('an eighth of the way is 45° round, on the circle', Math.abs(Math.hypot(e.x, e.y) - 100) < 0.03 && near(Math.atan2(e.y, e.x), -Math.PI / 4, 1e-3) && near(e.angle, Math.PI / 4, 1e-3), e);
  ok('a curve whose first handle sits on its start still has a heading there', near(pointAt(P('M0 0 C0 0 10 10 20 0'), 0).angle, Math.PI / 4, 1e-3));
  ok('no path, or no length, is its first point, heading 0',
    same(pointAt([], 0.5), { x: 0, y: 0, angle: 0 }) && same(pointAt(P('M7 8'), 0.5), { x: 7, y: 8, angle: 0 }) && same(pointAt(P('M7 8 Z'), 0.5), { x: 7, y: 8, angle: 0 }));
}
{
  const round = (b) => [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1e9) / 1e9);
  ok('the bounds of an ellipse are its box', same(round(pathBounds(ellipsePath(10, 4))), [-5, -2, 10, 4]));
  ok('bounds follow a curve\'s true extremes, not its handles', same(round(pathBounds(P('M0 0 C0 -100 100 -100 100 0'))), [0, -75, 100, 75]));
  ok('a move that draws nothing does not stretch the box', same(pathBounds(P('M0 0 L10 10 M500 500')), { x: 0, y: 0, w: 10, h: 10 }));
  ok('an empty path is a zero box; a lone move is its point', same(pathBounds([]), { x: 0, y: 0, w: 0, h: 0 }) && same(pathBounds(P('M3 4')), { x: 3, y: 4, w: 0, h: 0 }));
}
{
  ok('a square flattens to its four corners, closed, without repeating the first', same(flatten(P('M0 0 L10 0 L10 10 L0 10 Z')), [{ pts: [0, 0, 10, 0, 10, 10, 0, 10], closed: true }]));
  const ring = flatten(ellipsePath(200, 200), 0.01)[0];
  let worst = 0;
  for (let i = 0; i < ring.pts.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(ring.pts[i], ring.pts[i + 1]) - 100));
  ok('a flattened circle stays on its circle, closed', ring.closed && worst < 0.03, worst);
  const finer = flatten(ellipsePath(200, 200), 0.001);
  ok('a finer tolerance makes more points, and the polyline nears the measured length',
    finer[0].pts.length > ring.pts.length && Math.abs(poly(finer) - pathLength(ellipsePath(200, 200))) < 0.01, poly(finer));
  ok('points follow the curvature: a straight cubic is one step', flatten(P('M0 0 C10 0 20 0 30 0'))[0].pts.length === 4);
  const multi = flatten(P('M0 0 L1 0 M5 5 L6 6 Z M9 9'));
  ok('one polyline per drawn subpath, each saying whether it closes', multi.length === 2 && !multi[0].closed && multi[1].closed);
  ok('a tolerance of zero or nonsense still finishes, finite and bounded',
    [0, -1, NaN, 1e-30].every((t) => { const f = flatten(ellipsePath(100, 100), t); return f.length === 1 && f[0].pts.length <= 200000 && f[0].pts.every(Number.isFinite); }));
}
{
  const tri = P('M0 0 L10 0 L0 10 Z');
  ok('transformPath applies canvas transform(a, b, c, d, e, f)', same(transformPath(tri, 2, 0, 0, 3, 5, 7), [M(5, 7), L(25, 7), L(5, 37), Z]));
  const rot = transformPath(tri, 0, 1, -1, 0, 0, 0);
  ok('a rotation keeps lengths', near(pathLength(rot), pathLength(tri), 1e-12) && same(rot[1].p, [0, 10]));
  ok('a non-finite entry is the identity\'s', same(transformPath(tri, NaN, Infinity, null, undefined, NaN, -Infinity), tri));
  ok('fitPath maps the 100 × 100 design box onto a w × h box centred on the origin',
    same(fitPath(P('M0 0 L100 100 M50 50 L100 0'), 20, 10), [M(-10, -5), L(10, 5), M(0, 0), L(10, -5)]));
  ok('fitPath: a negative size mirrors; a non-finite one collapses to 0',
    same(fitPath(P('M0 0 L100 0'), -20, 10), [M(10, -5), L(-10, -5)]) && fitPath(P('M0 0 L100 100'), NaN, 10).every((s) => s.p[0] === 0));
}

// ── outlines ──────────────────────────────────────────────────────────────
const boxOf = (segs) => { const b = pathBounds(segs); return [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 1e9) / 1e9); };
ok('rectPath: a sharp box, centred, from the top-left, clockwise',
  same(rectPath(20, 10, 0), [M(-10, -5), L(10, -5), L(10, 5), L(-10, 5), L(-10, -5), Z]) && pathLength(rectPath(20, 10, -3)) === 60);
ok('rectPath: rounded corners are quarter circles, inside the same box',
  near(pathLength(rectPath(20, 10, 3)), 2 * 14 + 2 * 4 + 2 * Math.PI * 3, 0.01) && same(boxOf(rectPath(20, 10, 3)), [-10, -5, 20, 10]));
ok('rectPath: a radius past half the short side is a pill, with no zero-length sides',
  near(pathLength(rectPath(20, 10, 100)), 20 + Math.PI * 10, 0.01) && rectPath(20, 10, 100).filter((s) => s.t === 'L').length === 2);
ok('ellipsePath: fills the box, from the top, clockwise',
  same(boxOf(ellipsePath(10, 4)), [-5, -2, 10, 4]) && same(ellipsePath(10, 4)[0].p, [0, -2]) && same(ellipsePath(10, 4)[1].p.slice(4), [5, 0]));
{
  const diamond = polygonPath(4, 10, 10);
  ok('polygonPath: regular, a vertex at the top, clockwise', diamond.length === 5 && same(diamond[0].p, [0, -5]) && near(diamond[1].p[0], 5, 1e-12) && near(diamond[1].p[1], 0, 1e-12));
  ok('polygonPath fits the shorter side, centred on its circle', same(boxOf(polygonPath(6, 100, 20)), [-8.660254038, -10, 17.320508076, 20]));
  ok('polygonPath: sides held to 3..24 and rounded; not a number is 6',
    polygonPath(1, 10, 10).length === 4 && polygonPath(99, 10, 10).length === 25 && polygonPath(4.6, 10, 10).length === 6 && polygonPath(NaN, 10, 10).length === 7);
}
{
  const star = starPath(5, 10, 10, 0.5);
  const radii = star.filter((s) => s.t !== 'Z').map((s) => Math.hypot(s.p[0], s.p[1]));
  ok('starPath: points alternate between the outer and inner radius, from the top', radii.length === 10 && radii.every((r, i) => near(r, i % 2 ? 2.5 : 5, 1e-12)) && same(star[0].p, [0, -5]));
  ok('starPath: points held to 3..24, inner to 0.1..0.95',
    starPath(99, 10, 10, 0.5).length === 49 && starPath(1, 10, 10, 0.5).length === 7
    && near(Math.hypot(...starPath(5, 10, 10, 0)[1].p), 0.5, 1e-12) && near(Math.hypot(...starPath(5, 10, 10, 5)[1].p), 4.75, 1e-12));
  ok('starPath fills a wide box, as a burst behind a word must', same(boxOf(starPath(4, 40, 10, 0.5)), [-20, -5, 40, 10]));
  ok('burstPath: up to 48 sharp rays', burstPath(48, 10, 10, 0.8).length === 97 && burstPath(99, 10, 10, 0.8).length === 97 && burstPath(12, 10, 10, 0.8).every((s) => s.t !== 'C'));
}
{
  const arrow = arrowPath(30, 12);
  ok('arrowPath: fills its box and points right', same(boxOf(arrow), [-15, -6, 30, 12]) && arrow.some((s) => s.t === 'L' && s.p[0] === 15 && s.p[1] === 0));
  ok('arrowPath: starts at the tail, the shaft 0.4 of the height', arrow[0].p[0] === -15 && near(arrow[0].p[1], -2.4, 1e-12) && arrow[arrow.length - 1].t === 'Z');
  ok('arrowPath: a short arrow keeps half its width for the shaft', arrowPath(12, 12).some((s) => s.t === 'L' && s.p[0] === 0 && s.p[1] === -6));
}
{
  const a = blobPath(40, 20, 7), b = blobPath(40, 20, 7);
  ok('blobPath: the same seed is the same blob, every time', same(a, b));
  ok('blobPath: another seed is another blob', !same(a, blobPath(40, 20, 8)) && !same(a, blobPath(40, 20, 7.5)) && !same(a, blobPath(40, 20, -7)));
  ok('blobPath: curves only, closed, one per point', a.every((s) => s.t !== 'L') && a[a.length - 1].t === 'Z' && a.filter((s) => s.t === 'C').length === 7);
  const rel = (x, y) => Math.hypot(x / 20, y / 10);
  let worst = 0;
  for (let seed = 0; seed < 300; seed++) {
    for (const [wob, n] of [[0.22, 7], [0.6, 3], [0.6, 24], [0.3, 11], [0.05, 5]]) {
      const pts = flatten(blobPath(40, 20, seed * 3.7 - 400, wob, n), 0.002)[0].pts;
      for (let i = 0; i < pts.length; i += 2) worst = Math.max(worst, Math.abs(rel(pts[i], pts[i + 1]) - 1) / wob);
    }
  }
  ok('blobPath: every point of the outline, not only its radii, stays within ±wobble of the ellipse', worst <= 1, worst);
  const still = flatten(blobPath(40, 20, 3, 0, 3), 0.001)[0].pts;
  let dev = 0;
  for (let i = 0; i < still.length; i += 2) dev = Math.max(dev, Math.abs(rel(still[i], still[i + 1]) - 1));
  ok('blobPath: no wobble is the ellipse itself, even through three points', dev < 0.002, dev);
  ok('blobPath: points held to 3..24', blobPath(10, 10, 1, 0.2, 1).filter((s) => s.t === 'C').length === 3 && blobPath(10, 10, 1, 0.2, 99).filter((s) => s.t === 'C').length === 24);
}
{
  const wave = wavePath(100, 20, 2);
  const last = wave[wave.length - 1].p;
  ok('wavePath is open, from the left edge to the right at mid-height', wave.every((s) => s.t !== 'Z') && same(wave[0].p, [-50, 0]) && last[4] === 50 && near(last[5], 0, 1e-9));
  ok('wavePath rises first, and its height is h', wave[1].p[5] < 0 && near(pathBounds(wave).h, 20, 0.02));
  let worst = 0, x0 = wave[0].p[0], y0 = wave[0].p[1];
  for (const s of wave.slice(1)) {
    const p = s.p;
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      const x = u * u * u * x0 + 3 * u * u * t * p[0] + 3 * u * t * t * p[2] + t * t * t * p[4];
      const y = u * u * u * y0 + 3 * u * u * t * p[1] + 3 * u * t * t * p[3] + t * t * t * p[5];
      worst = Math.max(worst, Math.abs(y + 10 * Math.sin(2 * Math.PI * 2 * ((x + 50) / 100))));
    }
    x0 = p[4];
    y0 = p[5];
  }
  ok('wavePath follows a true sine to a thousandth of its amplitude', worst < 0.001 * 10, worst / 10);
  ok('wavePath: phase is in periods; a whole one changes nothing',
    near(wavePath(100, 20, 2, 0.25)[0].p[1], -10, 1e-12) && same(wavePath(100, 20, 2, 1), wave) && same(wavePath(100, 20, 2, -3), wave));
  ok('wavePath: periods held to 0.5..12', wavePath(100, 20, 0).length === 5 && wavePath(100, 20, 99).length === 97);
}
{
  const q = arcPath(100, 100, 0, 90);
  ok('arcPath: from 12 o\'clock, clockwise: a quarter ends at 3 o\'clock', same(q[0].p, [0, -50]) && q.length === 2 && near(q[1].p[4], 50, 1e-12) && near(q[1].p[5], 0, 1e-12));
  ok('arcPath: a quarter is the same curve as the ellipse\'s first quarter', segsNear(q, ellipsePath(100, 100).slice(0, 2), 1e-12));
  ok('arcPath: a negative sweep runs anticlockwise', near(arcPath(100, 100, 0, -90)[1].p[4], -50, 1e-12));
  ok('arcPath: from 90° starts at 3 o\'clock', near(arcPath(100, 100, 90, 45)[0].p[0], 50, 1e-12) && near(arcPath(100, 100, 90, 45)[0].p[1], 0, 1e-12));
  ok('arcPath: cubics of at most 90°',
    arcPath(100, 100, 0, 270).filter((s) => s.t === 'C').length === 3 && arcPath(100, 100, 0, 91).filter((s) => s.t === 'C').length === 2);
  const full = arcPath(100, 100, 30, 360);
  ok('arcPath: a whole turn ends exactly where it began, closed, 2πr long',
    full[full.length - 1].t === 'Z' && same(full[full.length - 2].p.slice(4), full[0].p) && Math.abs(pathLength(full) / (100 * Math.PI) - 1) < 0.001);
  ok('arcPath: open otherwise; the sweep held to ±360; no sweep is the start point alone',
    arcPath(100, 100, 0, 359).every((s) => s.t !== 'Z') && arcPath(100, 100, 0, -1000).length === 6
    && same(arcPath(100, 100, 0, 0), [M(0, -50)]) && same(arcPath(100, 100, 0, NaN), [M(0, -50)]));
  ok('arcPath: its length is the arc\'s', near(pathLength(arcPath(100, 100, 45, 135)), Math.PI * 50 * 0.75, 0.01));
}
{
  const sizes = [0, -5, NaN, 1e300, -Infinity, Infinity, 1e-300, 50];
  const odd = [1, 99, NaN, -4, 3.7, Infinity, 0, 1e9];
  const builders = [
    ['rectPath', (w, h, k) => rectPath(w, h, k)],
    ['ellipsePath', (w, h) => ellipsePath(w, h)],
    ['polygonPath', (w, h, k) => polygonPath(k, w, h)],
    ['starPath', (w, h, k) => starPath(k, w, h, k)],
    ['burstPath', (w, h, k) => burstPath(k, w, h, k)],
    ['arrowPath', (w, h) => arrowPath(w, h)],
    ['blobPath', (w, h, k) => blobPath(w, h, k, k, k)],
    ['wavePath', (w, h, k) => wavePath(w, h, k, k)],
    ['arcPath', (w, h, k) => arcPath(w, h, k, k)],
  ];
  const sizeOf = (t) => (t === 'C' ? 6 : t === 'Z' ? 0 : 2);
  for (const [name, build] of builders) {
    let bad = null;
    for (const w of sizes) for (const h of sizes) for (const k of odd) {
      const segs = build(w, h, k);
      const good = Array.isArray(segs) && segs.length > 0 && segs[0].t === 'M'
        && segs.every((s) => ['M', 'L', 'C', 'Z'].includes(s.t) && s.p.length === sizeOf(s.t) && s.p.every(Number.isFinite))
        && Number.isFinite(pathLength(segs)) && parsePath(pathToString(segs)) !== null;
      if (!good && !bad) bad = [w, h, k];
    }
    ok(`${name}: finite, well-formed and non-empty for sizes 0, negative, NaN, huge, and counts 1, 99 and worse`, !bad, bad);
  }
}

// ── purity ────────────────────────────────────────────────────────────────
{
  const src = readFileSync(new URL('../src/motionmath.ts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*from\s+'([^']+)'/gm)];
  ok('motionmath.ts imports nothing but types, and those from the contract',
    imports.length === 1 && !!imports[0][1] && imports[0][2] === './motiontypes', imports.map((m) => m[0]));
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok('no clock, no unseeded randomness, no DOM', !/Math\.random|\bDate\b|performance\.|document\.|window\.|globalThis|requestAnimationFrame|\bfetch\(/.test(code));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
