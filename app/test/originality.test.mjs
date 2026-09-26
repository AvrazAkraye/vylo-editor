// The originality check, and the integrity read of a document.
//
// Three properties matter more than the rest. A copied passage is found
// whatever keyboard typed it — Kurdish ی or Arabic ي, harakat or none — and
// its offsets point at the words in the ORIGINAL texts on both sides, because
// the panel highlights them there. Quoted and cited words are listed but can
// be left out of the score, since quoting with a citation is scholarship. And
// it is fast enough for a real thesis against everything it cites.
import {
  DEFAULTS, check, context, distinctive, integrity, normalise, pieceOfText, piecesOf, refOfDoc, refsOf, segments,
  sentencesOf, tokens,
} from '../.test-build/originality.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const words = (s) => tokens(s).map((t) => t.word);

// ── normalising ───────────────────────────────────────────────────────────
ok('the defaults are the contract’s', DEFAULTS.shingle === 5 && DEFAULTS.minWords === 8 && DEFAULTS.skipQuoted === true
  && DEFAULTS.skipCited === false && DEFAULTS.repeatWords === 12, DEFAULTS);
ok('alef forms are bare alef', normalise('\u0623\u0625\u0622\u0671\u0627') === '\u0627'.repeat(5), normalise('\u0623\u0625\u0622\u0671'));
ok('Kurdish yeh, Arabic yeh and alef maqsura are one letter',
  normalise('\u06CC') === normalise('\u064A') && normalise('\u0649') === normalise('\u064A'));
ok('Kurdish keheh and Arabic kaf are one letter', normalise('\u06A9') === normalise('\u0643'));
ok('Kurdish ae, teh marbuta, heh doachashmee and heh are one letter',
  normalise('\u06D5') === normalise('\u0647') && normalise('\u0629') === normalise('\u0647') && normalise('\u06BE') === normalise('\u0647'));
ok('harakat go', normalise('\u0643\u064E\u062A\u064E\u0628\u064E') === normalise('\u0643\u062A\u0628'));
ok('shadda, sukun and tanween go', normalise('\u0645\u064F\u062D\u064E\u0645\u0651\u064E\u062F\u064C') === normalise('\u0645\u062D\u0645\u062F'));
ok('the dagger alef goes', normalise('\u0647\u0670\u0630\u0627') === normalise('\u0647\u0630\u0627'));
ok('tatweel goes', normalise('\u0643\u0640\u0640\u0640\u062A\u0627\u0628') === normalise('\u0643\u062A\u0627\u0628'));
ok('Eastern Arabic digits are ASCII', normalise('\u0662\u0660\u0662\u0664') === '2024');
ok('Persian digits are ASCII', normalise('\u06F2\u06F0\u06F2\u06F4') === '2024');
ok('the Arabic decimal separator is a point', normalise('\u0663\u066B\u0665') === '3.5');
ok('zero-width and direction marks go', normalise('a\u200Cb\u200Dc\u200Ed\uFEFFe') === 'abcde');
ok('Kurdish-only letters stay', normalise('\u0695\u06B5\u06CE\u06C6\u06A4') === '\u0695\u06B5\u06CE\u06C6\u06A4');
ok('lower-case', normalise('Research PAPER') === 'research paper');
ok('presentation forms are letters again', normalise('\uFEFB') === '\u0644\u0627');
ok('nothing is nothing', normalise('') === '' && normalise(undefined) === '' && normalise(42) === '');

// ── tokens ────────────────────────────────────────────────────────────────
ok('a marker is not words', words('alpha [@s3] beta').join(' ') === 'alpha beta');
ok('a group with a locator in words is not words either', words('alpha [@s2, المادة ١٣/ثانياً] beta').join(' ') === 'alpha beta');
ok('a marker group of two keys', words('alpha [@s3; @s7] beta').join(' ') === 'alpha beta');
{
  const t = tokens('see [[add the table]] now');
  ok('a gap’s brackets are not words, what it says is', t.map((x) => x.word).join(' ') === 'see add the table now', t);
  ok('and its words keep their offsets', t[1].start === 6 && t[1].end === 9, t[1]);
}
{
  const t = tokens('### The Heading\n1. first item\n- second item\n٣. third');
  ok('heading hashes and list markers are not words', t.map((x) => x.word).join(' ') === 'the heading first item second item third', t.map((x) => x.word));
  ok('the heading’s first word starts after the hashes', t[0].start === 4 && t[0].end === 7, t[0]);
}
ok('punctuation alone is nothing', tokens('— ، . ؟ !! | --- |').length === 0);
{
  const s = '\u0643\u064E\u062A\u064E\u0628\u064E الولدُ';
  const t = tokens(s);
  ok('offsets are into the original text, harakat and all', t[0].start === 0 && t[0].end === 6 && t[0].word === normalise('\u0643\u062A\u0628'), t);
  ok('and the second word starts after the space', t[1].start === 7 && s.slice(t[1].start, t[1].end) === 'الولدُ', t[1]);
}
ok('an apostrophe inside a word keeps it one word', words("the master's thesis").join('|') === "the|master's|thesis");
ok('a decimal is one word, in both numerals', words('3.5 and ٣٫٥').join('|') === '3.5|and|3.5');
ok('tatweel alone is not a word', words('a ـــ b').join(' ') === 'a b');
ok('a table’s pipes are not words', words('| one | two |').join(' ') === 'one two');

