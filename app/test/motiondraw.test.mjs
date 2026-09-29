// The renderer: paint(ctx, doc, t), run on the recording canvas.
//
// What matters: every kind of layer draws, and draws nothing a browser would
// reject — no NaN reaches the canvas, every save is restored, no colour is a
// word the canvas ignores — at every moment including the exact edges of a
// layer's time and just outside them, in both directions and both shapes of
// frame; a layer hidden, out of its time or faded to nothing draws nothing;
// the nine pins put a box's own corner, edge or centre on the frame's, and
// flip for Arabic and Kurdish; words wrap, fit, split, type and highlight by
// the rules (Arabic never split inside a word); a rolling counter never
// moves its digits; motion blur averages its sub-frames exactly; one broken
// layer costs only itself unless `strict`; clicks find turned and scaled
// layers; and `ctx.filter`, which WebKit does not have, is never used.
import { makeCanvas, drewSomething, offscreens } from './motioncanvas.mjs';
import { paint, makeEnv, layerBox, hitTest, preload } from '../.test-build/motiondraw.js';

let blankLayer = null;
try {
  ({ blankLayer } = await import('../.test-build/motionread.js'));
} catch {
  /* motionread is built by its own suite; the hand-made layers below stand in */
}

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

// Every canvas made here, so the last test can look at every call ever made.
const canvases = [];
const canvas = (w, h, opts) => { const c = makeCanvas(w, h, opts); canvases.push(c); return c; };

const PALETTE = { bg: '#0b1020', fg: '#f5f7ff', accent: '#4c8dff', accent2: '#ff6aa2', muted: '#8a93b2' };
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };
const docOf = (o = {}) => ({
  id: 'd', title: 'T', request: '', lang: 'en', format: 'landscape', fps: 30, seconds: 4, palette: { ...PALETTE },
  backdrop: null, layers: [], stage: 'ready', created: 0, updated: 0, ...o,
});
const NONE = { fx: 'none', d: 0.5, delay: 0, ease: 'out', amount: 1 };
const anim = (fx, o = {}) => ({ fx, d: 0.6, delay: 0, ease: 'out', amount: 1, ...o });
let seq = 0;
const base = (kind, o) => ({ id: `${kind}${++seq}`, name: kind, start: 0, end: 4, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1, ...o });
const HAND = {
  text: (o) => base('text', { kind: 'text', text: 'Motion here', voice: 'bold', size: 10, weight: 700, color: 'fg', align: 'center', lead: 1.2, track: 0, caps: false, max: 0, fit: false, ...o }),
  shape: (o) => base('shape', { kind: 'shape', shape: 'rect', w: 20, h: 10, radius: 0, sides: 5, inner: 0.45, from: 0, sweep: 270, fill: 'accent', seed: 1, ...o }),
  icon: (o) => base('icon', { kind: 'icon', icon: 'star', size: 10, color: 'fg', weight: 1.75, ...o }),
  image: (o) => base('image', { kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', w: 30, h: 20, fit: 'cover', radius: 2, ...o }),
  counter: (o) => base('counter', { kind: 'counter', from: 0, to: 1000, decimals: 0, prefix: '', suffix: '', group: true, voice: 'bold', size: 10, weight: 700, color: 'fg', align: 'center', track: 0, count: { d: 2, delay: 0, ease: 'linear' }, ...o }),
  chart: (o) => base('chart', { kind: 'chart', chart: 'bars', w: 60, h: 40, data: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], colors: ['accent', 'accent2'], max: 0, unit: '', labels: true, values: true, voice: 'sans', size: 3, color: 'fg', thick: 3, gap: 0.1, ...o }),
  backdrop: (o) => base('backdrop', { kind: 'backdrop', style: 'aurora', colors: ['accent', 'accent2'], speed: 1, density: 0.5, seed: 1, ...o }),
  particles: (o) => base('particles', { kind: 'particles', style: 'confetti', colors: ['accent', 'accent2'], count: 40, size: 1, speed: 1, spread: 10, burst: false, seed: 1, ...o }),
};
const text = (o = {}) => HAND.text(o);
const shape = (o = {}) => HAND.shape(o);

/** Paint `doc` at `t` on a fresh recording canvas of its format's size. */
function run(doc, t, o = {}) {
  const [w, h] = o.size ?? SIZES[doc.format] ?? SIZES.landscape;
  const c = canvas(w, h, o.canvas);
  paint(c.ctx, doc, t, { strict: true, ...o.paint });
  return c;
}
const named = (calls, name) => calls.filter((c) => c.name === name && !c.set);
const sets = (calls, name) => calls.filter((c) => c.name === name && c.set).map((c) => c.args[0]);
const texts = (calls) => named(calls, 'fillText').map((c) => c.args[0]);
/** The alpha of a CSS colour as the renderer writes them: #rgb(a), #rrggbb(aa), rgba(). */
const alphaOfColour = (s) => {
  const v = String(s).trim();
  const hex = /^#([0-9a-f]+)$/i.exec(v);
  if (hex) return hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : hex[1].length === 4 ? parseInt(hex[1][3] + hex[1][3], 16) / 255 : 1;
  const fn = /^rgba?\(([^)]*)\)$/i.exec(v);
  if (fn) { const p = fn[1].split(/[\s,/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; }
  return 1;
};

// ── every kind draws, cleanly ─────────────────────────────────────────────
{
  const make = (kind, o = {}) => (blankLayer ? blankLayer(kind, { start: 0, end: 4, ...o }) : HAND[kind](o));
  const kinds = [
    ['text', {}], ['icon', {}], ['image', {}], ['counter', {}], ['chart', {}], ['backdrop', {}], ['particles', {}],
    ...['rect', 'ellipse', 'arc', 'polygon', 'star', 'line', 'arrow', 'burst', 'wave', 'blob', 'path'].map((s) => ['shape', { shape: s, w: 20, h: 12, d: 'M10 10 L90 10 L50 90 Z', stroke: { color: 'fg', width: 0.5, cap: 'round' } }]),
  ];
  for (const lang of ['en', 'ckb']) {
    const bad = [];
    for (const [kind, o] of kinds) {
      const doc = docOf({ lang, layers: [make(kind, o)] });
      const c = run(doc, 2);
      if (!drewSomething(c.calls)) bad.push(`${kind}${o.shape ? ':' + o.shape : ''} drew nothing`);
      for (const p of c.check()) bad.push(`${kind}${o.shape ? ':' + o.shape : ''}: ${p}`);
    }
    ok(`every kind of layer (and all 11 shapes) draws at mid-time, cleanly — ${lang}${blankLayer ? ', from blankLayer' : ''}`, bad.length === 0, bad.slice(0, 6));
  }
}

// ── a kitchen sink, at every edge of time ────────────────────────────────
{
  const EFFECTS = ['fade', 'rise', 'drop', 'slide', 'pop', 'zoom', 'wipe', 'mask', 'type', 'blur', 'spin', 'flip', 'grow', 'draw'];
  const LOOPS = ['float', 'pulse', 'spin', 'sway', 'breathe', 'shimmer'];
  const words = { en: 'Every frame\nis a function of time', ar: 'كل إطار\nدالة للزمن', ckb: 'هەموو وێنەیەک\nفەنکشنێکە بۆ کات' };
  const sink = (lang, format) => docOf({
    lang, format, backdrop: { kind: 'linear', angle: 45, stops: [{ at: 1, color: 'bg' }, { at: 0, color: 'accent' }] },
    layers: [
      HAND.backdrop({ start: 0, end: 4 }),
      ...EFFECTS.map((fx, i) => text({
        text: words[lang], start: 0.2, end: 3.8, pin: ['ts', 'mc', 'be'][i % 3], y: i - 7, x: i, max: i % 2 ? 40 : 0, fit: i % 4 === 1,
        in: anim(fx, { by: ['all', 'line', 'word', 'char'][i % 4], gap: 0.05 }), out: anim(EFFECTS[(i + 3) % EFFECTS.length], { by: 'word' }),
        loop: { fx: LOOPS[i % LOOPS.length], d: 1.3, amount: 1 }, hi: i % 3 === 0 ? words[lang].split(/\s/)[1] : undefined,
        hiStyle: ['color', 'box', 'underline'][i % 3], outline: i % 5 === 0 ? { color: 'accent2', width: 0.3 } : undefined,
        shadow: i % 2 ? { color: '#00000080', blur: 1, x: 0.3, y: 0.5 } : undefined, track: i % 6 === 0 ? 0.08 : 0, caps: i % 7 === 0,
      })),
      ...['rect', 'ellipse', 'arc', 'polygon', 'star', 'line', 'arrow', 'burst', 'wave', 'blob', 'path'].map((s, i) => shape({
        shape: s, pin: 'bs', x: 5 + i * 8, y: -5, w: 7, h: s === 'line' ? 0 : 5, radius: 2, sides: 6, d: 'M0 0 C 40 100, 60 100, 100 0',
        fill: i % 2 ? { kind: ['linear', 'radial', 'conic'][i % 3], angle: 30, stops: [{ at: 0, color: 'accent' }, { at: 1, color: '#ff000080' }] } : 'accent2',
        stroke: i % 3 ? { color: 'fg', width: 0.3, cap: 'round', dash: i % 4 ? undefined : [1, 0.5] } : undefined,
        in: anim(EFFECTS[(i + 5) % EFFECTS.length]), out: anim(EFFECTS[i % EFFECTS.length]), loop: { fx: LOOPS[(i + 2) % LOOPS.length], d: 2, amount: 1 },
        shadow: i % 4 === 0 ? { color: 'muted', blur: 1, x: 0, y: 0.5 } : undefined, blend: ['normal', 'screen', 'multiply', 'overlay', 'lighter'][i % 5],
      })),
      HAND.icon({ pin: 'te', x: 4, y: 4, in: anim('draw'), badge: { shape: 'squircle', fill: 'accent', pad: 2 }, loop: { fx: 'shimmer', d: 1, amount: 1 } }),
      HAND.icon({ icon: 'nope', pin: 'te', x: 20, y: 4, in: anim('blur'), badge: { shape: 'circle', fill: { kind: 'radial', angle: 0, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'accent2' }] }, pad: 1 } }),
      HAND.image({ pin: 'ms', x: 4, in: anim('wipe'), out: anim('zoom'), shadow: { color: '#000', blur: 2, x: 0, y: 1 } }),
      HAND.counter({ pin: 'tc', y: 10, prefix: '$', suffix: '+', in: anim('mask'), shadow: { color: '#000', blur: 1, x: 0.2, y: 0.2 } }),
      HAND.counter({ pin: 'bc', y: -20, from: 12.5, to: -3.25, decimals: 2, suffix: '%', in: anim('type'), out: anim('blur') }),
      HAND.chart({ pin: 'me', x: 4, in: anim('grow'), out: anim('wipe') }),
      HAND.particles({ pin: 'bc', y: -5, start: 0.5, end: 3, burst: true }),
    ],
  });
  const times = [-0.01, 0, 1e-9, 0.2, 0.2 + 1e-9, 0.35, 0.5, 0.8, 1, 1.7, 2, 3.2, 3.5, 3.8 - 1e-9, 3.8, 3.99, 4 - 1e-9, 4, 4.01, NaN];
  for (const lang of ['en', 'ar', 'ckb']) {
    for (const format of ['landscape', 'portrait']) {
      const doc = sink(lang, format);
      const bad = [];
      let drew = 0;
      for (const t of times) {
        let c;
        try {
          c = run(doc, t);
        } catch (e) {
          bad.push(`t=${t}: threw ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`);
          continue;
        }
        for (const p of c.check()) bad.push(`t=${t}: ${p}`);
        if (drewSomething(c.calls)) drew++;
      }
      ok(`every effect, loop, split, highlight and shape at ${times.length} moments (edges and just outside) is clean — ${lang} ${format}`, bad.length === 0 && drew === times.length, bad.slice(0, 5));
    }
  }
}

