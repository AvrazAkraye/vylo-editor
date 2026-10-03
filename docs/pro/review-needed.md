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
## 06 Gallery and brand kit

The interface strings (MotionHome.tsx, MotionBrandKit.tsx). Arabic is in `i18n.ts`.

| English | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| No template matches “{words}”. | هیچ قاڵبێک لەگەڵ «{words}» ناگونجێت. | چو قالب ل گەل «{words}» ناگونجیت. |
| Recently used | ئەوانەی دوایی بەکارهاتوون | یێن دوماهیێ هاتینە بکارئینان |
| Search the templates | لە قاڵبەکاندا بگەڕێ | د قالبان دا لێبگەڕێ |
| Search {n} templates | لە {n} قاڵبدا بگەڕێ | د {n} قالبان دا لێبگەڕێ |
| {n} templates found | قاڵبە گونجاوەکان: {n} | قالبێن گونجای: {n} |
| Brand kit | ناسنامەی براند | ناسناما براندی |
| Brand kit: {name} | ناسنامەی براند: {name} | ناسناما براندی: {name} |
| New graphics start in your colours, font and name. | گرافیکە نوێیەکان بە ڕەنگ و فۆنت و ناوی تۆ دەست پێ دەکەن. | گرافیکێن نوی ب ڕەنگ و فۆنت و ناڤێ تە دەست پێ دکەن. |
| Your organisation | ڕێکخراوەکەت | ڕێکخراوا تە |
| Each template’s own | هی خودی هەر قاڵبێک | یێن هەر قالبەکی بخۆ |
| Your own colours | ڕەنگەکانی خۆت | ڕەنگێن تە بخۆ |
| Headline font | فۆنتی سەردێڕ | فۆنتێ سەرنڤیسێ |
| Each template keeps the colours it was designed in. | هەر قاڵبێک ئەو ڕەنگانە دەهێڵێتەوە کە پێی دیزاین کراوە. | هەر قالبەک وان ڕەنگان دپارێزیت یێن پێ هاتییە دیزاینکرن. |
| The text colour is hard to read on this background. | خوێندنەوەی ڕەنگی نووسین لەسەر ئەم باکگراوندە قورسە. | خواندنا ڕەنگێ نڤیسینێ ل سەر ڤێ پاشبنەمایێ زەحمەتە. |
| The brand kit could not be kept on this machine. It lasts until the app closes. | ناسنامەی براند لەسەر ئەم ئامێرە پاشەکەوت نەکرا. تا داخستنی بەرنامەکە دەمێنێتەوە. | ناسناما براندی ل سەر ڤی ئامیری نەهاتە پاراستن. هەتا گرتنا بەرنامەی دمینیت. |
| Apply to this graphic | لەسەر ئەم گرافیکە جێبەجێی بکە | ل سەر ڤی گرافیکی جێبەجێ بکە |
| Clear the brand kit? | ناسنامەی براند بسڕدرێتەوە؟ | ناسناما براندی ژێببەی؟ |
| New graphics will start in each template’s own colours and words again. Graphics already made keep theirs. | گرافیکە نوێیەکان دووبارە بە ڕەنگ و وشەکانی خودی هەر قاڵبێک دەست پێ دەکەن. گرافیکە دروستکراوەکان هی خۆیان دەهێڵنەوە. | گرافیکێن نوی دێ دیسا ب ڕەنگ و پەیڤێن هەر قالبەکی بخۆ دەست پێ کەن. گرافیکێن هاتینە چێکرن یێن خۆ دپارێزن. |

Search words (`LOCAL_WORDS` in `motionsearch.ts`): never shown, only matched against what is typed, so a wrong word
costs a missed or a stray result, not a wrong label. Words people actually type for each template are what is wanted.