// ── check: exact copies ───────────────────────────────────────────────────
const RUN = 'Groundwater depletion across the northern governorates accelerated sharply after successive droughts reduced surface flows and farmers expanded irrigated wheat cultivation';
const RUN_WORDS = RUN.split(' ').length;
{
  const piece = { id: 'p1', heading: 'One', text: `Opening remarks precede everything. ${RUN}, which matters greatly.` };
  const ref = { id: 'r1', kind: 'pasted', label: 'Ref', text: `Unrelated preface sentence here. ${RUN}; later discussion differs.` };
  const r = check([piece], [ref]);
  ok('the copied run is 20 words', RUN_WORDS === 20);
  ok('an exact copy is one match', r.matches.length === 1, r.matches);
  const m = r.matches[0];
  ok('of 20 words', m?.words === 20, m);
  ok('its offsets in the piece are the run', piece.text.slice(m.start, m.end) === RUN, piece.text.slice(m.start, m.end));
  ok('its offsets in the ref are the run', ref.text.slice(m.refStart, m.refEnd) === RUN, ref.text.slice(m.refStart, m.refEnd));
  ok('it names the piece and the ref', m.piece === 'p1' && m.ref === 'r1');
  ok('not quoted, not cited', m.quoted === false && m.cited === false);
  const all = tokens(piece.text).length;
  ok('words are the piece’s words', r.words === all, r.words);
  ok('matched words are the run', r.matchedWords === 20);
  ok('the score is a percentage to one decimal', r.score === Math.round((20 / all) * 1000) / 10, r.score);
  ok('byPiece says the same', r.byPiece.length === 1 && r.byPiece[0].piece === 'p1' && r.byPiece[0].words === all
    && r.byPiece[0].matchedWords === 20 && r.byPiece[0].score === r.score, r.byPiece);
  ok('byRef says the same', r.byRef.length === 1 && r.byRef[0].ref === 'r1' && r.byRef[0].words === 20 && r.byRef[0].score === r.score, r.byRef);
}
{
  const changed = RUN.replace('successive', 'repeated');
  const r = check([{ id: 'p', heading: '', text: `Before this. ${RUN}. After that.` }], [{ id: 'r', kind: 'online', label: '', text: `Prior. ${changed}. Posterior.` }]);
  ok('one changed word in a 20-word run is still ONE match', r.matches.length === 1, r.matches);
  ok('covering all 20 words', r.matches[0]?.words === 20, r.matches[0]);
}
{
  const inserted = RUN.replace('reduced', 'dramatically reduced');
  const r = check([{ id: 'p', heading: '', text: RUN }], [{ id: 'r', kind: 'online', label: '', text: inserted }]);
  ok('an inserted word is still one match', r.matches.length === 1 && r.matches[0].words === 20, r.matches);
}
{
  const six = 'successive droughts reduced surface flows sharply';
  const piece = { id: 'p', heading: '', text: `Our own sentence mentions ${six} in passing only.` };
  const ref = { id: 'r', kind: 'online', label: '', text: `Their text says ${six} as well.` };
  ok('a 6-word overlap is not reported', check([piece], [ref]).matches.length === 0);
  ok('unless minWords allows it', check([piece], [ref], { minWords: 5 }).matches.length === 1);
  ok('and a 4-word overlap is below the shingle', check([piece], [{ ...ref, text: 'successive droughts reduced surface' }], { minWords: 1 }).matches.length === 0);
}
{
  const piece = { id: 'p', heading: '', text: RUN.replace('farmers', 'farmers [@s3]') };
  const r = check([piece], [{ id: 'r', kind: 'online', label: '', text: RUN }]);
  ok('a marker inside a copied run does not break it', r.matches.length === 1 && r.matches[0].words === 20, r.matches);
}

