// Routines: a named agent on a schedule.
//
// Two properties carry the whole design and most of what is below is one or
// the other. A routine never fires the instant you save it, edit it or resume
// it — it counts from `armedAt`. And a routine is owed at most one run, never
// a backlog, however long the app was closed or the laptop asleep.
//
// Every date is built with the local `Date` constructor and compared against
// one built the same way, so these hold in any time zone and across the
// clocks changing: both sides of each check use the same wall-clock rules.
import {
  DAYS, GUARD_MS, KEY, MAX_EVERY, MIN_EVERY, PRESENT_MS, TICK_KEY,
  add, describe, due, hold, markRun, midWork, missedWhileClosed, newId, nextRun, normalise,
  pause, phrase, read, remove, resume, sameSchedule, skip, update, write,
} from '../.test-build/routines.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

/** A local moment. Months are written 1–12 here so a date reads as a date. */
const local = (y, mo, d, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const ids = (xs) => xs.map((r) => r.id).join();

// Saturday, 5 September 2026. The weekday matters for the weekly checks, and
// it is asserted rather than assumed.
const SAT = local(2026, 9, 5, 10, 0);
ok('the fixture is a Saturday', new Date(SAT).getDay() === 6);

/** A routine as `add` would make it, with anything overridden. */
const make = (over = {}) => ({
  id: 'r1', name: 'Nightly review', agent: 'reviewer',
  brief: 'Review whatever landed overnight and list anything that looks wrong.',
  schedule: { kind: 'daily', at: '09:00' },
  paused: false, armedAt: SAT, createdAt: SAT,
  ...over,
});

// ── describing a schedule ─────────────────────────────────────────────────
// These are the i18n keys. They must not drift.
ok('every 30 minutes', describe({ kind: 'every', minutes: 30 }) === 'Every 30 minutes');
ok('a whole hour is said as one', describe({ kind: 'every', minutes: 60 }) === 'Every hour');
ok('whole hours are said in hours', describe({ kind: 'every', minutes: 120 }) === 'Every 2 hours');
ok('but ninety minutes is minutes', describe({ kind: 'every', minutes: 90 }) === 'Every 90 minutes');
ok('daily', describe({ kind: 'daily', at: '09:00' }) === 'Daily at 09:00');
ok('weekly', describe({ kind: 'weekly', day: 1, at: '09:00' }) === 'Weekly on Monday at 09:00');
ok('weekly on a Sunday', describe({ kind: 'weekly', day: 0, at: '18:30' }) === 'Weekly on Sunday at 18:30');
ok('manual', describe({ kind: 'manual' }) === 'Only when run by hand');
ok('the keys carry holes, not values', (() => {
  const keys = [
    phrase({ kind: 'every', minutes: 30 }).key,
    phrase({ kind: 'every', minutes: 60 }).key,
    phrase({ kind: 'every', minutes: 180 }).key,
    phrase({ kind: 'daily', at: '09:00' }).key,
    phrase({ kind: 'weekly', day: 3, at: '09:00' }).key,
    phrase({ kind: 'manual' }).key,
  ];
  return keys.join('|') === [
    'Every {n} minutes', 'Every hour', 'Every {n} hours',
    'Daily at {time}', 'Weekly on {day} at {time}', 'Only when run by hand',
  ].join('|');
})(), [30, 60, 180].map((m) => phrase({ kind: 'every', minutes: m }).key));
ok('the weekly phrase names the day in English, for the translator to swap',
   phrase({ kind: 'weekly', day: 5, at: '07:15' }).vars.day === 'Friday' && DAYS[0] === 'Sunday');
ok('no hole is left unfilled', (() => {
  for (const s of [{ kind: 'every', minutes: 7 }, { kind: 'every', minutes: 240 }, { kind: 'daily', at: '00:00' },
                   { kind: 'weekly', day: 6, at: '23:59' }, { kind: 'manual' }]) {
    if (describe(s).includes('{')) return false;
  }
  return true;
})());

// ── what a schedule may be ────────────────────────────────────────────────
ok('an interval below the floor is clamped up', normalise({ kind: 'every', minutes: 2 }).minutes === MIN_EVERY);
ok('and one above a week is clamped down', normalise({ kind: 'every', minutes: 99999 }).minutes === MAX_EVERY);
ok('a fractional interval is rounded', normalise({ kind: 'every', minutes: 30.4 }).minutes === 30);
ok('an interval that is not a number is refused', (() => {
  for (const m of [NaN, Infinity, '30', null, undefined]) if (normalise({ kind: 'every', minutes: m }) !== null) return false;
  return true;
})());
ok('a time is zero-padded on the way in', normalise({ kind: 'daily', at: '9:05' }).at === '09:05');
ok('a time that is not a time is refused', (() => {
  for (const at of ['24:00', '09:60', 'noon', '9', '9am', '', 12, null]) if (normalise({ kind: 'daily', at }) !== null) return false;
  return true;
})());
ok('a weekday out of range is refused', (() => {
  for (const day of [-1, 7, 1.5, '1', null]) if (normalise({ kind: 'weekly', day, at: '09:00' }) !== null) return false;
  return true;
})());
ok('a weekly with a bad time is refused too', normalise({ kind: 'weekly', day: 1, at: 'x' }) === null);
ok('manual carries nothing else', JSON.stringify(normalise({ kind: 'manual', at: '09:00' })) === '{"kind":"manual"}');
ok('an unknown kind is refused', normalise({ kind: 'cron', expr: '0 9 * * *' }) === null);
ok('and so is nonsense', normalise('daily') === null && normalise(null) === null && normalise(42) === null);
ok('two schedules that say the same thing are the same', (() =>
  sameSchedule({ kind: 'daily', at: '09:00' }, { kind: 'daily', at: '09:00' })
  && sameSchedule({ kind: 'weekly', day: 1, at: '09:00' }, { kind: 'weekly', day: 1, at: '09:00' })
  && sameSchedule({ kind: 'manual' }, { kind: 'manual' })
)());
ok('and ones that do not are not', (() =>
  !sameSchedule({ kind: 'daily', at: '09:00' }, { kind: 'daily', at: '09:01' })
  && !sameSchedule({ kind: 'weekly', day: 1, at: '09:00' }, { kind: 'weekly', day: 2, at: '09:00' })
  && !sameSchedule({ kind: 'every', minutes: 30 }, { kind: 'every', minutes: 60 })
  && !sameSchedule({ kind: 'daily', at: '09:00' }, { kind: 'manual' })
)());

// ── next run: every N minutes ─────────────────────────────────────────────
{
  const r = make({ schedule: { kind: 'every', minutes: 30 } });
  // A routine that fires the instant you save it is one you cannot finish
  // writing.
  ok('a new interval routine is not due at once', nextRun(r, SAT) > SAT);
  ok('its first run is one interval from creation', nextRun(r, SAT) === SAT + 30 * MIN);
  ok('at the half hour it is owed', nextRun(r, SAT + 30 * MIN) === SAT + 30 * MIN);
  const ran = markRun([r], 'r1', { at: SAT + 30 * MIN + 5000, chatId: 'c1', ok: true })[0];
  ok('after a run, the next is an interval from that run', nextRun(ran, SAT + 31 * MIN) === SAT + 60 * MIN + 5000);
  // Missed intervals do not stack: three hours asleep is one run owed, the
  // most recent one, not six.
  ok('overdue by hours, it is owed the most recent interval only', (() => {
    const t = SAT + 30 * MIN + 5000 + 3 * HOUR + 7 * MIN;
    const next = nextRun(ran, t);
    return next <= t && t - next < 30 * MIN && next === SAT + 30 * MIN + 5000 + 6 * 30 * MIN;
  })(), nextRun(ran, SAT + 30 * MIN + 5000 + 3 * HOUR + 7 * MIN) - SAT);
  ok('now as epoch milliseconds gives the same answer as a Date',
     nextRun(r, SAT) === nextRun(r, new Date(SAT)));
}

// ── next run: daily ───────────────────────────────────────────────────────
ok('created before the hour, it runs today', (() => {
  const r = make({ armedAt: local(2026, 9, 5, 8, 0), createdAt: local(2026, 9, 5, 8, 0) });
  return nextRun(r, local(2026, 9, 5, 8, 0)) === local(2026, 9, 5, 9, 0);
})());
ok('created after the hour, it rolls to tomorrow', (() => {
  const r = make();                                            // armed 10:00, daily at 09:00
  return nextRun(r, SAT) === local(2026, 9, 6, 9, 0);
})());
ok('created on the hour exactly, it is tomorrow — strictly after, never now', (() => {
  const nine = local(2026, 9, 5, 9, 0);
  const r = make({ armedAt: nine, createdAt: nine });
  return nextRun(r, nine) === local(2026, 9, 6, 9, 0);
})());
ok('once today\'s run has started, the next is tomorrow', (() => {
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0),
                   lastRun: { at: local(2026, 9, 5, 9, 0, 2), chatId: 'c', ok: true } });
  return nextRun(r, local(2026, 9, 5, 9, 0, 5)) === local(2026, 9, 6, 9, 0);
})());
ok('at the slot itself it is owed', (() => {
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0) });
  return nextRun(r, local(2026, 9, 5, 9, 0)) === local(2026, 9, 5, 9, 0);
})());
// Asleep for three days: one run owed, this morning's.
ok('days overdue, it is owed the most recent slot, not the first missed one', (() => {
  const r = make({ armedAt: local(2026, 9, 1, 12, 0), createdAt: local(2026, 9, 1, 12, 0) });
  const t = local(2026, 9, 5, 10, 0);
  return nextRun(r, t) === local(2026, 9, 5, 9, 0);
})());
ok('midnight is a time of day like any other', (() => {
  const r = make({ schedule: { kind: 'daily', at: '00:00' } });
  return nextRun(r, SAT) === local(2026, 9, 6, 0, 0);
})());

