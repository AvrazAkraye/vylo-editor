/**
 * A to-do list that lives in the project, at `.vylo/TODO.md`.
 *
 * Markdown, in the same checklist form this project's own backlog uses — so it
 * is readable on GitHub, editable in any editor, diffable in a review, and it
 * arrives with a clone. The alternative was app data, which would have made it
 * invisible to everyone but the person who wrote it and to every tool that
 * already understands a checklist.
 *
 * It sits beside `.vylo/mcp.json` but does **not** inherit that file's rule
 * about untrusted input: a to-do list is data, and nothing here can start a
 * process. What it *can* do is offer a step to be run, and that is why a
 * command step goes through the same approval dialog as anything the model
 * proposes — see `kindOf` below.
 *
 * ## The plan is a plain file, and the metadata is on the line
 *
 * A checklist answers *is it done*. A plan has to answer what is being worked
 * on, what is next, what is blocked, how much is left, and how much of it is
 * finished — and none of that fits in a checkbox.
 *
 * The tempting fix is a sidecar: `.vylo/todo.json` beside the markdown, holding
 * the real model. It was rejected. Two files describing the same list disagree
 * the first time somebody edits the markdown in another editor, and the one
 * they can read is the one that loses. Worse, the whole reason this is a
 * markdown file — reviewable, diffable, readable by anyone with a clone — dies
 * the moment the truth moves into a blob nobody reads in a pull request.
 *
 * So the metadata goes where the task is, as trailing tokens, the way Todoist
 * and TickTick have written tasks for a decade:
 *
 *     - [ ] Implement chat history !high @doing %45 ~40m #ai +src/chat.ts >Login API
 *
 * | token       | means            | values                                      |
 * |-------------|------------------|---------------------------------------------|
 * | `!high`     | priority         | critical, high, medium, low, maybe          |
 * | `@doing`    | status           | planning, doing, review, testing, blocked, deferred |
 * | `%45`       | progress         | 0–100                                       |
 * | `~40m`      | estimate         | `90`, `40m`, `2h`, `1h30m`, `3d` (a day is 8h) |
 * | `#ai`       | tag or category  | any word                                    |
 * | `+src/a.ts` | a file it touches| a path                                      |
 * | `>Login API`| depends on       | another task's title, or the start of it    |
 * | `^today`    | due              | today, tomorrow, or `2026-09-05`            |
 *
 * Every one is optional, order does not matter, and a line with none of them is
 * exactly the line this module has always parsed. A person who never learns the
 * grammar has lost nothing; a person who learns half of it gets half the value.
 *
 * On GitHub the tokens render as the words they are, which is the point: the
 * file degrades to a readable sentence rather than to noise.
 *
 * ## The kind is carried by markdown that already exists
 *
 * A step written entirely inside backticks is a command; anything else is
 * prose.
 *
 *     - [ ] Rename the parser        → prose, goes to the composer
 *     - [ ] `npm test`               → a command, goes to the approval gate
 *
 * No new syntax, correct on GitHub either way, and honest: code goes in
 * backticks because it is code. Tokens are read *outside* code spans only, so
 * `` `git log --oneline | head` `` keeps its pipe and `` `awk '$1 > 2'` `` is
 * not read as a dependency.
 *
 * ## Editing is line-level, and that is still the whole design
 *
 * The file belongs to a person. It will have headings in it, blank lines,
 * paragraphs of context between groups, and indentation nobody here chose.
 * So this does not parse a document into a model and render it back — it finds
 * the one line to change and changes that line, leaving every other byte where
 * it was. Setting a priority on a task rewrites one line; `parse` of a file
 * with no steps returns nothing and touches nothing.
 *
 * ## What is deliberately not here
 *
 * A per-task activity log with timestamps, threaded comments, and attachments
 * do not fit on a line and would need the sidecar this design rejected. The
 * honest substitute already exists and is better: the file is in git, so who
 * changed a task, when, and to what is `git log -p .vylo/TODO.md` — a real
 * history rather than one this app maintains and can lose.
 */

