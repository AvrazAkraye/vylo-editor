// Fitting a conversation into a context window.
//
// The property that matters most here is structural, not numeric: a `tool_use`
// block must never be separated from its `tool_result`. Getting that wrong
// would trade "the context is too long" — which recovers — for "the
// conversation is malformed", which does not. Most of this file is that.
import {
  LIMITS, DEFAULT_LIMITS, limitsFor, estimateText, estimateMsg, estimateAll,
  turnStarts, summarise, summaryBlock, fit,
} from '../.test-build/budget.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── building conversations ────────────────────────────────────────────────
let nextId = 0;
const ask = (text) => ({ role: 'user', content: text });
const say = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const call = (name, input) => {
  const id = `t${nextId++}`;
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '' }] },
  ];
};
/** One complete exchange: a question, a tool call with a result, an answer. */
const turn = (q, path, result, a) => {
  const [use, res] = call('read_file', { path });
  res.content[0].content = result;
  return [ask(q), use, res, say(a)];
};

// ── limits ────────────────────────────────────────────────────────────────
ok('a known model gets a raised output cap', limitsFor('claude-opus-4-8').maxOutput > 4096);
ok('an unknown model keeps 4096',
   limitsFor('claude-3-something-old').maxOutput === 4096,
   limitsFor('claude-3-something-old'));
ok('an unknown model is the documented default', limitsFor('nonsense') === DEFAULT_LIMITS);
ok('every known model fits its output inside its context',
   Object.values(LIMITS).every((l) => l.maxOutput * 4 <= l.context));

// ── estimating ────────────────────────────────────────────────────────────
ok('an empty string costs nothing', estimateText('') === 0);
ok('estimation is not wildly low', estimateText('x'.repeat(3500)) >= 1000);
ok('a tool result is counted, not just the text blocks', (() => {
  const [use, res] = call('read_file', { path: 'a.ts' });
  res.content[0].content = 'y'.repeat(4000);
  return estimateMsg(res) > 1000;
})());
ok('a tool call\'s arguments are counted — write_file carries the whole file', (() => {
  const [use] = call('write_file', { path: 'a.ts', content: 'z'.repeat(8000) });
  return estimateMsg(use) > 2000;
})());
ok('an image is charged something, and not more than the ceiling', (() => {
  const img = { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(400_000) } }] };
  const n = estimateMsg(img);
  return n > 100 && n < 2000;
})(), estimateMsg({ role: 'user', content: [{ type: 'image', source: { data: 'A'.repeat(400_000) } }] }));
ok('a conversation costs the sum of its messages',
   estimateAll([ask('one'), say('two')]) === estimateMsg(ask('one')) + estimateMsg(say('two')));

// ── turn starts ───────────────────────────────────────────────────────────
{
  const convo = [...turn('q1', 'a.ts', 'aaa', 'done'), ...turn('q2', 'b.ts', 'bbb', 'done')];
  const starts = turnStarts(convo);
  ok('a turn starts at each real question', starts.length === 2, starts);
  ok('and the first is index 0', starts[0] === 0, starts);
  ok('a tool_result carrier is not a turn start',
     !starts.includes(2), starts);
  ok('the second turn starts after the first ends', starts[1] === 4, starts);
}
ok('an empty conversation has no turn starts', turnStarts([]).length === 0);
ok('a history that does not begin with a question still offers index 0',
   turnStarts([say('orphan')])[0] === 0);

// ── the invariant ─────────────────────────────────────────────────────────
/** Every tool_use has its result, and every result has its call. */
function paired(msgs) {
  const used = [];
  const got = [];
  for (const m of msgs) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'tool_use') used.push(b.id);
      if (b.type === 'tool_result') got.push(b.tool_use_id);
    }
  }
  return used.length === got.length && used.every((id, i) => got[i] === id);
}

{
  // Ten turns, each holding a big file read, against a window far too small.
  const convo = [];
  for (let i = 0; i < 10; i++) convo.push(...turn(`question ${i}`, `f${i}.ts`, 'L'.repeat(20_000), `answer ${i}`));

  let allPaired = true;
  let alwaysUser = true;
  // Squeeze through every budget from generous to absurd. Each one takes a
  // different branch, and every one of them must produce a sendable request.
  for (let ctx = 200_000; ctx >= 2_000; ctx -= 977) {
    const f = fit(convo, { context: ctx, maxOutput: 1024 }, 500);
    if (!paired(f.messages)) { allPaired = false; break; }
    if (f.messages.length && f.messages[0].role !== 'user') { alwaysUser = false; break; }
  }
  ok('a tool_use is never separated from its tool_result, at any budget', allPaired);
  ok('and what is sent always begins with a user message', alwaysUser);
}

