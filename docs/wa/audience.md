# Package `audience`: reading a list of people from anything

Branch `wa-audience`. Brief: `docs/wa/briefs/audience.md`. This is the parsing half of bulk messaging: pasted text,
`.txt`, `.csv`, `.tsv`, `.vcf`, `.xlsx` and the people in the account's chats become a `Parsed` list of `Recipient`s
(digits-only international numbers, country code first, no `+`), with rejected lines and their reasons, duplicates
counted, and hostile files survived. No library, no network, no model.

## What exists

| File | What it is |
|---|---|
| `app/src/whatsappaudience.ts` | The readers, the number normaliser and its numbering plans, the country picker list, masks, `fromChats`, `excludeSuppressed`, `makeAudience`. |
| `app/src/whatsappsheet.ts` | The `.xlsx` reader: a zip central-directory reader, `DecompressionStream('deflate-raw')` with ceilings, a single-pass tag scanner, exact number expansion. |
| `app/src/whatsappbulktypes.ts` | Appended under `// wa:audience` by interface merging (the Phase 0 text is untouched): `Warned`, `FileProblem`, optional fields on `Parsed` and `Rejected`. |
| `app/test/wa-audience.test.mjs` | 162 golden assertions: every example in the brief, one golden input per format and encoding, Excel's float trap, vCard, xlsx (stored and deflated), chats, masks, lists. |
| `app/test/wa-audience-more.test.mjs` | 100 hostile assertions: headers in six languages and two scripts, zip bombs (honest and lying), cut and bit-flipped workbooks, locked/foreign/oversized files, every ceiling, speed, seeded fuzz (1,250 random inputs and 5,000 random number strings). |

Gates on this branch: `npm test` (whole chain, 16,008 passed, 0 failed, orphans clean), `npx tsc --noEmit`, `npm run build`.

## The API

```ts
// whatsappaudience.ts — the Phase 0 contract, unchanged
parseAudience(input: string | Uint8Array, o?: ParseOptions): Promise<Parsed>   // never throws
normalisePhone(raw: string, country: string): { phone: string } | { why: InvalidWhy }
COUNTRIES: readonly Country[]                 // 51 countries, Iraq first, names in en/ar/ckb/kmr, emoji flags
countryForLang(lang: Lang): string            // '964' for all four languages
fromChats(chats: readonly Chat[]): Parsed
excludeSuppressed(list, suppressed): { kept: Recipient[]; removed: number }
makeAudience(p: Parsed, name: string, now?: number): Audience
maskPhone(phone: string): string              // '+964 750 *** 4567'
// added
CALLING_CODES: readonly string[]              // every geographic calling code the normaliser knows (206)
countryOf(phone: string): string              // '9647501234567' → '964'; '' when unknown

// whatsappsheet.ts
readXlsx(bytes: Uint8Array): Promise<string[][]>   // the Phase 0 contract; rows[0] is row 1; throws SheetError
readSheet(bytes): Promise<{ rows: string[][]; cut: boolean }>
SheetError (.code: FileProblem), SHEET_LIMITS, expandNumber(text), isZip(bytes), isOle(bytes)
```

`ParseOptions`: `defaultCountry` (`'964'`, `'+964'` and `'00964'` all mean 964; default 964), `filename`, `mime`,
`phoneColumn`, `nameColumn`. The column overrides take a name from `Parsed.columns`; **`nameColumn: ''` means "no name
column"**; an override naming no column is ignored (the guess stands).

### What the UI and the integrator must know (fields appended to the Phase 0 types)

- `Parsed.truncated?: true` — reading stopped early: `LIMITS.recipients` (5,000) people, 200,000 lines, a line over 1M
  characters, or input over 10 MB. Say "only the first 5,000 were read".
- `Parsed.rejectedMore?: number` — rejected lines beyond the 1,000 listed in `rejected`. **"Couldn't be read" is
  `rejected.length + (rejectedMore ?? 0)`**, not `rejected.length`.
- `Parsed.warned?: Warned[]` (`{ line, phone, why: 'not-mobile' }`, at most 1,000) — numbers kept that are not shaped
  like a mobile in their country (an Iraqi landline, say). A gentle hint, never a rejection.
- `Parsed.problem?: FileProblem` — the whole file could not be read: `too-big`, `empty`, `binary` (a picture or PDF),
  `damaged`, `locked` (password-protected `.xlsx` or old `.xls`: "save it again as a plain .xlsx"), `not-a-sheet`,
  `cannot-inflate`. Then `recipients` is empty and `rejected` holds one line (`line: 1`, `raw` = the file name). The
  interface should turn `problem` into a sentence rather than show that line.
- `Parsed.file?: string` — the file name, cleaned. `makeAudience` copies it to `Audience.file` and uses it (without its
  extension) as the name when the given name is empty.
