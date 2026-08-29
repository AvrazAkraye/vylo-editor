/**
 * Applying a code block from a reply.
 *
 * Agents write fenced snippets in prose all the time — an answer to "how would
 * I do this" is a block, not a `write_file` call — and until now the only way
 * to use one was to copy it out by hand.
 *
 * ## Why this is not just "write the block to the file"
 *
 * A block is almost always a *fragment*. Writing it to the file it came from
 * would replace the whole file with a snippet, which is not applying an edit,
 * it is deleting a file and leaving part of it behind. So the block goes back
 * to the model with the file, and what comes back is a targeted replacement
 * that `Pending.stageEdit` can apply — after which it is an ordinary staged
 * change, reviewed like any other. Nothing here reaches disk on its own.
 */

/** A path-shaped token: has a separator or an extension, no spaces. */
const PATHISH = /[A-Za-z0-9_@.\-/\\]+/g;

function looksLikePath(s: string): boolean {
  return (s.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(s)) && !s.endsWith('/');
}

/**
 * Which file a block belongs to, or null when it cannot be told.
 *
 * In priority order: a path in the fence's info string, a path named in the
 * prose just above it, then the file already open. The fallback is what makes
 * the button useful in practice — most blocks are about the file you are
 * looking at — and the two lookups above it are what stop that guess being
 * wrong when the reply is about something else.
 */
export function applyTarget(
  info: string,
  before: string,
  openPath: string | null,
  exists: (path: string) => boolean,
): string | null {
  for (const tok of (info.match(PATHISH) ?? [])) {
    if (looksLikePath(tok) && exists(tok)) return tok;
  }
  // Nearest first: the sentence introducing a block is the one right above it.
  const lines = before.split('\n').slice(-4).reverse();
  for (const line of lines) {
    const backticked = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).reverse();
    for (const tok of backticked) {
      const clean = tok.trim();
      if (looksLikePath(clean) && exists(clean)) return clean;
    }
    for (const tok of (line.match(PATHISH) ?? []).reverse()) {
      if (looksLikePath(tok) && exists(tok)) return tok;
    }
  }
  return openPath && exists(openPath) ? openPath : null;
}

const SYSTEM = [
  'You turn a proposed code snippet into a precise edit to an existing file.',
  '',
  'Reply with one or more blocks in exactly this form and nothing else:',
  '',
  '<<<<<<< SEARCH',
  'the exact existing text to replace',
  '=======',
  'what it becomes',
  '>>>>>>> REPLACE',
  '',
  'The SEARCH text must appear in the file **exactly once**, character for',
  'character including indentation. Include enough surrounding lines to make it',
  'unique. Do not use markdown fences, and do not explain anything.',
  '',
  'Change only what the snippet implies. If the snippet is already what the file',
  'says, reply with nothing at all.',
].join('\n');

export function applyMessages(o: {
  path: string; language: string; file: string; snippet: string;
}): { system: string; user: string } {
  const user = [
    `File: ${o.path}`,
    o.language ? `Language: ${o.language}` : null,
    '',
    '<current_file>',
    o.file,
    '</current_file>',
    '',
    '<proposed_snippet>',
    o.snippet,
    '</proposed_snippet>',
    '',
    'Edits that apply the snippet to the file:',
  ].filter((l) => l !== null).join('\n');
  return { system: SYSTEM, user };
}

export interface Replacement { old: string; replacement: string }

/**
 * Search/replace blocks, rather than JSON.
 *
 * JSON would need every newline and quote in the code escaped, and a model that
 * gets one wrong produces a reply that will not parse at all. These markers
 * need no escaping, so a mistake costs one block rather than the whole answer.
 */
export function parseApply(raw: string): Replacement[] {
  const text = String(raw ?? '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const out: Replacement[] = [];

  let i = 0;
  while (i < lines.length) {
    if (!/^<{5,9} SEARCH\s*$/.test(lines[i].trim())) { i++; continue; }
    i++;
    const before: string[] = [];
    while (i < lines.length && lines[i].trim() !== '=======') { before.push(lines[i]); i++; }
    if (i >= lines.length) break;      // a block the model never finished
    i++;
    const after: string[] = [];
    while (i < lines.length && !/^>{5,9} REPLACE\s*$/.test(lines[i].trim())) { after.push(lines[i]); i++; }
    if (i >= lines.length) break;
    i++;

    const old = before.join('\n');
    // An empty SEARCH matches everywhere, so it is not an edit, it is a way to
    // corrupt a file at a position nobody chose.
    if (old.trim()) out.push({ old, replacement: after.join('\n') });
  }
  return out;
}
