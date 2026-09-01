/**
 * How the to-do list is arranged on screen.
 *
 * Kept out of the component because grouping and filtering is where a task
 * board gets its answers wrong quietly — a task in two columns, a blocked task
 * hidden behind a filter, a count that disagrees with the list under it. All
 * of that is arithmetic, so it is testable, so it is here.
 *
 * `todo.ts` owns the file. This owns the shape of the view over it and writes
 * nothing.
 */

import type { Priority, Rolled, Status } from './todo';
import { RANK, UNRANKED, flatten } from './todo';

// ── Smart sections ─────────────────────────────────────────────────────────

export type SectionKey =
  | 'today' | 'doing' | 'blocked' | 'urgent' | 'upcoming' | 'backlog' | 'later' | 'done';

export interface Section {
  key: SectionKey;
  /** The i18n key. Sentence, as everywhere else in this app. */
  title: string;
  icon: string;
  tasks: Rolled[];
}

/** The order sections are shown in, and the order a task is claimed by them. */
export const SECTIONS: { key: SectionKey; title: string; icon: string }[] = [
  { key: 'today', title: 'Today', icon: 'star' },
  { key: 'doing', title: 'In progress', icon: 'play' },
  { key: 'blocked', title: 'Blocked', icon: 'warning' },
  { key: 'urgent', title: 'High priority', icon: 'flame' },
  { key: 'upcoming', title: 'Upcoming', icon: 'calendar' },
  { key: 'backlog', title: 'Backlog', icon: 'list' },
  { key: 'later', title: 'Later', icon: 'archive' },
  { key: 'done', title: 'Completed', icon: 'check' },
];

