/**
 * Text that arrives at a prompt without being typed.
 *
 * Two ways in, and they are the same idea: a paste, and a file dragged onto a
 * pane. Everything that reaches a shell in this application is otherwise a
 * keystroke somebody made, so both of these need a rule, and they are here
 * together because the rule is one rule.
 *
 * ## Pasting a lot of text into a shell
 *
 * ## Why this is not just "send it"
 *
 * A paste that ends in a newline runs. That is the whole hazard: text copied
 * from a web page, a chat message or a README arrives as several lines, the
 * last of which is followed by a return, and the shell executes every one of
 * them before anybody has read the first. Bracketed paste stops most shells
 * running it *immediately*, but it does not stop a single Enter afterwards
 * from running all of it, and it does nothing about the case where the shell
 * has bracketed paste off.
 *
 * So a bulk paste is held, described, and sent when somebody says so. It is
 * the same rule the rest of this application is built on — nothing reaches a
 * shell that a person has not agreed to — applied to the one path that had
 * been left out of it, because until now the only way text got to a prompt was
 * a keystroke at a time.
 *
 * ## Where the line is
 *
 * Not at "more than one line". Two lines is a command and its argument, or a
 * path with a line break in the middle of it, and stopping to confirm those
 * would train people to dismiss the confirmation without reading it — which
 * is worse than not having one. It is at four lines, or a thousand characters,
 * which is past anything anybody types and into the territory of a blob that
 * came from somewhere else.
 */

/** More lines than anybody means to type at a prompt. */
export const BULK_LINES = 4;

/** Or long enough that it plainly came from somewhere else. */
export const BULK_BYTES = 1000;

/** Whether a paste is held rather than sent straight through. */
export function isBulk(text: string): boolean {
  if (text.length >= BULK_BYTES) return true;
  // A trailing newline is not a line of its own: text copied with the line
  // break at the end is three lines and a return, not four lines, and
  // counting it would hold pastes a keystroke short of the threshold.
  return text.replace(/\r?\n$/, '').split(/\r?\n/).length > BULK_LINES;
}

export interface Summary {
  lines: number;
  bytes: number;
  /** The first line, trimmed, for the chip to show what it is. */
  head: string;
  /** Whether sending it would run something without another keystroke. */
  runs: boolean;
}

/**
 * What the chip says.
 *
 * `runs` is the one that matters and the reason the chip is worth a glance
 * rather than a dismissal: text ending in a newline executes on arrival in a
 * shell with bracketed paste off, and saying so is the difference between a
 * confirmation people read and one they clear.
 */
export function summarise(text: string): Summary {
  const body = text.replace(/\r?\n$/, '');
  const lines = body.length === 0 ? 0 : body.split(/\r?\n/).length;
  const first = body.split(/\r?\n/)[0] ?? '';
  return {
    lines,
    bytes: text.length,
    head: first.trim(),
    runs: /\r?\n$/.test(text),
  };
}

/**
 * A size a person reads, not a number of bytes.
 *
 * Whole units below a megabyte: "12 KB" is what somebody wants to know about a
 * paste, and "12,431 characters" is a number they have to convert themselves.
 */
export function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1000 / 1000).toFixed(1)} MB`;
}

/**
 * The first line, cut to something that fits on a chip.
 *
 * Cut with an ellipsis rather than wrapped: the chip sits in a strip whose
 * height changes the size of the terminal above it, and a chip that is three
 * lines tall for a long first line would resize the pane it is describing.
 */
export function head(text: string, width = 60): string {
  const one = summarise(text).head;
  return one.length <= width ? one : `${one.slice(0, width - 1)}…`;
}

/* ── a file dragged onto a pane ──────────────────────────────────────────
   The explorer's own rows, not the desktop's. A file dragged out of Finder
   arrives through Tauri's window drag-drop with an absolute path; a file
   dragged out of the panel two inches to the left is an ordinary HTML drag
   carrying whatever this app puts on it, which is the path as the tree knows
   it — relative to the open folder. */

/**
 * The drag type the explorer writes and the terminal reads.
 *
 * Its own type as well as `text/plain`: the plain text is what makes the drag
 * work anywhere else — a message box, an editor — and the specific one is how
 * the terminal can tell a path it should quote from a sentence somebody
 * dragged out of a document.
 */
export const DRAG_PATH = 'application/x-vylo-path';

/**
 * What is being dragged *inside* the app right now, and why that needs saying
 * twice.
 *
 * A drag from the file tree to a terminal is an ordinary HTML5 drag and sets
 * `dataTransfer`. That should be the whole story, and on macOS it is not:
 * an in-app drag still travels over the system pasteboard, Tauri's window
 * drag-drop handler is registered on the webview, and it takes the drop before
 * the webview sees it. The `drop` event never fires. What arrives instead is
 * Tauri's own event, carrying **no paths** — because no files were involved —
 * and everything downstream reads that as "nothing was dropped".
 *
 * The symptom is precise and was reported as one: the pane lights up, the
 * "drop to put the path at the prompt" strip appears, letting go does
 * nothing, and the highlight stays on afterwards.
 *
 * So the thing being dragged is also written down here, where an event with
 * no paths can still find it. `dataTransfer` stays as it is — when the webview
 * *does* get its own `drop` (another platform, a future Tauri that does not
 * intercept) that path runs first and calls `landed` itself, which empties the
 * register and leaves Tauri's event with nothing to do.
 */
export interface Carried {
  /** `path` is a file from the tree; `pane` is a terminal being re-seated. */
  kind: 'path' | 'pane';
  value: string;
}

let carried: Carried | null = null;

/** A drag started inside the app. Called from `dragstart`. */
export function carry(kind: Carried['kind'], value: string): void {
  carried = value ? { kind, value } : null;
}

/** Take what is being carried, and stop carrying it. */
export function landed(): Carried | null {
  const was = carried;
  carried = null;
  return was;
}

/** What is being carried, without taking it. For a hover that wants to know. */
export function carrying(): Carried | null {
  return carried;
}

/**
 * The drag type a terminal pane puts on itself.
 *
 * Its own type, and no `text/plain` beside it: a pane is not a thing that
 * means anything anywhere else, and offering it as text would put a session
 * id into a message box or a prompt if somebody let go over one.
 */
export const DRAG_PANE = 'application/x-vylo-pane';

/** Whether a path names a place rather than something inside a project. */
export function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

/** A tree path, resolved against the folder the tree is showing. */
export function under(root: string, path: string): string {
  if (!path || isAbsolute(path)) return path;
  if (!root) return path;
  return `${root.replace(/[\\/]+$/, '')}/${path}`;
}

/**
 * A path as it should be typed at a prompt in a particular directory.
 *
 * Relative when the file is inside the shell's own directory, because that is
 * what a person would have typed and what the rest of the line reads as. The
 * whole path when it is not — a relative path that climbs out (`../../other`)
 * is longer than the absolute one and harder to check, and checking it is the
 * entire reason the path is shown before it is run.
 */
export function pathForPrompt(abs: string, cwd: string): string {
  if (!cwd || !isAbsolute(abs)) return abs;
  const here = cwd.replace(/[\\/]+$/, '');
  const norm = (x: string) => x.replace(/\\/g, '/');
  const full = norm(abs).replace(/\/+$/, '');
  // The directory itself, dragged onto a shell already in it, is `.` — a real
  // argument, and a good deal more useful than the empty string that slicing
  // it against its own length would produce.
  if (full === norm(here)) return '.';
  // The slash is part of the test, not decoration: without it `/x/vylo-old`
  // reads as inside `/x/vylo`, and the path would come out as `-old/…`.
  if (!full.startsWith(`${norm(here)}/`)) return abs;
  return abs.slice(here.length + 1);
}

/* ── an image on the clipboard ───────────────────────────────────────────
   Copying a screenshot does not put a picture on the clipboard as far as a
   web view is concerned. macOS writes the file somewhere temporary and puts
   its *path* there as plain text, so pasting one into a terminal produced
   sixty characters of `/var/folders/xy/8dln…/T/TemporaryItems/…` across two
   lines, which is technically the right answer and unreadable.

   It is still a real file and still worth having at a prompt — so it is held
   and described like any other bulk paste, as `image #1` and a filename, and
   the path goes in when somebody says so. */

