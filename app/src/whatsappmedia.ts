/**
 * WhatsApp attachments, and the honest limit on what "read it" can mean.
 *
 * Evolution keeps the bytes of a photo or a voice note on its own side and
 * hands them over on request, so fetching one is a call like any other. What
 * happens next is not uniform, and pretending it is would be the whole bug:
 *
 *   - **a photo, a sticker** become an `image` content block and the model
 *     genuinely looks at them
 *   - **a PDF** becomes a `document` block, likewise
 *   - **a text file** is folded into the prompt with a header
 *   - **a video** cannot be sent to the API at all. A still is taken from it
 *     instead — a real frame, labelled as one frame of a video, never as "the
 *     video"
 *   - **a voice note** cannot be turned into an `image` or a `document` block
 *     by anything here, and the API takes no audio. It is downloaded, played
 *     in the panel by the person, and handed to the model as a *line saying it
 *     exists and was not heard* — unless somebody pressed Transcribe on it, in
 *     which case `whatsappvoice.ts` has words and the panel passes those
 *     instead, attributed to whatever transcribed them
 *
 * That last one is the reason this module exists as its own file rather than a
 * function in the panel. "Every attachment can be read" is the thing to aim at
 * and it is not free: audio needs a service the person has added themselves,
 * and until they press the button there are no words. The failure mode of
 * glossing over that is specific and bad — the model is handed a message it
 * cannot perceive, is not told so, and answers about it anyway. `noteFor`
 * writes the sentence that stops it, and `readable` is the single place that
 * decides which case an attachment falls into, so the panel cannot drift from
 * the tool.
 */

import type { Attached } from './attachments';
import type { Kind, Msg } from './whatsapp';

/** What can actually be done with a downloaded attachment. */
export type Use =
  /** A real `image` block. The model sees it. */
  | 'image'
  /** A `document` block — a PDF, sent whole. */
  | 'doc'
  /** Folded into the prompt as text. */
  | 'text'
  /** One frame can be taken and sent as an image. */
  | 'frame'
  /** Nothing can be sent. It is named, and said to be unread. */
  | 'opaque';

/**
 * The four the Claude API accepts as an image, and only those.
 *
 * A `.heic` off an iPhone and an `image/svg+xml` are both `image/*` and
 * neither is accepted, so the test is a list rather than a prefix. Sending one
 * anyway fails the whole request, which would lose the message it was attached
 * to as well.
 */
const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']);

/** Extensions that carry words, for a `documentMessage` that is not a PDF. */
const TEXT_MIME = /^text\/|^application\/(json|xml|x-yaml|yaml|javascript|typescript|csv)$/i;

/** What a filename says it is, when nothing better is on offer. */
const BY_EXT: Array<[RegExp, Use]> = [
  [/\.(png|jpe?g|gif|webp)$/i, 'image'],
  [/\.pdf$/i, 'doc'],
  [/\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|log|ini|conf|html?|css|js|ts|tsx|jsx|py|rs|go|java|sh)$/i, 'text'],
  [/\.(mp4|mov|m4v|webm|3gp|avi|mkv)$/i, 'frame'],
  [/\.(ogg|oga|opus|mp3|m4a|aac|wav|amr)$/i, 'opaque'],
];

/**
 * What an attachment is good for.
 *
 * Three sources, in the order they can be trusted: the mimetype, then the
 * filename, then the envelope WhatsApp put it in.
 *
 * The filename is not a nicety. Sending a photo from WhatsApp as a *file* —
 * which is what "send as document" does, and what a forward often becomes —
 * arrives as a `documentMessage` with `application/octet-stream` or no
 * mimetype at all. Judged on those two alone a perfectly ordinary JPEG is
 * opaque, so the panel drew it as a grey row with a filename on it and, far
 * worse, the handover told the model it could not be read. A readable photo
 * being announced as unreadable is the same class of lie as an unread voice
 * note being passed off as read; it just points the other way.
 *
 * `application/octet-stream` is treated as absent rather than as a type,
 * because that is what it means: the server declined to say.
 */
