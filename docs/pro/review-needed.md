# Strings that need a native speaker

Each package appends a section: the English key, and the Sorani (ckb) and Badini (kmr) translations that were written best-effort. Arabic is expected to be good.

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
