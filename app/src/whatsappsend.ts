import { dayOf, phoneOf, ready, type Account, type Conn } from './whatsapp';
import { countSent, doNotContact, saveCampaign, sentToday } from './whatsappbulkstore';
import type { Attachment, Campaign, HaltWhy, Outcome, Recipient, RunEvent, Standing } from './whatsappbulktypes';
import { LIMITS } from './whatsappbulktypes';
import { clampPace, plainValue, renderMessage, validateCampaign, wirePhone } from './whatsappcampaign';
import { sendBody, sendMediaPath, sendMime, type SendAs } from './whatsappmedia';
import { callerFor } from './whatsappwire';

/**
 * The runner: one campaign, one message at a time, at a pace that protects the number, never twice to anyone.
 *
 * Every effect is injected (`RunDeps`): the transport, the clock, the timer, the random numbers, the store. `realDeps`
 * builds the real ones, and its transport is `whatsappwire.ts` `callerFor(conn)` — the feature's only network path, so
 * a key still only ever travels to the address it was typed beside. Everything else here is decisions, and
 * `test/wa-send.test.mjs` drives them against a fake clock and a mock Evolution server, crashing it at every step.
 *
 * ## The order of things for one person, and why
 *
 *   1. the gate: a pause or a stop takes effect here, before anything else happens for the next person
 *   2. the number check, fifty people at a time and only as the run reaches them — checking five thousand numbers in
 *      one burst is itself the kind of activity WhatsApp notices; anyone not on WhatsApp is skipped
 *   3. the day's cap, counted across every campaign on the account; at the cap the run waits for local midnight
 *   4. the connection, looked at again at every batch and after any failure
 *   5. the batch pause, then the delay — the first message waits too, so a campaign never opens with a burst
 *   6. the do-not-contact list, read again: a "stop" may have arrived during the wait
 *   7. **save the person as `sending`**, and only then the request. After the answer, save again.
 *
 * Step 7 is the whole of "at most once". Whatever happens after the first save — a crash, a quit, a timeout, a reply
 * that never comes — storage says `sending`, `recover` turns that into `unknown`, and nothing ever sends to an
 * `unknown` by itself. The person sees it and decides (`requeue`). A save that is refused before a send halts the run
 * (`storage`): a run that cannot record what it is about to do must not do it.
 *
 * ## What an answer means
 *
 * The rule that sorts every answer is "refused, or may have gone". A 4xx is a refusal: the gateway turned the request
 * away and nobody received anything — 400 marks the person `failed`, 401/403/404 halt with the person still `queued`
 * (fix the key, resume, and they are sent), 429 waits and tries the same person again. Everything else — a 5xx, a
 * network error, a timeout, a reply that cannot be read, a success with no message id in it — means the message *may*
 * have gone, and the person is `unknown`. That costs a person their message now and then rather than ever sending
 * someone the same message twice, which is the trade this feature makes everywhere.
 *
 * ## Halting
 *
 * Repeated failures, a 401/403, a missing instance, three 429s in a row, a disconnected number, a reply that says the
 * account is banned or logged out, or a refused save: the campaign is `halted` with the reason in `halted` (`HaltWhy`),
 * saved, announced — and `start()` resolves. A halt is an answer, not an exception.
 */
