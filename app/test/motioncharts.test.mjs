// Charts: bars, horizontal bars, a line, a donut and a progress ring.
//
// What matters: every chart type draws cleanly (motioncanvas's check()) and
// stays inside its own box whatever the data — one datum or twelve, zeros,
// negatives, huge and tiny values, empty labels — in English and in Arabic,
// at any moment; the data arrive one after another, `gap` apart; a value
// counts up with its datum and never shows more than its own number; a value
// over `max` is drawn at the top of the scale; in a right-to-left document the
// first datum is on the right and horizontal bars grow from the right edge;
// and the labels and values written are the ones the toggles ask for.
import { readFileSync } from 'node:fs';
import { makeCanvas, drewSomething } from './motioncanvas.mjs';
import { drawChart } from '../.test-build/motioncharts.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const PALETTE = { bg: '#0B1020', fg: '#F5F7FF', accent: '#4C8DFF', accent2: '#FF6AA2', muted: '#8A93B2' };
const CHARTS = (() => {
  const src = readFileSync(new URL('../src/motiontypes.ts', import.meta.url), 'utf8');
  const m = /export const CHARTS = \[([^\]]*)\]/.exec(src);
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
})();

const docOf = (lang = 'en') => ({
  id: 'd', title: 't', request: '', lang, format: 'landscape', fps: 30, seconds: 10,
  palette: PALETTE, backdrop: 'bg', layers: [], stage: 'ready', created: 0, updated: 0,
});
const envOf = (ctx, doc, t) => ({
  ctx, doc, t, k: 10.8, width: 1920, height: 1080, rtl: doc.lang !== 'en',
  color: (c) => PALETTE[c] ?? c,
  paint: (p) => (typeof p === 'string' ? PALETTE[p] ?? p : '#FFFFFF'),
});
const POSE = { on: true, presence: 1, opacity: 1, dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, reveal: 1, from: 'left', mask: 1, type: 1, draw: 1, grow: 1, blur: 0, glint: -1 };
const ABC = [{ label: 'Alpha', value: 40 }, { label: 'Beta', value: 65 }, { label: 'Gamma', value: 52 }, { label: 'Delta', value: 90 }];
const ARABIC = [{ label: 'يناير', value: 40 }, { label: 'فبراير', value: 65 }, { label: 'مارس', value: 52 }, { label: 'أبريل', value: 90 }];
const chart = (o = {}) => ({
  id: 'c', name: 'c', start: 0, end: 10, pin: 'mc', x: 0, y: 0, scale: 1, rot: 0, opacity: 1,
  kind: 'chart', chart: 'bars', w: 80, h: 50, data: ABC, colors: ['accent', 'accent2'], max: 0, unit: '',
  labels: true, values: true, voice: 'sans', size: 2.6, color: 'fg', thick: 1.2, gap: 0.2, ...o,
});
const grow = (o = {}) => ({ fx: 'grow', d: 1, delay: 0, ease: 'linear', amount: 1, ...o });

/** A chart drawn as paint draws it: the origin on the box's centre, the layer's opacity on the context. */
function draw(layer, t, o = {}) {
  const { ctx, calls, check } = makeCanvas(1920, 1080);
  ctx.save();
  ctx.translate(960, 540);
  ctx.globalAlpha = o.alpha ?? 1;
  const from = calls.length;
  drawChart(envOf(ctx, docOf(o.lang ?? 'en'), t), layer, { ...POSE, opacity: o.alpha ?? 1 });
  ctx.restore();
  calls.splice(0, from);
  calls.pop();
  // Each text with the face, alignment and baseline it was written in.
  const texts = [];
  let font = '10px sans-serif', align = 'start', base = 'alphabetic';
  for (const c of calls) {
    if (c.name === 'font' && c.set) font = c.args[0];
    if (c.name === 'textAlign' && c.set) align = c.args[0];
    if (c.name === 'textBaseline' && c.set) base = c.args[0];
    if (c.name === 'fillText') texts.push({ text: c.args[0], x: c.args[1], y: c.args[2], alpha: c.alpha, font, align, base });
    if (c.name === 'restore' || c.name === 'save') { /* state is per save; the chart saves once around everything */ }
  }
  return { calls, problems: check(), texts };
}

