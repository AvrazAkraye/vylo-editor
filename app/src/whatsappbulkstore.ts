import { dayOf } from './whatsapp';
import {
  LIMITS, MESSAGE_LANGS,
  type Attachment, type AttachmentKind, type Audience, type Campaign, type CampaignState, type ContactCard, type Draft,
  type Lang, type Outcome, type Recipient, type SourceFormat, type Standing,
} from './whatsappbulktypes';
import { clampPace, plainValue, wirePhone } from './whatsappcampaign';

/**
 * What the broadcast feature keeps between sessions: audiences, campaigns, the do-not-contact list, and how many
 * messages each account sent on each day. The webview's IndexedDB, database `vylo-whatsapp-bulk`, on this machine —
 * the arrangement `motionstore.ts` uses, for the same reasons: a campaign can carry a 16 MB attachment and 5,000
 * people, which `localStorage` (one small quota shared with every chat) cannot hold without starting to lose chats.
 *
 * ## Why a campaign is two records
 *
 * The runner saves the campaign before and after every message — that is how a crash can never send twice — so a save
 * happens twice every twenty seconds for hours. What changes between those saves is a few outcomes. What does not is
 * the list of people and the attachment, which can be most of the bytes. So a campaign is kept as a small record (the
 * campaign without them) in `campaigns`, and a `payloads` record (the people and the attachment's data) that is written
 * only when they are new — checked by identity, which costs nothing — and always in the same transaction as the small
 * one, so the two can never disagree about which campaign they belong to.
 *
 * ## Why everything read back is read again
 *
 * A record may come from an older or newer build, or from a hand-edited profile, so every one goes through a reader
 * that clamps (`readCampaign`, `readAudience`) before anything draws it or — more to the point — sends from it. The
 * readers lean towards not sending: a person whose standing is not one this build knows is `unknown`, never `queued`;
 * a campaign whose state is not known is `paused`. A record that is not one at all is left out.
 *
 * ## What is not kept
 *
 * No key and no gateway address: a campaign names its account by id, and the address and the key stay where the
 * person typed them (`whatsapp.ts`). Storage refusals resolve (`false`, `[]`, an empty set) rather than throw — except
 * where a guess would be unsafe: `doNotContact` throws when the list cannot be read, because a runner that cannot read
 * it must not send.
 */

const DB = 'vylo-whatsapp-bulk';
/**
 * Raised only by adding a store. A build that finds a newer version than its own cannot open the database at all
 * (the open fails, and every call here resolves as "storage refused") — which for this feature is the safe failure.
 */
const VERSION = 1;
const STORES: Readonly<Record<string, string>> = {
  audiences: 'id',
  campaigns: 'id',
  payloads: 'id',
  suppressed: 'phone',
  sent: 'key',
};

/** What the session already holds, cleared whenever the connection is (storage cleared, the profile replaced). */
const written = new Map<string, { recipients: unknown; data: string }>();
/** The do-not-contact list as storage holds it, once read; null until then (or when it cannot be). */
let suppressedNow: Set<string> | null = null;
/**
 * People put on the list this session, whether or not storage took them. Kept apart from `suppressedNow` so that a
 * list storage could not give us is never mistaken for the whole list: these are honoured, and still `doNotContact`
 * refuses to answer until the stored list has been read.
 */
const suppressedHere = new Set<string>();
/** Messages counted this session, by `account|day`, so a refused counter write still counts while the app is open. */
const countedNow = new Map<string, number>();

let opening: Promise<IDBDatabase | null> | null = null;

function forget() {
  opening = null;
  written.clear();
  suppressedNow = null;
}

/** The database, opened once and kept; a refusal is not kept, so the next call tries again. */
function db(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  const now: Promise<IDBDatabase | null> = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        for (const [name, keyPath] of Object.entries(STORES)) {
          if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
        }
      };
      req.onsuccess = () => {
        req.result.onclose = () => forget();
        // A newer build in another window wants to upgrade: step aside rather than block it.
        req.result.onversionchange = () => { req.result.close(); forget(); };
        resolve(req.result);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  opening = now;
  void now.then((d) => { if (!d && opening === now) opening = null; });
  return now;
}

