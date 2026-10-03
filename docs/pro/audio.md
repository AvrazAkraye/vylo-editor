# The audio library (work package 02)

Five modules, no dependency, no user interface: the base for sound in Motion now and for a
proper mix in Video later. Their job is to be **right**: a loudness meter that reads what a
broadcast meter reads, effects whose preview is the export, envelopes that land where they
were drawn. Every claim below is a known-answer test in `app/test/pro-audio.test.mjs`
(247 assertions, about 5 s), and the preview claims were also measured once in the app's own
engine (macOS 26.2 WKWebView).

| file | what it is | lines |
|---|---|---|
| `audiocore.ts` | dB, clamp, seeded PRNG, channel layouts, resampling, mixing, fades, soft clip, biquads, FFT and convolution, the 4x true-peak interpolator | 840 |
| `loudness.ts` | ITU-R BS.1770-4 integrated loudness, true peak, EBU Tech 3342 loudness range, normalisation | 340 |
| `audioauto.ts` | automation lanes: reader, curves, offline render, Web Audio schedule (Apache-2.0 portions, see `credits/02.md`) | 540 |
| `audiofx.ts` | six effects (descriptor + reader, pure offline path, Web Audio builder), five presets | 970 |
| `audioduck.ts` | speech detection and the ducking lane | 225 |
| `test/audiofake.mjs` | a recording fake `AudioContext` that also plays the AudioParam timeline and runs a graph | 330 |

