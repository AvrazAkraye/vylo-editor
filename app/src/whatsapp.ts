/**
 * Reading and sending WhatsApp, through an Evolution API instance.
 *
 * Everything here is arithmetic over what the server returns: no network, no
 * DOM, so the awkward parts can be tested. `WhatsAppPanel.tsx` does the
 * fetching and the drawing.
 *
 * ## The server cannot give us a chat list
 *
 * This instance runs with `DATABASE_SAVE_DATA_CHATS`, `…CONTACTS` and
 * `…HISTORIC` all off, and only `…NEW_MESSAGE` on. So there is no chats table
 * to ask for and no contact names to look up — there are only the messages
 * that have arrived since the instance connected.
 *
 * `chatsFrom` therefore builds the list itself, by grouping messages on the
 * conversation they belong to. The alternative was turning those flags on,
 * which means restarting a stack the OTP product runs on, and syncing a
 * business number's whole history into Postgres to populate a personal inbox.
 * Deriving it costs nothing and degrades honestly: a conversation appears as
 * soon as it has said anything.
 *
 * ## And it cannot tell us what we have read
 *
 * Read state lives in the chats table that is not being written. Rather than
 * show an unread count that is wrong, the app remembers when each conversation
 * was last looked at and counts what has come in since — see `seen` in
 * `chatsFrom`. It is honest about what it knows: "new since you last looked"
 * is a claim this side can actually make.
 *
 * ## The key
 *
 * `Conn` keeps the address and the key together for the same reason
 * `providers.ts` does, and its rule holds here word for word: **a key is only
 * ever sent to the URL it was entered beside.** There is no path that takes
 * one instance's key and another's address.
 */

export interface Conn {
  /** Where the Evolution API is, without a trailing slash. */
  baseUrl: string;
  /** The instance name, which is part of nearly every path. */
  instance: string;
  /** The `apikey` header. Sent only to `baseUrl`. */
  key: string;
}

export const BLANK: Conn = { baseUrl: 'https://wa.vylo-tech.com', instance: '', key: '' };

/** Where the connection is kept. Versioned, like every other stored setting. */
export const KEY = 'vylo.whatsapp.v1';

const trim = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/**
 * A stored connection, repaired.
 *
 * A bad one is the empty form, never a throw: this runs before the first
 * paint, and a panel that will not open is worse than a panel asking to be
 * set up again.
 */
export function read(raw: string | null): Conn {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return { ...BLANK };
    const o = v as Record<string, unknown>;
    return {
      baseUrl: trim(o.baseUrl).replace(/\/+$/, '') || BLANK.baseUrl,
      instance: trim(o.instance),
      key: trim(o.key),
    };
  } catch {
    return { ...BLANK };
  }
}

export const write = (c: Conn): string => JSON.stringify(c);

/** Whether there is enough to try a call at all. */
export const ready = (c: Conn): boolean =>
  Boolean(c.baseUrl && c.instance && c.key);

/* ── who a message is with ───────────────────────────────────────────────
   WhatsApp addresses are `<number>@s.whatsapp.net` for a person and
   `<id>@g.us` for a group. The suffix is the only thing that tells them
   apart, and the difference matters: a group message has a *participant* as
   well as a conversation, so "who said this" and "where was it said" are two
   questions rather than one. */

export const isGroup = (jid: string): boolean => jid.endsWith('@g.us');

