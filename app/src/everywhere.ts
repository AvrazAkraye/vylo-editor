import { rank } from './fuzzy';
import {
  CATEGORIES, fold, matchesWords, search as settingsSearch, words,
  type CategoryId, type SettingId, type Translate,
} from './settings';
import { searchChats, type Chat } from './store';
import { filter as filterSessions, stateOf, titleOf, type Session } from './terminals';

/**
 * One field that searches everything.
 *
 * This app grew seven search boxes — Go to file, Search the project, Go to
 * symbol in project, Go to symbol in file, Search chats, Search sessions,
 * Search settings — and each of them is a different answer to the same
 * question, "where is that thing". A person who wants a terminal session has to
 * know, before typing, that a terminal session is not a file. This module is
 * the one answer: a query in, results grouped by kind and ordered between the
 * groups, out.
 *
 * ## It adds no matcher
 *
 * Six matchers already exist and every one of them stays where it is. Files and
 * symbols go through `rank()` from `fuzzy.ts`, chats through `searchChats()`,
 * terminal sessions through `filter()` in `terminals.ts`, settings through
 * `search()` in `settings.ts`. Commands are the only source with nothing of
 * their own, and they borrow the settings predicate — folded, every word of the
 * query somewhere in the row — rather than getting a seventh behaviour.
 *
 * That is not tidiness. Two surfaces that rank differently feel like two
 * applications, and this palette sits *above* the six panels: whatever it does
 * differently from them is a disagreement a person can see in one keystroke.
 *
 * **Within a group, the order is the source's own.** This module decides only
 * the order *between* groups, which is the part none of the six could have.
 *
 * ## The order between groups
 *
 *     weight = quality of the group's best row + a small per-kind bias
 *              + a lift for commands when the query starts one
 *
 * `quality` has three bands, two hundred apart, so the band always decides and
 * the bias only ever breaks a tie inside one:
 *
 *   - 300 the row's title *is* the query, folded. An exact filename match.
 *   - 200 the title starts with it.
 *   - 100 it matched some other way — a subsequence, a word in a keyword list,
 *         a phrase in the middle of a chat.
 *
 * So an exact filename beats a fuzzy symbol (306 against 105), and typing
 * `theme` puts the Theme setting — whose label *is* that word — above
 * `src/theme.ts`, which merely starts with it. That is the rule the whole thing
 * turns on: **the strength of a group's best claim outranks what kind of thing
 * it is.** The bias is the tie-break, and it reads as a preference for the
 * thing most likely meant when two kinds match equally well: file, symbol,
 * command, chat, terminal, setting.
 *
 * The lift is the one exception, and it is worth 150 — enough to carry commands
 * from the bottom band over another kind's prefix match, and not enough to beat
 * an exact one. A query that begins a command's first word is somebody starting
 * to name an action, and an action is not a file.
 *
 * **"Starts with a verb" is not a list of English verbs here.** A command label
 * is imperative by construction — *Open folder…*, *Save the open file*, *Go to
 * file* — so the first word of a command label already *is* the verb, and
 * "the query starts with a verb" is exactly "the query starts the first word of
 * some command we were handed". That works in Arabic and Kurdish, which a
 * hardcoded list of English verbs would not, and it cannot drift away from the
 * commands the app actually has.
 *
 * ## Prefixes, and the one that costs money
 *
 * `>` commands, `@` symbols, `#` text across files, `:` a line number — VS
 * Code's convention rather than a new one, because the muscle memory already
 * exists and inventing a fourth alphabet of sigils would be the seven search
 * boxes again in miniature.
 *
 * **`#` is the only one that reads the disk**, and that distinction is the
 * reason this module returns `needsDisk` rather than just doing the search.
 * Every other source is already in memory, so a bare query is answerable
 * between two keystrokes; a project-wide grep is not, and a header field that
 * fires one per character is a header field nobody can type in. This module
 * says *what kind of search a query is*; the caller decides when to spend it —
 * on a pause, or on Enter — and hands the hits back in `sources.hits`.
 *
 * ## The empty query
 *
 * A palette that opens empty looks broken, so an empty query — and a query of
 * nothing but spaces, which is the same thing with a stuck spacebar — returns
 * commands, chats, terminal sessions and files, in that fixed order. There is
 * nothing to rank, so the order is an argument rather than a score: the command
 * list is a menu, and a menu is what a field with nothing typed in it should
 * offer; chats and sessions are ordered by their own sources by recency, so
 * they genuinely say "where you were"; files come last because tree order is
 * not recency and eight arbitrary paths are the least useful of the four.
 *
 * Symbols and settings are left out of that mix on purpose. Neither has a
 * meaningful "first eight" — one is a slice of thousands of names in index
 * order, the other is the whole Settings dialog — and both would push the four
 * that do answer the question off the screen. Both are one keystroke away.
 */

