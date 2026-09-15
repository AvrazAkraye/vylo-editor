/**
 * What a turn cost, in the unit the plans are actually sold in.
 *
 * Every plan is priced by tokens per month — 100k, 2M, 6M, 15M — so tokens are
 * the honest unit to show. A currency figure would mean hardcoding prices that
 * change, and would be a guess about someone else's billing.
 */

export interface Usage {
  input: number;
  output: number;
  /** Cached input, billed at roughly a tenth. Worth seeing separately. */
  cacheRead: number;
  cacheWrite: number;
}

export const NO_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * Fold a `usage` object from any frame into a running one, by taking the
 * larger of each field.
 *
 * Max, rather than assignment or addition, because the two streaming paths
 * report differently and this has to be right on both. With tools the gateway
 * relays Anthropic's frames verbatim: `message_start` carries the input count
 * and an output of 1, `message_delta` carries the final cumulative output.
 * Without tools the gateway synthesises the frames and `message_start` is all
 * zeros. Assignment would take the zeros; addition would count the input twice
 * and the partial output on top of the final. Max is correct for both, because
 * output only ever grows and input never changes.
 */
export function fold(into: Usage, raw: unknown): Usage {
  const u = raw as Record<string, unknown> | null | undefined;
  if (!u || typeof u !== 'object') return into;
  const n = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0);
  return {
    input: Math.max(into.input, n('input_tokens')),
    output: Math.max(into.output, n('output_tokens')),
    cacheRead: Math.max(into.cacheRead, n('cache_read_input_tokens')),
    cacheWrite: Math.max(into.cacheWrite, n('cache_creation_input_tokens')),
  };
}

/** Two turns' worth. Hops within a turn fold; turns add. */
export function add(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
  };
}

export const total = (u: Usage) => u.input + u.output;

/** `847`, `12.4k`, `1.2M` — narrow enough for a status bar. */
export function compact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  // A trailing `.0` says nothing, so `11.0k` reads as `11k` while `12.4k` keeps
  // its digit.
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '');
  if (n < 1_000_000) {
    const k = n / 1000;
    // One decimal right up to 100k, because the smallest plan is 100k a month
    // and at that scale the difference between 12k and 12.4k is four hundred
    // tokens of someone's allowance.
    return `${k < 100 ? trim(k) : Math.round(k)}k`;
  }
  const m = n / 1_000_000;
  return `${m < 10 ? trim(m) : Math.round(m)}M`;
}

/** One line for the status bar: what the last turn used. */
export function summarise(u: Usage): string {
  if (!total(u)) return '';
  const cached = u.cacheRead > 0 ? ` (${compact(u.cacheRead)} cached)` : '';
  return `${compact(u.input)}${cached} in · ${compact(u.output)} out`;
}

/* ── across a project ─────────────────────────────────────────────────────
   The status bar answers "what did that turn cost". These answer "what has
   this project cost", which is the question somebody watching an allowance
   actually has. */

/** Anything carrying a recorded cost. `Chat` in `store.ts` is the one that does;
 *  the shape is restated here so this module keeps having no imports. */
export interface Spent {
  tokens?: Partial<Usage>;
}

/** A record from disk, with anything missing or nonsensical read as zero. */
const figure = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const figures = (t: Partial<Usage>): Usage => ({
  input: figure(t.input), output: figure(t.output),
  cacheRead: figure(t.cacheRead), cacheWrite: figure(t.cacheWrite),
});

/**
 * Every chat's tokens, added up.
 *
 * Chats written before tokens were recorded carry none and contribute nothing.
 * That is not the same as having cost nothing, which is why `counted` exists:
 * a total is only honest beside the number of chats it was drawn from.
 */
export function across(chats: readonly Spent[]): Usage {
  return chats.reduce((sum, c) => (c.tokens ? add(sum, figures(c.tokens)) : sum), NO_USAGE);
}

/** How many of them actually carried a figure. The rest are unknown, not zero. */
export function counted(chats: readonly Spent[]): number {
  return chats.filter((c) => c.tokens && total(figures(c.tokens)) > 0).length;
}

/**
 * The chats that cost the most, dearest first.
 *
 * Chats with nothing recorded are left out rather than sorted to the bottom.
 * A list of zeros answers no question, and it would put the oldest chats —
 * the ones from before this was recorded — at the end of a list titled by
 * cost, which reads as a claim that they were cheap.
 */
export function heaviest<T extends Spent>(chats: readonly T[], top: number): { chat: T; used: number }[] {
  return chats
    .map((chat) => ({ chat, used: chat.tokens ? total(figures(chat.tokens)) : 0 }))
    .filter((r) => r.used > 0)
    .sort((a, b) => b.used - a.used)
    .slice(0, Math.max(0, top));
}

/**
 * A percentage for a bar, or null when there is no ceiling to measure against.
 *
 * Null rather than zero on an unmetered plan: a bar drawn at zero says the
 * allowance is untouched, which is a different claim and a false one. The
 * header's rule about wrong figures applies hardest to the one that looks
 * like money.
 */
export function percentOf(part: number, ceiling: number | null | undefined): number | null {
  if (typeof ceiling !== 'number' || !Number.isFinite(ceiling) || ceiling <= 0) return null;
  if (!Number.isFinite(part) || part < 0) return 0;
  return Math.min(100, Math.round((part / ceiling) * 100));
}
