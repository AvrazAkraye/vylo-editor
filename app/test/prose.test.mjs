// The one reader of a section's text.
//
// The preview, the word counts and the Word file all read a section through
// `blocksOf`, so the file is what the preview showed. The text comes from a
// model and then from a person editing it, so the property that matters most
// is that the reader is forgiving and never surprising: it never throws, a
// shape it does not know becomes text rather than vanishing, and a bracket or
// an asterisk whose meaning is unclear is printed as typed. Markers are found
// in every form a model actually writes them, and nothing else is taken for one.
import { blocksOf, markerPieces, runsOf, markersIn, wordCount } from '../.test-build/prose.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`); cond ? pass++ : fail++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eq = (name, got, want) => ok(name, same(got, want), { got, want });
const T = (text, f = {}) => ({ t: 'text', text, ...f });
const C = (keys, locator) => (locator ? { t: 'cite', keys, locator } : { t: 'cite', keys });
const H = (text) => ({ t: 'hole', text });
const P = (...runs) => ({ t: 'p', runs });
const textOf = (runs) => runs.map((r) => (r.t === 'text' ? r.text : r.t === 'hole' ? `[[${r.text}]]` : `{${r.keys.join(',')}${r.locator ? '|' + r.locator : ''}}`)).join('');

// ── plain text and emphasis ───────────────────────────────────────────────
eq('plain text is one run', runsOf('A plain sentence.'), [T('A plain sentence.')]);
eq('an empty line is no runs', runsOf(''), []);
eq('bold', runsOf('a **term** here'), [T('a '), T('term', { bold: true }), T(' here')]);
eq('italic with asterisks', runsOf('an *aside* now'), [T('an '), T('aside', { italic: true }), T(' now')]);
eq('italic with underscores', runsOf('an _aside_ now'), [T('an '), T('aside', { italic: true }), T(' now')]);
eq('bold with underscores', runsOf('__strong__'), [T('strong', { bold: true })]);
eq('bold and italic at once', runsOf('***both***'), [T('both', { bold: true, italic: true })]);
eq('italic inside bold', runsOf('**a *b* c**'), [T('a ', { bold: true }), T('b', { bold: true, italic: true }), T(' c', { bold: true })]);
eq('bold in Arabic', runsOf('**التعلم الآلي**: تعريف'), [T('التعلم الآلي', { bold: true }), T(': تعريف')]);
// A stray ** must not turn the rest of a paragraph bold.
eq('a stray ** with no partner stays literal', runsOf('**bold without end'), [T('**bold without end')]);
eq('a ** between spaces stays literal', runsOf('5 ** 2 is 25'), [T('5 ** 2 is 25')]);
eq('two lonely ** stay literal', runsOf('a ** b ** c'), [T('a ** b ** c')]);
eq('a lone * stays literal', runsOf('note * here'), [T('note * here')]);
eq('four asterisks stay literal', runsOf('a **** b'), [T('a **** b')]);
eq('snake_case is a word', runsOf('call file_name_here now'), [T('call file_name_here now')]);
eq('an escaped asterisk is an asterisk', runsOf('\\*not italic\\*'), [T('*not italic*')]);
eq('an escaped bracket is not a marker', runsOf('\\[@s3]'), [T('[@s3]')]);
eq('a backslash before a letter stays', runsOf('C:\\path'), [T('C:\\path')]);
eq('a code span is its text', runsOf('use `x_y*z` here'), [T('use x_y*z here')]);
eq('an unclosed backtick stays', runsOf('a ` b'), [T('a ` b')]);
eq('<br> becomes a space', runsOf('one<br>two<br/>three'), [T('one two three')]);
eq('adjacent text of the same format is one run', runsOf('a b c'), [T('a b c')]);
ok('no empty text runs are produced', runsOf('****x**** ** *').every((r) => r.t !== 'text' || r.text.length > 0));

