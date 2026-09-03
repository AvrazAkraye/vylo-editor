/**
 * What a model's limits actually are, learned from the errors that name them.
 *
 * ## The failure this exists to prevent
 *
 * `budget.ts` pins every model at 200,000 context tokens and every known id at
 * 16,384 output tokens. Both numbers are guesses, and they decide two things
 * the user pays for:
 *
 * - **Too low a context** and the conversation is compacted early, which is
 *   experienced as the agent forgetting a file it read four hops ago — on the
 *   models that cost the most, because those are the ones with the room.
 * - **Too high anything** and the request comes back 400, after a minute spent
 *   assembling it, on a turn that had already read six files.
 *
 * ## Where the real numbers come from
 *
 * Not from a table somebody maintains, and not from the Models API — the
 * gateway does not relay `/v1/models`. They come from the API's own refusals,
 * which state the limit they are refusing against:
 *
 *     prompt is too long: 249890 tokens > 200000 maximum
 *     max_tokens: 65536 > 32000, which is the maximum allowed for this model
 *
 * The second number in each is authoritative. So: parse it, record it against
 * that model id, and use it from then on. The caller sends the request again
 * immediately with the corrected budget, which makes the failure the *last*
 * time it happens for that model rather than the first of many.
 *
 * This composes with a Models API read if the gateway ever grows one: that
 * would be a better opening guess, and this would still correct it.
 *
 * ## Why the parsing is anchored on the wording, not on the shape
 *
 * `40000 tokens > 20000 maximum` is also the shape of a rate-limit message, and
 * learning a per-minute quota as a context window would cap every future
 * request at it — silently, for as long as the store survives. The failure mode
 * of being too strict is that nothing is learned, which is exactly today's
 * behaviour; the failure mode of being too loose is a wrong number nobody knows
 * is there. So each pattern requires the phrase that only that error uses, and
 * anything else is left alone.
 *
 * ## A stored value is input, not memory
 *
 * localStorage is editable by hand and survives upgrades, so what comes back
 * out is re-checked against the same bounds as what went in. A learned context
 * of 12 would otherwise make `fit` trim every conversation to nothing and every
 * later request fail — a corrupted store must not brick the app.
 *
 * ## Storage is a parameter
 *
 * Every function takes the store, so the whole file runs under node with no
 * browser. `browserStore()` is the call-site default rather than a hidden
 * import, and it returns `null` rather than throwing where there is no
 * storage — a webview with site data blocked raises on the property access
 * itself, not merely on `getItem`.
 */

/** The parts of `localStorage` this needs, so a fake is three lines. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The two numbers a request can be wrong about, named as `budget.ts` names them. */
export type LimitKind = 'context' | 'maxOutput';

/** A limit an error stated. `value` is the model's, not ours. */
export interface Found {
  kind: LimitKind;
  value: number;
}

/** What has been learned about one model. Absent fields mean "still guessing". */
export interface Learned {
  context?: number;
  maxOutput?: number;
}

export const KEY = 'vylo.limits.v1';

/**
 * Bounds a learned number has to sit inside to be believed.
 *
 * The low ones are the important half: they are what stops a corrupted or
 * hand-edited store from bricking every future request. 10,000 context tokens
 * is below every model anyone would use here and well above anything a typo
 * produces; 256 output tokens is shorter than a useful reply but long enough
 * that a genuinely small model is not refused.
 *
 * The high ones only stop nonsense being stored. An absurdly *high* value
 * corrects itself — the next request fails and names the real number — so they
 * are deliberately loose enough to allow context windows larger than anything
 * shipping today.
 */
// 2k, not 10k: an Ollama default window is 4k and gpt-3.5-era models are 8k
// — real models this app can now be pointed at. The old floor made a small
// window unlearnable even when the provider named it exactly.
export const MIN_CONTEXT = 2_000;
export const MAX_CONTEXT = 20_000_000;
export const MIN_OUTPUT = 256;
export const MAX_OUTPUT = 1_000_000;

/**
 * Model ids kept. Nothing ever deletes an entry, so without a cap this key
 * grows for the life of the install as ids come and go.
 */
export const MAX_MODELS = 40;

/**
 * `prompt is too long: 249890 tokens > 200000 maximum`
 *
 * The leading phrase is required. Without it this matches a rate-limit message
 * word for word.
 */
const TOO_LONG = /prompt is too long:\s*[\d,_]+\s*tokens\s*>\s*([\d,_]+)\s*maximum/i;

/**
 * ``input length and `max_tokens` exceed context limit: 173663 + 32000 > 200000``
 *
 * The same claim as `TOO_LONG` — the number after `>` is the window — and the
 * one actually seen once `max_tokens` has been raised, because the input and
 * the reply are counted together.
 */
const OVER_CONTEXT = /exceeds? context limit:\s*[\d,_]+\s*\+\s*[\d,_]+\s*>\s*([\d,_]+)/i;

/**
 * `max_tokens: 65536 > 32000, which is the maximum allowed for this model`
 *
 * The tail is required for the same reason as the head of `TOO_LONG`: it is
 * what distinguishes a statement about the model from a statement about a
 * request, an account or a minute.
 */
