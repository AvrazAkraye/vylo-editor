// The seam.
//
// Every other test in this directory is a unit test over a pure module, and
// each is right about its own module. What none of them can see is whether the
// modules agree with each other — and the bugs that reach a user are almost
// always two correct pieces disagreeing at the join. So this runs the *real*
// `runAgent`, over a *real* HTTP connection, against a *real* folder on disk,
// with the real `Pending` and the real SSE assembler in between, and asserts
// the things a person would notice:
//
//   - a question produces a turn: text streams, a tool runs, the result goes
//     back, the reply completes, and the tokens are reported;
//   - the request on the wire offers exactly eight tools, and Ask mode four —
//     which is where the missing capability is actually a fact rather than a
//     claim about an exported array;
//   - a proposed edit is staged and the folder is untouched — the rule this
//     product is built on, asserted at the join rather than in a doc comment;
//   - approving it writes the file *stating the version it was built on*, and a
//     file a human changed underneath comes back as a refusal the app surfaces
//     rather than a silent overwrite. Note what this half proves and what it
//     does not: the `expect_sha256` comparison here is the harness's own
//     reimplementation in `test/e2e/rust.mjs`, so what is asserted is that the
//     frontend sends the right hash and handles the refusal. The guard itself
//     is Rust, and its test is
//     `apply_write_refuses_a_file_that_moved_since_the_change_was_prepared`
//     in `src-tauri/src/lib.rs`;
//   - `run_command` genuinely suspends until a human answers, and a refusal is
//     told to the model instead of ending the turn;
//   - a connection that dies mid-reply is retried without printing the answer
//     twice;
//   - the hop cap hands the conversation back rather than binning it;
//   - a 400 naming a smaller context window is learned and the request re-sent;
//   - stopping mid-turn keeps the text and drops the half-built tool call.
//
// What it deliberately does not do is drive the UI. There is no display here
// and no gateway key, and a headless React harness would test the wiring of
// the components rather than the behaviour of the product. The gateway is a
// script of frames (`test/e2e/gateway.mjs`) and the Tauri command layer is
// Node over a temp directory (`test/e2e/rust.mjs`); the app's own code between
// them is not stubbed at all. No network, no key, no pty — VYLO.md records
// what reading one to EOF did to Windows CI.

import { runAgent, HopLimit, Stopped, TOOLS, READ_TOOLS } from '../.test-build/agent.js';
import { Pending, sha256Hex } from '../.test-build/pending.js';
import { KEY as LIMITS_KEY } from '../.test-build/limits.js';
import { frame, startGateway, says, asks, saysAndAsks, textBlock } from './e2e/gateway.mjs';
import { openFolder, installStorage } from './e2e/rust.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastOf = (a) => a[a.length - 1];
const resultsIn = (req) => lastOf(req.body.messages).content;

installStorage();

const folders = [];
async function open(files) {
  const f = await openFolder(files);
  folders.push(f);
  return f;
}

const gw = await startGateway();

/** Everything a turn needs, with the parts a scenario cares about overridden. */
const run = (folder, extra = {}) => runAgent({
  baseUrl: gw.url,
  apiKey: 'test-key',
  model: 'claude-opus-5',
  root: folder.root,
  history: [{ role: 'user', content: 'what is in this project?' }],
  pending: extra.pending ?? new Pending(),
  askToRun: async () => 'no',
  onEvent: () => {},
  onDelta: () => {},
  ...extra,
});