// ── nothing is drawn for what is not there ───────────────────────────────
{
  const at = (layer, t) => run(docOf({ layers: [layer] }), t).calls;
  ok('a hidden layer draws nothing', !drewSomething(at(shape({ hidden: true }), 2)) && !drewSomething(at(text({ hidden: true }), 2)));
  ok('a layer draws nothing before its start, at its end or after it',
    [0.99, 3, 3.5].every((t) => !drewSomething(at(shape({ start: 1, end: 3 }), t))) && drewSomething(at(shape({ start: 1, end: 3 }), 1)));
  ok('a layer at opacity 0 draws nothing', !drewSomething(at(shape({ opacity: 0 }), 2)) && !drewSomething(at(text({ opacity: 0, in: anim('rise', { by: 'word' }) }), 2)));
  ok('a fade at its very first moment draws nothing (poseAt opacity 0)',
    ['shape', 'text', 'icon', 'counter'].every((k) => !drewSomething(at(HAND[k]({ start: 1, in: anim('fade', { by: 'word' }) }), 1))));
  ok('an empty text draws nothing and does not throw', !drewSomething(at(text({ text: '   \n ' }), 2)));
  ok('a transparent document clears and nothing more', (() => { const c = run(docOf(), 1); return !drewSomething(c.calls) && named(c.calls, 'clearRect').length === 1; })());
  ok('clear: false leaves what is there', named(run(docOf(), 1, { paint: { clear: false } }).calls, 'clearRect').length === 0);
  ok('the backdrop paint covers the frame first', (() => {
    const c = run(docOf({ backdrop: 'accent' }), 1);
    const f = named(c.calls, 'fillRect')[0];
    return f && near(f.m[4], 960) && near(f.m[5], 540) && f.args[2] === 1920 && f.args[3] === 1080 && sets(c.calls, 'fillStyle')[0] === '#4c8dff';
  })());
}

// ── the nine pins ─────────────────────────────────────────────────────────
{
  /** The spec, written out again independently: where the box's centre lands. */
  const expected = (pin, x, y, bw, bh, width, height, rtl) => {
    const k = Math.min(width, height) / 100;
    const row = pin[0], col = pin[1];
    let px = col === 's' ? (rtl ? width : 0) : col === 'c' ? width / 2 : (rtl ? 0 : width);
    let py = row === 't' ? 0 : row === 'm' ? height / 2 : height;
    px += x * k * (rtl ? -1 : 1);
    py += y * k;
    const left = col === 's' ? (rtl ? px - bw : px) : col === 'c' ? px - bw / 2 : (rtl ? px : px - bw);
    const top = row === 't' ? py : row === 'm' ? py - bh / 2 : py - bh;
    return [left + bw / 2, top + bh / 2];
  };
  const bad = [];
  for (const format of ['landscape', 'portrait']) {
    const [width, height] = SIZES[format];
    const k = Math.min(width, height) / 100;
    for (const lang of ['en', 'ar']) {
      for (const pin of ['ts', 'tc', 'te', 'ms', 'mc', 'me', 'bs', 'bc', 'be']) {
        const c = run(docOf({ lang, format, layers: [shape({ pin, x: 8, y: -3, w: 20, h: 10 })] }), 1);
        const tr = named(c.calls, 'translate')[0];
        const [ex, ey] = expected(pin, 8, -3, 20 * k, 10 * k, width, height, lang === 'ar');
        if (!tr || !near(tr.args[0], ex, 1e-6) || !near(tr.args[1], ey, 1e-6)) bad.push({ format, lang, pin, got: tr?.args, want: [ex, ey] });
      }
    }
  }
  ok('all nine pins, both directions, 1920×1080 and 1080×1920: the translate lands the box where the pin says', bad.length === 0, bad.slice(0, 3));
  // The same numbers by hand, so the check above is not the code checking itself.
  const bs = named(run(docOf({ layers: [shape({ pin: 'bs', x: 8, y: -10, w: 20, h: 10 })] }), 1).calls, 'translate')[0].args;
  const bsRtl = named(run(docOf({ lang: 'ckb', layers: [shape({ pin: 'bs', x: 8, y: -10, w: 20, h: 10 })] }), 1).calls, 'translate')[0].args;
  ok('bs at x 8, y -10: bottom-start corner 8u in and 10u up — (194.4, 918) in English, (1725.6, 918) in Sorani',
    near(bs[0], 194.4) && near(bs[1], 918) && near(bsRtl[0], 1725.6) && near(bsRtl[1], 918), { bs, bsRtl });
  const env = makeEnv(canvas(1920, 1080).ctx, docOf(), 1, 1920, 1080);
  const tb = layerBox(env, text({ text: 'ABCD', pin: 'ts', x: 2, y: 2, size: 10, lead: 1.2 }));
  ok('a text box is as wide as its line and as tall as its lines, from its pin (0.55·px per letter here)',
    tb && near(tb.w, 0.55 * 108 * 4) && near(tb.h, 1.2 * 108) && near(tb.x, 21.6) && near(tb.y, 21.6), tb);
  const pb = layerBox(env, HAND.particles({ pin: 'be', x: -3, y: -4 }));
  ok('particles are a point at their pin (x toward the end, so -3 is back inside)', pb && pb.w === 0 && pb.h === 0 && near(pb.cx, 1920 - 32.4) && near(pb.cy, 1080 - 43.2), pb);
  const bb = layerBox(env, HAND.backdrop({ x: 50, scale: 3, rot: 40 }));
  ok('a backdrop is the whole frame whatever its place, scale and turn', bb && bb.x === 0 && bb.y === 0 && bb.w === 1920 && bb.h === 1080 && bb.rot === 0);
}

