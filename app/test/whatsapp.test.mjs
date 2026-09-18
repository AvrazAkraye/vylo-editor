// Reading WhatsApp through Evolution API.
//
// The instance this talks to stores new messages and nothing else — no chats
// table, no contacts, no history. So the two things a chat app normally asks
// the server for, the list of conversations and what is unread, are worked out
// here instead, and that arithmetic is what this file is about.
import {
  BLANK, KEY, chatsFrom, inChat, isGroup, jidOf, messagesFrom, normalise,
  phoneOf, read, ready, write,
} from '../.test-build/whatsapp.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

// Real shapes, from the live instance: structure read off the wire, contents
// invented. `messageTimestamp` is seconds, and the key carries the conversation.
const rec = (over = {}) => ({
  id: 'm1',
  key: { id: 'k1', fromMe: false, remoteJid: '9647510010742@s.whatsapp.net' },
  pushName: 'Ahmad',
  messageType: 'conversation',
  message: { conversation: 'سڵاو' },
  messageTimestamp: 1700000000,
  ...over,
});
const body = (records) => ({ messages: { total: records.length, pages: 1, currentPage: 1, records } });

// ── the connection ────────────────────────────────────────────────────────
ok('the storage key is versioned', /\.v\d+$/.test(KEY), KEY);
ok('nothing stored is the empty form', read(null).instance === '' && read(null).key === '');
ok('and it still suggests where the server is', read(null).baseUrl === BLANK.baseUrl);
ok('not JSON is the empty form, not a throw', read('{{{').instance === '');
ok('a trailing slash is taken off the address, so paths never double up',
   read(JSON.stringify({ baseUrl: 'https://wa.x/', instance: 'i', key: 'k' })).baseUrl === 'https://wa.x');
ok('surrounding space is not part of a key', (() => {
  const c = read(JSON.stringify({ baseUrl: ' https://wa.x ', instance: ' i ', key: ' k ' }));
  return c.key === 'k' && c.instance === 'i' && c.baseUrl === 'https://wa.x';
})());
ok('write then read is the same connection', (() => {
  const c = { baseUrl: 'https://wa.x', instance: 'me', key: 'abc' };
  const back = read(write(c));
  return back.baseUrl === c.baseUrl && back.instance === c.instance && back.key === c.key;
})());
ok('ready needs all three', ready({ baseUrl: 'a', instance: 'b', key: 'c' })
   && !ready({ baseUrl: 'a', instance: 'b', key: '' })
   && !ready({ baseUrl: 'a', instance: '', key: 'c' }));

// ── addresses ─────────────────────────────────────────────────────────────
ok('a number becomes an address', jidOf('9647510010742') === '9647510010742@s.whatsapp.net');
ok('and the way people write one still works',
   jidOf('+964 751 001 0742') === '9647510010742@s.whatsapp.net');
ok('nothing in is nothing out', jidOf('') === '' && jidOf('abc') === '');
ok('the number comes back out', phoneOf('9647510010742@s.whatsapp.net') === '9647510010742');
// A JID can carry the device that sent it.
ok('a device suffix is not part of the number',
   phoneOf('9647510010742:12@s.whatsapp.net') === '9647510010742');
ok('a group is told apart from a person',
   isGroup('1234-5678@g.us') && !isGroup('964@s.whatsapp.net'));
ok('and a group has no number to give back', phoneOf('1234-5678@g.us') === '');

// ── one message ───────────────────────────────────────────────────────────
{
  const m = normalise(rec());
  ok('a plain message is read', m.text === 'سڵاو' && m.kind === 'text', m);
  ok('seconds become milliseconds', m.at === 1700000000000, m.at);
  ok('and who sent it is kept', m.who === 'Ahmad' && m.fromMe === false);
}
ok('an extended text message is text too',
   normalise(rec({ messageType: 'extendedTextMessage',
     message: { extendedTextMessage: { text: 'hello' } } })).text === 'hello');
ok('a caption is the words of a picture', (() => {
  const m = normalise(rec({ messageType: 'imageMessage',
    message: { imageMessage: { caption: 'look', mimetype: 'image/jpeg' } } }));
  return m.text === 'look' && m.kind === 'image';
})());
// A blank line in the list tells you nothing; "[image]" tells you there is one.
ok('a picture with no caption still says it is a picture', (() => {
  const m = normalise(rec({ messageType: 'imageMessage',
    message: { imageMessage: { mimetype: 'image/jpeg' } } }));
  return m.text === '' && m.kind === 'image';
})());
ok('an audio note is audio', normalise(rec({
  message: { audioMessage: { mimetype: 'audio/ogg' } } })).kind === 'audio');
