/**
 * One request, one answer, brought home through whatever goes wrong on the way.
 *
 * Research writes a document a section at a time: a plan, an outline, then one
 * request per section and one for the abstract. A master's thesis is thirty
 * of them, sent one after another over most of an hour. Neither of the two
 * request paths the app already had is shaped for that.
 *
 * **The agent loop** (`agent.ts`) is a conversation with tools. It carries the
 * coding agent's system prompt, the tool schema, compaction and hops. Research
 * wants none of that, and must not have the tools: the model writing a thesis
 * has no business staging a file or asking to run a command, and the rule that
 * keeps model output off the disk is easiest to keep when the capability is
 * simply absent from the request.
 *
 * **⌘K's `askRaw`** (`inline.ts`) is the right shape — a system prompt, one
 * user message, a streamed reply — but it gives up at the first failure, sends
 * no effort, and throws away the stop reason and the usage. For ⌘K that is
 * fine: the person is watching and presses the key again. For a document it is
 * not. A 529 at section nineteen would end the run, and a section that ran out
 * of room would come back looking finished.
 *
 * So this is `askRaw` with the agent loop's recovery, built from the same
 * pieces: `providers.ts` for where and with which key, `openai.ts` for the
 * other dialect, `sse.ts` for the stream, `retry.ts` for what is worth trying
 * again and how long to wait, `limits.ts` for the limits a refusal names,
 * `effort.ts` for how hard the model thinks.
 *
 * ## What comes back is the answer, and only the answer
 *
 * - **Text, never thinking.** With effort on, the model thinks before it
 *   writes. That thinking is billed, but it is not the document, and a
 *   paragraph of it pasted into chapter two would be the worst kind of wrong:
 *   plausible. Only text blocks reach `onText` or the returned text.
 * - **Nor a server tool's blocks.** A request may carry server tools (the
 *   optional `tools`, Anthropic wire only — the Video module's web search).
 *   Their `server_tool_use` and `web_search_tool_result` blocks are the
 *   provider's working, not the answer, and are dropped the same way.
 * - **The stop reason, in one spelling.** `max_tokens` means the section ran
 *   out of room and is to be continued rather than trusted. The OpenAI dialect
 *   calls that `length`, and a caller that checked for one word would miss the
 *   other, so both arrive as `max_tokens`.
 * - **The usage, all of it.** A stream that broke halfway was still paid for,
 *   so what it spent is counted with the attempt that succeeded.
 *
 * ## What is tried again
 *
 * The agent loop's rules, for its reasons (see `retry.ts`): a dropped
 * connection, a 5xx or 529, a 408 or 429 — waiting as long as `Retry-After`
 * asks, and giving up when it asks for longer than anyone should wait without
 * being told why. A 400 that names the model's real output limit is learned and
 * the request is corrected and sent again, once per kind, without spending an
 * attempt. An `error` frame partway through the stream that says overload or
 * rate limit is asked for again from the start — and `onRestart` fires first,
 * because the caller has been showing the half that arrived, and the second
 * attempt starts from nothing.
 *
 * Stopping is not a failure. When the signal fires the call ends at once with
 * the platform's `AbortError`, even if the connection underneath is slow to
 * notice.
 *
 * The errors are the agent loop's own sentences, so `errors.ts` gives the
 * same advice about a rejected key here as it does in the chat.
 *
 * ## A PDF is a block, and only one dialect has one
 *
 * The user message is usually a string. To read a PDF the researcher attached
 * it is content blocks instead — the file as a `document` block and the words
 * about it as `text` — which the Anthropic wire carries as they are. The
 * OpenAI dialect has no document block, and `openai.ts` translates one into a
 * sentence saying it was left out: right for a chat, where the person reads
 * the answer, and wrong here, where the answer is stored as the researcher's
 * data. A transcription of a file the model never saw is not a transcription.
 * So a PDF on that wire is refused before anything is sent, and text-only
 * blocks are joined into the plain string every provider accepts.
 */

import { SSEDecoder, TurnAssembler } from './sse';
import { OpenAIAssembler, fromOpenAI, toOpenAI } from './openai';
import { endpointFor, headersFor, type Wire } from './providers';
import { add, fold, NO_USAGE, type Usage } from './usage';
import { limitsFor } from './budget';
import { learn, learnedFor, parseLimitError, type Learned, type LimitKind } from './limits';
import { MAX_ATTEMPTS, backoffMs, pause, retryable, retryableMessage } from './retry';
import { effortField, type EffortBook } from './effort';

