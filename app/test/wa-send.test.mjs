// The runner (whatsappsend.ts) against the mock Evolution gateway (whatsapp-mock-server.mjs) through the real wire
// (`realDeps(conn).call` is `whatsappwire.ts` `callerFor`, i.e. fetch to 127.0.0.1), with the pace on a fake clock.
// Nothing here can reach WhatsApp: the only address is the mock's.
//
// What matters, in order:
//
//   1. Nobody is ever messaged twice — not after a 5xx, a timeout, a lost reply, a pause, a stop, a refused save, or a
//      crash at any step of a campaign — and nobody is left without a standing. Proved from the mock's own log.
//   2. Each answer is read for what it means: refusals (4xx) put the person back or mark them failed; anything that
//      may have gone is `unknown` and never retried; auth, a missing instance, rate limits, repeated failures, a
//      disconnected number, an account that is gone and a refused save each halt the campaign and say why.
//   3. The pace: the first message waits too, every gap is inside the bounds, a batch pause every batch, the day's
//      cap across campaigns with a wait for local midnight, numbers checked fifty at a time as the run reaches them.
//   4. What is sent is exactly what the preview shows, in the shape Evolution v2 takes, attachments included.
import { startMock } from './whatsapp-mock-server.mjs';
import { runCampaign, realDeps, recover, sendTest, isRunning } from '../.test-build/whatsappsend.js';
import { newCampaign, renderMessage, requeue, reportCsv } from '../.test-build/whatsappcampaign.js';

const SLOW = process.env.CI ? 4 : 1; // the ceilings are the release machine's; a shared runner gets four times as long
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const tick = () => new Promise((r) => setImmediate(r));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** A refusal shaped like `whatsappwire.ts`'s, for the in-memory gateway. */
class WireError extends Error {
  constructor(status) { super(`The WhatsApp server answered ${status}.`); this.name = 'WireError'; this.status = status; }
}

const mock = await startMock();
const conn = { baseUrl: mock.url, instance: 'shop', key: 'test-key' };
const wire = realDeps(conn, 'main');

const phoneOf = (i) => `96475000${String(i).padStart(5, '0')}`;
const people = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ phone: phoneOf(from + i), name: i % 3 ? `Person ${from + i}` : '', vars: { city: i % 2 ? 'Erbil' : '' } }));
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const START = new Date(2026, 9, 5, 9, 0, 0).getTime();
const TEXT = '[[Hi|Hello]] {first_name|friend}, our {city|shop} offer is on!';

function campaign(recipients, o = {}) {
  const c = newCampaign({ id: o.id ?? `c${Math.random().toString(36).slice(2)}`, name: 'Test', accountId: o.accountId ?? 'main', recipients,
    message: { text: TEXT, lang: 'en', optOut: true, ...(o.message ?? {}) }, pace: o.pace, now: START });
  return { ...c, consent: true, ...(o.extra ?? {}) };
}

/**
 * One "process": a fake clock, a disk (the last campaign saved, cloned as it was), a day's counter, a do-not-contact
 * set and its own memory of running campaigns. `deps()` is the runner's world, with the real wire as its transport
 * unless another `call` is given; the mock is told the fake time so its log measures the pace.
 */
function world(o = {}) {
  const w = {
    t: o.t ?? START, disk: null, saves: 0, counts: new Map(o.counts ?? []), blocked: new Set(o.blocked ?? []), locks: new Set(),
    refuse: o.refuse ?? (() => false), waits: [], states: [], sendingAtCall: [],
  };
  mock.clock = () => w.t;
  w.deps = (extra = {}) => ({
    ...wire,
    now: () => w.t,
    sleep: async (ms) => { w.t += ms; },
    rnd: o.rnd ?? (() => 0.5),
    save: async (c) => { w.saves++; if (w.refuse(w.saves, c)) return false; w.disk = structuredClone(c); return true; },
    sentToday: async () => w.counts.get(dayKey(w.t)) ?? 0,
    counted: async (at) => { w.counts.set(dayKey(at), (w.counts.get(dayKey(at)) ?? 0) + 1); },
    suppressed: async () => new Set(w.blocked),
    locks: w.locks,
    timeoutMs: o.timeoutMs ?? 3000,
    ...extra,
  });
  w.run = async (c, extra = {}) => {
    const r = runCampaign(c, w.deps(extra));
    r.on((e) => { if (e.kind === 'wait') w.waits.push({ ...e, at: w.t }); else w.states.push(e.campaign.state); });
    return r.start();
  };
  return w;
}

const sendsIn = (log) => log.filter((r) => ['sendText', 'sendMedia', 'sendContact'].includes(r.endpoint));
const reset = () => { mock.log.length = 0; mock.delivered.length = 0; mock.clear(); mock.state = 'open'; mock.notOnWhatsApp.clear(); mock.numbersEndpoint = true; mock.counts = {}; };
const standings = (c) => Object.fromEntries(Object.values(c.outcomes).map((o) => [o.phone, o.standing]));

