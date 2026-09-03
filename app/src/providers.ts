/**
 * Where a request may be sent, and with which key.
 *
 * The app has always spoken to one place: the Vylo gateway, with one key. This
 * lets a person add others — OpenAI, Blackbox, OpenRouter, Groq, DeepSeek, an
 * Ollama on their own machine — because the model they want is not always the
 * model the gateway carries.
 *
 * ## Two wire formats cover everything
 *
 * Every provider worth adding speaks one of two shapes: Anthropic's Messages
 * API, or OpenAI's chat completions — which the rest of the industry adopted
 * as the lingua franca. Blackbox, OpenRouter, Groq, DeepSeek, Together,
 * Mistral, Ollama and LM Studio are all the second one. So a provider is not
 * "OpenAI" or "Blackbox"; it is a base URL, a key, and which of the two shapes
 * that URL speaks. `openai.ts` translates the app's internal shape (Anthropic
 * Messages, which the agent loop is built around) to and from the other one.
 *
 * ## The rule about keys
 *
 * **A key is only ever sent to the URL it was entered beside.** Key and URL
 * live in one record, and `headersFor`/`endpointFor` read the same record —
 * there is no code path that takes a key from one provider and a URL from
 * another, and the tests pin that the two functions agree. This is the whole
 * safety story of the feature: adding a second provider must not create a way
 * for the first provider's key to travel somewhere new.
 *
 * ## What this deliberately is not
 *
 * There is no proxying, no key escrow, and no fetching a provider's model list
 * from its API on startup — a request that fires just because the app opened
 * is a request nobody asked for. Models are typed in by the person, who knows
 * which ones their key can use.
 */

export type Wire = 'anthropic' | 'openai';

export interface Provider {
  /** Stable, generated once. The selection points at this, not at the name. */
  id: string;
  /** What the person called it. "OpenAI", "work account", anything. */
  name: string;
  /** Normalised: origin plus any path prefix, no trailing slash, no endpoint. */
  baseUrl: string;
  wire: Wire;
  key: string;
  /** Model ids the person listed. Never fetched. */
  models: string[];
}

/** The id of the built-in gateway. Composed at read time, never stored. */
export const BUILT_IN = 'vylo';

/** Where the added providers are kept. */
export const KEY = 'vylo.providers.v1';

/** Which provider and model are chosen. */
export const CHOSEN_KEY = 'vylo.chosen.v1';

export interface Chosen {
  provider: string;
  model: string;
}

/**
 * Tidy a pasted base URL into a prefix requests can be built on.
 *
 * People paste every form of a provider's URL: the origin, the origin with a
 * trailing slash, the `/v1`, the whole endpoint out of a curl example, or
 * OpenRouter's `/api/v1`. All of them mean the same place, so all of them
 * normalise to the same string — the prefix up to but not including `/v1`,
 * with `/v1` re-added by `endpointFor`. Refusing all but one form would make
 * the field a quiz.
 */
export function normalizeBase(raw: string): string {
  let url = (raw ?? '').trim().replace(/\/+$/, '');
  url = url.replace(/\/(chat\/completions|messages|completions)$/, '');
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/v1$/, '');
  return url.replace(/\/+$/, '');
}

/**
 * Whether a base URL is one this app will talk to.
 *
 * https, with one exception: plain http to the loopback interface, because
 * Ollama and LM Studio live at `http://localhost:11434` and refusing them
 * refuses the most private option there is. `localhost` spelled as a domain
 * that merely starts with it — `localhost.evil.dev` — is not the loopback.
 */
