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
 */
export function since(born: number, now: number): string {
  const s = Math.max(0, Math.floor((now - born) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
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
  return text.toLowerCase().includes(q) || (s.command ?? '').toLowerCase().includes(q);
}

export function filter(list: Session[], query: string, term = 'Terminal'): Session[] {
  const q = query.trim();
  if (!q) return list;
  return list.filter((s) => matches(s, q, term));
}