- `Rejected.hint?: 'excel-rounded'` — Excel wrote the number in short scientific form (`9.64751E+11`) and its last
  digits are gone; say "format the column as Text in Excel and save again".
- `format`: `vcf` and `xlsx` by what is inside (a pasted vCard is `vcf`; a workbook is told by its bytes); `csv`, `tsv`,
  `txt` by the file's name or MIME type; `text` for anything pasted. A pasted Excel selection is read as a table but
  stays `text`.
- Columns of a file with no header row are named by letter (`A`, `B`, …), and so are their variables.
- Variable keys are the header text, one line, at most 40 characters, without `{ } | [ ]`; a column literally called
  `name`, `first_name` or `phone` (any case) that is not the chosen column becomes `name 2` etc., so it can never shadow
  the engine's own `{name}`/`{first_name}`. Empty values are left out of `vars` (so the engine's `missingVars` sees a
  missing key). At most `LIMITS.columns` (12) variables, values at most 120 characters.

## How things are read (the rules, as implemented)

**Numbers** (`normalisePhone`): Arabic-Indic, Persian and full-width digits folded; spaces of every kind, `- . ( ) [ ] /`,
dashes, LRM/RLM, bidi embeddings and isolates, zero-width characters and the BOM dropped. Then, in order: `+…`/`00…`
(and `011…` when the default is `1`) is international; a trunk prefix (`0`; `8` for Russia/Kazakhstan; `06` Hungary;
`1` North America; `80,8,0` Belarus; `8,0` Lithuania) is dropped and the country added; a number already starting with
the country code is taken as is (also `964 0750…`, the trunk written after the code); a national number without its
trunk (Excel's dropped zero) gets the country; bare digits of 11+ that cannot be national but are a valid number of
another country with its code in front are taken as that (WhatsApp's own form in exported lists). A `0` straight after
an international code is dropped where that country's trunk is `0` (`+964 0750…`, `+44 (0)20…`). Otherwise rejected,
with the most telling reason (trunk reading, then country-code reading, then national).

**Excel's float trap**: `9.647501234567E+12`, `7.501234567E9`, `9647501234567.0` are expanded by string arithmetic
(`expandNumber`), never through a float. In a CSV, a scientific number that needs more than two zeros written in
(`9.64751E+11`) is refused with `hint: 'excel-rounded'`: Excel rounded it for display and rebuilding it would message
whoever owns `964751000000`. In an `.xlsx` the stored double is exact, so its expansion is always taken.

**Free text** (a paste or `.txt` with no table shape): a single hand-written pass finds phone-like runs (a `+` or digit,
digits with at most three separators between groups; a run glued to a letter is an identifier; `2024-05-01`-style dates
and anything with `/` or `:` are not runs). A *list line* holds only numbers, punctuation, and at most a short run of
words on one side (`Rebaz, 0750…`, `0750… - Rebaz`): its numbers are taken, its failures reported, and the words become
the name (not when they are a field word such as "Phone:" or "رقم"). Any other line is *prose*: a number is taken only
when it says it is one (`+`/`00`, a trunk zero, the country code, or a mobile's shape at home) and nothing is named or
reported. A run too long for one number with spaces in it (`07501234567 07701234567`) is split into the numbers in it.
A line that is only five or six digits is reported as too short.

**Tables** (`.csv`, `.tsv`, a pasted selection, a workbook's first visible sheet): RFC 4180 (quotes, doubled quotes,
embedded line breaks; a quote that never closes is re-read as a plain character so it cannot swallow the file).
Delimiter (`, ; tab |`) by looking. Header: the first of the first ten rows naming a phone column (rows above are a title),
else one naming any known column, else a first row with no number when the rows under it have numbers; a row holding a
valid number is never the header. Header words in English, Arabic, Sorani, Badini (Arabic script and Latin Kurmanji),
Turkish and Persian, plus German/Swedish/French, matched as whole words after folding (`ة/ه/ە`, `ي/ى/ی/ێ`, `ك/ک`,
diacritics, `İ/ı`, the Arabic article and Kurdish izafe endings). Phone column: a phone-worded header holding numbers,
else the column with the most valid numbers. Name column: a name header, else a first + last name pair joined, else the
leftmost column that is mostly words. **One number per row**: the phone cell is read whole, else the first valid number
written in it (`Tel: 0750…`, `0750… / 0770…`). A header-less table with numbers in more than one column is a list laid
out in a grid and is read as free text (every number taken).

**vCard** (2.1, 3.0, 4.0): folded lines joined; quoted-printable with soft line breaks, in the `CHARSET` named (else UTF-8,
else Windows-1256, which old phones wrote Arabic in); groups (`item1.TEL` + `item1.X-ABLabel`), bare 2.1 parameters,
`TEL;VALUE=uri:tel:+…;ext=…`. Name: `FN`, else `N` as "given middle family", else `ORG`. **The TEL rule**: faxes and
pagers are dropped; the rest are ranked mobile first (`CELL`, `MOBILE`, `IPHONE`, `TEXT`, or a label saying mobile),
then `PREF`, then the rest; the first that reads is the person. Each further number of the same card becomes an extra
recipient with the same name only if it differs and is a mobile — shaped like one where the country's mobiles are known
(so an office landline never is), typed or labelled mobile where they are not — and at most two extras (three numbers
per card). A card with no number is rejected `empty` at its `BEGIN` line; a card whose numbers all fail is rejected at
the first failing `TEL` line. A nested card (2.1 `AGENT`) is passed over; a file cut before its last `END:VCARD` keeps
that person.

**Encodings**: BOM (UTF-8, UTF-16 LE/BE); UTF-16 LE/BE without BOM told by where its NULs fall; strict UTF-8; else
Windows-1256 or Windows-1254, told apart by whether the high bytes sit inside ASCII words (Turkish) or beside each other
(Arabic), leaning to 1254 when the default country is 90. Text with more than 2% control characters, or a `%PDF`, is
`binary`.

**`.xlsx`**: `[Content_Types].xml` names the workbook (ordinary, macro-enabled, template), else the root relationships,
else `xl/workbook.xml`; the first visible worksheet; shared strings (rich text joined, phonetic guides dropped), inline
strings, a formula's saved value (never evaluated), booleans, errors as empty. Prefixed namespaces (`x:row`) read the
same. Macros, external links and every other part are never opened; DOCTYPE entities are never expanded.

**Chats** (`fromChats`): one-to-one chats whose jid is a phone (`isPhone`), number by `phoneOf` (device suffix dropped,
so a second device is a duplicate); never a group, a `@lid`, a broadcast. The number is WhatsApp's own, so it is only
checked to be 8–15 digits, not against a numbering plan (a table here being wrong must not refuse a real person). A chat
whose name is its number has no name.

**Hygiene**: dedupe by phone, first wins, the rest counted in `duplicates` (within one vCard, the same number twice is
not a duplicate). Names: one line, spaces collapsed, C0/C1 controls, bidi overrides and isolates, LRM/RLM, BOM and lone
surrogates removed, ZWNJ/ZWJ kept (Persian and Kurdish need them), at most 120 characters, and only when there is a
letter in it. `makeAudience` reads every recipient again (digits 7–15 starting 1–9, names and vars clamped, duplicates
dropped, capped) because a `Parsed` may come from anywhere, the assistant's tool included; its id is the time plus a
fingerprint of the numbers.

## Ceilings (all in the code, with the reason beside each)

Input 10 MB (text is cut at the last line break before it; a workbook over it is `too-big`); 200,000 lines; a line
1M characters; a field 4,096; 256 columns; 5,000 recipients; 1,000 rejected and 1,000 warned listed. Workbook: one part
inflated 24 MB, all parts 48 MB, 10,000 zip entries, 50,000 rows, 256 columns, 400,000 cells and shared strings, 1,000
characters a cell. A part is inflated a chunk at a time and stopped past the *smaller* of its claimed size and the
ceiling, so a bomb that lies about its size is caught at its first chunk and one that tells the truth is refused before
inflating; nothing is ever allocated from a size the file claims. Every pattern is anchored or bounded; the free-text
reader and the label trim are hand-written scans (an earlier `/[…]+$/` trim was quadratic on a long run of dashes and was
replaced). Measured here: 5,000 lines of text ~11 ms, 5,000 CSV rows ~9 ms, 5,000 vCards ~45 ms, 5,000 workbook rows
~16 ms; 5 MB of zeros 5 ms, a 5 MB unclosed quote ~250 ms, a million `BEGIN:VCARD` ~180 ms.

## Deviations from the brief

- **The brief's 12-digit Excel examples.** `9.6475012345E+11` is recovered exactly as `964750123450`, and
  `964750123456` stays itself, but both are one digit short of an Iraqi mobile (`964` + 10 digits) and are then
  rejected `too-short`. The tests use real 13-digit numbers (`9.647501234567E+12`) for the accepted cases and pin the
  12-digit ones as rejected.
- **A number Excel rounded in a CSV is refused** (`excel-rounded`) rather than rebuilt with zeros; at most two written-in
  zeros are accepted (`9.6475012345E+11`).
- **Extra exports**: `CALLING_CODES`, `countryOf` (the UI can use `countryOf` for a flag beside each number), and the
  sheet reader's `readSheet`/`SheetError`/`SHEET_LIMITS`/`expandNumber`/`isZip`/`isOle`.
- **One number per table row**, by design (a row is one person); the vCard rule above is the one place a person may
  yield more than one recipient.

## Open problems

- **Dates in workbooks** come out as Excel serials (`45123`) in `vars`: styles are not read. Harmless for numbers; a
  `{birthday}` variable would read badly. `researchdata.ts` has the formatting logic if it is wanted.
- **`cannot-inflate`** is untested here: Node and the app's WebKit both have `DecompressionStream('deflate-raw')`.
- **The "foreign number without +" rule** (11+ bare digits that do not fit the default country but fit another with
  its code in front) is a judgement call. It is what makes lists exported from WhatsApp tools read, but a long garbage
  number that happens to fit some country's plan would be taken. The engine's WhatsApp check before sending is the
  backstop.
- **Free text is conservative**: `Rebaz0750…` (glued) and `Rebaz (Erbil) 0750…` read the number without a name;
  a sentence never names anyone.
- `Parsed.truncated` does not say *which* ceiling stopped it.

## What the integrator must mount where

- Nothing to wire inside this package. The `ui` package calls `parseAudience` (re-run with `phoneColumn`/`nameColumn`
  to remap), `fromChats(chats)`, `excludeSuppressed`, `makeAudience`, `maskPhone`, `COUNTRIES`, `countryForLang`.
- The UI must handle the appended fields above, especially `problem` (a sentence per code), `rejectedMore` in the
  count, `warned` as a soft hint, `truncated`, and `hint: 'excel-rounded'`.
- `whatsapptool.ts`'s `whatsapp_audience` should call `parseAudience` on the attached file locally and return counts,
  `problem`, and a few `maskPhone` examples — never `recipients` (non-negotiable 2).
- **A file's bytes must arrive as a `Uint8Array`.** A base64 string, or the `number[]` a Tauri `invoke` can return, is
  read as pasted text and finds nobody: wrap it (`new Uint8Array(arr)`, or decode the base64) before calling, and pass
  `filename` so `.csv`/`.tsv`/`.vcf` are read as what they are.
- `docs/wa/review-needed.md` did not exist on this branch and was created here with an `## audience` section; other
  packages will create it too, so the merge is a union of sections, not an append to one file.
- `docs/wa/review-needed.md` § audience: the Sorani and Badini country names for a native reader.

## Numbering plans: where I am sure and where I am not

(Superseded in part by `docs/wa/review-parse.md`: written-in zeros are no longer accepted from a CSV, +7 and Lebanon
have mobile prefixes, North America and +7 have a shape check, and the foreign rule refuses a home typo.)

Written from my knowledge of the ITU-T E.164 national plans; no source was consulted (no network). Lengths are of the
national significant number.

**Confident**: Iraq mobiles `7` + 9 digits (10) and Baghdad landlines `1` + 7 (8); Turkey 10; Iran 10; Saudi mobiles
`5` + 8 (9); UAE mobiles 9 and landlines 8; Kuwait, Qatar, Bahrain, Oman 8 with no trunk; Jordan mobiles `7` + 8 (9),
landlines 8; Egypt mobiles `1` + 9 (10); UK 10 (mobile `7`); US/Canada 10 with trunk `1`; France, Netherlands, Spain,
Switzerland, Australia, Poland 9; Norway, Denmark 8; Russia 10 with trunk `8`; India 10; Italy keeps its landline `0`.
Every calling code's assignment, and that the set is a prefix code (tested).

**Unsure — reviewers please check**:
- **Iraq**: landlines outside Baghdad accepted at 8 or 9 digits (two-digit area code + 6 or 7); I am not sure 8 occurs.
  Mobile prefixes treated as mobile: `74, 75, 76, 77, 78, 79`; `70–73` get the `not-mobile` warning. I am sure of 75
  (Korek), 77 (Asiacell), 78/79 (Zain); less sure of 74 and 76.
- **Syria** (landlines 8–9), **Lebanon** (7–8, no mobile warning: the `7` prefix is both), **Yemen** (landlines 7–8),
  **Palestine/Israel** (landlines 8–9).
- **Germany** (mobile `1` + 9–10, landlines 6–12), **Austria** (4–13), **Finland** (5–12), **Sweden** (7–10; mobile
  `70,72,73,76,79`), **Luxembourg** (4–11), **Belgium**, **Ireland**: deliberately generous ranges.
- **Mexico** 10–11 (the old mobile `1` after `52`), **Argentina** 10–11 (the mobile `9`), **Brazil** 10–11 (carrier
  selection codes not handled).
- **Lithuania** (trunk `8` or the newer `0`), **Belarus** (`80`), **Hungary** (`06`), **Côte d'Ivoire** and **Benin**
  (moved to 10 digits with a leading `0` kept), most of Africa, the Pacific and the Caribbean: lengths from memory.
- **Kazakhstan** shares `+7`; its mobiles start with `7`, so no mobile warning is given for `+7` at all.
