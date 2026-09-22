/**
 * What a terminal session looks like in the list beside it.
 *
 * The panel used to put its tabs in a strip across the top, which works for two
 * and stops working at five: the names truncate to "Termi…", a command pane's
 * whole identity is the command it is running, and there is nowhere to say
 * whether it is still going. A vertical list has room for a second line.
 *
 * ## Why the title is sometimes monospace
 *
 * A pane is one of two things. Either it is a shell someone opened, whose name
 * is a number, or it is one approved command, whose name *is* that command.
 * Setting the second in the same face as the first makes a command look like a
 * label; setting it in the mono face says "this is a string that ran". The
 * distinction is the useful thing on the row, so it is carried by the type
 * rather than by a badge nobody reads.
 *
 * ## Why the second line is not the path
 *
 * Every pane in this panel is opened in the workspace root, so a path would be
 * the same eleven times and tell you nothing about which row you want. What
 * actually differs is how long it has been there and whether it is still
 * running, so that is what the line says.
 */

import { fill } from './i18n';

export type State =
  /** A shell, still running. */
  | 'live'
  /** An approved command, still running. */
  | 'busy'
  /** Finished, and the exit code said so. */
  | 'ok'
  /** Finished badly, or was killed. */
  | 'failed';

export interface Session {
  /**
   * A name somebody typed, which wins over both defaults.
   *
   * Kept separate from the command rather than replacing it: a renamed command
   * pane is still running that command, and losing the string would leave the
   * one place it was visible showing a label instead. `titleOf` prefers this;
   * the command is still there for search to match on.
   */
  name?: string;

  /**
   * A colour, by name. In memory only, and deliberately: a session is a running
   * shell and does not outlive the app, so persisting a colour would be keeping
   * a label for a process that has gone.
   */
  tag?: string;
  id: string;
  /** 1-based, in the order panes were opened. Not an index into anything. */
  n: number;
  born: number;
  dead: boolean;
  /** Set when this pane exists to run one approved command. */
  command?: string;
  /** The exit code, once there is one. `null` means killed by a signal. */
  code?: number | null;
}

export function stateOf(s: Session): State {
  if (!s.dead) return s.command ? 'busy' : 'live';
  // A signal (null) is not a clean finish. Neither is any non-zero code, and
  // treating "no code recorded" as success would report a crash as a tick.
  return s.code === 0 ? 'ok' : 'failed';
}

/** The row's title, and whether it is a string that ran rather than a name. */
export function titleOf(s: Session, term = 'Terminal'): { text: string; mono: boolean } {
  // A typed name is prose whatever the pane is running: somebody who calls a
  // pane "build watcher" wants those words, not a monospaced string that ran.
  const named = (s.name ?? '').trim();
  if (named) return { text: named, mono: false };
  return s.command
    ? { text: s.command, mono: true }
    : { text: `${term} ${s.n}`, mono: false };
}

/**
 * How long ago, in the shortest form that is still true.
 *
 * Seconds up to a minute, then minutes, then hours. Deliberately coarse: this
 * sits under a title at eleven pixels and the difference between 41 and 44
 * minutes has never changed anybody's mind about which terminal to click.
 *
 * `t` is required for `ago()`'s reason one file over: `s`, `m`, `h` and `d` are
 * English abbreviations, they render beside a state word that *is* translated,
 * and an optional translator is one the next call site forgets. The unit is
 * carried by the whole key rather than concatenated onto the number, so a
 * language that writes it the other way round can.
 */
