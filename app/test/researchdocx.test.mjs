// The Word file of a research document: what the researcher was shown, in
// the shape of the owner's example, and a file Word opens without repairing.
//
// What matters, in order:
//
//   1. the file is a well-formed package — every XML part parses, and the
//      elements this module adds to the library's parts (footnote numbering,
//      the section's direction) sit where the schema puts them, because Word
//      calls a file with elements out of order unreadable;
//   2. text only ever goes in as text: a title that spells out an XML field
//      is printed, never obeyed, and no marker `[@s…]` survives into any part;
//   3. an Arabic document is laid out as the example is — right to left, a
//      cover with the institution, the logo, the byline, the supervisor and
//      two years, footnotes at the foot of the page numbered from one on every
//      page in Eastern digits and opening " ) ", the source list grouped by
//      kind under ordinal headings and numbered "١. ";
//   4. digits and direction are decided per word: Arabic text in ١٢٣, a Latin
//      citation, a DOI or "GPT-4" left as written, a Latin note laid out left
//      to right;
//   5. an English APA article has none of that, and a Sorani thesis has its
//      dedication, contents and English abstract.
//
// Every name, law, journal and title here is invented. The owner's example is
// a real student's paper; none of it belongs in this repository.
import { inflateRawSync } from 'node:zlib';
import { docxBase64, fileNameFor } from '../.test-build/researchdocx.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`); cond ? pass++ : fail++; };
const eq = (name, got, want) => ok(name, got === want, { got, want });

// ── reading the package ───────────────────────────────────────────────────

/** The files of a ZIP, read from its central directory. */
function unzip(buf) {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('no end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error('bad local header ' + name);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** '' when `xml` is well-formed; otherwise what is wrong with it. */
function malformed(xml) {
  for (const ch of xml) {
    const c = ch.charCodeAt(0);
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return `control character ${c}`;
  }
  const badEntity = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;
  const stack = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const text = lt === -1 ? xml.slice(i) : xml.slice(i, lt);
    if (badEntity.test(text)) return `bad entity in text near ${JSON.stringify(text.slice(0, 40))}`;
    if (lt === -1) break;
    if (xml.startsWith('<?', lt)) { i = xml.indexOf('?>', lt) + 2; continue; }
    if (xml.startsWith('<!--', lt)) { i = xml.indexOf('-->', lt) + 3; continue; }
    let j = lt + 1;
    let quote = '';
    for (; j < xml.length; j++) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = ''; else if (c === '<') return 'a < inside an attribute'; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === '>') break;
    }
    if (j >= xml.length) return 'unterminated tag';
    const tag = xml.slice(lt + 1, j);
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      const open = stack.pop();
      if (open !== name) return `</${name}> closes <${open}>`;
    } else {
      const m = /^([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)$/.exec(tag);
      if (!m) return `bad tag <${tag.slice(0, 60)}>`;
      const names = [...m[2].matchAll(/([\w.:-]+)\s*=/g)].map((a) => a[1]);
      if (new Set(names).size !== names.length) return `repeated attribute in <${m[1]}>`;
      if (badEntity.test(m[2])) return `bad entity in an attribute of <${m[1]}>`;
      if (!m[3]) stack.push(m[1]);
    }
    i = j + 1;
  }
  return stack.length ? `unclosed <${stack.join('>, <')}>` : '';
}

/** The text of every `w:t` in a part, run by run, unescaped. */
const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const texts = (xml) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => unescape(m[1]));
const textOf = (xml) => texts(xml).join('');
/** The paragraphs of a part, each as its XML and its text. */
const paragraphs = (xml) => [...xml.matchAll(/<w:p>([\s\S]*?)<\/w:p>/g)].map((m) => ({ xml: m[1], text: textOf(m[1]) }));
/** The runs of a part, each as its properties and its text. */
const runs = (xml) => [...xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => ({ rPr: (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(m[1]) ?? ['', ''])[1], text: textOf(m[1]) }));
/** Each footnote with an id, as its XML. */
const footnotes = (xml) => [...xml.matchAll(/<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g)].map((m) => ({ attrs: m[1], xml: m[2], text: textOf(m[2]) }));
/** The names of the children of the last `<parent>` element, in order. */
function childrenOf(xml, parent) {
  const at = xml.lastIndexOf(`<${parent}>`) >= 0 ? xml.lastIndexOf(`<${parent}>`) : xml.lastIndexOf(`<${parent} `);
  const inner = xml.slice(xml.indexOf('>', at) + 1, xml.indexOf(`</${parent}>`, at));
  const out = [];
  let depth = 0;
  for (const m of inner.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
    if (m[1]) { depth--; continue; }
    if (depth === 0) out.push(m[2]);
    if (!m[3]) depth++;
  }
  return out;
}

async function build(doc, o) {
  const b64 = await docxBase64(doc, o);
  const buf = Buffer.from(b64, 'base64');
  const files = unzip(buf);
  const part = (name) => (files.has(name) ? files.get(name).toString('utf8') : '');
  return { buf, files, part };
}

// ── the documents ─────────────────────────────────────────────────────────