// ── quoted and cited ──────────────────────────────────────────────────────
{
  const piece = { id: 'p', heading: '', text: `As the report put it, «${RUN}».` };
  const ref = { id: 'r', kind: 'online', label: '', text: RUN };
  const r = check([piece], [ref]);
  ok('a run inside « » is quoted', r.matches[0]?.quoted === true, r.matches);
  ok('and does not count by default', r.matchedWords === 0 && r.score === 0 && r.byRef.length === 0, r);
  ok('it is still listed', r.matches.length === 1);
  const r2 = check([piece], [ref], { skipQuoted: false });
  ok('with skipQuoted off it counts', r2.matchedWords === 20 && r2.byRef[0]?.words === 20, r2);
  ok('inside “ ” too', check([{ ...piece, text: `He wrote “${RUN}” once.` }], [ref]).matches[0]?.quoted === true);
  ok('inside straight quotes too', check([{ ...piece, text: `He wrote "${RUN}" once.` }], [ref]).matches[0]?.quoted === true);
  const half = RUN.split(' ');
  const mostly = `${half.slice(0, 2).join(' ')} “${half.slice(2).join(' ')}” then.`;
  ok('mostly quoted (18 of 20 words) is quoted', check([{ ...piece, text: mostly }], [ref]).matches[0]?.quoted === true);
  const partly = `${half.slice(0, 10).join(' ')} “${half.slice(10).join(' ')}” then.`;
  ok('half quoted is not', check([{ ...piece, text: partly }], [ref]).matches[0]?.quoted === false);
  ok('an unclosed quotation mark quotes nothing', check([{ ...piece, text: `A 5" screen. ${RUN}.` }], [ref]).matches[0]?.quoted === false);
}
{
  const src = { id: 'source:s3', kind: 'source', label: 'Study', key: 's3', text: `Study title\n${RUN}` };
  const cited = { id: 'p', heading: '', text: `${RUN} [@s3].\n\nAnother paragraph of our own.` };
  const r = check([cited], [src]);
  ok('a source cited in the same paragraph is cited', r.matches[0]?.cited === true, r.matches);
  ok('and counts by default', r.matchedWords === 20);
  ok('with skipCited it does not', check([cited], [src], { skipCited: true }).matchedWords === 0);
  const elsewhere = { id: 'p', heading: '', text: `${RUN}.\n\nA later paragraph cites it [@s3].` };
  ok('cited in another paragraph is not cited', check([elsewhere], [src]).matches[0]?.cited === false);
  ok('citing another key is not cited', check([{ ...cited, text: `${RUN} [@s4].` }], [src]).matches[0]?.cited === false);
  ok('a ref that is not a source is never cited', check([cited], [{ ...src, kind: 'data' }]).matches[0]?.cited === false);
}

// ── coverage ──────────────────────────────────────────────────────────────
{
  const piece = { id: 'p', heading: '', text: `Start here. ${RUN}. End here.` };
  const a = { id: 'a', kind: 'online', label: 'A', text: RUN };
  const b = { id: 'b', kind: 'online', label: 'B', text: `Some words first. ${RUN}` };
  const r = check([piece], [a, b]);
  ok('the same words matching two refs are two matches', r.matches.length === 2 && r.matches.map((m) => m.ref).sort().join() === 'a,b', r.matches);
  ok('but are counted once', r.matchedWords === 20, r.matchedWords);
  ok('each ref gets its words', r.byRef.length === 2 && r.byRef.every((x) => x.words === 20), r.byRef);
}
{
  const other = 'Municipal councils in Duhok reorganised waste collection routes during the summer months of the reform period ahead';
  const p1 = { id: 'p1', heading: 'One', text: `${RUN}. Our own closing words.` };
  const p2 = { id: 'p2', heading: 'Two', text: `Fresh words. ${other}.` };
  const p3 = { id: 'p3', heading: 'Three', text: 'Nothing copied at all in this short part.' };
  const r = check([p1, p2, p3], [
    { id: 'small', kind: 'online', label: '', text: other.split(' ').slice(0, 10).join(' ') },
    { id: 'big', kind: 'online', label: '', text: RUN },
    { id: 'none', kind: 'online', label: '', text: 'Entirely unrelated material about astronomy.' },
  ]);
  ok('byPiece has every piece, in order', r.byPiece.map((x) => x.piece).join() === 'p1,p2,p3', r.byPiece);
  ok('with each piece’s own numbers', r.byPiece[0].matchedWords === 20 && r.byPiece[1].matchedWords === 10 && r.byPiece[2].matchedWords === 0, r.byPiece);
  ok('a piece’s score is of its own words', r.byPiece[1].score === Math.round((10 / r.byPiece[1].words) * 1000) / 10);
  ok('byRef is most first, and a ref with nothing is left out', r.byRef.map((x) => x.ref).join() === 'big,small', r.byRef);
  ok('the total is the sum of the pieces', r.words === r.byPiece.reduce((n, x) => n + x.words, 0) && r.matchedWords === 30);
  ok('matches are in piece order', r.matches.map((m) => m.piece).join() === 'p1,p2', r.matches);
}
{
  const r = check([], []);
  ok('nothing to check is a zero report', r.words === 0 && r.score === 0 && r.matches.length === 0 && r.repeats.length === 0 && r.byPiece.length === 0);
  const r2 = check([{ id: 'p', heading: '', text: RUN }], []);
  ok('no refs is no matches', r2.matches.length === 0 && r2.words === 20 && r2.score === 0);
}