// ── the happy path ────────────────────────────────────────────────────────
console.log('the happy path');
{
  reset();
  const list = [...people(6), { phone: '+964 750 000 0001', name: 'Duplicate', vars: {} }, { phone: '12-34', name: 'Bad', vars: {} }, ...people(2, 50)];
  mock.notOnWhatsApp.add(phoneOf(3));
  const w = world({ blocked: [phoneOf(50)] });
  const c = campaign(list);
  const out = await w.run(c);
  ok('the campaign is done', out.state === 'done' && out.halted === undefined && out.finished === w.t);
  eq('everyone has a standing', standings(out), {
    [phoneOf(0)]: 'sent', [phoneOf(1)]: 'sent', [phoneOf(2)]: 'sent', [phoneOf(3)]: 'skipped-not-on-whatsapp', [phoneOf(4)]: 'sent', [phoneOf(5)]: 'sent',
    '12-34': 'skipped-invalid', [phoneOf(50)]: 'skipped-opted-out', [phoneOf(51)]: 'sent',
  });
  const sends = sendsIn(mock.log);
  ok('one message per person — the number listed twice in two spellings got one', mock.twice().length === 0 && mock.deliveriesTo(phoneOf(1)) === 1);
  ok('nobody skipped was sent anything', [phoneOf(3), phoneOf(50)].every((p) => !sends.some((s) => s.body.number === p)) && !sends.some((s) => /12/.test(s.body.number) && s.body.number.length < 6));
  const byPhone = Object.fromEntries(list.filter((r) => /^\d+$/.test(r.phone)).map((r) => [r.phone, r]));
  ok('each message is exactly the preview (same renderer, same seed)', mock.delivered.every((d) => d.text === renderMessage(c.message, byPhone[d.to], 0)), mock.delivered.map((d) => d.text));
  ok('with the opt-out line', mock.delivered.every((d) => d.text.endsWith('Reply STOP to stop receiving messages.')));
  ok('the "typing…" time is between 0.8 and 2.5 s, longer for a longer text', sends.every((s) => s.body.delay >= 800 && s.body.delay <= 2500));
  ok('every request carried the key, none was malformed', mock.log.every((r) => r.keyOk && !r.malformed));
  eq('the order: connection, numbers, then the sends', mock.log.slice(0, 3).map((r) => r.endpoint), ['connectionState', 'whatsappNumbers', 'sendText']);
  const gaps = sends.map((s, i) => s.at - (i ? sends[i - 1].at : START));
  ok('the first message waits too, and every gap is the delay (21 s at rnd 0.5)', gaps.every((g) => g === 21000), gaps);
  ok('waits are announced with the time they end', w.waits.length === sends.length && w.waits.every((x) => x.why === 'delay' && x.until === x.at + 21000));
  ok('the report has a row for everyone', reportCsv(out).trim().split('\r\n').length === 1 + 9);
  ok('the runner\'s copy: the campaign given is unchanged', Object.keys(c.outcomes).length === 0 && c.state === 'draft');
}
{
  // Proof of the order "save, then send": at the moment each request reaches the gateway, the disk says `sending`.
  reset();
  const w = world();
  let wrong = 0, checked = 0;
  const call = async (path, body) => {
    if (path.startsWith('/message/')) { checked++; if (w.disk?.outcomes[body.number]?.standing !== 'sending') wrong++; }
    return wire.call(path, body);
  };
  const out = await w.run(campaign(people(5)), { call });
  ok('at every send, storage already says the person is being sent to', checked === 5 && wrong === 0 && out.state === 'done', { checked, wrong });
  ok('and after it, sent', Object.values(w.disk.outcomes).every((o) => o.standing === 'sent'));
}

// ── what is sent, with attachments ────────────────────────────────────────
console.log('attachments');
{
  reset();
  const w = world();
  const image = { kind: 'image', name: 'offer.png', mime: 'image/png', bytes: 6, data: 'iVBORw==' };
  const out = await w.run(campaign(people(3), { message: { attachment: image } }));
  const media = mock.of('sendMedia');
  ok('a photo goes as one sendMedia per person, the words as its caption', out.state === 'done' && media.length === 3 && mock.of('sendText').length === 0
    && media.every((m) => m.body.mediatype === 'image' && m.body.mimetype === 'image/png' && m.body.fileName === 'offer.png' && m.body.caption.includes('offer is on')));
  reset();
  await world().run(campaign(people(2), { message: { text: '', optOut: false, attachment: { kind: 'document', name: 'menu.pdf', mime: 'application/octet-stream', bytes: 3, data: 'JVBE' } } }));
  const doc = mock.of('sendMedia');
  ok('a file with no useful type goes as a document, typed from its name, with no caption when there are no words',
    doc.length === 2 && doc.every((m) => m.body.mediatype === 'document' && m.body.mimetype === 'application/pdf' && m.body.caption === undefined));
  reset();
  const card = { kind: 'contact', name: 'card', mime: 'text/vcard', bytes: 0, data: '', contact: { fullName: 'Nova Shop', phone: '9647501234567', organization: 'Nova' } };
  const out2 = await world().run(campaign(people(3), { message: { attachment: card } }));
  const contacts = mock.of('sendContact');
  ok('a contact card: the words first, then the card — both delivered, the person sent once', out2.state === 'done' && mock.of('sendText').length === 3 && contacts.length === 3
    && mock.twice().length === 0 && Object.values(out2.outcomes).every((o) => o.standing === 'sent'));
  eq('the card in Evolution\'s shape', contacts[0].body.contact, [{ fullName: 'Nova Shop', wuid: '9647501234567', phoneNumber: '+9647501234567', organization: 'Nova' }]);
  ok('the words come before the card', mock.log.findIndex((r) => r.endpoint === 'sendText') < mock.log.findIndex((r) => r.endpoint === 'sendContact'));
  reset();
  await world().run(campaign(people(2), { message: { text: '', optOut: false, attachment: card } }));
  ok('a card with no words is the card alone', mock.of('sendText').length === 0 && mock.of('sendContact').length === 2);
  reset();
  const audio = { kind: 'audio', name: 'note.m4a', mime: 'audio/mp4', bytes: 3, data: 'AAAA' };
  await world().run(campaign(people(2), { message: { attachment: audio } }));
  const au = mock.of('sendMedia');
  ok('an audio file: the words first, then the audio on sendMedia, with no caption (audio cannot carry one)',
    mock.of('sendText').length === 2 && au.length === 2 && au.every((m) => m.body.mediatype === 'audio' && m.body.caption === undefined && m.body.mimetype === 'audio/mp4'));
  reset();
  mock.when({ endpoint: 'sendContact', nth: 1, reply: { status: 500 }, deliver: false });
  const part = await world().run(campaign(people(2), { message: { attachment: card } }));
  ok('when the words went and the card did not, the person is never sent to again: unknown, partial', part.outcomes[phoneOf(0)].standing === 'unknown'
    && part.outcomes[phoneOf(0)].why === 'partial-http-500' && mock.of('sendText').filter((r) => r.body.number === phoneOf(0)).length === 1);
  reset();
  mock.when({ endpoint: 'sendContact', nth: 1, reply: { status: 400 } });
  const part2 = await world().run(campaign(people(2), { message: { attachment: card } }));
  ok('and a refused card after the words: failed, partial — not back in the queue', part2.outcomes[phoneOf(0)].standing === 'failed' && part2.outcomes[phoneOf(0)].why === 'partial-invalid');
}