All pure (new arrays out, inputs untouched), all deterministic (the same input is the same
bytes, checked by hash), all total: no input, including no channels, empty, silence, full scale,
DC, one sample, NaN, Infinity or 1e30, at any sample rate, produces NaN or Infinity (the only
infinity is the contract's `-Infinity` for the loudness of silence).

## API

### `audiocore.ts`

```ts
dbToGain(db) / gainToDb(g)      // -Infinity ↔ 0; NaN dB is unity; gainToDb never below DB_FLOOR (-200)
clamp(x, lo, hi), finiteOr(x, fallback), sampleRateOr(rate)
mulberry32(seed) → () => [0,1)  // the textbook algorithm, checked value for value
seedFrom(...numbers) → uint32
frames(ch), conform(ch)         // conform: equal lengths, non-finite samples read as silence
interleave(ch), deinterleave(data, channels)
mixdown(ch)                     // the mean of the channels
mixInto(target, source, gain = 1, at = 0)
fadeEdges(ch, rate, fadeIn, fadeOut)          // raised cosine
softClipSample(x, knee = 0.8), softClip(ch, knee)
samplePeak(ch), truePeakOf(ch), intervalPeaks(x)
runBiquads(x, sections), biquadResponseDb(sections, freq, rate)
resampleLinear(x, from, to), resampleSinc(x, from, to), resample(ch, from, to, 'sinc' | 'linear')
fft(re, im, inverse = false), convolve(x, h, length = x.length)
```

### `loudness.ts` (the Phase 0 contract kept: package 04 calls these names)

```ts
interface Loudness { lufs; peakDb }                                   // exactly the placeholder's shape
interface LoudnessReport extends Loudness { truePeakDb; samplePeakDb; range }
measureLoudness(channels, sampleRate, { weights?, truePeak? } = {}) → LoudnessReport
gainToTarget(measured, targetLufs = -16, ceilingDb = -1.5) → linear gain
loudnessPlan(measured, { target?, ceiling?, maxGainDb? }) → { gain, gainDb, limitedBy, projectedLufs, projectedPeakDb }
normalizeLoudness(channels, rate, opts) → { channels, measured, plan }
kWeighting(rate) → { shelf, highpass }
DELIVERY_LUFS = -16, DELIVERY_CEILING_DB = -1.5
```

**Changed meaning, same name:** `peakDb` is now the **true peak** (dBTP, 4x oversampled), as the
placeholder's comment said it would be. The new fields live on `LoudnessReport`, so `Loudness`
is still exactly `{ lufs, peakDb }` and code written against the placeholder (a literal, a
variable typed `Loudness`) compiles unchanged (checked with `tsc`). `truePeakDb` is the same
number as `peakDb`; `samplePeakDb` is the old meaning; `range` is new. `gainToTarget` keeps its
defaults and its silence rule (1).

### `audioauto.ts`

```ts
{ version: 1, lanes: [{ target: 'volume' | 'rate' | 'fx.<id>.<knob>', points: [{ t, v, curve?, viaX?, viaY? }] }] }
CURVES = ['linear', 'hold', 'exp', 'bezier']
readAutomation(x, resolve?), readLane(x, range?), parseTarget(t), rangeOf(t, resolve?)
valueAt(lane, t), render(lane, rate, n, start = 0) → Float32Array
planLane(lane, t0, from?) → ParamOp[]          // pure: what compile will call
compile(lane, param, t0, from?) → ParamOp[]    // onto any AudioParam
VOLUME_RANGE (0..4), RATE_RANGE (0.25..4), MAX_POINTS 4096, MAX_LANES 32, EXP_FLOOR 1e-4
```

`exp` is geometric (even in dB; to or from 0 it runs through -80 dB and lands on 0 at the
point); `bezier` with a via point is the rational quadratic arc through it (from HyperFrames),
without one a smoothstep. `t0` is the context time of the lane's 0; `from` is when to start
scheduling (a preview that starts mid-lane).

### `audiofx.ts`

```ts
type Fx = EqFx | FilterFx | CompressorFx | LimiterFx | DelayFx | ReverbFx   // flat, { type, id?, on?, ...knobs }
FX_TYPES, FX_SPECS (each knob's min/max/def/unit/log), MAX_CHAIN 16
readFx(x), readChain(x), defaultFx(type), fxRangeResolver(chain)
renderChain(channels, rate, chain) → channels      // the export
renderFx(channels, rate, fx)
chainEnvelopes(channels, rate, chain) → (Float32Array | null)[]   // dynamics gains, for an exact preview
buildFx(ctx, fx, { channels?, envelope?, rate?, startAt? }) → { input, output, exact, update(fx), dispose() }
buildChain(ctx, chain, { channels?, envelopes?, rate?, startAt? }) → { input, output, nodes, exact, dispose() }
eqSections, filterSections, fxResponseDb, compressorCurveDb, delaySamples, echoCount, reverbSeconds, reverbImpulse
FX_PRESETS ['warm','clear','room','radio','wide'], PRESET_LABELS (English, for t()), presetChain(id)
```

| effect | knobs (unit, default) |
|---|---|
| `eq` | lowFreq (Hz, 120), lowGain (dB, 0), midFreq (1000), midGain (0), midQ (1), highFreq (8000), highGain (0) |
| `filter` | mode highpass/lowpass, freq (Hz, 100), q (0.7071, at 12 dB/oct), slope 12 / 24 (Butterworth) |
| `compressor` | threshold (dB, -18), ratio (3), knee (dB, 6), attack (ms, 10), release (ms, 150), makeup (dB, 0) |
| `limiter` | ceiling (dB, -1), lookahead (ms, 5), release (ms, 100), truePeak (true) |
| `delay` | time (ms, 250), feedback (0.35), mix (0.3) |
| `reverb` | size (0.5 → RT60 0.3..3 s), damping (0.5), predelay (ms, 10), mix (0.25), seed (1) |

### `audioduck.ts`

```ts
DUCK_DEFAULTS { depth 0.25, attack 0.15, release 0.4, hold 0.3, lead = attack, threshold -45, range 30, minSpeech 0.05 }
readDuck(o), findSpeech(voice, rate, o) → [{ start, end }]
duckLaneFor(spans, o) → Lane, duckLane(voice, rate, o) → Lane
applyLane(channels, lane, rate, start = 0), duckBed(bed, voice, rate, o)
```

## How it is known to be right

**Loudness** (EBU Tech 3341 and 3342 signals, synthesised in the test):

| signal | expected | read |
|---|---|---|
| 997 Hz stereo sine, -23 dBFS | -23.0 ±0.1 LUFS | -23.000 |
| case 2 (-33 dBFS) | -33.0 | -32.99 |
| case 3 (-36/-23/-36), case 4 (-72/-36/-23/-36/-72) | -23.0 (gates) | -23.01 |
| case 5 (-26/-20/-26) | -23.0 | -22.98 |
| steps of 10 dB | 10 LU apart | 10.00 |
| the same tone at 32, 44.1, 96 kHz | -23.0 ±0.1 | within 0.03 |
| 3342 cases 1-4 | LRA 10, 5, 20, 15 ±1 | 10.0, 5.0, 20.0, 15.0 |
| 12 kHz tone, samples at 0 dBFS, crests between | +3.01 dBTP | +3.01 |
| tones to 18 kHz at any phase, -6 dBFS | -6 dBTP, low by at most the 4x grid's bound | within it |
| silence, nothing, all-NaN | -Infinity | -Infinity |

The K-weighting coefficients at 48 kHz equal BS.1770-4's table to 1e-9; at other rates they are
derived from the same analogue prototype. 5.0 and 5.1 take the standard's channel weights.

**Filters:** exact values at DC, the corner and Nyquist (cookbook shelves and peak), and the
Butterworth magnitude through the bilinear transform at every tested frequency to 1e-6 dB; a
sine through the filter comes out at the designed level within 0.02 dB. **Compressor:** a steady
square settles on the static curve within 0.001 dB from -40 to 0 dB, soft knee included; attack
and release reach 63.2% in one time constant. **Limiter:** no sample past the ceiling for music
x8, noise at 4, full scale, DC at 2, impulses at 10, a +6 dB 18 kHz tone; with true peak, no
oversampled point past it either (measured within 0.05 dB). **Reverb:** unit energy, Schroeder
RT60 within 10% of the design, uncorrelated sides, every 100 ms quieter than the last, a
damped tail losing its highs, the same bytes per seed. **Delay:** an impulse returns at D, 2D,
3D with mix, mix·fb, mix·fb², exactly; the series ends at -80 dB. **Automation:** the curve
values; the plan replayed through a model of Web Audio's timeline lands on `render` exactly
(float32) for linear, hold and geometric segments and within 0.001 for curves. **Ducking:** the
lane's points and its 0.15 s and 0.4 s ramps read off the rendered gain.

**Speed** (best of a few runs on the owner's Mac while nine packages built in parallel):

| work | brief's budget | measured |
|---|---|---|
| measure 30 s stereo at 48 kHz, music-like | 150 ms | 45-60 ms |
| ... white noise / a steady full-level tone (nothing to skip) | | 80-120 / 70-85 ms |
| six-effect chain over 30 s stereo | 1.5 s | 400-490 ms |
| resample 30 s mono 44.1 → 48 kHz (sinc) | | 260-280 ms |

## Why the preview is the export

`renderChain` is the export. Each builder is made of nodes that compute the same arithmetic:
EQ and filters as `IIRFilterNode`s fed this file's coefficients (the browser's
`BiquadFilterNode` reads a low/high-pass Q in decibels: measured in WebKit, Q 0.707 gives
+0.71 dB at the corner); the delay as a cascade of `DelayNode`s with one tap per echo; the
reverb as a `ConvolverNode` with `normalize = false` and the same seeded room; the compressor and
limiter, which no Web Audio node can run without a worklet, as the export's own gain played on
a `GainNode` from `chainEnvelopes` (exact), or the browser's `DynamicsCompressorNode` when no
envelope is given (`exact: false`).

**Measured in the app's WebKit** (an `OfflineAudioContext` in a WKWebView, one second of
stereo noise at 48 kHz, builder against `renderChain` in the same page):

