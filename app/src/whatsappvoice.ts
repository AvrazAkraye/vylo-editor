/**
 * Turning a voice note into words.
 *
 * Two services can do it and they are not alike.
 *
 * **Vylo Voice** (`voice.vylo-tech.com`) is the one this is built around,
 * because it is the one that speaks the languages these conversations are
 * actually in: Badini and Sorani as well as Arabic and English. It takes a
 * recording, queues it, and hands back a job to poll — so transcribing is a
 * conversation with a server rather than one request, and the panel has to
 * wait politely rather than block.
 *
 * **Any OpenAI-shaped provider** the person added in Settings answers
 * `/v1/audio/transcriptions` in one round trip. Kept as the fallback for
 * somebody who has an OpenAI or Groq key and no Vylo Voice account. Its model
 * was never trained on Kurdish, so it is the second choice here rather than
 * the first, which is the reverse of how it was built a release ago.
 *
 * ## It is never automatic
 *
 * A voice note is somebody's voice. Sending one to a server is not a thing to
 * do because a panel was scrolled, so nothing here runs on render, on a timer,
 * or as part of a handover. It runs when a person presses Transcribe on one
 * particular message, having been shown where it is going.
 *
 * ## The key rule holds
 *
 * `providers.ts` states it and this obeys it: **a key is only ever sent to the
 * URL it was entered beside.** Each backend below carries its own address and
 * its own key in one record, and there is no argument here that could pair one
 * service's key with another's address.
 */

import { headersFor, type Provider } from './providers';

/* ── Vylo Voice ──────────────────────────────────────────────────────────── */

/** Where the service lives, unless somebody runs their own. */
export const VOICE_URL = 'https://voice.vylo-tech.com';

/** Where the connection is kept. Versioned, like every other stored setting. */
export const VOICE_KEY = 'vylo.voice.v1';

export interface Voice {
  baseUrl: string;
  /** `vsk_…`. Sent only to `baseUrl`. */
  key: string;
  lang: VoiceLang;
  /** `accurate` runs several engines and reconciles them. Kurdish gains most. */
  mode: Mode;
  /** What to translate into as well, or '' to leave the words as they were said. */
  translate: Target | '';
}

/**
 * What the service will translate into.
 *
 * Its own list, from `translate.py`. Arabic and English are the obvious pair;
 * both Kurdishes are there because the service was built for people who move
 * between them, and it writes Kurdish in the Arabic-based script rather than
 * Latin — which is the script these conversations are in.
 */
export const TARGETS = ['en', 'ar', 'ckb', 'kmr'] as const;
export type Target = (typeof TARGETS)[number];

export const targetOf = (raw: unknown): Target | '' =>
  (TARGETS as readonly string[]).includes(raw as string) ? (raw as Target) : '';

export type Mode = 'fast' | 'accurate';

/**
 * The languages the service actually has engines for.
 *
 * Kurdish is on this list, and that is the whole reason to prefer this backend.
 * A previous release offered Arabic and English only and said Kurdish could not
 * be done — true of the Whisper behind the OpenAI-shaped services, and not true
 * here, where Badini and Sorani each have an engine of their own.
 */
