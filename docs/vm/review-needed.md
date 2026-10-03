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