/** A 1 × 1 PNG: a logo square rather than the 4.2 × 4.8 box. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const INJECT = '</w:t><w:fldSimple w:instr="INCLUDETEXT x"/>';
const BEL = String.fromCharCode(7);

const META = { title: '', titleEn: '', author: '', presented: '', supervisor: '', supervisorTitle: '', authority: '', university: '', college: '', department: '', field: '', venue: '', city: '', year: '' };
const base = (o) => ({
  id: 'd', v: 1, created: Date.UTC(2026, 8, 23, 9), updated: Date.UTC(2026, 8, 23, 9), request: '', notes: '', queries: [],
  stage: 'done', pause: false, abstract: '', abstractEn: '', keywords: [], keywordsEn: [], sources: [], sections: [], length: 'standard', ...o,
});
const sec = (id, level, heading, text, state = 'done') => ({ id, level, heading, brief: 'A BRIEF THAT IS NEVER PRINTED', words: 400, sources: [], text, state });
const src = (key, o) => ({ key, title: '', authors: [], type: 'article', origin: 'openalex', verified: true, use: true, ...o });

const paper = base({
  id: 'ar', request: 'ورقة عمل عن حوكمة المياه', kind: 'working-paper', lang: 'ar', style: 'footnotes', digits: 'eastern',
  logo: `data:image/png;base64,${PNG}`,
  meta: {
    ...META, title: 'حوكمة المياه في المدن الصغيرة & العدالة', author: 'نادية سالم الوادي', presented: 'ورقة عمل مقدمة من قبل الباحثة',
    supervisor: 'أ.د. خالد يوسف الجبوري', supervisorTitle: 'أستاذ القانون الإداري', authority: 'وزارة الموارد والتعليم',
    university: 'جامعة الرافدين الوسطى', college: 'كلية الحقوق', department: 'قسم القانون العام', year: '2026',
  },
  sources: [
    src('s1', { type: 'dictionary', title: 'معجم الألفاظ القانونية', authors: [{ family: 'مجمع اللغة الافتراضي' }], year: 1420, edition: '2', publisher: 'دار المعرفة', city: 'بغداد' }),
    src('s2', { type: 'law', title: 'قانون تنظيم الري', number: '7', year: 2015, venue: 'الوقائع العراقية', issue: '4400', issued: '1 شباط 2015' }),
    src('s3', { type: 'law', title: 'دستور جمهورية الوادي', year: 2004 }),
    src('s4', { title: 'إدارة مياه الشرب في البلديات', authors: [{ family: 'ليلى حسن الربيعي' }], year: 2022, venue: 'مجلة الدراسات القانونية، كلية الحقوق، جامعة الرافدين الوسطى', volume: '12', issue: '3' }),
    src('s5', { title: 'Water governance in small cities', authors: [{ family: 'Family', given: 'Anna Beth' }, { family: 'Other', given: 'Carl' }], year: 2020, venue: 'Journal of Water Law', volume: '8', issue: '2', doi: '10.1000/wgov.2020' }),
    src('s6', { title: 'مصدر لم يستشهد به', authors: [{ family: 'سامر خليل' }], year: 2019 }),
    src('s7', { title: 'دراسة مسحوبة', authors: [{ family: 'باحث مجهول' }], year: 2018, retracted: true }),
  ],
  sections: [
    sec('1', 1, 'المقدمة', [
      '### أولاً: موضوع البحث',
      'يتناول البحث حوكمة المياه[@s3, 45/أولاً] ويعرّف الحوكمة لغةً[@s1, مادة (حكم)، ج2، ص110]. [[أضف إحصاءات الوزارة]]',
      '### ثانياً: مشكلة البحث',
      `ظهرت المشكلة عام 2024 مع نموذج GPT-4 وبرنامج SPSS 29 كما يرى الباحثان[@s5, p. 14].${BEL}`,
    ].join('\n\n')),
    sec('2', 1, 'الفصل الأول: الإطار القانوني', [
      `نص فيه ${INJECT} حرفياً[@s2, المادة 3]. ثم[@s2, 9] ثم[@s4, ص 55] ثم[@s4, ص 60] وإشارة إلى مجهول [@s99] ومسحوب [@s7].`,
      '| الجهة | عدد المشاريع |\n|---|---|\n| البلدية | 12 |\n| المحافظة | 5 |',
    ].join('\n\n')),
    sec('3', 2, 'المبحث الأول: الجهات الرقابية', 'نص المبحث.'),
    sec('4', 3, 'المطلب الأول: الرقابة الإدارية', 'نص المطلب.'),
    sec('5', 4, 'الفرع الأول: الرقابة العامة', 'نص الفرع.'),
    sec('6', 2, 'المبحث الثاني: ما لم يكتب بعد', '', 'waiting'),
    sec('7', 1, 'الخاتمة', '### أولاً: الاستنتاجات\n\n1. نتيجة أولى.\n2. نتيجة ثانية.'),
  ],
});

const article = base({
  id: 'en', request: 'a research article on campus gardens', kind: 'article', lang: 'en', style: 'apa', digits: 'western',
  meta: { ...META, title: 'Campus Gardens and Student Wellbeing', author: 'Lana Example', venue: 'the Journal of Invented Studies', year: '2026' },
  abstract: 'This study examines shared gardens on campuses.', keywords: ['gardens', 'wellbeing'],
  sources: [
    src('s1', { title: 'Learning with machines', authors: [{ family: 'Family', given: 'Anna Beth' }, { family: 'Other', given: 'Carl' }], year: 2020, venue: 'Journal of Things', volume: '12', issue: '3', pages: '45-67', doi: '10.1000/xyz' }),
    src('s2', { title: 'أثر الحدائق في التحصيل', authors: [{ family: 'الساعدي', given: 'ريم' }], year: 2020, venue: 'مجلة الدراسات التربوية' }),
  ],
  sections: [
    sec('1', 1, 'Introduction', 'Gardens are spreading [@s1]. One Arabic study agrees [@s2].'),
    sec('2', 2, 'Method', '### Design\n\nA survey of 212 students.'),
  ],
});

const thesis = base({
  id: 'ckb', request: 'نامەی ماستەر', kind: 'masters', lang: 'ckb', style: 'footnotes', digits: 'eastern',
  meta: { ...META, title: 'کاریگەریی فێرکردنی دیجیتاڵی', titleEn: 'The Effect of Digital Learning', author: 'هێمن نموونە', college: 'کۆلێژی پەروەردە', university: 'زانکۆی نموونە', field: 'دەروونناسی', year: '2026' },
  abstract: 'ئەم توێژینەوەیە کاریگەریی فێرکردنی دیجیتاڵی دەخوێنێتەوە.', abstractEn: 'This study examines digital learning.', keywordsEn: ['digital learning'],
  sources: [src('s1', { type: 'book', title: 'فێرکردن لە سەردەمی دیجیتاڵدا', authors: [{ family: 'کاروان نموونە' }], year: 2022, publisher: 'چاپخانەی نموونە', city: 'هەولێر', lang: 'ckb' })],
  sections: [
    sec('1', 1, 'بەشی یەکەم: چوارچێوەی گشتی', 'دەقێکی کورت[@s1, ل 12].'),
    sec('2', 2, 'باسی یەکەم: کێشەکە', 'دەقی باس[@s1, ل 30].'),
    sec('3', 1, 'بەشی دووەم: ئەنجامەکان', 'دەقی کۆتایی.'),
  ],
});

const bare = base({ id: 'bare', request: '', kind: 'working-paper', lang: 'ar', style: 'footnotes', digits: 'eastern', meta: { ...META }, sections: [sec('1', 1, 'المقدمة', 'نص بلا مصادر.')] });

// ── the Arabic working paper ──────────────────────────────────────────────

const A = await build(paper);
const doc = A.part('word/document.xml');
const notes = A.part('word/footnotes.xml');
const settings = A.part('word/settings.xml');
const styles = A.part('word/styles.xml');
const footer = A.part('word/footer1.xml');
const docText = textOf(doc);

ok('the file is a ZIP', A.buf[0] === 0x50 && A.buf[1] === 0x4b && A.buf[2] === 3 && A.buf[3] === 4);
for (const name of ['[Content_Types].xml', 'word/document.xml', 'word/styles.xml', 'word/settings.xml', 'word/footnotes.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels']) {
  ok(`part ${name} exists`, A.files.has(name));
}
for (const [name, data] of A.files) {
  if (/\.(xml|rels)$/.test(name)) eq(`part ${name} is well-formed`, malformed(data.toString('utf8')), '');
}
ok('the logo is in the package as a PNG', [...A.files.keys()].some((n) => /^word\/media\/.+\.png$/.test(n)));

// ── the section: numbering, direction, and the schema's order ──
const sect = childrenOf(doc, 'w:sectPr');
ok('the section is right to left', sect.includes('w:bidi'), sect);
ok('the cover has its own first page, without a number', sect.includes('w:titlePg'), sect);
ok('section: footnotePr after the footer, before the page size', sect.indexOf('w:footerReference') < sect.indexOf('w:footnotePr') && sect.indexOf('w:footnotePr') < sect.indexOf('w:pgSz'), sect);
ok('section: bidi after titlePg, before docGrid', sect.indexOf('w:titlePg') < sect.indexOf('w:bidi') && sect.indexOf('w:bidi') < sect.indexOf('w:docGrid'), sect);
eq('section: the children in schema order', sect.join(' '), 'w:footerReference w:footnotePr w:pgSz w:pgMar w:pgNumType w:titlePg w:bidi w:docGrid');
const sectXml = doc.slice(doc.lastIndexOf('<w:sectPr'));
ok('footnotes restart on every page', /<w:footnotePr><w:numFmt w:val="hindiNumbers"\/><w:numRestart w:val="eachPage"\/><\/w:footnotePr>/.test(sectXml));
ok('pages are numbered from one, in Eastern digits', /<w:pgNumType w:start="1" w:fmt="hindiNumbers"\/>/.test(sectXml));
ok('A4 with 2.5 cm margins', /<w:pgSz w:w="11906" w:h="16838"/.test(sectXml) && /<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417"/.test(sectXml));

const set = childrenOf(settings, 'w:settings');
ok('settings: footnotePr before compat', set.includes('w:footnotePr') && set.indexOf('w:footnotePr') < set.indexOf('w:compat'), set);
ok('settings: footnotes restart on every page there too', /<w:footnotePr><w:numFmt w:val="hindiNumbers"\/><w:numRestart w:val="eachPage"\/><w:footnote w:id="-1"\/><w:footnote w:id="0"\/><\/w:footnotePr>/.test(settings));
eq('settings: complex-script layout, before the compatibility mode', childrenOf(settings, 'w:compat').join(' '), 'w:useFELayout w:compatSetting');
ok('settings: Word 2010 layout, as the example', /w:name="compatibilityMode"[^>]*w:val="14"|w:val="14"[^>]*w:name="compatibilityMode"/.test(settings));
ok('settings: no field update prompt without a table of contents', !/<w:updateFields\/>/.test(settings));

// ── text as text ──
ok('an XML field typed in the text is printed, not obeyed', docText.includes(INJECT) && doc.includes('&lt;w:fldSimple') && !/<w:fldSimple/.test(doc));
const instr = [...A.files.values()].flatMap((b) => [...b.toString('utf8').matchAll(/<w:instrText[^>]*>([^<]*)<\/w:instrText>/g)].map((m) => m[1].trim()));
eq('the only field is the page number', instr.join(','), 'PAGE');
ok('no marker survives into any part', [...A.files.values()].every((b) => !b.toString('utf8').includes('[@s')));
ok('an ampersand in the title is escaped', doc.includes('حوكمة المياه في المدن الصغيرة &amp; العدالة'));
ok('a control character in the text is dropped', !doc.includes(BEL) && docText.includes('كما يرى الباحثان'));
ok('the brief of an unwritten part is never printed', !docText.includes('A BRIEF THAT IS NEVER PRINTED'));
ok('an unwritten part keeps its heading', docText.includes('المبحث الثاني: ما لم يكتب بعد'));

// ── the cover ──
const paras = paragraphs(doc);
const paraOf = (text) => paras.find((p) => p.text === text);
ok('cover: the ministry, university, college and department lines', ['وزارة الموارد والتعليم', 'جامعة الرافدين الوسطى', 'كلية الحقوق', 'قسم القانون العام'].every((t) => paraOf(t)));
ok('cover: the institution and the logo side by side, from the reading side', /<w:tbl>[\s\S]*?<w:bidiVisual\/>[\s\S]*?وزارة الموارد والتعليم[\s\S]*?<w:drawing>/.test(doc));
ok('cover: the logo keeps its shape inside 4.2 × 4.8 cm', /<wp:extent cx="1512000" cy="1512000"\/>/.test(doc));
ok('cover: the title, 22pt bold, centred', /<w:jc w:val="center"\/>[\s\S]{0,400}<w:b\/>[\s\S]{0,120}<w:sz w:val="44"\/>/.test(paraOf('حوكمة المياه في المدن الصغيرة & العدالة')?.xml ?? ''));
ok('cover: the byline the researcher typed', !!paraOf('ورقة عمل مقدمة من قبل الباحثة'));
ok('cover: the author, 18pt bold', /<w:sz w:val="36"\/>/.test(paraOf('نادية سالم الوادي')?.xml ?? ''));
ok('cover: "بإشراف", the supervisor and their title', !!paraOf('بإشراف') && !!paraOf('أ.د. خالد يوسف الجبوري') && !!paraOf('أستاذ القانون الإداري'));
ok('cover: a double rule above the years', /<w:pBdr><w:bottom w:val="double" w:color="000000" w:sz="6" w:space="1"\/><\/w:pBdr>/.test(doc));
ok('cover: the Gregorian year in Eastern digits', !!paraOf('٢٠٢٦م'));
ok('cover: the Hijri year in Eastern digits', paras.some((p) => /^[٠-٩]{4}هـ$/.test(p.text)));

// ── headings, body, lists ──
const heading = (text) => paras.find((p) => p.text === text && /<w:pStyle w:val="Heading\d"\/>/.test(p.xml));
ok('every section level is a Word heading, 1 to 4', [['المقدمة', 1], ['المبحث الأول: الجهات الرقابية', 2], ['المطلب الأول: الرقابة الإدارية', 3], ['الفرع الأول: الرقابة العامة', 4]]
  .every(([t, n]) => heading(t)?.xml.includes(`<w:pStyle w:val="Heading${n}"/>`)));
ok('headings are centred and bold at every level, 16pt', ['المقدمة', 'الفصل الأول: الإطار القانوني', 'المبحث الأول: الجهات الرقابية', 'الفرع الأول: الرقابة العامة']
  .every((t) => /<w:jc w:val="center"\/>/.test(heading(t)?.xml ?? '') && /<w:b\/>[\s\S]*<w:sz w:val="32"\/>/.test(heading(t)?.xml ?? '')));
ok('the introduction, the conclusion and the sources start new pages', ['المقدمة', 'الخاتمة', 'قائمة المصادر'].every((t) => heading(t)?.xml.includes('<w:pageBreakBefore/>')));
ok('a chapter of a working paper does not', !heading('الفصل الأول: الإطار القانوني')?.xml.includes('<w:pageBreakBefore/>'));
const sub = paraOf('أولاً: موضوع البحث');
ok('a ### subheading: bold 14pt at the start side, not a Word heading', !!sub && /<w:jc w:val="start"\/>/.test(sub.xml) && /<w:sz w:val="28"\/>/.test(sub.xml) && !/Heading/.test(sub.xml));
const body = paras.find((p) => p.text.startsWith('يتناول البحث'));
ok('body text: justified 14pt with a first-line indent, right to left', !!body && /<w:bidi\/>/.test(body.xml) && /<w:ind w:firstLine="709"\/>/.test(body.xml) && /<w:jc w:val="both"\/>/.test(body.xml) && /<w:sz w:val="28"\/>/.test(body.xml));
const item = paras.find((p) => p.text === '١. نتيجة أولى.');
ok('a numbered item: the number typed "١. ", bold, hanging', !!item && /<w:ind w:start="510" w:hanging="369"\/>/.test(item.xml) && runs(item.xml)[0].text === '١. ' && runs(item.xml)[0].rPr.includes('<w:b/>'));
ok('the second item is "٢. "', paras.some((p) => p.text === '٢. نتيجة ثانية.'));
const hole = runs(doc).find((r) => r.text === '[أضف إحصاءات الوزارة]');
ok('a gap is printed in brackets and highlighted', !!hole && hole.rPr.includes('<w:highlight w:val="yellow"/>'));
ok('no highlightCs, which is not in the schema', !doc.includes('highlightCs'));
ok('a table: right to left, a shaded header row that repeats', /<w:tbl>(?:(?!<\/w:tbl>)[\s\S])*<w:bidiVisual\/>(?:(?!<\/w:tbl>)[\s\S])*<w:tblHeader\/>(?:(?!<\/w:tbl>)[\s\S])*w:fill="D9D9D9"(?:(?!<\/w:tbl>)[\s\S])*البلدية/.test(doc));
ok('a number in a table cell in Eastern digits', runs(doc).some((r) => r.text === '١٢'));

// ── digits and direction per word ──
const allRuns = runs(doc);
const runWith = (s) => allRuns.find((r) => r.text.includes(s));
ok('Arabic text: a right-to-left run tagged ar-IQ', /<w:rtl\/>/.test(runWith('يتناول البحث')?.rPr ?? '') && /w:bidi="ar-IQ"/.test(runWith('يتناول البحث')?.rPr ?? ''));
ok('a year in Arabic text in Eastern digits', runWith('٢٠٢٤') && !docText.includes('2024'));
ok('"GPT-4" is a left-to-right run, as written', !!runWith('GPT-4') && !/<w:rtl\/>/.test(runWith('GPT-4').rPr) && /<w:rtl w:val="false"\/>/.test(runWith('GPT-4').rPr));
ok('"SPSS 29" keeps its digits', docText.includes('SPSS 29'));
ok('Simplified Arabic for every script, as the example', /<w:rFonts w:ascii="Simplified Arabic" w:cs="Simplified Arabic" w:eastAsia="Simplified Arabic" w:hAnsi="Simplified Arabic"\/>/.test(doc));

// ── footnotes ──
const refs = [...doc.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)].map((m) => Number(m[1]));
const numbered = footnotes(notes).filter((n) => /w:id="\d+"/.test(n.attrs) && !/w:type=/.test(n.attrs));
eq('one footnote per citation that names a usable source', refs.length, 7);
eq('every footnote reference has its note', numbered.length, refs.length);
ok('references numbered 1, 2, 3… in order', refs.every((id, i) => id === i + 1));
ok('the reference mark is superscript by its style', /<w:style w:type="character" w:styleId="FootnoteReference">[\s\S]*?<w:vertAlign w:val="superscript"\/>/.test(styles));
ok('every note opens " ) " after its number', numbered.every((n) => texts(n.xml)[0] === ' ) '), numbered.map((n) => texts(n.xml)[0]));
ok('every note is set in the footnote style, 12pt', numbered.every((n) => n.xml.includes('<w:pStyle w:val="FootnoteText"/>') && n.xml.includes('<w:sz w:val="24"/>')));
const note = (i) => numbered[i - 1].text.slice(3);
eq('a constitution, at its article', note(1), 'المادة ٤٥/أولاً من دستور جمهورية الوادي لسنة ٢٠٠٤.');
eq('a dictionary, first: the edition and the Hijri year', note(2), 'مجمع اللغة الافتراضي، معجم الألفاظ القانونية، دار المعرفة، بغداد، ط٢، ١٤٢٠هـ، مادة (حكم)، ج٢، ص١١٠.');
ok('a Latin source: Chicago in English, Western digits, the DOI as text', note(3).includes('Anna Beth Family and Carl Other, "Water governance in small cities," Journal of Water Law 8, no. 2 (2020): 14, https://doi.org/10.1000/wgov.2020.'), note(3));
ok('a Latin note is laid out left to right', /<w:bidi w:val="false"\/>/.test(numbered[2].xml) && !/<w:bidi\/>/.test(numbered[2].xml));
ok('an Arabic note is right to left', /<w:bidi\/>/.test(numbered[0].xml));
ok('the journal of a Latin note is in italics', runs(numbered[2].xml).some((r) => r.text === 'Journal of Water Law' && r.rPr.includes('<w:i/>')));
eq('a law, first: its number and year', note(4), 'المادة ٣ من قانون تنظيم الري رقم ٧ لسنة ٢٠١٥.');
eq('a law, later: its name alone, a bare number an article', note(5), 'المادة ٩ من قانون تنظيم الري.');
eq('an article, first: never its page range, the page the marker gave', note(6), 'ليلى حسن الربيعي، إدارة مياه الشرب في البلديات، بحث منشور في مجلة الدراسات القانونية، كلية الحقوق، جامعة الرافدين الوسطى، المجلد ١٢، العدد ٣، ٢٠٢٢، ص٥٥.');
eq('an article, later: "مصدر سابق"', note(7), 'ليلى حسن الربيعي، مصدر سابق، ص٦٠.');
ok('an unknown or retracted source makes no note', !notes.includes('دراسة مسحوبة') && !notes.includes('s99'));
ok('the separator notes have no number', footnotes(notes).filter((n) => /w:type=/.test(n.attrs)).every((n) => !n.xml.includes('footnoteRef')));
// The example's separators are right to left and aligned "right", which Word
// draws at the left of the page; LibreOffice ignores both, so only the XML shows it.
const rules = footnotes(notes).filter((n) => /w:type=/.test(n.attrs));
eq('two footnote rules, the separator and its continuation', rules.length, 2);
ok('the footnote rule at the left of the page, as the example: bidi, then jc="right", in schema order',
  rules.every((n) => childrenOf(n.xml, 'w:pPr').join(' ') === 'w:bidi w:spacing w:jc' && n.xml.includes('<w:jc w:val="right"/>')),
  rules.map((n) => childrenOf(n.xml, 'w:pPr').join(' ')));

// ── the source list ──
const listHeads = ['أولاً: المعاجم', 'ثانياً: البحوث والدراسات', 'ثالثاً: الدستور والتشريعات والقرارات', 'رابعاً: المصادر الأجنبية'];
ok('the list grouped by kind under ordinal headings, in order', listHeads.every((h) => paraOf(h)) && listHeads.map((h) => paras.indexOf(paraOf(h))).every((v, i, a) => i === 0 || v > a[i - 1]));
ok('a dictionary entry: the edition first', !!paraOf('١. مجمع اللغة الافتراضي، معجم الألفاظ القانونية، ط٢، دار المعرفة، بغداد، ١٤٢٠هـ.'));
ok('laws: the constitution first, then numbered on', !!paraOf('١. دستور جمهورية الوادي لسنة ٢٠٠٤.') && !!paraOf('٢. قانون تنظيم الري رقم ٧ لسنة ٢٠١٥، الوقائع العراقية، العدد ٤٤٠٠، ١ شباط ٢٠١٥.'));
const foreign = paras.find((p) => p.text.startsWith('1. Family, Anna Beth'));
ok('a Latin entry: left to right, numbered in Western digits, hanging', !!foreign && /<w:bidi w:val="false"\/>/.test(foreign.xml) && /<w:ind w:start="510" w:hanging="369"\/>/.test(foreign.xml));
ok('entries are 12pt', /<w:sz w:val="24"\/>/.test(foreign?.xml ?? ''));
ok('a source never cited is not listed', !docText.includes('مصدر لم يستشهد به'));
ok('the page number is the PAGE field, centred, 14pt', /<w:jc w:val="center"\/>/.test(footer) && /<w:sz w:val="28"\/>/.test(footer) && /PAGE/.test(footer));

// ── a font asked for ──
const F = await build(paper, { font: 'Traditional Arabic' });
ok('a font asked for is used for every script', /<w:rFonts w:ascii="Traditional Arabic" w:cs="Traditional Arabic"/.test(F.part('word/document.xml')) && !F.part('word/document.xml').includes('Simplified Arabic'));

// ── the English APA article ───────────────────────────────────────────────

const E = await build(article);
const edoc = E.part('word/document.xml');
const etext = textOf(edoc);
for (const [name, data] of E.files) {
  if (/\.(xml|rels)$/.test(name)) eq(`English part ${name} is well-formed`, malformed(data.toString('utf8')), '');
}
const esect = childrenOf(edoc, 'w:sectPr');
ok('English: the section is left to right, numbered from the first page', !esect.includes('w:bidi') && !esect.includes('w:titlePg'), esect);
ok('English: no footnotes, no footnote numbering', !/<w:footnoteReference/.test(edoc) && !esect.includes('w:footnotePr') && !E.part('word/settings.xml').includes('<w:footnotePr>'));
ok('English: pages in Western digits', /<w:pgNumType w:start="1" w:fmt="decimal"\/>/.test(edoc));
ok('English: citations in the text, APA', etext.includes('Gardens are spreading (Family & Other, 2020).'));
ok('English: an Arabic source cited in Arabic, its year as written', etext.includes('(الساعدي، 2020)'));
ok('English: the title block, not a cover page', etext.startsWith('Campus Gardens and Student Wellbeing') && !/<w:drawing>/.test(edoc) && !edoc.includes('w:val="double"'));
ok('English: the reference list with its DOI', etext.includes('References') && etext.includes('https://doi.org/10.1000/xyz'));
ok('English: Times New Roman', edoc.includes('w:ascii="Times New Roman"'));
ok('English: a level-2 heading at the start side', /<w:jc w:val="start"\/>/.test(paragraphs(edoc).find((p) => p.text === 'Method')?.xml ?? ''));
ok('English: no run with a Latin letter is right to left', runs(edoc).filter((r) => r.rPr.includes('<w:rtl/>')).every((r) => !/[A-Za-z]/.test(r.text)));
const around = runs(paragraphs(edoc).find((p) => p.text.startsWith('Gardens are spreading'))?.xml ?? '');
ok('English: an Arabic citation is right to left, its brackets and full stop the sentence\'s', around.some((r) => r.text === 'الساعدي، 2020' && r.rPr.includes('<w:rtl/>'))
  && ['(', ')', '.'].every((t) => around.some((r) => r.text === t && !r.rPr.includes('<w:rtl/>'))), around.map((r) => r.text));

// ── the Sorani master's thesis ────────────────────────────────────────────

const K = await build(thesis);
const kdoc = K.part('word/document.xml');
const ktext = textOf(kdoc);
for (const [name, data] of K.files) {
  if (/\.(xml|rels)$/.test(name)) eq(`Sorani part ${name} is well-formed`, malformed(data.toString('utf8')), '');
}
ok('Sorani: tagged ckb-IQ, in Arial', kdoc.includes('w:bidi="ckb-IQ"') && kdoc.includes('w:ascii="Arial"'));
ok('Sorani: the dedication and thanks, as highlighted gaps', runs(kdoc).some((r) => r.text === '[پێشکەشکردن لێرە بنووسە]' && r.rPr.includes('<w:highlight w:val="yellow"/>')) && ktext.includes('سوپاس و پێزانین'));
ok('Sorani: a table of contents field, headings 1 to 4', /<w:instrText[^>]*>TOC [^<]*\\o &quot;1-4&quot;[^<]*<\/w:instrText>/.test(kdoc));
ok('Sorani: the contents lists the headings until Word numbers the pages', /<w:pStyle w:val="TOC1"\/>[\s\S]*?بەشی یەکەم: چوارچێوەی گشتی/.test(kdoc) && /<w:pStyle w:val="TOC2"\/>/.test(kdoc));
ok('Sorani: Word is asked to fill in the contents', /<w:updateFields\/>/.test(K.part('word/settings.xml')));
ok('Sorani: contents styles are right to left', /<w:style w:type="paragraph" w:styleId="TOC1">[\s\S]*?<w:bidi\/>/.test(K.part('word/styles.xml')));
const kHeads = paragraphs(kdoc).filter((p) => /<w:pStyle w:val="Heading1"\/>/.test(p.xml));
ok('Sorani: every chapter starts a page', kHeads.filter((p) => p.text.startsWith('بەشی')).every((p) => p.xml.includes('<w:pageBreakBefore/>')) && kHeads.length >= 2);
const kAbstract = paragraphs(kdoc).find((p) => p.text === 'This study examines digital learning.');
ok('Sorani: the English abstract at the end, left to right', !!kAbstract && /<w:bidi w:val="false"\/>/.test(kAbstract.xml) && ktext.lastIndexOf('Abstract') > ktext.indexOf('لیستی سەرچاوەکان'));
ok('Sorani: a Kurdish note in Kurdish words and Eastern digits', textOf(K.part('word/footnotes.xml')).includes('کاروان نموونە، سەرچاوەی پێشوو، ل٣٠.'));
ok('Sorani: the Kurdish year on the cover', paragraphs(kdoc).some((p) => /^[٠-٩]{4}ک$/.test(p.text)));

// ── nothing but a document ────────────────────────────────────────────────

const B = await build(bare);
const btext = textOf(B.part('word/document.xml'));
ok('bare: builds, well-formed', malformed(B.part('word/document.xml')) === '');
ok('bare: no byline, supervisor or statement words with nobody to name', !btext.includes('بإشراف') && !btext.includes('من قبل') && !btext.includes('ورقة عمل مقدمة'));
ok('bare: no source list, no footnotes', !btext.includes('قائمة المصادر') && !/<w:footnoteReference/.test(B.part('word/document.xml')));
ok('bare: no empty runs', !/<w:t(?:\s[^>]*)?><\/w:t>/.test(B.part('word/document.xml')));
ok('bare: no picture for no logo', ![...B.files.keys()].some((n) => n.startsWith('word/media/')));
const badini = await build({ ...bare, lang: 'kmr', sections: [sec('1', 1, 'پێشەکی', 'دەقەکێ کورت ل سالا 2025.')] });
ok('Badini: tagged ku-Arab-IQ, its year in Eastern digits', badini.part('word/document.xml').includes('w:bidi="ku-Arab-IQ"') && textOf(badini.part('word/document.xml')).includes('ل سالا ٢٠٢٥.'));
const western = await build({ ...paper, digits: 'western' });
ok('western digits asked for: none converted, pages and notes numbered 1 2 3', textOf(western.part('word/document.xml')).includes('2024')
  && /<w:pgNumType w:start="1" w:fmt="decimal"\/>/.test(western.part('word/document.xml')) && !western.part('word/settings.xml').includes('hindiNumbers'));
const broken = await build({ ...bare, logo: 'data:image/png;base64,bm90IGEgcGljdHVyZQ==' });
ok('a logo that is not a picture is left off', ![...broken.files.keys()].some((n) => n.startsWith('word/media/')));
const enNotes = footnotes(E.part('word/footnotes.xml')).filter((n) => /w:type=/.test(n.attrs));
ok('English: the footnote rule left as Word makes it', enNotes.every((n) => !n.xml.includes('<w:bidi/>') && !n.xml.includes('<w:jc ')));

// ── brackets go in pairs ──────────────────────────────────────────────────
// Word reads a bracket in a right-to-left run as right-to-left, whatever is
// around it, so a ")" on the other side of the run break from its "(" is
// turned round and drawn across the Latin words. LibreOffice pairs brackets
// itself and hides this; the runs are what Word draws from.

const rtlRun = (r) => r.rPr.includes('<w:rtl/>');
/** The brackets of a paragraph whose "(" and ")" are on different sides of a run break. */
function splitPairs(xml) {
  const open = [];
  const split = [];
  for (const r of runs(xml)) {
    for (const ch of r.text) {
      if (ch === '(' || ch === '[') open.push({ ch, rtl: rtlRun(r) });
      else if (ch === ')' || ch === ']') {
        const o = open.pop();
        if (o && o.rtl !== rtlRun(r)) split.push(`${o.ch}${ch} in ${JSON.stringify(textOf(xml))}`);
      }
    }
  }
  return split;
}
const bracketed = base({
  id: 'br', request: 'بحث', kind: 'article', lang: 'ar', style: 'footnotes', digits: 'eastern',
  meta: { ...META, title: 'تجربة الأقواس' },
  sources: [
    src('s1', { title: 'إدارة مياه الشرب في البلديات', authors: [{ family: 'ليلى حسن الربيعي' }], year: 2022, venue: 'مجلة الدراسات القانونية' }),
    src('s2', { title: 'Water governance in small cities', authors: [{ family: 'Family', given: 'Anna Beth' }], year: 2020, venue: 'Journal of Water Law', volume: '8', issue: '2' }),
  ],
  sections: [sec('1', 1, 'المقدمة', [
    'استخدم الباحث نموذج GPT-4 (OpenAI) في التحليل.',
    'حللت البيانات ببرنامج SPSS (version 29).',
    'كما في (Smith, 2020) وغيره.',
    'جربنا الإصدار Llama (v3 [beta]) أيضاً.',
    'ويجمع المصدران[@s1; @s2] بين الرأيين.',
  ].join('\n\n'))],
});
const Br = await build(bracketed);
const brDoc = Br.part('word/document.xml');
const brParas = paragraphs(brDoc);
const shape = (text) => runs(brParas.find((p) => p.text === text)?.xml ?? '').map((r) => `${rtlRun(r) ? 'R' : 'L'}:${r.text}`);
eq('a Latin parenthetical after a Latin word: both brackets in the Latin run',
  shape('استخدم الباحث نموذج GPT-4 (OpenAI) في التحليل.').join(' | '), 'R:استخدم الباحث نموذج  | L:GPT-4 (OpenAI) | R: في التحليل.');
