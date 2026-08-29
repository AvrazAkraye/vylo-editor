// Which failures are worth trying again, and what survives an interrupted turn.
//
// The two halves of "a failed turn is not a dead end". Retrying the wrong thing
// is worse than not retrying at all — a bad key sent three times is the same
// answer with the useful message buried under two minutes of waiting — so most
// of this is about what is deliberately *not* retried.
import {
  MAX_ATTEMPTS, MAX_WAIT, backoffMs, pause, retryAfterMs, retryable, retryableMessage,
} from '../.test-build/retry.js';
import { keepText } from '../.test-build/agent.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── what is worth another attempt ─────────────────────────────────────────
ok('no response at all is the classic transient failure', retryable(0));
ok('a gateway restarting', retryable(502) && retryable(503) && retryable(504));
ok('an upstream overload', retryable(529));
ok('any 5xx, because none of them says the request was wrong', retryable(500) && retryable(599));
ok('a request timeout', retryable(408));
ok('rate limiting', retryable(429));

ok('a bad key is not retried', !retryable(401));
ok('no plan is not retried', !retryable(402));
ok('a suspended account is not retried', !retryable(403));
ok('a wrong address is not retried', !retryable(404));
ok('a malformed request is not retried', !retryable(400));
ok('a conversation past the context window is not retried',
   !retryable(400, 'prompt is too long: 249890 tokens > 200000 maximum'));
ok('a payload too large is not retried', !retryable(413));
ok('but a 4xx that says it is an overload is',
   retryable(400, 'overloaded_error: server is overloaded'));

// ── an error frame, which has no status ───────────────────────────────────
ok('an overload frame is retried', retryableMessage('overloaded_error'));
ok('a rate-limit frame is retried', retryableMessage('rate_limit_error: too many requests'));
ok('a timeout frame is retried', retryableMessage('upstream timed out'));
ok('a frame that says to try again is retried', retryableMessage('please try again later'));
ok('an unrecognised frame is reported, not retried',
   !retryableMessage('invalid_request_error: messages.0 is malformed'));
ok('an authentication frame is not retried', !retryableMessage('authentication_error'));

// ── how long to wait ──────────────────────────────────────────────────────
ok('the first retry is quick, because most of these are momentary',
   backoffMs(1) === 500, backoffMs(1));
ok('and the second waits longer', backoffMs(2) === 1000 && backoffMs(3) === 2000);
ok('three attempts total', MAX_ATTEMPTS === 3);

ok('Retry-After in seconds is honoured', backoffMs(1, '3') === 3000);
ok('over anything we would have chosen ourselves', backoffMs(3, '1') === 1000);
ok('Retry-After as a date is honoured', (() => {
  const now = Date.parse('2026-01-01T00:00:00Z');
  return backoffMs(1, 'Thu, 01 Jan 2026 00:00:04 GMT', now) === 4000;
})(), backoffMs(1, 'Thu, 01 Jan 2026 00:00:04 GMT', Date.parse('2026-01-01T00:00:00Z')));
ok('a date in the past means now, not a negative wait',
   backoffMs(1, 'Thu, 01 Jan 2020 00:00:00 GMT', Date.parse('2026-01-01T00:00:00Z')) === 0);
ok('nonsense in the header falls back to the backoff', backoffMs(2, 'soon') === 1000);
ok('an absent header falls back to the backoff', backoffMs(2, null) === 1000);
// Waiting a minute with no explanation is worse than saying it failed.
ok('a server asking for longer than anyone should wait is not waited for',
   backoffMs(1, '60') === -1, backoffMs(1, '60'));
ok('and the line is where it says it is', backoffMs(1, String(MAX_WAIT / 1000)) === MAX_WAIT);

ok('raw parsing: seconds', retryAfterMs('7') === 7000);
ok('raw parsing: nothing', retryAfterMs(null) === null && retryAfterMs('') === null);
ok('raw parsing: not a date', retryAfterMs('later') === null);

// ── the wait ends when the turn is stopped ────────────────────────────────
{
  const started = Date.now();
  const c = new AbortController();
  setTimeout(() => c.abort(), 10);
  await pause(5000, c.signal);
  ok('stopping ends the wait rather than leaving it running',
     Date.now() - started < 1000, Date.now() - started);
}
{
  const c = new AbortController();
  c.abort();
  const started = Date.now();
  await pause(5000, c.signal);
  ok('and an already-stopped turn does not wait at all', Date.now() - started < 50);
}
ok('a zero wait resolves', await pause(0).then(() => true));

// ── what survives an interrupted turn ─────────────────────────────────────
//
// An assistant message holding tool_use must be followed by its tool_result.
// Keeping one without the other would make the NEXT request fail, trading a
// turn that ended for a conversation that cannot continue.
const say = (text) => ({ role: 'assistant', content: [{ type: 'text', text }] });
const ask = (text) => ({ role: 'user', content: text });
const calls = (text, ids) => ({
  role: 'assistant',
  content: [
    ...(text ? [{ type: 'text', text }] : []),
    ...ids.map((id) => ({ type: 'tool_use', id, name: 'read_file', input: { path: 'a.ts' } })),
  ],
});

{
  const before = [ask('hi'), say('hello')];
  ok('a finished conversation is untouched', keepText(before) === before);
}
{
  const before = [ask('hi'), { role: 'assistant', content: 'plain string reply' }];
  ok('a plain string reply is untouched', keepText(before) === before);
}
{
  const kept = keepText([ask('read it'), calls('Let me look at that file.', ['t1'])]);
  ok('a half-finished tool call is dropped', JSON.stringify(kept).indexOf('tool_use') === -1, kept);
  ok('but what was said before it is kept',
     kept.length === 2 && kept[1].content === 'Let me look at that file.', kept);
}
{
  const kept = keepText([ask('read it'), calls('', ['t1', 't2'])]);
  ok('a tool call with nothing said is dropped whole', kept.length === 1, kept);
}
{
  // The ordinary mid-stream stop: text only, no tool call to orphan.
  const msgs = [ask('hi'), { role: 'assistant', content: 'half a sen' }];
  ok('a partial reply is not a tool call and survives', keepText(msgs) === msgs);
}
{
  // A completed hop, then a second one interrupted before its results.
  const kept = keepText([
    ask('go'),
    calls('', ['t1']),
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
    calls('Now the other one.', ['t2']),
  ]);
  ok('an earlier completed tool call is left alone',
     JSON.stringify(kept[1]).includes('"t1"') && JSON.stringify(kept).includes('tool_result'), kept);
  ok('only the unfinished one is stripped',
     !JSON.stringify(kept).includes('"t2"') && kept[3].content === 'Now the other one.', kept);
}
ok('an empty conversation does not crash', keepText([]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
