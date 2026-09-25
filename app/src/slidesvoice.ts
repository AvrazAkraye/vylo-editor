import type { Provider } from './providers';
import {
  VOICE_KEY, acceptsName, backendFor, endpointOf, formFor, jobIdFrom, jobPath, jobState, modelFor, readVoice, textFrom,
  transcribePath, uploadHeaders, voiceForm, voiceHeaders, type Backend,
} from './whatsappvoice';

/**
 * Speaking to the slides: what the person says into the Chat tab's
 * microphone, written down by the transcription service they set up.
 *
 * ## Why not the composer's dictation
 *
 * The composer's microphone (dictate.ts) is the webview's own speech engine,
 * and no engine has a Kurdish model — `recognitionLang` says so, and falls
 * back to the OS language. For the people this app is made for, that means a
 * Sorani or Badini sentence comes back as nonsense. Vylo Voice has an engine
 * for each (whatsappvoice.ts), so when it is set up, this records the message
 * and sends the recording there; an OpenAI-shaped provider in Settings is the
 * second choice, as it is for WhatsApp's voice notes. Only when neither is
 * set up does the Chat tab fall back to the webview's dictation, which serves
 * Arabic and English.
 *
 * ## When it listens, and where the audio goes
 *
 * The microphone is open only between the press that starts a recording and
 * the press that ends it — or `MAX_SPEECH_MS`, whichever is first — and the
 * button says, before it is pressed, which service the recording will go to.
 * The recording lives in memory, goes to that one service, and is dropped;
 * nothing is kept. The words that come back are shown in the conversation as
 * the person's message: they are a request to the deck's model, whose answer
 * changes the deck only through the checked operations of slideschatops.ts, and
 * one undo takes it back. Nothing spoken reaches the disk or a shell.
 *
 * The key rule holds, through whatsappvoice.ts's records: **a key is only ever
 * sent to the URL it was entered beside.**
 */

/** The longest recording: a spoken instruction, not a lecture. */
export const MAX_SPEECH_MS = 60_000;

/** Formats a recorder can make, most wanted first: m4a in WebKit (macOS), webm in Chromium (Windows). */
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'] as const;

/** The format to record in, of those `supports` accepts; `null` when none. */
export function recordingType(supports: (type: string) => boolean): string | null {
  for (const t of TYPES) {
    try {
      if (supports(t)) return t;
    } catch { /* a recorder that throws on a question does not support it */ }
  }
  return null;
}

/**
 * The file name the recording is uploaded under. Vylo Voice checks the name,
 * not the bytes, and answers 422 for an extension it does not list — so the
 * name says what the bytes are.
 */
export function speechFileName(type: string): string {
  if (/mp4|m4a|aac/i.test(type)) return 'speech.m4a';
  if (/ogg/i.test(type)) return 'speech.ogg';
  return 'speech.webm';
}

/** Who writes down what the person says, as WhatsApp's voice notes find one: Vylo Voice first, for its Kurdish. */
export function speechBackend(providers: readonly Provider[]): Backend | null {
  let stored: string | null = null;
  try { stored = localStorage.getItem(VOICE_KEY); } catch { /* storage refused: no service kept */ }
  return backendFor(readVoice(stored), providers);
}

/** Why a transcription failed, as a code the panel says in the interface's language. */
export type VoiceTrouble = 'refused' | 'status' | 'slow' | 'format' | 'failed';

export class SpeechError extends Error {
  constructor(readonly trouble: VoiceTrouble, readonly detail = '') {
    super(detail || trouble);
    this.name = 'SpeechError';
  }
}

interface TranscribeOptions {
  name: string;
  signal?: AbortSignal;
  /** The network, passed in so a test can answer for it. */
  fetch?: typeof fetch;
  /** Waiting between polls, passed in so a test need not. */
  wait?: (ms: number) => Promise<void>;
  /** Polls of a Vylo Voice job before giving up: about a minute. */
  tries?: number;
}

const pause = (ms: number) => new Promise<void>((done) => { setTimeout(done, ms); });