/**
 * Where a request goes, with which key, in which dialect, to which model.
 *
 * The same four fields as App's `wired`, which is derived in one place so that
 * a key only ever travels to the address it was entered beside. Pass that
 * object whole; do not assemble one here from parts.
 */
export interface Target {
  baseUrl: string;
  apiKey: string;
  wire: Wire;
  model: string;
}

/** What one request produced. */
export interface Generated {
  /** The answer's text blocks, joined. Never thinking. */
  text: string;
  /**
   * Why the model stopped: `end_turn`, `max_tokens` (out of room — continue it,
   * on either wire), or whatever else the provider said. `null` when the reply
   * ended without saying.
   */
  stopReason: string | null;
  /** Every attempt this call paid for, including a stream that broke. */
  usage: Usage;
}

/**
 * What a stop is thrown as.
 *
 * The platform's `AbortError`, which is what `fetch` itself throws, so a caller
 * tells a stop from a failure the way it would anywhere else. A signal aborted
 * with a reason of its own still produces one: the caller asked for a stop, and
 * the reason is theirs to keep.
 */
function stopped(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  return new DOMException('The request was stopped.', 'AbortError');
}

/** The useful part of an error body: the API's message, or the start of whatever came. */
function detailOf(body: string): string {
  let detail = body.slice(0, 300);
  try {
    const j = JSON.parse(body);
    if (typeof j?.error?.message === 'string' && j.error.message) detail = j.error.message;
  } catch { /* not JSON; the raw body is the best there is */ }
  return detail;
}

/**
 * A filter over Anthropic stream frames that lets only text blocks through.
 *
 * `TurnAssembler` already ignores `thinking_delta`, so thinking would not reach
 * the text today. This does not rely on that. The gateway synthesises the
 * frames itself on some paths, and a thinking block whose deltas arrived
 * labelled as text would otherwise be written into the document. A block is
 * judged once, by the type its `content_block_start` declares, and every frame
 * of a block that is not text is dropped before the assembler sees it.
 */
function textBlocksOnly(): (ev: unknown) => boolean {
  const dropped = new Set<number>();
  return (ev) => {
    const e = (ev ?? {}) as { type?: unknown; index?: unknown; content_block?: { type?: unknown } };
    const index = Number(e.index ?? 0);
    if (e.type === 'content_block_start') {
      const kind = e.content_block?.type;
      if (kind !== undefined && kind !== 'text') {
        dropped.add(index);
        return false;
      }
      dropped.delete(index);
      return true;
    }
    if (e.type === 'content_block_delta' || e.type === 'content_block_stop') return !dropped.has(index);
    return true;
  };
}

/**
 * Read a streamed body to its end, handing over each decoded frame.
 *
 * Each read is raced against the signal. A webview's fetch errors the body
 * when the request is aborted, but a proxy or a slow network layer can take
 * its time about it, and a Stop button that works a minute later has not
 * worked. So the stop is noticed here, and the body is cancelled on the way
 * out.
 */
async function drain(
  body: ReadableStream<Uint8Array>, push: (ev: unknown) => void, signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new SSEDecoder();
  const utf8 = new TextDecoder();
  let detach = () => {};
  const stop = new Promise<never>((_, reject) => {
    if (!signal) return;
    const on = () => reject(stopped(signal));
    if (signal.aborted) { on(); return; }
    signal.addEventListener('abort', on, { once: true });
    detach = () => signal.removeEventListener('abort', on);
  });
  // Handled here so a stop that lands between two reads is never reported as
  // unhandled; the race below is what actually reads it.
  stop.catch(() => {});
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), stop]);
      if (done) break;
      // stream:true keeps a multi-byte character — every Arabic letter is two
      // bytes — intact across a chunk boundary.
      for (const ev of decoder.decode(utf8.decode(value, { stream: true }))) push(ev);
    }
  } finally {
    detach();
    if (signal?.aborted) void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* a read still pending on a body that ignored the stop */ }
  }
}

/**
 * One user message: a string, or content blocks — a PDF and the words about it.
 * The document block is the agent loop's `DocumentBlock`, spelled out so this
 * file borrows no types from the loop it exists to stay apart from.
 */
type UserContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'document'; source: { type: 'base64'; media_type: 'application/pdf'; data: string } }
>;

/** What the OpenAI dialect says to a PDF, before any request is made. */
const NO_PDF = 'This provider cannot read a PDF. Save the PDF as text or as a Word file, and attach that.';

