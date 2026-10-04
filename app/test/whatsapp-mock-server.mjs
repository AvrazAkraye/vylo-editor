// A small Evolution API v2 gateway for tests: the five endpoints the broadcast engine calls, on 127.0.0.1, with
// behaviour a test can program. It never talks to WhatsApp — "delivered" here means "the mock's pretend phone network
// got it", and every request is kept with its time so a test can prove that nobody was messaged twice and that the
// pace was kept.
//
// The shapes are Evolution v2's as documented and as the existing panel reads them:
//
//   GET  /instance/connectionState/{instance}  → { instance: { instanceName, state: 'open' | 'close' | 'connecting' } }
//   POST /chat/whatsappNumbers/{instance}      { numbers: [...] } → [{ exists, jid, number }]
//   POST /message/sendText/{instance}          { number, text, delay? } → 201 { key: { remoteJid, fromMe, id }, message, status… }
//   POST /message/sendMedia/{instance}         { number, mediatype, mimetype, media, fileName, caption? } → 201, the same
//   POST /message/sendContact/{instance}       { number, contact: [{ fullName, wuid, phoneNumber }] } → 201, the same
//
// A number that is not on WhatsApp is refused the way Evolution refuses it: 400 with `exists: false` in the body.
// A wrong `apikey` is 401; an unknown instance is 404; a body that is not the shape above is 400 and is marked
// `malformed` in the log, so a test can assert the engine never sent one.
//
// What only the real gateway can confirm: that these are still the shapes (Evolution changes between versions), what
// it answers when a number is banned or logged out mid-run, how a real 16 MB upload behaves, and whether WhatsApp
// itself delivers. `docs/wa/engine.md` says so; the Send-a-test button exists for exactly that.
//
// Run it on its own for the app (the integrator's Run view against the mock):
//   node test/whatsapp-mock-server.mjs            → prints the address, the key and the instance
//   PORT=8787 node test/whatsapp-mock-server.mjs  → on a fixed port
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const ENDPOINT = /^\/(instance\/connectionState|chat\/whatsappNumbers|message\/sendText|message\/sendMedia|message\/sendContact)\/([^/?#]+)$/;
const NAMES = {
  'instance/connectionState': 'connectionState',
  'chat/whatsappNumbers': 'whatsappNumbers',
  'message/sendText': 'sendText',
  'message/sendMedia': 'sendMedia',
  'message/sendContact': 'sendContact',
};
const SENDS = new Set(['sendText', 'sendMedia', 'sendContact']);
const MEDIA_TYPES = new Set(['image', 'video', 'document', 'audio']);
const digits = (s) => typeof s === 'string' && /^\d{6,15}$/.test(s);
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Whether a send's body is one Evolution v2 would accept. */
function wellFormed(endpoint, b) {
  if (!b || typeof b !== 'object' || !digits(b.number)) return false;
  if (endpoint === 'sendText') {
    return typeof b.text === 'string' && b.text.trim().length > 0 && b.text.length <= 4096
      && (b.delay === undefined || (Number.isInteger(b.delay) && b.delay >= 0 && b.delay <= 10_000));
  }
  if (endpoint === 'sendMedia') {
    return MEDIA_TYPES.has(b.mediatype) && typeof b.mimetype === 'string' && b.mimetype.includes('/')
      && typeof b.media === 'string' && b.media.length > 0 && B64.test(b.media)
      && typeof b.fileName === 'string' && b.fileName.length > 0
      && (b.caption === undefined || (typeof b.caption === 'string' && b.caption.length > 0));
  }
  if (endpoint === 'sendContact') {
    return Array.isArray(b.contact) && b.contact.length > 0 && b.contact.every((k) => k && typeof k.fullName === 'string'
      && k.fullName.length > 0 && digits(k.wuid) && typeof k.phoneNumber === 'string' && k.phoneNumber.replace(/\D/g, '') === k.wuid);
  }
  return true;
}

let ids = 0;
const messageId = () => `3EB0${(++ids).toString(16).toUpperCase().padStart(12, '0')}`;

/**
 * Start a mock gateway on a free port of 127.0.0.1.
 *
 *   key, instance       what it accepts (`test-key`, `shop`)
 *   state               the instance's connection state (`open`)
 *   notOnWhatsApp       numbers that do not exist on WhatsApp
 *   numbersEndpoint     false: answer `whatsappNumbers` with 404, like a gateway without it
 *   clock               where request times come from: pass the test's fake clock to measure the pace
 *
 * `mock.when(rule)` programs an answer. A rule names an `endpoint` ('*' for any), optionally `nth` (the nth request
 * to that endpoint, 1-based) or `to` (a number), how many `times` it applies (1 with `nth`, else every time), and a
 * `reply`: `{ status, body }`, `'hang'` (never answers), `{ late: ms, status?, body? }` (answers after the client may
 * have given up), `'garbage'` (200 with a body that is not JSON) or `'drop'` (closes the socket). For a send,
 * `deliver` says whether the pretend phone still got it (default: yes for hang, late, garbage, drop and 2xx; no
 * otherwise) — the "it went but the answer was lost" case is `{ reply: 'hang', deliver: true }`.
 */
export async function startMock(o = {}) {
  const mock = {
    key: o.key ?? 'test-key',
    instance: o.instance ?? 'shop',
    state: o.state ?? 'open',
    notOnWhatsApp: new Set(o.notOnWhatsApp ?? []),
    numbersEndpoint: o.numbersEndpoint ?? true,
    clock: o.clock ?? Date.now,
    url: '',
    port: 0,
    /** Every request: { i, at, method, path, endpoint, instance, keyOk, body, status, delivered, malformed, reply }. */
    log: [],
    /** Every message the pretend phones got: { to, kind, text, mediatype, fileName, contact, at, request }. */
    delivered: [],
    rules: [],
    counts: {},
    when(rule) { mock.rules.push({ times: rule.nth ? 1 : Infinity, ...rule, used: 0 }); return mock; },
    clear() { mock.rules = []; return mock; },
    /** How many messages one number got. */
    deliveriesTo(phone) { return mock.delivered.filter((d) => d.to === phone).length; },
    /**
     * Numbers that got the same kind of message more than once — the list the engine must keep empty. By kind, because
     * a contact card or an audio file goes as the words and then the card: two messages, one each.
     */
    twice() {
      const n = new Map();
      for (const d of mock.delivered) n.set(`${d.to}|${d.kind}`, (n.get(`${d.to}|${d.kind}`) ?? 0) + 1);
      return [...n].filter(([, k]) => k > 1).map(([p]) => p);
    },
    /** The log of one endpoint. */
    of(endpoint) { return mock.log.filter((r) => r.endpoint === endpoint); },
    close: null,
  };
  const timers = new Set();
  const sockets = new Set();

  const deliver = (endpoint, body, entry) => {
    entry.delivered = true;
    mock.delivered.push({
      to: body.number,
      kind: endpoint === 'sendText' ? 'text' : endpoint === 'sendMedia' ? 'media' : 'contact',
      text: endpoint === 'sendText' ? body.text : body.caption,
      mediatype: body.mediatype,
      fileName: body.fileName,
      mediaBytes: typeof body.media === 'string' ? body.media.length : 0,
      contact: body.contact,
      at: mock.clock(),
      request: entry.i,
    });
  };
  const receipt = (endpoint, body) => ({
    key: { remoteJid: `${body.number}@s.whatsapp.net`, fromMe: true, id: messageId() },
    pushName: '',
    status: 'PENDING',
    message: endpoint === 'sendText' ? { conversation: body.text } : endpoint === 'sendContact' ? { contactMessage: {} } : { [`${body.mediatype}Message`]: {} },
    messageType: endpoint === 'sendText' ? 'conversation' : 'other',
    messageTimestamp: Math.floor(mock.clock() / 1000),
    instanceId: 'mock',
    source: 'unknown',
  });

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (b) => chunks.push(b));
    req.on('end', () => {
      const send = (status, body, type = 'application/json') => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, {
          'Content-Type': type,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'apikey, content-type',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        });
        res.end(type === 'application/json' ? JSON.stringify(body) : body);
      };
      if (req.method === 'OPTIONS') return send(204, '', 'text/plain');
      const url = new URL(req.url, 'http://127.0.0.1');
      const m = ENDPOINT.exec(url.pathname);
      const endpoint = m ? NAMES[m[1]] : 'unknown';
      const instance = m ? decodeURIComponent(m[2]) : '';
      let body = null;
      let parsed = true;
      if (chunks.length) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { parsed = false; }
      }
      mock.counts[endpoint] = (mock.counts[endpoint] ?? 0) + 1;
      const entry = {
        i: mock.log.length + 1, at: mock.clock(), method: req.method, path: url.pathname, endpoint, instance,
        keyOk: req.headers.apikey === mock.key, nth: mock.counts[endpoint],
        // An attachment is kept as its length: the log holds thousands of requests.
        body: body && typeof body === 'object' && typeof body.media === 'string' ? { ...body, media: `<${body.media.length} chars>` } : body,
        status: 0, delivered: false, malformed: false, reply: 'default',
      };
      mock.log.push(entry);
      const answer = (status, b, type) => { entry.status = status; send(status, b, type); };

      if (!m) return answer(404, { status: 404, error: 'Not Found', response: { message: ['Cannot ' + req.method + ' ' + url.pathname] } });
      if (!entry.keyOk) return answer(401, { status: 401, error: 'Unauthorized', response: { message: 'Unauthorized' } });
      if (instance !== mock.instance) return answer(404, { status: 404, error: 'Not Found', response: { message: [`The "${instance}" instance does not exist`] } });
      const wantGet = endpoint === 'connectionState';
      if ((wantGet && req.method !== 'GET') || (!wantGet && req.method !== 'POST')) {
        return answer(404, { status: 404, error: 'Not Found', response: { message: ['Cannot ' + req.method + ' ' + url.pathname] } });
      }
      const isSend = SENDS.has(endpoint);
      if (!parsed || (isSend && !wellFormed(endpoint, body))
        || (endpoint === 'whatsappNumbers' && !(body && Array.isArray(body.numbers) && body.numbers.every(digits)))) {
        entry.malformed = true;
        return answer(400, { status: 400, error: 'Bad Request', response: { message: ['malformed'] } });
      }

      const rule = mock.rules.find((r) => r.used < r.times
        && (r.endpoint === '*' || r.endpoint === endpoint)
        && (r.nth === undefined || r.nth === entry.nth)
        && (r.to === undefined || (body && body.number === r.to)));
      if (rule) {
        rule.used++;
        const reply = rule.reply;
        entry.reply = typeof reply === 'string' ? reply : reply.late !== undefined ? 'late' : `status-${reply.status}`;
        const ok2xx = typeof reply === 'object' && reply.late === undefined && reply.status >= 200 && reply.status < 300;
        const goes = rule.deliver ?? (typeof reply === 'string' || reply.late !== undefined || ok2xx);
        if (isSend && goes) deliver(endpoint, body, entry);
        if (reply === 'hang') return;
        if (reply === 'drop') { req.socket.destroy(); return; }
        if (reply === 'garbage') return answer(200, '<html>502 Bad Gateway</html>', 'text/html');
        if (reply.late !== undefined) {
          const t = setTimeout(() => {
            timers.delete(t);
            answer(reply.status ?? 201, reply.body ?? (isSend ? receipt(endpoint, body) : {}));
          }, reply.late);
          timers.add(t);
          return;
        }
        return answer(reply.status, reply.body ?? (isSend && ok2xx ? receipt(endpoint, body) : { status: reply.status, error: 'Programmed' }));
      }

      if (endpoint === 'connectionState') return answer(200, { instance: { instanceName: mock.instance, state: mock.state } });
      if (endpoint === 'whatsappNumbers') {
        if (!mock.numbersEndpoint) return answer(404, { status: 404, error: 'Not Found', response: { message: ['Cannot POST'] } });
        return answer(200, body.numbers.map((n) => ({ exists: !mock.notOnWhatsApp.has(n), jid: `${n}@s.whatsapp.net`, number: n })));
      }
      // A send.
      if (mock.state !== 'open') return answer(500, { status: 500, error: 'Internal Server Error', response: { message: 'Connection Closed' } });
      if (mock.notOnWhatsApp.has(body.number)) {
        return answer(400, { status: 400, error: 'Bad Request', response: { message: [{ exists: false, jid: `${body.number}@s.whatsapp.net`, number: body.number }] } });
      }
      deliver(endpoint, body, entry);
      return answer(201, receipt(endpoint, body));
    });
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((resolve) => server.listen(o.port ?? 0, '127.0.0.1', resolve));
  mock.port = server.address().port;
  mock.url = `http://127.0.0.1:${mock.port}`;
  mock.close = () => new Promise((resolve) => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const s of sockets) s.destroy();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
  return mock;
}

// Run on its own: a gateway for the app to talk to while the Run view is built. Nothing reaches WhatsApp.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mock = await startMock({ port: Number(process.env.PORT) || 0, notOnWhatsApp: (process.env.NOT_ON_WHATSAPP ?? '').split(',').filter(Boolean) });
  console.log(`Mock Evolution gateway on ${mock.url}  key: ${mock.key}  instance: ${mock.instance}`);
  console.log('Nothing here reaches WhatsApp. Ctrl-C to stop.');
  setInterval(() => {
    const sent = mock.delivered.length;
    if (sent) process.stdout.write(`\r${sent} delivered, ${mock.log.length} requests, numbers messaged twice: ${mock.twice().length}   `);
  }, 2000);
}