| Template | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| big-title | ناونیشان، سەردێڕ، دەستپێک، بەش، ڕاگەیاندن | سەرناڤ، ناڤونیشان، دەستپێک، پشک، ڕاگەهاندن |
| kinetic | وشەی جووڵاو، دروشم، داشکاندن، ڕیکلام، بانگەشە | پەیڤێن لڤۆک، دروشم، داشکاندن، ڕێکلام |
| split-title | دەرخستن، بەش، گواستنەوە، ناونیشان | ئاشکەراکرن، پشک، ڤەگوهاستن، سەرناڤ |
| quote | وتە، گوتە، بۆچوون، هەڵسەنگاندن | گۆتن، بۆچوون، هەلسەنگاندن |
| lower-third | ناو، ناوی کەس، ناساندن، قسەکەر، چاوپێکەوتن، پێشکەشکار | ناڤ، ناڤێ کەسی، ناساندن، ئاخڤەر، چاڤپێکەفتن |
| subscribe | بەشداربوون، سبسکرایب، دوگمە، زەنگ، فۆڵۆ، کەناڵ، یوتیوب | بەشداربوون، سبسکرایب، دوگمە، زەنگ، فۆلۆ، کەنال، یوتیوب |
| callout | ئاماژە، تیر، نیشانە، ڕوونکردنەوە | ئاماژە، تیر، نیشان، ڕوونکرن |
| handle | هەژمار، ناوی بەکارهێنەر، سۆشیال میدیا، ئینستاگرام، تیکتۆک | هژمار، ناڤێ بکارهێنەری، سۆشیال میدیا، ئینستاگرام، تیکتۆک |
| big-number | ژمارە، ژمێرەر، ئامار، ڕێژە، گەشە | ژمارە، ژمێرەر، ئامار، ڕێژە، گەشە |
| bar-chart | هێڵکاری، چارت، ستوون، بەراوردکردن، داتا، ئەنجام | چارت، ستوین، بەراوردکرن، داتا، ئەنجام |
| donut | بازنە، پشک، ڕێژەی سەدی، دابەشبوون | بازنە، پشک، ڕێژا سەدی |
| line-chart | هێڵ، ڕەوت، گەشە، پەرەسەندن، مانگانە | هێل، ڕەوت، گەشە، پێشکەفتن، هەیڤانە |
| stats | ئامارەکان، ژمارەکان، دەستکەوت، ڕاستی | ئامار، ژمارە، دەستکەفت، ڕاستی |
| logo-reveal | لۆگۆ، براند، کۆمپانیا، ناسنامە، کۆتایی | لۆگۆ، براند، کۆمپانی، ناسنامە، دوماهی |
| countdown | ژماردنی پێچەوانە، کاتژمێر، دەستپێکردن، بۆنە، ساڵی نوێ | هژمارتنا بەرەڤاژی، دەمژمێر، دەستپێکرن، بۆنە، سالا نوی |
| intro | دەستپێک، پێشەکی، ئینترۆ، کەناڵ | دەستپێک، پێشەکی، ئینترۆ، کەنال |
| steps | هەنگاو، لیست، ڕێگا، ڕێنمایی، قۆناغ | پێنگاڤ، لیست، ڕێک، ڕێنمایی، قوناغ |
| loop-bg | باکگراوند، پاشبنەما، دووبارە، نەخش، ڕەنگاوڕەنگ | باکگراوند، پاشبنەما، دووبارە، نەخش |
## 07 Templates A (lower thirds, notifications, chat, device, hand-drawn circle)

Interface strings: template names, descriptions, field labels and the layer names the timeline shows (`app/src/i18n.ts`, under `// Motion pro: 07 templates-a`). Arabic was written to be correct; these Sorani and Badini ones are best effort.

