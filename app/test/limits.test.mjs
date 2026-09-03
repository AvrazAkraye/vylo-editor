// Learning a model's real limits from the errors that name them.
//
// Two properties decide whether this is worth having. The first is that it
// learns the right number from the two messages the API actually sends. The
// second, and the one most of this file is about, is that it learns *nothing*
// from anything else: a wrong number here is silent, permanent for as long as
// the store lives, and paid for on every later request — where a missing number
// only means the app behaves exactly as it did before this file existed.
import {
  KEY, MIN_CONTEXT, MAX_CONTEXT, MIN_OUTPUT, MAX_OUTPUT, MAX_MODELS,
  parseLimitError, plausible, learn, learnedFor, browserStore,
} from '../.test-build/limits.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** localStorage in three lines, plus a way to put something odd in it. */
const store = (raw) => {
  const map = new Map();
  if (raw !== undefined) map.set(KEY, raw);
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
};
const raw = (s) => JSON.parse(s.map.get(KEY) ?? 'null');

// ── the message shapes the API actually sends ─────────────────────────────
{
  const found = parseLimitError('prompt is too long: 249890 tokens > 200000 maximum');
  ok('an oversized prompt teaches the context window',
     found?.kind === 'context' && found.value === 200_000, found);
}
{
  const found = parseLimitError(
    'max_tokens: 65536 > 32000, which is the maximum allowed for this model',
  );
  ok('an oversized reply teaches the output cap',
     found?.kind === 'maxOutput' && found.value === 32_000, found);
}
{
  // The shape actually seen once max_tokens has been raised: the input and the
  // reply are charged against the same window, so the failure names the window.
  const found = parseLimitError(
    'input length and `max_tokens` exceed context limit: 173663 + 32000 > 200000, '
    + 'decrease input length or `max_tokens` and try again',
  );
  ok('input and reply exceeding the window together also teaches the window',
     found?.kind === 'context' && found.value === 200_000, found);
}
ok('the wording is matched however the API cases it',
   parseLimitError('Prompt Is Too Long: 300000 tokens > 200000 Maximum')?.value === 200_000);
ok('and a real message buried in a wrapper is still found',
   parseLimitError('Gateway 400: {"type":"error","error":{"message":"prompt is too long: 249890 tokens > 200000 maximum"}}')
     ?.value === 200_000);
ok('separators in the number do not defeat it',
   parseLimitError('prompt is too long: 249,890 tokens > 200,000 maximum')?.value === 200_000);

// ── messages that resemble them and are not ───────────────────────────────
// Every one of these has the numeric shape. Learning from any of them would cap
// every future request at a number that was never about the model.
ok('a rate limit is not a context window',
   parseLimitError('rate_limit_error: 40000 tokens > 20000 maximum per minute') === null,
   parseLimitError('rate_limit_error: 40000 tokens > 20000 maximum per minute'));
ok('a max_tokens complaint with no claim about the model teaches nothing',
   parseLimitError('max_tokens: 65536 > 32000') === null);
ok('a request-level cap is not the model\'s cap',
   parseLimitError('max_tokens: 65536 > 8192, which is the maximum for this API key') === null);
ok('the same words with no numbers teach nothing',
   parseLimitError('prompt is too long, please shorten it') === null);
ok('an unrelated 400 teaches nothing',
   parseLimitError('messages.1: all messages must have non-empty content') === null);
ok('an empty message teaches nothing', parseLimitError('') === null);
ok('a credit failure that happens to carry numbers teaches nothing',
   parseLimitError('Your credit balance is too low: 200 > 100 required') === null);

// ── absurd numbers ────────────────────────────────────────────────────────
// A store that says the window is 12 tokens would make every later request fail
// with nothing on screen explaining it, so an implausible number is refused at
// both ends: on the way in from a message, and on the way out of the store.
ok('a context below the floor is refused',
   parseLimitError(`prompt is too long: 99999 tokens > ${MIN_CONTEXT - 1} maximum`) === null);
ok('a context at the floor is accepted',
   parseLimitError(`prompt is too long: 99999 tokens > ${MIN_CONTEXT} maximum`)?.value === MIN_CONTEXT);
ok('an impossibly large context is refused',
   parseLimitError(`prompt is too long: 99 tokens > ${MAX_CONTEXT + 1} maximum`) === null);
ok('a nonsense output cap is refused',
   parseLimitError('max_tokens: 65536 > 0, which is the maximum allowed for this model') === null);
ok('an output cap below the floor is refused',
   parseLimitError(`max_tokens: 9 > ${MIN_OUTPUT - 1}, which is the maximum allowed for this model`) === null);
ok('an impossibly large output cap is refused',
   parseLimitError(`max_tokens: 9 > ${MAX_OUTPUT + 1}, which is the maximum allowed for this model`) === null);
ok('plausible refuses a fraction', !plausible('context', 200_000.5));
ok('plausible refuses NaN and infinity',
   !plausible('context', NaN) && !plausible('maxOutput', Infinity));
ok('plausible refuses a string that looks like a number', !plausible('context', '200000'));

