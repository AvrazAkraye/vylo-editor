# 09 Export and sharing: destinations and GIF

Work package 09 of the Pro pass (`docs/PRO.md`), branch `pro-09-export`. The brief is
`docs/pro/briefs/09-export.md`. Nothing here is released.

## What a person sees

The Export tab asks one question, **Where is it going?**, as six cards: Story or Reel, Post,
YouTube, Web loop, Picture, Custom. The card for the graphic's own shape is already chosen
(a tall graphic is a story, a square or 4:5 one a post, a wide one YouTube), so the shortest
path is unchanged: open the tab, press **Download**. One line under the button says what will
be made: size, kind, about how large, and how long it takes when that is five seconds or more.

**More options** (closed, one line) holds everything the 0.132.0 tab had on its first screen:
size, MP4 quality, motion blur, transparency, **Save as…**, and for Custom the kind of file.
It also holds what is new: a GIF's size (480, 720 or 1080 on the long side) and frames a
second (10, 15, 20), and a picture's moment (its best one, or the playhead's). Choices there are
remembered for next time under the same `localStorage` key as before (`vylo.motion.export.v1`,
the one SAFETY.md names), written as a superset of the version-1 record so either version reads
the other's.

First-screen decisions, counted the same way for both (groups of choices, checkboxes, Save as…,
disclosures): 0.132.0 had **5** (kind, size, quality, motion blur, Save as…); this has **2**
(where it is going, and More options). No capability was removed; GIF, destinations, the picture's
best moment and fitting into another shape were added.

Measured screenshots in the app's engine (WKWebView, macOS 26.2), English, Arabic and Sorani,
light and dark, at 300 to 360 px wide, are not committed; how the tab looks inside the real app
window with the real sidebar was **not** checked (see Open problems).

## Files

| file | what it is | touches the DOM |
|---|---|---|
| `app/src/motiongif.ts` | the GIF89a writer: colour counting and median cut, mapping and dithering, LZW, delays, frame differencing, disposal | no |
| `app/src/motiongifops.ts` | `renderGif`: paints frames, samples the palette, keeps a GIF under 25 MB | canvas |
| `app/src/motionshare.ts` | destinations as data, `settingsFor`, estimates, reshaping, remembered choices | no (it is handed a canvas factory) |
| `app/src/MotionExport.tsx` | the redesigned tab | React |
| `app/test/pro-export.test.mjs` | 192 checks, about 3 s | |

## The API

```ts
// motiongif.ts
type Dither = 'none' | 'ordered' | 'diffusion';
class ColourCounter { add(rgba, transparent?): void; palette(max = 255): GifPalette; readonly pixels: number }
class GifWriter {
  constructor(o: { width; height; palette; dither?; transparent?; loop?: number | null; tolerance? });
  add(rgba, seconds): void;   // one frame, RGBA, shown for `seconds`
  finish(): Uint8Array;
  readonly size: number; frames: number;
}
encodeGif(frames: { rgba; seconds }[], o): Uint8Array   // all in memory, for small jobs and tests
lzwEncode(indices, min): Uint8Array; delaysFor(seconds[]): number[]
MAX_COLORS = 255; ALPHA_CUT = 128; MIN_DELAY = 2; STICK = 4; DITHERS

// motiongifops.ts
renderGif(doc, { side?, fps?, colors?, dither?, transparent?, maxBytes?, onProgress?(done, total, attempt), signal? }, deps?)
  → { bytes, width, height, fps, colors, seconds, frames, trimmed, transparent, reduced: GifCut[], over }
GIF (defaults and ceilings), GIF_SIDES, GIF_RATES, gifSizeFor, gifPlan, gifFrames, smaller, cutsBetween,
estimateGifBytes, movesEverywhere, seeThrough

// motionshare.ts
DESTINATIONS, SHARE_KINDS, settingsFor(dest, doc, choices?) → ShareSettings,
bestDestination(doc, canMp4?), kindOf, shapeFor, reshapeOf, outputOf(doc, s), fitBox, fittedPaint, surroundOf,
destinationName, destinationLine, ratioOf, destinationStep (radio-group arrows, RTL-aware),
readPrefs, FIRST_PREFS, fileNameOf(doc, kind, tag)

// MotionExport.tsx (same mount as before, one new optional prop)
<MotionExport t doc onError soundNote? />   dropExports(id)
```

## Decisions

