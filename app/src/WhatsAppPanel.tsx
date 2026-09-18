import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import {
  BLANK, KEY, chatsFrom, inChat, messagesFrom, phoneOf, read, ready, write,
  type Chat, type Conn, type Msg,
} from './whatsapp';

/**
 * WhatsApp, in the sidebar.
 *
 * Talks to an Evolution API instance whose address and key the person enters
 * here. The rule `providers.ts` states is the rule here: **a key is only ever
 * sent to the URL it was entered beside** — every request below is built from
 * `conn.baseUrl`, and there is no path that reaches any other host.
 *
 * ## Why there is no approval dialog on Send
 *
 * The gate exists for model output. A person typing a reply and pressing Send
 * is the author of it, exactly as they are of what they type into the
 * terminal, and `SAFETY.md`'s *Why the terminal has no approval step* is the
 * same argument word for word. If the agent is ever given a tool that sends,
 * that is a different thing and needs the gate — and an entry in `auto.ts`'s
 * always-ask rules, because a message to another person cannot be unsent.
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

interface Props {
  t: (s: string) => string;
  /** Hand a conversation to the agent, the way the terminal does. */
  onSendToChat: (text: string) => void;
}

const EVERY_MS = 6000;
/** How many messages to ask for. One page is a day of ordinary traffic. */
const PAGE = 200;

type State = 'setup' | 'checking' | 'live' | 'failed';

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

  /** One place that builds a request, so one place decides where a key goes. */
  const call = useCallback(async (c: Conn, path: string, body?: unknown) => {
    const r = await fetch(`${c.baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { apikey: c.key, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) {
      throw new Error(r.status === 401 || r.status === 403
        ? t('That key was refused.')
        : r.status === 404
          ? t('No instance by that name.')
          : fill(t('The server answered {n}.'), { n: r.status }));
    }
    return r.json();
  }, [t]);

  async function check(c: Conn) {
    setState('checking');
    setWhy('');
    try {
      // The cheapest call that proves both the address and the key: it answers
      // 401 without the header, so one round trip settles the whole form.
      const out = await call(c, `/instance/connectionState/${encodeURIComponent(c.instance)}`);
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
      setWhy(e instanceof Error ? e.message : t('Could not reach that server.'));
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
      .catch((e) => { if (live) setWhy(e instanceof Error ? e.message : String(e)); });
    pull();
    const timer = setInterval(pull, EVERY_MS);
    return () => { live = false; clearInterval(timer); };
  }, [state, conn, call]);

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
      setWhy(e instanceof Error ? e.message : t('That message did not send.'));
    } finally {
      setSending(false);
    }
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

  return (
    <div className="wa">
      <div className="sb-head-bar">
        <span className="sb-sub">{open ? t('Conversation') : t('Chats')}</span>
        {open && (
          <button className="sb-act" onClick={() => setOpen('')} title={t('All chats')}>
            <Icon name="chevron" size={13} turn={180} />
          </button>
        )}
        <button className="sb-act" onClick={() => { setState('setup'); setForm(conn); }}
                title={t('Change the connection')}>
          <Icon name="settings" size={13} />
        </button>
      </div>

      {why && <p className="wa-why">{why}</p>}

      {!open ? (
        chats.length === 0 ? (
          <p className="ft-empty">{t('Nothing has arrived yet. Messages appear here as they come in.')}</p>
        ) : (
          <ul className="wa-list">
            {chats.map((c: Chat) => (
              <li key={c.jid}>
                <button className="wa-row" onClick={() => show(c.jid)}>
                  <span className={`wa-mark ${c.group ? 'group' : ''}`}>
                    <Icon name={c.group ? 'memory' : 'chat'} size={13} />
                  </span>
                  <span className="wa-what">
                    <b>{c.name}</b>
                    <span className="wa-last">
                      {c.lastFromMe && <em>{t('You:')}</em>}
                      {c.last || kindLabel(c.lastKind, t)}
                    </span>
                  </span>
                  {c.unread > 0 && <i className="wa-dot">{c.unread}</i>}
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <div className="wa-thread">
            {thread.map((m) => (
              <div key={m.id || `${m.at}`} className={`wa-bubble ${m.fromMe ? 'mine' : ''}`}>
                {m.text || <em>{kindLabel(m.kind, t)}</em>}
              </div>
            ))}
            <div ref={foot} />
          </div>
          <div className="wa-send">
            <textarea value={draft} rows={2} placeholder={t('Write a reply…')}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                      }} />
            <div className="wa-acts">
              {/* The agent reads a conversation only when it is handed one,
                  the same gesture the terminal's Send to chat uses. */}
              <button className="ghost bordered" onClick={() => onSendToChat(
                thread.map((m) => `${m.fromMe ? 'me' : (m.who || phoneOf(m.jid))}: ${m.text}`).join('\n'))}>
                {t('Send to chat')}
              </button>
              <button className="sb-cta-go" disabled={!draft.trim() || sending}
                      onClick={() => void send()}>
                {sending ? t('Sending…') : t('Send')}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
