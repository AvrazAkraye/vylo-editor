import { invoke } from '@tauri-apps/api/core';

/**
 * The agent loop.
 *
 * This is the piece M0 existed to make possible. Before it, the gateway's
 * /v1/messages ignored a caller `tools` array entirely and `buildPrompt`
 * flattened the conversation into one string, dropping tool_use/tool_result
 * blocks — so hop two re-answered hop one forever and a loop was not
 * expressible. It now speaks native Anthropic tool calling, which is what the
 * `while (stop_reason === 'tool_use')` below relies on.
 */

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type Block =
  | { type: 'text'; text: string }
  | ImageBlock
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

export interface Msg {
  role: 'user' | 'assistant';
  content: string | Block[];
}

/**
 * Only read-only tools exist today. Writing files and running commands need
 * human approval, and until that UI exists the safest implementation of a
 * dangerous verb is not to ship it.
 */
export const TOOLS = [
  {
    name: 'list_tree',
    description:
      'List files and directories in the open folder. Use this first to orient yourself. Skips .git, node_modules, target, dist and similar.',
    input_schema: {
      type: 'object',
      properties: {
        max_entries: { type: 'integer', description: 'Cap on entries returned. Default 2000.' },
      },
    },
  },
  {
    name: 'read_file',
    description: 'Read one UTF-8 text file, relative to the open folder. Max 512 KB.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Path relative to the open folder.' } },
      required: ['path'],
    },
  },
  {
    name: 'search',
    description:
      'Find a literal substring across the open folder. Returns path, line number and the matching line. Not a regex.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to find.' },
        max_hits: { type: 'integer', description: 'Cap on hits. Default 200.' },
      },
      required: ['query'],
    },
  },
] as const;

const SYSTEM = [
  'You are Vylo Editor, a coding agent working on a folder on the user\'s own machine.',
  '',
  'Ground every claim in what you actually read. Use list_tree to orient yourself,',
  'search to locate things, and read_file before describing any code. Never guess at',
  'a file\'s contents, and never claim a file exists without having seen it in a tool',
  'result — the user can check, and a confident wrong answer costs more than a slow',
  'right one.',
  '',
  'You currently have read-only tools. You cannot edit files or run commands yet, so',
  'when a change is wanted, say precisely what you would change and where, rather',
  'than pretending to have done it.',
  '',
  '',
  'The user may attach images -- a screenshot of a bug, a design, an error dialog.',
  'Treat them as part of the question, and connect what you see to the actual code',
  'by going and reading it rather than describing the picture back to them.',
  '',
  'Be concise. Cite paths as path:line when you can.',
].join('\n');

/** Run one tool call against the local folder via the Rust side. */
async function runTool(root: string, call: ToolCall): Promise<{ content: string; isError: boolean }> {
  try {
    if (call.name === 'list_tree') {
      const entries = await invoke('list_tree', { root, maxEntries: call.input.max_entries ?? null });
      return { content: JSON.stringify(entries), isError: false };
    }
    if (call.name === 'read_file') {
      const text = await invoke('read_file', { root, path: String(call.input.path ?? '') });
      return { content: String(text), isError: false };
    }
    if (call.name === 'search') {
      const hits = await invoke('search', {
        root,
        query: String(call.input.query ?? ''),
        maxHits: call.input.max_hits ?? null,
      });
      return { content: JSON.stringify(hits), isError: false };
    }
    return { content: `Unknown tool: ${call.name}`, isError: true };
  } catch (e) {
    // A tool error is information the model can act on (wrong path, file too
    // big), so it goes back as a tool_result rather than aborting the turn.
    return { content: String(e), isError: true };
  }
}

export interface RunOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  root: string;
  history: Msg[];
  /** Called as the loop progresses so the UI can show work in flight. */
  onEvent: (e: { kind: 'text' | 'tool' | 'result'; text: string }) => void;
  /** Stop after this many model round-trips. A loop that will not terminate is a bill. */
  maxHops?: number;
}

export async function runAgent(o: RunOptions): Promise<Msg[]> {
  const messages: Msg[] = [...o.history];
  const maxHops = o.maxHops ?? 12;

  for (let hop = 0; hop < maxHops; hop++) {
    const res = await fetch(`${o.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': o.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: o.model,
        max_tokens: 4096,
        system: SYSTEM,
        tools: TOOLS,
        messages,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gateway ${res.status}: ${body.slice(0, 300)}`);
    }
    const reply = await res.json();
    const blocks: Block[] = Array.isArray(reply.content) ? reply.content : [];

    for (const b of blocks) {
      if (b.type === 'text' && b.text.trim()) o.onEvent({ kind: 'text', text: b.text });
    }
    messages.push({ role: 'assistant', content: blocks });

    const calls = blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (reply.stop_reason !== 'tool_use' || calls.length === 0) return messages;

    // Every tool_result for a turn goes back in ONE user message. Splitting them
    // across several would break the alternation the API expects, and trains the
    // model out of asking for calls in parallel.
    const results: Block[] = [];
    for (const c of calls) {
      o.onEvent({ kind: 'tool', text: `${c.name}(${JSON.stringify(c.input)})` });
      const r = await runTool(o.root, { id: c.id, name: c.name, input: c.input });
      o.onEvent({ kind: 'result', text: `${c.name} → ${r.isError ? 'error: ' : ''}${r.content.slice(0, 160)}` });
      results.push({ type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: r.isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }

  throw new Error(`Stopped after ${maxHops} hops without finishing.`);
}
