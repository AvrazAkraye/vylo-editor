// What the agent is doing, while it is doing it.
//
// The interesting cases are all orderings — a retry part-way through a stream,
// a tool that stops to ask a question, a hop that produces no text at all — so
// this drives the reducer with sequences rather than checking fields one at a
// time.
import {
  IDLE, WORTH_EXPLAINING, advance, detailOf, elapsed, isSlow, line,
} from '../.test-build/progress.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const T0 = 1_000_000;
const run = (...events) => events.reduce(advance, IDLE);
const start = { kind: 'start', at: T0, maxHops: 12 };

// ── the shape of a turn ───────────────────────────────────────────────────
ok('nothing is running to begin with', IDLE.phase === 'idle');
{
  const p = run(start);
  ok('a turn begins by thinking', p.phase === 'thinking');
  ok('on the first round-trip', p.hop === 1 && p.maxHops === 12);
  ok('and remembers when it started', p.since === T0);
  ok('with nothing written and nothing run', p.written === 0 && p.ran === 0);
}
// An event before the turn starts must not start one. A late callback from an
// aborted request would otherwise raise a spinner over a finished reply.
ok('an event with no turn running is ignored',
   advance(IDLE, { kind: 'delta', chars: 10 }).phase === 'idle');
ok('and so is a tool call', advance(IDLE, { kind: 'tool', name: 'read_file', input: {} }).phase === 'idle');
ok('stopping returns to idle', run(start, { kind: 'stop' }).phase === 'idle');
ok('and nothing after a stop revives it',
   run(start, { kind: 'stop' }, { kind: 'delta', chars: 5 }).phase === 'idle');

// ── writing ──────────────────────────────────────────────────────────────
{
  const p = run(start, { kind: 'delta', chars: 20 }, { kind: 'delta', chars: 30 });
  ok('deltas mean it is writing', p.phase === 'writing');
  ok('and they add up', p.written === 50, p.written);
}

// ── tools ────────────────────────────────────────────────────────────────
{
  const p = run(start, { kind: 'tool', name: 'read_file', input: { path: 'src/a.ts' } });
  ok('a tool call is a phase of its own', p.phase === 'tool');
  ok('with the tool and the part worth reading', p.tool === 'read_file' && p.detail === 'src/a.ts');

  const after = advance(p, { kind: 'result' });
  // The loop's next act is another request, and a hop with only tool calls
  // never writes anything — so "writing" would be a lie here.
  ok('a finished tool goes back to thinking', after.phase === 'thinking');
  ok('and the tool is counted', after.ran === 1);
  ok('and no longer named', after.tool === '' && after.detail === '');
}
ok('several tools in a hop all count', (() => {
  let p = run(start);
  for (const name of ['read_file', 'search', 'read_file']) {
    p = advance(p, { kind: 'tool', name, input: {} });
    p = advance(p, { kind: 'result' });
  }
  return p.ran === 3;
})());

// ── waiting for a person ─────────────────────────────────────────────────
// The one phase that is not the app being slow, and the reason this exists.
{
  const p = run(start,
    { kind: 'tool', name: 'run_command', input: { command: 'npm test' } },
    { kind: 'ask' });
  ok('a tool that asks a question is waiting, not working', p.phase === 'waiting');
  ok('and still knows what it was asking about', p.detail === 'npm test');
  const back = advance(p, { kind: 'answered' });
  ok('an answer puts it back to running the tool', back.phase === 'tool');
  ok('answering when nothing was asked changes nothing',
     advance(run(start), { kind: 'answered' }).phase === 'thinking');
}

// ── retries ──────────────────────────────────────────────────────────────
{
  const p = run(start, { kind: 'delta', chars: 10 }, { kind: 'retry', attempt: 2, attempts: 3 });
  ok('a retry part-way through a stream shows as a retry', p.phase === 'retrying');
  ok('with which attempt it is on', p.attempt === 2 && p.attempts === 3);
  // The half-written reply is discarded by the caller, but the count of what
  // was written this turn is not reset here — it is a turn total.
  ok('and what was already written is still counted', p.written === 10);
  const next = advance(p, { kind: 'delta', chars: 5 });
  ok('the next delta clears the retry', next.phase === 'writing' && next.attempt === 0);
}
ok('a new hop clears a retry too',
   run(start, { kind: 'retry', attempt: 2, attempts: 3 }, { kind: 'hop', hop: 2 }).attempt === 0);

// ── hops ─────────────────────────────────────────────────────────────────
{
  const p = run(start, { kind: 'tool', name: 'read_file', input: {} }, { kind: 'result' },
                { kind: 'hop', hop: 2 });
  ok('a new hop is counted', p.hop === 2);
  ok('and is the model thinking again', p.phase === 'thinking');
  ok('while what the turn has done so far survives', p.ran === 1);
}