/** A number as written in either digit set, separators and all. */
const num = (s) => parseFloat([...String(s)].map((ch) => {
  const c = ch.charCodeAt(0);
  if (c >= 0x660 && c <= 0x669) return String(c - 0x660);
  if (c === 0x66b) return '.';
  if (c === 0x66c || ch === ',') return '';
  return ch;
}).join('').replace(/[^0-9.\-]/g, ''));
const isNumber = (s) => /[0-9]/.test(String(s)) || [...String(s)].some((ch) => ch.charCodeAt(0) >= 0x660 && ch.charCodeAt(0) <= 0x669);
const values = (r) => r.texts.filter((x) => isNumber(x.text));
const labels = (r) => r.texts.filter((x) => !isNumber(x.text));

// ── clean, and inside the box, whatever the data ──────────────────────────
const SETS = {
  four: ABC,
  arabic: ARABIC,
  one: [{ label: 'Only', value: 7 }],
  twelve: Array.from({ length: 12 }, (_, i) => ({ label: `Month ${i + 1}`, value: 10 + ((i * 37) % 50) })),
  zeros: [{ label: 'A', value: 0 }, { label: 'B', value: 0 }, { label: 'C', value: 0 }],
  negatives: [{ label: 'A', value: -5 }, { label: 'B', value: 12 }, { label: 'C', value: -40 }],
  huge: [{ label: 'A', value: 1e12 }, { label: 'B', value: 4.5e11 }, { label: 'C', value: 1 }],
  tiny: [{ label: 'A', value: 0.004 }, { label: 'B', value: 0.0009 }, { label: 'C', value: 3e-7 }],
  unlabelled: [{ label: '', value: 3 }, { label: '', value: 5 }, { label: '  ', value: 2 }],
  nonsense: [{ label: 'A', value: NaN }, { label: null, value: Infinity }, { value: '12' }, null],
  long: [{ label: 'A label far too long to fit anywhere in a narrow chart', value: 3 }, { label: 'Short', value: 5 }],
};

/** What leaves the box: path points, arc extents, and every text's own box, in the chart's own coordinates. */
function outside(r, W, H, slack = 2) {
  const out = [];
  const inX = (x) => x >= -W / 2 - slack && x <= W / 2 + slack;
  const inY = (y) => y >= -H / 2 - slack && y <= H / 2 + slack;
  let lineWidth = 1;
  for (const c of r.calls) {
    if (c.name === 'lineWidth' && c.set) lineWidth = c.args[0];
    const local = c.m[4] === 960 && c.m[5] === 540 && c.m[0] === 1 && c.m[3] === 1;
    if (!local) continue;
    if (c.name === 'moveTo' || c.name === 'lineTo') {
      if (!inX(c.args[0]) || !inY(c.args[1])) out.push([c.name, c.args]);
    } else if (c.name === 'arc') {
      const [x, y, rad] = c.args;
      const e = rad + lineWidth / 2;
      if (!inX(x - e) || !inX(x + e) || !inY(y - e) || !inY(y + e)) out.push(['arc', c.args, lineWidth]);
    }
  }
  for (const t of r.texts) {
    const px = parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] ?? '10');
    const w = 0.55 * px * String(t.text).length;
    const left = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
    const top = t.base === 'middle' ? t.y - px / 2 : t.base === 'alphabetic' ? t.y - 0.8 * px : t.y;
    if (!inX(left) || !inX(left + w) || !inY(top) || !inY(top + px)) out.push(['text', t.text, Math.round(left), Math.round(top), Math.round(w), px]);
  }
  return out;
}

