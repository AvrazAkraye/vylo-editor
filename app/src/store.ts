import type { Block, Msg } from './agent';
import { positions, rank } from './fuzzy';

/**
 * Saved chats.
 *
 * Several per folder, not one. A project accumulates separate threads — "why is
 * this slow", "add the export button" — and collapsing them into a single
 * rolling transcript means every new question drags along context that has
 * nothing to do with it, which costs tokens and confuses the model.
 *
 * Images are dropped when saving. A screenshot is one-shot context and a few of
 * them are megabytes of base64 that would exhaust the storage quota within a
 * session; the turn is kept with a marker so the transcript still reads and the
 * model still knows an image was discussed.
 */

export interface Line {
  kind: 'you' | 'text' | 'tool' | 'result' | 'error';
  text: string;
  at?: number;
  /**
   * Set on the line reporting an approved write, so that turn can be undone.
   * `hist` is how long the conversation was before the write, which is where
   * restoring truncates it back to.
   */
  cp?: { seq: number; hist: number };
  /**
   * Set on the error line of a turn that failed for a reason worth trying
   * again. Cleared when a new turn starts, so only the most recent failure
   * offers the button — an old one would re-run a question two answers back.
   */
  retry?: boolean;
}

export interface Chat {
  id: string;
  folder: string;
  title: string;
  updatedAt: number;
  lines: Line[];
  history: Msg[];
  /** Tokens this conversation has used, summed over its turns. */
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  /**
   * True once a person has named this chat themselves.
   *
   * Records already on disk do not have it, and the absence is correct rather
   * than unknown: before there was a rename, every title was generated.
   */
  named?: boolean;
}

const KEY = 'vylo.chats.v2';
const LEGACY = 'vylo.chats';
const MAX_CHATS = 40;
/** Well under the ~5 MB quota, leaving room for settings. */
const MAX_BYTES = 3_000_000;

type All = Record<string, Chat>;

