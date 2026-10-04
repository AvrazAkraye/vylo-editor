# Review: the sending engine (wave 3)

Branch `wa-r-engine`. An adversarial pass over `whatsappcampaign.ts`, `whatsappsend.ts`, `whatsappbulkstore.ts`, the
mock gateway, the screens that start a run (`WhatsAppRun.tsx` `launch`, `WhatsAppBroadcast.tsx`) and the assistant's
tools, against the six non-negotiables in `docs/WA.md`. **No real message was sent, no key was looked for, nothing but
127.0.0.1 was contacted.**

The checks are in `app/test/wa-review-engine.test.mjs` (184, last in `test:5`): the runner against the mock through
the real wire on a fake clock, the store on a fake IndexedDB that records each transaction's options, `launch` bundled
with the **real** engine behind it (only Tauri stubbed), the Run view drawn with react-dom/server. The mock gained one
reply, `'empty'` (201 with no body). Gates on the last commit: `npm test` (every lane), `npx tsc --noEmit`, `npm run build`.

## Defects found and fixed

| # | Severity | What was wrong | Fix (commit) |
|---|---|---|---|
| 1 | **High** | **A STOP reply was never put on the do-not-contact list by itself.** Only the report's "Add STOP replies" button did, after a run. WA.md's third non-negotiable and SAFETY ×4 said otherwise, and a STOP during a run was never honoured. | `addStopReplies(msgs)` in the store, called by `WhatsAppPanel.tsx` each time its messages refresh. It only acts on people a kept campaign is for (`optOutPhones`). Storage is read only for a new stop reply. A running campaign already re-reads the list before each send, and an end-to-end check proves the next message is skipped. (`c170693`) |
| 2 | Medium | **Pause then Resume skipped the rest of the batch break and of a 429 back-off.** Measured: a 600 s break became 7 s, and a 30 s back-off became 6 s. | The batch counter is reset only when the break finished. A back-off cut short is "owed" and served in full before anything else is sent. (`a8b4e59`) |
| 3 | Medium | **At 20,000 entries the do-not-contact list "stopped growing".** The next person who asked to stop was kept only for the session and messaged again after a restart. | No ceiling on opt-outs. `wa-engine-more`'s check that asserted the refusal now asserts the opt-out survives a restart. This is a corrected test, not a weakened one. (`968e1a9`) |
| 4 | Medium | **`isOptOut` missed common phrasings:** "STOP STOP", "please remove me from your list", "take me off the list", "don't message me", "do not contact me", Arabic لا ترسل / لا أريد رسائل / توقفوا / كفى, and Kurdish in Latin letters (raweste, rawestîne, nexwazim, westan). | Added the phrases. A word repeated in a row counts once, and politeness words are trimmed from the ends. The builder's false positives stay false. (`b01a17e`) |
| 5 | Low–Med | **The consent tick survived going back to step 1 and loading another list.** | The people setter clears it. (`1e8c329`) |
| 6 | Low | The campaign save before a send, an opt-out and the day's count used the default (possibly "relaxed") commit durability. A power cut could lose a save that had been reported done and leave a sent person `queued`. | `{ durability: 'strict' }` on those three writes. A browser that does not know the option ignores it. (`968e1a9`) |
| 7 | Low | `saveCampaign` said it built its records "before anything is awaited", but the outcomes map was shared until after the awaits. No caller mutates it during a save today. | The map is copied at the call. (`968e1a9`) |
| 8 | Low | `readCampaign`, on hand-edited records: 5,000 junk outcomes pushed out a recipient's `sent`. Two spellings of one number let a `queued` one win. When the key and the `phone` field disagreed, the outcome was filed under the wrong number. Each case re-queued someone already sent. | Recipients' own outcomes are always kept. "Something happened" beats `queued`. A disagreeing record counts for both numbers. (`968e1a9`) |
| 9 | Truth | SAFETY ×4 said "so that nobody is messaged twice". Two campaigns, or Use again, can message the same person. They also stated the STOP rule without its condition. | "so that no campaign messages anyone twice", and "read while the WhatsApp panel is open (`addStopReplies`)" in all four files. The rewritten Sorani/Badini and the new stop words are in `review-needed.md`. (`c170693`) |

## What held up (each has a check)

