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

/**
 * Whether this address is an ordinary phone number.
 *
 * `@g.us` is a group and was always handled. The one that was not is `@lid` —
 * WhatsApp's privacy-mode identity, which is a long run of digits that is *not*
 * a phone number and never was. Everything here treated "not a group" as "a
 * person with a number", so a `@lid` was drawn in the conversation header as
 * `+121298634178579`: a plus sign, fifteen digits, and a number nobody can
 * ring. Inventing a phone number for somebody is worse than showing nothing,
 * and the same string was going into the tool's approval dialog as the
 * recipient of a message.
 *
 * `@broadcast` and `@newsletter` are not numbers either, so the test names what
 * a number *is* rather than what it is not.
 */
export const isPhone = (jid: string): boolean =>
  /@(s\.whatsapp\.net|c\.us)$/i.test(String(jid || ''));

/** A phone number as WhatsApp addresses it. Digits only; `+` and spacing go. */
export function jidOf(phone: string): string {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return digits ? `${digits}@s.whatsapp.net` : '';
}

/**
 * The number out of an address, or '' when the address is not a number.
 *
 * Empty for a group, and empty for a `@lid` or a broadcast — see `isPhone`.
 * Callers that need *something* to address or to name a conversation by fall
 * back to the jid itself, which is at least true.
 */
export function phoneOf(jid: string): string {
  const at = String(jid || '').indexOf('@');
  if (at < 0 || !isPhone(jid)) return '';
  // A JID can carry a device suffix — `9647…:12@s.whatsapp.net`.
  return jid.slice(0, at).split(':')[0].replace(/[^\d]/g, '');
}

export type Kind = 'text' | 'image' | 'video' | 'audio' | 'document' | 'sticker' | 'other';

export interface Msg {
  id: string;
  /**
   * The id WhatsApp itself gave the message, out of `key.id`.
   *
   * Kept apart from `id` because they are two different identifiers and only
   * one of them works: `id` is Evolution's own row id, which is what comes back
   * on most records and what `normalise` prefers for a React key, while
   * `/chat/getBase64FromMediaMessage` is asking which *message on WhatsApp* to
   * fetch and accepts nothing else. Folding them together downloads nothing and
   * reports the media missing.
   */
  keyId: string;
  /** The conversation: a person's JID, or a group's. */
  jid: string;
  fromMe: boolean;
  /** Milliseconds, because the rest of this app counts in them. */
  at: number;
  text: string;
  kind: Kind;
  /** The display name the sender publishes, when there is one. */
  who: string;
  /**
   * How far an outgoing message got. Empty on anything incoming, and on
   * anything the server did not say — a tick that is guessed is worse than no
   * tick, because the whole point of the mark is that it is evidence.
   */
  status: Status;
  /** The message this one was a reply to, when it was one. */
  quoted: Quoted | null;
}

/**
 * How far a message of ours got: accepted by the server, delivered to the
 * phone, read by the person. `''` is "the server did not say".
 *
 * `PLAYED` — a voice note listened to — is folded into `read`, because the
 * distinction is one WhatsApp itself draws only for audio and the row has one
 * mark to draw either way.
 */
export type Status = '' | 'pending' | 'sent' | 'delivered' | 'read';

/**
 * Evolution reports this as a word on some records and a number on others,
 * and the numbers are the protocol's own. Both are read; anything else is
 * `''`, which draws nothing.
 */
const STATUS_OF: Record<string, Status> = {
  PENDING: 'pending', SERVER_ACK: 'sent', DELIVERY_ACK: 'delivered',
  READ: 'read', PLAYED: 'read', ERROR: '',
  '1': 'pending', '2': 'sent', '3': 'delivered', '4': 'read', '5': 'read', '0': '',
};

/** How far along each one is, so the furthest can be picked out of a bag. */
const RANK: Record<Status, number> = { '': 0, pending: 1, sent: 2, delivered: 3, read: 4 };