ok('the contract lists six charts', CHARTS.length === 6 && CHARTS.join() === 'bars,hbars,line,donut,ring,race', CHARTS);
{
  const bad = [];
  const empty = [];
  const escaped = [];
  for (const type of CHARTS) {
    for (const [name, data] of Object.entries(SETS)) {
      for (const lang of ['en', 'ar']) {
        for (const [w, h] of [[80, 50], [40, 60], [90, 22]]) {
          for (const t of [-1, 0, 0.3, 1.2, 3, 9.99, 10.5]) {
            const layer = chart({ chart: type, data, w, h, in: grow({ ease: 'back-out', d: 0.8 }), out: grow({ d: 0.5 }) });
            const r = draw(layer, t, { lang });
            if (r.problems.length) bad.push([type, name, lang, w, h, t, r.problems.slice(0, 2)]);
            if (t === 3 && !drewSomething(r.calls)) empty.push([type, name, lang, w, h]);
            const gone = outside(r, w * 10.8, h * 10.8);
            if (gone.length) escaped.push([type, name, lang, w, h, t, gone.slice(0, 2)]);
          }
        }
      }
    }
  }
  ok('every chart, every data set, English and Arabic, three box shapes, seven moments: nothing a browser rejects', bad.length === 0, bad.slice(0, 3));
  ok('...and every one draws something once it is in', empty.length === 0, empty.slice(0, 4));
  ok('...and nothing leaves the box: no point, no arc, no text', escaped.length === 0, escaped.slice(0, 3));
}
{
  // The reader turns a chart with no usable data into `data: []` rather than invent numbers.
  const noData = CHARTS.map((type) => draw(chart({ chart: type, data: [] }), 2));
  ok('no data: no call at all, nothing wrong', noData.every((r) => r.calls.length === 0 && !r.problems.length), noData.map((r) => r.calls.length));
  const missing = CHARTS.map((type) => draw(chart({ chart: type, data: undefined }), 2));
  ok('...and the same when data is not a list', missing.every((r) => r.calls.length === 0 && !r.problems.length));
  // fontsNeeded loads a chart's face at 600, the weight it has no field for: that must be the face drawn.
  const weights = new Set();
  for (const type of CHARTS) {
    for (const lang of ['en', 'ar']) {
      const r = draw(chart({ chart: type, data: lang === 'en' ? ABC : ARABIC }), 2, { lang });
      for (const c of r.calls) if (c.name === 'font' && c.set) weights.add(String(c.args[0]).split(' ')[0]);
    }
  }
  ok('every word of every chart is set at weight 600, the weight its font is loaded at', weights.size === 1 && weights.has('600'), [...weights]);
  const broken = CHARTS.map((type) => draw(chart({ chart: type, w: NaN, h: -4, size: NaN, thick: NaN, max: NaN, gap: NaN, unit: null, colors: [] }), 2));
  ok('a layer of nonsense numbers is still clean', broken.every((r) => !r.problems.length), broken.map((r) => r.problems.slice(0, 2)));
  const same = CHARTS.filter((type) => {
    const a = JSON.stringify(draw(chart({ chart: type, in: grow() }), 0.7).calls);
    return a === JSON.stringify(draw(chart({ chart: type, in: grow() }), 0.7).calls);
  });
  ok('the same moment twice is the same calls', same.length === CHARTS.length);
}

// ── one after another ─────────────────────────────────────────────────────
{
  const flat = [{ label: 'A', value: 50 }, { label: 'B', value: 50 }, { label: 'C', value: 50 }];
  for (const type of ['bars', 'hbars']) {
    const r = draw(chart({ chart: type, data: flat, gap: 0.3, in: grow() }), 0.75);
    const v = values(r).map((x) => num(x.text));
    ok(`${type}: at one moment the first datum has come further than the third`, v.length >= 2 && v[0] > v[v.length - 1] && (v.length < 3 || v[2] < 50), v);
  }
  // A line's point shows its value when the line reaches it.
  const early = values(draw(chart({ chart: 'line', data: flat, gap: 0.3, in: grow({ fx: 'draw' }) }), 0.75)).length;
  const late = values(draw(chart({ chart: 'line', data: flat, gap: 0.3, in: grow({ fx: 'draw' }) }), 3)).length;
  ok('line: the first point has its value before the third has', early >= 1 && early < 3 && late === 3, [early, late]);
  const later = draw(chart({ data: flat, gap: 0.3, in: grow() }), 3);
  ok('...and all have arrived once the last entrance is over', values(later).every((x) => num(x.text) === 50) && values(later).length === 3, values(later).map((x) => x.text));
  // A donut is one sweep: at any moment every segment but the last drawn is whole, and they follow each other round.
  const segs = (t) => draw(chart({ chart: 'donut', data: flat, gap: 0.3, in: grow({ fx: 'draw' }) }), t).calls
    .filter((c) => c.name === 'arc' && Math.abs(c.args[4] - c.args[3] - Math.PI * 2) > 1e-6).map((c) => [c.args[3], c.args[4]]);
  const whole = segs(3);
  const one = [0.2, 0.5, 0.8, 1.1].map(segs);
  const inOrder = one.every((list) => list.every(([a, b], i) => b > a && (i === 0 || a > list[i - 1][1])
    && (i === list.length - 1 || Math.abs(b - a - (whole[i][1] - whole[i][0])) < 1e-9)));
  ok('donut: one sweep clockwise from the top, the segments filling in order', whole.length === 3 && Math.abs(whole[0][0] + Math.PI / 2) < 0.1
    && inOrder && one[0].length < one[3].length, one.map((l) => l.length));
  const fade = draw(chart({ data: flat, gap: 0.4, in: grow({ fx: 'fade' }) }), 0.6);
  const alphas = labels(fade).map((x) => x.alpha);
  ok('a fade runs datum by datum too', alphas.length >= 2 && alphas[0] > alphas[alphas.length - 1], alphas);
}