/** And to server tools, which only the Anthropic wire carries. */
const NO_TOOLS = 'This provider cannot run server tools such as web search.';

/** An error that also says which HTTP status it came from. */
function withStatus(e: Error, status: number): Error & { status: number } {
  return Object.assign(e, { status });
}

/**
 * The user message as the wire carries it: blocks as given on the Anthropic
 * wire; on the other, a refusal for a PDF and one string for text blocks,
 * separated by a blank line as two paragraphs would be.
 */
function userFor(wire: Wire, user: UserContent): UserContent {
  if (typeof user === 'string' || wire === 'anthropic') return user;
  if (user.some((b) => b.type === 'document')) throw new Error(NO_PDF);
  return user.map((b) => (b.type === 'text' ? b.text : '')).filter((t) => t !== '').join('\n\n');
}

/**
 * `length` is the OpenAI dialect's `max_tokens`. `openai.ts` already translates
 * it on that wire; this catches an Anthropic-shaped proxy in front of an
 * OpenAI-shaped model that relays the word unchanged. One word, whichever wire.
 */
const stopReasonOf = (r: string | null): string | null => (r === 'length' ? 'max_tokens' : r);

/**
 * Ask once, stream the answer, and come back with its text, why it stopped,
 * and what it cost.
 *
 * `maxTokens` is lowered to what the model is known to accept — from the table
 * in `budget.ts`, or from a limit an earlier refusal named — and never raised.
 * `onText` receives the answer as it is written; after `onRestart` the caller
 * should throw away what it has been shown, because the next deltas start the
 * answer again. `onRetry` reports the attempt about to be made, of how many,
 * and how long it will wait first.
 *
 * `user` may be content blocks, to hand the model a PDF; on the OpenAI wire a
 * PDF is refused before any request, with a sentence that says what to attach
 * instead.
 *
 * Throws an `AbortError` when `signal` fires, and otherwise an `Error` whose
 * message is the agent loop's for the same failure.
 */
