# Package `engine`: what was built

Branch `wa-engine`. The brief is `docs/wa/briefs/engine.md`; the non-negotiables are in `docs/WA.md`. This package is where
"ensure it's working" is proved — against a mock Evolution gateway, never against WhatsApp. **No real message was sent, no
key was looked for, nothing but 127.0.0.1 was contacted.**

## What exists

| File | What it is |
|---|---|
| `app/src/whatsappcampaign.ts` | Pure: rendering (variables, fallbacks, `[[a\|b]]`, escapes, opt-out line, cap), `validateCampaign`, `newCampaign`, `requeue`, pace (`clampPace`, `paceInBounds`, `capWarning`, `estimateSeconds`, `daysNeeded`), stop words (`isOptOut`, `optOutPhones`), `reportCsv`, `wirePhone`, `plainValue` |
| `app/src/whatsappsend.ts` | The runner (`runCampaign`), `realDeps`, `recover`, `sendTest`, `isRunning` |
| `app/src/whatsappbulkstore.ts` | IndexedDB `vylo-whatsapp-bulk` v1: audiences, campaigns, do-not-contact list, per-account per-day counts; the readers `readCampaign`, `readAudience` |
| `app/src/whatsappbulktypes.ts` | Appended under `// wa:engine`: `Campaign.seed?`, `Campaign.notes?` (interface merging), `HaltWhy` |
| `app/test/whatsapp-mock-server.mjs` | The mock gateway: the five endpoints, programmable failures, a delivery log. Also runs on its own (below) |
| `app/test/wa-engine.test.mjs` | The pure half — 240 checks |
| `app/test/wa-engine-more.test.mjs` | The store and `recover` — 107 checks |
| `app/test/wa-send.test.mjs` | The runner against the mock through the real wire — 131 checks |

478 checks in all. Gates on the final commit: `npm test` (every lane) green, `npx tsc --noEmit` clean, `npm run build` OK,
the orphans gate green.

## The API

### `whatsappcampaign.ts` (pure)

- `renderMessage(draft, recipient, seed = 0): string` — what that person is sent. `{name}`, `{first_name}`, `{any column}`
  (matched ignoring case, spaces, dots and dashes: `{Shop Name}` is `shop_name`), `{x|fallback}`, `{x|}` (empty on purpose),
  `[[a|b|c]]` (nestable, may hold variables), escapes `\{ \} \[[ \]] \|`. A brace that is not a variable stays as typed; a value
  is never read as syntax. An empty variable prints nothing and the space, comma-space or line it leaves is closed up — only
  around the gap, the author's own spacing is kept. Opt-out line after a blank line (`optOutText` or `OPT_OUT[lang]`), never
  twice. At most `LIMITS.messageChars`: the body gives way, never the opt-out line.
