# Review: the Broadcast screens and the redesigned panel, in the app's own engine

Branch `wa-r-ui` (from the merged `wa`). An adversarial review of `WhatsAppBroadcast.tsx`, `WhatsAppPeople.tsx`,
`WhatsAppCompose.tsx`, `WhatsAppReady.tsx`, `WhatsAppRun.tsx`, the `wa:bulk` and `wa:design` blocks and their words,
looked at the way a shopkeeper would see them: in **WebKit**, not Chrome.

## How it was looked at

- **A WKWebView host** (Swift, off screen, a fresh non-persistent data store per page, the app's own WebKit; window
  occlusion detection switched off so `requestAnimationFrame` runs) driving an esbuild bundle of the real screens
  against the **real** parser, campaign rules, templates and IndexedDB store; only the runner, the writer's model call
  and Tauri were faked. No network, no key, no `tauri dev`, nothing of the owner's touched.
- Every Broadcast screen — 29 scenes: People empty / read / 14 columns / file / wrong file / chats / saved; Message
  filled / empty / blanks; Ready messages and the fill form; Write with AI with results, without a model route, failing;
  Attach and a too-big file; Review plain / filled / pace open / staged by the assistant; Run going, paused, halted,
  interrupted; Report; History; Do-not-contact; no account — at **248 px** (the column, 760 px tall like a laptop) and
  **1100 × 760**, in `en` light, `ar` dark, `ckb` light (plus `kmr` light and `en` dark for eight of them): **2 × 198
  shots**, before and after the fixes.
- Probes in the page: overflow and poking boxes, every word's line boxes (a word broken mid-word), every field's name,
  every target's height, focus after each move, arrow keys on the tabs in both directions, the drawer's Tab trap and
  Escape, Send hammered, keystroke latency with 5,000 people, a 5 MB paste, a 20,000-number do-not-contact list, a
  12 MB picture, and the chat panel and Motion drawn in the same sidebar for comparison.

Pictures, in `/Volumes/ExtremeSSD/apps/vylo-wa-samples/review/ui/`:

| File | What |
|---|---|
| `sheet-before-after.png` | the fixed screens, before and after, side by side (`pairs/`) |
| `sheet-after-column-{en-light,ar-dark,ckb-light}.png` | all 29 scenes at 248 px, after |
| `sheet-after-window-{en-light,ar-dark,ckb-light}.png` | all 29 scenes at 1100 × 760, after |
| `sheet-after-kmr-endark.png` | Badini light and English dark |
| `sheet-cohesion.png` | the chat panel (list, conversation, setup, error), Broadcast and Motion in one sidebar |
| `before/`, `after/`, `probes/` | the single shots (`NN-scene-lang-theme-{col,full}.png`) |

## Findings

Severity: **high** = Send reachable without what it must show, or a safety rule bypassed; **medium** = a person is
misled, lost, or cannot finish; **low** = looks wrong or reads wrong.

