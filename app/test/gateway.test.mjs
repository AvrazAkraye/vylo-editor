// Checking a gateway key.
//
// The probe is deliberately an invalid request, so 400 is the *success* case —
// it means the key got past authentication and the request was then refused for
// the reason we chose. Anyone reading this later will find that backwards, so
// it is the first thing the tests state.
import { verdict } from '../.test-build/gateway.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

ok('400 means the key works — the probe is meant to be rejected',
   verdict(400).state === 'ok', verdict(400));
ok('401 means the key is wrong', verdict(401).state === 'bad');
ok('and says what to check', /sk-vylo-/.test(verdict(401).fix), verdict(401).fix);

// A key that is real but unusable must not be reported as wrong: retyping it
// will not help, and telling someone to check their key when the problem is
// billing sends them looking in the wrong place.
ok('402 is the key being right and the plan missing', verdict(402).state === 'ok-but', verdict(402));
ok('and points at the plan page', /chat\.vylo-tech\.com/.test(verdict(402).fix));
ok('403 is suspended, not invalid', verdict(403).state === 'ok-but');
ok('429 is valid but busy', verdict(429).state === 'ok-but', verdict(429));

// Not knowing is its own answer. Refusing to save a key because the server is
// down would be worse than saving one that turns out to be wrong.
ok('a 500 blames the server, not the key', verdict(500).state === 'unknown', verdict(500));
ok('and says so explicitly', /server, not the key/.test(verdict(503).fix), verdict(503).fix);
ok('404 suggests the address is wrong', /gateway address/.test(verdict(404).fix), verdict(404).fix);
ok('an unfamiliar status is unknown rather than bad', verdict(418).state === 'unknown');
ok('and keeps the detail when there is one',
   verdict(418, "I'm a teapot").note === "I'm a teapot", verdict(418, "I'm a teapot"));

// Every verdict has to be actionable; a note with no fix leaves someone stuck.
for (const s of [400, 401, 402, 403, 404, 429, 500, 502, 418]) {
  const v = verdict(s);
  ok(`${s} is actionable`, v.state === 'ok' || (!!v.note && !!v.fix), v);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