// ── remembering, and using it again ───────────────────────────────────────
{
  const s = store();
  ok('a model nobody has learned anything about has nothing stored',
     Object.keys(learnedFor('claude-opus-5', s)).length === 0);
  ok('and reading it writes nothing', s.map.size === 0);

  const changed = learn('claude-opus-5', { kind: 'maxOutput', value: 32_000 }, s);
  ok('learning a new limit reports that something changed', changed === true);
  ok('and it comes back for that model', learnedFor('claude-opus-5', s).maxOutput === 32_000);
  ok('and only for that model',
     learnedFor('claude-sonnet-5', s).maxOutput === undefined);

  ok('learning the same limit again changes nothing',
     learn('claude-opus-5', { kind: 'maxOutput', value: 32_000 }, s) === false);
  ok('a different value for the same model does change something',
     learn('claude-opus-5', { kind: 'maxOutput', value: 64_000 }, s) === true);
  ok('and it replaces the old one', learnedFor('claude-opus-5', s).maxOutput === 64_000);

  learn('claude-opus-5', { kind: 'context', value: 500_000 }, s);
  const both = learnedFor('claude-opus-5', s);
  ok('the two limits are learned independently',
     both.context === 500_000 && both.maxOutput === 64_000, both);
}
{
  const s = store();
  ok('an implausible value is never stored, whatever the caller believes',
     learn('claude-opus-5', { kind: 'context', value: 12 }, s) === false);
  ok('and nothing was written', s.map.size === 0);
}

// ── the store as untrusted input ──────────────────────────────────────────
// It is editable by hand and it outlives upgrades, so what comes out is checked
// as hard as what went in.
ok('a store holding nothing parses as nothing',
   Object.keys(learnedFor('claude-opus-5', store('not json at all'))).length === 0);
ok('a store holding an array parses as nothing',
   Object.keys(learnedFor('claude-opus-5', store('[1,2,3]'))).length === 0);
ok('a stored context below the floor is ignored rather than used',
   learnedFor('m', store(JSON.stringify({ m: { context: 12, seq: 1 } }))).context === undefined);
ok('a stored value of the wrong type is ignored',
   learnedFor('m', store(JSON.stringify({ m: { context: '200000', seq: 1 } }))).context === undefined);
ok('but a believable neighbour in the same row survives',
   learnedFor('m', store(JSON.stringify({ m: { context: 12, maxOutput: 8192, seq: 1 } }))).maxOutput === 8192);
{
  const s = store(JSON.stringify({ m: { context: 12, seq: 1 } }));
  ok('a row with nothing believable left in it is dropped entirely',
     Object.keys(learnedFor('m', s)).length === 0);
  learn('m', { kind: 'context', value: 400_000 }, s);
  ok('and learning over it writes the believable value',
     learnedFor('m', s).context === 400_000 && raw(s).m.maxOutput === undefined, raw(s));
}

// ── no store at all ───────────────────────────────────────────────────────
// Under node there is no localStorage, and a webview with site data blocked
// throws on the property access itself. Neither may take a turn down with it.
ok('no storage reads as nothing learned',
   Object.keys(learnedFor('claude-opus-5', null)).length === 0);
ok('no storage cannot be learned into, and says so',
   learn('claude-opus-5', { kind: 'context', value: 400_000 }, null) === false);
ok('browserStore returns null under node rather than throwing', browserStore() === null);
{
  const throws = {
    getItem() { throw new Error('site data blocked'); },
    setItem() { throw new Error('site data blocked'); },
    removeItem() { throw new Error('site data blocked'); },
  };
  ok('a store that throws on read is the same as an empty one',
     Object.keys(learnedFor('claude-opus-5', throws)).length === 0);
  ok('a store that throws on write still corrects this request',
     learn('claude-opus-5', { kind: 'context', value: 400_000 }, throws) === true);
}

// ── the cap ───────────────────────────────────────────────────────────────
{
  // Nothing deletes a model id, so a long-lived install would otherwise
  // accumulate one row per id anyone ever typed into Settings.
  const s = store();
  for (let i = 0; i < MAX_MODELS + 5; i++) {
    learn(`model-${i}`, { kind: 'context', value: 200_000 + i }, s);
  }
  const kept = Object.keys(raw(s));
  ok('the store is capped', kept.length === MAX_MODELS, kept.length);
  ok('and it is the oldest ids that go, not the newest',
     kept.includes(`model-${MAX_MODELS + 4}`) && !kept.includes('model-0'), kept.slice(0, 3));
}

// ── the OpenAI dialect's wording, learned since providers arrived ─────────
// Without these, an added provider with a small window enters a loop the
// Anthropic wire self-heals from: believe 200k, never compact, 400, learn
// nothing, and Try again re-sends the identical request for ever.
ok('the OpenAI context wording is learned', (() => {
  const f = parseLimitError("This model's maximum context length is 8192 tokens. However, your messages resulted in 9226 tokens. Please reduce the length of the messages.");
  return f && f.kind === 'context' && f.value === 8192;
})(), parseLimitError("This model's maximum context length is 8192 tokens."));
ok('with separators', parseLimitError('maximum context length is 128,000 tokens')?.value === 128000);
ok('the OpenAI reply-cap wording is learned', (() => {
  const f = parseLimitError('max_tokens is too large: 90000. This model supports at most 8192 completion tokens, however you requested 90000.');
  return f && f.kind === 'maxOutput' && f.value === 8192;
})());
ok('"output tokens" spelling works too',
   parseLimitError('supports at most 4096 output tokens')?.kind === 'maxOutput');
// An Ollama default window is 4k, and gpt-3.5-era models are 8k. The old 10k
// floor made a small window unlearnable even when named exactly.
ok('a 4k window is learnable now', parseLimitError('maximum context length is 4096 tokens')?.value === 4096);
ok('but nonsense small still is not', parseLimitError('maximum context length is 100 tokens') === null);
ok('a rate-limit message still learns nothing',
   parseLimitError('Rate limit reached for gpt-4o: 10000 tokens per min') === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
