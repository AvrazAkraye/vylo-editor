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
 * process. What it *can* do is offer a step to be run, and that is why Q3 puts
 * a command step through the same approval dialog as anything the model
 * proposes — see `kindOf` below.
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
 * backticks because it is code. A convention somebody else's renderer already
 * understands beats one this app invented.
 *
 * ## Editing is line-level, and that is the whole design
 *
 * The file belongs to a person. It will have headings in it, blank lines,
 * paragraphs of context between groups, and indentation nobody here chose.
 * So this does not parse a document into a model and render it back — it finds
 * the one line to change and changes that line, leaving every other byte where
 * it was. `toggle` on a file with no steps returns the same string it was
 * given, and `parse` → `serialise` on any input is the input.
 */

/** What a step does when somebody sends it. */
export type Kind = 'prose' | 'command';

export interface Step {
  /** Index into the file's lines. The address of the thing to rewrite. */
  line: number;
  done: boolean;
  /** The step as written, with the backticks still on a command. */
  raw: string;
  /** What to send: the text, unwrapped if it was a command. */
  text: string;
  kind: Kind;
  /** Leading whitespace, so a nested step stays nested. */
  indent: string;
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

/**
 * Every step in the file, addressed by line.
 *
 * Lines that are not steps are not returned and not touched — headings, notes,
 * blank lines and anything else a person put there are none of this module's
 * business.
 */
export function parse(text: string): Step[] {
  const out: Step[] = [];
  text.split('\n').forEach((line, i) => {
    const m = STEP.exec(line);
    if (!m) return;
    const raw = m[4];
    out.push({
      line: i,
      done: m[3] !== ' ',
      raw,
      text: payload(raw),
      kind: kindOf(raw),
      indent: m[1],
    });
  });
  return out;
}

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
 * Tick or untick one step.
 *
 * The box is written lowercase whichever case it had. `- [X]` is legal markdown
 * and rare; normalising it is a one-character diff on a line somebody was
 * editing anyway, and the alternative is carrying the original case through a
 * toggle that has no memory of it.
 */
export function toggle(text: string, line: number): string {
  return rewrite(text, line, (m) => `${m[1]}${m[2]} [${m[3] === ' ' ? 'x' : ' '}] ${m[4]}`);
}

/** Change one step's words, keeping its marker, its indent and its state. */
export function edit(text: string, line: number, next: string): string {
  const clean = next.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return text;
  return rewrite(text, line, (m) => `${m[1]}${m[2]} [${m[3]}] ${clean}`);
}

/** Remove one step's line entirely. */
export function remove(text: string, line: number): string {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length || !STEP.test(lines[line])) return text;
  lines.splice(line, 1);
  return lines.join('\n');
}

/**
 * Add a step at the end.
 *
 * After the last existing step rather than at the end of the file, so a note or
 * a closing paragraph someone wrote under the list stays under it. A file with
 * no steps at all gets one appended, with a blank line before it when there is
 * something to separate it from.
 */
export function add(text: string, step: string): string {
  const clean = step.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return text;
  const lines = text.split('\n');
  const steps = parse(text);
  const line = `- [ ] ${clean}`;

  if (steps.length) {
    const last = steps[steps.length - 1];
    lines.splice(last.line + 1, 0, `${last.indent}${line}`);
    return lines.join('\n');
  }
  const body = text.replace(/\s+$/, '');
  return body ? `${body}\n\n${line}\n` : `${line}\n`;
}

/** What a project gets when it has never had one. */
export const STARTER = `# To do

- [ ] Describe the next change in a sentence
- [ ] \`npm test\`
`;

/** How many are done, and of how many. */
export function progress(steps: Step[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}