**One global palette, sampled across the animation.** Chosen over a palette per frame because
a still area stays the same colour and the same dither pattern in every frame (no shimmer), an
unchanged pixel has the same index in consecutive frames (which is what frame differencing needs),
and a motion graphic's colours are few and shared. The cost is a first pass: up to 24 frames,
evenly spread, are painted and counted before the GIF is written.

**Palette.** Every sampled pixel goes into a 6-bit-a-channel histogram that keeps each bin's exact
sum. Up to 255 distinct colours are the palette exactly (a flat graphic is lossless). Past that,
median cut: the box with the largest squared error is split at the weighted median of its widest
channel. A box that is mostly one exact colour (one bin with at least half the box, one colour
with at least half that bin, found by a Boyer–Moore majority vote while counting) takes that
colour, so flat areas, text and edges are exact and are never dithered. Index 255 (or the one
after the last colour) is always transparency: see-through pixels in a transparent GIF, "unchanged"
pixels in every frame after the first.

**Dithering.** Ordered (8 × 8 Bayer, anchored to the frame) by default, at half the palette's median
neighbour spacing: the same colour at the same place dithers identically in every frame. Floyd–
Steinberg and none are options of the writer, not of the tab.

**Writing only what changed.** Each frame after the first is the bounding rectangle of what differs
from the screen, with unchanged pixels as the transparent index. Identical frames are joined into
one longer delay. Pixels that go from visible to see-through are cleared by disposing the frame
before with "restore to background" over a rectangle grown to cover them (the frame is held back
until the next arrives, because its disposal depends on it); a transparent GIF's last frame is
disposed the same way so a loop restart starts clean.

**Holding a drift.** A pixel whose colour is not in the palette keeps what it shows until its true
colour has drifted more than 4 levels a channel from what it was when last drawn (`STICK`). Measured
in WKWebView: a 6-second aurora title at 720 px went from 8.9 MB to 5.6 MB, indistinguishable at 2×;
a looping background 20.6 to 10.9 MB; a 1080-px intro 10.7 to 4.6 MB.

**Time.** Each delay is the frame's end rounded, less what was already written, so the total is the
length rounded once. Frame `i` is painted at `i / fps`; the last frame runs to the end, and a last
sliver under 2 hundredths is joined to the frame before (browsers stretch delays under 2). Tested for
2,288 pairs of rate (5 to 50 a second) and length (0.5 to 15 s): always within half a hundredth.

**Limits.** 15 frames a second unless asked (at most 20), 720 px on the long side unless asked (at
most 1080), at most 15 s (a longer graphic is its first 15 s, said before and after), under 25 MB. The
brief says "width cap"; it is applied to the **long side**, so a 9:16 story GIF is not twice the file
of a 16:9 one. Over 25 MB, the GIF is made again, giving up colours (256, 128, 64), then size (a fifth
at a time, to 240 px), then frames a second (12, 10, 8, 6); `smaller` predicts how many rungs the
measured size needs, and an attempt that passes the ceiling while being written stops there. What was
given up is said in words under the saved file ("Made smaller to stay under 25 MB: 64 colours"); a GIF
still over at the bottom is saved and said to be over.

**Canvas.** Not `willReadFrequently`: in WKWebView the GPU canvas plus a read-back per frame was faster
(the aurora title 1.1 s against 1.7 s, the 1080-px intro 1.5 s against 3.4 s).

**Destinations.** Story: 9:16 MP4. Post: 4:5 MP4, or 1:1 when the graphic is square. YouTube: 16:9 MP4.
All three 1080p, "balanced", the graphic's own frame rate. Web loop: GIF in the graphic's own shape.
Picture: PNG at `stillTime` (after the entrances, before the exits), the graphic's own shape. Custom:
the old controls, the graphic's own shape, MP4, GIF or PNG.

**Another shape.** A template graphic is built again from its template for the file's shape
(`setFormat`, as Design does), with its sound carried over (building again drops it). A graphic edited
by hand, or one with scenes, is **fitted whole inside** the frame on its own background colour
(`fittedPaint`, handed to the renderer as its `paint`): it paints the graphic in its own shape into a
canvas the box's size and draws it centred. Laying the layers out again from their pins was built
first and dropped: in WKWebView a hand-edited wide title laid out at 9:16 ran off both sides of the
frame. The tab draws the file small beside a sentence saying the graphic itself is unchanged.