| English key | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| News bar | شریتی هەواڵ | شریتا نووچەیان |
| Soft pill | کەپسوولی نەرم | کەپسوولا نەرم |
| Kicker and name | تاگ و ناو | ئێتیکەت و ناڤ |
| Neon name | ناوی نیۆن | ناڤێ نیۆن |
| Notification stack | کۆمەڵە ئاگادارکردنەوە | کۆما ئاگەهدارکرنان |
| Hand-drawn circle | بازنەی دەستکێشراو | بازنەیا ب دەستی کێشای |
| Chat conversation | گفتوگۆی نامە | ئاخفتنا نامەیان |
| Device frame | چوارچێوەی ئامێر | چوارچۆڤا ئامیرێ |
| A sweep of colour reveals a name bar, the role on a strip below. | ڕەنگێک دەخشێت و شریتی ناو دەردەخات، پۆستەکەش لەسەر شریتێک لە خوارەوە. | ڕەنگەک دخشیت و شریتا ناڤی ئاشکرا دکەت، پۆست ژی ل سەر شریتەکێ ل خوارێ. |
| A rounded pill with an icon, a name and a role, that springs in. | کەپسوولێکی خڕ بە ئایکۆن و ناو و پۆستەوە، کە بە بازدان دێتە ژوورەوە. | کەپسوولەکا خڕ ب ئایکۆن و ناڤ و پۆستی، کو ب بازدان دهێتە ژوور. |
| A small tag above a big name, an underline that draws, and a role. | تاگێکی بچووک لەسەر ناوێکی گەورە، هێڵێک کە لە ژێرییەوە دەکێشرێت، و پۆست. | ئێتیکەتەکا بچویک ل سەر ناڤەکێ مەزن، هێلەک کو ل ژێر دهێتە کێشان، و پۆست. |
| A glowing outline traces itself around a name and a role. | چوارچێوەیەکی گەشاوە خۆی بە دەوری ناو و پۆستێکدا دەکێشێت. | چوارچۆڤەکا گەش خۆ ل دۆر ناڤ و پۆستەکێ دکێشیت. |
| Up to three notification cards that drop in one after another. | تا سێ کارتی ئاگادارکردنەوە کە یەک لە دوای یەک دادەبەزن. | هەتا سێ کارتێن ئاگەهدارکرنێ کو ئێک ل دویف ئێک دادکەڤن. |
| A marker circle draws itself, with an arrow and a short note. | بازنەیەکی ماژیک خۆی دەکێشێت، لەگەڵ تیرێک و تێبینییەکی کورت. | بازنەیەکا ماژیکێ خۆ دکێشیت، دگەل تیرەکێ و تێبینیەکا کورت. |
| A conversation in bubbles, with typing dots before each reply. | گفتوگۆیەک لە بڵقدا، لەگەڵ خاڵەکانی نووسین پێش هەر وەڵامێک. | ئاخفتنەک د بلقان دا، دگەل خالێن نڤیسینێ بەری هەر بەرسڤەکێ. |
| A phone, or a browser window when wide, with your headline beside it. | مۆبایلێک، یان لە چوارچێوەی پاندا پەنجەرەی وێبگەڕ، و سەردێڕەکەت لە تەنیشتی. | مۆبایلەک، یان د چوارچۆڤا پان دا پەنجەرا وێبگەڕی، و سەردێڕا تە ل تەنشت. |
| Circled word | وشەی ناو بازنە | پەیڤا د بازنێ دا |
| Note | تێبینی | تێبینی |
| Contact name | ناوی کەسەکە | ناڤێ کەسی |
| Messages | نامەکان | نامە |
| On the screen | لەسەر شاشە | ل سەر شاشێ |
| Address bar | شریتی ناونیشان | شریتا ناڤنیشانێ |
| Arrowhead | سەری تیر | سەرێ تیری |
| Avatar | وێنەی کەس | وێنێ کەسی |
| Avatar letter | پیتی وێنەی کەس | تیپا وێنێ کەسی |
| Browser window | پەنجەرەی وێبگەڕ | پەنجەرا وێبگەڕی |
| Colour sweep | خشانی ڕەنگ | خشاندنا ڕەنگی |
| Colour sweep leaving | خشانی ڕەنگ لە کاتی ڕۆیشتن | خشاندنا ڕەنگی دەمێ چوونێ |
| Divider | جیاکەرەوە | جوداکەر |
| Glow flicker | لەرزینی شەوق | لەرزینا شەوقێ |
| Kicker tag | تاگی نووسینی بچووک | ئێتیکەتا ناڤێ بچووک |
| Lock | قوفڵ | قفل |
| Name plate | تەختەی ناو | تەختێ ناڤی |
| Neon tube | بۆڕی نیۆن | بۆریا نیۆنێ |
| Role strip | شریتی پۆست | شریتا پۆستی |
| Screen light | ڕووناکی شاشە | ڕۆناهیا شاشێ |
| Second stroke | هێڵی دووەم | هێلا دووێ |
| Side button | دوگمەی تەنیشت | دوگما تەنشتێ |
| Travelling light | ڕووناکی گەڕۆک | ڕۆناهیا گەڕۆک |
| Window button | دوگمەی پەنجەرە | دوگما پەنجەرێ |
| Word on the screen | وشەی سەر شاشە | پەیڤا سەر شاشێ |
| First notification | ئاگادارکردنەوەی یەکەم | ئاگەهدارکرنا ئێکێ |
| First notification glass | شووشەی ئاگادارکردنەوەی یەکەم | شووشا ئاگەهدارکرنا ئێکێ |
| First notification icon | ئایکۆنی ئاگادارکردنەوەی یەکەم | ئایکۆنا ئاگەهدارکرنا ئێکێ |
| First notification title | سەردێڕی ئاگادارکردنەوەی یەکەم | سەردێڕا ئاگەهدارکرنا ئێکێ |
| First notification time | کاتی ئاگادارکردنەوەی یەکەم | دەمێ ئاگەهدارکرنا ئێکێ |
| First notification text | دەقی ئاگادارکردنەوەی یەکەم | نڤیسینا ئاگەهدارکرنا ئێکێ |
| Second notification | ئاگادارکردنەوەی دووەم | ئاگەهدارکرنا دووێ |
| Second notification glass | شووشەی ئاگادارکردنەوەی دووەم | شووشا ئاگەهدارکرنا دووێ |
| Second notification icon | ئایکۆنی ئاگادارکردنەوەی دووەم | ئایکۆنا ئاگەهدارکرنا دووێ |
| Second notification title | سەردێڕی ئاگادارکردنەوەی دووەم | سەردێڕا ئاگەهدارکرنا دووێ |
| Second notification time | کاتی ئاگادارکردنەوەی دووەم | دەمێ ئاگەهدارکرنا دووێ |
| Second notification text | دەقی ئاگادارکردنەوەی دووەم | نڤیسینا ئاگەهدارکرنا دووێ |
| Third notification | ئاگادارکردنەوەی سێیەم | ئاگەهدارکرنا سێیێ |
| Third notification glass | شووشەی ئاگادارکردنەوەی سێیەم | شووشا ئاگەهدارکرنا سێیێ |
| Third notification icon | ئایکۆنی ئاگادارکردنەوەی سێیەم | ئایکۆنا ئاگەهدارکرنا سێیێ |
| Third notification title | سەردێڕی ئاگادارکردنەوەی سێیەم | سەردێڕا ئاگەهدارکرنا سێیێ |
| Third notification time | کاتی ئاگادارکردنەوەی سێیەم | دەمێ ئاگەهدارکرنا سێیێ |
| Third notification text | دەقی ئاگادارکردنەوەی سێیەم | نڤیسینا ئاگەهدارکرنا سێیێ |
| Their message | نامەی بەرامبەر | نامەیا لایێ دی |
| Their message text | دەقی نامەی بەرامبەر | نڤیسینا نامەیا لایێ دی |
| Your message | نامەکەت | نامەیا تە |
| Your message text | دەقی نامەکەت | نڤیسینا نامەیا تە |
| Typing bubble | بڵقی نووسین | بلقا نڤیسینێ |
| Typing dot | خاڵۆکەی نووسین | خالۆکا نڤیسینێ |

### 07 template samples (the words each template starts with, `app/src/motionrecipes-pro-a.ts`)

These are drawn in the gallery and in every new graphic, so they matter as much as the interface strings.

