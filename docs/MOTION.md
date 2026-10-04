# Motion

Motion is the studio for animated graphics: a title that types itself in, a
lower third, a logo sting, a counter that rolls up to a number, a bar chart that
grows, a looping background. You describe one in a sentence or start from a
template, edit it on a timeline, give it sound and scenes if you want them, and
save it as an MP4, a GIF or a PNG.

**It uses no animation, drawing, audio or encoding library.** Everything below is
this repository's own code: the easing and spring maths, the keyframe evaluator,
the canvas renderer, the sound effects and the loudness meter, the H.264 and AAC
muxer that writes the `.mp4`, the GIF writer. The only things it calls are the
browser's own canvas, WebCodecs (`VideoEncoder`, and `AudioEncoder` and
`AudioDecoder` for a film's sound), Web Audio (to play the music's score offline
and the sound in the preview), `Intl`, and the same Tauri commands every other
module uses to save a file. That is a deliberate contrast with Video, which
draws with Remotion (and sends one licence-telemetry event to remotion.pro per
export, which SAFETY.md discloses). **Motion makes no network request of its
own**: the only traffic it can cause is the model request the person starts by
asking for a graphic in words, which goes through `generate.ts` where every
other request in the app goes. When the person asks for facts the model does not
have, one more request through the same route may carry Anthropic's web-search tool (`motionresearch.ts`;
SAFETY.md says so), and the pages it read are listed with the graphic. Nothing else needs the network, and nothing else
asks for it: a picture is data inside the graphic, the fonts are the system's
and the app's own, the sound is synthesised on the machine (the effects in plain
JavaScript, the music by `videosynth.ts`, which plays its score in an
`OfflineAudioContext`), the gallery's search runs over the templates in memory,
the brand kit's logo is kept as data, and the check is arithmetic on the
document. No Motion source file calls `fetch`, `XMLHttpRequest`, a socket or a
beacon, and `test/pro-export.test.mjs` reads every one of them to keep it so,
and `test/pro-review-safety.test.mjs` reads everything they import, and runs the
studio with the network trapped.

## The one rule

A frame is a pure function of the document and a time: `paint(ctx, doc, t)`.
Nothing is remembered between frames, nothing depends on the wall clock, and
anything that looks random is seeded. So the preview, a thumbnail, a PNG, every
frame of the MP4 and every frame of the GIF are the same picture, scrubbing is
exact, and a test can render any moment. The sound follows the same rule: it is
made from the document (its timings, its seed) and nothing else, so the same
graphic makes the same sound.

**The same at any size.** Text and chart labels are laid out — measured, wrapped,
cut with an ellipsis — at the size they have in a frame whose short side is 1080
px (`LAYOUT_K` in `motiondraw.ts`) and drawn through a context scale, so a 320 px
card, the stage and the 4K export break a line at the same word and place every
box at the same point in u. Only the pixels differ, never the layout.

## The model writes JSON, never code

