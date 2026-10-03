# Review R2: export, sound and sync, with real files

Adversarial review of the Pro pass's export path (branch `pro-r-export`, from `pro` at `a3faefa`). The question
was whether the files are actually right, as decoded, metered and played. Everything was run off-screen in
the app's own engine (macOS 26.2 WKWebView, with its hardware H.264 and Apple AAC encoders), through the
Export tab's own code. The results were checked with ffmpeg 9.0.1 (ffprobe, its decoder, its EBU R128 meter),
AVFoundation (`AVAssetReader`, the engine behind QuickTime, Safari and Photos) and macOS ImageIO (for the
GIFs). The owner's running app was never touched.

**Nobody has listened to any of this.** There are no speakers or headphones in this review. Every statement
about sound below is a measurement.

The sample files are in `/Volumes/ExtremeSSD/apps/vylo-pro-samples/` (`mp4/`, `gif/`, `png/`, `stress/`). Its
`README.md` says what each one shows and what to listen for. The harness is in `app/.test-build/r2/`
(git-ignored): `wk2.mjs` (bundles an entry, serves it on 127.0.0.1, runs the off-screen WKWebView host,
and takes large files back by POST), `samples.ts`, `make.mjs` with `verify.mjs`, `sweep.ts`,
`soundfilms.mjs`, `skip.mjs` and `alternate.mjs`, `break.mjs`, `preview.ts` with `drift.mjs`, `gifverify.mjs`,
`oldwriter.mjs`, and the Swift tools `avdump` (AVFoundation) and `gifcheck` (ImageIO).

## What was wrong, and what was fixed

| # | finding | evidence | fix |
|---|---|---|---|
| 1 | **The film's sound went over −1.5 dBTP once AAC had encoded it.** The bed was held at −2.5 dBTP, but the codec's noise rides on the peaks | Every template's bed went through WebKit's AAC and decoder. At level 60%: 1 of 99 over (compare, Both: −1.44). At level 100%: **6 of 66 over, the worst −0.62 dBTP** (ui-device, Both). The codec raised the peak by up to **1.87 dB**. ffmpeg's decode of real films with the original encoder: 3 of 66 over at level 100%, the worst −1.25 | `motionencode.ts`: the AAC track is decoded with the window's own `AudioDecoder` (the new `decodeAac`, which plays the track as the edit list does). If its true peak is within 0.1 dB of −1.5 or over, the bed is turned down by the excess plus 0.3 dB and encoded again, at most twice. With no decoder, the track is kept as encoded. After the fix: **0 of 66 over at level 100% (worst −1.6 dBTP, ffmpeg) and 0 of 99 at 60%** |
| 2 | **A bed cut to the film's whole frames could end on a click.** A graphic 4.39 s long at 24 fps is 105 frames, 4.375 s of film, so its bed loses its last 15 ms, part-way through the bed's own fade-out | `fitBed` cut the samples where they fell | `motionaudioenc.ts` `fitBed`: a bed that is cut is faded over its last 10 ms (raised cosine), so the last sample is 0. Padding and exact lengths are unchanged |
| 3 | **The preview let the sound run up to 120 ms ahead of the picture.** One threshold for both directions, while ITU-R BT.1359 puts the detectability of sound early at 45 ms | In WebKit, a 280 ms main-thread stall (the clock counts at most 250 ms of a gap) left the sound **+45 to +48 ms ahead for the rest of the play**, never corrected | `motionsoundplay.ts`: the sound restarts when it is more than **45 ms early** or more than **120 ms late**. After the fix, that stall is corrected once and the drift settles at −1.0 to +1.3 ms |
| 4 | **A slow frame sent the sound back, then forward.** A stall between the clock's tick and `follow` made the playhead look 150 to 600 ms behind, so the sound was restarted *back* at the stale playhead (heard twice), then again when the clock caught up | 2 restarts per stall, for stalls of 150, 280, 340 and 600 ms | `follow` now waits one call when the playhead has moved on less than the wall clock since it last looked: the picture is late, not lost. A 150 ms stall now causes **0 restarts**; 280 to 600 ms cause **1**, after the catch-up. Seeks and loops are still followed at once |
| 5 | **The sound played on while the window was hidden.** The playhead stops when no frames run, but the sound played to the end of its bed (up to 30 s) behind a still picture | By reading the code, then measured with a hidden-page script | `motionsoundplay.ts` listens for `visibilitychange`: the sound stops when the page is hidden and starts again at the playhead with the next frame after it is shown. Measured: on show, a restart at the playhead, with drift then −1.3 to +1.0 ms |

