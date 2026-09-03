// Where a request may be sent, and with which key.
//
// The rule the whole feature hangs on: a key is only ever sent to the URL it
// was entered beside. Most of these tests are about that, about the URL forms
// people actually paste, and about a stored list that has gone wrong.
import {
  BUILT_IN, acceptableBase, armed, chosen, endpointFor, headersFor, newId,
  normalizeBase, read, route, write,
} from '../.test-build/providers.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// ── every form of a pasted URL means the same place ───────────────────────
for (const [pasted, want] of [
  ['https://api.openai.com', 'https://api.openai.com'],
  ['https://api.openai.com/', 'https://api.openai.com'],
  ['https://api.openai.com/v1', 'https://api.openai.com'],
  ['https://api.openai.com/v1/', 'https://api.openai.com'],
  ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com'],
  ['https://api.blackbox.ai/chat/completions', 'https://api.blackbox.ai'],
  ['https://openrouter.ai/api/v1', 'https://openrouter.ai/api'],
  ['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com'],
  ['http://localhost:11434/v1', 'http://localhost:11434'],
  ['  https://api.groq.com/openai/v1  ', 'https://api.groq.com/openai'],
]) {
  ok(`normalises ${pasted.trim()}`, normalizeBase(pasted) === want, normalizeBase(pasted));
}
ok('normalising twice is the same as once',
   normalizeBase(normalizeBase('https://api.openai.com/v1/')) === 'https://api.openai.com');

// ── which URLs are talked to at all ───────────────────────────────────────
ok('https anywhere is fine', acceptableBase('https://api.openai.com'));
// Ollama and LM Studio are the most private option there is.
ok('plain http to localhost is allowed', acceptableBase('http://localhost:11434'));
ok('and to 127.0.0.1', acceptableBase('http://127.0.0.1:1234'));
// The webview's connect-src cannot express an IPv6 literal with a wildcard
// port, so accepting ::1 here would save a provider that silently never
// connects. Refusing it keeps the code and the policy agreeing.
ok('but not the IPv6 loopback, which the policy cannot allow',
   acceptableBase('http://[::1]:11434') === false);
ok('but not to anywhere else', acceptableBase('http://api.openai.com') === false);
// A domain that merely starts with "localhost" is not the loopback.
ok('localhost.evil.dev is not localhost', acceptableBase('http://localhost.evil.dev') === false);
ok('not a URL is not acceptable', acceptableBase('api.openai.com') === false);
ok('and neither is nothing', acceptableBase('') === false);
ok('file: is refused', acceptableBase('file:///etc') === false);

// ── the two wires ─────────────────────────────────────────────────────────
{
  const oai = { baseUrl: 'https://api.openai.com', wire: 'openai', key: 'sk-x' };
  const ant = { baseUrl: 'https://api.anthropic.com', wire: 'anthropic', key: 'sk-a' };
  ok('an OpenAI-shaped provider posts to chat/completions',
     endpointFor(oai) === 'https://api.openai.com/v1/chat/completions');
  ok('an Anthropic-shaped one posts to messages',
     endpointFor(ant) === 'https://api.anthropic.com/v1/messages');
  ok('OpenAI wire is a bearer token', headersFor(oai).authorization === 'Bearer sk-x');
  ok('and no x-api-key', headersFor(oai)['x-api-key'] === undefined);
  ok('Anthropic wire is x-api-key', headersFor(ant)['x-api-key'] === 'sk-a');
  ok('with the version header', !!headersFor(ant)['anthropic-version']);
  ok('and no bearer', headersFor(ant).authorization === undefined);
}

// ── reading the stored list ───────────────────────────────────────────────
const GOOD = { id: 'p1', name: 'OpenAI', baseUrl: 'https://api.openai.com', wire: 'openai', key: 'sk', models: ['gpt-4o'] };
ok('a good record round-trips', (() => {
  const back = read(write([GOOD]));
  return back.length === 1 && back[0].name === 'OpenAI' && back[0].models.join() === 'gpt-4o';
})());
ok('nothing stored is an empty list', read(null).length === 0);
ok('corrupt JSON is an empty list', read('{{{').length === 0);
ok('a non-array is an empty list', read('{"id":"p1"}').length === 0);
// Half a provider is a key with no certain destination.
ok('a record with no URL is dropped whole', read(JSON.stringify([{ ...GOOD, baseUrl: undefined }])).length === 0);
ok('a record with an unacceptable URL is dropped', read(JSON.stringify([{ ...GOOD, baseUrl: 'http://api.x.com' }])).length === 0);
ok('an unknown wire is dropped', read(JSON.stringify([{ ...GOOD, wire: 'grpc' }])).length === 0);
ok('a duplicate id keeps the first', read(write([GOOD, { ...GOOD, name: 'Two' }])).length === 1);
// Nothing stored may impersonate the gateway.
ok('a stored record claiming the built-in id is dropped',
   read(JSON.stringify([{ ...GOOD, id: BUILT_IN }])).length === 0);
ok('the URL is normalised on the way in',
   read(JSON.stringify([{ ...GOOD, baseUrl: 'https://api.openai.com/v1/' }]))[0].baseUrl === 'https://api.openai.com');