/** Extensions worth calling a picture rather than a file. */
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif', '.bmp', '.tiff', '.svg', '.avif'];

/**
 * Places an operating system puts a file it does not intend to keep.
 *
 * Worth saying on the chip, because the difference matters the moment the
 * terminal is used for anything: a path under `TemporaryItems` is gone by the
 * next login, and a command written against it works today and not tomorrow.
 */
const TEMPORARY = [
  '/t/temporaryitems/', '/var/folders/', '/tmp/', '/private/var/folders/',
  '\\temp\\', '\\appdata\\local\\temp\\',
];

/**
 * How much of a path can go straight to the prompt.
 *
 * A terminal is about eighty columns. A path taking most of a line is one
 * nobody can check at a glance, and checking it is the point of putting it
 * there rather than running it — the reported case wrapped onto three lines
 * and was unreadable on all of them.
 */
export const PATH_INLINE = 60;

export interface PastedFile {
  path: string;
  /** The last segment, which is what a person recognises it by. */
  name: string;
  image: boolean;
  /** The operating system will delete it. */
  temporary: boolean;
}

/**
 * A pasted path, if that is what this is.
 *
 * Deliberately narrow. Anything with a line break in it is prose, and anything
 * relative is a fragment of a sentence far more often than it is a file — the
 * whole value here is being right, because a chip over an ordinary paste is a
 * step somebody has to dismiss to do what they meant.
 */
/** Whether the operating system will delete this by itself. */
export function isTemporary(path: string): boolean {
  const low = path.toLowerCase();
  return TEMPORARY.some((t) => low.includes(t));
}

/**
 * What a path is, without asking whether it is plausible.
 *
 * `pastedFile` below is the narrow one, because a paste has to be *guessed*
 * at. A file that arrives by drag came from a file system and needs no
 * guessing, so it comes here.
 */
export function describe(path: string): PastedFile {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  return { path, name, image: IMAGE_EXT.includes(ext), temporary: isTemporary(path) };
}

/**
 * Whether a path is worth showing before it lands at the prompt.
 *
 * Two reasons, and both are about the text rather than about where it came
 * from — a rule about the source would have to say why dragging a file out of
 * the explorer is different from dragging the same file out of Finder, and it
 * is not.
 *
 * Temporary, because a command written against a path the system is about to
 * delete works today and not tomorrow, and this is the last moment anything
 * can say so. Or long, because it will not fit on a line and a path nobody can
 * read is one nobody can check.
 *
 * Everything else lands as it always did. A chip over `App.js` is a step
 * somebody has to clear to do what the drag already said.
 */
export function worthHolding(path: string): boolean {
  return isTemporary(path) || path.length > PATH_INLINE;
}

export function pastedFile(text: string): PastedFile | null {
  const one = text.trim();
  if (!one || /[\r\n]/.test(one) || !isAbsolute(one)) return null;
  const name = one.split(/[\\/]/).pop() ?? '';
  // A path with no last segment is a directory separator, not a file.
  if (!name) return null;
  // An extension is what makes this a file rather than a folder somebody
  // dragged the address of. Without one there is nothing to be confident about.
  if (name.lastIndexOf('.') <= 0) return null;
  return describe(one);
}
