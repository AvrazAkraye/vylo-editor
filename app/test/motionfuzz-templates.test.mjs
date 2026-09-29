// Templates and the maths under them, under attack (motiontemplates.ts and
// the recipes; motionmath.ts): fields a person could paste and a model could
// write, and paths and curves with any numbers in them.
//
// What matters: every recipe, given hostile words in every field — nothing,
// ten thousand characters, bidi overrides, line breaks in a one-line field, a
// thousand-line list, lists with no numbers or only numbers, Infinity, a
// countdown from 99 or "abc", a style that is not one — builds without
// throwing, quickly, the same twice, as a fixed point of the reader, and paints
// frames a browser accepts; words that cannot be broken — a web address, an
// e-mail, a long compound, a long Arabic word — stay inside the frame in every
// recipe and every narrow shape; and no path, curve or colour the maths is
// handed makes it throw or return a number that is not finite.
import { makeCanvas } from './motioncanvas.mjs';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { META } from '../.test-build/motionrecipe.js';
import { readMotion } from '../.test-build/motionread.js';
import { paint, makeEnv, layerBox } from '../.test-build/motiondraw.js';
import { inDone, unitsOf } from '../.test-build/motionanim.js';
import { RECIPE_IDS, FORMAT_IDS, LANGUAGES, EASES } from '../.test-build/motiontypes.js';
import * as M from '../.test-build/motionmath.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);
const SIZES = { landscape: [1920, 1080], portrait: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };

// ── hostile fields ────────────────────────────────────────────────────────
console.log('hostile fields');
{
  const HOSTILE = [
    '', '   ', 'W'.repeat(10_000), 'word '.repeat(2000), '\u202Eevil\u202C text \u2066iso\u2069', 'line1\nline2\nline3\nline4\nline5\nline6',
    'a\u2028b\u2029c', 'Label: 1\n'.repeat(1000), 'no numbers here\n'.repeat(20), Array.from({ length: 13 }, (_, i) => String(i + 1)).join('\n'),
    'Dup: 5\nDup: 5\nDup: 5', 'Neg: -40\nNeg2: -1e12\nPos: 30', 'Inf: Infinity\nBig: 1e999\nNaN: NaN', '999999999999999999999', '-0', 'abc', '99',
    '\u0000\u0001\u0007\u001B[31m x', '\uD800 lone \uDFFF', '👩‍👩‍👧‍👦🏳️‍🌈 🇮🇶'.repeat(20), 'Z̸̢̛̖̗a̵̧͉l̷g̷o̵'.repeat(10), '中文字符测试'.repeat(20), 'مدينة '.repeat(300), 'AURORA',
  ];
  const bad = [];
  let builds = 0, slowest = 0;
  RECIPE_IDS.forEach((recipe, r) => {
    HOSTILE.forEach((value, h) => {
      const lang = LANGUAGES[(r + h) % 4];
      const format = FORMAT_IDS[(r + 2 * h) % 4];
      const fields = Object.fromEntries(META[recipe].fields.map((f) => [f.key, value]));
      const key = `${recipe}/${h}/${lang}/${format}`;
      let m;
      const t0 = performance.now();
      try { m = buildMotion({ id: 'x', recipe, fields, lang, format, now: 1 }); } catch (e) { bad.push(`${key} threw ${e}`); return; }
      const ms = performance.now() - t0;
      builds++;
      slowest = Math.max(slowest, ms);
      if (ms > 50) bad.push(`${key} took ${ms.toFixed(0)} ms`);
      if (J(buildMotion({ id: 'x', recipe, fields, lang, format, now: 1 })) !== J(m)) bad.push(`${key} not deterministic`);
      if (J(readMotion(JSON.parse(J(m)), 1)) !== J(m)) bad.push(`${key} not a fixed point`);
      if (!m.layers.length || m.layers.some((l) => !(l.end > l.start))) bad.push(`${key} empty, or a layer ends before it starts`);
      const [w, hh] = SIZES[format];
      for (let i = 0; i < 20; i++) {
        const c = makeCanvas(w / 8, hh / 8);
        try { paint(c.ctx, m, (m.seconds * i) / 19, { strict: true }); } catch (e) { bad.push(`${key} paint threw ${e}`); break; }
        const p = c.check();
        if (p.length) { bad.push(`${key} @${i}: ${p[0]}`); break; }
      }
    });
  });
  ok(`${builds} hostile builds (every recipe, ${HOSTILE.length} kinds of words, all languages and shapes): no throw, under 50 ms (slowest ${slowest.toFixed(1)}), deterministic, fixed points, 20 clean frames each`,
    bad.length === 0, bad.slice(0, 5));
}

