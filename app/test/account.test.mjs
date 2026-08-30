// Signing in, and what the account says about itself.
//
// Three things here are worth more than the rest, and they are the reasons this
// file exists:
//
//   1. A 401 means two opposite things. On a sign-in it is a wrong password; on
//      a call carrying the stored token it is a session that has expired. One
//      says "you typed it wrong", the other says "sign in again", and telling
//      an expired session it has a bad password sends someone to change a
//      password that was always right.
//   2. A network failure is not a wrong password. A webview reports every one of
//      them identically, so the module has to be the thing that keeps them
//      apart.
//   3. `remaining_tokens` and `percent_used` are **null on an unmetered plan**.
//      `?? 0` there tells the customer paying the most that they have run out.
//      That is the bug these tests exist to prevent, and it has its own block.
//
// The network half runs against a fake `fetch` that records what it was given,
// because the assertions that matter are about the request as much as the
// answer: which URL, which header, and — twice — which header is *absent*.
import {
  accountBase, API_PATH, forgetToken, loadToken, login, looksLikeToken,
  LOW_PERCENT, LOW_TOKENS, me, mintKey, offline, planSummary, register,
  saveToken, signOut, TOKEN_KEY, verdict,
} from '../.test-build/account.js';
import { compact } from '../.test-build/usage.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const BASE = 'https://capi.vylo-tech.com';
const JWT = 'EXAMPLE-jwt-removed';

/** A store that is three lines, as `Store`'s comment promises. */
const fakeStore = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
};

/** Installs a `fetch` that answers with `reply` and records every call. */
function stubFetch(reply) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    const r = typeof reply === 'function' ? reply(calls.length - 1) : reply;
    if (r instanceof Error) throw r;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => {
        if (r.body === undefined) throw new SyntaxError('not JSON');
        return r.body;
      },
    };
  };
  return calls;
}

/** Headers as the module set them, lower-cased keys and all. */
const headersOf = (call) => call.init.headers ?? {};

// ─── where the requests go ────────────────────────────────────────────────

ok('the account API is mounted under /app/api, which the bare paths are not',
   accountBase(BASE) === `${BASE}${API_PATH}` && API_PATH === '/app/api', accountBase(BASE));
ok('a trailing slash in the gateway address does not double up',
   accountBase('https://capi.vylo-tech.com/') === `${BASE}/app/api`,
   accountBase('https://capi.vylo-tech.com/'));
ok('and neither does a pasted address with spaces around it',
   accountBase('  https://capi.vylo-tech.com//  ') === `${BASE}/app/api`);

// ─── verdicts ─────────────────────────────────────────────────────────────

ok('200 is a plain success', verdict(200).state === 'ok');
ok('201 likewise, since register may answer with one', verdict(201).state === 'ok');

// The one status where the server knows something we do not.
ok('400 carries the server\'s own validation message',
   verdict(400, 'Password must be at least 8 characters.').detail
     === 'Password must be at least 8 characters.',
   verdict(400, 'Password must be at least 8 characters.'));
ok('and the other one', verdict(400, 'Enter a valid email address.').detail
     === 'Enter a valid email address.');
ok('a 400 with nothing to say still says something',
   verdict(400).note.length > 0 && verdict(400).fix.length > 0, verdict(400));

// The heart of it. Same status, opposite meanings, decided by which secret the
// request carried rather than by what the server happened to word it as.
ok('401 on a sign-in is a wrong password',
   verdict(401, 'Incorrect email or password.', 'credentials').state === 'wrong-password');
ok('401 on a call carrying the token is an expired session, not a wrong password',
   verdict(401, 'Not signed in.', 'session').state === 'signed-out',
   verdict(401, 'Not signed in.', 'session'));
ok('the two are distinguishable, which is the whole point',
   verdict(401, '', 'credentials').state !== verdict(401, '', 'session').state);
// Wording is the server's to change; the shape of the request is not. So a 401
// carrying the *other* message must still be read from the request.
ok('and the request decides, not the wording',
   verdict(401, 'Incorrect email or password.', 'session').state === 'signed-out'
   && verdict(401, 'Not signed in.', 'credentials').state === 'wrong-password');