export const newChatId = (): string =>
  `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

function readAll(): All {
  try {
    const v2 = localStorage.getItem(KEY);
    if (v2) return JSON.parse(v2) as All;
  } catch { /* fall through to the migration */ }

  // One-time migration: v1 kept a single thread per folder. Carry it over as
  // that folder's first chat rather than dropping someone's history.
  try {
    const old = JSON.parse(localStorage.getItem(LEGACY) || '{}') as Record<
      string, { folder: string; updatedAt: number; lines: Line[]; history: Msg[] }
    >;
    const out: All = {};
    for (const s of Object.values(old)) {
      const id = newChatId();
      out[id] = { id, folder: s.folder, title: titleFrom(s.lines), updatedAt: s.updatedAt, lines: s.lines, history: s.history };
    }
    if (Object.keys(out).length) {
      localStorage.setItem(KEY, JSON.stringify(out));
      localStorage.removeItem(LEGACY);
    }
    return out;
  } catch {
    return {};
  }
}

/** A chat's name is its opening question, which is what people recognise it by. */
export function titleFrom(lines: Line[]): string {
  const first = lines.find((l) => l.kind === 'you')?.text.trim();
  if (!first) return 'New chat';
  const oneLine = first.replace(/\s+/g, ' ');
  return oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine;
}

function stripImages(history: Msg[]): Msg[] {
  return history.map((m) => {
    if (typeof m.content === 'string') return m;
    return {
      ...m,
      content: m.content.map((b): Block =>
        b.type === 'image' ? { type: 'text', text: '[an image was attached here]' } : b),
    };
  });
}

function persist(all: All): void {
  let entries = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS);
  const pack = () => JSON.stringify(Object.fromEntries(entries.map((c) => [c.id, c])));

  let payload = pack();
  // Oldest chats go first: a thread untouched for weeks is the cheapest thing
  // to forget. Only then trim the newest chat's own oldest turns, because
  // losing the thread you are in is worse than losing its beginning.
  while (payload.length > MAX_BYTES && entries.length > 1) {
    entries = entries.slice(0, -1);
    payload = pack();
  }
  while (payload.length > MAX_BYTES && entries[0] && entries[0].lines.length > 6) {
    entries[0] = { ...entries[0], lines: entries[0].lines.slice(-40), history: entries[0].history.slice(-12) };
    payload = pack();
  }
  try { localStorage.setItem(KEY, payload); } catch { /* quota or storage disabled */ }
}

export function saveChat(chat: Chat): void {
  if (!chat.folder) return;
  const all = readAll();
  // A name a person typed outlives the generated one. The caller re-saves the
  // whole thread after every turn and passes `titleFrom(lines)` as its title,
  // so without this the very next reply would quietly undo the rename.
  const stored = all[chat.id];
  const named = stored?.named || chat.named;
  all[chat.id] = {
    ...chat,
    named,
    title: named
      ? stored?.title ?? chat.title
      : chat.title === 'New chat' ? titleFrom(chat.lines) : chat.title,
    updatedAt: Date.now(),
    history: stripImages(chat.history),
  };
  persist(all);
}

export function loadChat(id: string): Chat | null {
  return readAll()[id] ?? null;
}

export function deleteChat(id: string): void {
  const all = readAll();
  delete all[id];
  persist(all);
}

/** Chats for one folder, newest first. */
export function chatsIn(folder: string): Chat[] {
  return Object.values(readAll())
    .filter((c) => c.folder === folder)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Folders that have any saved chat, newest activity first. */
export function folders(): { folder: string; name: string; updatedAt: number; chats: number }[] {
  const byFolder = new Map<string, { updatedAt: number; chats: number }>();
  for (const c of Object.values(readAll())) {
    const cur = byFolder.get(c.folder);
    byFolder.set(c.folder, {
      updatedAt: Math.max(cur?.updatedAt ?? 0, c.updatedAt),
      chats: (cur?.chats ?? 0) + 1,
    });
  }
  return [...byFolder.entries()]
    .map(([folder, v]) => ({
      folder,
      name: folder.split(/[/\\]/).filter(Boolean).pop() || folder,
      ...v,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Managing what has accumulated
 *
 * A chat list that only grows is write-only: a name the app invented, no way
 * to correct it, and nothing to do with a thread afterwards but open it or
 * lose it. The four functions below are the record made usable — rename,
 * delete (which was already here), search, and one chat written out as a
 * document.
 *
 * All of them except `renameChat` are pure functions over a `Chat`, which is
 * why they are here rather than in the component: the awkward cases — an empty
 * name, a query that matches nothing, a thread with no lines at all — are the
 * reason to write them down, and none of them are reachable through a React
 * tree.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The most a person may name a chat.
 *
 * Generated titles are cut to 48; a typed one is allowed more, because someone
 * who writes "the export button, second attempt" meant all of it. It is bounded
 * at all because every chat shares one localStorage quota with every other, and
 * the title is the one field copied into every list that draws them.
 */
export const MAX_TITLE = 120;

/** How much of a matching line is kept as the line shown under a search hit. */
export const MAX_SNIPPET = 160;

/**
 * A name a person typed, or `null` when there is nothing there.
 *
 * Whitespace-only collapses to `null` rather than `''` so a caller has one
 * thing to test. The empty name is refused rather than accepted, because the
 * generated title is overwritten by the rename and nothing can recover it — a
 * chat called nothing is unfindable in a list of chats, and the app has no
 * second place to look it up.
 */
export function cleanTitle(raw: string): string | null {
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  if (!oneLine) return null;
  return oneLine.length > MAX_TITLE ? `${oneLine.slice(0, MAX_TITLE - 1)}…` : oneLine;
}

/**
 * Rename a saved chat. `false` when the name was empty or the chat is gone.
 *
 * `updatedAt` is deliberately left where it was. The list is ordered by it, so
 * bumping it would jump the row to the top the instant a rename was committed —
 * moving the thing the person was just typing into out from under them. A
 * rename is not activity in the conversation.
 */
export function renameChat(id: string, raw: string): boolean {
  const title = cleanTitle(raw);
  if (!title) return false;
  const all = readAll();
  const chat = all[id];
  if (!chat) return false;
  all[id] = { ...chat, title, named: true };
  persist(all);
  return true;
}

/** One chat a search matched, with the line that matched when it was not the name. */
export interface ChatHit {
  chat: Chat;
  /** The matching line, cut around the match. Absent when the title matched. */
  snippet?: string;
}

/**
 * Chats matching `query`, best first.
 *
 * Ranked by `rank()` from `fuzzy.ts` — the same matcher behind ⌘P and ⌘T — so
 * this is the third surface with one behaviour rather than a third behaviour.
 * Two decisions are worth writing down:
 *
 * A name match always outranks a body match, however good the body match is.
 * The title is what a person called the thread, or what its opening question
 * was; a phrase found in the middle of a reply is a weaker claim on "this is
 * the one I meant", and mixing the two orderings makes the list feel arbitrary.
 *
 * Message text is matched *whole*, not truncated first. A fuzzy match over a
 * long line is loose — that is the price of subsequence matching and it is the
 * same price ⌘P pays over a large tree — but a search that cannot find a phrase
 * because it happened to be the two-hundredth character is broken in the way
 * that matters most: you remember what you read, never where it sat. Cost is
 * bounded by the store itself, which is capped at MAX_BYTES.
 */
export function searchChats(query: string, chats: Chat[]): ChatHit[] {
  const q = query.trim();
  if (!q) return chats.map((chat) => ({ chat }));

  const byName = rank(q, chats, (c) => c.title, chats.length);
  const placed = new Set(byName.map((c) => c.id));
  const hits: ChatHit[] = byName.map((chat) => ({ chat }));

  // One candidate per line of text rather than one per chat. A whole transcript
  // as a single string is a subsequence of nothing useful — every query would
  // match every chat — and it would leave nothing to show as the reason a chat
  // came back.
  const parts: { chat: Chat; text: string }[] = [];
  for (const chat of chats) {
    if (placed.has(chat.id)) continue;
    for (const line of chat.lines) {
      for (const piece of line.text.split('\n')) {
        const one = piece.replace(/\s+/g, ' ').trim();
        if (one) parts.push({ chat, text: one });
      }
    }
  }

  for (const part of rank(q, parts, (p) => p.text, parts.length)) {
    if (placed.has(part.chat.id)) continue;
    placed.add(part.chat.id);
    hits.push({ chat: part.chat, snippet: around(part.text, q) });
  }
  return hits;
}

/** A window of `text` containing the match, so the reason for the hit is visible. */
function around(text: string, query: string): string {
  if (text.length <= MAX_SNIPPET) return text;
  // The literal position first, and the fuzzy one only as a fallback. A
  // subsequence match is spread across the whole line — its first character is
  // usually in the first word — so centring on it would show the beginning of
  // the paragraph and call it the match. Most queries are a phrase that is
  // really there, and for those this puts the phrase on screen.
  const literal = text.toLowerCase().indexOf(query.toLowerCase());
  const first = literal >= 0 ? literal : positions(query, text)[0] ?? 0;
  // A little context before the match, so the snippet does not start mid-word
  // on the matched character itself.
  const from = Math.max(0, Math.min(first - 24, text.length - MAX_SNIPPET));
  const cut = text.slice(from, from + MAX_SNIPPET);
  return `${from > 0 ? '…' : ''}${cut}${from + MAX_SNIPPET < text.length ? '…' : ''}`;
}

/**
 * A tool line as the agent records it: `read_file({"path":"src/App.tsx"})`.
 *
 * The transcript keeps the call as text because that is what is drawn on
 * screen, so reading it back is a parse. A line that does not have this shape
 * — an MCP tool, or a future one — comes back `null` and is reported as itself
 * rather than guessed at.
 */
function toolCall(text: string): { name: string; input: Record<string, unknown> } | null {
  const open = text.indexOf('(');
  if (open <= 0 || !text.endsWith(')')) return null;
  const name = text.slice(0, open);
  if (!/^[A-Za-z0-9_.:-]+$/.test(name)) return null;
  try {
    const input: unknown = JSON.parse(text.slice(open + 1, -1));
    return { name, input: input && typeof input === 'object' ? input as Record<string, unknown> : {} };
  } catch {
    // A tool called with arguments this cannot parse is still a tool that was
    // called, and saying so is better than dropping the line from the record.
    return { name, input: {} };
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A tool call as a sentence. The export is a document, not a log. */
function toolProse(text: string): string {
  const call = toolCall(text);
  if (!call) return text;
  const { name, input } = call;
  const path = str(input.path);
  switch (name) {
    case 'list_tree': return 'Listed the project tree';
    case 'read_file': return path ? `Read \`${path}\`` : 'Read a file';
    case 'find_symbol': return `Looked up \`${str(input.name)}\``;
    case 'search': return `Searched for \`${str(input.query)}\``;
    case 'write_file': return path ? `Proposed the contents of \`${path}\`` : 'Proposed a file';
    case 'edit_file': return path ? `Proposed an edit to \`${path}\`` : 'Proposed an edit';
    case 'run_command': return `Ran \`${str(input.command)}\``;
    case 'remember': return 'Proposed a note for the project memory';
    default: return `Called \`${name}\``;
  }
}