// ── markers ───────────────────────────────────────────────────────────────
eq('[@s3]', runsOf('x [@s3] y'), [T('x '), C(['s3']), T(' y')]);
eq('[@s3; @s7]', runsOf('[@s3; @s7]'), [C(['s3', 's7'])]);
eq('[@s3, @s7]', runsOf('[@s3, @s7]'), [C(['s3', 's7'])]);
eq('[ @s3 ] with spaces', runsOf('[ @s3 ]'), [C(['s3'])]);
eq('[@s3 @s7] with only a space', runsOf('[@s3 @s7]'), [C(['s3', 's7'])]);
eq('[@s3, p. 12] has a locator', runsOf('[@s3, p. 12]'), [C(['s3'], 'p. 12')]);
eq('[@s3 p. 12] has a locator', runsOf('[@s3 p. 12]'), [C(['s3'], 'p. 12')]);
eq('[@s3, pp. 12-15] has a range', runsOf('[@s3, pp. 12-15]'), [C(['s3'], 'pp. 12-15')]);
eq('a locator with a comma in it stays whole', runsOf('[@s3, pp. 12, 15]'), [C(['s3'], 'pp. 12, 15')]);
eq('a locator and a second key', runsOf('[@s3, p. 12; @s7]'), [C(['s3', 's7'], 'p. 12')]);
eq('an Arabic locator', runsOf('[@s3، ص ٤٥]'), [C(['s3'], 'ص ٤٥')]);
eq('an article of a law', runsOf('[@s2, المادة ١٣/ثانياً]'), [C(['s2'], 'المادة ١٣/ثانياً')]);
eq('a roman-numeral page with its label', runsOf('[@s3, p. xii]'), [C(['s3'], 'p. xii')]);
eq('the Arabic semicolon separates keys', runsOf('[@s3؛ @s7]'), [C(['s3', 's7'])]);
eq('the Arabic comma separates keys', runsOf('[@s3، @s7]'), [C(['s3', 's7'])]);
eq('a key named twice is cited once', runsOf('[@s3; @s3]'), [C(['s3'])]);
eq('a trailing separator is tolerated', runsOf('[@s3;]'), [C(['s3'])]);
eq('a colon after the key is tolerated', runsOf('[@s3: p. 4]'), [C(['s3'], 'p. 4')]);
eq('a full stop inside the marker is not a locator', runsOf('[@s3.]'), [C(['s3'])]);
eq('markers inside an Arabic sentence', runsOf('كما يرى الباحثون [@s1; @s4]، فإن'), [T('كما يرى الباحثون '), C(['s1', 's4']), T('، فإن')]);
eq('a marker inside bold keeps the bold around it', runsOf('**as shown [@s1] here**'), [T('as shown ', { bold: true }), C(['s1']), T(' here', { bold: true })]);
eq('[[@s3]] is read as the marker it meant', runsOf('see [[@s3]]'), [T('see '), C(['s3'])]);
// Iraqi laws number their articles in words: a label is enough to make a locator.
eq('an article numbered in words', runsOf('نص [@s1, المادة الأولى].'), [T('نص '), C(['s1'], 'المادة الأولى'), T('.')]);
eq('a clause of an article, in words', runsOf('[@s1, البند أولاً من المادة الثانية]'), [C(['s1'], 'البند أولاً من المادة الثانية')]);
eq('a chapter in words, after the Arabic comma', runsOf('[@s3، الفصل الثاني]'), [C(['s3'], 'الفصل الثاني')]);
eq('a chapter in English words', runsOf('[@s3, chapter two]'), [C(['s3'], 'chapter two')]);
eq('a Sorani article in words', runsOf('[@s1, مادەی یەکەم]'), [C(['s1'], 'مادەی یەکەم')]);
const longArticle = 'المادة الثالثة عشرة، البند ثانياً، الفقرة (أ) من قانون المنظمات غير الحكومية';
eq('an article longer than sixty characters is still a locator', runsOf(`[@s1, ${longArticle}]`), [C(['s1'], longArticle)]);
eq('a label inside a word is not a label: [@s3 partly] stays text', runsOf('[@s3 partly]'), [T('[@s3 partly]')]);
eq('a label does not let words run on past the limit', runsOf(`[@s1, المادة ${'ا'.repeat(170)}]`), [T(`[@s1, المادة ${'ا'.repeat(170)}]`)]);
eq('markersIn: a law cited by an article in words is cited', markersIn('[@s1, المادة الأولى]'), ['s1']);
// The splitter researchrun's cleanSection shares, so both read the same keys.
eq('markerPieces: every separator a model or an Arabic keyboard types', markerPieces('@s3؛ @s45، @s7 @s8;@s9, @s10'), ['@s3', '@s45', '@s7', '@s8', '@s9', '@s10']);
eq('markerPieces: a comma inside a locator is not a separator', markerPieces('@s2, pp. 12, 14; @s3، ص ٤٥'), ['@s2, pp. 12, 14', '@s3، ص ٤٥']);
eq('markerPieces: nothing between separators is nothing', markerPieces(' ;; @s1 ; '), ['@s1']);
// Brackets that are not marker groups are the writer's brackets.
eq('[1] stays text', runsOf('as in [1] and [sic]'), [T('as in [1] and [sic]')]);
eq('[see @s3] stays text', runsOf('[see @s3]'), [T('[see @s3]')]);
eq('[@s3 and others] stays text', runsOf('[@s3 and others]'), [T('[@s3 and others]')]);
eq('[@s3 did] stays text — words are not a locator', runsOf('[@s3 did]'), [T('[@s3 did]')]);
eq('a markdown link stays text', runsOf('[the site](https://example.com)'), [T('[the site](https://example.com)')]);
eq('an e-mail in brackets stays text', runsOf('[write to a@b.org]'), [T('[write to a@b.org]')]);
eq('[@] stays text', runsOf('[@]'), [T('[@]')]);
eq('an unclosed [ stays text', runsOf('open [@s3 and never closed'), [T('open [@s3 and never closed')]);
eq('a very long bracket is prose, not a marker', runsOf(`[@s3 ${'1'.repeat(300)}]`), [T(`[@s3 ${'1'.repeat(300)}]`)]);
eq('a bracket inside a bracket', runsOf('[a [@s3]]'), [T('[a '), C(['s3']), T(']')]);