/** What a step does when somebody sends it. */
export type Kind = 'prose' | 'command';

/**
 * Where a task is, beyond done and not done.
 *
 * `todo` is the absence of a status rather than a value anybody types — a plan
 * where every untouched task must be labelled "not started" is a plan nobody
 * keeps up to date.
 */
export type Status =
  | 'todo' | 'planning' | 'doing' | 'review' | 'testing' | 'blocked' | 'deferred' | 'done';

export const STATUSES: Status[] = [
  'todo', 'planning', 'doing', 'review', 'testing', 'blocked', 'deferred', 'done',
];

/** The statuses somebody can choose. `todo` is the empty one; `done` is the box. */
export const PICKABLE: Status[] = ['planning', 'doing', 'review', 'testing', 'blocked', 'deferred'];

export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'maybe';

export const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low', 'maybe'];

/**
 * Ranks for sorting. Lower sorts first.
 *
 * The gap at 3 is where a task with no priority sits — below medium, because
 * nobody has claimed it matters, and above low, because somebody who wrote
 * `!low` was saying something weaker than saying nothing.
 */
export const RANK: Record<Priority, number> = {
  critical: 0, high: 1, medium: 2, low: 4, maybe: 5,
};

/** What a task with no priority sorts as. The gap in `RANK`. */
export const UNRANKED = 3;

export interface Task {
  /** Index into the file's lines. The address of the thing to rewrite. */
  line: number;
  done: boolean;
  /** Leading whitespace, so a nested step stays nested. */
  indent: string;
  /** Nesting level, counted in the file's own indent steps. */
  depth: number;
  /** The step as written, tokens and all. */
  raw: string;
  /** The words, with every token taken out. What to show and what to send. */
  title: string;
  /** The title unwrapped if it was a command — what actually gets sent. */
  text: string;
  kind: Kind;
  /** What was written with `@`, or `done` for a ticked box. `todo` if neither. */
  status: Status;
  priority: Priority | null;
  /** What `%` said, if anything. Not the rolled-up figure — see `roll`. */
  progress: number | null;
  /** Minutes, from `~`. */
  estimate: number | null;
  tags: string[];
  files: string[];
  /** Titles, or the starts of titles, this task waits for. */
  needs: string[];
  /** `today`, `tomorrow`, or `YYYY-MM-DD`, as written. */
  due: string | null;
  /** The nearest markdown heading above. A milestone, in the spec's language. */
  section: string;
  /** Indented prose written under the task, joined with newlines. */
  note: string;
}

/**
 * `- [ ] text`, `* [x] text`, `+ [X] text`, at any indent.
 *
 * `\r?$` because this file lives in a repository. A clone on Windows, or an
 * editor set to CRLF, gives every line a trailing carriage return — and `.`
 * does not match one, so without this the pattern fails on the whole file and
 * a real to-do list parses as having no steps at all.
 */
const STEP = /^(\s*)([-*+])\s+\[([ xX])\]\s?(.*?)\r?$/;

/** `# A heading`, at any level. Becomes the section every task below it is in. */
const HEADING = /^(#{1,6})\s+(.*?)\r?$/;

/**
 * A step whose text is one backtick run and nothing else.
 *
 * Deliberately strict. "run `npm test` first" is prose *about* a command and
 * sending it to a shell would be sending a sentence; only a step that is
 * nothing but the command is one.
 */
const ONLY_CODE = /^`([^`]+)`$/;

export function kindOf(text: string): Kind {
  return ONLY_CODE.test(text.trim()) ? 'command' : 'prose';
}

/** The text to send: a command without its backticks, prose as written. */
export function payload(text: string): string {
  const m = ONLY_CODE.exec(text.trim());
  return m ? m[1] : text.trim();
}

// ── The token grammar ──────────────────────────────────────────────────────

/**
 * The line with every code span blanked to spaces of the same length.
 *
 * Tokens are read from this and cut from the original by index, so a `>` or a
 * `#` inside backticks is invisible to the grammar while staying in the title.
 * Blanking rather than deleting keeps every index the same in both strings,
 * which is the only reason the two can be used together at all.
 */