// ── the pace ──────────────────────────────────────────────────────────────
console.log('pace');
{
  reset();
  let i = 0;
  const w = world({ rnd: () => [0, 0.999, 0.25][i++ % 3] });
  const out = await w.run(campaign(people(45), { pace: { minDelaySec: 12, maxDelaySec: 30, batchSize: 20, batchPauseSec: 180, dailyCap: 1000, stopAfterFailures: 3, typing: false } }));
  const sends = mock.of('sendText');
  const gaps = sends.map((s, k) => s.at - (k ? sends[k - 1].at : START));
  ok('every gap is between the shortest and the longest delay, except after a batch', out.state === 'done'
    && gaps.every((g, k) => (k === 20 || k === 40 ? g >= 180000 + 12000 : g >= 12000 && g <= 30000)), gaps);
  ok('after every 20, a 180 s pause on top of the delay', gaps[20] >= 192000 && gaps[40] >= 192000 && w.waits.filter((x) => x.why === 'batch').length === 2);
  ok('the connection is looked at again at every batch', mock.of('connectionState').length === 3);
  ok('no "typing…" when typing is off', sends.every((s) => s.body.delay === undefined));
  ok('the shortest delay is the minimum and the longest just under the maximum', Math.min(...gaps) === 12000 && Math.max(...gaps.filter((g) => g < 100000)) >= 29900);
}
{
  reset();
  const many = people(120);
  const out = await world().run(campaign(many, { pace: { batchSize: 100 } }));
  const checks = mock.of('whatsappNumbers');
  const sendIdx = (n) => mock.log.findIndex((r) => r === mock.of('sendText')[n]);
  ok('numbers are checked fifty at a time', out.state === 'done' && checks.length === 3 && checks.map((r) => r.body.numbers.length).join() === '50,50,20');
  ok('as the run reaches them: the second check comes after the fiftieth message', mock.log.indexOf(checks[1]) > sendIdx(49) && mock.log.indexOf(checks[1]) < sendIdx(50));
}

console.log('the day\'s cap');
{
  reset();
  const w = world();
  const pace = { minDelaySec: 12, maxDelaySec: 30, batchSize: 100, batchPauseSec: 30, dailyCap: 10, stopAfterFailures: 3, typing: true };
  const out = await w.run(campaign(people(25), { pace }));
  const byDay = {};
  for (const d of mock.delivered) byDay[dayKey(d.at)] = (byDay[dayKey(d.at)] ?? 0) + 1;
  eq('ten a day, over three days', Object.values(byDay), [10, 10, 5]);
  const caps = w.waits.filter((x) => x.why === 'daily-cap');
  ok('at the cap the run waits until local midnight — it does not end', out.state === 'done' && caps.length === 2
    && caps[0].until === new Date(2026, 9, 6, 0, 0, 0).getTime() && caps[1].until === new Date(2026, 9, 7, 0, 0, 0).getTime(), caps.map((x) => new Date(x.until).toString()));
  ok('the state stays running while it waits', !w.states.includes('paused') && !w.states.includes('halted'));
  reset();
  const w2 = world({ counts: [[dayKey(START), 8]] });
  await w2.run(campaign(people(5), { pace }));
  ok('what other campaigns sent today counts: two more today, the rest tomorrow', mock.delivered.filter((d) => dayKey(d.at) === dayKey(START)).length === 2);
  reset();
  const w3 = world();
  await w3.run(campaign(people(5), { pace }), { counted: undefined, sentToday: async () => (dayKey(w3.t) === dayKey(START) ? 8 : 0) });
  ok('a world that does not count for it: the runner adds its own sends to what it is told', mock.delivered.filter((d) => dayKey(d.at) === dayKey(START)).length === 2
    && mock.delivered.length === 5);
}

// ── answers, one class at a time ──────────────────────────────────────────
console.log('refusals');
{
  reset();
  mock.numbersEndpoint = false;
  mock.notOnWhatsApp.add(phoneOf(1));
  const out = await world().run(campaign(people(4)));
  ok('a gateway without the number check: the run goes on and says so', out.state === 'done' && out.notes?.includes('number-check-unavailable'));
  ok('a 400 (not on WhatsApp) fails that person and the run goes on', out.outcomes[phoneOf(1)].standing === 'failed' && out.outcomes[phoneOf(1)].why === 'invalid'
    && out.outcomes[phoneOf(2)].standing === 'sent');
  ok('and the connection is looked at after the failure', mock.of('connectionState').length === 2);
  reset();
  mock.numbersEndpoint = false;
  for (let k = 0; k < 7; k++) mock.notOnWhatsApp.add(phoneOf(k));
  const bad = await world().run(campaign(people(7)));
  ok('five 400s in a row halt the campaign (repeated-failures), the rest still queued', bad.state === 'halted' && bad.halted === 'repeated-failures'
    && Object.values(bad.outcomes).filter((o) => o.standing === 'failed').length === 5 && bad.outcomes[phoneOf(5)].standing === 'queued');
}
{
  reset();
  mock.when({ endpoint: 'sendText', nth: 3, reply: { status: 401 } });
  const w = world();
  const first = await w.run(campaign(people(5)));
  ok('a 401 on a send halts (auth)', first.state === 'halted' && first.halted === 'auth');
  ok('the person it was refused for is still queued — nothing reached them', first.outcomes[phoneOf(2)].standing === 'queued' && first.outcomes[phoneOf(2)].attempts === 1
    && mock.deliveriesTo(phoneOf(2)) === 0);
  const again = await w.run(first);
  ok('fix the key, continue: everyone sent, the refused person exactly once', again.state === 'done' && Object.values(again.outcomes).every((o) => o.standing === 'sent')
    && mock.twice().length === 0 && mock.deliveriesTo(phoneOf(2)) === 1);
  ok('a resumed campaign keeps when it started', again.started === first.started);
  reset();
  const wrongKey = await world().run(campaign(people(3)), { call: realDeps({ ...conn, key: 'wrong' }).call });
  ok('a wrong key: halted at the connection check, before any message', wrongKey.halted === 'auth' && mock.log.length === 1 && mock.delivered.length === 0);
  reset();
  mock.when({ endpoint: 'connectionState', reply: { status: 403 } });
  ok('a 403 is auth too', (await world().run(campaign(people(2)))).halted === 'auth');
  reset();
  const noInstance = await world().run(campaign(people(3)), { call: realDeps({ ...conn, instance: 'gone' }).call, instance: 'gone' });
  ok('an instance that does not exist halts (instance), nothing sent', noInstance.halted === 'instance' && mock.delivered.length === 0);
  reset();
  mock.when({ endpoint: 'sendText', nth: 2, reply: { status: 404 } });
  const lost = await world().run(campaign(people(3)));
  ok('a 404 on a send halts (instance) with the person still queued', lost.halted === 'instance' && lost.outcomes[phoneOf(1)].standing === 'queued');
}
{
  reset();
  mock.when({ endpoint: 'sendText', nth: 2, reply: { status: 429 } });
  const w = world();
  const out = await w.run(campaign(people(3)));
  ok('one 429: wait 30 s, then the same person again — sent once', out.state === 'done' && mock.deliveriesTo(phoneOf(1)) === 1 && out.outcomes[phoneOf(1)].attempts === 2
    && w.waits.some((x) => x.until - x.at === 30000) && out.notes?.includes('rate-limited'));
  reset();
  mock.when({ endpoint: 'sendText', reply: { status: 429 }, times: 3 });
  const w2 = world();
  const out2 = await w2.run(campaign(people(3)));
  const backoffs = w2.waits.map((x) => x.until - x.at).filter((ms) => ms >= 30000);
  ok('three 429s in a row halt (rate-limited) after waiting 30 s and 60 s', out2.halted === 'rate-limited' && backoffs.join() === '30000,60000', backoffs);
  ok('and the person was never reached', out2.outcomes[phoneOf(0)].standing === 'queued' && mock.delivered.length === 0);
}

