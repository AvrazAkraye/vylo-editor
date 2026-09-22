// Finding things in WhatsApp.
//
// The search is a substring match and is not what is being tested here. What
// is being tested is the *folding* underneath it: this inbox is Arabic,
// Sorani, Badini and English, and every one of those has more than one way to
// spell the same word. A search box that cannot find "يوسف" when the message
// says "یوسف" is a search box the only people who would use it cannot use.
//
// The index map gets its own group. Folding deletes characters — tatweel,
// harakat — so a highlight drawn at the folded offset lands in the wrong
// place, and that is the bug this file exists to make impossible.
import {
  findChats, findEverywhere, findMsgs, folded, marked, matches, ranges, snippet,
} from '../.test-build/whatsappfind.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (xs, ys) => JSON.stringify(xs) === JSON.stringify(ys);

const msg = (over = {}) => ({
  id: 'm1', keyId: 'k1', jid: '964750@s.whatsapp.net', fromMe: false,
  at: 1_700_000_000_000, text: '', kind: 'text', who: 'Ali', ...over,
});
const chat = (over = {}) => ({
  jid: '964750111@s.whatsapp.net', name: 'Ali', group: false, last: '', lastKind: 'text',
  lastFromMe: false, at: 1_700_000_000_000, unread: 0, ...over,
});

// ── the plain cases, which still have to work ─────────────────────────────
ok('a word is found', matches('hello there', 'hello'));
ok('case does not matter', matches('Hello There', 'HELLO'));
ok('part of a word is found', matches('deployment', 'ploy'));
ok('a word that is not there is not found', !matches('hello', 'goodbye'));
ok('an empty query matches everything', matches('anything', '') && matches('', ''));
ok('and whitespace is an empty query', matches('anything', '   '));
ok('every word must be present', matches('Ahmad from Baghdad', 'ahmad baghdad'));
ok('but not in that order', matches('Ahmad from Baghdad', 'baghdad ahmad'));
ok('and one missing word fails the whole query', !matches('Ahmad from Baghdad', 'ahmad basra'));

// ── the three yehs ────────────────────────────────────────────────────────
// Arabic keyboards send U+064A, Persian and Kurdish ones U+06CC, and U+0649
// turns up at the end of words. The same name, three ways, by three people.
ok('an Arabic yeh finds a Farsi yeh', matches('يوسف', 'یوسف'));
ok('and the other way round', matches('یوسف', 'يوسف'));
ok('alef maksura joins them', matches('على', 'علي') && matches('علي', 'علی'));

// ── the two kafs ──────────────────────────────────────────────────────────
ok('an Arabic kaf finds a keheh', matches('كردستان', 'کردستان'));
ok('and the other way round', matches('کردستان', 'كردستان'));

// ── the final he ──────────────────────────────────────────────────────────
// Sorani writes final -e as U+06D5 and half the keyboards in use send U+0647.
ok('U+06D5 and U+0647 find each other', matches('ماڵە', 'ماڵه'));
ok('and teh marbuta joins them', matches('مدرسة', 'مدرسه'));

// ── alef with anything on it ──────────────────────────────────────────────
ok('alef with hamza above', matches('أحمد', 'احمد'));
ok('alef with hamza below', matches('إبراهیم', 'ابراهیم'));
ok('alef madda', matches('آزاد', 'ازاد'));
ok('and searching the other way works too', matches('احمد', 'أحمد'));

// ── marks that are never typed ────────────────────────────────────────────
ok('harakat in the text are ignored', matches('مُحَمَّد', 'محمد'));
ok('and harakat in the query are too', matches('محمد', 'مُحَمَّد'));
ok('tatweel is ignored', matches('مـحـمـد', 'محمد'));
ok('and tatweel in the query', matches('محمد', 'مـحـمـد'));

// ── digits ────────────────────────────────────────────────────────────────
ok('Arabic-Indic digits are found by Latin ones', matches('٠٧٥٠١٢٣', '0750123'));
ok('Eastern Arabic-Indic too', matches('۰۷۵۰۱۲۳', '0750123'));
ok('and a Latin number is found by Arabic-Indic', matches('0750123', '٠٧٥٠١٢٣'));

// ── Latin accents ─────────────────────────────────────────────────────────
ok('an accent is not a different letter', matches('José', 'jose'));
ok('nor in the query', matches('Jose', 'josé'));

