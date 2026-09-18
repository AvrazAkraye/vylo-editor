// WhatsApp attachments, and the line between what is read and what is not.
//
// The formatting assertions here are ordinary. The ones that matter are about
// audio, and they are the reason the module exists as its own file.
//
// The request was "every attachment should be able to read it". For photos,
// stickers, PDFs and text files that is straightforwardly true. For a voice
// note it is not true and cannot be made true in this app: there is no
// transcription anywhere in it — `dictate.ts` is the browser's speech engine
// listening to a microphone and cannot be pointed at a file, and the gateway
// forwards `/v1/messages` and nothing else.
//
// So the failure this file is built around is not a crash. It is a voice note
// being handed to a model that cannot hear it, without being told, and the
// model answering about its contents anyway — a summary of a conversation with
// a confident sentence in it that nobody ever said. `noteFor` writes the line
// that prevents that, and these assertions are what keep the line there.
import {
  handoverOf, hasMedia, mediaBodyFor, mediaFrom, mediaPath, nameFor, noteFor,
  playable, readable, toAttached,
} from '../.test-build/whatsappmedia.js';
import { messagesFrom } from '../.test-build/whatsapp.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const REBAZ = '9647501112233@s.whatsapp.net';
const one = (envelope, { at = 1_700_000_000, me = false, who = '', keyId = 'WAKEY1' } = {}) => {
  const [m] = messagesFrom({ messages: { records: [{
    id: 'row-id-not-the-key',
    key: { remoteJid: REBAZ, fromMe: me, id: keyId },
    message: envelope,
    messageTimestamp: at,
    pushName: who,
  }] } });
  return m;
};
const IMG = one({ imageMessage: { caption: 'look' } });
const AUD = one({ audioMessage: {} });
const VID = one({ videoMessage: { caption: '' } });
const DOC = one({ documentMessage: { caption: '' } });
const TXT = one({ conversation: 'hello' });

// ── what a type is good for ───────────────────────────────────────────────
{
  ok('a jpeg is an image', readable('image/jpeg') === 'image');
  ok('so is a png, a gif and a webp',
     ['image/png', 'image/gif', 'image/webp'].every((m) => readable(m) === 'image'));
  // `image/*` is not the test. A HEIC off an iPhone and an SVG are both
  // image/… and the API accepts neither; sending one fails the whole request
  // and loses the message it was attached to as well.
  ok('but a HEIC is not', readable('image/heic') === 'opaque');
  ok('and neither is an SVG', readable('image/svg+xml') === 'opaque');
  ok('a PDF is a document', readable('application/pdf') === 'doc');
  ok('text is text', readable('text/plain') === 'text' && readable('application/json') === 'text');
  ok('a video offers a frame', readable('video/mp4') === 'frame');
  ok('audio offers nothing', readable('audio/ogg; codecs=opus') === 'opaque');
  ok('a parameter on the mimetype is ignored', readable('image/jpeg; charset=binary') === 'image');
  ok('case does not matter', readable('IMAGE/JPEG') === 'image');

  // Evolution does not always send a mimetype.
  ok('with no mimetype the envelope decides', readable('', 'image') === 'image');
  ok('a sticker with no mimetype is an image', readable('', 'sticker') === 'image');
  ok('a video with no mimetype offers a frame', readable('', 'video') === 'frame');
  ok('audio with no mimetype is still opaque', readable('', 'audio') === 'opaque');
  ok('and nothing at all is opaque', readable('', undefined) === 'opaque');

  ok('audio and video play', playable('audio/ogg') && playable('video/mp4'));
  ok('a PDF does not', !playable('application/pdf'));

  ok('media messages are known', [IMG, AUD, VID, DOC].every(hasMedia));
  ok('and a text message is not', !hasMedia(TXT));
}

// ── asking for the bytes ──────────────────────────────────────────────────
{
  ok('the path carries the instance', mediaPath('my instance').includes('my%20instance'));
  const body = mediaBodyFor(IMG);
  // `id` is Evolution's row id and the media endpoint does not know it. Only
  // `key.id` fetches anything, and folding the two together returns nothing
  // while looking exactly like a message with no media.
  ok('the body asks by the WhatsApp key, not the row id',
     body.message.key.id === 'WAKEY1', JSON.stringify(body.message.key));
  ok('and carries the conversation', body.message.key.remoteJid === REBAZ);
}

// ── reading the answer ────────────────────────────────────────────────────
{
  const DATA = 'aGVsbG8gd29ybGQ='; // "hello world"
  ok('the ordinary shape', mediaFrom({ base64: DATA, mimetype: 'image/png' }).base64 === DATA);
  ok('nested under media', mediaFrom({ media: { base64: DATA, mimetype: 'image/png' } }).mime === 'image/png');
  // Field names this server has used across versions. A shape that is not
  // recognised must come back null, not as an <img> with "undefined" in it.
  ok('called data', mediaFrom({ data: DATA, mimeType: 'image/png' }).base64 === DATA);
  ok('called buffer', mediaFrom({ buffer: DATA, mediaType: 'image/png' }).base64 === DATA);
  ok('a data: URL is unwrapped', mediaFrom({ base64: `data:image/png;base64,${DATA}` }).base64 === DATA);
  ok('and its mimetype is taken from it',
     mediaFrom({ base64: `data:image/png;base64,${DATA}` }).mime === 'image/png');
  ok('whitespace in the payload goes', mediaFrom({ base64: 'aGVs\nbG8g\nd29ybGQ=' }).base64 === DATA);

  ok('nothing is null', mediaFrom(null) === null);
  ok('an empty object is null', mediaFrom({}) === null);
  ok('an error body is null', mediaFrom({ status: 404, message: 'not found' }) === null);
  ok('an empty payload is null', mediaFrom({ base64: '' }) === null);

  ok('the size is worked out from the base64', mediaFrom({ base64: DATA }).bytes === 11);
  ok('and a filename is kept', mediaFrom({ base64: DATA, fileName: 'bill.pdf' }).name === 'bill.pdf');
  ok('or invented from the kind and the clock',
     /^whatsapp-image-.*\.png$/.test(nameFor(IMG, { base64: DATA, mime: 'image/png', name: 'file', bytes: 11 })));
}

