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
 * Commands whose argument can only ever be a directory.
 *
 * Small and literal on purpose. Guessing from a name — anything ending in
 * `dir`, anything whose first argument "looks like" a folder — would be wrong
 * for `mkdir`, which takes a name that does *not* exist yet and for which a
 * list of existing folders is the least useful thing on offer.
 */
const DIR_ONLY = new Set(['cd', 'chdir', 'pushd', 'rmdir']);

/**
 * Whether the word being typed can only be a directory.
 *
 * `cd` with a filename is not a slip somebody wants completed for them: it is
 * an error the shell will refuse, and offering it is the completion list
 * putting a wrong answer under the cursor. The same goes for `pushd` and
 * `rmdir`. Everything else takes files, so everything else gets both.
 *
 * The governing command is the first word of the *current* simple command,
 * not of the line — `ls /tmp && cd sr` is completing for `cd`, and a rule that
 * read the first word of the line would offer files there.
 */
export function wantsDir(line: string): boolean {
  if (kindOf(line) === 'command') return false;
  const before = line.slice(0, line.length - fragment(line).length);
  const segment = before.split(/[|;&(]/).pop() ?? '';
  const first = segment.trim().split(/\s+/)[0] ?? '';
  return DIR_ONLY.has(first);
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
 * One thing that could finish the line.
 *
 * The kind is not decoration: it decides how much of the line a choice
 * replaces. A program or a path finishes the *word* being typed; a line out of
 * history replaces the *whole line*, because that is what it is — `claude` can
 * be finished into `claude --dangerously-skip-permissions` only by replacing
 * everything typed so far.
 */
export interface Suggestion {
  text: string;
  kind: 'command' | 'path' | 'history';
}

/**
 * The keystrokes that turn what is typed into the chosen suggestion.
 *
 * Backspaces then the whole thing, rather than appending the remainder. A
 * case-insensitive match makes the remainder wrong — typing `app` and choosing
 * `App.js` would append `.js` and leave `app.js`, which is a different file, or
 * no file. Deleting what is there and typing the answer cannot be wrong.
 *
 * How much is deleted is the kind's business: a word for a program or a path,
 * the entire line for a line out of history.
 *
 * `\x7f` rather than `\b`, because that is what a terminal sends for backspace
 * and what every shell has its key bindings pointed at.
 */
export function keystrokes(state: Typed, choice: Suggestion): string {
  const eaten = choice.kind === 'history' ? state.line.length : fragment(state.line).length;
  return '\x7f'.repeat(eaten) + choice.text;
}

/**
 * The line as it would read if this choice were taken.
 *
 * Deliberately written as the same arithmetic as `keystrokes`, from the same
 * `eaten`: the dim text shown ahead of the cursor and the keystrokes sent to
 * the pty must describe one action, and the way they stop describing one is by
 * being worked out twice. `suggest.test.mjs` checks they agree by applying the
 * keystrokes and comparing.
 */
export function preview(line: string, choice: Suggestion): string {
  const eaten = choice.kind === 'history' ? line.length : fragment(line).length;
  return line.slice(0, line.length - eaten) + choice.text;
}

/**
 * Everything that could finish the line, best first.
 *
 * History leads. A line you actually ran is a better guess than a program that
 * merely exists — you have typed `claude --dangerously-skip-permissions`
 * before, so `claude` most likely means that again, and the twenty other
 * binaries on `PATH` beginning with the same letters do not.
 *
 * Only the first word gets history, and only against the whole line: offering
 * a past command while somebody is halfway through typing a *path* would
 * replace the argument they are writing with a command they ran yesterday.
 */
export function suggest(
  line: string,
  sources: { history?: readonly string[]; commands?: readonly string[]; paths?: readonly string[] },
  limit = 8,
): Suggestion[] {
  const frag = fragment(line);
  const typed = line.trimStart();
  // Nothing typed, nothing to finish. Without this an empty line ranks with an
  // empty fragment, which matches every binary on PATH — a list of two
  // thousand programs offered to somebody who has pressed no keys.
  if (!typed) return [];
  const out: Suggestion[] = [];

  if (kindOf(line) === 'command' && typed) {
    // Most recent first, and never the line already typed.
    const past = [...(sources.history ?? [])].reverse()
      .filter((h) => h !== typed && h.startsWith(typed));
    for (const text of past) {
      if (!out.some((x) => x.text === text)) out.push({ text, kind: 'history' });
    }
  }

  const kind = kindOf(line) === 'command' ? 'command' : 'path';
  const words = kind === 'command' ? (sources.commands ?? []) : (sources.paths ?? []);
  for (const text of rank(words, frag, limit)) {
    if (!out.some((x) => x.kind === 'history' && x.text === text)) out.push({ text, kind });
  }
  return out.slice(0, limit);
}

/** What the person has already typed of a suggestion, for the bold prefix. */
export function typedPart(line: string, choice: Suggestion): number {
  return choice.kind === 'history' ? line.trimStart().length : fragment(line).length;
}

/** Whether a list is worth putting on screen at all. */
export function worth(state: Typed, matches: readonly unknown[]): boolean {
  return state.sure && matches.length > 0 && state.line.trim().length > 0;
}

/**
 * Add a line to this terminal's history.
 *
 * Kept in memory for the session only. A shell has its own history file and
 * this is not it — writing to `~/.zsh_history` from here would be an app
 * editing a file the shell owns and rewrites on exit.
 *
 * Most recent last, deduplicated so a command run ten times appears once, and
 * capped: a suggestion list reads the tail, and an unbounded array in a
 * terminal somebody leaves open for a week is a leak.
 */
export const HISTORY_MAX = 200;

export function remember(history: readonly string[], line: string): string[] {
  const one = line.trim();
  if (!one) return [...history];
  const out = history.filter((h) => h !== one);
  out.push(one);
  return out.length > HISTORY_MAX ? out.slice(out.length - HISTORY_MAX) : out;
}

/**
 * A path, as it should be typed at a prompt.
 *
 * Single quotes, because inside them a shell expands nothing at all — no `$`,
 * no backtick, no `*`, no `~`. A dropped file is a name from the filesystem
 * and somebody else chose it: a folder called `$(whoami)` is a perfectly legal
 * folder, and pasting it unquoted at a prompt is a command waiting for an
 * Enter that the person will assume is theirs.
 *
 * The one character a single-quoted string cannot contain is a single quote,
 * so each one closes the string, escapes a literal quote, and opens it again —
 * the standard `'\''` dance.
 *
 * A path with nothing worth quoting is left bare, because a quoted path is
 * harder to read and to edit afterwards.
 */
export function quotePath(path: string): string {
  if (!path) return "''";
  if (/^[A-Za-z0-9_@%+=:,.\/-]+$/.test(path)) return path;
  return `'${path.split("'").join(`'\\''`)}'`;
}