/**
 * The words in a recording, written down by `backend`.
 *
 * Vylo Voice queues the recording and hands back a job, polled until the words
 * are ready; an OpenAI-shaped provider answers in one round trip. Nothing is
 * translated: the model reads the words as they were said, in any of the four
 * languages. Throws a `SpeechError` for a refusal the person can act on, and
 * the platform's `AbortError` when `signal` fires.
 */
export async function transcribe(backend: Backend, audio: Blob, o: TranscribeOptions): Promise<string> {
  const get = o.fetch ?? fetch;
  const wait = o.wait ?? pause;
  const stopped = () => {
    if (o.signal?.aborted) throw new DOMException('The request was stopped.', 'AbortError');
  };
  if (backend.kind === 'vylo') {
    const v = backend.voice;
    if (!acceptsName(o.name)) throw new SpeechError('format', o.name);
    const up = await get(transcribePath(v), {
      method: 'POST', headers: voiceHeaders(v), body: voiceForm(audio, o.name, { lang: v.lang, mode: v.mode, translate: '' }), signal: o.signal,
    });
    if (up.status === 401 || up.status === 403) throw new SpeechError('refused');
    if (!up.ok) throw new SpeechError('status', String(up.status));
    const id = jobIdFrom(await up.json());
    if (!id) throw new SpeechError('failed');
    for (let n = 0; n < (o.tries ?? 40); n++) {
      await wait(1500);
      stopped();
      const r = await get(jobPath(v, id), { headers: voiceHeaders(v), signal: o.signal });
      if (!r.ok) throw new SpeechError('status', String(r.status));
      const state = jobState(await r.json());
      if (!state.done) continue;
      if ('failed' in state) throw new SpeechError('failed', state.failed);
      return state.text.trim();
    }
    throw new SpeechError('slow');
  }
  const p = backend.provider;
  const r = await get(endpointOf(p), {
    method: 'POST', headers: uploadHeaders(p), body: formFor(audio, o.name, modelFor(p), 'auto'), signal: o.signal,
  });
  if (r.status === 401 || r.status === 403) throw new SpeechError('refused');
  if (!r.ok) throw new SpeechError('status', String(r.status));
  return textFrom(await r.json());
}

/**
 * One recording from the microphone: `start`, then `stop` for what was said.
 *
 * The microphone's tracks are stopped the moment the recording ends, however
 * it ends — `stop`, `cancel`, the time limit, or the component going away —
 * so the system's recording light goes out with it.
 */
export class Recorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private timer: number | null = null;
  private done: ((b: Blob | null) => void) | null = null;
  type = '';

  /** Whether this webview can record at all, for deciding whether to offer it. */
  static available(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  }

  /** Open the microphone and start recording. `onLimit` is called when the time limit ends it. */
  async start(onLimit: () => void): Promise<void> {
    const type = recordingType((t) => MediaRecorder.isTypeSupported(t));
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.type = type ?? '';
    this.rec = type ? new MediaRecorder(this.stream, { mimeType: type }) : new MediaRecorder(this.stream);
    this.type = this.rec.mimeType || this.type || 'audio/webm';
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.onstop = () => {
      const blob = this.chunks.length ? new Blob(this.chunks, { type: this.type }) : null;
      this.release();
      this.done?.(blob);
      this.done = null;
    };
    this.rec.start();
    this.timer = window.setTimeout(onLimit, MAX_SPEECH_MS);
  }

  /** End the recording and hand back what was said, or `null` for nothing. */
  stop(): Promise<Blob | null> {
    const rec = this.rec;
    if (!rec || rec.state === 'inactive') { this.release(); return Promise.resolve(null); }
    return new Promise((resolve) => {
      this.done = resolve;
      rec.stop();
    });
  }

  /** End it and forget it: nothing is sent anywhere. */
  cancel(): void {
    this.done = null;
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch { /* already over */ }
    this.release();
  }

  private release(): void {
    if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
    this.rec = null;
  }
}