// ── the clocks changing ───────────────────────────────────────────────────
// The next 09:00 is tomorrow's 09:00 on the wall, whether tomorrow is 23, 24
// or 25 hours away. The routine is armed the day BEFORE each transition date,
// so the step from its first slot to its second crosses the transition itself
// (which happens in the small hours of the date listed). Both sides are built
// with the local constructor, so this holds in every zone; in a zone with
// daylight saving, these are the dates where "plus 24 hours" is wrong.
const TRANSITIONS = [[2026, 3, 8], [2026, 3, 29], [2026, 4, 5], [2026, 10, 4], [2026, 10, 25], [2026, 11, 1]];
ok('daily lands on the wall-clock hour across every transition', (() => {
  for (const [y, m, d] of TRANSITIONS) {
    const before = local(y, m, d - 1, 8, 0);
    const r = make({ armedAt: before, createdAt: before });
    const first = nextRun(r, before);
    if (first !== local(y, m, d - 1, 9, 0)) return false;
    const second = nextRun(markRun([r], 'r1', { at: first, chatId: 'c', ok: true })[0], first);
    if (second !== local(y, m, d, 9, 0)) return false;
  }
  return true;
})());
ok('and the gap between those slots is a day on the wall, not 24 hours by decree', (() => {
  let odd = 0;
  for (const [y, m, d] of TRANSITIONS) {
    const before = local(y, m, d - 1, 8, 0);
    const r = make({ armedAt: before, createdAt: before });
    const first = nextRun(r, before);
    const second = nextRun(markRun([r], 'r1', { at: first, chatId: 'c', ok: true })[0], first);
    const hours = (second - first) / HOUR;
    if (![23, 24, 25].includes(hours)) return false;
    if (hours !== 24) odd++;
    // The wall-clock check is the property; the gap is only evidence of it.
    if (second !== local(y, m, d, 9, 0)) return false;
  }
  // In a zone with daylight saving at least one of these gaps is not 24h; in
  // one without, all are — and either way the slot landed on 09:00.
  return odd >= 0;
})());
ok('a NaN run time is refused rather than making the routine due forever', (() => {
  const r = make({ schedule: { kind: 'every', minutes: 30 } });
  const marked = markRun([r], 'r1', { at: NaN, chatId: 'c', ok: true })[0];
  return marked.lastRun === undefined && Number.isFinite(nextRun(marked, SAT));
})());

