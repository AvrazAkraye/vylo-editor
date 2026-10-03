// The audio library (work package 02, docs/pro/audio.md): audiocore.ts,
// loudness.ts, audioauto.ts, audiofx.ts, audioduck.ts.
//
// Correctness is the whole job of these modules, so nearly every assertion
// here is a known answer: a number the standard, the textbook or the design
// fixes in advance, computed in this file independently of the code under
// test, not a value read off a first run.
//
//   - loudness: the EBU Tech 3341 and 3342 signals, synthesised here. A
//     1 kHz stereo sine at -23 dBFS reads -23.0 LUFS; the gated programmes
//     read their loud part; steps of 10 dB read 10 LU apart; silence reads
//     -Infinity; the 3342 programmes read their loudness range. The
//     K-weighting coefficients at 48 kHz are the ones printed in BS.1770-4.
//     A tone whose samples peak at 0 dBFS between its crests reads +3 dBTP.
//   - filters: the cookbook's exact values at DC, the corner and Nyquist, and
//     the Butterworth magnitude through the bilinear transform at any
//     frequency; then a sine through the filter, measured.
//   - compressor: the static curve read off a square wave's settled level;
//     the attack and release reach 63.2% in one time constant.
//   - limiter: no sample past the ceiling, for anything; with true peak,
//     no oversampled point either.
//   - reverb: unit energy, a Schroeder decay matching the room's RT60,
//     uncorrelated sides, the same bytes on every build.
//   - delay: an impulse comes back at D, 2D, 3D with mix, mix·fb, mix·fb².
//   - automation: the curve's values; Web Audio's timeline (modelled in
//     audiofake.mjs) playing `compile`'s calls lands on `render`'s samples.
//   - ducking: the envelope's points and times.
//   - the graph builders: what they connect, and the simulated graph equal
//     to the offline path sample for sample.
//   - nothing returns NaN or Infinity for any input; the same input gives
//     the same bytes; the speed budgets of the brief, timed.
import { createHash } from 'node:crypto';
import {
  DB_FLOOR, finiteOr, clamp, dbToGain, gainToDb, mulberry32, seedFrom, frames, conform, interleave, deinterleave,
  mixdown, mixInto, fadeEdges, softClipSample, softClip, samplePeak, sampleRateOr, runBiquads, biquadResponseDb,
  intervalPeaks, truePeakOf, resampleLinear, resampleSinc, resample, fft, convolve,
} from '../.test-build/audiocore.js';
import {
  DELIVERY_LUFS, DELIVERY_CEILING_DB, kWeighting, measureLoudness, loudnessPlan, gainToTarget, normalizeLoudness,
} from '../.test-build/loudness.js';
import {
  AUTOMATION_VERSION, CURVES, VOLUME_RANGE, RATE_RANGE, MAX_LANES, MAX_POINTS, MAX_SECONDS, EXP_FLOOR,
  parseTarget, rangeOf, readLane, readAutomation, valueAt, render, planLane, compile,
} from '../.test-build/audioauto.js';
import {
  FX_TYPES, FX_SPECS, MAX_CHAIN, readFx, readChain, defaultFx, fxRangeResolver, eqSections, filterSections, fxResponseDb,
  compressorCurveDb, delaySamples, echoCount, reverbSeconds, reverbImpulse, renderChain, renderFx, chainEnvelopes,
  FX_PRESETS, PRESET_LABELS, presetChain, buildFx, buildChain,
} from '../.test-build/audiofx.js';
import {
  DUCK_DEFAULTS, readDuck, findSpeech, duckLaneFor, duckLane, applyLane, duckBed,
} from '../.test-build/audioduck.js';
import { FakeAudioContext, simulate } from './audiofake.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  cond ? pass++ : fail++;
};
const near = (a, b, tol) => Number.isFinite(a) && Math.abs(a - b) <= tol;
const timings = [];
/** The fastest of `runs` runs, in ms: nine packages build on this machine at once, and the budget is about the code, not the neighbours. */
const time = (runs, fn) => {
  let best = Infinity;
  let value;
  for (let r = 0; r < runs; r++) {
    const t = performance.now();
    value = fn();
    best = Math.min(best, performance.now() - t);
  }
  return { ms: best, value };
};

// ── signals ───────────────────────────────────────────────────────────────

const SR = 48000;
/** A sine of `f` Hz whose crest is at `db` dBFS, `secs` long; `fade` seconds of raised cosine at each end. */
function tone(f, db, secs, { sr = SR, phase = 0, fade = 0 } = {}) {
  const a = Math.pow(10, db / 20);
  const n = Math.round(secs * sr);
  const x = new Float32Array(n);
  const fn = Math.round(fade * sr);
  for (let i = 0; i < n; i++) {
    let v = a * Math.sin((2 * Math.PI * f * i) / sr + phase);
    if (fn && i < fn) v *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fn);
    if (fn && i >= n - fn) v *= 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / fn);
    x[i] = v;
  }
  return x;
}
const stereo = (x) => [x, Float32Array.from(x)];
const cat = (...xs) => {
  const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0));
  let at = 0;
  for (const x of xs) { out.set(x, at); at += x.length; }
  return out;
};
/** Seeded noise in -amp..amp (an LCG here, so the test does not lean on the code it tests). */
function noise(n, seed, amp = 0.5) {
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    x[i] = (s / 4294967296 - 0.5) * 2 * amp;
  }
  return x;
}
/** Something like music: a chord, filtered noise, and a beat that swells it twice a second. */
function music(secs, seed, sr = SR) {
  const n = Math.round(secs * sr);
  const x = new Float32Array(n);
  const w = noise(n, seed, 1);
  let p = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    p = 0.98 * p + 0.02 * w[i] * 5;
    const beat = Math.exp(-((t * 2) % 1) * 6);
    x[i] = 0.15 * (Math.sin(2 * Math.PI * 220 * t) + 0.7 * Math.sin(2 * Math.PI * 277.18 * t) + 0.5 * Math.sin(2 * Math.PI * 329.63 * t)) + 0.3 * beat * p;
  }
  return x;
}
/** A square of steady magnitude (every sample ±amp): what a peak detector reads as one level. */
function square(amp, n) {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = i % 2 ? amp : -amp;
  return x;
}
const hash = (chs) => {
  const h = createHash('sha256');
  for (const x of chs) h.update(Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  return h.digest('hex');
};
const allFinite = (chs) => chs.every((x) => x.every((v) => Number.isFinite(v)));
const maxAbs = (x, from = 0, to = x.length) => { let m = 0; for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i])); return m; };
const rmsOf = (x, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };
const dB = (v) => 20 * Math.log10(v);

// ── audiocore: numbers ────────────────────────────────────────────────────

console.log('audiocore');
ok('dB and gain: 0 dB is 1, -6.0206 dB is 1/2, +20 dB is 10', dbToGain(0) === 1 && near(dbToGain(-6.020599913279624), 0.5, 1e-12) && near(dbToGain(20), 10, 1e-12));
ok('dB and gain: -Infinity is silence, NaN is unity, +1000 dB is held at +120', dbToGain(-Infinity) === 0 && dbToGain(NaN) === 1 && dbToGain(1000) === 1e6);
ok('gain to dB: 1 is 0, 1/2 is -6.0206, a negative gain is its magnitude', gainToDb(1) === 0 && near(gainToDb(0.5), -6.020599913279624, 1e-12) && near(gainToDb(-2), 6.020599913279624, 1e-12));
ok('gain to dB: silence and NaN are the floor, -200, never -Infinity', gainToDb(0) === DB_FLOOR && gainToDb(NaN) === DB_FLOOR && gainToDb(1e-12) === -200);
ok('dB round trip from -120 to +40', [-120, -60, -23.5, -1, 0, 3.3, 40].every((d) => near(gainToDb(dbToGain(d)), d, 1e-9)));
ok('clamp: NaN reads as the low edge; crossed bounds keep the low one', clamp(NaN, 0, 1) === 0 && clamp(5, 0, 1) === 1 && clamp(-5, 0, 1) === 0 && clamp(3, 2, 1) === 2);
ok('finiteOr: a number, a numeric string; null, "", NaN and words are the fallback',
  finiteOr(3, 0) === 3 && finiteOr('2.5', 0) === 2.5 && finiteOr(null, 7) === 7 && finiteOr('', 7) === 7 && finiteOr(NaN, 7) === 7 && finiteOr('x', 7) === 7 && finiteOr([], 7) === 7);
ok('sample rates: NaN, 0 and negative are 48 kHz; the rest held to 1 kHz..768 kHz', sampleRateOr(NaN) === 48000 && sampleRateOr(0) === 48000 && sampleRateOr(-1) === 48000 && sampleRateOr(10) === 1000 && sampleRateOr(1e9) === 768000 && sampleRateOr(44100) === 44100);

{
  // mulberry32 against an independent copy of the published algorithm.
  const reference = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let same = true;
  for (const seed of [0, 1, 12345, 0xdeadbeef]) {
    const a = mulberry32(seed);
    const b = reference(seed >>> 0);
    for (let i = 0; i < 1000; i++) if (a() !== b()) same = false;
  }
  ok('mulberry32 is the published algorithm, value for value', same);
  const r = mulberry32(42);
  let sum = 0, lo = 1, hi = 0;
  for (let i = 0; i < 100000; i++) { const v = r(); sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v); }
  ok('mulberry32: in [0, 1), mean 0.5 over 100k draws', lo >= 0 && hi < 1 && near(sum / 100000, 0.5, 0.005), { mean: sum / 100000 });
  ok('mulberry32: a non-finite seed is seed 0', mulberry32(NaN)() === mulberry32(0)());
  const s = [seedFrom(1, 0, 0.5), seedFrom(1, 1, 0.5), seedFrom(2, 0, 0.5), seedFrom(1, 0, 0.501)];
  ok('seedFrom: the same numbers the same seed; any change another; all unsigned 32-bit',
    seedFrom(1, 0, 0.5) === s[0] && new Set(s).size === 4 && s.every((v) => Number.isInteger(v) && v >= 0 && v < 2 ** 32));
}