| Template, field | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| News bar: name, role | دارا حەسەن · بەرهەمهێنەری مەیدانی، سلێمانی | دارا حەسەن · بەرهەمهێنەرێ مەیدانی، زاخۆ |
| Soft pill: name, role | شیلان عومەر · پێشکەشکاری مێزی بەیانی | شیلان عومەر · پێشکێشکارا مێزا سپێدێ |
| Kicker: tag, name, role | میوان · د. ئارام کەریم · زانای کەشوهەوا، زانکۆی دهۆک | مێڤان · د. ئارام کەریم · زانایێ کەش و هەوایێ، زانکۆیا دهۆکێ |
| Neon: name, role | ڕێزان عەلی · دیجەی و بەرهەمهێنەری مۆسیقا | ڕێزان عەلی · دیجەی و بەرهەمهێنەرێ مۆزیکێ |
| Notifications (3 lines) | نامەی نوێ: ئەمشەو هێشتا بەرنامەکەمان ماوە؟ / داواکارییەکەت نێردرا: پاکەتەکەت لە ڕێگادایە / بیرخستنەوە: پەیوەندیی تیم دوای 10 خولەک | نامەیەکا نوو: ئەڤشەڤ هێشتا ژڤانا مە یا هەی؟ / داخوازیا تە هاتە هنارتن: پاکێتا تە د ڕێکێ دایە / بیرئینان: پەیوەندیا تیمێ پشتی 10 خولەکان |
| Notifications: the word for "now" on each card | ئێستا | نوکە |
| Hand-drawn circle: word, note | نوێ · تازە گەیشت! | نوو · نوکە گەهشت! |
| Chat: contact, messages | لانا · لانا: ئەمشەو دێیت بۆ ئاهەنگی ناساندنەکە؟ / من: بە هیچ شێوەیەک لەدەستی نادەم! کەی دەست پێدەکات؟ / لانا: دەرگاکان کاتژمێر 7 و نمایشەکە کاتژمێر 8 / من: نایابە، لەوێ دەتبینم | لانا · لانا: ئەڤشەڤ دێ هێیە ئاهەنگا ناساندنێ؟ / ئەز: ب چ ڕەنگان ژ دەست نادەم! کەنگی دەست پێدکەت؟ / لانا: دەرگەه دەمژمێر 7 و نمایش دەمژمێر 8 / ئەز: زۆر باشە، ل وێرێ دێ تە بینم |
| Chat: the word a person writes for their own side | من | ئەز (and من) |
| Device: title, subtitle, screen | ستۆدیۆکەت لە گیرفانتدایە · دەستکاری بکە، هەناردە بکە و لە هەر شوێنێک بڵاوی بکەرەوە · نوور | ستۆدیۆیا تە د بەریکا تە دایە · دەستکاری بکە، هەناردە بکە و ژ هەر جهەکی بەلاڤ بکە · نوور |

The notification icons are also chosen from words in the title (`ICON_WORDS`): نامە، پەیام (message), نێردرا، گەیاندن، پاکەت، هنارتن (delivery), داواکاری، داخوازی، کڕین (order), پارە (money), کۆبوونەوە، ژڤان (meeting), بیرخستنەوە، بیرئینان، خولەک (reminder), لایک، خۆشەویست (like), فۆڵۆ، هاوڕێ، هەڤاڵ (follow), هەڵسەنگاندن (review), براوە، خەڵات (win), دیاری (gift), پەیوەندی، تەلەفۆن (call), تەواو، پەسەند (done). A native speaker may know better words people actually write in a notification.
## 09 Export and sharing