export function since(born: number, now: number, t: (s: string) => string): string {
  const s = Math.max(0, Math.floor((now - born) / 1000));
  if (s < 60) return fill(t('{n}s'), { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return fill(t('{n}m'), { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? fill(t('{n}h'), { n: h }) : fill(t('{n}d'), { n: Math.floor(h / 24) });
}

/**
 * Does this session match what was typed?
 *
 * Substring, case-folded, over the title and the command — not the fuzzy
 * matcher `⌘P` uses, and that is on purpose. A terminal list is short and its
 * names are mostly numbers, so subsequence matching would rank `Terminal 1`
 * against `t1` and `npm test` equally and feel arbitrary. An empty query keeps
 * everything, because a filter that hides on first paint looks broken.
 */
export function matches(s: Session, query: string, term = 'Terminal'): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { text } = titleOf(s, term);
  // The name it *would* have had is searched too, so `Terminal 3` still finds a
  // shell somebody has since renamed — the number is how people refer to a pane
  // out loud long after the label changed.
  //
  // It is the default, not the number: a command pane was never called
  // `Terminal 3`, and a first attempt that searched the number unconditionally
  // made every command pane match it.
  const fallback = s.command ? s.command : `${term} ${s.n}`;
  return text.toLowerCase().includes(q)
    || (s.command ?? '').toLowerCase().includes(q)
    || fallback.toLowerCase().includes(q);
}

// Generic in the row type rather than taking `Session`: the panel's rows carry
// fields of their own — which group they are in, which folder they opened in —
// and a filter that returned the base type would quietly strip them.
export function filter<T extends Session>(list: T[], query: string, term = 'Terminal'): T[] {
  const q = query.trim();
  // The same array, not a copy of it: an empty query is not a change, and
  // handing back a new array makes every memo downstream recompute on every
  // keystroke that clears the box.
  if (!q) return list;
  return list.filter((s) => matches(s, q, term));
}

/**
 * A path short enough for a strip under a terminal.
 *
 * The home directory becomes `~`, as every shell prompt writes it. Beyond that
 * the *front* is dropped rather than the back: a path is read from the right —
 * the folder you are in is the last segment, and the ones before it matter less
 * the further away they are. Truncating the end would leave `/Users/you/wo…`,
 * which answers a question nobody asked.
 */
export function shorten(path: string, home = '', keep = 3): string {
  let p = (path ?? '').trim();
  if (!p) return '';
  if (home && (p === home || p.startsWith(`${home}/`))) {
    p = `~${p.slice(home.length)}`;
  }
  const bits = p.split('/');
  // A leading empty from an absolute path is not a segment.
  const lead = bits[0] === '' ? '/' : '';
  const parts = bits.filter(Boolean);
  if (parts.length <= keep) return lead ? `/${parts.join('/')}` : parts.join('/');
  return `…/${parts.slice(-keep).join('/')}`;
}


// ── What a row in the session list says ───────────────────────────────────
//
// A list of six shells titled "Terminal 1" through "Terminal 6" tells you
// nothing you did not already know. What tells them apart is the last thing
// each one ran, the folder it is in, or the branch it is on — and which of
// those matters depends on the person and the day. So the row is configurable
// rather than argued about.

/** What the first line of a row shows. */
/**
 * What a row calls itself when nobody has named it.
 *
 * `running` is first and is the default: it is the one that answers "which of
 * these fourteen is the one I want" without being configured, and it is read
 * from the operating system rather than inferred. It falls through to the
 * others whenever the shell is simply waiting, because a column of `zsh` is
 * the problem, not the answer.
 */
export type TitleAs = 'running' | 'command' | 'cwd' | 'branch';

/** How much room a row takes. */
export type Density = 'comfortable' | 'compact';

/**
 * How the sessions are laid out.
 *
 * `panes` is the list down the side with any of them side by side, which is
 * what this panel has always done and what makes two shells watchable at once.
 * `tabs` is one strip across the top and one shell under it, which is what
 * every other terminal does and what somebody who keeps six shells and looks
 * at one of them wants — the list is a column of furniture they are paying for
 * and not using.
 *
 * It is a view, not a mode: the sessions, their scrollback and their processes
 * are the same either way, and switching is a decision about the furniture
 * rather than about the work.
 */
export type LayoutAs = 'panes' | 'tabs';

export interface RowView {
  titleAs: TitleAs;
  /** Which extras appear on the second line. */
  meta: { branch: boolean; cwd: boolean; state: boolean };
  density: Density;
  as: LayoutAs;
}

export const ROW_VIEW: RowView = {
  // What is running, because it is the one that is true *now* — the last
  // command is what was true when it was typed, and a pane that finished a
  // build an hour ago still calls itself the build. A folder and a branch are
  // usually the same across every pane open, and a title that reads the same
  // on six rows is the problem this solves. It falls through to the command
  // whenever the shell is simply waiting.
  titleAs: 'running',
  meta: { branch: true, cwd: false, state: true },
  density: 'comfortable',
  // Panes, because that is what this panel was built to do and what somebody
  // who has never opened the menu is already using. Tabs is the other answer,
  // one toggle away.
  as: 'panes',
};

export const ROW_VIEW_KEY = 'vylo.rowview.v1';

/** Read the stored view, repairing anything untrustworthy. */
export function readView(raw: string | null): RowView {
  const out: RowView = { ...ROW_VIEW, meta: { ...ROW_VIEW.meta } };
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return out;
    const r = v as Record<string, unknown>;
    if (r.titleAs === 'running' || r.titleAs === 'command' || r.titleAs === 'cwd' || r.titleAs === 'branch') out.titleAs = r.titleAs;
    if (r.density === 'compact' || r.density === 'comfortable') out.density = r.density;
    if (r.as === 'panes' || r.as === 'tabs') out.as = r.as;
    const m = (r.meta ?? {}) as Record<string, unknown>;
    for (const k of ['branch', 'cwd', 'state'] as const) {
      if (typeof m[k] === 'boolean') out.meta[k] = m[k] as boolean;
    }
  } catch {
    // A view is a convenience. A bad one is the default arrangement.
  }
  return out;
}

export const writeView = (v: RowView): string => JSON.stringify(v);

/** What is known about a session beyond the session itself. */
export interface Facts {
  /** Where the shell is now. */
  cwd?: string;
  /** The branch of that directory, empty when it is not a repository. */
  branch?: string;
  /** The last command sent in this pane. */
  last?: string;
  /**
   * What the *operating system* says is in this terminal's foreground right
   * now: `claude`, `vim`, `node`, or the shell's own name when nothing is
   * running. Empty where the platform cannot say.
   *
   * The only one of these that is a fact rather than a guess, and the only one
   * that goes back to being a shell when a program exits.
   */
  running?: string;
  /** The title the terminal itself is showing, from `OSC 0`/`OSC 2`. */
  title?: string;
}

/**
 * Shells. When one of these is in the foreground, nothing is running.
 *
 * Worth a list rather than a comparison against the pane's own shell, because
 * nothing here knows what that is — and because the answer is the same for a
 * shell somebody started inside another one.
 *
 * `zsh` on fourteen rows is the problem the mark exists to solve, not a
 * solution to it.
 */
const SHELLS = new Set([
  'zsh', 'bash', 'sh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'nu', 'tcsh',
  'csh', 'elvish', 'xonsh', 'pwsh', 'powershell', 'cmd',
  'pwsh.exe', 'powershell.exe', 'cmd.exe',
]);

/** A name that could be a program, as against a sentence a shell set as a title. */
const PLAIN = /^[a-z0-9][a-z0-9._+-]{0,23}$/i;

/**
 * What is running in the pane, or `''` when it is the shell waiting.
 *
 * The operating system first, because it is the only source that is right in
 * both directions — it says `claude` while Claude is running and `zsh` the
 * moment it exits.
 *
 * The terminal's own title is the fallback, and only when it looks like a bare
 * program name. Shells overwhelmingly set the title to the directory or to
 * `user@host: ~/somewhere`, and a row that showed that would be repeating the
 * line underneath it. This is what Windows has instead of a foreground process
 * group, so it is not dead code.
 */
export function runningOf(facts: Pick<Facts, 'running' | 'title'>): string {
  const fg = (facts.running ?? '').trim().toLowerCase();
  if (fg) return SHELLS.has(fg) ? '' : fg;
  const said = (facts.title ?? '').trim();
  if (!PLAIN.test(said)) return '';
  const low = said.toLowerCase();
  return SHELLS.has(low) ? '' : low;
}

/**
 * The mark a row draws: a terminal, or the thing running inside it.
 *
 * One extra value so far. It is a list rather than a boolean because the next
 * one is a matter of adding a line, and a `claude?: boolean` on the row would
 * have to become this anyway.
 */
export type Mark = 'terminal' | 'claude';

/**
 * The program a command line actually runs, lowercased and without its path.
 *
 * Three things get in the way of the first word being the answer:
 *
 *   `cd x && claude`     a chain. The **last** segment is what is running by
 *                        the time anybody looks at the row — and for a pipe
 *                        it is the far end, which is the same rule.
 *   `FOO=bar claude`     environment assignments, which come before the
 *                        program and are not it.
 *   `npx claude`         a launcher. `sudo`, `time`, `env`, `npx` and friends
 *                        all take the real program as their first argument.
 *
 * Quotes are stripped from the result but not parsed: this decides which
 * picture to draw, and a shell grammar in here to get an icon right would be
 * a shell grammar to maintain.
 */
export function programOf(line: string): string {
  const src = typeof line === 'string' ? line : '';
  // The last segment of a chain or a pipeline. `&&`, `||`, `;` and `|` all
  // mean "and then", as far as "what is running now" is concerned.
  const tail = src.split(/\|\||&&|[;|]/).pop() ?? '';
  let words = tail.trim().split(/\s+/).filter(Boolean);
  // Assignments first, then anything that launches something else. Bounded,
  // because `sudo sudo sudo` should not be a loop.
  for (let i = 0; i < 4 && words.length; i++) {
    const head = words[0];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head) || WRAPPERS.has(head.toLowerCase())) {
      words = words.slice(1);
      continue;
    }
    break;
  }
  const first = (words[0] ?? '').replace(/^["']|["']$/g, '');
  const base = first.split(/[\\/]/).pop() ?? '';
  return base.toLowerCase();
}

/** Programs that run another program, and are never the answer themselves. */
const WRAPPERS = new Set([
  'sudo', 'doas', 'env', 'time', 'nohup', 'nice', 'command', 'exec',
  'npx', 'bunx', 'pnpx', 'yarn', 'dlx',
]);

/** What `claude` is called when it is on the path. */
const CLAUDE = new Set(['claude', 'claude-code']);

/**
 * What to draw beside a session.
 *
 * A pane that has just run `claude` is not a terminal any more in the only
 * sense that matters to somebody scanning a list of fourteen of them — it is
 * the Claude one. So the row says so.
 *
 * Read from the last command rather than from the process table, because
 * there is no process table here: the panel knows what was typed into each
 * pane and nothing else. That makes it honest but not live — the mark stays
 * until something else is run, which is the same rule the row's own title has
 * followed since it started showing the last command.
 *
 * A dead session is a terminal again whatever it was running, because what it
 * was running has exited.
 */
export function markOf(s: Session, facts: Pick<Facts, 'last' | 'running' | 'title'>): Mark {
  if (s.dead) return 'terminal';
  // The operating system, when it answered. Authoritative in **both**
  // directions: `claude` means the mark, and `zsh` means no mark, without
  // consulting anything else. That is the whole difference between this and
  // what it replaced — reading the last command typed was right until Claude
  // exited, after which the row went on claiming it for ever.
  const fg = (facts.running ?? '').trim().toLowerCase();
  if (fg) return CLAUDE.has(fg) ? 'claude' : 'terminal';

  // Nothing from the platform — Windows, or a terminal that has only just
  // opened. What is left are guesses, and they are not equal.
  //
  // A command pane exists to run one thing and that thing is known exactly,
  // so nothing else about the pane may overrule it. A pane told to run
  // `npm test` is npm even if the word claude is somewhere in its history.
  const only = (s.command ?? '').trim();
  if (only) return CLAUDE.has(programOf(only)) ? 'claude' : 'terminal';

  // An ordinary shell pane has two, and either saying yes is enough: a title
  // is sometimes the program naming itself, and the last line typed is what
  // this used to rely on alone. Both are asked, because a title of `~/work`
  // says nothing and must not stop the other being read.
  const guesses = [facts.title ?? '', facts.last ?? ''];
  return guesses.map(programOf).some((p) => CLAUDE.has(p)) ? 'claude' : 'terminal';
}

export interface Row {
  title: string;
  /** True when the title is a string that ran, rather than a phrase. */
  mono: boolean;
  /** The second line, already in the order it should read. */
  subs: { text: string; kind: 'state' | 'branch' | 'cwd' | 'age' }[];
}

/**
 * One row, for the chosen view.
 *
 * Every title choice falls back through the others rather than showing an
 * empty row: a pane that has run nothing has no last command, a pane outside a
 * repository has no branch, and a row with no title is a row you cannot click
 * on purpose. A typed name still wins over all of it — somebody who renamed a
 * pane meant those words.
 */
export function rowOf(
  s: Session, facts: Facts, view: RowView, opts: { term?: string; home?: string; now?: number; t?: (x: string) => string } = {},
): Row {
  const term = opts.term ?? 'Terminal';
  const t = opts.t ?? ((x: string) => x);

  const named = (s.name ?? '').trim();
  const last = (facts.last ?? '').trim();
  const cwd = (facts.cwd ?? '').trim();
  const branch = (facts.branch ?? '').trim();
  const running = runningOf(facts);

  let title = named;
  let mono = false;
  if (!title) {
    // The chosen one first, then whatever else this pane actually has.
    const wants: TitleAs[] = view.titleAs === 'command' ? ['command', 'running', 'cwd', 'branch']
      : view.titleAs === 'cwd' ? ['cwd', 'running', 'command', 'branch']
      : view.titleAs === 'branch' ? ['branch', 'cwd', 'running', 'command']
      : ['running', 'command', 'cwd', 'branch'];
    for (const want of wants) {
      // Monospaced, because it is a string that ran rather than a phrase —
      // the same rule `titleOf` follows for a command.
      if (want === 'running' && running) { title = running; mono = true; break; }
      if (want === 'command' && (s.command || last)) {
        title = s.command || last; mono = true; break;
      }
      if (want === 'cwd' && cwd) { title = lastSegment(cwd, opts.home); mono = false; break; }
      if (want === 'branch' && branch) { title = branch; mono = false; break; }
    }
  }
  if (!title) { title = `${term} ${s.n}`; mono = false; }

  const subs: Row['subs'] = [];
  if (view.meta.state) {
    const state = stateOf(s);
    subs.push({
      kind: 'state',
      text: state === 'busy' ? t('running') : state === 'live' ? t('shell')
        : state === 'ok' ? t('finished')
        : s.code === null ? t('stopped') : `${t('exit')} ${s.code}`,
    });
  }
  // Not repeated as metadata when it is already the title.
  if (view.meta.branch && branch && !(title === branch && !named)) {
    subs.push({ kind: 'branch', text: branch });
  }
  if (view.meta.cwd && cwd) subs.push({ kind: 'cwd', text: shorten(cwd, opts.home, 2) });
  if (opts.now !== undefined) subs.push({ kind: 'age', text: since(s.born, opts.now, t) });
  return { title, mono, subs };
}

/** The folder's own name, which is what a person calls the directory they are in. */
function lastSegment(path: string, home = ''): string {
  if (home && path === home) return '~';
  const bits = path.split('/').filter(Boolean);
  return bits[bits.length - 1] || path;
}
