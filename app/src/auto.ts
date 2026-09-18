/**
 * Approving without being asked, and the things that are never auto-approved.
 *
 * ## What this changes, and what it does not
 *
 * The app's rule is that no model output reaches disk or a shell without a
 * human having read and approved that exact content. Auto-approve is a person
 * saying, for this session, *I have decided in advance*. That is a real change
 * to the promise and `SAFETY.md` says so rather than pretending otherwise.
 *
 * What it deliberately does not change is the shape of the machinery. The model
 * gains no tool: `apply_write`, the Rust `run_command` and every `pty_*` stay
 * absent from the schema, so a model still cannot write or execute however it
 * is prompted. Everything still goes through `Pending` and `askToRun` — this
 * only answers them. Three consequences follow, and they are the reason this is
 * defensible at all:
 *
 *   - **Every write is still checkpointed.** The previous contents are kept
 *     before the new ones land, so an auto-approved change is an undoable one.
 *     Auto-approve is safe because it is *reversible*, not because it is
 *     supervised.
 *   - **Every action is still in the transcript**, marked as auto, so what
 *     happened while you were not reading is a thing you can read afterwards.
 *   - **The gate still exists**, so turning the mode off returns the app to
 *     exactly what it was, with no second code path to have drifted.
 *
 * ## The refuse-list is not a setting
 *
 * Some commands are not undoable and no checkpoint helps: they delete outside
 * the project, rewrite history somebody else has, reach the network, run as
 * another user, or say something to a person who is not in the room. Those always ask, at every level, and there is no option to
 * turn that off. A mode that can be talked into `rm -rf /` is not a mode, it is
 * a bug with a switch.
 *
 * This list is a blunt instrument and is meant to be. It matches on text, so it
 * will stop commands that were harmless; that is the right direction to be
 * wrong in, and the cost of being wrong is one dialog.
 */

export type Level =
  /** Everything asks. What the app has always done. */
  | 'off'
  /** Staged file changes apply on their own. Commands still ask. */
  | 'edits'
  /** Commands too, except the ones below. */
  | 'all';

export const LEVELS: Level[] = ['off', 'edits', 'all'];

/** English for each, and the `i18n.ts` keys. */
export const LEVEL_LABEL: Record<Level, string> = {
  off: 'Ask me every time',
  edits: 'Apply edits, ask before commands',
  all: 'Apply edits and run commands',
};

export const LEVEL_ABOUT: Record<Level, string> = {
  off: 'Every change and every command is shown to you first.',
  edits: 'File changes land without asking. You still approve every command.',
  all: 'Commands run without asking too, except ones that cannot be undone.',
};

/** One rule that forces a question, with the reason to show. */
interface Rule {
  /** Matched against the command, lowercased and with runs of space collapsed. */
  test: RegExp;
  /** The `i18n.ts` key naming what it caught. */
  why: string;
}

/**
 * Commands that always ask.
 *
 * Grouped by what makes them unrecoverable rather than by what they are:
 * something checkpoints cannot undo, something that leaves this machine,
 * something that runs as somebody else.
 */
export const RULES: readonly Rule[] = [
  // A checkpoint holds files the agent changed. It does not hold files a
  // command deleted, and it holds nothing at all outside the project.
  { test: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/, why: 'it deletes files' },
  { test: /\b(rmdir|shred|srm)\b/, why: 'it deletes files' },
  { test: /\bfind\b[^|]*-delete\b/, why: 'it deletes files' },
  { test: /\bgit\s+clean\b/, why: 'it deletes files' },
  { test: /\b(dd|mkfs|fdisk|diskutil)\b/, why: 'it writes to a disk directly' },
  { test: />\s*\/dev\//, why: 'it writes to a device' },

  // History somebody else may already have.
  { test: /\bgit\s+push\b/, why: 'it publishes to a remote' },
  { test: /\bgit\s+reset\s+--hard\b/, why: 'it discards work that is not committed' },
  { test: /\bgit\s+checkout\s+--\s/, why: 'it discards work that is not committed' },
  { test: /\bgit\s+(rebase|filter-branch|filter-repo)\b/, why: 'it rewrites history' },
  { test: /\b(npm|pnpm|yarn)\s+publish\b/, why: 'it publishes a package' },

  // A message to another human being, which is the one thing on this list that
  // is not shell-shaped. It is here rather than left to the levels because
  // `decide` is the only thing standing between auto-approve and a send, and
  // because `askToRun` consults the refuse-list before it consults "Always
  // allow this" — so one entry closes both doors at once. Without it, level
  // `all` posted WhatsApp silently: every other rule matches on `rm`, `git` or
  // `sudo`, and `WhatsApp to Rebaz` matches none of them.
  //
  // The string is the first line `whatsapptool.ts` writes for the dialog.
  // `test/whatsapptool.test.mjs` asserts the two still agree, because a rule
  // that matches a sentence another file builds is a rule that can be silently
  // unhooked by editing that sentence.
  { test: /^whatsapp to /, why: 'it sends a message to another person' },

  // Running as somebody else, or as something you have not read.
  { test: /\b(sudo|doas|su)\b/, why: 'it runs as another user' },
  { test: /\b(curl|wget|fetch)\b[^|]*\|\s*(ba|z|k|fi)?sh\b/, why: 'it runs something downloaded' },
  { test: /\bcurl\b[^|]*\|\s*python/, why: 'it runs something downloaded' },
  { test: /\b(chmod|chown)\s+(-[a-z]*r[a-z]*\s+)/, why: 'it changes permissions across a tree' },
  { test: /:\(\)\s*\{.*\}\s*;?\s*:/, why: 'it looks like a fork bomb' },

  // Leaving the machine, or ending it.
  { test: /\b(shutdown|reboot|halt|killall)\b/, why: 'it affects the whole machine' },
  { test: /\bsystemctl\b|\blaunchctl\b/, why: 'it affects the whole machine' },
];

/** Normalised for matching: lowercase, one space between things. */
const flatten = (command: string): string =>
  command.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Why this command will always be asked about, or null when nothing caught it.
 *
 * The first rule that matches wins, so `RULES` is in the order the reasons are
 * worth reading rather than in the order they were thought of.
 */
export function refusedFor(command: string): string | null {
  const flat = flatten(command);
  if (!flat) return null;
  for (const rule of RULES) if (rule.test.test(flat)) return rule.why;
  return null;
}

export const isRefused = (command: string): boolean => refusedFor(command) !== null;

export type Decision =
  /** Show the dialog and wait for a person. */
  | { kind: 'ask'; why: string | null }
  /** Approve it now. */
  | { kind: 'run' };

/**
 * Whether a command runs without being asked about.
 *
 * The refuse-list is checked *before* the level, not after, so no level can
 * skip it. That ordering is the whole guarantee — reversed, a future `all+`
 * would only have to forget one branch.
 */
export function decide(command: string, level: Level): Decision {
  const why = refusedFor(command);
  if (why) return { kind: 'ask', why };
  if (level === 'all') return { kind: 'run' };
  return { kind: 'ask', why: null };
}

/** Whether staged file changes apply on their own. */
export const appliesEdits = (level: Level): boolean => level === 'edits' || level === 'all';

/** Whether any question is being answered for you. For the indicator. */
export const isOn = (level: Level): boolean => level !== 'off';

/** A level read from anywhere untrusted. Anything unrecognised is `off`. */
export function levelOf(value: unknown): Level {
  return LEVELS.includes(value as Level) ? (value as Level) : 'off';
}
