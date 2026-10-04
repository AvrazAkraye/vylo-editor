// Adversarial review of the bulk-sending engine (docs/wa/review-engine.md). Every check here tries to make the feature
// message someone twice, start without a person's press, go faster than the pace, keep going when it should stop, send
// something other than the preview, forget an opt-out, or fall over on a hostile record. Nothing here can reach
// WhatsApp: the runner talks to the mock gateway on 127.0.0.1 through the real wire, or to an in-memory caller; the
// store runs on a fake IndexedDB; the screens are bundled with the real engine and drawn with react-dom/server.
//
// The sections follow the review's brief:
//   1 at most once · 2 who can start a run · 3 the pace and the cap · 4 errors and halting · 5 messages ·
//   6 stop words and the do-not-contact list · 7 storage · 8 the words in SAFETY.md
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { startMock } from './whatsapp-mock-server.mjs';
import { runCampaign, realDeps, recover } from '../.test-build/whatsappsend.js';
import {
  newCampaign, renderMessage, requeue, validateCampaign, clampPace, paceInBounds, isOptOut, optOutPhones, reportCsv,
} from '../.test-build/whatsappcampaign.js';
import { runBulkTool } from '../.test-build/whatsappbulktool.js';

const SLOW = process.env.CI ? 4 : 1; // the ceilings are the release machine's; a shared runner gets four times as long
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ROOT = resolve(APP, '..');
const require = createRequire(import.meta.url);

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); }
}
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const src = (f) => readFileSync(join(APP, 'src', f), 'utf8');

// The shared limits, written out (whatsappbulktypes.ts has no bundle of its own; wa-engine.test.mjs pins these).
const LIMITS = { recipients: 5_000, messageChars: 3_800, attachmentBytes: 16 * 1024 * 1024, campaigns: 60, suppressed: 20_000 };
const PACE_BOUNDS = { minDelaySec: [6, 120], maxDelaySec: [8, 300], batchSize: [5, 100], batchPauseSec: [30, 1800], dailyCap: [10, 1000], stopAfterFailures: [2, 10] };

/** A refusal shaped like `whatsappwire.ts`'s, for the in-memory callers. */
class WireError extends Error {
  constructor(status) { super(`The WhatsApp server answered ${status}.`); this.name = 'WireError'; this.status = status; }
}

// ── a fake IndexedDB (wa-engine-more's, plus: it records each transaction's options) ──────────────────────────────
function fakeIndexedDB() {
  const later = (fn) => setTimeout(fn, 0);
  const idb = {
    mode: { open: 'ok', abortWrites: false, failReads: false, throwOnTransaction: false },
    dbs: new Map(), opens: 0, puts: [], txs: [], conns: [],
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
    closeAll() { for (const c of idb.conns.splice(0)) c.onclose?.(); },
    store(db, s) { return idb.dbs.get(db)?.stores.get(s)?.data; },
  };
  function connection(name, rec) {
    return {
      name, onclose: null, onversionchange: null,
      objectStoreNames: { contains: (s) => rec.stores.has(s) },
      createObjectStore(s, opts) { rec.stores.set(s, { keyPath: opts.keyPath, data: new Map() }); },
      close() {},
      transaction(names, mode = 'readonly', options) {
        if (idb.mode.throwOnTransaction) throw new Error('InvalidStateError');
        const list = Array.isArray(names) ? names : [names];
        idb.txs.push({ names: list, mode, durability: options?.durability });
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
            // Cloned when the request runs, as a real store clones when it is handed the value — not later.
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
  }
  return idb;
}
const idb = fakeIndexedDB();
globalThis.indexedDB = idb;
const DB = 'vylo-whatsapp-bulk';
let storeN = 0;
/** A new copy of the store module: a new process, with nothing in memory and the same disk. */
const freshStore = () => import(`../.test-build/whatsappbulkstore.js?review=${++storeN}`);

// ── the mock gateway and a "process" around the runner ────────────────────────────────────────────────────────────
const mock = await startMock();
const conn = { baseUrl: mock.url, instance: 'shop', key: 'test-key' };
const wire = realDeps(conn, 'main');
const reset = () => { mock.log.length = 0; mock.delivered.length = 0; mock.clear(); mock.state = 'open'; mock.notOnWhatsApp.clear(); mock.numbersEndpoint = true; mock.counts = {}; };
const sendsIn = (log) => log.filter((r) => ['sendText', 'sendMedia', 'sendContact'].includes(r.endpoint));
const standings = (c) => Object.fromEntries(Object.values(c.outcomes).map((o) => [o.phone, o.standing]));

const START = new Date(2026, 9, 5, 9, 0, 0).getTime();
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const phoneOf = (i) => `96475000${String(i).padStart(5, '0')}`;
const people = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ phone: phoneOf(from + i), name: `P${from + i}`, vars: {} }));
let cid = 0;
function campaign(recipients, o = {}) {
  const c = newCampaign({ id: o.id ?? `r${++cid}`, name: 'Review', accountId: o.accountId ?? 'main', recipients,
    message: { text: '[[Hi|Hello]] {first_name|friend}, the offer is on.', lang: 'en', optOut: true, ...(o.message ?? {}) }, pace: o.pace, now: START });
  return { ...c, consent: true, ...(o.extra ?? {}) };
}

/**
 * One process: a fake clock, a disk (the last campaign saved, as it was), the day's counts per account, a
 * do-not-contact set and its own locks. `onSleep(ms, w)` may cut a wait short (return true), as a pause does.
 */
function world(o = {}) {
  const w = {
    t: o.t ?? START, disk: null, saves: 0, counts: o.counts ?? new Map(), blocked: o.blocked ?? new Set(), locks: o.locks ?? new Set(),
    waits: [], sleeps: [], account: o.account ?? 'main', r: null,
  };
  mock.clock = () => w.t;
  w.deps = (extra = {}) => ({
    ...wire,
    now: () => w.t,
    sleep: async (ms, signal) => {
      w.sleeps.push(ms);
      const cut = o.onSleep?.(ms, w);
      // Something the test set going during this wait (a poll of the panel, say) finishes before the wait does.
      if (w.pending) { await w.pending; w.pending = null; }
      if (cut || signal?.aborted) { w.t += 1000; return; }
      w.t += ms;
    },
    rnd: o.rnd ?? (() => 0.5),
    save: async (c) => { w.saves++; if (o.refuse?.(w.saves, c)) return false; w.disk = structuredClone(c); return true; },
    sentToday: async () => w.counts.get(`${w.account}|${dayKey(w.t)}`) ?? 0,
    counted: async (at) => { const k = `${w.account}|${dayKey(at)}`; w.counts.set(k, (w.counts.get(k) ?? 0) + 1); },
    suppressed: o.suppressed ?? (async () => new Set(w.blocked)),
    locks: w.locks,
    timeoutMs: o.timeoutMs ?? 1500,
    ...extra,
  });
  w.runner = (c, extra) => {
    const r = runCampaign(c, w.deps(extra));
    r.on((e) => { if (e.kind === 'wait') w.waits.push({ ...e, at: w.t }); });
    w.r = r;
    return r;
  };
  w.run = (c, extra) => w.runner(c, extra).start();
  return w;
}
/** Gaps between the sends the mock received, in seconds of the fake clock; the first from `from`. */
const gapsOf = (from) => { const s = sendsIn(mock.log); return s.map((x, i) => (x.at - (i ? s[i - 1].at : from)) / 1000); };