/**
 * How far a message of ours got, out of wherever this server keeps it.
 *
 * `status` on the record is the documented place and is null on every record
 * this instance returns. What it has instead is `MessageUpdate`, an array of
 * every acknowledgement that has arrived — and **it is not in order**. A real
 * one reads
 *
 *   [READ, SERVER_ACK, ERROR, DELIVERY_ACK, DELIVERY_ACK]
 *
 * so taking the last element reports a delivery for a message that has been
 * read, and taking the first reports a read for one that errored on a second
 * device. Neither is a timeline; it is a bag of things that happened.
 *
 * So the *furthest* is taken, by rank. A message cannot un-deliver, and an
 * ERROR beside three acknowledgements means one of several devices refused
 * it, not that it failed — it ranks zero and loses to anything real.
 *
 * Both places are read, because the documented one is right on other versions
 * and this costs one field lookup.
 */
function statusOf(r: Record<string, unknown>): Status {
  let best: Status = '';
  const saw = (v: unknown) => {
    const s = STATUS_OF[trim(v) || String(v ?? '')] ?? '';
    if (RANK[s] > RANK[best]) best = s;
  };
  saw(r.status);
  if (Array.isArray(r.MessageUpdate)) {
    for (const u of r.MessageUpdate) {
      if (u && typeof u === 'object') saw((u as Record<string, unknown>).status);
    }
  }
  return best;
}

/**
 * The message a reply was to, as much of it as travelled with the reply.
 *
 * WhatsApp sends the quoted message *inside* the reply rather than a pointer
 * to it, which is why this can be drawn without having the original in the
 * thread — a reply to something said last year still shows what it answered.
 */