export interface RunDeps {
  /** One call to the account's instance (`whatsappwire.ts` `callerFor`). */
  call: (path: string, body?: unknown) => Promise<unknown>;
  instance: string;
  now: () => number;
  /** Wait; resolves early when `signal` aborts (a pause, a resume or a stop). A rejection is taken as an early wake. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  rnd: () => number;
  /**
   * Persist the campaign; awaited before each send. `false` or a throw is a refusal, and a refused save before a
   * send halts the run (`storage`) — `whatsappbulkstore.ts` `saveCampaign` can be passed as it is.
   */
  save: (c: Campaign) => Promise<void | boolean>;
  /** Messages this account has sent today, across campaigns. With `counted`, it includes this run's; without, the runner adds its own. */
  sentToday: () => Promise<number>;
  // wa:engine — optional, so a caller built against the first contract still compiles; `realDeps` fills every one.
  /** The do-not-contact list, read before the run and again before each send. Throwing halts the run (`storage`). */
  suppressed?: () => Promise<ReadonlySet<string>>;
  /** Called just before each request that may deliver a message, to count it for the day (`whatsappbulkstore.ts` `countSent`). */
  counted?: (at: number) => Promise<unknown>;
  /** How long a request may take before it is given up on (and its person is `unknown`). Default 90 s; an attachment adds a second per 64 KB. */
  timeoutMs?: number;
  /**
   * The timer for that limit — a real one, kept apart from `sleep` so a test can run the pace on a fake clock while a
   * real request still has real time to answer. Without it, a request is waited for as long as it takes.
   */
  deadline?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** The running campaigns and accounts of this process. A test that simulates a restart passes a new set: a new process has new memory. */
  locks?: Set<string>;
}

export interface Runner {
  /** Runs until the campaign is done, stopped or halted; resolves with it. Rejects only when it cannot start at all. */
  start(): Promise<Campaign>;
  pause(): void;
  resume(): void;
  stop(): void;
  on(fn: (e: RunEvent) => void): () => void;
  // wa:engine
  /** The campaign as the runner has it now (a copy). */
  current?(): Campaign;
}

/** People checked against WhatsApp per request. */
const NUMBER_BATCH = 50;
/** 400s in a row that halt the run (`repeated-failures`): one bad number is a bad number, five is a bad campaign. */
const INVALID_STREAK = 5;
/** 429s in a row that halt the run (`rate-limited`). */
const RATE_STREAK = 3;
/** The first wait after a 429; it doubles each time. */
const BACKOFF_MS = 30_000;
const TIMEOUT_MS = 90_000;
/** Request time an attachment adds: a second per this many bytes, so 16 MB on a slow uplink is not cut off. */
const BYTES_PER_SECOND = 64 * 1024;

/** This process's running campaigns and accounts. Two runners for one campaign — or two campaigns on one number, which would halve the pace — cannot both start. */
const LOCKS = new Set<string>();

/** Whether a runner of this process is sending this campaign — the screen's test before it calls `recover` on one stored as running. */
export const isRunning = (campaignId: string): boolean => LOCKS.has(`campaign:${campaignId}`);

// ── reading answers ───────────────────────────────────────────────────────

type Verdict =
  /** It went: the gateway answered with the message's id. */
  | { k: 'sent' }
  /** It did not go: the gateway turned the request away. */
  | { k: 'refused'; status: number }
  /** It may have gone. */
  | { k: 'maybe'; why: string }
  /** The reply says the number itself can no longer send: banned, logged out. */
  | { k: 'account' };

type Answer = { ok: true; body: unknown } | { ok: false; error: unknown };

/** The status of a refusal from `whatsappwire.ts` (`WireError`), read by shape: the class may come from another bundle. */
function statusOf(e: unknown): number | null {
  if (!e || typeof e !== 'object' || (e as { name?: unknown }).name !== 'WireError') return null;
  const s = (e as { status?: unknown }).status;
  return typeof s === 'number' && Number.isInteger(s) && s >= 100 && s <= 599 ? s : null;
}

const hasId = (x: unknown): boolean => {
  const key = x && typeof x === 'object' ? (x as { key?: unknown }).key : null;
  const kid = key && typeof key === 'object' ? (key as { id?: unknown }).id : null;
  return typeof kid === 'string' && kid.length > 0;
};

/** Evolution answers a send with the message it made, `key.id` and all; a few builds wrap it one level down. */
function receiptOf(body: unknown): boolean {
  if (hasId(body)) return true;
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  return !!b && ['data', 'message', 'response'].some((k) => hasId(b[k]));
}

const ACCOUNT_WORDS = /\b(banned|blocked|logged ?out|logout|not connected|connection closed|disconnected)\b/i;

