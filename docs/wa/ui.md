# Package `ui`: the Broadcast screens — what exists and how to wire it

Branch `wa-ui`. Built against the Phase 0 placeholders (final names and signatures); nothing here sends a message by
itself, and the only call to `runCampaign` on any screen is `launch` (below). Gates: `npm test`, `npx tsc --noEmit`,
`npm run build` all green on the branch.

## Files

| File | What it is |
|---|---|
| `app/src/WhatsAppBroadcast.tsx` | The shell: header, the three steps, the bottom Back/Next bar, the window layout, the remembered draft (`DRAFT_KEY`, `readWork`/`writeWork`), the working list, staged drafts, recovery of an interrupted run, history/report/do-not-contact navigation. |
| `app/src/WhatsAppPeople.tsx` | Step 1 (`AudienceStep`): Paste / From a file / From my chats / Saved lists; the summary; rejected lines; first rows (masked); column and country choices; Save this list. Shared helpers `num`, `Fill`, `Masked`. `claimBroadcastDrop`. |
| `app/src/WhatsAppCompose.tsx` | Step 2 (`ComposeStep`): message box, variable chips, Ready messages, Write with AI drawer, attachment drawer, message language, opt-out line, notes (blocks / warnings / spam tips), the WhatsApp-like `PreviewPane` and `Bubble`. |
| `app/src/WhatsAppReady.tsx` | The ready-message picker (`TemplatesDrawer`: categories, search, cards, fill form with empty blanks marked) and the shared `Drawer` (labelled dialog, focus in, Escape out, focus returned). |
| `app/src/WhatsAppRun.tsx` | Step 3 (`ReviewStep`), the live run (`RunView`), `ReportView`, `HistoryView`, `DoNotContactView`; the module-level run holder (`launch`, `liveRun`, `watchLive`, `useLive`, `dismissRun`). |
| `app/src/styles.css` | `/* wa:bulk start */ … /* wa:bulk end */` (classes `wa-bk-*`), placed just before `/* vm:ask start */` — see Deviations. |
| `app/src/i18n.ts` | 253 sentences under `// wa ui` at the end of `ar`, `ckb`, `kmr`. |
| `app/test/wa-ui.test.mjs` | 151 checks: pure helpers, the draft reader (hostile input), `launch` against a fake runner. Exports `buildUi`, which bundles the five screens with React external and the engine modules swapped for fakes. |
| `app/test/wa-ui-more.test.mjs` | 137 checks: every screen rendered (react-dom/server) in the column and a window, English and Arabic; source rules (Send is the only way to `runCampaign`, consent never stored, no key/address drawn, masking); the CSS block (logical, every class defined and used, 44 px, both dark blocks); the catalogue. |
| `docs/wa/review-needed.md` | The 253 Sorani/Badini strings for a native reader, least-sure starred. |
| `docs/wa/requests/ui.md` | Changes outside this package for the integrator. |

Pictures: `/Volumes/ExtremeSSD/apps/vylo-wa-samples/ui/` — `sheet-column-*.png` (248 px) and `sheet-window-*.png`
(1100 px) for `en-light`, `ar-dark`, `ckb-light`; 90 single shots in `raw/` (15 scenes × 3 languages × 2 layouts). The
harness that made them (esbuild bundle of the real components against the fakes + headless Chrome over CDP) is copied
to `…/vylo-wa-samples/ui/harness/` (`shoot.mjs`, `main.tsx`); it was run from `app/.test-build/wa-harness/`, profile on
the SSD, deleted after.

## Props and callbacks

```ts
interface BroadcastProps {            // Phase 0's, plus three optional ones
  t; lang; account: Account | null; full: boolean; gw?: Target; efforts?: EffortBook; onProviders(); onClose();
  chats?: readonly Chat[];            // NEW: From my chats (fromChats)
  msgs?: readonly Msg[];              // NEW: the report's "Add STOP replies…" (optOutPhones)
  openCampaign?: string;              // NEW: open this staged/draft campaign straight on the review card
}
```

**To mount (design owns `WhatsAppPanel.tsx`):** `<WhatsAppBroadcast … chats={chats} msgs={msgs} />` — both are already
in the panel's scope (`chats` from `chatsFrom`, `msgs`). When the assistant stages a campaign, open the panel at
Broadcast and pass `openCampaign={id}`; staged drafts (`Campaign.staged` and state `draft`) are also listed as a banner
on top of step 1 and first in History.