/** A phone number as WhatsApp addresses it. Digits only; `+` and spacing go. */
export function jidOf(phone: string): string {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

/** The number out of an address, or '' for a group, which has none. */
export function phoneOf(jid: string): string {
  const at = String(jid || '').indexOf('@');
  if (at < 0 || isGroup(jid)) return '';
  // A JID can carry a device suffix — `9647…:12@s.whatsapp.net`.
  return jid.slice(0, at).split(':')[0].replace(/[^\d]/g, '');
}

export type Kind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';

export interface Msg {
  id: string;
  /** The conversation: a person's JID, or a group's. */
  jid: string;
  fromMe: boolean;
  /** Milliseconds, because the rest of this app counts in them. */
  at: number;
  text: string;
  kind: Kind;
  /** The display name the sender publishes, when there is one. */
  who: string;
}

/** Which envelope carries the words, per message type. */
const TEXT_AT: Array<[string, string]> = [
  ['conversation', ''],
  ['extendedTextMessage', 'text'],
  ['imageMessage', 'caption'],
  ['videoMessage', 'caption'],
  ['documentMessage', 'caption'],
  ['documentWithCaptionMessage', 'caption'],
];

const KIND_OF: Record<string, Kind> = {
  conversation: 'text',
  extendedTextMessage: 'text',
  imageMessage: 'image',
  videoMessage: 'video',
  audioMessage: 'audio',
  documentMessage: 'document',
  documentWithCaptionMessage: 'document',
  stickerMessage: 'sticker',
};

function bodyOf(message: Record<string, unknown>): { text: string; kind: Kind } {
  for (const [key, field] of TEXT_AT) {
    const v = message[key];
    if (typeof v === 'string' && field === '') return { text: v, kind: 'text' };
    if (v && typeof v === 'object') {
      const inner = (v as Record<string, unknown>)[field];
      if (typeof inner === 'string' && inner.trim()) {
        return { text: inner, kind: KIND_OF[key] ?? 'other' };
      }
    }
  }
  // Something with no words in it. The kind is still worth knowing, because
  // "[image]" in the list is information and a blank line is not.
  for (const key of Object.keys(message)) {
    if (KIND_OF[key]) return { text: '', kind: KIND_OF[key] };
  }
  return { text: '', kind: 'other' };
}

/**
 * One record from `findMessages`, as this app wants it.
 *
 * Returns null for anything without a conversation to belong to. Evolution
 * stores protocol traffic — receipts, key exchanges — beside real messages,
 * and a chat list with those in it is a chat list nobody can read.
 */
export function normalise(raw: unknown): Msg | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const key = (r.key && typeof r.key === 'object' ? r.key : {}) as Record<string, unknown>;
  const jid = trim(key.remoteJid);
  if (!jid || !jid.includes('@')) return null;
  // Status broadcasts are not a conversation with anybody.
  if (jid.startsWith('status@')) return null;

  const message = (r.message && typeof r.message === 'object'
    ? r.message : {}) as Record<string, unknown>;
  const { text, kind } = bodyOf(message);

  // Seconds from the wire; this app counts in milliseconds. A string is
  // allowed because Evolution has sent both.
  const stamp = Number(r.messageTimestamp);
  const at = Number.isFinite(stamp) && stamp > 0 ? stamp * 1000 : 0;

  return {
    id: trim(r.id) || trim(key.id),
    jid,
    fromMe: key.fromMe === true,
    at,
    text,
    kind,
    who: trim(r.pushName),
  };
}

/** Every usable message out of a `findMessages` body, oldest first. */
export function messagesFrom(body: unknown): Msg[] {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const box = (b.messages && typeof b.messages === 'object'
    ? b.messages : b) as Record<string, unknown>;
  const rows = Array.isArray(box.records) ? box.records
    : Array.isArray(b.messages) ? (b.messages as unknown[])
    : Array.isArray(body) ? (body as unknown[])
    : [];
  const out: Msg[] = [];
  for (const row of rows) {
    const m = normalise(row);
    if (m) out.push(m);
  }
  return out.sort((a, b2) => a.at - b2.at);
}

export interface Chat {
  jid: string;
  /** A published name if anybody has sent one, else the number. */
  name: string;
  group: boolean;
  /** The last thing said, for the second line of the row. */
  last: string;
  lastKind: Kind;
  lastFromMe: boolean;
  at: number;
  /** Incoming since this conversation was last looked at. */
  unread: number;
}

/**
 * The chat list, built from the messages themselves.
 *
 * `seen` maps a conversation to when it was last read, in milliseconds. It is
 * the app's own record: the server is not storing chats, so it cannot answer
 * this, and a count taken from nothing would be a number that is simply wrong.
 *
 * A group takes its name from nothing here — the group subject lives in the
 * chats table that is not being written — so it shows as its id until
 * somebody teaches it otherwise. Saying the id is worse than saying a name
 * and better than saying a name that is a guess.
 */
export function chatsFrom(msgs: readonly Msg[], seen: Record<string, number> = {}): Chat[] {
  const by = new Map<string, Chat>();
  for (const m of msgs) {
    const at = seen[m.jid] ?? 0;
    const cur = by.get(m.jid);
    const unread = (cur?.unread ?? 0) + (!m.fromMe && m.at > at ? 1 : 0);
    // Messages arrive oldest first, so a later one is always the newer — but
    // the guard costs nothing and an unsorted caller is not a corrupt list.
    if (!cur || m.at >= cur.at) {
      by.set(m.jid, {
        jid: m.jid,
        name: (!m.fromMe && m.who) || cur?.name || phoneOf(m.jid) || m.jid,
        group: isGroup(m.jid),
        last: m.text,
        lastKind: m.kind,
        lastFromMe: m.fromMe,
        at: m.at,
        unread,
      });
    } else {
      by.set(m.jid, { ...cur, unread, name: cur.name || (!m.fromMe && m.who) || cur.name });
    }
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}

/** The messages of one conversation, oldest first. */
export const inChat = (msgs: readonly Msg[], jid: string): Msg[] =>
  msgs.filter((m) => m.jid === jid);