export async function generate(gw: Target, o: {
  system: string;
  user: UserContent;
  maxTokens?: number;
  efforts?: EffortBook;
  onText?: (delta: string) => void;
  onRetry?: (attempt: number, of: number, waitMs: number) => void;
  onRestart?: () => void;
  signal?: AbortSignal;
  /**
   * Server tools the provider runs itself — Anthropic's web search, say —
   * sent as they are. Anthropic wire only: on the other a request with tools
   * is refused before it is sent, because an answer from a model that never
   * had the tool it was asked to use is not an answer. Never a tool the app
   * would have to carry out: nothing here runs what a model asks for.
   */
  tools?: readonly unknown[];
}): Promise<Generated> {
  const wire: Wire = gw.wire === 'openai' ? 'openai' : 'anthropic';
  // One record for both, as everywhere: the key goes where its URL goes.
  const url = endpointFor({ baseUrl: gw.baseUrl, wire });
  const headers = headersFor({ wire, key: gw.apiKey });
  const onText = (t: string) => o.onText?.(t);
  // Before the loop: a request that can never succeed is not sent, not even once.
  const user = userFor(wire, o.user);
  const tools = Array.isArray(o.tools) && o.tools.length ? [...o.tools] : null;
  if (tools && wire !== 'anthropic') throw new Error(NO_TOOLS);

  // What the model has already told us about itself wins over the table.
  let learned: Learned = learnedFor(gw.model);
  const wanted = typeof o.maxTokens === 'number' && Number.isFinite(o.maxTokens) && o.maxTokens >= 1
    ? Math.floor(o.maxTokens)
    : Infinity;
  const budget = () => Math.min(wanted, limitsFor(gw.model, learned).maxOutput);

  /**
   * Limit kinds already corrected in this call. One correction per kind, so a
   * gateway that keeps naming the same number cannot turn a refusal into a
   * loop.
   */
  const corrected = new Set<LimitKind>();
  let spent: Usage = NO_USAGE;

  for (let attempt = 1; ; attempt++) {
    if (o.signal?.aborted) throw stopped(o.signal);
    /** How long to wait before going round again, or -1 when this is as far as it goes. */
    const again = (worth: boolean, header?: string | null) =>
      (worth && attempt < MAX_ATTEMPTS ? backoffMs(attempt, header) : -1);
    const wait = async (ms: number) => {
      o.onRetry?.(attempt + 1, MAX_ATTEMPTS, ms);
      await pause(ms, o.signal);
    };

    const sentTokens = budget();
    const asked = {
      model: gw.model,
      max_tokens: sentTokens,
      system: o.system,
      messages: [{ role: 'user' as const, content: user }],
      stream: true,
      // Spread, so a model that takes no effort gets no field at all — Haiku
      // answers the field with a 400.
      ...effortField(wire, o.efforts ?? {}, gw.model),
      // Spread for the same reason: a request without tools is the request
      // every caller before this field sent, byte for byte.
      ...(tools ? { tools } : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        signal: o.signal,
        headers,
        body: JSON.stringify(wire === 'anthropic' ? asked : toOpenAI(asked)),
      });
    } catch (e) {
      if (o.signal?.aborted) throw stopped(o.signal);
      const ms = again(retryable(0));
      if (ms >= 0) { await wait(ms); continue; }
      throw new Error(
        `Could not reach ${gw.baseUrl}. `
        + 'Check the address in Settings, that you are online, and that the gateway allows this app '
        + `(the underlying error was: ${e instanceof Error ? e.message : String(e)}).`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (o.signal?.aborted) throw stopped(o.signal);
      const detail = detailOf(body);

      // A 400 that names the model's real limit is the one authoritative
      // statement of it anywhere. Keep it, for this call and every later one,
      // and send the request again corrected — unless the correction changes
      // nothing we send, because an identical request earns an identical 400.
      // Only on 400: a 429 talks about a minute, not about a model.
      const named = res.status === 400 ? parseLimitError(detail) : null;
      if (named && !corrected.has(named.kind)) {
        corrected.add(named.kind);
        if (learned[named.kind] !== named.value) {
          // Persisting can fail and this call does not care: `learned` is
          // what corrects the request.
          learn(gw.model, named);
          learned = { ...learned, [named.kind]: named.value };
        }
        if (budget() !== sentTokens) {
          // Not a failed attempt. The request was well formed and one number
          // in it was wrong; charging it to the retry budget would leave the
          // corrected request one try short against a dropped connection.
          attempt -= 1;
          continue;
        }
      }

      const ms = again(retryable(res.status, detail), res.headers.get('retry-after'));
      if (ms >= 0) { await wait(ms); continue; }
      // The status rides along, so a caller can tell "this is not offered
      // here" (a 4xx) from a network that failed, without reading sentences.
      if (res.status === 401) throw withStatus(new Error(`The API key was rejected. Check it in Settings. (${detail})`), res.status);
      if (res.status === 429) throw withStatus(new Error(`Rate limited — wait a moment. (${detail})`), res.status);
      throw withStatus(new Error(`The server answered ${res.status}: ${detail}`), res.status);
    }

    if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
      const asm = wire === 'anthropic' ? new TurnAssembler() : new OpenAIAssembler();
      // The other dialect streams reasoning under its own field names, which
      // `OpenAIAssembler` never reads; only `delta.content` becomes text.
      const keep = wire === 'anthropic' ? textBlocksOnly() : () => true;
      let broke: unknown = null;
      try {
        await drain(res.body, (ev) => { if (keep(ev)) asm.push(ev, onText); }, o.signal);
      } catch (e) {
        if (o.signal?.aborted) throw stopped(o.signal);
        broke = e;
      }
      // A connection that died partway, or an `error` frame from the API.
      // Neither is refunded, so both are counted before deciding.
      spent = add(spent, asm.usage);
      const failure = broke ? String(broke) : asm.error;
      if (failure) {
        const ms = again(broke ? true : retryableMessage(failure));
        if (ms >= 0) {
          // The half that arrived is on screen. Asking again without saying so
          // would print the answer twice, one incomplete copy above the other.
          o.onRestart?.();
          await wait(ms);
          continue;
        }
        throw broke instanceof Error ? broke : new Error(failure);
      }
      return { text: asm.partialText(), stopReason: stopReasonOf(asm.stopReason), usage: spent };
    }

    // A gateway that does not stream still answers.
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (e) {
      if (o.signal?.aborted) throw stopped(o.signal);
      throw e;
    }
    const reply = (wire === 'anthropic' ? raw : fromOpenAI(raw)) as {
      content?: unknown; stop_reason?: unknown; usage?: unknown;
    };
    const text = (Array.isArray(reply?.content) ? reply.content : [])
      .filter((b: { type?: unknown; text?: unknown }) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: { text: string }) => b.text)
      .join('');
    if (text) onText(text);
    spent = add(spent, fold(NO_USAGE, reply?.usage));
    const stop = typeof reply?.stop_reason === 'string' ? reply.stop_reason : null;
    return { text, stopReason: stopReasonOf(stop), usage: spent };
  }
}
