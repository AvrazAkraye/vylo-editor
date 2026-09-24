// The run that writes a research document: plan, sources, outline, sections, abstract.
//
// What matters is what survives. A dissertation is forty paid calls, so a run
// that fails at chapter four must keep chapters one to three, carry on from
// four and not rewrite the rest; one that is stopped must put the section it
// was writing back the way it was and say it was stopped, not failed. And the
// text that is kept must never point at a record that is not there: a marker
// for an unknown key is taken out before the section is stored. The one source
// the model may name itself is legislation, and it is added once, unverified,
// with the next free key, never over one the document already has. The search
// services are sent the plan's queries and nothing else — never the request,
// which is the researcher's own words. Several writers at once really overlap,
// start parts in outline order, and write into one document, so no part one
// of them finished is ever lost to another finishing in the same tick. What the
// panel is told comes as codes and fixed sentences it can translate, and a
// stream the transport starts again is shown from its new start, not after the
// broken one. Everything here runs against stub deps — the run itself never
// touches a network. The laws, names and text below are invented.
import {
  EMPTY_SECTION, UNREADABLE_ABSTRACT, UNREADABLE_OUTLINE,
  cleanSection, highestKey, jsonIn, parseAbstract, parseOutline, parseScreen, parsePlan, redoAbstract, rewrite, run,
} from '../.test-build/researchrun.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── fixtures ──────────────────────────────────────────────────────────────

const META = {
  title: '', titleEn: '', author: '', presented: '', supervisor: '', supervisorTitle: '', authority: '', university: '',
  college: '', department: '', field: '', venue: '', city: '', year: '2026',
};

function makeDoc(over = {}) {
  return {
    id: 'd1', v: 1, created: 1000, updated: 1000,
    request: 'أريد بحث علمي عن أثر الذكاء الاصطناعي في التعليم الجامعي',
    kind: 'article', lang: 'ar', style: 'apa', length: 'standard',
    notes: '', queries: [], sources: [], sections: [], abstract: '', abstractEn: '',
    keywords: [], keywordsEn: [], stage: 'new', pause: false,
    ...over,
    meta: { ...META, ...(over.meta ?? {}) },
  };
}

const src = (key, title, extra = {}) => ({
  key, title, authors: [{ family: 'Smith', given: 'Jane' }], year: 2020, type: 'article',
  origin: 'openalex', verified: true, use: true, ...extra,
});

const sec = (heading, over = {}) => ({
  id: 'x-' + heading, level: 1, heading, brief: '', words: 600, sources: [], text: '', state: 'waiting', ...over,
});

/** Which request a call is, read from its prompt. */
function what(o) {
  if (o.user.includes('ran out of room')) return 'continue';
  if (o.user.includes('WRITE THIS ONE')) return 'section';
  if (o.user.includes('Plan the outline')) return 'outline';
  if (o.user.includes('Write the abstract')) return 'abstract';
  if (o.user.includes('"queries"')) return 'plan';
  if (o.user.includes('"keep"')) return 'screen';
  return '?';
}
const headingOf = (o) => (/Write the part marked "WRITE THIS ONE": "(.*)"\./.exec(o.user) ?? [])[1];

/**
 * Stub deps. `reply(o, n)` answers each model call — a string, `{ text, stop }`,
 * or it throws. The text is streamed in two halves through `onText`, the way a
 * real stream arrives in pieces. `{ restart: '…' }` streams that first, then
 * fires `onRestart` the way the transport does after a broken stream, then
 * streams the answer from its start.
 */
function harness(reply, searchImpl) {
  const calls = [], saves = [], changes = [], searches = [];
  let clock = 2000, ids = 0;
  const deps = {
    async generate(o) {
      calls.push(o);
      const r = await reply(o, calls.length - 1);
      const text = typeof r === 'string' ? r : r.text;
      if (typeof r === 'object' && r.restart && o.onText) {
        o.onText(r.restart);
        o.onRestart?.();
      }
      if (o.onText && text) {
        const h = Math.ceil(text.length / 2);
        o.onText(text.slice(0, h));
        o.onText(text.slice(h));
      }
      return { text, stopReason: typeof r === 'string' ? 'end_turn' : (r.stop ?? 'end_turn') };
    },
    async search(queries, want, signal) {
      searches.push({ queries, want, signal });
      return searchImpl ? searchImpl(queries, want) : { sources: [], failed: 0 };
    },
    save(doc) { saves.push(doc); },
    now() { return ++clock; },
    newId() { return 'id' + ++ids; },
  };
  const onChange = (doc, p) => changes.push({ doc, p });
  return { deps, calls, saves, changes, searches, onChange, clock: () => clock, ids: () => ids };
}

const PLAN = [
  'Here is the plan you asked for:',
  '```json',
  JSON.stringify({
    title: 'أثر الذكاء الاصطناعي في التعليم الجامعي',
    titleEn: 'The impact of artificial intelligence on university education',
    field: 'تقنيات التعليم',
    keywords: ['الذكاء الاصطناعي', 'التعليم الجامعي'],
    keywordsEn: ['artificial intelligence', 'higher education'],
    queries: ['artificial intelligence higher education', 'AI university teaching', 'الذكاء الاصطناعي التعليم الجامعي'],
  }, null, 2),
  '```',
  'I hope this helps {and good luck}.',
].join('\n');

const OUTLINE = JSON.stringify({
  sections: [
    { level: 1, heading: 'المقدمة', brief: 'السياق والمشكلة', words: 1500, sources: ['s1', 's2', 's99'] },
    { level: 1, heading: 'الإطار النظري', brief: '', words: 0, sources: [] },
    { level: 2, heading: 'مفهوم الذكاء الاصطناعي', brief: 'التعريفات', words: 2000, sources: ['s2'] },
    { level: 2, heading: 'تطبيقاته في التعليم', brief: 'الأمثلة', words: 2000, sources: ['s3'] },
    { level: 1, heading: 'الخاتمة', brief: '', words: 1500, sources: [] },
  ],
});

const INTRO_RAW = '# المقدمة\n\nيشهد التعليم الجامعي تحولاً واسعاً [@s1]. وتؤكد الدراسات ذلك [@s2; @s42].\n\n## خلفية\n\nنص الخلفية.';
const INTRO_CLEAN = 'يشهد التعليم الجامعي تحولاً واسعاً [@s1]. وتؤكد الدراسات ذلك [@s2].\n\n### خلفية\n\nنص الخلفية.';
const ABSTRACT = '{"abstract": "ملخص البحث في فقرة واحدة.", "abstractEn": "The abstract in English."}';

/** A model that answers every request the happy way. */
function happy(o) {
  const k = what(o);
  if (k === 'plan') return PLAN;
  // Keeps every work it is shown: the screen's own behaviour is tested on its own below.
  if (k === 'screen') return JSON.stringify({ keep: [...o.user.matchAll(/\[@(s\d+)\]/g)].map((m) => m[1]) });
  if (k === 'outline') return OUTLINE;
  if (k === 'abstract') return ABSTRACT;
  if (k === 'section') return headingOf(o) === 'المقدمة' ? INTRO_RAW : `نص القسم ${headingOf(o)} [@s3].`;
  throw new Error('unexpected call: ' + k);
}

/** A search that finds two new works and one the researcher already added (same DOI, other case). */
const FOUND = () => ({
  sources: [
    src('s1', 'AI in higher education', { doi: '10.1000/aaa' }),
    src('s2', 'Chatbots and learning', { doi: '10.1000/bbb' }),
    src('', 'The researcher’s own record, found again', { doi: '10.1000/PPP' }),
  ],
  failed: 0,
});
const PERSON = src('s1', 'The researcher’s own record', { doi: '10.1000/ppp', origin: 'person', verified: false });

const tokensAr = (w) => Math.round(Math.max(400, w) * 3.2) + 8000;
const tokensEn = (w) => Math.round(Math.max(400, w) * 1.6) + 8000;

// ── the happy path, from a request to a document ──────────────────────────
{
  const h = harness(happy, FOUND);
  const start = makeDoc({ sources: [PERSON] });
  const done = await run(start, h.deps, { onChange: h.onChange });
  const kinds = h.calls.map(what);

  ok('the calls come in order: plan, the screen of what was found, outline, each section, abstract',
    same(kinds, ['plan', 'screen', 'outline', 'section', 'section', 'section', 'section', 'abstract']), kinds);
  ok('the sections are written in outline order, the empty parent heading skipped',
    same(h.calls.filter((o) => what(o) === 'section').map(headingOf), ['المقدمة', 'مفهوم الذكاء الاصطناعي', 'تطبيقاته في التعليم', 'الخاتمة']));
  ok('every call carries the rules and the language', h.calls.every((o) => o.system.includes('Rules that are never broken') && o.system.includes('Arabic')));
  ok('the plan prompt carries the request', h.calls[0].user.includes(start.request));
  ok('the outline prompt carries the planned title and the sources by marker',
    h.calls[2].user.includes('أثر الذكاء الاصطناعي في التعليم الجامعي') && h.calls[2].user.includes('[@s2] Smith (2020). AI in higher education'));
  ok('the screen is shown only the works this search found, with what they say',
    h.calls[1].user.includes('[@s2] Smith (2020). AI in higher education') && h.calls[1].user.includes('[@s3]') && !h.calls[1].user.includes('[@s1]'));
  ok('a section prompt asks for its own heading and the length', h.calls[3].user.includes('"المقدمة"') && h.calls[3].user.includes('about 1,500 words'));
  ok('a section is given room by its words and language', h.calls[3].maxTokens === tokensAr(1500) && h.calls[4].maxTokens === tokensAr(2000), [h.calls[3].maxTokens, h.calls[4].maxTokens]);
  ok('the section after a written one gets its ending, for continuity',
    h.calls[4].user.includes('The end of the part before it') && h.calls[4].user.includes('نص الخلفية.'));
  ok('the first section has no part before it', !h.calls[3].user.includes('The end of the part before it'));
  ok('a section leans on its own sources, with what they say', h.calls[4].user.includes('Sources this part should draw on') && h.calls[4].user.includes('[@s2]'));
  ok('the abstract is asked for in both languages for an Arabic article', h.calls[7].user.includes('Then the same abstract in English'));
  ok('every call is streamed only where a section is written',
    h.calls.every((o) => (what(o) === 'section') === (typeof o.onText === 'function')));
  ok('a streamed call, and only a streamed one, can be told the transport started again',
    h.calls.every((o) => (typeof o.onText === 'function') === (typeof o.onRestart === 'function')));

  ok('the search is given the planned queries and the kind’s number of sources',
    h.searches.length === 1 && same(h.searches[0].queries, ['artificial intelligence higher education', 'AI university teaching', 'الذكاء الاصطناعي التعليم الجامعي']) && h.searches[0].want === 30,
    h.searches);

  ok('it ends done', done.stage === 'done');
  ok('with the planned title, English title and field', done.meta.title === 'أثر الذكاء الاصطناعي في التعليم الجامعي'
    && done.meta.titleEn === 'The impact of artificial intelligence on university education' && done.meta.field === 'تقنيات التعليم');
  ok('and the keywords and queries', same(done.keywords, ['الذكاء الاصطناعي', 'التعليم الجامعي']) && same(done.keywordsEn, ['artificial intelligence', 'higher education']) && done.queries.length === 3);
  ok('the researcher’s source is kept first, as it was', done.sources[0] === PERSON);
  ok('found sources continue the keys, whatever keys the search gave them',
    same(done.sources.map((s) => s.key), ['s1', 's2', 's3']) && done.sources[1].title === 'AI in higher education' && done.sources[2].title === 'Chatbots and learning');
  ok('a found work with the DOI of one already there is not added twice', !done.sources.some((s) => s.title.includes('found again')));
  ok('a plan that names no legislation adds none', !done.sources.some((s) => s.origin === 'model' || s.type === 'law'));
  ok('the outline became five sections with ids from newId', same(done.sections.map((s) => s.id), ['id1', 'id2', 'id3', 'id4', 'id5']));
  ok('an outline source that does not exist is dropped', same(done.sections[0].sources, ['s1', 's2']));
  ok('every section is done', done.sections.every((s) => s.state === 'done'));
  ok('the empty parent heading is done with no text', done.sections[1].text === '' && done.sections[1].words === 0);
  ok('a section is stored cleaned: heading gone, top heading demoted, unknown marker out', done.sections[0].text === INTRO_CLEAN, done.sections[0].text);
  ok('the abstract and the English abstract are kept', done.abstract === 'ملخص البحث في فقرة واحدة.' && done.abstractEn === 'The abstract in English.');
  ok('no error', !('error' in done));
  ok('updated is the clock at the last change', done.updated === h.clock());
  ok('the last thing saved is what is returned', h.saves[h.saves.length - 1] === done);
  ok('it saved after every step and section', h.saves.length >= 10, h.saves.length);
  ok('the first save is the plan starting', h.saves[0].stage === 'planning');
  ok('the document it was given is not changed', start.stage === 'new' && start.sections.length === 0 && start.sources.length === 1 && start.meta.title === '');

  const stages = h.changes.map((c) => c.p.stage).filter((s, i, all) => s !== all[i - 1]);
  ok('the panel sees the stages advance', same(stages, ['planning', 'sources', 'outline', 'writing', 'abstract', 'done']), stages);
  const streaming = h.changes.filter((c) => c.p.index === 0 && c.p.live);
  ok('the panel sees a section’s text as it streams', streaming.length >= 2 && INTRO_RAW.startsWith(streaming[0].p.live) && streaming[streaming.length - 1].p.live === INTRO_RAW);
  ok('while it streams the section is writing', streaming.every((c) => c.doc.sections[0].state === 'writing'));
  ok('the transient writing state is not saved', !h.saves.some((d) => d.sections.some((s) => s.state === 'writing')));
  ok('a run with nothing to say has no note', h.changes.every((c) => !('note' in c.p)));

  globalThis.DONE = done;
}
const DONE = globalThis.DONE;

