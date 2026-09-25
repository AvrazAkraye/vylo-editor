// Research's one request: a section of a document, streamed, and brought home
// through what a long run meets on the way.
//
// The property that matters is that what comes back is the answer and only
// the answer. Thinking never reaches the text, a restarted stream never leaves
// its first half behind, a section that ran out of room says so in one
// spelling on either wire — and a Stop is a stop, at once.
//
// Second to that: the request is the one the agent loop would send. The same
// key on the same URL, effort only where the model takes it, `max_tokens` no
// larger than the model allows, and the agent loop's sentences when it fails,
// so errors.ts gives the same advice.
//
// Third: a PDF the researcher attached goes as content blocks on the wire that
// carries them, and is refused before any request on the wire that does not —
// a transcription of a file the model never saw would be stored as data.
//
// The gateway is a function. `fetch` is handed a queue of real `Response`
// objects with real streamed bodies, and each test reads back the requests that
// were actually sent.
import { readFileSync } from 'fs';
import { generate } from '../.test-build/generate.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`); cond ? pass++ : fail++; };

// ── timers and storage ────────────────────────────────────────────────────
// retry.ts's waits are real — half a second, a second — and retry.test.mjs
// covers their lengths. Here they are squashed to nothing so this file runs in
// milliseconds; what is asserted is the wait that was *chosen*, which onRetry
// reports as its third argument.
const realTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, _ms, ...args) => realTimeout(fn, 0, ...args);

// limits.ts reads and writes localStorage. A Map behind the same three calls.
const store = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
});
const LIMITS_KEY = 'vylo.limits.v1';
const learnedIn = (model) => JSON.parse(store.get(LIMITS_KEY) ?? '{}')[model] ?? {};

// ── a gateway made of literals ────────────────────────────────────────────
const enc = new TextEncoder();
/** An Anthropic frame, `event:` line and all. */
const frame = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
/** An OpenAI chunk. */
const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;

/**
 * A streamed response. Each piece is its own chunk. After the last, the body
 * closes, breaks like a dropped connection, or hangs — a body that never ends
 * and ignores the signal, which is what a Stop must not wait for.
 */