- **Bidi decision** (the brief asked): a name or value is stripped of controls, bidi embeddings/overrides/isolates and LRM/RLM/ALM
  (`plainValue`), and **wrapped in FSI…PDI (U+2068/U+2069) only when its script runs the other way from the message** (the
  message's direction is its first letter, else the language). That stops "Hi علي, your code 4521" from reordering the code; same-
  script names get nothing. Both marks are default-ignorable, so an old phone draws nothing for them. Not yet seen on a real phone.
- `variablesIn(text)`, `missingVars(draft, recipients, seed = 0)` — **only variables missing for someone**, counted by rendering each
  person with the seed, so a variable inside an alternative a person is not given is not counted against them.
- `validateCampaign(c, { sentToday })` → `Problem[]` with every code of the union; `over-daily-cap` only when today's cap is already
  used up (more people than today leaves is not a problem — `daysNeeded` says how many days).
- `newCampaign(...)` — consent false, state `draft`, pace clamped, people copied (a snapshot), a unique id.
- `requeue(c, phones)` — **the person's** "send again to these": only `failed`/`unknown` go back to `queued`. Nothing else ever does.
- `clampPace`, `paceInBounds`, `capWarning`, `estimateSeconds` (mean delay + 1.6 s typing per message + a batch pause between
  batches; no cap), `daysNeeded` (today counts as a day).
- `isOptOut(text)` — the whole reply, folded (case, punctuation, emoji, diacritics, Arabic and Kurdish letter variants), politeness
  words set aside, must be a stop phrase. ≤ 6 words, ≤ 60 characters. `optOutPhones(msgs, phones)` — incoming, people only, only
  campaign people.
- `reportCsv(c)` — `phone,name,standing,why,time` (ISO UTC), CRLF, RFC 4180 quoting, OWASP neutralising (`= + - @`, tab, CR, a
  space before them, and their full-width forms get a leading `'`). No key, no address, no message body.
- `wirePhone`, `plainValue` — the one definition of "a number" and "a plain value" every part uses.

### `whatsappsend.ts`

- `runCampaign(c, deps): Runner` — `start()` resolves with the campaign (done, stopped or halted; **a halt never throws**); it
  rejects only when it cannot start: already running, another campaign running on the same account, `staged: true`, or a
  `validateCampaign` problem other than `over-daily-cap`/`already-running`. A done or stopped campaign resolves at once.
  `pause()`, `resume()`, `stop()`, `on(fn)` (returns the unsubscribe), `current()` (a copy).
- `RunDeps` keeps every original field; `save` may now return `boolean` (`false` or a throw is a refusal — `saveCampaign` can be
  passed as it is). Added, optional: `suppressed`, `counted`, `timeoutMs` (90 s; +1 s per 64 KB of attachment), `deadline` (the
  request-timeout timer, kept apart from `sleep` so the pace can run on a fake clock while a request has real time), `locks`.
- `realDeps(conn, accountId = conn.id ?? conn.instance)` — transport `whatsappwire.ts` `callerFor(conn)` (the only network path),
  real timers, `saveCampaign`, `sentToday`/`countSent` for that account, `doNotContact`.
- `recover(c)` — every `sending` → `unknown` (`why: interrupted`), `running` → `paused`, note `interrupted`.
- `isRunning(campaignId)` — whether this process is sending it (call before `recover` on one stored as running).
- `sendTest(conn, phone, text, { attachment?, timeoutMs? })` → `'sent'` or `{ failed: word }` (`no-account`, `invalid-number`,
  `empty`, `auth`, `instance`, `rate-limited`, `invalid`, `timeout`, `network`, `unreadable`, `no-receipt`, `account`, `http-NNN`).

### `whatsappbulkstore.ts`

`loadCampaigns`, `saveCampaign` (→ boolean), `deleteCampaign`, `loadAudiences`, `saveAudience` (read again first), `deleteAudience`,
`loadSuppressed` (for drawing), **`doNotContact`** (for a runner: throws when the stored list cannot be read), `addSuppressed` and
`removeSuppressed` (now → boolean), `sentToday(accountId, now)`, **`countSent(accountId, at, n)`**, `readCampaign`, `readAudience`.

A campaign is two records written in one transaction: a small one (everything but the people and the attachment's data) and a
`payloads` one written only when the people or the data are new (by identity) — the runner saves twice a message, and rewriting
5,000 people and 16 MB each time would be gigabytes a day. Readers lean towards not sending: an unknown standing is `unknown`, an
unknown state is `paused`, consent is only `=== true`, the opt-out line is on unless stored off. Caps: 60 campaigns and 40
audiences (oldest go; never a running campaign, never the one being saved). **The do-not-contact list never forgets anyone:** it
has no ceiling (the engine review removed the 20,000 one, which kept the next opt-out only until a restart — see
`docs/wa/review-engine.md`), and a reply that is a stop word is added by `addStopReplies`, which the panel calls. Counts are per account per local day, kept two
weeks, and counted in memory too, so a refused write still counts while the app is open.

## The runner's state machine

```
draft/ready/paused/halted ──start()──▶ running ──▶ done      (everyone has a standing)
                                          │  ├──▶ stopped   (stop(); also stop() on a campaign not running)
                                          │  └──▶ halted    (halted: HaltWhy) ──start()──▶ running …
                                          └─pause()─▶ paused ─resume()─▶ running
```

Per person, in order: gate (pause/stop) → number check (50 at a time, only as the run reaches them) → the day's cap (counted
across campaigns; wait `daily-cap` until local midnight, state stays `running`) → the connection (again every batch and after any
failure) → batch pause → the delay (the first message waits too) → the do-not-contact list again → **save `sending`** → the
request(s) → save the outcome.

| Answer | Person | Run |
|---|---|---|
| 2xx with `key.id` | `sent` | streaks reset |
| 400 and other 4xx | `failed` (`invalid` / `http-NNN`) | 5 in a row → halt `repeated-failures` |
| 401/403 | back to `queued` | halt `auth` |
| 404/405 | back to `queued` | halt `instance` |
| 429 | back to `queued`, same person retried | wait 30 s, 60 s; the 3rd in a row → halt `rate-limited` |
| 5xx, 408, network, timeout, non-JSON, 2xx with no id | `unknown`, never retried | `stopAfterFailures` in a row → halt `repeated-failures` |
| a reply whose status words say banned/logged out | `unknown` | halt `account` |
| instance not `open` | — | halt `not-connected` |
| a save refused before a send | back to `queued` | halt `storage` |
| do-not-contact list or day's count unreadable | — | halt `storage` |

Halt words (`HaltWhy`): `not-connected`, `auth`, `instance`, `rate-limited`, `repeated-failures`, `account`, `storage` — the UI brief's
six plus `instance`. Notes (`Campaign.notes`): `number-check-unavailable`, `rate-limited`, `interrupted`.

## What the mock proves, and what only the real gateway can

**Proved, against the mock through the real `apiCall`:** nobody is messaged twice and nobody is left without a standing across
352 crashes (a save that throws, the process dying before and after each of 151 steps of a 20-person campaign, each restarted
from what the disk held); a pause and a stop at each of 33 awaits; every error class above, the breaker, a mid-run disconnect,
a request that never answers, an answer after the client gave up, a dropped connection, garbage, a 2xx with no id; the pace
(every gap within the bounds on the fake clock, batch pauses, the first message waiting); the cap over three days and across
campaigns; lazy number checks; stop words arriving mid-run; refused saves; two runners; 5,000 people over five fake days in ~70 ms;
request bodies in Evolution v2's documented shapes (the mock refuses anything else, and no test sent a malformed one).

**Assumed from Evolution API v2, to be confirmed with *Send a test to myself* to the owner's own number:** the `connectionState`
body (`{instance:{state:'open'}}`); the `whatsappNumbers` reply (`[{exists, jid, number}]`, and how a number is written back —
Brazil's ninth digit, for one); that every send answers 201 with `key.id` (if not, everyone becomes `unknown` and the breaker
halts after three — loud and safe, but it would need a fix); the media and contact bodies; a 16 MB upload's real time; and what
a banned or logged-out number answers. **`apiCall` throws `WireError(status)` without the body, so an error body that says
"banned" is invisible** — the engine sees a 4xx/5xx and the connection state, not the words. Whether WhatsApp delivers is beyond
any of this.

## Deviations from the brief and the placeholders

- `RunDeps.save` returns `void | boolean`; `addSuppressed`/`removeSuppressed` return `boolean`; `missingVars` returns only what is
  missing for someone and takes an optional seed; `sendTest` takes an optional fourth argument; `realDeps` an optional second.
  All compatible with code written against the placeholders.
- `start()` refuses a `staged` campaign: **the Send button must clear `staged`** (the person's press is what makes the assistant's
  draft a campaign). It also refuses a second campaign on the same account at once (two would halve the pace).
- `skipped-duplicate` is never produced: outcomes are keyed by number, so a number listed twice (in any spelling) is one person,
  sent once.
- A contact card or an audio file is two requests (the words, then the card/file); the person stands as one; if the first went
  and the second did not, they are `failed`/`unknown` with `why: partial-…` and never sent again. Audio goes through
  `/message/sendMedia` (`mediatype: audio`) because WA.md allows nothing else — it arrives as an audio file, not a voice note.
- A 429 back-off is announced as `wait` with `why: 'delay'` (the `RunEvent` union is shared and fixed) plus the `rate-limited` note.
- The day's count is incremented just before each request, so after a crash it is one high, never one low.
- The tests write the shared limits out (`whatsappbulktypes.ts` has no `.test-build` bundle and `package.json` is not this
  package's); `wa-engine.test.mjs` checks them against the engine's behaviour.

## Open problems

- The real-gateway assumptions above. The first real use should be one *Send a test* with text, one with a photo, one with a card.
- WhatsApp's caption limit for media is not enforced separately (the message limit is 3,800); a long caption on a photo is untested.
- `apiCall` cannot be aborted: a timed-out request may still deliver (that is why it is `unknown`) and holds its connection.
- The count is this machine's: messages sent from the phone or another install do not count against the cap.
- Timers in a hidden webview or a sleeping Mac run late — waits only ever get longer.
- Kurdish stop words are best effort and want a native reader: Sorani `وەستان`, `وەستێنە`, `ڕاگرە`, `نامەوێت`, `لابدە`, `بوەستە`;
  Badini `ڕاوەستە`, `نەخوازم`, `بەس`; Kurmanji Latin `dur`, `durdur`, `iptal`, `bes`; fillers `تکایە`, `سوپاس`, `نامەکان`, `ئێستا`, `spas`.
  (They are in code, not the catalogue, so they are listed here rather than in `review-needed.md`, which this package does not own.)

## What the integrator must mount where

1. **Send (Review step, the only caller of `runCampaign`):** `validateCampaign(c, { sentToday: await sentToday(account.id) })` must be
   empty and consent ticked; then `const ready = { ...c, staged: undefined }`, `runCampaign(ready, realDeps(account))`, kept at module
   level; `runner.on` drives the Run view (`state` copies, `wait` with `until` and `why`); `runner.current?.()` when the view remounts.
2. **On opening the Broadcast screen:** `loadCampaigns()`, and for each `c.state === 'running' && !isRunning(c.id)`:
   `saveCampaign(recover(c))` — it shows as paused, "it was interrupted", with *Continue* (a new runner, `start()`).
3. **Preview:** `renderMessage(c.message, r, c.seed ?? 0)` — the runner uses the same seed, so the preview is what is sent.
4. **Stop words:** wherever `WhatsAppPanel.tsx` refreshes messages: `addSuppressed(optOutPhones(msgs, phonesOfKeptCampaigns))`. The
   runner re-reads the list before every send. The audience step's "asked not to be messaged" count is `loadSuppressed()` +
   `excludeSuppressed`.
5. **Run view words:** the seven `HaltWhy`s and the three notes above; `requeue(c, phones)` behind "Send again to these" for
   `failed`/`unknown` (the person's decision, shown with the warning that an `unknown` may already have arrived).
6. **Report:** `reportCsv(c)` saved through the dialog. **Send a test:** `sendTest(account, ownNumber, renderMessage(c.message, first, c.seed ?? 0), { attachment })`.
7. **Assistant tool:** `newCampaign({ …, staged: true })` + `saveCampaign` — consent is false and `start()` refuses `staged`; it can never send.
8. **The Run view against the mock:** `cd app && node test/whatsapp-mock-server.mjs` (or `PORT=8787 …`, `NOT_ON_WHATSAPP=964…,964…`)
   prints the address, key (`test-key`) and instance (`shop`); add it as an account. The app's CSP already allows
   `http://127.0.0.1:*`, and the mock answers CORS. Use a pace with the shortest delays to watch a run; nothing reaches WhatsApp.