// ── what the researcher already chose stays ───────────────────────────────
{
  const h = harness(happy, FOUND);
  const doc = makeDoc({ meta: { title: 'عنوان اختاره الباحث' }, keywords: ['كلمة'] });
  const out = await run(doc, h.deps, { stopBefore: 'writing' });
  ok('the plan prompt is told the chosen title', h.calls[0].user.includes('They have already chosen the title: عنوان اختاره الباحث'));
  ok('a title the researcher typed is not replaced', out.meta.title === 'عنوان اختاره الباحث');
  ok('an empty field is filled from the plan', out.meta.field === 'تقنيات التعليم');
  ok('keywords the researcher typed are kept', same(out.keywords, ['كلمة']));
}

// ── pause before writing, then carry on ───────────────────────────────────
{
  const h = harness(happy, FOUND);
  const paused = await run(makeDoc(), h.deps, { stopBefore: 'writing' });
  ok('a paused run stops at writing', paused.stage === 'writing');
  ok('with only the plan, the screen and the outline asked for', same(h.calls.map(what), ['plan', 'screen', 'outline']));
  ok('and nothing written', paused.sections.length === 5 && paused.sections.every((s) => s.state === 'waiting' && s.text === ''));
  ok('the paused document was saved', h.saves[h.saves.length - 1] === paused);

  const again = harness(happy);
  const same1 = await run(paused, again.deps, { stopBefore: 'writing' });
  ok('asked to stop before writing again, it does nothing', again.calls.length === 0 && same1.stage === 'writing');

  const h2 = harness(happy);
  const done = await run(paused, h2.deps);
  ok('carrying on writes the sections and the abstract, and plans nothing again',
    same(h2.calls.map(what), ['section', 'section', 'section', 'section', 'abstract']) && h2.searches.length === 0);
  ok('and ends done', done.stage === 'done' && done.sections.every((s) => s.state === 'done'));
}

// ── a failure keeps what was written, and the run carries on from it ─────
{
  const h = harness((o) => {
    if (what(o) === 'section' && headingOf(o) === 'تطبيقاته في التعليم') throw new Error('overloaded_error');
    return happy(o);
  }, FOUND);
  const failed = await run(makeDoc(), h.deps);
  ok('a section that errors ends the run at writing', failed.stage === 'writing');
  ok('it is marked failed, with why', failed.sections[3].state === 'failed' && failed.sections[3].error === 'overloaded_error');
  ok('the document says why too', failed.error === 'overloaded_error');
  ok('what was written before it is kept', failed.sections[0].state === 'done' && failed.sections[2].state === 'done' && failed.sections[2].text !== '');
  ok('nothing after it is attempted', failed.sections[4].state === 'waiting'
    && !h.calls.some((o) => headingOf(o) === 'الخاتمة') && !h.calls.some((o) => what(o) === 'abstract'));
  ok('the failure was saved', h.saves[h.saves.length - 1] === failed);

  const h2 = harness(happy);
  const done = await run(failed, h2.deps);
  ok('resuming writes only the failed section and the ones after it',
    same(h2.calls.filter((o) => what(o) === 'section').map(headingOf), ['تطبيقاته في التعليم', 'الخاتمة']), h2.calls.map(headingOf));
  ok('then the abstract', same(h2.calls.map(what), ['section', 'section', 'abstract']));
  ok('the earlier sections are untouched', done.sections[0] === failed.sections[0] && done.sections[2] === failed.sections[2]);
  ok('the failed section is done and its error gone', done.sections[3].state === 'done' && !('error' in done.sections[3]));
  ok('the document’s error is gone', done.stage === 'done' && !('error' in done));
}

// ── a section left "writing" by a run that never finished ─────────────────
{
  const doc = makeDoc({ stage: 'writing', kind: 'proposal', sections: [sec('المقدمة', { state: 'writing' })] });
  const h = harness(happy);
  const out = await run(doc, h.deps);
  ok('is written again', h.calls.length === 1 && out.sections[0].state === 'done');
}

// ── stopping ──────────────────────────────────────────────────────────────
{
  const h0 = harness(happy, FOUND);
  const paused = await run(makeDoc(), h0.deps, { stopBefore: 'writing' });
  const ctl = new AbortController();
  const h = harness(async (o) => {
    if (what(o) === 'section' && headingOf(o) === 'مفهوم الذكاء الاصطناعي') {
      o.onText('نص جزئي');
      ctl.abort();
      throw new DOMException('The operation was aborted.', 'AbortError');
    }
    return happy(o);
  });
  let caught = null;
  try { await run(paused, h.deps, { signal: ctl.signal, onChange: h.onChange }); } catch (e) { caught = e; }
  ok('a stopped run rejects with an AbortError', caught?.name === 'AbortError');
  const last = h.saves[h.saves.length - 1];
  ok('the section being written goes back to waiting', last.sections[2].state === 'waiting' && last.sections[2].text === '');
  ok('what was finished before it is saved', last.sections[0].state === 'done' && last.sections[0].text === INTRO_CLEAN);
  ok('the stop is not a failure', !('error' in last) && last.stage === 'writing');
  ok('the panel saw the half-written text before the stop',
    h.changes.some((c) => c.p.index === 2 && c.p.live === 'نص جزئي' && c.doc.sections[2].state === 'writing'));
  ok('and its last view is the section waiting again', h.changes[h.changes.length - 1].doc.sections[2].state === 'waiting');
  ok('nothing is asked after the stop', h.calls.length === 2);
  ok('the signal reaches the model', h.calls.every((o) => o.signal === ctl.signal));
}
{
  // A transport torn down mid-stream can reject with whatever it was doing.
  const ctl = new AbortController();
  const h = harness(() => { ctl.abort(); throw new TypeError('network connection was lost'); });
  const doc = makeDoc({ stage: 'writing', sections: [sec('المقدمة')] });
  let caught = null;
  try { await run(doc, h.deps, { signal: ctl.signal }); } catch (e) { caught = e; }
  ok('any error while the signal is aborted is a stop, and rejects as an AbortError', caught?.name === 'AbortError');
  ok('and the section is not marked failed', h.saves[h.saves.length - 1].sections[0].state === 'waiting');
}
{
  const ctl = new AbortController();
  ctl.abort();
  const h = harness(happy, FOUND);
  let caught = null;
  try { await run(makeDoc(), h.deps, { signal: ctl.signal }); } catch (e) { caught = e; }
  ok('an already-stopped signal asks nothing at all', caught?.name === 'AbortError' && h.calls.length === 0 && h.searches.length === 0);
}
{
  const ctl = new AbortController();
  const h = harness(happy, () => { ctl.abort(); throw new DOMException('aborted', 'AbortError'); });
  let caught = null;
  try { await run(makeDoc(), h.deps, { signal: ctl.signal }); } catch (e) { caught = e; }
  ok('a stop during the search is a stop, not a failed search', caught?.name === 'AbortError' && !h.calls.some((o) => what(o) === 'outline'));
}

// ── a section that runs out of room is continued ─────────────────────────
{
  const doc = makeDoc({
    kind: 'working-paper', lang: 'en', stage: 'writing', request: 'a working paper on AI in schools',
    sections: [sec('Introduction', { words: 500 })],
  });
  const h = harness((o) => {
    const k = what(o);
    if (k === 'section') return { text: 'First paragraph.\n\nThe second paragraph considers the impact of artif', stop: 'max_tokens' };
    if (k === 'continue') return 'artificial intelligence on learning.';
    throw new Error(k);
  });
  const out = await run(doc, h.deps, { onChange: h.onChange });
  ok('a max_tokens stop is followed by a continuation', same(h.calls.map(what), ['section', 'continue']), h.calls.map(what));
  ok('the continuation is told where the text ends', h.calls[1].user.includes('considers the impact of'));
  ok('cut back to a whole word, so the model never finishes half a one', !h.calls[1].user.includes('of artif'));
  ok('the continuation has the section’s room', h.calls[1].maxTokens === tokensEn(500));
  ok('and the two are joined into one text', out.sections[0].text === 'First paragraph.\n\nThe second paragraph considers the impact of artificial intelligence on learning.', out.sections[0].text);
  ok('the panel sees the continuation stream onto the text so far',
    h.changes.some((c) => c.p.index === 0 && c.p.live?.startsWith('First paragraph.') && c.p.live.includes('artificial')));
  ok('a working paper has no abstract, so none is asked for', out.stage === 'done' && out.abstract === '' && out.abstractEn === '');
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', sections: [sec('Introduction')] });
  let n = 0;
  const h = harness((o) => ({ text: `Part ${++n} of the text.`, stop: 'max_tokens' }));
  const out = await run(doc, h.deps);
  ok('at most two continuations, then what there is is kept',
    h.calls.length === 3 && out.sections[0].state === 'done' && out.sections[0].text === 'Part 1 of the text. Part 2 of the text. Part 3 of the text.', out.sections[0].text);
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', sections: [sec('Method')] });
  const h = harness((o) => what(o) === 'section'
    ? { text: 'Schools changed quickly after the pandemic in rural areas.', stop: 'max_tokens' }
    : 'after the pandemic in rural areas. Teachers adapted.');
  const out = await run(doc, h.deps);
  ok('a continuation that repeats the last words has the repeat dropped',
    out.sections[0].text === 'Schools changed quickly after the pandemic in rural areas. Teachers adapted.', out.sections[0].text);
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', sections: [sec('Method')] });
  const h = harness((o) => what(o) === 'section'
    ? { text: 'The first paragraph ends here.\n\n', stop: 'max_tokens' }
    : 'The second paragraph begins.');
  const out = await run(doc, h.deps);
  ok('a continuation after a paragraph break starts a new paragraph',
    out.sections[0].text === 'The first paragraph ends here.\n\nThe second paragraph begins.', out.sections[0].text);
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'ar', stage: 'writing', sections: [sec('المنهج')] });
  const h = harness((o) => what(o) === 'section'
    ? { text: 'تعتمد الدراسة على المنهج الوصفي التحليلي', stop: 'max_tokens' }
    : 'التحليلي، لأنه يناسب طبيعة المشكلة.');
  const out = await run(doc, h.deps);
  ok('an Arabic section is continued from its last whole word',
    h.calls[1].user.includes('المنهج الوصفي \n\nContinue exactly') && !h.calls[1].user.includes('التحليلي\n\nContinue'), h.calls[1].user.slice(-200));
  ok('and joined without a split or a doubled word',
    out.sections[0].text === 'تعتمد الدراسة على المنهج الوصفي التحليلي، لأنه يناسب طبيعة المشكلة.', out.sections[0].text);
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', sections: [sec('Method'), sec('Scope')] });
  const h = harness(() => '```\n\n```');
  const out = await run(doc, h.deps);
  ok('a section that comes back empty is failed, not done', out.sections[0].state === 'failed' && !!out.error && h.calls.length === 1);
  ok('the section and the document say so in the fixed sentence the panel translates',
    out.sections[0].error === EMPTY_SECTION && out.error === EMPTY_SECTION);
}

// ── a pause finishes the parts in hand and starts no more ─────────────────
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 2,
    sections: [sec('One'), sec('Two'), sec('Three'), sec('Four'), sec('Five')] });
  let pause = false;
  // The pause is asked for while the first two parts are being written.
  const h = harness((o, n) => { if (n === 1) pause = true; return `The text of ${headingOf(o)}.`; });
  const out = await run(doc, h.deps, { paused: () => pause });
  const done = out.sections.filter((x) => x.state === 'done').map((x) => x.heading);
  ok('a pause lets the writers finish the parts they have', done.join() === 'One,Two', done.join());
  ok('and starts no new one', h.calls.length === 2 && out.sections.slice(2).every((x) => x.state === 'waiting'));
  ok('the document stays in writing, with no error, for a resume', out.stage === 'writing' && out.error === undefined);
  pause = false;
  const h2 = harness((o) => (what(o) === 'abstract' ? '{"abstract":"A.","keywords":["a"]}' : `The text of ${headingOf(o)}.`));
  const after = await run(out, h2.deps, { paused: () => pause });
  ok('a resume writes only what is left, and finishes', after.sections.every((x) => x.state === 'done')
    && h2.calls.filter((o) => what(o) === 'section').length === 3 && after.stage !== 'writing', after.stage);
}
{
  const h = harness((o) => (what(o) === 'plan' ? PLAN : '?'));
  const out = await run(makeDoc({ stage: 'new' }), h.deps, { paused: () => true });
  ok('paused while planning, the run ends after the plan', out.stage === 'sources' && h.searches.length === 0 && h.calls.length === 1, out.stage);
}

