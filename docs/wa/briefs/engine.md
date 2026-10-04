# Package `engine`: sending safely, once, at a pace that protects the number

Read `docs/WA.md` first — especially **The non-negotiables**; this package is where they are enforced. You own the pure campaign
arithmetic, the runner, the storage and the mock gateway the whole feature is tested against.

## Why
The owner wants bulk messages on WhatsApp and wants to be sure it works. The danger is real: WhatsApp blocks numbers that send many
identical messages quickly or to people who did not ask, and a bug that sends twice, or keeps sending after the number is disconnected, hurts real people and the owner's number.
Reliability beats speed everywhere in this package.

## You own
`app/src/whatsappcampaign.ts` (pure), `app/src/whatsappsend.ts` (the runner), `app/src/whatsappbulkstore.ts` (IndexedDB), `app/test/whatsapp-mock-server.mjs`,
`app/test/wa-engine.test.mjs`, `app/test/wa-engine-more.test.mjs`, `app/test/wa-send.test.mjs`, `docs/wa/engine.md`, appended types in `whatsappbulktypes.ts` under `// wa:engine`.
Keep every exported name and signature in the placeholders (the screens are built against them); add more.

## The pure half (`whatsappcampaign.ts`)
- **`renderMessage(draft, recipient, seed)`**: `{name}`, `{first_name}` (first word of the name), `{any column}` from `vars`, `{name|fallback}` (the fallback when empty); `[[a|b|c]]` picks one alternative
  deterministically from `seed` and the recipient's phone, so a preview is exactly what is sent and two people get different wording; `\{` and `\[[` escape. An unknown variable with no fallback renders as an empty string
  and is reported by `missingVars` — it never prints `{city}` to a customer. Collapse the doubled spaces/blank lines an empty variable leaves. The opt-out line (`draft.optOut`; `OPT_OUT[lang]` or `draft.optOutText`) is appended after a blank line. Cap at `LIMITS.messageChars`.
  Names are plain text: strip control/bidi-override characters; consider wrapping an inserted name in directional isolates when its script differs from the message's, and say what you decided.
- **`validateCampaign(c, {sentToday})`** → `Problem[]`: no recipients, over `LIMITS.recipients`, empty message (text empty and no attachment), a message over the limit for any recipient, **no consent**, no account, an attachment over `LIMITS.attachmentBytes` or unreadable, a pace outside `PACE_BOUNDS`,
  more people than the daily cap allows *today* (not a block — `daysNeeded` tells the screen it will take several days; but `sentToday ≥ dailyCap` blocks starting now), already running.
- `newCampaign`, `clampPace` (clamp every field into `PACE_BOUNDS`, `maxDelaySec ≥ minDelaySec`), `paceInBounds`, `capWarning`, `estimateSeconds` (batch pauses included), `daysNeeded`.
- **Opt-out words**: `isOptOut(text)` — a message that *is* a stop request, after trimming punctuation, emoji and case: STOP, UNSUBSCRIBE, CANCEL, END, QUIT, NO MORE, `إيقاف`/`ايقاف`/`وقف`/`إلغاء`/`الغاء`/`إلغاء الاشتراك`, `وەستان`/`وەستێنە`/`ڕاگرە`/`نامەوێت`/`لابدە`, Badini `ڕاوەستە`/`نەخوازم`/`بەس`, `dur`/`durdur`/`iptal` — and **not** "don't stop", "please stop by tomorrow", or a long message that merely contains one. `optOutPhones(msgs, recipientPhones)`: the senders (`Msg.fromMe` false, `phoneOf(jid)`) among the campaign's people who sent such a message.
- `reportCsv(c)`: header + one row per person (phone, standing, why, time), **neutralising CSV injection** (a cell starting `= + - @ \t \r` gets a leading `'`), quoting correctly. No key, no body.