Regression tests are in `app/test/pro-review-export.test.mjs` (39 checks, under 1 s, in the chain before
`orphans.test`). Run against the code as it was before this review, **15 of them fail**. That was checked by
bundling the pre-review files and running the same test. One existing assertion changed:
`motionencode.test.mjs`'s import list now names `./audiocore` and `./loudness`. Nothing else was loosened.

Requests for files outside R2's lane are in `docs/pro/requests/R2.md`. The largest is a **sync problem in
cue derivation**: a whoosh plays over a still picture about half a second before each scene transition (see
"Scenes" below).

## The sample films, verified

All of them were made through `settingsFor` → `outputOf` → `makeFile`, at 1080p "high" unless the row says
otherwise, then decoded by ffmpeg and by AVFoundation. "Lag" is the cross-correlation peak between the
decoded sound and the bed the app rendered for the film, over the loudest half second, searched ±3000
samples. Since the bed's sample 0 is the film's time 0, a lag of 0 means sound and picture start together.

| film | size, fps, s | painted / frames | v start + dur | a start + dur | decoded − expected samples (ffmpeg, AVF) | lag ffmpeg / AVF | LUFS (ffmpeg) | true peak ffmpeg / app | bed LUFS / dBTP | clipped | L − R |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 01 title, Effects | 1920×1080, 30, 6 | 180/180 | 0 + 6 | 0 + 6 | 0, 0 | 0 / 0 | −16.1 | −3.9 / −3.93 | −16.00 / −5.23 | 0 | 0.00 dB |
| 02 counter, Both | 1920×1080, 30, 5 | 150/150 | 0 + 5 | 0 + 5 | 0, 0 | 0 / 0 | −16.1 | −2.6 / −2.58 | −16.05 / −2.50 | 0 | −0.30 |
| 03 bar race, Music | 1920×1080, 30, 12 | 360/360 | 0 + 12 | 0 + 12 | 0, 0 | 0 / 0 | −16.1 | −2.8 / −2.77 | −16.00 / −2.50 | 0 | −0.56 |
| 04 four scenes, Both | 1920×1080, 30, 12 | 360/360 | 0 + 12 | 0 + 12 | 0, 0 | 0 / 0 | −16.1 | −2.4 / −2.40 | −16.03 / −2.50 | 0 | −0.27 |
| 05 story 9:16, Both | 1080×1920, 30, 4 | 49/120 | 0 + 4 | 0 + 4 | 0, 0 | 0 / 0 | −16.0 | −3.1 / −3.14 | −16.00 / −3.40 | 0 | +0.54 |
| 06 Arabic title, Both | 1920×1080, 30, 6 | 180/180 | 0 + 6 | 0 + 6 | 0, 0 | 0 / 0 | −16.1 | −2.3 / −2.25 | −16.01 / −2.50 | 0 | +0.34 |
| 4K 60 fps, Both | 3840×2160, 60, 5 | 145/300 | 0 + 5 | 0 + 5 | 0, 0 | 0 / 0 | −16.1 | −4.3 / −4.30 | −16.00 / −3.88 | 0 | +0.53 |
| 30 s, blur, ten scenes | 1920×1080, 30, 30 | 900/900 | 0 + 30 | 0 + 30 | 0, 0 | 0 / 0 | −16.1 | −2.4 / −2.44 | −16.04 / −2.50 | 0 | +0.56 |
| 24 fps, 4.39 s, Post (4:5) | 1080×1350, 24, 4.375 | 53/105 | 0 + 4.375 | 0 + 4.375 | 0, 0 | 0 / 0 | −16.2 | −2.8 / −2.84 | −16.00 / −2.84 | 0 | **+4.58** |
| level 100%, steps | 1920×1080, 30, 7 | 131/210 | 0 + 7 | 0 + 7 | 0, 0 | 0 / 0 | −14.4 | **−1.6** / −1.63 | −14.06 / −2.50 | 0 | −0.83 |
| level 30%, intro | 1920×1080, 30, 4 | 120/120 | 0 + 4 | 0 + 4 | 0, 0 | 0 / 0 | −22.1 | −9.8 / −9.80 | −22.02 / −9.72 | 0 | −0.31 |
| Effects only, loop-bg | 1920×1080, 30, 8 | 240/240 | 0 + 8 | 0 + 8 | 0, 0 | 0 / 0 | −17.4 | −6.7 / −6.73 | −17.33 / −6.50 | 0 | 0.00 |

