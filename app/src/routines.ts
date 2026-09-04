/**
 * Routines: a named agent put on a schedule.
 *
 * BridgeMind's feature, and the one people ask for the morning after they first
 * write a brief that works: "review whatever landed overnight", "summarise the
 * open pull requests", "check the failing test and tell me why". A routine is
 * that brief, the agent that should run it, and when. Each run happens in a
 * fresh chat while the app is open, and the person reads the result the way
 * they read any other chat — nothing here approves anything on their behalf.
 *
 * This module is the model only: what a routine is, when it is due, and how
 * the list changes. The scheduler that ticks, the runner that opens the chat,
 * and the panel that shows the rows are elsewhere and call in.
 *
 * ## Four kinds of schedule, and no cron
 *
 * Every N minutes; daily at a time; weekly on a day at a time; only by hand.
 * That is the whole grammar, and it is small on purpose. A cron string can say
 * more, and that is the problem with it: `0 9 * * 1-5` and `0 9 * * 1,5` look
 * alike and mean different weeks, nobody can read one back as a sentence, and
 * a sentence is what the row has to show — in four languages, three of them
 * right to left. Each of these four kinds *is* a sentence (`describe`), so a
 * schedule can be understood at a glance and translated. Everything anybody
 * has asked for so far fits in them; a fifth kind can be added when someone
 * asks, and `read` will drop what it does not recognise rather than guess.
 *
 * ## Wall-clock time, not UTC
 *
 * "Daily at 09:00" means nine on the clock on the wall, including the week the
 * clocks change. So daily and weekly slots are computed with the local `Date`
 * constructor — `new Date(y, m, d + 1, 9, 0)` is tomorrow's nine o'clock
 * whether tomorrow is 23, 24 or 25 hours away — and never as "last run plus
 * 24 hours", which drifts an hour twice a year. The one wrinkle is the hour
 * that does not exist on the spring-forward night; the platform moves it to
 * the hour after, which is what an alarm clock does too.
 *
 * ## Armed at, and why a routine never fires the instant you save it
 *
 * A routine that fires as soon as it is created is one you cannot finish
 * writing, and one that fires as soon as you change its time — or unpause it —
 * is one you cannot safely edit. So every schedule counts from a moment,
 * `armedAt`: set when the routine is created, again when its schedule changes,
 * again when it is resumed, and again when a missed run is skipped. The next
 * run is the first slot strictly after the later of `armedAt` and the last
 * run. A brand-new "every 30 minutes" runs thirty minutes from now; a new
 * "daily at 09:00" saved at ten runs tomorrow.
 *
 * ## Owed, not queued
 *
 * `nextRun` is the run the routine is *owed* (a moment at or before now) or
 * else the next one it will be (a moment after now). It is never more than one
 * period behind: a laptop that was asleep for three days owes its daily
 * routine one run, this morning's, not three. Missed slots do not stack —
 * BridgeMind is explicit that missed work is not guaranteed — and a run that
 * happens moves the anchor forward, so `due` is simply "owed, not paused, not
 * manual, and not just run".
 *
 * ## While the app was closed, nothing ran
 *
 * There is no background process. On launch the scheduler compares the last
 * time it ticked with now: any routine whose owed run fell in that gap was
 * missed, and `missedWhileClosed` names them so the app can say so. They are
 * *reported*, not run — a launch that opens five chats nobody asked for is the
 * wrong way to start the day, and BridgeMind's rule is the same. The scheduler
 * then calls `skip` on each so the next run counts from now; without that the
 * owed run would fire on the first tick.
 *
 * ## The double-fire guard
 *
 * The scheduler ticks every few seconds and the store it reads is React state,
 * which lands a beat after it is written. Record the start of a run with
 * `markRun` the moment it starts, but for the beat in between, `due` also
 * refuses anything that ran in the last sixty seconds. That guard is a
 * backstop, not the mechanism: a routine whose start was never recorded fires
 * again a minute later.
 *
 * ## What is deliberately not here
 *
 * No catch-up runs, no time-zone field, no run history beyond the last one —
 * the chat is the history, and it is already in the chat list — and no retries.
 * A routine that failed says so in its row, and the person decides.
 */

