/**
 * The one function that talks to an Evolution instance.
 *
 * `whatsapp.ts` is arithmetic and `whatsapptool.ts` takes its transport as an
 * argument, so this file is the whole network surface of the WhatsApp feature
 * — deliberately, and it is why the rule can be checked by reading rather than
 * by trusting: **a key is only ever sent to the URL it was entered beside.**
 * Every request is built from one `Conn`, `baseUrl` and `key` travel together
 * or not at all, and there is no parameter here that could point one at
 * another host.
 *
 * It exists as its own module because two callers need it — the panel a person
 * types into and the tool the agent calls — and the second one was the moment
 * that mattered. Copying fifteen lines into `App.tsx` would have made a second
 * place that decides where a key goes, and the invariant above would then be a
 * claim about two files that have to be kept in step rather than about one.
 *
 * Nothing here translates. A status is a fact; what to *say* about it is the
 * caller's, and the panel's sentences are in the catalogue next to its other
 * sentences rather than in the transport.
 */

import type { Conn } from './whatsapp';

/**
 * A request that reached the server and was refused.
 *
 * `status` rather than a message, because the two callers want different
 * things from it: the panel wants a sentence in the user's language, and the
 * agent's tool wants something the model can act on.
 */
export class WireError extends Error {
  constructor(readonly status: number) {
    super(`The WhatsApp server answered ${status}.`);
    this.name = 'WireError';
  }
}

/**
 * One call to the instance. GET when there is no body, POST when there is.
 *
 * The signature takes a path and not a URL: a caller cannot pass an absolute
 * address and have the key follow it somewhere else.
 */
export async function apiCall(conn: Conn, path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`${conn.baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      apikey: conn.key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new WireError(r.status);
  return r.json();
}

/** `apiCall` bound to one connection, which is the shape the tools want. */
export const callerFor = (conn: Conn) =>
  (path: string, body?: unknown): Promise<unknown> => apiCall(conn, path, body);