// ── words: wrapping, fitting, direction ──────────────────────────────────
{
  const draw = (layer, o = {}) => run(docOf({ lang: o.lang ?? 'en', layers: [layer] }), o.t ?? 2, o).calls;
  const baselines = (calls) => [...new Set(named(calls, 'fillText').map((c) => Math.round(c.args[2] * 1000)))];
  // size 10 → 108 px; a two-letter word is 118.8 px and a space 59.4: two words and a space take 297 px.
  const wrapped = draw(text({ text: 'aa bb cc dd', max: 35 }));
  ok('words wrap greedily at the width: two words to a line', baselines(wrapped).length === 2 && texts(wrapped).join(' ') === 'aa bb cc dd', texts(wrapped));
  const env = makeEnv(canvas(1920, 1080).ctx, docOf(), 2, 1920, 1080);
  ok('a wrapped text\'s box is its wrap width', near(layerBox(env, text({ text: 'aa bb cc dd', max: 35 })).w, 378));
  ok('a line break always breaks, wrap width or not', baselines(draw(text({ text: 'one\ntwo\nthree' }))).length === 3);
  ok('lines are a line height apart', (() => { const b = baselines(draw(text({ text: 'a\nb', lead: 1.3 }))).sort((x, y) => x - y); return b.length === 2 && near((b[1] - b[0]) / 1000, 1.3 * 108, 0.002); })());
  const fitted = draw(text({ text: 'abcdefghij', max: 27.5, fit: true }));
  ok('fit: no wrapping, the size shrinks until the line fits (594 px into 297: half size)',
    baselines(fitted).length === 1 && sets(fitted, 'font').some((f) => /\b54px/.test(f)), sets(fitted, 'font'));
  ok('fit keeps the box at the wrap width', near(layerBox(env, text({ text: 'abcdefghij', max: 27.5, fit: true })).w, 297));
  const floor = draw(text({ text: 'abcdefghij', max: 5, fit: true }));
  ok('fit never shrinks below 30%', sets(floor, 'font').some((f) => /\b32\.4px/.test(f)), sets(floor, 'font'));
  ok('a text that already fits keeps its size', sets(draw(text({ text: 'ab', max: 50, fit: true })), 'font').some((f) => /\b108px/.test(f)));
  const long = draw(text({ text: 'abcdefghijklmnop', max: 30 }));
  ok('a word wider than the line is never cut (Latin)', baselines(long).length === 1 && texts(long).join('|') === 'abcdefghijklmnop', texts(long));
  const arabicLong = draw(text({ text: 'ڕووداوەکانیشمان', max: 10 }), { lang: 'ckb' });
  ok('a word wider than the line is never cut (Arabic)', texts(arabicLong).length === 1 && texts(arabicLong)[0] === 'ڕووداوەکانیشمان');
  // max 10u is 108 px; a 30-letter word is 30 × 0.55 × 108 = 1782 px here.
  for (const [lang, word] of [['en', 'a'.repeat(30)], ['ckb', 'ب'.repeat(30)]]) {
    const layer = text({ text: `${word} ${word.slice(0, 3)}`, max: 10, size: 10, pin: 'bs', x: 5, y: -5, align: 'start' });
    const c = run(docOf({ lang, layers: [layer] }), 2);
    const f = named(c.calls, 'fillText').find((x) => x.args[0] === word);
    const left = f.m[4] + f.args[1];
    const right = left + 0.55 * 108 * 30;
    const box = layerBox(makeEnv(c.ctx, docOf({ lang }), 2, 1920, 1080), layer);
    ok(`a word wider than max widens the box to hold what is drawn, and the pin places the whole box — ${lang}`,
      box.w >= right - left - 1e-6 && box.x <= left + 1e-6 && box.x + box.w >= right - 1e-6
      && (lang === 'en' ? near(box.x, 54) : near(box.x + box.w, 1920 - 54)), { box, left, right });
  }
  // The same in every alignment, at pins of each column, both directions: the box is exactly the widest line
  // (the long word, 1782 px, not the 108 px wrap width), every word drawn is inside it, each line sits in it by
  // its alignment, and the edge (or centre) the pin names is where the pin says — x toward the end.
  {
    const bad = [];
    for (const lang of ['en', 'ckb']) {
      const rtl = lang !== 'en';
      const word = rtl ? 'ب'.repeat(30) : 'a'.repeat(30);
      for (const align of ['start', 'center', 'end']) {
        for (const pin of ['bs', 'mc', 'te']) {
          const layer = text({ text: `${word} ${word.slice(0, 3)}`, max: 10, size: 10, pin, x: 5, y: 0, align });
          const c = run(docOf({ lang, layers: [layer] }), 2);
          const box = layerBox(makeEnv(c.ctx, docOf({ lang }), 2, 1920, 1080), layer);
          const drawn = named(c.calls, 'fillText').map((f) => ({ s: f.args[0], l: f.m[4] + f.args[1], r: f.m[4] + f.args[1] + 0.55 * 108 * f.args[0].length }));
          const inside = drawn.every((d) => d.l >= box.x - 1e-6 && d.r <= box.x + box.w + 1e-6);
          const short = drawn.find((d) => d.s.length === 3);
          const startEdge = rtl ? box.x + box.w : box.x;
          const at = align === 'center' ? (short.l + short.r) / 2 - (box.x + box.w / 2) : align === 'start' ? (rtl ? short.r - startEdge : short.l - startEdge) : rtl ? short.l - box.x : short.r - (box.x + box.w);
          const col = pin[1];
          const edge = col === 'c' ? box.x + box.w / 2 : (col === 's') !== rtl ? box.x : box.x + box.w;
          const want = col === 'c' ? 960 + (rtl ? -54 : 54) : col === 's' ? (rtl ? 1920 - 54 : 54) : rtl ? -54 : 1920 + 54;
          if (!near(box.w, 1782, 1e-6) || !inside || !near(at, 0, 1e-6) || !near(edge, want, 1e-6)) bad.push({ lang, align, pin, w: box.w, inside, at, edge, want });
        }
      }
    }
    ok('a word wider than max, in every alignment at pins of every column, LTR and RTL: the box is the widest line, holds every word, aligns each line in it, and sits where its pin says', bad.length === 0, bad.slice(0, 3));
  }

  const ar = named(draw(text({ text: 'الف باء جیم' }), { lang: 'ar' }), 'fillText');
  ok('Arabic words run right to left: the first word is drawn rightmost', ar.length === 3 && ar[0].args[1] > ar[1].args[1] && ar[1].args[1] > ar[2].args[1], ar.map((c) => [c.args[0], c.args[1]]));
  const mixed = named(draw(text({ text: 'مرحبا Vylo Editor' }), { lang: 'ar' }), 'fillText');
  const xs = Object.fromEntries(mixed.map((c) => [c.args[0], c.args[1]]));
  ok('Latin words inside Arabic keep their own order', xs.Vylo < xs.Editor && xs.Editor < xs['مرحبا'], xs);
  const en = named(draw(text({ text: 'one two three' })), 'fillText');
  ok('English words run left to right', en.length === 3 && en[0].args[1] < en[1].args[1] && en[1].args[1] < en[2].args[1]);
  const dirs = sets(draw(text({ text: 'سڵاو' }), { lang: 'en' }), 'direction');
  ok('Arabic script is drawn with direction rtl, even in an English document', dirs.includes('rtl'));

  const lineStarts = (calls) => named(calls, 'fillText').map((c) => c.args[1]);
  const start = lineStarts(draw(text({ text: 'aa\nbbbb', align: 'start' })));
  const end = lineStarts(draw(text({ text: 'aa\nbbbb', align: 'end' })));
  const center = lineStarts(draw(text({ text: 'aa\nbbbb', align: 'center' })));
  ok('align start / centre / end place the shorter line left / middle / right in English',
    near(start[0], start[1]) && near(end[0] - end[1], 2 * 59.4) && near(center[0] - center[1], 59.4), { start, end, center });
  const rtlStart = lineStarts(draw(text({ text: 'اا\nبببب', align: 'start' }), { lang: 'ckb' }));
  ok('align start is the right edge in Sorani', near(rtlStart[0] - rtlStart[1], 2 * 59.4), rtlStart);

  const tracked = named(draw(text({ text: 'ab', track: 0.1 })), 'fillText');
  ok('tracking spaces letters by track·size (one letter at a time, so every engine agrees)',
    tracked.length === 2 && near(tracked[1].args[1] - tracked[0].args[1], 0.55 * 108 + 0.1 * 108), tracked.map((c) => c.args[1]));
  ok('tracking is ignored for Arabic script, whose letters join', texts(draw(text({ text: 'سلام', track: 0.2 }), { lang: 'ar' })).join('|') === 'سلام');
  ok('caps upper-cases Latin text', texts(draw(text({ text: 'Hello there', caps: true }))).join(' ') === 'HELLO THERE');
  ok('a baseline does not move when the words change (the font\'s box, not the letters\')',
    near(named(draw(text({ text: 'Hg' })), 'fillText')[0].args[2], named(draw(text({ text: 'xx' })), 'fillText')[0].args[2]));
}

// ── units: lines, words, characters ──────────────────────────────────────
{
  // One unit a second: at 1.5 s the first two have started and the third has not.
  const staged = (by, t = 1.5, o = {}) => text({ in: anim('fade', { by, gap: 1, d: 0.001, ease: 'linear' }), end: 10, ...o });
  const drawn = (layer, lang = 'en', t = 1.5) => texts(run(docOf({ lang, layers: [layer] }), t).calls);
  ok('by word: each word is its own unit', drawn(staged('word', 1.5, { text: 'one two three' })).join(' ') === 'one two');
  ok('by char: each letter is its own unit', drawn(staged('char', 1.5, { text: 'abc de' }), 'en', 2.5).join('') === 'abc');
  ok('by line: each line is its own unit', drawn(staged('line', 1.5, { text: 'l1\nl2\nl3' })).join(' ') === 'l1 l2');
  const arabic = drawn(staged('char', 1.5, { text: 'سلام علیکم دنیا' }), 'ar');
  ok('Arabic by char falls back to words: whole words, never a lone letter', arabic.join(' ') === 'سلام علیکم', arabic);
  const kurdishInEnglish = drawn(staged('char', 1.5, { text: 'hello ڕووداو' }), 'en', 1.5);
  ok('any Arabic script in a text keeps the whole text to words (as motionanim counts it)', kurdishInEnglish.join(' ') === 'hello ڕووداو', kurdishInEnglish);
  const all = run(docOf({ layers: [text({ text: 'one two', in: anim('rise'), end: 10 })] }), 0.3).calls;
  ok('by all (the default) moves as one: one translate for the layer', named(all, 'translate').length === 1 && texts(all).length === 2);
  const words = run(docOf({ layers: [text({ text: 'one two three', in: anim('rise', { by: 'word', gap: 0.2 }), end: 10 })] }), 0.3).calls;
  const ys = named(words, 'translate').slice(1).filter((c) => c.args[1] !== 0);
  ok('split words each rise from their own place, the later ones lower', ys.length >= 2 && ys[0].args[1] < ys[ys.length - 1].args[1], ys.map((c) => c.args));
}

// ── typing ────────────────────────────────────────────────────────────────
{
  const typed = (t, s = 'hello world', lang = 'en') => texts(run(docOf({ lang, layers: [text({ text: s, in: anim('type', { d: 1, ease: 'linear' }), end: 10 })] }), t).calls);
  ok('type reveals ceil(type × characters) in reading order: 4 of 10 at 35%', typed(0.35).join('') === 'hell', typed(0.35));
  ok('type shows nothing at its start and everything at its end', typed(0).length === 0 && typed(1).join('') === 'helloworld');
  ok('type counts characters, not spaces', typed(0.55).join('') === 'hellow', typed(0.55));
  ok('Arabic types by whole words: a half-typed word would lose its joins', typed(0.3, 'سلام دنیا', 'ar').join('|') === 'سلام' && typed(0.6, 'سلام دنیا', 'ar').length === 2, typed(0.3, 'سلام دنیا', 'ar'));
}