// ── compacting ───────────────────────────────────────────────────────────
ok('making room has its own phase', run(start, { kind: 'compact' }).phase === 'compacting');

// ── what the input is worth showing ──────────────────────────────────────
ok('a path', detailOf('read_file', { path: 'src/a.ts' }) === 'src/a.ts');
ok('a command', detailOf('run_command', { command: 'npm test' }) === 'npm test');
ok('a query', detailOf('search', { query: 'useState' }) === 'useState');
ok('a symbol', detailOf('find_symbol', { name: 'runAgent' }) === 'runAgent');
// `edit_file` carries both sides of a diff and `write_file` a whole file;
// neither belongs on a status line.
ok('a staged edit shows its path, not its contents',
   detailOf('edit_file', { path: 'src/a.ts', old_string: 'x'.repeat(400), new_string: 'y' }) === 'src/a.ts');
ok('a long command is cut', detailOf('run_command', { command: 'x'.repeat(300) }).length === 80);
ok('newlines in a command become spaces',
   detailOf('run_command', { command: 'a\n  b' }) === 'a b');
ok('nothing readable is nothing', detailOf('read_file', {}) === '');
ok('a missing input does not throw',
   detailOf('read_file', undefined) === '' && detailOf('read_file', null) === '');
ok('a non-string field is ignored', detailOf('read_file', { path: 42 }) === '');
ok('an unknown tool still tries the usual fields',
   detailOf('mcp__db__query', { query: 'select 1' }) === 'select 1');

// ── the line ─────────────────────────────────────────────────────────────
ok('idle says nothing', line(IDLE).text === '');
ok('thinking', line(run(start)).text === 'Thinking');
ok('writing', line(run(start, { kind: 'delta', chars: 1 })).text === 'Writing the reply');
{
  const l = line(run(start, { kind: 'tool', name: 'read_file', input: { path: 'a.ts' } }));
  ok('a tool reads as a verb and its object', l.text === 'Reading' && l.detail === 'a.ts');
  ok('and a path is not set in the mono face', l.mono === false);
}
{
  const l = line(run(start, { kind: 'tool', name: 'run_command', input: { command: 'npm test' } }));
  // A command is a string that will run, not a phrase.
  ok('a command is set in the mono face', l.mono === true, l);
}
ok('a tool whose verb is a whole sentence appends nothing', (() => {
  const l = line(run(start, { kind: 'tool', name: 'list_tree', input: { path: 'src' } }));
  return l.text === 'Listing the project' && l.detail === '';
})());
// An MCP server's tool has no entry, and its name is more use than a word that
// says nothing.
ok('an unknown tool falls back to its own name', (() => {
  const l = line(run(start, { kind: 'tool', name: 'mcp__db__query', input: {} }));
  return l.detail === 'mcp__db__query' && l.mono === true;
})());
ok('waiting is addressed to the person', line(run(start, { kind: 'ask' })).text === 'Waiting for you');
ok('a retry says which attempt', (() => {
  const l = line(run(start, { kind: 'retry', attempt: 2, attempts: 3 }));
  return l.text === 'Trying again' && l.detail === '2/3';
})());
ok('compacting says what it is doing',
   line(run(start, { kind: 'compact' })).text === 'Making room in the context');
ok('every phase produces a line', (() => {
  const phases = ['idle', 'thinking', 'writing', 'tool', 'waiting', 'retrying', 'compacting'];
  return phases.every((phase) => {
    const l = line({ ...IDLE, phase, tool: 'read_file' });
    return typeof l.text === 'string' && typeof l.detail === 'string' && typeof l.mono === 'boolean';
  });
})());

// ── elapsed ──────────────────────────────────────────────────────────────
ok('seconds under a minute', elapsed(T0, T0 + 4_000) === '4s');
ok('zero is zero, not blank', elapsed(T0, T0) === '0s');
ok('a minute and some', elapsed(T0, T0 + 72_000) === '1m 12s');
ok('seconds are padded, so the width does not jump',
   elapsed(T0, T0 + 65_000) === '1m 05s', elapsed(T0, T0 + 65_000));
ok('exactly a minute', elapsed(T0, T0 + 60_000) === '1m 00s');
// A clock that went backwards is a clock change, not a negative turn.
ok('time going backwards is not a negative duration', elapsed(T0, T0 - 5_000) === '0s');

// ── when the hint is worth showing ───────────────────────────────────────
// A turn that answers in two seconds does not need a panel about round-trips.
{
  const p = run(start);
  ok('a quick turn is not called slow', isSlow(p, T0 + 1_000) === false);
  ok('a long one is', isSlow(p, T0 + WORTH_EXPLAINING) === true);
  ok('and nothing running is never slow', isSlow(IDLE, T0 + 60_000) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
