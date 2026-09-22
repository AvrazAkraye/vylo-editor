// What the app does with the answers `account.ts` gives it.
//
// Three rules, and each is here because getting it wrong is worse than not
// having built the feature at all:
//
//   1. **An empty half never overwrites a live one.** Both empty halves happen
//      in normal use — a pasted key carries no token, and a sign-in whose
//      minting failed carries no key — and the obvious assignment in either
//      direction destroys a working credential to report something that is not
//      an error.
//   2. **Signing out keeps the API key.** The key is a separate credential that
//      goes on working; clearing it would take a user's model access away as a
//      side effect of a button labelled *Sign out*.
//   3. **An unmetered plan is not an empty one.** `left` is null there, and
//      anything that renders that as a zero tells the customer paying the most
//      that they have run out. Same null, same trap, one layer up from
//      `planSummary`'s own.
//
// The plan fixtures are built through `planSummary` rather than hand-written,
// so the two halves cannot drift into agreeing with each other and disagreeing
// with the server.
import { adopted, chip as chipAt, signedOut, daysLeft} from '../.test-build/session.js';
import { planSummary } from '../.test-build/account.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const KEY = 'sk-vylo-aaaabbbbccccdddd';
const OTHER = 'sk-vylo-eeeeffffgggghhhh';
// Built from fragments: this repository is public, and a literal that
// matches a JWT is a shape scanners alert on even when the signature
// says `n0t-a-s1gnatur3`.
const JWT = ['eyJ' + 'hbGciOiJIUzI1NiJ9', 'eyJ' + 'zdWIiOiI3In0', 'n0t-a-s1gnatur3'].join('.');
const NOTHING = { apiKey: '', token: '' };

// ─── adopting a finished setup ────────────────────────────────────────────

{
  const s = adopted(NOTHING, { apiKey: KEY, token: JWT });
  ok('a sign-in that minted a key sets both secrets',
     s.apiKey === KEY && s.token === JWT, s);
}
{
  // The paste path. `SignIn` calls `onSignedIn('', k)` for it, and this person
  // may have no account on this gateway at all.
  const s = adopted({ apiKey: '', token: JWT }, { apiKey: KEY, token: '' });
  ok('a pasted key does not sign anybody out', s.token === JWT, s);
  ok('and it is still the key that gets stored', s.apiKey === KEY, s);
}
{
  // The one that reads backwards: signed in, mint failed. `SignIn` hands the
  // token up with an empty key precisely so the session is not lost, and the
  // empty key must not land on the working one.
  const s = adopted({ apiKey: KEY, token: '' }, { apiKey: '', token: JWT });
  ok('a sign-in whose minting failed keeps the key already held', s.apiKey === KEY, s);
  ok('and is still a sign-in', s.token === JWT, s);
}
{
  // Signing in again on a machine that already has both. This is the retry
  // offered after a failed mint, so the new key is the point of doing it.
  const s = adopted({ apiKey: KEY, token: JWT }, { apiKey: OTHER, token: JWT });
  ok('a fresh key replaces an existing one', s.apiKey === OTHER, s);
}
{
  const s = adopted({ apiKey: KEY, token: JWT }, NOTHING);
  ok('a setup carrying nothing changes nothing',
     s.apiKey === KEY && s.token === JWT, s);
}
{
  const have = { apiKey: KEY, token: JWT };
  adopted(have, { apiKey: OTHER, token: '' });
  ok('and the secrets handed in are not mutated',
     have.apiKey === KEY && have.token === JWT, have);
}

// ─── signing out ──────────────────────────────────────────────────────────

{
  const s = signedOut({ apiKey: KEY, token: JWT });
  ok('signing out clears the session token', s.token === '', s);
  // The whole reason this function is not `setToken('')` written inline.
  ok('and does NOT clear the API key', s.apiKey === KEY, s);
}
{
  const s = signedOut(NOTHING);
  ok('signing out with nothing to sign out of is harmless',
     s.apiKey === '' && s.token === '', s);
}

// ─── the status-bar chip ──────────────────────────────────────────────────