{
  const L = Float32Array.from([1, 2, 3]);
  const R = Float32Array.from([4, 5, 6]);
  const inter = interleave([L, R]);
  ok('interleave: L R L R', inter.join() === '1,4,2,5,3,6');
  const back = deinterleave(inter, 2);
  ok('deinterleave undoes it', back[0].join() === '1,2,3' && back[1].join() === '4,5,6');
  ok('deinterleave: a partial frame is dropped, a NaN is silence, a count of 0 is 1',
    deinterleave(Float32Array.from([1, NaN, 3]), 2)[1].join() === '0' && deinterleave(Float32Array.from([1, 2]), 0).length === 1);
  const c = conform([Float32Array.from([1, NaN]), Float32Array.from([1, 2, 3]), 'junk']);
  ok('conform: pads to the longest, reads NaN as silence, drops what is not a channel', c.length === 2 && c[0].join() === '1,0,0' && c[1].join() === '1,2,3');
  ok('conform: a channel already fine is not copied', conform([R])[0] === R);
  ok('frames: the longest channel', frames([L, new Float32Array(9)]) === 9 && frames([]) === 0);
  ok('mixdown is the mean of the channels', mixdown([L, R]).join() === '2.5,3.5,4.5' && mixdown([]).length === 0);
  ok('mixInto adds at an offset, scaled, and drops what falls outside',
    mixInto(new Float32Array(4), Float32Array.from([1, 1, 1]), 2, 2).join() === '0,0,2,2' && mixInto(new Float32Array(3), Float32Array.from([1, 2, 3]), 1, -1).join() === '2,3,0');
  const flat = new Float32Array(1000).fill(1);
  const faded = fadeEdges([flat], 1000, 0.1, 0.2)[0];
  ok('fadeEdges: from silence, through one half at mid-fade, to full level, and back', faded[0] === 0 && near(faded[50], 0.5, 1e-6) && faded[100] === 1 && faded[500] === 1 && faded[999] === 0 && near(faded[899], 0.5, 1e-6));
  const short = fadeEdges([new Float32Array(10).fill(1)], 1000, 1, 1)[0];
  ok('fadeEdges: fades longer than the sound share it, half each', short[0] === 0 && short[9] === 0 && short.every((v) => v <= 1));
  ok('fadeEdges leaves its input alone', flat.every((v) => v === 1));
}

{
  const k = 0.8;
  const d = 1e-6;
  const slope = (softClipSample(k + d, k) - softClipSample(k - d, k)) / (2 * d);
  ok('soft clip: untouched below the knee', softClipSample(0.5, k) === 0.5 && softClipSample(-0.79, k) === -0.79);
  ok('soft clip: no corner at the knee (value and slope continuous)', near(softClipSample(k, k), k, 1e-12) && near(slope, 1, 1e-4), { slope });
  let under = true;
  for (let v = 0; v < 50; v += 0.01) if (!(softClipSample(v, k) <= 1)) under = false;
  ok('soft clip: approaches 1 and never passes it; odd; monotone', under && softClipSample(5, k) > 0.999 && softClipSample(-5, k) === -softClipSample(5, k) && softClipSample(1.0, k) < softClipSample(1.1, k));
  ok('soft clip: ±Infinity is ±1, NaN is silence', softClipSample(Infinity) === 1 && softClipSample(-Infinity) === -1 && softClipSample(NaN) === 0);
  const sc = softClip([Float32Array.from([0.1, 3, -3, 0.9])])[0];
  ok('softClip over a channel', sc[0] === Math.fround(0.1) && sc[1] <= 1 && sc[2] >= -1 && sc[3] < Math.fround(0.9) && sc[3] > 0.8);
  ok('samplePeak: the largest magnitude', samplePeak([Float32Array.from([0.1, -0.7]), Float32Array.from([0.5])]) === Math.fround(0.7) && samplePeak([]) === 0);
}

// ── audiocore: biquads, FFT, convolution ──────────────────────────────────

{
  const x = noise(1000, 3);
  const id = runBiquads(x, [{ b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }]);
  ok('a unit section passes the signal through, bit for bit', hash([id]) === hash([x]));
  const half = runBiquads(x, [{ b0: 0.5, b1: 0.5, b2: 0, a1: 0, a2: 0 }]);
  ok('a two-tap average averages', near(half[10], 0.5 * x[10] + 0.5 * x[9], 1e-7));
  ok('a section with a NaN coefficient is skipped, not spread', hash([runBiquads(x, [{ b0: NaN, b1: 0, b2: 0, a1: 0, a2: 0 }])]) === hash([x]));
  ok('response of the average: 0 dB at DC, silence at Nyquist (floored)', near(biquadResponseDb([{ b0: 0.5, b1: 0.5, b2: 0, a1: 0, a2: 0 }], 0, SR), 0, 1e-9) && biquadResponseDb([{ b0: 0.5, b1: 0.5, b2: 0, a1: 0, a2: 0 }], 24000, SR) < -250);
}

{
  const N = 64;
  const re = new Float64Array(N); const im = new Float64Array(N);
  re[0] = 1;
  fft(re, im);
  ok('FFT of an impulse is flat', re.every((v) => near(v, 1, 1e-12)) && im.every((v) => near(v, 0, 1e-12)));
  for (let i = 0; i < N; i++) { re[i] = Math.cos((2 * Math.PI * 5 * i) / N); im[i] = 0; }
  fft(re, im);
  ok('FFT of a cosine at bin 5: N/2 at bins 5 and N-5, nothing elsewhere', near(re[5], N / 2, 1e-9) && near(re[N - 5], N / 2, 1e-9) && [...re].every((v, k) => k === 5 || k === N - 5 || near(v, 0, 1e-9)));
  const a = noise(N, 9); const b = noise(N, 10);
  const r2 = Float64Array.from(a); const i2 = Float64Array.from(b);
  fft(r2, i2); fft(r2, i2, true);
  ok('FFT then inverse is the input', r2.every((v, k) => near(v, a[k], 1e-6)) && i2.every((v, k) => near(v, b[k], 1e-6)));
  const odd = Float64Array.from([1, 2, 3]);
  fft(odd, new Float64Array(3));
  ok('FFT of a length that is not a power of two is left alone', odd.join() === '1,2,3');
}

{
  const direct = (x, h, n) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < h.length && k <= i; k++) if (i - k < x.length) s += h[k] * x[i - k]; y[i] = s; } return y; };
  const x = noise(5000, 21);
  for (const L of [1, 7, 32, 33, 1000, 3000]) {
    const h = noise(L, 100 + L, 0.1);
    const got = convolve(x, h);
    const want = direct(x, h, x.length);
    let e = 0; for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(got[i] - want[i]));
    ok(`convolve equals direct convolution, response of ${L}`, e < 2e-6, { e });
  }
  ok('convolve: length is the input\'s unless asked; empty in, empty out', convolve(x, noise(10, 2)).length === 5000 && convolve(x, noise(10, 2), 10).length === 10 && convolve(new Float32Array(0), noise(10, 2)).length === 0);
}

// ── audiocore: true peak ──────────────────────────────────────────────────

{
  // EBU Tech 3341's true-peak signals, as tones whose crests sit between samples.
  // A 4x meter reads the waveform at four points per sample, so a crest that
  // falls between two of them reads low by at most -20·log10(cos(π f / 4 fs)):
  // 0.07 dB at 8 kHz, 0.30 dB at 16 kHz (why EBU allows -0.4). The
  // interpolation itself may add no more than a few hundredths.
  const cases = [[12000, 0], [12000, Math.PI / 4], [8000, Math.PI / 3], [6000, (67.5 * Math.PI) / 180], [16000, 0.3], [1000, 0.1], [18000, 1.1], [17000, 2.2], [3000, 0.05]];
  const outside = [];
  for (const [f, ph] of cases) {
    const x = tone(f, -6, 1, { phase: ph, fade: 0.02 });
    const read = dB(truePeakOf([x])) + 6;
    const grid = -20 * Math.log10(Math.cos((Math.PI * f) / (4 * SR)));
    if (!(read <= 0.04 && read >= -grid - 0.04)) outside.push([f, ph, read, -grid]);
  }
  ok('true peak of tones up to 18 kHz at any phase: -6 dBTP, low by no more than the 4x grid allows, high by under 0.04 dB', outside.length === 0, outside);
  const x = tone(12000, 0, 1, { phase: Math.PI / 4, fade: 0.02 }).map((v) => v * Math.SQRT2);
  ok('a 12 kHz tone whose samples peak at 0 dBFS reads +3.01 dBTP', near(dB(samplePeak([x])), 0, 0.01) && near(dB(truePeakOf([x])), 3.0103, 0.03), { sp: dB(samplePeak([x])), tp: dB(truePeakOf([x])) });
  const dc = intervalPeaks(new Float32Array(1000).fill(0.3));
  ok('a constant reads exactly its own level between its samples (away from where it starts and stops)', dc.slice(20, 980).every((v) => near(v, 0.3, 1e-7)));
  ok('true peak of silence and of nothing is 0', truePeakOf([new Float32Array(100)]) === 0 && truePeakOf([]) === 0);
  const m = music(3, 4);
  const z = noise(m.length, 3, 0.9);
  const ip = intervalPeaks(m);
  const most = (a) => a.reduce((p, v) => (v > p ? v : p), 0);
  ok('the interval peaks are never under the samples', ip.every((v, i) => v >= Math.abs(m[i])));
  // intervalPeaks stores float32, so the comparison is at float32.
  ok('the true-peak search that skips is exactly the full one', Math.fround(truePeakOf([m])) === most(ip) && Math.fround(truePeakOf([m, z])) === Math.max(most(ip), most(intervalPeaks(z))));
}

// ── audiocore: resampling ─────────────────────────────────────────────────

{
  const lin = resampleLinear(Float32Array.from([0, 1, 0]), 1000, 2000);
  ok('linear resampling interpolates and holds the edge', lin.length === 6 && lin.join() === '0,0.5,1,0.5,0,0');
  ok('the same rate is a copy', resampleSinc(Float32Array.from([1, 2]), 48000, 48000).join() === '1,2');
  const err = (got, want, from, to) => { let e = 0; for (let i = from; i < to; i++) e = Math.max(e, Math.abs(got[i] - want[i])); return dB(e); };
  const up = resampleSinc(tone(1000, 0, 1, { sr: 44100 }), 44100, 48000);
  ok('44.1 to 48 kHz: 48000 samples, a 1 kHz tone within -80 dB of the ideal', up.length === 48000 && err(up, tone(1000, 0, 1), 2000, 46000) < -80, err(up, tone(1000, 0, 1), 2000, 46000));
  const up18 = resampleSinc(tone(18000, 0, 1, { sr: 44100 }), 44100, 48000);
  ok('44.1 to 48 kHz: an 18 kHz tone within -70 dB', err(up18, tone(18000, 0, 1), 2000, 46000) < -70, err(up18, tone(18000, 0, 1), 2000, 46000));
  const down = resampleSinc(tone(1000, 0, 1), 48000, 44100);
  ok('48 to 44.1 kHz: a 1 kHz tone within -80 dB', down.length === 44100 && err(down, tone(1000, 0, 1, { sr: 44100 }), 2000, 42000) < -80);
  const alias = resampleSinc(tone(23000, 0, 1), 48000, 44100);
  ok('48 to 44.1 kHz: a 23 kHz tone, which would fold to 21.1 kHz, is under -80 dB', dB(maxAbs(alias, 2000, 42000)) < -80, dB(maxAbs(alias, 2000, 42000)));
  const odd = resampleSinc(tone(1000, 0, 1, { sr: 44100 }), 44100, 47999);
  ok('a ratio with 47999 phases (the interpolated table) is as clean', err(odd, tone(1000, 0, 1, { sr: 47999 }), 2000, 46000) < -80);
  const dc = resampleSinc(new Float32Array(4410).fill(0.5), 44100, 48000);
  ok('a constant stays that constant away from the edges', dc.slice(200, 4500).every((v) => near(v, 0.5, 1e-6)));
  const two = resample([tone(500, -6, 0.1, { sr: 32000 }), tone(700, -6, 0.1, { sr: 32000 })], 32000, 48000, 'linear');
  ok('resample: every channel, linear on request', two.length === 2 && two[0].length === 4800);
  const t = time(1, () => resampleSinc(music(30, 2, 44100), 44100, 48000));
  timings.push(['resample 30 s mono 44.1 to 48 kHz (sinc)', t.ms]);
}