{
  const convo = [];
  for (let i = 0; i < 10; i++) convo.push(...turn(`question ${i}`, `f${i}.ts`, 'L'.repeat(20_000), `answer ${i}`));
  const roomy = fit(convo, { context: 200_000, maxOutput: 4096 }, 1000);
  ok('a conversation that fits is not touched at all',
     roomy.messages === convo && !roomy.dropped && !roomy.trimmed && !roomy.summary);

  const tight = fit(convo, { context: 30_000, maxOutput: 2048 }, 1000);
  ok('a conversation that does not fit is made to fit',
     tight.tokens <= 30_000, tight.tokens);
  ok('the recent turns survive verbatim', (() => {
    const last = tight.messages[tight.messages.length - 1];
    return last && last.content[0].text === 'answer 9';
  })());
  ok('trimming old results is tried before dropping turns', tight.trimmed > 0, tight);
}

// ── the cheapest fix first ────────────────────────────────────────────────
{
  // Big results, small questions: trimming alone should be enough, so nothing
  // should be summarised away.
  const convo = [];
  for (let i = 0; i < 12; i++) convo.push(...turn(`q${i}`, `f${i}.ts`, 'L'.repeat(6_000), `a${i}`));
  const f = fit(convo, { context: 20_000, maxOutput: 1024 }, 500);
  ok('when trimming results is enough, no turn is dropped',
     f.trimmed > 0 && f.dropped === 0, { trimmed: f.trimmed, dropped: f.dropped });
  ok('and the questions are all still there',
     f.messages.filter((m) => typeof m.content === 'string').length === 12);
}

{
  // Enormous questions that trimming cannot help with: turns must go.
  const convo = [];
  for (let i = 0; i < 12; i++) convo.push(ask(`question ${i} ` + 'W'.repeat(9_000)), say(`answer ${i}`));
  const f = fit(convo, { context: 20_000, maxOutput: 1024 }, 500);
  ok('when trimming cannot help, turns are summarised away', f.dropped > 0, f.dropped);
  ok('no more turns are dropped than needed', f.dropped < convo.length - 2, f.dropped);
  ok('and a summary is produced to stand in for them', f.summary.length > 0);
  ok('the summary mentions what was asked', f.summary.includes('question 0'), f.summary.slice(0, 120));
}

// ── the summary ───────────────────────────────────────────────────────────
{
  const [w, wr] = call('write_file', { path: 'src/App.tsx', content: 'x' });
  const [r, rr] = call('run_command', { command: 'npm test' });
  const convo = [
    ask('rename the button'),
    ...(() => { const [u, res] = call('read_file', { path: 'src/Button.tsx' }); res.content[0].content = 'code'; return [u, res]; })(),
    w, wr, r, rr,
    say('Renamed it and the tests pass.'),
  ];
  const s = summarise(convo);
  ok('the summary records what was asked', s.includes('rename the button'), s);
  ok('the summary records which files were read', s.includes('src/Button.tsx'), s);
  ok('the summary records which files were changed', s.includes('src/App.tsx'), s);
  ok('the summary records what was run', s.includes('npm test'), s);
  ok('the summary records the conclusion', s.includes('tests pass'), s);
}
ok('nothing dropped means no summary', summarise([]) === '');
ok('a summary is capped so it cannot itself overflow', (() => {
  const convo = [];
  for (let i = 0; i < 400; i++) convo.push(ask(`question number ${i} about something`), say(`answer ${i}`));
  return summarise(convo).length <= 4200;
})());
ok('a truncated summary says so',
   (() => {
     const convo = [];
     for (let i = 0; i < 400; i++) convo.push(ask(`question number ${i}`), say(`answer ${i}`));
     return summarise(convo).includes('omitted');
   })());

// ── the system-prompt block ───────────────────────────────────────────────
ok('no summary produces no block', summaryBlock('') === '');
ok('a summary is framed as history, not as instructions',
   summaryBlock('1. Asked: hi').includes('Earlier in this conversation'));
ok('and the model is told to re-read rather than trust it',
   /read a file again/i.test(summaryBlock('1. Asked: hi')));

// ── the last resort ───────────────────────────────────────────────────────
{
  // One turn, far bigger than the window on its own. It cannot be cut without
  // orphaning a tool_use, so it has to be trimmed instead.
  const [use, res] = call('read_file', { path: 'huge.ts' });
  res.content[0].content = 'H'.repeat(400_000);
  const convo = [ask('read it'), use, res];
  const f = fit(convo, { context: 10_000, maxOutput: 1024 }, 500);
  ok('a single oversized turn is trimmed rather than broken', paired(f.messages));
  ok('and it is brought under the limit', f.tokens < 10_000, f.tokens);
  ok('the model is told the result was cut',
     JSON.stringify(f.messages).includes('trimmed to fit'), f.messages[2]?.content?.[0]?.content?.slice(0, 80));
}
{
  // Nothing can save this: the question itself is the whole window.
  const convo = [ask('X'.repeat(200_000))];
  const f = fit(convo, { context: 5_000, maxOutput: 1024 }, 500);
  ok('an unfixable conversation is reported rather than silently mangled', f.over === true);
  ok('and the user\'s own words are never truncated to hide it',
     typeof f.messages[0].content === 'string' && f.messages[0].content.length === 200_000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
