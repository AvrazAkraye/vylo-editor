// A month, and what is due in it.
//
// Dates are `YYYY-MM-DD` strings throughout, never `Date` objects: a Date is a
// moment in time and a due date is not, and comparing two of them drags in the
// hour, the timezone and whether the clocks changed. Most of these tests are
// about the grid being the same shape whatever month it is asked for.
import { plan } from '../.test-build/todo.js';
import {
  WEEKS, byDay, firstDay, grid, inGrid, key, longDate, monthName, shift, weekdays,
} from '../.test-build/calendar.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const NOW = new Date('2026-09-02T10:00:00');

// ── keys ──────────────────────────────────────────────────────────────────
ok('a key is padded', key(2026, 8, 2) === '2026-09-02');
ok('and the month is one-based in the output', key(2026, 0, 1) === '2026-01-01');
ok('December is 12, not 13', key(2026, 11, 31) === '2026-12-31');
// Lexical order is date order for this format, which is the whole reason for it.
ok('keys sort as dates do', ['2026-10-01', '2026-09-30'].sort().join() === '2026-09-30,2026-10-01');

// ── where the week starts ─────────────────────────────────────────────────
// A calendar that begins on the wrong day is not cosmetic. It is one somebody
// miscounts from.
ok('English weeks start on Monday', firstDay('en') === 1);
ok('Arabic on Saturday', firstDay('ar') === 6);
ok('and both Kurdish languages too', firstDay('ckb') === 6 && firstDay('kmr') === 6);
ok('an unknown language falls back to Monday', firstDay('fr') === 1);

// ── the grid ──────────────────────────────────────────────────────────────
{
  const g = grid(2026, 8, 1, NOW);          // September 2026, Monday start
  // Always six, and always full: a grid sized to its month makes the page jump
  // every time somebody presses next.
  ok('the grid is always six weeks', g.length === WEEKS * 7 && g.length === 42);
  ok('it starts on the chosen weekday', new Date(g[0].key + 'T00:00:00').getDay() === 1);
  ok('the days run without a gap', (() => {
    for (let i = 1; i < g.length; i++) {
      const a = new Date(g[i - 1].key + 'T00:00:00');
      const b = new Date(g[i].key + 'T00:00:00');
      if ((b - a) !== 86400000) return false;
    }
    return true;
  })());
  ok('September has thirty days in the month', g.filter((d) => d.inMonth).length === 30);
  ok('the borrowed days are marked as borrowed',
     g.filter((d) => !d.inMonth).length === 12);
  ok('the first of the month is in it', g.find((d) => d.key === '2026-09-01').inMonth === true);
  ok('and the day before it is not', g.find((d) => d.key === '2026-08-31').inMonth === false);
  ok('today is marked', g.filter((d) => d.isToday).length === 1);
  ok('and it is the right day', g.find((d) => d.isToday).key === '2026-09-02');
}
{
  // February 2026 is 28 days starting on a Sunday — the month that needs the
  // fewest rows, and still gets six.
  const g = grid(2026, 1, 1, NOW);
  ok('a short month is still six weeks', g.length === 42);
  ok('with the right number of its own days', g.filter((d) => d.inMonth).length === 28);
}
ok('a leap February has twenty-nine', grid(2024, 1, 1, NOW).filter((d) => d.inMonth).length === 29);
ok('a Saturday start shifts the grid', (() => {
  const g = grid(2026, 8, 6, NOW);
  return new Date(g[0].key + 'T00:00:00').getDay() === 6;
})());
ok('no month is marked as today when it is elsewhere',
   grid(2020, 0, 1, NOW).every((d) => !d.isToday));

// ── moving between months ─────────────────────────────────────────────────
ok('next month', shift(2026, 8, 1).month === 9);
// The year going wrong in January is the classic one.
ok('December to January rolls the year', (() => {
  const n = shift(2026, 11, 1);
  return n.year === 2027 && n.month === 0;
})(), shift(2026, 11, 1));
ok('January back to December rolls it the other way', (() => {
  const n = shift(2026, 0, -1);
  return n.year === 2025 && n.month === 11;
})(), shift(2026, 0, -1));
ok('a whole year forward', shift(2026, 5, 12).year === 2027);
ok('and no move is no move', (() => {
  const n = shift(2026, 5, 0);
  return n.year === 2026 && n.month === 5;
})());

// ── what is due when ──────────────────────────────────────────────────────
{
  const p = plan(`- [ ] Today one ^today
- [ ] Tomorrow one ^tomorrow
- [ ] Dated ^2026-09-20
- [ ] Also dated ^2026-09-20
- [ ] No date at all
`);
  const due = byDay(p, NOW);
  ok('a task lands on its day', due.get('2026-09-02')?.length === 1);
  ok('"tomorrow" resolves to a real day', due.get('2026-09-03')?.length === 1);
  ok('two tasks on one day are both there', due.get('2026-09-20')?.length === 2);
  // A calendar that invented a position for everything else would be showing a
  // date nobody set, and somebody would plan around it.
  ok('a task with no due date is nowhere', (() => {
    let n = 0;
    for (const list of due.values()) n += list.length;
    return n === 4;
  })());
  ok('a day with nothing is absent, not empty', due.has('2026-09-10') === false);

  const g = grid(2026, 8, 1, NOW);
  ok('the month total counts what the grid can show', inGrid(g, due) === 4, inGrid(g, due));
  ok('an empty month counts nothing', inGrid(grid(2030, 0, 1, NOW), due) === 0);
}

// ── names ─────────────────────────────────────────────────────────────────
ok('there are seven weekday names', weekdays(1, 'en').length === 7);
ok('and they start on the chosen day', weekdays(1, 'en')[0].toLowerCase().startsWith('mon'));
ok('a Sunday start starts on Sunday', weekdays(0, 'en')[0].toLowerCase().startsWith('sun'));
ok('a Saturday start starts on Saturday', weekdays(6, 'en')[0].toLowerCase().startsWith('sat'));
ok('they are all different', new Set(weekdays(1, 'en')).size === 7);
ok('the month is named with its year', monthName(2026, 8, 'en').includes('2026'));
ok('and it is the right month', /sept/i.test(monthName(2026, 8, 'en')));
ok('a long date names the weekday', /wednesday/i.test(longDate('2026-09-02', 'en')));
ok('nonsense comes back as itself', longDate('not-a-date', 'en') === 'not-a-date');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