The destinations, the GIF and More options (MotionExport.tsx, motionshare.ts). Arabic was written with care; these Sorani and Badini lines are best effort.

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Where is it going? | بۆ کوێ دەچێت؟ | دێ بۆ کیرێ چیت؟ |
| Story or Reel | ستۆری یان ڕیڵ | ستۆری یان ڕیل |
| Post | پۆست | پۆست |
| YouTube | یوتیوب | یوتیوب |
| Web loop | لووپی وێب | لووپا وێبێ |
| Custom | دڵخواز | دلخواز |
| Tall {ratio} video for phones | ڤیدیۆی درێژی {ratio} بۆ مۆبایل | ڤیدیۆیا درێژ یا {ratio} بۆ مۆبایلان |
| {ratio} video for a feed | ڤیدیۆی {ratio} بۆ فیید | ڤیدیۆیا {ratio} بۆ فیدێ |
| Wide {ratio} video | ڤیدیۆی پانی {ratio} | ڤیدیۆیا پان یا {ratio} |
| A GIF that plays on repeat | GIFێک کە بەردەوام دووبارە دەبێتەوە | GIFەک کو بەردەوام دووبارە دبیت |
| A PNG of its best moment | PNGێک لە باشترین ساتەکەی | PNGەک ژ باشترین دەمێ وێ |
| Every setting, your choice | هەموو ڕێکخستنەکان بە هەڵبژاردنی خۆت | هەمی ڕێکخستن ب هەلبژارتنا تە |
| More options | هەڵبژاردەی زیاتر | هەلبژارتنێن پتر |
| Download GIF | داگرتنی GIF | داگرتنا GIF |
| Export GIF | هەناردەکردنی GIF | دەرئێخستنا GIF |
| Rendering the GIF… | دروستکردنی GIFەکە… | دروستکرنا GIFێ… |
| Making the GIF smaller to fit… | بچووککردنەوەی GIFەکە تا جێی ببێتەوە… | بچووککرنا GIFێ دا جهێ وێ ببیت… |
| The GIF could not be made in this window. | GIFەکە لەم پەنجەرەیەدا دروست نەکرا. | GIF د ڤێ پەنجەرێ دا نەهاتە چێکرن. |
| It is still larger than {n} MB: make the graphic shorter, or choose a smaller size under More options. | هێشتا لە {n} مێگابایت گەورەترە: گرافیکەکە کورتتر بکەرەوە، یان لە «هەڵبژاردەی زیاتر» قەبارەیەکی بچووکتر هەڵبژێرە. | هێشتا ژ {n} مێگابایتان مەزنترە: گرافیکی کورتتر بکە، یان ژ «هەلبژارتنێن پتر» قەبارەکا بچووکتر هەلبژێرە. |
| {n} colours | {n} ڕەنگ | {n} ڕەنگ |
| {w} × {h} pixels | {w} × {h} پیکسڵ | {w} × {h} پیکسل |
| {n} frames a second | {n} فرەیم لە چرکەیەکدا | {n} فرەیم د چرکەیەکێ دا |
| Made smaller to stay under {n} MB: {what}. | بچووک کرایەوە تا لە ژێر {n} مێگابایت بمێنێتەوە: {what}. | هاتە بچووککرن دا ل بن {n} مێگابایتان بمینیت: {what}. |
| Built again from its template at {to} for this file. Your graphic stays {from}. | بۆ ئەم فایلە لە قاڵبەکەیەوە بە {to} دووبارە دروست کرایەوە. گرافیکەکەت هەر {from} دەمێنێتەوە. | بۆ ڤی فایلی ژ قالبێ وێ ب {to} ژ نوی هاتە چێکرن. گرافیکێ تە هەر {from} دمینیت. |
| Fitted whole inside a {to} frame for this file, on its own background. Your graphic stays {from}. | بۆ ئەم فایلە بە تەواوی خرایە ناو چوارچێوەیەکی {to}، لەسەر باکگراوندی خۆی. گرافیکەکەت هەر {from} دەمێنێتەوە. | بۆ ڤی فایلی ب تەمامی هاتە دانان د ناڤ چوارچێوەکا {to} دا، ل سەر پاشبنەمایا خۆ. گرافیکێ تە هەر {from} دمینیت. |
| A GIF runs {n} seconds at most: the first {n} are saved. | GIF لە {n} چرکە درێژتر نابێت: یەکەم {n} چرکە پاشەکەوت دەکرێت. | GIF ژ {n} چرکەیان درێژتر نابیت: {n} چرکەیێن ئێکێ دهێنە پاشەکەفتکرن. |
| about {n} MB | نزیکەی {n} مێگابایت | نێزیکی {n} مێگابایت |
| about {time} to make | دروستکردنی نزیکەی {time} دەخایەنێت | چێکرنا وێ نێزیکی {time} دڤێت |
| It may be made smaller to stay under {n} MB. | لەوانەیە بچووک بکرێتەوە تا لە ژێر {n} مێگابایت بمێنێتەوە. | دبیت بهێتە بچووککرن دا ل بن {n} مێگابایتان بمینیت. |
| The longest side, in pixels. A smaller GIF opens sooner in a chat. | درێژترین لا، بە پیکسڵ. GIFی بچووکتر زووتر لە چاتدا دەکرێتەوە. | درێژترین لا، ب پیکسلان. GIFا بچووکتر زووتر د چاتێ دا ڤەدبیت. |
| Fewer frames a second make a smaller file; 15 is smooth for most loops. | فرەیمی کەمتر لە چرکەیەکدا فایلێکی بچووکتر دروست دەکات؛ 15 بۆ زۆربەی لووپەکان نەرمە. | فرەیمێن کێمتر د چرکەیەکێ دا فایلەکێ بچووکتر چێدکەن؛ 15 بۆ پرانییا لووپان نەرمە. |
| Its best moment | باشترین ساتی | باشترین دەمێ وێ |
| At the playhead | لە سەر نیشاندەری لێدان | ل جهێ نیشاندەرێ لێدانێ |
| The moment it reads best: {time}. | ئەو ساتەی باشترین دەردەکەوێت: {time}. | ئەو دەمێ کو باشترین دیار دبیت: {time}. |
| A GIF has no soft edges: each pixel is either shown or not. | GIF لێواری نەرمی نییە: هەر پیکسڵێک یان دیارە یان نا. | GIF لێڤێن نەرم نینن: هەر پیکسلەک یان دیارە یان نە. |
## 08 Templates B and visuals

