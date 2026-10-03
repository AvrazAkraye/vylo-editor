# F3: performance — the sound render, the glitch's memory, the test chain

Fix package F3 of the Pro pass (`docs/PRO.md`), branch `pro-f3-perf` from `pro` at `ab76f1a`. It answers items 1, 2
and 4 of `docs/pro/requests/R4.md`; item 3 (the model's prompt size) is the owner's call and is left alone. Every
WebKit number below was taken in the app's own engine (macOS 26.2 WKWebView, Apple M4) in an off-screen window with a
non-persistent data store, with the review R4 harness copied into this worktree's git-ignored `app/.test-build/`
(below); never the owner's app. Runs were repeated and, for before/after, interleaved.

## 1. The sound bed shares the thread (`motionsound.ts`, the renderer only)

**What was slow.** `renderSoundBed` ran in one piece after the effects were mixed. Measured part by part in WebKit,
the time was not where it looked: the loudness meter's **true-peak pass** (`truePeakOf`, run inside every
`measureLoudness`) takes up to 160 ms for ten loud seconds in this engine (less for sparse effects, whose quiet
stretches it skips), and the renderer ran the meter three or four times per bed (once in the music path, two or
three times in the loudness pass) when only the last reading's peak is ever used. The mixing, the limiter, the gain
passes and the fades ran in the same piece.

**What changed.**

- Every long pass works a block at a time (16,384 samples) and gives the thread back whenever it has held it for
  8 ms (`Pace`, `inBlocks`): the cue mix (between cues), the music path after the composer (clean-up, the level, the
  fades, the dips, the gain), the mix of music into the effects, the loudness pass (gain, the limiter's four passes,
  the final gain) and the fades. Each break checks the `AbortSignal`, so a newer change or Cancel stops a render
  within one slice. The order of every operation on every sample is unchanged.
- The meter is asked for the loudness alone (`truePeak: false`) where only the loudness is used. The one peak the bed
  needs — for `gainToTarget`'s ceiling at the very end — is read a block at a time with audiocore's `intervalPeaks`
  (the same points `truePeakOf` reads, kept as 32-bit floats; 16 ms for ten seconds in WebKit, in pieces).
  `finalGain` reads the gain at both ends of a ±1e-5 dB bracket around that peak: the gain can only fall as the peak
  rises, so when the two agree (or neither lowers the bed) it is exactly the gain the meter's own peak gives; when
  they do not, the meter runs whole, as before. Over 495 beds (below) the bracket decided every one; the whole meter
  was never needed.
- The meter, which still runs in one piece (3-5 ms for six seconds in the app), starts a slice of its own.
- The page yields with `setTimeout(0)`: a chain of them is held to 4 ms each, and that idle time is when WebKit's run
  loop does a frame's work (its rendering update runs when the run loop is about to wait). A message channel would
  give the thread back with no wait at all — the same 10 s Effects bed took 95-101 ms that way rather than
  138-145 ms — but nothing guarantees the run loop ever waits between back-to-back messages, and the off-screen
  window has no real animation frames to check it with, so the timer, which the request also proposed, was kept.
  Node (the tests) uses `setImmediate`.
- Two things are kept between renders, neither changing a sample: synthesised effects (by cue and rate, up to 8 MB,
  least recently used first), and the **last piece of music as the composer gave it** (by mood, seed, length, accents,
  rate and who played it; at most 11.5 MB). Moving the level renders the bed again but no longer composes the music
  again — and the composer is what holds the thread longest (below).

**The bytes are the same.** 495 beds (all 33 templates; Effects, Music, Both; levels 0.3, 0.6 and 1; four languages,
four shapes, 2-30 s; music from the tests' stand-in and from a full-scale 9 kHz tone that keeps the limiter and the
ceiling busy) rendered by the renderer before F3 and after it: **495 of 495 byte for byte identical**. Six of them
are pinned by digest in `test/pro-perf.test.mjs`. `pro-sound`, `pro-audio`, `pro-review-export`, `pro-mux-audio`,
`motionexport`, `motionencode` and `pro-wiring` pass untouched.

### Numbers

