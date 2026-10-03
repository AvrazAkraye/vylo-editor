// A recording fake AudioContext for Node: what audiofx.ts's graph builders
// and audioauto.ts's `compile` are run against in test/pro-audio.test.mjs.
//
//   import { FakeAudioContext, simulate } from './audiofake.mjs';
//   const ctx = new FakeAudioContext(48000);
//   const node = buildFx(ctx, fx);
//   ctx.edges()                        → ['gain#1 -> iir#2', ...]
//   simulate(ctx, node.input, node.output, channels)   → Float32Array[]
//
// It does three things, and each is there because a weaker fake would let a
// wrong builder pass:
//
// 1. **Records.** Every node made, every `connect`, every AudioParam call,
//    in order, so a test can say "the delay feeds the feedback gain, which
//    feeds the delay" and "normalize was turned off before the buffer was
//    set".
//
// 2. **Plays an AudioParam timeline the way the Web Audio specification
//    defines it.** `setValueAtTime`, `linearRampToValueAtTime`,
//    `exponentialRampToValueAtTime` (which holds its start value when the two
//    ends are not both non-zero with one sign), `setValueCurveAtTime` (values
//    joined by straight lines over the duration, the current spec), and
//    `cancelScheduledValues`. A ramp starts from the end of the event before
//    it; a curve ends at its last value. `param.valueAt(t)` answers.
//    `{ strictCurves: true }` refuses, with a NotSupportedError, any event that
//    lands inside a value curve's span or on either of its ends, and any curve
//    with an event inside or on the ends of its span: stricter than any
//    engine, so a test can prove `compile`'s fallback.
//
// 3. **Runs the graph**, one sample at a time, per channel, by the semantics
//    of the nodes the builders use: GainNode (times its gain's value at the
//    sample's time), DelayNode (the input `delayTime x rate` samples ago),
//    IIRFilterNode (the difference equation, normalised by the first feedback
//    coefficient), ConvolverNode (direct convolution with the buffer's
//    channel, or channel 0 for a mono buffer; `normalize` must be false: this
//    fake does not model the browser's normalisation and refuses to run a
//    convolver that asks for it). A DynamicsCompressorNode cannot be run: its
//    algorithm is the browser's own, which is why the builders mark it
//    `exact: false`.
//
//    **A cycle is refused.** The first version of this fake played a
//    feedback loop through a DelayNode the way the specification reads, and
//    so passed a delay builder that the app's WebKit plays differently: there,
//    every trip round a loop adds a 128-sample render quantum (measured:
//    an echo asked for at 48 samples returns at 48, then 224), and Chromium
//    clamps the delay in a loop to 128 instead. Engines disagree about loops,
//    so the builders make none, and this refuses to run one.

let nextId = 1;

