// The quality check (motioncheck.ts): every rule found where it should be and
// nowhere else, every repair kept only when it helps, and the eighteen
// templates left alone.
//
// What matters, in order:
//
//   1. False alarms are worse than misses. None of the eighteen templates, in
//      any shape or language, may draw a warning — or, today, anything at all.
//   2. Each rule has a case that trips it, one that must not, and the edge
//      between them, in English and in a right-to-left language where the
//      rule is about a side.
//   3. A repair is a pure, idempotent edit that removes its finding and never
//      causes another, over a corpus of hostile documents too.
//   4. The check never throws, never says NaN, and is the same twice.
//   5. It is fast: under 25 ms for thirty layers.
//
// Measuring: the recording canvas measures every UTF-16 unit at 0.55 of the
// size. That is close for Latin and a third too wide for Arabic script, whose
// joined letters average about 0.43 em in the bundled face (the per-letter
// table in motionrecipes-titles.ts). The templates are checked with Arabic at
// 0.43 em and a space at 0.31 — the faces the app draws in — and once more
// with the canvas's own measure, where the one finding is pinned below.
import { readFileSync } from 'fs';
import { makeCanvas } from './motioncanvas.mjs';
import { CHECK, RULES, autofix, checkMotion, summarize } from '../.test-build/motioncheck.js';
import { buildMotion } from '../.test-build/motiontemplates.js';
import { readMotion } from '../.test-build/motionread.js';
import { CORE_RECIPE_IDS, FORMAT_IDS, LANGUAGES, RECIPE_IDS } from '../.test-build/motiontypes.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  cond ? pass++ : fail++;
};
const J = (x) => JSON.stringify(x);

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻾]/;
/** Widths as the app's faces give them: Latin as the canvas has it, Arabic-script letters at 0.43 em, an Arabic line's space at 0.31. */
const faces = (text, px) => {
  const arabic = ARABIC.test(text);
  let w = 0;
  for (const ch of text) w += ARABIC.test(ch) ? 0.43 : ch === ' ' && arabic ? 0.31 : 0.55 * ch.length;
  return w * px;
};
const ctxOf = (measure = faces) => makeCanvas(8, 8, measure ? { measure } : {}).ctx;
const check = (d, measure) => checkMotion(d, { ctx: ctxOf(measure) });
const fix = (d, findings, ids) => autofix(d, findings ?? check(d), ids, { ctx: ctxOf() });
const of = (fs, rule, id) => fs.filter((f) => f.rule === rule && (id === undefined || f.layerId === id));

