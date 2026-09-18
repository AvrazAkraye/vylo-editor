import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import {
  BLANK, KEY, chatsFrom, inChat, isGroup, phoneOf, read, ready, relDay,
  messagesFrom, threadRows, write,
  type Chat, type Conn, type Msg, type Row,
} from './whatsapp';
import { WireError, apiCall } from './whatsappwire';
import {
  handoverOf, hasMedia, mediaBodyFor, mediaFrom, mediaPath, nameFor, noteFor,
  playable, readable, toAttached, type Line, type Media,
} from './whatsappmedia';
import type { Attached } from './attachments';

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
  /**
   * Hand a conversation to the agent, the way the terminal does — now with
   * whatever of it the model can actually look at.
   *
   * The attachments go to the composer's tray rather than straight into a
   * request, so the last thing that happens before a photo of somebody's
   * kitchen reaches an API is a person seeing it sitting there and pressing
   * send. That is the same shape as every other way a file gets attached.
   */
  onSendToChat: (text: string, attached?: Attached[]) => void;
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

/** base64 to a Blob, so a 4 MB video is not also a 5.5 MB string in the DOM. */
function blobOf(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime || 'application/octet-stream' });
}

/** Base64 of a text file, as text. `atob` gives bytes; these may be UTF-8. */
function textOf(base64: string): string {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

/**
 * One frame out of a video, as a PNG the model can be shown.
 *
 * The API takes images and does not take video, so the choice is between
 * handing over nothing and handing over a still. A still is worth a great deal
 * — most videos people send are a photo that moves — and it is only defensible
 * because it is labelled: `noteFor` says "one frame of it", never "the video",
 * and says the sound was not heard.
 *
 * A quarter second in rather than at zero: the first frame of a phone video is
 * very often black or a blur of the camera starting. Falling back to 0 if the
 * seek fails, because a black frame still beats nothing.
 *
 * Resolves null rather than throwing on any of the several ways this fails —
 * an unsupported codec, a seek that never fires, a tainted canvas. A video that
 * would not give up a frame is not an error worth interrupting a handover for;
 * the note says the frame is missing and the rest still goes.
 */
function frameOf(url: string, mime: string): Promise<string | null> {
  return new Promise((done) => {
    const v = document.createElement('video');
    let settled = false;
    const finish = (out: string | null) => {
      if (settled) return;
      settled = true;
      v.removeAttribute('src');
      v.load();
      done(out);
    };
    // Some encodings simply never fire `seeked` in a webview. Nothing else
    // here would ever resolve, and a handover would hang on it for ever.
    const bail = setTimeout(() => finish(null), 5000);
    const draw = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) { clearTimeout(bail); finish(null); return; }
        const c = document.createElement('canvas');
        // Cap the long edge: a 4K frame is megabytes of base64 for no gain.
        const scale = Math.min(1, 1280 / Math.max(w, h));
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        const ctx = c.getContext('2d');
        if (!ctx) { clearTimeout(bail); finish(null); return; }
        ctx.drawImage(v, 0, 0, c.width, c.height);
        clearTimeout(bail);
        finish(c.toDataURL('image/png').split(',')[1] || null);
      } catch { clearTimeout(bail); finish(null); }
    };
    v.onseeked = draw;
    v.onerror = () => { clearTimeout(bail); finish(null); };
    v.onloadeddata = () => {
      // A seek past the end of a very short clip lands nowhere; clamp it.
      const at = Number.isFinite(v.duration) && v.duration > 0.3 ? 0.25 : 0;
      if (at === 0) draw(); else v.currentTime = at;
    };
    v.muted = true;
    v.preload = 'auto';
    if (mime) v.setAttribute('type', mime);
    v.src = url;
  });
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
   * Downloaded attachments, by message.
   *
   * A `Map` in a ref rather than state, with a counter to force the render:
   * the poll replaces `msgs` every six seconds and a cache keyed off that
   * would throw away every photo in the thread each time. What is downloaded
   * is downloaded — the bytes behind a WhatsApp message never change.
   *
   * `'loading'` and `'failed'` are in the map too, so a failed fetch is not
   * retried on every render and a request in flight is not started twice.
   */
  const store = useRef(new Map<string, Media | 'loading' | 'failed'>());
  const [fetched, setFetched] = useState(0);
  const bump = useCallback(() => setFetched((n) => n + 1), []);
  /**
   * The cache, as something the render depends on.
   *
   * `fetched` is read here and nowhere else. Mutating a ref does not re-render,
   * so the counter is what makes a finished download appear — and reading it
   * through this memo is what says so. A counter that is only ever written
   * reads like a mistake, and the next person deletes it.
   */
  const media = useMemo(() => store.current, [fetched]);

  /** Object URLs handed to `<img>`, `<audio>` and `<video>`, so they can be revoked. */
  const urls = useRef(new Map<string, string>());
  useEffect(() => () => {
    for (const u of urls.current.values()) URL.revokeObjectURL(u);
    urls.current.clear();
  }, []);

  /** Selecting messages to hand over. Empty set and off is the resting state. */
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [handing, setHanding] = useState(false);

  // Leaving a conversation ends a selection. A set of ids from another thread
  // is not a selection, it is a bug waiting for somebody to press Send.
  useEffect(() => { setPicking(false); setPicked(new Set()); }, [open]);

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

  /**
   * Fetch the bytes behind one message, once.
   *
   * Returns what it has if it already has it, so a caller can `await` this for
   * every selected message without thinking about the cache.
   */
  const grab = useCallback(async (m: Msg): Promise<Media | null> => {
    const held = store.current.get(m.id);
    if (held && held !== 'loading' && held !== 'failed') return held;
    if (held === 'loading') return null;
    if (held === 'failed') return null;
    store.current.set(m.id, 'loading');
    bump();
    try {
      const out = await apiCall(conn, mediaPath(conn.instance), mediaBodyFor(m));
      const got = mediaFrom(out, `whatsapp-${m.kind}`);
      store.current.set(m.id, got ?? 'failed');
      bump();
      return got;
    } catch {
      // Not put on `why`: one photo that will not come down is not a broken
      // connection, and a red bar across the panel would say it was.
      store.current.set(m.id, 'failed');
      bump();
      return null;
    }
  }, [conn, bump]);

  /** A URL for an element to point at, made once per message. */
  const urlOf = useCallback((id: string, media: Media): string => {
    const had = urls.current.get(id);
    if (had) return had;
    const made = URL.createObjectURL(blobOf(media.base64, media.mime));
    urls.current.set(id, made);
    return made;
  }, []);

  /**
   * Photos and stickers come down on their own; everything else waits to be asked.
   *
   * A picture that has to be clicked before it appears is not a chat, it is a
   * list of links. A forty-megabyte video that downloads because you scrolled
   * past it is somebody's phone bill — so those get a control instead, and the
   * fetch happens when it is pressed.
   */
  useEffect(() => {
    if (!open || state !== 'live') return;
    let live = true;
    void (async () => {
      for (const m of thread) {
        if (!live) return;
        if (m.kind !== 'image' && m.kind !== 'sticker') continue;
        if (store.current.has(m.id)) continue;
        await grab(m);
      }
    })();
    return () => { live = false; };
  }, [open, state, thread, grab]);

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

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /**
   * Hand the selection to the agent — the text, and everything in it the model
   * can actually perceive.
   *
   * With nothing selected this sends the whole conversation, which is what the
   * button did before selection existed and is still the common case. One tick
   * or ten narrows it.
   *
   * Every attachment is downloaded here rather than assumed present: a person
   * can select a voice note they never played, and the point of the feature is
   * that it arrives anyway.
   */
  async function hand() {
    if (handing) return;
    const chosen = picked.size > 0 ? thread.filter((m) => picked.has(m.id)) : thread;
    if (chosen.length === 0) return;
    setHanding(true);
    try {
      const lines: Line[] = [];
      const files: Attached[] = [];
      for (const m of chosen) {
        if (!hasMedia(m)) { lines.push({ msg: m }); continue; }
        const media = await grab(m);
        if (!media) { lines.push({ msg: m, note: noteFor(m, null, 'opaque') }); continue; }
        const use = readable(media.mime, m.kind);

        if (use === 'frame') {
          // A video becomes a still, or it becomes a sentence saying it could
          // not. Either way the message keeps its place in the transcript.
          const shot = await frameOf(urlOf(m.id, media), media.mime);
          if (shot) {
            files.push({
              kind: 'image',
              id: `wa_frame_${m.id}`,
              name: `${nameFor(m, media)} — frame.png`,
              mediaType: 'image/png',
              data: shot,
              bytes: Math.round((shot.length * 3) / 4),
            });
            lines.push({ msg: m, note: noteFor(m, media, 'frame') });
          } else {
            lines.push({ msg: m, note: noteFor(m, media, 'opaque') });
          }
          continue;
        }

        const one = toAttached(m, media, use === 'text' ? textOf(media.base64) : undefined);
        if (one) files.push(one);
        // `use` and not "did we get an attachment": a PDF that came through and
        // a voice note that cannot are different sentences, and the second one
        // is the one that stops the model inventing what it said.
        lines.push({ msg: m, note: noteFor(m, media, one ? use : 'opaque') });
      }

      const who = here?.name || phoneOf(open) || open;
      onSendToChat(handoverOf(lines, who), files);
      setPicking(false);
      setPicked(new Set());
    } finally {
      setHanding(false);
    }
  }

  /**
   * The attachment inside a bubble.
   *
   * Three outcomes, and each is drawn rather than described: a picture is the
   * picture, a voice note is a player you can press, and a document is a row
   * with its name and size. The old panel showed `[image]` for all of them,
   * which is a caption for a thing that is not there.
   */
  function body(m: Msg) {
    if (!hasMedia(m)) return null;
    const held = media.get(m.id);

    if (held === 'loading') {
      return <span className="wa-load"><Icon name="clock" size={12} />{kindLabel(m.kind, t)}</span>;
    }
    if (!held || held === 'failed') {
      // Not yet asked for, or asked and refused. Both offer the same control,
      // because "try again" and "fetch" are the same act to the person doing it.
      return (
        <button className="wa-get" onClick={() => void grab(m)}>
          <Icon name={kindIcon(m.kind)} size={12} />
          {held === 'failed' ? t('Could not load. Try again') : kindLabel(m.kind, t)}
        </button>
      );
    }

    const use = readable(held.mime, m.kind);
    const url = urlOf(m.id, held);
    if (use === 'image') {
      return <img className="wa-img" src={url} alt={nameFor(m, held)} loading="lazy" />;
    }
    if (playable(held.mime)) {
      // The app cannot hear a voice note and neither can the model — but the
      // person can, and until now there was no way for them to. `controls` is
      // the browser's, deliberately: a hand-drawn scrubber in a 248px column
      // would be worse at the one job it has.
      return held.mime.startsWith('video/')
        ? <video className="wa-vid" src={url} controls preload="metadata" />
        : <audio className="wa-aud" src={url} controls preload="metadata" />;
    }
    return (
      <a className="wa-doc" href={url} download={nameFor(m, held)}>
        <Icon name={kindIcon(m.kind)} size={13} />
        <span>{nameFor(m, held)}</span>
        <em>{held.bytes < 1024 ? `${Math.round(held.bytes)} B` : `${Math.round(held.bytes / 1024)} KB`}</em>
      </a>
    );
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
      {picking ? (
        /* Selecting replaces the header rather than adding a bar under it. The
           column is 248px wide; a mode that pushes the conversation down to
           announce itself costs more than it explains. */
        <div className="wa-head picking">
          <button className="sb-act" onClick={() => { setPicking(false); setPicked(new Set()); }}
                  title={t('Cancel')} aria-label={t('Cancel')}>
            <Icon name="close" size={13} />
          </button>
          <span className="wa-who">
            <b>{picked.size > 0
              ? fill(t('{n} selected'), { n: picked.size })
              : t('Pick messages')}</b>
            <span>{picked.size > 0 ? t('Tap to add or remove') : t('Or send the whole conversation')}</span>
          </span>
          <button className="sb-cta-go wa-pick-go" disabled={handing}
                  onClick={() => void hand()}>
            <Icon name={handing ? 'clock' : 'sparkle'} size={12} />
            {handing ? t('Collecting…') : t('Send to chat')}
          </button>
        </div>
      ) : (
        /* Who you are talking to, not the word "Conversation". The header is the
           one place the panel can answer "am I about to write to the right
           person", and it has to answer it without being asked. */
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
          <button className="sb-act" onClick={() => setPicking(true)}
                  title={t('Pick messages')} aria-label={t('Pick messages')}>
            <Icon name="check" size={13} />
          </button>
          <button className="sb-act" onClick={() => { setState('setup'); setForm(conn); }}
                  title={t('Change the connection')} aria-label={t('Change the connection')}>
            <Icon name="settings" size={13} />
          </button>
        </div>
      )}

      {why && <p className="wa-why">{why}</p>}

      <div className={`wa-thread${picking ? ' picking' : ''}`}>
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
                 picked.has(r.msg.id) ? 'on' : '',
               ].filter(Boolean).join(' ')}
               /* The whole bubble is the target while picking, and nothing at
                  all otherwise: a message is not a button in the resting
                  state, and making it one costs the text selection people use
                  to copy a verification code out of it. */
               {...(picking
                 ? {
                   role: 'checkbox' as const,
                   'aria-checked': picked.has(r.msg.id),
                   tabIndex: 0,
                   onClick: () => toggle(r.msg.id),
                   onKeyDown: (e: React.KeyboardEvent) => {
                     if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(r.msg.id); }
                   },
                 }
                 : {})}>
            {picking && (
              <span className="wa-tick">
                {picked.has(r.msg.id) && <Icon name="check" size={10} />}
              </span>
            )}
            {/* Only on the first of a run, and only in a group: outside one
                there is exactly one other person and repeating their name over
                every burst is furniture. */}
            {group && !r.msg.fromMe && r.head && r.msg.who && (
              <span className="wa-from">{r.msg.who}</span>
            )}
            {body(r.msg)}
            {r.msg.text && <span className="wa-text">{r.msg.text}</span>}
            {/* A message with neither words nor anything to fetch still has to
                occupy a line, or a run silently loses one of its members. */}
            {!r.msg.text && !hasMedia(r.msg) && (
              <span className="wa-kind">
                <Icon name={kindIcon(r.msg.kind)} size={12} />
                {kindLabel(r.msg.kind, t)}
              </span>
            )}
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
        <button className="wa-hand" disabled={handing || thread.length === 0}
                onClick={() => void hand()}>
          <Icon name={handing ? 'clock' : 'sparkle'} size={12} />
          {handing ? t('Collecting…') : t('Send to chat')}
        </button>
      </div>
    </div>
  );
}
