import type { Block, Msg } from './agent';

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
  all[chat.id] = {
    ...chat,
    title: chat.title === 'New chat' ? titleFrom(chat.lines) : chat.title,
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