const MID = { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' };
let seq = 0;
const T = (o = {}) => ({
  kind: 'text', id: `t${++seq}`, name: 'Words', text: 'Hello there', size: 6, weight: 700, start: 0, end: 6, pin: 'mc', x: 0, y: 0,
  in: { fx: 'fade', d: 0.4, delay: 0, ease: 'out', amount: 1 }, ...o,
});
const R = (o = {}) => ({ kind: 'shape', shape: 'rect', id: `s${++seq}`, name: 'Plate', w: 60, h: 20, fill: 'accent', start: 0, end: 6, pin: 'mc', ...o });
const BG = (o = {}) => ({ kind: 'backdrop', id: `b${++seq}`, name: 'Background', style: 'aurora', speed: 1, start: 0, end: 6, ...o });
/** A thin rule along the bottom for the whole graphic: something on screen, so a case about one text is not also about an empty frame. */
const RULE = (o = {}) => R({ name: 'Rule', w: 30, h: 1, pin: 'bc', y: -12, end: 30, ...o });
const D = (layers, o = {}) => readMotion({
  id: 'd', title: 'Test', lang: 'en', format: 'landscape', fps: 30, seconds: 6, palette: MID, backdrop: 'bg', layers, created: 1, updated: 1, ...o,
}, 1);

/** Every finding the rule cases produce, to check the catalogue has their words. */
const seen = [];
const run = (d, measure) => {
  const fs = check(d, measure);
  seen.push(...fs);
  return fs;
};

// ── the contract ──────────────────────────────────────────────────────────
console.log('contract');
{
  ok('checkMotion, autofix and summarize are functions', [checkMotion, autofix, summarize].every((f) => typeof f === 'function'));
  ok('thirteen rules', RULES.length === 13 && new Set(RULES).size === 13, RULES);
  ok('the thresholds are numbers', Object.values(CHECK).every((v) => typeof v === 'number' && Number.isFinite(v)));
  ok('a clean graphic has nothing to say', J(run(D([BG(), T()]))) === '[]', run(D([BG(), T()])));
  ok('summarize: clean', J(summarize([])) === J({ warn: 0, tip: 0, clean: true }));
  ok('summarize: counts', J(summarize([{ severity: 'warn' }, { severity: 'tip' }, { severity: 'tip' }])) === J({ warn: 1, tip: 2, clean: false }));
  ok('summarize: survives junk', J(summarize([null, 7, { severity: 'other' }])) === J({ warn: 0, tip: 0, clean: true }) && summarize(null).clean);
  for (const junk of [null, undefined, 0, 'x', {}, { layers: 'no' }, []]) {
    let threw = false, got;
    try { got = checkMotion(junk, { ctx: ctxOf() }); } catch { threw = true; }
    ok(`checkMotion(${J(junk) ?? 'undefined'}) is an empty list`, !threw && Array.isArray(got) && got.length === 0);
  }
  const d = D([T({ size: 1 })]);
  ok('without a context it measures with the engine’s own canvas', J(checkMotion(d)) === J(check(d, null)));
  ok('autofix of nothing asked is the same graphic', fix(d, [], []) === d && fix(d, []) === d);
}

// ── off-canvas and outside-safe ───────────────────────────────────────────
console.log('edges');
{
  const off = run(D([BG(), T({ id: 'w', pin: 'ms', x: -20 })]));
  ok('words 20u past the start edge: off-canvas, a warning, with a move', of(off, 'off-canvas', 'w').length === 1
    && off[0].severity === 'warn' && J(off[0].fix?.patches) === J([{ layerId: 'w', patch: { x: 5.25, y: 0 } }]), off);
  const d = D([BG(), T({ id: 'w', pin: 'ms', x: -20 })]);
  const r = fix(d);
  ok('the move brings it inside, past the safe margin', r.layers[1].x === 5.25 && check(r).length === 0, check(r));
  ok('the move is an edit: the graphic is new, the original untouched', r !== d && d.layers[1].x === -20);

  // The same layer in Arabic: `s` is the right edge, and x toward the end is leftward.
  const ar = D([BG(), T({ id: 'w', text: 'مرحبا بكم', pin: 'ms', x: -20 })], { lang: 'ar' });
  const fa = run(ar);
  ok('in Arabic, the same layer runs off the right edge', of(fa, 'off-canvas', 'w').length === 1, fa);
  const ra = fix(ar);
  ok('and the move is logical: x grows, toward the end', ra.layers[1].x === 5.25 && check(ra).length === 0, check(ra));

  const near = run(D([BG(), T({ id: 'w', pin: 'ms', x: -2 })]));
  ok('2u past the edge is not off-canvas (the bleed is 2.5u)…', of(near, 'off-canvas').length === 0, near);
  ok('…but it is outside the safe margin, as a tip, with a move', of(near, 'outside-safe', 'w').length === 1 && of(near, 'outside-safe')[0].severity === 'tip' && !!of(near, 'outside-safe')[0].fix);
  const inset = run(D([BG(), T({ id: 'w', pin: 'ms', x: 5 })]));
  ok('5u in is inside the safe margin', inset.length === 0, inset);
  const top = run(D([BG(), T({ id: 'w', pin: 'tc', y: 3 })]));
  ok('3u from the top is outside the safe margin', of(top, 'outside-safe', 'w').length === 1);
  ok('and the move takes it down', J(of(top, 'outside-safe')[0].fix.patches[0].patch) === J({ x: 0, y: 5.25 }));

  ok('a short word in a box as wide as the frame is judged by its letters', run(D([BG(), T({ text: 'Hi', max: 400 })])).length === 0);
  ok('a slide in from outside the frame is judged at rest', run(D([BG(), T({ in: { fx: 'slide', d: 0.6, delay: 0, ease: 'out', amount: 3, dir: 'start' } })])).length === 0);
  const turned = run(D([BG(), T({ id: 'w', text: 'A long line of words here', size: 8, rot: 90 })]));
  ok('a line turned upright is judged turned: it now runs off the top and bottom', of(turned, 'off-canvas', 'w').length === 1, turned);
  ok('a shape may bleed off the frame: decoration', run(D([BG(), R({ x: 150, w: 100 })])).length === 0);
  const icon = run(D([BG(), { kind: 'icon', id: 'i', name: 'Icon', icon: 'star', size: 10, pin: 'ms', x: -9, start: 0, end: 6 }]));
  ok('an icon off the edge is a tip, not a warning', of(icon, 'off-canvas', 'i').length === 1 && of(icon, 'off-canvas', 'i')[0].severity === 'tip', icon);
  const big = run(D([BG(), T({ id: 'w', text: 'Enormous', size: 60, pin: 'ms', x: -30 })]));
  ok('words larger than the safe area: off-canvas, with no move to offer', of(big, 'off-canvas', 'w').length === 1 && !of(big, 'off-canvas', 'w')[0].fix, big);
  ok('a hidden layer says nothing', run(D([BG(), T({ pin: 'ms', x: -40, hidden: true })])).length === 0);
}

// ── text-overflow ─────────────────────────────────────────────────────────
console.log('text-overflow');
{
  const d = D([BG(), T({ id: 'w', text: 'Extraordinary', size: 6, max: 30 })]);
  const fs = run(d);
  ok('a word wider than its wrap width: a warning, with a smaller size', of(fs, 'text-overflow', 'w').length === 1
    && of(fs, 'text-overflow')[0].severity === 'warn' && of(fs, 'text-overflow')[0].fix?.label === 'Shrink to fit', fs);
  const r = fix(d);
  ok('shrunk, it fits and nothing else is said', r.layers[1].size < 6 && r.layers[1].size > 3.9 && check(r).length === 0, [r.layers[1].size, check(r)]);
  const fit = run(D([BG(), T({ id: 'w', text: 'Supercalifragilisticexpialidocious', size: 10, max: 10, fit: true })]));
  ok('a fitted title still too wide at its smallest: a warning', of(fit, 'text-overflow', 'w').length === 1, fit);
  const df = D([BG(), T({ id: 'w', text: 'Supercalifragilisticexpialidocious', size: 10, max: 10, fit: true })]);
  ok('whose repair would make it unreadably small, so it is refused', fix(df) === df);
  ok('words that fit say nothing', run(D([BG(), T({ text: 'Short', max: 30 })])).length === 0);
  // 'Exactly' is 7 × 0.55 × 6 = 23.1u: at a wrap width of 23.1u it fits exactly.
  ok('a word exactly as wide as the wrap fits', run(D([BG(), T({ text: 'Exactly', max: 23.1 })])).length === 0);
  ok('and one a tenth wider does not', of(run(D([BG(), T({ text: 'Exactly', max: 21 })])), 'text-overflow').length === 1);
  ok('with no wrap width there is no box to overflow', of(run(D([BG(), T({ text: 'Extraordinary', max: 0 })])), 'text-overflow').length === 0);
  const chart = (labels) => D([BG(), {
    kind: 'chart', id: 'c', name: 'Chart', chart: 'bars', w: 30, h: 20, start: 0, end: 6, labels,
    data: [{ label: 'An extremely long label here', value: 3 }, { label: 'Another very long label', value: 5 }],
  }]);
  const cut = run(chart(true));
  ok('chart labels cut short with an ellipsis: a tip', of(cut, 'text-overflow', 'c').length === 1 && of(cut, 'text-overflow')[0].severity === 'tip', cut);
  ok('a chart without labels has none to cut', run(chart(false)).length === 0);
  ok('a chart with short labels says nothing', run(D([BG(), { kind: 'chart', id: 'c', name: 'Chart', chart: 'bars', w: 60, h: 30, start: 0, end: 6, data: [{ label: 'Q1', value: 1 }, { label: 'Q2', value: 2 }] }])).length === 0);
}

// ── overlap ───────────────────────────────────────────────────────────────
console.log('overlap');
{
  const fs = run(D([BG(), T({ id: 'a', name: 'First', text: 'First words' }), T({ id: 'b', text: 'Second words', y: 1 })]));
  ok('two texts on each other for six seconds: a warning on the front one', of(fs, 'overlap', 'b').length === 1
    && of(fs, 'overlap')[0].severity === 'warn' && of(fs, 'overlap')[0].vars.other === 'First' && of(fs, 'overlap')[0].id === 'overlap:a:b', fs);
  ok('it names the time they share', of(fs, 'overlap')[0].from === 0.4 && of(fs, 'overlap')[0].to === 6);
  ok('apart, they say nothing', run(D([BG(), T({ text: 'First words', y: -10 }), T({ text: 'Second words', y: 10 })])).length === 0);
  ok('a hand-over of a fifth of a second is a cut, not a collision', run(D([BG(), T({ text: 'First words', end: 2 }), T({ text: 'Second words', start: 1.8, in: undefined })])).length === 0);
  ok('the same words twice (a hand-over between layers) are one text', of(run(D([BG(), T({ text: 'Same words' }), T({ text: 'Same words' })])), 'overlap').length === 0);
  ok('a quotation mark behind the words is decoration, not text', run(D([BG(), T({ text: '“', size: 40 }), T({ text: 'Words below it' })])).length === 0);
  const ar = run(D([BG(), T({ id: 'a', text: 'كلمات أولى' }), T({ id: 'b', text: 'كلمات ثانية', y: 1 })], { lang: 'ar' }));
  ok('in Arabic too', of(ar, 'overlap', 'b').length === 1, ar);
}

// ── covered ───────────────────────────────────────────────────────────────
console.log('covered');
{
  const fs = run(D([BG(), T({ id: 'w' }), R({ id: 'p', name: 'Box' })]));
  ok('a solid box drawn over the words: a warning', of(fs, 'covered', 'w').length === 1 && of(fs, 'covered')[0].severity === 'warn'
    && of(fs, 'covered')[0].vars.percent === 100 && of(fs, 'covered')[0].vars.other === 'Box', fs);
  const part = run(D([BG(), T({ id: 'w' }), R({ w: 10, h: 20, pin: 'mc', x: -14 })]));
  ok('a box over a quarter of them: a tip', of(part, 'covered', 'w').length === 1 && of(part, 'covered')[0].severity === 'tip', part);
  ok('a box under the words is a plate, not a cover', of(run(D([BG(), R({ fill: '#000000' }), T()])), 'covered').length === 0);
  ok('a box mixed in by screen is light, not a cover', run(D([BG(), T(), R({ blend: 'screen' })])).length === 0);
  ok('a half-transparent box is not a cover', run(D([BG(), T(), R({ opacity: 0.5 })])).length === 0);
  ok('a box there for a fifth of a second is a flash, not a cover', run(D([BG(), T(), R({ start: 3, end: 3.2 })])).length === 0);
  ok('an outline (no fill) is not a cover', run(D([BG(), T(), R({ fill: null, stroke: { color: 'fg', width: 0.3 } })])).length === 0);
  const ring = run(D([BG(), T({ id: 'w', text: 'Hi' }), R({ shape: 'ellipse', w: 40, h: 40 })]));
  ok('a disc is tested as a disc', of(ring, 'covered', 'w').length === 1);
  const corner = run(D([BG(), T({ id: 'w', text: 'Hi', size: 4 }), R({ shape: 'ellipse', w: 30, h: 30, x: 13, y: 13 })]));
  ok('and words in its box’s corner, outside the disc, are not under it', of(corner, 'covered').length === 0, corner);
}

// ── low-contrast ──────────────────────────────────────────────────────────
console.log('low-contrast');
{
  const grey = { bg: '#777777', fg: '#8a8a8a', accent: '#000000', accent2: '#111111', muted: '#999999' };
  const d = D([BG(), T({ id: 'w', size: 2.4, weight: 400 })], { palette: grey });
  const fs = run(d);
  ok('grey on grey: a warning, with the palette colour that reads', of(fs, 'low-contrast', 'w').length === 1 && of(fs, 'low-contrast')[0].severity === 'warn'
    && J(of(fs, 'low-contrast')[0].fix?.patches[0].patch) === J({ color: 'accent' }), fs);
  ok('it says the ratio', of(fs, 'low-contrast')[0].vars.ratio === '1.3', of(fs, 'low-contrast')[0].vars);
  const r = fix(d);
  ok('recoloured, it reads', r.layers[1].color === 'accent' && check(r).length === 0, check(r));
  // #949494 on #333333 is 3.5 to 1: enough for large text, not for small.
  const mid = { ...grey, bg: '#333333', fg: '#949494' };
  ok('3.5 to 1 is enough for large text', run(D([BG(), T({ size: 6 })], { palette: mid })).length === 0);
  const small = run(D([BG(), T({ id: 'w', size: 2.1, weight: 400 })], { palette: mid }));
  ok('and a tip for small text', of(small, 'low-contrast', 'w').length === 1 && of(small, 'low-contrast')[0].severity === 'tip', small);
  ok('bold at 2u is large', run(D([BG(), T({ size: 2.1, weight: 700 })], { palette: mid })).length === 0);
  ok('a transparent frame is a ground nobody here has seen: nothing said', of(run(D([T({ size: 2.4 })], { palette: grey, backdrop: null })), 'low-contrast').length === 0);
  // Words set on a plate drawn as a path (a speech bubble): the plate is the ground, as a rectangle's would be. Counting every
  // path as half-filled once told a good chat card that its replies could not be read.
  const bubble = 'M6 0H94Q100 0 100 6V54Q100 60 94 60H30L20 72L22 60H6Q0 60 0 54V6Q0 0 6 0Z';
  const onBubble = run(D([BG(), RULE(), R({ id: 'p', shape: 'path', d: bubble, w: 60, h: 20, fill: 'accent' }), T({ id: 'w', color: 'bg', size: 4 })]));
  ok('words on a bubble drawn as a path: read against the bubble, nothing said', of(onBubble, 'low-contrast', 'w').length === 0, onBubble);
  const starPath = 'M50 0L61 35L98 35L68 57L79 91L50 70L21 91L32 57L2 35L39 35Z';
  const onStar = run(D([BG(), RULE(), R({ id: 'p', shape: 'path', d: starPath, w: 60, h: 20, fill: 'accent' }), T({ id: 'w', color: 'bg', size: 4 })]));
  ok('but a star-shaped path is no ground under words: they are still judged against the frame behind', of(onStar, 'low-contrast', 'w').length === 1, onStar);
  ok('an unreadable or open path keeps the old half, and never throws', of(run(D([BG(), RULE(), R({ id: 'p', shape: 'path', d: 'M0 0 L10', w: 60, h: 20, fill: 'accent' }), T({ id: 'w', color: 'bg', size: 4 })])), 'low-contrast', 'w').length === 1);
  const plate = { ...grey, fg: '#ffffff' };
  ok('words on a dark plate over a pale ground read', run(D([BG(), R({ fill: '#000000' }), T({ color: 'fg' })], { palette: { ...plate, bg: '#eeeeee' } })).length === 0);
  const onPale = run(D([BG(), R({ fill: '#f4f4f4' }), T({ id: 'w', color: '#ffffff' })], { palette: plate }));
  ok('white words on a pale plate over a dark ground do not', of(onPale, 'low-contrast', 'w').length === 1, onPale);
  ok('a plate laid at half opacity is mixed with what is under it', of(run(D([BG(), R({ fill: '#ffffff', opacity: 0.5 }), T({ color: '#000000' })], { palette: { ...grey, bg: '#000000' } })), 'low-contrast').length === 0);
  ok('a picture under the words is a ground nobody here has seen', of(run(D([BG(), { kind: 'image', id: 'img', name: 'Picture', src: 'data:image/png;base64,AAAA', w: 80, h: 40, start: 0, end: 6 }, T({ color: '#ffffff' })], { palette: { ...grey, bg: '#ffffff' } })), 'low-contrast').length === 0);
  ok('an outline is a ground of the words’ own', run(D([BG(), T({ size: 2.4, outline: { color: 'accent', width: 0.3 } })], { palette: grey })).length === 0);
  const grad = run(D([BG(), T({ id: 'w', color: { kind: 'linear', angle: 0, stops: [{ at: 0, color: '#ffffff' }, { at: 1, color: '#7a7a7a' }] } })], { palette: grey }));
  ok('a gradient is judged by its worst stop', of(grad, 'low-contrast', 'w').length === 1, grad);
  const counter = run(D([BG(), { kind: 'counter', id: 'n', name: 'Number', from: 0, to: 9, size: 10, color: 'fg', start: 0, end: 6, count: { d: 1, delay: 0, ease: 'out' } }], { palette: grey }));
  ok('a counter is words too', of(counter, 'low-contrast', 'n').length === 1, counter);
}

// ── small-text ────────────────────────────────────────────────────────────
console.log('small-text');
{
  const d = D([BG(), T({ id: 'w', size: 1.2 })]);
  const fs = run(d);
  ok('1.2u: a warning, with a larger size', of(fs, 'small-text', 'w').length === 1 && of(fs, 'small-text')[0].severity === 'warn'
    && J(of(fs, 'small-text')[0].fix.patches[0].patch) === J({ size: 2 }), fs);
  ok('made larger, it says nothing', check(fix(d)).length === 0);
  const label = run(D([BG(), T({ id: 'w', size: 1.8 })]));
  ok('a short label at 1.8u: a tip', of(label, 'small-text', 'w').length === 1 && of(label, 'small-text')[0].severity === 'tip', label);
  ok('a short label at 2.2u (the handle’s caption) is fine', run(D([BG(), T({ size: 2.2 })])).length === 0);
  const body = run(D([BG(), T({ id: 'w', text: 'one two three four five six seven eight', size: 2.3, max: 160 })]));
  ok('eight words of body at 2.3u: a tip', of(body, 'small-text', 'w').length === 1, body);
  const scaled = D([BG(), T({ id: 'w', size: 3, scale: 0.4 })]);
  const sc = run(scaled);
  ok('a layer scaled to 0.4 is judged as drawn', of(sc, 'small-text', 'w').length === 1 && of(sc, 'small-text')[0].severity === 'warn', sc);
  ok('and its repair accounts for the scale', J(of(sc, 'small-text')[0].fix.patches[0].patch) === J({ size: 5 }) && check(fix(scaled)).length === 0);
  const fitted = run(D([BG(), T({ id: 'w', text: 'A rather long headline here', size: 6, max: 20, fit: true })]));
  ok('a fitted title shrunk small is small text, with no size to offer (its box is what decides)', of(fitted, 'small-text', 'w').length === 1 && !of(fitted, 'small-text')[0].fix, fitted);
  ok('a counter at 1.2u is small too', of(run(D([BG(), { kind: 'counter', id: 'n', name: 'Number', from: 0, to: 9, size: 1.2, start: 0, end: 6, count: { d: 1, delay: 0, ease: 'out' } }])), 'small-text', 'n').length === 1);
}

// ── too-fast and blink ────────────────────────────────────────────────────
console.log('reading');
{
  const long = 'The quick brown foxes jumped over seven lazy dogs while the farmer slept soundly under the old apple tree today';
  const d = D([BG(), RULE(), T({ id: 'w', text: long, size: 3, max: 160, end: 2.5 })], { seconds: 12 });
  const fs = run(d);
  ok('twenty words for two seconds: too fast, a warning, kept longer', of(fs, 'too-fast', 'w').length === 1 && of(fs, 'too-fast')[0].severity === 'warn'
    && of(fs, 'too-fast')[0].fix?.label === 'Keep it on screen longer', fs);
  const r = fix(d);
  ok('kept on screen longer, it can be read', r.layers[1].end > 7 && r.layers[1].end <= 12 && of(check(r), 'too-fast').length === 0, [r.layers[1].end, check(r)]);
  const tight = run(D([BG(), RULE(), T({ id: 'w', text: long, size: 3, max: 160, end: 2.5 })]));
  ok('with no room left in the graphic, there is no repair to offer', of(tight, 'too-fast', 'w').length === 1 && !of(tight, 'too-fast')[0].fix);
  ok('three short words are taken in at a glance', run(D([BG(), RULE(), T({ text: 'Big bold idea', end: 0.9 })])).length === 0);
  const ar = 'كلمة كلمة كلمة كلمة كلمة كلمة';
  const lat = 'word word word word word word';
  const arFs = run(D([BG(), RULE(), T({ id: 'w', text: ar, end: 2.3 })], { lang: 'ar' }));
  // Twenty-four letters are 4.8 words: 2.2 s at Arabic script's pace, 1.9 s at Latin's; readable for 2.1 s (half the fade to the end).
  ok('Arabic script is read more slowly: six four-letter words readable for 2.1 s is a tip…', of(arFs, 'too-fast', 'w').length === 1 && of(arFs, 'too-fast')[0].severity === 'tip', arFs);
  ok('…which the same in Latin letters is not', run(D([BG(), RULE(), T({ text: lat, end: 2.3 })])).length === 0);
  const kurdish = 'ژ ڤێرێ دەست پێ بکە';
  ok('Badini’s particles are not counted as words of their own', run(D([BG(), RULE(), T({ text: kurdish, end: 1.6 })], { lang: 'kmr' })).length === 0);
  ok('a title handed from one layer to the next is read across both', run(D([BG(),
    T({ text: 'one two three four five six seven', end: 1.2, max: 160 }), T({ text: 'one two three four five six seven', start: 1.2, max: 160, in: undefined })])).length === 0);

  const b = D([BG(), RULE(), T({ id: 'w', start: 1, end: 1.3, in: undefined })]);
  const bf = run(b);
  ok('words on screen for 0.3 s: blink, a warning', of(bf, 'blink', 'w').length === 1 && of(bf, 'blink')[0].severity === 'warn', bf);
  const br = fix(b);
  ok('kept for half a second, it is not', br.layers[1].end >= 1.5 && check(br).length === 0, [br.layers[1].end, check(br)]);
  ok('exactly half a second is enough', run(D([BG(), RULE(), T({ start: 1, end: 1.5, in: undefined })])).length === 0);
  const flash = run(D([BG(), RULE(), T({ text: 'Flash', end: 0.3, in: undefined }), T({ text: 'After it', start: 0.3, in: undefined })]));
  ok('a blink is about words: the graphic around it is fine', of(flash, 'blink').length === 1 && flash.length === 1, flash);
}

// ── time: frozen, late-start, empty-frame, dense ──────────────────────────
console.log('time');
{
  const still = run(D([T()]));
  ok('a title that fades in and sits for 5.6 s: frozen, a tip', of(still, 'frozen').length === 1 && of(still, 'frozen')[0].from === 0.4 && of(still, 'frozen')[0].to === 6, still);
  ok('a loop keeps it alive', run(D([T({ loop: { fx: 'float', d: 3, amount: 1 } })])).length === 0);
  ok('a moving backdrop keeps it alive', run(D([BG(), T()])).length === 0);
  ok('a still backdrop does not', of(run(D([BG({ speed: 0 }), T()])), 'frozen').length === 1);
  ok('three seconds of a short graphic is not frozen', run(D([T({ end: 3 })], { seconds: 3 })).length === 0);
  // 0.4 s to 3 s, then 3 s to 5.8 s: two still stretches, neither 3 s, because the cut at 3 s is a change.
  ok('a cut is a change: two still titles one after the other are not frozen', run(D([T({ end: 3 }), T({ text: 'Then this', start: 3, end: 5.8, in: undefined })], { seconds: 5.8 })).length === 0);
  ok('but a stretch past the limit (four seconds) still after the cut is', of(run(D([T({ end: 3 }), T({ text: 'Then this', start: 3, end: 8, in: undefined })], { seconds: 8 })), 'frozen').length === 1);
  ok('and a graphic over video (a transparent frame) is never frozen: the video moves', of(run(D([T({ end: 3 }), T({ text: 'Then this', start: 3, end: 8, in: undefined })], { seconds: 8, backdrop: null })), 'frozen').length === 0);

  const late = run(D([BG(), T({ start: 1.2 })]));
  ok('nothing until 1.2 s: late-start, a tip', of(late, 'late-start').length === 1 && J(of(late, 'late-start')[0].vars) === J({ seconds: '1.2' }), late);
  ok('something by 0.4 s is in time', run(D([BG(), T({ start: 0.4 })])).length === 0);
  ok('a background alone is not late, or empty, or frozen', run(D([BG()])).length === 0);

  const gap = run(D([BG(), T({ end: 2 }), T({ text: 'Later on', start: 3 })]));
  ok('an empty second in the middle: empty-frame, a tip with no repair', of(gap, 'empty-frame').length === 1 && !of(gap, 'empty-frame')[0].fix
    && of(gap, 'empty-frame')[0].from === 2 && of(gap, 'empty-frame')[0].to === 3, gap);
  ok('a quarter of a second is a breath, not a gap', run(D([BG(), T({ end: 2 }), T({ text: 'Later on', start: 2.25 })])).length === 0);
  const tail = D([BG(), T({ end: 3 })]);
  const tf = run(tail);
  ok('three empty seconds at the end: a tip, trimmed', of(tf, 'empty-frame').length === 1 && of(tf, 'empty-frame')[0].fix?.seconds === 3.1, tf);
  const tr = fix(tail);
  ok('trimmed, the graphic ends with its words', tr.seconds === 3.1 && check(tr).length === 0, [tr.seconds, check(tr)]);

  const four = (i) => T({ text: 'four words in here', y: -40 + i * 8, size: 3 });
  const dense = run(D([BG(), ...Array.from({ length: 11 }, (_, i) => four(i))]));
  ok('eleven four-word texts at once: dense, a tip', of(dense, 'dense').length === 1 && of(dense, 'dense')[0].vars.count === 11, dense);
  ok('eight one-word labels (an axis) are not', run(D([BG(), ...Array.from({ length: 8 }, (_, i) => T({ text: `L${i}`, y: -40 + i * 11, size: 3 }))])).length === 0);
  ok('seven texts are not', of(run(D([BG(), ...Array.from({ length: 7 }, (_, i) => four(i))])), 'dense').length === 0);
}

// ── every rule found, and its words translated ────────────────────────────
console.log('words');
{
  const rules = new Set(seen.map((f) => f.rule));
  ok('the cases above trip every rule', RULES.every((r) => rules.has(r)), RULES.filter((r) => !rules.has(r)));
  const src = readFileSync('src/i18n.ts', 'utf8');
  const keys = new Set([...seen.map((f) => f.message), ...seen.filter((f) => f.fix).map((f) => f.fix.label)]);
  const missing = [];
  for (const k of keys) {
    const n = src.split(`\n  '${k.replace(/'/g, "\\'")}':`).length - 1;
    if (n !== 3) missing.push(`${k} (${n})`);
  }
  ok(`every message and repair (${keys.size}) is in the Arabic, Sorani and Badini catalogues`, missing.length === 0, missing);
  const code = readFileSync('src/motioncheck.ts', 'utf8');
  const labels = [...code.matchAll(/label: '([^']+)'|moveFix\(s, it, '([^']+)'\)/g)].map((m) => m[1] ?? m[2]);
  ok('and every repair label written in the source is one of them', labels.length >= 6 && labels.every((l) => keys.has(l)), labels.filter((l) => !keys.has(l)));
  ok('no message says error', [...keys].every((k) => !/error/i.test(k)));
}