/** Today as `YYYY-MM-DD` in local time. Passed in so tests are not a clock. */
export function today(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** The date a `^` token means, or null for one that names no day. */
export function dueOn(due: string | null, now = new Date()): string | null {
  if (!due) return null;
  if (due === 'today') return today(now);
  if (due === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return today(d);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null;
}

/**
 * Which section a task belongs to.
 *
 * One section each, and the first that claims it wins. A task in two places is
 * a task somebody ticks in one and then finds again in the other, and a count
 * beside a heading that does not add up to the total underneath it.
 *
 * The order is a claim about what to look at first: what is due, then what is
 * moving, then what is stuck, then what is important. Backlog is everything
 * with nothing said about it, which on most lists is most of it.
 */
export function sectionOf(task: Rolled, now = new Date()): SectionKey {
  if (task.done) return 'done';
  if (task.state === 'deferred') return 'later';

  const on = dueOn(task.due, now);
  // Overdue counts as today rather than as its own section: a task that was due
  // on Tuesday is not "upcoming", and hiding it in the past helps nobody.
  if (on && on <= today(now)) return 'today';

  if (task.state === 'blocked') return 'blocked';
  if (task.state === 'doing' || task.state === 'review' || task.state === 'testing') return 'doing';
  if (task.priority === 'critical' || task.priority === 'high') return 'urgent';
  if (on) return 'upcoming';
  return 'backlog';
}

/** The sections, in order, with the empty ones dropped. */
export function sections(tasks: Rolled[], now = new Date()): Section[] {
  const bucket = new Map<SectionKey, Rolled[]>();
  for (const task of tasks) {
    const key = sectionOf(task, now);
    const list = bucket.get(key);
    if (list) list.push(task); else bucket.set(key, [task]);
  }
  return SECTIONS
    .map((s) => ({ ...s, tasks: bucket.get(s.key) ?? [] }))
    .filter((s) => s.tasks.length);
}

// ── The board ──────────────────────────────────────────────────────────────

export interface Column { key: Status; title: string; tasks: Rolled[] }

/**
 * The kanban columns.
 *
 * One per status, which is the only arrangement where dragging a card means
 * something the file can record: dropping a card in Testing writes `@testing`.
 * A column that is not a status would need somewhere else to remember it.
 */
export const COLUMNS: { key: Status; title: string }[] = [
  { key: 'todo', title: 'Inbox' },
  { key: 'planning', title: 'Planned' },
  { key: 'doing', title: 'In progress' },
  { key: 'review', title: 'Review' },
  { key: 'testing', title: 'Testing' },
  { key: 'blocked', title: 'Blocked' },
  { key: 'done', title: 'Completed' },
  { key: 'deferred', title: 'Later' },
];

export function columns(tasks: Rolled[]): Column[] {
  return COLUMNS.map((c) => ({ ...c, tasks: tasks.filter((t) => t.state === c.key) }));
}

// ── Searching and filtering ────────────────────────────────────────────────

export interface Query {
  /** Free words. Every one of them has to appear somewhere in the task. */
  words: string[];
  status: Status[];
  priority: Priority[];
  tags: string[];
  files: string[];
  /** `is:done` / `is:open`, which are about the box rather than the status. */
  done: boolean | null;
}

const EMPTY: Query = { words: [], status: [], priority: [], tags: [], files: [], done: null };

const STATUS_WORDS = new Set<string>([
  'todo', 'planning', 'doing', 'review', 'testing', 'blocked', 'deferred', 'done',
]);
const PRIORITY_WORDS = new Set<string>(['critical', 'high', 'medium', 'low', 'maybe']);

/**
 * Read a search box.
 *
 * The same sigils the file uses, so somebody who has learnt `!high` in the list
 * can type `!high` in the search box and it means what they expect. Plus
 * `is:` for the box and `file:` for a path, because those two have no sigil.
 *
 * This is a small deliberate grammar rather than a guess at natural language.
 * "high priority bugs" is `!high #bug` — three characters longer, and it never
 * silently searches for something else.
 */
export function parseQuery(input: string): Query {
  const q: Query = { ...EMPTY, words: [], status: [], priority: [], tags: [], files: [] };
  for (const bit of input.trim().split(/\s+/).filter(Boolean)) {
    const low = bit.toLowerCase();
    if (low.startsWith('#') && low.length > 1) { q.tags.push(low.slice(1)); continue; }
    if (low.startsWith('!') && PRIORITY_WORDS.has(low.slice(1))) { q.priority.push(low.slice(1) as Priority); continue; }
    if (low.startsWith('@') && STATUS_WORDS.has(low.slice(1))) { q.status.push(low.slice(1) as Status); continue; }
    if (low.startsWith('file:') && low.length > 5) { q.files.push(low.slice(5)); continue; }
    if (low === 'is:done') { q.done = true; continue; }
    if (low === 'is:open' || low === 'is:todo') { q.done = false; continue; }
    if (low.startsWith('is:') && STATUS_WORDS.has(low.slice(3))) { q.status.push(low.slice(3) as Status); continue; }
    q.words.push(low);
  }
  return q;
}

/** True when the box is empty of anything that would narrow the list. */
export function isEmpty(q: Query): boolean {
  return !q.words.length && !q.status.length && !q.priority.length
    && !q.tags.length && !q.files.length && q.done === null;
}

/**
 * Does this task answer the query?
 *
 * Words are AND, because narrowing is what a second word is for. Values within
 * one kind are OR — `!high !critical` is "either" — because nothing can be two
 * priorities and asking for both would always return nothing.
 */
export function matches(task: Rolled, q: Query): boolean {
  if (q.done !== null && task.done !== q.done) return false;
  if (q.status.length && !q.status.includes(task.state)) return false;
  if (q.priority.length && (!task.priority || !q.priority.includes(task.priority))) return false;
  if (q.tags.length && !q.tags.every((tag) => task.tags.includes(tag))) return false;
  if (q.files.length && !q.files.every((f) => task.files.some((p) => p.toLowerCase().includes(f)))) return false;

  if (!q.words.length) return true;
  // The section is in the haystack so "milestone 2" finds a whole group, and
  // the note is in it because that is where the detail somebody half-remembers
  // was written down.
  const hay = [task.title, task.section, task.note, ...task.tags, ...task.files]
    .join(' ').toLowerCase();
  return q.words.every((w) => hay.includes(w));
}

/**
 * Every task answering the query, flat.
 *
 * Flat rather than a pruned tree: a filtered list that keeps parents for
 * structure shows tasks that did not match, and somebody scanning results
 * cannot tell which rows are answers and which are scaffolding. When a search
 * is on, every row on screen is a hit.
 */
export function search(tasks: Rolled[], input: string): Rolled[] {
  const q = parseQuery(input);
  if (isEmpty(q)) return tasks;
  return flatten(tasks).filter((t) => matches(t, q));
}

// ── Sorting ────────────────────────────────────────────────────────────────

export type Sort = 'file' | 'priority' | 'due' | 'progress';

/**
 * Sort a flat list.
 *
 * `file` is the order the file is written in, which is the default because it
 * is the order a person chose and the only one they can change by dragging.
 * Every other sort is stable on top of it, so two tasks of equal priority keep
 * the order they were written in rather than swapping about between renders.
 */
export function sortBy(tasks: Rolled[], sort: Sort, now = new Date()): Rolled[] {
  const out = [...tasks];
  if (sort === 'file') return out;
  const rank = (t: Rolled) => (t.priority ? RANK[t.priority] : UNRANKED);
  const when = (t: Rolled) => dueOn(t.due, now) ?? '9999-99-99';
  const key: Record<Exclude<Sort, 'file'>, (t: Rolled) => number | string> = {
    priority: rank,
    due: when,
    // Descending, so the nearly-finished are at the top where they can be
    // finished — the whole reason somebody sorts by progress.
    progress: (t) => -t.percent,
  };
  const f = key[sort];
  return out
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (f(a.t) < f(b.t) ? -1 : f(a.t) > f(b.t) ? 1 : a.i - b.i))
    .map((x) => x.t);
}

// ── Counts for the chips ───────────────────────────────────────────────────

/** Every tag in the list, most used first, for the filter row. */
export function tagsIn(tasks: Rolled[]): { tag: string; n: number }[] {
  const n = new Map<string, number>();
  for (const t of flatten(tasks)) for (const tag of t.tags) n.set(tag, (n.get(tag) ?? 0) + 1);
  return [...n].map(([tag, count]) => ({ tag, n: count }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

/** The files the work in flight touches, for the overview. */
export function activeFiles(tasks: Rolled[]): string[] {
  const out: string[] = [];
  for (const t of flatten(tasks)) {
    if (t.done || (t.state !== 'doing' && t.state !== 'review' && t.state !== 'testing')) continue;
    for (const f of t.files) if (!out.includes(f)) out.push(f);
  }
  return out;
}
