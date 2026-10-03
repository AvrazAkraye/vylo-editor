# Review R4: whole-app regression and performance

Wave 3 of the Pro pass (`docs/PRO.md`), branch `pro-r-regress` from `pro` at `a3faefa`. The question: did the pass
break anything outside Motion, and is Motion still fast? Every comparison is against the base, commit `8631266`
(0.132.0 plus the logo-shadow fix), extracted with `git archive` into a scratch directory outside the repository
and built and run there with the same tools. Measured on the owner's Mac in the system WKWebView (macOS 26.2), the
engine the app runs in, in an off-screen window with its own non-persistent data store; never the running app.

**Verdict.** Nothing outside Motion changed behaviour. 21 of the 22 whole-app Motion scenarios give the base's
results, or differ only where the pass meant them to; the 22nd (Export) drives controls the pass replaced, and the
same checks pass through the new controls. Preview, check and export meet PRO.md's budget, with one breach: the
preview freezes for 0.1–0.9 s while a sound bed is rendered after a sound setting changes
(`docs/pro/requests/R4.md` §1). No fix was made in R4's lane, because none of its files was at fault.

## How it was measured

All tools are in `app/.test-build/` (git-ignored):

- `qa/`: the 0.132.0 scenario rig (`qa.mjs` bundles the whole app with a fake Tauri, a fake gateway and no network,
  and runs it in `qa-host`, a WKWebView host). R4 added to its host a `mem` op (the web content and GPU processes'
  memory footprint, `proc_pid_rusage`), to its stub a frame timer, and scenarios `s04p-export` (s04 through the
  new Export), `s20-studios` (the rest of the app), `s21-perf`, `s22-soundhitch`.
- `r4/perf.mjs` with `perf-common.ts` (builds against both trees) and `perf-pro.ts`: paint, check, sound and
  export timings in a bare page. `r4/dist-run.mjs`: the production bundle (`vite build` output) served with the
  QA stub, ten fresh processes per tree. `r4/bench.mjs` interleaves base and Pro runs. `r4/tools/`: `steps.py`
  (every test step alone, with assertion names), `diffres.py` (scenario results key by key), `sizes.mjs`,
  `i18n-keys.mjs`. The base tree was deleted afterwards; to compare again, `git archive 8631266 | tar -x -C
  ../vylo-editor-pro-r-regress.scratch/base`, link its `app/node_modules`, and copy `qa/` and `r4/` into its
  `app/.test-build/` (the path `bench.mjs` expects).

WebKit's clock is coarse (1 ms) in a page that is not cross-origin isolated, so per-frame paint times are means
over windows of ten frames, and "flushed" means a one-pixel read-back after each frame so the time includes the
drawing WebKit would otherwise defer to its GPU process. Other reviewers' WebKit and encoder jobs were running on
the same machine (load average 3–9): runs were repeated and interleaved, and the medians are reported.

## 1. Regression

### The 22 whole-app Motion scenarios (base → Pro)

All 22 ran with 0 page errors, 0 warnings, in both trees.