function done<T>(req: IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/**
 * The writes the runner relies on — the campaign saved before a send, an opt-out, the day's count — ask for a commit
 * that is on disk before it is reported done. A browser may otherwise report a commit as complete while it is still
 * in a cache ("relaxed"), and a power cut then would leave a person `queued` who had been sent to. Where the option is
 * not known it is ignored, which is no worse than before.
 */
const DURABLE: IDBTransactionOptions = { durability: 'strict' };

/** A write, settled when its transaction commits: a quota error aborts the transaction after the request "succeeded". */
function committed(tx: IDBTransaction): Promise<boolean> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => resolve(false);
    tx.onerror = () => resolve(false);
  });
}

const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const obj = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const time = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 8.64e15 ? x : 0);
const word = (x: unknown): string | undefined => (typeof x === 'string' && /^[a-z0-9:-]{1,40}$/i.test(x) ? x : undefined);
const id = (x: unknown): string => (typeof x === 'string' && x.length > 0 && x.length <= 80 ? x : '');

// ── the readers ───────────────────────────────────────────────────────────

const STANDINGS: readonly Standing[] = [
  'queued', 'sending', 'sent', 'failed', 'unknown', 'skipped-not-on-whatsapp', 'skipped-opted-out', 'skipped-invalid', 'skipped-duplicate',
];
const STATES: readonly CampaignState[] = ['draft', 'ready', 'running', 'paused', 'done', 'stopped', 'halted'];
const SOURCES: readonly SourceFormat[] = ['text', 'txt', 'csv', 'tsv', 'vcf', 'xlsx', 'chats'];
const KINDS: readonly AttachmentKind[] = ['image', 'video', 'document', 'audio', 'contact'];

function readRecipient(x: unknown): Recipient | null {
  const o = obj(x);
  const phone = o ? wirePhone(o.phone) : '';
  if (!o || !phone) return null;
  const vars: Record<string, string> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj(o.vars) ?? {})) {
    if (n >= LIMITS.columns) break;
    const key = plainValue(k, 40);
    const value = plainValue(v);
    if (key && value && !Object.prototype.hasOwnProperty.call(vars, key)) { vars[key] = value; n++; }
  }
  const name = plainValue(o.name);
  return name ? { phone, name, vars } : { phone, vars };
}

function readRecipients(x: unknown): Recipient[] {
  const out: Recipient[] = [];
  for (const r of list(x)) {
    if (out.length >= LIMITS.recipients) break;
    const got = readRecipient(r);
    if (got) out.push(got);
  }
  return out;
}

function readContact(x: unknown): ContactCard | undefined {
  const o = obj(x);
  if (!o) return undefined;
  const organization = plainValue(o.organization);
  return { fullName: plainValue(o.fullName), phone: wirePhone(o.phone), ...(organization ? { organization } : {}) };
}

function readAttachment(x: unknown, data?: unknown): Attachment | undefined {
  const o = obj(x);
  if (!o || !KINDS.includes(o.kind as AttachmentKind)) return undefined;
  const kind = o.kind as AttachmentKind;
  const mime = typeof o.mime === 'string' && /^[\w.+-]{1,60}\/[\w.+-]{1,80}$/.test(o.mime) ? o.mime : 'application/octet-stream';
  const bytes = typeof o.bytes === 'number' && Number.isFinite(o.bytes) && o.bytes >= 0 ? Math.floor(o.bytes) : 0;
  const body = typeof data === 'string' ? data : typeof o.data === 'string' ? o.data : '';
  const contact = kind === 'contact' ? readContact(o.contact) : undefined;
  return { kind, name: plainValue(o.name, 200) || 'file', mime, bytes, data: kind === 'contact' ? '' : body, ...(contact ? { contact } : {}) };
}