// ── next run: weekly ──────────────────────────────────────────────────────
ok('weekly on Sunday from a Saturday is tomorrow — the week wraps', (() => {
  const r = make({ schedule: { kind: 'weekly', day: 0, at: '09:00' } });
  return nextRun(r, SAT) === local(2026, 9, 6, 9, 0);
})());
ok('weekly on today\'s day, time already gone, is a week out', (() => {
  const r = make({ schedule: { kind: 'weekly', day: 6, at: '09:00' } });     // Saturday 09:00, armed 10:00
  return nextRun(r, SAT) === local(2026, 9, 12, 9, 0);
})());
ok('weekly on today\'s day, time still to come, is today', (() => {
  const r = make({ schedule: { kind: 'weekly', day: 6, at: '18:00' } });
  return nextRun(r, SAT) === local(2026, 9, 5, 18, 0);
})());
ok('weekly on a Monday from a Saturday', (() => {
  const r = make({ schedule: { kind: 'weekly', day: 1, at: '09:00' } });
  const next = nextRun(r, SAT);
  return next === local(2026, 9, 7, 9, 0) && new Date(next).getDay() === 1;
})());
ok('after a weekly run, the next is a week later', (() => {
  const r = make({ schedule: { kind: 'weekly', day: 1, at: '09:00' },
                   lastRun: { at: local(2026, 9, 7, 9, 0, 3), chatId: 'c', ok: true } });
  return nextRun(r, local(2026, 9, 7, 9, 1)) === local(2026, 9, 14, 9, 0);
})());
ok('a weekly missed for a fortnight owes one run, the most recent', (() => {
  const armed = local(2026, 8, 20, 12, 0);                                    // a Thursday in August
  const r = make({ schedule: { kind: 'weekly', day: 1, at: '09:00' }, armedAt: armed, createdAt: armed });
  return nextRun(r, SAT) === local(2026, 8, 31, 9, 0);                         // the Monday just gone
})());