| # | Sev. | Found | Fixed |
|---|---|---|---|
| 1 | high | **The consent tick outlived its list.** Tick for 10 people, Back, read 3 others, Next, Next: the box was ticked and *Send to 3 people* was live (seen in WebKit; under 50 people no typed count stands in the way). A staged draft opened from its banner over the review card also kept the count typed for the other broadcast. | The tick is kept as the review key it was given under (draft, account, a hash of every number) and counts only while it matches; the card is drawn per key. `ebe75c4` |
| 2 | high | **Blanks bypassed at step 3.** `{offer}` blocks step 2, but a draft that opens on the review card (the assistant's staged campaign, a draft remembered at step 3) never passed step 2, and `validateCampaign` has no blank check: Send was enabled. | `blanksOf(c)`: the card lists the blanks and disables Send; `launch` refuses them whoever calls it. `ebe75c4` |
| 3 | medium | **Focus fell to `<body>`** after History, See the report, Back from a sub-view and Send (the pressed button goes with its view); in Ready messages *Use this* swapped the list for the fill form inside one drawer, so Escape (heard on the drawer) stopped closing it. | Every view box and the run take focus on a view change; the fill form is a drawer of its own (keyed). `1874fc9` |
| 4 | medium | **Next landed mid-step.** Pressed at the bottom of a long step 1, it opened step 2 scrolled 123 px (229 in Arabic): the heading, stepper and Ready messages / Write with AI under the sticky header (`probes/v-step-next-*`, `pairs/30-*`). | `showTop`: focus without scrolling, the scroller back to its top. `74647d6` |
| 5 | medium | **The Back/Next bar floated half way up** a short step at 248 px, empty sidebar under it — Broadcast is mounted in a plain `<div>`, so the column was not bounded (`pairs/01-*`). | The sidebar's scroller and the mount fill the column (CSS in `wa:bulk`). `74647d6` |
| 6 | medium | **`{phone}` offered as a chip** for any pasted list with a phone column: the header's columns, not what people carry. It went out as nothing for everyone with only a warning, and #2's check would have called it a missing column. | Chips and step 2's blanks read the columns people carry (`columnsOf`), as the card does. `74647d6` |
| 7 | medium | **Do-not-contact at 20,000**: 500 drawn (331 ms) under "20,001 people", no way to reach the rest — a number someone asked to have removed could not be found. | Search (`0750…`, `+964…`, Arabic digits, last digits) and a line saying only 500 are shown. `f5894c8` |
| 8 | medium | **"Do not continue until it is linked again"** over a blue *Continue* (halts: blocked/logged out, refused key, lost link, "wait an hour"). | A halt's Continue is an ordinary button; after a quit it stays the primary. `f5894c8` |
| 9 | medium | **Close mid-run, switch account, reopen**: the run showed under the new account's name, nothing saying it sends from the first (WebKit, `probes/v-switch-acct-*`). | The run says so. `f5894c8` |
| 10 | medium | **Wrong colour for blanks**: `wa:design`'s `.wa mark` (0-1-1) out-ranked `.wa-bk-hole` (0-1-0), so `{offer}` (must fill) was drawn in the accent like `{name}` (filled per person) (`pairs/11-*`). | `.wa-bk mark.wa-bk-hole`. `74647d6` |
| 11 | low | **Contrast** (measured, both themes): `--mute` on `--panel-3` 4.15:1 (tips, waiting/skipped pills, report filters, the writer's count, a template's kind); the name over each preview bubble and the wall's sentence 3.88:1; the preview's clock 4.19 / 2.61:1. | All ≥ 4.5:1 (`--ink-2`, `--wa-caption`, darker/lighter `--wa-meta`); 32 pairs tested. `74647d6` |
| 12 | low | **Sorani "Saved lists" broke mid-word** (`پاشەکەوتکراوەکا` / `ن`) — the only broken word in a scan of every word's line boxes, 16 screens × 4 languages. | The ways in are tiles in the column (icon over label); `break-word`. `135bd08` |
| 13 | low | Mixed Latin/Arabic-script names in the tables hugged opposite edges (`dir="auto"` aligned each to its own start). | The name is isolated in a box at the cell's start. `f5894c8` |
| 14 | low | Placeholders in Arabic/Kurdish template text pulled punctuation and `*bold*` marks to the wrong side. | Placeholders isolated (`dir="ltr"`), as the engine isolates values. `09644fb` |
| 15 | low | "2 couldn't be read · 1 repeated" wrapped with the `·` starting the next line. | Each count a pill. `8f7a3a4` |
| 16 | low | "Lines that couldn't be read" was a 24 px target (every other target in the column measured 44). | 44 px. `5ef2990` |
| 17 | low | The no-account header cut its sentence mid-word ("No WhatsApp account is co"). | It wraps. `74647d6` |
| 18 | low | In a window, the way back from History said **"Sending"** for a broadcast that had stopped by itself. | `runLabel`: Sending / Stopped by itself / Paused / Broadcast. `1b31325` |
| 19 | low | Words: "with a break every 20." (20 what?); "10 people have no first_name" (and again for `{name}`); "Download CSV" (nothing downloads; CSV is jargon); Arabic `{days} أيام`, `{h} ساعة`, `{max} حرفاً` wrong for most numbers. | "…after every 20 messages"; "10 people have no name", once; "Save as a spreadsheet (CSV)"; Arabic hours/minutes abbreviated as the English is (`س`/`د`), days as `أياماً عددها {days}`, characters as a label. `994df49` |

## What held up

- **Send cannot be defeated.** In WebKit: disabled at first; clicks and Enter before the tick do nothing; the tick
  alone does nothing above 50 people; `127` for 128 is refused, `١٢٨` accepted; unticking and pressing in the same
  breath does nothing; three clicks on a live Send made **one** run, with consent, the 128 people and the pace shown.
  `launch` re-checks consent, the engine's problems, now blanks, the account, and saves before the runner exists.
- **Nothing threw.** 2 × 198 shots and ~120 probe pages: no React error, no page error, no horizontal scroll at 248 px.
- **Keyboard**: the tabs move with arrows, mirrored in Arabic, Home/End; drawers take focus, trap Tab both ways, close on
  Escape and stop it there; every field and select has a name; every target in the column is 44 px (after #16).
- **Scale**: typing in step 2 with 5,000 people: 23–26 ms a keystroke (13 ms at 128). A 12 MB picture attached in
  136 ms, typing unaffected. Reading a 5 MB paste (62,180 lines): 132 ms, "Only the first 5,000 were taken" said.
- **Writer failures** read plainly (500, unreadable answer, refusal shown as said, Stop during a slow answer); no model
  route says "Add a model in Settings" with the button. A PDF dropped on the zone, or picked, is refused in a sentence.
- **Cohesion**: the chat panel, Broadcast and Motion read as one product in both themes and in RTL
  (`sheet-cohesion.png`): same type scale, inputs, buttons, accent, radii. Apart from #10, the two CSS blocks do not
  fight; both are logical-only; WhatsApp's own colours stay in the preview.

## Judgement calls, left as they are

- **Pace fields commit on blur.** Typing 1000 into *Most messages in one day* and pressing Send straight away sends at
  1000/day — the number is in the field, but the "more than 300…" warning appears only as the field loses focus.
- **Step 3's bar has only Back**; Send is at the end of the card, under the message, pace, tick and count, so a person
  must scroll past them (intended, but nothing in the bar says Send is below).
- **5 MB in the paste box**: each later keystroke in it costs ~1 s in WebKit (a bare WebKit textarea with the same text:
  0.35–1 s; making the box uncontrolled measured no better, so it was not changed). Read is instant.
- **The run's live list at 248 px** ellipsises a masked number before its last four digits when the standing is long
  ("+964 752 **… Not on WhatsApp").
- **26 category chips** in the window's Ready messages (the column uses a select); **the conic ring** fills clockwise in
  RTL too (as clocks do); the report's five filters wrap 4 + 1 in the column.
- Cards use the app's `--shadow` (as Motion does), the panel's cards `--wa-lift`; the preview bubble keeps WhatsApp's
  `--r-2` corner.
- *Add STOP replies* reads only the messages the panel has loaded (the open conversation) and says "Open your chats
  first" when there are none. A store that fails to load shows "No broadcasts yet"; a working list that fails to save is
  lost on close — both silently, both rare.
- Arabic `'{n} people'` is a label (`الأشخاص: {n}`) and *Send to {n} people* is `أرسل إلى الأشخاص ({n})`: correct for
  every number, a little stiff.

## Tests

`app/test/wa-review-ui.test.mjs` (last in `test:5`): **103 checks** — the review key, blanks on the card and in
`launch`, focus targets, `showTop`, carried columns, do-not-contact search, halt/elsewhere/way-back wording, name
cells, placeholder isolation, the CSS rules behind #5 #10 #12 #15 #16 #17, 32 contrast pairs (light and dark), and the
words. What only a real engine shows (scroll positions, focus after a click, broken words, Send hammered, timings) was
proved with the WebKit host and is recorded above. Builder tests touched, intent unchanged: three assertions in
`wa-ui-more.test.mjs` follow reworded strings / the `dir` on placeholders; one fixture in `wa-ui.test.mjs` now carries
the column it names (the real parser never yields a header column nobody carries).

Gates at the end: `npm test`, `npx tsc --noEmit`, `npm run build` — see the last commit's message.

## What remains, for the owner

1. Look at **step 1 → Next → step 3** in the real app with a list over 50, and the **History → staged draft** path —
   the two places the gate changed (#1, #2).
2. A native reader for the new Sorani/Badini lines and the three doubtful ones (`docs/wa/review-needed.md`,
   *review-ui*), especially the file-type sentence's jumbled extension list in RTL.
3. The judgement calls above, the first two especially.