function readDraft(x: unknown, data?: unknown): Draft {
  const o = obj(x) ?? {};
  const lang: Lang = MESSAGE_LANGS.includes(o.lang as Lang) ? (o.lang as Lang) : 'en';
  const text = typeof o.text === 'string' ? o.text.slice(0, 10_000) : '';
  const optOutText = typeof o.optOutText === 'string' && o.optOutText.trim() ? o.optOutText.slice(0, 300) : undefined;
  const attachment = readAttachment(o.attachment, data);
  return {
    text, lang,
    // The opt-out line is on unless the person turned it off: a record that does not say is a record that gets it.
    optOut: o.optOut !== false,
    ...(optOutText ? { optOutText } : {}),
    ...(attachment ? { attachment } : {}),
  };
}

/**
 * A stored outcome, repaired, under every number it names (none when it names none). The key is what a runner looks a
 * person up by and the `phone` field says the same; when a hand-edited record makes them differ, both numbers keep the
 * standing — the reader's rule is to lean towards not sending.
 */
function readOutcome(key: string, x: unknown): Outcome[] {
  const o = obj(x);
  if (!o) return [];
  const phones = [...new Set([wirePhone(key), wirePhone(o.phone)].filter(Boolean))];
  const at = time(o.at);
  const why = word(o.why);
  const attempts = typeof o.attempts === 'number' && Number.isFinite(o.attempts) ? Math.min(99, Math.max(0, Math.floor(o.attempts))) : 0;
  // A standing this build does not know may mean the message went: never `queued`.
  const standing: Standing = STANDINGS.includes(o.standing as Standing) ? (o.standing as Standing) : 'unknown';
  return phones.map((phone) => ({ phone, standing, ...(at ? { at } : {}), ...(why ? { why } : {}), attempts }));
}

/**
 * A stored campaign, repaired, or null when it is not one. `payload` is its `payloads` record (the people and the
 * attachment's data); a record without one keeps whatever people it carries itself (a hand-made record, an older shape).
 */