// ── next run: paused and manual ───────────────────────────────────────────
ok('paused has no next run', nextRun(make({ paused: true }), SAT) === null);
ok('manual has no next run', nextRun(make({ schedule: { kind: 'manual' } }), SAT) === null);
ok('a nonsense clock has no next run', nextRun(make(), NaN) === null);

// ── due ───────────────────────────────────────────────────────────────────
{
  const list = [
    make({ id: 'owed', armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0) }),   // 09:00 today, not run
    make({ id: 'later', schedule: { kind: 'daily', at: '18:00' } }),
    make({ id: 'paused', paused: true, armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0) }),
    make({ id: 'manual', schedule: { kind: 'manual' }, armedAt: 0, createdAt: 0 }),
    make({ id: 'soon', schedule: { kind: 'every', minutes: 30 } }),
  ];
  ok('only the routine that is owed is due', ids(due(list, SAT)) === 'owed', ids(due(list, SAT)));
  ok('paused is never due, however overdue', !ids(due(list, SAT)).includes('paused'));
  ok('manual is never due', !ids(due(list, SAT)).includes('manual'));
  ok('the interval one is due at the half hour', ids(due(list, SAT + 30 * MIN)).includes('soon'));
  ok('due returns the routines themselves', due(list, SAT)[0] === list[0]);
  ok('and does not change the list', list.length === 5 && list[0].id === 'owed');
}
// The double-fire guard. "Run now" twenty seconds before the slot: the slot
// is still owed by the arithmetic, and the guard is what stops it.
{
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0),
                   lastRun: { at: local(2026, 9, 5, 8, 59, 40), chatId: 'c', ok: true } });
  ok('a routine that ran within the last minute is not due',
     due([r], local(2026, 9, 5, 9, 0, 2)).length === 0);
  ok('the guard is exactly a minute', GUARD_MS === 60_000
     && due([r], local(2026, 9, 5, 9, 0, 39)).length === 0
     && due([r], local(2026, 9, 5, 9, 0, 40)).length === 1);
  ok('it is a backstop, not the mechanism: a minute later the run is owed again',
     due([r], local(2026, 9, 5, 9, 1, 10)).length === 1);
}
// The mechanism: recording the start moves the anchor.
ok('once a start is recorded, the next tick finds nothing due', (() => {
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0) });
  const tick1 = local(2026, 9, 5, 9, 0, 2);
  const [started] = markRun([r], 'r1', { at: tick1, chatId: 'c9', ok: true });
  return due([r], tick1).length === 1 && due([started], tick1 + 3000).length === 0
    && due([started], local(2026, 9, 5, 12, 0)).length === 0;
})());

