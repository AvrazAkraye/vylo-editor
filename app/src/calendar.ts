/**
 * A month, and what is due in it.
 *
 * The to-do list already knows when things are due — `^today`, `^tomorrow`,
 * `^2026-09-05` — and had nowhere to show it. A list answers "what is next";
 * a month answers "what is this week going to be like", which is a different
 * question and the reason people keep asking for a calendar.
 *
 * Dates are handled as `YYYY-MM-DD` strings throughout rather than as `Date`
 * objects. A `Date` is a moment in time and a due date is not: comparing two
 * of them drags in the hour, the timezone, and whether the clocks changed
 * between them, and every one of those is a way for a task due today to appear
 * yesterday. Strings compare lexically, which for this format is the same as
 * comparing dates and cannot be wrong about midnight.
 */

import type { Rolled } from './todo';
import { dueOn, today } from './todoview';

/** `YYYY-MM-DD` for a local date. */
export function key(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month + 1)}-${p(day)}`;
}

/** Which weekday a week starts on. 0 is Sunday, as `Date.getDay` counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Where the week starts, by language.
 *
 * Monday for English, which is what most of the world and every developer tool
 * uses. Saturday for Arabic and both Kurdish languages, which is what a week
 * starts on where they are read — a calendar that begins on the wrong day is
 * not a cosmetic problem, it is one somebody miscounts from.
 */
export function firstDay(lang: string): Weekday {
  return lang === 'ar' || lang === 'ckb' || lang === 'kmr' ? 6 : 1;
}

export interface Day {
  /** `YYYY-MM-DD`. */
  key: string;
  day: number;
  /** False for the leading and trailing days borrowed from the months either side. */
  inMonth: boolean;
  isToday: boolean;
}

/** Weeks shown, always. A grid that changes height month to month jumps. */
export const WEEKS = 6;

/**
 * The grid for a month: six weeks of seven days, in order.
 *
 * Always six, and always full. February in a common year starting on its first
 * weekday needs four; December can need six. A grid sized to its month makes
 * the page jump every time somebody presses next, and the borrowed days at
 * either end are useful anyway — a task due on the 1st is visible while you are
 * still looking at the month before it.
 */
export function grid(year: number, month: number, starts: Weekday, now = new Date()): Day[] {
  const nowKey = today(now);
  const first = new Date(year, month, 1);
  // How many days of the previous month to show before the 1st.
  const lead = (first.getDay() - starts + 7) % 7;
  const out: Day[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const d = new Date(year, month, 1 - lead + i);
    const k = key(d.getFullYear(), d.getMonth(), d.getDate());
    out.push({
      key: k,
      day: d.getDate(),
      inMonth: d.getMonth() === month && d.getFullYear() === year,
      isToday: k === nowKey,
    });
  }
  return out;
}

/** The month before and after, without the year going wrong in January. */
export function shift(year: number, month: number, by: number): { year: number; month: number } {
  const d = new Date(year, month + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

/**
 * Tasks by the day they are due.
 *
 * Only tasks with a due date appear. A calendar that invented a position for
 * everything else — put it on the day it was written, say — would be showing a
 * date nobody set, and somebody would plan around it.
 */
export function byDay(tasks: readonly Rolled[], now = new Date()): Map<string, Rolled[]> {
  const out = new Map<string, Rolled[]>();
  for (const task of tasks) {
    const on = dueOn(task.due, now);
    if (!on) continue;
    const list = out.get(on);
    if (list) list.push(task); else out.set(on, [task]);
  }
  return out;
}

/** How many tasks a month holds, for the "nothing here" case. */
export function inGrid(days: readonly Day[], due: Map<string, Rolled[]>): number {
  return days.reduce((n, d) => n + (due.get(d.key)?.length ?? 0), 0);
}

/** The weekday names, in the order this grid shows them. */
export function weekdays(starts: Weekday, lang: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    // 2024-01-07 was a Sunday, so adding the weekday number lands on that day.
    const d = new Date(2024, 0, 7 + ((starts + i) % 7));
    out.push(new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d));
  }
  return out;
}

/** "September 2026", in the language in use. */
export function monthName(year: number, month: number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' })
    .format(new Date(year, month, 1));
}

/** "Wednesday, 2 September", for the heading over a day's list. */
export function longDate(iso: string, lang: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(y, m - 1, d));
}