export function readCampaign(x: unknown, payload?: unknown): Campaign | null {
  const o = obj(x);
  const cid = o ? id(o.id) : '';
  if (!o || !cid) return null;
  const p = obj(payload);
  const recipients = readRecipients(p && Array.isArray(p.recipients) ? p.recipients : o.recipients);
  // The people's own outcomes always; the others (numbers no longer on the list) up to the ceiling — so junk can never
  // push out the record of someone who was sent to. Two records for one number: the one that says something happened
  // wins, so reading a record never puts anyone back in the queue.
  const mine = new Set(recipients.map((r) => r.phone));
  const outcomes: Record<string, Outcome> = {};
  let others = 0;
  for (const [k, v] of Object.entries(obj(o.outcomes) ?? {})) {
    for (const got of readOutcome(k, v)) {
      const was = Object.prototype.hasOwnProperty.call(outcomes, got.phone) ? outcomes[got.phone] : undefined;
      if (was) {
        if (was.standing === 'queued' && got.standing !== 'queued') outcomes[got.phone] = got;
        continue;
      }
      if (!mine.has(got.phone)) {
        if (others >= LIMITS.recipients) continue;
        others++;
      }
      outcomes[got.phone] = got;
    }
  }
  const started = time(o.started);
  const finished = time(o.finished);
  const halted = word(o.halted);
  const seed = typeof o.seed === 'number' && Number.isSafeInteger(o.seed) ? o.seed : undefined;
  const notes = list(o.notes).map(word).filter((w): w is string => !!w).slice(0, 10);
  const audienceId = id(o.audienceId);
  return {
    id: cid,
    name: plainValue(o.name) || 'Campaign',
    accountId: plainValue(o.accountId, 40),
    ...(audienceId ? { audienceId } : {}),
    recipients,
    message: readDraft(o.message, p ? p.data : undefined),
    pace: clampPace(obj(o.pace) ?? {}),
    consent: o.consent === true,
    state: STATES.includes(o.state as CampaignState) ? (o.state as CampaignState) : 'paused',
    outcomes,
    created: time(o.created),
    updated: time(o.updated),
    ...(started ? { started } : {}),
    ...(finished ? { finished } : {}),
    ...(halted ? { halted } : {}),
    ...(o.staged === true ? { staged: true } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

/** A stored audience, repaired, or null when it is not one. */
export function readAudience(x: unknown): Audience | null {
  const o = obj(x);
  const aid = o ? id(o.id) : '';
  if (!o || !aid) return null;
  const file = plainValue(o.file, 200);
  return {
    id: aid,
    name: plainValue(o.name, 80) || 'List',
    recipients: readRecipients(o.recipients),
    source: SOURCES.includes(o.source as SourceFormat) ? (o.source as SourceFormat) : 'text',
    ...(file ? { file } : {}),
    created: time(o.created),
    updated: time(o.updated),
  };
}

// ── campaigns ─────────────────────────────────────────────────────────────

const dataOf = (c: Campaign): string => {
  const d = c.message?.attachment?.data;
  return typeof d === 'string' ? d : '';
};

/** Every kept campaign, most recently changed first. */
export async function loadCampaigns(): Promise<Campaign[]> {
  const d = await db();
  if (!d) return [];
  try {
    const tx = d.transaction(['campaigns', 'payloads'], 'readonly');
    const [rows, pays] = await Promise.all([done(tx.objectStore('campaigns').getAll()), done(tx.objectStore('payloads').getAll())]);
    const byId = new Map<string, unknown>();
    for (const p of list(pays)) { const po = obj(p); if (po && id(po.id)) byId.set(po.id as string, p); }
    const out: Campaign[] = [];
    for (const row of list(rows)) {
      const rid = id(obj(row)?.id);
      const c = readCampaign(row, rid ? byId.get(rid) : undefined);
      if (!c) continue;
      out.push(c);
      // What was just read is what storage holds: a save of this copy need not write its payload again. Only when
      // nothing is remembered yet — a runner sending this campaign holds its own copy, and the screen refreshing its
      // list must not make that runner's next save rewrite the people and a 16 MB attachment.
      if (byId.has(c.id) && !written.has(c.id)) written.set(c.id, { recipients: c.recipients, data: dataOf(c) });
    }
    return out.sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/**
 * Keep a campaign, replacing the one with its id; `false` when storage did not take it. Beyond `LIMITS.campaigns`
 * the campaigns changed longest ago go — never a running one, never the one being saved.
 */
export async function saveCampaign(c: Campaign): Promise<boolean> {
  if (!c || typeof c !== 'object' || !id(c.id)) return false;
  // Both records are built now, before anything is awaited, so what is kept is the campaign as it was when this was called.
  const data = dataOf(c);
  const attachment = c.message?.attachment;
  const record = {
    ...c,
    // A copy of the map now: storage clones the record only after the awaits below, and an outcome changed in the
    // meantime must not be kept as if it had been saved here.
    outcomes: { ...c.outcomes },
    recipients: [],
    message: { ...c.message, ...(attachment ? { attachment: { ...attachment, data: '' } } : {}) },
  };
  const was = written.get(c.id);
  const fresh = !was || was.recipients !== c.recipients || was.data !== data;
  const payload = { id: c.id, recipients: c.recipients, data };
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction(['campaigns', 'payloads'], 'readwrite', DURABLE);
    const ok = committed(tx);
    const campaigns = tx.objectStore('campaigns');
    const payloads = tx.objectStore('payloads');
    campaigns.put(record);
    if (fresh) payloads.put(payload);
    const keys = campaigns.getAllKeys();
    keys.onsuccess = () => {
      if (list(keys.result).length <= LIMITS.campaigns) return;
      const all = campaigns.getAll();
      all.onsuccess = () => {
        const doomed = list(all.result)
          .map(obj)
          .filter((r): r is Record<string, unknown> => !!r && id(r.id) !== '' && r.id !== c.id && r.state !== 'running')
          .sort((a, b) => time(a.updated) - time(b.updated))
          .slice(0, list(keys.result).length - LIMITS.campaigns);
        for (const r of doomed) {
          campaigns.delete(r.id as string);
          payloads.delete(r.id as string);
          written.delete(r.id as string);
        }
      };
    };
    if (!(await ok)) {
      written.delete(c.id);
      return false;
    }
    if (fresh) written.set(c.id, { recipients: c.recipients, data });
    return true;
  } catch {
    written.delete(c.id);
    return false;
  }
}

export async function deleteCampaign(id: string): Promise<void> {
  written.delete(id);
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction(['campaigns', 'payloads'], 'readwrite');
    tx.objectStore('campaigns').delete(id);
    tx.objectStore('payloads').delete(id);
    await committed(tx);
  } catch {
    /* kept, as it was */
  }
}

// ── audiences ─────────────────────────────────────────────────────────────

/** Every kept list, most recently changed first. */
export async function loadAudiences(): Promise<Audience[]> {
  const d = await db();
  if (!d) return [];
  try {
    const rows = await done(d.transaction('audiences', 'readonly').objectStore('audiences').getAll());
    return list(rows).map(readAudience).filter((a): a is Audience => !!a).sort((a, b) => b.updated - a.updated);
  } catch {
    return [];
  }
}

/** Keep a list (read again first, so nothing unclamped is stored). Beyond `LIMITS.audiences` the oldest go. */
export async function saveAudience(a: Audience): Promise<boolean> {
  const clean = readAudience(a);
  if (!clean) return false;
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction('audiences', 'readwrite');
    const ok = committed(tx);
    const store = tx.objectStore('audiences');
    store.put(clean);
    const all = store.getAll();
    all.onsuccess = () => {
      const rows = list(all.result).map(obj).filter((r): r is Record<string, unknown> => !!r && id(r.id) !== '');
      if (rows.length <= LIMITS.audiences) return;
      const doomed = rows.filter((r) => r.id !== clean.id).sort((x, y) => time(x.updated) - time(y.updated)).slice(0, rows.length - LIMITS.audiences);
      for (const r of doomed) store.delete(r.id as string);
    };
    return await ok;
  } catch {
    return false;
  }
}

export async function deleteAudience(id: string): Promise<void> {
  const d = await db();
  if (!d) return;
  try {
    const tx = d.transaction('audiences', 'readwrite');
    tx.objectStore('audiences').delete(id);
    await committed(tx);
  } catch {
    /* kept, as it was */
  }
}

// ── the do-not-contact list ───────────────────────────────────────────────

/** The list as storage holds it, or null when it cannot be read. */
async function readSuppressed(): Promise<Set<string> | null> {
  if (suppressedNow) return suppressedNow;
  const d = await db();
  if (!d) return null;
  try {
    const keys = await done(d.transaction('suppressed', 'readonly').objectStore('suppressed').getAllKeys());
    if (!Array.isArray(keys)) return null;
    const s = new Set<string>();
    for (const k of keys) { const p = wirePhone(k); if (p) s.add(p); }
    suppressedNow = s;
    return s;
  } catch {
    return null;
  }
}

/** The do-not-contact list, as phones (a copy). What storage holds, if it can be read, and this session's additions — for drawing; a runner uses `doNotContact`. */
export async function loadSuppressed(): Promise<Set<string>> {
  return new Set([...((await readSuppressed()) ?? []), ...suppressedHere]);
}

/** The do-not-contact list for a run. Throws when storage cannot give it: a runner that cannot read the list must not send. */
export async function doNotContact(): Promise<ReadonlySet<string>> {
  const s = await readSuppressed();
  if (!s) throw new Error('The do-not-contact list could not be read.');
  return new Set([...s, ...suppressedHere]);
}

/**
 * Put people on the do-not-contact list. `false` when storage refused; the session honours every addition, kept or not.
 *
 * There is no ceiling. `LIMITS.suppressed` once made the list stop growing at 20,000 — which kept everyone already on
 * it, but left the next person who asked to stop on it only until the app was closed, and then wrote to them again.
 * An opt-out is a few dozen bytes; forgetting one is the one thing this list exists to prevent.
 */
export async function addSuppressed(phones: readonly string[]): Promise<boolean> {
  const want = [...new Set(phones.map(wirePhone).filter(Boolean))];
  for (const p of want) suppressedHere.add(p);
  if (!want.length) return true;
  const have = await readSuppressed();
  if (!have) return false;
  const fresh = want.filter((p) => !have.has(p));
  if (!fresh.length) return true;
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction('suppressed', 'readwrite', DURABLE);
    const ok = committed(tx);
    const at = Date.now();
    for (const p of fresh) tx.objectStore('suppressed').put({ phone: p, at });
    if (!(await ok)) return false;
    for (const p of fresh) have.add(p);
    return true;
  } catch {
    return false;
  }
}

/** Take someone off the do-not-contact list (the person's own decision, from the screen that lists it). */
export async function removeSuppressed(phone: string): Promise<boolean> {
  const p = wirePhone(phone);
  if (!p) return false;
  suppressedHere.delete(p);
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction('suppressed', 'readwrite');
    tx.objectStore('suppressed').delete(p);
    const ok = await committed(tx);
    if (ok) suppressedNow?.delete(p);
    return ok;
  } catch {
    return false;
  }
}

