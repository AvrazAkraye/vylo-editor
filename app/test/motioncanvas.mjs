// A recording canvas for Node: the 2D context motiondraw.ts, the backdrops,
// the charts and the templates draw into when a test runs them without a
// browser. Shared by every Motion test that draws.
//
//   import { makeCanvas, drewSomething } from './motioncanvas.mjs';
//   const { canvas, ctx, calls, check } = makeCanvas(1920, 1080);
//   paint(ctx, doc, 1.2, { strict: true });
//   check()            // → [] when nothing a browser would reject or ignore happened
//   drewSomething(calls)
//
// What matters: it needs no native code and answers like a browser —
// `measureText` is deterministic (0.55 of the font size per UTF-16 unit, a font
// box of 0.8/0.2 of the size), `save`/`restore` really save and restore the
// state and the transform, `getTransform` tracks every translate/rotate/scale,
// and a value a browser would ignore (an alpha of 2, a colour of "", a line
// width of 0) is ignored here too — and reported. `check()` lists what would
// go wrong in the app's real engine: a non-finite number anywhere, a restore
// with nothing saved, a save never restored, a style that is not a colour or a
// gradient, an alpha outside [0, 1], a gradient stop outside [0, 1], a negative
// radius (browsers throw on it), a composite or enum a browser would ignore,
// and `filter` or `fontKerning`, which WebKit does not have.
//
// Each call is recorded as `{ name, args, m, alpha, depth }`: `m` is the
// transform `[a, b, c, d, e, f]` in force when it was made, `alpha` the
// globalAlpha, `depth` how many saves deep. A property set is recorded the same
// way with `set: true` and `args: [value]`.
//
// Engines differ; `opts` makes this one match another:
//   { letterSpacing: false }   no ctx.letterSpacing (older WebKit)
//   { conic: false }           no createConicGradient
//   { roundRect: false }       no roundRect
//   { metrics: 'actual' }      no fontBoundingBox* (only actualBoundingBox*)
//   { metrics: 'none' }        neither — width only
//   { measure: (text, px) => width }   widths of your own, e.g. digits of
//                              different widths to prove a counter is tabular
//   { ink: (text, px) => [ascent, descent] | null }   how far a string's own
//                              letters reach (actualBoundingBox*), e.g. an
//                              Arabic word's dots and tails; null keeps 0.72/0.18
//
// Importing this module also installs a fake global `Path2D` (it records its
// source string and every method call) and a fake `OffscreenCanvas` whose
// contexts record the same way; each one made is pushed to `offscreens`.

const DEFAULTS = {
  fillStyle: '#000000', strokeStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over',
  lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
  shadowBlur: 0, shadowColor: 'rgba(0, 0, 0, 0)', shadowOffsetX: 0, shadowOffsetY: 0,
  font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', direction: 'inherit',
  imageSmoothingEnabled: true, imageSmoothingQuality: 'low', letterSpacing: '0px', wordSpacing: '0px',
};

