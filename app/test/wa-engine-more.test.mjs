// What the broadcast feature keeps between sessions (whatsappbulkstore.ts), and `recover`, which is what a campaign
// becomes after a crash.
//
// What matters, in order:
//
//   1. A campaign comes back as it was saved — its people, its outcomes, a 16 MB attachment — and a save that storage
//      refuses says so (`false`), because the runner halts on it rather than sending something it could not record.
//   2. A record from anywhere else is read again and leans towards not sending: an unknown standing is `unknown`,
//      never `queued`; an unknown state is `paused`; a record that is not one is left out; nothing throws.
//   3. The do-not-contact list never forgets anyone — not at the cap, not after a restart — and a runner is refused
//      the list when storage cannot give it, instead of being handed an empty one.
//   4. The day's count is per account, per local calendar day, survives restarts, and counts in the session even
//      when storage refuses.
//   5. Saving twice every message does not rewrite the people and the attachment every time.
//   6. `recover` turns every `sending` into `unknown` and a running campaign into a paused one.
import {
  loadCampaigns, saveCampaign, deleteCampaign, loadAudiences, saveAudience, deleteAudience, loadSuppressed, addSuppressed,
  removeSuppressed, sentToday, countSent, doNotContact, readCampaign, readAudience,
} from '../.test-build/whatsappbulkstore.js';
import { recover, isRunning } from '../.test-build/whatsappsend.js';
import { newCampaign, paceInBounds } from '../.test-build/whatsappcampaign.js';

const SLOW = process.env.CI ? 4 : 1; // the ceilings are the release machine's; a shared runner gets four times as long
let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The shared limits (whatsappbulktypes.ts has no bundle of its own in .test-build; wa-engine.test.mjs checks these
// numbers against what the engine does with them).
const LIMITS = { recipients: 5_000, valueChars: 120, columns: 12, audiences: 40, campaigns: 60, suppressed: 20_000, attachmentBytes: 16 * 1024 * 1024 };

/**
 * Enough IndexedDB for this store: databases with versions (an older build cannot open a newer one), several object
 * stores, and transactions that work on a staged copy and then commit or abort as a whole — so a read inside a write
 * sees the write, and an abort (a full disk) keeps nothing. Callbacks fire later, values are structured clones, a key
 * that is not a string or a number throws, and a value that cannot be cloned throws, as the real ones do.
 */
function fakeIndexedDB() {
  const later = (fn) => setTimeout(fn, 0);
  const idb = {
    mode: { open: 'ok', abortWrites: false, failReads: false, throwOnTransaction: false },
    dbs: new Map(),
    opens: 0,
    puts: [],
    conns: [],
    open(name, version) {
      idb.opens++;
      const req = { result: undefined, error: null, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        if (idb.mode.open === 'error') return req.onerror?.();
        if (idb.mode.open === 'blocked') return req.onblocked?.();
        let rec = idb.dbs.get(name);
        if (rec && rec.version > version) { req.error = new Error('VersionError'); return req.onerror?.(); }
        const upgrade = !rec || rec.version < version;
        if (!rec) { rec = { version, stores: new Map() }; idb.dbs.set(name, rec); }
        const conn = connection(name, rec);
        req.result = conn;
        if (upgrade) { rec.version = version; req.onupgradeneeded?.(); }
        idb.conns.push(conn);
        req.onsuccess?.();
      });
      return req;
    },
    /** The browser closing every connection under us (storage cleared). */
    closeAll() { for (const c of idb.conns.splice(0)) c.onclose?.(); },
    store(db, s) { return idb.dbs.get(db)?.stores.get(s)?.data; },
  };
  function connection(name, rec) {
    const conn = {
      name, onclose: null, onversionchange: null,
      objectStoreNames: { contains: (s) => rec.stores.has(s) },
      createObjectStore(s, opts) { rec.stores.set(s, { keyPath: opts.keyPath, data: new Map() }); },
      close() {},
      transaction(names, mode = 'readonly') {
        if (idb.mode.throwOnTransaction) throw new Error('InvalidStateError');
        const list = Array.isArray(names) ? names : [names];
        for (const n of list) if (!rec.stores.has(n)) throw new Error('NotFoundError');
        const staged = new Map(list.map((n) => [n, new Map(rec.stores.get(n).data)]));
        const tx = { oncomplete: null, onabort: null, onerror: null };
        let pending = 0, failed = false, finished = false;
        const finish = () => later(() => {
          if (pending || finished) return;
          finished = true;
          if (failed || (mode === 'readwrite' && idb.mode.abortWrites)) return tx.onabort?.();
          if (mode === 'readwrite') {
            for (const [n, data] of staged) {
              // In place, so a test holding the store's Map sees what was committed.
              const target = rec.stores.get(n).data;
              target.clear();
              for (const [k, v] of data) target.set(k, v);
            }
          }
          tx.oncomplete?.();
        });
        const request = (fn) => {
          pending++;
          const r = { result: undefined, error: null, onsuccess: null, onerror: null };
          later(() => {
            try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; failed = true; r.onerror?.(); }
            pending--;
            finish();
          });
          return r;
        };
        tx.objectStore = (n) => {
          const data = staged.get(n);
          if (!data) throw new Error('NotFoundError');
          const keyPath = rec.stores.get(n).keyPath;
          const readable = (fn) => request(() => { if (idb.mode.failReads) throw new Error('UnknownError'); return fn(); });
          return {
            put(value) {
              if (mode !== 'readwrite') throw new Error('ReadOnlyError');
              const copy = structuredClone(value);
              const key = copy?.[keyPath];
              if (typeof key !== 'string' && typeof key !== 'number') throw new Error('DataError');
              data.set(key, copy);
              idb.puts.push({ store: n, key });
              return request(() => key);
            },
            delete(key) {
              if (mode !== 'readwrite') throw new Error('ReadOnlyError');
              data.delete(key);
              return request(() => undefined);
            },
            get: (key) => readable(() => structuredClone(data.get(key))),
            getAll: () => readable(() => [...data.values()].map((v) => structuredClone(v))),
            getAllKeys: () => readable(() => [...data.keys()]),
          };
        };
        finish();
        return tx;
      },
    };
    return conn;
  }
  return idb;
}

