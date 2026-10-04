# Strings for a native reader

## ui — the Broadcast screens (`WhatsAppBroadcast.tsx`, `WhatsAppPeople.tsx`, `WhatsAppCompose.tsx`, `WhatsAppReady.tsx`, `WhatsAppRun.tsx`)

253 sentences, under `// wa ui` at the end of each dictionary in `app/src/i18n.ts`. The Arabic was written with care
(Modern Standard, friendly; counts written as "الأشخاص: {n}" so the noun never has to agree with a number). Sorani and
Badini are best effort, in the vocabulary the app already uses (Sorani نامە / ناردن, Badini پەیام / هنارتن, ڕێکخستن for
Settings). **★ marks the ones I am least sure of** — mostly terms with no settled Kurdish form in software
(opt-out line, do-not-contact list, instance, tone, "unsure", "skipped"). Whole-sentence fixes are welcome; please keep
every `{placeholder}` exactly as it is (a test checks).

| English | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| Add at least one person. | لانیکەم یەک کەس زیاد بکە. | لانیکێم ئێک کەسی زێدە بکە. |
| Everyone on this list asked not to be messaged. | هەموو کەسانی ئەم لیستە داوایان کردووە نامەیان بۆ نەنێردرێت. | هەمی کەسێن ڤێ لیستێ داخواز کرییە پەیام بۆ وان نەهێنە هنارتن. |
| Write a message, or attach something. | نامەیەک بنووسە، یان شتێک هاوپێچ بکە. | پەیامەکێ بنڤیسە، یان تشتەکی پێڤە بکە. |
| Message | نامە | پەیام |
| Review & send | پێداچوونەوە و ناردن | بەرچاڤکرن و هنارتن |
| Back to chats | گەڕانەوە بۆ گفتوگۆکان | زڤڕین بۆ گفتوگۆیان |
| No WhatsApp account is connected. | هیچ هەژمارێکی واتسئاپ پەیوەست نییە. | چو هەژمارێن واتسئاپێ نەهاتینە گرێدان. |
| Prepared by the assistant. Nothing has been sent. | یاریدەدەرەکە ئامادەی کردووە. هیچ شتێک نەنێردراوە. | هاریکاری ئامادە کرییە. چو تشت نەهاتیە هنارتن. |
| {n} people | {n} کەس | {n} کەس |
| Stopped by itself | خۆی وەستا | ب خۆ ڕاوەستیا |
| Press again to start over | دووبارە دابگرە بۆ دەستپێکردنەوە | دووبارە بگڤاشە بۆ دەستپێکرنەکا نوو |
| Start over | دەستپێکردنەوە | دەستپێکرنەکا نوو |
| Next: the message | دواتر: نامەکە | پاشان: پەیام |
| Next: check and send | دواتر: پشکنین و ناردن | پاشان: پشکنین و هنارتن |
| {n} person | {n} کەس | {n} کەس |
| Details from the list: {list} | زانیاری لە لیستەکەوە: {list} | زانیاری ژ لیستێ: {list} |
| Nobody yet. | هێشتا کەس نییە. | هێشتا کەس نینە. |
| Nothing on this line | ئەم دێڕە بەتاڵە | ئەڤ دێڕە ڤالایە |
| Too short to be a phone number | کورتترە لەوەی ژمارەی تەلەفۆن بێت | کورتترە ژ هندێ ژمارا تەلەفونێ بیت |
| Too long to be a phone number | درێژترە لەوەی ژمارەی تەلەفۆن بێت | درێژترە ژ هندێ ژمارا تەلەفونێ بیت |
| No country uses that code | هیچ وڵاتێک ئەم کۆدەی نییە | چو وەلات ڤی کۆدی بکارنائینیت |
| Not a phone number | ژمارەی تەلەفۆن نییە | ژمارا تەلەفونێ نینە |
| No phone numbers were found in that. | هیچ ژمارەیەکی تەلەفۆن لەوەدا نەدۆزرایەوە. | چو ژمارێن تەلەفونێ تێدا نەهاتنە دیتن. |
| That could not be read as a list of numbers. | نەتوانرا وەک لیستی ژمارە بخوێندرێتەوە. | نەشیا وەک لیستا ژمارەیان بهێتە خواندن. |
| That kind of file is not a list. Use .txt, .csv, .tsv, .vcf or .xlsx. | ئەم جۆرە فایلە لیست نییە. .txt، .csv، .tsv، .vcf یان .xlsx بەکاربهێنە. | ئەڤ جۆرێ فایلی لیست نینە. .txt، .csv، .tsv، .vcf یان .xlsx بکاربینە. |
| That file could not be opened: {why} | فایلەکە نەکرایەوە: {why} | فایل نەهاتە ڤەکرن: {why} |
| Lists of numbers | لیستی ژمارەکان | لیستێن ژمارەیان |
| List of {date} | لیستی {date} | لیستا {date} |
| Saved as “{name}”. | بە ناوی ”{name}“ پاشەکەوت کرا. | ب ناڤێ ”{name}“ هاتە پاشەکەفتکرن. |
| The list could not be saved on this computer. | لیستەکە لەسەر ئەم کۆمپیوتەرە پاشەکەوت نەکرا. | لیست ل سەر ڤی کۆمپیوتەری پاشەکەفت نەبوو. |
| From a file | لە فایلێکەوە | ژ فایلەکێ |
| From my chats | لە گفتوگۆکانمەوە | ژ گفتوگۆیێن من |
| Saved lists | لیستە پاشەکەوتکراوەکان | لیستێن پاشەکەفتکری |
| Who should get it? | بۆ کێ بنێردرێت؟ | بۆ کێ بهێتە هنارتن؟ |
| ★ Where the numbers are | ژمارەکان لە کوێن | ژمارە ل کیڤەنە |
| Paste numbers, or a whole list with names | ژمارەکان بلکێنە، یان لیستێکی تەواو بە ناوەکانەوە | ژمارەیان ڤەلکینە، یان لیستەکا تەمام دگەل ناڤان |
| Read these numbers | ئەم ژمارانە بخوێنەوە | ڤان ژمارەیان بخوینە |
| Drop a list here | لیستێک لێرە دابنێ | لیستەکێ ل ڤێرێ دانە |
| Choose a file… | فایلێک هەڵبژێرە… | فایلەکێ هەلبژێرە… |
| {n} people you have chatted with | {n} کەس کە گفتوگۆت لەگەڵ کردوون | {n} کەس یێن تە گفتوگۆ دگەل کری |
| Groups are left out. Only one-to-one chats with a phone number are used. | گرووپەکان لادەبرێن. تەنها گفتوگۆی تاکەکەسی کە ژمارەی تەلەفۆنیان هەیە بەکاردێن. | گرووپ دهێنە لادان. بتنێ گفتوگۆیێن تاکەکەسی یێن ژمارا تەلەفونێ هەی دهێنە بکارئینان. |
| Use these people | ئەم کەسانە بەکاربهێنە | ڤان کەسان بکاربینە |
| Open your chats first: the people you talk to appear here. | سەرەتا گفتوگۆکانت بکەرەوە: ئەو کەسانەی قسەیان لەگەڵ دەکەیت لێرە دەردەکەون. | پێشی گفتوگۆیێن خۆ ڤەکە: ئەو کەسێن تو دگەل دئاخڤی ل ڤێرێ دیار دبن. |
| No saved lists yet. Read some numbers, then save them under a name. | هێشتا هیچ لیستێکی پاشەکەوتکراو نییە. چەند ژمارەیەک بخوێنەوە، پاشان بە ناوێک پاشەکەوتیان بکە. | هێشتا چو لیستێن پاشەکەفتکری نینن. هندەک ژمارەیان بخوینە، پاشان ب ناڤەکی پاشەکەفت بکە. |
| {n} people · {date} | {n} کەس · {date} | {n} کەس · {date} |
| Press again to delete | دووبارە دابگرە بۆ سڕینەوە | دووبارە بگڤاشە بۆ ژێبرنێ |
| Delete this list | ئەم لیستە بسڕەوە | ڤێ لیستێ ژێببە |
| {n} couldn’t be read | {n} نەخوێندرانەوە | {n} نەهاتنە خواندن |
| ★ {n} repeated | {n} دووبارە | {n} دووبارە |
| {n} asked not to be messaged | {n} داوایان کردووە نامەیان بۆ نەنێردرێت | {n} داخواز کرییە پەیام بۆ وان نەهێت |
| Only the first {n} were taken: that is the most one broadcast can hold. | تەنها یەکەم {n} وەرگیران: ئەوە زۆرترینە کە یەک ناردنی گشتی دەیگرێت. | بتنێ {n} یێن ئێکێ هاتنە وەرگرتن: ئەڤە زێدەترینە کو ئێک ناردنا گشتی دگریت. |
| Lines that couldn’t be read | ئەو دێڕانەی نەخوێندرانەوە | ئەو دێڕێن نەهاتینە خواندن |
| Line {n} | دێڕی {n} | دێڕا {n} |
| And {n} more. | و {n}ی تر. | و {n} یێن دی. |
| The first people on the list | یەکەم کەسانی لیستەکە | کەسێن ئێکێ یێن لیستێ |
| ★ Phone is in | ژمارە لە ستوونی | ژمارە ل ستوینا |
| ★ Name is in | ناو لە ستوونی | ناڤ ل ستوینا |
| No name column | ستوونی ناو نییە | ستوینا ناڤی نینە |
| ★ Numbers without a country code are from | ژمارەی بێ کۆدی وڵات سەر بە | ژمارێن بێ کۆدێ وەلاتی ژ |
| A name for this list | ناوێک بۆ ئەم لیستە | ناڤەک بۆ ڤێ لیستێ |
| Save this list | ئەم لیستە پاشەکەوت بکە | ڤێ لیستێ پاشەکەفت بکە |
| Only your own contacts and customers who agreed to hear from you. | تەنها پەیوەندییەکانی خۆت و ئەو کڕیارانەی ڕازی بوون نامەت لێ وەربگرن. | بتنێ پەیوەندیێن تە و ئەو کڕیارێن ڕازی بووین پەیامێن تە وەرگرن. |
| Much of it is in capital letters, which reads as shouting. | زۆربەی بە پیتی گەورەیە، کە وەک هاوار دەخوێندرێتەوە. | پترییا وێ ب پیتێن مەزنە، کو وەک قێرین دهێتە خواندن. |
| Many exclamation marks can make it look like spam. | نیشانەی سەرسوڕمانی زۆر دەتوانێت وەک سپام دەریبخات. | گەلەک نیشانێن سەرسوڕمانێ دشێن وەک سپام دیار بکەن. |
| More than one link can make it look like spam. | زیاتر لە یەک بەستەر دەتوانێت وەک سپام دەریبخات. | پتر ژ ئێک لینکێ دشێت وەک سپام دیار بکەت. |
| ★ Shortened links are often treated as spam. Use the full address. | بەستەری کورتکراوە زۆرجار وەک سپام دادەنرێت. ناونیشانی تەواو بەکاربهێنە. | لینکێن کورتکری گەلەک جاران وەک سپام دهێنە هژمارتن. ناڤونیشانێ تەمام بکاربینە. |
| Long messages are often left unread. Shorter usually works better. | نامەی درێژ زۆرجار نەخوێندراو دەمێنێتەوە. کورتتر زۆربەی جار باشترە. | پەیامێن درێژ گەلەک جاران نەخواندی دمینن. کورتتر ب گشتی باشترە. |
| Words like “free money” or “guaranteed” look like spam to people and to WhatsApp. | وشەی وەک ”پارەی بێبەرامبەر“ یان ”مسۆگەر“ لای خەڵک و واتسئاپ وەک سپام دەردەکەون. | پەیڤێن وەک ”پارێ بێبەرامبەر“ یان ”گەرەنتیکری“ ل دەڤ خەلکی و واتسئاپێ وەک سپام دیار دبن. |
| The same sentence appears more than once. | هەمان ڕستە زیاتر لە جارێک هاتووە. | هەمان ڕستە پتر ژ جارەکێ هاتیە. |
| Voice note | نامەی دەنگی | پەیاما دەنگی |
| Contact card | کارتی پەیوەندی | کارتا پەیوەندیێ |
| ★ Preview | پێشبینین | پێشدیتن |
| How it will look | چۆن دەردەکەوێت | دێ چاوا دیار بیت |
| Write a message to see it here. | نامەیەک بنووسە بۆ ئەوەی لێرە بیبینیت. | پەیامەکێ بنڤیسە دا ل ڤێرێ ببینی. |
| Add people in step 1 to see their own messages here. | لە هەنگاوی 1 کەس زیاد بکە بۆ ئەوەی نامەکانیان لێرە ببینیت. | ل پێنگاڤا 1 کەسان زێدە بکە دا پەیامێن وان ل ڤێرێ ببینی. |
| No name | بێ ناو | بێ ناڤ |
| Friendly | دۆستانە | هەڤالانە |
| Professional | پیشەیی | پیشەیی |
| ★ Festive | ئاهەنگی | ئاهەنگی |
| Urgent | بەپەلە | ب لەز |
| Short and plain | کورت و سادە | کورت و سادە |
| The answer could not be read as messages. Try again. | وەڵامەکە وەک نامە نەخوێندرایەوە. دووبارە هەوڵ بدەرەوە. | بەرسڤ وەک پەیام نەهاتە خواندن. دووبارە هەول بدە. |
| The message could not be written: {why} | نامەکە نەنووسرا: {why} | پەیام نەهاتە نڤیسین: {why} |
| ★ Write with AI | بە ژیریی دەستکرد بنووسە | ب ژیریا دەستکرد بنڤیسە |
| Writing needs a model. Add a model in Settings, then come back. | نووسین پێویستی بە مۆدێلێکە. لە ڕێکخستن مۆدێلێک زیاد بکە، پاشان بگەڕێوە. | نڤیسین پێدڤی ب مۆدێلەکێ یە. ل ڕێکخستنان مۆدێلەکێ زێدە بکە، پاشان بزڤڕە. |
| Add a model in Settings | مۆدێلێک لە ڕێکخستن زیاد بکە | مۆدێلەکێ ل ڕێکخستنان زێدە بکە |
| What do you want to tell people? | دەتەوێت چی بە خەڵک بڵێیت؟ | تە دڤێت چ بێژیە خەلکی؟ |
| For example: 20% off all shoes this weekend at our Erbil shop | بۆ نموونە: 20% داشکاندن لەسەر هەموو پێڵاوەکان ئەم کۆتایی هەفتەیە لە دووکانەکەمان لە هەولێر | بۆ نموونە: 20% داشکاندن ل سەر هەمی پێلاڤان د دووماهیا ڤێ هەفتیێ دا ل دوکانا مە ل هەولێرێ |
| ★ Tone | شێواز | شێواز |
| ★ How many to choose from | چەند بژاردە | چەند هەلبژارتن |
| Written in {lang}. Your list is never sent to the model, only what you type here. | بە {lang} دەنووسرێت. لیستەکەت هەرگیز بۆ مۆدێلەکە نانێردرێت، تەنها ئەوەی لێرە دەینووسیت. | ب {lang} دهێتە نڤیسین. لیستا تە چو جاران بۆ مۆدێلی ناهێتە هنارتن، بتنێ ئەوا تو ل ڤێرێ دنڤیسی. |
| Improve my message | نامەکەم باشتر بکە | پەیاما من باشتر بکە |
| Use this | ئەمە بەکاربهێنە | ڤێ بکاربینە |
| Improve | باشترکردن | باشترکرن |
| Shorten | کورتکردنەوە | کورتکرن |
| Translate | وەرگێڕان | وەرگێڕان |
| That file is larger than {n} MB, the most WhatsApp takes. | ئەم فایلە لە {n} مێگابایت گەورەترە، کە زۆرترینی واتسئاپە. | ئەڤ فایلە ژ {n} مێگابایتان مەزنترە، کو زێدەترینا واتسئاپێ یە. |
| That file is not a {kind}. Choose another, or attach it as a document. | ئەم فایلە {kind} نییە. یەکێکی تر هەڵبژێرە، یان وەک بەڵگەنامە هاوپێچی بکە. | ئەڤ فایلە {kind} نینە. ئێکێ دی هەلبژێرە، یان وەک بەلگەنامە پێڤە بکە. |
| That file could not be read. | فایلەکە نەخوێندرایەوە. | فایل نەهاتە خواندن. |
| Write the name on the card. | ناوەکە لەسەر کارتەکە بنووسە. | ناڤی ل سەر کارتێ بنڤیسە. |
| That phone number could not be read. | ئەم ژمارە تەلەفۆنە نەخوێندرایەوە. | ئەڤ ژمارا تەلەفونێ نەهاتە خواندن. |
| Attach | هاوپێچ | پێڤەکرن |
| What to attach | چی هاوپێچ بکرێت | چ بهێتە پێڤەکرن |
| Name on the card | ناو لەسەر کارتەکە | ناڤ ل سەر کارتێ |
| Company (if any) | کۆمپانیا (ئەگەر هەبێت) | کۆمپانی (ئەگەر هەبیت) |
| Attach this card | ئەم کارتە هاوپێچ بکە | ڤێ کارتێ پێڤە بکە |
| ★ Up to {n} MB. The message becomes its caption. | هەتا {n} مێگابایت. نامەکە دەبێتە ژێرنووسی. | هەتا {n} مێگابایتان. پەیام دبیتە ژێرنڤیسا وێ. |
| Remove {name} | لابردنی {name} | لادانا {name} |
| {var} is not filled in, and the list has no column by that name. Fill it in or remove it. | {var} پڕ نەکراوەتەوە، و لیستەکە ستوونێکی بەو ناوەی نییە. پڕی بکەرەوە یان لایبە. | {var} نەهاتیە تژیکرن، و لیستێ ستوینەکا ب وی ناڤی نینە. تژی بکە یان لابە. |
| 1 person has no {var}: their message will leave it out. | 1 کەس {var}ی نییە: نامەکەی بەبێ ئەوە دەنێردرێت. | 1 کەسی {var} نینە: پەیاما وی دێ بێ وێ هێتە هنارتن. |
| {n} people have no {var}: their message will leave it out. | {n} کەس {var}یان نییە: نامەکانیان بەبێ ئەوە دەنێردرێن. | {n} کەسان {var} نینە: پەیامێن وان دێ بێ وێ هێنە هنارتن. |
| Ready messages | نامەی ئامادە | پەیامێن ئامادە |
| Hello {name}, … | سڵاو {name}، … | سلاڤ {name}، … |
| ★ Insert a detail from the list | زانیارییەک لە لیستەکەوە دابنێ | زانیاریەکێ ژ لیستێ دانە |
| Insert {var} | {var} دابنێ | {var} دانە |
| {n} of {max} characters | {n} لە {max} پیت | {n} ژ {max} پیتان |
| Change the attachment | هاوپێچەکە بگۆڕە | پێڤەکری بگوهۆڕە |
| Remove the attachment | هاوپێچەکە لابە | پێڤەکری لابە |
| Message language | زمانی نامە | زمانێ پەیامێ |
| Add a line that lets people stop these messages | دێڕێک زیاد بکە کە ڕێگە بە خەڵک دەدات ئەم نامانە ڕابگرن | دێڕەکێ زێدە بکە کو ڕێکێ ددەتە خەلکی ڤان پەیامان ڕاوەستینن |
| ★ The opt-out line | دێڕی وەستاندن | دێڕا ڕاوەستاندنێ |
| Use the usual line | دێڕە ئاساییەکە بەکاربهێنە | دێڕا ئاسایی بکاربینە |
| A promotion without a way to stop is the message people report. | ڕیکلامێک کە ڕێگەی وەستاندنی تێدا نەبێت ئەو نامەیەیە کە خەڵک ڕاپۆرتی دەکەن. | ڕیکلامەکا بێ ڕێکا ڕاوەستاندنێ ئەو پەیامە یا خەلک ڕاپۆرت دکەن. |
| {kind}: {name} | {kind}: {name} | {kind}: {name} |
| ★ Business name | ناوی کار و بار | ناڤێ کار و باری |
| The offer | ئۆفەرەکە | ئۆفەر |
| Old price | نرخی کۆن | بهایێ کەڤن |
| Discount | داشکاندن | داشکاندن |
| Time | کات | دەم |
| Place | شوێن | جه |
| Link | بەستەر | لینک |
| Product | بەرهەم | بەرهەم |
| Service | خزمەتگوزاری | خزمەتگوزاری |
| Opening hours | کاتەکانی کار | دەمژمێرێن کاری |
| Days | ڕۆژەکان | ڕۆژ |
| Promotion | ڕیکلام | ڕیکلام |
| Service message | نامەی خزمەتگوزاری | پەیاما خزمەتگوزاریێ |
| Greeting | پیرۆزبایی | پیرۆزباهی |
| All ready messages | هەموو نامە ئامادەکان | هەمی پەیامێن ئامادە |
| Still empty: {list}. Fill them in here or in the message. | هێشتا بەتاڵن: {list}. لێرە یان لە نامەکەدا پڕیان بکەرەوە. | هێشتا ڤالانە: {list}. ل ڤێرێ یان د پەیامێ دا تژی بکە. |
| Replace my message with this | ئەمە لە جیاتی نامەکەم دابنێ | ڤێ ل جهێ پەیاما من دانە |
| Use this message | ئەم نامەیە بەکاربهێنە | ڤێ پەیامێ بکاربینە |
| Search ready messages | گەڕان لە نامە ئامادەکاندا | ل پەیامێن ئامادە بگەڕە |
| Categories | پۆلەکان | پۆل |
| Category | پۆل | پۆل |
| No ready messages here yet. | هێشتا هیچ نامەیەکی ئامادە لێرە نییە. | هێشتا چو پەیامێن ئامادە ل ڤێرێ نینن. |
| Use “{name}” | ”{name}“ بەکاربهێنە | ”{name}“ بکاربینە |
| under a minute | کەمتر لە خولەکێک | کێمتر ژ خولەکەکێ |
| about {m} min | نزیکەی {m} خولەک | نێزیکی {m} خولەکان |
| about {h} h | نزیکەی {h} کاتژمێر | نێزیکی {h} دەمژمێران |
| about {h} h {m} min | نزیکەی {h} کاتژمێر و {m} خولەک | نێزیکی {h} دەمژمێر و {m} خولەکان |
| There is nobody to send to. Add people in step 1. | کەس نییە بۆی بنێردرێت. لە هەنگاوی 1 کەس زیاد بکە. | کەس نینە بۆ بهێتە هنارتن. ل پێنگاڤا 1 کەسان زێدە بکە. |
| {n} people is more than one broadcast can hold ({max}). | {n} کەس زیاترە لەوەی یەک ناردنی گشتی دەیگرێت ({max}). | {n} کەس پترە ژ وێ یا ئێک ناردنا گشتی دگریت ({max}). |
| The message is empty. Write something or attach a file. | نامەکە بەتاڵە. شتێک بنووسە یان فایلێک هاوپێچ بکە. | پەیام ڤالایە. تشتەکی بنڤیسە یان فایلەکێ پێڤە بکە. |
| The message is too long for some people. Shorten it. | نامەکە بۆ هەندێک کەس زۆر درێژە. کورتی بکەرەوە. | پەیام بۆ هندەک کەسان گەلەک درێژە. کورت بکە. |
| Tick the box to confirm everyone agreed to hear from you. | خانەکە نیشان بکە بۆ دڵنیاکردنەوە کە هەمووان ڕازی بوون نامەت لێ وەربگرن. | خانێ نیشان بکە بۆ پشتڕاستکرنا هندێ کو هەمی ڕازی بووینە پەیامێن تە وەرگرن. |
| Connect a WhatsApp account first. | سەرەتا هەژمارێکی واتسئاپ پەیوەست بکە. | پێشی هەژمارەکا واتسئاپێ گرێبدە. |
| The attachment is larger than WhatsApp takes. | هاوپێچەکە گەورەترە لەوەی واتسئاپ وەریدەگرێت. | پێڤەکری مەزنترە ژ وێ یا واتسئاپ وەردگریت. |
| The attachment could not be read. Attach it again. | هاوپێچەکە نەخوێندرایەوە. دووبارە هاوپێچی بکە. | پێڤەکری نەهاتە خواندن. دووبارە پێڤە بکە. |
| The pace is outside the safe range. Reset the pace. | خێرایی لە سنووری سەلامەت دەرچووە. خێرایی ڕێکبخەرەوە. | لەز ژ سنوورێ پاراستی دەرکەفتیە. لەزێ ڕێکبێخە. |
| Today’s limit is already reached. Send tomorrow, or raise the daily limit. | سنووری ئەمڕۆ پێشتر گەیشتووە. سبەی بنێرە، یان سنووری ڕۆژانە بەرز بکەرەوە. | سنوورێ ئەڤرۆ پێشتر گەهشتیە. سوبەهی بهنێرە، یان سنوورێ ڕۆژانە بلند بکە. |
| Another broadcast is sending now. Wait for it to finish. | ناردنێکی گشتی تر ئێستا دەنێردرێت. چاوەڕێ بکە تا تەواو دەبێت. | ناردنەکا گشتی یا دی نوکە دهێتە هنارتن. چاڤەڕێ بە هەتا ب دووماهی دهێت. |
| The WhatsApp server refused the key. Check the connection in settings. | ڕاژەکاری واتسئاپ کلیلەکەی ڕەت کردەوە. پەیوەندییەکە لە ڕێکخستن بپشکنە. | سێرڤەرێ واتسئاپێ کلیل ڕەت کر. گرێدانێ ل ڕێکخستنان بپشکنە. |
| This WhatsApp number is not connected. Link it again on the server, then continue. | ئەم ژمارە واتسئاپە پەیوەست نییە. دووبارە لەسەر ڕاژەکار بیبەستەوە، پاشان بەردەوام بە. | ئەڤ ژمارا واتسئاپێ نەگرێدایە. دووبارە ل سەر سێرڤەری گرێبدە، پاشان بەردەوام بە. |
| WhatsApp asked to slow down several times, so sending stopped. Wait an hour before continuing. | واتسئاپ چەند جارێک داوای هێواشکردنەوەی کرد، بۆیە ناردن وەستا. پێش بەردەوامبوون کاتژمێرێک چاوەڕێ بکە. | واتسئاپێ چەند جاران داخواز کر هێدی ببیت، لەوما هنارتن ڕاوەستیا. بەری بەردەوامیێ دەمژمێرەکێ چاڤەڕێ بە. |
| Several messages in a row failed, so sending stopped to protect your number. Check the connection, then continue. | چەند نامەیەک بە دوای یەکدا شکستیان هێنا، بۆیە ناردن وەستا بۆ پاراستنی ژمارەکەت. پەیوەندییەکە بپشکنە، پاشان بەردەوام بە. | چەند پەیامەک ل دویڤ ئێک سەرنەکەفتن، لەوما هنارتن ڕاوەستیا بۆ پاراستنا ژمارا تە. گرێدانێ بپشکنە، پاشان بەردەوام بە. |
| WhatsApp says this number is blocked or logged out. Do not continue until it is linked again. | واتسئاپ دەڵێت ئەم ژمارەیە بلۆک کراوە یان چووەتە دەرەوە. تا دووبارە پەیوەست نەکرێتەوە بەردەوام مەبە. | واتسئاپ دبێژیت ئەڤ ژمارە هاتیە بلۆککرن یان دەرکەفتیە. هەتا دووبارە نەهێتە گرێدان بەردەوام نەبە. |
| The app could not save its progress, so it stopped before sending more. Free some disk space, then continue. | ئەپەکە نەیتوانی پێشکەوتنەکەی پاشەکەوت بکات، بۆیە پێش ناردنی زیاتر وەستا. هەندێک شوێن لەسەر دیسک بەتاڵ بکە، پاشان بەردەوام بە. | ئەپ نەشیا پێشکەفتنا خۆ پاشەکەفت بکەت، لەوما بەری هنارتنا پتر ڕاوەستیا. هندەک جه ل سەر دیسکێ ڤالا بکە، پاشان بەردەوام بە. |
| ★ The WhatsApp server has no instance by that name. Check the connection in settings. | ڕاژەکاری واتسئاپ هیچ نموونەیەکی بەو ناوەی نییە. پەیوەندییەکە لە ڕێکخستن بپشکنە. | سێرڤەرێ واتسئاپێ چو نموونەیێن ب وی ناڤی نینن. گرێدانێ ل ڕێکخستنان بپشکنە. |
| Sending stopped by itself. Check the connection, then continue. | ناردن خۆی وەستا. پەیوەندییەکە بپشکنە، پاشان بەردەوام بە. | هنارتن ب خۆ ڕاوەستیا. گرێدانێ بپشکنە، پاشان بەردەوام بە. |
| Today’s limit is reached. It continues tomorrow at {time}. | سنووری ئەمڕۆ گەیشت. سبەی کاتژمێر {time} بەردەوام دەبێت. | سنوورێ ئەڤرۆ گەهشت. سوبەهی دەمژمێر {time} بەردەوام دبیت. |
| Taking a break until {time}. | پشوو هەتا {time}. | بێهنڤەدان هەتا {time}. |
| Next message in {s} s. | نامەی داهاتوو دوای {s} چرکە. | پەیاما پاشتر پشتی {s} چرکان. |
| Stopped | وەستێنرا | هاتە ڕاوەستاندن |
| Starting… | دەست پێدەکات… | دەست پێدکەت… |
| Draft | ڕەشنووس | ڕەشنڤیس |
| May or may not have been sent | لەوانەیە نێردرابێت، لەوانەیە نا | بەلکی هاتبیتە هنارتن، بەلکی نە |
| Sending now | ئێستا دەنێردرێت | نوکە دهێتە هنارتن |
| Not on WhatsApp | لە واتسئاپ نییە | ل واتسئاپێ نینە |
| Asked not to be messaged | داوای کردووە نامەی بۆ نەنێردرێت | داخواز کرییە پەیام بۆ نەهێت |
| Not a valid number | ژمارەیەکی دروست نییە | ژمارەکا دروست نینە |
| ★ Repeated | دووبارە | دووبارە |
| The broadcast could not be saved on this computer, so nothing was sent. | ناردنە گشتییەکە لەسەر ئەم کۆمپیوتەرە پاشەکەوت نەکرا، بۆیە هیچ نەنێردرا. | ناردنا گشتی ل سەر ڤی کۆمپیوتەری پاشەکەفت نەبوو، لەوما چو نەهاتە هنارتن. |
| Something on this card needs fixing first. | شتێک لەم کارتەدا پێویستی بە چاککردنە پێشتر. | تشتەک د ڤێ کارتێ دا پێدڤی ب چاککرنێ یە پێشی. |
| The test was not sent: {why} | تاقیکردنەوەکە نەنێردرا: {why} | تاقیکرن نەهاتە هنارتن: {why} |
| Check it, then send | بیپشکنە، پاشان بینێرە | بپشکنە، پاشان بهنێرە |
| and {n} more | و {n}ی تر | و {n} یێن دی |
| Exactly as {name} will get it: | ڕێک وەک ئەوەی {name} وەریدەگرێت: | ڕاست وەک {name} دێ وەرگریت: |
| Pace | خێرایی | لەز |
| About one message every {min}–{max} seconds, with a break every {batch}. | نزیکەی یەک نامە هەر {min}–{max} چرکە جارێک، لەگەڵ پشوویەک دوای هەر {batch} نامە. | نێزیکی ئێک پەیام هەر {min}–{max} چرکان جارەکێ، دگەل بێهنڤەدانەکێ پشتی هەر {batch} پەیامان. |
| Sending takes {time} in all. | ناردن بە گشتی {time} دەخایەنێت. | هنارتن ب گشتی {time} دخایینیت. |
| {cap} a day at most. | زۆرترین {cap} لە ڕۆژێکدا. | زێدەترین {cap} د ڕۆژەکێ دا. |
| At {cap} a day this takes {days} days. Keep the app open: it continues each day by itself. | بە ڕۆژانە {cap}، ئەمە {days} ڕۆژ دەخایەنێت. ئەپەکە کراوە بهێڵەوە: هەموو ڕۆژێک خۆی بەردەوام دەبێت. | ب ڕۆژانە {cap}، ئەڤە {days} ڕۆژان دخایینیت. ئەپێ ڤەکری بهێلە: هەمی ڕۆژان ب خۆ بەردەوام دبیت. |
| Hide the pace | شاردنەوەی خێرایی | ڤەشارتنا لەزێ |
| Change pace | گۆڕینی خێرایی | گوهۆڕینا لەزێ |
| Shortest wait between messages (seconds) | کورترین چاوەڕوانی لە نێوان نامەکاندا (چرکە) | کورترین چاڤەڕێکرن د ناڤبەرا پەیامان دا (چرکە) |
| Longest wait between messages (seconds) | درێژترین چاوەڕوانی لە نێوان نامەکاندا (چرکە) | درێژترین چاڤەڕێکرن د ناڤبەرا پەیامان دا (چرکە) |
| Messages before a break | نامەکان پێش پشوو | پەیام بەری بێهنڤەدانێ |
| Length of the break (seconds) | درێژی پشوو (چرکە) | درێژیا بێهنڤەدانێ (چرکە) |
| Most messages in one day | زۆرترین نامە لە یەک ڕۆژدا | زێدەترین پەیام د ئێک ڕۆژێ دا |
| ★ Stop after this many failures in a row | دوای ئەم ژمارە شکستە بە دوای یەکدا بوەستە | پشتی ئەڤ هژمارا سەرنەکەفتنان ل دویڤ ئێک ڕاوەستە |
| ★ Show “typing…” before each message | پێش هەر نامەیەک ”دەنووسێت…“ پیشان بدە | بەری هەر پەیامەکێ ”دنڤیسیت…“ نیشان بدە |
| More than {n} a day makes it much more likely that WhatsApp blocks your number. | زیاتر لە {n} لە ڕۆژێکدا ئەگەری ئەوە زۆر زیاد دەکات کە واتسئاپ ژمارەکەت بلۆک بکات. | پتر ژ {n} د ڕۆژەکێ دا ئەگەرا هندێ گەلەک زێدە دکەت کو واتسئاپ ژمارا تە بلۆک بکەت. |
| Reset the pace | خێرایی بگەڕێنەوە بۆ بنەڕەت | لەزێ بزڤڕینە بۆ بنەڕەت |
| Everyone on this list agreed to hear from me. | هەموو کەسانی ئەم لیستە ڕازی بوون نامەم لێ وەربگرن. | هەمی کەسێن ڤێ لیستێ ڕازی بووینە پەیامێن من وەرگرن. |
| Your own WhatsApp number, for a test | ژمارەی واتسئاپی خۆت، بۆ تاقیکردنەوە | ژمارا واتسئاپا تە، بۆ تاقیکرنێ |
| Sending the test… | تاقیکردنەوەکە دەنێردرێت… | تاقیکرن دهێتە هنارتن… |
| Send a test to myself | تاقیکردنەوەیەک بۆ خۆم بنێرە | تاقیکرنەکێ بۆ خۆ بهنێرە |
| The test carries the words only, not the attachment. | تاقیکردنەوەکە تەنها دەقەکە دەگرێت، نەک هاوپێچەکە. | تاقیکرن بتنێ نڤیسینێ دگریت، نە پێڤەکری. |
| The test was sent. Check your phone. | تاقیکردنەوەکە نێردرا. مۆبایلەکەت بپشکنە. | تاقیکرن هاتە هنارتن. مۆبایلا خۆ بپشکنە. |
| To confirm, type the number of people: {n} | بۆ دڵنیاکردنەوە، ژمارەی کەسەکان بنووسە: {n} | بۆ پشتڕاستکرنێ، هژمارا کەسان بنڤیسە: {n} |
| WhatsApp can block numbers that message people who did not ask. Messages go slowly on purpose. | واتسئاپ دەتوانێت ئەو ژمارانە بلۆک بکات کە نامە بۆ کەسانێک دەنێرن کە داوایان نەکردووە. نامەکان بە ئەنقەست هێواش دەنێردرێن. | واتسئاپ دشێت وان ژمارەیان بلۆک بکەت یێن پەیامان بۆ وان کەسان دهنێرن یێن داخواز نەکری. پەیام ب ئەنقەست هێدی دهێنە هنارتن. |
| Send to 1 person | بۆ 1 کەس بنێرە | بۆ 1 کەسی بهنێرە |
| Send to {n} people | بۆ {n} کەس بنێرە | بۆ {n} کەسان بهنێرە |
| {sent} of {total} sent | {sent} لە {total} نێردران | {sent} ژ {total} هاتنە هنارتن |
| ★ Skipped | تێپەڕێنراو | دەربازکری |
| ★ Unsure | نادڵنیا | نە پشتڕاست |
| Sending to {who} now | ئێستا بۆ {who} دەنێردرێت | نوکە بۆ {who} دهێتە هنارتن |
| Paused: the app closed while it was sending. Nothing is sent twice when you continue. | وەستێنراو: ئەپەکە لە کاتی ناردندا داخرا. کاتێک بەردەوام دەبیت هیچ شتێک دوو جار نانێردرێت. | ڕاوەستاندی: ئەپ د دەمێ هنارتنێ دا هاتە گرتن. دەمێ تو بەردەوام دبی چو تشت دوو جاران ناهێتە هنارتن. |
| Sending stopped because of an error: {why} | ناردن بەهۆی هەڵەیەکەوە وەستا: {why} | هنارتن ژ بەر خەلەتیەکێ ڕاوەستیا: {why} |
| ★ “Unsure” means the app lost touch with WhatsApp at the moment of sending. Those are never sent again by themselves. | ”نادڵنیا“ واتە ئەپەکە لە ساتی ناردندا پەیوەندی لەگەڵ واتسئاپ پچڕا. ئەمانە هەرگیز خۆیان دووبارە نانێردرێنەوە. | ”نە پشتڕاست“ ئانکو ئەپ د چرکا هنارتنێ دا پەیوەندی دگەل واتسئاپێ ژێکڤەبوو. ئەڤە چو جاران ب خۆ دووبارە ناهێنە هنارتن. |
| ★ Press again to stop for good | دووبارە دابگرە بۆ وەستاندنی یەکجاری | دووبارە بگڤاشە بۆ ڕاوەستاندنا ب جارەکێ |
| ★ Continue with the {n} left | بەردەوام بە لەگەڵ {n}ی ماوە | بەردەوام بە دگەل {n} یێن مای |
| See the report | ڕاپۆرتەکە ببینە | ڕاپۆرتێ ببینە |
| New broadcast | ناردنێکی گشتی نوێ | ناردنەکا گشتی یا نوو |
| ★ Latest | دوایین | دووماهیک |
| You can close this panel: sending goes on while the app is open. | دەتوانیت ئەم پانێڵە دابخەیت: ناردن بەردەوام دەبێت هەتا ئەپەکە کراوە بێت. | تو دشێی ڤی پانێلی بگری: هنارتن بەردەوام دبیت هەتا ئەپ ڤەکری بیت. |
| Save the report | ڕاپۆرتەکە پاشەکەوت بکە | ڕاپۆرتێ پاشەکەفت بکە |
| The report was saved. | ڕاپۆرتەکە پاشەکەوت کرا. | ڕاپۆرت هاتە پاشەکەفتکرن. |
| The report could not be saved: {why} | ڕاپۆرتەکە پاشەکەوت نەکرا: {why} | ڕاپۆرت پاشەکەفت نەبوو: {why} |
| Open your chats first, so their replies can be read. | سەرەتا گفتوگۆکانت بکەرەوە، بۆ ئەوەی وەڵامەکانیان بخوێندرێنەوە. | پێشی گفتوگۆیێن خۆ ڤەکە، دا بەرسڤێن وان بهێنە خواندن. |
| Nobody on this list has replied STOP. | کەس لەم لیستەدا وەڵامی STOPی نەداوەتەوە. | کەسێ د ڤێ لیستێ دا بەرسڤا STOP نەدایە. |
| 1 person who replied STOP is now on the do-not-contact list. | 1 کەس کە وەڵامی STOPی دایەوە ئێستا لە لیستی پەیوەندی نەکردندایە. | 1 کەس یێ بەرسڤا STOP دای نوکە ل سەر لیستا پەیوەندی نەکرنێ یە. |
| {n} people who replied STOP are now on the do-not-contact list. | {n} کەس کە وەڵامی STOPیان دایەوە ئێستا لە لیستی پەیوەندی نەکردندان. | {n} کەسێن بەرسڤا STOP دای نوکە ل سەر لیستا پەیوەندی نەکرنێ نە. |
| Report | ڕاپۆرت | ڕاپۆرت |
| Messages that may or may not have been sent | ئەو نامانەی لەوانەیە نێردرابن یان نا | ئەو پەیامێن بەلکی هاتبنە هنارتن یان نە |
| The app lost touch with WhatsApp at the moment these were sent, so it cannot tell whether they arrived. They are never sent again by themselves. Look at those chats on your phone and send by hand any that did not arrive. | ئەپەکە لە ساتی ناردنی ئەمانەدا پەیوەندی لەگەڵ واتسئاپ پچڕا، بۆیە نازانێت گەیشتوون یان نا. هەرگیز خۆیان دووبارە نانێردرێنەوە. ئەو گفتوگۆیانە لە مۆبایلەکەت ببینە و ئەوانەی نەگەیشتوون بە دەست بینێرە. | ئەپ د چرکا هنارتنا ڤان دا پەیوەندی دگەل واتسئاپێ ژێکڤەبوو، لەوما نزانیت گەهشتینە یان نە. چو جاران ب خۆ دووبارە ناهێنە هنارتن. وان گفتوگۆیان ل مۆبایلا خۆ ببینە و ئەوێن نەگەهشتین ب دەستێ خۆ بهنێرە. |
| Download CSV | داگرتنی CSV | داگرتنا CSV |
| ★ Add STOP replies to the do-not-contact list | وەڵامەکانی STOP بخە سەر لیستی پەیوەندی نەکردن | بەرسڤێن STOP بێخە سەر لیستا پەیوەندی نەکرنێ |
| ★ Do-not-contact list | لیستی پەیوەندی نەکردن | لیستا پەیوەندی نەکرنێ |
| Use again as a new broadcast | دووبارە وەک ناردنێکی گشتی نوێ بەکاری بهێنەوە | دووبارە وەک ناردنەکا گشتی یا نوو بکاربینە |
| Nobody here. | کەس لێرە نییە. | کەس ل ڤێرێ نینە. |
| Result | ئەنجام | ئەنجام |
| The first {n} are shown. The CSV has everyone. | تەنها یەکەم {n} پیشان دەدرێن. فایلی CSV هەمووانی تێدایە. | بتنێ {n} یێن ئێکێ دهێنە نیشاندان. فایلا CSV هەمی تێدا هەنە. |
| Past broadcasts | ناردنە گشتییەکانی پێشوو | ناردنێن گشتی یێن بۆری |
| No broadcasts yet. | هێشتا هیچ ناردنێکی گشتی نییە. | هێشتا چو ناردنێن گشتی نینن. |
| Open the report | ڕاپۆرتەکە بکەرەوە | ڕاپۆرتێ ڤەکە |
| Use again | دووبارە بەکاربهێنەوە | دووبارە بکاربینە |
| Nobody on this list gets a broadcast from this computer, whatever list they are on. People who reply STOP are added here. | هیچ کەسێک لەم لیستەدا هیچ ناردنێکی گشتی لەم کۆمپیوتەرەوە وەرناگرێت، لە هەر لیستێکدا بێت. ئەوانەی وەڵامی STOP دەدەنەوە لێرە زیاد دەکرێن. | چو کەس د ڤێ لیستێ دا چو ناردنێن گشتی ژ ڤی کۆمپیوتەری وەرناگریت، د هەر لیستەکێ دا بیت. ئەوێن بەرسڤا STOP ددەن ل ڤێرێ دهێنە زێدەکرن. |
| Add a number | ژمارەیەک زیاد بکە | ژمارەکێ زێدە بکە |
| Nobody is on the list. | کەس لە لیستەکەدا نییە. | کەس ل سەر لیستێ نینە. |
| Take off the list | لە لیستەکە لابە | ژ لیستێ لابە |
| Take {phone} off the list | {phone} لە لیستەکە لابە | {phone} ژ لیستێ لابە |