import type { Weekday } from './calendar';

export type Schedule =
  | { kind: 'every'; minutes: number }
  | { kind: 'daily'; at: string }
  | { kind: 'weekly'; day: Weekday; at: string }
  | { kind: 'manual' };

/** A daily or weekly schedule: the two that have a slot on the clock. */
type Timed = Extract<Schedule, { kind: 'daily' | 'weekly' }>;

export interface LastRun {
  /** When the run started. The next interval counts from here. */
  at: number;
  /** The chat it ran in, so the row can open it. */
  chatId: string;
  ok: boolean;
  error?: string;
}

export interface Routine {
  /** Stable, generated once. */
  id: string;
  name: string;
  /** The agent that runs it, by id. */
  agent: string;
  /** The whole instruction. Self-contained: a fresh chat has no other context. */
  brief: string;
  schedule: Schedule;
  paused: boolean;
  /**
   * The moment the schedule counts from. Creation, the last schedule change,
   * the last resume or the last skipped run, whichever is latest — see the
   * header. Never earlier than `createdAt`.
   */
  armedAt: number;
  lastRun?: LastRun;
  createdAt: number;
}

/** What a person fills in. Everything else is set here. */
export type Draft = Pick<Routine, 'name' | 'agent' | 'brief' | 'schedule'>;

/** Where the list is kept. Versioned, so a future shape can be told apart. */
export const KEY = 'vylo.routines.v1';

/** Where the scheduler notes its last tick, for `missedWhileClosed` on launch. */
export const TICK_KEY = 'vylo.routines.tick.v1';

/**
 * The bounds on "every N minutes".
 *
 * Five at the bottom because a run is a whole agent turn, and a routine firing
 * every minute is a bill rather than a habit. A week at the top because past
 * that a person means "weekly", which is a kind of its own and reads as one.
 */
export const MIN_EVERY = 5;
export const MAX_EVERY = 10080;

/** How recently a routine may have run and still be refused by `due`. */
export const GUARD_MS = 60_000;

/** English weekday names, Sunday first, as `Date.getDay` counts. */
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** A `Date` from the scheduler or epoch milliseconds from storage: both work. */
export type Now = Date | number;

const ms = (now: Now): number => (typeof now === 'number' ? now : now.getTime());

/** A trimmed string, or nothing. Guards a value that was not a string at all. */
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ── Schedules ──────────────────────────────────────────────────────────────

/** `9:00`, `09:00`, `23:59`. Not `24:00`, not `9`, not `9am`. */
const TIME = /^(\d{1,2}):(\d{2})$/;

/** `HH:MM`, zero-padded, or null if the string is not a time of day. */
function timeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = TIME.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * A schedule worth keeping, or null.
 *
 * Every schedule that enters the model goes through here — from storage, from
 * a form, from a patch — so the rest of the module can trust what it holds.
 * An interval out of range is clamped rather than refused: somebody who typed
 * 2 meant "often" and gets the smallest often there is. A time that is not a
 * time has no sensible substitute, so that schedule is refused whole.
 */
export function normalise(raw: unknown): Schedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  switch (s.kind) {
    case 'every': {
      if (typeof s.minutes !== 'number' || !Number.isFinite(s.minutes)) return null;
      const minutes = Math.min(MAX_EVERY, Math.max(MIN_EVERY, Math.round(s.minutes)));
      return { kind: 'every', minutes };
    }
    case 'daily': {
      const at = timeOf(s.at);
      return at ? { kind: 'daily', at } : null;
    }
    case 'weekly': {
      const at = timeOf(s.at);
      const day = s.day;
      if (!at || typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) return null;
      return { kind: 'weekly', day: day as Weekday, at };
    }
    case 'manual':
      return { kind: 'manual' };
    default:
      return null;
  }
}

