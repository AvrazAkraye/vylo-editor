# 03 MP4 with sound: AAC track, edit list, colour tags, faster export

Read `docs/PRO.md` and `docs/pro/RESEARCH.md` ("Audio", "Time") first.

## Why
Motion's own MP4 writer writes picture only. Sound needs an AAC track written correctly (so picture and sound start together in every
player), and the exporter should also tag colour properly and not repaint frames that cannot have changed.

## You own
`app/src/motionmp4.ts`, `motionencode.ts`, `motionexportops.ts`, `motionaudioenc.ts`, `app/test/pro-mux-audio.test.mjs`, and the existing
`motionmp4.test.mjs`, `motionencode.test.mjs`, `motionexport.test.mjs` (extend them; do not weaken them), `docs/pro/mux-audio.md`,
`docs/pro/credits/03.md`. No UI (`MotionExport.tsx` belongs to package 09), no CSS, no i18n.

## Contract
`motionsound.ts` already exports `SoundBed { channels: Float32Array[]; sampleRate: number }` and
`renderSoundBed(doc, { signal, sampleRate }): Promise<SoundBed | null>` (a placeholder returning `null`; package 04 makes it real).
Code against that. Your side:
```ts
// motionaudioenc.ts
export async function canEncodeAac(sampleRate?: number, channels?: number): Promise<boolean>;
export async function encodeAac(bed: SoundBed, o?: { bitrate?: number; signal?: AbortSignal }): Promise<AacTrack>;
export interface AacTrack { asc: Uint8Array; sampleRate: number; channels: number; frames: { data: Uint8Array; timestamp: number; duration: number }[]; delaySamples: number; totalSamples: number }
// motionmp4.ts: Mp4Writer gains addAudioTrack(cfg) and addAudioSample(...)
// motionencode.ts: EncodeOptions gains audio?: SoundBed; the result reports { audio: 'kept' | 'dropped' | 'none' } without breaking existing callers
// motionexportops.ts: renderMp4 takes sound?: boolean (default false) and calls renderSoundBed(doc)
```

## Deliver
1. **AAC**: WebCodecs `AudioEncoder`, `mp4a.40.2`, 128 kbps stereo by default; resample to 48 kHz if the encoder wants it
   (`audiocore.ts` is being written by package 02: do not depend on it; write a small resampler of your own or ask the encoder to resample);
   build `AudioData` from planar Float32; flush; abort. `canEncodeAac` probes with `isConfigSupported`. If AAC is unavailable the export
   **still succeeds silently** and says so (`audio: 'dropped'`).
2. **Muxer**: a second `trak`: `mp4a` + `esds` (the AudioSpecificConfig the encoder returns), `stts/stsc/stsz/stco`, interleaved in about
   one-second chunks with the video, **`edts/elst`** that trims the encoder's priming delay (1024 samples by default; use what the
   encoder reports) and the trailing padding so the audio's presentation start is exactly the picture's; `mvhd`/`tkhd`/`mdhd` durations
   right for both tracks. Tag the picture **bt709** with a `colr` `nclx` box (1,1,1, limited range) if it is not already.
3. **Static frames**: when `stillTime(layers, seconds)` (see `motionanim.ts`) says nothing moves after some time (no loops, no particles,
   no counters running), repaint nothing: submit the previous frame again for the rest, with a correct timestamp. Provably identical
   output pixels (test it against a full render with the recording canvas) and a large speed-up for settled graphics.
4. **Progress and cancel** cover the audio stage.

## Acceptance
- A box-walker in the test parses your output: every box size consistent, `stsz` sums match `mdat`, chunk offsets land inside `mdat`, both
  tracks' durations agree within one video frame, `elst` values correct, no regression in the existing mp4 tests.
- Fake `AudioEncoder`/`VideoEncoder` tests (see how `motionencode.test.mjs` fakes `VideoEncoder`) for the interleaving and the fallback.
- Frame-skipping test: the set of painted frames is exactly the set that can differ.
- If a real WebKit run is possible without the owner's window (`app/.test-build/motion-harness` exists in the Motion worktree
  `/Volumes/ExtremeSSD/apps/vylo-editor-motion`; read it, do not modify that worktree), say what you ran; otherwise say that real encoder
  behaviour is untested.
- `npm test`, `npx tsc --noEmit`, `npm run build` pass.
