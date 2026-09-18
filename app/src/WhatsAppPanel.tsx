import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import {
  BLANK, KEY, chatsFrom, inChat, isGroup, phoneOf, read, ready, relDay,
  messagesFrom, threadRows, write,
  type Chat, type Conn, type Msg, type Row,
} from './whatsapp';
import { WireError, apiCall } from './whatsappwire';

/**
 * WhatsApp, in the sidebar.
 *
 * Talks to an Evolution API instance whose address and key the person enters
 * here. The rule `providers.ts` states is the rule here: **a key is only ever
 * sent to the URL it was entered beside** — every request goes through
 * `whatsappwire.ts`, which is built from one `Conn` and has no parameter that
 * could point it at another host.
 *
 * ## Why there is no approval dialog on Send
 *
 * The gate exists for model output. A person typing a reply and pressing Send
 * is the author of it, exactly as they are of what they type into the
 * terminal, and `SAFETY.md`'s *Why the terminal has no approval step* is the
 * same argument word for word. The agent now *does* have a tool that sends,
 * and it is gated exactly as that paragraph said it would have to be — see
 * `whatsapptool.ts`, where the words are the model's and every send is shown
 * to a person first.
 *
 * ## Polling
 *
 * The server has websockets switched off and this app has no address a webhook
 * could reach, so messages are fetched on a timer while the panel is open and
 * not at all while it is closed. A desktop app quietly polling a chat server
 * all day is somebody's battery.
 */

/**
 * What to show for a message with no words in it.
 *
 * Written as explicit calls with the string at the call, not a lookup table,
 * because the
 * catalogue scanner reads literals out of the source: a table would leave
 * these six strings invisible to it and they would ship in English, which is
 * exactly how the layout presets nearly did.
 */
function kindLabel(k: Msg['kind'], t: (s: string) => string): string {
  if (k === 'image') return t('[image]');
  if (k === 'video') return t('[video]');
  if (k === 'audio') return t('[voice note]');
  if (k === 'document') return t('[document]');
  if (k === 'sticker') return t('[sticker]');
  return t('[message]');
}

/** Which glyph stands in for an attachment, so a run of them is readable. */
function kindIcon(k: Msg['kind']): 'image' | 'camera' | 'mic' | 'file' | 'star' | 'chat' {
  if (k === 'image') return 'image';
  if (k === 'video') return 'camera';
  if (k === 'audio') return 'mic';
  if (k === 'document') return 'file';
  if (k === 'sticker') return 'star';
  return 'chat';
}

interface Props {
  t: (s: string) => string;
  /** Hand a conversation to the agent, the way the terminal does. */
  onSendToChat: (text: string) => void;
}

const EVERY_MS = 6000;
/** How many messages to ask for. One page is a day of ordinary traffic. */
const PAGE = 200;

type State = 'setup' | 'checking' | 'live' | 'failed';

/**
 * The clock on a message, in the reader's own locale.
 *
 * `undefined` for the locale rather than the interface language: a time is
 * read against the clock on the wall, and somebody running the interface in
 * Sorani on a machine set to 24-hour time wants 14:05.
 */
const clockOf = (at: number): string =>
  at ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '';

/** Up to two letters for the avatar. Digits give the last two of the number. */
function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '#';
  if (/^[+\d]/.test(words[0])) return name.replace(/\D/g, '').slice(-2) || '#';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return (first + second).toUpperCase();
}

/**
 * One of six tints, chosen by the conversation rather than at random.
 *
 * A colour that changes on every poll is noise; hashing the jid means the same
 * contact is the same colour for ever, and telling two conversations apart at
 * a glance is the entire job of the circle.
 *
 * Spelled out as six literals rather than built with `wa-t${n}`: `orphans.mjs`
 * finds a dead rule by looking for its class name in the source, and a name
 * that is assembled at runtime is a name the scanner cannot see. Six rules
 * would have gone on living here after the last thing using them was deleted
 * -- which is the `.vw-*` bug that test exists to catch.
 */
