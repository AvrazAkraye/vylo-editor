import { compact } from './usage';

/**
 * Signing in to a Vylo account, and reading what that account says about
 * itself.
 *
 * The first screen asks for an `sk-vylo-…` key that lives on a website. Every
 * person who reaches that screen already has an account there — an email and a
 * password — so asking them to leave, log in, find the keys page and paste a
 * string back is three steps of someone else's product wedged into the first
 * minute of this one. This module is the other route: sign in here, and let the
 * app mint its own key.
 *
 * It hands us the plan balance for nothing, which is the second reason to build
 * it. Today a monthly allowance runs out mid-turn and the first anyone hears of
 * it is a 402 in the middle of an answer. `GET /me` has the number, and
 * `planSummary` below turns it into the one line a status bar can carry.
 *
 * ## Two secrets, and they are not interchangeable
 *
 * The JWT from `/auth/login` authenticates the **account API**: who you are,
 * what plan you are on, mint me a key. The `sk-vylo-…` key authenticates the
 * **model API**: `/v1/messages`. They have different lifetimes and different
 * blast radii, and swapping them would either send a session token to the model
 * endpoint or spend an API key on the account endpoint. So nothing in this file
 * builds a URL outside `/app/api`, and nothing in this file reads or writes
 * `vylo.apiKey`. `accountBase` is the only place a URL is assembled, and
 * `account.test.mjs` pins every request against it.
 *
 * ## The password
 *
 * It is an argument to `login` and `register` and nothing else. It is not
 * returned, not stored, not put in a note, and not kept anywhere that outlives
 * the call. A 400 from the server talks about the *shape* of a password — too
 * short — never its content, which is why relaying that message is safe.
 *
 * ## The token
 *
 * Stored the way the API key is stored today: `localStorage`, in plaintext, on
 * a machine the user controls. It is a credential, so it appears in exactly one
 * place — the `Authorization` header — and never in a note, an error, a
 * transcript line, or anything `explain()` renders. There is no `console` call
 * in this file and there should not be one.
 *
 * ## None of this is a tool
 *
 * No function here is reachable from the agent. The tool schema in `agent.ts`
 * has eight names and this adds none: the model cannot read the token, cannot
 * mint a key, and never sees the password.
 *
 * ## Storage is a parameter
 *
 * Every function that touches the store takes it, so the whole file runs in
 * node with no browser. The `localStorage` default belongs at the call site;
 * putting it in a default parameter here would make the module untestable in
 * exactly the cases that matter — a store that throws, and a store holding
 * something that is not a token.
 */

/** The SaaS router's mount point. The bare paths — `/me`, `/keys` — 404. */
export const API_PATH = '/app/api';

/** `https://capi.vylo-tech.com` → `https://capi.vylo-tech.com/app/api`. */
export const accountBase = (baseUrl: string): string =>
  `${baseUrl.trim().replace(/\/+$/, '')}${API_PATH}`;

export interface User {
  id: string | number;
  email: string;
  role?: string;
}

/** A plan as `/me` and `/plans` describe it. `is_trial` arrives as 0 or 1. */
export interface Plan {
  code: string;
  name: string;
  is_trial: number | boolean;
  period_end: string | null;
  monthly_tokens: number;
  rate_per_min: number;
  /** Comma-separated model ids, not an array. */
  models: string;
}

/** `usage` from `GET /me`. The two nullable fields are the whole difficulty. */
export interface Allowance {
  /** null for an account with no subscription at all. */
  plan: Plan | null;
  used_tokens: number;
  input_tokens: number;
  output_tokens: number;
  requests: number;
  /** **null when the plan is unmetered.** Not zero. See `planSummary`. */
  remaining_tokens: number | null;
  /** **null when the plan is unmetered.** Not zero. */
  percent_used: number | null;
}

export interface Me {
  user: User;
  /** null when the answer carried no usage object at all. `planSummary` copes. */
  usage: Allowance | null;
}

