# Review: parsing and phone numbers (`wa-r-parse`)

Adversarial review of Broadcast's list reader: `app/src/whatsappaudience.ts`, `app/src/whatsappsheet.ts`, the People
step (`WhatsAppPeople.tsx`) and the assistant's `whatsapp_audience` (`whatsappbulktool.ts`), with `read_any_file`
(`app/src-tauri/src/lib.rs`, read only). The question each time: does a wrong number message a stranger, does a wrong
parse lose a customer, can a hostile file hurt the app?

Test: `app/test/wa-review-parse.test.mjs` (last in `test:5`), 451 assertions: fourteen countries' plans in 8 to 30
formats each, two-country guesses, a chat export and an invoice, RFC 4180 corners, six header languages, Outlook and
Google exports, vCard 2.1/3.0/4.0, workbooks built in the test (stored and deflated, shared and inline strings, floats,
dates, merged cells, hidden and several sheets, 100,000 rows, a 96 MB zip bomb that lies and one that tells the truth,
cuts, ZIP64, encrypted entries, OLE `.xls`, `.xlsm`, `.ods`, renamed files), seven encodings, 31 hostile patterns at
1 MB and 5 MB with ceilings, dedupe arithmetic, the tool against an injected file system, masks, the report CSV, and
the People step rendered.

## Findings

Severity: **High** = a stranger messaged or many customers lost; **Medium** = a count that lies, a name lost, data
to the model; **Low** = an edge. Every fixed one has a failing test first; commits are `wa(review-parse): …`.