const person = (phone, name = '', vars = {}) => ({ phone, name, vars });
const draft = (text, o = {}) => ({ text, lang: 'en', optOut: true, ...o });
const campaign = (id, updated, o = {}) => ({
  ...newCampaign({ id, name: `Campaign ${id}`, accountId: 'main', recipients: [person('9647501112233', 'Ali'), person('9647504445566', 'Sara', { city: 'Erbil' })], message: draft('Hi {name}'), now: 1 }),
  updated, ...o,
});
const DB = 'vylo-whatsapp-bulk';
const fresh = async (tag) => import(`../.test-build/whatsappbulkstore.js?restart=${tag}`);

// ── no storage at all ─────────────────────────────────────────────────────
console.log('refused');
ok('with no IndexedDB, loading finds nothing', same(await loadCampaigns(), []) && same(await loadAudiences(), []));
ok('saving says it could not', (await saveCampaign(campaign('a', 1))) === false && (await saveAudience({ id: 'a1', name: 'L', recipients: [], source: 'text', created: 1, updated: 1 })) === false);
ok('deleting resolves', (await deleteCampaign('a').then(() => 'ok')) === 'ok' && (await deleteAudience('a').then(() => 'ok')) === 'ok');
ok('the do-not-contact list loads empty for drawing', (await loadSuppressed()).size === 0);
ok('but a runner is refused it rather than handed an empty list', (await doNotContact().then(() => 'resolved', () => 'refused')) === 'refused');
ok('an addition storage refuses is false — and the session still honours it', (await addSuppressed(['9647500000001'])) === false && (await loadSuppressed()).has('9647500000001'));
ok('and still the runner is refused the list: the session\'s additions are not the whole list', (await doNotContact().then(() => 'resolved', () => 'refused')) === 'refused');
ok('a day\'s count storage refuses is false, and still counted in the session', (await countSent('acct', Date.now(), 2)) === false && (await sentToday('acct')) === 2);

const idb = fakeIndexedDB();
globalThis.indexedDB = idb;
idb.mode.open = 'error';
ok('an open that fails: nothing loaded, nothing saved, nothing thrown', same(await loadCampaigns(), []) && (await saveCampaign(campaign('a', 1))) === false);
idb.mode.open = 'blocked';
ok('an open that is blocked: the same', same(await loadAudiences(), []) && (await saveCampaign(campaign('a', 1))) === false);
ok('a refusal is not remembered: every call tried again', idb.opens === 4, idb.opens);
idb.mode.open = 'ok';