// ── Arabic and Sorani ─────────────────────────────────────────────────────
{
  const ar = 'يعد الأمن الغذائي من أهم التحديات التي تواجه الدول النامية في ظل التغيرات المناخية المتسارعة وتراجع الموارد المائية المتاحة للزراعة';
  // The same sentence as another keyboard and another writer type it: harakat, no hamza, alef maqsura and teh marbuta as heh.
  const typed = 'يُعدُّ الامن الغذائى من اهم التحديات التى تواجه الدول الناميه فى ظل التغيرات المناخيه المتسارعه وتراجع الموارد المائيه المتاحه للزراعه';
  const piece = { id: 'ar', heading: 'المقدمة', text: `تمهيد: ${typed}، وهذا ما سنبحثه.` };
  const r = check([piece], [{ id: 'src', kind: 'online', label: '', text: `في الخلاصة ${ar}.` }]);
  ok('Arabic: a copy typed differently is found', r.matches.length === 1 && r.matches[0].words === 20, r.matches);
  ok('Arabic: offsets point at the typed words', piece.text.slice(r.matches[0].start, r.matches[0].end) === typed);
}
{
  const ckb = 'ئەم توێژینەوەیە هەوڵ دەدات کاریگەری گۆڕانکارییەکانی کەشوهەوا لەسەر بەرهەمی گەنم لە دەشتی هەولێر شیکار بکات بە پشت بەستن بە داتای ساڵانە';
  // Typed on an Arabic keyboard: Arabic kaf and yeh, heh for ae.
  const arabicKeys = ckb.replace(/\u06A9/g, '\u0643').replace(/\u06CC/g, '\u064A').replace(/\u06D5/g, '\u0647');
  ok('the Sorani copy really is spelled differently', arabicKeys !== ckb);
  const r = check([{ id: 'k', heading: '', text: arabicKeys }], [{ id: 'src', kind: 'online', label: '', text: ckb }]);
  ok('Sorani: a copy typed on an Arabic keyboard is found', r.matches.length === 1 && r.matches[0].words === tokens(ckb).length, r.matches);
}

// ── repeats ───────────────────────────────────────────────────────────────
{
  const shared = 'the committee therefore recommends that every department publish its assessment criteria before the start of each academic year';
  const a = { id: 'a', heading: 'A', text: `Part one begins. ${shared}. Part one ends differently.` };
  const b = { id: 'b', heading: 'B', text: `Part two opens with something else. ${shared}. And closes.` };
  const r = check([a, b], []);
  ok('a passage repeated between two parts is found', r.repeats.length === 1, r.repeats);
  const x = r.repeats[0];
  ok('earlier copy first', x?.a.piece === 'a' && x?.b.piece === 'b');
  ok('with its words', x?.words === tokens(shared).length, x);
  ok('and offsets on both sides', a.text.slice(x.a.start, x.a.end) === shared && b.text.slice(x.b.start, x.b.end) === shared);
  ok('a part is not a repeat of itself', check([a], []).repeats.length === 0);
  const twice = { id: 'c', heading: '', text: `${shared}. In between there are other words entirely. ${shared}.` };
  const r2 = check([twice], []);
  ok('a passage said twice in one part is found, without overlapping itself', r2.repeats.length === 1
    && r2.repeats[0].a.end <= r2.repeats[0].b.start, r2.repeats);
  const short = 'the committee therefore recommends that every department publish';
  ok('a repeat under 12 words is not reported', check([{ id: 'd', heading: '', text: `${short} one. Then ${short} two.` }], []).repeats.length === 0);
  const tweaked = shared.replace('publish', 'release');
  ok('one changed word is still one repeat', check([a, { ...b, text: `Other. ${tweaked}.` }], []).repeats.length === 1);
}

