// Reading WhatsApp through Evolution API.
//
// The instance this talks to stores new messages and nothing else — no chats
// table, no contacts, no history. So the two things a chat app normally asks
// the server for, the list of conversations and what is unread, are worked out
// here instead, and that arithmetic is what this file is about.
import {
  BLANK, KEY, MAX_DRAFTS, chatsFrom, inChat, isGroup, jidOf, messagesFrom,
  normalise, phoneOf, quoting, read, readDrafts, ready, setDraft, threadRows, write,
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

// ── the ticks ─────────────────────────────────────────────────────────────
// A tick that is guessed is worse than no tick: the whole point of the mark is
// that it is evidence. So `status` is empty unless the server said something.
ok('a message of ours carries how far it got', (() => {
  const m = normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: 'DELIVERY_ACK' }));
  return m.status === 'delivered';
})());
ok('the words are all read', (() => {
  const of = (w) => normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: w })).status;
  return of('PENDING') === 'pending' && of('SERVER_ACK') === 'sent'
    && of('DELIVERY_ACK') === 'delivered' && of('READ') === 'read';
})());
// Evolution sends a word on some records and the protocol's own number on
// others, and both turn up in the same inbox.
ok('and so are the numbers', (() => {
  const of = (n) => normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: n })).status;
  return of(2) === 'sent' && of(3) === 'delivered' && of(4) === 'read';
})());
// A voice note listened to. WhatsApp draws one mark for both.
ok('played is read', normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: 'PLAYED' })).status === 'read');
ok('an error is no tick rather than a wrong one',
   normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: 'ERROR' })).status === '');