function mask(raw: string): string {
  return raw.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
}

/**
 * Each token: how to find it, and how to read what it found.
 *
 * `(^|\s)` on every one of them, so a token has to start a word. Without it
 * `C++` ends in a file token and `Grade A#1` carries a tag.
 */
const TOKEN = {
  priority: /(^|\s)!(critical|high|medium|med|low|maybe|nice)\b/gi,
  status: /(^|\s)@(todo|planning|doing|progress|review|reviewing|testing|blocked|deferred|done)\b/gi,
  progress: /(^|\s)%(100|\d{1,2})(?!\S)/g,
  estimate: /(^|\s)~((?:\d+(?:\.\d+)?[dhm])+|\d+(?:\.\d+)?)(?!\S)/gi,
  tag: /(^|\s)#([\w-]+)/g,
  file: /(^|\s)\+(\S+)/g,
  due: /(^|\s)\^(today|tomorrow|\d{4}-\d{2}-\d{2})\b/gi,
  /**
   * A dependency runs to the next token or the end of the line, because the
   * thing it names is a task title and titles have spaces in them. The
   * lookahead is what stops `>Login API !high` swallowing the priority.
   */
  depends: /(^|\s)>\s*(\S[^\n]*?)(?=\s+[!@%~^#+>]\S|\s*$)/g,
} as const;

type TokenName = keyof typeof TOKEN;

interface Found { name: TokenName; value: string; from: number; to: number }

/** Every token on the line, in the order they appear, with where they are. */
function tokens(raw: string): Found[] {
  const m = mask(raw);
  const out: Found[] = [];
  for (const name of Object.keys(TOKEN) as TokenName[]) {
    const re = new RegExp(TOKEN[name].source, TOKEN[name].flags);
    let hit: RegExpExecArray | null;
    while ((hit = re.exec(m))) {
      // `hit[1]` is the required space before the sigil, and it belongs to the
      // gap rather than to the token — cutting it too is what stops a removed
      // token leaving a double space behind.
      out.push({ name, value: hit[2], from: hit.index, to: hit.index + hit[0].length });
      if (re.lastIndex === hit.index) re.lastIndex++;   // a zero-width match would spin
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Minutes from `40m`, `2h`, `1h30m`, `3d`, or a bare number. */
export function minutes(estimate: string): number | null {
  const s = estimate.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s));
  const parts = s.match(/\d+(?:\.\d+)?[dhm]/g);
  if (!parts) return null;
  // A day is eight hours, not twenty-four. Nobody estimating a task in days
  // means calendar days, and a bar that thinks three days of work is 72 hours
  // will say the project finishes on a date nobody believes.
  const per: Record<string, number> = { d: 480, h: 60, m: 1 };
  let total = 0;
  for (const p of parts) total += Number(p.slice(0, -1)) * per[p.slice(-1)];
  return Math.round(total) || null;
}

/** `40m` → `40m`, `95` → `1h 35m`, for anywhere a duration is shown. */
export function duration(mins: number | null | undefined): string {
  if (!mins || mins < 0) return '';
  const d = Math.floor(mins / 480);
  const h = Math.floor((mins - d * 480) / 60);
  const m = Math.round(mins - d * 480 - h * 60);
  return [d && `${d}d`, h && `${h}h`, m && `${m}m`].filter(Boolean).join(' ') || '0m';
}

const PRIORITY_ALIAS: Record<string, Priority> = {
  critical: 'critical', high: 'high', medium: 'medium', med: 'medium',
  low: 'low', maybe: 'maybe', nice: 'maybe',
};

const STATUS_ALIAS: Record<string, Status> = {
  todo: 'todo', planning: 'planning', doing: 'doing', progress: 'doing',
  review: 'review', reviewing: 'review', testing: 'testing',
  blocked: 'blocked', deferred: 'deferred', done: 'done',
};

/** Everything a line says about itself, and the words that are left over. */
function read(raw: string, done: boolean) {
  const found = tokens(raw);
  const meta = {
    status: (done ? 'done' : 'todo') as Status,
    priority: null as Priority | null,
    progress: null as number | null,
    estimate: null as number | null,
    tags: [] as string[],
    files: [] as string[],
    needs: [] as string[],
    due: null as string | null,
  };

  for (const f of found) {
    const v = f.value.toLowerCase();
    switch (f.name) {
      // First wins throughout: a line with two priorities on it is a line
      // somebody edited by hand, and reading the first keeps it stable while
      // they fix it rather than flipping on every reparse.
      case 'priority': meta.priority ??= PRIORITY_ALIAS[v] ?? null; break;
      // The box outranks the word. `- [x] … @doing` is a task that was ticked
      // and whose status token was never cleaned up, and the tick is the thing
      // a person actually did.
      case 'status': if (!done && meta.status === 'todo') meta.status = STATUS_ALIAS[v] ?? 'todo'; break;
      case 'progress': meta.progress ??= Math.min(100, Math.max(0, Number(f.value))); break;
      case 'estimate': meta.estimate ??= minutes(f.value); break;
      case 'due': meta.due ??= v; break;
      case 'tag': if (!meta.tags.includes(v)) meta.tags.push(v); break;
      case 'file': if (!meta.files.includes(f.value)) meta.files.push(f.value); break;
      case 'depends': { const d = f.value.trim(); if (d && !meta.needs.includes(d)) meta.needs.push(d); break; }
    }
  }

  // Cut the tokens back to front so the earlier offsets stay right.
  let title = raw;
  for (const f of [...found].reverse()) title = title.slice(0, f.from) + title.slice(f.to);
  return { meta, title: title.replace(/\s+/g, ' ').trim() };
}

// ── Reading the file ───────────────────────────────────────────────────────

/**
 * Every task in the file, addressed by line.
 *
 * Lines that are not tasks are not returned and not touched — headings become
 * the `section` of everything below them, indented prose becomes the `note` of
 * the task above, and anything else a person put there is none of this
 * module's business.
 *
 * `depth` is counted in the file's *own* indent step rather than in spaces, so
 * a list written with two spaces and a list written with four both nest one
 * level at a time. The step is the smallest indent any nested task uses, which
 * is the only definition that does not need a setting.
 */
export function parse(text: string): Task[] {
  const lines = text.split('\n');
  const rows: { i: number; m: RegExpExecArray }[] = [];
  const heads = new Map<number, string>();

  lines.forEach((line, i) => {
    const s = STEP.exec(line);
    if (s) { rows.push({ i, m: s }); return; }
    const h = HEADING.exec(line);
    if (h) heads.set(i, h[2].trim());
  });

  // The indent step: the smallest non-zero indent in the list. A file that
  // never nests has no step and every task is at depth 0.
  const widths = rows.map((r) => r.m[1].replace(/\t/g, '  ').length).filter((w) => w > 0);
  const step = widths.length ? Math.min(...widths) : 0;

  let section = '';
  let head = 0;
  const out: Task[] = [];

  for (const { i, m } of rows) {
    while (head <= i) { const h = heads.get(head); if (h !== undefined) section = h; head++; }

    const done = m[3] !== ' ';
    const raw = m[4];
    const { meta, title } = read(raw, done);
    const width = m[1].replace(/\t/g, '  ').length;

    out.push({
      line: i,
      done,
      indent: m[1],
      depth: step ? Math.round(width / step) : 0,
      raw,
      title,
      text: payload(title),
      kind: kindOf(title),
      note: noteUnder(lines, i, width),
      section,
      ...meta,
    });
  }
  return out;
}

/**
 * The prose written under a task, indented past it.
 *
 * Stops at the next task, at a heading, and at anything dedented back to the
 * list — so a paragraph between two groups belongs to neither. A blank line
 * does not end a note, because a note with a paragraph break in it is still one
 * note.
 */
function noteUnder(lines: string[], from: number, width: number): string {
  const out: string[] = [];
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) { if (out.length) out.push(''); continue; }
    if (STEP.test(lines[i]) || HEADING.test(lines[i])) break;
    const indent = (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '  ').length;
    if (indent <= width) break;
    out.push(line.trim());
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join('\n');
}

// ── The tree, and what rolls up it ─────────────────────────────────────────

export interface Rolled extends Task {
  children: Rolled[];
  /** 0–100. Explicit if given, otherwise the mean of the children, else 0/100. */
  percent: number;
  /** Minutes of work still to do, this task and everything under it. */
  left: number;
  /** Titles of unfinished tasks this one waits for. Empty when nothing blocks it. */
  waiting: string[];
  /** `status`, except that an unmet dependency makes it `blocked`. */
  state: Status;
}

/** Nest by depth. A task deeper than the one before it is its child. */
export function tree(tasks: Task[]): Rolled[] {
  const roots: Rolled[] = [];
  const stack: Rolled[] = [];
  for (const task of tasks) {
    const node: Rolled = { ...task, children: [], percent: 0, left: 0, waiting: [], state: task.status };
    while (stack.length && stack[stack.length - 1].depth >= node.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

/**
 * Fill in `percent`, `left`, `waiting` and `state` over a whole tree.
 *
 * Children are averaged with equal weight rather than weighted by estimate.
 * Weighting reads as more correct and is worse in practice: most tasks have no
 * estimate, so a weighted mean would be dominated by whichever two subtasks
 * somebody happened to estimate, and the bar would lurch when a third was
 * added. Equal weight is wrong in a way that is at least steady and obvious.
 *
 * `left` sums the *leaves*, never a parent's own estimate on top of its
 * children's — a parent estimated at 2h with subtasks adding to 3h is somebody
 * whose estimate went stale, and counting both says 5h, which is true of
 * nothing.
 */
export function roll(nodes: Rolled[], all: Task[] = flatten(nodes)): Rolled[] {
  const done = all.filter((t) => t.done).map((t) => t.title.toLowerCase());

  const walk = (n: Rolled): Rolled => {
    n.children = n.children.map(walk);

    n.percent = n.done ? 100
      : n.progress !== null ? n.progress
      : n.children.length
        ? Math.round(n.children.reduce((a, c) => a + c.percent, 0) / n.children.length)
        : 0;

    const own = n.estimate !== null && !n.done && n.state !== 'deferred'
      ? Math.round(n.estimate * (1 - n.percent / 100)) : 0;
    const kids = n.children.reduce((a, c) => a + c.left, 0);
    n.left = n.children.length ? kids : own;

    // A dependency names a task by its title, or by the start of one — so
    // `>Login` finds "Login API" and somebody does not have to retype a title
    // to point at it.
    n.waiting = n.done ? [] : n.needs.filter((need) => {
      const want = need.toLowerCase();
      return !done.some((d) => d === want || d.startsWith(want));
    });
    if (n.waiting.length) n.state = 'blocked';
    return n;
  };
  return nodes.map(walk);
}

/** Every node of a tree, parents before children. */
export function flatten(nodes: Rolled[]): Rolled[] {
  const out: Rolled[] = [];
  const walk = (n: Rolled) => { out.push(n); n.children.forEach(walk); };
  nodes.forEach(walk);
  return out;
}

/** Parse, nest and roll up in one call. What every caller actually wants. */
export function plan(text: string): Rolled[] {
  const tasks = parse(text);
  return roll(tree(tasks), tasks);
}

export interface Summary {
  done: number;
  total: number;
  /** 0–100, over the top-level tasks, so a task with six subtasks is one task. */
  percent: number;
  /** Minutes of work left. */
  left: number;
  status: Status;
  /** The section the first unfinished task is in. */
  phase: string;
  /** The highest priority still outstanding. */
  priority: Priority | null;
  blocked: number;
}

/**
 * The figures at the top of the panel.
 *
 * `percent` is the mean over *top-level* tasks rather than over every task in
 * the file, so a milestone broken into eight subtasks does not outvote seven
 * that nobody has broken down yet. `done`/`total` counts leaves, because that
 * is the number somebody means by "how many things are left".
 */
export function summarise(nodes: Rolled[]): Summary {
  const all = flatten(nodes);
  const leaves = all.filter((t) => !t.children.length);
  const open = all.filter((t) => !t.done);

  const percent = nodes.length
    ? Math.round(nodes.reduce((a, n) => a + n.percent, 0) / nodes.length) : 0;

  const blocked = open.filter((t) => t.state === 'blocked').length;
  const active = open.some((t) => t.state === 'doing' || t.state === 'review' || t.state === 'testing');

  const status: Status =
    !all.length ? 'todo'
    : !open.length ? 'done'
    : blocked && !active ? 'blocked'
    : active ? 'doing'
    : open.some((t) => t.state === 'planning') ? 'planning'
    : 'todo';

  const ranked = open
    .map((t) => t.priority)
    .filter((p): p is Priority => p !== null)
    .sort((a, b) => RANK[a] - RANK[b]);

  return {
    done: leaves.filter((t) => t.done).length,
    total: leaves.length,
    percent,
    left: nodes.reduce((a, n) => a + n.left, 0),
    status,
    // The phase is where the work is: the section of the first task that is
    // actually moving, or failing that the first unfinished one.
    phase: (open.find((t) => t.state === 'doing') ?? open[0])?.section ?? '',
    priority: ranked[0] ?? null,
    blocked,
  };
}

// ── Changing one line ──────────────────────────────────────────────────────

/** Rewrite one line, leaving every other byte where it was. */
function rewrite(text: string, line: number, make: (m: RegExpExecArray) => string): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length) return text;
  const m = STEP.exec(lines[line]);
  if (!m) return text;
  // The carriage return is part of the line as far as `split` is concerned, and
  // dropping it would convert one line of a CRLF file to LF and leave the rest
  // — which shows up as a one-line diff on a file nobody meant to reformat.
  const eol = lines[line].endsWith('\r') ? '\r' : '';
  lines[line] = make(m) + eol;
  return lines.join('\n');
}

/**
 * Put a token on a line, replace the one that is there, or take it away.
 *
 * Replaced **in place** rather than removed and appended, so setting a priority
 * does not shuffle the rest of the line and turn a one-word change into a diff
 * that looks like a rewrite. Any duplicates after the first are dropped, which
 * is the only chance this has to tidy a line somebody hand-edited twice.
 */
function put(raw: string, name: TokenName, value: string): string {
  const found = tokens(raw).filter((f) => f.name === name);
  const sigil = { priority: '!', status: '@', progress: '%', estimate: '~', tag: '#', file: '+', due: '^', depends: '>' }[name];
  const token = value ? `${sigil}${value}` : '';

  let out = raw;
  // Back to front, so every offset still points where it did.
  for (let i = found.length - 1; i >= 0; i--) {
    const f = found[i];
    const keep = i === 0 && token ? ` ${token}` : '';
    out = out.slice(0, f.from) + keep + out.slice(f.to);
  }
  if (!found.length && token) out = `${out.replace(/\s+$/, '')} ${token}`;
  return out.replace(/\s+/g, ' ').trim();
}

/** Change one token on one task. The single door every setter goes through. */
function setToken(text: string, line: number, name: TokenName, value: string): string {
  return rewrite(text, line, (m) => `${m[1]}${m[2]} [${m[3]}] ${put(m[4], name, value)}`);
}

/**
 * Tick or untick one task.
 *
 * The box is written lowercase whichever case it had. `- [X]` is legal markdown
 * and rare; normalising it is a one-character diff on a line somebody was
 * editing anyway, and the alternative is carrying the original case through a
 * toggle that has no memory of it.
 *
 * Ticking clears `@status` and `%progress`: a task that is done is not also
 * "in progress, 45%", and leaving those behind is how a list starts lying.
 * Unticking leaves the box empty rather than guessing what it was before.
 */
export function toggle(text: string, line: number): string {
  return rewrite(text, line, (m) => {
    const next = m[3] === ' ' ? 'x' : ' ';
    const body = next === 'x' ? put(put(m[4], 'status', ''), 'progress', '') : m[4];
    return `${m[1]}${m[2]} [${next}] ${body}`;
  });
}

/**
 * Move a task to a status.
 *
 * `todo` clears the token. `done` ticks the box instead of writing a word,
 * because there is already one true place a task records being finished and a
 * second would be free to disagree with it.
 */
export function setStatus(text: string, line: number, status: Status): string {
  const task = parse(text).find((s) => s.line === line);
  if (!task) return text;
  if (status === 'done') return task.done ? text : toggle(text, line);
  const un = task.done ? toggle(text, line) : text;
  return setToken(un, line, 'status', status === 'todo' ? '' : status);
}

/** Set or clear a priority. */
export function setPriority(text: string, line: number, priority: Priority | null): string {
  return setToken(text, line, 'priority', priority ?? '');
}

/**
 * Set or clear progress.
 *
 * 100 ticks the box rather than writing `%100`, for the same reason `setStatus`
 * does — and because a task at 100% that is not done is a thing somebody has to
 * come back and tick, which is exactly the paperwork a to-do list is for
 * avoiding. 0 clears the token instead of writing a zero nobody needs to read.
 */
export function setProgress(text: string, line: number, percent: number | null): string {
  const n = percent === null ? null : Math.min(100, Math.max(0, Math.round(percent)));
  if (n === 100) {
    const task = parse(text).find((s) => s.line === line);
    return task && !task.done ? toggle(text, line) : text;
  }
  return setToken(text, line, 'progress', n ? String(n) : '');
}

/** Set or clear the estimate. Takes minutes and writes them readably. */
export function setEstimate(text: string, line: number, mins: number | null): string {
  return setToken(text, line, 'estimate', mins && mins > 0 ? duration(mins).replace(/\s+/g, '') : '');
}

/** Set or clear the due date: `today`, `tomorrow`, or `YYYY-MM-DD`. */
export function setDue(text: string, line: number, due: string | null): string {
  return setToken(text, line, 'due', due ?? '');
}

/**
 * Add a tag, or take it off if it is already there.
 *
 * Tags are the one token a task can have several of, so this appends rather
 * than replacing — `put` is for the single-valued ones.
 */
export function toggleTag(text: string, line: number, tag: string): string {
  const clean = tag.trim().toLowerCase().replace(/^#/, '').replace(/[^\w-]/g, '');
  if (!clean) return text;
  return rewrite(text, line, (m) => {
    const found = tokens(m[4]).filter((f) => f.name === 'tag' && f.value.toLowerCase() === clean);
    let body = m[4];
    if (found.length) {
      for (let i = found.length - 1; i >= 0; i--) body = body.slice(0, found[i].from) + body.slice(found[i].to);
      body = body.replace(/\s+/g, ' ').trim();
    } else {
      body = `${body.replace(/\s+$/, '')} #${clean}`.trim();
    }
    return `${m[1]}${m[2]} [${m[3]}] ${body}`;
  });
}

/**
 * Change one task's words, keeping every token, its box, and its indent.
 *
 * The tokens are re-appended rather than left in place, because the new title
 * is a different string and the old offsets mean nothing in it. Their order is
 * preserved, so a line does not get reshuffled by a rename.
 */
export function edit(text: string, line: number, next: string): string {
  const clean = next.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return text;
  return rewrite(text, line, (m) => {
    const keep = tokens(m[4]).map((f) => m[4].slice(f.from, f.to).trim()).filter(Boolean);
    const body = [clean, ...keep].join(' ').replace(/\s+/g, ' ').trim();
    return `${m[1]}${m[2]} [${m[3]}] ${body}`;
  });
}

/** Remove one task's line, and every subtask under it. */
export function remove(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || !STEP.test(lines[line])) return text;
  const tasks = parse(text);
  const at = tasks.findIndex((t) => t.line === line);
  // A subtask whose parent is gone is an orphan indented under nothing, which
  // reads as a task of the group above and is worse than either outcome the
  // person was choosing between.
  let last = line;
  for (let i = at + 1; i < tasks.length && tasks[i].depth > tasks[at].depth; i++) last = tasks[i].line;
  lines.splice(line, last - line + 1);
  return lines.join('\n');
}

/**
 * Add a task at the end, or under a parent.
 *
 * After the last existing task rather than at the end of the file, so a note or
 * a closing paragraph someone wrote under the list stays under it. A file with
 * no tasks at all gets one appended, with a blank line before it when there is
 * something to separate it from.
 *
 * With `under`, it lands after that task's existing subtasks and one level in —
 * so adding three subtasks in a row gives three siblings rather than a ladder.
 */
export function add(text: string, step: string, under?: number): string {
  const clean = step.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return text;
  const lines = text.split('\n');
  const tasks = parse(text);
  const body = `- [ ] ${clean}`;

  const parent = under === undefined ? undefined : tasks.find((t) => t.line === under);
  if (parent) {
    let at = parent.line;
    for (let i = tasks.indexOf(parent) + 1; i < tasks.length && tasks[i].depth > parent.depth; i++) at = tasks[i].line;
    const kid = tasks.find((t) => t.depth > parent.depth && t.line > parent.line);
    lines.splice(at + 1, 0, `${kid ? kid.indent : `${parent.indent}  `}${body}`);
    return lines.join('\n');
  }

  if (tasks.length) {
    const last = tasks[tasks.length - 1];
    // At the top level, not at the last task's depth — a new task typed into
    // the box at the bottom of the list is a new task, not a subtask of
    // whatever happened to be last.
    const top = [...tasks].reverse().find((t) => t.depth === 0);
    lines.splice(last.line + 1, 0, `${top ? top.indent : ''}${body}`);
    return lines.join('\n');
  }
  const head = text.replace(/\s+$/, '');
  return head ? `${head}\n\n${body}\n` : `${body}\n`;
}

/** Move a task, and everything under it, to just after another one. */
export function move(text: string, line: number, after: number): string {
  if (line === after) return text;
  const lines = text.split('\n');
  const tasks = parse(text);
  const from = tasks.findIndex((t) => t.line === line);
  const to = tasks.findIndex((t) => t.line === after);
  if (from < 0 || to < 0) return text;

  let last = line;
  for (let i = from + 1; i < tasks.length && tasks[i].depth > tasks[from].depth; i++) last = tasks[i].line;
  // Dropping a task inside its own subtree would delete it: the block it is
  // being spliced into is the block being cut out.
  if (after >= line && after <= last) return text;

  const block = lines.slice(line, last + 1);
  const rest = [...lines.slice(0, line), ...lines.slice(last + 1)];
  const target = rest.indexOf(lines[after]);
  if (target < 0) return text;
  rest.splice(target + 1, 0, ...block);
  return rest.join('\n');
}

/** What a project gets when it has never had one. */
export const STARTER = `# To do

- [ ] Describe the next change in a sentence !high ~30m #frontend
  - [ ] A subtask, indented under it
- [ ] \`npm test\` ~5m
`;

/** How many are done, and of how many. */
export function progress(tasks: { done: boolean }[]): { done: number; total: number } {
  return { done: tasks.filter((s) => s.done).length, total: tasks.length };
}