// ─── what a query is ──────────────────────────────────────────────────────

export type Prefix = '' | '>' | '@' | '#' | ':';

export type Kind =
  | 'command' | 'file' | 'symbol' | 'text' | 'line' | 'chat' | 'terminal' | 'setting';

/** The English heading for each group. The caller renders it through `t()`. */
export const HEADING: Record<Kind, string> = {
  command: 'Commands',
  file: 'Files',
  symbol: 'Symbols',
  text: 'In files',
  line: 'Line',
  chat: 'Chats',
  terminal: 'Terminals',
  setting: 'Settings',
};

export interface Parsed {
  prefix: Prefix;
  /** The query with its prefix and any trailing `:42` removed, trimmed. */
  term: string;
  /** A line number, from `:42` or from the tail of `App.tsx:42`. */
  line: number | null;
  /**
   * True only for a `#` query that has something to grep for. The caller reads
   * this *before* deciding to search, which is the whole point of it.
   */
  needsDisk: boolean;
}

const PREFIXES: readonly Prefix[] = ['>', '@', '#', ':'];

/**
 * What kind of search this query is.
 *
 * Exported separately from `everywhere()` because the caller needs the answer
 * one step earlier than the results: `needsDisk` decides whether a keystroke
 * costs a project-wide walk, and that decision has to be made before anything
 * is spent, not after.
 *
 * A trailing `:42` is taken off any query, not only a `:` one, so `App.tsx:42`
 * opens that file at that line — the form VS Code taught people, and the one
 * they paste out of a stack trace. Only digits, and only at the very end:
 * `notes:2024` is a line number and `http://x` is not, which is the correct
 * reading of both.
 */
export function parse(raw: string): Parsed {
  const trimmed = raw.trim();
  const found = PREFIXES.find((p) => trimmed.startsWith(p));
  const prefix: Prefix = found ?? '';
  let rest = (prefix ? trimmed.slice(1) : trimmed).trim();

  let line: number | null = null;
  const tail = /^(.*?):(\d+)$/.exec(rest);
  if (prefix === ':') {
    // `:` takes a number and nothing else. Anything after it that is not one
    // leaves the line unset rather than guessing at what was meant.
    line = /^\d+$/.test(rest) ? Number(rest) : null;
    rest = '';
  } else if (tail) {
    rest = tail[1].trim();
    line = Number(tail[2]);
  }

  return { prefix, term: rest, line, needsDisk: prefix === '#' && rest.length > 0 };
}

/**
 * Where the one expensive query has got to.
 *
 *   - `free`      nothing here reads the disk. Every other prefix, and every
 *                 bare query.
 *   - `ask`       a `#` query with no answer in hand. Enter is what spends it.
 *   - `searching` a walk is in flight, so Enter must not start a second one.
 *   - `answered`  the hits held *are* the answer to this query.
 *
 * The whole of this is the last clause, and it is a comparison rather than a
 * flag for a reason that cost a wedged palette: "have we searched?" is true
 * for ever after the first Enter, so a `#` query edited by one character then
 * has no hits (they answered the old term), no way to fetch any (Enter reads
 * the flag and opens a row instead), and nothing on screen saying either — the
 * field silently stops being able to search the project until it is closed and
 * reopened. Hits belong to the term they were fetched for and to no other one,
 * so that is what is asked.
 *
 * Pure, and separate from `everywhere()`, for `parse`'s reason one step along:
 * the caller has to know what a keystroke would cost *before* it spends it.
 */
export type Disk = 'free' | 'ask' | 'searching' | 'answered';

export function diskState(
  p: Parsed,
  found: { term: string } | null | undefined,
  busy: boolean,
): Disk {
  if (!p.needsDisk) return 'free';
  if (busy) return 'searching';
  return found && found.term === p.term ? 'answered' : 'ask';
}

// ─── the sources, all of which the app already holds ──────────────────────

/**
 * A symbol, structurally identical to `Palette.tsx`'s `Symbol`.
 *
 * Declared here rather than imported so that this module pulls in no component
 * and no React: it is bundled on its own by the test build, and a `.tsx` import
 * would drag the whole tree in behind it. TypeScript is structural, so
 * `App.tsx` hands its existing `Sym[]` straight over.
 */
export interface SymbolRef {
  name: string;
  kind: string;
  path: string;
  line: number;
}