// ── missed while the app was closed ───────────────────────────────────────
{
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0) });   // owes 09:00 today
  ok('a first launch has nothing to compare against', missedWhileClosed([r], null, SAT).length === 0);
  ok('a run that fell while closed is reported',
     ids(missedWhileClosed([r], local(2026, 9, 5, 8, 30), SAT)) === 'r1');
  ok('a run still ahead is not', missedWhileClosed([r], local(2026, 9, 5, 8, 30), local(2026, 9, 5, 8, 45)).length === 0);
  // Owed before the last tick means the app was open and did not run it. That
  // is due, not missed, and the scheduler will start it.
  ok('a run owed before the app closed is not "missed while closed"',
     missedWhileClosed([r], local(2026, 9, 5, 9, 5), SAT).length === 0);
  ok('paused and manual are never missed', (() => {
    const list = [make({ ...r, id: 'p', paused: true }), make({ ...r, id: 'm', schedule: { kind: 'manual' } })];
    return missedWhileClosed(list, local(2026, 9, 5, 8, 30), SAT).length === 0;
  })());
  ok('an interval routine closed for days is reported once', (() => {
    const every = make({ schedule: { kind: 'every', minutes: 30 }, armedAt: local(2026, 9, 1, 8, 0), createdAt: local(2026, 9, 1, 8, 0) });
    // Opened at 10:07, so the owed half hour sits inside the gap. A slot that
    // lands on the launch instant itself is not missed, it is due.
    return ids(missedWhileClosed([every], local(2026, 9, 1, 8, 5), SAT + 7 * MIN)) === 'r1';
  })());
  ok('a nonsense last tick reports nothing', missedWhileClosed([r], NaN, SAT).length === 0);
  // Reported, then forgiven: the next run counts from now.
  ok('skipping a missed run moves it to tomorrow', (() => {
    const [after] = skip([r], 'r1', SAT);
    return nextRun(after, SAT) === local(2026, 9, 6, 9, 0) && due([after], SAT).length === 0
      && missedWhileClosed([after], local(2026, 9, 5, 8, 30), SAT).length === 0;
  })());
  ok('skipping leaves the last result on the row', (() => {
    const ran = make({ lastRun: { at: 1, chatId: 'c', ok: false, error: 'boom' } });
    return skip([ran], 'r1', SAT)[0].lastRun.error === 'boom';
  })());
}

// ── the list ──────────────────────────────────────────────────────────────
const DRAFT = { name: '  Morning digest ', agent: 'digest', brief: 'Summarise the open pull requests.\n', schedule: { kind: 'every', minutes: 3 } };
{
  const list = add([], DRAFT, SAT);
  ok('add makes one routine', list.length === 1 && list[0].id === 'r1');
  ok('it is armed and created now, unpaused, never run',
     list[0].armedAt === SAT && list[0].createdAt === SAT && list[0].paused === false && !('lastRun' in list[0]));
  ok('its fields are trimmed', list[0].name === 'Morning digest' && list[0].brief === 'Summarise the open pull requests.');
  ok('its schedule went through normalise', list[0].schedule.minutes === MIN_EVERY);
  ok('and it is not due the instant it was saved', due(list, SAT).length === 0 && nextRun(list[0], SAT) === SAT + MIN_EVERY * MIN);
  ok('a second gets the next id', add(list, DRAFT, SAT)[1].id === 'r2');
}
ok('a blank name is refused', add([], { ...DRAFT, name: ' ' }, SAT).length === 0);
ok('a blank brief is refused', add([], { ...DRAFT, brief: '' }, SAT).length === 0);
ok('a blank agent is refused', add([], { ...DRAFT, agent: '' }, SAT).length === 0);
ok('a schedule that does not parse is refused', add([], { ...DRAFT, schedule: { kind: 'daily', at: 'noon' } }, SAT).length === 0);
ok('adding does not mutate', (() => { const l = []; add(l, DRAFT, SAT); return l.length === 0; })());
ok('a fresh id avoids the taken ones', newId(['r1', 'r2']) === 'r3' && newId([]) === 'r1');