// ── what must NOT fold ────────────────────────────────────────────────────
// These are letters of Kurdish, not variants of an Arabic one. Folding ئ to ی
// would merge the vowel carrier that starts a third of Sorani words with a
// consonant, and ڕ to ر merges two different sounds.
ok('ڕ is not ر', !matches('ڕۆژ', 'رۆژ'));
ok('ڵ is not ل', !matches('ماڵ', 'مال'));
ok('ۆ is not و', !matches('ڕۆژ', 'ڕوژ'));
ok('ێ is not ی', !matches('دێ', 'دی'));
ok('ئ is not ی', !matches('ئەم', 'یەم'));
ok('ڤ is not ف', !matches('ڤیان', 'فیان'));
ok('پ چ ژ گ stay themselves',
   !matches('پ', 'ب') && !matches('چ', 'ج') && !matches('ژ', 'ز') && !matches('گ', 'ک'));

// ── the index map, which is the part that breaks silently ─────────────────
{
  const f = folded('abc');
  ok('a plain string folds to itself', f.s === 'abc' && same(f.at, [0, 1, 2]), f);
}
{
  // Four letters and three tatweels: the folded string is four long and its
  // last character came from index 6.
  const f = folded('مـحـمـد');
  ok('tatweel is dropped from the folded string', f.s.length === 4, f.s);
  ok('and the indices point past it', same(f.at, [0, 2, 4, 6]), f.at);
}
{
  const f = folded('مُحَمَّد');
  ok('harakat are dropped too', f.s.length === 4, f.s);
  ok('and the last letter keeps its real index',
     f.at[3] === 'مُحَمَّد'.indexOf('د'), { at: f.at, real: 'مُحَمَّد'.indexOf('د') });
}
{
  const f = folded('José');
  ok('an accent folds without moving anything after it',
     f.s === 'jose' && same(f.at, [0, 1, 2, 3]), f);
}

// ── ranges, on the original string ────────────────────────────────────────
ok('no query, no ranges', same(ranges('hello', ''), []));
ok('a simple hit', same(ranges('hello there', 'there'), [[6, 11]]));
ok('every occurrence', same(ranges('ab ab ab', 'ab'), [[0, 2], [3, 5], [6, 8]]));
ok('two words each get one', same(ranges('one two', 'one two'), [[0, 3], [4, 7]]));
// Two marks with nothing between them draw a seam, so they are merged.
ok('touching ranges merge', same(ranges('abcd', 'ab cd'), [[0, 4]]));
ok('overlapping ranges merge', same(ranges('aaa', 'aa a'), [[0, 3]]));
{
  // The one the index map exists for: the match starts after a dropped
  // character, so the highlight has to start later than the folded offset.
  const text = 'مـحـمـد و علی';
  const r = ranges(text, 'علی');
  ok('a hit after dropped characters lands in the right place',
     r.length === 1 && text.slice(r[0][0], r[0][1]) === 'علی', { r, cut: text.slice(r[0]?.[0], r[0]?.[1]) });
}
{
  // And the one where the drop is *inside* the match: the tatweel is part of
  // what gets highlighted, rather than leaving a hole in the middle of a word.
  const text = 'مـحـمـد';
  const r = ranges(text, 'محمد');
  ok('a hit containing dropped characters covers them',
     r.length === 1 && r[0][0] === 0 && r[0][1] === text.length, { r, len: text.length });
}
ok('a hit at the very end reaches the end', (() => {
  const r = ranges('say hello', 'hello');
  return r.length === 1 && r[0][1] === 'say hello'.length;
})());

// ── marked: the runs a component draws ────────────────────────────────────
ok('nothing to mark is one plain run', same(marked('hello', ''), [{ text: 'hello', hit: false }]));
ok('empty text is no runs at all', same(marked('', 'x'), []));
ok('a hit in the middle is three runs',
   same(marked('say hello now', 'hello'),
        [{ text: 'say ', hit: false }, { text: 'hello', hit: true }, { text: ' now', hit: false }]));
ok('a hit at the start has no run before it',
   same(marked('hello now', 'hello'), [{ text: 'hello', hit: true }, { text: ' now', hit: false }]));
ok('a hit at the end has none after',
   same(marked('say hello', 'hello'), [{ text: 'say ', hit: false }, { text: 'hello', hit: true }]));
// Nothing may be silently dropped: what goes in comes back out.
ok('the runs always rebuild the original', [
  ['say hello now', 'hello'], ['مـحـمـد و علی', 'علی'], ['aaa', 'aa a'], ['José', 'jose'], ['', ''],
].every(([t, q]) => marked(t, q).map((r) => r.text).join('') === t));

