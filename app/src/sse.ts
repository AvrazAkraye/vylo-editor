import type { Block } from './agent';
import { fold, NO_USAGE, type Usage } from './usage';

/**
 * Server-sent events, and the turn assembled out of them.
 *
 * Kept apart from the agent loop so it can be tested without a network: the
 * awkward parts here are all about fragmentation, and fragmentation is exactly
 * what a live connection will not reproduce on demand. A `tool_use` block's
 * arguments arrive as a run of JSON *fragments* that are individually invalid,
 * and a chunk boundary can land anywhere — mid-frame, mid-field, between the
 * two newlines that end a frame.
 */

/** Splits a byte stream into the JSON payloads of `data:` lines. */
export class SSEDecoder {
  private buf = '';

  decode(chunk: string): unknown[] {
    // Normalise line endings first so one frame separator matches everywhere.
    this.buf += chunk.replace(/\r\n/g, '\n');
    const out: unknown[] = [];
    let cut: number;
    while ((cut = this.buf.indexOf('\n\n')) !== -1) {
      const frame = this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut + 2);
      // The `event:` line is ignored: every Anthropic payload repeats its type
      // inside the JSON, and trusting one source is better than reconciling two.
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n');
      if (!data || data === '[DONE]') continue;
      try {
        out.push(JSON.parse(data));
      } catch {
        // A frame we cannot read is not a reason to abandon a turn that is
        // otherwise arriving fine.
      }
    }
    return out;
  }
}

interface Slot {
  index: number;
  kind: 'text' | 'tool_use';
  text: string;
  id: string;
  name: string;
  /** Concatenated `input_json_delta` fragments, parsed once the block closes. */
  json: string;
  input: Record<string, unknown>;
}

/** Rebuilds a message's content blocks from the event stream. */
export class TurnAssembler {
  private slots = new Map<number, Slot>();
  stopReason: string | null = null;
  error: string | null = null;
  /** Folded from every frame that carries it — see `fold` for why not summed. */
  usage: Usage = NO_USAGE;

  /** `onText` fires per delta, for rendering a reply as it is written. */
  push(ev: unknown, onText?: (t: string) => void): void {
    const e = ev as Record<string, any>;
    switch (e?.type) {
      case 'content_block_start': {
        const b = e.content_block ?? {};
        const index = Number(e.index ?? 0);
        this.slots.set(index, {
          index,
          kind: b.type === 'tool_use' ? 'tool_use' : 'text',
          text: typeof b.text === 'string' ? b.text : '',
          id: b.id ?? '',
          name: b.name ?? '',
          json: '',
          input: {},
        });
        break;
      }
      case 'content_block_delta': {
        const slot = this.slots.get(Number(e.index ?? 0));
        if (!slot) break;
        const d = e.delta ?? {};
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          slot.text += d.text;
          onText?.(d.text);
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          slot.json += d.partial_json;
        }
        break;
      }
      case 'content_block_stop': {
        const slot = this.slots.get(Number(e.index ?? 0));
        if (!slot || slot.kind !== 'tool_use') break;
        try {
          // A tool with no arguments sends no fragments at all, not "{}".
          slot.input = slot.json.trim() ? JSON.parse(slot.json) : {};
        } catch {
          throw new Error(
            `The model's arguments for ${slot.name || 'a tool'} arrived incomplete. `
            + 'This is usually a dropped connection — try again.',
          );
        }
        break;
      }
      case 'message_start':
        this.usage = fold(this.usage, e.message?.usage);
        break;
      case 'message_delta':
        if (e.delta?.stop_reason) this.stopReason = e.delta.stop_reason;
        this.usage = fold(this.usage, e.usage);
        break;
      case 'error':
        this.error = e.error?.message || 'The gateway reported an error mid-stream.';
        break;
      default:
        break;
    }
  }

  /**
   * The assembled blocks, in the order the API numbered them.
   *
   * Empty text blocks are dropped, but never the last one: a message with no
   * content at all is rejected on the next request, so an empty turn is better
   * represented as empty text than as nothing.
   */
  blocks(): Block[] {
    const all = [...this.slots.values()].sort((a, b) => a.index - b.index);
    const built: Block[] = all.map((s) =>
      s.kind === 'tool_use'
        ? { type: 'tool_use', id: s.id, name: s.name, input: s.input }
        : { type: 'text', text: s.text },
    );
    const kept = built.filter((b) => b.type !== 'text' || b.text.trim());
    return kept.length ? kept : built.slice(0, 1);
  }

  /**
   * What is safe to keep when a turn is cut short.
   *
   * Only text. A `tool_use` block with no matching `tool_result` makes the very
   * next request fail — so stopping mid-turn would poison the conversation
   * rather than end it.
   */
  partialText(): string {
    return [...this.slots.values()]
      .sort((a, b) => a.index - b.index)
      .filter((s) => s.kind === 'text')
      .map((s) => s.text)
      .join('');
  }
}
