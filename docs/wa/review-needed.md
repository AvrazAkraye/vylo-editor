# Strings for a native reader

Sorani (ckb) and Badini (kmr) text written by the WhatsApp broadcast packages, best effort, for a native speaker to
check. Each package appends its own section (docs/WA.md).

## audience

The country names of the picker (`COUNTRIES` in `app/src/whatsappaudience.ts`, the `ckb` and `kmr` fields). The
Arabic is meant to be the usual short names; the Kurdish ones were written from Sorani and Badini (Arabic script)
spelling as best this package knew it. Points to check in particular: whether Badini should use `ڵ`/`ۆ` (it is written
without them here: `ئەلمانیا`, `هولەندا`, `پولەندا`), Türkiye as `تورکیا`, and the two joined entries (US & Canada,
Russia & Kazakhstan), which stand for one calling code each.

| iso | English | Arabic | Sorani (ckb) | Badini (kmr) |
|---|---|---|---|---|
| IQ | Iraq | العراق | عێراق | عیراق |
| TR | Türkiye | تركيا | تورکیا | تورکیا |
| IR | Iran | إيران | ئێران | ئیران |
| SY | Syria | سوريا | سووریا | سووریا |
| SA | Saudi Arabia | السعودية | سعودیە | سعودیە |
| AE | United Arab Emirates | الإمارات | ئیمارات | ئیمارات |
| KW | Kuwait | الكويت | کوەیت | کوەیت |
| JO | Jordan | الأردن | ئوردن | ئوردن |
| LB | Lebanon | لبنان | لوبنان | لوبنان |
| EG | Egypt | مصر | میسر | میسر |
| QA | Qatar | قطر | قەتەر | قەتەر |
| BH | Bahrain | البحرين | بەحرەین | بەحرەین |
| OM | Oman | عُمان | عومان | عومان |
| YE | Yemen | اليمن | یەمەن | یەمەن |
| DE | Germany | ألمانيا | ئەڵمانیا | ئەلمانیا |
| SE | Sweden | السويد | سوید | سوید |
| GB | United Kingdom | المملكة المتحدة | بەریتانیا | بەریتانیا |
| US | United States & Canada | الولايات المتحدة وكندا | ئەمریکا و کەنەدا | ئەمریکا و کەنەدا |
| NL | Netherlands | هولندا | هۆڵەندا | هولەندا |
| FR | France | فرنسا | فەرەنسا | فەرەنسا |
| AT | Austria | النمسا | نەمسا | نەمسا |
| CH | Switzerland | سويسرا | سویسرا | سویسرا |
| NO | Norway | النرويج | نەرویج | نەرویج |
| DK | Denmark | الدنمارك | دانیمارک | دانیمارک |
| FI | Finland | فنلندا | فینلەندا | فینلەندا |
| BE | Belgium | بلجيكا | بەلجیکا | بەلجیکا |
| IT | Italy | إيطاليا | ئیتاڵیا | ئیتالیا |
| ES | Spain | إسبانيا | ئیسپانیا | ئیسپانیا |
| GR | Greece | اليونان | یۆنان | یونان |
| CY | Cyprus | قبرص | قوبرس | قوبرس |
| RU | Russia & Kazakhstan | روسيا وكازاخستان | ڕووسیا و کازاخستان | ڕووسیا و کازاخستان |
| AM | Armenia | أرمينيا | ئەرمەنستان | ئەرمەنستان |
| GE | Georgia | جورجيا | جۆرجیا | جۆرجیا |
| AZ | Azerbaijan | أذربيجان | ئازەربایجان | ئازەربایجان |
| PS | Palestine | فلسطين | فەلەستین | فەلەستین |
| LY | Libya | ليبيا | لیبیا | لیبیا |
| TN | Tunisia | تونس | تونس | تونس |
| DZ | Algeria | الجزائر | جەزائیر | جەزائیر |
| MA | Morocco | المغرب | مەغریب | مەغریب |
| SD | Sudan | السودان | سودان | سودان |
| AF | Afghanistan | أفغانستان | ئەفغانستان | ئەفغانستان |
| PK | Pakistan | باكستان | پاکستان | پاکستان |
| IN | India | الهند | هیندستان | هندستان |
| BD | Bangladesh | بنغلاديش | بەنگلادیش | بەنگلادیش |
| PH | Philippines | الفلبين | فلیپین | فلیپین |
| ID | Indonesia | إندونيسيا | ئیندۆنیزیا | ئیندونیزیا |
| AU | Australia | أستراليا | ئوسترالیا | ئوسترالیا |
| PL | Poland | بولندا | پۆڵەندا | پولەندا |
| UA | Ukraine | أوكرانيا | ئۆکرانیا | ئوکرانیا |
| CN | China | الصين | چین | چین |
| MY | Malaysia | ماليزيا | مالیزیا | مالیزیا |