ok('an expired session is told to sign in again',
   /sign in again/i.test(verdict(401, '', 'session').fix), verdict(401, '', 'session').fix);

ok('409 is an email that already has an account', verdict(409).state === 'taken');
ok('and offers signing in instead of retrying', /[Ss]ign in/.test(verdict(409).fix), verdict(409).fix);
ok('403 is suspended, which retyping cannot fix', verdict(403).state === 'suspended');
ok('404 means the address is wrong, not the account',
   verdict(404).state === 'unknown' && /gateway address/.test(verdict(404).fix), verdict(404));
ok('429 is too many attempts and says the account is fine',
   verdict(429).state === 'busy' && /fine/.test(verdict(429).note), verdict(429));
ok('a 500 blames the server', verdict(500).state === 'unknown'
   && /server, not your account/.test(verdict(500).fix), verdict(500));
ok('and keeps the number without putting it in the sentence',
   verdict(502).detail === '502' && verdict(502).state === 'unknown', verdict(502));
ok('an unfamiliar status is unknown rather than a wrong password',
   verdict(418).state === 'unknown', verdict(418));
ok('and keeps whatever detail came with it',
   verdict(418, "I'm a teapot").detail === "I'm a teapot");

// `note` and `fix` are catalogue keys, so they may not be assembled at runtime:
// `t()` falls through to its key when it cannot find one, which would render an
// interpolated sentence in English inside an Arabic interface with nothing to
// report it. This is the assertion that keeps them lookup-able.
for (const s of [400, 401, 403, 404, 409, 429, 500, 502, 418]) {
  const bare = verdict(s);
  const detailed = verdict(s, 'Something the server said');
  ok(`${s} says the same sentence whatever the server said`,
     bare.note === detailed.note && bare.fix === detailed.fix,
     [bare.note, detailed.note]);
  ok(`${s} keeps the status number out of the sentence`,
     !/\d/.test(bare.note) && !/\d/.test(bare.fix), [bare.note, bare.fix]);
}
ok('and a network failure keeps the address out of its sentence',
   !offline(BASE).note.includes(BASE) && !offline(BASE).fix.includes(BASE), offline(BASE));

// A note with no fix leaves someone stuck looking at a screen.
for (const s of [400, 401, 403, 404, 409, 429, 500, 502, 418]) {
  for (const sent of ['credentials', 'session']) {
    const v = verdict(s, '', sent);
    ok(`${s} on a ${sent} call is actionable`, !!v.note && !!v.fix, v);
  }
}

// A dropped connection is the outcome with no status, and the one most likely
// to be reported as a wrong password.
ok('a network failure is its own state', offline(BASE).state === 'offline');
ok('and is not a wrong password', offline(BASE).state !== 'wrong-password');
ok('and names the address it could not reach, beside the sentence rather than inside it',
   offline(BASE).detail === BASE, offline(BASE));

// ─── the token store ──────────────────────────────────────────────────────

ok('a JWT is three base64url segments', looksLikeToken(JWT));
ok('an empty string is not a token', !looksLikeToken(''));
ok('nor is something with only two segments', !looksLikeToken('a.b'));
ok('nor a number', !looksLikeToken(7) && !looksLikeToken(null));
// The character class has a security job as well as a validation one: this is
// what would otherwise reach an Authorization header.
ok('nor anything with a newline in it, which could forge a second header',
   !looksLikeToken('aaa.bbb.ccc\r\nx-api-key: sk-vylo-stolen'));
ok('nor anything with a space', !looksLikeToken('aaa.bbb. ccc'));

