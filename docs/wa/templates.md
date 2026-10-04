# Ready messages (`whatsapptemplates*.ts`)

The library a shopkeeper picks from in step 2 of a broadcast: pick "Eid offers" or "Appointment reminder", fill two
blanks, send. Every message is written by hand in English, Arabic, Sorani (`ckb`) and Badini (`kmr`, Arabic script),
says nothing the sender did not fill in, and is held to that by tests. `templates-a` wrote the API and the first half;
`templates-b` writes the second half and appends its section below.

## templates-a

### What exists

| File | What |
|---|---|
| `app/src/whatsapptemplates.ts` | The API: categories, placeholders and their labels, tag words, lookup, search, filling. Merges both halves. |
| `app/src/whatsapptemplates-a.ts` | `TEMPLATES_A`: 47 messages in 13 categories, four languages each. |
| `app/test/wa-templates.test.mjs` | 260 checks: the content rules over `TEMPLATES_A`, the categories, the tables, the frozen library. |
| `app/test/wa-templates-more.test.mjs` | 116 checks: folding, search in four languages, ranking, filling, fuzz (5,000 cases), timing. |
| `docs/wa/review-needed.md` | The Sorani and Badini strings least sure of (section `templates-a`). |

### The API

```ts
CATEGORIES: readonly Category[]          // all 26, in the order a person looks for them; title in 4 languages; a distinct Icon.tsx name
categoryById(id: unknown): Category | undefined
TEMPLATES: readonly Template[]           // TEMPLATES_A then TEMPLATES_B, deep-frozen
TEMPLATE_LANGS: readonly Lang[]          // en, ar, ckb, kmr
templateById(id: string): Template | undefined
searchTemplates(query: string, lang: Lang, o?: { category?: CategoryId; kind?: TemplateKind }): Template[]
fillTemplate(t: Template, lang: Lang, values: Record<string, string>): string
PLACEHOLDERS: readonly string[]          // the 18 names a message may use, nothing else
PLACEHOLDER_TITLES: Record<string, Record<Lang, string>>   // the form's label for each blank
blanksOf(t): string[]                    // the blanks the sender fills: t.vars less {name}, in order
placeholdersIn(text: unknown): string[]  // the {…} left in a text, each once, in order (never {name|fallback})
TAG_WORDS: Record<string, Record<Lang, string>>            // a tag's words in each language, for search
foldForSearch(text: unknown): string     // the text as search compares it
```