function sse(pieces, { end = 'close', signal } = {}) {
  let i = 0;
  const body = new ReadableStream({
    start(c) {
      // What a real fetch does: the body errors when the request is aborted.
      signal?.addEventListener('abort', () => c.error(new DOMException('This operation was aborted', 'AbortError')));
    },
    pull(c) {
      if (i < pieces.length) { c.enqueue(enc.encode(pieces[i++])); return undefined; }
      if (end === 'close') { c.close(); return undefined; }
      if (end === 'break') { c.error(new TypeError('The network connection was lost.')); return undefined; }
      return new Promise(() => {}); // hang
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** An error response, in the API's envelope. */
const refusal = (status, message, headers = {}) => new Response(
  JSON.stringify({ type: 'error', error: { type: 'error', message } }),
  { status, headers: { 'content-type': 'application/json', ...headers } },
);

/** A whole Anthropic turn: one text block, streamed in the pieces given. */
function turn(texts, { stop = 'end_turn', input = 120, output = 40, before = [] } = {}) {
  const at = before.length ? 1 : 0;
  return [
    frame({ type: 'message_start', message: { usage: { input_tokens: input, output_tokens: 1 } } }),
    ...before,
    frame({ type: 'content_block_start', index: at, content_block: { type: 'text', text: '' } }),
    ...texts.map((text) => frame({ type: 'content_block_delta', index: at, delta: { type: 'text_delta', text } })),
    frame({ type: 'content_block_stop', index: at }),
    frame({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: output } }),
    frame({ type: 'message_stop' }),
  ];
}

/** A whole OpenAI turn. */
function oaiTurn(texts, { finish = 'stop', extra = [] } = {}) {
  return [
    ...extra,
    ...texts.map((content) => chunk({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
    chunk({ choices: [{ index: 0, delta: {}, finish_reason: finish }] }),
    chunk({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 30 } }),
    'data: [DONE]\n\n',
  ];
}

/**
 * Installs `fetch`. Each reply is a Response, an Error to throw, or a function
 * of the request's init. Returns what was sent.
 */
function gateway(replies) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (!next) throw new Error('the test ran out of replies');
    if (next instanceof Error) throw next;
    return typeof next === 'function' ? next(init) : next;
  };
  return sent;
}

/** Everything a call reported, in order. */
function recorder() {
  const log = [];
  return {
    log,
    deltas: () => log.filter((e) => e[0] === 'text').map((e) => e[1]),
    retries: () => log.filter((e) => e[0] === 'retry').map((e) => e.slice(1)),
    restarts: () => log.filter((e) => e[0] === 'restart').length,
    hooks: {
      onText: (d) => log.push(['text', d]),
      onRetry: (attempt, of, ms) => log.push(['retry', attempt, of, ms]),
      onRestart: () => log.push(['restart']),
    },
  };
}

/** The rejection, or null. */
async function caught(p) {
  try { await p; return null; } catch (e) { return e; }
}

/** A promise that fails the test rather than hanging it. Real time, not the squashed kind. */
function within(ms, p) {
  return Promise.race([p, new Promise((resolve) => realTimeout(() => resolve('TIMED OUT'), ms))]);
}

const GW = { baseUrl: 'https://gw.test', apiKey: 'sk-gw-test', wire: 'anthropic', model: 'claude-opus-5-5' };
const OAI = { baseUrl: 'https://llm.example/api', apiKey: 'sk-other-test', wire: 'openai', model: 'claude-opus-5-5' };
const ASK = { system: 'You are an academic writer.', user: 'اكتب المقدمة.' };

// ── the request, on the Anthropic wire ────────────────────────────────────
{
  const sent = gateway([sse(turn(['مرحبا ', 'بالعالم']))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, maxTokens: 3000, efforts: { 'claude-opus-5-5': 'high' }, ...r.hooks });
  const q = sent[0];

  ok('it goes to the gateway\'s messages endpoint', q.url === 'https://gw.test/v1/messages', q.url);
  ok('with the key it was entered beside, as x-api-key', q.headers['x-api-key'] === 'sk-gw-test', q.headers);
  ok('and the version header, and no bearer token', q.headers['anthropic-version'] === '2023-06-01' && !('authorization' in q.headers), q.headers);
  ok('the system prompt is the one given', q.body.system === ASK.system, q.body.system);
  ok('one user message, exactly as given',
     JSON.stringify(q.body.messages) === JSON.stringify([{ role: 'user', content: ASK.user }]), q.body.messages);
  ok('streamed', q.body.stream === true);
  ok('no tools, not even an empty list', !('tools' in q.body), Object.keys(q.body));
  ok('max_tokens is what was asked when the model allows it', q.body.max_tokens === 3000, q.body.max_tokens);
  ok('Opus 5.5 is sent the effort chosen for it', q.body.output_config?.effort === 'high', q.body.output_config);
  ok('the text is the text, joined', out.text === 'مرحبا بالعالم', out.text);
  ok('it arrived delta by delta', JSON.stringify(r.deltas()) === JSON.stringify(['مرحبا ', 'بالعالم']), r.deltas());
  ok('the stop reason is the model\'s', out.stopReason === 'end_turn', out.stopReason);
  ok('usage folds the start and the end of the stream',
     out.usage.input === 120 && out.usage.output === 40, out.usage);
  ok('nothing was retried or restarted', r.retries().length === 0 && r.restarts() === 0, r.log);
}
{
  // The gateway applies its own default when the field is missing, and runs
  // Opus 5.5 at `low` for another product — so a level is always sent.
  const sent = gateway([sse(turn(['x']))]);
  await generate(GW, { ...ASK });
  ok('with no choice made, Opus 5.5 is still sent its own default, never nothing',
     sent[0].body.output_config?.effort === 'medium', sent[0].body.output_config);
}
{
  // The one wrong answer that fails every request: a level sent to Haiku.
  const sent = gateway([sse(turn(['x']))]);
  await generate({ ...GW, model: 'claude-haiku-4-5' }, { ...ASK, efforts: { 'claude-haiku-4-5': 'high' } });
  ok('Haiku is sent no output_config at all, even with a level stored for it',
     !('output_config' in sent[0].body), sent[0].body);
}

// ── max_tokens is lowered to the model's, never raised ────────────────────
{
  const sent = gateway([sse(turn(['x'])), sse(turn(['x'])), sse(turn(['x'])), sse(turn(['x'])), sse(turn(['x']))]);
  await generate(GW, { ...ASK, maxTokens: 100_000 });
  await generate(GW, { ...ASK });
  await generate({ ...GW, model: 'some-local-model' }, { ...ASK, maxTokens: 9000 });
  await generate(GW, { ...ASK, maxTokens: 0 });
  await generate(GW, { ...ASK, maxTokens: 2500.7 });
  ok('more than the model allows is cut to its cap', sent[0].body.max_tokens === 16_384, sent[0].body.max_tokens);
  ok('no maxTokens is the model\'s cap', sent[1].body.max_tokens === 16_384, sent[1].body.max_tokens);
  ok('an unknown model gets the safe unknown, 4096', sent[2].body.max_tokens === 4096, sent[2].body.max_tokens);
  ok('a nonsense maxTokens is ignored rather than sent', sent[3].body.max_tokens === 16_384, sent[3].body.max_tokens);
  ok('a fractional one is a whole number of tokens', sent[4].body.max_tokens === 2500, sent[4].body.max_tokens);
}

// ── the OpenAI wire ───────────────────────────────────────────────────────
{
  // A Claude model through an OpenAI-shaped provider (OpenRouter, say): the
  // model takes effort, the wire does not carry it.
  const sent = gateway([sse(oaiTurn(['The ', 'answer'], { finish: 'length' }))]);
  const r = recorder();
  const out = await generate(OAI, { ...ASK, maxTokens: 2000, efforts: { 'claude-opus-5-5': 'high' }, ...r.hooks });
  const q = sent[0];

  ok('it goes to chat completions under the provider\'s own base', q.url === 'https://llm.example/api/v1/chat/completions', q.url);
  ok('with the provider\'s key as a bearer token', q.headers.authorization === 'Bearer sk-other-test', q.headers);
  ok('and never as x-api-key', !('x-api-key' in q.headers), q.headers);
  ok('no output_config on this wire, whatever the model', !('output_config' in q.body), q.body);
  ok('the system prompt becomes the system message, then the user\'s',
     q.body.messages[0]?.role === 'system' && q.body.messages[0]?.content === ASK.system
     && q.body.messages[1]?.role === 'user' && q.body.messages[1]?.content === ASK.user, q.body.messages);
  ok('streamed, with usage asked for', q.body.stream === true && q.body.stream_options?.include_usage === true, q.body);
  ok('max_tokens carried over', q.body.max_tokens === 2000, q.body.max_tokens);
  ok('the text arrives', out.text === 'The answer', out.text);
  ok('finish_reason "length" comes back as max_tokens, so a continuation is asked for',
     out.stopReason === 'max_tokens', out.stopReason);
  ok('usage from the last chunk, in the app\'s names', out.usage.input === 50 && out.usage.output === 30, out.usage);
}
{
  // An Anthropic-shaped proxy in front of an OpenAI-shaped model can relay the
  // other dialect's word unchanged. Still one spelling.
  gateway([sse(turn(['Cut'], { stop: 'length' }))]);
  const out = await generate(GW, { ...ASK });
  ok('"length" relayed on the Anthropic wire is max_tokens too', out.stopReason === 'max_tokens', out.stopReason);
}
{
  const sent = gateway([sse(oaiTurn(['done']))]);
  const out = await generate({ ...OAI, model: 'gpt-5' }, { ...ASK });
  ok('"stop" is end_turn', out.stopReason === 'end_turn', out.stopReason);
  ok('one request, one answer', sent.length === 1);
}

// ── a PDF: content blocks, and the wire that cannot carry one ─────────────
// A transcription is stored as the researcher's data. On a wire with no
// document block the model would transcribe a file it never saw, so the
// request is refused before it is made — not sent with a note in its place.
const PDF_BLOCKS = [
  { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0xLjcKJeLjz9MK' } },
  { type: 'text', text: 'Transcribe the attached file.' },
];
const NO_PDF = 'This provider cannot read a PDF. Save the PDF as text or as a Word file, and attach that.';
{
  const sent = gateway([sse(turn(['| Group | Mean |']))]);
  const out = await generate(GW, { ...ASK, user: PDF_BLOCKS });
  ok('on the Anthropic wire the blocks are the user message, exactly as given',
     JSON.stringify(sent[0].body.messages) === JSON.stringify([{ role: 'user', content: PDF_BLOCKS }]), sent[0].body.messages);
  ok('the system prompt still travels beside them', sent[0].body.system === ASK.system, sent[0].body.system);
  ok('and the answer is the text, as with a string', out.text === '| Group | Mean |', out.text);
}
{
  const sent = gateway([refusal(529, 'Overloaded'), sse(turn(['ok']))]);
  await generate(GW, { ...ASK, user: PDF_BLOCKS });
  ok('a retry sends the same blocks again', sent.length === 2 && JSON.stringify(sent[1].body) === JSON.stringify(sent[0].body), sent.length);
}
{
  const sent = gateway([sse(oaiTurn(['never']))]);
  const r = recorder();
  const e = await caught(generate(OAI, { ...ASK, user: PDF_BLOCKS, ...r.hooks }));
  ok('the OpenAI wire refuses a PDF before any request', sent.length === 0, sent.length);
  ok('with the sentence that says what to attach instead', e?.message === NO_PDF, e?.message);
  ok('as a plain Error, not a stop', e instanceof Error && e.name === 'Error', e?.name);
  ok('and nothing was retried', r.retries().length === 0, r.log);
}
{
  // The same refusal whatever order the blocks come in, and alone.
  const sent = gateway([sse(oaiTurn(['never'])), sse(oaiTurn(['never']))]);
  const a = await caught(generate(OAI, { ...ASK, user: [...PDF_BLOCKS].reverse() }));
  const b = await caught(generate(OAI, { ...ASK, user: [PDF_BLOCKS[0]] }));
  ok('a PDF after the text, or on its own, is refused just the same',
     sent.length === 0 && a?.message === NO_PDF && b?.message === NO_PDF, [sent.length, a?.message, b?.message]);
}
{
  const sent = gateway([sse(oaiTurn(['ok']))]);
  await generate(OAI, { ...ASK, user: [{ type: 'text', text: 'The first part.' }, { type: 'text', text: '' }, { type: 'text', text: 'The second part.' }] });
  const m = sent[0].body.messages;
  ok('text-only blocks on the OpenAI wire become one plain string, a blank line between',
     m.length === 2 && m[1].role === 'user' && m[1].content === 'The first part.\n\nThe second part.', m);
}
{
  const sent = gateway([sse(oaiTurn(['ok']))]);
  await generate(OAI, { ...ASK });
  ok('a string user message on the OpenAI wire is unchanged', sent[0].body.messages[1]?.content === ASK.user, sent[0].body.messages);
}

// ── thinking is never the text ────────────────────────────────────────────
{
  const thinking = [
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'SECRET plan of the chapter' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }),
    frame({ type: 'content_block_stop', index: 0 }),
  ];
  gateway([sse(turn(['The chapter.'], { before: thinking }))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('thinking deltas never reach onText', !r.deltas().join('').includes('SECRET'), r.deltas());
  ok('and never reach the text', out.text === 'The chapter.', out.text);
}
{
  // A gateway that synthesises frames and labels a thinking block's deltas as
  // text. The block's declared type decides, not the delta's label.
  const mislabelled = [
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SECRET reasoning' } }),
    frame({ type: 'content_block_stop', index: 0 }),
  ];
  gateway([sse(turn(['Only this.'], { before: mislabelled }))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('a thinking block whose deltas are labelled as text is still not text',
     out.text === 'Only this.' && !r.deltas().join('').includes('SECRET'), [out.text, r.deltas()]);
}
{
  const redacted = [
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'redacted_thinking', data: 'SECRET' } }),
    frame({ type: 'content_block_stop', index: 0 }),
  ];
  gateway([sse(turn(['Visible.'], { before: redacted }))]);
  const out = await generate(GW, { ...ASK });
  ok('redacted thinking is not text either', out.text === 'Visible.', out.text);
}
{
  // The OpenAI dialect's reasoning fields, as DeepSeek and OpenRouter send them.
  const reasoning = [
    chunk({ choices: [{ index: 0, delta: { reasoning_content: 'SECRET step one' }, finish_reason: null }] }),
    chunk({ choices: [{ index: 0, delta: { reasoning: 'SECRET step two' }, finish_reason: null }] }),
  ];
  gateway([sse(oaiTurn(['Answer.'], { extra: reasoning }))]);
  const r = recorder();
  const out = await generate({ ...OAI, model: 'deepseek-reasoner' }, { ...ASK, ...r.hooks });
  ok('reasoning on the OpenAI wire never reaches the text or onText',
     out.text === 'Answer.' && !r.deltas().join('').includes('SECRET'), [out.text, r.deltas()]);
}
{
  // A gateway that answers in one JSON body rather than a stream.
  gateway([new Response(JSON.stringify({
    content: [{ type: 'thinking', thinking: 'SECRET' }, { type: 'text', text: 'Whole ' }, { type: 'text', text: 'answer.' }],
    stop_reason: 'max_tokens',
    usage: { input_tokens: 9, output_tokens: 7 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('an unstreamed reply gives its text blocks only', out.text === 'Whole answer.', out.text);
  ok('handed to onText once, whole', JSON.stringify(r.deltas()) === JSON.stringify(['Whole answer.']), r.deltas());
  ok('with its stop reason and usage', out.stopReason === 'max_tokens' && out.usage.input === 9 && out.usage.output === 7, out);
}
{
  gateway([new Response(JSON.stringify({
    choices: [{ index: 0, message: { role: 'assistant', content: 'Cut sho' }, finish_reason: 'length' }],
    usage: { prompt_tokens: 4, completion_tokens: 3 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })]);
  const out = await generate(OAI, { ...ASK });
  ok('an unstreamed OpenAI reply cut short is max_tokens too', out.text === 'Cut sho' && out.stopReason === 'max_tokens', out);
}

// ── failures worth another try ────────────────────────────────────────────
{
  const sent = gateway([refusal(529, 'Overloaded'), sse(turn(['Second time.']))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('a 529 is tried again', sent.length === 2 && out.text === 'Second time.', [sent.length, out.text]);
  ok('onRetry says which attempt, of how many, and the wait chosen',
     JSON.stringify(r.retries()) === JSON.stringify([[2, 3, 500]]), r.retries());
  ok('the second request is the first, unchanged', JSON.stringify(sent[0].body) === JSON.stringify(sent[1].body));
  ok('a failure before any text is not a restart', r.restarts() === 0);
}
{
  const sent = gateway([refusal(503, 'Service Unavailable', { 'retry-after': '2' }), sse(turn(['ok']))]);
  const r = recorder();
  await generate(GW, { ...ASK, ...r.hooks });
  ok('Retry-After is what is waited, not the backoff', r.retries()[0]?.[2] === 2000 && sent.length === 2, r.retries());
}
{
  const sent = gateway([refusal(429, 'Too many requests', { 'retry-after': '0' }), sse(turn(['ok']))]);
  const out = await generate(GW, { ...ASK });
  ok('a 429 that asks for a short wait is waited out', sent.length === 2 && out.text === 'ok', sent.length);
}
{
  // The anonymous-quota case: the server asks for a minute. Waiting that long
  // with nothing on screen is worse than saying so.
  const sent = gateway([refusal(429, 'rate limit: 40000 tokens > 20000 maximum', { 'retry-after': '3600' })]);
  const r = recorder();
  const e = await caught(generate(GW, { ...ASK, ...r.hooks }));
  ok('a 429 asking for too long a wait gives up at once', sent.length === 1 && r.retries().length === 0, sent.length);
  ok('with the agent loop\'s rate-limit sentence', /^Rate limited — wait a moment\. \(rate limit: 40000/.test(String(e?.message)), e?.message);
  ok('and a rate limit is never learned as a limit of the model', !store.has(LIMITS_KEY) || !learnedIn('claude-opus-5-5').context, learnedIn('claude-opus-5-5'));
}
{
  const sent = gateway([refusal(529, 'Overloaded'), refusal(529, 'Overloaded'), refusal(529, 'Overloaded'), sse(turn(['never']))]);
  const r = recorder();
  const e = await caught(generate(GW, { ...ASK, ...r.hooks }));
  ok('three 529s and it stops: three requests, not four', sent.length === 3, sent.length);
  ok('two retries were announced', JSON.stringify(r.retries().map((x) => x[0])) === JSON.stringify([2, 3]), r.retries());
  ok('and the server\'s words are reported', e?.message === 'The server answered 529: Overloaded', e?.message);
}
{
  const sent = gateway([refusal(400, 'messages: at least one message is required')]);
  const e = await caught(generate(GW, { ...ASK }));
  ok('an ordinary 400 is reported at once', sent.length === 1 && /^The server answered 400: messages/.test(String(e?.message)), e?.message);
}
{
  const sent = gateway([new TypeError('Load failed'), sse(turn(['back']))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('a dropped connection is tried again', sent.length === 2 && out.text === 'back', sent.length);
  ok('and announced', JSON.stringify(r.retries()) === JSON.stringify([[2, 3, 500]]), r.retries());
}
{
  const sent = gateway([new TypeError('Load failed'), new TypeError('Load failed'), new TypeError('Load failed')]);
  const e = await caught(generate(GW, { ...ASK }));
  ok('an unreachable gateway is named, with the three things to check',
     sent.length === 3
     && e?.message === 'Could not reach https://gw.test. Check the address in Settings, that you are online, and that the gateway allows this app (the underlying error was: Load failed).',
     e?.message);
}
{
  const sent = gateway([refusal(401, 'invalid x-api-key')]);
  const r = recorder();
  const e = await caught(generate(GW, { ...ASK, ...r.hooks }));
  ok('a 401 is not retried', sent.length === 1 && r.retries().length === 0, sent.length);
  ok('and says what the agent loop says', e?.message === 'The API key was rejected. Check it in Settings. (invalid x-api-key)', e?.message);
}
{
  // The sentences above are copies, and a copy drifts. errors.ts matches on
  // the agent loop's wording, so the two have to stay the same.
  const agent = readFileSync(new URL('../src/agent.ts', import.meta.url), 'utf8');
  ok('agent.ts still says "The API key was rejected. Check it in Settings."',
     agent.includes('The API key was rejected. Check it in Settings. ('));
  ok('agent.ts still says "Rate limited — wait a moment."', agent.includes('Rate limited — wait a moment. ('));
  ok('agent.ts still names the three things to check when unreachable',
     agent.includes('Could not reach ${o.baseUrl}. ')
     && agent.includes('Check the address in Settings, that you are online, and that the gateway allows this app '));
  ok('agent.ts still says "The server answered"', agent.includes('The server answered ${res.status}: ${detail}'));
}

// ── a stream that fails partway starts again from nothing ─────────────────
{
  const first = [
    frame({ type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } }),
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half a sen' } }),
    frame({ type: 'error', error: { type: 'rate_limit_error', message: 'Rate limit exceeded, try again shortly' } }),
  ];
  const sent = gateway([sse(first), sse(turn(['A whole ', 'sentence.']))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('a rate-limit error frame mid-stream asks again', sent.length === 2, sent.length);
  ok('the caller is told to discard what it showed', r.restarts() === 1, r.log);
  const at = (kind) => r.log.findIndex((e) => e[0] === kind);
  ok('before the retry is announced, and after the half arrived',
     at('text') < at('restart') && at('restart') < at('retry'), r.log.map((e) => e[0]));
  const after = r.log.slice(at('restart')).filter((e) => e[0] === 'text').map((e) => e[1]).join('');
  ok('what streams after the restart is the whole answer, from the start', after === 'A whole sentence.', after);
  ok('the text returned is the second attempt\'s alone', out.text === 'A whole sentence.', out.text);
  ok('the broken attempt was paid for, so it is counted', out.usage.input === 240, out.usage);
}
{
  const sent = gateway([sse(turn(['Half']).slice(0, 3), { end: 'break' }), sse(turn(['Whole.']))]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, ...r.hooks });
  ok('a connection that dies mid-stream is asked again, from the start',
     sent.length === 2 && r.restarts() === 1 && out.text === 'Whole.', [sent.length, r.restarts(), out.text]);
}
{
  const broken = () => sse([
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }),
    frame({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }),
  ]);
  const sent = gateway([broken(), broken(), broken(), sse(turn(['never']))]);
  const r = recorder();
  const e = await caught(generate(GW, { ...ASK, ...r.hooks }));
  ok('an overload that keeps coming is reported after three tries', sent.length === 3 && e?.message === 'Overloaded', [sent.length, e?.message]);
  ok('each retry was a restart', r.restarts() === 2, r.restarts());
}
{
  const sent = gateway([sse([
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x' } }),
    frame({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } }),
  ]), sse(turn(['never']))]);
  const r = recorder();
  const e = await caught(generate(GW, { ...ASK, ...r.hooks }));
  ok('an error frame that is not transient is reported, not retried',
     sent.length === 1 && r.restarts() === 0 && e?.message === 'Your credit balance is too low', [sent.length, e?.message]);
}
{
  const first = [
    chunk({ choices: [{ index: 0, delta: { content: 'Par' }, finish_reason: null }] }),
    chunk({ error: { message: 'Rate limit reached for requests' } }),
  ];
  const sent = gateway([sse(first), sse(oaiTurn(['Full.']))]);
  const r = recorder();
  const out = await generate(OAI, { ...ASK, ...r.hooks });
  ok('the OpenAI wire restarts on a rate-limit chunk too',
     sent.length === 2 && r.restarts() === 1 && out.text === 'Full.', [sent.length, r.restarts(), out.text]);
}

// ── a limit the gateway names is learned, and the request corrected ───────
{
  store.clear();
  // The model told us before, in an earlier session, that it takes 64,000 —
  // more than the table's opening guess. Learned beats the table.
  store.set(LIMITS_KEY, JSON.stringify({ 'claude-opus-5-5': { maxOutput: 64_000, seq: 1 } }));
  const sent = gateway([
    refusal(400, 'max_tokens: 64000 > 32000, which is the maximum allowed for this model'),
    sse(turn(['Corrected.'])),
  ]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, maxTokens: 100_000, ...r.hooks });
  ok('a learned limit raises the table\'s cap', sent[0].body.max_tokens === 64_000, sent[0].body.max_tokens);
  ok('a max_tokens the model refuses is sent again, with the number it named',
     sent.length === 2 && sent[1].body.max_tokens === 32_000, sent.map((q) => q.body.max_tokens));
  ok('and the answer comes back', out.text === 'Corrected.', out.text);
  ok('the number is kept for next time', learnedIn('claude-opus-5-5').maxOutput === 32_000, learnedIn('claude-opus-5-5'));
  ok('a correction is not announced as a retry', r.retries().length === 0, r.retries());
}
{
  store.clear();
  // The correction does not spend an attempt: after it, the request still has
  // all three tries against an overloaded upstream.
  const sent = gateway([
    refusal(400, 'max_tokens: 16384 > 8192, which is the maximum allowed for this model'),
    refusal(529, 'Overloaded'),
    refusal(529, 'Overloaded'),
    sse(turn(['Third try.'])),
  ]);
  const r = recorder();
  let out = null;
  const e = await caught((async () => { out = await generate(GW, { ...ASK, ...r.hooks }); })());
  ok('a correction is not charged to the retry budget', sent.length === 4 && out?.text === 'Third try.', [sent.length, out?.text, e?.message]);
  ok('the corrected number is held through the retries', sent.slice(1).every((q) => q.body.max_tokens === 8192), sent.map((q) => q.body.max_tokens));
  ok('the retries count from the corrected request', JSON.stringify(r.retries().map((x) => x[0])) === JSON.stringify([2, 3]), r.retries());
}
{
  store.clear();
  const refuse = () => refusal(400, 'max_tokens: 16384 > 8192, which is the maximum allowed for this model');
  const sent = gateway([refuse(), refuse(), refuse()]);
  const e = await caught(generate(GW, { ...ASK }));
  ok('a limit corrected and refused again is reported, not corrected for ever', sent.length === 2, sent.length);
  ok('in the gateway\'s own words', /^The server answered 400: max_tokens/.test(String(e?.message)), e?.message);
}
{
  store.clear();
  // A gateway that names a different number every time. Each correction
  // would change the request, so only the once-per-kind rule ends it.
  const sent = gateway([
    refusal(400, 'max_tokens: 16384 > 8192, which is the maximum allowed for this model'),
    refusal(400, 'max_tokens: 8192 > 4096, which is the maximum allowed for this model'),
    refusal(400, 'max_tokens: 4096 > 2048, which is the maximum allowed for this model'),
    sse(turn(['never'])),
  ]);
  const e = await caught(generate(GW, { ...ASK }));
  ok('one correction per kind, however many numbers the gateway names',
     sent.length === 2 && /^The server answered 400/.test(String(e?.message)), [sent.length, e?.message]);
  store.clear();
}
{
  store.clear();
  const sent = gateway([
    refusal(400, 'max_tokens is too large: 16384. This model supports at most 4000 completion tokens'),
    sse(oaiTurn(['ok'])),
  ]);
  await generate({ ...OAI, model: 'small-model' }, { ...ASK, maxTokens: 16_384 });
  ok('the OpenAI dialect\'s wording is learned too',
     sent.length === 2 && sent[0].body.max_tokens === 4096 && sent[1].body.max_tokens === 4000,
     sent.map((q) => q.body.max_tokens));
}
{
  store.clear();
  // Input and reply together over the window. Learning the window halves the
  // cap, which is a request that fits.
  const sent = gateway([
    refusal(400, 'input length and `max_tokens` exceed context limit: 9000 + 16384 > 20000'),
    sse(turn(['Fits.'])),
  ]);
  const out = await generate(GW, { ...ASK });
  ok('a context window the gateway names is learned, and the reply fitted to it',
     sent.length === 2 && sent[1].body.max_tokens === 10_000 && out.text === 'Fits.', sent.map((q) => q.body.max_tokens));
  ok('and kept', learnedIn('claude-opus-5-5').context === 20_000, learnedIn('claude-opus-5-5'));
}
{
  store.clear();
  // A prompt too long for the window cannot be fixed by asking again: the
  // same request would earn the same 400. Learned, and reported at once.
  const sent = gateway([refusal(400, 'prompt is too long: 250000 tokens > 200000 maximum'), sse(turn(['never']))]);
  const e = await caught(generate(GW, { ...ASK }));
  ok('a correction that changes nothing is not sent', sent.length === 1, sent.length);
  ok('but the window is still learned', learnedIn('claude-opus-5-5').context === 200_000, learnedIn('claude-opus-5-5'));
  ok('and the refusal is reported', /^The server answered 400: prompt is too long/.test(String(e?.message)), e?.message);
  store.clear();
}

// ── a Stop is a stop ──────────────────────────────────────────────────────
{
  const ac = new AbortController();
  ac.abort();
  const sent = gateway([sse(turn(['never']))]);
  const e = await caught(generate(GW, { ...ASK, signal: ac.signal }));
  ok('a signal already fired sends nothing', sent.length === 0, sent.length);
  ok('and rejects with an AbortError', e?.name === 'AbortError', e?.name);
}
{
  // The body never ends and ignores the signal. The call must not wait for it.
  const ac = new AbortController();
  const sent = gateway([sse(turn(['First words ']).slice(0, 3), { end: 'hang' })]);
  const r = recorder();
  const p = caught(generate(GW, {
    ...ASK, signal: ac.signal, ...r.hooks,
    onText: (d) => { r.hooks.onText(d); realTimeout(() => ac.abort(), 5); },
  }));
  const e = await within(2000, p);
  ok('a stop mid-stream ends the call even when the body ignores it', e !== 'TIMED OUT', e);
  ok('with an AbortError', e?.name === 'AbortError', e?.name ?? e);
  ok('after the text that had arrived', r.deltas().join('') === 'First words ', r.deltas());
  ok('and it is not retried or restarted', sent.length === 1 && r.retries().length === 0 && r.restarts() === 0, r.log);
}
{
  // What a real fetch does: the body errors with the abort. That error must
  // read as a stop, not as a dropped connection worth another try.
  const ac = new AbortController();
  const sent = gateway([(init) => sse(turn(['Some ']).slice(0, 3), { end: 'hang', signal: init.signal })]);
  const r = recorder();
  const e = await within(2000, caught(generate(GW, {
    ...ASK, signal: ac.signal, ...r.hooks,
    onText: (d) => { r.hooks.onText(d); realTimeout(() => ac.abort(), 5); },
  })));
  ok('a body that errors on the stop is a stop, not a broken stream',
     e?.name === 'AbortError' && sent.length === 1 && r.restarts() === 0, [e?.name ?? e, sent.length, r.restarts()]);
}
{
  const ac = new AbortController();
  const sent = gateway([(init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
    realTimeout(() => ac.abort(), 5);
  }), sse(turn(['never']))]);
  const r = recorder();
  const e = await within(2000, caught(generate(GW, { ...ASK, signal: ac.signal, ...r.hooks })));
  ok('a stop while connecting is an AbortError, not "Could not reach"',
     e?.name === 'AbortError' && !/Could not reach/.test(String(e?.message)), e?.message ?? e);
  ok('and is not retried', sent.length === 1 && r.retries().length === 0, sent.length);
}
{
  const ac = new AbortController();
  const sent = gateway([refusal(529, 'Overloaded'), sse(turn(['never']))]);
  const e = await within(2000, caught(generate(GW, {
    ...ASK, signal: ac.signal,
    onRetry: () => ac.abort(),
  })));
  ok('a stop during the wait before a retry ends it there', e?.name === 'AbortError' && sent.length === 1, [e?.name ?? e, sent.length]);
}
{
  const ac = new AbortController();
  const e = await caught((async () => {
    gateway([sse(turn(['x']))]);
    ac.abort(new Error('the panel closed'));
    return generate(GW, { ...ASK, signal: ac.signal });
  })());
  ok('a signal aborted with a reason of its own still rejects as an AbortError', e?.name === 'AbortError', e?.name);
}

// ── server tools: the Video module's web search ───────────────────────────
// The optional `tools` goes as it is, on the Anthropic wire only; a request
// without it is byte for byte what it was; the search's own blocks —
// server_tool_use, web_search_tool_result — are never the answer; and a 4xx
// carries its status, so the caller can remember "not offered here".
const SEARCH = { type: 'web_search_20250305', name: 'web_search', max_uses: 3 };
{
  const sent = gateway([sse([
    frame({ type: 'message_start', message: { usage: { input_tokens: 900, output_tokens: 1 } } }),
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will search. ' } }),
    frame({ type: 'content_block_stop', index: 0 }),
    frame({ type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search' } }),
    frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":"University of Duhok"}' } }),
    frame({ type: 'content_block_stop', index: 1 }),
    frame({ type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', title: 'University of Duhok', url: 'https://uod.ac', encrypted_content: 'EqgfCioIARgB' }] } }),
    frame({ type: 'content_block_stop', index: 2 }),
    frame({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }),
    frame({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '{"facts":[{"label":"Founded","value":"1992","url":"https://uod.ac"}]}' } }),
    frame({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://uod.ac', title: 'UoD', cited_text: 'Founded in 1992', encrypted_index: 'Eo8B' } } }),
    frame({ type: 'content_block_stop', index: 3 }),
    frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 60 } }),
    frame({ type: 'message_stop' }),
  ])]);
  const r = recorder();
  const out = await generate(GW, { ...ASK, tools: [SEARCH], ...r.hooks });
  ok('tools: sent as given, on the Anthropic wire', JSON.stringify(sent[0].body.tools) === JSON.stringify([SEARCH]), sent[0].body.tools);
  ok('the answer is the text blocks only: no search query, no results, no citation', out.text === 'I will search. {"facts":[{"label":"Founded","value":"1992","url":"https://uod.ac"}]}'
     && !/encrypted|srvtoolu|cited_text/.test(r.deltas().join('')), out.text);
  const plain = gateway([sse(turn(['x']))]);
  await generate(GW, { ...ASK, tools: [] });
  ok('an empty tools list sends no tools field at all', !('tools' in plain[0].body), Object.keys(plain[0].body));
}
{
  const sent = gateway([new Response(JSON.stringify({
    content: [
      { type: 'text', text: 'Searching. ' },
      { type: 'server_tool_use', id: 'srvtoolu_2', name: 'web_search', input: { query: 'UoD' } },
      { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_2', content: [{ type: 'web_search_result', url: 'https://uod.ac', title: 'UoD', encrypted_content: 'x' }] },
      { type: 'text', text: '{"facts":[]}', citations: [{ type: 'web_search_result_location', url: 'https://uod.ac', cited_text: 'c' }] },
    ],
    stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 1 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } })]);
  const out = await generate(GW, { ...ASK, tools: [SEARCH] });
  ok('a gateway that does not stream: text blocks only there too', out.text === 'Searching. {"facts":[]}' && sent.length === 1, out.text);
}
{
  let fetched = 0;
  globalThis.fetch = async () => { fetched += 1; throw new Error('should not be called'); };
  const e = await caught(generate(OAI, { ...ASK, tools: [SEARCH] }));
  ok('on the OpenAI wire a request with server tools is refused before anything is sent', /cannot run server tools/.test(String(e?.message)) && fetched === 0, e?.message);
}
{
  gateway([refusal(400, 'tools.0: Input tag \'web_search_20250305\' found using \'type\' does not match any of the expected tags')]);
  const e = await caught(generate(GW, { ...ASK, tools: [SEARCH] }));
  ok('a 400 for the tool carries its status', e?.status === 400 && /answered 400/.test(e.message), [e?.status, e?.message]);
  gateway([refusal(403, 'This plan does not include web search')]);
  const e2 = await caught(generate(GW, { ...ASK, tools: [SEARCH] }));
  ok('and so does a 403', e2?.status === 403, e2?.status);
  gateway([refusal(401, 'invalid x-api-key')]);
  const e3 = await caught(generate(GW, { ...ASK }));
  ok('the old sentences are unchanged, with the status beside them', e3?.status === 401 && /^The API key was rejected/.test(e3.message), e3?.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