{
  const store = fakeStore();
  saveToken(store, JWT);
  ok('a saved token comes back', loadToken(store) === JWT);
  ok('and is stored beside the API key, under its own name',
     store.data[TOKEN_KEY] === JWT && TOKEN_KEY === 'vylo.token', Object.keys(store.data));
  forgetToken(store);
  ok('forgetting it really removes it', loadToken(store) === '' && !(TOKEN_KEY in store.data));
}
{
  // localStorage is editable — devtools, or anything else in the webview — so
  // what comes out is not necessarily what went in.
  ok('a store holding junk reads as no token',
     loadToken(fakeStore({ [TOKEN_KEY]: 'not-a-jwt' })) === '');
  ok('an empty store reads as no token', loadToken(fakeStore()) === '');
}
{
  // Private mode makes every one of these throw.
  const angry = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
    removeItem() { throw new Error('denied'); },
  };
  ok('a store that throws reads as no token rather than crashing the app',
     loadToken(angry) === '');
  let threw = false;
  try { saveToken(angry, JWT); forgetToken(angry); } catch { threw = true; }
  ok('and writing to one is survivable too', !threw);
}

// ─── signing in ───────────────────────────────────────────────────────────

const USER = { id: 7, email: 'a@example.com', role: 'user' };

{
  const calls = stubFetch({ status: 200, body: { user: USER, token: JWT } });
  const r = await login(BASE, ' a@example.com ', 'correct horse battery');
  ok('a good sign-in returns the user and the token', r.ok && r.value.token === JWT, r);
  ok('and the user it belongs to', r.ok && r.value.user.email === 'a@example.com');
  ok('it posts to the account API and nowhere else',
     calls[0].url === `${BASE}/app/api/auth/login`, calls[0].url);
  ok('as a POST with JSON', calls[0].init.method === 'POST'
     && headersOf(calls[0])['content-type'] === 'application/json');
  // The session token authenticates the account API; the sk-vylo- key
  // authenticates the model API. A sign-in carries neither.
  ok('a sign-in sends no Authorization header, having nothing to send',
     !('authorization' in headersOf(calls[0])), headersOf(calls[0]));
  ok('and never an x-api-key', !('x-api-key' in headersOf(calls[0])));
  ok('the email is trimmed on the way out',
     JSON.parse(calls[0].init.body).email === 'a@example.com');
  // The password goes once and is not kept. Nothing that outlives the call may
  // contain it — not the result, not a note.
  ok('the password is nowhere in what comes back',
     !JSON.stringify(r).includes('correct horse battery'), JSON.stringify(r));
}
{
  const calls = stubFetch({ status: 401, body: { error: { message: 'Incorrect email or password.' } } });
  const r = await login(BASE, 'a@example.com', 'wrong');
  ok('a rejected sign-in is a wrong password', !r.ok && r.why.state === 'wrong-password', r);
  ok('and it was still only one request', calls.length === 1);
}
{
  stubFetch({ status: 200, body: { user: USER } });
  const r = await login(BASE, 'a@example.com', 'x');
  // A "success" with no token would store '' and 401 on the very next call,
  // for no reason the user could see.
  ok('a 200 with no token is a failure, not a sign-in', !r.ok && r.why.state === 'unknown', r);
}
{
  stubFetch({ status: 200, body: { user: USER, token: 'a-cookie-crumb' } });
  const r = await login(BASE, 'a@example.com', 'x');
  ok('a 200 whose token is not a JWT is refused too', !r.ok, r);
}
{
  stubFetch({ status: 200, body: { token: JWT } });
  const r = await login(BASE, 'a@example.com', 'x');
  ok('a 200 with no user is refused', !r.ok);
}
{
  stubFetch({ status: 200, body: 'not an object at all' });
  const r = await login(BASE, 'a@example.com', 'x');
  ok('a malformed body does not read as a sign-in', !r.ok && r.why.state === 'unknown', r);
}
{
  // A gateway that 500s with an HTML error page: the status is all there is.
  stubFetch({ status: 500 });
  const r = await login(BASE, 'a@example.com', 'x');
  ok('an answer that is not JSON still verdicts on its status',
     !r.ok && r.why.state === 'unknown' && /server/.test(r.why.fix), r);
}
{
  stubFetch(new TypeError('Load failed'));
  const r = await login(BASE, 'a@example.com', 'x');
  ok('a dropped connection is offline, not a wrong password',
     !r.ok && r.why.state === 'offline', r);
}

// ─── registering ──────────────────────────────────────────────────────────

