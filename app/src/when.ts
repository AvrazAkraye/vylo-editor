/**
 * How long ago, how long until, and where a week starts.
 *
 * The wording every panel needs for a moment that is not "now": the dashboard
 * saying when a run finished, both panels saying when the next one is due, and
 * the launch notice saying how many fell in the gap. It was written twice —
 * once in each panel — and the two copies had already drifted apart in the way
 * duplicated wording always does: the dashboard could say "3 days ago" about
 * the past and only "In 144 hours" about the future, in the same file, four
 * lines apart. One module, imported by both, is the fix and the reason this
 * file exists.
 *
 * ## A key and its holes, not a sentence
 *
 * Every function here returns `{ key, vars }` — the same shape `routines.phrase`
 * returns, and for the same reason. This module holds no dictionary and takes
 * no `t`: it decides *which sentence* is true, the caller translates it and
 * fills the holes with `fill(t(key), vars)`. That keeps the module pure enough
 * to test with no React and no catalogue, and it keeps the number inside the
 * sentence, where a translator can move it to wherever the language wants it
 * rather than having it concatenated on in English word order.
 *
 * ## One is its own sentence
 *
 * "In 1 minutes" and "1 runs were due" were shipped, in four languages. The
 * house pattern for this is already in the catalogue — `'1 day left'` beside
 * `'{n} days left'` — a singular key the caller picks by `n === 1`, so this
 * does the same. It is deliberately not a plural-rule engine: English forces
 * exactly one split, and the interesting cases in the other three languages
 * are not splits this code could get right anyway. Arabic wants one noun after
 * 3–10 and another after 11, and Kurmanji wants an oblique plural in some
 * frames and not others — decisions that belong to the person writing the
 * translation, who can see the whole sentence, and not to a rule table here.
 *
 * ## The ladder steps up when the smaller unit fills
 *
 * Minutes below an hour, hours below a day, days above. The rounding is done
 * before the unit is chosen, not after, so a value that rounds *into* the next
 * unit is said in that unit: 1439 minutes is "1 day", never the "24 hours" a
 * naive `m < 1440` branch prints. Rounding, not truncating, because "In 2
 * hours" is what a person expects 119 minutes to say.
 *
 * `Intl.RelativeTimeFormat` would do some of this, and is not used. The four
 * languages this app ships come from one catalogue a person can read, correct
 * and match to its neighbours; two of them would get whatever wording the
 * platform happens to carry, in a register nobody here chose, and Badini is
 * not reliably there at all.
 *
 * ## Two things that are about *when* and are not durations
 *
 * `isTime` is here because a form has to say "that is not a time" before
 * `routines.normalise` quietly refuses the whole schedule, and the rule for
 * what counts must be the same rule. `weekOrder` is here because a weekday
 * picker that always starts on Sunday is wrong in three of the four languages
 * — `calendar.firstDay` already knows where the week starts, and this turns
 * that into the order a list is rendered in, leaving the values alone.
 */

import type { Phrase } from './routines';

// ── Units ──────────────────────────────────────────────────────────────────

/** One minute in milliseconds. The smallest unit anything here counts in. */
const MINUTE = 60_000;

/** Minutes in an hour and in a day, so the ladder below reads as arithmetic. */
const HOUR = 60;
const DAY = 24 * HOUR;

/**
 * Whole minutes between two moments, never negative.
 *
 * Clamped at zero because both callers pass a difference that can go the wrong
 * way by a few seconds — a clock that stepped, or a tick that landed early —
 * and "In -1 minutes" is a bug on the screen where "Due now" is the truth.
 */
function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.round((to - from) / MINUTE));
}

/**
 * The size and unit a count of minutes should be said in.
 *
 * Rounds first, then steps up if the rounded value has filled the unit above:
 * 90 minutes is `{ n: 2, unit: 'hour' }`, and 1439 is `{ n: 1, unit: 'day' }`
 * rather than 24 hours. `n` is 0 only when the moment is now.
 */
function scale(mins: number): { n: number; unit: 'minute' | 'hour' | 'day' } {
  if (mins < 1) return { n: 0, unit: 'minute' };
  if (mins < HOUR) return { n: mins, unit: 'minute' };
  const hours = Math.round(mins / HOUR);
  if (hours < 24) return { n: hours, unit: 'hour' };
  return { n: Math.max(1, Math.round(mins / DAY)), unit: 'day' };
}

// ── Saying it ──────────────────────────────────────────────────────────────

