/**
 * Speaking, in WhatsApp — the other direction from `whatsappvoice.ts`.
 *
 * That module turns a voice note into words. This one turns words into a
 * voice note, and reads an arriving message out loud.
 *
 * ## Two sources, because they are two different jobs
 *
 * **Reading a message aloud** is the browser's own `speechSynthesis`. It is
 * free, it is instant, it needs no key and no network, and macOS ships voices
 * for Arabic. Sending a request to a paid endpoint so that somebody can hear
 * one line of a chat would be charging them for something their computer
 * already does.
 *
 * **Sending a voice note** cannot use it. `speechSynthesis` speaks to the
 * speakers and hands back nothing — there is no audio to attach. That needs a
 * real endpoint that returns bytes, which is the OpenAI-shaped
 * `/audio/speech`, reached through the same provider list `whatsappvoice.ts`
 * finds a transcriber in, and under the same rule: **a key is only ever sent
 * to the address it was entered beside.**
 *
 * ## The language is chosen from the words
 *
 * A voice picked once in a settings box is the wrong voice for most of this
 * inbox. The thread is Arabic, Sorani, Badini and English, often in one
 * conversation, and an English voice reading Arabic produces something between
 * an accent and nonsense. So the script is read off the text and the voice is
 * chosen per message; see `scriptOf` and `voiceFor`.
 *
 * ## Nothing here sends anything
 *
 * This is arithmetic over strings: which provider could do it, what the
 * request body looks like, where to cut a long message. The panel does the
 * fetching, and the *person* does the sending — a voice note leaves this
 * machine because somebody pressed a button that says so, one at a time.
 */

import type { Provider } from './providers';

/** Where the speech settings are kept. Versioned, like every other one. */
export const TTS_KEY = 'vylo.whatsapp.tts.v1';

/**
 * The most text one request may carry.
 *
 * The OpenAI shape refuses more than this and says so, which is a worse way to
 * find out than not asking. A message longer than it is read in pieces — see
 * `chunks` — rather than cut, because the end of a message is as often the
 * point as the beginning.
 */
export const SPOKEN_MAX = 4000;

export interface Speech {
  /** The model id, as the provider names it. */
  model: string;
  /** The voice, as the provider names it. */
  voice: string;
  /** 0.25 to 4. One is the voice's own pace. */
  speed: number;
}

export const BLANK_SPEECH: Speech = { model: 'tts-1', voice: 'alloy', speed: 1 };

const num = (v: unknown, fallback: number): number =>
  (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Stored settings, repaired.
 *
 * A bad record is the defaults, never a throw: this runs before the panel
 * draws, and a settings box that will not open is worse than one that has
 * forgotten what was in it.
 */
export function readSpeech(raw: string | null): Speech {
  if (!raw) return { ...BLANK_SPEECH };
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object') return { ...BLANK_SPEECH };
    const r = v as Record<string, unknown>;
    const model = typeof r.model === 'string' && r.model.trim() ? r.model.trim() : BLANK_SPEECH.model;
    const voice = typeof r.voice === 'string' && r.voice.trim() ? r.voice.trim() : BLANK_SPEECH.voice;
    // Outside the range the endpoint refuses the whole request, so a stored
    // value that has gone wrong costs the feature rather than one playback.
    const speed = Math.min(4, Math.max(0.25, num(r.speed, BLANK_SPEECH.speed)));
    return { model, voice, speed };
  } catch {
    return { ...BLANK_SPEECH };
  }
}

export const writeSpeech = (s: Speech): string => JSON.stringify(s);

/** Whether there is enough here to ask anything. */
export const canSpeak = (s: Speech): boolean => Boolean(s.model.trim() && s.voice.trim());

/**
 * A provider that could turn text into audio.
 *
 * The same test `transcriberIn` makes, and deliberately so: `/audio/speech`
 * and `/audio/transcriptions` sit on the same base in the same shape, so a
 * provider that can do one is the one to ask for the other. The first is
 * taken rather than the "best", because there is no way to rank them without
 * asking, and asking would send a key somewhere to find out whether it was
 * worth sending it there.
 */
export function speakerIn(providers: readonly Provider[]): Provider | null {
  return providers.find((p) => p.wire === 'openai' && p.key && p.baseUrl) ?? null;
}

/**
 * Where the request goes. Built from the provider's own base and nothing else.
 * Bases are stored without `/v1` (providers.ts `normalizeBase` strips it), so
 * it is put back here — as `whatsappvoice.ts` does for transcription — and not
 * doubled for a base that still carries it.
 */
export const speechPath = (p: Pick<Provider, 'baseUrl'>): string => {
  const base = p.baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(base) ? `${base}/audio/speech` : `${base}/v1/audio/speech`;
};