**Estimates.** An MP4's size is the encoder's ceiling ("up to"). A GIF's is 0.3 bytes a pixel for the
first frame and 0.2 (moving backdrop or particles) or 0.02 a pixel for each later frame, from five
templates measured in WKWebView; the 6-second aurora title was estimated at 5.3 MB and came out at 5.6.
A guess over 25 MB says it may be made smaller. Times are megapixels times measured rates (a GIF about
25 ms a megapixel a frame, a film 3 to 4); the 8-second background at 1080 px, 20 a second, was
estimated at 9 s and took 10.5.

## Tests

`test/pro-export.test.mjs`, 192 checks in about 3 s, in the chain before `orphans.test`:

- A GIF decoder written in the test from the GIF89a specification (LZW decoder, block reader, frame
  composition with disposal). LZW: 76 streams at every code size from 2 to 8, including every length
  from 1 to 40 (the code-size step before the end code), a 200,000-byte random stream that clears the
  table repeatedly, and the trailing bits.
- Header, logical screen, palette sizes, background index, loop block (0, 3, none), trailer, delays,
  rectangles, disposals, transparency (including visible-to-clear, under and over half alpha, an
  all-clear frame), determinism, one colour, 256 colours, 4,096 random colours with each dither,
  1 × 1, 1 × 7, 7 × 1 and 1080 × 1080 frames, the drift rule, refusals.
- When ffmpeg is installed: ffprobe's frame count and duration, and ffmpeg's decoded frames equal to
  the test decoder's, pixel for pixel, opaque and transparent.
- `renderGif` with fakes that paint real pixels: preload first, sample frames then every frame at
  `i / fps`, sizes, context options, transparency kept or drawn from a copy, the 15-second cut,
  progress, Cancel, no canvas, and the ladder on noise that cannot fit (colours first, then down to
  the bottom and marked over).
- `settingsFor` for every destination and every shape; the graphic unchanged by any of it; estimates;
  transparency; the picture's moment; rebuild versus fit with a real template; `fitBox` for every pair
  of shapes and sizes; `fittedPaint`'s calls; 314 stored values fuzzed through `readPrefs`; radio-group
  arrows in both directions; names.
- The tab built with esbuild and rendered with React's server renderer in every shape and in Arabic:
  six cards, one chosen, one button, More options closed, 2 decisions against 5, the sound slot, the
  transparency notice, no English left in Arabic.

Whole chain: `npm test` 35 s, 156 suites, all passing; `npx tsc --noEmit` and `npm run build` pass.

## Open problems

1. **A GIF cannot be saved yet.** Rust's `export_write_video` (`src-tauri/src/video.rs`, Video's file,
   off limits here) accepts only `.mp4 .webm .png .srt .json`, so Download GIF and Save as… GIF end in
   its refusal, shown as a sentence. SAFETY.md (all four languages) lists those extensions. Both need
   changing together: `docs/pro/requests/09.md`.
   **Done in wave 2 (W2-2):** `.gif` is accepted (beginning `GIF89a` or `GIF87a`, at most 64 MiB) and opened, and
   SAFETY.md says so in all four languages (`docs/pro/w2-export.md`).
2. Not seen in the real app: the tab was rendered alone in WKWebView with the app's stylesheet and a
   stand-in Tauri bridge (an end-to-end GIF and a fitted 9:16 MP4 were rendered, "written" and decoded),
   but never inside the running app, its sidebar or its full window.
3. An export in a window that is hidden: in the off-screen test window, WebKit stopped an export that was
   not tied to a pending script call. Whether a real, minimised app window does the same for a GIF (or
   already did for an MP4) was not measured; the progress card already says it renders fastest in front.
4. `fileNameFor` in `motionexportops.ts` types its extension as MP4 or PNG, so a GIF's name is a PNG's
   with the extension swapped (same length, same rules). `seeThrough` is duplicated from that file.
5. `motionedit.ts`'s rebuild for a new shape drops `sound` (and does not know `scenes`): the Design tab's
   shape buttons lose a template graphic's sound. Export works around it; the bug is upstream.
6. Sorani and Badini strings are best effort (`docs/pro/review-needed.md`). Generic new keys that another
   package might also add: `Custom`, `Post`, `More options`.

## What the integrator must do

- Nothing to mount: `MotionPanel.tsx` already renders `<MotionExport t doc onError />`.
- Pass `soundNote` (a `ReactNode`) once sound exists; it is shown under the summary line for MP4 only.
- When package 03 adds sound to `renderMp4`, add it to the one `renderMp4` call in `start()`.
- Make Rust accept `.gif` and update SAFETY.md, MOTION.md ("Not in this version") and the
  `motionexportops.ts` header (`docs/pro/requests/09.md`).