/** Whether a reply's own status words — never the echoed message — say the number can no longer send. */
function accountGone(body: unknown): boolean {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (!b) return false;
  const r = b.response && typeof b.response === 'object' ? (b.response as Record<string, unknown>) : {};
  const words = [b.status, b.error, b.state, typeof b.message === 'string' ? b.message : '', r.message];
  return words.flat().some((w) => typeof w === 'string' && ACCOUNT_WORDS.test(w));
}

function verdictOf(a: Answer): Verdict {
  if (a.ok) {
    if (receiptOf(a.body)) return { k: 'sent' };
    return accountGone(a.body) ? { k: 'account' } : { k: 'maybe', why: 'no-receipt' };
  }
  if (a.error === TIMED_OUT) return { k: 'maybe', why: 'timeout' };
  const s = statusOf(a.error);
  if (s === null) return { k: 'maybe', why: a.error instanceof SyntaxError ? 'unreadable' : 'network' };
  // 408 is the gateway's proxy giving up on it, which says nothing about whether it went.
  if (s === 408 || s >= 500) return { k: 'maybe', why: `http-${s}` };
  return { k: 'refused', status: s };
}

const TIMED_OUT = Symbol('timed out');

/**
 * One request, given up on after `ms`. `apiCall` cannot be cancelled, so a request given up on may still arrive —
 * which is exactly why its person becomes `unknown` and not `failed`. Its late answer, or late failure, is swallowed.
 */
async function timed(
  call: RunDeps['call'], deadline: RunDeps['deadline'], path: string, body: unknown, ms: number,
): Promise<Answer> {
  const stop = new AbortController();
  try {
    const p = Promise.resolve().then(() => call(path, body));
    p.catch(() => undefined);
    const raced = deadline
      ? await Promise.race([p, deadline(ms, stop.signal).then(() => TIMED_OUT, () => TIMED_OUT)])
      : await p;
    return raced === TIMED_OUT ? { ok: false, error: TIMED_OUT } : { ok: true, body: raced };
  } catch (error) {
    return { ok: false, error };
  } finally {
    stop.abort();
  }
}

// ── what one person is sent ───────────────────────────────────────────────

interface Part { path: string; body: unknown; ms: number }

/** About how long "typing…" shows before a message: 0.8 s, and longer for a longer text, up to 2.5 s. */
const typingMs = (text: string): number => Math.round(Math.min(2500, 800 + text.length * 12));

/**
 * The requests that make one person's message. One, nearly always: text alone, or a photo, video or file with the
 * text as its caption. A contact card or an audio file cannot carry a caption on WhatsApp, so the words go first as a
 * message of their own. The person stands as one: `sent` only when every part went, and never sent to again either way.
 */
function partsFor(instance: string, phone: string, text: string, att: Attachment | undefined, typing: boolean, base: number): Part[] {
  const inst = encodeURIComponent(instance);
  const words = (): Part[] => (text ? [{
    path: `/message/sendText/${inst}`,
    body: { number: phone, text, ...(typing ? { delay: typingMs(text) } : {}) },
    ms: base,
  }] : []);
  if (!att) return words();
  if (att.kind === 'contact') {
    const k = att.contact;
    const card = {
      fullName: plainValue(k?.fullName), wuid: wirePhone(k?.phone), phoneNumber: `+${wirePhone(k?.phone)}`,
      ...(k?.organization ? { organization: plainValue(k.organization) } : {}),
    };
    return [...words(), { path: `/message/sendContact/${inst}`, body: { number: phone, contact: [card] }, ms: base }];
  }
  const data = typeof att.data === 'string' ? att.data : '';
  const name = plainValue(att.name, 200) || 'file';
  const mime = sendMime(name, att.mime);
  const ms = base + Math.ceil((data.length * 0.75) / BYTES_PER_SECOND) * 1000;
  if (att.kind === 'audio') {
    return [...words(), { path: sendMediaPath(instance), body: { number: phone, mediatype: 'audio', mimetype: mime, media: data, fileName: name }, ms }];
  }
  const as: SendAs = att.kind === 'image' || att.kind === 'video' ? att.kind : 'document';
  return [{ path: sendMediaPath(instance), body: sendBody(phone, { data, name, mime, as }, text), ms }];
}