// `chip` reads the clock, because a renewal inside the next week outranks the
// token balance. So every call here pins it. It did not, and that was a test
// that failed on a *date*: the fixture below carries `period_end: 2026-09-30`,
// which was a comfortable month away when it was written and was seven days
// away on the morning of the 22nd. Five assertions about the token balance
// started reading `tail: 'days'` months after anything in this file changed.
const T0 = Date.parse('2026-09-01T00:00:00Z');
const chip = (plan, now = T0) => chipAt(plan, now);

const usage = (plan, rest = {}) => ({
  plan, used_tokens: 0, input_tokens: 0, output_tokens: 0, requests: 0,
  remaining_tokens: null, percent_used: null, ...rest,
});
const PLAN = {
  code: 'pro', name: 'Pro', is_trial: 0, period_end: '2026-09-30',
  monthly_tokens: 1_000_000, rate_per_min: 60, models: 'claude-sonnet-5',
};

ok('nothing signed in draws no chip', chip(null) === null);
{
  // `planSummary` answers `unknown` for a body it could not read. "We could not
  // tell" is not a figure, and the status bar of somebody who pasted a key and
  // never signed in has to look exactly as it did before this feature existed.
  ok('a plan that could not be read draws no chip',
     chip(planSummary(null)) === null && chip(planSummary('nonsense')) === null);
}
{
  const c = chip(planSummary(usage(PLAN, { remaining_tokens: 800_000, percent_used: 20 })));
  ok('a healthy metered plan is named', c.name === 'Pro', c);
  ok('and reports what is left', c.tail === 'left' && c.left === '800k', c);
  ok('and carries no warning class', c.level === '', c);
}
{
  const c = chip(planSummary(usage(PLAN, { remaining_tokens: 20_000, percent_used: 98 })));
  ok('a nearly spent plan warns', c.level === 'low', c);
}
{
  // Over the allowance: a percentage above 100 and a negative remainder, which
  // is what the server actually sends.
  const c = chip(planSummary(usage(PLAN, { remaining_tokens: -4_000, percent_used: 137 })));
  ok('a spent plan is louder than a low one', c.level === 'out', c);
  ok('and never shows a negative balance', c.left === '0', c);
}
{
  // The bug this whole path exists to avoid. An unmetered plan reports null for
  // both fields, and `?? 0` anywhere here would read as "you have run out" to
  // the only people paying the most.
  const c = chip(planSummary(usage({ ...PLAN, name: 'Max', monthly_tokens: 0 })));
  ok('an unmetered plan says there is no limit', c.tail === 'no-limit', c);
  ok('and is not shown as a zero balance', c.left === null && c.level === '', c);
}
{
  // The other half of the same trap, and the one that shipped. A server that
  // describes a plan by percentage alone — no `remaining_tokens`, no numeric
  // `monthly_tokens` — is metered with nothing to count, and the status bar
  // interpolates `left` straight into a sentence. Promising `left` here put the
  // word "null" where the balance goes.
  const s = planSummary(usage({ ...PLAN, monthly_tokens: null }, { percent_used: 40 }));
  ok('a plan described only by a percentage is still metered',
     s.metered === true && s.left === null, s);
  const c = chip(s);
  ok('but a balance that never arrived is not offered as one', c.tail !== 'left', c);
  ok('and there is no null to interpolate into the status bar', c.left === null, c);
  // "No limit" would be the other wrong answer: this plan has a ceiling, it is
  // simply not known. Only the name is true.
  ok('and it is not passed off as an unmetered plan', c.tail === 'none', c);
  ok('while the name it does know is still shown', c.name === 'Pro', c);
}
{
  // The invariant the renderer depends on, over every shape the plan endpoint
  // can produce: `left` is a string exactly when the chip says to draw one.
  const shapes = [
    usage(PLAN, { remaining_tokens: 800_000, percent_used: 20 }),
    usage(PLAN, { remaining_tokens: 0, percent_used: 100 }),
    usage(PLAN, { remaining_tokens: -1, percent_used: 137 }),
    usage(PLAN, { percent_used: 40 }),
    usage({ ...PLAN, monthly_tokens: null }, { percent_used: 40 }),
    usage({ ...PLAN, monthly_tokens: 0 }),
    usage({ ...PLAN, name: '   ' }, { remaining_tokens: 1, percent_used: 99 }),
    usage(null),
  ];
  ok('a chip promises a balance exactly when it has one',
     shapes.every((u) => {
       const c = chip(planSummary(u));
       return c === null || (c.tail === 'left') === (typeof c.left === 'string');
     }), shapes.map((u) => JSON.stringify(chip(planSummary(u)))).join(' | '));
}
{
  // No subscription at all. Its own case, not an empty balance: the answer is
  // "there is no plan", which is a different sentence from "the plan is spent".
  const c = chip(planSummary(usage(null)));
  ok('an account with no plan has no name to draw', c.name === null, c);
  ok('and no balance either', c.tail === 'none', c);
  ok('and is not coloured as a problem', c.level === '', c);
}

