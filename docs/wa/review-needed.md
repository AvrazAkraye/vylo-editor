# Strings for a native reader

Each package appends its own section. Sorani (`ckb`) and Badini (`kmr`, Arabic script) are best effort.

## writer (`app/src/whatsappwrite.ts`)

Not shown to anyone as written: these are words the app **looks for**, so a wrong one only means a hint that never fires
(or fires on honest text). Please say whether each is how people really write it, and suggest better ones.

**Money words** (`MONEY_ARABIC_SCRIPT`, for the "money-words" hint — phrases that read as spam):

| Lang | Phrase | Meant as |
|---|---|---|
| ckb | پارەی ڕایگان | free money |
| ckb | بە تەواوی ڕایگان / تەواو ڕایگان | completely free |
| ckb | مسۆگەر | guaranteed |
| ckb | بردتەوە | you won |
| ckb | خەڵاتی پارە | cash prize |
| ckb | کلیک لێرە بکە | click here |
| ckb | پارەکەت دوو هێندە | double your money |
| kmr | پارێ بەلاش / پارەیێ بەلاش | free money (least sure) |
| kmr | تەمام بەلاش | completely free (least sure) |
| ar | اربح، ربح مضمون، أرباح مضمونة، مجاني تماماً، لقد فزت، فزت بجائزة، جائزة نقدية، اضغط هنا، ضاعف أموالك، أموال مجانية، مال مجاني | win, guaranteed profit, completely free, you won, cash prize, click here, double your money, free money |

"ڕایگان" alone (free) is deliberately **not** flagged: "گەیاندنی ڕایگان" (free delivery) is honest.

**Placeholder names** a model may write when it translates `{name}` and friends (`ALIASES`), read back as the list's:
`{ناو}`, `{ناوی}`, `{ناڤ}` → `{name}` · `{نرخ}` → `{price}` · `{داشکاندن}` → `{discount}` · `{کۆد}` → `{code}` ·
`{بەروار}` → `{date}` · `{کات}` → `{time}` · `{شوێن}` → `{place}` · `{ناونیشان}` → `{address}` · `{لینک}` → `{link}` ·
`{تەلەفۆن}` → `{phone}` · `{بەرهەم}` → `{product}` · `{خزمەتگوزاری}` → `{service}`.

**Currency and scale words** the facts check reads (`CURRENCY_AFTER`, `THOUSANDS`, `MILLIONS`): دینار، دیناری، دۆلار، دۆلاری،
هەزار، ملیۆن / ملیون; and `لەسەدا` / `لە سەدا` for "percent".
