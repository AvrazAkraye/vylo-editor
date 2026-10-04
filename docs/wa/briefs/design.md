# Package `design`: the WhatsApp panel, made nicer and more professional

Read `docs/WA.md` first. The owner: *"make it more pro and make the design more nicer"*. You make the **existing WhatsApp panel** — the account bar, the chat list, the conversation, the composer, the setup/connection form, the empty, loading and error states — look and feel like a product people pay for. The Broadcast screens are the `ui` package's; they will share your visual language, so make it a coherent one.

## You own
`app/src/WhatsAppPanel.tsx` (markup, class names, small structural changes **that keep every behaviour**; the Broadcast door and `bulk` state are already in it — keep them), the CSS between `/* wa:design start */` and `/* wa:design end */` at the end of `styles.css` (and edits to the existing `.wa-*`/`.sb-*` rules **only inside the WhatsApp section** when overriding would be silly — say so in your report), `app/src/Icon.tsx` **only to add icons you need** (append, don't change), your i18n entries (`// wa design`), `app/test/wa-design.test.mjs` (structural checks you find valuable: logical properties only, no fixed px widths that break the column, every `.wa-*` class used in markup exists in CSS and vice versa), `docs/wa/design.md`.

## What "nicer and more pro" means here (decide, then show before/after)
- **Hierarchy and rhythm**: a clear type scale, consistent spacing (4/8 grid), calm contrast; the header, account bar and list rows feel designed, not assembled. Avatars with tasteful tints, unread badges that don't shout, timestamps quiet, last-message previews that truncate gracefully (RTL too), selected/hover/focus states that are obvious and elegant.
- **The conversation**: message bubbles with proper grouping, tails or none (choose), day separators, status ticks, quoted replies, media blocks, voice notes, link previews; the composer as a polished control (auto-grow, send button states, attach/voice affordances).
- **The setup/connection form**: a friendly first-run experience (what to enter, where the key goes, a connected-state card with the number and a clear "Disconnect"), errors in plain sentences.
- **Empty/loading/error states** with a small illustration-free but characterful treatment (icon, one sentence, one action); skeleton rows instead of spinners where it helps.
- **Account bar**: multiple accounts as pills with initials and a dot for the connection state; adding one is obvious.
- **Light and dark themes, RTL, 248 px column and full screen** all first-class. Respect `prefers-reduced-motion`. Motion is subtle (150–200 ms), never decorative.
- **Do not break**: behaviour, keyboard, selection mode, search, load-more, fullscreen, voice, media. No logic changes. No new dependency. Tokens and fonts from the app, not new ones. Performance: a chat list of 500 rows must stay smooth (no per-row layout thrash).

## Proof
Use the headless Chrome-over-CDP harness described in the project memory (`vylo-panel-visual-check`): a harness folder in your git-ignored `app/.test-build/` that renders the panel with fake data (chats, a long conversation with every message kind, errors, empty, setup) at 320 px and 1100 px, light/dark, LTR/RTL. Take **before** screenshots first (from the unmodified panel), then after; put a before/after contact sheet in `/Volumes/ExtremeSSD/apps/vylo-wa-samples/design/`. Never run `tauri dev` or touch the owner's running app or data. Keep the Chrome profile on the SSD and delete it afterwards; macOS has no `timeout` (`perl -e 'alarm 60; exec @ARGV'`).

## Not yours
Anything under Broadcast (`WhatsAppBroadcast.tsx` and friends, `/* wa:bulk */`); the engine; the library; the writer; other panels.
