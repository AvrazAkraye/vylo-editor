/**
 * The agents running in the terminal panel, and which of them is doing what.
 *
 * Somebody running six coding agents at once has one question they ask every
 * few minutes: which of these is still going, which has finished, and which is
 * sitting on a question waiting for me. Clicking through six panes to find out
 * is the cost this module exists to remove. It is pure arithmetic over facts
 * the panel already has, so the rules can be tested without a terminal.
 *
 * ## An agent is a program, read from the operating system
 *
 * `pty_running` names the program in each terminal's foreground, and an agent
 * is one of a known list — Claude Code, Codex, Gemini CLI and the rest. A
 * terminal that is only a shell is not an agent and is not on the dashboard;
 * one that ran an agent which has since exited drops off it, because what was
 * running has stopped.
 *
 * ## Working and idle are read from output, not from the process
 *
 * A running Claude Code is the same process whether it is thinking or waiting
 * at its prompt, so the process table cannot tell the two apart. What does is
 * the screen: while an agent works it redraws its spinner many times a second,
 * and at its prompt it goes quiet. So *working* means output in the last
 * `WORKING_MS`, and *idle* means none. Output caused by the person typing —
 * the echo of their own keystrokes — is filtered out before it gets here, or
 * typing a question into an idle agent would call it working.
 *
 * ## "Needs you" is read from the words on screen
 *
 * The state that matters most is the one where the agent has stopped to ask
 * permission: nothing happens until somebody answers, and nothing on a quiet
 * pane distinguishes it from being finished. The difference is on the screen —
 * "Do you want to proceed?", a numbered choice with a cursor on it, a `(y/n)`.
 * `asks` looks for those at the bottom of a *quiet* terminal only: an agent
 * still printing is not waiting for anybody, whatever scrolled past.
 *
 * It is a pattern match and can miss a prompt nobody has written a pattern for.
 * A miss reads as idle, which is the safe mistake — the agent is shown as
 * stopped, which it is — rather than inventing a question that was never asked.
 */

/** What an agent is doing. */
export type Status = 'needs' | 'working' | 'idle';

/** Output within this long means the agent is working. */
export const WORKING_MS = 2_500;

/**
 * Programs that are agents, by the name the operating system reports, and what
 * to call each on screen.
 *
 * Both spellings where there are two: an npm install runs the package's script
 * under node, and `pty_running` reports those by package — `claude-code`,
 * `gemini-cli` — while a native install is the bare command.
 */
const AGENTS: Readonly<Record<string, string>> = {
  claude: 'Claude Code',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini CLI',
  'gemini-cli': 'Gemini CLI',
  aider: 'Aider',
  opencode: 'OpenCode',
  'opencode-ai': 'OpenCode',
  'cursor-agent': 'Cursor Agent',
  amp: 'Amp',
  goose: 'Goose',
  qwen: 'Qwen Code',
  'qwen-code': 'Qwen Code',
  crush: 'Crush',
  droid: 'Droid',
  copilot: 'Copilot CLI',
  kiro: 'Kiro',
  'kiro-cli': 'Kiro',
};

/** An agent's display name for the program in a terminal, or `null` when it is not one. */
export function agentOf(program: string): string | null {
  const p = (typeof program === 'string' ? program : '').trim().toLowerCase();
  return AGENTS[p] ?? null;
}

/**
 * The shapes an agent's question takes on screen.
 *
 * Each is something an agent prints when it has stopped for an answer:
 *
 *   Do you want to proceed?        Claude Code's permission prompt, and its
 *   Do you want to make this edit  edit and create prompts
 *   ❯ 1. Yes                       the numbered choice, cursor on the first
 *   Allow command? / Allow execution   Codex and Gemini CLI approvals
 *   (y/n)  [Y/n]  [y/N]            every other command-line confirmation
 *   Waiting for approval           what several of them print outright
 *
 * Deliberately *not* matched: a bare `❯`. It looks like the cursor of a
 * selection menu, and it is also — rendered from a real Claude Code — the
 * whole of its idle input box, alone on a line between two rules. A pattern on
 * the glyph would have turned every idle agent into one that needs you, which
 * is why these match the dialog's *words* instead.
 */