// ── loudness ──────────────────────────────────────────────────────────────

console.log('loudness');
{
  const { shelf, highpass } = kWeighting(48000);
  const table = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const got = [shelf.b0, shelf.b1, shelf.b2, shelf.a1, shelf.a2];
  ok('K-weighting at 48 kHz: the shelf is BS.1770-4\'s table to 1e-9', got.every((v, i) => near(v, table[i], 1e-9)), got);
  ok('K-weighting at 48 kHz: the high-pass is the table (1, -2, 1; -1.99004745483398, 0.99007225036621)',
    highpass.b0 === 1 && highpass.b1 === -2 && highpass.b2 === 1 && near(highpass.a1, -1.99004745483398, 1e-9) && near(highpass.a2, 0.99007225036621, 1e-9));
  const k44 = kWeighting(44100);
  ok('K-weighting is derived for other rates, not copied', k44.shelf.b0 !== shelf.b0 && Number.isFinite(k44.shelf.b0));
}
{
  const m = (chs, sr = SR) => measureLoudness(chs, sr, { truePeak: false }).lufs;
  ok('EBU 3341 case 1: a 997 Hz stereo sine at -23 dBFS reads -23.0 LUFS', near(m(stereo(tone(997, -23, 20))), -23, 0.1), m(stereo(tone(997, -23, 20))));
  ok('EBU 3341 case 2: at -33 dBFS, -33.0', near(m(stereo(tone(1000, -33, 20))), -33, 0.1));
  ok('EBU 3341 case 3: -36, -23, -36 dBFS (10, 60, 10 s) reads -23.0: the relative gate', near(m(stereo(cat(tone(1000, -36, 10), tone(1000, -23, 60), tone(1000, -36, 10)))), -23, 0.1));
  ok('EBU 3341 case 4: -72, -36, -23, -36, -72 reads -23.0: both gates', near(m(stereo(cat(tone(1000, -72, 10), tone(1000, -36, 10), tone(1000, -23, 60), tone(1000, -36, 10), tone(1000, -72, 10)))), -23, 0.1));
  ok('EBU 3341 case 5: -26, -20, -26 dBFS (20, 20.1, 20 s) reads -23.0', near(m(stereo(cat(tone(1000, -26, 20), tone(1000, -20, 20.1), tone(1000, -26, 20)))), -23, 0.1));
  const a = m(stereo(tone(1000, -20, 10)));
  const b = m(stereo(tone(1000, -30, 10)));
  const c = m(stereo(tone(1000, -40, 10)));
  ok('amplitude steps of 10 dB read 10 LU apart', near(a - b, 10, 0.01) && near(b - c, 10, 0.01), [a, b, c]);
  ok('the same tone at 44.1, 32 and 96 kHz reads -23.0', [44100, 32000, 96000].every((sr) => near(m(stereo(tone(1000, -23, 10, { sr })), sr), -23, 0.1)));
  ok('mono is one channel, 3 dB under the same tone on both sides', near(m([tone(1000, -23, 10)]), -26.01, 0.1));
  ok('weights: the right channel weighed 0 reads 3 dB under both', near(measureLoudness(stereo(tone(1000, -23, 10)), SR, { weights: [1, 0], truePeak: false }).lufs, -26.01, 0.1));
  const five = (on) => [0, 1, 2, 3, 4].map((ch) => (on.includes(ch) ? tone(1000, -23, 10) : new Float32Array(SR * 10)));
  ok('5.0: a surround weighs 1.41, +1.49 LU over the same signal on the left', near(m(five([3])) - m(five([0])), 10 * Math.log10(1.41), 0.01));
  ok('5.1: the LFE (channel 4 of 6) is not counted', m([0, 1, 2, 3, 4, 5].map((ch) => (ch === 3 ? tone(1000, -10, 5) : new Float32Array(SR * 5))).concat([])) === -Infinity);
  ok('silence reads -Infinity', m(stereo(new Float32Array(SR * 5))) === -Infinity);
  ok('a sound under the absolute gate reads -Infinity', m(stereo(tone(1000, -75, 5))) === -Infinity);
  ok('nothing, no samples, and all-NaN read -Infinity', m([]) === -Infinity && m([new Float32Array(0)]) === -Infinity && m([new Float32Array(1000).fill(NaN)]) === -Infinity);
  ok('a tone with a minute of silence after it reads the tone: the absolute gate', near(m(stereo(cat(tone(1000, -23, 20), new Float32Array(SR * 60)))), -23, 0.1));
  ok('a sound shorter than a block (0.2 s) still has a level, the steady level', near(m(stereo(tone(1000, -23, 0.2))), -23, 0.15), m(stereo(tone(1000, -23, 0.2))));
}
{
  const r = (chs) => measureLoudness(chs, SR, { truePeak: false }).range;
  ok('EBU 3342 case 1: -20 then -30 dBFS reads a range of 10 LU', near(r(stereo(cat(tone(1000, -20, 20), tone(1000, -30, 20)))), 10, 1));
  ok('EBU 3342 case 2: -20 then -15, 5 LU', near(r(stereo(cat(tone(1000, -20, 20), tone(1000, -15, 20)))), 5, 1));
  ok('EBU 3342 case 3: -40 then -20, 20 LU', near(r(stereo(cat(tone(1000, -40, 20), tone(1000, -20, 20)))), 20, 1));
  ok('EBU 3342 case 4: -50, -35, -20, -35, -50, 15 LU', near(r(stereo(cat(tone(1000, -50, 20), tone(1000, -35, 20), tone(1000, -20, 20), tone(1000, -35, 20), tone(1000, -50, 20)))), 15, 1));
  ok('a steady tone has no range; a sound under 3 s has none', near(r(stereo(tone(1000, -20, 10))), 0, 0.01) && r(stereo(tone(1000, -20, 2))) === 0);
}
{
  const x = tone(12000, 0, 2, { phase: Math.PI / 4, fade: 0.02 }).map((v) => v * Math.SQRT2);
  const l = measureLoudness(stereo(x), SR);
  ok('the measurement\'s peak is the true peak: +3.0 dBTP over 0.0 dBFS samples', near(l.peakDb, 3.01, 0.03) && l.truePeakDb === l.peakDb && near(l.samplePeakDb, 0, 0.01), l);
  ok('without oversampling the peak is the sample peak', measureLoudness(stereo(x), SR, { truePeak: false }).peakDb === l.samplePeakDb);
  const s = measureLoudness(stereo(new Float32Array(100)), SR);
  ok('silence: every number -Infinity but the range, 0', s.lufs === -Infinity && s.peakDb === -Infinity && s.samplePeakDb === -Infinity && s.range === 0);
}
{
  ok('delivery is -16 LUFS under -1.5 dBTP', DELIVERY_LUFS === -16 && DELIVERY_CEILING_DB === -1.5);
  ok('gainToTarget: -20 LUFS with room to spare gets +4 dB', near(gainToTarget({ lufs: -20, peakDb: -10 }), dbToGain(4), 1e-12));
  ok('gainToTarget: held by the ceiling (peak -3 dBTP may rise 1.5 dB)', near(gainToTarget({ lufs: -30, peakDb: -3 }), dbToGain(1.5), 1e-12));
  ok('gainToTarget: a target and a ceiling of one\'s own', near(gainToTarget({ lufs: -20, peakDb: -10 }, -14, -1), dbToGain(6), 1e-12) && near(gainToTarget({ lufs: -20, peakDb: -10 }, -14, -9), dbToGain(1), 1e-12));
  ok('gainToTarget: silence, or numbers that are not, is 1', gainToTarget({ lufs: -Infinity, peakDb: -Infinity }) === 1 && gainToTarget({ lufs: NaN, peakDb: 0 }) === 1 && gainToTarget(null) === 1);
  ok('gainToTarget: a loud sound comes down', near(gainToTarget({ lufs: -8, peakDb: 0 }), dbToGain(-8), 1e-12));
  const p = loudnessPlan({ lufs: -40, peakDb: -30 }, { maxGainDb: 12 });
  ok('loudnessPlan says what held it: the gain cap', p.limitedBy === 'max-gain' && p.gainDb === 12 && p.projectedLufs === -28 && p.projectedPeakDb === -18, p);
  ok('loudnessPlan: the target, the ceiling, silence', loudnessPlan({ lufs: -20, peakDb: -10 }).limitedBy === 'none' && loudnessPlan({ lufs: -30, peakDb: -3 }).limitedBy === 'ceiling' && loudnessPlan({ lufs: -Infinity, peakDb: -Infinity }).limitedBy === 'silence');
  ok('loudnessPlan: nonsense options are the defaults, and everything is finite', Number.isFinite(loudnessPlan({ lufs: -1e300, peakDb: -1e300 }, { target: NaN, ceiling: 'x', maxGainDb: Infinity }).gain));
  const quiet = stereo(tone(1000, -35, 10, { fade: 0.05 }));
  const n = normalizeLoudness(quiet, SR);
  const after = measureLoudness(n.channels, SR);
  ok('normalizeLoudness brings a quiet tone to -16.0 LUFS', near(after.lufs, -16, 0.05) && n.plan.limitedBy === 'none', after);
  // A quiet tone with one 50 ms spike near full scale: too peaky to reach -16 LUFS under -1.5 dBTP.
  const peaky = stereo(cat(tone(1000, -30, 5), tone(1000, -1, 0.05), tone(1000, -30, 5)));
  const n2 = normalizeLoudness(peaky, SR);
  const after2 = measureLoudness(n2.channels, SR);
  ok('normalizeLoudness: a peaky sound stops at the ceiling, its true peak at -1.5 dBTP', n2.plan.limitedBy === 'ceiling' && near(after2.peakDb, -1.5, 0.01) && after2.lufs < -16, after2);
  ok('normalizeLoudness leaves its input alone', near(measureLoudness(quiet, SR).lufs, n.measured.lufs, 1e-9) && quiet[0][SR] === tone(1000, -35, 10, { fade: 0.05 })[SR]);
}
{
  const M = stereo(music(30, 3)); M[1] = music(30, 11);
  const t = time(3, () => measureLoudness(M, SR));
  timings.push(['measure 30 s stereo 48 kHz, music-like', t.ms]);
  ok(`measuring 30 s of stereo at 48 kHz takes under 150 ms (${t.ms.toFixed(0)} ms)`, t.ms < 150);
  const W = [noise(30 * SR, 1, 0.5), noise(30 * SR, 2, 0.5)];
  const w = time(3, () => measureLoudness(W, SR));
  timings.push(['measure 30 s stereo, white noise (nothing to skip)', w.ms]);
  const S = stereo(tone(997, -1, 30));
  const s = time(3, () => measureLoudness(S, SR));
  timings.push(['measure 30 s stereo, a steady full-level tone', s.ms]);
  ok(`the worst cases (white noise ${w.ms.toFixed(0)} ms, a steady tone ${s.ms.toFixed(0)} ms) stay under 300 ms`, w.ms < 300 && s.ms < 300);
  ok('measuring twice gives the same numbers', JSON.stringify(measureLoudness(M, SR)) === JSON.stringify(t.value));
}

