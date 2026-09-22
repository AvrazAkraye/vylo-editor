/**
 * Folders of terminals, and folders inside those.
 *
 * The rail was a flat list. That is right for four terminals and wrong for
 * fourteen: the one running the API, the three watching tests, the two on the
 * server and the one somebody opened to check a path are all the same kind of
 * row, and finding the right one means reading every name. A group is the
 * answer, and a group inside a group is the answer for the person with two
 * projects open.
 *
 * ## A group is a path, not an object
 *
 * The obvious model is a tree of objects with session ids in the leaves. It
 * does not survive a restart, and that is not a detail: `newTab` mints a fresh
 * id every launch, so a tree keyed by id comes back pointing at nothing while
 * the sessions it was describing are sitting right there, restored by name.
 *
 * So a session carries its group the way a file carries its folder — as a
 * path, `api` or `api/tests` — and the tree is *derived* from the paths in
 * use. Membership then persists for free, because it is already part of what
 * the session saves. Renaming a group is a rewrite of every path under it,
 * which is one `map` rather than a tree walk, and moving a session between
 * groups is an assignment.
 *
 * The one thing paths cannot express is an **empty** group, because nothing
 * carries the path of a group with nothing in it. A person who makes a group
 * and has not filled it yet is doing something completely ordinary, so the
 * empty ones are kept as their own list and merged in by `all`.
 *
 * ## Why three levels
 *
 * The rail is 248 pixels and every level costs an indent. At three the
 * deepest name still has room to be read; at four it does not. `join` caps
 * rather than refuses — somebody dragging a group into a group is telling you
 * where they want it, and the honest answer to "that is too deep" is to put it
 * as deep as it goes, not to silently do nothing.
 */

/** What separates a group from its parent, and what a name may not contain. */
export const SEP = '/';

/** How many levels a path may have. See the header. */
export const MAX_DEPTH = 3;

/**
 * The longest a single name may be.
 *
 * Long enough for "integration tests" and short enough that the row is a name
 * rather than a sentence. Past this it is cut, not refused: somebody pasting a
 * folder path into the name box gets the start of it, which is usually the
 * part that identifies it.
 */
export const MAX_NAME = 32;

/**
 * One segment, cleaned.
 *
 * The separator is the one character a name cannot contain, so it is replaced
 * rather than stripped — a name with it removed silently joins two words that
 * were not joined, and a space is the honest reading of "this was two things".
 * Control characters go the same way, because a name is one line.
 */
export function clean(name: string): string {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .split(SEP).join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME)
    .trim();
}

/** The segments of a path, with the empties gone. */
export function parts(path: string): string[] {
  if (typeof path !== 'string') return [];
  return path.split(SEP).map(clean).filter((x) => x.length > 0).slice(0, MAX_DEPTH);
}

/** A path, cleaned and capped. `''` is "no group". */
export function tidy(path: string): string {
  return parts(path).join(SEP);
}

/** The last segment — what the row shows. */
export function nameOf(path: string): string {
  const p = parts(path);
  return p.length ? p[p.length - 1] : '';
}

/** Everything above it, or `''` at the top level. */
export function parentOf(path: string): string {
  return parts(path).slice(0, -1).join(SEP);
}

/** How deep it sits. `''` is 0, a top-level group is 1. */
export function depthOf(path: string): number {
  return parts(path).length;
}

/**
 * A child of `parent`, capped at `MAX_DEPTH`.
 *
 * At the cap the new name replaces the deepest segment rather than being
 * dropped: the person said where they wanted it, and a button that does
 * nothing is worse than one that does the nearest possible thing.
 */
export function join(parent: string, name: string): string {
  const leaf = clean(name);
  if (!leaf) return tidy(parent);
  const up = parts(parent);
  if (up.length >= MAX_DEPTH) up.length = MAX_DEPTH - 1;
  return [...up, leaf].join(SEP);
}

/** Every group above this one, outermost first. `api/tests` → `[api, api/tests]`. */
export function ancestors(path: string): string[] {
  const p = parts(path);
  return p.map((_, i) => p.slice(0, i + 1).join(SEP));
}

/**
 * Whether `path` is `root` or sits inside it.
 *
 * Compared segment by segment rather than with `startsWith`, which would say
 * that `apidocs` is inside `api`.
 */