/** One hit from the Rust `search` command — `Palette.tsx`'s `Hit`. */
export interface TextHit {
  path: string;
  line: number;
  text: string;
}

/**
 * One thing the app can be told to do.
 *
 * `label` and `keywords` arrive **already translated**: the caller builds this
 * list with `t()` in hand, exactly as the menus that name the same actions do.
 * Doing it here instead would mean a second catalogue of action names living in
 * a module whose job is ranking.
 */
export interface Command {
  id: string;
  label: string;
  /** The shortcut to draw on the right of the row, e.g. `⌘P`. */
  keys?: string;
  /** Other words somebody would type for it. Translated, like the label. */
  keywords?: readonly string[];
}

export interface Sources {
  /** Every file in the tree, as relative paths. Directories already dropped. */
  files?: readonly string[];
  symbols?: readonly SymbolRef[];
  chats?: readonly Chat[];
  sessions?: readonly Session[];
  commands?: readonly Command[];
  /** Filled in only once a `#` search has actually run. Never fetched here. */
  hits?: readonly TextHit[];
  /** The file the editor has open, which is what a bare `:42` jumps inside. */
  active?: string | null;
  /** The translated word "Terminal", for `titleOf`. */
  term?: string;
  /** The interface translator. `settings.ts` explains why it is a parameter. */
  t: Translate;
}

// ─── what comes back ──────────────────────────────────────────────────────

/**
 * What Enter does, as data rather than as a callback.
 *
 * Four of the eight kinds — files, symbols, text hits and a line number —
 * resolve to the same thing, opening a file at an optional line, so the caller
 * has five cases and not eight. The union is discriminated so that adding a
 * kind without deciding what Enter does to it is a type error, which is the
 * same protection `SettingId` gives the settings panel.
 */
export type Target =
  | { go: 'file'; path: string; line?: number }
  | { go: 'chat'; id: string }
  | { go: 'terminal'; id: string }
  | { go: 'setting'; id: SettingId; category: CategoryId }
  | { go: 'command'; id: string };

export interface Result {
  kind: Kind;
  /** Unique across one run. A React key, and a handle for tests. */
  key: string;
  /** The ranked text. The palette highlights the query inside this. */
  title: string;
  /** The quieter second string: a directory, a `path:line`, a snippet. */
  detail?: string;
  /** What `.pal-kind` draws: a symbol's kind, a session's state. */
  tag?: string;
  /**
   * The title is a string that ran, not a name — a command pane, or a line of
   * source. `terminals.ts` argues the distinction; it is carried by the face.
   */
  mono?: true;
  target: Target;
}

export interface Group {
  kind: Kind;
  /** English, and an `i18n.ts` key. The caller renders `t(label)`. */
  label: string;
  /** Never empty: a group with no rows is left out entirely. */
  results: Result[];
}

export interface Everywhere extends Parsed {
  /** The query as typed, for the caller to highlight with. */
  query: string;
  /** Best group first. Empty only when genuinely nothing matched. */
  groups: Group[];
  total: number;
}

// ─── the numbers ──────────────────────────────────────────────────────────

/** How many rows a group gets when it is sharing the palette with others. */
const MIXED = 8;

/**
 * How many it gets when a prefix has narrowed the palette to it alone.
 *
 * The same numbers the six panels use, because at that point this *is* that
 * panel: `⌘P` shows 50 files, `⌘T` shows 200 symbols, the project search caps
 * at 300 hits.
 */
const LIMIT: Record<Kind, number> = {
  file: 50, symbol: 200, text: 300, line: 1,
  chat: 40, terminal: 40, setting: 40, command: 40,
};

const EXACT = 300;
const PREFIX = 200;
const SOME = 100;
const LIFT = 150;

/**
 * The tie-break inside a quality band, and nothing more — every value here is
 * smaller than the gap between two bands. Text and line only ever appear alone,
 * so their numbers decide nothing; they are here so the record is exhaustive.
 */
const BIAS: Record<Kind, number> = {
  file: 6, symbol: 5, command: 4, chat: 3, terminal: 2, setting: 1,
  text: 7, line: 8,
};

/** How strong this row's claim on the query is. Folded, so it holds in Arabic. */
function quality(title: string, term: string): number {
  if (!term) return SOME;
  const a = fold(title);
  const b = fold(term);
  if (a === b) return EXACT;
  return a.startsWith(b) ? PREFIX : SOME;
}

// ─── the groups ───────────────────────────────────────────────────────────

const cut = (path: string): number => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));