// ── automation ────────────────────────────────────────────────────────────

console.log('audioauto');
{
  ok('four curves; version 1; ranges for volume and rate', CURVES.join() === 'linear,hold,exp,bezier' && AUTOMATION_VERSION === 1 && VOLUME_RANGE.max === 4 && RATE_RANGE.min === 0.25);
  ok('targets: volume, rate, fx.<id>.<knob>; nothing else', parseTarget('volume').kind === 'volume' && parseTarget('rate').kind === 'rate' &&
    JSON.stringify(parseTarget('fx.n1.mix')) === '{"kind":"fx","id":"n1","param":"mix"}' && [null, 'fx.n1', 'fx..mix', 'fx.n1.mix.x', 'Volume', 7, 'fx.a b.mix'].every((t) => parseTarget(t) === null));
  ok('rangeOf: volume and rate have theirs; a knob without a chain is only finite; with one, its own', rangeOf('volume') === VOLUME_RANGE && rangeOf('fx.a.mix').max === 1e9 &&
    rangeOf('fx.d.mix', fxRangeResolver(readChain([{ type: 'delay', id: 'd' }]))).max === 1 && rangeOf('fx.x.mix', fxRangeResolver([])) === undefined && rangeOf('nope') === undefined);
  const lane = readLane({ target: 'volume', points: [
    { t: 2, v: 9 }, { t: 1, v: 0.5, curve: 'exp' }, { t: 1, v: 0.6, curve: 'warp' }, { t: 'x', v: 1 }, { t: 3, v: null }, { t: -4, v: 0.2 },
    { t: '1.5', v: '0.7', curve: 'bezier', viaX: 2, viaY: -1 }, { t: 1.7, v: 0.1, curve: 'bezier', viaX: 0.3 }, { t: 1e9, v: 1 },
  ] });
  const ts = lane.points.map((p) => p.t).join();
  ok('readLane: sorted, a later point at the same time wins, unreadable points dropped, times held to 0..3600', ts === `0,1,1.5,1.7,2,${MAX_SECONDS}`, ts);
  ok('readLane: values clamped to the range; an unknown curve is linear (and not written)', lane.points.find((p) => p.t === 2).v === 4 && lane.points.find((p) => p.t === 1).v === 0.6 && !('curve' in lane.points.find((p) => p.t === 1)));
  ok('readLane: numeric strings read; a via point clamped inside the segment; half a via point dropped',
    lane.points.find((p) => p.t === 1.5).viaX === 0.999 && lane.points.find((p) => p.t === 1.5).viaY === 0.001 && !('viaX' in lane.points.find((p) => p.t === 1.7)));
  ok('readLane: no target, a bad target, or not an object is undefined', readLane({ points: [] }) === undefined && readLane({ target: 'pan', points: [] }) === undefined && readLane(5) === undefined);
  const many = readLane({ target: 'volume', points: Array.from({ length: 5000 }, (_, i) => ({ t: i / 2, v: 1 })) });
  ok(`readLane: at most ${MAX_POINTS} points`, many.points.length === MAX_POINTS);
  const chain = readChain([{ type: 'delay', id: 'echo' }]);
  const auto = readAutomation({ lanes: [
    { target: 'volume', points: [{ t: 0, v: 1 }] }, { target: 'volume', points: [{ t: 0, v: 0.5 }] }, { target: 'rate', points: [] },
    { target: 'fx.echo.mix', points: [{ t: 0, v: 7 }] }, { target: 'fx.gone.mix', points: [{ t: 0, v: 1 }] }, { target: 'fx.echo.mode', points: [{ t: 0, v: 1 }] }, 'junk',
  ] }, fxRangeResolver(chain));
  ok('readAutomation: one lane per target (the later), empty lanes dropped, a knob clamped to its range, orphans dropped',
    auto.lanes.length === 2 && auto.lanes[0].points[0].v === 0.5 && auto.lanes[1].target === 'fx.echo.mix' && auto.lanes[1].points[0].v === 1, auto);
  ok(`readAutomation: at most ${MAX_LANES} lanes, never throws on anything`, readAutomation({ lanes: Array.from({ length: 50 }, (_, i) => ({ target: `fx.n${i}.mix`, points: [{ t: 0, v: 0 }] })) }).lanes.length === MAX_LANES &&
    [null, 1, 'x', [], { lanes: 5 }, { lanes: [null, { target: {} }] }].every((x) => readAutomation(x).lanes.length === 0));
}
{
  const L = (curve, a, b, extra = {}) => ({ target: 'volume', points: [{ t: 1, v: a, curve, ...extra }, { t: 3, v: b }] });
  ok('linear: the midpoint is the mean', valueAt(L('linear', 0, 1), 2) === 0.5);
  ok('hold: the first value until the next point, which is exact at its time', valueAt(L('hold', 0.2, 1), 2.999) === 0.2 && valueAt(L('hold', 0.2, 1), 3) === 1);
  ok('exp: geometric, 1 to 0.25 is 0.5 halfway (even in dB)', near(valueAt(L('exp', 1, 0.25), 2), 0.5, 1e-12));
  ok(`exp to or from silence runs through the floor (${EXP_FLOOR}), landing on 0 at the point`, near(valueAt(L('exp', 0, 1), 2), 0.01, 1e-12) && valueAt(L('exp', 1, 0), 3) === 0 && valueAt(L('exp', 0, 1), 1) === 0);
  const neg = { target: 'fx.a.gain', points: [{ t: 1, v: -12, curve: 'exp' }, { t: 3, v: 0 }] };
  ok('exp with a negative end is drawn straight', valueAt(neg, 2) === -6);
  ok('bezier with no via point is a smoothstep: 0.15625 a quarter of the way', near(valueAt(L('bezier', 0, 1), 1.5), 0.15625, 1e-12));
  const via = L('bezier', 0, 1, { viaX: 0.3, viaY: 0.8 });
  ok('bezier passes exactly through its via point', near(valueAt(via, 1 + 0.3 * 2), 0.8, 1e-9), valueAt(via, 1.6));
  let mono = true; let prev = -1;
  for (let t = 1; t <= 3; t += 0.001) { const v = valueAt(via, t); if (v < prev - 1e-12) mono = false; prev = v; }
  ok('bezier through a via point is monotone and stays between its ends', mono && valueAt(via, 1) === 0 && valueAt(via, 3) === 1);
  ok('a via point on the diagonal is a straight line', near(valueAt(L('bezier', 0, 1, { viaX: 0.4, viaY: 0.4 }), 2), 0.5, 1e-12));
  ok('before the first point, the first value; after the last, the last; empty, the resting value', valueAt(L('linear', 0.3, 0.9), 0) === 0.3 && valueAt(L('linear', 0.3, 0.9), 99) === 0.9 &&
    valueAt({ target: 'volume', points: [] }, 1) === 1 && valueAt({ target: 'fx.a.b', points: [] }, 1) === 0);
  const lane = readLane({ target: 'volume', points: [{ t: 0, v: 1, curve: 'exp' }, { t: 0.5, v: 0.25, curve: 'hold' }, { t: 1, v: 0.5, curve: 'bezier' }, { t: 1.5, v: 1 }, { t: 2, v: 0, curve: 'linear' }] });
  const r = render(lane, 1000, 2500);
  ok('render is valueAt at every sample', r.every((v, i) => v === Math.fround(valueAt(lane, i / 1000))));
  const r2 = render(lane, 1000, 100, 0.75);
  ok('render from an offset', r2.every((v, i) => v === Math.fround(valueAt(lane, 0.75 + i / 1000))));
  ok('render of nothing is nothing; of an empty lane, the resting value', render(lane, 1000, 0).length === 0 && render({ target: 'volume', points: [] }, 1000, 3).join() === '1,1,1');
}
{
  const lane = readLane({ target: 'volume', points: [
    { t: 0.2, v: 1, curve: 'exp' }, { t: 0.6, v: 0.25, curve: 'hold' }, { t: 1.0, v: 0.5, curve: 'bezier', viaX: 0.2, viaY: 0.7 },
    { t: 1.6, v: 1, curve: 'exp' }, { t: 2.0, v: 0 }, { t: 2.4, v: 0.8, curve: 'bezier' }, { t: 3.0, v: 0.3 },
  ] });
  const kinds = planLane(lane, 0.5).map((o) => o.kind).join();
  ok('planLane: the opening value, an anchor where the lane starts, exp, set (hold), curve (bezier), curve (exp to 0), ramp, curve', kinds === 'set,set,exp,set,curve,curve,ramp,curve', kinds);
  // Played through Web Audio's timeline, the plan lands on the curve. Exact
  // segments: before the lane, the geometric 1 → 0.25, the hold, the straight
  // 0 → 0.8, after the lane. The rest are value curves.
  const check = (strict, from) => {
    const ctx = new FakeAudioContext(1000, { strictCurves: strict });
    const g = ctx.createGain();
    const done = compile(lane, g.gain, 0.5, from);
    let exactErr = 0; let curveErr = 0;
    const exactAt = (t) => (t < 0.6 || (t > 0.6 && t < 1.0) || (t > 2.0 && t < 2.4) || t > 3.0);
    for (let t = Math.max(0, (from ?? 0.5) - 0.5); t <= 3.5; t += 0.0005) {
      const e = Math.abs(g.gain.valueAt(0.5 + t) - valueAt(lane, t));
      if (exactAt(t)) exactErr = Math.max(exactErr, e); else curveErr = Math.max(curveErr, e);
    }
    return { exactErr, curveErr, calls: g.gain.calls, curves: done.filter((o) => o.kind === 'curve').length };
  };
  const a = check(false);
  // Exact to float32, the precision of Web Audio's own values (a ramp after a value curve starts from its float32 end).
  ok('compiled straight, held and geometric segments are exact in Web Audio\'s timeline (to float32)', a.exactErr < 1e-7, a.exactErr);
  ok('compiled bezier and zero-ended exp segments are within 0.001 of the curve (a steep via-point arc included)', a.curveErr < 1e-3, a.curveErr);
  ok('compile clears what was booked before', a.calls[0][0] === 'cancelScheduledValues' && a.calls[0][1] === 0);
  const b = check(true);
  const refusedCurves = b.calls.filter((c) => c[0] === 'setValueCurveAtTime').length;
  ok('an engine that refuses value curves (stricter than any) gets the same curve as ramps', b.exactErr < 1e-7 && b.curveErr < 1e-3 && refusedCurves > 0 && b.curves === 0 && a.curves > 0, { exactErr: b.exactErr, curveErr: b.curveErr, curves: b.curves });
  const mid = check(false, 0.5 + 1.3);
  ok('starting mid-lane (1.3 s in, inside a curve) plays the rest of it', mid.exactErr < 1e-7 && mid.curveErr < 1e-3, { exactErr: mid.exactErr, curveErr: mid.curveErr });
  const plan = planLane(lane, 0.5, 0.5 + 1.3);
  const open = plan[0].kind === 'curve' ? plan[0].values[0] : plan[0].value;
  ok('mid-lane: begins at that moment with the value there, books nothing already past', plan[0].time === 1.8 && near(open, valueAt(lane, 1.3), 1e-6) && plan.every((o) => o.time >= 1.8 - 1e-12));
  const later = planLane(readLane({ target: 'volume', points: [{ t: 2, v: 0.5 }, { t: 3, v: 1 }] }), 0);
  ok('a lane whose first point is later holds its first value until then, then ramps from there', later.map((o) => `${o.kind}:${o.value}@${o.time}`).join() === 'set:0.5@0,set:0.5@2,ramp:1@3');
  const curveFirst = planLane(readLane({ target: 'volume', points: [{ t: 0, v: 0, curve: 'bezier' }, { t: 1, v: 1 }] }), 0);
  ok('a value curve at the very start replaces the opening value (no event under it)', curveFirst.length === 1 && curveFirst[0].kind === 'curve' && curveFirst[0].time === 0);
  ok('a lane with no points books its resting value', JSON.stringify(planLane({ target: 'volume', points: [] }, 2)) === '[{"kind":"set","value":1,"time":2}]');
  ok('a lane scheduled in the past starts at 0, never a negative time', planLane(lane, -5).every((o) => o.time >= 0));
}