{
  const list = add([], DRAFT, SAT);
  const later = SAT + 2 * HOUR;
  ok('a rename does not re-arm', (() => {
    const [r] = update(list, 'r1', { name: 'Evening digest' }, later);
    return r.name === 'Evening digest' && r.armedAt === SAT;
  })());
  // Moved from ten to nine at half past nine runs tomorrow at nine, not now.
  ok('a schedule change re-arms', (() => {
    const [r] = update(list, 'r1', { schedule: { kind: 'daily', at: '09:00' } }, later);
    return r.schedule.kind === 'daily' && r.armedAt === later && nextRun(r, later) === local(2026, 9, 6, 9, 0);
  })());
  ok('the same schedule again does not', update(list, 'r1', { schedule: { kind: 'every', minutes: 5 } }, later)[0].armedAt === SAT);
  ok('a blank field in a patch keeps the old value', update(list, 'r1', { name: '', brief: '  ' }, later)[0].name === 'Morning digest');
  ok('a bad schedule in a patch keeps the old one', (() => {
    const [r] = update(list, 'r1', { schedule: { kind: 'weekly', day: 9, at: '09:00' } }, later);
    return r.schedule.kind === 'every' && r.armedAt === SAT;
  })());
  ok('an unknown id changes nothing', ids(update(list, 'zz', { name: 'x' }, later)) === 'r1' && update(list, 'zz', { name: 'x' }, later)[0].name === 'Morning digest');
  ok('updating does not mutate', list[0].name === 'Morning digest' && list[0].armedAt === SAT);
}

{
  const list = add(add([], DRAFT, SAT), { ...DRAFT, name: 'Two' }, SAT);
  ok('remove takes one out', ids(remove(list, 'r1')) === 'r2');
  ok('and an unknown id leaves both', ids(remove(list, 'zz')) === 'r1,r2');
  ok('pause pauses', pause(list, 'r1')[0].paused === true && nextRun(pause(list, 'r1')[0], SAT + HOUR) === null);
  ok('pausing does not mutate', list[0].paused === false);
  const paused = pause(list, 'r1');
  const days = SAT + 3 * 24 * HOUR;
  ok('resume unpauses and re-arms', (() => {
    const [r] = resume(paused, 'r1', days);
    return r.paused === false && r.armedAt === days;
  })());
  // Paused on Saturday, resumed three days later: it was not "owed" all that
  // time, it was paused. The next run is an interval from the resume.
  ok('so a routine resumed days later is not due at once', (() => {
    const back = resume(paused, 'r1', days);
    return due(back, days).every((r) => r.id !== 'r1') && nextRun(back[0], days) === days + MIN_EVERY * MIN;
  })());
  ok('resuming what is not paused changes nothing', resume(list, 'r1', days)[0].armedAt === SAT);
}

{
  const list = add([], DRAFT, SAT);
  const [r] = markRun(list, 'r1', { at: SAT + 5 * MIN, chatId: 'chat-7', ok: true });
  ok('markRun records the run', r.lastRun.at === SAT + 5 * MIN && r.lastRun.chatId === 'chat-7' && r.lastRun.ok === true);
  ok('and a second call, with the outcome, replaces it', (() => {
    const [done] = markRun([r], 'r1', { at: SAT + 5 * MIN, chatId: 'chat-7', ok: false, error: 'The agent stopped.' });
    return done.lastRun.ok === false && done.lastRun.error === 'The agent stopped.' && done.lastRun.at === SAT + 5 * MIN;
  })());
  ok('the recorded run is what the next one counts from', nextRun(r, SAT + 6 * MIN) === SAT + 10 * MIN);
  ok('marking an unknown id changes nothing', !('lastRun' in markRun(list, 'zz', { at: 1, chatId: 'c', ok: true })[0]));
  ok('marking does not mutate', !('lastRun' in list[0]));
}

