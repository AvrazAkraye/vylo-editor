# Review: the words and the AI side of Broadcast (`wa-r-content`)

An adversarial pass over the ready-message library (`whatsapptemplates*.ts`), the writer (`whatsappwrite.ts`), the
assistant's tools (`whatsappbulktool.ts`, `whatsapptool.ts`, the Chat note in `agent.ts`) and what SAFETY says about
them. Every message was read in all four languages. Every finding below that says *fixed* has a failing check in
`app/test/wa-review-content.test.mjs` (265 checks, in `npm run test:5`) that the fix made pass. No model, key or
network was used: every request is a stub.

Gates on the branch after the last commit: `npm test` green, `npx tsc --noEmit` clean, `npm run build` green.

## Defects found and fixed

| # | Severity | What was wrong | Fix |
|---|---|---|---|
| 1 | **High** | With two WhatsApp numbers connected the approval line reads "WhatsApp from <account> to …". `auto.ts`'s refuse rule was `^whatsapp to `, so at auto-approve level `all` the agent's `whatsapp_send` went out **with no dialog**, and "Always allow" could trust it — against SAFETY's "asked at every auto-approve level". Predates this branch (0.131.0, multi-account). | `auto.ts`: `^whatsapp (?:from .+? )?to `. Tested with account names in four scripts, including "to" and a line break. |
| 2 | Medium | `whatsapp_audience` returned the file's column titles to the model: up to 256 × 40 characters of header text (an instruction fits as easily as a title), and for a file with no header the parser takes the first row as one — "Ahmed Ali, owes 500000 dinar, diabetic" reached the model. SAFETY promises counts and masked examples only. | It returns how many columns, never their words; the note says the person inserts columns on the Broadcast screen. |
| 3 | Medium | `whatsapp_campaign` staged a ready message with blanks nobody filled — and `whatsapp_templates` told the model to "leave one out". A staged draft opens on Review (step 3), where only `validateCampaign` runs (no blank check), and the engine sends an empty blank as nothing: **"Use the code \*\* at Shop for off your order. Valid until."** | A blank that is not `{name}`/`{first_name}`, a fallback, or a column of the list is refused, naming each; the tool notes say to ask the user. |
| 4 | Medium | Text, values and names the model passed kept direction overrides, Unicode tag letters, zero-width spaces, soft hyphens and controls — invisible at Review, sent to everyone (the engine keeps bidi marks in a person's own text by design). A value of `{code}` or `[[a\|b]]` became a blank or a coin toss. | Invisible letters and controls out (the two joiners kept), braces and `[[ ]]` out of values, in `whatsappbulktool.ts`. |
| 5 | Medium | The writer's reader looked for `javascript:`/`data:` before taking out zero-width letters, so `java<ZWSP>script:alert(1)` and `da<ZWSP>ta:text/html;base64,…` came back whole (also in the `said` sentence). | Invisible letters go first in `plain()` and `saidOf()`. |
| 6 | Medium | The facts check knew bare domains on 21 endings: an invented `secure-rafidain.xyz/login`, `bank-help.top`, `.ru`, `.de`, `promo.click` went through as written; `shop.co.uk` became `{link}.uk`. | The region's country endings and the cheap ones phishing uses (not ones that are English words: `in`, `is`, `it`, `no`, `win`, `date`…). |
| 7 | Low–Medium | No limit on drafts: 100 calls staged 100 drafts — 100 banners on the screen, and the store (60 campaigns) evicts the oldest non-running one, which can be a **paused** broadcast whose record is what stops a number being messaged twice. | At most five assistant drafts waiting per account (`STAGED_MAX`); `BulkDeps.loadCampaigns`, wired in `bulkDepsFor`. |
| 8 | Low–Medium | A promotion from the library staged with `opt_out: false` went without the opt-out line; the screen forces it on for a promo template. | Same rule in the tool; service messages may still go without. |
| 9 | Low–Medium | `birthday-1` was a `greeting` carrying `{offer}` and `{date}`: greetings go without the forced opt-out line (the reason `welcome-4` is a promo). | `kind: 'promo'`; `docs/wa/templates.md` counts updated. |
| 10 | Low | Unassigned tag-block code points (U+E0000, E0002…, E0080…) and runs of variation selectors (hex in FE0E/FE0F) went out in the brief and stayed in replies. | All of plane 14 out; a selector run cut to one. |
| 11 | Low | The writer's prompt refused impersonation, codes, threats, hate, adult content — not a rewrite "so it does not look like spam" / "avoid WhatsApp detection". | A rule against disguises (look-alike letters, spaced-out words, hidden characters), variants still allowed. |
| 12 | Low | `riskHints` flagged "If you won't be home…" as the money phrase "you won". | No apostrophe after a phrase. |
| 13 | Doc | SAFETY ×4 said a stop-word reply adds the person to the do-not-contact list; nothing does that by itself — the report's button does. Comments in `whatsapptool.ts`/`whatsappbulktool.ts` said an unattended routine can read WhatsApp or prepare a draft: it runs in Ask mode, offered no WhatsApp tool. The Badini broadcast paragraph used the Sorani letter ڵ (هەڵمەت، بەڵگەنامە). | Fixed in all four SAFETY files (identifiers unchanged) and both comments. |

## Language corrections made

- **Arabic** (sure): `cart-1` «متى كنت جاهزاً، يمكنك…» → «ويمكنك إتمام طلبك من هنا متى شئت»; `welcome-2` «بصفتك عضواً» →
  «وبعد انضمامك إلينا»; `survey-3` «نأمل أن تكون راضياً عن {service}» → «نأمل أن تكون تجربتك مع {service} في {business} قد نالت رضاك»
  (a list of men and women was told each reader is a man); `payment-4` «نتفهم أن هذا قد يفوت أحياناً» → «ونتفهّم أن مثل هذه
  الأمور قد تفوت أحياناً». A scan of all 794 Arabic words found no hamza, ta marbuta or alef maqsura error and no Latin leftover.
- **Badini** (sure): `payment-3` زۆر سوپاس → گەلەک سوپاس (Sorani "very"); `sale-1` زوی وەرە → زوو وەرە; SAFETY هەلمەت، بەلگەنامە.
- **Sorani/Badini** (best effort, listed): the stop-word sentence of SAFETY.ckb/kmr. Everything doubtful is in
  `docs/wa/review-needed.md`, section *review-content*.

## Judgement calls (not changed)

- **Arabic register.** templates-a addresses the reader in the polite plural on purpose; templates-b in the masculine
  singular (اتصل، رد، تعال، أحضر). Generic masculine is normal in service SMS, so only explicit gendered adjectives were fixed.
  Converting templates-b to the plural is a 52-message rewrite for the owner to choose.
- **`verify` in a broadcast.** The tool lets the model fill `{business}` and `{code}` once for everyone: one "verification
  code" from any name ("WhatsApp", a bank) to a whole list is the shape of an OTP scam. Recommended: the tool refuses a
  `verify` template unless `{code}` comes from a `code` column of the list.
- `verify-3` ("enter the code to confirm it was you") is real 2FA wording and also a scammer's script; `verify-5` says "show it
  when you arrive" beside "do not share" (the test requires the sentence). `payment-1` carries `{link}` ("view it here") —
  standard e-invoice, also the shape of a payment phish. `flash-3` "Last call"/«فرصة أخيرة» is urgency the sender's `{time}` makes
  true, but templates-b's rules ban "last chance".
- `variants` and `[[a|b]]` exist so not everyone receives the same text — variety the plan asks for, not a disguise.
- Without column names the model cannot write `{city}`; the person adds columns on the screen.

## What held up

The Chat note never says the model can send a broadcast and says the person presses Send; the loop refuses any tool a
turn did not offer, and an unattended routine (Ask) is offered no WhatsApp tool. `whatsapp_campaign` writes nothing but
draft/staged/un-consented, even given campaign-shaped arguments and a `__proto__` key; template ids like `__proto__` are
refused; `/etc/passwd`-like attachments fail the extension gate. A call naming account B makes B's draft. The writer's
request carries only the brief, message, business, language, tone and count on both wires — not recipients, phones, keys,
`toJSON`, symbols, getters or an inherited brief; the fence holds against role labels, fence markers, JSON and code fences;
a refusal reaches the screen as a plain sentence; every malformed reply is messages or `UNREADABLE_WRITING`. The library: no
`verify` asks for the code back, carries a link or phone, or lacks do-not-share in any language; nothing asks for a PIN or
card, says an account will close, names a bank in a payment, threatens over money owed, or frightens about health; no
holiday carries a date; the emoji are benign; no script slip in 396 texts.

## What remains

- A native Sorani and Badini reader, first the two-way spellings (code's gender, پشتراست/پشتڕاست, کریار/کڕیار, نامە/پەیام).
- Not checked as facts in a model's reply: e-mail addresses, look-alike (Cyrillic/Greek) letters inside Latin words, phone
  numbers written with dots (`0750.123.4567` — reading dots would turn `1.500.000` into `{phone}`), full-width dots in domains.
- The store's eviction (engine) can still push out a paused or halted campaign when the person keeps more than 60.
- The model may attach any document-type file on disk (a `.txt` in `~/.ssh`); it is named on the Send screen.
- Outside this part, `SAFETY.kmr.md` has ڵ in پاڵاڤتن، باڵانسێ، پاڵاڤ، پاڵ.