| # | Sev. | Finding | Status |
|---|---|---|---|
| 1 | High | **A home number with one digit too many became a foreigner.** The "foreign number without +" rule read `75012345678` in an Iraqi list as +7 501 234 5678 (Kazakhstan/Russia), `77012345678`/`79123456789` likewise; `50512345678` in a Turkish list as Nicaragua, `93701234567` in an Iranian list as Afghanistan. Every Iraqi mobile written without its 0 plus one slip is a valid +7 number. | Fixed (0465f25): `homeTypo` — bare digits that start like a home mobile (or a home prefix with its own length) and are at most one digit longer are refused `too-long`. `447911123456`, `905321234567`, `12025550123` in an Iraqi list still read. |
| 2 | High | **North American numbers were not checked for shape.** Area code and exchange never start with 0 or 1, but `10100200150` (an IP), `17501234567`, `0123456789` (default 1) were accepted. | Fixed (0465f25): `Plan.shape` `^[2-9]..[2-9]`. One builder test used `(555) 123-4567` (exchange 123 does not exist); changed to `(202) 555-0123`. |
| 3 | High | **+7 had no shape:** no Russian or Kazakh number starts with 0, 1, 2 or 5; `+7 512…` was accepted. | Fixed (0465f25): `^[346789]`. |
| 4 | High | **A CSV number Excel rounded was rebuilt with zeros.** `MAX_PADDED = 2` read `7.5012345E+09` (Excel's display of 7501234567) as 9647501234500 and `9.6475012346E+12` as 9647501234600. Excel's CSV writes what it displays and General shows up to 11 digits whole, so any written-in zero is a rounding; a padded zero is right one time in ten. | Fixed (58050cf): `MAX_PADDED = 0`; rounded ones carry `excel-rounded`. Reverses a documented deviation; the builder's test that pinned `9.6475012345E+11` as `too-short` now pins `not-a-number`. Workbooks unaffected (their XML holds the exact double). |
| 5 | High | **Free text invented people.** In a chat export or an invoice: `04.10.2026 10:19` (a European export's timestamp) → 964410202610 via the trunk zero; `36.191113, 44.009167` → two Iraqi landlines; `172.16.254.100` → American; `Account: 0123 4567 8901 2345` → a person named "Account" (the split took eight digits from the middle); `Order 7501234567`, `ID 12345678901`, `Ref …`, `Barcode 6281234567890` (Indonesia), `25.000.000 IQD`, `$ 7501234567` → people. | Fixed (de9a2d7, 3952d5d): a leading date is cut off a run; IPv4, decimals and year spans are not numbers; a field label before (order, invoice, account, ref, id, total, price, barcode… in English, Arabic, Sorani, Turkish, Persian) or `$`/`#` vetoes all but a `+` number; a currency after vetoes a number that does not say it is a phone (so "0750 123 4567 Dinar" — a Kurdish name — still reads); split pieces must say they are phones by themselves; a vetoed number on a list line is *reported*, never dropped silently. |
| 6 | High | **One vCard without its END lost every card after it.** A BEGIN inside an open card was always "nested" (2.1 AGENT), so a 1,000-card export with card 500 cut kept 501 people. | Fixed (b417007): nested only right after an empty `AGENT:`; otherwise the open card is finished. |
| 7 | High | **A CSV whose first 300 rows had no valid number turned everyone away**: the Phone-headed column was ignored for lack of valid samples and the Name column became the phone column, so 40 good rows further down were all rejected. | Fixed (f5bbae4): the phone-worded column stands when nothing in the sample reads. |
| 8 | Medium | **Phone + Mobile columns:** `Name,Phone,Mobile` used the landline column and rejected as `empty` a row whose number was only under Mobile. | Fixed (f5bbae4): the phone-worded column with the most mobiles; per row, the other phone-worded columns when the cell is empty, wrong, or a landline beside a mobile (not when the person chose the column). |
| 9 | Medium | **A UTF-8 file with one stray byte became mojibake throughout** (strict decode failed → Windows-1256): every Arabic name and the header garbled, so every message would greet its reader with junk. | Fixed (e70ff28): a loose UTF-8 decode with ≥95% of non-ASCII intact is UTF-8; replacement marks are dropped from names. |
| 10 | Medium | **Outlook's contact CSV lost every name**: "Middle Name" (empty) was taken as the name column. A CRM's "Company Name" beat "Contact Name". | Fixed (40ac08e): middle/additional/company names are not the person's; of several name columns the filled one; first + last joined otherwise. |
| 11 | Medium | **The People step lied about counts and files.** "{n} couldn't be read" counted only the 1,000 listed lines (ignoring `rejectedMore`); `truncated` was never read (a file cut below 5,000 people said nothing); a password-protected workbook, an `.ods` or a renamed file showed "0 people · Line 1 · contacts.xlsx · Not a phone number" instead of a sentence; the `excel-rounded` hint was never shown. | Fixed (62bc2f4): `notReadCount`, `problemText`, `whyText(…, hint)`, a cut sentence. Five new sentences in ar/ckb/kmr (Sorani/Badini in `review-needed.md`). |
| 12 | Medium | **`whatsapp_audience` lied to the model the same way** (`notRead` = listed lines, no `truncated`, a locked file said only "No usable number was found"), so the assistant would report a 7,000-row file as fully read. | Fixed (3ac6999): true `notRead`, `truncated` + sentence, `problem` + a sentence to relay. |
| 13 | Medium | **`columns` sent a customer's data to the model** when a first row was taken for a header only because its number was mistyped (`Shilan Kareem,shilan@…,0750 12`). | Fixed (3ac6999): `headerKnown` — columns are echoed only when they are spreadsheet letters or a header this recognised by its words. **Decision:** a recognised header is the person's own labels, not anyone's data, and the model needs it to offer `{City}`; that is acceptable. An unrecognised one is not echoed. |
| 14 | Low | `makeAudience` dropped variables named `constructor`, `toString`… (`key in vars` sees Object.prototype), though the engine renders `{constructor}`. | Fixed (78adebb): own keys; `__proto__` refused. |
| 15 | Low | A ragged `.csv` (too few rows of one width) was read as free text: header, names and columns gone. | Fixed (83d81a8): a declared CSV falls back to its header row's delimiter. |
| 16 | Low | Egypt's Banha landlines (013 + 7) were refused as short mobiles. | Fixed (a48c4b3). |

### Not fixed (outside this package's files, or a judgement)

- **High — `read_any_file` with a model-chosen path** (`lib.rs`, read only here). Its own doc comment says it skips
  `resolve()` because "a path the user chose in a file dialog is the user's own reach"; `App.tsx` wires it to
  `whatsapp_audience`/`whatsapp_campaign`, where the *model* chooses the path. So the model can make the app read any
  `.txt/.csv/.tsv/.vcf/.xlsx` anywhere on disk (and attach any picture/document via `attachment_path` to a draft).
  What comes back is counts, three masked numbers and (now) only recognised headers, so little leaks — but the
  workspace containment every other model file tool has is bypassed. Recommend a `read_list_file` that goes through
  `resolve()` or accepts only paths the person attached in this chat.
- **Medium — `read_any_file` and special files.** It checks `is_dir()` and `md.len()`, never `is_file()`, and follows
  symlinks. A `contacts.csv` that is a symlink to `/dev/zero` (length 0) passes both and `fs::read` grows without end
  (the app dies of memory); a FIFO named `list.csv` blocks forever — and the command is a sync `fn`, which Tauri 2 runs
  on the main thread, so the whole window freezes. The size check is also time-of-check: a file growing between
  `metadata` and `read` is read past 16 MB. The UI drop/browse path has the same exposure (a symlink inside a
  downloaded archive). Recommend `File::open`, metadata from the handle, `is_file()`, `take(MAX + 1)`, and
  `#[tauri::command(async)]`. The extension gate (`LIST_FILE`) holds for `contacts.csv.exe`, a trailing dot,
  upper case (accepted), `/dev/zero` by name; a trailing space is trimmed before the read. `~` is not expanded (an
  error). Error text echoes only the path the model gave, but `No such file` vs `Permission denied` is an existence
  oracle.
- **Report CSV has no byte-order mark.** `reportCsv` is right on formulas (every cell, names and reasons, leading
  whitespace and full-width signs) and on RFC 4180 quoting, and plainValue strips overrides and line breaks — but Excel
  opens a BOM-less UTF-8 CSV in the system code page, so every Arabic or Kurdish name in the owner's report shows as
  mojibake. Recommend writing `'﻿' + reportCsv(c)` in `WhatsAppRun.tsx` (`csv()`), keeping `reportCsv` pure.
- **The foreign guess, residual.** Two typed extra digits on a 9-digit mobile (Saudi, UAE, Jordan, Syria) can still
  land in Central America (`50…` → +505); an EAN-13 barcode on a line of its own reads as China (`869…`) or
  Indonesia (`628…`). Prose never takes a foreign guess; a list line or a table does. The engine's WhatsApp check is the
  backstop. Removing the rule loses WhatsApp-form foreign numbers in lists; kept, with the typo guard.
- **Germany**, Excel-stripped landlines whose area code starts with 49 (`04931 …` → `4931…`) read as a different
  German number (the country-code reading wins); the `1:10-11` rule is wider than German mobiles (15/16/17).
- **Chat exports and consent.** Reading every number in a group chat export is what the brief asks; those people
  did not agree to hear from the shop. The consent tick covers it; the People step could say "these came from a chat".
- **Free text in prose** still takes a bare number shaped like a home mobile (`my order is 7501234567`): the brief's
  rule. The field-word veto now catches the labelled cases.
- Kept from the builder's list: workbook dates are serials in `vars`; only the first visible sheet is read (a list on
  sheet 2 is not offered); `atCeiling` says "Only the first 5,000" for a list of exactly 5,000 that was not cut;
  a 10 MB file of blank lines costs ~340 MB of transient heap in the vCard reader's `split` (bounded by the 10 MB cap,
  200 ms here); a name with a bidi override inside it on a pasted list line is not taken as a name (safe).

