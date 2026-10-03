# 02 Audio library: loudness, effects, automation, ducking

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Audio") first. The HyperFrames sources are in `$HF/packages/core/src` (see RESEARCH.md).

## Why
Motion has no sound and Video's mix is rough (RMS levels, no loudness standard). A small, exact, dependency-free audio library
is the base for sound in Motion now and for a pro mix in Video later. This package has no user interface; its quality is correctness.

## You own
`app/src/audiocore.ts`, `audiofx.ts`, `audioauto.ts`, `audioduck.ts`, `loudness.ts`, a test helper `app/test/audiofake.mjs` if you
need a recording fake `AudioContext`, `app/test/pro-audio.test.mjs`, `docs/pro/audio.md`, `docs/pro/credits/02.md`.
No `.tsx`, no CSS, no i18n.

## Contract
`loudness.ts` already exports a working placeholder (`Loudness {lufs, peakDb}`, `measureLoudness(channels, sampleRate)`,
`gainToTarget(measured, targetLufs = -16, ceilingDb = -1.5)`). **Keep those names and signatures**; package 04 already calls them.
You may add fields (`truePeakDb`, `range`) and functions. The rest is yours to design, in the house style.

## Deliver
1. **`loudness.ts`**: ITU-R BS.1770-4 integrated loudness: K-weighting as two biquads (coefficients for any sample rate, derived,
   not just 48 kHz), 400 ms blocks with 75% overlap, absolute gate -70 LUFS, relative gate -10 LU; true peak with 4x oversampling
   (windowed-sinc FIR). Validate with synthetic signals from EBU Tech 3341/3342: a 997 Hz stereo sine at -23 dBFS reads -23.0 LUFS
   (+/-0.1), amplitude steps by 10 dB read 10 LU apart, silence reads -Infinity, gating ignores quiet passages.
2. **`audiocore.ts`**: dB/linear, clamp, seeded PRNG (mulberry32), planar/interleaved helpers, linear and windowed-sinc resampling
   (44.1/48 kHz), mixdown, `fadeEdges`, soft clip. All pure, all deterministic.
3. **`audioauto.ts`**: automation lanes (schema in RESEARCH.md): a reader that clamps whatever it is given (a model or a person may
   write one), `valueAt(lane, t)` with `linear | hold | exp | bezier` curves, `compile(lane, param, t0)` into Web Audio
   `setValueAtTime`/`linearRampToValueAtTime`/`setValueCurveAtTime` calls, and an offline `render(lane, rate, n)` into a Float32Array.
4. **`audiofx.ts`**: six effects, each as (a) a descriptor with a reader, (b) a Web Audio graph builder for realtime preview, (c) a
   pure-JS offline path `renderChain(channels, rate, fx[]) -> channels` that gives the same result: **EQ** (low shelf, peaking,
   high shelf), **high-pass/low-pass**, **compressor**, **limiter** (look-ahead, in JS: no AudioWorklet), **delay**, **reverb**
   (convolution with a *seeded synthetic* impulse). Plus named presets: Warm, Clear, Room, Radio, Wide. The pure path is what the
   tests and the exporter use, so preview and export cannot disagree.
5. **`audioduck.ts`**: a sidechain follower: given a voice signal, return a gain lane that ducks a music bed to x0.25 with
   0.15 s attack and 0.4 s release (parameters adjustable), plus applying a lane to a signal. (Stretch: the FFT "carve".)

## Port with care
`$HF/packages/core/src/audioFx.ts`, `audio/audioFxGraph.ts`, `audioAutomation.ts`, `audio/audioFxAutomation.ts`, `audioCarve.ts`,
`$HF/packages/engine/src/services/audioFxRender.ts`, `$HF/packages/studio-server/src/helpers/loudness.ts`. Port the maths and
shapes you need; do not port Chrome/FFmpeg glue, AudioWorklets or anything that imports an npm package. Every ported file gets the
Apache-2.0 header (see PRO.md) and an entry in `docs/pro/credits/02.md`.

## Acceptance
- Known-answer tests for loudness, filters (frequency response at a few points), compressor (gain reduction curve), limiter (never
  exceeds the ceiling), reverb (energy decays; deterministic), ducking (envelope times), automation (curve values).
- Determinism: same input, same bytes (hash). No NaN or Infinity for any input including empty, silence, full-scale, DC, one sample.
- A recording fake `AudioContext` test proves each graph builder connects what it should.
- Speed: measuring 30 s of stereo at 48 kHz under 150 ms; a six-effect chain over 30 s under 1.5 s (record the numbers).
- `npm test`, `npx tsc --noEmit`, `npm run build` all pass.
