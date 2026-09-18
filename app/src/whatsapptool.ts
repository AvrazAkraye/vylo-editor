/**
 * WhatsApp as something the agent can call.
 *
 * `WhatsAppPanel.tsx` is a person reading and typing. This is the other half:
 * the model asking to look at a conversation, or to answer one, from inside a
 * turn — "tell Rebaz the build is green" without leaving the chat.
 *
 * ## Sending is always asked about
 *
 * `WhatsAppPanel.tsx` explains why *its* Send has no dialog: a person typing a
 * reply is the author of it. Nothing in that argument covers this. Here the
 * words are the model's, they leave the machine, and they arrive at another
 * human being under the account holder's name — so `whatsapp_send` goes
 * through `askToRun`, the same gate and the same dialog as `run_command`, and
 * there is no auto-approve level that skips it. `auto.ts` states the rule this
 * follows: a thing that cannot be undone always asks. A message cannot be
 * unsent, no checkpoint holds it, and the person who reads it is not in the
 * room. That is the definition, not an edge case.
 *
 * The consequence is deliberate: an unattended routine cannot send WhatsApp.
 * It can read, and it can draft, and then it waits for somebody.
 *
 * ## Reading is not
 *
 * `whatsapp_chats` and `whatsapp_read` change nothing and leave nothing
 * behind, so they run like `read_file` does. They are still only offered when
 * a connection has been set up by hand in the panel — the model is never the
 * thing that decides which server a key goes to.
 *
 * ## No network in here that a test cannot see
 *
 * The transport is injected. Everything this module decides — what the tools
 * are, whether a call makes sense, what the dialog says, how a result reads —
 * is arithmetic over plain values, and `test/whatsapptool.test.mjs` runs all
 * of it without a server.
 */

import {
  chatsFrom, inChat, isGroup, jidOf, messagesFrom, phoneOf, ready,
  type Chat, type Conn, type Msg,
} from './whatsapp';

/** How many messages a read returns, and how many are fetched to find them. */
export const PAGE = 200;
const THREAD_MAX = 60;

/* ── the schemas ─────────────────────────────────────────────────────────
   Descriptions are written for the model and say the things it cannot see:
   that the chat list is derived rather than fetched, that a name is whatever
   the sender publishes, and — on send — that a human will be shown the exact
   text. The last one matters: a model that thinks a send is silent writes a
   different message from one that knows it will be read first. */

export const WHATSAPP_TOOLS = [
  {
    name: 'whatsapp_chats',
    description:
      'List the WhatsApp conversations this account can see, most recent first. Returns '
      + '{ chats } where each has jid, name, group, last, at (ms) and unread. The list is '
      + 'built from messages that have arrived since the instance connected — it is not the '
      + "user's full WhatsApp history, so a conversation that has been quiet may be absent. "
      + 'A name is whatever the sender publishes; for many contacts it is just the number.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'whatsapp_read',
    description:
      'Read one WhatsApp conversation, oldest message first. Returns { messages } with '
      + 'from ("me" or the sender), at (ms), kind and text. Identify the conversation by '
      + 'jid from whatsapp_chats, or by phone number for a one-to-one chat. Attachments '
      + 'come back as their kind with no content — this cannot download media.',
    input_schema: {
      type: 'object',
      properties: {
        jid: { type: 'string', description: 'The conversation id from whatsapp_chats.' },
        phone: { type: 'string', description: 'A phone number instead, for a one-to-one chat.' },
        limit: { type: 'integer', description: `Most recent N messages. Default ${THREAD_MAX}.` },
      },
    },
  },
  {
    name: 'whatsapp_send',
    description:
      'Send a WhatsApp message. The user is shown the exact recipient and the exact text '
      + 'and must approve it before anything leaves the machine — there is no setting that '
      + 'turns that off, because a message cannot be unsent. Write the message as the user '
      + 'would send it, in their language, and do not sign it as an AI unless asked. '
      + 'Identify the recipient by jid from whatsapp_chats, or by phone number.',
    input_schema: {
      type: 'object',
      properties: {
        jid: { type: 'string', description: 'The conversation id from whatsapp_chats.' },
        phone: { type: 'string', description: 'A phone number instead, in full international form.' },
        text: { type: 'string', description: 'Exactly what to send.' },
      },
      required: ['text'],
    },
  },
] as const;