**App drops:** in `App.tsx`'s `listenForDrops({ claim })`, call `claimBroadcastDrop(at, paths)` (from
`WhatsAppPeople.tsx`) before the other claims. It returns true and reads the first path only when the point is over the
open "From a file" zone. (Tauri swallows HTML `drop`; the zone's own HTML handler only serves a browser.)

**The assistant's tool** stages with `saveCampaign(newCampaign({ …, staged: true }))`; nothing else is needed from the
screens. The review card says "Prepared by the assistant. Nothing has been sent." and waits for the tick and Send.

## What each screen needs from the engine (and where the placeholders were not enough)

People — `parseAudience(input, { defaultCountry, filename, mime, phoneColumn, nameColumn })` is re-run with the same
input on a column or country change (the input is held in module memory for the window's life, never stored);
`COUNTRIES` (empty in the placeholder: the select then shows only `+964`); `countryForLang`; `fromChats(chats)`;
`excludeSuppressed`; `makeAudience`; `maskPhone`; `loadAudiences`/`saveAudience`/`deleteAudience`; `loadSuppressed`.
- **`Parsed` has no `truncated`**: the screen says "Only the first 5,000 were taken" when
  `recipients + removed >= LIMITS.recipients`. If `audience` appends `truncated?: boolean`, swap `atCeiling` to it.
- The list being worked on is kept as an audience with id **`wa-bulk-work`** (`WORK_AUDIENCE_ID`), hidden from Saved
  lists. The store's audience cap counts it like any other; that is fine.

Message — `renderMessage(draft, recipient)` for the preview and the review's exact text; `missingVars`; `OPT_OUT`;
`riskHints` (all seven `Hint` codes have sentences); `writeMessages(gw, efforts, req, { signal })`; templates API;
`normalisePhone` (contact card); `whatsappmedia.ts` `sendMime`/`sendAs` for the attachment kind.
- **The preview's seed**: the screens call `renderMessage(draft, r)` with the **default seed**. For `[[a|b]]` the
  runner must render with the same seed, or `Campaign` needs a `seed` field that both use — otherwise the preview is not
  what is sent. Please settle this in `engine`.
- **Blanks**: a `{x}` that is neither `name`/`first_name` nor a column of the list blocks step 2 ("{offer} is not filled
  in…"); a column some people lack is a warning from `missingVars` (shown only for per-person names and real columns).
- **Writer errors** are read as: `name === 'AbortError'` → silent; `message === 'whatsapp:unreadable-writing'` → "The
  answer could not be read as messages"; `{ messages: [], said }` → `said` shown as the refusal; anything else →
  `detailOf(e)`.
- `CATEGORIES[].icon` is handed to `Icon` as is (an unknown name draws nothing).

Review & send — `newCampaign` (built every render with the draft's stable `id`), `validateCampaign(c, { sentToday })`
(every `Problem.code` has a sentence; `too-many` uses `vars.n`/`vars.max`), `estimateSeconds`, `daysNeeded`,
`clampPace`, `capWarning`, `PACE_BOUNDS`/`CAP_WARN`/`DEFAULT_PACE`, `sentToday(accountId)`, `sendTest(conn, phone, text)`.
- **`sendTest` carries no attachment**: the test sends the first person's exact text; the card says so.
- **`Account` has no phone number**: the header and "From" show the account's name (never `baseUrl`, `key` or `instance`).
- Over 50 people, Send asks for the number typed (`typedOk` accepts `1,204`, `١٢٠٤`).
- `over-daily-cap` is treated as blocking (the engine brief: `sentToday ≥ dailyCap` blocks starting now).

Run — `runCampaign(c, realDeps(account))` **only in `launch`**, which refuses while another run is live, without a ready
account that is the campaign's own, unless `c.consent === true`, when `validateCampaign` finds anything, and when
`saveCampaign` returns false (persistence before any send). `launch` is called from Send and from Continue (a campaign
the person started with Send that halted, or that the app's quit interrupted). The runner is held at module level, so
closing the panel does not stop it; reopening shows the run (finished-but-not-dismissed runs too, so a halt reason is
never skipped). `RunEvent`s are applied by `applyEvent` (`state` replaces the campaign; `wait` sets the countdown /
break / daily-cap line; a state other than running/paused clears the wait).
- Counts come from `Campaign.outcomes`; **a person with no outcome is counted as queued** (the runner may write
  outcomes lazily).
- **Interrupted**: on opening, a stored campaign in state `running` that this window does not hold is `recover`ed,
  saved, and shown as "Paused: the app closed while it was sending…" with Continue.
- **`Campaign.halted` is a free string**: sentences exist for `auth`, `not-connected`, `rate-limited`,
  `repeated-failures`, `account`, `storage`, `instance`; anything else gets a generic "Sending stopped by itself…".
- The engine brief's "number check unavailable (404/405) — say so in a state note" has **no field** in `Campaign`; if
  `engine` appends one (e.g. `note?: string` code), the Run view should show it — not drawn today.

Report — `reportCsv(c)` saved through the save panel and `invoke('export_write', { path, text })` (registered, absent
from the tool schema); `optOutPhones(msgs, campaignPhones)` + `addSuppressed`; filters all/sent/failed/unsure/skipped;
the first 400 rows drawn (the CSV has everyone). History — `loadCampaigns`, `deleteCampaign` (not while running),
"Use again" builds a new draft from a campaign. Do-not-contact — `loadSuppressed`, `addSuppressed([phone])` (typed,
normalised), `removeSuppressed`.

## Behaviour worth knowing

- Draft in `localStorage` `vylo.whatsapp.bulk.draft.v1` (text, message language, opt-out on/off and edited line,
  template id, business name, step, country, pace, campaign id, staged flag), read by `readWork`, which clamps each
  field on its own. **Never stored: consent** (ticked per broadcast) **and the attachment** (kept in module memory for
  the window's life). The test number lives in `vylo.whatsapp.bulk.me.v1`. *Start over* (press twice) clears words,
  people and attachment and keeps country, pace, language, opt-out and business name.
- After Send the draft gets a new campaign id, so editing never overwrites the campaign being sent.
- Keyboard: tabs move with arrows/Home/End (mirrored in RTL); drawers take focus, trap Tab, close on Escape (stopping
  the event so the panel's full-screen Escape does not also fire) and give focus back; a new step takes focus.
  `aria-live` on the People summary, the step notes and the run's "{sent} of {total} sent".
- Column: one step at a time, sticky header and Back/Next bar, no horizontal overflow at 248 px (checked in all 90
  shots), 44 px targets. Window: steps left, step centred (680 px), people + preview right; drawers are side sheets.

## Deviations

1. **File names**: the brief's `WhatsAppAudience.tsx` and `WhatsAppTemplates.tsx` are `WhatsAppPeople.tsx` and
   `WhatsAppReady.tsx` — on macOS's case-insensitive disk they collide with `whatsappaudience.ts`/`whatsapptemplates.ts`
   (TypeScript resolved `./WhatsAppAudience` to the `.ts`; esbuild resolves `./whatsappaudience` to the `.tsx`).
2. **CSS position**: the `wa:bulk` block is before `/* vm:ask start */`, not at the end, because `vm-ask.test.mjs`
   allows only `vm:*` blocks after its own (request 1 in `docs/wa/requests/ui.md`).
3. Review & send lives in `WhatsAppRun.tsx` with the run, report, history and the do-not-contact list.
4. Continue (after a halt or an interruption) is the second caller of `launch` — same gate as Send.
5. The do-not-contact manager also lets a number be added by hand (someone may ask by phone).

## Open problems

- Looked at in headless Chrome only, not in the app's WKWebView; the CSS uses `:has()` (consent highlight) and the
  placeholder reader uses regex look-behind — both in WebKit since Safari 16.4, worth a look in Wave 3.
- No DOM test runner in the repo (no jsdom), so keyboard and focus behaviour is checked by markup (roles, tabindex,
  aria) and by the pictures, not by simulated key presses.
- i18n merge risk: short keys such as `Message`, `Attach`, `Time`, `Place`, `Link`, `Preview`, `Report` are new here; if
  another package adds the same key, the catalogue test fails on a duplicate — keep one.
- Halted `account` still offers Continue (its sentence says not to until the number is linked again).
- Sorani and Badini need a native reader (`docs/wa/review-needed.md`).