## What held up

Everything the hostile section throws: 31 patterns (digits, digits with 1–4 spaces, commas, dashes, dots, `+0`,
parentheses, Arabic-Indic digits, LRE, zero-width, `- `, words, quotes, `;`, tabs, BEGIN:VCARD, TEL lines,
quoted-printable soft breaks, year spans, dates, `#`, `$`) at 1 MB under 250 ms and at 5 MB under 1.25 s each; a 10 MB
line, a million blank lines, a megabyte of nested quotes; NUL bytes (never in a name; a number with one is refused);
bidi overrides and zero-width marks (gone from names, ignored in numbers); markup, `{name}`, `[[a|b]]` and formulas as
plain names; `__proto__`/`constructor`/`{x}` headers and 20 columns (no prototype touched, at most 12 variables).
Zip bombs (lying: refused at the first chunk; honest: refused before inflating; neither held the bytes), cut zips,
ZIP64, encrypted entries, OLE (encrypted `.xlsx` and `.xls` → `locked`), `.ods` → `not-a-sheet`, a renamed workbook
read as one. Encodings: UTF-8, BOM, UTF-16 LE/BE with BOM and LE without, Windows-1256 and -1254 (told apart even with
Iraq as default). Masks: never more than all but three national digits, nothing for under 7 or over 15. Dedupe:
the same person three ways is one; two names on one number is one message; people + duplicates + rejected +
rejectedMore = rows. `fromChats`: second devices are duplicates, `@lid` and groups never people.