const NUMERIC = new Set(['globalAlpha', 'lineWidth', 'lineDashOffset', 'miterLimit', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY']);
const STYLES = new Set(['fillStyle', 'strokeStyle', 'shadowColor']);
const ENUMS = {
  globalCompositeOperation: ['source-over', 'source-in', 'source-out', 'source-atop', 'destination-over', 'destination-in',
    'destination-out', 'destination-atop', 'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
    'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'],
  textAlign: ['start', 'end', 'left', 'right', 'center'],
  textBaseline: ['top', 'hanging', 'middle', 'alphabetic', 'ideographic', 'bottom'],
  direction: ['ltr', 'rtl', 'inherit'],
  lineCap: ['butt', 'round', 'square'],
  lineJoin: ['round', 'bevel', 'miter'],
  imageSmoothingQuality: ['low', 'medium', 'high'],
};
/** Properties the app's engine (WebKit) does not have: setting one does nothing there. */
const NOT_IN_WEBKIT = ['filter', 'fontKerning'];

const METHODS = [
  'save', 'restore', 'scale', 'rotate', 'translate', 'transform', 'setTransform', 'resetTransform', 'getTransform',
  'createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern',
  'clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'bezierCurveTo',
  'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fill', 'stroke', 'clip',
  'isPointInPath', 'isPointInStroke', 'fillText', 'strokeText', 'measureText', 'drawImage',
  'createImageData', 'getImageData', 'putImageData', 'setLineDash', 'getLineDash', 'reset',
];

const DRAWS = new Set(['fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'fillRect', 'strokeRect']);

const GRADIENT = Symbol('gradient');
const PATTERN = Symbol('pattern');

/** A CSS colour as far as a test can tell without a browser: non-empty, no leaked "NaN" or "undefined", well-formed hex and functions. */
function colourProblem(s) {
  if (typeof s !== 'string') return `not a string (${typeof s})`;
  const v = s.trim();
  if (!v) return 'an empty string, which a browser ignores';
  if (/nan|undefined|null|infinity|\[object/i.test(v)) return `"${v}" has a leaked value in it`;
  if (v[0] === '#') return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ? '' : `"${v}" is not a hex colour`;
  if (v.includes('(')) {
    const m = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(([^()]*)\)$/i.exec(v);
    if (!m) return `"${v}" is not a colour function`;
    const nums = m[2].split(/[\s,/]+/).filter(Boolean).map((x) => parseFloat(x));
    return nums.length >= 3 && nums.every(Number.isFinite) ? '' : `"${v}" has a non-number in it`;
  }
  return /^[a-z]+$/i.test(v) ? '' : `"${v}" is not a colour`;
}

/** Every number inside a value, arrays and matrix-like objects included. */
function numbersIn(x, out = []) {
  if (typeof x === 'number') out.push(x);
  else if (Array.isArray(x)) for (const y of x) numbersIn(y, out);
  else if (x && typeof x === 'object' && 'a' in x && 'f' in x && !x[GRADIENT]) for (const k of 'abcdef') numbersIn(x[k], out);
  return out;
}

function fontPx(font) {
  const m = /(\d+(?:\.\d+)?|\.\d+)(px|pt)\b/.exec(String(font));
  if (!m) return 10;
  return m[2] === 'pt' ? parseFloat(m[1]) * 4 / 3 : parseFloat(m[1]);
}

/** A 2D affine matrix as the canvas keeps it: [a, b, c, d, e, f]. */
function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function matrixObject(m) {
  const [a, b, c, d, e, f] = m;
  return {
    a, b, c, d, e, f, m11: a, m12: b, m21: c, m22: d, m41: e, m42: f, is2D: true,
    isIdentity: a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0,
    inverse() {
      const det = a * d - b * c;
      if (!det) return matrixObject([NaN, NaN, NaN, NaN, NaN, NaN]);
      return matrixObject([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]);
    },
    transformPoint(p) {
      const x = p?.x ?? 0, y = p?.y ?? 0;
      return { x: a * x + c * y + e, y: b * x + d * y + f, z: 0, w: 1 };
    },
  };
}

class FakeGradient {
  constructor(kind, args, report) {
    this[GRADIENT] = true;
    this.kind = kind;
    this.args = args;
    this.stops = [];
    this.report = report;
  }

  addColorStop(offset, color) {
    if (!Number.isFinite(offset) || offset < 0 || offset > 1) this.report(`addColorStop offset ${offset} is outside [0, 1] (a browser throws)`);
    const bad = colourProblem(color);
    if (bad) this.report(`addColorStop colour: ${bad}`);
    this.stops.push([offset, color]);
  }
}

/** Path2D for Node: keeps its source string and every call, so a test can see what outline was built. */
export class FakePath2D {
  constructor(arg) {
    this.ops = [];
    this.d = typeof arg === 'string' ? arg : arg instanceof FakePath2D ? arg.d : undefined;
    if (arg instanceof FakePath2D) this.ops = arg.ops.slice();
  }

  addPath(p) { this.ops.push(['addPath', [p]]); }
}
for (const name of ['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'closePath']) {
  FakePath2D.prototype[name] = function (...args) { this.ops.push([name, args]); };
}

/** Problems inside a Path2D handed to fill/stroke/clip: non-finite numbers, and "NaN" written into its source. */
function pathProblems(p) {
  const out = [];
  if (!(p instanceof FakePath2D)) return out;
  if (p.d !== undefined && /nan|infinity|undefined/i.test(p.d)) out.push(`Path2D source has a non-number: ${p.d.slice(0, 80)}`);
  for (const [name, args] of p.ops) {
    if (numbersIn(args).some((n) => !Number.isFinite(n))) out.push(`Path2D.${name}: non-finite argument`);
  }
  return out;
}

/** Every OffscreenCanvas made since this module loaded, so a test can check the scratch canvases too. */
export const offscreens = [];

/** OffscreenCanvas for Node: its 2D context records like `makeCanvas`'s, into `canvas.rec`. */
export class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.rec = null;
    offscreens.push(this);
  }

  getContext(kind) {
    if (kind !== '2d') return null;
    if (!this.rec) this.rec = record(this, {});
    return this.rec.ctx;
  }
}

function record(canvas, opts) {
  const calls = [];
  const problems = [];
  const absent = new Set(NOT_IN_WEBKIT);
  if (opts.letterSpacing === false) { absent.add('letterSpacing'); absent.add('wordSpacing'); }
  if (opts.conic === false) absent.add('createConicGradient');
  if (opts.roundRect === false) absent.add('roundRect');
  let state = { ...DEFAULTS };
  let m = [1, 0, 0, 1, 0, 0];
  let dash = [];
  const stack = [];
  const report = (what) => problems.push(what);
  const note = (name, args, extra) => {
    const c = { name, args, m: m.slice(), alpha: state.globalAlpha, depth: stack.length };
    if (extra) Object.assign(c, extra);
    calls.push(c);
    return c;
  };
  const finiteArgs = (name, args) => {
    const bad = numbersIn(args).some((n) => !Number.isFinite(n));
    if (bad) report(`${name}: non-finite argument ${JSON.stringify(args.map((a) => (typeof a === 'number' ? String(a) : typeof a)))}`);
    return !bad;
  };
  const style = (v) => v && typeof v === 'object' && (v[GRADIENT] || v[PATTERN]);

  const methods = {
    save() { note('save', []); stack.push({ state: { ...state }, m: m.slice(), dash: dash.slice() }); },
    restore() {
      note('restore', []);
      const top = stack.pop();
      if (!top) { report('restore without a save'); return; }
      state = top.state; m = top.m; dash = top.dash;
    },
    translate(x, y) { note('translate', [x, y]); if (finiteArgs('translate', [x, y])) m = multiply(m, [1, 0, 0, 1, x, y]); },
    scale(x, y) { note('scale', [x, y]); if (finiteArgs('scale', [x, y])) m = multiply(m, [x, 0, 0, y, 0, 0]); },
    rotate(r) {
      note('rotate', [r]);
      if (finiteArgs('rotate', [r])) m = multiply(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
    },
    transform(...a) { note('transform', a); if (finiteArgs('transform', a)) m = multiply(m, a.slice(0, 6)); },
    setTransform(...a) {
      note('setTransform', a);
      const v = a.length === 0 ? [1, 0, 0, 1, 0, 0] : typeof a[0] === 'object' ? 'abcdef'.split('').map((k) => a[0][k] ?? (k === 'a' || k === 'd' ? 1 : 0)) : a.slice(0, 6);
      if (finiteArgs('setTransform', v)) m = v;
    },
    resetTransform() { note('resetTransform', []); m = [1, 0, 0, 1, 0, 0]; },
    getTransform() { note('getTransform', []); return matrixObject(m); },
    createLinearGradient(...a) { note('createLinearGradient', a); finiteArgs('createLinearGradient', a); return new FakeGradient('linear', a, report); },
    createRadialGradient(...a) {
      note('createRadialGradient', a);
      finiteArgs('createRadialGradient', a);
      if (a[2] < 0 || a[5] < 0) report(`createRadialGradient: negative radius (a browser throws) ${a}`);
      return new FakeGradient('radial', a, report);
    },
    createConicGradient(...a) { note('createConicGradient', a); finiteArgs('createConicGradient', a); return new FakeGradient('conic', a, report); },
    createPattern(...a) { note('createPattern', a); return { [PATTERN]: true, setTransform() {} }; },
    arc(...a) {
      note('arc', a);
      finiteArgs('arc', a);
      if (a[2] < 0) report(`arc: negative radius ${a[2]} (a browser throws)`);
    },
    ellipse(...a) {
      note('ellipse', a);
      finiteArgs('ellipse', a);
      if (a[2] < 0 || a[3] < 0) report(`ellipse: negative radius (a browser throws) ${a}`);
    },
    roundRect(...a) {
      note('roundRect', a);
      finiteArgs('roundRect', a);
      const r = numbersIn(a.slice(4));
      if (r.some((x) => x < 0)) report(`roundRect: negative radius (a browser throws) ${a}`);
    },
    fill(...a) { note('fill', a); for (const p of pathProblems(a[0])) report(p); },
    stroke(...a) { note('stroke', a); for (const p of pathProblems(a[0])) report(p); },
    clip(...a) { note('clip', a); for (const p of pathProblems(a[0])) report(p); },
    isPointInPath(...a) { note('isPointInPath', a); return false; },
    isPointInStroke(...a) { note('isPointInStroke', a); return false; },
    fillText(...a) {
      note('fillText', a);
      finiteArgs('fillText', a.slice(1));
      if (a[0] === undefined || a[0] === null) report(`fillText: text is ${a[0]}`);
    },
    strokeText(...a) {
      note('strokeText', a);
      finiteArgs('strokeText', a.slice(1));
      if (a[0] === undefined || a[0] === null) report(`strokeText: text is ${a[0]}`);
    },
    measureText(text) {
      note('measureText', [text]);
      const s = String(text ?? '');
      const px = fontPx(state.font);
      const ls = /^(-?\d+(?:\.\d+)?)(px|em)$/.exec(String(state.letterSpacing ?? '0px'));
      const spacing = absent.has('letterSpacing') || !ls ? 0 : ls[2] === 'em' ? parseFloat(ls[1]) * px : parseFloat(ls[1]);
      const own = typeof opts.measure === 'function' ? Number(opts.measure(s, px)) : NaN;
      const width = (Number.isFinite(own) ? own : 0.55 * px * s.length) + spacing * s.length;
      const r = { width };
      if (opts.metrics !== 'none') {
        const ink = typeof opts.ink === 'function' ? opts.ink(s, px) : null;
        Object.assign(r, {
          actualBoundingBoxAscent: ink ? ink[0] : s ? 0.72 * px : 0, actualBoundingBoxDescent: ink ? ink[1] : s ? 0.18 * px : 0,
          actualBoundingBoxLeft: 0, actualBoundingBoxRight: width,
        });
      }
      if (opts.metrics !== 'none' && opts.metrics !== 'actual') {
        Object.assign(r, { fontBoundingBoxAscent: 0.8 * px, fontBoundingBoxDescent: 0.2 * px });
      }
      return r;
    },
    drawImage(...a) {
      note('drawImage', a);
      if (!a[0]) report('drawImage: no image');
      finiteArgs('drawImage', a.slice(1));
    },
    createImageData(w, h) { note('createImageData', [w, h]); return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4) || 0) }; },
    getImageData(x, y, w, h) { note('getImageData', [x, y, w, h]); return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4) || 0) }; },
    setLineDash(seg) {
      note('setLineDash', [seg]);
      if (!Array.isArray(seg)) { report('setLineDash: not an array'); return; }
      if (seg.some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) { report(`setLineDash: ${JSON.stringify(seg)} is ignored by a browser`); return; }
      dash = seg.length % 2 ? seg.concat(seg) : seg.slice();
    },
    getLineDash() { note('getLineDash', []); return dash.slice(); },
    reset() { note('reset', []); state = { ...DEFAULTS }; m = [1, 0, 0, 1, 0, 0]; dash = []; stack.length = 0; },
  };
  for (const name of METHODS) {
    if (!methods[name]) methods[name] = (...a) => { note(name, a); finiteArgs(name, a); };
  }

  const setProp = (prop, value) => {
    note(prop, [value], { set: true });
    if (NOT_IN_WEBKIT.includes(prop)) { report(`set ${prop}, which WebKit does not have`); return; }
    if (absent.has(prop)) return;
    if (NUMERIC.has(prop)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) { report(`${prop} = ${value}: not a finite number (ignored)`); return; }
      if (prop === 'globalAlpha' && (value < 0 || value > 1)) { report(`globalAlpha = ${value}: outside [0, 1] (ignored)`); return; }
      if ((prop === 'lineWidth' || prop === 'miterLimit') && value <= 0) { report(`${prop} = ${value}: not above 0 (ignored)`); return; }
      if (prop === 'shadowBlur' && value < 0) { report(`shadowBlur = ${value}: negative (ignored)`); return; }
    } else if (STYLES.has(prop)) {
      if (!style(value)) {
        const bad = colourProblem(value);
        if (bad) { report(`${prop}: ${bad}`); return; }
      }
    } else if (ENUMS[prop]) {
      if (!ENUMS[prop].includes(value)) { report(`${prop} = ${JSON.stringify(value)}: not a value a browser takes (ignored)`); return; }
    } else if (prop === 'font') {
      if (typeof value !== 'string' || !/(\d|\.\d)(px|pt|em|rem)\b/.test(value)) { report(`font = ${JSON.stringify(value)}: has no size (ignored)`); return; }
      if (/nan|undefined|infinity/i.test(value)) { report(`font = ${JSON.stringify(value)}: has a leaked value in it (ignored)`); return; }
    } else if (prop === 'letterSpacing' || prop === 'wordSpacing') {
      if (typeof value !== 'string' || !/^-?(\d+(\.\d+)?|\.\d+)(px|em|rem)$/.test(value)) { report(`${prop} = ${JSON.stringify(value)}: not a length (ignored)`); return; }
    }
    state[prop] = value;
  };

  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'canvas') return canvas;
      if (typeof prop === 'symbol' || absent.has(prop)) return undefined;
      if (Object.prototype.hasOwnProperty.call(methods, prop)) return methods[prop];
      if (Object.prototype.hasOwnProperty.call(state, prop)) return state[prop];
      return undefined;
    },
    set(_, prop, value) {
      if (typeof prop === 'symbol') return true;
      setProp(prop, value);
      return true;
    },
    has(_, prop) {
      if (prop === 'canvas') return true;
      if (typeof prop === 'symbol' || absent.has(prop)) return false;
      return Object.prototype.hasOwnProperty.call(methods, prop) || Object.prototype.hasOwnProperty.call(DEFAULTS, prop);
    },
  });

  const check = () => {
    const out = problems.slice();
    if (stack.length) out.push(`save/restore unbalanced: ${stack.length} save(s) never restored`);
    return out;
  };
  return { ctx, calls, check, problems };
}

/**
 * A canvas of `width` x `height` with a recording 2D context. `check()` lists
 * what a browser would reject or ignore; an empty list is a clean frame.
 */
export function makeCanvas(width, height, opts = {}) {
  const canvas = { width, height, getContext: (kind) => (kind === '2d' ? rec.ctx : null) };
  const rec = record(canvas, opts);
  canvas.rec = rec;
  return { canvas, ctx: rec.ctx, calls: rec.calls, check: rec.check };
}

/** Whether any call put paint on the canvas: a fill, a stroke, text, an image or a filled rectangle. */
export function drewSomething(calls) {
  return calls.some((c) => DRAWS.has(c.name));
}

if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = FakePath2D;
if (typeof globalThis.OffscreenCanvas === 'undefined') globalThis.OffscreenCanvas = FakeOffscreenCanvas;
