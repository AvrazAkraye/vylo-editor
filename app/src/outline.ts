/**
 * The shape of the file you have open.
 *
 * `symbols_in_text` has existed since the symbol index was built and only the
 * command palette ever called it — you could jump to a declaration if you
 * already knew its name, and there was nowhere to *look* at the file's shape.
 * That is the gap this fills, and it is the oldest one in the app: every editor
 * people are coming here from has an outline.
 *
 * Reading from the buffer rather than from the index is not an implementation
 * detail. The index is built from what is on disk, so an outline drawn from it
 * would be missing the function you have just typed and would still list the
 * one you have just deleted — which is worse than no outline, because it is an
 * outline you would learn not to trust.
 *
 * Nothing here talks to anything. Symbols in, arrangement out.
 */

import { rank, score } from './fuzzy';

/** One declaration, as `symbols_in_text` reports it. */
export interface Symbol {
  name: string;
  kind: string;
  path: string;
  /** One-based, as the file is numbered. */
  line: number;
}

/**
 * The kinds the indexer emits, grouped by what they mean rather than by which
 * language said them.
 *
 * `fn`, `function`, `def`, `func` and `method` are one thing in five languages,
 * and an outline that coloured them differently would be teaching the reader
 * the indexer's vocabulary instead of their own file's.
 */
export type Family = 'type' | 'callable' | 'value' | 'section' | 'other';

const FAMILY: Record<string, Family> = {
  class: 'type', struct: 'type', interface: 'type', trait: 'type',
  enum: 'type', type: 'type', impl: 'type',
  fn: 'callable', function: 'callable', def: 'callable', func: 'callable', method: 'callable',
  const: 'value', var: 'value', let: 'value',
  mod: 'section', module: 'section', namespace: 'section', heading: 'section',
};

export const familyOf = (kind: string): Family => FAMILY[kind.toLowerCase()] ?? 'other';

/**
 * The letter in the badge.
 *
 * One character, from the kind itself rather than from a table of icons: a new
 * language added to the indexer gets a sensible badge without anything here
 * being edited, and `t` for `type` is a better hint than a shape somebody has
 * to learn.
 */
export const badgeOf = (kind: string): string => (kind.trim()[0] ?? '?').toLowerCase();

export interface Row extends Symbol {
  family: Family;
  /** Whether the cursor is inside this declaration. */
  here: boolean;
}

export type Order = 'file' | 'name';

/**
 * Arrange the outline.
 *
 * File order by default, because an outline is a *map* — the reason to look at
 * one is to see how the file is laid out, and sorting it alphabetically throws
 * away the only thing a map has. Alphabetical is offered for the other job,
 * finding a name in a long file, and is a deliberate second choice.
 *
 * A query ranks with the same matcher the palette uses. Two lists in one app
 * that rank differently feel like two applications.
 */
export function arrange(
  symbols: readonly Symbol[],
  { query = '', order = 'file' as Order, cursor = 0 } = {},
): Row[] {
  const at = current(symbols, cursor);
  const decorate = (s: Symbol): Row => ({ ...s, family: familyOf(s.kind), here: s === at });

  const q = query.trim();
  if (q) {
    // `rank` caps its results, which is right for a palette and wrong here:
    // a filter that silently stops at forty is one that hides the match you
    // were looking for in a large file.
    return rank(q, [...symbols], (s) => s.name, symbols.length).map(decorate);
  }

  const rows = symbols.map(decorate);
  if (order === 'name') {
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.line - b.line);
  }
  return rows.sort((a, b) => a.line - b.line);
}

/**
 * The declaration the cursor is inside.
 *
 * The last one starting at or before the caret. Without an end line — the
 * indexer reports where a declaration *starts* and nothing else — this is the
 * only answer available, and it is the one every editor gives: past the end of
 * a function and before the next, it still says the function you just left.
 * Worth knowing, because it is occasionally wrong and never confusing.
 */
export function current(symbols: readonly Symbol[], line: number): Symbol | null {
  if (line <= 0) return null;
  let best: Symbol | null = null;
  // The last one at or before the caret. `>=` rather than `>` so that when two
  // declarations share a line — a one-line `export const x = () => {}` can
  // match two patterns — the later one in the file's own order wins, which is
  // the one whose name the reader sees furthest right.
  for (const s of symbols) {
    if (s.line <= line && (!best || s.line >= best.line)) best = s;
  }
  return best;
}

/** How many of each family, for the count beside the heading. */
export function tally(symbols: readonly Symbol[]): { family: Family; n: number }[] {
  const n = new Map<Family, number>();
  for (const s of symbols) {
    const f = familyOf(s.kind);
    n.set(f, (n.get(f) ?? 0) + 1);
  }
  const order: Family[] = ['section', 'type', 'callable', 'value', 'other'];
  return order.filter((f) => n.has(f)).map((f) => ({ family: f, n: n.get(f) as number }));
}

/** Whether a query would match anything at all, for the empty state's wording. */
export const anyMatch = (symbols: readonly Symbol[], query: string): boolean =>
  !query.trim() || symbols.some((s) => score(query, s.name) !== null);
