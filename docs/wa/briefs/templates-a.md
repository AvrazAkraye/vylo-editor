# Package `templates-a`: the ready-message library, first half, and its API

Read `docs/WA.md` first. You write the API of the library and half of its content; `templates-b` writes the other half in `whatsapptemplates-b.ts`.

## Why
The owner: *"insure there is a lot of promotional ready text ready can be sent"*. A shop owner opens Broadcast, picks "Eid sale" or "Appointment reminder", fills two blanks and sends. The library is a product: it must
read like a person who knows the region wrote it, in four languages, and never promise what the sender cannot.

## You own
`app/src/whatsapptemplates.ts` (the API; replace the placeholder, keep every exported name and signature, add more), `app/src/whatsapptemplates-a.ts` (`TEMPLATES_A`), `app/test/wa-templates.test.mjs`, `app/test/wa-templates-more.test.mjs`,
`docs/wa/templates.md` (you write it; `templates-b` appends a section), your section of `docs/wa/review-needed.md`. `templates-b` owns `whatsapptemplates-b.ts` and does not touch your files.

## The API (the screens are built against these names)
```ts
CATEGORIES: readonly Category[]        // all 26 categories, in the order a person would look for them, each with a title in four languages and an Icon.tsx icon name from this list: file folder search chat memory settings plus check warning sparkle attach send star play flame calendar list grid clock link bolt image camera clipboard film person shield
TEMPLATES: readonly Template[]         // TEMPLATES_A then TEMPLATES_B
TEMPLATE_LANGS, templateById(id), searchTemplates(query, lang, {category?, kind?}), fillTemplate(t, lang, values)
```
`searchTemplates`: case-insensitive, diacritic-insensitive (Arabic harakat, alef/ya/kaf variants, Sorani/Badini letters ە ێ ڕ ڵ ۆ ڤ), matches title, text and tags *in the given language and in English*, ranks title hits above text hits, an empty query lists everything in category order, never throws on weird input.
`fillTemplate`: replaces `{business}`, `{offer}` and every other placeholder named in `values`, **and leaves the rest** (`{name}` and any column) for the engine to fill per person; an unfilled `{…}` stays visible so the screen can highlight it.

## The content you write: categories sale, new, code, flash, restock, event, opening, appointment, followup, review, loyalty, birthday, holiday (13 categories, **at least 3 templates each, ≥ 40 in all**)
Per template: `id` (`sale-1`…), `category`, `kind` (`promo` | `service` | `greeting`), `title`, `text`, `vars` (exactly the placeholders used, no more), `tags`, in **English, Arabic, Sorani (`ckb`) and Badini (`kmr`)**.
- **Placeholders** (use these names only): `{name}` `{business}` `{offer}` `{price}` `{old_price}` `{discount}` `{code}` `{date}` `{time}` `{place}` `{address}` `{link}` `{phone}` `{product}` `{service}` `{hours}` `{points}` `{days}`. The same set in all four languages of one template (a test enforces it).
- **Never invent facts**: no prices, percentages, dates or product claims in the text itself; they are placeholders the sender fills. No medical, legal or financial guarantees. No "win", "free money", "guaranteed". No pressure that is false ("only 3 left" unless `{…}` says so).
- **Length**: most under 400 characters, none over 700. One clear call to action. 0–3 emoji, tasteful and region-appropriate (no hand gestures that offend; no emoji in `verify`/`notice` type texts). Line breaks for readability. WhatsApp formatting (`*bold*`, `_italic_`) sparingly.
- **Tone by kind**: `promo` warm and short (the engine adds the opt-out line — do not write one); `greeting` sincere; `service` plain and exact.
- **Languages**: English natural and brief. Arabic: clear Modern Standard with a friendly register (not stiff, not dialect-bound), correct hamza/ta marbuta, numbers left to placeholders. Sorani and Badini: Arabic script as the app writes them (Badini is `kmr` in this app), natural phrasing, not word-for-word English; if you are unsure of a form, choose the simpler common word, and list your least-sure strings in `docs/wa/review-needed.md` for a native reader.
- Holidays: Eid al-Fitr, Eid al-Adha, Ramadan, Newroz, New Year, Mother's Day, Teachers' Day, a generic "thank you" — as `greeting`s with an optional business sign-off.
- Variety inside a category: different occasions and different kinds of business (shop, restaurant, clinic, school, salon, real estate, online store) — the `tags` carry them (`restaurant`, `salon`, …).

## Tests (>100 checks)
Every category has ≥ 3 templates; ids unique; every template has all four languages non-empty; `vars` equals the set of placeholders actually in each language's text and the four languages agree; only known placeholders; no unbalanced braces; no text over 700 characters; no placeholder-free promo that names a number; no `http`; RTL languages contain no stray Latin letters except placeholders/brand words and the allowed emoji; search finds a known Arabic and Sorani word with and without diacritics; `fillTemplate` leaves `{name}`; fuzz the search; the library is stable (a snapshot count so an accidental deletion fails).

## Not yours
`whatsapptemplates-b.ts` and its categories (order, verify, …); the screens; the engine's rendering of `{name|fallback}`/`[[a|b]]` (do not use that syntax in the library).