// ── one long word ─────────────────────────────────────────────────────────
console.log('one long word');
{
  /** Text and counter boxes at rest that reach outside the frame. */
  const outside = (doc) => {
    const [w, h] = SIZES[doc.format];
    const c = makeCanvas(w, h);
    const out = [];
    for (const l of doc.layers) {
      if (l.kind !== 'text' && l.kind !== 'counter') continue;
      const t = Math.min(inDone(l, unitsOf(l)) + 0.01, l.end - 0.01);
      const b = layerBox(makeEnv(c.ctx, doc, t, w, h), { ...l, rot: 0, loop: undefined });
      if (b && (b.x < -0.5 || b.y < -0.5 || b.x + b.w > w + 0.5 || b.y + b.h > h + 0.5)) out.push(`${doc.recipe.id} ${doc.format}: ${l.id} ${Math.round(b.x)}..${Math.round(b.x + b.w)} of ${w}`);
    }
    return out;
  };
  // The data templates' heading planned two lines on a narrow frame and turned `fit` off, so one word too wide for
  // a line (motiondraw never cuts a word) ran off the frame; such a title is now one line, fitted. Every recipe and
  // every field of words is held to the same.
  const WORDS = { en: ['www.erbil-dental-clinic.com', 'appointments@clinic-erbil.iq', 'Donaudampfschifffahrtsgesellschaft'], ar: ['\u0648\u0627\u0644\u0645\u0633\u062A\u0634\u0641\u064A\u0627\u062A'.repeat(3)] };
  const out = [];
  let builds = 0;
  for (const recipe of RECIPE_IDS) for (const format of ['portrait', 'square', 'feed']) for (const [lang, words] of Object.entries(WORDS)) for (const word of words) {
    for (const f of META[recipe].fields) {
      if (f.kind === 'choice' || f.kind === 'number') continue;
      const value = f.kind === 'list' ? `${word}: 40\n${word}: 55` : Array.from(word).slice(0, f.max).join('');
      out.push(...outside(buildMotion({ id: 'x', recipe, fields: { [f.key]: value }, lang, format, now: 1 })));
      builds += 1;
    }
  }
  ok(`${builds} builds with one long unbreakable word in a field (every recipe, the narrow shapes): every box inside the frame`, out.length === 0, out.slice(0, 4));
}

// ── the maths ─────────────────────────────────────────────────────────────
console.log('maths');
{
  const bad = [];
  for (const name of [...EASES, 'bezier(0.1,2,0.3,-9)', 'cubic-bezier(1,0,0,1)', 'bezier(1e-300,1e300,1,1)', 'constructor', '__proto__', '']) {
    const e = M.easeOf(name);
    if (e(0) !== 0 || e(1) !== 1) bad.push(`${name} ends`);
    for (const x of [NaN, Infinity, -Infinity, -1e300, 1e300, 5e-324, 0.5]) if (!Number.isFinite(e(x))) bad.push(`${name}(${x})`);
  }
  for (const c of ['rgb(1e999,0,0)', 'hsl(NaN,50%,50%)', '#GGG', '#12345', 'rgba(1,2,3,5)', 'TRANSPARENT', 'hsl(-720deg,200%,-5%)', 'rgb(1,2,3,)', '']) {
    const v = M.parseColor(c);
    if (v && ![v.r, v.g, v.b, v.a].every(Number.isFinite)) bad.push(`colour ${c}`);
  }
  for (const segs of [M.blobPath(1e300, -1e300, NaN, Infinity, 1e9), M.starPath(NaN, 1e308, 1e308, -5), M.wavePath(1e308, 1e308, 1e308, NaN), M.arcPath(1, 1, Infinity, NaN), M.polygonPath(1e9, 0, 0)]) {
    if (!segs.every((g) => g.p.every(Number.isFinite)) || !Number.isFinite(M.pathLength(segs))) bad.push('shape');
  }
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const num = () => { const r = rnd(); return r < 0.003 ? '1e8' : r < 0.006 ? '-1e8' : r < 0.1 ? '0' : r < 0.15 ? '1e-9' : r < 0.2 ? '-.5' : (rnd() * 200 - 100).toFixed(Math.floor(rnd() * 3)); };
  let parsed = 0, slowest = 0;
  for (let i = 0; i < 2000; i++) {
    let d = `M${num()} ${num()}`;
    for (let n = 1 + Math.floor(rnd() * 80); n > 0; n--) {
      const C = 'MLHVCSQTAZ'[Math.floor(rnd() * 10)];
      d += (rnd() < 0.5 ? C.toLowerCase() : C) + Array.from({ length: ARITY[C] }, (_, k) => (C === 'A' && (k === 3 || k === 4) ? (rnd() < 0.5 ? '0' : '1') : num())).join(' ');
    }
    if (rnd() < 0.2) d = d.slice(0, Math.floor(rnd() * d.length));
    const t0 = performance.now();
    let segs;
    try { segs = M.parsePath(d, 3000); } catch { bad.push('parsePath threw'); continue; }
    if (!segs) continue;
    parsed++;
    const fin = (list) => list.every((g) => g.p.every(Number.isFinite));
    if (!Number.isFinite(M.pathLength(segs)) || !fin(M.trimPath(segs, 0.2, 0.7)) || !M.flatten(segs, 1e-9).every((l) => l.pts.every(Number.isFinite))) bad.push(`path ${d.slice(0, 40)}`);
    const p = M.pointAt(segs, 0.4);
    if (![p.x, p.y, p.angle].every(Number.isFinite) || !M.parsePath(M.pathToString(segs), 1e6)) bad.push(`path ${d.slice(0, 40)}`);
    slowest = Math.max(slowest, performance.now() - t0);
  }
  ok(`eases, colours, shapes with absurd numbers, and ${parsed} random paths measured, cut, flattened and written back: always finite (slowest path ${slowest.toFixed(1)} ms)`,
    bad.length === 0 && parsed > 1000 && slowest < 200, bad.slice(0, 5));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