- **Search** matches title, tags (and their `TAG_WORDS`), the category's title and the text, each in `lang` and in
  English. Placeholders are taken out of the text first, so "business" or "name" does not match every message. Every word
  of the query must be found; each word scores the best part it was found in — title 8, tag or category 4, text 2, plus 1
  where it starts a word — so every title hit is listed before any text-only hit. Ties keep category order, then library
  order (the empty search's order), so the list does not reshuffle while typing. An Arabic word also tries itself without
  ال; an English word without a plural s. When several words find nothing together, the messages with the most of them are
  listed. A non-string query is empty, an unknown language is English, a non-string filter is no filter, an unknown
  category or kind lists nothing; nothing throws.
- **Folding** composes (NFKC), drops harakat, Quranic marks, tatweel, ZWNJ/ZWJ and direction marks, lower-cases, strips
  Latin accents, and makes one letter of each family: أ إ آ ٱ → ا; ؤ ۆ → و; ي ى ێ → ی; ك → ک; ة ە ۀ ھ → ه; ڕ → ر;
  ڵ → ل; ڤ → ف; both Arabic-Indic digit sets → 0–9. ئ stays itself. Unlike `whatsappfind.ts`, the Kurdish letters are
  folded: a person on an Arabic keyboard types رۆژ for ڕۆژ, and in a library of a hundred messages recall matters more than
  the precision the inbox needs. The comment above `SAME` says why.
- **Filling** is one pass with a function: `$&` in a value goes in as typed, a value saying `{name}` is not filled again,
  only the values' own keys count (`{constructor}` is not filled from the prototype). A value is trimmed, loses C0 control
  characters except line breaks and tabs, and is cut to `LIMITS.messageChars`; an empty or non-string value is not a value,
  so the placeholder stays visible for the screen to mark as unfilled. `{name}` and anything not named are left for the engine.
- **Frozen**: `TEMPLATES`, each message's `title`, `text`, `vars`, `tags`, `CATEGORIES` and `PLACEHOLDERS` are frozen. A
  screen that wants to edit a message's text edits the string it got from `fillTemplate`, never the library.

### Categories and counts (first half)

| Category | Messages | Kinds | Covers |
|---|---|---|---|
| `sale` | 4 | promo | season sale, weekend offers, price drop, Eid offers |
| `new` | 3 | promo | new in store, new product, new service |
| `code` | 3 | promo | online promo code, thank-you code, code shown in store |
| `flash` | 3 | promo | today only, flash-sale announcement, last day |
| `restock` | 3 | promo | back in stock, new stock arrived, arriving soon (reserve) |
| `event` | 3 | promo | open day, workshop, meet us at the exhibition |
| `opening` | 3 | promo | grand opening, new branch, reopening |
| `appointment` | 4 | service ×3, promo | reminder, confirmed, openings this week, missed appointment |
| `followup` | 3 | service | after a purchase, after a visit, following up a quote |
| `review` | 3 | service | ask for a review, rate your order, thanks for a review |
| `loyalty` | 3 | service ×2, promo | points balance, members-only offer, points expiring |
| `birthday` | 3 | greeting ×2, promo | birthday gift, birthday wishes, birthday-month treat |
| `holiday` | 9 | greeting | Eid al-Fitr, Eid al-Adha, Ramadan, Newroz, New Year, Mother's Day, Teachers' Day, thank you, Christmas |
| **total** | **47** | 25 promo, 11 service, 11 greeting | shop, clothing, supermarket, online store, electronics, restaurant, cafe, salon, barber, clinic, school, training, real estate, services, exhibition |

The order of `CATEGORIES`: sale, new, flash, code, holiday, event, opening, restock, loyalty, referral, birthday, welcome,
cart, order, delivery, payment, appointment, followup, review, survey, food, property, course, health, notice, verify.

### How the messages are written (and tested)

- No digit in any numeral system, no %, no currency, no web address; no "free", "win", "guaranteed", cure or "only N
  left" in any language. Prices, dates, discounts and products are placeholders.
- `vars` is exactly the placeholders of each language, the four languages agree, and use only the brief's 18 names.
- Arabic, Sorani and Badini carry no Latin letter outside a placeholder, and no letter is glued to a placeholder.
  Arabic uses Arabic letters only; Sorani and Badini use ی and ک, never ي ك ة; Sorani has no ڤ or bare ل/ژ/د, Badini no
  ڵ, لە, ئەمڕۆ or ئێستا (the likeliest slip between two Kurdish texts side by side).
- At most three emoji, the same in all four languages, from an allow-list (no hand gestures, alcohol or pork); none in a
  `service` message or a title. No opt-out line in a promotion (the engine adds it). Bold balanced and sparing. Nothing
  over 700 characters; 9 in 10 under 400. At most six blanks for the sender.
- Arabic addresses people in the polite plural: the list does not say who is a man or a woman.

### Tests

`node test/wa-templates.test.mjs` — 260 passed. `node test/wa-templates-more.test.mjs` — 116 passed (1,000 searches in about
8 ms here; ceiling 600 ms `* SLOW`). Both are in `npm run test:5`.

### Deviations from the brief

- Exports beyond the brief's names: `categoryById`, `PLACEHOLDERS`, `PLACEHOLDER_TITLES`, `blanksOf`, `placeholdersIn`,
  `TAG_WORDS`, `foldForSearch`. Each is used by a test (the orphans gate) and meant for the screens.
- A ninth holiday, Christmas, beyond the brief's list: shops in Erbil, Duhok and Baghdad send it.
- Stricter than asked: no digits at all (not only in promotions), no emoji in service messages, every RTL comma is ،.
- `event-2` (workshop) has no fee line, to stay within six blanks; the sender adds a price to `{service}` or the text.
- The multi-word fallback (most words found) when no message has every word.
- `settings` is the one icon of the brief's list no category uses; no two categories share one.
- "Optional business sign-off" on the greetings means the person deletes the `{business}` line in the compose box if they
  want none; `fillTemplate` never drops text, so an unfilled `{business}` stays visible for the screen to flag.

### Open problems

- **Sorani and Badini need a native reader**: `docs/wa/review-needed.md` lists 50-odd strings and nine choices made across
  many messages (ئۆفەر, ژوان/ژڤان, the Badini "we look forward", هەمی مە vs هەمییێن مە, دیسان vs دیسا, ڕۆژبوون).
- Arabic broken plurals are not matched (عروض does not find عرض). Sorani definite suffixes are matched only when the query
  is the shorter form.
- Tags `templates-b` uses that are not in `TAG_WORDS` are searchable in English and through their category's title only;
  add their words there when merging.

### What the integrator mounts

- `WhatsAppTemplates.tsx` (ui): chips from `CATEGORIES` (`Icon name={c.icon}`, `c.title[lang]`); the list from
  `searchTemplates(query, lang, { category })`; for the picked message, one field per `blanksOf(t)` labelled
  `PLACEHOLDER_TITLES[k][lang]`; the draft text from `fillTemplate(t, lang, values)`; `placeholdersIn(text)` less `name` to mark
  what is still blank. `t.kind === 'promo'` is the case the opt-out line exists for.
- `whatsapptool.ts` / `whatsappwrite.ts` may offer `TEMPLATES` by id; nothing else needs wiring.
# Ready messages

<!-- templates-a writes the API and the first half above this line; the integrator joins the two sections. -->

## templates-b: the second half (`whatsapptemplates-b.ts`)

### What exists

`TEMPLATES_B: readonly Template[]`, the only export, merged by `whatsapptemplates.ts` after `TEMPLATES_A`. 52 templates in
the thirteen categories of the brief, each in English, Arabic, Sorani (`ckb`) and Badini (`kmr`, Arabic script):

| Category | Templates | Kind |
|---|---|---|
| `order` | received, confirmed, being prepared, ready for pickup | service |
| `delivery` | on its way, delivered, missed delivery, rescheduled | service |
| `payment` | invoice, payment received, friendly reminder, overdue invoice | service |
| `cart` | left something behind, still thinking it over, finish with a code | promo |
| `welcome` | new customer, new member, thanks for subscribing (greeting); welcome gift (promo) | greeting / promo |
| `course` | registration open (promo); class reminder, certificate ready, exam time (service) | promo / service |
| `health` | appointment reminder, check-up due, follow-up visit, results ready to collect | service |
| `property` | new listing, viewing invitation, price update, for rent | promo |
| `food` | today's menu, new dish, happy hour, catering for occasions, delivery now open | promo |
| `verify` | verification code, sign-in code, new sign-in alert, password change, booking confirmation code | service |
| `notice` | closed for the day, holiday hours, we have moved, planned maintenance, price change | service |
| `survey` | how did we do, short questionnaire, ask for a review | service |
| `referral` | bring a friend, share your code, introduce someone | promo |

32 service, 17 promo, 3 greeting. Ids run `order-1` … `referral-3`, contiguous per category. Tags are lowercase English words
(`restaurant`, `clinic`, `real-estate`, `otp`, …) so the search finds a template by the kind of business in any interface
language. Placeholders used: `name business code phone product price time address hours date link offer service place
old_price` (not `discount`, `points`, `days`).

### Decisions and deviations

- **No `{days}` for minutes.** The brief's OTP sample reads "It expires in {days} minutes". The screens will label that field
  *days*, and a person would type a number of days into a sentence about minutes. `verify-1` says "It is valid until
  {time}" instead; the others give no duration. If the integrator wants "expires in N minutes", the clean way is a
  `{minutes}` placeholder added to the allowed set (both packages' tests list the set).
- **`{code}` is also the order and invoice number** (`order-*`, `delivery-*`, `payment-*`): the allowed set has no
  `{order}`; the text around it ("Your order number: {code}", "invoice {code}") says what it is.
- **`survey` is `service`**: it goes to people who have just been customers and sells nothing. `course` splits: the
  registration advert is `promo`, the reminders, the certificate and the exam are `service`.
- **`welcome-4` (the welcome gift) is `promo`, not `greeting`.** It carries `{offer}` and `{code}`: a coupon is a promotion,
  and a `greeting` would go out without the opt-out line (WA.md rule 3). The other three welcomes are greetings, and the
  test holds that a greeting offers nothing.
- **Every `verify` text carries `{code}`**, including the sign-in alert and the password change, which the brief listed
  without one: the test the brief asks for requires it, and an alert with a code to confirm is the common real form. The
  do-not-share sentence is never under an "if" ("if it was not you, do not share…" would read as if sharing were fine
  otherwise); the test holds that too.
- **No emoji in `verify`, `notice`, `payment` or `health`** (the brief asked it for the first two; an emoji next to an amount
  owed or a clinic visit reads wrong). Bold (`*…*`) is used four times, on the headline of an advert.
- **"Happy hour"** is the English title only; Arabic says ساعات العروض and Kurdish says "offer hours", since the English phrase
  has a bar's meaning in the region.
- **A placeholder never takes a Kurdish suffix** (`{business}ـەوە`): sentences are turned so the filled value stands alone.

### Tests

`app/test/wa-templates-b.test.mjs`, in `npm run test:5`: **3,850 checks**, all on `TEMPLATES_B` (search and filling are the API's
and tested by `templates-a` over the merged list). Per template and language: the four titles and texts present and trimmed;
`vars` known, unrepeated, in English order and equal to the set each language uses; braces balance; ≤ 700 characters (at most a
tenth over 400; in fact none); no `http`; **no digit of any script and no `%`**, no English number words; no promise words
(win, guaranteed, cure, …); ≤ 3 emoji and the same emoji in all four languages; bold marks pair; no Latin letters, Latin
comma or question mark in the right-to-left texts; no Kurdish letters in Arabic and no ي ك ة ى or harakat in Kurdish; Sorani
and Badini are different texts. Per kind: every `verify` has `{code}` and the do-not-share sentence word for word in four
languages, never under an "if", and no emoji; a greeting offers nothing; payment texts never threaten and do not shout; clinic texts never diagnose or frighten; promos carry
no opt-out line and no false pressure; a cart has no deadline. A snapshot of the 52 ids; a fill with 120-character values
(the column limit) stays under 3,800 characters; a fuzz shows a value holding braces, bidi marks or emoji never becomes a
new placeholder. Twelve mutants, run by hand and not kept in the repository (an Arabic ي in Sorani, a Persian ک in Arabic, a missing `{price}`, a dropped
do-not-share sentence, Latin in Arabic, a different emoji, an Arabic-Indic digit, an emoji in a code, a frightening word in a
clinic text, a Latin comma, the welcome gift as a greeting, a conditional do-not-share) each fail the test.

### Open problems

- **Sorani and Badini need a native reader.** They follow the app's own vocabulary (`i18n.ts`) and are written as messages,
  not word-for-word translations, but they are best effort. The strings I am least sure of are in `docs/wa/review-needed.md`,
  most important first: the do-not-share sentence of every code message.
- The category titles and icons of these thirteen categories are in `CATEGORIES`, which `templates-a` writes.

### What the integrator mounts

Nothing: `whatsapptemplates.ts` already imports `TEMPLATES_B`, and the build and test lane already list both files. Join this
section with `templates-a`'s when merging (both branches create this file).
