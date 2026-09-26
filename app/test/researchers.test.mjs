// Researchers: whose way of writing a document is written in.
//
// Three things matter most. The numbers measured from a researcher's papers
// are exact and the same every time, in Arabic, Sorani, Badini and English —
// a connector typed on an Arabic keyboard is still that connector. The
// learning request describes manner and never content, inside its budget.
// And a request names a researcher only by their whole name, or part of it
// after "بأسلوب" and its kin — never by a name hidden inside a longer word.
import {
  CONNECTORS, LEARN_BUDGET, MAX_SAMPLES, MAX_SAMPLE_CHARS, PERSON_MARKERS,
  closeness, excerptsOf, fingerprint, guideText, langOfSamples, learnPrompt, newResearcher, parseGuide,
  readResearcher, sampleOf, stale, voiceIn, voiceOf,
} from '../.test-build/researchers.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// Letters that look alike, by code point, so nobody has to trust their eyes.
const ch = (n) => String.fromCharCode(n);
const KURDISH_AE = ch(0x6D5), ARABIC_HEH = ch(0x647), KURDISH_YEH = ch(0x6CC), ARABIC_YEH = ch(0x64A), KURDISH_OE = ch(0x6C6), WAW = ch(0x648);
/** Kurdish as typed on an Arabic keyboard: ە as ه, ی as ي, ۆ as و. */
const arabicKeyboard = (s) => s.split(KURDISH_AE).join(ARABIC_HEH).split(KURDISH_YEH).join(ARABIC_YEH).split(KURDISH_OE).join(WAW);

const r1 = (x) => Math.round(x * 10) / 10;
const sample = (text, id = 's' + Math.random().toString(36).slice(2), name = 'paper') => sampleOf({ id, name, text, now: 1 });

// Words that are content and nothing else in each language: no connector,
// no marker of person, no stop word.
const CONTENT = {
  ar: ['التعليم', 'المجتمع', 'الاقتصاد', 'الثقافة', 'التنمية', 'المعرفة', 'الإدارة', 'السياسة', 'الجامعة', 'المناهج', 'الطلبة', 'المؤسسات', 'البيئة'],
  ckb: ['پەروەردە', 'کۆمەڵگا', 'ئابووری', 'سیاسەت', 'کولتوور', 'زانست', 'گەشەپێدان', 'بەڕێوەبردن', 'زانکۆ', 'خوێندکاران', 'دامەزراوەکان', 'پرۆگرام', 'ژینگە'],
  kmr: ['پەروەردە', 'جڤاک', 'ئابووری', 'سیاسەت', 'کولتوور', 'زانین', 'ڤەژین', 'ئاڤاکرن', 'زانکۆ', 'خاندەڤان', 'دەڤەر', 'پرۆگرام', 'ڤەگوهاستن'],
  en: ['education', 'society', 'economy', 'culture', 'development', 'knowledge', 'management', 'policy', 'university', 'curriculum', 'students', 'institutions', 'environment'],
};
/** `words` words of content in paragraphs of `perPara`, sentences of ten. */
const fill = (lang, words, perPara = 50) => {
  const list = CONTENT[lang];
  const paras = [];
  let para = [], sentence = [], k = 0;
  for (let i = 0; i < words; i++) {
    sentence.push(list[(k++ * 7) % list.length]);
    if (sentence.length === 10 || i === words - 1) { para.push(sentence.join(' ') + '.'); sentence = []; }
    if ((i + 1) % perPara === 0 || i === words - 1) { if (para.length) paras.push(para.join(' ')); para = []; }
  }
  return paras.join('\n\n');
};
let seq = 0;
/** A word that occurs nowhere else: q and the counter in base 26, written in letters. */
const uniq = () => { let n = seq++, w = ''; do { w = 'abcdefghijklmnopqrstuvwxyz'[n % 26] + w; n = Math.floor(n / 26); } while (n); return 'q' + w; };
/** A sentence of `n` words that occur nowhere else. */
const fresh = (n) => Array.from({ length: n }, uniq).join(' ') + '.';
/** Paragraphs of `perPara` words of fresh sentences of ten. */
const freshParas = (paras, perPara) => Array.from({ length: paras }, () => Array.from({ length: perPara / 10 }, () => fresh(10)).join(' '));

