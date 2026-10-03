# 07 Templates A: lower thirds, notifications, a hand-drawn circle, chat, device

Branch `pro-07-templates-a`. Eight templates built from the layer kinds Motion already has (text, shapes, icons, a
backdrop): no engine change, no new dependency, nothing to mount. They appear in the gallery, in the model's catalogue
and in search the moment their ids are in `PRO_A_IDS`, because everything reads `META` and `RECIPES`.

## What exists

| id | Name (gallery) | Group | Overlay | Palette | Length | Fields |
|---|---|---|---|---|---|---|
| `lt-bar` | News bar | overlays | yes | ocean | 5 s | name, role |
| `lt-pill` | Soft pill | overlays | yes | daylight | 5 s | name, role |
| `lt-kicker` | Kicker and name | overlays | yes | sunset | 5 s | kicker (Small label), name, role |
| `lt-neon` | Neon name | overlays | yes | neon | 5 s | name, role |
| `ui-notify` | Notification stack | overlays | yes | midnight | 6 s | items: up to 3 lines, `Title: line` |
| `ui-scribble` | Hand-drawn circle | overlays | yes | sunset | 5 s | word (may be empty), label |
| `ui-chat` | Chat conversation | titles | no | midnight | 8 s | name, items: up to 6 lines, `Me: …` / `Them: …` |
| `ui-device` | Device frame | brand | no | royal | 6 s | title, subtitle, screen |

Every entry has `tags`, `useWhen`, `avoidWhen` and `pairsWith` (`motionrecipes-pro-a-meta.ts`).

### API

- `motionids.ts`: `PRO_A_IDS` (the eight ids above, in gallery order).
- `motionrecipes-pro-a-meta.ts`: `PRO_A_META`, data only.
- `motionrecipes-pro-a.ts`: `PRO_A_RECIPES` (build and samples in en, ar, ckb, kmr), and the two list readers, exported
  for their tests and for anyone who wants to show what a list will become:
  - `notesOf(raw: unknown): Note[]` with `Note { title, body }`;
  - `messagesOf(raw: unknown): ChatLine[]` with `ChatLine { me, text }`.

## The templates

**News bar (`lt-bar`).** An accent tab grows up at the bottom-start corner; a block of accent sweeps out of it across
the name's width and pulls away toward the end, revealing the name plate under it while the name masks up; a strip in the
opposite tone (the ink as a ground) wipes out under it with the role in small capitals. The sweep is two layers, one that
grows from the start and one that collapses toward the end, because one layer's exit can only retract the way it came.

**Soft pill (`lt-pill`).** A fully round plate springs in from three quarters of its size; a solid accent badge pops at
its start and a person icon draws itself on it; the name and the role rise in. Designed on the white `daylight` palette.

**Kicker and name (`lt-kicker`).** A plate wipes open; a small accent tag pops onto its top corner, straddling the edge,
with the kicker in capitals; a heavy name masks up; an accent underline draws itself under it, as long as the name; the
role rises in. With no kicker the tag is gone and the plate is shorter.

**Neon name (`lt-neon`).** An accent line traces the outline of a rounded plate; as it closes the dark plate fills in and
the glow flickers once (a single 0.06 s flicker, far under the three-a-second rate WCAG warns about) and comes on,
breathing faintly; the name resolves out of soft focus with an accent glow, the role in the second accent; a light runs
along the tube through the hold; it leaves by drawing the tube back out.

**Notification stack (`ui-notify`).** Up to three glass cards, 0.8 s apart. In landscape they slide in from the end side at
the top corner, as a desktop shows them; in the taller shapes they drop in at the top centre, as a phone does; each
overshoots a little and settles. A card has an icon in an accent squircle, the title in bold, the word for "now" in the
graphic's language at its end, and its line (two lines at most, cut with an ellipsis). The icon is chosen from words in
the title in all four languages (message, delivery, order, payment, meeting, reminder, like, follow, review, win, gift,
call, done), else a quiet default. Everything on a card moves with it. They leave first-in, first-out.