/** Whether two schedules say the same thing. What decides if an edit re-arms. */
export function sameSchedule(a: Schedule, b: Schedule): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'every': return a.minutes === (b as typeof a).minutes;
    case 'daily': return a.at === (b as typeof a).at;
    case 'weekly': return a.day === (b as typeof a).day && a.at === (b as typeof a).at;
    case 'manual': return true;
  }
}

/** A sentence key and what goes in its holes, for `fill(t(key), vars)`. */
export interface Phrase {
  key: string;
  vars: Record<string, string | number>;
}

/**
 * The schedule as a sentence key.
 *
 * The keys are the English sentences, as everywhere in this app, and they
 * carry `{n}`, `{time}` and `{day}` holes rather than being concatenated at the call site — the
 * translator moves the number to where the language wants it. Whole hours are
 * said as hours: "Every 60 minutes" is what a computer says.
 *
 * `day` is the English weekday name; a row in another language substitutes the
 * name `Intl` gives it, which is how the calendar already does it.
 */
export function phrase(s: Schedule): Phrase {
  switch (s.kind) {
    case 'every':
      if (s.minutes === 60) return { key: 'Every hour', vars: {} };
      if (s.minutes % 60 === 0) return { key: 'Every {n} hours', vars: { n: s.minutes / 60 } };
      return { key: 'Every {n} minutes', vars: { n: s.minutes } };
    case 'daily':
      return { key: 'Daily at {time}', vars: { time: s.at } };
    case 'weekly':
      return { key: 'Weekly on {day} at {time}', vars: { day: DAYS[s.day], time: s.at } };
    case 'manual':
      return { key: 'Only when run by hand', vars: {} };
  }
}

/**
 * The schedule as an English sentence: "Every 30 minutes", "Daily at 09:00",
 * "Weekly on Monday at 09:00", "Only when run by hand".
 *
 * The same substitution `i18n.fill` does, done here so this module stays free
 * of the dictionary. A row in the interface should go through `phrase` and the
 * translator; this is for anywhere there is no translator to hand.
 */
export function describe(s: Schedule): string {
  const { key, vars } = phrase(s);
  let out = key;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

// ── When ───────────────────────────────────────────────────────────────────

/** The local moment `days` from the date `t` falls on, at `at`. */
function on(t: number, days: number, at: string): number {
  const [h, m] = at.split(':').map(Number);
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, h, m, 0, 0).getTime();
}

/**
 * The nearest slot of a daily or weekly schedule: the first strictly after `t`
 * (`dir` 1) or the last at or before it (`dir` -1).
 *
 * Eight days rather than seven, because today counts and a weekly whose day is
 * today but whose time has gone lands exactly a week out. Every weekday occurs
 * in that span in either direction, so the loop always finds one.
 */
function slot(s: Timed, t: number, dir: 1 | -1): number {
  let found = t;
  for (let i = 0; i <= 7; i++) {
    const c = on(t, i * dir, s.at);
    if (s.kind === 'weekly' && new Date(c).getDay() !== s.day) continue;
    if (dir === 1 ? c > t : c <= t) { found = c; break; }
  }
  return found;
}

/**
 * When a routine runs next, as epoch milliseconds, or null if it never will on
 * its own.
 *
 * At or before `now` means the routine is *owed* that run; after `now` means
 * that is when it will be. Counts from the later of `armedAt` and the last run
 * — see the header for why — and never reaches back more than one period:
 * an interval that has been owed for three days is owed the most recent
 * multiple, a daily routine the most recent slot.
 *
 * Paused and manual routines have no next run. "Run now" is not a schedule.
 */
export function nextRun(r: Routine, now: Now): number | null {
  const t = ms(now);
  if (r.paused || r.schedule.kind === 'manual' || !Number.isFinite(t)) return null;
  const anchor = Math.max(r.armedAt, r.lastRun?.at ?? r.armedAt);
  const s = r.schedule;

  if (s.kind === 'every') {
    const period = s.minutes * 60_000;
    // The k-th interval after the anchor, for the largest k that is not in the
    // future — and never the zeroth, which would be "right now".
    const k = Math.max(1, Math.floor((t - anchor) / period));
    return anchor + k * period;
  }

  // The most recent slot on the clock, if the anchor is before it: that is the
  // run being owed. Otherwise the next slot ahead — ahead of the anchor too,
  // for a stored value that somehow sits in the future.
  const owed = slot(s, t, -1);
  return owed > anchor ? owed : slot(s, Math.max(t, anchor), 1);
}

