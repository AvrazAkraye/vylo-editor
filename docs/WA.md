# WhatsApp, made pro: broadcasts, audiences, ready messages, an AI that writes them

Branch `wa`, from `vm` (which is `main` at 0.133.0 plus the Video-holds-Motion and Ask-researches work). The owner's
words, 2026-10-04: *"i want like i can send message also bulk messages on whatsapp module and ensure its working also i
can load txt numbers or anything and send, edit the otp module and make it more pro and make the design more nicer and
also ensure there is a lot of promotional ready text ready that can be sent, like the ai will generate a nice promotional
message and so on to send it to what app as ready template, like i can tell the ai send the message x to the users and i
can attach files for contact and so on"*.

How this plan reads them (decided here; the owner does not want questions):

- **"the otp module"** is the WhatsApp module. The app has no other OTP code: "OTP line" is a label for an account on
  `wa.vylo-tech.com`, the gateway that also runs the ERP's OTP product. This work makes the WhatsApp module pro and **never
  touches that server, the ERP, or `/opt/*`**. (OTP-style templates — "your code is {code}" — are among the ready messages.)
- **"bulk messages ... load txt numbers or anything"**: an **audience** from a pasted list, a `.txt`, `.csv`, `.tsv`, `.vcf`
  (contacts), `.xlsx`, or the people already in the account's chats; any text with numbers in it works.
- **"ready template"**: a library of ready, translated promotional and service messages the person picks, fills and sends.
- **"the AI will generate a nice promotional message"**: *Write with AI* (describe the offer; get messages in the chosen
  language, edit, send).
- **"i can tell the AI send the message x to the users and attach files for contact"**: in the chat the person says it and
  attaches a contacts file; the assistant **prepares** the campaign (audience + message) and the person **presses Send**.
- **"ensure it's working"**: an engine tested end to end against a mock Evolution server (including failures), and a
  *Send a test to myself* button for the real thing. Nobody on this team has a key to the real gateway and nobody may use the
  owner's.

## The non-negotiables (this is a sending tool: it can hurt people and the owner's number)

1. **A human sends.** Nothing the model writes leaves the machine unless the person presses Send on a screen that shows
   *the exact message, the number of people, the pace and the time it will take*. The assistant's tool **stages** a campaign;
   it has no way to start one (`whatsapptool.ts` already says why a single send always asks; a thousand do not ask less).
   An unattended routine can never send.
2. **The list never goes to the model.** Numbers and names are read, kept and used on this machine. The assistant's tool
   returns counts and a few masked examples (`+964 750 *** 4567`), never the list. The Write-with-AI request carries the
   person's brief and nothing from an audience. SAFETY.md says so in four languages.
3. **Consent and opt-out.** A campaign cannot start until the person has ticked *everyone on this list agreed to hear from me*.
   Every promotional message can carry an opt-out line (on by default, translated); a reply that is a stop word (STOP, إيقاف,
   وەستان, …) puts the sender on a local **do-not-contact list** that every later campaign honours. No feature collects,
   guesses, generates or scrapes numbers.
4. **The pace protects the number.** Random delays (default 12 to 30 s), a pause every batch, a **daily cap** (default 200, up to
   1,000, with a plain warning above 300), numbers checked against WhatsApp first and skipped when not on it, **and a circuit
   breaker**: repeated failures, a disconnected instance, 401/403/429 or a "banned" answer halts the campaign and says why.
   Nothing here speeds a campaign up to hide the pace. Saying plainly that WhatsApp may block numbers that message people
   who did not ask is part of the product.
5. **At most once per person.** The state is persisted *before* each send. After a crash, a quit, a timeout or a lost reply, a
   send that may or may not have gone is **unknown** and is never retried by itself; the person sees it and decides. A
   campaign is resumable and **cannot message the same number twice**.
6. **Keys stay where they were typed.** All gateway traffic goes through `whatsappwire.ts` `apiCall`: one connection, one URL.

