# S1: the final sample files, and how to make and check them again

S1 of the Pro pass, branch `pro-s1-samples` from the final integrated `pro` (`42a00b3`), 2026-10-03. The owner judges
the Motion work by opening and listening to sample files. R2 made the first set (`vylo-pro-samples/`) before the scene-sound
fix (F2), the cooperative sound render and the glitch change (F3), and R5's template and content fixes. S1 made the set
again from the final build, added three films for the later fixes, and checked every file with more tools. No
source file was changed.

- **The samples:** `/Volumes/ExtremeSSD/apps/vylo-pro-samples-final/` (its `README.md` describes each file, what to
  look and listen for, and every measurement). 19 files: 9 MP4s in `mp4/`, 2 GIFs, 1 PNG, 7 stress films.
- **The harness:** `docs/pro/samples/` (R2's harness with S1's additions) and `docs/pro/samples/rc/` (R5's contact-sheet
  harness), committed so it outlives the worktrees. Each runs from a copy in the git-ignored `app/.test-build/`.
- **A problem found:** `docs/pro/requests/S1.md`. Exports with sound are slow in a hidden page since F3.

## What the set shows

| | recipe (`make.mjs` `SPECS`) |
|---|---|
| R2's sixteen | unchanged: `mp4/01`–`06`, `gif/07`, `gif/08`, `png/09` and the seven `stress/` films, the same specs as R2's `make.mjs` |
| `mp4/10-plus-scene-push-both` | `build: 'plusScene'`: the studio's own edit functions in the order a person clicks them. `buildMotion` Big title → `addScene(m, 2.5)` ("+ Scene", MotionScenes.tsx `add`) → `placeAdded(m, addLayer(m, 'text', { text, id, name }), 6)` (Layers' Add through MotionPanel's `inScene`) → `setLayer` (its words, size 9) → `setTransition(…, 'push')` → `setFields` (Design's *Words on screen*). Sound Both |
| `mp4/11-four-scenes-effects` | R2's four-scene graphic (04) with Sound Effects only, so the silent holds can be heard |
| `mp4/12-brand-arabic-music` | `build: 'brand'`: `buildMotion(kitOptionsWithBrand(…, readBrand(kit)))`, as the gallery builds a template while a kit is set. Logo reveal, Arabic, kit: name, handle, address, palette Sunset, face Serif, no logo. Sound Music |

`samples.ts` records each build step (`story` in `out/meta/<name>.json`): for film 10, the graphic stayed the
template's after every step (`recipe` kept, `until` 6), and the person's text runs 6–9 s.

## How to make them again

All commands from `app/` of a worktree on the build to sample. Never drive the owner's running app. The host is an
off-screen WKWebView with a non-persistent data store.

