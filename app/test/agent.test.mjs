// The agent loop's two money paths: the hop cap, and a request whose budget was
// wrong for the model.
//
// Both are about the same thing — a turn that cost real money must not be
// thrown away. The cap used to `throw` a plain Error, so `history.current =
// await runAgent(...)` never ran and every file read and every tool result went
// with it; and a wrong `max_tokens` used to end the turn instead of being
// corrected from the answer that named the right one.
//
// The gateway is a function here. Every test hands `fetch` a queue of replies
// and then reads the requests that were actually sent, because what is asserted
// is mostly what is *in* the next request: the conversation carried over
// unchanged, or the corrected number.
import { runAgent, HopLimit, Stopped } from '../.test-build/agent.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── a gateway made of literals ────────────────────────────────────────────
/** A JSON (non-streaming) reply. The loop supports both transports. */
const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => (h === 'content-type' ? 'application/json' : null) },
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** An assistant turn that asks for one tool call, so the loop goes round again. */
const asksForTool = (path) => reply({
  content: [{ type: 'tool_use', id: `u_${path}`, name: 'write_file', input: { path, content: 'x' } }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 10, output_tokens: 5 },
});

const answers = (text) => reply({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
});

/** Installs `fetch`, returns the request bodies it was given. */
function gateway(replies) {
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    const next = replies.shift();
    if (!next) throw new Error('the test ran out of replies');
    return next;
  };
  return sent;
}

/** Staging, with nothing behind it — no tool here reaches the Rust side. */
const pending = {
  stageWrite: async () => ({ isNew: true }),
  stageEdit: async () => {},
  currentContent: async () => '',
};

const opts = (extra = {}) => ({
  baseUrl: 'http://gateway.test', apiKey: 'k', model: 'claude-opus-5', root: '/p',
  history: [{ role: 'user', content: 'refactor this' }],
  pending,
  askToRun: async () => 'no',
  onEvent: () => {},
  onDelta: () => {},
  ...extra,
});

const lastOf = (a) => a[a.length - 1];

// ── the hop cap keeps the work ────────────────────────────────────────────
{
  const sent = gateway([asksForTool('a.ts'), asksForTool('b.ts')]);
  let caught = null;
  try {
    await runAgent(opts({ maxHops: 2 }));
  } catch (e) {
    caught = e;
  }

  ok('reaching the hop cap raises HopLimit, not a bare Error', caught instanceof HopLimit, String(caught));
  ok('and it is not mistaken for the user stopping the turn', !(caught instanceof Stopped));
  ok('it says how many hops were spent', caught?.hops === 2 && /2 hops/.test(caught.message), caught?.message);

  const kept = caught?.messages ?? [];
  ok('the whole turn travels on the exception, not into the bin',
     kept.length === 5, kept.length);
  ok('every tool result the turn paid for is still there',
     JSON.stringify(kept).includes('u_a.ts') && JSON.stringify(kept).includes('u_b.ts'));
  ok('and the conversation ends on the tool results, which is a sendable request',
     lastOf(kept).role === 'user'
     && lastOf(kept).content.every((b) => b.type === 'tool_result'), lastOf(kept));
  ok('two requests were paid for and two were made', sent.length === 2);
}

// ── resuming is the same call again, with nothing added ───────────────────
{
  const first = gateway([asksForTool('a.ts'), asksForTool('b.ts')]);
  let stopped = null;
  try {
    await runAgent(opts({ maxHops: 2 }));
  } catch (e) {
    stopped = e;
  }
  const carried = stopped.messages;

  // This is the whole design of Continue: hand the same messages back. No
  // "please continue" is appended, because it would be a second consecutive
  // user message and it would put words in the user's mouth.
  const sent = gateway([answers('done')]);
  const after = await runAgent(opts({ maxHops: 2, history: carried }));

  ok('continuing sends exactly the conversation the cap left behind',
     JSON.stringify(sent[0].messages) === JSON.stringify(carried), sent[0].messages.length);
  ok('nothing was injected into the user half',
     sent[0].messages.length === carried.length);
  ok('no two user messages ever end up next to each other',
     sent[0].messages.every((m, i, a) => i === 0 || m.role !== a[i - 1].role));
  ok('and the resumed turn builds on the work rather than repeating it',
     after.length === carried.length + 1 && lastOf(after).role === 'assistant', after.length);
  ok('the resumed turn read nothing again — one request, one answer',
     first.length === 2 && sent.length === 1);
}