| | max difference |
|---|---|
| EQ, high-pass 12, low-pass 24, compressor and limiter with envelopes | 0 (bit for bit) |
| reverb | 1.8e-7 |
| delay (40 ms, feedback 0.6) | 1.1e-4 (the delay time is a float32 AudioParam, so a hair off a whole sample, and WebKit interpolates) |
| a six-effect chain | 9e-6 |
| compressor / limiter without envelopes (the browser's own) | 0.57 / 1.0 (inexact, as declared) |
| a mixed automation lane via `compile` | 3.7e-4 (curve segments), the duck lane 2.2e-6 |

That run also found the one place the spec-based fake was wrong: **WebKit adds a 128-sample
render quantum to every trip round a feedback loop through a `DelayNode`** (an echo asked for
at 48 samples comes back at 48, then 224); Chromium clamps the loop's delay to 128 instead. The
first delay builder was a loop and was off by 0.72; it is now a loop-free cascade, and the fake
refuses any cycle. WebKit accepts events at a value curve's start and end and refuses one
inside it, as `compile` assumes.

To run the WebKit check again: the harness is `app/.test-build/audio-harness/` (git-ignored:
`webkit-host.swift`, `check.ts`, `run.mjs`), the WKWebView host from the Motion pass with one
change: it loads the page with `loadHTMLString` (a page over loopback never committed under this
session's sandbox). It needs the sandbox off for the WebKit helper processes, a non-persistent
data store, and touches nothing of the owner's.

## Using it

```ts
// A bed at delivery level: measure, gain, then hold the true peak.
const { channels } = normalizeLoudness(bed, 48000);               // -16 LUFS, peak ≤ -1.5 dBTP
const out = renderChain(channels, 48000, [{ type: 'limiter', ceiling: -1.5 }]);

// Effects: export and an exact preview of the same thing.
const chain = presetChain('clear');
const exported = renderChain(voice, 48000, chain);
const node = buildChain(ctx, chain, { channels: 2, envelopes: chainEnvelopes(voice, 48000, chain), startAt: t });

// Music under a voice.
const lane = duckLane(voice, 48000);           // a volume lane, editable like any other
const ducked = applyLane(music, lane, 48000);  // export
compile(lane, musicGain.gain, t);              // preview: the same envelope, exactly (ramps only)
```

## Deviations from the brief

- **Delay with feedback is a finite series** (every echo down to -80 dB: 14 at feedback 0.5, 88
  at 0.9), not a feedback loop, so that the preview equals the export in every engine (above).
- **Dynamics in the preview are exact only with envelopes.** `chainEnvelopes` is the offline
  chain run once; any change upstream of a compressor or limiter means computing it again. A
  live input falls back to `DynamicsCompressorNode` (`exact: false`).
- **EQ and filters use `IIRFilterNode`**, not `BiquadFilterNode`: exact, but their coefficients
  are fixed, so `update` swaps nodes (the filter state restarts, which can tick once on a loud
  signal) and filter knobs are not AudioParams.
- **Effect-knob automation is read but not rendered.** Lanes on `fx.<id>.<knob>` are read and
  clamped to the knob's range (`fxRangeResolver`), and `compile` can drive any AudioParam, but
  `renderChain` applies static knobs only and the builders expose no knob AudioParams. Volume
  lanes (fades, ducking) are complete in both paths.
- **The FFT "carve" (stretch) is not done.** Ducking finds speech with HyperFrames' "30 dB
  under the voice's peak" idea, and `fft`/`convolve` are in place for it.
- **Additions:** the loudness range; `loudnessPlan` (what held the gain: target, ceiling, a
  gain cap, silence) and `normalizeLoudness`; a true-peak mode for the limiter (default on);
  the duck's `lead` (the music is down when the first word lands) and `hold`; `from` for a
  preview that starts mid-lane; `start` for `render` and `applyLane`.
- **Choices where the standard is silent:** a sound shorter than one 400 ms block is measured as
  one block of its own length; mono is one channel (3 dB under the same signal on both sides).
- **Where the research and HyperFrames' code disagree** (RESEARCH.md asks): HyperFrames gives
  its high- and low-pass a linear Q of 0.707 and passes it to `BiquadFilterNode`, whose Q there
  is in dB (measured in WebKit), so its "Butterworth" default has +0.71 dB at the corner.

## Open problems and what was not verified

- **WebView2 (Windows, Chromium) was not run.** The builders use only spec-defined nodes and no
  loop, so they should match there too, but that is reasoning, not a measurement.
- The meter was checked against analytic signals and the EBU synthetic cases, not against a
  reference meter on real programme material (EBU 3341 cases 7-8 and the momentary and
  short-term cases need files; no momentary or short-term maximum is exposed).
- The speed numbers were taken on a busy machine; the test asserts the brief's budgets with the
  best of a few runs.
- Long material (minutes at 96-192 kHz) has not been timed; a 3 s room at 192 kHz is a 2²¹-point
  FFT per block.
- `valueAt` trusts its lane (it runs per sample); `render`, `planLane` and `compile` re-read
  theirs. The `DynamicsCompressorNode` fallback is far from the export (by design, and declared).