export function readable(mime: string, kind?: Kind, name = ''): Use {
  const m = (mime || '').split(';')[0].trim().toLowerCase();
  const vague = !m || m === 'application/octet-stream' || m === 'binary/octet-stream';
  if (!vague) {
    if (IMAGE_MIME.has(m)) return 'image';
    if (m === 'application/pdf') return 'doc';
    if (TEXT_MIME.test(m)) return 'text';
    if (m.startsWith('video/')) return 'frame';
    if (m.startsWith('audio/')) return 'opaque';
    // A named type this app cannot use -- a .docx, a .heic. The filename adds
    // nothing, since it will agree with the mimetype that already lost.
    return 'opaque';
  }
  for (const [ext, use] of BY_EXT) if (ext.test(name)) return use;
  // Nothing but the envelope. A sticker is always webp and an image is always
  // one of the four; a document with no type and no extension is anybody's guess.
  if (kind === 'image' || kind === 'sticker') return 'image';
  if (kind === 'video') return 'frame';
  if (kind === 'audio') return 'opaque';
  return 'opaque';
}

/**
 * What an attachment is, with the bytes given the last word.
 *
 * `readable` takes a mimetype because it is also asked about things that have
 * not been downloaded. This is the form to use once the payload is in hand:
 * the file's own first bytes, then the server's claim, then the filename.
 *
 * `'unknown'` is distinct from `'opaque'` and the difference matters. Opaque
 * means "this is audio and nothing here can read audio" — a known thing with a
 * known limit. Unknown means the payload matches no format at all, which is not
 * a limit, it is a fault, and the person should be told that rather than shown
 * a picture that will not draw.
 */
export function useOf(media: Media, kind?: Kind): Use | 'unknown' {
  if (media.sniffed) return readable(media.sniffed, kind, media.name);
  const claimed = readable(media.mime, kind, media.name);
  // Nothing in the bytes, and the claim was that it is something renderable.
  // The claim loses: an `<img>` was going to refuse these bytes anyway, and a
  // broken picture explains nothing.
  if (claimed === 'image' || claimed === 'frame') return 'unknown';
  return claimed;
}

/** Whether the panel can play it for the person, whatever the model can do. */
export const playable = (mime: string): boolean =>
  /^(audio|video)\//i.test(mime || '');

/** Whether a message has bytes behind it worth fetching at all. */
export const hasMedia = (m: Msg): boolean =>
  m.kind === 'image' || m.kind === 'video' || m.kind === 'audio'
  || m.kind === 'document' || m.kind === 'sticker';

/* ── asking Evolution for the bytes ──────────────────────────────────────── */

/** The path, given an instance. */
export const mediaPath = (instance: string): string =>
  `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`;

/**
 * The body.
 *
 * The whole key rather than the id alone: Evolution has wanted both shapes
 * across versions, and a key with every field on it satisfies either. `keyId`
 * and not `id` — see the note on `Msg.keyId` for why that distinction is the
 * difference between bytes and a 404.
 */
export const mediaBodyFor = (m: Msg): unknown => ({
  message: { key: { id: m.keyId || m.id, remoteJid: m.jid, fromMe: m.fromMe } },
  convertToMp4: false,
});

export interface Media {
  base64: string;
  mime: string;
  name: string;
  bytes: number;
  /**
   * What the first bytes say the file is, or '' when they say nothing known.
   *
   * The authority, above the server's own `mime` and above the filename. Both
   * of those are claims; this is the file. An empty string is itself a finding
   * and the panel says so out loud — a payload of the right *size* whose first
   * bytes match no format is not a picture that failed to draw, it is not a
   * picture.
   */
  sniffed: string;
}

/* ── what the bytes actually are ─────────────────────────────────────────
   Every format worth carrying announces itself in its first few bytes, and
   those bytes are the only thing in this exchange that cannot be wrong. The
   server's mimetype is a claim, the filename is a claim, and both were
   believed in turn while a photo refused to draw.

   Decoded by hand rather than through `atob`, so this module stays arithmetic:
   the test suite runs it with no DOM, and a decoder that throws inside a render
   would take the panel with it. */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** The first `n` bytes of a base64 payload. Tolerates base64url and padding. */