Bare page (`.test-build/f3/perf-sound.ts`, `soundBlock`), a 4 ms ticker beside one render, a fresh seed so nothing is
served from what was kept; render time / the longest the thread was held, two interleaved rounds each:

| bed | before F3 | after F3 |
|---|---|---|
| Effects, Big title, 6 s | 111 / 78-79 ms | 88-98 / 22-27 ms |
| Effects, Steps, 10 s | 105-106 / 105-106 | 138-145 / 13-15 |
| Effects, Stats, 30 s | 343-346 / 343-346 | 263-286 / 13-14 |
| Music, Big title, 6 s | 550-552 / 282 | 343-347 / **159** |
| Both, Big title, 6 s | 411-413 / 187-188 | 288-293 / **115-116** |
| Both, Stats, 10 s | 630-663 / 312-319 | 414-416 / **225-226** |
| Both, Stats, 30 s | 1,229-1,235 / 733-739 | 860-866 / **209-214** |
| Level moved, Both 6-10 s (music kept) | as a full Both render | 80-96 / 13-21 |
| Level moved, Effects 30 s | as a full render | 128-182 / 13 |

Render time fell everywhere but the 10 s Effects bed (+35%, the timer's 4 ms per break). **Every hold left over 30 ms
is inside the composer**, `videosynth.render` (below).

The whole app (`s22-soundhitch`, R4's scenario: Big title, 6 s, playing at 60 Hz, the longest frame gap after each
change; the QA stub's frames come from a timer). Before and after were built from the same tree and run alternately
(`qa/qa-ab.mjs`, `F3_BEFORE=1`):

| change while playing | R4 (two runs) | before F3 (five runs) | after F3 (eleven runs) |
|---|---|---|---|
| nothing | 19 ms | 19 | 18-22 |
| Sound: Off → Both | 248 / 264 | 254-267 | 159-266 |
| Level slider moved | 222 / 236 | 230-257 | **23-33** |
| Another mood | 948 / 316 | 263-956 | 257-459, three runs 608-885 |
| Both → Effects | 85 / 86 | 79-99 | **31-50** |

Node (`test/pro-perf.test.mjs`, the event loop, not frames): a 10 s Effects bed waits at most 9-19 ms (the files
before F3, the same test: 45-67), a 10 s Music bed with the stand-in composer 11-21 ms (before: 67-75); a render
stopped 40 ms in stops 17-26 ms later (before: it ran to the end).

**The target is met for the level and for Effects (31-50 ms; in one of eleven runs the gap was 50: one 20-30 ms
slice that the meter — 3-5 ms in the same page — does not explain, most likely a collection of the page's heap); not
for Off → Both or a new mood.** Those two compose new music, and the composer holds the thread itself. Traced in
WebKit for a 6 s graphic: its three slices are set up back to back before their first `await` (the longest hold,
by mood, 74-333 ms; a crash cymbal alone is synthesised in 53 ms), then its own loudness-and-limiter pass takes
49 ms and the reverb's impulse 16 ms. All of it is in `videosynth.ts`, a Video file this pass may not touch
(request below). A scratch copy of it that yields between notes (not committed) took the longest hold for Big title
from 162 to 62 ms; the cymbal and the composer's finish are what remain.

## 2. The glitch transition's memory (`motiontransition.ts`)

**The cause, measured.** Not the slices. A probe (`.test-build/f3/glitch-mem.ts`) painted a glitch on every frame at
1080p and took the parts apart; one frame per task, each frame flushed, 600-900 frames, web content process:

| what is drawn | memory | time a frame |
|---|---|---|
| the scene alone, one draw (control) | 79 → 118 MB | 6.9 ms |
| the old glitch's slices only | 80 → 107 MB | 6.8 ms |
| the old glitch's colour copies only | 214 → 248 MB | 13.5 ms |
| the old glitch | 215 → 274 MB | 13.6 ms |
| the colour copies without their `destination-in` step | 84 → 117 MB | 10.1 ms |

The tint cut each red and cyan copy back to the picture's shape with `drawImage` under `destination-in`, twice a
frame. WebKit draws an image under `destination-in`, `source-in`, `source-out` or `destination-atop` through a
temporary buffer the size of the whole canvas; the fade and the shaped reveals use those operations only with fills,
which do not do this.

**The change.** The tint is now the picture's shape filled with the colour (`source-atop` over a copy of it), then the
picture multiplied into that. Same number of draws; no full-canvas operation. On an opaque graphic the frames are
**pixel for pixel the same** (Big title at three moments: 0 of 2,073,600 channel values differ); on a see-through one
the semi-transparent edges differ slightly (lower third: 0.17% of values, at most 21 levels, at its shadow), which no
one will see in a 0.3 s transition.

| | before | after |
|---|---|---|
| R4's own method (Big title in four scenes, every transition a glitch, 900 frames painted 150 at a time, not flushed) | web 63 → 92 → 100 → 156 → **318** → 255 MB | 61 → 92 → 100 → 116 → **118** → 120 MB |
| a glitch on every frame, one frame per task, flushed | 215 → 274 MB, 13.6 ms a frame | 84 → 141 MB, 8.5 ms |
| a glitch on every frame, 150 frames at a time | up to **2.5 GB** (208 MB after 0.5 s idle), 7.5 ms | at most 107 MB, 3.0 ms |

The GPU process moved as before (100-270 MB, up and down, for every kind). **Not done, on purpose:** fewer, wider slices
(they cost nothing measurable, so it would change the look for nothing), and one tinted copy per step reused over its
frames (a frame would then depend on which frames were painted before it — a seek against an export — against this
file's rule that every render of a moment is the same picture). `pro-scenes` passes untouched: no expectation needed
to change.

## 3. A lighter default for the slowest test (`test/pro-templates-b.test.mjs`)

**15.9 s → 1.6-1.7 s by default, 4.2 s for the full sweep.** Two changes:

- 12.2 of its 15.9 s were one check: the grain's frame signature serialised the grain tile handed to `createPattern` —
  its whole recording, 256 × 256 noise values, three megabytes — for each of 720 frames. Its rounding replacer never
  ran (`J` takes one argument), so the comparison was always exact; it now writes each canvas as a digest of its
  recording, made once per canvas, which compares exactly the same. This is not a lighter check: the same 720 frames.
- The main sweep (every template × language × shape × 4 lengths, 448 builds of 12 frames) runs by default as every
  template in the wide and the tall shape, in English and a right-to-left language that turns with the template (so
  Arabic, Sorani and Badini all run), at its own length, the shortest (1 s) and the longest (30 s): 84 builds. The
  extremes still run in full every time: the longest text every field takes and every field empty, in all four
  shapes; the mirror test in all four; 300 builds of junk; the price card's shine at four lengths in every language
  and shape.

**The full sweep**, as documented at the top of the test:

    cd app && VYLO_FULL=1 node test/pro-templates-b.test.mjs     # after any npm test (it builds .test-build)
    cd app && VYLO_FULL=1 npm test                               # the whole chain with the full sweep

**The default still catches what the reviews found.** With W2-4's price-card defect put back for the run (the shine
started after everything had landed, so the cover caught it mid-sweep), the default run fails
(`...the button's light rides its pop and has crossed it by the still, at any length`, at 2.5, 6 and 12 s), as the
full one does; restored, it passes. `test/pro-perf.test.mjs` run against the files as they were before F3 fails 6 of
its 13 checks (the ticker waits 45-75 ms, a stopped render runs to the end, the level composes again, the glitch draws
under `destination-in`) and passes its byte pins; against F3's, all 13 pass. **What the lighter default gives up:** a
fault in one template that shows only in Square or 4:5, only at 2 s, or only in one of the right-to-left languages
the rotation did not give that template, waits for a `VYLO_FULL=1` run.

**The chain:** `npm test` 1 min 19 s → **1 min 4 s** wall on this machine; every step run alone, 64.2 s in sum (R4:
75.4 s; base 31.1 s). The rest of the gap is in tests this package does not own: `motionfuzz-templates` 5.6 s,
`pro-audio` 4.9 s, `pro-sound` 4.5 s, `pro-review-safety` 3.6 s, `pro-mux-audio` 3.2 s, `pro-export` 2.7 s; the same
treatment (a representative default, the full sweep behind `VYLO_FULL=1`) would suit the first three.

## The new test (`test/pro-perf.test.mjs`, 13 checks, about 2 s, before `orphans.test`)

The bed shares the thread (a 10 s Effects bed and a 10 s Music bed beside a 4 ms ticker never wait 30 ms; best of
three, after a warm-up; in Node this measures the event loop, the frames are measured above); a stopped render stops
at its next break and leaves nothing kept; six beds pinned byte for byte, and three rendered at once are each the same;
moving the level does not compose again and the bed from kept music is the bed without it; `intervalPeaks` agrees with
`truePeakOf` to a 32-bit float and a block read with 16 samples either side gives the whole channel's points; no
transition, at any of 41 moments, draws a picture under a full-canvas operation; the glitch still knocks slices and
splits its colours, tinted the new way.

## How it was measured (all git-ignored, in `app/.test-build/`)

- `qa/` — R4's rig, copied: `qa.mjs`, `qa-host.swift` (compiled here), `qa-lib.ts`, `qa-stub.ts`,
  `s22-soundhitch.ts`; `qa-ab.mjs` is `qa.mjs` with `F3_BEFORE=1`. Run: `node .test-build/qa/qa.mjs .test-build/qa/s22-soundhitch.ts --size 1500x950 --hash
  "lang=en&theme=dark" --tag NAME`. `s22b-trace.ts` with `qa-instr.mjs` (an instrumented copy of the renderer) shows
  which slice ends a long frame gap.
- `r4/` — R4's perf page (`perf.mjs`, `perf-common.ts`, `perf-pro.ts`); `f3/perf-ab.mjs` is the same runner with
  `F3_BEFORE=1` (builds against `f3/before-src/`, the pre-F3 renderer and transitions) and `F3_VS=1` (a scratch copy
  of the composer). `f3/perf-sound.ts` (`soundBlock`, `levelBlock`, `composerTimeline`, `composerByMood`, `parts`),
  `f3/glitch-mem.ts` (`glitchMem`, `glitchShots`).
- `f3/compare.mjs` (the 495-bed byte comparison against `f3/before/motionsound.js`), `f3/digests.mjs`,
  `f3/ticker.mjs`, `f3/steps.py` (R4's per-step timer).

## What was not verified

- **Real frames.** The off-screen host has no animation frames (measured: none in a second); the whole-app numbers
  come from the QA stub's timer-driven frames. That WebKit draws a frame in the idle time each timer break leaves is
  reasoned from how its run loop works, not seen: worth one look on screen (a graphic playing while the level is
  dragged).
- **Hearing it.** Nothing was played. The bytes are proven equal, so the sound is what it was; nobody has listened
  to it, before or after.
- **Windows (WebView2).** Not run. The breaks are plain timers, which a browser interleaves with its frames; the
  glitch's memory was measured in WebKit only; its new tint uses `source-atop` and `multiply`, which every engine
  has (the flash already uses the first).
- The 20-30 ms slice in the first Effects-only render after music (above): the meter's own call took that long
  inside the render and 3-5 ms when timed alone in the same page; a collection of the heap is the likely cause and
  was not proven. Reusing the limiter's arrays across renders did not change it.

## Requests (outside this package's files)

1. **`videosynth.ts` (Video; whoever may next edit it):** make `render` share the thread too, without changing its
   output: yield between notes while a slice is set up (and between the slices' set-ups, which now run back to back
   before their first `await`), synthesise the crash cymbal in blocks or keep it per seed and rate, and do the final
   loudness-and-limiter pass in blocks. Measured with a scratch copy, yielding between notes alone takes Big title's
   longest hold from 162 to 62 ms; the cymbal (53 ms) and the finish (49 ms for 6 s) are the rest. That is what
   stands between Off → Both and a new mood and the 50 ms target.
2. **`audiocore.ts` (package 02):** `truePeakOf` is about ten times slower in WebKit than `intervalPeaks`, which reads
   the same points (163 against 16 ms for ten loud seconds, both channels); why was not looked into. The export's AAC
   peak check (R2) pays it on every film with sound (136-142 ms for 30 s).
3. **The slow tests above** (`motionfuzz-templates`, `pro-audio`, `pro-sound`): a representative default with the full
   sweep behind `VYLO_FULL=1`, as here.