## The simplicity contract

- One new door: a **Broadcast** button in the WhatsApp panel's header. Everything else lives behind it. A person who never
  uses it sees the same chats, a nicer-looking panel, nothing more.
- Three steps, always the same: **1 People** → **2 Message** → **3 Review & send**; then a live **Run** view and a **Report**.
  Every step has one obvious next button and says what is wrong in one plain sentence.
- Ready messages are a picker inside step 2, not a place. *Write with AI* is one button next to it.
- No setting needed to start: sensible defaults for country, pace, language and opt-out line; the person's choices are remembered.
- Works in the 248 px column and full screen alike; four languages and right-to-left; keyboard from start to finish.

## Architecture (the contract the packages share)

Shared types live in `app/src/whatsappbulktypes.ts` (Phase 0). A package may **append** types and optional fields at the end under
a `// wa:<package>` comment; it may not change what is there.

| Layer | File(s) | What it is |
|---|---|---|
| Parsing | `whatsappaudience.ts`, `whatsappsheet.ts` | text/csv/tsv/vcf/xlsx/any text → `Parsed`; number normalisation (`normalisePhone`, `COUNTRIES`); masks; dedupe; columns |
| Engine (pure) | `whatsappcampaign.ts` | variables and spintax, validation, pacing, estimates, opt-out words, reports |
| Engine (runtime) | `whatsappsend.ts` | the runner: number check, send, retry rules, circuit breaker, persistence-before-send, pause/resume/stop |
| Storage | `whatsappbulkstore.ts` | IndexedDB `vylo-whatsapp-bulk`: audiences, campaigns, do-not-contact list; CSV report |
| Ready messages | `whatsapptemplates.ts` (+ `-a`, `-b` data) | categories, templates in `en`/`ar`/`ckb`/`kmr`, search |
| AI writer | `whatsappwrite.ts` | brief → messages (write / improve / translate / shorten / variants), JSON only |
| Assistant tools | `whatsapptool.ts` (additions) | `whatsapp_audience`, `whatsapp_campaign`: read a contacts file locally, stage a draft; never send |
| Interface | `WhatsAppBroadcast.tsx` (+ `WhatsAppAudience.tsx`, `WhatsAppCompose.tsx`, `WhatsAppRun.tsx`, `WhatsAppTemplates.tsx`) | the three steps, the run and the report |
| Design | `WhatsAppPanel.tsx`, `styles.css` (`wa:design`) | the existing panel made nicer; the Broadcast screens use the same language |

Gateway calls the engine makes (Evolution v2, via `apiCall`): `POST /chat/whatsappNumbers/{instance}` (`{numbers}`: which are on
WhatsApp), `POST /message/sendText/{instance}` (`{number, text, delay}` — `delay` is the "typing…" time in ms),
`/message/sendMedia/{instance}` (use `whatsappmedia.ts` `sendMediaPath`/`sendBody`), `POST /message/sendContact/{instance}`
(`{number, contact:[{fullName, wuid, phoneNumber}]}`), `GET /instance/connectionState/{instance}`. Nothing else.

## Ownership