// ── keeping a paper ───────────────────────────────────────────────────────
{
  const s = sample('  one  two\x07 three\r\n\r\n\r\n\r\nfour\tfive   \n  ', 'k1', '  My   paper\n.docx ');
  ok('control characters are removed', !s.text.includes('\x07'));
  ok('runs of spaces collapse to one', !/ {2}/.test(s.text));
  ok('CRLF becomes LF and 3+ newlines become 2', !s.text.includes('\r') && s.text.includes('three\n\nfour'), s.text);
  ok('the tab is kept', s.text.includes('four\tfive'));
  ok('trimmed at both ends', s.text === s.text.trim() && s.text.startsWith('one'));
  ok('words counted as the app counts them', s.words === 5, s.words);
  ok('the name on one line', s.name === 'My paper .docx', s.name);
  ok('id and added kept, not truncated', s.id === 'k1' && s.added === 1 && s.truncated === false);
  const nfd = 'caf' + 'e' + ch(0x301);
  ok('NFC: e + combining acute becomes é', sample(nfd).text === 'caf' + ch(0xE9));
}
{
  const body = fill('ar', 1200, 80);
  const refs = 'الجبوري، أحمد. التعليم والمجتمع. بغداد: دار الكتب، 2019.\n\nالعبيدي، سعد. الإدارة التربوية. الموصل، 2020.';
  const s = sample(`${body}\n\nالمصادر\n\n${refs}`);
  ok('a references section at the end is dropped', !s.text.includes('دار الكتب') && s.text === body.trim(), s.text.slice(-80));
  const numbered = sample(`${body}\n\nخامساً: المصادر والمراجع\n\n${refs}`);
  ok('under a numbered heading too', !numbered.text.includes('دار الكتب'));
  const en = sample(`${fill('en', 1000, 80)}\n\n## References\n\nSmith, J. (2019). Education. London.`);
  ok('"References" dropped in English', !en.text.includes('London'));
  const ckb = sample(`${fill('ckb', 1000, 80)}\n\nسەرچاوەکان\n\nعومەر، هێمن. پەروەردە. هەولێر، ٢٠٢١.`);
  ok('سەرچاوەکان dropped in Sorani', !ckb.text.includes('هەولێر'));
  const kmr = sample(`${fill('kmr', 1000, 80)}\n\nژێدەر\n\nمحەمەد، ئازاد. جڤاک. دهۆک، ٢٠٢٠.`);
  ok('ژێدەر dropped in Badini', !kmr.text.includes('دهۆک'));
  const early = sample(`${fill('ar', 100, 80)}\n\nالمصادر\n\n${fill('ar', 1000, 80)}`);
  ok('a sources heading early in the paper is not its reference list', early.text.includes('المصادر') && early.words > 1000);
  const inline = sample(`${body}\n\nتعتمد هذه الورقة على المصادر الأولية والوثائق الرسمية في تحليل الظاهرة المدروسة.`);
  ok('a sentence mentioning المصادر is not a heading', inline.text.includes('الوثائق الرسمية'));
}
{
  // Paragraphs of about 1,000 characters, each ending "END." and a blank line.
  const para = (i) => `${'lorem ipsum dolor sit amet '.repeat(36)}number ${i} END.`;
  const long = Array.from({ length: 200 }, (_, i) => para(i)).join('\n\n');
  const s = sample(long);
  ok('a paper over the limit is cut and says so', s.truncated === true && long.length > MAX_SAMPLE_CHARS);
  ok('to no more than MAX_SAMPLE_CHARS', s.text.length <= MAX_SAMPLE_CHARS, s.text.length);
  ok('at the end of a paragraph', long.startsWith(s.text) && long.slice(s.text.length, s.text.length + 2) === '\n\n' && s.text.endsWith('END.'));
  ok('and not far short of the limit', s.text.length >= MAX_SAMPLE_CHARS - 2000, s.text.length);
  const run = Array.from({ length: 4000 }, (_, i) => `This is sentence number ${i} of the text.`).join(' ');
  const t = sample(run);
  ok('with no paragraph break near the end, at the end of a sentence', t.truncated && t.text.endsWith('of the text.') && t.text.length <= MAX_SAMPLE_CHARS);
}

// ── the language of the papers ────────────────────────────────────────────
{
  ok('Arabic papers are Arabic', langOfSamples([sample(fill('ar', 300))]) === 'ar');
  ok('Sorani papers are Sorani', langOfSamples([sample(fill('ckb', 300))]) === 'ckb');
  ok('Badini papers are Badini', langOfSamples([sample(fill('kmr', 300))]) === 'kmr');
  ok('English papers are English', langOfSamples([sample(fill('en', 300))]) === 'en');
  ok('no papers: the fallback', langOfSamples([], 'ckb') === 'ckb' && langOfSamples([]) === 'en');
  ok('weighted by words: a long Arabic paper and a short English one are Arabic',
    langOfSamples([sample(fill('en', 100)), sample(fill('ar', 900))]) === 'ar');
  ok('an Arabic paper quoting one Kurdish title is still Arabic',
    langOfSamples([sample(`${fill('ar', 600)}\n\nکۆمەڵگا و پەروەردە لە هەرێمی کوردستان`)]) === 'ar');
}

