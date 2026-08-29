/**
 * Fuzzy path matching for ⌘P, and later for @-mentions.
 *
 * A subsequence match on its own ranks badly: every query matches almost
 * everything, so the ordering is what makes it useful rather than the filter.
 * The bonuses below encode how people actually type a path — initials of the
 * segments ("apsx" for app/src/App.tsx), a run from the start of the file name,
 * the camel hump of a symbol — and the length penalty breaks ties toward the
 * shorter, more likely file.
 */

const BOUNDARY = /[/\\_\-. ]/;

/** Higher is better. `null` when the query is not a subsequence of the target. */
export function score(query: string, target: string): number | null {
  const q = query.trim();
  if (!q) return 0;
  const ql = q.toLowerCase();
  const tl = target.toLowerCase();

  let at = 0;
  let total = 0;
  let streak = 0;
  let first = -1;

  for (let qi = 0; qi < ql.length; qi++) {
    const c = ql[qi];
    const found = tl.indexOf(c, at);
    if (found === -1) return null;
    if (first === -1) first = found;

    let pts = 1;
    if (found === at && qi > 0) {
      streak += 1;
      pts += 4 + streak;      // consecutive characters are a real prefix
    } else {
      streak = 0;
    }
    const prev = found > 0 ? target[found - 1] : '/';
    if (BOUNDARY.test(prev)) pts += 8;                               // start of a segment
    else if (prev === prev.toLowerCase() && target[found] !== tl[found]) pts += 6;  // camelCase hump
    if (found === 0) pts += 10;

    total += pts;
    at = found + 1;
  }

  // A match inside the file name beats the same match buried in the directory.
  const slash = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  if (first > slash) total += 12;
  // Break ties toward shorter paths, but never enough to beat a real bonus.
  total -= Math.min(target.length / 6, 12);
  return total;
}

/** Best `limit` items, best first. Ties keep the input order. */
export function rank<T>(query: string, items: T[], key: (t: T) => string, limit = 40): T[] {
  const scored: { item: T; s: number; i: number }[] = [];
  for (let i = 0; i < items.length; i++) {
    const s = score(query, key(items[i]));
    if (s !== null) scored.push({ item: items[i], s, i });
  }
  scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  return scored.slice(0, limit).map((x) => x.item);
}

/** Character positions in `target` that the query matched, for highlighting. */
export function positions(query: string, target: string): number[] {
  const ql = query.trim().toLowerCase();
  const tl = target.toLowerCase();
  const out: number[] = [];
  let at = 0;
  for (const c of ql) {
    const found = tl.indexOf(c, at);
    if (found === -1) return [];
    out.push(found);
    at = found + 1;
  }
  return out;
}
