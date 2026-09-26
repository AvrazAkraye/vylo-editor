// A Research document's Chat tab: what the model is told, how its answer is
// read, and what the app does with the operations in it.
//
// The rules that matter most: a part's text never comes from the chat — a
// change to it is a rewrite by the document's own writer — part numbers mean
// the outline the model was shown, and the outline is not the chat's to change
// while a run is writing it.
import {
  CHAT_KEEP, DOC_CHARS, MAX_OPS, MAX_REWRITES, applyOps, chatPrompt, keptChat, parseChat, textOf,
} from '../.test-build/researchchatops.js';
import { newDoc } from '../.test-build/research.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const sec = (id, heading, state = 'done', text = '', level = 1) => ({ id, level, heading, brief: '', words: 500, sources: [], text, state });
const base = () => ({
  ...newDoc({ id: 'd', now: 0, request: 'بحث عن المركز القانوني لإقليم كوردستان', kind: 'article' }),
  stage: 'writing',
  sources: [{ key: 's1', title: 'الفيدرالية في العراق', authors: [{ family: 'الجبوري', given: 'علي' }], year: 2019, type: 'article', abstract: 'دراسة في توزيع الاختصاصات.', origin: 'openalex', verified: true, use: true }],
  sections: [
    sec('a', 'المقدمة', 'done', 'يتناول هذا البحث المركز القانوني للإقليم [@s1].'),
    sec('b', 'المبحث الأول', 'done', 'نص المبحث الأول.'),
    sec('c', 'المبحث الثاني', 'waiting'),
    sec('d', 'المبحث الثالث', 'waiting'),
    sec('e', 'الخاتمة', 'author'),
  ],
});
let n = 0;
const newId = () => `new${++n}`;

// ── the prompt ────────────────────────────────────────────────────────────
{
  const d = base();
  const p = chatPrompt(d, [{ role: 'you', text: 'مرحبا', at: 1 }, { role: 'model', text: 'أهلاً', at: 2, changes: ['Renamed'] }], 'ما الذي يقوله المبحث الأول؟');
  ok('the system says answers come from the document', /Answer from the document, its sources/.test(p.system));
  ok('and forbids invented sources', /Never invent a study/.test(p.system));
  ok('and says a part is never written in the reply', /Never write the text of a part/.test(p.system));
  ok('and that it cannot save', /cannot save a file/.test(p.system));
  ok('the catalogue lists rewrite_part', p.system.includes('"op":"rewrite_part"'));
  ok('the outline is numbered from 1', p.user.includes('1. [level 1] المقدمة') && p.user.includes('3. [level 1] المبحث الثاني'));
  ok('with each part\'s state', p.user.includes('not written yet') && p.user.includes('left for the researcher to write'));
  ok('the sources by key', p.user.includes('[s1] الجبوري (2019). الفيدرالية في العراق'));
  ok('the written text', p.user.includes('نص المبحث الأول.'));
  ok('the history, with what was done', p.user.includes('Researcher: مرحبا') && p.user.includes('[done: Renamed]'));
  ok('and the message last', p.user.trimEnd().endsWith('ما الذي يقوله المبحث الأول؟'));
  const spoken = chatPrompt(d, [], 'اكتب الباقي', { spoken: true, ui: 'ckb' });
  ok('a spoken message says so', /speech engine/.test(spoken.user));
  ok('the interface language is named', spoken.system.includes('Central Kurdish'));
  const empty = chatPrompt({ ...d, sections: [], sources: [] }, [], 'hi');
  ok('no outline, no sources, nothing written: said plainly', /There is no outline yet/.test(empty.user) && /no sources yet/.test(empty.user) && /Nothing is written yet/.test(empty.user));
}