- **Container.** Every film is `ftyp mp42`, then `moov`, then `mdat`. Video is H.264 High, yuv420p, tv range,
  BT.709 primaries and matrix, transfer `iec61966-2-1` (as designed, `docs/pro/mux-audio.md`). Audio is AAC LC,
  48 kHz, stereo. `ffmpeg -v error` decoding every film printed nothing.
- **Picture timing.** Frame `i` is at exactly `i / fps`: the largest |pts − i/fps| is 0.000 ms at 24, 30 and
  60 fps. Key frames fall every 2 s (0, 60, 120… at 30 fps). The first audio packet is at −0.044 s: the 2112
  priming samples, which the edit list skips.
- **A/V start and length.** Both tracks start at 0 and are exactly the film's length in ffprobe and in
  AVFoundation. The decoded sound is exactly the film's samples long in both decoders (0 samples apart). That
  is well inside a frame (1600 samples at 30 fps).
- **Loudness.** Every film at level 60% with music is −16.0 to −16.2 LUFS by ffmpeg's meter. The app's own
  meter on ffmpeg's decode agrees with ffmpeg's true peak to within 0.05 dB. Level 30% gives −22.1 and
  level 100% gives −14.4 (the peak correction took 0.3 dB). Effects-only beds of sparse graphics stay under
  target by design (below).
- **Clipping.** No decoded sample of any film reached |x| ≥ 0.999.
- **Clicks.** The detector flags a sample whose second difference is more than 10 times the RMS of the second
  difference over ±5 ms, and above 0.02. It found nothing at any film's start or end. The first millisecond
  peaks at ≤ 0.00001 and the last at ≤ 0.00014, and the bed's first and last samples are exactly 0. At scene
  cuts, the ratio of the largest second difference within ±5 ms of the cut to its RMS over ±50 ms was 0.46 to
  3.81 (four scenes) and 2.87 to 4.08 (ten scenes) in the decoded films. A click reads in the tens. The
  detector flagged three spots elsewhere, and none is an export fault. Two are a drum attack in the composed
  music that is already in the bed (02 at 1.653 s: +0.30 full scale in one sample, a request to Video's
  composer). One is in the decoded film only (03 at 4.07 s, ratio 10.6), which is AAC on a music transient.
- **Stereo.** Centred graphics measure L − R within ±0.83 dB, correlation 0.92 to 1.00. A graphic whose only
  sound is on one side (the lower third) measures 4.58 dB, by design (a request to 04).

## Every template's sound through the codec

`sweep.ts` (engine encoder, engine decoder, app meter) and `soundfilms.mjs` (real films through `encodeMp4`
on a tiny picture, metered by ffmpeg) covered all 33 templates.