/** The headers for it. The key goes to `speechPath` and to no other address. */
export const speechHeaders = (p: Pick<Provider, 'key'>): Record<string, string> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${p.key}`,
});

/**
 * What a voice note is asked for in.
 *
 * `mp3`, and not because it is the best of them. WhatsApp wants Opus in an
 * Ogg container and Evolution converts whatever it is given, so the only real
 * requirement is that the conversion has something it recognises to work
 * from — and mp3 is the one format every one of these endpoints returns.
 * Asking for `opus` directly would be a shorter path on the providers that
 * offer it and an error on the ones that do not.
 */
export const SEND_FORMAT = 'mp3';


/** The request body. `format` is separate because reading aloud never needs it. */
export function speechBody(text: string, s: Speech, format: string = SEND_FORMAT): unknown {
  return {
    model: s.model,
    input: text,
    voice: s.voice,
    response_format: format,
    ...(s.speed !== 1 ? { speed: s.speed } : {}),
  };
}

/**
 * A long message, in pieces small enough to ask for.
 *
 * Cut at a sentence end where there is one within reach, then at a space, and
 * only mid-word when a single word is longer than the whole allowance — which
 * is a pasted URL, and cutting one of those anywhere is equally wrong.
 *
 * The pieces are *spoken in turn* rather than stitched together: joining two
 * mp3s is a job for a decoder, and a pause between two sentences is what a
 * person reading aloud would have done anyway.
 */
export function chunks(text: string, max = SPOKEN_MAX): string[] {
  const src = (typeof text === 'string' ? text : '').trim();
  if (!src) return [];
  const cap = Math.max(1, Math.floor(max));
  if (src.length <= cap) return [src];

  const out: string[] = [];
  let rest = src;
  while (rest.length > cap) {
    const window = rest.slice(0, cap);
    // A sentence end, in the scripts this inbox uses. `؟` and `،` are the
    // Arabic question mark and comma, and a message can end on either.
    const stop = Math.max(
      window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
      window.lastIndexOf('\n'), window.lastIndexOf('؟ '), window.lastIndexOf('۔'),
    );
    const space = window.lastIndexOf(' ');
    // Within reach: a sentence end in the first fifth of the window is not a
    // place to cut, it is a place to start the next piece almost empty.
    const at = stop > cap * 0.4 ? stop + 1 : space > cap * 0.4 ? space : cap;
    const piece = rest.slice(0, at).trim();
    if (piece) out.push(piece);
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Which script a message is in, for choosing a voice to read it.
 *
 * Counted rather than detected: the first strong character is what `dir=auto`
 * uses and it is the wrong rule here, because "OK تمام شكرا" is an Arabic
 * message that opens in Latin. Whichever script most of the letters belong to
 * is the one to read it in.
 *
 * Kurdish is reported as Arabic script deliberately. It *is* Arabic script,
 * no speech service offers a Sorani or Badini voice, and an Arabic voice
 * reading Kurdish is at least reading the right letters — which is the
 * honest best available rather than a claim that it is right.
 */
export function scriptOf(text: string): 'arabic' | 'latin' | 'other' {
  const src = typeof text === 'string' ? text : '';
  let arabic = 0;
  let latin = 0;
  for (const ch of src) {
    if (ch >= '؀' && ch <= 'ۿ') arabic += 1;
    else if (ch >= 'ݐ' && ch <= 'ݿ') arabic += 1;
    else if (ch >= 'ࢠ' && ch <= 'ࣿ') arabic += 1;
    else if (ch >= 'ﭐ' && ch <= '﷿') arabic += 1;
    else if (ch >= 'ﹰ' && ch <= '﻿') arabic += 1;
    else if (/[a-z]/i.test(ch)) latin += 1;
  }
  if (!arabic && !latin) return 'other';
  return arabic >= latin ? 'arabic' : 'latin';
}

/**
 * A `speechSynthesis` language tag for a message, or `''` for "whatever the
 * system would have chosen".
 *
 * Only ever a *hint*: the voice list is the operating system's, and a machine
 * with no Arabic voice installed gets the default one rather than silence.
 */
export function langOf(text: string): string {
  const script = scriptOf(text);
  return script === 'arabic' ? 'ar' : script === 'latin' ? 'en' : '';
}

/** One voice out of what the system offers, for a language. */
export interface SpokenVoice {
  name: string;
  lang: string;
}

/**
 * The best of the system's voices for a message, or `null` for its default.
 *
 * An exact language match first, then any voice whose tag starts with the
 * same language — `ar-SA` and `ar-EG` read Arabic equally well for this
 * purpose, and preferring one over the other would be a claim about dialect
 * that a chat app has no basis for.
 */
export function voiceFor(text: string, voices: readonly SpokenVoice[]): SpokenVoice | null {
  const want = langOf(text);
  if (!want) return null;
  const tag = (v: SpokenVoice) => (v.lang ?? '').toLowerCase().replace('_', '-');
  return voices.find((v) => tag(v) === want)
    ?? voices.find((v) => tag(v).split('-')[0] === want)
    ?? null;
}

/**
 * Whether a message is worth offering to read at all.
 *
 * Words, and enough of them to be a sentence rather than a tick. Reading
 * "ok" aloud takes longer to start than to hear.
 */
export const worthSpeaking = (text: string): boolean =>
  (typeof text === 'string' ? text : '').trim().length >= 3;