/** What signing in produces. The token is the credential; the user is display. */
export interface Signed {
  user: User;
  token: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * What went wrong, and what to do about it
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Which secret a request carried.
 *
 * This is what makes a 401 legible, and it is the reason it is a parameter
 * rather than something inferred from the body. A request carrying a password
 * the user just typed and a request carrying a stored token both come back 401,
 * and they mean opposite things: *you typed it wrong* against *sign in again*.
 * Telling an expired session it has the wrong password sends someone to retype
 * a password that was always right.
 *
 * The server does say which it was — "Incorrect email or password." against
 * "Not signed in." — but wording is the server's to change and the shape of the
 * request is not, so the request is what decides.
 */
export type Sent = 'credentials' | 'session';

/**
 * What happened, what to do, and — separately — whatever came off the wire.
 *
 * `note` and `fix` are always **fixed English sentences**, never assembled from
 * a status code or a server message, because every one of them is a key in the
 * three catalogues in `i18n.ts` and a sentence built at runtime cannot be
 * looked up. `t()` falls through to its key when a translation is missing, so
 * an interpolated note would render in English inside an Arabic interface and
 * nothing would report it — `gateway.ts` does exactly that today and this does
 * not repeat it.
 *
 * `detail` is where the untranslatable part goes: the server's own validation
 * message, a status number, an address. It is shown as it came, beside the
 * translated sentence rather than inside it.
 */
interface Said {
  note: string;
  fix: string;
  /** Untranslated, and only ever what the server or the request supplied. */
  detail?: string;
}

export type Verdict =
  | { state: 'ok' }
  /** The email or the password is wrong. Only ever from a `credentials` call. */
  | ({ state: 'wrong-password' } & Said)
  /** The stored token is gone, expired or rejected. Sign in again. */
  | ({ state: 'signed-out' } & Said)
  /** 409 — that email already has an account. */
  | ({ state: 'taken' } & Said)
  /** 403 — the account exists and is switched off. */
  | ({ state: 'suspended' } & Said)
  /** 400 — `detail` is the server's own validation message. */
  | ({ state: 'rejected' } & Said)
  /** 429 — right credentials, too many attempts. */
  | ({ state: 'busy' } & Said)
  /** The request never arrived. **Not** a wrong password. */
  | ({ state: 'offline' } & Said)
  /** Could not tell — an unfamiliar status, or an answer that made no sense. */
  | ({ state: 'unknown' } & Said);

/**
 * What an HTTP status from the account API means.
 *
 * Separated from the request in the shape `gateway.ts` uses, so the interesting
 * half is testable without a network and an unfamiliar status has one obvious
 * place to be handled.
 *
 * The `detail` argument is the server's `error.message`. It is carried through
 * on 400, because that is the one status where the server knows something we do
 * not: that the password is under eight characters, or that the email does not
 * parse. Everywhere else the wording here is better, because it can say what to
 * *do* — so the server's version is kept only where there was nothing else.
 */
export function verdict(status: number, detail = '', sent: Sent = 'credentials'): Verdict {
  switch (status) {
    case 200:
    case 201:
      return { state: 'ok' };
    case 400:
      return {
        state: 'rejected',
        note: 'The server would not accept that.',
        fix: 'Check what you typed and try again.',
        // Carried rather than rewritten: the server is the only thing that
        // knows which rule was broken — too short a password, an address that
        // does not parse — and a general sentence here would hide it.
        detail,
      };
    case 401:
      return sent === 'session'
        ? {
          state: 'signed-out',
          note: 'This session has expired.',
          fix: 'Sign in again to carry on.',
        }
        : {
          state: 'wrong-password',
          note: 'That email and password do not match an account.',
          fix: 'Check both, or create an account if you do not have one.',
        };
    case 403:
      return {
        state: 'suspended',
        note: 'That account is suspended.',
        fix: 'Contact support before using it.',
      };
    case 404:
      return {
        state: 'unknown',
        note: 'That address answered, but not like a Vylo gateway.',
        fix: 'Check the gateway address in Settings.',
      };
    case 409:
      return {
        state: 'taken',
        note: 'That email already has an account.',
        fix: 'Sign in instead, or use another address.',
      };
    case 429:
      return {
        state: 'busy',
        note: 'Too many attempts. The account is fine.',
        fix: 'Wait a minute and try again.',
      };
    default:
      if (status >= 500) {
        return {
          state: 'unknown',
          note: 'The server is having trouble.',
          fix: 'This is the server, not your account — try again shortly.',
          detail: String(status),
        };
      }
      return {
        state: 'unknown',
        note: 'The server answered in a way this app did not expect.',
        fix: 'Try again, or check the gateway address in Settings.',
        detail: detail || String(status),
      };
  }
}

/**
 * A network failure, which is the one outcome that has no status.
 *
 * It has its own constructor because the mistake it prevents is specific: a
 * webview reports every network failure as "Load failed", and a sign-in screen
 * that turns that into "wrong password" tells someone on a dropped connection
 * to change a password that is perfectly good.
 */
export const offline = (baseUrl: string): Failure => ({
  state: 'offline',
  note: 'Could not reach the gateway.',
  fix: 'Check the address in Settings and that you are online.',
  detail: baseUrl,
});

/**
 * An answer that arrived and made no sense.
 *
 * Its own outcome rather than a silent success, because every place it is
 * raised is a place where returning `ok` would hand the app an empty string it
 * would then use as a credential.
 */
const malformed = (): Failure => ({
  state: 'unknown',
  note: 'The server answered, but not with anything this app understands.',
  fix: 'Check the gateway address in Settings, then try again.',
});

/**
 * A verdict that is not a success.
 *
 * Named so a failed `Result` is typed as *having* a note and a fix. Without it
 * every caller rendering `why.note` has to prove the verdict was not `ok`
 * first, and the one that forgets renders `undefined` at the user.
 */
export type Failure = Exclude<Verdict, { state: 'ok' }>;

/** Either the thing that was asked for, or why not. */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; why: Failure };