console.log('may have gone');
{
  const once = async (reply, deliver, extra = {}) => {
    reset();
    mock.when({ endpoint: 'sendText', nth: 2, reply, deliver });
    const out = await world(extra).run(campaign(people(4)));
    return out;
  };
  const r500 = await once({ status: 500 }, true);
  ok('a 500 after the message went: unknown, never sent again, the run goes on', r500.outcomes[phoneOf(1)].standing === 'unknown' && r500.outcomes[phoneOf(1)].why === 'http-500'
    && mock.deliveriesTo(phoneOf(1)) === 1 && r500.state === 'done' && r500.outcomes[phoneOf(3)].standing === 'sent');
  ok('and the connection is looked at after it', mock.of('connectionState').length === 2);
  const r502 = await once({ status: 502 }, false);
  ok('a 502 where it did not go is still unknown: the runner cannot tell', r502.outcomes[phoneOf(1)].standing === 'unknown' && mock.deliveriesTo(phoneOf(1)) === 0);
  const hang = await once('hang', true, { timeoutMs: 150 });
  ok('a request that never answers: given up on after the timeout, unknown, not sent again', hang.outcomes[phoneOf(1)].why === 'timeout'
    && hang.outcomes[phoneOf(1)].standing === 'unknown' && mock.deliveriesTo(phoneOf(1)) === 1 && hang.state === 'done');
  const late = await once({ late: 400 }, true, { timeoutMs: 150 });
  await pause(500);
  ok('an answer that comes after the runner gave up changes nothing: unknown, delivered once', late.outcomes[phoneOf(1)].standing === 'unknown'
    && mock.deliveriesTo(phoneOf(1)) === 1 && mock.of('sendText').find((r) => r.body.number === phoneOf(1)).status === 201);
  const drop = await once('drop', true);
  ok('a connection dropped after the message went: unknown (network)', drop.outcomes[phoneOf(1)].why === 'network' && mock.deliveriesTo(phoneOf(1)) === 1);
  const garbage = await once('garbage', true);
  ok('an answer that is not JSON: unknown (unreadable)', garbage.outcomes[phoneOf(1)].why === 'unreadable');
  const empty = await once({ status: 201, body: {} }, true);
  ok('a success with no message id in it: unknown (no-receipt) — a 2xx is not proof', empty.outcomes[phoneOf(1)].why === 'no-receipt' && empty.outcomes[phoneOf(1)].standing === 'unknown');
  const banned = await once({ status: 200, body: { status: 'ERROR', error: 'This account is banned' } }, false);
  ok('a reply that says the account is banned halts (account)', banned.halted === 'account' && banned.outcomes[phoneOf(1)].standing === 'unknown'
    && banned.outcomes[phoneOf(2)].standing === 'queued');
  const echo = await once({ status: 201, body: { key: { id: 'X1' }, message: { conversation: 'we were not connected, banned from logout' } } }, true);
  ok('the person\'s own words echoed back are never read as the account\'s state', echo.state === 'done' && echo.outcomes[phoneOf(1)].standing === 'sent');
}
{
  reset();
  mock.when({ endpoint: 'sendText', reply: { status: 500 }, times: 3, deliver: false });
  const out = await world().run(campaign(people(6)));
  ok('three may-have-gone answers in a row halt (repeated-failures)', out.halted === 'repeated-failures'
    && Object.values(out.outcomes).filter((o) => o.standing === 'unknown').length === 3 && out.outcomes[phoneOf(3)].standing === 'queued');
  reset();
  mock.when({ endpoint: 'sendText', nth: 1, reply: { status: 500 }, deliver: false }).when({ endpoint: 'sendText', nth: 2, reply: { status: 500 }, deliver: false })
    .when({ endpoint: 'sendText', nth: 4, reply: { status: 500 }, deliver: false }).when({ endpoint: 'sendText', nth: 5, reply: { status: 500 }, deliver: false });
  const out2 = await world().run(campaign(people(6)));
  ok('a message that goes in between starts the count again', out2.state === 'done');
}

