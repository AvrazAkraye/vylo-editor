// Speaking OpenAI's dialect.
//
// The three places the dialects genuinely differ are the three places these
// tests live: tool results changing homes, tool calls streaming as fragments
// keyed by index, and usage arriving once at the end if at all. Everything the
// assembler emits is read by the same loop that reads Anthropic replies, so
// the shapes here are pinned exactly.
import { OpenAIAssembler, fromOpenAI, stopReasonOf, toOpenAI, usageOf } from '../.test-build/openai.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── the request ───────────────────────────────────────────────────────────
{
  const body = toOpenAI({
    model: 'gpt-4o', max_tokens: 4096,
    system: 'Be brief.',
    tools: [{ name: 'read_file', description: 'Read one file.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }],
    messages: [{ role: 'user', content: 'hello' }],
    stream: true,
  });
  ok('the system prompt becomes the first message',
     body.messages[0].role === 'system' && body.messages[0].content === 'Be brief.');
  ok('a plain string stays a plain string', body.messages[1].content === 'hello');
  ok('the tool schema moves under function.parameters', (() => {
    const t = body.tools[0];
    return t.type === 'function' && t.function.name === 'read_file'
      && t.function.parameters.required[0] === 'path';
  })(), body.tools);
  ok('streaming asks for usage', body.stream === true && body.stream_options.include_usage === true);
  ok('max_tokens keeps its old name, which the compatibles know', body.max_tokens === 4096);
}
ok('no system prompt, no system message', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] });
  return b.messages[0].role === 'user';
})());
ok('no stream, no stream_options', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [] });
  return b.stream === undefined && b.stream_options === undefined;
})());
ok('no tools, no tools key', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [], tools: [] });
  return b.tools === undefined;
})());

// ── the assistant side of a tool call ─────────────────────────────────────
{
  const body = toOpenAI({
    model: 'm', max_tokens: 1,
    messages: [
      { role: 'assistant', content: [
        { type: 'text', text: 'Reading it.' },
        { type: 'tool_use', id: 'tu_1', name: 'read_file', input: { path: 'a.ts' } },
      ] },
    ],
  });
  const m = body.messages[0];
  ok('assistant text survives beside the call', m.content === 'Reading it.');
  ok('the call becomes tool_calls', m.tool_calls[0].id === 'tu_1' && m.tool_calls[0].function.name === 'read_file');
  ok('with arguments as a JSON string', m.tool_calls[0].function.arguments === '{"path":"a.ts"}');
}
ok('an assistant message that is only calls has null content', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'i', name: 'n', input: {} }] },
  ] });
  return b.messages[0].content === null && b.messages[0].tool_calls.length === 1;
})());

// ── tool results change homes ─────────────────────────────────────────────
// Anthropic puts them inside the next user message; OpenAI wants each as its
// own role:"tool" message, directly after the assistant turn that called it.
{
  const body = toOpenAI({
    model: 'm', max_tokens: 1,
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'read_file', input: {} }] },
      { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu_1', content: 'file contents' },
        { type: 'text', text: 'and also, please hurry' },
      ] },
    ],
  });
  ok('a tool_result becomes a role:tool message', body.messages[1].role === 'tool');
  ok('carrying the id it answers', body.messages[1].tool_call_id === 'tu_1');
  ok('and the content', body.messages[1].content === 'file contents');
  // The order requirement: tool messages first, the person's text after.
  ok('the tool message comes before the text the person typed alongside it',
     body.messages[2].role === 'user' && body.messages[2].content === 'and also, please hurry',
     body.messages.map((x) => x.role));
  ok('nothing else was invented', body.messages.length === 3);
}
ok('two results in one user message become two tool messages, in order', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'a', content: '1' },
      { type: 'tool_result', tool_use_id: 'b', content: '2' },
    ] },
  ] });
  return b.messages.length === 2 && b.messages[0].tool_call_id === 'a' && b.messages[1].tool_call_id === 'b';
})());
ok('a results-only user message leaves no empty user message behind', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'x' }] },
  ] });
  return b.messages.every((m) => m.role !== 'user');
})());
ok('a non-string tool result is serialised, not stringified into [object Object]', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: [{ type: 'text', text: 'x' }] }] },
  ] });
  return b.messages[0].content.includes('"x"') && !b.messages[0].content.includes('[object');
})());

