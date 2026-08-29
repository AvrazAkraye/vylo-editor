// The SSE decoder and turn assembler, tested against the fragmentation a real
// connection produces only by luck: chunk boundaries mid-frame, and a tool
// call's arguments split into individually-invalid JSON pieces.
import { SSEDecoder, TurnAssembler } from '../.test-build/sse.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const frame = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;

/** Feed a whole stream through, cut into chunks of `size` characters. */
function run(text, size) {
  const dec = new SSEDecoder();
  const asm = new TurnAssembler();
  let streamed = '';
  for (let i = 0; i < text.length; i += size) {
    for (const ev of dec.decode(text.slice(i, i + size))) asm.push(ev, (t) => { streamed += t; });
  }
  return { asm, streamed };
}

const TEXT_TURN =
  frame({ type: 'message_start' })
  + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } })
  + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } })
  + frame({ type: 'content_block_stop', index: 0 })
  + frame({ type: 'message_delta', delta: { stop_reason: 'end_turn' } })
  + frame({ type: 'message_stop' });

// 1. text, arriving whole
{
  const { asm, streamed } = run(TEXT_TURN, TEXT_TURN.length);
  ok('text block assembles', asm.blocks()[0]?.text === 'Hello world', JSON.stringify(asm.blocks()));
  ok('deltas surface as they arrive', streamed === 'Hello world', streamed);
  ok('stop_reason read from message_delta', asm.stopReason === 'end_turn', String(asm.stopReason));
}

// 2. the same stream, one character at a time
{
  const { asm, streamed } = run(TEXT_TURN, 1);
  ok('survives a chunk boundary at every offset', asm.blocks()[0]?.text === 'Hello world', JSON.stringify(asm.blocks()));
  ok('and still streams the same text', streamed === 'Hello world', streamed);
}

// 3. a tool call whose arguments are split into invalid fragments
{
  const TOOL_TURN =
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Looking.' } })
    + frame({ type: 'content_block_stop', index: 0 })
    + frame({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'read_file' } })
    + frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"pa' } })
    + frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'th": "src/a' } })
    + frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '.ts"}' } })
    + frame({ type: 'content_block_stop', index: 1 })
    + frame({ type: 'message_delta', delta: { stop_reason: 'tool_use' } });

  const { asm, streamed } = run(TOOL_TURN, 7);
  const blocks = asm.blocks();
  ok('text and tool_use both kept, in order',
     blocks.length === 2 && blocks[0].type === 'text' && blocks[1].type === 'tool_use',
     JSON.stringify(blocks));
  ok('tool arguments parsed from the fragments',
     blocks[1]?.input?.path === 'src/a.ts', JSON.stringify(blocks[1]?.input));
  ok('tool id and name carried from content_block_start',
     blocks[1]?.id === 'tu_1' && blocks[1]?.name === 'read_file', JSON.stringify(blocks[1]));
  ok('a tool call does not leak into the visible reply', streamed === 'Looking.', streamed);
  ok('stop_reason is tool_use', asm.stopReason === 'tool_use', String(asm.stopReason));
}

// 4. a tool with no arguments sends no fragments at all — not "{}"
{
  const NO_ARGS =
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'list_tree' } })
    + frame({ type: 'content_block_stop', index: 0 });
  const { asm } = run(NO_ARGS, 5);
  ok('no-argument tool gets an empty object', JSON.stringify(asm.blocks()[0]?.input) === '{}', JSON.stringify(asm.blocks()));
}

// 5. stopping mid-turn must not keep a tool_use with no result
{
  const CUT =
    frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half a th' } })
    + frame({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'x', name: 'search' } });
  const { asm } = run(CUT, 11);
  ok('partial text is kept', asm.partialText() === 'Half a th', asm.partialText());
  ok('partial text carries no tool call', !asm.partialText().includes('search'), asm.partialText());
}

// 6. an error frame is surfaced rather than silently ending the turn
{
  const { asm } = run(frame({ type: 'error', error: { message: 'overloaded' } }), 4);
  ok('mid-stream error captured', asm.error === 'overloaded', String(asm.error));
}

// 7. \r\n framing, which is legal SSE and what some proxies emit
{
  const crlf = TEXT_TURN.replace(/\n/g, '\r\n');
  const { asm } = run(crlf, 3);
  ok('CRLF frames decode', asm.blocks()[0]?.text === 'Hello world', JSON.stringify(asm.blocks()));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