console.log('the connection');
{
  for (const state of ['close', 'connecting']) {
    reset();
    mock.state = state;
    const out = await world().run(campaign(people(3)));
    ok(`an instance that is "${state}" halts before any message (not-connected)`, out.halted === 'not-connected' && mock.delivered.length === 0 && sendsIn(mock.log).length === 0);
  }
  reset();
  const w = world();
  const call = async (path, body) => {
    const r = await wire.call(path, body);
    if (mock.delivered.length === 2) mock.state = 'close';
    return r;
  };
  const out = await w.run(campaign(people(5)), { call });
  ok('a number that disconnects mid-run: the next send fails, the check after it halts (not-connected)', out.halted === 'not-connected'
    && Object.values(out.outcomes).filter((o) => o.standing === 'sent').length === 2 && out.outcomes[phoneOf(2)].standing === 'unknown'
    && out.outcomes[phoneOf(3)].standing === 'queued' && mock.delivered.length === 2);
}

console.log('the number check');
{
  reset();
  mock.when({ endpoint: 'whatsappNumbers', reply: { status: 401 } });
  ok('a 401 on the number check halts (auth), nothing sent', (await world().run(campaign(people(2)))).halted === 'auth' && mock.delivered.length === 0);
  reset();
  mock.when({ endpoint: 'whatsappNumbers', nth: 1, reply: { status: 500 } });
  const out = await world().run(campaign(people(3)));
  ok('a 500 on the number check: tried again after a delay, then the run goes on', out.state === 'done' && mock.of('whatsappNumbers').length === 2 && mock.delivered.length === 3);
  reset();
  mock.when({ endpoint: 'whatsappNumbers', reply: 'garbage' });
  mock.notOnWhatsApp.add(phoneOf(0));
  const g = await world().run(campaign(people(3)));
  ok('an answer that cannot be read: nobody is skipped on a guess, the run goes on and says so', g.state === 'done' && g.notes?.includes('number-check-unavailable')
    && g.outcomes[phoneOf(0)].standing === 'failed' && mock.of('whatsappNumbers').length === 1, { state: g.state, notes: g.notes, o: g.outcomes[phoneOf(0)], n: mock.of('whatsappNumbers').length, halted: g.halted });
  reset();
  mock.when({ endpoint: 'whatsappNumbers', reply: { status: 200, body: [{ exists: false, jid: `${phoneOf(1)}@s.whatsapp.net`, number: '+964 750 000 0001' }, { exists: false, number: 'nonsense' }, 'junk'] } });
  const j = await world().run(campaign(people(3)));
  ok('rows are matched by their number, however written; rows that match nobody skip nobody', j.outcomes[phoneOf(1)].standing === 'skipped-not-on-whatsapp'
    && j.outcomes[phoneOf(0)].standing === 'sent' && j.outcomes[phoneOf(2)].standing === 'sent');
}

// ── the do-not-contact list ───────────────────────────────────────────────
console.log('stop words mid-run');
{
  reset();
  const w = world();
  const call = async (path, body) => {
    const r = await wire.call(path, body);
    if (mock.delivered.length === 2) w.blocked.add(phoneOf(4));
    return r;
  };
  const out = await w.run(campaign(people(6)), { call });
  ok('someone who asks to stop during the run is skipped before their message', out.outcomes[phoneOf(4)].standing === 'skipped-opted-out' && mock.deliveriesTo(phoneOf(4)) === 0
    && out.outcomes[phoneOf(5)].standing === 'sent');
  reset();
  const unreadable = await world().run(campaign(people(2)), { suppressed: async () => { throw new Error('no list'); } });
  ok('a list that cannot be read halts (storage) before anything is sent', unreadable.halted === 'storage' && mock.log.length === 0);
  reset();
  const w2 = world();
  let n = 0;
  const out2 = await w2.run(campaign(people(3)), { suppressed: async () => { if (++n > 2) throw new Error('gone'); return new Set(); } });
  ok('and one that cannot be read mid-run halts too, with nobody left mid-send', out2.halted === 'storage' && !Object.values(out2.outcomes).some((o) => o.standing === 'sending'));
}

// ── storage ───────────────────────────────────────────────────────────────
console.log('storage');
{
  reset();
  const refusedFirst = await world({ refuse: (n) => n === 1 }).run(campaign(people(3)));
  ok('a first save refused: halted (storage), not one request made', refusedFirst.halted === 'storage' && mock.log.length === 0);
  reset();
  // Saves: 1 the plan, then two per person. Save 6 is the third person's "sending".
  const w = world({ refuse: (n) => n === 6 });
  const pre = await w.run(campaign(people(4)));
  ok('a refused save before a send: halted (storage), that person back in the queue, never reached', pre.halted === 'storage'
    && pre.outcomes[phoneOf(2)].standing === 'queued' && mock.deliveriesTo(phoneOf(2)) === 0 && mock.delivered.length === 2);
  reset();
  const w1 = world({ refuse: (n) => n === 7 });
  const once = await w1.run(campaign(people(4)));
  ok('a refused save after a send halts (storage); the halt\'s own save, if storage takes it, records the truth', once.halted === 'storage'
    && w1.disk.outcomes[phoneOf(2)].standing === 'sent' && w1.disk.state === 'halted');
  reset();
  const w2 = world({ refuse: (n) => n >= 7 });
  const post = await w2.run(campaign(people(4)));
  ok('when storage keeps refusing, it still says sending', post.halted === 'storage' && w2.disk.outcomes[phoneOf(2)].standing === 'sending'
    && mock.deliveriesTo(phoneOf(2)) === 1);
  const resumed = await world().run(recover(w2.disk));
  ok('after a restart that person is unknown and is not sent again; the rest are', resumed.state === 'done' && resumed.outcomes[phoneOf(2)].standing === 'unknown'
    && mock.twice().length === 0 && mock.deliveriesTo(phoneOf(3)) === 1);
  const asked = requeue(resumed, [phoneOf(2)]);
  const after = await world().run({ ...asked, state: 'paused' });
  ok('only when the person chooses to send again (requeue) does it go — once more, by their decision', after.outcomes[phoneOf(2)].standing === 'sent' && mock.deliveriesTo(phoneOf(2)) === 2);
  reset();
  const thrown = await world().run(campaign(people(2)), { save: async () => { throw new Error('quota'); } });
  ok('a save that throws is a refusal like false', thrown.halted === 'storage' && mock.log.length === 0);
  reset();
  ok('a day\'s count that cannot be read halts (storage)', (await world().run(campaign(people(2)), { sentToday: async () => { throw new Error('x'); } })).halted === 'storage' && mock.delivered.length === 0);
  ok('and a count that is not a number does too', (await world().run(campaign(people(2)), { sentToday: async () => NaN })).halted === 'storage' && mock.delivered.length === 0);
}

