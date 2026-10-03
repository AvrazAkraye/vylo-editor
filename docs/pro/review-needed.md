# Strings that need a native speaker

Each package appends a section: the English key, and the Sorani (ckb) and Badini (kmr) translations that were written best-effort. Arabic is expected to be good.

## 01 Check

The quality check's chip, its menu and its tips (`MotionChecks.tsx`, `motioncheck.ts`). `{seconds}`, `{other}`,
`{percent}`, `{ratio}`, `{count}`, `{n}` are filled in; `{other}` is a layer's name. Arabic was written with
care; Sorani and Badini are best effort. Points to check: "tip" is ئامۆژگاری (ckb) and شیرەت (kmr); a second is چرکە;
"contrast" is جیاوازی (ckb) and جوداهی (kmr); the frame is چوارچێوە (ckb) and فرەیم (kmr), as elsewhere in the app.

| English | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| Part of this runs off the edge of the frame. | بەشێک لەمە لە لێواری چوارچێوەکە دەردەچێت. | پشکەک ژ ڤێ ژ لێڤا فرەیمی دەردکەڤیت. |
| These words are very close to the edge, where a phone or a player can cover them. | ئەم وشانە زۆر نزیکی لێوارن، لەو شوێنەی مۆبایل یان لێدەر دەتوانێت دایانپۆشێت. | ئەڤ پەیڤە گەلەک نێزیکی لێڤێنە، ل جهەکێ مۆبایل یان لێدەر دشێت وان ڤەشێریت. |
| Some of this chart’s labels are cut short to fit. | هەندێک لە ناونیشانەکانی ئەم هێڵکارییە کورت کراونەتەوە تا جێیان ببێتەوە. | هندەک ژ ناڤنیشانێن ڤێ هێلکارییێ هاتینە کورتکرن دا جهێ وان ببیت. |
| These words are wider than their box. | ئەم وشانە لە چوارچێوەکەیان پانترن. | ئەڤ پەیڤە ژ چوارچۆڤێ خۆ پانترن. |
| These words overlap “{other}” for {seconds} s. | ئەم وشانە بۆ ماوەی {seconds} چرکە دەکەونە سەر «{other}». | ئەڤ پەیڤە بۆ ماوێ {seconds} چرکە دکەڤنە سەر «{other}». |
| “{other}” covers {percent}% of these words. | «{other}» {percent}%ی ئەم وشانە دادەپۆشێت. | «{other}» {percent}% ژ ڤان پەیڤان ڤەدشێریت. |
| These words are hard to read against what is behind them (contrast {ratio} to 1). | خوێندنەوەی ئەم وشانە لەسەر ئەوەی لە پشتیانە قورسە (جیاوازی {ratio} بۆ 1). | خواندنا ڤان پەیڤان ل سەر یا ل پشت وان زەحمەتە (جوداهی {ratio} بۆ 1). |
| This type is small enough to be hard to read on a phone. | ئەم نووسینە ئەوەندە بچووکە کە لەسەر مۆبایل بە زەحمەت دەخوێندرێتەوە. | ئەڤ نڤیسینە هندە بچویکە کو ل سەر مۆبایلێ ب زەحمەت دهێتە خواندن. |
| These words are on screen for less than half a second. | ئەم وشانە کەمتر لە نیو چرکە لەسەر شاشەن. | ئەڤ پەیڤە کێمتر ژ نیڤ چرکەیێ ل سەر شاشێ دمینن. |
| There is not enough time to read these words: {seconds} s, where about {needed} s is needed. | کات بەس نییە بۆ خوێندنەوەی ئەم وشانە: {seconds} چرکە، لە کاتێکدا نزیکەی {needed} چرکە پێویستە. | دەم بەس نینە بۆ خواندنا ڤان پەیڤان: {seconds} چرکە، و نێزیکی {needed} چرکە پێدڤینە. |
| Nothing appears until {seconds} s; the first half second is when a viewer decides to stay. | هیچ شتێک دەرناکەوێت تا {seconds} چرکە؛ نیو چرکەی یەکەم ئەو کاتەیە کە بینەر بڕیار دەدات بمێنێتەوە. | چ تشت دیار نابیت هەتا {seconds} چرکە؛ نیڤ چرکەیا ئێکێ ئەو دەمە یێ بینەر بڕیار ددەت بمینیت. |
| The last {seconds} s show nothing. | دوایین {seconds} چرکە هیچ پیشان نادەن. | دوماهیک {seconds} چرکە چ تشتی نیشان نادەن. |
| Nothing is on screen for {seconds} s. | بۆ ماوەی {seconds} چرکە هیچ لەسەر شاشە نییە. | بۆ ماوێ {seconds} چرکە چ تشت ل سەر شاشێ نینە. |
| Nothing moves for {seconds} s. | بۆ ماوەی {seconds} چرکە هیچ ناجووڵێت. | بۆ ماوێ {seconds} چرکە چ تشت نالڤیت. |
| {count} separate texts are on screen at once; fewer read faster. | {count} دەقی جیاواز پێکەوە لەسەر شاشەن؛ کەمتر خێراتر دەخوێندرێتەوە. | {count} دەقێن جودا پێکڤە ل سەر شاشێنە؛ کێمتر زووتر دهێنە خواندن. |
| Move it inside | بیگوازەرەوە ناوەوە | بیگوهێزە ناڤدا |
| Move it in | کەمێک بیهێنە ناوەوە | هندەکێ بینە ناڤدا |
| Use a clearer colour | ڕەنگێکی ڕوونتر بەکاربهێنە | ڕەنگەکێ ڕۆنتر بکاربینە |
| Make it larger | گەورەتری بکە | مەزنتر لێ بکە |
| Keep it on screen longer | زیاتر لەسەر شاشە بیهێڵەرەوە | پتر ل سەر شاشێ بهێلە |
| Trim the end | کۆتاییەکەی ببڕە | دوماهیێ ببڕە |
| Quality check | پشکنینی کوالیتی | پشکنینا کوالیتیێ |
| Looks good | باش دیارە | باش دیارە |
| 1 tip | 1 ئامۆژگاری | 1 شیرەت |
| {n} tips | {n} ئامۆژگاری | {n} شیرەت |
| Tips for this graphic | ئامۆژگاری بۆ ئەم گرافیکە | شیرەت بۆ ڤی گرافیکی |
| Fix all | هەمووی چاک بکە | هەمیان چاک بکە |
| The whole graphic | هەموو گرافیکەکە | هەمی گرافیک |
| This one needs a change by hand. | ئەمە پێویستی بە گۆڕانکاریی دەستی هەیە. | ئەڤە پێدڤی ب گوهۆڕینەکا دەستی یە. |
| Worth fixing: | شایەنی چاککردنە: | هێژایی چاککرنێیە: |