const TOO_MANY_OUT =
  /max_tokens`?:\s*[\d,_]+\s*>\s*([\d,_]+)\s*,?\s*which is the maximum allowed/i;

/**
 * `This model's maximum context length is 8192 tokens. However, your messages
 * resulted in 9226 tokens` — the OpenAI dialect's wording for the same fact.
 *
 * Added when providers arrived. Without it, an added provider whose model has
 * a small window enters a loop the Anthropic wire self-heals from: the app
 * believes the default 200k, never compacts, the provider 400s, nothing is
 * learned, and Try again re-sends the identical request for ever.
 */
const OAI_CONTEXT = /maximum context length is\s*([\d,_]+)\s*tokens/i;

/**
 * `max_tokens is too large: 90000. This model supports at most 8192 completion
 * tokens` — the OpenAI dialect's reply-cap wording.
 */
const OAI_OUTPUT = /supports at most\s*([\d,_]+)\s*(?:completion|output)\s*tokens/i;

/** Digits with the separators an API or a human might put in them. */
function count(text: string): number {
  return Number(text.replace(/[,_\s]/g, ''));
}

/** Whether a number is one a model could really have. See the bounds above. */
export function plausible(kind: LimitKind, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return false;
  return kind === 'context'
    ? value >= MIN_CONTEXT && value <= MAX_CONTEXT
    : value >= MIN_OUTPUT && value <= MAX_OUTPUT;
}

/**
 * The limit an error names, or `null` when it does not name one.
 *
 * `null` covers three different things on purpose — a message of another kind,
 * a message of the right kind with no numbers in it, and a number that cannot
 * be true — because the caller's response to all three is the same: report the
 * failure as it stands and learn nothing.
 */
export function parseLimitError(text: string): Found | null {
  if (!text) return null;

  const out = TOO_MANY_OUT.exec(text) ?? OAI_OUTPUT.exec(text);
  if (out) {
    const value = count(out[1]);
    return plausible('maxOutput', value) ? { kind: 'maxOutput', value } : null;
  }

  const ctx = TOO_LONG.exec(text) ?? OVER_CONTEXT.exec(text) ?? OAI_CONTEXT.exec(text);
  if (ctx) {
    const value = count(ctx[1]);
    return plausible('context', value) ? { kind: 'context', value } : null;
  }

  return null;
}

/** The webview's storage, or `null` where there is none. */
export function browserStore(): Store | null {
  try {
    // The property access itself throws where site data is blocked, which is
    // why it is inside the try and not behind a `typeof` check alone.
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

interface Row extends Learned {
  /** Which model to forget first. A counter, not a clock — see `learn`. */
  seq: number;
}

type All = Record<string, Row>;

/** One stored row with everything unbelievable removed. */
function clean(v: unknown): Row | null {
  if (!v || typeof v !== 'object') return null;
  const raw = v as { context?: unknown; maxOutput?: unknown; seq?: unknown };
  const row: Row = { seq: typeof raw.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : 0 };
  if (plausible('context', raw.context)) row.context = raw.context;
  if (plausible('maxOutput', raw.maxOutput)) row.maxOutput = raw.maxOutput;
  // A row that learned nothing believable is not a row. Keeping it would hold a
  // model id in the cap that has nothing to say.
  if (row.context === undefined && row.maxOutput === undefined) return null;
  return row;
}

function readAll(store: Store | null): All {
  if (!store) return {};
  let raw: string | null = null;
  try { raw = store.getItem(KEY); } catch { return {}; }
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Nothing to salvage and nothing to report. These are numbers the app can
    // rediscover from the next error that names them, which is where they came
    // from in the first place.
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: All = {};
  for (const [model, v] of Object.entries(parsed as Record<string, unknown>)) {
    const row = clean(v);
    if (row) out[model] = row;
  }
  return out;
}

/** What is known about this model, which for most models is nothing. */
export function learnedFor(model: string, store: Store | null = browserStore()): Learned {
  const row = readAll(store)[model];
  if (!row) return {};
  const out: Learned = {};
  if (row.context !== undefined) out.context = row.context;
  if (row.maxOutput !== undefined) out.maxOutput = row.maxOutput;
  return out;
}

/**
 * Record a limit an error stated, and say whether anything changed.
 *
 * The return value is what stops the caller looping. Sending the request again
 * is only worth doing when the number in it will be different, so a limit that
 * is already stored — a server repeating itself, or a failure that was never
 * about the budget — answers `false` and the failure is reported as it stands.
 */
export function learn(
  model: string, found: Found, store: Store | null = browserStore(),
): boolean {
  if (!model || !store) return false;
  if (!plausible(found.kind, found.value)) return false;

  const all = readAll(store);
  const existing = all[model];
  if (existing && existing[found.kind] === found.value) return false;

  // A counter, not `Date.now()`. Ordering is the only thing this number is for,
  // and a timestamp gets it wrong in the two cases that matter: two writes
  // inside one millisecond tie, and a clock that stepped back makes the model
  // being used right now look like the oldest one in the store.
  const next = Object.values(all).reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  all[model] = { ...existing, [found.kind]: found.value, seq: next };

  const kept = Object.entries(all)
    .sort((a, b) => b[1].seq - a[1].seq)
    .slice(0, MAX_MODELS);
  try {
    store.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Quota, or storage disabled. The value is still returned as learned so
    // this request is corrected; it is only the next session that pays again.
  }
  return true;
}