Interface strings (template names and descriptions, field labels, layer names; also the names the inspector will give
the new backdrop and chart kinds). Arabic was written with care; Sorani and Badini are best effort.

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Film look | ڕووکاری فیلم | شێوەیێ فیلمی |
| Film grain, a soft vignette and warm light leaks to lay over your video. | دانەی فیلم، لێوارێکی نەرم و تاریک و دزەی ڕووناکیی گەرم، بۆ دانان لەسەر ڤیدیۆکەت. | دەنکێن فیلمی، لێڤێن نەرم و تاری و دزەیا ڕووناهیا گەرم، بۆ دانانێ ل سەر ڤیدیۆیا تە. |
| Bar chart race | پێشبڕکێی ستوونەکان | پێشبڕکێیا ستوینان |
| Bars that race each other over the years, overtaking as the numbers change. | ستوونگەلێک کە بە درێژایی ساڵان پێشبڕکێ دەکەن و لەگەڵ گۆڕانی ژمارەکان یەکتر تێدەپەڕێنن. | ستوینێن د درێژاهیا سالان دا پێشبڕکێ دکەن و دگەل گوهۆڕینا ژماران ئێک و دو دەرباس دکەن. |
| Milestones with their dates along a line that draws itself. | قۆناغە گرنگەکان بە بەروارەکانیانەوە لەسەر هێڵێک کە خۆی دەکێشێت. | قوناغێن گرنگ ب دیرۆکێن خۆ ل سەر هێلەکێ کو خۆ دکێشیت. |
| Before and after | پێش و دوای | بەری و پشتی |
| Two sides, before and after, with a handle that wipes across to reveal the change. | دوو لا، پێش و دوای، لەگەڵ دەسکێک کە بەسەریاندا دەخزێت و گۆڕانکارییەکە دەردەخات. | دوو لا، بەری و پشتی، دگەل دەسکەکێ کو ل سەر وان دخزیت و گوهۆڕینێ دیار دکەت. |
| Price card | کارتی نرخ | کارتا بهایی |
| A plan, its price counting up, three things it includes and a button. | پلانێک، نرخەکەی بە ژماردن بەرز دەبێتەوە، سێ شت کە لەخۆی دەگرێت و دوگمەیەک. | پلانەک، بهایێ وێ ب ژمارتنێ بلند دبیت، سێ تشتێن تێدا و دوگمەیەک. |
| Progress rings | ئەڵقەکانی پێشکەوتن | ئەلقەیێن پێشکەفتنێ |
| Up to four rings that fill to their percentage, each with its label. | تا چوار ئەڵقە کە تا ڕێژەی خۆیان پڕ دەبنەوە، هەریەکە بە ناوی خۆیەوە. | هەتا چار ئەلقە کو هەتا ڕێژەیا خۆ تژی دبن، هەر ئێک ب ناڤێ خۆ. |
| Retro screen | شاشەی کۆن | شاشەیا کەڤن |
| A title that switches on like an old television, with scan lines and a halftone glow. | ناونیشانێک کە وەک تەلەفزیۆنێکی کۆن دادەگیرسێت، بە هێڵی سکان و درەوشانەوەی خاڵدار. | سەرناڤەک کو وەک تەلەڤزیۆنەکا کەڤن هەلدبیت، ب هێلێن سکانێ و درەوشینا خالدار. |
| Racers | پێشبڕکێکاران | پێشبڕکێکەر |
| Periods | ماوەکان | ماوە |
| Before | پێشتر | بەری |
| Words before | دەقی پێشتر | دەقێ بەری |
| After | دواتر | پشتی |
| Words after | دەقی دواتر | دەقێ پشتی |
| Price | نرخ | بها |
| Rings | ئەڵقەکان | ئەلقە |
| Light leak | دزەی ڕووناکی | دزەیا ڕووناهیێ |
| Vignette | تاریکیی لێوارەکان | تاریاتیا لێڤان |
| Grain | دانە | دەنک |
| Race | پێشبڕکێ | پێشبڕکێ |
| Period | ماوە | ماوە |
| Milestone | قۆناغ | قوناغ |
| Stem | هێڵی پەیوەست | هێلا گرێدانێ |
| Event | ڕووداو | ڕووداو |
| Card | کارت | کارت |
| Before pill | نیشانەی پێشتر | نیشانا بەری |
| Before label | ناونیشانی پێشتر | ناڤێ بەری |
| Before words | وشەکانی پێشتر | پەیڤێن بەری |
| After panel | پانێڵی دواتر | پانێلا پشتی |
| Divider | جیاکەرەوە | جوداکەر |
| Knob | دەسک | دەسک |
| After pill | نیشانەی دواتر | نیشانا پشتی |
| After label | ناونیشانی دواتر | ناڤێ پشتی |
| After words | وشەکانی دواتر | پەیڤێن پشتی |
| Plan pill | نیشانەی پلان | نیشانا پلانێ |
| Price period | ماوەی نرخ | ماوەیا بهایی |
| Feature | تایبەتمەندی | تایبەتمەندی |
| Button label | دەقی دوگمە | دەقێ دوگمەیێ |
| Halftone | تۆڕی خاڵدار | تۆڕا خالدار |
| Title glow | درەوشانەوەی ناونیشان | درەوشینا سەرناڤی |
| Scan lines | هێڵەکانی سکان | هێلێن سکانێ |

Template samples (the words a template shows before the person writes any; the gallery draws with them).