// ── the date, which is the other way a plan runs out ──────────────────────
//
// The token count shipped in 0.27.0. The date came back in the same response,
// was parsed, and was never rendered — so a fourteen-day trial with most of its
// tokens unspent showed a comfortable number right up to the morning it
// stopped working.

ok('no renewal date, no countdown', daysLeft(null, T0) === null);
ok('a date MySQL shape is understood', daysLeft('2026-09-11 00:00:00', T0) === 10);
ok('an ISO date is understood too', daysLeft('2026-09-11T00:00:00Z', T0) === 10);
ok('nonsense is null rather than NaN days', daysLeft('soon', T0) === null);
// Eleven hours is not a day. Rounding up would let somebody plan around a
// number that has in fact already run out.
ok('part of a day rounds down', daysLeft('2026-09-01T11:00:00Z', T0) === 0);
ok('a date already past is zero, never negative', daysLeft('2026-08-01T00:00:00Z', T0) === 0);

const plan = (over = {}) => ({
  name: 'Starter', trial: false, metered: true, left: '1.2M', used: '800k',
  allowance: '2M', percent: 40, level: 'ok', renews: null, ...over,
});

ok('a plan with no date behaves exactly as before', (() => {
  const c = chip(plan(), T0);
  return c.tail === 'left' && c.days === null && c.level === '';
})());
ok('a renewal far off is not mentioned', (() => {
  const c = chip(plan({ renews: '2026-10-01 00:00:00' }), T0);
  return c.tail === 'left' && c.level === '';
})());
// 80% of the tokens left and two days on the clock: the calendar is scarcer.
ok('two days left outranks a healthy balance', (() => {
  const c = chip(plan({ renews: '2026-09-03 00:00:00', percent: 20 }), T0);
  return c.tail === 'days' && c.days === 2 && c.left === null && c.level === 'low';
})());
// 12% of the tokens with six days left: the tokens are scarcer, so they win
// even though the renewal is inside the week.
ok('but a nearly-spent allowance still outranks the calendar', (() => {
  const c = chip(plan({ renews: '2026-09-07 00:00:00', percent: 88, level: 'low' }), T0);
  return c.tail === 'left' && c.days === null;
})());
ok('a closing renewal warns even when the tokens are fine', (() => {
  const c = chip(plan({ renews: '2026-09-05 00:00:00', percent: 10 }), T0);
  return c.level === 'low';
})());
ok('out of tokens still says out, whatever the date', (() => {
  const c = chip(plan({ renews: '2026-09-02 00:00:00', percent: 100, level: 'out' }), T0);
  return c.level === 'out';
})());
// The renderer interpolates both, so a null reaching either prints the word.
ok('days and left are never both set, and never both null on a metered plan', (() => {
  for (const [renews, percent] of [['2026-09-02 00:00:00', 10], ['2026-10-01 00:00:00', 40], [null, 40]]) {
    const c = chip(plan({ renews, percent }), T0);
    if (c.tail === 'days' && (c.days === null || c.left !== null)) return false;
    if (c.tail === 'left' && (c.left === null || c.days !== null)) return false;
  }
  return true;
})());
ok('an unmetered plan close to renewal still says no limit rather than a number', (() => {
  const c = chip(plan({ metered: false, left: null, percent: null, renews: '2026-09-02 00:00:00' }), T0);
  return c.tail === 'days' ? c.days === 1 : c.tail === 'no-limit';
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