try {

// ── 1. a question, and the turn it produces ───────────────────────────────
{
  const f = await open({ 'src/a.ts': 'export const a = 1;\n', 'README.md': '# demo\n' });
  gw.load([
    { stream: saysAndAsks('Let me look.', 'tu_1', 'list_tree', {}) },
    { stream: says('Two files: src/a.ts and README.md.') },
  ]);

  let shown = '';
  const events = [];
  let usage = null;
  const msgs = await run(f, {
    onDelta: (t) => { shown += t; },
    onEvent: (e) => events.push(e),
    onUsage: (u) => { usage = u; },
  });

  ok('the reply streams as it is written, in order',
     shown === 'Let me look.Two files: src/a.ts and README.md.', shown);
  ok('the tool call is announced before its result',
     events.length === 2 && events[0].kind === 'tool' && events[1].kind === 'result', events);
  ok('and the announcement names the tool and its arguments',
     events[0].text === 'list_tree({})', events[0].text);

  ok('the loop went round exactly twice — one call, one answer', gw.requests.length === 2, gw.requests.length);
  const back = resultsIn(gw.requests[1]);
  ok('the result went back under the id the model gave the call',
     back.length === 1 && back[0].type === 'tool_result' && back[0].tool_use_id === 'tu_1', back);
  ok('and it is what the folder on disk actually contains',
     JSON.parse(back[0].content).entries.map((e) => e.path).sort().join() === 'README.md,src/a.ts',
     back[0].content);

  ok('the turn ends on a completed assistant reply',
     msgs.length === 4 && lastOf(msgs).role === 'assistant'
     && lastOf(msgs).content[0].text === 'Two files: src/a.ts and README.md.', msgs.length);
  ok('both hops are billed to the turn, not just the last one',
     usage && usage.input === 200 && usage.output === 100, usage);

  // The gateway's CORS allow-list must name `anthropic-version` or every
  // request fails as the webview's generic "Load failed" — VYLO.md.
  const h = gw.requests[0].headers;
  ok('the request carries the key and the API version',
     h['x-api-key'] === 'test-key' && h['anthropic-version'] === '2023-06-01', h);
  ok('and asks for a stream', gw.requests[0].body.stream === true, gw.requests[0].body.stream);
}

// ── 2. what is on the wire is eight tools, and no more ────────────────────
//
// `modes.test.mjs` asserts the exported arrays. This asserts the request body,
// which is the only place the claim is actually cashed: the model can reach
// exactly what the JSON it was sent describes.
{
  const f = await open({ 'a.txt': 'x\n' });
  gw.load([{ stream: says('ok') }]);
  await run(f);
  const wire = gw.requests[0].body.tools.map((t) => t.name);
  ok('the request offers exactly the eight tools, in order',
     same(wire, ['list_tree', 'read_file', 'find_symbol', 'search', 'write_file', 'edit_file', 'run_command', 'remember']),
     wire);
  ok('and it is the same list the module exports', same(wire, TOOLS.map((t) => t.name)), wire);
  for (const absent of ['apply_write', 'pty_open', 'pty_write', 'pty_close', 'mcp_call', 'export_write', 'export_write_docx', 'export_write_pptx', 'export_write_video', 'save_pdf', 'reveal_path', 'open_exported', 'delete_path', 'git_commit']) {
    ok(`${absent} never reaches the wire`, !wire.includes(absent));
  }

  gw.load([{ stream: says('ok') }]);
  await run(f, { mode: 'ask' });
  const askWire = gw.requests[0].body.tools.map((t) => t.name);
  ok('Ask mode sends only the four that look',
     same(askWire, READ_TOOLS.map((t) => t.name)) && askWire.length === 4, askWire);
}

// ── 3. read a file, propose an edit: staged, and the folder untouched ──────
const staged = new Pending();
const edited = await open({
  'src/greet.ts': 'export function greet() {\n  return "hi";\n}\n',
  'notes.md': 'leave me alone\n',
});
{
  const before = edited.snapshot();
  gw.load([
    { stream: asks('r1', 'read_file', { path: 'src/greet.ts' }) },
    { stream: asks('e1', 'edit_file', { path: 'src/greet.ts', old_string: 'return "hi";', new_string: 'return "hello";' }) },
    { stream: asks('r2', 'read_file', { path: 'src/greet.ts' }) },
    { stream: says('Staged — approve the diff and I will have changed it.') },
  ]);

  let stagedEvents = 0;
  await run(edited, { pending: staged, onStaged: () => { stagedEvents++; }, maxHops: 6 });

  ok('read_file returns the bytes that are on disk',
     resultsIn(gw.requests[1])[0].content === 'export function greet() {\n  return "hi";\n}\n',
     resultsIn(gw.requests[1])[0].content);
  ok('edit_file answers that it staged rather than that it wrote',
     /Staged an edit/.test(resultsIn(gw.requests[2])[0].content)
     && /not on disk/.test(resultsIn(gw.requests[2])[0].content),
     resultsIn(gw.requests[2])[0].content);
  ok('reading the file again shows the model its own staged change',
     resultsIn(gw.requests[3])[0].content.includes('return "hello";'),
     resultsIn(gw.requests[3])[0].content);

  ok('exactly one change is waiting for a human',
     staged.size === 1 && staged.list()[0].path === 'src/greet.ts', staged.list());
  ok('and it is a change, not a new file',
     staged.list()[0].isNew === false && staged.list()[0].before.includes('"hi"'), staged.list()[0]);
  ok('the review pane was told there is something to review', stagedEvents === 1, stagedEvents);

  ok('NOTHING in the folder changed — not the edited file, not any other',
     // The count is not decoration: comparing two empty snapshots would pass
     // for the wrong reason, and this claim is the one worth being sure of.
     Object.keys(before).length === 2 && same(edited.snapshot(), before), edited.snapshot());
  ok('and the one command that writes bytes was never reached',
     !edited.reached('apply_write'), edited.names());
}

// ── 4. approving it is what writes the file ───────────────────────────────
{
  const original = 'export function greet() {\n  return "hi";\n}\n';
  const written = await staged.apply(edited.root, ['src/greet.ts']);

  ok('approving writes exactly the approved path', same(written, ['src/greet.ts']), written);
  ok('and the file on disk is now the proposal',
     edited.read('src/greet.ts') === 'export function greet() {\n  return "hello";\n}\n',
     edited.read('src/greet.ts'));
  ok('files nobody approved are still untouched', edited.read('notes.md') === 'leave me alone\n');
  ok('the change is no longer waiting', staged.size === 0, staged.size);

  const call = edited.of('apply_write')[0];
  ok('the write states the version it was prepared against, so a stale one can be refused',
     call.expectSha256 === await sha256Hex(original), call.expectSha256);
}

// ── 5. and a file that moved underneath is refused, not overwritten ────────
{
  const late = new Pending();
  gw.load([
    { stream: asks('e2', 'edit_file', { path: 'src/greet.ts', old_string: '"hello"', new_string: '"howdy"' }) },
    { stream: says('staged') },
  ]);
  await run(edited, { pending: late });

  // A human edits the same file while the diff sits in the review pane.
  edited.write('src/greet.ts', 'a person typed this instead\n');

  let err = null;
  try { await late.apply(edited.root, ['src/greet.ts']); } catch (e) { err = e; }
  ok('a diff prepared against an older version is refused', err !== null, String(err));
  ok('the refusal names the file rather than being a generic failure',
     /src[\\/]greet\.ts/.test(String(err)) && /changed on disk/.test(String(err)), String(err));
  ok('and the human\'s work is still there',
     edited.read('src/greet.ts') === 'a person typed this instead\n', edited.read('src/greet.ts'));
}

// ── 6. run_command suspends until a human answers ─────────────────────────
{
  const f = await open({ 'package.json': '{}\n' });
  gw.load([
    { stream: asks('c1', 'run_command', { command: 'npm test', reason: 'check the change' }) },
    { stream: says('You said no, so I have not run it.') },
  ]);

  let asked = null;
  let answer;
  const human = new Promise((resolve) => { answer = resolve; });
  const turnPromise = run(f, { askToRun: async (req) => { asked = req; return human; } });

  // Long enough that a loop which did not wait would have finished by now: the
  // next request is one localhost round-trip away.
  await new Promise((r) => setTimeout(r, 50));
  ok('the exact string the model asked for is what the human is shown',
     asked && asked.command === 'npm test' && asked.reason === 'check the change', asked);
  ok('the loop is genuinely suspended — no second request while it waits',
     gw.requests.length === 1, gw.requests.length);
  ok('and nothing has run', !f.reached('run_command'), f.names());

  answer('no');
  const msgs = await turnPromise;

  ok('declining does not crash the turn — it completes', lastOf(msgs).role === 'assistant', msgs.length);
  ok('the refusal is reported to the model as a result',
     resultsIn(gw.requests[1])[0].content === 'The user declined to run that command.',
     resultsIn(gw.requests[1])[0]);
  ok('and not as a tool failure it should apologise for',
     resultsIn(gw.requests[1])[0].is_error === undefined, resultsIn(gw.requests[1])[0]);
  ok('a declined command never reached the shell at all', !f.reached('run_command'), f.names());
}

// ── 7. approving it runs that string, and the output comes back ───────────
{
  const f = await open({ 'package.json': '{}\n' });
  f.run = () => ({ code: 1, stdout: '2 passing, 1 failing\n', stderr: '', timed_out: false, truncated: false });
  gw.load([
    { stream: asks('c2', 'run_command', { command: 'npm test -- --watch=false', reason: 'run the suite' }) },
    { stream: says('One test fails.') },
  ]);
  await run(f, { askToRun: async () => 'pipe' });

  const call = f.of('run_command')[0];
  ok('the approved string is the string that runs, unchanged',
     call && call.command === 'npm test -- --watch=false', call);
  ok('it runs in the open folder', call.root === f.root, call.root);
  const back = resultsIn(gw.requests[1])[0];
  ok('the exit code and the output go back to the model',
     back.content.includes('exit code: 1') && back.content.includes('2 passing, 1 failing'), back.content);
  ok('a failing test is information, not a tool error', back.is_error === undefined, back);
}

// ── 8. a connection that dies mid-reply is retried, and printed once ───────
{
  const f = await open({ 'a.txt': 'x\n' });
  const half =
    frame({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } })
    + frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    + frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'The answer is ' } });
  gw.load([{ stream: half, cut: true }, { stream: says('The answer is 42.') }]);

  let shown = '';        // a UI that honours onRestart
  let naive = '';        // one that does not, kept to prove the signal matters
  let retries = 0, restarts = 0;
  const msgs = await run(f, {
    onDelta: (t) => { shown += t; naive += t; },
    onRestart: () => { restarts++; shown = ''; },
    onRetry: () => { retries++; },
  });

  ok('the dropped connection was sent again', gw.requests.length === 2 && retries === 1, [gw.requests.length, retries]);
  ok('the half-written reply was withdrawn before it was asked for again', restarts === 1, restarts);
  ok('so the answer appears exactly once', shown === 'The answer is 42.', shown);
  ok('which is not free — without onRestart it would have been printed twice',
     naive === 'The answer is The answer is 42.', naive);
  ok('and the conversation holds one clean reply',
     msgs.length === 2 && lastOf(msgs).content[0].text === 'The answer is 42.', msgs);
}