const CATEGORY = new Map(CATEGORIES.map((c) => [c.id, c.label]));

function group(kind: Kind, results: Result[]): Group | null {
  return results.length ? { kind, label: HEADING[kind], results } : null;
}

function files(term: string, src: Sources, line: number | null, limit: number): Group | null {
  const list = rank(term, [...(src.files ?? [])], (f) => f, limit);
  return group('file', list.map((path) => {
    const at = cut(path);
    return {
      kind: 'file' as const,
      key: `file:${path}`,
      title: path.slice(at + 1),
      detail: at > 0 ? path.slice(0, at) : undefined,
      // A line typed on the end of the query rides along, so `App.tsx:42`
      // opens where it says rather than at the top of the file.
      target: line === null
        ? { go: 'file' as const, path }
        : { go: 'file' as const, path, line },
    };
  }));
}

function symbols(term: string, src: Sources, limit: number): Group | null {
  const list = rank(term, [...(src.symbols ?? [])], (s) => s.name, limit);
  return group('symbol', list.map((s) => ({
    kind: 'symbol' as const,
    key: `symbol:${s.path}:${s.line}:${s.name}`,
    title: s.name,
    detail: `${s.path}:${s.line}`,
    tag: s.kind,
    target: { go: 'file' as const, path: s.path, line: s.line },
  })));
}

function chats(term: string, src: Sources, limit: number): Group | null {
  const list = searchChats(term, [...(src.chats ?? [])]).slice(0, limit);
  return group('chat', list.map((hit) => ({
    kind: 'chat' as const,
    key: `chat:${hit.chat.id}`,
    title: hit.chat.title,
    // `searchChats` returns the line that matched when the title did not, which
    // is the reason the chat came back and the only useful second string here.
    detail: hit.snippet,
    target: { go: 'chat' as const, id: hit.chat.id },
  })));
}

function sessions(term: string, src: Sources, limit: number): Group | null {
  const list = filterSessions([...(src.sessions ?? [])], term, src.term).slice(0, limit);
  return group('terminal', list.map((s) => {
    const title = titleOf(s, src.term);
    return {
      kind: 'terminal' as const,
      key: `terminal:${s.id}`,
      title: title.text,
      // The state word, not the age: `since()` needs a clock, and a pure
      // function that reads one cannot be tested. The row draws it.
      tag: stateOf(s),
      ...(title.mono ? { mono: true as const } : {}),
      target: { go: 'terminal' as const, id: s.id },
    };
  }));
}

/**
 * Settings, flattened out of `settings.ts`'s category grouping.
 *
 * **Catalogue order is kept, not re-sorted.** That is the one kind here whose
 * own order is a deliberate statement — it is rail order, the order the
 * Settings dialog itself shows — and a palette that listed the same rows in a
 * different sequence would be the two-applications problem again. It is also
 * why the settings group is not quality-sorted inside itself the way commands
 * are: `settings.ts` already decided, and it decided for a reason.
 */
function settings(term: string, src: Sources, limit: number): Group | null {
  const rows = settingsSearch(term, src.t).flatMap((g) => g.rows);
  return group('setting', rows.slice(0, limit).map((s) => ({
    kind: 'setting' as const,
    key: `setting:${s.id}`,
    title: src.t(s.label),
    detail: src.t(CATEGORY.get(s.category) ?? ''),
    target: { go: 'setting' as const, id: s.id, category: s.category },
  })));
}

/**
 * Commands, matched the way settings are matched.
 *
 * Substring over the label and its keywords, every word of the query required
 * somewhere in the row, folded — `settings.ts`'s predicate, imported rather
 * than rewritten. Its reasoning transfers exactly: over twenty short labels a
 * subsequence match is a match on everything, so the list never narrows.
 *
 * Joined on newlines for the same reason `haystack()` does it — a query word
 * must not match across the seam between two keywords and claim a hit that
 * neither of them is.
 *
 * Commands are the one source with no order of its own — the caller's list is
 * the menu order — so they are the one group sorted inside itself, by the same
 * quality ladder that orders the groups. Without it an exact command match can
 * fall off the end of the eight rows a shared palette gives it.
 */
function commands(term: string, src: Sources, limit: number): Group | null {
  const terms = words(term);
  const hits = (src.commands ?? []).filter((c) =>
    matchesWords([c.label, ...(c.keywords ?? [])].join('\n'), terms));
  const sorted = hits
    .map((c, i) => ({ c, i, q: quality(c.label, term) }))
    .sort((a, b) => (b.q - a.q) || (a.i - b.i))
    .slice(0, limit);
  return group('command', sorted.map(({ c }) => ({
    kind: 'command' as const,
    key: `command:${c.id}`,
    title: c.label,
    detail: c.keys,
    target: { go: 'command' as const, id: c.id },
  })));
}

