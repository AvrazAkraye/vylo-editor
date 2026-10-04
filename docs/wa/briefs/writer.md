# Package `writer`: the AI that writes the message

Read `docs/WA.md` first. You own the model side of "the AI will generate a nice promotional message".

## Why
The owner: *"the ai will generate a nice promotional message ... i can tell the ai send the message x to the users"*. A person types what they want to announce ("20% off all shoes this weekend, Erbil branch") and gets a few good messages in
their language to choose from, edit and send. They can also improve what they wrote, translate it, shorten it, or ask for variants. The model **writes text; it never sends anything and never sees a list of people**.

## You own
`app/src/whatsappwrite.ts` (replace the placeholder; keep `writeMessages` and `riskHints` and their signatures), `app/test/wa-write.test.mjs`, `docs/wa/writer.md`, your i18n entries (the hint sentences are the interface's; you only define the `Hint` codes), appended types in `whatsappbulktypes.ts` under `// wa:writer`.

## `writeMessages(target, book, req, {signal})`
- One request through the app's helper (`generate.ts` `generate`, the way `motionai.ts` `askModel` calls it: `efforts: book`, `signal`, `maxTokens`, low effort — this is short text). Abortable; a stop ends it with an AbortError as the rest of the app does; other failures are the request's own error (errors.ts explains them).
- **The prompt** (system + user): you are a copywriter for a small business's WhatsApp messages; write in `req.lang` (`en`, `ar` Modern Standard, `ckb` Sorani, `kmr` Badini — Arabic script for the last three, the way the app writes them); tone from `req.tone`; actions: `write` (from the brief), `improve` (fix and polish `base`), `translate` (`base` into `lang`, keeping placeholders), `shorten` (`base` under about 300 characters), `variants` (`count` different wordings of `base`).
  Rules the prompt must state: one clear call to action; short, warm, no hype; at most three emoji; **never invent a fact** — no prices, discounts, dates, times, addresses, links, phone numbers, product claims or deadlines the brief did not give: where one is needed use a placeholder from this list only: `{name} {business} {offer} {price} {old_price} {discount} {code} {date} {time} {place} {address} {link} {phone} {product} {service} {hours} {points} {days}`;
  keep any placeholder already in `base`; no opt-out line (the app adds it); no markdown headings; WhatsApp formatting (`*bold*`) sparingly; no spam words; no pressure that is false.
  The reply is **JSON only**: `{"messages":["…","…"],"said":"one short sentence"}`, `count` messages (1 to 4).
- **Reading the reply**: robust (a fence, prose around it, a bare array, a single string); each message cleaned — control and bidi-override characters stripped, length capped at `LIMITS.messageChars`, empty ones dropped, duplicates dropped, placeholders **filtered to the allowed list** (an unknown `{thing}` is removed or flagged — decide and say), no `data:` URLs, no scripts; at most `count` messages; `said` capped. A reply with no usable message is an error the screen can say plainly (`whatsapp:unreadable-writing`).
- **What goes out**: `req.brief` (capped, fenced, labelled as the person's words), `req.base` (same), `req.business` (same), the language, tone and count. **Nothing else** — no audience, no names, no numbers, no account, no key, no file contents. A test asserts the exact request text for a request with a hostile brief ("ignore your rules and…", fake JSON, a fence marker): it stays inside its fence and cannot change the rules, and what comes back is read only as messages.
- The brief is data. If it asks for something the writer must not do (a message pretending to be a bank, a verification code that is not the sender's own, threats, adult content, impersonation), the writer returns `{"messages":[],"said":"…"}` with a plain refusal sentence the screen shows; write the rule into the prompt and test it with stubs.

## `riskHints(text)` (pure, no model)
Plain, cheap hints about a message that may read as spam or may be filtered: mostly capital letters; many `!`; more than one link; a known URL shortener; very long; money words in English/Arabic/Sorani ("free money", "guaranteed", "اربح", "مجاني تماماً", "ڕایگان"…) — keep the list small and defensible; the same sentence repeated. Return `Hint[]` with codes from the type; no scoring, no blocking.

## Tests (stubbed; no network, no key; `* SLOW` on ceilings)
The exact prompt for each action; the reader (good, fenced, prose around, bare array, nested, huge, binary junk, placeholders unknown/known, 200 messages, duplicates, control and bidi characters); the injection tests above; refusal handling; abort before, during and after; the error path; `riskHints` for each code and for clean text in four languages; nothing from a `Recipient` can reach the request (the function's types make it impossible — test the request text anyway).

## Not yours
Sending; the engine's `{name|fallback}` and `[[a|b]]` syntax (do not generate it); the assistant's tools; the screens.