| Scenario | Result | What differs from the base, and why |
|---|---|---|
| s01 sidebar, en 300 px / ar 400 px / ckb 300 px | pass | nothing |
| s02a full window | pass | gallery cards 18 → 33 (the new templates) |
| s02b layers | pass | the Lower third's selected layer is "Shine", which W2-4 retimed (1.5–2.6 s → 0.75–1.62 s); the selection box and a drag's distance differ with the smaller stage; undo and redo return exactly |
| s02c length and title, s02d keys | pass | nothing |
| s03a make, en / ckb | pass | the plan prompt 8,997 → 17,886 characters, and its "Format" line names the shapes (package 10) |
| s03b ask (ar), s03c Ask Vylo | pass | nothing |
| s04 export | **fail on Pro**, by design | the scenario presses the old Format and Size rows, which the pass replaced with destination cards ("Where is it going?"); it exported an MP4 where it expected a PNG. Adapted as `s04p-export` (cards, More options, "at the playhead"): **pass**. MP4 720p written and opened/revealed; PNG at 3.00 s byte for byte the base's (1,089,611 bytes); the overlay PNG keeps alpha (corners `[0,0,0,0]`); the MP4 note about transparency; Save as… writes to the chosen path, and a closed panel writes nothing; Cancel mid-way writes nothing; deleting the graphic while it exports writes nothing and shows no error. MP4 sizes vary run to run in both trees (VideoToolbox: 1,524,805, 1,521,818, 1,518,127 bytes) |
| s05 modules (ckb) | pass | nothing |
| s06 robustness | pass | two hostile records with no valid timestamp list in the other order (each is given the time it was read; immaterial); stage sizes smaller |
| s06b sizes (ar) | pass | the stage is smaller at every window size (e.g. 732 × 412 → 640 × 360; the sidebar's canvas 28 px shorter): the check row and the scene band |
| s07 empty | pass | nothing |
| s08 persist across a reload | pass | `getAll` order (by random id); the same two graphics, the one typed just before the reload kept |
| s08b journal, s09 sidebar tabs, s10 runs, s11 keys, s12 misc | pass | nothing |

### The rest of the app (`s20-studios`, en, ar, kmr)

Every rail module opened in the sidebar (19: Changes, Chats, Dashboard, Dev server, Explorer, Memory, Motion,
Outline, Plugins, Prompts, Research, Routines, Search, Skills, Slides, To do, Usage, Video, WhatsApp), each studio
over the whole window and closed again (Research, Video, Slides, Motion), every Settings section (9). Identical
between the trees in all three languages, with no page error anywhere, except that Motion's window now holds 59
buttons instead of 43.

### The test chain

`npm test` passes (exit 0). Every step run alone in both trees: 145 → 157 steps, 13,066 → 14,862 assertions, no
failure. **No test outside Motion changed in meaning**: every non-Motion test has the same assertions by name; the
only differences are timings printed in names (researchdata: 29 → 30 ms and similar). Motion tests whose names
changed did so for the pass's own reasons (12 backdrops, 6 charts, 33 templates, the prompt budget, the encoder
now importing the AAC writer, the lower third's sweep). The ten Video tests have the same assertions, by name and
count, in both trees: video 515, videoedit 589, videochat 369, videosynth 286, videoresearch 124, videomix 107,
videomedia 97, videoexport 88, videolook 42, videolink 40.

### Video and the other studios' files

`git diff --stat 8631266 HEAD -- 'app/src/Video*' 'app/src/video*'` is empty, and no commit of the pass names a
Video file (now a test, below). The pass imports `videosynth.ts` only by `import()` and its types.

### The bundle

| | Base | Pro | Change |
|---|---|---|---|
| All of `dist/` | 7,957,844 B, 30 files | 8,306,347 B, 32 files | +348,503 (+4.4%) |
| Startup chunk `index-*.js` | 1,952,399 (619,437 gz) | 2,012,822 (637,637 gz) | +60,423 (+3.1%) |
| Startup CSS | 334,933 (51,058 gz) | 350,727 (53,366 gz) | +15,794 |
| Motion chunk `MotionPanel-*.js` | 434,581 (151,748 gz) | 705,889 (249,373 gz) | +271,308 (+62%) |
| Video (VideoPanel + its chunks) | 2,111,781 | 2,112,483 | +702: the same code, split into `video-*.js` and `videosynth-*.js` because Motion now imports the composer by `import()` |

What loads at startup, read from the production bundle running in WebKit: `index.css`, `index.js`, the Arabic
face and the same ten small `index-*.js` chunks (CodeMirror's language support, unchanged) as the base. **No Motion code.** Opening Motion
loads `MotionPanel.js`, `videotypes.js` and `path.js`, as before; opening a template loads nothing more; the music
composer (`videosynth.js` with `video.js`) loads only when music is first rendered. The parts of the audio library
the studio does not call (`audiofx`, `audioauto`, `audioduck`) are in no chunk. Inside the Motion chunk, the Pro
pass's largest additions (minified): the two template files 44 KB and 32 KB, the check 19 KB, search 16 KB, sound
14 KB, the GIF writer 10 KB, the scene strip 9 KB, the AAC writer 8 KB, transitions 8 KB, scenes 8 KB.

**i18n**: 2,990 → 3,241 entries in each of ar, ckb and kmr (+251, +8.4%), 484,034 → 524,150 characters of
catalogue, `i18n.ts` 780,210 → 845,692 bytes. It is all of the startup chunk's growth. Sane for ten packages (the
0.132.0 release added about 570).

## 2. Performance

### Startup (production bundle, ten fresh processes per tree, medians)

| | Base | Pro |
|---|---|---|
| App to its rail and title bar | 71.5 ms | 70.0 ms |
| Click Motion → window and gallery (chunk loaded and parsed) | 61.5 ms | 76.5 ms |
| Click a template (Big title) → stage drawn | 22.0 ms | 29.0 ms |

### Preview, 1080p, 300 frames at 30 fps (bare page, two runs each)

Mean per frame; JS only, then flushed. Core templates are the same at the base and with the Pro pass:

| Template (layers) | Base JS / flushed | Pro JS / flushed |
|---|---|---|
| big-title (6) | 0.14 / 1.9 ms | 0.15 / 1.8 ms |
| lower-third (7; 6 now) | 0.04 / 0.85 | 0.04 / 0.83 |
| stats (14) | 0.16 / 1.78 | 0.20 / 1.86 |
| bar-chart (4) | 0.17 / 1.46 | 0.16 / 1.48 |
| kinetic (10) | 0.13 / 3.96 | 0.13 / 3.95 |
| loop-bg (2) | 0.09 / 1.95 | 0.09 / 1.87 |

With scenes (Pro): big-title cut in three, push and glitch, 0.12 / 1.9–2.2 ms overall, **transition frames 4.1–5.0
ms flushed** (median); in four with iris, glitch and pixelate, 2.1–2.3 ms overall, transition frames 4.1–4.2 ms
median, 7.4–8.6 ms p95. New templates: film-look 0.10 / 1.7, bar-race 0.20 / 1.85, retro-title 0.9 / 4.2,
lt-neon 0.05 / 1.2, ui-device 0.1 / 1.35. A frame is 33 ms at 30 fps: the slowest is a quarter of it.

**The scene painter reuses its canvases**: two `OffscreenCanvas`es per frame size, made at the first transition
and never again (counted over 300, 600, 900 and 2,000 frames); a graphic without scenes makes none.

### Preview in the whole app (`s21-perf`, three clean runs per tree, plus two earlier)

Stage canvas 1047 × 589 at the base, 960 × 540 now (the check row and scene band). Frame gaps at 60 Hz, as median /
p95 / max, and the frame's main-thread work (callbacks plus React's render) mean / p95:

| | Base | Pro |
|---|---|---|
| Playing 5 s | 17 / 17–18 / 18–20 ms, 0 over 33; work 1.2–1.7 / 2–3 ms | 17 / 17–18 / 18–21, 0 over 33; work 1.4–1.8 / 2–3 |
| Playing while typing (check runs 250 ms after each key) | 17 / 18 / 20–24, 0 over 33 | 17 / 18 / 21, 0 over 33 |
| Playing with sound on (Both) | — | 17 / 17–18 / 18–22, 0 over 33 |
| Playing with sound on, typing | — | 17 / 17–18 / 18–19, 0 over 33 (words are not in the sound's key) |
| Playing three scenes (one transition) | — | 17 / 17–18 / 18–19, 0 over 33 |

One further run, taken while the machine's load average was 9.5 (and with a measuring channel made per frame,
since removed), showed 11 frames over 33 ms (max 79) playing the scenes and 1 with sound on; the five other runs
of the same scenario showed none, so it is counted as the machine, not the graphic. The two earlier runs (without
the work column): gap max 18–25 ms in the Pro pass with 0 over 33; at the base one frame of 34 ms, once, while
typing.

**Breach: changing the sound.** Playing, then turning sound on, moving the level or choosing a mood: the preview
stops for 222–948 ms, two frames over 100 ms each time (`s22-soundhitch`; requests §1). The bed renders on the
main thread: Effects for 10 s holds it 121 ms without a break (30 s: 349 ms); Music 649 ms with a longest hold of
214 ms; Both 570 ms, 144 ms. Kept by key afterwards (asking again: 0–1 ms).

### The check

In WebKit (bare page): first run (words measured cold) 7 ms for big-title, 2 for lower-third, 4 for stats, 1 for
film-look; warm, the median is under the 1 ms clock (means 0.03–0.3 ms). **30 layers: first 2–6 ms, warm mean
0.5–0.73 ms**; 60 layers: warm mean 1.67 ms. In Node, 30 layers: 1.4 ms. Budget 25 ms: met by thirty times. It runs
250 ms after the graphic stops changing, never with the playhead (it does not subscribe to the clock), so playing
does not run it.

### Memory (web content / GPU process footprint)