## The runner (`whatsappsend.ts`) — the contract is the placeholder's `RunDeps`/`Runner`
All effects are injected (`call`, `now`, `sleep`, `rnd`, `save`, `sentToday`); `realDeps(conn)` builds the real ones from `whatsappwire.ts` `callerFor(conn)` — **that is the only network path**.
Algorithm, in order, with the reasons:
1. **Pre-flight**: `GET /instance/connectionState/{instance}` must say open/connected, else halt `not-connected` before any message. Re-check every batch and after any failure.
2. **Number check**: `POST /chat/whatsappNumbers/{instance}` `{numbers:[…]}` in batches of 50 before sending; anyone `exists:false` is `skipped-not-on-whatsapp` (the cheapest way to protect the number). If this endpoint fails with 404/405, continue without it and say so in a state note; with 401/403/429/5xx, halt/back off by the rules below.
3. **Each send**, one at a time: re-read `state`; wait the random delay (`minDelaySec..maxDelaySec` with `rnd`) — **the first message also waits**; a longer pause after every `batchSize`; stop for the day at `dailyCap` (counting `sentToday()` across campaigns) and emit `wait: daily-cap` until the next local midnight rather than ending.
   **Before** the call: mark the person `sending`, `await save(c)`. After the answer: `sent` / `failed` / `unknown`, `await save(c)`.
   Text: `POST /message/sendText/{instance}` `{number, text, delay}` (`delay` = a typing time of about 800–2500 ms scaled to the text length when `pace.typing`). Media: `whatsappmedia.ts` `sendMediaPath` + `sendBody` (the text is the caption). Contact card: `POST /message/sendContact/{instance}`.
4. **Errors, by what they mean**: 400 → this person `failed:invalid` (go on, count as a failure *only* for the breaker if it repeats 5 times in a row); 401/403 → halt `auth`; 404 on the instance → halt `instance`; 429 → wait with doubling back-off (30 s, 60 s, 120 s…), and halt `rate-limited` after 3 in a row; 5xx, a network error, a timeout, an unreadable reply →
   the message **may have gone**: mark `unknown`, **never retry it by itself**, count toward the breaker; `stopAfterFailures` failures/unknowns in a row → halt `repeated-failures`. A reply that says the number is banned / logged out / not connected → halt `account`. Halting saves, emits, and **does not throw**.
5. **At most once**: a person with any standing but `queued` is never sent to again by this campaign, in this run or after a restart. `recover(c)` turns every `sending` into `unknown` and `running` into `paused`; resuming skips everything but `queued`. Two runners for one campaign are impossible (an in-memory lock; second `start()` rejects).
6. **Pause / resume / stop**: `pause()` takes effect before the next message and `resume()` continues; `stop()` ends it as `stopped`; sleeping wakes at once on any of them (abortable `sleep`). The runner emits `state` after every change and `wait` with the time it is waiting until.
7. **Suppression**: before each send, re-check the do-not-contact set (a stop word may have arrived mid-run): `skipped-opted-out`.
`sendTest(conn, phone, text)`: one message to the person's own number through the same wire; returns `'sent'` or `{failed: word}`; no campaign, no state.

## The store (`whatsappbulkstore.ts`)
IndexedDB `vylo-whatsapp-bulk`, versioned. Stores for audiences, campaigns, suppressed phones, and a per-account per-day sent counter (`sentToday(accountId, now)` — local calendar day; survives restarts and counts across campaigns). Everything read back goes through a reader that clamps (a record from a newer or older build or a hand-edited file may be anything); a record that is not one is left out. Caps from `LIMITS` (oldest audiences/campaigns beyond the cap go; a running campaign is never dropped). Writing an attachment of 16 MB must work; a refused write returns `false` and the runner treats a failed pre-send `save` as a halt (`storage`), not as permission to send. No keys, no gateway URLs stored.

## The mock gateway (`test/whatsapp-mock-server.mjs`)
A small Node `http` server speaking the endpoints above, started on a free port by a test, with programmable behaviour: numbers that are/are not on WhatsApp; the Nth request answers 429/500/401; a request that never answers (timeout); a request that answers after the client gave up; instance state `open`/`close`/`connecting`; media and contact bodies recorded; **every request recorded with its time** so a test can assert **no number is messaged twice** and the pace is respected (use the injected fake clock for the pace, the real wire for the shapes). Drive `runCampaign` through the real `apiCall` against it (`conn.baseUrl = http://127.0.0.1:PORT`).

## Tests (>150 checks; `* SLOW` on every ceiling)
Rendering (every syntax, escapes, fallbacks, spintax determinism, RTL names, 5,000 renders fast); validation (each problem); pace maths; opt-out words true and false positives in four languages; CSV injection;
the runner against the mock: the happy path with media and contact; non-WhatsApp numbers skipped; each error class; the breaker; the daily cap waiting then continuing the next day; pause/resume/stop at every await;
**crash safety**: make `save` throw / abort the runner at *every* step of a 20-person campaign, `recover`, resume, and assert from the mock's log that **no person received two messages and none was lost without a standing**; a lost reply after a delivered send becomes `unknown` and is not re-sent;
two runners; a 5,000-person campaign planned with a fake clock in well under a second; the store (round-trip, hostile records, caps, quota refusal).

## Not yours
Parsing files; the screens; the templates and writer; the assistant's tools (the integrator adds them over your store and renderer — keep `newCampaign`/`saveCampaign` simple to call).
