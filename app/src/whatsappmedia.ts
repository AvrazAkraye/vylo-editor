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
  return { base64: data, mime: mime.trim(), name, bytes: Math.max(0, (data.length * 3) / 4 - pad) };
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
