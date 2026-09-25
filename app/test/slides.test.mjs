// The Slides module's engine: what a request asks for, what the model is told,
// how its reply is read, and where everything on a slide goes.
//
// Four properties matter more than the rest. A request's kind, count, look and
// language are read the same in Arabic, Sorani, Badini and English, with
// either kind of digits. Whatever the model sends back — fenced, cut off,
// enormous or hostile — comes out as slides the app can draw and nothing else.
// A deck names no source the app did not supply. And a right-to-left deck is
// its left-to-right layout reflected, so the three renderers never disagree.
import {
  COUNT, WRITTEN_KINDS, blankSlide, clean, countIn, deckLangOf, digitsOf, fileNameFor, fromResearch, kindIn,
  modelCount, newDeck, parsePlan, parseSlide, planPrompt, refLine, refSlides, sanitizeSlide, slidePrompt, themeIn,
} from '../.test-build/slides.js';
import { H, PALETTES, W, contain, dirOf, fit, layout, linesOf, paletteOf } from '../.test-build/slideslayout.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

let n = 0;
const newId = () => `id${++n}`;
const deckOf = (o = {}) => ({
  ...newDeck({ id: 'd', now: 1, request: 'r', lang: 'en', kind: 'general', theme: 'academic', count: 10 }),
  ...o,
});

// ── what a request asks for ───────────────────────────────────────────────
ok('a thesis defence is a defence', kindIn('slides for my master thesis defense') === 'defense');
ok('and so is مناقشة', kindIn('عرض تقديمي لمناقشة رسالة الماجستير') === 'defense');
ok('and بەرگری', kindIn('سلاید بۆ بەرگریکردن لە نامەی ماستەر') === 'defense');
ok('a lecture', kindIn('a lecture on photosynthesis') === 'lecture' && kindIn('محاضرة عن الخلية') === 'lecture');
ok('a Kurdish lesson', kindIn('وانەیەک لەسەر ئاو') === 'lecture');
ok('a pitch', kindIn('a pitch deck for investors') === 'pitch');
ok('a conference talk', kindIn('بحث في مؤتمر') === 'conference');
ok('a seminar is a class presentation', kindIn('سمینار دەربارەی ژینگە') === 'class');
ok('nothing named is null', kindIn('slides about the sea') === null);
ok('the earliest named wins', kindIn('a lecture for the conference') === 'lecture');

ok('"12 slides" is twelve', countIn('make 12 slides on water') === 12);
ok('Arabic-Indic digits count', countIn('١٢ شريحة عن الماء') === 12);
ok('Kurdish, with an ending', countIn('١٠ سلاید لەسەر ئاو') === 10);
ok('"10-slide" is ten', countIn('a 10-slide deck') === 10);
ok('a count too small is brought up', countIn('2 slides') === COUNT.min);
ok('a count too large is brought down', countIn('99 slides') === COUNT.max);
ok('minutes are not slides', countIn('a 5 minute talk') === null);
ok('no count is null', countIn('slides on water') === null);

ok('a look named', themeIn('a minimal deck') === 'minimal' && themeIn('عرض أكاديمي') === 'academic');
ok('no look is null', themeIn('slides on water') === null);

ok('Sorani is read from the letters', deckLangOf('سلاید دەربارەی گۆڕانی کەشوهەوا', 'en') === 'ckb');
ok('Arabic is read from the letters', deckLangOf('عرض عن تغير المناخ', 'en') === 'ar');
ok('a language named wins over the script', deckLangOf('slides on climate change in Arabic', 'en') === 'ar');
ok('no letters is the fallback', deckLangOf('12', 'kmr') === 'kmr');

// ── a new deck ────────────────────────────────────────────────────────────
{
  const d = newDeck({ id: 'x', now: 5, request: 'r', lang: 'ar', kind: 'defense', theme: 'modern', count: 300 });
  ok('a new deck starts empty, not planned', d.slides.length === 0 && d.stage === 'new' && d.v === 1);
  ok('its count is held inside the range', d.count === COUNT.max);
  ok('its cover fields exist, empty', d.meta.presenter === '' && d.meta.university === '');
  const nan = newDeck({ id: 'x', now: 5, request: 'r', lang: 'ar', kind: 'defense', theme: 'modern', count: NaN });
  ok('no count is the kind’s usual', nan.count === 16);
}