export const VOICE_LANGS = ['auto', 'kmr', 'ckb', 'ar', 'en'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

export const langOf = (raw: unknown): VoiceLang =>
  (VOICE_LANGS as readonly string[]).includes(raw as string) ? (raw as VoiceLang) : 'auto';

export const modeOf = (raw: unknown): Mode => (raw === 'accurate' ? 'accurate' : 'fast');

/** A language named outright: what a person picks when the guess was wrong. */
export type SpokenLang = Exclude<VoiceLang, 'auto'>;
export const SPOKEN: readonly SpokenLang[] = ['ar', 'ckb', 'kmr', 'en'];

/** Letters of the Arabic script, without its digits and punctuation. */
const ARABIC_LETTER = /[\u0621-\u064A\u0671-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FC\u0750-\u077F]/g;
/** Letters Kurdish writes and Arabic does not: ڕ ڵ ێ ۆ ە ڤ ۊ. */
const KURDISH_LETTER = /[\u0695\u06B5\u06CE\u06C6\u06D5\u06A4\u06CA]/g;
const LATIN_LETTER = /[A-Za-z\u00C0-\u024F]/g;
/** Kurmanji in Latin letters, as Badini is often typed on a phone. */
const KURMANJI_LATIN = /[êîûçşÊÎÛÇŞ]/g;
const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;

/**
 * The language a voice note is most likely in, from what the same chat wrote.
 *
 * "Whichever language they are in" leaves the guess to the server, which makes
 * it from the audio alone — and on two seconds from a phone it guesses badly:
 * an Arabic «السلام عليكم» came back as English, in Latin letters. That guess
 * also never reaches the Kurdish engines; the server only chooses among its
 * general model's languages. The chat's own writing is better evidence. Arabic
 * letters with none of Kurdish's own mean Arabic. ڕ ڵ ێ ۆ ە ڤ mean Kurdish,
 * with ڤ leaning Badini and ڵ Sorani, and `kurdish` settling a tie. Latin with
 * ê î û ç ş is Badini typed in Latin. Anything else stays the server's guess.
 */
export function langFromText(texts: readonly string[], kurdish: 'ckb' | 'kmr' = 'ckb'): VoiceLang {
  const s = texts.join(' ').replace(/https?:\/\/\S+/g, ' ');
  const arabic = count(s, ARABIC_LETTER);
  const latin = count(s, LATIN_LETTER);
  if (arabic >= 4 && arabic >= latin) {
    const kurd = count(s, KURDISH_LETTER);
    // Kurdish writes these letters constantly — ە alone is one letter in ten —
    // and Arabic never does; one stray ڤ in a long Arabic chat (ڤيديو) is a
    // loanword, while one in a short «سڵاو» is the whole message.
    const share = kurd / arabic;
    if (share < 0.02 || (kurd < 2 && share < 0.1)) return 'ar';
    const badini = count(s, /\u06A4/g);
    const sorani = count(s, /\u06B5/g);
    return badini > sorani ? 'kmr' : sorani > badini ? 'ckb' : kurdish;
  }
  if (latin >= 4 && count(s, KURMANJI_LATIN) >= 2) return 'kmr';
  return 'auto';
}

/**
 * The language to send with one voice note.
 *
 * What the person picked for this chat comes first — they heard the result and
 * corrected it. Then the setting, when it names a language. Only when it is
 * left to chance does the chat's writing decide.
 */
export function noteLang(o: {
  chat?: VoiceLang; setting: VoiceLang; texts: readonly string[]; kurdish?: 'ckb' | 'kmr';
}): VoiceLang {
  if (o.chat && o.chat !== 'auto') return o.chat;
  if (o.setting !== 'auto') return o.setting;
  return langFromText(o.texts, o.kurdish);
}

/** Where the language picked for each chat is kept. */
export const NOTE_LANG_KEY = 'vylo.whatsapp.notelang.v1';
/** Chats remembered at most; the oldest choice goes first. */
export const NOTE_LANG_KEEP = 300;

/** The languages picked per chat, repaired. */
export function readNoteLangs(raw: string | null): Record<string, SpokenLang> {
  const out: Record<string, SpokenLang> = {};
  try {
    const o = raw ? JSON.parse(raw) : null;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
    for (const [jid, lang] of Object.entries(o as Record<string, unknown>)) {
      if (jid && (SPOKEN as readonly unknown[]).includes(lang)) out[jid] = lang as SpokenLang;
    }
  } catch { /* a broken record is no record */ }
  return out;
}

/** Remember `lang` for `jid`, newest last, keeping at most `NOTE_LANG_KEEP`. */
export function withNoteLang(m: Record<string, SpokenLang>, jid: string, lang: SpokenLang): Record<string, SpokenLang> {
  const rest = Object.entries(m).filter(([k]) => k !== jid);
  return Object.fromEntries([...rest.slice(-(NOTE_LANG_KEEP - 1)), [jid, lang]]);
}

/**
 * The spoken language for the Slides chat's microphone.
 *
 * The setting when it names one. Otherwise the interface's language, then the
 * deck's, when either is Arabic or Kurdish — somebody talking to their slides
 * talks in one of those, and "auto" would never reach a Kurdish engine. English
 * stays the server's guess, which it makes well.
 */
export function micLang(setting: VoiceLang, ...hints: (string | undefined)[]): VoiceLang {
  if (setting !== 'auto') return setting;
  const named = hints.find((h): h is 'ar' | 'ckb' | 'kmr' => h === 'ar' || h === 'ckb' || h === 'kmr');
  return named ?? 'auto';
}

export const BLANK_VOICE: Voice = { baseUrl: VOICE_URL, key: '', lang: 'auto', mode: 'fast', translate: '' };

const trim = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

/** A stored connection, repaired. A bad one is the empty form, never a throw. */
export function readVoice(raw: string | null): Voice {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object') return { ...BLANK_VOICE };
    const o = v as Record<string, unknown>;
    return {
      baseUrl: trim(o.baseUrl).replace(/\/+$/, '') || VOICE_URL,
      key: trim(o.key),
      lang: langOf(o.lang),
      mode: modeOf(o.mode),
      translate: targetOf(o.translate),
    };
  } catch {
    return { ...BLANK_VOICE };
  }
}