/**
 * The routines the scheduler should start now.
 *
 * Owed a run, not paused, not manual — and not one that ran in the last
 * minute, for the beat between a run starting and the store saying so. The
 * scheduler calls `markRun` for each of these the moment the run starts.
 */
export function due(routines: readonly Routine[], now: Now): Routine[] {
  const t = ms(now);
  return routines.filter((r) => {
    const next = nextRun(r, t);
    if (next === null || next > t) return false;
    return !(r.lastRun && t - r.lastRun.at < GUARD_MS);
  });
}

/**
 * Routines whose run fell while the app was closed.
 *
 * `lastTick` is when the scheduler last ran, from `TICK_KEY`; null on a first
 * launch, when there is nothing to compare against and so nothing to report.
 * A routine is named if the run it is owed fell in `[lastTick, now)`. One that
 * was owed *before* the last tick — while the app was open — is not missed, it
 * is due, and the scheduler will start it.
 *
 * These are for a notice, not a queue: call `skip` on each after showing it.
 */
export function missedWhileClosed(
  routines: readonly Routine[], lastTick: number | null, now: Now,
): Routine[] {
  const t = ms(now);
  if (lastTick === null || !Number.isFinite(lastTick)) return [];
  return routines.filter((r) => {
    const next = nextRun(r, t);
    return next !== null && next >= lastTick && next < t;
  });
}

// ── Reading and writing the list ───────────────────────────────────────────

/** A last run worth keeping, or nothing. A routine survives losing this. */
function lastRunOf(raw: unknown): LastRun | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const l = raw as Record<string, unknown>;
  if (typeof l.at !== 'number' || !Number.isFinite(l.at)) return undefined;
  if (typeof l.chatId !== 'string' || typeof l.ok !== 'boolean') return undefined;
  const out: LastRun = { at: l.at, chatId: l.chatId, ok: l.ok };
  if (typeof l.error === 'string' && l.error) out.error = l.error;
  return out;
}

/**
 * Read the stored list, repairing anything untrustworthy.
 *
 * The same posture as every other store in this app: a corrupt value is the
 * empty list, never a window that will not open. A record missing anything a
 * run needs — an id, an agent, a brief, a schedule that parses, a creation
 * time to count from — is dropped whole rather than half-kept. Everything
 * else is repaired: a blank name becomes the id, `paused` is false unless it is
 * exactly true, a bad last run is forgotten, and `armedAt` falls back to the
 * creation time and never sits before it.
 */
export function read(raw: string | null): Routine[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    const out: Routine[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (typeof r.id !== 'string' || !r.id.trim() || seen.has(r.id)) continue;
      const agent = text(r.agent);
      const brief = text(r.brief);
      if (!agent || !brief) continue;
      const schedule = normalise(r.schedule);
      if (!schedule) continue;
      const createdAt = r.createdAt;
      if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) continue;
      seen.add(r.id);
      const armedAt = typeof r.armedAt === 'number' && Number.isFinite(r.armedAt)
        ? Math.max(r.armedAt, createdAt) : createdAt;
      const routine: Routine = {
        id: r.id,
        name: text(r.name) || r.id,
        agent,
        brief,
        schedule,
        paused: r.paused === true,
        armedAt,
        createdAt,
      };
      const last = lastRunOf(r.lastRun);
      if (last) routine.lastRun = last;
      out.push(routine);
    }
    return out;
  } catch {
    return [];
  }
}

/** What goes into storage. */
export function write(list: readonly Routine[]): string {
  return JSON.stringify(list);
}