// ── a stream the transport starts again ───────────────────────────────────
{
  const doc = makeDoc({ kind: 'proposal', stage: 'writing', sections: [sec('المقدمة')] });
  const h = harness(() => ({ text: 'النص الكامل للمقدمة.', restart: 'نص مقطوع من المحاولة الأولى' }));
  const out = await run(doc, h.deps, { onChange: h.onChange });
  const lives = h.changes.filter((c) => c.p.index === 0 && typeof c.p.live === 'string').map((c) => c.p.live);
  const broke = lives.indexOf('نص مقطوع من المحاولة الأولى');
  ok('the panel saw the first attempt while it streamed', broke !== -1, lives);
  ok('a restart clears what the panel shows of the section', lives[broke + 1] === '', lives);
  ok('nothing shown after it carries the first attempt', lives.slice(broke + 1).every((l) => !l.includes('مقطوع')), lives);
  ok('the second attempt streams from its own start', lives[lives.length - 1] === 'النص الكامل للمقدمة.', lives);
  ok('what is stored is the second attempt alone', out.sections[0].text === 'النص الكامل للمقدمة.' && out.sections[0].state === 'done');
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', sections: [sec('Method')] });
  const h = harness((o) => (what(o) === 'section'
    ? { text: 'The first part ends here. ', stop: 'max_tokens' }
    : { text: 'The second part follows.', restart: 'A garbled half' }));
  const out = await run(doc, h.deps, { onChange: h.onChange });
  const lives = h.changes.filter((c) => c.p.index === 0 && typeof c.p.live === 'string').map((c) => c.p.live);
  const broke = lives.indexOf('The first part ends here. A garbled half');
  ok('a continuation’s first attempt streams onto the text so far', broke !== -1, lives);
  ok('its restart goes back to the text before it, which was kept', lives[broke + 1] === 'The first part ends here. ', lives);
  ok('and the continuation streams onto that again, without the broken half',
    lives.slice(broke + 1).every((l) => !l.includes('garbled')) && lives[lives.length - 1] === 'The first part ends here. The second part follows.', lives);
  ok('the continuation is stored joined once', out.sections[0].text === 'The first part ends here. The second part follows.', out.sections[0].text);
  ok('a continuation can be restarted too', typeof h.calls[1].onRestart === 'function');
}

// ── several writers at once ───────────────────────────────────────────────
// The researcher sets how many writers work at once. What matters: the calls
// really overlap, as many as there are writers or parts left; parts are
// started in outline order; every writer writes into the one document as it
// is when it finishes, so no part a writer finished is ever lost to another;
// a failure starts nothing new but keeps what is in hand; a stop puts every
// part in hand back once. Titles and text are invented.

let unhandled = 0;
process.on('unhandledRejection', () => { unhandled++; });
const flush = () => new Promise((r) => setTimeout(r, 0));
const PARALLEL = 'being written at the same time';
const PREVIOUS = 'The end of the part before it';

/**
 * Stub deps whose model calls wait to be answered, so a test decides when each
 * one finishes and in what order. `pending` is every call started and not yet
 * answered — the calls in flight. `answer` streams a reply in two halves and
 * resolves the call; `fail` rejects it. `log` has every save and every view in
 * the order they happened.
 */
function gated() {
  const h = harness(() => { throw new Error('not used'); });
  const pending = [];
  const log = [];
  let most = 0;
  h.deps.generate = (o) => new Promise((resolve, reject) => {
    h.calls.push(o);
    pending.push({ o, resolve, reject });
    most = Math.max(most, pending.length);
  });
  const save = h.deps.save;
  h.deps.save = (doc) => { log.push({ saved: doc }); save(doc); };
  const onChange = (doc, p) => { log.push({ doc, p }); h.onChange(doc, p); };
  const take = (p) => pending.splice(pending.indexOf(p), 1);
  return {
    ...h, onChange, pending, log, most: () => most,
    call: (heading) => pending.find((p) => headingOf(p.o) === heading),
    answer(p, text, stop = 'end_turn') {
      take(p);
      const half = Math.ceil(text.length / 2);
      p.o.onText?.(text.slice(0, half));
      p.o.onText?.(text.slice(half));
      p.resolve({ text, stopReason: stop });
    },
    fail(p, e) { take(p); p.reject(e); },
  };
}

/** Whether every part done in one save is done, with the same text, in every save after it. */
function neverLost(saves) {
  return saves.every((d, k) => k === 0 || saves[k - 1].sections.every((s, j) =>
    s.state !== 'done' || (d.sections[j].state === 'done' && d.sections[j].text === s.text)));
}

/** Whether every view shows every part the last save before it had done. */
function viewsKeepUp(log) {
  let saved = null;
  return log.every((e) => {
    if (e.saved) { saved = e.saved; return true; }
    return !saved || saved.sections.every((s, j) => s.state !== 'done' || (e.doc.sections[j].state === 'done' && e.doc.sections[j].text === s.text));
  });
}

{
  const doc = makeDoc({
    kind: 'proposal', lang: 'en', stage: 'writing', agents: 3, request: 'a research proposal on invented tides',
    sections: [
      sec('Introduction', { words: 400 }),
      sec('Part one', { words: 0 }),
      sec('First strand', { level: 2, words: 500 }),
      sec('Second strand', { level: 2, words: 500 }),
      sec('Your data', { state: 'author', text: 'The researcher’s own paragraph.' }),
      sec('Third strand'),
      sec('Fourth strand'),
      sec('Conclusion', { words: 400 }),
    ],
  });
  const g = gated();
  const going = run(doc, g.deps, { onChange: g.onChange });
  const toWrite = 6;
  const flights = [];
  const finished = [];
  await flush();
  while (g.pending.length) {
    flights.push([g.pending.length, Math.min(3, toWrite - finished.length)]);
    // The newest call is answered first, so parts finish out of outline order.
    const p = g.pending[g.pending.length - 1];
    finished.push(headingOf(p.o));
    g.answer(p, `The text of ${headingOf(p.o)}, in full.`);
    await flush();
  }
  const done = await going;
  const byHeading = (hd) => g.calls.find((o) => headingOf(o) === hd).user;

  ok('three writers: three calls are in flight at once', g.most() === 3, g.most());
  ok('at every moment, as many calls are in flight as there are writers or parts left', flights.every(([a, b]) => a === b), flights);
  ok('parts are started in outline order, the empty heading and the researcher’s part skipped',
    same(g.calls.map(headingOf), ['Introduction', 'First strand', 'Second strand', 'Third strand', 'Fourth strand', 'Conclusion']), g.calls.map(headingOf));
  ok('… and here finished out of it', same(finished, ['Second strand', 'Third strand', 'Fourth strand', 'Conclusion', 'First strand', 'Introduction']), finished);
  ok('every request says other parts are being written at the same time', g.calls.every((o) => o.user.includes(PARALLEL)));
  ok('a part whose part before is still being written is handed no ending',
    !byHeading('Introduction').includes(PREVIOUS) && !byHeading('First strand').includes(PREVIOUS) && !byHeading('Second strand').includes(PREVIOUS));
  ok('a part whose part before has text is handed its end',
    byHeading('Third strand').includes(`${PREVIOUS}, for continuity (do not repeat it):\n…The researcher’s own paragraph.`)
    && byHeading('Fourth strand').includes('…The text of Third strand, in full.') && byHeading('Conclusion').includes('…The text of Fourth strand, in full.'));

  ok('every part is in the document', done.stage === 'done'
    && done.sections.every((s, j) => j === 1 ? s.state === 'done' && s.text === '' : j === 4 ? s === doc.sections[4] : s.state === 'done' && s.text === `The text of ${s.heading}, in full.`),
    done.sections.map((s) => [s.state, s.text]));
  ok('no save ever loses a part another writer finished', neverLost(g.saves));
  ok('no view does either', viewsKeepUp(g.log));
  ok('no save says a part is being written', !g.saves.some((d) => d.sections.some((s) => s.state === 'writing')));
  ok('the last thing saved is what is returned', g.saves[g.saves.length - 1] === done);

  const busy = g.changes.filter((c) => c.p.writers?.length);
  const agentAt = {};
  for (const c of busy) for (const w of c.p.writers) agentAt[w.index] ??= w.agent;
  ok('each part is written by one numbered writer; a free writer takes the next part',
    same(agentAt, { 0: 1, 2: 2, 3: 3, 5: 3, 6: 3, 7: 3 }), agentAt);
  ok('the panel is told every part being written, in outline order',
    busy.some((c) => same(c.p.writers.map((w) => [w.agent, w.index]), [[1, 0], [2, 2], [3, 3]]))
    && busy.every((c) => c.p.writers.every((w, k) => k === 0 || c.p.writers[k - 1].index < w.index)));
  ok('… each shown as writing in the document it is sent', busy.every((c) => c.p.writers.every((w) => c.doc.sections[w.index].state === 'writing')));
  ok('… index and live are the first writer’s, as a one-part panel expects',
    busy.every((c) => c.p.index === c.p.writers[0].index && c.p.live === c.p.writers[0].live));
  ok('… and a later writer’s streamed text is told too',
    busy.some((c) => c.p.writers[0].index === 0 && c.p.writers.some((w) => w.index === 3 && w.live === 'The text of Second strand, in full.')));
  ok('between parts, the panel is told no writer is at work', same(g.changes.filter((c) => c.p.stage === 'writing').pop().p.writers, []));
}

// ── two writers finishing in the same tick ────────────────────────────────
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 2, sections: [sec('Alpha'), sec('Beta')] });
  const g = gated();
  const going = run(doc, g.deps, { onChange: g.onChange });
  await flush();
  const [a, b] = g.pending.slice();
  // Both answered before either writer takes its next step.
  g.answer(b, 'Beta was written.');
  g.answer(a, 'Alpha was written.');
  const done = await going;
  ok('two writers finishing in the same tick: both parts are in the document',
    done.sections[0].text === 'Alpha was written.' && done.sections[1].text === 'Beta was written.' && done.stage === 'done');
  ok('… and the save after the second holds the first',
    same(g.saves.map((d) => d.sections.filter((s) => s.state === 'done').map((s) => s.heading)), [['Beta'], ['Alpha', 'Beta'], ['Alpha', 'Beta'], ['Alpha', 'Beta']]),
    g.saves.map((d) => d.sections.map((s) => s.state)));
  ok('… each save touched the document', g.saves.every((d, k) => k === 0 || d.updated > g.saves[k - 1].updated));
}

// ── a restart clears one writer's text ────────────────────────────────────
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 2, sections: [sec('Alpha'), sec('Beta')] });
  const g = gated();
  const going = run(doc, g.deps, { onChange: g.onChange });
  await flush();
  const [a, b] = g.pending.slice();
  a.o.onText('Alpha so far');
  b.o.onText('A broken start');
  b.o.onRestart();
  const last = g.changes[g.changes.length - 1].p;
  ok('a restart clears only its own writer’s text',
    same(last.writers, [{ agent: 1, index: 0, live: 'Alpha so far' }, { agent: 2, index: 1, live: '' }]), last.writers);
  ok('… and index and live are still the first writer’s', last.index === 0 && last.live === 'Alpha so far');
  g.answer(b, 'Beta whole.');
  g.answer(a, 'Alpha whole.');
  const done = await going;
  ok('… and what is stored is each writer’s answer alone', done.sections[0].text === 'Alpha whole.' && done.sections[1].text === 'Beta whole.');
}

// ── the parallel request, and the number of writers ───────────────────────
{
  const three = (agents) => makeDoc({
    kind: 'proposal', lang: 'en', stage: 'writing', ...(agents === undefined ? {} : { agents }), sections: [sec('Alpha'), sec('Beta'), sec('Gamma')],
  });
  const reply = (o) => (what(o) === 'continue' ? 'the argument, and ends.'
    : headingOf(o) === 'Alpha' ? { text: 'Alpha stops in the middle of the', stop: 'max_tokens' } : 'The rest of it.');
  for (const agents of [undefined, 1]) {
    const h = harness(reply);
    const out = await run(three(agents), h.deps);
    ok(`one writer (agents ${agents}): no request says others write at once`,
      same(h.calls.map(what), ['section', 'continue', 'section', 'section']) && h.calls.every((o) => !o.user.includes(PARALLEL)) && out.stage === 'done');
  }
  const h = harness(reply);
  const out = await run(three(2), h.deps);
  ok('two writers: every request says so, the continuation included',
    h.calls.length === 4 && h.calls.some((o) => what(o) === 'continue') && h.calls.every((o) => o.user.includes(PARALLEL)) && out.stage === 'done');
  ok('… and the part that ran out of room is continued and joined as before',
    out.sections[0].text === 'Alpha stops in the middle of the argument, and ends.', out.sections[0].text);

  const one = gated();
  const going1 = run(three(undefined), one.deps);
  await flush();
  while (one.pending.length) { one.answer(one.pending[0], `${headingOf(one.pending[0].o)} was written.`); await flush(); }
  await going1;
  ok('one writer: one call at a time, each part handed the end of the one before',
    one.most() === 1 && one.calls[1].user.includes('…Alpha was written.') && one.calls[2].user.includes('…Beta was written.'));

  const many = gated();
  const going = run(makeDoc({
    kind: 'proposal', lang: 'en', stage: 'writing', agents: 20, sections: Array.from({ length: 10 }, (_, k) => sec(`Part ${k + 1}`)),
  }), many.deps);
  await flush();
  ok('at most eight writers, however many are asked for', many.pending.length === 8, many.pending.length);
  while (many.pending.length) { many.answer(many.pending[0], 'Text.'); await flush(); }
  const all = await going;
  ok('… and every part is still written', many.most() === 8 && many.calls.length === 10 && all.sections.every((s) => s.state === 'done'));

  const few = gated();
  const goingFew = run(makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 5, sections: [sec('Alpha'), sec('Beta')] }), few.deps);
  await flush();
  ok('more writers than parts: one call a part', few.pending.length === 2);
  while (few.pending.length) { few.answer(few.pending[0], 'Text.'); await flush(); }
  await goingFew;
  ok('… and no more', few.most() === 2 && few.calls.length === 2);
}