// ── counting up, and never past the number ────────────────────────────────
{
  const one = [{ label: 'A', value: 100 }];
  const spring = chart({ data: one, in: grow({ ease: 'back-out', d: 1 }) });
  const shown = [0.04, 0.1, 0.2, 0.4, 0.6, 1.2].map((t) => num(values(draw(spring, t))[0]?.text));
  ok('a value counts up with its bar', shown[0] < shown[1] && shown[1] < shown[2] && shown[5] === 100, shown);
  ok('...and, on a curve that overshoots, never shows more than itself', shown.every((v) => v <= 100), shown);
  const tops = values(draw(chart({ data: [{ label: 'A', value: 100 }, { label: 'B', value: 50 }], max: 50 }), 2));
  ok('a value over max is drawn at the top of the scale, and labelled with its own number',
    tops.length === 2 && Math.abs(tops[0].y - tops[1].y) < 0.01 && num(tops[0].text) === 100, tops.map((x) => [x.text, x.y]));
  const below = values(draw(chart({ data: [{ label: 'A', value: 100 }, { label: 'B', value: 50 }], max: 200 }), 2));
  ok('...and a value under it is drawn in proportion', below.length === 2 && below[1].y > below[0].y, below.map((x) => [x.text, x.y]));
  const neg = values(draw(chart({ data: [{ label: 'A', value: -30 }, { label: 'B', value: 20 }] }), 2)).map((x) => x.text);
  ok('a negative value is drawn as zero length but labelled with its own number (never a false 0)', neg[0] === '-30' && neg[1] === '20', neg);
  const negBar = values(draw(chart({ data: [{ label: 'A', value: -30 }, { label: 'B', value: 20 }] }), 2));
  ok('...and sits at the baseline like a zero, level with a real zero', negBar.length === 2 && negBar[0].y >= negBar[1].y, negBar.map((x) => [x.text, x.y]));
  const halves = values(draw(chart({ data: [{ label: 'A', value: 2.5 }, { label: 'B', value: 4 }] }), 2)).map((x) => x.text);
  const whole = values(draw(chart({ data: [{ label: 'A', value: 1234567 }, { label: 'B', value: 4 }] }), 2)).map((x) => x.text);
  ok('one decimal when the data need it, none when they do not, thousands grouped', halves.join() === '2.5,4.0' && whole.join() === '1,234,567,4', [halves, whole]);
  const unit = values(draw(chart({ data: [{ label: 'A', value: 45 }], unit: '%' }), 2)).map((x) => x.text);
  const word = values(draw(chart({ data: [{ label: 'A', value: 45 }], unit: 'users' }), 2)).map((x) => x.text);
  ok('a sign follows its number; a word stands apart', unit[0] === '45%' && word[0] === '45 users', [unit, word]);
  const pct = values(draw(chart({ data: [{ label: 'أ', value: 45 }], unit: '%' }), 2, { lang: 'ar' })).map((x) => x.text);
  ok('a % written once for every language becomes the Arabic sign after Arabic-Indic digits', pct.length === 1 && pct[0].endsWith(String.fromCharCode(0x066a)) && num(pct[0]) === 45, pct);
  const arabic = values(draw(chart({ data: [{ label: 'أ', value: 1250 }] }), 2, { lang: 'ar' })).map((x) => x.text);
  ok('in Arabic the values are in Arabic-Indic digits with the Arabic separator', arabic.length === 1 && num(arabic[0]) === 1250 && !/[0-9]/.test(arabic[0]), arabic);
}