// ══ 1. at most once ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('1. at most once');
{
  reset();
  const spellings = ['+964 750 000 0001', '964-750-000-0001', '(964) 7500000001', '9647500000001', ' 964 750 000 0001 '];
  const w = world();
  const out = await w.run(campaign([...spellings.map((phone, i) => ({ phone, name: `S${i}`, vars: {} })), ...people(2, 10)]));
  ok('one number written five ways is one person, messaged once', mock.deliveriesTo('9647500000001') === 1 && mock.twice().length === 0, mock.delivered.map((d) => d.to));
  ok('and the campaign ends with three people, each with a standing', out.state === 'done' && Object.keys(out.outcomes).length === 3);
}
{
  // The same campaign object twice, and a copy of it with the same id: one process holds one runner per campaign.
  reset();
  let release;
  const w = world({ onSleep: () => false });
  const gate = new Promise((r) => { release = r; });
  const c = campaign(people(3, 20));
  const slow = w.deps({ sleep: async (ms) => { w.t += ms; await gate; } });
  const a = runCampaign(c, slow);
  const pa = a.start();
  await tick();
  const twin = runCampaign(structuredClone(c), slow);
  const other = runCampaign(campaign(people(2, 30), { accountId: 'main' }), slow);
  const r1 = await a.start().then(() => 'started', () => 'refused');
  const r2 = await twin.start().then(() => 'started', () => 'refused');
  const r3 = await other.start().then(() => 'started', () => 'refused');
  ok('a second start() of the same runner is refused', r1 === 'refused');
  ok('a copy of the campaign (same id) is refused while the first runs', r2 === 'refused');
  ok('another campaign on the same account is refused while the first runs (two would halve the pace)', r3 === 'refused');
  release();
  const done = await pa;
  ok('the first one finishes, and nobody got anything twice', done.state === 'done' && mock.twice().length === 0 && mock.delivered.length === 3);
  const again = await runCampaign(structuredClone(done), w.deps()).start();
  ok('a finished campaign started again resolves at once and sends nothing', again.state === 'done' && mock.delivered.length === 3);
}
{
  // A crash in an order the builder's sweep did not try: the request went, the reply came, the save of `sent` was
  // refused, and the process died while halting — the disk still says `sending`.
  reset();
  const w = world({ refuse: (n, c) => Object.values(c.outcomes).some((o) => o.standing === 'sent') });
  const first = await w.run(campaign(people(4, 40), { id: 'crash-order' }));
  ok('a refused save after the send halts (storage)', first.state === 'halted' && first.halted === 'storage');
  ok('the disk holds the person as `sending`', standings(w.disk)[phoneOf(40)] === 'sending', standings(w.disk));
  const w2 = world({ t: w.t });
  const restarted = recover(w2.disk ?? w.disk);
  const out = await w2.run(restarted);
  ok('after recover and resume, the first person is `unknown`, never re-sent', standings(out)[phoneOf(40)] === 'unknown' && mock.deliveriesTo(phoneOf(40)) === 1);
  ok('everyone else is sent once', [41, 42, 43].every((i) => mock.deliveriesTo(phoneOf(i)) === 1) && mock.twice().length === 0);
}
{
  // The same, but nobody calls recover: the runner reads `sending` as `unknown` itself.
  reset();
  const w = world({ refuse: (n, c) => Object.values(c.outcomes).some((o) => o.standing === 'sent') });
  await w.run(campaign(people(2, 50), { id: 'crash-no-recover' }));
  const w2 = world({ t: w.t });
  const out = await w2.run(w.disk);
  ok('a stored `sending` handed straight to a runner is `unknown`, not sent again', standings(out)[phoneOf(50)] === 'unknown' && mock.deliveriesTo(phoneOf(50)) === 1);
}
{
  // Continue after a halt (a run of 5xx): a new runner, a new process, from what the disk held.
  reset();
  mock.when({ endpoint: 'sendText', nth: 2, reply: { status: 503 }, deliver: true });
  mock.when({ endpoint: 'sendText', nth: 3, reply: { status: 502 }, deliver: true });
  mock.when({ endpoint: 'sendText', nth: 4, reply: 'drop', deliver: true });
  const w = world();
  const halted = await w.run(campaign(people(6, 60), { id: 'continue-after-halt' }));
  ok('three answers that may have gone halt the campaign (repeated-failures)', halted.state === 'halted' && halted.halted === 'repeated-failures');
  const w2 = world({ t: w.t });
  const out = await w2.run(w.disk);
  ok('Continue sends to the rest, and the three unsure are never sent again', out.state === 'done'
    && [61, 62, 63].every((i) => standings(out)[phoneOf(i)] === 'unknown' && mock.deliveriesTo(phoneOf(i)) === 1)
    && mock.twice().length === 0, standings(out));
  const w3 = world({ t: w2.t });
  const third = await w3.run({ ...structuredClone(out), state: 'paused' });
  ok('a finished campaign forced back to paused and continued sends nobody again', third.state === 'done' && mock.twice().length === 0 && mock.delivered.length === 6);
}
{
  // requeue: the only way back to the queue, and only from failed/unknown.
  const c = campaign(people(6, 70));
  const st = ['sent', 'failed', 'unknown', 'sending', 'skipped-opted-out', 'skipped-not-on-whatsapp'];
  c.outcomes = Object.fromEntries(st.map((s, i) => [phoneOf(70 + i), { phone: phoneOf(70 + i), standing: s, attempts: 1 }]));
  const back = requeue(c, [...people(6, 70).map((r) => r.phone), '__proto__', 'constructor', '+964 750 000 0071', '']);
  eq('requeue moves only `failed` and `unknown`', Object.values(back.outcomes).map((o) => o.standing), ['sent', 'queued', 'queued', 'sending', 'skipped-opted-out', 'skipped-not-on-whatsapp']);
  ok('hostile phones do nothing (no prototype touched, nothing added)', Object.keys(back.outcomes).length === 6 && ({}).standing === undefined);
  ok('and it is a copy: the campaign given is unchanged', c.outcomes[phoneOf(71)].standing === 'failed');
}