{
  const calls = stubFetch({ status: 200, body: { user: USER, token: JWT } });
  const r = await register(BASE, 'a@example.com', 'correct horse battery');
  ok('registering signs you in as well', r.ok && r.value.token === JWT);
  ok('and posts to /auth/register', calls[0].url === `${BASE}/app/api/auth/register`, calls[0].url);
}
{
  stubFetch({ status: 409, body: { error: { message: 'That email is already registered.' } } });
  const r = await register(BASE, 'a@example.com', 'x');
  ok('an address that already has an account is a 409, not a bad password',
     !r.ok && r.why.state === 'taken', r);
}
{
  stubFetch({ status: 400, body: { error: { message: 'Password must be at least 8 characters.' } } });
  const r = await register(BASE, 'a@example.com', 'short');
  ok('a short password comes back as the server worded it',
     !r.ok && r.why.detail === 'Password must be at least 8 characters.', r);
  ok('and the password itself is not in the message', !JSON.stringify(r).includes('short'));
}

// ─── /me ──────────────────────────────────────────────────────────────────

const TRIAL = {
  code: 'trial', name: 'Free trial', is_trial: 1, period_end: '2026-09-27',
  monthly_tokens: 100000, rate_per_min: 5, models: 'claude-haiku-4-5',
};

{
  const calls = stubFetch({
    status: 200,
    body: {
      user: USER,
      usage: {
        plan: TRIAL, used_tokens: 40000, input_tokens: 30000, output_tokens: 10000,
        requests: 12, remaining_tokens: 60000, percent_used: 40,
      },
    },
  });
  const r = await me(BASE, JWT);
  ok('/me comes back with the user and the usage', r.ok && r.value.usage.remaining_tokens === 60000, r);
  ok('it is a GET to /me', calls[0].url === `${BASE}/app/api/me` && calls[0].init.method === 'GET',
     [calls[0].url, calls[0].init.method]);
  ok('it authenticates with the session token as a Bearer',
     headersOf(calls[0]).authorization === `Bearer ${JWT}`, headersOf(calls[0]));
  // The two secrets are not interchangeable, and this is the assertion that
  // says so about the wire rather than about the prose.
  ok('and never sends an x-api-key alongside it',
     !('x-api-key' in headersOf(calls[0])), headersOf(calls[0]));
  ok('nothing this module fetches is the model API',
     calls.every((c) => c.url.startsWith(`${BASE}/app/api`) && !c.url.includes('/v1/')),
     calls.map((c) => c.url));
}
{
  // The expired-token case, end to end. This is the one that must not read as
  // a typo.
  stubFetch({ status: 401, body: { error: { message: 'Not signed in.' } } });
  const r = await me(BASE, JWT);
  ok('an expired token makes /me answer signed-out, not wrong-password',
     !r.ok && r.why.state === 'signed-out', r);
}
{
  stubFetch({ status: 200, body: { user: USER } });
  const r = await me(BASE, JWT);
  ok('a /me with no usage still tells you who you are', r.ok && r.value.user.email === 'a@example.com');
  ok('and reports the usage as absent rather than as zero', r.ok && r.value.usage === null, r);
}
{
  stubFetch({ status: 200, body: { usage: {} } });
  const r = await me(BASE, JWT);
  ok('a /me with no user is malformed', !r.ok && r.why.state === 'unknown', r);
}

// ─── minting a key ────────────────────────────────────────────────────────

{
  const calls = stubFetch({
    status: 200,
    body: { key: 'sk-vylo-abc123 ', message: 'Copy it now; it is not shown again.' },
  });
  const r = await mintKey(BASE, JWT, 'Vylo Editor on this Mac');
  ok('minting returns the key itself', r.ok && r.value === 'sk-vylo-abc123', r);
  ok('it posts to /keys with the session token',
     calls[0].url === `${BASE}/app/api/keys` && calls[0].init.method === 'POST'
     && headersOf(calls[0]).authorization === `Bearer ${JWT}`, calls[0]);
  ok('and carries the name it was given',
     JSON.parse(calls[0].init.body).name === 'Vylo Editor on this Mac');
}
{
  stubFetch({ status: 200, body: { message: 'ok' } });
  const r = await mintKey(BASE, JWT);
  // The key is returned once and only a hash is kept, so a 200 with no key in
  // it is unrecoverable — saying so beats saving '' and 401ing on first use.
  ok('a 200 with no key in it is a failure, since there is no second chance',
     !r.ok && r.why.state === 'unknown', r);
}
{
  stubFetch({ status: 401, body: { error: { message: 'Not signed in.' } } });
  const r = await mintKey(BASE, JWT);
  ok('minting with a dead token says sign in again', !r.ok && r.why.state === 'signed-out', r);
}
{
  stubFetch({ status: 403, body: { error: { message: 'Account suspended.' } } });
  const r = await mintKey(BASE, JWT);
  ok('and a suspended account says so', !r.ok && r.why.state === 'suspended', r);
}