// ── right to left ─────────────────────────────────────────────────────────
{
  for (const type of ['bars', 'line']) {
    const en = labels(draw(chart({ chart: type }), 2));
    const ar = labels(draw(chart({ chart: type, data: ARABIC }), 2, { lang: 'ar' }));
    ok(`${type}: the first datum is on the left in English and on the right in Arabic`,
      en[0].x < 0 && ar[0].x > 0 && Math.abs(en[0].x + ar[0].x) < 1 && en[en.length - 1].x > 0, [en[0].x, ar[0].x]);
  }
  const en = draw(chart({ chart: 'hbars' }), 2);
  const ar = draw(chart({ chart: 'hbars', data: ARABIC }), 2, { lang: 'ar' });
  const [le, ve] = [labels(en)[0], values(en)[0]];
  const [la, va] = [labels(ar)[0], values(ar)[0]];
  ok('hbars: labels at the start side and values past the tip — left to right in English',
    le.x < 0 && ve.x > le.x && le.align === 'right' && ve.align === 'left', [le, ve]);
  ok('...and mirrored in Arabic: the bars grow from the right edge', la.x > 0 && va.x < la.x && la.align === 'left' && va.align === 'right', [la, va]);
  ok('hbars: the first datum is on top in both', labels(en)[0].y < labels(en)[3].y && labels(ar)[0].y < labels(ar)[3].y);
  const face = draw(chart({ data: [{ label: 'يناير', value: 3 }, { label: 'Feb', value: 4 }] }), 2);
  const fonts = labels(face).map((x) => x.font);
  ok('each label is set in the face for its own script', /Vylo Arabic/.test(fonts[0]) && !/Vylo Arabic/.test(fonts[1]), fonts);
  const dirs = face.calls.filter((c) => c.name === 'direction' && c.set).map((c) => c.args[0]);
  ok('...and in its own direction', dirs.includes('rtl') && dirs.includes('ltr'), dirs);
}

// ── what is written ───────────────────────────────────────────────────────
{
  const counts = [];
  const want = {
    bars: (l, v, n) => (l ? n : 0) + (v ? n : 0),
    hbars: (l, v, n) => (l ? n : 0) + (v ? n : 0),
    line: (l, v, n) => (l ? n : 0) + (v ? n : 0),
    // The legend's rows, then the middle: the largest datum's share and its label.
    donut: (l, v, n) => (l ? n : 0) + (v ? n : 0) + (v ? 1 : 0) + (l && v ? 1 : 0),
    ring: (l, v) => (l ? 1 : 0) + (v ? 1 : 0),
    // Its scale's tick numbers, in their own row above the bars, are counted apart (pro-templates-b checks them).
    race: (l, v, n) => (l ? n : 0) + (v ? n : 0),
  };
  for (const type of CHARTS) {
    for (const [l, v] of [[true, true], [true, false], [false, true], [false, false]]) {
      for (const data of [SETS.four, SETS.one, SETS.twelve]) {
        const r = draw(chart({ chart: type, labels: l, values: v, data, w: 90, h: 60 }), 2);
        const tickRow = Math.min(...r.texts.map((x) => x.y));
        const n = type === 'race' && v ? r.texts.filter((x) => x.y > tickRow + 1e-6).length : r.texts.length;
        const expect = want[type](l, v, data.length);
        if (n !== expect) counts.push([type, l, v, data.length, n, expect]);
      }
    }
  }
  ok('the texts written are exactly what labels and values ask for, for every chart', counts.length === 0, counts.slice(0, 5));
  const blank = draw(chart({ data: SETS.unlabelled }), 2);
  ok('an empty label writes nothing, its value still does', labels(blank).length === 0 && values(blank).length === 3, blank.texts.map((x) => x.text));
  const long = labels(draw(chart({ data: SETS.long }), 2));
  ok('a label too long for its room is shortened with an ellipsis', long.length === 2 && long[0].text.endsWith('…') && long[1].text === 'Short', long.map((x) => x.text));
}