// ── a ref that repeats itself ─────────────────────────────────────────────
{
  const stock = 'it is worth noting in this regard that';
  const ref = { id: 'r', kind: 'online', label: '', text: Array.from({ length: 2000 }, (_, i) => `${stock} item${i}.`).join(' ') };
  const piece = { id: 'p', heading: '', text: Array.from({ length: 300 }, (_, i) => `${stock} point${i}.`).join(' ') };
  const t0 = performance.now();
  const r = check([piece], [ref]);
  const ms = performance.now() - t0;
  ok('a stock phrase repeated thousands of times does not blow up', ms < 1000, ms);
  ok('and its 8-word runs are listed once each', r.matches.length === 300 && r.matches.every((m) => m.words === 8), r.matches.length);
}

// ── pieces and refs of a document ─────────────────────────────────────────
const source = (key, o = {}) => ({ key, title: `Title ${key}`, authors: [], type: 'article', origin: 'openalex', verified: true, use: true, ...o });
const section = (id, o = {}) => ({ id, level: 2, heading: `Heading ${id}`, brief: '', words: 0, sources: [], text: '', state: 'done', ...o });
const docOf = (o = {}) => ({
  id: 'd1', v: 1, created: 0, updated: 0, request: 'a paper about water', kind: 'article', lang: 'en', style: 'apa', length: 'standard',
  meta: { title: '' }, notes: '', queries: [], sources: [], sections: [], abstract: '', abstractEn: '', keywords: [], keywordsEn: [],
  stage: 'done', pause: false, ...o,
});
{
  const doc = docOf({
    sections: [section('a', { text: 'Written text.' }), section('b', { state: 'waiting', text: 'Not yet.' }), section('c', { text: '   ' }), section('d', { text: 'More.' })],
    abstract: 'The abstract.', abstractEn: 'English abstract.',
  });
  const ps = piecesOf(doc);
  ok('piecesOf: finished sections with text, then the abstracts', ps.map((p) => p.id).join() === 'a,d,abstract,abstract-en', ps);
  ok('with their headings', ps[0].heading === 'Heading a' && ps[2].heading === 'Abstract');
  ok('no abstract, no abstract piece', piecesOf(docOf({ sections: [section('a', { text: 'x' })] })).length === 1);
  ok('pieceOfText is one piece called text', pieceOfText('hello').id === 'text' && pieceOfText('hello').text === 'hello');
}
{
  const doc = docOf({
    sources: [source('s1', { abstract: 'An abstract.' }), source('s2'), source('s3', { abstract: 'x', use: false }), source('s4', { abstract: 'y', retracted: true })],
    files: [{ id: 'f1', name: 'survey.csv', kind: 'table', text: 'a\tb', bytes: 3, truncated: false }],
  });
  const rs = refsOf(doc);
  ok('refsOf: citable sources with an abstract, and data files', rs.map((r) => r.kind).join() === 'source,data', rs);
  ok('a source ref carries its key, title and abstract', rs[0].key === 's1' && rs[0].label === 'Title s1' && rs[0].text === 'Title s1\nAn abstract.', rs[0]);
  ok('a data ref is named by its file', rs[1].label === 'survey.csv' && rs[1].text === 'a\tb');
  const other = docOf({ id: 'd9', meta: { title: 'Other thesis' }, sections: [section('x', { text: 'First part.' }), section('y', { text: 'Second part.' }), section('z', { state: 'failed', text: 'Broken.' })] });
  const r = refOfDoc(other);
  ok('refOfDoc: id, kind and title', r.id === 'doc:d9' && r.kind === 'document' && r.label === 'Other thesis', r);
  ok('with its written sections joined', r.text.includes('First part.') && r.text.includes('Second part.') && !r.text.includes('Broken'), r.text);
  ok('an untitled document is labelled by its request', refOfDoc(docOf({ meta: { title: '' } })).label === 'a paper about water');
}