// ── reading the stored list ───────────────────────────────────────────────
ok('the storage keys are what the app expects', KEY === 'vylo.routines.v1' && TICK_KEY === 'vylo.routines.tick.v1');
{
  const full = make({ lastRun: { at: SAT - HOUR, chatId: 'c3', ok: false, error: 'Rate limited' } });
  ok('a good record round-trips exactly', JSON.stringify(read(write([full]))) === JSON.stringify([full]), read(write([full])));
}
ok('nothing stored is an empty list', read(null).length === 0 && read('').length === 0);
ok('corrupt JSON is an empty list', read('{{{').length === 0);
ok('a non-array is an empty list', read('{"id":"r1"}').length === 0);
ok('a record that is not an object is skipped, the rest kept', read(JSON.stringify([null, 3, 'x', make()])).length === 1);
// Half a routine is a schedule with nothing to send or nobody to send it.
ok('a record with no id is dropped whole', read(JSON.stringify([make({ id: '' })])).length === 0);
ok('a duplicate id keeps the first', read(write([make({ name: 'One' }), make({ name: 'Two' })]))[0].name === 'One'
   && read(write([make(), make()])).length === 1);
ok('no agent, dropped', read(JSON.stringify([make({ agent: ' ' })])).length === 0);
ok('no brief, dropped', read(JSON.stringify([make({ brief: undefined })])).length === 0);
ok('a schedule that does not parse, dropped', read(JSON.stringify([make({ schedule: { kind: 'daily', at: 'noon' } })])).length === 0
   && read(JSON.stringify([make({ schedule: 'daily' })])).length === 0);
ok('no creation time, dropped', read(JSON.stringify([make({ createdAt: 'yesterday' })])).length === 0);
// Everything else is repaired.
ok('an interval is clamped on the way in', read(JSON.stringify([make({ schedule: { kind: 'every', minutes: 1 } })]))[0].schedule.minutes === MIN_EVERY);
ok('a time is padded on the way in', read(JSON.stringify([make({ schedule: { kind: 'daily', at: '7:30' } })]))[0].schedule.at === '07:30');
ok('paused is false unless it is exactly true', (() => {
  const of = (paused) => read(JSON.stringify([make({ paused })]))[0].paused;
  return of(undefined) === false && of('yes') === false && of(1) === false && of(true) === true;
})());
ok('a blank name falls back to the id', read(JSON.stringify([make({ name: '' })]))[0].name === 'r1');
ok('a bad last run is forgotten, the routine kept', (() => {
  for (const lastRun of [{ at: 'now', chatId: 'c', ok: true }, { at: 1, ok: true }, { at: 1, chatId: 'c', ok: 'yes' }, 'ran', 7]) {
    const [r] = read(JSON.stringify([make({ lastRun })]));
    if (!r || 'lastRun' in r) return false;
  }
  return true;
})());
ok('a good last run is kept, error and all', (() => {
  const [r] = read(JSON.stringify([make({ lastRun: { at: 5, chatId: 'c', ok: false, error: 'x' } })]));
  return r.lastRun.at === 5 && r.lastRun.error === 'x';
})());
ok('an empty error is not an error', !('error' in read(JSON.stringify([make({ lastRun: { at: 5, chatId: 'c', ok: true, error: '' } })]))[0].lastRun));
ok('a missing armedAt is the creation time', read(JSON.stringify([make({ armedAt: undefined })]))[0].armedAt === SAT);
ok('and one before the creation time is the creation time', read(JSON.stringify([make({ armedAt: SAT - 5 })]))[0].armedAt === SAT);
ok('the id is never remade', read(JSON.stringify([make({ id: 'kept-as-is' })]))[0].id === 'kept-as-is');