const failed = (why: Verdict): Result<never> =>
  // `verdict()` answers `ok` for a 2xx and this is only ever reached for
  // something else — but a Result has to carry something renderable whatever
  // it is handed, rather than a note that is not there.
  ({ ok: false, why: why.state === 'ok' ? malformed() : why });

/* ────────────────────────────────────────────────────────────────────────
 * The token store
 * ──────────────────────────────────────────────────────────────────────── */

/** The parts of `localStorage` this needs, so a fake is three lines. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Beside `vylo.apiKey`, and stored the same way, because it is the same kind of thing. */
export const TOKEN_KEY = 'vylo.token';

/**
 * The wire shape of a JWT: three base64url segments.
 *
 * Checked because `localStorage` is editable — devtools, or anything else in
 * the webview — so what comes back out is not necessarily what went in. The
 * character class also has a security job: it admits no whitespace and no
 * control characters, so nothing read from the store can inject a second header
 * into the `Authorization` line. A value that fails this is treated as no token
 * at all, which costs a sign-in and cannot lock anyone out.
 */
const JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

export const looksLikeToken = (v: unknown): v is string =>
  typeof v === 'string' && JWT.test(v);

/** The stored session token, or `''` when there is not a usable one. */
export function loadToken(store: Store): string {
  let raw: string | null;
  try { raw = store.getItem(TOKEN_KEY); } catch { return ''; }
  return looksLikeToken(raw) ? raw : '';
}

export function saveToken(store: Store, token: string): void {
  try { store.setItem(TOKEN_KEY, token); } catch { /* quota, or storage disabled */ }
}

export function forgetToken(store: Store): void {
  try { store.removeItem(TOKEN_KEY); } catch { /* storage disabled */ }
}