// ── the fingerprint ───────────────────────────────────────────────────────
// Ten paragraphs of four sentences of 10, 20, 10 and 20 words: 600 words, 40
// sentences, a mean of 15 and a spread of exactly 5.
const exactParas = Array.from({ length: 10 }, () => [fresh(10), fresh(20), fresh(10), fresh(20)].join(' '));
const exact = fingerprint([sample(exactParas.join('\n\n'))]);
{
  ok('null under 150 words', fingerprint([sample(fresh(100))]) === null && fingerprint([]) === null);
  ok('words', exact.words === 600, exact.words);
  ok('sentences counted by hand', exact.sentences === 40, exact.sentences);
  ok('mean sentence length', exact.sentenceWords === 15, exact.sentenceWords);
  ok('sentence spread (standard deviation)', exact.sentenceSpread === 5, exact.sentenceSpread);
  ok('mean paragraph length', exact.paragraphWords === 60, exact.paragraphWords);
  ok('no lists', exact.lists === 0);
  ok('no questions', exact.questions === 0);
  ok('English', exact.lang === 'en');
  ok('all words different: richness 1', exact.richness === 1, exact.richness);

  const withBlocks = fingerprint([sample(['### A heading of a few words', ...exactParas.slice(0, 5), '- ' + fresh(12), '- ' + fresh(12), '| a | b |\n|---|---|\n| 1 | 2 |', ...exactParas.slice(5)].join('\n\n'))]);
  ok('headings, list items and table rows are not paragraphs', withBlocks.paragraphWords === 60 && withBlocks.sentences === 40, withBlocks);
  ok('lists: the share of blocks that are list items (2 of 12, 2 decimals)', withBlocks.lists === 0.17, withBlocks.lists);
  ok('list items count as words', withBlocks.words === 624, withBlocks.words);

  const pasted = fingerprint([sample(exactParas.join('\n'))]);
  ok('pasted with one paragraph per line: the same paragraphs', pasted.paragraphWords === 60 && pasted.sentences === 40, pasted);

  const tricky = `${exactParas.slice(0, 9).join('\n\n')}\n\nThe rate rose to 3.5 percent in the year the report was written by Dr. Smith and colleagues. ${fresh(5)}`;
  const t = fingerprint([sample(tricky)]);
  ok('3.5 and "Dr." do not end a sentence', t.sentences === 38, t.sentences);
  const arTitle = fingerprint([sample(`${fill('ar', 300)}\n\nيرى د. أحمد أن التعليم أساس المجتمع الحديث.`)]);
  const arPlain = fingerprint([sample(`${fill('ar', 300)}\n\nيرى أحمد أن التعليم أساس المجتمع الحديث.`)]);
  ok('nor does "د." before a name', arTitle.sentences === arPlain.sentences);

  const q = fingerprint([sample(`${exactParas.join('\n\n')}\n\nIs this ${fresh(8).replace('.', '?')} And ${fresh(8).replace('.', '?')}`)]);
  ok('questions per 1,000 words', q.questions === r1(2000 / q.words), [q.questions, q.words]);
  const arq = fingerprint([sample(`${fill('ar', 300)}\n\nما أثر التعليم في المجتمع؟ وكيف تتغير الثقافة؟`)]);
  ok('the Arabic question mark counts', arq.questions === r1(2000 / arq.words), arq.questions);
}

// How the writer refers to themselves, in each language.
{
  const person = (lang, extra) => fingerprint([sample(`${fill(lang, 300)}\n\n${extra}`)])?.person;
  ok('ar: I', person('ar', 'أرى أن التعليم مهم. وأعتقد أن المجتمع يتغير. ورأيي أن الثقافة أساس.') === 'I');
  ok('ar: we', person('ar', 'نرى أن التعليم مهم. ونعتقد أن المجتمع يتغير. وفي بحثنا نركز على الثقافة.') === 'we');
  ok('ar: impersonal', person('ar', 'يرى الباحث أن التعليم مهم. وترى الباحثة أن المجتمع يتغير. وتهدف هذه الدراسة إلى فهم الثقافة.') === 'impersonal');
  ok('ar: الباحثون (other researchers) is not the writer', person('ar', 'أرى أن التعليم مهم. ويرى الباحثون أن المجتمع يتغير. ويؤكد الباحثون ذلك.') === 'I');
  ok('ckb: I', person('ckb', 'من پێم وایە پەروەردە گرنگە. بە بڕوای من کۆمەڵگا دەگۆڕێت. بۆچوونی من ئەوەیە زانست بنەڕەتە.') === 'I');
  ok('ckb: we', person('ckb', 'ئێمە پێمان وایە پەروەردە گرنگە. بە بڕوای ئێمە کۆمەڵگا دەگۆڕێت. ئێمە زانست تاوتوێ دەکەین.') === 'we');
  ok('ckb: impersonal', person('ckb', 'توێژەر پێی وایە پەروەردە گرنگە. ئەم توێژینەوەیە کۆمەڵگا شی دەکاتەوە. لەم توێژینەوەیەدا زانست تاوتوێ دەکرێت.') === 'impersonal');
  ok('kmr: I', person('kmr', 'ئەز دبینم کو پەروەردە گرنگە. ب دیتنا من جڤاک دێ پێش کەڤیت. ڤەکۆلینا من ل سەر زانینێ یە.') === 'I');
  ok('kmr: we', person('kmr', 'ئەم دبینین کو پەروەردە گرنگە. ب دیتنا مە جڤاک دێ پێش کەڤیت. ڤەکۆلینا مە ل سەر زانینێ یە.') === 'we');
  ok('kmr: impersonal', person('kmr', 'ڤەکۆلەر دبینیت کو پەروەردە گرنگە. ئەڤ ڤەکۆلینە جڤاکێ شرۆڤە دکەت. د ڤێ ڤەکۆلینێ دا زانین هاتیە ڤەکۆلین.') === 'impersonal');
  ok('en: I', person('en', 'I argue that education matters. In my view society changes. My aim is to explain culture.') === 'I');
  ok('en: we', person('en', 'We argue that education matters. In our view society changes. Our aim is to explain culture.') === 'we');
  ok('en: impersonal', person('en', 'The researcher argues that education matters. This study examines society. The present study explains culture.') === 'impersonal');
  ok('en: the "i" of "i.e." is not "I"', person('en', 'Education, i.e. schooling, matters. Society, i.e. people, changes. Culture, i.e. habits, grows.') === 'impersonal');
  ok('no marker at all: impersonal', person('ar', '') === 'impersonal' && person('en', '') === 'impersonal');
}