ok('a document is a document', normalise(rec({
  message: { documentMessage: { fileName: 'x.pdf' } } })).kind === 'document');

// Evolution stores protocol traffic beside real messages, and a chat list with
// receipts in it is a chat list nobody can read.
ok('a record with no conversation is not a message', normalise(rec({ key: {} })) === null);
ok('nor is a status broadcast',
   normalise(rec({ key: { remoteJid: 'status@broadcast' } })) === null);
ok('nor is nothing at all', normalise(null) === null && normalise('x') === null);

// ── a page of them ────────────────────────────────────────────────────────
ok('the records come out of the envelope', messagesFrom(body([rec(), rec({ id: 'm2' })])).length === 2);
ok('oldest first, whatever order they arrived in', (() => {
  const out = messagesFrom(body([
    rec({ id: 'b', messageTimestamp: 200 }),
    rec({ id: 'a', messageTimestamp: 100 }),
  ]));
  return out[0].id === 'a' && out[1].id === 'b';
})());
ok('an empty page is an empty list, not a throw', messagesFrom(body([])).length === 0);
ok('and so is a body of the wrong shape entirely',
   messagesFrom(null).length === 0 && messagesFrom({ nope: 1 }).length === 0);

// ── the chat list, which the server cannot give us ────────────────────────
const AHMAD = '964750@s.whatsapp.net';
const DILAN = '964751@s.whatsapp.net';
const GROUP = '120363@g.us';
const msgs = messagesFrom(body([
  rec({ id: '1', key: { remoteJid: AHMAD, fromMe: false }, pushName: 'Ahmad',
        message: { conversation: 'one' }, messageTimestamp: 100 }),
  rec({ id: '2', key: { remoteJid: DILAN, fromMe: false }, pushName: 'Dilan',
        message: { conversation: 'two' }, messageTimestamp: 300 }),
  rec({ id: '3', key: { remoteJid: AHMAD, fromMe: true }, pushName: '',
        message: { conversation: 'three' }, messageTimestamp: 200 }),
  rec({ id: '4', key: { remoteJid: GROUP, fromMe: false }, pushName: 'Sara',
        message: { conversation: 'four' }, messageTimestamp: 50 }),
]));
{
  const chats = chatsFrom(msgs);
  ok('one row per conversation, not per message', chats.length === 3, chats.length);
  ok('newest conversation first', chats[0].jid === DILAN, chats.map((c) => c.jid));
  ok('the row shows the last thing said', chats[0].last === 'two');
  ok('including when it was mine', (() => {
    const a = chats.find((c) => c.jid === AHMAD);
    return a.last === 'three' && a.lastFromMe === true;
  })());
  ok('a name is used when somebody published one',
     chats.find((c) => c.jid === AHMAD).name === 'Ahmad');
  ok('and a number stands in when nobody has',
     chatsFrom([{ id: 'x', jid: AHMAD, fromMe: false, at: 1, text: 'h', kind: 'text', who: '' }])[0].name === '964750');
  ok('a group is marked as one', chats.find((c) => c.jid === GROUP).group === true);
}

// Read state lives in the chats table that is not being written, so the app
// counts what has come in since it last looked. Mine never count.
{
  const chats = chatsFrom(msgs, {});
  ok('with nothing seen, every incoming message is unread',
     chats.find((c) => c.jid === AHMAD).unread === 1, chats);
  // In milliseconds, like `at` — the wire sends seconds and `normalise`
  // converts, so anything compared against a timestamp is in the app's unit.
  const after = chatsFrom(msgs, { [AHMAD]: 150_000, [DILAN]: 400_000 });
  ok('a conversation looked at since is clear',
     after.find((c) => c.jid === DILAN).unread === 0);
  ok('and one with older messages only is clear too',
     after.find((c) => c.jid === AHMAD).unread === 0);
  ok('my own messages are never unread', (() => {
    const mine = chatsFrom(messagesFrom(body([
      rec({ id: 'a', key: { remoteJid: AHMAD, fromMe: true }, messageTimestamp: 900 }),
    ])), {});
    return mine[0].unread === 0;
  })());
}

ok('one conversation can be picked out', inChat(msgs, AHMAD).length === 2);
ok('and it stays in order', (() => {
  const m = inChat(msgs, AHMAD);
  return m[0].text === 'one' && m[1].text === 'three';
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