/* ────────────────────────────────────────────────────────────────────────
 * The calls
 * ──────────────────────────────────────────────────────────────────────── */

interface Call {
  baseUrl: string;
  path: string;
  /** Present on the POSTs. A password in here is gone the moment this returns. */
  body?: unknown;
  /** Present only on `session` calls. The one place the token is ever used. */
  token?: string;
  sent: Sent;
}

/**
 * One request to the account API, and the only place this module speaks to the
 * network.
 *
 * Everything funnels through here so there is a single answer to "what can this
 * file reach": `accountBase(baseUrl) + path`, and nothing else. In particular
 * there is no branch that could put the token on `/v1/messages`.
 */
async function call<T>(c: Call): Promise<Result<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (c.body !== undefined) headers['content-type'] = 'application/json';
  if (c.token) headers.authorization = `Bearer ${c.token}`;

  let res: Response;
  try {
    res = await fetch(`${accountBase(c.baseUrl)}${c.path}`, {
      method: c.body === undefined ? 'GET' : 'POST',
      headers,
      body: c.body === undefined ? undefined : JSON.stringify(c.body),
    });
  } catch {
    return failed(offline(c.baseUrl));
  }

  let parsed: unknown = null;
  try { parsed = await res.json(); } catch { /* not JSON; the status is enough */ }
  const obj = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;

  if (!res.ok) {
    const err = obj?.error as { message?: unknown } | undefined;
    const detail = typeof err?.message === 'string' ? err.message : '';
    return failed(verdict(res.status, detail, c.sent));
  }
  // A 2xx whose body is not an object is a server we do not understand. Saying
  // so beats returning an empty user and letting the UI render blanks.
  if (!obj) return failed(malformed());
  return { ok: true, value: obj as T };
}

/** The parts of a `{ user, token }` answer, or null when it was not one. */
function asSigned(body: Record<string, unknown>): Signed | null {
  const user = body.user as User | undefined;
  const token = body.token;
  if (!user || typeof user !== 'object' || typeof user.email !== 'string') return null;
  // A "signed in" with no usable token is a failure, not a success: the app
  // would store nothing and the very next call would 401 for no visible reason.
  if (!looksLikeToken(token)) return null;
  return { user, token };
}

/**
 * Sign in. The password is used here and nowhere else.
 *
 * The token comes back in the response *body*. It also arrives as a
 * `Set-Cookie`, which no native client can read, and the cookie is
 * `SameSite=Lax` so it would not be sent from this origin anyway — the body is
 * the only route that works from a desktop app.
 */
export async function login(baseUrl: string, email: string, password: string): Promise<Result<Signed>> {
  const r = await call<Record<string, unknown>>({
    baseUrl, path: '/auth/login', sent: 'credentials',
    body: { email: email.trim(), password },
  });
  if (!r.ok) return r;
  const signed = asSigned(r.value);
  return signed ? { ok: true, value: signed } : failed(malformed());
}

/** Create an account. Same answer as `login`, and the same handling. */
export async function register(baseUrl: string, email: string, password: string): Promise<Result<Signed>> {
  const r = await call<Record<string, unknown>>({
    baseUrl, path: '/auth/register', sent: 'credentials',
    body: { email: email.trim(), password },
  });
  if (!r.ok) return r;
  const signed = asSigned(r.value);
  return signed ? { ok: true, value: signed } : failed(malformed());
}

/**
 * Forget the session.
 *
 * Local first, server second, and the order is the point: `/auth/logout`
 * answers `{ ok: true }` whether or not it was given a token, and if the
 * network is down it answers nothing at all. Waiting for it before clearing
 * would leave the app holding a token it has already decided is dead, and a
 * sign-out that fails because the wifi dropped is a sign-out that did not
 * happen.
 */
