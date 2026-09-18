// The agent's WhatsApp tools.
//
// Two things are being held here, and only one of them is about formatting.
//
// The first is the gate. `whatsapp_send` must ask a human every single time,
// and the interesting failures are not "it forgot to ask" — they are "it asked
// after sending", "it sent anyway when the answer was no", and "the thing it
// showed was not the thing it sent". A test that only checks `ask` was called
// catches none of those, so the fake transport below records the order of
// every call and the assertions read that order.
//
// The second is that a tool the model can reach is a surface the model can get
// wrong, and it will: a number in the `jid` field, a jid in the `phone` field,
// an empty string, a name it invented. None of those may reach the wire.
import {
  WHATSAPP_TOOLS, approvalLine, chatsResult, isWhatsAppTool, planSend,
  runWhatsAppTool, targetOf, threadResult, whatsAppToolsFor,
} from '../.test-build/whatsapptool.js';
import { chatsFrom, dayOf, messagesFrom, relDay, threadRows } from '../.test-build/whatsapp.js';
import { decide, isRefused } from '../.test-build/auto.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' && !cond ? ' — ' + detail : ''}`);
  cond ? pass++ : fail++;
};

const CONN = { baseUrl: 'https://wa.example.com', instance: 'personal', key: 'k' };
const NONE = { baseUrl: 'https://wa.example.com', instance: '', key: '' };

/** A message as `findMessages` returns one. */
const wire = (jid, text, { me = false, at = 1_700_000_000, who = '' } = {}) => ({
  id: `${jid}-${at}-${text}`,
  key: { remoteJid: jid, fromMe: me, id: `k${at}` },
  message: { conversation: text },
  messageTimestamp: at,
  pushName: who,
});

const REBAZ = '9647501112233@s.whatsapp.net';
const TEAM = '120363000000000000@g.us';

/**
 * A recording server and a recording human.
 *
 * `log` is the whole point: every call appends to it, so "did it ask before it
 * sent" is a question about an array rather than about intent.
 */
function rig({ answer = 'pipe', rows = [], failWith = null } = {}) {
  const log = [];
  return {
    log,
    conn: CONN,
    call: async (path, body) => {
      log.push({ kind: 'call', path, body });
      if (failWith) throw failWith;
      if (path.includes('findMessages')) return { messages: { records: rows } };
      return { ok: true };
    },
    ask: async (req) => { log.push({ kind: 'ask', req }); return answer; },
  };
}

// ── the schemas ───────────────────────────────────────────────────────────
{
  const names = WHATSAPP_TOOLS.map((t) => t.name);
  ok('three tools', names.length === 3, names.join(','));
  ok('and they are the ones the panel promises', names.join(',') === 'whatsapp_chats,whatsapp_read,whatsapp_send');
  ok('every tool has a schema', WHATSAPP_TOOLS.every((t) => t.input_schema?.type === 'object'));
  ok('send requires its text', WHATSAPP_TOOLS[2].input_schema.required.join() === 'text');
  // The description is load-bearing: a model that believes a send is silent
  // writes a different message from one that knows a person reads it first.
  ok('and its description says a human approves it',
     /must approve/.test(WHATSAPP_TOOLS[2].description));
  ok('names are recognised', isWhatsAppTool('whatsapp_send') && isWhatsAppTool('whatsapp_chats'));
  ok('and nothing else is', !isWhatsAppTool('run_command') && !isWhatsAppTool('whatsapp'));

  ok('no tools without a connection', whatsAppToolsFor(NONE).length === 0);
  ok('and three with one', whatsAppToolsFor(CONN).length === 3);
  ok('a half-filled connection is not one',
     whatsAppToolsFor({ ...CONN, key: '' }).length === 0);
}

// ── who a call means ──────────────────────────────────────────────────────
{
  const chats = chatsFrom(messagesFrom({ messages: { records: [
    wire(REBAZ, 'hello', { who: 'Rebaz' }),
  ] } }));

  ok('a jid passes through', targetOf({ jid: REBAZ }).value.jid === REBAZ);
  ok('a phone becomes one', targetOf({ phone: '+964 750 111 2233' }).value.jid === REBAZ);
  // The model read "identify by jid" and had only a number. Taking it costs
  // nothing; refusing it costs the user a turn.
  ok('a number in the jid field is taken as a number',
     targetOf({ jid: '964 750 111 2233' }).value.jid === REBAZ);
  ok('the name comes from the chat list', targetOf({ jid: REBAZ }, chats).value.name === 'Rebaz');
  ok('and falls back to the number', targetOf({ phone: '9647509999999' }).value.name === '9647509999999');

  ok('nothing at all is refused', targetOf({}).ok === false);
  ok('and says what to pass', /jid or phone/.test(targetOf({}).why));
  ok('a name is not a number', targetOf({ phone: 'Rebaz' }).ok === false);
  ok('and the refusal quotes it', targetOf({ phone: 'Rebaz' }).why.includes('"Rebaz"'));
  ok('an empty string is not a target', targetOf({ jid: '', phone: '' }).ok === false);
}

// ── a send, planned ───────────────────────────────────────────────────────
{
  ok('a plan needs text', planSend({ jid: REBAZ }).ok === false);
  ok('whitespace is not text', planSend({ jid: REBAZ, text: '  \n ' }).ok === false);
  ok('and it needs somebody', planSend({ text: 'hi' }).ok === false);

  const p = planSend({ phone: '+9647501112233', text: 'build is green' });
  ok('a good one plans', p.ok === true);
  ok('with the text unchanged', p.value.text === 'build is green');
  ok('and knows a group from a person', p.value.group === false
     && planSend({ jid: TEAM, text: 'x' }).value.group === true);

  // Whatever is shown is what is sent. A dialog that trims, wraps or
  // summarises is asking about a different message.
  const line = approvalLine(p.value);
  ok('the dialog carries the whole text', line.includes('build is green'));
  ok('and names the number', line.includes('+9647501112233'));
  ok('a known name is shown with the number',
     approvalLine(planSend({ jid: REBAZ, text: 'x' }, chatsFrom(messagesFrom({ messages: { records: [
       wire(REBAZ, 'hello', { who: 'Rebaz' }),
     ] } }))).value).includes('Rebaz (+9647501112233)'));
  ok('a group is named as a group', approvalLine(planSend({ jid: TEAM, text: 'x' }).value).startsWith('WhatsApp to the group'));
  // A newline in the message must not be able to forge a second line of the
  // dialog's own text -- the recipient is above the blank line, always.
  const multi = approvalLine(planSend({ phone: '9647501112233', text: 'a\nb' }).value);
  ok('the recipient is the first line', multi.split('\n')[0].startsWith('WhatsApp to'));
}

// ── results ───────────────────────────────────────────────────────────────
{
  const msgs = messagesFrom({ messages: { records: [
    wire(REBAZ, 'one', { at: 1000 }),
    wire(REBAZ, 'two', { at: 2000, me: true }),
    wire(REBAZ, 'three', { at: 3000, who: 'Rebaz' }),
  ] } });

  const out = JSON.parse(threadResult(msgs));
  ok('a thread comes back oldest first', out.messages.map((m) => m.text).join() === 'one,two,three');
  ok('mine is marked', out.messages[1].from === 'me');
  ok('and theirs is named', out.messages[2].from === 'Rebaz');
  ok('nothing older was cut', out.older === 0);

  // The tail, not the head: "what did they just say" must not be answered
  // with the first thing anybody ever said.
  const cut = JSON.parse(threadResult(msgs, 1));
  ok('a limit keeps the most recent', cut.messages[0].text === 'three');
  ok('and counts what it dropped', cut.older === 2);
  ok('a zero limit still returns something', JSON.parse(threadResult(msgs, 0)).messages.length === 1);

  const list = JSON.parse(chatsResult(chatsFrom(msgs)));
  ok('the chat list carries its jid', list.chats[0].jid === REBAZ);
  ok('and is JSON, not prose', Array.isArray(list.chats));
}

// ── the gate ──────────────────────────────────────────────────────────────
{
  const rows = [wire(REBAZ, 'hello', { who: 'Rebaz' })];

  // Approved.
  {
    const r = rig({ rows });
    const out = await runWhatsAppTool('whatsapp_send', { jid: REBAZ, text: 'hi' }, r);
    const asked = r.log.findIndex((x) => x.kind === 'ask');
    const sent = r.log.findIndex((x) => x.kind === 'call' && x.path.includes('sendText'));
    ok('a send asks', asked >= 0);
    ok('and it sends', sent >= 0);
    ok('and it asks BEFORE it sends', asked >= 0 && sent >= 0 && asked < sent);
    ok('the body is the approved text',
       r.log[sent].body.text === 'hi' && r.log[asked].req.command.includes('hi'));
    ok('addressed by number', r.log[sent].body.number === '9647501112233');
    ok('and it reports where it went', out.content.includes('Rebaz') && out.isError === false);
  }

  // Declined. The only assertion that matters is that nothing was posted.
  {
    const r = rig({ rows, answer: 'no' });
    const out = await runWhatsAppTool('whatsapp_send', { jid: REBAZ, text: 'hi' }, r);
    ok('a refusal sends nothing',
       r.log.every((x) => x.kind !== 'call' || !x.path.includes('sendText')));
    ok('and says so without calling it an error',
       /declined/.test(out.content) && out.isError === false);
  }

  // Refused before the gate. A bad call must not even raise a dialog: a person
  // trained to dismiss pointless questions is a person who will dismiss a real
  // one.
  for (const [what, input] of [
    ['no recipient', { text: 'hi' }],
    ['no text', { jid: REBAZ }],
    ['a name for a number', { phone: 'Rebaz', text: 'hi' }],
  ]) {
    const r = rig({ rows });
    const out = await runWhatsAppTool('whatsapp_send', input, r);
    ok(`${what} never reaches the human`, r.log.every((x) => x.kind !== 'ask'));
    ok(`${what} never reaches the wire`,
       r.log.every((x) => x.kind !== 'call' || !x.path.includes('sendText')));
    ok(`${what} comes back as an error`, out.isError === true);
  }

  // Reading asks nobody.
  for (const name of ['whatsapp_chats', 'whatsapp_read']) {
    const r = rig({ rows });
    const out = await runWhatsAppTool(name, { jid: REBAZ }, r);
    ok(`${name} asks nobody`, r.log.every((x) => x.kind !== 'ask'));
    ok(`${name} answers`, out.isError === false && out.content.length > 2);
  }

  // A conversation nothing has arrived in is not an error, and must not read
  // as one -- the model would report the contact unreachable.
  {
    const r = rig({ rows });
    const out = await runWhatsAppTool('whatsapp_read', { phone: '9647509999999' }, r);
    ok('an empty conversation is not an error', out.isError === false);
    ok('and says why it is empty', /No messages/.test(out.content));
  }

  // Not connected: refused, and the model is told whose job it is.
  {
    const r = { ...rig({ rows }), conn: NONE };
    const out = await runWhatsAppTool('whatsapp_send', { jid: REBAZ, text: 'hi' }, r);
    ok('no connection, no send', out.isError === true && /not connected/.test(out.content));
    ok('and it does not try to configure itself', /not something you can configure/.test(out.content));
  }

  // A server that is down is information, not a crash.
  {
    const r = rig({ rows, failWith: new Error('boom') });
    const out = await runWhatsAppTool('whatsapp_chats', {}, r);
    ok('a dead server comes back as a tool error', out.isError === true && out.content.includes('boom'));
  }

  ok('an unknown name is not ours', await runWhatsAppTool('run_command', {}, rig()) === null);
}

// ── the thread, grouped ───────────────────────────────────────────────────
{
  const day = new Date(2026, 0, 15, 9, 0, 0).getTime();
  const msgs = messagesFrom({ messages: { records: [
    wire(REBAZ, 'one', { at: day / 1000 }),
    wire(REBAZ, 'two', { at: day / 1000 + 60 }),          // same run
    wire(REBAZ, 'mine', { at: day / 1000 + 120, me: true }), // sender changed
    wire(REBAZ, 'later', { at: day / 1000 + 3600, me: true }), // an hour on
  ] } });
  const rows = threadRows(msgs);

  ok('a day marker opens the thread', rows[0].kind === 'day');
  ok('and there is exactly one for one day',
     rows.filter((r) => r.kind === 'day').length === 1);

  const m = rows.filter((r) => r.kind === 'msg');
  ok('every message is present', m.length === 4);
  ok('the first of a run is a head', m[0].head === true && m[0].tail === false);
  ok('the last of a run is a tail', m[1].tail === true && m[1].head === false);
  ok('a change of sender starts a run', m[2].head === true);
  ok('and a long gap starts another', m[3].head === true && m[3].tail === true);

  // Two days of talk get two markers, which is the whole reason this exists.
  const across = threadRows(messagesFrom({ messages: { records: [
    wire(REBAZ, 'yesterday', { at: day / 1000 }),
    wire(REBAZ, 'today', { at: day / 1000 + 86400 }),
  ] } }));
  ok('two days, two markers', across.filter((r) => r.kind === 'day').length === 2);

  ok('an empty thread has no rows', threadRows([]).length === 0);

  // A group splits on the speaker as well; outside one it must not, because
  // `who` is sent on some messages and missing on others.
  const g = threadRows(messagesFrom({ messages: { records: [
    wire(TEAM, 'a', { at: day / 1000, who: 'Rebaz' }),
    wire(TEAM, 'b', { at: day / 1000 + 30, who: 'Dlovan' }),
  ] } })).filter((r) => r.kind === 'msg');
  ok('a group splits on who spoke', g[1].head === true);

  const solo = threadRows(messagesFrom({ messages: { records: [
    wire(REBAZ, 'a', { at: day / 1000, who: 'Rebaz' }),
    wire(REBAZ, 'b', { at: day / 1000 + 30, who: '' }),
  ] } })).filter((r) => r.kind === 'msg');
  ok('but a one-to-one chat does not split on a missing push name', solo[1].head === false);
}

// ── days ──────────────────────────────────────────────────────────────────
{
  const now = new Date(2026, 5, 10, 12, 0, 0).getTime();
  ok('today is today', relDay(now, now) === 'today');
  ok('and one minute past midnight is still today',
     relDay(new Date(2026, 5, 10, 0, 1, 0).getTime(), now) === 'today');
  ok('yesterday is yesterday', relDay(new Date(2026, 5, 9, 23, 0, 0).getTime(), now) === 'yesterday');
  ok('and the day before is neither', relDay(new Date(2026, 5, 8, 12, 0, 0).getTime(), now) === null);
  // A calendar day, not a 24-hour window: 23:00 and 01:00 are different days
  // two hours apart, which is exactly when a separator earns its place.
  ok('a day is a calendar day, not 24 hours',
     dayOf(new Date(2026, 5, 9, 23, 0, 0).getTime()) !== dayOf(new Date(2026, 5, 10, 1, 0, 0).getTime()));
  ok('and it sorts', dayOf(new Date(2026, 0, 2).getTime()) > dayOf(new Date(2026, 0, 1).getTime()));
}

// ── and auto-approve cannot reach it ──────────────────────────────────────
//
// The hole this closes was real and was mine. `askToRun` hands the dialog's
// text to `decide`, every rule in `auto.ts` matches on shell (`\brm\s+-`,
// `\bgit\s+push\b`), and `WhatsApp to Rebaz` matched none of them — so at
// level `all` the agent posted to somebody's phone with no dialog at all. The
// panel's own header had said, before any of this was written, that a sending
// tool "needs the gate — and an entry in `auto.ts`'s always-ask rules".
//
// That entry matches a sentence `approvalLine` builds in a different file, so
// the coupling is the fragile part: rewording the dialog would unhook the rule
// and nothing would look broken. These assertions are what notices.
{
  const cases = [
    ['a person', planSend({ phone: '9647501112233', text: 'hi' })],
    ['a group', planSend({ jid: TEAM, text: 'hi' })],
    ['a named contact', planSend({ jid: REBAZ, text: 'hi' }, chatsFrom(messagesFrom({ messages: { records: [
      wire(REBAZ, 'hello', { who: 'Rebaz' }),
    ] } })))],
    ['a message that is itself a shell command', planSend({ phone: '9647501112233', text: 'npm test' })],
    ['a message with newlines in it', planSend({ phone: '9647501112233', text: 'one\ntwo\nthree' })],
    ['a message in Sorani', planSend({ phone: '9647501112233', text: 'سڵاو' })],
  ];
  for (const [what, p] of cases) {
    const line = approvalLine(p.value);
    ok(`${what}: the refuse-list catches it`, isRefused(line), line.split('\n')[0]);
    for (const level of ['off', 'edits', 'all']) {
      ok(`${what}: level ${level} still asks`, decide(line, level).kind === 'ask');
    }
  }
  ok('and the reason names what it caught',
     decide(approvalLine(planSend({ jid: REBAZ, text: 'hi' }).value), 'all').why
       === 'it sends a message to another person');

  // The rule must not have been written so broadly that it swallows the shell.
  ok('an ordinary command is untouched', decide('npm test', 'all').kind === 'run');
  ok('and so is one that merely mentions the word',
     decide('grep -r whatsapp src/', 'all').kind === 'run');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