const NAMES: ReadonlySet<string> = new Set<string>(WHATSAPP_TOOLS.map((t) => t.name));

export const isWhatsAppTool = (name: string): boolean => NAMES.has(name);

/**
 * The tools, when there is a connection to use them through.
 *
 * An empty array when the panel has not been set up, so the model is never
 * offered a tool whose first act would be to fail. A tool that is present and
 * broken costs a round trip and an apology; a tool that is absent costs
 * nothing and the model says it plainly.
 */
export const whatsAppToolsFor = (conn: Conn): unknown[] =>
  (ready(conn) ? [...WHATSAPP_TOOLS] : []);

/* ── working out who is meant ────────────────────────────────────────────
   Two ways in, because the model has two kinds of knowledge: a jid it read
   out of `whatsapp_chats`, and a number the user typed into the chat. Both
   land on a jid, and a number that is not a number is caught here rather than
   posted to the server to be rejected. */

export interface Target {
  jid: string;
  /** What to call this conversation in the approval dialog. */
  name: string;
}

export type Planned<T> = { ok: true; value: T } | { ok: false; why: string };

const bad = (why: string): Planned<never> => ({ ok: false, why });

/**
 * The conversation a call means.
 *
 * `chats` is only for the name — resolution never depends on the list, so a
 * message to somebody who has not written first still works.
 */
export function targetOf(input: Record<string, unknown>, chats: readonly Chat[] = []): Planned<Target> {
  const raw = typeof input.jid === 'string' ? input.jid.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  let jid = '';
  if (raw.includes('@')) jid = raw;
  // A bare number in the jid field is a mistake worth accepting: the model
  // read "identify by jid" and had only a number. Rejecting it teaches it
  // nothing and costs the user a turn.
  else if (raw) jid = jidOf(raw);
  else if (phone) jid = jidOf(phone);

  if (!jid) {
    return bad(phone || raw
      ? `"${phone || raw}" is not a phone number or a conversation id.`
      : 'Name the conversation with jid or phone.');
  }
  const known = chats.find((c) => c.jid === jid);
  return { ok: true, value: { jid, name: known?.name || phoneOf(jid) || jid } };
}

export interface SendPlan extends Target {
  text: string;
  group: boolean;
}

/** A send, checked, before anybody is asked about it. */
export function planSend(
  input: Record<string, unknown>, chats: readonly Chat[] = [],
): Planned<SendPlan> {
  const text = typeof input.text === 'string' ? input.text : '';
  if (!text.trim()) return bad('text was empty.');
  const to = targetOf(input, chats);
  if (!to.ok) return to;
  return { ok: true, value: { ...to.value, text, group: isGroup(to.value.jid) } };
}

/**
 * What the approval dialog shows.
 *
 * The recipient first and on its own line, because that is the part that is
 * catastrophic to get wrong and the part a person skims past. The message
 * whole and unabridged underneath: an approval for a truncated string is not
 * an approval for what would be sent.
 */
export function approvalLine(plan: SendPlan): string {
  const who = plan.group
    ? `the group ${plan.name}`
    : plan.name && plan.name !== phoneOf(plan.jid)
      ? `${plan.name} (+${phoneOf(plan.jid)})`
      : `+${phoneOf(plan.jid)}`;
  return `WhatsApp to ${who}\n\n${plan.text}`;
}

/* ── how a result reads ──────────────────────────────────────────────────
   JSON, because the model is the reader and a table would be prose it has to
   parse back. Timestamps stay as milliseconds for the same reason: the model
   can do arithmetic on a number and cannot on "yesterday at 4". */

