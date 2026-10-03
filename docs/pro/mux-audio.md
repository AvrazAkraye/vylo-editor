# 03 MP4 with sound

Work package 03 of the Pro pass (`docs/PRO.md`). Branch `pro-03-mux-audio`. A Motion film can now carry an
AAC sound track that starts exactly with the picture in every player we could test, and an export no
longer repaints frames that cannot have changed. No interface, no CSS, no strings: the Sound row (04) and
the Export tab (09) use what is here, and wave 2 wires it.

## What exists

| File | What it is now |
|---|---|
| `app/src/motionaudioenc.ts` (new) | A `SoundBed` to AAC-LC with WebCodecs' `AudioEncoder`: fitting the bed, a Kaiser-windowed sinc resampler, reading WebKit's malformed description and ADTS, measuring the encoder's priming |
| `app/src/motionmp4.ts` | `Mp4Writer` gains a second `trak` (`mp4a` + `esds`, `stts/stsc/stsz/stco`, `sgpd/sbgp` roll, `edts/elst`), chunks interleaved by the second; `readAsc`, `ascFor` |
| `app/src/motionencode.ts` | `EncodeOptions` gains `audio`, `unchanged`, `onSound`; the result carries `audio`, `painted`, `frames` |
| `app/src/motionexportops.ts` | `changingFrames` (which frames can differ), `renderMp4({ sound })` calling `renderSoundBed` |
| `app/test/pro-mux-audio.test.mjs` | 161 checks, about 3 s |
| `motionmp4.test.mjs`, `motionencode.test.mjs`, `motionexport.test.mjs` | extended: 87 → 92, 69 → 76, 106 → 110 checks; nothing removed or loosened (one assertion, the import list, now names the two new imports) |

