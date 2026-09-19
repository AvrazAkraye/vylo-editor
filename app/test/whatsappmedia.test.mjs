// WhatsApp attachments, and the line between what is read and what is not.
//
// The formatting assertions here are ordinary. The ones that matter are about
// audio, and they are the reason the module exists as its own file.
//
// The request was "every attachment should be able to read it". For photos,
// stickers, PDFs and text files that is straightforwardly true. For a voice
// note it is true only once somebody has pressed Transcribe — the API takes no
// audio, and the words have to come from a provider the person added
// themselves (`whatsappvoice.ts`). Before that press there are no words.
//
// So the failure this file is built around is not a crash. It is a voice note
// being handed to a model that cannot hear it, without being told, and the
// model answering about its contents anyway — a summary of a conversation with
// a confident sentence in it that nobody ever said. `noteFor` writes the line
// that prevents that, and these assertions are what keep the line there.
import {
  displayMime, handoverOf, hasMedia, mediaBodyFor, mediaFrom, mediaPath, nameFor,
  noteFor, playable, readable, sendAs, sendAudioPath, sendBody, sendMediaPath,
  sendMime, sniff, toAttached, useOf,
} from '../.test-build/whatsappmedia.js';
import { isPhone, messagesFrom, phoneOf } from '../.test-build/whatsapp.js';

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