/** A fresh id. Distinct enough for a list nobody will put fifty entries in. */
export function newId(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const id = `r${n}`;
    if (!taken.includes(id)) return id;
  }
}

// ── Changing the list ──────────────────────────────────────────────────────
//
// Every one of these returns a new list and leaves the old one alone, and
// every one of them returns the list unchanged — as a copy — when the id is
// not there or the input is not usable. None of them reads the clock.

/**
 * Add a routine at the end. It is the last element of the result.
 *
 * Refused whole, list unchanged, if the name, agent or brief is blank or the
 * schedule does not parse: half a routine is a schedule with nothing to send
 * or nobody to send it. Armed at `now`, so its first run is one interval, or
 * the next slot, from here — never this instant.
 */
export function add(list: readonly Routine[], draft: Draft, now: Now): Routine[] {
  const name = text(draft.name);
  const agent = text(draft.agent);
  const brief = text(draft.brief);
  const schedule = normalise(draft.schedule);
  if (!name || !agent || !brief || !schedule) return [...list];
  const t = ms(now);
  return [...list, {
    id: newId(list.map((r) => r.id)),
    name, agent, brief, schedule,
    paused: false,
    armedAt: t,
    createdAt: t,
  }];
}

/**
 * Change a routine's name, agent, brief or schedule.
 *
 * A blank field or a schedule that does not parse leaves that field as it was.
 * A schedule that actually changed re-arms the routine at `now` — a routine
 * moved from ten o'clock to nine at half past nine runs tomorrow at nine, not
 * the moment the form closes. A rename does not re-arm; nothing about when it
 * runs was said.
 */
export function update(
  list: readonly Routine[], id: string, patch: Partial<Draft>, now: Now,
): Routine[] {
  const t = ms(now);
  return list.map((r) => {
    if (r.id !== id) return r;
    const schedule = (patch.schedule && normalise(patch.schedule)) || r.schedule;
    return {
      ...r,
      name: text(patch.name) || r.name,
      agent: text(patch.agent) || r.agent,
      brief: text(patch.brief) || r.brief,
      schedule,
      armedAt: sameSchedule(schedule, r.schedule) ? r.armedAt : t,
    };
  });
}

export function remove(list: readonly Routine[], id: string): Routine[] {
  return list.filter((r) => r.id !== id);
}

/** Stop it running on its own. Its last result stays on the row. */
export function pause(list: readonly Routine[], id: string): Routine[] {
  return list.map((r) => (r.id === id && !r.paused ? { ...r, paused: true } : r));
}

/**
 * Let it run again, counting from `now`.
 *
 * Re-armed, because a routine paused on Monday and resumed on Thursday has
 * not been "owed" since Tuesday — it was paused. Its next run is the next
 * slot from here.
 */
export function resume(list: readonly Routine[], id: string, now: Now): Routine[] {
  const t = ms(now);
  return list.map((r) => (r.id === id && r.paused ? { ...r, paused: false, armedAt: t } : r));
}

/**
 * Forgive the run it is owed. The next one counts from `now`.
 *
 * What the scheduler calls for each routine `missedWhileClosed` named, once
 * the notice is shown. Not a run, so `lastRun` is untouched: the row goes on
 * saying what last actually happened.
 */
export function skip(list: readonly Routine[], id: string, now: Now): Routine[] {
  const t = ms(now);
  return list.map((r) => (r.id === id ? { ...r, armedAt: t } : r));
}

/**
 * Record a run.
 *
 * Call it when the run *starts*, with the chat it opened and `ok: true`, and
 * again when it ends with the outcome, keeping the same `at`. The start is
 * what moves the anchor, and waiting for the outcome to record it would leave
 * the routine owed — and started again — on every tick in between.
 */
export function markRun(list: readonly Routine[], id: string, result: LastRun): Routine[] {
  // A run with no real time would make the routine due on every tick — the
  // anchor arithmetic in `nextRun` has no answer for NaN. Refuse it.
  if (!Number.isFinite(result.at)) return [...list];
  return list.map((r) => (r.id === id ? { ...r, lastRun: { ...result } } : r));
}