// ── starting ──────────────────────────────────────────────────────────────
console.log('starting');
{
  reset();
  const noConsent = { ...campaign(people(2)), consent: false };
  ok('without consent it does not start, and nothing is asked of the gateway', (await world().run(noConsent).then(() => 'started', (e) => e.message)).includes('no-consent') && mock.log.length === 0);
  const staged = { ...campaign(people(2)), staged: true };
  ok('a campaign the assistant prepared does not start until the person confirms it', (await world().run(staged).then(() => 'started', () => 'refused')) === 'refused' && mock.log.length === 0);
  const empty = { ...campaign([]) };
  ok('a campaign with nobody in it does not start', (await world().run(empty).then(() => 'started', () => 'refused')) === 'refused');
  const done = { ...campaign(people(2)), state: 'done' };
  ok('a finished campaign resolves as it is, without a request', (await world().run(done)).state === 'done' && mock.log.length === 0);
  const w = world();
  const r = runCampaign(campaign(people(3)), w.deps());
  r.stop();
  const stopped = await r.start();
  ok('stopping a campaign that is not running ends it, and it is saved so', stopped.state === 'stopped' && w.disk?.state === 'stopped' && mock.log.length === 0);
}
{
  reset();
  const w = world();
  let release;
  const gate = new Promise((res) => { release = res; });
  const c = campaign(people(3), { id: 'twice', accountId: 'acc-twice' });
  const deps = { ...w.deps(), locks: undefined, sleep: async (ms) => { await gate; w.t += ms; } };
  const a = runCampaign(c, deps);
  const first = a.start();
  await tick();
  ok('while it runs, the screen can tell (isRunning)', isRunning('twice') === true);
  ok('the same runner cannot start twice', (await a.start().then(() => 'started', () => 'refused')) === 'refused');
  ok('a second runner for the same campaign cannot start', (await runCampaign(c, deps).start().then(() => 'started', () => 'refused')) === 'refused');
  ok('nor a second campaign on the same account (it would halve the pace)', (await runCampaign({ ...campaign(people(2)), id: 'other', accountId: 'acc-twice' }, deps).start().then(() => 'started', () => 'refused')) === 'refused');
  release();
  const out = await first;
  ok('the first runs to the end, alone', out.state === 'done' && mock.twice().length === 0 && mock.delivered.length === 3);
  ok('and when it is over the campaign is free again', isRunning('twice') === false);
}

// ── pause, resume, stop ───────────────────────────────────────────────────
console.log('pause, resume, stop');
{
  reset();
  const w = world();
  let sleeping = 0;
  const deps = w.deps({ sleep: (ms, signal) => new Promise((res) => { sleeping++; signal?.addEventListener('abort', () => res(), { once: true }); }) });
  const r = runCampaign(campaign(people(3)), deps);
  const seen = [];
  r.on((e) => { if (e.kind === 'state') seen.push(e.campaign.state); });
  const done = r.start();
  while (!sleeping) await tick();
  r.pause();
  for (let k = 0; k < 20 && !seen.includes('paused'); k++) await tick();
  ok('a pause wakes a sleeping runner at once', seen.includes('paused') && mock.delivered.length === 0);
  ok('current() is the campaign as it stands, paused', r.current().state === 'paused');
  r.stop();
  const out = await done;
  ok('a stop while paused ends it at once, nothing sent', out.state === 'stopped' && mock.delivered.length === 0 && typeof out.finished === 'number');
}
{
  // Every await of a clean run, and a pause at each one: the result is always the same — everyone sent, once.
  reset();
  const probe = world();
  let steps = 0;
  const count = (deps) => Object.fromEntries(Object.entries(deps).map(([k, v]) => [k, typeof v === 'function' && k !== 'now' && k !== 'rnd' && k !== 'deadline' ? (...a) => { steps++; return v(...a); } : v]));
  await runCampaign(campaign(people(4)), count(probe.deps())).start();
  ok(`a clean four-person run has ${steps} awaits to interrupt`, steps > 20, steps);
  let wrongPause = 0, wrongStop = 0, lateDeliveries = 0;
  for (let k = 1; k <= steps; k++) {
    reset();
    const w = world();
    let n = 0;
    let r;
    const deps = Object.fromEntries(Object.entries(w.deps()).map(([key, v]) => [key, typeof v === 'function' && key !== 'now' && key !== 'rnd' && key !== 'deadline'
      ? (...a) => { if (++n === k) r.pause(); return v(...a); } : v]));
    r = runCampaign(campaign(people(4)), deps);
    r.on((e) => { if (e.kind === 'state' && e.campaign.state === 'paused') setImmediate(() => r.resume()); });
    const out = await r.start();
    if (out.state !== 'done' || mock.twice().length || mock.delivered.length !== 4 || !Object.values(out.outcomes).every((o) => o.standing === 'sent')) wrongPause++;
  }
  ok(`a pause at each of the ${steps} awaits, then resume: always done, everyone once`, wrongPause === 0, wrongPause);
  for (let k = 1; k <= steps; k++) {
    reset();
    const w = world();
    let n = 0;
    let r;
    const deps = Object.fromEntries(Object.entries(w.deps()).map(([key, v]) => [key, typeof v === 'function' && key !== 'now' && key !== 'rnd' && key !== 'deadline'
      ? (...a) => { if (++n === k) r.stop(); return v(...a); } : v]));
    r = runCampaign(campaign(people(4)), deps);
    const out = await r.start();
    const delivered = mock.delivered.length;
    await tick();
    if (mock.delivered.length !== delivered) lateDeliveries++;
    const sent = Object.values(out.outcomes).filter((o) => o.standing === 'sent').map((o) => o.phone);
    // A stop after the last message has gone finds nothing left to stop: the campaign is done, and says so.
    const finished = out.state === 'done' && Object.values(out.outcomes).every((o) => o.standing === 'sent');
    if ((out.state !== 'stopped' && !finished) || mock.twice().length || Object.values(out.outcomes).some((o) => o.standing === 'sending')
      || sent.some((p) => mock.deliveriesTo(p) !== 1) || delivered !== sent.length) { wrongStop++; if (process.env.DEBUG) console.log(k, out.state, standings(out), delivered); }
  }
  ok(`a stop at each of the ${steps} awaits: stopped (or done, when the last message had already gone), nobody twice, nobody left mid-send, every send accounted for`, wrongStop === 0, wrongStop);
  ok('and nothing is delivered after a stop has resolved', lateDeliveries === 0);
}

