/**
 * Putting the terminals back the way you left them.
 *
 * Closing the panel has always kept its shells — the panel is hidden, not
 * unmounted, so nothing dies. Quitting the app is different: the processes go
 * with it, and there is no honest way around that. A shell is a child of this
 * application; when the application ends, so does it.
 *
 * What *can* come back is everything else — the sessions, their names, their
 * colours, their order, the directories they were in, which were on screen, and
 * what was written in them. So that is what this saves, and the one thing it
 * cannot bring back is the one thing it says out loud.
 *
 * ## The banner is the feature
 *
 * A restored terminal shows the output it had and then a fresh prompt. Without
 * a line between them, somebody scrolls up, sees `npm run dev` compiling, and
 * believes it is still running — the app would have made a screenshot of a
 * dead process look like a live one. `BANNER` is the sentence that stops that,
 * and it is not optional or dismissible.
 *
 * ## Why the buffer and not the bytes
 *
 * The obvious way to record a terminal is to tee the bytes the shell sends and
 * replay them. It is wrong twice.
 *
 * A byte stream carries every escape sequence, not just the coloured text: mode
 * switches, cursor keys, mouse reporting, window titles. Replaying those into a
 * new terminal leaves it in a state nobody chose, and the failure looks like
 * the terminal being broken rather than like a restore being wrong.
 *
 * And a full-screen program — Claude Code, vim, htop — paints thousands of
 * frames onto the *alternate* screen. Its bytes are all of those frames; its
 * buffer, once it exits, is the ordinary scrollback you had before it started.
 * Reading the buffer gets full-screen programs right by doing nothing at all.
 *
 * The cost is colour: this saves text. A restored transcript is grey, which is
 * also the truth about it — it is a record, not output.
 */

/** How many sessions are remembered for one folder. */
export const MAX_SESSIONS = 8;

/** Lines kept per session. Enough to see what you were doing, not a log file. */
export const MAX_LINES = 240;

/**
 * A ceiling on the whole record, in characters.
 *
 * This lives in `localStorage` beside the chats, and a store with no ceiling is
 * one that eventually refuses to save anything at all — including the chats.
 */
export const MAX_CHARS = 120_000;

/** The line drawn between what was and what is. */
export const BANNER = '── restored · this is a new shell, nothing above is running ──';

export interface SavedSession {
  /** The pane's number, so `Terminal 3` comes back as `Terminal 3`. */
  n: number;
  name?: string;
  tag?: string;
  /** Where the shell was. The new one starts here. */
  cwd?: string;
  /** What was written, oldest line first. */
  text: string;
}

export interface Saved {
  sessions: SavedSession[];
  /** Which sessions were drawn, by index into `sessions`. */
  shown: number[];
  /** Which was focused, by index. */
  active: number;
}

export const NOTHING: Saved = { sessions: [], shown: [], active: 0 };

/** Where a folder's terminals are kept. Keyed by folder, like its tabs. */
export const KEY = 'vylo.terminals.v1';

/**
 * The tail of a buffer, as lines.
 *
 * Trailing blank lines are dropped because a terminal's buffer is padded to its
 * height: keeping them would restore a screen of emptiness above the banner and
 * push the real output out of sight.
 */
export function tail(lines: readonly string[], max = MAX_LINES): string {
  const out = [...lines];
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.slice(Math.max(0, out.length - max)).join('\n');
}

/**
 * Trim a record to fit.
 *
 * Sessions go from the *end* — the ones opened most recently — because the
 * first pane is the one somebody has been in all along. Text is then trimmed
 * from the oldest lines of the largest session until the whole record fits,
 * which keeps a small session whole rather than trimming everything equally
 * into uselessness.
 */
export function fit(saved: Saved, maxChars = MAX_CHARS, maxSessions = MAX_SESSIONS): Saved {
  const sessions = saved.sessions.slice(0, maxSessions).map((s) => ({ ...s }));
  const kept = sessions.length;
  const size = () => sessions.reduce((n, s) => n + s.text.length, 0);

  // Halve the biggest until it fits, rather than trimming every session
  // equally: one long session should not cost every short one its history.
  let guard = 0;
  while (size() > maxChars && guard++ < 200) {
    let at = 0;
    for (let i = 1; i < sessions.length; i++) {
      if (sessions[i].text.length > sessions[at].text.length) at = i;
    }
    const text = sessions[at].text;
    if (!text) break;
    const half = text.slice(Math.floor(text.length / 2));
    // Start at a line boundary, so a restore never opens mid-word — but only
    // when there is one. A session holding a single enormous line (a `cat` of
    // a minified file) has no boundary to find, and dropping it entirely would
    // lose the whole session to a preference about where text begins.
    const nl = half.indexOf('\n');
    sessions[at].text = nl >= 0 ? half.slice(nl + 1) : half;
  }

  return {
    sessions,
    shown: saved.shown.filter((i) => i >= 0 && i < kept),
    active: saved.active >= 0 && saved.active < kept ? saved.active : 0,
  };
}

/** Read one folder's record, repairing anything untrustworthy. */
export function read(raw: string | null, folder: string): Saved {
  if (!folder) return NOTHING;
  try {
    const all = raw ? JSON.parse(raw) : null;
    if (!all || typeof all !== 'object') return NOTHING;
    const one = (all as Record<string, unknown>)[folder];
    if (!one || typeof one !== 'object') return NOTHING;
    const o = one as Record<string, unknown>;
    if (!Array.isArray(o.sessions)) return NOTHING;

    const sessions: SavedSession[] = [];
    for (const item of o.sessions) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      sessions.push({
        n: typeof s.n === 'number' && s.n > 0 ? Math.floor(s.n) : sessions.length + 1,
        name: typeof s.name === 'string' && s.name.trim() ? s.name : undefined,
        tag: typeof s.tag === 'string' ? s.tag : undefined,
        cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
        text: typeof s.text === 'string' ? s.text : '',
      });
      if (sessions.length >= MAX_SESSIONS) break;
    }
    if (!sessions.length) return NOTHING;

    const shown = Array.isArray(o.shown)
      ? o.shown.filter((i): i is number => typeof i === 'number' && i >= 0 && i < sessions.length)
      : [];
    const active = typeof o.active === 'number' && o.active >= 0 && o.active < sessions.length
      ? Math.floor(o.active) : 0;
    // A record that remembers nothing on screen would restore panes and draw
    // none of them.
    return { sessions, shown: shown.length ? [...new Set(shown)] : [0], active };
  } catch {
    // A restore is a convenience. A bad record is a fresh terminal, never a
    // panel that will not open.
    return NOTHING;
  }
}

/**
 * Write one folder's record into the store, leaving other folders alone.
 *
 * Folders are capped too: somebody who opens twenty projects should not carry
 * twenty terminal transcripts for ever. The one being written is always kept.
 */
export const MAX_FOLDERS = 8;

export function write(raw: string | null, folder: string, saved: Saved): string {
  let all: Record<string, unknown> = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      all = parsed as Record<string, unknown>;
    }
  } catch {
    // Unreadable: start again rather than lose the folder being written.
  }
  if (!saved.sessions.length) delete all[folder];
  else all[folder] = fit(saved);

  const keys = Object.keys(all);
  if (keys.length > MAX_FOLDERS) {
    // Oldest first by insertion order, and never the one just written.
    for (const k of keys.slice(0, keys.length - MAX_FOLDERS)) {
      if (k !== folder) delete all[k];
    }
  }
  return JSON.stringify(all);
}

/** What this store is taking, for the Storage tab. */
export function bytes(raw: string | null): number {
  return raw ? raw.length * 2 : 0;
}