| Package | Owns |
|---|---|
| `audience` | `whatsappaudience.ts`, `whatsappsheet.ts`, `test/wa-audience*.test.mjs`, `docs/wa/audience.md` |
| `engine` | `whatsappcampaign.ts`, `whatsappsend.ts`, `whatsappbulkstore.ts`, `test/whatsapp-mock-server.mjs`, `test/wa-engine*.test.mjs`, `docs/wa/engine.md` |
| `templates-a`, `templates-b` | `whatsapptemplates.ts` (the API: `templates-a` owns it), `whatsapptemplates-a.ts`, `whatsapptemplates-b.ts`, `test/wa-templates*.test.mjs`, `docs/wa/templates.md` |
| `writer` | `whatsappwrite.ts`, `test/wa-write*.test.mjs`, `docs/wa/writer.md` |
| `ui` | `WhatsAppBroadcast.tsx`, `WhatsAppAudience.tsx`, `WhatsAppCompose.tsx`, `WhatsAppRun.tsx`, `WhatsAppTemplates.tsx`, the CSS between `/* wa:bulk start */` and `/* wa:bulk end */`, `test/wa-ui*.test.mjs`, `docs/wa/ui.md` |
| `design` | `WhatsAppPanel.tsx` (after Phase 0's mount), the CSS between `/* wa:design start */` and `/* wa:design end */`, `docs/wa/design.md` |
| integrator | `whatsapptool.ts` tools, `agent`/`App` wiring, SAFETY ×4, README, `package.json`, `i18n.ts` merges, `whatsappbulktypes.ts` |

Shared by append only: `i18n.ts` (a `// wa <package>` comment at the end of each dictionary), `styles.css` (marked blocks),
`docs/wa/review-needed.md` (Sorani/Badini strings for a native reader; append your own section).

## Rules for every package

- **Stay in your lane.** A change elsewhere goes in `docs/wa/requests/<package>.md`; the integrator makes it. Never `git add -A`.
- **Never touch** `/Volumes/ExtremeSSD/apps/vylo-editor` (another session's uncommitted Video work), any other worktree,
  `/opt/*`, the owner's data, or the network. **There is no key to the real gateway and you must not look for one**: every
  test uses the injected transport or the mock server in `test/whatsapp-mock-server.mjs`. Nothing you write may send a real message.
- No `npm install`, no new dependency, no model-written code, no `ctx.filter`, no `<audio>` outside what WhatsApp already uses.
- **Match the house style**: long comments that say *why*; pure functions with injected effects; no `any`; every external value read
  through a reader that clamps; look at `whatsapp.ts` / `whatsapptool.ts` first.
- **i18n**: every visible word through `t('English sentence')`; `ar`, `ckb`, `kmr` entries at the end of each dictionary. Arabic must be
  good; Sorani and Badini best effort, listed in `docs/wa/review-needed.md`.
- **CSS**: your marked block at the end of `styles.css`; logical properties only (RTL); use the existing tokens; look at the
  `.wa-*` and `.sb-*` rules and at how `MotionPanel`'s CSS is built before inventing a look.
- **Tests**: `test/wa-*.test.mjs` import every export you add (the orphans gate counts tests as users); `ok(name, cond, detail)`, counts,
  exit 1. Fuzz the readers you write. Millisecond ceilings read `* SLOW` (top of `pro-perf.test.mjs`). Phase 0 already put your
  placeholder test in the fifth test lane (`npm run test:5`); do not edit `package.json`.
- **Gates before you finish:** `npm test`, `npx tsc --noEmit`, `npm run build`.
- **Commit** on your branch with `wa(<package>): …`, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push or merge.
- **Report** in under 400 words and write `docs/wa/<package>.md`: what exists, the API, test counts, deviations, open problems, what the
  integrator must mount where.

## How it comes together

1. Phase 0 (this commit): plan, briefs, shared types, stubs, the panel's Broadcast door, test lanes.
2. Wave 1: seven builders in parallel worktrees (audience, engine, templates-a, templates-b, writer, ui, design).
3. Wave 2 (integrator): merge by union; the assistant tools; SAFETY ×4 and README; wire the UI to the real engine; the Run view against the mock server.
4. Wave 3: adversarial reviews — the sending engine (abuse, bans, duplicates, crash safety), parsing and phone numbers across countries, the
   interface (four languages, RTL, keyboard, narrow and wide, the design), the assistant tools and prompt injection; whole-app check in the app's own WebKit.
5. Merge into the main tree and release only on the owner's word (with `vm`: 0.134.0 suggested).

## Not in this version

- Receiving and answering replies at scale; a CRM; scheduling a campaign for later (the app must be open to send); WhatsApp Business API
  templates and Meta-approved broadcasts (this drives the owner's own linked number through the gateway); groups; importing from Google Contacts.