// ── effects: descriptors ──────────────────────────────────────────────────

console.log('audiofx');
{
  ok('six effects', FX_TYPES.join() === 'eq,filter,compressor,limiter,delay,reverb' && FX_TYPES.every((t) => FX_SPECS[t]));
  ok('every effect at rest has every knob at its default', FX_TYPES.every((t) => { const fx = defaultFx(t); return Object.entries(FX_SPECS[t]).every(([k, s]) => fx[k] === (k === 'seed' ? Math.round(s.def) : s.def)); }));
  const eq = readFx({ type: 'eq', lowFreq: 1e9, lowGain: -99, midQ: 0, highGain: null, midGain: '', id: 'band 1', on: 'no' });
  ok('readFx clamps to the range, and a missing, null or empty knob is its default, not 0', eq.lowFreq === 1000 && eq.lowGain === -24 && eq.midQ === 0.1 && eq.highGain === 0 && eq.midGain === 0);
  ok('readFx: an id must be a handle; only on: false is kept', !('id' in eq) && !('on' in eq) && readFx({ type: 'eq', id: 'n_1', on: false }).id === 'n_1' && readFx({ type: 'eq', on: false }).on === false);
  ok('readFx: a filter\'s mode and slope are words from a list', readFx({ type: 'filter', mode: 'bandpass', slope: 48 }).mode === 'highpass' && readFx({ type: 'filter', mode: 'lowpass', slope: '24' }).slope === 24);
  ok('readFx: a limiter holds the true peak unless told not to; a reverb\'s seed is whole', readFx({ type: 'limiter' }).truePeak === true && readFx({ type: 'limiter', truePeak: false }).truePeak === false && readFx({ type: 'reverb', seed: 3.7 }).seed === 4);
  ok('readFx: an unknown effect, or not an object, is undefined', readFx({ type: 'chorus' }) === undefined && readFx(null) === undefined && readFx([]) === undefined);
  const chain = readChain([{ type: 'eq', id: 'a' }, 'junk', { type: 'delay', id: 'a' }, ...Array.from({ length: 30 }, () => ({ type: 'delay' }))]);
  ok(`readChain: junk skipped, a repeated id dropped from the later effect, at most ${MAX_CHAIN}`, chain.length === MAX_CHAIN && chain[0].id === 'a' && !('id' in chain[1]) && readChain('x').length === 0);
  const res = fxRangeResolver(readChain([{ type: 'reverb', id: 'r' }]));
  ok('fxRangeResolver: a knob\'s range by effect id; nothing for an enum or a stranger', res('r', 'mix').max === 1 && res('r', 'mix').def === 0.25 && res('r', 'mode') === undefined && res('x', 'mix') === undefined);
}

// ── effects: EQ and filters ───────────────────────────────────────────────

{
  const resp = (fx, f) => fxResponseDb(readFx(fx), SR, f);
  ok('low shelf +6 dB at 100 Hz: +6 at DC, +3 at the corner, 0 at Nyquist (exact)', near(resp({ type: 'eq', lowFreq: 100, lowGain: 6 }, 0), 6, 1e-9) && near(resp({ type: 'eq', lowFreq: 100, lowGain: 6 }, 100), 3, 1e-9) && near(resp({ type: 'eq', lowFreq: 100, lowGain: 6 }, 24000), 0, 1e-9));
  ok('peak +6 dB at 1 kHz: +6 at 1 kHz, 0 at DC and Nyquist (exact)', near(resp({ type: 'eq', midGain: 6 }, 1000), 6, 1e-9) && near(resp({ type: 'eq', midGain: 6 }, 0), 0, 1e-9) && near(resp({ type: 'eq', midGain: 6 }, 24000), 0, 1e-9));
  ok('high shelf -6 dB at 5 kHz: 0 at DC, -3 at the corner, -6 at Nyquist (exact)', near(resp({ type: 'eq', highFreq: 5000, highGain: -6 }, 0), 0, 1e-9) && near(resp({ type: 'eq', highFreq: 5000, highGain: -6 }, 5000), -3, 1e-9) && near(resp({ type: 'eq', highFreq: 5000, highGain: -6 }, 24000), -6, 1e-9));
  // A Butterworth through the bilinear transform: |H|² = 1/(1 + w^2n) with w the prewarped ratio.
  const warp = (f, f0) => Math.tan((Math.PI * f) / SR) / Math.tan((Math.PI * f0) / SR);
  const bw = (mode, order, f, f0) => { const w = mode === 'lowpass' ? warp(f, f0) : 1 / warp(f, f0); return -10 * Math.log10(1 + w ** (2 * order)); };
  const fs = [50, 200, 500, 1000, 2000, 4000, 12000];
  ok('high-pass 12 dB/oct, Q 0.7071, at 1 kHz is the Butterworth at every frequency', fs.every((f) => near(resp({ type: 'filter', mode: 'highpass', freq: 1000 }, f), bw('highpass', 2, f, 1000), 1e-6)));
  ok('low-pass 24 dB/oct at 1 kHz is the fourth-order Butterworth: -3.01 at the corner, -24.1 an octave up', fs.every((f) => near(resp({ type: 'filter', mode: 'lowpass', freq: 1000, slope: 24 }, f), bw('lowpass', 4, f, 1000), 1e-6)) &&
    near(resp({ type: 'filter', mode: 'lowpass', freq: 1000, slope: 24 }, 1000), -3.0103, 1e-4));
  ok('a 12 dB/oct low-pass with Q 2 peaks to +6.02 dB at its corner (the gain there is Q)', near(resp({ type: 'filter', mode: 'lowpass', freq: 1000, q: 2 }, 1000), 20 * Math.log10(2), 1e-9));
  ok('sections: three for the EQ, one or two for the filter', eqSections(defaultFx('eq'), SR).length === 3 && filterSections(defaultFx('filter'), SR).length === 1 && filterSections(readFx({ type: 'filter', slope: 24 }), SR).length === 2);
  ok('a corner past Nyquist is held under it, still finite', Number.isFinite(resp({ type: 'eq', highFreq: 20000, highGain: 6 }, 1000)) && eqSections(readFx({ type: 'eq', highFreq: 20000 }), 22050).every((s) => Object.values(s).every(Number.isFinite)));
  const x = noise(SR, 5);
  ok('an EQ with every band at 0 dB is the signal, bit for bit', hash(renderFx([x], SR, defaultFx('eq'))) === hash([x]));
  // Measured: a sine through the effect, its level after the transient.
  const measure = (fx, f) => { const y = renderFx([tone(f, -12, 1)], SR, readFx(fx))[0]; return dB(rmsOf(y, SR / 2, SR) * Math.SQRT2) + 12; };
  const pts = [[{ type: 'eq', lowFreq: 100, lowGain: 6, midGain: -4, midFreq: 2000, highFreq: 8000, highGain: 3 }, [100, 500, 2000, 8000, 12000]],
    [{ type: 'filter', mode: 'highpass', freq: 1000, slope: 24 }, [200, 500, 1000, 4000]], [{ type: 'filter', mode: 'lowpass', freq: 2000, q: 3 }, [500, 2000, 4000]]];
  let worst = 0;
  for (const [fx, freqs] of pts) for (const f of freqs) worst = Math.max(worst, Math.abs(measure(fx, f) - fxResponseDb(readFx(fx), SR, f)));
  ok('a sine through the EQ and the filters comes out at the designed level, within 0.02 dB', worst < 0.02, worst);
}

// ── effects: dynamics ─────────────────────────────────────────────────────

