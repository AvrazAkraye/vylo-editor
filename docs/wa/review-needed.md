# Strings that need a native speaker

Each package appends a section: the English, and the Sorani (ckb) and Badini (kmr) that were written best effort. Arabic is
expected to be good.

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