// ── the templates ─────────────────────────────────────────────────────────
console.log('templates');
{
  const all = [];
  let slowest = 0;
  for (const recipe of CORE_RECIPE_IDS) {
    for (const format of FORMAT_IDS) {
      for (const lang of LANGUAGES) {
        const m = buildMotion({ id: 'x', recipe, lang, format, now: 1 });
        const t0 = performance.now();
        const fs = check(m);
        slowest = Math.max(slowest, performance.now() - t0);
        for (const f of fs) all.push(`${recipe}/${format}/${lang}: ${f.severity} ${f.rule} ${f.layerId ?? ''}`);
      }
    }
  }
  ok(`the 18 templates × 4 shapes × 4 languages: not one warning (slowest check ${slowest.toFixed(1)} ms)`, all.every((x) => !x.includes(' warn ')), all.filter((x) => x.includes(' warn ')).slice(0, 6));
  ok('nor a tip: a template is the house’s idea of a good graphic', all.length === 0, all.slice(0, 6));

  // (The canvas's own measure, a third too wide for Arabic, is not run here: motiondraw.ts keys its layout caches on
  // the font, not the canvas, so two measures in one process would mix. Run alone, it finds one thing the real face
  // does not — the steps title, set beside the step column by the recipe's own true widths, reaching over the numbers
  // in Arabic landscape. docs/pro/check.md records it.)

  // The pro pass's templates (packages 07 and 08) are held to the first rule once they are merged in.
  const pro = RECIPE_IDS.filter((id) => !CORE_RECIPE_IDS.includes(id));
  const proWarn = [];
  for (const recipe of pro) for (const format of FORMAT_IDS) for (const lang of LANGUAGES) {
    for (const f of check(buildMotion({ id: 'x', recipe, lang, format, now: 1 }))) if (f.severity === 'warn') proWarn.push(`${recipe}/${format}/${lang}: ${f.rule} ${f.layerId ?? ''}`);
  }
  ok(`the pro templates (${pro.length} here): not one warning`, proWarn.length === 0, proWarn.slice(0, 6));
}