eq('…and at the end of the paragraph, the full stop the Arabic sentence\'s',
  shape('حللت البيانات ببرنامج SPSS (version 29).').join(' | '), 'R:حللت البيانات ببرنامج  | L:SPSS (version 29) | R:.');
eq('a Latin parenthetical after an Arabic word: both brackets on the Arabic side',
  shape('كما في (Smith, 2020) وغيره.').join(' | '), 'R:كما في ( | L:Smith, 2020 | R:) وغيره.');
eq('nested brackets pair from the inside out', shape('جربنا الإصدار Llama (v3 [beta]) أيضاً.').join(' | '), 'R:جربنا الإصدار  | L:Llama (v3 [beta]) | R: أيضاً.');
const brNotes = footnotes(Br.part('word/footnotes.xml')).filter((n) => !/w:type=/.test(n.attrs));
eq('Brackets: the mixed marker makes one note', brNotes.length, 1);
const mixed = runs(brNotes[0]?.xml ?? '').filter((r) => r.text);
const lastLatin = mixed.map((r) => /[A-Za-z]/.test(r.text)).lastIndexOf(true);
ok('a note ending in a Latin citation: the year\'s brackets and the full stop stay in the Latin run',
  mixed.some((r) => r.text.endsWith('(2020).') && !rtlRun(r)) && lastLatin >= 0 && mixed.slice(lastLatin).every((r) => !rtlRun(r)),
  mixed.map((r) => `${rtlRun(r) ? 'R' : 'L'}:${r.text}`));
