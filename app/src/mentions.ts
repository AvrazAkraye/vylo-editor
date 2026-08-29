/**
 * `@` mentions in the composer.
 *
 * A mention is **text, not state**. Selecting one from the picker inserts
 * `@src/App.tsx` into the message and nothing else; what gets attached is
 * worked out from the text again at send time. The alternative — attaching on
 * selection and keeping a list alongside the prompt — desynchronises the moment
 * someone deletes the word they just inserted, and then the chips say one thing
 * while the message says another.
 *
 * The corollary is that an `@` that does not resolve to something real is left
 * alone. Prose is full of them, and silently attaching a file because a sentence
 * happened to contain its name would be worse than not supporting mentions.
 */

export type MentionKind = 'file' | 'folder' | 'terminal';

export interface Mention {
  /** Exactly as written, including the `@`, so it can be found in the text. */
  raw: string;
  kind: MentionKind;
  /** Relative path, or '' for `@terminal`. */
  path: string;
}

/** Tells the parser what actually exists. `null` means "not a real thing". */
export type Resolver = (path: string) => 'file' | 'folder' | null;

export const TERMINAL = 'terminal';

/** A `@` only starts a mention at a boundary, so `name@example.com` is safe. */
function startsMention(text: string, at: number): boolean {
  if (at === 0) return true;
  return /[\s(["'`,]/.test(text[at - 1]);
}

/**
 * Candidates for one token, longest first.
 *
 * `@src/App.tsx.` at the end of a sentence should resolve to `src/App.tsx` —
 * but `@a.` might legitimately be a file called `a.`, so the longest form is
 * tried first and punctuation is only shed if nothing matched.
 */
function candidates(word: string): string[] {
  const out = [word];
  let s = word;
  while (s.length > 1 && /[.,;:!?)\]}'"`]$/.test(s)) {
    s = s.slice(0, -1);
    out.push(s);
  }
  return out;
}

/** Every mention in a message that resolves to something real. */
export function findMentions(text: string, resolve: Resolver, hasTerminal = false): Mention[] {
  const found: Mention[] = [];
  const seen = new Set<string>();
  const re = /@([^\s@]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!startsMention(text, m.index)) continue;
    for (const word of candidates(m[1])) {
      if (word === TERMINAL) {
        if (!hasTerminal) break;
        if (!seen.has('@' + TERMINAL)) {
          seen.add('@' + TERMINAL);
          found.push({ raw: '@' + TERMINAL, kind: 'terminal', path: '' });
        }
        break;
      }
      const kind = resolve(word);
      if (kind) {
        const raw = '@' + word;
        // The same file mentioned twice is one attachment, not two copies.
        if (!seen.has(raw)) { seen.add(raw); found.push({ raw, kind, path: word }); }
        break;
      }
    }
  }
  return found;
}

/**
 * The mention being typed at the caret, if any.
 *
 * Returns null as soon as the token contains a space, so a sentence after an
 * unresolved `@` does not keep the picker open over the rest of the message.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '@') {
      if (!startsMention(text, i)) return null;
      return { start: i, query: text.slice(i + 1, caret) };
    }
    if (/\s/.test(ch)) return null;
  }
  return null;
}

/** Replace the token being typed with a chosen one, and say where the caret goes. */
export function applyMention(
  text: string, start: number, caret: number, path: string,
): { text: string; caret: number } {
  const inserted = `@${path} `;
  return {
    text: text.slice(0, start) + inserted + text.slice(caret),
    caret: start + inserted.length,
  };
}

/**
 * What a mentioned folder is worth sending.
 *
 * The paths, not the contents. A folder mention means "these files exist and
 * this is how they are arranged"; sending every file in it would blow the
 * context window on a directory someone gestured at.
 */
export function folderListing(
  folder: string, entries: { path: string; is_dir: boolean }[], limit = 200,
): string {
  const prefix = folder.endsWith('/') ? folder : folder + '/';
  const inside = entries
    .filter((e) => e.path.startsWith(prefix))
    .map((e) => e.path + (e.is_dir ? '/' : ''))
    .sort();
  const shown = inside.slice(0, limit);
  const more = inside.length - shown.length;
  return [
    `${folder}/ — ${inside.length} entr${inside.length === 1 ? 'y' : 'ies'}`,
    ...shown,
    more > 0 ? `… and ${more} more` : null,
  ].filter((l) => l !== null).join('\n');
}

/** A resolver backed by the file tree the app already holds. */
export function treeResolver(entries: { path: string; is_dir: boolean }[]): Resolver {
  const map = new Map<string, 'file' | 'folder'>();
  for (const e of entries) map.set(e.path, e.is_dir ? 'folder' : 'file');
  return (p) => map.get(p) ?? null;
}