| template.field | English | ckb (Sorani) | kmr (Badini) |
|---|---|---|---|
| film-look.caption | A summer in the mountains | هاوینێک لە چیاکان | هاڤینەک ل چیایان |
| bar-race.title | Fruit sold each year | میوەی فرۆشراو هەموو ساڵێک | فێقیێن هاتینە فرۆتن هەر سال |
| bar-race.items | Apples: 40, 55, 72, 90, 112, 126 / Oranges: 28, 44, 70, 95, 128, 160 / Grapes: 52, 60, 64, 69, 73, 78 / Figs: 15, 30, 48, 66, 85, 108 / Pears: 22, 31, 40, 52, 61, 70 / Lemons: 10, 18, 35, 49, 58, 86 | سێو: 40, 55, 72, 90, 112, 126 / پرتەقاڵ: 28, 44, 70, 95, 128, 160 / ترێ: 52, 60, 64, 69, 73, 78 / هەنجیر: 15, 30, 48, 66, 85, 108 / هەرمێ: 22, 31, 40, 52, 61, 70 / لیمۆ: 10, 18, 35, 49, 58, 86 | سێڤ: 40, 55, 72, 90, 112, 126 / پرتەقال: 28, 44, 70, 95, 128, 160 / تری: 52, 60, 64, 69, 73, 78 / هەژیر: 15, 30, 48, 66, 85, 108 / هرمی: 22, 31, 40, 52, 61, 70 / لیمۆن: 10, 18, 35, 49, 58, 86 |
| bar-race.unit | t | تەن | تەن |
| timeline.title | Our story | چیرۆکی ئێمە | چیرۆکا مە |
| timeline.items | 2016: Founded in one small room / 2018: Our first hundred customers / 2021: A team of twenty / 2024: Open in three new cities | 2016: دەستپێک لە ژوورێکی بچووک / 2018: یەکەم سەد کڕیارمان / 2021: تیمێکی بیست کەسی / 2024: کرانەوە لە سێ شاری نوێ | 2016: دەستپێک د ژوورەکا بچووک دا / 2018: ئێکەمین سەد کڕیارێن مە / 2021: تیمەکێ بیست کەسی / 2024: ڤەبوون ل سێ باژێرێن نوو |
| compare.before | Before | پێشتر | بەری نوکە |
| compare.beforeText | Paper forms and long queues | فۆڕمی کاغەز و ڕیزی درێژ | فۆرمێن کاغەزی و ڕیزێن درێژ |
| compare.after | After | ئێستا | نوکە |
| compare.afterText | One tap on your phone | تەنها یەک دەستلێدان لە مۆبایلەکەت | تنێ ئێک تکاندن ل سەر مۆبایلا تە |
| price-card.plan | Pro | پرۆ | پرۆ |
| price-card.price | $19/month | 19$/مانگانە | 19$/هەیڤانە |
| price-card.features | Unlimited projects / Export in full HD / Priority support | پرۆژەی بێسنوور / هەناردەکردن بە کوالیتی بەرز / پشتگیریی لەپێشینە | پرۆژێن بێ سنوور / هەناردەکرن ب کوالیتییا بلند / پشتەڤانییا ب پێشینە |
| price-card.button | Start free trial | تاقیکردنەوەی بێبەرامبەر | تاقیکرنا بێ بەرامبەر |
| progress-stats.title | This term at a glance | ئەم وەرزە بە کورتی | ئەڤ وەرزە ب کورتی |
| progress-stats.items | Attendance: 92% / Homework done: 78% / Exams passed: 85% / Projects: 64% | ئامادەبوون: 92% / ئەرکی تەواوکراو: 78% / دەرچوون لە تاقیکردنەوە: 85% / پرۆژەکان: 64% | ئامادەبوون: 92% / ئەرکێن ب دوماهی هاتین: 78% / دەرباسبوون د ئەزموونان دا: 85% / پرۆژە: 64% |
| retro-title.title | Retro night | شەوی بیرەوەری | شەڤا بیرهاتنان |
| retro-title.subtitle | Live from the studio | ڕاستەوخۆ لە ستۆدیۆوە | ڕاستەوخۆ ژ ستۆدیۆیێ |

## W2-1 Panel wiring (`MotionKinds.tsx`: the finishes' sliders, the race's data)

Arabic is checked; Sorani and Badini are best effort. The slider names are what each finish's two sliders do (see
`motionbackdrop.ts`, "Grounds and finishes"): a film grain's coarseness and how fast it flickers, a vignette's reach and
its slow breathing, how strong light leaks are and how many times they bloom, how fine scan lines are and how many times
their band rolls down, how fine a halftone screen is and how its light flows.

| English | ar | ckb (Sorani) | kmr (Badini) |
|---|---|---|---|
| Coarseness | الخشونة | زبری | زڤری |
| Flicker | الارتعاش | لەرزین | لەرزین |
| Reach | المدى | مەودا | مەودا |
| Breathing | التنفّس | هەناسە | بێهن |
| Blooms | التوهّجات | گەشانەوە | گەشبوون |
| Fineness | الدقّة | وردی | هویری |
| Rolls | مرور الشريط | تێپەڕینی تیشک | دەرباسبوونا تیشکێ |
| Flow | الانسياب | ڕەوت | هەرکین |
| Earlier values go in the label after a \|, like Rome\|12 18 25. The value is the last one. | تُكتب القيم السابقة في التسمية بعد \|، مثل روما\|12 18 25. والقيمة هي الأخيرة. | بەهاکانی پێشوو لە ناونیشانەکەدا دوای \| دەنووسرێن، وەک ڕۆما\|12 18 25. بەهاکە دوایینیانە. | بهایێن بەری د ناڤونیشانیدا پشتی \| دهێنە نڤیسین، وەکی ڕۆما\|12 18 25. بها یا دوماهیێ یە. |
## W2-2 Export wiring (sound in the film, what the file carries; SAFETY)

The sound lines and the saved-without-sound notice (`MotionExport.tsx`). Arabic was written with care; these Sorani and Badini lines are best effort.

| English | ckb (Sorani) | kmr (Badini) |
|---|---|---|
| Saved without sound: this computer cannot make the audio track. | بێ دەنگ پاشەکەوت کرا: ئەم کۆمپیوتەرە ناتوانێت تراکی دەنگ دروست بکات. | بێ دەنگ هاتە پاشەکەفتکرن: ئەڤ کۆمپیوتەرە نەشێت تراکا دەنگی چێبکەت. |
| Preparing the sound… | ئامادەکردنی دەنگەکە… | ئامادەکرنا دەنگی… |
| Without sound: a GIF cannot carry it. | بێ دەنگ: GIF ناتوانێت دەنگ هەڵبگرێت. | بێ دەنگ: GIF نەشێت دەنگی هەلگریت. |
| Without sound: a picture has none. | بێ دەنگ: وێنە دەنگی نییە. | بێ دەنگ: وێنەی چ دەنگ نینە. |
| With sound: effects made from the animation. | لەگەڵ دەنگ: ئێفێکتی دروستکراو لە جووڵەکەوە. | دگەل دەنگی: ئێفێکتێن ژ لڤینێ هاتینە چێکرن. |
| With sound: music ({mood}). | لەگەڵ دەنگ: مۆسیقا ({mood}). | دگەل دەنگی: مۆسیقا ({mood}). |
| With sound: effects and music ({mood}). | لەگەڵ دەنگ: ئێفێکت و مۆسیقا ({mood}). | دگەل دەنگی: ئێفێکت و مۆسیقا ({mood}). |

