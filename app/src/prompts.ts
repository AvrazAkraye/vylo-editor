/**
 * Prompts and commands worth keeping, at `.vylo/PROMPTS.md`.
 *
 * Two things people ask for separately turn out to be one thing. Cursor calls
 * them Notepads: the paragraph you retype every time you want a security
 * review. Warp calls them Workflows: the command with the four flags you can
 * never remember. Both are "something I wrote once and want again", and the
 * only difference is where it goes when you press it — the message box, or the
 * approval dialog.
 *
 * So they live in one file, and which one it is is read from markdown that
 * already exists, exactly as `.vylo/TODO.md` does:
 *
 *     ## Review the diff for security
 *     Look at the staged changes and list anything exploitable, with the file
 *     and line. Say so plainly if there is nothing.
 *
 *     ## Run the tests
 *     `npm test`
 *
 * A heading names it. What follows is the prompt. A body that is *only* code —
 * one backtick run, or one fenced block, and nothing else — is a command, and
 * gets the approval dialog rather than the composer. The same rule the to-do
 * list uses, for the same reason: code goes in backticks because it is code,
 * and a convention somebody else's renderer already understands beats one this
 * app invented.
 *
 * The file travels with the project, is readable on GitHub, and diffs in a
 * review — which for a file full of instructions that will be handed to a
 * model is not a nicety. A prompt a teammate added is a prompt you can read
 * before you press it.
 */

export type Kind = 'prose' | 'command';

export interface Prompt {
  /** The heading. What the button says. */
  title: string;
  /** The body, unwrapped if it is a command. What gets sent. */
  body: string;
  kind: Kind;
  /** Index of the heading line, so one entry can be rewritten in place. */
  line: number;
}

/** `## Anything`, at any level. */
const HEADING = /^(#{1,6})\s+(.*?)\r?$/;

/**
 * Which heading level names a prompt.
 *
 * A person writing this file writes `# Prompts` at the top and `## Each one`
 * below, and the sentence under the title explaining the file is not a prompt.
 * But somebody else writes the whole file with `#`, and every one of those *is*
 * a prompt. Both are ordinary, so both work:
 *
 *   > The shallowest heading level is the entry level, unless there is exactly
 *   > one heading at it and deeper headings exist — then that one is the
 *   > document's title and the next level down holds the entries.
 *
 * The "exactly one" is what makes it safe. A file with three `#` headings has
 * three prompts however deep anything below them goes; only a lone top heading
 * is read as a title, because a lone top heading is what a title is.
 */
export function entryLevel(text: string): number {
  const levels: number[] = [];
  for (const line of text.split('\n')) {
    const h = HEADING.exec(line);
    if (h) levels.push(h[1].length);
  }
  if (!levels.length) return 1;
  const top = Math.min(...levels);
  const atTop = levels.filter((l) => l === top).length;
  const deeper = levels.filter((l) => l > top);
  if (atTop === 1 && deeper.length) return Math.min(...deeper);
  return top;
}

/** A body that is one fenced block and nothing else. */
const ONLY_FENCE = /^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n?```$/;

/** A body that is one backtick run and nothing else. */
const ONLY_TICKS = /^`([^`]+)`$/;

/**
 * What a body is.
 *
 * Strict, in the same way `todo.ts` is strict: "run `npm test` first" is prose
 * *about* a command, and sending it to a shell would be sending a sentence.
 * Only a body that is nothing but the code is code.
 */
export function kindOf(body: string): Kind {
  const b = body.trim();
  return ONLY_FENCE.test(b) || ONLY_TICKS.test(b) ? 'command' : 'prose';
}

/** What to send: a command without its wrapping, prose as written. */
export function payload(body: string): string {
  const b = body.trim();
  const fence = ONLY_FENCE.exec(b);
  if (fence) return fence[1].trim();
  const ticks = ONLY_TICKS.exec(b);
  return ticks ? ticks[1].trim() : b;
}

/**
 * Every prompt in the file.
 *
 * A heading with nothing under it is not a prompt — there is nothing to send —
 * and prose before the first heading belongs to nobody, which is where a person
 * would naturally write a sentence explaining the file. Both are skipped rather
 * than guessed at.
 */
export function parse(text: string): Prompt[] {
  const lines = text.split('\n');
  const level = entryLevel(text);
  const out: Prompt[] = [];
  let title = '';
  let at = -1;
  let body: string[] = [];

  const flush = () => {
    if (at < 0) return;
    const raw = body.join('\n').trim();
    if (title && raw) out.push({ title, body: payload(raw), kind: kindOf(raw), line: at });
    body = [];
  };

  lines.forEach((line, i) => {
    const h = HEADING.exec(line);
    if (h) {
      // A heading shallower than the entry level is the document's title, and
      // ends whatever entry was open. A deeper one is part of the body — a
      // prompt with sections in it is still one prompt.
      if (h[1].length <= level) {
        flush();
        if (h[1].length === level) { title = h[2].trim(); at = i; }
        else { title = ''; at = -1; }
        return;
      }
    }
    if (at >= 0) body.push(line.replace(/\r$/, ''));
  });
  flush();
  return out;
}

/**
 * Add a prompt at the end.
 *
 * A blank line before the heading whatever the file ended with, because two
 * headings with no gap render as one paragraph in some viewers and read as a
 * mistake in all of them.
 */
export function add(text: string, title: string, body: string): string {
  const t = title.replace(/[\r\n]+/g, ' ').trim();
  const b = body.replace(/\r/g, '').trim();
  if (!t || !b) return text;
  const head = text.replace(/\s+$/, '');
  const entry = `## ${t}\n\n${b}\n`;
  return head ? `${head}\n\n${entry}` : entry;
}

/**
 * Remove one prompt, heading and body.
 *
 * Runs to the next heading rather than to the next blank line, so a prompt of
 * several paragraphs goes in one piece. The blank lines that separated it go
 * with it; the ones above the next heading are put back, so removing an entry
 * from the middle does not close the gap around its neighbour.
 */
export function remove(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || !HEADING.test(lines[line])) return text;
  const level = entryLevel(text);
  let end = lines.length;
  for (let i = line + 1; i < lines.length; i++) {
    const h = HEADING.exec(lines[i]);
    // Stops at the next entry or at anything shallower, never at a heading
    // *inside* the prompt — a prompt with sections in it goes whole.
    if (h && h[1].length <= level) { end = i; break; }
  }
  const rest = [...lines.slice(0, line), ...lines.slice(end)];
  // Collapse the run of blanks the cut left behind to the one that was there.
  const out = rest.join('\n').replace(/\n{3,}/g, '\n\n');
  return out.replace(/^\n+/, '');
}

/** Filter by title and body, for the search box. */
export function filter(prompts: readonly Prompt[], query: string): Prompt[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...prompts];
  return prompts.filter((p) =>
    p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
}

/** What a project gets when it has never had one. */
export const STARTER = `# Prompts

Anything under a heading can be sent again. A body that is only code is offered
as a command and goes through the approval dialog; everything else fills the
message box for you to read before you send it.

## Review the staged changes

Read the staged diff and list anything that could go wrong: a case not handled,
a value not checked, a message that will confuse somebody. Say plainly if there
is nothing.

## Explain this file

Explain what the open file is for, what calls it, and which part of it is the
one worth understanding first.

## Run the tests

\`npm test\`
`;
