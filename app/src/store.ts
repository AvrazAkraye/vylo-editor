import type { Block, Msg } from './agent';

/**
 * Conversation memory.
 *
 * Kept per folder, because a conversation is about a codebase: reopening a
 * project should bring back what you were doing in it, and opening a different
 * one should not drag the last project's context along.
 *
 * Images are dropped when saving. A screenshot is usually one-shot context —
 * "what is wrong here?" — and a few of them are megabytes of base64 that would
 * blow localStorage's quota within a session or two. The turn is kept with a
 * marker in place of the bytes, so the transcript still reads correctly and the
 * model still knows an image was discussed.
 */

export interface Line {
  kind: 'you' | 'text' | 'tool' | 'result' | 'error';
  text: string;
  at?: number;
}

export interface Saved {
  folder: string;
  updatedAt: number;
  lines: Line[];
  history: Msg[];
}

const KEY = 'vylo.chats';
const MAX_FOLDERS = 12;
/** Well under the ~5 MB localStorage quota, leaving room for settings. */
const MAX_BYTES = 2_500_000;

type All = Record<string, Saved>;

function readAll(): All {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as All;
  } catch {
    return {};
  }
}

/** Replace image payloads with a marker; everything else passes through. */
function stripImages(history: Msg[]): Msg[] {
  return history.map((m) => {
    if (typeof m.content === 'string') return m;
    const content = m.content.map((b): Block => {
      if (b.type === 'image') return { type: 'text', text: '[an image was attached here]' };
      return b;
    });
    return { ...m, content };
  });
}

export function save(folder: string, lines: Line[], history: Msg[]): void {
  if (!folder) return;
  const all = readAll();
  all[folder] = { folder, updatedAt: Date.now(), lines, history: stripImages(history) };

  // Newest folders win when trimming: an old project you have not opened in
  // weeks is the cheapest thing to forget.
  let entries = Object.values(all).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_FOLDERS);

  let payload = JSON.stringify(Object.fromEntries(entries.map((e) => [e.folder, e])));
  while (payload.length > MAX_BYTES && entries.length > 1) {
    entries = entries.slice(0, -1);
    payload = JSON.stringify(Object.fromEntries(entries.map((e) => [e.folder, e])));
  }
  // If ONE conversation is still too big, trim its own oldest turns rather than
  // dropping it — losing the thread you are in is worse than losing its start.
  while (payload.length > MAX_BYTES && entries[0] && entries[0].lines.length > 6) {
    entries[0] = {
      ...entries[0],
      lines: entries[0].lines.slice(-40),
      history: entries[0].history.slice(-12),
    };
    payload = JSON.stringify(Object.fromEntries(entries.map((e) => [e.folder, e])));
  }

  try {
    localStorage.setItem(KEY, payload);
  } catch {
    // Quota still exceeded, or storage disabled. Losing history is a nuisance;
    // an exception mid-conversation would be worse.
  }
}

export function load(folder: string): Saved | null {
  return readAll()[folder] ?? null;
}

export function forget(folder: string): void {
  const all = readAll();
  delete all[folder];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* nothing to do */ }
}

/** Recent folders, newest first, for the switcher. */
export function recent(): { folder: string; name: string; updatedAt: number; turns: number }[] {
  return Object.values(readAll())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((s) => ({
      folder: s.folder,
      name: s.folder.split(/[/\\]/).filter(Boolean).pop() || s.folder,
      updatedAt: s.updatedAt,
      turns: s.lines.filter((l) => l.kind === 'you').length,
    }));
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