The header words the reader recognises (`PHONE_WORDS`, `NAME_WORDS` and the first/last-name words in the same file) are
never shown to anyone, but a native reader may know common spellings that are missing: for Sorani `ژمارە`, `ژمارەی
تەلەفۆن`, `مۆبایل`, `ناو`, `ناوی تەواو`, `کڕیار`, `پاشناو`; for Badini `ژمارا`, `تەلەفون`, `موبایل`, `ناڤ`, `ناڤێ`,
`hejmar`, `hejmara telefonê`, `nav`, `navê`, `xerîdar`, `paşnav`.
Sorani (`ckb`) and Badini (`kmr`, Arabic script) strings the WhatsApp broadcast packages wrote as a careful best effort
and are least sure of. Each package appends its own section. A reader who fixes one should fix it in the file named,
keep every `{placeholder}` exactly as it is, and run `npm test` (the template tests check the placeholders, the letters
and the dialect of every text).

## templates-a

Files: `app/src/whatsapptemplates.ts` (category titles, placeholder labels, tag words) and `app/src/whatsapptemplates-a.ts`
(the messages). Arabic is written in a plural, gender-neutral register on purpose (احجزوا، بانتظاركم) and is believed good;
the doubts below are Kurdish.

### Choices made across many messages — confirm once

| What | Sorani as written | Badini as written | Doubt |
|---|---|---|---|
| "offer" | ئۆفەر | ئۆفەر (ئۆفەرا …) | A loanword shops use; is a native word better (پێشکەشکراو)? In Badini, is it ئۆفەرا (feminine) or ئۆفەرێ? |
| "appointment" | ژوان | ژڤان (ژڤانا تە) | Is ژوان / ژڤان what a clinic or salon writes, or نۆرە / مەوعید? Gender of ژڤان in Badini. |
| "book" (an appointment) | نۆرە گرتن, حیجزکردن | گرتنا نۆرێ, حیجزکرنێ | حیجز is a loan; acceptable in a shop's message? |
| "we look forward to seeing you" | چاوەڕێتانین | چاڤەڕێی هەوە دکەین | The Badini form especially. |
| "all of us" | هەموومان | هەمی مە and هەمییێن مە | Both Badini forms are used (birthday-1 vs review-3, holiday-2, holiday-8); which is right? |
| "again" | دووبارە | دیسان | The app elsewhere writes دیسا in Badini. |
| "birthday" | ڕۆژی لەدایکبوون | ڕۆژبوون | Or ڕۆژا ژدایکبوونێ in Badini? Used in the category title and birthday-1/2/3. |
| "minutes" | خولەک | خولەک | The app uses خولەک in Badini; some Badini speakers write دەقە. |
| loyalty "points" | خاڵ | خال | Is this how a points card is said? |

### Single strings