/** The `#` group. Never fetched here — these arrive from the caller. */
function text(src: Sources, limit: number): Group | null {
  const hits = (src.hits ?? []).slice(0, limit);
  return group('text', hits.map((h, i) => ({
    kind: 'text' as const,
    key: `text:${h.path}:${h.line}:${i}`,
    title: h.text.trim(),
    detail: `${h.path}:${h.line}`,
    mono: true as const,
    target: { go: 'file' as const, path: h.path, line: h.line },
  })));
}

/**
 * The `:` group: one row, the open file at that line.
 *
 * Nothing at all when no file is open, which is the honest answer — there is no
 * "line 42" of nothing — and the only place this module returns an empty
 * palette for a query somebody meant.
 */
function lineIn(line: number, src: Sources): Group | null {
  const path = src.active;
  if (!path) return null;
  const at = cut(path);
  return group('line', [{
    kind: 'line',
    key: `line:${path}:${line}`,
    title: path.slice(at + 1),
    detail: `:${line}`,
    target: { go: 'file', path, line },
  }]);
}

// ─── putting it together ──────────────────────────────────────────────────

const keep = (...gs: (Group | null)[]): Group[] => gs.filter((g): g is Group => g !== null);

/**
 * Does the query start the first word of some command?
 *
 * The whole of "the query starts with a verb", and the reason it needs no list
 * of verbs: see the header. The first word only — "save the" is somebody
 * writing a sentence, and by then the substring match has narrowed it anyway.
 */
function startsACommand(term: string, src: Sources): boolean {
  const first = words(term)[0];
  if (!first) return false;
  return (src.commands ?? []).some((c) => (words(c.label)[0] ?? '').startsWith(first));
}

/** Best group first. Ties keep the order the groups were built in. */
function order(groups: Group[], term: string, lift: boolean): Group[] {
  const weighed = groups.map((g, i) => {
    let best = SOME;
    for (const r of g.results) best = Math.max(best, quality(r.title, term));
    const bonus = lift && g.kind === 'command' ? LIFT : 0;
    return { g, i, w: best + BIAS[g.kind] + bonus };
  });
  weighed.sort((a, b) => (b.w - a.w) || (a.i - b.i));
  return weighed.map((x) => x.g);
}

/** What a field with nothing typed in it offers. See the header. */
function nothingTyped(src: Sources): Group[] {
  return keep(
    commands('', src, MIXED),
    chats('', src, MIXED),
    sessions('', src, MIXED),
    files('', src, null, MIXED),
  );
}

/**
 * Everything that matches, grouped by kind and ordered between the groups.
 *
 * Pure, and cheap by construction: every source is one the app already holds in
 * memory. The single expensive kind — `#`, the project-wide grep — is not run
 * here at all. `needsDisk` says that a query wants it, and the hits come back
 * in `sources.hits` when the caller has decided to pay for them.
 */
export function everywhere(query: string, src: Sources): Everywhere {
  const p = parse(query);
  const groups = build(p, src);
  return {
    ...p,
    query,
    groups,
    total: groups.reduce((n, g) => n + g.results.length, 0),
  };
}

function build(p: Parsed, src: Sources): Group[] {
  const { prefix, term, line } = p;

  // A prefix narrows to one kind, and that kind then gets the whole palette —
  // so it gets the panel's own limit rather than its share of a mixed list.
  if (prefix === '>') return keep(commands(term, src, LIMIT.command));
  if (prefix === '@') return keep(symbols(term, src, LIMIT.symbol));

  // The two prefixes with no in-memory list behind them. A grep with no term
  // is not a search and there is no line zero, so rather than an empty palette
  // — which reads as broken — they show what an empty query shows, which is
  // the honest answer to "you have not finished typing".
  if (prefix === '#') return term ? keep(text(src, LIMIT.text)) : nothingTyped(src);
  if (prefix === ':') return line === null ? nothingTyped(src) : keep(lineIn(line, src));

  if (!term) return nothingTyped(src);

  // The bare query: every cheap source at once, each with its own matcher, and
  // this module's one real decision on top — the order between them.
  const groups = keep(
    files(term, src, line, MIXED),
    symbols(term, src, MIXED),
    commands(term, src, MIXED),
    chats(term, src, MIXED),
    sessions(term, src, MIXED),
    settings(term, src, MIXED),
  );
  return order(groups, term, startsACommand(term, src));
}