// ══ 2. who can start a run ══════════════════════════════════════════════════════════════════════════════════════
console.log('2. who can start a run');
{
  // By reading: the only call of runCampaign outside whatsappsend.ts is `launch`, and only Send and Continue call it.
  const files = ['WhatsAppRun.tsx', 'WhatsAppBroadcast.tsx', 'WhatsAppPeople.tsx', 'WhatsAppCompose.tsx', 'WhatsAppReady.tsx', 'WhatsAppPanel.tsx',
    'whatsappbulktool.ts', 'whatsapptool.ts', 'App.tsx', 'agent.ts', 'whatsappbulkstore.ts', 'whatsappcampaign.ts', 'whatsappwrite.ts', 'routines.ts'];
  const calls = files.flatMap((f) => [...src(f).matchAll(/runCampaign\(/g)].map(() => f));
  eq('runCampaign( is called in one screen file', calls, ['WhatsAppRun.tsx']);
  const run = src('WhatsAppRun.tsx');
  const inLaunch = run.slice(run.indexOf('export async function launch('), run.indexOf('// ── counting'));
  ok('…inside launch', /runCampaign\(ready, realDeps\(account\)\)/.test(inLaunch) && (run.match(/runCampaign\(/g) ?? []).length === 1);
  ok('…and `.start()` of a runner only there', (run.match(/runner\.start\(\)/g) ?? []).length === 1 && /runner\.start\(\)/.test(inLaunch));
  const b = src('WhatsAppBroadcast.tsx');
  eq('launch( is called by Send and Continue only', [...b.matchAll(/await launch\((\w+)/g)].map((m) => m[1]), ['campaign', 'c']);
  ok('the assistant\'s tools cannot reach the runner or the screens',
    !/whatsappsend|WhatsAppRun|WhatsAppBroadcast/.test(src('whatsappbulktool.ts')) && !/whatsappsend|WhatsAppRun|WhatsAppBroadcast/.test(src('whatsapptool.ts')));
  ok('no screen writes `consent: true`', !/consent:\s*true/.test(b + run + src('WhatsAppPeople.tsx') + src('WhatsAppCompose.tsx')));
  // The tick is for one list: going back to step 1 and loading another must not keep it. The screens review made the
  // tick belong to a key built from the draft, the exact people and the account (`reviewKey`), so a different list is a
  // different key and the box is un-ticked; there is no DOM runner in the repo, so this is held by reading.
  ok('the consent tick belongs to the review key (draft, exact people, account), not to the screen',
    /export function reviewKey\(id: string, recipients: readonly Recipient\[\], accountId: string\)/.test(b) && /consentFor/.test(b) && /reviewKey\(work\.id, people\?\.recipients \?\? \[\], account\?\.id \?\? ''\)/.test(b));
  ok('…and step 1 changes them only through that setter', /onPeople=\{setPeople\}/.test(b) && (b.match(/setPeopleState\(/g) ?? []).length === 3);
}
{
  // The runner's own gate, whoever calls it.
  reset();
  const w = world();
  const tries = [
    ['staged: true', { staged: true }],
    ['staged: "yes"', { staged: 'yes' }],
    ['consent: "true"', { consent: 'true' }],
    ['consent: 1', { consent: 1 }],
    ['consent missing', { consent: undefined }],
    ['no account', { accountId: '' }],
    ['a pace below the floor', { pace: { ...clampPace({}), minDelaySec: 0, maxDelaySec: 1 } }],
    ['no people', { recipients: [] }],
  ];
  for (const [label, patch] of tries) {
    const c = { ...campaign(people(2, 100)), ...patch };
    const r = await w.run(c).then(() => 'started', (e) => `refused: ${e.message}`);
    ok(`start() refuses ${label}`, r.startsWith('refused'), r);
  }
  ok('and not one request reached the gateway', mock.log.length === 0, mock.log.map((r) => r.endpoint));
}
{
  // The assistant's tool, with every argument a model could try in order to start, consent, un-stage or speed up.
  const saved = [];
  const audience = { id: 'a1', name: 'Customers', recipients: people(3, 110), source: 'text', created: 1, updated: 1 };
  const deps = {
    loadAudiences: async () => [audience], saveAudience: async () => true, saveCampaign: async (c) => { saved.push(structuredClone(c)); return true; },
    loadSuppressed: async () => new Set(), accountId: 'main', lang: 'en', now: () => START,
  };
  const out = await runBulkTool('whatsapp_campaign', {
    audience: 'a1', text: 'Hello {name}', consent: true, staged: false, state: 'running', start: true, send: true, confirm: true,
    pace: { minDelaySec: 0, dailyCap: 100000 }, id: 'existing-campaign', accountId: 'someone-else', account: 'someone-else', seed: 7,
    outcomes: { [phoneOf(110)]: { phone: phoneOf(110), standing: 'sent', attempts: 1 } },
  }, deps);
  const c = saved[0];
  ok('the tool answers and saves one draft', out && !out.isError && saved.length === 1, out);
  ok('consent false, staged, state draft, nobody sent', c.consent === false && c.staged === true && c.state === 'draft' && Object.keys(c.outcomes).length === 0);
  ok('the default pace, whatever was asked', paceInBounds(c.pace) && c.pace.minDelaySec === 12 && c.pace.dailyCap === 200);
  ok('its own new id and the account of the call, not the ones asked for', c.id !== 'existing-campaign' && c.accountId === 'main' && c.seed === undefined);
  ok('the answer says nothing was sent and gives no number', /NOTHING HAS BEEN SENT/.test(out.content) && !out.content.includes(phoneOf(110)));
  const r = await runCampaign({ ...c }, world().deps()).start().then(() => 'started', () => 'refused');
  ok('the draft it saved cannot be started by a runner', r === 'refused');
}

// ══ 3. the pace and the cap ═════════════════════════════════════════════════════════════════════════════════════
console.log('3. the pace and the cap');
{
  reset();
  const seq = [0, 1, 0.3, 0.999, 0, 0.5, 1, 0];
  let k = 0;
  const pace = clampPace({ minDelaySec: 6, maxDelaySec: 9, batchSize: 5, batchPauseSec: 40, typing: false });
  const w = world({ rnd: () => seq[k++ % seq.length] });
  await w.run(campaign(people(8, 120), { pace }));
  const gaps = gapsOf(START);
  ok('every message waits at least the shortest delay, the first one too', gaps.length === 8 && gaps.every((g) => g >= 6), gaps);
  ok('after every 5 messages the break is taken before the next', gaps[5] >= 40 + 6 && gaps.filter((g) => g >= 40).length === 1, gaps);
}
{
  // Pause during the break, resume at once: the break must still be served (it was skipped).
  reset();
  const pace = clampPace({ minDelaySec: 6, maxDelaySec: 8, batchSize: 5, batchPauseSec: 600, typing: false });
  let cut = false;
  const w = world({ rnd: () => 0, onSleep: (ms, me) => { if (ms === 600_000 && !cut) { cut = true; me.r.pause(); setImmediate(() => me.r.resume()); return true; } return false; } });
  const out = await w.run(campaign(people(7, 130), { pace }));
  const gaps = gapsOf(START);
  ok('a pause and a resume during the batch break do not shorten it', out.state === 'done' && cut && gaps[5] >= 600 + 6, gaps);
}
{
  // Pause during a 429 back-off, resume at once: the back-off must still be served.
  reset();
  mock.when({ endpoint: 'sendText', nth: 1, reply: { status: 429 } });
  const pace = clampPace({ minDelaySec: 6, maxDelaySec: 8, typing: false });
  let cut = false;
  const w = world({ rnd: () => 0, onSleep: (ms, me) => { if (ms === 30_000 && !cut) { cut = true; me.r.pause(); setImmediate(() => me.r.resume()); return true; } return false; } });
  const out = await w.run(campaign(people(2, 140), { pace }));
  const sends = sendsIn(mock.log);
  ok('a pause and a resume during the back-off after a 429 do not shorten it', out.state === 'done' && cut
    && sends.length === 3 && (sends[1].at - sends[0].at) / 1000 >= 30 + 6, sends.map((s) => (s.at - START) / 1000));
}
{
  // Pause during the delay itself: the whole delay is waited again after the resume.
  reset();
  const pace = clampPace({ minDelaySec: 20, maxDelaySec: 20, typing: false });
  let cut = 0;
  const w = world({ onSleep: (ms, me) => { if (ms === 20_000 && cut < 3) { cut++; me.r.pause(); setImmediate(() => me.r.resume()); return true; } return false; } });
  await w.run(campaign(people(2, 150), { pace }));
  const gaps = gapsOf(START);
  ok('pausing in the middle of a delay restarts it in full', gaps.every((g) => g >= 20), gaps);
}
{
  // A cap of 10, three campaigns on one account, one after the other, across days.
  reset();
  const counts = new Map();
  const pace = clampPace({ minDelaySec: 6, maxDelaySec: 8, dailyCap: 10, typing: false });
  let t = START;
  const outs = [];
  for (const [n, from] of [[10, 200], [5, 220], [10, 240]]) {
    const w = world({ t, counts });
    outs.push(await w.run(campaign(people(n, from), { pace })));
    t = w.t;
  }
  const perDay = new Map();
  for (const d of mock.delivered) perDay.set(dayKey(d.at), (perDay.get(dayKey(d.at)) ?? 0) + 1);
  ok('three campaigns at a cap of 10 never send more than 10 on one local day', [...perDay.values()].every((n) => n <= 10) && mock.delivered.length === 25, [...perDay]);
  ok('they wait for the next day rather than ending', outs.every((c) => c.state === 'done') && perDay.size === 3);
  ok('nobody twice across the three', mock.twice().length === 0);
  ok('the second campaign could not be started from the Review step that day (over-daily-cap)',
    validateCampaign(campaign(people(1, 260), { pace }), { sentToday: 10 }).some((p) => p.code === 'over-daily-cap'));
}
{
  // A campaign that spans midnight, and a clock that jumps backwards a day in the middle of it.
  reset();
  const counts = new Map();
  const pace = clampPace({ minDelaySec: 120, maxDelaySec: 120, dailyCap: 10, batchSize: 100, typing: false });
  const late = new Date(2026, 9, 5, 23, 40, 0).getTime();
  let jumped = false;
  const w = world({ t: late, counts, onSleep: (ms, me) => { if (!jumped && mock.delivered.length === 14) { jumped = true; me.t -= 86_400_000; } return false; } });
  const out = await w.run(campaign(people(25, 300), { pace }));
  const perDay = new Map();
  for (const d of mock.delivered) perDay.set(dayKey(d.at), (perDay.get(dayKey(d.at)) ?? 0) + 1);
  ok('across midnight and a clock thrown back a day, no local day gets more than the cap', out.state === 'done' && jumped && [...perDay.values()].every((n) => n <= 10), [...perDay]);
  ok('…and everyone is sent once', mock.delivered.length === 25 && mock.twice().length === 0);
}
{
  // Daylight saving: the wait for "tomorrow" always ends on the next calendar day, after now, within 25 hours.
  const zones = [
    ['America/Santiago', [new Date(2026, 8, 5, 23, 30), new Date(2026, 3, 4, 23, 30)]],
    ['America/Havana', [new Date(2026, 9, 31, 23, 30), new Date(2026, 2, 7, 23, 30)]],
    ['Europe/Berlin', [new Date(2026, 9, 24, 23, 59), new Date(2026, 2, 28, 23, 59)]],
    ['Asia/Baghdad', [new Date(2026, 9, 5, 23, 59)]],
  ];
  const was = process.env.TZ;
  const bad = [];
  for (const [zone, at] of zones) {
    process.env.TZ = zone;
    for (const d of at) {
      for (let step = -90; step <= 90; step += 30) {
        reset();
        // Rebuild the instant in this zone (the Date above was made in the previous one).
        const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()).getTime() + step * 60_000;
        const counts = new Map([[`main|${dayKey(t0)}`, 10]]);
        const w = world({ t: t0, counts });
        await w.run(campaign(people(1, 400), { pace: clampPace({ minDelaySec: 6, maxDelaySec: 6, dailyCap: 10, typing: false }) }));
        const capWait = w.waits.find((x) => x.why === 'daily-cap');
        const sent = mock.delivered[0];
        const good = capWait && capWait.until > capWait.at && capWait.until - capWait.at <= 25 * 3_600_000
          && dayKey(capWait.until) !== dayKey(capWait.at) && sent && dayKey(sent.at) !== dayKey(t0);
        if (!good) bad.push(`${zone} ${new Date(t0).toString()}`);
      }
    }
  }
  process.env.TZ = was;
  if (was === undefined) delete process.env.TZ;
  ok('in four time zones around their DST changes, the cap waits until the next local day and then sends', bad.length === 0, bad);
}
{
  // clampPace cannot be defeated: not by a stored record, a hand-made object, a string, a negative, NaN or 1e9.
  const hostile = [
    { minDelaySec: -5, maxDelaySec: -1, batchSize: 0, batchPauseSec: -1, dailyCap: 1e9, stopAfterFailures: 0 },
    { minDelaySec: NaN, maxDelaySec: Infinity, batchSize: '1e9', batchPauseSec: '-0', dailyCap: '9999', stopAfterFailures: 1e9 },
    { minDelaySec: '0x01', maxDelaySec: '2', batchSize: [5], batchPauseSec: { valueOf: () => 1 }, dailyCap: true, stopAfterFailures: null },
    { minDelaySec: 300, maxDelaySec: 8 }, null, 'fast', 5, [],
  ];
  const all = hostile.map((p) => clampPace(p));
  ok('every hostile pace comes out inside PACE_BOUNDS', all.every(paceInBounds) && all.every((p) => Object.entries(PACE_BOUNDS).every(([k, [lo, hi]]) => p[k] >= lo && p[k] <= hi)), all);
  ok('the longest wait is never under the shortest', all.every((p) => p.maxDelaySec >= p.minDelaySec));
  ok('the shortest wait never goes under 6 s', Math.min(...all.map((p) => p.minDelaySec)) >= 6);
  const run = src('WhatsAppRun.tsx');
  ok('every pace field on the Review step takes its bounds from PACE_BOUNDS and clamps on blur',
    (run.match(/bounds=\{PACE_BOUNDS\.\w+\}/g) ?? []).length === 6 && /Math\.min\(bounds\[1\], Math\.max\(bounds\[0\]/.test(run) && /onPace\(clampPace\(/.test(run));
}

// ══ 4. errors and halting ═══════════════════════════════════════════════════════════════════════════════════════
console.log('4. errors and halting');
{
  // Every class of answer to the first send. `deliver: true` where the message may have gone, to prove it is not re-sent.
  const table = [
    ['400', { status: 400 }, false, 'failed', 'invalid', 'done'],
    ['401', { status: 401 }, false, 'queued', undefined, 'auth'],
    ['403', { status: 403 }, false, 'queued', undefined, 'auth'],
    ['404', { status: 404 }, false, 'queued', undefined, 'instance'],
    ['405', { status: 405 }, false, 'queued', undefined, 'instance'],
    ['408', { status: 408 }, true, 'unknown', 'http-408', 'done'],
    ['409', { status: 409 }, false, 'failed', 'http-409', 'done'],
    ['413', { status: 413 }, false, 'failed', 'http-413', 'done'],
    ['500', { status: 500 }, true, 'unknown', 'http-500', 'done'],
    ['502', { status: 502 }, true, 'unknown', 'http-502', 'done'],
    ['503', { status: 503 }, true, 'unknown', 'http-503', 'done'],
    ['504', { status: 504 }, true, 'unknown', 'http-504', 'done'],
    ['a dropped connection', 'drop', true, 'unknown', 'network', 'done'],
    ['a body that is not JSON', 'garbage', true, 'unknown', 'unreadable', 'done'],
    ['an empty body', 'empty', true, 'unknown', 'unreadable', 'done'],
    ['no answer at all', 'hang', true, 'unknown', 'timeout', 'done'],
    ['an answer after the timeout', { late: 2500 }, true, 'unknown', 'timeout', 'done'],
    ['a 200 that says exists:false', { status: 200, body: { exists: false, number: phoneOf(500) } }, false, 'unknown', 'no-receipt', 'done'],
    ['a 201 whose words say logged out', { status: 201, body: { status: 'ERROR', error: 'logged out' } }, false, 'unknown', 'account', 'account'],
  ];
  for (const [label, reply, deliver, standing, why, end] of table) {
    reset();
    mock.when({ endpoint: 'sendText', nth: 1, reply, deliver });
    const w = world();
    const out = await w.run(campaign(people(3, 500), { pace: clampPace({ stopAfterFailures: 3 }) }));
    const o = out.outcomes[phoneOf(500)];
    const halted = end === 'done' ? out.state === 'done' : out.state === 'halted' && out.halted === end;
    ok(`${label}: the person is ${standing}${why ? ` (${why})` : ''}, the run ${end}`, o.standing === standing && o.why === why && halted && mock.twice().length === 0,
      { standing: o.standing, why: o.why, state: out.state, halted: out.halted });
    if (deliver) ok(`${label}: the message that may have gone is never sent again`, mock.deliveriesTo(phoneOf(500)) === 1);
  }
  await wait(1200); // the late answers above land on closed requests
}
{
  // 429: the same person again after a back-off, three in a row halt.
  reset();
  mock.when({ endpoint: 'sendText', nth: 1, reply: { status: 429 } });
  const w = world();
  const out = await w.run(campaign(people(2, 520)));
  ok('a 429 puts the person back and tries again after 30 s', out.state === 'done' && out.outcomes[phoneOf(520)].standing === 'sent'
    && w.waits.some((x) => x.until - x.at === 30_000) && out.notes?.includes('rate-limited'));
  reset();
  mock.when({ endpoint: 'sendText', reply: { status: 429 } });
  const w2 = world();
  const out2 = await w2.run(campaign(people(2, 530)));
  ok('429 every time: halted rate-limited after three, nobody marked as sent', out2.state === 'halted' && out2.halted === 'rate-limited'
    && sendsIn(mock.log).length === 3 && out2.outcomes[phoneOf(530)].standing === 'queued');
}
{
  // The connection flaps: open, closed at a batch break, open again for Continue.
  reset();
  const pace = clampPace({ minDelaySec: 6, maxDelaySec: 6, batchSize: 5, batchPauseSec: 60, typing: false });
  const w = world({ onSleep: (ms) => { if (ms === 60_000) mock.state = 'close'; return false; } });
  const out = await w.run(campaign(people(8, 540), { pace }));
  ok('a number disconnected during the break halts the run before the next message', out.state === 'halted' && out.halted === 'not-connected' && mock.delivered.length === 5);
  mock.state = 'open';
  const w2 = world({ t: w.t });
  const out2 = await w2.run(w.disk);
  ok('connected again, Continue sends the rest once each', out2.state === 'done' && mock.delivered.length === 8 && mock.twice().length === 0);
  reset();
  mock.state = 'connecting';
  const out3 = await world().run(campaign(people(2, 560)));
  ok('`connecting` is not open: halted before any message', out3.state === 'halted' && out3.halted === 'not-connected' && mock.delivered.length === 0);
  reset();
  const w4 = world();
  const out4 = await w4.run(campaign(people(4, 570), { pace: clampPace({ typing: false }) }), {
    call: async (path, body) => { if (mock.delivered.length === 2 && path.includes('sendText')) mock.state = 'close'; return wire.call(path, body); },
  });
  ok('closed between two messages: the send fails (unknown), the check after it halts', out4.state === 'halted' && out4.halted === 'not-connected'
    && out4.outcomes[phoneOf(572)].standing === 'unknown' && mock.delivered.length === 2);
}
{
  // The number check works for the first fifty and then fails: 404 carries on without it, 500 halts.
  reset();
  mock.when({ endpoint: 'whatsappNumbers', nth: 2, reply: { status: 404 } });
  const out = await world().run(campaign(people(55, 600)));
  ok('a number check that disappears mid-run (404): carries on, and says so', out.state === 'done' && out.notes?.includes('number-check-unavailable') && mock.delivered.length === 55);
  reset();
  mock.when({ endpoint: 'whatsappNumbers', reply: { status: 500 } });
  mock.when({ endpoint: 'whatsappNumbers', nth: 1, reply: { status: 200, body: people(50, 700).map((r) => ({ exists: true, number: r.phone })) } });
  mock.clear();
  mock.when({ endpoint: 'whatsappNumbers', nth: 2, reply: { status: 500 } });
  mock.when({ endpoint: 'whatsappNumbers', nth: 3, reply: { status: 500 } });
  mock.when({ endpoint: 'whatsappNumbers', nth: 4, reply: { status: 500 } });
  mock.when({ endpoint: 'whatsappNumbers', nth: 5, reply: { status: 500 } });
  const out2 = await world().run(campaign(people(55, 700)));
  ok('a number check that starts failing (500) mid-run halts, after the fifty it could check',
    out2.state === 'halted' && out2.halted === 'repeated-failures' && mock.delivered.length === 50 && mock.of('whatsappNumbers').length <= 4, { d: mock.delivered.length, n: mock.of('whatsappNumbers').length });
}
{
  // The breaker: a success resets it, a skipped person does not.
  reset();
  for (const i of [800, 801, 803]) mock.when({ endpoint: 'sendText', to: phoneOf(i), reply: { status: 503 } });
  const w = world({ suppressed: async () => (mock.of('sendText').some((r) => r.body?.number === phoneOf(801)) ? new Set([phoneOf(802)]) : new Set()) });
  const out = await w.run(campaign(people(6, 800), { pace: clampPace({ stopAfterFailures: 3, typing: false }) }));
  ok('fail, fail, (someone opts out), fail: halted — a skip is not a success', out.state === 'halted' && out.halted === 'repeated-failures'
    && out.outcomes[phoneOf(802)].standing === 'skipped-opted-out' && out.outcomes[phoneOf(804)].standing === 'queued', standings(out));
  reset();
  for (const i of [810, 811, 813, 814]) mock.when({ endpoint: 'sendText', to: phoneOf(i), reply: { status: 503 } });
  const out2 = await world().run(campaign(people(6, 810), { pace: clampPace({ stopAfterFailures: 3, typing: false }) }));
  ok('fail, fail, sent, fail, fail: not halted — a success resets the count', out2.state === 'done' && out2.outcomes[phoneOf(812)].standing === 'sent');
}
{
  // When everything fails, it halts — it does not loop.
  const cases = [
    ['every request 500', { endpoint: '*', reply: { status: 500 } }, 'not-connected'],
    ['the number check always 500', { endpoint: 'whatsappNumbers', reply: { status: 500 } }, 'repeated-failures'],
    ['every send 500', { endpoint: 'sendText', reply: { status: 500 } }, 'repeated-failures'],
    ['every send 400', { endpoint: 'sendText', reply: { status: 400 } }, 'repeated-failures'],
    ['every request dropped', { endpoint: '*', reply: 'drop' }, 'not-connected'],
    ['the connection check 429 for ever', { endpoint: 'connectionState', reply: { status: 429 } }, 'rate-limited'],
  ];
  for (const [label, rule, why] of cases) {
    reset();
    mock.when(rule);
    const out = await world().run(campaign(people(30, 900), { pace: clampPace({ stopAfterFailures: 3 }) }));
    ok(`${label}: halted (${why}) after a handful of requests`, out.state === 'halted' && out.halted === why && mock.log.length <= 12, { state: out.state, halted: out.halted, requests: mock.log.length });
  }
}

// ══ 5. messages ═════════════════════════════════════════════════════════════════════════════════════════════════
console.log('5. messages');
{
  const d = (text, o = {}) => ({ text, lang: 'en', optOut: false, ...o });
  const r = (name, vars = {}) => ({ phone: '9647501112233', name, vars });
  eq('a name that looks like a variable is printed, not expanded', renderMessage(d('Hi {name}'), r('{city}', { city: 'Erbil' })), 'Hi {city}');
  eq('…nor a choice', renderMessage(d('Hi {name}'), r('[[a|b]]')), 'Hi [[a|b]]');
  eq('…nor an escape', renderMessage(d('Hi {name}!'), r('\\{name\\}')), 'Hi \\{name\\}!');
  eq('a value holding the opt-out syntax or a pipe stays as it is', renderMessage(d('{x} and {y}'), r('', { x: '{name|fallback}', y: 'a|b' })), '{name|fallback} and a|b');
  const evil = 'A‮evil‬⁦x⁩‏y\u0000z\n\r\tw';
  const out = renderMessage(d('Hi {name}.'), r(evil));
  ok('bidi overrides, isolates, marks, controls and line breaks never come in with a name', !/[‪-‮⁦-⁩‎‏\u0000-\u001F]/.test(out), JSON.stringify(out));
  eq('…and what is left is the name, on one line', out, 'Hi Aevilxyz w.');
  ok('emoji and zero-width joiners in a name survive', renderMessage(d('Hi {name}'), r('👩‍👩‍👧 ژیان')).includes('👩‍👩‍👧'));
  const big = 'x'.repeat(100_000);
  ok('a 100 KB name is cut to 120 characters', renderMessage(d('{name}'), r(big)).length === 120);
  ok('a cut never leaves half an emoji', !/[\uD800-\uDBFF]$/.test(renderMessage(d('{name}'), r('a'.repeat(119) + '😀'))));
  const many = { text: 'Hi {name}, ' + 'b'.repeat(3770), lang: 'en', optOut: true };
  ok('(the body alone fits)', !validateCampaign({ ...campaign([r('Ali')]), message: { ...many, optOut: false } }).some((p) => p.code === 'message-too-long'));
  ok('an opt-out line that pushes a message over the limit is a problem on the Review step',
    validateCampaign({ ...campaign([r('Ali')]), message: many }).some((p) => p.code === 'message-too-long'));
  const sent = renderMessage(many, r('Ali'));
  ok('…and anyone who renders it anyway keeps the opt-out line, within the limit', sent.length <= LIMITS.messageChars && sent.endsWith('Reply STOP to stop receiving messages.'));
  const spin = { text: '[[Hi|Hello|Hey]] [[there|friend]] {name}', lang: 'en', optOut: false };
  const rs = people(40, 1000);
  ok('the preview (no seed given) is what a campaign without a seed sends', rs.every((x) => renderMessage(spin, x) === renderMessage(spin, x, 0)));
  ok('the Review step draws the first person with that same default seed', /renderMessage\(draftOf\(msg\), first\)/.test(src('WhatsAppRun.tsx')) && !/seed/.test(src('WhatsAppBroadcast.tsx')));
}
{
  // Attachments: 0 bytes, exactly 16 MB, one byte more, a size that lies.
  const att = (o) => ({ ...campaign(people(1, 1100)), message: { text: 'x', lang: 'en', optOut: false, attachment: { kind: 'image', name: 'a.jpg', mime: 'image/jpeg', bytes: 0, data: '', ...o } } });
  const codes = (c) => validateCampaign(c).map((p) => p.code);
  ok('a 0-byte attachment is unreadable', codes(att({})).includes('attachment-unreadable'));
  const b64 = (n) => 'A'.repeat(Math.ceil(n / 3) * 4);
  ok('exactly 16 MB is accepted', !codes(att({ data: b64(LIMITS.attachmentBytes - 2), bytes: LIMITS.attachmentBytes })).some((c) => c.startsWith('attachment')));
  ok('16 MB and a byte is too big', codes(att({ data: b64(LIMITS.attachmentBytes + 3), bytes: 10 })).includes('attachment-too-big'));
  ok('a size field that lies small does not hide a big file', codes(att({ data: b64(LIMITS.attachmentBytes + 3000), bytes: 1 })).includes('attachment-too-big'));
  const card = { kind: 'contact', name: 'card', mime: '', bytes: 0, data: '', contact: { fullName: 'Ali\nEND:VCARD\nBEGIN:VCARD\nTEL:999', phone: '+964 750 111 2233', organization: 'Shop\r\nX-EVIL:1' } };
  reset();
  await world().run({ ...campaign(people(1, 1110)), message: { text: 'Here is our card', lang: 'en', optOut: false, attachment: card } });
  const sentCard = mock.of('sendContact')[0]?.body?.contact?.[0];
  ok('a contact card with line breaks in its fields goes out on one line each (no vCard injection)', sentCard && !/[\r\n]/.test(sentCard.fullName + sentCard.organization) && sentCard.wuid === '9647501112233', sentCard);
}
{
  // The report a person opens in a spreadsheet: names and stored keys that are formulas arrive as text.
  const c = campaign([{ phone: '9647501112233', name: '=HYPERLINK("http://x","y")', vars: {} }, { phone: '9647504445566', name: '@SUM(1)', vars: {} }]);
  c.outcomes = { '+cmd|/C calc!A0': { phone: '+cmd|/C calc!A0', standing: 'sent', attempts: 1, why: '-2+3' } };
  const csv = reportCsv(c);
  ok('the CSV report neutralises formulas in names, keys and reasons', !/(^|,)"?[=+\-@]/m.test(csv.split('\r\n').slice(1).join('\r\n')), csv);
}
{
  // Send a test to myself: refused before any request when there is nothing to send or nobody to send it to.
  const { sendTest } = await import('../.test-build/whatsappsend.js');
  reset();
  const r = [await sendTest({ ...conn, key: '' }, '9647501112233', 'hi'), await sendTest(conn, '12', 'hi'), await sendTest(conn, '9647501112233', '   ')];
  eq('no key, a number that is not one, an empty text: each refused by name', r, [{ failed: 'no-account' }, { failed: 'invalid-number' }, { failed: 'empty' }]);
  ok('…and nothing reached the gateway', mock.log.length === 0);
  mock.when({ endpoint: 'sendText', nth: 1, reply: { status: 503 }, deliver: true });
  eq('a test answered 503 says so and is not tried again by itself', await sendTest(conn, '9647501112233', 'hi'), { failed: 'http-503' });
  ok('…one request', mock.of('sendText').length === 1);
}

// ══ 6. stop words and the do-not-contact list ═══════════════════════════════════════════════════════════════════
console.log('6. stop words');
{
  const stops = [
    // English, the way people write it
    'STOP STOP', 'stop stop stop', 'please remove me from your list', 'remove me from this list', 'take me off your list', 'take me off the list',
    "don't message me", 'please dont text me', 'do not contact me', 'stop contacting me', 'opt me out',
    // Arabic
    'لا ترسل', 'لا ترسلوا لي', 'لا أريد رسائل', 'توقفوا', 'كفى', 'إِيقَاف', 'الغاء الاشتراك من فضلك',
    // Kurdish in Latin letters (Kurmanji/Badini and Sorani)
    'raweste', 'Raweste!', 'rawestîne', 'westan', 'nexwazim',
    // Kurdish in Arabic letters (already held)
    'وەستان', 'بەس', 'ڕاوەستە',
  ];
  const notStops = [
    "don't stop", 'dont stop the music', 'please stop by tomorrow', 'Can you stop by the shop?', 'cancel my order', 'the end',
    'لا توقف', 'متى تتوقفون عن العمل؟', 'بەس نرخەکەی چەندە؟', 'stop '.repeat(10), 'ok thanks', 'dont', 'please dont',
  ];
  const missed = stops.filter((s) => !isOptOut(s));
  ok('stop requests in four languages are recognised', missed.length === 0, missed);
  const wrong = notStops.filter((s) => isOptOut(s));
  ok('and what is not one is not', wrong.length === 0, wrong);
  const msg = (jid, text, fromMe = false) => ({ id: `${jid}${text}`, keyId: 'k', jid, fromMe, at: 1, text, kind: 'text', who: '', status: '', quoted: null });
  const set = new Set(['9647501112233']);
  eq('a STOP from a `@lid` with no number beside it cannot be tied to anyone (reported, not fixable here)', optOutPhones([msg('123456789012345@lid', 'STOP')], set), []);
  eq('a STOP said in a group is not said to us', optOutPhones([msg('120363000000000000@g.us', 'STOP')], set), []);
}
{
  // The do-not-contact list at its ceiling must not forget an opt-out across a restart.
  const s = await freshStore();
  const have = (await s.loadSuppressed()).size;
  const fill = Array.from({ length: LIMITS.suppressed - have }, (_, i) => String(9650000000000 + i));
  await s.addSuppressed(fill);
  ok('the list is at its ceiling', (await s.loadSuppressed()).size >= LIMITS.suppressed);
  const keptNow = await s.addSuppressed(['9647509990001']);
  const after = await (await freshStore()).loadSuppressed();
  ok('someone who asks to stop when the list is full is still on it after a restart', after.has('9647509990001'), { keptNow, size: after.size });
  ok('…and the addition says it was kept', keptNow === true);
  // Clean up the 20,000 so the rest of the file runs on a small list.
  idb.store(DB, 'suppressed').clear();
}
{
  // A reply that is a stop word puts the sender on the list without anyone pressing a button (WA.md non-negotiable 3).
  const s = await freshStore();
  ok('the store offers addStopReplies', typeof s.addStopReplies === 'function');
  if (typeof s.addStopReplies === 'function') {
    const c = { ...campaign([...people(3, 1200)], { id: 'stops' }) };
    await s.saveCampaign(c);
    const msg = (jid, text, fromMe = false, id = Math.random().toString(36)) => ({ id, keyId: id, jid, fromMe, at: 1, text, kind: 'text', who: '', status: '', quoted: null });
    const added = await s.addStopReplies([
      msg(`${phoneOf(1200)}@s.whatsapp.net`, 'STOP'),
      msg(`${phoneOf(1201)}@s.whatsapp.net`, 'stop by tomorrow?'),
      msg(`${phoneOf(1202)}@s.whatsapp.net`, 'STOP', true),
      msg('9647599999999@s.whatsapp.net', 'STOP'),
      msg('120363000000000000@g.us', 'STOP'),
    ]);
    eq('the campaign person who replied STOP is added; not a question, not ourselves, not a stranger, not a group', added, [phoneOf(1200)]);
    const restarted = await freshStore();
    ok('…and is on the list after a restart', (await restarted.loadSuppressed()).has(phoneOf(1200)));
    const before = idb.txs.length;
    await s.addStopReplies([msg(`${phoneOf(1200)}@s.whatsapp.net`, 'STOP')]);
    ok('a STOP already on the list costs no reading of the campaigns', !idb.txs.slice(before).some((x) => x.names.includes('campaigns')));
    const quiet = idb.txs.length;
    await s.addStopReplies(Array.from({ length: 200 }, (_, i) => msg(`${phoneOf(1300 + i)}@s.whatsapp.net`, 'Thanks, see you')));
    ok('two hundred ordinary messages cost no storage at all', idb.txs.length === quiet);
  }
  {
    // End to end in one process: a STOP read by the panel mid-run is honoured by the runner before its next message.
    const s = await freshStore();
    reset();
    const list = people(5, 1250);
    const c = campaign(list, { id: 'stop-mid-run' });
    let told = false;
    const w = world({
      suppressed: s.doNotContact,
      onSleep: (ms, me) => {
        if (!told && mock.delivered.length === 2) {
          told = true;
          // The phone of the fourth person answers the second message with a STOP; the panel's next poll reads it
          // during the wait before the third message.
          me.pending = s.addStopReplies([{ id: 'm1', keyId: 'm1', jid: `${phoneOf(1253)}@s.whatsapp.net`, fromMe: false, at: 1, text: 'Stop please', kind: 'text', who: '', status: '', quoted: null }]);
        }
        return false;
      },
    });
    const out = await w.run(c, { save: s.saveCampaign });
    await tick();
    ok('a STOP that arrives mid-run: that person is skipped (opted out) and never messaged', told && out.state === 'done'
      && out.outcomes[phoneOf(1253)].standing === 'skipped-opted-out' && mock.deliveriesTo(phoneOf(1253)) === 0 && mock.delivered.length === 4, standings(out));
  }
  const b = src('WhatsAppBroadcast.tsx');
  const load = b.slice(b.indexOf('// ── loading what is kept'), b.indexOf('// The working list is written'));
  ok('opening Broadcast never starts anything: the loading code recovers and shows, it does not launch', load.length > 200 && !/launch\(|runCampaign|\.start\(/.test(load) && /recover\(stuck\)/.test(load));
  const panel = src('WhatsAppPanel.tsx');
  ok('the WhatsApp panel puts STOP replies on the list each time its messages refresh', /addStopReplies\(msgs\)/.test(panel) && /\[msgs\]/.test(panel.slice(panel.indexOf('addStopReplies(msgs)'), panel.indexOf('addStopReplies(msgs)') + 200)));
}

// ══ 7. storage ══════════════════════════════════════════════════════════════════════════════════════════════════
console.log('7. storage');
{
  const s = await freshStore();
  idb.txs.length = 0;
  await s.saveCampaign(campaign(people(2, 1400), { id: 'durable' }));
  const w = idb.txs.find((x) => x.mode === 'readwrite' && x.names.includes('campaigns'));
  ok('the save before a send asks storage for a durable commit (not "relaxed")', w && w.durability === 'strict', w);
  await s.addSuppressed(['9647501231231']);
  const d = idb.txs.find((x) => x.mode === 'readwrite' && x.names.includes('suppressed'));
  ok('so does an opt-out', d && d.durability === 'strict', d);
  await s.countSent('main', START, 1);
  const n = idb.txs.find((x) => x.mode === 'readwrite' && x.names.includes('sent'));
  ok('and the day\'s count', n && n.durability === 'strict', n);
}
{
  // What is saved is the campaign as it was when save was called, even if it changes before storage gets to it.
  const s = await freshStore();
  const c = campaign(people(2, 1500), { id: 'snapshot' });
  c.outcomes = { [phoneOf(1500)]: { phone: phoneOf(1500), standing: 'sending', attempts: 1 } };
  const p = s.saveCampaign(c);
  c.outcomes[phoneOf(1500)] = { phone: phoneOf(1500), standing: 'queued', attempts: 0 };
  c.outcomes[phoneOf(1501)] = { phone: phoneOf(1501), standing: 'sent', attempts: 1 };
  await p;
  const back = (await (await freshStore()).loadCampaigns()).find((x) => x.id === 'snapshot');
  ok('a save keeps the outcomes as they were at the call, not as they were changed after it', back && back.outcomes[phoneOf(1500)]?.standing === 'sending' && !back.outcomes[phoneOf(1501)],
    back && back.outcomes);
}
{
  // Hostile records: the readers clamp, lean towards not sending, and never throw.
  const s = await freshStore();
  const real = people(3, 1600);
  const junk = Object.fromEntries(Array.from({ length: 6000 }, (_, i) => [String(9660000000000 + i), { phone: String(9660000000000 + i), standing: 'queued', attempts: 0 }]));
  const rec = {
    id: 'hostile', name: 'x', accountId: 'main', recipients: real, consent: true, state: 'paused',
    message: { text: 'hi', lang: 'en', optOut: false }, pace: { minDelaySec: 0, dailyCap: 1e9 }, created: 1, updated: 1,
    outcomes: {
      ...junk,
      [phoneOf(1600)]: { phone: phoneOf(1600), standing: 'sent', attempts: 1 },
      // One number under two spellings: the queued one first.
      [`+${phoneOf(1601)}`]: { phone: `+${phoneOf(1601)}`, standing: 'queued', attempts: 0 },
      [phoneOf(1601)]: { phone: phoneOf(1601), standing: 'sent', attempts: 1 },
      // A key and a phone field that disagree.
      [phoneOf(1602)]: { phone: '111111', standing: 'unknown', attempts: 1 },
    },
  };
  Object.defineProperty(rec.outcomes, '__proto__', { value: { phone: phoneOf(1603), standing: 'queued', attempts: 0 }, enumerable: true });
  const c = s.readCampaign(rec);
  ok('a stored record never pushes a sent person out with junk outcomes', c.outcomes[phoneOf(1600)]?.standing === 'sent', c.outcomes[phoneOf(1600)]);
  ok('two outcomes for one number: the one that says something happened wins', c.outcomes[phoneOf(1601)]?.standing === 'sent', c.outcomes[phoneOf(1601)]);
  ok('a key and a phone field that disagree: the person the key names keeps the standing', c.outcomes[phoneOf(1602)]?.standing === 'unknown', c.outcomes[phoneOf(1602)]);
  ok('outcomes stay within the ceiling', Object.keys(c.outcomes).length <= LIMITS.recipients + real.length);
  ok('the pace comes back inside the bounds', paceInBounds(c.pace));
  ok('`__proto__` is a key like any other: nothing reaches a prototype', ({}).standing === undefined && Object.getPrototypeOf(c.outcomes) === Object.prototype);
  reset();
  const out = await world().run({ ...c, consent: true });
  ok('started from that record, nobody already sent is sent again', mock.deliveriesTo(phoneOf(1600)) === 0 && mock.deliveriesTo(phoneOf(1601)) === 0 && mock.deliveriesTo(phoneOf(1602)) === 0, mock.delivered.map((x) => x.to));
  for (const bad of [null, 5, 'x', [], { id: '' }, { id: 'x'.repeat(81) }, { id: 'ok', recipients: 'no', outcomes: [1, 2], message: 7, pace: 'fast', state: 'exploded', consent: 'yes' }]) {
    let threw = false, got;
    try { got = s.readCampaign(bad); } catch { threw = true; }
    ok(`a hostile record ${JSON.stringify(bad)?.slice(0, 40)} never throws`, !threw && (got === null || (got.consent === false && got.state === 'paused' && Array.isArray(got.recipients))));
  }
}
{
  // Quota, a newer schema, a blocked open, the database closed under us.
  const s = await freshStore();
  idb.mode.abortWrites = true;
  reset();
  const out = await world({}).run(campaign(people(2, 1700), { id: 'quota' }), { save: s.saveCampaign });
  idb.mode.abortWrites = false;
  ok('storage full: halted (storage) and nothing sent', out.state === 'halted' && out.halted === 'storage' && mock.delivered.length === 0);
  const rec = idb.dbs.get(DB);
  rec.version = 99;
  const newer = await freshStore();
  ok('a database from a newer build: nothing saved, nothing thrown', (await newer.saveCampaign(campaign(people(1, 1710)))) === false && (await newer.loadCampaigns()).length === 0);
  ok('…and the runner is refused the do-not-contact list rather than given an empty one', (await newer.doNotContact().then(() => 'resolved', () => 'refused')) === 'refused');
  rec.version = 1;
  const s2 = await freshStore();
  await s2.saveCampaign(campaign(people(1, 1720), { id: 'before-close' }));
  idb.closeAll();
  ok('the database closed under us: the next save opens it again', (await s2.saveCampaign(campaign(people(1, 1721), { id: 'after-close' }))) === true);
  const big = { kind: 'video', name: 'a.mp4', mime: 'video/mp4', bytes: LIMITS.attachmentBytes, data: 'A'.repeat((LIMITS.attachmentBytes / 3) * 4) };
  const t0 = performance.now();
  const kept = await s2.saveCampaign({ ...campaign(people(5, 1730), { id: 'big' }), message: { text: 'x', lang: 'en', optOut: false, attachment: big } });
  const back = (await (await freshStore()).loadCampaigns()).find((x) => x.id === 'big');
  const ms = performance.now() - t0;
  ok('a 16 MB attachment is kept and comes back whole', kept && back?.message.attachment?.data.length === big.data.length);
  ok(`in under 3,000 ms × SLOW (${ms.toFixed(0)} ms)`, ms < 3000 * SLOW);
}
{
  // 60 campaigns: the oldest go, never a running one.
  const s = await freshStore();
  idb.store(DB, 'campaigns').clear();
  idb.store(DB, 'payloads').clear();
  await s.saveCampaign({ ...campaign(people(1, 1800), { id: 'old-running' }), state: 'running', updated: 1 });
  for (let i = 0; i < 64; i++) await s.saveCampaign({ ...campaign(people(1, 1801), { id: `bulk${i}` }), updated: 100 + i });
  const all = await (await freshStore()).loadCampaigns();
  ok('sixty-five saves keep sixty campaigns, and the oldest one, running, is kept', all.length === LIMITS.campaigns && all.some((c) => c.id === 'old-running'), all.length);
}

// ══ 2b. the screens' gate, with the real engine behind it ═══════════════════════════════════════════════════════
console.log('2b. launch, with the real engine');
const esbuild = require('esbuild');
const OUT = join(APP, '.test-build/wa-review');
await esbuild.build({
  entryPoints: [join(APP, 'src/WhatsAppRun.tsx')], bundle: true, format: 'esm', outdir: OUT, logLevel: 'error', jsx: 'automatic',
  external: ['react', 'react-dom'],
  plugins: [{
    name: 'no-tauri',
    setup(b) {
      b.onResolve({ filter: /^@tauri-apps\// }, (a) => ({ path: a.path, namespace: 'no-tauri' }));
      b.onLoad({ filter: /.*/, namespace: 'no-tauri' }, () => ({
        loader: 'js',
        contents: 'export const invoke = async () => { throw new Error("no Tauri in a test"); }; export const open = async () => null; export const save = async () => null;',
      }));
    },
  }],
});
const Run = await import(pathToFileURL(join(OUT, 'WhatsAppRun.js')).href);
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
{
  reset();
  mock.clock = Date.now;
  idb.mode.abortWrites = false;
  const account = { id: 'main', name: 'Shop', baseUrl: mock.url, instance: 'shop', key: 'test-key' };
  const base = (o = {}) => ({ ...campaign(people(2, 1900), { id: o.id ?? `L${++cid}` }), ...o });
  eq('no account', await Run.launch(base(), null, 0), 'no-account');
  eq('an account with no key', await Run.launch(base(), { ...account, key: '' }, 0), 'no-account');
  eq('another account\'s campaign', await Run.launch(base({ accountId: 'other' }), account, 0), 'other-account');
  eq('consent false', await Run.launch(base({ consent: false }), account, 0), 'no-consent');
  eq('consent "true"', await Run.launch(base({ consent: 'true' }), account, 0), 'no-consent');
  eq('a pace below the floor', await Run.launch(base({ pace: { ...clampPace({}), minDelaySec: 1 } }), account, 0), 'problems');
  eq('today\'s cap already used', await Run.launch(base(), account, 200), 'problems');
  idb.mode.abortWrites = true;
  eq('storage refuses the first save', await Run.launch(base(), account, 0), 'storage');
  idb.mode.abortWrites = false;
  ok('none of those reached the gateway', mock.log.length === 0, mock.log.map((r) => r.endpoint));

  // Two presses of Send at once: one run.
  const staged = base({ id: 'press-twice', staged: true });
  let atFirstRequest = null;
  mock.clock = () => {
    if (!atFirstRequest) {
      const row = idb.store(DB, 'campaigns')?.get('press-twice');
      atFirstRequest = row ? { staged: row.staged, consent: row.consent, state: row.state } : 'missing';
    }
    return Date.now();
  };
  const [a, b] = await Promise.all([Run.launch(staged, account, 0), Run.launch(staged, account, 0)]);
  ok('two presses of Send at once start one run; the other is told one is sending', [a, b].sort().join() === ',busy' || [a, b].sort().join() === 'busy,', [a, b]);
  for (let i = 0; i < 100 && mock.of('whatsappNumbers').length === 0; i++) await wait(10);
  ok('the campaign was saved — consent kept, `staged` cleared by the press — before the first request', atFirstRequest && atFirstRequest !== 'missing'
    && atFirstRequest.staged === false && atFirstRequest.consent === true, atFirstRequest);
  eq('while it runs, a third press is refused', await Run.launch(base(), account, 0), 'busy');
  Run.liveRun()?.runner.stop();
  for (let i = 0; i < 100 && !Run.liveRun()?.over; i++) await wait(10);
  ok('stopped in its first delay: nothing was sent', Run.liveRun()?.over && mock.delivered.length === 0 && Run.liveRun().campaign.state === 'stopped');
  mock.clock = Date.now;

  // The Run view of a halted campaign says why before it offers Continue.
  const halted = { ...base(), state: 'halted', halted: 'auth' };
  const html = renderToStaticMarkup(createElement(Run.RunView, { t: (s) => s, campaign: halted, run: null, interrupted: false, onContinue() {}, onReport() {}, onDone() {} }));
  ok('a halted campaign shows the reason next to Continue', html.includes('refused the key') && html.includes('Continue with the'));
}

// ══ 8. the words in SAFETY.md ═══════════════════════════════════════════════════════════════════════════════════
console.log('8. SAFETY.md');
{
  const safety = readFileSync(join(ROOT, 'SAFETY.md'), 'utf8');
  const para = safety.split('\n').find((l) => l.startsWith('**Messaging many people')) ?? '';
  ok('the paragraph exists', para.length > 0);
  ok('it says stop replies are read while the WhatsApp panel is open, as the code does', /stop word/.test(para) && /panel is open/.test(para) && /`addStopReplies`/.test(para));
  ok('every endpoint it names is one the sender calls', [...para.matchAll(/`(\/[a-zA-Z/]+)`/g)].every((m) => (src('whatsappsend.ts') + src('whatsappmedia.ts')).includes(m[1])));
  ok('it names the database the store opens', para.includes('`vylo-whatsapp-bulk`') && src('whatsappbulkstore.ts').includes("const DB = 'vylo-whatsapp-bulk'"));
}

await mock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