ok('and something unheard of is no tick either',
   normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' }, status: 'WHAT' })).status === '');
ok('a message with no status has none', normalise(rec({ key: { id: 'k', fromMe: true, remoteJid: 'a@s.whatsapp.net' } })).status === '');
// The ticks on an incoming message are the sender's evidence, not ours.
ok('an incoming message never has one',
   normalise(rec({ status: 'READ' })).status === '');

// ── replies ───────────────────────────────────────────────────────────────
// WhatsApp sends the quoted message inside the reply rather than a pointer to
// it, so a reply to something said last year still shows what it answered.
const reply = (inner, over = {}) => rec({
  messageType: 'extendedTextMessage',
  message: {
    extendedTextMessage: {
      text: 'yes',
      contextInfo: {
        stanzaId: 'OLD1',
        participant: '9647511111@s.whatsapp.net',
        quotedMessage: inner,
      },
      ...over,
    },
  },
});
ok('a reply carries what it answered', (() => {
  const m = normalise(reply({ conversation: 'are you coming?' }));
  return m.text === 'yes' && m.quoted && m.quoted.text === 'are you coming?';
})(), normalise(reply({ conversation: 'are you coming?' })).quoted);
ok('with the id needed to find the original', normalise(reply({ conversation: 'x' })).quoted.id === 'OLD1');
ok('and the number of whoever said it', normalise(reply({ conversation: 'x' })).quoted.who === '9647511111');
ok('a quoted picture keeps its kind', (() => {
  const q = normalise(reply({ imageMessage: { caption: 'look', mimetype: 'image/jpeg' } })).quoted;
  return q.kind === 'image' && q.text === 'look';
})());
ok('a quoted picture with no caption is still a picture', (() => {
  const q = normalise(reply({ imageMessage: { mimetype: 'image/jpeg' } })).quoted;
  return q.kind === 'image' && q.text === '';
})());
// A photo can be a reply as easily as a line of text.
ok('a picture can be the reply too', (() => {
  const m = normalise(rec({
    messageType: 'imageMessage',
    message: { imageMessage: { caption: 'this one', mimetype: 'image/jpeg',
      contextInfo: { stanzaId: 'O2', quotedMessage: { conversation: 'which?' } } } },
  }));
  return m.kind === 'image' && m.quoted && m.quoted.text === 'which?';
})());
ok('a plain message quotes nothing', normalise(rec()).quoted === null);
// contextInfo is where mentions and forwarding scores live too, and neither
// is a reply.
ok('a contextInfo with no quoted message is not a reply',
   normalise(rec({ messageType: 'extendedTextMessage',
     message: { extendedTextMessage: { text: 'hi', contextInfo: { mentionedJid: ['a@s.whatsapp.net'] } } } })).quoted === null);

// ── the divider ───────────────────────────────────────────────────────────
const at = (n, over = {}) => ({
  id: `m${n}`, keyId: `k${n}`, jid: 'a@s.whatsapp.net', fromMe: false,
  at: n * 1000, text: `t${n}`, kind: 'text', who: 'Ali', status: '', quoted: null, ...over,
});
const kinds = (rs) => rs.map((r) => r.kind).join(',');
ok('no seen time, no divider', !threadRows([at(1), at(2)], 0).some((r) => r.kind === 'new'));
ok('and none when nothing is newer', !threadRows([at(1), at(2)], 9_000).some((r) => r.kind === 'new'));
ok('one divider before the first new message', (() => {
  const rs = threadRows([at(1), at(2), at(3)], 1_500);
  const i = rs.findIndex((r) => r.kind === 'new');
  return i !== -1 && rs[i + 1].kind === 'msg' && rs[i + 1].msg.id === 'm2';
})(), kinds(threadRows([at(1), at(2), at(3)], 1_500)));
ok('and only one', threadRows([at(1), at(2), at(3)], 1_500).filter((r) => r.kind === 'new').length === 1);
// A divider at the very top separates nothing from everything, which is a line
// that means "this conversation is new" dressed as one that means "you missed
// something".
ok('never at the very top', !threadRows([at(1), at(2)], 500).some((r) => r.kind === 'new'));
// You cannot miss what you said yourself.
ok('a message of ours is not what you missed', (() => {
  const rs = threadRows([at(1), at(2, { fromMe: true }), at(3)], 1_500);
  const i = rs.findIndex((r) => r.kind === 'new');
  return i !== -1 && rs[i + 1].msg.id === 'm3';
})());
ok('the divider comes before the day heading it shares a place with', (() => {
  // Two days: the new message is the first of the second day.
  const day2 = 1_700_000_000_000;
  const rs = threadRows([at(1), { ...at(2), at: day2 }], 1_500);
  const i = rs.findIndex((r) => r.kind === 'new');
  return i !== -1 && rs[i + 1].kind === 'day';
})(), kinds(threadRows([at(1), { ...at(2), at: 1_700_000_000_000 }], 1_500)));
ok('and the rows are otherwise what they were',
   kinds(threadRows([at(1), at(2)])) === 'day,msg,msg');

// ── drafts ────────────────────────────────────────────────────────────────
ok('nothing stored is no drafts', (() => (
  Object.keys(readDrafts(null)).length === 0 && Object.keys(readDrafts('')).length === 0
))());
ok('and rubbish is no drafts, never a throw', (() => (
  Object.keys(readDrafts('{')).length === 0
  && Object.keys(readDrafts('[1,2]')).length === 0
  && Object.keys(readDrafts('"x"')).length === 0
))());
ok('a stored draft comes back', readDrafts('{"a@s.whatsapp.net":"half a sentence"}')['a@s.whatsapp.net'] === 'half a sentence');
ok('a key that is not a conversation is dropped', Object.keys(readDrafts('{"nope":"x"}')).length === 0);
ok('and so is a blank one', Object.keys(readDrafts('{"a@s.whatsapp.net":"   "}')).length === 0);

ok('writing a draft keeps it', setDraft({}, 'a@s.whatsapp.net', 'hello')['a@s.whatsapp.net'] === 'hello');
ok('nothing passed in is changed', (() => {
  const before = { 'a@s.whatsapp.net': 'one' };
  setDraft(before, 'b@s.whatsapp.net', 'two');
  return Object.keys(before).length === 1;
})());
// A conversation written in and then cleared should leave no trace; a record
// full of empty strings counts against the cap and means nothing.
ok('clearing a draft removes it rather than emptying it', (() => {
  const d = setDraft({ 'a@s.whatsapp.net': 'one' }, 'a@s.whatsapp.net', '');
  return !('a@s.whatsapp.net' in d);
})());
ok('and so does clearing it to whitespace',
   !('a@s.whatsapp.net' in setDraft({ 'a@s.whatsapp.net': 'one' }, 'a@s.whatsapp.net', '  ')));
ok('a jid that is not one is refused', (() => {
  const d = setDraft({}, 'nope', 'x');
  return Object.keys(d).length === 0;
})());
{
  // Unbounded, this grows for as long as the app is installed.
  const full = {};
  for (let i = 0; i < MAX_DRAFTS; i++) full[`c${i}@s.whatsapp.net`] = `draft ${i}`;
  const order = Object.keys(full);
  const d = setDraft(full, 'new@s.whatsapp.net', 'the newest');
  ok('the cap holds', Object.keys(d).length === MAX_DRAFTS, Object.keys(d).length);
  ok('the one just written is never the one dropped', d['new@s.whatsapp.net'] === 'the newest');
  ok('and the most recent conversation is kept', d[order[0]] === 'draft 0');
  ok('while the least recent goes', !(order[order.length - 1] in d));
  ok('editing an existing draft at the cap drops nothing', (() => {
    const e = setDraft(full, order[0], 'changed');
    return Object.keys(e).length === MAX_DRAFTS && e[order[0]] === 'changed';
  })());
}

// ── replying to one message in particular ─────────────────────────────────
// The server wants the *key* of the message being answered: which
// conversation, whether we sent it, and its own id.
ok('nothing to quote is no field at all', (() => {
  const q = quoting(null, 'a@s.whatsapp.net');
  return Object.keys(q).length === 0;
})());
// An empty `quoted` and an absent one are not the same thing to a server that
// validates the field, which is why this spreads rather than assigns.
ok('and the key is absent rather than empty', !('quoted' in quoting(null, 'a@s.whatsapp.net')));
ok('a message with no jid quotes nothing', !('quoted' in quoting(at(1), '')));
{
  const q = quoting(at(1, { keyId: 'WA123', fromMe: true }), 'a@s.whatsapp.net');
  ok('the key is the three fields WhatsApp identifies a message by',
     q.quoted.key.id === 'WA123' && q.quoted.key.remoteJid === 'a@s.whatsapp.net'
     && q.quoted.key.fromMe === true, q);
}
// `id` is Evolution's own row id and means nothing to WhatsApp, so a reply
// built from it quotes nothing and says so only by arriving as an ordinary
// message.
ok('it is keyId and never id', (() => {
  const q = quoting(at(9, { id: 'row-9', keyId: 'WA9' }), 'a@s.whatsapp.net');
  return q.quoted.key.id === 'WA9';
})());
ok('a message with no keyId cannot be quoted',
   !('quoted' in quoting(at(1, { keyId: '' }), 'a@s.whatsapp.net')));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