/**
 * The files an approved write actually put on disk, in the order they landed.
 *
 * Read out of the reporting line's own text, because that is the only place the
 * names are: `cp` marks the line as an approved write but says nothing about
 * what it touched, and the `write_file` tool calls above it include proposals
 * that were never approved. The wording belongs to App.tsx and is pinned by a
 * test here, so the two move together.
 */
export function filesWritten(lines: Line[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind !== 'result') continue;
    const whole = /^Wrote \d+ files?: (.+)$/.exec(line.text);
    const part = /^Wrote part of (.+)\.$/.exec(line.text);
    for (const name of whole ? whole[1].split(', ') : part ? [part[1]] : []) {
      const trimmed = name.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/**
 * The commands that ran, in order.
 *
 * Every one of these was shown to a person and approved by its exact string
 * before it ran, which is what makes "ran" true rather than "was asked for".
 */
export function commandsRun(lines: Line[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.kind !== 'tool') continue;
    const call = toolCall(line.text);
    const command = call?.name === 'run_command' ? str(call.input.command).trim() : '';
    if (command && !out.includes(command)) out.push(command);
  }
  return out;
}

const two = (n: number): string => String(n).padStart(2, '0');

/** Local time, because the person reading this back worked in it. */
function stamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * One chat as a markdown document.
 *
 * What someone wants out of a chat is the record of a working session — what
 * they asked, what came back, what it changed and what it ran — so this is
 * written as prose with headings, not as a dump of the transcript's internals.
 * Three things follow from that:
 *
 * - The two summaries come first. "Which files did that session touch" is the
 *   question this document exists to answer, and it should not need reading to
 *   the end.
 * - Tool calls become sentences. `read_file({"path":"src/App.tsx"})` is the
 *   shape the line is stored in, not something to put in front of a reader.
 * - A run of replies is one heading, not one per streamed fragment. The
 *   transcript splits a turn wherever a tool call interrupted it, and those
 *   splits mean nothing to anybody afterwards.
 *
 * Deliberately English. The body is the conversation in whatever language it
 * was held, with paths, commands and tool names through it, and translated
 * headings around an untranslated technical record read worse than one
 * consistent language.
 */
export function exportMarkdown(chat: Chat): string {
  const asked = chat.lines.filter((l) => l.kind === 'you').length;
  const out: string[] = [
    `# ${chat.title}`,
    '',
    `- **Project** \`${chat.folder}\``,
    `- **Last active** ${stamp(chat.updatedAt)}`,
    `- **Questions** ${asked}`,
  ];
  const tk = chat.tokens;
  if (tk && (tk.input || tk.output)) {
    out.push(`- **Tokens** ${tk.input.toLocaleString('en')} in · ${tk.output.toLocaleString('en')} out`);
  }

  const files = filesWritten(chat.lines);
  if (files.length) {
    out.push('', '## Files changed', '');
    for (const f of files) out.push(`- \`${f}\``);
  }

  const commands = commandsRun(chat.lines);
  if (commands.length) {
    out.push('', '## Commands run', '');
    for (const c of commands) out.push(`- \`${c}\``);
  }

  out.push('', '## The conversation', '');
  if (!chat.lines.length) {
    out.push('Nothing was said in this conversation.');
  }

  let speaker = '';
  for (const line of chat.lines) {
    const who = line.kind === 'you' ? 'You' : 'Vylo';
    if (who !== speaker) {
      out.push(`### ${who}`, '');
      speaker = who;
    }
    if (line.kind === 'you' || line.kind === 'text') out.push(line.text, '');
    else if (line.kind === 'tool') out.push(`*${toolProse(line.text)}*`, '');
    else if (line.kind === 'error') out.push(`**Failed:** ${line.text}`, '');
    // A tool's own result is `name → the first 160 characters`, written for the
    // model and truncated for the request. It is noise in a document a person
    // reads; the lines the app itself pushed — what was written, what was
    // restored, that a turn was stopped — are the record and are kept.
    else if (!/^[A-Za-z0-9_.:-]+ → /.test(line.text)) out.push(`*${line.text}*`, '');
  }

  out.push('---', '', 'Exported from Vylo Editor.', '');
  return out.join('\n');
}

/**
 * A file name to offer in the save dialog.
 *
 * Letters and digits of any script survive, so a chat named in Arabic or
 * Kurdish keeps its name instead of coming out as `chat.md`. Everything else
 * becomes a hyphen, which also removes every character a file system objects
 * to without needing a list of them.
 */
export function exportFileName(chat: Chat): string {
  const slug = chat.title
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
    .toLowerCase();
  return `${slug || 'chat'}.md`;
}