ok('junk in the model list is dropped, models kept',
   read(JSON.stringify([{ ...GOOD, models: ['a', 3, '', ' b '] }]))[0].models.join() === 'a,b');
ok('a blank name falls back to the id',
   read(JSON.stringify([{ ...GOOD, name: '  ' }]))[0].name === 'p1');

// ── ids ───────────────────────────────────────────────────────────────────
ok('a fresh id avoids the taken ones', newId(['p1', 'p2']) === 'p3');
ok('and never the built-in id', newId([]) !== BUILT_IN);

// ── the choice ────────────────────────────────────────────────────────────
{
  const providers = [GOOD];
  ok('a stored choice is honoured', (() => {
    const c = chosen(JSON.stringify({ provider: 'p1', model: 'gpt-4o' }), providers, 'claude-x');
    return c.provider === 'p1' && c.model === 'gpt-4o';
  })());
  // A provider that was removed must not leave the composer pointing at a
  // place that no longer has a key.
  ok('a choice naming a removed provider falls back to the gateway', (() => {
    const c = chosen(JSON.stringify({ provider: 'gone', model: 'x' }), providers, 'claude-x');
    return c.provider === BUILT_IN && c.model === 'claude-x';
  })());
  ok('nothing stored is the gateway and its model', (() => {
    const c = chosen(null, providers, 'claude-x');
    return c.provider === BUILT_IN && c.model === 'claude-x';
  })());
  ok('corrupt JSON falls back too', chosen('{{{', providers, 'm').provider === BUILT_IN);
  ok('the built-in choice works with no providers at all', (() => {
    const c = chosen(JSON.stringify({ provider: BUILT_IN, model: 'claude-y' }), [], 'claude-x');
    return c.provider === BUILT_IN && c.model === 'claude-y';
  })());
}

// ── routing, which is where the key rule lives ────────────────────────────
{
  const gw = { baseUrl: 'https://capi.vylo-tech.com', apiKey: 'sk-vylo-1', model: 'claude-x' };
  const providers = [GOOD, { ...GOOD, id: 'p2', name: 'Blackbox', baseUrl: 'https://api.blackbox.ai', key: 'bb-key' }];

  const r1 = route({ provider: 'p2', model: 'blackbox-pro' }, providers, gw);
  ok('a provider request goes to that provider', r1.baseUrl === 'https://api.blackbox.ai');
  // The rule. A key travels only to the URL it was entered beside.
  ok('with that provider key and no other', r1.key === 'bb-key');
  ok('and never the gateway key', r1.key !== 'sk-vylo-1');
  ok('the wire rides along', r1.wire === 'openai' && r1.model === 'blackbox-pro');

  const r2 = route({ provider: BUILT_IN, model: 'claude-x' }, providers, gw);
  ok('the gateway request goes to the gateway', r2.baseUrl === 'https://capi.vylo-tech.com');
  ok('with the gateway key', r2.key === 'sk-vylo-1');

  // Half a fallback was the bug: the gateway URL carrying an empty key and a
  // removed provider's model. The fallback is the whole gateway or nothing.
  const r3 = route({ provider: 'ghost', model: 'llama3' }, providers, gw);
  ok('an unknown provider falls back to the gateway whole',
     r3.baseUrl === 'https://capi.vylo-tech.com' && r3.key === 'sk-vylo-1' && r3.wire === 'anthropic');
  ok('model included — the gateway does not carry llama3', r3.model === 'claude-x', r3.model);

  ok('base and key always come from one record', (() => {
    for (const p of providers) {
      const r = route({ provider: p.id, model: 'm' }, providers, gw);
      if (r.baseUrl !== p.baseUrl || r.key !== p.key) return false;
    }
    return true;
  })());
}

// ── whether a route can be sent at all ────────────────────────────────────
ok('a key arms a route', armed({ baseUrl: 'https://api.openai.com', key: 'sk' }) === true);
// Ollama and LM Studio take no key, and demanding one refuses the most
// private option there is.
ok('a local server needs none', armed({ baseUrl: 'http://localhost:11434', key: '' }) === true);
ok('an https provider with no key is not armed', armed({ baseUrl: 'https://api.openai.com', key: '' }) === false);
ok('and neither is the gateway with no key', armed({ baseUrl: 'https://capi.vylo-tech.com', key: '' }) === false);

// ── the crafted store the review found ────────────────────────────────────
// Validating the raw URL and normalising after let `https://messages` pass the
// check as one host and normalise into another. Normalise first, then judge.
for (const evil of ['https://messages', 'https://completions', 'https://v1', 'https://chat/completions']) {
  ok(`a stored record at ${evil} is dropped whole`,
     read(JSON.stringify([{ ...GOOD, baseUrl: evil }])).length === 0,
     read(JSON.stringify([{ ...GOOD, baseUrl: evil }])));
}
ok('duplicate models in a stored record are kept once',
   read(JSON.stringify([{ ...GOOD, models: ['a', 'a', 'b'] }]))[0].models.join() === 'a,b');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