// ── 9. the hop cap hands the work back ────────────────────────────────────
{
  const f = await open({ 'src/greet.ts': 'greet\n' });
  gw.load([
    { stream: asks('s1', 'search', { query: 'greet' }) },
    { stream: asks('s2', 'search', { query: 'hello' }) },
  ]);

  let caught = null;
  try { await run(f, { maxHops: 2 }); } catch (e) { caught = e; }

  ok('reaching the cap raises HopLimit, not a bare Error', caught instanceof HopLimit, String(caught));
  ok('and it is not mistaken for the user stopping', !(caught instanceof Stopped));
  const kept = caught?.messages ?? [];
  ok('every search the turn paid for is still in the conversation',
     kept.length === 5 && JSON.parse(kept[2].content[0].content).hits[0].path === 'src/greet.ts',
     kept.length === 5 ? kept[2].content[0].content : kept.length);
  ok('and it ends on tool results, which is a sendable request',
     lastOf(kept)?.role === 'user'
     && (lastOf(kept)?.content ?? []).every((b) => b.type === 'tool_result'), lastOf(kept));

  gw.load([{ stream: says('Found it in src/greet.ts:1.') }]);
  const after = await run(f, { history: kept, maxHops: 2 });
  ok('Continue sends exactly what the cap left behind, with nothing appended',
     same(gw.requests[0].body.messages, kept), gw.requests[0].body.messages.length);
  ok('and the resumed turn finishes rather than searching again',
     gw.requests.length === 1 && after.length === kept.length + 1, [gw.requests.length, after.length]);
}

