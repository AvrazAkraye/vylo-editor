// Citations and the reference list, built from records and nothing else.
//
// The model writes only `[@s3]`; every citation and every entry in the
// reference list is made here, from the source record, in the style the
// researcher chose. What matters, in order:
//
//   1. nothing is printed for a source that is unknown, retracted, switched
//      off or never cited — and nothing else is left behind by it;
//   2. every entry has exactly the fields the record has, in the order and
//      punctuation of the style, and never "undefined", "()" or ", ,";
//   3. an Arabic-script source is cited as Arabic is cited — Arabic commas,
//      و and وآخرون, whole given names — and a Latin one keeps Latin form even
//      in an Arabic document, which prints the two in separate lists;
//   4. in the footnotes style, the first note for a source is full and every
//      later one in the same pass short ("مصدر سابق"), and the list is grouped
//      by kind under ordinal headings, as the owner's example has it.
//
// Each style is pinned against its real-world form with 1, 2, 3 and 21
// authors, an organisation, no year, no venue, a book, a chapter, a thesis,
// a DOI, Arabic-script sources, and a locator; the footnotes against every
// form in the example, rebuilt with invented works — the example is a real
// student's paper, and none of it belongs in this repository.
import { citeContext, inText, renderRuns, reference, referenceList } from '../.test-build/cite.js';
import { runsOf } from '../.test-build/prose.js';
import { WORDS, STYLES, localDigits } from '../.test-build/research.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`); cond ? pass++ : fail++; };
const eq = (name, got, want) => ok(name, got === want, { got, want });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const P = (family, given) => (given ? { family, given } : { family });
const src = (key, o = {}) => ({ key, title: '', authors: [], type: 'article', origin: 'openalex', verified: true, use: true, ...o });
const text = (runs) => runs.map((r) => r.text).join('');
const italics = (runs) => runs.filter((r) => r.italic).map((r) => r.text);
const links = (runs) => runs.filter((r) => r.link).map((r) => [r.text, r.link]);

// ── the sources ───────────────────────────────────────────────────────────
const one = src('s1', { title: 'Sleep and memory', authors: [P('Walker', 'Matthew P.')], year: 2017, venue: 'Neuron', volume: '44', issue: '1', pages: '121-133' });
const two = src('s2', { title: 'Learning with machines', authors: [P('Family', 'Anna Beth'), P('Other', 'Carl')], year: 2020, venue: 'Journal of Things', volume: '12', issue: '3', pages: '45-67', doi: '10.1000/xyz' });
const three = src('s3', { title: 'Three voices', authors: [P('Lee', 'Kim'), P('Park', 'Min'), P('Cho', 'Ha')], year: 2018, venue: 'Asian Review', volume: '5', pages: '1-10' });
const letter = (i) => String.fromCharCode(65 + i);
const nn = (i) => String(i + 1).padStart(2, '0');
const many = src('s4', { title: 'Big collaboration', authors: Array.from({ length: 21 }, (_, i) => P(`Author${nn(i)}`, `${letter(i)}lex`)), year: 2022, venue: 'Science', volume: '375' });
const org = src('s5', { title: 'World report on ageing', authors: [P('World Health Organization')], year: 2015, type: 'report', publisher: 'World Health Organization', url: 'https://www.who.int/ageing' });
const noYear = src('s6', { title: 'Undated notes', authors: [P('Doe', 'Jane')], venue: 'Working Papers' });
const noVenue = src('s7', { title: 'Floating article', authors: [P('Roe', 'Richard')], year: 2012, volume: '3', issue: '2', pages: '5-9' });
const book = src('s8', { title: 'Research design', authors: [P('Creswell', 'John W.')], year: 2014, type: 'book', publisher: 'SAGE' });
const chapter = src('s9', { title: 'Qualitative case studies', authors: [P('Stake', 'Robert E.')], year: 2005, type: 'chapter', venue: 'The SAGE handbook of qualitative research', pages: '443-466', publisher: 'SAGE' });
const thesis = src('s10', { title: 'Teachers and technology', authors: [P('Ahmed', 'Sara')], year: 2021, type: 'thesis', publisher: 'University of Duhok' });
const ar1 = src('s11', { title: 'التعليم الإلكتروني في الجامعات العراقية', authors: [P('الجبوري', 'علي حسين')], year: 2019, type: 'book', publisher: 'دار الشروق' });
const ar2 = src('s12', { title: 'أثر الذكاء الاصطناعي في التعليم الجامعي', authors: [P('الزهراني', 'محمد علي'), P('العتيبي', 'سعد')], year: 2020, venue: 'مجلة العلوم التربوية', volume: '12', issue: '3', pages: '45-67', doi: '10.2000/abc' });
const ar3 = src('s13', { title: 'واقع البحث العلمي في الجامعات', authors: [P('القحطاني', 'خالد'), P('السالم', 'نورة'), P('الحربي', 'فهد')], venue: 'مجلة جامعة دهوك' });
const retracted = src('s14', { title: 'Withdrawn study', authors: [P('Fake', 'Ann')], year: 2019, venue: 'J', retracted: true });
const off = src('s15', { title: 'Switched off', authors: [P('Quiet', 'Bob')], year: 2019, venue: 'J', use: false });
const uncited = src('s16', { title: 'Never cited', authors: [P('Nobody', 'Ned')], year: 2011, venue: 'J' });
const SOURCES = [one, two, three, many, org, noYear, noVenue, book, chapter, thesis, ar1, ar2, ar3, retracted, off, uncited];
const LATIN = [one, two, three, many, org, noYear, noVenue, book, chapter, thesis];
const ARABIC = [ar1, ar2, ar3];
const BODY = 'Intro [@s1] and [@s2].\n\n### H [@s3]\n\n- [@s4] [@s5]\n\n| a | b |\n|---|---|\n| [@s6] | [@s7] |\n\n'
  + 'Then [@s8; @s9] [@s10] [@s11] [@s12] [@s13] [@s14] [@s15] [@s99].';
const doc = (style, lang, o = {}) => ({ style, lang, sources: SOURCES, sections: [{ text: BODY }], ...o });

// ── what is cited ─────────────────────────────────────────────────────────
{
  const ctx = citeContext(doc('ieee', 'en'));
  eq('order is first citation, usable and known only', ctx.order.join(' '), 's1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13');
  ok('the context carries the style, language and sources', ctx.style === 'ieee' && ctx.lang === 'en' && ctx.sources.length === SOURCES.length);
  const across = citeContext({ ...doc('apa', 'en'), sections: [{ text: '[@s3] then [@s1]' }, { text: '[@s2] and [@s3] again' }, {}, { text: '' }] });
  eq('order runs across sections, in order, each key once', across.order.join(' '), 's3 s1 s2');
  const fallback = citeContext({ style: 'nonsense', lang: 'xx', sources: [], sections: [] });
  ok('an unknown style is APA and an unknown language English', fallback.style === 'apa' && fallback.lang === 'en' && fallback.order.length === 0);
  ok('a document with nothing in it does not throw', citeContext({}).order.length === 0);
  // A style research.ts may name before this file formats it is APA, whole.
  const apa = citeContext(doc('apa', 'en'));
  const unknown = { ...apa, style: 'nonsense' };
  ok('a style not formatted here is cited as APA', inText(['s2', 's3'], unknown) === inText(['s2', 's3'], apa), inText(['s2', 's3'], unknown));
  ok('and listed as APA', same(referenceList(unknown), referenceList(apa)));
  ok('the footnotes style is formatted here, not as APA', citeContext(doc('footnotes', 'ar')).style === 'footnotes' && inText(['s2'], citeContext(doc('footnotes', 'en'))) !== inText(['s2'], apa));
  ok('a context starts with nothing seen', (() => { const c = citeContext(doc('footnotes', 'ar')); return c.seen instanceof Set && c.seen.size === 0; })());
  eq('a marker inside a gap is not a citation', citeContext({ ...doc('apa', 'en'), sections: [{ text: '[[see [@s1]]] [@s2]' }] }).order.join(' '), 's2');
}