ok('…with a left-to-right mark after it, in a left-to-right run', mixed.length > 0 && mixed[mixed.length - 1].text === '‎' && !rtlRun(mixed[mixed.length - 1]));
ok('the Arabic half of the note is still right to left', mixed.some((r) => r.text.includes('ليلى حسن الربيعي') && rtlRun(r)));
eq('no bracket pair split across a run break, body or notes', [
  ...paragraphs(brDoc), ...paragraphs(Br.part('word/footnotes.xml')), ...paragraphs(doc), ...paragraphs(notes), ...paragraphs(edoc),
].flatMap((p) => splitPairs(p.xml)).join('; '), '');

// ── a document that ends on a gap ─────────────────────────────────────────
// LibreOffice gives the page number the look of the last run before the
// section ends; a highlighted [[gap]] there highlights every page number.

const lastPara = (xml) => paragraphs(xml.slice(0, xml.lastIndexOf('<w:sectPr'))).pop()?.xml ?? '';
for (const [name, d] of [
  ['an Arabic article', { ...bracketed, sources: [], sections: [sec('1', 1, 'المقدمة', 'نص.\n\n[[املأ هذا]]')] }],
  ['an English article', { ...article, sources: [], sections: [sec('1', 1, 'Introduction', 'Text.\n\n[[fill this]]')] }],
  ['a thesis with nothing after its thanks', { ...thesis, sources: [], sections: [], abstract: '', abstractEn: '' }],
]) {
  const x = (await build(d)).part('word/document.xml');
  const last = lastPara(x);
  ok(`ends on a gap (${name}): the gap is highlighted`, x.includes('<w:highlight w:val="yellow"/>'));
  ok(`ends on a gap (${name}): the body ends on a plain line a point high`, !last.includes('<w:highlight') && !/<w:t[\s>]/.test(last) && last.includes('<w:sz w:val="2"/>'), last);
}
ok('a document that does not end on a gap gets no extra line', !lastPara(doc).includes('<w:sz w:val="2"/>') && lastPara(doc).includes('Family'));