export function leadBytes(base64: string, n = 16): number[] {
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (let i = 0; i < base64.length && out.length < n; i++) {
    const ch = base64[i];
    // base64url spells two characters differently; the bytes are the same.
    const v = B64.indexOf(ch === '-' ? '+' : ch === '_' ? '/' : ch);
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return out;
}

const starts = (b: number[], sig: number[], at = 0): boolean =>
  sig.every((byte, i) => b[at + i] === byte);

/**
 * The media type the bytes themselves declare, or '' for nothing recognised.
 *
 * '' is not a failure to look — it is the answer that the payload is not any
 * media this app knows, which is exactly the thing worth telling somebody when
 * a photo will not open.
 */
export function sniff(base64: string): string {
  const b = leadBytes(base64, 16);
  if (b.length < 4) return '';
  if (starts(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts(b, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts(b, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  // RIFF....WEBP
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b, [0x57, 0x41, 0x56, 0x45], 8)) return 'audio/wav';
  if (starts(b, [0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (starts(b, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg';
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';
  if (starts(b, [0x49, 0x44, 0x33])) return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (starts(b, [0x50, 0x4b, 0x03, 0x04])) return 'application/zip';
  // ....ftyp — an ISO container. The brand says whether it is sound or picture.
  if (starts(b, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(M4A|M4B)/.test(brand)) return 'audio/mp4';
    if (/^qt/.test(brand)) return 'video/quicktime';
    return 'video/mp4';
  }
  return '';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * The bytes out of whatever shape came back.
 *
 * Written defensively for the same reason `messagesFrom` is: this is a server
 * somebody else runs, at a version we do not choose, and the field has been
 * called `base64`, `data` and `buffer` in ones we have seen. Returning null for
 * an unrecognised body is how the panel says "could not fetch that" instead of
 * rendering an image element with the string "undefined" in its src.
 */
export function mediaFrom(body: unknown, fallbackName = 'file'): Media | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const inner = (b.media && typeof b.media === 'object' ? b.media : b) as Record<string, unknown>;

  let data = str(inner.base64) || str(inner.data) || str(inner.buffer) || str(b.base64);
  if (!data) return null;
  // Some builds answer with a full data: URL. Keep the payload; the mimetype
  // in it is worth reading too, since those builds tend to omit the field.
  let mime = str(inner.mimetype) || str(inner.mediaType) || str(inner.mimeType) || str(b.mimetype);
  const asUrl = /^data:([^;,]+)[^,]*,(.*)$/s.exec(data);
  if (asUrl) {
    if (!mime) [, mime] = asUrl;
    [, , data] = asUrl;
  }
  data = data.replace(/\s+/g, '');
  if (!data) return null;

  const name = str(inner.fileName) || str(inner.filename) || str(b.fileName) || fallbackName;
  // base64 is 4 characters per 3 bytes, less the padding.
  const pad = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return {
    base64: data,
    mime: mime.trim(),
    name,
    bytes: Math.max(0, (data.length * 3) / 4 - pad),
    sniffed: sniff(data),
  };
}

/**
 * The media type to hand a Blob that an `<img>`, `<audio>` or `<video>` will
 * point at.
 *
 * Not the server's own, when the server's own is `application/octet-stream` or
 * absent. A blob URL carries its type to the element, and an element given a
 * type that is not a media type is entitled to refuse it — WebKit is stricter
 * here than Chromium, and this app runs in WebKit on macOS. The image then
 * falls back to its `alt`, which is how a photo came to be drawn in the panel
 * as its own filename in a box.
 *
 * `readable` already worked out what the thing actually is, from the filename
 * when the mimetype declined to say. This turns that back into a type the
 * element will accept.
 */
export function displayMime(media: Media, kind?: Kind): string {
  // The bytes outrank everything. They are the only claim in this exchange
  // that cannot be wrong, and believing the other two in turn is what left a
  // photo drawing as its own filename.
  if (media.sniffed) return media.sniffed;
  const use = readable(media.mime, kind, media.name);
  const vague = !media.mime || /octet-stream/i.test(media.mime);
  if (!vague) return media.mime === 'image/jpg' ? 'image/jpeg' : media.mime;
  if (use === 'image') {
    if (/\.png$/i.test(media.name)) return 'image/png';
    if (/\.gif$/i.test(media.name)) return 'image/gif';
    if (/\.webp$/i.test(media.name)) return 'image/webp';
    return 'image/jpeg';
  }
  if (use === 'doc') return 'application/pdf';
  if (use === 'text') return 'text/plain';
  if (use === 'frame') return /\.webm$/i.test(media.name) ? 'video/webm' : 'video/mp4';
  return media.mime || 'application/octet-stream';
}

/* ── turning it into something the composer holds ────────────────────────── */

let seq = 0;
const nextId = (): string => `wa_${Date.now()}_${seq++}`;

/** A sensible filename when WhatsApp sent none, so the tray is not six "file"s. */
export function nameFor(m: Msg, media: Media): string {
  if (media.name && media.name !== 'file') return media.name;
  const ext = (media.mime.split('/')[1] || 'bin').split('+')[0];
  const stamp = m.at ? new Date(m.at).toISOString().slice(0, 16).replace(/[:T]/g, '-') : 'wa';
  return `whatsapp-${m.kind}-${stamp}.${ext}`;
}

/**
 * The attachment, or null when there is nothing the model could do with it.
 *
 * Null is not a failure and the caller must not report it as one — it is the
 * audio case, and `noteFor` is what gets said instead.
 */
export function toAttached(m: Msg, media: Media, decoded?: string): Attached | null {
  const name = nameFor(m, media);
  const use = readable(media.mime, m.kind, name);
  if (use === 'image') {
    // `image/jpg` is not a media type the API knows, though half the world
    // writes it. It is the same bytes.
    const mediaType = IMAGE_MIME.has(media.mime) && media.mime !== 'image/jpg'
      ? media.mime
      : mimeByName(name);
    return { kind: 'image', id: nextId(), name, mediaType, data: media.base64, bytes: media.bytes };
  }
  if (use === 'doc') {
    return { kind: 'doc', id: nextId(), name, data: media.base64, bytes: media.bytes };
  }
  if (use === 'text') {
    // Decoding base64 needs `atob`, which is the DOM's. The caller passes the
    // decoded string so this file stays arithmetic and testable.
    if (decoded === undefined) return null;
    return {
      kind: 'text', id: nextId(), name, text: decoded,
      bytes: media.bytes, truncated: false,
    };
  }
  // 'frame' is handled by the caller, which has a <video> to draw from, and
  // 'opaque' has no representation at all.
  return null;
}

/**
 * What to say about an attachment in the text handed to the model.
 *
 * Every attachment gets a line, including the ones that came through whole —
 * the model is given a photo with no filename and no sender, and a transcript
 * that skips straight from one message to the next leaves it guessing which
 * image belongs where.
 *
 * The audio line is the load-bearing one. It says the file was not heard, in
 * the transcript, next to the message it belongs to, so a model summarising the
 * conversation cannot quietly invent what was in it.
 */
/**
 * The media type to put on the wire for an image, from its name.
 *
 * Reached whenever the server's own mimetype was absent, vague or `image/jpg`
 * — which is not a type the API knows, though half the world writes it. The
 * bytes are the same either way; what matters is that the header names one of
 * the four the API accepts, because a request carrying anything else fails
 * whole and takes the message it was attached to with it.
 */
function mimeByName(name: string): string {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}

export function noteFor(m: Msg, media: Media | null, use: Use): string {
  const what = kindWord(m.kind);
  if (!media) return `[${what}: could not be downloaded]`;
  const name = nameFor(m, media);
  const kb = media.bytes < 1024 ? `${Math.round(media.bytes)} B` : `${Math.round(media.bytes / 1024)} KB`;
  if (use === 'image') return `[${what}: ${name}, attached below]`;
  if (use === 'doc') return `[document: ${name}, attached below]`;
  if (use === 'text') return `[file: ${name}, contents attached below]`;
  if (use === 'frame') return `[video: ${name}, ${kb} — one frame of it is attached below; the video itself was not sent and its sound was not heard]`;
  return `[${what}: ${name}, ${kb} — NOT read. Nothing in this app can transcribe audio or open this format, so its contents are unknown. Do not guess at them.]`;
}

function kindWord(k: Kind): string {
  if (k === 'image') return 'photo';
  if (k === 'video') return 'video';
  if (k === 'audio') return 'voice note';
  if (k === 'document') return 'document';
  if (k === 'sticker') return 'sticker';
  return 'attachment';
}

/* ── sending one ─────────────────────────────────────────────────────────
   The other direction. Evolution takes a photo, a video or a file on one
   endpoint and a voice note on another, because a voice note is not an audio
   file to WhatsApp — it is a recording with a waveform, and sending one down
   the media route arrives as an attachment nobody can play in place. */

export const sendMediaPath = (instance: string): string =>
  `/message/sendMedia/${encodeURIComponent(instance)}`;

export const sendAudioPath = (instance: string): string =>
  `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`;

/** What WhatsApp calls the thing being sent. */
export type SendAs = 'image' | 'video' | 'audio' | 'document';

/** Types WhatsApp will render in place rather than hand over as a file. */
const SEND_IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const SEND_VIDEO = /\.(mp4|mov|m4v|3gp)$/i;
const SEND_AUDIO = /\.(ogg|oga|opus|mp3|m4a|aac|wav|amr)$/i;

/**
 * How to send a file, by what it is.
 *
 * By extension and mimetype together, and `document` is the fallback rather
 * than an error: WhatsApp will carry anything as a file, so a `.zip` or a
 * `.xlsx` still goes — it simply arrives as something to download instead of
 * something to look at. Refusing it would be this app deciding what people are
 * allowed to send each other.
 *
 * A `.webm` is deliberately not video here. WhatsApp does not play it in place
 * on most phones, so it travels as a file and arrives openable, rather than as
 * a video that will not play.
 */
export function sendAs(name: string, mime = ''): SendAs {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (SEND_IMAGE.test(name) || /^image\/(png|jpe?g|gif|webp)$/.test(m)) return 'image';
  if (SEND_VIDEO.test(name) || /^video\/(mp4|quicktime|3gpp)$/.test(m)) return 'video';
  if (SEND_AUDIO.test(name) || m.startsWith('audio/')) return 'audio';
  return 'document';
}

/** A media type for the wire, from the filename when nothing else says. */
export function sendMime(name: string, mime = ''): string {
  const m = mime.split(';')[0].trim().toLowerCase();
  if (m && m !== 'application/octet-stream') return m === 'image/jpg' ? 'image/jpeg' : m;
  const ext = (name.split('.').pop() || '').toLowerCase();
  const known: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', '3gp': 'video/3gpp',
    ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg',
    m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', amr: 'audio/amr',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  };
  return known[ext] || 'application/octet-stream';
}

export interface Outgoing {
  /** The file, base64, with no `data:` prefix. */
  data: string;
  name: string;
  mime: string;
  as: SendAs;
}

/**
 * The request body for one outgoing file.
 *
 * `number` is whatever addresses the conversation: the digits for an ordinary
 * contact, and the jid itself for a group or a `@lid`, neither of which has a
 * number to give. The caller resolves that, the same way `send` already does
 * for text.
 *
 * The caption rides on the media rather than being sent as a second message,
 * which is how WhatsApp shows a photo with words under it rather than a photo
 * followed by a line of text from the same person a moment later.
 */
export function sendBody(number: string, out: Outgoing, caption = ''): unknown {
  if (out.as === 'audio') {
    // This endpoint takes no caption, and there is nowhere to put one: a voice
    // note has no text. The caller sends the words separately when there are any.
    return { number, audio: out.data };
  }
  return {
    number,
    mediatype: out.as,
    mimetype: out.mime,
    media: out.data,
    fileName: out.name,
    ...(caption ? { caption } : {}),
  };
}

/* ── the transcript that goes with them ──────────────────────────────────── */

export interface Line {
  msg: Msg;
  /** The note for its attachment, when it has one. */
  note?: string;
}

/**
 * The selected messages, as text for the composer.
 *
 * Named and dated at the top, because a conversation arriving in a chat with no
 * header is a wall of quotes the model has to guess the provenance of. Times on
 * every line: "they replied an hour later" is often the whole content of a
 * conversation.
 */
export function handoverOf(lines: readonly Line[], who: string): string {
  if (lines.length === 0) return '';
  const day = (at: number) => (at
    ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : '');
  const clock = (at: number) => (at
    ? new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : '');

  const first = lines[0].msg.at;
  const last = lines[lines.length - 1].msg.at;
  const when = day(first) && day(first) !== day(last) ? `${day(first)} – ${day(last)}` : day(first);
  const head = `WhatsApp · ${who}${when ? ` · ${when}` : ''}`;

  const body = lines.map(({ msg, note }) => {
    const from = msg.fromMe ? 'me' : (msg.who || who);
    const at = clock(msg.at);
    const said = [msg.text.trim(), note].filter(Boolean).join(' ');
    return `[${at}] ${from}: ${said || '(no text)'}`;
  });
  return [head, ...body].join('\n');
}