// Connectors, folded and on word boundaries.
{
  const find = (fp, w) => fp.connectors.find((c) => c.word === w);
  const ar = fingerprint([sample(`${fill('ar', 300)}\n\nوعليه فإن التعليم مهم. ولذا يجب الإصلاح. فضلاً عن ذلك فإن الثقافة أساس. تعرف لذات الإنسان. ومن ثم تتغير المؤسسات.`)]);
  ok('ar: وعليه found', !!find(ar, 'وعليه'));
  ok('ar: ولذا counts as لذا, at its rate per 1,000 words', find(ar, 'لذا')?.per1000 === r1(1000 / ar.words), [find(ar, 'لذا'), ar.words]);
  ok('ar: ومن ثم counts as من ثم', !!find(ar, 'من ثم'));
  ok('ar: the longest connector wins — فضلاً عن ذلك, not also فضلاً عن', !!find(ar, 'فضلاً عن ذلك') && !find(ar, 'فضلاً عن'));
  ok('ar: لذات is not لذا', find(ar, 'لذا')?.per1000 === r1(1000 / ar.words));

  const typed = arabicKeyboard('هەروەها پەروەردە گرنگە. بۆیە کۆمەڵگا دەگۆڕێت. هەروەها زانست گەشە دەکات.');
  ok('the Arabic-keyboard text really uses Arabic heh and yeh', typed.includes(ARABIC_HEH + ARABIC_HEH) && typed.includes(ARABIC_YEH) && !typed.includes(KURDISH_AE));
  const ckb = fingerprint([sample(`${fill('ckb', 300)}\n\n${typed}\n\nلەبەرئەوەی ژینگە گرنگە، پرۆگرام پێویستە.`)]);
  ok('ckb: هەروەها typed with Arabic ه still counts', find(ckb, 'هەروەها')?.per1000 === r1(2000 / ckb.words), ckb.connectors);
  ok('ckb: بۆیە typed with Arabic ي and و still counts', !!find(ckb, 'بۆیە'));
  ok('ckb: لەبەرئەوەی written together counts as لەبەر ئەوەی', !!find(ckb, 'لەبەر ئەوەی'));
  ok('ckb: the most frequent first', ckb.connectors[0].word === 'هەروەها');

  const kmr = fingerprint([sample(`${fill('kmr', 300)}\n\nژبەر هندێ جڤاک گرنگە. ژ بەر هندێ زانین پێتڤییە. ب ڤی رەنگی پەروەردە پێش دکەڤیت.`)]);
  ok('kmr: ژبەر هندێ, together or apart', find(kmr, 'ژبەر هندێ')?.per1000 === r1(2000 / kmr.words), kmr.connectors);
  ok('kmr: ب ڤی رەنگی', !!find(kmr, 'ب ڤی رەنگی'));

  const en = fingerprint([sample(`${freshParas(20, 20).join('\n\n')}\n\nHowever, ${fresh(4)} However, ${fresh(4)} however ${fresh(4)} Moreover, ${fresh(4)} Therefore ${fresh(4)} Thus ${fresh(4)} Furthermore ${fresh(4)} In addition ${fresh(4)} Consequently ${fresh(4)} Nevertheless ${fresh(4)} For example ${fresh(4)} Indeed ${fresh(4)}`)]);
  ok('en: at most 8 connectors', en.connectors.length === 8, en.connectors);
  ok('en: the top one first, matched whatever its case', en.connectors[0].word === 'however' && en.connectors[0].per1000 === r1(3000 / en.words));
  ok('en: sorted by rate, every rate above 0', en.connectors.every((c, i, a) => c.per1000 > 0 && (i === 0 || a[i - 1].per1000 >= c.per1000)));
  const inside = fingerprint([sample(`${freshParas(20, 20).join('\n\n')}\n\nThe enthusiasm of the thusly named group is great.`)]);
  ok('en: "thus" inside "enthusiasm" is not "thus"', !find(inside, 'thus'));

  for (const lang of ['ar', 'ckb', 'kmr', 'en']) ok(`${lang}: at least 25 connectors listed`, CONNECTORS[lang].length >= 25, CONNECTORS[lang].length);
  ok('every language has markers for I, we and impersonal', ['ar', 'ckb', 'kmr', 'en'].every((l) => ['I', 'we', 'impersonal'].every((p) => PERSON_MARKERS[l][p].length >= 3)));
}

// Recurring phrases.
{
  const text = [
    ...freshParas(10, 30),
    `In the light of ${fresh(6)}`,
    `${uniq()} ${uniq()} in the light of ${fresh(6)}`,
    `${uniq()} in the light of ${fresh(6)}`,
    `${uniq()} alpha beta ${fresh(5)} ${uniq()} alpha beta ${fresh(5)}`,
    `${uniq()} of the ${fresh(4)} ${uniq()} of the ${fresh(4)} ${uniq()} of the ${fresh(4)} ${uniq()} of the ${fresh(4)}`,
    `${uniq()} zeta eta. theta ${fresh(4)} ${uniq()} zeta eta. theta ${fresh(4)} ${uniq()} zeta eta. theta ${fresh(4)}`,
  ].join('\n\n');
  const fp = fingerprint([sample(text)]);
  const texts = fp.phrases.map((p) => p.text.toLowerCase());
  ok('a phrase used 3 times is listed, in its first spelling', fp.phrases.some((p) => p.text === 'In the light of' && p.count === 3), fp.phrases);
  ok('one used twice is not', !texts.includes('alpha beta'));
  ok('a part of a longer phrase with the same count is not listed', !texts.includes('the light of') && !texts.includes('in the light') && !texts.includes('the light') && !texts.includes('light of'));
  ok('stop words alone are not a phrase', !texts.includes('of the') && !texts.includes('in the'));
  ok('a phrase does not run across a full stop', !texts.includes('eta theta') && texts.includes('zeta eta'));
  const pairs = Array.from({ length: 14 }, () => `${uniq()} ${uniq()}`);
  const many = fingerprint([sample(`${freshParas(10, 30).join('\n\n')}\n\n${[1, 2, 3].map(() => pairs.map((p) => `${p}.`).join(' ')).join('\n\n')}`)]);
  ok('at most 10 phrases', many.phrases.length === 10, many.phrases.length);
}