// ── the text inside its budget ────────────────────────────────────────────
{
  const long = 'ك'.repeat(50_000);
  const d = { ...base(), sections: [sec('a', 'قصير', 'done', 'نص قصير'), sec('b', 'طويل', 'done', long), sec('c', 'طويل٢', 'done', long)] };
  const t = textOf(d);
  ok('the text stays within the budget, give or take its labels', t.length <= DOC_CHARS + 400, t.length);
  ok('a short part is never cut for a long one', t.includes('نص قصير') && !/قصير \(only its beginning/.test(t));
  ok('a cut part says so', /part 2: طويل \(only its beginning is shown\)/.test(t));
  ok('parts not written are not in it', !textOf(base()).includes('المبحث الثاني'));
}

// ── reading the answer ────────────────────────────────────────────────────
{
  const a = parseChat('{"reply":"تم.","ops":[{"op":"rename_part","part":2,"heading":"جديد"}]}');
  ok('JSON is read', a.readable && a.reply === 'تم.' && a.ops.length === 1);
  const fenced = parseChat('Here:\n```json\n{"answer":"ok","actions":[]}\n```');
  ok('a fence and other key names are read', fenced.readable && fenced.reply === 'ok' && fenced.ops.length === 0);
  const prose = parseChat('يتناول المبحث الأول الشخصية القانونية الدولية.');
  ok('plain sentences are an answer with nothing to change', prose.readable && prose.reply.startsWith('يتناول') && prose.ops.length === 0);
  ok('a broken envelope is not an answer', !parseChat('{"reply": "half').readable);
  ok('nothing is not an answer', !parseChat('').readable && !parseChat(undefined).readable);
}

// ── carrying it out ───────────────────────────────────────────────────────
{
  const d = base();
  const r = applyOps(d, [{ op: 'rename_part', part: 2, heading: 'المبحث الأول: الأساس' }], { newId, busy: false });
  ok('a rename changes the heading', r.next.sections[1].heading === 'المبحث الأول: الأساس' && r.changes[0].what === 'renamed');
  ok('and nothing else', r.next.sections[1].text === 'نص المبحث الأول.' && r.work.length === 0 && d.sections[1].heading === 'المبحث الأول');

  const rm = applyOps(d, [{ op: 'remove_part', part: 2 }, { op: 'rename_part', part: 4, heading: 'الثالث الجديد' }], { newId, busy: false });
  ok('numbers mean the outline as it was sent, after a removal', rm.next.sections.length === 4 && rm.next.sections.find((s) => s.id === 'd').heading === 'الثالث الجديد');

  const add = applyOps(d, [{ op: 'add_part', after: 2, level: 2, heading: 'المطلب الجديد', brief: 'ما يغطيه', words: 900 }, { op: 'rewrite_part', part: 'new', instruction: 'اكتبه' }], { newId, busy: false });
  const added = add.next.sections[2];
  ok('a part is added after the one named', added.heading === 'المطلب الجديد' && added.state === 'waiting' && added.level === 2 && added.words === 900);
  ok('"new" names the part this reply added', add.work.length === 1 && add.work[0].how === 'rewrite' && add.work[0].id === added.id);
  const first = applyOps(d, [{ op: 'add_part', after: 0, heading: 'تمهيد' }], { newId, busy: false });
  ok('after 0 is the first place', first.next.sections[0].heading === 'تمهيد');
  const end = applyOps(d, [{ op: 'add_part', heading: 'ملحق' }], { newId, busy: false });
  ok('no place is the end', end.next.sections.at(-1).heading === 'ملحق');

  const rw = applyOps(d, [{ op: 'rewrite_part', part: 1, instruction: 'أقصر' }], { newId, busy: false });
  ok('a rewrite is work by id, and changes no text itself', rw.next === null && rw.work[0].id === 'a' && rw.work[0].redo === 'أقصر');
  ok('a rewrite of an unwritten part is allowed — it writes it', applyOps(d, [{ op: 'rewrite_part', part: 3 }], { newId, busy: false }).work.length === 1);
  ok('the researcher\'s own part is not written', applyOps(d, [{ op: 'rewrite_part', part: 5 }], { newId, busy: false }).changes[0].why === 'author');
  const writing = { ...d, sections: d.sections.map((s) => (s.id === 'c' ? { ...s, state: 'writing' } : s)) };
  ok('a part being written is not touched', applyOps(writing, [{ op: 'rewrite_part', part: 3 }], { newId, busy: false }).changes[0].why === 'writing');
  const many = applyOps(d, Array.from({ length: 5 }, (_, i) => ({ op: 'rewrite_part', part: (i % 4) + 1 })).concat(
    [{ op: 'rewrite_part', part: 1 }]), { newId, busy: false });
  ok('the same part twice is written once', many.work.filter((w) => w.id === 'a').length === 1);
  const lots = { ...d, sections: Array.from({ length: 10 }, (_, i) => sec(`p${i}`, `جزء ${i}`)) };
  const capped = applyOps(lots, Array.from({ length: 10 }, (_, i) => ({ op: 'rewrite_part', part: i + 1 })), { newId, busy: false });
  ok(`at most ${MAX_REWRITES} rewrites a message`, capped.work.length === MAX_REWRITES && capped.changes.some((c) => c.why === 'too-many-rewrites'));
  const flood = applyOps(d, Array.from({ length: MAX_OPS + 5 }, () => ({ op: 'open_part', part: 1 })), { newId, busy: false });
  ok('at most MAX_OPS ops are read', flood.changes.filter((c) => c.what === 'open').length === MAX_OPS && flood.changes.some((c) => c.why === 'too-many'));

  const busy = applyOps(d, [{ op: 'rename_part', part: 1, heading: 'x' }, { op: 'rewrite_part', part: 2 }, { op: 'write_rest' }], { newId, busy: true });
  ok('while a run writes, the outline is not changed', busy.next === null && busy.changes[0].why === 'busy');
  ok('but writing more is still queued', busy.work.length === 2);

  ok('write_rest with parts left', applyOps(d, [{ op: 'write_rest' }], { newId, busy: false }).work[0].how === 'run');
  const doneDoc = { ...d, stage: 'done', sections: d.sections.filter((s) => s.state === 'done') };
  ok('write_rest with nothing left is skipped', applyOps(doneDoc, [{ op: 'write_rest' }], { newId, busy: false }).changes[0].why === 'nothing-left');
  ok('the abstract, from what is written', applyOps(d, [{ op: 'write_abstract' }], { newId, busy: false }).work[0].how === 'abstract');
  ok('a working paper has no abstract', applyOps({ ...d, kind: 'working-paper' }, [{ op: 'write_abstract' }], { newId, busy: false }).changes[0].why === 'no-abstract');
  ok('no abstract from nothing', applyOps({ ...d, sections: [sec('x', 'x', 'waiting')] }, [{ op: 'write_abstract' }], { newId, busy: false }).changes[0].why === 'nothing-written');

  const meta = applyOps(d, [
    { op: 'set_title', title: 'عنوان جديد' }, { op: 'set_citation_style', style: 'APA' }, { op: 'add_note', text: 'العينة ٣٠٠ طالب' },
    { op: 'set_words', part: 3, words: '٨٠٠' }, { op: 'set_brief', part: 4, brief: 'يغطي الاستفتاء' },
  ], { newId, busy: false });
  ok('title, style, note, words (Eastern digits) and brief', meta.next.meta.title === 'عنوان جديد' && meta.next.style === 'apa'
    && meta.next.notes.includes('العينة') && meta.next.sections[2].words === 800 && meta.next.sections[3].brief === 'يغطي الاستفتاء');
  ok('"الهوامش" is footnotes', applyOps({ ...d, style: 'apa' }, [{ op: 'set_citation_style', style: 'الهوامش' }], { newId, busy: false }).next.style === 'footnotes');
  ok('an unknown style is skipped', applyOps(d, [{ op: 'set_citation_style', style: 'vancouver' }], { newId, busy: false }).changes[0].why === 'bad');

  const screen = applyOps(d, [{ op: 'open_part', part: 2 }, { op: 'show_tab', tab: 'originality' }, { op: 'offer_save', format: 'pdf' }, { op: 'save' }], { newId, busy: true });
  ok('showing and offering work even while writing', screen.wants.open === 'b' && screen.wants.tab === 'check'
    && screen.wants.offer.includes('pdf') && screen.wants.offer.includes('docx') && screen.next === null);
  ok('saving is only ever an offer', screen.changes.filter((c) => c.what === 'save').length === 1 && !('save' in screen.wants));

  const junk = applyOps(d, [{ op: 'write_file', path: '/etc/x' }, null, 'rm -rf', { op: 'rename_part', part: 99, heading: 'x' }], { newId, busy: false });
  ok('an op the app does not know is skipped by name', junk.changes[0].why === 'unknown' && junk.changes[0].op === 'write_file');
  ok('junk is skipped, not guessed at', junk.changes[1].why === 'bad' && junk.changes[2].why === 'bad');
  ok('a part that is not there is said', junk.changes[3].why === 'no-part' && junk.changes[3].part === 99 && junk.next === null);
  ok('aliases are understood', applyOps(d, [{ action: 'continue writing' }], { newId, busy: false }).work[0]?.how === 'run');
  const gone = applyOps(d, [{ op: 'rewrite_part', part: 2 }, { op: 'remove_part', part: 2 }], { newId, busy: false });
  ok('a rewrite of a part removed in the same reply is dropped', gone.work.length === 0);
  ok('no ops is no change', applyOps(d, [], { newId, busy: false }).next === null && applyOps(d, 'nope', { newId, busy: false }).changes.length === 0);
}

// ── the kept conversation ─────────────────────────────────────────────────
{
  const turns = Array.from({ length: CHAT_KEEP }, (_, i) => ({ role: 'you', text: String(i), at: i }));
  const kept = keptChat(turns, [{ role: 'model', text: 'new', at: 999 }]);
  ok('the conversation keeps its newest turns', kept.length === CHAT_KEEP && kept.at(-1).text === 'new' && kept[0].text === '1');
  ok('an empty history takes new turns', keptChat(undefined, [{ role: 'you', text: 'a', at: 1 }]).length === 1);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