// ── gaps ──────────────────────────────────────────────────────────────────
eq('an inline gap', runsOf('the mean is [[mean of axis 1]] overall'), [T('the mean is '), H('mean of axis 1'), T(' overall')]);
eq('a gap is trimmed and its spaces collapsed', runsOf('[[  a   b  ]]'), [H('a b')]);
eq('an empty gap is still a gap', runsOf('[[ ]]'), [H('…')]);
eq('a gap keeps a bracket of its own', runsOf('[[Table: see [note]]]'), [H('Table: see [note]')]);
eq('an asterisk inside a gap is the gap’s', runsOf('[[*all* scores]]'), [H('*all* scores')]);
eq('an unclosed gap stays text', runsOf('[[never closed'), [T('[[never closed')]);

// ── blocks: paragraphs and headings ───────────────────────────────────────
eq('paragraphs split on blank lines', blocksOf('One.\n\nTwo.'), [P(T('One.')), P(T('Two.'))]);
eq('lines of a paragraph are joined with a space', blocksOf('One\nline more.'), [P(T('One line more.'))]);
eq('many blank lines are one break', blocksOf('A\n\n\n\nB'), [P(T('A')), P(T('B'))]);
eq('### is depth 1', blocksOf('### أولاً: الإطار'), [{ t: 'h', depth: 1, runs: [T('أولاً: الإطار')] }]);
eq('#### is depth 2', blocksOf('#### Sub'), [{ t: 'h', depth: 2, runs: [T('Sub')] }]);
eq('closing hashes are dropped', blocksOf('### Title ###'), [{ t: 'h', depth: 1, runs: [T('Title')] }]);
eq('###Title without a space is still a heading', blocksOf('###Title'), [{ t: 'h', depth: 1, runs: [T('Title')] }]);
eq('a heading ends the paragraph above it', blocksOf('Text\n### H\nMore'), [P(T('Text')), { t: 'h', depth: 1, runs: [T('H')] }, P(T('More'))]);
eq('# degrades to a paragraph of its text', blocksOf('# Top'), [P(T('Top'))]);
eq('## degrades too', blocksOf('## Second'), [P(T('Second'))]);
eq('##### degrades too', blocksOf('##### Deep'), [P(T('Deep'))]);
eq('an empty heading is dropped', blocksOf('###\n\nText'), [P(T('Text'))]);
eq('#hashtag is text', blocksOf('#hashtag'), [P(T('#hashtag'))]);