// ── images ────────────────────────────────────────────────────────────────
{
  const body = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [
      { type: 'text', text: 'what is this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
    ] },
  ] });
  const parts = body.messages[0].content;
  ok('an image forces content parts', Array.isArray(parts) && parts.length === 2);
  ok('and becomes a data URL', parts[1].image_url.url === 'data:image/jpeg;base64,AAAA');
}
// Content-parts arrays are still rejected by some compatibles, so they are
// only used when an image forces the issue.
ok('text alone stays a string even when it arrived as a block', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [{ type: 'text', text: 'plain' }] },
  ] });
  return b.messages[0].content === 'plain';
})());

// ── stop reasons, in the loop's words ─────────────────────────────────────
ok('stop is end_turn', stopReasonOf('stop') === 'end_turn');
ok('length is max_tokens', stopReasonOf('length') === 'max_tokens');
ok('tool_calls is tool_use', stopReasonOf('tool_calls') === 'tool_use');
ok('content_filter ends the turn', stopReasonOf('content_filter') === 'end_turn');
ok('null is null, not a crash', stopReasonOf(null) === null && stopReasonOf(undefined) === null);
ok('an unknown reason passes through for the log', stopReasonOf('weird') === 'weird');

// ── usage, in the fields usage.ts folds ───────────────────────────────────
ok('prompt and completion tokens map across', (() => {
  const u = usageOf({ prompt_tokens: 100, completion_tokens: 20 });
  return u.input_tokens === 100 && u.output_tokens === 20;
})());
ok('cached tokens map to cache reads', usageOf({ prompt_tokens_details: { cached_tokens: 64 } }).cache_read_input_tokens === 64);
ok('missing usage is zeros, never a throw', usageOf(undefined).input_tokens === 0);

// ── the stream ────────────────────────────────────────────────────────────
const feed = (asm, chunks) => {
  let text = '';
  for (const c of chunks) asm.push(c, (t) => { text += t; });
  return text;
};

{
  const asm = new OpenAIAssembler();
  const heard = feed(asm, [
    { choices: [{ delta: { role: 'assistant' } }] },
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { usage: { prompt_tokens: 9, completion_tokens: 2 }, choices: [] },
  ]);
  ok('text deltas reach the screen as they arrive', heard === 'Hello');
  ok('and assemble into one text block', (() => {
    const b = asm.blocks();
    return b.length === 1 && b[0].type === 'text' && b[0].text === 'Hello';
  })());
  ok('the finish reason is translated', asm.stopReason === 'end_turn');
  // Folded, exactly as TurnAssembler's is: the loop sums assembler.usage with
  // add(), which reads the folded names — raw wire fields would sum as zeros.
  ok('the final usage chunk is kept, folded like the other assembler',
     asm.usage.input === 9 && asm.usage.output === 2, asm.usage);
  ok('and the half-streamed text is readable, for a mid-turn stop',
     asm.partialText() === 'Hello');
}