| set | films | worst true peak | over −1.5 dBTP | LUFS range |
|---|---|---|---|---|
| level 60%, Effects / Both / Music, original encoder (engine decode) | 99 | −1.44 (compare, Both) | 1 | fx −18.86 to −16.09; Both −16.19 to −16.02; Music −16.17 to −16.01 |
| level 100%, Effects / Both, original encoder (engine decode) | 66 | **−0.62** (ui-device, Both) | **6** | −18.86 to −14.04 |
| level 100%, original encoder (ffmpeg decode, app meter) | 66 | −1.25 (lt-kicker, Both) | 3 | |
| level 100%, **fixed** (ffmpeg's meter; the app's meter on ffmpeg's decode) | 66 | **−1.6 / −1.64** | **0** | −19.7 to −14.0 |
| level 60%, original encoder (ffmpeg) | 99 | −1.8 / −1.84 | 0 | fx −19.7 to −16.1 |
| level 60%, **fixed** (ffmpeg) | 99 | **−1.8 / −1.84** | **0** | fx −19.7 to −16.1; Both −16.2 to −16.0; Music −16.1 to −16.0 |

At 60% neither ffmpeg run happened to cross the ceiling. The engine sweep's crossing (−1.44) shows that it
can.

The codec's rise over the bed averaged under 0.1 dB, but reached 1.44 dB at 60% and 1.87 dB at 100%. The
encoder also differs from run to run, which is why ffmpeg's films and the engine sweep do not list the same
offenders. What the check costs, on a 30 s Both bed: encode 151–173 ms, decode 61–84 ms, true peak
136–142 ms. That is about 0.2 s on a 28–46 s export, and only for films with sound. For the 5 to 12 s
template films, the median sound-and-encode time went from 142 to 218 ms. A film without sound
runs no check.

**By design, not fixed:** Effects only, at 60%, five templates stay 1.1 to 3.7 LU under −16 by ffmpeg's
meter (lt-pill −18.0, lt-neon −19.7, ui-scribble −17.1, ui-chat −17.5, film-look −17.9; loop-bg −17.4 in the
stress film). The cause is `BOOST_FX_DB = 10`. ffmpeg and the app's meter disagree most on such sparse sounds
(lt-neon −19.7 against −18.86): a sound shorter than a 400 ms block is measured differently. Request 4 asks
the owner whether to raise the cap.

## Frames that were not repainted

**On the canvas** (WebKit, 640 px, every frame painted whole and hashed): 11 cases, covering eight templates
(three of them pro), Arabic, portrait, blur, a still title with blur, and the changing templates. Of 691
frames the plan skipped, **0** differed from the frame before. 0 to 6 frames per case were painted although
identical.

**In the files** (`alternate.mjs`: full and skip renders alternated three times each, after a warm-up
render, then decoded by ffmpeg). The hardware encoder is **not deterministic** from run to run, so a file
painted whole twice is the control:

| case | full vs full | skip vs skip | skip vs full | median ms, full / skip |
|---|---|---|---|---|
| lower third, 720p | identical | identical | **identical** (both pairs) | 351 / 350 |
| lower third, 1080p | identical | identical | **identical** | 677 / 675 |
| big number, Arabic, no backdrop | 85 frames differ, PSNR ≥ 55.5 dB | 27 differ, ≥ 55.5 | 83 / 40 differ, ≥ 55.5 | 371 / 350 |
| big title, no backdrop, blur | 16 differ (max 1 level) | 143 differ, ≥ 49.2 | 15 / 143 differ, ≥ 49.2 | **1408 / 822** |
| price card (no frame skippable) | 70 differ, ≥ 48.4 | 61 differ, ≥ 48.9 | 61 / 70 differ, ≥ 48.4 | 1038 / 1061 |

Where the encoder repeats itself, skip and full decode to the same frames, hash for hash. Where it does not,
skip and full differ exactly as much as two full renders do. In a single pass (`skip.mjs`), steps, handle
(portrait), lt-bar, ui-notify and blurred lower-third decoded to 0 differing frames. **Speed:** without blur
the hardware encoder is the limit and skip equals full (350 against 351 ms). With blur, skip is 1.7 times
faster. An earlier "skip is slower" reading came from the first render's warm-up, and went away once the
renders were alternated.

## A film without sound

The real 1080p film exported with sound Off (`stress/sound-off-title.mp4`) was read back into its 180
samples and written again by the **0.132.0 writer** (`git show 4b13ed8:app/src/motionmp4.ts`) and by today's
writer. All three are **byte for byte equal**: one `trak`, `ftyp/moov/mdat`, and the same tables. The test
keeps three golden SHA-256s taken from the 0.132.0 writer (640×360@30, 1080×1350@24, 3840×2160@60).

## GIFs and the PNG

| | web loop (opaque) | lower third (transparent) |
|---|---|---|
| header, screen, global table | GIF89a, 720×405, 256 | GIF89a, 720×405, 256 |
| loop block (file / ImageIO / ffmpeg) | 0 (for ever) / 0 / loops | 0 / 0 / loops |
| frames, total | 120, 8.00 s (ffmpeg 8.000000, ImageIO 8.000) | 37 (identical frames joined), 5.00 s |
| delays | 7, 6, 7… hundredths (15 fps); ImageIO's and ffmpeg's match the file's exactly | the same, plus one 2.60 s hold |
| disposal | 1 everywhere | 1 and 2; the last frame is 2 |
| colours in any decoded frame | 255 | 235 + clear |
| ffmpeg vs ImageIO | 120 frames, max channel difference **0**, alpha identical | 37 frames, **0**, alpha identical |
| vs the app's canvas, mean abs (levels), 10 moments | 1.28 to 1.69 | 0 to 1.27, 0 alpha errors |
| loop restart (ffmpeg `-ignore_loop 0`, two passes) | second pass = first, 0 bytes differ | 0 bytes differ (no residue) |
| partial alpha | 0 | 0 |

The PNG is 1920×1080 sRGB at its best moment (2.78 s). It is stored as RGBA although it is opaque, which is
`renderPng`'s choice and harmless.

## Breaking it

| attempt | result |
|---|---|
| odd sizes 641×361 (30), 1081×1921 (24), 3×5 (60), 4097×2161 (30) | cropped to 640×360, 1080×1920, 2×4 and 4096×2160 (never scaled). Sound kept, ffmpeg silent, AVFoundation reads the same size |
| 1×1 | `RangeError: encodeMp4: the canvas is 1x1, smaller than 2x2`. `renderMp4` never asks for it (`pixelsFor` gives even sizes) |
| 4K at 60 fps with sound | correct (table above): 5.7 s for 5 s of film |
| 30 s, motion blur, ten scenes, nine kinds of transition, Both | correct: 900 frames, 27.8–46 s depending on load, 19 MB |
| Cancel while the music renders (30 ms in) | `AbortError` after 348 ms. The music render (an `OfflineAudioContext`) is not interruptible, so Cancel waits for it, up to about a second for 30 s. The next export is fine (sound kept, −16.2 LUFS) |
| Cancel half-way through the AAC | `AbortError` after 553 ms, every encoder closed. The next export is fine |
| Cancel at frame 10 | `AbortError`, and the next export is fine |
| `AudioEncoder` absent | `canEncodeAac` false, film made, `audio: 'dropped'`, one stream |
| `AudioEncoder` that refuses every config | the same |
| `AudioEncoder` that errors on its first input | `canEncodeAac` true, film made, `dropped`, one stream |
| a graphic with sound Off | `audio: 'none'`, byte-identical to the old writer's file |
| full disk | not run (it cannot be done safely on the owner's Mac), so this row is reasoning from `video.rs` only. Download removes a partial file. **Save as… over an existing file destroys the old file and leaves a partial MP4** (`fs::write` truncates first). No `sync_all`, so network volumes may report success for a truncated file. Request 2 has the proposed fix. The system volume itself stood at 99% full during this review |

All exports here ran in a hidden page (the host is off-screen and `document.hidden` is true), so an export
tied to a running call finishes in a hidden WKWebView.

## The preview (`motionsoundplay.ts`) against the clock

The preview was measured in the app's engine with a **real `AudioContext`**, muted through the preview's own
level so that nothing was heard. A hidden page runs no animation frames (measured: 0 a second), so a 60 Hz
stand-in, driven by a message loop at about 63 frames a second, called motionplay's own ticker.
`follow` was called after each tick, as `MotionSoundPreview`'s effect does. The context reports
`baseLatency` 2.7 ms and `outputLatency` 5.1 ms. "Drift" is the sound's position minus the playhead;
positive means the sound is early.

| script | before the fix | after the fix |
|---|---|---|
| play, seek, play after pause | +15 to +18 ms, steady (the clock's first tick adds no time: request 3) | the same |
| speed 2, 0.5, back to 1 | one restart each, −1.3 to +5.3 ms (pitch moves with the speed) | −0.7 to +4.7 ms |
| loop of a 2 s graphic | one restart per loop at 0.017 s, aligned | the same |
| stall of 150 ms **between frames** | no restart, +15 to +17 ms | the same |
| 280 ms between frames | **+45 to +48 ms for the rest of the play** (under the 0.12 s threshold) | one restart, then −1.0 to +1.3 ms |
| 340 and 600 ms between frames | one restart each | one restart each |
| 150 / 280 / 340 / 600 ms **between tick and `follow`** | **two restarts each**, the first sending the sound back to the stale playhead | **0** / 1 / 1 / 1 |
| window hidden for 1.5 s while playing | the sound plays on behind a still picture (by reading the code) | the sound stops on hide. On show, one restart at the playhead, then −1.3 to +1.0 ms |
| context needing a gesture (resume refused until a `pointerdown`) | nothing sounds. Seek while suspended. On the gesture, it starts at the playhead, −10.7 to −8.3 ms | the same, −16 to −14 ms |
| context suspended, then resumed by the page | resumes and starts at the playhead | the same |

The sound starts at the context's `currentTime` with no compensation for output latency, which is about
7.8 ms here. The one-frame lead after a play and that latency partly cancel. The heard offset is about 9 ms,
far below what anyone notices.

## What was not verified

- **Listening.** Nothing was played through speakers. Whether the effects sound good, whether the music
  suits the graphics, and whether the 9 ms preview offset is invisible are all unmeasured by ear.
- **Other engines and platforms.** Only macOS 26.2's WKWebView on this Mac. Chrome, WebView2 on Windows
  (Media Foundation's AAC, whose overshoot and priming may differ; the peak check measures whatever encoder it
  meets), iOS, Android, VLC and the platforms' own re-encoders were not run. QuickTime Player's window was
  not opened; `AVAssetReader` is the engine behind it.
- **The real app window.** The preview's numbers come from a hidden page with a stand-in frame clock, and the
  gesture policy is emulated. The app's own webview may resume a context without a gesture, as this host did.
- **A full disk** was reasoned about, not produced.
- **Loudness range.** `loudness.ts` and ffmpeg disagree on short films (15.6 against 19.6 LU on the 6 s
  title). LRA is not used by export, so this is noted, not chased.
- The hardware encoder's run-to-run differences mean that decoded-frame equality could be shown only where
  the encoder repeated itself. Elsewhere the evidence is the canvas hashes plus PSNR at the encoder's own
  noise floor.

## Files changed

- `app/src/motionencode.ts`: the decoded-peak check and correction (`SOUND_CEILING_DB`, `SOUND_HEADROOM_DB`,
  `SOUND_MARGIN_DB`, `SOUND_RETRIES`).
- `app/src/motionaudioenc.ts`: `decodeAac` (new export), `decodePlanes`, and the fade in `fitBed` (`CUT_FADE`).
- `app/src/motionsoundplay.ts`: `EARLY` 45 ms and `LATE` 120 ms in place of `DRIFT`, one call's grace for a
  late picture, and stopping on `visibilitychange`.
- `app/test/pro-review-export.test.mjs` (new, 39 checks), `app/test/motionencode.test.mjs` (the import list),
  and `app/package.json` (the test in the chain).
- `docs/pro/review-export.md` (this page) and `docs/pro/requests/R2.md`.

Whole chain: `npm test` passes **159 suites, 15,135 checks, 0 failed**. `npx tsc --noEmit` and `npm run build`
pass.
