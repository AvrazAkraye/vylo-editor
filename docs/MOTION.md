# Motion

Motion is the studio for animated graphics: a title that types itself in, a
lower third, a logo sting, a counter that rolls up to a number, a bar chart that
grows, a looping background. You describe one in a sentence or start from a
template, edit it on a timeline, and save it as an MP4 or a PNG.

**It uses no animation, drawing, or encoding library.** Everything below is this
repository's own code: the easing and spring maths, the keyframe evaluator, the
canvas renderer, the H.264 sample muxer that writes the `.mp4`. The only things
it calls are the browser's own canvas, `VideoEncoder` and `Intl`, and the same
Tauri commands every other module uses to save a file. That is a deliberate
contrast with Video, which draws with Remotion (and sends one licence-telemetry
event to remotion.pro per export, which SAFETY.md discloses). **Motion makes no
network request of its own**: the only traffic it can cause is the model request
the person starts by asking for a graphic in words, which goes where every
other request in the app goes.

## The one rule

A frame is a pure function of the document and a time: `paint(ctx, doc, t)`.
Nothing is remembered between frames, nothing depends on the wall clock, and
anything that looks random is seeded. So the preview, a thumbnail, a PNG and
every frame of the MP4 are the same picture, scrubbing is exact, and a test can
render any moment.

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
current words, colours and layer settings — never a picture.

**Limits.** `LIMITS` in `motiontypes.ts` is the one list of ceilings, and the
reader is where they are enforced — for a model's answer, a stored record and a
hand edit alike, because an edit is read again too: 60 layers; 500 characters
in a text layer; type (a chart's labels too) up to 200u, two frame-heights, and a
shape, picture or icon up to 600u; scale up to 4; an offset up to 400u from its pin; 300 particles a layer
and 1,200 a document (earlier layers keep theirs, later ones are cut to what is
left), none wider than 50u; 30 seconds. So the cost of a frame has a ceiling
whoever wrote the document.

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
```

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
| `motionbackdrop.ts` | moving backdrops and particles | canvas |
| `motioncharts.ts` | bars, lines, donuts, rings | canvas |
| `motionrecipe.ts` | the templates' metadata, the palettes, and the kit a recipe builds with | no |
| `motionrecipes-titles.ts`, `-overlays.ts`, `-data.ts` | the eighteen recipes | no |
| `motiontemplates.ts` | the registry; `buildMotion` | no |
| `motionread.ts` | reading and repairing any document, from anywhere | no |
| `motionedit.ts` | every edit a person can make, as a pure function | no |
| `motionai.ts`, `motionchatops.ts` | the prompts, reading the model's answer, and applying its edits | no |
| `motionmp4.ts` | the MP4 container writer | no |
| `motionencode.ts` | frames to H.264 with WebCodecs, then the muxer | canvas, WebCodecs |
| `motionexportops.ts` | names, rendering, saving | Tauri |
| `motionstore.ts` | IndexedDB `vylo-motion` | IndexedDB |
| `motionhistory.ts` | undo and redo | no |
| `motionplay.ts` | the playback clock | no |
| `motionui.ts`, `motionstate.ts`, `motiontrack.ts`, `motionpicture.ts` | the components' contracts and their pure helpers (`shownName` puts a template's layer names in the interface's language) | no |
| `MotionPanel.tsx` | the studio: the store, the runs, the sidebar and the full window; a small `localStorage` journal (`vylo.motion.unsaved.v1`) keeps an edit not yet written when the window closes | React |
| `MotionStage.tsx`, `MotionTimeline.tsx`, `MotionDesign.tsx`, `MotionLayers.tsx` (+ `MotionControls.tsx`, `MotionKinds.tsx`), `MotionExport.tsx`, `MotionChat.tsx`, `MotionHome.tsx`, `MotionThumb.tsx` | the screens | React |

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

Sound; transparent video (an MP4 has no alpha, so PNG stills keep it and the
panel says so); GIF; nested groups; per-property keyframes edited by hand (the
engine has none: an effect is the keyframe set, tuned once). Each is a
deliberate cut, not an oversight.