// ── continuing is a press, never automatic ────────────────────────────────
{
  // The cap has to be reachable more than once: a resumed turn that ran out
  // again must stop again, or "twelve hops" would mean "twelve hops the first
  // time". Nothing in runAgent re-enters itself; a second budget is a second
  // call, which is a second human press.
  const sent = gateway([asksForTool('a.ts'), asksForTool('b.ts')]);
  let caught = null;
  try {
    await runAgent(opts({ maxHops: 1, history: [{ role: 'user', content: 'go' }] }));
  } catch (e) { caught = e; }
  ok('a cap of one hop stops after one request', caught instanceof HopLimit && sent.length === 1, sent.length);
  ok('and the loop never went round on its own', caught.messages.length === 3, caught.messages.length);
}

// ── a limit the gateway names is learned and the request is corrected ─────
{
  const tooBig = reply({
    type: 'error',
    error: {
      type: 'invalid_request_error',
      message: 'max_tokens: 65536 > 32000, which is the maximum allowed for this model',
    },
  }, 400);
  const seen = [];
  const sent = gateway([tooBig, answers('done')]);
  await runAgent(opts({ onLimit: (kind, value) => seen.push([kind, value]) }));

  ok('a max_tokens the model refuses is sent again, corrected', sent.length === 2, sent.length);
  ok('and the corrected request carries the number the API named',
     sent[1].max_tokens === 32_000, sent[1].max_tokens);
  ok('the first request was the one that was wrong, not the second',
     sent[0].max_tokens !== sent[1].max_tokens, sent[0].max_tokens);
  ok('the correction is reported rather than being silent',
     seen.length === 1 && seen[0][0] === 'maxOutput' && seen[0][1] === 32_000, seen);
}
{
  const tooLong = reply({
    error: { message: 'prompt is too long: 249890 tokens > 100000 maximum' },
  }, 400);
  const seen = [];
  const sent = gateway([tooLong, answers('done')]);
  // A conversation far too big for the window the gateway is about to name, so
  // the correction has to be applied by fitting again, not merely stored.
  const long = [];
  for (let i = 0; i < 12; i++) {
    long.push({ role: 'user', content: `question ${i} ` + 'W'.repeat(80_000) });
    long.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] });
  }
  await runAgent(opts({ history: long, onLimit: (k, v) => seen.push([k, v]) }));

  ok('a context window the gateway names is learned', seen[0]?.[0] === 'context' && seen[0][1] === 100_000, seen);
  ok('and the conversation is fitted again to the corrected window, not just recorded',
     sent[1].messages.length < sent[0].messages.length, [sent[0].messages.length, sent[1].messages.length]);
}

// ── and it cannot loop ────────────────────────────────────────────────────
{
  // The same refusal twice. One corrective retry per limit kind per request,
  // then the failure is reported — a gateway repeating itself must not turn a
  // failed request into an unbounded bill.
  const refuse = () => reply({
    error: { message: 'max_tokens: 65536 > 32000, which is the maximum allowed for this model' },
  }, 400);
  const sent = gateway([refuse(), refuse(), refuse(), refuse()]);
  let err = null;
  try {
    await runAgent(opts());
  } catch (e) { err = e; }
  ok('a limit that is corrected and refused again is reported, not retried for ever',
     sent.length === 2, sent.length);
  ok('and what is reported is the gateway\'s own words',
     /400/.test(String(err)) && /maximum allowed/.test(String(err)), String(err));
}
{
  // A 400 that names nothing must not cost a second request: this is the same
  // rule as retry.ts's, that a request the server called wrong will still be
  // wrong the second time.
  const sent = gateway([reply({ error: { message: 'messages: at least one message is required' } }, 400)]);
  let err = null;
  try { await runAgent(opts()); } catch (e) { err = e; }
  ok('an ordinary 400 is reported at once', sent.length === 1 && /400/.test(String(err)), String(err));
}
{
  // A rate limit has the numeric shape of a context error and is not one. It
  // must take the retry path (which pauses and gives up), never the learning
  // path, or a per-minute quota becomes this model's context window for ever.
  const limited = () => ({
    ok: false,
    status: 429,
    headers: { get: (h) => (h === 'retry-after' ? '3600' : null) },
    json: async () => ({}),
    text: async () => JSON.stringify({ error: { message: 'rate limit: 40000 tokens > 20000 maximum' } }),
  });
  const sent = gateway([limited()]);
  let err = null;
  try { await runAgent(opts()); } catch (e) { err = e; }
  ok('a rate limit is never read as a limit of the model',
     sent.length === 1 && /Rate limited/.test(String(err)), String(err));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