/** The state the instance reports (`{ instance: { state } }` on Evolution v2), lower case, or ''. */
function stateOf(body: unknown): string {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const inner = b.instance && typeof b.instance === 'object' ? (b.instance as Record<string, unknown>) : b;
  const s = inner.state ?? b.state;
  return typeof s === 'string' ? s.toLowerCase() : '';
}

/** Local midnight after `now`: the day's cap is a calendar day where the person is. */
function nextMidnight(now: number): number {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

const addNote = (notes: readonly string[] | undefined, w: string): string[] => (notes?.includes(w) ? [...notes] : [...(notes ?? []), w]);

// ── the runner ────────────────────────────────────────────────────────────

export function runCampaign(input: Campaign, deps: RunDeps): Runner {
  // The runner's own copy. Outcomes are replaced, never edited, so a snapshot handed out stays as it was.
  const c: Campaign = { ...input, outcomes: { ...(input.outcomes ?? {}) }, ...(input.notes ? { notes: [...input.notes] } : {}) };
  const listeners = new Set<(e: RunEvent) => void>();
  const locks = deps.locks ?? LOCKS;
  const keys = [`campaign:${c.id}`, `account:${c.accountId}`];
  let want: 'run' | 'pause' | 'stop' = 'run';
  /** Aborted by pause, resume and stop, so a sleep never outlasts a decision. */
  let wake = new AbortController();
  let release: (() => void) | null = null;
  let active: Promise<Campaign> | null = null;
  /**
   * Set before `run()` is called, not when its promise is assigned: `run()` reaches its first await synchronously, and
   * a stop that arrives there must find the runner running, not take the "not started" path and be overwritten.
   */
  let running = false;

  const snapshot = (): Campaign => ({ ...c, outcomes: { ...c.outcomes }, ...(c.notes ? { notes: [...c.notes] } : {}) });
  const emit = (e: RunEvent) => {
    for (const fn of [...listeners]) {
      try { fn(e); } catch { /* one listener's failure is not the run's */ }
    }
  };
  const persist = async (): Promise<boolean> => {
    try { return (await deps.save(c)) !== false; } catch { return false; }
  };
  /** Record a change: stamp it, save it, tell whoever is drawing. `false` when storage refused it. */
  const commit = async (): Promise<boolean> => {
    c.updated = deps.now();
    const ok = await persist();
    if (listeners.size) emit({ kind: 'state', campaign: snapshot() });
    return ok;
  };
  const set = (phone: string, o: Partial<Outcome> & { standing: Standing }) => {
    const prev = c.outcomes[phone] ?? { phone, standing: 'queued', attempts: 0 };
    c.outcomes[phone] = { ...prev, why: undefined, ...o, phone };
  };
  const note = (w: string) => { c.notes = addNote(c.notes, w); };
  const poke = () => { wake.abort(); wake = new AbortController(); };
  const wanted = () => want;

  async function run(): Promise<Campaign> {
    const pace = clampPace(c.pace);
    const seed = typeof c.seed === 'number' && Number.isFinite(c.seed) ? c.seed : 0;
    const base = deps.timeoutMs ?? TIMEOUT_MS;
    const inst = encodeURIComponent(deps.instance);
    const call = (path: string, body: unknown, ms: number) => timed(deps.call, deps.deadline, path, body, ms);

    let fails = 0;       // 5xx, network, timeouts, unreadable: in a row
    let invalid = 0;     // 400s in a row
    let rate = 0;        // 429s in a row
    let sinceBatch = 0;  // requests since the last batch pause
    let recheck = false; // look at the connection before the next send
    let checking = true; // the gateway can tell us who is on WhatsApp
    const checked = new Set<string>();
    let day = '';
    let mine = 0;        // requests this run counted today

    const halt = async (why: HaltWhy): Promise<Campaign> => {
      c.state = 'halted';
      c.halted = why;
      await commit();
      return snapshot();
    };
    const end = async (state: 'done' | 'stopped'): Promise<Campaign> => {
      c.state = state;
      c.finished = deps.now();
      await commit();
      return snapshot();
    };

    /** Wait, unless a decision comes first. Announced so the screen can say "next message in 18 s". */
    const nap = async (ms: number, why: 'delay' | 'batch' | 'daily-cap') => {
      if (!(ms > 0) || want !== 'run') return;
      emit({ kind: 'wait', until: deps.now() + ms, why });
      try { await deps.sleep(ms, wake.signal); } catch { /* an abortable sleep may reject when woken */ }
    };

    /** Where a pause waits and a stop is noticed. `false`: stop. */
    const gate = async (): Promise<boolean> => {
      while (want === 'pause') {
        c.state = 'paused';
        await commit();
        await new Promise<void>((res) => { release = res; if (want !== 'pause') res(); });
        release = null;
        // Read through a function: the compiler cannot see that `resume()` changed it while this awaited.
        if (wanted() === 'run') { c.state = 'running'; await commit(); }
      }
      return want !== 'stop';
    };

    const delayMs = (): number => {
      const r = deps.rnd();
      const x = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5;
      return Math.round((pace.minDelaySec + x * (pace.maxDelaySec - pace.minDelaySec)) * 1000);
    };

    /** A 429: wait longer each time, and stop asking after three in a row. */
    const slowDown = async (): Promise<HaltWhy | null> => {
      rate++;
      note('rate-limited');
      if (rate >= RATE_STREAK) return 'rate-limited';
      await nap(BACKOFF_MS * 2 ** (rate - 1), 'delay');
      return null;
    };

    const connection = async (): Promise<'ok' | HaltWhy> => {
      for (;;) {
        const a = await call(`/instance/connectionState/${inst}`, undefined, base);
        if (a.ok) return stateOf(a.body) === 'open' ? 'ok' : accountGone(a.body) ? 'account' : 'not-connected';
        const s = statusOf(a.error);
        if (s === 401 || s === 403) return 'auth';
        if (s === 404) return 'instance';
        if (s === 429) { const h = await slowDown(); if (h) return h; continue; }
        return 'not-connected';
      }
    };

    const today = async (): Promise<number> => {
      const d = dayOf(deps.now());
      if (d !== day) { day = d; mine = 0; }
      const n = Number(await deps.sentToday());
      if (!Number.isFinite(n)) throw new Error('The day\'s count could not be read.');
      return deps.counted ? Math.max(n, mine) : n + mine;
    };

    const blocked = async (): Promise<ReadonlySet<string>> => (deps.suppressed ? deps.suppressed() : new Set<string>());

    /** Check the next people (from `i`) against WhatsApp, fifty at a time. */
    const check = async (order: readonly string[], i: number): Promise<'ok' | HaltWhy> => {
      const batch: string[] = [];
      for (let j = i; j < order.length && batch.length < NUMBER_BATCH; j++) {
        const p = order[j];
        if (!checked.has(p) && c.outcomes[p]?.standing === 'queued') batch.push(p);
      }
      if (!batch.length) return 'ok';
      for (;;) {
        const a = await call(`/chat/whatsappNumbers/${inst}`, { numbers: batch }, base);
        const s = a.ok ? null : statusOf(a.error);
        const unreadable = !a.ok && a.error instanceof SyntaxError;
        if (a.ok && Array.isArray(a.body)) {
          for (const p of batch) checked.add(p);
          rate = 0;
          const absent = new Set<string>();
          for (const row of a.body) {
            const r = row && typeof row === 'object' ? (row as Record<string, unknown>) : null;
            if (!r || r.exists !== false) continue;
            const p = wirePhone(r.number) || phoneOf(typeof r.jid === 'string' ? r.jid : '');
            if (p) absent.add(p);
          }
          let any = false;
          for (const p of batch) if (absent.has(p)) { set(p, { standing: 'skipped-not-on-whatsapp', why: 'not-on-whatsapp', at: deps.now() }); any = true; }
          if (any && !(await commit())) return 'storage';
          return 'ok';
        }
        // An answer this build cannot read, or a gateway without the endpoint: carry on without the check, and say so.
        // Nobody is skipped on a guess — a send to someone who is not on WhatsApp is refused by the gateway itself.
        if (a.ok || unreadable || (s !== null && s >= 400 && s < 500 && s !== 401 && s !== 403 && s !== 408 && s !== 429)) {
          checking = false;
          note('number-check-unavailable');
          return 'ok';
        }
        if (s === 401 || s === 403) return 'auth';
        if (s === 429) { const h = await slowDown(); if (h) return h; continue; }
        // The gateway could not answer. Nothing was sent; it still counts towards the breaker.
        fails++;
        if (fails >= pace.stopAfterFailures) return 'repeated-failures';
        const w = await connection();
        if (w !== 'ok') return w;
        await nap(delayMs(), 'delay');
        if (want !== 'run') return 'ok';
      }
    };

    // ── the plan: who, in what order, and who is already done ──
    const order: string[] = [];
    const who = new Map<string, Recipient>();
    for (const r of Array.isArray(c.recipients) ? c.recipients : []) {
      const p = wirePhone(r?.phone);
      if (!p) {
        const raw = plainValue(r?.phone, 40) || '?';
        if (raw !== '__proto__' && !Object.prototype.hasOwnProperty.call(c.outcomes, raw)) {
          c.outcomes[raw] = { phone: raw, standing: 'skipped-invalid', why: 'invalid-number', attempts: 0 };
        }
        continue;
      }
      // A number listed twice is one person, sent to once.
      if (who.has(p)) continue;
      who.set(p, r);
      order.push(p);
      const prev = c.outcomes[p];
      if (!prev) c.outcomes[p] = { phone: p, standing: 'queued', attempts: 0 };
      // Stored as `sending` and nobody called `recover`: it may have gone, so it is treated as `recover` would.
      else if (prev.standing === 'sending') c.outcomes[p] = { ...prev, standing: 'unknown', why: 'interrupted' };
    }
    try {
      const no = await blocked();
      for (const p of order) if (c.outcomes[p].standing === 'queued' && no.has(p)) set(p, { standing: 'skipped-opted-out', why: 'opted-out', at: deps.now() });
    } catch {
      return halt('storage');
    }
    c.state = 'running';
    c.halted = undefined;
    c.started = c.started ?? deps.now();
    if (!(await commit())) return halt('storage');
    if (!(await gate())) return end('stopped');

    // ── before any message: is the number connected? ──
    const pre = await connection();
    if (pre !== 'ok') return halt(pre);

    for (let i = 0; i < order.length;) {
      const p = order[i];
      if (c.outcomes[p]?.standing !== 'queued') { i++; continue; }
      if (!(await gate())) return end('stopped');

      if (checking && !checked.has(p)) {
        const w = await check(order, i);
        if (w !== 'ok') return halt(w);
        continue; // this person may now be skipped; the loop looks again
      }

      let count: number;
      try { count = await today(); } catch { return halt('storage'); }
      if (count >= pace.dailyCap) {
        const now = deps.now();
        await nap(nextMidnight(now) - now, 'daily-cap');
        sinceBatch = 0; // a night is a pause
        continue;
      }

      if (recheck) {
        const w = await connection();
        if (w !== 'ok') return halt(w);
        recheck = false;
      }

      if (sinceBatch >= pace.batchSize) {
        await nap(pace.batchPauseSec * 1000, 'batch');
        sinceBatch = 0;
        recheck = true;
        continue;
      }

      await nap(delayMs(), 'delay');
      // A pause or a stop during the wait: the gate decides, and this person's waits start again after a resume.
      if (want !== 'run') continue;

      try {
        if ((await blocked()).has(p)) {
          set(p, { standing: 'skipped-opted-out', why: 'opted-out', at: deps.now() });
          if (!(await commit())) return halt('storage');
          i++;
          continue;
        }
      } catch {
        return halt('storage');
      }

      // ── the send ──
      const r = who.get(p) as Recipient;
      const parts = partsFor(deps.instance, p, renderMessage(c.message, r, seed), c.message?.attachment, pace.typing, base);
      const prev = c.outcomes[p];
      set(p, { standing: 'sending', at: deps.now(), attempts: prev.attempts + 1 });
      if (!(await commit())) {
        c.outcomes[p] = prev;
        return halt('storage');
      }
      // A pause or a stop that came in while that was being saved: nothing has gone yet, so put the person back.
      if (want !== 'run') {
        c.outcomes[p] = prev;
        if (!(await commit())) return halt('storage');
        continue;
      }

      let verdict: Verdict = { k: 'sent' };
      let partial = false;
      for (let k = 0; k < parts.length; k++) {
        const at = deps.now();
        if (dayOf(at) !== day) { day = dayOf(at); mine = 0; }
        mine++;
        sinceBatch++;
        try { await deps.counted?.(at); } catch { /* the store keeps the session's count itself */ }
        verdict = verdictOf(await call(parts[k].path, parts[k].body, parts[k].ms));
        if (verdict.k !== 'sent') { partial = k > 0; break; }
      }

      const at = deps.now();
      const tried = { at, attempts: prev.attempts + 1 };
      let stopWith: HaltWhy | null = null;
      let again = false;
      if (verdict.k === 'sent') {
        set(p, { standing: 'sent', ...tried });
        fails = 0; invalid = 0; rate = 0;
      } else if (verdict.k === 'maybe') {
        set(p, { standing: 'unknown', why: partial ? `partial-${verdict.why}` : verdict.why, ...tried });
        fails++;
        recheck = true;
        if (fails >= pace.stopAfterFailures) stopWith = 'repeated-failures';
      } else if (verdict.k === 'account') {
        set(p, { standing: 'unknown', why: 'account', ...tried });
        stopWith = 'account';
      } else {
        const s = verdict.status;
        const why = s === 400 ? 'invalid' : `http-${s}`;
        // After a first part went, the person has been written to: whatever the rest did, they are never sent to again.
        if (partial) set(p, { standing: 'failed', why: `partial-${why}`, ...tried });
        if (s === 401 || s === 403 || s === 404 || s === 405) {
          if (!partial) c.outcomes[p] = { ...prev, attempts: prev.attempts + 1, at };
          stopWith = s === 401 || s === 403 ? 'auth' : 'instance';
        } else if (s === 429) {
          if (!partial) { c.outcomes[p] = { ...prev, attempts: prev.attempts + 1, at }; again = true; }
        } else {
          if (!partial) set(p, { standing: 'failed', why, ...tried });
          invalid++;
          recheck = true;
          if (invalid >= INVALID_STREAK) stopWith = 'repeated-failures';
        }
      }
      if (!(await commit())) return halt('storage');
      if (stopWith) return halt(stopWith);
      if (verdict.k === 'refused' && verdict.status === 429) {
        const h = await slowDown();
        if (h) return halt(h);
        if (again) continue; // the same person: nothing reached them
      }
      i++;
    }
    return end('done');
  }

  return {
    start(): Promise<Campaign> {
      if (running || active) return Promise.reject(new Error('This campaign is already being sent.'));
      if (c.state === 'done' || c.state === 'stopped') return Promise.resolve(snapshot());
      if (keys.some((k) => locks.has(k))) return Promise.reject(new Error('A campaign is already being sent from this account.'));
      // The assistant can prepare a campaign but never send one: the person's press on Send clears `staged`.
      if (c.staged) return Promise.reject(new Error('This campaign was prepared by the assistant and has not been confirmed by the person.'));
      const problems = validateCampaign(c).filter((x) => x.code !== 'over-daily-cap' && x.code !== 'already-running');
      if (problems.length) return Promise.reject(new Error(`This campaign cannot start: ${problems.map((x) => x.code).join(', ')}.`));
      for (const k of keys) locks.add(k);
      want = 'run';
      running = true;
      active = run()
        .catch(async () => {
          // A fault in the runner itself. Whoever was mid-send may have been sent to.
          for (const [p, o] of Object.entries(c.outcomes)) if (o.standing === 'sending') c.outcomes[p] = { ...o, standing: 'unknown', why: 'interrupted' };
          c.state = 'halted';
          c.halted = 'storage';
          await commit().catch(() => false);
          return snapshot();
        })
        .finally(() => {
          for (const k of keys) locks.delete(k);
          active = null;
          running = false;
        });
      return active;
    },
    pause() {
      if (running && want === 'run') { want = 'pause'; poke(); }
    },
    resume() {
      if (want === 'pause') { want = 'run'; poke(); release?.(); }
    },
    stop() {
      if (running) { want = 'stop'; poke(); release?.(); return; }
      // Not running: stopping ends the campaign where it stands.
      if (c.state === 'done' || c.state === 'stopped') return;
      c.state = 'stopped';
      c.finished = deps.now();
      void commit();
    },
    on(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    current: snapshot,
  };
}

// ── the real thing ────────────────────────────────────────────────────────

/** A real wait that ends early when `signal` aborts. The only timer in the feature. */
function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(t); signal?.removeEventListener('abort', finish); resolve(); };
    const t = setTimeout(finish, Math.max(0, Math.min(ms, 2_147_000_000)));
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * The dependencies for the real thing: the account's connection, the clock, the timer, the store. `accountId` keys
 * the day's count; an `Account` brings its own id, a bare `Conn` falls back to its instance name.
 */
export function realDeps(conn: Conn, accountId: string = (conn as Partial<Account>).id || conn.instance): RunDeps {
  return {
    call: callerFor(conn),
    instance: conn.instance,
    now: () => Date.now(),
    sleep: realSleep,
    rnd: Math.random,
    save: saveCampaign,
    sentToday: () => sentToday(accountId),
    suppressed: doNotContact,
    counted: (at) => countSent(accountId, at),
    deadline: realSleep,
  };
}

/**
 * After a quit or a crash: whatever was `sending` may or may not have gone, and is `unknown` from here on; a campaign
 * stored as `running` is `paused`, for the person to continue. Call it only on a campaign no runner of this process is
 * sending (`isRunning`).
 */
export function recover(c: Campaign): Campaign {
  const outcomes: Record<string, Outcome> = {};
  let touched = false;
  for (const [k, o] of Object.entries(c.outcomes ?? {})) {
    if (o && o.standing === 'sending') { outcomes[k] = { ...o, standing: 'unknown', why: 'interrupted' }; touched = true; }
    else outcomes[k] = o;
  }
  if (!touched && c.state !== 'running') return c;
  return { ...c, outcomes, state: c.state === 'running' ? 'paused' : c.state, notes: addNote(c.notes, 'interrupted') };
}

/** What a failed test send says, as one machine word. */
function failure(v: Verdict): string {
  if (v.k === 'maybe') return v.why;
  if (v.k === 'account') return 'account';
  if (v.k === 'refused') {
    if (v.status === 401 || v.status === 403) return 'auth';
    if (v.status === 404 || v.status === 405) return 'instance';
    if (v.status === 429) return 'rate-limited';
    if (v.status === 400) return 'invalid';
    return `http-${v.status}`;
  }
  return 'unknown';
}

/**
 * One message to the person's own number before the real thing: `'sent'` or why not. Through the same wire, the same
 * request shapes and the same reading of answers as a campaign — that is what makes it a test — but no campaign, no
 * state, no pace. `text` is sent as given (the screen renders it for the first person, opt-out line and all).
 */
export async function sendTest(
  conn: Conn, phone: string, text: string, o: { attachment?: Attachment; timeoutMs?: number } = {},
): Promise<'sent' | { failed: string }> {
  if (!ready(conn)) return { failed: 'no-account' };
  const p = wirePhone(phone);
  if (!p) return { failed: 'invalid-number' };
  const body = typeof text === 'string' ? text.trim().slice(0, LIMITS.messageChars) : '';
  if (!body && !o.attachment) return { failed: 'empty' };
  const call = callerFor(conn);
  for (const part of partsFor(conn.instance, p, body, o.attachment, false, o.timeoutMs ?? TIMEOUT_MS)) {
    const v = verdictOf(await timed(call, realSleep, part.path, part.body, part.ms));
    if (v.k !== 'sent') return { failed: failure(v) };
  }
  return 'sent';
}
