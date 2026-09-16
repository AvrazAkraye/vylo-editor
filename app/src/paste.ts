/**
 * Pasting a lot of text into a shell.
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
