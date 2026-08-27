import { invoke } from '@tauri-apps/api/core';
import type { Pending } from './pending';

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
 * The tools the model is given.
 *
 * The two dangerous verbs are both indirect. `write_file` / `edit_file` stage a
 * result for review, and `run_command` suspends the loop until a human approves
 * the exact string. Neither `apply_write` nor the Rust `run_command` appear in
 * this list, so they cannot be reached by a tool call however the model is
 * prompted — the gate is a missing capability, not an instruction.
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
    name: 'write_file',
    description:
      'Propose the full new contents of a file, creating it if it does not exist. The change is STAGED for the user to review as a diff — it is not written until they approve it. Prefer edit_file for a small change to a large file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the open folder.' },
        content: { type: 'string', description: 'The complete new contents of the file.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Propose replacing an exact string in a file. old_string must match exactly once, including whitespace and indentation — include surrounding lines to make it unique. STAGED for review; not written until approved.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the open folder.' },
        old_string: { type: 'string', description: 'Exact text to replace. Must be unique in the file.' },
        new_string: { type: 'string', description: 'Replacement text.' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring uniqueness.' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'run_command',
    description:
      'Ask to run a shell command in the open folder — tests, a build, a linter. The user is shown the exact command and must approve it before it runs. Returns exit code, stdout and stderr. Use it to check your work; do not use it to edit files.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The exact command, e.g. "npm test" or "cargo check".' },
        reason: { type: 'string', description: 'One short line on why, shown to the user with the command.' },
      },
      required: ['command'],
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
  'You can propose changes with write_file and edit_file. Both are STAGED, not',
  'written: the user sees a diff and approves or rejects it. So describe what you',
  'changed and why — do not claim a file has been saved, because it has not been',
  'yet. Prefer edit_file over rewriting a whole file; read a file before editing',
  'it, and match old_string exactly, including indentation.',
  '',
  'You can check your work with run_command, but the user must approve each one',
  'and may refuse. Keep commands short and obvious, say why in the reason field,',
  'and never use a command to edit files — that is what edit_file is for, and it',
  'is what the user is reviewing.',
  '',
  'Approving a command does not approve your staged edits: a test run sees what',
  'is on disk, not what you proposed. If you need your change tested, say so and',
  'let the user approve the diff first.',
  '',
  '',
  'The user may attach images -- a screenshot of a bug, a design, an error dialog.',
  'Treat them as part of the question, and connect what you see to the actual code',
  'by going and reading it rather than describing the picture back to them.',
  '',
  'Be concise. Cite paths as path:line when you can.',
].join('\n');

/** Run one tool call. Reads hit the Rust side; writes are staged, not applied. */
export interface CommandRequest { command: string; reason: string }
export type AskToRun = (req: CommandRequest) => Promise<boolean>;

async function runTool(
  root: string, call: ToolCall, pending: Pending, ask: AskToRun,
): Promise<{ content: string; isError: boolean }> {
  try {
    if (call.name === 'write_file') {
      const path = String(call.input.path ?? '');
      const c = await pending.stageWrite(root, path, String(call.input.content ?? ''));
      return {
        content: `Staged ${c.isNew ? 'new file' : 'change to'} ${path}. Awaiting the user's approval — it is not on disk yet.`,
        isError: false,
      };
    }
    if (call.name === 'edit_file') {
      const path = String(call.input.path ?? '');
      await pending.stageEdit(
        root, path,
        String(call.input.old_string ?? ''),
        String(call.input.new_string ?? ''),
        call.input.replace_all === true,
      );
      return { content: `Staged an edit to ${path}. Awaiting approval — not on disk yet.`, isError: false };
    }
    if (call.name === 'run_command') {
      const command = String(call.input.command ?? '').trim();
      if (!command) return { content: 'command was empty', isError: true };
      // This awaits a human. The loop is genuinely suspended here rather than
      // returning "pending" and ending the turn -- keeping the turn intact is
      // what lets the model act on the output in the same breath.
      const decision = await ask({ command, reason: String(call.input.reason ?? '') });
      if (!decision) {
        return { content: 'The user declined to run that command.', isError: false };
      }
      const r = await invoke<{
        code: number; stdout: string; stderr: string; timed_out: boolean; truncated: boolean;
      }>('run_command', { root, command, timeoutSecs: null });
      const parts = [`exit code: ${r.code}${r.timed_out ? ' (timed out and was killed)' : ''}`];
      if (r.stdout.trim()) parts.push(`stdout:\n${r.stdout}`);
      if (r.stderr.trim()) parts.push(`stderr:\n${r.stderr}`);
      if (!r.stdout.trim() && !r.stderr.trim()) parts.push('(no output)');
      // A non-zero exit is information, not a tool failure -- flagging it as an
      // error would push the model to apologise instead of reading the output.
      return { content: parts.join('\n\n'), isError: false };
    }
    if (call.name === 'list_tree') {
      const entries = await invoke('list_tree', { root, maxEntries: call.input.max_entries ?? null });
      return { content: JSON.stringify(entries), isError: false };
    }
    if (call.name === 'read_file') {
      // Staged content wins. Reading the on-disk version after staging an edit
      // would show the agent its own change missing, and it would either repeat
      // the edit or report that it failed.
      const path = String(call.input.path ?? '');
      return { content: await pending.currentContent(root, path), isError: false };
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
  /** Staging area. The loop routes write_file/edit_file here instead of to disk. */
  pending: Pending;
  /** Suspends the loop until a human approves a command. Resolve false to decline. */
  askToRun: AskToRun;
  /** Called as the loop progresses so the UI can show work in flight. */
  onEvent: (e: { kind: 'text' | 'tool' | 'result'; text: string }) => void;
  /** Fired whenever the staged set changes, so the review panel can update mid-turn. */
  onStaged?: () => void;
  /** Stop after this many model round-trips. A loop that will not terminate is a bill. */
  maxHops?: number;
}

export async function runAgent(o: RunOptions): Promise<Msg[]> {
  const messages: Msg[] = [...o.history];
  const maxHops = o.maxHops ?? 12;

  for (let hop = 0; hop < maxHops; hop++) {
    let res: Response;
    try {
      res = await fetch(`${o.baseUrl}/v1/messages`, {
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
    } catch (e) {
      // A webview reports every network-layer failure as "Load failed", which
      // reads like a broken key or a dead server and is neither. Name the three
      // things it actually is, in the order they are worth checking.
      throw new Error(
        `Could not reach the gateway at ${o.baseUrl}. `
        + 'Check the address in Settings, that you are online, and that the gateway allows this app '
        + `(the underlying error was: ${e instanceof Error ? e.message : String(e)}).`,
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let detail = body.slice(0, 300);
      try {
        const j = JSON.parse(body);
        if (j?.error?.message) detail = j.error.message;
      } catch { /* not JSON; the raw body is the best we have */ }
      if (res.status === 401) throw new Error(`The gateway rejected the API key. Check it in Settings. (${detail})`);
      if (res.status === 429) throw new Error(`Rate limited by the gateway — wait a moment. (${detail})`);
      throw new Error(`Gateway ${res.status}: ${detail}`);
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
      const r = await runTool(o.root, { id: c.id, name: c.name, input: c.input }, o.pending, o.askToRun);
      o.onEvent({ kind: 'result', text: `${c.name} → ${r.isError ? 'error: ' : ''}${r.content.slice(0, 160)}` });
      if (c.name === 'write_file' || c.name === 'edit_file') o.onStaged?.();
      results.push({ type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: r.isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }

  throw new Error(`Stopped after ${maxHops} hops without finishing.`);
}