| id | Language | As written | Doubt |
|---|---|---|---|
| category `flash` | ckb / kmr | داشکاندنی خێرا / داشکاندنا بلەز | "Flash sale": is there a common shop phrase? |
| category `restock` | kmr | دیسان بەردەستە | "Back in stock". |
| category `loyalty` | ckb / kmr | خاڵ و کڕیاری بەردەوام / خال و کریارێن بەردەوام | Long for a chip. |
| category `cart` | ckb / kmr | سەبەتەی تەواونەکراو / سەبەتەیا نەتمام | "Left in the cart" (an online basket not checked out). |
| category `health` | kmr | کلینیک و ساخلەمی | Or نۆژدارخانە? |
| category `verify` | ckb / kmr | کۆدی پشتڕاستکردنەوە / کۆدێن پشتڕاستکرنێ | "Codes & security" (one-time codes). |
| category `referral` | ckb / kmr | ناساندنی هاوڕێ / ناساندنا هەڤالان | "Refer a friend". |
| label `business` | ckb / kmr | ناوی کار / ناڤێ کاری | "Business name" on the form; ناوی دوکان is narrower. |
| sale-2 | kmr | ئۆفەرێن دوماهیا هەفتیێ | "Weekend offers": هەفتی or حەفتی? |
| sale-3 | kmr | ل ڤێرە داخواز بکە | "Order here" (also restock-1). |
| new-1 | ckb | بە تازەیی گەیشتۆتە {business} | "Just in at …". |
| new-1 | kmr | بەرێ خۆ بدێ | "Take a look". |
| code-2 | kmr | ب ڤێ کۆدێ د سەرەدانا خۆ یا بێت دا {offer} وەردگری | "With this code you get … on your next visit". |
| flash-2 | ckb | ئەم کاتە لەبیر مەکە | "Save the date". |
| flash-3 | kmr | هێشتا دەم مایە | "There's still time". |
| restock-3 | ckb | بۆتی هەڵدەگرین | "We'll keep it aside for you". |
| event-1 | kmr | ئەم تە ڤەدخوینین | "You're invited". |
| event-3 | ckb / kmr | بەشی {business} / ستاندێ {business} | A stand at an exhibition. |
| opening-1 | kmr | وەرن دا پێکڤە ئاهەنگێ بگێڕین | "Come and celebrate with us". |
| opening-2 | ckb | ئێستا لێتانەوە نزیکترین | "Now closer to you". |
| opening-2 | kmr | نوکە ئەم نێزیکی هەوە بووین | "Now closer to you". |
| opening-3 | ckb | بەم بۆنەیەوە | "To celebrate". |
| appointment-1 | kmr | ئەم ژڤانا تە ل {business} دئینینە بیرا تە | "A reminder of your appointment". |
| appointment-2 | ckb | ژوانەکەت جێگیر کرا | "Your appointment is confirmed": جێگیر or پشتڕاست کرایەوە? |
| appointment-3 | kmr | دەمێن ڤالا | "Openings" (free slots). |
| appointment-4 | ckb | ئەمڕۆ لە {business} چاوەڕێمان دەکردیت | "We missed you today" — kind, not a reproach? |
| followup-1 | ckb | چۆنە بەلاتەوە؟ | "How are you finding it?" |
| followup-2 | kmr | ئەم دێ ب لەز بەرسڤا تە دەین | "We'll look into it straight away". |
| followup-3 | kmr | ژ {business} بۆ تە دنڤیسین دەربارەی وێ نرخنامێ یا مە بۆ {service} بۆ تە هنارتی | Following up a quote. |
| review-3 | kmr | گوتنێن تە یێن جوان | "Your kind words". |
| loyalty-1 | ckb | تا {date} بەکاردێن | "They're valid until …". |
| loyalty-3 | ckb | بەسەردەچن | "Expire". |
| holiday-2 | kmr | خۆشتڤیێن هەوە | "Your loved ones". |
| holiday-7 | kmr | ڕۆژا مامۆستایان | "Teachers' Day". |
| holiday-9 | ckb / kmr | کریسمس | Christmas: is کریسمس the usual word, or جەژنی لەدایکبوونی مەسیح? |
## templates-b: the second half of the ready messages (`app/src/whatsapptemplates-b.ts`)