// Richness and citations.
{
  const same = fingerprint([sample(Array.from({ length: 200 }, () => 'word').join(' ') + '.')]);
  ok('richness: one word repeated is near 0', same.richness > 0 && same.richness <= 0.02, same.richness);
  const ar = fingerprint([sample(fill('ar', 400))]);
  ok('richness is between 0 and 1', ar.richness > 0 && ar.richness < 1, ar.richness);

  const en = fingerprint([sample(`${freshParas(10, 30).join('\n\n')}\n\nqaa (Smith, 2019) qab. qac [12] qad. qae¹ qaf. qag(3) qah.`)]);
  ok('citations: (Author, 2019), [12], ¹ and (3) after a word, per 1,000 words', en.citations === r1(4000 / en.words), [en.citations, en.words]);
  const ar2 = fingerprint([sample(`${fill('ar', 300)}\n\nيرى الجبوري أن التعليم أساس (الجبوري، ٢٠١٩: ٤٥).`)]);
  ok('citations: an Arabic author and year in Arabic-Indic digits', ar2.citations === r1(1000 / ar2.words), ar2.citations);
  ok('no citations in plain prose', exact.citations === 0);
}

// ── closeness ─────────────────────────────────────────────────────────────
{
  const other = fingerprint([sample(`${fill('ar', 600, 150)}\n\nيرى الباحث أن التعليم مهم. وعليه فإن الثقافة أساس. ولذا يجب الإصلاح.`)]);
  const same = closeness(exact, exact);
  ok('identical fingerprints: 100', same.score === 100 && same.parts.every((p) => p.score === 100), same);
  ok('six parts, named', same.parts.map((p) => p.what).join() === 'sentences,paragraphs,vocabulary,connectors,person,questions');
  const ab = closeness(exact, other), ba = closeness(other, exact);
  ok('symmetric', ab.score === ba.score && JSON.stringify(ab.parts) === JSON.stringify(ba.parts));
  ok('a clearly different writer is far lower', ab.score < 70, ab);
  ok('every part within 0–100', ab.parts.every((p) => p.score >= 0 && p.score <= 100));
  ok('null when either is null', closeness(null, exact) === null && closeness(exact, null) === null);
  const near = fingerprint([sample(Array.from({ length: 10 }, () => [fresh(10), fresh(20), fresh(12), fresh(18)].join(' ')).join('\n\n'))]);
  ok('a close writer is closer than a different one', closeness(exact, near).score > ab.score && closeness(exact, near).score >= 90, closeness(exact, near));
}

// ── passages that show the manner ─────────────────────────────────────────
{
  const one = sample(freshParas(10, 100).join('\n\n'), 'e1');
  const two = sample(freshParas(10, 100).join('\n\n'), 'e2');
  const firstPara = one.text.split('\n\n')[0];
  const a = excerptsOf([one, two], 2, 1100);
  ok('deterministic', JSON.stringify(a) === JSON.stringify(excerptsOf([one, two], 2, 1100)));
  ok('from different samples where there are several', a.length === 2 && one.text.includes(a[0]) !== one.text.includes(a[1]) && [one, two].every((s) => a.some((x) => s.text.includes(x))), a.map((x) => x.slice(0, 20)));
  ok('not from the first page when the middle has passages', !excerptsOf([one], 1)[0].startsWith(firstPara.slice(0, 40)));
  const cut = excerptsOf([one, two], 3, 300);
  ok('within chars', cut.length === 3 && cut.every((x) => x.length <= 300), cut.map((x) => x.length));
  ok('cut at the end of a sentence', cut.every((x) => x.endsWith('.')));
  ok('at most 4, whatever is asked', excerptsOf([one, two], 10).length === 4 && excerptsOf([one, two], 0).length === 0);
  ok('defaults: 3 passages', excerptsOf([one, two]).length === 3);

  const shortAndLong = sample([...freshParas(5, 30), ...freshParas(3, 300)].join('\n\n'));
  ok('paragraphs under 60 or over 220 words are never passages', excerptsOf([shortAndLong], 3).length === 0);
  const quotes = sample(freshParas(5, 100).map((p) => `«${p}»`).join('\n\n'));
  ok('quotations are not the writer\'s manner', excerptsOf([quotes], 3).length === 0);
  const lists = sample(freshParas(5, 100).map((p) => `- ${p}`).join('\n') + '\n\n### A heading here\n\n| a | b |');
  ok('list items, headings and tables are not passages', excerptsOf([lists], 3).length === 0);
  ok('no samples, no passages', excerptsOf([], 3).length === 0);
}