// ── a photo sent as a file ────────────────────────────────────────────────
//
// This was a live bug, visible in the panel: a JPEG arrived as a `.wa-doc`
// row with a hex filename on it instead of as the picture. WhatsApp's "send as
// document", and many forwards, produce a `documentMessage` whose mimetype is
// `application/octet-stream` or missing entirely.
//
// The drawing was the smaller half. The handover told the model the file could
// NOT be read — a readable photo announced as unreadable, which is the same
// class of lie as an unheard voice note passed off as heard, pointing the
// other way.
{
  const asDoc = (name, mime) => [mime, 'document', name];
  ok('a jpeg sent as a file is a photo', readable(...asDoc('IMG-20260918-WA0001.jpeg', '')) === 'image');
  ok('even with octet-stream on it',
     readable(...asDoc('3A0B66D4AADC14926802.jpeg', 'application/octet-stream')) === 'image');
  ok('binary/octet-stream too',
     readable(...asDoc('a.png', 'binary/octet-stream')) === 'image');
  ok('a PDF sent the same way is a document', readable(...asDoc('invoice.pdf', '')) === 'doc');
  ok('an mp4 offers a frame', readable(...asDoc('clip.mp4', '')) === 'frame');
  ok('an opus file is still opaque', readable(...asDoc('ptt.opus', '')) === 'opaque');
  ok('a csv is text', readable(...asDoc('rows.csv', '')) === 'text');
  ok('and something unguessable stays opaque', readable(...asDoc('archive.zip', '')) === 'opaque');
  ok('a document with no name and no type is opaque', readable('', 'document', '') === 'opaque');

  // A real mimetype still wins: it is the thing the server actually asserted,
  // and a `.docx` whose name ends in something familiar must not sneak past it.
  ok('a real mimetype outranks the name',
     readable('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 'notes.txt') === 'opaque');
  ok('and a HEIC named .heic is still refused', readable('image/heic', 'document', 'x.heic') === 'opaque');

  // The media type on the wire has to be one the API knows, whatever the
  // server said -- a request carrying anything else fails whole.
  const media = (mime, name) => ({ base64: 'AAAA', mime, name, bytes: 3 });
  const doc = one({ documentMessage: { caption: '' } });
  ok('an untyped .png goes over as image/png',
     toAttached(doc, media('', 'shot.png')).mediaType === 'image/png');
  ok('an untyped .jpeg goes over as image/jpeg',
     toAttached(doc, media('application/octet-stream', 'a.jpeg')).mediaType === 'image/jpeg');
  ok('a .webp keeps its own type', toAttached(doc, media('', 's.webp')).mediaType === 'image/webp');
  ok('and image/jpg is still corrected', toAttached(doc, media('image/jpg', 'a.jpg')).mediaType === 'image/jpeg');

  // And the note must now say it IS attached, not that it was not read.
  const note = noteFor(doc, media('application/octet-stream', 'a.jpeg'), 'image');
  ok('the handover calls it attached', /attached below/.test(note), note);
  ok('and no longer says it was not read', !/NOT read/.test(note), note);
}

// ── the type an element will accept ───────────────────────────────────────
//
// A blob URL carries its type through to the `<img>`, and an element handed a
// type that is not a media type may refuse it. That refusal is what drew a
// photo in the panel as its own filename in a box: the picture failed, and
// `alt` is the filename.
{
  const md = (mime, name) => ({ base64: 'AAAA', mime, name, bytes: 3 });
  ok('octet-stream on a .jpeg becomes image/jpeg',
     displayMime(md('application/octet-stream', 'a.jpeg'), 'document') === 'image/jpeg');
  ok('and nothing at all on a .png becomes image/png',
     displayMime(md('', 'shot.png'), 'document') === 'image/png');
  ok('a .webp keeps its own', displayMime(md('', 's.webp'), 'document') === 'image/webp');
  ok('a video gets a video type', displayMime(md('', 'clip.mp4'), 'document') === 'video/mp4');
  ok('and a webm gets its own', displayMime(md('', 'clip.webm'), 'document') === 'video/webm');
  ok('a PDF gets application/pdf', displayMime(md('application/octet-stream', 'x.pdf'), 'document') === 'application/pdf');
  // A server that did say something keeps saying it.
  ok('a real type is left alone', displayMime(md('image/png', 'x.bin'), 'document') === 'image/png');
  ok('except image/jpg, which no decoder is asked to know',
     displayMime(md('image/jpg', 'x.jpg'), 'image') === 'image/jpeg');
  ok('audio keeps its own type', displayMime(md('audio/ogg', 'p.ogg'), 'audio') === 'audio/ogg');
  // The panel asks `playable` about the resolved type, so a video sent as a
  // file has to come back playable or it would be drawn as a row to download.
  ok('a video sent as a file is playable once resolved',
     playable(displayMime(md('application/octet-stream', 'clip.mp4'), 'document')));
  ok('and a PDF is still not', !playable(displayMime(md('', 'x.pdf'), 'document')));
}

// ── a number that is not a number ─────────────────────────────────────────
//
// `@lid` is WhatsApp's privacy identity: a long run of digits that is not a
// phone number. Everything treated "not a group" as "a person with a number",
// so the conversation header drew `+121298634178579` — a plus sign and fifteen
// digits nobody can ring — and the same string went into the tool's approval
// dialog as the recipient of a message.
{
  ok('an ordinary address is a number', isPhone('9647501112233@s.whatsapp.net'));
  ok('the legacy form too', isPhone('9647501112233@c.us'));
  ok('a group is not', !isPhone('120363000000000000@g.us'));
  ok('a lid is not', !isPhone('121298634178579@lid'));
  ok('a broadcast is not', !isPhone('status@broadcast'));
  ok('a newsletter is not', !isPhone('12345@newsletter'));

  ok('phoneOf gives the number for a real address',
     phoneOf('9647501112233@s.whatsapp.net') === '9647501112233');
  ok('and a device suffix is still stripped',
     phoneOf('9647501112233:12@s.whatsapp.net') === '9647501112233');
  // The whole point: empty, so callers fall back to the jid and nothing
  // presents these digits as something you could dial.
  ok('but nothing for a lid', phoneOf('121298634178579@lid') === '');
  ok('and nothing for a group', phoneOf('120363000000000000@g.us') === '');
}

// ── sending one ──────────────────────────────────────────────────────────
{
  ok('a photo is sent as an image', sendAs('holiday.jpg') === 'image');
  ok('a png too', sendAs('shot.PNG') === 'image');
  ok('an mp4 is a video', sendAs('clip.mp4') === 'video');
  ok('a mov is a video', sendAs('clip.mov') === 'video');
  ok('an opus is audio', sendAs('note.opus') === 'audio');
  // WhatsApp will carry anything as a file. Refusing would be this app
  // deciding what people may send each other.
  ok('a zip still goes, as a file', sendAs('logs.zip') === 'document');
  ok('a PDF is a file', sendAs('invoice.pdf') === 'document');
  ok('a spreadsheet is a file', sendAs('rows.xlsx') === 'document');
  // A webm is a video everywhere except on the phones this arrives on, where
  // it does not play in place. Better a file that opens than a video that does not.
  ok('a webm travels as a file', sendAs('clip.webm') === 'document');
  ok('the mimetype can decide when the name will not',
     sendAs('IMG_0001', 'image/jpeg') === 'image');

  ok('a type comes from the name', sendMime('a.jpg') === 'image/jpeg');
  ok('and image/jpg is corrected', sendMime('a.jpg', 'image/jpg') === 'image/jpeg');
  ok('a real mimetype is kept', sendMime('a.bin', 'video/mp4') === 'video/mp4');
  ok('octet-stream defers to the name', sendMime('a.png', 'application/octet-stream') === 'image/png');
  ok('and something unknown is octet-stream', sendMime('a.qqq') === 'application/octet-stream');

  const img = { data: 'AAAA', name: 'a.jpg', mime: 'image/jpeg', as: 'image' };
  const body = sendBody('9647501112233', img, 'look at this');
  ok('the media body carries the file', body.media === 'AAAA' && body.fileName === 'a.jpg');
  ok('and names its type for WhatsApp', body.mediatype === 'image' && body.mimetype === 'image/jpeg');
  // The caption rides on the photo, which is how WhatsApp shows words under a
  // picture rather than as a separate message a second later.
  ok('the caption rides with it', body.caption === 'look at this');
  ok('and is absent when there is none', sendBody('1', img).caption === undefined);

  // A group or a @lid has no number; the jid addresses it.
  ok('a jid addresses a group',
     sendBody('120363000000000000@g.us', img).number === '120363000000000000@g.us');

  // A voice note is not an audio file to WhatsApp: it has its own endpoint,
  // and that endpoint has nowhere to put a caption.
  const aud = { data: 'BBBB', name: 'n.ogg', mime: 'audio/ogg', as: 'audio' };
  const abody = sendBody('1', aud, 'ignored');
  ok('a voice note uses the audio field', abody.audio === 'BBBB');
  ok('and carries no caption', abody.caption === undefined && abody.media === undefined);
  ok('the two endpoints are different',
     sendMediaPath('x') !== sendAudioPath('x'));
  ok('and both carry the instance',
     sendMediaPath('my inst').includes('my%20inst') && sendAudioPath('my inst').includes('my%20inst'));
}

// ── what the bytes say ────────────────────────────────────────────────────
//
// The server's mimetype is a claim and the filename is a claim; both were
// believed in turn while a photo refused to draw. The first bytes are the one
// thing in the exchange that cannot be wrong.
//
// The payloads below are the real leading bytes of each format, and the JPEG
// and Ogg ones are the actual first characters returned by the instance this
// was debugged against.
{
  ok('a JPEG announces itself', sniff('/9j/4AAQSkZJRgABAQAAAQABAAD/2wCE') === 'image/jpeg');
  ok('a PNG does', sniff('iVBORw0KGgoAAAANSUhEUg') === 'image/png');
  ok('a GIF does', sniff('R0lGODlhAQABAIAAAP') === 'image/gif');
  ok('an Ogg does', sniff('T2dnUwACAAAAAAAAAABkAAAAAAAAAHk7c4IBE09wdXNIZWFk') === 'audio/ogg');
  ok('a PDF does', sniff('JVBERi0xLjQKJeLjz9M') === 'application/pdf');
  ok('a zip does', sniff('UEsDBBQAAAAIA') === 'application/zip');
  // RIFF....WEBP — the brand is at offset 8, so a prefix test alone is wrong.
  ok('a WebP is told from a WAV',
     sniff('UklGRiQAAABXRUJQVlA4') === 'image/webp'
     && sniff('UklGRiQAAABXQVZFZm10') === 'audio/wav');
  // ....ftyp — the brand decides whether it is sound or picture.
  ok('an MP4 is a video', sniff('AAAAIGZ0eXBpc29t') === 'video/mp4');
  ok('an M4A is audio', sniff('AAAAIGZ0eXBNNEEg') === 'audio/mp4');

  ok('nothing recognised is empty, not a guess', sniff('aGVsbG8gd29ybGQgdGhpcyBpcyBub3Q=') === '');
  ok('an empty payload is empty', sniff('') === '');
  ok('and a short one does not throw', sniff('AA') === '');
  // base64url spells two characters differently and the bytes are the same.
  ok('base64url decodes the same', sniff('_9j_4AAQSkZJRgABAQAAAQABAAD_2wCE') === 'image/jpeg');

  const md = (mime, name, base64) => ({ base64, mime, name, bytes: 9, sniffed: sniff(base64) });
  const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wCE';
  const JUNK = 'aGVsbG8gd29ybGQgdGhpcyBpcyBub3Q=';

  // The bytes outrank both claims, in both directions.
  ok('bytes beat a wrong mimetype', useOf(md('application/pdf', 'a.pdf', JPEG)) === 'image');
  ok('bytes beat a wrong filename', useOf(md('', 'notes.txt', JPEG)) === 'image');
  ok('and a real JPEG is an image whatever it is called',
     displayMime(md('application/octet-stream', 'x.bin', JPEG)) === 'image/jpeg');

  // The finding that matters: a payload claiming to be a picture whose bytes
  // are not one is `unknown`, which is a fault to report, not a limit to
  // explain away as `opaque`.
  ok('a claimed picture that is not one is unknown', useOf(md('image/jpeg', 'a.jpeg', JUNK)) === 'unknown');
  ok('a claimed video that is not one is unknown', useOf(md('video/mp4', 'a.mp4', JUNK)) === 'unknown');
  // Audio is opaque either way -- nothing here could read it regardless, so
  // there is no fault to report, only the limit that was always there.
  ok('unreadable audio stays opaque', useOf(md('audio/ogg', 'a.ogg', JUNK)) === 'opaque');
  ok('and a genuine Ogg is opaque too',
     useOf(md('audio/ogg', 'a.ogg', 'T2dnUwACAAAAAAAAAABk')) === 'opaque');
}

// ── a voice note that will actually play ──────────────────────────────────
//
// WhatsApp records voice notes as Ogg/Opus and WebKit cannot decode Ogg — this
// app runs in WebKit on macOS, where `afinfo` reads the container and reports
// no data format at all. The element drew a dead play button, which is what a
// voice note looked like here for three releases, and no amount of fixing the
// download was going to change it.
//
// Evolution will transcode on request. The two payloads below are the leading
// bytes of the same recording fetched both ways from a live instance.
{
  const OGG = 'T2dnUwACAAAAAAAAAABkAAAAAAAAAHk7c4IBE09wdXNIZWFkAQE4AYC7AAAAAABP';
  const MP4 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yaXNvNm1wNDEAAAKpbW9vdgAAAGxtdmhk';
  const voice = { id: 'x', keyId: 'WAKEY', jid: '1@s.whatsapp.net', fromMe: false,
                  at: 1_700_000_000_000, text: '', kind: 'audio', who: '' };

  ok('a voice note asks for the conversion', mediaBodyFor(voice).convertToMp4 === true);
  // Nothing else does. A photo has nothing to convert and a WhatsApp video is
  // already H.264; asking would cost a re-encode for no gain.
  for (const kind of ['image', 'video', 'document', 'sticker']) {
    ok(`a ${kind} does not`, mediaBodyFor({ ...voice, kind }).convertToMp4 === false);
  }

  ok('the unconverted bytes are Ogg', sniff(OGG) === 'audio/ogg');
  // The converted file is branded `isom` — the generic ISO brand — so the
  // bytes can prove it is MPEG-4 and cannot prove whether there is a picture
  // in it. Left alone it is drawn as a video: a black rectangle with a play
  // button, for a recording that has no picture.
  ok('and the converted bytes look like mp4', sniff(MP4) === 'video/mp4');

  const md = (base64, name) => ({ base64, mime: '', name, bytes: 40000, sniffed: sniff(base64) });
  const conv = md(MP4, '3AA31B6BE9F9771D98AA.oga');

  ok('the envelope settles it: this is sound', displayMime(conv, 'audio') === 'audio/mp4');
  ok('and so the panel plays it rather than screening it', playable(displayMime(conv, 'audio')));
  ok('it is audio, so still opaque to the model', useOf(conv, 'audio') === 'opaque');
  // Only ever narrows, and only on an envelope that said audio.
  ok('a real video is untouched', displayMime(md(MP4, 'clip.mp4'), 'video') === 'video/mp4');
  ok('and nothing promotes a sound to a picture', displayMime(md(OGG, 'p.oga'), 'video') === 'audio/ogg');

  // Evolution names the file after the message, not after what it transcoded,
  // so the mp4 arrives called `.oga`. Several transcription services choose
  // their decoder from the extension, and a saved file has to open when it is
  // double-clicked.
  ok('the name is corrected to match the bytes', nameFor(voice, conv) === '3AA31B6BE9F9771D98AA.m4a');
  // But an extension that was never wrong is left alone -- .ogg and .oga are
  // both Ogg, .jpg and .jpeg the same picture.
  ok('a right-but-different extension is left alone',
     nameFor(voice, md(OGG, 'ptt.ogg')) === 'ptt.ogg');
  ok('and so is .jpeg',
     nameFor({ ...voice, kind: 'image' }, md('/9j/4AAQSkZJRg', 'a.jpeg')) === 'a.jpeg');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