export function acceptableBase(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    // Not `[::1]`: the webview's connect-src cannot express an IPv6 literal
    // with a wildcard port, so accepting it here would save a provider that
    // silently never connects. 127.0.0.1 reaches the same loopback.
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/** The endpoint a chat request goes to, per wire. */
export function endpointFor(p: Pick<Provider, 'baseUrl' | 'wire'>): string {
  return p.wire === 'anthropic'
    ? `${p.baseUrl}/v1/messages`
    : `${p.baseUrl}/v1/chat/completions`;
}

/**
 * The auth headers, per wire.
 *
 * Anthropic-shaped services take `x-api-key` and want the version header;
 * OpenAI-shaped ones take a bearer token. Built from the same record as
 * `endpointFor`, which is what keeps a key on its own provider's URL.
 */
export function headersFor(p: Pick<Provider, 'wire' | 'key'>): Record<string, string> {
  return p.wire === 'anthropic'
    ? { 'content-type': 'application/json', 'x-api-key': p.key, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', authorization: `Bearer ${p.key}` };
}

/** A fresh id. Distinct enough for a list nobody will put fifty entries in. */
export function newId(taken: readonly string[]): string {
  for (let n = 1; ; n++) {
    const id = `p${n}`;
    if (!taken.includes(id) && id !== BUILT_IN) return id;
  }
}

/**
 * Read the stored list, repairing anything untrustworthy.
 *
 * The same posture as every other store in this app: a corrupt value is the
 * empty list, never a window that will not open. A record missing any field
 * that matters is dropped whole rather than half-kept — half a provider is a
 * key with no certain destination, which is the one thing this file exists to
 * prevent.
 */
export function read(raw: string | null): Provider[] {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    const out: Provider[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      if (typeof p.id !== 'string' || !p.id || p.id === BUILT_IN || seen.has(p.id)) continue;
      // Normalise FIRST, then judge — the form's order. The other way round,
      // a crafted store like `https://messages` passes the check as one host
      // and normalises into another, which is the one breach of the key rule
      // this file exists to prevent.
      const baseUrl = typeof p.baseUrl === 'string' ? normalizeBase(p.baseUrl) : '';
      if (!acceptableBase(baseUrl)) continue;
      if (p.wire !== 'anthropic' && p.wire !== 'openai') continue;
      if (typeof p.key !== 'string') continue;
      seen.add(p.id);
      out.push({
        id: p.id,
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : p.id,
        baseUrl,
        wire: p.wire,
        key: p.key,
        models: Array.isArray(p.models)
          ? [...new Set(p.models
              .filter((m): m is string => typeof m === 'string' && !!m.trim())
              .map((m) => m.trim()))]
          : [],
      });
    }
    return out;
  } catch {
    return [];
  }
}

export function write(list: readonly Provider[]): string {
  return JSON.stringify(list);
}

/**
 * The chosen provider and model, against what actually exists.
 *
 * Falls back to the built-in gateway and its stored model rather than to
 * nothing: a provider that was removed must not leave the composer pointing at
 * a place that no longer has a key.
 */
export function chosen(
  raw: string | null,
  providers: readonly Provider[],
  fallbackModel: string,
): Chosen {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      const c = parsed as Record<string, unknown>;
      if (c.provider === BUILT_IN && typeof c.model === 'string' && c.model) {
        return { provider: BUILT_IN, model: c.model };
      }
      const p = providers.find((x) => x.id === c.provider);
      if (p && typeof c.model === 'string' && c.model) {
        return { provider: p.id, model: c.model };
      }
    }
  } catch {
    // Fall through to the gateway.
  }
  return { provider: BUILT_IN, model: fallbackModel };
}

/** What a request needs to know. The one object routing hands around. */
export interface Route {
  baseUrl: string;
  key: string;
  wire: Wire;
  model: string;
}

/**
 * Resolve a choice into the four facts a request is built from.
 *
 * The built-in gateway is composed here from the app's existing base URL and
 * key rather than stored in the list — it predates the list, its key is
 * managed by sign-in, and storing a copy would be a second value to drift.
 *
 * A choice pointing at a provider that no longer exists falls back to the
 * gateway **whole**: its URL, its key, and its model. Half a fallback was the
 * bug the review found — the gateway's URL carrying an empty key and a removed
 * provider's model, which fails with a 401 blaming a key that was fine.
 */
export function route(
  choice: Chosen,
  providers: readonly Provider[],
  gateway: { baseUrl: string; apiKey: string; model: string },
): Route {
  if (choice.provider !== BUILT_IN) {
    const p = providers.find((x) => x.id === choice.provider);
    if (p) return { baseUrl: p.baseUrl, key: p.key, wire: p.wire, model: choice.model };
  }
  return {
    baseUrl: normalizeBase(gateway.baseUrl),
    key: gateway.apiKey,
    wire: 'anthropic',
    model: choice.provider === BUILT_IN ? choice.model : gateway.model,
  };
}

/**
 * Whether a route can be sent at all.
 *
 * A key, or a local server — Ollama and LM Studio take none, and demanding one
 * would refuse the most private option there is. The gateway is https, so the
 * gateway with no key is correctly not ready.
 */
export function armed(r: Pick<Route, 'baseUrl' | 'key'>): boolean {
  return !!r.key || r.baseUrl.startsWith('http://');
}