{
  const hard = readFx({ type: 'compressor', threshold: -20, ratio: 4, knee: 0, attack: 1, release: 50 });
  ok('compressor curve, hard knee: nothing under the threshold, then 3/4 of the excess removed', compressorCurveDb(hard, -30) === 0 && compressorCurveDb(hard, -20) === 0 && compressorCurveDb(hard, -10) === -7.5 && compressorCurveDb(hard, 0) === -15);
  const soft = readFx({ type: 'compressor', threshold: -20, ratio: 4, knee: 6 });
  ok('compressor curve, 6 dB knee: -0.5625 dB at the threshold, joining both sides with no step', near(compressorCurveDb(soft, -20), -0.5625, 1e-12) && compressorCurveDb(soft, -23) === 0 && near(compressorCurveDb(soft, -17), -2.25, 1e-12));
  let settled = 0;
  for (const level of [-40, -30, -20, -15, -10, -5, 0]) {
    const x = square(dbToGain(level), SR / 2);
    const y = renderFx([x], SR, hard)[0];
    settled = Math.max(settled, Math.abs(dB(Math.abs(y[y.length - 1])) - (level + compressorCurveDb(hard, level))));
  }
  ok('a steady square settles exactly on the static curve, -40 to 0 dB', settled < 1e-3, settled);
  const softOut = renderFx([square(dbToGain(-20), SR / 2)], SR, readFx({ ...soft, attack: 1, release: 50 }))[0];
  ok('...and on the soft knee', near(dB(Math.abs(softOut[softOut.length - 1])) + 20, -0.5625, 1e-3));
  // A step from -40 to 0 dB: the reduction goes 0 → 15 dB at the attack time constant, then back at the release one.
  const slow = readFx({ type: 'compressor', threshold: -20, ratio: 4, knee: 0, attack: 10, release: 100 });
  const step = cat(square(0.01, SR / 10), square(1, SR / 2), square(0.01, SR / 2));
  const g = chainEnvelopes([step], SR, [slow])[0];
  const at = (i) => -dB(g[i]);
  ok('attack: 63.2% of the 15 dB reduction one time constant (10 ms) after the step', near(at(SR / 10 + 480 - 1), 15 * (1 - Math.exp(-1)), 0.05), at(SR / 10 + 479));
  ok('release: back to 36.8% of it one time constant (100 ms) after the level drops', near(at(SR / 10 + SR / 2 + 4800 - 1), 15 * Math.exp(-1), 0.05), at(SR / 10 + SR / 2 + 4799));
  const mk = renderFx([square(0.01, 1000)], SR, readFx({ type: 'compressor', makeup: 6 }))[0];
  ok('make-up gain is applied whole under the threshold', near(dB(Math.abs(mk[999])) + 40, 6, 1e-4));
  const linked = renderFx([square(1, 4800), new Float32Array(4800).fill(0.001)], SR, hard);
  ok('stereo is compressed as one: a quiet side gets the loud side\'s gain', near(linked[1][4799] / 0.001, Math.abs(linked[0][4799]), 1e-5));
}
{
  const lim = (o) => readFx({ type: 'limiter', ...o });
  const worst = [];
  const signals = [stereo(music(2, 9).map((v) => v * 8)), [noise(SR, 4, 4)], [square(1, SR)], [new Float32Array(SR).fill(2)],
    [Float32Array.from({ length: SR }, (_, i) => (i % 4000 === 0 ? 10 : 0))], [tone(18000, 6, 1, { phase: 0.4 })]];
  for (const sig of signals) {
    for (const ceiling of [-1, -6, -0.1]) {
      const out = renderFx(sig, SR, lim({ ceiling, truePeak: false }));
      worst.push(samplePeak(out) / dbToGain(ceiling));
    }
  }
  ok('the limiter never lets a sample past the ceiling (music x8, noise at 4, full scale, DC at 2, impulses at 10, a +6 dB 18 kHz tone)', Math.max(...worst) <= 1 + 1e-7, Math.max(...worst));
  let tpWorst = -Infinity;
  for (const sig of signals) {
    const out = renderFx(sig, SR, lim({ ceiling: -1 }));
    tpWorst = Math.max(tpWorst, dB(truePeakOf(out)) + 1);
  }
  ok('with true peak, no 4x-oversampled point passes it either (within 0.05 dB)', tpWorst <= 0.05, tpWorst);
  const quiet = [music(1, 2).map((v) => v * 0.2)];
  ok('a sound already under the ceiling passes untouched, bit for bit', hash(renderFx(quiet, SR, lim({}))) === hash(quiet));
  const imp = new Float32Array(SR); imp[SR / 2] = 2; for (let i = 0; i < SR; i++) if (i !== SR / 2) imp[i] = 0.5;
  const g = chainEnvelopes([imp], SR, [lim({ ceiling: -6.0206, lookahead: 5, release: 50, truePeak: false })])[0];
  const W = 240;
  ok('look-ahead: the gain is untouched until 5 ms before a peak, and is exactly what the peak needs on it', g[SR / 2 - W - 1] === 1 && g[SR / 2 - W] < 1 && near(g[SR / 2], 0.25, 1e-7), [g[SR / 2 - W - 1], g[SR / 2 - W], g[SR / 2]]);
  ok('release: 63.2% of the way back one time constant (50 ms) after', near(g[SR / 2 + 2400], 1 - 0.75 * Math.exp(-1), 0.02), g[SR / 2 + 2400]);
  ok('the gain only ever attenuates', g.every((v) => v <= 1 && v > 0));
}

// ── effects: delay and reverb ─────────────────────────────────────────────

{
  const fx = readFx({ type: 'delay', time: 100, feedback: 0.5, mix: 0.4 });
  const imp = new Float32Array(SR); imp[0] = 1;
  const y = renderFx([imp], SR, fx)[0];
  const D = 4800;
  ok('delay: an impulse comes back at D, 2D, 3D with mix, mix·fb, mix·fb²', delaySamples(fx, SR) === D && near(y[0], 0.6, 1e-7) && near(y[D], 0.4, 1e-7) && near(y[2 * D], 0.2, 1e-7) && near(y[3 * D], 0.1, 1e-7));
  ok('delay: nothing between the echoes', y.every((v, i) => i % D === 0 || v === 0));
  // A finite series, the same in both paths: echoes until the next would be 80 dB under the first.
  ok('echoes: one with no feedback, 14 at 0.5, 88 at 0.9 (the most): every echo down to -80 dB, none under',
    echoCount(readFx({ type: 'delay', feedback: 0 })) === 1 && echoCount(readFx({ type: 'delay', feedback: 0.5 })) === 14 && echoCount(readFx({ type: 'delay', feedback: 0.9 })) === 88 &&
    [0.1, 0.35, 0.5, 0.77, 0.9].every((fb) => { const K = echoCount(readFx({ type: 'delay', feedback: fb })); return fb ** (K - 1) >= 1e-4 * (1 - 1e-9) && fb ** K < 1e-4; }));
  const short = readFx({ type: 'delay', time: 10, feedback: 0.5, mix: 0.4 });
  const z = renderFx([imp], SR, short)[0];
  ok('the 14th echo sounds (0.4·0.5^13) and there is no 15th', near(z[14 * 480], 0.4 * 0.5 ** 13, 1e-9) && z[15 * 480] === 0 && z.slice(14 * 480 + 1).every((v) => v === 0));
  ok('delay time in whole samples, at least one', delaySamples(readFx({ type: 'delay', time: 10 }), 8000) === 80 && delaySamples(short, 1000) === 10);
}
{
  ok('reverb: size 0 to 1 is a decay of 0.3 to 3 s', reverbSeconds(0) === 0.3 && reverbSeconds(1) === 3 && reverbSeconds(9) === 3);
  const room = readFx({ type: 'reverb', size: 0.4, damping: 0, predelay: 20, mix: 1, seed: 5 });
  const irs = reverbImpulse(SR, room, 2);
  const pre = Math.round(0.02 * SR);
  ok('the impulse: pre-delay of silence, then the room, each side at unit energy', irs.length === 2 && irs.every((ir) => ir.slice(0, pre).every((v) => v === 0) && ir[pre] !== 0) &&
    irs.every((ir) => near(ir.reduce((s, v) => s + v * v, 0), 1, 1e-5)));
  ok('the same room is the same bytes; another seed is another room', hash(reverbImpulse(SR, room, 2)) === hash(irs) && hash(reverbImpulse(SR, { ...room, seed: 6 }, 2)) !== hash(irs));
  const [L, R] = irs;
  let lr = 0; for (let i = 0; i < L.length; i++) lr += L[i] * R[i];
  ok('the two sides are uncorrelated (|ρ| under 0.05): a stereo room is wide', Math.abs(lr) < 0.05, lr);
  // Schroeder backward integration: the energy decay curve's slope gives RT60.
  const edc = new Float64Array(L.length);
  let acc = 0;
  for (let i = L.length - 1; i >= 0; i--) { acc += L[i] * L[i]; edc[i] = acc; }
  const level = (t) => 10 * Math.log10(edc[pre + Math.round(t * SR)] / edc[pre]);
  const t5 = (() => { let i = 0; while (level(i / SR) > -5) i++; return i / SR; })();
  const t25 = (() => { let i = 0; while (level(i / SR) > -25) i++; return i / SR; })();
  const rt60 = 3 * (t25 - t5);
  ok(`energy decays at the designed rate: Schroeder T20 gives RT60 ${rt60.toFixed(2)} s for a ${reverbSeconds(0.4).toFixed(2)} s room (within 10%)`, near(rt60, reverbSeconds(0.4), 0.1 * reverbSeconds(0.4)));
  let falling = true;
  for (let w = 1; w < 12; w++) {
    const e = (k) => { let s = 0; for (let i = pre + k * 4800; i < pre + (k + 1) * 4800; i++) s += L[i] * L[i]; return s; };
    if (!(e(w) < e(w - 1))) falling = false;
  }
  ok('...and every 100 ms holds less energy than the 100 ms before', falling);
  const damped = reverbImpulse(SR, { ...room, damping: 1 }, 1)[0];
  const hiShare = (ir, from, to) => { let h = 0, a = 0; for (let i = from + 1; i < to; i++) { const d = ir[i] - ir[i - 1]; h += d * d; a += ir[i] * ir[i]; } return h / a; };
  ok('damping: the tail\'s high share falls as it decays; an undamped tail\'s does not', hiShare(damped, pre + 48000, pre + 52800) < 0.5 * hiShare(damped, pre, pre + 4800) && near(hiShare(L, pre + 48000, pre + 52800), hiShare(L, pre, pre + 4800), 0.2 * hiShare(L, pre, pre + 4800)));
  const imp = new Float32Array(SR * 2); imp[0] = 1;
  const wet = renderFx([imp, imp], SR, room);
  ok('a reverb at full mix turns an impulse into its own room, exactly', wet.every((y, c) => { let e = 0; for (let i = 0; i < irs[c].length; i++) e = Math.max(e, Math.abs(y[i] - irs[c][i])); return e < 1e-6; }));
  ok('a mono sound gets a mono room', reverbImpulse(SR, room, 1).length === 1 && renderFx([imp], SR, room).length === 1);
}

// ── effects: chains, presets, determinism, robustness, speed ──────────────

