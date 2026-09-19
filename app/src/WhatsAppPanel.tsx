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
  displayMime, handoverOf, hasMedia, mediaBodyFor, mediaFrom, mediaPath, nameFor,
  noteFor, playable, sendAs, sendAudioPath, sendBody, sendMediaPath,
  sendMime, toAttached, useOf, type Line, type Media, type Outgoing,
} from './whatsappmedia';
import type { Attached } from './attachments';
import { open as pickFile } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { KEY as PROVIDERS_KEY, read as readProviders, type Provider } from './providers';
import {
  BLANK_VOICE, VOICE_KEY, VOICE_LANGS, acceptsName, backendFor, endpointOf,
  formFor, jobIdFrom, jobPath, jobState, langOf, modeOf, modelFor, readVoice,
  textFrom, transcribePath, transcriptNote, uploadHeaders, voiceForm,
  voiceHeaders, writeVoice, type Voice,
} from './whatsappvoice';

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
   * Open Settings where model providers are added.
   *
   * The panel needs this because transcription depends on a provider it cannot
   * add itself. Without it the only honest thing to draw was nothing, and a
   * voice note that could not be read gave no account of why.
   */
  onProviders: () => void;
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

export function WhatsAppPanel({ t, onSendToChat, onProviders }: Props) {
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

  /**
   * Voice notes that have been turned into words, and the ones being turned.
   *
   * Kept beside the media cache rather than in it: a transcript is not part of
   * the message, it is something this app asked a third party for, and the two
   * are stored apart so nothing can mistake one for the other.
   */
  const [said, setSaid] = useState<Record<string, string>>({});
  const [saying, setSaying] = useState('');

  /** The Vylo Voice connection, which is the one with Kurdish engines. */
  const [vc, setVc] = useState<Voice>(() => readVoice(localStorage.getItem(VOICE_KEY)));
  useEffect(() => {
    try { localStorage.setItem(VOICE_KEY, writeVoice(vc)); } catch { /* private mode */ }
  }, [vc]);

  /**
   * Who will transcribe, if anybody. Re-read rather than held, since a provider
   * can be added in Settings while this panel is open.
   */
  const voice = useMemo(() => {
    void fetched;
    let providers: ReturnType<typeof readProviders> = [];
    try { providers = readProviders(localStorage.getItem(PROVIDERS_KEY)); } catch { providers = []; }
    return backendFor(vc, providers);
  }, [fetched, vc]);

  /** The whole window, rather than a 248px column. */
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setFull(false); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [full]);

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

  /**
   * A URL for an element to point at, made once per message.
   *
   * `displayMime` and not `media.mime`: the server often says
   * `application/octet-stream`, a blob URL carries its type through to the
   * element, and an element handed a type that is not a media type may refuse
   * it. That refusal is what drew a photo as its own filename in a box.
   */
  const urlOf = useCallback((id: string, media: Media, kind?: Msg['kind']): string => {
    const had = urls.current.get(id);
    if (had) return had;
    const made = URL.createObjectURL(blobOf(media.base64, displayMime(media, kind)));
    urls.current.set(id, made);
    return made;
  }, []);

  /**
   * Attachments whose bytes would not render as the thing they claimed to be.
   *
   * Set by the element's own `onError`, which is the only thing that actually
   * knows. Whatever the reason — a type the decoder refused, bytes that are not
   * an image at all, a server that sent a thumbnail key instead of a file — the
   * answer is the same and it is not a broken picture with its filename showing
   * through: fall back to the row that lets the file be saved, and offer to
   * fetch it again.
   */
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const breaks = useCallback((id: string) => {
    setBroken((p) => (p.has(id) ? p : new Set(p).add(id)));
  }, []);

  /**
   * Fetch it again, from nothing.
   *
   * A reload has to forget everything it knew or it is a no-op: the cached
   * bytes, the object URL the element is still holding, and the note that this
   * one would not render.
   */
  const reload = useCallback((m: Msg) => {
    const url = urls.current.get(m.id);
    if (url) { URL.revokeObjectURL(url); urls.current.delete(m.id); }
    store.current.delete(m.id);
    setBroken((p) => { if (!p.has(m.id)) return p; const n = new Set(p); n.delete(m.id); return n; });
    void grab(m);
  }, [grab]);

  /**
   * Files chosen to go out with the next message.
   *
   * Held here rather than sent on pick, so a caption can be typed with the
   * photo already visible and the wrong file can be taken back out — which is
   * the difference between attaching and having sent.
   */
  const [outbox, setOutbox] = useState<Outgoing[]>([]);
  const [failed, setFailed] = useState('');

  /**
   * Pick files to send.
   *
   * Not `pickAttachments` from `attachments.ts`: that one reads for the model,
   * so it routes by extension into an image, a PDF or text and refuses the
   * rest. A person can be sent a `.mov` or a `.zip` perfectly well, so this
   * reads the bytes and lets `sendAs` decide what WhatsApp should call it.
   */
  async function attach() {
    setFailed('');
    try {
      const picked = await pickFile({ multiple: true, directory: false });
      const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
      const got: Outgoing[] = [];
      const bad: string[] = [];
      for (const path of paths) {
        try {
          const r = await invoke<{ name: string; data: string; bytes: number }>(
            'read_any_file', { path },
          );
          const mime = sendMime(r.name);
          got.push({ data: r.data, name: r.name, mime, as: sendAs(r.name, mime) });
        } catch (e) {
          bad.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (got.length) setOutbox((p) => [...p, ...got]);
      if (bad.length) setFailed(bad.join(' · '));
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  }

  /** The picture being looked at, full size. */
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setPreview(null); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [preview]);

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

  /**
   * Send what is in the composer: the files, then whatever words are left over.
   *
   * The caption rides on the first file rather than going as its own message,
   * because that is how WhatsApp shows a photo with words under it instead of
   * a photo followed a second later by a line of text from the same person.
   * A voice note is the exception — that endpoint has nowhere to put a caption
   * and a recording has no text — so words sent with one go separately.
   *
   * Files go one at a time and in order. Evolution takes one per request, and
   * firing them together would deliver them in whatever order the server
   * finished, which is not the order they were chosen in.
   */
  async function send() {
    const text = draft.trim();
    if ((!text && outbox.length === 0) || !open || sending) return;
    const number = phoneOf(open) || open;
    setSending(true);
    setFailed('');
    try {
      let caption = text;
      for (const out of outbox) {
        const path = out.as === 'audio' ? sendAudioPath(conn.instance) : sendMediaPath(conn.instance);
        // The caption is spent on the first file that can carry one.
        const carried = out.as === 'audio' ? '' : caption;
        await call(conn, path, sendBody(number, out, carried));
        if (carried) caption = '';
      }
      // Anything the files could not carry -- no files at all, or only a voice
      // note -- still has to be said.
      if (caption) {
        await call(conn, `/message/sendText/${encodeURIComponent(conn.instance)}`,
          { number, text: caption });
      }
      setDraft('');
      setOutbox([]);
      // Straight back rather than waiting for the next tick, so the message
      // appears where it was typed.
      const back = await call(conn, `/chat/findMessages/${encodeURIComponent(conn.instance)}`, { limit: PAGE });
      setMsgs(messagesFrom(back));
    } catch (e) {
      setWhy(e instanceof WireError ? sayWhy(e) : t('That message did not send.'));
    } finally {
      setSending(false);
    }
  }

  /**
   * Send one voice note to the provider the person configured, and keep what
   * comes back.
   *
   * Nothing calls this on its own. It is reached from a button on one message,
   * whose label names where the audio is going — the consent is the press, and
   * a voice note that leaves this machine does so because somebody decided it
   * should, one at a time.
   */
  async function transcribe(m: Msg) {
    if (!voice || saying) return;
    const media = await grab(m);
    if (!media) return;
    const name = nameFor(m, media);
    setSaying(m.id);
    setWhy('');
    try {
      const blob = blobOf(media.base64, displayMime(media, m.kind));
      const words = voice.kind === 'vylo'
        ? await viaVylo(voice.voice, blob, name)
        : await viaProvider(voice.provider, blob, name);
      if (words === null) return;
      // An empty transcript is an answer: silence, or speech nothing could make
      // out. Recorded as such, so the button does not look unpressed and invite
      // a second upload of the same audio.
      setSaid((p) => ({ ...p, [m.id]: words || t('Nothing could be made out.') }));
    } catch (e) {
      setWhy(e instanceof Error ? e.message : t('Could not reach that server.'));
    } finally {
      setSaying('');
    }
  }

  /**
   * Vylo Voice: upload, then wait for the job.
   *
   * The server queues a recording and transcribes it on a worker, so this is a
   * conversation rather than one request. Polled on a slow tick — a few seconds
   * of audio takes a few seconds, and hammering a queue does not make it move.
   * Returns null when it gave up, having already said why.
   */
  async function viaVylo(v: Voice, blob: Blob, name: string): Promise<string | null> {
    // The server checks the *filename* and answers 422 for anything not on its
    // list. `nameFor` corrects a converted voice note's extension, and this is
    // the check that would otherwise fail for a reason nobody could guess.
    if (!acceptsName(name)) {
      setWhy(fill(t('{name} is not a kind of audio that can be transcribed.'), { name }));
      return null;
    }
    const up = await fetch(transcribePath(v), {
      method: 'POST', headers: voiceHeaders(v), body: voiceForm(blob, name, v),
    });
    if (!up.ok) {
      setWhy(up.status === 401 || up.status === 403
        ? t('That key was refused.')
        : fill(t('The server answered {n}.'), { n: up.status }));
      return null;
    }
    const id = jobIdFrom(await up.json());
    if (!id) { setWhy(t('Could not reach that server.')); return null; }

    // Roughly a minute of patience. Long enough for `accurate` on a short
    // recording, short enough that a wedged worker is not waited on all day.
    for (let tries = 0; tries < 40; tries++) {
      await new Promise((done) => { setTimeout(done, 1500); });
      const r = await fetch(jobPath(v, id), { headers: voiceHeaders(v) });
      if (!r.ok) { setWhy(fill(t('The server answered {n}.'), { n: r.status })); return null; }
      const state = jobState(await r.json());
      if (!state.done) continue;
      if ('failed' in state) { setWhy(state.failed); return null; }
      return state.text;
    }
    setWhy(t('That is taking longer than expected. It may still finish — try again shortly.'));
    return null;
  }

  /** An OpenAI-shaped service: one round trip, no Kurdish. */
  async function viaProvider(p: Provider, blob: Blob, name: string): Promise<string | null> {
    const r = await fetch(endpointOf(p), {
      method: 'POST',
      headers: uploadHeaders(p),
      body: formFor(blob, name, modelFor(p), vc.lang),
    });
    if (!r.ok) {
      setWhy(fill(t('The server answered {n}.'), { n: r.status }));
      return null;
    }
    return textFrom(await r.json());
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
        const use = useOf(media, m.kind);

        // A voice note somebody already transcribed goes over as its words,
        // attributed. Only one that was transcribed: nothing is uploaded to a
        // third party because a handover happened, so an untranscribed note
        // still travels as the line saying it was not heard.
        if (use === 'opaque' && said[m.id]) {
          lines.push({ msg: m, note: transcriptNote(said[m.id], voice?.name || t('a provider')) });
          continue;
        }

        if (use === 'unknown') {
          lines.push({ msg: m, note: noteFor(m, media, 'opaque') });
          continue;
        }

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
      // because "fetch it" and "try again" are the same act to the person
      // pressing it.
      return (
        <button className="wa-get" onClick={() => reload(m)}>
          <Icon name={held === 'failed' ? 'swap' : kindIcon(m.kind)} size={12} />
          {held === 'failed' ? t('Could not load. Try again') : kindLabel(m.kind, t)}
        </button>
      );
    }

    const name = nameFor(m, held);
    // The bytes decide, not the server's mimetype and not the filename.
    const use = useOf(held, m.kind);
    const url = urlOf(m.id, held, m.kind);
    const size = held.bytes < 1024
      ? `${Math.round(held.bytes)} B`
      : `${Math.round(held.bytes / 1024)} KB`;

    /* A file to save, and the shape anything unrenderable falls back to. */
    const asFile = (why?: string) => (
      <span className="wa-file">
        <a className="wa-doc" href={url} download={name}>
          <Icon name={kindIcon(m.kind)} size={13} />
          <span>{name}</span>
          <em>{size}</em>
        </a>
        {why && <span className="wa-broke">{why}</span>}
        <button className="wa-again" onClick={() => reload(m)} title={t('Load it again')}
                aria-label={t('Load it again')}>
          <Icon name="swap" size={11} />
        </button>
      </span>
    );

    // The payload matches no format this app knows. Said plainly, with what was
    // actually received, because "would not open as a picture" invites another
    // press of reload and the bytes will be the same every time. A photo whose
    // first bytes are not a photo did not fail to draw -- it is not a photo,
    // and that is the server's end of the exchange, not the drawing.
    if (use === 'unknown') {
      return asFile(fill(t('The server sent {n} that is not a picture, a video or a sound.'), { n: size }));
    }

    if (use === 'image') {
      // Even with the right first bytes a file can be truncated or corrupt, and
      // the element is the only thing that knows. When it refuses, this must
      // not become a broken picture with its own filename showing through it.
      if (broken.has(m.id)) return asFile(t('This would not open as a picture.'));
      return (
        <span className="wa-shot">
          <img className="wa-img" src={url} alt={name} loading="lazy"
               onError={() => breaks(m.id)}
               onClick={() => setPreview({ url, name })} />
          <button className="wa-again on-shot" onClick={() => reload(m)}
                  title={t('Load it again')} aria-label={t('Load it again')}>
            <Icon name="swap" size={11} />
          </button>
        </span>
      );
    }

    if (playable(displayMime(held, m.kind))) {
      if (use === 'frame') {
        if (broken.has(m.id)) return asFile(t('This would not open as a video.'));
        return (
          <span className="wa-shot">
            <video className="wa-vid" src={url} controls preload="metadata"
                   onError={() => breaks(m.id)} />
            <button className="wa-again on-shot" onClick={() => reload(m)}
                    title={t('Load it again')} aria-label={t('Load it again')}>
              <Icon name="swap" size={11} />
            </button>
          </span>
        );
      }
      // The person can hear it; `controls` is the browser's, deliberately — a
      // hand-drawn scrubber in a 248px column would be worse at the one job it
      // has. Under it, the only route this app has to the words.
      return (
        <>
          <audio className="wa-aud" src={url} controls preload="metadata"
                 onError={() => breaks(m.id)} />
          {broken.has(m.id) && (
            <button className="wa-get" onClick={() => reload(m)}>
              <Icon name="swap" size={12} />{t('Could not load. Try again')}
            </button>
          )}
          {said[m.id] ? (
            <span className="wa-said" dir="auto">{said[m.id]}</span>
          ) : voice ? (
            /* Named, so the press is informed: this is a voice note leaving the
               machine for a service the person added, and the button is the
               whole of the consent. */
            <button className="wa-say" disabled={saying === m.id}
                    title={fill(t('Send this audio to {name} to be transcribed'), { name: voice.name })}
                    onClick={() => void transcribe(m)}>
              <Icon name={saying === m.id ? 'clock' : 'sparkle'} size={11} />
              {saying === m.id ? t('Transcribing…') : t('Transcribe')}
            </button>
          ) : (
            /* No provider. This used to draw nothing at all, on the argument
               that a control which cannot work teaches nothing when it fails —
               which was half right and wholly unhelpful: the voice note then
               went to the model as "not read" and the panel never said why, or
               that there was anything to be done about it. Nothing here can
               hear audio and the gateway answers a transcription request with a
               404, so the one route runs through a provider the person adds.
               Saying so, once, beside the thing it is about. */
            <button className="wa-say" onClick={onProviders}
                    title={t('Transcribing needs a provider that can do it. Add one in Settings.')}>
              <Icon name="sparkle" size={11} />
              {t('Set up transcription')}
            </button>
          )}
        </>
      );
    }

    return asFile();
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
          {/* ── reading voice notes ──────────────────────────────────────
              Its own section, because it is a different service with its own
              key, and because the panel is otherwise silent about why a voice
              note comes back unread. `voice.vylo-tech.com` is the default
              because it is the one with Kurdish engines — Badini and Sorani
              each have their own — and these conversations are in Kurdish.
              Leaving the key empty falls back to any OpenAI-shaped provider in
              Settings, which can do Arabic and English and not Kurdish. */}
          <p className="wa-sect">{t('Reading voice notes')}</p>
          <label>{t('Voice service')}
            <input value={vc.baseUrl} spellCheck={false}
                   onChange={(e) => setVc({ ...vc, baseUrl: e.target.value.replace(/\/+$/, '') })}
                   placeholder={BLANK_VOICE.baseUrl} /></label>
          <label>{t('Voice key')}
            <input value={vc.key} type="password" spellCheck={false}
                   onChange={(e) => setVc({ ...vc, key: e.target.value })}
                   placeholder="vsk_…" /></label>
          {/* A detector guesses well on a clear minute and badly on eight
              seconds from a phone in a noisy room, which is what a voice note
              is. Naming the language turns the guess into a given. */}
          <label>{t('Voice notes are in')}
            <select value={vc.lang} onChange={(e) => setVc({ ...vc, lang: langOf(e.target.value) })}>
              {VOICE_LANGS.map((code) => (
                <option key={code} value={code}>
                  {code === 'auto' ? t('Whichever language they are in')
                    : code === 'kmr' ? t('Kurdish — Badini')
                      : code === 'ckb' ? t('Kurdish — Sorani')
                        : code === 'ar' ? t('Arabic')
                          : t('English')}
                </option>
              ))}
            </select>
          </label>
          <label>{t('Effort')}
            <select value={vc.mode} onChange={(e) => setVc({ ...vc, mode: modeOf(e.target.value) })}>
              <option value="fast">{t('Fast — one pass')}</option>
              <option value="accurate">{t('Accurate — several engines, best for Kurdish')}</option>
            </select>
          </label>
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

  /* ── the pieces, so one panel can be a column or a window ────────────
     Fullscreen is not a second implementation of anything. It is these two
     views placed side by side instead of shown one at a time, which is the
     only reason it earns its place: 248px can hold the list or a
     conversation, and a window holds both, the way every desktop chat
     client people already use does. */
  const listView = () => (
      <div className="wa">
        <div className="sb-head-bar">
          <span className="sb-sub">{t('Chats')}</span>
          <button className="sb-act" onClick={() => setFull((v) => !v)}
                  title={full ? t('Leave full screen') : t('Full screen')}
                  aria-label={full ? t('Leave full screen') : t('Full screen')}>
            <Icon name={full ? 'restore' : 'maximise'} size={13} />
          </button>
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
                      <b dir="auto">{c.name}</b>
                      {/* The clock is part of the row, not a detail behind a
                          hover: "when" is half of what a chat list is for. */}
                      <time className="wa-when">{clockOf(c.at)}</time>
                    </span>
                    <span className="wa-line">
                      <span className="wa-last" dir="auto">
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

  const name = here?.name || phoneOf(open) || open;
  const group = isGroup(open);
  /** What is worth saying under the name, or '' when nothing is. */
  const sub = group ? t('Group chat') : phoneOf(open) ? `+${phoneOf(open)}` : '';

  const convoView = () => (
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
          {/* In a window the list is already on screen, so a Back button would
              point at something the eye is already on. */}
          {!full && (
            <button className="sb-act wa-back" onClick={() => setOpen('')} title={t('All chats')}
                    aria-label={t('All chats')}>
              <Icon name="chevron" size={13} turn={180} />
            </button>
          )}
          <span className={`wa-mark ${tintOf(open)} ${group ? 'group' : ''}`}>
            {group ? <Icon name="memory" size={13} /> : initialsOf(name)}
          </span>
          {/* A second line only when there is a second line to write.
              `+` in front of whatever digits were in the address had been
              drawing a `@lid` — WhatsApp's privacy identity — as a fifteen
              digit phone number that does not exist. Replacing it with "On
              WhatsApp" fixed the falsehood and left the filler: a subtitle
              under every name, in a header, saying the thing the panel is
              called. Nothing true to say means no line, and the name centres
              itself against the avatar instead. */}
          <span className={`wa-who${sub ? '' : ' alone'}`}>
            <b dir="auto">{name}</b>
            {sub && <span>{sub}</span>}
          </span>
          {/* A bare tick, sitting beside a contact's name in a chat app, reads
              as a delivery receipt — the one thing in that position it is not.
              A clipboard says collect, which is what picking messages is for. */}
          <button className="sb-act" onClick={() => setPicking(true)}
                  title={t('Pick messages')} aria-label={t('Pick messages')}>
            <Icon name="clipboard" size={13} />
          </button>
          <button className="sb-act" onClick={() => setFull((v) => !v)}
                  title={full ? t('Leave full screen') : t('Full screen')}
                  aria-label={full ? t('Leave full screen') : t('Full screen')}>
            <Icon name={full ? 'restore' : 'maximise'} size={13} />
          </button>
          {/* Change the connection lives on the chat list and only there.
              Back, an avatar, a name and three icon buttons do not fit in a
              248px column: the name was ellipsising to `Avr…` to make room
              for a control that belongs to the account rather than to this
              conversation. */}
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
              <span className="wa-from" dir="auto">{r.msg.who}</span>
            )}
            {body(r.msg)}
            {/* `dir="auto"` per message, not per panel. A thread holds Arabic,
                Kurdish and English at once — often in one conversation — and the
                direction of a line is a property of what it says, which is
                exactly the question `auto` answers from the first strong
                character. Inheriting the interface's direction put Arabic
                punctuation at the wrong end of English sentences and the other
                way round. */}
            {r.msg.text && <span className="wa-text" dir="auto">{r.msg.text}</span>}
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
        {/* What is about to go, before it goes. A photo shows itself: the whole
            point of picking one is knowing you picked the right one. */}
        {outbox.length > 0 && (
          <ul className="wa-out">
            {outbox.map((o, i) => (
              <li key={`${o.name}-${i}`} className={`wa-out-item ${o.as}`}>
                {o.as === 'image'
                  ? <img src={`data:${o.mime};base64,${o.data}`} alt={o.name} />
                  : <Icon name={o.as === 'video' ? 'camera' : o.as === 'audio' ? 'mic' : 'file'} size={13} />}
                <span>{o.name}</span>
                <button onClick={() => setOutbox((p) => p.filter((_, n) => n !== i))}
                        title={t('Remove')} aria-label={t('Remove')}>
                  <Icon name="close" size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {failed && <p className="wa-why">{failed}</p>}
        <div className="wa-box">
          <button className="wa-clip" onClick={() => void attach()} disabled={sending}
                  title={t('Attach a file')} aria-label={t('Attach a file')}>
            <Icon name="attach" size={13} />
          </button>
          <textarea value={draft} rows={1} dir="auto" placeholder={t('Write a reply…')}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
                    }} />
          {/* In the box rather than under it: the button belongs to the words
              being typed, and a composer that grows must not push its own Send
              off the bottom of a 248px column. */}
          <button className="wa-go" disabled={(!draft.trim() && outbox.length === 0) || sending}
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

  /**
   * A picture, at the size it was sent.
   *
   * A 248px column shows a photo 230px wide, which is enough to know it is
   * there and not enough to read a receipt or a screenshot of an error — which
   * is most of what people actually send. Clicking opens it over everything at
   * full size, and Escape or a click anywhere closes it.
   */
  const shot = preview && (
    <div className="wa-lens" onClick={() => setPreview(null)}
         role="dialog" aria-label={preview.name}>
      <img src={preview.url} alt={preview.name} onClick={(e) => e.stopPropagation()} />
      <div className="wa-lens-bar" onClick={(e) => e.stopPropagation()}>
        <span>{preview.name}</span>
        <a className="ghost" href={preview.url} download={preview.name}>
          <Icon name="attach" size={12} />{t('Save')}
        </a>
        <button className="ghost" onClick={() => setPreview(null)}>
          <Icon name="close" size={12} />{t('Close')}
        </button>
      </div>
    </div>
  );

  /* A column: one view at a time, as it has always been. */
  if (!full) {
    return (
      <>
        {open ? convoView() : listView()}
        {shot}
      </>
    );
  }

  /* The window: the list stays put and a conversation opens beside it. */
  return (
    <div className="wa-full">
      <aside className="wa-full-side">{listView()}</aside>
      <section className="wa-full-main">
        {open ? convoView() : (
          <p className="ft-empty">{t('Pick a conversation on the left.')}</p>
        )}
      </section>
      {shot}
    </div>
  );
}