// ── the learning request ──────────────────────────────────────────────────
{
  const big = sample(fill('ar', 20000, 120), 'b1', 'الأطروحة.docx');
  const small = sample(fill('ar', 400, 120), 'b2', 'مقالة قصيرة');
  const r = { ...newResearcher({ id: 'r1', now: 5, name: 'أحمد الجبوري' }), title: 'أ.د.', field: 'الإدارة التربوية', note: 'يحب الجمل الطويلة', samples: [big, small] };
  const { system, user } = learnPrompt(r);
  ok('the big paper is bigger than the budget', big.text.length > LEARN_BUDGET);
  ok('system: a stylistician describing manner, never content', /stylistician/i.test(system) && /manner/.test(system) && /never what they write about/.test(system));
  ok('user: the name with its title', user.includes('أ.د. أحمد الجبوري'));
  ok('user: the field and the user\'s note', user.includes('الإدارة التربوية') && user.includes('يحب الجمل الطويلة'));
  ok('user: the measured numbers as facts', user.includes('Sentences average') && user.includes('Measured from the papers by code'));
  ok('user: the recurring phrases, for the model to pick stock expressions from', user.includes('Recurring phrases:'));
  ok('user: each paper as a --- name --- block', user.includes('--- مقالة قصيرة ---') && user.includes('--- الأطروحة.docx'));
  ok('user: a cut paper says it is only its beginning', user.includes('--- الأطروحة.docx (only its beginning is shown here) ---'));
  ok('user: the small paper is whole', user.includes(small.text));
  ok('user: the papers stay inside the budget', user.length < LEARN_BUDGET + 6000, user.length);
  ok('user: asks for the four fields as JSON', ['"summary"', '"traits"', '"phrases"', '"avoid"'].every((k) => user.includes(k)));
  ok('user: in the papers\' language', user.includes('in Arabic, the language of the papers'));
  ok('user: manner only — no topics, no claims, no names of works', /Manner only, never content/.test(user) && /no names of works/.test(user));
  const cutBefore = learnPrompt({ ...r, samples: [{ ...small, truncated: true }] });
  ok('a paper kept only in part says so even inside the budget', cutBefore.user.includes('(only its beginning is shown here)'));
  const none = learnPrompt(newResearcher({ id: 'r0', now: 1, name: 'X' }));
  ok('no papers: still a request, without numbers', typeof none.user === 'string' && !none.user.includes('Sentences average'));
}

// ── the reply read ────────────────────────────────────────────────────────
{
  const o = { lang: 'ar', now: 9, from: ['a', 'b'] };
  const good = JSON.stringify({
    summary: '  أسلوب رصين.  ',
    traits: [{ name: 'النبرة', detail: 'هادئة وموضوعية.' }, { name: 'بلا تفصيل' }, { name: 'الجمل', detail: 'طويلة مركبة.' }],
    phrases: ['وعليه', 'فضلاً عن ذلك', 'هذه عبارة طويلة جداً فيها أكثر من ست كلمات'],
    avoid: ['ضمير المتكلم'],
  });
  const g = parseGuide(good, o);
  ok('a good reply: the summary trimmed', g?.summary === 'أسلوب رصين.');
  ok('traits need both a name and a detail', g.traits.length === 2 && g.traits[0].name === 'النبرة');
  ok('a phrase over 6 words is dropped', g.phrases.length === 2 && g.phrases.includes('وعليه'));
  ok('avoid kept', g.avoid.length === 1);
  ok('lang, learned and from as given', g.lang === 'ar' && g.learned === 9 && g.from.join() === 'a,b');
  ok('in a code fence', parseGuide('```json\n' + good + '\n```', o)?.summary === 'أسلوب رصين.');
  ok('after a sentence of prose', parseGuide('Here is the description:\n' + good, o)?.traits.length === 2);
  ok('no summary: null', parseGuide(JSON.stringify({ traits: [] }), o) === null && parseGuide('{"summary": "   "}', o) === null);
  ok('junk: null', parseGuide('no json here', o) === null && parseGuide('', o) === null && parseGuide('[1,2]', o) === null);
  const over = parseGuide(JSON.stringify({
    summary: 'س'.repeat(2000),
    traits: Array.from({ length: 12 }, (_, i) => ({ name: 'n' + i, detail: 'd'.repeat(900) })),
    phrases: Array.from({ length: 20 }, (_, i) => 'phrase ' + i),
    avoid: Array.from({ length: 10 }, (_, i) => 'thing ' + i),
  }), o);
  ok('summary capped at 1,200 characters', over.summary.length === 1200);
  ok('traits capped at 8, each detail at 400', over.traits.length === 8 && over.traits.every((t) => t.detail.length <= 400));
  ok('phrases capped at 12, avoid at 6', over.phrases.length === 12 && over.avoid.length === 6);
}

// ── the guide as the model is told it ─────────────────────────────────────
{
  const g = {
    summary: 'A measured, formal voice.',
    traits: [{ name: 'Tone', detail: 'Calm and impersonal.' }],
    phrases: ['in the light of'],
    avoid: ['first person'],
    lang: 'en', learned: 1, from: [],
  };
  const t = guideText(g, exact, 'Keeps paragraphs long.');
  ok('the traits as "- name: detail"', t.includes('- Tone: Calm and impersonal.'));
  ok('the phrases they reuse and what they avoid', t.includes('in the light of') && t.includes('first person'));
  ok('the numbers in words', t.includes('Sentences average 15 words') && t.includes('spread 5') && t.includes('Paragraphs average 60 words'));
  ok('the person in words', t.includes('"the researcher"'));
  ok('the user\'s own note, last', t.trimEnd().endsWith('Keeps paragraphs long.'));
  const arFp = fingerprint([sample(`${fill('ar', 400)}\n\nوعليه فإن التعليم مهم. وعليه فإن الثقافة أساس.`)]);
  ok('but a voice is not handed counted phrases to reuse', arFp.phrases.length > 0 && !guideText(undefined, arFp).includes('Recurring phrases'));
  ok('favourite connectors with their rates', guideText(undefined, arFp).includes(`Favourite connectors: وعليه (${arFp.connectors[0].per1000} per 1,000 words)`));
  const huge = {
    summary: 'S'.repeat(1200),
    traits: Array.from({ length: 8 }, (_, i) => ({ name: 'Trait ' + i, detail: 'D'.repeat(400) })),
    phrases: Array.from({ length: 12 }, (_, i) => 'phrase number ' + i),
    avoid: Array.from({ length: 6 }, () => 'A'.repeat(300)),
    lang: 'en', learned: 1, from: [],
  };
  const long = guideText(huge, exact, 'N'.repeat(3000));
  ok('never over 4,000 characters', long.length <= 4000, long.length);
  ok('the numbers and the note survive shortening', long.includes('Sentences average 15 words') && long.includes('NNNN'));
  ok('no guide: the numbers alone', guideText(undefined, exact).startsWith('Measured from their papers'));
  ok('nothing at all: empty', guideText(undefined, null) === '');
}

