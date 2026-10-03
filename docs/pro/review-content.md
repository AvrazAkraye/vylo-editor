# Review R5: template and content quality

Wave-3 reviewer R5 of the Pro pass, branch `pro-r-content` (from the integrated `pro`, `a3faefa`). The question was not
"does the check pass" (it did: 0 tips, 0 warnings over 528 graphics) but "would a demanding art director ship these".
All 33 templates were rendered in the app's own engine and looked at. Fifteen of them were changed. Every template keeps
its ids and its fields, so a rebuild keeps the person's selection.

Contact sheets for the owner: `/Volumes/ExtremeSSD/apps/vylo-pro-samples/templates/` (README there).

## How it was looked at

The off-screen WKWebView harness (the system WebKit the app runs in, with the bundled Arabic face; never the owner's app
or data), copied into the git-ignored `app/.test-build/rc/`. Three sheets per template, 99 in all, before and after:

- **matrix**: the gallery cover moment (`stillTime`) in four shapes × four languages. Overlays are drawn over a
  stand-in for footage (sky, street, a figure).
- **motion**: landscape and portrait, English and Arabic, five frames through the entrance, the still, and four
  through the exit.
- **stress**: long realistic input (a real person's long name, role, title, eight bars, twelve months, a six-message
  chat, ten racers over ten years, written for each template in English and Arabic) and every field empty.

Then full-size frames of every lower third and of each suspected defect, dense time-lapses (the countdown from 10,
the pill's exit, the race's period roll), and a timing table of every template against the direction numbers.

**What this is not.** I judged still pictures and sequences of frames, not motion at 30 fps; the feel of a curve is
inferred from frame spacing and the numbers. Kurdish (Sorani, Badini) is beyond a careful check: I could see layout and
shaping, not whether the words are natural. Arabic was read for correctness by me and by a second reviewer.

## Scores

Five criteria, each 1–5: **H** hierarchy, **S** spacing and layout, **C** colour, **M** motion timing (entrance,
exit, and the direction numbers), **F** fit to purpose, with the overall verdict. "Before" is the integrated `pro`
branch; "after" is this branch. Templates not changed have one score.

| # | Template | H | S | C | M | F | Before | After | Defects found (fixed unless marked *left*) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Big title | 5 | 4 | 4 | 4 | 5 | 4 | **4.5** | All fields empty left a lone accent rule mid-frame |
| 2 | Kinetic type | 5 | 3→4 | 5 | 5 | 5 | 4 | **4.5** | Tall shapes: the comma of "SMALL," touched the "BIG" highlight box |
| 3 | Split reveal | 4 | 3→4 | 2→4 | 4 | 4 | **3** | **4** | Lower panel was the accent at 55% over the ground: a muddy brick brown under orange, the one dull colour in the gallery. Portrait: a thin band of small words between two huge flat blocks |
| 4 | Quote card | 4 | 4 | 4 | 4 | 5 | 4 | 4 | *Left*: author and role small (3.4u / 2.8u muted); a Latin “ mark heads the Arabic quote (decorative, mirrored layout otherwise right) |
| 5 | Lower third | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 6 | Subscribe | 4 | 4 | 4 | 5 | 5 | 4 | 4 | — |
| 7 | Callout | 4 | 4 | 4 | 4 | 4 | 4 | 4 | — |
| 8 | Social handle | 4 | 4 | 4 | 4 | 5 | 4 | 4 | *Left*: "FOLLOW US" 2.2u, at the floor of the label size, legible at full size |
| 9 | Big number | 5 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 10 | Bar chart | 5 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 11 | Donut chart | 4 | 3→4 | 4 | 4 | 4 | 3.5 | **4** | Long names: "Buildings and maintenanc" cut mid-word with no ellipsis; in the two-column legend each name fitted alone, so a long one came out at half the size of its neighbour |
| 12 | Line chart | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 13 | Three numbers | 5 | 4 | 4 | 4 | 4→5 | 3.5 | **4.5** | "Villages visited by the bus" shown as "Villages visited by the": the last word dropped without a sign (24-character cap). Villages got a lightning bolt; "volunteer hours" got people in English and a clock in Arabic |
| 14 | Logo reveal | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 15 | Countdown | 5 | 3→5 | 5 | 4 | 5 | 3.5 | **4.5** | Arabic, Sorani and Badini: the last word (انطلق, دەست پێبکە) ran past the ring on both sides, on the gallery cover itself |
| 16 | Intro sting | 4 | 4 | 4 | 5 | 5 | 4 | 4 | — |
| 17 | Steps | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 18 | Loop background | – | – | 4 | 4 | 4 | 4 | 4 | — |
| 19 | News bar | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — (looked small on the sheet; full size reads well) |
| 20 | Soft pill | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Arabic sample: show title now in «» (read as "the morning table programme"). The pill's last two frames go grey: it is the pop exit fading over a dark street, not a shadow bug |
| 21 | Kicker and name | 4 | 3→4 | 4 | 4 | 5 | 3.5 | **4** | Tag capitals 2.1u, the smallest type of the eight lower thirds; with the name cleared, an accent underline under nothing |
| 22 | Neon name | 4 | 4 | 5 | 4 | 5 | 4 | 4 | *Left*: role 2.3u tracked capitals; running light lit on the cover (W2-4 kept it on purpose) |
| 23 | Notification stack | 4 | 4 | 4 | 5 | 5 | 4 | 4 | Arabic icon words missed plurals and hamza-less spellings (رسائل, اعجاب, فاز, صديق…), and دقيق matched تدقيق (an audit) as a clock |
| 24 | Hand-drawn circle | 5 | 4 | 5 | 5 | 5 | 4.5 | 4.5 | — |
| 25 | Chat conversation | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Arabic sample: "الأبواب في السابعة والعرض في الثامنة" is a calque; now "تُفتح الأبواب… ويبدأ العرض…" |
| 26 | Device frame | 4 | 3→4 | 4 | 4 | 4→5 | 3.5 | **4.5** | Landscape headline broke "Your / studio, in / your pocket" (a preposition hanging at a line end, three ragged lines); a three-word screen name became "Noor…" |
| 27 | Film look | 4 | 4 | 5 | 4 | 5 | 4 | 4 | — |
| 28 | Bar chart race | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Arabic title stiff ("الفاكهة المبيعة كل عام" → "مبيعات الفاكهة سنوياً"). *Left*: tick labels small; the period number shows two years overlapped for a frame or two while it rolls |
| 29 | Timeline | 4 | 4 | 4 | 4 | 5 | 4 | 4 | Arabic sample "افتتاح في ثلاث مدن" had no object ("افتتاح فروع في…") |
| 30 | Before and after | 4 | 4 | 4 | 4 | 5 | 4 | 4 | — |
| 31 | Price card | 5 | 4 | 4 | 4 | 5 | 4 | 4 | Arabic price "19$/شهرياً" said "per monthly" (now "/شهر"); "دعم ذو أولوية" a calque. *Left*: all fields empty leave an empty card with a hairline |
| 32 | Progress rings | 4 | 3→4 | 4 | 4 | 3→5 | **3** | **4.5** | Long labels cut mid-word with no ellipsis: "Attendance across the te", "Homework handed in on ti", "الطلاب الناجحون في كل ال" |
| 33 | Retro screen | 5 | 4 | 5 | 5 | 5 | 4.5 | 4.5 | — |

