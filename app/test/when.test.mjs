// Relative time, and the two bugs that made it a module.
//
// Both were shipped, both were four lines apart in the same file, and both are
// the sort of thing a reader skims past: "In 1 minutes", because the plural key
// was the only key; and "In 144 hours" for a weekly routine, because the future
// ladder stopped at hours while the past ladder two lines above had days. So
// the singular of every unit is asserted here, in both directions, and so is
// every boundary the ladder can step over.
//
// The rounding cases are the ones worth reading twice. 1439 minutes is a day
// less a minute: it must say "1 day", not the "24 hours" a `< 1440` branch
// prints, and that is a property of choosing the unit *after* rounding rather
// than before.
import { ago, isTime, missedRuns, until, weekOrder } from '../.test-build/when.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A phrase as one comparable string: the key, then what goes in its holes. */
const said = (p) => `${p.key}${Object.keys(p.vars).length ? ' ' + JSON.stringify(p.vars) : ''}`;
const eq = (name, got, want) => ok(name, got === want, `got ${got}, want ${want}`);

// ── ago ────────────────────────────────────────────────────────────────────

eq('a moment ago is "Just now"', said(ago(NOW - 20_000, NOW)), 'Just now');
eq('and so is a moment that has not happened yet', said(ago(NOW + 5 * MIN, NOW)), 'Just now');
eq('one minute is singular', said(ago(NOW - MIN, NOW)), '1 minute ago');
eq('45 seconds rounds up to that one minute', said(ago(NOW - 45_000, NOW)), '1 minute ago');
eq('two minutes is plural', said(ago(NOW - 2 * MIN, NOW)), '{n} minutes ago {"n":2}');
eq('59 minutes stays in minutes', said(ago(NOW - 59 * MIN, NOW)), '{n} minutes ago {"n":59}');
eq('an hour is singular', said(ago(NOW - HOUR, NOW)), '1 hour ago');
eq('70 minutes is one hour, not "1 hours"', said(ago(NOW - 70 * MIN, NOW)), '1 hour ago');
eq('two hours is plural', said(ago(NOW - 2 * HOUR, NOW)), '{n} hours ago {"n":2}');
eq('23 hours is still hours', said(ago(NOW - 23 * HOUR, NOW)), '{n} hours ago {"n":23}');
eq('a day less a minute is one day, not 24 hours', said(ago(NOW - (DAY - MIN), NOW)), '1 day ago');
eq('a day is singular', said(ago(NOW - DAY, NOW)), '1 day ago');
eq('two days is plural', said(ago(NOW - 2 * DAY, NOW)), '{n} days ago {"n":2}');
eq('a week is seven days', said(ago(NOW - 7 * DAY, NOW)), '{n} days ago {"n":7}');

// ── until ──────────────────────────────────────────────────────────────────

eq('a slot that has gone is due now', said(until(NOW - HOUR, NOW)), 'Due now');
eq('and so is this instant', said(until(NOW, NOW)), 'Due now');
eq('45 seconds out is "In 1 minute", the bug this was written for',
   said(until(NOW + 45_000, NOW)), 'In 1 minute');
eq('two minutes out is plural', said(until(NOW + 2 * MIN, NOW)), 'In {n} minutes {"n":2}');
eq('89 minutes out is one hour, not "In 1 hours"', said(until(NOW + 89 * MIN, NOW)), 'In 1 hour');
eq('three hours out is plural', said(until(NOW + 3 * HOUR, NOW)), 'In {n} hours {"n":3}');
eq('tomorrow is a day, not 24 hours', said(until(NOW + DAY, NOW)), 'In 1 day');
eq('a weekly routine six days out is said in days, not 144 hours',
   said(until(NOW + 6 * DAY, NOW)), 'In {n} days {"n":6}');
eq('and a full week is seven', said(until(NOW + 7 * DAY, NOW)), 'In {n} days {"n":7}');

// The two directions agree about where each unit ends. A ladder that stepped
// up at a different place in one of them is how the panels drifted apart.
{
  const same = [MIN, 45_000, 59 * MIN, 61 * MIN, DAY - MIN, DAY, 3 * DAY]
    .every((d) => ago(NOW - d, NOW).vars.n === until(NOW + d, NOW).vars.n);
  ok('past and future choose the same size for the same gap', same);
}

// ── the missed-run sentence ────────────────────────────────────────────────

eq('one missed run is its own sentence, with a singular verb',
   said(missedRuns(1)), '1 run was due while the app was closed and was skipped.');
eq('three is the plural one',
   said(missedRuns(3)), '{n} runs were due while the app was closed and were skipped. {"n":3}');
// Zero is nothing, not "0 runs". The dashboard's list can arrive filtered to
// the open folder now, so an empty one is a legitimate state rather than a
// forgotten guard, and an empty key fills to an empty string.
eq('zero says nothing at all', said(missedRuns(0)), '');
eq('and neither does a negative, however it got here', said(missedRuns(-1)), '');
ok('but one and many still have their sentences',
   missedRuns(1).key.length > 0 && missedRuns(2).key.length > 0);

// ── times of day ───────────────────────────────────────────────────────────

for (const s of ['09:00', '9:00', '00:00', '23:59', ' 09:00 ']) ok(`"${s}" is a time`, isTime(s));
for (const s of ['', '9', '9am', '24:00', '09:60', '09:0', 'nine', '09:00:00'])
  ok(`"${s}" is not a time`, !isTime(s));
ok('and neither is a value that is not a string', !isTime(null) && !isTime(900) && !isTime(undefined));

// ── the order of the week ──────────────────────────────────────────────────

eq('Monday first is the English week', weekOrder(1).join(), '1,2,3,4,5,6,0');
eq('Saturday first is the Arabic and Kurdish week', weekOrder(6).join(), '6,0,1,2,3,4,5');
eq('Sunday first is the raw order', weekOrder(0).join(), '0,1,2,3,4,5,6');
ok('every order is the seven days once each',
   [0, 1, 2, 3, 4, 5, 6].every((f) => new Set(weekOrder(f)).size === 7));
eq('a value out of range wraps rather than leaving a hole', weekOrder(8).join(), '1,2,3,4,5,6,0');
eq('and a value that is not a day index falls back to Sunday', weekOrder(NaN).join(), '0,1,2,3,4,5,6');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