const TINTS = ['wa-t0', 'wa-t1', 'wa-t2', 'wa-t3', 'wa-t4', 'wa-t5'] as const;

function tintOf(jid: string): string {
  let h = 0;
  for (let i = 0; i < jid.length; i++) h = (h * 31 + jid.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function WhatsAppPanel({ t, onSendToChat }: Props) {
  const [conn, setConn] = useState<Conn>(() => read(localStorage.getItem(KEY)));
  const [form, setForm] = useState<Conn>(conn);
  const [state, setState] = useState<State>(() => (ready(conn) ? 'live' : 'setup'));
  const [why, setWhy] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [open, setOpen] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  /**
   * When each conversation was last looked at.
   *
   * The server is not storing chats, so it cannot say what has been read — see
   * `chatsFrom`. This is the app's own record, and it is the only honest basis
   * for a count.
   */
  const [seen, setSeen] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`${KEY}.seen`) || '{}'); } catch { return {}; }
  });
  useEffect(() => {
    try { localStorage.setItem(`${KEY}.seen`, JSON.stringify(seen)); } catch { /* private mode */ }
  }, [seen]);

  const chats = useMemo(() => chatsFrom(msgs, seen), [msgs, seen]);
  const thread = useMemo(() => (open ? inChat(msgs, open) : []), [msgs, open]);
  const rows = useMemo(() => threadRows(thread), [thread]);
  const here = useMemo(() => chats.find((c) => c.jid === open), [chats, open]);

  /**
   * A refused request, in the reader's language.
   *
   * The sentences stay here, at a `t()` call the catalogue scanner can see,
   * rather than in the transport — `whatsappwire.ts` reports a status and this
   * decides what that is worth saying about.
   */
  const sayWhy = useCallback((e: unknown): string => {
    if (e instanceof WireError) {
      if (e.status === 401 || e.status === 403) return t('That key was refused.');
      if (e.status === 404) return t('No instance by that name.');
      return fill(t('The server answered {n}.'), { n: e.status });
    }
    return e instanceof Error ? e.message : t('Could not reach that server.');
  }, [t]);

  /** One place that builds a request, so one place decides where a key goes. */
  const call = useCallback(
    (c: Conn, path: string, body?: unknown) => apiCall(c, path, body),
    [],
  );

  async function check(c: Conn) {
    setState('checking');
    setWhy('');
    try {
      // The cheapest call that proves both the address and the key: it answers
      // 401 without the header, so one round trip settles the whole form.
      const out = await call(c, `/instance/connectionState/${encodeURIComponent(c.instance)}`) as
        { instance?: { state?: string }; state?: string } | null;
      const st = (out?.instance?.state ?? out?.state ?? '') as string;
      if (st && st !== 'open') {
        setState('failed');
        setWhy(fill(t('That instance is {state}, not connected. Scan its QR code first.'), { state: st }));
        return;
      }
      localStorage.setItem(KEY, write(c));
      setConn(c);
      setState('live');
    } catch (e) {
      setState('failed');
      setWhy(sayWhy(e));
    }
  }

  // Fetch while the panel is open. Not on a schedule that survives it: see the
  // header on why a desktop app should not poll a chat server all day.
  useEffect(() => {
    if (state !== 'live' || !ready(conn)) return;
    let live = true;
    const pull = () => void call(conn, `/chat/findMessages/${encodeURIComponent(conn.instance)}`,
      { limit: PAGE })
      .then((out) => { if (live) { setMsgs(messagesFrom(out)); setWhy(''); } })
      .catch((e) => { if (live) setWhy(sayWhy(e)); });
    pull();
    const timer = setInterval(pull, EVERY_MS);
    return () => { live = false; clearInterval(timer); };
  }, [state, conn, call, sayWhy]);

  const foot = useRef<HTMLDivElement>(null);
  useEffect(() => { foot.current?.scrollIntoView({ block: 'end' }); }, [thread.length, open]);

  function show(jid: string) {
    setOpen(jid);
    setSeen((s) => ({ ...s, [jid]: Date.now() }));
  }

  async function send() {
    const text = draft.trim();
    if (!text || !open || sending) return;
    setSending(true);
    try {
      await call(conn, `/message/sendText/${encodeURIComponent(conn.instance)}`,
        { number: phoneOf(open) || open, text });
      setDraft('');
      // Straight back rather than waiting for the next tick, so the message
      // appears where it was typed.
      const out = await call(conn, `/chat/findMessages/${encodeURIComponent(conn.instance)}`, { limit: PAGE });
      setMsgs(messagesFrom(out));
    } catch (e) {
      setWhy(e instanceof WireError ? sayWhy(e) : t('That message did not send.'));
    } finally {
      setSending(false);
    }
  }

  /** Today, yesterday, or the date — the separator between two days of talk. */
  function dayLabel(at: number): string {
    const rel = relDay(at);
    if (rel === 'today') return t('Today');
    if (rel === 'yesterday') return t('Yesterday');
    return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  if (state !== 'live') {
    return (
      <div className="wa">
        <div className="sb-sub">{t('Connect WhatsApp')}</div>
        <div className="wa-form">
          <label>{t('Server')}
            <input value={form.baseUrl} spellCheck={false}
                   onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                   placeholder={BLANK.baseUrl} /></label>
          <label>{t('Instance')}
            <input value={form.instance} spellCheck={false}
                   onChange={(e) => setForm({ ...form, instance: e.target.value })}
                   placeholder="vylo-personal" /></label>
          <label>{t('API key')}
            <input value={form.key} type="password" spellCheck={false}
                   onChange={(e) => setForm({ ...form, key: e.target.value })} /></label>
          <button className="sb-cta-go" disabled={!ready(form) || state === 'checking'}
                  onClick={() => void check(form)}>
            {state === 'checking' ? t('Checking…') : t('Check and save')}
          </button>
          {why && <p className="wa-why">{why}</p>}
          {/* Said here rather than in a manual: the key can send messages as
              that number, so where it goes is worth one sentence. */}
          <p className="wa-note">
            <Icon name="bolt" size={12} />
            {t('The key is kept on this machine and sent only to the server above.')}
          </p>
        </div>
      </div>
    );
  }

  /* ── the chat list ───────────────────────────────────────────────────── */
  if (!open) {
    return (
      <div className="wa">
        <div className="sb-head-bar">
          <span className="sb-sub">{t('Chats')}</span>
          <button className="sb-act" onClick={() => { setState('setup'); setForm(conn); }}
                  title={t('Change the connection')} aria-label={t('Change the connection')}>
            <Icon name="settings" size={13} />
          </button>
        </div>

        {why && <p className="wa-why">{why}</p>}

        {chats.length === 0 ? (
          <p className="ft-empty">{t('Nothing has arrived yet. Messages appear here as they come in.')}</p>
        ) : (
          <ul className="wa-list">
            {chats.map((c: Chat) => (
              <li key={c.jid}>
                <button className="wa-row" onClick={() => show(c.jid)}>
                  <span className={`wa-mark ${tintOf(c.jid)} ${c.group ? 'group' : ''}`}>
                    {c.group ? <Icon name="memory" size={13} /> : initialsOf(c.name)}
                  </span>
                  <span className="wa-what">
                    <span className="wa-line">
                      <b>{c.name}</b>
                      {/* The clock is part of the row, not a detail behind a
                          hover: "when" is half of what a chat list is for. */}
                      <time className="wa-when">{clockOf(c.at)}</time>
                    </span>
                    <span className="wa-line">
                      <span className="wa-last">
                        {c.lastFromMe && <em>{t('You:')}</em>}
                        {c.last || kindLabel(c.lastKind, t)}
                      </span>
                      {c.unread > 0 && <i className="wa-dot">{c.unread}</i>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  /* ── one conversation ────────────────────────────────────────────────── */
  const name = here?.name || phoneOf(open) || open;
  const group = isGroup(open);

  return (
    <div className="wa">
      {/* Who you are talking to, not the word "Conversation". The header is the
          one place the panel can answer "am I about to write to the right
          person", and it has to answer it without being asked. */}
      <div className="wa-head">
        <button className="sb-act wa-back" onClick={() => setOpen('')} title={t('All chats')}
                aria-label={t('All chats')}>
          <Icon name="chevron" size={13} turn={180} />
        </button>
        <span className={`wa-mark ${tintOf(open)} ${group ? 'group' : ''}`}>
          {group ? <Icon name="memory" size={13} /> : initialsOf(name)}
        </span>
        <span className="wa-who">
          <b>{name}</b>
          <span>{group ? t('Group chat') : phoneOf(open) ? `+${phoneOf(open)}` : ''}</span>
        </span>
        <button className="sb-act" onClick={() => { setState('setup'); setForm(conn); }}
                title={t('Change the connection')} aria-label={t('Change the connection')}>
          <Icon name="settings" size={13} />
        </button>
      </div>

      {why && <p className="wa-why">{why}</p>}

      <div className="wa-thread">
        {rows.length === 0 && (
          <p className="ft-empty">{t('No messages here yet. Anything that arrives shows up below.')}</p>
        )}
        {rows.map((r: Row, i) => (r.kind === 'day' ? (
          <div key={`d${r.key}`} className="wa-day"><span>{dayLabel(r.at)}</span></div>
        ) : (
          <div key={r.msg.id || `m${i}`}
               className={[
                 'wa-bubble',
                 r.msg.fromMe ? 'mine' : '',
                 r.head ? 'head' : '',
                 r.tail ? 'tail' : '',
               ].filter(Boolean).join(' ')}>
            {/* Only on the first of a run, and only in a group: outside one
                there is exactly one other person and repeating their name over
                every burst is furniture. */}
            {group && !r.msg.fromMe && r.head && r.msg.who && (
              <span className="wa-from">{r.msg.who}</span>
            )}
            {r.msg.text
              ? <span className="wa-text">{r.msg.text}</span>
              : <span className="wa-kind">
                  <Icon name={kindIcon(r.msg.kind)} size={12} />
                  {kindLabel(r.msg.kind, t)}
                </span>}
            {/* The clock on the last of a run only. On every message it is a
                column of identical numbers down the side of the thread. */}
            {r.tail && <time className="wa-clock">{clockOf(r.msg.at)}</time>}
          </div>
        )))}
        <div ref={foot} />
      </div>

      <div className="wa-send">
        <div className="wa-box">
          <textarea value={draft} rows={1} placeholder={t('Write a reply…')}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                    }} />
          {/* In the box rather than under it: the button belongs to the words
              being typed, and a composer that grows must not push its own Send
              off the bottom of a 248px column. */}
          <button className="wa-go" disabled={!draft.trim() || sending}
                  title={sending ? t('Sending…') : t('Send')}
                  aria-label={sending ? t('Sending…') : t('Send')}
                  onClick={() => void send()}>
            <Icon name={sending ? 'clock' : 'send'} size={13} />
          </button>
        </div>
        {/* The agent reads a conversation only when it is handed one, the same
            gesture the terminal's Send to chat uses. It is the quieter of the
            two now: answering is what this pane is for. */}
        <button className="wa-hand" onClick={() => onSendToChat(
          thread.map((m) => `${m.fromMe ? 'me' : (m.who || phoneOf(m.jid))}: ${m.text}`).join('\n'))}>
          <Icon name="sparkle" size={12} />
          {t('Send to chat')}
        </button>
      </div>
    </div>
  );
}