// ── blocks: lists ─────────────────────────────────────────────────────────
eq('a bulleted list', blocksOf('- a\n- b'), [{ t: 'ul', items: [[T('a')], [T('b')]] }]);
eq('* and • are bullets too', blocksOf('* a\n• b'), [{ t: 'ul', items: [[T('a')], [T('b')]] }]);
eq('a numbered list', blocksOf('1. a\n2. b'), [{ t: 'ol', items: [[T('a')], [T('b')]] }]);
eq('1) numbers too', blocksOf('1) a\n2) b'), [{ t: 'ol', items: [[T('a')], [T('b')]] }]);
eq('Arabic-Indic numerals number a list', blocksOf('١. أولاً\n٢. ثانياً'), [{ t: 'ol', items: [[T('أولاً')], [T('ثانياً')]] }]);
// A model that spaces out its items still means one list numbered to three.
eq('a loose list is one list', blocksOf('1. a\n\n2. b\n\n3. c'), [{ t: 'ol', items: [[T('a')], [T('b')], [T('c')]] }]);
eq('nested bullets flatten into the list', blocksOf('- a\n  - a1\n    - a2\n- b'), [{ t: 'ul', items: [[T('a')], [T('a1')], [T('a2')], [T('b')]] }]);
eq('nested bullets under numbers join the numbered list', blocksOf('1. a\n   - sub\n2. b'), [{ t: 'ol', items: [[T('a')], [T('sub')], [T('b')]] }]);
eq('an indented line continues its item', blocksOf('- first\n  more of it\n- second'), [{ t: 'ul', items: [[T('first more of it')], [T('second')]] }]);
eq('a different kind of list starts a new list', blocksOf('- a\n1. b'), [{ t: 'ul', items: [[T('a')]] }, { t: 'ol', items: [[T('b')]] }]);
eq('a list interrupts a paragraph', blocksOf('Intro:\n1. a\n2. b'), [P(T('Intro:')), { t: 'ol', items: [[T('a')], [T('b')]] }]);
eq('a paragraph after a list ends it', blocksOf('- a\nAfter.'), [{ t: 'ul', items: [[T('a')]] }, P(T('After.'))]);
eq('list items have markers and emphasis', blocksOf('- **Term**: text [@s1]'), [{ t: 'ul', items: [[T('Term', { bold: true }), T(': text '), C(['s1'])]] }]);
eq('3.5 million is not a list', blocksOf('3.5 million people'), [P(T('3.5 million people'))]);
eq('a year and a stop is not a list', blocksOf('2020. A year.'), [P(T('2020. A year.'))]);
eq('**bold** at the start of a line is not a bullet', blocksOf('**Note** this'), [P(T('Note', { bold: true }), T(' this'))]);

