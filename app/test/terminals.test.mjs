// The terminal session list.
//
// The state is the part worth testing hardest: it decides whether a row shows a
// tick or a warning, and reporting a crashed command as finished-cleanly is the
// one mistake here that would matter.
import { stateOf, titleOf, since, matches, filter } from '../.test-build/terminals.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const shell = (n, over = {}) => ({ id: `t${n}`, n, born: 0, dead: false, ...over });
const cmd = (n, command, over = {}) => ({ id: `t${n}`, n, born: 0, dead: false, command, ...over });

// ── state ─────────────────────────────────────────────────────────────────
ok('an open shell is live', stateOf(shell(1)) === 'live');
ok('a command still going is busy', stateOf(cmd(1, 'npm test')) === 'busy');
ok('a command that exited 0 is ok', stateOf(cmd(1, 'npm test', { dead: true, code: 0 })) === 'ok');
ok('a non-zero exit is a failure', stateOf(cmd(1, 'npm test', { dead: true, code: 1 })) === 'failed');
// A signal is not a clean finish, and neither is a code nobody recorded.
ok('killed by a signal is a failure, not a tick',
   stateOf(cmd(1, 'sleep 99', { dead: true, code: null })) === 'failed');
ok('and a finished pane with no code recorded is a failure, not a tick',
   stateOf(cmd(1, 'x', { dead: true })) === 'failed');
ok('a closed shell is reported the same way', stateOf(shell(1, { dead: true, code: 0 })) === 'ok');

// ── titles ────────────────────────────────────────────────────────────────
{
  const t = titleOf(shell(3));
  ok('a shell is named by its number', t.text === 'Terminal 3');
  ok('and is not set as a string that ran', t.mono === false);
}
{
  const t = titleOf(cmd(1, 'cargo test --quiet'));
  ok('a command pane is named by its command', t.text === 'cargo test --quiet');
  ok('and is set in the mono face, because it is a string that ran', t.mono === true);
}
ok('the word Terminal is translatable', titleOf(shell(2), 'تێرمینال').text === 'تێرمینال 2');

// ── age ───────────────────────────────────────────────────────────────────
// The identity translator: English is the key, so this is what `since` returns
// with no translation, which is what the assertions below were written against.
const en = (s) => s;
ok('seconds, under a minute', since(0, 41_000, en) === '41s');
ok('just opened reads as zero rather than blank', since(0, 200, en) === '0s');
ok('minutes, over one', since(0, 61_000, en) === '1m' && since(0, 59 * 60_000, en) === '59m');
ok('hours, over sixty minutes', since(0, 60 * 60_000, en) === '1h');
ok('days, over a day', since(0, 25 * 3600_000, en) === '1d');
// And a translated one moves the unit rather than having it stuck on the end.
ok('the unit is the translated part', since(0, 61_000, (s) => s.replace('{n}m', 'د {n}')) === 'د 1');
// Clocks move backwards — a laptop waking, an NTP correction — and a negative
// age would render as "-3s" on a row that is fine.
ok('a clock that went backwards does not render a negative age', since(5000, 0, en) === '0s');

// ── filtering ─────────────────────────────────────────────────────────────
{
  const list = [shell(1), shell(2), cmd(3, 'npm test'), cmd(4, 'cargo build --release')];
  ok('an empty query keeps everything, because a list that empties looks broken',
     filter(list, '').length === 4 && filter(list, '   ').length === 4);
  ok('the same array comes back untouched when nothing was typed', filter(list, '') === list);
  ok('a command matches on its own text', filter(list, 'cargo').length === 1);
  ok('matching is case-folded', filter(list, 'CARGO').length === 1);
  ok('a partial word matches', filter(list, 'rele').length === 1);
  ok('a shell matches on its name', filter(list, 'Terminal 2').length === 1);
  ok('the number alone matches its shell', filter(list, '2').length === 1);
  ok('nothing matching is empty rather than everything', filter(list, 'zzz').length === 0);
  ok('a query is trimmed before it is used', filter(list, '  cargo  ').length === 1);
}
ok('a translated Terminal is what gets searched',
   filter([shell(1)], 'تێرمینال', 'تێرمینال').length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
