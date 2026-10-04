# Translations that need a native reader

Each package appends its own section. Arabic was written with care; Sorani (`ckb`) and Badini (`kmr`) are best effort.

## Package `ask`

### `app/src/i18n.ts` (after `// vm ask` at the end of each dictionary)

| English | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| Looked up on the web: {query} | لە وێب گەڕا بۆ: {query} | ل سەر وێبێ هاتە گەڕیان بۆ: {query} |
| The web cannot be searched on this connection, so nothing was looked up. | لەسەر ئەم پەیوەندییە گەڕان لە وێب ناکرێت، بۆیە بە دوای هیچدا نەگەڕا. | ل سەر ڤێ پەیوەندیێ گەڕیان ل وێبێ ناهێتە کرن، لەوما ل چ تشتی نەهاتە گەڕیان. |
| The gateway does not allow web search here, so nothing was looked up. | دەروازەکە لێرە ڕێگە بە گەڕانی وێب نادات، بۆیە بە دوای هیچدا نەگەڕا. | دەرگەه ل ڤێرێ دەستویریێ نادەتە گەڕیانا وێبێ، لەوما ل چ تشتی نەهاتە گەڕیان. |
| Nothing usable was found on the web for {query}. | هیچ شتێکی بەکەڵک لە وێب نەدۆزرایەوە بۆ {query}. | چ تشتەکێ ب کێر ل سەر وێبێ نەهاتە دیتن بۆ {query}. |
| The facts in this graphic come from these pages: | زانیارییەکانی ئەم گرافیکە لەم پەڕانەوە هاتوون: | زانیاریێت ڤێ گرافیکێ ژ ڤان پەڕان هاتینە: |