// ── a hostile corpus ──────────────────────────────────────────────────────
console.log('fuzz');
{
  let s = 20261003;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const NUM = [0, -1, 1, 2.5, 7, 40, 199, 1e9, -1e9, NaN, Infinity, -Infinity, '12', null, undefined, 0.0001];
  const num = (lo, hi) => (rnd() < 0.15 ? pick(NUM) : lo + rnd() * (hi - lo));
  const WORDS = ['', ' ', 'Go', 'Hello there', 'مرحبا بكم في العرض', 'ژ ڤێرێ دەست پێ بکە', 'W'.repeat(300), 'word '.repeat(80), '“', '12,500', 'a\nb\nc\nd', '👩‍👩‍👧 🇮🇶'];
  const COLOURS = ['fg', 'bg', 'accent', 'accent2', 'muted', '#000', '#ffffff00', 'rgba(0,0,0,.5)', 'nonsense', '',
    { kind: 'linear', angle: 0, stops: [{ at: 0, color: 'fg' }, { at: 1, color: '#123456' }] }, { kind: 'radial', stops: [] }];
  const anim = () => (rnd() < 0.3 ? undefined : {
    fx: pick(['none', 'fade', 'rise', 'pop', 'type', 'mask', 'wipe', 'slide', 'nope']), d: num(0, 3), delay: num(0, 3), ease: pick(['out', 'back-out', 'zzz']),
    amount: num(0, 3), by: pick([undefined, 'word', 'char', 'line']), gap: num(0, 0.5),
  });
  const layer = () => {
    const kind = pick(['text', 'text', 'text', 'shape', 'shape', 'counter', 'chart', 'icon', 'image', 'backdrop', 'particles', 'bogus']);
    const start = num(0, 12);
    return {
      kind, id: rnd() < 0.1 ? 'dup' : `l${Math.floor(rnd() * 1e6)}`, name: pick(['A', '', 'Title', '“x”']), start, end: rnd() < 0.2 ? num(-5, 40) : start + num(0, 8),
      pin: pick(['ts', 'mc', 'be', 'bs', 'zz', undefined]), x: num(-200, 200), y: num(-200, 200), scale: num(0, 4), rot: num(-400, 400), opacity: num(0, 1),
      in: anim(), out: anim(), loop: rnd() < 0.3 ? { fx: pick(['float', 'spin', 'none', 'shimmer']), d: num(0, 5), amount: num(0, 3) } : undefined,
      text: pick(WORDS), size: num(0, 220), weight: num(100, 900), max: num(0, 300), fit: rnd() < 0.5, lead: num(0.5, 3), track: num(-0.3, 1.2), caps: rnd() < 0.2,
      align: pick(['start', 'center', 'end', 'up']), color: pick(COLOURS), outline: rnd() < 0.1 ? { color: 'bg', width: num(0, 2) } : undefined,
      shadow: rnd() < 0.1 ? { color: pick(['#000000', 'rgba(0,0,0,.2)']), blur: num(0, 5), x: 0, y: 1 } : undefined, blend: pick([undefined, 'normal', 'screen']),
      shape: pick(['rect', 'ellipse', 'star', 'line', 'path', 'arc']), w: num(0, 300), h: num(0, 300), fill: rnd() < 0.2 ? null : pick(COLOURS),
      from: num(-100, 100), to: num(-100, 100), count: { d: num(0, 3), delay: num(0, 3), ease: 'out' }, prefix: pick(['', '$', '٪']), suffix: pick(['', '%', 'k']),
      chart: pick(['bars', 'hbars', 'line', 'donut', 'ring']), data: Array.from({ length: Math.floor(rnd() * 14) }, (_, i) => ({ label: pick(WORDS).slice(0, 30), value: num(-10, 100) || i })),
      labels: rnd() < 0.8, icon: pick(['star', 'heart', 'nope']), src: rnd() < 0.5 ? 'data:image/png;base64,AAAA' : 'http://x', style: pick(['aurora', 'grid', 'x']),
      speed: num(0, 3), hidden: rnd() < 0.1,
    };
  };
  const docs = [];
  for (let i = 0; i < 260; i++) {
    const d = readMotion({
      id: `f${i}`, title: 'Fuzz', lang: pick(LANGUAGES), format: pick([...FORMAT_IDS, 'nope']), fps: 30, seconds: num(1, 30),
      palette: rnd() < 0.5 ? MID : { bg: pick(['#ffffff', '#000000', 'nope']), fg: '#777777' }, backdrop: pick(['bg', null, '#ffffff', COLOURS[10], 'nope']),
      layers: Array.from({ length: Math.floor(rnd() * 24) }, layer), created: 1, updated: 1,
    }, 1);
    if (d) docs.push(d);
  }
  const RULE_SET = new Set(RULES);
  const bad = [];
  let findings = 0;
  for (const d of docs) {
    let fs;
    try { fs = check(d); } catch (e) { bad.push(`${d.id} threw ${e}`); continue; }
    findings += fs.length;
    if (J(check(d)) !== J(fs)) bad.push(`${d.id} not the same twice`);
    if (new Set(fs.map((f) => f.id)).size !== fs.length) bad.push(`${d.id} has two findings with one id`);
    const ids = new Set(d.layers.map((l) => l.id));
    for (const f of fs) {
      if (!RULE_SET.has(f.rule) || (f.severity !== 'tip' && f.severity !== 'warn') || typeof f.message !== 'string' || !f.message) bad.push(`${d.id} malformed ${J(f)}`);
      if (f.layerId !== undefined && !ids.has(f.layerId)) bad.push(`${d.id} names a layer it does not have`);
      for (const v of [f.from, f.to]) if (v !== undefined && !Number.isFinite(v)) bad.push(`${d.id} ${f.rule} has a time of ${v}`);
      if (f.from !== undefined && f.to !== undefined && !(f.from <= f.to)) bad.push(`${d.id} ${f.rule} ends before it starts`);
      for (const v of Object.values(f.vars ?? {})) {
        if ((typeof v === 'number' && !Number.isFinite(v)) || (typeof v === 'string' && /NaN|undefined|Infinity/.test(v) && f.rule !== 'overlap' && f.rule !== 'covered')) bad.push(`${d.id} ${f.rule} says ${v}`);
      }
      for (const p of f.fix?.patches ?? []) {
        if (!ids.has(p.layerId)) bad.push(`${d.id} ${f.rule} repairs a layer it does not have`);
        if (J(p.patch).includes('null') && !('color' in p.patch)) bad.push(`${d.id} ${f.rule} repair ${J(p.patch)}`);
      }
    }
  }
  ok(`${docs.length} hostile documents (${findings} findings): no throw, the same twice, well formed, no NaN`, bad.length === 0, bad.slice(0, 5));

  // Repairs over the corpus: a fixed point, nothing new, never more warnings, and a second pass changes nothing.
  const keyOf = (f) => (f.rule === 'overlap' ? f.id : `${f.rule}|${f.layerId ?? ''}`);
  const counts = (fs) => fs.reduce((m, f) => m.set(keyOf(f), (m.get(keyOf(f)) ?? 0) + 1), new Map());
  const worse = [];
  let changed = 0, repaired = 0;
  const t0 = performance.now();
  for (const d of docs.slice(0, 160)) {
    const before = check(d);
    let r;
    try { r = fix(d, before); } catch (e) { worse.push(`${d.id} threw ${e}`); continue; }
    if (r === d) continue;
    changed += 1;
    const after = check(r);
    repaired += before.length - after.length;
    const was = counts(before);
    for (const [k, n] of counts(after)) if (n > (was.get(k) ?? 0)) worse.push(`${d.id}: ${k} appeared`);
    if (after.filter((f) => f.severity === 'warn').length > before.filter((f) => f.severity === 'warn').length) worse.push(`${d.id}: more warnings`);
    if (J(readMotion(JSON.parse(J(r)), 1)) !== J(r)) worse.push(`${d.id}: the repaired graphic is not what the reader keeps`);
    if (fix(r, after) !== r) worse.push(`${d.id}: a second pass changed it`);
    if (J(fix(d, before)) !== J(r)) worse.push(`${d.id}: not the same twice`);
  }
  const ms = performance.now() - t0;
  ok(`repairs over 160 of them (${changed} changed, ${repaired} findings repaired, ${ms.toFixed(0)} ms): nothing new, never worse, idempotent, readable`,
    worse.length === 0 && changed > 10, worse.slice(0, 5));

  // Repairs of the templates under hostile words are held to the same promise.
  const tpl = [];
  for (const recipe of CORE_RECIPE_IDS) {
    const m = buildMotion({ id: 'x', recipe, lang: 'en', format: 'portrait', now: 1, fields: { title: 'W'.repeat(90), subtitle: 'word '.repeat(20), name: 'Supercalifragilistic', label: 'x' } });
    const before = check(m);
    const r = fix(m, before);
    if (fix(r, check(r)) !== r) tpl.push(`${recipe}: not idempotent`);
    const was = counts(before);
    for (const [k, n] of counts(check(r))) if (n > (was.get(k) ?? 0)) tpl.push(`${recipe}: ${k} appeared`);
    if (r !== m && r.recipe) tpl.push(`${recipe}: a hand repair left the template link`);
  }
  ok('templates given hostile words: repairs keep the same promise, and detach the template like a hand edit', tpl.length === 0, tpl);
}