export const writeVoice = (v: Voice): string => JSON.stringify(v);

/** Whether there is enough to try a call at all. */
export const voiceReady = (v: Voice): boolean => Boolean(v.baseUrl && v.key);

export const transcribePath = (v: Pick<Voice, 'baseUrl'>): string => `${v.baseUrl}/api/transcribe`;
export const jobPath = (v: Pick<Voice, 'baseUrl'>, id: string): string =>
  `${v.baseUrl}/api/jobs/${encodeURIComponent(id)}`;

/**
 * Both credentials this service takes arrive the same way, and the `vsk_`
 * prefix is what tells a durable key from a dashboard session. No content-type
 * here: the browser writes the multipart boundary and a header we set would
 * have none in it.
 */
export const voiceHeaders = (v: Pick<Voice, 'key'>): Record<string, string> =>
  ({ authorization: `Bearer ${v.key}` });

/**
 * The extensions the server will accept.
 *
 * It checks the filename, not the bytes, and answers 422 for anything else —
 * which is why `whatsappmedia.ts` corrects the extension of a converted voice
 * note before it is sent. A `.oga` name on an mp4 would be refused here for a
 * reason nobody could guess from the message.
 */
export const VOICE_SUFFIXES = /\.(mp3|m4a|mp4|wav|ogg|oga|opus|webm|flac|aac|wma|amr|3gp|mkv|mov)$/i;

export const acceptsName = (name: string): boolean => VOICE_SUFFIXES.test(name);

/** The upload. `File` and not `Blob`, so the server sees the filename it checks. */
export function voiceForm(
  audio: Blob, name: string, v: Pick<Voice, 'lang' | 'mode' | 'translate'>,
): FormData {
  const form = new FormData();
  form.append('file', new File([audio], name, { type: audio.type || 'audio/mp4' }));
  // `auto` is a real value to this service, unlike the OpenAI one where the
  // field has to be omitted. It is in the server's own language list.
  form.append('language', v.lang);
  form.append('mode', v.mode);
  // Omitted when there is nothing to translate into. The server refuses an
  // unknown target rather than ignoring it, and '' is not one of its four.
  if (v.translate) form.append('translate_to', v.translate);
  return form;
}

/** The job id out of the answer to an upload. */
export function jobIdFrom(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  return trim(b.id);
}

export type JobState =
  | { done: false; progress: number }
  /**
   * Both, when a translation was asked for.
   *
   * The transcript is what was said and the translation is a second machine's
   * reading of it. Showing only the translation — which an earlier draft of
   * this did — throws away the one of the two that is closer to the recording,
   * and leaves somebody who speaks the language nothing to check against.
   */
  | { done: true; text: string; translation: string; heard: VoiceLang }
  | { done: true; failed: string };

/**
 * Where a job has got to.
 *
 * `queued` and `processing` are both "not yet"; `done` carries the words and
 * `failed` carries a reason. Anything unrecognised is treated as still running
 * rather than as finished — a poll that gives up early on a status this app has
 * not heard of would report silence for a recording that was about to arrive.
 */
export function jobState(body: unknown): JobState {
  if (!body || typeof body !== 'object') return { done: false, progress: 0 };
  const b = body as Record<string, unknown>;
  const status = trim(b.status);
  if (status === 'failed') {
    return { done: true, failed: trim(b.error) || 'The recording could not be transcribed.' };
  }
  if (status === 'done') {
    // Both can be empty on a recording with no speech in it, which is itself
    // an answer and not a failure.
    // `heard` is the language the server settled on — its guess, when it was
    // asked to make one — or 'auto' for one it has no engine of its own for.
    return { done: true, text: trim(b.transcript), translation: trim(b.translation), heard: langOf(trim(b.detected_language)) };
  }
  const p = Number(b.progress);
  return { done: false, progress: Number.isFinite(p) ? p : 0 };
}

