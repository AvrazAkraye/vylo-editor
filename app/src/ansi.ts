/**
 * Turning terminal output into something worth sending to a model.
 *
 * A pty carries what a *screen* should look like, not what was written. Colour
 * codes, cursor moves and a progress bar redrawing itself two hundred times are
 * all in there, and forwarding that raw costs real tokens to say nothing — a
 * single `npm install` can produce tens of kilobytes of escape sequences around
 * a few lines of actual text.
 */

/**
 * CSI (`ESC [ … letter`), OSC (`ESC ] … BEL` or `ST`), and the two-character
 * escapes. Deliberately not a full terminal emulator: the aim is legible text,
 * not a faithful screen buffer.
 */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[ -/]*[@-~]|\][\s\S]*?(?:|\\)|[@-Z\\-_]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * A carriage return means "go back to the start of this line", so a progress
 * bar writes the same line over and over. Only the last version was ever
 * visible, so only the last version is worth keeping.
 */
export function collapseCarriage(text: string): string {
  return text
    // CRLF first, and this is not cosmetic. A pty's line discipline turns every
    // \n into \r\n, so without this the \r at the end of each line reads as an
    // overwrite and the whole line is discarded — every command would come back
    // with empty output.
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      const i = line.lastIndexOf('\r');
      return i === -1 ? line : line.slice(i + 1);
    })
    .join('\n');
}

/** Trim from the middle, which is where the least interesting output is. */
export function clip(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const half = Math.floor(max / 2);
  const head = text.slice(0, half);
  const tail = text.slice(text.length - half);
  const cut = text.length - head.length - tail.length;
  return { text: `${head}\n… ${cut} characters omitted …\n${tail}`, truncated: true };
}

/**
 * Everything at once, for output on its way to the model.
 *
 * Blank-line runs are collapsed too: a cleared screen leaves dozens of them,
 * and they carry nothing.
 */
export function readable(raw: string, max = 60_000): { text: string; truncated: boolean } {
  const clean = collapseCarriage(stripAnsi(raw))
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return clip(clean, max);
}