// ── highlight ─────────────────────────────────────────────────────────────
{
  const hiDoc = (style, t = 2) => run(docOf({ layers: [text({ text: 'make every frame count', hi: 'every frame', hiStyle: style, hiColor: '#ff0000', in: anim('fade', { d: 0.3 }), end: 10 })] }), t).calls;
  const colourOf = (calls, word) => {
    let fill = null;
    for (const c of calls) {
      if (c.set && c.name === 'fillStyle') fill = c.args[0];
      if (c.name === 'fillText' && c.args[0] === word) return fill;
    }
    return undefined;
  };
  const coloured = hiDoc('color');
  ok('hi colour: the phrase\'s words in the highlight colour, the rest in the text\'s',
    colourOf(coloured, 'every') === '#ff0000' && colourOf(coloured, 'frame') === '#ff0000' && colourOf(coloured, 'make') === '#f5f7ff');
  const boxed = hiDoc('box');
  /** Each drawing of `word`: its fill colour and the clip rule in force. */
  const drawingsOf = (calls, word) => {
    let fill = null;
    let rule = null;
    const out = [];
    for (const c of calls) {
      if (c.set && c.name === 'fillStyle') fill = c.args[0];
      if (c.name === 'clip') rule = c.args[0] ?? 'nonzero';
      if (c.name === 'restore') rule = null;
      if (c.name === 'fillText' && c.args[0] === word) out.push([fill, rule]);
    }
    return out;
  };
  const every = drawingsOf(boxed, 'every');
  ok('hi box: a box behind the phrase once the words are in; the phrase in its own colour outside the box and in whichever of ink and ground reads on it inside',
    named(boxed, 'fill').length >= 1 && named(boxed, 'roundRect').length >= 1
    && every.length === 2 && every[0][0] === '#f5f7ff' && every[0][1] === 'evenodd' && every[1][0] === '#0b1020' && every[1][1] === 'nonzero', every);
  const early = hiDoc('box', 0.2);
  ok('hi box: not yet drawn while the words are still arriving — and the phrase keeps its own colour until the box reaches it',
    named(early, 'roundRect').length === 0 && drawingsOf(early, 'every').every(([f]) => f === '#f5f7ff'), drawingsOf(early, 'every'));
  const half = named(hiDoc('box', 0.3 + 0.1), 'roundRect')[0];
  const full = named(hiDoc('box', 3), 'roundRect')[0];
  ok('hi box: wipes in from the reading start after the entrance', half && full && half.args[2] < full.args[2] && near(half.args[0], full.args[0]), [half?.args, full?.args]);
  const under = hiDoc('underline');
  ok('hi underline: a thin bar under the phrase, the words keep their colour',
    named(under, 'roundRect').some((c) => c.args[3] < 12) && colourOf(under, 'every') === '#f5f7ff');
  ok('a highlight that is not in the text highlights nothing', (() => {
    const c = run(docOf({ layers: [text({ text: 'abc', hi: 'zzz', hiStyle: 'box' })] }), 2).calls;
    return named(c, 'roundRect').length === 0 && texts(c).join('') === 'abc';
  })());

  // The box's geometry, drawn whole (3 s: long after the entrance). Sizes of their own:
  // widths and layouts are cached by font, and these canvases measure differently.
  const boxOf = (o, opts = {}) => {
    const c = canvas(1920, 1080, opts.canvas);
    paint(c.ctx, docOf({ lang: opts.lang ?? 'en', layers: [text({ hiStyle: 'box', hiColor: '#ff0000', in: anim('fade', { d: 0.3 }), end: 10, ...o })] }), 3, { strict: true });
    const r = named(c.calls, 'roundRect')[0];
    return { box: r && { x: r.args[0], y: r.args[1], w: r.args[2], h: r.args[3] }, at: Object.fromEntries(named(c.calls, 'fillText').map((f) => [f.args[0], f.args])) };
  };
  const px = 108;
  const L = boxOf({ text: 'make every frame count', hi: 'every frame' });
  const base = L.at.every[2];
  ok('hi box (Latin): 0.12 em beside the phrase, and centred on its capitals — as much room above them as below the baseline (0.28 em)',
    near(L.box.x, L.at.every[1] - 0.12 * px, 1e-6) && near(L.box.x + L.box.w, L.at.frame[1] + 0.55 * px * 5 + 0.12 * px, 1e-6)
    && near(L.box.y + L.box.h / 2, base - (0.72 * px) / 2, 1e-6) && near(base - 0.72 * px - L.box.y, 0.28 * px, 1e-6) && near(L.box.y + L.box.h - base, 0.28 * px, 1e-6), { box: L.box, base });
  const narrow = (s, p) => Array.from(s).reduce((w, ch) => w + (ch === ' ' ? 0.176 : 0.55) * p, 0);
  const N = boxOf({ text: 'dream big today', hi: 'big', size: 10.3 }, { canvas: { measure: narrow } });
  const npx = 10.3 * 10.8;
  const before = N.box.x - (N.at.dream[1] + 0.55 * npx * 5);
  const after = N.at.today[1] - (N.box.x + N.box.w);
  ok('hi box: never more than half a word space beside the phrase — with a narrow space (Impact\'s 0.176 em) it keeps 0.088 em clear of both neighbours',
    near(N.box.x, N.at.big[1] - 0.088 * npx, 1e-6) && near(before, 0.088 * npx, 1e-6) && near(after, 0.088 * npx, 1e-6), { before, after });
  const apx = 10.7 * 10.8;
  const A = boxOf({ text: 'اصنع كل إطار', hi: 'كل إطار', size: 10.7 }, { lang: 'ar', canvas: { ink: (s, p) => (s === 'كل إطار' ? [0.5 * p, 0.45 * p] : null) } });
  const abase = A.at['كل'][2];
  ok('hi box (Arabic script): centred on the phrase\'s own ink, dots and tails included (0.5 em up, 0.45 down here), with 0.14 em round it',
    near(A.box.y + A.box.h / 2, abase - ((0.5 - 0.45) / 2) * apx, 1e-6) && near(A.box.h, (0.95 + 0.28) * apx, 1e-6)
    && near(A.box.x, A.at['إطار'][1] - 0.12 * apx, 1e-6) && near(A.box.x + A.box.w, A.at['كل'][1] + 0.55 * apx * 2 + 0.12 * apx, 1e-6), { box: A.box, base: abase });
}

// ── the reveals: mask, wipe, blur, outline, shadow ───────────────────────
{
  const mid = (fx, o = {}) => run(docOf({ layers: [text({ in: anim(fx, { d: 1, ease: 'linear', ...o }), end: 10 })] }), 0.5).calls;
  const masked = mid('mask', { by: 'line' });
  ok('mask: each line clipped to its own box and slid up from under it', named(masked, 'clip').length >= 1 && named(masked, 'translate').some((c) => c.args[0] === 0 && c.args[1] > 0));
  const wiped = mid('wipe');
  ok('wipe: clipped to the part uncovered', named(wiped, 'clip').length === 1 && named(wiped, 'rect').length === 1);
  const blurred = mid('blur');
  const offsets = sets(blurred, 'shadowOffsetX');
  ok('blur: soft focus as a shadow thrown back from far outside the frame — never ctx.filter',
    sets(blurred, 'shadowBlur').some((b) => b > 0) && offsets.some((x) => x >= 10000) && named(blurred, 'setTransform').some((c) => c.args[4] < -5000)
    && !blurred.some((c) => c.name === 'filter'));
  const styled = run(docOf({ layers: [text({ text: 'ab', outline: { color: 'accent', width: 0.4 }, shadow: { color: '#000000', blur: 1, x: 0.5, y: 0.5 } })] }), 2).calls;
  const order = styled.filter((c) => c.name === 'fillText' || c.name === 'strokeText').map((c) => c.name + ':' + (c.m[4] < -1000 ? 'off' : 'on'));
  ok('outline and shadow: every shadow, then every outline, then every fill — no letter\'s outline over the letter before',
    order.join(',') === 'fillText:off,strokeText:on,fillText:on' || order.join(',') === 'fillText:off,fillText:off,strokeText:on,strokeText:on,fillText:on,fillText:on', order);
  ok('the outline is stroked with round joins at twice its width (half is under the fill)',
    sets(styled, 'lineJoin').includes('round') && sets(styled, 'lineWidth').some((w) => near(w, 0.4 * 10.8 * 2)));
}

// ── counters ──────────────────────────────────────────────────────────────
{
  // Digits of different widths ('1' narrow), so a proportional layout would move. A size of its own,
  // because widths are cached by font: every context in one browser measures a font the same.
  const measure = (s, px) => Array.from(s).reduce((w, ch) => w + (ch === '1' ? 0.3 : /[0-9]/.test(ch) ? 0.6 : 0.5) * px, 0);
  const layer = HAND.counter({ size: 10.5, from: 10000, to: 99999, group: false, align: 'start', count: { d: 3, delay: 0, ease: 'linear' } });
  const centres = [];
  const widthsSeen = new Set();
  for (const t of [0, 0.4, 0.9, 1.3, 1.7, 2.2, 3]) {
    const c = canvas(1920, 1080, { measure });
    paint(c.ctx, docOf({ layers: [layer] }), t, { strict: true });
    const digits = named(c.calls, 'fillText').map((f) => f.args[1] + measure(f.args[0], 10.5 * 10.8) / 2);
    centres.push(digits.map((x) => x.toFixed(6)).join(','));
    widthsSeen.add(layerBox(makeEnv(c.ctx, docOf(), t, 1920, 1080), layer).w.toFixed(6));
  }
  ok('tabular digits: each digit\'s place is fixed while the number rolls', new Set(centres).size === 1, centres.slice(0, 3));
  ok('the counter\'s box stays as wide as its widest value', widthsSeen.size === 1 && [...widthsSeen][0] === (5 * 0.6 * 10.5 * 10.8).toFixed(6), [...widthsSeen]);
  const shown = (o, t, lang = 'en') => texts(run(docOf({ lang, layers: [HAND.counter(o)] }), t).calls).join('');
  ok('a counter shows prefix, number, suffix: "$1,000k" at the end', shown({ prefix: '$', suffix: 'k' }, 3) === '$1,000k', shown({ prefix: '$', suffix: 'k' }, 3));
  ok('Arabic and Kurdish counters use Arabic-Indic digits, the suffix leading on the left', shown({ suffix: '٪', to: 50, group: false }, 3, 'ckb') === '٪٥٠', shown({ suffix: '٪', to: 50, group: false }, 3, 'ckb'));
  ok('a counter starts at from and rests at to', shown({ from: 7, to: 9 }, 0) === '7' && shown({ from: 7, to: 9 }, 3.9) === '9');
}

