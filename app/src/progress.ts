/**
 * What the agent is actually doing, while it is doing it.
 *
 * A turn used to show one line — a dot and the word "working…" — for anything
 * between a two-second answer and a two-minute one that read nine files and ran
 * the tests. That word is the same whether the model is writing, whether a
 * command is running, whether a request is being sent for the third time after
 * two failures, or whether the loop is sitting still waiting for the person to
 * approve something. Four very different situations, one label, and the only
 * one that needs the person to *do* something looks exactly like the three that
 * do not.
 *
 * So the loop reports where it is, and this turns that into a sentence and a
 * handful of figures. It is a reducer over events rather than a pile of state
 * in the component, because "what is it doing" is derived from a sequence and
 * the interesting cases are all orderings — a retry mid-stream, a tool that
 * asks a question, a hop that produces no text at all.
 *
 * Nothing here talks to anything. It takes events and returns a value.
 */

export type Phase =
  /** Nothing is running. */
  | 'idle'
  /** The request is out and nothing has come back. */
  | 'thinking'
  /** The reply is arriving. */
  | 'writing'
  /** A tool is running. */
  | 'tool'
  /**
   * Stopped, waiting for the person.
   *
   * The one phase that is not the app being slow, and the reason this module
   * exists: it is indistinguishable from `tool` unless the loop says so, and it
   * is the only one where staring at the screen does not help.
   */
  | 'waiting'
  /** A request failed and is being sent again. */
  | 'retrying'
  /** History is being dropped to fit the context window. */
  | 'compacting';

export interface Progress {
  phase: Phase;
  /** The tool being run, for `tool` and `waiting`. */
  tool: string;
  /** The part of a tool's input worth reading: a path, a command, a query. */
  detail: string;
  /** Model round-trips so far, counting from one. */
  hop: number;
  maxHops: number;
  /** When the turn started, as `Date.now()`. */
  since: number;
  /** Which attempt, while retrying. */
  attempt: number;
  attempts: number;
  /** Characters of reply written so far. */
  written: number;
  /** Tool calls finished this turn. */
  ran: number;
}

export const IDLE: Progress = {
  phase: 'idle', tool: '', detail: '', hop: 0, maxHops: 0,
  since: 0, attempt: 0, attempts: 0, written: 0, ran: 0,
};

export type Event =
  | { kind: 'start'; at: number; maxHops: number }
  | { kind: 'hop'; hop: number }
  | { kind: 'delta'; chars: number }
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'result' }
  /** A tool has stopped to ask the person something. */
  | { kind: 'ask' }
  | { kind: 'answered' }
  | { kind: 'retry'; attempt: number; attempts: number }
  | { kind: 'compact' }
  | { kind: 'stop' };

/**
 * The next state.
 *
 * Every event after `stop` is ignored, because a turn that has ended must not
 * be brought back to life by a late callback — an aborted request can still
 * deliver one, and a spinner that reappears after the reply is finished is a
 * bug somebody reports as "it never stops working".
 */
export function advance(p: Progress, e: Event): Progress {
  if (e.kind === 'start') {
    return { ...IDLE, phase: 'thinking', since: e.at, maxHops: e.maxHops, hop: 1 };
  }
  if (p.phase === 'idle') return p;

  switch (e.kind) {
    // A new hop is the model thinking again, whatever the last one ended as.
    case 'hop':
      return { ...p, phase: 'thinking', hop: e.hop, tool: '', detail: '', attempt: 0 };
    case 'delta':
      return { ...p, phase: 'writing', written: p.written + e.chars, attempt: 0 };
    case 'tool':
      return { ...p, phase: 'tool', tool: e.name, detail: detailOf(e.name, e.input), attempt: 0 };
    // Back to thinking rather than to writing: the loop's next act is another
    // request, and a hop with only tool calls never writes anything.
    case 'result':
      return { ...p, phase: 'thinking', tool: '', detail: '', ran: p.ran + 1 };
    case 'ask':
      return { ...p, phase: 'waiting' };
    case 'answered':
      return p.phase === 'waiting' ? { ...p, phase: 'tool' } : p;
    case 'retry':
      return { ...p, phase: 'retrying', attempt: e.attempt, attempts: e.attempts };
    case 'compact':
      return { ...p, phase: 'compacting' };
    case 'stop':
      return IDLE;
    default:
      return p;
  }
}

/**
 * The readable half of a tool call.
 *
 * One field, chosen per tool, never the whole input — `edit_file` carries both
 * sides of a diff and `write_file` carries a file, and neither belongs on a
 * status line. Truncated, because a command can be a paragraph.
 */
export function detailOf(name: string, input: unknown): string {
  const o = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const got = name === 'run_command' ? pick('command')
    : name === 'search' ? pick('query', 'pattern')
    : name === 'find_symbol' ? pick('name', 'symbol')
    : name === 'remember' ? pick('fact', 'text')
    : pick('path', 'file', 'dir', 'query');
  return got.replace(/\s+/g, ' ').slice(0, 80);
}

/** The English verb for each tool. Also the `i18n.ts` key. */
const VERB: Record<string, string> = {
  list_tree: 'Listing the project',
  read_file: 'Reading',
  read_document: 'Reading',
  read_image: 'Looking at',
  find_symbol: 'Looking for',
  search: 'Searching for',
  write_file: 'Staging a change to',
  edit_file: 'Staging a change to',
  run_command: 'Running',
  remember: 'Writing to project memory',
};

/** Tools whose verb reads as a whole sentence, with nothing to append. */
const WHOLE = new Set(['list_tree', 'remember']);

export interface Line {
  /** The i18n key. */
  text: string;
  /** Appended after it, untranslated — a path or a command. */
  detail: string;
  /** Set in the mono face, because it is a string not a phrase. */
  mono: boolean;
}

/**
 * The one line shown beside the dot.
 *
 * The tool's own name is the fallback rather than a generic "running a tool":
 * an MCP server's tool has no entry here, and its name is more use than a word
 * that says nothing.
 */
export function line(p: Progress): Line {
  switch (p.phase) {
    case 'idle':
      return { text: '', detail: '', mono: false };
    case 'writing':
      return { text: 'Writing the reply', detail: '', mono: false };
    case 'retrying':
      return { text: 'Trying again', detail: `${p.attempt}/${p.attempts}`, mono: false };
    case 'compacting':
      return { text: 'Making room in the context', detail: '', mono: false };
    case 'waiting':
      // Second person, and phrased as the thing the person has to do. Every
      // other line here describes the machine.
      return { text: 'Waiting for you', detail: '', mono: false };
    case 'tool': {
      const verb = VERB[p.tool];
      if (!verb) return { text: '', detail: p.tool, mono: true };
      if (WHOLE.has(p.tool)) return { text: verb, detail: '', mono: false };
      return { text: verb, detail: p.detail, mono: p.tool === 'run_command' };
    }
    default:
      return { text: 'Thinking', detail: '', mono: false };
  }
}

/**
 * How long, in the shortest form that is still exact enough to be worth
 * reading. Seconds under a minute, then minutes and seconds.
 */
export function elapsed(since: number, now: number): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

/**
 * Whether the turn has gone on long enough to be worth explaining.
 *
 * Under this, the detail is noise: a turn that answers in two seconds does not
 * need a panel saying which round-trip it was on. It only governs whether the
 * *hint* to click is shown — the panel itself opens whenever it is asked for.
 */
export const WORTH_EXPLAINING = 4000;

export const isSlow = (p: Progress, now: number): boolean =>
  p.phase !== 'idle' && now - p.since >= WORTH_EXPLAINING;