// ── crash safety ──────────────────────────────────────────────────────────
console.log('crash safety');
{
  /*
   * A twenty-person campaign, crashed at every step of a clean run in three ways — a save that throws, the process
   * dying before an effect happens, and dying just after it happened (the request reached the gateway; the disk was
   * written) — then restarted from what the disk held, `recover`ed and run to the end in a new process. The mock's log
   * is the witness: nobody may have two messages, and nobody may end without a standing.
   */
  const N = 20;
  const list = people(N);
  const base = campaign(list, { id: 'crash', pace: { batchSize: 8 } });
  mock.notOnWhatsApp.clear();
  const effects = (deps, hook) => Object.fromEntries(Object.entries(deps).map(([key, v]) => [key,
    typeof v === 'function' && key !== 'now' && key !== 'rnd' && key !== 'deadline' ? (...a) => hook(key, () => v(...a)) : v]));
  reset();
  let total = 0;
  {
    const w = world();
    await runCampaign(base, effects(w.deps(), (key, go) => { total++; return go(); })).start();
  }
  const never = new Promise(() => {});
  const problems = [];
  let runs = 0, wentButUnknown = 0, unknownNeverSent = 0, halfDone = 0;
  const t0 = performance.now();
  for (const mode of ['save-throws', 'crash-before', 'crash-after']) {
    for (let k = 1; k <= total; k++) {
      reset();
      mock.notOnWhatsApp.add(phoneOf(7));
      const w = world();
      let n = 0, saves = 0, dead = false;
      const hook = async (key, go) => {
        if (dead) return never;
        n++;
        if (mode === 'save-throws') {
          if (key === 'save' && ++saves === k) throw new Error('disk full');
          return go();
        }
        if (n === k && mode === 'crash-before') { dead = true; return never; }
        const r = await go();
        if (n === k && mode === 'crash-after') { dead = true; return never; }
        return r;
      };
      if (mode === 'save-throws' && k > 50) break; // every save of the run is covered well before this
      const first = runCampaign(base, effects(w.deps(), hook)).start();
      if (mode === 'save-throws') await first;
      else { for (let s = 0; s < 200 && !dead; s++) await tick(); if (!dead) await first; }
      // The restart: a new process, whatever the disk holds.
      const from = recover(w.disk ?? base);
      const w2 = world({ t: w.t });
      const out = await runCampaign(from, w2.deps()).start();
      runs++;
      const final = out.outcomes;
      const twice = mock.twice();
      const left = list.filter((r) => !final[r.phone] || ['queued', 'sending'].includes(final[r.phone].standing)).map((r) => r.phone);
      const sentWrong = Object.values(final).filter((o) => o.standing === 'sent' && mock.deliveriesTo(o.phone) !== 1).map((o) => o.phone);
      const deliveredWrong = mock.delivered.filter((d) => !['sent', 'unknown'].includes(final[d.to]?.standing)).map((d) => d.to);
      for (const o of Object.values(final)) {
        if (o.standing === 'unknown' && o.why === 'interrupted') { if (mock.deliveriesTo(o.phone) === 1) wentButUnknown++; else unknownNeverSent++; }
      }
      if (w.disk && Object.values(w.disk.outcomes).some((o) => o.standing === 'sent') && Object.values(w.disk.outcomes).some((o) => o.standing === 'queued')) halfDone++;
      if (twice.length || left.length || sentWrong.length || deliveredWrong.length || out.state !== 'done') {
        problems.push({ mode, k, state: out.state, halted: out.halted, twice, left, sentWrong, deliveredWrong });
      }
    }
  }
  const ms = performance.now() - t0;
  ok(`${runs} crashes (a save that throws, death before and after each of ${total} steps), each restarted: nobody messaged twice, nobody without a standing`,
    problems.length === 0, problems.slice(0, 3));
  ok(`all of them against the mock in under 30 s × SLOW (${(ms / 1000).toFixed(1)} s)`, ms < 30000 * SLOW);
  ok(`the matrix reached both kinds of doubt: a message that went before the crash (${wentButUnknown}) and one that never left (${unknownNeverSent}), both unknown, neither sent again`,
    wentButUnknown > 0 && unknownNeverSent > 0);
  ok(`and crashed campaigns half way through (${halfDone}), which the restart finished`, halfDone > runs / 4, halfDone);
}
{
  // The plainest crash: the message went, the answer never came back, the app was quit.
  reset();
  mock.when({ endpoint: 'sendText', nth: 2, reply: 'hang', deliver: true });
  const w = world();
  let dead = false;
  const never = new Promise(() => {});
  // The app quits while the second message's request is out: from then on this process does nothing at all.
  const inert = Object.fromEntries(Object.entries(w.deps()).map(([key, v]) => [key, typeof v === 'function' && key !== 'now' && key !== 'rnd'
    ? (...a) => { if (dead) return never; const r = v(...a); if (key === 'call' && String(a[0]).includes('sendText') && mock.of('sendText').length + 1 >= 2) dead = true; return r; } : v]));
  void runCampaign(campaign(people(3)), inert).start();
  while (!dead) await tick();
  await pause(100);
  const out = await world().run(recover(w.disk));
  ok('a reply lost when the app quit: after the restart that person is unknown and is not sent again', out.outcomes[phoneOf(1)].standing === 'unknown'
    && out.outcomes[phoneOf(1)].why === 'interrupted' && mock.deliveriesTo(phoneOf(1)) === 1 && mock.twice().length === 0 && out.state === 'done');
}

