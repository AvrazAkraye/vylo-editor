/**
 * Asking for a shell command in words.
 *
 * The one thing a terminal like Warp has that this did not: you know what you
 * want and not what it is called. `tar` with the right four flags, the `find`
 * incantation that excludes `node_modules`, the `git` command that undoes the
 * thing you just did.
 *
 * ## Why this needs no new trust
 *
 * A model producing a command string is exactly what `run_command` already
 * does, and the rule the app rests on does not care who *asked* for it:
 *
 *   > No model output reaches disk or a shell without a human having read and
 *   > approved that exact content or string.
 *
 * So the answer does not go into the terminal, and it does not get its own
 * confirmation either. It is handed to `askToRun` — the same gate, the same
 * dialog, the same string on screen, the same "Always allow this" — as a
 * command the agent proposed mid-turn. There is one gate implementation and
 * this adds nothing to it.
 *
 * Two consequences worth stating. Asking is *cheaper* than the agent loop and
 * not a weaker version of it: one request, no tools, nothing read from the
 * project it was not given. And a second confirmation dialog before the first
 * would be theatre, which is why there is not one.
 *
 * ## The `#` reply
 *
 * A request that has no answer as a command — "why did that fail", "what is
 * this repository" — is answered with a line beginning `#`.
 *
 * That is chosen rather than JSON or a header because of what it is when it
 * goes wrong: `#` starts a comment in every shell this app runs. If the
 * protocol were ever misread and a note reached a prompt, it would do nothing.
 * A failure mode that is inert by construction beats one that is merely
 * checked for.
 */

/** Lines of terminal output sent as context. Enough for an error and its cause. */
export const CONTEXT_LINES = 40;

/** Beyond this a reply is not a command somebody asked for. */
export const MAX_COMMAND_LINES = 8;
export const MAX_COMMAND_CHARS = 1000;

export const SYSTEM = [
  'You turn a request into ONE shell command for the user to run.',
  '',
  'Reply with the command and nothing else: no explanation, no commentary, no',
  'markdown fences, no leading $ or prompt. The reply is put in front of the',
  'user to approve and then run verbatim, so anything that is not the command',
  'is something they have to delete by hand.',
  '',
  'If the request cannot be answered with a single command — it is a question,',
  'or it needs to know something you were not told — reply with one line',
  'beginning with "# " saying so in a sentence. Do not guess a command.',
  '',
  'Prefer the plain, obvious form over the clever one. Use the shell and the',
  'tools named below and no others; do not assume anything is installed. Never',
  'reply with a command that deletes, force-pushes, or rewrites history unless',
  'the request asked for exactly that.',
].join('\n');

export interface Ask {
  /** What the person typed. */
  question: string;
  /** OS, shell and project facts, as `environment.ts` builds them. */
  environment?: string;
  /** The directory the terminal is in. */
  cwd?: string;
  /** The tail of what is on the terminal, for "why did that fail". */
  output?: string;
}

/**
 * The user message.
 *
 * The output goes *last*, after the question, because that is the order the
 * model reads in and the question is what the answer has to be about — an
 * error above a question reads as "explain this", which is a different request
 * from the one that was made.
 */
export function ask(a: Ask): string {
  const parts: string[] = [];
  if (a.environment?.trim()) parts.push(a.environment.trim());
  if (a.cwd?.trim()) parts.push(`Working directory: ${a.cwd.trim()}`);
  parts.push(`Request: ${a.question.trim()}`);
  const tail = lastLines(a.output ?? '', CONTEXT_LINES);
  if (tail) {
    parts.push(`Recent terminal output, for context only:\n${tail}`);
  }
  return parts.join('\n\n');
}

/** The last `n` non-empty-at-the-end lines of some output. */
export function lastLines(text: string, n: number): string {
  const lines = text.replace(/\r/g, '').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.slice(Math.max(0, lines.length - n)).join('\n').trim();
}

export type Reply =
  /** A command to put in front of the person. */
  | { kind: 'command'; text: string }
  /** Something to read. Never runnable. */
  | { kind: 'note'; text: string };

const FENCE = /```[a-zA-Z]*\r?\n([\s\S]*?)```/;

/**
 * Read the model's reply.
 *
 * Fenced code wins, because a model told not to use fences occasionally uses
 * them anyway and the fence is then the most reliable signal of where the
 * command is. Everything else is taken whole rather than picked apart: a reply
 * that is prose plus a command is shown as prose plus a command, and the person
 * declines it. Fail visibly, not cleverly — a parser that hunts for the
 * "command part" of a bad answer is a parser that will one day find one in a
 * sentence.
 *
 * A reply that is too long to be a command somebody asked for becomes a note,
 * because that is what it is.
 */
export function parse(raw: string): Reply | null {
  let text = (raw ?? '').trim();
  if (!text) return null;

  const fenced = FENCE.exec(text);
  if (fenced) text = fenced[1].trim();
  // An unterminated fence — a reply cut short — still has a usable first line.
  else if (text.startsWith('```')) text = text.replace(/^```[a-zA-Z]*\r?\n?/, '').trim();

  if (!text) return null;

  // The inert failure mode. `#` starts a comment in every shell this runs.
  if (text.startsWith('#')) {
    return { kind: 'note', text: text.replace(/^#+\s?/gm, '').trim() };
  }

  // A prompt the model copied along with the command.
  text = text.replace(/^[$>]\s+/, '');

  const lines = text.split('\n');
  if (lines.length > MAX_COMMAND_LINES || text.length > MAX_COMMAND_CHARS) {
    return { kind: 'note', text };
  }
  return { kind: 'command', text };
}

/**
 * A one-line label for the approval dialog's "why".
 *
 * The person's own words, so the dialog says what they asked for beside what
 * they are being offered — which is the only way to notice an answer to a
 * different question.
 */
export function reason(question: string): string {
  const q = question.replace(/\s+/g, ' ').trim();
  return q.length > 120 ? `${q.slice(0, 119)}…` : q;
}
