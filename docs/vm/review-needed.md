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