// ── sentences ─────────────────────────────────────────────────────────────
{
  const s = sentencesOf('قال د. أحمد إن النسبة ٣٫٥ بالمئة. وتشير الدراسات [@s2, p. 4] إلى ذلك؟ نعم [@s1].\n\n- item one\n### Head');
  ok('sentences: split at . and ؟ and not inside a marker, a decimal or after a title', s.length === 5 && s[0].text === 'قال د. أحمد إن النسبة ٣٫٥ بالمئة.', s.map((x) => x.text));
  ok('a marker after the full stop stays with its sentence', sentencesOf('It rose. [@s1] Then fell.')[0]?.text === 'It rose. [@s1]');
  ok('paragraphs are counted', s[3].paragraph === 1 && s[0].paragraph === 0);
  ok('a heading line is marked', s[4].line === 'heading' && s[4].text === 'Head');
  ok('offsets are original', sentencesOf('  Hello there. Next one!').map((x) => [x.start, x.end]).join('|') === '2,14|15,24');
}

// ── distinctive ───────────────────────────────────────────────────────────
{
  const long = (seed) => `The ${seed} hydrological survey of Zakho recorded unusual sediment loads alongside declining aquifer recharge rates near the Khabur tributary banks.`;
  const p1 = { id: 'p1', heading: '', text: [long('first'), long('second'), 'Too short to matter here.', `A cited sentence about Zakho sediment loads and aquifer recharge near Khabur tributary banks [@s1].`].join(' ') };
  const p2 = { id: 'p2', heading: '', text: `Kurdish orchard cooperatives negotiated pomegranate export quotas with Turkish wholesalers following prolonged border closures last spring. ${long('third')}` };
  const out = distinctive([p1, p2], 2);
  ok('distinctive: at most n', out.length === 2, out);
  ok('round-robin across the pieces', out.some((x) => x.includes('pomegranate')) && out.some((x) => x.includes('Zakho')), out);
  const all = distinctive([p1, p2], 10);
  ok('never a sentence with a marker', all.every((x) => !x.includes('[@')), all);
  ok('never a sentence under 12 words', all.every((x) => tokens(x).length >= 12), all);
  ok('fewer than n when there are fewer', all.length === 4, all);
  ok('n = 0 is nothing', distinctive([p1], 0).length === 0);
  const forty = Array.from({ length: 35 }, (_, i) => `term${i}`).join(' ') + '.';
  const cut = distinctive([{ id: 'x', heading: '', text: forty }], 1);
  ok('a long sentence is cut to 30 words', cut.length === 1 && tokens(cut[0]).length === 30, cut);
  const fifty = Array.from({ length: 50 }, (_, i) => `term${i}`).join(' ') + '.';
  ok('a sentence over 40 words is not used', distinctive([{ id: 'x', heading: '', text: fifty }], 1).length === 0);
  const stopped = 'It is the one that was in the and of it as it was to be for them with the rest of this.';
  ok('a sentence of mostly stop words is not used', distinctive([{ id: 'x', heading: '', text: stopped }], 1).length === 0);
  const gap = 'The Khabur valley survey recorded [[number]] sediment samples across eleven distinct monitoring stations upstream during winter floods.';
  ok('a sentence with a gap is not used', distinctive([{ id: 'x', heading: '', text: gap }], 1).length === 0);
  const ar = 'رصدت الدراسة الميدانية تراجعاً ملحوظاً في منسوب المياه الجوفية بمحافظة دهوك خلال مواسم الجفاف الثلاثة الأخيرة المتعاقبة.';
  ok('Arabic sentences are found, as written', distinctive([{ id: 'x', heading: '', text: ar }], 1)[0] === ar);
}

// ── segments and context ──────────────────────────────────────────────────
{
  const text = 'abcdefghijklmnop';
  const s = segments(text, [{ start: 4, end: 8 }, { start: 2, end: 5 }, { start: 12, end: 14 }]);
  ok('segments cover the whole text, in order', s.map((x) => x.text).join('') === text, s);
  ok('overlapping ranges are merged', s.filter((x) => x.hit).map((x) => x.text).join('|') === 'cdefgh|mn', s);
  ok('hits and text alternate', s.map((x) => (x.hit ? 1 : 0)).join('') === '01010', s);
  ok('ranges are clipped to the text', segments('abc', [{ start: -5, end: 1 }, { start: 2, end: 99 }]).map((x) => `${x.hit ? '+' : '-'}${x.text}`).join() === '+a,-b,+c');
  ok('touching ranges are one hit', segments('abcdef', [{ start: 1, end: 3 }, { start: 3, end: 5 }]).filter((x) => x.hit).length === 1);
  ok('no ranges is one plain segment', JSON.stringify(segments('abc', [])) === JSON.stringify([{ text: 'abc', hit: false }]));
  ok('empty and backwards ranges are dropped', segments('abc', [{ start: 2, end: 2 }, { start: 3, end: 1 }]).length === 1);
}
{
  const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
  const at = text.indexOf('seven');
  const c = context(text, at, at + 5, 12);
  ok('context: the hit is exact', c.hit === 'seven');
  ok('before is cut at a word and marked', c.before.startsWith('…') && /^…(four|five|six)\b/.test(c.before), c.before);
  ok('after is cut at a word and marked', c.after.endsWith('…') && /\b(eight|nine|ten)…$/.test(c.after), c.after);
  const whole = context('short text here', 6, 10, 80);
  ok('nothing cut, nothing marked', whole.before === 'short ' && whole.hit === 'text' && whole.after === ' here', whole);
}