Asking for a graphic sends the request to a model, which answers with a
document in the vocabulary below (a recipe and its fields, or layers). `motionread.ts`
reads it: every number is clamped, every word must be on a list, every colour is
checked, every list has a ceiling. A model draws no pictures: an image layer in
its answer is left out, and it cannot set a picture's source (the reader itself
accepts only the base64 PNG or JPEG the picture importer writes). Nothing the
model wrote is run, and nothing it wrote reaches a file except through Export,
a button the person presses: **Save as…** writes where the save panel says,
**Download** writes into the Downloads folder under a name that never replaces a
file (the name comes from the graphic's title, which `fileNameFor` sanitises).
This is the same promise as Video's storyboard.

When the person later asks for a change, the request carries the graphic's
current words, colours and layer settings — never a picture. Both prompts also
carry the direction rules (`motiondirection.ts`): how long an entrance takes,
when the first thing moves, how far words stay from the edges, how large a
headline is. They are words in a prompt; the reader still decides what is kept.

**Limits.** `LIMITS` in `motiontypes.ts` is the one list of ceilings, and the
reader is where they are enforced — for a model's answer, a stored record and a
hand edit alike, because an edit is read again too: 60 layers; 500 characters
in a text layer; type (a chart's labels too) up to 200u, two frame-heights, and a
shape, picture or icon up to 600u; scale up to 4; an offset up to 400u from its pin; 300 particles a layer
and 1,200 a document (earlier layers keep theirs, later ones are cut to what is
left), none wider than 50u; 30 seconds; 12 scenes, none shorter than 0.5
seconds, and a transition between them of 0.15 to 1.5 seconds. A dashed outline
is cut into at most 4,000 dashes (`MAX_DASHES`): a finer pattern is widened, dash
and gap in proportion. Words' outlines are at most half their type size and
their shadows' blur twice it (2u and 4u at the least, 20u and 100u at the most;
`textOutlineMax`, `textShadowMax`). So the cost of a frame has a ceiling whoever
wrote the document.

**No figure the model made up.** A number the graphic draws as a figure — a big
number, the values of a chart or a counter, three stats, and any digits in the
prefix, suffix or unit beside them — must be one the person gave: in their
request, in the message asking for the change, or already in the graphic
(`sourcedFields`, `sourcedLayer` and `numbersIn` in `motionchatops.ts`; a new
graphic is held to it too). A number from nowhere is not written. The field
keeps what it had, or shows the template's example with a notice asking for the
real number. The check reads a figure the way the template reads it, so no way
of writing a line gets past it. Words are not read for numbers: a headline that
states a statistic is kept out only by the prompt, and where a countdown starts
is a choice about the graphic, not a claim.

## The document (`motiontypes.ts`)

```
Motion
  format    landscape 1920x1080 | portrait 1080x1920 | square 1080x1080 | feed 1080x1350
  fps       24 | 30 | 60
  seconds   1..30
  lang      en | ar | ckb | kmr        drives direction, digits and which fonts
  palette   bg fg accent accent2 muted
  backdrop  Paint | null               null is transparent
  layers    back to front
  recipe    { id, fields }             when it came from a template
  sound     { mode, level, mood?, seed? }          off | fx | music | both; absent is silence
  scenes    [{ id, name, start, end, transition? }] absent, or one, is one scene
```

Both new fields are optional, and a graphic without them is read, drawn and
exported exactly as before they existed.

**Units.** Sizes and offsets are in `u`: 1u is 1% of the frame's **short side**
(10.8 px in a 1080 frame). A 9u headline is the same fraction of the frame in
every shape, a circle stays a circle when the shape changes, and nothing is in
pixels except the canvas itself. `k = min(width, height) / 100` is pixels per u.

**Position.** A layer is pinned to one of nine points of the frame (`pin`: row
`t|m|b` and column `s|c|e`, so `bs` is bottom-start), then offset from it by
`x, y` in u. The pin is also the point of the **layer's own box** that is placed
there, as in CSS absolute positioning: a bar pinned `bs` at `x: 8, y: -10` has
its bottom-start corner 8u in and 10u up, so nothing needs half a width added to
sit against an edge. Scale and rotation turn about the box's centre. The columns are **logical**: `s` is the left in English and the
right in Arabic and Kurdish, and a positive `x` moves toward the end. A lower
third written once at `bs` is on the correct side in every language, with no
special case anywhere. Text `align` is `start | center | end` for the same
reason. Rotation, `y`, and shape geometry stay physical.

**Time.** In seconds. A layer is drawn from `start` to `end`. `in` is an entrance,
`out` an exit, `loop` a continuous motion while it is on screen.

**Animation.** An `Anim` is a word from a closed list plus numbers:

```
{ fx: 'rise', d: 0.7, delay: 0.1, ease: 'expo-out', amount: 1, dir: 'up', by: 'word', gap: 0.05 }
```

`fx` is one of `EFFECTS`. **An exit is the entrance played backwards**, so one
list serves both: `rise` in, `rise` out, and the graphic falls back the way it
came. `by` and `gap` split a text layer into lines, words or characters that each
run the effect, `gap` seconds apart (kinetic type). Arabic-script text is never
split into characters, because a letter drawn alone loses its joins; `by: 'char'`
falls back to `word` there.

**Colour.** A colour is a palette token (`bg fg accent accent2 muted`) or a hex
value; a `Paint` is a colour or a gradient. Tokens are why a graphic can be
re-coloured by choosing another palette, and why the model can write
`"color": "accent"` and get contrast for free.

## The engine, file by file

| file | what it is | touches the DOM |
|---|---|---|
| `motiontypes.ts` | the document, the closed vocabulary, the limits | no |
| `motionmath.ts` | easing, springs, colour, noise, SVG path geometry and the shape outlines | no |
| `motionanim.ts` | `poseAt`: a layer's animated state at time `t`; `stillTime` | no |
| `motionfonts.ts` | voices to font stacks, script detection, digits | no (loads via `document.fonts` when asked) |
| `motiondraw.ts` | `paint`: the frame; text, shapes, icons, images, counters; `layerBox`, `hitTest` | canvas |
| `motionbackdrop.ts` | moving backdrops and particles, and the five finishes laid over a picture (grain, vignette, light leak, scan lines, halftone) | canvas |
| `motioncharts.ts` | bars, lines, donuts, rings, and a bar-chart race | canvas |
| `motionscene.ts` | scenes: the reader, painting a graphic scene by scene, and the scene edits | canvas |
| `motiontransition.ts` | the thirteen ways a scene can arrive | canvas |
| `motionrecipe.ts` | the templates' metadata (with when to use each), the palettes, and the kit a recipe builds with | no |
| `motionrecipes-titles.ts`, `-overlays.ts`, `-data.ts` | the original eighteen recipes | no |
| `motionids.ts`, `motionrecipes-pro-a.ts`, `motionrecipes-pro-b.ts` (each with its `-meta.ts`) | fifteen more: lower thirds, notifications, a chat, a device frame, a hand-drawn circle, a film look, a bar-chart race, a timeline, a comparison, a price card, progress rings, a retro screen | no |
| `motiontemplates.ts` | the registry; `buildMotion` | no |
| `motionsearch.ts` | the gallery's search, in all four languages | no |
| `motionbrand.ts` | the brand kit: what it fills in a new graphic, and Apply brand | no |
| `motioncheck.ts` | the quality check: its rules, its tips and their fixes | no (an optional canvas to measure words) |
| `motionread.ts` | reading and repairing any document, from anywhere | no |
| `motionedit.ts` | every edit a person can make, as a pure function | no |
| `motionai.ts`, `motionchatops.ts` | the prompts, reading the model's answer, and applying its edits | no |
| `motiondirection.ts` | the motion rules the model is given: timing, easing, safe areas, sizes | no |
| `motionsound.ts` | the `sound` field: cues from the animation, the music's mood, the mix and its loudness | no (the music through `videosynth.ts`) |
| `motionsfx.ts` | nine effects, synthesised in plain JavaScript | no |
| `motionsoundplay.ts` | the preview's sound, following the playhead | Web Audio |
| `audiocore.ts`, `audiofx.ts`, `audioauto.ts`, `audioduck.ts`, `loudness.ts` | the audio library: filters and resampling, six effects, automation, ducking, BS.1770 loudness and true peak | no (`audiofx.ts` builds Web Audio nodes when asked) |
| `motionaudioenc.ts` | a graphic's sound as AAC, with WebCodecs | WebCodecs |
| `motionmp4.ts` | the MP4 container writer, the picture and the sound | no |
| `motionencode.ts` | frames to H.264 with WebCodecs, then the muxer; a frame that cannot have changed is encoded again without being painted | canvas, WebCodecs |
| `motionexportops.ts` | names, rendering (`changingFrames`), saving | Tauri |
| `motiongif.ts` | the GIF writer: palette, dithering, LZW, only what changed | no |
| `motiongifops.ts` | a GIF of the graphic, kept under 25 MB | canvas |
| `motionshare.ts` | the destinations, their settings and estimates, and fitting a graphic into another shape | no |
| `motionstore.ts` | IndexedDB `vylo-motion`, and `vylo-motion-brand` for the brand kit | IndexedDB |
| `motionhistory.ts` | undo and redo | no |
| `motionplay.ts` | the playback clock | no |
| `motionui.ts`, `motionstate.ts`, `motiontrack.ts`, `motionpicture.ts` | the components' contracts and their pure helpers (`shownName` puts a template's layer names in the interface's language) | no |
| `MotionPanel.tsx` | the studio: the store, the runs, the sidebar and the full window; a small `localStorage` journal (`vylo.motion.unsaved.v1`) keeps an edit not yet written when the window closes | React |
| `MotionStage.tsx`, `MotionTimeline.tsx`, `MotionDesign.tsx`, `MotionLayers.tsx` (+ `MotionControls.tsx`, `MotionKinds.tsx`), `MotionExport.tsx`, `MotionChat.tsx`, `MotionHome.tsx`, `MotionThumb.tsx` | the screens | React |
| `MotionChecks.tsx`, `MotionSoundPanel.tsx`, `MotionScenes.tsx`, `MotionBrandKit.tsx` | the check's chip, the Sound row, the scene strip, the brand kit's sheet | React |

`test/` holds a suite for every file that does not touch the DOM, and a
recording canvas (`test/motioncanvas.mjs`) that lets `motiondraw` and the
templates be run in Node: every call's numbers must be finite, every `save` must
be matched by a `restore`, and no template may draw nothing.

Two things to know before adding a source file. On macOS, and by default on
Windows, the file system ignores case, so `MotionExport.tsx` and `motionexport.ts`
are the same name to an import: that is why the export logic is `motionexportops.ts`
and the timeline's helpers `motiontrack.ts`. And WebKit, the engine the app runs
in on macOS, has no `ctx.filter`: soft focus is drawn with a shadow trick in
`motiondraw.ts`, and nothing may call `filter`.

## Simple on top

Everything below is off, or silent, until it is asked for: a graphic made from a
template and exported with one press is the same graphic, and the same file, it
was before any of it existed.

**Scenes and transitions** (`motionscene.ts`, `motiontransition.ts`). A graphic is
one scene until somebody adds a second; the timeline then shows a thin strip of
scenes with a small chip between two saying how the second arrives: a cut, or one
of twelve transitions (fade, push, slide, iris, clock, blinds, pixelate, zoom,
whip, flash, light leak, glitch), each a Canvas2D composite of the two scenes'
frames. A scene the next one arrives over holds still until the cut: the
transition is its exit.

**Sound** (`motionsound.ts`, `motionsfx.ts`). One row in Design: Off, Effects,
Music or Both. Effects are made from the animation itself — a whoosh for a slide,
a pop for a pop, ticks while a counter rolls, an impact when a big title lands —
thinned to a level, panned to where the layer is, mirrored in a right-to-left
language. Nothing is heard while a scene holds still for the transition after it:
the exits the transition takes over are silent too, from the same lookups the
picture's hold is made from (`sceneList`, `sceneHold`). Music is composed for the graphic in a mood (the template's, unless
another is chosen), its accents on the scene changes and the big landings, and
ducked under the loudest effects. The mix is brought to a loudness (-16 LUFS at
the default level) under a true-peak ceiling. The preview plays it with the
playhead; the MP4 carries it as an AAC track whose start is measured and written
into the file's edit list, so sound and picture begin together. A GIF and a PNG
have no sound, and Export says so.