// ── messages per day ──────────────────────────────────────────────────────

/** How long a day's count is kept: long enough to look back on a week, short enough that the store never grows. */
const KEEP_DAYS = 14;
const countKey = (accountId: string, at: number): string => `${accountId}|${dayOf(at)}`;

/**
 * Messages this account sent on the calendar day of `now` (local time), across every campaign and every restart.
 * The larger of what storage holds and what this session counted, so a refused write still counts while the app is open.
 */
export async function sentToday(accountId: string, now: number = Date.now()): Promise<number> {
  const key = countKey(accountId, now);
  const mem = countedNow.get(key) ?? 0;
  const d = await db();
  if (!d) return mem;
  try {
    const rec = obj(await done(d.transaction('sent', 'readonly').objectStore('sent').get(key)));
    const n = rec && typeof rec.n === 'number' && Number.isFinite(rec.n) ? Math.min(1_000_000, Math.max(0, Math.floor(rec.n))) : 0;
    return Math.max(n, mem);
  } catch {
    return mem;
  }
}

/**
 * Count `n` messages for this account on the day of `at`. Called by the runner just before each request that may
 * deliver, so a crash after it leaves the count one high, never one low. Days older than two weeks are dropped.
 */
export async function countSent(accountId: string, at: number = Date.now(), n = 1): Promise<boolean> {
  const key = countKey(accountId, at);
  countedNow.set(key, (countedNow.get(key) ?? 0) + n);
  const d = await db();
  if (!d) return false;
  try {
    const tx = d.transaction('sent', 'readwrite', DURABLE);
    const ok = committed(tx);
    const store = tx.objectStore('sent');
    const get = store.get(key);
    get.onsuccess = () => {
      const rec = obj(get.result);
      const was = rec && typeof rec.n === 'number' && Number.isFinite(rec.n) ? Math.max(0, Math.floor(rec.n)) : 0;
      store.put({ key, accountId, day: dayOf(at), n: was + n });
    };
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      const oldest = dayOf(at - KEEP_DAYS * 86_400_000);
      for (const k of list(keys.result)) {
        const day = typeof k === 'string' ? k.slice(k.lastIndexOf('|') + 1) : '';
        if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest) store.delete(k as IDBValidKey);
      }
    };
    return await ok;
  } catch {
    return false;
  }
}