/**
 * How long ago a moment was: "Just now", "1 minute ago", "{n} minutes ago",
 * and the same for hours and days.
 *
 * "Just now" for anything under a minute rather than "0 minutes ago", which is
 * both wrong and the sort of thing that makes a person distrust the rest of
 * the row.
 */
export function ago(then: number, now: number): Phrase {
  const { n, unit } = scale(minutesBetween(then, now));
  if (n === 0) return { key: 'Just now', vars: {} };
  if (unit === 'minute') return n === 1 ? { key: '1 minute ago', vars: {} } : { key: '{n} minutes ago', vars: { n } };
  if (unit === 'hour') return n === 1 ? { key: '1 hour ago', vars: {} } : { key: '{n} hours ago', vars: { n } };
  return n === 1 ? { key: '1 day ago', vars: {} } : { key: '{n} days ago', vars: { n } };
}

/**
 * How long until a moment: "Due now", "In 1 minute", "In {n} minutes", and the
 * same for hours and days.
 *
 * A moment already past is "Due now", not a negative anything — a routine
 * whose slot has gone is owed that run, which is what the row means to say.
 * Days matter here as much as they do in `ago`: a weekly routine six days out
 * used to read "In 144 hours".
 */
export function until(at: number, now: number): Phrase {
  const { n, unit } = scale(minutesBetween(now, at));
  if (n === 0) return { key: 'Due now', vars: {} };
  if (unit === 'minute') return n === 1 ? { key: 'In 1 minute', vars: {} } : { key: 'In {n} minutes', vars: { n } };
  if (unit === 'hour') return n === 1 ? { key: 'In 1 hour', vars: {} } : { key: 'In {n} hours', vars: { n } };
  return n === 1 ? { key: 'In 1 day', vars: {} } : { key: 'In {n} days', vars: { n } };
}

/**
 * The launch notice: how many runs fell due while the app was closed.
 *
 * Two whole sentences rather than one with a number in it, because the verb
 * moves with the number in English and in all three of the others — "1 run was
 * due … and was skipped" is not the plural sentence with a 1 in it.
 *
 * Nothing at all for a count of none. Both callers already guard on a non-empty
 * list, and this used to lean on that: `{ n: 0 }` was returned deliberately, so
 * that a caller which forgot the guard would say something visibly wrong rather
 * than nothing. That bet is no longer worth it now the dashboard's list can
 * arrive filtered — a folder-filtered list is a list that can legitimately come
 * back empty, and "0 runs were due while the app was closed and were skipped."
 * is not a sentence any language should have to translate. An empty key fills
 * to an empty string, so a caller that renders it renders nothing, and a
 * catalogue is never asked for a sentence about zero.
 */
export function missedRuns(n: number): Phrase {
  if (n < 1) return { key: '', vars: {} };
  return n === 1
    ? { key: '1 run was due while the app was closed and was skipped.', vars: {} }
    : { key: '{n} runs were due while the app was closed and were skipped.', vars: { n } };
}

// ── Times of day and days of the week ──────────────────────────────────────

/** `9:00`, `09:00`, `23:59`. The pattern `routines.normalise` accepts. */
const TIME = /^(\d{1,2}):(\d{2})$/;

/**
 * Whether a string is a time of day the schedule model will keep.
 *
 * The same rule as `routines.normalise`, deliberately duplicated in four lines
 * rather than exported from there and imported here: what a *form* needs is a
 * yes-or-no it can say a sentence about before anything is saved, and what the
 * model needs is a normalised value or nothing. A form that asked the model
 * would learn only that the whole schedule was refused, which is how a blank
 * time came to be reported as a missing name.
 */
export function isTime(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  const m = TIME.exec(s.trim());
  return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59;
}

/**
 * The seven weekday indexes in the order a week runs, starting at `first`.
 *
 * Indexes, not names: `Date.getDay` and `Schedule.day` count from Sunday and
 * must keep counting from Sunday, so only the *order they are shown in* turns
 * round. `weekOrder(6)` is `[6, 0, 1, 2, 3, 4, 5]` — the Saturday-first week
 * `calendar.firstDay` gives Arabic and both Kurdish languages. Anything that
 * is not a whole day index falls back to Sunday rather than throwing: the
 * value reaches here from a stored language code by way of a lookup.
 */
export function weekOrder(first: number): number[] {
  const start = Number.isInteger(first) ? ((first % 7) + 7) % 7 : 0;
  return Array.from({ length: 7 }, (_, i) => (start + i) % 7);
}