```sh
# 1. The test bundle (the first step of `npm test`; verify.mjs needs .test-build/loudness.js)
CMD=$(node -e 'console.log(require("./package.json").scripts.test.split("&&")[0].trim())')
PATH=$PWD/node_modules/.bin:$PATH eval "$CMD"

# 2. The harness and its Swift tools
mkdir -p .test-build/s1/tmp .test-build/s1/old .test-build/rc
cp ../docs/pro/samples/*.* .test-build/s1/ && cp ../docs/pro/samples/rc/* .test-build/rc/
(cd .test-build/s1 && swiftc -O webkit-host.swift -o webkit-host && swiftc -O avdump.swift -o avdump && swiftc -O gifcheck.swift -o gifcheck)
(cd .test-build/rc && swiftc -O host.swift -o host)

# 3. Make and verify every file (ffprobe, ffmpeg's decoder and EBU R128 meter, AVFoundation, the app's meter)
#    into /Volumes/ExtremeSSD/apps/vylo-pro-samples-final (S1_OUT=dir for another place; a name filter as argument)
node .test-build/s1/make.mjs > .test-build/s1/make-final.log 2>&1

# 4. Second opinions: afinfo and afconvert (AudioToolbox), AVFoundation metered by the app's meter
node .test-build/s1/allextra.mjs
# 5. Clicks at every scene cut; GIFs and PNG (ffmpeg, ImageIO, sips, loop restart, the app's canvas)
node .test-build/s1/cuts2.mjs && node .test-build/s1/gifs.mjs
# 6. The film without sound against the 0.132.0 writer, byte for byte
git show 4b13ed8:app/src/motionmp4.ts > .test-build/s1/old/motionmp4.ts
./node_modules/.bin/esbuild .test-build/s1/old/motionmp4.ts --bundle --format=esm --outfile=.test-build/s1/old/motionmp4.js --log-level=error
./node_modules/.bin/esbuild src/motionmp4.ts --bundle --format=esm --outfile=.test-build/s1/old/newmp4.js --log-level=error
node .test-build/s1/oldwriter.mjs /Volumes/ExtremeSSD/apps/vylo-pro-samples-final/stress/sound-off-title.mp4

# 7. Cues before and after the scene-sound fix, on the very graphics the films were made from
mkdir -p .test-build/s1/before-src && git archive 2758ba7 app/src | tar -x -C .test-build/s1/before-src
./node_modules/.bin/esbuild .test-build/s1/before-src/app/src/motionsound.ts .test-build/s1/before-src/app/src/motionscene.ts \
  --bundle --format=esm --outdir=.test-build/s1/before --external:@tauri-apps/api/core --external:@codemirror/state --log-level=error
for n in 04-scenes-push-iris-flash 10-plus-scene-push-both 11-four-scenes-effects 30s-blur-ten-scenes-both; do
  SPEC=$(node -e "import('./.test-build/s1/make.mjs').then(m=>console.log(JSON.stringify(m.SPECS.find(s=>s.name.endsWith('$n')))))")
  node .test-build/s1/wk2.mjs .test-build/s1/samples.ts "dumpDoc($SPEC)" .test-build/s1/out/dump-$n.json --size 800x600 --timeout 120
done
node .test-build/s1/cuesab.mjs && node .test-build/s1/stills.mjs

# 8. The table for the README, and the 99 contact sheets against R5's
node .test-build/s1/table.mjs
(cd .test-build/rc && node all.mjs ./now/ && node sheets.mjs)
```

What each script is: `wk2.mjs` bundles an entry, serves it on 127.0.0.1 and runs the host, which POSTs large files
back. `samples.ts` runs in the page: `sample` makes one file exactly as the Export tab does, and `skipVsFull`,
`gifReference`, `dumpDoc`, `bedTime` and `bedOnly` are probes. `make.mjs` has the specs and the run. `verify.mjs`
is R2's whole check of one film. `extra.mjs` adds afinfo, afconvert, AVFoundation and their meters. `cuts2.mjs`
checks the cuts, `stills.mjs` the frozen stretches, `cuesab.mjs` the cues before and after, `gifs.mjs` and
`gifverify.mjs` the GIFs and the PNG, `oldwriter.mjs` the sound-off film, and `table.mjs` builds the table. The
Swift tools: `avdump` (AVAssetReader), `gifcheck` (ImageIO), `webkit-host`.

To time an export with R2's code beside this build's (the request's evidence): link `node_modules` into
`.test-build/s1/before-src/app/`, copy `wk2.mjs`, `webkit-host` and R2's original `samples.ts` (git-ignored, in
`vylo-editor-pro-r-export/app/.test-build/r2/`; the committed one imports functions that did not exist yet) into
`before-src/app/.test-build/x/`, and run the same `sample(spec)` from both trees in turn.

## How each file was checked