// ── shapes, icons, images ─────────────────────────────────────────────────
{
  const calls = (layer, t = 2, lang = 'en') => run(docOf({ lang, layers: [layer] }), t).calls;
  ok('a path that does not parse draws nothing, cleanly', (() => { const c = run(docOf({ layers: [shape({ shape: 'path', d: 'M nonsense' })] }), 2); return !drewSomething(c.calls) && c.check().length === 0; })());
  ok('a shape with no fill and no stroke draws nothing', !drewSomething(calls(shape({ fill: null }))));
  const growing = calls(shape({ w: 40, h: 4, radius: 2, in: anim('grow', { d: 1, ease: 'linear' }) }), 0.5);
  const xsOf = (cs) => cs.filter((c) => ['moveTo', 'lineTo', 'bezierCurveTo'].includes(c.name)).flatMap((c) => c.args.filter((_, i) => i % 2 === 0));
  const gx = xsOf(growing);
  ok('grow: a wide bar extends from its start edge (half grown: its left half)', gx.length > 0 && Math.min(...gx) >= -216 - 1e-6 && Math.max(...gx) <= 1e-6, [Math.min(...gx), Math.max(...gx)]);
  const growingRtl = xsOf(calls(shape({ w: 40, h: 4, radius: 2, in: anim('grow', { d: 1, ease: 'linear' }) }), 0.5, 'ar'));
  ok('grow: from the right in Arabic', Math.min(...growingRtl) >= -1e-6 && Math.max(...growingRtl) <= 216 + 1e-6);
  const tall = calls(shape({ w: 4, h: 40, in: anim('grow', { d: 1, ease: 'linear' }) }), 0.5).filter((c) => ['moveTo', 'lineTo'].includes(c.name)).map((c) => c.args[1]);
  ok('grow: a tall bar extends up from its bottom', Math.min(...tall) >= -1e-6 && Math.max(...tall) <= 216 + 1e-6, [Math.min(...tall), Math.max(...tall)]);
  const drawing = calls(shape({ fill: null, stroke: { color: 'fg', width: 0.5, cap: 'round' }, in: anim('draw', { d: 1, ease: 'linear' }) }), 0.5);
  ok('draw: the stroke is trimmed as it draws on', named(drawing, 'stroke').length === 1 && named(drawing, 'lineTo').length >= 1);
  const icons = ['star', 'heart', 'check', 'nope'].map((id) => calls(HAND.icon({ icon: id })));
  ok('icons are stroked with round caps and joins; an unknown icon draws the sparkle', icons.every((c) => named(c, 'stroke').length >= 1 && sets(c, 'lineCap').includes('round')));
  const iconDraw = calls(HAND.icon({ icon: 'calendar', in: anim('draw', { d: 1, ease: 'linear' }) }), 0.5);
  ok('an icon draws on part by part with a dash as long as each part', named(iconDraw, 'setLineDash').length >= 5 && sets(iconDraw, 'lineDashOffset').every((o) => o >= 0));
  const badge = calls(HAND.icon({ badge: { shape: 'circle', fill: 'accent', pad: 2 } }));
  ok('an icon\'s badge is filled behind the glyph', named(badge, 'fill').length === 1 && named(badge, 'stroke').length === 1 && badge.findIndex((c) => c.name === 'fill') < badge.findIndex((c) => c.name === 'stroke'));
  const pic = calls(HAND.image({}));
  ok('a picture not decoded yet draws a quiet placeholder of its box (and never waits)', named(pic, 'fill').length >= 1 && named(pic, 'stroke').length >= 1 && named(pic, 'drawImage').length === 0);
  let loaded = false;
  await preload(docOf({ layers: [HAND.image({}), text()] })).then(() => { loaded = true; });
  ok('preload resolves without a browser to load in', loaded);
  {
    // A logo on a transparent ground is its own outline: it casts its shadow, and takes its shimmer, from the
    // pixels it has and not from the box round them. (A picture that fills its box, or has rounded corners, keeps the box.)
    class FakeImage { constructor() { this.naturalWidth = 100; this.naturalHeight = 100; } decode() { return Promise.resolve(); } }
    globalThis.Image = FakeImage;
    try {
      const shadow = { color: '#000000aa', blur: 4, x: 0, y: 2 };
      const shimmer = { fx: 'shimmer', d: 2, delay: 0, ease: 'linear', amount: 1 };
      const logo = (o) => HAND.image({ src: `data:image/png;base64,LOGO${++seq}`, fit: 'contain', radius: 0, w: 40, h: 40, ...o });
      const layers = { shadowed: logo({ shadow }), shining: logo({ loop: shimmer }), photoShadow: logo({ fit: 'cover', radius: 2, shadow }), photoShine: logo({ fit: 'cover', radius: 2, loop: shimmer }), slightly: logo({ radius: 1.5, shadow }), rounded: logo({ radius: 8, shadow }) };
      await preload(docOf({ layers: Object.values(layers) }));
      const drawn = (l, t = 1) => calls(l, t);
      const lit = (l) => { const before = offscreens.length; const c = drawn(l); return { c, scratch: offscreens.slice(before).filter((o) => o.rec.calls.some((x) => x.set && x.name === 'globalCompositeOperation' && x.args[0] === 'destination-in')) }; };
      ok('a logo (fitted whole, square corners) casts its shadow by drawing the picture itself, not its box', named(drawn(layers.shadowed), 'drawImage').length === 2, named(drawn(layers.shadowed), 'drawImage').length);
      ok('a picture with rounded corners, or that fills its box, still casts the box\'s shadow', named(drawn(layers.photoShadow), 'drawImage').length === 1);
      ok('the default 1.5u rounding of a new picture does not stop a logo casting its own shadow; a real corner radius does', named(drawn(layers.slightly), 'drawImage').length === 2 && named(drawn(layers.rounded), 'drawImage').length === 1, [named(drawn(layers.slightly), 'drawImage').length, named(drawn(layers.rounded), 'drawImage').length]);
      const l = lit(layers.shining);
      ok('the shimmer on a logo is laid on the logo\'s pixels only: made on a scratch canvas and kept where the picture is', l.scratch.length === 1 && named(l.c, 'drawImage').length === 2, [l.scratch.length, named(l.c, 'drawImage').length]);
      ok('  and the box is not filled with light', named(l.c, 'fillRect').length === 0);
      const p = lit(layers.photoShine);
      ok('the shimmer on a picture that fills its box lights the box, as before', p.scratch.length === 0 && named(p.c, 'fillRect').length === 1);
      ok('the band starts outside the picture: at the loop\'s first instant only the picture is drawn', named(drawn(layers.shining, 0), 'drawImage').length === 1, named(drawn(layers.shining, 0), 'drawImage').length);
    } finally {
      delete globalThis.Image;
    }
  }
  const line = run(docOf({ layers: [shape({ shape: 'line', w: 30, h: 0, fill: 'accent', pin: 'bs' })] }), 2);
  const lb = layerBox(makeEnv(line.ctx, docOf(), 2, 1920, 1080), shape({ shape: 'line', w: 30, h: 0, fill: 'accent', pin: 'bs' }));
  ok('a line is a stroke 0.6u thick by default, and its box is that thick', sets(line.calls, 'lineWidth').some((w) => near(w, 0.6 * 10.8)) && near(lb.h, 0.6 * 10.8), lb);
}

// ── broken input ──────────────────────────────────────────────────────────
{
  const junk = { x: NaN, y: Infinity, scale: NaN, rot: -Infinity, opacity: NaN, size: NaN, w: -5, h: NaN, radius: NaN, sides: NaN, inner: NaN, from: NaN, sweep: Infinity, weight: NaN, lead: NaN, track: NaN, max: NaN, seed: NaN, decimals: NaN, pin: 'zz', color: 'blak', fill: 'nope', align: 'sideways' };
  const layers = ['text', 'shape', 'icon', 'image', 'counter', 'chart', 'backdrop', 'particles'].map((k) => HAND[k]({ ...junk, text: 'x', from: NaN, to: NaN, stroke: { color: 12, width: NaN, cap: 'odd', dash: [NaN, -1] }, shadow: { color: '', blur: NaN, x: NaN, y: Infinity }, in: anim('rise', { d: NaN, amount: NaN, by: 'nonsense' }) }));
  layers.push(shape({ shape: 'line', w: 20, h: 0, blend: 'constructor', stroke: { color: 'fg', width: 0.5, cap: 'odd' }, in: anim('draw'), loop: { fx: 'shimmer', d: 1, amount: 1 } }));
  layers.push(shape({ shape: 'wave', w: 20, h: 5, blend: '__proto__', stroke: { color: 'fg', width: 0.5, cap: 'odd' }, in: anim('blur') }));
  const bad = [];
  for (const t of [0, 0.3, 1, 2, NaN]) {
    try {
      const c = run(docOf({ palette: { bg: 'x', fg: 'y', accent: '', muted: 5 }, fps: NaN, layers }), t);
      bad.push(...c.check());
    } catch (e) {
      bad.push(String(e && e.stack || e));
    }
  }
  ok('numbers that are not numbers and words that are not colours reach the canvas as nothing wrong', bad.length === 0, bad.slice(0, 4));
  ok('a document with no layers list, or a zero-sized canvas, is nothing to draw', (() => {
    const c = canvas(0, 0);
    paint(c.ctx, docOf(), 1, { strict: true });
    const d = canvas(100, 100);
    paint(d.ctx, { ...docOf(), layers: null }, 1, { strict: true });
    return c.calls.length === 0 && d.check().length === 0;
  })());
}

// ── one bad layer ─────────────────────────────────────────────────────────
{
  const bad = shape({ id: 'bad' });
  Object.defineProperty(bad, 'shape', { get() { throw new Error('boom'); }, enumerable: true });
  const doc = docOf({ layers: [bad, shape({ id: 'good', pin: 'ts' })] });
  let threw = null;
  try {
    run(doc, 1);
  } catch (e) {
    threw = e;
  }
  ok('strict: a layer that throws throws', threw && threw.message === 'boom');
  const seen = [];
  const c = canvas(1920, 1080);
  paint(c.ctx, doc, 1, { onError: (id, e) => seen.push([id, e.message]) });
  ok('not strict: the layer is skipped and reported, the next one still drawn, the context balanced',
    seen.length === 1 && seen[0][0] === 'bad' && seen[0][1] === 'boom' && named(c.calls, 'fill').length === 1 && c.check().length === 0, { seen, problems: c.check() });
  const c2 = canvas(1920, 1080);
  paint(c2.ctx, doc, 1, { onError: () => { throw new Error('the reporter too'); } });
  ok('a report that throws costs nothing more', named(c2.calls, 'fill').length === 1 && c2.check().length === 0);
}