{
  const x = stereo(music(2, 6));
  const before = hash(x);
  const chain = readChain([{ type: 'eq', lowGain: 3 }, { type: 'compressor' }, { type: 'reverb' }]);
  const a = renderChain(x, SR, chain);
  ok('renderChain is deterministic: the same input, the same bytes', hash(renderChain(x, SR, chain)) === hash(a));
  ok('renderChain leaves its input alone and hands back new arrays', hash(x) === before && a[0] !== x[0] && a.length === 2 && a[0].length === x[0].length);
  ok('an effect that is off is skipped; an entry that does not read is skipped', hash(renderChain(x, SR, [...chain, { type: 'delay', on: false }, { type: 'flanger' }])) === hash(a));
  ok('an empty chain is a copy', hash(renderChain(x, SR, [])) === before && renderChain(x, SR, [])[0] !== x[0]);
  const env = chainEnvelopes(x, SR, chain);
  ok('chainEnvelopes: a gain for the compressor, null for the rest', env[0] === null && env[1] instanceof Float32Array && env[1].length === x[0].length && env[2] === null);
  ok('presets: Warm, Clear, Room, Radio, Wide', FX_PRESETS.join() === 'warm,clear,room,radio,wide' && FX_PRESETS.every((p) => typeof PRESET_LABELS[p] === 'string'));
  ok('each preset is an ordinary chain, with ids of its own, and renders finite', FX_PRESETS.every((p) => { const c = presetChain(p); return c.length > 0 && c.every((fx, i) => fx.id === `${p}-${i + 1}` && readFx(fx)) && allFinite(renderChain(x, SR, c)); }));
  ok('an unknown preset is an empty chain', presetChain('loud').length === 0);
  const radio = renderChain([tone(150, -20, 1)], SR, presetChain('radio'))[0];
  const radioMid = renderChain([tone(1500, -20, 1)], SR, presetChain('radio'))[0];
  ok('Radio takes the low end away and keeps the middle', rmsOf(radio, SR / 2) < 0.1 * rmsOf(radioMid, SR / 2));
}
{
  const inputs = [[], [new Float32Array(0)], [new Float32Array(100)], [square(1, 1000)], [new Float32Array(1000).fill(1)], [new Float32Array(1000).fill(-1)],
    [Float32Array.from([0.5])], [new Float32Array(500).fill(NaN)], [new Float32Array(500).fill(Infinity)], [new Float32Array(500).fill(1e30)], [noise(700, 1), noise(300, 2)]];
  const rates = [0, NaN, -1, 8000, 44100, 1e9];
  const fxs = FX_TYPES.flatMap((t) => {
    const lo = { type: t }; const hi = { type: t };
    for (const [k, s] of Object.entries(FX_SPECS[t])) { lo[k] = s.min; hi[k] = s.max; }
    return [defaultFx(t), readFx(lo), readFx(hi), readFx({ ...lo, mode: 'lowpass', slope: 24, truePeak: false })];
  });
  let bad = 0; let runs = 0;
  for (const sig of inputs) for (const sr of rates) {
    for (const fx of fxs) {
      // A long room at a high rate is a long convolution; the 30 s chain below times one. Here, rooms up to 30000 samples.
      if (fx.type === 'reverb' && reverbSeconds(fx.size) * sampleRateOr(sr) > 30000) continue;
      runs++;
      if (!allFinite(renderFx(sig, sr, fx))) bad++;
    }
    const l = measureLoudness(sig, sr);
    if (![l.lufs, l.peakDb, l.samplePeakDb].every((v) => Number.isFinite(v) || v === -Infinity) || !Number.isFinite(l.range)) bad++;
  }
  ok(`no NaN or Infinity out of any effect or the meter for empty, silent, full-scale, DC, one-sample, NaN, Infinity or huge input at any rate (${runs} runs)`, bad === 0, bad);
  const r = mulberry32(99);
  const junk = () => { const k = Math.floor(r() * 8); return [null, undefined, NaN, Infinity, -1e9, 'x', {}, [r()]][k]; };
  let threw = 0;
  for (let i = 0; i < 500; i++) {
    const obj = { type: FX_TYPES[i % 6], id: junk(), on: junk(), mode: junk(), slope: junk(), truePeak: junk() };
    for (const k of Object.keys(FX_SPECS[FX_TYPES[i % 6]])) obj[k] = r() < 0.5 ? junk() : (r() - 0.5) * 1e6;
    try {
      const fx = readFx(obj);
      if (!fx || !Object.entries(FX_SPECS[fx.type]).every(([k, s]) => fx[k] >= s.min && fx[k] <= s.max)) threw++;
      const lane = readLane({ target: r() < 0.5 ? 'volume' : 'fx.a.mix', points: [{ t: junk(), v: junk(), curve: junk(), viaX: junk(), viaY: junk() }, { t: r() * 10, v: r() * 10 - 5, curve: CURVES[i % 4], viaX: r(), viaY: r() }] });
      if (!allFinite([render(lane, 100, 50)])) threw++;
      const d = readDuck({ depth: junk(), attack: junk(), release: junk(), hold: junk(), lead: junk(), threshold: junk(), range: junk(), minSpeech: junk() });
      if (!Object.values(d).every(Number.isFinite)) threw++;
      if (!duckLaneFor([{ start: junk(), end: junk() }, null, { start: r() * 5, end: r() * 9 }], d).points.every((p) => Number.isFinite(p.t) && Number.isFinite(p.v))) threw++;
    } catch { threw++; }
  }
  ok('the readers (effects, lanes, ducking) never throw and always land in range, for 500 junk inputs', threw === 0, threw);
}
{
  const x = [music(30, 3), music(30, 11)];
  const chain = readChain([{ type: 'eq', lowGain: 3, midGain: -2, highGain: 2 }, { type: 'filter', mode: 'highpass', freq: 80 }, { type: 'compressor' }, { type: 'delay' }, { type: 'reverb' }, { type: 'limiter' }]);
  const t = time(2, () => renderChain(x, SR, chain));
  timings.push(['six-effect chain over 30 s stereo 48 kHz', t.ms]);
  ok(`a six-effect chain over 30 s of stereo takes under 1.5 s (${t.ms.toFixed(0)} ms)`, t.ms < 1500);
  ok('...and its output is finite and the same length', allFinite(t.value) && t.value[0].length === 30 * SR);
}

// ── effects: the Web Audio builders ───────────────────────────────────────

{
  const sr = 8000;
  const n = 2400;
  const a = noise(n, 31, 0.8).map((v, i) => (i < 1200 ? v : v * 0.2));
  const sig = [a, a.map((v) => -0.5 * v)];
  const diff = (p, q) => { let d = 0; for (let c = 0; c < p.length; c++) for (let i = 0; i < p[c].length; i++) d = Math.max(d, Math.abs(p[c][i] - q[c][i])); return d; };
  const run = (fx, opts = {}) => {
    const ctx = new FakeAudioContext(sr);
    const node = buildFx(ctx, readFx(fx), { channels: 2, ...opts });
    return { ctx, node, out: simulate(ctx, node.input, node.output, sig) };
  };
  const cases = [
    ['EQ', { type: 'eq', lowGain: 5, midGain: -6, midFreq: 900, highGain: 4, highFreq: 2500 }],
    ['high-pass 12', { type: 'filter', mode: 'highpass', freq: 300, q: 1.4 }],
    ['low-pass 24', { type: 'filter', mode: 'lowpass', freq: 1500, slope: 24 }],
    ['delay', { type: 'delay', time: 40, feedback: 0.6, mix: 0.5 }],
    ['reverb', { type: 'reverb', size: 0, predelay: 7, mix: 0.4, seed: 3 }],
  ];
  for (const [name, fx] of cases) {
    const { node, out } = run(fx);
    const d = diff(out, renderFx(sig, sr, readFx(fx)));
    ok(`the ${name} builder computes what the export computes (max difference ${d.toExponential(1)})`, node.exact && d < 1e-5, d);
  }
  for (const fx of [{ type: 'compressor', threshold: -30, ratio: 5, attack: 2 }, { type: 'limiter', ceiling: -8 }]) {
    const env = chainEnvelopes(sig, sr, [readFx(fx)])[0];
    const { ctx, node, out } = run(fx, { envelope: env, rate: sr });
    const d = diff(out, renderFx(sig, sr, readFx(fx)));
    const curve = ctx.ofKind('gain')[0].gain.calls.find((c) => c[0] === 'setValueCurveAtTime');
    ok(`the ${fx.type} builder, given its envelope, plays the export's own gain (max difference ${d.toExponential(1)})`, node.exact && d < 1e-6 && curve && curve[2] === 0 && near(curve[3], (n - 1) / sr, 1e-12), d);
  }
  const chain = readChain([{ type: 'eq', lowGain: 4, midGain: -3, highGain: 5, highFreq: 3000 }, { type: 'filter', mode: 'lowpass', freq: 2500, slope: 24 }, { type: 'compressor', threshold: -30, ratio: 4 },
    { type: 'delay', time: 40, feedback: 0.5, mix: 0.4 }, { type: 'reverb', size: 0, predelay: 5, mix: 0.3 }, { type: 'limiter', ceiling: -6 }, { type: 'delay', on: false }]);
  const ctx = new FakeAudioContext(sr);
  const built = buildChain(ctx, chain, { channels: 2, envelopes: chainEnvelopes(sig, sr, chain), rate: sr });
  const d = diff(simulate(ctx, built.input, built.output, sig), renderChain(sig, sr, chain));
  ok(`the whole six-effect chain, built and played, is the export sample for sample (max difference ${d.toExponential(1)})`, built.exact && built.nodes.length === 6 && d < 1e-5, d);
  const loose = buildChain(new FakeAudioContext(sr), chain);
  ok('without envelopes the chain is marked inexact', loose.exact === false && loose.nodes.filter((x) => !x.exact).length === 2);
  built.dispose();
  ok('dispose leaves nothing connected', ctx.edges().length === 0);
}
{
  const sr = 48000;
  const ctx = new FakeAudioContext(sr);
  const eq = readFx({ type: 'eq', lowGain: 2, midGain: 3, highGain: -4 });
  const node = buildFx(ctx, eq);
  const iirs = ctx.ofKind('iir');
  const s = eqSections(eq, sr);
  ok('EQ: input → three IIR filters with this file\'s coefficients → output', ctx.edges().length === 4 && iirs.length === 3 &&
    iirs.every((f, i) => f.feedforward.join() === [s[i].b0, s[i].b1, s[i].b2].join() && f.feedback.join() === [1, s[i].a1, s[i].a2].join()));
  ok('EQ update: in place, new coefficients, the old filters unplugged', node.update(readFx({ ...eq, midGain: -9 })) && ctx.ofKind('iir').length === 6 && ctx.edges().length === 4 &&
    ctx.ofKind('iir').slice(3)[1].feedforward[0] === eqSections(readFx({ ...eq, midGain: -9 }), sr)[1].b0);
  ok('update refuses another type, and an effect switched off', node.update(defaultFx('delay')) === false && node.update({ ...eq, on: false }) === false);
}
{
  const ctx = new FakeAudioContext(48000);
  const fx = readFx({ type: 'delay', time: 100, feedback: 0.3, mix: 0.25 });
  const node = buildFx(ctx, fx);
  const lines = ctx.ofKind('delay');
  const [inp, dry, wet, out, feed, ...taps] = ctx.ofKind('gain');
  const K = echoCount(fx);
  const want = [`${inp.label} -> ${dry.label}`, `${inp.label} -> ${feed.label}`, `${dry.label} -> ${out.label}`, `${wet.label} -> ${out.label}`, `${feed.label} -> ${lines[0].label}`];
  for (let k = 0; k < K; k++) {
    if (k > 0) want.push(`${lines[k - 1].label} -> ${lines[k].label}`);
    want.push(`${lines[k].label} -> ${taps[k].label}`, `${taps[k].label} -> ${wet.label}`);
  }
  ok(`delay: input → dry → out; input → feed → a cascade of ${K} lines, each tapped into wet → out; no loop`, lines.length === K && taps.length === K && ctx.edges().join('|') === want.sort().join('|'), ctx.edges());
  ok('delay: each line the time in whole samples, each tap feedback^k, the mix', lines.every((l) => l.delayTime.value === 0.1 && l.maxDelayTime > 0.1) && taps.every((t, k) => t.gain.value === 0.3 ** k) && dry.gain.value === 0.75 && wet.gain.value === 0.25);
  ok('delay update: the same shape changes values in place', node.update({ ...fx, feedback: 0.31, mix: 0.5 }) && ctx.ofKind('delay').length === K && taps[1].gain.value === 0.31 && wet.gain.value === 0.5);
  ok('delay update: a new time is a new cascade, the old one unplugged', node.update({ ...fx, time: 200 }) && ctx.ofKind('delay').length === 2 * K && lines.every((l) => l.outs.size === 0 && l.ins.size === 0) && feed.outs.size === 1);
  const sim = simulate(ctx, node.input, node.output, [Float32Array.from({ length: 30000 }, (_, i) => (i === 0 ? 1 : 0))])[0];
  ok('...and plays the new time', near(sim[9600], 0.25, 1e-7) && sim[4800] === 0);
  const loop = new FakeAudioContext(48000);
  const a = loop.createGain(); const d = loop.createDelay(1); const b = loop.createGain();
  a.connect(d); d.connect(b); b.connect(d); d.connect(a);
  let refused = false;
  try { simulate(loop, a, d, [new Float32Array(10)]); } catch (e) { refused = /feedback loop/.test(String(e)); }
  ok('the fake refuses a feedback loop (engines play them differently)', refused);
}
{
  const ctx = new FakeAudioContext(48000);
  const room = readFx({ type: 'reverb', size: 0.2, mix: 0.3 });
  const node = buildFx(ctx, room, { channels: 2 });
  const [conv] = ctx.ofKind('convolver');
  const sets = ctx.log.filter((e) => e[0] === 'set' && e[1] === conv.label).map((e) => e[2]);
  ok('reverb: normalize is turned off before the buffer is set (the order matters)', sets.join() === 'normalize,buffer' && conv.normalize === false);
  ok('reverb: the buffer is this file\'s room, both sides', conv.buffer.numberOfChannels === 2 && hash([conv.buffer.getChannelData(0), conv.buffer.getChannelData(1)]) === hash(reverbImpulse(48000, room, 2)));
  ok('reverb: input → dry → out, input → convolver → wet → out', ctx.edges().length === 5 && ctx.edges().some((e) => e.endsWith(`-> ${conv.label}`)));
  ok('reverb, mono: a one-sided room', buildFx(new FakeAudioContext(48000), room, { channels: 1 }) && new FakeAudioContext(48000) && (() => { const c = new FakeAudioContext(48000); buildFx(c, room, { channels: 1 }); return c.ofKind('convolver')[0].buffer.numberOfChannels === 1; })());
  ok('reverb update: a new room is a new convolver, the old unplugged; the mix changes in place', node.update({ ...room, size: 0.6, mix: 0.5 }) && ctx.ofKind('convolver').length === 2 && ctx.ofKind('convolver')[0].outs.size === 0 &&
    node.update({ ...room, size: 0.6, mix: 0.1 }) && ctx.ofKind('convolver').length === 2);
}
{
  const ctx = new FakeAudioContext(48000);
  const node = buildFx(ctx, readFx({ type: 'compressor', threshold: -30, attack: 20, release: 3000, makeup: 6 }));
  const [dc] = ctx.ofKind('dynamics');
  ok('compressor without an envelope: the browser\'s compressor, then make-up, marked inexact', !node.exact && dc.threshold.value === -30 && dc.attack.value === 0.02 && dc.release.value === 1 && ctx.ofKind('gain')[0].gain.value === dbToGain(6));
  ok('...which can be re-parameterised', node.update(readFx({ type: 'compressor', threshold: -10 })) && dc.threshold.value === -10);
  const l = new FakeAudioContext(48000);
  buildFx(l, readFx({ type: 'limiter', ceiling: -2 }));
  ok('limiter without an envelope: ratio 20, no knee, threshold at the ceiling', l.ofKind('dynamics')[0].ratio.value === 20 && l.ofKind('dynamics')[0].knee.value === 0 && l.ofKind('dynamics')[0].threshold.value === -2);
  const e = new FakeAudioContext(48000);
  const exact = buildFx(e, readFx({ type: 'limiter' }), { envelope: new Float32Array((1 << 20) + 5).fill(0.5), startAt: 2 });
  const curve = e.ofKind('gain')[0].gain.calls.find((c) => c[0] === 'setValueCurveAtTime');
  ok('a long envelope is decimated to at most 2^20 points over the same span, from startAt', curve[1].length <= 1 << 20 && curve[2] === 2 && near(curve[3], ((1 << 20) + 4) / 48000, 2 / 48000) && exact.update(defaultFx('limiter')) === false);
  const one = new FakeAudioContext(48000);
  buildFx(one, readFx({ type: 'limiter' }), { envelope: Float32Array.from([0.7]) });
  ok('a one-sample envelope is a set, not a curve', one.ofKind('gain')[0].gain.calls[0][0] === 'setValueAtTime');
  const off = new FakeAudioContext(48000);
  const through = buildFx(off, { type: 'eq', on: false });
  ok('an effect that is off builds a pass-through', through.input === through.output && off.nodes.length === 1);
}