// ─── signing out ──────────────────────────────────────────────────────────

{
  const store = fakeStore({ [TOKEN_KEY]: JWT });
  const calls = stubFetch({ status: 200, body: { ok: true } });
  await signOut(store, BASE, JWT);
  ok('signing out forgets the token', loadToken(store) === '');
  ok('and tells the server', calls[0].url === `${BASE}/app/api/auth/logout`
     && calls[0].init.method === 'POST', calls[0]);
}
{
  // The order is the point: a sign-out that fails because the wifi dropped is a
  // sign-out that did not happen.
  const store = fakeStore({ [TOKEN_KEY]: JWT });
  stubFetch(new TypeError('Load failed'));
  let threw = false;
  try { await signOut(store, BASE, JWT); } catch { threw = true; }
  ok('a sign-out with no network still forgets the token', loadToken(store) === '' && !threw);
}

// ─── the plan, as one line ────────────────────────────────────────────────
//
// The block this file exists for. `remaining_tokens` and `percent_used` are
// null on an unmetered plan, and `?? 0` there would tell the customer paying
// the most that they have nothing left.

const usage = (over) => ({
  plan: TRIAL, used_tokens: 0, input_tokens: 0, output_tokens: 0,
  requests: 0, remaining_tokens: null, percent_used: null, ...over,
});
const MAX_PLAN = { ...TRIAL, code: 'max', name: 'Max', is_trial: 0, monthly_tokens: 15000000 };