// The fragment dance: id and name can arrive on different chunks than the
// arguments, and two calls interleave keyed only by index.
{
  const asm = new OpenAIAssembler();
  feed(asm, [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'search', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"x"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
  const b = asm.blocks();
  ok('two interleaved calls come out as two blocks, in index order',
     b.length === 2 && b[0].name === 'read_file' && b[1].name === 'search', b);
  ok('fragmented JSON reassembles', b[0].input.path === 'a.ts' && b[1].input.query === 'x');
  ok('ids survive', b[0].id === 'call_a' && b[1].id === 'call_b');
  ok('and the stop reason is tool_use', asm.stopReason === 'tool_use');
}
ok('an id that never arrives is invented, because the loop echoes it back', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'n', arguments: '{}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
  const b = asm.blocks();
  return typeof b[0].id === 'string' && b[0].id.length > 0;
})());
ok('a tool with no arguments at all is an empty object', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'i', function: { name: 'list_tree' } }] } }] }]);
  return JSON.stringify(asm.blocks()[0].input) === '{}';
})());
ok('arguments that never finish throw the sentence the retry path knows', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [{ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'n', arguments: '{"a":' } }] } }] }]);
  try { asm.blocks(); return false; } catch (e) { return /arrived incomplete/.test(String(e)); }
})());
// A finish_reason of tool_calls with no calls would loop for ever upstream.
ok('tool_use with no actual calls becomes end_turn', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [
    { choices: [{ delta: { content: 'just text' } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]);
  asm.blocks();
  return asm.stopReason === 'end_turn';
})());
ok('text and a call in one turn keep the text first', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [
    { choices: [{ delta: { content: 'Let me look. ' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'i', function: { name: 'n', arguments: '{}' } }] } }] },
  ]);
  const b = asm.blocks();
  return b[0].type === 'text' && b[1].type === 'tool_use';
})());
ok('a streamed error chunk lands in .error, as the other assembler does', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [{ error: { message: 'insufficient_quota' } }]);
  return asm.error === 'insufficient_quota';
})());
// The review's finding: a wholly empty reply must still leave one block, or
// `content: []` lands in history and every later request is rejected on either
// wire. TurnAssembler keeps one for the same reason.
ok('a wholly empty reply leaves one empty text block, never an empty array', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [{ choices: [] }, {}]);
  const b = asm.blocks();
  return b.length === 1 && b[0].type === 'text' && b[0].text === '';
})());
// The other documented compatible quirk: calls streamed, finish says 'stop'.
// Left unrun, they sit in history as tool_use with no tool_result and 400
// every later request in the conversation.
ok('streamed calls with a stop finish still run as tool_use', (() => {
  const asm = new OpenAIAssembler();
  feed(asm, [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'n', arguments: '{}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]);
  asm.blocks();
  return asm.stopReason === 'tool_use';
})());

// ── the non-streamed reply ────────────────────────────────────────────────
{
  const r = fromOpenAI({
    choices: [{ message: { content: 'Hi.', tool_calls: [
      { id: 'c1', function: { name: 'search', arguments: '{"query":"a"}' } },
    ] }, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 5, completion_tokens: 3 },
  });
  ok('a whole reply translates to blocks',
     r.content[0].text === 'Hi.' && r.content[1].name === 'search');
  ok('with parsed arguments', r.content[1].input.query === 'a');
  ok('a translated stop reason', r.stop_reason === 'tool_use');
  ok('and translated usage', r.usage.input_tokens === 5);
}
ok('an empty whole reply also leaves one empty text block', (() => {
  const r = fromOpenAI({});
  return r.content.length === 1 && r.content[0].text === '' && r.stop_reason === null;
})());
ok('a whole reply in content parts is read, not dropped', (() => {
  const r = fromOpenAI({ choices: [{ message: { content: [{ type: 'text', text: 'parts' }] }, finish_reason: 'stop' }] });
  return r.content[0].text === 'parts';
})());
ok('a whole reply with broken arguments fails the same way the stream does', (() => {
  try {
    fromOpenAI({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'n', arguments: '{"a":' } }] } }] });
    return false;
  } catch (e) { return /arrived incomplete/.test(String(e)); }
})());
ok('a whole reply with calls and a stop finish is still tool_use', (() => {
  const r = fromOpenAI({ choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'n', arguments: '{}' } }] }, finish_reason: 'stop' }] });
  return r.stop_reason === 'tool_use';
})());

// ── the rest of the review's findings, pinned ─────────────────────────────
// An image-only message rides with an empty text block in this app, and this
// dialect rejects an empty text part outright.
ok('an empty text block beside an image is not sent', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AA' } },
      { type: 'text', text: '' },
    ] },
  ] });
  const parts = b.messages[0].content;
  return parts.length === 1 && parts[0].type === 'image_url';
})());
ok('an empty assistant turn becomes empty-string content, which is accepted', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'assistant', content: [{ type: 'text', text: '' }] },
  ] });
  return b.messages[0].content === '';
})());
// A document has no encoding on this wire. Silence asked the model about a
// file it never received; a sentence is the honest translation.
ok('a dropped PDF leaves a sentence saying so', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [
      { type: 'text', text: 'summarise this' },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } },
    ] },
  ] });
  const parts = b.messages[0].content;
  return JSON.stringify(parts).includes('cannot read documents');
})());
// The error flag has no field on this wire, so it becomes a word.
ok('a failed tool result reads as an error', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'no such file', is_error: true }] },
  ] });
  return b.messages[0].content === 'Error: no such file';
})());
ok('but not twice when it already says so', (() => {
  const b = toOpenAI({ model: 'm', max_tokens: 1, messages: [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'Error: bad', is_error: true }] },
  ] });
  return b.messages[0].content === 'Error: bad';
})());
// This dialect's prompt count INCLUDES cached tokens; the app totals
// input + cacheRead, so passing it through would bill the cached part twice.
ok('cached tokens are subtracted from input, not counted twice', (() => {
  const u = usageOf({ prompt_tokens: 10000, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 8000 } });
  return u.input_tokens === 2000 && u.cache_read_input_tokens === 8000;
})());
ok('and a count that would go negative clamps to zero',
   usageOf({ prompt_tokens: 5, prompt_tokens_details: { cached_tokens: 9 } }).input_tokens === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