// ── speed ─────────────────────────────────────────────────────────────────
console.log('speed');
{
  const layers = [BG(), { kind: 'particles', id: 'p', name: 'Sparks', start: 0, end: 6 }];
  for (let i = 0; i < 12; i++) layers.push(T({ text: `Line ${i} of words\nand a second line here`, size: 3 + (i % 4), max: 60, y: -40 + i * 7, x: (i % 3) * 30 - 30 }));
  for (let i = 0; i < 9; i++) layers.push(R({ shape: i % 2 ? 'ellipse' : 'rect', w: 20, h: 8, x: i * 15 - 60, y: 30, fill: i % 3 ? 'accent' : 'bg' }));
  for (let i = 0; i < 4; i++) layers.push({ kind: 'counter', id: `n${i}`, name: 'Number', from: 0, to: 1000 * i, size: 8, x: i * 30 - 45, y: -30, start: 0, end: 6, count: { d: 1.2, delay: 0.2, ease: 'out' } });
  layers.push({ kind: 'chart', id: 'c', name: 'Chart', chart: 'bars', w: 60, h: 30, start: 0, end: 6, data: [{ label: 'North', value: 3 }, { label: 'South', value: 5 }, { label: 'East', value: 2 }] });
  layers.push({ kind: 'icon', id: 'i', name: 'Icon', icon: 'star', size: 8, start: 0, end: 6, pin: 'ts', x: 10, y: 10 });
  layers.push({ kind: 'image', id: 'img', name: 'Picture', src: 'data:image/png;base64,AAAA', w: 30, h: 20, pin: 'be', x: 10, y: -10, start: 0, end: 6 });
  const d = D(layers);
  ok('the speed document has thirty layers', d.layers.length === 30, d.layers.length);
  const ctx = ctxOf();
  let t0 = performance.now();
  checkMotion(d, { ctx });
  const cold = performance.now() - t0;
  const times = [];
  for (let i = 0; i < 25; i++) {
    t0 = performance.now();
    checkMotion(d, { ctx });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const median = times[12];
  console.log(`  (thirty layers: ${cold.toFixed(2)} ms the first time, ${median.toFixed(2)} ms median of 25, ${times[24].toFixed(2)} ms slowest)`);
  ok(`checkMotion on thirty layers: under 25 ms (median ${median.toFixed(2)} ms)`, median < 25, median);
  ok(`and the first time, with every line still to lay out, under 100 ms (${cold.toFixed(2)} ms)`, cold < 100, cold);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