// ── motion blur ───────────────────────────────────────────────────────────
{
  const moving = shape({ in: anim('slide', { d: 0.5, amount: 3 }) });
  const opaque = run(docOf({ backdrop: '#000000', layers: [moving] }), 0.2, { paint: { blur: { samples: 4, shutter: 1 } } });
  const draws = named(opaque.calls, 'drawImage');
  ok('motion blur: n sub-frames, each laid on at 1, 1/2, 1/3, 1/4 — an exact running mean',
    draws.length === 4 && [1, 1 / 2, 1 / 3, 1 / 4].every((a, i) => near(draws[i].alpha, a)) && opaque.check().length === 0, draws.map((d) => d.alpha));
  const before = offscreens.map((o) => o.rec?.calls.length ?? 0);
  const clear = run(docOf({ layers: [moving] }), 0.2, { paint: { blur: { samples: 4, shutter: 1 } } });
  const sum = offscreens.find((o, i) => o.rec && o.rec.calls.slice(before[i] ?? 0).some((c) => c.set && c.name === 'globalCompositeOperation' && c.args[0] === 'lighter'));
  const summed = sum ? named(sum.rec.calls.slice(before[offscreens.indexOf(sum)] ?? 0), 'drawImage') : [];
  ok('over a transparent frame the sub-frames are summed at 1/n each (exact with alpha), then laid on once',
    named(clear.calls, 'drawImage').length === 1 && summed.length === 4 && summed.every((d) => near(d.alpha, 1 / 4)), summed.map((d) => d.alpha));
  // A slide with a linear ease moves at a constant speed, so where each sub-frame drew it says when it was.
  const steady = shape({ start: 0, end: 20, in: anim('slide', { d: 10, ease: 'linear', amount: 1 }) });
  const frameScratch = () => offscreens.filter((o) => o.rec && o.width === 1920 && o.height === 1080);
  const mark = frameScratch().map((o) => o.rec.calls.length);
  run(docOf({ fps: 30, backdrop: '#000000', layers: [steady] }), 5, { paint: { blur: { samples: 4, shutter: 1 } } });
  // Every sub-frame also centres its backdrop paint (a translate to 960, 540); the layer's is the other one.
  const xs = frameScratch().flatMap((o, i) => named(o.rec.calls.slice(mark[i] ?? 0), 'translate')).map((c) => c.args[0]).filter((x) => x !== 960);
  // dx = -12u·(1 − t/10) at k = 10.8, around the centre (960): t = 10·(1 + (x − 960)/(12·10.8)).
  const times = xs.map((x) => 10 * (1 + (x - 960) / (12 * 10.8)));
  const mean = times.reduce((a, b) => a + b, 0) / (times.length || 1);
  ok('motion blur samples the middle of n equal slices of the shutter, centred on t (not half a slice early)',
    times.length === 4 && near(mean, 5, 1e-9) && [-0.375, -0.125, 0.125, 0.375].every((o, i) => near(times[i], 5 + o / 30, 1e-9)), times);
  // Eight samples over the default half-frame shutter: s/N − ½ would put every one, and their mean, 1/32 of a frame early.
  const mark8 = frameScratch().map((o) => o.rec.calls.length);
  run(docOf({ fps: 30, backdrop: '#000000', layers: [steady] }), 5, { paint: { blur: { samples: 8, shutter: 0.5 } } });
  const times8 = frameScratch().flatMap((o, i) => named(o.rec.calls.slice(mark8[i] ?? 0), 'translate')).map((c) => c.args[0]).filter((x) => x !== 960)
    .map((x) => 10 * (1 + (x - 960) / (12 * 10.8)));
  const mean8 = times8.reduce((a, b) => a + b, 0) / (times8.length || 1);
  ok('…and with 8 samples over the default half-frame shutter: at t + ((s + ½)/8 − ½)·0.5/fps, their mean exactly t, not 1/32 of a frame early',
    times8.length === 8 && near(mean8, 5, 1e-9) && times8.every((x, s) => near(x, 5 + ((s + 0.5) / 8 - 0.5) * 0.5 / 30, 1e-9)), { times8, early: (5 - mean8) * 30 });
  ok('one sample is a plain paint', named(run(docOf({ backdrop: '#000', layers: [moving] }), 0.2, { paint: { blur: { samples: 1, shutter: 1 } } }).calls, 'drawImage').length === 0);
  ok('the scratch canvases are clean too', offscreens.every((o) => !o.rec || o.rec.check().length === 0), offscreens.map((o) => o.rec?.check()));
}

// ── clicks ────────────────────────────────────────────────────────────────
{
  const hit = (layers, x, y, t = 2) => hitTest(canvas(1920, 1080).ctx, docOf({ layers }), t, x, y);
  const bar = (o) => shape({ id: 'bar', w: 40, h: 10, ...o });
  ok('a click inside a layer finds it; outside finds nothing', hit([bar()], 960 + 200, 540) === 'bar' && hit([bar()], 960 + 230, 540) === null);
  ok('a turned layer is hit where it is drawn, not where it would be unturned',
    hit([bar({ rot: 90 })], 960, 540 - 150) === 'bar' && hit([bar({ rot: 90 })], 960 + 150, 540) === null);
  ok('a scaled layer is hit across its scaled size', hit([bar({ w: 20, scale: 2 })], 960 + 200, 540) === 'bar' && hit([bar({ w: 20 })], 960 + 200, 540) === null);
  ok('the top-most layer wins', hit([bar(), shape({ id: 'top', w: 10, h: 10 })], 960, 540) === 'top');
  ok('a backdrop is never what a click meant, nor a hidden layer', hit([HAND.backdrop({ id: 'bd' }), bar({ hidden: true })], 960, 540) === null);
  ok('a layer not on screen at that moment is not hit', hit([bar({ start: 3 })], 960, 540, 1) === null);
}

// ── the environment ───────────────────────────────────────────────────────
{
  const c = canvas(1080, 1920);
  const env = makeEnv(c.ctx, docOf({ lang: 'kmr', palette: { ...PALETTE, accent: 'junk' } }), 1, 1080, 1920);
  ok('k is 1% of the short side; Badini is right to left', env.k === 10.8 && env.rtl === true);
  ok('a tone is the palette\'s colour; a junk colour is the ink; never an empty string',
    env.color('accent2') === '#ff6aa2' && env.color('accent') === '#f5f7ff' && env.color('blak') === '#f5f7ff' && env.color('') === '#f5f7ff' && env.color('#ABC') === '#aabbcc');
  const g = env.paint({ kind: 'linear', angle: 0, stops: [{ at: 1, color: 'accent2' }, { at: 0, color: 'bg' }, { at: 0.5, color: 'nope' }] }, 200, 100);
  ok('a gradient\'s stops are sorted, and every colour goes through color()', g.stops.map((s) => s[0]).join() === '0,0.5,1' && g.stops[1][1] === '#f5f7ff' && g.args.join() === '-100,0,100,0');
  const noConic = makeEnv(canvas(100, 100, { conic: false }).ctx, docOf(), 0, 100, 100);
  ok('a conic gradient where the engine has none is its first colour', noConic.paint({ kind: 'conic', angle: 0, stops: [{ at: 0, color: 'accent' }, { at: 1, color: 'fg' }] }, 10, 10) === '#4c8dff');
  const radial = env.paint({ kind: 'radial', angle: 0, stops: [{ at: 0, color: 'bg' }, { at: 1, color: 'fg' }] }, 300, 400);
  ok('a radial gradient reaches the box\'s corners', radial.args[5] === 250);
}

