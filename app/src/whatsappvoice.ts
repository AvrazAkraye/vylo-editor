/**
 * Turning a voice note into words.
 *
 * Until now this app could not do it, and said so: `whatsappmedia.ts` hands a
 * voice note to the model as a line stating it was not heard. That was the
 * honest answer while the only service in reach was the gateway, which
 * forwards `/v1/messages` and nothing else — and `dictate.ts`, which is the
 * browser's speech engine listening to a microphone and cannot be pointed at
 * a file.
 *
 * There is one more thing in reach, and the person put it there themselves.
 * Every OpenAI-shaped provider in Settings → Model providers — OpenAI, Groq, a
 * whisper.cpp server on their own machine — exposes `/v1/audio/transcriptions`
 * beside the `/v1/chat/completions` this app already uses. Same base URL, same
 * key, same record. So the capability exists exactly when the person has
 * already chosen to trust a service with their text, and not otherwise.
 *
 * ## It is never automatic
 *
 * A voice note is somebody's voice. Sending one to a third party is not a
 * thing to do because a panel was scrolled, so nothing here runs on render, on
 * a timer, or as part of a handover. It runs when a person presses Transcribe
 * on one particular message, having been shown which provider it is going to.
 * That is the same shape as the rest of the app: the gate is a person, and the
 * dialog is the button's own label.
 *
 * ## The key rule holds
 *
 * `providers.ts` states it and this obeys it: **a key is only ever sent to the
 * URL it was entered beside.** `endpointOf` and `headersFor` are built from
 * one `Provider` record, exactly as `endpointFor` is for chat, and there is no
 * argument here that could pair one provider's key with another's address.
 */

import { headersFor, type Provider } from './providers';

/**
 * Where a transcription request goes.
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
 * `whisper-large-v3`, a local server has whatever it was started with. The
 * person's own model list is consulted first, since somebody who added a
 * transcription model to a provider has already said which one they want;
 * `whisper-1` is the fallback because it is the name the most services answer
 * to.
 */
export function modelFor(p: Pick<Provider, 'models'>): string {
  const named = p.models.find((m) => /whisper|transcri/i.test(m));
  return named || 'whisper-1';
}

/**
 * The provider a voice note would go to, or null when there is none.
 *
 * Only `openai`-wire providers: Anthropic's API has no transcription endpoint,
 * and the built-in gateway is not in this list at all — it forwards
 * `/v1/messages` and would answer a transcription request with a 404. Offering
 * a button that cannot work is worse than offering none, because the person
 * presses it and learns nothing from what comes back.
 */
export function transcriberIn(providers: readonly Provider[]): Provider | null {
  return providers.find((p) => p.wire === 'openai' && p.key && p.baseUrl) ?? null;
}

/**
 * Which language the recording is in, when the person knows.
 *
 * Whisper detects a language on its own and is good at it on a clear minute of
 * speech. It is much less good on the thing this panel is full of: eight
 * seconds, a phone microphone, a noisy room. Naming the language turns a guess
 * into a given, and for Arabic that is the difference between a transcript and
 * a paragraph of something that looked like Persian.
 *
 * Kurdish is deliberately absent. Whisper's training set does not include
 * Sorani or Badini, and offering a choice that quietly produces nonsense — or
 * an error from the provider — is worse than not offering it. `auto` is what
 * Kurdish gets, and whatever the model makes of it is visibly a guess.
 */
export const VOICE_LANGS = ['auto', 'ar', 'en'] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];

/** Where the choice is kept. Not in `Conn`: it is not part of the connection. */
export const LANG_KEY = 'vylo.whatsapp.voice.v1';

export const langOf = (raw: unknown): VoiceLang =>
  (VOICE_LANGS as readonly string[]).includes(raw as string) ? (raw as VoiceLang) : 'auto';

/** The multipart body. `File` and not `Blob`, so the server sees a filename. */
export function formFor(
  audio: Blob, name: string, model: string, lang: VoiceLang = 'auto',
): FormData {
  const form = new FormData();
  form.append('file', new File([audio], name, { type: audio.type || 'audio/ogg' }));
  form.append('model', model);
  // `json` and not `verbose_json`: the words are the whole point and the
  // segments would be thrown away.
  form.append('response_format', 'json');
  // Omitted rather than sent as "auto", which is not a language code and which
  // a strict server would refuse. Absent *is* how the API spells automatic.
  if (lang !== 'auto') form.append('language', lang);
  return form;
}

/**
 * Auth headers for a multipart request.
 *
 * `headersFor` sets `content-type: application/json`, which is right for chat
 * and wrong here — the browser has to write the multipart boundary itself, and
 * a content-type we set would have no boundary in it and the upload would be
 * unparseable. So the JSON one is dropped and the rest kept, rather than the
 * authorization header being rebuilt here where it could drift.
 */
export function uploadHeaders(p: Pick<Provider, 'wire' | 'key'>): Record<string, string> {
  const headers = { ...headersFor(p) };
  delete headers['content-type'];
  return headers;
}

/** The words out of the answer, whatever shape it came in. */
export function textFrom(body: unknown): string {
  if (typeof body === 'string') return body.trim();
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  if (typeof b.text === 'string') return b.text.trim();
  // Some servers answer in the chat shape. Cheap to accept.
  const choices = Array.isArray(b.choices) ? b.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  if (typeof message?.content === 'string') return message.content.trim();
  return '';
}

/**
 * How a transcript is introduced, wherever it is shown or sent.
 *
 * Always attributed, never presented as if the words were typed. A machine
 * transcript of a voice note in a language this app does not check is a guess,
 * and a summary built on it should be able to say where it came from.
 */
export const transcriptNote = (text: string, by: string): string =>
  `[voice note, transcribed by ${by}]: ${text}`;