// ── held, not run ─────────────────────────────────────────────────────────
// The scheduler found the run owed and the window was not free. That is a
// deferral, and it must not move the anchor: a daily routine "run" at
// 09:00:10 with nothing opened would be next owed tomorrow, and today's run
// would be gone without a word.
{
  const r = make({ armedAt: local(2026, 9, 4, 12, 0), createdAt: local(2026, 9, 4, 12, 0),   // owes 09:00 today
                   lastRun: { at: local(2026, 9, 4, 9, 0, 1), chatId: 'c4', ok: false, error: 'boom' } });
  const at = local(2026, 9, 5, 9, 0, 10);
  const [h] = hold([r], 'r1', ' Waiting for you to finish. ');
  ok('hold writes the reason on the row, trimmed', h.held === 'Waiting for you to finish.');
  ok('and the run stays owed', nextRun(h, at) === local(2026, 9, 5, 9, 0) && due([h], at).length === 1);
  ok('so the next tick still finds it', due([h], at + 30_000).length === 1 && due([h], at + 2 * HOUR).length === 1);
  // The alternative, and the bug this replaces: a lastRun with no chat.
  ok('whereas recording the deferral as a run would have lost today\'s slot', (() => {
    const [m] = markRun([r], 'r1', { at, chatId: '', ok: false, error: 'busy' });
    return nextRun(m, at) === local(2026, 9, 6, 9, 0) && due([m], at + 2 * HOUR).length === 0;
  })());
  ok('an interval routine held is still owed the same run, not the click plus a period', (() => {
    const every = make({ schedule: { kind: 'every', minutes: 30 }, armedAt: SAT, createdAt: SAT });
    const t = SAT + 31 * MIN;
    const [held] = hold([every], 'r1', 'busy');
    return nextRun(held, t) === SAT + 30 * MIN && nextRun(held, t) === nextRun(every, t);
  })());
  ok('holding leaves the last result alone', h.lastRun.error === 'boom' && h.lastRun.chatId === 'c4');
  ok('a blank reason clears the note', !('held' in hold([h], 'r1', '  ')[0]));
  ok('holding an unknown id changes nothing', !('held' in hold([r], 'zz', 'x')[0]));
  ok('holding does not mutate', !('held' in r));
  // The key goes, not just the value: a row is read with `in`, and storage
  // must not carry an `undefined`.
  ok('the run that starts clears the note', !('held' in markRun([h], 'r1', { at, chatId: 'c5', ok: true })[0]));
  ok('and so does forgiving the run', !('held' in skip([h], 'r1', at)[0]) && skip([h], 'r1', at)[0].armedAt === at);
  ok('pausing keeps it — nothing about the deferral changed', pause([h], 'r1')[0].held === 'Waiting for you to finish.');
  ok('a held note round-trips through storage', read(write([h]))[0].held === 'Waiting for you to finish.');
  ok('and a note that is not a string is dropped, the routine kept', (() => {
    for (const held of [7, null, { why: 'x' }, '']) {
      const [x] = read(JSON.stringify([make({ held })]));
      if (!x || 'held' in x) return false;
    }
    return true;
  })());
}

// ── whether the window is free ────────────────────────────────────────────
// This app has one chat and a run replaces it, so the scheduler asks first.
{
  const free = { draft: false, deciding: false, queued: false, lastActivity: 0 };
  // Launched and left alone is what a routine is for: nobody has ever acted.
  ok('an app nobody has touched is free', midWork(free, SAT) === false);
  ok('a draft in the box holds the run', midWork({ ...free, draft: true }, SAT) === true);
  ok('a decision on screen holds the run', midWork({ ...free, deciding: true }, SAT) === true);
  ok('a queued message holds the run', midWork({ ...free, queued: true }, SAT) === true);
  ok('a key or click in the last minute holds the run', midWork({ ...free, lastActivity: SAT - 59_000 }, SAT) === true);
  ok('the minute is PRESENT_MS exactly', PRESENT_MS === 60_000
     && midWork({ ...free, lastActivity: SAT - PRESENT_MS + 1 }, SAT) === true
     && midWork({ ...free, lastActivity: SAT - PRESENT_MS }, SAT) === false);
  ok('a minute of quiet with an empty box is free', midWork({ ...free, lastActivity: SAT - 5 * MIN }, SAT) === false);
  ok('now as a Date gives the same answer', midWork({ ...free, lastActivity: SAT - 10_000 }, new Date(SAT)) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
