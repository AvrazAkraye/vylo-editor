/**
 * Speaking OpenAI's dialect, for providers that do.
 *
 * The app thinks in Anthropic's Messages shape — content blocks, `tool_use`
 * and `tool_result`, one system string — because the agent loop was built
 * against it and eight tools and a review pipeline hang off it. Every provider
 * worth adding speaks one of two dialects: that one, or OpenAI's chat
 * completions, which the rest of the industry adopted as its lingua franca —
 * Blackbox, OpenRouter, Groq, DeepSeek, Together, Mistral, Ollama and LM
 * Studio are all the second.
 *
 * So the app keeps thinking in one shape and this file translates at the wire:
 * `toOpenAI` turns the request the loop already builds into a chat-completions
 * body, and `OpenAIAssembler` turns the streamed reply back into the blocks the
 * loop already reads. Nothing outside `agent.ts`/`inline.ts` learns a second
 * format existed — which is the point, because a second format that leaks
 * inward is a second agent loop.
 *
 * ## The three places the dialects genuinely differ
 *
 * **Tool results live in different homes.** Anthropic puts `tool_result`
 * blocks inside the next *user* message; OpenAI wants each as its own
 * `role:"tool"` message, directly after the assistant turn that called it. So
 * one Anthropic user message can become several OpenAI messages, and the tool
 * ones must come *first* — the text somebody typed alongside them stays a user
 * message after.
 *
 * **Tool calls stream as fragments keyed by index.** Anthropic frames say
 * which block a delta belongs to; OpenAI's `delta.tool_calls` carry an `index`,
 * a name that arrives once, and argument strings that arrive in pieces to be
 * concatenated. The id can arrive on a later fragment than the name. The
 * assembler keys everything by index and settles nothing until the stream ends.
 *
 * **Usage arrives once, at the end, and only if asked for.** `stream_options:
 * {include_usage: true}` makes the final chunk carry it; providers that do not
 * support the option simply omit usage, and the turn reports zero rather than
 * failing — a bill that reads low is recoverable, a turn that errors is not.
 */

import { NO_USAGE, fold, type Usage } from './usage';
// Type-only, so there is no runtime cycle: agent.ts imports this file's
// functions, and this file only borrows its shapes.
import type { Block, Msg } from './agent';

/** Loose views of the two dialects. Structural, because wires are. */
type Dict = Record<string, unknown>;

/** A block as this file reads it: the loop's union, viewed structurally. */
type ABlock = { type: string } & Dict;

export interface ARequest {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: readonly unknown[];
  messages: readonly Msg[];
  stream?: boolean;
}

const asBlocks = (content: string | readonly Block[]): ABlock[] =>
  typeof content === 'string'
    ? [{ type: 'text', text: content }]
    // The union is read dynamically from here on; translation is inherently
    // structural and the tests pin every field that comes out the other side.
    : (content as unknown as ABlock[]);

/** One Anthropic tool declaration → one OpenAI function declaration. */
function toTool(raw: unknown): Dict {
  const t = (raw ?? {}) as Dict;
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      // Same JSON Schema either side; only the envelope key differs.
      parameters: t.input_schema ?? { type: 'object', properties: {} },
    },
  };
}

/**
 * The whole request, translated.
 *
 * `max_tokens` rather than `max_completion_tokens`: OpenAI still accepts the
 * old name everywhere the new one exists, and the compatibles — which are most
 * of what this is for — mostly only know the old one.
 */