- **2,000 frames of scrubbing**, whole app (five runs each): base 171–189 → 195–209 MB, Pro 172–192 → 209–222
  MB; the GPU process falls (105–112 → 28–39 MB) in both. Bare page, big-title without scenes: base 49 → plateau 97–107 MB, Pro 56 →
  101–113 MB, flat after frame 400. No growth.
- **With scenes**: four scenes, 2,000 frames: plateau 233–248 MB (web), flat from frame 600; GPU 152–305 MB,
  up and down. By kind over 900 frames: a glitch takes the web process to 253–316 MB, every other kind to 114–127
  MB; any transition raises the GPU process to 170–339 MB at times (requests §2). Bounded, not a leak.
- **50 edits**, whole app (each followed by the check): base 195–209 → 213–230 MB, Pro 209–222 → 224–228 MB.
  Bare page, the check after each of 50 edits: 29 → 51 MB (6 layers), 51 → 87 MB (30 layers; JS heap not yet
  collected), check mean 0.36 / 0.92 ms. The check keeps one cache, bounded at 64 path shapes; the sound keeps
  beds up to 32 MB.
- After turning sound on: about +15–35 MB; after three scenes: 235–248 MB.

### Export, 10 s Big title, 30 fps, high quality (three rounds; medians)

| | Base | Pro |
|---|---|---|
| 1080p | 1,683 ms (1,435 in the quiet round) | 1,415 ms (1,432) |
| 1080p, motion blur | 8,655 ms | 7,701 ms (8,498) |
| 4K | 5,149 ms (5,040) | 5,059 ms (5,034) |
| 4K, motion blur | 26,483 ms | 25,698 ms |
| 1080p with sound (Both) | — | 2,215 ms |
| 4K with sound | — | 5,115 ms (the bed is kept from the 1080p film, as a second export in the app would find it) |
| 1080p, blur and sound | — | 8,216 ms |
| 1080p, three scenes | — | 1,419 ms |

**Export is not slower without sound** (in the quiet round the two trees are within 1% at every size). Sound costs
about 0.8 s at 1080p (rendering the bed, then AAC). The pass's unchanged-frame skip shows on graphics that hold
still; Big title animates throughout.

## 3. The budget, in PRO.md's terms

| Promise | Measured | |
|---|---|---|
| Preview smooth for a typical graphic | 60 Hz kept, 0 frames over 33 ms, with and without scenes, sound on, check running, typing | met |
| … while the sound is changed | 0.2–0.9 s freeze at each sound change | **breach**, requests §1 |
| Check under 25 ms for 30 layers, debounced | 2–6 ms first, < 1 ms warm; 250 ms after the last change | met |
| Nothing in `paint` allocates per frame without need | no canvas per frame (2 per size, once); a small closure and copy per frame for a graphic with scenes, unmeasurable (0.12 vs 0.13 ms) | met |
| Export not slower without sound | equal within noise, faster in two rounds | met |
| New heavy modules cost nothing until used | composer and unused audio library: not loaded until used; GIF writer, scenes, check: in the Motion chunk, not at app start (+15 ms to open Motion) | met |

## 4. Kept as a test

`app/test/pro-review-regress.test.mjs` (27 checks, wired before `orphans.test`): nothing of Motion, sound or audio
reachable from `main.tsx` without `import()`; `videosynth`, `video`, `audiofx`, `audioauto`, `audioduck` not in the
panel's static graph; no `pro…` commit touches a Video file (skipped where git or the base commit is absent); the
Motion chunk's own code under 1,000,000 bytes minified (743,544 now) and `i18n.ts` under 1,000,000; the check under
25 ms for 30 layers; no offscreen canvas per frame without scenes, two at most with them over 600 frames; a
transition frame under 30 ms and an ordinary scene frame under three plain ones; reading a graphic with sound and
scenes under 5 ms; a film without sound renders no bed; the check and the sound preview debounced at least 200 ms
and the chip off the clock.

## What was not verified

- Sound heard: an off-screen page has no user gesture, so the preview's context may stay suspended; the render
  cost and the frame gaps are measured, the audio is not.
- The Rust change (`video.rs`, `.gif` in `export_write_video`): `cargo test` was not run here (a full Tauri build;
  the export review covers it).
- Real-display timing: the off-screen page's frames come from a 16 ms timer, not the display's vsync, so a frame
  that overruns shows as a longer gap but frame pacing against a real screen is not measured.
- Absolute numbers were taken with other reviewers' jobs on the same machine; comparisons are interleaved and
  repeated, the absolute values may be optimistic or pessimistic by 10–30%.
