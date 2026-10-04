# `design`: the WhatsApp panel, made calmer and more professional

The owner: *"make it more pro and make the design more nicer"*. This package redraws the existing panel — the account
bar, the chat list, the conversation, the composer, the setup form and every empty, loading and error state — without
changing what any of it does. The Broadcast screens (`ui`, `/* wa:bulk */`) are meant to speak the same visual language;
this page is that language.

Before/after contact sheets: `/Volumes/ExtremeSSD/apps/vylo-wa-samples/design/sheet-1-column-light.png`,
`sheet-2-column-dark.png`, `sheet-3-full.png` (44 shots each side in `before/` and `after/`: 248px and 320px columns, full
screen at 1100px, light and dark, English, Arabic and Sorani).

## The visual language

Everything comes from the app's own tokens (`--sp-*`, `--fs-*`, `--r-*`, the colours). What is WhatsApp's own is named
once, as `--wa-*` custom properties on the panel's two roots (`.wa, .wa-full`), with the dark values written twice the
way every dark token in `styles.css` is. Anything mounted inside `.wa` — the Broadcast screens are — can use them by name.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--wa-gutter` | `--sp-6` (12px) | same | the inline margin of everything in the column |
| `--wa-avatar` / `--wa-avatar-sm` | 36px / 30px | same | list rows / conversation header |
| `--wa-canvas` | `--panel-2` | `--panel-2` | what the list and the thread sit on |
| `--wa-card` | `--panel` | `--panel` | cards, the search box, the composer, floating toolbars |
| `--wa-field` | `--bg` | `--panel-2` | text fields inside a card |
| `--wa-theirs` | `--panel` | `--panel-3` | the other person's bubble, the day pill |
| `--wa-mine` | `--brand` 12% on `--panel` | `--brand` 16% on `--panel-2` | your bubble: a tint, not a fill |
| `--wa-mine-meta` | `--brand` 35% into `--ink-2` | `--brand` 45% into `--mute` | the time and ticks on your bubble |
| `--wa-sel` | `--brand` 8% on `--panel` | same mix | the selected row |
| `--wa-live` | `--ok` | `--ok` | "set up" dot (was a hard-coded `#25D366`) |
| `--wa-lift` | 1px soft shadow | darker | anything raised: bubbles, cards, the composer |
| `--wa-float` | 6px/18px shadow + hairline | darker | things that float: the bubble toolbar |
| `--wa-fast` | `.15s` | same | every transition (the app's global reduce rule stops them) |

**Type**, five steps of the app's scale in the column: titles `--fs-6` 650 (`Chats`, the first-run heading); names, bubbles, the search
and reply boxes `--fs-4` (12.5px; `--fs-5` in a full-screen thread); previews, labels, fields, buttons `--fs-3`; times, help, section
names `--fs-2`; only badge digits and a bubble's clock at `--fs-1`. Section names are sentence case or, where capitals
remain (`.wa-sep`), their letter-spacing is switched off in right-to-left (Arabic letters join).

**Spacing**, on the app's 2px rhythm used as a 4/8 grid: 4 between things inside a control, 8 between controls and
inside rows, 12 for gutters and card padding, 16–20 for a state's breathing room.

**Radii**: `--r-3` (12px) for anything that holds content — bubbles, cards, rows, the search box, the composer; `--r-2`
(7px) for controls inside them — fields, quotes, file rows; `99px` for pills — accounts, the day, "New messages", counts.

**Colour roles**: one accent (`--brand`) for the selected, the unread, the new and the one door (Broadcast); red only for
an error or a destructive action; green only for "set up". Every text pair this block introduced is measured ≥ 4.5:1 in
both themes by `wa-design.test.mjs` (28 pairs, `color-mix` evaluated in sRGB as the browser does).

**States**: hover is `--panel-3` on rows (`--brand-wash` on accent controls); selected is `--wa-sel` and the name in the
accent; focus is the app's 2px `--brand` ring, drawn inside a row so a scroller cannot clip it; disabled uses the app's
own treatments (`--dim`, the `.sb-cta-go:disabled` card); unread is weight plus an accent time; picked is a 2px accent
ring on the bubble; a refused request is a red mark beside a plain sentence (`Why`).

**Motion**: 150ms colour transitions only, the window rising in 180ms (the app's `rise`), a skeleton that pulses; all
stopped under `prefers-reduced-motion`.

### For the Broadcast screens (`ui`)

They render inside `.wa`, so every `--wa-*` token resolves there. Patterns from this block they can reuse by class:
`wa-card` (a raised card with a 12px grid gap), `wa-sect` (a card's heading with an accent icon), `wa-help` (help under a
heading), `wa-why` (a reason, with its mark), `wa-state` + `wa-state-mark` + `wa-state-acts` (a mark, one sentence, an
action), `wa-top` + `wa-top-title` (a list's bar). The bounded column (header and footer still, the middle scrolling)
applies to `.wa-view` as a direct child of `.sb-panel`; Broadcast is mounted inside a plain `<div>` and keeps the
sidebar's scrolling unless that wrapper gets the same treatment.

## What changed

- **The column holds still.** Before, the whole panel scrolled, so opening a long conversation carried the contact's name
  and the reply box off the screen. Now the list scrolls under its bar and search box, and the thread between its header
  and the composer (`.sb-panel:has(> .wa-view)`; the form still scrolls with the sidebar).
- **List**: a real bar (`Chats`, then Reload, Broadcast in the accent, Full screen, Settings; Broadcast also says its
  name in a window); 36px tinted avatars and a people glyph for groups (new `people` icon, appended to `Icon.tsx`; it was
  `memory`, a bookmark); unread by weight and an accent time; the open conversation marked in a window (`aria-current`);
  names and previews sit on the panel's leading edge in both directions; a preview after "You:" is isolated (`<bdi>`) so
  an English reply under a Sorani label keeps its punctuation; a picture-only preview gets its glyph.
- **Accounts**: pills with the account's initials in its own tint and a presence dot (set up / not); Add says "Add".
- **States**: rows-shaped skeleton until the first answer (was "Nothing has arrived yet", false for that second and for
  ever on a refused key); refused → a red mark, the reason, *Try again* and *Change the connection*; empty → *Reload*; no
  match → *Clear the search*; empty thread and "pick a conversation" with a mark.
- **Conversation**: header with a whole name in 248px; your bubbles tinted, theirs raised; day and "New messages" as
  pills; quotes on a wash with an accent bar; read ticks in the accent; a floating hover toolbar; pictures edge to edge in
  their bubble, stickers with no bubble; file rows as a tile with name and size; fetch buttons solid, not dashed; the
  audio player drawn for the dark theme (`color-scheme`).
- **Composer**: a raised field with a focus ring; round 28px attach, voice and send (the voice button had been drawn as
  the transcription pill — two rules shared `.wa-say`); the reply being answered as a card.
- **Setup**: a first-run sentence saying what the three fields are (the one new string); a saved account as a card with
  initials, name, `instance · host` and a set-up dot; the connection, sending voice notes and reading voice notes as three
  cards (three servers, three keys); the key note moved under the key; the voice help no longer drawn as a red error
  (it used `.wa-why`); *Remove this account* in red, its confirmation filled.
- **Full screen**: 320px list, canvas-coloured thread, white header; the bars start under the macOS window-button strip
  (`.mac`), as Motion, Video and Research already do.

## What was left alone, and why

- **All behaviour.** The component body from `export function WhatsAppPanel` to the first render branch is byte-identical
  to Phase 0 (checked with `diff`). Every `onClick` is the same expression as before except *Change the connection*,
  whose body moved into `editConnection` so the error state can offer it too. The new buttons call existing functions
  (`reloadNow`, `editConnection`, `setFind('')`). The Broadcast door and `bulk` state are untouched.
- **The original WhatsApp section of `styles.css`**: not one line edited; every change is an override in the block, which
  keeps each decision's history readable. (Re-pointing `--fill`/`--on-fill` inside `.wa-bubble.mine` is what makes the
  dozen `.mine` rules that drew on the fill follow the tint without being restated.)
- **Words**: no catalogue string changed or removed; `[image]`-style kind labels stay (they are used in three places).
- **The browser's own audio controls**: still the one `<audio>` the panel had; a hand-drawn player is a behaviour change.
- **The phone number on the account card**: an `Account` has no number, so the card shows the instance and host instead
  of inventing one. "Disconnect" is the existing two-press *Remove this account*.
- **Link previews**: the panel has no preview data; drawing one would need new fetching.

## Deviations

- **The block is not at the very end of `styles.css`.** `vm-ask.test.mjs` accepts only `vm:*` blocks after `vm:ask end`,
  so `wa:design` sits immediately before `/* vm:ask start */` (nothing in the vm blocks styles a `wa-*` class, so the
  cascade is the same). `docs/wa/requests/design.md` asks the integrator to relax that check; **`wa:bulk` will hit it too.**
- `role="alert"` on the reason line, `aria-current` on the open row: small accessibility additions.

## Tests and gates

- `app/test/wa-design.test.mjs`: **83 passed, 0 failed** — the block's rules (logical only, no `direction`, no hex, no
  width over 248px outside the window), class parity both ways, 28 contrast pairs, reduced motion, 39 handler fingerprints,
  and a `react-dom/server` render of the first-run form and the waiting list with every drawn class defined.
- `npm test`: **15,846 passed, 0 failed** across 180 files. `npx tsc --noEmit`: clean. `npm run build`: built.
- Performance: 511 conversations scrolled for 90 frames in headless Chrome — median 16.6ms, p95 17.7–18.6ms, max 18.7ms,
  the same as before the pass (`content-visibility:auto` on rows; no per-row `:has`, filter or shadow transition).

## Proof, and how to look again

A harness (esbuild + headless Chrome over CDP, Chrome profile on the SSD and deleted after) rendered the panel with a fake
Evolution server answering locally (no network) — chats in four scripts, a long conversation with every message kind, a
group, errors, empty, loading, setup — and drove each scene (open, pick, reply, search, hover, keyboard focus). *Before* was
built from a `git archive` of the Phase 0 sources. The harness is kept outside the repository at
`/Volumes/ExtremeSSD/apps/vylo-wa-samples/design/harness/` (`run.mjs`, `main.tsx`, `sheet.mjs`); copy it into
`app/.test-build/wa-harness/` to run it.

## Open problems

- Judged in Chrome, not in the app's WKWebView. `:has`, `color-mix`, `content-visibility` and `field-sizing` are in
  macOS 26 WebKit; the audio element's dark `color-scheme` there is unverified.
- In 248px the Load more label wraps to two lines, and a bubble's clock is 9px (`--fs-1`).
- The Broadcast screens get the tokens but not the bounded column (see above).

## For a native reader (Sorani, Badini)

The one new string, *Link a number through your Evolution API server: its address, the instance name and the API key.*:

- ckb: `ژمارەیەک لە ڕێگەی ڕاژەکاری Evolution API ـەکەتەوە ببەستەوە: ناونیشانەکەی، ناوی نموونەکە و کلیلی API.`
- kmr: `ژمارەکێ ب رێکا راژەکارێ تە یێ Evolution API گرێبدە: ناڤونیشانێ وی، ناڤێ نموونەیێ و کلیلا API.`

(Arabic: `اربط رقماً عبر خادم Evolution API الخاص بك: عنوانه، واسم النسخة، ومفتاح API.`) Terms follow the existing
catalogue (`ڕاژەکار`/`راژەکار` server, `نموونە` instance, `کلیلی`/`کلیلا API`).

## For the integrator

Nothing to mount. Merge `WhatsAppPanel.tsx`, the `wa:design` block, the `people` icon, the three `// wa design` entries
and the test; act on `docs/wa/requests/design.md`.