// ── what the screen is told ───────────────────────────────────────────────
console.log('events');
{
  reset();
  const w = world();
  const r = runCampaign(campaign(people(2)), w.deps());
  const states = [];
  let calls = 0;
  r.on(() => { calls++; throw new Error('a broken screen'); });
  const off = r.on((e) => { if (e.kind === 'state') { e.campaign.outcomes = {}; e.campaign.state = 'tampered'; states.push(e); } });
  const out = await r.start();
  ok('a listener that throws does not stop the run', out.state === 'done' && calls > 0);
  ok('each state is a copy: a listener changing it changes nothing in the runner', Object.keys(out.outcomes).length === 2 && out.state === 'done');
  ok('a state for every change: the start, each person sending and sent, the end', states.length === 1 + 2 * 2 + 1, states.length);
  off();
  ok('a listener can stop listening', typeof off === 'function');
}

// ── a big campaign ────────────────────────────────────────────────────────
console.log('5,000 people');
{
  // In memory: Evolution's answers without the socket, so five thousand sends over five fake days take no real time.
  const delivered = new Map();
  const perDay = new Map();
  let requests = 0;
  const call = async (path, body) => {
    requests++;
    if (path.startsWith('/instance/')) return { instance: { state: 'open' } };
    if (path.startsWith('/chat/whatsappNumbers')) return body.numbers.map((n) => ({ exists: !n.endsWith('99'), jid: `${n}@s.whatsapp.net`, number: n }));
    if (path.startsWith('/message/sendText')) {
      delivered.set(body.number, (delivered.get(body.number) ?? 0) + 1);
      perDay.set(dayKey(w.t), (perDay.get(dayKey(w.t)) ?? 0) + 1);
      return { key: { id: `M${requests}` } };
    }
    throw new WireError(404);
  };
  const w = world();
  const list = people(5000);
  const c = campaign(list, { pace: { dailyCap: 1000, batchSize: 100 } });
  let saves = 0;
  const t = performance.now();
  const r = runCampaign(c, { ...w.deps(), call, save: async () => { saves++; } });
  const out = await r.start();
  const ms = performance.now() - t;
  const notOn = list.filter((p) => p.phone.endsWith('99')).length;
  ok(`5,000 people over five fake days in under 2,000 ms × SLOW (${ms.toFixed(0)} ms)`, out.state === 'done' && ms < 2000 * SLOW);
  ok('everyone on WhatsApp got exactly one message; nobody else got any', delivered.size === 5000 - notOn && [...delivered.values()].every((n) => n === 1));
  ok('a thousand a day: five days, the last one short by those not on WhatsApp', [...perDay.values()].join() === `1000,1000,1000,1000,${1000 - notOn}`, [...perDay.values()]);
  ok('and the state was saved twice a message', saves >= 2 * (5000 - notOn));
}

// ── a test to the person's own number ─────────────────────────────────────
console.log('send a test');
{
  reset();
  ok('sent, to that number, through the same wire', (await sendTest(conn, '+964 750 999 0000', 'Hello test')) === 'sent' && mock.deliveriesTo('9647509990000') === 1
    && mock.of('sendText')[0].body.text === 'Hello test');
  eq('a wrong key says auth', await sendTest({ ...conn, key: 'nope' }, '9647509990000', 'x'), { failed: 'auth' });
  eq('a number that is not one', await sendTest(conn, '12', 'x'), { failed: 'invalid-number' });
  eq('nothing to send', await sendTest(conn, '9647509990000', '   '), { failed: 'empty' });
  eq('no account set up', await sendTest({ ...conn, key: '' }, '9647509990000', 'x'), { failed: 'no-account' });
  mock.when({ endpoint: 'sendText', reply: 'hang' });
  eq('no answer: timeout', await sendTest(conn, '9647509990000', 'x', { timeoutMs: 100 }), { failed: 'timeout' });
  mock.clear();
  mock.when({ endpoint: 'sendText', reply: { status: 500 } });
  eq('a 500', await sendTest(conn, '9647509990000', 'x'), { failed: 'http-500' });
  mock.clear();
  mock.when({ endpoint: 'sendText', reply: { status: 429 } });
  eq('a 429', await sendTest(conn, '9647509990000', 'x'), { failed: 'rate-limited' });
  mock.clear();
  mock.notOnWhatsApp.add('9647509990001');
  eq('a number not on WhatsApp', await sendTest(conn, '9647509990001', 'x'), { failed: 'invalid' });
  reset();
  ok('with a photo: one sendMedia, the words as the caption', (await sendTest(conn, '9647509990000', 'Look', { attachment: { kind: 'image', name: 'a.jpg', mime: 'image/jpeg', bytes: 3, data: '/9j/' } })) === 'sent'
    && mock.of('sendMedia')[0].body.caption === 'Look' && mock.of('sendText').length === 0);
  eq('the wrong instance says so', await sendTest({ ...conn, instance: 'gone' }, '9647509990000', 'x'), { failed: 'instance' });
}

// ── the real dependencies ─────────────────────────────────────────────────
console.log('real dependencies');
{
  reset();
  const d = realDeps({ ...conn, id: 'acct-7', name: 'Shop' });
  ok('the instance is the account\'s', d.instance === 'shop');
  ok('the transport is the wire: it reaches the gateway it was given and no other', (await d.call('/instance/connectionState/shop'))?.instance?.state === 'open' && mock.log.length === 1);
  await d.counted(Date.now());
  ok('the day\'s count is the account\'s (kept for the session when there is no storage)', (await d.sentToday()) === 1 && (await realDeps(conn, 'someone-else').sentToday()) === 0);
  const ctl = new AbortController();
  const t = performance.now();
  const sleeping = d.sleep(60_000, ctl.signal);
  ctl.abort();
  await sleeping;
  ok('the real sleep ends at once when woken', performance.now() - t < 100 * SLOW);
  ok('and waits when it is not', await (async () => { const s = performance.now(); await d.sleep(30); return performance.now() - s >= 25; })());
  ok('a timer for request time-outs, apart from the pace', typeof d.deadline === 'function' && d.deadline !== undefined);
  ok('the do-not-contact list is required reading: with no storage the runner is refused it', (await d.suppressed().then(() => 'resolved', () => 'refused')) === 'refused');
}

await mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