// ── donut and ring ────────────────────────────────────────────────────────
{
  const d = draw(chart({ chart: 'donut', data: [{ label: 'Web', value: 30 }, { label: 'Mobile', value: 50 }, { label: 'Other', value: 20 }] }), 2);
  const mid = d.texts.find((x) => /%$/.test(x.text));
  const track = d.calls.find((c) => c.name === 'arc' && Math.abs(c.args[4] - c.args[3] - Math.PI * 2) < 1e-9);
  ok('donut: the largest share in the middle of the ring', mid && mid.text === '50%' && track && Math.abs(mid.x - track.args[0]) < 1e-9, d.texts.map((x) => x.text));
  const fillBefore = d.calls.slice(0, d.calls.findIndex((c) => c.name === 'fillText' && c.args[0] === '50%')).filter((c) => c.name === 'fillStyle').pop();
  ok('...and that colour is the segment\'s', fillBefore && fillBefore.args[0] === PALETTE.accent2, fillBefore?.args);
  const total = draw(chart({ chart: 'donut', unit: 'users', data: [{ label: 'Web', value: 30 }, { label: 'Mobile', value: 50 }] }), 2);
  ok('...or, when the values carry a unit of their own, their total', total.texts.some((x) => x.text === '80 users'), total.texts.map((x) => x.text));
  const arabic = draw(chart({ chart: 'donut', data: ARABIC }), 2, { lang: 'ar' });
  ok('...with the Arabic percent sign in Arabic', arabic.texts.some((x) => x.text.endsWith(String.fromCharCode(0x066a))), arabic.texts.map((x) => x.text));
  const sweep = (r) => r.calls.filter((c) => c.name === 'arc' && c.args[3] === -Math.PI / 2).map((c) => c.args[4] - c.args[3]).pop();
  const ring = (o, t = 3) => draw(chart({ chart: 'ring', thick: 4, ...o }), t);
  ok('ring: the first datum over max, swept from the top', Math.abs(sweep(ring({ data: [{ label: 'Done', value: 72 }], max: 100 })) - Math.PI * 2 * 0.72) < 1e-9);
  ok('ring: with no max, a value up to 100 is a percentage', Math.abs(sweep(ring({ data: [{ label: 'Done', value: 72 }] })) - Math.PI * 2 * 0.72) < 1e-9);
  ok('ring: a value over max fills it, and no more', Math.abs(sweep(ring({ data: [{ label: 'Done', value: 180 }], max: 120 })) - Math.PI * 2) < 1e-9);
  ok('ring: zero draws no arc, only the track', sweep(ring({ data: [{ label: 'Done', value: 0 }] })) === undefined && drewSomething(ring({ data: [{ label: 'Done', value: 0 }] }).calls));
  const growing = [0.2, 0.5, 0.9].map((t) => sweep(ring({ data: [{ label: 'Done', value: 72 }], in: grow({ fx: 'draw' }) }, t)));
  ok('ring: it sweeps in with its entrance', growing[0] < growing[1] && growing[1] < growing[2], growing);
  const caps = ring({ data: [{ label: 'Done', value: 50 }] }).calls.filter((c) => c.name === 'lineCap' && c.set).map((c) => c.args[0]);
  ok('ring: its ends are round', caps.includes('round'));
}

// ── the line ──────────────────────────────────────────────────────────────
{
  const drawIn = grow({ fx: 'draw', d: 1 });
  const strokeEnd = (r) => {
    const i = r.calls.map((c) => c.name).lastIndexOf('stroke');
    const pts = r.calls.slice(0, i).filter((c) => c.name === 'lineTo' || c.name === 'moveTo');
    return pts[pts.length - 1]?.args[0];
  };
  const half = draw(chart({ chart: 'line', in: drawIn, gap: 0.05 }), 0.5);
  const done = draw(chart({ chart: 'line', in: drawIn, gap: 0.05 }), 3);
  const lastX = labels(done).pop().x;
  ok('line: it draws on from the first point toward the last', strokeEnd(half) < lastX - 50 && Math.abs(strokeEnd(done) - lastX) < 1, [strokeEnd(half), strokeEnd(done), lastX]);
  const rtl = draw(chart({ chart: 'line', data: ARABIC, in: drawIn, gap: 0.05 }), 0.5, { lang: 'ar' });
  ok('...from the right in Arabic', strokeEnd(rtl) > -strokeEnd(half) - 1 && strokeEnd(rtl) < 0 + 800, [strokeEnd(rtl)]);
  const joins = done.calls.filter((c) => (c.name === 'lineJoin' || c.name === 'lineCap') && c.set).map((c) => c.args[0]);
  ok('line: round joins and caps', joins.includes('round'));
  const dots = done.calls.filter((c) => c.name === 'arc').length;
  ok('line: a dot at every point', dots >= 2 * ABC.length, dots);
}

