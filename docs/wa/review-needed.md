# Strings for a native reader

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