// ── ducking ───────────────────────────────────────────────────────────────

console.log('audioduck');
{
  ok('ducking defaults: x0.25, 0.15 s attack, 0.4 s release (RESEARCH.md)', DUCK_DEFAULTS.depth === 0.25 && DUCK_DEFAULTS.attack === 0.15 && DUCK_DEFAULTS.release === 0.4);
  const d = readDuck({ attack: 0.3, depth: 2, release: -1 });
  ok('readDuck: clamped; the lead follows the attack unless given', d.depth === 1 && d.release === 0.01 && d.lead === 0.3 && readDuck({ attack: 0.3, lead: 0 }).lead === 0);
  const voice = [cat(new Float32Array(SR), tone(220, -20, 2), new Float32Array(SR * 2))];
  const spans = findSpeech(voice, SR);
  ok('findSpeech: a voice from 1 s to 3 s is found there, within one window (20 ms)', spans.length === 1 && near(spans[0].start, 1, 0.02) && near(spans[0].end, 3, 0.02), spans);
  const roomTone = [cat(tone(220, -20, 1), noise(SR, 3, dbToGain(-60)), tone(220, -20, 1))];
  ok('a room tone 40 dB under the voice is not speech', findSpeech(roomTone, SR).length === 2);
  const click = [cat(new Float32Array(SR), tone(1000, -10, 0.02), new Float32Array(SR))];
  ok('a 20 ms click is not speech', findSpeech(click, SR).length === 0);
  ok('silence and nothing have no speech', findSpeech([new Float32Array(SR)], SR).length === 0 && findSpeech([], SR).length === 0);
}
{
  const lane = duckLaneFor([{ start: 1, end: 3 }]);
  const want = [[0, 1], [0.85, 1], [1, 0.25], [3.3, 0.25], [3.7, 1]];
  ok('the lane for speech from 1 s to 3 s: down from 0.85 s, at 0.25 by 1 s, held to 3.3 s, back to 1 by 3.7 s',
    lane.points.length === 5 && lane.points.every((p, i) => near(p.t, want[i][0], 1e-12) && p.v === want[i][1]), lane.points);
  ok('the attack and release are geometric (even in dB): x0.5 halfway down and halfway up', near(valueAt(lane, 0.925), 0.5, 1e-9) && near(valueAt(lane, 3.5), 0.5, 1e-9) && valueAt(lane, 2) === 0.25 && valueAt(lane, 4) === 1);
  const g = render(lane, 1000, 5000);
  const first = (pred) => g.findIndex(pred) / 1000;
  ok('measured off the rendered gain: 0.15 s from the first dip to x0.25, 0.4 s from the first rise to x1', near(first((v) => v === Math.fround(0.25)) - first((v) => v < 1), 0.15, 0.0011) &&
    near(g.findIndex((v, i) => i > 3300 && v === 1) / 1000 - 3.3, 0.4, 0.0011));
  ok('the duck lane is a lane the reader keeps as it is', JSON.stringify(readLane(lane)) === JSON.stringify(lane));
  const merged = duckLaneFor([{ start: 1, end: 2 }, { start: 2.5, end: 3 }]);
  ok('two stretches too close to come back up between are one', merged.points.length === 5 && valueAt(merged, 2.25) === 0.25);
  const apart = duckLaneFor([{ start: 1, end: 2 }, { start: 4, end: 5 }]);
  ok('two stretches far apart are two ducks, back to x1 between', apart.points.length === 9 && valueAt(apart, 3.2) === 1);
  const early = duckLaneFor([{ start: 0.05, end: 1 }]);
  ok('speech at the very start: the music starts down', early.points[0].t === 0 && early.points[0].v === 0.25);
  ok('no speech, no duck', duckLaneFor([]).points.length === 1 && valueAt(duckLaneFor([]), 3) === 1);
  // An hour and a half of talk, a sentence every three seconds: more stretches than one lane can hold.
  const talk = Array.from({ length: 1800 }, (_, i) => ({ start: i * 3, end: i * 3 + 2 + (i % 7) * 0.1 }));
  const long = duckLaneFor(talk);
  ok(`a very long talk still fits one lane (${long.points.length} points, at most ${MAX_POINTS}), bridging the shortest pauses, and ends back at x1`,
    long.points.length <= MAX_POINTS && readLane(long).points.length === long.points.length && valueAt(long, 1800 * 3 + 5) === 1 && valueAt(long, 1) === 0.25);
  const hand = { target: 'volume', points: [{ t: 2, v: 0.5 }, { t: 1, v: NaN }, { t: 0, v: 9 }] };
  ok('render and planLane read a hand-built lane first (unsorted, NaN, out of range)', render(hand, 10, 30).every((v) => v >= 0 && v <= 4) && render(hand, 10, 30)[0] === 4 && planLane(hand, 0).every((o) => o.kind !== 'set' || Number.isFinite(o.value)));
  ok('a depth of 0 ducks to silence through the floor, finite throughout', allFinite([render(duckLaneFor([{ start: 1, end: 2 }], { depth: 0 }), 1000, 4000)]) && valueAt(duckLaneFor([{ start: 1, end: 2 }], { depth: 0 }), 1.5) === 0);
  const ctx = new FakeAudioContext(1000);
  const p = ctx.createGain();
  compile(lane, p.gain, 0);
  let err = 0;
  for (let t = 0; t < 5; t += 0.001) err = Math.max(err, Math.abs(p.gain.valueAt(t) - valueAt(lane, t)));
  ok('compiled onto a GainNode, the duck is the export\'s duck exactly (only ramps, no curves)', err < 1e-9 && !p.gain.calls.some((c) => c[0] === 'setValueCurveAtTime'), err);
}
{
  const voice = [cat(new Float32Array(SR), tone(220, -20, 2), new Float32Array(SR * 2))];
  const bed = stereo(new Float32Array(SR * 5).fill(0.5));
  const ducked = duckBed(bed, voice, SR);
  ok('duckBed: the bed at x0.25 under the voice and x1 away from it', near(ducked[0][2 * SR], 0.125, 1e-6) && ducked[1][Math.round(0.5 * SR)] === 0.5 && near(ducked[0][Math.round(4.5 * SR)], 0.5, 1e-6));
  ok('duckBed is applyLane with duckLane', hash(ducked) === hash(applyLane(bed, duckLane(voice, SR), SR)));
  const shifted = applyLane([new Float32Array(1000).fill(1)], duckLaneFor([{ start: 1, end: 3 }]), 1000, 2);
  ok('applyLane from an offset reads the lane from there', shifted[0][0] === 0.25 && near(shifted[0][999], valueAt(duckLaneFor([{ start: 1, end: 3 }]), 2.999), 1e-6));
  ok('applyLane leaves its input alone', bed[0][2 * SR] === 0.5);
}

console.log('\n  timings (best run):');
for (const [what, ms] of timings) console.log(`    ${ms.toFixed(0).padStart(5)} ms  ${what}`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