| check | how | result |
|---|---|---|
| A/V start and length | ffprobe stream start and duration; AVFoundation time ranges; afinfo's valid frames; decoded length in ffmpeg, AVFoundation and afconvert against frames ÷ fps × 48000 | every film: both tracks start at 0 and last exactly the film. 0 samples off in all four readings. The first audio packet sits at −0.044 s (2112 priming samples, skipped by the edit list) |
| A/V sync | cross-correlation of each decode against the bed the app rendered, ±3000 samples, loudest half second | lag 0 in all three decoders, every film |
| loudness, true peak | ffmpeg `ebur128=peak=true` on the file; the app's `measureLoudness` on ffmpeg's, AVFoundation's and afconvert's decodes; ffmpeg's meter on afconvert's WAV | 60% films −16.0 to −16.2 LUFS; level 100% −14.4; 30% −22.1; sparse effects −17.4 (by design). True peak −1.6 dBTP at worst (level 100%), −1.7 at 60% (film 10). All three decoders agree to 0.01 |
| clipping | samples at or over 0.999 in three decodes | 0 everywhere |
| clicks | R2's detector (a second difference more than 10 times its ±5 ms RMS, above 0.02); first and last ms peak; at each scene cut, the ±5 ms peak over the ±50 ms RMS | none at starts, ends or cuts (cut ratios 0 to 4.11; a click reads in the tens). The three spots flagged elsewhere are R2's three, in the composed music |
| stereo | L − R RMS in dB, correlation | centred graphics within ±0.83 dB; the lower third +4.58 dB by design |
| picture | PSNR of every frame against R2's file; a re-run of R2's skip-versus-full check on film 05 | all but one film within encoder noise (≥ 51.6 dB) or identical. The 30 s film's Kinetic scene changed (R5's fix, `abf2dee`). Film 05: 0 of 120 decoded frames differ |
| GIF | the file's blocks; ffmpeg's and ImageIO's decodes against each other and against the app's canvas at ten moments; two passes through ffmpeg's looping demuxer; sips | identical decodes, loops for ever, delays as written, 1.3–1.7 levels from the canvas (dithering), a clean restart. The files are byte for byte R2's |
| PNG | ffprobe, sips, ffmpeg's decode against ImageIO's (via sips → TIFF) | 1920×1080 sRGB, identical decodes, byte for byte R2's |
| sound Off | `oldwriter.mjs`: the film's samples written again by the 0.132.0 writer and by today's | byte for byte equal |
| scene sound | `cuesab.mjs`: `soundCues` at `2758ba7` and today on the same graphic; the same graphic joined by cuts | 04 and 11: exactly R2's four whooshes gone (2.55, 5.55, 8.4, 8.55 s), nothing else changed, music accents unchanged; joined by cuts, all four are back. 10: one (5.55 s). 30 s: nine gone, one tick added in the freed room. Decoded: film 11's holds peak at −∞ to −103 dBFS |
| templates | R5's harness, 99 sheets, decoded pixels hashed against R5's `after/` | 95 identical, 4 within 1 level (rasterizer noise: one differs by as much between two runs here). Unchanged, so the README links to R5's sheets |

## Findings beyond the files

- **Hidden-page slowness** (`requests/S1.md`): F3's breaks are `setTimeout(0)`, and WebKit throttles them to about 1 s
  in a hidden page. In the hidden host, exports with sound took 2.5 to 5 times longer than with R2's code, and a bare
  bed up to a minute.
- **The music render is not bit-exact from run to run in WebKit.** Two renders of the same Both bed in one build differ
  by up to 1.8 × 10⁻⁷, and this build against R2's by up to 4.2 × 10⁻⁷ (about −127 dBFS, SNR over 139 dB). F3's
  "byte for byte" proof used the tests' stand-in composer in Node, where it holds. Inaudible, and every loudness and
  peak reading matched R2's to 0.05 dB. The effects-only beds are byte for byte R2's.

## Not verified

- **Listening.** Nothing was played through speakers or headphones.
- **The real app.** Everything ran in a hidden off-screen page. Whether the app's page goes hidden when its window is
  minimised or covered was not tested.
- **Other engines and players:** Windows (WebView2, Media Foundation's AAC), iOS, Android, VLC, QuickTime Player's
  window and social platforms' re-encoders were not tried. `avconvert` was not used: it re-encodes rather than decodes,
  and `AVAssetReader` (avdump) is AVFoundation's decoder.
- **The glitch transition** is in no sample.