export interface Quoted {
  /** `stanzaId`: the quoted message's own WhatsApp id, for jumping to it. */
  id: string;
  /** Who said it, when the envelope names them. A group names a participant. */
  who: string;
  text: string;
  kind: Kind;
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

/**
 * The reply context hanging off whichever envelope carries this message.
 *
 * `contextInfo` rides on the envelope rather than on the record, and every
 * kind of message can carry one — a photo can be a reply as easily as a line
 * of text — so every envelope is looked in rather than just the text ones.
 *
 * A `contextInfo` with no `quotedMessage` is the common case and is not a
 * reply: it is where mentions and forwarding scores live too.
 */
function quotedOf(r: Record<string, unknown>, message: Record<string, unknown>): Quoted | null {
  // Two places, because this instance uses the first and the protocol's own
  // shape — which other Evolution versions store — is the second. Reading
  // only the envelope found nothing at all here: every reply on this server
  // hangs its context off the *record*, and the envelope's `contextInfo` is
  // where mentions and the ephemeral timer live.
  const places: unknown[] = [
    r.contextInfo,
    ...Object.values(message).map((v) => (v && typeof v === 'object'
      ? (v as Record<string, unknown>).contextInfo : null)),
  ];
  for (const ctx of places) {
    if (!ctx || typeof ctx !== 'object') continue;
    const c = ctx as Record<string, unknown>;
    const inner = c.quotedMessage;
    // A `contextInfo` with no `quotedMessage` is the common case and is not a
    // reply: nearly every record here has one, carrying `mentionedJid` and
    // the disappearing-message settings.
    if (!inner || typeof inner !== 'object') continue;
    const { text, kind } = bodyOf(inner as Record<string, unknown>);
    return {
      id: trim(c.stanzaId),
      // `participant` is a jid, so it names the person only in the sense that
      // a number does. It is what there is: the push name of somebody else's
      // old message does not travel with the quote.
      who: phoneOf(trim(c.participant)),
      text,
      kind,
    };
  }
  return null;
}

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
    keyId: trim(key.id),
    jid,
    fromMe: key.fromMe === true,
    at,
    text,
    kind,
    who: trim(r.pushName),
    // Only ours has a status worth drawing: the ticks on an incoming message
    // are the *sender's* evidence, not ours, and we are not the sender.
    status: key.fromMe === true ? statusOf(r) : '',
    quoted: quotedOf(r, message),
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

/* ── a conversation as rows ──────────────────────────────────────────────
   A thread is not a list of messages, it is a list of *runs*: a day marker,
   then a burst from one person, then a burst from the other. Drawing every
   message as an identical block is what made the panel read as a log file —
   ten "Your verification code is …" lines with nothing to say that they came
   an hour apart, from the same sender, on two different days.

   The split is arithmetic over the timestamps, so it is decided here rather
   than in the component, and `test/whatsapp.test.mjs` can hold it. */

/** A local calendar day, as a key that sorts and compares. */
export function dayOf(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Today, yesterday, or neither — as a token, not a sentence.
 *
 * The words are in the catalogue and the component looks them up; a function
 * that returns "Yesterday" returns it in English for ever.
 */
export function relDay(at: number, now: number = Date.now()): 'today' | 'yesterday' | null {
  const day = dayOf(at);
  if (day === dayOf(now)) return 'today';
  if (day === dayOf(now - 86400000)) return 'yesterday';
  return null;
}

/**
 * How long a silence has to be before the next message starts a new run.
 *
 * Five minutes: long enough that two lines typed in one breath stay together,
 * short enough that a reply an hour later is visibly a reply.
 */
export const GROUP_GAP = 5 * 60 * 1000;

export type Row =
  | { kind: 'day'; at: number; key: string }
  /**
   * The line that says "everything below here arrived since you last looked".
   *
   * Only ever one, and only when there is something above it — a divider at
   * the very top of a thread separates nothing from everything, which is a
   * line that means "this conversation is new" dressed up as one that means
   * "you have missed something".
   */
  | { kind: 'new'; at: number }
  /**
   * `head` is the first message of a run and `tail` the last. A run of one is
   * both. The component hangs everything on these two: the sender's name goes
   * on the head, the time and the corner go on the tail, and the messages
   * between them are drawn tight so the run reads as one thing said.
   */
  | { kind: 'msg'; msg: Msg; head: boolean; tail: boolean };

/** Whether two messages were said by the same person, in the same breath. */
function sameRun(a: Msg, b: Msg): boolean {
  if (a.fromMe !== b.fromMe) return false;
  // In a group two people are both "not me", so the name has to be compared
  // as well. Outside one there is only ever the other party, and `who` can
  // change under you — WhatsApp sends the push name on some messages and not
  // on others, and a run should not split because of that.
  if (isGroup(a.jid) && a.who !== b.who) return false;
  if (dayOf(a.at) !== dayOf(b.at)) return false;
  return b.at - a.at <= GROUP_GAP;
}

/**
 * A conversation, ready to draw. Messages must be oldest first.
 *
 * `seenAt` is when this conversation was last looked at, from the same record
 * `chatsFrom` counts unread against, and it puts one divider before the first
 * thing that arrived after it. Zero — a conversation never opened — draws no
 * divider at all, because a thread where everything is new has nothing to
 * separate it from.
 */
export function threadRows(msgs: readonly Msg[], seenAt = 0): Row[] {
  const out: Row[] = [];
  let day = '';
  // The first incoming message after the last look. Found up front, and by
  // index rather than by timestamp, so the divider goes in *before* the day
  // heading it shares a position with — and so two messages in the same second
  // cannot both claim it.
  //
  // At index 0 it is suppressed: everything in the thread is new, and there is
  // nothing above the line for it to be separated from. Finding the index and
  // then rejecting 0 is not the same as skipping 0 and carrying on looking,
  // which draws the line under the first unread message instead of over it.
  const first = seenAt > 0 ? msgs.findIndex((m) => !m.fromMe && m.at > seenAt) : -1;
  const mark = first > 0 ? first : -1;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (i === mark) out.push({ kind: 'new', at: m.at });
    const d = dayOf(m.at);
    if (d !== day) { out.push({ kind: 'day', at: m.at, key: d }); day = d; }
    const prev = i > 0 ? msgs[i - 1] : null;
    const next = i + 1 < msgs.length ? msgs[i + 1] : null;
    out.push({
      kind: 'msg',
      msg: m,
      head: !prev || !sameRun(prev, m),
      tail: !next || !sameRun(m, next),
    });
  }
  return out;
}


/* ── answering one message in particular ─────────────────────────────────── */

/** The `quoted` field of an outgoing message, in the shape the server wants. */
export interface Quoting {
  quoted?: { key: { id: string; remoteJid: string; fromMe: boolean } };
}

/**
 * What to spread into a send body to make it a reply, or nothing at all.
 *
 * The server wants the *key* of the message being answered — the three fields
 * WhatsApp identifies a message by: which conversation, whether we sent it,
 * and its own id. `keyId` and not `id`, for the same reason
 * `/chat/getBase64FromMediaMessage` needs it: `id` is Evolution's own row id
 * and means nothing to WhatsApp, so a reply built from it quotes nothing and
 * says so only by arriving as an ordinary message.
 *
 * Spread rather than assigned, so a send with nothing to quote carries no
 * `quoted` key at all. An empty one and an absent one are not the same thing
 * to a server that validates the field.
 */
export function quoting(to: Msg | null, jid: string): Quoting {
  if (!to || !to.keyId || !jid) return {};
  return { quoted: { key: { id: to.keyId, remoteJid: jid, fromMe: to.fromMe } } };
}

/* ── what you were in the middle of saying ───────────────────────────────── */

/**
 * Where the unsent replies are kept.
 *
 * A draft is per conversation, because the panel is one column and switching
 * chats is how you look something up mid-sentence. Losing the sentence to do
 * that is the kind of small rudeness that makes an app feel borrowed.
 *
 * Stored rather than held in memory: the panel unmounts when it closes, and
 * "I closed the sidebar" is not "I changed my mind about what I was writing".
 */
export const DRAFTS_KEY = 'vylo.whatsapp.drafts.v1';

/**
 * How many conversations keep a draft.
 *
 * Unbounded, this grows for as long as the app is installed and every entry is
 * a sentence somebody abandoned months ago. The cap is generous enough that
 * nobody meets it in a session and small enough that the record stays a
 * record rather than a log.
 */
export const MAX_DRAFTS = 40;

/** Stored drafts, repaired. A bad record is no drafts, never a throw. */
export function readDrafts(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [jid, text] of Object.entries(v as Record<string, unknown>)) {
      if (jid.includes('@') && typeof text === 'string' && text.trim()) out[jid] = text;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The drafts with one conversation's changed.
 *
 * Nothing is mutated and an empty draft is a *removal* rather than an empty
 * string, so a conversation that was written in and then cleared leaves no
 * trace — the alternative is a record full of `''` that counts against the cap
 * and means nothing.
 *
 * The cap drops the conversations that have not been touched longest, which
 * needs an order the record does not carry. `order` is the chat list, newest
 * first, as the panel already has it; without one the oldest keys go, which is
 * insertion order and close enough for a fallback nothing should reach.
 */
export function setDraft(
  drafts: Readonly<Record<string, string>>,
  jid: string,
  text: string,
  order: readonly string[] = [],
): Record<string, string> {
  const out: Record<string, string> = { ...drafts };
  if (!jid || !jid.includes('@')) return out;
  if (text.trim()) out[jid] = text;
  else delete out[jid];
  const keys = Object.keys(out);
  if (keys.length <= MAX_DRAFTS) return out;
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  // The one just written is never the one dropped, whatever the order says.
  const doomed = keys.filter((k) => k !== jid).sort((a, b) => rank(a) - rank(b))
    .slice(MAX_DRAFTS - 1);
  for (const k of doomed) delete out[k];
  return out;
}