// ── what becomes an attachment ────────────────────────────────────────────
{
  const media = (mime, name = 'file') => ({ base64: 'AAAA', mime, name, bytes: 3 });

  const img = toAttached(IMG, media('image/jpeg'));
  ok('a photo becomes an image attachment', img.kind === 'image' && img.data === 'AAAA');
  // Half the world writes image/jpg and the API does not know it. Same bytes.
  ok('image/jpg is corrected to image/jpeg',
     toAttached(IMG, media('image/jpg')).mediaType === 'image/jpeg');
  ok('a sticker is an image too',
     toAttached(one({ stickerMessage: {} }), media('image/webp')).kind === 'image');
  ok('a PDF becomes a document', toAttached(DOC, media('application/pdf')).kind === 'doc');
  ok('a text file becomes text',
     toAttached(DOC, media('text/plain'), 'the contents').text === 'the contents');
  ok('and without the decoded text it is not guessed at',
     toAttached(DOC, media('text/plain')) === null);

  // The two that cannot be sent. Null here is not an error and the caller must
  // not report one -- it is the whole audio case.
  ok('a voice note becomes no attachment', toAttached(AUD, media('audio/ogg')) === null);
  ok('and a video is left to the frame grab', toAttached(VID, media('video/mp4')) === null);
}

// ── the sentence that stops an invented summary ───────────────────────────
{
  const media = (mime, name) => ({ base64: 'AAAA', mime, name, bytes: 40000 });

  const audio = noteFor(AUD, media('audio/ogg', 'ptt.ogg'), 'opaque');
  ok('a voice note says it was not read', /NOT read/.test(audio), audio);
  ok('and says why', /transcribe/.test(audio), audio);
  // The instruction is the point. Without it a model summarising a thread
  // writes a plausible sentence about what the voice note said.
  ok('and tells the model not to guess', /Do not guess/.test(audio), audio);
  ok('it names the file and the size', audio.includes('ptt.ogg') && audio.includes('39 KB'));

  const video = noteFor(VID, media('video/mp4', 'clip.mp4'), 'frame');
  ok('a video says it is one frame', /one frame/.test(video), video);
  // "the video" would be a claim the attachment does not support.
  ok('and never calls the still the video', !/^\[video: clip\.mp4, attached/.test(video));
  ok('and says the sound was not heard', /sound was not heard/.test(video), video);

  ok('a photo just says it is attached', /attached below/.test(noteFor(IMG, media('image/jpeg', 'a.jpg'), 'image')));
  ok('a failed download says so', /could not be downloaded/.test(noteFor(IMG, null, 'opaque')));
  // A photo that failed and a voice note that cannot be read are different
  // facts and must not collapse into one sentence.
  ok('which is not the same sentence as "not read"', !/NOT read/.test(noteFor(IMG, null, 'opaque')));
}

// ── the transcript ────────────────────────────────────────────────────────
{
  const day = new Date(2026, 0, 15, 9, 0, 0).getTime() / 1000;
  const a = one({ conversation: 'morning' }, { at: day, who: 'Rebaz' });
  const b = one({ conversation: 'all green' }, { at: day + 60, me: true });
  const c = one({ audioMessage: {} }, { at: day + 120, who: 'Rebaz' });

  const out = handoverOf([
    { msg: a }, { msg: b },
    { msg: c, note: '[voice note: ptt.ogg, 39 KB — NOT read.]' },
  ], 'Rebaz');

  ok('it is headed', out.split('\n')[0].startsWith('WhatsApp · Rebaz'));
  ok('mine is me', out.includes('me: all green'));
  ok('theirs is named', out.includes('Rebaz: morning'));
  ok('every line is timed', out.split('\n').slice(1).every((l) => /^\[\d{1,2}[:.]\d{2}/.test(l.trim()) || /^\[\d/.test(l)));
  ok('the note rides with its message', out.includes('NOT read'));
  // A message with an attachment and no caption still has to be a line, or the
  // conversation silently loses a turn and reads as if nobody answered.
  ok('a wordless message still gets a line', out.split('\n').length === 4, out);

  ok('nothing selected is nothing said', handoverOf([], 'Rebaz') === '');

  const across = handoverOf([
    { msg: one({ conversation: 'a' }, { at: day }) },
    { msg: one({ conversation: 'b' }, { at: day + 86400 * 2 }) },
  ], 'Rebaz');
  ok('a selection spanning days says so', across.split('\n')[0].includes('–'), across.split('\n')[0]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
