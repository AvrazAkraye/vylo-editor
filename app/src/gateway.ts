/**
 * Checking a gateway key without spending anything.
 *
 * A wrong key is worse than no key: nothing says so until the first message
 * fails, by which point someone has opened a project and typed a question. So
 * the key is checked when it is entered.
 *
 * The check has to cost nothing, which rules out the obvious probe. Sending an
 * empty body to `/v1/messages` returns 200 — the gateway forwards it and the
 * model answers "I don't see any content in your message", which is a real
 * completion and a real charge. Sending a `tools` array with no messages takes
 * the native-tools branch, which authenticates first and then rejects the
 * request for having no user message, before any model call:
 *
 *   400  the key was accepted; the request was refused for the reason we chose
 *   401  the key was not recognised
 *   402  the key is real, the account has no plan
 */

const PROBE = { tools: [{ name: 'ping', input_schema: { type: 'object' } }] };

export type KeyCheck =
  | { state: 'ok' }
  /** The key is right but something else is in the way. Worth saving anyway. */
  | { state: 'ok-but'; note: string; fix: string }
  | { state: 'bad'; note: string; fix: string }
  /** Could not tell — the gateway is unreachable or misbehaving. */
  | { state: 'unknown'; note: string; fix: string };

/**
 * What an HTTP status from the probe means.
 *
 * Separated from the request so the interesting half can be tested without a
 * network, and so an unfamiliar status has one obvious place to be handled.
 */
export function verdict(status: number, detail = ''): KeyCheck {
  switch (status) {
    case 400:
      // The request we deliberately made invalid was rejected as invalid, which
      // means it got past authentication. That is the whole test.
      return { state: 'ok' };
    case 401:
      return {
        state: 'bad',
        note: 'The gateway did not recognise that key.',
        fix: 'Check it was copied whole, including the sk-vylo- prefix.',
      };
    case 402:
      return {
        state: 'ok-but',
        note: 'The key is valid, but the account has no active plan.',
        fix: 'Choose a plan at chat.vylo-tech.com, then it will work.',
      };
    case 403:
      return {
        state: 'ok-but',
        note: 'The key is valid, but the account is suspended.',
        fix: 'Contact support before using it.',
      };
    case 429:
      return {
        state: 'ok-but',
        note: 'The key is valid but is being rate limited right now.',
        fix: 'It will work again shortly.',
      };
    case 404:
      return {
        state: 'unknown',
        note: 'That address answered, but not like a Vylo gateway.',
        fix: 'Check the gateway address above.',
      };
    default:
      if (status >= 500) {
        return {
          state: 'unknown',
          note: `The gateway answered with ${status}.`,
          fix: 'This is the server, not the key — try again shortly.',
        };
      }
      return {
        state: 'unknown',
        note: detail || `Unexpected response (${status}).`,
        fix: 'The key may still be fine; save it and try a message.',
      };
  }
}

export async function checkKey(baseUrl: string, apiKey: string): Promise<KeyCheck> {
  if (!apiKey.trim()) {
    return { state: 'bad', note: 'No key entered.', fix: 'Paste the key from your Vylo account.' };
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(PROBE),
    });
  } catch {
    // A webview reports every network failure the same way, so this says what
    // to check rather than repeating "Load failed".
    return {
      state: 'unknown',
      note: `Could not reach ${baseUrl}.`,
      fix: 'Check the address and that you are online.',
    };
  }

  let detail = '';
  try {
    const body = await res.json() as { error?: { message?: string } };
    detail = body?.error?.message ?? '';
  } catch { /* not JSON; the status is enough */ }
  return verdict(res.status, detail);
}