// ── the abstract waits for every writer ───────────────────────────────────
{
  const doc = makeDoc({ kind: 'article', lang: 'en', stage: 'writing', agents: 3, sections: ['One', 'Two', 'Three', 'Four'].map((hd) => sec(hd)) });
  const g = gated();
  const going = run(doc, g.deps);
  let atAbstract = null;
  await flush();
  while (g.pending.length) {
    const p = g.pending[0];
    if (what(p.o) === 'abstract') {
      atAbstract = { alone: g.pending.length === 1, written: g.saves[g.saves.length - 1].sections.every((s) => s.state === 'done') };
      g.answer(p, '{"abstract": "An invented abstract."}');
    } else {
      g.answer(p, `${headingOf(p.o)} was written.`);
    }
    await flush();
  }
  const out = await going;
  ok('the abstract is asked for only once every writer has finished', atAbstract?.alone === true && atAbstract.written === true, atAbstract);
  const abstractCall = g.calls[g.calls.length - 1];
  ok('… from every part', what(abstractCall) === 'abstract' && ['One', 'Two', 'Three', 'Four'].every((hd) => abstractCall.user.includes(`${hd} was written.`)));
  ok('… and the document is done', out.stage === 'done' && out.abstract === 'An invented abstract.');
  const four = g.calls.find((o) => headingOf(o) === 'Four').user;
  ok('a part started while the one before it is being written is handed no ending, not an older one',
    !four.includes(PREVIOUS) && !four.includes('One was written.'));
}

// ── a failure while other writers are at work ─────────────────────────────
{
  const doc = makeDoc({ kind: 'article', lang: 'en', stage: 'writing', agents: 3, sections: ['One', 'Two', 'Three', 'Four', 'Five'].map((hd) => sec(hd)) });
  const g = gated();
  const going = run(doc, g.deps, { onChange: g.onChange });
  await flush();
  g.fail(g.call('Two'), new Error('overloaded_error'));
  await flush();
  const mid = g.saves[g.saves.length - 1];
  ok('a part that fails is marked failed at once, with why, and so is the document',
    mid.sections[1].state === 'failed' && mid.sections[1].error === 'overloaded_error' && mid.error === 'overloaded_error');
  ok('… no new part is started', g.pending.length === 2 && g.calls.length === 3);
  ok('… and the panel still sees the parts in hand being written',
    same(g.changes[g.changes.length - 1].p.writers.map((w) => w.index), [0, 2]));
  g.answer(g.call('Three'), 'Three was written.');
  await flush();
  ok('… the parts in hand are finished, and still nothing new starts', g.pending.length === 1 && g.calls.length === 3);
  g.answer(g.call('One'), 'One was written.');
  const out = await going;
  ok('… and kept', out.sections[0].state === 'done' && out.sections[0].text === 'One was written.' && out.sections[2].text === 'Three was written.');
  ok('the run ends at writing with the failure on the document, no abstract asked for',
    out.stage === 'writing' && out.error === 'overloaded_error' && out.sections[1].state === 'failed' && !g.calls.some((o) => what(o) === 'abstract'));
  ok('the parts not started are still waiting', out.sections[3].state === 'waiting' && out.sections[4].state === 'waiting');
  ok('what is returned is what was saved last', g.saves[g.saves.length - 1] === out);
  ok('no save lost a part, and none says writing', neverLost(g.saves) && !g.saves.some((d) => d.sections.some((s) => s.state === 'writing')));

  const again = harness((o) => (what(o) === 'abstract' ? ABSTRACT : `${headingOf(o)} again.`));
  const done = await run(out, again.deps);
  ok('run again, it writes only the failed part and the ones not started, then the abstract',
    same(again.calls.map((o) => (what(o) === 'abstract' ? 'abstract' : headingOf(o))), ['Two', 'Four', 'Five', 'abstract']) && done.stage === 'done' && !('error' in done)
    && done.sections[0] === out.sections[0] && done.sections[2] === out.sections[2]);
}
{
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 2, sections: [sec('Alpha'), sec('Beta'), sec('Gamma')] });
  const g = gated();
  const going = run(doc, g.deps);
  await flush();
  g.fail(g.call('Alpha'), new Error('529 overloaded'));
  g.answer(g.call('Beta'), '```\n```');
  const out = await going;
  ok('two parts in hand both failing: each says its own why',
    out.sections[0].error === '529 overloaded' && out.sections[1].error === EMPTY_SECTION && out.sections[2].state === 'waiting' && g.calls.length === 2);
  ok('… and the document says one of them', [EMPTY_SECTION, '529 overloaded'].includes(out.error));
}

// ── stopping several writers ──────────────────────────────────────────────
{
  const ctl = new AbortController();
  const doc = makeDoc({ kind: 'article', lang: 'en', stage: 'writing', agents: 3, sections: ['One', 'Two', 'Three', 'Four', 'Five'].map((hd) => sec(hd)) });
  const g = gated();
  let rejected = 0;
  let caught = null;
  const going = run(doc, g.deps, { signal: ctl.signal, onChange: g.onChange }).then(() => null, (e) => { rejected++; caught = e; });
  await flush();
  g.answer(g.call('Two'), 'Two was written.');
  await flush();
  g.call('One').o.onText('One, half');
  g.call('Four').o.onText('Four, half');
  const saved = g.saves.length;
  const shown = g.changes.length;
  ctl.abort();
  g.fail(g.call('One'), new DOMException('The operation was aborted.', 'AbortError'));
  g.fail(g.call('Three'), new TypeError('network connection was lost'));
  await flush();
  ok('a stop waits for every writer to let go before it puts anything back', rejected === 0 && g.saves.length === saved && g.changes.length === shown);
  g.fail(g.call('Four'), new DOMException('The operation was aborted.', 'AbortError'));
  await going;
  ok('a stop rejects once, with an AbortError, whatever each transport threw', rejected === 1 && caught?.name === 'AbortError');
  const after = g.saves.slice(saved);
  ok('every part in hand is put back as it was, in one save',
    after.length === 1 && [0, 2, 3].every((j) => after[0].sections[j].state === 'waiting' && after[0].sections[j].text === ''), after.map((d) => d.sections.map((s) => s.state)));
  ok('what was finished before the stop is kept', after[0].sections[1].state === 'done' && after[0].sections[1].text === 'Two was written.');
  ok('the stop is not a failure', !('error' in after[0]) && after[0].stage === 'writing' && after[0].sections[4].state === 'waiting');
  const views = g.changes.slice(shown);
  ok('… and shown once, with no writer at work', views.length === 1 && views[0].doc === after[0] && same(views[0].p.writers, []) && views[0].p.index === 0);
  ok('nothing is started after the stop', g.calls.length === 4 && !g.calls.some((o) => what(o) === 'abstract'));
}
{
  // Stopped the moment one writer finishes, before it takes its next part.
  const ctl = new AbortController();
  const doc = makeDoc({ kind: 'proposal', lang: 'en', stage: 'writing', agents: 2, sections: [sec('Alpha'), sec('Beta'), sec('Gamma')] });
  const g = gated();
  const going = run(doc, g.deps, {
    signal: ctl.signal,
    onChange: (d) => { if (d.sections[0].state === 'done') ctl.abort(); },
  }).then(() => null, (e) => e);
  await flush();
  g.answer(g.call('Alpha'), 'Alpha was written.');
  await flush();
  const saved = g.saves.length;
  g.fail(g.call('Beta'), new DOMException('The operation was aborted.', 'AbortError'));
  const e = await going;
  ok('a stop as a writer finishes starts no new part, and puts back only the part in hand', e?.name === 'AbortError' && g.calls.length === 2
    && g.saves.length === saved + 1 && g.saves[saved].sections[1].state === 'waiting' && g.saves[saved].sections[0].text === 'Alpha was written.');
}
await flush();
ok('no writer left a rejection unhandled', unhandled === 0, unhandled);

// ── the outline ───────────────────────────────────────────────────────────
{
  const doc = makeDoc({ stage: 'outline', sources: [src('s1', 'One')] });
  const h = harness(() => 'I am unable to produce that outline.');
  const out = await run(doc, h.deps);
  ok('an outline unreadable twice stops the run with an error', !!out.error && out.stage === 'outline' && out.sections.length === 0);
  ok('the error is the fixed sentence the panel translates', out.error === UNREADABLE_OUTLINE);
  ok('it was asked twice, the second time told why', h.calls.length === 2 && !h.calls[0].user.includes('could not be read') && h.calls[1].user.includes('could not be read as JSON'));
  ok('no ids were used on it', h.ids() === 0);
  ok('the error was saved', h.saves[h.saves.length - 1] === out);

  let n = 0;
  const h2 = harness(() => (n++ === 0 ? 'Sorry.' : OUTLINE));
  const out2 = await run(out, h2.deps, { stopBefore: 'writing' });
  ok('run again, it tries again; unreadable once then good carries on', out2.stage === 'writing' && out2.sections.length === 5 && !('error' in out2));
}
{
  const doc = makeDoc({ stage: 'outline' });
  const h = harness(() => { throw new Error('401 invalid key'); });
  const out = await run(doc, h.deps);
  ok('a model that errors on the outline says why', out.error === '401 invalid key' && out.stage === 'outline' && h.calls.length === 1);
}