export async function signOut(store: Store, baseUrl: string, token: string): Promise<void> {
  forgetToken(store);
  try {
    await fetch(`${accountBase(baseUrl)}/auth/logout`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  } catch { /* the session is gone from this machine either way */ }
}

/* ── what the plans cost ──────────────────────────────────────────────────
   `usage.ts` refuses to put a price on a token, and is right to: that would
   mean hardcoding somebody else's rate card. This is the other kind of money
   — what the gateway itself charges for a plan, which the gateway publishes.
   Quoting its own figure is reporting, not guessing. */

export interface PlanOffer {
  code: string;
  name: string;
  /** null when the server sent no price, which is not the same as free. */
  priceCents: number | null;
  currency: string;
  monthlyTokens: number | null;
  ratePerMin: number | null;
  models: string[];
  trial: boolean;
}

/** Every plan on offer, cheapest first. */
export async function plans(baseUrl: string, token: string): Promise<Result<PlanOffer[]>> {
  const r = await call<Record<string, unknown>>({
    baseUrl, path: '/plans', sent: 'session', token,
  });
  if (!r.ok) return r;
  const raw = Array.isArray(r.value.plans) ? r.value.plans : [];
  const out: PlanOffer[] = [];
  for (const item of raw) {
    const p = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    if (!p || typeof p.code !== 'string' || !p.code.trim()) continue;
    out.push({
      code: p.code.trim(),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.code.trim(),
      priceCents: num(p.price_cents),
      currency: typeof p.currency === 'string' && p.currency.trim() ? p.currency.trim() : 'USD',
      monthlyTokens: num(p.monthly_tokens),
      ratePerMin: num(p.rate_per_min),
      models: modelList(p.models),
      trial: p.is_trial === true || p.is_trial === 1,
    });
  }
  out.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
  return { ok: true, value: out };
}

/**
 * The cheapest plan *above the one held* that can run a model, or null.
 *
 * "Above" is the whole point. Answering "which plan runs Opus" with a plan
 * cheaper than the one already paid for would be telling someone to downgrade
 * to gain a model — a suggestion that is not merely useless but wrong, since
 * moving down loses the allowance they are on. A trial is never an answer for
 * the same reason, and neither is the plan in hand.
 */
export function cheapestWith(offers: readonly PlanOffer[], model: string, have: PlanOffer | null): PlanOffer | null {
  const floor = have ? have.priceCents ?? 0 : -1;
  for (const o of offers) {
    if (o.trial || (have && o.code === have.code)) continue;
    if ((o.priceCents ?? 0) <= floor) continue;
    if (o.models.includes(model)) return o;
  }
  return null;
}

/**
 * Cents as the money people say. Whole units lose the decimals — "$20 a month"
 * is what the page they would buy it on says, and "$20.00" reads like a total
 * on a receipt.
 */
export function money(cents: number | null, currency = 'USD'): string | null {
  if (cents === null || !Number.isFinite(cents) || cents < 0) return null;
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '\u20ac' : currency === 'IQD' ? 'IQD ' : `${currency} `;
  const whole = cents / 100;
  return `${symbol}${cents % 100 === 0 ? whole : whole.toFixed(2)}`;
}

/** Who this token belongs to, and what their plan has left. */
export async function me(baseUrl: string, token: string): Promise<Result<Me>> {
  const r = await call<Record<string, unknown>>({
    baseUrl, path: '/me', sent: 'session', token,
  });
  if (!r.ok) return r;
  const user = r.value.user as User | undefined;
  if (!user || typeof user !== 'object' || typeof user.email !== 'string') return failed(malformed());
  // `usage` is passed on unchecked on purpose — `planSummary` is written to
  // survive whatever is in it, and refusing the whole call because one nested
  // field was odd would hide the user's own email from them.
  const usage = r.value.usage;
  return {
    ok: true,
    value: { user, usage: usage && typeof usage === 'object' ? usage as Allowance : null },
  };
}

/**
 * Mint a model API key.
 *
 * **The key comes back exactly once.** The server stores only its hash, so if
 * the caller does not persist what this returns at the moment it returns, it is
 * gone and the only remedy is minting another. Do not log it, and do not put it
 * in a message that is shown twice.
 */
export async function mintKey(baseUrl: string, token: string, name = 'Vylo Editor'): Promise<Result<string>> {
  const r = await call<Record<string, unknown>>({
    baseUrl, path: '/keys', sent: 'session', token, body: { name },
  });
  if (!r.ok) return r;
  const key = r.value.key;
  // A 200 with no key is the one failure that must not read as success: the
  // caller would save `''` and the next model request would 401.
  if (typeof key !== 'string' || !key.trim()) return failed(malformed());
  return { ok: true, value: key.trim() };
}

/* ────────────────────────────────────────────────────────────────────────
 * The plan, as one line
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How loudly to say what is left.
 *
 * `unknown` and `none` are deliberately different. "We could not tell" and "you
 * have no subscription" call for opposite things — try again against go and
 * buy one — and collapsing them would show a billing prompt to someone whose
 * network blipped.
 */
export type PlanLevel = 'unknown' | 'none' | 'ok' | 'low' | 'out';

export interface PlanSummary {
  /** The plan's name, or null when there is no plan and nothing to name. */
  name: string | null;
  trial: boolean;
  /**
   * False when the plan has no monthly ceiling. `left` and `percent` are then
   * null, and the UI must say *no limit* rather than draw an empty bar.
   */
  metered: boolean;
  /** Tokens left this period, compact. null when unmetered or unknown. */
  left: string | null;
  /** Tokens spent this period, compact. null only when nothing is known. */
  used: string | null;
  /** The monthly allowance, compact. null when unmetered or unknown. */
  allowance: string | null;
  /** 0–100. null when unmetered or unknown. */
  percent: number | null;
  level: PlanLevel;
  /** When the allowance resets, exactly as the server wrote it. */
  renews: string | null;
  /** The plan's code (`starter`), for matching against the plans list. */
  code: string | null;
  /**
   * The models this plan may run, already split out of the comma list the
   * server sends. Empty means the server did not say — which is not the same
   * as "no models", so a caller must treat empty as "do not know" and allow
   * everything rather than offering nothing.
   */
  models: string[];
  /** Requests a minute this plan is allowed, or null when the server is quiet. */
  ratePerMin: number | null;
  /** Requests made this period. */
  requests: number | null;
  /** Tokens sent and received this period, uncompacted. */
  sent: number | null;
  received: number | null;
}

/**
 * Whether a plan may run a model.
 *
 * A plan that named no models allows everything. The alternative — an empty
 * list meaning "nothing" — would grey out every model in the picker the first
 * time an older gateway answered without the field, which is a worse failure
 * than letting a request through to be refused by the server that knows.
 */
export function allows(plan: PlanSummary | null, model: string): boolean {
  if (!plan || !plan.models.length) return true;
  return plan.models.includes(model);
}

/** The comma list the server sends, as ids. */
export function modelList(raw: unknown): string[] {
  return typeof raw === 'string'
    ? raw.split(',').map((m) => m.trim()).filter(Boolean)
    : [];
}

/**
 * Percentage at which a metered plan is worth warning about.
 *
 * Ten per cent left is roughly one working session on any plan above the trial.
 */
export const LOW_PERCENT = 90;

/**
 * …and a floor in tokens, because a percentage of a small plan is a small
 * number of tokens. Ten per cent of the 100k trial is 10k, which one turn over
 * a couple of large files can spend — so the trial would be warned about at the
 * moment it was already too late. This is what catches the small plans; the
 * percentage catches the large ones.
 */
export const LOW_TOKENS = 25_000;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * `usage` from `GET /me`, as the one line a status bar can hold.
 *
 * Takes `unknown` because that is honestly what a response body is. Every field
 * is read defensively, and the awkward cases are the reason this function
 * exists rather than three expressions in a component:
 *
 * - **`remaining_tokens` and `percent_used` are null on an unmetered plan.**
 *   `remaining ?? 0` would tell a Max customer they have nothing left, which is
 *   the worst thing this feature could do — it is a false alarm aimed at the
 *   only people paying the most.
 * - **The server clamps `percent_used`, and this clamps it again.** Relying on
 *   the far end to bound a number that drives a progress bar means a server-side
 *   change draws a bar past its own track.
 * - **`plan: null` is an account with no subscription**, not an account with an
 *   empty one. It gets its own level so the UI can offer the plans page instead
 *   of a balance of zero.
 */
export function planSummary(usage: unknown): PlanSummary {
  const none: PlanSummary = {
    name: null, trial: false, metered: false, left: null, used: null,
    allowance: null, percent: null, level: 'unknown', renews: null,
    code: null, models: [], ratePerMin: null, requests: null, sent: null, received: null,
  };

  const u = usage && typeof usage === 'object' ? usage as Record<string, unknown> : null;
  if (!u) return none;

  const raw = u.plan;
  const plan = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  const used = num(u.used_tokens) ?? 0;

  if (!plan) return { ...none, used: compact(used), level: 'none', ...counts(u) };

  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : null;
  // `is_trial` arrives as 0 or 1 from SQLite, not as a boolean.
  const trial = plan.is_trial === true || plan.is_trial === 1;
  const renews = typeof plan.period_end === 'string' ? plan.period_end : null;
  const monthly = num(plan.monthly_tokens);

  const remaining = num(u.remaining_tokens);
  const reported = num(u.percent_used);
  // Metered if the server said anything numeric about a ceiling. Both fields
  // are consulted rather than one, so a server that fills in only one of them
  // is still understood — and an unmetered plan, which fills in neither, is
  // still recognised as unmetered.
  const metered = remaining !== null || reported !== null || (monthly !== null && monthly > 0);

  if (!metered) {
    return {
      name, trial, metered: false, left: null, used: compact(used),
      allowance: null, percent: null, level: 'ok', renews, ...facts(plan, u),
    };
  }

  // Derived only when the server did not say. A plan with a ceiling always
  // gives a percentage in practice; this is the fallback that keeps the bar
  // drawable if it ever stops.
  const percentRaw = reported ?? (monthly && monthly > 0 ? (used / monthly) * 100 : 0);
  const percent = clamp(Math.round(percentRaw), 0, 100);
  const leftTokens = remaining !== null
    ? Math.max(0, remaining)
    : monthly !== null ? Math.max(0, monthly - used) : null;

  // Out before low, and both before ok. A plan that is over its allowance
  // reports a percentage above 100 and a negative remainder, and either one on
  // its own is enough to say it is spent.
  const spent = percentRaw >= 100 || (leftTokens !== null && leftTokens <= 0);
  const low = percent >= LOW_PERCENT || (leftTokens !== null && leftTokens < LOW_TOKENS);

  return {
    name,
    trial,
    metered: true,
    left: leftTokens === null ? null : compact(leftTokens),
    used: compact(used),
    allowance: monthly !== null && monthly > 0 ? compact(monthly) : null,
    percent,
    level: spent ? 'out' : low ? 'low' : 'ok',
    renews,
    ...facts(plan, u),
  };
}

/** The counting half of a summary: what this period has done. */
function counts(u: Record<string, unknown>) {
  return {
    requests: num(u.requests),
    sent: num(u.input_tokens),
    received: num(u.output_tokens),
  };
}

/** The plan half, plus the counts. Every field here is one the server sends. */
function facts(plan: Record<string, unknown>, u: Record<string, unknown>) {
  return {
    code: typeof plan.code === 'string' && plan.code.trim() ? plan.code.trim() : null,
    models: modelList(plan.models),
    ratePerMin: num(plan.rate_per_min),
    ...counts(u),
  };
}