// ── text at every output size ─────────────────────────────────────────────
//
// SF Pro and New York change their letters' widths with the size they are
// set at (optical sizes), so text measured at the size it is drawn broke and
// fitted differently in a gallery card, the preview and an export. It is laid
// out at one size and drawn scaled: the measure below is wider, for its size,
// the smaller the text is set (as those faces are), and the line breaks, the
// box in u and every word's place in it must be the same at k = 0.4, 1 and 4.
{
  const optical = (s, px) => Array.from(s).length * 0.55 * px * (1 + (0.3 * 10) / (px + 10));
  let buildMotion = null;
  let recipeIds = [];
  let still = (doc) => doc.seconds / 2;
  try {
    ({ buildMotion } = await import('../.test-build/motiontemplates.js'));
    recipeIds = Object.keys((await import('../.test-build/motionrecipe.js')).META);
    const { stillTime } = await import('../.test-build/motionanim.js');
    still = (doc) => stillTime(doc.layers, doc.seconds);
  } catch {
    /* the templates are built by their own suites; the hand-made documents below still run */
  }
  const FULL = { landscape: [1920, 1080], portrait: [1080, 1920] };
  /** One layer alone at pixels-per-u `k`: its box's size in u, and every word drawn on the frame, where it is in u from the box's centre in the box's own axes. */
  const shotOf = (doc, layer, t, k) => {
    const [W0, H0] = FULL[doc.format];
    const W = Math.max(1, Math.round((W0 * k) / 10.8));
    const H = Math.max(1, Math.round((H0 * k) / 10.8));
    const c = canvas(W, H, { measure: optical });
    const one = { ...doc, layers: [layer] };
    paint(c.ctx, one, t, { strict: true });
    const kk = Math.min(W, H) / 100;
    const b = layerBox(makeEnv(c.ctx, one, t, W, H), layer);
    if (!b) return null;
    const a = (-b.rot * Math.PI) / 180;
    const words = named(c.calls, 'fillText').map((f) => {
      const [x, y] = [f.args[1], f.args[2]];
      const X = f.m[0] * x + f.m[2] * y + f.m[4] - b.cx;
      const Y = f.m[1] * x + f.m[3] * y + f.m[5] - b.cy;
      return { s: f.args[0], u: (X * Math.cos(a) - Y * Math.sin(a)) / kk, v: (X * Math.sin(a) + Y * Math.cos(a)) / kk, far: Math.abs(X) > 4 * W };
    }).filter((w) => !w.far);
    return { w: b.w / kk, h: b.h / kk, words };
  };
  const bad = [];
  let layers = 0;
  let words = 0;
  const check = (doc, t, label) => {
    for (const layer of doc.layers) {
      if (layer.kind !== 'text' && layer.kind !== 'counter') continue;
      const shots = [0.4, 1, 4].map((k) => shotOf(doc, layer, t, k));
      if (shots.some((s) => !s)) continue;
      layers += 1;
      words += shots[0].words.length;
      const [ref, ...rest] = shots;
      rest.forEach((s, i) => {
        const k = [1, 4][i];
        const same = s.words.length === ref.words.length && s.words.every((w, j) => w.s === ref.words[j].s && Math.abs(w.u - ref.words[j].u) < 1e-6 && Math.abs(w.v - ref.words[j].v) < 1e-6);
        if (!same || Math.abs(s.w - ref.w) > 1e-9 * ref.w || Math.abs(s.h - ref.h) > 1e-9 * ref.h) {
          bad.push(`${label} ${layer.id} at k=${k} vs 0.4: box ${s.w.toFixed(4)}x${s.h.toFixed(4)} vs ${ref.w.toFixed(4)}x${ref.h.toFixed(4)} u, words ${s.words.map((w) => w.s).join(' ').slice(0, 60)}`);
        }
      });
    }
  };
  // By hand: wrapping, a word wider than the line, fitting, tracking, a split with a highlight, a counter.
  for (const lang of ['en', 'ckb']) {
    const ar = lang !== 'en';
    check(docOf({ lang, layers: [
      text({ id: 'wrap', text: ar ? 'ئەمە دەقێکی درێژە کە دەبێت چەند جار بشکێت' : 'this is a long text that has to wrap several times', max: 30, size: 6, align: 'start', pin: 'ts', x: 5, y: 5 }),
      text({ id: 'wide', text: ar ? 'ب'.repeat(24) + ' ئەو' : 'unbreakablewordsmithing and', max: 20, size: 7, align: 'end', pin: 'me' }),
      text({ id: 'fit', text: ar ? 'ناونیشانێکی زۆر درێژ\nو دووەم' : 'A title too long to fit\nand a second', max: 40, fit: true, size: 12, pin: 'bs', x: 4, y: -4 }),
      text({ id: 'track', text: 'TRACKED CAPS', track: 0.12, caps: true, size: 5, pin: 'tc', y: 30 }),
      text({ id: 'split', text: ar ? 'هەموو وێنەیەک فەنکشنێکە' : 'every frame is a function', hi: ar ? 'وێنەیەک' : 'frame', hiStyle: 'box', in: anim('rise', { by: 'word', gap: 0.1 }), end: 10, rot: 7, scale: 1.3, size: 5, pin: 'mc' }),
      HAND.counter({ id: 'count', size: 9, from: 0, to: 12500, prefix: '$', suffix: '+', pin: 'bc', y: -20 }),
    ] }), 3, `hand ${lang}`);
    // And on the move: pieces mid-entrance travel in u, which the scaled context must not stretch or shrink.
    check(docOf({ lang, layers: [
      text({ id: 'rising', text: ar ? 'هەموو وێنەیەک فەنکشنێکە' : 'every frame is a function', in: anim('rise', { by: 'word', gap: 0.15, d: 1, ease: 'linear' }), end: 10, rot: -6, scale: 1.2, size: 6 }),
      text({ id: 'popping', text: 'POP BY LETTER', in: anim('pop', { by: 'char', gap: 0.03, d: 1, ease: 'linear' }), end: 10, size: 7, pin: 'ts', x: 10, y: 10 }),
      text({ id: 'sliding', text: ar ? 'دێت لە لاوە' : 'slides in from the side', in: anim('slide', { by: 'line', d: 1, ease: 'linear' }), end: 10, size: 5, pin: 'bs', x: 8, y: -8 }),
      text({ id: 'masked', text: 'Line one\nLine two', in: anim('mask', { by: 'line', d: 1, ease: 'linear' }), end: 10, size: 6, pin: 'me', x: -5 }),
    ] }), 0.45, `moving ${lang}`);
  }
  let recipes = 0;
  if (buildMotion) {
    for (const id of recipeIds) for (const lang of ['en', 'ar', 'ckb']) for (const format of ['landscape', 'portrait']) {
      const doc = buildMotion({ id: 'x', recipe: id, lang, format, now: 0 });
      check(doc, still(doc), `${id} ${lang} ${format}`);
      recipes += 1;
    }
  }
  ok(`text is laid out once, whatever the output size: at k = 0.4, 1 and 4 (a measure that widens small text, as optical sizes do) every box is the same in u and every word is at the same place in it — ${layers} layers, ${words} words, ${recipes} recipe documents${buildMotion ? '' : ' (templates not built: hand-made documents only)'}`,
    bad.length === 0 && layers > 10, bad.slice(0, 4));

  // What a canvas keeps in its own pixels is worked out in the frame's, whatever the layout's scale. At k = 4
  // (a 711 x 400 frame): a 0.4u outline is 3.2 px of the frame, a shadow's 1u blur 4 px and its 0.5u offset 2 px.
  const c = canvas(711, 400);
  paint(c.ctx, docOf({ layers: [text({ text: 'ab', size: 10, outline: { color: 'accent', width: 0.4 }, shadow: { color: '#000000', blur: 1, x: 0.5, y: 0.5 } })] }), 2, { strict: true });
  const at = c.calls.findIndex((x) => x.name === 'strokeText');
  const lw = c.calls.slice(0, at).filter((x) => x.set && x.name === 'lineWidth').pop()?.args[0];
  const m = c.calls[at]?.m ?? [1, 0, 0, 1, 0, 0];
  const drawnWidth = lw * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const shadowBlur = sets(c.calls, 'shadowBlur').filter((b) => b > 0);
  const shadowY = sets(c.calls, 'shadowOffsetY').filter((y) => y !== 0);
  ok('at k = 4 the outline is 3.2 frame px wide (in layout px, scaled) and the shadow blurs 4 px and drops 2 px (device px, not scaled again)',
    near(drawnWidth, 0.4 * 4 * 2, 1e-9) && shadowBlur.length === 1 && near(shadowBlur[0], 4, 1e-9) && shadowY.length === 1 && near(shadowY[0], 2, 1e-9),
    { drawnWidth, shadowBlur, shadowY });

  // A wipe's edge is at the same place in u at every size: the room a shape's, an icon's, a picture's and a
  // chart's clip keeps round it is the layout's, not a fixed count of the frame's pixels.
  const wipeAt = (layer, k) => {
    const W = Math.round((1920 * k) / 10.8);
    const H = Math.round((1080 * k) / 10.8);
    const c = canvas(W, H);
    paint(c.ctx, docOf({ layers: [layer] }), 0.5, { strict: true });
    const kk = Math.min(W, H) / 100;
    const at = c.calls.findIndex((x) => x.name === 'clip');
    const r = c.calls.slice(0, Math.max(0, at)).filter((x) => x.name === 'rect').pop();
    if (!r) return null;
    const [x, y, w, h] = r.args;
    return [(r.m[0] * x + r.m[2] * y + r.m[4] - W / 2) / kk, (r.m[1] * x + r.m[3] * y + r.m[5] - H / 2) / kk, (r.m[0] * w) / kk, (r.m[3] * h) / kk];
  };
  const wiping = { in: anim('wipe', { d: 1, ease: 'linear' }) };
  const drift = [shape({ w: 30, h: 8, radius: 2, ...wiping }), HAND.icon(wiping), HAND.image(wiping), HAND.chart(wiping)].map((layer) => {
    const [a, b, c2] = [0.4, 1, 4].map((k) => wipeAt(layer, k));
    return { kind: layer.kind, a, most: a && b && c2 ? Math.max(...a.map((v, i) => Math.max(Math.abs(v - b[i]), Math.abs(v - c2[i])))) : NaN };
  });
  ok('a wipe half-way across a shape, an icon, a picture and a chart has its edge at the same place in u at k = 0.4, 1 and 4',
    drift.every((d) => d.most < 1e-9), drift.map((d) => `${d.kind} ${d.most}`));
}