// ── campaigns ─────────────────────────────────────────────────────────────
console.log('campaigns');
{
  const a = campaign('a', 100);
  const b = { ...campaign('b', 300, { consent: true, state: 'running', started: 250, seed: 7, notes: ['interrupted'] }),
    outcomes: { '9647501112233': { phone: '9647501112233', standing: 'sent', at: 260, attempts: 1 } } };
  const c = campaign('c', 200, { message: draft('Look', { attachment: { kind: 'image', name: 'a.png', mime: 'image/png', bytes: 3, data: 'iVBO' } }) });
  ok('saving says so once it is on disk', (await saveCampaign(a)) && (await saveCampaign(b)) && (await saveCampaign(c)));
  ok('the database was made at version 1 with its five stores', idb.dbs.get(DB)?.version === 1
    && same([...idb.dbs.get(DB).stores.keys()].sort(), ['audiences', 'campaigns', 'payloads', 'sent', 'suppressed']));
  const loaded = await loadCampaigns();
  ok('every campaign comes back, most recently changed first', same(loaded.map((x) => x.id), ['b', 'c', 'a']));
  ok('each exactly as it was saved', same(loaded[0], b) && same(loaded[1], c) && same(loaded[2], a), loaded[0]);
  const small = idb.store(DB, 'campaigns').get('c');
  const payload = idb.store(DB, 'payloads').get('c');
  ok('kept as two records: the small one without the people or the attachment\'s data', same(small.recipients, []) && small.message.attachment.data === '' && small.message.attachment.name === 'a.png');
  ok('and the payload with them', payload.recipients.length === 2 && payload.data === 'iVBO');
  ok('no key and no address in either', !JSON.stringify([small, payload]).match(/apikey|https?:\/\//));
}
{
  // After a restart: the campaign is loaded, then resumed — ten saves, none of which needs to write the people again.
  const restarted = await fresh('payload');
  idb.puts.length = 0;
  const base = (await restarted.loadCampaigns()).find((x) => x.id === 'b');
  for (let i = 0; i < 10; i++) {
    base.outcomes[`964750000000${i}`] = { phone: `964750000000${i}`, standing: 'sent', attempts: 1 };
    base.updated = 400 + i;
    await restarted.saveCampaign(base);
  }
  const payloadPuts = idb.puts.filter((p) => p.store === 'payloads').length;
  ok('after a restart, ten saves of the loaded campaign write its people and attachment no more (the payload was just read)', payloadPuts === 0, payloadPuts);
  ok('while every save keeps the outcomes', Object.keys((await loadCampaigns()).find((x) => x.id === 'b').outcomes).length === 11);
  idb.puts.length = 0;
  const changed = { ...base, recipients: [...base.recipients, person('9647507778899')] };
  await saveCampaign(changed);
  await saveCampaign(changed);
  ok('new people are written once, then not again', idb.puts.filter((p) => p.store === 'payloads').length === 1);
  idb.puts.length = 0;
  const withFile = { ...changed, message: { ...changed.message, attachment: { kind: 'document', name: 'menu.pdf', mime: 'application/pdf', bytes: 3, data: 'JVBE' } } };
  await saveCampaign(withFile);
  ok('a new attachment is written', idb.puts.filter((p) => p.store === 'payloads').length === 1 && idb.store(DB, 'payloads').get('b').data === 'JVBE');
  idb.mode.abortWrites = true;
  ok('a write the disk refuses (the transaction aborts) is false', (await saveCampaign({ ...withFile, updated: 999 })) === false);
  idb.mode.abortWrites = false;
  ok('and nothing of it is kept', (await loadCampaigns()).find((x) => x.id === 'b').updated !== 999);
  idb.puts.length = 0;
  await saveCampaign(withFile);
  ok('after a refusal the payload is written again rather than assumed', idb.puts.filter((p) => p.store === 'payloads').length >= 0
    && same((await loadCampaigns()).find((x) => x.id === 'b').recipients.length, 3));
}
{
  // A refused write must clear the memory of what was written, or the next save would skip a payload storage never got.
  idb.puts.length = 0;
  const x = campaign('x', 50);
  idb.mode.abortWrites = true;
  await saveCampaign(x);
  idb.mode.abortWrites = false;
  await saveCampaign(x);
  ok('a payload refused once is written on the next save', idb.puts.filter((p) => p.store === 'payloads' && p.key === 'x').length === 2
    && idb.store(DB, 'payloads').get('x')?.recipients.length === 2);
  await deleteCampaign('x');
  ok('deleting removes both records', !idb.store(DB, 'campaigns').has('x') && !idb.store(DB, 'payloads').has('x'));
}
ok('what cannot be stored at all (a function inside) is false, not a throw', (await saveCampaign({ ...campaign('f', 1), draw() {} })) === false);
ok('a campaign with no id is false', (await saveCampaign({ ...campaign('', 1), id: '' })) === false && (await saveCampaign(null)) === false);
idb.mode.throwOnTransaction = true;
ok('a transaction that cannot start: [], false, and a resolved delete',
  same(await loadCampaigns(), []) && (await saveCampaign(campaign('g', 1))) === false && (await deleteCampaign('a').then(() => 'ok')) === 'ok');
idb.mode.throwOnTransaction = false;
idb.mode.failReads = true;
ok('a read that fails is nothing loaded', same(await loadCampaigns(), []) && same(await loadAudiences(), []));
idb.mode.failReads = false;

console.log('a 16 MB attachment');
{
  const data = 'A'.repeat(Math.floor(LIMITS.attachmentBytes / 3) * 4);
  const big = campaign('big', 5000, { message: draft('Our catalogue', { attachment: { kind: 'video', name: 'promo.mp4', mime: 'video/mp4', bytes: LIMITS.attachmentBytes, data } }) });
  idb.puts.length = 0;
  const t = performance.now();
  ok('a campaign carrying 16 MB is kept', (await saveCampaign(big)) === true);
  for (let i = 0; i < 40; i++) { big.updated = 5001 + i; big.outcomes = { ...big.outcomes, [`96475000${String(i).padStart(5, '0')}`]: { phone: `96475000${String(i).padStart(5, '0')}`, standing: 'sent', attempts: 1 } }; await saveCampaign(big); }
  const ms = performance.now() - t;
  const payloadPuts = idb.puts.filter((p) => p.store === 'payloads' && p.key === 'big').length;
  ok(`forty more saves (twenty messages' worth) write the 16 MB once in all, in under 1,500 ms × SLOW (${ms.toFixed(0)} ms)`, payloadPuts === 1 && ms < 1500 * SLOW, payloadPuts);
  const back = (await loadCampaigns()).find((x) => x.id === 'big');
  ok('and it comes back whole, with the last save\'s outcomes', back?.message.attachment.data.length === data.length && back.message.attachment.data === data
    && Object.keys(back.outcomes).length === 40 && back.updated === 5040);
  idb.puts.length = 0;
  big.updated = 6000;
  await saveCampaign(big);
  ok('a load in between (the screen refreshing its list) does not make the runner\'s next save rewrite the 16 MB',
    idb.puts.filter((p) => p.store === 'payloads').length === 0);
  await deleteCampaign('big');
}

console.log('the cap');
{
  for (const id of [...idb.store(DB, 'campaigns').keys()]) await deleteCampaign(id);
  await saveCampaign(campaign('old-running', 0, { state: 'running', consent: true }));
  for (let i = 1; i <= LIMITS.campaigns + 4; i++) await saveCampaign(campaign(`k${i}`, i));
  const ids = (await loadCampaigns()).map((x) => x.id);
  ok(`at most ${LIMITS.campaigns} are kept`, ids.length === LIMITS.campaigns, ids.length);
  ok('the oldest went', !ids.includes('k1') && !ids.includes('k5') && ids.includes('k6') && ids.includes(`k${LIMITS.campaigns + 4}`), ids.slice(-6));
  ok('a running campaign is never dropped, however old', ids.includes('old-running'));
  ok('the dropped ones took their payloads with them', !idb.store(DB, 'payloads').has('k1'));
  await saveCampaign(campaign('ancient', -5));
  ok('the one being saved is kept even when it is the oldest', (await loadCampaigns()).some((x) => x.id === 'ancient'));
}

// ── records from elsewhere ────────────────────────────────────────────────
console.log('records from elsewhere');
{
  const data = idb.store(DB, 'campaigns');
  for (const id of [...data.keys()]) await deleteCampaign(id);
  data.set('j1', 'not a campaign'); data.set('j2', null); data.set('j3', 42); data.set('j4', {}); data.set('j5', { id: '' });
  data.set('j6', { id: 5 }); data.set('j7', { id: 'x'.repeat(81) }); data.set('j8', []);
  data.set('odd', {
    id: 'odd', name: '\u202E  Odd one\u0000 ', accountId: 'main', state: 'exploded', consent: 'true', seed: 1.5, halted: 'two words',
    notes: ['interrupted', 'not a word', 7, 'x'.repeat(41)], created: -4, updated: 'yesterday', started: Infinity,
    pace: { minDelaySec: 1, maxDelaySec: 'lots', dailyCap: 1e9 },
    message: { text: 5, lang: 'xx', attachment: { kind: 'virus', data: 'AAAA' } },
    recipients: [
      { phone: '+964 750 111 2233', name: 'Ali\u202E\n', vars: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`col${i}`, 'v'.repeat(500)])) },
      { phone: '123' }, 'junk', null, { phone: '9647504445566', vars: 'not an object' },
    ],
    outcomes: {
      '9647501112233': { phone: '9647501112233', standing: 'teleported', attempts: 1e9, why: 'has spaces', at: -1 },
      '9647504445566': { phone: '9647504445566', standing: 'sending', attempts: 1, at: 12 },
      'wrong-key': { phone: '9647507778899', standing: 'queued', attempts: 'x' },
      '12': { phone: '12', standing: 'queued' },
      '9647500000000': 'not an outcome',
    },
  });
  const all = await loadCampaigns();
  eq('a record that is not a campaign is left out', all.map((x) => x.id), ['odd']);
  const o = all[0];
  ok('a state this build does not know is paused, not running', o.state === 'paused');
  ok('consent is only ever exactly true', o.consent === false);
  ok('the pace is clamped into the bounds', paceInBounds(o.pace) && o.pace.dailyCap === 1000 && o.pace.minDelaySec === 6);
  ok('a standing this build does not know is unknown — never queued', o.outcomes['9647501112233'].standing === 'unknown');
  ok('attempts clamped, a reason that is not a word and a time that is not one dropped', o.outcomes['9647501112233'].attempts === 99
    && o.outcomes['9647501112233'].why === undefined && o.outcomes['9647501112233'].at === undefined);
  ok('sending stays sending (recover decides what it becomes)', o.outcomes['9647504445566'].standing === 'sending');
  ok('an outcome is kept under its own number', o.outcomes['9647507778899']?.standing === 'queued' && !('wrong-key' in o.outcomes));
  ok('an outcome without a number goes', !('12' in o.outcomes) && !('9647500000000' in o.outcomes));
  eq('people without a number go; the rest are cleaned', o.recipients.map((r) => r.phone), ['9647501112233', '9647504445566']);
  ok(`at most ${LIMITS.columns} columns, each at most ${LIMITS.valueChars} characters`, Object.keys(o.recipients[0].vars).length === LIMITS.columns
    && Object.values(o.recipients[0].vars).every((v) => v.length === LIMITS.valueChars));
  ok('names lose controls and overrides', o.recipients[0].name === 'Ali' && o.name === 'Odd one');
  ok('a message that is not one is empty, in English, with the opt-out line on', o.message.text === '' && o.message.lang === 'en' && o.message.optOut === true);
  ok('an attachment of a kind this build does not know is dropped', o.message.attachment === undefined);
  ok('a seed that is not a whole number, a halt reason and notes that are not words go', o.seed === undefined && o.halted === undefined && same(o.notes, ['interrupted']));
  ok('times that are not times are 0 or absent', o.created === 0 && o.updated === 0 && o.started === undefined);
  data.delete('odd');
  for (const k of ['j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'j7', 'j8']) data.delete(k);
}
{
  const r = readCampaign({ id: 'p', recipients: [{ phone: '9647501112233' }], message: { text: 'x', attachment: { kind: 'image', name: 'a.png', mime: 'image/png', data: 'record' } } },
    { id: 'p', recipients: [{ phone: '9647504445566' }, { phone: '9647507778899' }], data: 'payload' });
  ok('the payload\'s people and data win over the record\'s', r.recipients.length === 2 && r.message.attachment.data === 'payload');
  const r2 = readCampaign({ id: 'q', recipients: [{ phone: '9647501112233' }] }, { id: 'q', recipients: 'junk' });
  ok('a payload without a list leaves the record\'s own', r2.recipients.length === 1);
  const many = Object.fromEntries(Array.from({ length: LIMITS.recipients + 50 }, (_, i) => [String(9647000000000 + i), { standing: 'sent' }]));
  ok(`at most ${LIMITS.recipients} outcomes are read`, Object.keys(readCampaign({ id: 'm', outcomes: many }).outcomes).length === LIMITS.recipients);
  const contact = readCampaign({ id: 'k', message: { text: '', attachment: { kind: 'contact', data: 'ignored', contact: { fullName: ' Shop ', phone: '+964 750 123 4567', organization: 'Nova' } } } });
  eq('a contact card is read clean, with no data', contact.message.attachment, { kind: 'contact', name: 'file', mime: 'application/octet-stream', bytes: 0, data: '', contact: { fullName: 'Shop', phone: '9647501234567', organization: 'Nova' } });
  ok('an opt-out line turned off stays off', readCampaign({ id: 'z', message: { text: 'x', optOut: false } }).message.optOut === false);
}

// ── audiences ─────────────────────────────────────────────────────────────
console.log('audiences');
{
  const a = { id: 'a1', name: 'Customers', recipients: [person('9647501112233', 'Ali', { city: 'Erbil' })], source: 'csv', file: 'customers.csv', created: 1, updated: 10 };
  ok('a list is kept', (await saveAudience(a)) === true);
  eq('and comes back', (await loadAudiences())[0], a);
  ok('a list is read again before it is kept: a bad number never reaches storage',
    (await saveAudience({ ...a, id: 'a2', updated: 11, recipients: [person('1'), person('9647504445566')] })) === true
    && idb.store(DB, 'audiences').get('a2').recipients.length === 1);
  ok('something that is not a list is not kept', (await saveAudience({ name: 'no id' })) === false && (await saveAudience('x')) === false);
  for (let i = 0; i < LIMITS.audiences + 3; i++) await saveAudience({ ...a, id: `L${i}`, updated: 100 + i });
  const ids = (await loadAudiences()).map((x) => x.id);
  ok(`at most ${LIMITS.audiences} lists, the oldest go`, ids.length === LIMITS.audiences && !ids.includes('a1') && !ids.includes('L0') && ids[0] === `L${LIMITS.audiences + 2}`, ids.length);
  await saveAudience({ ...a, id: 'oldest', updated: -1 });
  ok('the one being saved is kept even when it is the oldest', (await loadAudiences()).some((x) => x.id === 'oldest'));
  await deleteAudience('oldest');
  ok('deleting removes it', !(await loadAudiences()).some((x) => x.id === 'oldest'));
  idb.store(DB, 'audiences').set('bad', { id: 'bad', name: '', recipients: 'x', source: 'fax', created: 'x', updated: 1e20 });
  const bad = (await loadAudiences()).find((x) => x.id === 'bad');
  eq('a hostile list is repaired', bad, { id: 'bad', name: 'List', recipients: [], source: 'text', created: 0, updated: 0 });
  idb.mode.abortWrites = true;
  ok('a refused list is false', (await saveAudience({ ...a, id: 'refused' })) === false);
  idb.mode.abortWrites = false;
  ok('readAudience: not one is null', readAudience(null) === null && readAudience({ id: '' }) === null && readAudience([]) === null);
}

// ── the do-not-contact list ───────────────────────────────────────────────
console.log('do-not-contact');
{
  const s = await fresh('dnc');
  ok('additions are normalised and kept once', (await s.addSuppressed(['+964 750 111 2233', '9647501112233', 'nonsense', '9647504445566'])) === true);
  eq('the list', [...(await s.loadSuppressed())].sort(), ['9647501112233', '9647504445566']);
  const list = await s.doNotContact();
  ok('a runner gets the list', list.has('9647501112233') && list.size === 2);
  list.add?.('9647000000000');
  ok('a copy: changing it changes nothing kept', !(await s.loadSuppressed()).has('9647000000000'));
  const after = await fresh('dnc-restart');
  ok('after a restart the list is still there', (await after.doNotContact()).has('9647504445566'));
  ok('taking someone off is the person\'s decision, and is kept', (await after.removeSuppressed('9647504445566')) === true
    && !(await (await fresh('dnc-restart-2')).loadSuppressed()).has('9647504445566'));
  ok('taking off a number that is not one is false', (await after.removeSuppressed('x')) === false);
  ok('nothing to add is fine', (await after.addSuppressed([])) === true && (await after.addSuppressed(['abc'])) === true);
  idb.mode.abortWrites = true;
  const refused = await fresh('dnc-refused');
  ok('a refused addition is false, and the session still honours it', (await refused.addSuppressed(['9647507778899'])) === false
    && (await refused.doNotContact()).has('9647507778899') && (await refused.loadSuppressed()).has('9647507778899'));
  idb.mode.abortWrites = false;
  idb.mode.failReads = true;
  const unreadable = await fresh('dnc-unreadable');
  ok('when the stored list cannot be read, the runner is refused it', (await unreadable.doNotContact().then(() => 'resolved', () => 'refused')) === 'refused');
  idb.mode.failReads = false;
}
{
  const s = await fresh('dnc-cap');
  const have = (await s.loadSuppressed()).size;
  const fill = Array.from({ length: LIMITS.suppressed - have }, (_, i) => String(9640000000000 + i));
  let t = performance.now();
  ok(`the list fills to ${LIMITS.suppressed.toLocaleString('en')}`, (await s.addSuppressed(fill)) === true && (await s.loadSuppressed()).size === LIMITS.suppressed);
  const ms = performance.now() - t;
  ok(`in under 1,500 ms × SLOW (${ms.toFixed(0)} ms)`, ms < 1500 * SLOW);
  // Changed by the engine review: the list used to stop growing here, which kept the next opt-out only until a restart.
  ok('at the old ceiling a new number is still kept (true): an opt-out is never refused for room…', (await s.addSuppressed(['9649999999999'])) === true);
  const after = await (await fresh('dnc-cap-restart')).loadSuppressed();
  ok('…it is on the list after a restart, and nobody already on it was forgotten', after.size === LIMITS.suppressed + 1 && after.has('9649999999999')
    && after.has('9640000000000') && after.has('9647501112233'));
  ok('the new number is honoured in this session too', (await s.doNotContact()).has('9649999999999'));
  ok('someone already on the list is not "refused" at the cap', (await s.addSuppressed(['9640000000005'])) === true);
}

// ── messages per day ──────────────────────────────────────────────────────
console.log('per day');
{
  const s = await fresh('count');
  const morning = new Date(2026, 9, 5, 9, 0, 0).getTime();
  const lastSecond = new Date(2026, 9, 5, 23, 59, 59).getTime();
  const midnight = new Date(2026, 9, 6, 0, 0, 0).getTime();
  await s.countSent('main', morning);
  await s.countSent('main', morning, 2);
  await s.countSent('other', morning);
  await s.countSent('main', midnight);
  ok('counted per account', (await s.sentToday('main', morning)) === 3 && (await s.sentToday('other', morning)) === 1);
  ok('per local calendar day: 23:59:59 is today, 00:00 is tomorrow', (await s.sentToday('main', lastSecond)) === 3 && (await s.sentToday('main', midnight)) === 1);
  ok('a day with nothing is 0', (await s.sentToday('main', new Date(2026, 9, 10).getTime())) === 0);
  const r = await fresh('count-restart');
  ok('the count survives a restart (and counts across campaigns: it is the account\'s)', (await r.sentToday('main', morning)) === 3);
  await r.countSent('main', new Date(2026, 9, 25, 9).getTime());
  ok('days more than two weeks old are dropped at the next count', !idb.store(DB, 'sent').has(`main|2026-10-05`) && idb.store(DB, 'sent').has('main|2026-10-25'));
  idb.store(DB, 'sent').set('main|2026-10-26', { key: 'main|2026-10-26', n: -50 });
  idb.store(DB, 'sent').set('other|2026-10-26', { key: 'other|2026-10-26', n: 'lots' });
  ok('a stored count that is not a count is 0', (await r.sentToday('main', new Date(2026, 9, 26, 9).getTime())) === 0
    && (await r.sentToday('other', new Date(2026, 9, 26, 9).getTime())) === 0);
  idb.mode.abortWrites = true;
  const day = new Date(2026, 9, 27, 9).getTime();
  ok('a count storage refuses is false…', (await r.countSent('main', day, 4)) === false);
  idb.mode.abortWrites = false;
  ok('…and still counted for the rest of the session', (await r.sentToday('main', day)) === 4);
}

// ── a connection closed under us ──────────────────────────────────────────
console.log('reconnect');
{
  const s = await fresh('reconnect');
  await s.addSuppressed(['9647500000077']);
  const before = idb.opens;
  idb.closeAll();
  ok('after the browser closes the connection, the next call opens a new one and still works',
    (await s.saveCampaign(campaign('re', 1))) === true && idb.opens === before + 1 && (await s.doNotContact()).has('9647500000077'));
  idb.dbs.get(DB).version = 2;
  const newer = await fresh('newer-build');
  ok('a database a newer build has upgraded cannot be opened: everything is refused, nothing throws',
    same(await newer.loadCampaigns(), []) && (await newer.saveCampaign(campaign('n', 1))) === false
    && (await newer.doNotContact().then(() => 'resolved', () => 'refused')) === 'refused');
  idb.dbs.get(DB).version = 1;
}

// ── recover ───────────────────────────────────────────────────────────────
console.log('recover');
{
  const c = { ...campaign('r', 1, { state: 'running', consent: true }), outcomes: {
    '9647501112233': { phone: '9647501112233', standing: 'sending', at: 5, attempts: 1 },
    '9647504445566': { phone: '9647504445566', standing: 'sent', at: 4, attempts: 1 },
  } };
  const r = recover(c);
  ok('whatever was sending may have gone: unknown, and why', r.outcomes['9647501112233'].standing === 'unknown' && r.outcomes['9647501112233'].why === 'interrupted');
  ok('everything else as it was', same(r.outcomes['9647504445566'], c.outcomes['9647504445566']));
  ok('a running campaign is paused, with a note', r.state === 'paused' && r.notes.includes('interrupted'));
  ok('the campaign given is not changed', c.state === 'running' && c.outcomes['9647501112233'].standing === 'sending');
  const halted = recover({ ...c, state: 'halted' });
  ok('a halted one stays halted (its sending person still becomes unknown)', halted.state === 'halted' && halted.outcomes['9647501112233'].standing === 'unknown');
  const calm = campaign('calm', 1);
  ok('a campaign with nothing to recover is returned as it is', recover(calm) === calm);
  ok('recover twice is recover once', same(recover(recover(c)), r));
  ok('and no runner of this process is sending it', isRunning('r') === false);
}

// ── fuzz ──────────────────────────────────────────────────────────────────
console.log('fuzz');
{
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const junk = [null, undefined, 0, -1, 1e20, NaN, '', 'x', '9647501112233', '+964 750 111 2233', true, [], {}, () => 1, Symbol.iterator, 'sending', 'queued', 'running'];
  const pick = () => junk[Math.floor(rnd() * junk.length)];
  const shape = (depth = 0) => {
    if (depth > 2 || rnd() < 0.3) return pick();
    const o = {};
    for (const k of ['id', 'name', 'phone', 'vars', 'recipients', 'outcomes', 'message', 'pace', 'state', 'standing', 'text', 'attachment', 'kind', 'data', 'consent', 'notes', 'seed', 'updated']) {
      if (rnd() < 0.4) o[k] = rnd() < 0.5 ? pick() : rnd() < 0.5 ? [shape(depth + 1), shape(depth + 1)] : shape(depth + 1);
    }
    if (rnd() < 0.5) o.id = `f${Math.floor(rnd() * 1000)}`;
    return o;
  };
  const STANDINGS = ['queued', 'sending', 'sent', 'failed', 'unknown', 'skipped-not-on-whatsapp', 'skipped-opted-out', 'skipped-invalid', 'skipped-duplicate'];
  const STATES = ['draft', 'ready', 'running', 'paused', 'done', 'stopped', 'halted'];
  let threw = 0, broken = 0;
  for (let i = 0; i < 4000; i++) {
    try {
      const c = readCampaign(shape(), rnd() < 0.3 ? shape() : undefined);
      const a = readAudience(shape());
      if (c && (!STATES.includes(c.state) || typeof c.consent !== 'boolean' || !paceInBounds(c.pace)
        || c.recipients.some((r) => !/^\d{6,15}$/.test(r.phone)) || Object.values(c.outcomes).some((o) => !STANDINGS.includes(o.standing) || !/^\d{6,15}$/.test(o.phone))
        || typeof c.message.text !== 'string' || typeof c.message.optOut !== 'boolean')) broken++;
      if (a && (a.recipients.some((r) => !/^\d{6,15}$/.test(r.phone)) || typeof a.name !== 'string')) broken++;
    } catch (e) { threw++; if (threw === 1) console.log('  info  first throw:', e); }
  }
  ok('4,000 random records: the readers never throw', threw === 0, threw);
  ok('and what they return is always well formed', broken === 0, broken);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