// ── the file's name ───────────────────────────────────────────────────────

const named = (title) => fileNameFor(base({ meta: { ...META, title } }));
eq('name: Arabic letters kept, punctuation gone', named('حوكمة المياه: دراسة/مقارنة?'), 'حوكمة المياه دراسة مقارنة.docx');
eq('name: nothing in the title', named(''), 'research.docx');
eq('name: only what a path would read', named(' \\/:*?"<>| '), 'research.docx');
eq('name: control characters are spaces', named(`a${String.fromCharCode(9)}b${BEL}c`), 'a b c.docx');
eq('name: - and _ kept', named('draft_v2 - final'), 'draft_v2 - final.docx');
eq('name: Eastern digits kept', named('بحث ٢٠٢٦'), 'بحث ٢٠٢٦.docx');
eq('name: Kurdish letters and the joiner-breaker kept', named(`پێشکەشکردنی نامە${String.fromCharCode(0x200c)}ی ماستەر`), `پێشکەشکردنی نامە${String.fromCharCode(0x200c)}ی ماستەر.docx`);
eq('name: a device name Windows keeps', named('CON'), 'CON_.docx');
const long = Array.from({ length: 30 }, (_, i) => `كلمة${i}`).join(' ');
const cut = named(long);
ok('name: at most 80 characters, cut where a word ends', Array.from(cut).length <= 80 && cut.endsWith('.docx') && long.startsWith(cut.slice(0, -5)) && long[cut.length - 5] === ' ', cut);
ok('name: one word longer than that is cut anyway', Array.from(named('ا'.repeat(200))).length === 80);
eq('name: a document with no meta at all', fileNameFor({}), 'research.docx');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