export class FakeParam {
  constructor(owner, name, value, opts) {
    this.owner = owner;
    this.name = name;
    this.value = value;
    this.events = [];
    this.calls = [];
    this.opts = opts;
  }
  #insideCurve(time) {
    if (!this.opts.strictCurves) return false;
    return this.events.some((e) => e.kind === 'curve' && time >= e.time && time <= e.time + e.duration);
  }
  #add(e) {
    if (!Number.isFinite(e.time) || e.time < 0) throw new RangeError(`${this.name}: bad time ${e.time}`);
    if (e.kind !== 'curve' && this.#insideCurve(e.time)) throw Object.assign(new Error('NotSupportedError: inside a curve'), { name: 'NotSupportedError' });
    // Stable: after the events at the same time, before later ones.
    let at = this.events.length;
    while (at > 0 && this.events[at - 1].time > e.time) at--;
    this.events.splice(at, 0, e);
  }
  setValueAtTime(value, time) {
    this.calls.push(['setValueAtTime', value, time]);
    this.#add({ kind: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value, time) {
    this.calls.push(['linearRampToValueAtTime', value, time]);
    this.#add({ kind: 'ramp', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value, time) {
    this.calls.push(['exponentialRampToValueAtTime', value, time]);
    if (value === 0) throw new RangeError('exponential ramp to 0');
    this.#add({ kind: 'exp', value, time });
    return this;
  }
  setValueCurveAtTime(values, time, duration) {
    this.calls.push(['setValueCurveAtTime', Float32Array.from(values), time, duration]);
    if (!(values.length >= 2) || !(duration > 0)) throw new RangeError('bad curve');
    if (this.opts.strictCurves) {
      const end = time + duration;
      const clash = this.events.some((e) => (e.time >= time && e.time <= end) || (e.kind === 'curve' && time <= e.time + e.duration && end >= e.time));
      if (clash) throw Object.assign(new Error('NotSupportedError: curve overlaps'), { name: 'NotSupportedError' });
    }
    this.#add({ kind: 'curve', values: Float32Array.from(values), time, duration });
    return this;
  }
  cancelScheduledValues(time) {
    this.calls.push(['cancelScheduledValues', time]);
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
  /** The parameter's value at context time t, per the Web Audio timeline rules. */
  valueAt(t) {
    let prevT = 0;
    let prevV = this.value;
    for (const e of this.events) {
      if (e.kind === 'set') {
        if (t < e.time) return prevV;
        prevT = e.time; prevV = e.value;
      } else if (e.kind === 'ramp' || e.kind === 'exp') {
        if (t < e.time) {
          const x = (t - prevT) / (e.time - prevT);
          if (e.kind === 'ramp') return prevV + (e.value - prevV) * x;
          if (prevV === 0 || prevV * e.value < 0) return prevV;
          return prevV * Math.pow(e.value / prevV, x);
        }
        prevT = e.time; prevV = e.value;
      } else {
        if (t < e.time) return prevV;
        const N = e.values.length;
        if (t < e.time + e.duration) {
          const pos = ((N - 1) / e.duration) * (t - e.time);
          const k = Math.floor(pos);
          if (k >= N - 1) return e.values[N - 1];
          return e.values[k] + (e.values[k + 1] - e.values[k]) * (pos - k);
        }
        prevT = e.time + e.duration; prevV = e.values[N - 1];
      }
    }
    return prevV;
  }
}

class FakeNode {
  constructor(ctx, kind) {
    this.ctx = ctx;
    this.kind = kind;
    this.id = nextId++;
    this.outs = new Set();
    this.ins = new Set();
    ctx.nodes.push(this);
    ctx.log.push(['create', this.label]);
  }
  get label() { return `${this.kind}#${this.id}`; }
  param(name, value) { return new FakeParam(this, name, value, this.ctx.opts); }
  connect(dest) {
    if (!(dest instanceof FakeNode)) throw new TypeError('connect: not a node');
    if (dest.ctx !== this.ctx) throw new Error('connect: another context');
    this.outs.add(dest);
    dest.ins.add(this);
    this.ctx.log.push(['connect', this.label, dest.label]);
    return dest;
  }
  disconnect(dest) {
    if (dest !== undefined) {
      if (!this.outs.has(dest)) throw Object.assign(new Error('InvalidAccessError: not connected'), { name: 'InvalidAccessError' });
      this.outs.delete(dest);
      dest.ins.delete(this);
      this.ctx.log.push(['disconnect', this.label, dest.label]);
      return;
    }
    for (const d of this.outs) d.ins.delete(this);
    this.outs.clear();
    this.ctx.log.push(['disconnect', this.label]);
  }
}

export class FakeBuffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(c) { return this.data[c]; }
}

export class FakeAudioContext {
  constructor(sampleRate = 48000, opts = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.opts = opts;
    this.nodes = [];
    this.log = [];
  }
  createGain() {
    const n = new FakeNode(this, 'gain');
    n.gain = n.param('gain', 1);
    return n;
  }
  createDelay(max = 1) {
    const n = new FakeNode(this, 'delay');
    n.maxDelayTime = max;
    n.delayTime = n.param('delayTime', 0);
    return n;
  }
  createIIRFilter(feedforward, feedback) {
    if (!feedback.length || feedback[0] === 0) throw new Error('InvalidStateError: feedback[0] is 0');
    if (feedforward.length > 20 || feedback.length > 20) throw new Error('NotSupportedError: too many coefficients');
    const n = new FakeNode(this, 'iir');
    n.feedforward = Array.from(feedforward);
    n.feedback = Array.from(feedback);
    return n;
  }
  createConvolver() {
    const n = new FakeNode(this, 'convolver');
    let buffer = null;
    let normalize = true;
    Object.defineProperty(n, 'normalize', {
      get: () => normalize,
      set: (v) => { normalize = v; this.log.push(['set', n.label, 'normalize', v]); },
    });
    Object.defineProperty(n, 'buffer', {
      get: () => buffer,
      set: (b) => { buffer = b; this.log.push(['set', n.label, 'buffer', b.numberOfChannels, b.length]); },
    });
    return n;
  }
  createDynamicsCompressor() {
    const n = new FakeNode(this, 'dynamics');
    n.threshold = n.param('threshold', -24);
    n.knee = n.param('knee', 30);
    n.ratio = n.param('ratio', 12);
    n.attack = n.param('attack', 0.003);
    n.release = n.param('release', 0.25);
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    if (!(channels >= 1) || !(length >= 1)) throw new Error('NotSupportedError: bad buffer');
    return new FakeBuffer(channels, length, sampleRate);
  }
  /** Every live connection as 'kind#id -> kind#id', sorted. */
  edges() {
    const out = [];
    for (const n of this.nodes) for (const d of n.outs) out.push(`${n.label} -> ${d.label}`);
    return out.sort();
  }
  /** The nodes of one kind, in the order they were made. */
  ofKind(kind) { return this.nodes.filter((n) => n.kind === kind); }
}