{
  // An unmetered plan: the server sends nulls, and nulls mean "no ceiling".
  const s = planSummary({
    plan: { ...MAX_PLAN, monthly_tokens: 0 },
    used_tokens: 3400000, input_tokens: 3000000, output_tokens: 400000,
    requests: 900, remaining_tokens: null, percent_used: null,
  });
  ok('an unmetered plan is not metered', s.metered === false, s);
  ok('and has no number left rather than zero left', s.left === null, s);
  ok('and no percentage rather than zero per cent', s.percent === null, s);
  ok('and is not warned about', s.level === 'ok', s);
  ok('while still saying what it is called', s.name === 'Max');
  ok('and what it has spent', s.used === compact(3400000), s.used);
}
{
  const s = planSummary({
    plan: null, used_tokens: 0, input_tokens: 0, output_tokens: 0,
    requests: 0, remaining_tokens: null, percent_used: null,
  });
  ok('an account with no subscription is its own level', s.level === 'none', s);
  ok('and has no plan name to show', s.name === null);
  ok('which is not the same as not knowing', s.level !== 'unknown');
}
{
  for (const bad of [null, undefined, 'usage', 7, []]) {
    const s = planSummary(bad);
    // [] is an object, so it lands in the plan-less branch rather than the
    // unknown one; either way it must not render a balance.
    ok(`a ${JSON.stringify(bad) ?? 'null'} usage shows no balance`,
       s.left === null && s.percent === null && (s.level === 'unknown' || s.level === 'none'), s);
  }
  ok('and a body with nothing in it says so rather than inventing a total',
     planSummary(null).used === null, planSummary(null));
}
{
  const s = planSummary(usage({ remaining_tokens: 100000, percent_used: 0 }));
  ok('a fresh plan is at 0%', s.percent === 0 && s.level === 'ok', s);
  ok('with the whole allowance left', s.left === compact(100000), s.left);
  ok('and names its allowance', s.allowance === compact(100000), s.allowance);
  ok('a trial says it is one', s.trial === true);
  ok('and carries the reset date exactly as the server wrote it',
     s.renews === '2026-09-27', s.renews);
}
{
  const s = planSummary({ ...usage(), plan: MAX_PLAN, used_tokens: 14850000,
    remaining_tokens: 150000, percent_used: 99 });
  ok('99% used is worth warning about', s.level === 'low', s);
  ok('and still shows what is left', s.left === compact(150000), s.left);
  ok('a plan not on trial says so', s.trial === false);
}
{
  const at = planSummary({ ...usage(), plan: MAX_PLAN, used_tokens: 13500000,
    remaining_tokens: 1500000, percent_used: LOW_PERCENT });
  const under = planSummary({ ...usage(), plan: MAX_PLAN, used_tokens: 13350000,
    remaining_tokens: 1650000, percent_used: LOW_PERCENT - 1 });
  ok(`${LOW_PERCENT}% is the point it starts warning`, at.level === 'low', at);
  ok('and a percent below it is quiet', under.level === 'ok', under);
}
{
  // The floor, which is the half that catches small plans. 80% of the 100k
  // trial is quiet by percentage and is about one turn in tokens.
  const s = planSummary(usage({ used_tokens: 80000, remaining_tokens: 20000, percent_used: 80 }));
  ok('a small plan is warned about on tokens, before the percentage would',
     s.level === 'low' && s.percent < LOW_PERCENT, s);
  ok('and the floor is where it says it is',
     planSummary(usage({ used_tokens: 74000, remaining_tokens: LOW_TOKENS, percent_used: 74 }))
       .level === 'ok');
}
{
  const s = planSummary(usage({ used_tokens: 100000, remaining_tokens: 0, percent_used: 100 }));
  ok('a spent plan is out, not merely low', s.level === 'out', s);
  ok('and says zero left, which is true here', s.left === '0', s.left);
}
{
  // The server clamps. Not relying on that is the difference between a bar in
  // its track and a bar through the side of the panel.
  const s = planSummary(usage({ used_tokens: 137000, remaining_tokens: -37000, percent_used: 137 }));
  ok('a plan over its allowance is clamped to 100%', s.percent === 100, s);
  ok('and never shows a negative remainder', s.left === '0', s.left);
  ok('and is out', s.level === 'out');
}
{
  // A server that fills in one field and not the other is still understood.
  const s = planSummary(usage({ used_tokens: 60000, remaining_tokens: null, percent_used: 60 }));
  ok('a percentage with no remainder is still a metered plan', s.metered === true, s);
  ok('and the remainder is worked out from the allowance', s.left === compact(40000), s.left);
  const t = planSummary(usage({ used_tokens: 60000, remaining_tokens: 40000, percent_used: null }));
  ok('a remainder with no percentage gets one', t.percent === 60, t);
}
{
  ok('is_trial arrives as 1 from SQLite, not as true',
     planSummary(usage({ plan: { ...TRIAL, is_trial: 1 }, remaining_tokens: 1, percent_used: 1 })).trial);
  ok('and 0 is not a trial',
     !planSummary(usage({ plan: { ...TRIAL, is_trial: 0 }, remaining_tokens: 1, percent_used: 1 })).trial);
  ok('a real boolean works too',
     planSummary(usage({ plan: { ...TRIAL, is_trial: true }, remaining_tokens: 1, percent_used: 1 })).trial);
}
{
  const s = planSummary(usage({ plan: { ...TRIAL, name: '   ' }, used_tokens: 100000,
    remaining_tokens: 0, percent_used: 100 }));
  ok('a plan with no usable name is nameless rather than blank-named',
     s.name === null, s);
  ok('and is still metered and still warned about', s.metered && s.level === 'out', s);
}
{
  // One number, formatted the same way everywhere in the app.
  const s = planSummary({ ...usage(), plan: MAX_PLAN, used_tokens: 13800000,
    remaining_tokens: 1200000, percent_used: 92 });
  ok('the balance is formatted by compact(), like every other token count',
     s.left === '1.2M' && s.left === compact(1200000), s.left);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