// ── each style, pinned ────────────────────────────────────────────────────
// [key, in-text, reference] — for an English document, and the Arabic-script
// ones for an Arabic document.
const APA_21 = `${Array.from({ length: 19 }, (_, i) => `Author${nn(i)}, ${letter(i)}.`).join(', ')}, . . . Author21, U.`;
const HARVARD_21 = `${Array.from({ length: 20 }, (_, i) => `Author${nn(i)}, ${letter(i)}.`).join(', ')} and Author21, U.`;
const CHICAGO_21 = `Author01, Alex, ${Array.from({ length: 6 }, (_, i) => `${letter(i + 1)}lex Author${nn(i + 1)}`).join(', ')}, et al.`;
const EXPECT = {
  apa: [
    ['s1', '(Walker, 2017)', 'Walker, M. P. (2017). Sleep and memory. Neuron, 44(1), 121–133.'],
    ['s2', '(Family & Other, 2020)', 'Family, A. B., & Other, C. (2020). Learning with machines. Journal of Things, 12(3), 45–67. https://doi.org/10.1000/xyz'],
    ['s3', '(Lee et al., 2018)', 'Lee, K., Park, M., & Cho, H. (2018). Three voices. Asian Review, 5, 1–10.'],
    ['s4', '(Author01 et al., 2022)', `${APA_21} (2022). Big collaboration. Science, 375.`],
    ['s5', '(World Health Organization, 2015)', 'World Health Organization. (2015). World report on ageing. https://www.who.int/ageing'],
    ['s6', '(Doe, n.d.)', 'Doe, J. (n.d.). Undated notes. Working Papers.'],
    ['s7', '(Roe, 2012)', 'Roe, R. (2012). Floating article.'],
    ['s8', '(Creswell, 2014)', 'Creswell, J. W. (2014). Research design. SAGE.'],
    ['s9', '(Stake, 2005)', 'Stake, R. E. (2005). Qualitative case studies. In The SAGE handbook of qualitative research (pp. 443–466). SAGE.'],
    ['s10', '(Ahmed, 2021)', 'Ahmed, S. (2021). Teachers and technology [Thesis, University of Duhok].'],
    ['s11', '(الجبوري، 2019)', 'الجبوري، علي حسين. (2019). التعليم الإلكتروني في الجامعات العراقية. دار الشروق.'],
    ['s12', '(الزهراني والعتيبي، 2020)', 'الزهراني، محمد علي، والعتيبي، سعد. (2020). أثر الذكاء الاصطناعي في التعليم الجامعي. مجلة العلوم التربوية، 12(3)، 45–67. https://doi.org/10.2000/abc'],
    ['s13', '(القحطاني وآخرون، د.ت)', 'القحطاني، خالد، السالم، نورة، والحربي، فهد. (د.ت). واقع البحث العلمي في الجامعات. مجلة جامعة دهوك.'],
  ],
  harvard: [
    ['s1', '(Walker, 2017)', "Walker, M.P. (2017) 'Sleep and memory', Neuron, 44(1), pp. 121–133."],
    ['s2', '(Family and Other, 2020)', "Family, A.B. and Other, C. (2020) 'Learning with machines', Journal of Things, 12(3), pp. 45–67. Available at: https://doi.org/10.1000/xyz"],
    ['s3', '(Lee, Park and Cho, 2018)', "Lee, K., Park, M. and Cho, H. (2018) 'Three voices', Asian Review, 5, pp. 1–10."],
    ['s4', '(Author01 et al., 2022)', `${HARVARD_21} (2022) 'Big collaboration', Science, 375.`],
    ['s5', '(World Health Organization, 2015)', 'World Health Organization (2015) World report on ageing. World Health Organization. Available at: https://www.who.int/ageing'],
    ['s6', '(Doe, no date)', "Doe, J. (no date) 'Undated notes', Working Papers."],
    ['s7', '(Roe, 2012)', "Roe, R. (2012) 'Floating article'."],
    ['s8', '(Creswell, 2014)', 'Creswell, J.W. (2014) Research design. SAGE.'],
    ['s9', '(Stake, 2005)', "Stake, R.E. (2005) 'Qualitative case studies', in The SAGE handbook of qualitative research. SAGE, pp. 443–466."],
    ['s10', '(Ahmed, 2021)', 'Ahmed, S. (2021) Teachers and technology. Thesis. University of Duhok.'],
    ['s11', '(الجبوري، 2019)', 'الجبوري، علي حسين (2019) التعليم الإلكتروني في الجامعات العراقية. دار الشروق.'],
    ['s12', '(الزهراني والعتيبي، 2020)', 'الزهراني، محمد علي والعتيبي، سعد (2020) "أثر الذكاء الاصطناعي في التعليم الجامعي"، مجلة العلوم التربوية، 12(3)، ص 45–67. متاح على: https://doi.org/10.2000/abc'],
    ['s13', '(القحطاني وآخرون، د.ت)', 'القحطاني، خالد، السالم، نورة والحربي، فهد (د.ت) "واقع البحث العلمي في الجامعات"، مجلة جامعة دهوك.'],
  ],
  chicago: [
    ['s1', '(Walker 2017)', 'Walker, Matthew P. 2017. "Sleep and memory." Neuron 44 (1): 121–133.'],
    ['s2', '(Family and Other 2020)', 'Family, Anna Beth, and Carl Other. 2020. "Learning with machines." Journal of Things 12 (3): 45–67. https://doi.org/10.1000/xyz.'],
    ['s3', '(Lee, Park, and Cho 2018)', 'Lee, Kim, Min Park, and Ha Cho. 2018. "Three voices." Asian Review 5: 1–10.'],
    ['s4', '(Author01 et al. 2022)', `${CHICAGO_21} 2022. "Big collaboration." Science 375.`],
    ['s5', '(World Health Organization 2015)', 'World Health Organization. 2015. World report on ageing. World Health Organization. https://www.who.int/ageing.'],
    ['s6', '(Doe n.d.)', 'Doe, Jane. n.d. "Undated notes." Working Papers.'],
    ['s7', '(Roe 2012)', 'Roe, Richard. 2012. "Floating article."'],
    ['s8', '(Creswell 2014)', 'Creswell, John W. 2014. Research design. SAGE.'],
    ['s9', '(Stake 2005)', 'Stake, Robert E. 2005. "Qualitative case studies." In The SAGE handbook of qualitative research, 443–466. SAGE.'],
    ['s10', '(Ahmed 2021)', 'Ahmed, Sara. 2021. "Teachers and technology." Thesis, University of Duhok.'],
    ['s11', '(الجبوري 2019)', 'الجبوري، علي حسين. 2019. التعليم الإلكتروني في الجامعات العراقية. دار الشروق.'],
    ['s12', '(الزهراني والعتيبي 2020)', 'الزهراني، محمد علي، وسعد العتيبي. 2020. "أثر الذكاء الاصطناعي في التعليم الجامعي". مجلة العلوم التربوية 12 (3): 45–67. https://doi.org/10.2000/abc.'],
    ['s13', '(القحطاني وآخرون د.ت)', 'القحطاني، خالد، نورة السالم، وفهد الحربي. د.ت. "واقع البحث العلمي في الجامعات". مجلة جامعة دهوك.'],
  ],
  mla: [
    ['s1', '(Walker)', 'Walker, Matthew P. "Sleep and memory." Neuron, vol. 44, no. 1, 2017, pp. 121–133.'],
    ['s2', '(Family and Other)', 'Family, Anna Beth, and Carl Other. "Learning with machines." Journal of Things, vol. 12, no. 3, 2020, pp. 45–67, https://doi.org/10.1000/xyz.'],
    ['s3', '(Lee et al.)', 'Lee, Kim, et al. "Three voices." Asian Review, vol. 5, 2018, pp. 1–10.'],
    ['s4', '(Author01 et al.)', 'Author01, Alex, et al. "Big collaboration." Science, vol. 375, 2022.'],
    ['s5', '(World Health Organization)', 'World Health Organization. World report on ageing. World Health Organization, 2015, www.who.int/ageing.'],
    ['s6', '(Doe)', 'Doe, Jane. "Undated notes." Working Papers.'],
    ['s7', '(Roe)', 'Roe, Richard. "Floating article." vol. 3, no. 2, 2012, pp. 5–9.'],
    ['s8', '(Creswell)', 'Creswell, John W. Research design. SAGE, 2014.'],
    ['s9', '(Stake)', 'Stake, Robert E. "Qualitative case studies." The SAGE handbook of qualitative research, SAGE, 2005, pp. 443–466.'],
    ['s10', '(Ahmed)', 'Ahmed, Sara. Teachers and technology. 2021. University of Duhok, thesis.'],
    ['s11', '(الجبوري)', 'الجبوري، علي حسين. التعليم الإلكتروني في الجامعات العراقية. دار الشروق، 2019.'],
    ['s12', '(الزهراني والعتيبي)', 'الزهراني، محمد علي، وسعد العتيبي. "أثر الذكاء الاصطناعي في التعليم الجامعي". مجلة العلوم التربوية، مج 12، ع 3، 2020، ص 45–67، https://doi.org/10.2000/abc.'],
    ['s13', '(القحطاني وآخرون)', 'القحطاني، خالد، وآخرون. "واقع البحث العلمي في الجامعات". مجلة جامعة دهوك.'],
  ],
  ieee: [
    ['s1', '[1]', 'M. P. Walker, "Sleep and memory," Neuron, vol. 44, no. 1, pp. 121–133, 2017.'],
    ['s2', '[2]', 'A. B. Family and C. Other, "Learning with machines," Journal of Things, vol. 12, no. 3, pp. 45–67, 2020, doi: 10.1000/xyz.'],
    ['s3', '[3]', 'K. Lee, M. Park, and H. Cho, "Three voices," Asian Review, vol. 5, pp. 1–10, 2018.'],
    ['s4', '[4]', 'A. Author01 et al., "Big collaboration," Science, vol. 375, 2022.'],
    ['s5', '[5]', 'World Health Organization, "World report on ageing," World Health Organization, 2015. [Online]. Available: https://www.who.int/ageing'],
    ['s6', '[6]', 'J. Doe, "Undated notes," Working Papers.'],
    ['s7', '[7]', 'R. Roe, "Floating article," vol. 3, no. 2, pp. 5–9, 2012.'],
    ['s8', '[8]', 'J. W. Creswell, Research design. SAGE, 2014.'],
    ['s9', '[9]', 'R. E. Stake, "Qualitative case studies," in The SAGE handbook of qualitative research, SAGE, 2005, pp. 443–466.'],
    ['s10', '[10]', 'S. Ahmed, "Teachers and technology," Thesis, University of Duhok, 2021.'],
    ['s11', '[11]', 'علي حسين الجبوري، التعليم الإلكتروني في الجامعات العراقية. دار الشروق، 2019.'],
    ['s12', '[12]', 'محمد علي الزهراني وسعد العتيبي، "أثر الذكاء الاصطناعي في التعليم الجامعي"، مجلة العلوم التربوية، مج 12، ع 3، ص 45–67، 2020، doi: 10.2000/abc.'],
    ['s13', '[13]', 'خالد القحطاني، نورة السالم، وفهد الحربي، "واقع البحث العلمي في الجامعات"، مجلة جامعة دهوك.'],
  ],
};
const byKey = new Map(SOURCES.map((s) => [s.key, s]));
for (const style of Object.keys(EXPECT)) {
  const en = citeContext(doc(style, 'en'));
  const ar = citeContext(doc(style, 'ar'));
  for (const [key, cite, entry] of EXPECT[style]) {
    const arabic = ARABIC.includes(byKey.get(key));
    const ctx = arabic ? ar : en;
    eq(`${style} ${key}: in the text`, inText([key], ctx), cite);
    eq(`${style} ${key}: in the list`, text(reference(byKey.get(key), ctx)), entry);
  }
  // A Latin source keeps its Latin form inside an Arabic document.
  for (const s of LATIN) {
    eq(`${style} ${s.key}: the same in an Arabic document`, text(reference(s, ar)), text(reference(s, en)));
    eq(`${style} ${s.key}: and cited the same`, inText([s.key], ar), inText([s.key], en));
  }
  // Unknown, retracted, switched off: nothing at all.
  for (const k of ['s99', 's14', 's15', 's16']) eq(`${style}: ${k} prints nothing`, inText([k], en), '');
  eq(`${style}: no keys print nothing`, inText([], en), '');
}

// ── italics and links ─────────────────────────────────────────────────────
{
  const ctx = (style) => citeContext(doc(style, 'en'));
  ok('APA: the journal and the volume are italic', same(italics(reference(two, ctx('apa'))), ['Journal of Things', '12']));
  for (const style of ['harvard', 'chicago', 'mla', 'ieee']) {
    ok(`${style}: the journal is italic, the volume is not`, same(italics(reference(two, ctx(style))), ['Journal of Things']), italics(reference(two, ctx(style))));
  }
  for (const style of STYLES) {
    ok(`${style}: a book's title is italic`, same(italics(reference(book, ctx(style))), ['Research design']));
    ok(`${style}: a chapter's book is italic, the chapter is not`, same(italics(reference(chapter, ctx(style))), ['The SAGE handbook of qualitative research']));
    ok(`${style}: the DOI is a link to doi.org`, links(reference(two, ctx(style))).some(([, l]) => l === 'https://doi.org/10.1000/xyz'));
    ok(`${style}: an address is a link to itself`, same(links(reference(org, ctx(style))).map(([, l]) => l), ['https://www.who.int/ageing']));
    ok(`${style}: a record without a DOI or address has no link`, links(reference(one, ctx(style))).length === 0);
  }
  ok('APA prints the DOI as https://doi.org/…', same(links(reference(two, ctx('apa'))), [['https://doi.org/10.1000/xyz', 'https://doi.org/10.1000/xyz']]));
  ok('IEEE prints it as doi: 10.…, linked the same', same(links(reference(two, ctx('ieee'))), [['10.1000/xyz', 'https://doi.org/10.1000/xyz']]));
  ok('MLA prints an address without its scheme', same(links(reference(org, ctx('mla'))), [['www.who.int/ageing', 'https://www.who.int/ageing']]));
  ok('a thesis title is italic in APA', same(italics(reference(thesis, ctx('apa'))), ['Teachers and technology']));
  ok('and quoted in Chicago', italics(reference(thesis, ctx('chicago'))).length === 0);
  ok('an Arabic journal is italic too', same(italics(reference(ar2, citeContext(doc('apa', 'ar')))), ['مجلة العلوم التربوية', '12']));
  const hostile = src('h1', { title: 'Bad link', authors: [P('X', 'Y')], year: 2020, url: 'javascript:alert(1)', doi: 'not a doi' });
  for (const style of STYLES) {
    const r = reference(hostile, ctx(style));
    ok(`${style}: a javascript: address is neither printed nor linked`, !text(r).includes('javascript') && links(r).length === 0);
  }
  ok('a DOI given as a URL is cleaned', same(links(reference(src('d1', { title: 'T', doi: 'https://doi.org/10.5/ab' }), ctx('apa'))).map(([, l]) => l), ['https://doi.org/10.5/ab']));
}

// ── Arabic script ─────────────────────────────────────────────────────────
{
  const ckb = citeContext(doc('apa', 'ckb'));
  const kmr = citeContext(doc('apa', 'kmr'));
  const en = citeContext(doc('apa', 'en'));
  eq('a Sorani document writes و as a word of its own', inText(['s12'], ckb), '(الزهراني و العتيبي، 2020)');
  ok('and in the list', text(reference(ar2, ckb)).startsWith('الزهراني، محمد علي، و العتيبي، سعد. (2020).'), text(reference(ar2, ckb)));
  eq('no date in a Sorani document', inText(['s13'], ckb), '(القحطاني وآخرون، بێ ڕێکەوت)');
  eq('no date in a Badini document', inText(['s13'], kmr), '(القحطاني وآخرون، بێ دیرۆک)');
  eq('no date for an Arabic source in an English document', inText(['s13'], en), '(القحطاني وآخرون، n.d.)');
  ok('an Arabic given name is never an initial', STYLES.every((st) => text(reference(ar2, citeContext(doc(st, 'ar')))).includes('محمد علي')));
  const mixed = src('m1', { title: 'Arabic names in an English record', authors: [P('الزهراني', 'محمد')], year: 2020, venue: 'J' });
  ok('nor inside a Latin-script record', text(reference(mixed, citeContext({ ...doc('apa', 'en'), sources: [mixed], sections: [{ text: '[@m1]' }] }))).startsWith('الزهراني, محمد.'));
  const cjk = src('c1', { title: 'A study', authors: [P('Wang', '小明')], year: 2020, venue: 'J' });
  ok('a Chinese given name is kept whole too', text(reference(cjk, en)).startsWith('Wang, 小明.'));
  const untitled = src('u1', { title: '', authors: [P('الزهراني', 'محمد')], year: 2021, venue: 'مجلة' });
  ok('a record without a title is judged by its names', inText(['u1'], citeContext({ ...doc('apa', 'ar'), sources: [untitled], sections: [{ text: '[@u1]' }] })) === '(الزهراني، 2021)');
  const mostlyLatin = src('l1', { title: 'COVID-19 وأثره', authors: [P('Ali', 'Omar')], year: 2021, venue: 'J' });
  ok('a title that is mostly Latin is a Latin source', inText(['l1'], citeContext({ ...doc('apa', 'ar'), sources: [mostlyLatin], sections: [{ text: '[@l1]' }] })) === '(Ali, 2021)');
}