// ── chats ─────────────────────────────────────────────────────────────────
{
  const list = [
    chat({ jid: '9647501@s.whatsapp.net', name: 'Ahmad from Baghdad', last: 'see you then' }),
    chat({ jid: '9647502@s.whatsapp.net', name: 'یوسف', last: 'the address is Karrada' }),
    chat({ jid: '120363@g.us', name: '120363@g.us', group: true, last: 'meeting at 4' }),
  ];
  ok('no query keeps every chat', findChats(list, '').length === 3);
  ok('and does not reorder them', same(findChats(list, '').map((c) => c.jid), list.map((c) => c.jid)));
  ok('a name matches', same(findChats(list, 'ahmad').map((c) => c.name), ['Ahmad from Baghdad']));
  ok('two parts of a name match', same(findChats(list, 'ahmad baghdad').map((c) => c.name), ['Ahmad from Baghdad']));
  ok('a name in the other yeh matches', findChats(list, 'يوسف').length === 1);
  // "the chat where somebody sent the address" is how people look for a
  // conversation they cannot name.
  ok('the last message matches', same(findChats(list, 'karrada').map((c) => c.jid), ['9647502@s.whatsapp.net']));
  ok('the number behind the jid matches', same(findChats(list, '7501').map((c) => c.jid), ['9647501@s.whatsapp.net']));
  ok('a group id matches', findChats(list, '120363').length === 1);
  ok('nothing matching is an empty list', same(findChats(list, 'zzzz'), []));
}

// ── messages ──────────────────────────────────────────────────────────────
{
  const thread = [
    msg({ id: 'a', at: 1000, text: 'the meeting is at four' }),
    msg({ id: 'b', at: 2000, text: 'no words here', kind: 'image' }),
    msg({ id: 'c', at: 3000, text: 'moved the meeting to five' }),
    msg({ id: 'd', at: 4000, text: '' , kind: 'image' }),
  ];
  const r = findMsgs(thread, 'meeting');
  ok('both matches are found', r.total === 2, r);
  // A result list is read from the top and the recent one is nearly always the
  // one wanted, against the thread's own oldest-first order.
  ok('and come back newest first', same(r.hits.map((m) => m.id), ['c', 'a']), r.hits.map((m) => m.id));
  ok('a message with no words is never a hit', findMsgs(thread, '').total === 0);
  ok('an empty query finds nothing rather than everything', findMsgs(thread, '').hits.length === 0);
  ok('the cap limits what is drawn but not what is counted', (() => {
    const many = Array.from({ length: 200 }, (_, i) => msg({ id: `m${i}`, at: i, text: 'same word' }));
    const out = findMsgs(many, 'same', 50);
    return out.hits.length === 50 && out.total === 200;
  })());
  ok('a cap of zero still counts', findMsgs(thread, 'meeting', 0).total === 2);
}
{
  const all = [
    msg({ id: 'a', jid: 'x@s.whatsapp.net', at: 1000, text: 'the invoice' }),
    msg({ id: 'b', jid: 'y@s.whatsapp.net', at: 2000, text: 'invoice sent' }),
  ];
  const r = findEverywhere(all, 'invoice', { 'x@s.whatsapp.net': 'Ali', 'y@s.whatsapp.net': 'Sara' });
  ok('every conversation is searched', r.total === 2);
  ok('and each hit carries its chat name', same(r.hits.map((h) => h.name), ['Sara', 'Ali']), r.hits);
  ok('a chat with no name falls back to the number',
     findEverywhere(all, 'invoice', {}).hits.every((h) => h.name.length > 0));
}

// ── snippets ──────────────────────────────────────────────────────────────
{
  const short = 'a short message';
  ok('a short message is shown whole', snippet(short, 'short') === short);
  const long = `${'x'.repeat(400)} needle ${'y'.repeat(400)}`;
  const s = snippet(long, 'needle');
  ok('a long one is cut down', s.length < 120, s.length);
  // Showing the start of a long message when the match is 400 characters in
  // shows nothing of why it matched.
  ok('and the match is in what is shown', s.includes('needle'), s);
  ok('with an ellipsis where it was cut', s.startsWith('…') && s.endsWith('…'), s);
  ok('a match near the start needs no leading ellipsis',
     !snippet(`needle ${'y'.repeat(400)}`, 'needle').startsWith('…'));
  ok('no query is the head of the message',
     snippet(`${'x'.repeat(300)}`, '').startsWith('xxx'));
}

// ── nothing here throws on rubbish ────────────────────────────────────────
ok('a non-string is empty, not a crash', (() => {
  for (const bad of [null, undefined, 42, {}, []]) {
    if (folded(bad).s !== '') return false;
    if (!matches(bad, '')) return false;
    if (ranges(bad, 'x').length !== 0) return false;
    if (marked(bad, 'x').length !== 0) return false;
    if (snippet(bad, 'x') !== '') return false;
  }
  return true;
})());
ok('a rubbish query matches everything, like an empty one',
   [null, undefined, 42].every((bad) => matches('hello', bad)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