"Looking it up…" and "Sources" were already in the catalogue (Video's Facts tab) and are reused as they are.

### SAFETY, the Motion paragraph ("A motion graphic contacts no one but the model you ask")

One sentence added after the one that names `app/src/generate.ts`:

- **English:** When you ask Motion for facts it does not have — "add today's LLM models" — the model may search the
  web through the gateway: that request carries Anthropic's own web-search tool, as the Video panel's lookup does
  (`app/src/motionresearch.ts`), the search happens at Anthropic, and the pages' addresses are shown under the answer
  and kept with the graphic.
- **SAFETY.ckb.md:** کاتێک داوای زانیارییەک لە پانێڵی جووڵە دەکەیت کە نییەتی — «مۆدێلە زمانییە گەورەکانی ئەمڕۆ زیاد
  بکە» — لەوانەیە مۆدێلەکە لە ڕێگەی دەروازەکەوە لە وێب بگەڕێت: ئەو داواکارییە ئامرازی گەڕانی وێبی خودی Anthropic
  هەڵدەگرێت، وەک پشکنینی پانێڵی ڤیدیۆ (`app/src/motionresearch.ts`)، گەڕانەکە لای Anthropic ڕوودەدات، و ناونیشانی
  پەڕەکان لە ژێر وەڵامەکەدا پیشان دەدرێن و لەگەڵ گرافیکەکەدا هەڵدەگیرێن.
- **SAFETY.kmr.md:** دەمێ تو ژ پانێلا لڤینێ زانیاریەکێ دخوازی یا وێ نەی — «مۆدێلێت زمانی یێت مەزن یێت ئەڤرۆ زێدە
  بکە» — دبیت مۆدێل ب رێکا دەرگەهی ل سەر وێبێ بگەڕیت: ئەو داخواز ئامیرێ گەڕیانا وێبێ یێ Anthropic بخۆ هەلدگریت،
  وەکی پشکنینا پانێلا ڤیدیۆیێ (`app/src/motionresearch.ts`)، گەڕیان ل دەڤ Anthropic دبیت، و ناڤونیشانێت پەڕان ل بن
  بەرسڤێ دهێنە نیشاندان و دگەل گرافیکێ دهێنە پاراستن.
## Package `video` (vm): graphics from Motion in the film

Sorani (ckb) and Badini (kmr) are best effort; Arabic was written with care. Terms follow the existing catalogue: Motion is
"جووڵە" (ckb) and "لڤین" (kmr) as the studio is named elsewhere; a graphic is "گرافیک"; a scene "دیمەن"; the film "ڤیدیۆ".
Source: `app/src/i18n.ts`, the entries under `// vm video` in each dictionary.

| English | Sorani (ckb) | Badini (kmr) |
|---|---|---|
| Motion graphic | گرافیکی جووڵە | گرافیکا لڤینێ |
| A graphic you made in Motion — a title, a lower third, a number — across the whole frame. | گرافیکێک کە لە جووڵە دروستت کردووە — ناونیشانێک، سێیەکی خوارەوە، ژمارەیەک — بە هەموو چوارچێوەکەدا. | گرافیکەک تە د لڤینێ دا چێکری — ناڤونیشانەک، سێیەکا ژێرێ، ژمارەیەک — ل سەر هەمی چوارچۆڤەیێ. |
| Choose a graphic for the new scene | گرافیکێک بۆ دیمەنە نوێیەکە هەڵبژێرە | گرافیکەکێ بۆ دیمەنێ نوی هەلبژێرە |
| This film already holds {n} graphics, the most it can. Take one out of the film first. | ئەم ڤیدیۆیە {n} گرافیکی تێدایە، کە زۆرترینە. سەرەتا یەکێکیان لە ڤیدیۆکە دەربهێنە. | ئەڤ ڤیدیۆیە {n} گرافیک تێدانە، کو پترینە. بەری هەمییان ئێکێ ژ ڤیدیۆیێ دەربێخە. |
| This graphic is too large to put in a film: more than 1.5 MB, usually from a big picture in it. Use a smaller picture in Motion and try again. | ئەم گرافیکە زۆر گەورەیە بۆ دانانی لە ڤیدیۆدا: زیاتر لە 1.5 مێگابایت، زۆرجار بەهۆی وێنەیەکی گەورەوە تێیدا. لە جووڵەدا وێنەیەکی بچووکتر بەکاربهێنە و دووبارە هەوڵ بدەرەوە. | ئەڤ گرافیکە گەلەک مەزنە بۆ دانانێ د ڤیدیۆیێ دا: پتر ژ 1.5 مێگابایت، پترییا جاران ژ بەر وێنەیەکێ مەزن تێدا. د لڤینێ دا وێنەیەکێ بچووکتر بکاربینە و جارەکا دی هەول بدە. |
| This graphic could not be read. | ئەم گرافیکە نەخوێندرایەوە. | ئەڤ گرافیکە نەهاتە خواندن. |
| Reading your saved graphics… | خوێندنەوەی گرافیکە پاشەکەوتکراوەکانت… | خواندنا گرافیکێن تە یێن پاشەکەفتکری… |
| You have no saved graphics yet. Make one in Motion and it will be here. | هێشتا هیچ گرافیکێکی پاشەکەوتکراوت نییە. یەکێک لە جووڵە دروست بکە و لێرە دەردەکەوێت. | هێشتا چ گرافیکێن پاشەکەفتکری ل دەف تە نینن. ئێکێ د لڤینێ دا چێبکە و دێ ل ڤێرە بیت. |
| A copy goes into the film: changing the graphic in Motion later does not change this film. | کۆپییەکی دەچێتە ناو ڤیدیۆکەوە: گۆڕینی گرافیکەکە لە جووڵە دواتر ئەم ڤیدیۆیە ناگۆڕێت. | کۆپیەکا وێ دچیتە د ڤیدیۆیێ دا: گوهۆرینا گرافیکی د لڤینێ دا پشتی نوکە ڤی ڤیدیۆیی ناگوهۆریت. |
| This graphic’s own sound is not part of the film yet. | دەنگی تایبەتی ئەم گرافیکە هێشتا بەشێک نییە لە ڤیدیۆکە. | دەنگێ تایبەت یێ ڤی گرافیکی هێشتا نە پشکەکە ژ ڤیدیۆیێ. |
| This graphic is no longer in the film. | ئەم گرافیکە ئیتر لە ڤیدیۆکەدا نییە. | ئەڤ گرافیکە ئێدی د ڤیدیۆیێ دا نینە. |
| A graphic from Motion, {n} long. | گرافیکێک لە جووڵەوە، بە درێژیی {n}. | گرافیکەک ژ لڤینێ، ب درێژیا {n}. |
| The graphic was changed in Motion after it was put in this film. | گرافیکەکە لە جووڵەدا گۆڕدرا دوای ئەوەی خرایە ناو ئەم ڤیدیۆیەوە. | گرافیک د لڤینێ دا هاتە گوهۆرین پشتی کو د ڤی ڤیدیۆیی دا هاتییە دانان. |
| Update from Motion | نوێکردنەوە لە جووڵەوە | نووکرن ژ لڤینێ |
| Repeat it while the scene lasts | دووبارەی بکەرەوە تا دیمەنەکە تەواو دەبێت | دووبارە بکە هەتا دیمەن ب دوماهی دهێت |
| Choose the graphic this scene plays | ئەو گرافیکە هەڵبژێرە کە ئەم دیمەنە پیشانی دەدات | وی گرافیکی هەلبژێرە یێ ئەڤ دیمەنە نیشان ددەت |
| Graphic on top | گرافیک لەسەر دیمەنەکە | گرافیک ل سەر دیمەنی |
| A lower third or a title from Motion, over this scene. | سێیەکی خوارەوە یان ناونیشانێک لە جووڵەوە، لەسەر ئەم دیمەنە. | سێیەکا ژێرێ یان ناڤونیشانەک ژ لڤینێ، ل سەر ڤی دیمەنی. |
| Starts at (seconds into the scene) | دەست پێدەکات لە (چرکە لە دیمەنەکەدا) | دەستپێدکەت ل (چرکە د دیمەنی دا) |
| It plays once, from that second, over the scene. | یەک جار پیشان دەدرێت، لەو چرکەیەوە، لەسەر دیمەنەکە. | ئێک جار دهێتە نیشاندان، ژ وێ چرکێ، ل سەر دیمەنی. |
| Choose the graphic on top of this scene | ئەو گرافیکە هەڵبژێرە کە لەسەر ئەم دیمەنەیە | وی گرافیکی هەلبژێرە یێ ل سەر ڤی دیمەنی |
| Choose a graphic to put on top of this scene | گرافیکێک هەڵبژێرە بۆ دانانی لەسەر ئەم دیمەنە | گرافیکەکێ هەلبژێرە بۆ دانانێ ل سەر ڤی دیمەنی |

## Review of package ask (docs/vm/review-ask.md)

The SAFETY sentence above was corrected in all four languages: the search goes **through the same route** as the model
(the gateway, or a provider the person added on the Anthropic wire — not always "the gateway"), and it is **one more
request**, carrying of what the person wrote only a few search words the model chose; what the pages state goes back to
the model in one last request. "The same route" reuses each translation's own words from the Video paragraph
(ar «عبر المسار نفسه», ckb «لە ڕێگەی هەمان ڕێڕەوەوە», kmr «ب رێکا هەمان رێڕەوی»). Arabic checked; Sorani and Badini best
effort, to be read by a native speaker:

- **English:** … the model may search the web through the same route: one more request carries Anthropic's own
  web-search tool, as the Video panel's lookup does (`app/src/motionresearch.ts`), and of what you wrote only a few
  search words the model chose; the search happens at Anthropic, what the pages state goes back to the model in one
  last request, and the pages' addresses are shown under the answer and kept with the graphic.
- **SAFETY.ckb.md:** … لەوانەیە مۆدێلەکە لە ڕێگەی هەمان ڕێڕەوەوە لە وێب بگەڕێت: داواکارییەکی تر ئامرازی گەڕانی وێبی
  خودی Anthropic هەڵدەگرێت، وەک پشکنینی پانێڵی ڤیدیۆ (`app/src/motionresearch.ts`)، و لەوەی تۆ نووسیوتە تەنها چەند
  وشەیەکی گەڕان هەڵدەگرێت کە مۆدێلەکە هەڵیبژاردوون؛ گەڕانەکە لای Anthropic ڕوودەدات، ئەوەی پەڕەکان دەیڵێن لە
  داواکارییەکی کۆتاییدا دەگەڕێتەوە بۆ مۆدێلەکە، و ناونیشانی پەڕەکان لە ژێر وەڵامەکەدا پیشان دەدرێن و لەگەڵ
  گرافیکەکەدا هەڵدەگیرێن.
- **SAFETY.kmr.md:** … دبیت مۆدێل ب رێکا هەمان رێڕەوی ل سەر وێبێ بگەڕیت: داخوازەکا دی ئامیرێ گەڕیانا وێبێ یێ
  Anthropic بخۆ هەلدگریت، وەکی پشکنینا پانێلا ڤیدیۆیێ (`app/src/motionresearch.ts`)، و ژ وێ یا تە نڤیسی تنێ چەند
  پەیڤێت گەڕیانێ هەلدگریت یێت مۆدێلی هەلبژارتین؛ گەڕیان ل دەڤ Anthropic دبیت، ئەوا پەڕە دبێژن د داخوازەکا دویماهیێ دا
  دزڤریتە مۆدێلی، و ناڤونیشانێت پەڕان ل بن بەرسڤێ دهێنە نیشاندان و دگەل گرافیکێ دهێنە پاراستن.
## Review of package `video` (vm-r-video)

### SAFETY, "Motion graphics are not one of them either" — one sentence added after "Deleting one in the panel deletes it there."

English: *A graphic you put in a video is copied into that video, any picture in it included, and kept with it in `vylo-video`: deleting the graphic here does not delete that copy; deleting the video does, and so does taking the graphic out of every scene of the video, once the app has started again and that video is next saved.*

| Sorani (ckb) | Badini (kmr) |
|---|---|
| گرافیکێک کە دەیخەیتە ناو ڤیدیۆیەکەوە کۆپی دەکرێتە ناو ئەو ڤیدیۆیە، هەر وێنەیەکی ناویشی لەگەڵدا، و لەگەڵیدا لە `vylo-video` دا هەڵدەگیرێت: سڕینەوەی گرافیکەکە لێرە ئەو کۆپییە ناسڕێتەوە؛ سڕینەوەی ڤیدیۆکە دەیسڕێتەوە، هەروەها لابردنی گرافیکەکە لە هەموو دیمەنەکانی ڤیدیۆکە، دوای ئەوەی ئەپەکە دووبارە دەست پێدەکاتەوە و ئەو ڤیدیۆیە جارێکی تر پاشەکەوت دەکرێت. | گرافیکەکا تو دکەیە د ناڤ ڤیدیۆیەکێ دا دهێتە کۆپیکرن بۆ وێ ڤیدیۆیێ، دگەل هەر وێنەیەکێ تێدا، و دگەل وێ د `vylo-video` دا دهێتە پاراستن: ژێبرنا گرافیکێ ل ڤێرێ وێ کۆپیێ ژێنابەت؛ ژێبرنا ڤیدیۆیێ وێ ژێدبەت، و هەروەسا لابرنا گرافیکێ ژ هەمی دیمەنێت ڤیدیۆیێ، پشتی ئەپ دیسا دەست پێ دکەت و ئەو ڤیدیۆ جارەکا دی دهێتە پاشەکەفتکرن. |