// ── the list ──────────────────────────────────────────────────────────────
{
  const heads = (groups) => groups.map((g) => g.heading);
  const keys = (g) => g.entries.map((e) => e.key).join(' ');
  for (const style of ['apa', 'harvard', 'chicago', 'mla']) {
    const en = referenceList(citeContext(doc(style, 'en')));
    ok(`${style}, English: one list`, same(heads(en), [WORDS.en.references]));
    eq(`${style}, English: alphabetical, Arabic after Latin`, keys(en[0]), 's10 s4 s8 s6 s2 s3 s7 s9 s1 s5 s11 s12 s13');
    for (const lang of ['ar', 'ckb', 'kmr']) {
      const g = referenceList(citeContext(doc(style, lang)));
      ok(`${style}, ${lang}: Arabic-script sources first, then the rest`, same(heads(g), [WORDS[lang].local, WORDS[lang].foreign]), heads(g));
    }
    const ar = referenceList(citeContext(doc(style, 'ar')));
    eq(`${style}: the local list`, keys(ar[0]), 's11 s12 s13');
    eq(`${style}: the foreign list`, keys(ar[1]), 's10 s4 s8 s6 s2 s3 s7 s9 s1 s5');
    ok(`${style}: no numbers outside IEEE`, ar.every((g) => g.entries.every((e) => e.n === undefined)));
    ok(`${style}: every entry is the same as reference() gives`, ar[0].entries.every((e) => same(e.runs, reference(byKey.get(e.key), citeContext(doc(style, 'ar'))))));
  }
  const ieee = referenceList(citeContext(doc('ieee', 'ar')));
  ok('IEEE: one list even in an Arabic document', same(heads(ieee), [WORDS.ar.references]));
  eq('IEEE: in the order first cited', keys(ieee[0]), 's1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13');
  ok('IEEE: numbered from one', same(ieee[0].entries.map((e) => e.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));
  ok('IEEE: the number is not in the entry', !text(ieee[0].entries[0].runs).startsWith('['));
  const reordered = citeContext({ ...doc('ieee', 'en'), sections: [{ text: '[@s12] [@s2]' }, { text: '[@s1; @s12]' }] });
  eq('IEEE numbers follow the text, not the source list', referenceList(reordered)[0].entries.map((e) => `${e.n}:${e.key}`).join(' '), '1:s12 2:s2 3:s1');
  eq('and the citations agree with them', inText(['s1', 's12'], reordered), '[1], [3]');
  const latinOnly = referenceList(citeContext({ ...doc('apa', 'ar'), sections: [{ text: '[@s1] [@s2]' }] }));
  ok('an Arabic document citing only Latin sources has one list', same(heads(latinOnly), [WORDS.ar.references]));
  const arabicOnly = referenceList(citeContext({ ...doc('apa', 'ar'), sections: [{ text: '[@s12] [@s11]' }] }));
  ok('and one citing only Arabic sources', same(heads(arabicOnly), [WORDS.ar.references]) && keys(arabicOnly[0]) === 's11 s12');
  ok('nothing cited is no list', referenceList(citeContext({ ...doc('apa', 'en'), sections: [{ text: 'No markers.' }] })).length === 0);
  ok('only unusable markers is no list', referenceList(citeContext({ ...doc('apa', 'ar'), sections: [{ text: '[@s14] [@s15] [@s99]' }] })).length === 0);
  for (const style of STYLES) {
    const all = referenceList(citeContext(doc(style, 'ar'))).flatMap((g) => g.entries.map((e) => e.key));
    ok(`${style}: never a retracted, switched-off, uncited or unknown source`, !all.some((k) => ['s14', 's15', 's16', 's99'].includes(k)));
    ok(`${style}: every cited usable source once`, all.length === 13 && new Set(all).size === 13);
  }
  ok('a malformed context is no list, not a throw', referenceList(undefined).length === 0 && referenceList({ style: 'apa', lang: 'en', sources: null, order: null }).length === 0);
}

// ── filing order ──────────────────────────────────────────────────────────
{
  const list = (sources, lang = 'en', style = 'apa') =>
    referenceList(citeContext({ style, lang, sources, sections: [{ text: sources.map((s) => `[@${s.key}]`).join(' ') }] }))
      .flatMap((g) => g.entries.map((e) => e.key)).join(' ');
  const zahrani = src('z', { title: 'دراسة', authors: [P('الزهراني', 'محمد')], year: 2020, venue: 'م' });
  const badr = src('b', { title: 'دراسة أخرى', authors: [P('بدر', 'أحمد')], year: 2020, venue: 'م' });
  eq('the Arabic article ال is ignored in filing: بدر before الزهراني', list([zahrani, badr], 'ar'), 'b z');
  const zebra = src('t', { title: 'The zebra report', year: 2020, venue: 'J' });
  const young = src('y', { title: 'Youth', authors: [P('Young', 'Amy')], year: 2020, venue: 'J' });
  eq('an English title files without "The"', list([zebra, young]), 'y t');
  const an = src('an', { title: 'T', authors: [P('An', 'Mei')], year: 2020, venue: 'J' });
  const baker = src('bk', { title: 'T', authors: [P('Baker', 'Ann')], year: 2020, venue: 'J' });
  eq('but "An" as a surname is a surname', list([baker, an]), 'an bk');
  const solo = src('so', { title: 'Solo', authors: [P('Smith', 'Jan')], year: 2021, venue: 'J' });
  const duo = src('du', { title: 'Duo', authors: [P('Smith', 'Jan'), P('Jones', 'Kay')], year: 2019, venue: 'J' });
  eq('one author before the same author with others', list([duo, solo]), 'so du');
  const later = src('la', { title: 'Later', authors: [P('Smith', 'Jan')], year: 2022, venue: 'J' });
  const undated = src('ud', { title: 'Undated', authors: [P('Smith', 'Jan')], venue: 'J' });
  eq('then by year, undated first', list([later, solo, undated]), 'ud so la');
}

// ── two works that would cite alike ───────────────────────────────────────
{
  const a1 = src('a1', { title: 'Beta paper', authors: [P('Adams', 'Paul')], year: 2019, venue: 'J' });
  const a2 = src('a2', { title: 'Alpha paper', authors: [P('Adams', 'Paul')], year: 2019, venue: 'J' });
  const a3 = src('a3', { title: 'Gamma paper', authors: [P('Adams', 'Paul')], year: 2021, venue: 'J' });
  const sources = [a1, a2, a3];
  const ctx = (style) => citeContext({ style, lang: 'en', sources, sections: [{ text: '[@a1] [@a2] [@a3]' }] });
  eq('APA: a and b by title', `${inText(['a2'], ctx('apa'))} ${inText(['a1'], ctx('apa'))}`, '(Adams, 2019a) (Adams, 2019b)');
  ok('APA: the letter is in the list too', text(reference(a2, ctx('apa'))).startsWith('Adams, P. (2019a).'));
  eq('APA: one name for works by the same author', inText(['a3', 'a1', 'a2'], ctx('apa')), '(Adams, 2019a, 2019b, 2021)');
  eq('Harvard: a and b', inText(['a1'], ctx('harvard')), '(Adams, 2019b)');
  eq('Chicago: a and b', inText(['a1', 'a2'], ctx('chicago')), '(Adams 2019b, 2019a)');
  ok('Chicago: the letter is in the list too', text(reference(a1, ctx('chicago'))).startsWith('Adams, Paul. 2019b.'));
  eq('MLA: the title tells them apart', inText(['a1'], ctx('mla')), '(Adams, "Beta paper")');
  eq('IEEE: numbers need no letters', inText(['a1'], ctx('ieee')), '[1]');
  ok('a letter is only given within what is cited', inText(['a1'], citeContext({ style: 'apa', lang: 'en', sources, sections: [{ text: '[@a1] [@a3]' }] })) === '(Adams, 2019)');
  const b1 = src('b1', { title: 'دراسة أولى', authors: [P('الزهراني', 'محمد')], year: 2019, venue: 'م' });
  const b2 = src('b2', { title: 'دراسة ثانية', authors: [P('الزهراني', 'محمد')], year: 2019, venue: 'م' });
  eq('Arabic works get Arabic letters', inText(['b1', 'b2'], citeContext({ style: 'apa', lang: 'ar', sources: [b1, b2], sections: [{ text: '[@b1] [@b2]' }] })), '(الزهراني، 2019أ، 2019ب)');
}

// ── different people who would cite alike (APA 7, 8.18–8.20) ──────────────
// A letter after the year claims the same authors wrote both works (9.47), so
// in APA two different teams are told apart by their names, never by 2020a
// and 2020b — in the text and in the list.
{
  const apa = (sources, lang = 'en') => citeContext({ style: 'apa', lang, sources, sections: [{ text: sources.map((s) => `[@${s.key}]`).join(' ') }] });
  const t1 = src('t1', { title: 'First', authors: [P('Smith', 'John A.'), P('Jones', 'Kay'), P('Brown', 'Lee')], year: 2020, venue: 'J' });
  const t2 = src('t2', { title: 'Second', authors: [P('Smith', 'John A.'), P('Lee', 'May'), P('Kim', 'Sun')], year: 2020, venue: 'J' });
  const ctx = apa([t1, t2]);
  eq('two teams of three: every name, since et al. would stand for one', `${inText(['t1'], ctx)} ${inText(['t2'], ctx, 'p. 5')}`, '(Smith, Jones, & Brown, 2020) (Smith, Lee, & Kim, 2020, p. 5)');
  ok('and no letter in either entry', text(reference(t1, ctx)).startsWith('Smith, J. A., Jones, K., & Brown, L. (2020). First.')
    && text(reference(t2, ctx)).startsWith('Smith, J. A., Lee, M., & Kim, S. (2020). Second.'), [text(reference(t1, ctx)), text(reference(t2, ctx))]);
  const five = (key, names) => src(key, { title: key, authors: names.map((n) => P(n, 'Ann')), year: 2017, venue: 'J' });
  const f1 = five('v1', ['Stone', 'Hart', 'Moss', 'Reed', 'Pike']);
  const f2 = five('v2', ['Stone', 'Hart', 'Webb', 'Cole', 'Dunn']);
  eq('two teams of five: as many surnames as tell them apart, then et al.', inText(['v2', 'v1'], apa([f1, f2])), '(Stone, Hart, Moss, et al., 2017; Stone, Hart, Webb, et al., 2017)');
  eq('a team that shortens alike only in another year keeps et al.', inText(['v1'], apa([f1, { ...f2, year: 2018 }])), '(Stone et al., 2017)');
  const again = src('t3', { title: 'Another', authors: t1.authors, year: 2020, venue: 'J' });
  const mixed = apa([t1, t2, again]);
  eq('the same team twice in a year still takes letters, beside its longer name', inText(['t3', 't1'], mixed), '(Smith, Jones, & Brown, 2020a, 2020b)');
  ok('and the other team none', inText(['t2'], mixed) === '(Smith, Lee, & Kim, 2020)' && text(reference(t2, mixed)).includes('(2020).'));
  const j = src('j1', { title: 'One', authors: [P('Smith', 'Jan')], year: 2020, venue: 'J' });
  const k = src('j2', { title: 'Two', authors: [P('Smith', 'Kit')], year: 2019, venue: 'J' });
  const kim = src('j3', { title: 'Three', authors: [P('Kim', 'Ora')], year: 2018, venue: 'J' });
  const initials = apa([j, k, kim]);
  eq('first authors sharing a surname are told apart by their initials, whatever the year', inText(['j2', 'j1', 'j3'], initials), '(Kim, 2018; J. Smith, 2020; K. Smith, 2019)');
  ok('and their entries take no letter', text(reference(j, initials)).startsWith('Smith, J. (2020).'));
  eq('in the same year too', inText(['j1', 'j2'], apa([j, { ...k, year: 2020 }])), '(J. Smith, 2020; K. Smith, 2020)');
  const u1 = src('u1', { title: 'Alpha', authors: [P('Smith', 'Jan'), P('Jones', 'Kay'), P('Brown', 'Lee')], year: 2020, venue: 'J' });
  const u2 = src('u2', { title: 'Beta', authors: [P('Smith', 'Jan'), P('Jones', 'Kay'), P('Brown', 'Max')], year: 2020, venue: 'J' });
  eq('teams no surname tells apart fall back on letters rather than print alike', inText(['u1', 'u2'], apa([u1, u2])), '(Smith et al., 2020a, 2020b)');
  const a1 = src('w1', { title: 'دراسة أولى', authors: [P('الزهراني', 'محمد'), P('العتيبي', 'سعد'), P('القحطاني', 'خالد')], year: 2020, venue: 'م' });
  const a2 = src('w2', { title: 'دراسة ثانية', authors: [P('الزهراني', 'محمد'), P('السالم', 'نورة'), P('الحربي', 'فهد')], year: 2020, venue: 'م' });
  eq('Arabic teams, in Arabic punctuation', inText(['w1'], apa([a1, a2], 'ar')), '(الزهراني، العتيبي، والقحطاني، 2020)');
  ok('Harvard and Chicago already name three, and are left as they were', inText(['t1'], citeContext({ style: 'harvard', lang: 'en', sources: [t1, t2], sections: [{ text: '[@t1] [@t2]' }] })) === '(Smith, Jones and Brown, 2020)');
}

// ── several keys in one marker ────────────────────────────────────────────
{
  const ctx = (style, lang = 'en') => citeContext(doc(style, lang));
  eq('APA: alphabetical', inText(['s3', 's2'], ctx('apa')), '(Family & Other, 2020; Lee et al., 2018)');
  eq('Harvard: earliest first', inText(['s2', 's3'], ctx('harvard')), '(Lee, Park and Cho, 2018; Family and Other, 2020)');
  eq('Chicago: as written', inText(['s3', 's2'], ctx('chicago')), '(Lee, Park, and Cho 2018; Family and Other 2020)');
  eq('MLA: as written', inText(['s3', 's2'], ctx('mla')), '(Lee et al.; Family and Other)');
  eq('IEEE: a run of three is a range', inText(['s3', 's1', 's2'], ctx('ieee')), '[1]–[3]');
  eq('IEEE: two in a row are two', inText(['s1', 's2'], ctx('ieee')), '[1], [2]');
  eq('IEEE: a gap breaks the range', inText(['s1', 's3'], ctx('ieee')), '[1], [3]');
  eq('IEEE: a range and a single', inText(['s5', 's1', 's2', 's3'], ctx('ieee')), '[1]–[3], [5]');
  eq('IEEE: Arabic commas between numbers in an Arabic document', inText(['s1', 's3'], ctx('ieee', 'ar')), '[1]، [3]');
  eq('Latin and Arabic in one marker', inText(['s12', 's2'], ctx('apa', 'ar')), '(Family & Other, 2020; الزهراني والعتيبي، 2020)');
  eq('two Arabic sources are joined with ؛', inText(['s12', 's11'], ctx('apa', 'ar')), '(الجبوري، 2019؛ الزهراني والعتيبي، 2020)');
  eq('an unknown key among known ones is dropped', inText(['s99', 's2', 's14'], ctx('apa')), '(Family & Other, 2020)');
  eq('a key twice is cited once', inText(['s2', 's2'], ctx('apa')), '(Family & Other, 2020)');
  eq('garbage keys are ignored', inText([null, 5, 's2'], ctx('apa')), '(Family & Other, 2020)');
  eq('no keys at all', inText(undefined, ctx('apa')), '');
}

// ── locators ──────────────────────────────────────────────────────────────
{
  const ctx = (style, lang = 'en') => citeContext(doc(style, lang));
  eq('APA: p. 12', inText(['s2'], ctx('apa'), 'p. 12'), '(Family & Other, 2020, p. 12)');
  eq('APA: a bare number is a page', inText(['s2'], ctx('apa'), '12'), '(Family & Other, 2020, p. 12)');
  eq('APA: a range is pp. with an en dash', inText(['s2'], ctx('apa'), '12-15'), '(Family & Other, 2020, pp. 12–15)');
  eq('APA: pp. as typed', inText(['s2'], ctx('apa'), 'pp. 12 - 15'), '(Family & Other, 2020, pp. 12–15)');
  eq('APA: p12 is tidied', inText(['s2'], ctx('apa'), 'p12'), '(Family & Other, 2020, p. 12)');
  eq('APA: a chapter is kept as typed', inText(['s2'], ctx('apa'), 'ch. 3'), '(Family & Other, 2020, ch. 3)');
  eq('Harvard: p. 12', inText(['s2'], ctx('harvard'), 'p. 12'), '(Family and Other, 2020, p. 12)');
  eq('Chicago: the page alone', inText(['s2'], ctx('chicago'), 'p. 12'), '(Family and Other 2020, 12)');
  eq('Chicago: a range alone', inText(['s2'], ctx('chicago'), 'pp. 12-15'), '(Family and Other 2020, 12–15)');
  eq('MLA: the page after the name, no comma', inText(['s2'], ctx('mla'), 'p. 12'), '(Family and Other 12)');
  eq('IEEE: inside the brackets', inText(['s2'], ctx('ieee'), 'p. 12'), '[2, p. 12]');
  eq('IEEE: a located source is not folded into a range', inText(['s1', 's2', 's3'], ctx('ieee'), 'p. 4'), '[1, p. 4], [2], [3]');
  eq('an Arabic source: ص', inText(['s11'], ctx('apa', 'ar'), 'ص 40'), '(الجبوري، 2019، ص 40)');
  eq('an Arabic source: p. becomes ص', inText(['s11'], ctx('apa', 'ar'), 'p. 40'), '(الجبوري، 2019، ص 40)');
  eq('an Arabic source: a bare number', inText(['s11'], ctx('apa', 'ar'), '٤٠'), '(الجبوري، 2019، ص ٤٠)');
  eq('an Arabic source in Chicago', inText(['s11'], ctx('chicago', 'ar'), 'ص 40'), '(الجبوري 2019، 40)');
  eq('the locator belongs to the first key', inText(['s3', 's2'], ctx('apa'), 'p. 7'), '(Family & Other, 2020; Lee et al., 2018, p. 7)');
  eq('and goes with it when it is unknown', inText(['s99', 's2'], ctx('apa'), 'p. 7'), '(Family & Other, 2020)');
  eq('a blank locator is none', inText(['s2'], ctx('apa'), '   '), '(Family & Other, 2020)');
  eq('an organisation with a page', inText(['s5'], ctx('apa'), 'p. 12'), '(World Health Organization, 2015, p. 12)');
}

// ── no author ─────────────────────────────────────────────────────────────
{
  const art = src('n1', { title: 'Climate and health: a review of the evidence', year: 2019, venue: 'Lancet' });
  const bk = src('n2', { title: 'Style guide', year: 2020, type: 'book', publisher: 'Press' });
  const ctx = (style) => citeContext({ style, lang: 'en', sources: [art, bk], sections: [{ text: '[@n1] [@n2]' }] });
  eq('APA: the short title in quotes, the comma inside', inText(['n1'], ctx('apa')), '("Climate and health," 2019)');
  eq('APA: a book title is not quoted', inText(['n2'], ctx('apa')), '(Style guide, 2020)');
  eq('APA: the title takes the author’s place', text(reference(art, ctx('apa'))), 'Climate and health: a review of the evidence. (2019). Lancet.');
  eq('Harvard: the title first', text(reference(art, ctx('harvard'))), "'Climate and health: a review of the evidence' (2019) Lancet.");
  eq('Chicago: the title first', text(reference(art, ctx('chicago'))), '"Climate and health: a review of the evidence." 2019. Lancet.');
  eq('Chicago: cited by title', inText(['n1'], ctx('chicago')), '("Climate and health" 2019)');
  eq('MLA: cited by title', inText(['n1'], ctx('mla')), '("Climate and health")');
  eq('IEEE: the title first', text(reference(art, ctx('ieee'))), '"Climate and health: a review of the evidence," Lancet, 2019.');
  const nothing = src('n3', { title: '', year: 2020 });
  ok('a record with neither author nor title is still cited, as Anonymous', inText(['n3'], citeContext({ style: 'apa', lang: 'en', sources: [nothing], sections: [{ text: '[@n3]' }] })) === '(Anonymous, 2020)');
}

// ── short titles ──────────────────────────────────────────────────────────
// A cut title keeps its key words (CMOS 17, 14.30): never a fragment that
// ends on "and the" or a comma, in a later Chicago note or a no-author citation.
{
  const later = (title, o = {}) => {
    const s = src('st', { title, authors: [P('Family', 'Anna'), P('Other', 'Carl')], year: 2020, venue: 'J', ...o });
    const ctx = citeContext({ style: 'footnotes', lang: 'en', sources: [s], sections: [{ text: '[@st]' }] });
    return renderRuns(runsOf('a [@st, 45] b [@st, 50]'), ctx).filter((r) => r.note).map((r) => text(r.note))[1];
  };
  eq('a later note does not stop on "and the"', later('Civil society and the state in Iraq'), 'Family and Other, "Civil society," 50.');
  eq('nor on a comma', later('Law, order, and the state in Iraq'), 'Family and Other, "Law, order," 50.');
  eq('and leaves out an initial The', later('The politics of oil in the Gulf'), 'Family and Other, "Politics of oil," 50.');
  eq('but not the capital a word has of its own', later('The iPhone effect on the young today'), 'Family and Other, "iPhone effect," 50.');
  eq('a short title is kept whole', later('Why now?'), 'Family and Other, "Why now?" 50.');
  const bare = (title, lang = 'en') => {
    const s = src('nt', { title, year: 2020, venue: 'J' });
    return inText(['nt'], citeContext({ style: 'apa', lang, sources: [s], sections: [{ text: '[@nt]' }] }));
  };
  eq('APA, no author: the cut keeps its key words', bare('Civil society and the state in Iraq'), '("Civil society," 2020)');
  eq('APA, no author: an Arabic title does not stop on في', bare('التنظيم القانوني للعمل في المنظمات الأهلية المحلية', 'ar'), '(التنظيم القانوني للعمل، 2020)');
}

// ── names and titles ──────────────────────────────────────────────────────
{
  const one = (authors, style = 'apa', o = {}) => {
    const s = src('x', { title: 'T', authors, year: 2020, venue: 'J', ...o });
    return text(reference(s, citeContext({ style, lang: 'en', sources: [s], sections: [{ text: '[@x]' }] })));
  };
  ok('a hyphenated given name keeps its hyphen', one([P('Sartre', 'Jean-Paul')]).startsWith('Sartre, J.-P. (2020)'));
  ok('initials typed without spaces are spaced in APA', one([P('Tolkien', 'J.R.R.')]).startsWith('Tolkien, J. R. R. (2020)'));
  ok('and not in Harvard', one([P('Tolkien', 'J. R. R.')], 'harvard').startsWith('Tolkien, J.R.R. (2020)'));
  ok('IEEE puts the initials first', one([P('Tolkien', 'John Ronald')], 'ieee').startsWith('J. R. Tolkien, '));
  ok('a name with only a given part is a whole name', one([{ family: '', given: 'Plato' }]).startsWith('Plato. (2020)'));
  ok('an empty author is skipped', one([P('', ''), P('Real', 'Ann')]).startsWith('Real, A. (2020)'));
  ok('a title’s own full stop is not doubled', one([P('A', 'B')], 'apa', { title: 'Ends with a stop.' }).includes('Ends with a stop. J.'));
  ok('an abbreviation keeps its stop', one([P('A', 'B')], 'apa', { title: 'Made in the U.S.' }).includes('Made in the U.S. J.'));
  ok('a question keeps its mark, and takes no stop', one([P('A', 'B')], 'apa', { title: 'Why now?' }).includes('Why now? J.'));
  ok('Chicago: a question inside the quotes, no stop', one([P('A', 'B')], 'chicago', { title: 'Why now?' }).includes('"Why now?" J.'));
  ok('tags from Crossref are removed', one([P('A', 'B')], 'apa', { title: 'The <i>E. coli</i> genome' }).includes('The E. coli genome.'));
  ok('pages with a double hyphen become an en dash', one([P('A', 'B')], 'apa', { pages: '10--20' }).includes('J, 10–20.'));
  ok('a volume given as a number is printed', one([P('A', 'B')], 'apa', { volume: 7 }).includes('J, 7.'));
  ok('an issue without a volume', one([P('A', 'B')], 'apa', { issue: '4' }).includes('J, (4).'));
  ok('Chicago: an issue without a volume', one([P('A', 'B')], 'chicago', { issue: '4', pages: '5-6' }).includes('J, no. 4: 5–6.'));
  ok('a malformed year is no year', one([P('A', 'B')], 'apa', { year: 'soon' }).includes('(n.d.)'));
  ok('a record passed as nothing is no entry', reference(null, citeContext({})).length === 0);
}

// ── editions and places ───────────────────────────────────────────────────
{
  const ed = src('e1', { title: 'Methods', authors: [P('Smith', 'Jane')], year: 2019, type: 'book', publisher: 'Oxford University Press', city: 'Oxford', edition: '3' });
  const r = (style, s = ed, lang = 'en') => text(reference(s, citeContext({ style, lang, sources: [s], sections: [{ text: `[@${s.key}]` }] })));
  eq('APA: the edition after the title, no place', r('apa'), 'Smith, J. (2019). Methods (3rd ed.). Oxford University Press.');
  eq('Harvard: edn. and the place', r('harvard'), 'Smith, J. (2019) Methods. 3rd edn. Oxford: Oxford University Press.');
  eq('Chicago: ed. and the place', r('chicago'), 'Smith, Jane. 2019. Methods. 3rd ed. Oxford: Oxford University Press.');
  eq('MLA: ed., no place', r('mla'), 'Smith, Jane. Methods. 3rd ed., Oxford University Press, 2019.');
  eq('IEEE: ed. and the place', r('ieee'), 'J. Smith, Methods, 3rd ed. Oxford: Oxford University Press, 2019.');
  ok('a first edition is not mentioned', !r('apa', { ...ed, edition: '1' }).includes('ed.'));
  ok('2nd, 11th, 22nd, 113th', ['2', '11', '22', '113'].map((e) => r('apa', { ...ed, edition: e })).every((t, i) => t.includes(`(${['2nd', '11th', '22nd', '113th'][i]} ed.)`)));
  ok('"3rd edition" as typed', r('apa', { ...ed, edition: '3rd edition' }).includes('(3rd ed.)'));
  ok('a named edition', r('chicago', { ...ed, edition: 'Revised' }).includes('Revised ed.'));
  const arEd = src('e2', { title: 'أصول البحث العلمي', authors: [P('بدر', 'أحمد')], year: 1996, type: 'book', publisher: 'دار المعارف', city: 'القاهرة', edition: '9' });
  eq('Arabic: ط and the place', r('harvard', arEd, 'ar'), 'بدر، أحمد (1996) أصول البحث العلمي. ط9. القاهرة: دار المعارف.');
  ok('Arabic: a named edition', r('chicago', { ...arEd, edition: 'الثالثة' }, 'ar').includes('الطبعة الثالثة.'));
}

// ── legislation ───────────────────────────────────────────────────────────
// None of the five manuals has a rule for an Iraqi law, so a law is cited the
// way the region's legal writing cites it, as in the owner's example from a
// law faculty: "المادة ٢٠/ثالثاً من قانون … رقم ٣١ لسنة ٢٠١٢". The laws and
// works below are invented.
{
  const law = src('L1', { title: 'قانون تنظيم المهن الهندسية', number: '31', year: 2012, type: 'law', venue: 'الوقائع العراقية', issue: '4250', issued: '3 نيسان 2012', origin: 'person' });
  const constitution = src('L4', { title: 'دستور جمهورية العراق', year: 2005, type: 'law' });
  const both = [law, constitution];
  const ctx = (style, lang = 'ar', sources = both) => citeContext({ style, lang, sources, sections: [{ text: sources.map((s) => `[@${s.key}]`).join(' ') }] });
  for (const style of ['apa', 'harvard', 'chicago', 'mla']) {
    eq(`${style}: the article first, then the law by name, number and year`, inText(['L1'], ctx(style), 'المادة ٢٠/ثالثاً'), '(المادة ٢٠/ثالثاً من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012)');
    eq(`${style}: a law without an article`, inText(['L1'], ctx(style)), '(قانون تنظيم المهن الهندسية رقم 31 لسنة 2012)');
    eq(`${style}: a constitution has a year and no number`, inText(['L4'], ctx(style), 'المادة ٣٠/أولاً'), '(المادة ٣٠/أولاً من دستور جمهورية العراق لسنة 2005)');
    eq(`${style}: a bare number is an article, never a page`, inText(['L1'], ctx(style), '7'), '(المادة 7 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012)');
  }
  eq('IEEE: a law is numbered like the rest', inText(['L1'], ctx('ieee'), 'المادة ١٣'), '[1، المادة ١٣]');
  eq('IEEE: a bare number is an article there too', inText(['L1'], ctx('ieee'), '١٣'), '[1، المادة ١٣]');
  for (const style of STYLES) {
    eq(`${style}: a law's entry, as the owner's list writes it`, text(reference(law, ctx(style))), 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012، الوقائع العراقية، العدد 4250، 3 نيسان 2012.');
    eq(`${style}: a constitution's entry`, text(reference(constitution, ctx(style))), 'دستور جمهورية العراق لسنة 2005.');
    ok(`${style}: a law's entry has no italics`, italics(reference(law, ctx(style))).length === 0);
  }
  ok('a law is never given a year letter', inText(['L1'], ctx('apa', 'ar', [law, { ...law, key: 'L9', title: 'قانون تنظيم المهن الهندسية' }])).includes('لسنة 2012)'));
  const named = src('L2', { title: 'قانون المرافعات المدنية رقم 83 لسنة 1969', number: '83', year: 1969, type: 'law' });
  eq('a number and year already in the title are not repeated', text(reference(named, ctx('apa', 'ar', [named]))), 'قانون المرافعات المدنية رقم 83 لسنة 1969.');
  const kurdish = src('K1', { title: 'یاسای پاراستنی ژینگە', number: '1', year: 2011, type: 'law' });
  eq('a Kurdish law in a Sorani document is named in Sorani', inText(['K1'], ctx('apa', 'ckb', [kurdish]), 'مادەی ٥'), '(مادەی ٥ لە یاسای پاراستنی ژینگە ژمارە 1ی ساڵی 2011)');
  eq('and in a Badini document in Badini', inText(['K1'], ctx('apa', 'kmr', [kurdish]), 'مادەیا ٥'), '(مادەیا ٥ ژ یاسای پاراستنی ژینگە ژمارە 1 یا سالا 2011)');
  eq('an Iraqi law in a Kurdish document stays Arabic', inText(['L1'], ctx('apa', 'ckb'), 'المادة ١٣'), '(المادة ١٣ من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012)');
  eq('a Kurdish law cited at a bare number, in Sorani', inText(['K1'], ctx('harvard', 'ckb', [kurdish]), '5'), '(مادەی 5 لە یاسای پاراستنی ژینگە ژمارە 1ی ساڵی 2011)');
  const latinLaw = src('L3', { title: 'Civil Code', number: '40', year: 1951, type: 'law', venue: 'Official Gazette', issue: '3015' });
  for (const style of ['apa', 'harvard', 'chicago', 'mla']) {
    eq(`${style}: a law in Latin script`, inText(['L3'], ctx(style, 'en', [latinLaw]), 'art. 4'), '(Civil Code, No. 40 of 1951, art. 4)');
    eq(`${style}: at a bare number, an article`, inText(['L3'], ctx(style, 'en', [latinLaw]), '4'), '(Civil Code, No. 40 of 1951, art. 4)');
  }
  for (const style of STYLES) eq(`${style}: and its entry`, text(reference(latinLaw, ctx(style, 'en', [latinLaw]))), 'Civil Code, No. 40 of 1951, Official Gazette, no. 3015.');
  const dict = src('D1', { title: 'معجم الألفاظ القانونية', authors: [P('ابن حامد')], year: 1994, type: 'dictionary', publisher: 'دار الأفق', city: 'بغداد', edition: '3' });
  eq('a dictionary is a book: APA', text(reference(dict, ctx('apa', 'ar', [dict]))), 'ابن حامد. (1994). معجم الألفاظ القانونية (ط3). دار الأفق.');
  eq('a dictionary is a book: Harvard', text(reference(dict, ctx('harvard', 'ar', [dict]))), 'ابن حامد (1994) معجم الألفاظ القانونية. ط3. بغداد: دار الأفق.');
  eq('a dictionary is a book: Chicago', text(reference(dict, ctx('chicago', 'ar', [dict]))), 'ابن حامد. 1994. معجم الألفاظ القانونية. ط3. بغداد: دار الأفق.');
  eq('a dictionary is a book: MLA', text(reference(dict, ctx('mla', 'ar', [dict]))), 'ابن حامد. معجم الألفاظ القانونية. ط3، دار الأفق، 1994.');
  eq('a dictionary is a book: IEEE', text(reference(dict, ctx('ieee', 'ar', [dict]))), 'ابن حامد، معجم الألفاظ القانونية، ط3. بغداد: دار الأفق، 1994.');
  eq('and cited as one', inText(['D1'], ctx('apa', 'ar', [dict]), 'ص 243'), '(ابن حامد، 1994، ص 243)');
  for (const style of ['apa', 'harvard', 'chicago', 'mla', 'ieee']) {
    ok(`${style}: with its title in italics`, same(italics(reference(dict, ctx(style, 'ar', [dict]))), ['معجم الألفاظ القانونية']));
  }
}

// ── renderRuns ────────────────────────────────────────────────────────────
{
  const ctx = citeContext(doc('apa', 'en'));
  const show = (line, c = ctx) => renderRuns(runsOf(line), c);
  eq('a marker becomes its citation', text(show('as shown [@s2].')), 'as shown (Family & Other, 2020).');
  eq('an unknown marker goes, with the space before it', text(show('as shown [@s99].')), 'as shown.');
  eq('a retracted one too', text(show('as shown [@s14] here')), 'as shown here');
  eq('a switched-off one too', text(show('as shown [@s15], and')), 'as shown, and');
  eq('at the start, the space after it goes', text(show('[@s99] Start.')), 'Start.');
  eq('and the brackets somebody wrapped it in', text(show('text ([@s99]) more')), 'text more');
  eq('a group keeps what is known', text(show('see [@s99; @s2].')), 'see (Family & Other, 2020).');
  eq('a locator comes through', text(show('see [@s2, p. 9].')), 'see (Family & Other, 2020, p. 9).');
  ok('emphasis is kept', same(show('**bold** and *it*'), [{ text: 'bold', bold: true }, { text: ' and ' }, { text: 'it', italic: true }]));
  ok('a gap is a bracketed hole', same(show('the mean [[mean of axis 1]].'), [{ text: 'the mean ' }, { text: '[mean of axis 1]', hole: true }, { text: '.' }]));
  ok('a gap before a dropped marker stays, the space between goes', same(show('[[x]] [@s99]'), [{ text: '[x]', hole: true }]));
  eq('IEEE numbers in the text', text(renderRuns(runsOf('a [@s1; @s2; @s3] b'), citeContext(doc('ieee', 'en')))), 'a [1]–[3] b');
  eq('an Arabic sentence', text(renderRuns(runsOf('كما يرى [@s12]، فإن'), citeContext(doc('apa', 'ar')))), 'كما يرى (الزهراني والعتيبي، 2020)، فإن');
  ok('nothing given, nothing back', renderRuns(undefined, ctx).length === 0 && renderRuns([null, 5, { t: 'x' }], ctx).length === 0);
  ok('the runs given are not changed', (() => {
    const runs = runsOf('keep [@s99] this');
    const before = JSON.stringify(runs);
    renderRuns(runs, ctx);
    return JSON.stringify(runs) === before;
  })());
}

// ── a context changed in place ────────────────────────────────────────────
// What a context cites is remembered between calls; a change to what may be
// cited must still be seen by the next one.
{
  const k1 = src('k1', { title: 'Kept', authors: [P('Keen', 'Kay')], year: 2020, venue: 'J' });
  const k2 = src('k2', { title: 'Other', authors: [P('Other', 'Oz')], year: 2021, venue: 'J' });
  const ctx = citeContext({ style: 'apa', lang: 'en', sources: [k1, k2], sections: [{ text: '[@k1] [@k2]' }] });
  eq('cited', inText(['k1'], ctx), '(Keen, 2020)');
  k1.use = false;
  eq('switched off in place: no longer cited', inText(['k1'], ctx), '');
  ok('nor listed', referenceList(ctx)[0].entries.map((e) => e.key).join(' ') === 'k2');
  k1.use = true;
  eq('switched back on', inText(['k1'], ctx), '(Keen, 2020)');
  ctx.style = 'ieee';
  eq('a new style on the same context', inText(['k2'], ctx), '[2]');
  k2.retracted = true;
  eq('retracted in place', inText(['k2'], ctx), '');
  ctx.order = ['k2', 'k1'];
  eq('a new order', inText(['k1'], ctx), '[1]');
}

// ── footnotes ─────────────────────────────────────────────────────────────
// The style Iraqi and Kurdish universities use, pinned against the owner's
// example, with invented works in its shapes: a note at the foot of the page,
// full the first time a source is cited and short after that, and a list
// grouped by kind under ordinal headings, numbered from one in each group.
const fnDict = src('f1', { title: 'معجم الألفاظ القانونية', authors: [P('ابن حامد')], year: 1420, type: 'dictionary', publisher: 'دار الأفق', city: 'بغداد', edition: '3' });
const fnArt = src('f2', { title: 'التحكيم في عقود الإنشاءات', authors: [P('العبيدي', 'كريم ناصر')], year: 2021, venue: 'مجلة البحوث القانونية، كلية القانون، جامعة الرافدين', volume: '14', issue: '3', pages: '200-230' });
const fnDuo = src('f3', { title: 'حدود السلطة التقديرية للإدارة', authors: [P('الربيعي', 'ليلى حسن'), P('عبد الجبار', 'أ.د. سامر خليل')], year: 2022, venue: 'مجلة الدراسات الإدارية، كلية الإدارة والاقتصاد، جامعة الرافدين', volume: '9', issue: 'عدد خاص، الجزء الثاني' });
const fnSpecial = src('f4', { title: 'إدارة الأوقاف في المدن', authors: [P('د. بشرى عادل النعيمي')], year: 2023, venue: 'مجلة العلوم الاجتماعية', issue: 'عدد خاص بالمؤتمر العلمي الثالث' });
const fnLaw = src('f5', { title: 'قانون تنظيم المهن الهندسية', number: '31', year: 2012, type: 'law', venue: 'الوقائع العراقية', issue: '4250', issued: '3 نيسان 2012' });
const fnRules = src('f6', { title: 'تعليمات تنفيذ قانون تنظيم المهن الهندسية', number: '4', year: 2012, type: 'law', venue: 'الوقائع العراقية', issue: '4262', issued: '20 أيار 2012' });
const fnConst = src('f7', { title: 'دستور جمهورية العراق', year: 2005, type: 'law' });
const fnDecision = src('f8', { title: 'قرار مجلس الوزراء', number: '150', year: 2020, type: 'law', venue: 'الوقائع العراقية', issue: '4600', issued: '5 تموز 2020', origin: 'model', verified: false });
const fnThesis = src('f9', { title: 'التنظيم القانوني للإيجار التمويلي', authors: [P('السامرائي', 'هالة فاضل')], year: 2019, type: 'thesis', publisher: 'كلية القانون، جامعة الرافدين' });
const fnMaster = src('f10', { title: 'الشخصية المعنوية للشركات', authors: [P('الدوري', 'نبيل صالح')], year: 2017, type: 'thesis', venue: 'رسالة ماجستير، كلية القانون، جامعة الرافدين' });
const fnBook = src('f11', { title: 'الوسيط في القانون الإداري', authors: [P('الجنابي', 'عادل كاظم')], year: 2016, type: 'book', publisher: 'دار الوفاق للنشر', city: 'بغداد', edition: '2' });
const fnWeb = src('f12', { title: 'تقرير الإسكان الحضري', year: 2024, type: 'web', venue: 'وزارة التخطيط', url: 'https://example.org/report' });
const fnLatin = src('f13', { title: 'Learning with machines', authors: [P('Family', 'Anna Beth'), P('Other', 'Carl')], year: 2020, venue: 'Journal of Things', volume: '12', issue: '3', pages: '45-67', doi: '10.1000/xyz' });
const fnLatinBook = src('f14', { title: 'Methods of inquiry', authors: [P('Baker', 'Jane')], year: 2019, type: 'book', publisher: 'Northfield Press', city: 'Leeds', edition: '3' });
const fnSolo = src('f15', { title: 'السعدي', authors: [P('السعدي')], year: 2010, venue: 'مجلة' });
const fnProf = src('f16', { title: 'دراسة في الحوكمة', authors: [P('أ.د. يوسف مراد')], year: 2011, venue: 'مجلة' });
const fnUndated = src('f17', { title: 'مذكرات في القانون الإداري', authors: [P('الزبيدي', 'منى')], type: 'book', publisher: 'مطبعة الجامعة' });
const FN = [fnDict, fnArt, fnDuo, fnSpecial, fnLaw, fnRules, fnConst, fnDecision, fnThesis, fnMaster, fnBook, fnWeb, fnLatin, fnLatinBook, fnSolo, fnProf, fnUndated, retracted, off];
const fnDoc = (lang, body, sources = FN) => ({ style: 'footnotes', lang, sources, sections: [{ text: body }] });
const allOf = (sources) => sources.map((s) => `[@${s.key}]`).join(' ');
/** The notes a pass over `body` makes, as text, in order. */
const notesOf = (lang, body, sources = FN, ctx = citeContext(fnDoc(lang, allOf(sources), sources))) =>
  renderRuns(runsOf(body), ctx).filter((r) => r.note).map((r) => text(r.note));
/** The first note, and the one after it, for one source cited twice. */
const twice = (s, lang = 'ar', first = '', later = '', sources = FN) =>
  notesOf(lang, `a [@${s.key}${first ? `, ${first}` : ''}] b [@${s.key}${later ? `, ${later}` : ''}] c`, sources);

// Each form, first and later, as the example writes them.
{
  const [dictFirst, dictLater] = twice(fnDict, 'ar', 'مادة (عقد)، ج2، ص110', 'مادة (حكم)، ج3، ص45');
  eq('footnotes: a dictionary, first — author، title، publisher، city، ط، year هـ، the locator as given', dictFirst, 'ابن حامد، معجم الألفاظ القانونية، دار الأفق، بغداد، ط3، 1420هـ، مادة (عقد)، ج2، ص110.');
  eq('footnotes: a dictionary, later', dictLater, 'ابن حامد، مصدر سابق، مادة (حكم)، ج3، ص45.');
  const [artFirst, artLater] = twice(fnArt, 'ar', 'ص212', '215');
  eq('footnotes: an article, first — بحث منشور في, the volume and issue, the page the marker gave', artFirst, 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021، ص212.');
  eq('footnotes: an article, later — مصدر سابق', artLater, 'كريم ناصر العبيدي، مصدر سابق، ص215.');
  ok('footnotes: never the article\'s page range', !artFirst.includes('200') && !artFirst.includes('230'));
  eq('footnotes: no locator, no page', twice(fnArt)[0], 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021.');
  eq('footnotes: a later citation with no locator', twice(fnArt)[1], 'كريم ناصر العبيدي، مصدر سابق.');
  eq('footnotes: two authors joined with و, a special issue and a part as the record gives them', twice(fnDuo, 'ar', '40')[0],
    'ليلى حسن الربيعي وأ.د. سامر خليل عبد الجبار، حدود السلطة التقديرية للإدارة، بحث منشور في مجلة الدراسات الإدارية، كلية الإدارة والاقتصاد، جامعة الرافدين، المجلد 9، عدد خاص، الجزء الثاني، 2022، ص40.');
  eq('footnotes: two authors, later', twice(fnDuo, 'ar', '40', '41')[1], 'ليلى حسن الربيعي وأ.د. سامر خليل عبد الجبار، مصدر سابق، ص41.');
  eq('footnotes: a special issue and no volume', twice(fnSpecial, 'ar', '12')[0], 'د. بشرى عادل النعيمي، إدارة الأوقاف في المدن، بحث منشور في مجلة العلوم الاجتماعية، عدد خاص بالمؤتمر العلمي الثالث، 2023، ص12.');
  const [lawFirst, lawLater] = twice(fnLaw, 'ar', 'المادة 20/ثالثاً', 'المادة 7');
  eq('footnotes: a law, first — the article, من, the full name', lawFirst, 'المادة 20/ثالثاً من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('footnotes: a law, later — no number or year', lawLater, 'المادة 7 من قانون تنظيم المهن الهندسية.');
  eq('footnotes: a law without an article', twice(fnLaw)[0], 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('footnotes: and later without one', twice(fnLaw)[1], 'قانون تنظيم المهن الهندسية.');
  eq('footnotes: a bare number is an article', twice(fnLaw, 'ar', '13/ثانياً')[0], 'المادة 13/ثانياً من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('footnotes: several articles as the model wrote them', twice(fnLaw, 'ar', 'المادتان 6 و8')[0], 'المادتان 6 و8 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  const [conFirst, conLater] = twice(fnConst, 'ar', 'المادة 30/أولاً', 'المادة 31');
  eq('footnotes: a constitution — no number, just لسنة', conFirst, 'المادة 30/أولاً من دستور جمهورية العراق لسنة 2005.');
  eq('footnotes: and it keeps its year later', conLater, 'المادة 31 من دستور جمهورية العراق لسنة 2005.');
  eq('footnotes: instructions named with a law in them keep their own number', twice(fnRules, 'ar', 'المادة 12/سادساً')[0], 'المادة 12/سادساً من تعليمات تنفيذ قانون تنظيم المهن الهندسية رقم 4 لسنة 2012.');
  eq('footnotes: a thesis', twice(fnThesis, 'ar', '77')[0], 'هالة فاضل السامرائي، التنظيم القانوني للإيجار التمويلي، رسالة، كلية القانون، جامعة الرافدين، 2019، ص77.');
  eq('footnotes: a thesis whose record says what it was', twice(fnMaster)[0], 'نبيل صالح الدوري، الشخصية المعنوية للشركات، رسالة ماجستير، كلية القانون، جامعة الرافدين، 2017.');
  eq('footnotes: a doctoral thesis the record names', twice(src('fd', { title: 'دراسة', authors: [P('علي')], year: 2020, type: 'thesis', publisher: 'برنامج الدكتوراه، جامعة الرافدين' }), 'ar', '', '', [src('fd', { title: 'دراسة', authors: [P('علي')], year: 2020, type: 'thesis', publisher: 'برنامج الدكتوراه، جامعة الرافدين' })])[0], 'علي، دراسة، أطروحة دكتوراه، برنامج الدكتوراه، جامعة الرافدين، 2020.');
  eq('footnotes: a book, the edition after the place', twice(fnBook, 'ar', 'ص 33')[0], 'عادل كاظم الجنابي، الوسيط في القانون الإداري، دار الوفاق للنشر، بغداد، ط2، 2016، ص33.');
  eq('footnotes: a book with no year says so', twice(fnUndated)[0], 'منى الزبيدي، مذكرات في القانون الإداري، مطبعة الجامعة، د.ت.');
  eq('footnotes: a web page with its address', twice(fnWeb)[0], 'تقرير الإسكان الحضري، وزارة التخطيط، 2024، متاح على: https://example.org/report.');
  eq('footnotes: a web page without an author is named later by its title', twice(fnWeb)[1], 'تقرير الإسكان الحضري، مصدر سابق.');
  ok('footnotes: the address is a link', (() => {
    const ctx = citeContext(fnDoc('ar', allOf(FN)));
    const note = renderRuns(runsOf(`[@${fnWeb.key}]`), ctx)[0].note;
    return same(links(note), [['https://example.org/report', 'https://example.org/report']]);
  })());
  eq('footnotes: a law the model proposed is cited like any other', twice(fnDecision, 'ar')[0], 'قرار مجلس الوزراء رقم 150 لسنة 2020.');
  eq('footnotes: a Gregorian year takes no هـ', twice(src('g1', { title: 'كتاب حديث', authors: [P('حسن')], year: 1999, type: 'book' }), 'ar', '', '', [src('g1', { title: 'كتاب حديث', authors: [P('حسن')], year: 1999, type: 'book' })])[0], 'حسن، كتاب حديث، 1999.');
  // Two cited works by the same people: a later note keeps the title.
  const other = src('f2b', { title: 'الحوكمة في الشركات', authors: [P('العبيدي', 'كريم ناصر')], year: 2020, venue: 'مجلة' });
  eq('footnotes: a later note keeps the title when the authors wrote two cited works', twice(fnArt, 'ar', '', '9', [fnArt, other])[1], 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، مصدر سابق، ص9.');
  eq('footnotes: two laws of one name keep their numbers later', twice(fnLaw, 'ar', '1', '2', [fnLaw, { ...fnLaw, key: 'f5b', number: '8', year: 2015 }])[1], 'المادة 2 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
}

// A Latin-script work in an Arabic document: Chicago's notes, in English.
{
  const [first, later] = twice(fnLatin, 'ar', 'p. 45', '50');
  eq('footnotes: a Latin article, first, as Chicago notes it', first, 'Anna Beth Family and Carl Other, "Learning with machines," Journal of Things 12, no. 3 (2020): 45, https://doi.org/10.1000/xyz.');
  eq('footnotes: and later, the short form', later, 'Family and Other, "Learning with machines," 50.');
  const [bookFirst, bookLater] = twice(fnLatinBook, 'ar', '12', '14');
  eq('footnotes: a Latin book, first', bookFirst, 'Jane Baker, Methods of inquiry, 3rd ed. (Leeds: Northfield Press, 2019), 12.');
  eq('footnotes: a Latin book, later', bookLater, 'Baker, Methods of inquiry, 14.');
  const ctx = citeContext(fnDoc('ar', allOf(FN)));
  const [a, b] = renderRuns(runsOf(`[@${fnLatin.key}] [@${fnLatinBook.key}]`), ctx).map((r) => r.note);
  ok('footnotes: the journal is italic, the article title is not', same(italics(a), ['Journal of Things']));
  ok('footnotes: the DOI is a link', same(links(a), [['https://doi.org/10.1000/xyz', 'https://doi.org/10.1000/xyz']]));
  ok('footnotes: a book title is italic', same(italics(b), ['Methods of inquiry']));
  ok('footnotes: an Arabic note has no italics', notesOf('ar', `[@${fnBook.key}]`).length === 1
    && italics(renderRuns(runsOf(`[@${fnBook.key}]`), citeContext(fnDoc('ar', allOf(FN))))[0].note).length === 0);
  const trio = src('f18', { title: 'Why now?', authors: [P('Lee', 'Kim'), P('Park', 'Min'), P('Cho', 'Ha')], year: 2018, venue: 'Asian Review', volume: '5' });
  eq('footnotes: three authors, and a title that ends in a question', twice(trio, 'ar', '', '', [trio])[0], 'Kim Lee, Min Park, and Ha Cho, "Why now?" Asian Review 5 (2018).');
  eq('footnotes: and later', twice(trio, 'ar', '', '3', [trio])[1], 'Lee, Park, and Cho, "Why now?" 3.');
  const four = src('f19', { title: 'Big collaboration', authors: [P('One', 'A'), P('Two', 'B'), P('Three', 'C'), P('Four', 'D')], year: 2022, venue: 'Science' });
  eq('footnotes: four or more authors are the first et al.', twice(four, 'ar', '', '', [four])[0], 'A One et al., "Big collaboration," Science (2022).');
  const thesis = src('f20', { title: 'Teachers and technology', authors: [P('Ahmed', 'Sara')], year: 2021, type: 'thesis', publisher: 'University of Duhok' });
  eq('footnotes: a Latin thesis', twice(thesis, 'ar', '8', '', [thesis])[0], 'Sara Ahmed, "Teachers and technology" (thesis, University of Duhok, 2021), 8.');
  const chapter = src('f21', { title: 'Case studies', authors: [P('Stone', 'Rob')], year: 2005, type: 'chapter', venue: 'The handbook of methods', pages: '443-466', publisher: 'Northfield Press', city: 'Leeds' });
  eq('footnotes: a Latin chapter', twice(chapter, 'ar', '450', '', [chapter])[0], 'Rob Stone, "Case studies," in The handbook of methods (Leeds: Northfield Press, 2005), 450.');
  const latinLaw = src('f22', { title: 'Civil Code', number: '40', year: 1951, type: 'law' });
  const [lawFirst, lawLater] = twice(latinLaw, 'ar', '4', 'art. 5', [latinLaw]);
  eq('footnotes: a Latin-script law', lawFirst, 'Civil Code, No. 40 of 1951, art. 4.');
  eq('footnotes: and later', lawLater, 'Civil Code, art. 5.');
}

// Sorani and Badini: the same structure in Kurdish words, and Arabic works in Arabic ones.
{
  const kBook = src('k1', { title: 'مێژووی یاسای کارگێڕی', authors: [P('کەریم', 'ئازاد')], year: 2015, type: 'book', publisher: 'چاپخانەی ڕووناکی', city: 'هەولێر', edition: '2' });
  const kArt = src('k2', { title: 'چاودێریی دارایی لە هەرێمدا', authors: [P('ئەحمەد', 'شیلان'), P('عومەر', 'دلێر')], year: 2018, venue: 'گۆڤاری زانکۆی سۆران', volume: '3', issue: '2' });
  const kLaw = src('k3', { title: 'یاسای پاراستنی ژینگە', number: '1', year: 2011, type: 'law' });
  const kThesis = src('k4', { title: 'ڕۆڵی شارەوانییەکان', authors: [P('حەسەن', 'ڕێژین')], year: 2020, type: 'thesis', venue: 'زانکۆی دهۆک' });
  const K = [kBook, kArt, kLaw, kThesis, fnArt, fnLaw];
  eq('Sorani: a book, first', twice(kBook, 'ckb', '45', '', K)[0], 'ئازاد کەریم، مێژووی یاسای کارگێڕی، چاپخانەی ڕووناکی، هەولێر، چاپی 2، 2015، ل45.');
  eq('Sorani: later — سەرچاوەی پێشوو, and ل for the page', twice(kBook, 'ckb', '45', 'ل 50', K)[1], 'ئازاد کەریم، سەرچاوەی پێشوو، ل50.');
  eq('Sorani: an article — بەرگی and ژمارە, two authors joined with a word of their own', twice(kArt, 'ckb', '12', '', K)[0], 'شیلان ئەحمەد و دلێر عومەر، چاودێریی دارایی لە هەرێمدا، گۆڤاری زانکۆی سۆران، بەرگی 3، ژمارە 2، 2018، ل12.');
  eq('Sorani: a Kurdish law, first', twice(kLaw, 'ckb', '5', '6', K)[0], 'مادەی 5 لە یاسای پاراستنی ژینگە ژمارە 1ی ساڵی 2011.');
  eq('Sorani: and later', twice(kLaw, 'ckb', '5', '6', K)[1], 'مادەی 6 لە یاسای پاراستنی ژینگە.');
  eq('Sorani: a thesis', twice(kThesis, 'ckb', '', '', K)[0], 'ڕێژین حەسەن، ڕۆڵی شارەوانییەکان، نامە، زانکۆی دهۆک، 2020.');
  eq('Sorani: an Arabic work keeps its Arabic form', twice(fnArt, 'ckb', '9', '10', K).join(' | '), 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021، ص9. | كريم ناصر العبيدي، مصدر سابق، ص10.');
  eq('Sorani: an Iraqi law stays Arabic', twice(fnLaw, 'ckb', '3', '', K)[0], 'المادة 3 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('Badini: a book, first', twice(kBook, 'kmr', '45', '', K)[0], 'ئازاد کەریم، مێژووی یاسای کارگێڕی، چاپخانەی ڕووناکی، هەولێر، چاپا 2، 2015، ل45.');
  eq('Badini: later — ژێدەرێ بەری', twice(kBook, 'kmr', '45', '50', K)[1], 'ئازاد کەریم، ژێدەرێ بەری، ل50.');
  eq('Badini: an article — بەرگێ', twice(kArt, 'kmr', '', '', K)[0], 'شیلان ئەحمەد و دلێر عومەر، چاودێریی دارایی لە هەرێمدا، گۆڤاری زانکۆی سۆران، بەرگێ 3، ژمارە 2، 2018.');
  eq('Badini: a Kurdish law, first', twice(kLaw, 'kmr', '5', '6', K)[0], 'مادەیا 5 ژ یاسای پاراستنی ژینگە ژمارە 1 یا سالا 2011.');
  eq('Badini: and later', twice(kLaw, 'kmr', '5', '6', K)[1], 'مادەیا 6 ژ یاسای پاراستنی ژینگە.');
  eq('Badini: an Arabic work keeps its Arabic form', twice(fnArt, 'kmr', '', '10', K)[1], 'كريم ناصر العبيدي، مصدر سابق، ص10.');
  eq('a Kurdish work in an Arabic document is cited in Arabic words', twice(kBook, 'ar', '45', '50', K).join(' | '), 'ئازاد کەریم، مێژووی یاسای کارگێڕی، چاپخانەی ڕووناکی، هەولێر، ط2، 2015، ص45. | ئازاد کەریم، مصدر سابق، ص50.');
  const said = src('k5', { title: 'Kurdish in Latin letters', authors: [P('Aziz', 'Ali')], year: 2019, venue: 'J', lang: 'ku' });
  eq('a Latin-script Kurdish work is still Chicago', twice(said, 'ckb', '', '', [said])[0], 'Ali Aziz, "Kurdish in Latin letters," J (2019).');
  const byRecord = src('k6', { title: 'دراسة', authors: [P('ئازاد')], year: 2019, venue: 'گۆڤار', volume: '2', lang: 'ku' });
  eq('a work its record calls Kurdish is Kurdish, whatever its letters', twice(byRecord, 'ckb', '', '', [byRecord])[0], 'ئازاد، دراسة، گۆڤار، بەرگی 2، 2019.');
}

// First and later, in one pass.
{
  const body = `One [@f2, 10]. Two [@f2, 11]. Three [@f5, 1] [@f5, 2].`;
  const ctx = citeContext(fnDoc('ar', allOf(FN)));
  const out = renderRuns(runsOf(body), ctx);
  const notes = out.filter((r) => r.note).map((r) => text(r.note));
  eq('seen: the second citation straight after the first is short, never المصدر نفسه', notes[1], 'كريم ناصر العبيدي، مصدر سابق، ص11.');
  ok('seen: no note says المصدر نفسه', !notes.some((n) => n.includes('نفسه')));
  eq('seen: a law cited twice in a row', notes.slice(2).join(' | '), 'المادة 1 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012. | المادة 2 من قانون تنظيم المهن الهندسية.');
  ok('seen: the context records what was cited', same([...ctx.seen].sort(), ['f2', 'f5']));
  const later = renderRuns(runsOf('Again [@f2].'), ctx);
  eq('seen: the same context, carried on, is later still', text(later[1].note), 'كريم ناصر العبيدي، مصدر سابق.');
  const fresh = citeContext(fnDoc('ar', allOf(FN)));
  eq('seen: a fresh context starts again', text(renderRuns(runsOf('Again [@f2].'), fresh)[1].note).slice(0, 40), text(out[1].note).slice(0, 40));
  const peek = citeContext(fnDoc('ar', allOf(FN)));
  eq('seen: inText gives the note\'s text', inText(['f2'], peek, 'ص5'), 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021، ص5.');
  ok('seen: and records nothing', peek.seen.size === 0 && inText(['f2'], peek) === inText(['f2'], peek));
  renderRuns(runsOf('[@f2]'), peek);
  eq('seen: after a note it gives the short form', inText(['f2'], peek), 'كريم ناصر العبيدي، مصدر سابق.');
  const sections = [{ text: 'A [@f3, 1].' }, { text: 'B [@f3, 2].' }];
  const pass = citeContext({ ...fnDoc('ar', ''), sections });
  const perSection = sections.map((s) => renderRuns(runsOf(s.text), pass).filter((r) => r.note).map((r) => text(r.note))[0]);
  ok('seen: carried across sections, in order', perSection[0].includes('حدود السلطة') && perSection[1].includes('مصدر سابق'), perSection);
  const noSeen = { style: 'footnotes', lang: 'ar', sources: FN, order: ['f2'] };
  ok('seen: a context made without one gets one', text(renderRuns(runsOf('[@f2] [@f2]'), noSeen)[1].note).includes('مصدر سابق') && noSeen.seen instanceof Set);
}

// Several keys in one marker, and keys that name nothing.
{
  const ctx = () => citeContext(fnDoc('ar', allOf(FN)));
  const one = (body, c = ctx()) => renderRuns(runsOf(body), c);
  eq('several keys: one note, joined with ؛, the locator with the first', one('x [@f2, ص7; @f5]')[1] && text(one('x [@f2, ص7; @f5]')[1].note),
    'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021، ص7؛ قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  ok('several keys: one note run for the marker', one('x [@f2; @f5; @f13]').filter((r) => r.note).length === 1);
  eq('several keys: a Latin work among Arabic ones, each in its own form', text(one('[@f5, 3; @f13]')[0].note), 'المادة 3 من قانون تنظيم المهن الهندسية رقم 31 لسنة 2012؛ Anna Beth Family and Carl Other, "Learning with machines," Journal of Things 12, no. 3 (2020), https://doi.org/10.1000/xyz.');
  const c = ctx();
  one('[@f2]', c);
  eq('several keys: each first or later on its own', text(one('[@f2; @f11]', c)[0].note), 'كريم ناصر العبيدي، مصدر سابق؛ عادل كاظم الجنابي، الوسيط في القانون الإداري، دار الوفاق للنشر، بغداد، ط2، 2016.');
  ok('several keys: and all of them count as cited', c.seen.has('f11'));
  eq('several keys: a key twice is cited once', text(one('[@f5; @f5]')[0].note), 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('unknown keys: dropped from the note', text(one('[@s99; @f5]')[0].note), 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  eq('unknown keys: a locator goes with its unknown key', text(one('[@s99, 4; @f5]')[0].note), 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012.');
  ok('unknown keys: a marker with none known leaves no note', one('as shown [@s99].').every((r) => !r.note) && text(one('as shown [@s99].')) === 'as shown.');
  ok('retracted or switched off: no note', one('a [@s14] b [@s15] c').every((r) => !r.note) && text(one('a [@s14] b [@s15] c')) === 'a b c');
  const c2 = ctx();
  one('[@s99]', c2);
  ok('unknown keys: nothing is recorded', c2.seen.size === 0);
  eq('inText: nothing known is nothing', inText(['s99', 's14'], ctx()), '');
}

// Digits: the preview and the Word file write Arabic-script text in the
// document's numerals run by run, and leave a run with Latin letters alone.
// So the pieces of a note are runs of their own.
{
  const eastern = { lang: 'ar', digits: 'eastern' };
  const shown = (runs) => runs.map((r) => (r.link ? r.text : localDigits(r.text, eastern))).join('');
  const covid = src('cv', { title: 'أثر COVID-19 في التعليم الجامعي', authors: [P('حسن', 'علي')], year: 2021, venue: 'مجلة التربية', volume: '7', doi: '10.5555/cv.1' });
  const ctx = citeContext(fnDoc('ar', `[@cv] [@f5] [@f13]`, [covid, fnLaw, fnLatin]));
  const [a, b] = renderRuns(runsOf('x [@cv, 12] y [@f5, 3; @f13]'), ctx).filter((r) => r.note).map((r) => r.note);
  eq('digits: a Latin term keeps its own, the rest of the note takes the document\'s', shown(a), 'علي حسن، أثر COVID-19 في التعليم الجامعي، بحث منشور في مجلة التربية، المجلد ٧، ٢٠٢١، ص١٢.');
  eq('digits: an Arabic law and a Latin article in one note, each in its own', shown(b), 'المادة ٣ من قانون تنظيم المهن الهندسية رقم ٣١ لسنة ٢٠١٢؛ Anna Beth Family and Carl Other, "Learning with machines," Journal of Things 12, no. 3 (2020), https://doi.org/10.1000/xyz.');
  const entry = referenceList(ctx).flatMap((g) => g.entries).find((e) => e.key === 'cv');
  eq('digits: and in the list, the DOI untouched', shown(entry.runs), 'علي حسن، أثر COVID-19 في التعليم الجامعي، بحث منشور في مجلة التربية، المجلد ٧، ٢٠٢١. https://doi.org/10.5555/cv.1');
}

// The note run, where it sits.
{
  const ctx = () => citeContext(fnDoc('ar', allOf(FN)));
  const out = renderRuns(runsOf('كما نصت المادة [@f7, المادة 30]، وهو'), ctx());
  ok('the run: text empty, the note inside', out[1].text === '' && Array.isArray(out[1].note) && out.length === 3, out);
  eq('the run: set against the word before it, the text around it kept', out.map((r) => (r.note ? '¹' : r.text)).join(''), 'كما نصت المادة¹، وهو');
  eq('the run: two notes side by side', renderRuns(runsOf('a [@f2] [@f5] b'), ctx()).map((r) => (r.note ? '¹' : r.text)).join(''), 'a¹¹ b');
  ok('the run: a dropped marker after a note does not take the note with it', renderRuns(runsOf('a [@f2][@s99] b'), ctx()).filter((r) => r.note).length === 1);
  ok('the run: nor does one after a space', renderRuns(runsOf('a [@f2] [@s99] b'), ctx()).filter((r) => r.note).length === 1);
  eq('the run: after bold', renderRuns(runsOf('**مفهوم** [@f1]'), ctx()).map((r) => (r.note ? '¹' : r.text)).join(''), 'مفهوم¹');
  ok('the run: a gap before it stays', renderRuns(runsOf('[[x]] [@f1]'), ctx())[0].hole === true);
  const marks = (line) => renderRuns(runsOf(line), ctx()).map((r) => (r.note ? '¹' : r.text)).join('');
  eq('the run: brackets wrapped round a marker go with it', marks('كما نصت المادة ([@f7, 30]) على'), 'كما نصت المادة¹ على');
  eq('the run: and at the end of a sentence', marks('as shown ([@f2]).'), 'as shown¹.');
  eq('the run: a bracket that opens earlier stays', marks('(see [@f2] and more)'), '(see¹ and more)');
  eq('the run: a bracket that closes later stays', marks('text ([@f2] and more)'), 'text (¹ and more)');
  eq('the run: an opening bracket alone before a note stays', marks('([@f2] x'), '(¹ x');
  ok('the run: the runs given are not changed', (() => {
    const runs = runsOf('keep [@f2] this [@s99] too');
    const before = JSON.stringify(runs);
    renderRuns(runs, ctx());
    return JSON.stringify(runs) === before;
  })());
  ok('the run: other styles never make a note', STYLES.filter((s) => s !== 'footnotes').every((style) =>
    renderRuns(runsOf('a [@s1] b'), citeContext(doc(style, 'en'))).every((r) => !r.note)));
}

// The list, grouped by kind.
{
  const heads = (groups) => groups.map((g) => g.heading);
  const list = (lang, sources = FN) => referenceList(citeContext(fnDoc(lang, allOf(sources), sources)));
  const every = [fnDict, fnBook, fnThesis, fnArt, fnLaw, fnWeb, fnLatin];
  eq('list: Arabic ordinals and kinds, in order', heads(list('ar', every)).join(' | '),
    'أولاً: المعاجم | ثانياً: الكتب | ثالثاً: الرسائل والأطاريح | رابعاً: البحوث والدراسات | خامساً: الدستور والتشريعات والقرارات | سادساً: المواقع الإلكترونية | سابعاً: المصادر الأجنبية');
  eq('list: Sorani', heads(list('ckb', every)).join(' | '),
    'یەکەم: فەرهەنگەکان | دووەم: کتێبەکان | سێیەم: نامە و تێزەکان | چوارەم: توێژینەوەکان | پێنجەم: دەستوور و یاساکان | شەشەم: ماڵپەڕەکان | حەوتەم: سەرچاوە بیانییەکان');
  eq('list: Badini', heads(list('kmr', every)).join(' | '),
    'ئێک: فەرهەنگ | دوو: پەرتووک | سێ: نامە و تێز | چار: ڤەکولین | پێنج: دەستوور و یاسا | شەش: ماڵپەر | حەفت: ژێدەرێن بیانی');
  ok('list: the first ordinal is the one WORDS uses', list('ar', every)[0].heading.split(':')[0] === WORDS.ar.local.split(':')[0]
    && list('ckb', every)[0].heading.split(':')[0] === WORDS.ckb.local.split(':')[0]
    && list('kmr', every)[0].heading.split(':')[0] === WORDS.kmr.local.split(':')[0]);
  eq('list: only the kinds that are cited, counted over those', heads(list('ar', [fnDict, fnArt, fnDuo, fnLaw, fnConst])).join(' | '),
    'أولاً: المعاجم | ثانياً: البحوث والدراسات | ثالثاً: الدستور والتشريعات والقرارات');
  const g = list('ar');
  const byHead = new Map(g.map((x) => [x.heading.split(': ')[1], x]));
  const keys = (name) => byHead.get(name).entries.map((e) => e.key).join(' ');
  const ns = (name) => byHead.get(name).entries.map((e) => e.n).join(' ');
  eq('list: studies filed by the name as printed, without د. أ.د. or ال', keys('البحوث والدراسات'), 'f4 f15 f2 f3 f16');
  eq('list: numbered from one in each group', ns('البحوث والدراسات'), '1 2 3 4 5');
  eq('list: and again in the next', ns('الدستور والتشريعات والقرارات'), '1 2 3 4');
  eq('list: legislation — the constitution first, then by year, then by the gazette', keys('الدستور والتشريعات والقرارات'), 'f7 f5 f6 f8');
  eq('list: books, the undated one included', keys('الكتب'), 'f11 f17');
  eq('list: theses', keys('الرسائل والأطاريح'), 'f10 f9');
  eq('list: every Latin-script work in the foreign group, by family name', keys('المصادر الأجنبية'), 'f14 f13');
  ok('list: a Kurdish, Arabic and Latin law never share a group with works', byHead.get('الدستور والتشريعات والقرارات').entries.length === 4);
  ok('list: never a retracted, switched-off, uncited or unknown source', !g.flatMap((x) => x.entries.map((e) => e.key)).some((k) => ['s14', 's15', 's16', 's99'].includes(k)));
  ok('list: every cited usable source once', g.flatMap((x) => x.entries).length === 17);
  const entryOf = (key, lang = 'ar', sources = FN) => text(list(lang, sources).flatMap((x) => x.entries).find((e) => e.key === key).runs);
  eq('list: a dictionary, the edition first', entryOf('f1'), 'ابن حامد، معجم الألفاظ القانونية، ط3، دار الأفق، بغداد، 1420هـ.');
  eq('list: an article, as its first note without a page', entryOf('f3'), 'ليلى حسن الربيعي وأ.د. سامر خليل عبد الجبار، حدود السلطة التقديرية للإدارة، بحث منشور في مجلة الدراسات الإدارية، كلية الإدارة والاقتصاد، جامعة الرافدين، المجلد 9، عدد خاص، الجزء الثاني، 2022.');
  eq('list: a special issue without a volume', entryOf('f4'), 'د. بشرى عادل النعيمي، إدارة الأوقاف في المدن، بحث منشور في مجلة العلوم الاجتماعية، عدد خاص بالمؤتمر العلمي الثالث، 2023.');
  eq('list: a law with where it was published', entryOf('f5'), 'قانون تنظيم المهن الهندسية رقم 31 لسنة 2012، الوقائع العراقية، العدد 4250، 3 نيسان 2012.');
  eq('list: a constitution', entryOf('f7'), 'دستور جمهورية العراق لسنة 2005.');
  eq('list: a book', entryOf('f11'), 'عادل كاظم الجنابي، الوسيط في القانون الإداري، ط2، دار الوفاق للنشر، بغداد، 2016.');
  eq('list: a thesis', entryOf('f9'), 'هالة فاضل السامرائي، التنظيم القانوني للإيجار التمويلي، رسالة، كلية القانون، جامعة الرافدين، 2019.');
  eq('list: a web page', entryOf('f12'), 'تقرير الإسكان الحضري، وزارة التخطيط، 2024، متاح على: https://example.org/report.');
  eq('list: a Latin article, as Chicago\'s bibliography lists it', entryOf('f13'), 'Family, Anna Beth, and Carl Other. "Learning with machines." Journal of Things 12, no. 3 (2020): 45–67. https://doi.org/10.1000/xyz.');
  eq('list: a Latin book', entryOf('f14'), 'Baker, Jane. Methods of inquiry. 3rd ed. Leeds: Northfield Press, 2019.');
  const doied = src('f23', { title: 'دراسة منشورة', authors: [P('علي', 'حسن')], year: 2020, venue: 'مجلة', doi: '10.5555/ar.1' });
  const doiRuns = list('ar', [doied])[0].entries[0].runs;
  eq('list: an Arabic work with a DOI ends with it', text(doiRuns), 'حسن علي، دراسة منشورة، بحث منشور في مجلة، 2020. https://doi.org/10.5555/ar.1');
  ok('list: the DOI is its own run, so its digits stay Western', same(links(doiRuns), [['https://doi.org/10.5555/ar.1', 'https://doi.org/10.5555/ar.1']]));
  ok('list: no italics in Arabic entries', g.slice(0, -1).every((x) => x.entries.every((e) => italics(e.runs).length === 0)));
  ok('list: Chicago italics in the foreign group', same(italics(byHead.get('المصادر الأجنبية').entries[0].runs), ['Methods of inquiry']));
  ok('list: every entry is what reference() gives', g.every((x) => x.entries.every((e) => same(e.runs, reference(FN.find((s) => s.key === e.key), citeContext(fnDoc('ar', allOf(FN))))))));
  const ku = list('ckb', [src('k1', { title: 'مێژووی یاسای کارگێڕی', authors: [P('کەریم', 'ئازاد')], year: 2015, type: 'book', publisher: 'چاپخانەی ڕووناکی', city: 'هەولێر', edition: '2' }), fnBook]);
  eq('list: a Sorani book, in Sorani words', text(ku[0].entries[0].runs), 'ئازاد کەریم، مێژووی یاسای کارگێڕی، چاپی 2، چاپخانەی ڕووناکی، هەولێر، 2015.');
  eq('list: and an Arabic one beside it, in Arabic', text(ku[0].entries[1].runs), 'عادل كاظم الجنابي، الوسيط في القانون الإداري، ط2، دار الوفاق للنشر، بغداد، 2016.');
  ok('list: nothing cited is no list', referenceList(citeContext(fnDoc('ar', 'No markers.'))).length === 0);
  ok('list: only unusable markers is no list', referenceList(citeContext(fnDoc('ar', '[@s14] [@s15] [@s99]'))).length === 0);
  ok('list: the reference list does not depend on the pass', (() => {
    const c = citeContext(fnDoc('ar', allOf(FN)));
    const before = JSON.stringify(referenceList(c));
    renderRuns(runsOf(allOf(FN)), c);
    return JSON.stringify(referenceList(c)) === before;
  })());
}

// An English document in the footnotes style: Chicago notes and bibliography.
{
  const E = [two, book, chapter, thesis, fnArt, fnLaw, src('c3', { title: 'Civil Code', number: '40', year: 1951, type: 'law' })];
  const body = 'Text [@s2, p. 45]. More [@s2, 50]; [@s8, 12] and [@s9] [@s10] [@f2, 9] [@c3, 4] [@c3, 5] [@s8; @s2] [@f5].';
  const ctx = citeContext({ style: 'footnotes', lang: 'en', sources: E, sections: [{ text: body }] });
  const notes = renderRuns(runsOf(body), ctx).filter((r) => r.note).map((r) => text(r.note));
  eq('English: a first note', notes[0], 'Anna Beth Family and Carl Other, "Learning with machines," Journal of Things 12, no. 3 (2020): 45, https://doi.org/10.1000/xyz.');
  eq('English: a later one', notes[1], 'Family and Other, "Learning with machines," 50.');
  eq('English: a book', notes[2], 'John W. Creswell, Research design (SAGE, 2014), 12.');
  eq('English: a chapter', notes[3], 'Robert E. Stake, "Qualitative case studies," in The SAGE handbook of qualitative research (SAGE, 2005).');
  eq('English: a thesis', notes[4], 'Sara Ahmed, "Teachers and technology" (thesis, University of Duhok, 2021).');
  eq('English: an Arabic work keeps its Arabic form', notes[5], 'كريم ناصر العبيدي، التحكيم في عقود الإنشاءات، بحث منشور في مجلة البحوث القانونية، كلية القانون، جامعة الرافدين، المجلد 14، العدد 3، 2021، ص9.');
  eq('English: a law, first and later', `${notes[6]} | ${notes[7]}`, 'Civil Code, No. 40 of 1951, art. 4. | Civil Code, art. 5.');
  eq('English: several keys joined with ;', notes[8], 'Creswell, Research design; Family and Other, "Learning with machines."');
  const g = referenceList(ctx);
  ok('English: one list, its heading left to the caller', g.length === 1 && g[0].heading === '');
  ok('English: unnumbered, as a bibliography is', g[0].entries.every((e) => e.n === undefined));
  eq('English: Latin works by family name, then the Arabic-script ones', g[0].entries.map((e) => e.key).join(' '), 's10 c3 s8 s2 s9 f5 f2');
  eq('English: Chicago bibliography entries', g[0].entries.slice(0, 5).map((e) => text(e.runs)).join(' | '),
    'Ahmed, Sara. "Teachers and technology." Thesis, University of Duhok, 2021. | Civil Code, No. 40 of 1951. | Creswell, John W. Research design. SAGE, 2014. | '
    + 'Family, Anna Beth, and Carl Other. "Learning with machines." Journal of Things 12, no. 3 (2020): 45–67. https://doi.org/10.1000/xyz. | '
    + 'Stake, Robert E. "Qualitative case studies." In The SAGE handbook of qualitative research, 443–466. SAGE, 2005.');
  const phd = src('p1', { title: 'Deep study', authors: [P('Nur', 'Ala')], year: 2022, type: 'thesis', publisher: 'University of Duhok, doctoral programme' });
  const pc = citeContext({ style: 'footnotes', lang: 'en', sources: [phd], sections: [{ text: '[@p1]' }] });
  eq('English: a doctoral thesis the record names', text(renderRuns(runsOf('[@p1]'), pc)[0].note), 'Ala Nur, "Deep study" (PhD diss., University of Duhok, doctoral programme, 2022).');
  eq('English: and its entry', text(referenceList(pc)[0].entries[0].runs), 'Nur, Ala. "Deep study." PhD diss., University of Duhok, doctoral programme, 2022.');
}

// ── never "undefined", never empty punctuation ────────────────────────────
{
  let seed = 7;
  const rand = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
  const pick = (xs) => xs[rand(xs.length)];
  const maybe = (v) => (rand(2) ? v : undefined);
  const TYPES = ['article', 'book', 'chapter', 'thesis', 'conference', 'report', 'web', 'other', 'law', 'dictionary'];
  const latinPeople = [[], [P('Solo', 'Ann')], [P('One', 'Ann'), P('Two', 'Bo')], [P('One', 'Ann'), P('Two', 'Bo'), P('Three', 'Cy')],
    Array.from({ length: 21 }, (_, i) => P(`N${i}`, `G${i}`)), [P('Org of Things')], [P('Eleven', '')]];
  const arabicPeople = [[], [P('الزهراني', 'محمد')], [P('الزهراني', 'محمد'), P('العتيبي', 'سعد')],
    [P('القحطاني', 'خالد'), P('السالم', 'نورة'), P('الحربي', 'فهد')], [P('وزارة التربية')],
    [P('أ.د. ئازاد کەریم')], Array.from({ length: 4 }, (_, i) => P(`ناو${i}`, 'ئازاد'))];
  // ".," is not here: "A. B., & C.", "n.d., p. 4" and "et al., 2018" are all correct.
  const BAD = [/undefined/, /\bnull\b/, /NaN/, /\[object/, /\(\s*\)/, /\[\s*\]/, /,\s*,/, /،\s*،/, /[,،]\s*\./, / [,.،;؛:]/, /;;/, / {2}/, /^\s/, /\s$/, /""/, /''/];
  let bad = 0, sample = '';
  const check = (label, t) => {
    const cleaned = t.replace(/\. \. \./g, '…');
    if (BAD.some((re) => re.test(cleaned)) || /\.\./.test(cleaned)) { bad++; if (!sample) sample = `${label}: ${t}`; }
  };
  for (let i = 0; i < 2500; i++) {
    const arabic = rand(3) === 0;
    const s = src(`r${i}`, {
      title: maybe(arabic
        ? pick(['عنوان الدراسة', 'هل ينجح التعليم؟', 'دراسة.', 'مێژووی یاسا', 'دستور الدولة', 'قانون العمل رقم 5 لسنة 2001'])
        : pick(['A title', 'Why now?', 'Ends here.', 'U.S. policy', 'Constitution of the State', 'Labour Act of 1999'])),
      authors: pick(arabic ? arabicPeople : latinPeople),
      year: maybe(pick([2020, 1999, 2024])),
      venue: maybe(arabic ? 'مجلة الدراسات' : 'Journal X'),
      volume: maybe('12'), issue: maybe('3'), pages: maybe(pick(['45-67', '9', 'e123'])),
      publisher: maybe(arabic ? 'دار النشر' : 'Press'), city: maybe(arabic ? 'بغداد' : 'London'),
      edition: maybe(pick(['1', '2', '3rd', 'Revised', 'الثالثة'])), number: maybe('12'), issued: maybe('9 March 2010'),
      doi: maybe('10.1234/abc.5'), url: maybe('https://example.org/x'),
      type: pick(TYPES), lang: maybe(pick(['ku', 'ar', 'en'])),
    });
    // A second record, so a note can cite two, and two works can share their authors.
    const t = { ...s, key: `q${i}`, title: maybe(arabic ? 'دراسة ثانية' : 'Second study'), type: pick(TYPES) };
    for (const style of STYLES) {
      for (const lang of ['en', 'ar', 'ckb', 'kmr']) {
        const ctx = citeContext({ style, lang, sources: [s], sections: [{ text: `[@${s.key}]` }] });
        const runs = reference(s, ctx);
        if (!runs.every((r) => typeof r.text === 'string' && r.text.length > 0)) { bad++; if (!sample) sample = `empty run ${style} ${lang}`; }
        check(`${style} ${lang} ${s.type} entry`, text(runs));
        const cite = inText([s.key], ctx, maybe('p. 4'));
        if (!cite) { bad++; if (!sample) sample = `no citation ${style} ${lang}`; }
        check(`${style} ${lang} ${s.type} cite`, cite);
        if (style !== 'footnotes') continue;
        // A note the first time and after, alone and with another, in one pass.
        const pass = citeContext({ style, lang, sources: [s, t], sections: [{ text: `[@${s.key}] [@${t.key}]` }] });
        const loc = maybe(pick(['p. 4', '12', 'المادة 3', 'ج2، ص9']));
        const body = `a [@${s.key}${loc ? `, ${loc}` : ''}] b [@${s.key}] c [@${t.key}; @${s.key}, 7] d [@${t.key}] e`;
        const notes = renderRuns(runsOf(body), pass).filter((r) => r.note);
        if (notes.length !== 4) { bad++; if (!sample) sample = `${notes.length} notes ${lang} ${s.type}`; }
        for (const n of notes) {
          if (!n.note.length || !n.note.every((r) => typeof r.text === 'string' && r.text.length > 0)) { bad++; if (!sample) sample = `empty note run ${lang} ${s.type}`; }
          check(`note ${lang} ${s.type}/${t.type}`, text(n.note));
          if (!/[.?!؟…]["'»]?$/.test(text(n.note))) { bad++; if (!sample) sample = `unstopped note ${lang}: ${text(n.note)}`; }
        }
        for (const g of referenceList(pass)) for (const e of g.entries) check(`list ${lang} ${s.type}/${t.type}`, text(e.runs));
      }
    }
  }
  ok('2500 random records × 6 styles × 4 languages, and in footnotes first, later and paired notes: no "undefined", no empty or doubled punctuation', bad === 0, sample);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