// ── 10. a 400 naming a smaller context is learned and the request re-sent ──
{
  const store = installStorage();
  const f = await open({ 'a.txt': 'x\n' });
  gw.load([
    { status: 400, body: { error: { type: 'invalid_request_error', message: 'prompt is too long: 249890 tokens > 100000 maximum' } } },
    { stream: says('Answered on the second try.') },
  ]);

  // Big enough to fit the table's 200k window and not the 100k the gateway is
  // about to name, so the correction has to be applied by fitting again rather
  // than merely recorded.
  const long = [];
  for (let i = 0; i < 10; i++) {
    long.push({ role: 'user', content: `question ${i} ` + 'W'.repeat(45_000) });
    long.push({ role: 'assistant', content: [{ type: 'text', text: `answer ${i}` }] });
  }

  const seen = [];
  const msgs = await run(f, { history: long, onLimit: (kind, value) => seen.push([kind, value]) });

  ok('the refusal is read as the model naming its own window',
     same(seen, [['context', 100_000]]), seen);
  ok('and the request is sent again rather than the turn ending',
     gw.requests.length === 2 && lastOf(msgs).role === 'assistant', gw.requests.length);
  ok('the second request carries less conversation, so the number was acted on',
     gw.requests[1].body.messages.length < gw.requests[0].body.messages.length,
     [gw.requests[0].body.messages.length, gw.requests[1].body.messages.length]);
  ok('the number is kept, so the next session does not learn it again',
     JSON.parse(store.get(LIMITS_KEY) ?? '{}')['claude-opus-5']?.context === 100_000,
     store.get(LIMITS_KEY));
}

