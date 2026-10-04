# Package `audience`: reading a list of people from anything

Read `docs/WA.md` first (the idea, the non-negotiables, the rules). You own the parsing half.

## Why
The owner: *"i can load txt numbers or anything and send"* and *"attach files for contact"*. A shop owner has numbers in a
notes file, an Excel sheet, a phone export (`.vcf`), a pasted WhatsApp message, a CSV from a form. All of it must become a clean
list of people — without a library, without a network, and without ever trusting the file.

## You own
`app/src/whatsappaudience.ts` (replace the placeholder; keep every exported name and signature, add more), `app/src/whatsappsheet.ts`
(the `.xlsx` reader), `app/test/wa-audience.test.mjs`, `app/test/wa-audience-more.test.mjs`, `docs/wa/audience.md`, your i18n entries
(none are likely; the interface owns the words), and appended types in `whatsappbulktypes.ts` under `// wa:audience`.

## The contract (the screens are being built against these right now)
```ts
parseAudience(input: string | Uint8Array, o?: ParseOptions): Promise<Parsed>   // ParseOptions { defaultCountry?; filename?; mime?; phoneColumn?; nameColumn? }
normalisePhone(raw: string, country: string): { phone: string } | { why: InvalidWhy }
COUNTRIES: readonly Country[]            // the most likely first: Iraq, Turkey, Iran, Syria, Saudi Arabia, UAE, Kuwait, Jordan, Lebanon, Egypt, Qatar, Bahrain, Oman, Yemen, Germany, Sweden, UK, US/CA, ...
countryForLang(lang: Lang): string       // the calling code a person using this interface language most likely means ('964' for ar/ckb/kmr and en)
fromChats(chats: readonly Chat[]): Parsed
excludeSuppressed(list: readonly Recipient[], suppressed: ReadonlySet<string>): { kept; removed }
makeAudience(p: Parsed, name: string, now?: number): Audience
maskPhone(phone: string): string
readXlsx(bytes: Uint8Array): Promise<string[][]>      // whatsappsheet.ts
```
Types are in `whatsappbulktypes.ts` (`Parsed`, `Recipient`, `Rejected`, `InvalidWhy`, `SourceFormat`, `Audience`, `Country`, `LIMITS`). You may append
(for example `truncated?: boolean` on `Parsed`, a `Country.trunk`), not change.

## What "anything" means
- **Pasted text / `.txt`**: numbers separated by newlines, commas, semicolons, spaces or tabs; lines like `Rebaz, 0750 123 4567` or `0750 123 4567 - Rebaz`; a whole
  chat export or an email: when a text has no table shape, **find every phone-like sequence** and take the nearest word-run before it as the name only when it is
  obviously one line's label. Prefer a false negative to inventing a person.
- **`.csv` / `.tsv`**: RFC 4180 (quotes, doubled quotes, embedded newlines), a BOM, `,` `;` or tab detected by looking, a header row detected by looking (a first row that is
  not a number), headers in English, Arabic (`الاسم`, `رقم الهاتف`, `الجوال`, `موبايل`, `واتساب`), Sorani and Badini (`ناو`, `ژمارە`, `تەلەفۆن`, `مۆبایل`), Turkish
  (`telefon`, `ad`, `cep`) — guess the phone and name columns, let `phoneColumn`/`nameColumn` override, keep up to `LIMITS.columns` other columns as `vars` (trimmed, capped).
  **Encodings:** UTF-8, UTF-8 with BOM, UTF-16 LE/BE with BOM, and **Windows-1256 / Windows-1254** (what Excel's "CSV" export gives Arabic and Turkish) — try UTF-8 strictly first, then fall back (`TextDecoder` has `windows-1256`).
- **`.vcf`**: vCard 2.1 / 3.0 / 4.0; line folding; `QUOTED-PRINTABLE` and `CHARSET=`; `FN` else `N`; **every** `TEL` (a contact with two mobiles is two lines? — no: take the `CELL`/mobile
  first, then others as a second recipient only if it differs and is a valid mobile; document your rule); `X-ABLabel`; `item1.TEL`; a file with thousands of cards.
- **`.xlsx`**: `[Content_Types]`, `xl/workbook.xml`, `xl/sharedStrings.xml`, `xl/worksheets/sheet1.xml` (the first sheet; `inlineStr` too), **no library**: a zip central-directory
  reader plus `DecompressionStream('deflate-raw')`. **Excel stores long numbers as floats** (`9.6475012345E+11`, or `964750123456` with the leading zero gone, or `7.501234567E9`):
  recover them exactly, never round. Cap the inflated size (zip bombs), the number of cells and the file (10 MB). Ignore formulas, macros, external links.
- **From chats**: `fromChats(chats)` — the people in the account's conversations (`whatsapp.ts` `Chat`, `isPhone`, `phoneOf`): one-to-one chats with a real number only (never groups, never `@lid`).

## Numbers
Normalise to digits, country code first, no `+`: convert Arabic-Indic (`٠١٢`), Persian (`۰۱۲`) and full-width digits; strip spaces, dashes, dots, parentheses, `‎` marks; `+964…` and `00964…` are international;
a leading `0` is a trunk prefix to drop before adding the default country; a number already starting with the country code and long enough is taken as is. Examples that must work with the default `964`:
`0750 123 4567`, `+964 750 123 4567`, `00964 750 123 4567`, `750 123 4567` (Excel dropped the zero), `07501234567`, `٠٧٥٠١٢٣٤٥٦٧`, `(0750) 123-4567`. With `90`: `0532 123 45 67`. With `98`: `0912 345 6789`. With `966`: `050 123 4567`.
Use per-country national-number lengths (min/max) from your own knowledge of the numbering plans, and say in `docs/wa/audience.md` where you were unsure. Iraqi mobile prefixes (`75x`, `77x`, `78x`, `79x`, …) may add a *warning*, never a rejection.
**Reject with a reason, never guess:** too short, too long, not a number, unknown country. `Rejected.raw` is the offending text cut to `LIMITS.valueChars`.

## Hygiene
Dedupe by phone (the first row wins; count the rest in `duplicates`). Stop at `LIMITS.recipients` and say so (`truncated`). Names: trimmed, one line, control and bidi-override characters stripped, capped. `vars` keys: trimmed header text
(capped, no `{ } | [ ]`), values capped. A file is hostile: no `eval`, no regex that can backtrack catastrophically on 5 MB of `0000…`, no unbounded recursion, no allocation proportional to a claimed size. Decoding must never throw into the caller (return a `Parsed` with `rejected`).
Speed: 5,000 lines parse in well under a second; 50,000 lines of junk are cut off promptly.

## Tests (`* SLOW` on every millisecond ceiling)
A golden test per format (build an `.xlsx` in the test with a tiny stored-zip writer; the repo has zip code in `researchdocx.ts`/`slidespptx.ts` you may import), every example above, every encoding, Excel's float trap, zip bombs and truncated zips,
vCard folding and quoted-printable Arabic, header detection in six languages, a 5,000-line speed test, fuzz (random bytes, random UTF-8, random delimiters) with "never throws, every recipient valid, no duplicates, phones are digits only, ≤ limits".

## Not yours
The engine, the screens, the store, the do-not-contact list's storage (you only filter with a set you are given).