The whole chain: 13,486 checks, about 41 s on this Mac (this package's own file takes about 3 s of it). `npx tsc --noEmit` and `npm run build` are clean.

## The API

```ts
// motionaudioenc.ts
canEncodeAac(sampleRate = 48000, channels = 2): Promise<boolean>
encodeAac(bed: SoundBed, o?: { bitrate?; signal?; onProgress?(done, total) }): Promise<AacTrack>
interface AacTrack { asc; sampleRate; channels; frames: { data; timestamp; duration }[]; delaySamples; totalSamples }
fitBed(bed, seconds?): SoundBed | null        // 2 channels, the film's length, -1..1, new arrays
resample(x, from, to): Float32Array           // band-limited
ascOf(description), adtsFrame(data), normalise(description, frames, rate, channels), burst(), lagOf(ref, decoded)
AAC_CODEC, AAC_BITRATE (128 000), AAC_RATE (48 000), DEFAULT_DELAY (1024)

// motionmp4.ts
Mp4Writer.addAudioTrack({ asc, sampleRate, channels, delaySamples, totalSamples })   // an AacTrack fits
Mp4Writer.addAudioSample({ data })
readAsc(asc): { objectType, sampleRate, channels, frameLength } | null
ascFor(sampleRate, channels): Uint8Array | null

// motionencode.ts
EncodeOptions += { audio?: SoundBed; unchanged?(frame): boolean; onSound?(done, total) }
encodeMp4(o): Promise<Mp4Bytes>               // Mp4Bytes = Uint8Array & { audio, painted, frames }
type AudioOutcome = 'kept' | 'dropped' | 'none'
withReport(bytes, report): Mp4Bytes

// motionexportops.ts
renderMp4(m, { size, quality, blur, sound?: boolean, onProgress?, onSound?, signal? }, deps?): Promise<Mp4Bytes>
changingFrames(m, { fps, frames, blur? }): Uint8Array     // 1 = paint, 0 = the frame before again
unitsBound(layer): number
RenderDeps += { soundBed: typeof renderSoundBed }
```

**Existing callers are unchanged.** `Mp4Bytes` is the same `Uint8Array` object with three non-enumerable,
read-only properties, so `writeMotionFile(path, bytes)` and every byte comparison work as before. `sound`
defaults to false: the shortest path to a film does not change, and an export without sound costs nothing
new but the plan, computed once (one to three milliseconds for a template).

## How it works, and what was measured

### Sound

`renderMp4` with `sound: true` calls `renderSoundBed(doc, { signal, sampleRate: 48000 })` after the fonts
load and before the first frame (`onSound(0, 1)` announces the stage). `encodeMp4` fits the bed to the film
(`frames / fps` seconds, cut or padded with silence, two channels, every sample finite in -1..1), encodes it
(`onSound(samples done, samples)`), and only then draws pictures. Sound never fails a film: no `AudioEncoder`,
no rate it takes, an encoder error or a bed that will not render all give a silent film with
`audio: 'dropped'`. Cancel during the sound is an `AbortError`, as everywhere, and every encoder, decoder and
`AudioData` is closed on every way out.

The rate is the bed's own when the encoder takes it, else 48 kHz, else 44.1 kHz. Chrome 154 takes only those
two; WebKit (macOS 26.2) takes 22.05 to 96 kHz. `resample` is a Kaiser-windowed sinc (32 zero crossings,
beta 8): taking 48 to 44.1 kHz it passes 18 kHz untouched and holds 21.4 kHz 74 dB and 23.5 kHz 85 dB down;
a 1 kHz tone survives 44.1 → 48 kHz within 0.1% of full scale. It costs about 75 multiplications a sample (a
second for a 30-second stereo bed), paid only when the encoder will not take the bed's rate.

### The priming, and the edit list

An AAC encoder's output begins with priming. **Neither engine reports it**: both stamp the first chunk at 0
and give no delay. Both use Apple's encoder on a Mac, whose priming is 2112 samples, so a file trimmed by
the brief's default of 1024 would play its sound 23 ms late. `encodeAac` therefore *measures* it, once per
encoder and configuration: it encodes a 2048-sample seeded noise burst with the same settings, decodes it with
`AudioDecoder`, and takes the lag of the cross-correlation peak (`lagOf`). Measured: **2112 in both engines at
48, 44.1 and 22.05 kHz**, about 20 to 40 ms the first time, then cached. An encoder that stamps its priming
before 0 is believed instead; with no decoder to measure with, 1024 is assumed (sound a little late is the
less noticeable error). A failed measurement is not cached.

The sound `trak` carries one edit: media time = the priming, segment = the input's length in ms (rounded up,
like the picture's), so the padding at the end is never heard. **AVFoundation needs one more thing**: a `roll`
sample group (`sgpd`/`sbgp`, distance -1) saying each AAC frame needs the one before it. Without it,
QuickTime's reader honoured the edit list *and* trimmed its own 2112 samples, and every click came 2110
samples (44 ms) early. ffmpeg and Apple's own writer both write the group; so does this one now.

WebKit's `decoderConfig.description` is the whole ES_Descriptor of an `esds` box
(`03 … 04 … 05 11 90 … 06 …`), not the AudioSpecificConfig WebCodecs specifies (WebKit bug 302253):
`ascOf` digs the config out. ADTS frames, a missing description and a config of object type 0 are handled
too.

### The file

Track 1 is the picture exactly as before (its tables are byte-identical to a file without sound; only its
chunk offsets move). Track 2 is the sound: `mp4a` (ISO form, 16-bit, the rate in 16.16), `esds` (object 0x40,
stream type 5, largest frame, busiest-second and average bitrate, the ASC, SL 2), one tick a sample, every
frame one 1024-tick sample, alternate group 1, volume 1.0. Chunks sit in `mdat` a second of pictures, then
the sound heard in that second. A file without sound is the file it always was (one `trak`, next track id 2).

### Colour

The brief asked for a `colr nclx` tag "1,1,1, limited range, if it is not already". **It already was**, with
one measured difference that is kept on purpose: primaries 1, matrix 1, limited range, but **transfer 13
(sRGB), not 1**. The 0.132.0 work measured that AVFoundation colour-manages by this tag and with 1 shows every
mid-tone lighter than the canvas draws it (grey 128 as 139); with 13 every patch is within 2 levels. The
existing test holds it there. Not changed.

### Frames that cannot have changed

`changingFrames` decides, from the document alone, whether each frame can differ from the one before. For
every layer and every moment `paint` draws at (the frame's time, or each motion-blur sub-frame) it builds a
key: whether the layer is drawn (inside `start..end` and its pose `on`, or one of its pieces' for split
text), how many pieces have finished entering and leaving (by bisection over the pieces, with *exactly*
`poseAt`'s arithmetic, so a boundary lands where the renderer's does), whether a highlight's mark is drawing,
and the figure a counter shows. A layer under way — any entrance, exit or loop in progress, a moving backdrop
or particles, or a kind or chart not known to stand still — has no key, so it differs from every other
moment. Equal keys at every sub-frame of two frames mean the same picture; the second is not painted, and
`encodeMp4` wraps the untouched canvas again at its own timestamp. The film keeps one sample per frame at a
steady rate and its key frames where they were.

The renderer decides some piece counts from its layout (wrapped lines, letter clusters), so there the count is
a bound (every word, every code point); a bound can only cost a needless paint, never a skipped change. A
document with scenes is painted whole (package 05's time is its own). A loop at amount 0 (except shimmer)
does nothing and does not count as motion.

**Proof that skipped frames are identical.** On the recording canvas: every template (and five in a second
language and shape), with and without blur, plus 40 documents with scrambled timings: no skipped frame ever
draws differently from the frame before (1,249 skipped in the fuzz alone). On a hand-made document whose
times fall between frames, the painted set equals the differing set exactly. In the **real engines**, every
template's every frame was painted and its pixels hashed (WebKit at 320 × 180 in en/ar/ckb/kmr and four shapes,
with and without blur, and at 1920 × 1080 with blur; Chrome with blur): **0 skipped frames differed** from the
frame before.

**What it buys.** Only graphics that settle: of the 18 templates as built, 14 have a moving backdrop, a
particle layer or a loop that runs to the end, and are painted at every frame, rightly. The others skip up
to two fifths (lower-third 52 of 150, handle 49 of 120, steps 79 of 210, subscribe 21 of 150; a frame or two
fewer with motion blur). A graphic a person builds on a still colour skips its every hold. Measured in WebKit:
lower-third at 1080p with motion blur 3.0 s → 2.1 s; a big title without its backdrop 2.9 s → 1.6 s; but
4K without blur 3.0 s either way: there the hardware encoder (about 60 frames a second at 4K) is the limit,
not the painting. Reusing the held `VideoFrame` instead of re-reading the canvas was tried and measured no
faster, so it was left out.

## Real encoders: what was and was not run

Run (scratch harness in `app/.test-build/mux-harness`, git-ignored, built from the 0.132.0 harness; the
owner's window was never touched): headless Chrome 154 over CDP and macOS 26.2's WKWebView (a separate
off-screen host), each exporting films at 640×360@30, 1280×720@60 (bed at 44.1 kHz) and 1080×1920@24 (bed at
22.05 kHz) whose picture flashes white at known frames and whose sound clicks at the same instants. Checked
with ffprobe (h264 + AAC LC, both start 0, both exactly the film's length), `ffmpeg -v error` (silent),
ffmpeg's decode (clicks within 2–3 samples of where they were put, all flash frames exact) and AVFoundation's
`AVAssetReader` (clicks within 2–5 samples after the roll fix). Also `renderMp4` of the lower-third template
with sound end to end in WebKit (painted 99 of 150, sound kept, clicks exact in AVFoundation).

In `npm test`, where ffmpeg is installed: ffmpeg's own AAC (priming 1024) muxed beside its H.264 decodes to
exactly the stream's samples less the priming, and the clicks land where they were put.

**Not run:** Windows (WebView2's Media Foundation AAC encoder; its priming is measured at run time, not known
here), Safari proper, iOS, players other than ffmpeg and AVFoundation (VLC, Windows' Films & TV, Android),
and QuickTime Player's own UI (AVAssetReader is the engine behind it, but the app was not opened). Package
04's real `renderSoundBed` did not exist here; the stub returns null, so every bed in these runs was a test
bed.

## Deviations from the brief

- **Priming is measured, not defaulted to 1024.** The brief's default was 23 ms wrong on both engines the app
  runs in. 1024 remains the fallback when no decoder exists.
- **`colr` transfer stays 13 (sRGB)**, for the measured reason above.
- **The result is the bytes with a report on them**, not a new object, so no existing caller changes.
- **`renderMp4` gained `onSound`**, and `encodeAac` an `onProgress`, so progress covers the sound stage; the
  Export tab's "Frame n of m" counter stays in frames.
- **`changingFrames` does not use `stillTime`**: `stillTime` picks a representative moment and ignores
  backdrops; the plan needs every moment where anything can move, and handles holds in the middle (between an
  entrance and an exit), not only after the last motion.
- **The `sgpd`/`sbgp` roll group** was not in the brief; AVFoundation plays the sound 44 ms early without it.

## Open problems

- A layer kind or chart added by another package (a bar-chart race) is painted at every frame until it is
  checked and listed in `STILL_KINDS`/`STILL_CHARTS` in `motionexportops.ts`; a new *effect* or *loop* needs
  nothing (effects are read through their progress; an unknown loop counts as motion). If any package makes
  `paint` depend on time in a new way for documents without scenes, `changingFrames` must learn it; the
  template sweep in `pro-mux-audio.test.mjs` compares plans against full renders of every recipe in
  `RECIPE_IDS` and fails if a skipped frame differs.
- Scenes: every frame is painted. When package 05 can say when its scenes and transitions move, the plan can
  use it.
- Fonts that finish loading in the middle of an export (after `preload` gave up) change frames the plan calls
  unchanged; the full render had the same problem in another form.
- Sound beds are encoded whole in memory (30 s stereo at 48 kHz is 11.5 MB of PCM): fine for Motion's limit.
- Resampling runs in one go on the main thread (about a second for 30 s of stereo) and Cancel waits for it.
  It happens only when the encoder refuses the bed's rate; 04 is asked for 48 kHz, which both engines take,
  so in practice it does not happen. If 04 ever has to render at another rate, chunk it.

## What the integrator must wire

1. **Export tab (09's `MotionExport.tsx`):** pass `sound: true` to `renderMp4` when the document has sound
   (04's `doc.sound?.mode !== 'off'`); show a quiet notice when the result's `audio === 'dropped'` ("Saved
   without sound: this window cannot encode AAC."); optionally show a "Sound" stage while `onSound` runs
   (the bar is "early" until frames start). `bytes` still goes to `writeMotionFile` unchanged.
2. **`docs/MOTION.md`:** "Not in this version" loses "Sound"; the engine table gains `motionaudioenc.ts`;
   `motionmp4.ts` "the MP4 container writer, picture and sound"; one line on unchanged frames.
3. **Nothing in `package.json`, `i18n.ts` or `styles.css`.** No dependency, no network, no media element:
   SAFETY.md's claims are unchanged (the sound is synthesised and encoded locally).
4. Requests for other packages' files are in `docs/pro/requests/03.md`.