## Numbering plans (source: the reviewer's knowledge of the ITU-T E.164 national plans; no network)

Checked and agreed with the builder: Iraq mobiles `7` + 9 (Korek 75x, Asiacell 77x, Zain 78x/79x — all of
750/751/770/771/772/780/781/782/790/791 read with no warning), Baghdad `1` + 7, governorates two digits + 6 or 7;
Türkiye 10 with mobiles 5xx; Iran 10 with mobiles 9xx; Syria mobiles 9 + 8, landlines 8–9; Saudi mobiles 5 + 8;
UAE mobiles 5 + 8, landlines 8; Kuwait 8, no trunk; Jordan mobiles 7 + 8, landlines 8; Germany, Sweden, UK as written.
The builder's `74` and `76` Iraqi mobile prefixes (Itisaluna, Omnnea/Mobitel) I cannot confirm either; they only
decide a warning, so left.

Corrected:
- **North America (+1):** NSN must be `[2-9]XX[2-9]XXXXXX`.
- **+7:** NSN starts with 3, 4, 8, 9 (Russia) or 6, 7 (Kazakhstan); mobiles `9` (Russia) and `70, 74, 75, 76, 77`
  (Kazakhstan), so Moscow 495 and Almaty 727 now get the landline hint. The builder's doc said no warning was
  possible for +7; with two-digit prefixes it is.
- **Lebanon:** mobiles `3` (7 digits) and `70, 71, 76, 78, 79, 81` (8 digits); Beirut `1` now gets the landline hint.
- **Egypt:** mobiles `10, 11, 12, 15` + 8 named one by one, so 013 (Banha) landlines of 9 digits read.

## What the owner should try by hand (with their own lists)

1. A real Excel customer list saved as **CSV** from Arabic Windows Excel, with the phone column left as General:
   the numbers Excel showed as `9.6475E+12` must now be refused with the Excel hint (format the column as Text).
2. The same list saved as **.xlsx**: everyone reads, numbers exact.
3. An **Outlook** and a **Google Contacts** export, and an iPhone/Android **.vcf** of a few hundred contacts.
4. A **WhatsApp chat export** (`.txt`) from a phone set to German or Turkish (dates with dots) — only real numbers.
5. A password-protected `.xlsx` and an old `.xls`: a sentence saying what to do, nobody listed.
6. In the chat, "make a list from ~/Desktop/contacts.csv": the count, three masked numbers, and the column names
   only when they are real headers.