**Before: 6 templates under 4 (split reveal 3, progress rings 3, donut, three numbers, countdown, kicker and name, device
frame 3.5). After: none under 4; eight at 4.5.**

### Motion against the direction numbers

Measured from the built layers (English, landscape, each template's own length): first motion at 0–0.3 s in all 33;
entrances 0.45–0.9 s, exits 0.28–0.5 s, a median exit/entrance ratio of 0.64 (the rule's 0.6); every exit is its
entrance played backwards (mask→mask, pop→pop, wipe→wipe, rise→rise), and the sheets show each one mirroring. Two
departures, both left as they are:

- **"All in by 30% of the length"** is met by 12 of 33. Kinetic, split, big number, logo, neon, notifications, circle
  and line chart land at 39–44%: their entrances are 1.9–2.6 s in 4–6 s graphics. Pressing them to 30% would make every
  stagger a blur; the hold that remains (2.3–3 s) is ample for their words. Steps (51%), chat (78%), race (78%) and
  countdown (86%) are sequential by nature.
- Overshoot curves (`back-out`) appear on badges and pops in several templates, on one element each, as rule 2 allows.

## What changed

**`motionrecipes-data.ts`**
- `clipWords(s, chars)` (exported): a label held to its characters is cut after the last whole word and ends in "…";
  only a first word longer than the whole room is cut inside itself, and it too says so. Charts' 24-character labels now
  use it (they used to cut mid-word and silently: "Buildings and maintenanc").
- `clipToLines(text, size, max, lines)` (exported): words wrapped by the width estimate, held to `lines` lines, the last
  one ending in an ellipsis when more remain.
- `WRAPPED_LABEL = 40` (exported) and an optional `chars` on `itemOf`/`itemsOf`: templates that wrap a label on two
  lines under a figure or a ring (three numbers, progress rings, the donut's legend) keep the reader's 40 characters,
  then clip to the lines they have room for. Charts keep 24.
- Three numbers: labels clipped to their two lines. Donut: one size for all the legend's names (the size at which the
  widest fits, at least 0.78 of the legend's), each clipped to its row; the centre caption clipped to its line.
- Icon words: village/town (قرية, قرى, بلدة, گوند) → pin; volunteer (تطوع, خۆبەخش) → people.

**`motionrecipes-titles.ts`**
- Split reveal: the lower panel is `accent2`, solid (a duotone; the palette's two accents are chosen to stand together).
  On the tall frame the title is 13.5u (was 11.5u), the subtitle 4.2u, and the opening wider.
- Kinetic type: when a line above the lit word holds a comma, semicolon, Q or J, the lines open from 0.98 to 1.14.
- Big title: the rule is drawn only under a headline.

**`motionrecipes-overlays.ts`**
- Countdown: the last word is sized to fit inside the ring as a circle (width² + ink height² under 90% of the ring's
  diameter², with Arabic script's taller ink), not only its width; Arabic script set at 1.08 leading on two lines.
  "GO" is unchanged.

**`motionrecipes-pro-a.ts`**
- `balancedInto`: a line ending on a little word (the/of/in/your…, و/في/من/على…, لە/بۆ/بە…, د/ل/ب/ژ/وەک) counts 15%
  wider, and among breaks whose widest line is equal, the one with fewer such endings wins; a break that keeps every
  line inside the room always wins. Used by every headline and two-line block in the file.
- Device frame: the browser window is 88u wide (was 96u), so the landscape headline sets as "Your studio, / in your
  pocket" on two lines at full size; the word on a phone's screen may take two lines and shrink to 62% before it is cut.
- Kicker and name: tag capitals 2.3/2.5/2.4u (were 2.1/2.3/2.2u); the underline is drawn only under a name.
- Notification icons: Arabic plurals, duals and hamza-less spellings (رسائل, دردش, دقائق, ساعات, قريبا, اعجاب, فاز,
  الفائز, صديق, موافقة, بنجاح, تأكيد, مدفوع, تحويل, فاتورة, استرداد); دقيق, which matched تدقيق, is now دقيقة.
- Arabic samples: the chat's "Doors at 7" line; the pill's show title in «».

**`motionrecipes-pro-b.ts`**
- Progress rings: labels keep 40 characters and are clipped to their two lines with an ellipsis.
- Arabic samples: race title, timeline's last milestone, price (`19$/شهر`) and feature (`أولوية في الدعم الفني`), rings
  title (`لمحة عن هذا الفصل`).

**`i18n.ts`** (Arabic only; keys and placeholders unchanged): 28 values, all in the Pro sections, from a full read of the 251
Pro-pass Arabic strings (by a second reviewer, checked by me):
- **An agreement error**: `{n} إطاراً في الثانية` is wrong for 6, 8 and 10, which the GIF offers. Now `معدل الإطارات: {n} في الثانية`.
- **A term clash**: "Web loop" was حلقة, which the app uses for "Ring" (and the new Progress rings). Now `مقطع متكرر للويب`, and the GIF hint matches.
- **Calques**: `هو حين`, `والأقل يُقرأ أسرع`, `إلى اثنين` (twice), `إلى أين سيذهب؟` (now `أين ستنشره؟`), `يرتفع عدّاً`, `مدة السعر`, `وسم التسمية`, `محادثة دردشة`, `رزمة إشعارات`, `انعطافة خاطفة` (a road bend; now `التفاتة خاطفة`), `الارتعاش` (trembling; now `الوميض`).
- **Precision**: `يبقى تصميمك {from}` gained `بنسبة`; the scene and GIF limits now say what is limited (the length, the number of scenes); "Level" in the Sound row is `مستوى الصوت`; "Bar chart race" uses أعمدة as "Bar chart" does.

About 90% of the Arabic was already publishable. The remaining "maybe" items are listed under R5 in `review-needed.md`.

**Tests.** New `test/pro-review-content.test.mjs`, 41 checks, in the chain before `orphans`: `clipWords` and
`clipToLines` (plus 2,000 generated labels: never past the room, always the label or an honest cut), labels under figures
and rings, the donut's one size, the countdown word inside its ring in every shape and language, kinetic leading, the
split's duotone in all nine palettes, the device's line breaks and screen word, nothing decorative left alone, icon
words, and the two Arabic terms. `test/pro-gallery.test.mjs`: the pinned digest of the eighteen core templates moved
(split reveal, kinetic, countdown changed on purpose); the reason is written beside it.

**Checked unchanged.** Built at HEAD and now, all 33 × four languages × four shapes × five lengths: no layer id lost or
added, every field identical. From their samples, 22 of the 33 build byte for byte as before (big title, three numbers
and the donut changed only for empty or long words). `npm test` (162 steps), `npx tsc --noEmit`
and `npm run build` pass.

## Left open

- Quote card: a decorative Latin “ heads Arabic quotes. An Arabic designer might use « or a mirrored mark; a choice for
  the owner, not a defect I am sure of.
- Price card with every field empty: an empty card with its hairline.
- The race's ticks are small; its period number shows two years crossing for a frame as it rolls.
- Device frame, square and 4:5: the narrow column still breaks "Your / studio, in / your pocket" (no better break fits
  its room at that size).
- Templates landing at 39–44% of their length (see above).
- Sorani and Badini: see `review-needed.md`, section R5.