**The brand kit** (`motionbrand.ts`, `MotionBrandKit.tsx`). A name, a handle, a
logo, colours and a typeface, kept on the machine. A new graphic starts in them;
Apply brand re-skins one that exists.

**The check** (`motioncheck.ts`, `MotionChecks.tsx`). A chip by the stage says
"Looks good" or how many tips there are: a layer off the frame or outside the
safe area, words cut short, covered or overlapping, too little contrast, words
too small or on screen too briefly to read, flashing, a slow start, an empty or
frozen stretch, too much at once. Each tip has a Fix, and there is Fix all. It never blocks
anything, and it is arithmetic on the document, debounced, not a rendered frame.

**Export: where is it going?** (`motionshare.ts`, `MotionExport.tsx`). Six cards:
Story or Reel (9:16), Post (4:5, or 1:1 for a square graphic), YouTube (16:9),
Web loop (a GIF), Picture (a PNG of the moment the graphic reads best) and
Custom. The card for the graphic's own shape is chosen already, so the shortest
path is still one press. A destination of another shape makes the file from a
copy: a template built again for that shape, or a graphic edited by hand fitted
whole inside it on its own background; the graphic itself is not changed. Size,
quality, motion blur, transparency and Save as… are under More options.

**GIF** (`motiongif.ts`, `motiongifops.ts`). One palette for the whole loop,
sampled across it, so a still area keeps its colours and does not shimmer; flat
colour and text are exact, the rest dithered in a pattern anchored to the frame;
each frame stores only the rectangle that changed. At most 15 seconds and 20
frames a second, 720 px on the long side unless asked; a GIF that would pass
25 MB is made again with fewer colours, then smaller, then fewer frames, and the
saved file says what was given up. It is saved through the same command as the
MP4 and the PNG.

## Adding a recipe

1. Add its id to `RECIPE_IDS` in `motiontypes.ts`.
2. Write it in one of the `motionrecipes-*.ts` files, with its metadata in
   `motionrecipe.ts`: a function from a `Kit` (fields, language, shape, palette,
   length) to layers. Use `pin` and `u`, never pixels, so it works in
   all four shapes and both directions.
3. Give every field a sample in all four languages: the gallery draws it with them.
4. `npm test` renders it in every shape and language at many times and fails on
   a non-finite number, an unbalanced `save`, an empty frame, or a layer that
   ends before it starts.

## Not in this version

Transparent video (an MP4 has no alpha, so PNG stills keep it, a GIF keeps it a
pixel at a time, and the panel says so); nested groups; per-property keyframes
edited by hand (the engine has none: an effect is the keyframe set, tuned once).
Each is a deliberate cut, not an oversight.