// ── the voice a document carries ──────────────────────────────────────────
{
  const guide = { summary: 'أسلوب رصين.', traits: [], phrases: [], avoid: [], lang: 'ar', learned: 1, from: [] };
  const bare = newResearcher({ id: 'v1', now: 1, name: '  أحمد الجبوري ' });
  ok('newResearcher: empty fields, v 1, name trimmed', bare.v === 1 && bare.name === 'أحمد الجبوري' && bare.samples.length === 0 && bare.title === '' && bare.created === 1 && bare.updated === 1);
  ok('no guide and no samples: null', voiceOf(bare) === null);
  ok('no guide and under 150 words: null', voiceOf({ ...bare, samples: [sample(fill('ar', 100))] }) === null);
  const guided = voiceOf({ ...bare, title: 'د.', guide });
  ok('a guide alone is a voice, named with the title', guided?.name === 'د. أحمد الجبوري' && guided.id === 'v1' && guided.guide.includes('أسلوب رصين.'));
  ok('its language is the guide\'s when there are no papers', guided.lang === 'ar' && guided.excerpts.length === 0);
  const measuredOnly = voiceOf({ ...bare, samples: [sample(fill('ar', 1200, 120), 'm1'), sample(fill('ar', 1200, 120), 'm2')] });
  ok('papers alone are a voice: the name without a title has no stray space', measuredOnly?.name === 'أحمد الجبوري');
  ok('with the numbers, three short passages and the papers\' language',
    measuredOnly.guide.includes('Sentences average') && measuredOnly.excerpts.length === 3 && measuredOnly.excerpts.every((x) => x.length <= 1100) && measuredOnly.lang === 'ar');
}

// ── stale ─────────────────────────────────────────────────────────────────
{
  const s1 = sample('one two three', 'x1'), s2 = sample('four five six', 'x2');
  const base = { ...newResearcher({ id: 'st', now: 1, name: 'N' }), samples: [s1, s2] };
  const guide = { summary: 's', traits: [], phrases: [], avoid: [], lang: 'en', learned: 1, from: ['x1', 'x2'] };
  ok('no guide: not stale', stale(base) === false);
  ok('learned from exactly these: not stale', stale({ ...base, guide }) === false);
  ok('a sample added since: stale', stale({ ...base, samples: [s1, s2, sample('seven', 'x3')], guide }) === true);
  ok('a sample removed since: stale', stale({ ...base, samples: [s1], guide }) === true);
}