// ── the shimmer ───────────────────────────────────────────────────────────
//
// Filling text with a gradient is where WebKit is slowest (a 500-letter
// shimmering title took ~2.7 s a frame there): the band is one fill per layer,
// over the letters set once in white on a sheet, and letters that land off the
// frame are not drawn at all.
{
  const SHIMMER = (amount = 1) => ({ fx: 'shimmer', d: 2, amount });
  const LONG = 'Every frame is a pure function of the document and a time, drawn the same way everywhere. '.repeat(6).slice(0, 500);
  /** Run `f`, and return what it returned with the calls every offscreen canvas received meanwhile. */
  const withSheets = (f) => {
    const before = offscreens.map((o) => o.rec?.calls.length ?? 0);
    const out = f();
    return { out, sheet: offscreens.flatMap((o, i) => (o.rec ? o.rec.calls.slice(before[i] ?? 0) : [])) };
  };
  const isBand = (s) => s && typeof s === 'object' && Array.isArray(s.stops) && s.stops.some(([, c]) => /^rgba\(255, 255, 255/.test(c));
  const peakOf = (g) => Math.max(...g.stops.map(([, c]) => alphaOfColour(c)));
  /** The band's half-width, as a fraction of the gradient: its middle stop to the next. */
  const bandOf = (g) => { const at = g.stops.map(([x]) => x); const mid = g.stops.findIndex(([, c]) => alphaOfColour(c) === peakOf(g)); return at[mid + 1] - at[mid]; };

  const { out: c, sheet } = withSheets(() => run(docOf({ layers: [text({ text: LONG, size: 10, loop: SHIMMER() })] }), 1.5));
  const sheetBands = sets(sheet, 'fillStyle').filter(isBand);
  ok('shimmer: one band fill per layer — the letters set once more in white on a sheet, the band filled over them source-in once, the sheet laid on the frame once',
    named(sheet, 'fill').length === 1 && sheetBands.length === 1 && sets(sheet, 'globalCompositeOperation').includes('source-in')
    && sets(sheet, 'fillStyle').includes('#ffffff') && named(c.calls, 'drawImage').length === 1 && !sets(c.calls, 'fillStyle').some(isBand),
    { fills: named(sheet, 'fill').length, bands: sheetBands.length, drawImage: named(c.calls, 'drawImage').length });
  const drawn = named(c.calls, 'fillText');
  const lefts = drawn.map((f) => f.m[4] + f.args[1]);
  ok('a 500-letter line 30,000 px long draws only the words that reach the 1920 px frame (the rest are left out of every pass)',
    drawn.length > 2 && drawn.length < 16 && lefts.every((x) => x > -1920 && x < 1920 * 2) && named(sheet, 'fillText').length === drawn.length, { drawn: drawn.length, lefts: lefts.map(Math.round) });
  const away = run(docOf({ layers: [text({ text: 'far away', pin: 'ms', x: 300, loop: SHIMMER(), shadow: { color: '#000', blur: 1, x: 0, y: 1 } })] }), 1.5).calls;
  ok('a text layer wholly off the frame draws nothing, its shadow and shimmer included', !drewSomething(away));
  const shadowNear = run(docOf({ layers: [text({ text: 'edge', pin: 'ms', x: -24, size: 10, shadow: { color: '#000', blur: 2, x: 12, y: 0 } })] }), 1.5).calls;
  ok('…but a word just off the frame whose shadow reaches onto it still casts the shadow', named(shadowNear, 'fillText').some((f) => f.m[4] < -1000));
  const split = withSheets(() => run(docOf({ layers: [text({ text: 'split by word', in: anim('rise', { by: 'word', gap: 0.2 }), end: 10, loop: SHIMMER() })] }), 0.5));
  ok('shimmer on a split layer: still one band fill, over every piece where it is',
    named(split.sheet, 'fill').length === 1 && named(split.out.calls, 'drawImage').length === 1 && named(split.sheet, 'fillText').length === 3);

  const shapeBand = (o, t = 1) => sets(run(docOf({ layers: [shape({ loop: SHIMMER(o.amount ?? 1), ...o })] }), t).calls, 'fillStyle').filter(isBand);
  const at1 = shapeBand({ amount: 1 });
  const half = shapeBand({ amount: 0.5 });
  const over = shapeBand({ amount: 2 });
  ok('shimmer honours loop.amount: 55% white at the band\'s heart at 1, half that at 0.5, no brighter at 2, and nothing at 0',
    at1.length === 1 && near(peakOf(at1[0]), 0.55, 1e-4) && near(peakOf(half[0]), 0.275, 1e-4) && near(peakOf(over[0]), 0.55, 1e-4) && shapeBand({ amount: 0 }).length === 0,
    [at1, half, over].map((g) => g[0] && peakOf(g[0])));
  const textPeak = sets(withSheets(() => run(docOf({ layers: [text({ loop: SHIMMER(0.4) })] }), 1)).sheet, 'fillStyle').filter(isBand);
  ok('…and on text', textPeak.length === 1 && near(peakOf(textPeak[0]), 0.22, 1e-4));
  // The band runs along 20°: a w x h box's gradient is w·cos 20° + h·sin 20° long.
  const L = (w, h) => w * Math.cos(20 * Math.PI / 180) + h * Math.sin(20 * Math.PI / 180);
  const small = shapeBand({ w: 20, h: 10 })[0];
  const big = shapeBand({ w: 120, h: 10 })[0];
  const bigText = sets(withSheets(() => run(docOf({ layers: [text({ text: 'a'.repeat(20), size: 10, loop: SHIMMER() })] }), 1)).sheet, 'fillStyle').filter(isBand)[0];
  ok('the band is a fifth of a shape up to 30u, and past that keeps the 6u it has at 30u (a 120u bar: 6u of 116u); words keep a fifth',
    near(bandOf(small), 0.2, 1e-9) && near(bandOf(big), 6 / L(120, 10), 1e-9) && near(bandOf(bigText), 0.2, 1e-9), [bandOf(small), bandOf(big), 6 / L(120, 10), bandOf(bigText)]);
}

// ── shadows at a layer's opacity (WebKit) ─────────────────────────────────
//
// Measured in a WKWebView (.test-build/motion-harness/probe-shadow-alpha.ts):
// a path drawn with a shadow set since the last save() is drawn at full
// opacity unless globalAlpha has been given a different value since that save,
// and text drawn with a shadow ignores globalAlpha altogether. So a shadow
// that is seen with its caster is followed by a fresh globalAlpha, and one
// seen alone (soft) carries the opacity in its colour and is drawn at 1.
/**
 * Every draw a frame made with a visible shadow on it, replayed through the
 * context's state, with what WebKit would get wrong about it: text at an
 * alpha below 1, or a path whose shadow was set since the last save while the
 * alpha still holds the value it had at that save.
 */
const shadowedDraws = (calls) => {
  const out = [];
  let st = { shadow: 'rgba(0, 0, 0, 0)', blur: 0, ox: 0, oy: 0, alpha: 1, atSave: 1, shadowSince: false };
  const stack = [];
  calls.forEach((c, i) => {
    if (!c.set && c.name === 'save') { stack.push(st); st = { ...st, atSave: st.alpha, shadowSince: false }; return; }
    if (!c.set && c.name === 'restore') { st = stack.pop() ?? st; return; }
    if (c.set) {
      const v = c.args[0];
      if (c.name === 'shadowColor') { st.shadow = v; st.shadowSince = true; }
      else if (c.name === 'shadowBlur') { st.blur = v; st.shadowSince = true; }
      else if (c.name === 'shadowOffsetX') { st.ox = v; st.shadowSince = true; }
      else if (c.name === 'shadowOffsetY') { st.oy = v; st.shadowSince = true; }
      else if (c.name === 'globalAlpha' && typeof v === 'number' && v >= 0 && v <= 1) st.alpha = v;
      return;
    }
    if (!['fill', 'stroke', 'fillText', 'strokeText', 'fillRect', 'strokeRect'].includes(c.name)) return;
    if (!(alphaOfColour(st.shadow) > 0) || !(st.blur > 0 || st.ox || st.oy)) return;
    const text = c.name === 'fillText' || c.name === 'strokeText';
    const wrong = st.alpha < 1 && (text || (st.shadowSince && st.alpha === st.atSave));
    out.push({ i, name: c.name, alpha: st.alpha, shadow: st.shadow, wrong });
  });
  return out;
};
{
  const SH = { color: '#00000080', blur: 1, x: 0.3, y: 0.5 };
  const SHADOW_PROPS = ['shadowColor', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'];
  /** For the first `draw` call made with the shadow on: whether globalAlpha was set within 1e-5 of `want` after the last shadow property and before the draw. */
  const nudged = (calls, draw, want) => {
    const d = shadowedDraws(calls).find((x) => x.name === draw);
    if (!d) return { ok: false, why: `no ${draw} with a shadow` };
    let lastShadow = -1;
    for (let i = d.i - 1; i >= 0 && lastShadow < 0; i--) if (calls[i].set && SHADOW_PROPS.includes(calls[i].name)) lastShadow = i;
    const alphaSets = calls.slice(lastShadow + 1, d.i).filter((c) => c.set && c.name === 'globalAlpha');
    const last = alphaSets[alphaSets.length - 1];
    return { ok: lastShadow >= 0 && !!last && near(last.args[0], want, 1e-5) && near(calls[d.i].alpha, want, 1e-5) && !d.wrong, lastShadow, draw: d.i, alphaSets: alphaSets.map((c) => c.args[0]) };
  };
  const at = (layer, t = 2) => run(docOf({ layers: [layer] }), t).calls;
  const cases = [
    ['a filled shape', at(shape({ opacity: 0.5, shadow: SH })), 'fill'],
    ['a stroked shape', at(shape({ opacity: 0.5, fill: null, stroke: { color: 'fg', width: 0.6, cap: 'round' }, shadow: SH })), 'stroke'],
    ['an icon\'s badge', at(HAND.icon({ opacity: 0.5, badge: { shape: 'circle', fill: 'accent', pad: 2 }, shadow: SH })), 'fill'],
    ['an icon with no badge', at(HAND.icon({ opacity: 0.5, shadow: SH })), 'stroke'],
  ];
  for (const [what, calls, draw] of cases) {
    const r = nudged(calls, draw, 0.5);
    ok(`WebKit: ${what} with a shadow at opacity 0.5 sets globalAlpha (within 1e-5 of 0.5) after the shadow and before the ${draw}`, r.ok, r);
  }
  // Fading out: the same at every moment of the exit, not only at a round opacity.
  const fading = [3.5, 3.7, 3.9].map((t) => shadowedDraws(at(shape({ out: anim('fade', { d: 0.6 }), shadow: SH }), t)));
  ok('WebKit: a shadowed plate fading out is drawn at its fading alpha in every frame (0.5 < alpha < 1 and below)',
    fading.every((ds) => ds.length === 1 && !ds[0].wrong && ds[0].alpha < 1) && fading[0][0].alpha > fading[2][0].alpha, fading.map((ds) => ds.map((d) => d.alpha)));

  const titled = at(text({ text: 'ab cd', opacity: 0.5, shadow: SH }));
  const drops = shadowedDraws(titled).filter((d) => d.name === 'fillText');
  const fills = named(titled, 'fillText').filter((c) => c.m[4] > -1000);
  ok('WebKit: a title\'s shadow at opacity 0.5 carries the opacity in its colour (0.502 × 0.5) and is drawn at 1 — text drawn with a shadow ignores globalAlpha there',
    drops.length === 2 && drops.every((d) => d.alpha === 1 && near(alphaOfColour(d.shadow), (128 / 255) * 0.5, 1e-4) && !d.wrong)
    && fills.length === 2 && fills.every((c) => near(c.alpha, 0.5, 1e-9)), { drops, fills: fills.map((c) => c.alpha) });
  const blurredText = shadowedDraws(run(docOf({ layers: [text({ text: 'ab cd', opacity: 0.5, in: anim('blur', { d: 2, ease: 'linear' }), end: 10 })] }), 0.4).calls);
  ok('WebKit: soft focus at opacity 0.5 is drawn at 1 with the opacity in the soft copy\'s colour',
    blurredText.length === 2 && blurredText.every((d) => d.alpha === 1 && alphaOfColour(d.shadow) > 0 && alphaOfColour(d.shadow) <= 0.5 + 1e-9 && !d.wrong), blurredText);
}

// ── WebKit ────────────────────────────────────────────────────────────────
{
  const all = canvases.flatMap((c) => c.calls).concat(offscreens.flatMap((o) => o.rec?.calls ?? []));
  ok('ctx.filter and ctx.fontKerning are never set, in any frame drawn above (WebKit has neither)',
    all.length > 10000 && !all.some((c) => c.name === 'filter' || c.name === 'fontKerning'), all.length);
  const draws = canvases.flatMap((c) => shadowedDraws(c.calls));
  const wrong = draws.filter((d) => d.wrong);
  ok(`every draw made with a shadow in every frame above (${draws.length}, ${draws.filter((d) => d.alpha < 1).length} below alpha 1) is one WebKit draws at its alpha`,
    draws.length > 200 && wrong.length === 0, wrong.slice(0, 4));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