**SAFETY, all three translations.** Three places changed in each of `SAFETY.ar.md`, `SAFETY.ckb.md` and `SAFETY.kmr.md`, mirroring
`SAFETY.md`: the Motion paragraph under *What reaches the network* (the GIF writer, and one new sentence on sound: made on this
machine from the graphic itself, encoded by the window's own AAC encoder, nothing downloaded or sent, Motion still contacts no one
but the model); the `export_write_video` bullet (`.gif` accepted, a GIF that does not begin `GIF89a` or `GIF87a` refused, 64 MiB
for a poster or a GIF, Motion writes an MP4, a GIF or a PNG); and the `open_exported` bullet (`.gif` opened). The Arabic was
written with care but not by a native speaker; the Sorani and Badini sentences, the sound sentence above all, are best effort and
need a native speaker before a release. The parity test (`test/i18n.test.mjs`) holds the identifiers and the shape, not the prose.

## Integration: SAFETY storage sentence (brand kit)

The sentence about the brand kit (`vylo-motion-brand`) in `SAFETY.ckb.md` and `SAFETY.kmr.md` is best effort: "کیتی براند / کیتا براندی" for "brand kit", and the rest. Arabic and English are the reference.

## R5 Content review: Sorani and Badini points to check

Review R5 (`docs/pro/review-content.md`) read the Pro pass's Arabic closely and fixed 28 values. It did not change any
Sorani or Badini string: the points below are where the same English source produced a mistake in Arabic, or where
something looked odd on screen, and a native speaker should decide. Nothing here is a confirmed error.

| Where | English | Sorani (ckb) now | Badini (kmr) now | Why it is worth a look |
|---|---|---|---|---|
| Price card sample (`motionrecipes-pro-b.ts`) | `$19/month` | `19$/مانگانە` | `19$/هەیڤانە` | The slash already says "per"; the Arabic `19$/شهرياً` ("per monthly") was changed to `19$/شهر`. Perhaps `19$/مانگ` and `19$/هەیڤ`? |
| Kinetic type sample (`motionrecipes-titles.ts`) | Start small, dream big | `بچووک دەست پێبکە، گەورە خەون ببینە` | `ب بچویکی دەست پێبکە، خەونێن مەزن ببینە` | The Sorani puts the adjectives before the verbs, like the English; the Badini says "with smallness … great dreams". Is the Sorani natural? The highlighted word (`گەورە`) must stay a word of the title. |
| Countdown sample (`motionrecipes-overlays.ts`) | GO | `دەست پێبکە` | `دەست پێ بکە` | The same verb written joined in one and apart in the other: right for each dialect's spelling? A shorter word (one line) would also sit better in the ring. |
| Export (`i18n.ts`) | Where is it going? | `بۆ کوێ دەچێت؟` | `دێ بۆ کیرێ چیت؟` | In Arabic, "where is it going" read as a question about a person travelling; it now asks where the file will be published. Does the Kurdish read as "which platform is this for"? |
| Check (`i18n.ts`) | {count} separate texts are on screen at once; fewer read faster. | `… کەمتر خێراتر دەخوێندرێتەوە.` | `… کێمتر زووتر دهێنە خواندن.` | The Arabic "fewer read faster" was a calque ("the fewer the texts, the faster they are read" now). The Kurdish follows the English word for word. |
| Scenes (`i18n.ts`) | Whip pan | `سووڕانی خێرا` | `زڤڕینا لەز` | A whip pan is a quick turn of the camera. The Arabic `انعطافة` (a bend in a road) was wrong; is "fast turning" right here, or is there a camera term? |
| Panel (`i18n.ts`) | Flicker (the grain's) | `لەرزین` | `لەرزین` | `لەرزین` is trembling or shaking; this slider is how fast film grain flickers. The Arabic `الارتعاش` (trembling) became `الوميض` (flicker). |
| Templates (`i18n.ts`) | Kicker tag | `تاگی نووسینی بچووک` | `ئێتیکەتا ناڤێ بچووک` | It is the small tag above the name. "Tag of the small writing / of the small name": clear enough? |
| Templates (`i18n.ts`) | Price period | `ماوەی نرخ` | `ماوەیا بهایی` | The layer holds "/month". The Arabic "duration of the price" was odd and became "payment period" (`فترة الدفع`). |
| Templates (`i18n.ts`) | Chat conversation | `گفتوگۆی نامە` | `ئاخفتنا نامەیان` | Fine in meaning; is it the natural name for a text-message conversation? |
| Icon words (`motionrecipes-data.ts`) | village, volunteer | `گوند`, `خۆبەخش` (added) | (the same words are matched) | Added so "villages" gets a place pin and "volunteers" people, as in English and Arabic. Is `گوند` used in both dialects, and is there a Badini word for volunteer to add? |
