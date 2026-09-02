/**
 * Knowing what is half-typed at a shell prompt, so it can be finished.
 *
 * ## Why not read the screen
 *
 * The obvious way to find the current input line is to read it out of the
 * terminal buffer at the cursor row and strip the prompt. It is what most tools
 * do and it is guesswork: a prompt can be two lines, can contain a `%` in a
 * directory name, can be a git branch with a `$` in it, and every wrong guess
 * puts part of somebody's prompt into their command.
 *
 * Every keystroke already passes through this app on its way to the pty, so it
 * is cheaper and exact to *count* what was typed. `typed` folds keystrokes into
 * the line they are building.
 *
 * ## Being sure, or saying nothing
 *
 * Counting keystrokes drifts the moment something else edits the line: the up
 * arrow recalls history, Tab runs the shell's own completion, Ctrl-R searches.
 * None of that comes back through here, so after any of it what we think is on
 * the line and what is on the line are different strings.
 *
 * So the state carries `sure`, and anything unaccounted for clears it until the
 * next Enter. A suggestion list that is sometimes about a different command is
 * worse than no suggestion list, because it is one somebody presses Tab on.
 */

export interface Typed {
  /** What is believed to be on the input line. */
  line: string;
  /** False once something happened that cannot be accounted for. */
  sure: boolean;
}

export const NOTHING: Typed = { line: '', sure: true };

/** A fresh line: Enter was pressed, or the shell was interrupted. */
const fresh = (): Typed => ({ line: '', sure: true });

/**
 * Fold one chunk of keystrokes into the line they are building.
 *
 * Handles what a person does at a prompt without leaving this app's knowledge:
 * typing, backspace, Ctrl-U, Ctrl-W, Ctrl-C and Enter. Everything else — every
 * escape sequence, Tab, and every other control character — gives up rather
 * than guessing.
 */
export function typed(state: Typed, data: string): Typed {
  let out = state;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];

    // Enter. The line is gone to the shell and the next one starts clean,
    // which is also the only thing that restores certainty.
    if (c === '\r' || c === '\n') { out = fresh(); continue; }

    // An escape sequence: arrows, Home, a bracketed paste, a mouse report.
    // Everything after it on this chunk is unaccounted for too.
    if (c === '\x1b') { return { line: '', sure: false }; }

    // Tab is the shell's own completion, which changes the line where this
    // cannot see it.
    if (c === '\t') { return { line: out.line, sure: false }; }

    if (c === '\x7f' || c === '\b') {
      out = { ...out, line: out.line.slice(0, -1) };
      continue;
    }
    // Ctrl-C, Ctrl-D on an empty line, Ctrl-G: the line is abandoned.
    if (c === '\x03' || c === '\x07') { out = fresh(); continue; }
    // Ctrl-U clears it; Ctrl-W takes a word.
    if (c === '\x15') { out = { ...out, line: '' }; continue; }
    if (c === '\x17') {
      out = { ...out, line: out.line.replace(/\S*\s*$/, '') };
      continue;
    }
    // Any other control character is something this does not model.
    if (c < ' ') { return { line: out.line, sure: false }; }

    out = { ...out, line: out.line + c };
  }
  return out;
}

/**
 * The fragment being completed, and how many characters of it there are.
 *
 * Splits on unquoted whitespace, because a path with a space in it is one
 * argument and completing from the middle of it would offer nonsense. A line
 * ending in a space is a new, empty fragment — which is right: at that point
 * everything in the directory is a candidate.
 */
export function fragment(line: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { out += line[++i]; continue; }
    if (quote) {
      if (c === quote) quote = '';
      else out += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === ' ' || c === '\t') { out = ''; continue; }
    out += c;
  }
  return out;
}

/**
 * What to offer: a program, or a path.
 *
 * The first word of a command is a program; everything after it is an argument
 * and almost always a path. A word straight after `|`, `&&`, `;` or `(` starts
 * a new command, which is the case a simpler rule gets wrong — and getting it
 * wrong means offering filenames where only programs can go.
 */
export function kindOf(line: string): 'command' | 'path' {
  // Everything up to the fragment being typed.
  const before = line.slice(0, line.length - fragment(line).length);
  const last = before.replace(/\s+$/, '');
  if (!last) return 'command';
  return /[|;&(]$/.test(last) ? 'command' : 'path';
}

/**
 * Order candidates the way a shell would.
 *
 * Prefix first, and an exactly-cased prefix before a differently-cased one:
 * this completes a shell, and a shell completes prefixes. Fuzzy matching is
 * right for a file palette, where you know the name and not the path, and wrong
 * here, where the characters already typed are literally the start of the
 * answer.
 *
 * A word that is already a whole candidate is dropped — offering `ls` when `ls`
 * is typed is a suggestion to press Tab and change nothing.
 */
export function rank(candidates: readonly string[], frag: string, limit = 8): string[] {
  const seen = new Set<string>();
  const exact: string[] = [];
  const loose: string[] = [];
  const inside: string[] = [];
  const low = frag.toLowerCase();

  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (c === frag) continue;
    if (!frag) { exact.push(c); continue; }
    if (c.startsWith(frag)) exact.push(c);
    else if (c.toLowerCase().startsWith(low)) loose.push(c);
    else if (c.toLowerCase().includes(low)) inside.push(c);
  }
  return [...exact, ...loose, ...inside].slice(0, limit);
}

/**
 * The keystrokes that turn the typed fragment into the chosen candidate.
 *
 * Backspaces then the whole word, rather than appending the remainder. A
 * case-insensitive match makes the remainder wrong — typing `app` and choosing
 * `App.js` would append `.js` and leave `app.js`, which is a different file, or
 * no file. Deleting what is there and typing the answer cannot be wrong.
 *
 * `\x7f` rather than `\b`, because that is what a terminal sends for backspace
 * and what every shell has its key bindings pointed at.
 */
export function keystrokes(frag: string, choice: string): string {
  return '\x7f'.repeat(frag.length) + choice;
}

/** Whether a list is worth putting on screen at all. */
export function worth(state: Typed, matches: readonly string[]): boolean {
  return state.sure && matches.length > 0 && state.line.trim().length > 0;
}