export function toOpenAI(a: ARequest): Dict {
  const messages: Dict[] = [];
  if (a.system?.trim()) messages.push({ role: 'system', content: a.system });

  for (const m of a.messages) {
    const blocks = asBlocks(m.content);

    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text')
        .map((b) => String(b.text ?? '')).join('');
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: String(b.id ?? ''),
        type: 'function',
        function: { name: String(b.name ?? ''), arguments: JSON.stringify(b.input ?? {}) },
      }));
      // `''` when there are no calls: this dialect accepts empty string
      // content and rejects null-without-tool_calls — and an empty assistant
      // turn does reach history when a provider replies with nothing.
      const out: Dict = { role: 'assistant', content: text || (calls.length ? null : '') };
      if (calls.length) out.tool_calls = calls;
      messages.push(out);
      continue;
    }

    // A user message. Tool results leave it and become `role:"tool"` messages,
    // placed first so they sit directly after the assistant turn that called
    // them — which is where OpenAI requires them to be.
    const rest: Dict[] = [];
    for (const b of blocks) {
      if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? '');
        messages.push({
          role: 'tool',
          tool_call_id: String(b.tool_use_id ?? ''),
          // This dialect has no error flag on a tool result, so the flag
          // becomes a word the model can read. Not added twice: most error
          // results already begin with one.
          content: b.is_error && !/^error/i.test(text.trimStart()) ? `Error: ${text}` : text,
        });
        continue;
      }
      if (b.type === 'text') {
        // An image-only message rides with an empty text block in this app,
        // and OpenAI rejects an empty text part outright. The image is the
        // message; the empty string is packaging.
        const text = String(b.text ?? '');
        if (text) rest.push({ type: 'text', text });
        continue;
      }
      if (b.type === 'image') {
        const src = (b.source ?? {}) as Dict;
        rest.push({
          type: 'image_url',
          image_url: { url: `data:${src.media_type ?? 'image/png'};base64,${src.data ?? ''}` },
        });
        continue;
      }
      if (b.type === 'document') {
        // This dialect has no document encoding. Dropping the block silently
        // asked the model to discuss a file it never received — and it would
        // answer that it sees no document, which reads as the app being
        // broken. A sentence saying what happened is the honest translation.
        rest.push({ type: 'text', text: '[A PDF was attached, but this provider cannot read documents. Its contents were not sent.]' });
        continue;
      }
      // A block only the other dialect has. Flattened to its text if it has
      // any, dropped if not, because inventing an encoding the provider will
      // 400 on helps nobody.
      if (typeof b.text === 'string' && b.text) rest.push({ type: 'text', text: b.text });
    }
    if (rest.length) {
      // A single text part collapses to a plain string, which every provider
      // accepts — content-parts arrays are still rejected by some compatibles
      // unless images force the issue.
      const only = rest.length === 1 && rest[0].type === 'text';
      messages.push({ role: m.role, content: only ? (rest[0].text as string) : rest });
    }
  }

  const out: Dict = {
    model: a.model,
    max_tokens: a.max_tokens,
    messages,
  };
  if (a.tools?.length) out.tools = a.tools.map(toTool);
  if (a.stream) {
    out.stream = true;
    out.stream_options = { include_usage: true };
  }
  return out;
}

/** OpenAI's finish reasons, in Anthropic's words — which the loop switches on. */
export function stopReasonOf(finish: unknown): string | null {
  switch (finish) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': case 'function_call': return 'tool_use';
    case 'content_filter': return 'end_turn';
    default: return typeof finish === 'string' ? finish : null;
  }
}

/** OpenAI usage → the Anthropic field names `usage.ts` folds. */
export function usageOf(u: unknown): Dict {
  const d = (u ?? {}) as Dict;
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  const details = (d.prompt_tokens_details ?? {}) as Dict;
  const cached = n(details.cached_tokens);
  return {
    // This dialect's prompt count INCLUDES the cached tokens; Anthropic's
    // input excludes its cache reads. The app totals input + cacheRead, so
    // passing the count through unchanged would bill the cached part twice on
    // one wire and once on the other for identical work.
    input_tokens: Math.max(0, n(d.prompt_tokens) - cached),
    output_tokens: n(d.completion_tokens),
    cache_read_input_tokens: cached,
  };
}

/**
 * Streamed chat-completion chunks, assembled into Anthropic-shaped blocks.
 *
 * The same read surface as `TurnAssembler` — `push(ev, onText)`, `blocks()`,
 * `stopReason`, `usage`, `error` — so `runAgent` consumes either without
 * knowing which it has.
 */
export class OpenAIAssembler {
  private text = '';
  /** Fragments per tool call, keyed by the index OpenAI keys them by. */
  private calls = new Map<number, { id: string; name: string; args: string }>();
  stopReason: string | null = null;
  /**
   * Folded, exactly as `TurnAssembler.usage` is. The loop does
   * `add(spent, assembler.usage)`, and `add` sums the folded field names — a
   * raw wire dict here would sum as zeros, silently, which is the kind of bug
   * a bill is the first report of.
   */
  usage: Usage = NO_USAGE;
  error: string | null = null;

  /** What has streamed so far. Read when a stop keeps the half-written reply. */
  partialText(): string {
    return this.text;
  }

  push(ev: unknown, onText: (t: string) => void): void {
    const e = (ev ?? {}) as Dict;

    // Providers stream errors as a chunk with the standard envelope.
    const err = e.error as Dict | undefined;
    if (err && typeof err.message === 'string') {
      this.error = err.message;
      return;
    }

    if (e.usage) this.usage = fold(this.usage, usageOf(e.usage));

    const choice = (Array.isArray(e.choices) ? e.choices[0] : undefined) as Dict | undefined;
    if (!choice) return;

    if (choice.finish_reason != null) {
      this.stopReason = stopReasonOf(choice.finish_reason);
    }

    const delta = (choice.delta ?? {}) as Dict;
    if (typeof delta.content === 'string' && delta.content) {
      this.text += delta.content;
      onText(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const raw of delta.tool_calls) {
        const c = (raw ?? {}) as Dict;
        // The index is the identity. The id and even the name can arrive on a
        // later fragment than the first, so everything merges into the slot
        // rather than creating it once.
        const at = typeof c.index === 'number' ? c.index : 0;
        const slot = this.calls.get(at) ?? { id: '', name: '', args: '' };
        if (typeof c.id === 'string' && c.id) slot.id = c.id;
        const fn = (c.function ?? {}) as Dict;
        if (typeof fn.name === 'string' && fn.name) slot.name += fn.name;
        if (typeof fn.arguments === 'string') slot.args += fn.arguments;
        this.calls.set(at, slot);
      }
    }
  }