export function under(path: string, root: string): boolean {
  if (!root) return true;
  const a = parts(path);
  const b = parts(root);
  if (a.length < b.length) return false;
  return b.every((seg, i) => a[i] === seg);
}

/** A session, as far as this module is concerned. */
export interface Held {
  id: string;
  /** The group it is in, or `''`. */
  group?: string;
}

/**
 * Every group that exists, outermost first and each before its children.
 *
 * The union of three things: the groups sessions are in, the empty ones kept
 * separately, and the **ancestors of both** — a session in `api/tests` puts
 * `api` on the list whether or not anything else did, because a path with a
 * missing middle cannot be drawn.
 *
 * Sorted by path, which puts a parent immediately before its children and
 * siblings next to each other. That is the order the rail draws in, so the
 * sort is the layout rather than a tidy-up.
 */
export function all(empties: readonly string[], sessions: readonly Held[]): string[] {
  const seen = new Set<string>();
  const take = (p: string) => {
    for (const a of ancestors(p)) seen.add(a);
  };
  for (const e of empties) take(typeof e === 'string' ? e : '');
  for (const s of sessions) take(s?.group ?? '');
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/** One path rewritten, when `from` is renamed or moved to `to`. */
export function renamed(path: string, from: string, to: string): string {
  if (!under(path, from) || !from) return tidy(path);
  const rest = parts(path).slice(depthOf(from));
  return [...parts(to), ...rest].slice(0, MAX_DEPTH).join(SEP);
}

/**
 * What a row in the rail is.
 *
 * `depth` is 1-based for a group so a session at the top level and a group at
 * the top level indent the same; a session inside a group is one deeper than
 * the group, which is what puts it under the name rather than beside it.
 */
export type Node =
  | {
    kind: 'group';
    path: string;
    /** The last segment, which is what the row shows. */
    name: string;
    depth: number;
    /** Sessions in it and in everything under it. What a shut row reports. */
    count: number;
    shut: boolean;
  }
  | { kind: 'session'; id: string; depth: number };

/**
 * The rail, flattened, in the order it is drawn.
 *
 * Sub-groups before sessions, which is what every tree the person already
 * uses does — a folder that sorted below its files would make them hunt for
 * it. A shut group contributes its header and nothing else, however deep the
 * thing inside it is.
 *
 * Loose sessions come last. They are the ones nobody has filed, and putting
 * them first would push every named group below the fold in a rail that has
 * any.
 *
 * `order` is the session list as the panel keeps it, and sessions come out in
 * that order within each group — a row that jumps position when a group is
 * opened is a row you have to find again every time.
 */
export function nodes(
  groups: readonly string[],
  sessions: readonly Held[],
  shut: ReadonlySet<string> = new Set(),
): Node[] {
  // `all` rather than the argument, for the same reason it exists: a session
  // in `api/tests` needs `api` drawn whether or not anything passed it in, and
  // a path with a missing middle cannot be drawn at all.
  const known = all(groups, sessions);
  const mine = (path: string) => sessions.filter((s) => tidy(s?.group ?? '') === path);
  const deep = (path: string) => sessions.filter((s) => {
    const g = tidy(s?.group ?? '');
    return g !== '' && under(g, path);
  }).length;

  const out: Node[] = [];
  const walk = (parent: string, depth: number) => {
    for (const path of known) {
      if (parentOf(path) !== parent) continue;
      const isShut = shut.has(path);
      out.push({ kind: 'group', path, name: nameOf(path), depth, count: deep(path), shut: isShut });
      if (isShut) continue;
      walk(path, depth + 1);
      for (const s of mine(path)) out.push({ kind: 'session', id: s.id, depth: depth + 1 });
    }
  };
  walk('', 1);
  for (const s of sessions) {
    if (!tidy(s?.group ?? '')) out.push({ kind: 'session', id: s.id, depth: 1 });
  }
  return out;
}

/**
 * How many terminals an "open a group" button offers.
 *
 * One, and then the counts that are a shape: a pair, the row full, and the
 * grid full. Three and five are missing because nobody asks for five
 * terminals — they ask for "the four I need" and then one more, which is the
 * ladder's job once the group exists.
 */
export const LAUNCH: readonly number[] = [1, 2, 4, 6];