**Hand-drawn circle (`ui-scribble`).** A marker loop draws itself round the word (or round whatever is under it when the
word is empty): a slightly uneven ellipse, seeded from the words so the same words give the same loop, going round once
and an eighth so its end overshoots its start; a fainter second pass follows; an arrow swoops in from the note and its
head flicks on; the note types itself out, tilted 4°, and a wavy underline draws under it. The marks are paths, so right
to left draws each one's mirror image and tilts the other way. Its words carry an outline in the ground colour instead of
a plate (the one exception to "words on glass", see below).

**Chat conversation (`ui-chat`).** A header with the other person's initial in a round badge (the second accent) and their
name, a hairline under it; then the messages arrive at a reading pace (0.45 s plus 28 ms a character, 0.7 to 1.3 s).
Before each of theirs, a bubble of three bobbing dots says they are typing and the message replaces it in the same place.
Their bubbles are a tint of the ink on the start side; the person's are the accent on the end side; the sender's lower
corner is square (a generic tail, not any app's). Bubbles are as wide as their words, wrapped as a phone wraps them, and a
fifth line is cut with an ellipsis. The conversation is sized to fit the frame: smaller type first (down to 72%), then
fewer lines a bubble, and at worst one line a bubble at 60%. Too many messages for the length are pressed together so all
have arrived 0.8 s before the exit; the typing dots are dropped when that pressure is extreme.

**Device frame (`ui-device`).** A glow blooms and a device rises into it: a browser window in landscape (three neutral
window buttons, an address bar with a lock and a skeleton address), a phone in the other shapes (island, side buttons,
rim). Once landed, the screen lights up from the bottom in the accent gradient and the word on it pops in, a gleam
crossing the glass. The headline masks in line by line beside the device (above it in portrait) and the subtitle rises.
The screen is left clean for a picture the person places over it.

## Decisions

- **Words on glass.** As in `motionrecipes-overlays.ts`, an overlay's words stand on a plate of the palette's ground
  (`glassOf`), so they read over any footage. The circle's words instead carry a `bg` outline (the sticker trick), since a
  plate would contradict a hand-drawn mark.
- **Measured before drawn.** Plates, cards and bubbles are sized from the advance widths `motionrecipes-overlays.ts` took
  in the app's WebKit. Those helpers are private to that file, so 07 carries a copy (request 2 asks for one shared module).
  Lines are broken in the recipe and written into the text; every text layer also has `fit`.
- **Long words.** A line that does not fit is cut with an ellipsis (`clip`, `wrap`); a headline shrinks before it adds a
  line (`setBlock`, balanced lines), and only at its smallest size is a Latin word cut into pieces. Arabic script is never
  cut inside a word. A list line that the field's 80-character cap cut mid-word ends in an ellipsis rather than a broken
  word (`itemText`).
- **List syntax.** `Title: line` and `Me: …`/`Them: …`, as the brief asked. A label is at most 40 (notes) or 24
  (messages) characters, at most three words for a speaker, and never a time (`7:30`); the words for "me" are `me`, `i`,
  `أنا`/`انا`, `من`, `ئەز`. An unlabelled message answers the one before it. An emptied list shows the example rather
  than nothing (as `steps` does).
- **Layer names without numbers.** A numbered name ("Card 2") is only translated when its pattern is in `motionui.ts`,
  which is not 07's file, so cards are named by ordinal ("Second notification") and bubbles by side ("Their message").
  Every name is in the catalogue in Arabic, Sorani and Badini.
- **No shine on the plate lower thirds.** `stillTime` treats a late shine as the last arrival, so the gallery's still caught
  the band half-way across the plate (it showed as a smudge). The sweep, the drawn icon and the underline are those
  templates' flourish instead; the device's gleam is timed to end by the still; the neon's running light is its look and
  stays. Request 3 suggests the general fix.
- **Shadows and fades.** Cards and pills fade while they have a shadow. That was unsafe in WebKit once; `shadowOn` in
  `motiondraw.ts` now honours it, and the WebKit renders below show them fading correctly.
- **One time word.** "now" is drawn in the graphic's language (`now`, `الآن`, `ئێستا`, `نوکە`); its space is the widest of
  the four, so a card is laid out identically in every language and right to left mirrors it exactly.

## Tests

`app/test/pro-templates-a.test.mjs`: **159 checks**, about 1.5 s. Every template in every language and shape at its own
length and at 1, 2 and 30 s; fixed points of the reader; arrivals before exits; 40 clean frames each; the longest words,
long Arabic, one word, empty fields and words past the caps; safe margins (8u landscape, 6u otherwise) with samples and
with the longest words; exact right-to-left mirroring box for box; the gallery still shows settled words and no shine;
metadata, translations and samples; 3,000 random lists through both readers; hostile values through every template; and
what each template does (about 40 behavioural checks). The existing suites that walk `RECIPE_IDS` and `RECIPES`
(`motionfuzz-templates`, `motionnames`, `motionread`, `i18n`) cover them too and pass.

`npm test`: every step passes except one assertion in `test/motionai.test.mjs`: the model's plan prompt is 10,510
characters against a budget of 9,500. The eight lines 07 adds are 164, 165, 224, 158, 143, 193, 213 and 245 characters
(1,505 in all). This needs the integrator (request 1). `npx tsc --noEmit` and `npm run build` pass.

## Hand check (rendered in the app's own engine)

Rendered with a throwaway WKWebView host (Swift, in the git-ignored `app/.test-build/pa-harness/`), the system WebKit the
app runs in, through the real `paint`, with the bundled Arabic face. Overlays were drawn over a stand-in for footage (a
bright sky over a dark street) to judge legibility. Contact sheets of every template in four shapes and four languages,
time-lapses of each entrance and exit, the longest inputs, and five other palettes. What I saw:

- News bar: the sweep fills, pulls away and the name rises under it; light strip with dark capitals under a dark plate.
- Soft pill: a clean white pill on dark footage; the solid blue badge and the drawn icon read well (the first version used
  the two-accent gradient, which was amber into blue on this palette, and looked muddy: changed).
- Kicker: tag on the corner, heavy name, orange underline the length of the name. Neon: cyan tube with a soft glow, white
  name with a cyan halo, pink role; looks right on bright and dark ground.
- Notifications: cards slide in with a small overshoot, icons a speech bubble, a truck and a clock in all four languages.
  The first render gave a trophy for "Wonderful" (the keyword `won`); keywords now match whole words.
- Circle: the loop really reads as hand-drawn, with the overshoot and the second pass; the note types out and the
  underline follows. The first render cut "Extraordinary" into "Extraordinar / y" inside the circle; it now shrinks first.
- Chat: typing dots, then bubbles in turn; the first size was too small in landscape (raised from 3.3u to 4.1u).
- Device: the browser and phone look like generic devices; the screen lights from the bottom and the word pops.
  Landscape headline raised from 7.4u to 8.2u after looking.
- Right to left (Arabic, Sorani, Badini): every template mirrors; bubbles change sides; the phone moves to the end side.
- Re-coloured with paper, neon, daylight, sunset and mint: legible in all; light palettes give clean light designs.

Not checked by eye: an exported MP4 (the frames are the same `paint`, so only encoding could differ), and the gallery
cards inside the running app (not launched, to keep off the owner's data).

## Open problems

1. The plan prompt budget (request 1): `npm test` fails on that one assertion until the integrator raises it.
2. The measuring helpers are copied (request 2).
3. Sorani and Badini strings and samples need a native speaker (`docs/pro/review-needed.md`, section 07), as do the
   Kurdish keywords that pick a notification's icon.
4. Six long chat messages in landscape end up at 72% type and one line each; legible, but a conversation that long is
   better split in two graphics. The `avoidWhen` says so.
5. `ui-device` has a few ids that exist only in one shape (request 4); the shared ones survive a change of shape.
6. The core lower third and social handle still show a shine in their gallery still (request 3).