  /**
   * The turn, in the blocks the loop reads.
   *
   * Argument JSON is parsed here, once the stream is over, because it arrives
   * in fragments that are only a document when they are all present. An empty
   * string is `{}` — a tool with no arguments streams nothing at all — and
   * JSON that will not parse throws the same sentence `TurnAssembler` throws,
   * so the retry path upstream treats both dialects alike.
   */
  blocks(): Block[] {
    const out: Block[] = [];
    if (this.text) out.push({ type: 'text', text: this.text });
    // An entirely empty reply — a filter, a dead stream — still has to leave
    // one block, or `content: []` lands in history and every later request is
    // rejected on either wire. TurnAssembler keeps one for the same reason.
    if (!this.text && !this.calls.size) return [{ type: 'text', text: '' }];
    const ordered = [...this.calls.entries()].sort((a, b) => a[0] - b[0]);
    for (const [at, c] of ordered) {
      let input: unknown = {};
      if (c.args.trim()) {
        try { input = JSON.parse(c.args); } catch {
          throw new Error(`The model's arguments for ${c.name || 'a tool'} arrived incomplete.`);
        }
      }
      out.push({
        type: 'tool_use',
        // Some compatibles omit ids entirely; the loop echoes this id back in
        // the tool_result, so it has to exist and only has to be unique.
        id: c.id || `call_${at}`,
        name: c.name,
        input: (input ?? {}) as Record<string, unknown>,
      });
    }
    // Both directions, because both lies happen. "tool_calls" with nothing
    // parsable would loop for ever upstream, so it becomes end_turn. And some
    // compatibles finish with "stop" despite having streamed calls — leaving
    // those unrun would put tool_use blocks with no tool_result into history,
    // which poisons every later request in the conversation.
    if (this.stopReason === 'tool_use' && !ordered.length) this.stopReason = 'end_turn';
    if (ordered.length && this.stopReason !== 'tool_use') this.stopReason = 'tool_use';
    return out;
  }
}

/**
 * A non-streamed reply, translated whole.
 *
 * The same shape `runAgent`'s fallback branch reads off an Anthropic response:
 * `content`, `stop_reason`, `usage`.
 */
export function fromOpenAI(reply: unknown): { content: Block[]; stop_reason: string | null; usage: Dict } {
  const r = (reply ?? {}) as Dict;
  const choice = (Array.isArray(r.choices) ? r.choices[0] : {}) as Dict;
  const msg = (choice.message ?? {}) as Dict;

  const content: Block[] = [];
  if (typeof msg.content === 'string' && msg.content) {
    content.push({ type: 'text', text: msg.content });
  } else if (Array.isArray(msg.content)) {
    // A compatible that answers in content parts. Text is text.
    for (const part of msg.content) {
      const q = (part ?? {}) as Dict;
      if (q.type === 'text' && typeof q.text === 'string' && q.text) {
        content.push({ type: 'text', text: q.text });
      }
    }
  }
  if (Array.isArray(msg.tool_calls)) {
    msg.tool_calls.forEach((raw, at) => {
      const c = (raw ?? {}) as Dict;
      const fn = (c.function ?? {}) as Dict;
      let input: unknown = {};
      const args = typeof fn.arguments === 'string' ? fn.arguments : '';
      if (args.trim()) {
        // The same sentence the streamed path throws, so a broken provider
        // fails the same visible way on both — quietly substituting {} here
        // would run a tool with arguments its caller never wrote.
        try { input = JSON.parse(args); } catch {
          throw new Error(`The model's arguments for ${typeof fn.name === 'string' ? fn.name : 'a tool'} arrived incomplete.`);
        }
      }
      content.push({
        type: 'tool_use',
        id: typeof c.id === 'string' && c.id ? c.id : `call_${at}`,
        name: typeof fn.name === 'string' ? fn.name : '',
        input: (input ?? {}) as Record<string, unknown>,
      });
    });
  }
  const stop = stopReasonOf(choice.finish_reason);
  const hasCalls = content.some((b) => b.type === 'tool_use');
  return {
    content: content.length ? content : [{ type: 'text', text: '' }],
    // The same bidirectional guard the assembler applies.
    stop_reason: hasCalls ? 'tool_use' : (stop === 'tool_use' ? 'end_turn' : stop),
    usage: usageOf(r.usage),
  };
}