// ── integrity ─────────────────────────────────────────────────────────────
{
  const filler = (n, w = 'analysis') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ') + '.';
  const doc = docOf({
    sources: [
      source('s1'), source('s2'), source('s3'), source('s4', { retracted: true }), source('s5'), source('s6', { use: false }),
    ],
    sections: [
      section('intro', {
        level: 1,
        text: [
          'Studies show that remote learning improves outcomes for most students in rural areas. The ministry agrees.',
          '',
          'According to the ministry, 45% of schools lacked internet access in 2019 [@s1].',
          '',
          'In 2020 enrolment fell by a third. The ministry later confirmed this trend [@s2].',
          '',
          'The missing figures: [[Table: enrolment by year]]',
          '',
          'In 2021 the number of schools was [[number]] across the region.',
        ].join('\n'),
      }),
      section('quiet', { text: filler(260) }),
      section('quote', {
        text: [
          'One teacher said «we had no books and no electricity for the whole winter term» at the hearing.',
          '',
          'The minister said «the reform will reach every school in every district by next year» [@s2].',
        ].join('\n'),
      }),
      section('heavy', { text: 'A [@s2]. B [@s2]. C [@s2]. D [@s2]. E [@s3]. F [@s4].' }),
      section('ar', { text: 'وتشير الدراسات إلى تراجع مستوى التحصيل في المدارس الريفية.\n\nتشير الدراسات إلى تحسن ملحوظ [@s1].' }),
      section('ckb', { text: 'بەپێی ئامارەکان ڕێژەی بێکاری بەرز بووەتەوە لە هەرێمدا.' }),
      section('kmr', { text: 'ڤەکۆلینێن نوی دیار دکەن کو ئاڤ کێم بوویە.' }),
      section('draft', { state: 'waiting', text: 'Studies show nothing yet, 99%.' }),
    ],
  });
  const issues = integrity(doc);
  const of = (what) => issues.filter((i) => i.what === what);
  const claims = of('uncited-claim');
  ok('integrity: an uncited "studies show" is a claim', claims.some((c) => c.section === 'intro' && c.text.startsWith('Studies show')), claims);
  ok('its offsets are the sentence', (() => {
    const c = claims.find((x) => x.text.startsWith('Studies show'));
    return c && doc.sections[0].text.slice(c.start, c.end) === c.text;
  })());
  ok('a cited figure is not flagged', !claims.some((c) => c.text.includes('45%')), claims);
  ok('a figure cited at the end of its paragraph is not flagged', !claims.some((c) => c.text.startsWith('In 2020')), claims);
  ok('a sentence with a gap is not flagged', !claims.some((c) => c.text.includes('[[')), claims);
  ok('an Arabic uncited claim, with و attached, is flagged', claims.some((c) => c.section === 'ar' && c.text.startsWith('وتشير')), claims);
  ok('but not the cited one', claims.filter((c) => c.section === 'ar').length === 1, claims);
  ok('a Sorani uncited claim is flagged', claims.some((c) => c.section === 'ckb'), claims);
  ok('a Badini uncited claim is flagged', claims.some((c) => c.section === 'kmr'), claims);
  ok('a section not yet written is not read', !issues.some((i) => i.section === 'draft'));
  const quotes = of('uncited-quote');
  ok('an uncited quotation is flagged', quotes.length === 1 && quotes[0].section === 'quote' && quotes[0].text.startsWith('we had no books'), quotes);
  ok('its range covers the marks', (() => {
    const q = quotes[0];
    const t = doc.sections[2].text.slice(q.start, q.end);
    return t.startsWith('«') && t.endsWith('»');
  })());
  const gaps = of('gap');
  ok('gaps are listed with what they say', gaps.length === 2 && gaps[0].text === 'Table: enrolment by year' && gaps[1].text === 'number', gaps);
  ok('a gap’s range is its brackets', doc.sections[0].text.slice(gaps[0].start, gaps[0].end) === '[[Table: enrolment by year]]');
  const parts = of('uncited-part');
  ok('a long part citing nothing is flagged', parts.length === 1 && parts[0].section === 'quiet' && parts[0].words === 260, parts);
  ok('unused sources are the citable ones nobody cites', of('unused-source').map((i) => i.key).join() === 's5', of('unused-source'));
  const dom = of('dominant-source');
  ok('a source carrying most citations is dominant', dom.length === 1 && dom[0].key === 's2', dom);
  ok('with its share: 6 of the 10 citation instances', dom[0].share === 0.6, dom[0]);
  ok('a retracted source that is cited is flagged', of('retracted-source').map((i) => i.key).join() === 's4');
  const order = issues.map((i) => i.section ?? '~');
  const firstSource = issues.findIndex((i) => !('section' in i));
  ok('sources’ issues come last', firstSource > 0 && issues.slice(firstSource).every((i) => !('section' in i)), issues.map((i) => i.what));
  ok('section issues are in section order', order.slice(0, firstSource).join() === [...order.slice(0, firstSource)].sort((a, b) =>
    doc.sections.findIndex((s) => s.id === a) - doc.sections.findIndex((s) => s.id === b)).join(), order);
  const intro = issues.filter((i) => i.section === 'intro');
  ok('and by offset inside a section', intro.every((x, i) => i === 0 || x.start >= intro[i - 1].start), intro);
}
{
  const few = docOf({ sources: [source('s1'), source('s2')], sections: [section('a', { text: 'A [@s1]. B [@s1]. C [@s2].' })] });
  ok('under 8 citations, nothing is dominant', !integrity(few).some((i) => i.what === 'dominant-source'));
  const none = docOf({ sources: [source('s1')], sections: [] });
  ok('nothing written, no source is called unused', integrity(none).length === 0);
  const nosources = docOf({ sections: [section('a', { text: Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ') })] });
  ok('no sources, no part is uncited', !integrity(nosources).some((i) => i.what === 'uncited-part'));
  const chapters = docOf({ kind: 'masters', sources: [source('s1')], sections: [section('c', { level: 1, text: Array.from({ length: 300 }, (_, i) => `w${i}`).join(' ') }), section('d', { text: 'x [@s1].' })] });
  ok('a chapter heading in a thesis is not an uncited part', !integrity(chapters).some((i) => i.what === 'uncited-part'));
}

// ── performance ───────────────────────────────────────────────────────────
{
  let seed = 20260926;
  const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const syll = ['ka', 'ri', 'mo', 'zan', 'del', 'ab', 'shi', 'ro', 'nu', 'ver', 'tal', 'bek', 'hon', 'ye', 'dar', 'lu'];
  const vocab = Array.from({ length: 4000 }, () => Array.from({ length: 2 + Math.floor(rand() * 3) }, () => syll[Math.floor(rand() * syll.length)]).join(''));
  const text = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(vocab[Math.floor(rand() * vocab.length)] + (rand() < 0.07 ? '.' : ''));
    return out;
  };
  const refs = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}`, kind: 'online', label: '', words: text(5000) }));
  const piece = text(150_000);
  // Plant 50 passages of 30 words from the refs in the piece.
  for (let i = 0; i < 50; i++) {
    const r = refs[i * 4];
    const from = 100 + i * 50;
    const at = 1000 + i * 2900;
    for (let j = 0; j < 30; j++) piece[at + j] = r.words[from + j].replace(/\.$/, '');
  }
  const pieces = [{ id: 'big', heading: '', text: piece.join(' ') }];
  const refTexts = refs.map((r) => ({ id: r.id, kind: r.kind, label: r.label, text: r.words.join(' ') }));
  const t0 = performance.now();
  const r = check(pieces, refTexts);
  const ms = performance.now() - t0;
  console.log(`  (150,000 words against 1,000,000 words of refs: ${Math.round(ms)} ms)`);
  ok('150k words against 1M words of refs in under 3 s', ms < 3000, ms);
  ok('the words are all counted', r.words === 150_000, r.words);
  ok('the 50 planted passages are found', r.matches.length >= 50 && r.matches.filter((m) => m.words >= 30).length >= 50, r.matches.length);
  ok('and they point at the planted text', r.matches.every((m) => {
    const ref = refTexts.find((x) => x.id === m.ref);
    return normalise(pieces[0].text.slice(m.start, m.end).replace(/\./g, '')) === normalise(ref.text.slice(m.refStart, m.refEnd).replace(/\./g, ''));
  }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