// ── the layer's opacity ───────────────────────────────────────────────────
{
  const over = CHARTS.filter((type) => draw(chart({ chart: type }), 2, { alpha: 0.35 }).calls.some((c) => c.alpha > 0.35 + 1e-9));
  ok('nothing is drawn above the layer\'s opacity', over.length === 0, over);
}

// ── one layout at every output size ───────────────────────────────────────
//
// SF Pro sets a word wider, for its size, the smaller it is set (optical
// sizes), so labels measured at the size they were drawn were sized, cut
// short and placed differently in the stage's small preview and the export.
// The measure below widens small text the same way; drawn through paint at
// k = 0.4, 1 and 4, every label and value must be the same text (the same
// ellipsis), the same size, the same width and in the same place, in u.
{
  const optical = (s, px) => Array.from(s).length * 0.55 * px * (1 + (0.3 * 10) / (px + 10));
  const FULL = { landscape: [1920, 1080], portrait: [1080, 1920] };
  const LABELS = {
    en: [['Q1', 'Q2', 'Q3', 'Q4'], ['Subscriptions revenue', 'Enterprise licences sold', 'Consulting and training services', 'Other']],
    ar: [['يناير', 'فبراير', 'مارس', 'أبريل'], ['إيرادات الاشتراكات الشهرية', 'تراخيص المؤسسات المباعة', 'خدمات الاستشارات والتدريب', 'أخرى']],
    ckb: [['کانوونی دووەم', 'شوبات', 'ئازار', 'نیسان'], ['داهاتی بەشداربوونی مانگانە', 'مۆڵەتی کۆمپانیاکان', 'خزمەتگوزاریی ڕاوێژکاری و ڕاهێنان', 'هیتر']],
    kmr: [['چلێ', 'شباتێ', 'ئادارێ', 'نیسانێ'], ['داهاتا بەشداربوونا هەیڤانە', 'مۆلەتێن کۆمپانیایان', 'خزمەتگوزاریێن ڕاوێژکاریێ و ڕاهێنانێ', 'دی']],
  };
  const VALUES = [40, 65.5, 52, 1290];
  const fontPx = (font) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(font))?.[1] ?? '10');
  /** Every text a chart layer writes when painted alone at pixels-per-u `k`: what, how big and how wide (u), and where (u from the box's centre). */
  const shot = (paint, doc, t, k) => {
    const [W0, H0] = FULL[doc.format];
    const W = Math.max(1, Math.round((W0 * k) / 10.8));
    const H = Math.max(1, Math.round((H0 * k) / 10.8));
    const { ctx, calls, check } = makeCanvas(W, H, { measure: optical });
    paint(ctx, doc, t, { strict: true });
    const kk = Math.min(W, H) / 100;
    const cx = W / 2;
    const cy = H / 2;
    let font = '10px sans-serif';
    const out = [];
    for (const c of calls) {
      if (c.name === 'font' && c.set) font = c.args[0];
      if (c.name !== 'fillText') continue;
      const [, x, y] = c.args;
      const s = Math.sqrt(Math.abs(c.m[0] * c.m[3] - c.m[1] * c.m[2]));
      const px = fontPx(font);
      out.push({
        text: c.args[0], size: (px * s) / kk, width: (optical(c.args[0], px) * s) / kk,
        u: (c.m[0] * x + c.m[2] * y + c.m[4] - cx) / kk, v: (c.m[1] * x + c.m[3] * y + c.m[5] - cy) / kk,
      });
    }
    return { texts: out, problems: check() };
  };
  const same = (a, b) => a.length === b.length && a.every((p, i) => p.text === b[i].text
    && Math.abs(p.size - b[i].size) <= 1e-9 * Math.max(1, p.size) && Math.abs(p.width - b[i].width) <= 1e-9 * Math.max(1, p.width)
    && Math.abs(p.u - b[i].u) < 1e-6 && Math.abs(p.v - b[i].v) < 1e-6);
  const bad = [];
  let charts = 0;
  let texts = 0;
  let cut = 0;
  const { paint } = await import('../.test-build/motiondraw.js');
  for (const kind of CHARTS) for (const lang of Object.keys(LABELS)) for (const [set, labels] of LABELS[lang].entries()) {
    for (const unit of ['', '%', 'users']) for (const format of ['landscape', 'portrait']) {
      const layer = chart({
        chart: kind, w: format === 'portrait' ? 46 : 64, h: 40, size: 3, unit, in: grow({ d: 1.2 }), gap: 0.15,
        data: labels.map((label, i) => ({ label, value: VALUES[i] })),
      });
      const doc = { ...docOf(lang), format, layers: [layer] };
      for (const t of [0.7, 3]) {
        const shots = [0.4, 1, 4].map((k) => shot(paint, doc, t, k));
        charts += 1;
        texts += shots[0].texts.length;
        cut += shots[0].texts.filter((x) => x.text.endsWith('…')).length;
        for (const s of shots) if (s.problems.length) bad.push(`${kind} ${lang} ${set ? 'long' : 'short'} ${unit || '-'} ${format} t=${t}: ${s.problems[0]}`);
        [1, 2].forEach((j) => {
          if (!same(shots[0].texts, shots[j].texts)) {
            const a = shots[0].texts;
            const b = shots[j].texts;
            const i = a.findIndex((p, n) => !b[n] || !same([p], [b[n]]));
            bad.push(`${kind} ${lang} ${set ? 'long' : 'short'} ${unit || '-'} ${format} t=${t} k=${[0.4, 1, 4][j]} vs 0.4: ${JSON.stringify(a[i] ?? a.length)} vs ${JSON.stringify(b[i] ?? b.length)}`);
          }
        });
      }
    }
  }
  ok(`every chart lays its labels and values out once, whatever the output size: at k = 0.4, 1 and 4 (a measure that widens small text) the same text, ellipsis, size, width and place in u — ${charts} charts (${CHARTS.join(', ')} x en/ar/ckb/kmr x short and long labels), ${texts} texts, ${cut} cut short`,
    bad.length === 0 && charts >= 200 && cut > 0, bad.slice(0, 4));

  // The contract itself: drawChart laid out at env.k / scale and drawn scaled.
  const direct = [0.4, 1, 4].map((k) => {
    const { ctx, calls } = makeCanvas(1920, 1080, { measure: optical });
    ctx.save();
    ctx.translate(960, 540);
    drawChart({ ...envOf(ctx, docOf('ckb'), 3), k }, chart({ data: LABELS.ckb[1].map((label, i) => ({ label, value: VALUES[i] })), unit: '%' }), POSE, k / 10.8);
    ctx.restore();
    let font = '';
    const out = [];
    for (const c of calls) {
      if (c.name === 'font' && c.set) font = c.args[0];
      if (c.name === 'fillText') {
        const s = Math.sqrt(Math.abs(c.m[0] * c.m[3] - c.m[1] * c.m[2]));
        out.push({ text: c.args[0], size: (fontPx(font) * s) / k, width: (optical(c.args[0], fontPx(font)) * s) / k, u: (c.m[0] * c.args[1] + c.m[2] * c.args[2] + c.m[4] - 960) / k, v: (c.m[1] * c.args[1] + c.m[3] * c.args[2] + c.m[5] - 540) / k });
      }
    }
    return out;
  });
  ok('drawChart with a scale lays the chart out at env.k / scale and draws it scaled: the same labels, sizes and places in u at k = 0.4, 1 and 4',
    direct[0].length > 4 && same(direct[0], direct[1]) && same(direct[0], direct[2]), direct.map((d) => d.slice(0, 2)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