// ── the plan ──────────────────────────────────────────────────────────────
{
  const h = harness((o) => (what(o) === 'plan' ? 'Certainly! Title: something.' : happy(o)), () => ({ sources: [], failed: 0 }));
  const out = await run(makeDoc(), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('a plan unreadable twice is asked twice', h.calls.filter((o) => what(o) === 'plan').length === 2);
  // SAFETY promises the indexes only short queries the model derived: the
  // request is the researcher's own words, and may carry their name or data.
  ok('and falls back to the request as the title, but never as a search',
    out.meta.title === out.request && same(out.queries, []) && h.searches.length === 0, h.searches);
  ok('the run carries on to the outline', out.stage === 'writing' && h.calls.some((o) => what(o) === 'outline'));
  ok('and the panel is told, with a code it can translate', h.changes.some((c) => same(c.p.note, { code: 'plan-unreadable' })));
  ok('then told that nothing was searched, for the rest of the run',
    h.changes.some((c) => c.p.stage === 'outline' && same(c.p.note, { code: 'no-queries' })) && same(h.changes[h.changes.length - 1].p.note, { code: 'no-queries' }));
  ok('an unreadable plan adds no legislation', !out.sources.some((s) => s.origin === 'model'));
}
{
  const h = harness(() => { throw new Error('402 no credit'); });
  const out = await run(makeDoc(), h.deps);
  ok('a model that errors on the plan stops there, saying why', out.error === '402 no credit' && out.stage === 'planning' && h.searches.length === 0);
  const h2 = harness(happy, FOUND);
  const done = await run(out, h2.deps);
  ok('and a run after it starts with the plan, the error cleared', h2.calls[0] && what(h2.calls[0]) === 'plan' && done.stage === 'done' && !('error' in done));
}
{
  const h = harness((o) => (what(o) === 'plan' ? '{"title": "Only a title"}' : happy(o)));
  const out = await run(makeDoc({ lang: 'en', request: 'a research paper on tides. I am Invented Person, student no. 12345' }), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('a plan with a title and no queries searches nothing, rather than the request',
    same(out.queries, []) && h.searches.length === 0 && out.meta.title === 'Only a title', h.searches);
  ok('and says so', h.changes.some((c) => same(c.p.note, { code: 'no-queries' })) && out.stage === 'writing');
}
{
  const h = harness(happy, FOUND);
  const out = await run(makeDoc({ stage: 'sources', queries: ['', '   '], sources: [PERSON] }), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('a document at the search with only blank queries searches nothing',
    h.searches.length === 0 && same(out.sources, [PERSON]) && out.stage === 'writing' && h.changes.some((c) => same(c.p.note, { code: 'no-queries' })));
}
{
  // The plan's own quotation marks break it, and the first object that parses
  // is its first law: that is not the plan, and the plan is asked for again.
  const BROKEN = '{"title": "التنظيم القانوني لعمل "المنظمات" غير الحكومية", "queries": ["ngo law"], "laws": [{ "title": "قانون المنظمات غير الحكومية", "number": "12", "year": 2010 }, { "title": "دستور الدولة", "number": "", "year": 2005 }]}';
  const CUT = '{"title": "t", "queries": ["a"], "laws": [{ "title": "قانون المنظمات غير الحكومية", "number": "12", "year": 2010 }, { "title": "قانون آخر", "num';
  ok('parsePlan: a law inside a plan that does not parse is not the plan', parsePlan(BROKEN) === null, parsePlan(BROKEN));
  ok('parsePlan: nor inside a plan cut off in the middle', parsePlan(CUT) === null, parsePlan(CUT));
  ok('parsePlan: a title alone is still a plan', parsePlan('{"title": "Only a title"}')?.title === 'Only a title');
  let n = 0;
  const h = harness((o) => (what(o) === 'plan' ? (n++ === 0 ? BROKEN : PLAN) : happy(o)), FOUND);
  const out = await run(makeDoc(), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('so the plan is asked a second time, told why', h.calls.filter((o) => what(o) === 'plan').length === 2 && h.calls[1].user.includes('could not be read as JSON'));
  ok('and the document is titled by the plan, not by a law', out.meta.title === 'أثر الذكاء الاصطناعي في التعليم الجامعي' && !h.changes.some((c) => c.p.note?.code === 'plan-unreadable'));
}

// ── legislation from the plan ─────────────────────────────────────────────
{
  // The researcher typed two laws; the plan names both again, spelled its own
  // way, and three it does not have.
  const LAW_MINE = src('s2', 'قانون تنظيم المكتبات العامة', { authors: [], type: 'law', number: '٩', year: 2011, origin: 'person', verified: false });
  const CONST_MINE = src('s3', 'دستور الدولة', { authors: [], type: 'law', year: 2003, origin: 'person', verified: false });
  const PLAN_LAWS = JSON.stringify({
    title: 'التنظيم القانوني للمكتبات العامة', field: 'القانون الإداري',
    queries: ['public library law', 'قانون المكتبات العامة'],
    laws: [
      { title: 'قانون تنظيم المكتبات العامه', number: 'رقم 9' },
      { title: 'دستور الدولة', number: '', year: 2003 },
      { title: 'تعليمات تسجيل الجمعيات', number: '٣', year: 2016 },
      { title: 'قانون حماية الغابات الجبلية', number: 'غير معروف', year: '2014' },
      { title: 'قانون تنظيم المكتبات العامة', number: '10', year: 2019 },
    ],
  });
  let atSearch = null;
  const h = harness((o) => {
    const k = what(o);
    if (k === 'plan') return PLAN_LAWS;
    if (k === 'outline') return JSON.stringify({ sections: [{ level: 1, heading: 'المقدمة', words: 800, sources: ['s4', 's5'] }] });
    if (k === 'section') return 'تنظم التعليمات تسجيل الجمعيات [@s4, المادة 3/ثانياً]، وتحمي الغابات [@s5].';
    throw new Error(k);
  }, () => {
    atSearch = h.saves[h.saves.length - 1].sources.map((s) => s.key);
    return {
      sources: [
        src('', 'قانون حماية الغابات الجبلية', { year: 2014, origin: 'crossref' }),
        src('', 'Forest protection in mountain regions', { doi: '10.1000/fff' }),
      ],
      failed: 0,
    };
  });
  const start = makeDoc({ kind: 'working-paper', sources: [PERSON, LAW_MINE, CONST_MINE] });
  const done = await run(start, h.deps);
  const model = done.sources.filter((s) => s.origin === 'model');

  ok('the plan’s legislation is in the sources before the search runs', same(atSearch, ['s1', 's2', 's3', 's4', 's5', 's6']), atSearch);
  ok('a law is added as the model’s, unverified, in use, with no authors',
    same(done.sources[3], { key: 's4', title: 'تعليمات تسجيل الجمعيات', number: '3', year: 2016, authors: [], type: 'law', origin: 'model', verified: false, use: true }),
    done.sources[3]);
  ok('a number that is not a plain number is left out, and a year given as a string is read',
    done.sources[4].title === 'قانون حماية الغابات الجبلية' && !('number' in done.sources[4]) && done.sources[4].year === 2014, done.sources[4]);
  ok('the same title with another number is another law', done.sources[5].key === 's6' && done.sources[5].number === '10' && done.sources[5].year === 2019);
  ok('a law the document has, by folded title and number, is not added again', model.filter((s) => s.title.startsWith('قانون تنظيم')).length === 1);
  ok('a law the document has, by title and year, is not added again', !model.some((s) => s.title === 'دستور الدولة'));
  ok('the researcher’s own laws are kept first and untouched',
    done.sources[0] === PERSON && done.sources[1] === LAW_MINE && done.sources[2] === CONST_MINE);
  ok('found sources continue the keys after the laws', same(done.sources.map((s) => s.key), ['s1', 's2', 's3', 's4', 's5', 's6', 's7']) && done.sources[6].title === 'Forest protection in mountain regions');
  ok('a found record of a law the plan added is not added twice', done.sources.filter((s) => s.title === 'قانون حماية الغابات الجبلية').length === 1);
  const outlineCall = h.calls.find((o) => what(o) === 'outline');
  ok('the outline is offered the laws as legislation, marked for checking',
    outlineCall.user.includes('[@s4] Legislation: تعليمات تسجيل الجمعيات, No. 3 of 2016. (Cite only articles you are sure of.)')
    && outlineCall.user.includes('[@s5] Legislation: قانون حماية الغابات الجبلية of 2014.'));
  ok('the model’s own legislation is not put to the screen, and neither is the researcher’s',
    h.calls.filter((o) => what(o) === 'screen').every((o) => !o.user.includes('[@s4]') && !o.user.includes('[@s1]')));
  ok('the outline may lean on them', same(done.sections[0].sources, ['s4', 's5']));
  ok('and a section cites them, the article kept', done.sections[0].text === 'تنظم التعليمات تسجيل الجمعيات [@s4, المادة 3/ثانياً]، وتحمي الغابات [@s5].', done.sections[0].text);
  ok('the laws were saved with the plan', h.saves.some((d) => d.stage === 'sources' && d.sources.length === 6));
}

// ── the search ────────────────────────────────────────────────────────────
{
  const h = harness(happy, () => { throw new Error('offline'); });
  const out = await run(makeDoc({ sources: [PERSON] }), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('a search that throws is not fatal', out.stage === 'writing' && !('error' in out));
  ok('the sources already there are kept', same(out.sources, [PERSON]));
  ok('the panel is told the search failed, with the transport’s words as the detail',
    h.changes.some((c) => same(c.p.note, { code: 'search-failed', detail: 'offline' })));
  ok('and keeps being told for the rest of the run',
    h.changes[h.changes.length - 1].p.stage === 'writing' && same(h.changes[h.changes.length - 1].p.note, { code: 'search-failed', detail: 'offline' }));
  ok('no note is a sentence', h.changes.every((c) => c.p.note === undefined || (typeof c.p.note === 'object' && typeof c.p.note.code === 'string')));
  ok('the outline is still asked for', h.calls.some((o) => what(o) === 'outline'));
}
{
  const h = harness(happy, () => ({ sources: [src('', 'Found')], failed: 2 }));
  const out = await run(makeDoc(), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  ok('searches that failed are a note with how many of how many, and what the rest found is kept',
    h.changes.some((c) => same(c.p.note, { code: 'search-partial', failed: 2, of: 3 })) && out.sources.length === 1 && out.sources[0].key === 's1');
}
{
  // Offline: the search does not throw, it counts every query as failed.
  const h = harness(happy, (queries) => ({ sources: [], failed: queries.length }));
  const out = await run(makeDoc(), h.deps, { stopBefore: 'writing', onChange: h.onChange });
  const notes = h.changes.map((c) => c.p.note).filter(Boolean);
  ok('every search failing is the search failing, not "the rest are kept"',
    notes.some((n) => n.code === 'search-failed' && n.failed === 3 && n.of === 3 && typeof n.detail === 'string' && n.detail !== '')
    && !notes.some((n) => n.code === 'search-partial') && out.stage === 'writing', notes);
  const g = harness(happy, () => ({ sources: [], failed: 2, sent: 2 }));
  await run(makeDoc(), g.deps, { stopBefore: 'writing', onChange: g.onChange });
  ok('… judged against the searches really sent, when the search says how many',
    g.changes.some((c) => c.p.note?.code === 'search-failed' && c.p.note.of === 2));
  const k = harness(happy, () => ({ sources: [], failed: 1, sent: 3 }));
  await run(makeDoc(), k.deps, { stopBefore: 'writing', onChange: k.onChange });
  ok('some failing and the rest finding nothing is still partial', k.changes.some((c) => same(c.p.note, { code: 'search-partial', failed: 1, of: 3 })));
}
{
  const many = Array.from({ length: 45 }, (_, i) => src('', `Work number ${i}`, { doi: `10.1/${i}` }));
  const h = harness(happy, () => ({ sources: many, failed: 0 }));
  const out = await run(makeDoc({ sources: [src('s1', 'Mine', { origin: 'person' }), src('s5', 'Also mine', { origin: 'person' })] }), h.deps, { stopBefore: 'writing' });
  ok('at most the kind’s number of new sources are added', out.sources.length === 2 + 30, out.sources.length);
  ok('new keys start after the highest key used, never filling a gap', out.sources[2].key === 's6' && out.sources[31].key === 's35');
}
{
  const h = harness(happy, () => ({
    sources: [
      src('', 'Deep Learning  in Schools!', { year: 2019 }),
      src('', 'deep learning in schools', { year: 2019 }),
      src('', 'Deep learning in schools', { year: 2021 }),
      src('', '   '),
      { title: 'A record with no authors list', year: 2022, type: 'other', origin: 'crossref', verified: true, use: true },
    ],
    failed: 0,
  }));
  const out = await run(makeDoc({ stage: 'sources', queries: ['q'] }), h.deps, { stopBefore: 'writing' });
  ok('the same title and year found twice is one work; another year is another',
    same(out.sources.slice(0, 2).map((s) => [s.key, s.year]), [['s1', 2019], ['s2', 2021]]), out.sources.map((s) => [s.key, s.title, s.year]));
  ok('a record with no title is skipped, and one with no authors list gets an empty one',
    out.sources.length === 3 && out.sources[2].key === 's3' && same(out.sources[2].authors, []));
}
{
  const doc = makeDoc({ stage: 'sources', queries: ['q'], sections: [sec('A', { text: 'Old text [@s7].', sources: ['s3'] })] });
  const h = harness(happy, () => ({ sources: [src('', 'New')], failed: 0 }));
  const out = await run(doc, h.deps, { stopBefore: 'writing' });
  ok('a key a marker in the text still uses is never given to a new source', out.sources[0].key === 's8');
}
{
  // The floor the panel hands scholar's merge when the researcher adds a source.
  const doc = makeDoc({
    sources: [src('s1', 'One'), src('s2', 'Two'), src('s3', 'Three')],
    sections: [sec('A', { text: 'يرى الباحث ذلك [@s3؛ @s45].', sources: ['s2'] }), sec('B', { sources: ['s9'] })],
  });
  ok('highestKey: the highest key anywhere — the text, an Arabic-separated marker included', highestKey(doc) === 45, highestKey(doc));
  ok('highestKey: an outline entry counts too', highestKey(makeDoc({ sources: [src('s1', 'One')], sections: [sec('B', { sources: ['s9'] })] })) === 9);
  ok('highestKey: nothing used is 0', highestKey(makeDoc()) === 0);
}

// ── sections the researcher writes ────────────────────────────────────────
{
  const doc = makeDoc({
    kind: 'proposal', stage: 'writing',
    sections: [sec('الإهداء', { state: 'author', text: 'إلى والديّ.' }), sec('المقدمة')],
  });
  const h = harness(happy);
  const out = await run(doc, h.deps);
  ok('a section marked author is never written by the model', h.calls.length === 1 && headingOf(h.calls[0]) === 'المقدمة');
  ok('and its text stays as the researcher wrote it', out.sections[0] === doc.sections[0]);
  ok('the next section continues from it', h.calls[0].user.includes('إلى والديّ.'));
  ok('a proposal has no abstract, so none is asked for', out.stage === 'done' && out.abstract === '');
}
{
  const doc = makeDoc({
    stage: 'writing', kind: 'proposal',
    sections: [sec('Parent', { words: 0, level: 1 }), sec('Leaf with no words', { words: 0, level: 1 })],
  });
  const h = harness(() => 'Some text.');
  const out = await run(doc, h.deps);
  ok('a heading with no words and nothing deeper after it is still written',
    same(h.calls.map(headingOf), ['Parent', 'Leaf with no words']) && out.sections.every((s) => s.state === 'done' && s.text === 'Some text.'));
  ok('… asked for a floor of words, never "about 0"',
    h.calls.every((o) => o.user.includes('Length: about 150 words.') && !o.user.includes('about 0 words')), h.calls.map((o) => /Length: [^\n]*/.exec(o.user)?.[0]));
  ok('… while the outline keeps the number the researcher left', out.sections.every((s) => s.words === 0));
}
{
  // The researcher removed every part to plan their own, and pressed Continue.
  const h = harness(happy, FOUND);
  const out = await run(makeDoc({ stage: 'writing', sections: [], queries: ['q'] }), h.deps, { onChange: h.onChange });
  const kinds = h.calls.map(what);
  ok('writing with no parts plans the outline again, rather than finishing with nothing',
    kinds[0] === 'outline' && same(kinds, ['outline', 'section', 'section', 'section', 'section', 'abstract']) && out.sections.length === 5 && out.stage === 'done', kinds);
  ok('… and the panel sees it go back to the outline', h.changes.some((c) => c.p.stage === 'outline'));
  const again = harness(happy);
  const paused = await run(makeDoc({ stage: 'writing', sections: [] }), again.deps, { stopBefore: 'writing' });
  ok('… stopping before writing again once it has one', same(again.calls.map(what), ['outline']) && paused.stage === 'writing' && paused.sections.length === 5);
}
{
  const doc = makeDoc({
    kind: 'article', stage: 'writing',
    sections: [sec('المقدمة', { state: 'author', text: 'نص الباحث.' }), sec('الخاتمة', { state: 'author' })],
  });
  const h = harness(happy);
  const out = await run(doc, h.deps);
  ok('every part the researcher’s own: no abstract of a document the model never read', h.calls.length === 0 && out.abstract === '' && out.stage === 'done');
  const hn = harness(happy);
  const none = await run(makeDoc({ kind: 'article', stage: 'abstract', sections: [sec('المقدمة', { state: 'done', text: '  ' })] }), hn.deps);
  ok('nor from parts that are done with no text', hn.calls.length === 0 && none.abstract === '' && none.stage === 'done');
}
{
  const doc = makeDoc({
    stage: 'writing', kind: 'proposal',
    sections: [
      sec('الفصل الأول', { words: 0, level: 1 }), sec('المبحث الأول', { words: 0, level: 2 }),
      sec('المطلب الأول', { words: 0, level: 3 }), sec('الفرع الأول', { words: 700, level: 4 }),
      sec('الفرع الثاني', { words: 700, level: 4 }),
    ],
  });
  const h = harness(() => 'نص الفرع.');
  const out = await run(doc, h.deps);
  ok('a fourth level is written, and the three empty headings above it are done without a call',
    same(h.calls.map(headingOf), ['الفرع الأول', 'الفرع الثاني']) && out.sections.every((s) => s.state === 'done')
    && out.sections.slice(0, 3).every((s) => s.text === ''), h.calls.map(headingOf));
  ok('the section prompt shows the fourth level in the outline, indented under its parents', h.calls[0].user.includes('      → الفرع الأول'));
}

// ── rewriting one section ─────────────────────────────────────────────────
{
  const h = harness(() => 'نص جديد أقصر [@s3] [@s77].');
  const out = await rewrite(DONE, 2, '  اجعله أقصر  ', h.deps, { onChange: h.onChange });
  ok('a rewrite is one call', h.calls.length === 1 && what(h.calls[0]) === 'section' && headingOf(h.calls[0]) === 'مفهوم الذكاء الاصطناعي');
  ok('it carries the researcher’s instruction', h.calls[0].user.includes('The researcher\'s instruction for the rewrite: اجعله أقصر'));
  ok('and the current text', h.calls[0].user.includes('The current text of this part') && h.calls[0].user.includes(DONE.sections[2].text));
  ok('and the end of the part before', h.calls[0].user.includes('The end of the part before it') && h.calls[0].user.includes('نص الخلفية.'));
  ok('the section gets the new text, cleaned', out.sections[2].text === 'نص جديد أقصر [@s3].' && out.sections[2].state === 'done', out.sections[2].text);
  ok('nothing else changes', out.sections.every((s, i) => i === 2 || s === DONE.sections[i]) && out.abstract === DONE.abstract && out.stage === 'done');
  ok('the rewrite is saved', h.saves[h.saves.length - 1] === out);
}
{
  const ctl = new AbortController();
  const h = harness(() => { ctl.abort(); throw new DOMException('aborted', 'AbortError'); });
  let caught = null;
  try { await rewrite(DONE, 2, 'أقصر', h.deps, { signal: ctl.signal }); } catch (e) { caught = e; }
  ok('a stopped rewrite rejects with an AbortError', caught?.name === 'AbortError');
  ok('and puts the section back exactly as it was', same(h.saves[h.saves.length - 1].sections[2], DONE.sections[2]));
}
{
  const h = harness(() => { throw new Error('529 overloaded'); });
  const out = await rewrite(DONE, 2, 'أقصر', h.deps);
  ok('a rewrite that errors marks the section failed', out.sections[2].state === 'failed' && out.sections[2].error === '529 overloaded' && out.error === '529 overloaded');
  ok('and keeps the text that was there', out.sections[2].text === DONE.sections[2].text);
  const h2 = harness(() => 'نص.');
  const fixed = await rewrite(out, 2, '', h2.deps);
  ok('a rewrite that then works clears both errors', fixed.sections[2].state === 'done' && !('error' in fixed.sections[2]) && !('error' in fixed));
  ok('an empty instruction asks for no rewrite instruction', !h2.calls[0].user.includes('instruction for the rewrite'));
}
{
  let n = 0;
  // Cut back to its last whole word ("the" could be half of "these"), the text
  // is continued from "Beginning of ", and the model writes on from there.
  const h = harness(() => (n++ === 0 ? { text: 'Beginning of the', stop: 'max_tokens' } : 'the rewritten part.'));
  const doc = makeDoc({ lang: 'en', stage: 'done', sections: [sec('Intro', { state: 'done', text: 'Old.' })] });
  const out = await rewrite(doc, 0, 'fresher', h.deps);
  ok('a rewrite that runs out of room is continued too', h.calls.length === 2 && out.sections[0].text === 'Beginning of the rewritten part.', out.sections[0].text);
  ok('… and the continuation carries the researcher’s instruction and the current text, or it drifts back to the old brief',
    what(h.calls[1]) === 'continue' && h.calls[1].user.includes('The researcher\'s instruction for the rewrite: fresher')
    && h.calls[1].user.includes('The current text of this part') && h.calls[1].user.includes('Old.'));
}
{
  const h = harness(happy);
  const doc = makeDoc({ stage: 'done', sections: [sec('الإهداء', { state: 'author', text: 'x' })] });
  ok('a section the researcher writes is not rewritten', (await rewrite(doc, 0, 'x', h.deps)) === doc && h.calls.length === 0);
  ok('nor is one that is not there', (await rewrite(doc, 5, 'x', h.deps)) === doc && h.calls.length === 0);
}

// ── the abstract ──────────────────────────────────────────────────────────
const written = (over) => makeDoc({
  stage: 'abstract', meta: { title: 'عنوان' },
  sections: [sec('المقدمة', { state: 'done', text: 'نص المقدمة.' })], ...over,
});
{
  const h = harness(() => ABSTRACT);
  const out = await run(written({ kind: 'graduation' }), h.deps);
  ok('a graduation project in Arabic has one abstract', out.abstract === 'ملخص البحث في فقرة واحدة.' && out.abstractEn === '');
  ok('and is not asked for an English one', !h.calls[0].user.includes('abstractEn') && !h.calls[0].user.includes('in English'));
}
{
  const h = harness(() => ABSTRACT);
  const out = await run(written({ kind: 'working-paper' }), h.deps);
  ok('a working paper skips the abstract', h.calls.length === 0 && out.stage === 'done' && out.abstract === '');
}
{
  const h = harness(() => ABSTRACT);
  const out = await run(written({ kind: 'article', lang: 'en' }), h.deps);
  ok('an English article has no English copy of its abstract', out.abstract === 'ملخص البحث في فقرة واحدة.' && out.abstractEn === '' && !h.calls[0].user.includes('Then the same abstract in English'));
}
{
  const h = harness(() => ABSTRACT);
  const out = await run(written({ kind: 'masters', lang: 'ckb' }), h.deps);
  ok('a Sorani thesis has both', out.abstractEn === 'The abstract in English.' && h.calls[0].user.includes('"abstractEn"') && out.stage === 'done');
}
{
  const h = harness(() => ABSTRACT);
  const out = await run(written({ kind: 'proposal' }), h.deps);
  ok('a proposal skips the abstract', h.calls.length === 0 && out.stage === 'done' && out.abstract === '');
}
{
  const h = harness(() => 'no JSON here');
  const out = await run(written({ kind: 'article' }), h.deps);
  ok('an abstract unreadable twice is an error, the stage kept', h.calls.length === 2 && !!out.error && out.stage === 'abstract' && out.abstract === '');
  ok('the error is the fixed sentence the panel translates', out.error === UNREADABLE_ABSTRACT);
}
{
  const h = harness(() => '{"abstract": "ملخص جديد.", "abstractEn": "A new abstract."}');
  const out = await redoAbstract(DONE, h.deps);
  ok('redoing the abstract is one call', h.calls.length === 1 && what(h.calls[0]) === 'abstract');
  ok('it replaces the abstract and nothing else', out.abstract === 'ملخص جديد.' && out.abstractEn === 'A new abstract.' && out.sections === DONE.sections && out.stage === 'done');
  const again = await redoAbstract(written({ kind: 'article' }), harness(() => ABSTRACT).deps);
  ok('from the abstract stage it finishes the document', again.stage === 'done');
  const none = await redoAbstract(written({ kind: 'proposal', stage: 'done' }), harness(() => ABSTRACT).deps);
  ok('a kind without an abstract gets none', none.abstract === '');
}
{
  // The abstract failed; Details → "Write the abstract" then works.
  const failedOnce = written({ kind: 'article', error: UNREADABLE_ABSTRACT });
  const h = harness(() => ABSTRACT);
  const out = await redoAbstract(failedOnce, h.deps);
  ok('an abstract written again clears the error it left', out.stage === 'done' && out.abstract === 'ملخص البحث في فقرة واحدة.' && !('error' in out), out.error);
  ok('… and that is what is saved', h.saves[h.saves.length - 1] === out);
  const still = await redoAbstract(written({ kind: 'article', error: 'overloaded_error', sections: [
    sec('المقدمة', { state: 'done', text: 'نص المقدمة.' }), sec('الخاتمة', { state: 'failed', error: 'overloaded_error' }),
  ] }), harness(() => ABSTRACT).deps);
  ok('… but not an error a failed part still explains', still.error === 'overloaded_error' && still.abstract !== '');
  const worse = await redoAbstract(failedOnce, harness(() => { throw new Error('529 overloaded'); }).deps);
  ok('… and an abstract that fails again says why this time', worse.error === '529 overloaded');
}
{
  // A model allowed 4,096 tokens: the outline stops at its limit.
  const doc = makeDoc({ stage: 'outline', sources: [src('s1', 'One')] });
  const h = harness((o, n) => (n === 0 ? { text: '{"sections": [{"level": 1, "heading": "المقدمة", "brief": "', stop: 'max_tokens' } : OUTLINE));
  const out = await run(doc, h.deps, { stopBefore: 'writing' });
  ok('a JSON reply cut off at its limit is asked again for fewer words, not the same request',
    h.calls.length === 2 && h.calls[1].user.includes('cut off at its length limit') && h.calls[1].user.includes('fewer words')
    && !h.calls[1].user.includes('could not be read as JSON'), h.calls.map((o) => o.user.slice(-200)));
  ok('… and the shorter reply is used', out.stage === 'writing' && out.sections.length === 5);
  const g = harness(() => 'Not JSON at all.');
  await run(makeDoc({ stage: 'outline' }), g.deps);
  ok('a reply that simply was not JSON is asked for the JSON alone', g.calls[1].user.includes('could not be read as JSON') && !g.calls[1].user.includes('length limit'));
}

// ── the sentences the panel translates ────────────────────────────────────
{
  const fixed = [UNREADABLE_OUTLINE, UNREADABLE_ABSTRACT, EMPTY_SECTION];
  ok('the run’s own errors are three distinct English sentences',
    fixed.every((s) => typeof s === 'string' && /^The [a-z]/.test(s) && s.endsWith('.')) && new Set(fixed).size === 3, fixed);
  const h = harness(() => { throw new Error('529 overloaded'); });
  const out = await run(makeDoc({ stage: 'writing', kind: 'proposal', sections: [sec('المقدمة')] }), h.deps);
  ok('a transport’s error is passed on as it came, not replaced by one of them', out.error === '529 overloaded' && !fixed.includes(out.error));
}

// ── jsonIn ────────────────────────────────────────────────────────────────
ok('jsonIn: a bare object', same(jsonIn('{"a":1}'), { a: 1 }));
ok('jsonIn: inside a code fence', same(jsonIn('```json\n{"a": [1, 2]}\n```'), { a: [1, 2] }));
ok('jsonIn: with prose before and after', same(jsonIn('Sure! Here it is: {"a": "b"} Let me know.'), { a: 'b' }));
ok('jsonIn: braces inside strings do not end it', same(jsonIn('{"a": "x } y { z", "b": 2}'), { a: 'x } y { z', b: 2 }));
ok('jsonIn: escaped quotes inside strings', same(jsonIn('{"a": "he said \\"}\\" twice", "b": 1}'), { a: 'he said "}" twice', b: 1 }));
ok('jsonIn: nested objects come back whole', same(jsonIn('x {"a": {"b": {"c": 1}}} y'), { a: { b: { c: 1 } } }));
ok('jsonIn: prose braces before the object are skipped', same(jsonIn('Use {curly} braces: {"a": 1}'), { a: 1 }));
ok('jsonIn: the first of two objects', same(jsonIn('{"a": 1} and {"b": 2}'), { a: 1 }));
ok('jsonIn: a raw newline inside a string is mended', same(jsonIn('{"a": "line one\nline two"}'), { a: 'line one\nline two' }));
ok('jsonIn: a trailing comma is mended', same(jsonIn('{"a": [1, 2,], "b": 3,}'), { a: [1, 2], b: 3 }));
ok('jsonIn: a comma inside a string is left alone', same(jsonIn('{"a": "x,}", "b": 1,}'), { a: 'x,}', b: 1 }));
ok('jsonIn: Arabic text', same(jsonIn('{"title": "أثر {التقنية}"}'), { title: 'أثر {التقنية}' }));
ok('jsonIn: nothing to find is null', jsonIn('no json at all') === null && jsonIn('') === null && jsonIn('{ unclosed') === null);
ok('jsonIn: an object that never parses is null', jsonIn('{this is not json}') === null);
ok('jsonIn: a bare array is not an object', jsonIn('[1, 2, 3]') === null);
ok('jsonIn: not a string is null', jsonIn(undefined) === null && jsonIn(42) === null);

// ── parsePlan ─────────────────────────────────────────────────────────────
{
  const p = parsePlan(PLAN);
  ok('parsePlan: a fenced plan reads whole', p && p.title === 'أثر الذكاء الاصطناعي في التعليم الجامعي' && p.queries.length === 3 && p.keywordsEn.length === 2);
  const q = parsePlan('{"title": "  T  ", "keywords": "one, two ، three; one", "queries": ["a", "A", " b ", "", 7, null]}');
  ok('parsePlan: keywords given as one string are split, trimmed and deduplicated', same(q.keywords, ['one', 'two', 'three']), q.keywords);
  ok('parsePlan: queries are trimmed, deduplicated regardless of case, and non-strings dropped', same(q.queries, ['a', 'b']), q.queries);
  ok('parsePlan: a missing field is an empty string, a missing list empty', q.title === 'T' && q.titleEn === '' && q.field === '' && same(q.keywordsEn, []));
  const many = parsePlan(JSON.stringify({ title: 't', queries: Array.from({ length: 20 }, (_, i) => `query ${i}`) }));
  ok('parsePlan: queries are capped', many.queries.length === 10);
  ok('parsePlan: queries alone are enough', parsePlan('{"queries": ["x"]}')?.title === '');
  ok('parsePlan: neither a title nor a query is no plan', parsePlan('{"title": "", "queries": []}') === null && parsePlan('{"field": "law"}') === null);
  ok('parsePlan: no JSON is no plan', parsePlan('The title is X.') === null);
  ok('parsePlan: a title that is not a string is ignored', parsePlan('{"title": 42, "queries": ["q"]}')?.title === '');
}

// ── parsePlan: legislation ────────────────────────────────────────────────
{
  const p = parsePlan(JSON.stringify({
    title: 't', queries: ['q'],
    laws: [
      { title: '  قانون تنظيم المكتبات العامة  ', number: 'رقم ٩', year: 2011 },
      { title: 'Public Libraries Act', number: 'No. 14', year: '2008' },
      { title: 'دستور الدولة', number: '', year: '٢٠٠٣' },
      { title: 'تعليمات تسجيل الجمعيات', number: '۳', year: 1700 },
      { title: 'نظام الأرشيف الوطني', number: '12/2010', year: 2010.5 },
      { title: 'قرار مجلس الإدارة', number: 27, year: 2101 },
      { title: '', number: '5', year: 2000 },
      { number: '6', year: 2001 },
      'قانون مكتوب نصاً', null, [1, 2],
      { title: 'ق'.repeat(300), year: 2020 },
      { title: 'قانون تنظيم المكتبات العامه', number: '9' },
      { title: 'قانون السير', number: 'No.0', year: 1999 },
    ],
  }));
  const L = p.laws;
  ok('parsePlan: laws with a title are read, the rest skipped', L.length === 8, L.map((l) => l.title.slice(0, 20)));
  ok('parsePlan: a law’s title is trimmed', L[0].title === 'قانون تنظيم المكتبات العامة');
  ok('parsePlan: رقم and Arabic-Indic digits come off a number', L[0].number === '9' && L[0].year === 2011, L[0]);
  ok('parsePlan: so does No.', L[1].number === '14', L[1]);
  ok('parsePlan: a year as a string of either digits is read', L[1].year === 2008 && L[2].year === 2003, [L[1], L[2]]);
  ok('parsePlan: no number is an empty one', L[2].number === '');
  ok('parsePlan: Extended Arabic-Indic digits are read', L[3].number === '3', L[3]);
  ok('parsePlan: a year before 1800 is left out', !('year' in L[3]), L[3]);
  ok('parsePlan: a number that is not a plain number is empty, and a fractional year left out', L[4].number === '' && !('year' in L[4]), L[4]);
  ok('parsePlan: a number given as a number is read, and a year after 2100 left out', L[5].number === '27' && !('year' in L[5]), L[5]);
  ok('parsePlan: a law’s title is capped at 200', L[6].title.length === 200 && L[6].year === 2020);
  ok('parsePlan: the same law twice is one, by folded title and number', !L.some((l, i) => i > 0 && l.title === 'قانون تنظيم المكتبات العامه'));
  ok('parsePlan: a number of zero is no number', L[7].title === 'قانون السير' && L[7].number === '', L[7]);

  const many = parsePlan(JSON.stringify({ title: 't', laws: Array.from({ length: 12 }, (_, i) => ({ title: `قانون رقم ${i}`, number: String(i + 1), year: 2000 + i })) }));
  ok('parsePlan: at most eight laws', many.laws.length === 8 && many.laws[7].number === '8');
  ok('parsePlan: no laws is an empty list', same(parsePlan('{"title": "t"}').laws, []));
  ok('parsePlan: laws that are not a list are none', same(parsePlan('{"title": "t", "laws": "قانون المكتبات"}').laws, [])
    && same(parsePlan('{"title": "t", "laws": {"title": "قانون"}}').laws, []) && same(parsePlan('{"title": "t", "laws": null}').laws, []));
  ok('parsePlan: laws alone are no plan', parsePlan('{"laws": [{"title": "قانون"}]}') === null);
  ok('parsePlan: the plan fixture has no laws', same(parsePlan(PLAN).laws, []));
}

// ── parseOutline ──────────────────────────────────────────────────────────
{
  let n = 0;
  const id = () => 'o' + ++n;
  const doc = makeDoc({
    kind: 'article', length: 'standard',
    sources: [src('s1', 'A'), src('s2', 'B', { use: false }), src('s3', 'C', { retracted: true }), src('s4', 'D')],
  });
  const rows = (list) => JSON.stringify({ sections: list });

  const a = parseOutline(rows([
    { level: 2, heading: 'Starts deep', words: 1000, sources: ['s1', 's2', 's3', 's4', 's9', '@s4', '[@s1]'] },
    { level: 3, heading: '## Jumps', words: 1000 },
    { level: 1, heading: '   ', words: 1000 },
    { level: 3, heading: 'Deep again', words: 1000 },
    { level: 9, heading: 'Too deep', words: 1000 },
    { level: 0, heading: 'Too shallow', words: 1000 },
    { level: '2', heading: 'Level as a string', words: '1,000 words' },
    { heading: 'No level', words: 1000 },
  ]), doc, id);
  ok('parseOutline: the first section is level 1, whatever it was given', a[0].level === 1);
  ok('parseOutline: no level is more than one below the one before, and none below 4', same(a.map((s) => s.level), [1, 2, 3, 4, 1, 2, 2]), a.map((s) => s.level));
  ok('parseOutline: an entry with no heading is dropped', a.length === 7 && !a.some((s) => !s.heading.trim()));
  ok('parseOutline: markdown is taken off a heading', a[1].heading === 'Jumps');
  ok('parseOutline: sources are only citable keys, deduplicated, in any spelling', same(a[0].sources, ['s1', 's4']), a[0].sources);
  ok('parseOutline: numbers given as strings are read', a[5].words === 1000);
  ok('parseOutline: ids come from newId, in order', same(a.map((s) => s.id), ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7']));
  ok('parseOutline: every section starts waiting and empty', a.every((s) => s.state === 'waiting' && s.text === '' && s.brief === ''));
  ok('parseOutline: a total within 40% of the target is left alone', a.every((s) => s.words === 1000));

  const small = parseOutline(rows([
    { level: 1, heading: 'One', words: 500 }, { level: 1, heading: 'Two', words: 1500 }, { level: 1, heading: 'Three', words: 99999 },
  ]), doc, id);
  ok('parseOutline: words are clamped to 3,000', small[2].words <= 3000);
  const tiny = parseOutline(rows([
    { level: 1, heading: 'One', words: 100 }, { level: 1, heading: 'Two', words: 300 }, { level: 1, heading: 'Three', words: -50 },
  ]), doc, id);
  ok('parseOutline: a negative count is no count', tiny[2].words > 0);
  const far = parseOutline(rows([
    { level: 1, heading: 'Intro', words: 200 }, { level: 1, heading: 'Body', words: 0 },
    { level: 2, heading: 'Part A', words: 400 }, { level: 2, heading: 'Part B', words: 400 },
    { level: 1, heading: 'End', words: 200 },
  ]), doc, id);
  const total = far.reduce((n, s) => n + s.words, 0);
  ok('parseOutline: a total far from the target is scaled to it', Math.abs(total - 7000) < 200, total);
  ok('parseOutline: in proportion, to the nearest ten', Math.abs(far[2].words - 2 * far[0].words) <= 20 && far[0].words === far[4].words, far.map((s) => s.words));
  ok('parseOutline: a parent heading with no words keeps none', far[1].words === 0);
  const leaf = parseOutline(rows([
    { level: 1, heading: 'A', words: 2000 }, { level: 1, heading: 'B', words: 0 }, { level: 1, heading: 'C', words: 3000 },
  ]), doc, id);
  ok('parseOutline: a part with no subsections and no words is given the average', leaf[1].words === 2500, leaf.map((s) => s.words));

  const law = parseOutline(rows([
    { level: 1, heading: 'الفصل الأول', words: 0 },
    { level: 2, heading: 'المبحث الأول', words: 0 },
    { level: 3, heading: 'المطلب الأول', words: 0 },
    { level: 4, heading: 'الفرع الأول', words: 1500 },
    { level: 5, heading: 'أعمق من الفرع', words: 1500 },
    { level: 4, heading: 'الفرع الثاني', words: 1500 },
    { level: 2, heading: 'المبحث الثاني', words: 0 },
    { level: 4, heading: 'قفزة', words: 1500 },
    { level: '4', heading: 'مستوى نصي', words: 1000 },
  ]), doc, id);
  ok('parseOutline: four levels, الفصل › المبحث › المطلب › الفرع, and none deeper or jumping',
    same(law.map((s) => s.level), [1, 2, 3, 4, 4, 4, 2, 3, 4]), law.map((s) => s.level));
  ok('parseOutline: parents of a fourth level keep no words of their own', law[1].words === 0 && law[2].words === 0);

  ok('parseOutline: a bare array of entries is read', parseOutline('Here:\n[{"level":1,"heading":"Only"}]', doc, id)?.[0]?.heading === 'Only');
  const before = n;
  ok('parseOutline: no JSON is null', parseOutline('Sorry, I cannot.', doc, id) === null);
  ok('parseOutline: no entries is null', parseOutline('{"sections": []}', doc, id) === null);
  ok('parseOutline: entries without headings are null', parseOutline('{"sections": [{"level": 1}, "text", null]}', doc, id) === null);
  ok('parseOutline: sections that are not a list are null', parseOutline('{"sections": "Introduction, Method"}', doc, id) === null);
  ok('parseOutline: a failed read uses no ids', n === before);
}

// ── parseAbstract ─────────────────────────────────────────────────────────
ok('parseAbstract: both abstracts', same(parseAbstract(ABSTRACT), { abstract: 'ملخص البحث في فقرة واحدة.', abstractEn: 'The abstract in English.' }));
ok('parseAbstract: in a fence, with prose', parseAbstract('Here:\n```json\n{"abstract": "A."}\n```')?.abstract === 'A.');
ok('parseAbstract: no English one is an empty string', parseAbstract('{"abstract": "A."}')?.abstractEn === '');
ok('parseAbstract: abstract_en is read too', parseAbstract('{"abstract": "A.", "abstract_en": "E."}')?.abstractEn === 'E.');
ok('parseAbstract: markers are taken out', parseAbstract('{"abstract": "It matters [@s1]. Much [@s2; @s3]."}')?.abstract === 'It matters. Much.');
ok('parseAbstract: a raw newline in the string is survived', parseAbstract('{"abstract": "Line one.\nLine two."}')?.abstract === 'Line one.\nLine two.');
ok('parseAbstract: an empty abstract is none', parseAbstract('{"abstract": "  "}') === null && parseAbstract('{"abstractEn": "E."}') === null);
ok('parseAbstract: no JSON is none', parseAbstract('The study examines…') === null);

// ── cleanSection ──────────────────────────────────────────────────────────
const K = new Set(['s1', 's2', 's3']);
ok('cleanSection: plain text is only trimmed', cleanSection('\n  A paragraph [@s1].\n\nAnother.  \n', 'H', K) === 'A paragraph [@s1].\n\nAnother.');
ok('cleanSection: code fences go and what was in them stays', cleanSection('```markdown\nText.\n```', 'H', K) === 'Text.');
ok('cleanSection: a first line repeating the heading goes', cleanSection('Introduction\n\nText.', 'Introduction', K) === 'Text.');
ok('cleanSection: … with # marks', cleanSection('## Introduction\n\nText.', 'Introduction', K) === 'Text.');
ok('cleanSection: … in bold', cleanSection('**Introduction**\nText.', 'Introduction', K) === 'Text.');
ok('cleanSection: … numbered', cleanSection('1. Introduction:\n\nText.', 'Introduction', K) === 'Text.');
ok('cleanSection: … when the heading is numbered and the line is not', cleanSection('# Sample\n\nText.', '3.2 Sample', K) === 'Text.');
ok('cleanSection: … with an Arabic ordinal', cleanSection('أولاً: مشكلة الدراسة\n\nنص.', 'مشكلة الدراسة', K) === 'نص.');
ok('cleanSection: … with the other Arabic spelling', cleanSection('### مشكله الدراسه\n\nنص.', 'مشكلة الدراسة', K) === 'نص.');
ok('cleanSection: … with hamza and harakat folded', cleanSection('# الإطارُ النظري\n\nنص.', 'الاطار النظري', K) === 'نص.');
ok('cleanSection: … half of a chapter heading', cleanSection('# الإطار العام للدراسة\n\nنص.', 'الفصل الأول: الإطار العام للدراسة', K) === 'نص.');
ok('cleanSection: … with a Kurdish ordinal', cleanSection('یەکەم: پێشەکی\n\nدەق.', 'پێشەکی', K) === 'دەق.');
ok('cleanSection: a first line that only starts like the heading stays',
  cleanSection('Introduction of new tools changed teaching.\n\nMore.', 'Introduction', K) === 'Introduction of new tools changed teaching.\n\nMore.');
ok('cleanSection: the heading is only looked for on the first line', cleanSection('Text.\n\nIntroduction', 'Introduction', K) === 'Text.\n\nIntroduction');
ok('cleanSection: # and ## headings become ###',
  cleanSection('Text.\n\n# Big\n\nMore.\n\n## Medium\n\nEnd.', 'H', K) === 'Text.\n\n### Big\n\nMore.\n\n### Medium\n\nEnd.');
ok('cleanSection: ### and #### are the section’s own and stay', cleanSection('Text.\n\n### Sub\n\n#### Subsub\n\nEnd.', 'H', K) === 'Text.\n\n### Sub\n\n#### Subsub\n\nEnd.');
ok('cleanSection: a hashtag is not a heading', cleanSection('#hashtag stays', 'H', K) === '#hashtag stays');
ok('cleanSection: an appended English reference list goes',
  cleanSection('Text [@s1].\n\n## References\n\n- Smith, J. (2020). A title.\n- Doe, A. (2019). Another.', 'H', K) === 'Text [@s1].');
ok('cleanSection: an appended Arabic one goes, entries as plain lines',
  cleanSection('نص.\n\n**المراجع:**\nالزهراني، محمد. (2020). عنوان.\nSmith, J. (2019). Title. https://doi.org/10.1000/x', 'H', K) === 'نص.');
ok('cleanSection: a Sorani one goes', cleanSection('دەق.\n\n### سەرچاوەکان\n1. یەکەم سەرچاوە (2020).\n2. دووەم (2018).', 'H', K) === 'دەق.');
ok('cleanSection: a Badini one goes, with the rule above it', cleanSection('دەق.\n\n---\n\nژێدەر\n- [@s1]\n- [@s2]', 'H', K) === 'دەق.');
ok('cleanSection: المصادر والمراجع goes', cleanSection('نص.\n\n## المصادر والمراجع\n\n[1] مرجع (2020).', 'H', K) === 'نص.');
ok('cleanSection: a references heading followed by prose stays',
  cleanSection('Text.\n\n### References\n\nThis part discusses how references were chosen.', 'H', K) === 'Text.\n\n### References\n\nThis part discusses how references were chosen.');
ok('cleanSection: a list under any other heading stays',
  cleanSection('Text.\n\n### Recommendations\n\n1. Train teachers.\n2. Fund labs.', 'H', K) === 'Text.\n\n### Recommendations\n\n1. Train teachers.\n2. Fund labs.');
ok('cleanSection: a reference list in the middle is not the end, and stays',
  cleanSection('Text.\n\n### References\n\n- A (2020).\n\nMore prose after.', 'H', K) === 'Text.\n\n### References\n\n- A (2020).\n\nMore prose after.');
ok('cleanSection: a known marker is left exactly as written', cleanSection('A [ @s1 ] b [@s2, p. 12] c [@s1; @s3].', 'H', K) === 'A [ @s1 ] b [@s2, p. 12] c [@s1; @s3].');
ok('cleanSection: an unknown marker goes, with the space before it', cleanSection('A claim [@s42]. Next.', 'H', K) === 'A claim. Next.');
ok('cleanSection: … between words, one space is left', cleanSection('A claim [@s42] and more.', 'H', K) === 'A claim and more.');
ok('cleanSection: … at the start of a line, the space after it goes too', cleanSection('[@s42] Starts here.', 'H', K) === 'Starts here.');
ok('cleanSection: … at the end of a line', cleanSection('Ends here [@s42]\nNext line.', 'H', K) === 'Ends here\nNext line.');
ok('cleanSection: … two in a row', cleanSection('Claim [@s41] [@s42].', 'H', K) === 'Claim.');
ok('cleanSection: … with Arabic punctuation after it', cleanSection('ادعاء [@s42]، ثم نص.', 'H', K) === 'ادعاء، ثم نص.');
ok('cleanSection: an unknown key in a group is dropped, the rest kept', cleanSection('A [@s1; @s42].', 'H', K) === 'A [@s1].');
ok('cleanSection: … with the locators that belong to the keys kept', cleanSection('A [@s42, p. 3; @s2, pp. 12, 14].', 'H', K) === 'A [@s2, pp. 12, 14].');
ok('cleanSection: … and commas between keys', cleanSection('A [@s1, @s99, @s3].', 'H', K) === 'A [@s1; @s3].');
ok('cleanSection: a key in the wrong case is mended, not dropped', cleanSection('A [@S2].', 'H', K) === 'A [@s2].');
ok('cleanSection: gaps for the researcher are left alone', cleanSection('See [[Table: the means]] here.\n\n[[Data: the sample]]', 'H', K) === 'See [[Table: the means]] here.\n\n[[Data: the sample]]');
ok('cleanSection: brackets that are not markers are left alone', cleanSection('A list [a, b] and email@x.com [1].', 'H', K) === 'A list [a, b] and email@x.com [1].');
ok('cleanSection: blank lines left behind are collapsed', cleanSection('A.\n\n[@s42]\n\nB.', 'H', K) === 'A.\n\nB.');
ok('cleanSection: an empty reply is empty', cleanSection('', 'H', K) === '' && cleanSection('```\n```', 'H', K) === '' && cleanSection(undefined, 'H', K) === '');
ok('cleanSection: with no keys at all, every marker goes', cleanSection('A [@s1]. B [@s2; @s3].', 'H', new Set()) === 'A. B.');

// Keys are split where prose.ts splits them, so a key it would cite is a key checked here.
ok('cleanSection: an unknown key after an Arabic semicolon goes', cleanSection('يرى الباحث ذلك [@s3؛ @s45].', 'H', K) === 'يرى الباحث ذلك [@s3].');
ok('cleanSection: … after an Arabic comma', cleanSection('يرى الباحث ذلك [@s3، @s45].', 'H', K) === 'يرى الباحث ذلك [@s3].');
ok('cleanSection: … after a bare space', cleanSection('A claim [@s3 @s45].', 'H', K) === 'A claim [@s3].');
ok('cleanSection: … with no space at all', cleanSection('ذلك [@s3؛@s45].', 'H', K) === 'ذلك [@s3].');
ok('cleanSection: an Arabic locator stays with its key', cleanSection('ذلك [@s45، ص ١٢؛ @s2، ص ٤٥].', 'H', K) === 'ذلك [@s2, ص ٤٥].');
ok('cleanSection: known keys split the Arabic way are left as written', cleanSection('ذلك [@s1؛ @s3].', 'H', K) === 'ذلك [@s1؛ @s3].');

// Doubled brackets are a marker to prose.ts, so they are one here too.
ok('cleanSection: an unknown marker in doubled brackets goes whole, leaving no []', cleanSection('claim [[@s99]].', 'h', K) === 'claim.');
ok('cleanSection: a known one is left as written', cleanSection('claim [[@s3]].', 'h', K) === 'claim [[@s3]].');
ok('cleanSection: a mixed one keeps its depth', cleanSection('claim [[@s3; @s99]].', 'h', K) === 'claim [[@s3]].');
ok('cleanSection: a lone extra bracket is not the marker’s', cleanSection('see [[@s99] now', 'h', K) === 'see [ now');
ok('cleanSection: a gap is still a gap', cleanSection('[[Data: the sample]] and [[@s1]]', 'h', K) === '[[Data: the sample]] and [[@s1]]');

// The region's own layout, and years in the region's digits.
ok('cleanSection: a grouped Arabic reference list goes, group headings and all',
  cleanSection('نص الخاتمة [@s1].\n\n### قائمة المصادر\n\nأولاً: الكتب\n١. محمد علي الزهراني، أثر التعليم، دار الثقافة، عمان، ٢٠١٥.\n٢. عمر حسن، التعليم العالي، دار النشر، بغداد، ٢٠١٨.\n\nثانياً: البحوث\n١. سعاد كريم، التعلم الرقمي، مجلة العلوم، العدد ٣، ٢٠٢٠.', 'H', K) === 'نص الخاتمة [@s1].');
ok('cleanSection: … with the group headings bold or as ### lines',
  cleanSection('نص.\n\n**المصادر:**\n\n**أولاً: الكتب**\n- كتاب (٢٠١٥).\n\n### ثانياً: البحوث\n- بحث (٢٠٢٠).', 'H', K) === 'نص.');
ok('cleanSection: entries with Arabic-Indic years go',
  cleanSection('نص.\n\nالمراجع:\nالزهراني، محمد. (٢٠٢٠). أثر الذكاء الاصطناعي في التعليم.\nالعتيبي، سعد. (۲۰۱۹). التعليم عن بعد.', 'H', K) === 'نص.');
ok('cleanSection: footnotes written out as text go',
  cleanSection('نص [@s1].\n\nالهوامش:\n(١) الزهراني، أثر التعليم، ص ٤٥.\n(٢) المصدر نفسه، ص ٤٦.', 'H', K) === 'نص [@s1].');
ok('cleanSection: … and الحواشي too', cleanSection('نص.\n\n### الحواشي\n(1) مرجع، ص 3.', 'H', K) === 'نص.');
ok('cleanSection: Chicago entries with no brackets go',
  cleanSection('Text [@s1].\n\n## References\n\nSmith, John. 2020. The Title of a Book. City: Press.\nDoe, Jane, and Ann Roe. 2019. "An Article." Journal 3 (2): 1–10.', 'H', K) === 'Text [@s1].');
ok('cleanSection: a Hijri year in brackets is an entry', cleanSection('نص.\n\nالمصادر\nابن منظور، لسان العرب (١٤١٤هـ).', 'H', K) === 'نص.');
ok('cleanSection: an ordinal-numbered list at the end under another heading stays',
  cleanSection('نص.\n\n### التوصيات\n\nأولاً: المقترحات\n١. تدريب المدرسين.\n٢. تمويل المختبرات.', 'H', K) === 'نص.\n\n### التوصيات\n\nأولاً: المقترحات\n١. تدريب المدرسين.\n٢. تمويل المختبرات.');
ok('cleanSection: a group heading with nothing under it is not an entry, and stops the list',
  cleanSection('نص.\n\n### المراجع\n- مرجع (2020).\n\nأولاً: خلاصة', 'H', K) === 'نص.\n\n### المراجع\n- مرجع (2020).\n\nأولاً: خلاصة');
ok('cleanSection: a sentence that merely ends in a year, under a references heading, stays',
  cleanSection('Text.\n\n### References\n\nThese were chosen in 2020.', 'H', K) === 'Text.\n\n### References\n\nThese were chosen in 2020.');

// ── the screen: works the search found that are off the topic ─────────────
// From a real run: a search for NGO oversight in Iraq returned papers on
// religious freedom in China and on blockchain, and the model cited them.
{
  const OFF = () => ({
    sources: [
      src('', 'Oversight of civil society organisations', { doi: '10.1000/on1' }),
      src('', 'Religious freedom in a far country', { doi: '10.1000/off' }),
      src('', 'NGO registration law', { doi: '10.1000/on2' }),
    ],
    failed: 0,
  });
  const keepOnly = (keys) => (o) => (what(o) === 'screen' ? JSON.stringify({ keep: keys }) : happy(o));
  const h = harness(keepOnly(['s2', 's4']), OFF);
  const done = await run(makeDoc({ sources: [PERSON] }), h.deps, { stopBefore: 'writing' });
  const byTitle = (t) => done.sources.find((s) => s.title === t);
  ok('a work the screen drops is switched off, not deleted', byTitle('Religious freedom in a far country')?.use === false);
  ok('the works it keeps stay in use', byTitle('Oversight of civil society organisations').use && byTitle('NGO registration law').use);
  ok('the researcher’s own source is never judged', done.sources[0] === PERSON && PERSON.use);
  ok('a switched-off work is not offered to the outline',
    !h.calls.find((o) => what(o) === 'outline').user.includes('Religious freedom'));

  const unreadable = harness((o) => (what(o) === 'screen' ? 'I would keep most of them.' : happy(o)), OFF);
  const kept = await run(makeDoc(), unreadable.deps, { stopBefore: 'writing' });
  ok('a screen that cannot be read keeps everything found, after asking twice',
    kept.sources.every((s) => s.use) && unreadable.calls.filter((o) => what(o) === 'screen').length === 2);

  const broken = harness((o) => { if (what(o) === 'screen') throw new Error('overloaded'); return happy(o); }, OFF);
  const still = await run(makeDoc(), broken.deps, { stopBefore: 'writing' });
  ok('a screen that fails keeps everything found and the run goes on',
    still.stage === 'writing' && still.sources.every((s) => s.use) && !still.error);

  const ctl = new AbortController();
  const stopped = harness((o) => { if (what(o) === 'screen') { ctl.abort(); throw new DOMException('stop', 'AbortError'); } return happy(o); }, OFF);
  let name = '';
  try { await run(makeDoc(), stopped.deps, { signal: ctl.signal }); } catch (e) { name = e?.name; }
  ok('stopping during the screen stops the run', name === 'AbortError');

  const none = harness(happy, () => ({ sources: [], failed: 0 }));
  await run(makeDoc(), none.deps, { stopBefore: 'writing' });
  ok('nothing found, nothing to screen', !none.calls.some((o) => what(o) === 'screen'));

  ok('the screen reply is read as bare keys', same(parseScreen('```json\n{"keep": ["s2", "@s3", "[@s4]"]}\n```'), ['s2', 's3', 's4']));
  ok('a reply without a keep list is unreadable', parseScreen('{"sections": []}') === null && parseScreen('nope') === null);
  ok('an empty keep list is a verdict, not a failure', same(parseScreen('{"keep": []}'), []));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