export const chatsResult = (chats: readonly Chat[]): string =>
  JSON.stringify({
    chats: chats.map((c) => ({
      jid: c.jid, name: c.name, group: c.group,
      last: c.last, last_kind: c.lastKind, last_from_me: c.lastFromMe,
      at: c.at, unread: c.unread,
    })),
  });

export function threadResult(msgs: readonly Msg[], limit = THREAD_MAX): string {
  // The tail, not the head: a conversation is read from its recent end, and a
  // limit that kept the oldest would answer "what did they just say" with the
  // first thing anybody ever said.
  const cut = msgs.slice(Math.max(0, msgs.length - Math.max(1, limit)));
  return JSON.stringify({
    messages: cut.map((m) => ({
      from: m.fromMe ? 'me' : (m.who || phoneOf(m.jid) || m.jid),
      at: m.at, kind: m.kind, text: m.text,
    })),
    older: msgs.length - cut.length,
  });
}

/* ── running one ─────────────────────────────────────────────────────────── */

/** One request to the instance. Injected, so this module never opens a socket. */
export type Call = (path: string, body?: unknown) => Promise<unknown>;

/** Suspends until a human answers. The same shape `agent.ts` passes around. */
export type Ask = (req: { command: string; reason: string; kind?: 'shell' | 'mcp' }) => Promise<'no' | 'pipe' | 'terminal'>;

export interface Deps {
  conn: Conn;
  call: Call;
  ask: Ask;
}

/** What `agent.ts` expects back from a tool. */
export interface ToolOut { content: string; isError: boolean }

const fail = (content: string): ToolOut => ({ content, isError: true });

/**
 * Run one WhatsApp tool call.
 *
 * Returns null for a name this module does not own, so the caller can fall
 * through to whatever else it knows — the same shape `splitTool` has.
 */
export async function runWhatsAppTool(
  name: string, input: Record<string, unknown>, deps: Deps,
): Promise<ToolOut | null> {
  if (!isWhatsAppTool(name)) return null;
  const { conn, call, ask } = deps;
  if (!ready(conn)) {
    return fail('WhatsApp is not connected. The user sets that up in the WhatsApp panel; '
      + 'it is not something you can configure.');
  }
  const inst = encodeURIComponent(conn.instance);

  const fetchAll = async (): Promise<Msg[]> =>
    messagesFrom(await call(`/chat/findMessages/${inst}`, { limit: PAGE }));

  try {
    if (name === 'whatsapp_chats') {
      return { content: chatsResult(chatsFrom(await fetchAll())), isError: false };
    }

    if (name === 'whatsapp_read') {
      const msgs = await fetchAll();
      const to = targetOf(input, chatsFrom(msgs));
      if (!to.ok) return fail(to.why);
      const thread = inChat(msgs, to.value.jid);
      if (thread.length === 0) {
        return {
          content: JSON.stringify({ messages: [], older: 0, note: 'No messages with this contact have arrived since the instance connected.' }),
          isError: false,
        };
      }
      const limit = Number(input.limit);
      return {
        content: threadResult(thread, Number.isFinite(limit) && limit > 0 ? limit : THREAD_MAX),
        isError: false,
      };
    }

    // whatsapp_send. The list is fetched first only so the dialog can say a
    // name instead of a number -- a person approving "+9647501112233" is
    // approving a string, and a person approving "Rebaz" is approving a
    // decision. It is not allowed to decide whether the send is possible.
    let chats: Chat[] = [];
    try { chats = chatsFrom(await fetchAll()); } catch { chats = []; }

    const plan = planSend(input, chats);
    if (!plan.ok) return fail(plan.why);

    // The gate. Nothing above this line left the machine.
    const answer = await ask({
      command: approvalLine(plan.value),
      reason: 'The agent wants to send this WhatsApp message as you. It cannot be unsent.',
      kind: 'mcp',
    });
    if (answer === 'no') {
      return { content: 'The user declined to send that message.', isError: false };
    }

    await call(`/message/sendText/${inst}`, {
      number: phoneOf(plan.value.jid) || plan.value.jid,
      text: plan.value.text,
    });
    return { content: `Sent to ${plan.value.name}.`, isError: false };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
