/**
 * Which failures are worth trying again, and how long to wait.
 *
 * A turn used to end at the first thing that went wrong. A dropped Wi-Fi
 * packet, a gateway restarting, an upstream 529 — each of them ended the turn
 * with a red line, and the only way forward was to retype the question. The
 * failures that deserve that treatment are the ones that will still be true in
 * two seconds; most of these are not.
 *
 * ## Retrying the wrong thing is worse than not retrying
 *
 * A bad key retried three times is three requests, three waits, and the same
 * answer with the useful message buried under two minutes of "trying again".
 * The split below is deliberately conservative: a 4xx means the request was
 * wrong and sending it again will not make it right, with two exceptions the
 * HTTP specification defines as temporary.
 */

/** Three attempts: the original and two retries. */
export const MAX_ATTEMPTS = 3;

/**
 * Longer than this and waiting is worse than reporting.
 *
 * A gateway that asks for a minute is not having a bad second; it is telling
 * you to come back later, and the honest response is to say so rather than to
 * leave someone watching a spinner for a minute with no idea why.
 */
export const MAX_WAIT = 10_000;

/**
 * Whether a response status is worth another attempt.
 *
 * `0` stands for never having got a status at all — the fetch itself threw,
 * which is a dropped connection, a DNS blip, or a gateway that was not
 * listening for a moment.
 */
export function retryable(status: number, detail = ''): boolean {
  if (status === 0) return true;
  // 408 Request Timeout and 429 Too Many Requests are the two 4xx the spec
  // itself describes as temporary. Every other 4xx says the request was wrong.
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  // A gateway that reports an upstream overload with the wrong status still
  // means the same thing.
  return status >= 400 ? /overloaded/i.test(detail) : false;
}

/**
 * The same question for an SSE `error` frame, which arrives mid-stream and
 * carries a type rather than a status.
 *
 * Matched on wording because that is all there is. Deliberately narrow: an
 * unrecognised error frame is reported, not retried, because a stream that
 * failed for a reason we do not understand is not one to send again.
 */
export function retryableMessage(text: string): boolean {
  return /overloaded|rate.?limit|too many requests|timeout|timed out|temporar|try again/i.test(text);
}

/**
 * Seconds, or an HTTP date, out of a `Retry-After` header.
 *
 * `now` is a parameter so this can be tested without waiting for a clock.
 */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return null;
  // A date in the past means "now", not a negative wait.
  return Math.max(0, when - now);
}

/**
 * How long before attempt `failed + 1`, or `-1` for "do not".
 *
 * Exponential from half a second, because the failures worth retrying are
 * mostly momentary and half a second is long enough for one. A `Retry-After`
 * overrides that entirely — the server knows something we do not — unless it
 * asks for longer than anyone should be left waiting without being told why.
 */
export function backoffMs(failed: number, retryAfter?: string | null, now = Date.now()): number {
  const asked = retryAfterMs(retryAfter, now);
  if (asked !== null) return asked > MAX_WAIT ? -1 : asked;
  return 500 * 2 ** (failed - 1);
}

/** A wait that ends early when the turn is stopped. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(id); signal?.removeEventListener('abort', done); resolve(); };
    const id = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
