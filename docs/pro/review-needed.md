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
## 05 Scenes and transitions

The scene strip (`MotionScenes.tsx`). "Scene" is the word Video already uses (دیمەن); "transition" follows Video's
"Scene {n} hands over with" (ckb گواستنەوە, kmr ڤەگوهاستن); "graphic" follows the Motion studio (گرافیک). The names of the
transitions (push, clock wipe, blinds, pixelate, whip pan, light leak) are the least certain.

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Scene | دیمەن | دیمەن |
| Split here | لێرە دابەشی بکە | ل ڤێرە پارچە بکە |
| Transition | گواستنەوە | ڤەگوهاستن |
| Push across | پاڵنان | پالدان |
| Clock wipe | سڕینەوەی کاتژمێری | پاقژکرنا دەمژمێری |
| Blinds | پەردە | پەردە |
| Pixelate | پیکسڵکردن | پیکسلکرن |
| Whip pan | سووڕانی خێرا | زڤڕینا لەز |
| Light leak | دزەی ڕووناکی | دزەکرنا ڕووناهیێ |
| {kind}, {n} s | {kind}، {n} چ | {kind}، {n} چ |
| How {name} arrives | چۆنیەتی هاتنی {name} | چاوا {name} دهێت |
| How {name} arrives: {how} | چۆنیەتی هاتنی {name}: {how} | چاوا {name} دهێت: {how} |
| Join with the scene before | لەگەڵ دیمەنی پێشوو یەکی بخە | دگەل دیمەنێ بەری ڤێ بکە ئێک |
| Join with the scene after | لەگەڵ دیمەنی دواتر یەکی بخە | دگەل دیمەنێ پشتی ڤێ بکە ئێک |
| Scenes: {n} | دیمەنەکان: {n} | دیمەن: {n} |
| Cut the scene in two at the playhead | دیمەنەکە لە شوێنی نیشاندەری لێدان بکە بە دوو بەش | دیمەنی ل جهێ نیشاندەرێ لێدانێ بکە دوو پارچە |
| No room for another scene: a graphic is at most {s} s long and has at most {n} scenes | شوێن بۆ دیمەنێکی تر نییە: گرافیک لە {s} چ درێژتر نابێت و لە {n} دیمەن زیاتری نابێت | جه بۆ دیمەنەکێ دی نینە: گرافیک ژ {s} چ درێژتر نابیت و ژ {n} دیمەنان پتر نابن |
| A scene is cut at least {s} s from its ends, and a graphic has at most {n} scenes | دیمەن لانیکەم {s} چ دوور لە سەرەکانی دابەش دەکرێت، و گرافیک لە {n} دیمەن زیاتری نابێت | دیمەن ب کێمی {s} چ دویری سەرێن خۆ دهێتە پارچەکرن، و گرافیک ژ {n} دیمەنان پتر نابن |
| Left and right arrows go from scene to transition to scene. Enter opens one. Alt with an arrow moves a scene earlier or later; Delete joins it with its neighbour; F2 renames it. | تیری چەپ و ڕاست لە دیمەنەوە بۆ گواستنەوە و بۆ دیمەن دەچن. ‏Enter یەکێکیان دەکاتەوە. ‏Alt لەگەڵ تیرێک دیمەنەکە دەباتە پێشتر یان دواتر؛ ‏Delete لەگەڵ دراوسێکەی یەکی دەخات؛ ‏F2 ناوەکەی دەگۆڕێت. | تیرێن چەپ و ڕاست ژ دیمەنەکێ دچنە ڤەگوهاستنێ و پاشان دیمەنێ. ‏Enter ئێکێ ڤەدکەت. ‏Alt دگەل تیرەکێ دیمەنی دبەتە بەرێ یان پاشتر؛ ‏Delete وی دگەل جیرانێ وی دکەتە ئێک؛ ‏F2 ناڤێ وی دگوهۆڕیت. |
## 04 Sound (`MotionSoundPanel.tsx`)

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Effects | ئێفێکتەکان | ئێفێکت |
| Both | هەردووکیان | هەردوو |
| Level | ئاست | ئاست |
| Sounds made from the animation: a whoosh for a slide, ticks for a counter | دەنگ لە جووڵەکەوە دروست دەکرێن: فشەیەک بۆ خلیسکان، تیکتیک بۆ ژمێرەر | دەنگ ژ لڤینێ دهێنە چێکرن: فشەک بۆ خشکاندنێ، تیکتیک بۆ ژمارتنێ |
| Music composed for this graphic, on this computer | مۆسیقایەک بۆ ئەم گرافیکە، لەسەر ئەم کۆمپیوتەرە دادەنرێت | مۆسیقایەک بۆ ڤی گرافیکی، ل سەر ڤی کۆمپیوتەری دهێتە دانان |
| Effects over music | ئێفێکت لەسەر مۆسیقا | ئێفێکت ل سەر مۆسیقایێ |

"Effects" is the segment label (sound effects); "Both" means effects and music together; "Level" is how loud and how many.
The onomatopoeia ("whoosh", "ticks") was rendered as فشە / تیکتیک: please check a speaker finds them natural.