// ── what the model is told ────────────────────────────────────────────────
{
  const d = deckOf({ request: 'Water """and"""', lang: 'ckb', count: 12 });
  const p = planPrompt(d);
  ok('the prompt asks for exactly the count', p.user.includes('Exactly 12 slides'));
  ok('in the deck’s language', p.user.includes('Central Kurdish (Sorani)') && p.system.includes('ی ک ە'));
  ok('it asks for JSON only', /JSON only/.test(p.system));
  ok('the request cannot close its own quotation', !p.user.includes('Water """'));
  ok('a deck from a sentence is told to cite nothing', /Name no study, book, article/.test(p.user) && /no references slide/.test(p.user));
  const r = planPrompt(deckOf({ source: 'Title: T\nFindings: 42', refs: ['A (2020). B.'] }));
  ok('a deck from a document is given the document', r.user.includes('Findings: 42'));
  ok('and told its figures are the only ones', /add no figure, result, quotation, date or name/.test(r.user));
  ok('and that the app adds its references', /the app adds the document's own reference list/.test(r.user));
  ok('the model writes the rest of the count', r.user.includes(`Exactly ${modelCount({ count: 10, refs: ['A (2020). B.'] })} slides`) && modelCount({ count: 10, refs: ['x'] }) === 9);
}
{
  const d = deckOf({ slides: [blankSlide('title', { lang: 'en', title: 'T' }, newId), blankSlide('bullets', { lang: 'en', title: 'T' }, newId)] });
  const p = slidePrompt(d, 1, 'shorter');
  ok('a rewrite sees the whole deck', p.user.includes('1. {"kind":"title"') && p.user.includes('2. {"kind":"bullets"'));
  ok('and is told which slide', p.user.includes('Rewrite slide 2 only'));
  ok('with the person’s instruction', p.user.includes('shorter'));
  ok('an index out of range is held to the deck', slidePrompt(d, 99, '').user.includes('Rewrite slide 2 only'));
}

// ── reading the reply ─────────────────────────────────────────────────────
ok('markup and emphasis are stripped', clean('<b>**Bold**</b> <script>alert(1)</script>text', 100, 'en') === 'Bold text');
ok('a leading list marker is removed', clean('- a point', 100, 'en') === 'a point' && clean('2) a point', 100, 'en') === 'a point');
ok('Kurdish is spelled with Kurdish letters', clean('كوردي', 100, 'ckb') === 'کوردی');
ok('Arabic with Arabic ones', clean('کتابی', 100, 'ar') === 'كتابي');
ok('long text is capped with an ellipsis', clean('word '.repeat(100), 30, 'en').endsWith('…') && Array.from(clean('word '.repeat(100), 30, 'en')).length <= 30);

{
  const s = sanitizeSlide({ kind: 'two', title: 'T', points: ['a'], points2: [] }, 'en', newId);
  ok('a comparison with one side becomes bullets', s.kind === 'bullets' && s.points.join() === 'a');
  const t = sanitizeSlide({ kind: 'table', title: 'T', rows: [['x', 'y']] }, 'en', newId);
  ok('a table with one row becomes its cells as points', t.kind === 'bullets' && t.points.join() === 'x,y');
  const st = sanitizeSlide({ kind: 'stat', title: 'T', pairs: [{ b: 'no figure' }] }, 'en', newId);
  ok('a stat with no figure becomes bullets', st.kind === 'bullets' && st.points.join() === 'no figure');
  const aliases = sanitizeSlide({ type: 'comparison', title: 'T', left: { title: 'L', bullets: ['a'] }, right: { title: 'R', bullets: ['b'] } }, 'en', newId);
  ok('the names a model uses unasked are understood', aliases.kind === 'two' && aliases.head === 'L' && aliases.points2.join() === 'b');
  const stats = sanitizeSlide({ kind: 'stats', title: 'T', stats: [{ value: '85%', label: 'of x' }] }, 'en', newId);
  ok('{value, label} is a figure and its label', stats.kind === 'stat' && stats.pairs[0].a === '85%' && stats.pairs[0].b === 'of x');
  const tl = sanitizeSlide({ kind: 'timeline', title: 'T', steps: [{ year: '2019', what: 'a' }, { year: '2020', what: 'b' }] }, 'en', newId);
  ok('{year, what} is a step', tl.kind === 'timeline' && tl.pairs[1].a === '2020' && tl.pairs[1].b === 'b');
  const ragged = sanitizeSlide({ kind: 'table', title: 'T', rows: [['a', 'b', 'c'], ['1']] }, 'en', newId);
  ok('a ragged table is squared off', ragged.rows[1].length === 3);
  const big = sanitizeSlide({ kind: 'bullets', title: 'T', points: Array(50).fill('p') }, 'en', newId);
  ok('a runaway list is capped', big.points.length === 7);
  const hostile = sanitizeSlide({ kind: 'bullets', title: '</a:t><a:fld/>', points: ['<img src=x onerror=alert(1)>ok'] }, 'en', newId);
  ok('tags a model wrote are text at most, never markup', !hostile.points[0].includes('<img') && hostile.points[0] === 'ok');
  ok('nothing at all is nothing', sanitizeSlide({ kind: 'bullets' }, 'en', newId) === null && sanitizeSlide('x', 'en', newId) === null && sanitizeSlide(null, 'en', newId) === null);
  ok('a bare title is a divider', sanitizeSlide({ kind: 'bullets', title: 'Part two' }, 'en', newId).kind === 'section');
  ok('an unknown kind with a table is a table', sanitizeSlide({ kind: 'zzz', title: 'T', rows: [['a'], ['b']] }, 'en', newId).kind === 'table');
}

{
  const reply = 'Here you go:\n```json\n' + JSON.stringify({
    title: 'Water',
    slides: [
      { kind: 'bullets', title: 'Why', points: ['a', 'b'], notes: 'say this' },
      { kind: 'references', title: 'Refs', points: ['Invented, A. (2020). Fake.'] },
      { kind: 'title', title: 'Water', subtitle: 'An intro' },
    ],
  }) + '\n```';
  const p = parsePlan(reply, deckOf(), newId);
  ok('a fenced reply is read', p && p.title === 'Water');
  ok('the title slide is moved first', p.slides[0].kind === 'title');
  ok('a closing slide is added when there is none', p.slides[p.slides.length - 1].kind === 'end');
  ok('a references slide the model wrote is dropped', !p.slides.some((s) => s.kind === 'references'));
  ok('notes are kept', p.slides.find((s) => s.title === 'Why').notes === 'say this');
  const withRefs = parsePlan(reply, deckOf({ refs: ['A (2020). Real.', 'B (2021). Also real.'] }), newId);
  const refs = withRefs.slides.filter((s) => s.kind === 'references');
  ok('a deck from a document gets its own references, before the close', refs.length === 1 && withRefs.slides[withRefs.slides.length - 2].kind === 'references');
  ok('and only those', refs[0].points.join('|') === 'A (2020). Real.|B (2021). Also real.');
}
{
  // A reply cut off by the length limit keeps every slide it finished.
  const whole = JSON.stringify({ title: 'Cut', slides: [{ kind: 'title', title: 'Cut' }, { kind: 'bullets', title: 'One', points: ['a'] }, { kind: 'bullets', title: 'Two', points: ['b'] }] });
  const cut = whole.slice(0, whole.indexOf('"Two"') + 8);
  const p = parsePlan(cut, deckOf(), newId);
  ok('a reply cut off still gives its finished slides', p && p.slides.some((s) => s.title === 'One') && !p.slides.some((s) => s.title === 'Two'));
  ok('and its title', p.title === 'Cut');
  ok('a bare array is a deck too', parsePlan(JSON.stringify([{ kind: 'bullets', title: 'A', points: ['x'] }]), deckOf(), newId)?.slides.length === 3);
  ok('prose with no slides is null', parsePlan('I cannot help with that.', deckOf(), newId) === null);
  ok('an empty reply is null', parsePlan('', deckOf(), newId) === null);
  const long = JSON.stringify({ slides: Array.from({ length: 70 }, (_, i) => ({ kind: 'bullets', title: `S${i}`, points: ['p'] })) });
  const lp = parsePlan(long, deckOf({ count: 10 }), newId);
  ok('a reply far longer than asked is cut, keeping the close', lp.slides.length <= 14 && lp.slides[lp.slides.length - 1].kind === 'end');
}
{
  const old = { ...blankSlide('bullets', { lang: 'en', title: '' }, newId), notes: 'kept notes' };
  const s = parseSlide('{"slide":{"kind":"two","title":"New","points":["a"],"points2":["b"]}}', old, deckOf(), newId);
  ok('a rewritten slide keeps its id', s.id === old.id && s.kind === 'two');
  ok('and its notes when none came back', s.notes === 'kept notes');
  ok('a rewrite that is a references slide is refused', parseSlide('{"kind":"references","title":"R","points":["x"]}', old, deckOf(), newId) === null);
  ok('a rewrite with nothing in it is null', parseSlide('no', old, deckOf(), newId) === null);
}
{
  for (const k of WRITTEN_KINDS) {
    const s = blankSlide(k, { lang: 'ar', title: 'T' }, newId);
    if (!sanitizeSlide(s, 'ar', newId)) { ok(`a new ${k} slide survives being read again`, false, s); }
  }
  ok('every new slide survives being read again', true);
  ok('a new closing slide says thanks in the deck’s language', blankSlide('end', { lang: 'ckb', title: '' }, newId).title === 'سوپاس بۆ گوێگرتنتان');
}

// ── digits ────────────────────────────────────────────────────────────────
ok('Arabic writes ١٢٣ beside Arabic words', digitsOf('في 412 طالباً', { lang: 'ar' }) === 'في ٤١٢ طالباً');
ok('and 123 beside Latin ones, as a DOI or a version needs', digitsOf('SPSS 26', { lang: 'ar' }) === 'SPSS 26');
ok('a percent beside Eastern digits is ٪', digitsOf('نسبة 78%', { lang: 'ar' }) === 'نسبة ٧٨٪', digitsOf('نسبة 78%', { lang: 'ar' }));
ok('English keeps 123 and %', digitsOf('78%', { lang: 'en' }) === '78%');
ok('a deck set to Western digits keeps them', digitsOf('نسبة 78%', { lang: 'ar', digits: 'western' }) === 'نسبة 78%');

// ── from a Research document ──────────────────────────────────────────────
{
  const doc = {
    id: 'r', request: 'AI in schools', kind: 'masters', lang: 'ar', digits: 'eastern',
    meta: { title: 'أثر الذكاء الاصطناعي', author: 'آزاد', supervisor: 'أ.د. سارا', university: 'جامعة دهوك', college: 'كلية التربية', department: 'قسم الحاسوب', year: '2026' },
    abstract: 'دراسة [@s1] عن الأثر.', keywords: ['ذكاء'],
    sections: [
      { level: 1, heading: 'المقدمة', text: 'نص [@s1] مع [[بيانات الباحث]] وفقرة.' },
      { level: 1, heading: 'النتائج', text: 'بلغ المتوسط 3.8 [@s2].' },
    ],
    sources: [
      { key: 's1', title: 'AI in education', authors: [{ family: 'Smith', given: 'John' }], year: 2020, venue: 'C&E', use: true, verified: true, type: 'article', origin: 'openalex' },
      { key: 's2', title: 'ChatGPT', authors: [{ family: 'Ali' }, { family: 'Omar' }, { family: 'Aziz' }, { family: 'Kareem' }], year: 2023, use: true, verified: true, type: 'article', origin: 'crossref' },
      { key: 's3', title: 'Uncited', authors: [], use: true, verified: true, type: 'article', origin: 'openalex' },
      { key: 's4', title: 'Retracted', authors: [], use: true, retracted: true, verified: true, type: 'article', origin: 'openalex' },
    ],
  };
  const r = fromResearch(doc);
  ok('a thesis is defended', r.kind === 'defense' && r.lang === 'ar');
  ok('its title comes from the cover', r.title === 'أثر الذكاء الاصطناعي');
  ok('the cover names carry over', r.meta.presenter === 'آزاد' && r.meta.supervisor === 'أ.د. سارا' && r.meta.college === 'كلية التربية — قسم الحاسوب' && r.meta.date === '2026');
  ok('the model is given the parts, markers and gaps out', r.source.includes('# النتائج') && r.source.includes('بلغ المتوسط 3.8') && !r.source.includes('[@') && !r.source.includes('[['));
  ok('only cited sources are listed', r.refs.length === 2 && !r.refs.some((x) => x.includes('Uncited')));
  ok('a retracted source never is', !r.refs.some((x) => x.includes('Retracted')));
  ok('a reference reads author, year, title, venue', refLine(doc.sources[0]) === 'Smith, J. (2020). AI in education. C&E');
  ok('more than three authors is et al.', refLine(doc.sources[1]).startsWith('Ali; Omar; Aziz et al. (2023)'));
  ok('its digits setting carries over', r.digits === 'eastern');
  ok('a conference paper is a conference talk', fromResearch({ ...doc, kind: 'conference' }).kind === 'conference');
  ok('references run seven to a slide, at most four slides', refSlides(Array(40).fill('x')).length === 4 && refSlides(Array(8).fill('x'))[1].length === 1);
}

ok('a file name drops what a file system refuses', fileNameFor({ title: 'A/B: "C"?', request: '' }, 'pptx') === 'A B C.pptx');
ok('and falls back to Slides', fileNameFor({ title: '', request: '' }, 'pdf') === 'Slides.pdf');

// ── layout ────────────────────────────────────────────────────────────────
ok('the canvas is PowerPoint’s 16:9', W === 1280 && H === 720 && W / H === 16 / 9);
ok('a longer text wraps to more lines', linesOf('word '.repeat(40), 30, 600) > linesOf('word', 30, 600));
ok('a word longer than the line breaks', linesOf('x'.repeat(100), 20, 100) > 5);
ok('fitting steps down until it fits', fit(['word '.repeat(60)], { width: 600, height: 200, max: 40, min: 10, lineH: 1.2 }) < 40);
ok('and short text stays large', fit(['Hi'], { width: 600, height: 200, max: 40, min: 10, lineH: 1.2 }) === 40);
ok('a picture keeps its shape inside its box', (() => { const c = contain({ x: 0, y: 0, w: 200, h: 100 }, 1); return c.w === 100 && c.h === 100 && c.x === 50; })());
ok('a paragraph’s direction follows its letters', dirOf('Smith (2020).', true) === false && dirOf('نص', false) === true && dirOf('2020', true) === true);
{
  const brand = paletteOf({ theme: 'academic', brand: { primary: '#F5E050', accent: '#123456' } });
  ok('a pale brand band gets dark text', brand.onBand === '#111111' && brand.band === '#F5E050');
  ok('a brand accent replaces the theme’s', brand.accent === '#123456');
  ok('a bad colour is ignored', paletteOf({ theme: 'modern', brand: { primary: 'red' } }).band === PALETTES.modern.band);
}
{
  const slides = ['title', 'section', 'bullets', 'two', 'stat', 'table', 'timeline', 'quote', 'references', 'end'].map((k) => blankSlide(k, { lang: 'en', title: 'T' }, newId));
  const inside = (b) => b.x >= -0.5 && b.y >= -0.5 && b.x + b.w <= W + 0.5 && b.y + b.h <= H + 0.5;
  for (const lang of ['en', 'ar']) {
    const d = deckOf({ lang, logo: 'data:image/png;base64,iVBORw0KGgo=', meta: { presenter: 'P', supervisor: 'S', university: 'U', college: 'C', date: '2026' } });
    const all = slides.flatMap((s, i) => layout(s, d, i).boxes);
    ok(`every box of every kind is on the slide (${lang})`, all.every(inside), all.filter((b) => !inside(b)));
  }
  const bullets = slides[2];
  const ltr = layout(bullets, deckOf({ lang: 'en' }), 1).boxes;
  const rtl = layout(bullets, deckOf({ lang: 'ar' }), 1).boxes;
  ok('a right-to-left slide is its left-to-right one reflected', ltr.length === rtl.length && ltr.every((b, i) => Math.abs((W - b.x - b.w) - rtl[i].x) < 0.01 && b.y === rtl[i].y));
  ok('and its text is marked right to left', rtl.filter((b) => b.t === 'text').every((b) => b.rtl));
  const num = layout(bullets, deckOf({ lang: 'ar' }), 11).boxes.find((b) => b.t === 'text' && b.align === 'end');
  ok('the slide number is written as the deck writes numbers', num.paras[0].text === '١٢');
  ok('a title slide carries the cover names', layout(slides[0], deckOf({ meta: { presenter: 'Lana', supervisor: 'Dr. K', university: 'Duhok', college: '', date: '' } }), 0)
    .boxes.some((b) => b.t === 'text' && b.paras.some((p) => p.text === 'By Lana')));
  ok('content slides carry a bullet in the accent', layout(bullets, deckOf(), 1).boxes.some((b) => b.t === 'text' && b.paras.some((p) => p.bullet === PALETTES.academic.accent)));
  const table = layout(slides[5], deckOf(), 5).boxes.find((b) => b.t === 'table');
  ok('a table is one box with its rows', table && table.rows.length === 2);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