// ── the researcher a request names ────────────────────────────────────────
{
  const person = (id, name, title = '') => ({ ...newResearcher({ id, now: 1, name }), title });
  const ahmed = person('a', 'أحمد الجبوري', 'أ.د.');
  const ahmedLong = person('al', 'أحمد الجبوري الموصلي');
  const hemin = person('h', 'هێمن عومەر', 'د.');
  const azad = person('z', 'ئازاد محەمەد', 'پ.ی.د.');
  const smith = person('s', 'John Smith', 'Prof.');
  const salem = person('sl', 'سالم');
  const ali = person('ali', 'Ali');
  const al = person('two', 'Al');
  const people = [ahmed, hemin, azad, smith, salem, ali, al];
  const who = (req, list = people) => voiceIn(req, list)?.id ?? null;
  ok('ar: بأسلوب with a title', who('اكتب ورقة عمل بأسلوب د. أحمد الجبوري') === 'a');
  ok('ar: على طريقة without a title', who('على طريقة أحمد الجبوري اكتب مقالة') === 'a');
  ok('ar: the surname after بأسلوب', who('بأسلوب الجبوري') === 'a');
  ok('ar: with أ.د. written out', who('بطريقة أ.د. أحمد الجبوري') === 'a');
  ok('ar: the whole name anywhere, no phrase needed', who('ورقة عمل عن المناخ مثلما يكتبها أحمد الجبوري') === 'a');
  ok('ar: typed without hamza', who('باسلوب احمد الجبوري') === 'a');
  ok('ckb: بە شێوازی with a title', who('بە شێوازی د. هێمن عومەر توێژینەوەیەک بنووسە') === 'h');
  ok('ckb: بە ستایلی and the first name', who('بە ستایلی هێمن بنووسە') === 'h');
  ok('ckb: typed on an Arabic keyboard', who(arabicKeyboard('بە شێوازی هێمن عومەر بنووسە').split(ch(0x6CE)).join(ARABIC_YEH)) === 'h');
  ok('kmr: ب شێوازێ with پ.ی.د.', who('ب شێوازێ پ.ی.د. ئازاد ڤەکۆلینەکێ بنڤیسە') === 'z');
  ok('kmr: ب ڕێکا', who('ب ڕێکا ئازاد محەمەد بنڤیسە') === 'z');
  ok('en: in the style of, with Prof.', who('Write an article in the style of Prof. John Smith') === 's');
  ok('en: a bare "like" is an example, not a manner', who('write it like Smith writes') === null);
  {
    // Examples in a request are not a choice of manner: each of these once
    // picked a saved researcher by one word of their name.
    const many = [
      { ...newResearcher({ id: 'g', now: 0, name: 'Sarah Green' }) },
      { ...newResearcher({ id: 'm', now: 0, name: 'محمد علي الجبوري' }) },
      { ...newResearcher({ id: 'k', now: 0, name: 'ئەحمەد کەریم' }) },
    ];
    const pick = (q) => voiceIn(q, many)?.id ?? null;
    ok('"such as green" is a colour', pick('colours such as green') === null);
    ok('"like green spaces" is a kind of park', pick('urban parks, like green spaces') === null);
    ok('"as green technology" is a phrase', pick('renewable energy as green technology') === null);
    ok('"مثل علي وعمر" are examples', pick('الخلفاء مثل علي وعمر') === null);
    ok('"وەک ئەحمەد خانی" is another poet', pick('شاعیرانی کورد وەک ئەحمەد خانی') === null);
    ok('but a cue that asks for a manner still takes part of a name', pick('اكتب بأسلوب الجبوري') === 'm');
    ok('and the whole name anywhere still counts', pick('an essay for Sarah Green to read') === 'g');
  }
  ok('en: as … writes, any case', who('As JOHN SMITH writes, briefly') === 's');
  ok('a name inside a longer word does not match', who('in the style of Alibaba') === null && who('بأسلوب السالمي') === null);
  ok('the whole name inside longer words does not match either', who('Joann Smithers wrote this') === null);
  ok('a name under 3 letters never matches', who('in the style of Al') === null && who('Al wrote') === null);
  ok('a 3-letter name does', who('in the style of Ali') === 'ali');
  ok('the longest name wins', who('بأسلوب أحمد الجبوري الموصلي', [ahmed, ahmedLong]) === 'al' && who('بأسلوب أحمد الجبوري الموصلي', [ahmedLong, ahmed]) === 'al');
  ok('the shorter whole name over a part of a longer one', who('بأسلوب أحمد الجبوري', [ahmedLong, ahmed]) === 'a');
  ok('nobody named: null', who('اكتب ورقة عمل عن التعليم') === null && who('') === null && voiceIn('بأسلوب أحمد', []) === null);
  ok('a style word alone is not a name', who('بأسلوب علمي رصين') === null);
}

// ── a stored record read back ─────────────────────────────────────────────
{
  ok('junk is not a researcher', [null, undefined, 'x', 3, [], {}, { id: 1, v: 1 }, { id: '', v: 1 }, { id: 'x', v: 2 }, { id: 'x' }].every((x) => readResearcher(x) === null));
  const min = readResearcher({ id: 'x', v: 1 });
  ok('the least that is a researcher, every field defaulted', min && min.name === '' && min.title === '' && min.note === '' && Array.isArray(min.samples) && min.samples.length === 0 && min.guide === undefined && min.created === 0);
  const r = readResearcher({
    id: 'y', v: 1, created: 5, updated: 'soon', name: 'N', title: 7, affiliation: 'U', field: 'F', note: 'n',
    samples: [
      { id: 'a', name: 'p', text: 'one two three', words: 3, added: 2, truncated: false },
      { id: 'a', name: 'dup', text: 'again' },
      { id: 'b', text: 'four five' },
      { id: 'c', text: 42 },
      'junk', null,
      { text: 'no id' },
    ],
    guide: { summary: ' s ', traits: [{ name: 'a', detail: 'b' }, { name: 'x' }, 'junk'], phrases: ['p', 3], avoid: 'nope', lang: 'xx', learned: 'x', from: ['a', 1] },
  });
  ok('fields kept or defaulted', r.name === 'N' && r.title === '' && r.affiliation === 'U' && r.created === 5 && r.updated === 5);
  ok('samples: invalid ones dropped, each id once', r.samples.map((s) => s.id).join() === 'a,b');
  ok('a sample without words has them counted', r.samples[1].words === 2 && r.samples[1].name === '' && r.samples[1].truncated === false);
  ok('the guide read defensively', r.guide.summary === 's' && r.guide.traits.length === 1 && r.guide.phrases.join() === 'p' && r.guide.avoid.length === 0 && r.guide.learned === 0 && r.guide.from.join() === 'a');
  ok('an unknown guide language falls back to the papers\'', ['ar', 'ckb', 'kmr', 'en'].includes(r.guide.lang));
  ok('a guide with an empty summary is not a guide', readResearcher({ id: 'z', v: 1, guide: { summary: '  ' } }).guide === undefined);
  const round = readResearcher(JSON.parse(JSON.stringify({ ...newResearcher({ id: 'q', now: 3, name: 'Q' }), samples: [sample('one two', 'o')] })));
  ok('a record the app wrote reads back the same', round.id === 'q' && round.samples[0].id === 'o' && round.samples[0].words === 2 && round.created === 3);
}

ok('limits', MAX_SAMPLES === 10 && MAX_SAMPLE_CHARS === 150_000 && LEARN_BUDGET === 60_000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
