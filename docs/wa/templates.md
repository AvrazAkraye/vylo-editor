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
| `welcome` | new customer, new member, thanks for subscribing, welcome gift | greeting |
| `course` | registration open (promo); class reminder, certificate ready, exam time (service) | promo / service |
| `health` | appointment reminder, check-up due, follow-up visit, results ready to collect | service |
| `property` | new listing, viewing invitation, price update, for rent | promo |
| `food` | today's menu, new dish, happy hour, catering for occasions, delivery now open | promo |
| `verify` | verification code, sign-in code, new sign-in alert, password change, booking confirmation code | service |
| `notice` | closed for the day, holiday hours, we have moved, planned maintenance, price change | service |
| `survey` | how did we do, short questionnaire, ask for a review | service |
| `referral` | bring a friend, share your code, introduce someone | promo |

32 service, 16 promo, 4 greeting. Ids run `order-1` … `referral-3`, contiguous per category. Tags are lowercase English words
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
- **Every `verify` text carries `{code}`**, including the sign-in alert and the password change, which the brief listed
  without one: the test the brief asks for requires it, and an alert with a code to confirm is the common real form.
- **No emoji in `verify`, `notice`, `payment` or `health`** (the brief asked it for the first two; an emoji next to an amount
  owed or a clinic visit reads wrong). Bold (`*…*`) is used four times, on the headline of an advert.
- **"Happy hour"** is the English title only; Arabic says ساعات العروض and Kurdish says "offer hours", since the English phrase
  has a bar's meaning in the region.
- **A placeholder never takes a Kurdish suffix** (`{business}ـەوە`): sentences are turned so the filled value stands alone.

### Tests

`app/test/wa-templates-b.test.mjs`, in `npm run test:5`: **3,838 checks**, all on `TEMPLATES_B` (search and filling are the API's
and tested by `templates-a` over the merged list). Per template and language: the four titles and texts present and trimmed;
`vars` known, unrepeated, in English order and equal to the set each language uses; braces balance; ≤ 700 characters (at most a
tenth over 400; in fact none); no `http`; **no digit of any script and no `%`**, no English number words; no promise words
(win, guaranteed, cure, …); ≤ 3 emoji and the same emoji in all four languages; bold marks pair; no Latin letters, Latin
comma or question mark in the right-to-left texts; no Kurdish letters in Arabic and no ي ك ة ى or harakat in Kurdish; Sorani
and Badini are different texts. Per kind: every `verify` has `{code}` and the do-not-share sentence word for word in four
languages and no emoji; payment texts never threaten and do not shout; clinic texts never diagnose or frighten; promos carry
no opt-out line and no false pressure; a cart has no deadline. A snapshot of the 52 ids; a fill with 120-character values
(the column limit) stays under 3,800 characters; a fuzz shows a value holding braces, bidi marks or emoji never becomes a
new placeholder. Ten hand-made mutants (an Arabic ي in Sorani, a Persian ک in Arabic, a missing `{price}`, a dropped
do-not-share sentence, Latin in Arabic, a different emoji, an Arabic-Indic digit, an emoji in a code, a frightening word in a
clinic text, a Latin comma) each fail the test.

### Open problems

- **Sorani and Badini need a native reader.** They follow the app's own vocabulary (`i18n.ts`) and are written as messages,
  not word-for-word translations, but they are best effort. The strings I am least sure of are in `docs/wa/review-needed.md`,
  most important first: the do-not-share sentence of every code message.
- The category titles and icons of these thirteen categories are in `CATEGORIES`, which `templates-a` writes.

### What the integrator mounts

Nothing: `whatsapptemplates.ts` already imports `TEMPLATES_B`, and the build and test lane already list both files. Join this
section with `templates-a`'s when merging (both branches create this file).