// ── blocks: tables ────────────────────────────────────────────────────────
const table = blocksOf('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
eq('a pipe table', table, [{ t: 'table', head: [[T('A')], [T('B')]], rows: [[[T('1')], [T('2')]], [[T('3')], [T('4')]]] }]);
eq('alignment colons are a separator', blocksOf('| A | B |\n|:--|--:|\n| 1 | 2 |')[0].rows, [[[T('1')], [T('2')]]]);
eq('a table without outer pipes', blocksOf('A | B\n--- | ---\n1 | 2'), [{ t: 'table', head: [[T('A')], [T('B')]], rows: [[[T('1')], [T('2')]]] }]);
{
  const [t] = blocksOf('| A | B | C |\n|---|---|---|\n| 1 |\n| 1 | 2 | 3 | 4 |');
  ok('ragged rows are padded to the widest row', t.head.length === 4 && t.rows.every((r) => r.length === 4), t);
  ok('a short row is padded with empty cells', same(t.rows[0], [[T('1')], [], [], []]));
  ok('a long row keeps its extra cell', same(t.rows[1][3], [T('4')]));
}
eq('a table with only a header', blocksOf('| A | B |\n|---|---|'), [{ t: 'table', head: [[T('A')], [T('B')]], rows: [] }]);
eq('a table without a separator line', blocksOf('| A | B |\n| 1 | 2 |'), [{ t: 'table', head: [[T('A')], [T('B')]], rows: [[[T('1')], [T('2')]]] }]);
eq('one row starting with a pipe is text', blocksOf('| just this'), [P(T('| just this'))]);
eq('an escaped pipe is inside its cell', blocksOf('| a \\| b | c |\n|---|---|')[0].head, [[T('a | b')], [T('c')]]);
eq('a pipe inside a gap is inside its cell', blocksOf('| [[x | y]] | c |\n|---|---|')[0].head, [[H('x | y')], [T('c')]]);
eq('markers and bold in cells', blocksOf('| **H** | x [@s2] |\n|---|---|')[0].head, [[T('H', { bold: true })], [T('x '), C(['s2'])]]);
eq('a separator inside the body is skipped', blocksOf('| A |\n|---|\n| 1 |\n|---|\n| 2 |')[0].rows, [[[T('1')]], [[T('2')]]]);
eq('a table ends at a blank line', blocksOf('| A |\n|---|\n| 1 |\n\nAfter'), [{ t: 'table', head: [[T('A')]], rows: [[[T('1')]]] }, P(T('After'))]);
{
  // A runaway table is capped, and what is past the last column is kept in it.
  const wide = Array.from({ length: 45 }, (_, i) => `c${i + 1}`);
  const [t] = blocksOf(`| ${wide.join(' | ')} |\n|---|\n| x |`);
  ok('a table is at most 40 columns wide', t.head.length === 40 && t.rows[0].length === 40, t.head.length);
  ok('the cells past the last column are joined into it', same(t.head[39], [T('c40 | c41 | c42 | c43 | c44 | c45')]), t.head[39]);
}
eq('a pipe in a sentence is not a table',blocksOf('either | or\nnext line'), [P(T('either | or next line'))]);
eq('a rule under a line with a pipe is not a table', blocksOf('a | b\n---'), [P(T('a | b'))]);

// ── blocks: gaps ──────────────────────────────────────────────────────────
eq('a line that is only a gap is a hole block', blocksOf('[[Table: the means of each axis]]'), [{ t: 'hole', text: 'Table: the means of each axis' }]);
eq('a gap line splits the paragraph around it', blocksOf('Before.\n[[Figure 1]]\nAfter.'), [P(T('Before.')), { t: 'hole', text: 'Figure 1' }, P(T('After.'))]);
eq('a gap over two lines is one hole block', blocksOf('[[Table:\nthe means]]'), [{ t: 'hole', text: 'Table: the means' }]);
eq('two gaps on a line are a paragraph of gaps', blocksOf('[[a]] [[b]]'), [P(H('a'), T(' '), H('b'))]);
eq('an inline gap stays inline', blocksOf('The score was [[score]].'), [P(T('The score was '), H('score'), T('.'))]);
eq('a gap in a list item', blocksOf('- [[item]]'), [{ t: 'ul', items: [[H('item')]] }]);

// ── blocks: what degrades ─────────────────────────────────────────────────
eq('a fence is dropped and its content is prose', blocksOf('```js\nconst x = 1;\n```'), [P(T('const x = 1;'))]);
eq('~~~ fences too', blocksOf('~~~\nplain\n~~~'), [P(T('plain'))]);
eq('a rule is dropped', blocksOf('A\n\n---\n\nB'), [P(T('A')), P(T('B'))]);
eq('*** and ___ rules are dropped', blocksOf('***\n___\n- - -\nText'), [P(T('Text'))]);
eq('a setext underline is dropped, the text kept', blocksOf('Title\n=====\nBody'), [P(T('Title')), P(T('Body'))]);
eq('a quotation mark is dropped', blocksOf('> quoted text'), [P(T('quoted text'))]);
eq('a lone ** line stays literal', blocksOf('**'), [P(T('**'))]);
eq('CRLF line endings', blocksOf('A\r\n\r\nB\r\n- c'), [P(T('A')), P(T('B')), { t: 'ul', items: [[T('c')]] }]);
eq('a byte-order mark is dropped', blocksOf('\uFEFFText'), [P(T('Text'))]);
eq('an empty text is no blocks', blocksOf(''), []);
eq('blank lines only are no blocks', blocksOf('\n \n\t\n'), []);
for (const bad of [null, undefined, 42, {}, [], true]) {
  eq(`blocksOf(${JSON.stringify(bad)}) is empty, not a throw`, blocksOf(bad), []);
  eq(`runsOf(${JSON.stringify(bad)}) is empty`, runsOf(bad), []);
  eq(`markersIn(${JSON.stringify(bad)}) is empty`, markersIn(bad), []);
  ok(`wordCount(${JSON.stringify(bad)}) is 0`, wordCount(bad) === 0);
}

// ── a whole section ───────────────────────────────────────────────────────
{
  const section = [
    'تمهيد يربط الفقرة بما قبلها [@s2].',
    '',
    '### أولاً: مفهوم التعلم الآلي',
    '',
    'يعرّف **التعلم الآلي** بأنه [@s1, ص 12] فرع من الذكاء الاصطناعي.',
    '',
    '1. الأول',
    '2. الثاني [@s3; @s1]',
    '',
    '| المحور | المتوسط |',
    '|---|---|',
    '| الأول | [[المتوسط]] |',
    '',
    '[[جدول: نتائج الاستبانة]]',
  ].join('\n');
  const b = blocksOf(section);
  eq('a section in the order it was written', b.map((x) => x.t), ['p', 'h', 'p', 'ol', 'table', 'hole']);
  eq('its markers in order of first citation', markersIn(section), ['s2', 's1', 's3']);
  ok('its heading text survives', textOf(b[1].runs) === 'أولاً: مفهوم التعلم الآلي');
}

// ── markersIn ─────────────────────────────────────────────────────────────
eq('first appearance, each once', markersIn('x [@s2] y [@s1; @s2] z [@s3]'), ['s2', 's1', 's3']);
eq('markers in headings, lists and tables count', markersIn('### H [@s4]\n\n- i [@s5]\n\n| a [@s6] |\n|---|'), ['s4', 's5', 's6']);
eq('a marker inside a gap does not count', markersIn('[[see [@s9] later]] and [@s1]'), ['s1']);
eq('a bracket that is not a marker does not count', markersIn('[see @s3] and [@s3 and others]'), []);
eq('an escaped marker does not count', markersIn('\\[@s3]'), []);
eq('a key with a locator counts', markersIn('[@s7, p. 3]'), ['s7']);

// ── wordCount ─────────────────────────────────────────────────────────────
ok('English words', wordCount('The quick brown fox.') === 4);
ok('Arabic words', wordCount('أثر الذكاء الاصطناعي في التعليم الجامعي') === 6, wordCount('أثر الذكاء الاصطناعي في التعليم الجامعي'));
ok('Sorani words, with the zero-width non-joiner inside a word', wordCount('کاریگەریی\u200cزیرەکیی دەستکرد لە فێرکردن') === 4, wordCount('کاریگەریی\u200cزیرەکیی دەستکرد لە فێرکردن'));
ok('Arabic punctuation is not a word', wordCount('أولاً ، ثانياً ؛ ثالثاً — رابعاً') === 4);
ok('markers are not words', wordCount('As shown [@s1; @s2, p. 4] here.') === 3);
ok('a marker between two words does not join them', wordCount('word[@s1]word') === 2);
ok('markup is not words', wordCount('### Heading\n\n- **bold** item\n1. second\n\n| a | b |\n|---|---|\n| c | d |') === 8,
   wordCount('### Heading\n\n- **bold** item\n1. second\n\n| a | b |\n|---|---|\n| c | d |'));
ok('a gap counts for what it says, not its brackets', wordCount('Value: [[mean of axis one]]') === 5);
ok('an empty gap counts nothing', wordCount('[[ … ]]') === 0);
ok('numbers are words', wordCount('In 2020 there were 35 cases') === 6);
ok('Arabic-Indic numbers are words', wordCount('في عام ٢٠٢٠') === 3);
ok('an empty text is no words', wordCount('') === 0);

// ── never throws, and always well formed ──────────────────────────────────
const wellFormedRuns = (runs) => Array.isArray(runs) && runs.every((r) =>
  (r.t === 'text' && typeof r.text === 'string' && r.text.length > 0)
  || (r.t === 'cite' && Array.isArray(r.keys) && r.keys.length > 0 && r.keys.every((k) => typeof k === 'string' && k) && (r.locator === undefined || (typeof r.locator === 'string' && r.locator)))
  || (r.t === 'hole' && typeof r.text === 'string' && r.text.length > 0));
const wellFormed = (blocks) => blocks.every((b) => {
  if (b.t === 'p' || b.t === 'h') return b.runs.length > 0 && wellFormedRuns(b.runs) && (b.t === 'p' || b.depth === 1 || b.depth === 2);
  if (b.t === 'ul' || b.t === 'ol') return b.items.length > 0 && b.items.every((it) => it.length > 0 && wellFormedRuns(it));
  if (b.t === 'table') return b.rows.every((r) => r.length === b.head.length) && [b.head, ...b.rows].every((r) => r.every(wellFormedRuns));
  if (b.t === 'hole') return typeof b.text === 'string' && b.text.length > 0;
  return false;
});
{
  // A seeded generator, so a failure can be reproduced.
  let seed = 20260924;
  const rand = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return (seed >>> 8) % n; };
  const pieces = ['[', ']', '[[', ']]', '@s', '@s3', '1', ';', ',', '،', '؛', '*', '**', '_', '__', '`', '\\', '|', '|---|', '#', '### ', '- ', '1. ', '> ', '```', '---', '\n', '\n\n', ' ', '  ', 'a', 'ع', 'ژ', 'p. 12', '<br>', '\t', '(', ')', '\u200c', '\uFEFF'];
  let threw = 0, bad = 0, badSample = '';
  for (let i = 0; i < 3000; i++) {
    let s = '';
    const n = rand(40);
    for (let j = 0; j < n; j++) s += pieces[rand(pieces.length)];
    try {
      const b = blocksOf(s);
      markersIn(s);
      const w = wordCount(s);
      const r = runsOf(s);
      if (!wellFormed(b) || !wellFormedRuns(r) || !Number.isInteger(w) || w < 0) { bad++; badSample = badSample || s; }
    } catch (e) {
      threw++;
      badSample = badSample || s;
    }
  }
  ok('3000 random texts: none throws', threw === 0, badSample);
  ok('3000 random texts: every result is well formed', bad === 0, badSample);
}
{
  // Every search ahead is bounded or remembered, so hostile input is linear.
  const t0 = Date.now();
  blocksOf('['.repeat(100000));
  blocksOf('[['.repeat(50000));
  blocksOf('[@s1 '.repeat(20000));
  runsOf('*a '.repeat(30000));
  runsOf('`'.repeat(3) + 'x'.repeat(100000));
  blocksOf('| a '.repeat(20000) + '\n|---|\n' + '| b |\n'.repeat(20000));
  blocksOf('- item\n'.repeat(20000));
  const ms = Date.now() - t0;
  ok('hostile input is read in linear time', ms < 3000, ms);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