/**
 * The graph from `input` to `output` run over `signal` (planar Float32Arrays),
 * `n` samples (default the signal's length), one channel at a time.
 */
export function simulate(ctx, input, output, signal, n = signal[0]?.length ?? 0) {
  const sr = ctx.sampleRate;
  // Refuse a cycle anywhere upstream of the output (see the file comment).
  const state0 = new Map();
  const visit = (node, path) => {
    if (state0.get(node) === 'done') return;
    if (state0.get(node) === 'open') throw new Error(`a feedback loop through ${path.join(' <- ')}: engines play loops differently`);
    state0.set(node, 'open');
    for (const src of node.ins) visit(src, [...path, src.label]);
    state0.set(node, 'done');
  };
  visit(output, [output.label]);
  return signal.map((x, c) => {
    const y = new Float32Array(n);
    const state = new Map();
    const st = (node) => {
      let s = state.get(node);
      if (!s) {
        s = { hist: new Float64Array(n), xs: [], ys: [] };
        state.set(node, s);
      }
      return s;
    };
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const memo = new Map();
      const inputOf = (node) => {
        let sum = node === input ? (x[i] ?? 0) : 0;
        for (const src of node.ins) sum += out(src);
        return sum;
      };
      const out = (node) => {
        if (memo.has(node)) return memo.get(node);
        let v;
        if (node.kind === 'delay') {
          const D = Math.round(node.delayTime.valueAt(t) * sr);
          if (D < 1) throw new Error('a delay of less than one sample in a simulated graph');
          v = i - D >= 0 ? st(node).hist[i - D] : 0;
          memo.set(node, v);
          return v;
        }
        memo.set(node, NaN); // a cycle not broken by a delay shows up as NaN
        const inp = inputOf(node);
        if (node.kind === 'gain') v = inp * node.gain.valueAt(t);
        else if (node.kind === 'iir') {
          const s = st(node);
          const b = node.feedforward;
          const a = node.feedback;
          s.xs.unshift(inp);
          let acc = 0;
          for (let k = 0; k < b.length; k++) acc += b[k] * (s.xs[k] ?? 0);
          for (let k = 1; k < a.length; k++) acc -= a[k] * (s.ys[k - 1] ?? 0);
          v = acc / a[0];
          s.ys.unshift(v);
          s.xs.length = Math.min(s.xs.length, b.length);
          s.ys.length = Math.min(s.ys.length, a.length);
        } else if (node.kind === 'convolver') {
          if (node.normalize !== false) throw new Error('the fake does not model a normalising convolver');
          const s = st(node);
          s.hist[i] = inp;
          const buf = node.buffer;
          const ir = buf.getChannelData(buf.numberOfChannels === 1 ? 0 : Math.min(c, buf.numberOfChannels - 1));
          let acc = 0;
          for (let k = 0; k < ir.length && k <= i; k++) acc += ir[k] * s.hist[i - k];
          v = acc;
        } else {
          throw new Error(`cannot simulate a ${node.kind} node`);
        }
        v = Math.fround(v);
        memo.set(node, v);
        return v;
      };
      y[i] = out(output);
      // Each delay line takes in this sample's input after its output was read.
      for (const node of ctx.nodes) if (node.kind === 'delay' && (node.outs.size || node.ins.size)) st(node).hist[i] = inputOf(node);
    }
    return y;
  });
}