// ── 11. stopping mid-turn keeps the text and drops the half-built call ─────
{
  const f = await open({ 'a.txt': 'x\n' });
  const pending = new Pending();
  gw.load([{
    hold: true,
    stream:
      frame({ type: 'message_start', message: { usage: { input_tokens: 10, output_tokens: 1 } } })
      + textBlock(0, 'I will start by rewriting ')
      + frame({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'w1', name: 'write_file' } })
      + frame({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt","content":"clob' } }),
  }]);

  const stop = new AbortController();
  let shown = '';
  let caught = null;
  try {
    await run(f, {
      pending,
      signal: stop.signal,
      onDelta: (t) => { shown += t; setTimeout(() => stop.abort(), 10); },
    });
  } catch (e) { caught = e; }

  ok('stopping raises Stopped, carrying the conversation', caught instanceof Stopped, String(caught));
  ok('the text the model had already written is kept',
     lastOf(caught?.messages ?? []).role === 'assistant'
     && lastOf(caught?.messages ?? []).content === shown, caught?.messages);
  ok('the half-received tool call is not — it would fail the very next request',
     !JSON.stringify(caught?.messages ?? []).includes('tool_use')
     && !JSON.stringify(caught?.messages ?? []).includes('clob'), caught?.messages);
  ok('and nothing was staged from it', pending.size === 0, pending.size);
  ok('the folder is untouched', same(f.snapshot(), { 'a.txt': 'x\n' }), f.snapshot());
}

} finally {
  await gw.close();
  for (const f of folders) await f.remove();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