These are whole messages sent under a business's name, so a wrong word is seen by every person on a list. The texts follow
the words the app's interface already uses (ckb ناونیشان، وشەی تێپەڕ، نامە، کاتەکانی کارکردن؛ kmr ناڤونیشان، پەیڤا بۆرینێ، بها،
دەمێن کارکرنێ، هەڤال). **Check first:** the do-not-share sentence (it is repeated word for word in all five code messages, and a test
holds it, so a correction must be made in all five and in `DO_NOT_SHARE` in `app/test/wa-templates-b.test.mjs`); then the grammatical
gender of کۆد in Badini (written masculine, کۆدێ تە / ڤی کۆدی, as most of the app's Badini has it; the app also has کۆدا once);
then the payment and clinic words. Arabic choices worth a glance: مراجع for a clinic's patient, ساعات العروض for "happy hour"
(kept away from the bar meaning), بالهناء والشفاء for "enjoy your meal".

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Do not share this code with anyone. | ئەم کۆدە لەگەڵ هیچ کەسێک هاوبەش مەکە. | ڤی کۆدی دگەل چ کەسێ پارڤە نەکە. |
| Your code is {code}. | کۆدەکەت: {code} | کۆدێ تە: {code} |
| …even if they say they are from {business}. | …تەنانەت ئەگەر خۆی بە کارمەندی {business} بناسێنێت. | …هەتا ئەگەر خۆ ب ناڤێ {business} بدەتە نیاسین. |
| It is valid until {time}. | ئەم کۆدە تا کاتژمێر {time} کار دەکات. | ئەڤ کۆدە هەتا دەمژمێر {time} کار دکەت. |
| Verification code / Sign-in code | کۆدی پشتڕاستکردنەوە / کۆدی چوونەژوورەوە | کۆدێ پشتراستکرنێ / کۆدێ کەڤتنا ژوورێ |
| Booking (a reserved place) | جێگە گرتن (and نۆرەگرتن for booking by phone, referral-3) | جهگرتن |
| Order (what a customer ordered) | داواکاری | داخوازی |
| Invoice / Amount | پسوولە / بڕی پارە | پسوولە (پسوولا تە) / بڕێ پارەی |
| Overdue invoice (title) | پسوولەی نەدراو | پسوولا نەدای |
| This is a friendly reminder: | ئەمە بیرخستنەوەیەکی دۆستانەیە: | ئەڤە بیرئینانەکا دۆستانەیە: |
| If you have already paid, please ignore this message. | ئەگەر پێشتر پارەکەت داوە، ئەم نامەیە پشتگوێ بخە. | ئەگەر تە بەری نوکە پارە دابیت، گوه نەدە ڤێ نامێ. |
| …has not been paid yet. | …هێشتا پارەکەی نەدراوە. | …هێشتا پارەدانا وێ نەهاتییە کرن. |
| Please arrange the payment at your earliest convenience | تکایە لە یەکەم دەرفەتدا پارەکە بدە | هیڤییە د زووترین دەرفەت دا پارەی بدە |
| our driver (the delivery person) | کارمەندی گەیاندنمان | کارمەندێ گەهاندنێ |
| Keep your phone nearby | مۆبایلەکەت لە نزیک خۆت بێت | مۆبایلا خۆ ل نێزیک خۆ بهێلە (gender of مۆبایل?) |
| Missed delivery (title) | گەیاندن سەری نەگرت | گەهاندن سەرنەکەفت |
| If that time does not suit you | ئەگەر ئەم کاتە بۆت گونجاو نییە | ئەگەر ئەڤ دەمە بۆ تە باش نەبیت |
| cart | سەبەتە | سەبەتە (سەبەتا تە) |
| you left something behind | شتێکت لە {business} بەجێ هێشتووە | تە تشتەک ل {business} هێلایە |
| offer (loanword, as ads write it) | ئۆفەر | ئۆفەر |
| Welcome to {business} | بەخێربێیت بۆ {business} | ب خێر بێی بۆ {business} |
| Welcome to the {business} family | بەخێربێیت بۆ خێزانی {business} | ب خێر بێی بۆ ناڤ مالباتا {business} |
| Registration is now open | ناونووسین دەستی پێکرد | ناڤنڤیسین دەست پێ کرییە |
| exam | تاقیکردنەوە | ئەزموون |
| a reminder (before a class or a visit) | بیرخستنەوە | بیرئینان |
| your regular check-up | پشکنینی ئاسایی | پشکنینا ئاسایی |
| follow-up visit | سەردانی بەدواداچوون | سەرەدانا دویڤچوونێ |
| New listing (title) | خانووبەرەی نوێ | مولکەکێ نوی |
| We are pleased to invite you to view… | بە خۆشحاڵییەوە بانگهێشتت دەکەین بۆ بینینی… | ب دلخۆشی ڤە ئەم تە ڤەدخوینین بۆ دیتنا… |
| For rent | بە کرێ دەدرێت | ب کرێ دهێتە دان |
| Enjoy your meal! | نۆشی گیانت بێت! | نۆشی جانێ تە بیت! |
| Let {business} take care of the food. | با خەمی خواردنەکە لەسەر {business} بێت. | بلا خەما خوارنێ ل سەر {business} بیت. |
| Happy hour (title: "offer hours") | کاتژمێرەکانی ئۆفەر | دەمژمێرێن ئۆفەرێ |
| {business} will be closed on {date}. | {business} ڕۆژی {date} داخراو دەبێت. | {business} ڕۆژا {date} دێ گرتی بیت. |
| during the holiday | لە ماوەی پشووەکەدا | د دەمێ پشوویێ دا |
| {business} has moved to a new place | {business} گوازرایەوە بۆ شوێنێکی نوێ | {business} هاتە ڤەگوهاستن بۆ جهەکێ نوی |
| …starting at {time}. (maintenance) | …کە کاتژمێر {time} دەست پێدەکات. | …کو دەمژمێر {time} دێ دەست پێ کەت. |
| We apologise for the inconvenience | داوای لێبوردن دەکەین بۆ ئەم ناڕەحەتییە | ئەم بۆ ڤێ ئاریشێ لێبورینێ دخوازین |
| from {date} (onwards) | لە ڕۆژی {date} بەدواوە | ژ ڕۆژا {date} و پێڤە |
| let you know in advance | پێشوەختە ئاگادارت بکەینەوە | ژ نوکە ڤە تە ئاگەهدار بکەین |
| could you spare a moment | دەتوانیت چەند ساتێکمان پێ ببەخشیت | تو دشێی هندەک دەمێ خۆ بدەیە مە |
| we hope {service} pleased you | هیوادارین {service} لە {business} بە دڵت بووبێت | هیڤیدارین {service} ل {business} ب دلێ تە بوو بیت |
| you both get {offer} | هەردووکتان {offer} وەردەگرن | هەر ئێک ژ هەوە دێ {offer} وەرگریت |
| on your next visit | لە سەردانی داهاتووتدا | د سەرەدانا خۆ یا بێت دا |
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

## integrator: the bulk-messaging paragraph in SAFETY.ckb.md and SAFETY.kmr.md

The whole paragraph that begins "ناردنی بۆ زۆر کەس لەلایەن یاریدەدەرەوە ئامادە دەکرێت" (Sorani) and "شاندنا بۆ گەلەک کەسان ژ لایێ هاریکار ڤە تێتە ئامادەکرن" (Badini),
plus the clause added to the file-path sentence of the WhatsApp paragraph ("جگە لەو یەک بەدەرچوونەی…" / "ژبلی وێ یێ د خوارێ دا هاتی…"). It states the safety promises of Broadcast, so a
native reader should check it says what the English says: a person presses Send, the list never goes to the model, the pace, the stop words, where the lists are kept. The Arabic was written with care.
Words to check: "ناردنی گشتی / شاندنا گشتی" for *Broadcast*, "ڕەشنووس / ڕەشنڤیس" for *draft*, "پەیوەندیم پێوە مەکە / پەیوەندیێ ب من نەکە" for *do not contact me*.
