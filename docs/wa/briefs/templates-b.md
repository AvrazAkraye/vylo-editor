# Package `templates-b`: the ready-message library, second half

Read `docs/WA.md` first, then `docs/wa/briefs/templates-a.md` — **its rules, placeholders, tone, languages and tests apply to you word for word**; only the categories differ. You write content only.

## You own
`app/src/whatsapptemplates-b.ts` (`TEMPLATES_B`, replace the placeholder; the data file `templates-a` merges), `app/test/wa-templates-b.test.mjs` (a placeholder is already in the test lane: replace it), your section of `docs/wa/templates.md`
(create the file with your heading if `templates-a` has not yet; the integrator joins the two), your section of `docs/wa/review-needed.md`. Do not edit `templates-a`'s files.

## Categories (13, **at least 3 templates each, ≥ 40 in all**)
`order` (order received / confirmed / being prepared), `delivery` (on its way / delivered / failed attempt, reschedule), `payment` (invoice / payment received / gentle reminder / overdue notice — polite, never threatening), `cart` (you left something behind — a single gentle nudge),
`welcome` (new customer / new member / thanks for subscribing), `course` (enrolment open / class reminder / certificate ready / exam times), `health` (clinic appointment reminder / check-up due / follow-up — **no diagnoses, no medical claims, no urgency that frightens**),
`property` (new listing / viewing invitation / price update — placeholders for everything factual), `food` (today's menu / new dish / happy hour / catering offer / delivery open), `verify` (**OTP-style**: "Your code is {code}. It expires in {days} minutes. Do not share it." — `kind: 'service'`, no emoji, no marketing; also login alert, password change notice, booking confirmation code),
`notice` (closing hours / holiday hours / address change / system maintenance / price change notice), `survey` (how did we do? / two-minute questionnaire / we'd love a review of the service), `referral` (bring a friend / refer and both get {offer}).
Ids `order-1`…; `kind` `service` for order/delivery/payment/verify/notice/health reminders, `promo` for cart/food/property/referral/course ads, `greeting` for welcome.

## Tests
Put in `app/test/wa-templates-b.test.mjs` the same checks as `templates-a`'s brief lists, applied to `TEMPLATES_B` only (import it from `../.test-build/whatsapptemplates-b.js` — the build entry exists because the main file imports it), plus: every `verify` template contains `{code}` and a "do not share" sentence in all four languages and no emoji; no template of yours mentions a deadline, price or percentage as a literal number.

## Not yours
The API file `whatsapptemplates.ts`, `whatsapptemplates-a.ts`, the first thirteen categories.