/* ── the OpenAI-shaped fallback ──────────────────────────────────────────── */

/**
 * Where a transcription request goes on an OpenAI-shaped service.
 *
 * Alongside `/v1/chat/completions` rather than derived from it, because both
 * are siblings under the same base URL in every service that offers them.
 */
export const endpointOf = (p: Pick<Provider, 'baseUrl'>): string =>
  `${p.baseUrl}/v1/audio/transcriptions`;

/**
 * The model to ask for.
 *
 * Services disagree — OpenAI has `whisper-1` and `gpt-4o-transcribe`, Groq has
 * `whisper-large-v3`. The person's own model list is consulted first, since
 * somebody who added a transcription model has already said which one they
 * want; `whisper-1` is the fallback because most services answer to it.
 */
export function modelFor(p: Pick<Provider, 'models'>): string {
  const named = p.models.find((m) => /whisper|transcri/i.test(m));
  return named || 'whisper-1';
}

/**
 * The provider a voice note would go to, or null when there is none.
 *
 * Only `openai`-wire providers: Anthropic's API has no transcription endpoint,
 * and the built-in gateway is not in this list at all — it answers
 * `/v1/audio/transcriptions` with 404, which was checked rather than assumed.
 */
export function transcriberIn(providers: readonly Provider[]): Provider | null {
  return providers.find((p) => p.wire === 'openai' && p.key && p.baseUrl) ?? null;
}

/** The multipart body for the OpenAI shape. */
export function formFor(
  audio: Blob, name: string, model: string, lang: VoiceLang = 'auto',
): FormData {
  const form = new FormData();
  form.append('file', new File([audio], name, { type: audio.type || 'audio/mp4' }));
  form.append('model', model);
  form.append('response_format', 'json');
  // Omitted rather than sent as "auto", which is not a language code there and
  // which a strict server would refuse. Absent *is* how that API spells
  // automatic. Kurdish is dropped rather than sent: Whisper was not trained on
  // it, and `ckb` or `kmr` would be refused or answered with nonsense — auto at
  // least makes the guess visible as a guess.
  if (lang !== 'auto' && lang !== 'ckb' && lang !== 'kmr') form.append('language', lang);
  return form;
}

/**
 * Auth headers for a multipart request.
 *
 * `headersFor` sets `content-type: application/json`, which is right for chat
 * and wrong here — the browser has to write the multipart boundary itself, and
 * a content-type we set would have no boundary in it. So the JSON one is
 * dropped and the rest kept, rather than the authorization header being
 * rebuilt here where it could drift.
 */
export function uploadHeaders(p: Pick<Provider, 'wire' | 'key'>): Record<string, string> {
  const headers = { ...headersFor(p) };
  delete headers['content-type'];
  return headers;
}

/** The words out of an OpenAI-shaped answer, whatever shape it came in. */
export function textFrom(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  if (typeof b.text === 'string') return b.text.trim();
  const choices = Array.isArray(b.choices) ? b.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content.trim();
  return '';
}

/* ── which one ───────────────────────────────────────────────────────────── */

export type Backend =
  | { kind: 'vylo'; name: string; voice: Voice }
  | { kind: 'openai'; name: string; provider: Provider };

/**
 * Who will transcribe, if anybody.
 *
 * Vylo Voice first when it is set up: it is the only one of the two with
 * Kurdish engines, and these conversations are in Kurdish. Null means nothing
 * is configured, and the panel draws a route to Settings rather than a button
 * that cannot work.
 */
export function backendFor(voice: Voice, providers: readonly Provider[]): Backend | null {
  if (voiceReady(voice)) return { kind: 'vylo', name: 'Vylo Voice', voice };
  const p = transcriberIn(providers);
  return p ? { kind: 'openai', name: p.name, provider: p } : null;
}

/**
 * How a transcript is introduced, wherever it is shown or sent.
 *
 * Always attributed, never presented as if the words were typed. A machine
 * transcript of a voice note is a guess, and a summary built on it should be
 * able to say where it came from.
 */
export const transcriptNote = (text: string, by: string, translation = ''): string => {
  const said = `[voice note, transcribed by ${by}]: ${text}`;
  // The translation is a second machine reading the first machine's output, so
  // it is labelled as its own step rather than folded in as if it were what
  // the person said.
  return translation ? `${said}\n[translated]: ${translation}` : said;
};