const ASKS: readonly RegExp[] = [
  // Claude Code's selection dialogs end in this footer — the trust prompt a
  // new folder opens with, and the permission prompts. Read off a real one.
  // Not "esc to interrupt", which is the line under the spinner while it works.
  /\benter to confirm\b/i,
  /\besc to cancel\b/i,
  // The trust question itself, for a screen too short to show the footer.
  /\bdo you trust\b|\bone you trust\?/i,
  /\bdo you want to\b/i,
  /❯\s*1[.)]\s*yes\b/i,
  /\ballow (this |the )?(command|execution|edit|change|tool)\b/i,
  /\bapprove (this|the)\b/i,
  /\((y\/n|yes\/no)\)|\[y\/n\]/i,
  /\bwaiting for (your )?(approval|confirmation|input)\b/i,
  /\bpress enter to (continue|confirm)\b/i,
];

/**
 * Whether the bottom of a terminal is an agent asking something.
 *
 * `screen` is the last few non-empty lines of the live screen — not up to the
 * cursor, which in a selection dialog sits *above* the words that make it a
 * question. Only those lines: an agent redraws its region once a question is
 * answered, and a prompt from an hour ago is in the scrollback, not here, which
 * is what stops one keeping a pane amber for ever.
 */
export function asks(screen: string): boolean {
  const s = typeof screen === 'string' ? screen : '';
  if (!s.trim()) return false;
  return ASKS.some((re) => re.test(s));
}

/**
 * What an agent is doing, from when it last printed and what is on screen.
 *
 * Output first: an agent still printing is working, whatever the screen says,
 * because a question it is waiting on would have stopped it printing. Only a
 * quiet terminal is read for a question.
 */
export function statusOf(o: { lastOut: number; now: number; screen: string }): Status {
  const quiet = !(o.lastOut > 0) || o.now - o.lastOut > WORKING_MS;
  if (!quiet) return 'working';
  return asks(o.screen) ? 'needs' : 'idle';
}

/**
 * What an agent was last asked to do, for the card's title.
 *
 * The last line sent to the terminal that is not the command that started the
 * agent — `claude` is how the session began, not what it is doing — and not a
 * slash command, which is a setting (`/model`, `/clear`) rather than a task.
 * Empty when nothing has been asked yet, and the card falls back to the
 * session's own name.
 *
 * This is what the app saw typed, so a question pasted as a whole block or
 * sent some way this app could not follow is not here. The fallback covers it.
 */
export function taskOf(sent: readonly string[], isAgentCommand: (line: string) => boolean): string {
  for (let i = sent.length - 1; i >= 0; i--) {
    const line = (sent[i] ?? '').trim();
    if (!line) continue;
    if (isAgentCommand(line)) return '';
    if (line.startsWith('/')) continue;
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
  }
  return '';
}

/** One agent, as the dashboard draws it. */
export interface Card {
  id: string;
  /** What it was asked to do, or the session's name. */
  title: string;
  /** "Claude Code", "Codex". */
  agent: string;
  /** The folder it is working in, shortened. */
  where: string;
  status: Status;
}

/** How many there are, in each state. */
export interface Tally {
  all: number;
  needs: number;
  working: number;
  idle: number;
}

export function tally(cards: readonly Card[]): Tally {
  const t: Tally = { all: cards.length, needs: 0, working: 0, idle: 0 };
  for (const c of cards) t[c.status] += 1;
  return t;
}

/**
 * The sections, in the order they are drawn.
 *
 * *Needs you* first, because it is the only one waiting on the person reading
 * it; then *working*; then *idle*. Within a section the cards keep the order
 * the sessions have in the list — a card that jumps position every time its
 * neighbour starts or stops is a card you have to find again.
 *
 * A section with nothing in it is left out rather than drawn as a heading over
 * nothing.
 */
export const ORDER: readonly Status[] = ['needs', 'working', 'idle'];

export function sections(cards: readonly Card[], only: Status | 'all' = 'all'): Array<{ status: Status; cards: Card[] }> {
  return ORDER
    .filter((s) => only === 'all' || only === s)
    .map((status) => ({ status, cards: cards.filter((c) => c.status === status) }))
    .filter((s) => s.cards.length > 0);
}