- **At most once.** One number written five ways is one send. A second `start()` is refused, and so are a cloned campaign with the same id and a second campaign on the same account. A crash in a new order also holds: the reply arrives, the `sent` save is refused, and the disk says `sending`. After that crash, recover or a plain resume gives `unknown` and never a second send. Continue after a 5xx halt never re-sends the unsure. `requeue` moves only `failed`/`unknown` and ignores `__proto__`.
- **Who starts.** `runCampaign(` and `runner.start()` appear only inside `launch`, and only Send and Continue call `launch`. Opening Broadcast recovers and shows; it never launches. The runner refuses `staged` (any truthy value), consent that is not `=== true`, no account, a pace under the floor, and an empty list, with zero requests.
- **The assistant's tool.** Given `consent`, `staged:false`, `state`, `pace`, `id`, `accountId`, `seed` and `outcomes`, `whatsapp_campaign` still saves a staged draft with consent false, the default pace and its own id, and that draft cannot be started. `launch` refuses, before any request: no account, no key, another account's campaign, consent false or `"true"`, problems, the day's cap used, and storage refusing. Two simultaneous Sends start one run, and the record is saved with consent kept and `staged` cleared before the first request.
- **Pace.** Every message waits at least the shortest delay, the first one too. The batch break is taken. A pause during a delay restarts it. `clampPace` holds against negatives, NaN, 1e9, strings, arrays and objects, and the six UI fields take `PACE_BOUNDS`.
- **Cap.** A cap of 10 across three campaigns on one account never exceeds 10 a local day. The same holds across midnight and with a clock thrown back a day. Around DST changes in Santiago, Havana (midnight transitions), Berlin and Baghdad, the wait always ends on the next local day.
- **Errors.** Every status class goes where the engine's table says: 400/401/403/404/405/408/409/413/429/500/502/503/504, a dropped connection, garbage, an empty body, no answer, an answer after the timeout, a 200 `exists:false`, and a 201 saying "logged out". Nothing that may have gone is ever sent again. The breaker resets on a success and not on a skip. A number check that vanishes (404) carries on with a note, and one that starts failing (500) halts. When everything fails, the run halts within 12 requests. A connection that flaps halts the run before the next message, and Continue finishes the rest once each. A halted Run view shows the reason beside Continue.
- **Messages.** No value is ever read as syntax. Names lose bidi overrides, isolates, controls and line breaks but keep emoji and ZWJ, and are cut to 120 characters without a split surrogate. The opt-out line is never cut off. The preview's default seed is what a seedless campaign sends. Attachments of 0 bytes, 16 MB exactly, 16 MB + 1 and a lying size field are all handled. Contact-card fields go out on one line each, and the CSV report neutralises formulas.

## Judgement calls and what remains (not changed in code)

- **Two app instances.** There is no single-instance plugin, so `open -n` would run a second process with its own in-memory locks. The second would recover the first's running campaign, and Continue could double-send. `tauri.conf.json` has one window and no code opens another. A reload is an interruption and is safe. Suggest `tauri-plugin-single-instance`.
- **STOP coverage.** A `@lid` sender with no `remoteJidAlt` cannot be tied to a number. Replies are read only while the panel is open and only within its newest 200 messages; the runner may not poll (WA.md's endpoint list). Clearing the app's site data empties the list.
- **Continue.** It trusts a stored `consent: true`. A hand-edited record (paused or halted, even staged) continues with one press from a view that shows counts, not the message. The tool cannot produce one. Gating Continue on `started && !staged` would be cheap. Continue after `rate-limited` is not time-gated (its sentence says wait an hour), and Continue after `account` is allowed.
- **Cap and pace.** One number added as two accounts gets two locks and two day counts. A contact card or audio is two requests and can go one over the cap. Each Continue after a halt starts a fresh batch count.
- **Media captions.** No separate caption limit (the Cloud API's is 1,024; Evolution's is unknown). If it is refused, the first three become `unknown` and the run halts.
- **Smaller items.** A crash between `launch`'s save and `start()` leaves an unresumable `ready` record; it is harmless and Use again works. Only the first stuck `running` campaign is recovered per opening, and none while a run is held. "stop it 😂" from a friend on a list and "cancel" (a CTIA keyword) opt out; both err safe.
- **Docs.** `LIMITS.suppressed` now limits nothing; the types file is the integrator's. The README has no Broadcast paragraph to check. SAFETY's "stops by itself when the server refuses" is loose: one number's 400 does not stop it.

## For the owner, by hand, with your own number

1. *Send a test to myself* with text, then a photo, then a contact card. Each must arrive. If the gateway does not answer with `key.id`, everything becomes "unsure" and halts.
2. Run a three-person broadcast to phones you own. Mid-run, with the WhatsApp panel open, reply **STOP** from one phone. The next message to it must be skipped, and the number must appear in the do-not-contact list. Try it from a chat that shows as `@lid`.
3. During a batch break, press Pause then Resume. The break must start again.
4. Unlink the device mid-run. The run must stop with "not connected". Quit the app mid-run and reopen: you should see "Paused: the app closed…", and Continue must send no duplicates.
5. Send a photo with a caption longer than 1,024 characters, to yourself only.
